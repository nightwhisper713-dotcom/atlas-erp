// ════ core.js · Supabase client / 登入 / 導覽 / 共用 UI ════
const supa = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

const S = { user: null, profile: null, company: null, plan: null, channels: [], tiers: [], features: {} };

const CH_STYLE = {
  shopee: { chip: "ch-shopee", name: "蝦皮", color: "#ee4d2d", emoji: "🟠" },
  ruten:  { chip: "ch-ruten",  name: "露天", color: "#f5a623", emoji: "🟡" },
  yahoo:  { chip: "ch-yahoo",  name: "Yahoo", color: "#6001d2", emoji: "🟣" },
  social: { chip: "ch-social", name: "社群", color: "#1877f2", emoji: "🔵" },
  store:  { chip: "ch-store",  name: "門市", color: "#10893e", emoji: "🟢" },
};
const ORDER_ST = {
  draft: ["草稿","st-gray"], pending: ["待確認","st-info"], confirmed: ["待出貨","st-warn"],
  picking: ["揀貨中","st-warn"], packed: ["已包裝","st-warn"], shipped: ["已出貨","st-ok"],
  completed: ["已完成","st-ok"], cancelled: ["已取消","st-gray"], returned: ["退貨","st-bad"],
};
const PAY_ST = { unpaid: ["待付款","st-info"], paid: ["已付款","st-ok"], cod: ["現金/到付","st-ok"], transfer_pending: ["轉帳待對帳","st-warn"] };

const $ = (id) => document.getElementById(id);
const nt = (n) => "NT$ " + Math.round(Number(n || 0)).toLocaleString();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let tt;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3600); }
function chChip(code) { const c = CH_STYLE[code] || { chip: "ch-store", name: code }; return `<span class="chip ${c.chip}">${c.name}</span>`; }
function stBadge(map, key) { const [t, cls] = map[key] || [key, "st-gray"]; return `<span class="st ${cls}">${t}</span>`; }

// ── Modal（單一 host，內容動態）──
function openModal(html) { $("modalBox").innerHTML = html; $("modalHost").classList.add("show"); }
function closeModal() { $("modalHost").classList.remove("show"); }

// ── 登入 ──
let signupMode = false;
function toggleSignup() {
  signupMode = !signupMode;
  $("inviteField").style.display = signupMode ? "" : "none";
  $("loginBtn").textContent = signupMode ? "註冊並加入" : "登入";
  $("toggleSignup").textContent = signupMode ? "已有帳號？登入" : "第一次使用？註冊帳號";
}
async function doLogin() {
  const email = $("loginEmail").value.trim(), pwd = $("loginPwd").value;
  $("loginErr").textContent = "";
  try {
    if (signupMode) {
      const code = $("inviteCode").value.trim();
      if (!code) throw new Error("請輸入邀請碼");
      const { data, error } = await supa.auth.signUp({ email, password: pwd });
      if (error) throw error;
      if (!data.session) { $("loginErr").textContent = "請至信箱點擊驗證連結後再登入"; return; }
      await supa.from("profiles").insert({ id: data.user.id, display_name: email.split("@")[0] });
      const { error: e2 } = await supa.rpc("redeem_invite", { p_code: code });
      if (e2) throw e2;
    } else {
      const { error } = await supa.auth.signInWithPassword({ email, password: pwd });
      if (error) throw error;
    }
    await boot();
  } catch (e) { $("loginErr").textContent = e.message || String(e); }
}
async function doLogout() { await supa.auth.signOut(); location.reload(); }

// ── 啟動 ──
async function boot() {
  const { data: { session } } = await supa.auth.getSession();
  if (!session) { $("loginScreen").style.display = "flex"; return; }
  S.user = session.user;
  const { data: prof } = await supa.from("profiles").select("*").eq("id", S.user.id).single();
  if (!prof) { $("loginErr").textContent = "帳號無 profile，請聯絡管理員"; return; }
  S.profile = prof;
  if (!prof.company_id) { $("loginErr").textContent = "帳號尚未指派租戶，請向老闆索取邀請碼或聯絡幻翔"; await supa.auth.signOut(); return; }
  const { data: co } = await supa.from("companies").select("*, plans(*)").eq("id", prof.company_id).single();
  S.company = co; S.plan = co?.plans;
  // 功能開關（tenant_features 覆寫 plan）
  S.features = { ...(S.plan?.features || {}) };
  const { data: tf } = await supa.from("tenant_features").select("*").eq("company_id", prof.company_id);
  (tf || []).forEach((f) => (S.features[f.feature] = f.value));
  const [{ data: chs }, { data: tiers }] = await Promise.all([
    supa.from("channels").select("*").order("code"),
    supa.from("price_tiers").select("*"),
  ]);
  S.channels = chs || []; S.tiers = tiers || [];

  // UI
  $("loginScreen").style.display = "none";
  $("appRoot").style.display = "flex";
  $("coName").textContent = co.name.replace(/（.*）/, "");
  $("userName").textContent = prof.display_name;
  $("userRole").textContent = { superadmin: "系統管理", owner: "管理者 Admin", store: "門市", shipping: "出貨", purchasing: "採購" }[prof.role] || prof.role;
  $("userAvatar").textContent = (prof.display_name || "?").slice(0, 1);
  if (co.name.includes("示範")) $("demoStrip").style.display = "";
  if (S.features.ai_cs === true || S.features.ai_cs === "true") $("navAics").style.display = "";
  if (prof.role === "owner" || prof.role === "superadmin") $("navUsers").style.display = "";
  go("dashboard");
}

// ── 導覽 ──
const TITLES = { dashboard: "儀表板", orders: "多平台訂單整合", products: "商品 / 庫存", purchase: "進貨採購", fulfill: "銷貨出貨", reports: "報表分析", customers: "客戶 / 會員", channels: "平台串接設定", aics: "AI 客服", users: "使用者權限" };
const LOADERS = {};   // pages.js 註冊
function go(p) {
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.page === p));
  document.querySelectorAll(".page").forEach((s) => s.classList.toggle("show", s.id === "page-" + p));
  $("pageTitle").textContent = TITLES[p];
  window.scrollTo({ top: 0 });
  LOADERS[p]?.().catch((e) => toast("⚠️ 載入失敗：" + (e.message || e)));
}
document.querySelectorAll("#nav .nav-item").forEach((n) => (n.onclick = () => go(n.dataset.page)));

// ── 全域搜尋（訂單/商品/客戶）──
$("globalSearch").addEventListener("keydown", async (ev) => {
  if (ev.key !== "Enter") return;
  const q = ev.target.value.trim(); if (!q) return;
  const [o, p, c] = await Promise.all([
    supa.from("orders").select("id, order_no").ilike("order_no", `%${q}%`).limit(3),
    supa.from("products").select("id, sku, name").or(`sku.ilike.%${q}%,name.ilike.%${q}%`).limit(3),
    supa.from("customers").select("id, name").ilike("name", `%${q}%`).limit(3),
  ]);
  const hits = [...(o.data || []).map((x) => "🧾 " + x.order_no), ...(p.data || []).map((x) => "📦 " + x.sku + " " + x.name), ...(c.data || []).map((x) => "👤 " + x.name)];
  toast(hits.length ? "找到：" + hits.join("、") : "查無「" + q + "」");
  if (o.data?.length) go("orders"); else if (p.data?.length) go("products"); else if (c.data?.length) go("customers");
});

window.addEventListener("DOMContentLoaded", boot);
