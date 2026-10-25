// supabase/functions/xendit-payout-webhook/index.ts
// @ts-ignore: Resolved by the Supabase Edge Functions Deno runtime.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-ignore: Resolved by the Supabase Edge Functions Deno runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const runtimeEnv = (globalThis as typeof globalThis & {
  Deno?: { env: { get(name: string): string | undefined } };
}).Deno?.env;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length || aBytes.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  try {
    // 1. Authenticate Xendit callback token in constant time
    const expectedToken =
      runtimeEnv?.get('XENDIT_PAYOUT_WEBHOOK_TOKEN') ||
      runtimeEnv?.get('XENDIT_WEBHOOK_TOKEN') ||
      '';
    const incomingToken = req.headers.get('x-callback-token') || '';

    if (!expectedToken || !timingSafeEqualStrings(incomingToken, expectedToken)) {
      console.warn('[xendit-payout-webhook] Invalid or missing x-callback-token');
      return new Response(JSON.stringify({ error: 'Unauthorized webhook callback' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const payload = await req.json();
    const event = String(payload?.event || '').trim();
    const data = payload?.data || payload;

    // 2. Validate Payouts v3 event structure
    const payoutId = String(data?.payout_id || data?.id || '').trim();
    const referenceId = String(data?.reference_id || '').trim();
    const xenditStatus = String(data?.status || '').toUpperCase().trim();
    const failureCode = data?.failure_code ? String(data.failure_code) : null;
    const failureMessage = data?.failure_message ? String(data.failure_message) : null;

    console.log(
      `[xendit-payout-webhook] event=${event} payout_id=${payoutId} ref=${referenceId} status=${xenditStatus} failure_code=${failureCode}`,
    );

    if (!payoutId && !referenceId) {
      return new Response(
        JSON.stringify({ received: true, ignored: true, reason: 'missing_identifiers' }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // Parse withdrawal_id from deterministic pns_wd_<id> reference if present
    let parsedWithdrawalId: number | null = null;
    if (referenceId.startsWith('pns_wd_')) {
      const n = Number(referenceId.replace('pns_wd_', ''));
      if (Number.isFinite(n) && n > 0) parsedWithdrawalId = n;
    }

    const supabase = createClient(
      runtimeEnv?.get('SUPABASE_URL') || '',
      runtimeEnv?.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    // 3. Settle atomically in Postgres (idempotent against duplicate & out-of-order callbacks)
    const { data: settlement, error: rpcErr } = await supabase.rpc(
      'finalize_withdrawal_settlement',
      {
        p_withdrawal_id: parsedWithdrawalId,
        p_xendit_payout_id: payoutId || null,
        p_reference_id: referenceId || null,
        p_event: event,
        p_xendit_status: xenditStatus,
        p_failure_code: failureCode,
        p_failure_message: failureMessage,
      },
    );

    if (rpcErr) {
      console.error('[xendit-payout-webhook] RPC error:', rpcErr);
      // Return 500 on transient DB errors so Xendit retries webhook delivery
      return new Response(JSON.stringify({ error: 'Database settlement error' }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }

    if (!settlement?.matched) {
      console.warn(
        `[xendit-payout-webhook] No matching withdrawal_requests row for payout_id=${payoutId} ref=${referenceId}`,
      );
      return new Response(
        JSON.stringify({ received: true, matched: false }),
        { status: 200, headers: JSON_HEADERS },
      );
    }

    // 4. Send in-app and push notification ONLY if status actually transitioned
    if (settlement.status_changed && settlement.provider_id) {
      const amountFormatted = `₱${Number(settlement.amount || 0).toFixed(2)}`;
      const methodLabel =
        String(settlement.method || '').toLowerCase() === 'maya' ? 'Maya' : 'GCash';

      let title = 'Cashout Update';
      let body = `Your cashout of ${amountFormatted} to ${methodLabel} is now ${settlement.status}.`;

      if (settlement.status === 'Completed') {
        title = 'Cashout Completed ✅';
        body = `${amountFormatted} has been sent to your ${methodLabel} account.`;
      } else if (settlement.status === 'Pending_Compliance') {
        title = 'Cashout Under Review';
        body = `Your ${amountFormatted} cashout to ${methodLabel} is undergoing standard compliance verification.`;
      } else if (settlement.status === 'Failed' || settlement.status === 'Rejected') {
        title = 'Cashout Failed — Balance Restored';
        body = `Your ${amountFormatted} cashout to ${methodLabel} failed (${failureCode || 'Gateway rejected'}). ${amountFormatted} has been restored to your wallet.`;
      } else if (settlement.status === 'Reversed') {
        title = 'Cashout Reversed — Balance Restored';
        body = `Your ${amountFormatted} payout was reversed by ${methodLabel}. ${amountFormatted} has been returned to your Pack-N-Ship wallet.`;
      }

      try {
        await supabase.rpc('_notify', {
          p_user: settlement.provider_id,
          p_title: title,
          p_body: body,
          p_ref: settlement.withdrawal_id,
        });
      } catch (e) {
        console.warn('[xendit-payout-webhook] _notify warning:', e);
      }

      try {
        await supabase.functions.invoke('send-push', {
          body: {
            user_id: settlement.provider_id,
            title,
            body,
            data: {
              type: 'withdrawal',
              withdrawalId: settlement.withdrawal_id,
              status: settlement.status,
            },
          },
        });
      } catch (e) {
        console.warn('[xendit-payout-webhook] send-push warning:', e);
      }
    }

    return new Response(
      JSON.stringify({
        received: true,
        matched: true,
        withdrawal_id: settlement.withdrawal_id,
        status: settlement.status,
        idempotent_noop: !!settlement.idempotent_noop,
      }),
      { status: 200, headers: JSON_HEADERS },
    );
  } catch (err: any) {
    console.error('[xendit-payout-webhook] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Webhook processing error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
});