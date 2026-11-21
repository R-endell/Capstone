// src/components/map/NavigationMap.tsx
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle, Image, AppState } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { MAP_PROPS, BRAND_ORANGE, DROPOFF_BLACK } from '../../utils/mapConfig';
import { fmtDistance, haversineM } from './directions';
import type { NavRoute } from './directions';
import {
  ARRIVE_ENTER_M, ARRIVE_EXIT_M, OFF_ROUTE_M, REROUTE_MIN_GAP_MS, ROUTE_REFRESH_MS, NOW_THRESHOLD_M,
  buildRouteIndex, computeProgress, getRouteCached, remainingPath,
} from '../../services/navigationEngine';
import type { RouteIndex } from '../../services/navigationEngine';
import { useNavLocation } from '../../services/navLocationStore';
import { useVoiceGuidance } from '../../services/useVoiceGuidance';
import { useReconnectEpoch } from '../../services/connectivityStore';

export type LatLng = { latitude: number; longitude: number };
export type NavInfo = { distanceM: number | null; durationS: number | null };

export type NavStatus =
  | 'locating' | 'routing' | 'active' | 'rerouting' | 'paused' | 'arrived'
  | 'permission-denied' | 'services-off' | 'gps-error';

export type MapStop = { key: string; coordinate: LatLng; label: 'P' | 'D'; order: number; title?: string; photo?: string | null };
export type EndPoint = { coordinate: LatLng; title?: string };

export type NavigationMapHandle = { recenter: () => void; overview: () => void };

type Props = {
  target: LatLng;
  targetLabel: 'P' | 'D';
  secondary?: { coordinate: LatLng; label: 'P' | 'D' } | null;
  /** Every other stop of the trip (not the current target), in driving order. Rendered as numbered pins. */
  stops?: MapStop[];
  interactive?: boolean;
  showGuidance?: boolean;
  onInfo?: (info: NavInfo) => void;
  onStatusChange?: (status: NavStatus) => void;
  style?: StyleProp<ViewStyle>;
  padTop?: number;
  padBottom?: number;
  bannerTop?: number;
  controlsBottom?: number;
  /** Shown as a big button once the provider has arrived at `target`. */
  arrivalAction?: { label: string; icon?: string; onPress: () => void } | null;
  arrivalActionBottom?: number;
  /** Tapping the target pin. */
  onTargetPress?: () => void;
  /** Tapping one of the other stops' pins (receives MapStop.key). */
  onStopPress?: (key: string) => void;
  /** Final destination of the provider's route, always drawn on the map. */
  endPoint?: EndPoint | null;
  /** Google live-traffic layer (green / orange / red roads). */
  showsTraffic?: boolean;
  /** Start of the provider's posted route. */
  startPoint?: EndPoint | null;
  /** Road line of the provider's posted route (start -> end), drawn under the guidance line. */
  routeLine?: LatLng[] | null;
  /** Every remaining stop AFTER `target`, in driving order (include drop-offs that are still locked). The orange line
   *  continues from `target` through these and on to `endPoint`. */
  routeWaypoints?: LatLng[];
};

const NO_STOPS: MapStop[] = [];

const maneuverIcon = (m: string): any => {
  if (/UTURN/.test(m)) return 'return-up-back';
  if (/ROUNDABOUT/.test(m)) return 'sync';
  if (/MERGE/.test(m)) return 'git-merge';
  if (/LEFT/.test(m)) return 'arrow-back';
  if (/RIGHT/.test(m)) return 'arrow-forward';
  if (/ARRIVE/.test(m)) return 'flag';
  return 'arrow-up';
};

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
const bearingTo = (a: LatLng, b: LatLng) => {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x = Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
};

const ahead = (p: LatLng, bearing: number, meters: number): LatLng => {
  const R = 6371000, d = meters / R, b = toRad(bearing);
  const la1 = toRad(p.latitude), lo1 = toRad(p.longitude);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { latitude: toDeg(la2), longitude: toDeg(lo2) };
};
const FOLLOW_PITCH = 55;

// Spoken turn-by-turn is OFF now that the volume button is gone. Flip to true to bring the voice back
// (it will then always be on, there is no mute control any more).
const VOICE_GUIDANCE_ENABLED = false;

