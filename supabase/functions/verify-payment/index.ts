import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { payment_method_id } = await req.json();

    // Get payment method from database
    const { data: paymentMethod, error: pmError } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('paymongo_payment_method_id', payment_method_id)
      .single();

    if (pmError || !paymentMethod) {
      return new Response(JSON.stringify({ error: 'Payment method not found' }), { status: 404 });
    }

    // Verify with PayMongo
    const paymongoResponse = await fetch(
      `https://api.paymongo.com/v1/payment_methods/${payment_method_id}`,
      {
        headers: {
          'Authorization': `Basic ${btoa(PAYMONGO_SECRET_KEY)}`,
        },
      }
    );

    const paymongoData = await paymongoResponse.json();

    if (!paymongoResponse.ok) {
      return new Response(
        JSON.stringify({ error: paymongoData.errors?.[0]?.detail || 'PayMongo error' }),
        { status: paymongoResponse.status }
      );
    }

    // Update status based on PayMongo response
    const status = paymongoData.data.attributes.status === 'active' ? 'active' : 'pending';

    const { data: updated, error: updateError } = await supabase
      .from('payment_methods')
      .update({ status })
      .eq('id', paymentMethod.id)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update payment method' }),
        { status: 500 }
      );
    }

    return new Response(JSON.stringify(updated), { status: 200 });
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500 }
    );
  }
});