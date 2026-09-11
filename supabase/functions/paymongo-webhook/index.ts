import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const PAYMONGO_WEBHOOK_SECRET = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Verify webhook signature
async function verifySignature(payload: string, signature: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(PAYMONGO_WEBHOOK_SECRET);
    const payloadData = encoder.encode(payload);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBytes = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
    const signatureHex = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return signatureHex === signature;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  try {
    // Verify webhook signature
    const signature = req.headers.get('paymongo-signature') || '';
    const bodyText = await req.text();
    
    if (!await verifySignature(bodyText, signature)) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
    }

    const webhookData = JSON.parse(bodyText);
    const event = webhookData.data;

    console.log('🔴 Webhook received:', event.type);

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment.paid':
        // ✅ Payment successful – activate the payment method
        const paymentIntentId = event.data.attributes.payment_intent_id;
        const paymentMethodId = event.data.attributes.payment_method;
        
        if (paymentMethodId) {
          // Update the payment method status to active
          const { error: updateError } = await supabase
            .from('payment_methods')
            .update({ status: 'active' })
            .eq('paymongo_payment_method_id', paymentMethodId);
          
          if (updateError) {
            console.error('Failed to update payment method:', updateError);
          } else {
            console.log('✅ Payment method activated:', paymentMethodId);
          }
        }
        break;

      case 'payment.failed':
        // Handle failed payment
        const failedIntentId = event.data.attributes.payment_intent_id;
        const errorMessage = event.data.attributes.error?.message || 'Payment failed';
        console.error('Payment failed:', failedIntentId, errorMessage);
        break;

      default:
        console.log('Unhandled webhook event:', event.type);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500 }
    );
  }
});