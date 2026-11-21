// src/services/matchingService.ts
import { supabase } from '../utils/supabase';
import { getActiveRouteId, getDemoMode } from './activeRouteStore';
import { fetchRouteCorridorAndDistance, parseNaiveRouteTime } from './routeService';
import { notifyUser } from './pushService';
import { Alert } from 'react-native';

/**
 * A request only becomes visible to providers (matches, direct requests, notifications)
 * once the sender has actually paid: payment_status is 'held' (escrow) or later.
 * Anything still 'unpaid' / 'failed' / pending means the sender is still choosing a receiver
 * or setting up payment, so providers must not see it yet.
 */
export const PAID_PAYMENT_STATUSES = ['held', 'paid', 'released'];
export function isRequestPaid(req: any): boolean {
  return !!req && PAID_PAYMENT_STATUSES.includes(String(req.payment_status || '').toLowerCase());
}

export interface Location {
  latitude: number;
  longitude: number;
  location_id?: number;
  street_address?: string;
  road?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zip_code?: string;
}

export interface ProviderRoute {
  route_id: number;
  provider_id: number;
  vehicle_id: number;
  departure_time: string;
  end_time?: string | null;
  route_frequency?: string;
  route_distance_km?: number;
  remaining_weight_kg?: number;
  remaining_volume_liters?: number;
  fallback_unlocked?: boolean;
  fallback_reason?: 'CONDITION_A' | 'CONDITION_B' | null;
  fallback_used?: boolean;
  admin_review_flag?: boolean;
  is_deleted?: boolean;
  is_active?: boolean;
  is_selected?: boolean;
  start_location: Location;
  end_location: Location;
}

export interface DeliveryRequest {
  request_id: number;
  pickup_type?: string;
  scheduled_time: string | null;
  created_at?: string | null;
  estimated_cost: number;
  emergency_flag: boolean;
  sender_id: number;
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  pickup_location: Location;
  dropoff_location: Location;
  cargo?: any;
  receiver?: any;
}

export interface RouteMatchRow {
  match_id: number;
  route_id: number;
  request_id: number;
  provider_id: number;
  match_score: number;
  is_fallback: boolean;
  fallback_type: 'CONDITION_A' | 'CONDITION_B' | null;
  pickup_dist_m: number;
  dropoff_dist_m: number;
  pickup_fraction: number;
  dropoff_fraction: number;
  extra_detour_km: number;
  status: string;
  request: any;
  route?: any;
  provider?: {
    user_id: number;
    first_name: string;
    last_name: string;
    phone_number?: string;
    profile_photo?: string | null;
  } | null;
  vehicle?: {
    vehicle_id?: number;
    vehicle_type: string;
    plate_number: string;
    max_weight_kg?: number;
  } | null;
  rating_avg?: number;
  rating_count?: number;
}

export interface MatchResult {
  request: DeliveryRequest;
  route: ProviderRoute;
  matchScore: number;
  isFallback?: boolean;
  fallbackType?: 'CONDITION_A' | 'CONDITION_B' | null;
  pickupDistM?: number;
  dropoffDistM?: number;
  pickupFraction?: number;
  dropoffFraction?: number;
  extraDetourKm?: number;
  matchId?: number;
}

export const SHIPMENT_SIZE_SPECS = {
  Small: {
    fee: 0,
    weightRangeLabel: '1 – 5 kg',
    autoSelectLabel: 'Auto-selected when ≤ 5 kg',
    maxWeightKg: 5,
    inchesLabel: '12" × 12" × 12"',
    feetCmLabel: '1 ft × 1 ft × 1 ft / 30×30×30 cm',
    lengthCm: 30,
    widthCm: 30,
    heightCm: 30,
    liters: 25,
    sampleItems: 'Shoebox, books, folded clothes, small kitchen appliance',
  },
  Medium: {
    fee: 30,
    weightRangeLabel: '6 – 15 kg',
    autoSelectLabel: 'Auto-selected when 6–15 kg',
    maxWeightKg: 15,
    inchesLabel: '18" × 14" × 14"',
    feetCmLabel: '1.5 ft × 1.2 ft × 1.2 ft / 45×35×35 cm',
    lengthCm: 45,
    widthCm: 35,
    heightCm: 35,
    liters: 55,
    sampleItems: 'Microwave, electric fan, PC monitor, half balikbayan box',
  },
  Large: {
    fee: 60,
    weightRangeLabel: '16 – 25 kg',
    autoSelectLabel: 'Auto-selected when 16–25 kg',
    maxWeightKg: 25,
    inchesLabel: '24" × 18" × 18"',
    feetCmLabel: '2 ft × 1.5 ft × 1.5 ft / 60×45×45 cm',
    lengthCm: 60,
    widthCm: 45,
    heightCm: 45,
    liters: 110,
    sampleItems: 'Full balikbayan box, large storage bin, large bag of pillows',
  },
} as const;

