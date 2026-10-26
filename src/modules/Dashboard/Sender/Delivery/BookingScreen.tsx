// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Platform, Modal, Alert, ActivityIndicator, ScrollView,
  Animated, Easing, Linking, StatusBar, FlatList, Pressable, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { supabase } from '../../../../utils/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getActiveRouteId, setActiveRouteId } from '../../../../services/activeRouteStore';
import { findMatches } from '../../../../services/matchingService';
import { notifyUser } from '../../../../services/pushService';
import NotificationsList from '../../Disputes/NotificationsList';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { routeNotification, NotifRow } from '../../../../utils/notifRouter';
import { MAP_PROPS } from '../../../../utils/mapConfig';
import { setTabBarHidden } from '../../../../services/tabBarVisibilityStore';
import { isRouteExpired } from '../../Provider/Manage/ManageRoutesScreen';

const ORANGE = '#FF751F';
const GREEN = '#10B981';
const OFFER_SECONDS = 45;
const CARGO_PHOTO_BUCKET = 'cargo-photos';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  cargo_length_cm: number;
  cargo_width_cm: number;
  cargo_height_cm: number;
  verification_status: string;
}
interface Route {
  route_id: number;
  departure_time: string;
  route_frequency: string;
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
  weightKg: number | null;
  fragile: boolean;
  dims: string | null;
  senderName: string;
  receiverName: string | null;
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  isDirectRequest?: boolean;
}

type Notif = NotifRow;

const toNaiveIsoString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
};

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

const normalizeRequest = (r: any, senders: Record<number, string>, currentProviderId?: number | null): JobRequest => {
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
  const prefRouteId = r.preferred_route_id != null ? Number(r.preferred_route_id) : null;
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
    weightKg: Number(cargo?.total_weight_kg) || null,
    fragile: items.some(i => i.fragile) || !!cargo?.is_fragile,
    dims,
    senderName: senders[r.sender_id] || 'Sender',
    receiverName: r.receiver?.receiver_name || [r.receiver?.first_name, r.receiver?.last_name].filter(Boolean).join(' ') || null,
    preferred_provider_id: prefProviderId,
    preferred_route_id: prefRouteId,
    isDirectRequest,
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
  zoneBadge: {
    backgroundColor: '#FFFFFF', borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: '#FFD2B0',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15, shadowRadius: 2, elevation: 1,
  },
  zoneBadgeText: { fontSize: 10, fontWeight: '800', color: '#9A4A12' },
  meMarker: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  meHalo: {
    position: 'absolute', width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,117,31,0.25)',
  },
  meDot: {
    position: 'absolute', left: 11, top: 11,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#FF751F', borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 3,
  },
  meArrowWrap: { position: 'absolute', width: 44, height: 44 },
  meArrow: {
    position: 'absolute', left: 17, top: -4,
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 10,
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
const ProviderMap = ({ provider, route, order, demand, recenterTick, padBottom, online = true }: any) => {
  const mapRef = useRef<MapView>(null);
  const haloAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!online) { haloAnim.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloAnim, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(haloAnim, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [online, haloAnim]);
  const haloScale = haloAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
  const haloOpacity = haloAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
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
  }, [order?.pickup?.lat, order?.pickup?.lng, order?.dropoff?.lat, order?.dropoff?.lng]);

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
  }, [recenterTick]);

  const demandZones = provider && demand
    ? [
        { dLat: 0.007, dLng: 0.005, mult: 1.8, label: '1.8x' },
        { dLat: -0.006, dLng: 0.008, mult: 1.4, label: '1.4x' },
        { dLat: 0.004, dLng: -0.009, mult: 1.6, label: '1.6x' },
        { dLat: -0.008, dLng: -0.005, mult: 1.1, label: '1.1x' },
      ]
    : [];

  return (
    <MapView
      ref={mapRef}
      {...MAP_PROPS}
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
      {demandZones.map((z, i) => {
        const center = { latitude: provider.lat + z.dLat, longitude: provider.lng + z.dLng };
        return (
          <React.Fragment key={`dz-${i}`}>
            <Circle center={center} radius={450 + z.mult * 300} strokeColor="rgba(255,117,31,0.9)" strokeWidth={1} fillColor="rgba(255,117,31,0.25)" />
            <Marker coordinate={center} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={mapStyles.zoneBadge}>
                <Text style={mapStyles.zoneBadgeText}>{z.label} demand</Text>
              </View>
            </Marker>
          </React.Fragment>
        );
      })}

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
        <Marker coordinate={{ latitude: provider.lat, longitude: provider.lng }} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges>
          <View style={mapStyles.meMarker}>
            <Animated.View style={[mapStyles.meHalo, !online && { backgroundColor: 'rgba(100,116,139,0.22)' }, { transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
            {provider.heading != null && (
              <View style={[mapStyles.meArrowWrap, { transform: [{ rotate: `${provider.heading}deg` }] }]}>
                <View style={mapStyles.meArrow} />
              </View>
            )}
            <View style={[mapStyles.meDot, !online && { backgroundColor: '#64748B' }]} />
          </View>
        </Marker>
      )}
    </MapView>
  );
};

