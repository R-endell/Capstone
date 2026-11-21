// src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Animated, StatusBar,
  Alert, Easing, Dimensions, ActivityIndicator, Platform, BackHandler,
  Image, Linking, Modal, Pressable, Share, useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import TermsModal from '../../../../components/terms/TermsModal';
import { needsAcceptance, recordTermsAcceptance } from '../../../../services/termsService';
import { supabase } from '../../../../utils/supabase';
import {
  getRoadDistanceKm,
  quickEstimateKm,
  computePricing,
  PricingBreakdown,
  parseNaiveRouteTime,
} from '../../../../services/routeService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { MAP_PROPS, BRAND_ORANGE } from '../../../../utils/mapConfig';
import { SolarIcon } from '../../../../components/ui/SolarIcon';
import DraggableSheet, { DraggableSheetHandle } from '../../../../components/ui/DraggableSheet';
import { notifyUser } from '../../../../services/pushService';
import {
  syncAllActiveRoutesTodayForRequest,
  enrichRouteMatchRows,
  explainMatchesForRequest,
  isRequestWithinRouteCorridor,
  RouteMatchRow,
} from '../../../../services/matchingService';
import { getOrCreateChatRoom } from '../../../../utils/chatHelpers';
import { fetchLatestFix, ProviderFix } from '../../../../services/locationService';
import { getNavRoute, fmtDuration } from '../../../../components/map/directions';
import type { NavRoute } from '../../../../components/map/directions';
import {
  OFF_ROUTE_M,
  REROUTE_MIN_GAP_MS,
  ROUTE_REFRESH_MS,
  buildRouteIndex,
  computeProgress,
  getRouteCached,
  remainingPath,
} from '../../../../services/navigationEngine';
import type { RouteIndex } from '../../../../services/navigationEngine';

const { height } = Dimensions.get('window');
const SHEET_MAX_H = Math.round(height * 0.52);
const ORANGE = BRAND_ORANGE;
const SEND_NOW_WINDOW_MINUTES = 5;
const MANILA_OFFSET_HOURS = 8;
const NETWORK_TIMEOUT_MS = 12_000;

// How long we search before offering "Try Again" / "Go Home" when 0 routes match.
const SEARCH_DURATION_MS = 10000; // 10 seconds

// Live tracking constants (synced with LiveTrackingScreen)
const STALE_MS = 45_000;
const VEHICLE_IMG = require('../../../../../assets/sports-car.png');
const MIN_GLIDE_MS = 600;
const MAX_GLIDE_MS = 2000;
const FRAME_MS = 33;
const PIN = 44;
const LABEL_H = 26;
const LABEL_H2 = 42;
const LABEL_GAP = 6;

type LatLng = { latitude: number; longitude: number };
type PkgItem = { size: string | null; name: string; fragile: boolean; photo?: string | null };

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
  meetupLandmarkName?: string | null;
  meetupLat?: number | null;
  meetupLng?: number | null;
};

type PayInfo = {
  amount: number | null;
  base: number | null;
  fee: number | null;
  deposit: number | null;
  method: string | null;
};

const SIZE_META: Record<string, { letter: string; kg: string; color: string; bg: string }> = {
  Small:  { letter: 'S', kg: '~5 kg',  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
  Medium: { letter: 'M', kg: '~15 kg', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  Large:  { letter: 'L', kg: '~30 kg', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
};

const FARE_KEYS = [
  'estimated_cost', 'total_price', 'total_amount', 'total_fare',
  'delivery_fee', 'price', 'fare', 'amount', 'estimated_price',
  'final_price', 'agreed_price',
];
const METHOD_KEYS = ['payment_provider', 'payment_method', 'payment_type'];

const ANIMATION_STYLES = [
  { key: 'radar', label: 'Radar' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'combined', label: 'Combo' },
] as const;
type FindingAnimation = typeof ANIMATION_STYLES[number]['key'];
const DEFAULT_FINDING_ANIMATION: FindingAnimation = 'radar';

const FINDING_STATUS_MESSAGES = [
  'Locating nearby delivery partners...',
  'Matching cargo capacity and vehicle type...',
  'Checking providers with routes today...',
  'Pinging riders along your corridor...',
  'Optimizing delivery route for best fare...',
  'Checking departure times of active drivers...',
  'Notifying top-rated riders nearby...',
  'Almost there, waiting for a response...',
  'Expanding search radius for more options...',
  'Still searching, please hold on...',
  'Coordinating logistics with local partners...',
  'Waiting for a rider to accept your booking...',
];

const searchStartTimes = new Map<number, number>();

/** Bounds any async network/RPC operation so poor mobile connectivity cannot hang the UI. */
function withTimeout<T>(promise: PromiseLike<T>, ms = NETWORK_TIMEOUT_MS, label = 'Request'): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Google Plus Codes ("8Q7X+V4", "J9X5+2V Mandaue City") and other random-looking codes are not street names.
const PLUS_CODE = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;
const isCodeLike = (t: string) => {
  const x = (t ?? '').trim();
  if (!x) return true;
  if (PLUS_CODE.test(x)) return true;
  return /^[A-Za-z0-9+\-_.]{6,}$/.test(x) && /\d/.test(x) && /[A-Za-z]/.test(x);
};
const cleanAddress = (a?: string | null): string =>
  (a ?? '').replace(PLUS_CODE, '').split(',').map(p => p.trim())
    .filter(p => p && !isCodeLike(p) && !/^\d{4,6}$/.test(p)).join(', ');

// Map pin label: landmark (if the location has one) on top, street underneath.
const placeLabel = (loc: any): { title: string; sub: string } => {
  const placeName =
    typeof loc?.place_name === 'string' && !isCodeLike(loc.place_name) ? loc.place_name.trim() : '';
  const parts = cleanAddress(loc?.address ?? loc?.street_address).split(',').map(p => p.trim()).filter(Boolean);
  const street = parts[0] || '';
  const area = parts.slice(1).join(', ');
  if (placeName) {
    const sub = [street && street !== placeName ? street : '', area].filter(Boolean).join(', ');
    return { title: placeName, sub };
  }
  return { title: street || 'Selected location', sub: area };
};

const areaOf = (l: any): string =>
  [l?.barangay, l?.city, l?.province].filter(v => v && v !== 'Unknown').join(', ');

const streetOf = (l: any, fallback: string): string => {
  const road = typeof l?.road === 'string' && !isCodeLike(l.road) ? l.road.trim() : '';
  const brgy = l?.barangay && l.barangay !== 'Unknown' ? String(l.barangay) : '';
  return road || cleanAddress(l?.street_address) || brgy || fallback;
};

const nameOf = (l: any): string | null =>
  typeof l?.place_name === 'string' && !isCodeLike(l.place_name) ? l.place_name.trim() : null;

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
      for (let i = 0; i < (Number(q) || 0); i++) {
        out.push({ size: label, name: `${label} package`, fragile: !!cargo.is_fragile });
      }
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

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())} • ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
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

const parseManilaNaive = (naive: string): number => {
  const m = String(naive).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10) - MANILA_OFFSET_HOURS,
    parseInt(mi, 10),
    parseInt(s || '0', 10),
  );
};

const nowManilaNaive = (): string => {
  const now = new Date();
  const manila = new Date(now.getTime() + MANILA_OFFSET_HOURS * 60 * 60 * 1000);
  const y = manila.getUTCFullYear();
  const m = String(manila.getUTCMonth() + 1).padStart(2, '0');
  const d = String(manila.getUTCDate()).padStart(2, '0');
  const hh = String(manila.getUTCHours()).padStart(2, '0');
  const mm = String(manila.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
};

const formatDepartureTime = (isoString: string | null | undefined, routeFreq?: string | null) => {
  if (!isoString) return null;
  try {
    const dep = parseNaiveRouteTime(isoString);
    if (isNaN(dep.getTime())) return null;
    const freq = String(routeFreq || '').trim().toLowerCase();
    const timePart = dep.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    if (freq === 'daily' || freq === 'weekly') {
      return `Today at ${timePart}`;
    }
    const now = new Date();
    const isToday =
      dep.getFullYear() === now.getFullYear() &&
      dep.getMonth() === now.getMonth() &&
      dep.getDate() === now.getDate();
    if (isToday) {
      return `Today at ${timePart}`;
    }
    return `${dep.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${timePart}`;
  } catch {
    return null;
  }
};

interface ProviderRating {
  avg: number;
  count: number;
  recent: { rating: number; comment: string | null; created_at: string }[];
}

const fireMatchNotification = async (providerName: string, plate: string, deliveryId: number) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🎉 Provider Accepted!',
        body: `${providerName} accepted your delivery. Vehicle: ${plate}`,
        data: { type: 'match', deliveryId },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local match notif failed:', err);
  }
};

const fireDirectRequestNotification = async (
  providerName: string,
  requestId: number,
  matchedCount = 1,
  isAutoRouteMatch = false,
) => {
  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
  try {
    const title = isAutoRouteMatch
      ? matchedCount > 1
        ? `🎯 ${matchedCount} Route Providers Matched!`
        : '🎯 Route Provider Matched!'
      : '📨 Request Sent to Provider!';
    const body = isAutoRouteMatch
      ? matchedCount > 1
        ? `Delivery #${trackingId} matched with ${matchedCount} providers along your route. Waiting for one to accept.`
        : `Delivery #${trackingId} matched with ${providerName}'s route today and is awaiting acceptance.`
      : `Your delivery #${trackingId} has been sent directly to ${providerName}.`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { type: 'direct_request', requestId },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local direct notif failed:', err);
  }
};

const fireCancelNotification = async (opts: {
  requestId: number;
  amount?: number | null;
  refunded: boolean;
  refundFailed?: boolean;
}) => {
  const { requestId, amount, refunded, refundFailed } = opts;
  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;

  const title = '❌ Booking Cancelled';
  let body: string;

  if (refunded) {
    const amtText = typeof amount === 'number' && amount > 0 ? ` of ₱${amount.toFixed(2)}` : '';
    body = `Booking #${trackingId} was cancelled. A refund${amtText} has been initiated and should arrive within a few minutes to 3–5 business days.`;
  } else if (refundFailed) {
    body = `Booking #${trackingId} was cancelled, but the automatic refund could not be started. Your funds are still held in escrow — please contact support with this tracking ID.`;
  } else {
    body = `Booking #${trackingId} was cancelled. No payment was taken.`;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          type: 'cancellation',
          requestId,
          refunded: !!refunded,
          refundFailed: !!refundFailed,
        },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local cancel notif failed:', err);
  }
};