export function calculateDistance(
  lat1: number | string,
  lon1: number | string,
  lat2: number | string,
  lon2: number | string,
): number {
  const R = 6371;
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return Infinity;
  const dLat = ((numLat2 - numLat1) * Math.PI) / 180;
  const dLon = ((numLon2 - numLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((numLat1 * Math.PI) / 180) *
      Math.cos((numLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeCargoVolumeLiters(cargoOrItems: any): number {
  if (!cargoOrItems) return SHIPMENT_SIZE_SPECS.Small.liters;
  if (Array.isArray(cargoOrItems) && cargoOrItems.length > 0 && !('small_box_qty' in cargoOrItems[0])) {
    return cargoOrItems.reduce((acc, it) => {
      if (it?.size === 'Large') return acc + SHIPMENT_SIZE_SPECS.Large.liters;
      if (it?.size === 'Medium') return acc + SHIPMENT_SIZE_SPECS.Medium.liters;
      return acc + SHIPMENT_SIZE_SPECS.Small.liters;
    }, 0);
  }
  const c = Array.isArray(cargoOrItems) ? cargoOrItems[0] : cargoOrItems;
  if (!c) return SHIPMENT_SIZE_SPECS.Small.liters;
  const s = Number(c.small_box_qty) || 0;
  const m = Number(c.medium_box_qty) || 0;
  const l = Number(c.large_box_qty) || 0;
  const total =
    s * SHIPMENT_SIZE_SPECS.Small.liters +
    m * SHIPMENT_SIZE_SPECS.Medium.liters +
    l * SHIPMENT_SIZE_SPECS.Large.liters;
  if (total > 0) return total;
  let items: any = c.items_json;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = null; }
  }
  if (Array.isArray(items) && items.length > 0) {
    return items.reduce((acc, it) => {
      if (it?.size === 'Large') return acc + SHIPMENT_SIZE_SPECS.Large.liters;
      if (it?.size === 'Medium') return acc + SHIPMENT_SIZE_SPECS.Medium.liters;
      return acc + SHIPMENT_SIZE_SPECS.Small.liters;
    }, 0);
  }
  return SHIPMENT_SIZE_SPECS.Small.liters;
}

/**
 * Computes the Date object for when `route` departs TODAY (for Daily/Weekly routes)
 * or its exact scheduled date (for One-time/Custom routes).
 */
export function getRouteTodayDepartureDate(route: any, refDate = new Date()): Date {
  const dep = parseNaiveRouteTime(route?.departure_time);
  const freq = String(route?.route_frequency || '').trim().toLowerCase();
  if (freq === 'daily' || freq === 'weekly') {
    const todayDep = new Date(refDate);
    todayDep.setHours(dep.getHours(), dep.getMinutes(), dep.getSeconds() || 0, 0);
    return todayDep;
  }
  return dep;
}

export function isRouteRunningToday(route: any, now = new Date()): boolean {
  if (!route || route.is_deleted === true || route.is_active === false) return false;
  const freq = String(route.route_frequency || '').trim().toLowerCase();
  const dep = parseNaiveRouteTime(route.departure_time);
  if (freq === 'daily') return true;
  if (freq === 'weekly') return dep.getDay() === now.getDay();
  const sameDay =
    dep.getFullYear() === now.getFullYear() &&
    dep.getMonth() === now.getMonth() &&
    dep.getDate() === now.getDate();
  return sameDay;
}

export function hasRouteDeparted(route: any, now = new Date()): boolean {
  if (!route?.departure_time) return false;
  if (!isRouteRunningToday(route, now)) return true;
  const todayDep = getRouteTodayDepartureDate(route, now);
  return now.getTime() > todayDep.getTime();
}

const SEND_NOW_DETECT_WINDOW_MIN = 10;

export function parseRequestCreatedTime(req: any): Date {
  if (!req?.created_at) return new Date();
  const raw = String(req.created_at).trim();
  const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = hasTz ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function isSendNowRequest(req: any): boolean {
  if (!req) return false;
  if (!req.scheduled_time) return true;
  try {
    const createdMs = parseRequestCreatedTime(req).getTime();
    const m = String(req.scheduled_time).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m || isNaN(createdMs)) return false;
    const schedMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]);
    return Math.abs(schedMs - createdMs) <= SEND_NOW_DETECT_WINDOW_MIN * 60000;
  } catch {
    return false;
  }
}

/**
 * Re-checks an ALREADY STORED match against the strict corridor rules. Match rows can also be written by
 * other things (older app versions, the database's evaluate_route_matches function), so screens use this
 * before showing a row. `route` needs corridor_path (and ideally fallback_unlocked); `req` needs
 * pickup_location / dropoff_location with latitude+longitude. If it can't judge (missing coordinates or
 * route line) it returns true so nothing legitimate is hidden.
 */
export function isRequestWithinRouteCorridor(route: any, req: any): boolean {
  if (!route || !req) return true;
  const one = (x: any) => (Array.isArray(x) ? x[0] : x);
  const puLoc = one(req.pickup_location);
  const doLoc = one(req.dropoff_location);
  if (puLoc?.latitude == null || doLoc?.latitude == null) return true;

  const sLoc = one(route.start_location);
  const eLoc = one(route.end_location);
  const corridor: { latitude: number; longitude: number }[] =
    Array.isArray(route.corridor_path) && route.corridor_path.length >= 2
      ? route.corridor_path
      : sLoc && eLoc
        ? [
            { latitude: Number(sLoc.latitude), longitude: Number(sLoc.longitude) },
            { latitude: Number(eLoc.latitude), longitude: Number(eLoc.longitude) },
          ]
        : [];
  if (corridor.length < 2) return true;

  const pu = projectPointToPolyline({ lat: Number(puLoc.latitude), lng: Number(puLoc.longitude) }, corridor);
  const dr = projectPointToPolyline({ lat: Number(doLoc.latitude), lng: Number(doLoc.longitude) }, corridor);
  const canUseFallback = Boolean(route.fallback_unlocked) && !Boolean(route.fallback_used);
  const limit = canUseFallback
    ? getFallbackCorridorM(req.pickup_type)
    : getPrimaryCorridorM(req.pickup_type);
  const isForward = dr.fraction >= pu.fraction - 0.02;
  return isForward && pu.minDistanceM <= limit && dr.minDistanceM <= limit;
}

/**
 * The calendar day a request should be served on, as a naive local Date (same convention as
 * parseNaiveRouteTime, so it can be passed straight to isRouteRunningToday).
 * Send-Now requests are served today; Scheduled requests on the day the sender picked.
 */
export function getRequestServiceDate(req: any, fallbackNow = new Date()): Date {
  if (!req || isSendNowRequest(req)) return fallbackNow;
  const m = String(req.scheduled_time || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return fallbackNow;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return isNaN(d.getTime()) ? fallbackNow : d;
}

// A scheduled pickup may be this many minutes before departure / after arrival and still match.
export const SCHEDULE_WINDOW_GRACE_MIN = 15;
// Routes without an end_time are treated as lasting this long (same default the Explore screen uses).
const DEFAULT_ROUTE_DURATION_MS = 4 * 60 * 60 * 1000;

/**
 * The [start, end] window a route is on the road on a given calendar day.
 * Daily/Weekly routes repeat at the same time of day with the same duration;
 * One-time/Custom routes use their exact stored times.
 */
export function getRouteWindowOnDay(route: any, day: Date): { start: Date; end: Date } {
  const dep = parseNaiveRouteTime(route?.departure_time);
  const endRaw = route?.end_time ? parseNaiveRouteTime(route.end_time) : null;
  const durationMs =
    endRaw && !isNaN(endRaw.getTime()) && endRaw.getTime() > dep.getTime()
      ? endRaw.getTime() - dep.getTime()
      : DEFAULT_ROUTE_DURATION_MS;
  const freq = String(route?.route_frequency || '').trim().toLowerCase();
  const start =
    freq === 'daily' || freq === 'weekly'
      ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), dep.getHours(), dep.getMinutes(), 0, 0)
      : dep;
  return { start, end: new Date(start.getTime() + durationMs) };
}

/**
 * Scheduled requests: does this route run on the scheduled day AND is the scheduled time inside
 * the route's departure -> arrival window (plus a small grace)? The previous day's run is checked
 * too, so a route that leaves at 23:00 and arrives at 02:00 covers a 01:00 pickup.
 */
export function isRouteCoveringScheduledTime(route: any, request: any, now = new Date()): boolean {
  if (!route || route.is_deleted === true || route.is_active === false) return false;
  const when = getRequestServiceDate(request, now).getTime();
  const graceMs = SCHEDULE_WINDOW_GRACE_MIN * 60000;
  const base = getRequestServiceDate(request, now);
  for (const offset of [0, -1]) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset, 12, 0, 0, 0);
    if (!isRouteRunningToday(route, day)) continue;
    const { start, end } = getRouteWindowOnDay(route, day);
    if (when >= start.getTime() - graceMs && when <= end.getTime() + graceMs) return true;
  }
  return false;
}

export function isRouteTimeValidForRequest(route: any, request: any, now = new Date()): boolean {
  if (!route || !request) return false;
  if (request.preferred_provider_id != null) return true;

  if (!isSendNowRequest(request)) {
    // Scheduled booking: the route must run that day AND cover the scheduled time of day.
    return isRouteCoveringScheduledTime(route, request, now);
  }

  if (!isRouteRunningToday(route, now)) return false;

  const { end: routeEndToday } = getRouteWindowOnDay(route, now);
  const bookedAt = parseRequestCreatedTime(request);

  if (bookedAt.getTime() > routeEndToday.getTime()) {
    return false;
  }

  if (now.getTime() > routeEndToday.getTime()) {
    return false;
  }

  return true;
}

/**
 * Synced matching radii (identical to Supabase `evaluate_route_matches`):
 *  - Curb-side (No Detour): 200 m primary / 300 m fallback (sender/receiver walks to main road)
 *  - Door-to-Door:          500 m primary / 1,000 m fallback
 *  - Curb-side meet-up snap threshold: 15 m (pins > 15 m off-route get a main-road landmark prompt)
 */
export const CURBSIDE_CORRIDOR_M = 200;
export const DOOR_TO_DOOR_CORRIDOR_M = 500;
export const CURBSIDE_FALLBACK_M = 300;
export const DOOR_TO_DOOR_FALLBACK_M = 1000;
export const CURBSIDE_LANDMARK_SNAP_M = 15;

// Backwards-compatible aliases
export const CORRIDOR_MATCH_M = CURBSIDE_CORRIDOR_M;
export const FALLBACK_CORRIDOR_M = DOOR_TO_DOOR_FALLBACK_M;

export function isDoorToDoorType(pickupType?: string | null): boolean {
  return /door/i.test(String(pickupType || ''));
}

export function getPrimaryCorridorM(pickupType?: string | null): number {
  // If pickup_type wasn't selected in a lightweight query, don't falsely reject Door-to-Door rows
  if (pickupType == null || pickupType === '') return DOOR_TO_DOOR_CORRIDOR_M;
  return isDoorToDoorType(pickupType) ? DOOR_TO_DOOR_CORRIDOR_M : CURBSIDE_CORRIDOR_M;
}

export function getFallbackCorridorM(pickupType?: string | null): number {
  if (pickupType == null || pickupType === '') return DOOR_TO_DOOR_FALLBACK_M;
  return isDoorToDoorType(pickupType) ? DOOR_TO_DOOR_FALLBACK_M : CURBSIDE_FALLBACK_M;
}

