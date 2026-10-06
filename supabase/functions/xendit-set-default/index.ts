// @ts-expect-error Deno resolves remote imports at runtime.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
// @ts-expect-error Deno resolves remote imports at runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: {
    get(name: string): string | undefined
  }
}

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

    // Reset all defaults
    await supabase
      .from('user_payment_methods')
      .update({ is_default: false })
      .eq('user_id', userId)

    // Set new default
    const { error } = await supabase
      .from('user_payment_methods')
      .update({ is_default: true })
      .eq('user_id', userId)
      .eq('provider', provider)

    if (error) throw new Error('Failed to set default')

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