// supabase/functions/contiguity-otp/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONTIGUITY_API_KEY = Deno.env.get('CONTIGUITY_API_KEY');
const CONTIGUITY_API_URL = 'https://api.contiguity.com';

// Shown in the SMS as: "Your <APP_NAME> code is 123456"
const APP_NAME = 'PNS Delivery';
// Contiguity OTPs expire 15 minutes after sending (resending does not extend this).
const OTP_TTL_MS = 15 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// Always HTTP 200 so supabase.functions.invoke() hands the real error text back in `data`
// instead of collapsing it into a generic FunctionsHttpError.
const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

/** Normalize a Philippine (or already-international) number to E.164. Returns null if it can't be made valid. */
const normalizePhone = (raw: unknown): string | null => {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s\-().]/g, '');

  if (s.startsWith('+')) {
    // "+630917..." (user typed the leading 0 after the country code)
    if (s.startsWith('+630')) s = '+63' + s.slice(4);
  } else if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  } else if (s.startsWith('0')) {
    s = '+63' + s.slice(1); // 0917... -> +63917...
  } else if (s.startsWith('63')) {
    s = '+' + s; // 63917... -> +63917...
  } else {
    s = '+63' + s; // 917... -> +63917...
  }

  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
};

/** e.g. +639171234567 -> +63•••••••4567 (safe to return to the client) */
const maskPhone = (e164: string) => e164.slice(0, 3) + '•'.repeat(Math.max(e164.length - 7, 0)) + e164.slice(-4);

/** Helper: pull `verified` boolean from Contiguity's response regardless of shape */
const extractVerified = (result: any): { verified: boolean; message?: string } => {
  if (!result || typeof result !== 'object') {
    return { verified: false, message: 'Empty response' };
  }
  // Nested: { data: { verified: true } }
  if (result.data && typeof result.data === 'object' && typeof result.data.verified === 'boolean') {
    return { verified: result.data.verified, message: result.data.message || result.message };
  }
  // Direct: { verified: true, message: "..." }
  if (typeof result.verified === 'boolean') {
    return { verified: result.verified, message: result.message };
  }
  // Status flag: { status: "verified" | "success" | "ok" }
  if (typeof result.status === 'string') {
    const ok = ['verified', 'success', 'ok', 'valid'].includes(result.status.toLowerCase());
    return { verified: ok, message: result.message };
  }
  // Sometimes Contiguity returns { success: true } on verify
  if (typeof result.success === 'boolean') {
    return { verified: result.success, message: result.message };
  }
  // Also try valid flag
  if (typeof result.valid === 'boolean') {
    return { verified: result.valid, message: result.message };
  }
  return { verified: false, message: result.message || result.error || 'Unknown response shape' };
};

/** Helper: pull the OTP id from Contiguity's response. NEVER use `result.id` (that's the request id). */
const extractOtpId = (result: any): string | null => {
  if (!result || typeof result !== 'object') return null;
  return (
    result.data?.otp_id ||
    result.otp_id ||
    result.data?.id ||
    null
  );
};

/** POST to Contiguity with a timeout; never throws on non-JSON bodies. */
const callContiguity = async (path: string, body: Record<string, unknown>) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${CONTIGUITY_API_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONTIGUITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body — fall back to raw text in errors */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
};