export function projectPointToPolyline(
  pt: { lat: number; lng: number },
  polyline: { latitude: number; longitude: number }[],
): { minDistanceM: number; fraction: number; projLat: number; projLng: number } {
  if (!polyline || polyline.length === 0) {
    return { minDistanceM: Infinity, fraction: 0, projLat: pt.lat, projLng: pt.lng };
  }
  if (polyline.length === 1) {
    const dKm = calculateDistance(pt.lat, pt.lng, polyline[0].latitude, polyline[0].longitude);
    return {
      minDistanceM: Math.round(dKm * 1000),
      fraction: 0,
      projLat: polyline[0].latitude,
      projLng: polyline[0].longitude,
    };
  }
  let totalLengthKm = 0;
  const segLengths: number[] = [];
  for (let i = 0; i < polyline.length - 1; i++) {
    const seg = calculateDistance(
      polyline[i].latitude,
      polyline[i].longitude,
      polyline[i + 1].latitude,
      polyline[i + 1].longitude,
    );
    segLengths.push(seg);
    totalLengthKm += seg;
  }
  if (totalLengthKm <= 0) {
    const dKm = calculateDistance(pt.lat, pt.lng, polyline[0].latitude, polyline[0].longitude);
    return {
      minDistanceM: Math.round(dKm * 1000),
      fraction: 0,
      projLat: polyline[0].latitude,
      projLng: polyline[0].longitude,
    };
  }
  let bestDistKm = Infinity;
  let bestFraction = 0;
  let bestLat = polyline[0].latitude;
  let bestLng = polyline[0].longitude;
  let traversedKm = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const segLen = segLengths[i];
    const dx = b.longitude - a.longitude;
    const dy = b.latitude - a.latitude;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((pt.lng - a.longitude) * dx + (pt.lat - a.latitude) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const projLat = a.latitude + t * dy;
    const projLng = a.longitude + t * dx;
    const distKm = calculateDistance(pt.lat, pt.lng, projLat, projLng);
    if (distKm < bestDistKm) {
      bestDistKm = distKm;
      bestFraction = (traversedKm + t * segLen) / totalLengthKm;
      bestLat = projLat;
      bestLng = projLng;
    }
    traversedKm += segLen;
  }
  return {
    minDistanceM: Math.round(bestDistKm * 1000),
    fraction: Number(bestFraction.toFixed(4)),
    projLat: bestLat,
    projLng: bestLng,
  };
}

export const LIVE_GPS_STALE_MS = 5 * 60 * 1000; // 5 minutes
export const AHEAD_OF_DRIVER_BUFFER = 0.02;     // ~2% fraction tolerance for GPS jitter
export const ROUTE_END_CUTOFF_FRACTION = 0.92;  // Stop matching Send-Now once >= 92% of route is done
export const DRIVER_OFF_ROUTE_THRESHOLD_M = 1000;

export interface DriverLivePos {
  latitude: number;
  longitude: number;
  updated_at?: string | null;
}

export interface AheadCheckResult {
  allowed: boolean;
  reason?: string;
  driverFraction?: number;
}

/**
 * Option B: For Send-Now requests after a route's departure time, verifies the driver has a
 * fresh GPS ping (<= 5 min old) and has not already passed the pickup point along the corridor.
 */
export function checkPickupAheadOfDriver(params: {
  route: any;
  request: any;
  corridor: { latitude: number; longitude: number }[];
  pickupFraction: number;
  driverLoc: DriverLivePos | null;
  now?: Date;
}): AheadCheckResult {
  const { route, request, corridor, pickupFraction, driverLoc, now = new Date() } = params;

  // Direct requests and Scheduled bookings are not filtered by live GPS position
  if (request?.preferred_provider_id != null || !isSendNowRequest(request)) {
    return { allowed: true };
  }

  // Before departure time today, allow the full route (0.0 -> 1.0)
  const { start: routeDepToday } = getRouteWindowOnDay(route, now);
  if (now.getTime() <= routeDepToday.getTime()) {
    return { allowed: true };
  }

  // After departure time: require fresh live GPS (<= 5 minutes)
  if (
    !driverLoc ||
    !Number.isFinite(Number(driverLoc.latitude)) ||
    !Number.isFinite(Number(driverLoc.longitude))
  ) {
    return { allowed: false, reason: 'post-departure send-now: no live driver GPS available' };
  }

  if (driverLoc.updated_at) {
    const updatedMs = new Date(driverLoc.updated_at).getTime();
    const ageMs = now.getTime() - updatedMs;
    if (!Number.isFinite(ageMs) || ageMs > LIVE_GPS_STALE_MS) {
      return {
        allowed: false,
        reason: `post-departure send-now: driver GPS is stale (>${Math.round(LIVE_GPS_STALE_MS / 60000)} min old)`,
      };
    }
  }

  if (!corridor || corridor.length < 2) {
    return { allowed: true };
  }

  const drvProj = projectPointToPolyline(
    { lat: Number(driverLoc.latitude), lng: Number(driverLoc.longitude) },
    corridor,
  );

  let effectiveDriverFraction = drvProj.fraction;
  if (drvProj.minDistanceM > DRIVER_OFF_ROUTE_THRESHOLD_M) {
    const startPt = corridor[0];
    const endPt = corridor[corridor.length - 1];
    const distToStart = calculateDistance(driverLoc.latitude, driverLoc.longitude, startPt.latitude, startPt.longitude);
    const distToEnd = calculateDistance(driverLoc.latitude, driverLoc.longitude, endPt.latitude, endPt.longitude);
    if (distToStart <= distToEnd) {
      // Running late near start -> treat as not departed yet
      effectiveDriverFraction = 0;
    } else {
      return {
        allowed: false,
        driverFraction: drvProj.fraction,
        reason: 'post-departure send-now: driver is off-route near destination',
      };
    }
  }

  if (effectiveDriverFraction >= ROUTE_END_CUTOFF_FRACTION) {
    return {
      allowed: false,
      driverFraction: effectiveDriverFraction,
      reason: `post-departure send-now: driver nearly finished route (${Math.round(effectiveDriverFraction * 100)}%)`,
    };
  }

  if (pickupFraction < effectiveDriverFraction - AHEAD_OF_DRIVER_BUFFER) {
    return {
      allowed: false,
      driverFraction: effectiveDriverFraction,
      reason: `pickup already passed (driver at ${Math.round(effectiveDriverFraction * 100)}%, pickup at ${Math.round(pickupFraction * 100)}%)`,
    };
  }

  return { allowed: true, driverFraction: effectiveDriverFraction };
}

async function fetchDriverLiveLocationMap(providerIds: number[]): Promise<Map<number, DriverLivePos>> {
  const map = new Map<number, DriverLivePos>();
  const unique = Array.from(new Set(providerIds.map(Number).filter((n) => Number.isFinite(n) && n > 0)));
  if (unique.length === 0) return map;
  try {
    const { data } = await supabase
      .from('provider_live_locations')
      .select('provider_id, latitude, longitude, updated_at')
      .in('provider_id', unique);
    for (const row of (data || []) as any[]) {
      map.set(Number(row.provider_id), {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        updated_at: row.updated_at ?? null,
      });
    }
  } catch (e) {
    console.warn('[matchingService] fetchDriverLiveLocationMap warning:', e);
  }
  return map;
}

export async function ensureRouteCorridorBackfilled(routeId: number): Promise<void> {
  try {
    const { data: route } = await supabase
      .from('provider_routes')
      .select(
        `route_id, corridor_path, remaining_weight_kg, remaining_volume_liters, vehicle_id, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*), vehicle:vehicles!provider_routes_vehicle_id_fkey(*)`,
      )
      .eq('route_id', routeId)
      .maybeSingle();
    if (!route) return;
    const pathArr = Array.isArray(route.corridor_path) ? route.corridor_path : [];
    const needsCorridor = pathArr.length < 2;
    const needsCapacity =
      !route.remaining_weight_kg ||
      Number(route.remaining_weight_kg) <= 0 ||
      !route.remaining_volume_liters ||
      Number(route.remaining_volume_liters) <= 0;
    if (!needsCorridor && !needsCapacity) return;
    const sLoc: any = Array.isArray(route.start_location) ? route.start_location[0] : route.start_location;
    const eLoc: any = Array.isArray(route.end_location) ? route.end_location[0] : route.end_location;
    const veh: any = Array.isArray(route.vehicle) ? route.vehicle[0] : route.vehicle;
    const patch: Record<string, any> = {};
    if (needsCorridor && sLoc?.latitude != null && eLoc?.latitude != null) {
      const { coords, distanceKm } = await fetchRouteCorridorAndDistance(
        { latitude: Number(sLoc.latitude), longitude: Number(sLoc.longitude) },
        { latitude: Number(eLoc.latitude), longitude: Number(eLoc.longitude) },
      );
      patch.corridor_path = coords;
      patch.route_distance_km = distanceKm;
    }
    if (needsCapacity) {
      patch.remaining_weight_kg = Number(veh?.max_weight_kg) || 100;
      patch.remaining_volume_liters = Number(veh?.max_volume_liters) || 300;
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from('provider_routes').update(patch).eq('route_id', routeId);
    }
  } catch (err) {
    console.warn('[matchingService] ensureRouteCorridorBackfilled warning:', err);
  }
}

/**
 * Evaluates a single request against a single route and inserts/updates `route_request_matches`
 * ONLY if the pickup and dropoff lie along the provider's forward route corridor.
 * If a non-matching row already exists in `route_request_matches`, it is revoked so non-matching
 * providers never see or receive the request.
 */
