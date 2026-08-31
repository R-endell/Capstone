import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;
const PAYMONGO_PUBLIC_KEY = Deno.env.get('PAYMONGO_PUBLIC_KEY')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  try {
    // --- 1. AUTHENTICATE USER ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    // Get user_id
    const { data: userData, error: userDataError } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();

    if (userDataError || !userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
    }

    const { payment_method_type, redirect_url } = await req.json();

    // --- 2. CHECK FOR DUPLICATES ---
    const { data: existing, error: checkError } = await supabase
      .from('payment_methods')
      .select('id, status')
      .eq('user_id', userData.user_id)
      .eq('payment_method_type', payment_method_type)
      .maybeSingle();

    if (checkError) {
      console.error('Check error:', checkError);
      return new Response(
        JSON.stringify({ error: 'Failed to check existing methods' }),
        { status: 500 }
      );
    }

    if (existing) {
      return new Response(
        JSON.stringify({ 
          error: `You already have a ${payment_method_type} payment method.`,
          existing_status: existing.status 
        }),
        { status: 409 }
      );
    }

    // --- 3. CREATE PAYMENT INTENT (REQUIRED FOR GCASH) ---
    // ✅ Fixed amount – you'll pass real amount from frontend later
    const amount = 10000; // ₱100.00 (in centavos)
    const description = `Add ${payment_method_type} payment method`;

    const intentResponse = await fetch('https://api.paymongo.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(PAYMONGO_SECRET_KEY)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            currency: 'PHP',
            payment_method_allowed: [payment_method_type],
            description,
          },
        },
      }),
    });

    const intentData = await intentResponse.json();

    if (!intentResponse.ok) {
      return new Response(
        JSON.stringify({ error: intentData.errors?.[0]?.detail || 'Failed to create Payment Intent' }),
        { status: intentResponse.status }
      );
    }

    const paymentIntent = intentData.data;

    // --- 4. CREATE PAYMENT METHOD ---
    const pmResponse = await fetch('https://api.paymongo.com/v1/payment_methods', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(PAYMONGO_SECRET_KEY)}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            type: payment_method_type,
          },
        },
      }),
    });

    const pmData = await pmResponse.json();

    if (!pmResponse.ok) {
      return new Response(
        JSON.stringify({ error: pmData.errors?.[0]?.detail || 'Failed to create Payment Method' }),
        { status: pmResponse.status }
      );
    }

    const paymentMethod = pmData.data;

    // --- 5. ATTACH PAYMENT METHOD TO PAYMENT INTENT ---
    const attachResponse = await fetch(
      `https://api.paymongo.com/v1/payment_intents/${paymentIntent.id}/attach`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(PAYMONGO_SECRET_KEY)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            attributes: {
              payment_method: paymentMethod.id,
              return_url: redirect_url,
            },
          },
        }),
      }
    );

    const attachData = await attachResponse.json();

    if (!attachResponse.ok) {
      return new Response(
        JSON.stringify({ error: attachData.errors?.[0]?.detail || 'Failed to attach payment method' }),
        { status: attachResponse.status }
      );
    }

    // --- 6. SAVE TO DATABASE ---
    const { data: inserted, error: insertError } = await supabase
      .from('payment_methods')
      .insert({
        user_id: userData.user_id,
        provider: 'paymongo',
        payment_method_type,
        paymongo_payment_method_id: paymentMethod.id,
        paymongo_payment_intent_id: paymentIntent.id,
        status: 'pending',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save payment method' }),
        { status: 500 }
      );
    }

    // --- 7. GET REDIRECT URL FROM ATTACH RESPONSE ---
    const redirect = attachData.data?.attributes?.next_action?.redirect?.url || null;

    return new Response(
      JSON.stringify({
        payment_method_id: inserted.id,
        paymongo_payment_method_id: paymentMethod.id,
        paymongo_payment_intent_id: paymentIntent.id,
        redirect_url: redirect,
        requires_action: !!redirect,
      }),
      { status: 200 }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500 }
    );
  }
});