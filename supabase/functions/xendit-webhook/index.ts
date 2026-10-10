// supabase/functions/xendit-webhook/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XENDIT_WEBHOOK_TOKEN = Deno.env.get('XENDIT_WEBHOOK_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    // 1. Verify webhook authenticity
    const callbackToken = req.headers.get('x-callback-token')
    console.log('Received callback token:', callbackToken)
    console.log('Expected token:', XENDIT_WEBHOOK_TOKEN)
    
    if (callbackToken !== XENDIT_WEBHOOK_TOKEN) {
      console.error('Token mismatch!')
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await req.json()
    console.log('Webhook body:', JSON.stringify(body, null, 2))
    
    const event = body.event

    if (event === 'payment_token.activation') {
      const { payment_token_id, customer_id, channel_code } = body.data

      console.log('Processing activation:', { payment_token_id, customer_id, channel_code })

      let provider: string
      if (channel_code === 'GCASH' || channel_code === 'GCASH_LINK_AND_PAY') {
        provider = 'gcash'
      } else if (channel_code === 'PAYMAYA') {
        provider = 'maya'
      } else {
        console.log(`Unhandled channel: ${channel_code}`)
        return new Response('OK', { status: 200 })
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

      const { data: user, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('xendit_customer_id', customer_id)
        .single()

      if (userError) {
        console.error('User lookup error:', userError)
        return new Response('OK', { status: 200 })
      }

      if (!user) {
        console.error('User not found for customer:', customer_id)
        return new Response('OK', { status: 200 })
      }

      console.log('Found user:', user.user_id)

      // Check if this is the user's first payment method
const { data: existing } = await supabase
  .from('user_payment_methods')
  .select('id')
  .eq('user_id', user.user_id);

const isFirstMethod = !existing || existing.length === 0;

const upsertPayload: Record<string, unknown> = {
  user_id: user.user_id,
  provider,
  payment_token_id,
  linked_at: new Date().toISOString(),
};

if (isFirstMethod) {
  upsertPayload.is_default = true;
}

const { error: upsertError } = await supabase
  .from('user_payment_methods')
  .upsert(upsertPayload, { onConflict: 'user_id,provider' });

if (upsertError) {
  console.error('Upsert error:', upsertError);
  return new Response('OK', { status: 200 });
}

console.log('Saved payment method; is_default:', isFirstMethod);

      console.log('Successfully saved payment method')
    }

    // Always return 200 immediately
    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})