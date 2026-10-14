// supabase/functions/xendit-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XENDIT_WEBHOOK_TOKEN = Deno.env.get('XENDIT_WEBHOOK_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** Map Xendit channel codes → our internal provider names */
const mapProvider = (code?: string | null): string | null => {
  if (!code) return null
  const c = String(code).toUpperCase()
  if (c.includes('GCASH')) return 'gcash'
  if (c.includes('MAYA') || c.includes('PAYMAYA')) return 'maya'
  return null
}

serve(async (req) => {
  try {
    // 1. Verify webhook authenticity
    const callbackToken = req.headers.get('x-callback-token')
    if (callbackToken !== XENDIT_WEBHOOK_TOKEN) {
      console.error('[AUTH] Token mismatch')
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await req.json()
    console.log('[WEBHOOK] event:', body.event)

    const event = body.event
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ==================================================================
    // PAYMENT TOKEN ACTIVATION (linking GCash / Maya)
    // ==================================================================
    if (event === 'payment_token.activation') {
      const { payment_token_id, customer_id, channel_code } = body.data

      let provider: string
      if (channel_code === 'GCASH' || channel_code === 'GCASH_LINK_AND_PAY') {
        provider = 'gcash'
      } else if (channel_code === 'PAYMAYA') {
        provider = 'maya'
      } else {
        console.log(`[ACTIVATION] Unhandled channel: ${channel_code}`)
        return new Response('OK', { status: 200 })
      }

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('xendit_customer_id', customer_id)
        .single()

      if (userError || !user) {
        console.error('[ACTIVATION] User lookup failed:', userError)
        return new Response('OK', { status: 200 })
      }

      const { data: existing } = await supabase
        .from('user_payment_methods')
        .select('id')
        .eq('user_id', user.user_id)

      const isFirstMethod = !existing || existing.length === 0

      const upsertPayload: Record<string, unknown> = {
        user_id: user.user_id,
        provider,
        payment_token_id,
        linked_at: new Date().toISOString(),
      }
      if (isFirstMethod) upsertPayload.is_default = true

      const { error: upsertError } = await supabase
        .from('user_payment_methods')
        .upsert(upsertPayload, { onConflict: 'user_id,provider' })

      if (upsertError) {
        console.error('[ACTIVATION] Upsert failed:', upsertError)
        return new Response('OK', { status: 200 })
      }
      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // PAYMENT SESSION COMPLETED (Sessions API)
    // ==================================================================
    if (event === 'payment_session.completed') {
      const data = body.data
      const referenceId = data.reference_id
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null
      // Best-effort — the actual payment id we can refund against
      const paymentId =
        data.payment_id ||
        data.payment_request_id ||
        data.payment_session_id
      const amount = Number(data.amount || 0)
      const status = String(data.status || '').toUpperCase()
      const channelCode =
        data?.channel_code ||
        data?.payment_method?.channel_code ||
        data?.payment_method?.type ||
        null

      console.log('[SESSION.COMPLETED]', { paymentId, referenceId, requestId, amount, status })

      if (status !== 'COMPLETED') {
        console.log('[SESSION.COMPLETED] Status not COMPLETED, ignoring')
        return new Response('OK', { status: 200 })
      }
      if (!referenceId?.startsWith('delivery_') || !requestId) {
        console.log('[SESSION.COMPLETED] Not a delivery payment, ignoring')
        return new Response('OK', { status: 200 })
      }

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('payment_status')
        .eq('request_id', requestId)
        .maybeSingle()

      if (reqRow?.payment_status === 'held' || reqRow?.payment_status === 'released') {
        console.log('[SESSION.COMPLETED] Already processed, skipping')
        return new Response('OK', { status: 200 })
      }

      const { error: updErr } = await supabase
        .from('delivery_requests')
        .update({
          payment_status: 'held',
          escrow_status: 'held',
          paid_at: new Date().toISOString(),
          // ⭐ needed for refunds
          payment_reference: paymentId ?? null,
          payment_provider: mapProvider(channelCode),
        })
        .eq('request_id', requestId)

      if (updErr) {
        console.error('[SESSION.COMPLETED] Update failed:', updErr)
        return new Response('OK', { status: 200 })
      }

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'payment_succeeded',
        amount,
        xendit_reference: paymentId,
        notes: 'Session API payment completed, held in escrow',
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // DELIVERY PAYMENT SUCCESS (Payments API)
    // ==================================================================
    if (event === 'payment.succeeded' || event === 'payment.capture') {
      const data = body.data
      const paymentId = data.id
      const referenceId = data.reference_id
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null
      const amount = Number(data.amount || 0)
      const channelCode =
        data?.channel_code ||
        data?.payment_method?.channel_code ||
        data?.payment_method?.type ||
        null

      if (!referenceId?.startsWith('delivery_') || !requestId) {
        console.log('[PAYMENT.SUCCESS] Not a delivery payment, ignoring')
        return new Response('OK', { status: 200 })
      }

      const { error: updErr } = await supabase
        .from('delivery_requests')
        .update({
          payment_status: 'held',
          escrow_status: 'held',
          paid_at: new Date().toISOString(),
          payment_reference: paymentId ?? null,
          payment_provider: mapProvider(channelCode),
        })
        .eq('request_id', requestId)

      if (updErr) {
        console.error('[PAYMENT.SUCCESS] Update failed:', updErr)
        return new Response('OK', { status: 200 })
      }

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'payment_succeeded',
        amount,
        xendit_reference: paymentId,
        notes: 'Funds received, held in escrow',
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // DELIVERY PAYMENT FAILED
    // ==================================================================
    if (event === 'payment.failed') {
      const data = body.data
      const referenceId = data.reference_id
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null
      const reason =
        data.failure_reason || data.failure_code || data.description || 'Unknown'

      if (!referenceId?.startsWith('delivery_') || !requestId) {
        console.log('[PAYMENT.FAILED] Not a delivery payment, ignoring')
        return new Response('OK', { status: 200 })
      }

      await supabase
        .from('delivery_requests')
        .update({ payment_status: 'failed' })
        .eq('request_id', requestId)

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'payment_failed',
        amount: 0,
        xendit_reference: data.id,
        notes: String(reason),
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // REFUND SUCCEEDED — money is back with the sender
    // ==================================================================
    if (event === 'refund.succeeded') {
      const refund = body.data ?? body
      const refundId = refund.id
      const paymentId = refund.payment_id ?? refund.payment_request_id ?? null
      const amount = Number(refund.amount || 0)

      console.log('[REFUND.SUCCEEDED]', { refundId, paymentId, amount })

      if (!refundId && !paymentId) {
        return new Response('OK', { status: 200 })
      }

      // Find the matching request — prefer refund_id, fall back to payment_reference
      let requestId: number | null = null
      if (refundId) {
        const { data: r1 } = await supabase
          .from('delivery_requests')
          .select('request_id')
          .eq('refund_id', refundId)
          .maybeSingle()
        requestId = r1?.request_id ?? null
      }
      if (!requestId && paymentId) {
        const { data: r2 } = await supabase
          .from('delivery_requests')
          .select('request_id')
          .eq('payment_reference', paymentId)
          .maybeSingle()
        requestId = r2?.request_id ?? null
      }

      if (!requestId) {
        console.warn('[REFUND.SUCCEEDED] No matching request for refund', refundId)
        return new Response('OK', { status: 200 })
      }

      await supabase
        .from('delivery_requests')
        .update({
          payment_status: 'refunded',
          escrow_status: 'refunded',
          escrow_refunded_at: new Date().toISOString(),
          refund_status: 'succeeded',
        })
        .eq('request_id', requestId)

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'refunded',
        amount,
        xendit_reference: refundId ?? paymentId,
        notes: 'Xendit refund settled',
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // REFUND FAILED — money stays held, admin must intervene
    // ==================================================================
    if (event === 'refund.failed') {
      const refund = body.data ?? body
      const refundId = refund.id
      const reason = refund.failure_reason || refund.description || 'Unknown'

      console.log('[REFUND.FAILED]', { refundId, reason })

      if (!refundId) return new Response('OK', { status: 200 })

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('refund_id', refundId)
        .maybeSingle()

      if (reqRow?.request_id) {
        await supabase
          .from('delivery_requests')
          .update({
            refund_status: 'failed',
            payment_status: 'held',
            escrow_status: 'held',
          })
          .eq('request_id', reqRow.request_id)

        await supabase.from('escrow_transactions').insert({
          request_id: reqRow.request_id,
          event: 'refund_failed',
          amount: 0,
          xendit_reference: refundId,
          notes: `Refund failed: ${String(reason)}`,
        })
      }

      return new Response('OK', { status: 200 })
    }

    console.log('[WEBHOOK] Unhandled event:', event)
    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('[WEBHOOK] Unhandled error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})