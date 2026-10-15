// src/services/backgroundMatcher.ts
import { Alert } from 'react-native';
import { autoMatchAndCreateDeliveries } from './matchingService';
import { getActiveRouteId } from './activeRouteStore';
import { supabase } from '../utils/supabase';

let globalMatchChannel: any = null;

/* ------------------------------------------------------------------ */
/* Start background notifier                                           */
/*                                                                     */
/* This DOES NOT create deliveries. Matching is a proposal: the        */
/* provider must tap Accept in JobsScreen to actually take the job.    */
/*                                                                     */
/* IMPORTANT: the provider is only notified once the sender's escrow   */
/* payment is actually held (payment_status = 'held'). This prevents   */
/* providers from seeing / accepting unpaid requests.                  */
/* ------------------------------------------------------------------ */
export function startBackgroundMatcher() {
  console.log('🚀 Starting background realtime notifier...');

  stopBackgroundMatcher();

  // 1. Boot-time proposal check — read only, just logs
  (async () => {
    const routeId = await getActiveRouteId();
    if (!routeId) return;
    try {
      const proposals = await autoMatchAndCreateDeliveries(routeId);
      console.log(`📊 Initial matching proposed ${proposals.length} requests for route ${routeId}`);
    } catch (err) {
      console.error('❌ Initial match error:', err);
    }
  })();

  // Shared handler for both INSERT and UPDATE events
  const handleIncoming = async (row: any) => {
    // Only notify when the request is still pending
    if (row.delivery_status !== 'Pending') return;

    // ONLY notify once the sender's escrow is actually held
    if (row.payment_status !== 'held') return;

    const routeId = await getActiveRouteId();
    if (!routeId) return;

    try {
      const { data: route } = await supabase
        .from('provider_routes')
        .select('provider_id')
        .eq('route_id', routeId)
        .maybeSingle();
      if (!route) return;

      const { data: user } = await supabase
        .from('users')
        .select('is_active')
        .eq('user_id', route.provider_id)
        .maybeSingle();
      if (!user?.is_active) return;

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

  // 2. Realtime listener — notify the provider of new matching requests
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
        // Only fire when payment_status transitions into 'held'
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