async function evaluatePairAndUpsertMatch(
  route: any,
  reqRow: any,
  now: Date,
  shouldNotify: boolean,
  isDemo: boolean = false,
  driverLoc?: DriverLivePos | null,
): Promise<boolean> {
  if (!route || !reqRow || reqRow.delivery_status !== 'Pending') return false;
  // Not paid yet (sender still on receiver / payment step): no match, no notification.
  if (!isRequestPaid(reqRow)) return false;
  if (Number(route.provider_id) === Number(reqRow.sender_id)) return false;

  const isDirectRequest = reqRow.preferred_provider_id != null;
  const isPreferredRoute =
    (reqRow.preferred_route_id && Number(reqRow.preferred_route_id) === Number(route.route_id)) ||
    (!reqRow.preferred_route_id &&
      reqRow.preferred_provider_id &&
      Number(reqRow.preferred_provider_id) === Number(route.provider_id));

  if (isDirectRequest && !isPreferredRoute) {
    await supabase
      .from('route_request_matches')
      .update({ status: 'revoked' })
      .eq('route_id', route.route_id)
      .eq('request_id', reqRow.request_id)
      .eq('status', 'matched');
    return false;
  }

  // In demo mode we only relax the time-of-day departure check; route corridor & capacity MUST always match.
  if (!isDemo && !isRouteTimeValidForRequest(route, reqRow, now)) {
    return false;
  }

  const puLoc = Array.isArray(reqRow.pickup_location) ? reqRow.pickup_location[0] : reqRow.pickup_location;
  const doLoc = Array.isArray(reqRow.dropoff_location) ? reqRow.dropoff_location[0] : reqRow.dropoff_location;
  const cargo = Array.isArray(reqRow.cargo) ? reqRow.cargo[0] : reqRow.cargo;
  const reqWeight = Number(cargo?.total_weight_kg) || 5;
  const reqVol = computeCargoVolumeLiters(cargo);

  const sLoc = Array.isArray(route.start_location) ? route.start_location[0] : route.start_location;
  const eLoc = Array.isArray(route.end_location) ? route.end_location[0] : route.end_location;

  const corridor: { latitude: number; longitude: number }[] =
    Array.isArray(route.corridor_path) && route.corridor_path.length >= 2
      ? route.corridor_path
      : sLoc && eLoc
        ? [
            { latitude: Number(sLoc.latitude), longitude: Number(sLoc.longitude) },
            { latitude: Number(eLoc.latitude), longitude: Number(eLoc.longitude) },
          ]
        : [];

  if (corridor.length < 2 || puLoc?.latitude == null || doLoc?.latitude == null) return false;

  const puProj = projectPointToPolyline(
    { lat: Number(puLoc.latitude), lng: Number(puLoc.longitude) },
    corridor,
  );
  const doProj = projectPointToPolyline(
    { lat: Number(doLoc.latitude), lng: Number(doLoc.longitude) },
    corridor,
  );

  const maxCorridorM = getPrimaryCorridorM(reqRow.pickup_type);
  const canUseFallback = Boolean(route.fallback_unlocked) && !Boolean(route.fallback_used);
  const fallbackMaxM = canUseFallback ? getFallbackCorridorM(reqRow.pickup_type) : maxCorridorM;

  const fitsCapacity =
    Number(route.remaining_weight_kg ?? 100) >= reqWeight &&
    Number(route.remaining_volume_liters ?? 300) >= reqVol;

  // Pickup must come before dropoff along the provider's route direction
  const isForward = doProj.fraction >= puProj.fraction - 0.02;

  const withinPrimary = puProj.minDistanceM <= maxCorridorM && doProj.minDistanceM <= maxCorridorM;
  const withinFallback =
    canUseFallback &&
    puProj.minDistanceM <= fallbackMaxM &&
    doProj.minDistanceM <= fallbackMaxM;

  let resolvedDriverLoc = driverLoc;
  if (!isDemo && !isPreferredRoute && resolvedDriverLoc === undefined && isSendNowRequest(reqRow)) {
    const { start: depToday } = getRouteWindowOnDay(route, now);
    if (now.getTime() > depToday.getTime()) {
      const liveMap = await fetchDriverLiveLocationMap([Number(route.provider_id)]);
      resolvedDriverLoc = liveMap.get(Number(route.provider_id)) ?? null;
    }
  }

  const aheadCheck =
    isDemo || isPreferredRoute
      ? { allowed: true }
      : checkPickupAheadOfDriver({
          route,
          request: reqRow,
          corridor,
          pickupFraction: puProj.fraction,
          driverLoc: resolvedDriverLoc ?? null,
          now,
        });

  if (!isPreferredRoute && !(fitsCapacity && isForward && aheadCheck.allowed && (withinPrimary || withinFallback))) {
    // Ensure any stale/previous match for this non-matching or already-passed route is revoked
    await supabase
      .from('route_request_matches')
      .update({ status: 'revoked' })
      .eq('route_id', route.route_id)
      .eq('request_id', reqRow.request_id)
      .eq('status', 'matched');
    return false;
  }

  const { data: existingMatch } = await supabase
    .from('route_request_matches')
    .select('match_id, status')
    .eq('route_id', route.route_id)
    .eq('request_id', reqRow.request_id)
    .maybeSingle();

  const avgDistM = (puProj.minDistanceM + doProj.minDistanceM) / 2;
  const computedScore = isPreferredRoute
    ? 100
    : withinPrimary
      // inside the strict corridor: 90% (right at the 200 m edge) up to 99% (directly on the route)
      ? Math.max(90, Math.min(99, Math.round(100 - (avgDistM / Math.max(maxCorridorM, 1)) * 10)))
      // fallback-only matches (provider unlocked the wider corridor) always score below 90%
      : Math.max(60, Math.min(89, Math.round(89 - (avgDistM / Math.max(fallbackMaxM, 1)) * 29)));

  if (existingMatch) {
    if (existingMatch.status === 'declined') return false;
    if (existingMatch.status === 'expired' || existingMatch.status === 'revoked') {
      await supabase
        .from('route_request_matches')
        .update({ status: 'matched', match_score: computedScore })
        .eq('match_id', existingMatch.match_id);
    }
    return true;
  }

  const { error: insErr } = await supabase.from('route_request_matches').insert({
    route_id: route.route_id,
    request_id: reqRow.request_id,
    provider_id: route.provider_id,
    match_score: computedScore,
    is_fallback: !isPreferredRoute && !withinPrimary,
    fallback_type: !isPreferredRoute && !withinPrimary ? (route.fallback_reason || 'CONDITION_A') : null,
    pickup_dist_m: Math.round(puProj.minDistanceM),
    dropoff_dist_m: Math.round(doProj.minDistanceM),
    pickup_fraction: puProj.fraction,
    dropoff_fraction: Math.max(puProj.fraction + 0.01, doProj.fraction),
    extra_detour_km: Number(((puProj.minDistanceM + doProj.minDistanceM) / 1000).toFixed(2)),
    status: 'matched',
  });

  if (!insErr && shouldNotify) {
    const trackingId = `PNS-${String(reqRow.request_id).padStart(4, '0')}`;
    try {
      await notifyUser(
        route.provider_id,
        isPreferredRoute ? '📦 Direct Route Delivery Request!' : `🎯 New ${computedScore}% Route Match!`,
        isPreferredRoute
          ? `A sender requested delivery #${trackingId} along your route.`
          : `Delivery #${trackingId} matches your route today. Open Jobs to accept!`,
        {
          type: isPreferredRoute ? 'direct_route_request' : 'match',
          requestId: reqRow.request_id,
          routeId: route.route_id,
        },
      );
    } catch {}
  }

  return !insErr;
}

/**
 * Enriches RouteMatchRow[] with provider user details, vehicle details, and ratings
 * so BookingScreen can display every matching provider cleanly.
 */
