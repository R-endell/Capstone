import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XENDIT_SECRET_KEY = Deno.env.get('XENDIT_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { requestId, provider } = await req.json()
    if (!requestId || !provider) throw new Error('Missing requestId or provider')
    if (!['gcash', 'maya'].includes(provider)) throw new Error('Invalid provider')

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 1. Load request
    const { data: reqRow, error: reqErr } = await supabase
      .from('delivery_requests')
      .select('request_id, sender_id, estimated_cost, payment_status, payment_reference')
      .eq('request_id', requestId)
      .single()

    if (reqErr || !reqRow) throw new Error('Delivery request not found')

    // Idempotency: already paid
    if (reqRow.payment_status === 'held' || reqRow.payment_status === 'released') {
      return new Response(JSON.stringify({ status: 'held', message: 'Already paid' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Idempotency: a session already exists for this request
    if (reqRow.payment_reference && reqRow.payment_status === 'processing') {
      return new Response(
        JSON.stringify({
          status: 'processing',
          message: 'A payment session is already active for this request.',
          payment_reference: reqRow.payment_reference,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Load user's Xendit customer
    const { data: user } = await supabase
      .from('users')
      .select('xendit_customer_id')
      .eq('user_id', reqRow.sender_id)
      .single()

    if (!user?.xendit_customer_id) {
      throw new Error('No Xendit customer record. Link a payment method first.')
    }

    const amount = Number(reqRow.estimated_cost)
    if (!amount || amount <= 0) throw new Error('Invalid amount')

    // 3. Create PAY session
    const referenceId = `delivery_${requestId}_${Date.now()}`
    const channelCode = provider === 'gcash' ? 'GCASH' : 'PAYMAYA'

    const sessionPayload = {
      reference_id: referenceId,
      session_type: 'PAY',
      mode: 'PAYMENT_LINK',
      amount,
      currency: 'PHP',
      country: 'PH',
      customer_id: user.xendit_customer_id,
      allowed_payment_channels: [channelCode],
      success_return_url: `${SUPABASE_URL}/functions/v1/redirect-bridge?to=payment-success&requestId=${requestId}`,
      cancel_return_url: `${SUPABASE_URL}/functions/v1/redirect-bridge?to=payment-cancel&requestId=${requestId}`,
      metadata: {
        request_id: String(requestId),
        user_id: String(reqRow.sender_id),
        kind: 'delivery_payment',
      },
    }

    console.log('[CHARGE] Creating session', { requestId, provider, amount, channelCode })

    const sessionResponse = await fetch('https://api.xendit.co/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(XENDIT_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionPayload),
    })

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text()
      console.error('[CHARGE_SESSION_FAIL]', sessionResponse.status, errorText)
      throw new Error(`Xendit session failed: ${errorText}`)
    }

    const sessionData = await sessionResponse.json()
    const sessionRef =
      sessionData.payment_session_id ||
      sessionData.session_id ||
      sessionData.id ||
      null

    if (!sessionRef) {
      // We created a live Xendit session but have no local ID for it.
      // DO NOT write to delivery_requests — leaving it as 'unpaid' means
      // the client's back-out cleanup can still safely delete it later.
      // The webhook will backfill payment_reference on completion.
      console.error(
        '[CHARGE] No session ID found in Xendit response. ' +
          'Row left as unpaid; webhook will reconcile on completion.',
        sessionData,
      )
      return new Response(
        JSON.stringify({
          status: 'processing',
          payment_url: sessionData.payment_link_url,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 4. Update request with the real session reference
    const { error: updErr } = await supabase
      .from('delivery_requests')
      .update({
        payment_status: 'processing',
        payment_provider: provider,
        payment_reference: sessionRef,
      })
      .eq('request_id', requestId)

    if (updErr) {
      console.error('[CHARGE] DB update failed:', updErr)
      // Don't throw — user can still pay; webhook will retry the update
    }

    // 5. Audit
    await supabase.from('escrow_transactions').insert({
      request_id: requestId,
      event: 'payment_initiated',
      amount,
      provider,
      xendit_reference: sessionRef,
    })

    return new Response(
      JSON.stringify({
        status: 'processing',
        payment_url: sessionData.payment_link_url,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('[CHARGE_UNHANDLED]', error?.message || error)
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})