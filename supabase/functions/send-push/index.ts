// supabase/functions/send-push/index.ts
// @ts-expect-error Deno resolves remote imports at runtime.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
// @ts-expect-error Deno resolves remote imports at runtime.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { user_id, title, body, data } = await req.json();
    if (!user_id || !title || !body) {
      return json({ success: false, error: 'user_id, title, body required' });
    }

    const { data: tokens, error } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', user_id);
    if (error) return json({ success: false, error: error.message });
    if (!tokens || tokens.length === 0) {
      return json({ success: true, delivered: 0, reason: 'no tokens' });
    }

    const messages = tokens.map((t: any) => ({
      to: t.token,
      sound: 'default',
      title,
      body,
      data: data ?? {},
      channelId: 'default',
      priority: 'high',
    }));

    const resp = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    });

    const result = await resp.json();

    // Prune stale tokens (DeviceNotRegistered) and collect real Expo errors
    const tickets = Array.isArray(result) ? result : (result.data ?? []);
    const deadTokens: string[] = [];
    const errors: Array<Record<string, unknown>> = [];
    let accepted = 0;
    tickets.forEach((t: any, i: number) => {
      if (t?.status === 'ok') {
        accepted++;
      } else if (t?.status === 'error') {
        errors.push({ error: t?.details?.error ?? null, message: t?.message ?? null });
        if (t?.details?.error === 'DeviceNotRegistered') deadTokens.push(tokens[i].token);
      }
    });
    if (deadTokens.length > 0) {
      await supabase.from('push_tokens').delete().in('token', deadTokens);
    }
    if (errors.length > 0) console.error('[send-push] expo errors:', JSON.stringify(errors));

    return json({ success: true, delivered: accepted, attempted: tokens.length, errors });
  } catch (e: any) {
    return json({ success: false, error: e?.message ?? 'Unexpected error' });
  }
});