export async function enrichRouteMatchRows(rows: any[]): Promise<RouteMatchRow[]> {
  if (!rows || rows.length === 0) return [];
  const providerIds = Array.from(new Set(rows.map((r) => Number(r.provider_id)).filter(Boolean)));
  const routeIds = Array.from(new Set(rows.map((r) => Number(r.route_id)).filter(Boolean)));

  const [{ data: usersData }, { data: routesData }, { data: vehiclesData }, { data: ratingsData }] =
    await Promise.all([
      providerIds.length > 0
        ? supabase
            .from('users')
            .select('user_id, first_name, last_name, phone_number, profile_photo')
            .in('user_id', providerIds)
        : Promise.resolve({ data: [] as any[] }),
      routeIds.length > 0
        ? supabase
            .from('provider_routes')
            .select(
              'route_id, provider_id, vehicle_id, departure_time, end_time, route_frequency, is_active, is_deleted',
            )
            .in('route_id', routeIds)
        : Promise.resolve({ data: [] as any[] }),
      providerIds.length > 0
        ? supabase
            .from('vehicles')
            .select('vehicle_id, provider_id, vehicle_type, plate_number, max_weight_kg')
            .in('provider_id', providerIds)
        : Promise.resolve({ data: [] as any[] }),
      providerIds.length > 0
        ? supabase
            .from('ratings_reviews')
            .select('reviewee_id, rating')
            .in('reviewee_id', providerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

  const userMap = new Map<number, any>();
  (usersData || []).forEach((u: any) => userMap.set(Number(u.user_id), u));

  const routeMap = new Map<number, any>();
  (routesData || []).forEach((r: any) => routeMap.set(Number(r.route_id), r));

  const vehicleById = new Map<number, any>();
  const vehicleByProvider = new Map<number, any>();
  (vehiclesData || []).forEach((v: any) => {
    vehicleById.set(Number(v.vehicle_id), v);
    if (!vehicleByProvider.has(Number(v.provider_id))) {
      vehicleByProvider.set(Number(v.provider_id), v);
    }
  });

  const ratingStats = new Map<number, { sum: number; count: number }>();
  (ratingsData || []).forEach((r: any) => {
    const pid = Number(r.reviewee_id);
    const cur = ratingStats.get(pid) || { sum: 0, count: 0 };
    cur.sum += Number(r.rating) || 0;
    cur.count += 1;
    ratingStats.set(pid, cur);
  });

  // Deduplicate by provider_id (keep highest match_score per provider)
  const seenProviders = new Set<number>();
  const deduped: RouteMatchRow[] = [];

  for (const m of rows) {
    const pid = Number(m.provider_id);
    if (seenProviders.has(pid)) continue;
    seenProviders.add(pid);

    const rObj = (Array.isArray(m.route) ? m.route[0] : m.route) || routeMap.get(Number(m.route_id)) || null;
    const veh =
      (rObj?.vehicle_id ? vehicleById.get(Number(rObj.vehicle_id)) : null) ||
      vehicleByProvider.get(pid) ||
      null;
    const rStat = ratingStats.get(pid);

    deduped.push({
      match_id: Number(m.match_id),
      route_id: Number(m.route_id),
      request_id: Number(m.request_id),
      provider_id: pid,
      match_score: Number(m.match_score),
      is_fallback: !!m.is_fallback,
      fallback_type: m.fallback_type || null,
      pickup_dist_m: Number(m.pickup_dist_m),
      dropoff_dist_m: Number(m.dropoff_dist_m),
      pickup_fraction: Number(m.pickup_fraction),
      dropoff_fraction: Number(m.dropoff_fraction),
      extra_detour_km: Number(m.extra_detour_km),
      status: m.status,
      request: m.request,
      route: rObj,
      provider: userMap.get(pid) || null,
      vehicle: veh,
      rating_avg: rStat && rStat.count > 0 ? Number((rStat.sum / rStat.count).toFixed(1)) : 0,
      rating_count: rStat ? rStat.count : 0,
    });
  }

  return deduped;
}

/**
 * Called by Sender's BookingScreen / scheduleService when a new request is created or paid.
 * Evaluates all active provider routes running today that strictly match the sender's route corridor,
 * creates `route_request_matches` rows ONLY for matching providers, and returns all of them sorted by score.
 */
export async function syncAllActiveRoutesTodayForRequest(
  requestId: number,
  opts: { notify?: boolean } = {},
): Promise<RouteMatchRow[]> {
  const shouldNotify = opts.notify !== false;
  if (!requestId) return [];
  try {
    const isDemo = await getDemoMode();
    const { data: reqRow } = await supabase
      .from('delivery_requests')
      .select(
        `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)`,
      )
      .eq('request_id', requestId)
      .maybeSingle();

    if (!reqRow || reqRow.delivery_status !== 'Pending') return [];
    // Matching starts only after the sender pressed Pay and the payment is held in escrow.
    if (!isRequestPaid(reqRow)) return [];

    const { data: allRoutes } = await supabase
      .from('provider_routes')
      .select(
        `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
      )
      .eq('is_active', true)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    const now = new Date();

    // Send-Now: routes running today. Scheduled: routes running on the day the sender picked.
    const serviceDate = getRequestServiceDate(reqRow, now);
    const isScheduledReq = !isSendNowRequest(reqRow);

    const routesByProvider = new Map<number, any[]>();
    for (const r of allRoutes || []) {
      if (!routesByProvider.has(r.provider_id)) routesByProvider.set(r.provider_id, []);
      routesByProvider.get(r.provider_id)!.push(r);
    }

    const candidateRoutes: any[] = [];
    routesByProvider.forEach((pRoutes) => {
      const runningToday = pRoutes.filter((r) =>
        isDemo ||
        (isScheduledReq
          ? isRouteCoveringScheduledTime(r, reqRow, now)
          : isRouteRunningToday(r, serviceDate)));
      if (isScheduledReq) {
        // A provider's "selected" route today says nothing about which route they run on a future day.
        candidateRoutes.push(...runningToday);
        return;
      }
      const selectedToday = runningToday.find((r) => r.is_selected === true);
      if (selectedToday) {
        candidateRoutes.push(selectedToday);
      } else if (runningToday.length > 0) {
        candidateRoutes.push(runningToday[0]);
      }
    });

    // Always include explicitly preferred route/provider (when sender booked from Explore)
    for (const r of allRoutes || []) {
      const isPref =
        (reqRow.preferred_route_id && Number(r.route_id) === Number(reqRow.preferred_route_id)) ||
        (reqRow.preferred_provider_id && Number(r.provider_id) === Number(reqRow.preferred_provider_id));
      if (isPref && !candidateRoutes.some((c) => c.route_id === r.route_id)) {
        candidateRoutes.push(r);
      }
    }

    const driverLocMap =
      !isDemo && isSendNowRequest(reqRow)
        ? await fetchDriverLiveLocationMap(candidateRoutes.map((r) => Number(r.provider_id)))
        : new Map<number, DriverLivePos>();

    const validRouteIds = new Set<number>();
    for (const route of candidateRoutes) {
      await ensureRouteCorridorBackfilled(route.route_id);
      const drvLoc = driverLocMap.get(Number(route.provider_id)) ?? null;
      const matched = await evaluatePairAndUpsertMatch(route, reqRow, now, shouldNotify, isDemo, drvLoc);
      if (matched) {
        validRouteIds.add(Number(route.route_id));
      }
    }

    // Revoke any stray matches on routes that did not pass strict evaluation
    const { data: allExistingMatches } = await supabase
      .from('route_request_matches')
      .select('match_id, route_id, status')
      .eq('request_id', requestId)
      .eq('status', 'matched');

    const invalidMatchIds = (allExistingMatches || [])
      .filter((m: any) => !validRouteIds.has(Number(m.route_id)))
      .map((m: any) => Number(m.match_id));

    if (invalidMatchIds.length > 0) {
      await supabase
        .from('route_request_matches')
        .update({ status: 'revoked' })
        .in('match_id', invalidMatchIds);
    }

    const { data: matches } = await supabase
      .from('route_request_matches')
      .select(
        `*, route:provider_routes(*), request:delivery_requests (*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*))`,
      )
      .eq('request_id', requestId)
      .eq('status', 'matched')
      .order('match_score', { ascending: false });

    const validMatches = (matches || []).filter((m: any) => {
      if (!validRouteIds.has(Number(m.route_id))) return false;
      const r = Array.isArray(m.route) ? m.route[0] : m.route;
      return isDemo || !r || isRouteTimeValidForRequest(r, reqRow, now);
    });

    return await enrichRouteMatchRows(validMatches);
  } catch (err) {
    console.warn('[matchingService] syncAllActiveRoutesTodayForRequest warning:', err);
    return [];
  }
}

/**
 * Scans all open `Pending` requests created today against a specific provider route
 * using strict corridor evaluation so non-matching providers never pick up unrelated requests.
 */
export async function syncOpenPendingRequestsForRoute(routeId: number): Promise<void> {
  if (!routeId) return;
  try {
    const isDemo = await getDemoMode();
    await ensureRouteCorridorBackfilled(routeId);

    const { data: route } = await supabase
      .from('provider_routes')
      .select(
        `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
      )
      .eq('route_id', routeId)
      .maybeSingle();

    if (!route || route.is_deleted || route.is_active === false) return;

    const now = new Date();
    // No blanket "must run today" gate here: a route posted for a future day still has to pick up
    // requests scheduled for that day. evaluatePairAndUpsertMatch applies the right per-request
    // day check (today for Send-Now, the scheduled day for Scheduled).

    const { data: pendingReqs } = await supabase
      .from('delivery_requests')
      .select(
        `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)`,
      )
      .eq('delivery_status', 'Pending')
      .in('payment_status', PAID_PAYMENT_STATUSES)
      .order('created_at', { ascending: false })
      .limit(40);

    if (!pendingReqs || pendingReqs.length === 0) return;

    const reqIds = pendingReqs.map((r: any) => r.request_id);
    const { data: existingDelivs } = await supabase
      .from('deliveries')
      .select('request_id')
      .in('request_id', reqIds);
    const takenSet = new Set((existingDelivs || []).map((d: any) => d.request_id));

    const liveMap = !isDemo
      ? await fetchDriverLiveLocationMap([Number(route.provider_id)])
      : new Map<number, DriverLivePos>();
    const driverLoc = liveMap.get(Number(route.provider_id)) ?? null;

    for (const reqRow of pendingReqs) {
      if (takenSet.has(reqRow.request_id)) continue;
      await evaluatePairAndUpsertMatch(route, reqRow, now, false, isDemo, driverLoc);
    }
  } catch (e) {
    console.warn('[matchingService] syncOpenPendingRequestsForRoute warning:', e);
  }
}

/**
 * Debug helper: for one request, explains for EVERY provider route why it did or did not match
 * (own route, inactive, wrong day, outside time window, off corridor, wrong direction, capacity).
 * Used by BookingScreen to log why a booking found no providers.
 */
export async function explainMatchesForRequest(requestId: number) {
  const now = new Date();
  const { data: reqRow } = await supabase
    .from('delivery_requests')
    .select(
      `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*)`,
    )
    .eq('request_id', requestId)
    .maybeSingle();
  if (!reqRow) return { error: 'request not found' };

  const { data: routes } = await supabase
    .from('provider_routes')
    .select(
      `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
    )
    .eq('is_deleted', false);

  const sendNow = isSendNowRequest(reqRow);
  const when = getRequestServiceDate(reqRow, now);
  const puLoc = Array.isArray(reqRow.pickup_location) ? reqRow.pickup_location[0] : reqRow.pickup_location;
  const doLoc = Array.isArray(reqRow.dropoff_location) ? reqRow.dropoff_location[0] : reqRow.dropoff_location;
  const cargo = Array.isArray(reqRow.cargo) ? reqRow.cargo[0] : reqRow.cargo;
  const reqWeight = Number(cargo?.total_weight_kg) || 5;
  const reqVol = computeCargoVolumeLiters(cargo);
  const driverLocMap = sendNow
    ? await fetchDriverLiveLocationMap((routes || []).map((r: any) => Number(r.provider_id)))
    : new Map<number, DriverLivePos>();
  const report = (routes || []).map((route: any) => {
    const reasons: string[] = [];
    if (Number(route.provider_id) === Number(reqRow.sender_id)) reasons.push('own route (sender = provider)');
    if (route.is_active === false) reasons.push('route inactive');
    if (reqRow.preferred_provider_id != null && Number(reqRow.preferred_provider_id) !== Number(route.provider_id))
      reasons.push('request is direct to another provider');

    if (sendNow) {
      if (!isRouteTimeValidForRequest(route, reqRow, now)) reasons.push('send-now: route not running / already departed today');
    } else {
      if (!isRouteRunningToday(route, when)) reasons.push(`route does not run on ${when.toDateString()} (${route.route_frequency})`);
      else if (!isRouteCoveringScheduledTime(route, reqRow, now)) {
        const w = getRouteWindowOnDay(route, when);
        reasons.push(`scheduled time ${when.toLocaleString()} is outside route window ${w.start.toLocaleString()} -> ${w.end.toLocaleString()} (±${SCHEDULE_WINDOW_GRACE_MIN}min)`);
      }
    }

    const sLoc = Array.isArray(route.start_location) ? route.start_location[0] : route.start_location;
    const eLoc = Array.isArray(route.end_location) ? route.end_location[0] : route.end_location;
    const corridor: { latitude: number; longitude: number }[] =
      Array.isArray(route.corridor_path) && route.corridor_path.length >= 2
        ? route.corridor_path
        : sLoc && eLoc
          ? [
              { latitude: Number(sLoc.latitude), longitude: Number(sLoc.longitude) },
              { latitude: Number(eLoc.latitude), longitude: Number(eLoc.longitude) },
            ]
          : [];
    let pickupM: number | null = null;
    let dropoffM: number | null = null;
    if (corridor.length >= 2 && puLoc?.latitude != null && doLoc?.latitude != null) {
      const pu = projectPointToPolyline({ lat: Number(puLoc.latitude), lng: Number(puLoc.longitude) }, corridor);
      const dr = projectPointToPolyline({ lat: Number(doLoc.latitude), lng: Number(doLoc.longitude) }, corridor);
      pickupM = Math.round(pu.minDistanceM);
      dropoffM = Math.round(dr.minDistanceM);
      const canUseFallback = Boolean(route.fallback_unlocked) && !Boolean(route.fallback_used);
      const limit = canUseFallback
        ? getFallbackCorridorM(reqRow.pickup_type)
        : getPrimaryCorridorM(reqRow.pickup_type);
      if (pu.minDistanceM > limit) reasons.push(`pickup ${pickupM} m from route (limit ${limit} m)`);
      if (dr.minDistanceM > limit) reasons.push(`dropoff ${dropoffM} m from route (limit ${limit} m)`);
      if (!(dr.fraction >= pu.fraction - 0.02)) reasons.push('dropoff comes BEFORE pickup along this route (wrong direction)');
      if (sendNow) {
        const ahead = checkPickupAheadOfDriver({
          route,
          request: reqRow,
          corridor,
          pickupFraction: pu.fraction,
          driverLoc: driverLocMap.get(Number(route.provider_id)) ?? null,
          now,
        });
        if (!ahead.allowed && ahead.reason) reasons.push(ahead.reason);
      }
    } else {
      reasons.push('no corridor / missing coordinates');
    }
    if (!(Number(route.remaining_weight_kg ?? 100) >= reqWeight))
      reasons.push(`not enough weight capacity (${route.remaining_weight_kg} kg left, need ${reqWeight})`);
    if (!(Number(route.remaining_volume_liters ?? 300) >= reqVol))
      reasons.push(`not enough volume capacity (${route.remaining_volume_liters} L left, need ${reqVol})`);

    return {
      route_id: route.route_id,
      provider_id: route.provider_id,
      frequency: route.route_frequency,
      departure_time: route.departure_time,
      end_time: route.end_time,
      verdict: reasons.length === 0 ? 'WOULD MATCH' : 'rejected',
      reasons,
    };
  });

  return {
    request_id: requestId,
    mode: sendNow ? 'send-now' : 'scheduled',
    scheduled_time: reqRow.scheduled_time,
    interpreted_service_time: when.toString(),
    routes: report,
  };
}

export async function evaluateAndFetchRouteMatches(
  routeId: number,
  demoMode?: boolean,
  opts: { evaluate?: boolean } = {},
): Promise<RouteMatchRow[]> {
  if (!routeId) return [];
  const doEvaluate = opts.evaluate !== false;

  const isDemo = demoMode !== undefined ? demoMode : await getDemoMode();

  if (doEvaluate) {
    await syncOpenPendingRequestsForRoute(routeId);
  }

  const { data: routeRow } = await supabase
    .from('provider_routes')
    .select(
      '*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)',
    )
    .eq('route_id', routeId)
    .maybeSingle();
  if (!routeRow || routeRow.is_deleted || routeRow.is_active === false) {
    return [];
  }

  const { data: rows, error } = await supabase
    .from('route_request_matches')
    .select(
      `*, request:delivery_requests (*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*))`,
    )
    .eq('route_id', routeId)
    .eq('status', 'matched')
    .order('is_fallback', { ascending: true })
    .order('match_score', { ascending: false });

  if (error) {
    console.error('[matchingService] error fetching route_request_matches:', error);
    return [];
  }

  const now = new Date();
  const afterPending = (rows || []).filter(
    (m: any) => m.request && m.request.delivery_status === 'Pending' && isRequestPaid(m.request),
  );
  const afterPreferred = afterPending.filter(
    (m: any) =>
      m.request.preferred_provider_id == null ||
      Number(m.request.preferred_provider_id) === Number(m.provider_id),
  );

  // Double-check corridor geometry so any row inserted by an external trigger/RPC that doesn't match is filtered out
  const sLoc = Array.isArray(routeRow.start_location) ? routeRow.start_location[0] : routeRow.start_location;
  const eLoc = Array.isArray(routeRow.end_location) ? routeRow.end_location[0] : routeRow.end_location;
  const corridor: { latitude: number; longitude: number }[] =
    Array.isArray(routeRow.corridor_path) && routeRow.corridor_path.length >= 2
      ? routeRow.corridor_path
      : sLoc && eLoc
        ? [
            { latitude: Number(sLoc.latitude), longitude: Number(sLoc.longitude) },
            { latitude: Number(eLoc.latitude), longitude: Number(eLoc.longitude) },
          ]
        : [];

  const liveMap = !isDemo
    ? await fetchDriverLiveLocationMap([Number(routeRow.provider_id)])
    : new Map<number, DriverLivePos>();
  const driverLoc = liveMap.get(Number(routeRow.provider_id)) ?? null;

  const strictlyValid: any[] = [];
  for (const m of afterPreferred) {
    const reqRow = m.request;
    if (!isDemo && !isRouteTimeValidForRequest(routeRow, reqRow, now)) continue;

    const isPreferred =
      (reqRow.preferred_route_id && Number(reqRow.preferred_route_id) === Number(routeRow.route_id)) ||
      (reqRow.preferred_provider_id && Number(reqRow.preferred_provider_id) === Number(routeRow.provider_id));

    if (!isPreferred) {
      const puLoc = Array.isArray(reqRow.pickup_location) ? reqRow.pickup_location[0] : reqRow.pickup_location;
      const doLoc = Array.isArray(reqRow.dropoff_location) ? reqRow.dropoff_location[0] : reqRow.dropoff_location;
      if (corridor.length < 2 || puLoc?.latitude == null || doLoc?.latitude == null) continue;

      const puProj = projectPointToPolyline(
        { lat: Number(puLoc.latitude), lng: Number(puLoc.longitude) },
        corridor,
      );
      const doProj = projectPointToPolyline(
        { lat: Number(doLoc.latitude), lng: Number(doLoc.longitude) },
        corridor,
      );
      const isDoorToDoor = /door/i.test(String(reqRow.pickup_type || ''));
      const canUseFallback = Boolean(routeRow.fallback_unlocked) && !Boolean(routeRow.fallback_used);
      const maxCorridorM = getPrimaryCorridorM(reqRow.pickup_type);
      const fallbackMaxM = canUseFallback ? getFallbackCorridorM(reqRow.pickup_type) : maxCorridorM;
      const isForward = doProj.fraction >= puProj.fraction - 0.02;
      const withinCorridor = puProj.minDistanceM <= fallbackMaxM && doProj.minDistanceM <= fallbackMaxM;
      const aheadCheck = isDemo
        ? { allowed: true }
        : checkPickupAheadOfDriver({
            route: routeRow,
            request: reqRow,
            corridor,
            pickupFraction: puProj.fraction,
            driverLoc,
            now,
          });

      if (!isForward || !withinCorridor || !aheadCheck.allowed) {
        await supabase
          .from('route_request_matches')
          .update({ status: 'revoked' })
          .eq('match_id', m.match_id);
        continue;
      }
    }

    strictlyValid.push(m);
  }

  return strictlyValid.map((m: any) => ({
    match_id: Number(m.match_id),
    route_id: Number(m.route_id),
    request_id: Number(m.request_id),
    provider_id: Number(m.provider_id),
    match_score: Number(m.match_score),
    is_fallback: !!m.is_fallback,
    fallback_type: m.fallback_type || null,
    pickup_dist_m: Number(m.pickup_dist_m),
    dropoff_dist_m: Number(m.dropoff_dist_m),
    pickup_fraction: Number(m.pickup_fraction),
    dropoff_fraction: Number(m.dropoff_fraction),
    extra_detour_km: Number(m.extra_detour_km),
    status: m.status,
    request: m.request,
    route: routeRow,
  }));
}

export async function fetchDirectRequestMatches(
  providerId: number,
  fallbackRouteId?: number | null,
): Promise<RouteMatchRow[]> {
  if (!providerId) return [];
  const { data: directReqs } = await supabase
    .from('delivery_requests')
    .select(
      `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)`,
    )
    .eq('preferred_provider_id', providerId)
    .eq('delivery_status', 'Pending')
    .in('payment_status', PAID_PAYMENT_STATUSES);

  if (!directReqs || directReqs.length === 0) return [];

  const reqIds = directReqs.map((r: any) => r.request_id);
  const { data: existingDelivs } = await supabase
    .from('deliveries')
    .select('request_id')
    .in('request_id', reqIds);
  const taken = new Set((existingDelivs || []).map((d: any) => d.request_id));

  const { data: matchRows } = await supabase
    .from('route_request_matches')
    .select('match_id, request_id, route_id')
    .eq('provider_id', providerId)
    .in('request_id', reqIds);
  const matchByReq = new Map<number, any>();
  (matchRows || []).forEach((m: any) => {
    if (!matchByReq.has(m.request_id)) matchByReq.set(m.request_id, m);
  });

  return directReqs
    .filter((r: any) => !taken.has(r.request_id))
    .map((dr: any) => {
      const real = matchByReq.get(dr.request_id);
      return {
        match_id: real ? Number(real.match_id) : 0,
        route_id: Number(dr.preferred_route_id || real?.route_id || fallbackRouteId || 0),
        request_id: dr.request_id,
        provider_id: providerId,
        match_score: 100,
        is_fallback: false,
        fallback_type: null,
        pickup_dist_m: 0,
        dropoff_dist_m: 0,
        pickup_fraction: 0,
        dropoff_fraction: 1,
        extra_detour_km: 0,
        status: 'matched',
        request: dr,
      } as RouteMatchRow;
    });
}

export async function fetchPendingRequestsForProvider(
  providerId: number,
  selectedRouteId?: number | null,
): Promise<RouteMatchRow[]> {
  if (!providerId) return [];

  let routeId = selectedRouteId ?? null;
  if (!routeId) {
    const { data: sel } = await supabase
      .from('provider_routes')
      .select('route_id')
      .eq('provider_id', providerId)
      .eq('is_selected', true)
      .eq('is_deleted', false)
      .maybeSingle();
    routeId = sel?.route_id ?? null;
  }

  if (!routeId) {
    const { data: anyActive } = await supabase
      .from('provider_routes')
      .select('route_id')
      .eq('provider_id', providerId)
      .eq('is_active', true)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    routeId = anyActive?.route_id ?? null;
  }

  const direct = await fetchDirectRequestMatches(providerId, routeId);
  const standard = routeId
    ? await evaluateAndFetchRouteMatches(routeId, undefined, { evaluate: true })
    : [];

  const merged: RouteMatchRow[] = [...direct];
  const seen = new Set(merged.map((m) => m.request_id));
  for (const m of standard) {
    if (!seen.has(m.request_id)) {
      merged.push(m);
      seen.add(m.request_id);
    }
  }

  if (merged.length === 0) return merged;
  const { data: delivs } = await supabase
    .from('deliveries')
    .select('request_id')
    .in(
      'request_id',
      merged.map((m) => m.request_id),
    );
  const taken = new Set((delivs || []).map((d: any) => d.request_id));
  return merged.filter((m) => !taken.has(m.request_id));
}

export async function findMatches(routeId?: number | null): Promise<MatchResult[]> {
  const targetRouteId = routeId ?? (await getActiveRouteId());
  if (!targetRouteId) return [];
  const { data: routeData } = await supabase
    .from('provider_routes')
    .select(
      `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
    )
    .eq('route_id', targetRouteId)
    .maybeSingle();
  if (!routeData || routeData.is_deleted || routeData.is_active === false) return [];
  const matchRows = await evaluateAndFetchRouteMatches(targetRouteId);
  return matchRows.map((m) => ({
    request: m.request as DeliveryRequest,
    route: routeData as ProviderRoute,
    matchScore: m.match_score,
    isFallback: m.is_fallback,
    fallbackType: m.fallback_type,
    pickupDistM: m.pickup_dist_m,
    dropoffDistM: m.dropoff_dist_m,
    pickupFraction: m.pickup_fraction,
    dropoffFraction: m.dropoff_fraction,
    extraDetourKm: m.extra_detour_km,
    matchId: m.match_id,
  }));
}

