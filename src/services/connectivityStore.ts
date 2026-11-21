// src/services/connectivityStore.ts
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export type NetStatus = 'online' | 'offline';
export type NetSnapshot = { status: NetStatus; checking: boolean; epoch: number; justRestored: boolean };

const PING_URLS = ['https://clients3.google.com/generate_204', 'https://www.gstatic.com/generate_204'];
const TIMEOUT_MS = 3500;
const ONLINE_EVERY_MS = 8000;
const QUICK_RECHECK_MS = 1000;
const OFFLINE_EVERY_MS = 3000;

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
let manualPending = false;

const pingOne = async (url: string): Promise<boolean> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: ctrl.signal });
    return res.status === 204 || res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
};

const ping = async (): Promise<boolean> => {
  for (const u of PING_URLS) {
    if (await pingOne(u)) return true;
  }
  return false;
};

const schedule = (delay?: number) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(
    () => { void check(false); },
    delay ?? (snap.status === 'offline' ? OFFLINE_EVERY_MS : ONLINE_EVERY_MS),
  );
};

const triggerRestored = () => {
  emit({ status: 'online', checking: false, epoch: snap.epoch + 1, justRestored: true });
  if (restoreTimer) clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => emit({ justRestored: false }), 2500);
};

const check = (manual: boolean): Promise<boolean> => {
  if (manual) {
    manualPending = true;
    emit({ checking: true });
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const wasManual = manualPending;
    manualPending = false;

    const ok = await ping();
    if (ok) {
      fails = 0;
      if (snap.status === 'offline' || wasManual) {
        triggerRestored();
      } else {
        emit({ checking: false });
      }
    } else {
      fails += 1;
      if (snap.status === 'online' && (fails >= 2 || wasManual)) {
        emit({ status: 'offline', checking: false, justRestored: false });
      } else {
        emit({ checking: false });
      }
    }

    schedule(!ok && snap.status === 'online' ? QUICK_RECHECK_MS : undefined);
    return ok;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
};

/** Call once at app start (App.tsx). Safe to call again. */
export const startConnectivityMonitor = () => {
  if (started) return;
  started = true;
  AppState.addEventListener('change', st => {
    if (st === 'active') void check(false);
  });
  void check(false);
};

/** The "Reconnect" button: check right now and refresh all screens when online. */
export const retryConnection = () => check(true);

/** Call from a catch block when a request failed because of the network: re-checks sooner. */
export const reportNetworkError = () => { void check(false); };

export const isOnlineNow = () => snap.status === 'online';

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

export const useConnectivity = (): NetSnapshot =>
  useSyncExternalStore(subscribe, () => snap, () => snap);

/** Goes up by 1 every time the internet comes back or Reconnect succeeds. */
export const useReconnectEpoch = (): number =>
  useSyncExternalStore(subscribe, () => snap.epoch, () => snap.epoch);