-- ============================================================
-- 005_reports.sql · 報表 views（儀表板/真毛利/庫存健康度）
-- 全部帶 company_id，前端查詢時 RLS 於底層表生效（security_invoker）
-- ============================================================

-- 各通路本月績效（真毛利 = 營收 − 成本 − 手續費 − 運補）
create or replace view v_channel_performance with (security_invoker = true) as
select o.company_id, c.code as channel_code, c.name as channel_name,
       date_trunc('month', o.created_at) as month,
       count(*) as order_count,
       sum(o.total) as revenue,
       sum(o.platform_fee) as platform_fee,
       sum(o.shipping_fee) as shipping_fee,
       sum(o.total) - sum(o.platform_fee) - sum(o.shipping_fee)
         - coalesce(sum(ic.cost_total), 0) as true_margin,
       round(100.0 * (sum(o.total) - sum(o.platform_fee) - sum(o.shipping_fee) - coalesce(sum(ic.cost_total),0))
             / nullif(sum(o.total), 0), 1) as margin_pct
from orders o
join channels c on c.id = o.channel_id
left join lateral (
  select sum(oi.qty * oi.unit_cost) as cost_total
  from order_items oi where oi.order_id = o.id) ic on true
where o.status not in ('draft','cancelled')
group by o.company_id, c.code, c.name, date_trunc('month', o.created_at);

-- 儀表板 KPI（今日）
create or replace view v_dashboard_kpi with (security_invoker = true) as
select cmp.id as company_id,
  (select coalesce(sum(total),0) from orders o where o.company_id = cmp.id
     and o.created_at::date = current_date and o.status not in ('draft','cancelled')) as today_revenue,
  (select count(*) from orders o where o.company_id = cmp.id and o.status in ('confirmed','picking','packed')) as pending_ship,
  (select count(*) from orders o where o.company_id = cmp.id and o.status in ('confirmed','picking','packed')
     and o.confirmed_at < now() - interval '24 hours') as pending_ship_overdue,
  (select count(*) from products p where p.company_id = cmp.id and p.status='active'
     and not p.is_bundle and p.current_stock < p.safety_stock) as low_stock_count,
  (select round(100.0 * (sum(total)-sum(platform_fee)-sum(shipping_fee)
     - coalesce(sum((select sum(qty*unit_cost) from order_items oi where oi.order_id=o.id)),0))
     / nullif(sum(total),0), 1)
   from orders o where o.company_id = cmp.id
     and date_trunc('month', o.created_at) = date_trunc('month', now())
     and o.status not in ('draft','cancelled')) as month_margin_pct
from companies cmp;

-- 近14日各通路營收（趨勢圖）
create or replace view v_revenue_14d with (security_invoker = true) as
select o.company_id, c.code as channel_code, o.created_at::date as day, sum(o.total) as revenue
from orders o join channels c on c.id = o.channel_id
where o.created_at > now() - interval '14 days' and o.status not in ('draft','cancelled')
group by o.company_id, c.code, o.created_at::date;

-- 熱銷 TOP（本月）
create or replace view v_top_products with (security_invoker = true) as
select o.company_id, oi.product_id, p.sku, p.name,
       sum(oi.qty) as qty_sold, sum(oi.qty * oi.unit_price) as revenue
from order_items oi
join orders o on o.id = oi.order_id
join products p on p.id = oi.product_id
where date_trunc('month', o.created_at) = date_trunc('month', now())
  and o.status not in ('draft','cancelled')
group by o.company_id, oi.product_id, p.sku, p.name;

-- 庫存健康度
create or replace view v_stock_health with (security_invoker = true) as
select p.company_id,
  count(*) filter (where p.current_stock < p.safety_stock and not p.is_bundle) as low_stock,
  count(*) filter (where p.last_sold_at < now() - interval '90 days'
                   or (p.last_sold_at is null and p.created_at < now() - interval '90 days')) as stagnant_count,
  sum(p.current_stock * p.cost) filter (where p.last_sold_at < now() - interval '90 days') as stagnant_value,
  sum(p.current_stock * p.cost) as total_stock_value,
  count(*) as sku_count
from products p where p.status = 'active'
group by p.company_id;

-- 客戶歸戶建議（同電話不同名 / 同名同通路）
create or replace view v_customer_merge_suggest with (security_invoker = true) as
select a.company_id, a.id as customer_a, b.id as customer_b, a.name as name_a, b.name as name_b,
       a.phone, 'same_phone' as match_type
from customers a join customers b
  on a.company_id = b.company_id and a.phone = b.phone and a.phone <> '' and a.id < b.id
where a.merged_into is null and b.merged_into is null;

-- 客戶累積消費
create or replace view v_customer_stats with (security_invoker = true) as
select c.company_id, c.id as customer_id, c.name, c.tier_id,
       count(o.id) as order_count, coalesce(sum(o.total),0) as lifetime_value,
       max(o.created_at) as last_order_at
from customers c left join orders o on o.customer_id = c.id and o.status not in ('draft','cancelled')
where c.merged_into is null
group by c.company_id, c.id, c.name, c.tier_id;

-- 歸戶 RPC：B 併入 A（訂單移轉、B 標記）
create or replace function merge_customers(p_keep uuid, p_merge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := current_company_id();
begin
  update orders set customer_id = p_keep
   where customer_id = p_merge and company_id = v_company;
  update customers set merged_into = p_keep,
    source_channels = (select array(select distinct unnest(a.source_channels || b.source_channels)
                       from customers a, customers b where a.id = p_keep and b.id = p_merge))
   where id = p_merge and company_id = v_company;
  update customers set source_channels =
    (select source_channels from customers where id = p_merge)
   where id = p_keep and company_id = v_company;
end $$;
