// src/services/locationBroadcastStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'packnship.locationBroadcast';

export type BroadcastTarget = {
  deliveryId: number;
  providerId: number;
  startedAt: string;
};

let cached: BroadcastTarget | null | undefined = undefined;

export async function getBroadcastTarget(): Promise<BroadcastTarget | null> {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as BroadcastTarget) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function setBroadcastTarget(t: BroadcastTarget | null): Promise<void> {
  cached = t;
  try {
    if (t) await AsyncStorage.setItem(KEY, JSON.stringify(t));
    else await AsyncStorage.removeItem(KEY);
  } catch (e) {
    console.warn('[locationBroadcastStore] write failed:', e);
  }
}