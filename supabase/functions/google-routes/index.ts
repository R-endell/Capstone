// @ts-nocheck
// supabase/functions/google-routes/index.ts
// Deploy: supabase functions deploy google-routes
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIELD_MASK =
  'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,' +
  'routes.travelAdvisory.speedReadingIntervals,' +
  'routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const validPoint = (p: any) =>
  p && typeof p.latitude === 'number' && typeof p.longitude === 'number' &&
  Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const key = Deno.env.get('GOOGLE_ROUTES_API_KEY');
  if (!key) return json({ error: 'GOOGLE_ROUTES_API_KEY is not set' }, 503);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { origin, destination } = body ?? {};
  if (!validPoint(origin) || !validPoint(destination)) {
    return json({ error: 'origin and destination need numeric latitude/longitude' }, 400);
  }

  const callGoogle = async (routingPreference: 'TRAFFIC_AWARE_OPTIMAL' | 'TRAFFIC_AWARE') => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const payload: Record<string, any> = {
        origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
        destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
        travelMode: 'DRIVE',
        routingPreference,
        computeAlternativeRoutes: false,
        languageCode: 'en-US',
        units: 'METRIC',
      };
      if (routingPreference === 'TRAFFIC_AWARE_OPTIMAL') {
        payload.extraComputations = ['TRAFFIC_ON_POLYLINE'];
      }
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok && !data?.error, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    // Primary: TRAFFIC_AWARE_OPTIMAL avoids congested highways & respects one-way roads
    let result = await callGoogle('TRAFFIC_AWARE_OPTIMAL');
    // Graceful downgrade if Google project tier rejects TRAFFIC_AWARE_OPTIMAL
    if (!result.ok && result.data?.error?.status === 'INVALID_ARGUMENT') {
      result = await callGoogle('TRAFFIC_AWARE');
    }
    if (!result.ok) {
      return json({
        error: {
          status: result.data?.error?.status ?? `HTTP_${result.status}`,
          message: result.data?.error?.message ?? '',
        },
      });
    }
    return json(result.data);
  } catch (e) {
    return json({ error: { status: 'UPSTREAM_UNREACHABLE', message: String((e as Error)?.message ?? e) } });
  }
});