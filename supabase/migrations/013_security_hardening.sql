-- ============================================================
-- 013 · 安全強化（2026-10 審查修正）
--   1. orders.invoice_status：發票開立原子鎖（防重複開立）
--   2. claim_order_invoice / finish_order_invoice：僅 service_role 可呼叫
--   3. advance_order：單向狀態轉換 + 角色檢查
--   4. confirm_orders：移除 `exception when others then null`，
--      逐筆回報失敗原因（回傳型別改為 jsonb）
-- 注意：請先在測試/staging 專案執行並驗證，勿直接套用正式資料庫。
-- ============================================================

-- ---------- 1. 發票狀態欄位 ----------
alter table orders
  add column if not exists invoice_status text not null default 'none',
  add column if not exists invoice_claimed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_invoice_status_check') then
    alter table orders add constraint orders_invoice_status_check
      check (invoice_status in ('none','issuing','issued','failed'));
  end if;
end $$;

-- 既有已開立的訂單回填為 issued
update orders set invoice_status = 'issued'
 where coalesce(invoice_no, '') <> '' and invoice_status <> 'issued';

-- ---------- 2. 發票開立原子鎖 ----------
-- 只有「尚未開立、未在開立中、狀態可開立」的訂單能被搶到鎖；
-- 同一訂單的並行/重試請求只有一個會拿到 true。
create or replace function claim_order_invoice(p_order uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update orders
     set invoice_status = 'issuing', invoice_claimed_at = now()
   where id = p_order
     and coalesce(invoice_no, '') = ''
     and invoice_status in ('none', 'failed')
     and status in ('confirmed','picking','packed','shipped','completed')
  returning id into v_id;
  return v_id is not null;
end $$;

-- 開立結束：成功寫回發票號；綠界明確回覆失敗則標 failed（允許重試）。
-- 結果不明（逾時/網路錯誤）時 Edge Function 不呼叫此函式，訂單保持 issuing，
-- 須人工至綠界後台核對後再處理（見 README）。
create or replace function finish_order_invoice(p_order uuid, p_ok boolean, p_invoice_no text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_ok and coalesce(p_invoice_no, '') = '' then
    raise exception '成功開立必須提供發票號碼';
  end if;
  update orders
     set invoice_status = case when p_ok then 'issued' else 'failed' end,
         invoice_no     = case when p_ok then p_invoice_no else invoice_no end
   where id = p_order and invoice_status = 'issuing';
end $$;

revoke all on function claim_order_invoice(uuid) from public, anon, authenticated;
revoke all on function finish_order_invoice(uuid, boolean, text) from public, anon, authenticated;
grant execute on function claim_order_invoice(uuid) to service_role;
grant execute on function finish_order_invoice(uuid, boolean, text) to service_role;

-- ---------- 3. 出貨狀態推進：單向 + 角色 ----------
create or replace function advance_order(p_order uuid, p_status text, p_tracking text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_role_();
  v_cur  text;
  v_rank_cur int;
  v_rank_new int;
  c_flow constant text[] := array['confirmed','picking','packed','shipped','completed'];
begin
  if v_role is null or v_role not in ('owner','store','shipping','superadmin') then
    raise exception using errcode = '42501', message = '權限不足：僅老闆/門市/出貨人員可更新出貨狀態';
  end if;
  if p_status not in ('picking','packed','shipped','completed') then
    raise exception using errcode = '22023', message = '無效狀態：' || coalesce(p_status, 'null');
  end if;

  select status into v_cur from orders
   where id = p_order and company_id = current_company_id()
   for update;
  if v_cur is null then
    raise exception using errcode = 'P0002', message = '訂單不存在或無權限';
  end if;

  v_rank_cur := array_position(c_flow, v_cur);
  v_rank_new := array_position(c_flow, p_status);
  if v_rank_cur is null then
    raise exception using errcode = '22023', message = '目前狀態「' || v_cur || '」不可推進出貨流程';
  end if;
  if v_rank_new <= v_rank_cur then
    raise exception using errcode = '22023', message = '狀態只能往前推進（目前：' || v_cur || '，要求：' || p_status || '）';
  end if;
  -- 可跳過揀貨/包裝直接出貨，但「完成」必須先出貨
  if p_status = 'completed' and v_cur <> 'shipped' then
    raise exception using errcode = '22023', message = '訂單須先出貨才能標記完成';
  end if;

  update orders set status = p_status,
    tracking_no = case when coalesce(p_tracking, '') <> '' then p_tracking else tracking_no end
  where id = p_order;
end $$;

-- ---------- 4. 批次確認：逐筆回報，不再吞錯 ----------
-- 回傳 {"confirmed": n, "failed": [{"id":..., "code":..., "message":...}]}
-- 預期中的業務錯誤（非 pending、庫存/約束違反、confirm_order 的 raise）逐筆記錄；
-- 其他未預期錯誤直接往上拋，整批回滾並把錯誤回給前端。
drop function if exists confirm_orders(uuid[]);
create function confirm_orders(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_n int := 0; v_status text;
  v_failed jsonb := '[]'::jsonb;
  v_state text; v_msg text;
begin
  foreach v_id in array coalesce(p_ids, '{}') loop
    select status into v_status from orders
     where id = v_id and company_id = current_company_id();
    if v_status is null then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'code', 'not_found', 'message', '訂單不存在或無權限');
      continue;
    end if;
    if v_status <> 'pending' then
      v_failed := v_failed || jsonb_build_object('id', v_id, 'code', 'not_pending',
                    'message', '非待確認狀態（目前：' || v_status || '）');
      continue;
    end if;
    begin
      perform confirm_order(v_id);
      v_n := v_n + 1;
    exception
      when raise_exception or check_violation or foreign_key_violation
        or not_null_violation or unique_violation then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_failed := v_failed || jsonb_build_object('id', v_id, 'code', v_state, 'message', v_msg);
    end;
  end loop;
  return jsonb_build_object('confirmed', v_n, 'failed', v_failed);
end $$;

revoke all on function confirm_orders(uuid[]) from public, anon;
grant execute on function confirm_orders(uuid[]) to authenticated;
