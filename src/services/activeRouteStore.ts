// src/services/activeRouteStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../utils/supabase';

// Flip this one line to turn Demo Mode on (true) or off (false) for the whole app.
export const DEMO_MODE = true;

const KEY = 'packnship.activeRouteId';

let _cachedId: number | null | undefined = undefined; // undefined = not loaded yet
let _lastSyncedId: number | null = null;

const listeners = new Set<(id: number | null) => void>();

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
/* Defense DEMO_MODE: now just reads the DEMO_MODE constant above     */
/* ------------------------------------------------------------------ */
export async function getDemoMode(): Promise<boolean> {
  return DEMO_MODE;
}

// Kept as no-ops so existing imports keep compiling.
export async function setDemoMode(_enabled: boolean): Promise<void> {}

export function subscribeDemoMode(_cb: (demo: boolean) => void): () => void {
  return () => {};
}