-- ============================================================
-- 012_demo_showcase.sql · 展示型 DEMO 資料充實（丸豐工具（示範））
-- 目的：給客戶展示時每一頁都有豐富、合理的假資料
-- 冪等性：重跑前請先確認；本檔假設只跑一次
-- ============================================================
do $$
declare
  v_co uuid;
  v_sup1 uuid; v_sup2 uuid; v_sup3 uuid;
  v_ch_sp uuid; v_ch_rt uuid; v_ch_yh uuid; v_ch_so uuid; v_ch_st uuid;
  v_tier_a uuid; v_tier_b uuid;
  -- 既有商品
  p_rail uuid; p_bit uuid; p_clamp uuid; p_blade uuid; p_glue uuid; p_plane uuid; p_bag uuid; p_kit uuid;
  -- 新商品
  p_rail14 uuid; p_ro12 uuid; p_q150 uuid; p_sb210 uuid; p_sand uuid; p_wax uuid; p_dr35 uuid; p_kit2 uuid;
  -- 客戶
  c_li uuid; c_wang uuid; c_chen uuid; c_tainan uuid; c_chang uuid; c_kh uuid; c_wang2 uuid;
  v_ord uuid; v_po uuid; v_ret uuid; v_conv uuid;
  v_demo_uid uuid; v_xiang_uid uuid;
  i int; v_day int; v_no text;
  arr_prod uuid[]; arr_price numeric[]; arr_cost numeric[];
  v_pid uuid; v_qty int; v_sub numeric; v_fee numeric;
  arr_ch uuid[]; arr_fee numeric[]; v_ch uuid; v_frate numeric;
