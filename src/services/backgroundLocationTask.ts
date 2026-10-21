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

const isFiniteNum = (n: any): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Returns true iff the OS location service (GPS toggle) is ON.
 * NEVER throws — returns false on any error.
 */
async function servicesOn(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch (e) {
    console.warn('[bg-location] hasServicesEnabledAsync threw:', e);
    return false;
  }
}

// =====================================================================
// Task definition — MUST NEVER REJECT.
// TaskManager on Android converts a rejected task promise into
// "Uncaught in promise id 0" and can kill the JS context.
// =====================================================================
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
    try {
      if (error) {
        console.warn('[bg-location] task error:', (error as any)?.message ?? error);
        return;
      }
      if (!data || !Array.isArray(data.locations) || data.locations.length === 0) {
        return;
      }

      // GPS hardware guard — kills the crash at the source
      if (!(await servicesOn())) {
        console.warn('[bg-location] services OFF, skipping tick');
        return;
      }

      let target: any = null;
      try {
        target = await getBroadcastTarget();
      } catch (e) {
        console.warn('[bg-location] getBroadcastTarget threw:', e);
        return;
      }
      if (!target?.deliveryId || !target?.providerId) return;

      const locations: FixPayload[] = data.locations;
      const last = locations[locations.length - 1];
      if (!last?.coords) return;

      const { latitude, longitude } = last.coords;
      if (!isFiniteNum(latitude) || !isFiniteNum(longitude)) {
        console.warn('[bg-location] non-finite coords, skipping');
        return;
      }

      const payload = {
        delivery_id: target.deliveryId,
        provider_id: target.providerId,
        latitude,
        longitude,
        heading: isFiniteNum(last.coords.heading) ? last.coords.heading : null,
        speed: isFiniteNum(last.coords.speed) ? last.coords.speed : null,
        accuracy: isFiniteNum(last.coords.accuracy) ? last.coords.accuracy : null,
        updated_at: new Date(last.timestamp).toISOString(),
      };

      try {
        const { error: dbErr } = await supabase
          .from('delivery_locations')
          .upsert(payload, { onConflict: 'delivery_id' });
        if (dbErr) console.warn('[bg-location] upsert failed:', dbErr.message);
      } catch (e) {
        console.warn('[bg-location] upsert threw:', e);
      }
    } catch (outer) {
      // Belt-and-suspenders: if anything above slips, swallow so the task never rejects.
      console.warn('[bg-location] unhandled task exception (swallowed):', outer);
    }
  });
}

// =====================================================================
// Start — never throws, returns boolean.
// =====================================================================
export async function startBackgroundLocationUpdates(): Promise<boolean> {
  try {
    if (!(await servicesOn())) {
      console.warn('[bg-location] start skipped: location services OFF');
      return false;
    }

    let fgStatus: string = 'denied';
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      fgStatus = fg.status;
    } catch (e) {
      console.warn('[bg-location] getForegroundPermissionsAsync threw:', e);
      return false;
    }
    if (fgStatus !== 'granted') return false;

    let bgStatus: string = 'denied';
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      bgStatus = bg.status;
    } catch (e) {
      console.warn('[bg-location] requestBackgroundPermissionsAsync threw:', e);
      return false;
    }
    if (bgStatus !== 'granted') {
      console.warn('[bg-location] background permission not granted');
      return false;
    }

    let already = false;
    try {
      already = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch (e) {
      console.warn('[bg-location] hasStartedLocationUpdatesAsync threw:', e);
    }
    if (already) return true;

    try {
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
      // This is the exact throw site of "location services unavailable"
      console.warn('[bg-location] startLocationUpdatesAsync threw:', e);
      return false;
    }
  } catch (outer) {
    console.warn('[bg-location] start() unexpected exception:', outer);
    return false;
  }
}

// =====================================================================
// Stop — never throws.
// =====================================================================
export async function stopBackgroundLocationUpdates(): Promise<void> {
  try {
    let running = false;
    try {
      running = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch (e) {
      console.warn('[bg-location] stop: hasStartedLocationUpdatesAsync threw:', e);
      return;
    }
    if (!running) return;

    try {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch (e) {
      console.warn('[bg-location] stopLocationUpdatesAsync threw:', e);
    }
  } catch (outer) {
    console.warn('[bg-location] stop() unexpected exception:', outer);
  }
}