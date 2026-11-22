// supabase/functions/xendit-refund/index.ts
// These imports are resolved by the Deno runtime used by Supabase Edge Functions.
// @ts-expect-error Deno URL import is unavailable to a non-Deno TypeScript language service.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error Deno URL import is unavailable to a non-Deno TypeScript language service.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const json = (b: Record<string, unknown>) =>
  new Response(JSON.stringify(b), { status: 200, headers: CORS_HEADERS });

/**
 * Send push notification + insert notification_log to sender for every Xendit refund.
 */
async function notifySenderOfRefund(opts: {
  supabase: any;
  supabaseUrl: string;
  supabaseKey: string;
  senderId: number | null;
  requestId: number;
  amount: number;
  isDepositRefund: boolean;
  isDisputeRefund: boolean;
  isSucceeded: boolean;
}) {
  const {
    supabase,
    supabaseUrl,
    supabaseKey,
    senderId,
    requestId,
    amount,
    isDepositRefund,
    isDisputeRefund,
    isSucceeded,
  } = opts;

  if (!senderId) return;

  const code = `PNS-${String(requestId).padStart(4, '0')}`;
  const amtText = `₱${Number(amount || 0).toFixed(2)}`;

  let title = isSucceeded ? 'Refund Completed' : 'Refund Initiated';
  let body = isSucceeded
    ? `Your refund of ${amtText} for parcel #${code} has been processed back to your wallet.`
    : `Your refund of ${amtText} for parcel #${code} has been submitted to Xendit and is now processing.`;

  if (isDepositRefund) {
    title = isSucceeded ? 'Return Deposit Refunded' : 'Return Deposit Refund Initiated';
    body = isSucceeded
      ? `Your Return-to-Sender deposit of ${amtText} for parcel #${code} has been refunded to your wallet.`
      : `Your Return-to-Sender deposit of ${amtText} for parcel #${code} is being refunded to your wallet.`;
  } else if (isDisputeRefund) {
    title = isSucceeded ? 'Dispute Refund Completed' : 'Dispute Refund Initiated';
    body = isSucceeded
      ? `A dispute refund of ${amtText} for parcel #${code} has been credited back to your wallet.`
      : `A dispute refund of ${amtText} for parcel #${code} has been submitted for processing.`;
  }

  try {
    await supabase.from('notification_log').insert({
      user_id: senderId,
      title,
      body,
      type: 'payment',
      ref_id: requestId,
    });
  } catch (e) {
    console.warn('[REFUND] notification_log insert failed:', e);
  }

  try {
    await fetch(`${supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: senderId,
        title,
        body,
        data: {
          type: 'refund',
          requestId,
          amount,
          role: 'sender',
        },
      }),
    });
  } catch (e) {
    console.warn('[REFUND] send-push failed:', e);
  }
}

async function resolvePaymentRequestId(
  requestId: number,
  supabase: any,
  paymentId: string | null,
  auth: string,
): Promise<string | null> {
  try {
    const { data: txRow } = await supabase
      .from('escrow_transactions')
      .select('notes')
      .eq('request_id', requestId)
      .eq('event', 'payment_succeeded')
      .not('notes', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (txRow?.notes) {
      const prMatch = String(txRow.notes).match(/pr=(pr-[a-zA-Z0-9-]+)/);
      if (prMatch?.[1]) {
        console.log('[REFUND] Extracted pr- from escrow_transactions notes:', prMatch[1]);
        return prMatch[1];
      }
    }
  } catch (e) {
    console.warn('[REFUND] DB notes lookup failed:', e);
  }

  if (!paymentId) return null;

  try {
    const r = await fetch(
      `https://api.xendit.co/transactions?types=PAYMENT&payment_id=${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: auth,
          'api-version': '2024-11-11',
        },
      },
    );
    if (r.ok) {
      const j = await r.json();
      const rows: any[] = Array.isArray(j?.data) ? j.data : [];
      for (const row of rows) {
        const pr = row?.payment_request_id || row?.payment_request?.id;
        if (pr) {
          console.log('[REFUND] Extracted pr- from /transactions:', pr);
          return pr;
        }
      }
    } else {
      console.warn('[REFUND resolve] GET /transactions failed:', r.status, await r.text());
    }
  } catch (e) {
    console.warn('[REFUND resolve] /transactions threw:', e);
  }

  return null;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const XENDIT_SECRET = Deno.env.get('XENDIT_SECRET_KEY');
    if (!XENDIT_SECRET) return json({ success: false, error: 'XENDIT_SECRET_KEY not set' });
    const auth = 'Basic ' + btoa(`${XENDIT_SECRET}:`);

    const {
      request_id,
      reason,
      amount: requestedAmount,
      is_dispute_refund,
    } = await req.json();

    if (!request_id) return json({ success: false, error: 'request_id required' });

    const isDisputeRefund = Boolean(is_dispute_refund);
    const hasExplicitAmount = typeof requestedAmount === 'number' && requestedAmount > 0;

    console.log('[REFUND] Looking up request:', { request_id, requestedAmount, isDisputeRefund });

    const { data: reqRow, error: reqErr } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, sender_id, estimated_cost, base_fare, return_deposit, delivery_status,
        payment_reference, payment_request_id,
        payment_status, escrow_status, refund_status, refund_id, payment_provider
      `)
      .eq('request_id', request_id)
      .maybeSingle();

    if (reqErr) return json({ success: false, error: 'Database error', detail: reqErr });
    if (!reqRow) return json({ success: false, error: 'request not found', request_id });

    console.log('[REFUND] Found row:', reqRow);

    // For normal (non-dispute) calls, skip if already refunded/pending.
    // For dispute refunds (e.g., partial refund after deposit was already refunded), allow a new refund call.
    if (!isDisputeRefund) {
      if (reqRow.refund_status === 'succeeded' || reqRow.refund_status === 'refunded') {
        return json({ success: true, already_refunded: true });
      }
      if (reqRow.refund_status === 'pending' || reqRow.refund_status === 'processing') {
        return json({ success: true, already_pending: true, refund_id: reqRow.refund_id });
      }
    }

    const isHeld =
      reqRow.payment_status === 'held' || reqRow.escrow_status === 'held';
    const isDepositRefundPending = reqRow.refund_status === 'deposit_refund_pending';
    const depositOnRow = Number(reqRow.return_deposit) || 0;
    const refundStatusNow = String(reqRow.refund_status ?? '').toLowerCase();
    const isReleased =
      ['released', 'completed'].includes(String(reqRow.payment_status || '').toLowerCase()) ||
      ['released', 'completed'].includes(String(reqRow.escrow_status || '').toLowerCase());
    const isDepositRetry =
      isReleased &&
      depositOnRow > 0 &&
      ['', 'deposit_refund_pending', 'failed', 'manual_required'].includes(refundStatusNow);

    const isMarkedRefunded =
      String(reqRow.payment_status || '').toLowerCase() === 'refunded' ||
      String(reqRow.escrow_status || '').toLowerCase() === 'refunded';
    const isDisputeRefundUnpaid =
      isDisputeRefund ||
      (isMarkedRefunded && ['', 'failed', 'manual_required'].includes(refundStatusNow));

    if (!isHeld && !isDepositRefundPending && !isDepositRetry && !isDisputeRefundUnpaid) {
      return json({
        success: false,
        error: `Cannot refund — status was ${reqRow.payment_status}/${reqRow.escrow_status}, refund_status=${reqRow.refund_status}`,
      });
    }
    if (!reqRow.payment_reference && !reqRow.payment_request_id) {
      return json({ success: false, error: 'No payment identifier on this request' });
    }

    const fullAmount = Number(reqRow.estimated_cost) || 0;
    const depositAmount = Number(reqRow.return_deposit) || 0;
    const isDepositOnlyRefund = !isDisputeRefund && (isDepositRefundPending || isDepositRetry) && depositAmount > 0;

    let refundAmount = fullAmount;
    if (hasExplicitAmount) {
      refundAmount = Math.min(requestedAmount, fullAmount);
    } else if (isDepositOnlyRefund) {
      refundAmount = depositAmount;
    }

    // Only cap to depositAmount when this is a deposit-only refund (NOT a dispute refund).
    if (!isDisputeRefund && !isHeld && isDepositOnlyRefund) {
      refundAmount = Math.min(refundAmount, depositAmount);
    }

    refundAmount = Math.round(refundAmount * 100) / 100;
    if (refundAmount <= 0) {
      return json({ success: false, error: 'Refund amount must be greater than 0.' });
    }

    const isPartialRefund = refundAmount < fullAmount;

    // ---- Resolve payment_request_id ----
    let paymentRequestId = reqRow.payment_request_id as string | null;
    if (!paymentRequestId && reqRow.payment_reference?.startsWith('pr-')) {
      paymentRequestId = reqRow.payment_reference;
    }
    if (!paymentRequestId && reqRow.payment_reference?.startsWith('py-')) {
      console.log('[REFUND] Resolving pr- id from py- id:', reqRow.payment_reference);
      paymentRequestId = await resolvePaymentRequestId(
        request_id,
        supabase,
        reqRow.payment_reference,
        auth,
      );
      if (paymentRequestId) {
        await supabase
          .from('delivery_requests')
          .update({ payment_request_id: paymentRequestId })
          .eq('request_id', request_id);
      }
    }

    if (!paymentRequestId) {
      return json({
        success: false,
        error:
          'Cannot auto-refund: payment_request_id unavailable and could not be resolved from Xendit. ' +
          'This delivery needs a manual refund via the Xendit dashboard.',
        payment_reference: reqRow.payment_reference,
        needs_manual: true,
      });
    }

    // ---- Pre-check: skip for dispute partial refunds so a previous deposit refund doesn't block it ----
    if (!isDisputeRefund) {
      try {
        const existingResp = await fetch(
          `https://api.xendit.co/refunds?payment_request_id=${encodeURIComponent(paymentRequestId)}`,
          {
            headers: {
              Authorization: auth,
              'api-version': '2024-11-11',
            },
          },
        );

        if (existingResp.ok) {
          const existingData = await existingResp.json();
          const refunds: any[] = Array.isArray(existingData?.data)
            ? existingData.data
            : Array.isArray(existingData)
              ? existingData
              : [];

          const live = refunds.find(
            (r: any) => r.status === 'PENDING' || r.status === 'SUCCEEDED',
          );

          if (live) {
            const now = new Date().toISOString();
            const isSucceeded = live.status === 'SUCCEEDED';

            const partialExisting = Number(live.amount ?? 0) < fullAmount;
            const liveUpdate: Record<string, unknown> = {
              refund_id: live.id,
              refund_status: isSucceeded ? 'succeeded' : 'pending',
              refund_requested_at: live.created
                ? new Date(live.created).toISOString()
                : now,
            };
            if (!partialExisting) {
              liveUpdate.payment_status = isSucceeded ? 'refunded' : 'refund_pending';
              liveUpdate.escrow_status = isSucceeded ? 'refunded' : 'held';
              if (isSucceeded) liveUpdate.escrow_refunded_at = now;
            } else if (isSucceeded) {
              liveUpdate.escrow_refunded_at = now;
            }

            await supabase
              .from('delivery_requests')
              .update(liveUpdate)
              .eq('request_id', request_id);

            return json({
              success: true,
              already_refunded: isSucceeded,
              already_pending: !isSucceeded,
              refund_id: live.id,
              status: live.status,
            });
          }
        }
      } catch (e) {
        console.warn('[REFUND] pre-check failed (continuing):', e);
      }
    }

    // ---- Submit refund ----
    const refundBody = {
      payment_request_id: paymentRequestId,
      amount: refundAmount,
      reason: reason || 'REQUESTED_BY_CUSTOMER',
    };

    console.log('[REFUND] POST /refunds', refundBody);

    const refundResp = await fetch('https://api.xendit.co/refunds', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        'Idempotency-key': `refund-req-${request_id}-${Date.now()}`,
      },
      body: JSON.stringify(refundBody),
    });

    const refundData = await refundResp.json();

    if (!refundResp.ok) {
      console.error('[REFUND] Xendit rejected:', refundData);

      const code = String(refundData?.error_code || '').toUpperCase();
      let actionable = refundData?.message || 'Xendit refund failed';

      if (code.includes('ALREADY_REFUNDED') || code.includes('MAXIMUM_REFUND')) {
        const alreadyUpdate: Record<string, unknown> = isPartialRefund
          ? { refund_status: 'succeeded', escrow_refunded_at: new Date().toISOString() }
          : {
              refund_status: 'succeeded',
              payment_status: 'refunded',
              escrow_status: 'refunded',
              escrow_refunded_at: new Date().toISOString(),
            };
        await supabase.from('delivery_requests').update(alreadyUpdate).eq('request_id', request_id);
        return json({ success: true, already_refunded: true, detail: refundData });
      }
      if (code.includes('INSUFFICIENT_BALANCE')) {
        actionable =
          'Xendit account balance is insufficient for this refund. Top up the Xendit disbursement balance and retry.';
      }
      if (code.includes('IDEMPOTENCY')) {
        actionable =
          'This refund was already attempted with the same key. Wait 24h or query Xendit refunds to reconcile.';
      }

      return json({
        success: false,
        error: actionable,
        error_code: code || null,
        detail: refundData,
        needs_manual: code.includes('INSUFFICIENT_BALANCE'),
      });
    }

    const now = new Date().toISOString();
    const isSucceeded = String(refundData?.status || '').toUpperCase() === 'SUCCEEDED';

    const updatePayload: Record<string, unknown> = {
      refund_id: refundData.id,
      refund_status: isSucceeded ? 'succeeded' : 'pending',
      refund_requested_at: now,
      payment_request_id: paymentRequestId,
    };

    if (!isPartialRefund) {
      updatePayload.payment_status = isSucceeded ? 'refunded' : 'refund_pending';
      if (isSucceeded) {
        updatePayload.escrow_status = 'refunded';
        updatePayload.escrow_refunded_at = now;
      }
    } else if (isSucceeded) {
      updatePayload.escrow_refunded_at = now;
    }

    await supabase
      .from('delivery_requests')
      .update(updatePayload)
      .eq('request_id', request_id);

    // Send push notification + in-app notification_log to sender
    await notifySenderOfRefund({
      supabase,
      supabaseUrl,
      supabaseKey,
      senderId: reqRow.sender_id ?? null,
      requestId: Number(request_id),
      amount: refundAmount,
      isDepositRefund: isDepositOnlyRefund,
      isDisputeRefund,
      isSucceeded,
    });

    return json({
      success: true,
      refund_id: refundData.id,
      status: refundData.status,
      amount: refundAmount,
    });
  } catch (e: any) {
    console.error('[REFUND] exception:', e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' });
  }
});
