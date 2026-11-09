// src/services/matchingService.ts
import { supabase } from '../utils/supabase';
import { getActiveRouteId, getDemoMode } from './activeRouteStore';
import { fetchRouteCorridorAndDistance, parseNaiveRouteTime } from './routeService';
import { notifyUser } from './pushService';
import { Alert } from 'react-native';

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

/**
 * Has this route already departed as of `now`?
 * Example: Route is at 10:00 AM today.
 * - At 8:00 AM -> returns false (has NOT departed yet -> CAN match!)
 * - At 11:00 AM -> returns true (HAS departed -> CANNOT match!)
 */
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
 * Enforces the Send-Now same-day departure rule:
 * - Sender books Send Package Now at 8:00 AM, provider route is at 10:00 AM today -> TRUE (matches!)
 * - Sender books Send Package Now at 11:00 AM, provider route was at 10:00 AM today -> FALSE (too late, won't match!)
 * - Also checks `now` so if 10:00 AM has already passed without acceptance, it won't match anymore.
 */
export function isRouteTimeValidForRequest(route: any, request: any, now = new Date()): boolean {
  if (!route || !request) return false;
  if (request.preferred_provider_id != null) return true;

  if (!isSendNowRequest(request)) {
    // Scheduled request: match if scheduled on the same day before route departure
    return true;
  }

  // Must be a route running today
  if (!isRouteRunningToday(route, now)) return false;

  const routeDepToday = getRouteTodayDepartureDate(route, now);
  const bookedAt = parseRequestCreatedTime(request);

  // 1. Booking must have been made BEFORE the route's departure time today (e.g. 8:00 AM <= 10:00 AM)
  if (bookedAt.getTime() > routeDepToday.getTime()) {
    return false;
  }

  // 2. And the route must not have already departed right now
  if (now.getTime() > routeDepToday.getTime()) {
    return false;
  }

  return true;
}

function projectPointToPolyline(
  pt: { lat: number; lng: number },
  polyline: { latitude: number; longitude: number }[],
): { minDistanceM: number; fraction: number } {
  if (!polyline || polyline.length === 0) return { minDistanceM: Infinity, fraction: 0 };
  if (polyline.length === 1) {
    const dKm = calculateDistance(pt.lat, pt.lng, polyline[0].latitude, polyline[0].longitude);
    return { minDistanceM: dKm * 1000, fraction: 0 };
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
    return { minDistanceM: dKm * 1000, fraction: 0 };
  }
  let bestDistKm = Infinity;
  let bestFraction = 0;
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
    }
    traversedKm += segLen;
  }
  return { minDistanceM: Math.round(bestDistKm * 1000), fraction: Number(bestFraction.toFixed(4)) };
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
 * if the route runs today, hasn't departed yet, and the pickup/dropoff lie along the route.
 */
async function evaluatePairAndUpsertMatch(
  route: any,
  reqRow: any,
  now: Date,
  shouldNotify: boolean,
): Promise<boolean> {
  if (!route || !reqRow || reqRow.delivery_status !== 'Pending') return false;
  if (Number(route.provider_id) === Number(reqRow.sender_id)) return false;

  const isDirectRequest = reqRow.preferred_provider_id != null;
  const isPreferredRoute =
    (reqRow.preferred_route_id && Number(reqRow.preferred_route_id) === Number(route.route_id)) ||
    (!reqRow.preferred_route_id &&
      reqRow.preferred_provider_id &&
      Number(reqRow.preferred_provider_id) === Number(route.provider_id));

  if (isDirectRequest && !isPreferredRoute) return false;

  // Enforce same-day before-departure rule for Send Package Now
  if (!isRouteTimeValidForRequest(route, reqRow, now)) {
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

  const isDoorToDoor = /door/i.test(String(reqRow.pickup_type || ''));
  const maxCorridorM = isDoorToDoor ? 3000 : 1500;
  const fallbackMaxM = 5000;

  const fitsCapacity =
    Number(route.remaining_weight_kg ?? 100) >= reqWeight &&
    Number(route.remaining_volume_liters ?? 300) >= reqVol;
  const isForward = doProj.fraction >= puProj.fraction - 0.05;
  const withinPrimary = puProj.minDistanceM <= maxCorridorM && doProj.minDistanceM <= maxCorridorM;
  const withinFallback = puProj.minDistanceM <= fallbackMaxM && doProj.minDistanceM <= fallbackMaxM;

  if (!isPreferredRoute && !(fitsCapacity && isForward && (withinPrimary || withinFallback))) {
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
    : Math.max(60, Math.min(99, Math.round(100 - (avgDistM / fallbackMaxM) * 35)));

  if (existingMatch) {
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
    fallback_type: !isPreferredRoute && !withinPrimary ? 'CONDITION_A' : null,
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
        { type: isPreferredRoute ? 'direct_route_request' : 'match', requestId: reqRow.request_id, routeId: route.route_id },
      );
    } catch {}
  }

  return !insErr;
}

