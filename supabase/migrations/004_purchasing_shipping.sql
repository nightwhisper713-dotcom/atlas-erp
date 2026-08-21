-- ============================================================
-- 004_purchasing_shipping.sql · 採購（移動平均成本）/ 出貨 / 退換貨 / 發票
-- ============================================================

create table purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  po_no       text not null,
  supplier_id uuid references suppliers(id),
  status      text not null default 'draft' check (status in ('draft','ordered','arrived','received','cancelled')),
  expected_at date,
  total       numeric(12,2) not null default 0,
  paid        boolean not null default false,
  note        text default '',
  created_at  timestamptz not null default now(),
  received_at timestamptz,
  unique (company_id, po_no)
);

create table po_items (
  id          uuid primary key default gen_random_uuid(),
  po_id       uuid not null references purchase_orders(id) on delete cascade,
  product_id  uuid not null references products(id),
  qty         int not null check (qty > 0),
  unit_cost   numeric(12,2) not null,
  received_qty int not null default 0
);

-- 補貨建議（提案公式：日銷×前置天數＋安全量−現有−在途，箱規進位）
create or replace view v_replenish_suggest with (security_invoker = true) as
select p.company_id, p.id as product_id, p.sku, p.name,
       p.current_stock, p.safety_stock, p.box_size,
       coalesce(s.qty30, 0) as sold_30d,
       coalesce(ot.on_the_way, 0) as on_the_way,
       greatest(0, ceil( (coalesce(s.qty30,0)/30.0 * coalesce(sup.lead_days,14)
                          + p.safety_stock - p.current_stock - coalesce(ot.on_the_way,0))
                  / greatest(p.box_size,1) )::int * greatest(p.box_size,1)) as suggest_qty,
       round(coalesce(s.qty30,0)/30.0, 1) as daily_rate,
       coalesce(sup.lead_days, 14) as lead_days,
       p.supplier_id
from products p
left join suppliers sup on sup.id = p.supplier_id
left join lateral (
  select -sum(qty) as qty30 from stock_movements m
  where m.product_id = p.id and m.movement_type = 'sale'
    and m.created_at > now() - interval '30 days') s on true
left join lateral (
  select sum(pi.qty - pi.received_qty) as on_the_way
  from po_items pi join purchase_orders po on po.id = pi.po_id
  where pi.product_id = p.id and po.status in ('ordered','arrived')) ot on true
where p.status = 'active' and not p.is_bundle;

-- 一鍵產採購單草稿（低庫存全部納入，依供應商分單）
create or replace function create_po_drafts() returns setof uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); v_sup uuid; v_po uuid; r record;
begin
  for v_sup in select distinct supplier_id from v_replenish_suggest
               where company_id = v_company and suggest_qty > 0 loop
    insert into purchase_orders (company_id, po_no, supplier_id, status)
    values (v_company, 'PO-' || to_char(now(),'YYMMDDHH24MI') || '-' || coalesce(left(v_sup::text,4),'NA'), v_sup, 'draft')
    returning id into v_po;
    for r in select * from v_replenish_suggest
             where company_id = v_company and suggest_qty > 0
               and supplier_id is not distinct from v_sup loop
      insert into po_items (po_id, product_id, qty, unit_cost)
      values (v_po, r.product_id, r.suggest_qty,
              coalesce((select cost from products where id = r.product_id), 0));
    end loop;
    update purchase_orders set total = (select coalesce(sum(qty*unit_cost),0) from po_items where po_id = v_po)
     where id = v_po;
    return next v_po;
  end loop;
end $$;

