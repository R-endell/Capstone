// @ts-ignore Deno resolves remote module imports at runtime.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-ignore Deno resolves remote module imports at runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

const XENDIT_WEBHOOK_TOKEN = Deno.env.get('XENDIT_WEBHOOK_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req: Request) => {
  try {
    // Verify webhook authenticity
    const callbackToken = req.headers.get('x-callback-token')
    if (callbackToken !== XENDIT_WEBHOOK_TOKEN) {
      return new Response('Unauthorized', { status: 401 })
    }

    const body = await req.json()
    const event = body.event

    if (event === 'payment_token.activation') {
      const { payment_token_id, customer_id, channel_code } = body.data

      // Map channel to provider
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

      const { data: user } = await supabase
        .from('users')
        .select('user_id')
        .eq('xendit_customer_id', customer_id)
        .single()

      if (!user) {
        console.error('User not found for customer:', customer_id)
        return new Response('OK', { status: 200 })
      }

      // Upsert — replaces existing token if user re-links
      await supabase
        .from('user_payment_methods')
        .upsert(
          {
            user_id: user.user_id,
            provider,
            payment_token_id,
            linked_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' }
        )
    }

    // Always return 200 immediately
    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
})