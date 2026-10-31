// ============================================================
// ecpay-invoice · 綠界電子發票開立（v1 = 測試環境 stage）
// POST { order_id } → 依訂單開立 B2C 發票，寫回 invoices / orders
// Secrets（Supabase Dashboard → Edge Functions → Secrets）：
//   ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV / ECPAY_ENV=stage
//   ALLOWED_ORIGIN（逗號分隔，例 https://<帳號>.github.io）← CORS 白名單，必填
//   INVOICE_ALLOWED_ROLES（選填，預設 owner,superadmin）← 可開立發票的角色
// 需先套用 migration 013（orders.invoice_status + claim/finish RPC）
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const STAGE_URL = "https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue";
const PROD_URL = "https://einvoice.ecpay.com.tw/B2CInvoice/Issue";

// ---- ECPay AES-128-CBC 加解密（新版 JSON API 規格）----
async function aes(data: string, key: string, iv: string, enc: boolean): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), "AES-CBC", false, ["encrypt", "decrypt"]);
  const ivb = new TextEncoder().encode(iv);
  if (enc) {
    const buf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: ivb }, k, new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const buf = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivb }, k, raw);
  return new TextDecoder().decode(buf);
}

const ELIGIBLE_STATUS = ["confirmed", "picking", "packed", "shipped", "completed"];

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

// 依綠界 B2C 規則決定 列印/載具/捐贈；資料不足回 400（不再用假 email）
function buyerFields(order: any) {
  const st = order.ship_to ?? {};
  const email = String(st.email ?? "").trim();
  const phone = String(st.phone ?? "").replace(/[^0-9]/g, "");
  const addr = String(st.address ?? st.addr ?? "").trim();
  const name = String(order.customer_name ?? st.name ?? "").trim();
  const carrierType = String(st.carrier_type ?? "").trim(); // "1" 綠界載具 / "2" 自然人憑證 / "3" 手機條碼
  const carrierNum = String(st.carrier_num ?? "").trim();
  const loveCode = String(st.love_code ?? "").trim();

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "買受人 Email 格式錯誤");
  if (!email && !phone) throw new HttpError(400, "缺少買受人 Email 或手機，無法開立發票（請於訂單收件資訊補齊）");

  const f = {
    CustomerName: name, CustomerAddr: addr, CustomerEmail: email, CustomerPhone: phone,
    Print: "0", Donation: "0", LoveCode: "", CarrierType: "", CarrierNum: "",
  };
  if (loveCode) {
    if (!/^[0-9]{3,7}$/.test(loveCode)) throw new HttpError(400, "捐贈碼格式錯誤（3~7 碼數字）");
    f.Donation = "1"; f.LoveCode = loveCode;
  } else if (carrierType) {
    if (carrierType === "3" && !/^\/[0-9A-Z.+\-]{7}$/.test(carrierNum)) throw new HttpError(400, "手機條碼載具格式錯誤");
    if (carrierType === "2" && !/^[A-Z]{2}[0-9]{14}$/.test(carrierNum)) throw new HttpError(400, "自然人憑證載具格式錯誤");
    if (!["1", "2", "3"].includes(carrierType)) throw new HttpError(400, "不支援的載具類別");
    f.CarrierType = carrierType; f.CarrierNum = carrierType === "1" ? "" : carrierNum;
  } else {
    // 無載具、未捐贈 → 必須列印紙本，需姓名與地址
    if (!name || !addr) throw new HttpError(400, "無載具/捐贈碼時需列印紙本發票，請補齊買受人姓名與地址，或提供載具");
    f.Print = "1";
  }
  return f;
}

