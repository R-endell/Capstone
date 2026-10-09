// @ts-expect-error Deno resolves HTTPS imports at runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const deno = globalThis as typeof globalThis & {
  Deno: {
    env: { get(name: string): string | undefined }
    serve(handler: (req: Request) => Response | Promise<Response>): void
  }
}
const denoEnv = deno.Deno.env
const XENDIT_SECRET_KEY = denoEnv.get('XENDIT_SECRET_KEY')!
const SUPABASE_URL = denoEnv.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = denoEnv.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/** Strip commas (Xendit rejects them), collapse whitespace, cap length. */
const sanitizeName = (s: string | null | undefined): string =>
  (s || '')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)

/** Return E.164 (+63XXXXXXXXXX) only for valid PH mobiles, otherwise undefined. */
const normalizePhone = (raw: string | null | undefined): string | undefined => {
  const digits = (raw || '').replace(/\D/g, '')
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`
  if (/^639\d{9}$/.test(digits)) return `+${digits}`
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`
  return undefined
}

deno.Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { userId, provider } = await req.json()

    if (!userId || !provider) {
      return new Response(JSON.stringify({ error: 'Missing userId or provider' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Fetch user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('user_id, first_name, last_name, email, phone_number, xendit_customer_id')
      .eq('user_id', userId)
      .single()

    if (userError || !user) {
      console.error('[USER_LOOKUP_FAIL]', userError)
      throw new Error('User not found')
    }

    let customerId = user.xendit_customer_id

    // Create Xendit customer if not exists
    if (!customerId) {
      const givenName = sanitizeName(user.first_name) || 'Customer'
      const surname = sanitizeName(user.last_name) || 'User'
      const mobileNumber = normalizePhone(user.phone_number)

      console.log('[CUSTOMER_CREATE]', {
        userId,
        givenName,
        surname,
        email: user.email,
        hasPhone: Boolean(mobileNumber),
      })

      const customerPayload: Record<string, unknown> = {
        reference_id: `user_${userId}`,
        type: 'INDIVIDUAL',
        email: user.email,
        individual_detail: {
          given_names: givenName,
          surname,
        },
      }
      if (mobileNumber) customerPayload.mobile_number = mobileNumber

      const customerResponse = await fetch('https://api.xendit.co/customers', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(XENDIT_SECRET_KEY + ':')}`,
          'Content-Type': 'application/json',
          'api-version': '2020-10-31',
        },
        body: JSON.stringify(customerPayload),
      })

      if (!customerResponse.ok) {
        const errorText = await customerResponse.text()
        console.error('[XENDIT_CUSTOMER_FAIL]', customerResponse.status, errorText)
        throw new Error(`Xendit customer creation failed: ${errorText}`)
      }

      const customerData = await customerResponse.json()
      customerId = customerData.id

      await supabase
        .from('users')
        .update({ xendit_customer_id: customerId })
        .eq('user_id', userId)
    }

    // Create SAVE session with PAYMENT_LINK mode
    const channelCode = provider === 'gcash' ? 'GCASH_LINK_AND_PAY' : 'PAYMAYA'

    const sessionPayload = {
      reference_id: `link_${userId}_${provider}_${Date.now()}`,
      session_type: 'SAVE',
      mode: 'PAYMENT_LINK',
      amount: 0,
      currency: 'PHP',
      country: 'PH',
      customer_id: customerId,
      channel_code: channelCode,
      allowed_payment_channels: [channelCode],
      success_return_url:
        'https://ellqwkalvvedtyivdozd.supabase.co/functions/v1/redirect-bridge?to=payment-success',
      cancel_return_url:
        'https://ellqwkalvvedtyivdozd.supabase.co/functions/v1/redirect-bridge?to=payment-cancel',
    }

    console.log('[SESSION_CREATE]', { userId, provider, channelCode, customerId })

    const sessionResponse = await fetch('https://api.xendit.co/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(XENDIT_SECRET_KEY + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sessionPayload),
    })

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text()
      console.error('[XENDIT_SESSION_FAIL]', sessionResponse.status, errorText)
      throw new Error(`Xendit session creation failed: ${errorText}`)
    }

    const sessionData = await sessionResponse.json()

    return new Response(
      JSON.stringify({ payment_link_url: sessionData.payment_link_url }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    console.error('[UNHANDLED]', error?.message || error)
    return new Response(JSON.stringify({ error: error?.message || 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})