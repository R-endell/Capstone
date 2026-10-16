// src/services/backgroundLocationTask.ts
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { supabase } from '../utils/supabase';
import { getBroadcastTarget } from './locationBroadcastStore';

export const BACKGROUND_LOCATION_TASK = 'packnship-background-location';

type FixPayload = {
  coords: {
    latitude: number;
    longitude: number;
    heading: number | null;
    speed: number | null;
    accuracy: number | null;
  };
  timestamp: number;
};

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
    if (error) {
      console.warn('[bg-location] task error:', error.message);
      return;
    }
    const locations: FixPayload[] = data?.locations ?? [];
    if (locations.length === 0) return;

    const target = await getBroadcastTarget();
    if (!target) return;

    // Push the most recent fix
    const last = locations[locations.length - 1];
    const { error: dbErr } = await supabase
      .from('delivery_locations')
      .upsert(
        {
          delivery_id: target.deliveryId,
          provider_id: target.providerId,
          latitude: last.coords.latitude,
          longitude: last.coords.longitude,
          heading: Number.isFinite(last.coords.heading as any) ? last.coords.heading : null,
          speed: Number.isFinite(last.coords.speed as any) ? last.coords.speed : null,
          accuracy: Number.isFinite(last.coords.accuracy as any) ? last.coords.accuracy : null,
          updated_at: new Date(last.timestamp).toISOString(),
        },
        { onConflict: 'delivery_id' },
      );
    if (dbErr) console.warn('[bg-location] upsert failed:', dbErr.message);
  });
}

/**
 * Start background location updates. Requires foreground permission first.
 * Safe to call repeatedly — checks if already running.
 */
export async function startBackgroundLocationUpdates(): Promise<boolean> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return false;

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') {
      console.warn('[bg-location] background permission not granted');
      return false;
    }

    const already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (already) return true;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15_000,
      distanceInterval: 20,
      deferredUpdatesInterval: 15_000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Pack-N-Ship is sharing your location',
        notificationBody: 'The sender can see your delivery progress.',
        notificationColor: '#FF751F',
      },
    });
    return true;
  } catch (e) {
    console.warn('[bg-location] start failed:', e);
    return false;
  }
}

export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    const running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    if (running) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch (e) {
    console.warn('[bg-location] stop failed:', e);
  }
}