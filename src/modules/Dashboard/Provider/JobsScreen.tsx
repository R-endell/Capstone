// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Platform, Modal, Alert, ActivityIndicator, ScrollView,
  Animated, Easing, Linking, StatusBar, FlatList, Pressable, Dimensions,
  TextInput, Keyboard, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import {
  getActiveRouteId,
  setActiveRouteId,
  subscribeActiveRoute,
  getDemoMode,
  setDemoMode,
  subscribeDemoMode,
} from '../../../services/activeRouteStore';
import { evaluateAndFetchRouteMatches, computeCargoVolumeLiters, RouteMatchRow } from '../../../services/matchingService';
import { createProviderRouteWithGuardrails, getTodayRouteStats } from '../../../services/routeService';
import { notifyUser } from '../../../services/pushService';
import NotificationsList from '../Disputes/NotificationsList';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { routeNotification, NotifRow } from '../../../utils/notifRouter';
import { MAP_PROPS } from '../../../utils/mapConfig';
import { setTabBarHidden } from '../../../services/tabBarVisibilityStore';
import { isRouteExpired } from './Manage/ManageRoutesScreen';
import { useProviderTermsGate } from '../../../components/ProviderTermsModal';

const ORANGE = '#FF751F';
const GREEN = '#10B981';
const BLUE = '#3B82F6';
const RED = '#EF4444';
const PURPLE = '#8B5CF6';
const BLACK = '#111827';
const OFFER_SECONDS = 45;
const CARGO_PHOTO_BUCKET = 'cargo-photos';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'] as const;
type Frequency = typeof FREQUENCIES[number];

const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 6;
const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;
const NEARBY_RADIUS_M = 200;
const LABEL_SNAP_M = 60;
const REJECTED_PLACE_TYPES = new Set(['route', 'street_address', 'postal_code', 'plus_code']);

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_API_KEY = GOOGLE_MAPS_API_KEY.length > 10;

interface Location {
  location_id?: number;
  street_address: string;
  barangay: string;
  city: string;
  province: string;
  zip_code: string;
  latitude: number;
  longitude: number;
}
interface Vehicle {
  vehicle_id: number;
  vehicle_type: string;
  plate_number: string;
  max_volume_liters: number;
  max_weight_kg: number;
  verification_status: string;
}
interface Route {
  route_id: number;
  departure_time: string;
  end_time?: string | null;
  route_frequency: string;
  route_distance_km?: number;
  remaining_weight_kg?: number;
  remaining_volume_liters?: number;
  fallback_unlocked?: boolean;
  fallback_reason?: 'CONDITION_A' | 'CONDITION_B' | null;
  fallback_used?: boolean;
  admin_review_flag?: boolean;
  is_deleted?: boolean;
  is_active?: boolean;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location?: Location;
  end_location?: Location;
  vehicle?: Vehicle;
}

interface JobItem {
  description: string;
  size: string | null;
  fragile: boolean;
  photo: string | null;
  localOnly?: boolean;
  boxes: string | null;
}
interface JobPlace {
  main: string;
  sub: string;
  lat: number | null;
  lng: number | null;
}
interface JobRequest {
  request_id: number;
  pickup_type: string;
  scheduled_time: string | null;
  created_at: string | null;
  estimated_cost: number;
  pickup: JobPlace;
  dropoff: JobPlace;
  pickupNote: string | null;
  dropoffNote: string | null;
  items: JobItem[];
  totalItems: number;
  sizeSummary: string;
  weightKg: number | null;
  fragile: boolean;
  dims: string | null;
  senderName: string;
  receiverName: string | null;
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  isDirectRequest?: boolean;
  matchScore?: number;
  isFallback?: boolean;
  fallbackType?: 'CONDITION_A' | 'CONDITION_B' | null;
  pickupDistM?: number;
  dropoffDistM?: number;
  matchId?: number;
}

type Notif = NotifRow;
type Coord = { latitude: number; longitude: number };
type RecentEntry = { name: string; address: string; latitude: number; longitude: number; ts: number };
type SearchResult = {
  place_id: string; name: string; formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};
type NearbyPlace = { id: string; name: string; address: string; latitude: number; longitude: number; dist: number };
type Label = { name: string; sub?: string };

const parseNaiveIsoString = (s: string): Date => {
  if (!s) return new Date();
  const parts = s.split(/[-T:+Z]/);
  if (parts.length < 5) return new Date();
  return new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
    parseInt(parts[3], 10),
    parseInt(parts[4], 10),
  );
};

const nextWeekday = (weekday: number, from = new Date()): Date => {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
};

const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

const money = (n: any) => `₱${Number(n || 0).toFixed(2)}`;
const requestCode = (id: number) => `PNS-${String(id).padStart(4, '0')}`;
const serviceLabel = (t?: string | null) => (/door/i.test(String(t || '')) ? 'Door-to-Door' : 'Curb-side');

const isLocalPhoto = (v: any) => typeof v === 'string' && /^(file|content):/i.test(v);

const toPhotoUrl = (v: any): string | null => {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(file|content):/i.test(v)) return null;
  try {
    return supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(v.replace(/^\/+/, '')).data.publicUrl;
  } catch { return null; }
};

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected Location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

