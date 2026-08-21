# ATLAS · 全通路管理系統（atlas-erp）

多租戶 SaaS：一份庫存帳本，扛起所有通路。訂單、採購、出貨、真毛利報表、AI 客服加值模組。幻翔商用設計。
首位客戶：丸豐工具（示範租戶情境即以其為本）。

- 租戶端：`web/index.html`（老闆/門市/出貨/採購登入）
- 營運後台：`web/admin.html`（幻翔 superadmin 專用——租戶開通、方案切換、AI 開關、API 成本與毛利監控）

## 結構

```
wanfeng-erp/
├── supabase/
│   ├── migrations/          # 依序執行 001→008（007 示範租戶可選）
│   │   ├── 001_core.sql             # 租戶/方案/使用者/功能開關
│   │   ├── 002_inventory.sql        # 商品主檔+庫存異動帳本（append-only）
│   │   ├── 003_orders.sql           # 通路/客戶/訂單（冪等匯入、confirm_order RPC）
│   │   ├── 004_purchasing_shipping.sql  # 採購(移動平均成本)/退換貨/發票
│   │   ├── 005_reports.sql          # 儀表板/真毛利/庫存健康度 views
│   │   ├── 006_ai_cs.sql            # AI 客服模組（計量/額度帳本；引擎後接）
│   │   ├── 007_seed_demo.sql        # 示範租戶（正式租戶不跑）
│   │   ├── 008_frontend_support.sql # 註冊/邀請碼/POS 結帳/批次確認 RPC
│   │   └── 009_operator.sql         # 營運後台：開通租戶/方案管理/成本統計 RPC
│   └── functions/
│       └── ecpay-invoice/   # 綠界發票開立（v1 測試環境）
└── web/                     # 前端（沿用 DEMO 骨架拆模組）
```

## 部署步驟

1. **建 Supabase 專案** → SQL Editor 依序貼上執行 `001` → `009`（每檔執行成功再下一檔；007 僅示範環境跑）。
2. **建立第一個管理者**：Authentication 建立使用者後執行：
   ```sql
   insert into profiles (id, company_id, display_name, role)
   values ('<auth.users.id>', '<companies.id>', '幻翔管理', 'superadmin');
   ```
   租戶老闆帳號同法，role = 'owner'。
3. **Edge Function**：`supabase functions deploy ecpay-invoice`，並在 Secrets 設定
   `ECPAY_MERCHANT_ID=2000132`（綠界測試商店）、`ECPAY_HASH_KEY`、`ECPAY_HASH_IV`、`ECPAY_ENV=stage`。
4. **前端（GitHub Pages）**：
   - `web/js/config.js` 填 Supabase URL 與 anon key（anon key 本來就是公開金鑰，安全性由 RLS 保證）
   - 整個 repo 推上 GitHub → repo Settings → Pages → Source 選 **GitHub Actions**
   - 已附 `.github/workflows/pages.yml`：push main 即自動部署 `web/`，網址為 `https://<帳號>.github.io/<repo>/`
   - 不需要 Netlify / Render——後端全在 Supabase。

## 設計鐵則

- **庫存不可直改**：`products.current_stock` 僅由 `stock_movements` trigger 維護；異動表禁 UPDATE/DELETE。
- **訂單冪等**：`UNIQUE(company_id, channel_id, platform_order_no)`；`confirm_order()` 以狀態鎖保證只扣一次。
- **租戶隔離**：所有表 RLS `company_id = current_company_id()`；金鑰表無前端 policy，僅 service_role。
- **功能開關**：`feature_value(company, 'ai_cs')` = tenant_features 覆寫 → plan.features 預設。

## 方案（2026/08 拍板）

| 方案 | 月費 | AI 客服 |
|---|---|---|
| 標準版 | NT$1,500 | — |
| 旗艦版 | NT$3,000 | 含 1,000 則/月（額度帳本 cs_quota_ledger） |

## 待辦備忘

- 蝦皮 Chat API 白名單申請：**簽約後啟動**（需丸豐賣家帳號授權）。
- 蝦皮/露天/Yahoo 真實訂單 CSV 樣本到手後，校正匯入精靈欄位對映（v1 用公開格式）。
- 7-11 交貨便/黑貓 API、LINE 推播：介面已預留（channels.settings / integration_secrets）。
