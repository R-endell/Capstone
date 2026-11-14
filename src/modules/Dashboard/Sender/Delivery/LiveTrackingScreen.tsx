// src/modules/Dashboard/Sender/Delivery/LiveTrackingScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image,
  StatusBar, Linking, ScrollView, Animated, Easing, Modal, Pressable, Share,
  useWindowDimensions, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { supabase } from '../../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../../utils/chatHelpers';
import { fetchLatestFix, ProviderFix } from '../../../../services/locationService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { MAP_PROPS, BRAND_ORANGE } from '../../../../utils/mapConfig';
import { getNavRoute, fmtDuration } from '../../../../components/map/directions';
import type { NavRoute } from '../../../../components/map/directions';
import {
  OFF_ROUTE_M, REROUTE_MIN_GAP_MS, ROUTE_REFRESH_MS,
  buildRouteIndex, computeProgress, getRouteCached, remainingPath,
} from '../../../../services/navigationEngine';
import type { RouteIndex } from '../../../../services/navigationEngine';
import { SolarIcon } from '../../../../components/ui/SolarIcon';
import DraggableSheet, { DraggableSheetHandle } from '../../../../components/ui/DraggableSheet';
import { Ionicons } from '@expo/vector-icons';

const STALE_MS = 45_000;
const VEHICLE_IMG = require('../../../../../assets/sports-car.png');
const MIN_GLIDE_MS = 600;
const MAX_GLIDE_MS = 2000;
const FRAME_MS = 33;

type LatLng = { latitude: number; longitude: number };
type PkgItem = { size: string | null; name: string; fragile: boolean; photo?: string | null };

// Landmark / street / area are kept separate so the UI can always render
//   top line    = the landmark the sender picked (place_name)
//   bottom line = the street name (road), then the barangay/city
type PlaceInfo = LatLng & {
  landmark: string;
  street: string;
  area: string;
};

type RouteData = {
  deliveryId: number;
  requestId: number;
  providerId: number | null;
  acceptedAt: string | null;
  completedAt: string | null;
  estimatedEta: string | null;
  pickup: PlaceInfo;
  dropoff: PlaceInfo;
  pickupVerified: boolean;
  dropoffVerified: boolean;
  deliveryStatus: string;
  items: PkgItem[];
  providerOnWayAt?: string | null;
  providerEtaMins?: number | null;
  receiverNotified?: boolean;
  dropoffArrivedAt?: string | null;
  receiverPhone?: string | null;
};

