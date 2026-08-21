// ════ actions.js · 互動操作：建單/POS/CSV 匯入/採購/出貨/發票/盤點… ════

async function ensureProducts() {
  if (!window._products) { const { data } = await supa.from("products").select("*").eq("status", "active").order("sku"); window._products = data || []; }
  return _products;
}
async function ensureCustomers() {
  if (!window._customers) { const { data } = await supa.from("customers").select("*, price_tiers(name, discount_pct)").is("merged_into", null); window._customers = data || []; }
  return _customers;
}
function tierPrice(p, cust) {
  const d = cust?.price_tiers?.discount_pct || 0;
  return Math.round(Number(p.price) * (1 + d / 100));
}

/* ── 訂單確認 ── */
async function confirmOne(id) {
  const { error } = await supa.rpc("confirm_order", { p_order: id });
  toast(error ? "⚠️ " + error.message : "✅ 已確認 — 庫存異動已寫入（只扣一次）");
  LOADERS.orders();
}
async function batchConfirm() {
  const ids = [...document.querySelectorAll(".ordChk:checked")].map((c) => c.dataset.id);
  if (!ids.length) return toast("請先勾選要確認的訂單");
  const { data, error } = await supa.rpc("confirm_orders", { p_ids: ids });
  toast(error ? "⚠️ " + error.message : `✅ 批次確認完成：${data} 筆已扣庫存`);
  LOADERS.orders();
}

/* ── 訂單處理 Modal ── */
async function openOrderModal(id) {
  const { data: o } = await supa.from("orders").select("*, channels(code, name), order_items(*, products(sku, name, current_stock, safety_stock))").eq("id", id).single();
  if (!o) return;
  const rows = (o.order_items || []).map((i) => `<tr><td>${esc(i.description || i.products?.name)}</td><td class="num">${i.qty}</td><td class="num">${Number(i.unit_price).toLocaleString()}</td><td class="num">${(i.qty * i.unit_price).toLocaleString()}</td></tr>`).join("");
  openModal(`
    <div class="card-h"><h3>訂單處理 · ${esc(o.order_no)}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <table style="margin-bottom:12px"><tr><th>商品</th><th class="num">數量</th><th class="num">單價</th><th class="num">小計</th></tr>${rows}</table>
      <div class="mini" style="margin-bottom:10px">${chChip(o.channels?.code)} ${esc(o.customer_name)} · ${esc(o.ship_method || "未選物流")} · ${stBadge(PAY_ST, o.pay_status)} ${o.platform_fee > 0 ? `（手續費 −${nt(o.platform_fee)} 自動入帳）` : ""}</div>
      ${o.status === "pending" ? `<div class="callout" style="margin-bottom:12px">確認後寫入銷售異動並扣共用庫存（冪等，只扣一次）。</div>` : `<div class="callout" style="margin-bottom:12px">狀態：${ORDER_ST[o.status]?.[0]}。庫存異動已寫入稽核紀錄。</div>`}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button class="btn" onclick="printOrders(['${o.id}'])">🖨️ 列印揀貨單</button>
        ${o.status === "pending" ? `<button class="btn btn-p" onclick="closeModal();confirmOne('${o.id}')">確認扣庫存</button>` : ""}
        ${["confirmed", "picking", "packed"].includes(o.status) ? `<button class="btn btn-p" onclick="closeModal();advanceOrder('${o.id}','shipped')">標記出貨</button>` : ""}
        ${["shipped", "completed"].includes(o.status) && !o.invoice_no ? `<button class="btn" onclick="closeModal();invoiceOne('${o.id}')">🧾 開立發票</button>` : ""}
        ${["pending", "confirmed"].includes(o.status) ? `<button class="btn" style="color:var(--bad)" onclick="cancelOrder('${o.id}')">取消訂單</button>` : ""}
      </div>
    </div>`);
}
async function cancelOrder(id) {
  const reason = prompt("取消原因？"); if (reason === null) return;
  const { error } = await supa.rpc("cancel_order", { p_order: id, p_reason: reason || "" });
  toast(error ? "⚠️ " + error.message : "已取消並回沖庫存"); closeModal(); LOADERS.orders();
}
async function advanceOrder(id, status) {
  let tracking = "";
  if (status === "shipped") tracking = prompt("追蹤號（可留空）") || "";
  const { error } = await supa.rpc("advance_order", { p_order: id, p_status: status, p_tracking: tracking });
  toast(error ? "⚠️ " + error.message : "✅ 狀態已更新");
  LOADERS.fulfill?.(); if (document.querySelector("#page-orders.show")) LOADERS.orders();
}

