// src/services/matchingService.ts
import { supabase } from '../utils/supabase';

export interface Location { latitude: number; longitude: number; location_id?: number; street_address?: string; }
export interface ProviderRoute { route_id: number; provider_id: number; vehicle_id: number; departure_time: string; start_location: Location; end_location: Location; }
export interface DeliveryRequest { request_id: number; scheduled_time: string | null; estimated_cost: number; emergency_flag: boolean; sender_id: number; pickup_location: Location; dropoff_location: Location; }
export interface MatchResult { request: DeliveryRequest; route: ProviderRoute; matchScore: number; }

function calculateDistance(lat1: number | string, lon1: number | string, lat2: number | string, lon2: number | string): number {
  const R = 6371; 
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);

  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return Infinity;

  const dLat = ((numLat2 - numLat1) * Math.PI) / 180; 
  const dLon = ((numLon2 - numLon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((numLat1 * Math.PI) / 180) * Math.cos((numLat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getRoadPolyline(start: Location, end: Location): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url); 
    const data = await res.json();
    if (data.routes && data.routes.length > 0) return data.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [Number(lat), Number(lng)]);
  } catch (err) { console.warn('OSRM error, using straight line fallback'); }
  return [[Number(start.latitude), Number(start.longitude)], [Number(end.latitude), Number(end.longitude)]];
}

function findClosestPointOnRoute(target: Location, roadPoints: [number, number][]) {
  let minDistance = Infinity; let closestIndex = -1;
  if (!target || isNaN(Number(target.latitude))) return { minDistance: Infinity, index: -1 };

  for (let i = 0; i < roadPoints.length; i++) {
    const dist = calculateDistance(target.latitude, target.longitude, roadPoints[i][0], roadPoints[i][1]);
    if (!isNaN(dist) && dist < minDistance) { minDistance = dist; closestIndex = i; }
  }
  return { minDistance, index: closestIndex };
}

function isAlongRouteInOrder(pickup: Location, dropoff: Location, roadPoints: [number, number][], radiusKm: number = 2.0): boolean {
  const pickupMatch = findClosestPointOnRoute(pickup, roadPoints);
  const dropoffMatch = findClosestPointOnRoute(dropoff, roadPoints);
  
  if (!(pickupMatch.minDistance <= radiusKm) || !(dropoffMatch.minDistance <= radiusKm) || pickupMatch.index > dropoffMatch.index) {
    return false;
  }
  return true;
}

function isTimeWithinWindow(time1: string, time2: string, windowMinutes: number = 1440): boolean {
  const diffMinutes = Math.abs((new Date(time1).getTime() - new Date(time2).getTime()) / 60000);
  return diffMinutes <= windowMinutes;
}

export async function getPendingRequests(): Promise<any[]> {
  const { data } = await supabase.from('delivery_requests')
    .select('*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)')
    .eq('delivery_status', 'Pending');
  return data || [];
}

async function getActiveProviderRoutes(): Promise<ProviderRoute[]> {
  const pastDay = new Date(); pastDay.setHours(pastDay.getHours() - 24);
  const { data, error } = await supabase
    .from('provider_routes')
    .select('*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*), provider:users!provider_id(is_active)')
    .gte('departure_time', pastDay.toISOString());

  if (error) {
    console.error("Error fetching provider routes:", error);
    return [];
  }

  // Strictly filter out any route where the provider is Offline (is_active === false)
  return (data || []).filter((r: any) => r.provider?.is_active === true);
}

export async function findMatches(): Promise<MatchResult[]> {
  const [pendingRequests, providerRoutes] = await Promise.all([getPendingRequests(), getActiveProviderRoutes()]);
  const matches: MatchResult[] = [];
  const routePolylines = new Map<number, [number, number][]>();

  for (const route of providerRoutes) {
    routePolylines.set(route.route_id, await getRoadPolyline(route.start_location, route.end_location));
  }

  for (const request of pendingRequests) {
    if (!request.pickup_location || !request.dropoff_location) continue;

    for (const route of providerRoutes) {
      const roadPoints = routePolylines.get(route.route_id) || [];
      if (!isAlongRouteInOrder(request.pickup_location, request.dropoff_location, roadPoints, 2.0)) continue;
      
      const isTimeMatch = request.scheduled_time ? isTimeWithinWindow(request.scheduled_time, route.departure_time, 1440) : true;
      if (isTimeMatch) {
        matches.push({ request, route, matchScore: 100 });
      }
    }
  }
  return matches;
}

export async function autoMatchAndCreateDeliveries(): Promise<any[]> {
  // Propose model: We just find the matches and return them to the UI so the Provider can accept them.
  const matches = await findMatches();
  return matches.map(m => ({ request_id: m.request.request_id, route_id: m.route.route_id }));
}

export async function getProviderDeliveries(providerId: number) {
  const { data } = await supabase.from('deliveries').select('*, delivery_requests:request_id(*, pickup_location:pickup_location_id(*), dropoff_location:dropoff_location_id(*), cargo:cargo_id(*), receiver:receiver_id(*))').eq('provider_id', providerId).order('accepted_at', { ascending: false });
  return data || [];
}

export function subscribeToNewRequests(callback: (payload: any) => void) {
  return supabase.channel(`requests-${Date.now()}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_requests' }, callback).subscribe();
}

export function subscribeToProviderRoutes(providerId: number, callback: (payload: any) => void) {
  return supabase.channel(`routes-${providerId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes', filter: `provider_id=eq.${providerId}` }, callback).subscribe();
}

export function subscribeToDeliveryUpdates(providerId: number, callback: (payload: any) => void) {
  return supabase.channel(`deliveries-${providerId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` }, callback).subscribe();
}

let globalMatchChannel: any = null;
let globalMatchInterval: NodeJS.Timeout | null = null;

export function startBackgroundMatcher(): () => void {
  globalMatchChannel = supabase.channel('realtime-matcher')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_requests' }, () => autoMatchAndCreateDeliveries())
    .subscribe();
  return () => stopBackgroundMatcher();
}

export function stopBackgroundMatcher(): void {
  if (globalMatchChannel) { supabase.removeChannel(globalMatchChannel); globalMatchChannel = null; }
  if (globalMatchInterval) { clearInterval(globalMatchInterval); globalMatchInterval = null; }
}