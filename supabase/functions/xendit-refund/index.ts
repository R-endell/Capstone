// supabase/functions/xendit-refund/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const json = (b: Record<string, unknown>) =>
  new Response(JSON.stringify(b), { status: 200, headers: CORS_HEADERS });

/**
 * Resolve `payment_request_id` (pr-...) for a row.
 * Strategy (in priority order):
 *   1. Read from escrow_transactions.notes (most reliable — was written
 *      by our own webhook at payment time, contains `pr=pr-xxx`)
 *   2. Fall back to Xendit API (may fail; only used for very old rows)
 */
async function resolvePaymentRequestId(
  requestId: number,
  supabase: any,
  paymentId: string | null,
  auth: string,
): Promise<string | null> {
  // ---- Strategy 1: escrow_transactions notes ----
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
      // Match "pr=pr-<uuid>" inside the notes string
      const prMatch = String(txRow.notes).match(/pr=(pr-[a-zA-Z0-9-]+)/);
      if (prMatch?.[1]) {
        console.log('[REFUND] Extracted pr- from escrow_transactions notes:', prMatch[1]);
        return prMatch[1];
      }
    }
  } catch (e) {
    console.warn('[REFUND] DB notes lookup failed:', e);
  }

  // ---- Strategy 2: Xendit API (best-effort) ----
  if (!paymentId) return null;

  // Try /transactions with a filter — this endpoint can resolve a py- id
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const XENDIT_SECRET = Deno.env.get('XENDIT_SECRET_KEY');
    if (!XENDIT_SECRET) return json({ success: false, error: 'XENDIT_SECRET_KEY not set' });
    const auth = 'Basic ' + btoa(`${XENDIT_SECRET}:`);

    const { request_id, reason } = await req.json();
    if (!request_id) return json({ success: false, error: 'request_id required' });

    console.log('[REFUND] Looking up request:', request_id, typeof request_id);

    const { data: reqRow, error: reqErr } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, estimated_cost, payment_reference, payment_request_id,
        payment_status, escrow_status, refund_status, refund_id, payment_provider
      `)
      .eq('request_id', request_id)
      .maybeSingle();

    if (reqErr) return json({ success: false, error: 'Database error', detail: reqErr });
    if (!reqRow) return json({ success: false, error: 'request not found', request_id });

    console.log('[REFUND] Found row:', reqRow);

    if (reqRow.refund_status === 'succeeded') return json({ success: true, already_refunded: true });
    if (reqRow.refund_status === 'pending' || reqRow.refund_status === 'processing') {
      return json({ success: true, already_pending: true, refund_id: reqRow.refund_id });
    }
    if (reqRow.payment_status !== 'held' && reqRow.escrow_status !== 'held') {
      return json({
        success: false,
        error: `Cannot refund — status was ${reqRow.payment_status}/${reqRow.escrow_status}`,
      });
    }
    if (!reqRow.payment_reference && !reqRow.payment_request_id) {
      return json({ success: false, error: 'No payment identifier on this request' });
    }

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

    // ---- Pre-check: does a refund already exist for this pr-? ----
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

          await supabase
            .from('delivery_requests')
            .update({
              refund_id: live.id,
              refund_status: isSucceeded ? 'succeeded' : 'pending',
              payment_status: isSucceeded ? 'refunded' : 'refund_pending',
              escrow_status: isSucceeded ? 'refunded' : 'held',
              refund_requested_at: live.created
                ? new Date(live.created).toISOString()
                : now,
              ...(isSucceeded ? { escrow_refunded_at: now } : {}),
            })
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

    // ---- Submit refund ----
    const amount = Number(reqRow.estimated_cost) || 0;
    const refundBody = {
      payment_request_id: paymentRequestId,
      amount,
      reason: reason || 'REQUESTED_BY_CUSTOMER',
    };

    console.log('[REFUND] POST /refunds', refundBody);

    const refundResp = await fetch('https://api.xendit.co/refunds', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        // Timestamp ensures retries after transient failures work
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
        await supabase
          .from('delivery_requests')
          .update({
            refund_status: 'succeeded',
            payment_status: 'refunded',
            escrow_status: 'refunded',
            escrow_refunded_at: new Date().toISOString(),
          })
          .eq('request_id', request_id);
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

    await supabase
      .from('delivery_requests')
      .update({
        refund_id: refundData.id,
        refund_status: 'pending',
        refund_requested_at: new Date().toISOString(),
        payment_status: 'refund_pending',
        payment_request_id: paymentRequestId,
      })
      .eq('request_id', request_id);

    return json({ success: true, refund_id: refundData.id, status: refundData.status });
  } catch (e: any) {
    console.error('[REFUND] exception:', e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' });
  }
});