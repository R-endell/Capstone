// src/services/backgroundMatcher.ts
import {
  autoMatchAndCreateDeliveries,
  subscribeToNewRequests,
  subscribeToProviderRoutes,
} from './matchingService';
import { getActiveRouteId } from './activeRouteStore';
import { supabase } from '../utils/supabase';

let matcherInterval: NodeJS.Timeout | null = null;
let requestSubscription: any = null;
let routeSubscription: any = null;

/* ------------------------------------------------------------------ */
/* Start background matching service                                   */
/* ------------------------------------------------------------------ */
export function startBackgroundMatcher() {
  console.log('🚀 Starting background matcher...');

  // Initial match — only if a route is selected
  (async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) {
      console.log('⏸️  No active route selected — skipping initial match');
      return;
    }
    try {
      const matches = await autoMatchAndCreateDeliveries(routeId);
      console.log(`📊 Initial matching found ${matches.length} matches for route ${routeId}`);
    } catch (err) {
      console.error('❌ Initial match error:', err);
    }
  })();

  // Interval: re-check every 30s against the current route
  matcherInterval = setInterval(async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    try {
      const matches = await autoMatchAndCreateDeliveries(routeId);
      if (matches.length > 0) {
        console.log(`🎯 Background matcher found ${matches.length} new matches on route ${routeId}`);
      }
    } catch (error) {
      console.error('❌ Background matcher error:', error);
    }
  }, 30000);

  // New requests → re-run matching for the current route
  requestSubscription = subscribeToNewRequests(async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    console.log('📦 New request detected, running matching...');
    try {
      const matches = await autoMatchAndCreateDeliveries(routeId);
      if (matches.length > 0) {
        console.log(`🎯 Matched ${matches.length} requests instantly`);
      }
    } catch (err) {
      console.error('❌ Instant match error:', err);
    }
  });

  // Route changes → re-run matching for the current route
  routeSubscription = subscribeToProviderRoutes(null, async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    try {
      const matches = await autoMatchAndCreateDeliveries(routeId);
      console.log(`♻️  Re-checked matches after route update: ${matches.length}`);
    } catch (err) {
      console.error('❌ Route-refresh match error:', err);
    }
  });

  return () => stopBackgroundMatcher();
}

/* ------------------------------------------------------------------ */
/* Stop background matcher                                             */
/* ------------------------------------------------------------------ */
export function stopBackgroundMatcher() {
  if (matcherInterval) {
    clearInterval(matcherInterval);
    matcherInterval = null;
  }
  if (requestSubscription) {
    try { requestSubscription.unsubscribe?.(); } catch {}
    requestSubscription = null;
  }
  if (routeSubscription) {
    try { routeSubscription.unsubscribe?.(); } catch {}
    routeSubscription = null;
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