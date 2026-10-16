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

export async function requestForegroundLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

export async function pushLocationFix(
  deliveryId: number,
  providerId: number,
  fix: ProviderFix,
): Promise<void> {
  const { error } = await supabase
    .from('delivery_locations')
    .upsert(
      {
        delivery_id: deliveryId,
        provider_id: providerId,
        latitude: fix.latitude,
        longitude: fix.longitude,
        heading: fix.heading,
        speed: fix.speed,
        accuracy: fix.accuracy,
        updated_at: fix.updated_at,
      },
      { onConflict: 'delivery_id' },
    );
  if (error) console.warn('[location] push failed:', error.message);
}

export async function fetchLatestFix(deliveryId: number): Promise<ProviderFix | null> {
  const { data } = await supabase
    .from('delivery_locations')
    .select('latitude, longitude, heading, speed, accuracy, updated_at')
    .eq('delivery_id', deliveryId)
    .maybeSingle();
  return (data as ProviderFix) || null;
}

export async function clearLocationFix(deliveryId: number): Promise<void> {
  await supabase.from('delivery_locations').delete().eq('delivery_id', deliveryId);
}