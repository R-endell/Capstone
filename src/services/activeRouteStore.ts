// src/services/activeRouteStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'packnship.activeRouteId';

let _cachedId: number | null | undefined = undefined; // undefined = not loaded yet
const listeners = new Set<(id: number | null) => void>();

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */
export async function getActiveRouteId(): Promise<number | null> {
  if (_cachedId !== undefined) return _cachedId;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    _cachedId = raw ? Number(raw) : null;
  } catch (err) {
    console.warn('[activeRouteStore] read failed:', err);
    _cachedId = null;
  }
  return _cachedId ?? null;
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */
export async function setActiveRouteId(id: number | null): Promise<void> {
  _cachedId = id;
  try {
    if (id === null) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, String(id));
  } catch (err) {
    console.warn('[activeRouteStore] write failed:', err);
  }
  listeners.forEach(cb => {
    try { cb(id); } catch {}
  });
}

/* ------------------------------------------------------------------ */
/* Subscribe (in-memory only)                                          */
/* ------------------------------------------------------------------ */
export function subscribeActiveRoute(cb: (id: number | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}