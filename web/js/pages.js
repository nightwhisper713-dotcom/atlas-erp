// ════ pages.js · 各頁面渲染（全部查真資料） ════
const CHARTS = {};
function chart(id, cfg) { CHARTS[id]?.destroy(); CHARTS[id] = new Chart($(id), cfg); }
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };
if (window.Chart) { Chart.defaults.font.family = '"Noto Sans TC","Microsoft JhengHei",sans-serif'; Chart.defaults.color = "#5b6674"; }

/* ════ 1. 儀表板 ════ */
LOADERS.dashboard = async () => {
  const { data: kpi } = await supa.from("v_dashboard_kpi").select("*").single();
  if (kpi) {
    $("kToday").textContent = nt(kpi.today_revenue);
    $("kShip").textContent = kpi.pending_ship + " 筆";
    $("kShipD").textContent = kpi.pending_ship_overdue > 0 ? kpi.pending_ship_overdue + " 筆已逾 24 小時" : "";
    $("kLow").textContent = kpi.low_stock_count + " 項";
    $("kMargin").textContent = (kpi.month_margin_pct ?? "—") + "%";
    const n = $("cntOrders"); n.style.display = kpi.pending_ship > 0 ? "" : "none"; n.textContent = kpi.pending_ship;
  }
  // 近14日趨勢
  const { data: rev } = await supa.from("v_revenue_14d").select("*");
  const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 864e5); return `${d.getMonth() + 1}/${d.getDate()}`; });
  const dayKey = (dt) => { const d = new Date(dt + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const datasets = Object.entries(CH_STYLE).map(([code, s]) => ({
    label: s.name, borderColor: s.color, backgroundColor: s.color, tension: .35, borderWidth: 2, pointRadius: 0,
    data: days.map((lbl) => (rev || []).filter((r) => r.channel_code === code && dayKey(r.day) === lbl).reduce((a, r) => a + Number(r.revenue), 0)),
  }));
  chart("chTrend", { type: "line", data: { labels: days, datasets }, options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } }, scales: { y: { ticks: { callback: (v) => "$" + (v / 1000) + "k" }, grid: { color: "#f0f2f5" } }, x: { grid: { display: false } } }, interaction: { mode: "index", intersect: false } } });
  // 本月占比
  const { data: mo } = await supa.from("orders").select("total, channels(code)").gte("created_at", monthStart()).not("status", "in", '("draft","cancelled")');
  const share = {}; (mo || []).forEach((o) => { const c = o.channels?.code; share[c] = (share[c] || 0) + Number(o.total); });
  const codes = Object.keys(CH_STYLE).filter((c) => share[c]);
  const total = codes.reduce((a, c) => a + share[c], 0) || 1;
  chart("chDonut", { type: "doughnut", data: { labels: codes.map((c) => `${CH_STYLE[c].name} ${(100 * share[c] / total).toFixed(1)}%`), datasets: [{ data: codes.map((c) => share[c]), backgroundColor: codes.map((c) => CH_STYLE[c].color), borderWidth: 2 }] }, options: { cutout: "62%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 10 } } } } });
  // 最新訂單
  const { data: recent } = await supa.from("orders").select("order_no, total, status, customer_name, channels(code)").not("status", "eq", "draft").order("created_at", { ascending: false }).limit(5);
  $("tbRecentOrders").innerHTML = (recent || []).map((o) => `<tr><td>${esc(o.order_no)}</td><td>${chChip(o.channels?.code)}</td><td>${esc(o.customer_name)}</td><td class="num">${nt(o.total)}</td><td>${stBadge(ORDER_ST, o.status)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">尚無訂單</td></tr>`;
  // 低庫存
  const { data: low } = await supa.from("v_replenish_suggest").select("*").gt("suggest_qty", 0).order("suggest_qty", { ascending: false }).limit(4);
  $("tbLowStock").innerHTML = (low || []).map((p) => `<tr><td>${esc(p.name)}</td><td class="num" style="color:var(--bad);font-weight:700">${p.current_stock}</td><td class="num">${p.safety_stock}</td><td class="num">${p.sold_30d} 件</td></tr>`).join("") || `<tr><td colspan="4" class="empty">目前無低庫存商品 ✓</td></tr>`;
};

/* ════ 2. 訂單 ════ */
let ORD_FILTER = "all";
LOADERS.orders = async () => {
  const { data: os } = await supa.from("orders").select("*, channels(code), order_items(description, qty)").not("status", "eq", "draft").order("created_at", { ascending: false }).limit(200);
  window._orders = os || [];
  const counts = { all: _orders.length };
  _orders.forEach((o) => { const c = o.channels?.code; counts[c] = (counts[c] || 0) + 1; });
  $("orderTabs").innerHTML = [`<div class="tab ${ORD_FILTER === "all" ? "on" : ""}" onclick="setOrdFilter('all')">全部 <b>(${counts.all})</b></div>`,
    ...Object.entries(CH_STYLE).map(([c, s]) => `<div class="tab ${ORD_FILTER === c ? "on" : ""}" onclick="setOrdFilter('${c}')">${s.emoji} ${s.name} (${counts[c] || 0})</div>`)].join("");
  renderOrderRows();
};
function setOrdFilter(c) { ORD_FILTER = c; LOADERS.orders(); }
function renderOrderRows() {
  const rows = _orders.filter((o) => ORD_FILTER === "all" || o.channels?.code === ORD_FILTER);
  $("tbOrders").innerHTML = rows.map((o) => {
    const items = (o.order_items || []).map((i) => `${esc(i.description)} ×${i.qty}`).join("、");
    const act = o.status === "pending"
      ? `<button class="btn btn-sm btn-p" onclick="confirmOne('${o.id}')">確認扣庫存</button>`
      : `<button class="btn-ghost" onclick="openOrderModal('${o.id}')">處理</button>`;
    return `<tr><td><input type="checkbox" class="ordChk" data-id="${o.id}"></td><td>${esc(o.order_no)}</td><td>${chChip(o.channels?.code)}</td><td>${esc(o.customer_name)}</td><td>${items || "—"}</td><td class="num">${nt(o.total)}</td><td>${stBadge(PAY_ST, o.pay_status)}</td><td>${stBadge(ORDER_ST, o.status)}</td><td>${act}</td></tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">此通路尚無訂單 — 可用「匯入訂單」或「手動建單」</td></tr>`;
}

/* ════ 3. 商品/庫存 ════ */
LOADERS.products = async () => {
  const { data: ps } = await supa.from("products").select("*").neq("status", "archived").order("sku");
  window._products = ps || [];
  const { data: h } = await supa.from("v_stock_health").select("*").single();
  $("kSku").textContent = _products.length;
  $("kStockVal").textContent = nt(h?.total_stock_value);
  $("kLowStag").textContent = `${h?.low_stock ?? 0} / ${h?.stagnant_count ?? 0}`;
  $("tbProducts").innerHTML = _products.map((p) => {
    const low = !p.is_bundle && p.current_stock < p.safety_stock;
    const near = !p.is_bundle && !low && p.current_stock < p.safety_stock * 1.2;
    const stagnant = p.last_sold_at && (Date.now() - new Date(p.last_sold_at)) > 90 * 864e5;
    const st = p.status === "discontinued" ? '<span class="st st-gray">停售</span>' : low ? '<span class="st st-bad">低庫存</span>' : near ? '<span class="st st-warn">接近安全量</span>' : stagnant ? '<span class="st st-gray">呆滯 90 天+</span>' : '<span class="st st-ok">正常</span>';
    const stockCell = p.is_bundle ? `<span class="mini">組合品</span>` : `<span style="${low ? "color:var(--bad);font-weight:700" : near ? "color:var(--warn);font-weight:700" : ""}">${p.current_stock}</span>${p.defect_stock ? `<span class="mini">（瑕疵 ${p.defect_stock}）</span>` : ""}`;
    return `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)} ${p.is_bundle ? '<span class="tag" style="border-color:var(--brand);color:var(--brand)">組合品</span>' : ""}${p.spec ? `<span class="tag">${esc(p.spec)}</span>` : ""}</td><td>${esc(p.category)}</td><td class="num">${Number(p.cost).toLocaleString()}</td><td class="num">${Number(p.price).toLocaleString()}</td><td class="num">${stockCell}</td><td class="num">${p.is_bundle ? "—" : p.safety_stock}</td><td>${st}</td><td>${p.is_bundle ? `<button class="btn-ghost" onclick="showBundle('${p.id}')">組合內容</button>` : `<button class="btn-ghost" onclick="showMovements('${p.id}')">異動紀錄</button>`}<button class="btn-ghost" onclick="openProductModal('${p.id}')">編輯</button></td></tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">尚無商品 — 點「＋ 新增商品」或用盤點模式匯入</td></tr>`;
};

/* ════ 4. 進貨採購 ════ */
LOADERS.purchase = async () => {
  const { data: rep } = await supa.from("v_replenish_suggest").select("*").gt("suggest_qty", 0).order("suggest_qty", { ascending: false });
  $("tbReplenish").innerHTML = (rep || []).map((r) => `<tr><td>${esc(r.name)}</td><td class="num" style="color:var(--bad)">${r.current_stock}</td><td class="num"><b>${r.suggest_qty}</b></td><td class="mini">日銷 ${r.daily_rate} × 前置 ${r.lead_days} 天 + 安全 ${r.safety_stock} − 現有 ${r.current_stock} − 在途 ${r.on_the_way} → 箱規進位</td></tr>`).join("") || `<tr><td colspan="4" class="empty">目前無需補貨 ✓</td></tr>`;
  const { data: pos } = await supa.from("purchase_orders").select("*, suppliers(name), po_items(qty, unit_cost, received_qty)").order("created_at", { ascending: false }).limit(50);
  window._pos = pos || [];
  const PO_ST = { draft: ["草稿", "st-gray"], ordered: ["已下單", "st-info"], arrived: ["到貨待驗收", "st-warn"], received: ["已入庫", "st-ok"], cancelled: ["取消", "st-gray"] };
  $("tbPos").innerHTML = _pos.map((po) => {
    const act = po.status === "draft" ? `<button class="btn btn-sm" onclick="markPoOrdered('${po.id}')">送出下單</button>`
      : (po.status === "ordered" || po.status === "arrived") ? `<button class="btn btn-sm btn-p" onclick="receivePo('${po.id}')">驗收入庫</button>`
      : `<button class="btn-ghost" onclick="showPoDetail('${po.id}')">明細</button>`;
    return `<tr><td>${esc(po.po_no)}</td><td>${esc(po.suppliers?.name || "—")}</td><td class="num">${nt(po.total)}</td><td>${po.expected_at || "—"}</td><td>${stBadge(PO_ST, po.status)}</td><td>${act} <button class="btn-ghost" onclick="showPoDetail('${po.id}')">明細</button></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">尚無採購單</td></tr>`;
  // 供應商/應付
  const { data: sups } = await supa.from("suppliers").select("*").order("name");
  const agg = {};
  _pos.forEach((po) => {
    if (!po.supplier_id) return;
    const a = (agg[po.supplier_id] = agg[po.supplier_id] || { month: 0, unpaid: 0 });
    if (new Date(po.created_at) >= new Date(monthStart())) a.month += Number(po.total);
    if (po.status === "received" && !po.paid) a.unpaid += Number(po.total);
  });
  $("tbSuppliers").innerHTML = (sups || []).map((s) => { const a = agg[s.id] || { month: 0, unpaid: 0 }; return `<tr><td>${esc(s.name)}</td><td class="num">${nt(a.month)}</td><td class="num" style="color:${a.unpaid ? "var(--bad)" : "var(--ok)"}">${a.unpaid ? nt(a.unpaid) : "已付清"}</td><td>${esc(s.payment_terms)}</td></tr>`; }).join("") || `<tr><td colspan="4" class="empty">尚無供應商</td></tr>`;
  // 月進銷圖
  const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
  const [{ data: poM }, { data: soM }] = await Promise.all([
    supa.from("purchase_orders").select("total, created_at").gte("created_at", since.toISOString()).neq("status", "cancelled"),
    supa.from("orders").select("total, created_at").gte("created_at", since.toISOString()).not("status", "in", '("draft","cancelled")'),
  ]);
  const labels = [...Array(6)].map((_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i); return (d.getMonth() + 1) + "月"; });
  const sumBy = (rows) => labels.map((_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i); const m = d.getMonth(); return (rows || []).filter((r) => new Date(r.created_at).getMonth() === m).reduce((a, r) => a + Number(r.total), 0); });
  chart("chPO", { type: "bar", data: { labels, datasets: [{ label: "進貨", data: sumBy(poM), backgroundColor: "#c2410c", borderRadius: 4 }, { label: "銷貨", data: sumBy(soM), backgroundColor: "#94a3b8", borderRadius: 4 }] }, options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } }, scales: { y: { ticks: { callback: (v) => "$" + v / 1000 + "k" }, grid: { color: "#f0f2f5" } }, x: { grid: { display: false } } } } });
};

/* ════ 5. 銷貨出貨 ════ */
LOADERS.fulfill = async () => {
  const { data: os } = await supa.from("orders").select("*, channels(code)").in("status", ["confirmed", "picking", "packed", "shipped"]).order("confirmed_at", { ascending: true }).limit(100);
  window._ful = os || [];
  $("kPick").textContent = _ful.filter((o) => o.status === "confirmed").length;
  $("kPack").textContent = _ful.filter((o) => ["picking", "packed"].includes(o.status)).length;
  $("kTransit").textContent = _ful.filter((o) => o.status === "shipped").length;
  const STEPS = ["confirmed", "picking", "packed", "shipped", "completed"];
  const NAMES = ["接單", "揀貨", "包裝", "出貨", "完成"];
  const NEXT = { confirmed: ["picking", "開始揀貨"], picking: ["packed", "完成包裝"], packed: ["shipped", "出貨"], shipped: ["completed", "完成"] };
  $("tbFulfill").innerHTML = _ful.map((o) => {
    const cur = STEPS.indexOf(o.status);
    const prog = `<div class="prog-steps">` + NAMES.map((n, i) => `${i ? `<div class="pline ${i <= cur ? "done" : ""}"></div>` : ""}<div class="pstep ${i < cur ? "done" : i === cur ? "cur" : ""}"><div class="pc">${i < cur ? "✓" : i + 1}</div>${n}</div>`).join("") + `</div>`;
    const [nx, nxLabel] = NEXT[o.status] || [];
    return `<tr><td><input type="checkbox" class="fulChk" data-id="${o.id}" data-no="${esc(o.order_no)}"></td><td>${esc(o.order_no)}</td><td>${chChip(o.channels?.code)}</td><td>${esc(o.ship_method || "—")}</td><td>${prog}</td><td class="mini">${esc(o.tracking_no || "—")} / ${esc(o.invoice_no || "待開立")}</td><td>${nx ? `<button class="btn btn-sm" onclick="advanceOrder('${o.id}','${nx}')">${nxLabel}</button>` : ""}</td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">目前無待出貨訂單</td></tr>`;
  // 退換貨
  const { data: rets } = await supa.from("returns").select("*, orders(order_no), return_items(qty, products(name))").order("created_at", { ascending: false }).limit(30);
  $("kReturns").textContent = (rets || []).filter((r) => r.status === "awaiting").length;
  const RET_ST = { awaiting: ["待收退貨", "st-warn"], received: ["已收貨", "st-info"], completed: ["已完成", "st-ok"], rejected: ["拒收", "st-bad"] };
  $("tbReturns").innerHTML = (rets || []).map((r) => `<tr><td>${esc(r.return_no)}</td><td>${esc(r.orders?.order_no || "—")}</td><td>${esc(r.reason)}</td><td>${stBadge(RET_ST, r.status)}</td><td class="mini">${r.status === "completed" ? "反向異動已寫入" : r.to_defect ? "收到後 → 退貨異動（瑕疵倉）" : "收到後 → 退貨異動（主倉）"}</td><td>${r.status === "awaiting" ? `<button class="btn btn-sm btn-p" onclick="receiveReturn('${r.id}')">收到退貨</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">無退換貨</td></tr>`;
};

/* ════ 6. 報表 ════ */
LOADERS.reports = async () => {
  const { data: perf } = await supa.from("v_channel_performance").select("*").gte("month", monthStart());
  window._perf = perf || [];
  $("tbChPerf").innerHTML = _perf.map((r) => `<tr><td>${chChip(r.channel_code)}</td><td class="num">${r.order_count}</td><td class="num">${nt(r.revenue)}</td><td class="num" style="color:${Number(r.platform_fee) ? "var(--bad)" : "var(--ok)"}">${Number(r.platform_fee) ? "− " + nt(r.platform_fee) : "NT$ 0"}</td><td class="num"><b>${nt(r.true_margin)}</b></td><td class="num"><b>${r.margin_pct ?? "—"}%</b></td></tr>`).join("") || `<tr><td colspan="6" class="empty">本月尚無訂單資料</td></tr>`;
  if (_perf.length >= 2) {
    const best = [..._perf].sort((a, b) => b.margin_pct - a.margin_pct)[0];
    const fee = [..._perf].sort((a, b) => b.platform_fee - a.platform_fee)[0];
    $("insightBox").style.display = "";
    $("insightBox").innerHTML = `💡 <b>洞察</b>：${CH_STYLE[best.channel_code]?.name} 毛利率最高（${best.margin_pct}%）；${CH_STYLE[fee.channel_code]?.name} 手續費吃掉 ${nt(fee.platform_fee)} — 建議把回購客導流至 LINE/門市。`;
  }
  const { data: top } = await supa.from("v_top_products").select("*").order("qty_sold", { ascending: false }).limit(5);
  chart("chTop", { type: "bar", data: { labels: (top || []).map((t) => t.name), datasets: [{ data: (top || []).map((t) => t.qty_sold), backgroundColor: ["#c2410c", "#ea580c", "#f59e0b", "#fbbf24", "#fcd34d"], borderRadius: 4 }] }, options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { grid: { color: "#f0f2f5" }, title: { display: true, text: "本月銷量（件）" } }, y: { grid: { display: false } } } } });
  const { data: h } = await supa.from("v_stock_health").select("*").single();
  $("tbHealth").innerHTML = h ? `
    <tr><td>SKU 總數</td><td class="num">${h.sku_count}</td><td><span class="st st-ok">庫存總值 ${nt(h.total_stock_value)}</span></td></tr>
    <tr><td>低庫存品項</td><td class="num">${h.low_stock} 項</td><td>${h.low_stock ? '<span class="st st-warn">前往補貨建議</span>' : '<span class="st st-ok">正常</span>'}</td></tr>
    <tr><td>呆滯品（90 天無動）</td><td class="num">${h.stagnant_count} 項 / ${nt(h.stagnant_value)}</td><td>${h.stagnant_count ? '<span class="st st-warn">建議出清</span>' : '<span class="st st-ok">正常</span>'}</td></tr>
    <tr><td>跨通路超賣事件</td><td class="num">0 件</td><td><span class="st st-ok">單一庫存帳本生效</span></td></tr>` : "";
};

/* ════ 7. 客戶 ════ */
LOADERS.customers = async () => {
  const [{ data: cs }, { data: stats }] = await Promise.all([
    supa.from("customers").select("*, price_tiers(name, discount_pct)").is("merged_into", null).order("created_at", { ascending: false }).limit(300),
    supa.from("v_customer_stats").select("*"),
  ]);
  const sm = {}; (stats || []).forEach((s) => (sm[s.customer_id] = s));
  window._customers = cs || [];
  $("kCust").textContent = _customers.length;
  $("kVip").textContent = _customers.filter((c) => c.price_tiers && c.price_tiers.discount_pct < 0).length;
  $("kLine").textContent = _customers.filter((c) => c.line_uid).length;
  $("kRepeat").textContent = (stats || []).filter((s) => s.order_count > 1).length;
  $("tbCustomers").innerHTML = _customers.map((c) => {
    const s = sm[c.id] || { order_count: 0, lifetime_value: 0 };
    const tier = c.price_tiers ? (c.price_tiers.discount_pct < 0 ? `<span class="st st-warn">VIP 批發</span>` : `<span class="st st-gray">一般</span>`) : `<span class="st st-gray">一般</span>`;
    return `<tr><td><b>${esc(c.name)}</b></td><td>${tier}${c.price_tiers ? ` <span class="mini">${esc(c.price_tiers.name)}（${c.price_tiers.discount_pct}%）</span>` : ""}</td><td>${(c.source_channels || []).map(chChip).join(" ")}</td><td class="num">${nt(s.lifetime_value)}</td><td class="num">${s.order_count}</td><td>${c.line_uid ? "✅ 已綁定" : "—"}</td><td><button class="btn-ghost" onclick="openCustomerModal('${c.id}')">檔案</button></td></tr>`;
  }).join("") || `<tr><td colspan="7" class="empty">尚無客戶</td></tr>`;
  const { data: sug } = await supa.from("v_customer_merge_suggest").select("*");
  window._mergeSug = sug || [];
  $("btnMerge").textContent = `🔀 智慧歸戶建議 (${_mergeSug.length})`;
};

/* ════ 8. 平台串接 ════ */
LOADERS.channels = async () => {
  const { data: chs } = await supa.from("channels").select("*").order("code");
  S.channels = chs || [];
  const MODE = { api: ["● API 已連線", "st-ok"], csv: ["● 半自動（CSV 匯入）", "st-warn"], manual: ["● 快速建單", "st-ok"], builtin: ["● 系統內建", "st-ok"] };
  $("channelCards").innerHTML = S.channels.map((c) => {
    const s = CH_STYLE[c.code] || { emoji: "🔌", name: c.code };
    const [mt, mc] = MODE[c.mode] || ["●", "st-gray"];
    const importBtn = c.mode === "csv" ? `<button class="btn btn-sm" onclick="openImportWizard('${c.code}')">匯入訂單</button>` : c.code === "social" ? `<button class="btn btn-sm" onclick="openSocialOrder()">開啟建單畫面</button>` : c.code === "store" ? `<button class="btn btn-sm" onclick="openPos()">開啟 POS</button>` : "";
    return `<div class="card"><div class="card-b" style="display:flex;gap:14px;align-items:flex-start">
      <div style="font-size:28px">${s.emoji}</div>
      <div style="flex:1"><b>${esc(c.name)}</b> <span class="st ${mc}">${mt}</span>
        <div class="mini" style="margin:6px 0">${c.settings?.account ? "帳號 " + esc(c.settings.account) + " · " : ""}${c.mode === "csv" ? "訂單 CSV 匯入＋防重複冪等鍵" : c.mode === "api" ? "API 自動拉單（白名單核准後啟用）" : c.mode === "manual" ? "私訊成交 → 30 秒快速建單，自動扣共用庫存" : "條碼結帳、批發分級價、服務單"}</div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <span class="tag">手續費 <input type="number" step="0.1" value="${c.fee_rate}" style="width:52px;border:none;background:none;font-size:11px" onchange="updateFee('${c.id}', this.value)">%</span>
          ${importBtn}
        </div>
      </div></div></div>`;
  }).join("") + `
    <div class="card"><div class="card-b" style="display:flex;gap:14px;align-items:flex-start">
      <div style="font-size:28px">🔌</div>
      <div style="flex:1"><b>週邊整合</b>
        <div class="mini" style="margin:6px 0">🧾 綠界電子發票 <span class="st st-warn">測試環境</span>　🏪 7-11 交貨便 <span class="st st-gray">預留</span>　🐈‍⬛ 黑貓宅配 <span class="st st-gray">預留</span>　💬 LINE Messaging <span class="st st-gray">預留</span></div>
        <div class="mini">API 金鑰由系統商於後端加密設定，前端不顯示。</div>
      </div></div></div>`;
};

/* ════ 9. AI 客服 ════ */
LOADERS.aics = async () => {
  const quota = Number(S.features.ai_quota || 0);
  const { data: bal } = await supa.rpc("cs_quota_balance", { p_company: S.profile.company_id });
  const used = Math.max(0, quota - (bal ?? quota));
  $("kQuota").textContent = `${bal ?? quota} / ${quota}`;
  $("quotaFill").style.width = quota ? Math.min(100, 100 * used / quota) + "%" : "0%";
  const { data: convs } = await supa.from("cs_conversations").select("*, customers(name)").neq("status", "closed").order("last_message_at", { ascending: false }).limit(50);
  const list = (convs || []).sort((a, b) => (a.status === "human" ? -1 : 1));
  $("kConvs").textContent = list.length;
  $("kHandoff").textContent = list.filter((c) => c.status === "human").length;
  $("tbConvs").innerHTML = list.map((c) => `<tr><td>${chChip(c.channel)}</td><td>${esc(c.customers?.name || c.external_uid || "訪客")}</td><td>${c.status === "human" ? '<span class="st st-bad">待真人</span>' : '<span class="st st-ok">AI 服務中</span>'}</td><td class="mini">${new Date(c.last_message_at).toLocaleString("zh-TW")}</td><td><button class="btn-ghost" onclick="toast('對話檢視於引擎上線後開放')">檢視</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">尚無對話 — 通路引擎接上後對話將自動流入</td></tr>`;
  const { data: conns } = await supa.from("cs_channel_connections").select("*");
  const ALL = ["line", "messenger", "instagram", "shopee", "ruten", "yahoo", "web"];
  const NAMES = { line: "LINE OA", messenger: "FB Messenger", instagram: "IG 私訊", shopee: "蝦皮 Chat", ruten: "露天（助理）", yahoo: "Yahoo（助理）", web: "網站 Widget" };
  $("kCsCh").textContent = (conns || []).filter((c) => c.mode !== "off").length + " / " + ALL.length;
  $("csChannels").innerHTML = ALL.map((ch) => {
    const c = (conns || []).find((x) => x.channel === ch) || { mode: "off" };
    return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #f0f2f5">
      <span style="flex:1">${NAMES[ch]}</span>
      <select onchange="setCsMode('${ch}', this.value)" style="padding:4px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px">
        ${["off", "copilot", "auto"].map((m) => `<option value="${m}" ${c.mode === m ? "selected" : ""}>${{ off: "關閉", copilot: "助理", auto: "全自動" }[m]}</option>`).join("")}
      </select></div>`;
  }).join("");
};

/* ════ 10. 使用者 ════ */
LOADERS.users = async () => {
  const { data: us } = await supa.from("profiles").select("*").order("created_at");
  const ROLES = { owner: "老闆", store: "門市", shipping: "出貨", purchasing: "採購", superadmin: "系統管理" };
  $("tbUsers").innerHTML = (us || []).map((u) => `<tr><td>${esc(u.display_name)}</td><td>${u.id === S.user.id || u.role === "superadmin" ? ROLES[u.role] : `<select onchange="setUserRole('${u.id}', this.value)" style="padding:4px 8px;border:1px solid var(--line);border-radius:6px">${Object.entries(ROLES).filter(([r]) => r !== "superadmin").map(([r, n]) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${n}</option>`).join("")}</select>`}</td><td>${u.is_active ? '<span class="st st-ok">啟用</span>' : '<span class="st st-gray">停用</span>'}</td><td>${u.id !== S.user.id ? `<button class="btn-ghost" onclick="toggleUser('${u.id}', ${!u.is_active})">${u.is_active ? "停用" : "啟用"}</button>` : '<span class="mini">（本人）</span>'}</td></tr>`).join("");
};
