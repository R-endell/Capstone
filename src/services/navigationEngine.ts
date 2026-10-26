// src/services/navigationEngine.ts
// Pure turn-by-turn logic (no React, no GPS, no network of its own).
//
//   route (from components/map/directions.ts)  +  current GPS fix
//        -> where am I along the route, which maneuver is next, how far, am I off-route
//
// Works with both Google Routes steps and OSRM steps: in both, step[i].instruction
// describes the maneuver performed at the START of step i, so the "next maneuver"
// for a driver currently inside step i is the first instruction-bearing step after i.
import type { LatLng } from '../components/map/roadRoute';
import { getNavRoute, haversineM, fmtDistance } from '../components/map/directions';
import type { NavRoute } from '../components/map/directions';

/* ------------------------------- tunables -------------------------------- */
export const ARRIVE_ENTER_M = 40;       // "you have arrived" when closer than this…
export const ARRIVE_EXIT_M = 80;        // …and only un-arrive when farther than this (hysteresis)
export const OFF_ROUTE_M = 60;          // farther than this from the route line = off route
export const REROUTE_MIN_GAP_MS = 8000; // never ask for a new route more often than this
export const ROUTE_REFRESH_MS = 180000; // refresh ETA / traffic while navigating
export const GPS_STALE_MS = 20000;      // no GPS fix for this long = navigation paused
export const NOW_THRESHOLD_M = 30;      // maneuver closer than this reads as "now"

/* ------------------------------ route index ------------------------------ */
export type RouteIndex = {
  cum: number[];         // cumulative metres along the polyline, one per coord
  total: number;         // polyline length in metres
  stepStarts: number[];  // metres along the polyline where each step begins
};

export function buildRouteIndex(route: NavRoute): RouteIndex {
  const c = route.coords;
  const cum: number[] = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversineM(c[i - 1], c[i]));
  const total = cum[cum.length - 1] || 0;

  // Step distances come from the routing service; scale them onto the polyline length so
  // small differences (rounding, thinned OSRM geometry) never push a step past the end.
  const raw = route.steps.reduce((s, x) => s + (x.distanceM || 0), 0);
  const k = raw > 0 && total > 0 ? total / raw : 1;
  let acc = 0;
  const stepStarts = route.steps.map(s => {
    const start = acc * k;
    acc += s.distanceM || 0;
    return start;
  });
  return { cum, total, stepStarts };
}

/* ------------------------------- projection ------------------------------ */
export type Projection = { along: number; offRouteM: number };

/** Nearest point on the polyline to `p`. `hintAlong` (previous result) keeps the match
 *  from jumping to another part of the route that happens to pass nearby. */
export function projectOnRoute(idx: RouteIndex, coords: LatLng[], p: LatLng, hintAlong?: number): Projection {
  const n = coords.length;
  if (n < 2) return { along: 0, offRouteM: n === 1 ? haversineM(p, coords[0]) : Infinity };

  const mLat = 111320;
  const mLng = 111320 * Math.cos((p.latitude * Math.PI) / 180);

  const run = (from: number, to: number): Projection => {
    let bestD = Infinity;
    let bestAlong = 0;
    for (let i = from; i < to; i++) {
      const ax = (coords[i].longitude - p.longitude) * mLng;
      const ay = (coords[i].latitude - p.latitude) * mLat;
      const bx = (coords[i + 1].longitude - p.longitude) * mLng;
      const by = (coords[i + 1].latitude - p.latitude) * mLat;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < bestD) {
        bestD = d;
        bestAlong = idx.cum[i] + t * (idx.cum[i + 1] - idx.cum[i]);
      }
    }
    return { along: bestAlong, offRouteM: bestD };
  };

  if (hintAlong != null) {
    let from = 0;
    while (from < n - 2 && idx.cum[from + 1] < hintAlong - 150) from++;
    let to = from + 1;
    while (to < n - 1 && idx.cum[to] < hintAlong + 2000) to++;
    const windowed = run(from, to);
    if (windowed.offRouteM <= OFF_ROUTE_M) return windowed;
  }
  return run(0, n - 1);
}