const notifyProviderOfCancellation = async (opts: {
  providerId: number | null | undefined;
  requestId: number;
  amount?: number | null;
}) => {
  const { providerId, requestId, amount } = opts;
  if (!providerId) return;

  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
  try {
    await notifyUser(
      providerId,
      '🚫 Delivery Cancelled',
      `Booking #${trackingId} was cancelled by the sender before pickup. No action needed on your end.${
        typeof amount === 'number' && amount > 0 ? ` The sender's ₱${amount.toFixed(2)} escrow is being refunded.` : ''
      }`,
      { type: 'cancellation', requestId, role: 'provider' },
    );
  } catch (err) {
    console.warn('[BookingScreen] provider cancel push failed:', err);
  }
};

type PreferredSnapshot = {
  requestId: number | null;
  providerId: number | null;
  routeId: number | null;
  name: string | null;
};

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

// Same pickup / drop-off pins copied from LiveTrackingScreen, with the street name underneath.
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

export default function BookingScreen({ route, navigation }: any) {
  const { mode: routeMode } = route.params || {};
  const { state, dispatch } = useSchedule();
  const mode = routeMode || state.mode;
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const mk = useMemo(() => makeMarkerStyles(colors), [colors]);

  const initialDeliveryId: number | null = route.params?.deliveryId ? Number(route.params?.deliveryId) : null;
  const providerParamId: number | undefined = route.params?.providerId;
  const routeParamId: number | undefined = route.params?.routeId;
  const isProviderMode = route.params?.mode === 'provider' && !!providerParamId;
  const resumeRequestId: number | undefined = route.params?.requestId ?? route.params?.request_id;
  const isResume = !!route.params?.resume && !!resumeRequestId;
  const isPostPaymentEntry = !!route.params?.paymentJustCompleted && !!resumeRequestId;

  const [bookingState, setBookingState] = useState<'review' | 'finding' | 'matched' | 'no_match' | 'tracking'>(
    initialDeliveryId || isProviderMode
      ? 'tracking'
      : isResume || isPostPaymentEntry
        ? 'finding'
        : 'review'
  );
  const [activeDeliveryId, setActiveDeliveryId] = useState<number | null>(initialDeliveryId);
  const [matchFound, setMatchFound] = useState(false);
  const [isDirectPreferredProvider, setIsDirectPreferredProvider] = useState(false);
  const [isAcceptedByProvider, setIsAcceptedByProvider] = useState(!!initialDeliveryId);
  const [isSearching, setIsSearching] = useState(isResume || isPostPaymentEntry);
  const [providerData, setProviderData] = useState<any>(null);
  const [matchedProvidersList, setMatchedProvidersList] = useState<RouteMatchRow[]>([]);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);

  const [departureTime, setDepartureTime] = useState<string | null>(null);
  const [routeFrequency, setRouteFrequency] = useState<string | null>(null);

  const [providerRating, setProviderRating] = useState<ProviderRating | null>(null);
  const [resumeInfo, setResumeInfo] = useState<any>(null);
  const [resumeSubId, setResumeSubId] = useState<number | null>(null);
  const resumedRef = useRef<number | null>(null);
  const resumeReceiverRef = useRef<any>(null);
  const searchStartRef = useRef<number | null>(null);
  // Always points at the latest handleTopBackPress so effects (hardware back) can call it.
  const topBackRef = useRef<() => void>(() => {});

  const [longSearch, setLongSearch] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [animStyle] = useState<FindingAnimation>(DEFAULT_FINDING_ANIMATION);

  // Embedded LiveTrackingScreen states
  const mapRef = useRef<MapView>(null);
  const [trackingLoading, setTrackingLoading] = useState(!!initialDeliveryId || isProviderMode);
  const [trackingData, setTrackingData] = useState<RouteData | null>(null);
  const [trackingProvider, setTrackingProvider] = useState<any>(null);
  const [trackingVehicle, setTrackingVehicle] = useState<any>(null);
  const [fix, setFix] = useState<ProviderFix | null>(null);
  const [tick, setTick] = useState(0);
  const trackingSheetHeight = Math.round(winH * 0.44);
  const trackingExpandedH = Math.round(winH * 0.9);
  const trackingCollapsedY = trackingExpandedH - trackingSheetHeight;
  const trackingSheetY = useRef(new Animated.Value(trackingCollapsedY)).current;
  const trackingSheetRef = useRef<DraggableSheetHandle>(null);
  const findingSheetY = useRef(new Animated.Value(trackingCollapsedY)).current;
  const findingSheetRef = useRef<DraggableSheetHandle>(null);
  const [trackingExpanded, setTrackingExpanded] = useState(false);
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

  const spinAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const radarAnim1 = useRef(new Animated.Value(0)).current;
  const radarAnim2 = useRef(new Animated.Value(0)).current;
  const radarAnim3 = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetRef = useRef<DraggableSheetHandle>(null);
  const [footerH, setFooterH] = useState(150);
  const [sheetContentH, setSheetContentH] = useState(0);

  const isMountedRef = useRef(true);
  const isResumedSession = useRef(false);
  const matchChannelRef = useRef<any>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const proceedingRef = useRef(false);
  const proceedReturnToRef = useRef<number | null>(null);
  const [savingBooking, setSavingBooking] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsBusy, setTermsBusy] = useState(false);
  const termsOkRef = useRef(false);

  const cancellingRef = useRef(false);

  const preferredAtPaymentRef = useRef<PreferredSnapshot>({
    requestId: null,
    providerId: null,
    routeId: null,
    name: null,
  });

  const [receiver, setReceiver] = useState<any>(state.receiver || null);

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [fallbackAction, setFallbackAction] = useState<'return_to_sender' | 'leave_with_guard'>(
    state.fallbackAction || 'return_to_sender'
  );
  const [fallbackRecipientName, setFallbackRecipientName] = useState<string>(
    state.fallbackRecipientName || ''
  );

  const displayCost: number | undefined = resumeInfo?.estimatedCost ?? state.estimatedCost;

  const baseFareAmount = useMemo(() => {
    return pricing ? pricing.total : Number(displayCost || 0);
  }, [pricing, displayCost]);

  const returnDepositAmount = useMemo(() => {
    return fallbackAction === 'return_to_sender'
      ? Number((baseFareAmount * 0.5).toFixed(2))
      : 0;
  }, [fallbackAction, baseFareAmount]);

  const totalEscrowAmount = useMemo(() => {
    return Number((baseFareAmount + returnDepositAmount).toFixed(2));
  }, [baseFareAmount, returnDepositAmount]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    dispatch({
      type: 'SET_FALLBACK_CONFIG',
      payload: {
        fallbackAction,
        fallbackRecipientName,
        baseFare: baseFareAmount,
        returnDeposit: returnDepositAmount,
      },
    });
    dispatch({ type: 'SET_ESTIMATED_COST', payload: totalEscrowAmount });
  }, [fallbackAction, fallbackRecipientName, baseFareAmount, returnDepositAmount, totalEscrowAmount, dispatch]);
  const [refiningDistance, setRefiningDistance] = useState(false);

  // Fetch preferred provider info and departure time immediately when coming from Explore
  useEffect(() => {
    if (!state.preferredProviderId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: provider } = await withTimeout(
          supabase
            .from('users')
            .select('first_name, last_name, phone_number')
            .eq('user_id', state.preferredProviderId)
            .maybeSingle(),
        );

        let routeId = state.preferredRouteId;
        if (!routeId) {
          const { data: rRow } = await withTimeout(
            supabase
              .from('provider_routes')
              .select('route_id')
              .eq('provider_id', state.preferredProviderId)
              .eq('is_active', true)
              .eq('is_deleted', false)
              .order('is_selected', { ascending: false })
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
          );
          routeId = rRow?.route_id ?? null;
        }

        let vehicle: any = null;
        let depTime: string | null = null;
        let freq: string | null = null;

        if (routeId) {
          const { data: routeRow } = await withTimeout(
            supabase
              .from('provider_routes')
              .select('departure_time, route_frequency, vehicle:vehicles!provider_routes_vehicle_id_fkey(vehicle_type, plate_number)')
              .eq('route_id', routeId)
              .maybeSingle(),
          );
          if (routeRow) {
            depTime = routeRow.departure_time ?? null;
            freq = routeRow.route_frequency ?? null;
            vehicle = Array.isArray((routeRow as any).vehicle)
              ? (routeRow as any).vehicle[0]
              : (routeRow as any).vehicle;
          }
        }

        if (!cancelled && isMountedRef.current) {
          setProviderData({
            first_name: provider?.first_name || state.preferredProviderName?.split(' ')[0] || 'Selected',
            last_name: provider?.last_name || state.preferredProviderName?.split(' ').slice(1).join(' ') || 'Provider',
            phone_number: provider?.phone_number || '',
            vehicle_type: vehicle?.vehicle_type || 'Courier Vehicle',
            plate_number: vehicle?.plate_number || 'Assigned Route',
          });
          setDepartureTime(depTime);
          setRouteFrequency(freq);
        }
      } catch (e) {
        console.warn('Failed to fetch preferred provider info', e);
      }
    })();
    return () => { cancelled = true; };
  }, [state.preferredProviderId, state.preferredRouteId, state.preferredProviderName]);

  useEffect(() => {
    if (!state.pickupLocation || !state.dropoffLocation) return;

    const scheduled = mode === 'schedule' || !!state.scheduledDate;

    const quickKm = quickEstimateKm(state.pickupLocation, state.dropoffLocation);
    const quickResult = computePricing({
      distanceKm: quickKm,
      items: state.items,
      scheduled,
      dropoffType: state.dropoffType,
      refined: false,
    });
    setPricing(quickResult);
    dispatch({ type: 'SET_ESTIMATED_COST', payload: quickResult.total });

    let cancelled = false;
    setRefiningDistance(true);

    (async () => {
      try {
        const realKm = await withTimeout(
          getRoadDistanceKm(state.pickupLocation!, state.dropoffLocation!),
          NETWORK_TIMEOUT_MS,
          'Distance calculation',
        );
        if (cancelled || !isMountedRef.current) return;

        const refinedResult = computePricing({
          distanceKm: realKm,
          items: state.items,
          scheduled,
          dropoffType: state.dropoffType,
          refined: true,
        });
        setPricing(refinedResult);
        dispatch({ type: 'SET_ESTIMATED_COST', payload: refinedResult.total });
      } catch (e) {
        console.warn('Fare refinement failed', e);
      } finally {
        if (!cancelled && isMountedRef.current) setRefiningDistance(false);
      }
    })();

    return () => { cancelled = true; };
  }, [state.pickupLocation, state.dropoffLocation, state.items, mode, state.scheduledDate, state.dropoffType, dispatch]);

  useEffect(() => {
    if (state.receiver) setReceiver(state.receiver);
  }, [state.receiver]);

  useEffect(() => {
    sheetAnim.setValue(0);
    Animated.timing(sheetAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bookingState, sheetAnim]);

  useEffect(() => {
    sheetRef.current?.close();
    findingSheetRef.current?.close();
    trackingSheetRef.current?.close();
  }, [bookingState]);

  useEffect(() => {
    return () => {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (proceedReturnToRef.current !== null) {
        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        setSavingBooking(false);
      }
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    const locked = bookingState === 'finding' && !longSearch;
    // After payment (finding / matched / no_match) the booking flow behind this screen
    // (receiver modal, size, locations...) must never be reachable by swiping or by the
    // Android back button. Back always exits to the Activity > Pending tab instead.
    const postPayment =
      !!savedRequestId &&
      !isResumedSession.current &&
      (bookingState === 'finding' || bookingState === 'matched' || bookingState === 'no_match');

    navigation.setOptions({ gestureEnabled: !(locked || postPayment) });
    if (!locked && !postPayment) return;

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!locked) topBackRef.current();
      return true;
    });
    return () => sub.remove();
  }, [bookingState, longSearch, navigation, savedRequestId]);

  useEffect(() => {
    if (bookingState === 'finding') {
      setIsSearching(true);

      const startedAt = searchStartRef.current ?? Date.now();
      searchStartRef.current = startedAt;
      const elapsed = Math.max(0, Date.now() - startedAt);
      const remaining = Math.max(0, SEARCH_DURATION_MS - elapsed);
      progressAnim.setValue(Math.min(elapsed / SEARCH_DURATION_MS, 1));
      setLongSearch(remaining === 0);
      let longSearchTimer: ReturnType<typeof setTimeout> | null = null;

      if (remaining > 0) {
        Animated.timing(progressAnim, {
          toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: false,
        }).start();
        longSearchTimer = setTimeout(() => setLongSearch(true), remaining);
      }

      const spinLoop = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 2800, easing: Easing.linear, useNativeDriver: true })
      );
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      spinAnim.setValue(0);
      pulseAnim.setValue(0);
      spinLoop.start();
      pulseLoop.start();
      const dotsTimer = setInterval(() => setDotCount(c => (c + 1) % 4), 450);

      const createRadarWave = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true,
            }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        );

      const r1 = createRadarWave(radarAnim1, 0);
      const r2 = createRadarWave(radarAnim2, 650);
      const r3 = createRadarWave(radarAnim3, 1300);

      r1.start(); r2.start(); r3.start();

      return () => {
        r1.stop(); r2.stop(); r3.stop();
        spinLoop.stop(); pulseLoop.stop();
        progressAnim.stopAnimation();
        clearInterval(dotsTimer);
        if (longSearchTimer) clearTimeout(longSearchTimer);
      };
    }
  }, [bookingState, radarAnim1, radarAnim2, radarAnim3, progressAnim, spinAnim, pulseAnim]);

  useEffect(() => {
    if (bookingState !== 'finding') return;

    setStatusIndex(0);
    textAnim.setValue(1);

    const timer = setInterval(() => {
      Animated.timing(textAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setStatusIndex(i => (i + 1) % FINDING_STATUS_MESSAGES.length);
        Animated.timing(textAnim, {
          toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }).start();
      });
    }, 4000);

    return () => {
      clearInterval(timer);
      textAnim.stopAnimation();
    };
  }, [bookingState, textAnim]);

  // =========================================================================
  // EMBEDDED LIVE TRACKING LOGIC (Synced with LiveTrackingScreen.tsx)
  // =========================================================================

  const handleMessageProvider = useCallback(async () => {
    if (openingChat) return;
    if (isProviderMode || !trackingData?.deliveryId) {
      Alert.alert(
        'Please wait',
        'Chat becomes available as soon as the courier accepts your request.',
      );
      return;
    }
    try {
      setOpeningChat(true);
      const roomId = await withTimeout(
        getOrCreateChatRoom(trackingData.deliveryId),
        NETWORK_TIMEOUT_MS,
        'Open chat',
      );
      if (!roomId) {
        Alert.alert('Error', 'Could not open chat.');
        return;
      }

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
      navigation.navigate('MainTabs', {
        screen: 'Messages',
        params: { openRoomId: roomId },
      });
    } catch (e) {
      console.warn('[BookingScreen] open chat failed:', e);
      Alert.alert('Error', 'Could not open chat.');
    } finally {
      if (isMountedRef.current) setOpeningChat(false);
    }
  }, [trackingData?.deliveryId, isProviderMode, openingChat, navigation]);

  const loadProviderStatic = useCallback(async () => {
    if (!providerParamId) return;
    try {
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
      const { data: r } = await withTimeout(q.limit(1).maybeSingle());

      if (!r || !isMountedRef.current) {
        if (isMountedRef.current) setTrackingLoading(false);
        return;
      }

      const start: any = (r as any).start_location;
      const end: any = (r as any).end_location;

      setTrackingData({
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
      setTrackingVehicle((r as any).vehicle ?? null);

      const { data: p } = await withTimeout(
        supabase
          .from('users')
          .select('user_id, first_name, last_name, phone_number, profile_photo')
          .eq('user_id', providerParamId)
          .maybeSingle(),
      );
      if (isMountedRef.current) setTrackingProvider(p);

      const { data: f } = await withTimeout(
        supabase
          .from('provider_live_locations')
          .select('latitude, longitude, heading, speed, accuracy, updated_at')
          .eq('provider_id', providerParamId)
          .maybeSingle(),
      );
      if (f && isMountedRef.current) {
        setFix({
          latitude: f.latitude,
          longitude: f.longitude,
          heading: f.heading ?? null,
          speed: f.speed ?? null,
          accuracy: f.accuracy ?? null,
          updated_at: f.updated_at,
        });
      }
    } catch (e) {
      console.warn('[BookingScreen] loadProviderStatic failed:', e);
    } finally {
      if (isMountedRef.current) setTrackingLoading(false);
    }
  }, [providerParamId, routeParamId]);

  const loadTrackingStatic = useCallback(async (overrideDeliveryId?: number) => {
    if (isProviderMode) { await loadProviderStatic(); return; }
    const targetDeliveryId = overrideDeliveryId ?? activeDeliveryId;
    if (!targetDeliveryId) return;

    try {
      const { data: d } = await withTimeout(
        supabase
          .from('deliveries')
          .select(`
            delivery_id, request_id, provider_id, accepted_at, completed_at, estimated_eta,
            provider_on_way_at, provider_eta_mins, receiver_notified, dropoff_arrived_at,
            meetup_landmark_name, meetup_lat, meetup_lng,
            vehicle:vehicles(vehicle_id, vehicle_type, plate_number, max_weight_kg),
            request:delivery_requests(
              request_id, delivery_status, receiver_phone,
              pickup:locations!delivery_requests_pickup_location_id_fkey(*),
              dropoff:locations!delivery_requests_dropoff_location_id_fkey(*),
              cargo:cargo_id(description, items_json, small_box_qty, medium_box_qty, large_box_qty, is_fragile)
            )
          `)
          .eq('delivery_id', targetDeliveryId)
          .maybeSingle(),
      );

      if (!d || !isMountedRef.current) {
        if (isMountedRef.current) setTrackingLoading(false);
        return;
      }

      const { data: qr } = await withTimeout(
        supabase
          .from('qr_verifications')
          .select('pickup_verified, dropoff_verified')
          .eq('delivery_id', targetDeliveryId)
          .maybeSingle(),
      );

      const req: any = (d as any).request;
      const pickupLoc = req?.pickup;
      const dropoffLoc = req?.dropoff;
      const cargo = Array.isArray(req?.cargo) ? req?.cargo[0] : req?.cargo;

      if (!isMountedRef.current) return;

      setTrackingData({
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
        meetupLandmarkName: (d as any).meetup_landmark_name ?? null,
        meetupLat: (d as any).meetup_lat ?? null,
        meetupLng: (d as any).meetup_lng ?? null,
      });
      setTrackingVehicle((d as any).vehicle ?? null);

      try {
        const { data: full } = await withTimeout(
          supabase.from('delivery_requests').select('*').eq('request_id', d.request_id).maybeSingle(),
        );
        if (isMountedRef.current) {
          setPay(extractPay(full));
          setPkgPhoto(findPhoto(full));
        }
      } catch { /* payment info is optional */ }

      if (d.provider_id) {
        const { data: p } = await withTimeout(
          supabase
            .from('users')
            .select('user_id, first_name, last_name, phone_number, profile_photo')
            .eq('user_id', d.provider_id)
            .maybeSingle(),
        );
        if (isMountedRef.current) setTrackingProvider(p);
      }

      const latest = await withTimeout(fetchLatestFix(targetDeliveryId), NETWORK_TIMEOUT_MS, 'Fetch location');
      if (latest && isMountedRef.current) setFix(latest);
    } catch (e) {
      console.warn('[BookingScreen] loadTrackingStatic failed:', e);
    } finally {
      if (isMountedRef.current) setTrackingLoading(false);
    }
  }, [activeDeliveryId, isProviderMode, loadProviderStatic]);

  useEffect(() => {
    if (bookingState === 'tracking' && (activeDeliveryId || isProviderMode)) {
      loadTrackingStatic();
    }
  }, [bookingState, activeDeliveryId, isProviderMode, loadTrackingStatic]);

  const rowToFix = (row: any): ProviderFix => ({
    latitude: row.latitude,
    longitude: row.longitude,
    heading: row.heading ?? null,
    speed: row.speed ?? null,
    accuracy: row.accuracy ?? null,
    updated_at: row.updated_at,
  });

  useEffect(() => {
    if (bookingState !== 'tracking' || !isProviderMode || !providerParamId) return;
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
  }, [bookingState, isProviderMode, providerParamId]);

  useEffect(() => {
    if (bookingState !== 'tracking' || isProviderMode || !activeDeliveryId) return;
    const ch = supabase
      .channel(`live-track-${activeDeliveryId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'delivery_locations', filter: `delivery_id=eq.${activeDeliveryId}` },
        (payload: any) => {
          if (payload.eventType === 'DELETE') { setFix(null); return; }
          if (payload.new) setFix(rowToFix(payload.new));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'deliveries', filter: `delivery_id=eq.${activeDeliveryId}` },
        () => loadTrackingStatic(activeDeliveryId),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qr_verifications', filter: `delivery_id=eq.${activeDeliveryId}` },
        () => loadTrackingStatic(activeDeliveryId),
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [bookingState, activeDeliveryId, isProviderMode, loadTrackingStatic]);

  useEffect(() => {
    if (bookingState !== 'tracking') return;
    const t = setInterval(() => setTick(x => x + 1), 15_000);
    return () => clearInterval(t);
  }, [bookingState]);

  const targetIsDropoff = isProviderMode || (!!trackingData?.pickupVerified && !trackingData?.completedAt);
  const navTarget = trackingData ? (targetIsDropoff ? trackingData.dropoff : trackingData.pickup) : null;
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
    withTimeout(getRouteCached(from, to), NETWORK_TIMEOUT_MS, 'Live route')
      .then(r => {
        if (seq !== reqSeq.current || !isMountedRef.current) return;
        alongRef.current = undefined;
        offCount.current = 0;
        setNavRoute({ r, idx: buildRouteIndex(r), tKey: key });
      })
      .catch(() => { /* keep the last route */ })
      .finally(() => {
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
    if (bookingState !== 'tracking' || !trackingData || !navTarget || trackingData.completedAt) return;
    const to = { latitude: navTarget.latitude, longitude: navTarget.longitude };
    const origin: LatLng = me ?? { latitude: trackingData.pickup.latitude, longitude: trackingData.pickup.longitude };
    if (navRoute?.tKey !== tKey) {
      if (inflightKey.current !== tKey) requestRoute(origin, to, tKey, !!me);
      return;
    }
    if (inflightKey.current === tKey) return;
    const now = Date.now();
    if (me && !routeFromMe.current) { requestRoute(me, to, tKey, true); return; }
    if (progress && progress.offRouteM > OFF_ROUTE_M) {
      offCount.current += 1;
      if (offCount.current >= 2 && now - lastReqAt.current > REROUTE_MIN_GAP_MS) {
        requestRoute(origin, to, tKey, !!me);
      }
      return;
    }
    offCount.current = 0;
    if (me && now - lastReqAt.current > ROUTE_REFRESH_MS) requestRoute(me, to, tKey, true);
  }, [bookingState, trackingData, navTarget, me, tKey, navRoute, progress, requestRoute]);

  const linePts = useMemo(() => {
    if (!navRoute || navRoute.tKey !== tKey || navRoute.r.coords.length < 2) return null;
    if (progress && me && navRoute.r.source !== 'straight') {
      return remainingPath(navRoute.r, navRoute.idx, progress.along, me);
    }
    return navRoute.r.coords;
  }, [navRoute, tKey, progress, me]);

  const liveM = me && navTarget ? haversineM(me, navTarget) : null;
  const closeBy = liveM != null && liveM < 150;
  const distanceM: number | null = progress ? (closeBy ? liveM : progress.remainingM) : null;
  const durationS: number | null = progress
    ? (progress.remainingM > 0 && distanceM != null
      ? progress.remainingS * Math.min(1, distanceM / progress.remainingM)
      : 0)
    : null;

  const viewPickupLocation = resumeInfo?.pickupLocation ?? state.pickupLocation;
  const viewDropoffLocation = resumeInfo?.dropoffLocation ?? state.dropoffLocation;

  const pickupLat = trackingData?.pickup.latitude ?? viewPickupLocation?.latitude ?? null;
  const pickupLng = trackingData?.pickup.longitude ?? viewPickupLocation?.longitude ?? null;
  const dropoffLat = trackingData?.dropoff.latitude ?? viewDropoffLocation?.latitude ?? null;
  const dropoffLng = trackingData?.dropoff.longitude ?? viewDropoffLocation?.longitude ?? null;

  // Draw full road route polyline on the fixed map for all states (review, finding, matched, tracking)
  useEffect(() => {
    if (pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) {
      setFullRoute([]);
      return;
    }
    let cancelled = false;
    withTimeout(
      getNavRoute(
        { latitude: pickupLat, longitude: pickupLng },
        { latitude: dropoffLat, longitude: dropoffLng },
      ),
      NETWORK_TIMEOUT_MS,
      'Preview route',
    )
      .then(r => { if (!cancelled && isMountedRef.current) setFullRoute(r.coords); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const mapTopPad = Math.round(insets.top + 70);
  const mapBottomPad = SHEET_MAX_H + 16;

  const fitAll = useCallback((animated: boolean) => {
    if (pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) return;
    const pts: LatLng[] = [
      { latitude: pickupLat, longitude: pickupLng },
      { latitude: dropoffLat, longitude: dropoffLng },
    ];
    if (bookingState === 'tracking' && fix) {
      pts.push({ latitude: fix.latitude, longitude: fix.longitude });
    }
    const edgePadding = (bookingState === 'tracking' || bookingState === 'finding')
      ? { top: 110, right: 60, bottom: trackingSheetHeight + 70, left: 60 }
      : { top: mapTopPad, right: 55, bottom: mapBottomPad, left: 55 };

    mapRef.current?.fitToCoordinates(pts, { edgePadding, animated });
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, bookingState, fix, trackingSheetHeight, mapTopPad, mapBottomPad]);

  useEffect(() => {
    if (pickupLat == null || pickupLng == null || dropoffLat == null || dropoffLng == null) return;
    const key = `${bookingState}-${targetIsDropoff}-${trackingSheetHeight}-${pickupLat.toFixed(4)}-${dropoffLat.toFixed(4)}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;
    const t = setTimeout(() => fitAll(false), 180);
    return () => clearTimeout(t);
  }, [bookingState, targetIsDropoff, trackingSheetHeight, pickupLat, pickupLng, dropoffLat, dropoffLng, fitAll]);

  const stage = timelineStage(trackingData);
  useEffect(() => {
    if (bookingState !== 'tracking') return;
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
    ]).start(() => {
      if (isMountedRef.current) setStageBanner(null);
    });
  }, [bookingState, stage, bannerAnim]);

  const isStale = fix ? Date.now() - new Date(fix.updated_at).getTime() > STALE_MS : true;
  void tick;

  const callProvider = () => {
    const phone = trackingProvider?.phone_number || providerData?.phone_number;
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  // =========================================================================
  // BOOKING & MATCHING HANDLERS
  // =========================================================================

  /**
   * Navigates to ActivityScreen -> Pending tab, then opens LiveTrackingScreen on top
   * so pressing Back from LiveTracking lands directly on the Pending tab.
   */
  const navigateToPendingAndLiveTracking = useCallback(
    (opts: {
      requestId: number | null;
      deliveryId?: number | null;
      providerId?: number | null;
      routeId?: number | null;
    }) => {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      setIsSearching(false);
      proceedingRef.current = false;
      proceedReturnToRef.current = null;
      setSavingBooking(false);
      dispatch({ type: 'RESET' });

      navigation.navigate('MainTabs', {
        screen: 'Activity',
        params: {
          tab: 'pending',
          pendingRequestId: opts.requestId ?? undefined,
          openLiveTracking: true,
          deliveryId: opts.deliveryId ?? undefined,
          providerId: opts.providerId ?? undefined,
          routeId: opts.routeId ?? undefined,
        },
      });
    },
    [dispatch, navigation],
  );

  const loadProviderRating = async (providerId: number) => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('ratings_reviews')
          .select('rating, review_text, created_at')
          .eq('reviewee_id', providerId)
          .order('created_at', { ascending: false })
          .limit(20),
      );

      if (error) throw error;
      if (!isMountedRef.current) return;

      const rows = data || [];
      if (rows.length === 0) {
        setProviderRating({ avg: 0, count: 0, recent: [] });
        return;
      }
      const sum = rows.reduce((s: number, r: any) => s + Number(r.rating || 0), 0);
      const avg = sum / rows.length;

      setProviderRating({
        avg: Number(avg.toFixed(1)),
        count: rows.length,
        recent: rows.slice(0, 2).map((r: any) => ({
          rating: Number(r.rating) || 0,
          comment: r.review_text ?? null,
          created_at: r.created_at,
        })),
      });
    } catch (e: any) {
      console.warn('[Booking] rating fetch failed', e?.message || e);
      if (isMountedRef.current) setProviderRating(null);
    }
  };

  const loadProviderDeparture = async (routeId: number | null | undefined, providerId?: number | null) => {
    try {
      if (routeId) {
        const { data, error } = await withTimeout(
          supabase
            .from('provider_routes')
            .select('departure_time, route_frequency')
            .eq('route_id', routeId)
            .maybeSingle(),
        );

        if (!error && data?.departure_time) {
          if (isMountedRef.current) {
            setDepartureTime(data.departure_time);
            setRouteFrequency(data.route_frequency ?? null);
          }
          return;
        }
      }
      if (providerId) {
        const { data: fallbackRoute } = await withTimeout(
          supabase
            .from('provider_routes')
            .select('departure_time, route_frequency')
            .eq('provider_id', providerId)
            .eq('is_active', true)
            .eq('is_deleted', false)
            .order('is_selected', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        if (fallbackRoute?.departure_time) {
          if (isMountedRef.current) {
            setDepartureTime(fallbackRoute.departure_time);
            setRouteFrequency(fallbackRoute.route_frequency ?? null);
          }
          return;
        }
      }
      if (isMountedRef.current) {
        setDepartureTime(null);
        setRouteFrequency(null);
      }
    } catch (e) {
      console.warn('[Booking] departure fetch failed', e);
      if (isMountedRef.current) {
        setDepartureTime(null);
        setRouteFrequency(null);
      }
    }
  };

  /**
   * Subscribes to realtime `deliveries` INSERT (when any matched provider accepts the request)
   * and `route_request_matches` INSERT/UPDATE (if a new matching route appears while waiting).
   * Once accepted, navigates to ActivityScreen (Pending tab) and opens LiveTrackingScreen.
   */
  const attachAcceptanceAndMatchListener = (requestId: number, stopTimerOnMatch = false) => {
    if (matchChannelRef.current) {
      supabase.removeChannel(matchChannelRef.current);
      matchChannelRef.current = null;
    }

    const matchChannel = supabase
      .channel(`match-listener-${requestId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${requestId}` },
        async (payload) => {
          const delivery = payload.new;

          const { data: provider } = await withTimeout(
            supabase
              .from('users')
              .select('first_name, last_name, phone_number')
              .eq('user_id', delivery.provider_id)
              .single(),
          );
          const { data: vehicle } = await withTimeout(
            supabase
              .from('vehicles')
              .select('vehicle_type, plate_number, max_weight_kg')
              .eq('vehicle_id', delivery.vehicle_id)
              .single(),
          );

          if (!isMountedRef.current) return;

          if (provider && vehicle) setProviderData({ ...provider, ...vehicle });
          if (delivery.provider_id) loadProviderRating(delivery.provider_id);

          await loadProviderDeparture(delivery.route_id, delivery.provider_id);

          fireMatchNotification(
            provider ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'A courier' : 'A courier',
            vehicle?.plate_number || '—',
            delivery.delivery_id,
          );

          if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
            searchTimeoutRef.current = null;
          }
          supabase.removeChannel(matchChannel);
          matchChannelRef.current = null;

          setActiveDeliveryId(delivery.delivery_id);
          setIsDirectPreferredProvider(false);
          setIsAcceptedByProvider(true);
          setMatchFound(true);
          setIsSearching(false);

          // Go to ActivityScreen (Pending tab) and show LiveTrackingScreen
          navigateToPendingAndLiveTracking({
            requestId,
            deliveryId: delivery.delivery_id,
            providerId: delivery.provider_id,
            routeId: delivery.route_id,
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'route_request_matches', filter: `request_id=eq.${requestId}` },
        async () => {
          const { data: rows } = await withTimeout(
            supabase
              .from('route_request_matches')
              .select('*, route:provider_routes(*), request:delivery_requests(pickup_location:locations!delivery_requests_pickup_location_id_fkey(latitude,longitude), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(latitude,longitude))')
              .eq('request_id', requestId)
              .eq('status', 'matched')
              .order('match_score', { ascending: false }),
          );

          // Only providers that really drive within ~200 m of the pickup AND drop-off are shown.
          const strictRows = (rows || []).filter((m: any) => {
            const r = Array.isArray(m.route) ? m.route[0] : m.route;
            const rq = Array.isArray(m.request) ? m.request[0] : m.request;
            const ok = isRequestWithinRouteCorridor(r, rq);
            if (!ok) {
              supabase.from('route_request_matches').update({ status: 'revoked' }).eq('match_id', m.match_id)
                .then(() => {}, () => {});
            }
            return ok;
          });

          if (strictRows.length > 0 && isMountedRef.current) {
            const enriched = await enrichRouteMatchRows(strictRows);
            if (enriched.length > 0 && isMountedRef.current) {
              if (searchTimeoutRef.current && stopTimerOnMatch) {
                clearTimeout(searchTimeoutRef.current);
                searchTimeoutRef.current = null;
              }
              setMatchedProvidersList(enriched);
              setIsDirectPreferredProvider(false);
              setIsAcceptedByProvider(false);
              setMatchFound(true);
              setIsSearching(false);
              setBookingState(prev => (prev === 'tracking' ? 'tracking' : 'matched'));
              return;
            }
          }
          if (isMountedRef.current) {
            setMatchedProvidersList([]);
            setBookingState(prev => (prev === 'matched' && !isDirectPreferredProvider ? 'finding' : prev));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_live_locations' },
        () => {
          void (async () => {
            try {
              const fresh = await syncAllActiveRoutesTodayForRequest(requestId, { notify: false });
              if (!isMountedRef.current) return;
              if (fresh.length > 0) {
                if (searchTimeoutRef.current && stopTimerOnMatch) {
                  clearTimeout(searchTimeoutRef.current);
                  searchTimeoutRef.current = null;
                }
                setMatchedProvidersList(fresh);
                setIsDirectPreferredProvider(false);
                setIsAcceptedByProvider(false);
                setMatchFound(true);
                setIsSearching(false);
                setBookingState(prev => (prev === 'tracking' ? 'tracking' : 'matched'));
              } else {
                const diag = await explainMatchesForRequest(requestId).catch(() => null);
                if (diag) console.log('[BookingScreen] LIVE RE-EVAL (0 matches):', JSON.stringify(diag, null, 2));
                setMatchedProvidersList([]);
                setBookingState(prev => (prev === 'matched' && !isDirectPreferredProvider ? 'finding' : prev));
              }
            } catch { /* ignore */ }
          })();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_routes' },
        () => {
          void (async () => {
            try {
              const fresh = await syncAllActiveRoutesTodayForRequest(requestId, { notify: false });
              if (!isMountedRef.current) return;
              if (fresh.length > 0) {
                setMatchedProvidersList(fresh);
                setMatchFound(true);
                setIsSearching(false);
                setBookingState(prev => (prev === 'tracking' ? 'tracking' : 'matched'));
              }
            } catch { /* ignore */ }
          })();
        },
      )
      .subscribe();

    matchChannelRef.current = matchChannel;
  };

  /**
   * Used ONLY when the sender explicitly chose a single preferred provider on ExploreScreen.
   */
  const finalizePreferredProviderBooking = async (opts: {
    requestId: number;
    providerId: number;
    routeId?: number | null;
    notifyProvider?: boolean;
  }) => {
    const { requestId, providerId, routeId, notifyProvider = false } = opts;

    try {
      const { data: provider } = await withTimeout(
        supabase
          .from('users')
          .select('first_name, last_name, phone_number')
          .eq('user_id', providerId)
          .maybeSingle(),
      );

      let resolvedRouteId = routeId ?? null;
      if (!resolvedRouteId) {
        const { data: rRow } = await withTimeout(
          supabase
            .from('provider_routes')
            .select('route_id')
            .eq('provider_id', providerId)
            .eq('is_active', true)
            .eq('is_deleted', false)
            .order('is_selected', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        resolvedRouteId = rRow?.route_id ?? null;
      }

      let vehicle: any = null;
      let depTime: string | null = null;
      let freq: string | null = null;

      if (resolvedRouteId) {
        const { data: routeRow } = await withTimeout(
          supabase
            .from('provider_routes')
            .select('departure_time, route_frequency, vehicle:vehicles!provider_routes_vehicle_id_fkey(vehicle_type, plate_number, max_weight_kg)')
            .eq('route_id', resolvedRouteId)
            .maybeSingle(),
        );
        if (routeRow) {
          depTime = routeRow.departure_time ?? null;
          freq = routeRow.route_frequency ?? null;
          vehicle = Array.isArray((routeRow as any).vehicle)
            ? (routeRow as any).vehicle[0]
            : (routeRow as any).vehicle;
        }
      }

      if (!vehicle) {
        const { data: vRow } = await withTimeout(
          supabase
            .from('vehicles')
            .select('vehicle_type, plate_number, max_weight_kg')
            .eq('provider_id', providerId)
            .limit(1)
            .maybeSingle(),
        );
        vehicle = vRow;
      }

      if (!isMountedRef.current) return;

      setProviderData({
        first_name: provider?.first_name || state.preferredProviderName?.split(' ')[0] || 'Matched',
        last_name: provider?.last_name || state.preferredProviderName?.split(' ').slice(1).join(' ') || 'Provider',
        phone_number: provider?.phone_number || '',
        vehicle_type: vehicle?.vehicle_type || 'Courier Vehicle',
        plate_number: vehicle?.plate_number || 'Assigned Route',
        max_weight_kg: vehicle?.max_weight_kg ?? null,
      });

      setDepartureTime(depTime);
      setRouteFrequency(freq);
      loadProviderRating(providerId);

      const providerFullName =
        provider
          ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim()
          : state.preferredProviderName || 'your selected provider';

      if (notifyProvider) {
        const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
        try {
          await notifyUser(
            providerId,
            '📦 New Route Delivery Request!',
            `A sender requested a delivery (#${trackingId}) along your route. Open the Jobs tab to review and accept it.`,
            { type: 'direct_route_request', requestId, routeId: resolvedRouteId ?? null },
          );
        } catch (err) {
          console.warn('[BookingScreen] direct provider push failed:', err);
        }
        fireDirectRequestNotification(providerFullName, requestId, 1, false);
      }

      setMatchedProvidersList([]);
      setIsDirectPreferredProvider(true);
      setIsAcceptedByProvider(false);
      setMatchFound(true);
      setIsSearching(false);
      setBookingState('matched');

      // Keep listening for when the preferred provider accepts into `deliveries`
      attachAcceptanceAndMatchListener(requestId, false);
    } catch (e) {
      console.warn('[BookingScreen] finalizePreferredProviderBooking failed:', e);
      if (!isMountedRef.current) return;
      setIsDirectPreferredProvider(true);
      setIsAcceptedByProvider(false);
      setMatchFound(true);
      setIsSearching(false);
      setBookingState('matched');
      attachAcceptanceAndMatchListener(requestId, false);
    }
  };

  const startMatching = async (opts?: { reuseRequestId?: number | null }) => {
    try {
      if (!receiver?.receiver_id && !receiver?.receiver_phone) {
        Alert.alert('Required', 'Please select a receiver before booking.');
        return;
      }

      let requestId: number;

      if (opts?.reuseRequestId) {
        requestId = opts.reuseRequestId;
      } else if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        requestId = state.editIds.requestId;
      } else {
        const savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
        if (!savedRequest) throw new Error('Failed to save request');
        requestId = savedRequest.request_id;
      }

      if (!isMountedRef.current) return;
      setSavedRequestId(requestId);
      searchStartTimes.set(requestId, searchStartRef.current ?? Date.now());

      let matchedRoutes: RouteMatchRow[] = [];
      try {
        matchedRoutes = await syncAllActiveRoutesTodayForRequest(requestId, { notify: true });
      } catch (e) {
        console.warn('[BookingScreen] route matching failed:', e);
      }

      if (matchedRoutes.length === 0) {
        // Why did nothing match? Per-route reasons (day / time window / corridor / capacity) go to the log.
        try {
          console.log(
            '[BookingScreen] NO MATCHES for request',
            requestId,
            JSON.stringify(await explainMatchesForRequest(requestId), null, 2),
          );
        } catch (e) {
          console.warn('[BookingScreen] explainMatchesForRequest failed:', e);
        }
      }

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      if (matchedRoutes.length > 0 && isMountedRef.current) {
        const firstProv = matchedRoutes[0].provider;
        const firstName = firstProv
          ? `${firstProv.first_name || ''} ${firstProv.last_name || ''}`.trim()
          : 'a route provider';

        fireDirectRequestNotification(firstName, requestId, matchedRoutes.length, true);

        setMatchedProvidersList(matchedRoutes);
        setIsDirectPreferredProvider(false);
        setIsAcceptedByProvider(false);
        setMatchFound(true);
        setIsSearching(false);
        setBookingState('matched');

        attachAcceptanceAndMatchListener(requestId, true);
        return;
      }

      attachAcceptanceAndMatchListener(requestId, true);

      searchTimeoutRef.current = setTimeout(() => {
        searchTimeoutRef.current = null;
        if (isMountedRef.current) {
          setBookingState(prev => (prev === 'finding' ? 'no_match' : prev));
          setIsSearching(false);
        }
      }, SEARCH_DURATION_MS);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to process your booking. Please try again.');
      if (isMountedRef.current) setBookingState('review');
    }
  };

  const resumeBooking = async (requestId: number) => {
    if (savedRequestId === requestId && bookingState !== 'review') return;
    try {
      searchStartRef.current = Date.now();

      const [reqRes, delRes, existingMatchRes] = await Promise.all([
        withTimeout(
          supabase
            .from('delivery_requests')
            .select(`*, pickup_location:locations!delivery_requests_pickup_location_id_fkey (*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (*), receiver:receivers!delivery_requests_receiver_id_fkey (receiver_id, receiver_name, receiver_phone, receiver_email, is_favorite)`)
            .eq('request_id', requestId)
            .maybeSingle(),
        ),
        withTimeout(
          supabase
            .from('deliveries')
            .select('*')
            .eq('request_id', requestId)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
        withTimeout(
          supabase
            .from('route_request_matches')
            .select('*, route:provider_routes(*, start_location:locations!provider_routes_start_location_id_fkey(latitude,longitude), end_location:locations!provider_routes_end_location_id_fkey(latitude,longitude))')
            .eq('request_id', requestId)
            .eq('status', 'matched')
            .order('match_score', { ascending: false }),
        ),
      ]);

      if (reqRes.error) throw reqRes.error;
      const req = reqRes.data;
      if (!req) {
        Alert.alert('Order not found', 'This delivery request no longer exists.');
        navigation.goBack();
        return;
      }

      if (!isMountedRef.current) return;
      isResumedSession.current = true;
      setSavedRequestId(requestId);

      setResumeInfo({
        pickupLocation: {
          address: req.pickup_location?.street_address,
          place_name: req.pickup_location?.place_name ?? null,
          latitude: req.pickup_location?.latitude ?? null,
          longitude: req.pickup_location?.longitude ?? null,
        },
        dropoffLocation: {
          address: req.dropoff_location?.street_address,
          place_name: req.dropoff_location?.place_name ?? null,
          latitude: req.dropoff_location?.latitude ?? null,
          longitude: req.dropoff_location?.longitude ?? null,
        },
        estimatedCost: Number(req.estimated_cost) || 0,
      });

      const rcv = req.receiver
        ? {
            receiver_id: req.receiver.receiver_id ?? req.receiver_id ?? null,
            receiver_name: req.receiver.receiver_name ?? null,
            receiver_phone: req.receiver.receiver_phone ?? req.receiver_phone ?? '',
            receiver_email: req.receiver.receiver_email ?? null,
            is_favorite: req.receiver.is_favorite ?? false,
          }
        : req.receiver_phone
          ? { receiver_id: req.receiver_id ?? null, receiver_name: null, receiver_phone: req.receiver_phone }
          : null;

      resumeReceiverRef.current = rcv;
      if (rcv) setReceiver(rcv);

      const delivery = delRes.data;
      if (delivery && isMountedRef.current) {
        setActiveDeliveryId(delivery.delivery_id);
        setTrackingLoading(true);
        setIsDirectPreferredProvider(false);
        setIsAcceptedByProvider(true);
        setMatchFound(true);
        setIsSearching(false);
        await loadTrackingStatic(delivery.delivery_id);
        if (isMountedRef.current) setBookingState('tracking');
        return;
      }

      const preferredFromRequest = req.preferred_provider_id ? Number(req.preferred_provider_id) : null;
      const snapshotMatches = preferredAtPaymentRef.current.requestId === requestId;
      const preferredFromSnapshot = snapshotMatches ? preferredAtPaymentRef.current.providerId : null;
      const effectivePreferredId = preferredFromRequest ?? preferredFromSnapshot;
      const effectivePreferredRoute = req.preferred_route_id
        ? Number(req.preferred_route_id)
        : snapshotMatches
          ? preferredAtPaymentRef.current.routeId
          : null;

      if (effectivePreferredId) {
        await finalizePreferredProviderBooking({
          requestId,
          providerId: effectivePreferredId,
          routeId: effectivePreferredRoute ?? null,
          notifyProvider: false,
        });
        return;
      }

      if (req.delivery_status !== 'Pending') {
        Alert.alert('Order updated', `This order is now ${req.delivery_status}.`);
        navigation.goBack();
        return;
      }

      // Fast path: show existing matched providers immediately without waiting on a full corridor rescan
      const strictExisting = (existingMatchRes.data || []).filter((m: any) => {
        const r = Array.isArray(m.route) ? m.route[0] : m.route;
        return isRequestWithinRouteCorridor(r, req);
      });

      if (strictExisting.length > 0) {
        const enriched = await enrichRouteMatchRows(strictExisting);
        if (enriched.length > 0 && isMountedRef.current) {
          setMatchedProvidersList(enriched);
          setIsDirectPreferredProvider(false);
          setIsAcceptedByProvider(false);
          setMatchFound(true);
          setIsSearching(false);
          setBookingState('matched');
          attachAcceptanceAndMatchListener(requestId, true);
          // Refresh any newer routes silently in the background
          void syncAllActiveRoutesTodayForRequest(requestId, { notify: false }).then((fresh) => {
            if (fresh.length > 0 && isMountedRef.current) setMatchedProvidersList(fresh);
          });
          return;
        }
      }

      // Slow path: keep showing the radar search animation while scanning active routes
      if (isMountedRef.current) {
        setResumeSubId(requestId);
        setBookingState('finding');
      }

      const matchedNow = await syncAllActiveRoutesTodayForRequest(requestId, { notify: false });
      if (matchedNow.length > 0 && isMountedRef.current) {
        setMatchedProvidersList(matchedNow);
        setIsDirectPreferredProvider(false);
        setIsAcceptedByProvider(false);
        setMatchFound(true);
        setIsSearching(false);
        setBookingState('matched');
        attachAcceptanceAndMatchListener(requestId, true);
      } else {
        try {
          console.log(
            '[BookingScreen] RESUME NO MATCHES for request',
            requestId,
            JSON.stringify(await explainMatchesForRequest(requestId), null, 2),
          );
        } catch { /* ignore */ }
      }
    } catch (err: any) {
      Alert.alert('Error', 'Could not load this order.');
      navigation.goBack();
    }
  };

  useEffect(() => {
    if (!isResume || !resumeRequestId) return;
    if (resumedRef.current === resumeRequestId) return;
    resumedRef.current = resumeRequestId;
    resumeBooking(resumeRequestId);
  }, [isResume, resumeRequestId]);

  useEffect(() => {
    if (bookingState !== 'finding' || !resumeSubId) return;
    attachAcceptanceAndMatchListener(resumeSubId, true);
    return () => {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
    };
  }, [bookingState, resumeSubId]);

  useEffect(() => {
    const justPaid = route.params?.paymentJustCompleted;
    const reqId = route.params?.requestId;
    if (!justPaid || !reqId) return;

    const numericReqId = Number(reqId);
    navigation.setParams({ paymentJustCompleted: undefined, requestId: undefined });
    setSavedRequestId(numericReqId);

    (async () => {
      let prefProviderId: number | null = state.preferredProviderId ?? null;
      let prefRouteId: number | null = state.preferredRouteId ?? null;
      let prefProviderName: string | null = state.preferredProviderName ?? null;

      if (!prefProviderId && preferredAtPaymentRef.current.requestId === numericReqId) {
        prefProviderId = preferredAtPaymentRef.current.providerId;
        prefRouteId = preferredAtPaymentRef.current.routeId;
        prefProviderName = preferredAtPaymentRef.current.name;
      }

      if (!prefProviderId) {
        const { data: reqRow } = await withTimeout(
          supabase
            .from('delivery_requests')
            .select('preferred_provider_id, preferred_route_id')
            .eq('request_id', numericReqId)
            .maybeSingle(),
        );
        if (reqRow?.preferred_provider_id) {
          prefProviderId = Number(reqRow.preferred_provider_id);
          prefRouteId = reqRow.preferred_route_id ? Number(reqRow.preferred_route_id) : null;
        }
      }

      // Only lock to a single provider if the sender explicitly picked one on ExploreScreen
      if (prefProviderId) {
        try {
          const { data: provider } = await withTimeout(
            supabase
              .from('users')
              .select('first_name, last_name')
              .eq('user_id', prefProviderId)
              .maybeSingle(),
          );

          const trackingId = `PNS-${String(numericReqId).padStart(4, '0')}`;
          const providerFullName = provider
            ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'your selected provider'
            : prefProviderName || 'your selected provider';

          try {
            await notifyUser(
              prefProviderId,
              '📦 New Route Delivery Request!',
              `A sender requested a delivery (#${trackingId}) along your route. Open the Jobs tab to review and accept it.`,
              { type: 'direct_route_request', requestId: numericReqId, routeId: prefRouteId ?? null },
            );
          } catch (err) {
            console.warn('[BookingScreen] direct provider push failed:', err);
          }

          fireDirectRequestNotification(providerFullName, numericReqId, 1, false);
        } catch (e) {
          console.warn('[BookingScreen] post-payment provider notify failed:', e);
        }

        preferredAtPaymentRef.current = { requestId: null, providerId: null, routeId: null, name: null };

        try {
          await withTimeout(
            supabase
              .from('delivery_requests')
              .update({ preferred_provider_id: prefProviderId, preferred_route_id: prefRouteId ?? null })
              .eq('request_id', numericReqId),
          );
          await syncAllActiveRoutesTodayForRequest(numericReqId, { notify: false });
        } catch (e) {
          console.warn('[BookingScreen] direct match sync failed:', e);
        }

        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }

        await finalizePreferredProviderBooking({
          requestId: numericReqId,
          providerId: prefProviderId,
          routeId: prefRouteId ?? null,
          notifyProvider: false,
        });

        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        if (isMountedRef.current) setSavingBooking(false);
        return;
      }

      searchStartRef.current = Date.now();
      if (isMountedRef.current) setBookingState('finding');
      startMatching({ reuseRequestId: numericReqId });
    })();
  }, [route.params?.paymentJustCompleted, route.params?.requestId]);

  const acceptBookingTerms = async () => {
    try {
      setTermsBusy(true);
      await recordTermsAcceptance('booking');
      termsOkRef.current = true;
      setTermsOpen(false);
      setTermsBusy(false);
      handleProceedToPayment();
    } catch (e: any) {
      setTermsBusy(false);
      Alert.alert("Couldn't save your agreement", e?.message || 'Please try again.');
    }
  };

  const handleProceedToPayment = async () => {
    if (proceedingRef.current) return;
    if (!state.isEdit && !termsOkRef.current && (await needsAcceptance('booking'))) {
      setTermsOpen(true);
      return;
    }
    termsOkRef.current = false;
    proceedingRef.current = true;
    setSavingBooking(true);

    try {
      if (!receiver?.receiver_id && !receiver?.receiver_phone) {
        Alert.alert('Receiver Required', 'Please select who will receive this package.');
        proceedingRef.current = false;
        setSavingBooking(false);
        return;
      }

      if (fallbackAction === 'leave_with_guard' && !fallbackRecipientName.trim()) {
        Alert.alert(
          'Fallback Recipient Required',
          'Please enter the name of the person or place (e.g., "Building Guardhouse" or "Neighbor Maria") where the courier can leave the package.'
        );
        proceedingRef.current = false;
        setSavingBooking(false);
        return;
      }

      if (mode === 'sendNow' && state.scheduledDate) {
        const scheduledMs = parseManilaNaive(String(state.scheduledDate));
        const nowMs = parseManilaNaive(nowManilaNaive());
        if (!isNaN(scheduledMs) && !isNaN(nowMs)) {
          const diffMinutes = Math.abs(scheduledMs - nowMs) / 60000;
          if (diffMinutes > SEND_NOW_WINDOW_MINUTES) {
            Alert.alert(
              'Schedule Too Far',
              `Send Now requests must be within ${SEND_NOW_WINDOW_MINUTES} minutes.`,
            );
            proceedingRef.current = false;
            setSavingBooking(false);
            return;
          }
        }
      }

      let requestId: number;

      if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        requestId = state.editIds.requestId;
      } else {
        const savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
        if (!savedRequest) throw new Error('Failed to save request');
        requestId = savedRequest.request_id;
      }

      if (state.preferredProviderId) {
        try {
          await withTimeout(
            supabase
              .from('delivery_requests')
              .update({
                preferred_provider_id: state.preferredProviderId,
                preferred_route_id: state.preferredRouteId ?? null,
              })
              .eq('request_id', requestId),
          );
        } catch (e) {
          console.warn('[BookingScreen] failed to persist preferred provider:', e);
        }
      }

      preferredAtPaymentRef.current = {
        requestId,
        providerId: state.preferredProviderId ?? null,
        routeId: state.preferredRouteId ?? null,
        name: state.preferredProviderName ?? null,
      };

      proceedReturnToRef.current = requestId;
      setSavedRequestId(requestId);
      const amount = totalEscrowAmount;
      navigation.navigate('DeliveryPayment', { requestId, amount });
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not save your request. Please try again.');
      proceedingRef.current = false;
      proceedReturnToRef.current = null;
      setSavingBooking(false);
    }
  };

  const handleCancelBooking = async () => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;

    let wasPaid = false;
    let refundSucceeded = false;
    let refundFailed = false;
    let cancelledAmount: number | null = null;
    let cancelledProviderId: number | null = null;
    let cancelledRequestId: number | null = null;

    try {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      if (savedRequestId) {
        cancelledRequestId = savedRequestId;

        const { data: reqRow } = await withTimeout(
          supabase
            .from('delivery_requests')
            .select('payment_status, escrow_status, estimated_cost, payment_provider, refund_status, preferred_provider_id')
            .eq('request_id', savedRequestId)
            .maybeSingle(),
        );

        cancelledAmount = Number(reqRow?.estimated_cost) || 0;

        const { data: deliveryRow } = await withTimeout(
          supabase
            .from('deliveries')
            .select('delivery_id, provider_id')
            .eq('request_id', savedRequestId)
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        );
        cancelledProviderId = deliveryRow?.provider_id ?? reqRow?.preferred_provider_id ?? null;

        const wasHeld =
          reqRow?.payment_status === 'held' ||
          reqRow?.escrow_status === 'held';
        wasPaid = wasHeld;

        if (wasHeld) {
          try {
            const { data: refundResult, error: refundErr } = await withTimeout(
              supabase.functions.invoke(
                'xendit-refund',
                { body: { request_id: savedRequestId, reason: 'REQUESTED_BY_CUSTOMER' } },
              ),
              15_000,
              'Refund initiation',
            );

            const ok = !refundErr && refundResult?.success;

            if (!ok) {
              refundFailed = true;

              const msg =
                refundResult?.error ||
                refundErr?.message ||
                'Refund could not be started.';
              const needsManual = refundResult?.needs_manual === true;

              await supabase
                .from('delivery_requests')
                .update({
                  delivery_status: 'Cancelled',
                  refund_status: needsManual ? 'manual_required' : 'failed',
                })
                .eq('request_id', savedRequestId);

              await supabase.from('escrow_transactions').insert({
                request_id: savedRequestId,
                event: 'refund_auto_failed',
                amount: Number(reqRow?.estimated_cost) || 0,
                provider: reqRow?.payment_provider ?? null,
                notes: `Auto-refund failed: ${msg}`,
              });

              Alert.alert(
                'Booking Cancelled',
                `Your booking has been cancelled.\n\n` +
                  `The automatic refund could not be started:\n${msg}\n\n` +
                  `Your funds are still held in escrow. Please contact support with ` +
                  `tracking ID PNS-${String(savedRequestId).padStart(4, '0')} so we can process your refund manually.`,
                [{ text: 'OK' }],
              );
            } else {
              refundSucceeded = true;

              await supabase
                .from('delivery_requests')
                .update({ delivery_status: 'Cancelled' })
                .eq('request_id', savedRequestId);

              Alert.alert(
                'Booking Cancelled',
                'Your refund has been initiated.\n\n' +
                  'Most GCash/Maya refunds arrive within a few minutes, but may take ' +
                  'up to 3–5 business days depending on your wallet provider.',
              );
            }
          } catch (e: any) {
            refundFailed = true;

            await supabase
              .from('delivery_requests')
              .update({ delivery_status: 'Cancelled', refund_status: 'failed' })
              .eq('request_id', savedRequestId);

            Alert.alert(
              'Booking Cancelled',
              `Your booking was cancelled, but we could not reach the payment service ` +
                `(${e?.message || 'network error'}). Your funds are still held in escrow — ` +
                `please contact support with tracking ID PNS-${String(savedRequestId).padStart(4, '0')}.`,
            );
          }
        } else {
          const { data: cargoRow } = await supabase
            .from('delivery_requests')
            .select('cargo_id')
            .eq('request_id', savedRequestId)
            .maybeSingle();
          await supabase.from('route_request_matches').delete().eq('request_id', savedRequestId);
          await supabase.from('delivery_requests').delete().eq('request_id', savedRequestId);
          if (cargoRow?.cargo_id) {
            await supabase.from('cargo_profiles').delete().eq('cargo_id', cargoRow.cargo_id);
          }
        }
      }

      setResumeSubId(null);
      preferredAtPaymentRef.current = { requestId: null, providerId: null, routeId: null, name: null };

      if (cancelledRequestId != null) {
        fireCancelNotification({
          requestId: cancelledRequestId,
          amount: cancelledAmount,
          refunded: refundSucceeded,
          refundFailed,
        });
      }

      if (cancelledProviderId && cancelledRequestId != null) {
        notifyProviderOfCancellation({
          providerId: cancelledProviderId,
          requestId: cancelledRequestId,
          amount: cancelledAmount,
        });
      }

      if (isResumedSession.current) {
        isResumedSession.current = false;
        navigation.goBack();
        return;
      }

      if (wasPaid) {
        dispatch({ type: 'RESET' });
        setSavedRequestId(null);
        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        setSavingBooking(false);
        navigation.popTo('MainTabs');
        return;
      }

      setBookingState('review');
    } finally {
      cancellingRef.current = false;
    }
  };

  const handleGoHome = () => {
    if (matchChannelRef.current) {
      supabase.removeChannel(matchChannelRef.current);
      matchChannelRef.current = null;
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setIsSearching(false);
    proceedingRef.current = false;
    proceedReturnToRef.current = null;
    setSavingBooking(false);
    dispatch({ type: 'RESET' });
    navigation.popTo('MainTabs');
  };

  const handleTryAgain = () => {
    searchStartRef.current = Date.now();
    setBookingState('finding');
    startMatching({ reuseRequestId: savedRequestId });
  };

  const handleConfirmAction = () => {
    const topMatch = matchedProvidersList[0];
    const resolvedProviderId =
      trackingData?.providerId ??
      topMatch?.provider_id ??
      state.preferredProviderId ??
      preferredAtPaymentRef.current.providerId ??
      null;
    const resolvedRouteId =
      topMatch?.route_id ??
      state.preferredRouteId ??
      preferredAtPaymentRef.current.routeId ??
      null;

    navigateToPendingAndLiveTracking({
      requestId: savedRequestId,
      deliveryId: isAcceptedByProvider ? activeDeliveryId : null,
      providerId: resolvedProviderId,
      routeId: resolvedRouteId,
    });
  };

  const handleTopBackPress = () => {
    // Payment is already done: leave the whole booking flow and land on Activity > Pending.
    // A plain goBack() here would drop the user back into the receiver modal / booking flow.
    const postPayment =
      !!savedRequestId &&
      !isResumedSession.current &&
      (bookingState === 'finding' || bookingState === 'matched' || bookingState === 'no_match');
    if (postPayment) {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
      setIsSearching(false);
      proceedingRef.current = false;
      proceedReturnToRef.current = null;
      setSavingBooking(false);
      dispatch({ type: 'RESET' });
      navigation.popTo('MainTabs', {
        screen: 'Activity',
        params: { tab: 'pending', pendingRequestId: savedRequestId ?? undefined },
      });
      return;
    }

    if (bookingState === 'tracking' && !isResumedSession.current && !initialDeliveryId && !isProviderMode) {
      dispatch({ type: 'RESET' });
      proceedingRef.current = false;
      proceedReturnToRef.current = null;
      setSavingBooking(false);
      navigation.popTo('MainTabs');
      return;
    }
    navigation.goBack();
  };
  topBackRef.current = handleTopBackPress;

  const handleSelectReceiver = () => {
    navigation.navigate('ReceiverPicker', {
      selectedReceiverId: receiver?.receiver_id || null,
    });
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const picked = route.params?.pickedReceiver;
      if (picked) {
        setReceiver(picked);
        dispatch({ type: 'SET_INITIAL_STATE', payload: { ...state, receiver: picked } as any });
        navigation.setParams({ pickedReceiver: undefined });
      }
    });
    return unsubscribe;
  }, [navigation, route.params?.pickedReceiver]);

  // Landmark / street labels shown under the pickup and drop-off pins (synced with LiveTrackingScreen)
  const pickupLabel = useMemo(() => {
    if (trackingData) return placeParts(trackingData.pickup);
    return placeLabel(viewPickupLocation);
  }, [trackingData, viewPickupLocation]);

  const dropoffLabel = useMemo(() => {
    if (trackingData) return placeParts(trackingData.dropoff);
    return placeLabel(viewDropoffLocation);
  }, [trackingData, viewDropoffLocation]);

  const sheetFadeUp = {
    opacity: sheetAnim,
    transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  const sheetMaxH = Math.round(height * 0.82) - footerH;
  const sheetH = sheetContentH > 0 ? Math.min(sheetMaxH, 32 + sheetContentH) : sheetMaxH;
  const sheetVisibleH = Math.min(sheetH, Math.max(140, SHEET_MAX_H - footerH));
  const sheetCollapsedY = Math.max(0, sheetH - sheetVisibleH);

  const formattedDep = formatDepartureTime(departureTime, routeFrequency);

  // Derived values for embedded LiveTrackingScreen sheet
  const etaLabel = trackingData?.completedAt ? 'Delivered' : durationS != null ? fmtDuration(durationS) : '—';
  const hasEta = etaLabel !== '—' && !trackingData?.completedAt;
  const plate = trackingVehicle?.plate_number || providerData?.plate_number || null;
  const routeKm = fullRoute.length > 1 ? `${polylineDistanceKm(fullRoute).toFixed(2)} km` : null;
  const statusText = trackingData?.completedAt ? 'Delivered' : isStale ? 'Waiting for GPS' : 'Live';
  const trackingProviderName = trackingProvider
    ? `${trackingProvider.first_name ?? ''} ${trackingProvider.last_name ?? ''}`.trim() || 'Provider'
    : providerData
      ? `${providerData.first_name ?? ''} ${providerData.last_name ?? ''}`.trim() || 'Provider'
      : 'Provider';
  const trackingInitials =
    trackingProviderName.split(' ').filter(Boolean).slice(0, 2).map((s: string) => s[0]?.toUpperCase()).join('') || 'C';
  const pkgTotal = trackingData?.items.length ?? 0;

  const onShareTracking = async () => {
    try {
      await Share.share({
        message:
          `Pack-N-Ship delivery${plate ? ` · provider ${plate}` : ''}\n` +
          `From: ${[pickupLabel.title, pickupLabel.sub].filter(Boolean).join(', ')}\n` +
          `To: ${[dropoffLabel.title, dropoffLabel.sub].filter(Boolean).join(', ')}\n` +
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
      <StatusBar
        barStyle={bookingState === 'tracking' ? 'dark-content' : colors.statusBarStyle}
        backgroundColor="transparent"
        translucent
      />

      {/* FIXED / DEFAULT LIVE TRACKING MAP ACROSS ALL CONTAINER STATES */}
      <MapView
        ref={mapRef}
        {...MAP_PROPS}
        userInterfaceStyle="light"
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: pickupLat ?? 10.3157,
          longitude: pickupLng ?? 123.8854,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onPress={() => {
          sheetRef.current?.close();
          findingSheetRef.current?.close();
          trackingSheetRef.current?.close();
        }}
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
        {bookingState === 'tracking' && linePts && linePts.length > 1 && (
          <Polyline coordinates={linePts} strokeColor={colors.accent} strokeWidth={6} lineCap="round" lineJoin="round" />
        )}

        {pickupLat != null && pickupLng != null && (
          <PlaceMarker
            lat={pickupLat}
            lng={pickupLng}
            title={pickupLabel.title}
            street={pickupLabel.sub}
            kind="pickup"
            mk={mk}
          />
        )}

        {dropoffLat != null && dropoffLng != null && (
          <PlaceMarker
            lat={dropoffLat}
            lng={dropoffLng}
            title={dropoffLabel.title}
            street={dropoffLabel.sub}
            kind="dropoff"
            mk={mk}
          />
        )}

        {bookingState === 'tracking' && fix && <CourierMarker fix={fix} live={!isStale} />}
      </MapView>

      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={handleTopBackPress} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      {bookingState === 'tracking' && stageBanner && (
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

      {/* FINDING PROVIDER SHEET — Styled like LiveTrackingScreen ("Provider is on the way to pickup") */}
      {bookingState === 'finding' && (
        <DraggableSheet
          ref={findingSheetRef}
          y={findingSheetY}
          collapsedY={trackingCollapsedY}
          height={trackingExpandedH}
          contentPaddingBottom={insets.bottom + 24}
          style={styles.trackingSheet}
          handleHitAreaStyle={styles.grabberWrap}
          handleStyle={styles.grabber}
          header={(
            <View style={styles.sheetHeader}>
              <Text style={styles.headline}>
                {longSearch ? (
                  <>
                    Still searching for a <Text style={styles.headlineAccent}>provider</Text>
                    {'.'.repeat(dotCount)}
                  </>
                ) : (
                  <>
                    Finding a <Text style={styles.headlineAccent}>provider</Text> for your pickup
                    {'.'.repeat(dotCount)}
                  </>
                )}
              </Text>
            </View>
          )}
        >
          {/* Main Search Card — Mirrors LiveTrackingScreen's Provider Card */}
          <View style={styles.trackingCard}>
            <View style={styles.cardTop}>
              <View style={styles.profileRow}>
                <View style={styles.findingAvatarRadarWrap}>
                  {/* Background layer: pulsing radar rings stay strictly behind */}
                  <View style={styles.findingRadarLayer} pointerEvents="none">
                    {[radarAnim1, radarAnim2, radarAnim3].map((anim, i) => (
                      <Animated.View
                        key={i}
                        style={[
                          styles.findingRadarRing,
                          {
                            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.85] }) }],
                            opacity: anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.6 - i * 0.12, 0] }),
                          },
                        ]}
                      />
                    ))}
                  </View>

                  {/* Foreground layer: solid circle + pin icon stay strictly on top */}
                  <View style={styles.findingRadarCore} collapsable={false}>
                    <SolarIcon name="MapPoint" variant="bold" size={24} color="#FFFFFF" />
                  </View>
                </View>
                <Image source={VEHICLE_IMG} style={styles.vehicleImg} resizeMode="contain" />
              </View>

              <View style={styles.rightBlock}>
                <View style={styles.plateBox}>
                  <Text style={styles.plateText}>{longSearch ? 'BROADCAST' : 'SEARCHING'}</Text>
                </View>
                <Text style={styles.vehicleSub} numberOfLines={1}>MATCHING ROUTE</Text>
              </View>
            </View>

            <Animated.View
              style={[
                { marginTop: 14, marginBottom: 12, minHeight: 22 },
                longSearch
                  ? null
                  : {
                      opacity: textAnim,
                      transform: [{ translateY: textAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
                    },
              ]}
            >
              <Text style={styles.findingStatusHeadline} numberOfLines={2}>
                {longSearch
                  ? "Taking longer than usual. You can leave this screen — we'll keep looking."
                  : FINDING_STATUS_MESSAGES[statusIndex]}
              </Text>
            </Animated.View>

            <View style={styles.progressContainer}>
              <Animated.View
                style={[
                  styles.progressBar,
                  {
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            {receiver && (
              <>
                <View style={styles.cardDivider} />
                <View style={styles.findingRecipientRow}>
                  <View style={styles.payIcon}>
                    <Ionicons name="person-outline" size={20} color={colors.textPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle} numberOfLines={1}>
                      {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Receiver'}
                    </Text>
                    <Text style={styles.paySub} numberOfLines={1}>
                      {receiver.receiver_phone || receiver.phone_number || 'No Phone'}
                    </Text>
                  </View>
                  <View style={styles.verifiedTagPill}>
                    <SolarIcon name="ShieldCheck" variant="duotone" size={13} color={colors.success} />
                    <Text style={styles.verifiedTagText}>Recipient</Text>
                  </View>
                </View>
              </>
            )}

            <View style={styles.cardDivider} />
            <View style={styles.payRow}>
              <View style={styles.payIcon}>
                <Ionicons name="cash-outline" size={22} color={colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.payTitle}>Total pay</Text>
                <Text style={styles.paySub}>Held in escrow</Text>
              </View>
              <Text style={styles.payAmount}>
                {totalEscrowAmount > 0 ? `₱${totalEscrowAmount.toFixed(2)}` : '—'}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.cancelTextButton, { marginTop: 14 }]}
              onPress={handleCancelBooking}
              activeOpacity={0.85}
            >
              <SolarIcon name="CloseCircle" variant="linear" size={18} color={colors.error} />
              <Text style={styles.cancelTextButtonLabel}>Cancel Search</Text>
            </TouchableOpacity>
          </View>

          {/* Route Timeline Card — Revealed on drag up, identical to LiveTrackingScreen */}
          <View style={styles.trackingCard}>
            {!!savedRequestId && kv('Pack-N-Ship ID', `PNS-${String(savedRequestId).padStart(4, '0')}`)}

            <View style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={styles.tlPickIcon}><Ionicons name="cube" size={16} color="#FFFFFF" /></View>
                <View style={styles.tlLine} />
              </View>
              <View style={styles.tlBody}>
                <Text style={styles.tlTitle} numberOfLines={1}>{pickupLabel.title}</Text>
                {!!pickupLabel.sub && <Text style={styles.tlSub} numberOfLines={2}>{pickupLabel.sub}</Text>}
              </View>
            </View>

            <View style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={styles.tlDropIcon}><Ionicons name="person" size={18} color="#000000" /></View>
              </View>
              <View style={styles.tlBody}>
                <Text style={styles.tlTitle} numberOfLines={1}>{dropoffLabel.title}</Text>
                {(!!routeKm || !!dropoffLabel.sub) && (
                  <Text style={styles.tlSub} numberOfLines={2}>
                    {routeKm ? `${routeKm}${dropoffLabel.sub ? ' • ' : ''}` : ''}{dropoffLabel.sub}
                  </Text>
                )}
              </View>
            </View>
          </View>
        </DraggableSheet>
      )}

      {bookingState === 'no_match' && (
        <View style={styles.bottomSheet}>
          <Animated.View style={[styles.sheetCardNoMatch, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.noMatchIconCircle}>
              <Ionicons name="notifications-outline" size={34} color={ORANGE} />
            </View>
            <Text style={styles.noMatchTitle}>We'll Notify You When Matched!</Text>
            <Text style={styles.noMatchSubtitle}>
              Your delivery request is live and broadcasted to couriers along your route. You don't need to wait here — we'll send you a notification as soon as a provider accepts!
            </Text>

            <View style={styles.noMatchActions}>
              <TouchableOpacity
                style={[styles.noMatchBtn, styles.retryBtn]}
                onPress={handleGoHome}
                activeOpacity={0.9}
              >
                <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>Got It, Go Home</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.noMatchBtn, styles.modifyBtn]}
                onPress={handleTryAgain}
                activeOpacity={0.9}
              >
                <Ionicons name="refresh" size={15} color={colors.textSecondary} />
                <Text style={styles.modifyBtnText}>Search 10s More</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      )}

      {bookingState === 'review' && (
        <>
          <DraggableSheet
            ref={sheetRef}
            y={sheetY}
            collapsedY={sheetCollapsedY}
            height={sheetH}
            contentPaddingBottom={16}
            style={[styles.dragSheet, { bottom: footerH, opacity: sheetAnim }]}
            handleHitAreaStyle={styles.dragHandleHit}
            handleStyle={styles.dragHandle}
            onContentHeight={setSheetContentH}
          >
            <View style={styles.rvHeader}>
              <Text style={styles.rvTitle}>Review & pay</Text>
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                backgroundColor: /door/i.test(String(state.dropoffType || '')) ? colors.infoSoft : colors.warningBg,
                borderWidth: 1,
                borderColor: /door/i.test(String(state.dropoffType || '')) ? colors.info : colors.warning,
                borderRadius: 14,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <SolarIcon
                name={/door/i.test(String(state.dropoffType || '')) ? 'Routing' : 'MapPoint'}
                variant="duotone"
                size={18}
                color={/door/i.test(String(state.dropoffType || '')) ? colors.info : colors.warning}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: colors.textPrimary }}>
                  {/door/i.test(String(state.dropoffType || ''))
                    ? 'Door-to-Door Selected (Final once paid)'
                    : 'Curb-side Selected · Strict No Detour (Final once paid)'}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: 'Poppins_400Regular', color: colors.textSecondary, marginTop: 2, lineHeight: 16 }}>
                  {/door/i.test(String(state.dropoffType || ''))
                    ? 'Driver will come straight to your pickup and drop-off pins.'
                    : 'Meet the driver curbside on their main route (nearest landmark if >15 m off-road). Remind your receiver too.'}
                </Text>
              </View>
            </View>

            {state.preferredProviderId && (
              <View style={styles.preferredProviderBanner}>
                <View style={styles.preferredProviderIcon}>
                  <SolarIcon name="Car" variant="boldDuotone" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.preferredProviderLabel}>SELECTED COURIER PARTNER</Text>
                  <Text style={styles.preferredProviderName} numberOfLines={1}>
                    {providerData ? `${providerData.first_name || ''} ${providerData.last_name || ''}`.trim() || state.preferredProviderName : state.preferredProviderName || `Provider #${state.preferredProviderId}`}
                  </Text>
                  {formattedDep && (
                    <Text style={styles.preferredProviderRoute} numberOfLines={1}>
                      Time of Departure: {formattedDep}
                    </Text>
                  )}
                  {state.preferredRoute && (
                    <Text style={styles.preferredProviderRoute} numberOfLines={1}>
                      Route: {state.preferredRoute.pickup.split(',')[0]} → {state.preferredRoute.dropoff.split(',')[0]}
                    </Text>
                  )}
                </View>
                <SolarIcon name="CheckCircle" variant="duotone" size={20} color={colors.success} />
              </View>
            )}

            <View style={[styles.rvCard, !receiver && styles.rvCardEmpty]}>
              <TouchableOpacity
                style={styles.rvReceiverRow}
                onPress={handleSelectReceiver}
                activeOpacity={0.8}
                disabled={savingBooking}
              >
                <View style={[styles.rvAvatar, !receiver && styles.rvAvatarEmpty]}>
                  {receiver ? (
                    <Text style={styles.rvAvatarText}>
                      {(receiver.receiver_name || receiver.first_name || '?').trim().charAt(0).toUpperCase()}
                    </Text>
                  ) : (
                    <SolarIcon name="User" variant="duotone" size={18} color={ORANGE} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  {receiver ? (
                    <>
                      <Text style={styles.rvReceiverName} numberOfLines={1}>
                        {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                      </Text>
                      <Text style={styles.rvReceiverSub} numberOfLines={1}>
                        {receiver.receiver_phone || receiver.phone_number || '—'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.rvReceiverName, { color: ORANGE }]}>Select receiver</Text>
                      <Text style={styles.rvReceiverSub}>Who will receive this package?</Text>
                    </>
                  )}
                </View>
                {receiver ? (
                  <View style={styles.rvChangePill}>
                    <Text style={styles.rvChangeText}>Change</Text>
                  </View>
                ) : (
                  <SolarIcon name="AltArrowRight" variant="linear" size={18} color={ORANGE} />
                )}
              </TouchableOpacity>

              {receiver && (
                <View style={styles.rvNote}>
                  <SolarIcon name="QrCode" variant="linear" size={14} color={colors.textSecondary} />
                  <Text style={styles.rvNoteText}>
                    Show your pickup QR or PIN when the courier arrives. A delivery OTP follows for the receiver.
                  </Text>
                </View>
              )}
            </View>

            {/* PHASE 1: FALLBACK PRE-AUTHORIZATION CARD */}
            <View style={[styles.rvCard, { padding: 16 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Ionicons name="shield-half-outline" size={16} color={ORANGE} />
                <Text style={{ fontSize: 13, fontFamily: 'Poppins_700Bold', color: colors.textPrimary }}>
                  If Receiver is Unreachable (Required)
                </Text>
              </View>

              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12,
                  borderRadius: 12, borderWidth: 1.5, marginBottom: 8,
                  borderColor: fallbackAction === 'return_to_sender' ? ORANGE : colors.border,
                  backgroundColor: fallbackAction === 'return_to_sender' ? colors.accentSoft : colors.background,
                }}
                onPress={() => setFallbackAction('return_to_sender')}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={fallbackAction === 'return_to_sender' ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={fallbackAction === 'return_to_sender' ? ORANGE : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Poppins_700Bold', color: colors.textPrimary }}>
                    Option A: Return to me (Sender)
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginTop: 2 }}>
                    Adds a 50% Return Deposit (₱{(baseFareAmount * 0.5).toFixed(2)}) held in escrow. 100% refunded if delivery succeeds.
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12,
                  borderRadius: 12, borderWidth: 1.5,
                  borderColor: fallbackAction === 'leave_with_guard' ? ORANGE : colors.border,
                  backgroundColor: fallbackAction === 'leave_with_guard' ? colors.accentSoft : colors.background,
                }}
                onPress={() => setFallbackAction('leave_with_guard')}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={fallbackAction === 'leave_with_guard' ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={fallbackAction === 'leave_with_guard' ? ORANGE : colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: 'Poppins_700Bold', color: colors.textPrimary }}>
                    Option B: Leave with Guard / Neighbor / Reception
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: 'Poppins_500Medium', color: colors.textSecondary, marginTop: 2 }}>
                    ₱0 extra deposit. Courier waits 10 mins, then leaves the package with your authorized recipient with photo proof.
                  </Text>
                </View>
              </TouchableOpacity>

              {fallbackAction === 'leave_with_guard' && (
                <TextInput
                  style={{
                    marginTop: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                    paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontFamily: 'Poppins_500Medium',
                    color: colors.textPrimary, backgroundColor: colors.card,
                  }}
                  placeholder="Enter person or place (e.g., Guardhouse / Neighbor Maria)"
                  placeholderTextColor={colors.textMuted}
                  value={fallbackRecipientName}
                  onChangeText={setFallbackRecipientName}
                  maxLength={100}
                />
              )}
            </View>

            <View style={styles.rvCard}>
              {pricing ? (
                <View style={styles.rvFareRows}>
                  <View style={styles.rvFareRow}>
                    <Text style={styles.rvFareLabel}>Base fee</Text>
                    <Text style={styles.rvFareValue}>₱{pricing.base.toFixed(2)}</Text>
                  </View>
                  <View style={styles.rvFareRow}>
                    <Text style={styles.rvFareLabel}>Distance · {pricing.distanceKm.toFixed(1)} km</Text>
                    <Text style={styles.rvFareValue}>₱{pricing.distance.toFixed(2)}</Text>
                  </View>
                  {pricing.size > 0 && (
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Package size</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.size.toFixed(2)}</Text>
                    </View>
                  )}
                  {pricing.fragile > 0 && (
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Fragile handling</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.fragile.toFixed(2)}</Text>
                    </View>
                  )}
                  {pricing.schedule > 0 && (
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Scheduled delivery</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.schedule.toFixed(2)}</Text>
                    </View>
                  )}
                  {pricing.emergency > 0 && (
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Emergency priority</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.emergency.toFixed(2)}</Text>
                    </View>
                  )}
                  {returnDepositAmount > 0 && (
                    <View style={styles.rvFareRow}>
                      <Text style={[styles.rvFareLabel, { color: ORANGE, fontFamily: 'Poppins_700Bold' }]}>
                        Return Deposit (Refunded on success)
                      </Text>
                      <Text style={[styles.rvFareValue, { color: ORANGE, fontFamily: 'Poppins_800ExtraBold' }]}>
                        ₱{returnDepositAmount.toFixed(2)}
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.rvCalcRow}>
                  <ActivityIndicator size="small" color={ORANGE} />
                  <Text style={styles.rvFareLabel}>Calculating fare…</Text>
                </View>
              )}
            </View>
          </DraggableSheet>

          <Animated.View
            style={[styles.dragFooter, { opacity: sheetAnim, paddingBottom: Math.max(insets.bottom, 16) }]}
            onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          >
            <View style={styles.sheetFooter}>
              <View style={styles.rvTotalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rvTotalLabel}>Total{refiningDistance ? ' · updating…' : ''}</Text>
                  <View style={styles.rvEscrowRow}>
                    <SolarIcon name="ShieldCheck" variant="linear" size={12} color={colors.success} />
                    <Text style={styles.rvEscrowText}>Held in escrow until delivery</Text>
                  </View>
                </View>
                <Text style={styles.rvTotalValue}>
                  ₱{totalEscrowAmount.toFixed(2)}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  ((!receiver || !pricing) || savingBooking) && styles.primaryButtonDisabled,
                ]}
                onPress={handleProceedToPayment}
                disabled={!receiver || !pricing || savingBooking}
                activeOpacity={0.9}
              >
                {savingBooking ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <SolarIcon name="Card" variant="linear" size={16} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>
                      {pricing ? 'Proceed to Payment' : 'Calculating fare…'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {!receiver && <Text style={styles.primaryButtonHint}>Select a receiver first to enable payment</Text>}
            </View>
          </Animated.View>
        </>
      )}

      {bookingState === 'matched' && matchFound && (
        <>
          <DraggableSheet
            ref={sheetRef}
            y={sheetY}
            collapsedY={sheetCollapsedY}
            height={sheetH}
            contentPaddingBottom={16}
            style={[styles.dragSheet, { bottom: footerH, opacity: sheetAnim }]}
            handleHitAreaStyle={styles.dragHandleHit}
            handleStyle={styles.dragHandle}
            onContentHeight={setSheetContentH}
          >
            {/* Route-Relevant Header */}
            <View style={styles.matchedHeader}>
              <View style={styles.matchedHeaderIcon}>
                <SolarIcon name="CheckCircle" variant="duotone" size={22} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchedHeaderTitle}>
                  {isAcceptedByProvider
                    ? 'Provider Accepted!'
                    : isDirectPreferredProvider
                      ? 'Waiting for Acceptance'
                      : `${matchedProvidersList.length} Provider${matchedProvidersList.length === 1 ? '' : 's'} Matched`}
                </Text>
                <Text style={styles.matchedHeaderSub}>
                  {isAcceptedByProvider
                    ? 'Your courier is heading to pickup'
                    : isDirectPreferredProvider
                      ? 'Not assigned yet · Waiting for your chosen courier to accept'
                      : 'Waiting for acceptance · Not assigned yet'}
                </Text>
              </View>
            </View>

            {/* Matched Pickup -> Drop-off Corridor Pill */}
            <View style={styles.matchedCorridorCard}>
              <View style={styles.matchedCorridorRow}>
                <View style={styles.matchedCorridorDotPick} />
                <Text style={styles.matchedCorridorText} numberOfLines={1}>
                  {pickupLabel.title}
                </Text>
              </View>
              <View style={styles.matchedCorridorArrow}>
                <SolarIcon name="AltArrowDown" variant="linear" size={14} color={ORANGE} />
                <Text style={styles.matchedCorridorTag}>MATCHED CORRIDOR</Text>
              </View>
              <View style={styles.matchedCorridorRow}>
                <View style={styles.matchedCorridorDotDrop} />
                <Text style={styles.matchedCorridorText} numberOfLines={1}>
                  {dropoffLabel.title}
                </Text>
              </View>
            </View>

            {/* CASE A: Accepted by a provider OR Direct Preferred Provider from Explore */}
            {(isAcceptedByProvider || isDirectPreferredProvider) ? (
              <View style={styles.matchedInnerCard}>
                <View style={styles.matchedRow}>
                  <View style={styles.matchedLeftCol}>
                    <View style={styles.matchedAvatarCircle}>
                      <SolarIcon name="User" variant="boldDuotone" size={28} color="#FFFFFF" />
                    </View>
                    <View style={styles.matchedVerifiedBadge}>
                      <SolarIcon name="Check" variant="bold" size={10} color="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.matchedRightCol}>
                    <Text style={styles.matchedName} numberOfLines={1}>
                      {providerData ? `${providerData.first_name} ${providerData.last_name}` : 'Loading...'}
                    </Text>
                    <View style={styles.carDetailBox}>
                      <View style={styles.carDetailRow}>
                        <SolarIcon name="Car" variant="linear" size={12} color={colors.textSecondary} />
                        <Text style={styles.carText} numberOfLines={1}>{providerData?.vehicle_type || 'Courier Vehicle'}</Text>
                      </View>
                      <View style={styles.carDetailRow}>
                        <SolarIcon name="TagPrice" variant="linear" size={12} color={colors.textSecondary} />
                        <Text style={styles.carText}>{providerData?.plate_number || 'Assigned Route'}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                {formattedDep && (
                  <View style={styles.departureBanner}>
                    <View style={styles.departureIconBox}>
                      <SolarIcon name="Clock" variant="bold" size={16} color={ORANGE} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.departureLabel}>PROVIDER TIME OF DEPARTURE</Text>
                      <Text style={styles.departureValue}>{formattedDep}</Text>
                    </View>
                  </View>
                )}

                {providerRating && (
                  <>
                    <View style={styles.matchedDivider} />
                    <View style={styles.ratingSummaryRow}>
                      <View style={styles.ratingStarsInline}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <SolarIcon
                            key={n}
                            name="Star"
                            variant={n <= Math.round(providerRating.avg) ? 'boldDuotone' : 'linear'}
                            size={14}
                            color={colors.warning}
                          />
                        ))}
                      </View>
                      <Text style={styles.ratingAvgText}>
                        {providerRating.count > 0
                          ? `${providerRating.avg.toFixed(1)} · ${providerRating.count} review${providerRating.count === 1 ? '' : 's'}`
                          : 'No reviews yet'}
                      </Text>
                    </View>

                    {providerRating.recent.length > 0 && (
                      <View style={styles.recentReviewsWrap}>
                        {providerRating.recent.map((r, i) => (
                          <View key={i} style={styles.recentReviewItem}>
                            <View style={styles.recentReviewHead}>
                              {[1, 2, 3, 4, 5].map(n => (
                                <SolarIcon
                                  key={n}
                                  name="Star"
                                  variant={n <= r.rating ? 'boldDuotone' : 'linear'}
                                  size={11}
                                  color={colors.warning}
                                />
                              ))}
                            </View>
                            {!!r.comment && (
                              <Text style={styles.recentReviewComment} numberOfLines={2}>
                                "{r.comment}"
                              </Text>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

                {receiver && (
                  <>
                    <View style={styles.matchedDivider} />
                    <View style={styles.matchedReceiverRow}>
                      <SolarIcon name="User" variant="linear" size={16} color={colors.textSecondary} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.matchedReceiverLabel}>CONFIRMED RECEIVER</Text>
                        <Text style={styles.matchedReceiverName} numberOfLines={1}>
                          {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                        </Text>
                        <Text style={styles.matchedReceiverPhone} numberOfLines={1}>
                          {receiver.receiver_phone || receiver.phone_number || '—'}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={styles.otpSentBanner}>
                  <SolarIcon name="QrCode" variant="linear" size={16} color={colors.success} />
                  <Text style={styles.otpSentText}>
                    Show your pickup QR code when the courier arrives
                  </Text>
                </View>

                <View style={styles.matchedDivider} />
                <View style={styles.totalRow}>
                  <View>
                    <Text style={styles.totalLabel}>Total paid</Text>
                    <Text style={styles.totalPaidBadge}>Held in escrow</Text>
                  </View>
                  <Text style={styles.totalValue}>
                    ₱{totalEscrowAmount.toFixed(2)}
                  </Text>
                </View>
              </View>
            ) : (
              /* CASE B: List ALL providers whose route matches the sender's route and wait for one to accept */
              <View style={styles.matchedInnerCard}>
                <View style={styles.waitingPulseBanner}>
                  <ActivityIndicator size="small" color={ORANGE} />
                  <Text style={styles.waitingPulseText}>
                    {matchedProvidersList.length} route partner{matchedProvidersList.length === 1 ? '' : 's'} notified · First to accept takes your delivery
                  </Text>
                </View>

                <View style={{ gap: 10, marginTop: 12 }}>
                  {matchedProvidersList.map((m, idx) => {
                    const pName = m.provider
                      ? `${m.provider.first_name || ''} ${m.provider.last_name || ''}`.trim()
                      : `Provider #${m.provider_id}`;
                    const pInitials = pName
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w: string) => w[0]?.toUpperCase())
                      .join('') || 'P';
                    const depLabel = formatDepartureTime(m.route?.departure_time, m.route?.route_frequency);

                    return (
                      <View
                        key={`${m.route_id}-${m.provider_id}`}
                        style={[styles.multiProviderItem, idx === 0 && styles.multiProviderItemTop]}
                      >
                        <View style={styles.matchedRow}>
                          <View style={styles.multiAvatarWrap}>
                            <View style={styles.multiAvatarCircle}>
                              <Text style={styles.multiAvatarInitials}>{pInitials}</Text>
                            </View>
                            <View style={styles.multiScoreBadge}>
                              <Text style={styles.multiScoreText}>{Math.round(m.match_score)}% match</Text>
                            </View>
                          </View>

                          <View style={{ flex: 1 }}>
                            <View style={styles.multiTopNameRow}>
                              <Text style={styles.matchedName} numberOfLines={1}>{pName}</Text>
                              {!!m.vehicle?.plate_number && (
                                <View style={styles.multiPlatePill}>
                                  <Text style={styles.multiPlateText}>{m.vehicle.plate_number}</Text>
                                </View>
                              )}
                            </View>

                            <View style={styles.carDetailBox}>
                              <View style={styles.carDetailRow}>
                                <SolarIcon name="Car" variant="linear" size={12} color={colors.textSecondary} />
                                <Text style={styles.carText} numberOfLines={1}>
                                  {m.vehicle?.vehicle_type || 'Courier Vehicle'}
                                </Text>
                                <Text style={styles.carText}>·</Text>
                                <SolarIcon name="Star" variant="boldDuotone" size={12} color={colors.warning} />
                                <Text style={styles.carText}>
                                  {m.rating_count && m.rating_count > 0
                                    ? `${Number(m.rating_avg || 0).toFixed(1)} (${m.rating_count})`
                                    : 'New'}
                                </Text>
                              </View>

                              {depLabel && (
                                <View style={styles.carDetailRow}>
                                  <SolarIcon name="Clock" variant="bold" size={12} color={ORANGE} />
                                  <Text style={[styles.carText, { color: ORANGE }]}>
                                    Departs: {depLabel}
                                  </Text>
                                </View>
                              )}

                              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                <View style={styles.awaitingPill}>
                                  <Text style={styles.awaitingPillText}>Waiting for acceptance · Not assigned</Text>
                                </View>
                              </View>
                            </View>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>

                {receiver && (
                  <>
                    <View style={styles.matchedDivider} />
                    <View style={styles.matchedReceiverRow}>
                      <SolarIcon name="User" variant="linear" size={16} color={colors.textSecondary} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.matchedReceiverLabel}>CONFIRMED RECEIVER</Text>
                        <Text style={styles.matchedReceiverName} numberOfLines={1}>
                          {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                        </Text>
                        <Text style={styles.matchedReceiverPhone} numberOfLines={1}>
                          {receiver.receiver_phone || receiver.phone_number || '—'}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={styles.matchedDivider} />
                <View style={styles.totalRow}>
                  <View>
                    <Text style={styles.totalLabel}>Total paid</Text>
                    <Text style={styles.totalPaidBadge}>Held in escrow</Text>
                  </View>
                  <Text style={styles.totalValue}>
                    ₱{totalEscrowAmount.toFixed(2)}
                  </Text>
                </View>
              </View>
            )}
          </DraggableSheet>

          <Animated.View
            style={[styles.dragFooter, { opacity: sheetAnim, paddingBottom: Math.max(insets.bottom, 16) }]}
            onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          >
            <View style={[styles.sheetFooter, { flexDirection: 'row', gap: 10 }]}>
              {!isAcceptedByProvider && (
                <TouchableOpacity
                  style={styles.matchedCancelBtn}
                  onPress={handleCancelBooking}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="CloseCircle" variant="linear" size={18} color={colors.error} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.confirmButton, { flex: 1 }]}
                onPress={handleConfirmAction}
                activeOpacity={0.9}
              >
                <SolarIcon name="Routing" variant="linear" size={16} color={colors.card} />
                <Text style={styles.confirmButtonText}>
                  {isAcceptedByProvider ? 'Open Live Tracking' : 'View in Pending & Live Track'}
                </Text>
                <SolarIcon name="AltArrowRight" variant="bold" size={16} color={colors.card} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      )}

      {/* EMBEDDED LIVE TRACKING SHEET (Connected from LiveTrackingScreen.tsx) */}
      {bookingState === 'tracking' && (
        <DraggableSheet
          ref={trackingSheetRef}
          y={trackingSheetY}
          collapsedY={trackingCollapsedY}
          height={trackingExpandedH}
          contentPaddingBottom={insets.bottom + 24}
          style={styles.trackingSheet}
          handleHitAreaStyle={styles.grabberWrap}
          handleStyle={styles.grabber}
          onOpenChange={setTrackingExpanded}
          header={(
            <View style={styles.sheetHeader}>
              {trackingLoading && !trackingData ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4 }}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.headline}>Loading live tracking…</Text>
                </View>
              ) : trackingData?.completedAt ? (
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
          
          {!!trackingData?.meetupLandmarkName && !trackingData?.pickupVerified && (
            <View
              style={[
                styles.trackingCard,
                { backgroundColor: colors.warningBg, borderColor: colors.warning, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
              ]}
            >
              <SolarIcon name="MapPoint" variant="bold" size={20} color={colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: colors.warning, letterSpacing: 0.6 }}>
                  CURB-SIDE MEET-UP POINT (MAIN ROUTE)
                </Text>
                <Text style={{ fontSize: 14, fontFamily: 'Poppins_700Bold', color: colors.textPrimary, marginTop: 2 }}>
                  Meet driver at: {trackingData.meetupLandmarkName}
                </Text>
                <Text style={{ fontSize: 11.5, fontFamily: 'Poppins_400Regular', color: colors.textSecondary, marginTop: 2 }}>
                  Drivers stay strictly on their main route for Curb-side orders. Please head to this landmark before the driver arrives.
                </Text>
              </View>
            </View>
          )}

          {/* Provider card */}
          <View style={styles.trackingCard}>
            <View style={styles.cardTop}>
              <View style={styles.profileRow}>
                <View style={styles.avatar}>
                  {trackingProvider?.profile_photo ? (
                    <Image source={{ uri: trackingProvider.profile_photo }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{trackingInitials}</Text>
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
                  {trackingVehicle?.vehicle_type
                    ? String(trackingVehicle.vehicle_type).toUpperCase()
                    : providerData?.vehicle_type
                      ? String(providerData.vehicle_type).toUpperCase()
                      : 'VEHICLE'}
                </Text>
              </View>
            </View>

            <Text style={styles.driverName} numberOfLines={1}>{trackingProviderName}</Text>

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

              <TouchableOpacity
                style={styles.iconBtn}
                onPress={callProvider}
                disabled={!(trackingProvider?.phone_number || providerData?.phone_number)}
                activeOpacity={0.7}
              >
                <Ionicons name="call" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.shareRow}>
              <View style={styles.shareLeft}>
                <Ionicons name="share-outline" size={20} color={colors.textPrimary} />
                <Text style={styles.shareText}>Share delivery details</Text>
              </View>
              <TouchableOpacity activeOpacity={0.7} onPress={onShareTracking} hitSlop={10}>
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
          <View style={styles.trackingCard}>
            {!isProviderMode && (trackingData?.deliveryId || activeDeliveryId) ? (
              kv('Pack-N-Ship ID', `#${trackingData?.deliveryId || activeDeliveryId}`)
            ) : null}
            {!!trackingData?.acceptedAt && kv('Accepted', fmtDateTime(trackingData.acceptedAt))}

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
                <Text style={styles.tlTitle} numberOfLines={1}>{pickupLabel.title}</Text>
                {!!pickupLabel.sub && <Text style={styles.tlSub} numberOfLines={2}>{pickupLabel.sub}</Text>}
              </View>
              {trackingData?.pickupVerified && <SolarIcon name="CheckCircle" variant="duotone" size={18} color={colors.success} />}
            </View>

            <View style={styles.tlRow}>
              <View style={styles.tlRail}>
                <View style={styles.tlDropIcon}><Ionicons name="person" size={18} color="#000000" /></View>
              </View>
              <View style={styles.tlBody}>
                <Text style={styles.tlTitle} numberOfLines={1}>{dropoffLabel.title}</Text>
                {(!!routeKm || !!dropoffLabel.sub) && (
                  <Text style={styles.tlSub} numberOfLines={2}>
                    {routeKm ? `${routeKm}${dropoffLabel.sub ? ' • ' : ''}` : ''}{dropoffLabel.sub}
                  </Text>
                )}
              </View>
              {trackingData?.completedAt && <SolarIcon name="CheckCircle" variant="duotone" size={18} color={colors.success} />}
            </View>
          </View>

          {pkgTotal > 0 && trackingData && (
            <View style={styles.trackingCard}>
              <Text style={styles.pkgHeader}>PACKAGES · {pkgTotal}</Text>

              <View style={{ gap: 8 }}>
                {trackingData.items.map((it, i) => {
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
                          {trackingData.items.length > 1 ? `Package ${i + 1}` : 'Package'}{it.fragile ? ' · Fragile' : ''}
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
        </DraggableSheet>
      )}

      <Modal visible={!!photoView} transparent animationType="fade" onRequestClose={() => setPhotoView(null)}>
        <Pressable style={styles.viewerOverlay} onPress={() => setPhotoView(null)}>
          {!!photoView && <Image source={{ uri: photoView }} style={styles.viewerImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.viewerClose, { top: insets.top + 12 }]} onPress={() => setPhotoView(null)} hitSlop={10}>
            <SolarIcon name="CloseCircle" variant="linear" size={28} color="#FFFFFF" />
          </TouchableOpacity>
        </Pressable>
      </Modal>

      <TermsModal
        visible={termsOpen}
        variant="sender"
        busy={termsBusy}
        onAccept={acceptBookingTerms}
        onClose={() => setTermsOpen(false)}
      />
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
    map: { ...StyleSheet.absoluteFill },

    topOverlay: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', zIndex: 20 },
    backCircleBtn: {
      width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: hair,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
      marginRight: 12,
    },

    banner: {
      position: 'absolute', left: 16, right: 16,
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
      zIndex: 25,
    },
    bannerText: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', fontSize: 12, flex: 1 },

    bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
    bottomSheetFinding: { bottom: 0 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 6 },

    sheetCard: {
      backgroundColor: c.card, width: '100%', paddingHorizontal: 16, paddingTop: 4,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
    },
    sheetCardCapped: { maxHeight: SHEET_MAX_H },
    dragSheet: {
      position: 'absolute', left: 0, right: 0,
      backgroundColor: c.card, paddingHorizontal: 16, paddingTop: 4,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
    },
    dragHandleHit: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },
    dragFooter: {
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
      backgroundColor: c.card, paddingHorizontal: 16, elevation: 14,
    },
    sheetScroll: { flexGrow: 0, flexShrink: 1 },
    sheetScrollContent: { paddingBottom: 8 },
    sheetFooter: { paddingTop: 10, borderTopWidth: 1, borderTopColor: c.divider },

    rvHeader: { marginTop: 4, marginBottom: 16, paddingHorizontal: 4 },
    rvTitle: { fontSize: 20, lineHeight: 28, fontFamily: 'Poppins_700Bold', color: c.textPrimary },

    preferredProviderBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: c.accentSoft, borderWidth: 1, borderColor: ORANGE,
      borderRadius: 16, padding: 14, marginBottom: 14,
    },
    preferredProviderIcon: {
      width: 38, height: 38, borderRadius: 19, backgroundColor: ORANGE,
      alignItems: 'center', justifyContent: 'center',
    },
    preferredProviderLabel: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: ORANGE, letterSpacing: 0.8 },
    preferredProviderName: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 1 },
    preferredProviderRoute: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary, marginTop: 2 },

    rvCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: hair,
      marginBottom: 14, overflow: 'hidden',
    },
    rvCardEmpty: { borderStyle: 'dashed', borderColor: ORANGE, backgroundColor: c.accentSoft },

    rvReceiverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    rvAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
    rvAvatarEmpty: { backgroundColor: c.card, borderWidth: 1.5, borderColor: ORANGE },
    rvAvatarText: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },
    rvReceiverName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    rvReceiverSub: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 2 },
    rvChangePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.background, borderWidth: 1, borderColor: hair },
    rvChangeText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: ORANGE },
    rvNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      paddingHorizontal: 16, paddingVertical: 10,
      borderTopWidth: 1, borderTopColor: c.border,
    },
    rvNoteText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', lineHeight: 15, color: c.textSecondary },

    rvFareRows: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
    rvFareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    rvFareLabel: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
    rvFareValue: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    rvCalcRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
    rvTotalRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 4, paddingBottom: 12,
    },
    rvTotalLabel: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    rvEscrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    rvEscrowText: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textMuted },
    rvTotalValue: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: ORANGE, letterSpacing: -0.5 },

    primaryButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.textPrimary, borderRadius: 14, paddingVertical: 16, gap: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 8, elevation: 4,
    },
    primaryButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
    primaryButtonText: { color: c.card, fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
    primaryButtonHint: { textAlign: 'center', fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textMuted, marginTop: 8 },

    // Finding Provider UI (styled like LiveTrackingScreen's "on the way to pickup" state)
    findingAvatarRadarWrap: {
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
      position: 'relative',
      zIndex: 2,
    },
    findingRadarLayer: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
      elevation: 1,
    },
    findingRadarRing: {
      position: 'absolute',
      width: 46,
      height: 46,
      borderRadius: 23,
      borderWidth: 2,
      borderColor: ORANGE,
      backgroundColor: 'transparent',
    },
    findingRadarCore: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: ORANGE,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
      shadowColor: ORANGE,
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 6,
      elevation: 10,
    },
    findingStatusHeadline: {
      fontSize: 14, lineHeight: 20, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary,
    },
    findingRecipientRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 2,
    },
    verifiedTagPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
      backgroundColor: c.successBg, borderWidth: 1, borderColor: c.success,
    },
    verifiedTagText: {
      fontSize: 11, fontFamily: 'Poppins_700Bold', color: c.success,
    },

    progressContainer: { width: '100%', height: 5, backgroundColor: c.divider, borderRadius: 3, marginBottom: 4, overflow: 'hidden' },
    progressBar: { height: '100%', backgroundColor: ORANGE, borderRadius: 3 },

    cancelTextButton: {
      width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 14, borderRadius: 14, backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
    },
    cancelTextButtonLabel: { color: c.error, fontFamily: 'Poppins_700Bold', fontSize: 15 },

    sheetCardMatched: {
      width: '100%', backgroundColor: c.card, paddingHorizontal: 16, paddingTop: 8,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
    },
    matchedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, marginBottom: 12, paddingHorizontal: 4 },
    matchedHeaderIcon: {
      width: 40, height: 40, borderRadius: 12, backgroundColor: c.successBg,
      justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.success,
    },
    matchedHeaderTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
    matchedHeaderSub: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 2 },
    matchedCorridorCard: {
      backgroundColor: c.background,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: hair,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 12,
    },
    matchedCorridorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    matchedCorridorDotPick: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: ORANGE,
    },
    matchedCorridorDotDrop: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.textPrimary,
    },
    matchedCorridorText: {
      flex: 1,
      fontSize: 12.5,
      fontFamily: 'Poppins_600SemiBold',
      color: c.textPrimary,
    },
    matchedCorridorArrow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingLeft: 1,
      marginVertical: 2,
    },
    matchedCorridorTag: {
      fontSize: 9,
      fontFamily: 'Poppins_800ExtraBold',
      color: ORANGE,
      letterSpacing: 0.7,
    },
    matchedInnerCard: {
      borderWidth: 1, borderColor: hair, borderRadius: 16, padding: 16,
      backgroundColor: c.card, marginBottom: 14,
    },
    matchedRow: { flexDirection: 'row', alignItems: 'center' },
    matchedLeftCol: { width: 70, alignItems: 'center', marginRight: 14, position: 'relative' },
    matchedAvatarCircle: {
      width: 54, height: 54, borderRadius: 27, backgroundColor: ORANGE,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 3, borderColor: c.card,
      shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
    },
    matchedVerifiedBadge: {
      position: 'absolute', bottom: 0, right: 4, width: 20, height: 20, borderRadius: 10,
      backgroundColor: c.success,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 2, borderColor: c.card,
    },
    matchedRightCol: { flex: 1 },
    matchedName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 4, flexShrink: 1 },
    carDetailBox: { gap: 3 },
    carDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    carText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },

    waitingPulseBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.accentSoft, borderWidth: 1, borderColor: ORANGE,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    },
    waitingPulseText: {
      flex: 1, fontSize: 11.5, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, lineHeight: 16,
    },
    multiProviderItem: {
      backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: hair,
      padding: 12,
    },
    multiProviderItemTop: {
      borderColor: ORANGE,
      borderWidth: 1.5,
    },
    multiAvatarWrap: { width: 58, alignItems: 'center', marginRight: 12 },
    multiAvatarCircle: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
      justifyContent: 'center', alignItems: 'center',
    },
    multiAvatarInitials: {
      fontSize: 15,
      fontFamily: 'Poppins_800ExtraBold',
      color: '#FFFFFF',
    },
    multiScoreBadge: {
      marginTop: -6, paddingHorizontal: 6, paddingVertical: 1,
      borderRadius: 8, backgroundColor: c.success, borderWidth: 1.5, borderColor: c.card,
    },
    multiScoreText: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
    multiTopNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    multiPlatePill: {
      backgroundColor: '#1F2937',
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 6,
    },
    multiPlateText: {
      color: '#FFFFFF',
      fontSize: 10.5,
      fontFamily: 'Poppins_700Bold',
      letterSpacing: 0.4,
    },
    matchedCancelBtn: {
      width: 52,
      borderRadius: 14,
      backgroundColor: c.errorBg,
      borderWidth: 1,
      borderColor: c.error,
      alignItems: 'center',
      justifyContent: 'center',
    },
    awaitingPill: {
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
      backgroundColor: c.accentSoft, borderWidth: 1, borderColor: ORANGE,
    },
    awaitingPillText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: ORANGE },

    departureBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginTop: 12, paddingHorizontal: 12, paddingVertical: 10,
      borderRadius: 12, backgroundColor: c.accentSoft,
      borderWidth: 1, borderColor: ORANGE,
    },
    departureIconBox: {
      width: 30, height: 30, borderRadius: 8,
      backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    },
    departureLabel: { fontSize: 9.5, fontFamily: 'Poppins_800ExtraBold', color: ORANGE, letterSpacing: 0.6 },
    departureValue: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 1 },

    matchedDivider: { height: 1, backgroundColor: c.border, marginVertical: 12 },
    matchedReceiverRow: { flexDirection: 'row', alignItems: 'center' },
    matchedReceiverLabel: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary, letterSpacing: 0.8, marginBottom: 2 },
    matchedReceiverName: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    matchedReceiverPhone: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1 },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totalLabel: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
    totalValue: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
    totalPaidBadge: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.success, marginTop: 2 },

    ratingSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    ratingStarsInline: { flexDirection: 'row', gap: 2 },
    ratingAvgText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    recentReviewsWrap: { marginTop: 10, gap: 8 },
    recentReviewItem: {
      backgroundColor: isDark ? '#2A1F0A' : '#FFFBEB',
      borderRadius: 12, padding: 10,
      borderWidth: 1, borderColor: c.warning,
    },
    recentReviewHead: { flexDirection: 'row', gap: 2, marginBottom: 4 },
    recentReviewComment: {
      fontSize: 12, fontFamily: 'Poppins_500Medium',
      color: isDark ? '#FCD34D' : '#78350F', lineHeight: 16,
    },

    confirmButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: c.textPrimary, borderRadius: 14, paddingVertical: 16, gap: 8,
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 8, elevation: 4,
    },
    confirmButtonText: { color: c.card, fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },

    otpSentBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.successBg, borderRadius: 12, padding: 10, marginTop: 10,
      borderWidth: 1, borderColor: c.success,
    },
    otpSentText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.success },

    sheetCardNoMatch: {
      width: '100%', backgroundColor: c.card, paddingHorizontal: 16, paddingTop: 8,
      borderTopLeftRadius: 24, borderTopRightRadius: 24,
      shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
      shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
    },
    noMatchIconCircle: {
      width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft,
      justifyContent: 'center', alignItems: 'center',
      marginBottom: 12, marginTop: 2, borderWidth: 1, borderColor: ORANGE,
    },
    noMatchTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 4, letterSpacing: -0.3, textAlign: 'center' },
    noMatchSubtitle: {
      fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center',
      lineHeight: 18, marginBottom: 18, paddingHorizontal: 10,
    },
    noMatchActions: { flexDirection: 'row', gap: 12, width: '100%' },
    noMatchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 14, gap: 6 },
    retryBtn: { backgroundColor: ORANGE, shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
    retryBtnText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 13, letterSpacing: 0.2 },
    modifyBtn: { backgroundColor: c.divider, borderWidth: 1, borderColor: c.border },
    modifyBtnText: { color: c.textSecondary, fontFamily: 'Poppins_700Bold', fontSize: 13, letterSpacing: 0.2 },

    // Embedded LiveTrackingScreen styles
    trackingSheet: {
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

    trackingCard: {
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