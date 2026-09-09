// src/services/backgroundMatcher.ts
import { autoMatchAndCreateDeliveries, subscribeToNewRequests } from './matchingService';
import { supabase } from '../utils/supabase';

let matcherInterval: NodeJS.Timeout | null = null;
let subscription: any = null;

// Start background matching service
export function startBackgroundMatcher() {
  console.log('🚀 Starting background matcher...');
  
  // Run initial match
  autoMatchAndCreateDeliveries().then(matches => {
    console.log(`📊 Initial matching found ${matches.length} matches`);
  });

  // Set up interval to run every 30 seconds
  matcherInterval = setInterval(async () => {
    try {
      const matches = await autoMatchAndCreateDeliveries();
      if (matches.length > 0) {
        console.log(`🎯 Background matcher found ${matches.length} new matches`);
        // Send notification (you can implement push notifications here)
      }
    } catch (error) {
      console.error('❌ Background matcher error:', error);
    }
  }, 30000);

  // Subscribe to new requests
  subscription = subscribeToNewRequests(async (payload) => {
    console.log('📦 New request detected, running matching...');
    const matches = await autoMatchAndCreateDeliveries();
    if (matches.length > 0) {
      console.log(`🎯 Matched ${matches.length} requests instantly`);
    }
  });

  return () => {
    if (matcherInterval) {
      clearInterval(matcherInterval);
      matcherInterval = null;
    }
    if (subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  };
}

// Stop background matcher
export function stopBackgroundMatcher() {
  if (matcherInterval) {
    clearInterval(matcherInterval);
    matcherInterval = null;
  }
  if (subscription) {
    subscription.unsubscribe();
    subscription = null;
  }
  console.log('🛑 Background matcher stopped');
}

// Check if a provider is online and available
export async function updateProviderStatus(providerId: number, isOnline: boolean) {
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
}

// Get matching statistics
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
      matchRate: deliveries?.length && pending?.length 
        ? (deliveries.length / (deliveries.length + pending.length) * 100).toFixed(1)
        : '0'
    };
  } catch (error) {
    console.error('Error getting matching stats:', error);
    return null;
  }
}