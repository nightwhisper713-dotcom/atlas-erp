-- ============================================================
-- 009_operator.sql · ATLAS 營運後台（superadmin）配套
-- ============================================================

-- superadmin 可管理方案定義
create policy plans_admin on plans for all
  using (is_superadmin()) with check (is_superadmin());

-- superadmin 可讀全租戶 profiles 已涵蓋（profile_self）；
-- 營運後台需跨租戶讀 channels/companies 統計 → companies 已有 company_admin。

-- 開通新租戶：建公司 + 產生老闆邀請碼，一次完成
create or replace function provision_tenant(p_name text, p_plan text default 'standard')
returns table (company_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare v_co uuid; v_code text;
begin
  if not is_superadmin() then raise exception '僅系統管理員可開通租戶'; end if;
  insert into companies (name, plan_id, status) values (p_name, p_plan, 'active')
  returning id into v_co;
  insert into invite_codes (company_id, role) values (v_co, 'owner')
  returning code into v_code;
  -- 預設五通路
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'shopee','蝦皮購物',11,'csv'), (v_co,'ruten','露天拍賣',5,'csv'),
    (v_co,'yahoo','Yahoo 拍賣',5.5,'csv'), (v_co,'social','社群私訊',0,'manual'),
    (v_co,'store','門市 POS',0,'builtin');
  insert into price_tiers (company_id, name, discount_pct) values
    (v_co,'批發 A 級',-18), (v_co,'批發 B 級',-12), (v_co,'零售',0);
  return query select v_co, v_code;
end $$;

-- 營運端成本統計（RPC 版，僅 superadmin 可呼叫；取代直讀 view）
create or replace function operator_tenant_stats()
returns table (company_id uuid, name text, plan_id text, plan_name text, price_month int,
               status text, ai_cs boolean, quota_balance int,
               month_api_cost numeric, month_llm_calls bigint, month_orders bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception '僅系統管理員可查詢'; end if;
  return query
  select c.id, c.name, c.plan_id, p.name, p.price_month, c.status,
         coalesce((feature_value(c.id, 'ai_cs'))::text = 'true', false),
         cs_quota_balance(c.id),
         coalesce((select sum(u.cost_ntd) from cs_usage_events u
            where u.company_id = c.id and u.created_at >= date_trunc('month', now())), 0),
         coalesce((select count(*) from cs_usage_events u
            where u.company_id = c.id and u.created_at >= date_trunc('month', now())), 0),
         coalesce((select count(*) from orders o
            where o.company_id = c.id and o.created_at >= date_trunc('month', now())
              and o.status not in ('draft','cancelled')), 0)
  from companies c join plans p on p.id = c.plan_id
  order by c.created_at;
end $$;
