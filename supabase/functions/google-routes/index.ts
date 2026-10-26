// supabase/functions/google-routes/index.ts
// Server-side proxy for the Google Routes API (computeRoutes).
//
//   - The Routes key lives only in the GOOGLE_ROUTES_API_KEY secret (never in the app bundle).
//   - Caller must be a signed-in user (their JWT is verified here).
//   - Input is validated and the request to Google is built here with a FIXED field mask and
//     travel mode, so the client can't use the function as an open Google proxy.
//   - Google-side failures come back as HTTP 200 { error: { status, message } } so the app can
//     tell "key problem" (stop asking) from "transient" (try later); the app then falls back to OSRM.
//
// Deploy:   supabase functions deploy google-routes
// Secret:   supabase secrets set GOOGLE_ROUTES_API_KEY=<key restricted to "Routes API" only>
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FIELD_MASK =
  'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,' +
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

  // --- who is calling? ---
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Unauthorized' }, 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401);

  // --- validate input ---
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { origin, destination } = body ?? {};
  if (!validPoint(origin) || !validPoint(destination)) return json({ error: 'origin and destination need numeric latitude/longitude' }, 400);

  // --- call Google ---
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
        destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        languageCode: 'en-US',
        units: 'METRIC',
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      return json({ error: { status: data?.error?.status ?? `HTTP_${res.status}`, message: data?.error?.message ?? '' } });
    }
    return json(data);
  } catch (e) {
    return json({ error: { status: 'UPSTREAM_UNREACHABLE', message: String((e as Error)?.message ?? e) } });
  } finally {
    clearTimeout(timer);
  }
});