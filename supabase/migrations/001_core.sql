-- ============================================================
-- 001_core.sql · 多租戶核心：租戶 / 方案 / 使用者 / 功能開關
-- 丸豐工具 全通路庫存管理系統（幻翔商用設計）
-- ============================================================
create extension if not exists pgcrypto;

-- ---------- 方案 ----------
create table plans (
  id          text primary key,              -- 'standard' | 'flagship'
  name        text not null,
  price_month int  not null,                 -- NT$/月
  features    jsonb not null default '{}',   -- {"ai_cs": false, "ai_quota": 0, ...}
  created_at  timestamptz not null default now()
);

insert into plans (id, name, price_month, features) values
 ('standard', '標準版',  1500, '{"ai_cs": false, "ai_quota": 0}'),
 ('flagship', '旗艦版（含 AI 客服）', 3000, '{"ai_cs": true, "ai_quota": 1000}');

-- ---------- 租戶 ----------
create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan_id     text not null references plans(id) default 'standard',
  status      text not null default 'active'
              check (status in ('trial','active','suspended','closed')),
  trial_ends  date,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

-- 租戶層級功能覆寫（優先於 plan.features）
create table tenant_features (
  company_id  uuid not null references companies(id) on delete cascade,
  feature     text not null,                 -- 'ai_cs' | 'ai_quota' | ...
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, feature)
);

-- ---------- 使用者 ----------
-- profiles.id = auth.users.id（Supabase Auth）
create table profiles (
  id          uuid primary key,              -- = auth.uid()
  company_id  uuid references companies(id) on delete cascade,
  display_name text not null default '',
  role        text not null default 'store'
              check (role in ('superadmin','owner','store','shipping','purchasing')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- 共用輔助函式 ----------
create or replace function current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() and is_active
$$;

create or replace function current_role_() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superadmin' from profiles where id = auth.uid()), false)
$$;

-- 功能開關解析：tenant_features 覆寫 > plan.features
create or replace function feature_value(p_company uuid, p_feature text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select value from tenant_features where company_id = p_company and feature = p_feature),
    (select p.features -> p_feature from companies c join plans p on p.id = c.plan_id where c.id = p_company),
    'null'::jsonb)
$$;

-- ---------- RLS ----------
alter table companies       enable row level security;
alter table tenant_features enable row level security;
alter table profiles        enable row level security;
alter table plans           enable row level security;

create policy plans_read on plans for select using (true);

create policy company_read on companies for select
  using (id = current_company_id() or is_superadmin());
create policy company_admin on companies for all
  using (is_superadmin()) with check (is_superadmin());

create policy tf_read on tenant_features for select
  using (company_id = current_company_id() or is_superadmin());
create policy tf_admin on tenant_features for all
  using (is_superadmin()) with check (is_superadmin());

create policy profile_self on profiles for select
  using (id = auth.uid() or company_id = current_company_id() or is_superadmin());
create policy profile_owner_manage on profiles for all
  using (is_superadmin() or (company_id = current_company_id() and current_role_() = 'owner'))
  with check (is_superadmin() or (company_id = current_company_id() and current_role_() = 'owner'));
