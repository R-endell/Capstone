// supabase/functions/xendit-disburse/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const XENDIT_BASE_URL = 'https://api.xendit.co';

// Deterministic Xendit Test Mode magic numbers from https://docs.xendit.co/docs/test-scenarios-payouts
const XENDIT_TEST_MAGIC_NUMBERS = new Set([
  '121212',   // INVALID_DESTINATION
  '999999',   // REJECTED_BY_CHANNEL
  '123456',   // TEMPORARY_TRANSFER_ERROR
  '98018521', // TRANSFER_ERROR
  '79018761', // SLS_RECIPIENT (with Walter White)
  '98109711', // SLS_SENDER
]);

// Deterministic HTTP 4xx creation error codes where Xendit guarantees NO payout was created
const DETERMINISTIC_CREATION_ERROR_CODES = new Set([
  'API_VALIDATION_ERROR',
  'INVALID_VALUE_ERROR',
  'CHANNEL_CODE_NOT_SUPPORTED',
  'RECIPIENT_ACCOUNT_NUMBER_ERROR',
  'MINIMUM_TRANSFER_LIMIT_ERROR',
  'MAXIMUM_TRANSFER_LIMIT_ERROR',
  'AMOUNT_INCREMENT_NOT_SUPPORTED',
  'REQUEST_FORBIDDEN_ERROR',
  'UNAUTHORIZED_ERROR',
]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function mapFriendlyRpcError(rawMessage: string): string {
  if (rawMessage.includes('ACTIVE_WITHDRAWAL_EXISTS')) {
    return 'You already have a cashout in progress. Please wait for it to finish before requesting another.';
  }
  if (rawMessage.includes('INSUFFICIENT_BALANCE')) {
    return 'Insufficient available wallet balance for this cashout amount.';
  }
  if (rawMessage.includes('MINIMUM_AMOUNT_ERROR')) {
    return 'Minimum cashout amount is ₱100.00.';
  }
  if (rawMessage.includes('MAXIMUM_AMOUNT_ERROR')) {
    return 'Maximum cashout amount per transaction is ₱50,000.00.';
  }
  if (rawMessage.includes('IDEMPOTENCY_PARAMETER_MISMATCH')) {
    return 'This cashout request key was already used with different details. Please reopen the cashout screen and try again.';
  }
  if (rawMessage.includes('WALLET_NOT_FOUND')) {
    return 'Your provider wallet is not initialized yet.';
  }
  if (rawMessage.includes('AUTHENTICATION_REQUIRED') || rawMessage.includes('USER_NOT_FOUND')) {
    return 'Session expired or unauthorized. Please sign in again.';
  }
  return 'Could not process cashout request. Please try again.';
}

function buildXenditPhpPayoutPayload(params: {
  referenceId: string;
  amountMajorPhp: number;
  method: 'gcash' | 'maya';
  accountNumber: string;
  accountHolderName: string;
}) {
  const channelCode =
    params.method === 'gcash'
      ? (Deno.env.get('XENDIT_PH_GCASH_CHANNEL_CODE') || 'PH_GCASH')
      : (Deno.env.get('XENDIT_PH_MAYA_CHANNEL_CODE') || 'PH_PAYMAYA');

  return {
    reference_id: params.referenceId,
    channel_code: channelCode,
    channel_properties: {
      account_holder_name: params.accountHolderName,
      account_number: params.accountNumber,
    },
    amount: Number(Number(params.amountMajorPhp).toFixed(2)),
    description: `Pack-N-Ship provider cashout #${params.referenceId}`,
    currency: 'PHP',
  };
}

async function postXenditPayoutWithTimeout(
  secretKey: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number; data: any; networkError?: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const basicAuth = btoa(`${secretKey}:`);
    const res = await fetch(`${XENDIT_BASE_URL}/v2/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Idempotency-key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text };
    }

    return { ok: res.ok, status: res.status, data: parsed };
  } catch (err: any) {
    console.error('[xendit-disburse] fetch exception / timeout:', err?.message || err);
    return {
      ok: false,
      status: 0,
      data: { message: err?.message || 'Network timeout calling Xendit Payouts API' },
      networkError: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function notifyProviderOfSettlement(
  serviceClient: any,
  settlement: any,
) {
  if (!settlement?.status_changed || !settlement?.provider_id) return;

  const amountFormatted = `₱${Number(settlement.amount || 0).toFixed(2)}`;
  const methodLabel = String(settlement.method || '').toLowerCase() === 'maya' ? 'Maya' : 'GCash';
  let title = 'Cashout Update';
  let body = `Your cashout of ${amountFormatted} to ${methodLabel} is now ${settlement.status}.`;

  if (settlement.status === 'Completed') {
    title = 'Cashout Completed ✅';
    body = `${amountFormatted} has been sent to your ${methodLabel} account.`;
  } else if (settlement.status === 'Failed' || settlement.status === 'Rejected') {
    title = 'Cashout Failed — Balance Restored';
    body = `Your ${amountFormatted} cashout to ${methodLabel} could not be completed. ${amountFormatted} has been returned to your wallet.`;
  } else if (settlement.status === 'Reversed') {
    title = 'Cashout Reversed — Balance Restored';
    body = `Your ${amountFormatted} transfer was reversed by ${methodLabel}. ${amountFormatted} has been restored to your Pack-N-Ship wallet.`;
  }

  try {
    await serviceClient.rpc('_notify', {
      p_user: settlement.provider_id,
      p_title: title,
      p_body: body,
      p_ref: settlement.withdrawal_id,
    });
  } catch (e) {
    console.warn('[xendit-disburse] _notify fallback warning:', e);
  }

  try {
    await serviceClient.functions.invoke('send-push', {
      body: {
        user_id: settlement.provider_id,
        title,
        body,
        data: { type: 'withdrawal', withdrawalId: settlement.withdrawal_id },
      },
    });
  } catch (e) {
    console.warn('[xendit-disburse] send-push warning:', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Authentication required. Please sign in again.' }, 401);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return jsonResponse({ error: 'Invalid or expired session. Please sign in again.' }, 401);
    }

    const xenditEnv = (Deno.env.get('XENDIT_ENV') || 'test').toLowerCase();
    const xenditSecretKey =
      Deno.env.get('XENDIT_PAYOUT_SECRET_KEY') ||
      Deno.env.get('XENDIT_SECRET_KEY') ||
      '';
    const fallbackMockEnabled =
      (Deno.env.get('XENDIT_DISBURSE_FALLBACK_MOCK') || 'false').toLowerCase() === 'true';

    if (!xenditSecretKey && !fallbackMockEnabled) {
      return jsonResponse(
        { error: 'Payout service secret key is not configured on the server.' },
        500,
      );
    }

    if (xenditEnv === 'test' && xenditSecretKey && !xenditSecretKey.startsWith('xnd_development_')) {
      console.error('[xendit-disburse] Blocked: XENDIT_ENV=test requires an xnd_development_ key.');
      return jsonResponse(
        { error: 'Server configuration error: Test Mode requires a Xendit development key.' },
        500,
      );
    }

    const body = await req.json();
    const action = String(body?.action || 'create').toLowerCase();

    // ========================================================================
    // ACTION: SAVE DESTINATION ONLY
    // ========================================================================
    if (action === 'save_destination') {
      const { data: walletResult, error: saveErr } = await userClient.rpc(
        'save_provider_payout_destination',
        {
          p_method: body.method,
          p_account_number: body.accountNumber,
          p_account_holder: body.accountHolderName || null,
        },
      );

      if (saveErr) {
        return jsonResponse({ error: mapFriendlyRpcError(saveErr.message) }, 400);
      }

      return jsonResponse({ success: true, wallet: walletResult });
    }

    // ========================================================================
    // ACTION: RECONCILE IN-FLIGHT WITHDRAWAL (Timeout / Status Check)
    // ========================================================================
    if (action === 'reconcile') {
      const withdrawalId = Number(body?.withdrawalId);
      if (!withdrawalId) {
        return jsonResponse({ error: 'withdrawalId is required for reconciliation.' }, 400);
      }

      const { data: wr, error: wrErr } = await userClient
        .from('withdrawal_requests')
        .select('*')
        .eq('withdrawal_id', withdrawalId)
        .maybeSingle();

      if (wrErr || !wr) {
        return jsonResponse({ error: 'Withdrawal record not found.' }, 404);
      }

      if (['Completed', 'Failed', 'Rejected', 'Reversed'].includes(wr.status)) {
        return jsonResponse({
          success: true,
          withdrawal: wr,
          message: `Withdrawal is already ${wr.status}.`,
        });
      }

      if (wr.xendit_payout_id && xenditSecretKey) {
        const basicAuth = btoa(`${xenditSecretKey}:`);
        const isV3 = String(wr.xendit_payout_id).startsWith('po-');
        const getUrl = isV3
          ? `${XENDIT_BASE_URL}/v3/payouts/${wr.xendit_payout_id}`
          : `${XENDIT_BASE_URL}/v2/payouts/${wr.xendit_payout_id}`;

        const headers: Record<string, string> = {
          Authorization: `Basic ${basicAuth}`,
        };
        if (isV3) headers['Api-version'] = '2025-09-01';

        const getRes = await fetch(getUrl, { method: 'GET', headers });

        if (getRes.ok) {
          const payoutObj = await getRes.json();
          const xStatus = String(payoutObj?.status || '').toUpperCase();
          const failCode = payoutObj?.failure_code || null;
          const failMsg = payoutObj?.failure_message || null;

          if (
            ['SUCCEEDED', 'FAILED', 'REVERSED', 'REJECTED', 'COMPLIANCE_REJECTED', 'CANCELLED'].includes(xStatus) ||
            xStatus.startsWith('PENDING_COMPLIANCE')
          ) {
            const { data: settled } = await serviceClient.rpc('finalize_withdrawal_settlement', {
              p_withdrawal_id: wr.withdrawal_id,
              p_xendit_payout_id: payoutObj.id || payoutObj.payout_id || wr.xendit_payout_id,
              p_reference_id: payoutObj.reference_id || wr.xendit_reference_id,
              p_event: `reconcile.${xStatus.toLowerCase()}`,
              p_xendit_status: xStatus === 'CANCELLED' ? 'FAILED' : xStatus,
              p_failure_code: failCode,
              p_failure_message: failMsg,
            });
            await notifyProviderOfSettlement(serviceClient, settled);
            return jsonResponse({ success: true, withdrawal: settled });
          }
        }
      }

      if (!wr.xendit_payout_id && wr.idempotency_key && xenditSecretKey) {
        const xenditIdemKey = `wd_${wr.withdrawal_id}_${wr.idempotency_key}`;
        const payload = buildXenditPhpPayoutPayload({
          referenceId: wr.xendit_reference_id || `pns_wd_${wr.withdrawal_id}`,
          amountMajorPhp: Number(wr.amount),
          method: String(wr.method).toLowerCase() === 'maya' ? 'maya' : 'gcash',
          accountNumber: wr.account_number,
          accountHolderName: wr.account_holder_name || 'Provider Partner',
        });

        const retryAttempt = await postXenditPayoutWithTimeout(
          xenditSecretKey,
          xenditIdemKey,
          payload,
        );

        const retryPayoutId = retryAttempt.data?.id || retryAttempt.data?.payout_id;
        if (retryAttempt.ok && retryPayoutId) {
          const { data: updated } = await serviceClient.rpc('record_xendit_payout_submission', {
            p_withdrawal_id: wr.withdrawal_id,
            p_xendit_payout_id: retryPayoutId,
            p_xendit_status: retryAttempt.data.status || 'ACCEPTED',
          });
          return jsonResponse({ success: true, withdrawal: updated });
        }
      }

      return jsonResponse({
        success: true,
        withdrawal: wr,
        message: 'Payout is still being processed by the gateway.',
      });
    }

    // ========================================================================
    // ACTION: CREATE CASHOUT (Default)
    // ========================================================================
    const amount = Number(body?.amount);
    const method = String(body?.method || '').toLowerCase() as 'gcash' | 'maya';
    const accountNumber = String(body?.accountNumber || '').replace(/\s+/g, '');
    const accountHolderName = String(body?.accountHolderName || '').trim();
    const idempotencyKey = String(body?.idempotencyKey || '').trim();
    const saveDestination = body?.saveDestination !== false;

    const isPhMobile = /^09\d{9}$/.test(accountNumber);
    const isTestMagicNumber = xenditEnv === 'test' && XENDIT_TEST_MAGIC_NUMBERS.has(accountNumber);

    if (!isPhMobile && !isTestMagicNumber) {
      return jsonResponse(
        {
          error:
            xenditEnv === 'test'
              ? 'Enter a valid 11-digit PH mobile number (09XXXXXXXXX) or a documented Xendit test scenario account number.'
              : 'Enter a valid 11-digit PH mobile number starting with 09.',
        },
        400,
      );
    }

    const { data: reservation, error: reserveErr } = await userClient.rpc(
      'reserve_provider_withdrawal',
      {
        p_amount: amount,
        p_method: method,
        p_account_number: accountNumber,
        p_account_holder: accountHolderName,
        p_idempotency_key: idempotencyKey,
        p_save_destination: saveDestination && isPhMobile,
      },
    );

    if (reserveErr || !reservation) {
      console.warn('[xendit-disburse] reserve_provider_withdrawal rejected:', reserveErr?.message);
      return jsonResponse(
        { error: mapFriendlyRpcError(reserveErr?.message || '') },
        400,
      );
    }

    if (
      reservation.is_existing &&
      (reservation.xendit_payout_id ||
        ['Completed', 'Failed', 'Rejected', 'Reversed'].includes(reservation.status))
    ) {
      return jsonResponse({
        success: !['Failed', 'Rejected', 'Reversed'].includes(reservation.status),
        idempotent_replay: true,
        withdrawal: reservation,
      });
    }

    const withdrawalId = Number(reservation.withdrawal_id);
    const referenceId = String(reservation.xendit_reference_id || `pns_wd_${withdrawalId}`);
    const xenditIdempotencyKey = `wd_${withdrawalId}_${idempotencyKey}`;

    if (fallbackMockEnabled && !xenditSecretKey) {
      const mockPayoutId = `disb-mock-${withdrawalId}-${Date.now()}`;
      await serviceClient.rpc('record_xendit_payout_submission', {
        p_withdrawal_id: withdrawalId,
        p_xendit_payout_id: mockPayoutId,
        p_xendit_status: 'ACCEPTED',
      });
      const { data: settled } = await serviceClient.rpc('finalize_withdrawal_settlement', {
        p_withdrawal_id: withdrawalId,
        p_xendit_payout_id: mockPayoutId,
        p_reference_id: referenceId,
        p_event: isTestMagicNumber ? 'payout.failed' : 'payout.succeeded',
        p_xendit_status: isTestMagicNumber ? 'FAILED' : 'SUCCEEDED',
        p_failure_code: isTestMagicNumber ? 'INVALID_DESTINATION' : null,
        p_failure_message: isTestMagicNumber ? 'Simulated invalid destination' : null,
      });
      await notifyProviderOfSettlement(serviceClient, settled);
      return jsonResponse({
        success: settled?.status === 'Completed',
        fallback_mock: true,
        withdrawal: settled,
      });
    }

    const payoutPayload = buildXenditPhpPayoutPayload({
      referenceId,
      amountMajorPhp: Number(reservation.amount),
      method,
      accountNumber,
      accountHolderName,
    });

    let xenditRes = await postXenditPayoutWithTimeout(
      xenditSecretKey,
      xenditIdempotencyKey,
      payoutPayload,
    );

    if (xenditRes.networkError || xenditRes.status >= 500) {
      console.warn(
        `[xendit-disburse] Ambiguous response (status=${xenditRes.status}) for withdrawal ${withdrawalId}; retrying once with same Idempotency-key...`,
      );
      xenditRes = await postXenditPayoutWithTimeout(
        xenditSecretKey,
        xenditIdempotencyKey,
        payoutPayload,
      );
    }

    if (xenditRes.ok && xenditRes.data) {
      const payoutId = String(xenditRes.data.id || xenditRes.data.payout_id || '');
      const xStatus = String(xenditRes.data.status || 'ACCEPTED').toUpperCase();

      const { data: recorded, error: recErr } = await serviceClient.rpc(
        'record_xendit_payout_submission',
        {
          p_withdrawal_id: withdrawalId,
          p_xendit_payout_id: payoutId,
          p_xendit_status: xStatus,
        },
      );

      if (recErr) {
        console.error('[xendit-disburse] record_xendit_payout_submission error:', recErr);
      }

      const instantTestSettle =
        xenditEnv === 'test' &&
        (Deno.env.get('XENDIT_INSTANT_TEST_SETTLE') || 'true').toLowerCase() === 'true';

      // Settle immediately if Xendit returned a terminal status OR if instant test settlement is enabled
      if (
        ['SUCCEEDED', 'FAILED', 'REJECTED', 'COMPLIANCE_REJECTED'].includes(xStatus) ||
        instantTestSettle
      ) {
        // Map Xendit's documented magic test numbers to their exact failure codes
        const magicFailureMap: Record<string, string> = {
          '121212': 'INVALID_DESTINATION',
          '999999': 'REJECTED_BY_CHANNEL',
          '123456': 'TEMPORARY_TRANSFER_ERROR',
          '98018521': 'TRANSFER_ERROR',
          '79018761': 'SLS_RECIPIENT',
          '98109711': 'SLS_SENDER',
        };
        const simulatedFailCode = isTestMagicNumber
          ? (magicFailureMap[accountNumber] || 'INVALID_DESTINATION')
          : null;
        const effectiveStatus =
          ['SUCCEEDED', 'FAILED', 'REJECTED', 'COMPLIANCE_REJECTED'].includes(xStatus)
            ? xStatus
            : isTestMagicNumber
            ? 'FAILED'
            : 'SUCCEEDED';

        const { data: settled } = await serviceClient.rpc('finalize_withdrawal_settlement', {
          p_withdrawal_id: withdrawalId,
          p_xendit_payout_id: payoutId,
          p_reference_id: referenceId,
          p_event: effectiveStatus === 'FAILED' ? 'payout.failed' : 'payout.succeeded',
          p_xendit_status: effectiveStatus,
          p_failure_code: xenditRes.data.failure_code || simulatedFailCode,
          p_failure_message:
            xenditRes.data.failure_message ||
            (simulatedFailCode ? `Simulated test failure: ${simulatedFailCode}` : null),
        });
        await notifyProviderOfSettlement(serviceClient, settled);
        return jsonResponse({
          success: settled?.status === 'Completed',
          withdrawal: settled,
        });
      }

      return jsonResponse({
        success: true,
        withdrawal: recorded || {
          ...reservation,
          status: 'Processing',
          xendit_payout_id: payoutId,
          xendit_status: xStatus,
        },
      });
    }

    if (xenditRes.networkError || xenditRes.status >= 500) {
      return jsonResponse({
        success: true,
        pending_reconciliation: true,
        withdrawal: {
          ...reservation,
          status: 'Processing',
        },
        message:
          'Your cashout request was submitted and is awaiting confirmation from the payment gateway.',
      });
    }

    const errCode = String(xenditRes.data?.error_code || 'API_VALIDATION_ERROR');
    const errDetails = xenditRes.data?.errors
      ? JSON.stringify(xenditRes.data.errors)
      : '';
    const errMsg = [xenditRes.data?.message, errDetails]
      .filter(Boolean)
      .join(' | ') || 'Payout request was rejected by the gateway.';

    console.error('[xendit-disburse] Xendit 4xx creation error:', {
      status: xenditRes.status,
      errCode,
      errMsg,
    });

    if (errCode === 'DUPLICATE_ERROR') {
      return jsonResponse(
        {
          error:
            'A payout with this request key is already being processed. Please check your withdrawal history.',
        },
        409,
      );
    }

    if (DETERMINISTIC_CREATION_ERROR_CODES.has(errCode) || (xenditRes.status >= 400 && xenditRes.status < 500)) {
      const { data: refundedRow } = await serviceClient.rpc('finalize_withdrawal_settlement', {
        p_withdrawal_id: withdrawalId,
        p_xendit_payout_id: null,
        p_reference_id: referenceId,
        p_event: 'creation_failed',
        p_xendit_status: 'FAILED',
        p_failure_code: errCode,
        p_failure_message: errMsg,
      });

      let friendlyGatewayMsg =
        `Payout could not be initiated (${errCode}: ${xenditRes.data?.message || errDetails}). Your full balance has been restored to your wallet.`;
      if (errCode === 'REQUEST_FORBIDDEN_ERROR' || xenditRes.status === 403) {
        friendlyGatewayMsg =
          'Xendit API key is missing Money-out Write permission. Your wallet balance has been restored.';
      }

      return jsonResponse(
        {
          error: friendlyGatewayMsg,
          gateway_error_code: errCode,
          gateway_message: errMsg,
          withdrawal: refundedRow,
        },
        400,
      );
    }

    return jsonResponse({ error: 'Unable to complete payout request right now.' }, 500);
  } catch (err: any) {
    console.error('[xendit-disburse] Unhandled error:', err);
    return jsonResponse(
      { error: 'An unexpected error occurred while processing your cashout.' },
      500,
    );
  }
});