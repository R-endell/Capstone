// src/modules/Dashboard/Sender/ProviderTrackModal.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Image, StatusBar, Animated, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { LiveFix, isFixFresh } from '../../../services/providerLiveService';
import { SolarIcon } from '../../../components/ui/SolarIcon';
import DraggableSheet, { DraggableSheetHandle } from '../../../components/ui/DraggableSheet';
import { MAP_PROPS, BRAND_ORANGE } from '../../../utils/mapConfig';

const AVG_CITY_SPEED_KMH = 22;
const BLUE = '#3B82F6';
const ROUTE_MIN_GAP_MS = 15_000;   // don't re-ask the router more often than this while the provider moves
const MAX_ROUTE_POINTS = 220;

export type TrackTrip = {
  id?: string;
  routeId: number;
  providerId: number;
  name: string;
  isActive?: boolean;
  vehicleType: string;
  pickup: string;
  dropoff: string;
  pickupSub?: string;
  dropoffSub?: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  timeLabel: string;
  departureTime: Date;
  endTime?: Date | null;
  maxWeightKg?: number | null;
  routeFrequency?: string;
  rating: number;
  state?: 'live' | 'onRoad' | 'soon' | 'scheduled' | 'finished' | 'offline';
  distanceKm?: number | null;
};

type Props = {
  visible: boolean;
  trip: TrackTrip | null;
  fix: LiveFix | null;
  myCoords: { lat: number; lng: number } | null;
  onClose: () => void;
  onRequest: (trip: TrackTrip) => void;
};

type LatLng = { latitude: number; longitude: number };

