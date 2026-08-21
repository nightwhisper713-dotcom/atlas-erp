-- ============================================================
-- 006_ai_cs.sql · AI 客服加值模組（計量先行；引擎後接）
-- 開關：feature_value(company_id,'ai_cs') = true 才啟用
-- ============================================================

create table cs_channel_connections (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  channel     text not null check (channel in ('line','messenger','instagram','shopee','ruten','yahoo','web')),
  mode        text not null default 'copilot' check (mode in ('auto','copilot','off')),
  status      text not null default 'disconnected',
  settings    jsonb not null default '{}',
  unique (company_id, channel)
);

create table cs_conversations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  channel     text not null,
  external_uid text default '',              -- 平台端使用者 id
  customer_id uuid references customers(id),
  status      text not null default 'ai' check (status in ('ai','human','closed')),
  last_message_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index idx_csconv on cs_conversations (company_id, status, last_message_at desc);

create table cs_messages (
  id          bigint generated always as identity primary key,
  conversation_id uuid not null references cs_conversations(id) on delete cascade,
  direction   text not null check (direction in ('in','out')),
  sender      text not null check (sender in ('customer','ai','agent','system')),
  content     text not null,
  pipeline_stage text default '',            -- canned/cache/sql/rag/llm_big/handoff
  created_at  timestamptz not null default now()
);

create table cs_kb_articles (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  title       text not null,
  content     text not null,
  tags        text[] not null default '{}',
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table cs_canned_replies (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  keywords    text[] not null,
  reply       text not null,
  is_active   boolean not null default true
);

-- ---------- 計量核心（每次 LLM 呼叫一筆，不漏記）----------
create table cs_usage_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  conversation_id uuid,
  channel     text default '',
  model       text not null,                 -- claude-haiku-4-5 / claude-sonnet-...
  stage       text not null,                 -- intent/rag/big/summary
  input_tokens  int not null default 0,
  output_tokens int not null default 0,
  cached_tokens int not null default 0,
  cost_ntd    numeric(10,4) not null default 0,
  created_at  timestamptz not null default now()
);
create index idx_usage on cs_usage_events (company_id, created_at desc);

-- 額度帳本（與庫存同哲學：餘額 = 事件加總）
create table cs_quota_ledger (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  delta       int not null,                  -- +方案月配 / +加購 / −1 每則 AI 回覆
  reason      text not null,                 -- monthly_grant/addon/reply/adjust
  ref         text default '',
  created_at  timestamptz not null default now()
);
create index idx_quota on cs_quota_ledger (company_id, created_at desc);

create or replace function cs_quota_balance(p_company uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from cs_quota_ledger
  where company_id = p_company
    and created_at >= date_trunc('month', now())
$$;

-- 每月發放（由排程/Edge Function 呼叫；冪等：本月已發不重發）
create or replace function cs_grant_monthly_quota(p_company uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_quota int := coalesce((feature_value(p_company, 'ai_quota'))::text::int, 0);
begin
  if v_quota > 0 and not exists (
    select 1 from cs_quota_ledger where company_id = p_company
      and reason = 'monthly_grant' and created_at >= date_trunc('month', now())) then
    insert into cs_quota_ledger (company_id, delta, reason)
    values (p_company, v_quota, 'monthly_grant');
  end if;
end $$;

-- ---------- 營運端毛利視圖 ----------
create or replace view v_tenant_cost with (security_invoker = false) as
select c.id as company_id, c.name, p.name as plan_name, p.price_month,
       date_trunc('month', u.created_at) as month,
       coalesce(sum(u.cost_ntd), 0) as api_cost_ntd,
       count(u.id) as llm_calls,
       p.price_month - coalesce(sum(u.cost_ntd), 0) as gross_margin_ntd
from companies c
join plans p on p.id = c.plan_id
left join cs_usage_events u on u.company_id = c.id
group by c.id, c.name, p.name, p.price_month, date_trunc('month', u.created_at);
-- 營運端專用：一般使用者不可讀（僅 service_role / postgres）
revoke all on v_tenant_cost from anon, authenticated;

-- ---------- RLS ----------
alter table cs_channel_connections enable row level security;
alter table cs_conversations enable row level security;
alter table cs_messages      enable row level security;
alter table cs_kb_articles   enable row level security;
alter table cs_canned_replies enable row level security;
alter table cs_usage_events  enable row level security;
alter table cs_quota_ledger  enable row level security;

create policy cscc_all on cs_channel_connections for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy csconv_all on cs_conversations for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy csmsg_all on cs_messages for all
  using (exists (select 1 from cs_conversations cv where cv.id = conversation_id and cv.company_id = current_company_id()))
  with check (exists (select 1 from cs_conversations cv where cv.id = conversation_id and cv.company_id = current_company_id()));
create policy cskb_all on cs_kb_articles for all using (company_id = current_company_id()) with check (company_id = current_company_id());
create policy cscan_all on cs_canned_replies for all using (company_id = current_company_id()) with check (company_id = current_company_id());
-- 租戶只能「讀」自己的用量與額度；寫入僅 service_role（引擎端）
create policy csuse_read on cs_usage_events for select using (company_id = current_company_id() or is_superadmin());
create policy csq_read on cs_quota_ledger for select using (company_id = current_company_id() or is_superadmin());
-- v_tenant_cost 為營運端視圖：透過 superadmin 專用 API / service_role 存取
