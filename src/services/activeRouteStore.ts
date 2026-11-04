// src/services/activeRouteStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'packnship.activeRouteId';
const DEMO_KEY = 'packnship.demoMode';

let _cachedId: number | null | undefined = undefined; // undefined = not loaded yet
let _cachedDemo: boolean | undefined = undefined;

const listeners = new Set<(id: number | null) => void>();
const demoListeners = new Set<(demo: boolean) => void>();

/* ------------------------------------------------------------------ */
/* Active Route ID Read / Write / Subscribe                           */
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

export function subscribeActiveRoute(cb: (id: number | null) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/* ------------------------------------------------------------------ */
/* Defense DEMO_MODE Read / Write / Subscribe                         */
/* ------------------------------------------------------------------ */
export async function getDemoMode(): Promise<boolean> {
  if (_cachedDemo !== undefined) return _cachedDemo;
  try {
    const raw = await AsyncStorage.getItem(DEMO_KEY);
    _cachedDemo = raw === 'true';
  } catch (err) {
    console.warn('[activeRouteStore] demoMode read failed:', err);
    _cachedDemo = false;
  }
  return _cachedDemo;
}

export async function setDemoMode(enabled: boolean): Promise<void> {
  _cachedDemo = enabled;
  try {
    await AsyncStorage.setItem(DEMO_KEY, enabled ? 'true' : 'false');
  } catch (err) {
    console.warn('[activeRouteStore] demoMode write failed:', err);
  }
  demoListeners.forEach(cb => {
    try { cb(enabled); } catch {}
  });
}

export function subscribeDemoMode(cb: (demo: boolean) => void): () => void {
  demoListeners.add(cb);
  return () => { demoListeners.delete(cb); };
}