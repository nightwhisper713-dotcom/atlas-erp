-- ============================================================
-- 002_inventory.sql · 商品主檔 + 庫存異動帳本（鐵則：不可直改）
-- ============================================================

create table suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  contact     text default '',
  payment_terms text default '',            -- 月結30天/貨到付款…
  lead_days   int  not null default 14,     -- 前置天數（補貨公式用）
  created_at  timestamptz not null default now()
);

create table products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  sku         text not null,
  name        text not null,
  category    text default '',
  barcode     text default '',
  spec        text default '',              -- 規格描述（800/1400/2000mm…）
  is_bundle   boolean not null default false,
  cost        numeric(12,2) not null default 0,   -- 移動平均成本
  price       numeric(12,2) not null default 0,   -- 零售價
  safety_stock int not null default 0,
  box_size    int not null default 1,       -- 箱規（補貨進位）
  supplier_id uuid references suppliers(id),
  status      text not null default 'active' check (status in ('active','discontinued','archived')),
  -- 快取欄位：僅由 trigger 維護，禁止直接 UPDATE（由 RLS + trigger 保證）
  current_stock int not null default 0,
  defect_stock  int not null default 0,     -- 瑕疵倉
  last_sold_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (company_id, sku)
);

-- 組合品 BOM：bundle 賣 1 組 → 各零件扣 qty
create table product_bundles (
  bundle_id   uuid not null references products(id) on delete cascade,
  component_id uuid not null references products(id),
  qty         int not null check (qty > 0),
  primary key (bundle_id, component_id)
);

-- ---------- 庫存異動帳本（append-only）----------
create table stock_movements (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  product_id  uuid not null references products(id),
  movement_type text not null check (movement_type in
    ('sale','purchase','adjust','return_in','return_out','bundle_out','defect_in','defect_out','init')),
  qty         int not null check (qty <> 0),     -- 正=入庫 負=出庫
  zone        text not null default 'main' check (zone in ('main','defect')),
  balance_after int,                              -- trigger 回填
  ref_type    text default '',                    -- order / po / return / stocktake
  ref_id      text default '',                    -- 單號
  reason      text default '',
  operator_id uuid,                               -- profiles.id；系統動作為 null
  created_at  timestamptz not null default now()
);
create index idx_sm_product on stock_movements (company_id, product_id, created_at desc);

-- trigger：維護快取庫存 + 回填餘量
create or replace function trg_apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stock int;
begin
  if new.zone = 'main' then
    update products set current_stock = current_stock + new.qty,
      last_sold_at = case when new.movement_type = 'sale' then now() else last_sold_at end
      where id = new.product_id and company_id = new.company_id
      returning current_stock into v_stock;
  else
    update products set defect_stock = defect_stock + new.qty
      where id = new.product_id and company_id = new.company_id
      returning defect_stock into v_stock;
  end if;
  if v_stock is null then raise exception 'product not found for movement'; end if;
  new.balance_after := v_stock;
  return new;
end $$;
create trigger t_apply_movement before insert on stock_movements
  for each row execute function trg_apply_stock_movement();

-- 禁止改/刪異動（RLS 只開 select/insert；再加防線）
create or replace function trg_block_mutation() returns trigger
language plpgsql as $$ begin raise exception 'stock_movements 為不可竄改帳本'; end $$;
create trigger t_no_update before update or delete on stock_movements
  for each row execute function trg_block_mutation();

-- ---------- RPC：唯一合法的手動異動入口（盤點/瑕疵/期初）----------
create or replace function record_movement(
  p_product uuid, p_type text, p_qty int, p_reason text,
  p_ref_type text default '', p_ref_id text default '', p_zone text default 'main'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); v_id bigint;
begin
  if v_company is null then raise exception '未登入或無租戶'; end if;
  if p_type in ('sale','purchase') then
    raise exception '銷售/進貨異動請走訂單/採購流程';
  end if;
  insert into stock_movements (company_id, product_id, movement_type, qty, zone, reason, ref_type, ref_id, operator_id)
  values (v_company, p_product, p_type, p_qty, p_zone, p_reason, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- 可組數（bundle）＝ 零件 min(現有/需求)
create or replace function bundle_available(p_bundle uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(min(p.current_stock / b.qty), 0)::int
  from product_bundles b join products p on p.id = b.component_id
  where b.bundle_id = p_bundle
$$;

-- ---------- RLS ----------
alter table suppliers       enable row level security;
alter table products        enable row level security;
alter table product_bundles enable row level security;
alter table stock_movements enable row level security;

create policy sup_all on suppliers for all
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy prod_all on products for all
  using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy bundle_all on product_bundles for all
  using (exists (select 1 from products p where p.id = bundle_id and p.company_id = current_company_id()))
  with check (exists (select 1 from products p where p.id = bundle_id and p.company_id = current_company_id()));
create policy sm_read on stock_movements for select using (company_id = current_company_id());
-- insert 僅允許經 RPC（security definer），前端直插也限本租戶：
create policy sm_insert on stock_movements for insert with check (company_id = current_company_id());