const toRad = (d: number) => (d * Math.PI) / 180;
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const formatKm = (km: number) =>
  km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`;

const hasCoord = (c: { lat: number; lng: number }) => !!(c.lat || c.lng);

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

/** Keep at most `max` points so the polyline stays cheap to draw. */
const thin = (pts: LatLng[], max = MAX_ROUTE_POINTS): LatLng[] => {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: LatLng[] = [];
  for (let i = 0; i < max - 1; i++) out.push(pts[Math.round(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
};

const fetchRoadCoords = async (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<LatLng[]> => {
  const fallback = [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  ];
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data?.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      return thin(
        data.routes[0].geometry.coordinates.map((c: number[]) => ({
          latitude: c[1],
          longitude: c[0],
        })),
      );
    }
  } catch {
    /* fall through */
  }
  return fallback;
};

/* ------------------------------- map markers ------------------------------- */

// Same pins as LiveTrackingScreen: orange start pin / white destination pin, label underneath.
const PIN = 44, LABEL_H = 26, LABEL_H2 = 42, LABEL_GAP = 6;
type MarkerStyles = ReturnType<typeof makeMarkerStyles>;

const PlaceMarker = React.memo(function PlaceMarker({
  lat, lng, title, street, kind, mk,
}: { lat: number; lng: number; title: string; street?: string; kind: 'start' | 'end'; mk: MarkerStyles }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 800);
    return () => clearTimeout(t);
  }, [title, street]);
  const labelH = street ? LABEL_H2 : LABEL_H;

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: (PIN / 2) / (PIN + LABEL_GAP + labelH) }}
      tracksViewChanges={track}
      zIndex={5}
    >
      <View style={mk.placeWrap}>
        {kind === 'start' ? (
          <View style={mk.pickPin}><SolarIcon name="MapPoint" variant="bold" size={22} color="#FFFFFF" /></View>
        ) : (
          <View style={mk.dropPin}><SolarIcon name="Flag" variant="bold" size={22} color="#000000" /></View>
        )}
        <View style={mk.labelPill}>
          <Text style={mk.labelText} numberOfLines={1}>{title}</Text>
          {!!street && <Text style={mk.labelSub} numberOfLines={1}>{street}</Text>}
        </View>
      </View>
    </Marker>
  );
});

// The provider's real GPS position. The coordinate updates natively; the view only redraws when `live` flips.
const ProviderMarker = React.memo(function ProviderMarker({
  lat, lng, live, accent, muted, mk,
}: { lat: number; lng: number; live: boolean; accent: string; muted: string; mk: MarkerStyles }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 1000);
    return () => clearTimeout(t);
  }, [live]);

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={track}
      zIndex={10}
    >
      <View style={mk.courierPin}>
        <SolarIcon name="Car" variant="bold" size={26} color={live ? accent : muted} />
      </View>
    </Marker>
  );
});

/* -------------------------------- component -------------------------------- */

export default function ProviderTrackModal({
  visible,
  trip,
  fix,
  myCoords,
  onClose,
  onRequest,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const mk = useMemo(() => makeMarkerStyles(), []);

  const mapRef = useRef<MapView>(null);

  // draggable sheet geometry (same proportions as LiveTrackingScreen)
  const { height: winH } = useWindowDimensions();
  const sheetHeight = Math.round(winH * 0.44);
  const expandedH = Math.round(winH * 0.9);
  const collapsedY = expandedH - sheetHeight;
  const sheetY = useRef(new Animated.Value(collapsedY)).current;
  const sheetRef = useRef<DraggableSheetHandle>(null);
  const [expanded, setExpanded] = useState(false);

  const [profile, setProfile] = useState<{ photo: string | null } | null>(null);
  const [, setTick] = useState(0);

  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const lastRouteKey = useRef('');
  const lastRouteAt = useRef(0);
  const routeReq = useRef(0);
  const lastFitKey = useRef('');

  // drop any in-flight route request when the modal goes away
  useEffect(() => () => { routeReq.current += 1; }, []);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setTick((x) => x + 1), 10_000);
    return () => clearInterval(t);
  }, [visible]);

  useEffect(() => {
    if (!visible || !trip) {
      setProfile(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('profile_photo')
          .eq('user_id', trip.providerId)
          .maybeSingle();
        if (active) setProfile({ photo: (data as any)?.profile_photo ?? null });
      } catch {
        if (active) setProfile({ photo: null });
      }
    })();
    return () => {
      active = false;
    };
  }, [visible, trip?.providerId]);

  const live = isFixFresh(fix);
  const providerPos = fix ? { lat: fix.latitude, lng: fix.longitude } : null;

  const distanceKm = useMemo(() => {
    if (!myCoords || !trip) return null;
    const p = providerPos ?? trip.pickupCoords;
    if (!p.lat && !p.lng) return null;
    return haversineKm(myCoords.lat, myCoords.lng, p.lat, p.lng);
  }, [myCoords, providerPos?.lat, providerPos?.lng, trip]);

  const etaMin =
    distanceKm != null && live
      ? Math.max(1, Math.round((distanceKm / AVG_CITY_SPEED_KMH) * 60))
      : null;

  // Road geometry provider(or start) -> destination. While the provider moves the origin is rounded to ~110 m
  // and requests are spaced out, so the public router is not hit on every GPS tick.
  useEffect(() => {
    if (!visible || !trip) {
      routeReq.current += 1;
      setRouteCoords([]);
      lastRouteKey.current = '';
      return;
    }
    const from = providerPos ?? trip.pickupCoords;
    if ((!from.lat && !from.lng) || (!trip.dropoffCoords.lat && !trip.dropoffCoords.lng)) return;

    const digits = providerPos ? 3 : 4;
    const prefix = `${trip.routeId}|`;
    const key = `${prefix}${from.lat.toFixed(digits)},${from.lng.toFixed(digits)}->${trip.dropoffCoords.lat.toFixed(4)},${trip.dropoffCoords.lng.toFixed(4)}`;
    if (key === lastRouteKey.current) return;

    const sameTrip = lastRouteKey.current.startsWith(prefix);
    const nowMs = Date.now();
    if (sameTrip && nowMs - lastRouteAt.current < ROUTE_MIN_GAP_MS) return;

    lastRouteKey.current = key;
    lastRouteAt.current = nowMs;

    const id = ++routeReq.current;
    (async () => {
      const coords = await fetchRoadCoords(
        { lat: from.lat, lng: from.lng },
        { lat: trip.dropoffCoords.lat, lng: trip.dropoffCoords.lng },
      );
      if (id === routeReq.current) setRouteCoords(coords);
    })();
  }, [visible, trip?.routeId, providerPos?.lat, providerPos?.lng]);

  const fitAll = (animated: boolean, withMe: boolean) => {
    if (!trip) return;
    const pts: LatLng[] = [];
    if (hasCoord(trip.pickupCoords)) pts.push({ latitude: trip.pickupCoords.lat, longitude: trip.pickupCoords.lng });
    if (hasCoord(trip.dropoffCoords)) pts.push({ latitude: trip.dropoffCoords.lat, longitude: trip.dropoffCoords.lng });
    if (providerPos) pts.push({ latitude: providerPos.lat, longitude: providerPos.lng });
    if (withMe && myCoords) pts.push({ latitude: myCoords.lat, longitude: myCoords.lng });
    if (pts.length === 0) return;
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: insets.top + 90, right: 50, bottom: sheetHeight + 40, left: 50 },
      animated,
    });
  };

  useEffect(() => {
    if (!visible || !trip) return;
    const key = `${trip.routeId}-${sheetHeight}-${routeCoords.length > 0 ? 'r' : 'n'}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const t = setTimeout(() => fitAll(true, true), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, trip?.routeId, sheetHeight, routeCoords.length, providerPos?.lat, providerPos?.lng]);

  if (!trip) return null;

  const initials =
    trip.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join('') || 'P';

  const depMs = trip.departureTime instanceof Date ? trip.departureTime.getTime() : Date.now();
  const isFinished = trip.state === 'finished';
  const onTheRoad = trip.state === 'live' || trip.state === 'onRoad' || (!trip.state && depMs <= Date.now());
  const isScheduled = trip.state === 'scheduled' || (!onTheRoad && depMs - Date.now() > 60 * 60_000);

  const whenLabel = isFinished
    ? 'Route Finished'
    : onTheRoad
      ? 'On the way'
      : isScheduled
        ? 'Scheduled'
        : 'Leaving soon';

  const whenBg = isFinished
    ? isDark
      ? 'rgba(148,163,184,0.18)'
      : '#F1F5F9'
    : onTheRoad
      ? colors.successBg
      : isScheduled
        ? 'rgba(59,130,246,0.14)'
        : colors.warningBg;

  const whenColor = isFinished
    ? isDark
      ? '#94A3B8'
      : '#64748B'
    : onTheRoad
      ? colors.success
      : isScheduled
        ? BLUE
        : colors.warning;

  const statusText = live ? 'Live' : fix ? 'Stale' : 'Not shared';
  const statusColor = live ? colors.success : colors.warning;

  const pu = splitAddress(trip.pickup);
  const dr = splitAddress(trip.dropoff);
  const puSub = trip.pickupSub || pu.sub;
  const drSub = trip.dropoffSub || dr.sub;
  const departLabel = /^leaves/i.test(trip.timeLabel) ? trip.timeLabel : `Departs ${trip.timeLabel}`;

  const kv = (label: string, value: string, color?: string) => (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, color ? { color } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

        <MapView
          ref={mapRef}
          {...MAP_PROPS}
          userInterfaceStyle="light"
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: trip.pickupCoords.lat || 10.3157,
            longitude: trip.pickupCoords.lng || 123.8854,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          onPress={() => sheetRef.current?.close()}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {routeCoords.length > 1 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor={colors.accent}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {hasCoord(trip.pickupCoords) && (
            <PlaceMarker
              lat={trip.pickupCoords.lat}
              lng={trip.pickupCoords.lng}
              title={pu.main}
              street={puSub}
              kind="start"
              mk={mk}
            />
          )}
          {hasCoord(trip.dropoffCoords) && (
            <PlaceMarker
              lat={trip.dropoffCoords.lat}
              lng={trip.dropoffCoords.lng}
              title={dr.main}
              street={drSub}
              kind="end"
              mk={mk}
            />
          )}

          {myCoords && (
            <Marker
              coordinate={{ latitude: myCoords.lat, longitude: myCoords.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={[mk.meDot, { backgroundColor: colors.info }]} />
            </Marker>
          )}

          {providerPos && (
            <ProviderMarker
              lat={providerPos.lat}
              lng={providerPos.lng}
              live={live}
              accent={colors.accent}
              muted={colors.textMuted}
              mk={mk}
            />
          )}
        </MapView>

        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <TouchableOpacity style={styles.circleBtn} onPress={onClose} activeOpacity={0.85}>
            <SolarIcon name="ArrowLeft" variant="linear" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={[styles.livePill, !live && styles.livePillStale]}>
            <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
            <Text style={styles.liveText}>{statusText}</Text>
          </View>
        </View>

        <Animated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[
            styles.fabWrap,
            {
              bottom: sheetHeight + 12,
              opacity: sheetY.interpolate({
                inputRange: [collapsedY * 0.6, collapsedY],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        >
          <TouchableOpacity style={styles.fab} onPress={() => fitAll(true, false)} activeOpacity={0.85}>
            <SolarIcon name="MapPoint" variant="linear" size={20} color={colors.accent} />
          </TouchableOpacity>
        </Animated.View>

        <DraggableSheet
          ref={sheetRef}
          y={sheetY}
          collapsedY={collapsedY}
          height={expandedH}
          contentPaddingBottom={insets.bottom + 24}
          style={styles.sheet}
          handleHitAreaStyle={styles.grabberWrap}
          handleStyle={styles.grabber}
          onOpenChange={setExpanded}
          header={(
            <View style={styles.sheetHeader}>
              {isFinished ? (
                <Text style={styles.headline}>
                  This route has <Text style={styles.headlineAccent}>finished</Text>
                </Text>
              ) : onTheRoad ? (
                <Text style={styles.headline}>
                  Provider is <Text style={styles.headlineAccent}>on the road</Text>
                  {etaMin != null ? <Text> · about <Text style={styles.headlineAccent}>{etaMin} min</Text> away</Text> : null}
                </Text>
              ) : (
                <Text style={styles.headline}>
                  <Text style={styles.headlineAccent}>{departLabel}</Text>
                </Text>
              )}
            </View>
          )}
        >
          {/* Provider card */}
          <View style={styles.card}>
            <View style={styles.providerRow}>
              <View style={styles.avatar}>
                {profile?.photo ? (
                  <Image source={{ uri: profile.photo }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
              </View>
              <View style={styles.providerText}>
                <Text style={styles.providerName} numberOfLines={1}>{trip.name}</Text>
                <View style={styles.subRow}>
                  <SolarIcon name="Star" variant="bold" size={13} color={colors.warning} />
                  <Text style={styles.providerSubStrong}>{trip.rating}</Text>
                  <Text style={styles.providerDot}>•</Text>
                  <Text style={styles.providerSub} numberOfLines={1}>{trip.vehicleType}</Text>
                </View>
              </View>
              <View style={[styles.whenPill, { backgroundColor: whenBg }]}>
                <Text style={[styles.whenPillText, { color: whenColor }]} numberOfLines={1}>{whenLabel}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.requestBtn, isFinished && styles.requestBtnDisabled]}
              onPress={() => onRequest(trip)}
              activeOpacity={0.9}
              disabled={isFinished}
            >
              <SolarIcon
                name={isFinished ? 'CloseCircle' : 'PaperPlane'}
                variant="duotone"
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.requestBtnText} numberOfLines={1}>
                {isFinished ? 'Route Finished' : 'Request Delivery Along This Route'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.privacyNote}>
            Your pickup will be your current location. Package details are only shared once you send a request.
          </Text>

          {/* Route — revealed by dragging / scrolling the sheet up */}
          <View style={styles.card}>
            <View style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={styles.tlPickIcon}>
                  <SolarIcon name="MapPoint" variant="bold" size={18} color="#FFFFFF" />
                </View>
                <View style={styles.tlLine} />
              </View>
              <View style={styles.tlBody}>
                <Text style={styles.tlLabel}>START</Text>
                <Text style={styles.tlTitle} numberOfLines={1}>{pu.main}</Text>
                {!!puSub && <Text style={styles.tlSub} numberOfLines={2}>{puSub}</Text>}
              </View>
            </View>

            <View style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={styles.tlDropIcon}>
                  <SolarIcon name="Flag" variant="bold" size={16} color="#000000" />
                </View>
              </View>
              <View style={[styles.tlBody, { paddingBottom: 0 }]}>
                <Text style={styles.tlLabel}>DESTINATION</Text>
                <Text style={styles.tlTitle} numberOfLines={1}>{dr.main}</Text>
                {!!drSub && <Text style={styles.tlSub} numberOfLines={2}>{drSub}</Text>}
              </View>
            </View>
          </View>

          {/* Details */}
          <View style={styles.card}>
            {kv('From you', distanceKm != null ? formatKm(distanceKm) : '—')}
            {etaMin != null && kv('Est. arrival to you', `~${etaMin} min`, colors.accent)}
            {kv(isFinished ? 'Status' : 'Departure', isFinished ? 'Arrived' : trip.timeLabel)}
            {trip.maxWeightKg != null && kv('Capacity', `${trip.maxWeightKg} kg`)}
            {!!trip.routeFrequency && kv('Repeats', trip.routeFrequency)}
            {kv('Live location', statusText, statusColor)}
          </View>
        </DraggableSheet>
      </View>
    </Modal>
  );
}

const makeMarkerStyles = () => StyleSheet.create({
  placeWrap: { alignItems: 'center', paddingHorizontal: 4 },
  pickPin: {
    width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: BRAND_ORANGE,
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 8,
  },
  dropPin: {
    width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  courierPin: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  meDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF' },
  labelPill: {
    maxWidth: 210, minHeight: LABEL_H, justifyContent: 'center', marginTop: LABEL_GAP, paddingVertical: 3,
    backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 5,
  },
  labelText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#111827' },
  labelSub: { fontSize: 10.5, fontFamily: 'Poppins_500Medium', color: '#6B7280', marginTop: -1 },
});

const makeStyles = (c: ThemeColors, isDark: boolean) => {
  const hair = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    topBar: {
      position: 'absolute', left: 16, right: 16,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      zIndex: 20,
    },
    circleBtn: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: hair,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
    },
    livePill: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: c.card, borderWidth: 1, borderColor: hair,
      paddingHorizontal: 12, height: 34, borderRadius: 17,
    },
    livePillStale: { borderColor: c.warning },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    liveText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },

    fabWrap: { position: 'absolute', right: 16, zIndex: 15 },
    fab: {
      width: 46, height: 46, borderRadius: 14, backgroundColor: c.card,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: hair,
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.4 : 0.1, shadowRadius: 8, elevation: 4,
    },

    sheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: c.card,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 16, paddingTop: 4,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
    },
    sheetHeader: { paddingBottom: 4 },
    grabberWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },

    headline: {
      fontSize: 20, lineHeight: 28, fontFamily: 'Poppins_700Bold',
      color: c.textPrimary, marginTop: 8, marginBottom: 16, paddingHorizontal: 4,
    },
    headlineAccent: { color: c.accent },

    card: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: hair,
      padding: 16, marginBottom: 14,
    },

    providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: c.success,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { color: '#FFFFFF', fontFamily: 'Poppins_800ExtraBold', fontSize: 18 },
    providerText: { flex: 1, minWidth: 0 },
    providerName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    providerSubStrong: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    providerDot: { fontSize: 12, color: c.textMuted },
    providerSub: { fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_500Medium', flexShrink: 1 },
    whenPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, flexShrink: 0 },
    whenPillText: { fontSize: 11, fontFamily: 'Poppins_700Bold', textTransform: 'uppercase', letterSpacing: 0.3 },

    requestBtn: {
      marginTop: 16, height: 48, borderRadius: 24, backgroundColor: c.accent,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12,
    },
    requestBtnDisabled: { backgroundColor: '#94A3B8' },
    requestBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold', flexShrink: 1 },
    privacyNote: {
      marginTop: -2, marginBottom: 14, paddingHorizontal: 8,
      fontSize: 11, color: c.textMuted, textAlign: 'center', lineHeight: 16, fontFamily: 'Poppins_400Regular',
    },

    tlRow: { flexDirection: 'row', gap: 12 },
    tlRail: { width: 34, alignItems: 'center' },
    tlPickIcon: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND_ORANGE,
      alignItems: 'center', justifyContent: 'center',
    },
    tlDropIcon: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF',
      borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
    },
    tlLine: { flex: 1, width: 2, backgroundColor: c.border, marginTop: 4, marginBottom: -4 },
    tlBody: { flex: 1, minWidth: 0, paddingBottom: 14 },
    tlLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
    tlTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    tlSub: { fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 1 },

    kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
    kvLabel: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    kvValue: { fontSize: 14, fontFamily: 'Poppins_500Medium', color: c.textSecondary, flexShrink: 1, textAlign: 'right' },
  });
};