// ---- arrow / camera heading ------------------------------------------------------------------------
// ONE heading drives both the arrow and the camera, so the arrow always points "up" in heading-up mode:
//   1. moving (>= ~3.6 km/h): the GPS course
//   2. slow / stopped: the direction of the route right in front of you (so it matches "Head southeast...")
//   3. no route yet: the last GPS course, else the straight line to the pin
// The phone compass is NOT used: it is wrong when the phone is mounted upright in a vehicle and it made the
// arrow disagree with the map.
const MIN_COURSE_SPEED_MS = 1.0;
const HEADING_HYSTERESIS_DEG = 3;   // ignore tiny changes so the camera doesn't jitter
const ROUTE_LOOKAHEAD_M = 35;       // aim at a route point at least this far ahead of the car (skips the tiny snap-to-road stub at the start of a route)


/* -------------------------------------------------------------------------- */
/*  "You are here" pointer: glides between GPS fixes and follows the travel heading */
/* -------------------------------------------------------------------------- */
const MIN_GLIDE_MS = 600;
const MAX_GLIDE_MS = 2000;
const FRAME_MS = 33;                // ~30 fps is plenty for a marker

const angDiff = (to: number, from: number) => ((((to - from) % 360) + 540) % 360) - 180;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

type MeFix = { latitude: number; longitude: number; heading?: number | null; speed?: number | null };

// distances are always shown in METERS (1,240 m), never switched to km
const fmtMeters = (m: number) => `${Math.max(0, Math.round(m)).toLocaleString('en-US')} m`;

const MeMarker = React.memo(function MeMarker({ fix, heading, screenUp = false, camHeading = 0 }: { fix: MeFix; heading: number | null; screenUp?: boolean; camHeading?: number }) {
  const [pos, setPos] = useState<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });
  const [rot, setRot] = useState(heading ?? 0);
  const [track, setTrack] = useState(true);

  const cur = useRef<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });
  const from = useRef<LatLng>(cur.current);
  const to = useRef<LatLng>(cur.current);
  const startAt = useRef(0);
  const dur = useRef(MIN_GLIDE_MS);
  const lastFixAt = useRef(0);
  const wanted = useRef<number | null>(heading);
  const rotCur = useRef(heading ?? 0);
  const rotShown = useRef(heading ?? 0);
  const raf = useRef<number | null>(null);
  const lastDraw = useRef(0);
  const alive = useRef(true);

  // redraw the bitmap when the pointer switches between "always up on screen" and "rotated on the map"
  useEffect(() => { setTrack(true); const t = setTimeout(() => setTrack(false), 1200); return () => clearTimeout(t); }, [screenUp]);

  const wantedHeading = (): number | null => wanted.current;

  const frame = () => {
    raf.current = null;
    if (!alive.current) return;
    const now = Date.now();
    let busy = false;

    // position: straight glide from where the marker is now to the newest fix
    const t = Math.min(1, (now - startAt.current) / dur.current);
    const p = {
      latitude: from.current.latitude + (to.current.latitude - from.current.latitude) * t,
      longitude: from.current.longitude + (to.current.longitude - from.current.longitude) * t,
    };
    cur.current = p;
    if (t < 1) busy = true;

    // heading: ease toward the wanted heading along the shortest way round
    const want = wantedHeading();
    if (want != null) {
      const d = angDiff(want, rotCur.current);
      if (Math.abs(d) > 0.4) {
        rotCur.current = norm360(rotCur.current + d * 0.25);
        busy = true;
      }
    }

    if (now - lastDraw.current >= FRAME_MS || !busy) {
      lastDraw.current = now;
      setPos(p);
      if (Math.abs(angDiff(rotCur.current, rotShown.current)) > 0.3) {
        rotShown.current = rotCur.current;
        setRot(rotCur.current);
      }
    }
    if (busy) raf.current = requestAnimationFrame(frame);
  };

  const kick = () => { if (raf.current == null && alive.current) raf.current = requestAnimationFrame(frame); };

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; if (raf.current != null) cancelAnimationFrame(raf.current); raf.current = null; };
  }, []);

  // new GPS fix -> glide there over about the time since the previous fix
  useEffect(() => {
    const now = Date.now();
    const next = { latitude: fix.latitude, longitude: fix.longitude };
    const jump = haversineM(cur.current, next);
    from.current = jump > 250 ? next : cur.current;     // teleport only for big jumps
    to.current = next;
    const gap = lastFixAt.current ? now - lastFixAt.current : MIN_GLIDE_MS;
    dur.current = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, gap));
    startAt.current = now;
    lastFixAt.current = now;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix.latitude, fix.longitude, fix.heading, fix.speed]);

  // heading changed (new GPS course / route direction): ease the arrow round to it
  useEffect(() => {
    wanted.current = heading;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading]);

  return (
    <Marker coordinate={pos} anchor={{ x: 0.5, y: 0.5 }} flat={false} rotation={screenUp ? 0 : norm360(rot - camHeading)} tracksViewChanges={track} zIndex={10}>
      <View style={styles.meWrap}>
        {/* Drawn with plain Views (triangle + notch) so it ALWAYS points straight up before the marker is
            rotated by the heading. The old Ionicons "navigate" glyph is drawn at 45 degrees and its
            orientation differs between icon-font versions, which is what made the arrow look inverted. */}
        <View style={styles.arrowBox}>
          <View style={styles.arrowHead} />
          <View style={styles.arrowNotch} />
        </View>
      </View>
    </Marker>
  );
});

