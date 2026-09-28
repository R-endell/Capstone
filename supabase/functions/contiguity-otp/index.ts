// supabase/functions/contiguity-otp/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONTIGUITY_API_KEY = Deno.env.get('CONTIGUITY_API_KEY');
const CONTIGUITY_API_URL = 'https://api.contiguity.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, delivery_id, to, otp, name } = await req.json();

    console.log(`[REQUEST] action=${action} delivery_id=${delivery_id}`);

    // ====================================================================
    // SEND / REGENERATE — Create a fresh OTP and persist it
    // ====================================================================
    if (action === 'send' || action === 'regenerate') {
      let phoneNumber = to;
      let receiverName = name;

      if (action === 'regenerate') {
        const { data: requestData, error: reqErr } = await supabase
          .from('deliveries')
          .select(`
            delivery_id,
            delivery_requests!inner (
              receiver_phone,
              receiver:receivers (receiver_name, receiver_phone)
            )
          `)
          .eq('delivery_id', delivery_id)
          .single();

        if (reqErr || !requestData) {
          console.error('[REGENERATE] Delivery lookup failed:', reqErr);
          return jsonResponse({ success: false, error: 'Delivery not found' });
        }

        const dr: any = (requestData as any).delivery_requests;
        phoneNumber = dr?.receiver?.receiver_phone || dr?.receiver_phone;
        receiverName = dr?.receiver?.receiver_name || 'Receiver';
      }

      if (!phoneNumber) {
        console.error('[SEND] phoneNumber missing');
        return jsonResponse({ success: false, error: 'Receiver phone number missing' });
      }

      // Normalize to E.164
      let e164 = String(phoneNumber).replace(/\s+/g, '').replace(/-/g, '');
      if (e164.startsWith('0')) e164 = '+63' + e164.slice(1);
      else if (e164.startsWith('63')) e164 = '+' + e164;
      else if (!e164.startsWith('+')) e164 = '+63' + e164;

      console.log('[SEND] calling Contiguity for', e164);

      const response = await fetch(`${CONTIGUITY_API_URL}/otp/new`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CONTIGUITY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: e164,
          language: 'en',
          name: receiverName || 'PNS Delivery',
        }),
      });

      const result = await response.json();
      console.log('[SEND] Contiguity status:', response.status, 'body:', JSON.stringify(result));

      if (!response.ok) {
        return jsonResponse({
          success: false,
          error: result.error || result.data?.error || result.message || 'Failed to send OTP',
        });
      }

      const otpId = extractOtpId(result);
      if (!otpId) {
        console.error('[SEND] Contiguity did not return an otp_id:', result);
        return jsonResponse({ success: false, error: 'Contiguity did not return otp_id' });
      }

      console.log('[SEND] extracted otpId:', otpId);

      const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // STEP 1: Try UPDATE (row almost always exists for a delivery)
      const { data: updated, error: updateErr } = await supabase
        .from('delivery_confirmations')
        .update({
          contiguity_otp_id: otpId,
          otp_expires_at: expiry,
          otp_verified: false,
          otp_verified_at: null,
          attempts: 0,
        })
        .eq('delivery_id', delivery_id)
        .select('confirmation_id');

      if (updateErr) {
        console.error('[SEND] UPDATE failed:', updateErr);
        return jsonResponse({ success: false, error: 'Update failed: ' + updateErr.message });
      }

      console.log('[SEND] UPDATE affected rows:', updated?.length ?? 0);

      // STEP 2: If no row existed, INSERT
      if (!updated || updated.length === 0) {
        const { error: insertErr } = await supabase
          .from('delivery_confirmations')
          .insert({
            delivery_id,
            contiguity_otp_id: otpId,
            otp_expires_at: expiry,
            otp_verified: false,
            otp_verified_at: null,
            attempts: 0,
          });

        if (insertErr) {
          console.error('[SEND] INSERT failed:', insertErr);
          return jsonResponse({ success: false, error: 'Insert failed: ' + insertErr.message });
        }

        console.log('[SEND] INSERT succeeded');
      }

      console.log('[SEND] saved otp_id:', otpId, 'for delivery', delivery_id);
      return jsonResponse({ success: true, otp_id: otpId });
    }

    // ====================================================================
    // VERIFY
    // ====================================================================
    if (action === 'verify') {
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
          message: 'Confirmation record not found. Ask the sender to resend the OTP.',
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
          message: 'OTP has expired. Please send a new OTP.',
        });
      }

      console.log('[VERIFY] calling Contiguity with otp_id:', confirmation.contiguity_otp_id, 'otp:', otp);

      let verifyResult: any = null;
      let contiguityStatus = 0;
      try {
        const response = await fetch(`${CONTIGUITY_API_URL}/otp/verify`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CONTIGUITY_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            otp_id: confirmation.contiguity_otp_id,
            otp: String(otp).trim(),
          }),
        });
        contiguityStatus = response.status;
        verifyResult = await response.json();
      } catch (fetchErr) {
        console.error('Contiguity verify fetch error:', fetchErr);
        return jsonResponse({ success: false, message: 'Verification service unavailable' });
      }

      console.log('[VERIFY] Contiguity status:', contiguityStatus);
      console.log('[VERIFY] Contiguity body:', JSON.stringify(verifyResult));

      const { verified, message } = extractVerified(verifyResult);

      if (!verified) {
        // Increment attempts so repeated failures are visible in DB
        await supabase
          .from('delivery_confirmations')
          .update({ attempts: (confirmation.attempts || 0) + 1 })
          .eq('delivery_id', delivery_id);

        const failMessage =
          message ||
          verifyResult?.data?.error ||
          verifyResult?.error ||
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