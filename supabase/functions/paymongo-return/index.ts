import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(async (req) => {
  const url = new URL(req.url);
  const params = url.searchParams;

  const paymentIntentId = params.get('payment_intent_id');
  const paymentMethodId = params.get('payment_method_id');
  const status = params.get('status');

  const appScheme = 'packnship';
  const deepLink = new URL(`${appScheme}://payment/callback`);
  if (paymentIntentId) deepLink.searchParams.set('payment_intent_id', paymentIntentId);
  if (paymentMethodId) deepLink.searchParams.set('payment_method_id', paymentMethodId);
  if (status) deepLink.searchParams.set('status', status);

  return new Response(null, {
    status: 302,
    headers: { Location: deepLink.toString() },
  });
});