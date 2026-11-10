// src/services/activeRouteStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../utils/supabase';

const KEY = 'packnship.activeRouteId';
const DEMO_KEY = 'packnship.demoMode';

let _cachedId: number | null | undefined = undefined; // undefined = not loaded yet
let _cachedDemo: boolean | undefined = undefined;

let _lastSyncedId: number | null = null;

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

/**
 * Mirrors the provider's selected route into `provider_routes.is_selected` so
 * OTHER users' devices (e.g. the sender's Explore screen) only see the one
 * route the provider has selected. Exactly one route per provider is selected.
 * Pass `force` to re-sync even if this id was already synced in this session.
 */
export async function syncSelectedRouteToDb(id: number | null, force = false): Promise<void> {
  if (id === null) return;
  if (!force && _lastSyncedId === id) return;
  try {
    const { data: row, error: rowErr } = await supabase
      .from('provider_routes')
      .select('provider_id')
      .eq('route_id', id)
      .maybeSingle();
    if (rowErr || !row) return;

    await supabase
      .from('provider_routes')
      .update({ is_selected: false })
      .eq('provider_id', row.provider_id)
      .neq('route_id', id)
      .eq('is_selected', true);

    const { error } = await supabase
      .from('provider_routes')
      .update({ is_selected: true })
      .eq('route_id', id);

    if (error) console.warn('[activeRouteStore] is_selected sync failed:', error.message);
    else _lastSyncedId = id;
  } catch (err) {
    console.warn('[activeRouteStore] is_selected sync error:', err);
  }
}

export async function setActiveRouteId(id: number | null): Promise<void> {
  _cachedId = id;
  try {
    if (id === null) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, String(id));
  } catch (err) {
    console.warn('[activeRouteStore] write failed:', err);
  }
  if (id === null) _lastSyncedId = null;
  listeners.forEach(cb => {
    try { cb(id); } catch {}
  });
  // Fire-and-forget so the UI never waits on the network.
  void syncSelectedRouteToDb(id);
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