// supabase/functions/xendit-refund/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const XENDIT_SECRET = Deno.env.get('XENDIT_SECRET_KEY');
    if (!XENDIT_SECRET) {
      return json({ success: false, error: 'XENDIT_SECRET_KEY not set' });
    }
    const auth = 'Basic ' + btoa(`${XENDIT_SECRET}:`);

    const { request_id, reason } = await req.json();
    if (!request_id) return json({ success: false, error: 'request_id required' });

    const { data: reqRow, error: reqErr } = await supabase
      .from('delivery_requests')
      .select('request_id, estimated_cost, payment_reference, payment_status, escrow_status, refund_status, refund_id')
      .eq('request_id', request_id)
      .maybeSingle();

    if (reqErr || !reqRow) {
      return json({ success: false, error: 'request not found' });
    }

    if (reqRow.refund_status === 'succeeded') {
      return json({ success: true, already_refunded: true });
    }
    if (reqRow.refund_status === 'pending') {
      return json({ success: true, already_pending: true, refund_id: reqRow.refund_id });
    }
    if (reqRow.payment_status !== 'held' && reqRow.escrow_status !== 'held') {
      return json({ success: false, error: `Cannot refund — status was ${reqRow.payment_status}/${reqRow.escrow_status}` });
    }
    if (!reqRow.payment_reference) {
      return json({ success: false, error: 'No payment_reference on this request' });
    }

    // ----------------------------------------------------------------
    // If payment_reference is the SESSION id, look up the actual payment
    // id first. Uncomment if needed:
    // ----------------------------------------------------------------
    // const sessionResp = await fetch(
    //   `https://api.xendit.co/payment_sessions/${reqRow.payment_reference}`,
    //   { headers: { Authorization: auth } },
    // );
    // const session = await sessionResp.json();
    // const paymentId = session?.payment_id;
    // ----------------------------------------------------------------

    const paymentId = reqRow.payment_reference; // adjust if using lookup above

    const refundBody = {
      payment_id: paymentId,
      amount: Number(reqRow.estimated_cost) || 0,
      reason: reason || 'USER_CANCELLED',
    };

    const refundResp = await fetch('https://api.xendit.co/refunds', {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        // Idempotency-Key makes retries safe
        'Idempotency-key': `refund-req-${request_id}`,
      },
      body: JSON.stringify(refundBody),
    });

    const refundData = await refundResp.json();
    if (!refundResp.ok) {
      console.error('[refund] Xendit rejected:', refundData);
      return json({
        success: false,
        error: refundData?.message || refundData?.error_code || 'Xendit refund failed',
        detail: refundData,
      });
    }

    // Mark pending — the webhook will flip it to succeeded/failed
    await supabase
      .from('delivery_requests')
      .update({
        refund_id: refundData.id,
        refund_status: 'pending',
        refund_requested_at: new Date().toISOString(),
        payment_status: 'refund_pending',
      })
      .eq('request_id', request_id);

    return json({ success: true, refund_id: refundData.id, status: refundData.status });
  } catch (e: any) {
    console.error('[refund] exception:', e);
    return json({ success: false, error: e?.message ?? 'Unexpected error' });
  }
});