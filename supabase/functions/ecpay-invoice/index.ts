// ============================================================
// ecpay-invoice · 綠界電子發票開立（v1 = 測試環境 stage）
// POST { order_id } → 依訂單開立 B2C 發票，寫回 invoices / orders
// Secrets（Supabase Dashboard → Edge Functions → Secrets）：
//   ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV / ECPAY_ENV=stage
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

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { order_id } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";

    // 以呼叫者身分（RLS 生效）讀訂單 → 天然限制在自己租戶
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: order, error: oerr } = await userClient
      .from("orders").select("*, order_items(*)").eq("id", order_id).single();
    if (oerr || !order) return json({ error: "訂單不存在或無權限" }, 404, cors);
    if (order.invoice_no) return json({ error: "此訂單已開立發票 " + order.invoice_no }, 409, cors);

    const MerchantID = Deno.env.get("ECPAY_MERCHANT_ID")!;
    const HashKey = Deno.env.get("ECPAY_HASH_KEY")!;
    const HashIV = Deno.env.get("ECPAY_HASH_IV")!;
    const env = Deno.env.get("ECPAY_ENV") ?? "stage";

    const relateNo = ("EF" + order.order_no.replace(/[^A-Za-z0-9]/g, "")).slice(0, 30);
    const items = (order.order_items ?? []).map((i: any) => ({
      ItemName: (i.description || "商品").slice(0, 100),
      ItemCount: i.qty,
      ItemWord: "件",
      ItemPrice: Number(i.unit_price),
      ItemAmount: Number(i.unit_price) * i.qty,
      ItemTaxType: "1",
    }));

    const data = {
      MerchantID,
      RelateNumber: relateNo,
      CustomerName: order.customer_name || "消費者",
      CustomerEmail: order.ship_to?.email ?? "test@example.com",
      Print: "0",
      Donation: "0",
      Love_Code: "",
      CarrierType: "",
      TaxType: "1",
      SalesAmount: Math.round(Number(order.total)),
      Items: items,
      InvType: "07",
      vat: "1",
    };

    // 規格：Data = AES(URLEncode(JSON))
    const encrypted = await aes(encodeURIComponent(JSON.stringify(data)), HashKey, HashIV, true);
    const payload = {
      MerchantID,
      RqHeader: { Timestamp: Math.floor(Date.now() / 1000) },
      Data: encrypted,
    };

    const resp = await fetch(env === "prod" ? PROD_URL : STAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await resp.json();
    let result: any = {};
    if (body?.Data) {
      try { result = JSON.parse(decodeURIComponent(await aes(body.Data, HashKey, HashIV, false))); }
      catch { result = { RtnCode: -1, RtnMsg: "解密失敗", raw: body }; }
    } else result = body;

    const ok = result?.RtnCode === 1;

    // service_role 寫入結果（invoices 記錄含原文，稽核用）
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("invoices").insert({
      company_id: order.company_id,
      order_id: order.id,
      invoice_no: ok ? result.InvoiceNo : "",
      status: ok ? "issued" : "failed",
      amount: order.total,
      buyer: { name: order.customer_name },
      ecpay_payload: result,
      env,
      issued_at: ok ? new Date().toISOString() : null,
    });
    if (ok) await admin.from("orders").update({ invoice_no: result.InvoiceNo }).eq("id", order.id);

    return json(ok ? { invoice_no: result.InvoiceNo, random_no: result.RandomNumber, env }
                   : { error: result?.RtnMsg ?? "開立失敗", detail: result }, ok ? 200 : 502, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

function json(obj: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
