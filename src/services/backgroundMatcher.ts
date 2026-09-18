// src/services/backgroundMatcher.ts
import { Alert } from 'react-native';
import { autoMatchAndCreateDeliveries, findMatches } from './matchingService';
import { getActiveRouteId } from './activeRouteStore';
import { supabase } from '../utils/supabase';

let globalMatchChannel: any = null;

/* ------------------------------------------------------------------ */
/* Start background matching service & Global Notifications            */
/* ------------------------------------------------------------------ */
export function startBackgroundMatcher() {
  console.log('🚀 Starting background realtime matcher...');

  // 1. Initial boot match check
  (async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    try {
      const matches = await autoMatchAndCreateDeliveries(routeId);
      console.log(`📊 Initial matching found ${matches.length} matches for route ${routeId}`);
    } catch (err) {
      console.error('❌ Initial match error:', err);
    }
  })();

  // 2. Global Realtime Listener for Instant Provider Notifications
  globalMatchChannel = supabase
    .channel('realtime-global-matcher')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'delivery_requests' },
      async (payload) => {
        // Only trigger on brand new pending requests
        if (payload.new.delivery_status !== 'Pending') return;

        const routeId = await getActiveRouteId();
        if (!routeId) return;

        try {
          // Verify provider is actually Online before sending a push notification
          const { data: route } = await supabase.from('provider_routes').select('provider_id').eq('route_id', routeId).single();
          if (route) {
             const { data: user } = await supabase.from('users').select('is_active').eq('user_id', route.provider_id).single();
             if (!user?.is_active) return; // Silently ignore if offline
          }

          // Check if this newly inserted request matches the provider's active route
          const matches = await findMatches(routeId);
          const isMatch = matches.some(m => m.request.request_id === payload.new.request_id);

          if (isMatch) {
            // Global cross-screen notification pops up instantly
            Alert.alert(
              '🎯 New Delivery Match!',
              `A new sender request perfectly matches your route. Open the Jobs or Task tab to accept it.`,
              [{ text: 'Got it', style: 'default' }]
            );
          }
        } catch (err) {
          console.error('❌ Global match check error:', err);
        }
      },
    )
    .subscribe();

  return () => stopBackgroundMatcher();
}

/* ------------------------------------------------------------------ */
/* Stop background matcher                                             */
/* ------------------------------------------------------------------ */
export function stopBackgroundMatcher() {
  if (globalMatchChannel) {
    supabase.removeChannel(globalMatchChannel);
    globalMatchChannel = null;
  }
  console.log('🛑 Background matcher stopped');
}

/* ------------------------------------------------------------------ */
/* Provider online status                                              */
/* ------------------------------------------------------------------ */
export async function updateProviderStatus(providerId: number, isOnline: boolean) {
  const { error } = await supabase
    .from('users')
    .update({ is_active: isOnline })
    .eq('user_id', providerId);

  if (error) {
    console.error('❌ Error updating provider status:', error);
  } else {
    console.log(`✅ Provider ${providerId} is now ${isOnline ? 'online' : 'offline'}`);
  }
}

/* ------------------------------------------------------------------ */
/* Matching statistics                                                 */
/* ------------------------------------------------------------------ */
export async function getMatchingStats(providerId: number) {
  try {
    const { data: deliveries } = await supabase
      .from('deliveries')
      .select('*')
      .eq('provider_id', providerId);

    const { data: pending } = await supabase
      .from('delivery_requests')
      .select('*')
      .eq('delivery_status', 'Pending');

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