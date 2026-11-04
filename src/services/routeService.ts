// src/services/routeService.ts
import { ShipmentItem } from '../modules/Dashboard/Sender/Delivery/ScheduleContext';
import { supabase } from '../utils/supabase';
import { getActiveRouteId, setActiveRouteId, getDemoMode } from './activeRouteStore';

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
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
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

/* ==================================================================== */
/* Provider Route Visibility Fix (v2.0) — Guardrails & Corridor Helpers */
/* ==================================================================== */
export const MAX_DAILY_ROUTES = 3;
export const MAX_ROUTE_DURATION_HOURS = 4;
export const MIN_DESTINATION_DIVERSITY_KM = 3.0;
export const COVERAGE_FLAG_KM = 25.0;

export interface RouteCoord {
  latitude: number;
  longitude: number;
}

export interface CreateRouteWithGuardrailsInput {
  providerId: number;
  vehicleId: number;
  startLocation: {
    location_id: number;
    latitude: number;
    longitude: number;
    street_address?: string;
  };
  endLocation: {
    location_id: number;
    latitude: number;
    longitude: number;
    street_address?: string;
  };
  departureDateObj: Date;
  endTimeObj?: Date;
  routeFrequency: string;
}

const toNaiveIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}:00`;
};

export const parseNaiveRouteTime = (s?: string | null): Date => {
  if (!s) return new Date();
  const parts = String(s).split(/[-T:+Z ]/);
  if (parts.length < 5) return new Date(s);
  return new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
    parseInt(parts[3], 10),
    parseInt(parts[4], 10),
  );
};

/**
 * Fetches full road polyline coordinates and road distance (km) from OSRM
 * so PostGIS can build `corridor_geom` via trigger.
 */
export async function fetchRouteCorridorAndDistance(
  start: RouteCoord,
  end: RouteCoord,
): Promise<{ coords: RouteCoord[]; distanceKm: number }> {
  const fallbackCoords: RouteCoord[] = [
    { latitude: Number(start.latitude), longitude: Number(start.longitude) },
    { latitude: Number(end.latitude), longitude: Number(end.longitude) },
  ];
  const fallbackKm = Number(quickEstimateKm(fallbackCoords[0], fallbackCoords[1]).toFixed(2));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${start.longitude},${start.latitude};${end.longitude},${end.latitude}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();

    if (data?.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates?.length >= 2) {
      const coords: RouteCoord[] = data.routes[0].geometry.coordinates.map((c: number[]) => ({
        latitude: Number(c[1]),
        longitude: Number(c[0]),
      }));
      const distanceKm = data.routes[0].distance
        ? Number((data.routes[0].distance / 1000).toFixed(2))
        : fallbackKm;
      return { coords, distanceKm };
    }
  } catch {
    // fall through to straight-line fallback
  }

  return { coords: fallbackCoords, distanceKm: fallbackKm };
}

/**
 * Rule 4 & Guardrail: Count all routes created today (including soft-deleted ones!)
 * so deleting and recreating a route cannot bypass the 3-route daily limit.
 */
export async function getTodayRouteStats(providerId: number) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('provider_routes')
    .select(`
      *,
      start_location:locations!provider_routes_start_location_id_fkey(*),
      end_location:locations!provider_routes_end_location_id_fkey(*),
      vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
    `)
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const allRoutes = data || [];
  const postedToday = allRoutes.filter((r: any) => {
    const createdMs = r.created_at ? new Date(r.created_at).getTime() : 0;
    return createdMs >= startOfDay.getTime();
  });

  const activeRoutes = allRoutes.filter(
    (r: any) => r.is_deleted !== true && r.is_active !== false,
  );

  const activeTodayRoutes = postedToday.filter(
    (r: any) => r.is_deleted !== true && r.is_active !== false,
  );

  return {
    usedTodayCount: postedToday.length,
    remainingSlots: Math.max(0, MAX_DAILY_ROUTES - postedToday.length),
    activeRoutes,
    activeTodayRoutes,
    postedToday,
  };
}

/**
 * Guardrail: Route edit lock
 * Cannot edit within 24 hours of departure (or 1 minute when DEMO_MODE is ON).
 */
export function canEditRoute(
  departureTimeStr: string,
  demoMode = false,
): { allowed: boolean; reason?: string } {
  const dep = parseNaiveRouteTime(departureTimeStr);
  const diffHours = (dep.getTime() - Date.now()) / (1000 * 60 * 60);
  const lockHours = demoMode ? 1 / 60 : 24;

  if (diffHours < lockHours) {
    return {
      allowed: false,
      reason: demoMode
        ? 'DEMO_MODE Active: Route is locked within 1 minute of departure.'
        : 'Route Edit Lock: Routes cannot be edited within 24 hours of departure to prevent route-hunting.',
    };
  }
  return { allowed: true };
}

/**
 * Creates a provider route while enforcing all PDF guardrails:
 * 1. Max 3 routes per day (including deleted routes)
 * 2. Max 4-hour time window per route
 * 3. Route diversity: destinations must be >= 3 km apart & no overlapping times
 * 4. Saves PostGIS corridor_path + vehicle remaining trunk capacity
 * 5. Flags routes > 25 km for Admin review
 */
export async function createProviderRouteWithGuardrails(
  input: CreateRouteWithGuardrailsInput,
) {
  const {
    providerId,
    vehicleId,
    startLocation,
    endLocation,
    departureDateObj,
    endTimeObj,
    routeFrequency,
  } = input;

  const stats = await getTodayRouteStats(providerId);

  // Guardrail 1: Daily cap (Max 3 routes/day including deleted routes)
  if (stats.usedTodayCount >= MAX_DAILY_ROUTES) {
    throw new Error(
      `Daily limit reached (${stats.usedTodayCount}/${MAX_DAILY_ROUTES} routes today). Deleted routes still count toward your daily limit.`,
    );
  }

  // Guardrail 2: Time window cap (Max 4 hours per route)
  const computedEnd = endTimeObj
    ? endTimeObj
    : new Date(departureDateObj.getTime() + 2 * 60 * 60 * 1000); // default 2-hr window

  const durationHours =
    (computedEnd.getTime() - departureDateObj.getTime()) / (1000 * 60 * 60);

  if (durationHours <= 0) {
    throw new Error('Route end time must be after departure time.');
  }
  if (durationHours > MAX_ROUTE_DURATION_HOURS) {
    throw new Error(
      `Route time window cannot exceed ${MAX_ROUTE_DURATION_HOURS} hours.`,
    );
  }

  // Guardrail 3: Route diversity (Destinations >= 3 km apart & no overlapping time windows today)
  for (const existing of stats.activeTodayRoutes) {
    const exStart = parseNaiveRouteTime(existing.departure_time);
    const exEnd = existing.end_time
      ? parseNaiveRouteTime(existing.end_time)
      : new Date(exStart.getTime() + 2 * 60 * 60 * 1000);

    const timeOverlaps =
      departureDateObj.getTime() < exEnd.getTime() &&
      computedEnd.getTime() > exStart.getTime();

    if (timeOverlaps) {
      throw new Error(
        'Route Diversity Guardrail: This route overlaps in time with another route you posted today.',
      );
    }

    const exEndLoc = existing.end_location;
    if (exEndLoc?.latitude != null && exEndLoc?.longitude != null) {
      const destSeparationKm = haversineKm(
        { latitude: Number(endLocation.latitude), longitude: Number(endLocation.longitude) },
        { latitude: Number(exEndLoc.latitude), longitude: Number(exEndLoc.longitude) },
      );
      if (destSeparationKm < MIN_DESTINATION_DIVERSITY_KM) {
        throw new Error(
          `Route Diversity Guardrail: Destinations for routes on the same day must be at least ${MIN_DESTINATION_DIVERSITY_KM} km apart (this destination is ${destSeparationKm.toFixed(1)} km from another route today).`,
        );
      }
    }
  }

  // Fetch vehicle capacity for trunk space counter
  const { data: vehicle, error: vehErr } = await supabase
    .from('vehicles')
    .select('vehicle_id, max_weight_kg, max_volume_liters, verification_status')
    .eq('vehicle_id', vehicleId)
    .single();

  if (vehErr || !vehicle) {
    throw new Error('Selected vehicle could not be loaded.');
  }

  // Build road corridor polyline & distance
  const { coords, distanceKm } = await fetchRouteCorridorAndDistance(
    { latitude: Number(startLocation.latitude), longitude: Number(startLocation.longitude) },
    { latitude: Number(endLocation.latitude), longitude: Number(endLocation.longitude) },
  );

  // Guardrail 4: Coverage flag (> 25 km = Admin review)
  const adminReviewFlag = distanceKm > COVERAGE_FLAG_KM;

  const { data: inserted, error: insertErr } = await supabase
    .from('provider_routes')
    .insert({
      provider_id: providerId,
      vehicle_id: vehicleId,
      start_location_id: startLocation.location_id,
      end_location_id: endLocation.location_id,
      departure_time: toNaiveIso(departureDateObj),
      end_time: toNaiveIso(computedEnd),
      route_frequency: routeFrequency,
      corridor_path: coords,
      route_distance_km: distanceKm,
      remaining_weight_kg: Number(vehicle.max_weight_kg) || 50,
      remaining_volume_liters: Number(vehicle.max_volume_liters) || 200,
      admin_review_flag: adminReviewFlag,
      is_active: true,
      is_deleted: false,
    })
    .select('*')
    .single();

  if (insertErr) throw insertErr;

  await setActiveRouteId(inserted.route_id);

  const demoMode = await getDemoMode();
  try {
    await supabase.rpc('evaluate_route_matches', {
      p_route_id: inserted.route_id,
      p_demo_mode: demoMode,
    });
  } catch (e) {
    console.warn('[routeService] evaluate_route_matches rpc warning:', e);
  }

  return {
    route: inserted,
    adminReviewFlag,
    distanceKm,
  };
}

/**
 * Updates an existing route after checking the 24-hour edit lock guardrail.
 */
export async function updateProviderRouteWithGuardrails(
  routeId: number,
  originalDepartureTime: string,
  input: CreateRouteWithGuardrailsInput,
) {
  const demoMode = await getDemoMode();
  const lockCheck = canEditRoute(originalDepartureTime, demoMode);
  if (!lockCheck.allowed) {
    throw new Error(lockCheck.reason);
  }

  const { coords, distanceKm } = await fetchRouteCorridorAndDistance(
    { latitude: Number(input.startLocation.latitude), longitude: Number(input.startLocation.longitude) },
    { latitude: Number(input.endLocation.latitude), longitude: Number(input.endLocation.longitude) },
  );

  const computedEnd = input.endTimeObj
    ? input.endTimeObj
    : new Date(input.departureDateObj.getTime() + 2 * 60 * 60 * 1000);

  const adminReviewFlag = distanceKm > COVERAGE_FLAG_KM;

  const { data: updated, error } = await supabase
    .from('provider_routes')
    .update({
      departure_time: toNaiveIso(input.departureDateObj),
      end_time: toNaiveIso(computedEnd),
      route_frequency: input.routeFrequency,
      start_location_id: input.startLocation.location_id,
      end_location_id: input.endLocation.location_id,
      vehicle_id: input.vehicleId,
      corridor_path: coords,
      route_distance_km: distanceKm,
      admin_review_flag: adminReviewFlag,
    })
    .eq('route_id', routeId)
    .select('*')
    .single();

  if (error) throw error;

  try {
    await supabase.rpc('evaluate_route_matches', {
      p_route_id: routeId,
      p_demo_mode: demoMode,
    });
  } catch (e) {
    console.warn('[routeService] evaluate_route_matches rpc warning:', e);
  }

  return {
    route: updated,
    adminReviewFlag,
    distanceKm,
  };
}

/**
 * Guardrail: No delete-and-repost.
 * Soft-deletes the route so the row stays in `provider_routes` and still counts
 * toward the 3-route daily limit.
 */
export async function softDeleteProviderRoute(routeId: number) {
  const { error } = await supabase
    .from('provider_routes')
    .update({
      is_deleted: true,
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('route_id', routeId);

  if (error) throw error;

  await supabase
    .from('route_request_matches')
    .update({ status: 'expired' })
    .eq('route_id', routeId)
    .eq('status', 'matched');

  const currentActive = await getActiveRouteId();
  if (currentActive === routeId) {
    await setActiveRouteId(null);
  }
}