/* ── 社群/手動建單 ── */
async function openSocialOrder() {
  await ensureProducts(); await ensureCustomers();
  const prodOpts = _products.filter((p) => !p.is_bundle || true).map((p) => `<option value="${p.id}">${esc(p.sku)} ${esc(p.name)}（$${p.price}｜存 ${p.is_bundle ? "組合" : p.current_stock}）</option>`).join("");
  const custOpts = `<option value="">— 散客 / 新客 —</option>` + _customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.price_tiers ? "（" + esc(c.price_tiers.name) + "）" : ""}</option>`).join("");
  openModal(`
    <div class="card-h"><h3>＋ 社群私訊快速建單</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>來源</label><select id="soSrc"><option value="FB">Facebook 私訊</option><option value="IG">Instagram 私訊</option><option value="LN">LINE</option><option value="TEL">電話</option></select></div>
      <div class="field"><label>客戶（既有會員自動帶分級價）</label><select id="soCust">${custOpts}</select></div>
      <div class="field"><label>新客姓名（未選會員時填）</label><input id="soCustName" placeholder="例：林小姐（IG @lin.wood.diy）"></div>
      <div class="field"><label>商品</label><select id="soProd">${prodOpts}</select></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>數量</label><input id="soQty" type="number" value="1" min="1"></div><div style="flex:1"><label>單價（自動帶入，可改＝客製報價）</label><input id="soPrice" type="number"></div></div>
      <div class="field"><label>客製報價 / 備註</label><textarea id="soNote" rows="2"></textarea></div>
      <div class="field"><label>付款方式</label><select id="soPay"><option value="transfer_pending">銀行轉帳（待對帳）</option><option value="paid">已收款（LINE Pay 等）</option><option value="unpaid">門市自取付款</option></select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="createSocialOrder()">建立訂單</button></div>
    </div>`);
  const syncPrice = () => {
    const p = _products.find((x) => x.id === $("soProd").value);
    const c = _customers.find((x) => x.id === $("soCust").value);
    if (p) $("soPrice").value = tierPrice(p, c);
  };
  $("soProd").onchange = syncPrice; $("soCust").onchange = syncPrice; syncPrice();
}
async function createSocialOrder() {
  const p = _products.find((x) => x.id === $("soProd").value);
  const custId = $("soCust").value || null;
  const cust = _customers.find((x) => x.id === custId);
  const qty = +$("soQty").value, price = +$("soPrice").value;
  const ch = S.channels.find((c) => c.code === "social");
  const { data: no } = await supa.rpc("next_order_no", { p_prefix: $("soSrc").value });
  const { data: ord, error } = await supa.from("orders").insert({
    company_id: S.profile.company_id, order_no: no, channel_id: ch.id, customer_id: custId,
    customer_name: cust?.name || $("soCustName").value || "散客",
    status: "pending", pay_status: $("soPay").value === "paid" ? "paid" : $("soPay").value,
    subtotal: qty * price, total: qty * price, source: "social", note: $("soNote").value,
  }).select("id").single();
  if (error) return toast("⚠️ " + error.message);
  await supa.from("order_items").insert({ order_id: ord.id, product_id: p.id, description: p.name, qty, unit_price: price });
  toast(`✅ 訂單 ${no} 已建立 — 確認付款後點「確認扣庫存」即進入出貨佇列`);
  closeModal(); LOADERS.orders();
}

/* ── 門市 POS ── */
let POS_CART = [];
async function openPos() {
  await ensureProducts(); await ensureCustomers(); POS_CART = [];
  openModal(`
    <div class="card-h"><h3>🖥️ 門市 POS 結帳</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>客戶（帶分級價）</label><select id="posCust" onchange="renderPosCart()"><option value="">散客（零售價）</option>${_customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.price_tiers ? "（" + esc(c.price_tiers.name) + " " + c.price_tiers.discount_pct + "%）" : ""}</option>`).join("")}</select></div>
      <div class="field"><label>掃碼 / 輸入 SKU 或名稱後按 Enter</label><input id="posScan" placeholder="條碼掃描器直接掃即可" autofocus></div>
      <div class="pos-cart"><table><thead><tr><th>商品</th><th class="num">數量</th><th class="num">單價</th><th class="num">小計</th><th></th></tr></thead><tbody id="posCartBody"><tr><td colspan="5" class="empty">尚無商品</td></tr></tbody></table><div class="pos-total" id="posTotal">NT$ 0</div></div>
      <div class="field" style="margin-top:12px"><label>付款方式</label><select id="posPay"><option>現金</option><option>轉帳</option><option>刷卡</option></select></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" onclick="posAddService()">＋ 服務項目（研磨/維修）</button>
        <button class="btn btn-p" onclick="posCheckout()">結帳（扣庫存＋完成）</button>
      </div>
    </div>`);
  $("posScan").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase(); e.target.value = "";
    const p = _products.find((x) => x.barcode === q || x.sku.toLowerCase() === q) || _products.find((x) => x.name.toLowerCase().includes(q));
    if (!p) return toast("找不到商品：" + q);
    const ex = POS_CART.find((i) => i.product_id === p.id);
    if (ex) ex.qty++; else POS_CART.push({ product_id: p.id, description: p.name, qty: 1, base: p });
    renderPosCart();
  });
}
function renderPosCart() {
  const cust = _customers.find((x) => x.id === $("posCust").value);
  let total = 0;
  $("posCartBody").innerHTML = POS_CART.map((i, idx) => {
    const price = i.is_service ? i.unit_price : tierPrice(i.base, cust);
    i.unit_price = price; total += price * i.qty;
    return `<tr><td>${esc(i.description)}${i.is_service ? ' <span class="tag">服務單</span>' : ""}</td><td class="num"><input type="number" value="${i.qty}" min="1" style="width:52px" onchange="POS_CART[${idx}].qty=+this.value;renderPosCart()"></td><td class="num">${price.toLocaleString()}</td><td class="num">${(price * i.qty).toLocaleString()}</td><td><button class="btn-ghost" onclick="POS_CART.splice(${idx},1);renderPosCart()">✕</button></td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">尚無商品</td></tr>`;
  $("posTotal").textContent = nt(total);
}
function posAddService() {
  const name = prompt("服務項目名稱（例：研磨服務：鉋刀）"); if (!name) return;
  const price = +prompt("金額") || 0;
  POS_CART.push({ product_id: null, description: name, qty: 1, unit_price: price, is_service: true });
  renderPosCart();
}
async function posCheckout() {
  if (!POS_CART.length) return toast("購物車是空的");
  const items = POS_CART.map((i) => ({ product_id: i.product_id, description: i.description, qty: i.qty, unit_price: i.unit_price, is_service: !!i.is_service }));
  const { data: no, error } = await supa.rpc("pos_checkout", { p_items: items, p_customer: $("posCust").value || null, p_pay_method: $("posPay").value });
  if (error) return toast("⚠️ " + error.message);
  toast(`✅ ${no} 結帳完成 — 庫存已扣、訂單已完成`);
  closeModal(); window._products = null;
  if (document.querySelector("#page-orders.show")) LOADERS.orders();
}

/* ── CSV 匯入精靈 ── */
const CSV_FIELDS = [["platform_order_no", "平台訂單編號 *"], ["customer_name", "買家/收件人"], ["sku", "商品 SKU（對庫存）"], ["description", "商品名稱"], ["qty", "數量"], ["unit_price", "單價"], ["total", "訂單總額"], ["ship_method", "物流方式"]];
let CSV_STATE = null;
function openImportWizard(chCode) {
  const csvChs = S.channels.filter((c) => c.mode === "csv");
  openModal(`
    <div class="card-h"><h3>⟳ 匯入訂單（CSV）</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>通路</label><select id="impCh">${csvChs.map((c) => `<option value="${c.id}" ${c.code === chCode ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="wizard-drop" onclick="$('impFile').click()">📄 點此選擇平台匯出的訂單 CSV 檔<br><span class="mini">v1 支援通用欄位格式；取得平台實際樣本後可存為預設對映</span></div>
      <input type="file" id="impFile" accept=".csv,.txt" style="display:none" onchange="parseCsv(this.files[0])">
      <div id="impMap" style="margin-top:14px"></div>
      <div id="impPreview" style="margin-top:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" id="impGo" style="display:none" onclick="runImport()">匯入</button></div>
    </div>`);
}
function parseCsv(file) {
  if (!file) return;
  Papa.parse(file, {
    header: true, skipEmptyLines: true,
    complete: (res) => {
      CSV_STATE = { rows: res.data, cols: res.meta.fields || [] };
      const guess = (f) => CSV_STATE.cols.find((c) => ({ platform_order_no: /單號|編號|order/i, customer_name: /買家|收件|姓名|customer/i, sku: /sku|貨號|款號/i, description: /商品|品名|name/i, qty: /數量|qty/i, unit_price: /單價|price/i, total: /總額|總金額|total/i, ship_method: /物流|配送|運送/i }[f] || /$^/).test(c)) || "";
      $("impMap").innerHTML = `<b style="font-size:13px">欄位對映</b>` + CSV_FIELDS.map(([f, label]) => `<div class="map-row"><span>${label}</span><span>←</span><select id="map_${f}"><option value="">（無）</option>${CSV_STATE.cols.map((c) => `<option ${guess(f) === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>`).join("");
      $("impPreview").innerHTML = `<div class="mini">共 ${CSV_STATE.rows.length} 列 · 前 3 列預覽：</div><div class="preview-box"><table><thead><tr>${CSV_STATE.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${CSV_STATE.rows.slice(0, 3).map((r) => `<tr>${CSV_STATE.cols.map((c) => `<td class="mini">${esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      $("impGo").style.display = "";
    },
  });
}
async function runImport() {
  if (!CSV_STATE) return;
  const m = {}; CSV_FIELDS.forEach(([f]) => (m[f] = $("map_" + f).value));
  if (!m.platform_order_no) return toast("⚠️ 必須對映「平台訂單編號」");
  const chId = $("impCh").value;
  await ensureProducts();
  // 依單號分組
  const groups = {};
  CSV_STATE.rows.forEach((r) => {
    const no = String(r[m.platform_order_no] || "").trim(); if (!no) return;
    (groups[no] = groups[no] || []).push(r);
  });
  const nos = Object.keys(groups);
  // 防重複：查已存在的平台單號
  const { data: exist } = await supa.from("orders").select("platform_order_no").eq("channel_id", chId).in("platform_order_no", nos);
  const dup = new Set((exist || []).map((e) => e.platform_order_no));
  let ok = 0, skip = 0, fail = 0;
  for (const no of nos) {
    if (dup.has(no)) { skip++; continue; }
    const rows = groups[no];
    const items = rows.map((r) => {
      const sku = String(r[m.sku] || "").trim();
      const prod = sku ? _products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) : null;
      const qty = Math.max(1, parseInt(r[m.qty]) || 1);
      const price = parseFloat(String(r[m.unit_price] || "").replace(/[^0-9.]/g, "")) || 0;
      return { product_id: prod?.id || null, description: String(r[m.description] || sku || "匯入商品"), qty, unit_price: price };
    });
    const total = parseFloat(String(rows[0][m.total] || "").replace(/[^0-9.]/g, "")) || items.reduce((a, i) => a + i.qty * i.unit_price, 0);
    const { data: ord, error } = await supa.from("orders").insert({
      company_id: S.profile.company_id, order_no: no, channel_id: chId, platform_order_no: no,
      customer_name: String(rows[0][m.customer_name] || "平台買家"), status: "pending", pay_status: "paid",
      subtotal: total, total, ship_method: String(rows[0][m.ship_method] || ""), source: "csv",
    }).select("id").single();
    if (error) { fail++; continue; }
    const { error: e2 } = await supa.from("order_items").insert(items.map((i) => ({ ...i, order_id: ord.id })));
    if (e2) fail++; else ok++;
  }
  toast(`✅ 匯入完成：${ok} 筆新訂單、${skip} 筆重複略過（依平台單號防重）${fail ? "、" + fail + " 筆失敗" : ""} — 至訂單列表批次確認扣庫存`);
  closeModal(); LOADERS.orders();
}

/* ── 列印（揀貨單/出貨資訊單） ── */
async function printOrders(ids) {
  const { data: os } = await supa.from("orders").select("*, channels(name), order_items(description, qty, unit_price)").in("id", ids);
  const html = (os || []).map((o) => `
    <div style="page-break-after:always;font-family:sans-serif;padding:20px;max-width:560px">
      <h2 style="margin-bottom:4px">揀貨/出貨單 · ${o.order_no}</h2>
      <div style="color:#555;font-size:13px;margin-bottom:12px">${o.channels?.name} · ${o.customer_name} · ${o.ship_method || ""} · ${new Date(o.created_at).toLocaleDateString("zh-TW")}</div>
      <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="background:#f5f5f5"><th align="left">商品</th><th>數量</th><th>單價</th></tr>
        ${(o.order_items || []).map((i) => `<tr><td>${i.description}</td><td align="center">${i.qty}</td><td align="right">${Number(i.unit_price).toLocaleString()}</td></tr>`).join("")}
        <tr><td colspan="2" align="right"><b>總計</b></td><td align="right"><b>${Number(o.total).toLocaleString()}</b></td></tr>
      </table>
      ${o.note ? `<p style="font-size:13px">備註：${o.note}</p>` : ""}
    </div>`).join("");
  const w = window.open("", "_blank"); w.document.write(html); w.document.close(); w.print();
}
function printPickList() {
  const ids = [...document.querySelectorAll(".ordChk:checked")].map((c) => c.dataset.id);
  if (!ids.length) return toast("請先勾選訂單");
  printOrders(ids);
}
function genShipLabel(type) {
  const ids = [...document.querySelectorAll(".fulChk:checked")].map((c) => c.dataset.id);
  if (!ids.length) return toast("請先勾選訂單");
  printOrders(ids);
  toast(type === "seven" ? "🏪 已產生 7-11 出貨資訊單（正式寄件 API 於二期接上）" : "🐈‍⬛ 已產生黑貓出貨資訊單（正式託運 API 於二期接上）");
}

/* ── 綠界發票 ── */
async function invoiceOne(id) {
  const { data: { session } } = await supa.auth.getSession();
  try {
    const r = await fetch(CONFIG.SUPABASE_URL + "/functions/v1/ecpay-invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify({ order_id: id }),
    });
    const j = await r.json();
    toast(r.ok ? `🧾 發票已開立（${j.env === "stage" ? "測試環境" : "正式"}）：${j.invoice_no}` : "⚠️ " + (j.error || "開立失敗"));
  } catch (e) { toast("⚠️ " + e.message); }
  LOADERS.fulfill?.();
}
async function batchInvoice() {
  const ids = [...document.querySelectorAll(".fulChk:checked")].map((c) => c.dataset.id);
  if (!ids.length) return toast("請先勾選訂單");
  for (const id of ids) await invoiceOne(id);
}

/* ── 商品 ── */
async function showMovements(pid) {
  const { data: ms } = await supa.from("stock_movements").select("*").eq("product_id", pid).order("created_at", { ascending: false }).limit(30);
  const p = _products.find((x) => x.id === pid);
  const TYPE = { sale: ["銷售", "st-bad"], purchase: ["進貨", "st-ok"], adjust: ["盤點調整", "st-warn"], return_in: ["退貨入庫", "st-info"], return_out: ["換貨出庫", "st-bad"], bundle_out: ["組合銷售", "st-bad"], init: ["期初", "st-gray"], defect_in: ["瑕疵入", "st-warn"], defect_out: ["瑕疵出", "st-warn"] };
  openModal(`
    <div class="card-h"><h3>庫存異動紀錄 · ${esc(p?.sku)} ${esc(p?.name)}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <table><thead><tr><th>時間</th><th>類型</th><th class="num">異動</th><th class="num">餘量</th><th>參照 / 原因</th></tr></thead><tbody>
      ${(ms || []).map((mv) => `<tr><td class="mini">${new Date(mv.created_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td>${stBadge(TYPE, mv.movement_type)}</td><td class="num">${mv.qty > 0 ? "+" : ""}${mv.qty}</td><td class="num">${mv.balance_after}</td><td class="mini">${esc([mv.ref_id, mv.reason].filter(Boolean).join(" · "))}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">尚無異動</td></tr>`}
      </tbody></table>
      <div class="hint" style="margin-top:10px">此紀錄不可刪改；現有庫存 = 全部異動加總。</div>
    </div>`);
}
async function showBundle(pid) {
  const [{ data: bom }, { data: avail }] = await Promise.all([
    supa.from("product_bundles").select("qty, products!product_bundles_component_id_fkey(sku, name, current_stock)").eq("bundle_id", pid),
    supa.rpc("bundle_available", { p_bundle: pid }),
  ]);
  const p = _products.find((x) => x.id === pid);
  openModal(`
    <div class="card-h"><h3>🧰 組合內容 · ${esc(p?.name)}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <table><thead><tr><th>零件</th><th class="num">每組需求</th><th class="num">現有庫存</th></tr></thead><tbody>
      ${(bom || []).map((b) => `<tr><td>${esc(b.products?.sku)} ${esc(b.products?.name)}</td><td class="num">${b.qty}</td><td class="num">${b.products?.current_stock}</td></tr>`).join("")}
      </tbody></table>
      <div class="callout" style="margin-top:12px">可組數：<b>${avail ?? 0} 組</b> — 售出 1 組自動扣各零件庫存。</div>
    </div>`);
}
async function openProductModal(pid) {
  await ensureProducts();
  const p = pid ? _products.find((x) => x.id === pid) : {};
  const { data: sups } = await supa.from("suppliers").select("id, name");
  openModal(`
    <div class="card-h"><h3>${pid ? "編輯商品" : "＋ 新增商品"}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>SKU *</label><input id="pSku" value="${esc(p.sku || "")}" ${pid ? "disabled" : ""}></div><div style="flex:2"><label>名稱 *</label><input id="pName" value="${esc(p.name || "")}"></div></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>分類</label><input id="pCat" value="${esc(p.category || "")}"></div><div style="flex:1"><label>條碼</label><input id="pBarcode" value="${esc(p.barcode || "")}"></div><div style="flex:1"><label>規格</label><input id="pSpec" value="${esc(p.spec || "")}"></div></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>成本</label><input id="pCost" type="number" value="${p.cost || 0}"></div><div style="flex:1"><label>售價</label><input id="pPrice" type="number" value="${p.price || 0}"></div><div style="flex:1"><label>安全量</label><input id="pSafe" type="number" value="${p.safety_stock || 0}"></div><div style="flex:1"><label>箱規</label><input id="pBox" type="number" value="${p.box_size || 1}"></div></div>
      <div class="field"><label>供應商</label><select id="pSup"><option value="">—</option>${(sups || []).map((s) => `<option value="${s.id}" ${p.supplier_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      ${!pid ? `<div class="field"><label>期初庫存（寫入 init 異動）</label><input id="pInit" type="number" value="0"></div>` : ""}
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="saveProduct('${pid || ""}')">儲存</button></div>
    </div>`);
}
async function saveProduct(pid) {
  const row = { name: $("pName").value, category: $("pCat").value, barcode: $("pBarcode").value, spec: $("pSpec").value, cost: +$("pCost").value, price: +$("pPrice").value, safety_stock: +$("pSafe").value, box_size: +$("pBox").value || 1, supplier_id: $("pSup").value || null };
  if (pid) {
    const { error } = await supa.from("products").update(row).eq("id", pid);
    if (error) return toast("⚠️ " + error.message);
  } else {
    row.sku = $("pSku").value.trim(); row.company_id = S.profile.company_id;
    if (!row.sku || !row.name) return toast("SKU 與名稱必填");
    const { data: np, error } = await supa.from("products").insert(row).select("id").single();
    if (error) return toast("⚠️ " + error.message);
    const init = +$("pInit").value;
    if (init > 0) await supa.rpc("record_movement", { p_product: np.id, p_type: "init", p_qty: init, p_reason: "期初建檔" });
  }
  toast("✅ 已儲存"); closeModal(); window._products = null; LOADERS.products();
}
async function openStocktake() {
  await ensureProducts();
  const rows = _products.filter((p) => !p.is_bundle);
  openModal(`
    <div class="card-h"><h3>📷 盤點模式</h3><span class="sub">輸入實盤數，差異自動寫入盤點調整異動</span><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <table><thead><tr><th>SKU</th><th>商品</th><th class="num">帳上</th><th class="num">實盤</th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}</td><td class="num">${p.current_stock}</td><td class="num"><input type="number" data-pid="${p.id}" data-cur="${p.current_stock}" class="stkIn" style="width:70px" placeholder="${p.current_stock}"></td></tr>`).join("")}
      </tbody></table>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="runStocktake()">寫入盤點差異</button></div>
    </div>`);
}
async function runStocktake() {
  let n = 0;
  for (const inp of document.querySelectorAll(".stkIn")) {
    if (inp.value === "") continue;
    const diff = +inp.value - +inp.dataset.cur;
    if (diff === 0) continue;
    const { error } = await supa.rpc("record_movement", { p_product: inp.dataset.pid, p_type: "adjust", p_qty: diff, p_reason: "盤點差異調整" });
    if (!error) n++;
  }
  toast(`✅ 盤點完成：${n} 筆調整異動已寫入`);
  closeModal(); window._products = null; LOADERS.products();
}

/* ── 採購 ── */
async function createPoDrafts() {
  const { data, error } = await supa.rpc("create_po_drafts");
  toast(error ? "⚠️ " + error.message : `✅ 已依補貨建議建立 ${(data || []).length} 張採購單草稿（依供應商分單）`);
  LOADERS.purchase();
}
async function markPoOrdered(id) {
  await supa.from("purchase_orders").update({ status: "ordered" }).eq("id", id);
  toast("✅ 已送出下單"); LOADERS.purchase();
}
async function receivePo(id) {
  const { error } = await supa.rpc("receive_po", { p_po: id });
  toast(error ? "⚠️ " + error.message : "📥 驗收入庫完成 — 進貨異動已寫入、成本以移動平均更新、應付帳款入帳");
  window._products = null; LOADERS.purchase();
}
async function showPoDetail(id) {
  const { data: po } = await supa.from("purchase_orders").select("*, suppliers(name), po_items(*, products(sku, name))").eq("id", id).single();
  openModal(`
    <div class="card-h"><h3>採購單 · ${esc(po.po_no)}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="mini" style="margin-bottom:10px">${esc(po.suppliers?.name || "—")} · 預計到貨 ${po.expected_at || "—"} · ${po.status}</div>
      <table><thead><tr><th>商品</th><th class="num">數量</th><th class="num">單價成本</th><th class="num">已收</th></tr></thead><tbody>
      ${(po.po_items || []).map((i) => `<tr><td>${esc(i.products?.sku)} ${esc(i.products?.name)}</td><td class="num">${i.qty}</td><td class="num">${Number(i.unit_cost).toLocaleString()}</td><td class="num">${i.received_qty}</td></tr>`).join("")}
      </tbody></table>
      <div class="pos-total">${nt(po.total)}</div>
      ${po.status === "received" && !po.paid ? `<div style="text-align:right"><button class="btn" onclick="payPo('${po.id}')">標記已付款</button></div>` : ""}
    </div>`);
}
async function payPo(id) { await supa.from("purchase_orders").update({ paid: true }).eq("id", id); toast("✅ 已標記付款"); closeModal(); LOADERS.purchase(); }
async function openPoModal() {
  await ensureProducts();
  const { data: sups } = await supa.from("suppliers").select("id, name");
  openModal(`
    <div class="card-h"><h3>＋ 新增採購單</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>供應商</label><select id="npSup">${(sups || []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></div>
      <div class="field"><label>商品</label><select id="npProd">${_products.filter((p) => !p.is_bundle).map((p) => `<option value="${p.id}" data-cost="${p.cost}">${esc(p.sku)} ${esc(p.name)}（上次成本 $${p.cost}）</option>`).join("")}</select></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>數量</label><input id="npQty" type="number" value="10"></div><div style="flex:1"><label>單價成本</label><input id="npCost" type="number"></div><div style="flex:1"><label>預計到貨</label><input id="npDate" type="date"></div></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="createPo()">建立並下單</button></div>
    </div>`);
  const sync = () => { $("npCost").value = $("npProd").selectedOptions[0]?.dataset.cost || 0; };
  $("npProd").onchange = sync; sync();
}
async function createPo() {
  const qty = +$("npQty").value, cost = +$("npCost").value;
  const { data: po, error } = await supa.from("purchase_orders").insert({
    company_id: S.profile.company_id, po_no: "PO-" + Date.now().toString().slice(-8), supplier_id: $("npSup").value,
    status: "ordered", expected_at: $("npDate").value || null, total: qty * cost,
  }).select("id").single();
  if (error) return toast("⚠️ " + error.message);
  await supa.from("po_items").insert({ po_id: po.id, product_id: $("npProd").value, qty, unit_cost: cost });
  toast("✅ 採購單已建立並下單"); closeModal(); LOADERS.purchase();
}
async function openSupplierModal() {
  openModal(`
    <div class="card-h"><h3>＋ 新增供應商</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>名稱 *</label><input id="nsName"></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>付款週期</label><input id="nsTerms" placeholder="月結 30 天"></div><div style="flex:1"><label>前置天數（補貨公式）</label><input id="nsLead" type="number" value="14"></div></div>
      <div class="field"><label>聯絡方式</label><input id="nsContact"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="createSupplier()">儲存</button></div>
    </div>`);
}
async function createSupplier() {
  const { error } = await supa.from("suppliers").insert({ company_id: S.profile.company_id, name: $("nsName").value, payment_terms: $("nsTerms").value, lead_days: +$("nsLead").value || 14, contact: $("nsContact").value });
  toast(error ? "⚠️ " + error.message : "✅ 供應商已建立"); closeModal(); LOADERS.purchase();
}

/* ── 退換貨 ── */
async function openReturnModal() {
  await ensureProducts();
  const { data: os } = await supa.from("orders").select("id, order_no").in("status", ["shipped", "completed"]).order("created_at", { ascending: false }).limit(50);
  openModal(`
    <div class="card-h"><h3>＋ 建立退換貨單</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>原訂單</label><select id="rtOrder"><option value="">—</option>${(os || []).map((o) => `<option value="${o.id}">${esc(o.order_no)}</option>`).join("")}</select></div>
      <div class="field"><label>退回商品</label><select id="rtProd">${_products.filter((p) => !p.is_bundle).map((p) => `<option value="${p.id}">${esc(p.sku)} ${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>數量</label><input id="rtQty" type="number" value="1"></div><div style="flex:2"><label>原因</label><input id="rtReason" placeholder="運送損傷 / 買錯規格換貨…"></div></div>
      <div class="field"><label><input type="checkbox" id="rtDefect" style="width:auto;margin-right:6px">退回商品有瑕疵（入瑕疵倉）</label></div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="createReturn()">建立</button></div>
    </div>`);
}
async function createReturn() {
  const { data: rt, error } = await supa.from("returns").insert({
    company_id: S.profile.company_id, return_no: "RT-" + Date.now().toString().slice(-8),
    order_id: $("rtOrder").value || null, reason: $("rtReason").value, to_defect: $("rtDefect").checked,
  }).select("id").single();
  if (error) return toast("⚠️ " + error.message);
  await supa.from("return_items").insert({ return_id: rt.id, product_id: $("rtProd").value, qty: +$("rtQty").value });
  toast("✅ 退換貨單已建立 — 收到貨後點「收到退貨」寫入反向異動"); closeModal(); LOADERS.fulfill();
}
async function receiveReturn(id) {
  const { error } = await supa.rpc("receive_return", { p_return: id });
  toast(error ? "⚠️ " + error.message : "↩️ 退貨異動已寫入");
  window._products = null; LOADERS.fulfill();
}

/* ── 客戶 ── */
async function openCustomerModal(cid) {
  await ensureCustomers();
  const c = cid ? _customers.find((x) => x.id === cid) : {};
  let history = "";
  if (cid) {
    const { data: os } = await supa.from("orders").select("order_no, total, status, created_at, channels(code)").eq("customer_id", cid).order("created_at", { ascending: false }).limit(10);
    history = `<b style="font-size:13px">近期訂單</b><table style="margin-top:6px"><tbody>${(os || []).map((o) => `<tr><td>${esc(o.order_no)}</td><td>${chChip(o.channels?.code)}</td><td class="num">${nt(o.total)}</td><td>${stBadge(ORDER_ST, o.status)}</td></tr>`).join("") || `<tr><td class="empty">尚無訂單</td></tr>`}</tbody></table>`;
  }
  openModal(`
    <div class="card-h"><h3>${cid ? "客戶檔案" : "＋ 新增客戶"}</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field" style="display:flex;gap:8px"><div style="flex:2"><label>姓名 *</label><input id="cName" value="${esc(c.name || "")}"></div><div style="flex:1"><label>電話</label><input id="cPhone" value="${esc(c.phone || "")}"></div></div>
      <div class="field" style="display:flex;gap:8px"><div style="flex:1"><label>價格等級</label><select id="cTier"><option value="">零售價</option>${S.tiers.map((t) => `<option value="${t.id}" ${c.tier_id === t.id ? "selected" : ""}>${esc(t.name)}（${t.discount_pct}%）</option>`).join("")}</select></div><div style="flex:1"><label>LINE UID</label><input id="cLine" value="${esc(c.line_uid || "")}"></div></div>
      <div class="field"><label>備註</label><textarea id="cNote" rows="2">${esc(c.note || "")}</textarea></div>
      ${history}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="saveCustomer('${cid || ""}')">儲存</button></div>
    </div>`);
}
async function saveCustomer(cid) {
  const row = { name: $("cName").value, phone: $("cPhone").value, tier_id: $("cTier").value || null, line_uid: $("cLine").value, note: $("cNote").value };
  if (!row.name) return toast("姓名必填");
  const q = cid ? supa.from("customers").update(row).eq("id", cid) : supa.from("customers").insert({ ...row, company_id: S.profile.company_id });
  const { error } = await q;
  toast(error ? "⚠️ " + error.message : "✅ 已儲存"); closeModal(); window._customers = null; LOADERS.customers();
}
function showMergeSuggest() {
  if (!(_mergeSug || []).length) return toast("目前無歸戶建議（依電話比對）");
  openModal(`
    <div class="card-h"><h3>🔀 智慧歸戶建議</h3><span class="sub">依電話比對，合併後訂單自動移轉</span><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <table><thead><tr><th>保留</th><th>併入</th><th>依據</th><th></th></tr></thead><tbody>
      ${_mergeSug.map((s) => `<tr><td><b>${esc(s.name_a)}</b></td><td>${esc(s.name_b)}</td><td class="mini">同電話 ${esc(s.phone)}</td><td><button class="btn btn-sm btn-p" onclick="doMerge('${s.customer_a}','${s.customer_b}')">合併</button></td></tr>`).join("")}
      </tbody></table>
    </div>`);
}
async function doMerge(keep, merge) {
  const { error } = await supa.rpc("merge_customers", { p_keep: keep, p_merge: merge });
  toast(error ? "⚠️ " + error.message : "✅ 已歸戶合併"); closeModal(); window._customers = null; LOADERS.customers();
}

/* ── 通路/AI/使用者 ── */
async function updateFee(id, v) {
  await supa.from("channels").update({ fee_rate: +v }).eq("id", id);
  toast("✅ 手續費率已更新（報表即時生效）");
}
async function setCsMode(channel, mode) {
  const { error } = await supa.from("cs_channel_connections").upsert({ company_id: S.profile.company_id, channel, mode }, { onConflict: "company_id,channel" });
  toast(error ? "⚠️ " + error.message : `✅ ${channel} 模式已設為 ${mode}`);
}
async function setUserRole(id, role) {
  const { error } = await supa.from("profiles").update({ role }).eq("id", id);
  toast(error ? "⚠️ " + error.message : "✅ 角色已更新");
}
async function toggleUser(id, active) {
  await supa.from("profiles").update({ is_active: active }).eq("id", id);
  toast("✅ 已" + (active ? "啟用" : "停用")); LOADERS.users();
}
async function createInvite() {
  const { data, error } = await supa.from("invite_codes").insert({ company_id: S.profile.company_id, role: $("inviteRole").value }).select("code").single();
  if (error) return toast("⚠️ " + error.message);
  $("inviteResult").style.display = "";
  $("inviteResult").innerHTML = `邀請碼：<b style="font-size:18px;letter-spacing:2px">${data.code}</b><br><span class="mini">請提供給新成員於註冊時輸入（一碼一人）</span>`;
}

/* ── 報表匯出 ── */
function exportReport() {
  if (!(window._perf || []).length) return toast("本月尚無資料");
  const rows = _perf.map((r) => ({ 通路: CH_STYLE[r.channel_code]?.name || r.channel_code, 訂單數: r.order_count, 營收: Number(r.revenue), 平台手續費: Number(r.platform_fee), 真實毛利: Number(r.true_margin), "毛利率%": Number(r.margin_pct) }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "通路績效");
  XLSX.writeFile(wb, `通路績效_${new Date().toISOString().slice(0, 7)}.xlsx`);
  toast("📤 已匯出 Excel");
}

/* ── 全選 checkbox ── */
document.addEventListener("change", (e) => {
  if (e.target.id === "ordCheckAll") document.querySelectorAll(".ordChk").forEach((c) => (c.checked = e.target.checked));
  if (e.target.id === "fulCheckAll") document.querySelectorAll(".fulChk").forEach((c) => (c.checked = e.target.checked));
});