/**
 * Called by Sender's BookingScreen / scheduleService when a new request is created or paid.
 * Finds all active provider routes running today that haven't departed yet,
 * creates `route_request_matches` rows, and returns them sorted by best match.
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

    const { data: allRoutes } = await supabase
      .from('provider_routes')
      .select(
        `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
      )
      .eq('is_active', true)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    const now = new Date();

    // Pick each provider's selected route running today, or fall back to their latest active route running today
    // so routes whose `is_selected` column wasn't flipped yet are never skipped!
    const routesByProvider = new Map<number, any[]>();
    for (const r of allRoutes || []) {
      if (!routesByProvider.has(r.provider_id)) routesByProvider.set(r.provider_id, []);
      routesByProvider.get(r.provider_id)!.push(r);
    }

    const candidateRoutes: any[] = [];
    routesByProvider.forEach((pRoutes) => {
      const runningToday = pRoutes.filter((r) => isRouteRunningToday(r, now));
      const selectedToday = runningToday.find((r) => r.is_selected === true);
      if (selectedToday) {
        candidateRoutes.push(selectedToday);
      } else if (runningToday.length > 0) {
        candidateRoutes.push(runningToday[0]);
      }
    });

    // Always include explicitly preferred route/provider
    for (const r of allRoutes || []) {
      const isPref =
        (reqRow.preferred_route_id && Number(r.route_id) === Number(reqRow.preferred_route_id)) ||
        (reqRow.preferred_provider_id && Number(r.provider_id) === Number(reqRow.preferred_provider_id));
      if (isPref && !candidateRoutes.some((c) => c.route_id === r.route_id)) {
        candidateRoutes.push(r);
      }
    }

    for (const route of candidateRoutes) {
      await ensureRouteCorridorBackfilled(route.route_id);
      if (isRouteTimeValidForRequest(route, reqRow, now)) {
        try {
          await supabase.rpc('evaluate_route_matches', {
            p_route_id: route.route_id,
            p_demo_mode: isDemo,
          });
        } catch {}
      }
      await evaluatePairAndUpsertMatch(route, reqRow, now, shouldNotify);
    }

    const { data: matches } = await supabase
      .from('route_request_matches')
      .select(
        `*, route:provider_routes(*), request:delivery_requests (*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*))`,
      )
      .eq('request_id', requestId)
      .eq('status', 'matched')
      .order('match_score', { ascending: false });

    // Filter out any matches whose route already departed for Send Now
    const validMatches = (matches || []).filter((m: any) => {
      const r = Array.isArray(m.route) ? m.route[0] : m.route;
      return !r || isRouteTimeValidForRequest(r, reqRow, now);
    });

    return validMatches as RouteMatchRow[];
  } catch (err) {
    console.warn('[matchingService] syncAllActiveRoutesTodayForRequest warning:', err);
    return [];
  }
}

/**
 * Scans all open `Pending` requests created today against a specific provider route
 * so when a provider opens JobsScreen or posts a route, any waiting Send-Now request
 * that fits their route corridor and time window is matched immediately.
 */
