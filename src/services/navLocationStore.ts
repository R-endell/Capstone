// src/services/navLocationStore.ts
// ONE shared foreground GPS watcher for every navigation map on screen.
//   - Starts when the first <NavigationMap> mounts, stops when the last one unmounts
//     (no GPS use while nobody is navigating).
//   - Foreground only. Provider -> sender location broadcasting is NOT handled here;
//     that stays in useProviderLocationBroadcast.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '../components/map/roadRoute';
import { GPS_STALE_MS } from './navigationEngine';

export type LocationFix = LatLng & {
  heading: number | null;
  speed: number | null;      // m/s
  accuracy: number | null;   // m
  timestamp: number;         // ms epoch
};

export type NavLocationState = {
  status: 'idle' | 'starting' | 'active' | 'denied' | 'services-off' | 'error';
  fix: LocationFix | null;
  canAskAgain: boolean;
};

let state: NavLocationState = { status: 'idle', fix: null, canAskAgain: true };
const listeners = new Set<() => void>();
let refs = 0;
let sub: Location.LocationSubscription | null = null;
let startToken = 0;

const setState = (patch: Partial<NavLocationState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
};

const toFix = (p: Location.LocationObject): LocationFix => ({
  latitude: p.coords.latitude,
  longitude: p.coords.longitude,
  heading: p.coords.heading != null && p.coords.heading >= 0 ? p.coords.heading : null,
  speed: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed : null,
  accuracy: p.coords.accuracy ?? null,
  timestamp: p.timestamp,
});

async function start() {
  const token = ++startToken;
  setState({ status: 'starting' });
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      if (token === startToken) setState({ status: 'services-off' });
      return;
    }
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
    if (token !== startToken) return;
    if (perm.status !== 'granted') {
      setState({ status: 'denied', canAskAgain: perm.canAskAgain });
      return;
    }

    const last = await Location.getLastKnownPositionAsync({ maxAge: 15000 }).catch(() => null);
    if (token !== startToken) return;
    if (last) setState({ fix: toFix(last) });

    // distanceInterval 0: while navigating we want regular fixes even when stopped at a
    // light, otherwise "no new fix" can't be told apart from "GPS lost".
    const s = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 0 },
      p => setState({ status: 'active', fix: toFix(p) }),
    );
    if (token !== startToken || refs === 0) { s.remove(); return; }
    sub = s;
    setState({ status: 'active' });
  } catch {
    if (token === startToken) setState({ status: 'error' });
  }
}

function stop() {
  startToken++;
  sub?.remove();
  sub = null;
  setState({ status: 'idle' });
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => state;

export function useNavLocation(enabled = true) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!enabled) return;
    refs += 1;
    if (refs === 1) void start();
    return () => {
      refs -= 1;
      if (refs === 0) stop();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [enabled]);

  /** Ask for permission / restart the watcher (after the user fixed settings). */
  const retry = useCallback(() => {
    if (refs === 0) return;
    sub?.remove();
    sub = null;
    void start();
  }, []);

  const stale = snap.status === 'active' && !!snap.fix && now - snap.fix.timestamp > GPS_STALE_MS;
  return { ...snap, stale, retry };
}