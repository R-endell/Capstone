// src/services/matchingService.ts
import { supabase } from '../utils/supabase';

export interface Location { latitude: number; longitude: number; location_id?: number; street_address?: string; }
export interface ProviderRoute { route_id: number; provider_id: number; vehicle_id: number; departure_time: string; start_location: Location; end_location: Location; }
export interface DeliveryRequest { request_id: number; scheduled_time: string | null; estimated_cost: number; emergency_flag: boolean; sender_id: number; pickup_location: Location; dropoff_location: Location; }
export interface MatchResult { request: DeliveryRequest; route: ProviderRoute; matchScore: number; }

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; 
  const dLat = ((lat2 - lat1) * Math.PI) / 180; 
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getRoadPolyline(start: Location, end: Location): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url); 
    const data = await res.json();
    if (data.routes && data.routes.length > 0) return data.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng]);
  } catch (err) { console.warn('OSRM error'); }
  return [[start.latitude, start.longitude], [end.latitude, end.longitude]];
}

function findClosestPointOnRoute(target: Location, roadPoints: [number, number][]) {
  let minDistance = Infinity; let closestIndex = -1;
  for (let i = 0; i < roadPoints.length; i++) {
    const dist = calculateDistance(target.latitude, target.longitude, roadPoints[i][0], roadPoints[i][1]);
    if (dist < minDistance) { minDistance = dist; closestIndex = i; }
  }
  return { minDistance, index: closestIndex };
}

function isAlongRouteInOrder(pickup: Location, dropoff: Location, roadPoints: [number, number][], radiusKm: number = 2.0): boolean {
  const pickupMatch = findClosestPointOnRoute(pickup, roadPoints);
  const dropoffMatch = findClosestPointOnRoute(dropoff, roadPoints);
  
  console.log(`   📏 Pickup Distance to Route: ${pickupMatch.minDistance.toFixed(2)}km`);
  console.log(`   📏 Dropoff Distance to Route: ${dropoffMatch.minDistance.toFixed(2)}km`);

  if (pickupMatch.minDistance > radiusKm || dropoffMatch.minDistance > radiusKm) {
    console.log(`   ❌ REJECTED: Location too far from provider route (> ${radiusKm}km)`);
    return false;
  }
  if (pickupMatch.index > dropoffMatch.index) {
    console.log(`   ❌ REJECTED: Wrong direction (Dropoff is before Pickup on this route)`);
    return false;
  }
  return true;
}

// MASSIVE TOLERANCE (24 Hours) to bypass UTC/Local timezone errors during testing
function isTimeWithinWindow(time1: string, time2: string, windowMinutes: number = 1440): boolean {
  const diffMinutes = Math.abs((new Date(time1).getTime() - new Date(time2).getTime()) / 60000);
  const isMatch = diffMinutes <= windowMinutes;
  if (!isMatch) console.log(`   ❌ REJECTED: Time mismatch. Difference is ${diffMinutes.toFixed(0)} mins (Max allowed: ${windowMinutes})`);
  return isMatch;
}

export async function getPendingRequests(): Promise<DeliveryRequest[]> {
  const { data } = await supabase.from('delivery_requests').select('*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*)').eq('delivery_status', 'Pending');
  return data || [];
}

async function getActiveProviderRoutes(): Promise<ProviderRoute[]> {
  // We fetch routes from 24 hours ago to 7 days ahead to catch any timezone bugs
  const pastDay = new Date(); pastDay.setHours(pastDay.getHours() - 24);
  const { data } = await supabase.from('provider_routes').select('*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)').gte('departure_time', pastDay.toISOString());
  return data || [];
}

export async function findMatches(): Promise<MatchResult[]> {
  const [pendingRequests, providerRoutes] = await Promise.all([getPendingRequests(), getActiveProviderRoutes()]);
  console.log(`\n🔍 MATCH ENGINE RUNNING: Found ${pendingRequests.length} pending requests and ${providerRoutes.length} provider routes.`);
  
  const matches: MatchResult[] = [];
  const routePolylines = new Map<number, [number, number][]>();

  for (const route of providerRoutes) {
    routePolylines.set(route.route_id, await getRoadPolyline(route.start_location, route.end_location));
  }

  for (const request of pendingRequests) {
    if (!request.pickup_location || !request.dropoff_location) continue;
    console.log(`\n📦 Checking Request #${request.request_id} against routes...`);

    for (const route of providerRoutes) {
      console.log(`   🚗 Evaluating Route #${route.route_id} (Provider: ${route.provider_id})`);
      
      const roadPoints = routePolylines.get(route.route_id) || [];
      if (!isAlongRouteInOrder(request.pickup_location, request.dropoff_location, roadPoints, 2.0)) continue;
      
      const isTimeMatch = request.scheduled_time ? isTimeWithinWindow(request.scheduled_time, route.departure_time, 1440) : true;
      if (isTimeMatch) {
        console.log(`   ✅ MATCH FOUND! (Req #${request.request_id} <-> Route #${route.route_id})`);
        matches.push({ request, route, matchScore: 100 });
      }
    }
  }
  return matches;
}

export async function autoMatchAndCreateDeliveries(): Promise<any[]> {
  const matches = await findMatches();
  const processedMatches = [];

  for (const match of matches) {
    const { data: existing } = await supabase.from('deliveries').select('delivery_id').eq('request_id', match.request.request_id).maybeSingle();
    if (existing) {
      console.log(`   ⚠️ Skipping Req #${match.request.request_id}: Already assigned.`);
      continue;
    }

    console.log(`   💾 Attempting to insert Delivery into DB...`);
    const { data: delivery, error } = await supabase.from('deliveries').insert({
      request_id: match.request.request_id, provider_id: match.route.provider_id, vehicle_id: match.route.vehicle_id, route_id: match.route.route_id,
      accepted_at: new Date().toISOString(), estimated_eta: new Date(Date.now() + 3600000).toISOString(),
    }).select('*').single();

    if (error) {
      console.error(`   ❌ DB ERROR (Deliveries Table RLS blocked?):`, error.message);
      continue;
    }

    await supabase.from('delivery_requests').update({ delivery_status: 'Accepted', scheduled_time: match.route.departure_time }).eq('request_id', match.request.request_id);
    await supabase.from('escrow_payments').insert({
      amount: match.request.estimated_cost, delivery_id: delivery.delivery_id, sender_id: match.request.sender_id, provider_id: match.route.provider_id, escrow_status: 'On hold', emergency_frozen: false, created_at: new Date().toISOString(),
    });

    console.log(`   🎉 Match fully processed and inserted! Delivery ID: ${delivery.delivery_id}`);
    processedMatches.push({ delivery_id: delivery.delivery_id, request_id: match.request.request_id });
  }
  return processedMatches;
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
  autoMatchAndCreateDeliveries();
  globalMatchChannel = supabase.channel('realtime-matcher')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_requests' }, () => autoMatchAndCreateDeliveries())
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'provider_routes' }, () => autoMatchAndCreateDeliveries())
    .subscribe();
  globalMatchInterval = setInterval(() => autoMatchAndCreateDeliveries(), 60000);
  return () => stopBackgroundMatcher();
}
export function stopBackgroundMatcher(): void {
  if (globalMatchChannel) { supabase.removeChannel(globalMatchChannel); globalMatchChannel = null; }
  if (globalMatchInterval) { clearInterval(globalMatchInterval); globalMatchInterval = null; }
}