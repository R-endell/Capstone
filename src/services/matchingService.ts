// src/services/matchingService.ts
import { supabase } from '../utils/supabase';

// ============ TYPES ============
interface Location {
  latitude: number;
  longitude: number;
  location_id?: number;
  street_address?: string;
  barangay?: string;
  city?: string;
  province?: string;
  zip_code?: string;
}

interface ProviderRoute {
  route_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location_id: number;
  end_location_id: number;
  departure_time: string;
  route_frequency: string;
  created_at: string;
  start_location: Location;
  end_location: Location;
  vehicle?: any;
}

interface DeliveryRequest {
  request_id: number;
  pickup_type: string;
  scheduled_time: string | null;
  receiver_phone: string;
  total_distance: number;
  estimated_cost: number;
  delivery_status: string;
  emergency_flag: boolean;
  created_at: string;
  sender_id: number;
  cargo_id: number;
  receiver_id: number | null;
  pickup_location_id: number;
  dropoff_location_id: number;
  rate_id: number;
  pickup_location: Location;
  dropoff_location: Location;
  cargo?: any;
  receiver?: any;
}

interface MatchResult {
  request: DeliveryRequest;
  route: ProviderRoute;
  matchScore: number;
}

// ============ HELPER FUNCTIONS ============

// Haversine formula to calculate distance between two coordinates
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Check if a point is within a certain radius of a route path
function isPointNearRoute(
  point: Location,
  start: Location,
  end: Location,
  radiusKm: number = 2
): boolean {
  // Check if point is near start or end
  const distToStart = calculateDistance(point.latitude, point.longitude, start.latitude, start.longitude);
  const distToEnd = calculateDistance(point.latitude, point.longitude, end.latitude, end.longitude);
  
  if (distToStart <= radiusKm || distToEnd <= radiusKm) {
    return true;
  }
  
  // Check if point is near the path between start and end
  const dx = end.latitude - start.latitude;
  const dy = end.longitude - start.longitude;
  const lineLength = Math.sqrt(dx*dx + dy*dy);
  
  if (lineLength === 0) return false;
  
  const t = Math.max(0, Math.min(1, 
    ((point.latitude - start.latitude) * dx + (point.longitude - start.longitude) * dy) / (lineLength * lineLength)
  ));
  
  const projX = start.latitude + t * dx;
  const projY = start.longitude + t * dy;
  
  const distToLine = calculateDistance(point.latitude, point.longitude, projX, projY);
  
  return distToLine <= radiusKm;
}

// Check if two times are within a certain window
function isTimeWithinWindow(time1: string, time2: string, windowMinutes: number = 30): boolean {
  const date1 = new Date(time1);
  const date2 = new Date(time2);
  const diffMinutes = Math.abs((date1.getTime() - date2.getTime()) / 60000);
  return diffMinutes <= windowMinutes;
}

// ============ DATABASE FUNCTIONS ============

