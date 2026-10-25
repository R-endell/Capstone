// src/modules/Dashboard/Sender/Delivery/LiveTrackingScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image,
  StatusBar, Linking, ScrollView, Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { supabase } from '../../../../utils/supabase';
import { fetchLatestFix, ProviderFix } from '../../../../services/locationService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

import { GOOGLE_MAP_ID } from '../../../../utils/mapConfig';

const ORANGE = '#FF751F';
const AVG_CITY_SPEED_KMH = 22;
const STALE_MS = 45_000;

type LatLng = { latitude: number; longitude: number };

type RouteData = {
  deliveryId: number;
  requestId: number;
  providerId: number | null;
  acceptedAt: string | null;
  completedAt: string | null;
  estimatedEta: string | null;
  pickup: LatLng & { address: string };
  dropoff: LatLng & { address: string };
  pickupVerified: boolean;
  dropoffVerified: boolean;
  deliveryStatus: string;
};

function timelineStage(r: RouteData | null): number {
  if (!r) return 0;
  if (r.completedAt) return 4;
  if (r.pickupVerified) return 3;
  if (r.acceptedAt) return 1;
  return 0;
}

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return 'Waiting for GPS…';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'Updated just now';
  if (ms < 60_000) return `Updated ${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `Updated ${Math.floor(ms / 60_000)}m ago`;
  return `Last seen ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

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
  } catch { /* fall through */ }
  return fallback;
};

const polylineDistanceKm = (coords: { latitude: number; longitude: number }[]): number => {
  if (coords.length < 2) return 0;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const pt = coords[i];
    const dLat = toRad(pt.latitude - prev.latitude);
    const dLng = toRad(pt.longitude - prev.longitude);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(prev.latitude)) * Math.cos(toRad(pt.latitude)) * Math.sin(dLng / 2) ** 2;
    total += 2 * R * Math.asin(Math.sqrt(h));
  }
  return total;
};