/** Best-effort human-readable error out of a Contiguity response. */
const contiguityError = (r: { status: number; json: any; text: string }, fallback: string): string => {
  const e = r.json?.error ?? r.json?.data?.error ?? r.json?.message ?? r.json?.data?.message;
  if (typeof e === 'string' && e) return e;
  if (e) return JSON.stringify(e);
  return r.text ? r.text.slice(0, 200) : `${fallback} (HTTP ${r.status})`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, delivery_id, otp } = await req.json();

    console.log(`[REQUEST] action=${action} delivery_id=${delivery_id}`);

    if (!CONTIGUITY_API_KEY) {
      console.error('[CONFIG] CONTIGUITY_API_KEY secret is not set. Run: supabase secrets set CONTIGUITY_API_KEY=...');
      return jsonResponse({ success: false, error: 'SMS service is not configured' });
    }

    // ====================================================================
    // SEND / REGENERATE — Create a fresh OTP and persist it.
    // Both actions behave the same: the receiver's phone is ALWAYS read from
    // the database (never trusted from the client), and the confirmation row
    // is created if missing or reset if it already exists.
    //   'send'       -> call when pickup is verified (first OTP)
    //   'regenerate' -> call when the courier taps "Send New OTP"
    // ====================================================================
    if (action === 'send' || action === 'regenerate') {
      if (!delivery_id) return jsonResponse({ success: false, error: 'delivery_id is required' });

      // 1) Look up the receiver's phone from the delivery
      const { data: delivery, error: lookupErr } = await supabase
        .from('deliveries')
        .select(`
          delivery_id,
          delivery_requests!inner (
            receiver_phone,
            receiver:receivers (receiver_name, receiver_phone)
          )
        `)
        .eq('delivery_id', delivery_id)
        .maybeSingle();

      if (lookupErr || !delivery) {
        console.error('[SEND] Delivery lookup failed:', lookupErr);
        return jsonResponse({ success: false, error: 'Delivery not found' });
      }

      const pick = (v: any) => (Array.isArray(v) ? v[0] : v);
      const dr: any = pick((delivery as any).delivery_requests);
      const rcv: any = pick(dr?.receiver);
      const rawPhone = rcv?.receiver_phone || dr?.receiver_phone;

      const e164 = normalizePhone(rawPhone);
      if (!e164) {
        console.error('[SEND] Invalid receiver phone on record:', rawPhone);
        return jsonResponse({
          success: false,
          error: `Receiver phone number is missing or invalid (${rawPhone || 'empty'})`,
        });
      }

      // 2) Don't let a completed delivery be reset
      const { data: existing } = await supabase
        .from('delivery_confirmations')
        .select('otp_verified')
        .eq('delivery_id', delivery_id)
        .maybeSingle();

      if (existing?.otp_verified) {
        return jsonResponse({ success: false, error: 'This delivery has already been confirmed' });
      }

      // 3) Ask Contiguity to generate + text the code
      console.log('[SEND] calling Contiguity for', maskPhone(e164));

      let sendRes;
      try {
        sendRes = await callContiguity('/otp/new', { to: e164, language: 'en', name: APP_NAME });
      } catch (fetchErr: any) {
        console.error('[SEND] Contiguity request failed:', fetchErr);
        return jsonResponse({
          success: false,
          error: fetchErr?.name === 'AbortError' ? 'SMS service timed out' : 'SMS service unavailable',
        });
      }

      console.log('[SEND] Contiguity status:', sendRes.status, 'body:', sendRes.text);

      if (!sendRes.ok) {
        return jsonResponse({ success: false, error: contiguityError(sendRes, 'Failed to send OTP') });
      }

      const otpId = extractOtpId(sendRes.json);
      if (!otpId) {
        console.error('[SEND] Contiguity did not return an otp_id:', sendRes.text);
        return jsonResponse({
          success: false,
          error: `Contiguity did not return an otp_id: ${contiguityError(sendRes, 'no details')}`,
        });
      }

      // 4) Persist (delivery_confirmations.delivery_id is UNIQUE, so upsert is safe)
      const expiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

      const { error: saveErr } = await supabase
        .from('delivery_confirmations')
        .upsert(
          {
            delivery_id,
            contiguity_otp_id: otpId,
            otp_expires_at: expiry,
            otp_verified: false,
            otp_verified_at: null,
            attempts: 0,
          },
          { onConflict: 'delivery_id' }
        );

      if (saveErr) {
        console.error('[SEND] Saving confirmation failed:', saveErr);
        return jsonResponse({ success: false, error: 'Could not save OTP: ' + saveErr.message });
      }

      console.log('[SEND] OTP sent and saved. otp_id:', otpId, 'delivery:', delivery_id);
      return jsonResponse({ success: true, otp_id: otpId, sent_to: maskPhone(e164), expires_at: expiry });
    }

    // ====================================================================
    // VERIFY
    // ====================================================================
    if (action === 'verify') {
      if (!delivery_id) return jsonResponse({ success: false, message: 'delivery_id is required' });
      if (!otp) return jsonResponse({ success: false, message: 'OTP is required' });

      const { data: confirmation, error: fetchError } = await supabase
        .from('delivery_confirmations')
        .select('contiguity_otp_id, otp_verified, otp_expires_at, attempts')
        .eq('delivery_id', delivery_id)
        .maybeSingle();

      console.log('[VERIFY] confirmation row:', JSON.stringify(confirmation));

      if (fetchError) {
        console.error('DB fetch error:', fetchError);
        return jsonResponse({ success: false, message: 'Database error' });
      }
      if (!confirmation) {
        return jsonResponse({
          success: false,
          message: 'No OTP has been sent yet. Tap "Send New OTP" to text the receiver a code.',
        });
      }
      if (confirmation.otp_verified) {
        return jsonResponse({ success: true, already_verified: true });
      }
      if (!confirmation.contiguity_otp_id) {
        return jsonResponse({ success: false, message: 'OTP was never sent' });
      }

      // Local expiry check
      if (confirmation.otp_expires_at && new Date() > new Date(confirmation.otp_expires_at)) {
        console.log('[VERIFY] local expiry check says expired');
        return jsonResponse({
          success: false,
          message: 'OTP has expired. Tap "Send New OTP" to send a fresh code.',
        });
      }

      console.log('[VERIFY] calling Contiguity with otp_id:', confirmation.contiguity_otp_id);

      let verifyRes;
      try {
        verifyRes = await callContiguity('/otp/verify', {
          otp_id: confirmation.contiguity_otp_id,
          otp: String(otp).trim(),
        });
      } catch (fetchErr) {
        console.error('Contiguity verify fetch error:', fetchErr);
        return jsonResponse({ success: false, message: 'Verification service unavailable' });
      }

      console.log('[VERIFY] Contiguity status:', verifyRes.status, 'body:', verifyRes.text);

      const { verified, message } = extractVerified(verifyRes.json);

      if (!verified) {
        // Increment attempts so repeated failures are visible in DB
        await supabase
          .from('delivery_confirmations')
          .update({ attempts: (confirmation.attempts || 0) + 1 })
          .eq('delivery_id', delivery_id);

        const failMessage =
          message ||
          verifyRes.json?.data?.error ||
          verifyRes.json?.error ||
          'Invalid or expired OTP';

        console.log('[VERIFY] FAILED — message:', failMessage);
        return jsonResponse({ success: false, message: failMessage });
      }

      const { error: updateErr } = await supabase
        .from('delivery_confirmations')
        .update({ otp_verified: true, otp_verified_at: new Date().toISOString() })
        .eq('delivery_id', delivery_id);

      if (updateErr) {
        console.error('Failed to update otp_verified:', updateErr);
        return jsonResponse({ success: false, message: 'Failed to record verification' });
      }

      console.log('[VERIFY] SUCCESS for delivery', delivery_id);
      return jsonResponse({ success: true });
    }

    return jsonResponse({ success: false, error: `Invalid action: ${action}` });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return jsonResponse({ success: false, error: error?.message || 'Unexpected server error' });
  }
});