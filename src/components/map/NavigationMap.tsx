// src/components/map/NavigationMap.tsx
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
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

export type LatLng = { latitude: number; longitude: number };
export type NavInfo = { distanceM: number | null; durationS: number | null };

export type NavStatus =
  | 'locating' | 'routing' | 'active' | 'rerouting' | 'paused' | 'arrived'
  | 'permission-denied' | 'services-off' | 'gps-error';

export type NavigationMapHandle = { recenter: () => void; overview: () => void };

type Props = {
  target: LatLng;
  targetLabel: 'P' | 'D';
  secondary?: { coordinate: LatLng; label: 'P' | 'D' } | null;
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
};

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

type RouteState = { r: NavRoute; idx: RouteIndex; tKey: string };

const NavigationMapInner = (
  {
    target, targetLabel, secondary = null, interactive = false, showGuidance, onInfo, onStatusChange,
    style, padTop = 60, padBottom = 60, bannerTop = 0, controlsBottom = 280,
    arrivalAction = null, arrivalActionBottom = 24,
  }: Props,
  ref: React.ForwardedRef<NavigationMapHandle>
) => {
  const guidance = (showGuidance ?? interactive) && interactive;
  const mapRef = useRef<MapView>(null);
  const loc = useNavLocation(true);
  const [following, setFollowing] = useState(true);
  const [arrived, setArrived] = useState(false);
  const [route, setRoute] = useState<RouteState | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [muted, setMuted] = useState(false);

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
  const [trackMarker, setTrackMarker] = useState(true);
  
  useEffect(() => { const t = setTimeout(() => setTrackMarker(false), 800); return () => clearTimeout(t); }, []);

  const me = useMemo<LatLng | null>(
    () => (loc.fix ? { latitude: loc.fix.latitude, longitude: loc.fix.longitude } : null),
    [loc.fix],
  );
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
    const pts: LatLng[] = [target];
    if (me) pts.push(me);
    if (pts.length === 1) {
      mapRef.current?.animateToRegion({ ...target, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 300);
      return;
    }
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: padTop + 180, right: 60, bottom: padBottom + 200, left: 60 },
      animated,
    });
  }, [me, target, padTop, padBottom]);

  const overview = useCallback(() => {
    setFollowing(false);
    if (guidance) mapRef.current?.animateCamera({ pitch: 0, heading: 0 }, { duration: 300 });
    const pts = route && route.tKey === tKey && route.r.coords.length > 1
      ? route.r.coords
      : (me ? [me, target] : [target]);
    if (pts.length < 2) { fit(true); return; }
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: padTop + 180, right: 60, bottom: padBottom + 200, left: 60 },
        animated: true,
      });
    }, guidance ? 350 : 0);
  }, [route, tKey, me, target, padTop, padBottom, fit, guidance]);

  const followCamera = useCallback((duration = 900) => {
    if (!me) return;
    const d = progress?.distToManeuverM;
    const zoom = d == null || d < 300 ? 18 : d < 1200 ? 17 : 16;
    const gpsHeading = loc.fix?.heading;
    const moving = (loc.fix?.speed ?? 0) > 1.5 && gpsHeading != null && gpsHeading >= 0;
    if (moving) headingRef.current = gpsHeading as number;
    else if (!headingRef.current) headingRef.current = bearingTo(me, target);
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
    followCamera(900);
  }, [guidance, following, me, arrived, progress?.distToManeuverM, loc.fix]);

  useEffect(() => { if (guidance && arrived) fit(true); }, [guidance, arrived]);

  const linePts = useMemo(() => {
    if (!route || route.tKey !== tKey || route.r.coords.length < 2) return null;
    if (progress && me && route.r.source !== 'straight') return remainingPath(route.r, route.idx, progress.along, me);
    return route.r.coords;
  }, [route, tKey, progress, me]);
  const straightOnly = route?.r.source === 'straight' && route.tKey === tKey;

  const banner: { icon: string; distance: string; street: string } = (() => {
    if (status === 'arrived') return { icon: 'flag', distance: 'Arrived', street: 'Destination' };
    if (status === 'locating') return { icon: 'locate', distance: 'Locating...', street: 'Getting GPS' };
    if (!progress) return { icon: 'navigate', distance: 'Routing...', street: 'Finding route' };
    if (straightOnly) return { icon: 'arrow-up', distance: fmtDistance(distanceM), street: 'Head to pin' };
    
    const d = progress.distToManeuverM;
    const instruction = progress.instruction || 'Continue';
    
    return {
      icon: maneuverIcon(progress.maneuver),
      distance: d < NOW_THRESHOLD_M ? 'Now' : fmtDistance(d),
      street: instruction.replace(/^(Turn|Keep|Continue)\s+(left|right|straight)\s+(onto|on)?\s*/i, '').trim() || instruction,
    };
  })();

  const blocked = status === 'permission-denied' || status === 'services-off' || status === 'gps-error';

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <MapView
        ref={mapRef}
        {...MAP_PROPS}
        userInterfaceStyle="light"
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...target, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        onMapReady={() => { if (!guidance) fit(false); }}
        onPanDrag={() => { if (interactive) setFollowing(false); }}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={interactive}
        toolbarEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        showsUserLocation={false} 
      >
        {me && (
          <Marker coordinate={me} anchor={{ x: 0.5, y: 0.5 }} flat rotation={headingRef.current} tracksViewChanges={trackMarker}>
            <View style={styles.meWrap}>
              <Ionicons name="navigate" size={32} color={BRAND_ORANGE} />
            </View>
          </Marker>
        )}

        {linePts && (
          <Polyline
            coordinates={linePts}
            strokeColor={BRAND_ORANGE}
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
            lineDashPattern={straightOnly ? [14, 10] : undefined}
          />
        )}
        
        {/* ✅ RE-DESIGNED PREMIUM MARKER & BANNER */}
        {targetLabel === 'D' ? (
          /* Drop-off: plain black location icon (no banner) */
          <Marker coordinate={target} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
            <Ionicons name="location" size={48} color="#000000" />
          </Marker>
        ) : (
        <Marker coordinate={target} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
          <View style={{ alignItems: 'center', paddingBottom: 4 }}>
            
            {/* Clean White Tooltip Banner */}
            <View style={{
              backgroundColor: '#FFFFFF',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: '#E5E7EB',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 6,
              elevation: 8,
              marginBottom: 6,
              paddingHorizontal: 12, 
              paddingVertical: 6,
            }}>
              <Text style={{ 
                color: '#111827', 
                fontSize: 11, 
                fontWeight: '900', 
                letterSpacing: 0.5 
              }}>
                {targetLabel === 'P' ? 'PICKUP' : 'DROP-OFF'}
              </Text>

              {/* Triangle pointer pointing down to the pin */}
              <View style={{
                position: 'absolute',
                bottom: -6,
                left: '50%',
                marginLeft: -6,
                width: 0,
                height: 0,
                borderLeftWidth: 6,
                borderRightWidth: 6,
                borderTopWidth: 6,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderTopColor: '#FFFFFF', // Matches banner background
              }} />
            </View>

            {/* Main Pin Icon */}
            <View style={{
              backgroundColor: targetLabel === 'P' ? BRAND_ORANGE : '#3B82F6', 
              width: 44, height: 44,
              borderRadius: 22,
              borderWidth: 3,
              borderColor: '#fff',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.4,
              shadowRadius: 6,
              elevation: 8,
            }}>
              <Ionicons
                name={targetLabel === 'P' ? 'cube' : 'home'}
                size={20}
                color="#fff"
              />
            </View>
          </View>
        </Marker>
        )}
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

      {interactive && (
        <TouchableOpacity
          style={[styles.floatBtn, { top: bannerTop + 120, right: 20 }]}
          activeOpacity={0.8}
          onPress={() => setMuted(m => !m)}
        >
           <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={24} color={muted ? '#9CA3AF' : BRAND_ORANGE} />
        </TouchableOpacity>
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