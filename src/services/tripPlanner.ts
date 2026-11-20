// src/services/tripPlanner.ts
//
// Trip organizer: turns every active order of a provider into ONE ordered list of stops.
//
//  * An order that is still waiting for pickup contributes two stops: PICKUP, then DROP-OFF.
//  * An order that is already picked up (in transit) contributes only its DROP-OFF.
//  * An order that is being returned contributes one stop: the sender's pickup pin.
//
// The list is sorted automatically so the provider never backtracks: every drop-off comes after its own
// pickup, and among all valid orders the one with the SHORTEST total driving distance (starting from the
// provider's position) wins. Up to MAX_EXACT stops are solved exactly, bigger trips use nearest-neighbour
// followed by a precedence-safe improvement pass.

export type TripPoint = { lat: number; lng: number; main: string; sub: string };

export type TripStopKind = 'pickup' | 'dropoff';

export type TripStop = {
  /** Unique within the trip, e.g. "12:pickup". */
  key: string;
  deliveryId: number;
  requestId: number | null;
  /** Tracking code, e.g. PNS-0012 */
  code: string;
  kind: TripStopKind;
  point: TripPoint;
  note: string;
  /** True for a drop-off whose parcel is not picked up yet (it only appears on the map after pickup). */
  locked: boolean;
  /** True when this stop is the parcel being returned to the sender. */
  isReturn: boolean;
};

export type TripOrder = {
  deliveryId: number;
  requestId: number | null;
  code: string;
  stage: 'pickup' | 'transit' | 'return';
  pickup: TripPoint | null;
  dropoff: TripPoint | null;
  pickupNote: string;
  dropoffNote: string;
};

export const trackingCode = (id: any) => `PNS-${String(id).padStart(4, '0')}`;

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = String(full).split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

export const toTripPoint = (loc: any): TripPoint | null => {
  const lat = Number(loc?.latitude);
  const lng = Number(loc?.longitude);
  if (loc?.latitude == null || loc?.longitude == null || !isFinite(lat) || !isFinite(lng)) return null;
  const place = loc?.place_name ? String(loc.place_name) : null;
  const addr = splitAddress(loc?.street_address);
  return place ? { lat, lng, main: place, sub: loc?.street_address || addr.sub } : { lat, lng, ...addr };
};

const isPickupVerified = (d: any): boolean => {
  const qr = d?.qr_verifications;
  if (qr) {
    if (Array.isArray(qr)) { if (qr[0]?.pickup_verified) return true; }
    else if (qr.pickup_verified) return true;
  }
  const status = d?.delivery_requests?.delivery_status;
  return status === 'In Transit' || status === 'Awaiting Approval' || status === 'Returning' || status === 'Completed' || status === 'Returned';
};

/**
 * Converts rows from getProviderDeliveries() into trip orders.
 * Finished, cancelled, returned and "awaiting approval" deliveries are skipped (nothing left to drive to).
 * `routeId` (optional) keeps only deliveries that belong to that posted route (or to no route at all).
 */
export const ordersFromDeliveries = (list: any[], routeId?: number | null): TripOrder[] => {
  const out: TripOrder[] = [];
  for (const d of list || []) {
    if (!d || d.completed_at) continue;
    const req = d.delivery_requests || {};
    const status = String(req.delivery_status || '');
    const low = status.toLowerCase();
    if (low === 'cancelled' || low === 'canceled' || low === 'completed' || low === 'returned' || low === 'awaiting approval') continue;

    if (routeId != null) {
      const delRoute = d.route_id != null ? Number(d.route_id) : null;
      const prefRoute = req.preferred_route_id != null ? Number(req.preferred_route_id) : null;
      const unassigned = delRoute == null && prefRoute == null;
      if (!unassigned && delRoute !== routeId && prefRoute !== routeId) continue;
    }

    const deliveryId = Number(d.delivery_id);
    if (!isFinite(deliveryId)) continue;
    const pickup = toTripPoint(req.pickup_location);
    const dropoff = toTripPoint(req.dropoff_location);
    const stage: TripOrder['stage'] = low === 'returning' ? 'return' : isPickupVerified(d) ? 'transit' : 'pickup';

    out.push({
      deliveryId,
      requestId: d.request_id != null ? Number(d.request_id) : null,
      code: trackingCode(d.request_id ?? d.delivery_id),
      stage,
      pickup,
      dropoff,
      pickupNote: String(req.pickup_note || '').trim(),
      dropoffNote: String(req.dropoff_note || '').trim(),
    });
  }
  return out;
};

/* ------------------------------ distance helpers ------------------------------ */

type LL = { lat: number; lng: number };

