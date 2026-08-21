-- ============================================================
-- 007_seed_demo.sql · 示範租戶（沿用 DEMO 的丸豐情境數據）
-- 注意：正式開租戶不跑此檔；此檔建立 demo 租戶供展示/驗收
-- ============================================================
do $$
declare
  v_co uuid; v_sup1 uuid; v_sup2 uuid; v_sup3 uuid;
  v_ch_sp uuid; v_ch_rt uuid; v_ch_yh uuid; v_ch_so uuid; v_ch_st uuid;
  v_tier_a uuid; v_tier_b uuid;
  p_rail uuid; p_bit uuid; p_clamp uuid; p_kit uuid; p_blade uuid; p_glue uuid; p_plane uuid; p_bag uuid;
  v_cust1 uuid; v_cust2 uuid; v_ord uuid;
begin
  insert into companies (name, plan_id, status) values ('丸豐工具（示範）', 'flagship', 'active')
  returning id into v_co;

  -- 通路
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'shopee','蝦皮購物',11,'csv')   returning id into v_ch_sp;
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'ruten','露天拍賣',5,'csv')     returning id into v_ch_rt;
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'yahoo','Yahoo 拍賣',5.5,'csv') returning id into v_ch_yh;
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'social','社群私訊',0,'manual') returning id into v_ch_so;
  insert into channels (company_id, code, name, fee_rate, mode) values
    (v_co,'store','門市 POS',0,'builtin') returning id into v_ch_st;

  -- 分級價
  insert into price_tiers (company_id, name, discount_pct) values (v_co,'批發 A 級',-18) returning id into v_tier_a;
  insert into price_tiers (company_id, name, discount_pct) values (v_co,'批發 B 級',-12) returning id into v_tier_b;
  insert into price_tiers (company_id, name, discount_pct) values (v_co,'零售',0);

  -- 供應商
  insert into suppliers (company_id, name, payment_terms, lead_days) values
    (v_co,'協益五金行','月結 30 天',14) returning id into v_sup1;
  insert into suppliers (company_id, name, payment_terms, lead_days) values
    (v_co,'日昇刀具（進口商）','月結 45 天',21) returning id into v_sup2;
  insert into suppliers (company_id, name, payment_terms, lead_days) values
    (v_co,'永信木工機械','貨到付款',14) returning id into v_sup3;

  -- 商品
  insert into products (company_id, sku, name, category, spec, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'RL-SR800','SR-800 鋁合金導軌 800mm','導軌系統','800/1400/2000mm',1280,2180,10,10,v_sup3) returning id into p_rail;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'RB-TR6','鎢鋼修邊刀 6mm 柄','銑刀/刀具',210,380,15,20,v_sup2) returning id into p_bit;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'CL-F300','F 夾 300mm 重型','夾具',195,380,20,10,v_sup1) returning id into p_clamp;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'SB-165-48','軌道鋸片 165mm 48T','鋸片',520,880,12,6,v_sup2) returning id into p_blade;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'GL-250','太棒木工膠 250ml','耗材',145,240,20,v_sup1) returning id into p_glue;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'HP-OLD22','22型 手鉋（停產款）','手工具',680,1150,5,v_sup1) returning id into p_plane;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'DB-STD','除塵集塵袋','耗材',55,90,10,v_sup1) returning id into p_bag;
  insert into products (company_id, sku, name, category, is_bundle, cost, price) values
    (v_co,'KT-START','木工起始套組','套組',true,3460,5680) returning id into p_kit;

  insert into product_bundles (bundle_id, component_id, qty) values
    (p_kit, p_rail, 1), (p_kit, p_bit, 2), (p_kit, p_clamp, 4), (p_kit, p_glue, 2);

  -- 期初庫存（走帳本，不直改）
  insert into stock_movements (company_id, product_id, movement_type, qty, reason) values
    (v_co, p_rail, 'init', 6,  '期初盤點'),
    (v_co, p_bit,  'init', 8,  '期初盤點'),
    (v_co, p_clamp,'init', 11, '期初盤點'),
    (v_co, p_blade,'init', 9,  '期初盤點'),
    (v_co, p_glue, 'init', 64, '期初盤點'),
    (v_co, p_plane,'init', 17, '期初盤點'),
    (v_co, p_bag,  'init', 40, '期初盤點');

  -- 客戶
  insert into customers (company_id, name, phone, tier_id, source_channels, line_uid) values
    (v_co,'李師傅（李木工坊）','0912345678',v_tier_a,'{store,social}','demo-line-uid') returning id into v_cust1;
  insert into customers (company_id, name, phone, source_channels) values
    (v_co,'王明','0987654321','{shopee,yahoo}') returning id into v_cust2;
  insert into customers (company_id, name, source_channels) values (v_co,'林小姐','{social}');

  -- 範例訂單（蝦皮已付款待出貨）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_id, customer_name,
                      status, pay_status, subtotal, total, ship_method, source) values
    (v_co,'SP-260803-0192',v_ch_sp,'SP-260803-0192',v_cust2,'王明','pending','paid',2180,2180,'seven','csv')
  returning id into v_ord;
  insert into order_items (order_id, product_id, description, qty, unit_price, unit_cost) values
    (v_ord, p_rail, 'SR-800 導軌 800mm', 1, 2180, 1280);

  -- 門市完成單（批發價）
  insert into orders (company_id, order_no, channel_id, customer_id, customer_name,
                      status, pay_status, pay_method, subtotal, total, source, confirmed_at) values
    (v_co,'ST-260803-006',v_ch_st,v_cust1,'李師傅','completed','cod','現金',1140,1140,'pos', now())
  returning id into v_ord;
  insert into order_items (order_id, product_id, description, qty, unit_price, unit_cost) values
    (v_ord, p_bit, '鎢鋼修邊刀 6mm ×3（批發價）', 3, 380*0.82, 210);

  -- 社群待付款（組合品）
  insert into orders (company_id, order_no, channel_id, customer_name, status, pay_status,
                      subtotal, total, source, note) values
    (v_co,'FB-260803-002',v_ch_so,'林小姐（IG）','pending','transfer_pending',5680,5680,'social','含導軌裁切至 750mm，免加工費')
  returning id into v_ord;
  insert into order_items (order_id, product_id, description, qty, unit_price) values
    (v_ord, p_kit, '木工起始套組', 1, 5680);
end $$;
