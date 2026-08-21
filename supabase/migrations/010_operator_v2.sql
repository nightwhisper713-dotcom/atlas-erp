-- ============================================================
-- 010_operator_v2.sql · 營運後台 v2：刪除租戶／使用者管理
-- ============================================================

-- 帳本防竄改 trigger：僅在「租戶抹除」受控情境允許 DELETE
create or replace function trg_block_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('atlas.allow_wipe', true), '') = '1' then
    return old;
  end if;
  raise exception 'stock_movements 為不可竄改帳本';
end $$;

-- 刪除租戶（superadmin；需輸入租戶名稱確認；連同全部資料）
create or replace function delete_tenant(p_company uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_superadmin() then raise exception '僅系統管理員可刪除租戶'; end if;
  select name into v_name from companies where id = p_company;
  if v_name is null then raise exception '租戶不存在'; end if;
  if v_name <> p_confirm_name then raise exception '確認名稱不符，需完整輸入：%', v_name; end if;
  perform set_config('atlas.allow_wipe', '1', true);   -- 僅本交易有效
  delete from companies where id = p_company;          -- 級聯刪除所有關聯資料
end $$;

-- 租戶使用者清單（含 Email 與最後登入；密碼為雜湊不可讀取）
create or replace function operator_tenant_users(p_company uuid)
returns table (uid uuid, email text, display_name text, role text, is_active boolean, last_sign_in timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception '僅系統管理員可查詢'; end if;
  return query
  select p.id, u.email::text, p.display_name, p.role, p.is_active, u.last_sign_in_at
  from profiles p join auth.users u on u.id = p.id
  where p.company_id = p_company
  order by p.created_at;
end $$;

-- 為既有租戶產生邀請碼（superadmin 亦可，補營運端需求）
create or replace function operator_create_invite(p_company uuid, p_role text default 'store')
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_superadmin() then raise exception '僅系統管理員可產生'; end if;
  insert into invite_codes (company_id, role) values (p_company, p_role) returning code into v_code;
  return v_code;
end $$;
