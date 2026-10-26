// src/components/map/directions.ts
// Turn-by-turn route between two points.
//   1) Google Routes API, called through the `google-routes` Supabase edge function so the
//      Routes key lives in a server-side secret and never ships inside the app.
//   2) Falls back to OSRM (free, no key) if the function / Google refuses or is unreachable.
import { supabase } from '../../utils/supabase';
import type { LatLng } from './roadRoute';

export type NavStep = { instruction: string; maneuver: string; distanceM: number };

export type NavRoute = {
  coords: LatLng[];
  distanceM: number;
  durationS: number;
  steps: NavStep[];             // one entry per step; instruction may be '' for "keep going"
  source: 'google' | 'osrm' | 'straight';
};

// If Google rejects the key (API not enabled / restricted) stop asking for this session.
let googleDisabled = false;

/** Google's encoded polyline -> coordinates. */
export function decodePolyline(str: string): LatLng[] {
  const out: LatLng[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b: number, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
}

export const haversineM = (a: LatLng, b: LatLng) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function googleRoute(a: LatLng, b: LatLng): Promise<NavRoute | null> {
  if (googleDisabled) return null;
  try {
    const { data, error } = await supabase.functions.invoke('google-routes', {
      body: {
        origin: { latitude: a.latitude, longitude: a.longitude },
        destination: { latitude: b.latitude, longitude: b.longitude },
      },
    });
    if (error) {
      // function not deployed (404), key secret missing (503) or access refused (403): stop asking this session
      const status = (error as any)?.context?.status;
      if (status === 404 || status === 403 || status === 503) {
        googleDisabled = true;
        console.warn('[directions] google-routes function unavailable, using OSRM:', status);
      }
      return null;
    }
    if (data?.error) {
      const code = data.error.status;
      if (code === 'PERMISSION_DENIED' || code === 'REQUEST_DENIED' || code === 'KEY_MISSING' ||
          (code === 'INVALID_ARGUMENT' && /key/i.test(data.error.message || ''))) {
        googleDisabled = true;
        console.warn('[directions] Google Routes API unavailable, using OSRM:', data.error.message || code);
      }
      return null;
    }
    const r = data?.routes?.[0];
    const enc = r?.polyline?.encodedPolyline;
    if (!r || !enc) return null;

    const steps: NavStep[] = ((r.legs || []).flatMap((l: any) => l.steps || []) as any[]).map(s => ({
      instruction: s.navigationInstruction?.instructions || '',
      maneuver: s.navigationInstruction?.maneuver || '',
      distanceM: Number(s.distanceMeters) || 0,
    }));

    return {
      coords: decodePolyline(enc),
      distanceM: Number(r.distanceMeters) || 0,
      durationS: parseInt(String(r.duration || '0').replace('s', ''), 10) || 0,
      steps,
      source: 'google',
    };
  } catch (e) {
    console.warn('[directions] Google Routes failed', e);
    return null;
  }
}

async function osrmRoute(a: LatLng, b: LatLng): Promise<NavRoute | null> {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    const data = await res.json();
    const r = data?.routes?.[0];
    if (data?.code !== 'Ok' || !r?.geometry?.coordinates) return null;

    const steps: NavStep[] = ((r.legs || []).flatMap((l: any) => l.steps || []) as any[]).map(s => {
      const type = s.maneuver?.type as string;
      const mod = String(s.maneuver?.modifier || '').toLowerCase();
      const road = s.name ? ` onto ${s.name}` : '';
      let instruction = '';
      let maneuver = '';
      if (type === 'arrive') { instruction = 'Arrive at your destination'; maneuver = 'ARRIVE'; }
      else if (type === 'depart') { instruction = `Head ${mod || 'out'}${s.name ? ` on ${s.name}` : ''}`; maneuver = 'STRAIGHT'; }
      else if (/left/.test(mod)) { instruction = `Turn ${mod}${road}`; maneuver = /slight/.test(mod) ? 'TURN_SLIGHT_LEFT' : 'TURN_LEFT'; }
      else if (/right/.test(mod)) { instruction = `Turn ${mod}${road}`; maneuver = /slight/.test(mod) ? 'TURN_SLIGHT_RIGHT' : 'TURN_RIGHT'; }
      else if (/uturn/.test(mod)) { instruction = 'Make a U-turn'; maneuver = 'UTURN_LEFT'; }
      else { instruction = `Continue${s.name ? ` on ${s.name}` : ''}`; maneuver = /roundabout|rotary/.test(type) ? 'ROUNDABOUT_LEFT' : /merge/.test(type) ? 'MERGE' : 'STRAIGHT'; }
      return { instruction, maneuver, distanceM: Number(s.distance) || 0 };
    });

    let coords: LatLng[] = r.geometry.coordinates.map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
    if (coords.length > 400) {
      const step = (coords.length - 1) / 399;
      const thin: LatLng[] = [];
      for (let i = 0; i < 399; i++) thin.push(coords[Math.round(i * step)]);
      thin.push(coords[coords.length - 1]);
      coords = thin;
    }
    return { coords, distanceM: Number(r.distance) || 0, durationS: Number(r.duration) || 0, steps, source: 'osrm' };
  } catch { return null; }
}

export async function getNavRoute(a: LatLng, b: LatLng): Promise<NavRoute> {
  const g = await googleRoute(a, b);
  if (g) return g;
  const o = await osrmRoute(a, b);
  if (o) return o;
  const d = haversineM(a, b);
  return { coords: [a, b], distanceM: d, durationS: d / (25000 / 3600), steps: [], source: 'straight' };
}

/* ------------------------------ formatting ------------------------------ */
export const fmtDistance = (m: number | null | undefined) => {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
};

export const fmtDuration = (s: number | null | undefined) => {
  if (s == null || !isFinite(s)) return '—';
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};