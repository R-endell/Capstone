// src/services/connectivityStore.ts
//
// App-wide internet status. No extra native package needed: it pings a tiny HTTPS endpoint.
//   - online  -> checks every 20 s (and every time the app comes back to the foreground)
//   - offline -> checks every 4 s, so it recovers by itself
//   - 2 failed pings in a row are needed to go "offline" (so one slow request does not flash the alert)
//   - every time the internet comes BACK, `epoch` goes up by 1. Screens use useReconnectEpoch() as an effect
//     dependency to refresh their data / retry their route line.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export type NetStatus = 'online' | 'offline';
export type NetSnapshot = { status: NetStatus; checking: boolean; epoch: number; justRestored: boolean };

const PING_URL = 'https://clients3.google.com/generate_204';
const TIMEOUT_MS = 4500;
const ONLINE_EVERY_MS = 20000;
const OFFLINE_EVERY_MS = 4000;

let snap: NetSnapshot = { status: 'online', checking: false, epoch: 0, justRestored: false };
const listeners = new Set<() => void>();
const emit = (patch: Partial<NetSnapshot>) => {
  snap = { ...snap, ...patch };
  listeners.forEach(l => l());
};

let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | null = null;
let fails = 0;
let inflight: Promise<boolean> | null = null;

const ping = async (): Promise<boolean> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PING_URL}?t=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: ctrl.signal });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
};

const schedule = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void check(false); }, snap.status === 'offline' ? OFFLINE_EVERY_MS : ONLINE_EVERY_MS);
};

const check = (manual: boolean): Promise<boolean> => {
  if (inflight) return inflight;
  if (manual) emit({ checking: true });
  inflight = (async () => {
    const ok = await ping();
    if (ok) {
      fails = 0;
      if (snap.status === 'offline') {
        emit({ status: 'online', checking: false, epoch: snap.epoch + 1, justRestored: true });
        if (restoreTimer) clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => emit({ justRestored: false }), 2500);
      } else {
        emit({ checking: false });
      }
    } else {
      fails += 1;
      if (snap.status === 'online' && (fails >= 2 || manual)) emit({ status: 'offline', checking: false, justRestored: false });
      else emit({ checking: false });
    }
    schedule();
    return ok;
  })().finally(() => { inflight = null; });
  return inflight;
};

/** Call once at app start (App.tsx). Safe to call again. */
export const startConnectivityMonitor = () => {
  if (started) return;
  started = true;
  AppState.addEventListener('change', st => { if (st === 'active') void check(false); });
  void check(false);
};

/** The "Reconnect" button: check right now. Resolves true when the internet is back. */
export const retryConnection = () => check(true);

/** Call from a catch block when a request failed because of the network: re-checks sooner. */
export const reportNetworkError = () => { void check(false); };

export const isOnlineNow = () => snap.status === 'online';

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useConnectivity = (): NetSnapshot => useSyncExternalStore(subscribe, () => snap, () => snap);

/** Goes up by 1 every time the internet comes back. Use it as an effect dependency to refresh. */
export const useReconnectEpoch = (): number => useSyncExternalStore(subscribe, () => snap.epoch, () => snap.epoch);