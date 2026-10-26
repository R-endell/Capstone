// src/services/matchingService.ts
import { supabase } from '../utils/supabase';
import { getActiveRouteId } from './activeRouteStore';
import { Alert } from 'react-native';
import { setActiveRouteId } from './activeRouteStore';

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
/* Route Detour Logic                                                  */
/* ------------------------------------------------------------------ */
/**
 * Instead of forcing the package to be exactly on the provider's straight line,
 * we calculate if the provider can make a reasonable detour to pick it up.
 */
function isReasonableDetour(
  start: Location,
  end: Location,
  pickup: Location,
  dropoff: Location,
  maxDetourMultiplier: number = 1.5, // route can only be 50% longer than direct
): boolean {
  const directDist = calculateDistance(start.latitude, start.longitude, end.latitude, end.longitude);
  
  // If the direct route is super short (e.g. 500m), don't match cross-city packages
  if (directDist < 1) return false;

  const leg1 = calculateDistance(start.latitude, start.longitude, pickup.latitude, pickup.longitude);
  const leg2 = calculateDistance(pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude);
  const leg3 = calculateDistance(dropoff.latitude, dropoff.longitude, end.latitude, end.longitude);

  const detourDist = leg1 + leg2 + leg3;

  // Package cannot be insanely far from the provider's start/end points
  if (leg1 > 5 || leg3 > 5) return false; 

  // The total trip with the package must not be absurdly longer than the direct trip
  return detourDist <= (directDist * maxDetourMultiplier);
}

/* ------------------------------------------------------------------ */
/* Time helpers (Manila, UTC+8)                                        */
/* ------------------------------------------------------------------ */
/**
 * Turn a DB timestamp into a real instant.
 *  - "2026-10-26T03:00:00Z" / "...+00:00" / "...+08:00"  -> respected as-is
 *  - "2026-10-26 11:00:00" (no zone, what scheduled_time is saved as) -> Manila time (+08:00)
 * Independent of the phone's own time zone.
 */
const toInstant = (input: string | Date | null | undefined): Date | null => {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  let str = String(input).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(str.slice(10))) str += '+08:00';
  else if (/[+-]\d{2}$/.test(str)) str += ':00';
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

const getManilaDateString = (input: string | Date): string => {
  const d = toInstant(input);
  if (!d) return '';
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
};

function isSameDay(time1: string | null | undefined, time2: string | null | undefined): boolean {
  if (!time1 || !time2) return false;
  const d1 = getManilaDateString(time1);
  const d2 = getManilaDateString(time2);
  return !!d1 && !!d2 && d1 === d2;
}

/** minutes from `from` to `to` (positive = `to` is later) */
const minutesBetween = (from: string | Date, to: string | Date): number | null => {
  const a = toInstant(from), b = toInstant(to);
  return a && b ? (b.getTime() - a.getTime()) / 60000 : null;
};

/* ------------------------------------------------------------------ */
/* Data fetchers                                                       */
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
  const pastDay = new Date();
  pastDay.setHours(pastDay.getHours() - 24);

  const { data, error } = await supabase
    .from('provider_routes')
    .select(
      '*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*), provider:users!provider_id(is_active, is_online)',
    )
    .gte('departure_time', pastDay.toISOString());

  if (error) {
    console.error('Error fetching provider routes:', error);
    return [];
  }

  return (data || []).filter((r: any) => r.provider?.is_active !== false && r.provider?.is_online === true);
}

/* ------------------------------------------------------------------ */
/* findMatches — read-only match query                                 */
/* ------------------------------------------------------------------ */
const SEND_NOW_MAX_LOOKAHEAD_MINUTES = 180;
// a route that left up to this long ago is still on the road and can take a send-now package
const SEND_NOW_GRACE_PAST_MINUTES = 120;
const DEBUG_MATCH = __DEV__;
const SCHEDULED_WINDOW_MINUTES = 240;

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
  const nowIso = new Date().toISOString();
  if (DEBUG_MATCH) console.log(`[match] ${pendingRequests.length} pending request(s), ${routesToCheck.length} route(s)`);

  for (const request of pendingRequests) {
    if (!request.pickup_location || !request.dropoff_location) continue;

    const isSendNow = !request.scheduled_time;
    const effectiveRequestTime = request.scheduled_time || nowIso;

    for (const route of routesToCheck) {
      const tag = `req ${request.request_id} × route ${route.route_id}`;
      if (!route.start_location || !route.end_location) {
        if (DEBUG_MATCH) console.log(`[match] ${tag}: route has no start/end location`);
        continue;
      }

      // 1. Spatial check (reasonable detour)
      if (!isReasonableDetour(route.start_location, route.end_location, request.pickup_location, request.dropoff_location)) {
        if (DEBUG_MATCH) console.log(`[match] ${tag}: rejected by detour/distance`);
        continue;
      }

      // 2. Same day (Manila)
      if (!isSameDay(effectiveRequestTime, route.departure_time)) {
        if (DEBUG_MATCH) console.log(`[match] ${tag}: different day (${effectiveRequestTime} vs ${route.departure_time})`);
        continue;
      }

      // 3. Time window
      const diff = minutesBetween(effectiveRequestTime, route.departure_time); // + = route leaves later
      if (diff == null) continue;
      const ok = isSendNow
        ? diff >= -SEND_NOW_GRACE_PAST_MINUTES && diff <= SEND_NOW_MAX_LOOKAHEAD_MINUTES
        : Math.abs(diff) <= SCHEDULED_WINDOW_MINUTES;
      if (!ok) {
        if (DEBUG_MATCH) console.log(`[match] ${tag}: time window (route leaves ${Math.round(diff)} min from request time)`);
        continue;
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
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;

      const { data: routeRow } = await supabase
        .from('provider_routes')
        .select('route_id, provider_id, provider:users!provider_id(auth_id, is_active, is_online)')
        .eq('route_id', routeId)
        .maybeSingle();

      const providerInfo: any = Array.isArray(routeRow?.provider) ? routeRow.provider[0] : routeRow?.provider;
      if (!routeRow || providerInfo?.auth_id !== authUser.id) {
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
        .select('provider_id, provider:users!provider_id(auth_id, is_active, is_online)')
        .eq('route_id', routeId)
        .maybeSingle();

      const providerInfo: any = Array.isArray(route?.provider) ? route.provider[0] : route?.provider;
      if (!route || providerInfo?.auth_id !== authUser.id || providerInfo?.is_active === false || !providerInfo?.is_online) {
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
    .update({ is_online: isOnline })
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