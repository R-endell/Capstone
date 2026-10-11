import { ShipmentItem } from '../modules/Dashboard/Sender/Delivery/ScheduleContext';

const BASE_FEE = 30;
const PER_KM = 15;
const SIZE_FEE: Record<'Small' | 'Medium' | 'Large', number> = {
  Small: 0,
  Medium: 30,
  Large: 60,
};
const FRAGILE_FEE = 20;
const SCHEDULE_FEE = 30;
const EMERGENCY_FEE = 50;
const MIN_TOTAL = 60;

// Road distance typically ~1.25–1.4× straight-line in urban Cebu
const ROAD_FACTOR = 1.3;

// Cache keyed by rounded coords so back-and-forth navigation is instant
const distanceCache = new Map<string, number>();

const cacheKey = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) =>
  `${a.latitude.toFixed(4)},${a.longitude.toFixed(4)}-${b.latitude.toFixed(4)},${b.longitude.toFixed(4)}`;

export interface PricingBreakdown {
  base: number;
  distance: number;
  size: number;
  fragile: number;
  schedule: number;
  emergency: number;
  distanceKm: number;
  total: number;
  refined: boolean;   // true when backed by real road distance
}

/** Haversine — instant, no network */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Instant estimate: straight-line × road factor */
export function quickEstimateKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/**
 * Real road distance via OSRM.
 * - Returns cached value if available (instant).
 * - Times out after 2.5s and falls back to the quick estimate.
 */
export async function getRoadDistanceKm(
  pickup: { latitude: number; longitude: number },
  dropoff: { latitude: number; longitude: number },
): Promise<number> {
  const key = cacheKey(pickup, dropoff);
  const cached = distanceCache.get(key);
  if (cached !== undefined) return cached;

  const fallback = quickEstimateKm(pickup, dropoff);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}` +
      `?overview=false`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await res.json();

    if (data?.code === 'Ok' && data.routes?.[0]?.distance) {
      const km = data.routes[0].distance / 1000;
      distanceCache.set(key, km);
      return km;
    }
  } catch (e) {
    console.warn('[routeService] OSRM failed/timeout, using quick estimate');
  }

  distanceCache.set(key, fallback);
  return fallback;
}

export function computePricing(input: {
  distanceKm: number;
  items: ShipmentItem[];
  scheduled: boolean;
  emergency?: boolean;
  refined?: boolean;
}): PricingBreakdown {
  const base = BASE_FEE;
  const distance = Math.round(input.distanceKm * PER_KM);
  const size = input.items.reduce((s, i) => s + (SIZE_FEE[i.size] ?? 0), 0);
  const fragile = input.items.some((i) => i.fragile) ? FRAGILE_FEE : 0;
  const schedule = input.scheduled ? SCHEDULE_FEE : 0;
  const emergency = input.emergency ? EMERGENCY_FEE : 0;
  const raw = base + distance + size + fragile + schedule + emergency;
  const total = Math.max(raw, MIN_TOTAL);

  return {
    base,
    distance,
    size,
    fragile,
    schedule,
    emergency,
    distanceKm: input.distanceKm,
    total,
    refined: input.refined ?? false,
  };
}