// Get all pending delivery requests
async function getPendingRequests(): Promise<DeliveryRequest[]> {
  try {
    const { data, error } = await supabase
      .from('delivery_requests')
      .select(`
        *,
        pickup_location:locations!delivery_requests_pickup_location_id_fkey(*),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*),
        cargo:cargo_profiles(*),
        receiver:receivers(*)
      `)
      .eq('delivery_status', 'Pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching pending requests:', error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error('Error in getPendingRequests:', error);
    return [];
  }
}

// Get all active provider routes
async function getActiveProviderRoutes(): Promise<ProviderRoute[]> {
  try {
    const now = new Date();
    const oneWeekFromNow = new Date(now);
    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);

    const { data, error } = await supabase
      .from('provider_routes')
      .select(`
        *,
        start_location:locations!provider_routes_start_location_id_fkey(*),
        end_location:locations!provider_routes_end_location_id_fkey(*),
        vehicle:vehicles(*)
      `)
      .gte('departure_time', now.toISOString())
      .lte('departure_time', oneWeekFromNow.toISOString())
      .order('departure_time', { ascending: true });

    if (error) {
      console.error('Error fetching provider routes:', error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error('Error in getActiveProviderRoutes:', error);
    return [];
  }
}

// Calculate match score for prioritizing matches
function calculateMatchScore(request: DeliveryRequest, route: ProviderRoute): number {
  let score = 0;

  // Score based on distance proximity (closer is better)
  const distToStart = calculateDistance(
    request.pickup_location.latitude,
    request.pickup_location.longitude,
    route.start_location.latitude,
    route.start_location.longitude
  );
  const distToEnd = calculateDistance(
    request.dropoff_location.latitude,
    request.dropoff_location.longitude,
    route.end_location.latitude,
    route.end_location.longitude
  );
  
  // Lower distance = higher score
  score += Math.max(0, 10 - distToStart) * 2;
  score += Math.max(0, 10 - distToEnd) * 2;

  // Score based on time proximity
  if (request.scheduled_time) {
    const timeMatch = isTimeWithinWindow(request.scheduled_time, route.departure_time, 15);
    if (timeMatch) score += 5;
  }

  // Score based on emergency flag
  score += request.emergency_flag ? 10 : 0;

  return score;
}

// ============ EXPORTED FUNCTIONS ============

// Find matches between providers and pending requests
export async function findMatches(): Promise<MatchResult[]> {
  try {
    const [pendingRequests, providerRoutes] = await Promise.all([
      getPendingRequests(),
      getActiveProviderRoutes()
    ]);

    const matches: MatchResult[] = [];

    for (const request of pendingRequests) {
      for (const route of providerRoutes) {
        // Skip if provider already has too many active deliveries
        const { data: activeDeliveries } = await supabase
          .from('deliveries')
          .select('delivery_id')
          .eq('provider_id', route.provider_id)
          .is('completed_at', null);

        if (activeDeliveries && activeDeliveries.length >= 3) {
          continue;
        }

        // Check if pickup location is near the route path
        const isPickupNearRoute = isPointNearRoute(
          request.pickup_location,
          route.start_location,
          route.end_location
        );

        // Check if dropoff location is near the route path
        const isDropoffNearRoute = isPointNearRoute(
          request.dropoff_location,
          route.start_location,
          route.end_location
        );

        // Check if scheduled time matches (within 30 minutes window)
        const isTimeMatch = request.scheduled_time 
          ? isTimeWithinWindow(request.scheduled_time, route.departure_time, 30)
          : true; // If no scheduled time, it's a "Send Now" request

        // If request matches the route path and time
        if (isPickupNearRoute && isDropoffNearRoute && isTimeMatch) {
          matches.push({
            request,
            route,
            matchScore: calculateMatchScore(request, route)
          });
        }
      }
    }

    // Sort matches by score (higher is better)
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches;
  } catch (error) {
    console.error('Error finding matches:', error);
    return [];
  }
}

// Auto-match and create deliveries
export async function autoMatchAndCreateDeliveries(): Promise<any[]> {
  try {
    const matches = await findMatches();
    const processedMatches = [];
    
    for (const match of matches) {
      // Check if request already has a delivery
      const { data: existingDelivery } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .eq('request_id', match.request.request_id)
        .maybeSingle();

      if (existingDelivery) {
        continue; // Skip if already matched
      }

      // Check if provider is available
      const { data: providerDeliveries } = await supabase
        .from('deliveries')
        .select('*')
        .eq('provider_id', match.route.provider_id)
        .is('completed_at', null);

      if (providerDeliveries && providerDeliveries.length >= 3) {
        continue;
      }

      // Create delivery
      const { data: delivery, error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          request_id: match.request.request_id,
          provider_id: match.route.provider_id,
          vehicle_id: match.route.vehicle_id,
          route_id: match.route.route_id,
          accepted_at: new Date().toISOString(),
          estimated_eta: new Date(Date.now() + 3600000).toISOString()
        })
        .select('*')
        .single();

      if (deliveryError) {
        console.error('Error creating delivery:', deliveryError);
        continue;
      }

      // Update delivery request status
      await supabase
        .from('delivery_requests')
        .update({ 
          delivery_status: 'Accepted',
          scheduled_time: match.route.departure_time
        })
        .eq('request_id', match.request.request_id);

      // Create escrow payment
      await supabase
        .from('escrow_payments')
        .insert({
          amount: match.request.estimated_cost,
          delivery_id: delivery.delivery_id,
          sender_id: match.request.sender_id,
          provider_id: match.route.provider_id,
          escrow_status: 'On hold',
          emergency_frozen: false,
          created_at: new Date().toISOString()
        });

      processedMatches.push({
        delivery_id: delivery.delivery_id,
        request_id: match.request.request_id,
        provider_id: match.route.provider_id,
        route_id: match.route.route_id
      });
    }

    return processedMatches;
  } catch (error) {
    console.error('Error in autoMatchAndCreateDeliveries:', error);
    return [];
  }
}

// Get deliveries for a specific provider
export async function getProviderDeliveries(providerId: number) {
  try {
    const { data, error } = await supabase
      .from('deliveries')
      .select(`
        *,
        delivery_requests:request_id(
          *,
          pickup_location:pickup_location_id(*),
          dropoff_location:dropoff_location_id(*),
          cargo:cargo_id(*),
          receiver:receiver_id(*)
        )
      `)
      .eq('provider_id', providerId)
      .order('accepted_at', { ascending: false });

    if (error) {
      console.error('Error fetching provider deliveries:', error);
      return [];
    }
    return data || [];
  } catch (error) {
    console.error('Error in getProviderDeliveries:', error);
    return [];
  }
}

// ============ SUBSCRIPTION FUNCTIONS (FIXED) ============

// Create a channel with callbacks properly configured
function createChannel(channelName: string, filter: string, callback: (payload: any) => void) {
  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'delivery_requests',
        filter: filter
      },
      callback
    )
    .subscribe((status) => {
      console.log(`📡 Channel ${channelName} status: ${status}`);
    });
}

