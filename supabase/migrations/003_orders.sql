-- ============================================================
-- 003_orders.sql · 通路 / 客戶 / 訂單（冪等匯入 + 只扣一次庫存）
-- ============================================================

create table channels (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  code        text not null,     -- shopee / ruten / yahoo / social / store
  name        text not null,
  fee_rate    numeric(5,2) not null default 0,   -- 手續費 %（真毛利用）
  mode        text not null default 'csv' check (mode in ('api','csv','manual','builtin')),
  is_active   boolean not null default true,
  settings    jsonb not null default '{}',       -- 帳號、同步頻率…（金鑰放 integration_secrets）
  unique (company_id, code)
);

-- 金鑰獨立存放（僅 service_role 可讀，前端永不回傳）
create table integration_secrets (
  company_id  uuid not null references companies(id) on delete cascade,
  provider    text not null,                     -- shopee / ecpay / line / meta / seven / tcat
  secret      jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, provider)
);

create table price_tiers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,                     -- 批發A級 / 批發B級 / 零售
  discount_pct numeric(5,2) not null default 0,  -- −18 → 售價 82 折
  unique (company_id, name)
);

create table customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  phone       text default '',
  line_uid    text default '',
  tier_id     uuid references price_tiers(id),
  source_channels text[] not null default '{}',
  note        text default '',
  merged_into uuid references customers(id),     -- 歸戶：被併入者指向主檔
  created_at  timestamptz not null default now()
);
create index idx_cust_phone on customers (company_id, phone);

-- ---------- 訂單 ----------
create table orders (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  order_no    text not null,                     -- 系統單號 或 平台單號
  channel_id  uuid not null references channels(id),
  platform_order_no text default '',             -- 平台原始單號（冪等鍵）
  customer_id uuid references customers(id),
  customer_name text default '',
  status      text not null default 'pending' check (status in
    ('draft','pending','confirmed','picking','packed','shipped','completed','cancelled','returned')),
  pay_status  text not null default 'unpaid' check (pay_status in ('unpaid','paid','cod','transfer_pending')),
  pay_method  text default '',
  subtotal    numeric(12,2) not null default 0,
  platform_fee numeric(12,2) not null default 0, -- 依 channel.fee_rate 估算或匯入實值
  shipping_fee numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0,
  ship_method text default '',                   -- seven / tcat / pickup
  ship_to     jsonb not null default '{}',
  tracking_no text default '',
  invoice_no  text default '',
  note        text default '',
  source      text not null default 'manual' check (source in ('csv','manual','api','pos','social')),
  confirmed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (company_id, order_no)
);
-- 冪等鍵：同通路同平台單號只進一次
create unique index uq_orders_platform on orders (company_id, channel_id, platform_order_no)
  where platform_order_no <> '';
create index idx_orders_status on orders (company_id, status, created_at desc);

create table order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid references products(id),
  description text not null default '',          -- 客製項目可無商品主檔（研磨服務…）
  qty         int not null check (qty > 0),
  unit_price  numeric(12,2) not null,
  unit_cost   numeric(12,2) not null default 0,  -- 成交當下成本快照（真毛利）
  is_service  boolean not null default false     -- 服務單不扣庫存
);

-- ---------- RPC：確認訂單 = 單一交易、只扣一次 ----------
create or replace function confirm_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); r record; c record; v_no text;
begin
  select order_no into v_no from orders
   where id = p_order and company_id = v_company and status = 'pending'
   for update;
  if v_no is null then raise exception '訂單不存在或非待確認狀態（防重扣）'; end if;

  for r in select oi.*, p.is_bundle from order_items oi
           left join products p on p.id = oi.product_id
           where oi.order_id = p_order and not oi.is_service and oi.product_id is not null
  loop
    if r.is_bundle then
      insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, operator_id)
      values (v_company, r.product_id, 'bundle_out', -r.qty, 'order', v_no, '組合品銷售', auth.uid());
      for c in select component_id, qty from product_bundles where bundle_id = r.product_id loop
        insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, operator_id)
        values (v_company, c.component_id, 'sale', -(c.qty * r.qty), 'order', v_no, '組合零件扣庫', auth.uid());
      end loop;
    else
      insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, operator_id)
      values (v_company, r.product_id, 'sale', -r.qty, 'order', v_no, auth.uid());
    end if;
    -- 成本快照
    update order_items set unit_cost = coalesce((select cost from products where id = r.product_id), 0)
     where id = r.id and unit_cost = 0;
  end loop;

  update orders set status = 'confirmed', confirmed_at = now(),
    platform_fee = case when platform_fee = 0
      then round(total * (select fee_rate from channels where id = channel_id) / 100, 0)
      else platform_fee end
   where id = p_order;
end $$;

-- 取消已確認訂單 → 回沖
create or replace function cancel_order(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); r record; v_no text; v_status text;
begin
  select order_no, status into v_no, v_status from orders
   where id = p_order and company_id = v_company for update;
  if v_no is null then raise exception '訂單不存在'; end if;
  if v_status in ('confirmed','picking','packed') then
    for r in select product_id, qty, is_service from order_items where order_id = p_order
             and not is_service and product_id is not null loop
      insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, operator_id)
      values (v_company, r.product_id, 'return_in', r.qty, 'order', v_no, '取消回沖:' || p_reason, auth.uid());
    end loop;
  end if;
  update orders set status = 'cancelled', note = trim(note || ' [取消]' || p_reason) where id = p_order;
end $$;

-- 系統單號產生器（社群/門市/手動）
create or replace function next_order_no(p_prefix text) returns text
language sql volatile security definer set search_path = public as $$
  select p_prefix || '-' || to_char(now(), 'YYMMDD') || '-' ||
         lpad((coalesce((select count(*) from orders
           where company_id = current_company_id()
             and created_at::date = current_date), 0) + 1)::text, 4, '0')
$$;

-- ---------- RLS ----------
alter table channels    enable row level security;
alter table integration_secrets enable row level security;
alter table price_tiers enable row level security;
alter table customers   enable row level security;
alter table orders      enable row level security;
alter table order_items enable row level security;

create policy ch_all   on channels    for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy tier_all on price_tiers for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy cust_all on customers   for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy ord_all  on orders      for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy oi_all   on order_items for all
  using (exists (select 1 from orders o where o.id = order_id and o.company_id = current_company_id()))
  with check (exists (select 1 from orders o where o.id = order_id and o.company_id = current_company_id()));
-- 金鑰：前端完全不可讀（無 policy = 拒絕；只有 service_role 繞過 RLS）
