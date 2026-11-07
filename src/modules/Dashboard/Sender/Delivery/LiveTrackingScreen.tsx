// src/modules/Dashboard/Sender/Delivery/LiveTrackingScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image,
  StatusBar, Linking, ScrollView, Animated, Easing, Modal, Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { supabase } from '../../../../utils/supabase';
import { fetchLatestFix, ProviderFix } from '../../../../services/locationService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { MAP_PROPS } from '../../../../utils/mapConfig';
import { getNavRoute, fmtDistance, fmtDuration } from '../../../../components/map/directions';

const ORANGE = '#FF751F';
const GREEN = '#22C55E';
const STALE_MS = 45_000;
const REROUTE_MIN_MS = 15_000;      // never ask for a new route more often than this
const REROUTE_MIN_MOVE_M = 80;      // ...or before the courier moved this far
const MIN_GLIDE_MS = 600;
const MAX_GLIDE_MS = 2000;
const FRAME_MS = 33;

type LatLng = { latitude: number; longitude: number };
type PkgItem = { size: string | null; name: string; fragile: boolean };

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
  items: PkgItem[];
};

const SIZE_META: Record<string, { letter: string; kg: string; color: string; bg: string }> = {
  Small:  { letter: 'S', kg: '~5 kg',  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
  Medium: { letter: 'M', kg: '~15 kg', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  Large:  { letter: 'L', kg: '~30 kg', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
};

const STEPS = ['Accepted', 'To pickup', 'Picked up', 'To drop-off', 'Delivered'];

/** Which step is "current" (index). 5 = everything done. */
function currentStep(r: RouteData | null): number {
  if (!r || !r.acceptedAt) return 0;
  if (r.completedAt) return 5;
  if (r.pickupVerified) return 3;
  return 1;
}

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

/** One entry per package: from items_json when present, otherwise from the per-size counts. */
const buildItems = (cargo: any): PkgItem[] => {
  if (!cargo) return [];
  let arr: any = cargo.items_json;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.map((it: any) => ({
      size: it?.size ?? null,
      name: it?.description || `${it?.size || 'Standard'} package`,
      fragile: !!it?.fragile,
    }));
  }
  const out: PkgItem[] = [];
  ([['Small', cargo.small_box_qty], ['Medium', cargo.medium_box_qty], ['Large', cargo.large_box_qty]] as [string, any][])
    .forEach(([label, q]) => {
      for (let i = 0; i < (Number(q) || 0); i++) out.push({ size: label, name: `${label} package`, fragile: !!cargo.is_fragile });
    });
  return out;
};

const haversineM = (a: LatLng, b: LatLng) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

const angDiff = (to: number, from: number) => ((((to - from) % 360) + 540) % 360) - 180;
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/* -------------------------------------------------------------------------- */
/*  Courier marker: glides between GPS fixes, turns with the heading, pulses    */
/* -------------------------------------------------------------------------- */
const CourierMarker = React.memo(function CourierMarker({ fix, live }: { fix: ProviderFix; live: boolean }) {
  const focused = useIsFocused();
  const [pos, setPos] = useState<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });
  const [rot, setRot] = useState(fix.heading ?? 0);

  const cur = useRef<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });
  const from = useRef<LatLng>(cur.current);
  const to = useRef<LatLng>(cur.current);
  const startAt = useRef(0);
  const dur = useRef(MIN_GLIDE_MS);
  const lastFixAt = useRef(0);
  const want = useRef<number | null>(fix.heading ?? null);
  const rotCur = useRef(fix.heading ?? 0);
  const rotShown = useRef(fix.heading ?? 0);
  const raf = useRef<number | null>(null);
  const lastDraw = useRef(0);
  const alive = useRef(true);

  const halo = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    halo.setValue(0);
    if (!live || !focused) return;
    const loop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, focused, halo]);
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.5] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.18, 0] });

  const frame = () => {
    raf.current = null;
    if (!alive.current) return;
    const now = Date.now();
    let busy = false;

    const t = Math.min(1, (now - startAt.current) / dur.current);
    const p = {
      latitude: from.current.latitude + (to.current.latitude - from.current.latitude) * t,
      longitude: from.current.longitude + (to.current.longitude - from.current.longitude) * t,
    };
    cur.current = p;
    if (t < 1) busy = true;

    if (want.current != null) {
      const d = angDiff(want.current, rotCur.current);
      if (Math.abs(d) > 0.4) { rotCur.current = norm360(rotCur.current + d * 0.25); busy = true; }
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

  useEffect(() => {
    const now = Date.now();
    const next = { latitude: fix.latitude, longitude: fix.longitude };
    const jump = haversineM(cur.current, next);
    from.current = jump > 250 ? next : cur.current;
    to.current = next;
    const gap = lastFixAt.current ? now - lastFixAt.current : MIN_GLIDE_MS;
    dur.current = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, gap));
    startAt.current = now;
    lastFixAt.current = now;
    if (fix.heading != null && fix.heading >= 0) want.current = fix.heading;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix.latitude, fix.longitude, fix.heading]);

  return (
    <Marker coordinate={pos} anchor={{ x: 0.5, y: 0.5 }} flat rotation={rot} tracksViewChanges zIndex={10}>
      <View style={mk.courierBox}>
        <Animated.View style={[mk.courierHalo, !live && { backgroundColor: 'rgba(100,116,139,0.25)' }, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
        <View style={mk.courierDisc}>
          <View style={{ transform: [{ rotate: '-45deg' }] }}>
            <Ionicons name="navigate" size={26} color="#000000" style={{ marginLeft: -1, marginTop: 1 }} />
          </View>
        </View>
      </View>
    </Marker>
  );
});

