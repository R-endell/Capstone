// src/services/matchingService.ts
import { supabase } from '../utils/supabase';
import { getActiveRouteId } from './activeRouteStore';

export interface Location {
  latitude: number;
  longitude: number;
  location_id?: number;
  street_address?: string;
}

export interface ProviderRoute {
  route_id: number;
  provider_id: number;
  vehicle_id: number;
  departure_time: string;
  start_location: Location;
  end_location: Location;
}

export interface DeliveryRequest {
  request_id: number;
  scheduled_time: string | null;
  estimated_cost: number;
  emergency_flag: boolean;
  sender_id: number;
  pickup_location: Location;
  dropoff_location: Location;
}

export interface MatchResult {
  request: DeliveryRequest;
  route: ProviderRoute;
  matchScore: number;
}

/* ------------------------------------------------------------------ */
/* Distance helper                                                     */
/* ------------------------------------------------------------------ */
function calculateDistance(
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

  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) {
    return Infinity;
  }

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

/* ------------------------------------------------------------------ */
/* Road polyline helper (OSRM)                                         */
/* ------------------------------------------------------------------ */
async function getRoadPolyline(
  start: Location,
  end: Location,
): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      return data.routes[0].geometry.coordinates.map(
        ([lng, lat]: [number, number]) => [Number(lat), Number(lng)],
      );
    }
  } catch (err) {
    console.warn('OSRM error, using straight line fallback');
  }
  return [
    [Number(start.latitude), Number(start.longitude)],
    [Number(end.latitude), Number(end.longitude)],
  ];
}

function findClosestPointOnRoute(
  target: Location,
  roadPoints: [number, number][],
) {
  let minDistance = Infinity;
  let closestIndex = -1;
  if (!target || isNaN(Number(target.latitude))) {
    return { minDistance: Infinity, index: -1 };
  }

  for (let i = 0; i < roadPoints.length; i++) {
    const dist = calculateDistance(
      target.latitude,
      target.longitude,
      roadPoints[i][0],
      roadPoints[i][1],
    );
    if (!isNaN(dist) && dist < minDistance) {
      minDistance = dist;
      closestIndex = i;
    }
  }
  return { minDistance, index: closestIndex };
}