// Map pins. Pickup = ORANGE pin with a package (box) icon, drop-off = BLACK pin with a package icon.
// Android draws a custom marker from a snapshot, so the marker keeps redrawing for a moment after it is created
// (otherwise the snapshot can be taken before the layout is finished: clipped banners, empty circles).
const useSettledTracking = (...deps: any[]) => {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return track;
};

const PackagePin = React.memo(function PackagePin({
  coordinate, kind, badge, banner, onPress, zIndex = 4,
}: { coordinate: LatLng; kind: 'pickup' | 'dropoff'; badge?: number; banner?: string; onPress?: () => void; zIndex?: number }) {
  const track = useSettledTracking(kind, badge, banner);
  const color = kind === 'pickup' ? BRAND_ORANGE : DROPOFF_BLACK;
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={track} zIndex={zIndex} onPress={onPress}>
      <View style={styles.photoPinWrap}>
        {!!banner && (
          <View style={styles.photoBanner}>
            <Text style={styles.photoBannerText}>{banner}</Text>
          </View>
        )}
        <View style={[styles.photoPinCircle, { backgroundColor: color }]}>
          <Ionicons name="cube" size={24} color="#FFFFFF" />
          {badge != null && (
            <View style={[styles.pinBadge, { borderColor: color }]}>
              <Text style={[styles.pinBadgeText, { color }]}>{badge}</Text>
            </View>
          )}
        </View>
        <View style={[styles.photoPinTail, { borderTopColor: color }]} />
      </View>
    </Marker>
  );
});

// End of the provider's posted route. `offsetRight` moves it beside another pin that sits on the same spot.
const EndPin = React.memo(function EndPin({ coordinate, offsetRight }: { coordinate: LatLng; offsetRight: boolean }) {
  const track = useSettledTracking(offsetRight);
  return (
    <Marker coordinate={coordinate} anchor={{ x: offsetRight ? -0.2 : 0.5, y: 1 }} tracksViewChanges={track} zIndex={3}>
      <View style={styles.photoPinWrap}>
        <View style={styles.photoBanner}>
          <Text style={styles.photoBannerText}>ROUTE END</Text>
        </View>
        <View style={[styles.photoPinCircle, styles.endPinCircle]}>
          <Ionicons name="flag" size={22} color="#000000" />
        </View>
        <View style={[styles.photoPinTail, styles.endPinTail]} />
      </View>
    </Marker>
  );
});

const StartDot = React.memo(function StartDot({ coordinate }: { coordinate: LatLng }) {
  const track = useSettledTracking();
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track} zIndex={2}>
      <View style={styles.startDot}><View style={styles.startDotInner} /></View>
    </Marker>
  );
});

type RouteState = { r: NavRoute; idx: RouteIndex; tKey: string };