export async function syncOpenPendingRequestsForRoute(routeId: number): Promise<void> {
  if (!routeId) return;
  try {
    const { data: route } = await supabase
      .from('provider_routes')
      .select(
        `*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`,
      )
      .eq('route_id', routeId)
      .maybeSingle();

    if (!route || route.is_deleted || route.is_active === false) return;

    const now = new Date();
    if (!isRouteRunningToday(route, now)) return;

    const { data: pendingReqs } = await supabase
      .from('delivery_requests')
      .select(
        `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)`,
      )
      .eq('delivery_status', 'Pending')
      .order('created_at', { ascending: false })
      .limit(40);

    if (!pendingReqs || pendingReqs.length === 0) return;

    const reqIds = pendingReqs.map((r: any) => r.request_id);
    const { data: existingDelivs } = await supabase
      .from('deliveries')
      .select('request_id')
      .in('request_id', reqIds);
    const takenSet = new Set((existingDelivs || []).map((d: any) => d.request_id));

    for (const reqRow of pendingReqs) {
      if (takenSet.has(reqRow.request_id)) continue;
      await evaluatePairAndUpsertMatch(route, reqRow, now, false);
    }
  } catch (e) {
    console.warn('[matchingService] syncOpenPendingRequestsForRoute warning:', e);
  }
}

export async function evaluateAndFetchRouteMatches(
  routeId: number,
  demoMode?: boolean,
  opts: { evaluate?: boolean } = {},
): Promise<RouteMatchRow[]> {
  if (!routeId) return [];
  const doEvaluate = opts.evaluate !== false;

  if (doEvaluate) {
    const isDemo = demoMode !== undefined ? demoMode : await getDemoMode();
    await ensureRouteCorridorBackfilled(routeId);
    try {
      await supabase.rpc('evaluate_route_matches', { p_route_id: routeId, p_demo_mode: isDemo });
    } catch {}
    await syncOpenPendingRequestsForRoute(routeId);
  }

  const { data: routeRow } = await supabase
    .from('provider_routes')
    .select('route_id, provider_id, departure_time, end_time, route_frequency, is_active, is_deleted')
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
  const afterPending = (rows || []).filter((m: any) => m.request && m.request.delivery_status === 'Pending');
  const afterPreferred = afterPending.filter(
    (m: any) =>
      m.request.preferred_provider_id == null ||
      Number(m.request.preferred_provider_id) === Number(m.provider_id),
  );
  const afterTime = afterPreferred.filter((m: any) =>
    isRouteTimeValidForRequest(routeRow, m.request, now),
  );

  return afterTime.map((m: any) => ({
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
    .eq('delivery_status', 'Pending');

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

/**
 * Fetches all requests awaiting THIS provider's acceptance for TaskScreen -> Pending tab:
 * 1. Direct requests addressed to this provider (from Explore)
 * 2. Route matches across the provider's active route(s) today (including Send Package Now)
 */
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
                ? '1 hour before departure with 0 matches: 1 wider 3 km fallback request is now available on your route.'
                : 'Add-On Fallback unlocked! You have remaining trunk space for 1 extra delivery within 3 km.',
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

  globalMatchChannel = supabase
    .channel('realtime-global-matcher')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'route_request_matches' }, async (payload) => {
      const row: any = payload.new;
      if (!row || row.status !== 'matched') return;
      const activeRouteId = await getActiveRouteId();
      if (!activeRouteId || Number(row.route_id) !== Number(activeRouteId)) return;
      if (!notifiedMatchIds.has(Number(row.match_id))) {
        notifiedMatchIds.add(Number(row.match_id));
        Alert.alert(
          row.is_fallback ? '📦 Fallback Request Unlocked!' : `🎯 ${Math.round(Number(row.match_score))}% Route Match!`,
          row.is_fallback
            ? 'A 3 km fallback delivery request along your route is now available in My Route Requests.'
            : 'A new sender request along your route corridor matched (≥60%). Open My Route Requests to review.',
          [{ text: 'Got it', style: 'default' }],
        );
      }
    })
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