const toRad = (x: number) => (x * Math.PI) / 180;
const distKm = (a: LL, b: LL) => {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

const MAX_EXACT = 9; // 9 stops -> at most 9! = 362k permutations before pruning, instant on a phone

/** Expands orders into stops (before sorting). `pre` = index of the stop that must be visited first, or -1. */
const expand = (orders: TripOrder[]) => {
  const stops: TripStop[] = [];
  const pre: number[] = [];

  for (const o of orders) {
    if (o.stage === 'pickup') {
      if (!o.pickup) continue;
      const pIdx = stops.length;
      stops.push({
        key: `${o.deliveryId}:pickup`, deliveryId: o.deliveryId, requestId: o.requestId, code: o.code,
        kind: 'pickup', point: o.pickup, note: o.pickupNote, locked: false, isReturn: false,
      });
      pre.push(-1);
      if (o.dropoff) {
        stops.push({
          key: `${o.deliveryId}:dropoff`, deliveryId: o.deliveryId, requestId: o.requestId, code: o.code,
          kind: 'dropoff', point: o.dropoff, note: o.dropoffNote, locked: true, isReturn: false,
        });
        pre.push(pIdx);
      }
    } else if (o.stage === 'transit') {
      if (!o.dropoff) continue;
      stops.push({
        key: `${o.deliveryId}:dropoff`, deliveryId: o.deliveryId, requestId: o.requestId, code: o.code,
        kind: 'dropoff', point: o.dropoff, note: o.dropoffNote, locked: false, isReturn: false,
      });
      pre.push(-1);
    } else {
      // returning: drive the parcel back to the sender's pickup pin
      if (!o.pickup) continue;
      stops.push({
        key: `${o.deliveryId}:return`, deliveryId: o.deliveryId, requestId: o.requestId, code: o.code,
        kind: 'dropoff', point: o.pickup, note: o.pickupNote, locked: false, isReturn: true,
      });
      pre.push(-1);
    }
  }
  return { stops, pre };
};

const orderLength = (seq: number[], pts: LL[], origin: LL | null) => {
  let len = 0;
  let prev: LL | null = origin;
  for (const i of seq) {
    if (prev) len += distKm(prev, pts[i]);
    prev = pts[i];
  }
  return len;
};

const validOrder = (seq: number[], pre: number[]) => {
  const pos = new Map<number, number>();
  seq.forEach((s, p) => pos.set(s, p));
  return seq.every(s => pre[s] < 0 || (pos.get(pre[s]) ?? Infinity) < (pos.get(s) as number));
};

const solveExact = (pts: LL[], pre: number[], origin: LL | null): number[] => {
  const n = pts.length;
  const d: number[][] = pts.map(a => pts.map(b => distKm(a, b)));
  const d0: number[] = pts.map(p => (origin ? distKm(origin, p) : 0));

  let best = Infinity;
  let bestSeq: number[] = [];
  const used = new Array<boolean>(n).fill(false);
  const seq: number[] = [];

  const go = (len: number) => {
    if (len >= best) return;
    if (seq.length === n) { best = len; bestSeq = seq.slice(); return; }
    const last = seq.length ? seq[seq.length - 1] : -1;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      if (pre[i] >= 0 && !used[pre[i]]) continue;
      used[i] = true; seq.push(i);
      go(len + (last < 0 ? d0[i] : d[last][i]));
      seq.pop(); used[i] = false;
    }
  };
  go(0);
  return bestSeq;
};

const solveHeuristic = (pts: LL[], pre: number[], origin: LL | null): number[] => {
  const n = pts.length;
  const used = new Array<boolean>(n).fill(false);
  const seq: number[] = [];
  let cur: LL | null = origin;
  while (seq.length < n) {
    let pick = -1;
    let pd = Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i] || (pre[i] >= 0 && !used[pre[i]])) continue;
      const dd = cur ? distKm(cur, pts[i]) : 0;
      if (dd < pd) { pd = dd; pick = i; }
    }
    if (pick < 0) pick = used.findIndex(u => !u);
    used[pick] = true; seq.push(pick); cur = pts[pick];
  }

  // improvement pass: try moving one stop to another position while the order stays valid
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    let bestLen = orderLength(seq, pts, origin);
    for (let from = 0; from < n; from++) {
      for (let to = 0; to < n; to++) {
        if (from === to) continue;
        const cand = seq.slice();
        const [moved] = cand.splice(from, 1);
        cand.splice(to, 0, moved);
        if (!validOrder(cand, pre)) continue;
        const len = orderLength(cand, pts, origin);
        if (len + 1e-9 < bestLen) {
          seq.splice(0, n, ...cand);
          bestLen = len;
          improved = true;
        }
      }
    }
  }
  return seq;
};

/**
 * Sorts all stops of all orders into the shortest valid driving order starting at `origin`
 * (the provider's current position; pass null when it is not known yet).
 */
export const planTrip = (orders: TripOrder[], origin: LL | null): TripStop[] => {
  const { stops, pre } = expand(orders);
  if (stops.length <= 1) return stops;
  const pts: LL[] = stops.map(s => ({ lat: s.point.lat, lng: s.point.lng }));
  const seq = stops.length <= MAX_EXACT ? solveExact(pts, pre, origin) : solveHeuristic(pts, pre, origin);
  return seq.map(i => stops[i]);
};

/** Total straight-line length of the sorted trip in km (for the "12.4 km" summary). */
export const tripLengthKm = (stops: TripStop[], origin: LL | null): number => {
  const pts: LL[] = stops.map(s => ({ lat: s.point.lat, lng: s.point.lng }));
  return orderLength(pts.map((_, i) => i), pts, origin);
};

/** Short, stable signature of the stop order, used to avoid re-fetching routes when nothing changed. */
export const tripSignature = (stops: TripStop[]): string => stops.map(s => s.key).join('>');