// supabase/functions/send-push/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const json = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: CORS_HEADERS });

serve(async (req) => {
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

    // Prune stale tokens (DeviceNotRegistered)
    const tickets = Array.isArray(result) ? result : (result.data ?? []);
    const deadTokens: string[] = [];
    tickets.forEach((t: any, i: number) => {
      if (t?.status === 'error' && t?.details?.error === 'DeviceNotRegistered') {
        deadTokens.push(tokens[i].token);
      }
    });
    if (deadTokens.length > 0) {
      await supabase.from('push_tokens').delete().in('token', deadTokens);
    }

    return json({ success: true, delivered: tokens.length });
  } catch (e: any) {
    return json({ success: false, error: e?.message ?? 'Unexpected error' });
  }
});