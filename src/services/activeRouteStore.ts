// src/services/activeRouteStore.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../utils/supabase';

// Flip this one line to turn Demo Mode on (true) or off (false) for the whole app.
export const DEMO_MODE = true;

const KEY = 'packnship.activeRouteId';

let _cachedId: number | null | undefined = undefined; // undefined = not loaded yet
let _lastSyncedId: number | null = null;

// All is_selected writes run through this chain, one at a time, in call order.
// Without it two quick switches (A -> B -> C) interleave their "unselect others / select me"
// updates and the DB can end up with the wrong route selected (or two at once).
let _syncChain: Promise<void> = Promise.resolve();

const listeners = new Set<(id: number | null) => void>();

/* ------------------------------------------------------------------ */
/* Active Route ID Read / Write / Subscribe                           */
/* ------------------------------------------------------------------ */
export async function getActiveRouteId(): Promise<number | null> {
  if (_cachedId !== undefined) return _cachedId;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    // A switch may have happened while we were reading storage: the cache wins.
    if (_cachedId === undefined) _cachedId = raw ? Number(raw) : null;
  } catch (err) {
    console.warn('[activeRouteStore] read failed:', err);
    if (_cachedId === undefined) _cachedId = null;
  }
  return _cachedId ?? null;
}

async function doSync(id: number, force: boolean): Promise<void> {
  // A newer selection already replaced this one: skip, the newer sync will do the work.
  if (_cachedId !== undefined && _cachedId !== id) return;
  if (!force && _lastSyncedId === id) return;
  try {
    const { data: row, error: rowErr } = await supabase
      .from('provider_routes')
      .select('provider_id')
      .eq('route_id', id)
      .maybeSingle();
    if (rowErr || !row) return;

    // Select the new route FIRST, then unselect the others, so a provider never has zero
    // selected routes (senders' Explore list would otherwise flicker the provider away).
    const { error } = await supabase
      .from('provider_routes')
      .update({ is_selected: true })
      .eq('route_id', id);
    if (error) {
      console.warn('[activeRouteStore] is_selected sync failed:', error.message);
      return; // _lastSyncedId stays unchanged so the next call retries
    }

    const { error: othersErr } = await supabase
      .from('provider_routes')
      .update({ is_selected: false })
      .eq('provider_id', row.provider_id)
      .neq('route_id', id)
      .eq('is_selected', true);
    if (othersErr) {
      console.warn('[activeRouteStore] unselect others failed:', othersErr.message);
      return;
    }

    _lastSyncedId = id;
  } catch (err) {
    console.warn('[activeRouteStore] is_selected sync error:', err);
  }
}

/**
 * Mirrors the provider's selected route into `provider_routes.is_selected` so
 * OTHER users' devices (e.g. the sender's Explore screen) only see the one
 * route the provider has selected. Exactly one route per provider is selected.
 * Pass `force` to re-sync even if this id was already synced in this session.
 * Calls are serialized; the returned promise resolves when this sync has run.
 */
export function syncSelectedRouteToDb(id: number | null, force = false): Promise<void> {
  if (id === null) return Promise.resolve();
  const run = _syncChain.then(() => doSync(id, force)).catch(() => {});
  _syncChain = run;
  return run;
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