export async function autoMatchAndCreateDeliveries(routeId?: number | null): Promise<any[]> {
  const matches = await findMatches(routeId);
  return matches.map((m) => ({
    request_id: m.request.request_id,
    route_id: m.route.route_id,
    match_score: m.matchScore,
    is_fallback: m.isFallback,
  }));
}

export async function getProviderDeliveries(providerId: number) {
  const { data } = await supabase
    .from('deliveries')
    .select(
      '*, delivery_requests:request_id(*, pickup_location:pickup_location_id(*), dropoff_location:dropoff_location_id(*), cargo:cargo_id(*), receiver:receiver_id(*))',
    )
    .eq('provider_id', providerId)
    .order('accepted_at', { ascending: false });
  return data || [];
}

export function subscribeToNewRequests(callback: (payload: any) => void) {
  return supabase
    .channel(`requests-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_requests' }, callback)
    .subscribe();
}

export function subscribeToProviderRoutes(providerId: number | null, callback: (payload: any) => void) {
  const filter = providerId ? `provider_id=eq.${providerId}` : undefined;
  return supabase
    .channel(`routes-${providerId ?? 'all'}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'provider_routes', ...(filter ? { filter } : {}) },
      callback,
    )
    .subscribe();
}

export function subscribeToDeliveryUpdates(providerId: number, callback: (payload: any) => void) {
  return supabase
    .channel(`deliveries-${providerId}-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` },
      callback,
    )
    .subscribe();
}

