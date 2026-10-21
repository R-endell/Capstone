// supabase/functions/redirect-bridge/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ALLOWED_SCHEMES = ['packnship://'];

function isAllowed(url: string): boolean {
  return ALLOWED_SCHEMES.some((s) => url.startsWith(s));
}

serve((req) => {
  const url = new URL(req.url);
  const legacyTo = url.searchParams.get('to');
  const redirectTo = url.searchParams.get('redirect_to');

  let target: string;

  if (redirectTo) {
    // New generic mode: forward all params to the deep link
    if (!isAllowed(redirectTo)) {
      return new Response('Invalid redirect target', { status: 400 });
    }
    const params = new URLSearchParams(url.searchParams);
    params.delete('redirect_to');
    params.delete('to');
    const qs = params.toString();
    target = qs ? `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}${qs}` : redirectTo;
  } else if (legacyTo) {
    // Legacy payment mode
    target = `packnship://${legacyTo}`;
  } else {
    target = 'packnship://payment-success';
  }

  // 302 redirect — browser will follow this and prompt to open the app
  return new Response(null, {
    status: 302,
    headers: { Location: target },
  });
});