const SIZE_META: Record<string, { letter: string; kg: string; color: string; bg: string }> = {
  Small:  { letter: 'S', kg: '~5 kg',  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
  Medium: { letter: 'M', kg: '~15 kg', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  Large:  { letter: 'L', kg: '~30 kg', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
};

function timelineStage(r: RouteData | null): number {
  if (!r) return 0;
  if (r.completedAt) return 4;
  if (r.pickupVerified) return 3;
  if (r.acceptedAt) return 1;
  return 0;
}

const buildItems = (cargo: any): PkgItem[] => {
  if (!cargo) return [];
  let arr: any = cargo.items_json;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.map((it: any) => ({
      size: it?.size ?? null,
      name: it?.description || `${it?.size || 'Standard'} package`,
      fragile: !!it?.fragile,
      photo: it?.photo ?? it?.image ?? it?.image_url ?? it?.photo_url ?? it?.picture ?? null,
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

const polylineDistanceKm = (coords: LatLng[]): number => {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1], coords[i]);
  return total / 1000;
};

// "Ouano Ave, Tipolo, Mandaue City" -> { title: "Ouano Ave", sub: "Tipolo, Mandaue City" }
const splitAddress = (a: string | null | undefined) => {
  const s = (a ?? '').trim();
  const i = s.indexOf(',');
  if (i < 0) return { title: s || '—', sub: '' };
  return { title: s.slice(0, i).trim(), sub: s.slice(i + 1).trim() };
};

const areaOf = (l: any): string =>
  [l?.barangay, l?.city, l?.province].filter(v => v && v !== 'Unknown').join(', ');

// Google Plus Codes ("8Q7X+V4", "J9X5+2V Mandaue City") and other random-looking codes are not street names.
const PLUS_CODE = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;
const isCodeLike = (t: string) => {
  const x = (t ?? '').trim();
  if (!x) return true;
  if (PLUS_CODE.test(x)) return true;
  // one "word" mixing letters and digits (ids, hashes); real street names have spaces or are plain words
  return /^[A-Za-z0-9+\-_.]{6,}$/.test(x) && /\d/.test(x) && /[A-Za-z]/.test(x);
};
const cleanAddress = (a?: string | null): string =>
  (a ?? '').replace(PLUS_CODE, '').split(',').map(p => p.trim())
    .filter(p => p && !isCodeLike(p) && !/^\d{4,6}$/.test(p)).join(', ');

/** Street name for a location row: its road, else the readable part of the address, else the barangay. */
const streetOf = (l: any, fallback: string): string => {
  const road = typeof l?.road === 'string' && !isCodeLike(l.road) ? l.road.trim() : '';
  const brgy = l?.barangay && l.barangay !== 'Unknown' ? String(l.barangay) : '';
  return road || cleanAddress(l?.street_address) || brgy || fallback;
};
/** The place name the sender picked, unless it is just a code. */
const nameOf = (l: any): string | null =>
  typeof l?.place_name === 'string' && !isCodeLike(l.place_name) ? l.place_name.trim() : null;

// Landmark on top, street (then area) underneath.
//   landmark = the place the sender picked on the location screen (place_name)
//   street   = the road name (road), else the cleaned street_address, else the barangay
const placeParts = (p: PlaceInfo) => {
  const landmark = (p.landmark || '').trim();
  const street = (p.street || '').trim();
  const area = (p.area || '').trim();

  const title = landmark || street || area || 'Selected location';
  const sub = [
    street && street !== title ? street : '',
    area && area !== title && area !== street ? area : '',
  ].filter(Boolean).join(', ');

  return { title, sub };
};

// 21:49 • 11/11/2026
const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} • ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

// Payment info — the request row stores the fare on `estimated_cost`, the
// courier payout on `base_fare`, and the refundable deposit on `return_deposit`.
// Older / alternative schemas may use the generic keys, so those are still tried.
const FARE_KEYS = [
  'estimated_cost', 'total_price', 'total_amount', 'total_fare',
  'delivery_fee', 'price', 'fare', 'amount', 'estimated_price',
  'final_price', 'agreed_price',
];
const METHOD_KEYS = ['payment_provider', 'payment_method', 'payment_type'];

type PayInfo = {
  amount: number | null;   // total charged to the sender
  base: number | null;     // amount that goes to the courier (excl. fee)
  fee: number | null;      // platform fee (15%)
  deposit: number | null;  // refundable return deposit
  method: string | null;
};

const extractPay = (row: any): PayInfo | null => {
  if (!row) return null;

  let amount: number | null = null;
  for (const k of FARE_KEYS) {
    const v = Number(row[k]);
    if (row[k] != null && isFinite(v) && v > 0) { amount = v; break; }
  }

  const depositRaw = Number(row.return_deposit);
  const deposit = isFinite(depositRaw) && depositRaw > 0 ? depositRaw : null;

  const baseRaw = Number(row.base_fare);
  const base = isFinite(baseRaw) && baseRaw > 0
    ? baseRaw
    : (amount != null ? Math.max(0, amount - (deposit ?? 0)) : null);

  const fee = base != null ? Math.round(base * 0.15 * 100) / 100 : null;

  let method: string | null = null;
  for (const k of METHOD_KEYS) {
    if (typeof row[k] === 'string' && row[k]) { method = row[k]; break; }
  }

  return amount == null && base == null && !method
    ? null
    : { amount, base, fee, deposit, method };
};

const findPhoto = (row: any): string | null => {
  if (!row) return null;
  for (const k of Object.keys(row)) {
    if (/photo|image|picture/i.test(k) && typeof row[k] === 'string' && /^https?:/.test(row[k])) return row[k];
  }
  return null;
};
const fmtPeso = (n: number) => `₱${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const CourierMarker = React.memo(function CourierMarker({ fix, live }: { fix: ProviderFix; live: boolean }) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [pos, setPos] = useState<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });

  const cur = useRef<LatLng>({ latitude: fix.latitude, longitude: fix.longitude });
  const from = useRef<LatLng>(cur.current);
  const to = useRef<LatLng>(cur.current);
  const startAt = useRef(0);
  const dur = useRef(MIN_GLIDE_MS);
  const lastFixAt = useRef(0);
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

    if (now - lastDraw.current >= FRAME_MS || !busy) {
      lastDraw.current = now;
      setPos(p);
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
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix.latitude, fix.longitude, fix.heading]);

  return (
    <Marker coordinate={pos} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges zIndex={10}>
      <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: 76, height: 76, borderRadius: 38, backgroundColor: live ? 'rgba(16,185,129,0.35)' : 'rgba(100,116,139,0.25)' }, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6 }}>
          <SolarIcon name="Car" variant="bold" size={26} color={colors.accent} />
        </View>
      </View>
    </Marker>
  );
});

type MarkerStyles = ReturnType<typeof makeMarkerStyles>;

// Same pickup / drop-off pins as the navigation map, with the street name underneath.
const PIN = 44, LABEL_H = 26, LABEL_H2 = 42, LABEL_GAP = 6;
const PlaceMarker = React.memo(function PlaceMarker({
  lat, lng, title, street, kind, mk,
}: { lat: number; lng: number; title: string; street?: string; kind: 'pickup' | 'dropoff'; mk: MarkerStyles }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 700);
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
        {kind === 'pickup' ? (
          <View style={mk.pickPin}><Ionicons name="cube" size={20} color="#FFFFFF" /></View>
        ) : (
          <View style={mk.dropPin}><Ionicons name="person" size={26} color="#000000" /></View>
        )}
        <View style={mk.labelPill}>
          <Text style={mk.labelText} numberOfLines={1}>{title}</Text>
          {!!street && <Text style={mk.labelSub} numberOfLines={1}>{street}</Text>}
        </View>
      </View>
    </Marker>
  );
});

export default function LiveTrackingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const mk = useMemo(() => makeMarkerStyles(colors), [colors]);

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
  const [tick, setTick] = useState(0);
  const { height: winH } = useWindowDimensions();
  const sheetHeight = Math.round(winH * 0.44);
  const expandedH = Math.round(winH * 0.9);
  const collapsedY = expandedH - sheetHeight;

  const sheetY = useRef(new Animated.Value(collapsedY)).current;
  const sheetRef = useRef<DraggableSheetHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const [pay, setPay] = useState<PayInfo | null>(null);
  const [pkgPhoto, setPkgPhoto] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);

  const [photoView, setPhotoView] = useState<string | null>(null);
  const [stageBanner, setStageBanner] = useState<string | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const lastStageRef = useRef<number>(-1);

  const [navRoute, setNavRoute] = useState<{ r: NavRoute; idx: RouteIndex; tKey: string } | null>(null);
  const [fullRoute, setFullRoute] = useState<LatLng[]>([]);
  const reqSeq = useRef(0);
  const inflightKey = useRef<string | null>(null);
  const lastReqAt = useRef(0);
  const offCount = useRef(0);
  const alongRef = useRef<number | undefined>(undefined);
  const routeFromMe = useRef(false);
  const lastFitKey = useRef('');

  // Open (or create) the chat room for this delivery and jump straight to it in Messages.
  const handleMessageProvider = useCallback(async () => {
    if (openingChat) return;
    if (isProviderMode || !data?.deliveryId) {
      Alert.alert(
        'Please wait',
        'Chat becomes available as soon as the courier accepts your request.',
      );
      return;
    }
    try {
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(data.deliveryId);
      if (!roomId) {
        Alert.alert('Error', 'Could not open chat.');
        return;
      }

      // Prefer an existing Messages/Inbox route anywhere in the navigation tree.
      let current: any = navigation;
      while (current) {
        try {
          const names: string[] = current.getState?.()?.routeNames || [];
          const match = names.find(n => /message|chat|inbox/i.test(n));
          if (match) {
            current.navigate(match, { openRoomId: roomId });
            return;
          }
        } catch { /* ignore and keep walking up */ }
        current = current.getParent?.();
      }
      // Fallback: route through the main tabs.
      navigation.navigate('MainTabs', {
        screen: 'Messages',
        params: { openRoomId: roomId },
      });
    } catch (e) {
      console.warn('[LiveTracking] open chat failed:', e);
      Alert.alert('Error', 'Could not open chat.');
    } finally {
      setOpeningChat(false);
    }
  }, [data?.deliveryId, isProviderMode, openingChat, navigation]);

  const loadProviderStatic = useCallback(async () => {
    if (!providerParamId) return;

    let q = supabase
      .from('provider_routes')
      .select(`
        route_id, provider_id,
        start_location:locations!provider_routes_start_location_id_fkey ( street_address, latitude, longitude, road, barangay, city, province, place_name ),
        end_location:locations!provider_routes_end_location_id_fkey ( street_address, latitude, longitude, road, barangay, city, province, place_name ),
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
        landmark: nameOf(start) ?? '',
        street: streetOf(start, 'Route start'),
        area: areaOf(start),
      },
      dropoff: {
        latitude: Number(end?.latitude) || 10.3157,
        longitude: Number(end?.longitude) || 123.8854,
        landmark: nameOf(end) ?? '',
        street: streetOf(end, 'Destination'),
        area: areaOf(end),
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
        provider_on_way_at, provider_eta_mins, receiver_notified, dropoff_arrived_at,
        vehicle:vehicles(vehicle_id, vehicle_type, plate_number, max_weight_kg),
        request:delivery_requests(
          request_id, delivery_status, receiver_phone,
          pickup:locations!delivery_requests_pickup_location_id_fkey(*),
          dropoff:locations!delivery_requests_dropoff_location_id_fkey(*),
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
        landmark: nameOf(pickupLoc) ?? '',
        street: streetOf(pickupLoc, 'Pickup'),
        area: areaOf(pickupLoc),
      },
      dropoff: {
        latitude: dropoffLoc?.latitude ?? 10.3157,
        longitude: dropoffLoc?.longitude ?? 123.8854,
        landmark: nameOf(dropoffLoc) ?? '',
        street: streetOf(dropoffLoc, 'Drop-off'),
        area: areaOf(dropoffLoc),
      },
      providerOnWayAt: (d as any).provider_on_way_at ?? null,
      providerEtaMins: (d as any).provider_eta_mins ?? null,
      receiverNotified: !!(d as any).receiver_notified,
      dropoffArrivedAt: (d as any).dropoff_arrived_at ?? null,
      receiverPhone: req?.receiver_phone ?? null,
    });
    setVehicle((d as any).vehicle ?? null);

    try {
      const { data: full } = await supabase
        .from('delivery_requests').select('*').eq('request_id', d.request_id).maybeSingle();
      setPay(extractPay(full));
      setPkgPhoto(findPhoto(full));
    } catch { /* payment info is optional */ }

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

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const targetIsDropoff = isProviderMode || (!!data?.pickupVerified && !data?.completedAt);

  const navTarget = data ? (targetIsDropoff ? data.dropoff : data.pickup) : null;
  const tKey = navTarget ? `${navTarget.latitude.toFixed(5)},${navTarget.longitude.toFixed(5)}` : '';
  const me = useMemo<LatLng | null>(
    () => (fix ? { latitude: fix.latitude, longitude: fix.longitude } : null),
    [fix],
  );

  const requestRoute = useCallback((from: LatLng, to: LatLng, key: string, fromMe: boolean) => {
    const seq = ++reqSeq.current;
    inflightKey.current = key;
    lastReqAt.current = Date.now();
    routeFromMe.current = fromMe;
    getRouteCached(from, to).then(r => {
      if (seq !== reqSeq.current) return;
      alongRef.current = undefined;
      offCount.current = 0;
      setNavRoute({ r, idx: buildRouteIndex(r), tKey: key });
    }).catch(() => { /* keep the last route */ }).finally(() => {
      if (seq === reqSeq.current) inflightKey.current = null;
    });
  }, []);
  useEffect(() => () => { reqSeq.current++; }, []);

  const progress = useMemo(() => {
    if (!me || !navRoute || navRoute.tKey !== tKey) return null;
    return computeProgress(navRoute.r, navRoute.idx, me, alongRef.current);
  }, [me, navRoute, tKey]);
  useEffect(() => { alongRef.current = progress?.along; }, [progress]);

  useEffect(() => {
    if (!data || !navTarget || data.completedAt) return;
    const to = { latitude: navTarget.latitude, longitude: navTarget.longitude };
    const origin: LatLng = me ?? { latitude: data.pickup.latitude, longitude: data.pickup.longitude };
    if (navRoute?.tKey !== tKey) {
      if (inflightKey.current !== tKey) requestRoute(origin, to, tKey, !!me);
      return;
    }
    if (inflightKey.current === tKey) return;
    const now = Date.now();
    if (me && !routeFromMe.current) { requestRoute(me, to, tKey, true); return; }
    if (progress && progress.offRouteM > OFF_ROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 2 && now - lastReqAt.current > REROUTE_MIN_GAP_MS) requestRoute(origin, to, tKey, !!me);
      return;
    }
    offCount.current = 0;
    if (me && now - lastReqAt.current > ROUTE_REFRESH_MS) requestRoute(origin, to, tKey, true);
  }, [data, navTarget, me, tKey, navRoute, progress, requestRoute]);

  const linePts = useMemo(() => {
    if (!navRoute || navRoute.tKey !== tKey || navRoute.r.coords.length < 2) return null;
    if (progress && me && navRoute.r.source !== 'straight') return remainingPath(navRoute.r, navRoute.idx, progress.along, me);
    return navRoute.r.coords;
  }, [navRoute, tKey, progress, me]);

  const liveM = me && navTarget ? haversineM(me, navTarget) : null;
  const closeBy = liveM != null && liveM < 150;
  const distanceM: number | null = progress ? (closeBy ? liveM : progress.remainingM) : null;
  const durationS: number | null = progress
    ? (progress.remainingM > 0 && distanceM != null ? progress.remainingS * Math.min(1, distanceM / progress.remainingM) : 0)
    : null;

  useEffect(() => {
    if (!data) { setFullRoute([]); return; }
    let cancelled = false;
    getNavRoute(
      { latitude: data.pickup.latitude, longitude: data.pickup.longitude },
      { latitude: data.dropoff.latitude, longitude: data.dropoff.longitude },
    ).then(r => { if (!cancelled) setFullRoute(r.coords); }).catch(() => {});
    return () => { cancelled = true; };
  }, [data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude]);

  const fitAll = useCallback((animated: boolean) => {
    if (!data) return;
    const pts: LatLng[] = [
      { latitude: data.pickup.latitude, longitude: data.pickup.longitude },
      { latitude: data.dropoff.latitude, longitude: data.dropoff.longitude },
    ];
    if (fix) pts.push({ latitude: fix.latitude, longitude: fix.longitude });
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: 110, right: 60, bottom: sheetHeight + 70, left: 60 },
      animated,
    });
  }, [data, fix, sheetHeight]);

  useEffect(() => {
    if (!data) return;
    const key = `${targetIsDropoff}-${sheetHeight}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const t = setTimeout(() => fitAll(false), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIsDropoff, sheetHeight, data?.pickup.latitude, data?.pickup.longitude, data?.dropoff.latitude, data?.dropoff.longitude]);

  const stage = timelineStage(data);
  useEffect(() => {
    if (stage === lastStageRef.current) return;
    const prev = lastStageRef.current;
    lastStageRef.current = stage;
    if (prev < 0) return;
    const msg =
      stage === 1 ? 'Provider is on the way to pickup' :
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

  const callProvider = () => {
    if (provider?.phone_number) Linking.openURL(`tel:${provider.phone_number}`);
  };

  const providerName = provider
    ? `${provider.first_name ?? ''} ${provider.last_name ?? ''}`.trim() || 'Provider'
    : 'Provider';
  const initials = providerName.split(' ').filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'C';

  const pkgTotal = data?.items.length ?? 0;

  if (loading || !data) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading live tracking…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const etaLabel = data.completedAt ? 'Delivered' : durationS != null ? fmtDuration(durationS) : '—';
  const hasEta = etaLabel !== '—' && !data.completedAt;

  const plate = vehicle?.plate_number || null;
  const pu = placeParts(data.pickup);
  const dr = placeParts(data.dropoff);
  const routeKm = fullRoute.length > 1 ? `${polylineDistanceKm(fullRoute).toFixed(2)} km` : null;
  const statusText = data.completedAt ? 'Delivered' : isStale ? 'Waiting for GPS' : 'Live';

  const onShare = async () => {
    try {
      await Share.share({
        message:
          `Pack-N-Ship delivery${plate ? ` · provider ${plate}` : ''}\n` +
          `From: ${[pu.title, pu.sub].filter(Boolean).join(', ')}\nTo: ${[dr.title, dr.sub].filter(Boolean).join(', ')}\n` +
          `Status: ${statusText}${hasEta ? ` · ETA ${etaLabel}` : ''}` +
          (pay?.amount != null ? `\nTotal pay: ${fmtPeso(pay.amount)}` : ''),
      });
    } catch { /* user dismissed */ }
  };

  const kv = (label: string, value: string, color?: string) => (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, color ? { color } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <MapView
        ref={mapRef}
        {...MAP_PROPS}
        userInterfaceStyle="light"
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: data.pickup.latitude,
          longitude: data.pickup.longitude,
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
        {fullRoute.length > 1 && (
          <Polyline coordinates={fullRoute} strokeColor="#94A3B8" strokeWidth={6} lineCap="round" lineJoin="round" />
        )}
        {linePts && linePts.length > 1 && (
          <Polyline coordinates={linePts} strokeColor={colors.accent} strokeWidth={6} lineCap="round" lineJoin="round" />
        )}

        <PlaceMarker
          lat={data.pickup.latitude}
          lng={data.pickup.longitude}
          title={pu.title}
          street={pu.sub}
          kind="pickup"
          mk={mk}
        />
        <PlaceMarker
          lat={data.dropoff.latitude}
          lng={data.dropoff.longitude}
          title={dr.title}
          street={dr.sub}
          kind="dropoff"
          mk={mk}
        />

        {fix && <CourierMarker fix={fix} live={!isStale} />}
      </MapView>

      <View style={[styles.topBar, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.circleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={18} color={colors.textPrimary} />
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
          <SolarIcon name="Bell" variant="bold" size={14} color="#FFFFFF" />
          <Text style={styles.bannerText}>{stageBanner}</Text>
        </Animated.View>
      )}

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
          {data.completedAt ? (
            <Text style={styles.headline}>
              Delivered! <Text style={styles.headlineAccent}>Your package has arrived</Text>
            </Text>
          ) : isProviderMode ? (
            <Text style={styles.headline}>
              Provider is <Text style={styles.headlineAccent}>on the road</Text>
              {hasEta ? <Text> · arriving in <Text style={styles.headlineAccent}>{etaLabel}</Text></Text> : null}
            </Text>
          ) : targetIsDropoff ? (
            <Text style={styles.headline}>
              Your package is on the way{hasEta ? <Text> · arriving in <Text style={styles.headlineAccent}>{etaLabel}</Text></Text> : null}
            </Text>
          ) : (
            <Text style={styles.headline}>
              Provider{plate ? <Text style={styles.headlineAccent}> {plate}</Text> : null} will pick up your package{hasEta ? <Text> in <Text style={styles.headlineAccent}>{etaLabel}</Text></Text> : null}
            </Text>
          )}

          </View>
        )}
      >
          {/* Provider card */}
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.profileRow}>
                <View style={styles.avatar}>
                  {provider?.profile_photo ? (
                    <Image source={{ uri: provider.profile_photo }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{initials}</Text>
                  )}
                </View>
                <Image source={VEHICLE_IMG} style={styles.vehicleImg} resizeMode="contain" />
              </View>

              <View style={styles.rightBlock}>
                {!!plate && (
                  <View style={styles.plateBox}>
                    <Text style={styles.plateText}>{plate}</Text>
                  </View>
                )}
                <Text style={styles.vehicleSub} numberOfLines={1}>
                  {vehicle?.vehicle_type ? String(vehicle.vehicle_type).toUpperCase() : 'VEHICLE'}
                </Text>
              </View>
            </View>

            <Text style={styles.driverName} numberOfLines={1}>{providerName}</Text>

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={handleMessageProvider}
                disabled={openingChat}
                activeOpacity={0.7}
              >
                {openingChat ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
                )}
                <Text style={styles.messageText} numberOfLines={1}>
                  {openingChat ? 'Opening chat…' : 'Message the provider'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.iconBtn} onPress={callProvider} disabled={!provider?.phone_number} activeOpacity={0.7}>
                <Ionicons name="call" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareRow}>
              <View style={styles.shareLeft}>
                <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.shareText}>Share delivery details</Text>
              </View>
              <TouchableOpacity activeOpacity={0.7} onPress={onShare} hitSlop={10}>
                <Text style={styles.shareBtn}>Share</Text>
              </TouchableOpacity>
            </View>

            {!!pay && (
              <>
                <View style={styles.cardDivider} />
                <View style={styles.payRow}>
                  <View style={styles.payIcon}>
                    <Ionicons name="cash-outline" size={22} color={colors.textPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle}>Total pay</Text>
                    {!!pay.method && <Text style={styles.paySub}>{pay.method}</Text>}
                  </View>
                  {pay.amount != null && <Text style={styles.payAmount}>{fmtPeso(pay.amount)}</Text>}
                </View>
              </>
            )}
          </View>

          {/* Details — revealed by scrolling the sheet up */}
            <>
              <View style={styles.card}>
                {!isProviderMode && data.deliveryId > 0 && kv('Pack-N-Ship ID', `#${data.deliveryId}`)}
                {!!data.acceptedAt && kv('Accepted', fmtDateTime(data.acceptedAt))}

                {!!pay && pay.amount != null && (
                  <>
                    <View style={styles.cardDivider} />
                    {pay.base != null && kv('Courier payout', fmtPeso(pay.base))}
                    {pay.fee != null && kv('Platform fee (15%)', fmtPeso(pay.fee))}
                    {pay.deposit != null && kv('Return deposit (refundable)', fmtPeso(pay.deposit))}
                    {!!pay.method && kv('Paid via', pay.method)}
                  </>
                )}

                <View style={styles.tlRow}>
                  <View style={styles.tlRail}>
                    <View style={styles.tlPickIcon}><Ionicons name="cube" size={16} color="#FFFFFF" /></View>
                    <View style={styles.tlLine} />
                  </View>
                  <View style={styles.tlBody}>
                    <Text style={styles.tlTitle} numberOfLines={1}>{pu.title}</Text>
                    {!!pu.sub && <Text style={styles.tlSub} numberOfLines={2}>{pu.sub}</Text>}
                  </View>
                  {data.pickupVerified && <SolarIcon name="CheckCircle" variant="duotone" size={18} color={colors.success} />}
                </View>

                <View style={styles.tlRow}>
                  <View style={styles.tlRail}>
                    <View style={styles.tlDropIcon}><Ionicons name="person" size={18} color="#000000" /></View>
                  </View>
                  <View style={styles.tlBody}>
                    <Text style={styles.tlTitle} numberOfLines={1}>{dr.title}</Text>
                    {(!!routeKm || !!dr.sub) && (
                      <Text style={styles.tlSub} numberOfLines={2}>
                        {routeKm ? `${routeKm}${dr.sub ? ' • ' : ''}` : ''}{dr.sub}
                      </Text>
                    )}
                  </View>
                  {data.completedAt && <SolarIcon name="CheckCircle" variant="duotone" size={18} color={colors.success} />}
                </View>
              </View>

              {pkgTotal > 0 && (
                <View style={styles.card}>
                  <Text style={styles.pkgHeader}>PACKAGES · {pkgTotal}</Text>

                  <View style={{ gap: 8 }}>
                    {data.items.map((it, i) => {
                      const meta = it.size ? SIZE_META[it.size] : null;
                      return (
                        <View key={i} style={styles.itemRow}>
                          {(it.photo || pkgPhoto) ? (
                            <TouchableOpacity activeOpacity={0.85} onPress={() => setPhotoView((it.photo || pkgPhoto) as string)}>
                              <Image source={{ uri: (it.photo || pkgPhoto) as string }} style={styles.itemPhoto} />
                            </TouchableOpacity>
                          ) : (
                            <View style={[styles.itemPhoto, styles.itemPhotoEmpty]}>
                              <SolarIcon name="Package" variant="linear" size={24} color={colors.textMuted} />
                            </View>
                          )}
                          <View style={{ flex: 1 }}>
                            <Text style={styles.itemTitle} numberOfLines={1}>
                              {data.items.length > 1 ? `Package ${i + 1}` : 'Package'}{it.fragile ? ' · Fragile' : ''}
                            </Text>
                            <Text style={styles.itemSub} numberOfLines={2}>{it.name}</Text>
                          </View>
                          <View style={[styles.sizeBadge, meta && { backgroundColor: meta.bg }]}>
                            <Text style={[styles.sizeBadgeText, meta && { color: meta.color }]}>{meta ? meta.letter : i + 1}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </>
      </DraggableSheet>

      <Modal visible={!!photoView} transparent animationType="fade" onRequestClose={() => setPhotoView(null)}>
        <Pressable style={styles.viewerOverlay} onPress={() => setPhotoView(null)}>
          {!!photoView && <Image source={{ uri: photoView }} style={styles.viewerImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.viewerClose, { top: insets.top + 12 }]} onPress={() => setPhotoView(null)} hitSlop={10}>
            <SolarIcon name="CloseCircle" variant="linear" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeMarkerStyles = (c: ThemeColors) => StyleSheet.create({
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
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    loadingText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },

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

    banner: {
      position: 'absolute', left: 16, right: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
      zIndex: 25,
    },
    bannerText: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', fontSize: 12, flex: 1 },

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
    cardDivider: { height: 1, backgroundColor: c.border, marginVertical: 12 },

    cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    profileRow: { flexDirection: 'row', alignItems: 'center' },
    avatar: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: c.success,
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginRight: 4,
    },
    vehicleImg: { width: 92, height: 54, marginLeft: -8 },
    avatarImg: { width: '100%', height: '100%' },
    avatarText: { color: '#FFFFFF', fontFamily: 'Poppins_800ExtraBold', fontSize: 18 },
    rightBlock: { alignItems: 'flex-end', flex: 1 },
    plateBox: {
      backgroundColor: '#1F2937', paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 8, marginBottom: 8,
    },
    plateText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Poppins_700Bold', letterSpacing: 0.6 },
    vehicleSub: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary },

    driverName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 14, marginBottom: 14 },

    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    messageBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.background, paddingHorizontal: 14, height: 48, borderRadius: 24,
    },
    messageText: { flex: 1, fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textMuted },
    iconBtn: {
      width: 48, height: 48, borderRadius: 24, backgroundColor: c.background,
      alignItems: 'center', justifyContent: 'center',
    },

    shareRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border,
    },
    shareLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    shareText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    shareBtn: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.accent },

    kvRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, gap: 12 },
    kvLabel: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    kvValue: { fontSize: 14, fontFamily: 'Poppins_500Medium', color: c.textSecondary, flexShrink: 1, textAlign: 'right' },

    tlRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
    tlRail: { width: 34, alignItems: 'center' },
    tlPickIcon: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND_ORANGE,
      alignItems: 'center', justifyContent: 'center',
    },
    tlDropIcon: {
      width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF',
      borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
    },
    tlLine: { flex: 1, width: 2, backgroundColor: c.border, marginTop: 4, marginBottom: -8 },
    tlBody: { flex: 1, paddingBottom: 14 },
    tlTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    tlSub: { fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },

    payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    payIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
    payTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    paySub: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
    payAmount: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary },

    noteBox: { marginTop: 10, backgroundColor: c.infoSoft, borderRadius: 14, padding: 14 },
    noteText: { fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_500Medium', color: c.info },

    pkgHeader: { fontSize: 11, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8, marginBottom: 12 },
    viewerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    viewerImg: { width: '100%', height: '78%' },
    viewerClose: { position: 'absolute', right: 16 },
    itemRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.background,
      borderRadius: 14, borderWidth: 1, borderColor: hair, padding: 8,
    },
    itemPhoto: { width: 56, height: 56, borderRadius: 12, backgroundColor: c.divider },
    itemPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
    itemTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    itemSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 1 },
    sizeBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },
    sizeBadgeText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  });
};