let globalMatchChannel: any = null;
let fallbackIntervalId: ReturnType<typeof setInterval> | null = null;
const notifiedMatchIds = new Set<number>();

export function stopBackgroundMatcher() {
  if (globalMatchChannel) {
    supabase.removeChannel(globalMatchChannel);
    globalMatchChannel = null;
  }
  if (fallbackIntervalId) {
    clearInterval(fallbackIntervalId);
    fallbackIntervalId = null;
  }
}

export async function runPeriodicFallbackAndMatchCheck() {
  try {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;
    const { data: userRow } = await supabase
      .from('users')
      .select('user_id, is_active, is_online')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    if (!userRow?.user_id || userRow.is_active === false) return;

    const demoMode = await getDemoMode();
    const { data: activeRoutes } = await supabase
      .from('provider_routes')
      .select('route_id, departure_time, fallback_unlocked, fallback_used')
      .eq('provider_id', userRow.user_id)
      .eq('is_active', true)
      .eq('is_deleted', false);
    if (!activeRoutes || activeRoutes.length === 0) return;

    for (const r of activeRoutes) {
      const matches = await evaluateAndFetchRouteMatches(r.route_id, demoMode);
      for (const m of matches) {
        if (!notifiedMatchIds.has(m.match_id)) {
          notifiedMatchIds.add(m.match_id);
          if (m.is_fallback) {
            await notifyUser(
              userRow.user_id,
              'Fallback Request Unlocked! 📦',
              m.fallback_type === 'CONDITION_B'
                ? 'No matches 2 hours after posting: 1 wider fallback request (up to 300 m Curb-side / 1 km Door-to-Door) is now available on your route.'
                : 'Add-On Fallback unlocked! You have remaining trunk space for 1 extra delivery (up to 300 m Curb-side / 1 km Door-to-Door).',
              { routeId: r.route_id, requestId: m.request_id },
            );
          } else {
            await notifyUser(
              userRow.user_id,
              `New ${Math.round(m.match_score)}% Route Match! 🎯`,
              'A delivery request along your declared forward route corridor is available.',
              { routeId: r.route_id, requestId: m.request_id },
            );
          }
        }
      }
    }
  } catch (err) {
    console.warn('[matchingService] periodic fallback check error:', err);
  }
}

