// supabase/functions/generate-delivery-otp/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const jsonResponse = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

const rand6 = () => String(Math.floor(100000 + Math.random() * 900000));

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { action, delivery_id, otp } = await req.json();
    console.log(`[REQ] action=${action} delivery_id=${delivery_id}`);

    // ------------------------------------------------------------------
    // GENERATE — create a fresh system OTP for a delivery
    // ------------------------------------------------------------------
    if (action === 'generate') {
      if (!delivery_id) return jsonResponse({ success: false, error: 'delivery_id required' });

      const code = rand6();
      const expiry = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

      const { error } = await supabase
        .from('delivery_confirmations')
        .upsert(
          {
            delivery_id,
            system_otp: code,
            otp_expires_at: expiry,
            otp_verified: false,
            otp_verified_at: null,
            attempts: 0,
          },
          { onConflict: 'delivery_id' }
        );

      if (error) {
        console.error('[GENERATE] upsert failed:', error);
        return jsonResponse({ success: false, error: error.message });
      }

      console.log('[GENERATE] saved otp for delivery', delivery_id);
      return jsonResponse({ success: true, otp: code, expires_at: expiry });
    }

    // ------------------------------------------------------------------
    // VERIFY — courier enters the OTP the receiver read out
    // ------------------------------------------------------------------
    if (action === 'verify') {
      if (!delivery_id || !otp) {
        return jsonResponse({ success: false, message: 'delivery_id and otp required' });
      }

      const { data: row, error: fetchErr } = await supabase
        .from('delivery_confirmations')
        .select('system_otp, otp_verified, otp_expires_at, attempts')
        .eq('delivery_id', delivery_id)
        .maybeSingle();

      if (fetchErr) {
        console.error('[VERIFY] fetch error:', fetchErr);
        return jsonResponse({ success: false, message: 'Database error' });
      }
      if (!row) {
        return jsonResponse({ success: false, message: 'No OTP found for this delivery' });
      }
      if (row.otp_verified) {
        return jsonResponse({ success: true, already_verified: true });
      }
      if (row.otp_expires_at && new Date() > new Date(row.otp_expires_at)) {
        return jsonResponse({ success: false, message: 'OTP has expired. Ask the sender to send a new one.' });
      }
      if (String(row.system_otp) !== String(otp).trim()) {
        await supabase
          .from('delivery_confirmations')
          .update({ attempts: (row.attempts || 0) + 1 })
          .eq('delivery_id', delivery_id);
        return jsonResponse({ success: false, message: 'Incorrect code. Please try again.' });
      }

      const { error: updErr } = await supabase
        .from('delivery_confirmations')
        .update({ otp_verified: true, otp_verified_at: new Date().toISOString() })
        .eq('delivery_id', delivery_id);

      if (updErr) {
        console.error('[VERIFY] update error:', updErr);
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