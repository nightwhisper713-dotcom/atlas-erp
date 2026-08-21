-- ============================================================
-- 011_fix_redeem_invite.sql · 修正：邀請碼兌換被 profile 保護誤擋
-- ============================================================

create or replace function trg_protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('atlas.allow_grant', true), '') = '1' then
    return new;   -- redeem_invite 受控情境放行
  end if;
  if auth.uid() = old.id and not is_superadmin()
     and (select role from profiles where id = auth.uid()) <> 'owner' then
    if new.role <> old.role or new.company_id is distinct from old.company_id then
      raise exception '無權變更角色或租戶';
    end if;
  end if;
  return new;
end $$;

create or replace function redeem_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_co uuid; v_role text;
begin
  select company_id, role into v_co, v_role from invite_codes
   where code = p_code and used_by is null for update;
  if v_co is null then raise exception '邀請碼無效或已使用'; end if;
  perform set_config('atlas.allow_grant', '1', true);   -- 僅本交易有效
  update profiles set company_id = v_co, role = v_role where id = auth.uid();
  update invite_codes set used_by = auth.uid() where code = p_code;
end $$;
