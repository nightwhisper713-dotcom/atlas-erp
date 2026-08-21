-- ============================================================
-- 008_frontend_support.sql · 前端配套：註冊/邀請/POS/批次確認
-- ============================================================

-- 新註冊者可自建 profile（尚未指派租戶，company_id 必須為 null）
create policy profile_self_insert on profiles for insert
  with check (id = auth.uid() and company_id is null and role = 'store');

-- 自己可改顯示名稱（不可改角色/租戶：以 trigger 防護）
create policy profile_self_update on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function trg_protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and not is_superadmin()
     and (select role from profiles where id = auth.uid()) <> 'owner' then
    if new.role <> old.role or new.company_id is distinct from old.company_id then
      raise exception '無權變更角色或租戶';
    end if;
  end if;
  return new;
end $$;
create trigger t_protect_profile before update on profiles
  for each row execute function trg_protect_profile();

-- 邀請碼：owner 產生 → 新人註冊時輸入即掛入租戶
create table invite_codes (
  code        text primary key default substr(md5(random()::text), 1, 8),
  company_id  uuid not null references companies(id) on delete cascade,
  role        text not null default 'store' check (role in ('owner','store','shipping','purchasing')),
  used_by     uuid,
  created_at  timestamptz not null default now()
);
alter table invite_codes enable row level security;
create policy ic_owner on invite_codes for all
  using (is_superadmin() or (company_id = current_company_id() and current_role_() = 'owner'))
  with check (is_superadmin() or (company_id = current_company_id() and current_role_() = 'owner'));

create or replace function redeem_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_co uuid; v_role text;
begin
  select company_id, role into v_co, v_role from invite_codes
   where code = p_code and used_by is null for update;
  if v_co is null then raise exception '邀請碼無效或已使用'; end if;
  update profiles set company_id = v_co, role = v_role where id = auth.uid();
  update invite_codes set used_by = auth.uid() where code = p_code;
end $$;

-- POS / 手動建單：建單＋確認一次完成（門市價依客戶等級）
create or replace function pos_checkout(
  p_items jsonb,               -- [{product_id, qty, unit_price}]
  p_customer uuid default null,
  p_pay_method text default '現金',
  p_note text default ''
) returns text
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id(); v_ch uuid; v_no text; v_ord uuid;
        v_total numeric := 0; r jsonb;
begin
  select id into v_ch from channels where company_id = v_company and code = 'store';
  if v_ch is null then raise exception '門市通路未設定'; end if;
  v_no := next_order_no('ST');
  for r in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (r->>'qty')::int * (r->>'unit_price')::numeric;
  end loop;
  insert into orders (company_id, order_no, channel_id, customer_id, customer_name, status,
                      pay_status, pay_method, subtotal, total, source, note)
  values (v_company, v_no, v_ch, p_customer,
          coalesce((select name from customers where id = p_customer), '散客'),
          'pending', 'cod', p_pay_method, v_total, v_total, 'pos', p_note)
  returning id into v_ord;
  for r in select * from jsonb_array_elements(p_items) loop
    insert into order_items (order_id, product_id, description, qty, unit_price, is_service)
    values (v_ord, nullif(r->>'product_id','')::uuid, coalesce(r->>'description',''),
            (r->>'qty')::int, (r->>'unit_price')::numeric,
            coalesce((r->>'is_service')::boolean, false));
  end loop;
  perform confirm_order(v_ord);
  update orders set status = 'completed' where id = v_ord;
  return v_no;
end $$;

-- 批次確認（CSV 匯入後一鍵確認扣庫存）
create or replace function confirm_orders(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_n int := 0;
begin
  foreach v_id in array p_ids loop
    begin
      perform confirm_order(v_id);
      v_n := v_n + 1;
    exception when others then null; -- 略過非 pending
    end;
  end loop;
  return v_n;
end $$;

-- 出貨狀態推進（單向）
create or replace function advance_order(p_order uuid, p_status text, p_tracking text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('picking','packed','shipped','completed') then
    raise exception '無效狀態'; end if;
  update orders set status = p_status,
    tracking_no = case when p_tracking <> '' then p_tracking else tracking_no end
  where id = p_order and company_id = current_company_id();
end $$;
