// supabase/functions/xendit-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XENDIT_WEBHOOK_TOKEN = Deno.env.get('XENDIT_WEBHOOK_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const mapProvider = (code?: string | null): string | null => {
  if (!code) return null
  const c = String(code).toUpperCase()
  if (c.includes('GCASH')) return 'gcash'
  if (c.includes('MAYA') || c.includes('PAYMAYA')) return 'maya'
  return null
}

serve(async (req) => {
  try {
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
    // PAYMENT TOKEN ACTIVATION
    // ==================================================================
    if (event === 'payment_token.activation') {
      const { payment_token_id, customer_id, channel_code } = body.data

      let provider: string
      if (channel_code === 'GCASH' || channel_code === 'GCASH_LINK_AND_PAY') {
        provider = 'gcash'
      } else if (channel_code === 'PAYMAYA') {
        provider = 'maya'
      } else {
        return new Response('OK', { status: 200 })
      }

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('xendit_customer_id', customer_id)
        .single()

      if (userError || !user) return new Response('OK', { status: 200 })

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

      await supabase
        .from('user_payment_methods')
        .upsert(upsertPayload, { onConflict: 'user_id,provider' })

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

      const paymentId = data.payment_id || null
      const paymentRequestId =
        data.payment_request_id ||
        data.payment_request?.id ||
        data.payment_method?.payment_request_id ||
        null
      const paymentSessionId = data.payment_session_id || data.id || null

      const amount = Number(data.amount || 0)
      const status = String(data.status || '').toUpperCase()
      const channelCode =
        data?.channel_code ||
        data?.payment_method?.channel_code ||
        data?.payment_method?.type ||
        data?.payment_method?.ewallet?.channel_code ||
        null

      console.log('[SESSION.COMPLETED]', {
        paymentId, paymentRequestId, paymentSessionId, requestId, amount, status,
      })

      if (status !== 'COMPLETED') return new Response('OK', { status: 200 })
      if (!referenceId?.startsWith('delivery_') || !requestId) {
        return new Response('OK', { status: 200 })
      }

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('payment_status, payment_reference, payment_request_id, payment_provider')
        .eq('request_id', requestId)
        .maybeSingle()

      if (
        (reqRow?.payment_status === 'held' || reqRow?.payment_status === 'released') &&
        reqRow?.payment_reference?.startsWith('py-') &&
        reqRow?.payment_request_id
      ) {
        console.log('[SESSION.COMPLETED] Already complete, skipping')
        return new Response('OK', { status: 200 })
      }

      const resolvedProvider = mapProvider(channelCode) ?? reqRow?.payment_provider ?? null

      const updatePayload: Record<string, unknown> = {
        payment_status: 'held',
        escrow_status: 'held',
        paid_at: new Date().toISOString(),
      }
      if (resolvedProvider) updatePayload.payment_provider = resolvedProvider
      if (paymentId) updatePayload.payment_reference = paymentId
      if (paymentRequestId) updatePayload.payment_request_id = paymentRequestId
      if (paymentSessionId && !paymentId && !reqRow?.payment_reference) {
        updatePayload.payment_reference = paymentSessionId
      }

      console.log('[SESSION.COMPLETED] Writing', updatePayload)

      const { error: updErr } = await supabase
        .from('delivery_requests')
        .update(updatePayload)
        .eq('request_id', requestId)

      if (updErr) {
        console.error('[SESSION.COMPLETED] Update failed:', updErr)
        return new Response('OK', { status: 200 })
      }

      if (paymentId || paymentRequestId) {
        await supabase.from('escrow_transactions').insert({
          request_id: requestId,
          event: 'payment_succeeded',
          amount,
          provider: resolvedProvider,
          xendit_reference: paymentId || paymentRequestId,
          notes: `Session API payment completed. pr=${paymentRequestId ?? 'n/a'}, py=${paymentId ?? 'n/a'}`,
        })
      }

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // PAYMENT SESSION EXPIRED
    // ==================================================================
    if (event === 'payment_session.expired') {
      const data = body.data ?? body
      const sessionId = data.payment_session_id || data.id || null
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null

      console.log('[SESSION.EXPIRED]', { sessionId, requestId })

      if (!sessionId || !requestId) {
        return new Response('OK', { status: 200 })
      }

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('payment_status, payment_reference, delivery_status, payment_provider')
        .eq('request_id', requestId)
        .maybeSingle()

      if (!reqRow) return new Response('OK', { status: 200 })

      const shouldMark =
        reqRow.payment_status === 'processing' &&
        reqRow.payment_reference === sessionId

      if (!shouldMark) return new Response('OK', { status: 200 })

      await supabase
        .from('delivery_requests')
        .update({
          payment_status: 'failed',
          delivery_status: 'Cancelled',
        })
        .eq('request_id', requestId)
        .eq('payment_status', 'processing')
        .eq('payment_reference', sessionId)

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'payment_session_expired',
        amount: 0,
        provider: reqRow.payment_provider ?? null,
        xendit_reference: sessionId,
        notes: 'Xendit payment session expired without payment',
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // PAYMENT SUCCESS / CAPTURE
    // ==================================================================
    if (event === 'payment.succeeded' || event === 'payment.capture') {
      const data = body.data

      const paymentId = data.id || data.payment_id || data.capture_id || null
      const paymentRequestId =
        data.payment_request_id ||
        data.payment_request?.id ||
        null
      const referenceId = data.reference_id
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null
      const amount = Number(data.amount || 0)
      const channelCode =
        data?.channel_code ||
        data?.payment_method?.channel_code ||
        data?.payment_method?.type ||
        data?.payment_method?.ewallet?.channel_code ||
        null

      if (!paymentId && !paymentRequestId) return new Response('OK', { status: 200 })
      if (!referenceId?.startsWith('delivery_') || !requestId) {
        return new Response('OK', { status: 200 })
      }

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('payment_status, payment_reference, payment_request_id, payment_provider')
        .eq('request_id', requestId)
        .maybeSingle()

      const resolvedProvider = mapProvider(channelCode) ?? reqRow?.payment_provider ?? null

      const updatePayload: Record<string, unknown> = {
        payment_status: 'held',
        escrow_status: 'held',
      }
      if (resolvedProvider) updatePayload.payment_provider = resolvedProvider

      const needsPyRef = !reqRow?.payment_reference || reqRow.payment_reference.startsWith('ps-')
      if (needsPyRef && paymentId) {
        updatePayload.payment_reference = paymentId
        updatePayload.paid_at = new Date().toISOString()
      }
      if (!reqRow?.payment_request_id && paymentRequestId) {
        updatePayload.payment_request_id = paymentRequestId
      }

      const { error: updErr } = await supabase
        .from('delivery_requests')
        .update(updatePayload)
        .eq('request_id', requestId)

      if (updErr) {
        console.error('[PAYMENT.SUCCESS/CAPTURE] Update failed:', updErr)
        return new Response('OK', { status: 200 })
      }

      if (needsPyRef && paymentId) {
        await supabase.from('escrow_transactions').insert({
          request_id: requestId,
          event: 'payment_succeeded',
          amount,
          provider: resolvedProvider,
          xendit_reference: paymentId,
          notes: `Funds received. pr=${paymentRequestId ?? 'n/a'}`,
        })
      }

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // PAYMENT FAILED
    // ==================================================================
    if (event === 'payment.failed') {
      const data = body.data
      const referenceId = data.reference_id
      const requestIdRaw = data.metadata?.request_id
      const requestId = requestIdRaw ? Number(requestIdRaw) : null
      const reason =
        data.failure_reason || data.failure_code || data.description || 'Unknown'

      if (!referenceId?.startsWith('delivery_') || !requestId) {
        return new Response('OK', { status: 200 })
      }

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('payment_provider')
        .eq('request_id', requestId)
        .maybeSingle()

      await supabase
        .from('delivery_requests')
        .update({ payment_status: 'failed' })
        .eq('request_id', requestId)

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'payment_failed',
        amount: 0,
        provider: reqRow?.payment_provider ?? null,
        xendit_reference: data.id,
        notes: String(reason),
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // REFUND SUCCEEDED
    // ==================================================================
    if (event === 'refund.succeeded') {
      const refund = body.data ?? body
      const refundId = refund.id
      const paymentId = refund.payment_id ?? refund.payment_request_id ?? null
      const amount = Number(refund.amount || 0)

      if (!refundId && !paymentId) return new Response('OK', { status: 200 })

      let requestId: number | null = null
      let provider: string | null = null

      if (refundId) {
        const { data: r1 } = await supabase
          .from('delivery_requests')
          .select('request_id, payment_provider')
          .eq('refund_id', refundId)
          .maybeSingle()
        requestId = r1?.request_id ?? null
        provider = r1?.payment_provider ?? null
      }
      if (!requestId && paymentId) {
        const { data: r2 } = await supabase
          .from('delivery_requests')
          .select('request_id, payment_provider')
          .eq('payment_reference', paymentId)
          .maybeSingle()
        requestId = r2?.request_id ?? null
        provider = r2?.payment_provider ?? null
      }

      if (!requestId) return new Response('OK', { status: 200 })

      await supabase
        .from('delivery_requests')
        .update({
          payment_status: 'refunded',
          escrow_status: 'refunded',
          escrow_refunded_at: new Date().toISOString(),
          refund_status: 'succeeded',
          refund_id: refundId,
        })
        .eq('request_id', requestId)

      await supabase.from('escrow_transactions').insert({
        request_id: requestId,
        event: 'refunded',
        amount,
        provider,
        xendit_reference: refundId ?? paymentId,
        notes: 'Xendit refund settled',
      })

      return new Response('OK', { status: 200 })
    }

    // ==================================================================
    // REFUND FAILED
    // ==================================================================
    if (event === 'refund.failed') {
      const refund = body.data ?? body
      const refundId = refund.id
      const reason = refund.failure_reason || refund.description || 'Unknown'

      if (!refundId) return new Response('OK', { status: 200 })

      const { data: reqRow } = await supabase
        .from('delivery_requests')
        .select('request_id, payment_provider')
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
          provider: reqRow.payment_provider ?? null,
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