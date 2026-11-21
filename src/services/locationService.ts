// src/services/locationService.ts
import * as Location from 'expo-location';
import { supabase } from '../utils/supabase';

export type ProviderFix = {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  updated_at: string;
};

const isFiniteNum = (n: any): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Single source of truth for "is the OS GPS toggle on?".
 * Never throws.
 */
export async function isLocationServicesEnabled(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch (e) {
    console.warn('[location] hasServicesEnabledAsync threw:', e);
    return false;
  }
}

/**
 * Requests foreground location permission.
 * Returns false when: permission denied, GPS off, or native bridge throws.
 * Never rejects.
 */
export async function requestForegroundLocationPermission(): Promise<boolean> {
  try {
    if (!(await isLocationServicesEnabled())) {
      console.warn('[location] foreground perm: services OFF');
      return false;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[location] requestForegroundPermissionsAsync threw:', e);
    return false;
  }
}

/**
 * Upsert a location fix. NEVER rejects — logs and returns.
 * Callers can safely fire-and-forget, but you should still `.catch()` at
 * call sites as defense-in-depth.
 */
export async function pushLocationFix(
  deliveryId: number,
  providerId: number,
  fix: ProviderFix,
): Promise<void> {
  try {
    if (!deliveryId || !providerId) return;
    if (!isFiniteNum(fix?.latitude) || !isFiniteNum(fix?.longitude)) {
      console.warn('[location] push skipped: non-finite coords');
      return;
    }

    const { error } = await supabase
      .from('delivery_locations')
      .upsert(
        {
          delivery_id: deliveryId,
          provider_id: providerId,
          latitude: fix.latitude,
          longitude: fix.longitude,
          heading: isFiniteNum(fix.heading) ? fix.heading : null,
          speed: isFiniteNum(fix.speed) ? fix.speed : null,
          accuracy: isFiniteNum(fix.accuracy) ? fix.accuracy : null,
          updated_at: fix.updated_at || new Date().toISOString(),
        },
        { onConflict: 'delivery_id' },
      );
    if (error) console.warn('[location] push failed:', error.message);
  } catch (e) {
    console.warn('[location] push threw:', e);
  }
}

/**
 * Fetch the last stored fix for a delivery.
 * Returns null on any error. Never rejects.
 */
export async function fetchLatestFix(deliveryId: number): Promise<ProviderFix | null> {
  try {
    if (!deliveryId) return null;
    const { data, error } = await supabase
      .from('delivery_locations')
      .select('latitude, longitude, heading, speed, accuracy, updated_at')
      .eq('delivery_id', deliveryId)
      .maybeSingle();
    if (error) {
      console.warn('[location] fetchLatestFix error:', error.message);
      return null;
    }
    return (data as ProviderFix) || null;
  } catch (e) {
    console.warn('[location] fetchLatestFix threw:', e);
    return null;
  }
}

/**
 * Remove the stored fix for a delivery. Never rejects.
 * Also stops the background task if it's the one we're still broadcasting for.
 */
export async function clearLocationFix(deliveryId: number): Promise<void> {
  try {
    if (!deliveryId) return;
    const { error } = await supabase
      .from('delivery_locations')
      .delete()
      .eq('delivery_id', deliveryId);
    if (error) console.warn('[location] clearLocationFix error:', error.message);
  } catch (e) {
    console.warn('[location] clearLocationFix threw:', e);
  }
}

/**
 * Upsert the provider's latest online GPS fix into `provider_live_locations`
 * for mid-trip Ahead-of-Driver Send-Now matching. Never rejects.
 */
export async function pushProviderLiveLocation(
  providerId: number,
  routeId: number | null | undefined,
  fix: ProviderFix,
): Promise<void> {
  try {
    if (!providerId) return;
    if (!isFiniteNum(fix?.latitude) || !isFiniteNum(fix?.longitude)) return;

    const payload: Record<string, any> = {
      provider_id: providerId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      heading: isFiniteNum(fix.heading) ? fix.heading : null,
      speed: isFiniteNum(fix.speed) ? fix.speed : null,
      accuracy: isFiniteNum(fix.accuracy) ? fix.accuracy : null,
      updated_at: fix.updated_at || new Date().toISOString(),
    };
    if (routeId !== undefined) {
      payload.route_id = routeId;
    }

    const { error } = await supabase
      .from('provider_live_locations')
      .upsert(payload, { onConflict: 'provider_id' });
    if (error) console.warn('[location] pushProviderLiveLocation failed:', error.message);
  } catch (e) {
    console.warn('[location] pushProviderLiveLocation threw:', e);
  }
}

/**
 * Fetch the latest live GPS fix for a provider. Never rejects.
 */
export async function fetchProviderLiveLocation(
  providerId: number,
): Promise<(ProviderFix & { provider_id: number; route_id: number | null }) | null> {
  try {
    if (!providerId) return null;
    const { data, error } = await supabase
      .from('provider_live_locations')
      .select('provider_id, route_id, latitude, longitude, heading, speed, accuracy, updated_at')
      .eq('provider_id', providerId)
      .maybeSingle();
    if (error) {
      console.warn('[location] fetchProviderLiveLocation error:', error.message);
      return null;
    }
    return (data as any) || null;
  } catch (e) {
    console.warn('[location] fetchProviderLiveLocation threw:', e);
    return null;
  }
}

/**
 * Remove the provider's live GPS row (called when going offline). Never rejects.
 */
export async function clearProviderLiveLocation(providerId: number): Promise<void> {
  try {
    if (!providerId) return;
    const { error } = await supabase
      .from('provider_live_locations')
      .delete()
      .eq('provider_id', providerId);
    if (error) console.warn('[location] clearProviderLiveLocation error:', error.message);
  } catch (e) {
    console.warn('[location] clearProviderLiveLocation threw:', e);
  }
}