export function startBackgroundMatcher() {
  stopBackgroundMatcher();
  runPeriodicFallbackAndMatchCheck();
  fallbackIntervalId = setInterval(() => {
    runPeriodicFallbackAndMatchCheck();
  }, 5 * 60 * 1000);

  const channelName = `realtime-global-matcher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  globalMatchChannel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'route_request_matches' },
      async (payload) => {
        const row: any = payload.new;
        if (!row || row.status !== 'matched') return;
        const activeRouteId = await getActiveRouteId();
        if (!activeRouteId || Number(row.route_id) !== Number(activeRouteId)) return;
        if (!notifiedMatchIds.has(Number(row.match_id))) {
          notifiedMatchIds.add(Number(row.match_id));
          Alert.alert(
            row.is_fallback ? '📦 Fallback Request Unlocked!' : `🎯 ${Math.round(Number(row.match_score))}% Route Match!`,
            row.is_fallback
              ? 'A fallback delivery request (up to 300 m Curb-side / 1 km Door-to-Door) along your route is now available in My Route Requests.'
              : 'A new sender request along your route corridor matched. Open My Route Requests to review.',
            [{ text: 'Got it', style: 'default' }],
          );
        }
      },
    )
    .subscribe();
  return () => stopBackgroundMatcher();
}

export async function updateProviderStatus(providerId: number, isOnline: boolean) {
  const { error } = await supabase.from('users').update({ is_online: isOnline }).eq('user_id', providerId);
  if (error) console.error('Error updating provider status:', error);
}

export async function getMatchingStats(providerId: number) {
  try {
    const { data: deliveries } = await supabase.from('deliveries').select('*').eq('provider_id', providerId);
    const { data: matches } = await supabase
      .from('route_request_matches')
      .select('*')
      .eq('provider_id', providerId)
      .eq('status', 'matched');
    const totalDeliveries = deliveries?.length || 0;
    const pendingMatches = matches?.length || 0;
    return {
      totalDeliveries,
      pendingRequests: pendingMatches,
      matchRate:
        totalDeliveries + pendingMatches > 0
          ? ((totalDeliveries / (totalDeliveries + pendingMatches)) * 100).toFixed(1)
          : '0',
    };
  } catch (error) {
    console.error('Error getting matching stats:', error);
    return null;
  }
}

export type DeclineDirectResult =
  | { ok: true; released: boolean }
  | { ok: false; message: string };

export async function declineDirectRequest(
  requestId: number,
  providerId: number,
): Promise<DeclineDirectResult> {
  try {
    const { data: reqRow } = await supabase
      .from('delivery_requests')
      .select('sender_id, delivery_status, preferred_provider_id')
      .eq('request_id', requestId)
      .maybeSingle();

    if (
      !reqRow ||
      reqRow.delivery_status !== 'Pending' ||
      Number(reqRow.preferred_provider_id) !== Number(providerId)
    ) {
      return { ok: true, released: false };
    }

    const rpcRes = await supabase.rpc('decline_direct_request', { p_request_id: requestId });
    if (!rpcRes.error) {
      const released = rpcRes.data === true || (Array.isArray(rpcRes.data) && rpcRes.data[0] === true);
      if (!released) return { ok: true, released: false };
    } else {
      const { data: upd, error: upErr } = await supabase
        .from('delivery_requests')
        .update({ preferred_provider_id: null, preferred_route_id: null })
        .eq('request_id', requestId)
        .eq('preferred_provider_id', providerId)
        .eq('delivery_status', 'Pending')
        .select('request_id');
      if (upErr || !upd || upd.length === 0) {
        return { ok: false, message: upErr?.message || 'The request could not be released. Please try again.' };
      }
      await supabase
        .from('route_request_matches')
        .update({ status: 'declined' })
        .eq('request_id', requestId)
        .eq('provider_id', providerId);
    }

    if (reqRow.sender_id) {
      try {
        await notifyUser(
          reqRow.sender_id,
          'Courier declined your request',
          `The courier you selected can't take parcel #PNS-${String(requestId).padStart(4, '0')}. We're finding another courier for you.`,
          { type: 'direct_request_declined', requestId, role: 'sender' },
        );
      } catch (err) {
        console.warn('[matchingService] notify sender decline failed', err);
      }
    }

    try {
      await syncAllActiveRoutesTodayForRequest(requestId, { notify: true });
    } catch (err) {
      console.warn('[matchingService] re-match after decline failed', err);
    }

    return { ok: true, released: true };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Failed to decline this request.' };
  }
}

/**
 * Decline ANY request shown to a provider.
 * - Direct request (sender picked this provider): released back to the sender via declineDirectRequest.
 * - Normal route match: only this provider's match row is marked 'declined', so other providers
 *   on the corridor can still accept it and this provider is never re-matched to it.
 */
export async function declineMatchedRequest(
  requestId: number,
  providerId: number,
): Promise<DeclineDirectResult> {
  try {
    const { data: reqRow } = await supabase
      .from('delivery_requests')
      .select('delivery_status, preferred_provider_id')
      .eq('request_id', requestId)
      .maybeSingle();

    if (reqRow && reqRow.preferred_provider_id != null && Number(reqRow.preferred_provider_id) === Number(providerId)) {
      return await declineDirectRequest(requestId, providerId);
    }

    const { error } = await supabase
      .from('route_request_matches')
      .update({ status: 'declined' })
      .eq('request_id', requestId)
      .eq('provider_id', providerId)
      .in('status', ['matched', 'expired']);

    if (error) {
      // 'declined' not allowed by the CHECK constraint yet (run live_jobs_setup.sql): fall back to 'revoked'.
      // The app also hides the request locally, so the provider will not see it again either way.
      const { error: revokeErr } = await supabase
        .from('route_request_matches')
        .update({ status: 'revoked' })
        .eq('request_id', requestId)
        .eq('provider_id', providerId)
        .in('status', ['matched', 'expired']);
      if (revokeErr) return { ok: false, message: revokeErr.message };
    }

    return { ok: true, released: false };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Failed to decline this request.' };
  }
}