const NavigationMapInner = (
  {
    target, targetLabel, secondary = null, stops = NO_STOPS, interactive = false, showGuidance, onInfo, onStatusChange,
    style, padTop = 60, padBottom = 60, bannerTop = 0, controlsBottom = 280,
    arrivalAction = null, arrivalActionBottom = 24,
    onTargetPress, onStopPress, endPoint = null, startPoint = null, routeLine = null, showsTraffic = false, routeWaypoints,
  }: Props,
  ref: React.ForwardedRef<NavigationMapHandle>
) => {
  const guidance = (showGuidance ?? interactive) && interactive;
  const mapRef = useRef<MapView>(null);
  const loc = useNavLocation(true);
  const [following, setFollowing] = useState(true);
  const [camHeading, setCamHeading] = useState(0);
  // Android can leave ghost copies of a polyline whose coordinates change often, or lose it when the map surface is
  // recreated. Lines are keyed by route + this counter so they are rebuilt cleanly instead of being patched in place.
  const [overlayEpoch, setOverlayEpoch] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') setOverlayEpoch(e => e + 1); });
    return () => sub.remove();
  }, []);
  const camPoll = useRef(0);
  // The pointer is drawn relative to the SCREEN, so it needs the heading the map is really showing (it changes when the
  // user drags / zooms / rotates the map). pointer angle = travel heading - map heading.
  const readCamera = useCallback(() => {
    mapRef.current?.getCamera().then(c => setCamHeading(c?.heading ?? 0)).catch(() => {});
  }, []);
  const [arrived, setArrived] = useState(false);
  const [route, setRoute] = useState<RouteState | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [futureLine, setFutureLine] = useState<LatLng[] | null>(null);
  const netEpoch = useReconnectEpoch();   // +1 every time the internet comes back
  const routeRef = useRef<RouteState | null>(null);
  routeRef.current = route;

  const targetRef = useRef(target);
  targetRef.current = target;
  const tKey = `${target.latitude.toFixed(5)},${target.longitude.toFixed(5)}`;

  const reqSeq = useRef(0);
  const inflightKey = useRef<string | null>(null);
  const lastReqAt = useRef(0);
  const offCount = useRef(0);
  const alongRef = useRef<number | undefined>(undefined);
  const fittedFor = useRef('');
  const headingRef = useRef(0);
  const travelHeadingRef = useRef<number | null>(null);
  const lastFixTs = useRef(0);
  const fixGap = useRef(900);

  const me = useMemo<LatLng | null>(
    () => (loc.fix ? { latitude: loc.fix.latitude, longitude: loc.fix.longitude } : null),
    [loc.fix],
  );
  useEffect(() => {
    const now = Date.now();
    if (lastFixTs.current) fixGap.current = Math.min(2000, Math.max(600, now - lastFixTs.current));
    lastFixTs.current = now;
  }, [loc.fix]);
  const liveM = me ? haversineM(me, target) : null;

  useEffect(() => { setArrived(false); }, [tKey]);
  useEffect(() => {
    if (liveM == null) return;
    setArrived(prev => (prev ? liveM < ARRIVE_EXIT_M : liveM < ARRIVE_ENTER_M));
  }, [liveM]);

  const requestRoute = useCallback((from: LatLng, reason: 'initial' | 'reroute' | 'refresh') => {
    const seq = ++reqSeq.current;
    const key = tKey;
    inflightKey.current = key;
    lastReqAt.current = Date.now();
    if (reason === 'reroute') setRerouting(true);
    getRouteCached(from, targetRef.current).then(r => {
      if (seq !== reqSeq.current) return;
      // Offline / router failed: the engine answers with a STRAIGHT line. Keep the last real road route instead of
      // replacing it (the next refresh, or the reconnect, tries again).
      const prev = routeRef.current;
      if (r.source === 'straight' && prev && prev.tKey === key && prev.r.source !== 'straight') return;
      alongRef.current = undefined;
      offCount.current = 0;
      setRoute({ r, idx: buildRouteIndex(r), tKey: key });
    }).finally(() => {
      if (seq === reqSeq.current) { inflightKey.current = null; setRerouting(false); }
    });
  }, [tKey]);

  useEffect(() => () => { reqSeq.current++; }, []);

  const progress = useMemo(() => {
    if (!me || !route || route.tKey !== tKey) return null;
    return computeProgress(route.r, route.idx, me, alongRef.current);
  }, [me, route, tKey]);
  useEffect(() => { alongRef.current = progress?.along; }, [progress]);

  useEffect(() => {
    if (!me || arrived || loc.stale) return;
    if (route?.tKey !== tKey) {
      if (inflightKey.current !== tKey) requestRoute(me, 'initial');
      return;
    }
    if (inflightKey.current === tKey) return;
    const now = Date.now();
    if (progress && progress.offRouteM > OFF_ROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 2 && now - lastReqAt.current > REROUTE_MIN_GAP_MS) requestRoute(me, 'reroute');
      return;
    }
    offCount.current = 0;
    if (guidance && now - lastReqAt.current > ROUTE_REFRESH_MS) requestRoute(me, 'refresh');
  }, [me, tKey, arrived, loc.stale, route, progress, guidance, requestRoute]);

  const close = liveM != null && liveM < 150;
  const distanceM: number | null = progress ? (close ? liveM : progress.remainingM) : liveM;
  const durationS: number | null = progress
    ? (progress.remainingM > 0 && distanceM != null ? progress.remainingS * Math.min(1, distanceM / progress.remainingM) : 0)
    : null;

  const onInfoRef = useRef<Props['onInfo']>(onInfo);
  onInfoRef.current = onInfo;
  const bucket = guidance ? 10 : 50;
  useEffect(() => {
    onInfoRef.current?.({ distanceM: distanceM ?? null, durationS });
  }, [Math.round((distanceM ?? -1) / bucket), Math.round((durationS ?? -1) / 30)]);

  let status: NavStatus;
  if (loc.status === 'denied') status = 'permission-denied';
  else if (loc.status === 'services-off') status = 'services-off';
  else if (loc.status === 'error') status = 'gps-error';
  else if (!me) status = 'locating';
  else if (arrived) status = 'arrived';
  else if (loc.stale) status = 'paused';
  else if (!progress) status = 'routing';
  else if (rerouting) status = 'rerouting';
  else status = 'active';

  const onStatusRef = useRef<Props['onStatusChange']>(onStatusChange);
  onStatusRef.current = onStatusChange;
  useEffect(() => { onStatusRef.current?.(status); }, [status]);

  const fit = useCallback((animated = true) => {
    const pts: LatLng[] = [target, ...stops.map(st => st.coordinate)];
    if (endPoint) pts.push(endPoint.coordinate);
    if (startPoint) pts.push(startPoint.coordinate);
    if (me) pts.push(me);
    if (pts.length === 1) {
      mapRef.current?.animateToRegion({ ...target, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
      return;
    }
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: padTop + 180, right: 60, bottom: padBottom + 200, left: 60 },
      animated,
    });
  }, [me, target, stops, endPoint, startPoint, padTop, padBottom]);

  const overview = useCallback(() => {
    setFollowing(false);
    if (guidance) mapRef.current?.animateCamera({ pitch: 0, heading: 0 }, { duration: 300 });
    const pts: LatLng[] = [...(route && route.tKey === tKey && route.r.coords.length > 1
      ? route.r.coords
      : (me ? [me, target, ...stops.map(st => st.coordinate)] : [target, ...stops.map(st => st.coordinate)]))];
    if (futureLine) pts.push(...futureLine);
    if (endPoint) pts.push(endPoint.coordinate);
    if (startPoint) pts.push(startPoint.coordinate);
    if (pts.length < 2) { fit(true); return; }
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: padTop + 180, right: 60, bottom: padBottom + 200, left: 60 },
        animated: true,
      });
    }, guidance ? 350 : 0);
  }, [route, tKey, me, target, stops, endPoint, startPoint, futureLine, padTop, padBottom, fit, guidance]);

  const followCamera = useCallback((duration = fixGap.current) => {
    if (!me) return;
    const d = progress?.distToManeuverM;
    const zoom = d == null || d < 300 ? 18 : d < 1200 ? 17 : 16;
    const th = travelHeadingRef.current;
    if (th != null && (!headingRef.current || Math.abs(angDiff(th, headingRef.current)) > HEADING_HYSTERESIS_DEG)) {
      headingRef.current = th;
    } else if (!headingRef.current) {
      headingRef.current = bearingTo(me, target);
    }
    const offsetM = zoom >= 18 ? 70 : zoom >= 17 ? 140 : 280;
    mapRef.current?.animateCamera(
      { center: ahead(me, headingRef.current, offsetM), zoom, heading: headingRef.current, pitch: FOLLOW_PITCH },
      { duration },
    );
  }, [me, target, progress?.distToManeuverM, loc.fix]);

  const recenter = useCallback(() => {
    setFollowing(true);
    if (guidance) followCamera(500); else fit(true);
  }, [guidance, followCamera, fit]);

  useImperativeHandle(ref, () => ({ recenter, overview }), [recenter, overview]);

  useEffect(() => {
    if (guidance || !following) return;
    const key = `${tKey}|${me ? 1 : 0}|${route ? 1 : 0}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    fit(true);
  }, [guidance, tKey, me, route, following, fit]);

  useEffect(() => {
    if (!guidance || !following || !me || arrived) return;
    followCamera();
  }, [guidance, following, me, arrived, progress?.distToManeuverM, loc.fix]);

  useEffect(() => { if (guidance && arrived) fit(true); }, [guidance, arrived]);

  const meRef = useRef(me);
  meRef.current = me;

  // Internet is back: fetch the real road route again right away
  useEffect(() => {
    if (netEpoch === 0) return;
    const m = meRef.current;
    if (m && !arrived) requestRoute(m, 'refresh');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netEpoch]);

  // ---- the rest of the trip: target -> remaining stops -> ROUTE END (orange, continues the live line) ----
  const upcoming = useMemo<LatLng[]>(() => {
    const out: LatLng[] = [...(routeWaypoints ?? stops.map(st => st.coordinate))];
    if (endPoint) {
      const last = out.length ? out[out.length - 1] : target;
      if (haversineM(last, endPoint.coordinate) > 15) out.push(endPoint.coordinate);
    }
    return out;
  }, [routeWaypoints, stops, endPoint, target]);
  const upcomingKey = useMemo(
    () => [tKey, ...upcoming.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`)].join('>'),
    [tKey, upcoming],
  );
  const upcomingRef = useRef(upcoming);
  upcomingRef.current = upcoming;
  useEffect(() => {
    const wps = upcomingRef.current;
    if (!wps.length) { setFutureLine(null); return; }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = async (attempt: number) => {
      const pts = [targetRef.current, ...wps];
      const out: LatLng[] = [];
      let failed = false;
      for (let i = 0; i < pts.length - 1; i++) {
        let seg: NavRoute | null = null;
        try { seg = await getRouteCached(pts[i], pts[i + 1]); } catch { seg = null; }
        if (cancelled) return;
        // a straight fallback means "no internet / router failed": never draw it, retry instead
        if (!seg || seg.source === 'straight' || seg.coords.length < 2) { failed = true; break; }
        out.push(...(out.length ? seg.coords.slice(1) : seg.coords));
      }
      if (failed) {
        if (attempt < 4) retry = setTimeout(() => { void load(attempt + 1); }, 4000 * (attempt + 1));
        return;                      // keep whatever line is already on the map
      }
      setFutureLine(out.length > 1 ? out : null);
    };
    void load(0);
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [upcomingKey, netEpoch]);
  const alongBucket = progress ? Math.floor(progress.along / 12) : -1;
  const linePts = useMemo(() => {
    if (!route || route.tKey !== tKey || route.r.coords.length < 2) return null;
    const m = meRef.current;
    if (progress && m && route.r.source !== 'straight') return remainingPath(route.r, route.idx, progress.along, m);
    return route.r.coords;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, tKey, alongBucket, !!progress]);
  const guidanceKey = route ? `${route.tKey}-${route.r.coords.length}-${route.r.source}` : 'none';
  const straightOnly = route?.r.source === 'straight' && route.tKey === tKey;

  // ---- shared heading for the arrow + camera ----
  const gpsHeading = loc.fix?.heading ?? null;
  const gpsSpeed = loc.fix?.speed ?? 0;
  const movingNow = gpsHeading != null && gpsHeading >= 0 && gpsSpeed >= MIN_COURSE_SPEED_MS;
  const lastCourse = useRef<number | null>(null);
  useEffect(() => { if (movingNow) lastCourse.current = gpsHeading as number; }, [movingNow, gpsHeading]);

  // direction of the route just ahead of the car (linePts starts at the car and runs to the destination)
  const routeBearing = useMemo<number | null>(() => {
    if (!me || !linePts || linePts.length < 2 || straightOnly) return null;
    for (let i = 0; i < linePts.length; i++) {
      if (haversineM(me, linePts[i]) >= ROUTE_LOOKAHEAD_M) return bearingTo(me, linePts[i]);
    }
    // short route: aim at its end (the destination) if it is not on top of us
    const last = linePts[linePts.length - 1];
    return haversineM(me, last) >= 5 ? bearingTo(me, last) : null;
  }, [me, linePts, straightOnly]);

  const travelHeading = useMemo<number | null>(() => {
    if (movingNow) return gpsHeading as number;
    if (routeBearing != null) return routeBearing;
    if (lastCourse.current != null) return lastCourse.current;
    return me ? bearingTo(me, target) : null;
  }, [movingNow, gpsHeading, routeBearing, me, target]);
  travelHeadingRef.current = travelHeading;

  const banner: { icon: string; distance: string; street: string } = (() => {
    if (status === 'arrived') return { icon: 'flag', distance: 'Arrived', street: 'Destination' };
    if (status === 'locating') return { icon: 'locate', distance: 'Locating...', street: 'Getting GPS' };
    if (!progress) return { icon: 'navigate', distance: 'Routing...', street: 'Finding route' };
    if (straightOnly) return { icon: 'arrow-up', distance: fmtMeters(distanceM), street: 'Head to pin' };
    
    const d = progress.distToManeuverM;
    const instruction = progress.instruction || 'Continue';
    
    return {
      icon: maneuverIcon(progress.maneuver),
      distance: d < NOW_THRESHOLD_M ? 'Now' : fmtMeters(d),
      street: instruction.replace(/^(Turn|Keep|Continue)\s+(left|right|straight)\s+(onto|on)?\s*/i, '').trim() || instruction,
    };
  })();

  const blocked = status === 'permission-denied' || status === 'services-off' || status === 'gps-error';

  // Spoken guidance: only on the interactive navigation screen, not on preview maps.
  useVoiceGuidance({
    enabled: VOICE_GUIDANCE_ENABLED && guidance && !blocked,
    progress,
    status,
    targetKey: tKey,
    targetLabel,
  });

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <MapView
        ref={mapRef}
        {...MAP_PROPS}
        userInterfaceStyle="light"
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...target, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        onMapReady={() => { readCamera(); if (!guidance) fit(false); }}
        onPanDrag={() => { if (interactive) setFollowing(false); }}
        onRegionChange={() => {
          const now = Date.now();
          if (now - camPoll.current > 120) { camPoll.current = now; readCamera(); }
        }}
        onRegionChangeComplete={readCamera}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={interactive}
        toolbarEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        showsUserLocation={false}
        showsTraffic={showsTraffic}
      >
        {/* Heading-up navigation (like Google Maps): the map turns to the travel direction and the pointer always
            points to the top of the screen. When the map is not following (overview / panned) the pointer is
            rotated on the map instead. */}
        {me && loc.fix && <MeMarker fix={loc.fix as any} heading={travelHeading} screenUp={guidance && following} camHeading={camHeading} />}

        {/* the provider's posted route (start -> end) */}
        {routeLine && routeLine.length > 2 && (
          <Polyline
            key={`posted-${overlayEpoch}-${routeLine.length}`}
            coordinates={routeLine}
            strokeColor="rgba(17,24,39,0.55)"
            strokeWidth={6}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {startPoint && <StartDot coordinate={startPoint.coordinate} />}

        {/* orange line CONTINUES from the target through the remaining stops to the route end */}
        {futureLine && futureLine.length > 1 && (
          <Polyline
            key={`future-${overlayEpoch}-${futureLine.length}`}
            coordinates={futureLine}
            strokeColor={BRAND_ORANGE}
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* live leg: you -> next stop (real road only; the straight fallback is never drawn) */}
        {linePts && linePts.length > 1 && !straightOnly && (
          <Polyline
            key={`guide-${overlayEpoch}-${guidanceKey}`}
            coordinates={linePts}
            strokeColor={BRAND_ORANGE}
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
        )}

        {/* Other stops of the trip. Pickup = orange package pin, drop-off = black package pin. Tap = package details */}
        {stops.map(st => (
          <PackagePin
            key={st.key}
            coordinate={st.coordinate}
            kind={st.label === 'P' ? 'pickup' : 'dropoff'}
            badge={st.order}
            onPress={onStopPress ? () => onStopPress(st.key) : undefined}
          />
        ))}

        {/* Final destination of the route (set beside another pin when they share the same spot) */}
        {endPoint && (
          <EndPin
            coordinate={endPoint.coordinate}
            offsetRight={
              haversineM(endPoint.coordinate, target) < 30 ||
              stops.some(st => haversineM(endPoint.coordinate, st.coordinate) < 30)
            }
          />
        )}

        {/* the stop being navigated to */}
        <PackagePin
          coordinate={target}
          kind={targetLabel === 'D' ? 'dropoff' : 'pickup'}
          banner={targetLabel === 'D' ? 'DROP-OFF' : 'PICKUP'}
          onPress={onTargetPress}
          zIndex={5}
        />
      </MapView>

      {guidance && !blocked && (
        <View style={[styles.topBanner, { paddingTop: bannerTop + 10 }]} pointerEvents="none">
          <View style={styles.bannerContent}>
            <View style={styles.bannerIconRow}>
              <Ionicons name={banner.icon as any} size={50} color="#fff" />
            </View>
            <View style={styles.bannerRight}>
              <View style={styles.bannerDistBadge}>
                <Text style={styles.bannerDistText}>{banner.distance}</Text>
              </View>
              <Text style={styles.bannerStreet} numberOfLines={2}>{banner.street}</Text>
            </View>
          </View>
        </View>
      )}

      {interactive && arrived && !blocked && arrivalAction && (
        <View style={[styles.arriveWrap, { bottom: arrivalActionBottom }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.arriveBtn} activeOpacity={0.9} onPress={arrivalAction.onPress}>
            <Ionicons name={(arrivalAction.icon || 'checkmark-circle') as any} size={22} color="#fff" />
            <Text style={styles.arriveBtnText}>{arrivalAction.label}</Text>
          </TouchableOpacity>
        </View>
      )}

      {guidance && blocked && (
        <View style={styles.blockedWrap}>
          <View style={styles.blockedCard}>
            <Ionicons name="location-outline" size={28} color={BRAND_ORANGE} />
            <Text style={styles.blockedTitle}>GPS is off</Text>
            <Text style={styles.blockedBody}>Enable location to navigate.</Text>
            <TouchableOpacity style={styles.blockedBtn} onPress={loc.retry}>
              <Text style={styles.blockedBtnText}>Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const NavigationMap = forwardRef<NavigationMapHandle, Props>(NavigationMapInner);

export default NavigationMap;

const styles = StyleSheet.create({
  topBanner: {
    position: 'absolute', top: 0, left: 0, right: 0,
    backgroundColor: BRAND_ORANGE, 
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingBottom: 20, paddingHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 8,
  },
  bannerContent: { flexDirection: 'row', alignItems: 'center' },
  bannerIconRow: { marginRight: 16 },
  bannerRight: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerDistBadge: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  bannerDistText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  bannerStreet: { color: '#fff', fontSize: 26, fontWeight: '700', flex: 1 },

  meWrap: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },

  dropWrap: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  arrowBox: { width: 26, height: 28, alignItems: 'center', marginTop: -2 },
  arrowHead: {
    width: 0, height: 0,
    borderLeftWidth: 13, borderRightWidth: 13, borderBottomWidth: 28,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#000000',
  },
  arrowNotch: {
    position: 'absolute', bottom: 0,
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 9,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#FFFFFF',
  },

  stopPin: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  stopPinPickup: { backgroundColor: BRAND_ORANGE },
  stopPinDrop: { backgroundColor: '#fff', borderColor: '#E5E7EB' },
  stopBadge: {
    position: 'absolute', top: -8, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff',
  },
  stopBadgePickup: { backgroundColor: '#111827' },
  stopBadgeDrop: { backgroundColor: '#111827' },
  stopBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  photoPinWrap: { alignItems: 'center', paddingBottom: 2, paddingTop: 8, paddingHorizontal: 10 },
  photoBanner: {
    alignSelf: 'center',
    backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB',
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 5, elevation: 6,
  },
  photoBannerText: { color: '#111827', fontSize: 10.5, fontWeight: '900', letterSpacing: 0.5 },
  photoPinCircle: {
    width: 50, height: 50, borderRadius: 25, backgroundColor: BRAND_ORANGE,
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },
  photoPinImg: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F3F4F6' },
  photoPinTail: {
    width: 0, height: 0, marginTop: -2,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: BRAND_ORANGE,
  },
  endPinCircle: { backgroundColor: '#fff', borderColor: '#111827' },
  pinBadge: {
    position: 'absolute', top: -8, right: -8, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 4,
    backgroundColor: '#FFFFFF', borderWidth: 2, alignItems: 'center', justifyContent: 'center',
  },
  pinBadgeText: { fontSize: 11, fontWeight: '900' },
  startDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', borderWidth: 3, borderColor: BRAND_ORANGE,
    alignItems: 'center', justifyContent: 'center',
  },
  startDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND_ORANGE },
  endPinTail: { borderTopColor: '#111827' },

  floatBtn: {
    position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },

  arriveWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center' },
  arriveBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: BRAND_ORANGE, borderRadius: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 10,
  },
  arriveBtnText: { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },

  blockedWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  blockedCard: { backgroundColor: '#fff', padding: 24, borderRadius: 16, alignItems: 'center', width: 280 },
  blockedTitle: { color: '#000', fontSize: 18, fontWeight: '700', marginTop: 12 },
  blockedBody: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 8 },
  blockedBtn: { backgroundColor: BRAND_ORANGE, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 20 },
  blockedBtnText: { color: '#fff', fontWeight: '700' },
});