// 品項金額（含運費）加總必須等於訂單總額 = SalesAmount
function buildItems(order: any) {
  const cents = (n: unknown) => Math.round(Number(n) * 100);
  const items = (order.order_items ?? []).map((i: any) => {
    const qty = Number(i.qty);
    const price = Number(i.unit_price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      throw new HttpError(400, "訂單品項數量或單價異常");
    }
    return {
      ItemName: (i.description || "商品").slice(0, 100),
      ItemCount: qty, ItemWord: "件", ItemPrice: price,
      ItemAmount: cents(price) * qty / 100, ItemTaxType: "1",
    };
  });
  const ship = Number(order.shipping_fee ?? 0);
  if (ship > 0) items.push({ ItemName: "運費", ItemCount: 1, ItemWord: "式", ItemPrice: ship, ItemAmount: ship, ItemTaxType: "1" });
  if (!items.length) throw new HttpError(400, "訂單沒有品項，無法開立發票");

  const sumCents = items.reduce((a: number, it: any) => a + cents(it.ItemAmount), 0);
  const totalCents = cents(order.total);
  if (totalCents % 100 !== 0) throw new HttpError(400, "訂單總額需為整數元才能開立發票");
  if (sumCents !== totalCents) {
    throw new HttpError(422, `品項加總（${sumCents / 100}）與訂單總額（${totalCents / 100}）不符，請先修正訂單（折扣需反映於品項單價）`);
  }
  return { items, salesAmount: totalCents / 100 };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(cors["Access-Control-Allow-Origin"] ? "ok" : "forbidden", {
      status: cors["Access-Control-Allow-Origin"] ? 200 : 403, headers: cors,
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let claimedOrderId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const order_id = typeof body?.order_id === "string" ? body.order_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(order_id)) throw new HttpError(400, "order_id 格式錯誤");

    // ---- 驗證呼叫者 ----
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "未登入");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await userClient.auth.getUser(token);
    if (uerr || !user) throw new HttpError(401, "登入已失效，請重新登入");

    const { data: profile } = await admin.from("profiles")
      .select("role, company_id, is_active").eq("id", user.id).single();
    const allowedRoles = (Deno.env.get("INVOICE_ALLOWED_ROLES") ?? "owner,superadmin")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!profile || !profile.is_active || !allowedRoles.includes(profile.role)) {
      throw new HttpError(403, "權限不足：僅管理者可開立發票");
    }

    // ---- 以呼叫者身分（RLS 生效）讀訂單 → 限制在自己租戶 ----
    const { data: order, error: oerr } = await userClient
      .from("orders").select("*, order_items(*)").eq("id", order_id).single();
    if (oerr || !order) throw new HttpError(404, "訂單不存在或無權限");
    if (profile.role !== "superadmin" && order.company_id !== profile.company_id) {
      throw new HttpError(404, "訂單不存在或無權限");
    }
    if (order.invoice_no) throw new HttpError(409, "此訂單已開立發票 " + order.invoice_no);
    if (!ELIGIBLE_STATUS.includes(order.status)) throw new HttpError(409, "訂單尚未確認或狀態不可開立發票");

    // ---- 先驗證資料（不佔鎖）----
    const buyer = buyerFields(order);
    const { items, salesAmount } = buildItems(order);

    // ---- 原子鎖：同一訂單只有一個請求能進入開立 ----
    const { data: claimed, error: cerr } = await admin.rpc("claim_order_invoice", { p_order: order.id });
    if (cerr) throw cerr;
    if (claimed !== true) throw new HttpError(409, "此訂單正在開立或已開立發票，請稍後重新整理");
    claimedOrderId = order.id;

    const MerchantID = Deno.env.get("ECPAY_MERCHANT_ID")!;
    const HashKey = Deno.env.get("ECPAY_HASH_KEY")!;
    const HashIV = Deno.env.get("ECPAY_HASH_IV")!;
    const env = Deno.env.get("ECPAY_ENV") ?? "stage";

    const relateNo = ("EF" + order.order_no.replace(/[^A-Za-z0-9]/g, "")).slice(0, 30);
    const data = {
      MerchantID,
      RelateNumber: relateNo,
      CustomerID: "",
      CustomerIdentifier: "",
      ...buyer,
      ClearanceMark: "",
      TaxType: "1",
      SalesAmount: salesAmount,
      InvoiceRemark: "",
      Items: items,
      InvType: "07",
      vat: "1",
    };

    // 規格：Data = AES(URLEncode(JSON))
    const encrypted = await aes(encodeURIComponent(JSON.stringify(data)), HashKey, HashIV, true);
    const payload = { MerchantID, RqHeader: { Timestamp: Math.floor(Date.now() / 1000) }, Data: encrypted };

    // 送出後結果不明（逾時/網路錯誤）時，訂單維持 issuing，不自動釋放鎖，避免重複開立
    const resp = await fetch(env === "prod" ? PROD_URL : STAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const respBody = await resp.json();
    let result: any = {};
    if (respBody?.Data) {
      try { result = JSON.parse(decodeURIComponent(await aes(respBody.Data, HashKey, HashIV, false))); }
      catch { result = { RtnCode: -1, RtnMsg: "解密失敗", raw: respBody }; }
    } else result = respBody;

    const ok = result?.RtnCode === 1 && !!result?.InvoiceNo;
    claimedOrderId = null; // 已得到綠界明確回覆，交由 finish 處理

    // service_role 寫入結果（invoices 記錄含原文，稽核用）
    const { error: ierr } = await admin.from("invoices").insert({
      company_id: order.company_id,
      order_id: order.id,
      invoice_no: ok ? result.InvoiceNo : "",
      status: ok ? "issued" : "failed",
      amount: order.total,
      buyer: { name: buyer.CustomerName, carrier_type: buyer.CarrierType, donation: buyer.Donation, print: buyer.Print },
      ecpay_payload: result,
      env,
      issued_at: ok ? new Date().toISOString() : null,
    });
    if (ierr) console.error("invoices insert failed", { order_id: order.id, ierr });
    const { error: ferr } = await admin.rpc("finish_order_invoice", {
      p_order: order.id, p_ok: ok, p_invoice_no: ok ? result.InvoiceNo : "",
    });
    if (ferr) console.error("finish_order_invoice failed", { order_id: order.id, ferr });

    if (!ok) {
      console.error("ECPay issue failed", { order_id: order.id, RtnCode: result?.RtnCode, RtnMsg: result?.RtnMsg });
      return json({ error: "綠界開立失敗：" + String(result?.RtnMsg ?? "未知錯誤").slice(0, 200) }, 502, cors);
    }
    return json({ invoice_no: result.InvoiceNo, random_no: result.RandomNumber, env }, 200, cors);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status, cors);
    console.error("ecpay-invoice error", { order_claimed: claimedOrderId, error: e instanceof Error ? e.stack ?? e.message : e });
    const msg = claimedOrderId
      ? "開立結果未確認，訂單已鎖定為「開立中」，請管理者至綠界後台核對後處理"
      : "伺服器錯誤，請稍後再試";
    return json({ error: msg }, 500, cors);
  }
});

function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