-- 驗收入庫：+庫存、移動平均成本、應付
create or replace function receive_po(p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); r record; v_no text; v_old_stock int; v_old_cost numeric;
begin
  select po_no into v_no from purchase_orders
   where id = p_po and company_id = v_company and status in ('ordered','arrived') for update;
  if v_no is null then raise exception '採購單不存在或狀態不可驗收'; end if;

  for r in select * from po_items where po_id = p_po loop
    select current_stock, cost into v_old_stock, v_old_cost from products where id = r.product_id;
    insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, operator_id)
    values (v_company, r.product_id, 'purchase', r.qty, 'po', v_no,
            '驗收入庫（成本移動平均 ' || v_old_cost || '→' ||
            round((v_old_stock*v_old_cost + r.qty*r.unit_cost) / nullif(v_old_stock + r.qty,0), 2) || '）',
            auth.uid());
    update products set cost = round((v_old_stock*v_old_cost + r.qty*r.unit_cost) / nullif(v_old_stock + r.qty,0), 2)
     where id = r.product_id and (v_old_stock + r.qty) > 0;
    update po_items set received_qty = qty where id = r.id;
  end loop;
  update purchase_orders set status = 'received', received_at = now() where id = p_po;
end $$;

-- ---------- 退換貨 ----------
create table returns (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  return_no   text not null,
  order_id    uuid references orders(id),
  reason      text default '',
  status      text not null default 'awaiting' check (status in ('awaiting','received','completed','rejected')),
  to_defect   boolean not null default false,    -- 收回進瑕疵倉？
  created_at  timestamptz not null default now(),
  unique (company_id, return_no)
);
create table return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references returns(id) on delete cascade,
  product_id uuid not null references products(id),
  qty int not null check (qty > 0),
  exchange_product_id uuid references products(id),  -- 換貨：換出商品
  exchange_qty int default 0
);

-- 收到退貨：反向異動（+回原倉或瑕疵倉；換貨再扣換出品）
create or replace function receive_return(p_return uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); r record; v_no text; v_defect boolean;
begin
  select return_no, to_defect into v_no, v_defect from returns
   where id = p_return and company_id = v_company and status = 'awaiting' for update;
  if v_no is null then raise exception '退貨單不存在或已處理'; end if;
  for r in select * from return_items where return_id = p_return loop
    insert into stock_movements (company_id, product_id, movement_type, qty, zone, ref_type, ref_id, reason, operator_id)
    values (v_company, r.product_id, 'return_in', r.qty,
            case when v_defect then 'defect' else 'main' end, 'return', v_no, '退貨入庫', auth.uid());
    if r.exchange_product_id is not null and r.exchange_qty > 0 then
      insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, operator_id)
      values (v_company, r.exchange_product_id, 'return_out', -r.exchange_qty, 'return', v_no, '換貨出庫', auth.uid());
    end if;
  end loop;
  update returns set status = 'completed' where id = p_return;
end $$;

-- ---------- 發票（綠界測試環境 v1）----------
create table invoices (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  order_id    uuid not null references orders(id),
  invoice_no  text default '',
  status      text not null default 'pending' check (status in ('pending','issued','void','failed')),
  amount      numeric(12,2) not null,
  buyer       jsonb not null default '{}',       -- 統編/載具/捐贈
  ecpay_payload jsonb not null default '{}',     -- 回傳原文（稽核）
  env         text not null default 'stage',     -- stage=綠界測試 / prod
  issued_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------- RLS ----------
alter table purchase_orders enable row level security;
alter table po_items        enable row level security;
alter table returns         enable row level security;
alter table return_items    enable row level security;
alter table invoices        enable row level security;

create policy po_all  on purchase_orders for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy poi_all on po_items for all
  using (exists (select 1 from purchase_orders po where po.id = po_id and po.company_id = current_company_id()))
  with check (exists (select 1 from purchase_orders po where po.id = po_id and po.company_id = current_company_id()));
create policy ret_all on returns for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy reti_all on return_items for all
  using (exists (select 1 from returns r where r.id = return_id and r.company_id = current_company_id()))
  with check (exists (select 1 from returns r where r.id = return_id and r.company_id = current_company_id()));
create policy inv_all on invoices for all using (company_id = current_company_id()) with check (company_id = current_company_id());