begin
  select id into v_co from companies where name = '丸豐工具（示範）';
  if v_co is null then raise exception '找不到示範租戶'; end if;

  select id into v_sup1 from suppliers where company_id=v_co and name='協益五金行';
  select id into v_sup2 from suppliers where company_id=v_co and name like '日昇%';
  select id into v_sup3 from suppliers where company_id=v_co and name='永信木工機械';
  select id into v_ch_sp from channels where company_id=v_co and code='shopee';
  select id into v_ch_rt from channels where company_id=v_co and code='ruten';
  select id into v_ch_yh from channels where company_id=v_co and code='yahoo';
  select id into v_ch_so from channels where company_id=v_co and code='social';
  select id into v_ch_st from channels where company_id=v_co and code='store';
  select id into v_tier_a from price_tiers where company_id=v_co and name='批發 A 級';
  select id into v_tier_b from price_tiers where company_id=v_co and name='批發 B 級';
  select id into p_rail  from products where company_id=v_co and sku='RL-SR800';
  select id into p_bit   from products where company_id=v_co and sku='RB-TR6';
  select id into p_clamp from products where company_id=v_co and sku='CL-F300';
  select id into p_blade from products where company_id=v_co and sku='SB-165-48';
  select id into p_glue  from products where company_id=v_co and sku='GL-250';
  select id into p_plane from products where company_id=v_co and sku='HP-OLD22';
  select id into p_bag   from products where company_id=v_co and sku='DB-STD';
  select id into p_kit   from products where company_id=v_co and sku='KT-START';

  -- ════ 1. 帳號：demo 展示帳號 + xiangdesigner 綁回示範租戶（皆 owner）════
  select id into v_demo_uid  from auth.users where email='demo@atlas.tw';
  select id into v_xiang_uid from auth.users where email='xiangdesigner@gmail.com';
  if v_demo_uid is not null then
    insert into profiles (id, display_name, company_id, role)
    values (v_demo_uid, '展示帳號', v_co, 'owner')
    on conflict (id) do update set company_id=excluded.company_id, role='owner', display_name='展示帳號', is_active=true;
  end if;
  if v_xiang_uid is not null then
    update profiles set company_id=v_co, role='owner', is_active=true where id=v_xiang_uid;
  end if;

  -- ════ 2. 補商品（合計 16 項，含第二個組合品）════
  insert into products (company_id, sku, name, category, spec, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'RL-SR1400','SR-1400 鋁合金導軌 1400mm','導軌系統','1400mm',1890,3280,6,5,v_sup3) returning id into p_rail14;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'RB-RO12','鎢鋼圓鼻刀 12mm 柄','銑刀/刀具',260,450,10,20,v_sup2) returning id into p_ro12;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'CL-Q150','快速夾 150mm','夾具',120,220,25,10,v_sup1) returning id into p_q150;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, box_size, supplier_id) values
    (v_co,'SB-210-60','軌道鋸片 210mm 60T','鋸片',640,1080,8,6,v_sup2) returning id into p_sb210;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'SP-120','砂紙 120 目（100 入）','耗材',180,320,15,v_sup1) returning id into p_sand;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'WX-500','天然木蠟油 500ml','耗材',380,680,12,v_sup1) returning id into p_wax;
  insert into products (company_id, sku, name, category, cost, price, safety_stock, supplier_id) values
    (v_co,'DR-35','鑽石管鑽 35mm','鑽孔',420,750,6,v_sup2) returning id into p_dr35;
  insert into products (company_id, sku, name, category, is_bundle, cost, price) values
    (v_co,'KT-PRO','木工進階套組','套組',true,5100,8280) returning id into p_kit2;
  insert into product_bundles (bundle_id, component_id, qty) values
    (p_kit2, p_rail14, 1), (p_kit2, p_sb210, 1), (p_kit2, p_clamp, 2), (p_kit2, p_wax, 1);

  -- 停產品標記（呆滯庫存示範）
  update products set status='discontinued' where id=p_plane;

  -- 期初庫存（新商品）
  insert into stock_movements (company_id, product_id, movement_type, qty, reason) values
    (v_co, p_rail14, 'init', 14, '期初盤點'),
    (v_co, p_ro12,   'init', 26, '期初盤點'),
    (v_co, p_q150,   'init', 48, '期初盤點'),
    (v_co, p_sb210,  'init', 15, '期初盤點'),
    (v_co, p_sand,   'init', 38, '期初盤點'),
    (v_co, p_wax,    'init', 22, '期初盤點'),
    (v_co, p_dr35,   'init', 9,  '期初盤點');

  -- ════ 3. 補客戶（含歸戶示範：同電話兩筆）════
  select id into c_li   from customers where company_id=v_co and name like '李師傅%';
  select id into c_wang from customers where company_id=v_co and name='王明';
  insert into customers (company_id, name, phone, source_channels) values
    (v_co,'陳建宏','0933111222','{shopee}') returning id into c_chen;
  insert into customers (company_id, name, phone, tier_id, source_channels, note) values
    (v_co,'台南木藝工作室','062223333',v_tier_b,'{social,store}','每月固定叫貨') returning id into c_tainan;
  insert into customers (company_id, name, phone, source_channels) values
    (v_co,'張淑芬','0955666777','{yahoo}') returning id into c_chang;
  insert into customers (company_id, name, phone, tier_id, source_channels, note) values
    (v_co,'高雄裝潢五金行','073334444',v_tier_a,'{store}','批發大戶，月結') returning id into c_kh;
  insert into customers (company_id, name, phone, source_channels) values
    (v_co,'王 明','0987654321','{ruten}') returning id into c_wang2;   -- 與王明同電話 → 歸戶建議

  -- ════ 4. 歷史完成訂單（近 14 天，撐起儀表板／報表曲線）════
  arr_prod  := array[p_rail, p_bit, p_clamp, p_blade, p_glue, p_bag, p_rail14, p_ro12, p_q150, p_sb210, p_sand, p_wax];
  arr_ch    := array[v_ch_sp, v_ch_rt, v_ch_yh, v_ch_st, v_ch_sp, v_ch_so];
  for i in 1..14 loop
    v_day := ((i * 5) % 13) + 1;                       -- 1~13 天前打散
    v_ch := arr_ch[(i % 6) + 1];
    select fee_rate into v_frate from channels where id = v_ch;
    v_pid := arr_prod[(i % 12) + 1];
    v_qty := (i % 3) + 1;
    select price * v_qty into v_sub from products where id = v_pid;
    v_fee := round(v_sub * v_frate / 100, 0);
    v_no := 'HS-2608' || lpad(i::text, 3, '0');
    insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                        subtotal, platform_fee, shipping_fee, total, ship_method, source, confirmed_at, created_at)
    values (v_co, v_no, v_ch, case when v_ch in (v_ch_sp, v_ch_rt, v_ch_yh) then '26' || lpad((81400000 + i * 137)::text, 8, '0') else '' end,
            (array['林小姐','陳建宏','張淑芬','王明','李師傅（李木工坊）','散客'])[(i % 6) + 1],
            'completed', case when v_ch = v_ch_st then 'cod' else 'paid' end,
            v_sub, v_fee, case when v_ch = v_ch_st then 0 else 60 end, v_sub + (case when v_ch = v_ch_st then 0 else 60 end),
            case when v_ch = v_ch_st then 'pickup' else (array['seven','tcat'])[(i % 2) + 1] end,
            case when v_ch = v_ch_st then 'pos' when v_ch = v_ch_so then 'social' else 'csv' end,
            now() - (v_day || ' days')::interval, now() - (v_day || ' days')::interval - '2 hours'::interval)
    returning id into v_ord;
    insert into order_items (order_id, product_id, qty, unit_price, unit_cost)
    select v_ord, v_pid, v_qty, price, cost from products where id = v_pid;
    insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, created_at)
    values (v_co, v_pid, 'sale', -v_qty, 'order', v_no, '銷售出庫', now() - (v_day || ' days')::interval);
  end loop;

  -- ════ 5. 進行中訂單（讓「訂單」「銷貨出貨」頁有戲）════
  -- 蝦皮 已付款待確認 ×2
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_id, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, created_at)
  values (v_co,'260825K3MNQ7',v_ch_sp,'260825K3MNQ7',c_chen,'陳建宏','pending','paid',3280,361,60,3340,'seven','csv',now() - '3 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_rail14, 1, 3280, 1890);

  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, created_at)
  values (v_co,'260825P8XWD2',v_ch_sp,'260825P8XWD2','蝦皮買家 s***2b','pending','paid',1140,125,60,1200,'seven','csv',now() - '5 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_bit, 3, 380, 210);

  -- 露天 未付款待確認
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_id, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, created_at)
  values (v_co,'RT26082501',v_ch_rt,'RT26082501',c_wang2,'王 明','pending','unpaid',880,44,80,960,'tcat','csv',now() - '8 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_blade, 1, 880, 520);

  -- 社群私訊單 轉帳待對帳（批發價）
  insert into orders (company_id, order_no, channel_id, customer_id, customer_name, status, pay_status, pay_method,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, note, created_at)
  values (v_co,'SO-2608-021',v_ch_so,c_tainan,'台南木藝工作室','pending','transfer_pending','bank',
          5916,0,0,5916,'tcat','social','批發 B 級 88 折；月結客戶',now() - '26 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values
    (v_ord, p_wax, 6, 598, 380), (v_ord, p_q150, 12, 194, 120);

  -- 已確認待出貨（蝦皮組合品）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, confirmed_at, created_at)
  values (v_co,'260824H6TRE9',v_ch_sp,'260824H6TRE9','蝦皮買家 w***8h','confirmed','paid',5680,625,0,5680,'seven','csv',
          now() - '20 hours'::interval, now() - '22 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_kit, 1, 5680, 3460);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason) values
    (v_co, p_kit,  'bundle_out', -1, 'order', '260824H6TRE9', '組合品銷售'),
    (v_co, p_rail, 'sale', -1, 'order', '260824H6TRE9', '組合零件扣庫'),
    (v_co, p_bit,  'sale', -2, 'order', '260824H6TRE9', '組合零件扣庫'),
    (v_co, p_clamp,'sale', -4, 'order', '260824H6TRE9', '組合零件扣庫'),
    (v_co, p_glue, 'sale', -2, 'order', '260824H6TRE9', '組合零件扣庫');

  -- 揀貨中（Yahoo）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_id, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, confirmed_at, created_at)
  values (v_co,'YH2608240033',v_ch_yh,'YH2608240033',c_chang,'張淑芬','picking','paid',1500,83,60,1560,'tcat','csv',
          now() - '18 hours'::interval, now() - '21 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_dr35, 2, 750, 420);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason)
  values (v_co, p_dr35, 'sale', -2, 'order', 'YH2608240033', '銷售出庫');

  -- 已包裝（露天）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, source, confirmed_at, created_at)
  values (v_co,'RT26082402',v_ch_rt,'RT26082402','露天買家 gooddiy','packed','paid',1320,66,80,1400,'seven','csv',
          now() - '30 hours'::interval, now() - '32 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_sand, 2, 320, 180), (v_ord, p_wax, 1, 680, 380);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason) values
    (v_co, p_sand, 'sale', -2, 'order', 'RT26082402', '銷售出庫'),
    (v_co, p_wax,  'sale', -1, 'order', 'RT26082402', '銷售出庫');

  -- 已出貨 ×2（有物流追蹤號）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, tracking_no, source, confirmed_at, created_at)
  values (v_co,'260823A1BCD5',v_ch_sp,'260823A1BCD5','蝦皮買家 h***9k','shipped','paid',2180,240,0,2180,'seven','TW2608912345',
          'csv', now() - '2 days'::interval, now() - '2 days'::interval - '3 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_rail, 1, 2180, 1280);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason)
  values (v_co, p_rail, 'sale', -1, 'order', '260823A1BCD5', '銷售出庫');

  insert into orders (company_id, order_no, channel_id, customer_id, customer_name, status, pay_status,
                      subtotal, platform_fee, shipping_fee, total, ship_method, tracking_no, source, confirmed_at, created_at)
  values (v_co,'SO-2608-019',v_ch_so,c_kh,'高雄裝潢五金行','shipped','paid',10740,0,0,10740,'tcat','903-2261-4457',
          'social', now() - '2 days'::interval, now() - '3 days'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values
    (v_ord, p_clamp, 20, 312, 195), (v_ord, p_q150, 25, 180, 120);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason) values
    (v_co, p_clamp, 'sale', -20, 'order', 'SO-2608-019', '批發出庫'),
    (v_co, p_q150,  'sale', -25, 'order', 'SO-2608-019', '批發出庫');

  -- 門市 POS 今日兩單
  insert into orders (company_id, order_no, channel_id, customer_id, customer_name, status, pay_status, pay_method,
                      subtotal, total, ship_method, source, confirmed_at, created_at)
  values (v_co,'POS-260825-001',v_ch_st,c_li,'李師傅（李木工坊）','completed','cod','cash',1739,1739,'pickup','pos',
          now() - '4 hours'::interval, now() - '4 hours'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values
    (v_ord, p_bit, 2, 312, 210), (v_ord, p_glue, 3, 197, 145), (v_ord, p_sand, 2, 262, 180);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason) values
    (v_co, p_bit, 'sale', -2, 'order', 'POS-260825-001', '門市銷售'),
    (v_co, p_glue,'sale', -3, 'order', 'POS-260825-001', '門市銷售'),
    (v_co, p_sand,'sale', -2, 'order', 'POS-260825-001', '門市銷售');

  insert into orders (company_id, order_no, channel_id, customer_name, status, pay_status, pay_method,
                      subtotal, total, ship_method, source, invoice_no, confirmed_at, created_at)
  values (v_co,'POS-260825-002',v_ch_st,'散客','completed','cod','card',1080,1080,'pickup','pos','AB26081234',
          now() - '90 minutes'::interval, now() - '90 minutes'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_sb210, 1, 1080, 640);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason)
  values (v_co, p_sb210, 'sale', -1, 'order', 'POS-260825-002', '門市銷售');
  insert into invoices (company_id, order_id, invoice_no, status, amount, env, issued_at)
  values (v_co, v_ord, 'AB26081234', 'issued', 1080, 'stage', now() - '85 minutes'::interval);

  -- 已取消 ×1
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, total, source, note, created_at)
  values (v_co,'260822C7QRS8',v_ch_sp,'260822C7QRS8','蝦皮買家 m***3p','cancelled','unpaid',380,42,380,'csv',
          '買家未付款自動取消', now() - '3 days'::interval);

  -- 退貨單（已收回 → 瑕疵倉）
  insert into orders (company_id, order_no, channel_id, platform_order_no, customer_name, status, pay_status,
                      subtotal, platform_fee, total, ship_method, source, confirmed_at, created_at)
  values (v_co,'260820F2GHJ4',v_ch_sp,'260820F2GHJ4','蝦皮買家 t***6w','returned','paid',880,97,880,'seven','csv',
          now() - '5 days'::interval, now() - '5 days'::interval)
  returning id into v_ord;
  insert into order_items (order_id, product_id, qty, unit_price, unit_cost) values (v_ord, p_blade, 1, 880, 520);
  insert into returns (company_id, return_no, order_id, reason, status, to_defect, created_at)
  values (v_co,'RT-2608-001',v_ord,'鋸片齒面碰傷（運送）','received',true, now() - '2 days'::interval)
  returning id into v_ret;
  insert into return_items (return_id, product_id, qty) values (v_ret, p_blade, 1);
  insert into stock_movements (company_id, product_id, movement_type, qty, zone, ref_type, ref_id, reason)
  values (v_co, p_blade, 'return_in', 1, 'defect', 'return', 'RT-2608-001', '退貨入瑕疵倉');

  -- ════ 6. 採購單：已收貨／已下單在途／草稿 ════
  insert into purchase_orders (company_id, po_no, supplier_id, status, total, paid, received_at, created_at)
  values (v_co,'PO-2608-001',v_sup2,'received',14380,true, now() - '5 days'::interval, now() - '12 days'::interval)
  returning id into v_po;
  insert into po_items (po_id, product_id, qty, unit_cost, received_qty) values
    (v_po, p_bit, 40, 205, 40), (v_po, p_blade, 12, 515, 12);
  insert into stock_movements (company_id, product_id, movement_type, qty, ref_type, ref_id, reason, created_at) values
    (v_co, p_bit,   'purchase', 40, 'po', 'PO-2608-001', '採購入庫', now() - '5 days'::interval),
    (v_co, p_blade, 'purchase', 12, 'po', 'PO-2608-001', '採購入庫', now() - '5 days'::interval);

  insert into purchase_orders (company_id, po_no, supplier_id, status, expected_at, total, created_at)
  values (v_co,'PO-2608-002',v_sup3,'ordered', (now() + '6 days'::interval)::date, 27060, now() - '4 days'::interval)
  returning id into v_po;
  insert into po_items (po_id, product_id, qty, unit_cost) values (v_po, p_rail14, 10, 1850), (v_po, p_rail, 5, 1260);

  insert into purchase_orders (company_id, po_no, supplier_id, status, total, note)
  values (v_co,'PO-2608-003',v_sup1,'draft',5040,'補貨建議自動產生（快速夾＋木蠟油）')
  returning id into v_po;
  insert into po_items (po_id, product_id, qty, unit_cost) values (v_po, p_q150, 20, 118), (v_po, p_wax, 7, 380);

  -- ════ 7. AI 客服：串接、知識庫、罐頭、對話、用量、額度 ════
  insert into cs_channel_connections (company_id, channel, mode, status) values
    (v_co,'line','auto','connected'),
    (v_co,'web','auto','connected'),
    (v_co,'messenger','copilot','connected'),
    (v_co,'shopee','copilot','disconnected')
  on conflict (company_id, channel) do nothing;

  insert into cs_kb_articles (company_id, title, content, tags) values
    (v_co,'運費與出貨時間','全館滿 NT$1,500 免運（離島除外）。工作日 15:00 前完成付款當日出貨，超過則隔日出貨。超商取貨 1–2 天到店，宅配 1–3 天到府。','{運費,出貨}'),
    (v_co,'導軌選購指南','SR-800 適合層板／小案件；SR-1400 適合門片與桌板；兩支可用連接片串接成 2200mm。搭配軌道鋸片 165mm 48T 切面最細。','{導軌,選購}'),
    (v_co,'退換貨政策','鑑賞期 7 天（拆封使用過恕不退）。瑕疵品免費換新，來回運費由本店負擔。刀具類拆封後基於安全不接受無理由退貨。','{退貨,換貨}'),
    (v_co,'批發合作','工作室／裝潢行月採購滿 NT$10,000 可申請批發價（88 折起），月結 30 天。加 LINE 官方帳號洽談。','{批發,合作}');

  insert into cs_canned_replies (company_id, keywords, reply) values
    (v_co,'{營業時間,幾點開}','您好！門市營業時間：週一至週六 09:00–18:00，週日公休。線上訂單 24 小時皆可下單喔！'),
    (v_co,'{到貨,出貨了嗎,什麼時候到}','幫您查詢囉！請提供訂單編號或收件人電話，馬上為您查出貨進度 📦'),
    (v_co,'{免運}','全館滿 NT$1,500 即享免運（離島除外）✨');

  -- 對話 1：LINE 全自動（查訂單 → SQL 階段）
  insert into cs_conversations (company_id, channel, external_uid, customer_id, status, last_message_at, created_at)
  values (v_co,'line','U4f8a…c21',c_chen,'ai', now() - '25 minutes'::interval, now() - '40 minutes'::interval)
  returning id into v_conv;
  insert into cs_messages (conversation_id, direction, sender, content, pipeline_stage, created_at) values
    (v_conv,'in','customer','你好 我昨天訂的導軌出貨了嗎','', now() - '40 minutes'::interval),
    (v_conv,'out','ai','您好！幫您查到訂單 260825K3MNQ7（SR-1400 導軌 ×1）目前狀態為「已付款・備貨中」，預計今日出貨、明後天到店，出貨後會再傳送取貨編號給您 📦','sql', now() - '39 minutes'::interval),
    (v_conv,'in','customer','好的 另外想問1400的軌可以接到2200嗎','', now() - '27 minutes'::interval),
    (v_conv,'out','ai','可以的！SR-800 與 SR-1400 都支援專用連接片串接，1400+800 即可達 2200mm，切門片綽綽有餘。連接片目前門市與蝦皮賣場都有現貨喔 😊','rag', now() - '25 minutes'::interval);

  -- 對話 2：官網 widget（知識庫 → 成交）
  insert into cs_conversations (company_id, channel, external_uid, status, last_message_at, created_at)
  values (v_co,'web','web-7fd2','closed', now() - '3 hours'::interval, now() - '4 hours'::interval)
  returning id into v_conv;
  insert into cs_messages (conversation_id, direction, sender, content, pipeline_stage, created_at) values
    (v_conv,'in','customer','請問滿多少免運？','', now() - '4 hours'::interval),
    (v_conv,'out','ai','全館滿 NT$1,500 即享免運（離島除外）✨','canned', now() - '4 hours'::interval),
    (v_conv,'in','customer','新手想做木凳 要買哪些東西','', now() - '3 hours'::interval - '10 minutes'::interval),
    (v_conv,'out','ai','推薦您「木工起始套組」（NT$5,680）：導軌 800mm＋修邊刀×2＋F夾×4＋木工膠×2，做木凳、層架都夠用，比單買省約 NT$800。需要的話我幫您保留一組？','rag', now() - '3 hours'::interval - '9 minutes'::interval),
    (v_conv,'in','customer','好 幫我留','', now() - '3 hours'::interval),
    (v_conv,'out','ai','已為您保留 1 組並建立訂單草稿，門市自取或宅配都可以，稍後店員會與您確認付款方式，感謝您 🙏','llm_big', now() - '3 hours'::interval);

  -- 對話 3：Messenger 副駕模式（轉真人）
  insert into cs_conversations (company_id, channel, external_uid, status, last_message_at, created_at)
  values (v_co,'messenger','fb-88h2','human', now() - '70 minutes'::interval, now() - '2 hours'::interval)
  returning id into v_conv;
  insert into cs_messages (conversation_id, direction, sender, content, pipeline_stage, created_at) values
    (v_conv,'in','customer','我上週買的鋸片有撞傷 要換貨','', now() - '2 hours'::interval),
    (v_conv,'out','system','［副駕建議草稿］瑕疵品免費換新、運費本店負擔；已比對訂單 260820F2GHJ4。建議轉真人確認照片。','handoff', now() - '2 hours'::interval + '1 minute'::interval),
    (v_conv,'out','agent','您好，很抱歉讓您遇到這個狀況！已為您安排免費換新，回程運費由我們負擔，麻煩提供商品照片讓我們跟物流反映，新品今天就幫您寄出 🙏','', now() - '70 minutes'::interval);

  -- 用量事件（近 10 天，示範成本儀表）
  for i in 1..36 loop
    insert into cs_usage_events (company_id, channel, model, stage, input_tokens, output_tokens, cached_tokens, cost_ntd, created_at)
    values (v_co,
            (array['line','web','messenger'])[(i % 3) + 1],
            case when i % 5 = 0 then 'claude-sonnet-4-5' else 'claude-haiku-4-5' end,
            (array['intent','rag','big','summary'])[(i % 4) + 1],
            800 + (i * 137) % 2200, 120 + (i * 53) % 380, (i * 211) % 1500,
            case when i % 5 = 0 then 0.9 + (i % 7) * 0.18 else 0.06 + (i % 9) * 0.02 end,
            now() - ((i * 6) % 240 || ' hours')::interval);
  end loop;

  -- 額度帳本：本月配額 +1000、AI 回覆扣點 −1 × 47
  insert into cs_quota_ledger (company_id, delta, reason, ref)
  values (v_co, 1000, 'monthly_grant', to_char(now(), 'YYYY-MM'));
  for i in 1..47 loop
    insert into cs_quota_ledger (company_id, delta, reason, created_at)
    values (v_co, -1, 'reply', now() - ((i * 5) % 240 || ' hours')::interval);
  end loop;

end $$;

select '012 OK · 展示資料就緒' as done;