// Subscribe to new pending requests for real-time matching
export function subscribeToNewRequests(
  callback: (payload: any) => void
) {
  const channelName = `delivery-requests-${Date.now()}`;
  return createChannel(
    channelName,
    `delivery_status=eq.Pending`,
    callback
  );
}

// Subscribe to provider route updates
export function subscribeToProviderRoutes(
  providerId: number,
  callback: (payload: any) => void
) {
  const channelName = `provider-routes-${providerId}-${Date.now()}`;
  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'provider_routes',
        filter: `provider_id=eq.${providerId}`
      },
      callback
    )
    .subscribe((status) => {
      console.log(`📡 Channel ${channelName} status: ${status}`);
    });
}

// Subscribe to delivery status changes for a specific provider
export function subscribeToDeliveryUpdates(
  providerId: number,
  callback: (payload: any) => void
) {
  const channelName = `deliveries-${providerId}-${Date.now()}`;
  return supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deliveries',
        filter: `provider_id=eq.${providerId}`
      },
      callback
    )
    .subscribe((status) => {
      console.log(`📡 Channel ${channelName} status: ${status}`);
    });
}

// ============ BACKGROUND MATCHER ============

let matcherInterval: NodeJS.Timeout | null = null;
let subscriptions: any[] = [];

// Start background matching service
export function startBackgroundMatcher(): () => void {
  console.log('🚀 Starting background matcher...');
  
  // Clear any existing subscriptions
  stopBackgroundMatcher();

  // Run initial match
  autoMatchAndCreateDeliveries().then(matches => {
    console.log(`📊 Initial matching found ${matches.length} matches`);
  }).catch(error => {
    console.error('❌ Initial matching error:', error);
  });

  // Set up interval to run every 30 seconds
  matcherInterval = setInterval(async () => {
    try {
      const matches = await autoMatchAndCreateDeliveries();
      if (matches.length > 0) {
        console.log(`🎯 Background matcher found ${matches.length} new matches`);
      }
    } catch (error) {
      console.error('❌ Background matcher error:', error);
    }
  }, 30000);

  // Subscribe to new requests with proper channel creation
  const newRequestSub = subscribeToNewRequests(async (payload) => {
    console.log('📦 New request detected, running matching...');
    try {
      const matches = await autoMatchAndCreateDeliveries();
      if (matches.length > 0) {
        console.log(`🎯 Matched ${matches.length} requests instantly`);
      }
    } catch (error) {
      console.error('❌ Error processing new request:', error);
    }
  });
  
  subscriptions.push(newRequestSub);

  // Return cleanup function
  return () => {
    console.log('🛑 Cleaning up background matcher...');
    stopBackgroundMatcher();
  };
}

// Stop background matcher
export function stopBackgroundMatcher(): void {
  if (matcherInterval) {
    clearInterval(matcherInterval);
    matcherInterval = null;
  }
  
  // Unsubscribe all subscriptions
  subscriptions.forEach(sub => {
    try {
      if (sub && typeof sub.unsubscribe === 'function') {
        sub.unsubscribe();
      }
    } catch (error) {
      console.error('Error unsubscribing:', error);
    }
  });
  subscriptions = [];
  
  console.log('🛑 Background matcher stopped');
}

// Check if a provider is online and available
export async function updateProviderStatus(providerId: number, isOnline: boolean) {
  try {
    const { error } = await supabase
      .from('users')
      .update({ 
        is_active: isOnline 
      })
      .eq('user_id', providerId);

    if (error) {
      console.error('❌ Error updating provider status:', error);
    } else {
      console.log(`✅ Provider ${providerId} is now ${isOnline ? 'online' : 'offline'}`);
    }
  } catch (error) {
    console.error('Error in updateProviderStatus:', error);
  }
}

console.log('✅ Matching service loaded successfully!');