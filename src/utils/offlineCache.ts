// src/utils/offlineCache.ts
//
// Tiny "last known good" cache so screens keep showing the user's data
// (name, email, avatar, history, notifications ...) when the internet drops.
//
//  - Memory first  -> screens can read it SYNCHRONOUSLY in useState(...) so there
//                     is no "First Last / john.doe@example.com" flash on re-mount.
//  - AsyncStorage  -> survives app restarts (cold start while offline).
//  - Owner guard   -> if a different account logs in, the old cache is wiped.
//  - Clear on logout (see clearOfflineCache) so nothing leaks between accounts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';

const PREFIX = 'pns_cache_v1:';
const OWNER_KEY = `${PREFIX}__owner`;

/** Shared profile snapshot used by Home + both Account screens. */
export interface CachedProfile {
  userId?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  avatarUrl?: string;
  isOnline?: boolean;
}
export const PROFILE_KEY = 'profile';

const mem = new Map<string, unknown>();
let owner: string | null = null;

/** Resolves once everything saved on disk has been loaded into memory. */
export const offlineCacheReady: Promise<void> = (async () => {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (!keys.length) return;
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, raw] of pairs) {
      if (raw == null) continue;
      if (k === OWNER_KEY) { owner = raw; continue; }
      const name = k.slice(PREFIX.length);
      if (mem.has(name)) continue; // something newer was written while we were loading
      try { mem.set(name, JSON.parse(raw)); } catch { /* corrupt entry, ignore */ }
    }
  } catch { /* storage unavailable -> run without persistence */ }
})();

/** Synchronous read (memory). */
export function peekCache<T>(key: string): T | undefined {
  return mem.get(key) as T | undefined;
}

/** Replace a cached value (memory now, disk in the background). */
export function writeCache(key: string, value: unknown): void {
  mem.set(key, value);
  try {
    AsyncStorage.setItem(PREFIX + key, JSON.stringify(value)).catch(() => {});
  } catch { /* ignore */ }
}

/** Merge fields into a cached object. `undefined` fields are ignored. */
export function patchCache<T extends object>(key: string, patch: Partial<T>): void {
  const clean: Record<string, unknown> = {};
  Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
  const current = (mem.get(key) as T | undefined) || ({} as T);
  writeCache(key, { ...current, ...clean });
}

/** Wipe everything (call on logout / SIGNED_OUT). */
export async function clearOfflineCache(): Promise<void> {
  mem.clear();
  owner = null;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* ignore */ }
}

async function claimOwner(authId: string): Promise<void> {
  await offlineCacheReady;
  if (owner && owner !== authId) {
    // A different account is signed in now -> never show the previous user's data.
    await clearOfflineCache();
  }
  if (owner !== authId) {
    owner = authId;
    try { await AsyncStorage.setItem(OWNER_KEY, authId); } catch { /* ignore */ }
  }
}

/**
 * Offline-safe replacement for `supabase.auth.getUser()`.
 * getUser() needs the network; getSession() reads the locally stored session,
 * so the logged-in user is still known while offline.
 */
export async function resolveAuthUser(): Promise<User | null> {
  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user ?? null;
  } catch { /* network down */ }

  if (!user) {
    try {
      const { data } = await supabase.auth.getSession();
      user = data?.session?.user ?? null;
    } catch { /* ignore */ }
  }

  if (user) await claimOwner(user.id);
  return user;
}