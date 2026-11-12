// src/modules/Dashboard/Sender/ProviderTrackModal.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Image, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { LiveFix, isFixFresh } from '../../../services/providerLiveService';
import { SolarIcon } from '../../../components/ui/SolarIcon';

import { GOOGLE_MAP_ID } from '../../../utils/mapConfig';

const AVG_CITY_SPEED_KMH = 22;
const BLUE = '#3B82F6';

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

const formatLastSeen = (iso?: string | null) => {
  if (!iso) return 'Waiting for the provider’s GPS…';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'Updated just now';
  if (ms < 60_000) return `Updated ${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `Updated ${Math.floor(ms / 60_000)}m ago`;
  return `Last seen ${new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
};

const fetchRoadCoords = async (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<{ latitude: number; longitude: number }[]> => {
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
      return data.routes[0].geometry.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
  } catch {
    /* fall through */
  }
  return fallback;
};

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

  const mapRef = useRef<MapView>(null);

  const [sheetHeight, setSheetHeight] = useState(330);
  const [profile, setProfile] = useState<{ photo: string | null } | null>(null);
  const [, setTick] = useState(0);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const lastRouteKey = useRef('');
  const lastFitKey = useRef('');

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

  useEffect(() => {
    if (!visible || !trip) {
      setRouteCoords([]);
      lastRouteKey.current = '';
      return;
    }
    const from = providerPos ?? trip.pickupCoords;
    if ((!from.lat && !from.lng) || (!trip.dropoffCoords.lat && !trip.dropoffCoords.lng)) return;

    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}->${trip.dropoffCoords.lat.toFixed(4)},${trip.dropoffCoords.lng.toFixed(4)}`;
    if (key === lastRouteKey.current) return;
    lastRouteKey.current = key;

    let cancelled = false;
    (async () => {
      const coords = await fetchRoadCoords(
        { lat: from.lat, lng: from.lng },
        { lat: trip.dropoffCoords.lat, lng: trip.dropoffCoords.lng },
      );
      if (!cancelled) setRouteCoords(coords);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, trip?.routeId, providerPos?.lat, providerPos?.lng]);

  useEffect(() => {
    if (!visible || !trip) return;
    const key = `${trip.routeId}-${sheetHeight}-${routeCoords.length > 0 ? 'r' : 'n'}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const pts: { latitude: number; longitude: number }[] = [];
    if (trip.pickupCoords.lat || trip.pickupCoords.lng) {
      pts.push({ latitude: trip.pickupCoords.lat, longitude: trip.pickupCoords.lng });
    }
    if (trip.dropoffCoords.lat || trip.dropoffCoords.lng) {
      pts.push({ latitude: trip.dropoffCoords.lat, longitude: trip.dropoffCoords.lng });
    }
    if (providerPos) pts.push({ latitude: providerPos.lat, longitude: providerPos.lng });
    if (myCoords) pts.push({ latitude: myCoords.lat, longitude: myCoords.lng });

    if (pts.length === 0) return;

    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 140, right: 50, bottom: sheetHeight + insets.bottom + 40, left: 50 },
        animated: true,
      });
    }, 200);
    return () => clearTimeout(t);
  }, [visible, trip?.routeId, sheetHeight, routeCoords.length, providerPos?.lat, providerPos?.lng]);

  const recenterMap = () => {
    if (!trip) return;
    const pts: { latitude: number; longitude: number }[] = [];
    if (trip.pickupCoords.lat || trip.pickupCoords.lng) {
      pts.push({ latitude: trip.pickupCoords.lat, longitude: trip.pickupCoords.lng });
    }
    if (trip.dropoffCoords.lat || trip.dropoffCoords.lng) {
      pts.push({ latitude: trip.dropoffCoords.lat, longitude: trip.dropoffCoords.lng });
    }
    if (providerPos) pts.push({ latitude: providerPos.lat, longitude: providerPos.lng });
    if (pts.length === 0) return;

    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 140, right: 50, bottom: sheetHeight + insets.bottom + 40, left: 50 },
      animated: true,
    });
  };

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

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          googleMapId={GOOGLE_MAP_ID}
          userInterfaceStyle="light"
          initialRegion={{
            latitude: trip.pickupCoords.lat || 10.3157,
            longitude: trip.pickupCoords.lng || 123.8854,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {(trip.pickupCoords.lat !== 0 || trip.pickupCoords.lng !== 0) && (
            <Marker
              coordinate={{ latitude: trip.pickupCoords.lat, longitude: trip.pickupCoords.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: colors.accent,
                  borderWidth: 3,
                  borderColor: '#FFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: '#FFF' }}>
                  S
                </Text>
              </View>
            </Marker>
          )}

          {(trip.dropoffCoords.lat !== 0 || trip.dropoffCoords.lng !== 0) && (
            <Marker
              coordinate={{ latitude: trip.dropoffCoords.lat, longitude: trip.dropoffCoords.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: colors.textPrimary,
                  borderWidth: 3,
                  borderColor: '#FFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: '#FFF' }}>
                  D
                </Text>
              </View>
            </Marker>
          )}

          {routeCoords.length > 1 && (
            <Polyline coordinates={routeCoords} strokeColor={colors.accent} strokeWidth={5} />
          )}

          {myCoords && (
            <Marker
              coordinate={{ latitude: myCoords.lat, longitude: myCoords.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: colors.info,
                  borderWidth: 3,
                  borderColor: '#FFF',
                }}
              />
            </Marker>
          )}

          {providerPos && (
            <Marker
              coordinate={{ latitude: providerPos.lat, longitude: providerPos.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.success,
                  borderWidth: 3,
                  borderColor: '#FFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SolarIcon name="Car" variant="bold" size={18} color="#FFF" />
              </View>
            </Marker>
          )}
        </MapView>

        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <TouchableOpacity style={styles.circleBtn} onPress={onClose} activeOpacity={0.85}>
            <SolarIcon name="ArrowLeft" variant="linear" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={[styles.livePill, !live && styles.livePillStale]}>
            <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.fab, { bottom: sheetHeight + insets.bottom + 12 }]}
          onPress={recenterMap}
          activeOpacity={0.85}
        >
          <SolarIcon name="MapPoint" variant="linear" size={20} color={colors.accent} />
        </TouchableOpacity>

        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.grabber} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <View style={styles.providerRow}>
              <View style={styles.avatar}>
                {profile?.photo ? (
                  <Image source={{ uri: profile.photo }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
                <View style={styles.verifiedDot}>
                  <SolarIcon name="Check" variant="bold" size={9} color="#FFFFFF" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.providerName} numberOfLines={1}>
                  {trip.name}
                </Text>
                <View style={styles.subRow}>
                  <Text style={styles.providerSub}>{trip.vehicleType}</Text>
                  <SolarIcon name="Star" variant="boldDuotone" size={12} color={colors.warning} />
                  <Text style={styles.providerSub}>{trip.rating}</Text>
                </View>
              </View>
              <View style={[styles.whenPill, { backgroundColor: whenBg }]}>
                <Text style={[styles.whenPillText, { color: whenColor }]}>{whenLabel}</Text>
              </View>
            </View>

            <View style={styles.routeBox}>
              <View style={styles.routeRow}>
                <View style={styles.dotOrange} />
                <Text style={styles.routeText} numberOfLines={1}>
                  {trip.pickup}
                </Text>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeRow}>
                <View style={styles.dotDark} />
                <Text style={styles.routeText} numberOfLines={1}>
                  {trip.dropoff}
                </Text>
              </View>
            </View>

            <View style={styles.stats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>FROM YOU</Text>
                <Text style={styles.statValue}>
                  {distanceKm != null ? formatKm(distanceKm) : '—'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.requestBtn, isFinished && { backgroundColor: '#94A3B8', shadowOpacity: 0 }]}
              onPress={() => onRequest(trip)}
              activeOpacity={0.9}
              disabled={isFinished}
            >
              <SolarIcon
                name={isFinished ? 'CloseCircle' : 'PaperPlane'}
                variant="linear"
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.requestBtnText}>
                {isFinished ? 'Route Finished' : 'Request Delivery Along This Route'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.privacyNote}>
              Your pickup will be your current location. Package details are only shared once you send a request.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    topBar: {
      position: 'absolute',
      left: 16,
      right: 16,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      zIndex: 20,
    },
    circleBtn: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.2 : 0.02,
      shadowRadius: 6,
      elevation: 0,
    },
    livePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 20,
    },
    livePillStale: { borderColor: c.warning },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    fab: {
      position: 'absolute',
      right: 16,
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      zIndex: 15,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: isDark ? 0.4 : 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 10,
      maxHeight: '62%',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1,
      shadowRadius: 16,
      elevation: 14,
    },
    grabber: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      alignSelf: 'center',
      marginBottom: 12,
    },

    providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: isDark ? '#3A2411' : '#FFE4D2',
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { color: '#FFFFFF', fontFamily: 'Poppins_800ExtraBold', fontSize: 16 },
    verifiedDot: {
      position: 'absolute',
      right: -1,
      bottom: -1,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.success,
      borderWidth: 2,
      borderColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    providerName: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
    providerSub: { fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
    whenPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
    whenPillText: { fontSize: 11, fontFamily: 'Poppins_700Bold' },

    routeBox: {
      backgroundColor: c.background,
      borderRadius: 12,
      paddingVertical: 12,
      paddingHorizontal: 14,
      marginTop: 14,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    routeLine: { width: 2, height: 10, backgroundColor: c.border, marginLeft: 3, marginVertical: 3 },
    routeText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, flex: 1 },
    dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },
    dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textPrimary },

    stats: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.background,
      borderRadius: 12,
      paddingVertical: 12,
      marginTop: 12,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    },
    statBox: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
    statLabel: {
      fontSize: 9,
      fontFamily: 'Poppins_800ExtraBold',
      color: c.textMuted,
      letterSpacing: 0.8,
    },
    statValue: {
      fontSize: 15,
      fontFamily: 'Poppins_800ExtraBold',
      color: c.textPrimary,
      marginTop: 4,
      letterSpacing: -0.2,
    },
    statDivider: { width: 1, height: 26, backgroundColor: c.border },
    updated: {
      fontSize: 11,
      color: c.textSecondary,
      fontFamily: 'Poppins_500Medium',
      marginTop: 10,
      textAlign: 'center',
    },

    requestBtn: {
      marginTop: 16,
      backgroundColor: c.accent,
      borderRadius: 14,
      paddingVertical: 15,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      shadowColor: c.accent,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 4,
    },
    requestBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
    privacyNote: {
      marginTop: 10,
      fontSize: 11,
      color: c.textMuted,
      textAlign: 'center',
      lineHeight: 16,
      fontFamily: 'Poppins_400Regular',
    },
  });