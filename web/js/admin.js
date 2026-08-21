// ════ admin.js · ATLAS 營運後台（superadmin 專用） ════
const supa = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const nt = (n) => "NT$ " + Math.round(Number(n || 0)).toLocaleString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let tt;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3600); }
function openModal(h) { $("modalBox").innerHTML = h; $("modalHost").classList.add("show"); }
function closeModal() { $("modalHost").classList.remove("show"); }

async function doLogin() {
  const { error } = await supa.auth.signInWithPassword({ email: $("loginEmail").value.trim(), password: $("loginPwd").value });
  if (error) return ($("loginErr").textContent = error.message);
  boot();
}
async function doLogout() { await supa.auth.signOut(); location.reload(); }

async function boot() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { $("loginScreen").style.display = "flex"; return; }
  const { data: prof } = await supa.from("profiles").select("*").eq("id", session.user.id).single();
  if (!prof || prof.role !== "superadmin") {
    $("loginErr").textContent = "此後台僅限系統管理員（superadmin）";
    await supa.auth.signOut(); return;
  }
  $("loginScreen").style.display = "none";
  $("appRoot").style.display = "flex";
  $("userName").textContent = prof.display_name;
  render();
}

async function render() {
  const [{ data: stats, error }, { data: plans }] = await Promise.all([
    supa.rpc("operator_tenant_stats"),
    supa.from("plans").select("*").order("price_month"),
  ]);
  if (error) return toast("⚠️ " + error.message);
  window._stats = stats || []; window._plans = plans || [];

  const mrr = _stats.filter((t) => t.status === "active").reduce((a, t) => a + t.price_month, 0);
  const cost = _stats.reduce((a, t) => a + Number(t.month_api_cost), 0);
  $("kTenants").textContent = _stats.length;
  $("kMrr").textContent = nt(mrr);
  $("kCost").textContent = nt(cost);
  $("kMargin").textContent = nt(mrr - cost);

  const ST = { trial: ["試用", "st-info"], active: ["啟用", "st-ok"], suspended: ["停權", "st-bad"], closed: ["結束", "st-gray"] };
  $("tbTenants").innerHTML = _stats.map((t) => {
    const [sn, sc] = ST[t.status] || [t.status, "st-gray"];
    const burn = Number(t.month_api_cost) > t.price_month * 0.5;   // 成本吃掉月費一半 → 警示
    const margin = t.price_month - Number(t.month_api_cost);
    return `<tr ${burn ? 'style="background:#fff5f5"' : ""}>
      <td><b>${esc(t.name)}</b></td>
      <td><select onchange="setPlan('${t.company_id}', this.value)" style="padding:4px 8px;border:1px solid var(--line);border-radius:6px">${_plans.map((p) => `<option value="${p.id}" ${t.plan_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></td>
      <td><select onchange="setStatus('${t.company_id}', this.value)" style="padding:4px 8px;border:1px solid var(--line);border-radius:6px">${Object.entries(ST).map(([k, [n]]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td class="num">${t.month_orders}</td>
      <td><label style="cursor:pointer"><input type="checkbox" ${t.ai_cs ? "checked" : ""} onchange="toggleAi('${t.company_id}', this.checked)" style="width:auto"> ${t.ai_cs ? "開" : "關"}</label></td>
      <td class="num">${t.quota_balance}</td>
      <td class="num" style="color:${burn ? "var(--bad)" : "inherit"}">${nt(t.month_api_cost)}${burn ? " ⚠️" : ""}</td>
      <td class="num" style="color:${margin < 0 ? "var(--bad)" : "var(--ok)"}"><b>${nt(margin)}</b></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty">尚無租戶 — 點「＋ 開通新租戶」</td></tr>`;

  $("tbPlans").innerHTML = _plans.map((p) => `<tr>
    <td><b>${esc(p.name)}</b> <span class="mini">${p.id}</span></td>
    <td class="num"><input type="number" value="${p.price_month}" style="width:90px;text-align:right;padding:4px;border:1px solid var(--line);border-radius:6px" onchange="setPlanField('${p.id}', 'price_month', +this.value)"></td>
    <td>${p.features?.ai_cs ? '<span class="st st-ok">含</span>' : '<span class="st st-gray">不含</span>'}</td>
    <td class="num"><input type="number" value="${p.features?.ai_quota ?? 0}" style="width:90px;text-align:right;padding:4px;border:1px solid var(--line);border-radius:6px" onchange="setPlanQuota('${p.id}', +this.value)"></td>
    <td class="mini">修改即存</td></tr>`).join("");
}

async function setPlan(co, plan) {
  const { error } = await supa.from("companies").update({ plan_id: plan }).eq("id", co);
  toast(error ? "⚠️ " + error.message : "✅ 方案已切換"); render();
}
async function setStatus(co, status) {
  const { error } = await supa.from("companies").update({ status }).eq("id", co);
  toast(error ? "⚠️ " + error.message : "✅ 狀態已更新"); render();
}
async function toggleAi(co, on) {
  const { error } = await supa.from("tenant_features").upsert(
    [{ company_id: co, feature: "ai_cs", value: on }], { onConflict: "company_id,feature" });
  toast(error ? "⚠️ " + error.message : `✅ AI 客服已${on ? "開啟" : "關閉"}（即時生效，關閉即零 token 損耗）`); render();
}
async function setPlanField(id, field, val) {
  const { error } = await supa.from("plans").update({ [field]: val }).eq("id", id);
  toast(error ? "⚠️ " + error.message : "✅ 已儲存");
}
async function setPlanQuota(id, quota) {
  const p = _plans.find((x) => x.id === id);
  const features = { ...(p.features || {}), ai_quota: quota, ai_cs: quota > 0 ? true : (p.features?.ai_cs ?? false) };
  const { error } = await supa.from("plans").update({ features }).eq("id", id);
  toast(error ? "⚠️ " + error.message : "✅ 額度已更新"); render();
}

function openProvision() {
  openModal(`
    <div class="card-h"><h3>＋ 開通新租戶</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <div class="field"><label>公司名稱 *</label><input id="pvName" placeholder="例：丸豐工具"></div>
      <div class="field"><label>方案</label><select id="pvPlan">${_plans.map((p) => `<option value="${p.id}">${esc(p.name)}（${nt(p.price_month)}/月）</option>`).join("")}</select></div>
      <div class="hint" style="margin-bottom:12px">開通即建立五通路與分級價預設，並產生老闆邀請碼。</div>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-p" onclick="provision()">開通</button></div>
      <div id="pvResult" class="callout" style="margin-top:12px;display:none"></div>
    </div>`);
}
async function provision() {
  const name = $("pvName").value.trim();
  if (!name) return toast("請輸入公司名稱");
  const { data, error } = await supa.rpc("provision_tenant", { p_name: name, p_plan: $("pvPlan").value });
  if (error) return toast("⚠️ " + error.message);
  const r = data[0];
  $("pvResult").style.display = "";
  $("pvResult").innerHTML = `✅ 已開通！<br>老闆邀請碼：<b style="font-size:18px;letter-spacing:2px">${r.invite_code}</b><br><span class="mini">請客戶至系統登入頁「註冊」並輸入此碼（一碼一人，角色＝老闆）</span>`;
  render();
}

window.addEventListener("DOMContentLoaded", boot);
