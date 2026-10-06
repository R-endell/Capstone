// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const XENDIT_SECRET_KEY = Deno.env.get('XENDIT_SECRET_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId, provider } = await req.json()

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: method } = await supabase
      .from('user_payment_methods')
      .select('payment_token_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single()

    if (!method) {
      throw new Error('Payment method not found')
    }

    // Cancel the token on Xendit
    const cancelResponse = await fetch(
      `https://api.xendit.co/v3/payment_tokens/${method.payment_token_id}/cancel`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(XENDIT_SECRET_KEY + ':')}`,
          'api-version': '2024-11-11',
        },
      }
    )

    if (!cancelResponse.ok) {
      const errorText = await cancelResponse.text()
      console.error(`Xendit cancel failed: ${errorText}`)
      // Continue to delete from DB even if Xendit cancel fails
    }

    await supabase
      .from('user_payment_methods')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})