const mk = StyleSheet.create({
  courierBox: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  courierHalo: { position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(34,197,94,0.35)' },
  courierDisc: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  pin: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
  },
  pinLetter: { fontSize: 14, fontWeight: '900', color: '#000000' },
});

const polylineDistanceKm = (coords: LatLng[]): number => {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i]);
  return total / 1000;
};

export default function LiveTrackingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
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
  const [navInfo, setNavInfo] = useState<{ distanceM: number; durationS: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(300);
  const [expanded, setExpanded] = useState(false);
  const [follow, setFollow] = useState(false);
  const [pkgOpen, setPkgOpen] = useState(false);
  const [stageBanner, setStageBanner] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const lastStageRef = useRef<number>(-1);
  const pulse = useRef(new Animated.Value(0)).current;

  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const lastRoute = useRef<{ at: number; from: LatLng | null; tKey: string }>({ at: 0, from: null, tKey: '' });
  const lastFitKey = useRef('');

  /* ------------------------------ data loading ------------------------------ */
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
      items: [],
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

    // providers who are online but have no delivery yet publish to provider_live_locations
    const { data: f } = await supabase
      .from('provider_live_locations')
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
          dropoff:locations!delivery_requests_dropoff_location_id_fkey(location_id, street_address, latitude, longitude),
          cargo:cargo_id(description, items_json, small_box_qty, medium_box_qty, large_box_qty, is_fragile)
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
    const cargo = Array.isArray(req?.cargo) ? req.cargo[0] : req?.cargo;

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
      items: buildItems(cargo),
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

  const rowToFix = (row: any): ProviderFix => ({
    latitude: row.latitude,
    longitude: row.longitude,
    heading: row.heading ?? null,
    speed: row.speed ?? null,
    accuracy: row.accuracy ?? null,
    updated_at: row.updated_at,
  });

  useEffect(() => {
    if (!isProviderMode || !providerParamId) return;
    const ch = supabase
      .channel(`live-track-provider-${providerParamId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_live_locations', filter: `provider_id=eq.${providerParamId}` },
        (payload: any) => {
          if (payload.eventType === 'DELETE') { setFix(null); return; }
          if (payload.new) setFix(rowToFix(payload.new));
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
          if (payload.new) setFix(rowToFix(payload.new));
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

  // refreshes "Updated 12s ago" and the stale check
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  /* ------------------------------ route + ETA ------------------------------ */
  const targetIsDropoff = isProviderMode || (!!data?.pickupVerified && !data?.completedAt);

  useEffect(() => {
    if (!data) { setRouteCoords([]); setNavInfo(null); lastRoute.current = { at: 0, from: null, tKey: '' }; return; }
    const target = targetIsDropoff ? data.dropoff : data.pickup;
    const origin: LatLng = fix
      ? { latitude: fix.latitude, longitude: fix.longitude }
      : { latitude: data.pickup.latitude, longitude: data.pickup.longitude };
    const tKey = `${target.latitude.toFixed(5)},${target.longitude.toFixed(5)}`;

    const lr = lastRoute.current;
    const targetChanged = lr.tKey !== tKey;
    const moved = lr.from ? haversineM(lr.from, origin) : Infinity;
    if (!targetChanged && (Date.now() - lr.at < REROUTE_MIN_MS || moved < REROUTE_MIN_MOVE_M)) return;
    lastRoute.current = { at: Date.now(), from: origin, tKey };

    let cancelled = false;
    getNavRoute(origin, { latitude: target.latitude, longitude: target.longitude }).then(r => {
      if (cancelled) return;
      setRouteCoords(r.coords);
      setNavInfo({
        distanceM: r.distanceM || polylineDistanceKm(r.coords) * 1000,
        durationS: r.durationS,
      });
    });
    return () => { cancelled = true; };
  }, [data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude, fix?.latitude, fix?.longitude, targetIsDropoff]);

  /* ------------------------------ camera ------------------------------ */
  const fitAll = useCallback((animated: boolean) => {
    if (!data) return;
    const pts: LatLng[] = [
      { latitude: data.pickup.latitude, longitude: data.pickup.longitude },
      { latitude: data.dropoff.latitude, longitude: data.dropoff.longitude },
    ];
    if (fix) pts.push({ latitude: fix.latitude, longitude: fix.longitude });
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 110, right: 60, bottom: sheetHeight + 40, left: 60 },
      animated,
    });
  }, [data, fix, sheetHeight]);

  useEffect(() => {
    if (!data || follow) return;
    const key = `${targetIsDropoff}-${sheetHeight}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const t = setTimeout(() => fitAll(false), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIsDropoff, sheetHeight, data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude, follow]);

  // "follow courier" keeps the courier in view while they drive
  useEffect(() => {
    if (!follow || !fix) return;
    mapRef.current?.animateCamera(
      { center: { latitude: fix.latitude, longitude: fix.longitude }, zoom: 16 },
      { duration: 900 },
    );
  }, [follow, fix?.latitude, fix?.longitude]);

  /* ------------------------------ stage banner ------------------------------ */
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

  const isStale = fix ? Date.now() - new Date(fix.updated_at).getTime() > STALE_MS : true;
  void tick;

  // live pill pulse - restarted whenever this screen regains focus
  useEffect(() => {
    pulse.setValue(0);
    if (isStale || !focused) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isStale, focused, pulse]);

  const callProvider = () => {
    if (provider?.phone_number) Linking.openURL(`tel:${provider.phone_number}`);
  };

  const providerName = provider
    ? `${provider.first_name ?? ''} ${provider.last_name ?? ''}`.trim() || 'Courier'
    : 'Courier';
  const initials = providerName.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'C';

  const counts = useMemo(() => {
    const c: Record<string, number> = { Small: 0, Medium: 0, Large: 0 };
    (data?.items || []).forEach(it => { if (it.size && c[it.size] != null) c[it.size] += 1; });
    return c;
  }, [data?.items]);
  const pkgTotal = data?.items.length ?? 0;

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

  const step = currentStep(data);
  const headingTo = data.completedAt ? 'Delivered' : targetIsDropoff ? 'Heading to drop-off' : 'Heading to pickup';
  const etaLabel = data.completedAt ? 'Delivered' : navInfo ? fmtDuration(navInfo.durationS) : '—';
  const arrivalClock = !data.completedAt && navInfo
    ? new Date(Date.now() + navInfo.durationS * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <MapView
        ref={mapRef}
        {...MAP_PROPS}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: data.pickup.latitude,
          longitude: data.pickup.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onPanDrag={() => { if (follow) setFollow(false); }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
      >
        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor={ORANGE} strokeWidth={6} lineCap="round" lineJoin="round" />
        )}

        <Marker
          coordinate={{ latitude: data.pickup.latitude, longitude: data.pickup.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={mk.pin}><Text style={mk.pinLetter}>P</Text></View>
        </Marker>

        <Marker
          coordinate={{ latitude: data.dropoff.latitude, longitude: data.dropoff.longitude }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={mk.pin}><Ionicons name="person" size={16} color="#000000" /></View>
        </Marker>

        {fix && <CourierMarker fix={fix} live={!isStale} />}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={[styles.livePill, isStale && styles.livePillStale]}>
          <Animated.View style={[styles.liveDot, { backgroundColor: isStale ? colors.warning : GREEN, opacity: isStale ? 1 : pulseOpacity }]} />
          <Text style={styles.liveText}>{isStale ? 'Stale' : 'Live'}</Text>
        </View>
      </View>

      <View style={[styles.fabCol, { bottom: sheetHeight + 12 }]}>
        <TouchableOpacity
          style={[styles.fab, follow && styles.fabOn]}
          onPress={() => setFollow(f => !f)}
          disabled={!fix}
          activeOpacity={0.85}
        >
          <Ionicons name="navigate" size={20} color={follow ? '#FFFFFF' : ORANGE} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={() => { setFollow(false); fitAll(true); }} activeOpacity={0.85}>
          <Ionicons name="scan" size={20} color={ORANGE} />
        </TouchableOpacity>
      </View>

      {stageBanner && (
        <Animated.View
          style={[
            styles.banner,
            {
              top: insets.top + 60,
              opacity: bannerAnim,
              transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
            },
          ]}
        >
          <Ionicons name="notifications" size={14} color="#FFFFFF" />
          <Text style={styles.bannerText}>{stageBanner}</Text>
        </Animated.View>
      )}

      <View
        style={[styles.sheet, { paddingBottom: 12 }]}
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
      >
        <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded(x => !x)} style={styles.grabberWrap} hitSlop={{ top: 8, bottom: 8 }}>
          <View style={styles.grabber} />
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} bounces={false} scrollEnabled={expanded} contentContainerStyle={{ paddingBottom: 4 }}>
          {/* step progress */}
          {!isProviderMode && (
            <View style={styles.stepper}>
              {STEPS.map((label, i) => {
                const done = i < step;
                const current = i === step;
                return (
                  <View key={label} style={styles.stepCol}>
                    <View style={styles.stepTrack}>
                      <View style={[styles.stepLine, i === 0 && { opacity: 0 }, (done || current) && styles.stepLineOn]} />
                      <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]}>
                        {done
                          ? <Ionicons name="checkmark" size={11} color="#FFFFFF" />
                          : current ? <View style={styles.stepDotCore} /> : null}
                      </View>
                      <View style={[styles.stepLine, i === STEPS.length - 1 && { opacity: 0 }, done && styles.stepLineOn]} />
                    </View>
                    <Text style={[styles.stepLabel, (done || current) && styles.stepLabelOn]} numberOfLines={2}>{label}</Text>
                  </View>
                );
              })}
            </View>
          )}

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
              <Text style={styles.providerSub} numberOfLines={1}>
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
              <Text style={[styles.statValue, { color: ORANGE }]} numberOfLines={1}>{etaLabel}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>DISTANCE</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {data.completedAt ? '—' : navInfo ? fmtDistance(navInfo.distanceM) : '—'}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>STATUS</Text>
              <Text style={[styles.statValue, { color: data.completedAt || !isStale ? colors.success : colors.warning }]} numberOfLines={1}>
                {data.completedAt ? 'Done' : isStale ? 'Stale' : 'Live'}
              </Text>
            </View>
          </View>

          <Text style={styles.updated}>
            {headingTo}{arrivalClock ? ` · arriving ${arrivalClock}` : ''} · {formatLastSeen(fix?.updated_at)}
          </Text>

          {/* package chip: quantity only, tap for sizes */}
          {!isProviderMode && pkgTotal > 0 && (
            <TouchableOpacity style={styles.pkgChip} onPress={() => setPkgOpen(true)} activeOpacity={0.85}>
              <Ionicons name="cube-outline" size={15} color={ORANGE} />
              <Text style={styles.pkgChipText}>{pkgTotal} {pkgTotal === 1 ? 'package' : 'packages'}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.pkgChipHint}>See sizes</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}

          {/* route + package details (swipe the sheet up / tap the handle) */}
          {expanded && (
            <View style={{ marginTop: 14 }}>
              <View style={styles.routeCard}>
                <View style={styles.routeRow}>
                  <View style={[styles.routePin, !targetIsDropoff && !data.completedAt && styles.routePinActive]}>
                    <Text style={mk.pinLetter}>P</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>PICKUP</Text>
                    <Text style={styles.routeAddr} numberOfLines={2}>{data.pickup.address}</Text>
                  </View>
                  {data.pickupVerified && <Ionicons name="checkmark-circle" size={18} color={colors.success} />}
                </View>
                <View style={styles.routeLink} />
                <View style={styles.routeRow}>
                  <View style={[styles.routePin, targetIsDropoff && !data.completedAt && styles.routePinActive]}>
                    <Ionicons name="person" size={14} color="#000000" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeLabel}>DROP-OFF</Text>
                    <Text style={styles.routeAddr} numberOfLines={2}>{data.dropoff.address}</Text>
                  </View>
                  {data.completedAt && <Ionicons name="checkmark-circle" size={18} color={colors.success} />}
                </View>
              </View>

              {data.items.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>YOUR PACKAGES</Text>
                  <View style={{ gap: 8 }}>
                    {data.items.map((it, i) => {
                      const meta = it.size ? SIZE_META[it.size] : null;
                      return (
                        <View key={i} style={styles.itemRow}>
                          <View style={[styles.sizeBadge, meta && { backgroundColor: meta.bg }]}>
                            <Text style={[styles.sizeBadgeText, meta && { color: meta.color }]}>{meta ? meta.letter : i + 1}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemTitle} numberOfLines={1}>
                              {data.items.length > 1 ? `Package ${i + 1}` : 'Package'}{it.size ? ` · ${it.size}` : ''}{it.fragile ? ' · Fragile' : ''}
                            </Text>
                            <Text style={styles.itemSub} numberOfLines={2}>{it.name}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      {/* package sizes pop-up */}
      <Modal visible={pkgOpen} transparent animationType="fade" onRequestClose={() => setPkgOpen(false)}>
        <Pressable style={styles.popOverlay} onPress={() => setPkgOpen(false)}>
          <Pressable style={styles.popCard} onPress={() => { /* keep open */ }}>
            <View style={styles.popHead}>
              <Text style={styles.popTitle}>{pkgTotal} {pkgTotal === 1 ? 'package' : 'packages'} in this order</Text>
              <TouchableOpacity onPress={() => setPkgOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {(['Small', 'Medium', 'Large'] as const).filter(k => counts[k] > 0).map(k => (
              <View key={k} style={styles.popRow}>
                <View style={[styles.sizeBadge, { backgroundColor: SIZE_META[k].bg }]}>
                  <Text style={[styles.sizeBadgeText, { color: SIZE_META[k].color }]}>{SIZE_META[k].letter}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.popName}>{k}</Text>
                  <Text style={styles.itemSub}>{SIZE_META[k].kg} each</Text>
                </View>
                <Text style={styles.popQty}>×{counts[k]}</Text>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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

  fabCol: { position: 'absolute', right: 16, gap: 10, zIndex: 15 },
  fab: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: c.border,
  },
  fabOn: { backgroundColor: ORANGE, borderColor: ORANGE },

  banner: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    zIndex: 25,
  },
  bannerText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, flex: 1 },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 4, maxHeight: '62%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.5,
    shadowRadius: 16, elevation: 14,
  },
  grabberWrap: { alignItems: 'center', paddingVertical: 8 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },

  /* step progress */
  stepper: { flexDirection: 'row', marginBottom: 14, marginTop: 2 },
  stepCol: { flex: 1, alignItems: 'center' },
  stepTrack: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  stepLine: { flex: 1, height: 3, backgroundColor: c.border },
  stepLineOn: { backgroundColor: ORANGE },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: c.card,
    borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  stepDotCurrent: { borderColor: ORANGE },
  stepDotCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  stepLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, marginTop: 6, textAlign: 'center' },
  stepLabelOn: { color: c.textPrimary },

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

  pkgChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    backgroundColor: c.background, borderWidth: 1, borderColor: c.divider,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  pkgChipText: { fontSize: 13, fontWeight: '800', color: c.textPrimary },
  pkgChipHint: { fontSize: 12, fontWeight: '700', color: c.textMuted },

  routeCard: { backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.divider, padding: 12 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routePin: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
  },
  routePinActive: { borderColor: ORANGE, borderWidth: 2 },
  routeLink: { width: 2, height: 14, backgroundColor: c.border, marginLeft: 13, marginVertical: 3 },
  routeLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  routeAddr: { fontSize: 14, fontWeight: '700', color: c.textPrimary, marginTop: 1 },

  sectionLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8, marginTop: 16, marginBottom: 8 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background,
    borderRadius: 12, borderWidth: 1, borderColor: c.divider, padding: 10,
  },
  itemTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  itemSub: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  sizeBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { fontSize: 15, fontWeight: '900', color: c.textSecondary },

  popOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  popCard: { backgroundColor: c.card, borderRadius: 22, padding: 20 },
  popHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  popTitle: { fontSize: 18, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.3, flex: 1, paddingRight: 8 },
  popRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: c.divider },
  popName: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  popQty: { fontSize: 20, fontWeight: '900', color: c.textPrimary },
});