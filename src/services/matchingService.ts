// src/services/matchingService.ts
import { supabase } from '../utils/supabase';
import { getActiveRouteId, setActiveRouteId, getDemoMode } from './activeRouteStore';
import { fetchRouteCorridorAndDistance } from './routeService';
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
  start_location: Location;
  end_location: Location;
}

export interface DeliveryRequest {
  request_id: number;
  pickup_type?: string;
  scheduled_time: string | null;
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

/* ------------------------------------------------------------------ */
/* Geometry & Box Volume Helpers                                      */
/* ------------------------------------------------------------------ */
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

export function computeCargoVolumeLiters(cargoOrItems: any): number {
  if (!cargoOrItems) return 15;

  // Handle direct array of JobItem[] ({ size: 'Small' | 'Medium' | 'Large' })
  if (Array.isArray(cargoOrItems) && cargoOrItems.length > 0 && !('small_box_qty' in cargoOrItems[0])) {
    return cargoOrItems.reduce((acc, it) => {
      if (it?.size === 'Large') return acc + 95;
      if (it?.size === 'Medium') return acc + 45;
      return acc + 15;
    }, 0);
  }

  const c = Array.isArray(cargoOrItems) ? cargoOrItems[0] : cargoOrItems;
  if (!c) return 15;
  const s = Number(c.small_box_qty) || 0;
  const m = Number(c.medium_box_qty) || 0;
  const l = Number(c.large_box_qty) || 0;
  const total = s * 15 + m * 45 + l * 95;
  if (total > 0) return total;

  let items: any = c.items_json;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = null; }
  }
  if (Array.isArray(items) && items.length > 0) {
    return items.reduce((acc, it) => {
      if (it?.size === 'Large') return acc + 95;
      if (it?.size === 'Medium') return acc + 45;
      return acc + 15;
    }, 0);
  }
  return 15;
}

/**
 * Ensures older routes that were created before the PostGIS migration have
 * a valid `corridor_path` and remaining vehicle capacity so `evaluate_route_matches` works.
 */
export async function ensureRouteCorridorBackfilled(routeId: number): Promise<void> {
  try {
    const { data: route } = await supabase
      .from('provider_routes')
      .select(`
        route_id, corridor_path, remaining_weight_kg, remaining_volume_liters, vehicle_id,
        start_location:locations!provider_routes_start_location_id_fkey(*),
        end_location:locations!provider_routes_end_location_id_fkey(*),
        vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
      `)
      .eq('route_id', routeId)
      .maybeSingle();

    if (!route) return;

    const pathArr = Array.isArray(route.corridor_path) ? route.corridor_path : [];
    const needsCorridor = pathArr.length < 2;
    const needsCapacity =
      !route.remaining_weight_kg || Number(route.remaining_weight_kg) <= 0 ||
      !route.remaining_volume_liters || Number(route.remaining_volume_liters) <= 0;

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

/* ------------------------------------------------------------------ */
/* Core Route-First & Fallback Matching (Rules 1, 2, 3, 4)            */
/* ------------------------------------------------------------------ */
export async function evaluateAndFetchRouteMatches(
  routeId: number,
  demoMode?: boolean,
): Promise<RouteMatchRow[]> {
  if (!routeId) return [];

  const isDemo = demoMode !== undefined ? demoMode : await getDemoMode();

  // 1. Ensure route has PostGIS corridor geometry & trunk capacity
  await ensureRouteCorridorBackfilled(routeId);

  // 2. Run PostGIS corridor matching + Fallback Condition A/B check in Supabase
  const { error: rpcErr } = await supabase.rpc('evaluate_route_matches', {
    p_route_id: routeId,
    p_demo_mode: isDemo,
  });
  if (rpcErr) {
    console.warn('[matchingService] evaluate_route_matches RPC warning:', rpcErr.message);
  }

  // 3. Query strictly from route_request_matches (enforced by RLS)
  const { data: rows, error } = await supabase
    .from('route_request_matches')
    .select(`
      *,
      request:delivery_requests (
        *,
        pickup_location:locations!delivery_requests_pickup_location_id_fkey(*),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*),
        cargo:cargo_id(*),
        receiver:receiver_id(*)
      )
    `)
    .eq('route_id', routeId)
    .eq('status', 'matched')
    .order('is_fallback', { ascending: true })
    .order('match_score', { ascending: false });

  if (error) {
    console.error('[matchingService] error fetching route_request_matches:', error);
    return [];
  }

  return (rows || [])
    .filter((m: any) => m.request && m.request.delivery_status === 'Pending')
    .map((m: any) => ({
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
    }));
}

/**
 * Compatibility wrapper for findMatches(routeId):
 * Rule 1: If no routeId is provided, returns [] (zero requests until a route is posted).
 */
export async function findMatches(routeId?: number | null): Promise<MatchResult[]> {
  const targetRouteId = routeId ?? (await getActiveRouteId());
  if (!targetRouteId) return [];

  const { data: routeData } = await supabase
    .from('provider_routes')
    .select(`
      *,
      start_location:locations!provider_routes_start_location_id_fkey(*),
      end_location:locations!provider_routes_end_location_id_fkey(*)
    `)
    .eq('route_id', targetRouteId)
    .maybeSingle();

  if (!routeData || routeData.is_deleted || routeData.is_active === false) {
    return [];
  }

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

export async function autoMatchAndCreateDeliveries(
  routeId?: number | null,
): Promise<any[]> {
  const matches = await findMatches(routeId);
  return matches.map((m) => ({
    request_id: m.request.request_id,
    route_id: m.route.route_id,
    match_score: m.matchScore,
    is_fallback: m.isFallback,
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

/* ------------------------------------------------------------------ */
/* 5-Minute Background Fallback & Realtime Matcher (PDF Section 5 #4) */
/* ------------------------------------------------------------------ */
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
    const { data: { user: authUser } } = await supabase.auth.getUser();
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
              'Fallback Request Unlocked! 🔓',
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

  // Run immediately on boot
  runPeriodicFallbackAndMatchCheck();

  // PDF Backend Requirement #4: 5-minute background job to check Condition B / matches
  fallbackIntervalId = setInterval(() => {
    runPeriodicFallbackAndMatchCheck();
  }, 5 * 60 * 1000);

  globalMatchChannel = supabase
    .channel('realtime-global-matcher')
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
            row.is_fallback ? '🔓 Fallback Request Unlocked!' : `🎯 ${Math.round(Number(row.match_score))}% Route Match!`,
            row.is_fallback
              ? 'A 3 km fallback delivery request along your route is now available in My Route Requests.'
              : 'A new sender request along your route corridor matched (≥60%). Open My Route Requests to review.',
            [{ text: 'Got it', style: 'default' }],
          );
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