const whenLabel = (r: JobRequest) => {
  if (r.scheduled_time) {
    const d = parseNaiveIsoString(String(r.scheduled_time).replace(' ', 'T'));
    return `Scheduled · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  const d = r.created_at ? new Date(r.created_at) : new Date();
  return `Requested · ${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
};

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const roadKm = (aLat: number, aLng: number, bLat: number, bLng: number) => haversineKm(aLat, aLng, bLat, bLng) * 1.3;

const metersBetween = (a: Coord, b: Coord) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(1)} km`);

const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const iconForType = (type: string): keyof typeof Ionicons.glyphMap => {
  const t = (type || '').toLowerCase();
  if (t.startsWith('dispute')) return 'shield-checkmark-outline';
  if (t.startsWith('delivery') || t.includes('route')) return 'cube-outline';
  if (t === 'match') return 'flash-outline';
  if (t.startsWith('message') || t.startsWith('chat')) return 'chatbubble-ellipses-outline';
  if (t.startsWith('support')) return 'chatbubble-ellipses-outline';
  if (t === 'payment' || t === 'escrow') return 'card-outline';
  return 'notifications-outline';
};

const titleForType = (type: string, fallback: string): string => {
  const t = (type || '').toLowerCase();
  if (t === 'match') return 'New Delivery Match';
  if (t.includes('direct')) return 'Direct Route Request';
  if (t.startsWith('delivery')) return 'Delivery Update';
  if (t.startsWith('message') || t.startsWith('chat')) return 'New Message';
  if (t.startsWith('dispute')) return 'Dispute Update';
  if (t.startsWith('support')) return 'Pack-N-Ship';
  if (t === 'payment' || t === 'escrow') return 'Payment Update';
  return fallback;
};

const summarizeSizes = (sizes: (string | null | undefined)[]): string => {
  const counts: Record<string, number> = {};
  sizes.forEach(z => { if (z) counts[z] = (counts[z] || 0) + 1; });
  return ['Small', 'Medium', 'Large']
    .filter(k => counts[k])
    .map(k => `${counts[k]} ${k}`)
    .join(' · ');
};

const normalizeMatchRow = (m: RouteMatchRow, senders: Record<number, string>, currentProviderId?: number | null): JobRequest => {
  const r = m.request;
  const cargo = Array.isArray(r.cargo) ? r.cargo[0] : r.cargo;

  let itemsJson: any = cargo?.items_json;
  if (typeof itemsJson === 'string') {
    try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
  }

  const sizeCounts: [string, any][] = [
    ['Small', cargo?.small_box_qty], ['Medium', cargo?.medium_box_qty], ['Large', cargo?.large_box_qty],
  ];
  const boxes = sizeCounts.filter(([, q]) => Number(q) > 0).map(([l, q]) => `${l} ×${q}`).join(' · ');
  const boxTotal = sizeCounts.reduce((s, [, q]) => s + (Number(q) || 0), 0);

  let items: JobItem[];
  if (Array.isArray(itemsJson) && itemsJson.length > 0) {
    items = itemsJson.map((it: any) => ({
      description: it?.description || `${it?.size || 'Standard'} package`,
      size: it?.size ?? null,
      fragile: !!it?.fragile,
      photo: toPhotoUrl(it?.photo),
      localOnly: isLocalPhoto(it?.photo),
      boxes: null,
    }));
    const fallbackPhoto = toPhotoUrl(cargo?.cargo_pic);
    if (fallbackPhoto && !items.some(i => i.photo)) items[0].photo = fallbackPhoto;
    if (isLocalPhoto(cargo?.cargo_pic) && !items.some(i => i.photo)) items[0].localOnly = true;
  } else {
    items = [{
      description: cargo?.description || 'Package',
      size: null,
      fragile: !!cargo?.is_fragile,
      photo: toPhotoUrl(cargo?.cargo_pic),
      localOnly: isLocalPhoto(cargo?.cargo_pic),
      boxes: boxes || null,
    }];
  }

  const d = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const dims = d.every(v => Number(v) > 0) ? `${d[0]} × ${d[1]} × ${d[2]} cm` : null;
  const pu = splitAddress(r.pickup_location?.street_address);
  const dr = splitAddress(r.dropoff_location?.street_address);

  const prefProviderId = r.preferred_provider_id != null ? Number(r.preferred_provider_id) : null;
  const isDirectRequest =
    prefProviderId != null &&
    currentProviderId != null &&
    prefProviderId === Number(currentProviderId);

  return {
    request_id: r.request_id,
    pickup_type: r.pickup_type,
    scheduled_time: r.scheduled_time ?? null,
    created_at: r.created_at ?? null,
    estimated_cost: Number(r.estimated_cost) || 0,
    pickup: { ...pu, lat: r.pickup_location?.latitude ?? null, lng: r.pickup_location?.longitude ?? null },
    dropoff: { ...dr, lat: r.dropoff_location?.latitude ?? null, lng: r.dropoff_location?.longitude ?? null },
    pickupNote: r.pickup_note || null,
    dropoffNote: r.dropoff_note || null,
    items,
    totalItems: Array.isArray(itemsJson) && itemsJson.length > 0 ? itemsJson.length : (boxTotal || 1),
    sizeSummary: Array.isArray(itemsJson) && itemsJson.length > 0
      ? summarizeSizes(items.map(i => i.size))
      : sizeCounts.filter(([, q]) => Number(q) > 0).map(([l, q]) => `${q} ${l}`).join(' · '),
    weightKg: Number(cargo?.total_weight_kg) || null,
    fragile: items.some(i => i.fragile) || !!cargo?.is_fragile,
    dims,
    senderName: senders[r.sender_id] || 'Sender',
    receiverName: r.receiver?.receiver_name || [r.receiver?.first_name, r.receiver?.last_name].filter(Boolean).join(' ') || null,
    preferred_provider_id: prefProviderId,
    preferred_route_id: r.preferred_route_id ?? m.route_id ?? null,
    isDirectRequest,
    matchScore: m.match_score,
    isFallback: m.is_fallback,
    fallbackType: m.fallback_type,
    pickupDistM: m.pickup_dist_m,
    dropoffDistM: m.dropoff_dist_m,
    matchId: m.match_id,
  };
};

/* ==================================================================== */
/* Map helpers                                                          */
/* ==================================================================== */
const DEFAULT_CENTER = { latitude: 10.3157, longitude: 123.8854 };

const mapStyles = StyleSheet.create({
  mkDot: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  mkDotText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  meMarker: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  meHalo: {
    position: 'absolute', width: 76, height: 76, borderRadius: 38,
    backgroundColor: 'rgba(255,117,31,0.35)',
  },
  meDot: {
    position: 'absolute', left: 27, top: 27,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF751F', borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  meArrowWrap: { position: 'absolute', width: 76, height: 76 },
  meArrow: {
    position: 'absolute', left: 31, top: 6,
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderBottomWidth: 16,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderBottomColor: '#FF751F',
  },
});

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

/* ==================================================================== */
/* ProviderMap                                                          */
/* ==================================================================== */
const ProviderMap = ({ provider, route, order, recenterTick, padBottom, online = true }: any) => {
  const mapRef = useRef<MapView>(null);
  const haloAnim = useRef(new Animated.Value(0)).current;
  const focused = useIsFocused();
  useEffect(() => {
    haloAnim.setValue(0);
    if (!online || !focused) return;
    const loop = Animated.loop(
      Animated.timing(haloAnim, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [online, focused, haloAnim]);
  const haloScale = haloAnim.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.5] });
  const haloOpacity = haloAnim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.18, 0] });

  const [compass, setCompass] = useState<number | null>(null);
  const compassRaw = useRef<number | null>(null);
  const compassShown = useRef<number | null>(null);
  useEffect(() => {
    if (!focused) return;
    let sub: Location.LocationSubscription | null = null;
    let gone = false;
    (async () => {
      try {
        sub = await Location.watchHeadingAsync(h => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (deg != null && deg >= 0) compassRaw.current = deg;
        });
        if (gone) sub.remove();
      } catch { /* no compass on this device */ }
    })();
    const tick = setInterval(() => {
      const raw = compassRaw.current;
      if (raw == null) return;
      const prev = compassShown.current;
      const next = prev == null ? raw : (prev + ((((raw - prev) % 360) + 540) % 360 - 180) * 0.3 + 360) % 360;
      if (prev == null || Math.abs(((next - prev + 540) % 360) - 180) > 0.5) {
        compassShown.current = next;
        setCompass(next);
      }
    }, 100);
    return () => { gone = true; sub?.remove(); clearInterval(tick); };
  }, [focused]);
  const facing = compass ?? provider?.heading ?? null;
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [orderCoords, setOrderCoords] = useState<{ latitude: number; longitude: number }[]>([]);

  const lastRouteKey = useRef('');
  const lastOrderKey = useRef('');
  const lastFitKey = useRef('');
  const firstFix = useRef(true);

  useEffect(() => {
    if (!route) { setRouteCoords([]); lastRouteKey.current = ''; return; }
    const key = `${route.start.lat},${route.start.lng},${route.end.lat},${route.end.lng}`;
    if (key === lastRouteKey.current) return;
    lastRouteKey.current = key;

    let cancelled = false;
    (async () => {
      const coords = await fetchRoadCoords(route.start, route.end);
      if (!cancelled) setRouteCoords(coords);
    })();
    return () => { cancelled = true; };
  }, [route?.start?.lat, route?.start?.lng, route?.end?.lat, route?.end?.lng]);

  useEffect(() => {
    if (!order) { setOrderCoords([]); lastOrderKey.current = ''; return; }
    const key = `${order.pickup.lat},${order.pickup.lng},${order.dropoff.lat},${order.dropoff.lng}`;
    if (key === lastOrderKey.current) return;
    lastOrderKey.current = key;

    let cancelled = false;
    (async () => {
      const coords = await fetchRoadCoords(order.pickup, order.dropoff);
      if (!cancelled) setOrderCoords(coords);
    })();
    return () => { cancelled = true; };
  }, [order?.pickup?.lat, order?.pickup?.lng, order?.dropoff?.lat, order?.dropoff?.lng]);

  useEffect(() => {
    if (!order) return;
    const key = `${order.pickup.lat},${order.pickup.lng},${order.dropoff.lat},${order.dropoff.lng}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const pts: { latitude: number; longitude: number }[] = [
      { latitude: order.pickup.lat, longitude: order.pickup.lng },
      { latitude: order.dropoff.lat, longitude: order.dropoff.lng },
    ];
    if (provider) pts.push({ latitude: provider.lat, longitude: provider.lng });

    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 120, right: 70, bottom: padBottom || 260, left: 30 },
        animated: true,
      });
    }, 150);
    return () => clearTimeout(t);
  }, [order?.pickup?.lat, order?.pickup?.lng, order?.dropoff?.lat, order?.dropoff?.lng, padBottom, provider]);

  useEffect(() => {
    if (!provider || order) return;
    if (!firstFix.current) return;
    firstFix.current = false;

    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: provider.lat, longitude: provider.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        500,
      );
    }, 150);
    return () => clearTimeout(t);
  }, [provider?.lat, provider?.lng, order]);

  useEffect(() => {
    if (!recenterTick || !provider) return;
    mapRef.current?.animateToRegion(
      { latitude: provider.lat, longitude: provider.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      400,
    );
  }, [recenterTick, provider]);

  return (
    <MapView
      ref={mapRef}
      {...MAP_PROPS}
      userInterfaceStyle="light"
      style={{ flex: 1 }}
      initialRegion={{
        latitude: provider?.lat ?? DEFAULT_CENTER.latitude,
        longitude: provider?.lng ?? DEFAULT_CENTER.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
    >
      {route && (
        <>
          <Marker coordinate={{ latitude: route.start.lat, longitude: route.start.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[mapStyles.mkDot, { backgroundColor: '#3B82F6' }]}>
              <Text style={mapStyles.mkDotText}>S</Text>
            </View>
          </Marker>
          <Marker coordinate={{ latitude: route.end.lat, longitude: route.end.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[mapStyles.mkDot, { backgroundColor: '#EF4444' }]}>
              <Text style={mapStyles.mkDotText}>E</Text>
            </View>
          </Marker>
          {routeCoords.length > 1 && (
            <Polyline coordinates={routeCoords} strokeColor="#3B82F6" strokeWidth={4} />
          )}
        </>
      )}

      {order && (
        <>
          <Marker coordinate={{ latitude: order.pickup.lat, longitude: order.pickup.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[mapStyles.mkDot, { backgroundColor: ORANGE }]}>
              <Text style={mapStyles.mkDotText}>P</Text>
            </View>
          </Marker>
          <Marker coordinate={{ latitude: order.dropoff.lat, longitude: order.dropoff.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[mapStyles.mkDot, { backgroundColor: '#111827' }]}>
              <Text style={mapStyles.mkDotText}>D</Text>
            </View>
          </Marker>
          {orderCoords.length > 1 && (
            <Polyline coordinates={orderCoords} strokeColor={ORANGE} strokeWidth={5} />
          )}
          {provider && (
            <Polyline
              coordinates={[
                { latitude: provider.lat, longitude: provider.lng },
                { latitude: order.pickup.lat, longitude: order.pickup.lng },
              ]}
              strokeColor="#111827"
              strokeWidth={2}
              lineDashPattern={[6, 8]}
            />
          )}
        </>
      )}

      {provider && (
        <Marker coordinate={{ latitude: provider.lat, longitude: provider.lng }} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges zIndex={10}>
          <View style={mapStyles.meMarker}>
            <Animated.View style={[mapStyles.meHalo, !online && { backgroundColor: 'rgba(100,116,139,0.22)' }, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
            {facing != null && (
              <View style={[mapStyles.meArrowWrap, { transform: [{ rotate: `${facing}deg` }] }]}>
                <View style={[mapStyles.meArrow, !online && { borderBottomColor: '#64748B' }]} />
              </View>
            )}
            <View style={[mapStyles.meDot, !online && { backgroundColor: '#64748B' }]} />
          </View>
        </Marker>
      )}
    </MapView>
  );
};

/* ==================================================================== */
/* Reverse-geocode helpers (shared by picker)                           */
/* ==================================================================== */
const reverseGeocodeGoogle = async (coords: Coord) => {
  if (!HAS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`,
    );
    const json = await response.json();
    if (json.status === 'OK' && json.results.length > 0) {
      const result =
        json.results.find((r: any) =>
          (r.types || []).some((t: string) => ['point_of_interest', 'establishment', 'premise', 'street_address'].includes(t)),
        ) || json.results[0];
      const components = result.address_components || [];
      const get = (t: string) => components.find((c: any) => c.types.includes(t))?.long_name || '';
      const street = get('route') || result.formatted_address.split(',')[0];
      return {
        name: get('point_of_interest') || get('establishment') || get('premise') || street,
        sub: result.formatted_address as string,
        structured: {
          street_address: street,
          barangay: get('sublocality') || get('sublocality_level_1') || get('neighborhood') || 'Unknown',
          city: get('locality') || get('administrative_area_level_2') || 'Unknown',
          province: get('administrative_area_level_1') || 'Unknown',
          zip_code: get('postal_code') || '0000',
        },
      };
    }
  } catch (err) { console.warn(err); }
  return null;
};

const reverseGeocodeExpo = async (coords: Coord) => {
  try {
    const [addr] = await Location.reverseGeocodeAsync(coords);
    if (!addr) return null;
    const mainName = addr.name || addr.street || 'Selected Location';
    const subParts = [addr.street !== addr.name ? addr.street : null, addr.district || addr.subregion, addr.city, addr.region]
      .filter(Boolean).join(', ');
    return {
      name: mainName,
      sub: subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
      structured: {
        street_address: mainName, barangay: addr.district || 'Unknown', city: addr.city || 'Unknown',
        province: addr.region || 'Unknown', zip_code: addr.postalCode || '0000',
      },
    };
  } catch (err) { console.warn(err); }
  return null;
};

const fetchNearbyPlaces = async (coords: Coord): Promise<NearbyPlace[]> => {
  if (!HAS_API_KEY) return [];
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({
        maxResultCount: 12,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: coords, radius: NEARBY_RADIUS_M } },
      }),
    });
    const data = await response.json();
    return (data.places || [])
      .filter((p: any) => p.displayName?.text && p.location && !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
      .map((p: any) => {
        const pc = { latitude: p.location.latitude, longitude: p.location.longitude };
        return {
          id: p.id, name: p.displayName.text, address: p.formattedAddress || '',
          ...pc, dist: metersBetween(coords, pc),
        } as NearbyPlace;
      })
      .sort((a: NearbyPlace, b: NearbyPlace) => a.dist - b.dist);
  } catch (e) {
    console.warn('Nearby lookup failed', e);
  }
  return [];
};

/* ==================================================================== */
/* RouteLocationPickerModal                                             */
/* ==================================================================== */
const RouteLocationPickerModal = ({
  visible, onClose, onSelect, initialCoords, title, pinColor, colors, isDark,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (loc: any) => void;
  initialCoords?: Coord | null;
  title: string;
  pinColor: string;
  colors: ThemeColors;
  isDark: boolean;
}) => {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);
  const lastResolved = useRef<Coord | null>(null);
  const lastPoiTap = useRef(0);
  const markerRef = useRef<Coord>(initialCoords || DEFAULT_CENTER);

  const [markerCoord, setMarkerCoord] = useState<Coord>(initialCoords || DEFAULT_CENTER);
  markerRef.current = markerCoord;

  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);
  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [kbH, setKbH] = useState(0);

  const pinBounce = useRef(new Animated.Value(0)).current;
  const pinPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (initialCoords) {
      setMarkerCoord(initialCoords);
      resolveAt(initialCoords);
      const t = setTimeout(() => {
        mapRef.current?.animateToRegion({ ...initialCoords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 0);
      }, 50);
      return () => clearTimeout(t);
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { resolveAt(markerRef.current); return; }
        const loc = await Location.getCurrentPositionAsync({});
        moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch { resolveAt(markerRef.current); }
    })();
    loadRecents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialCoords?.latitude, initialCoords?.longitude]);

  useEffect(() => {
    Animated.spring(pinBounce, { toValue: isDraggingMap ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true }).start();
  }, [isDraggingMap, pinBounce]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pinPulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pinPulse]);

  useEffect(() => () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', e => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const loadRecents = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentEntry[];
        setRecents(Array.isArray(parsed) ? parsed : []);
      }
    } catch { /* ignore */ }
  };

  const saveRecent = async (entry: RecentEntry) => {
    try {
      const next = [
        entry,
        ...recents.filter(r => Math.abs(r.latitude - entry.latitude) > 1e-4 || Math.abs(r.longitude - entry.longitude) > 1e-4),
      ].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const resolveAt = async (coords: Coord, label?: Label) => {
    const seq = ++resolveSeq.current;
    lastResolved.current = coords;
    setValidatingPin(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub || ''); }

    const [geo, list] = await Promise.all([reverseGeocodeGoogle(coords), fetchNearbyPlaces(coords)]);
    if (seq !== resolveSeq.current) return;

    let g = geo;
    if (!g) g = await reverseGeocodeExpo(coords);
    if (seq !== resolveSeq.current) return;

    const close = label ? null : list.find(p => p.dist <= LABEL_SNAP_M) || null;
    const name = label?.name || close?.name || g?.name || 'Pinned location';
    const sub =
      label?.sub ||
      (close ? close.address || g?.sub || '' : g?.sub) ||
      `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;

    setAddressName(name);
    setAddressSub(sub);
    setNearby(list.filter(p => p.name !== name));
    setStructuredAddress(
      g?.structured || { street_address: name, barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000' },
    );
    setValidatingPin(false);
  };

  const moveTo = (coords: Coord, label?: Label) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  };

  const handleLocateMe = async () => {
    if (locating) return;
    Keyboard.dismiss();
    try {
      setLocating(true);
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location is off', 'Allow location access so the map can jump to where you are.');
        return;
      }
      let first: Coord | null = null;
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last) { first = { latitude: last.coords.latitude, longitude: last.coords.longitude }; moveTo(first); }
      } catch { /* ignore */ }
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
      if (!first || metersBetween(first, here) > 15) moveTo(here);
    } catch {
      Alert.alert('Error', 'Could not fetch your current location.');
    } finally {
      setLocating(false);
    }
  };

  const runSearch = async (text: string) => {
    setSearchError(null);
    if (!text.trim()) { setSearchResults([]); return; }
    if (!HAS_API_KEY) { setSearchError('Search unavailable.'); return; }
    try {
      setSearchLoading(true);
      const c = markerRef.current;
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
        },
        body: JSON.stringify({
          textQuery: text, languageCode: 'en', regionCode: 'PH',
          locationBias: { circle: { center: { latitude: c.latitude, longitude: c.longitude }, radius: 50000.0 } },
        }),
      });
      const data = await response.json();
      if (data.error) { setSearchError(data.error.message); setSearchResults([]); return; }
      const detailed: SearchResult[] = (data.places || [])
        .filter((p: any) => !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
        .map((p: any) => ({
          place_id: p.id,
          name: p.displayName?.text || '',
          formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
        }));
      setSearchResults(detailed);
      if (detailed.length === 0) setSearchError('Only streets matched.');
    } catch {
      setSearchError('Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!text.trim()) { setSearchResults([]); setSearchError(null); return; }
    searchDebounce.current = setTimeout(() => runSearch(text), 350);
  };

  const closeSearch = () => {
    setIsSearching(false); setSearchQuery(''); setSearchResults([]); setSearchError(null);
    Keyboard.dismiss();
  };

  const selectSearchResult = (item: SearchResult) => {
    const coords = { latitude: item.geometry.location.lat, longitude: item.geometry.location.lng };
    moveTo(coords, { name: item.name, sub: item.formatted_address });
    saveRecent({ name: item.name, address: item.formatted_address, latitude: coords.latitude, longitude: coords.longitude, ts: Date.now() });
    closeSearch();
  };

  const pickRecent = (r: RecentEntry) => {
    moveTo({ latitude: r.latitude, longitude: r.longitude }, { name: r.name, sub: r.address });
    closeSearch();
  };

  const pickNearby = (p: NearbyPlace) => {
    Keyboard.dismiss();
    moveTo({ latitude: p.latitude, longitude: p.longitude }, { name: p.name, sub: p.address });
  };

  const confirm = () => {
    const fullAddress = `${addressName}${addressSub && addressSub !== addressName ? ', ' + addressSub : ''}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress,
    };
    saveRecent({ name: addressName, address: addressSub || addressName, latitude: markerCoord.latitude, longitude: markerCoord.longitude, ts: Date.now() });
    onSelect(locationInfo);
  };

  const onPanDrag = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
  };

  const onRegionChangeComplete = (region: Region) => {
    setIsDraggingMap(false);
    const center = { latitude: region.latitude, longitude: region.longitude };
    if (lastResolved.current && metersBetween(lastResolved.current, center) < SAME_SPOT_METERS) return;
    setMarkerCoord(center);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => resolveAt(center), 350);
  };

  const onPoiClick = (e: any) => {
    const { coordinate, name } = e.nativeEvent || {};
    if (!coordinate) return;
    lastPoiTap.current = Date.now();
    moveTo(
      { latitude: coordinate.latitude, longitude: coordinate.longitude },
      name ? { name: String(name).replace(/\n/g, ' ') } : undefined,
    );
  };

  const onMapPress = (e: any) => {
    Keyboard.dismiss();
    if (Date.now() - lastPoiTap.current < 500) return;
    const c = e.nativeEvent?.coordinate;
    if (!c) return;
    moveTo({ latitude: c.latitude, longitude: c.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const pinScale = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const pulseScale = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  const displayList: (SearchResult | RecentEntry)[] = searchQuery.trim().length > 0 ? searchResults : recents;
  const busy = validatingPin || isDraggingMap;

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={[pickerStyles.container, { paddingBottom: kbH }]}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

        <View style={pickerStyles.mapArea}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            userInterfaceStyle="light"
            style={StyleSheet.absoluteFill}
            initialRegion={{ ...markerCoord, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }}
            onMapReady={() => setMapLoaded(true)}
            onPanDrag={onPanDrag}
            onRegionChangeComplete={onRegionChangeComplete}
            onPoiClick={onPoiClick}
            onPress={onMapPress}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          />

          {!mapLoaded && (
            <View style={pickerStyles.loadingOverlay}>
              <ActivityIndicator size="large" color={ORANGE} />
            </View>
          )}

          <View style={pickerStyles.centerStack} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: pinTranslateY }] }} pointerEvents="box-none">
              <TouchableOpacity style={pickerStyles.bubble} activeOpacity={0.9} onPress={() => setIsSearching(true)}>
                <Text style={pickerStyles.bubbleText} numberOfLines={1}>{addressName}</Text>
                {busy
                  ? <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 8 }} />
                  : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            </Animated.View>

            <View style={pickerStyles.pinContainer} pointerEvents="none">
              <Animated.View style={[pickerStyles.pinWrapper, { transform: [{ translateY: pinTranslateY }, { scale: pinScale }] }]}>
                <Animated.View
                  style={[pickerStyles.pinHalo, { backgroundColor: pinColor, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
                />
                <View style={[pickerStyles.pinDot, { backgroundColor: pinColor }]}>
                  <View style={pickerStyles.pinDotInner} />
                </View>
                <View style={[pickerStyles.pinStem, { backgroundColor: pinColor }]} />
              </Animated.View>
              <View style={pickerStyles.pinShadow} />
            </View>
          </View>

          <TouchableOpacity
            style={[pickerStyles.iconBtn, { top: insets.top + 10 }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>

          <TouchableOpacity style={pickerStyles.locateMeBtn} onPress={handleLocateMe} disabled={locating} activeOpacity={0.85}>
            {locating ? <ActivityIndicator size="small" color="#111827" /> : <Ionicons name="locate" size={24} color="#111827" />}
          </TouchableOpacity>
        </View>

        <View style={[pickerStyles.sheet, { backgroundColor: colors.card }]}>
          <View style={[pickerStyles.dragHandle, { backgroundColor: colors.border }]} />

          <ScrollView
            style={pickerStyles.list}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity style={[pickerStyles.row, { backgroundColor: 'rgba(242,112,36,0.09)' }]} activeOpacity={0.85} onPress={() => setIsSearching(true)}>
              <View style={pickerStyles.rowIconCol}>
                <View style={[pickerStyles.rowIcon, { backgroundColor: pinColor }]}>
                  <Ionicons name="location" size={18} color="#FFFFFF" />
                </View>
              </View>
              <View style={pickerStyles.rowText}>
                <Text style={pickerStyles.rowTitle} numberOfLines={1}>{addressName}</Text>
                <Text style={pickerStyles.rowSub} numberOfLines={1}>
                  {busy ? 'Updating address...' : addressSub || 'Fetching address details...'}
                </Text>
              </View>
              <Ionicons name="pencil" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {nearby.map(p => (
              <TouchableOpacity key={p.id} style={pickerStyles.row} activeOpacity={0.7} onPress={() => pickNearby(p)}>
                <View style={pickerStyles.rowIconCol}>
                  <View style={[pickerStyles.rowIconMuted, { backgroundColor: colors.background }]}>
                    <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                  </View>
                  <Text style={pickerStyles.rowDist}>{fmtDist(p.dist)}</Text>
                </View>
                <View style={pickerStyles.rowText}>
                  <Text style={pickerStyles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={pickerStyles.rowSub} numberOfLines={1}>{p.address}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {nearby.length === 0 && (
              <Text style={pickerStyles.emptyNearby}>
                {busy ? 'Looking for nearby places...' : 'No named places nearby. Drag the map or search.'}
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[pickerStyles.confirmBtn, { backgroundColor: pinColor }, busy && { opacity: 0.6 }]}
            onPress={() => { Keyboard.dismiss(); confirm(); }}
            activeOpacity={0.9}
            disabled={busy}
          >
            <Text style={pickerStyles.confirmBtnText}>
              {busy ? 'Updating...' : `Confirm ${title}`}
            </Text>
          </TouchableOpacity>
          <View style={{ height: kbH > 0 ? 8 : Math.max(insets.bottom, 12) }} />
        </View>

        {isSearching && (
          <View style={[pickerStyles.searchOverlay, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
            <View style={[pickerStyles.searchModalHeader, { borderBottomColor: colors.divider }]}>
              <TouchableOpacity style={[pickerStyles.searchBackBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={closeSearch}>
                <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
              <View style={[pickerStyles.searchInputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={[pickerStyles.searchInput, { color: colors.textPrimary }]}
                  placeholder="Search mall, school, landmark..."
                  placeholderTextColor={colors.textMuted}
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  autoFocus
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={10}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {searchLoading && <ActivityIndicator size="small" color={ORANGE} style={{ marginTop: 20 }} />}
            {!!searchError && !searchLoading && <Text style={pickerStyles.searchErrorText}>{searchError}</Text>}

            {searchQuery.trim().length === 0 && recents.length > 0 && (
              <View style={pickerStyles.recentsHeader}>
                <Text style={[pickerStyles.recentsLabel, { color: colors.textMuted }]}>RECENT</Text>
                <TouchableOpacity onPress={async () => { try { await AsyncStorage.removeItem(RECENTS_KEY); setRecents([]); } catch { /* ignore */ } }}>
                  <Text style={pickerStyles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}

            <FlatList
              data={displayList}
              keyExtractor={(item: any, index) => (item.place_id || item.name) + index}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }}
              renderItem={({ item }) => {
                const isRecent = !('place_id' in item);
                return (
                  <TouchableOpacity
                    style={[pickerStyles.searchResultItem, { borderBottomColor: colors.divider }]}
                    onPress={() => (isRecent ? pickRecent(item as RecentEntry) : selectSearchResult(item as SearchResult))}
                  >
                    <View style={[pickerStyles.searchResultIconBox, { backgroundColor: colors.background }]}>
                      <Ionicons name={isRecent ? 'time-outline' : 'location-outline'} size={18} color={pinColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[pickerStyles.searchResultTitle, { color: colors.textPrimary }]} numberOfLines={1}>{item.name}</Text>
                      <Text style={[pickerStyles.searchResultSub, { color: colors.textSecondary }]} numberOfLines={2}>
                        {isRecent ? (item as RecentEntry).address : (item as SearchResult).formatted_address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};

const pickerStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  mapArea: { flex: 1, backgroundColor: '#F5F5F5', overflow: 'hidden' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  centerStack: {
    position: 'absolute', left: 0, right: 0, top: '50%',
    marginTop: -(32 + 8 + 42), height: 42 + 8 + 32,
    alignItems: 'center', zIndex: 4,
  },
  bubble: {
    height: 42, maxWidth: '78%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 21, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)',
  },
  bubbleText: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: '#111827' },
  pinContainer: { marginTop: 8, alignItems: 'center' },
  pinWrapper: { alignItems: 'center' },
  pinHalo: { position: 'absolute', top: 0, width: 24, height: 24, borderRadius: 12, opacity: 0.3 },
  pinDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6, zIndex: 2,
  },
  pinDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  pinStem: { width: 2, height: 8, marginTop: -2, zIndex: 1 },
  pinShadow: { position: 'absolute', bottom: -2, width: 8, height: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.25)' },
  iconBtn: {
    position: 'absolute', left: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  locateMeBtn: {
    position: 'absolute', right: 16, bottom: 34, width: 52, height: 52, borderRadius: 14, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 5,
  },
  sheet: {
    borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -22,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
    zIndex: 6,
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  list: { maxHeight: 232 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 14 },
  rowIconCol: { width: 56, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowIconMuted: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowDist: { fontSize: 11, color: '#6B7280', marginTop: 4, fontWeight: '500' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  rowSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  emptyNearby: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', paddingVertical: 14, paddingHorizontal: 20 },
  confirmBtn: {
    marginHorizontal: 20, marginTop: 6, borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
  },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  searchBackBtn: {
    width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1,
  },
  searchInputWrapper: { flex: 1, height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500' },
  searchErrorText: { textAlign: 'center', marginTop: 24, fontSize: 13, color: '#9CA3AF' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, gap: 14 },
  searchResultIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  searchResultTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  searchResultSub: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  recentsLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  clearText: { fontSize: 12, fontWeight: '700', color: ORANGE },
});

/* ==================================================================== */
/* Main Screen                                                          */
/* ==================================================================== */
export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Providers must accept the provider terms before posting or starting a route.
  const { ensureAccepted, termsModal } = useProviderTermsGate();

  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [usedTodayCount, setUsedTodayCount] = useState(0);
  const [demoMode, setDemoModeState] = useState(false);

  // Refs so async callbacks & realtime listeners always see latest values without waiting for re-render
  const providerIdRef = useRef<number | null>(null);
  const activeRouteRef = useRef<Route | null>(null);
  const routesRef = useRef<Route[]>([]);

  useEffect(() => { providerIdRef.current = providerId; }, [providerId]);
  useEffect(() => { activeRouteRef.current = activeRoute; }, [activeRoute]);
  useEffect(() => { routesRef.current = routes; }, [routes]);

  const [requests, setRequests] = useState<JobRequest[]>([]);
  const [checkingMatches, setCheckingMatches] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  const [detailRequestId, setDetailRequestId] = useState<number | null>(null);
  const [routePickerVisible, setRoutePickerVisible] = useState(false);

  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);

  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  const [offerSecondsLeft, setOfferSecondsLeft] = useState(OFFER_SECONDS);
  const [todayStats, setTodayStats] = useState<{ count: number; earned: number; rating: number | null }>({ count: 0, earned: 0, rating: null });

  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifChannelRef = useRef<string>(
    `provider-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const [fullListOpen, setFullListOpen] = useState(false);

  // Add Route Modal State
  const [addRouteModalVisible, setAddRouteModalVisible] = useState(false);
  const [routeLocationPickerVisible, setRouteLocationPickerVisible] = useState(false);
  const [routeLocationPickerType, setRouteLocationPickerType] = useState<'start' | 'end'>('start');
  const [newRouteStart, setNewRouteStart] = useState<Location | null>(null);
  const [newRouteEnd, setNewRouteEnd] = useState<Location | null>(null);
  const [newRouteFrequency, setNewRouteFrequency] = useState<Frequency>('Daily');
  const [newRouteDepartureDate, setNewRouteDepartureDate] = useState(new Date());
  const [newRouteDepartureTime, setNewRouteDepartureTime] = useState(new Date(Date.now() + 135 * 60 * 1000));
  const [newRouteDurationHours, setNewRouteDurationHours] = useState<number>(2);
  const [newRouteSelectedWeekday, setNewRouteSelectedWeekday] = useState<number>(new Date().getDay());
  const [newRouteVehicleId, setNewRouteVehicleId] = useState<number | null>(null);
  const [newRouteVehicles, setNewRouteVehicles] = useState<Vehicle[]>([]);
  const [newRouteSubmitting, setNewRouteSubmitting] = useState(false);
  const [newRouteShowDatePicker, setNewRouteShowDatePicker] = useState(false);
  const [newRouteShowTimePicker, setNewRouteShowTimePicker] = useState(false);
  const [newRoutePreviewCoords, setNewRoutePreviewCoords] = useState<Coord[]>([]);

  const addRoutePreviewMapRef = useRef<MapView>(null);
  const notifiedMatchIdsRef = useRef<Set<number>>(new Set());

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const onlinePulse = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;
  const signal = useRef(new Animated.Value(0)).current;
  const dotBlink = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const modeAnim = useRef(new Animated.Value(0)).current;
  const modeFade = useRef(new Animated.Value(1)).current;
  const swapAnim = useRef(new Animated.Value(0)).current;
  const [ctaW, setCtaW] = useState(320);
  const isFocused = useIsFocused();

  useEffect(() => {
    getDemoMode().then(setDemoModeState);
    return subscribeDemoMode(setDemoModeState);
  }, []);

  // Listen to active route changes made from ManageRoutesScreen or App.tsx
  useEffect(() => {
    return subscribeActiveRoute((newRouteId) => {
      if (!newRouteId) return;
      const found = routesRef.current.find(r => r.route_id === newRouteId);
      if (found && activeRouteRef.current?.route_id !== newRouteId) {
        setActiveRoute(found);
        activeRouteRef.current = found;
        void refreshMatches(providerIdRef.current, found, routesRef.current);
      }
    });
  }, []);

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    Animated.timing(modeAnim, { toValue: isOnline ? 1 : 0, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    modeFade.setValue(0);
    Animated.timing(modeFade, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [isOnline, modeAnim, modeFade]);

  useEffect(() => {
    signal.setValue(0); dotBlink.setValue(0);
    if (!isOnline || !isFocused) return;
    const ring = Animated.loop(Animated.timing(signal, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    const blink = Animated.loop(Animated.sequence([
      Animated.timing(dotBlink, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(dotBlink, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    ring.start(); blink.start();
    return () => { ring.stop(); blink.stop(); };
  }, [isOnline, isFocused, signal, dotBlink]);

  useEffect(() => {
    shine.setValue(0);
    if (isOnline || !isFocused) return;
    const sweep = Animated.loop(Animated.sequence([
      Animated.timing(shine, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    sweep.start();
    return () => sweep.stop();
  }, [isOnline, isFocused, shine]);

  useEffect(() => {
    onlinePulse.setValue(0);
    if (!isOnline || !isFocused) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(onlinePulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(onlinePulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isOnline, isFocused, onlinePulse]);

  useEffect(() => {
    bellPulse.setValue(0);
    if (!isFocused) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isFocused, bellPulse]);

  const loadNotifs = useCallback(async () => {
    if (!providerId) return;
    setNotifLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, type, is_read, created_at, ref_id')
        .eq('user_id', providerId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const list = (data || []) as Notif[];
      setNotifs(list);
      setUnreadCount(list.filter(n => !n.is_read).length);
    } catch (e) { console.warn('[jobs] notif load failed', e); }
    finally { setNotifLoading(false); }
  }, [providerId]);

  useEffect(() => { if (providerId) loadNotifs(); }, [providerId, loadNotifs]);

  useEffect(() => {
    if (!providerId) return;
    const ch = supabase
      .channel(notifChannelRef.current)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${providerId}` }, (payload) => {
        loadNotifs();
        const row: any = payload.new;
        const t = (row?.type || '').toLowerCase();
        if (t === 'match' || t.includes('direct')) {
          fireLocalMatchNotification(row?.body || 'A new sender request matches your route.');
          void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_log', filter: `user_id=eq.${providerId}` }, () => loadNotifs())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [providerId, loadNotifs]);

  const fireLocalMatchNotification = async (body: string) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🎯 Route Match Available!',
          body,
          data: { type: 'match' },
          sound: true,
        },
        trigger: null,
      });
    } catch (err) {
      console.warn('[jobs] local notif failed:', err);
    }
  };

  const handleOpenNotifs = () => { setNotifModalOpen(true); loadNotifs(); };

  const markNotifRead = async (n: Notif) => {
    if (n.is_read) return;
    setNotifs(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, is_read: true } : x));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notif_id); }
    catch (e) { console.warn('mark read failed', e); }
  };

  const handleNotifPress = async (n: Notif) => {
    await markNotifRead(n);
    setNotifModalOpen(false);
    const type = (n.type || '').toLowerCase();
    if (type.startsWith('support')) { setFullListOpen(true); return; }
    const handled = await routeNotification(navigation, n, { role: 'provider' });
    if (!handled) { Alert.alert(n.title || 'Notification', n.body || ''); }
  };

  const loadTodayStats = async (pid: number) => {
    try {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('deliveries')
        .select('completed_at, delivery_requests:request_id(estimated_cost)')
        .eq('provider_id', pid)
        .gte('completed_at', start.toISOString());
      const rows: any[] = data || [];
      const earned = rows.reduce((sum, r) => {
        const dr = Array.isArray(r.delivery_requests) ? r.delivery_requests[0] : r.delivery_requests;
        return sum + (Number(dr?.estimated_cost) || 0);
      }, 0);
      let rating: number | null = null;
      try {
        const { data: rv } = await supabase.from('ratings_reviews').select('rating').eq('reviewee_id', pid);
        const list: any[] = rv || [];
        if (list.length > 0) rating = list.reduce((a, r) => a + (Number(r.rating) || 0), 0) / list.length;
      } catch { /* no ratings yet */ }
      setTodayStats({ count: rows.length, earned, rating });
    } catch { /* keep zeros */ }
  };

  const getProviderData = async (): Promise<number | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase.from('users').select('user_id, is_online').eq('auth_id', user.id).single();
      if (error) throw error;
      setProviderId(userData.user_id);
      providerIdRef.current = userData.user_id;
      setIsOnline(!!(userData as any).is_online);
      void loadTodayStats(userData.user_id);
      return userData.user_id;
    } catch { return null; }
  };

  const hasDirectOffers = requests.some(r => r.isDirectRequest && !dismissedIds.includes(r.request_id));
  const hasAnyActiveOffers = requests.some(r => !dismissedIds.includes(r.request_id) && (isOnline || r.isDirectRequest));

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(!loading && !isOnline && !hasDirectOffers && !hasAnyActiveOffers);
      return () => setTabBarHidden(false);
    }, [isOnline, loading, hasDirectOffers, hasAnyActiveOffers]),
  );

  const goToTasks = () => {
    try {
      let cur: any = navigation;
      while (cur) {
        const names: string[] = cur.getState?.()?.routeNames || [];
        const match = names.find(n => /task/i.test(n));
        if (match) { cur.navigate(match); return; }
        cur = cur.getParent?.();
      }
      navigation.navigate('MainTabs', { screen: 'Tasks' });
    } catch {
      navigation.goBack();
    }
  };

  const goToManageRoutes = () => {
    setRoutePickerVisible(false);
    navigation.navigate('ManageRoutes');
  };

  /* ------------------ Fetch routes / vehicles (Returns resolved route immediately) ------------------ */
  const fetchRoutes = async (pid: number): Promise<{ resolvedRoute: Route | null; validRoutes: Route[] }> => {
    try {
      const stats = await getTodayRouteStats(pid);
      setUsedTodayCount(stats.usedTodayCount);

      const { data, error } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
        `)
        .eq('provider_id', pid)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const nonDeleted = (data || []).filter((r: Route) => r.is_deleted !== true);
      const validRoutes = nonDeleted.filter((r) => !isRouteExpired(r));

      setRoutes(validRoutes);
      routesRef.current = validRoutes;

      const savedId = await getActiveRouteId();
      const restored = savedId ? validRoutes.find((r) => r.route_id === savedId) : null;

      if (restored) {
        setActiveRoute(restored);
        activeRouteRef.current = restored;
        return { resolvedRoute: restored, validRoutes };
      } else if (validRoutes.length > 0) {
        const firstRoute = validRoutes[0];
        setActiveRoute(firstRoute);
        activeRouteRef.current = firstRoute;
        await setActiveRouteId(firstRoute.route_id);
        return { resolvedRoute: firstRoute, validRoutes };
      } else {
        setActiveRoute(null);
        activeRouteRef.current = null;
        await setActiveRouteId(null);
        return { resolvedRoute: null, validRoutes: [] };
      }
    } catch (e) {
      console.error('fetchRoutes error:', e);
      return { resolvedRoute: activeRouteRef.current, validRoutes: routesRef.current };
    }
  };

  /* ------------------ Automatic Route Match Evaluation & Auto-Selection ------------------ */
  const refreshMatches = useCallback(async (
    overridePid?: number | null,
    overrideActiveRoute?: Route | null,
    overrideAllRoutes?: Route[],
  ) => {
    const pid = overridePid ?? providerIdRef.current;
    if (!pid) return;

    const currentActive = overrideActiveRoute !== undefined ? overrideActiveRoute : activeRouteRef.current;
    const allCandidateRoutes = overrideAllRoutes ?? routesRef.current;

    try {
      setCheckingMatches(true);

      // Build ordered list of routes to check: active route first, then any other valid routes
      const orderedRoutes: Route[] = [];
      if (currentActive) orderedRoutes.push(currentActive);
      for (const r of allCandidateRoutes) {
        if (!orderedRoutes.some(x => x.route_id === r.route_id)) {
          orderedRoutes.push(r);
        }
      }

      // If no routes in memory yet, check storage/DB once
      if (orderedRoutes.length === 0) {
        const storedId = await getActiveRouteId();
        if (storedId) {
          orderedRoutes.push({ route_id: storedId } as Route);
        } else {
          // Rule 1: Zero requests until a route is posted
          setRequests([]);
          return;
        }
      }

      const isDemo = await getDemoMode();
      let winningRoute: Route | null = orderedRoutes[0] || null;
      let winningMatches: RouteMatchRow[] = [];

      // Evaluate routes in order; automatically switch to the first route that has a match!
      for (const candidate of orderedRoutes) {
        const rows = await evaluateAndFetchRouteMatches(candidate.route_id, isDemo);
        if (rows.length > 0) {
          winningRoute = candidate;
          winningMatches = rows;
          break;
        }
      }

      // Also check if a sender sent a direct request (`preferred_provider_id = pid`) anchored to one of our routes
      if (winningMatches.length === 0) {
        const { data: directReqs } = await supabase
          .from('delivery_requests')
          .select(`
            *,
            pickup_location:locations!delivery_requests_pickup_location_id_fkey(*),
            dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*),
            cargo:cargo_id(*),
            receiver:receiver_id(*)
          `)
          .eq('preferred_provider_id', pid)
          .eq('delivery_status', 'Pending');

        if (directReqs && directReqs.length > 0) {
          const reqIds = directReqs.map((r: any) => r.request_id);
          const { data: existingDelivs } = await supabase
            .from('deliveries')
            .select('request_id')
            .in('request_id', reqIds);
          const takenSet = new Set((existingDelivs || []).map((d: any) => d.request_id));
          const openDirect = directReqs.filter((r: any) => !takenSet.has(r.request_id));

          if (openDirect.length > 0) {
            const firstPrefRouteId = openDirect[0].preferred_route_id;
            const matchedRouteObj =
              orderedRoutes.find(r => r.route_id === Number(firstPrefRouteId)) ||
              orderedRoutes[0];

            if (matchedRouteObj) {
              winningRoute = matchedRouteObj;
              winningMatches = openDirect.map((dr: any) => ({
                match_id: 0,
                route_id: matchedRouteObj.route_id,
                request_id: dr.request_id,
                provider_id: pid,
                match_score: 100,
                is_fallback: false,
                fallback_type: null,
                pickup_dist_m: 0,
                dropoff_dist_m: 0,
                pickup_fraction: 0,
                dropoff_fraction: 1,
                extra_detour_km: 0,
                status: 'matched',
                request: dr,
              }));
            }
          }
        }
      }

      // If a match was found on a different route than the currently displayed one, auto-select it!
      if (winningRoute && winningRoute.start_location && activeRouteRef.current?.route_id !== winningRoute.route_id) {
        setActiveRoute(winningRoute);
        activeRouteRef.current = winningRoute;
        await setActiveRouteId(winningRoute.route_id);
      }

      if (winningMatches.length === 0) {
        setRequests([]);
        return;
      }

      const senderIds = Array.from(new Set(winningMatches.map(m => m.request?.sender_id).filter(Boolean)));
      const senders: Record<number, string> = {};
      if (senderIds.length > 0) {
        const { data: users } = await supabase.from('users').select('user_id, first_name, last_name').in('user_id', senderIds);
        (users || []).forEach((u: any) => {
          const last = u.last_name ? ` ${String(u.last_name).charAt(0)}.` : '';
          senders[u.user_id] = `${u.first_name || 'Sender'}${last}`;
        });
      }

      const hydrated = winningMatches.map(m => normalizeMatchRow(m, senders, pid));

      for (const req of hydrated) {
        if (!notifiedMatchIdsRef.current.has(req.request_id)) {
          notifiedMatchIdsRef.current.add(req.request_id);
          fireLocalMatchNotification(
            req.isDirectRequest
              ? `A sender requested your route from ${req.pickup.main} to ${req.dropoff.main}.`
              : `New ${Math.round(req.matchScore || 0)}% route match from ${req.pickup.main} to ${req.dropoff.main}.`,
          );
        }
      }

      setRequests(hydrated);
    } catch (e) {
      console.warn('refreshMatches error:', e);
    } finally {
      setCheckingMatches(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    const pid = await getProviderData();
    if (pid) {
      const { resolvedRoute, validRoutes } = await fetchRoutes(pid);
      await refreshMatches(pid, resolvedRoute, validRoutes);
    }
    setLoading(false);
  }, [refreshMatches]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`jobs-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'route_request_matches' }, () => {
        void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => {
        void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries' }, () => {
        void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [providerId, refreshMatches]);

  /* ------------------------------ Add Route Modal helpers ------------------------------ */
  const fetchVehiclesForNewRoute = async (pid: number) => {
    const { data } = await supabase
      .from('vehicles')
      .select('vehicle_id, vehicle_type, plate_number, max_volume_liters, max_weight_kg, verification_status')
      .eq('provider_id', pid)
      .eq('verification_status', 'Verified');
    return (data || []) as Vehicle[];
  };

  const openAddRouteModal = async () => {
    if (!(await ensureAccepted())) return;
    const pid = providerId || (await getProviderData());
    if (!pid) { Alert.alert('Error', 'Provider account details not loaded yet.'); return; }
    if (usedTodayCount >= 3) {
      Alert.alert('Daily Limit Reached (3/3)', 'You cannot post more than 3 routes per day.');
      return;
    }
    setRoutePickerVisible(false);
    const initial = new Date(Date.now() + 135 * 60 * 1000); // 2h 15m ahead
    setNewRouteStart(null);
    setNewRouteEnd(null);
    setNewRouteFrequency('Daily');
    setNewRouteDepartureDate(initial);
    setNewRouteDepartureTime(initial);
    setNewRouteDurationHours(2);
    setNewRouteSelectedWeekday(initial.getDay());
    setNewRouteVehicleId(null);
    setNewRouteShowDatePicker(false);
    setNewRouteShowTimePicker(false);
    setNewRoutePreviewCoords([]);
    const vehicles = await fetchVehiclesForNewRoute(pid);
    setNewRouteVehicles(vehicles);
    setAddRouteModalVisible(true);
  };

  const handleNewRouteLocationSelect = async (locData: any, type: 'start' | 'end') => {
    try {
      const { data: existing } = await supabase
        .from('locations')
        .select('*')
        .eq('latitude', locData.latitude)
        .eq('longitude', locData.longitude)
        .limit(1);

      let location: Location | null = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: locData.street_address,
          barangay: locData.barangay,
          city: locData.city,
          province: locData.province,
          zip_code: locData.zip_code,
          latitude: locData.latitude,
          longitude: locData.longitude,
        }).select('*').single();
        if (error) throw error;
        location = newLoc;
      }

      if (type === 'start') setNewRouteStart(location);
      else setNewRouteEnd(location);

      setRouteLocationPickerVisible(false);
    } catch (err: any) {
      console.error(err);
      Alert.alert('Error', 'Failed to save location to database.');
    }
  };

  useEffect(() => {
    if (!newRouteStart || !newRouteEnd) { setNewRoutePreviewCoords([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${newRouteStart.longitude},${newRouteStart.latitude};${newRouteEnd.longitude},${newRouteEnd.latitude}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (data?.routes?.[0]?.geometry?.coordinates) {
          setNewRoutePreviewCoords(
            data.routes[0].geometry.coordinates.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })),
          );
        } else {
          setNewRoutePreviewCoords([
            { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude },
            { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude },
          ]);
        }
      } catch {
        if (!cancelled) {
          setNewRoutePreviewCoords([
            { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude },
            { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude },
          ]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [newRouteStart?.location_id, newRouteEnd?.location_id, newRouteStart?.latitude, newRouteStart?.longitude, newRouteEnd?.latitude, newRouteEnd?.longitude]);

  useEffect(() => {
    if (!newRouteStart || !newRouteEnd) return;
    const pts = newRoutePreviewCoords.length >= 2
      ? newRoutePreviewCoords
      : [
          { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude },
          { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude },
        ];
    const t = setTimeout(() => {
      addRoutePreviewMapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [newRouteStart?.location_id, newRouteEnd?.location_id, newRoutePreviewCoords.length]);

  const computeNewRouteEffectiveDate = (): Date => {
    if (newRouteFrequency === 'Daily') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (newRouteFrequency === 'Weekly') {
      return nextWeekday(newRouteSelectedWeekday);
    }
    return newRouteDepartureDate;
  };

  const handleAddRouteSubmit = async () => {
    if (!providerId) { Alert.alert('Error', 'Provider not loaded.'); return; }
    if (!newRouteStart || !newRouteEnd || !newRouteVehicleId || !newRouteStart.location_id || !newRouteEnd.location_id) {
      Alert.alert('Required', 'Please select start location, destination, and vehicle.');
      return;
    }

    const effectiveDate = computeNewRouteEffectiveDate();
    const combined = new Date(
      effectiveDate.getFullYear(),
      effectiveDate.getMonth(),
      effectiveDate.getDate(),
      newRouteDepartureTime.getHours(),
      newRouteDepartureTime.getMinutes(),
      0,
      0,
    );

    const endTimeObj = new Date(combined.getTime() + newRouteDurationHours * 60 * 60 * 1000);

    setNewRouteSubmitting(true);
    try {
      const res = await createProviderRouteWithGuardrails({
        providerId,
        vehicleId: newRouteVehicleId,
        startLocation: {
          location_id: newRouteStart.location_id,
          latitude: newRouteStart.latitude,
          longitude: newRouteStart.longitude,
          street_address: newRouteStart.street_address,
        },
        endLocation: {
          location_id: newRouteEnd.location_id,
          latitude: newRouteEnd.latitude,
          longitude: newRouteEnd.longitude,
          street_address: newRouteEnd.street_address,
        },
        departureDateObj: combined,
        endTimeObj,
        routeFrequency: newRouteFrequency,
      });

      Alert.alert(
        'Route Posted Successfully!',
        res.adminReviewFlag
          ? `Route distance is ${res.distanceKm} km. Flagged for Admin coverage review (>25 km).`
          : `Route corridor active (${res.distanceKm} km). Scanning for forward matches...`,
      );

      setAddRouteModalVisible(false);
      if (res.route) {
        await setActiveRouteId(res.route.route_id);
      }
      const { resolvedRoute, validRoutes } = await fetchRoutes(providerId);
      await refreshMatches(providerId, resolvedRoute, validRoutes);
    } catch (err: any) {
      console.error('handleAddRouteSubmit error:', err);
      Alert.alert('Guardrail Check', err?.message || 'Failed to save route.');
    } finally {
      setNewRouteSubmitting(false);
    }
  };

  const toggleOnlineStatus = async (online: boolean) => {
    const pid = providerId || (await getProviderData());
    if (!pid) { Alert.alert('Error', 'Provider account details could not be loaded.'); return; }

    if (online) {
      if (!(await ensureAccepted())) return;
      let currentRoute = activeRoute && !isRouteExpired(activeRoute) ? activeRoute : null;
      if (!currentRoute) {
        if (routes.length > 0) {
          currentRoute = routes[0];
          setActiveRoute(currentRoute);
          activeRouteRef.current = currentRoute;
          await setActiveRouteId(currentRoute.route_id);
        } else {
          await openAddRouteModal();
          Alert.alert('Post a Route First', 'Pack-N-Ship requires an active route before going online.');
          return;
        }
      }
      if (!currentRoute) { Alert.alert('Route Error', 'Unable to set an active route.'); return; }

      await supabase.from('users').update({ is_online: true }).eq('user_id', pid);
      setIsOnline(true);
      await refreshMatches(pid, currentRoute, routesRef.current);
    } else {
      Alert.alert('Go Offline', 'Going offline will stop matching new requests.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go Offline', style: 'destructive', onPress: async () => {
            await supabase.from('users').update({ is_online: false }).eq('user_id', pid);
            setIsOnline(false);
            setRequests(prev => prev.filter(r => r.isDirectRequest));
            void loadTodayStats(pid);
          },
        },
      ]);
    }
  };

  const goToTaskTab = (): boolean => {
    let current: any = navigation;
    while (current) {
      try {
        const names: string[] = current.getState?.()?.routeNames || [];
        const match = names.find(n => /task/i.test(n));
        if (match) { current.navigate(match); return true; }
      } catch { /* ignore */ }
      current = current.getParent?.();
    }
    return false;
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;
      const toLoc = (p: Location.LocationObject) => ({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        heading: p.coords.heading != null && p.coords.heading >= 0 ? p.coords.heading : null,
      });
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') { if (!cancelled) setLocDenied(true); return; }
          if (!cancelled) setLocDenied(false);
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled) setMyLoc(toLoc(last));
          const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!cancelled) setMyLoc(toLoc(cur));
          const watcher = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 10 },
            (p) => { if (!cancelled) setMyLoc(toLoc(p)); },
          );
          if (cancelled) watcher.remove(); else sub = watcher;
        } catch (e) { console.warn('Location error:', e); }
      })();
      return () => { cancelled = true; sub?.remove(); };
    }, []),
  );

  // Show all non-dismissed route matches immediately when a route is active
  const offers = requests.filter(r => !dismissedIds.includes(r.request_id));
  const currentOffer = offers[0] ?? null;

  const dismissOffer = (id: number) => setDismissedIds(prev => (prev.includes(id) ? prev : [...prev, id]));

  useEffect(() => { setDismissedIds([]); }, [isOnline, activeRoute?.route_id]);

  useEffect(() => {
    if (!currentOffer) return;
    setOfferSecondsLeft(OFFER_SECONDS);
    if (currentOffer.isDirectRequest) return;
    const t = setInterval(() => { setOfferSecondsLeft(sec => sec - 1); }, 1000);
    return () => clearInterval(t);
  }, [currentOffer?.request_id, currentOffer?.isDirectRequest]);

  useEffect(() => {
    if (currentOffer && !currentOffer.isDirectRequest && offerSecondsLeft <= 0) {
      dismissOffer(currentOffer.request_id);
    }
  }, [offerSecondsLeft, currentOffer]);

  const triggerSOS = () => {
    Alert.alert('Emergency', 'Do you need emergency help? You can call the national emergency hotline now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  const doAccept = async (req: JobRequest) => {
    if (!providerId) return;
    setAccepting(true);
    try {
      let vehicleId: number | null =
        activeRoute?.vehicle?.verification_status === 'Verified' ? activeRoute.vehicle.vehicle_id : null;
      if (!vehicleId) {
        const { data: v } = await supabase
          .from('vehicles')
          .select('vehicle_id')
          .eq('provider_id', providerId)
          .eq('verification_status', 'Verified')
          .limit(1)
          .maybeSingle();
        vehicleId = v?.vehicle_id ?? null;
      }
      if (!vehicleId) {
        const { data: anyVeh } = await supabase
          .from('vehicles')
          .select('vehicle_id')
          .eq('provider_id', providerId)
          .limit(1)
          .maybeSingle();
        vehicleId = anyVeh?.vehicle_id ?? null;
      }
      if (!vehicleId) {
        Alert.alert('Vehicle not verified', 'You need a verified vehicle before you can accept deliveries.');
        return;
      }

      let resolvedRouteId: number | null =
        req.preferred_route_id ?? activeRoute?.route_id ?? routes[0]?.route_id ?? null;
      if (!resolvedRouteId) {
        const { data: rRow } = await supabase
          .from('provider_routes')
          .select('route_id')
          .eq('provider_id', providerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedRouteId = rRow?.route_id ?? null;
      }

      const { data: fresh } = await supabase
        .from('delivery_requests')
        .select('delivery_status')
        .eq('request_id', req.request_id)
        .maybeSingle();
      const { data: existing } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .eq('request_id', req.request_id)
        .limit(1);
      if (fresh?.delivery_status !== 'Pending' || (existing && existing.length > 0)) {
        Alert.alert('Request unavailable', 'This request was accepted by another provider or cancelled.');
        void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
        return;
      }

      const { data: delivery, error: deliveryError } = await supabase.from('deliveries').insert({
        request_id: req.request_id,
        provider_id: providerId,
        vehicle_id: vehicleId,
        route_id: resolvedRouteId,
        accepted_at: new Date().toISOString(),
        estimated_eta: new Date(Date.now() + 3600000).toISOString(),
      }).select('*').single();
      if (deliveryError) throw deliveryError;

      const { error: qrError } = await supabase.from('qr_verifications').insert({
        delivery_id: delivery.delivery_id,
        pickup_qr: `PU-${randToken(14)}-${delivery.delivery_id}`,
        dropoff_qr: `DO-${randToken(14)}-${delivery.delivery_id}`,
        pickup_pin: randPin(),
        dropoff_pin: randPin(),
      });
      if (qrError) {
        await supabase.from('deliveries').delete().eq('delivery_id', delivery.delivery_id);
        throw qrError;
      }

      const { error: reqUpdateError } = await supabase
        .from('delivery_requests')
        .update({ delivery_status: 'Accepted' })
        .eq('request_id', req.request_id);
      if (reqUpdateError) throw reqUpdateError;

      if (req.matchId) {
        await supabase
          .from('route_request_matches')
          .update({ status: 'accepted' })
          .eq('match_id', req.matchId);
      }

      // Update remaining trunk capacity & mark fallback used if applicable
      if (activeRoute) {
        const cargoWeight = req.weightKg || 5;
        const cargoVol = computeCargoVolumeLiters(req.items);
        const newWeight = Math.max(0, Number(activeRoute.remaining_weight_kg ?? 100) - cargoWeight);
        const newVol = Math.max(0, Number(activeRoute.remaining_volume_liters ?? 300) - cargoVol);
        await supabase
          .from('provider_routes')
          .update({
            remaining_weight_kg: newWeight,
            remaining_volume_liters: newVol,
            ...(req.isFallback ? { fallback_used: true } : {}),
          })
          .eq('route_id', activeRoute.route_id);
      }

      const { data: requestData } = await supabase
        .from('delivery_requests')
        .select('estimated_cost, sender_id')
        .eq('request_id', req.request_id)
        .single();
      if (requestData) {
        await supabase.from('escrow_payments').insert({
          amount: requestData.estimated_cost,
          delivery_id: delivery.delivery_id,
          sender_id: requestData.sender_id,
          provider_id: providerId,
          escrow_status: 'On hold',
          emergency_frozen: false,
          created_at: new Date().toISOString(),
        });

        if (requestData.sender_id) {
          const code = requestCode(req.request_id);
          try {
            await notifyUser(
              requestData.sender_id,
              'Route-Matched Courier Accepted! 🚚',
              `Your courier accepted parcel #${code} along the declared route.`,
              { deliveryId: delivery.delivery_id },
            );
          } catch (err) {
            console.warn('[Jobs] notify sender accept failed', err);
          }
        }
      }

      setDetailRequestId(null);
      setDismissedIds(prev => [...prev, req.request_id]);
      void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
      if (!goToTaskTab()) {
        Alert.alert('Delivery accepted', 'Find it in the Task tab. Ask the sender to show their pickup QR when you arrive.');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to accept delivery.');
    } finally { setAccepting(false); }
  };

  const acceptRequest = (req: JobRequest) => {
    if (accepting) return;
    if (!providerId) { Alert.alert('Please wait', 'Your provider account is still loading.'); return; }
    Alert.alert(
      'Accept this route match?',
      `You will earn ${money(req.estimated_cost)} for delivering from ${req.pickup.main} to ${req.dropoff.main}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept Along Route', onPress: () => doAccept(req) },
      ],
    );
  };

  const pulseScale = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const bellScale = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const bellOpacity = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  const markFailed = (uri: string) => setFailedPhotos(prev => ({ ...prev, [uri]: true }));
  const SCREEN_H = Dimensions.get('window').height;

  const distancesFor = (o: JobRequest) => {
    const me = myLoc;
    const toPickupKm = me && o.pickup.lat != null && o.pickup.lng != null
      ? roadKm(me.lat, me.lng, o.pickup.lat, o.pickup.lng) : null;
    const tripKm = o.pickup.lat != null && o.pickup.lng != null && o.dropoff.lat != null && o.dropoff.lng != null
      ? roadKm(o.pickup.lat, o.pickup.lng, o.dropoff.lat, o.dropoff.lng) : null;
    const etaMin = toPickupKm != null ? Math.max(1, Math.round((toPickupKm / 25) * 60)) : null;
    return { toPickupKm, tripKm, etaMin };
  };

  const renderServicePill = (r: JobRequest) => (
    <View style={styles.svcPill}>
      <Ionicons name="add-circle-outline" size={13} color={BLUE} />
      <Text style={styles.svcPillText}>{serviceLabel(r.pickup_type)}</Text>
    </View>
  );

  const renderRingRoute = (r: JobRequest, notes = false) => (
    <View>
      {[
        { key: 'p', label: 'PICKUP', pt: r.pickup, color: BLUE, note: r.pickupNote },
        { key: 'd', label: 'DROP-OFF', pt: r.dropoff, color: RED, note: r.dropoffNote },
      ].map((x, i) => (
        <View key={x.key} style={styles.rtRow}>
          <View style={styles.rtRail}>
            <View style={[styles.rtRing, { borderColor: x.color }]}><View style={[styles.rtRingDot, { backgroundColor: x.color }]} /></View>
            {i === 0 && (
              <View style={styles.rtDots}>
                {[0, 1, 2, 3].map(k => <View key={k} style={styles.rtDot} />)}
              </View>
            )}
          </View>
          <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
            <Text style={styles.rtLabel}>{x.label}</Text>
            <Text style={styles.rtMain} numberOfLines={1}>{x.pt.main}</Text>
            {!!x.pt.sub && <Text style={styles.rtSub} numberOfLines={1}>{x.pt.sub}</Text>}
            {notes && !!x.note && (
              <View style={styles.routeNote}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={ORANGE} />
                <Text style={styles.routeNoteText}>{x.note}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderPeople = (r: JobRequest) => (
    <View style={styles.mcRow}>
      {[
        { role: 'SENDER', name: r.senderName || 'Sender', color: BLUE },
        { role: 'RECEIVER', name: r.receiverName || 'Receiver', color: PURPLE },
      ].map(p => (
        <View key={p.role} style={styles.mcCard}>
          <View style={[styles.mcAvatar, { backgroundColor: p.color }]}>
            <Text style={styles.mcAvatarText}>{(p.name.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mcRole}>{p.role}</Text>
            <Text style={styles.mcName} numberOfLines={1}>{p.name}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderFullDetails = () => {
    const o = detailRequestId != null ? requests.find(r => r.request_id === detailRequestId) : null;
    if (!o) return null;

    const photos = o.items.filter(i => i.photo && !failedPhotos[i.photo!]).map(i => i.photo!);
    const localOnly = o.items.some(i => i.localOnly && !i.photo);
    const cap = activeRoute?.vehicle?.max_weight_kg;
    const fits = o.weightKg != null && cap ? o.weightKg <= cap : null;
    const hasNotes = !!o.pickupNote || !!o.dropoffNote;
    const { toPickupKm, tripKm, etaMin } = distancesFor(o);

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 12, paddingTop: insets.top + 6, paddingBottom: 12,
            backgroundColor: colors.card,
            borderBottomWidth: 1, borderBottomColor: colors.divider,
          }}
        >
          <TouchableOpacity
            onPress={() => setDetailRequestId(null)}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.dCode}>{requestCode(o.request_id)}</Text>
            <Text style={styles.dWhen}>{whenLabel(o)}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.oTopRow}>
              {renderServicePill(o)}
              {o.matchScore != null && (
                <View style={styles.scoreBadge}>
                  <Ionicons name="analytics" size={13} color="#059669" />
                  <Text style={styles.scoreBadgeText}>{Math.round(o.matchScore)}% Match</Text>
                </View>
              )}
              {o.isFallback && (
                <View style={styles.fallbackBadge}>
                  <Ionicons name="Locate" size={12} color="#FFFFFF" />
                  <Text style={styles.fallbackBadgeText}>FALLBACK ({o.fallbackType === 'CONDITION_A' ? 'ADD-ON' : '1H BACKUP'})</Text>
                </View>
              )}
            </View>
            {renderRingRoute(o, true)}
          </View>

          <View style={styles.earnCard}>
            <Text style={styles.earnLabel}>YOU EARN</Text>
            <Text style={styles.earnValue}>{money(o.estimated_cost)}</Text>
            <View style={styles.earnNote}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#FFFFFF" />
              <Text style={styles.earnNoteText}>
                Held in escrow once accepted, released to your wallet when delivery is verified.
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="navigate-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>Corridor & Trip Summary</Text>
            </View>
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>TO PICKUP</Text>
                <Text style={styles.tileValue}>
                  {toPickupKm != null ? `${toPickupKm.toFixed(1)} km${etaMin != null ? ` · ${etaMin} min` : ''}` : '—'}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>TRIP</Text>
                <Text style={styles.tileValue}>{tripKm != null ? `${tripKm.toFixed(1)} km` : '—'}</Text>
              </View>
              {o.pickupDistM != null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>PICKUP FROM ROUTE</Text>
                  <Text style={styles.tileValue}>{Math.round(o.pickupDistM)} m</Text>
                </View>
              )}
              {o.dropoffDistM != null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>DROPOFF FROM ROUTE</Text>
                  <Text style={styles.tileValue}>{Math.round(o.dropoffDistM)} m</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="images-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>Package Photos</Text>
            </View>
            {photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {photos.map((uri, idx) => (
                  <TouchableOpacity key={`${uri}-${idx}`} activeOpacity={0.9} onPress={() => setPreviewPhoto(uri)}>
                    <Image source={{ uri }} style={styles.dPhoto} resizeMode="cover" onError={() => markFailed(uri)} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.offerNoPhoto}>
                <Ionicons name="image-outline" size={18} color={colors.warning} />
                <Text style={styles.offerNoPhotoText}>
                  {localOnly ? "The sender's photo wasn't uploaded." : "The sender didn't add a photo."}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="cube-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>Package Details</Text>
            </View>
            {o.items.some(i => !!i.description) && (
              <View style={{ gap: 4, marginBottom: 10 }}>
                {o.items.map((it, i) =>
                  !!it.description ? (
                    <Text key={i} style={styles.dItemText} numberOfLines={2}>
                      {o.items.length > 1 ? `${i + 1}. ` : ''}
                      {it.description}
                      {it.boxes ? `  ·  ${it.boxes}` : ''}
                      {it.size ? `  ·  ${it.size}` : ''}
                    </Text>
                  ) : null,
                )}
              </View>
            )}
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>CARGO SIZE</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {o.sizeSummary || `${o.totalItems} ${o.totalItems === 1 ? 'item' : 'items'}`}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>WEIGHT</Text>
                <Text style={styles.tileValue}>{o.weightKg != null ? `${o.weightKg} kg` : '—'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>HANDLING</Text>
                <Text style={[styles.tileValue, o.fragile && { color: ORANGE }]}>
                  {o.fragile ? 'Fragile' : 'Standard'}
                </Text>
              </View>
              {fits !== null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>VEHICLE CAPACITY</Text>
                  <Text style={[styles.tileValue, { color: fits ? colors.success : colors.error }]} numberOfLines={2}>
                    {fits ? `Fits (${cap} kg max)` : `Exceeds max (${cap} kg)`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {hasNotes && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <Ionicons name="chatbubble-ellipses-outline" size={15} color={ORANGE} />
                </View>
                <Text style={styles.cardTitle}>Notes</Text>
              </View>
              {!!o.pickupNote && (
                <View style={[styles.routeNote, { marginBottom: 6 }]}>
                  <Ionicons name="chatbubble-ellipses-outline" size={13} color={ORANGE} />
                  <Text style={styles.routeNoteText}>Pickup: {o.pickupNote}</Text>
                </View>
              )}
              {!!o.dropoffNote && (
                <View style={styles.routeNote}>
                  <Ionicons name="chatbubble-ellipses-outline" size={13} color={ORANGE} />
                  <Text style={styles.routeNoteText}>Drop-off: {o.dropoffNote}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="people-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>People</Text>
            </View>
            {renderPeople(o)}
            <Text style={styles.privacyNote}>Contact details are shared once you accept the delivery.</Text>
          </View>
        </ScrollView>

        <View style={[styles.acceptBar, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View>
            <Text style={styles.eyebrow}>YOU EARN</Text>
            <Text style={styles.acceptPrice}>{money(o.estimated_cost)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.acceptBtn, accepting && { opacity: 0.7 }]}
            onPress={() => acceptRequest(o)}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={styles.acceptBtnText}>Accept Along Route</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderOfferPopup = (o: JobRequest) => {
    const pct = o.isDirectRequest ? 100 : Math.max(0, Math.min(100, (offerSecondsLeft / OFFER_SECONDS) * 100));
    const SHEET_H = Math.round(SCREEN_H * 0.50);

    return (
      <View
        style={{
          height: SHEET_H,
          backgroundColor: colors.card,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          overflow: 'hidden',
          borderTopWidth: 1,
          borderColor: colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.18,
          shadowRadius: 16,
          elevation: 16,
        }}
      >
        <View style={styles.offerTimerTrack}>
          <View
            style={[
              styles.offerTimerFill,
              { width: `${pct}%` as any },
              !o.isDirectRequest && offerSecondsLeft <= 10 && { backgroundColor: colors.error },
            ]}
          />
        </View>

        <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 90 + insets.bottom }}>
          <View style={styles.oTopRow}>
            {renderServicePill(o)}
            {o.matchScore != null && (
              <View style={styles.scoreBadge}>
                <Ionicons name="analytics" size={13} color="#059669" />
                <Text style={styles.scoreBadgeText}>{Math.round(o.matchScore)}% Match</Text>
              </View>
            )}
            {o.isFallback && (
              <View style={styles.fallbackBadge}>
                <Ionicons name="Locate" size={12} color="#FFFFFF" />
                <Text style={styles.fallbackBadgeText}>FALLBACK</Text>
              </View>
            )}
            {offers.length > 1 && <Text style={styles.offerCount}>1 of {offers.length}</Text>}
            <View style={{ flex: 1 }} />
            {!o.isDirectRequest && (
              <View style={styles.offerTimerPill}>
                <Ionicons name="timer-outline" size={13} color={offerSecondsLeft <= 10 ? colors.error : colors.textSecondary} />
                <Text style={[styles.offerTimerText, offerSecondsLeft <= 10 && { color: colors.error }]}>
                  {Math.max(0, offerSecondsLeft)}s
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.offerMainRow, { marginTop: 4 }]}>
            <View>
              <Text style={styles.eyebrow}>TOTAL PAY</Text>
              <Text style={styles.offerPrice}>{money(o.estimated_cost)}</Text>
            </View>
            <Text style={styles.offerCode}>{requestCode(o.request_id)}</Text>
          </View>

          <View style={{ marginTop: 12 }}>
            {renderRingRoute(o)}
          </View>

          <TouchableOpacity
            style={[styles.viewDetailsBtn, { marginTop: 14 }]}
            onPress={() => setDetailRequestId(o.request_id)}
            activeOpacity={0.85}
          >
            <Ionicons name="document-text-outline" size={18} color={ORANGE} />
            <Text style={styles.viewDetailsText}>View Route Corridor Details</Text>
            <Ionicons name="chevron-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.offerBtnRow,
            {
              position: 'absolute', left: 0, right: 0, bottom: 0,
              paddingHorizontal: 18, paddingTop: 12, paddingBottom: 16,
              backgroundColor: colors.card,
              borderTopWidth: 1, borderTopColor: colors.divider,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.declineBtn, { flex: 1 }]}
            onPress={() => dismissOffer(o.request_id)}
            disabled={accepting}
            activeOpacity={0.85}
          >
            <Ionicons name="close" size={18} color={colors.error} />
            <Text style={styles.declineBtnText}>Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.offerAcceptBtn, { flex: 1 }, accepting && { opacity: 0.7 }]}
            onPress={() => acceptRequest(o)}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                <Text style={styles.offerAcceptText}>Accept Match</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBottomPanel = () => {
    const startAddr = splitAddress(activeRoute?.start_location?.street_address);
    const endAddr = splitAddress(activeRoute?.end_location?.street_address);

    const OFF = { title: '#E2E8F0', sub: '#94A3B8', label: '#64748B' };
    const panelBg = modeAnim.interpolate({ inputRange: [0, 1], outputRange: ['#232A3B', colors.card] });
    const ringScale = signal.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
    const ringOpacity = signal.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
    const dotOpacity = dotBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
    const swapRotate = swapAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-ctaW, ctaW] });

    const onSwap = () => {
      swapAnim.setValue(0);
      Animated.timing(swapAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => swapAnim.setValue(0));
      setRoutePickerVisible(true);
    };

    const handleToggleDemo = async (val: boolean) => {
      setDemoModeState(val);
      await setDemoMode(val);
      setTimeout(() => {
        void refreshMatches(providerIdRef.current, activeRouteRef.current, routesRef.current);
      }, 150);
    };

    return (
      <Animated.View style={[styles.dashPanel, { backgroundColor: panelBg, borderTopColor: isOnline ? GREEN : 'rgba(255,255,255,0.05)', paddingBottom: isOnline ? 14 : 22 + insets.bottom, paddingTop: isOnline ? 14 : 20, borderTopWidth: isOnline ? 2 : 1 }]}>
        <View style={[styles.dashBar, { backgroundColor: isOnline ? GREEN : 'rgba(100,116,139,0.35)' }]} />

        <Animated.View style={{ opacity: modeFade }}>
          {/* Header: Renamed to "My Route Requests" per PDF Section 5 */}
          <View style={[styles.dashHead, { marginBottom: 10 }]}>
            <View style={styles.dashHeadLeft}>
              <View style={styles.liveBadge}>
                {isOnline && (
                  <Animated.View style={[styles.liveRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                )}
                <View style={[styles.liveCore, { backgroundColor: isOnline ? GREEN : '#475569' }]} />
              </View>
              <View>
                <Text style={[styles.dashTitle, !isOnline && { color: OFF.title }]}>My Route Requests</Text>
                <Text style={[styles.dashSub, !isOnline && { color: OFF.sub }]}>
                  {!activeRoute
                    ? 'Post a route to see matched deliveries.'
                    : checkingMatches
                      ? 'Scanning route corridor...'
                      : requests.length === 0
                        ? 'No matches on your route yet.'
                        : `${requests.length} matched request${requests.length === 1 ? '' : 's'} on your route`}
                </Text>
              </View>
            </View>
            <View style={[styles.statusPill, isOnline ? styles.statusPillOn : styles.statusPillOff]}>
              <Animated.View style={[styles.statusPillDot, { backgroundColor: isOnline ? GREEN : '#64748B' }, isOnline && { opacity: dotOpacity }]} />
              <Text style={[styles.statusPillText, { color: isOnline ? GREEN : OFF.sub }]}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            </View>
          </View>

          {/* Defense DEMO_MODE Toggle Bar (PDF Section 4) */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 12, paddingVertical: 6, marginBottom: 10, borderRadius: 12,
            backgroundColor: isOnline ? colors.accentSoft : 'rgba(255,117,31,0.14)',
            borderWidth: 1, borderColor: 'rgba(255,117,31,0.35)',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <Ionicons name="flask-outline" size={14} color={ORANGE} />
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: isOnline ? colors.textPrimary : '#E2E8F0' }}>
                Defense DEMO_MODE (1-min fallback & lock)
              </Text>
            </View>
            <Switch
              value={demoMode}
              onValueChange={handleToggleDemo}
              trackColor={{ false: colors.border, true: ORANGE }}
            />
          </View>

          {/* Active Route Block */}
          <View style={[styles.routeBlock, isOnline ? { backgroundColor: colors.background, borderColor: colors.divider, padding: 10, marginBottom: 10 } : styles.routeBlockOff]}>
            <View style={[styles.vehicleChip, isOnline ? { backgroundColor: 'rgba(255,117,31,0.10)' } : { backgroundColor: 'rgba(100,116,139,0.15)', opacity: 0.7 }]}>
              <Text style={{ fontSize: 22 }}>🚐</Text>
              <Animated.View
                style={[
                  styles.vehicleDot,
                  { backgroundColor: isOnline ? GREEN : '#475569', borderColor: isOnline ? colors.card : '#232A3B' },
                  isOnline && { transform: [{ scale: pulseScale }] },
                ]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.routeLabel, !isOnline && { color: OFF.label }]}>
                ACTIVE CORRIDOR ({usedTodayCount}/3 ROUTES TODAY)
              </Text>
              {activeRoute ? (
                <>
                  <Text style={[styles.routeTitle, !isOnline && { color: OFF.sub }]} numberOfLines={1}>
                    {startAddr.main} <Text style={{ color: isOnline ? ORANGE : OFF.label, fontWeight: '900' }}>→</Text> {endAddr.main}
                  </Text>
                  <Text style={[styles.routeDetail, !isOnline && { color: OFF.label }]} numberOfLines={1}>
                    Trunk: {Number(activeRoute.remaining_weight_kg ?? 100).toFixed(0)} kg · {Number(activeRoute.remaining_volume_liters ?? 200).toFixed(0)} L left
                    {activeRoute.fallback_unlocked ? ` · Fallback: ${activeRoute.fallback_used ? 'Used' : 'Unlocked'}` : ''}
                  </Text>
                </>
              ) : (
                <Text style={[styles.routeTitle, !isOnline && { color: OFF.sub }]} numberOfLines={1}>
                  Post a route to see matched deliveries.
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={[styles.swapBtn, isOnline ? { backgroundColor: colors.card, borderColor: colors.border } : styles.swapBtnOff]}
              onPress={onSwap}
              activeOpacity={0.85}
            >
              <Animated.View style={{ transform: [{ rotate: swapRotate }] }}>
                <Ionicons name="swap-horizontal" size={18} color={isOnline ? colors.textPrimary : OFF.sub} />
              </Animated.View>
            </TouchableOpacity>
          </View>

          {/* Two Required Empty States (PDF Section 2 Rule 1 & Section 5) */}
          {!activeRoute ? (
            <View style={{
              marginBottom: 12, backgroundColor: 'rgba(255,117,31,0.12)',
              padding: 14, borderRadius: 14, borderWidth: 1, borderColor: ORANGE,
              alignItems: 'center',
            }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: ORANGE, textAlign: 'center' }}>
                Post a route to see matched deliveries.
              </Text>
              <Text style={{ fontSize: 11.5, color: isOnline ? colors.textSecondary : '#94A3B8', fontWeight: '600', textAlign: 'center', marginTop: 4, lineHeight: 16 }}>
                Rule 1: Providers see zero requests until they post a forward route.
              </Text>
              <TouchableOpacity
                style={{
                  marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: ORANGE, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12,
                }}
                onPress={openAddRouteModal}
                activeOpacity={0.9}
              >
                <Ionicons name="add-circle" size={16} color="#FFFFFF" />
                <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>
                  Post Route ({Math.max(0, 3 - usedTodayCount)} left today)
                </Text>
              </TouchableOpacity>
            </View>
          ) : isOnline && requests.length === 0 ? (
            <View style={{
              marginBottom: 4, backgroundColor: colors.background,
              padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.divider,
              flexDirection: 'row', alignItems: 'center', gap: 10,
            }}>
              <Ionicons name="compass-outline" size={20} color={ORANGE} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.textPrimary }}>
                  No matches on your route yet.
                </Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: 1 }}>
                  Filtering for ≤500 m (Curb-side) or ≤1.5 km (Door-to-Door), forward direction, ≥60% score.
                </Text>
              </View>
            </View>
          ) : null}

          {isOnline ? null : (
            <View style={{ marginTop: 4 }}>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => (activeRoute ? toggleOnlineStatus(true) : openAddRouteModal())}
                activeOpacity={0.9}
                onLayout={e => setCtaW(e.nativeEvent.layout.width)}
              >
                <Animated.View pointerEvents="none" style={[styles.ctaShineWrap, { transform: [{ translateX: shineX }] }]}><View style={styles.ctaShine} /></Animated.View>
                <Text style={styles.ctaText}>{activeRoute ? 'Go Online & Scan Corridor' : 'Post Route to Start'}</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
              </TouchableOpacity>

              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statVal}>{todayStats.count}</Text>
                  <Text style={styles.statLbl}>TODAY</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={[styles.statVal, { color: ORANGE }]}>{money(todayStats.earned).replace('.00', '')}</Text>
                  <Text style={styles.statLbl}>EARNED</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statVal}>{todayStats.rating != null ? `${todayStats.rating.toFixed(1)}★` : '—'}</Text>
                  <Text style={styles.statLbl}>RATING</Text>
                </View>
              </View>
            </View>
          )}

          {locDenied && (
            <TouchableOpacity style={styles.locWarnBottom} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
              <Ionicons name="location-outline" size={16} color={colors.warning} />
              <Text style={styles.locWarnText}>Location is off. Tap to enable.</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </Animated.View>
    );
  };

  const renderMain = () => {
    const fallback = {
      lat: activeRoute?.start_location?.latitude ?? 10.3157,
      lng: activeRoute?.start_location?.longitude ?? 123.8854,
      heading: null as number | null,
    };
    const loc = myLoc ?? fallback;
    const sLoc = activeRoute?.start_location;
    const eLoc = activeRoute?.end_location;
    const mapRoute = sLoc?.latitude != null && sLoc?.longitude != null && eLoc?.latitude != null && eLoc?.longitude != null
      ? { start: { lat: sLoc.latitude, lng: sLoc.longitude }, end: { lat: eLoc.latitude, lng: eLoc.longitude } }
      : null;
    const mapOrder = currentOffer
      && currentOffer.pickup.lat != null && currentOffer.pickup.lng != null
      && currentOffer.dropoff.lat != null && currentOffer.dropoff.lng != null
      ? {
          pickup: { lat: currentOffer.pickup.lat, lng: currentOffer.pickup.lng },
          dropoff: { lat: currentOffer.dropoff.lat, lng: currentOffer.dropoff.lng },
        }
      : null;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ProviderMap
          provider={loc}
          route={mapRoute}
          order={mapOrder}
          online={isOnline}
          recenterTick={recenterTick}
          padBottom={currentOffer ? Math.round(SCREEN_H * 0.50) + 30 : (isOnline ? 150 : 200)}
        />

        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(18,23,36,0.55)', opacity: modeAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
        />

        {!isOnline && (
          <TouchableOpacity
            style={[styles.offlineBack, { top: insets.top + 16 }]}
            onPress={goToTasks}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={22} color="#E2E8F0" />
          </TouchableOpacity>
        )}

        <View style={[styles.mapTools, { top: insets.top + 16 }]} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }}>
            <TouchableOpacity style={[styles.mapToolBtn, !isOnline && styles.mapToolBtnOff]} onPress={handleOpenNotifs} activeOpacity={0.85}>
              <Ionicons name="notifications" size={20} color={isOnline ? colors.textPrimary : '#94A3B8'} />
              {unreadCount > 0 && (
                <View style={[styles.mapToolBadge, !isOnline && { backgroundColor: '#64748B', borderColor: '#1A1F2B' }]}>
                  {unreadCount <= 9 && (<Text style={styles.mapToolBadgeText}>{unreadCount}</Text>)}
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
          <TouchableOpacity style={[styles.mapToolBtn, !isOnline && styles.mapToolBtnOff]} onPress={goToManageRoutes} activeOpacity={0.85}>
            <Ionicons name="settings-sharp" size={20} color={isOnline ? colors.textPrimary : '#94A3B8'} />
          </TouchableOpacity>
          <View style={{ height: 4 }} />
          <TouchableOpacity style={[styles.mapToolBtn, !isOnline && styles.mapToolBtnOff]} onPress={() => setRecenterTick(t => t + 1)} activeOpacity={0.85}>
            <Ionicons name="locate" size={20} color={isOnline ? colors.textPrimary : '#94A3B8'} />
          </TouchableOpacity>

          <View style={!isOnline && styles.toolDim} pointerEvents={isOnline ? 'auto' : 'none'}>
            <TouchableOpacity style={[styles.mapToolBtn, styles.sosBtn, !isOnline && { backgroundColor: '#475569', borderColor: '#475569' }]} onPress={triggerSOS} activeOpacity={0.85}>
              <Ionicons name="shield" size={20} color={isOnline ? '#FFFFFF' : '#94A3B8'} />
            </TouchableOpacity>
          </View>

          {isOnline && (
            <TouchableOpacity style={[styles.mapToolBtn, styles.powerBtn, { width: 50, height: 50, borderRadius: 25 }]} onPress={() => toggleOnlineStatus(false)} activeOpacity={0.85}>
              <Ionicons name="power" size={24} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>

        <Animated.View style={[styles.bottomWrap, { opacity: contentAnim }]} pointerEvents="box-none">
          {currentOffer ? renderOfferPopup(currentOffer) : renderBottomPanel()}
        </Animated.View>
      </View>
    );
  };

  const renderNotifModal = () => (
    <Modal visible={notifModalOpen} transparent animationType="fade" onRequestClose={() => setNotifModalOpen(false)}>
      <Pressable style={styles.notifBackdrop} onPress={() => setNotifModalOpen(false)}>
        <Pressable style={[styles.notifCard, { marginTop: insets.top + 60 }]} onPress={() => { /* swallow */ }}>
          <View style={styles.notifHeader}>
            <Text style={styles.notifHeaderTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setNotifModalOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {notifLoading ? (
            <View style={styles.notifCenter}><ActivityIndicator size="small" color={ORANGE} /></View>
          ) : notifs.length === 0 ? (
            <View style={styles.notifCenter}>
              <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
              <Text style={styles.notifEmptyText}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={notifs.slice(0, 8)}
              keyExtractor={(i) => String(i.notif_id)}
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.notifRow, !item.is_read && styles.notifRowUnread]} onPress={() => handleNotifPress(item)} activeOpacity={0.85}>
                  <View style={styles.notifIconBox}>
                    <Ionicons name={iconForType(item.type)} size={18} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.notifTitleRow}>
                      <Text style={styles.notifTitle} numberOfLines={1}>{titleForType(item.type, item.title)}</Text>
                      {!item.is_read && <View style={styles.notifDot} />}
                    </View>
                    <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                    <Text style={styles.notifTime}>{ago(item.created_at)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.notifFooter} onPress={() => { setNotifModalOpen(false); setFullListOpen(true); }} activeOpacity={0.85}>
            <Text style={styles.notifFooterText}>See all in Notifications</Text>
            <Ionicons name="arrow-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderFullListModal = () => (
    <Modal visible={fullListOpen} animationType="slide" onRequestClose={() => setFullListOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
          backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider,
        }}>
          <TouchableOpacity onPress={() => setFullListOpen(false)} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }} activeOpacity={0.7} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: colors.textPrimary, letterSpacing: -0.3 }}>
            Notifications
          </Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={{ flex: 1 }}>
          <NotificationsList embedded role="provider" />
        </View>
      </View>
    </Modal>
  );

  const renderAddRouteModal = () => (
    <Modal
      visible={addRouteModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => setAddRouteModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.addRouteSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.addRouteHandle} />
          <View style={styles.addRouteHeader}>
            <TouchableOpacity onPress={() => setAddRouteModalVisible(false)} style={styles.addRouteCloseBtn}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.addRouteTitle}>Post a Route ({usedTodayCount}/3 today)</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView contentContainerStyle={styles.addRouteScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.guardrailNotice}>
              <Ionicons name="shield-checkmark-outline" size={16} color={ORANGE} />
              <Text style={styles.guardrailNoticeText}>
                Guardrail: Post ≥2 hrs early for Condition B fallback · Destinations must be ≥3 km apart · Max 4-hr window.
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Route Locations</Text>
              <TouchableOpacity
                style={styles.locationSelectorBtn}
                onPress={() => { setRouteLocationPickerType('start'); setRouteLocationPickerVisible(true); }}
                activeOpacity={0.85}
              >
                <View style={[styles.locSelectorIcon, newRouteStart && { backgroundColor: ORANGE }]}>
                  <Ionicons name="radio-button-on" size={14} color="#FFF" />
                </View>
                <Text style={styles.locationSelectorText} numberOfLines={1}>
                  {newRouteStart ? newRouteStart.street_address : 'Set Starting Point'}
                </Text>
              </TouchableOpacity>
              <View style={{ height: 10 }} />
              <TouchableOpacity
                style={styles.locationSelectorBtn}
                onPress={() => { setRouteLocationPickerType('end'); setRouteLocationPickerVisible(true); }}
                activeOpacity={0.85}
              >
                <View style={[styles.locSelectorIcon, newRouteEnd && { backgroundColor: BLACK }]}>
                  <Ionicons name="location" size={14} color="#FFF" />
                </View>
                <Text style={styles.locationSelectorText} numberOfLines={1}>
                  {newRouteEnd ? newRouteEnd.street_address : 'Set Destination (≥3 km apart)'}
                </Text>
              </TouchableOpacity>
            </View>

            {newRouteStart && newRouteEnd && (
              <View style={styles.modalMapContainer}>
                <MapView
                  ref={addRoutePreviewMapRef}
                  style={StyleSheet.absoluteFill}
                  provider={PROVIDER_GOOGLE}
                  userInterfaceStyle="light"
                  initialRegion={{
                    latitude: newRouteStart.latitude,
                    longitude: newRouteStart.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                  showsCompass={false}
                  toolbarEnabled={false}
                >
                  <Marker coordinate={{ latitude: newRouteStart.latitude, longitude: newRouteStart.longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                    <View style={[styles.mkDot, { backgroundColor: BLUE }]}><Text style={styles.mkDotText}>S</Text></View>
                  </Marker>
                  <Marker coordinate={{ latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                    <View style={[styles.mkDot, { backgroundColor: RED }]}><Text style={styles.mkDotText}>E</Text></View>
                  </Marker>
                  {newRoutePreviewCoords.length > 0 && (
                    <Polyline coordinates={newRoutePreviewCoords} strokeColor={BLUE} strokeWidth={4} />
                  )}
                </MapView>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Route Frequency</Text>
              <View style={styles.frequencyOptions}>
                {FREQUENCIES.map(freq => (
                  <TouchableOpacity
                    key={freq}
                    style={[styles.frequencyOption, newRouteFrequency === freq && styles.frequencyOptionSelected]}
                    onPress={() => setNewRouteFrequency(freq)}
                  >
                    <Text style={[styles.frequencyOptionText, newRouteFrequency === freq && styles.frequencyOptionTextSelected]}>
                      {freq}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Active Time Window (Max 4 Hours)</Text>
              <View style={styles.frequencyOptions}>
                {[1, 2, 3, 4].map(hr => (
                  <TouchableOpacity
                    key={hr}
                    style={[styles.frequencyOption, newRouteDurationHours === hr && styles.frequencyOptionSelected]}
                    onPress={() => setNewRouteDurationHours(hr)}
                  >
                    <Text style={[styles.frequencyOptionText, newRouteDurationHours === hr && styles.frequencyOptionTextSelected]}>
                      {hr} {hr === 1 ? 'hr' : 'hrs'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {newRouteFrequency === 'Daily' ? (
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Departure Time (Today)</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={ORANGE} />
                  <Text style={styles.dateTimeValue}>
                    {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
                {newRouteShowTimePicker && (
                  <DateTimePicker
                    value={newRouteDepartureTime}
                    mode="time"
                    onChange={(e, t) => {
                      setNewRouteShowTimePicker(Platform.OS === 'ios');
                      if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                    }}
                  />
                )}
              </View>
            ) : newRouteFrequency === 'Weekly' ? (
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Repeats on</Text>
                <View style={styles.weekdayRow}>
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.weekdayChip, newRouteSelectedWeekday === idx && styles.weekdayChipActive]}
                      onPress={() => setNewRouteSelectedWeekday(idx)}
                    >
                      <Text style={[styles.weekdayChipText, newRouteSelectedWeekday === idx && styles.weekdayChipTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 14 }} />
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={ORANGE} />
                  <Text style={styles.dateTimeValue}>
                    {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
                {newRouteShowTimePicker && (
                  <DateTimePicker
                    value={newRouteDepartureTime}
                    mode="time"
                    onChange={(e, t) => {
                      setNewRouteShowTimePicker(Platform.OS === 'ios');
                      if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                    }}
                  />
                )}
              </View>
            ) : (
              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowDatePicker(true)}>
                    <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{newRouteDepartureDate.toLocaleDateString()}</Text>
                  </TouchableOpacity>
                  {newRouteShowDatePicker && (
                    <DateTimePicker
                      value={newRouteDepartureDate}
                      mode="date"
                      minimumDate={new Date()}
                      onChange={(e, d) => {
                        setNewRouteShowDatePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && d) setNewRouteDepartureDate(d);
                      }}
                    />
                  )}
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Time</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>
                      {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                  {newRouteShowTimePicker && (
                    <DateTimePicker
                      value={newRouteDepartureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setNewRouteShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                      }}
                    />
                  )}
                </View>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Vehicle</Text>
              {newRouteVehicles.length === 0 ? (
                <View style={styles.noVehiclesBox}>
                  <Ionicons name="car-outline" size={20} color={colors.warning} />
                  <Text style={styles.noVehiclesText}>
                    No verified vehicles found. Add and verify a vehicle first.
                  </Text>
                </View>
              ) : (
                <View style={styles.vehicleOptions}>
                  {newRouteVehicles.map(v => (
                    <TouchableOpacity
                      key={v.vehicle_id}
                      style={[styles.vehicleOption, newRouteVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                      onPress={() => setNewRouteVehicleId(v.vehicle_id)}
                    >
                      <Ionicons
                        name="car-sport"
                        size={14}
                        color={newRouteVehicleId === v.vehicle_id ? '#FFF' : colors.textSecondary}
                      />
                      <Text style={[styles.vehicleOptionText, newRouteVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                        {v.plate_number}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, newRouteSubmitting && { opacity: 0.7 }]}
              onPress={handleAddRouteSubmit}
              disabled={newRouteSubmitting}
              activeOpacity={0.9}
            >
              {newRouteSubmitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>Post Route</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading route matching...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />

      {detailRequestId != null ? renderFullDetails() : renderMain()}

      {renderNotifModal()}
      {renderFullListModal()}

      {/* Route Picker Modal */}
      <Modal visible={routePickerVisible} transparent animationType="slide" onRequestClose={() => setRoutePickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.routePickerSheet}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <Text style={styles.routePickerTitle}>Select Active Route ({usedTodayCount}/3 today)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity
                  style={[styles.addRouteHeaderBtn, usedTodayCount >= 3 && { opacity: 0.45 }]}
                  onPress={() => { setRoutePickerVisible(false); openAddRouteModal(); }}
                  activeOpacity={0.85}
                  hitSlop={8}
                >
                  <Ionicons name="add" size={20} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setRoutePickerVisible(false)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {routes.length === 0 ? (
              <View style={styles.routePickerEmpty}>
                <Ionicons name="map-outline" size={40} color={ORANGE} />
                <Text style={styles.routePickerEmptyTitle}>Post a route to see matched deliveries.</Text>
                <Text style={styles.routePickerEmptySub}>
                  Rule 1: Providers see zero requests until they post a route.
                </Text>
                <TouchableOpacity
                  style={styles.createQuickRouteBtn}
                  onPress={() => { setRoutePickerVisible(false); openAddRouteModal(); }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add-circle" size={16} color="#FFFFFF" />
                  <Text style={styles.createQuickRouteBtnText}>Post a Route</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.emptyManageRouteBtn} onPress={goToManageRoutes} activeOpacity={0.85}>
                  <Ionicons name="map-outline" size={16} color={ORANGE} />
                  <Text style={styles.emptyManageRouteText}>Manage Routes</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {routes.map((r) => {
                  const isSelected = activeRoute?.route_id === r.route_id;
                  const rDate = parseNaiveIsoString(r.departure_time);
                  const timeStr = rDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const scheduleLabel =
                    r.route_frequency === 'Daily'
                      ? `Every day · ${timeStr}`
                      : r.route_frequency === 'Weekly'
                        ? `Every ${WEEKDAY_LABELS[rDate.getDay()]} · ${timeStr}`
                        : `${rDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${timeStr}`;

                  const startAddr = splitAddress(r.start_location?.street_address);
                  const endAddr = splitAddress(r.end_location?.street_address);

                  return (
                    <TouchableOpacity
                      key={r.route_id}
                      style={[styles.routeOption, isSelected && styles.routeOptionSelected]}
                      onPress={async () => {
                        setActiveRoute(r);
                        activeRouteRef.current = r;
                        await setActiveRouteId(r.route_id);
                        setRoutePickerVisible(false);
                        await refreshMatches(providerIdRef.current, r, routesRef.current);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.routeOptionDot, { backgroundColor: isSelected ? ORANGE : colors.textMuted }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeOptionTitle} numberOfLines={1}>
                          {startAddr.main} → {endAddr.main}
                        </Text>
                        <Text style={styles.routeOptionSub} numberOfLines={1}>
                          {scheduleLabel} · {r.route_frequency}
                        </Text>
                      </View>
                      {isSelected && <Ionicons name="checkmark-circle" size={22} color={ORANGE} />}
                    </TouchableOpacity>
                  );
                })}
                <View style={{ height: 30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {renderAddRouteModal()}

      {termsModal}

      <RouteLocationPickerModal
        visible={routeLocationPickerVisible}
        onClose={() => setRouteLocationPickerVisible(false)}
        onSelect={(loc) => handleNewRouteLocationSelect(loc, routeLocationPickerType)}
        initialCoords={
          routeLocationPickerType === 'start'
            ? (newRouteStart ? { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude } : undefined)
            : (newRouteEnd ? { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude } : undefined)
        }
        title={routeLocationPickerType === 'start' ? 'Starting Point' : 'Destination'}
        pinColor={routeLocationPickerType === 'start' ? ORANGE : BLACK}
        colors={colors}
        isDark={isDark}
      />

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          {!!previewPhoto && <Image source={{ uri: previewPhoto }} style={styles.previewImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.previewClose, { top: insets.top + 12 }]} onPress={() => setPreviewPhoto(null)} activeOpacity={0.85}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

/* ==================================================================== */
/* Styles                                                               */
/* ==================================================================== */
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  mapTools: { position: 'absolute', right: 12, gap: 10 },
  mapToolBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.15 : 0.4,
    shadowRadius: 8, elevation: 5,
    borderWidth: 1, borderColor: c.border,
  },
  sosBtn: { backgroundColor: c.error, borderColor: c.error },
  mapToolBadge: {
    position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18,
    borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.error,
    borderWidth: 1.5, borderColor: c.card, justifyContent: 'center', alignItems: 'center',
  },
  mapToolBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  offlineBack: { position: 'absolute', left: 14, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(30,38,54,0.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', zIndex: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6 },
  mapToolBtnOff: { backgroundColor: 'rgba(30,38,54,0.88)', borderColor: 'rgba(255,255,255,0.05)' },
  toolDim: { opacity: 0.35 },

  dashPanel: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 22, borderTopWidth: 1, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: -12 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 18 },
  dashBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  dashHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  dashHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  liveBadge: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  liveRing: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: GREEN },
  liveCore: { width: 24, height: 24, borderRadius: 12 },
  dashTitle: { fontSize: 17, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.4 },
  dashSub: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  statusPillOn: { backgroundColor: 'rgba(16,185,129,0.12)' },
  statusPillOff: { backgroundColor: 'rgba(100,116,139,0.15)' },
  statusPillDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  routeBlock: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 18, borderWidth: 1, marginBottom: 14 },
  routeBlockOff: { backgroundColor: 'rgba(15,20,32,0.6)', borderColor: 'rgba(255,255,255,0.04)' },
  vehicleChip: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  vehicleDot: { position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  routeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: c.textMuted },
  routeTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 3, letterSpacing: -0.2 },
  routeDetail: { fontSize: 11.5, fontWeight: '600', color: c.textSecondary, marginTop: 3 },
  swapBtn: { width: 44, height: 44, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  swapBtnOff: { backgroundColor: 'rgba(30,38,54,0.8)', borderColor: 'rgba(255,255,255,0.06)' },
  powerBtn: { borderColor: 'rgba(239,68,68,0.35)' },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 16, backgroundColor: ORANGE, overflow: 'hidden', shadowColor: ORANGE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  ctaShineWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 90 },
  ctaShine: { flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', transform: [{ skewX: '-20deg' }] },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  statsGrid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(15,20,32,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  statVal: { fontSize: 16, fontWeight: '900', color: '#E2E8F0', letterSpacing: -0.3 },
  statLbl: { fontSize: 9, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 4 },
  locWarnBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingVertical: 6 },
  locWarnText: { fontSize: 12, fontWeight: '600', color: c.warning },
  svcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  svcPillText: { fontSize: 12, fontWeight: '800', color: BLUE },
  oTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  rtRow: { flexDirection: 'row', gap: 14 },
  rtRail: { alignItems: 'center', width: 26 },
  rtRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  rtRingDot: { width: 8, height: 8, borderRadius: 4 },
  rtDots: { position: 'absolute', top: 30, bottom: -4, alignItems: 'center', justifyContent: 'space-evenly' },
  rtDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.border },
  rtText: { flex: 1 },
  rtLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  rtMain: { fontSize: 18, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.2, marginTop: 1 },
  rtSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  mcRow: { flexDirection: 'row', gap: 10 },
  mcCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.divider, padding: 10 },
  mcAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mcAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  mcRole: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  mcName: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  dCode: { fontSize: 26, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.5 },
  dWhen: { fontSize: 12, fontWeight: '700', color: ORANGE, marginTop: 2 },
  dPhoto: { width: 92, height: 92, borderRadius: 14, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  dItemText: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  tileValue: { fontSize: 16, fontWeight: '900', color: c.textPrimary, marginTop: 4 },

  card: {
    backgroundColor: c.card, borderRadius: 20, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.3,
    shadowRadius: 8, elevation: 1,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardHeaderIcon: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  scoreBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(5,150,105,0.12)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
  },
  scoreBadgeText: { fontSize: 11.5, fontWeight: '800', color: '#059669' },
  fallbackBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: PURPLE, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8,
  },
  fallbackBadgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.4 },
  routeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: 'rgba(255,117,31,0.10)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  routeNoteText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.textPrimary, fontWeight: '600' },
  privacyNote: { marginTop: 14, fontSize: 11, color: c.textMuted, fontWeight: '600' },
  earnCard: { backgroundColor: ORANGE, borderRadius: 20, padding: 18, marginBottom: 14 },
  earnLabel: { color: '#FFE4D2', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  earnValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', marginTop: 4 },
  earnNote: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 10,
  },
  earnNoteText: { flex: 1, color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '600' },

  acceptBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.card,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05, shadowRadius: 5, elevation: 10,
  },
  acceptPrice: { fontSize: 22, fontWeight: '900', color: ORANGE, marginTop: 2 },
  acceptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16, minWidth: 180,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  acceptBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  offerTimerTrack: { height: 5, backgroundColor: c.border },
  offerTimerFill: { height: '100%', backgroundColor: ORANGE },
  offerCount: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  offerTimerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.divider, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
  },
  offerTimerText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  offerMainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  offerPrice: { fontSize: 32, fontWeight: '900', color: c.textPrimary, letterSpacing: -1, marginTop: 2 },
  offerCode: { fontSize: 13, fontWeight: '800', color: c.textMuted },
  offerNoPhoto: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14,
    backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
    borderRadius: 12, padding: 12,
  },
  offerNoPhotoText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.warning, fontWeight: '600' },
  offerBtnRow: { flexDirection: 'row', gap: 10, borderTopWidth: 1, borderTopColor: c.divider },
  declineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 15, borderRadius: 16, backgroundColor: c.errorBg,
    borderWidth: 1, borderColor: c.error,
  },
  declineBtnText: { fontSize: 15, fontWeight: '800', color: c.error },
  offerAcceptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 16, backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  offerAcceptText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },

  viewDetailsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 18, paddingVertical: 14, borderRadius: 14,
    backgroundColor: c.accentSoft, borderWidth: 1.5, borderColor: ORANGE,
  },
  viewDetailsText: { fontSize: 14, fontWeight: '800', color: ORANGE },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: c.textSecondary, fontWeight: '600' },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  routePickerSheet: {
    backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  routePickerHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
    alignSelf: 'center', marginBottom: 14,
  },
  routePickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  routePickerTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  routePickerEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  routePickerEmptyTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary, marginTop: 8 },
  routePickerEmptySub: { fontSize: 12, color: c.textSecondary, textAlign: 'center', paddingHorizontal: 20, marginBottom: 8 },
  addRouteHeaderBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  emptyManageRouteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    backgroundColor: c.accentSoft, marginTop: 6,
  },
  emptyManageRouteText: { fontSize: 13, fontWeight: '800', color: ORANGE },
  createQuickRouteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 10 },
  createQuickRouteBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  routeOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    backgroundColor: c.background, borderRadius: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  routeOptionSelected: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  routeOptionDot: { width: 10, height: 10, borderRadius: 5 },
  routeOptionTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  routeOptionSub: { fontSize: 11, color: c.textSecondary, marginTop: 2, fontWeight: '500' },

  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekdayChip: {
    flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5,
    borderColor: c.border, alignItems: 'center', backgroundColor: c.card,
  },
  weekdayChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  weekdayChipTextActive: { color: '#FFF' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  inputGroup: { flex: 1 },
  inputLabel: { marginBottom: 6, fontWeight: '700', color: c.textPrimary, fontSize: 11, letterSpacing: 0.2 },
  dateTimeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  dateTimeValue: { fontSize: 13, color: c.textPrimary, fontWeight: '600' },

  notifBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', paddingHorizontal: 16 },
  notifCard: {
    backgroundColor: c.card, borderRadius: 20,
    paddingTop: 6, paddingBottom: 4, maxHeight: '78%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 20, elevation: 12,
    borderWidth: 1, borderColor: c.border,
  },
  notifHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  notifHeaderTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  notifCenter: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  notifEmptyText: { marginTop: 10, color: c.textMuted, fontSize: 13, fontWeight: '600' },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  notifRowUnread: { backgroundColor: c.accentSoft },
  notifIconBox: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
  },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: c.textPrimary },
  notifDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: ORANGE },
  notifBody: { fontSize: 12.5, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
  notifTime: { fontSize: 10.5, color: c.textMuted, marginTop: 5, fontWeight: '600' },
  notifFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.divider,
  },
  notifFooterText: { color: ORANGE, fontWeight: '800', fontSize: 13 },

  addRouteSheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 8, maxHeight: '94%', flex: 1,
  },
  addRouteHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: c.border, marginTop: 6, marginBottom: 6,
  },
  addRouteHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  addRouteCloseBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
  },
  addRouteTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  addRouteScroll: { padding: 20, paddingBottom: 40 },

  guardrailNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.accentSoft, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,117,31,0.3)', marginBottom: 16,
  },
  guardrailNoticeText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: c.textPrimary, lineHeight: 17 },

  formGroup: { marginBottom: 20 },
  locationSelectorBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.background,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, gap: 12,
  },
  locSelectorIcon: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
  },
  locationSelectorText: { flex: 1, fontWeight: '700', color: c.textPrimary, fontSize: 14 },
  modalMapContainer: {
    height: 160, borderRadius: 16, overflow: 'hidden', marginBottom: 20,
    borderWidth: 1, borderColor: c.border,
  },

  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card,
  },
  frequencyOptionSelected: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  frequencyOptionTextSelected: { color: ORANGE, fontWeight: '800' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.background, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5, borderColor: c.border,
  },
  vehicleOptionActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFF' },

  noVehiclesBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
    borderRadius: 12, padding: 12,
  },
  noVehiclesText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.warning },

  submitBtn: {
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 6,
  },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '900' },

  mkDot: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  mkDotText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
});