export default function LiveTrackingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const deliveryId: number = route.params?.deliveryId;
  const providerParamId: number | undefined = route.params?.providerId;
  const routeParamId: number | undefined = route.params?.routeId;
  const isProviderMode = route.params?.mode === 'provider' && !!providerParamId;

  const mapRef = useRef<MapView>(null);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RouteData | null>(null);
  const [provider, setProvider] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [fix, setFix] = useState<ProviderFix | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(340);
  const [stageBanner, setStageBanner] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const lastStageRef = useRef<number>(-1);

  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const lastRouteKey = useRef('');
  const lastFitKey = useRef('');

  const loadProviderStatic = useCallback(async () => {
    if (!providerParamId) return;

    let q = supabase
      .from('provider_routes')
      .select(`
        route_id, provider_id,
        start_location:locations!provider_routes_start_location_id_fkey ( street_address, latitude, longitude ),
        end_location:locations!provider_routes_end_location_id_fkey ( street_address, latitude, longitude ),
        vehicle:vehicles!provider_routes_vehicle_id_fkey ( vehicle_type, plate_number, max_weight_kg )
      `)
      .eq('provider_id', providerParamId);
    if (routeParamId) q = q.eq('route_id', routeParamId);
    const { data: r } = await q.limit(1).maybeSingle();

    if (!r) { setLoading(false); return; }

    const start: any = (r as any).start_location;
    const end: any = (r as any).end_location;

    setData({
      deliveryId: 0,
      requestId: 0,
      providerId: providerParamId,
      acceptedAt: null,
      completedAt: null,
      estimatedEta: null,
      deliveryStatus: 'On the road',
      pickupVerified: false,
      dropoffVerified: false,
      pickup: {
        latitude: Number(start?.latitude) || 10.3157,
        longitude: Number(start?.longitude) || 123.8854,
        address: start?.street_address ?? 'Route start',
      },
      dropoff: {
        latitude: Number(end?.latitude) || 10.3157,
        longitude: Number(end?.longitude) || 123.8854,
        address: end?.street_address ?? 'Destination',
      },
    });
    setVehicle((r as any).vehicle ?? null);

    const { data: p } = await supabase
      .from('users')
      .select('user_id, first_name, last_name, phone_number, profile_photo')
      .eq('user_id', providerParamId)
      .maybeSingle();
    setProvider(p);

    const { data: f } = await supabase
      .from('provider_locations')
      .select('latitude, longitude, heading, speed, accuracy, updated_at')
      .eq('provider_id', providerParamId)
      .maybeSingle();
    if (f) {
      setFix({
        latitude: f.latitude,
        longitude: f.longitude,
        heading: f.heading ?? null,
        speed: f.speed ?? null,
        accuracy: f.accuracy ?? null,
        updated_at: f.updated_at,
      });
    }

    setLoading(false);
  }, [providerParamId, routeParamId]);

  const loadStatic = useCallback(async () => {
    if (isProviderMode) { await loadProviderStatic(); return; }
    if (!deliveryId) return;
    const { data: d } = await supabase
      .from('deliveries')
      .select(`
        delivery_id, request_id, provider_id, accepted_at, completed_at, estimated_eta,
        vehicle:vehicles(vehicle_id, vehicle_type, plate_number, max_weight_kg),
        request:delivery_requests(
          request_id, delivery_status, receiver_phone,
          pickup:locations!delivery_requests_pickup_location_id_fkey(location_id, street_address, latitude, longitude),
          dropoff:locations!delivery_requests_dropoff_location_id_fkey(location_id, street_address, latitude, longitude)
        )
      `)
      .eq('delivery_id', deliveryId)
      .maybeSingle();

    if (!d) { setLoading(false); return; }

    const { data: qr } = await supabase
      .from('qr_verifications')
      .select('pickup_verified, dropoff_verified')
      .eq('delivery_id', deliveryId)
      .maybeSingle();

    const req: any = (d as any).request;
    const pickupLoc = req?.pickup;
    const dropoffLoc = req?.dropoff;

    setData({
      deliveryId: d.delivery_id,
      requestId: d.request_id,
      providerId: d.provider_id,
      acceptedAt: d.accepted_at,
      completedAt: d.completed_at,
      estimatedEta: d.estimated_eta,
      deliveryStatus: req?.delivery_status ?? 'Matched',
      pickupVerified: !!qr?.pickup_verified,
      dropoffVerified: !!qr?.dropoff_verified,
      pickup: {
        latitude: pickupLoc?.latitude ?? 10.3157,
        longitude: pickupLoc?.longitude ?? 123.8854,
        address: pickupLoc?.street_address ?? 'Pickup',
      },
      dropoff: {
        latitude: dropoffLoc?.latitude ?? 10.3157,
        longitude: dropoffLoc?.longitude ?? 123.8854,
        address: dropoffLoc?.street_address ?? 'Drop-off',
      },
    });
    setVehicle((d as any).vehicle ?? null);

    if (d.provider_id) {
      const { data: p } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, phone_number, profile_photo')
        .eq('user_id', d.provider_id)
        .maybeSingle();
      setProvider(p);
    }

    const latest = await fetchLatestFix(deliveryId);
    if (latest) setFix(latest);

    setLoading(false);
  }, [deliveryId, isProviderMode, loadProviderStatic]);

  useEffect(() => { loadStatic(); }, [loadStatic]);

  useEffect(() => {
    if (!isProviderMode || !providerParamId) return;
    const ch = supabase
      .channel(`live-track-provider-${providerParamId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_locations', filter: `provider_id=eq.${providerParamId}` },
        (payload: any) => {
          if (payload.eventType === 'DELETE') { setFix(null); return; }
          const row = payload.new;
          if (!row) return;
          setFix({
            latitude: row.latitude,
            longitude: row.longitude,
            heading: row.heading ?? null,
            speed: row.speed ?? null,
            accuracy: row.accuracy ?? null,
            updated_at: row.updated_at,
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isProviderMode, providerParamId]);

  useEffect(() => {
    if (isProviderMode || !deliveryId) return;
    const ch = supabase
      .channel(`live-track-${deliveryId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_locations', filter: `delivery_id=eq.${deliveryId}` },
        (payload: any) => {
          if (payload.eventType === 'DELETE') { setFix(null); return; }
          const row = payload.new;
          if (!row) return;
          setFix({
            latitude: row.latitude,
            longitude: row.longitude,
            heading: row.heading ?? null,
            speed: row.speed ?? null,
            accuracy: row.accuracy ?? null,
            updated_at: row.updated_at,
          });
        },
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'deliveries', filter: `delivery_id=eq.${deliveryId}` },
        () => loadStatic())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'qr_verifications', filter: `delivery_id=eq.${deliveryId}` },
        () => loadStatic())
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [deliveryId, isProviderMode, loadStatic]);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const targetIsDropoff = isProviderMode || (!!data?.pickupVerified && !data?.completedAt);

  useEffect(() => {
    if (!data) { setRouteCoords([]); lastRouteKey.current = ''; return; }
    const target = targetIsDropoff ? data.dropoff : data.pickup;
    const origin = fix
      ? { lat: fix.latitude, lng: fix.longitude }
      : { lat: data.pickup.latitude, lng: data.pickup.longitude };

    const key = `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${target.latitude.toFixed(4)},${target.longitude.toFixed(4)}`;
    if (key === lastRouteKey.current) return;
    lastRouteKey.current = key;

    let cancelled = false;
    (async () => {
      const coords = await fetchRoadCoords(
        { lat: origin.lat, lng: origin.lng },
        { lat: target.latitude, lng: target.longitude },
      );
      if (cancelled) return;
      setRouteCoords(coords);
      setDistanceKm(polylineDistanceKm(coords));
    })();
    return () => { cancelled = true; };
  }, [data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude, fix?.latitude, fix?.longitude, targetIsDropoff]);

  useEffect(() => {
    if (!data) return;
    const key = `${targetIsDropoff}-${sheetHeight}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const pts: { latitude: number; longitude: number }[] = [
      { latitude: data.pickup.latitude, longitude: data.pickup.longitude },
      { latitude: data.dropoff.latitude, longitude: data.dropoff.longitude },
    ];
    if (fix) pts.push({ latitude: fix.latitude, longitude: fix.longitude });

    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 100, right: 60, bottom: sheetHeight + insets.bottom + 40, left: 60 },
        animated: false,
      });
    }, 150);
    return () => clearTimeout(t);
  }, [targetIsDropoff, sheetHeight, data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude, fix?.latitude, fix?.longitude]);

  const stage = timelineStage(data);
  useEffect(() => {
    if (stage === lastStageRef.current) return;
    const prev = lastStageRef.current;
    lastStageRef.current = stage;
    if (prev < 0) return;
    const msg =
      stage === 1 ? 'Courier is on the way to pickup' :
      stage === 3 ? 'Package picked up — in transit' :
      stage === 4 ? 'Delivered successfully' : null;
    if (!msg) return;
    setStageBanner(msg);
    bannerAnim.setValue(0);
    Animated.sequence([
      Animated.timing(bannerAnim, { toValue: 1, duration: 280, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
      Animated.delay(3200),
      Animated.timing(bannerAnim, { toValue: 0, duration: 280, useNativeDriver: true, easing: Easing.in(Easing.cubic) }),
    ]).start(() => setStageBanner(null));
  }, [stage, bannerAnim]);

  const recenter = () => {
    if (!data) return;
    const pts: { latitude: number; longitude: number }[] = [
      { latitude: data.pickup.latitude, longitude: data.pickup.longitude },
      { latitude: data.dropoff.latitude, longitude: data.dropoff.longitude },
    ];
    if (fix) pts.push({ latitude: fix.latitude, longitude: fix.longitude });
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 100, right: 60, bottom: sheetHeight + insets.bottom + 40, left: 60 },
      animated: true,
    });
  };

  const callProvider = () => {
    if (provider?.phone_number) Linking.openURL(`tel:${provider.phone_number}`);
  };

  const etaMinutes = useMemo(() => {
    if (data?.completedAt) return null;
    if (distanceKm == null) return null;
    return Math.max(1, Math.round((distanceKm / AVG_CITY_SPEED_KMH) * 60));
  }, [distanceKm, data?.completedAt]);

  const isStale = fix ? Date.now() - new Date(fix.updated_at).getTime() > STALE_MS : true;

  const providerName = provider
    ? `${provider.first_name ?? ''} ${provider.last_name ?? ''}`.trim() || 'Courier'
    : 'Courier';
  const initials = providerName.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'C';

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading live tracking…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const timeline = [
    { label: 'Accepted', key: 0 },
    { label: 'Heading to pickup', key: 1 },
    { label: 'Picked up', key: 2 },
    { label: 'In transit', key: 3 },
    { label: 'Delivered', key: 4 },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        googleMapId={GOOGLE_MAP_ID}
        userInterfaceStyle="light"
        initialRegion={{
          latitude: data.pickup.latitude,
          longitude: data.pickup.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <Marker
          coordinate={{ latitude: data.pickup.latitude, longitude: data.pickup.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: ORANGE, borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFF' }}>P</Text>
          </View>
        </Marker>

        <Marker
          coordinate={{ latitude: data.dropoff.latitude, longitude: data.dropoff.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#111827', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFF' }}>D</Text>
          </View>
        </Marker>

        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor={ORANGE} strokeWidth={5} />
        )}

        {fix && (
          <Marker
            coordinate={{ latitude: fix.latitude, longitude: fix.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#22C55E', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="car" size={18} color="#FFF" />
            </View>
          </Marker>
        )}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={[styles.livePill, isStale && styles.livePillStale]}>
          <View style={[styles.liveDot, { backgroundColor: isStale ? colors.warning : colors.success }]} />
          <Text style={styles.liveText}>{isStale ? 'Stale' : 'Live'}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.fab, { bottom: sheetHeight + insets.bottom + 12 }]}
        onPress={recenter}
        activeOpacity={0.85}
      >
        <Ionicons name="locate" size={20} color={ORANGE} />
      </TouchableOpacity>

      {stageBanner && (
        <Animated.View
          style={[
            styles.banner,
            {
              top: insets.top + 60,
              opacity: bannerAnim,
              transform: [{
                translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }),
              }],
            },
          ]}
        >
          <Ionicons name="notifications" size={14} color="#FFFFFF" />
          <Text style={styles.bannerText}>{stageBanner}</Text>
        </Animated.View>
      )}

      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <View style={styles.grabber} />
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>

          <View style={styles.providerRow}>
            <View style={styles.avatar}>
              {provider?.profile_photo ? (
                <Image source={{ uri: provider.profile_photo }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarText}>{initials}</Text>
              )}
              <View style={styles.verifiedDot}>
                <Ionicons name="checkmark" size={9} color="#FFFFFF" />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.providerName} numberOfLines={1}>{providerName}</Text>
              <Text style={styles.providerSub}>
                {vehicle?.vehicle_type ?? 'Courier'} · {vehicle?.plate_number ?? '—'}
              </Text>
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={callProvider} disabled={!provider?.phone_number} activeOpacity={0.85}>
              <Ionicons name="call" size={17} color={ORANGE} />
            </TouchableOpacity>
          </View>

          <View style={styles.stats}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>ETA</Text>
              <Text style={styles.statValue}>
                {data.completedAt ? 'Delivered'
                  : etaMinutes != null ? `${etaMinutes} min`
                  : '—'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>DISTANCE</Text>
              <Text style={styles.statValue}>
                {data.completedAt ? '—'
                  : distanceKm != null ? `${distanceKm.toFixed(1)} km`
                  : '—'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>STATUS</Text>
              <Text style={[styles.statValue, { color: isStale ? colors.warning : colors.success }]} numberOfLines={1}>
                {data.completedAt ? 'Done' : isStale ? 'Stale' : 'Live'}
              </Text>
            </View>
          </View>

          <Text style={styles.updated}>{formatLastSeen(fix?.updated_at)}</Text>

          {!isProviderMode && (
          <View style={styles.timeline}>
            {timeline.map((step, i) => {
              const reached = stage >= step.key;
              const current = stage === step.key;
              return (
                <View key={step.key} style={styles.tlRow}>
                  <View style={styles.tlRail}>
                    <View style={[styles.tlDot, reached && styles.tlDotOn, current && styles.tlDotCurrent]}>
                      {reached ? <Ionicons name="checkmark" size={10} color="#FFFFFF" /> : null}
                    </View>
                    {i < timeline.length - 1 && <View style={[styles.tlLine, stage > step.key && styles.tlLineOn]} />}
                  </View>
                  <Text style={[styles.tlLabel, reached && styles.tlLabelOn]}>{step.label}</Text>
                </View>
              );
            })}
          </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },

  topBar: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    zIndex: 20,
  },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.4,
    shadowRadius: 6, elevation: 4,
  },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  livePillStale: { borderColor: c.warning },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '800', color: c.textPrimary, letterSpacing: 0.4 },

  fab: {
    position: 'absolute', right: 16,
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: c.border, zIndex: 15,
  },

  banner: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.textPrimary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    zIndex: 25,
  },
  bannerText: { color: c.card, fontWeight: '700', fontSize: 12, flex: 1 },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, maxHeight: '58%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.5,
    shadowRadius: 16, elevation: 14,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 12 },

  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: isDark ? '#3A2411' : '#FFE4D2',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  verifiedDot: {
    position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, borderRadius: 8,
    backgroundColor: c.success, borderWidth: 2, borderColor: c.card,
    alignItems: 'center', justifyContent: 'center',
  },
  providerName: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  providerSub: { fontSize: 12, color: c.textSecondary, fontWeight: '600', marginTop: 1 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  stats: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.background,
    borderRadius: 14, paddingVertical: 12, marginTop: 14,
    borderWidth: 1, borderColor: c.divider,
  },
  statBox: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statLabel: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  statValue: { fontSize: 15, fontWeight: '900', color: c.textPrimary, marginTop: 4, letterSpacing: -0.2 },
  statDivider: { width: 1, height: 26, backgroundColor: c.border },

  updated: { fontSize: 11, color: c.textSecondary, fontWeight: '600', marginTop: 10, textAlign: 'center' },

  timeline: { marginTop: 18, paddingBottom: 8 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tlRail: { width: 22, alignItems: 'center' },
  tlDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: c.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  tlDotOn: { backgroundColor: ORANGE },
  tlDotCurrent: { borderWidth: 3, borderColor: isDark ? '#3A2411' : '#FFE4D2' },
  tlLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: c.border },
  tlLineOn: { backgroundColor: ORANGE },
  tlLabel: { flex: 1, fontSize: 13, fontWeight: '700', color: c.textMuted, paddingTop: 2, marginLeft: 10, paddingBottom: 18 },
  tlLabelOn: { color: c.textPrimary },
});