function isAlongRouteInOrder(
  pickup: Location,
  dropoff: Location,
  roadPoints: [number, number][],
  radiusKm: number = 2.0,
): boolean {
  const pickupMatch = findClosestPointOnRoute(pickup, roadPoints);
  const dropoffMatch = findClosestPointOnRoute(dropoff, roadPoints);

  if (
    !(pickupMatch.minDistance <= radiusKm) ||
    !(dropoffMatch.minDistance <= radiusKm) ||
    pickupMatch.index > dropoffMatch.index
  ) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Time helpers (Manila, UTC+8)                                        */
/* ------------------------------------------------------------------ */
/**
 * Returns "YYYY-MM-DD" for the given date in Manila time.
 * Used for calendar-day comparison.
 */
const getManilaDateString = (input: string | Date): string => {
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else {
    const normalized = String(input).replace(' ', 'T');
    d = new Date(normalized);
  }
  if (isNaN(d.getTime())) return '';
  const manila = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  return manila.toISOString().slice(0, 10);
};

/**
 * Strict same calendar-day (Manila) check.
 */
function isSameDay(time1: string | null | undefined, time2: string | null | undefined): boolean {
  if (!time1 || !time2) return false;
  const d1 = getManilaDateString(time1);
  const d2 = getManilaDateString(time2);
  return !!d1 && !!d2 && d1 === d2;
}

/**
 * Time-window check.
 * - If allowPast is true → compares absolute difference (both past & future allowed).
 * - If allowPast is false → only future window (route must be after request but within window).
 */
function isWithinMinutes(
  requestTime: string,
  routeTime: string,
  windowMinutes: number,
  allowPast: boolean = true,
): boolean {
  const t1 = new Date(String(requestTime).replace(' ', 'T')).getTime();
  const t2 = new Date(String(routeTime).replace(' ', 'T')).getTime();
  if (isNaN(t1) || isNaN(t2)) return false;

  if (allowPast) {
    return Math.abs(t1 - t2) / 60000 <= windowMinutes;
  } else {
    // Future-only: route must be after request, and within window
    const diffMinutes = (t2 - t1) / 60000;
    return diffMinutes >= 0 && diffMinutes <= windowMinutes;
  }
}

/* ------------------------------------------------------------------ */
/* Data fetchers                                                       */
/*                                                                     */
/* IMPORTANT: only funded requests (payment_status = 'held') are       */
/* returned here. This is the single source of truth that keeps        */
/* providers from ever seeing / accepting unpaid requests.             */
/* ------------------------------------------------------------------ */
export async function getPendingRequests(): Promise<any[]> {
  const { data } = await supabase
    .from('delivery_requests')
    .select(
      '*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)',
    )
    .eq('delivery_status', 'Pending')
    .eq('payment_status', 'held');
  return data || [];
}

async function getActiveProviderRoutes(): Promise<ProviderRoute[]> {
  // Look back 24h so we don't hide recently active routes that are still in progress.
  const pastDay = new Date();
  pastDay.setHours(pastDay.getHours() - 24);

  const { data, error } = await supabase
    .from('provider_routes')
    .select(
      '*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*), provider:users!provider_id(is_active)',
    )
    .gte('departure_time', pastDay.toISOString());

  if (error) {
    console.error('Error fetching provider routes:', error);
    return [];
  }

  return (data || []).filter((r: any) => r.provider?.is_active === true);
}

/* ------------------------------------------------------------------ */
/* findMatches — read-only match query                                 */
/*                                                                     */
/* Rules:                                                              */
/*   • Route must be active (provider.is_active = true)                */
/*   • Pickup & dropoff must lie along the route polyline (±2 km)      */
/*   • Pickup must come before dropoff along the route                 */
/*   • Send Now:                                                       */
/*       - Request time is "now" (Manila)                              */
/*       - Route departure_time MUST be in the FUTURE (>= now)         */
/*       - Route departure_time MUST be within 3 hours of "now"        */
/*   • Scheduled:                                                      */
/*       - Must be same calendar day (Manila)                          */
/*       - Within ±4 hours of the route departure_time                 */
/* ------------------------------------------------------------------ */
const SEND_NOW_MAX_LOOKAHEAD_MINUTES = 180; // 3 hours
const SCHEDULED_WINDOW_MINUTES = 240;       // 4 hours

export async function findMatches(
  routeId?: number | null,
): Promise<MatchResult[]> {
  const [pendingRequests, providerRoutes] = await Promise.all([
    getPendingRequests(),
    getActiveProviderRoutes(),
  ]);

  const routesToCheck = routeId
    ? providerRoutes.filter((r) => r.route_id === routeId)
    : providerRoutes;

  const matches: MatchResult[] = [];
  const routePolylines = new Map<number, [number, number][]>();

  for (const route of routesToCheck) {
    routePolylines.set(
      route.route_id,
      await getRoadPolyline(route.start_location, route.end_location),
    );
  }

  const nowIso = new Date().toISOString();

  for (const request of pendingRequests) {
    if (!request.pickup_location || !request.dropoff_location) continue;

    // "Send Now" requests have scheduled_time = null.
    const isSendNow = !request.scheduled_time;
    const effectiveRequestTime: string = request.scheduled_time || nowIso;

    for (const route of routesToCheck) {
      const roadPoints = routePolylines.get(route.route_id) || [];

      if (
        !isAlongRouteInOrder(
          request.pickup_location,
          request.dropoff_location,
          roadPoints,
          2.0,
        )
      )
        continue;

      // ---- Same-day (Manila) restriction ----
      if (!isSameDay(effectiveRequestTime, route.departure_time)) {
        continue;
      }

      // ---- Time-window restriction ----
      if (isSendNow) {
        // Send Now: route MUST be in the future, within 3 hours.
        if (
          !isWithinMinutes(
            effectiveRequestTime,
            route.departure_time,
            SEND_NOW_MAX_LOOKAHEAD_MINUTES,
            false, // allowPast = false
          )
        ) {
          continue;
        }
      } else {
        // Scheduled: ±4h window.
        if (
          !isWithinMinutes(
            request.scheduled_time!,
            route.departure_time,
            SCHEDULED_WINDOW_MINUTES,
            true, // allowPast = true
          )
        ) {
          continue;
        }
      }

      matches.push({ request, route, matchScore: 100 });
    }
  }
  return matches;
}

/* ------------------------------------------------------------------ */
/* autoMatchAndCreateDeliveries — READ-ONLY                            */
/* ------------------------------------------------------------------ */
export async function autoMatchAndCreateDeliveries(
  routeId?: number | null,
): Promise<any[]> {
  const matches = await findMatches(routeId);
  return matches.map((m) => ({
    request_id: m.request.request_id,
    route_id: m.route.route_id,
  }));
}

/* ------------------------------------------------------------------ */
/* Provider deliveries                                                 */
/* ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */
export function subscribeToNewRequests(callback: (payload: any) => void) {
  return supabase
    .channel(`requests-${Date.now()}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'delivery_requests' },
      callback,
    )
    .subscribe();
}

export function subscribeToProviderRoutes(
  providerId: number | null,
  callback: (payload: any) => void,
) {
  const filter = providerId ? `provider_id=eq.${providerId}` : undefined;
  const channelName = `routes-${providerId ?? 'all'}-${Date.now()}`;

  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'provider_routes',
        ...(filter ? { filter } : {}),
      },
      callback,
    )
    .subscribe();
}

export function subscribeToDeliveryUpdates(
  providerId: number,
  callback: (payload: any) => void,
) {
  return supabase
    .channel(`deliveries-${providerId}-${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deliveries',
        filter: `provider_id=eq.${providerId}`,
      },
      callback,
    )
    .subscribe();
}

import { Alert } from 'react-native';
import { setActiveRouteId } from './activeRouteStore';

let globalMatchChannel: any = null;

export function stopBackgroundMatcher() {
  if (globalMatchChannel) {
    supabase.removeChannel(globalMatchChannel);
    globalMatchChannel = null;
  }
}

export function startBackgroundMatcher() {
  stopBackgroundMatcher();

  (async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    try {
      // Verify route still exists and belongs to the currently authenticated user
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const { data: routeRow } = await supabase
        .from('provider_routes')
        .select('route_id, provider_id, provider:users!provider_id(auth_id, is_active)')
        .eq('route_id', routeId)
        .maybeSingle();

      const providerInfo: any = Array.isArray(routeRow?.provider) ? routeRow.provider[0] : routeRow?.provider;
      if (!routeRow || providerInfo?.auth_id !== authUser.id) {
        // Stale route from an old session or before DB reset — clear it
        await setActiveRouteId(null);
        return;
      }

      const proposals = await autoMatchAndCreateDeliveries(routeId);
      console.log(`📊 Initial matching proposed ${proposals.length} requests for route ${routeId}`);
    } catch (err) {
      console.error('❌ Initial match error:', err);
    }
  })();

  const handleIncoming = async (row: any) => {
    if (row.delivery_status !== 'Pending') return;
    if (row.payment_status !== 'held') return;

    const routeId = await getActiveRouteId();
    if (!routeId) return;

    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const { data: route } = await supabase
        .from('provider_routes')
        .select('provider_id, provider:users!provider_id(auth_id, is_active)')
        .eq('route_id', routeId)
        .maybeSingle();

      const providerInfo: any = Array.isArray(route?.provider) ? route.provider[0] : route?.provider;
      if (!route || providerInfo?.auth_id !== authUser.id || !providerInfo?.is_active) {
        return;
      }

      const proposals = await autoMatchAndCreateDeliveries(routeId);
      const matchesThisRequest = proposals.some(
        (d: any) => d.request_id === row.request_id,
      );

      if (matchesThisRequest) {
        Alert.alert(
          '🎯 New Delivery Match!',
          'A new sender request matches your route. Open the Jobs tab to review and accept it.',
          [{ text: 'Got it', style: 'default' }],
        );
      }
    } catch (err) {
      console.error('❌ Global match check error:', err);
    }
  };

  globalMatchChannel = supabase
    .channel('realtime-global-matcher')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'delivery_requests' },
      (payload) => handleIncoming(payload.new),
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'delivery_requests' },
      (payload) => {
        const before = payload.old?.payment_status;
        const after = payload.new?.payment_status;
        if (before !== 'held' && after === 'held') {
          handleIncoming(payload.new);
        }
      },
    )
    .subscribe();

  return () => stopBackgroundMatcher();
}

export async function updateProviderStatus(providerId: number, isOnline: boolean) {
  const { error } = await supabase
    .from('users')
    .update({ is_active: isOnline })
    .eq('user_id', providerId);

  if (error) {
    console.error('❌ Error updating provider status:', error);
  }
}

export async function getMatchingStats(providerId: number) {
  try {
    const { data: deliveries } = await supabase
      .from('deliveries')
      .select('*')
      .eq('provider_id', providerId);

    const { data: pending } = await supabase
      .from('delivery_requests')
      .select('*')
      .eq('delivery_status', 'Pending')
      .eq('payment_status', 'held');

    return {
      totalDeliveries: deliveries?.length || 0,
      pendingRequests: pending?.length || 0,
      matchRate:
        deliveries?.length && pending?.length
          ? ((deliveries.length / (deliveries.length + pending.length)) * 100).toFixed(1)
          : '0',
    };
  } catch (error) {
    console.error('Error getting matching stats:', error);
    return null;
  }
}