/* -------------------------------- progress ------------------------------- */
export type NavProgress = {
  along: number;
  offRouteM: number;
  remainingM: number;
  remainingS: number;
  stepIndex: number;
  /** next maneuver the driver has to perform */
  maneuver: string;
  instruction: string;
  distToManeuverM: number;
  isArrival: boolean;
};

export function computeProgress(route: NavRoute, idx: RouteIndex, pos: LatLng, hintAlong?: number): NavProgress {
  const { along, offRouteM } = projectOnRoute(idx, route.coords, pos, hintAlong);
  const remainingM = Math.max(0, idx.total - along);
  const remainingS = idx.total > 0 ? route.durationS * (remainingM / idx.total) : 0;

  const steps = route.steps;
  let stepIndex = 0;
  for (let i = 0; i < steps.length; i++) if (idx.stepStarts[i] <= along + 1) stepIndex = i;

  // Very start of the route: show the departure instruction ("Head north on …") first.
  if (steps.length > 0 && stepIndex === 0 && along < 25 && steps[0].instruction && steps[0].maneuver !== 'ARRIVE') {
    return { along, offRouteM, remainingM, remainingS, stepIndex, maneuver: steps[0].maneuver || 'STRAIGHT', instruction: steps[0].instruction, distToManeuverM: 0, isArrival: false };
  }

  // Next step that actually carries an instruction (Google leaves "keep going" steps blank).
  let j = stepIndex + 1;
  while (j < steps.length && !steps[j].instruction) j++;

  if (j < steps.length && steps[j].maneuver !== 'ARRIVE') {
    return {
      along, offRouteM, remainingM, remainingS, stepIndex,
      maneuver: steps[j].maneuver || 'STRAIGHT',
      instruction: steps[j].instruction,
      distToManeuverM: Math.max(0, idx.stepStarts[j] - along),
      isArrival: false,
    };
  }
  return {
    along, offRouteM, remainingM, remainingS, stepIndex,
    maneuver: 'ARRIVE', instruction: 'Arrive at your destination', distToManeuverM: remainingM, isArrival: true,
  };
}

/** Human phrase, e.g. "In 100 m, turn right onto Osmeña Blvd" / "You have arrived". */
export function phraseFor(p: NavProgress): string {
  if (p.isArrival) {
    return p.distToManeuverM < ARRIVE_ENTER_M
      ? 'You have arrived'
      : `Arrive at your destination in ${fmtDistance(p.distToManeuverM)}`;
  }
  if (p.distToManeuverM < NOW_THRESHOLD_M) return p.instruction;
  const lead = p.instruction.charAt(0).toLowerCase() + p.instruction.slice(1);
  return `In ${fmtDistance(p.distToManeuverM)}, ${lead}`;
}

/** Part of the route still ahead of the driver (so the line "eats" as they drive). */
export function remainingPath(route: NavRoute, idx: RouteIndex, along: number, me: LatLng): LatLng[] {
  let lo = 0;
  let hi = idx.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx.cum[mid] <= along) lo = mid; else hi = mid - 1;
  }
  return [me, ...route.coords.slice(lo + 1)];
}

/* ------------------------------ route cache ------------------------------ */
// Several maps can be mounted at once (task-card preview + full screen). They share
// one request per ~10 m / 10 s so we never pay for the same Routes call twice.
const cache = new Map<string, { at: number; p: Promise<NavRoute> }>();

export function getRouteCached(from: LatLng, to: LatLng, maxAgeMs = 10000): Promise<NavRoute> {
  const key = `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}>${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < maxAgeMs) return hit.p;

  const p = getNavRoute(from, to).then(r => {
    if (r.source === 'straight') cache.delete(key); // failed lookup: let the next call retry the network
    return r;
  });
  cache.set(key, { at: now, p });
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return p;
}