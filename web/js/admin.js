// ════ admin.js v2 · ATLAS 營運後台（superadmin 專用） ════
// 租戶開通／方案切換／AI 開關／使用者管理／邀請碼／刪除租戶／成本毛利
const supa = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const nt = (n) => "NT$ " + Math.round(Number(n || 0)).toLocaleString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let tt;
function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3600); }
function wrapTables(root) {
  (root || document).querySelectorAll("table").forEach((t) => {
    if (t.parentElement && t.parentElement.classList.contains("tw")) return;
    const w = document.createElement("div"); w.className = "tw";
    t.parentNode.insertBefore(w, t); w.appendChild(t);
  });
}
function toggleNav() {
  const open = !$("sidebar").classList.contains("open");
  $("sidebar").classList.toggle("open", open);
  $("navBackdrop").classList.toggle("show", open);
}
function closeNav() { $("sidebar").classList.remove("open"); $("navBackdrop").classList.remove("show"); }
function openModal(h) { $("modalBox").innerHTML = h; wrapTables($("modalBox")); $("modalHost").classList.add("show"); }
function closeModal() { $("modalHost").classList.remove("show"); }
const ROLES = { owner: "老闆", store: "門市", shipping: "出貨", purchasing: "採購" };
const ST = { trial: ["試用", "st-info"], active: ["啟用", "st-ok"], suspended: ["停權", "st-bad"], closed: ["結束", "st-gray"] };

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

  $("tbTenants").innerHTML = _stats.map((t) => {
    const burn = Number(t.month_api_cost) > t.price_month * 0.5;
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
      <td><button class="btn btn-sm btn-p" onclick="openManage('${t.company_id}')">管理</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">尚無租戶 — 點「＋ 開通新租戶」</td></tr>`;

  $("tbPlans").innerHTML = _plans.map((p) => `<tr>
    <td><b>${esc(p.name)}</b> <span class="mini">${p.id}</span></td>
    <td class="num"><input type="number" value="${p.price_month}" style="width:90px;text-align:right;padding:4px;border:1px solid var(--line);border-radius:6px" onchange="setPlanField('${p.id}', 'price_month', +this.value)"></td>
    <td>${p.features?.ai_cs ? '<span class="st st-ok">含</span>' : '<span class="st st-gray">不含</span>'}</td>
    <td class="num"><input type="number" value="${p.features?.ai_quota ?? 0}" style="width:90px;text-align:right;padding:4px;border:1px solid var(--line);border-radius:6px" onchange="setPlanQuota('${p.id}', +this.value)"></td>
    <td class="mini">修改即存</td></tr>`).join("");
  wrapTables();
}

/* ── 租戶管理面板（使用者／邀請碼／刪除） ── */
async function openManage(coId) {
  const t = _stats.find((x) => x.company_id === coId);
  openModal(`
    <div class="card-h"><h3>🏢 ${esc(t.name)} · 租戶管理</h3><button class="x" onclick="closeModal()">✕</button></div>
    <div class="card-b">
      <h3 style="font-size:13px;margin-bottom:6px">使用者帳號</h3>
      <div id="mgUsers" class="mini">載入中…</div>
      <div class="hint" style="margin:6px 0 14px">🔒 密碼以不可逆雜湊儲存，任何人（含系統商）皆無法檢視；使用者忘記密碼時，至 Supabase → Authentication 對該帳號發送「重設密碼信」即可。停用帳號立即擋登入。</div>
      <h3 style="font-size:13px;margin-bottom:6px">邀請碼</h3>
      <div id="mgInvites" class="mini">載入中…</div>
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0 16px">
        <select id="mgInvRole" style="padding:5px 8px;border:1px solid var(--line);border-radius:6px">${Object.entries(ROLES).map(([r, n]) => `<option value="${r}">${n}</option>`).join("")}</select>
        <button class="btn btn-sm btn-p" onclick="mgCreateInvite('${coId}')">＋ 產生邀請碼</button>
        <span class="mini">新成員在前台「註冊」輸入邀請碼即加入（一碼一人，密碼由本人設定）</span>
      </div>
      <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:10px;padding:12px">
        <b style="color:var(--bad);font-size:13px">危險操作</b>
        <div class="mini" style="margin:4px 0 8px">刪除租戶將永久移除其全部資料（商品、訂單、庫存帳、會員、對話）。不可復原。</div>
        <button class="btn btn-sm" style="color:var(--bad);border-color:#fecaca" onclick="mgDeleteTenant('${coId}', '${esc(t.name)}')">🗑 刪除此租戶</button>
      </div>
    </div>`);
  mgLoadUsers(coId);
  mgLoadInvites(coId);
}
async function mgLoadUsers(coId) {
  const { data, error } = await supa.rpc("operator_tenant_users", { p_company: coId });
  if (error) { $("mgUsers").innerHTML = "⚠️ " + esc(error.message) + "（請先執行 010 migration）"; return; }
  $("mgUsers").innerHTML = (data || []).length ? `<table><thead><tr><th>Email</th><th>名稱</th><th>角色</th><th>最後登入</th><th>狀態</th><th></th></tr></thead><tbody>` +
    data.map((u) => `<tr><td>${esc(u.email)}</td><td>${esc(u.display_name)}</td>
      <td><select onchange="mgSetRole('${u.uid}', this.value, '${coId}')" style="padding:3px 6px;border:1px solid var(--line);border-radius:6px">${Object.entries(ROLES).map(([r, n]) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td class="mini">${u.last_sign_in ? new Date(u.last_sign_in).toLocaleString("zh-TW") : "從未登入"}</td>
      <td>${u.is_active ? '<span class="st st-ok">啟用</span>' : '<span class="st st-gray">停用</span>'}</td>
      <td><button class="btn-ghost" onclick="mgToggleUser('${u.uid}', ${!u.is_active}, '${coId}')">${u.is_active ? "停用" : "啟用"}</button></td></tr>`).join("") +
    `</tbody></table>` : `<span class="mini">此租戶尚無使用者——產生邀請碼請客戶註冊。</span>`;
  wrapTables($("mgUsers"));
}
async function mgLoadInvites(coId) {
  const { data, error } = await supa.from("invite_codes").select("*").eq("company_id", coId).order("created_at", { ascending: false });
  if (error) { $("mgInvites").innerHTML = "⚠️ " + esc(error.message); return; }
  $("mgInvites").innerHTML = (data || []).length ? `<table><thead><tr><th>邀請碼</th><th>角色</th><th>狀態</th><th></th></tr></thead><tbody>` +
    data.map((c) => `<tr><td><b style="letter-spacing:1px">${esc(c.code)}</b></td><td>${ROLES[c.role] || c.role}</td>
      <td>${c.used_by ? '<span class="st st-gray">已使用</span>' : '<span class="st st-ok">可使用</span>'}</td>
      <td>${!c.used_by ? `<button class="btn-ghost" style="color:var(--bad)" onclick="mgDropInvite('${c.code}', '${coId}')">作廢</button>` : ""}</td></tr>`).join("") +
    `</tbody></table>` : `<span class="mini">尚無邀請碼。</span>`;
  wrapTables($("mgInvites"));
}
async function mgCreateInvite(coId) {
  const { data, error } = await supa.rpc("operator_create_invite", { p_company: coId, p_role: $("mgInvRole").value });
  toast(error ? "⚠️ " + error.message : "✅ 邀請碼：" + data);
  mgLoadInvites(coId);
}
async function mgDropInvite(code, coId) {
  const { error } = await supa.from("invite_codes").delete().eq("code", code);
  toast(error ? "⚠️ " + error.message : "已作廢");
  mgLoadInvites(coId);
}
async function mgSetRole(uid, role, coId) {
  const { error } = await supa.from("profiles").update({ role }).eq("id", uid);
  toast(error ? "⚠️ " + error.message : "✅ 角色已更新");
  mgLoadUsers(coId);
}
async function mgToggleUser(uid, active, coId) {
  const { error } = await supa.from("profiles").update({ is_active: active }).eq("id", uid);
  toast(error ? "⚠️ " + error.message : active ? "✅ 已啟用" : "⛔ 已停用（立即擋登入）");
  mgLoadUsers(coId);
}
async function mgDeleteTenant(coId, name) {
  const typed = prompt(`此操作不可復原！\n將刪除租戶及其全部資料。\n請完整輸入租戶名稱以確認：\n\n${name}`);
  if (typed === null) return;
  const { error } = await supa.rpc("delete_tenant", { p_company: coId, p_confirm_name: typed.trim() });
  if (error) return toast("⚠️ " + error.message);
  toast("🗑 租戶已刪除");
  closeModal(); render();
}

/* ── 方案／狀態／AI ── */
async function setPlan(co, plan) {
  const { error } = await supa.from("companies").update({ plan_id: plan }).eq("id", co);
  toast(error ? "⚠️ " + error.message : "✅ 方案已切換"); render();
}
async function setStatus(co, status) {
  const { error } = await supa.from("companies").update({ status }).eq("id", co);
  toast(error ? "⚠️ " + error.message : status === "suspended" ? "⛔ 已停權——該租戶所有帳號登入即被擋下" : "✅ 狀態已更新"); render();
}
async function toggleAi(co, on) {
  const { error } = await supa.from("tenant_features").upsert(
    [{ company_id: co, feature: "ai_cs", value: on }], { onConflict: "company_id,feature" });
  toast(error ? "⚠️ " + error.message : `✅ AI 客服已${on ? "開啟" : "關閉"}（即時生效）`); render();
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

/* ── 開通新租戶 ── */
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
  $("pvResult").innerHTML = `✅ 已開通！<br>老闆邀請碼：<b style="font-size:18px;letter-spacing:2px">${r.invite_code}</b><br><span class="mini">請客戶至系統登入頁「註冊」並輸入此碼（一碼一人，角色＝老闆，密碼由客戶自行設定）</span>`;
  render();
}

window.addEventListener("DOMContentLoaded", boot);