const BLUE = '#3B82F6';
const RED = '#EF4444';
const PURPLE = '#8B5CF6';

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);

  const [requests, setRequests] = useState<JobRequest[]>([]);
  const [checkingMatches, setCheckingMatches] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  // Full-screen details for an offer
  const [detailRequestId, setDetailRequestId] = useState<number | null>(null);

  const [routePickerVisible, setRoutePickerVisible] = useState(false);

  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [showDemand, setShowDemand] = useState(false);

  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  const [offerSecondsLeft, setOfferSecondsLeft] = useState(OFFER_SECONDS);
  const [todayStats, setTodayStats] = useState<{ count: number; earned: number; rating: number | null }>({ count: 0, earned: 0, rating: null });

  const [confirmSheetVisible, setConfirmSheetVisible] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<Route | null>(null);
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedWeekday, setSelectedWeekday] = useState<number>(new Date().getDay());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifChannelRef = useRef<string>(
    `provider-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  const [fullListOpen, setFullListOpen] = useState(false);

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
    if (!isOnline) { signal.setValue(0); dotBlink.setValue(0); return; }
    const ring = Animated.loop(Animated.timing(signal, { toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    const blink = Animated.loop(Animated.sequence([
      Animated.timing(dotBlink, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(dotBlink, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    ring.start(); blink.start();
    return () => { ring.stop(); blink.stop(); };
  }, [isOnline, signal, dotBlink]);

  useEffect(() => {
    if (isOnline) { shine.setValue(0); return; }
    const sweep = Animated.loop(Animated.sequence([
      Animated.timing(shine, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    sweep.start();
    return () => sweep.stop();
  }, [isOnline, shine]);

  useEffect(() => {
    if (!isOnline) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(onlinePulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(onlinePulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isOnline, onlinePulse]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [bellPulse]);

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
          title: '🎯 New Delivery Request!',
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

    if (type.startsWith('support')) {
      setFullListOpen(true);
      return;
    }

    const handled = await routeNotification(navigation, n, { role: 'provider' });
    if (!handled) {
      Alert.alert(n.title || 'Notification', n.body || '');
    }
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

  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase.from('users').select('user_id, is_online').eq('auth_id', user.id).single();
      if (error) throw error;
      setProviderId(userData.user_id);
      setIsOnline(!!(userData as any).is_online);
      void loadTodayStats(userData.user_id);
      return userData.user_id;
    } catch { return null; }
  };

  const hasDirectOffers = requests.some(r => r.isDirectRequest && !dismissedIds.includes(r.request_id));

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(!loading && !isOnline && !hasDirectOffers);
      return () => setTabBarHidden(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOnline, loading, hasDirectOffers]),
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

  const createQuickRoute = async (pid: number) => {
    try {
      setLoading(true);

      let vehicleId: number | null = null;
      const { data: vehData } = await supabase
        .from('vehicles')
        .select('vehicle_id, vehicle_type, plate_number')
        .eq('provider_id', pid)
        .limit(1)
        .maybeSingle();

      let resolvedVehicle: any = vehData;
      if (vehData) {
        vehicleId = vehData.vehicle_id;
      } else {
        const { data: newVeh, error: vehErr } = await supabase
          .from('vehicles')
          .insert({
            provider_id: pid,
            vehicle_type: 'Motorcycle / Van',
            plate_number: 'PNS-999',
            max_volume_liters: 500,
            max_weight_kg: 100,
            cargo_length_cm: 100,
            cargo_width_cm: 100,
            cargo_height_cm: 100,
            verification_status: 'Verified',
          })
          .select('*')
          .single();
        if (vehErr) throw vehErr;
        vehicleId = newVeh.vehicle_id;
        resolvedVehicle = newVeh;
      }

      const curLat = myLoc?.lat ?? 10.3157;
      const curLng = myLoc?.lng ?? 123.8854;

      const resolveLocation = async (lat: number, lng: number, fallbackLabel: string) => {
        const { data: existing } = await supabase
          .from('locations')
          .select('*')
          .eq('latitude', lat)
          .eq('longitude', lng)
          .limit(1);

        if (existing && existing.length > 0) return existing[0];

        const { data: created, error } = await supabase
          .from('locations')
          .insert({
            street_address: fallbackLabel,
            barangay: 'Unknown',
            city: 'Unknown',
            province: 'Unknown',
            zip_code: '0000',
            latitude: lat,
            longitude: lng,
          })
          .select('*')
          .single();
        if (error) throw error;
        return created;
      };

      const startLoc = await resolveLocation(curLat, curLng, `Current Location (${curLat.toFixed(4)}, ${curLng.toFixed(4)})`);
      const endLat = curLat + 0.03;
      const endLng = curLng + 0.03;
      const endLoc = await resolveLocation(endLat, endLng, `Destination (${endLat.toFixed(4)}, ${endLng.toFixed(4)})`);

      const nowIso = toNaiveIsoString(new Date());
      const { data: simpleRoute, error: simpleErr } = await supabase
        .from('provider_routes')
        .insert({
          provider_id: pid,
          vehicle_id: vehicleId,
          start_location_id: startLoc.location_id,
          end_location_id: endLoc.location_id,
          departure_time: nowIso,
          route_frequency: 'On-Demand',
        })
        .select('*')
        .single();
      if (simpleErr) throw simpleErr;

      const builtRoute: Route = {
        ...simpleRoute,
        start_location: startLoc,
        end_location: endLoc,
        vehicle: resolvedVehicle,
      };

      setActiveRoute(builtRoute);
      await setActiveRouteId(builtRoute.route_id);
      await fetchRoutes(pid);
      return builtRoute;
    } catch (err: any) {
      console.error('Failed to create quick route:', err);
      Alert.alert('Error', err?.message || 'Could not create active route.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchRoutes = async (pid: number) => {
    try {
      let { data, error } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
        `)
        .eq('provider_id', pid).order('created_at', { ascending: false });

      if (error || !data) {
        const { data: fkData, error: fkError } = await supabase
          .from('provider_routes')
          .select(`
            *,
            start_location:locations!start_location_id(*),
            end_location:locations!end_location_id(*),
            vehicle:vehicles(*)
          `)
          .eq('provider_id', pid).order('created_at', { ascending: false });
        if (!fkError && fkData) { data = fkData; error = null; }
      }

      let list: Route[] = [];

      if (error || !data || data.length === 0) {
        const { data: simpleRoutes } = await supabase.from('provider_routes').select('*').eq('provider_id', pid).order('created_at', { ascending: false });
        if (simpleRoutes && simpleRoutes.length > 0) {
          const locIds = Array.from(new Set(simpleRoutes.flatMap((r) => [r.start_location_id, r.end_location_id]).filter(Boolean)));
          const vIds = Array.from(new Set(simpleRoutes.map((r) => r.vehicle_id).filter(Boolean)));
          const { data: locs } = locIds.length > 0
            ? await supabase.from('locations').select('*').in('location_id', locIds)
            : { data: [] };
          const { data: vehs } = vIds.length > 0
            ? await supabase.from('vehicles').select('*').in('vehicle_id', vIds)
            : { data: [] };
          const locMap = new Map((locs || []).map((l: any) => [l.location_id, l]));
          const vehMap = new Map((vehs || []).map((v: any) => [v.vehicle_id, v]));
          list = simpleRoutes.map((r: any) => ({
            ...r,
            start_location: locMap.get(r.start_location_id),
            end_location: locMap.get(r.end_location_id),
            vehicle: vehMap.get(r.vehicle_id),
          }));
        }
      } else {
        list = data as Route[];
      }

      const validRoutes = list.filter((r) => !isRouteExpired(r));

      setRoutes(validRoutes);
      const savedId = await getActiveRouteId();
      const restored = savedId ? validRoutes.find((r) => r.route_id === savedId) : null;

      if (restored) {
        setActiveRoute(restored);
      } else if (validRoutes.length > 0) {
        setActiveRoute(validRoutes[0]);
        await setActiveRouteId(validRoutes[0].route_id);
      } else {
        setActiveRoute(null);
        await setActiveRouteId(null);
      }
    } catch (e) { console.error('fetchRoutes error:', e); }
  };

  const hydrateRequests = async (ids: number[], currentPid?: number | null): Promise<JobRequest[]> => {
    if (ids.length === 0) return [];

    const { data: reqs, error } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, pickup_type, scheduled_time, created_at, estimated_cost,
        delivery_status, sender_id, receiver_id, receiver_phone,
        pickup_note, dropoff_note, preferred_provider_id, preferred_route_id,
        cargo:cargo_id ( * ),
        pickup_location:locations!delivery_requests_pickup_location_id_fkey ( * ),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( * ),
        receiver:receiver_id ( * )
      `)
      .in('request_id', ids).eq('delivery_status', 'Pending');
    if (error) throw error;

    const { data: taken } = await supabase.from('deliveries').select('request_id').in('request_id', ids);
    const takenIds = new Set((taken || []).map((t: any) => t.request_id));
    const open = (reqs || []).filter(
      (r: any) => !takenIds.has(r.request_id) && (currentPid == null || Number(r.sender_id) !== Number(currentPid)),
    );

    const senderIds = Array.from(new Set(open.map((r: any) => r.sender_id).filter(Boolean)));
    const senders: Record<number, string> = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase.from('users').select('user_id, first_name, last_name').in('user_id', senderIds);
      (users || []).forEach((u: any) => {
        const last = u.last_name ? ` ${String(u.last_name).charAt(0)}.` : '';
        senders[u.user_id] = `${u.first_name || 'Sender'}${last}`;
      });
    }

    return open
      .map((r: any) => normalizeRequest(r, senders, currentPid))
      .sort((a, b) => {
        const aDir = a.isDirectRequest ? 0 : 1;
        const bDir = b.isDirectRequest ? 0 : 1;
        if (aDir !== bDir) return aDir - bDir;
        return b.estimated_cost - a.estimated_cost;
      });
  };

  const refreshMatches = useCallback(async () => {
    const pid = providerId;
    if (!pid) {
      setRefreshing(false);
      return;
    }

    try {
      setCheckingMatches(true);

      // 1. Always fetch any direct requests where the sender explicitly selected this provider
      const { data: directRows } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('preferred_provider_id', pid)
        .eq('delivery_status', 'Pending');

      const directIds = (directRows || []).map((r: any) => Number(r.request_id));

      // 2. If provider is online with a valid active route, also include route matches
      let matchedIds: number[] = [];
      if (isOnline && activeRoute && !isRouteExpired(activeRoute)) {
        const matches = await findMatches(activeRoute.route_id);
        matchedIds = (matches || [])
          .map((m: any) => Number(m?.request?.request_id))
          .filter((id: number) => Number.isFinite(id));
      }

      const combinedIds = Array.from(new Set([...directIds, ...matchedIds]));
      if (combinedIds.length === 0) {
        setRequests([]);
        return;
      }

      const hydrated = await hydrateRequests(combinedIds, pid);

      for (const req of hydrated) {
        if (!notifiedMatchIdsRef.current.has(req.request_id)) {
          notifiedMatchIdsRef.current.add(req.request_id);
          if (isOnline || req.isDirectRequest) {
            fireLocalMatchNotification(
              req.isDirectRequest
                ? `A sender requested your route from ${req.pickup.main} to ${req.dropoff.main}. Tap to accept!`
                : `New package from ${req.pickup.main} to ${req.dropoff.main}. Tap to review.`,
            );
          }
        }
      }

      setRequests(hydrated);
    } catch (e) {
      console.warn('refreshMatches error:', e);
    } finally {
      setCheckingMatches(false);
      setRefreshing(false);
    }
  }, [providerId, isOnline, activeRoute]);

  const loadData = async () => {
    setLoading(true);
    const pid = await getProviderData();
    if (pid) await fetchRoutes(pid);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    if (!providerId) return;
    refreshMatches();
    const channel = supabase
      .channel(`jobs-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => { refreshMatches(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries' }, () => { refreshMatches(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [providerId, isOnline, activeRoute?.route_id, refreshMatches]);

  const toggleOnlineStatus = async (online: boolean) => {
    const pid = providerId || (await getProviderData());
    if (!pid) { Alert.alert('Error', 'Provider account details could not be loaded.'); return; }

    if (online) {
      let currentRoute = activeRoute && !isRouteExpired(activeRoute) ? activeRoute : null;
      if (!currentRoute) {
        if (routes.length > 0) {
          currentRoute = routes[0];
          setActiveRoute(currentRoute);
          await setActiveRouteId(currentRoute.route_id);
        } else {
          currentRoute = await createQuickRoute(pid);
        }
      }
      if (!currentRoute) { Alert.alert('Route Error', 'Unable to set an active route. Please try again.'); return; }

      await supabase.from('users').update({ is_online: true }).eq('user_id', pid);
      setIsOnline(true);
      setTimeout(refreshMatches, 200);
    } else {
      Alert.alert('Go Offline', 'Going offline will stop matching new requests. Your route will remain saved.', [
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

  const openConfirmSheet = (route: Route) => {
    setPendingRoute(route);
    const dt = parseNaiveIsoString(route.departure_time);
    const now = new Date();
    const freq = (route.route_frequency || '').trim();

    if (freq === 'Daily') {
      const todayAtStoredTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        dt.getHours(),
        dt.getMinutes(),
        0,
        0,
      );
      const initialTime = todayAtStoredTime.getTime() < now.getTime() ? now : todayAtStoredTime;
      setDepartureDate(now);
      setDepartureTime(initialTime);
      setSelectedWeekday(now.getDay());
    } else if (freq === 'Weekly') {
      const wDay = dt.getDay();
      setSelectedWeekday(wDay);
      setDepartureDate(nextWeekday(wDay, now));
      setDepartureTime(dt);
    } else {
      const validFuture = dt.getTime() < now.getTime() ? now : dt;
      setDepartureDate(validFuture);
      setDepartureTime(validFuture);
      setSelectedWeekday(validFuture.getDay());
    }

    setShowDatePicker(false);
    setShowTimePicker(false);
    setConfirmSheetVisible(true);
  };

  const confirmDeparture = async () => {
    if (!pendingRoute || !providerId) return;

    const now = new Date();
    const freq = (pendingRoute.route_frequency || '').trim();

    let effectiveDate = new Date(departureDate);
    if (freq === 'Daily') {
      effectiveDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (freq === 'Weekly') {
      effectiveDate = nextWeekday(selectedWeekday, now);
    }

    const combined = new Date(
      effectiveDate.getFullYear(),
      effectiveDate.getMonth(),
      effectiveDate.getDate(),
      departureTime.getHours(),
      departureTime.getMinutes(),
      0,
      0,
    );

    const isSameDayAsToday =
      effectiveDate.getFullYear() === now.getFullYear() &&
      effectiveDate.getMonth() === now.getMonth() &&
      effectiveDate.getDate() === now.getDate();

    if (freq === 'Daily') {
      if (combined.getTime() < now.getTime()) {
        Alert.alert(
          'Invalid Time',
          `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Please choose a departure time that has not passed yet today.`,
        );
        return;
      }
    } else if (freq === 'Weekly') {
      if (isSameDayAsToday && combined.getTime() < now.getTime()) {
        Alert.alert(
          'Invalid Time',
          `That time has already passed for today (${WEEKDAY_LABELS[selectedWeekday]}). Please choose a later time or another day.`,
        );
        return;
      }
    } else {
      if (combined.getTime() < now.getTime()) {
        Alert.alert('Invalid Time', 'You cannot schedule a departure in the past. Please choose a valid future date and time.');
        return;
      }
    }

    try {
      const departureValue = toNaiveIsoString(combined);
      const { error: updateErr } = await supabase
        .from('provider_routes')
        .update({ departure_time: departureValue })
        .eq('route_id', pendingRoute.route_id);
      if (updateErr) throw updateErr;

      const { data: fullRoute } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
        `)
        .eq('route_id', pendingRoute.route_id).single();
      if (!fullRoute) throw new Error('Failed to reload route');

      setActiveRoute(fullRoute as Route);
      await setActiveRouteId(pendingRoute.route_id);
      await fetchRoutes(providerId);
      await supabase.from('users').update({ is_online: true }).eq('user_id', providerId);
      setIsOnline(true);

      setConfirmSheetVisible(false);
      setRoutePickerVisible(false);
      setPendingRoute(null);
      setTimeout(refreshMatches, 200);
    } catch (e: any) {
      console.error('confirmDeparture error:', e);
      Alert.alert('Error', e.message || 'Failed to set departure time');
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

  // Show offers whenever provider is online OR when a sender sent a direct request to this provider
  const offers = requests.filter(
    r => !dismissedIds.includes(r.request_id) && (isOnline || r.isDirectRequest),
  );
  const currentOffer = offers[0] ?? null;

  const dismissOffer = (id: number) => setDismissedIds(prev => (prev.includes(id) ? prev : [...prev, id]));

  useEffect(() => { setDismissedIds([]); }, [isOnline, activeRoute?.route_id]);

  useEffect(() => {
    if (!currentOffer) return;
    setOfferSecondsLeft(OFFER_SECONDS);
    // Do not auto-expire direct requests where the sender specifically selected this provider
    if (currentOffer.isDirectRequest) return;
    const t = setInterval(() => {
      setOfferSecondsLeft(sec => sec - 1);
    }, 1000);
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
        refreshMatches();
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
          notifyUser(
            requestData.sender_id,
            'Courier Accepted Your Delivery! 🚚',
            `Your courier accepted parcel #${code} and will head to the pickup location.`,
            { deliveryId: delivery.delivery_id },
          ).catch(() => {});
        }
      }

      setDetailRequestId(null);
      setDismissedIds(prev => [...prev, req.request_id]);
      refreshMatches();
      if (!goToTaskTab()) {
        Alert.alert('Delivery accepted', 'Find it in the Task tab. Ask the sender to show their pickup QR when you arrive.');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to accept delivery.');
    } finally { setAccepting(false); }
  };

  const acceptRequest = (req: JobRequest) => {
    if (accepting) return;
    if (!providerId) {
      Alert.alert('Please wait', 'Your provider account is still loading.');
      return;
    }
    Alert.alert(
      'Accept this delivery?',
      `You will earn ${money(req.estimated_cost)} for delivering from ${req.pickup.main} to ${req.dropoff.main}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => doAccept(req) },
      ],
    );
  };

  const pulseScale = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const bellScale = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const bellOpacity = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  const markFailed = (uri: string) => setFailedPhotos(prev => ({ ...prev, [uri]: true }));

  /* ----------------------- shared request pieces ----------------------- */
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

  /* ----------------------- full-screen package details ----------------------- */
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
        {/* header bar */}
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

        {/* Scrollable Content */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          {/* Route card */}
          <View style={styles.card}>
            <View style={styles.oTopRow}>
              {renderServicePill(o)}
              <View style={styles.chipSolid}>
                <Ionicons name={o.isDirectRequest ? 'hourglass-outline' : 'flash'} size={11} color="#FFFFFF" />
                <Text style={styles.chipSolidText}>
                  {o.isDirectRequest ? 'AWAITING YOUR ACCEPTANCE' : 'MATCHED'}
                </Text>
              </View>
            </View>
            {renderRingRoute(o, true)}
          </View>

          {/* Earnings card */}
          <View style={styles.earnCard}>
            <Text style={styles.earnLabel}>YOU EARN</Text>
            <Text style={styles.earnValue}>{money(o.estimated_cost)}</Text>
            <View style={styles.earnNote}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#FFFFFF" />
              <Text style={styles.earnNoteText}>
                Held in escrow once you accept, then released to your wallet when the receiver confirms delivery.
              </Text>
            </View>
          </View>

          {/* Trip summary */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="navigate-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>Trip Summary</Text>
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
            </View>
          </View>

          {/* Photos */}
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
                  {localOnly
                    ? "The sender's package photo wasn't uploaded, so it can't be shown."
                    : "The sender didn't add a photo of this package."}
                </Text>
              </View>
            )}
          </View>

          {/* Package details */}
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
                    </Text>
                  ) : null,
                )}
              </View>
            )}
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>CARGO SIZE</Text>
                <Text style={styles.tileValue}>
                  {o.totalItems} {o.items[0]?.size || (o.totalItems === 1 ? 'item' : 'items')}
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
              {!!o.dims && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>DIMENSIONS</Text>
                  <Text style={styles.tileValue}>{o.dims}</Text>
                </View>
              )}
              {fits !== null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>YOUR VEHICLE</Text>
                  <Text style={[styles.tileValue, { color: fits ? colors.success : colors.error }]} numberOfLines={2}>
                    {fits ? `Fits (${cap} kg max)` : `Too heavy (${cap} kg max)`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Notes */}
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

          {/* People */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <Ionicons name="people-outline" size={15} color={ORANGE} />
              </View>
              <Text style={styles.cardTitle}>People</Text>
            </View>
            {renderPeople(o)}
            <Text style={styles.privacyNote}>
              Contact details are shared once you accept the delivery.
            </Text>
          </View>
        </ScrollView>

        {/* Fixed accept bar */}
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
                <Text style={styles.acceptBtnText}>Accept Delivery</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ------------------------------ offer popup (summary only) ------------------------------ */
  const renderOfferPopup = (o: JobRequest) => {
    const pct = o.isDirectRequest ? 100 : Math.max(0, Math.min(100, (offerSecondsLeft / OFFER_SECONDS) * 100));
    const SHEET_H = Math.round(SCREEN_H * 0.48);

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
        {/* timer bar */}
        <View style={styles.offerTimerTrack}>
          <View
            style={[
              styles.offerTimerFill,
              { width: `${pct}%` as any },
              !o.isDirectRequest && offerSecondsLeft <= 10 && { backgroundColor: colors.error },
            ]}
          />
        </View>

        {/* Main Content */}
        <View style={{ flex: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 90 + insets.bottom }}>
          {/* Top Row: Badge & Timer */}
          <View style={styles.oTopRow}>
            {renderServicePill(o)}
            <View style={styles.chipSolid}>
              <Ionicons name={o.isDirectRequest ? 'hourglass-outline' : 'flash'} size={11} color="#FFFFFF" />
              <Text style={styles.chipSolidText}>
                {o.isDirectRequest ? 'DIRECT REQUEST · AWAITING ACCEPTANCE' : 'NEW MATCH'}
              </Text>
            </View>
            {offers.length > 1 && <Text style={styles.offerCount}>1 of {offers.length}</Text>}
            <View style={{ flex: 1 }} />
            {!o.isDirectRequest && (
              <View style={styles.offerTimerPill}>
                <Ionicons
                  name="timer-outline"
                  size={13}
                  color={offerSecondsLeft <= 10 ? colors.error : colors.textSecondary}
                />
                <Text style={[styles.offerTimerText, offerSecondsLeft <= 10 && { color: colors.error }]}>
                  {Math.max(0, offerSecondsLeft)}s
                </Text>
              </View>
            )}
          </View>

          {/* Total Pay Row */}
          <View style={[styles.offerMainRow, { marginTop: 8 }]}>
            <View>
              <Text style={styles.eyebrow}>TOTAL PAY</Text>
              <Text style={styles.offerPrice}>{money(o.estimated_cost)}</Text>
            </View>
            <Text style={styles.offerCode}>{requestCode(o.request_id)}</Text>
          </View>

          {/* Route Section */}
          <View style={{ marginTop: 14 }}>
            {renderRingRoute(o)}
          </View>

          {/* View Details Button */}
          <TouchableOpacity
            style={[styles.viewDetailsBtn, { marginTop: 16 }]}
            onPress={() => setDetailRequestId(o.request_id)}
            activeOpacity={0.85}
          >
            <Ionicons name="document-text-outline" size={18} color={ORANGE} />
            <Text style={styles.viewDetailsText}>View Full Details</Text>
            <Ionicons name="chevron-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </View>

        {/* Fixed Footer */}
        <View
          style={[
            styles.offerBtnRow,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 18,
              paddingTop: 12,
              paddingBottom: 16,
              backgroundColor: colors.card,
              borderTopWidth: 1,
              borderTopColor: colors.divider,
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
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.offerAcceptBtn, { flex: 1 }, accepting && { opacity: 0.7 }]}
            onPress={() => {
              if (o.items.some(i => i.photo)) { doAccept(o); return; }
              Alert.alert(
                'No package photo',
                "You can't see what this package looks like. Accept anyway?",
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Accept anyway', onPress: () => doAccept(o) },
                ],
              );
            }}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                <Text style={styles.offerAcceptText}>Accept</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderBottomPanel = () => {
    const dismissedCount = requests.length - offers.length;
    const startAddr = splitAddress(activeRoute?.start_location?.street_address);
    const endAddr = splitAddress(activeRoute?.end_location?.street_address);

    const OFF = { title: '#E2E8F0', sub: '#94A3B8', label: '#64748B' };
    const panelBg = modeAnim.interpolate({ inputRange: [0, 1], outputRange: ['#232A3B', colors.card] });
    const ringScale = signal.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.3] });
    const ringOpacity = signal.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
    const dotOpacity = dotBlink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
    const swapRotate = swapAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
    const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-ctaW, ctaW] });

    const onSwap = () => {
      swapAnim.setValue(0);
      Animated.timing(swapAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => swapAnim.setValue(0));
      setRoutePickerVisible(true);
    };

    return (
      <Animated.View style={[styles.dashPanel, { backgroundColor: panelBg, borderTopColor: isOnline ? colors.border : 'rgba(255,255,255,0.05)', paddingBottom: 22 + (isOnline ? 0 : insets.bottom) }]}>
        <View style={[styles.dashBar, { backgroundColor: isOnline ? ORANGE : 'rgba(100,116,139,0.35)' }]} />

        <Animated.View style={{ opacity: modeFade }}>
          <View style={styles.dashHead}>
            <View style={styles.dashHeadLeft}>
              <View style={[styles.liveBadge, isOnline ? styles.liveBadgeOn : styles.liveBadgeOff]}>
                {isOnline && (
                  <Animated.View style={[styles.liveRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
                )}
                <View style={[styles.liveCore, !isOnline && { opacity: 0.25 }]} />
              </View>
              <View>
                <Text style={[styles.dashTitle, !isOnline && { color: OFF.title }]}>{isOnline ? 'You’re online' : 'You’re offline'}</Text>
                <Text style={[styles.dashSub, !isOnline && { color: OFF.sub }]}>
                  {isOnline ? (checkingMatches ? 'Looking for matches...' : 'Looking for offers') : 'Ready when you are'}
                </Text>
              </View>
            </View>
            <View style={[styles.statusPill, isOnline ? styles.statusPillOn : styles.statusPillOff]}>
              <Animated.View style={[styles.statusPillDot, { backgroundColor: isOnline ? GREEN : '#64748B' }, isOnline && { opacity: dotOpacity }]} />
              <Text style={[styles.statusPillText, { color: isOnline ? GREEN : OFF.sub }]}>{isOnline ? 'ACTIVE' : 'PAUSED'}</Text>
            </View>
          </View>

          <View style={[styles.routeBlock, isOnline ? { backgroundColor: colors.background, borderColor: colors.divider } : styles.routeBlockOff]}>
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
              <Text style={[styles.routeLabel, !isOnline && { color: OFF.label }]}>{isOnline ? 'ACTIVE ROUTE' : 'SAVED ROUTE'}</Text>
              {activeRoute ? (
                <>
                  <Text style={[styles.routeTitle, !isOnline && { color: OFF.sub }]} numberOfLines={1}>
                    {startAddr.main} <Text style={{ color: isOnline ? ORANGE : OFF.label, fontWeight: '900' }}>→</Text> {endAddr.main}
                  </Text>
                  {!!startAddr.sub && <Text style={[styles.routeDetail, !isOnline && { color: OFF.label }]} numberOfLines={1}>{startAddr.sub}</Text>}
                </>
              ) : (
                <Text style={[styles.routeDetail, !isOnline && { color: OFF.label }]} numberOfLines={1}>No active route — tap ⇄ to select or create one</Text>
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

          {isOnline ? null : (
            <View>
              <Text style={styles.ctaHelper}>
                Come back online to keep earning. Your route and vehicle are <Text style={{ color: ORANGE, fontWeight: '800' }}>ready to go</Text>.
              </Text>
              <TouchableOpacity
                style={styles.ctaBtn}
                onPress={() => toggleOnlineStatus(true)}
                activeOpacity={0.9}
                onLayout={e => setCtaW(e.nativeEvent.layout.width)}
              >
                <Animated.View pointerEvents="none" style={[styles.ctaShineWrap, { transform: [{ translateX: shineX }] }]}><View style={styles.ctaShine} /></Animated.View>
                <Text style={styles.ctaText}>Go Online Now</Text>
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

          {dismissedCount > 0 && (
            <TouchableOpacity style={styles.reopenRow} onPress={() => setDismissedIds([])} activeOpacity={0.85}>
              <Ionicons name="flash" size={14} color={ORANGE} />
              <Text style={styles.reopenText}>{dismissedCount} matched {dismissedCount === 1 ? 'order' : 'orders'} dismissed</Text>
              <Text style={styles.reopenLink}>Show again</Text>
            </TouchableOpacity>
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
          demand={showDemand}
          online={isOnline}
          recenterTick={recenterTick}
          padBottom={currentOffer ? Math.round(SCREEN_H * 0.48) + 30 : 200}
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

          <TouchableOpacity style={[styles.mapToolBtn, !isOnline && styles.mapToolBtnOff]} onPress={() => setRecenterTick(t => t + 1)} activeOpacity={0.85}>
            <Ionicons name="locate" size={20} color={isOnline ? colors.textPrimary : '#94A3B8'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mapToolBtn, showDemand && isOnline && styles.mapToolBtnActive, !isOnline && styles.mapToolBtnOff]}
            onPress={() => {
              setShowDemand(d => !d);
              setRefreshing(true);
              refreshMatches();
            }}
            activeOpacity={0.85}
          >
            {refreshing || checkingMatches ? (
              <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="small" color={showDemand ? '#FFFFFF' : ORANGE} />
              </View>
            ) : (
              <Ionicons name="flame" size={20} color={showDemand ? '#FFFFFF' : ORANGE} />
            )}
          </TouchableOpacity>

          <View style={!isOnline && styles.toolDim} pointerEvents={isOnline ? 'auto' : 'none'}>
            <TouchableOpacity style={[styles.mapToolBtn, styles.sosBtn, !isOnline && { backgroundColor: '#475569', borderColor: '#475569' }]} onPress={triggerSOS} activeOpacity={0.85}>
              <Ionicons name="shield" size={20} color={isOnline ? '#FFFFFF' : '#94A3B8'} />
            </TouchableOpacity>
          </View>

          {isOnline && (
            <TouchableOpacity style={[styles.mapToolBtn, styles.powerBtn]} onPress={() => toggleOnlineStatus(false)} activeOpacity={0.85}>
              <Ionicons name="power" size={20} color="#EF4444" />
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

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />

      {/* full-screen details overlay OR main dashboard */}
      {detailRequestId != null ? renderFullDetails() : renderMain()}

      {renderNotifModal()}
      {renderFullListModal()}

      <Modal visible={routePickerVisible} transparent animationType="slide" onRequestClose={() => setRoutePickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.routePickerSheet}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <Text style={styles.routePickerTitle}>Select an Active Route</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {providerId && (
                  <TouchableOpacity
                    style={styles.quickRouteHeaderBtn}
                    onPress={async () => {
                      const newR = await createQuickRoute(providerId);
                      if (newR) setRoutePickerVisible(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="flash" size={16} color={ORANGE} />
                    <Text style={styles.quickRouteHeaderBtnText}>Quick</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.addRouteHeaderBtn} onPress={goToManageRoutes} activeOpacity={0.85} hitSlop={8}>
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
                <Text style={styles.routePickerEmptyTitle}>No active routes available</Text>
                <Text style={styles.routePickerEmptySub}>
                  Create an on-demand route now, or set up / reschedule a route in Manage Routes.
                </Text>
                <TouchableOpacity
                  style={styles.createQuickRouteBtn}
                  onPress={async () => {
                    if (providerId) {
                      const newR = await createQuickRoute(providerId);
                      if (newR) setRoutePickerVisible(false);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="flash" size={16} color="#FFFFFF" />
                  <Text style={styles.createQuickRouteBtnText}>Create Quick Route</Text>
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
                    <TouchableOpacity key={r.route_id} style={[styles.routeOption, isSelected && styles.routeOptionSelected]} onPress={() => openConfirmSheet(r)} activeOpacity={0.85}>
                      <View style={[styles.routeOptionDot, { backgroundColor: isSelected ? ORANGE : colors.textMuted }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeOptionTitle} numberOfLines={1}>
                          {startAddr.main} → {endAddr.main}
                        </Text>
                        <Text style={styles.routeOptionSub} numberOfLines={1}>
                          {startAddr.sub} {endAddr.sub ? `→ ${endAddr.sub}` : ''}
                        </Text>
                        <Text style={styles.routeOptionAddr} numberOfLines={1}>
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

      {/* Confirm Departure Sheet */}
      <Modal visible={confirmSheetVisible} transparent animationType="slide" onRequestClose={() => setConfirmSheetVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <View>
                <Text style={styles.routePickerTitle}>Confirm Departure</Text>
                {!!pendingRoute?.route_frequency && (
                  <Text style={{ fontSize: 12, fontWeight: '700', color: ORANGE, marginTop: 2 }}>
                    {pendingRoute.route_frequency} Route
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setConfirmSheetVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {pendingRoute && (
              <>
                <View style={styles.confirmRoutePreview}>
                  <View style={styles.confirmRouteRow}>
                    <View style={[styles.confirmDot, { backgroundColor: '#3B82F6' }]} />
                    <Text style={styles.confirmRouteText} numberOfLines={1}>{pendingRoute.start_location?.street_address || 'Start'}</Text>
                  </View>
                  <View style={styles.confirmRouteLine} />
                  <View style={styles.confirmRouteRow}>
                    <View style={[styles.confirmDot, { backgroundColor: colors.error }]} />
                    <Text style={styles.confirmRouteText} numberOfLines={1}>{pendingRoute.end_location?.street_address || 'End'}</Text>
                  </View>
                </View>

                {pendingRoute.route_frequency === 'Daily' ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.inputLabel}>Departure Time (Today)</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>
                        {departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureTime}
                        mode="time"
                        display="default"
                        onChange={(e, t) => {
                          if (Platform.OS === 'android') setShowTimePicker(false);
                          if (e.type === 'set' && t) {
                            const now = new Date();
                            const candidate = new Date(
                              now.getFullYear(),
                              now.getMonth(),
                              now.getDate(),
                              t.getHours(),
                              t.getMinutes(),
                              0,
                              0,
                            );
                            if (candidate.getTime() < now.getTime()) {
                              Alert.alert(
                                'Invalid Time',
                                `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You cannot pick a time that has already passed today.`,
                              );
                              return;
                            }
                            setDepartureTime(t);
                          }
                        }}
                      />
                    )}
                  </View>
                ) : pendingRoute.route_frequency === 'Weekly' ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={styles.inputLabel}>Repeats on</Text>
                    <View style={styles.weekdayRow}>
                      {WEEKDAY_LABELS.map((label, idx) => (
                        <TouchableOpacity
                          key={label}
                          style={[styles.weekdayChip, selectedWeekday === idx && styles.weekdayChipActive]}
                          onPress={() => setSelectedWeekday(idx)}
                        >
                          <Text style={[styles.weekdayChipText, selectedWeekday === idx && styles.weekdayChipTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ height: 12 }} />
                    <Text style={styles.inputLabel}>Departure Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>
                        {departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureTime}
                        mode="time"
                        display="default"
                        onChange={(e, t) => {
                          if (Platform.OS === 'android') setShowTimePicker(false);
                          if (e.type === 'set' && t) setDepartureTime(t);
                        }}
                      />
                    )}
                  </View>
                ) : (
                  <View style={styles.dateTimeRow}>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Departure Date</Text>
                      <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showDatePicker && setShowDatePicker(true)}>
                        <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                        <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
                      </TouchableOpacity>
                      {showDatePicker && (
                        <DateTimePicker
                          value={departureDate}
                          mode="date"
                          display="default"
                          minimumDate={new Date()}
                          onChange={(e, d) => {
                            if (Platform.OS === 'android') setShowDatePicker(false);
                            if (e.type === 'set' && d) setDepartureDate(d);
                          }}
                        />
                      )}
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Departure Time</Text>
                      <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
                        <Ionicons name="time-outline" size={16} color={ORANGE} />
                        <Text style={styles.dateTimeValue}>
                          {departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                      </TouchableOpacity>
                      {showTimePicker && (
                        <DateTimePicker
                          value={departureTime}
                          mode="time"
                          display="default"
                          onChange={(e, t) => {
                            if (Platform.OS === 'android') setShowTimePicker(false);
                            if (e.type === 'set' && t) setDepartureTime(t);
                          }}
                        />
                      )}
                    </View>
                  </View>
                )}

                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color={isDark ? '#93C5FD' : '#1E40AF'} />
                  <Text style={styles.infoBoxText}>The app will match requests along this route and departure window.</Text>
                </View>

                <TouchableOpacity style={styles.confirmBtn} onPress={confirmDeparture} activeOpacity={0.9}>
                  <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                  <Text style={styles.confirmBtnText}>Confirm & Go Online</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

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
  mapTools: { 
    position: 'absolute', 
    right: 12, 
    alignItems: 'center',
    gap: 12,
  },
  mapToolBtn: {
    width: 46, 
    height: 46, 
    borderRadius: 23, 
    backgroundColor: c.card,
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.15 : 0.4,
    shadowRadius: 8, 
    elevation: 5,
    borderWidth: 1, 
    borderColor: c.border,
  },
  mapToolBtnActive: { backgroundColor: ORANGE, borderColor: ORANGE },
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
  liveBadge: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  liveBadgeOn: { backgroundColor: GREEN, shadowColor: GREEN, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 8, elevation: 4 },
  liveBadgeOff: { backgroundColor: '#475569' },
  liveRing: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: 25, borderWidth: 2, borderColor: GREEN },
  liveCore: { width: 10, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.85)' },
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
  ctaHelper: { fontSize: 12, fontWeight: '600', color: '#94A3B8', lineHeight: 18, paddingHorizontal: 2, marginBottom: 12 },
  ctaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 16, backgroundColor: ORANGE, overflow: 'hidden', shadowColor: ORANGE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 8 },
  ctaShineWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 90 },
  ctaShine: { flex: 1, backgroundColor: 'rgba(255,255,255,0.3)', transform: [{ skewX: '-20deg' }] },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
  statsGrid: { flexDirection: 'row', gap: 8, marginTop: 12 },
  statCard: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(15,20,32,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)' },
  statVal: { fontSize: 16, fontWeight: '900', color: '#E2E8F0', letterSpacing: -0.3 },
  statLbl: { fontSize: 9, fontWeight: '800', color: '#64748B', letterSpacing: 0.6, marginTop: 4 },
  reopenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 8 },
  reopenText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.textSecondary },
  reopenLink: { fontSize: 12, fontWeight: '800', color: ORANGE },
  locWarnBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingVertical: 6 },
  locWarnText: { fontSize: 12, fontWeight: '600', color: c.warning },
  svcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  svcPillText: { fontSize: 12, fontWeight: '800', color: BLUE },
  oTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
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
  chipSolid: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: ORANGE,
  },
  chipSolidText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
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
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: c.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 10,
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
  offerBtnRow: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: c.accentSoft,
    borderWidth: 1.5,
    borderColor: ORANGE,
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
  quickRouteHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: c.accentSoft },
  quickRouteHeaderBtnText: { fontSize: 12, fontWeight: '800', color: ORANGE },
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
  routeOptionAddr: { fontSize: 10, color: c.textMuted, marginTop: 2 },

  confirmSheet: {
    backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10,
  },
  confirmRoutePreview: {
    backgroundColor: c.background, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: c.border, marginBottom: 16,
  },
  confirmRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmDot: { width: 8, height: 8, borderRadius: 4 },
  confirmRouteText: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textPrimary },
  confirmRouteLine: { width: 1, height: 14, backgroundColor: c.border, marginLeft: 3.5, marginVertical: 4 },

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

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.statusBarStyle === 'dark-content' ? '#EFF6FF' : '#0F172A',
    borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: c.statusBarStyle === 'dark-content' ? '#DBEAFE' : '#1E3A5F',
    marginBottom: 14,
  },
  infoBoxText: { flex: 1, fontSize: 11, color: c.statusBarStyle === 'dark-content' ? '#1E40AF' : '#93C5FD', fontWeight: '600', lineHeight: 16 },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 16, backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  confirmBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },

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
});