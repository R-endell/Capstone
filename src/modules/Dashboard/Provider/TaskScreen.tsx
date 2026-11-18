// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing,
  Dimensions, Image, Linking, Share, BackHandler, Pressable, Platform, AppState,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NavigationMap, { NavInfo } from '../../../components/map/NavigationMap';
import RoutePreviewMap from '../../../components/map/RoutePreviewMap';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { formatDateTime } from '../../../utils/dateUtils';
import {
  getProviderDeliveries,
  SHIPMENT_SIZE_SPECS,
} from '../../../services/matchingService';
import {
  getActiveRouteId,
  setActiveRouteId,
  subscribeActiveRoute,
  syncSelectedRouteToDb,
} from '../../../services/activeRouteStore';
import { isRouteExpired } from './Manage/ManageRoutesScreen';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { useProviderLocationBroadcast } from '../../../services/useProviderLocationBroadcast';
import { useNavigationSession } from '../../../services/navigationSessionStore';
import { clearLocationFix } from '../../../services/locationService';
import { notifyUser } from '../../../services/pushService';
import { requestDepositRefund } from '../../../services/depositRefundService';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SolarIcon } from '../../../components/ui/SolarIcon';

const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.png');
const EMPTY_BOX_ICON = require('../../../../assets/empty-box-icon.png');

const BLUE = '#3B82F6';
const PURPLE = '#8B5CF6';
const BRAND_ORANGE = '#F27024';
const ORANGE = '#FF751F';
const RED = '#EF4444';
const CARGO_PHOTO_BUCKET = 'cargo-photos';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NETWORK_TIMEOUT_MS = 12000;

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const { width: SCREEN_W } = Dimensions.get('window');
const frameSize = Math.min(SCREEN_W * 0.72, 280);

const GEOFENCE_RADIUS_M = __DEV__ ? 999999 : 150;

const withTimeout = <T,>(promise: PromiseLike<T>, ms = NETWORK_TIMEOUT_MS, label = 'Request timed out'): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}. Please check your connection and try again.`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const verifyProviderWithinGeofence = async (
  targetLat: number | null,
  targetLng: number | null,
  label: 'pickup' | 'drop-off'
): Promise<{ allowed: boolean; lat: number; lng: number; distanceM: number }> => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Location Required', 'Please enable GPS location permissions to verify arrival.');
    return { allowed: false, lat: 0, lng: 0, distanceM: 999999 };
  }

  let coords: { latitude: number; longitude: number } | null = null;
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
    if (last?.coords) coords = last.coords;
  } catch { /* ignore */ }

  if (!coords) {
    try {
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
      ]);
      if (pos) coords = pos.coords;
    } catch { /* ignore */ }
  }

  if (!coords) {
    Alert.alert('Location Unavailable', 'Could not get a GPS fix. Move near a window or enable location services.');
    return { allowed: false, lat: 0, lng: 0, distanceM: 999999 };
  }

  const { latitude, longitude } = coords;

  if (targetLat == null || targetLng == null) {
    return { allowed: true, lat: latitude, lng: longitude, distanceM: 0 };
  }

  const dist = getDistanceMeters(latitude, longitude, Number(targetLat), Number(targetLng));
  if (dist > GEOFENCE_RADIUS_M) {
    Alert.alert(
      'Too Far from Pin',
      `You are ${Math.round(dist)}m away from the ${label} pin. Please move within ${GEOFENCE_RADIUS_M}m to unlock this action.`
    );
    return { allowed: false, lat: latitude, lng: longitude, distanceM: dist };
  }
  return { allowed: true, lat: latitude, lng: longitude, distanceM: dist };
};

const extractFunctionError = async (error: any, fallback = 'Something went wrong.'): Promise<string> => {
  if (!error) return fallback;
  let detail = error.message || fallback;
  try {
    const ctx: any = error.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.json();
      detail = body?.error || body?.message || detail;
    } else if (ctx && typeof ctx.text === 'function') {
      const txt = await ctx.text();
      if (txt) detail = txt;
    }
  } catch { /* keep fallback */ }
  return detail;
};

const hydrateQr = async (deliveries: any[]) => {
  if (!deliveries || deliveries.length === 0) return deliveries;
  const ids = deliveries.map(d => d.delivery_id).filter(Boolean);
  if (ids.length === 0) return deliveries;

  const { data: qrRows } = await withTimeout(
    supabase.from('qr_verifications').select('*').in('delivery_id', ids),
    NETWORK_TIMEOUT_MS,
    'QR verification lookup timed out'
  );
  const byId: Record<number, any> = {};
  (qrRows || []).forEach((q: any) => { byId[q.delivery_id] = q; });

  return deliveries.map(d => ({
    ...d,
    qr_verifications: d.qr_verifications || byId[d.delivery_id] || null,
  }));
};

const money = (n: any) => `₱${Number(n || 0).toFixed(2)}`;
const trackingCode = (id: any) => `PNS-${String(id).padStart(4, '0')}`;
const serviceLabel = (t?: string | null) => (/door/i.test(String(t || '')) ? 'Door-to-Door' : 'Curb-side');

const PLUS_CODE = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;
const isCodeLike = (t: string) => {
  const x = (t ?? '').trim();
  if (!x) return true;
  if (/^unknown$/i.test(x)) return true;
  if (PLUS_CODE.test(x)) return true;
  return /^[A-Za-z0-9+\-_.]{6,}$/.test(x) && /\d/.test(x) && /[A-Za-z]/.test(x);
};
const readableParts = (a?: string | null): string[] =>
  (a ?? '').replace(PLUS_CODE, '').split(',').map(p => p.trim())
    .filter(p => p && !isCodeLike(p) && !/^\d{4,6}$/.test(p));

const describePlace = (l: any): { main: string; sub: string; road: string } => {
  const parts = readableParts(l?.street_address);
  const name = typeof l?.place_name === 'string' && !isCodeLike(l.place_name) ? l.place_name.trim() : '';
  const road = typeof l?.road === 'string' && !isCodeLike(l.road) ? l.road.trim() : '';
  const brgy = typeof l?.barangay === 'string' && !isCodeLike(l.barangay) ? l.barangay.trim() : '';

  const localities = [l?.city, l?.province, l?.barangay]
    .filter((v: any) => typeof v === 'string').map((v: string) => v.trim().toLowerCase());
  const placeParts = parts.filter(p => !localities.includes(p.toLowerCase()));

  const main = name || placeParts[0] || road || brgy || parts[0] || 'Selected location';
  const street = road || placeParts.find(p => p !== main) || '';
  const city = typeof l?.city === 'string' && !isCodeLike(l.city) ? l.city.trim() : '';
  const bottom = [street && street !== main ? street : '', brgy && brgy !== main ? brgy : '']
    .filter(Boolean).join(', ')
    || parts.slice(1, 3).join(', ')
    || (city && city !== main ? city : '');
  return { main, sub: parts.slice(1).join(', '), road: bottom };
};

const toPhotoUrl = (v: any): string | null => {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(file|content):/i.test(v)) return null;
  try {
    return supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(v.replace(/^\/+/, '')).data.publicUrl;
  } catch { return null; }
};

const buildCargoItems = (cargo: any) => {
  let itemsJson: any = cargo?.items_json;
  if (typeof itemsJson === 'string') {
    try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
  }
  if (Array.isArray(itemsJson) && itemsJson.length > 0) {
    const items = itemsJson.map((it: any) => ({
      description: it?.description || `${it?.size || 'Standard'} package`,
      size: it?.size ?? null,
      fragile: !!it?.fragile,
      photo: toPhotoUrl(it?.photo),
    }));
    const fallback = toPhotoUrl(cargo?.cargo_pic);
    if (fallback && !items.some((i: any) => i.photo)) items[0].photo = fallback;
    return items;
  }
  return [{
    description: cargo?.description || 'Package',
    size: null as string | null,
    fragile: !!cargo?.is_fragile,
    photo: toPhotoUrl(cargo?.cargo_pic),
  }];
};

const summarizeSizes = (items: any[], cargo: any): { full: string; short: string } => {
  const counts: Record<string, number> = { Small: 0, Medium: 0, Large: 0 };
  items.forEach(it => { if (it?.size && counts[it.size] != null) counts[it.size] += 1; });
  if (!counts.Small && !counts.Medium && !counts.Large) {
    counts.Small = Number(cargo?.small_box_qty) || 0;
    counts.Medium = Number(cargo?.medium_box_qty) || 0;
    counts.Large = Number(cargo?.large_box_qty) || 0;
  }
  const used = (['Small', 'Medium', 'Large'] as const).filter(k => counts[k] > 0);
  return {
    full: used.map(k => `${counts[k]} ${k}`).join(' · '),
    short: used.length > 1 ? used.map(k => `${counts[k]}${k[0]}`).join(' · ') : '',
  };
};

const buildTaskInfo = (d: any) => {
  const request = d?.delivery_requests || null;
  const cargo = Array.isArray(request?.cargo) ? request.cargo[0] : request?.cargo;
  const receiver = Array.isArray(request?.receiver) ? request.receiver[0] : request?.receiver;
  const pickup = describePlace(request?.pickup_location);
  const dropoff = describePlace(request?.dropoff_location);
  const items = buildCargoItems(cargo);
  const qtyTotal = (Number(cargo?.small_box_qty) || 0) + (Number(cargo?.medium_box_qty) || 0) + (Number(cargo?.large_box_qty) || 0);
  const dims = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const sender = d?.sender || null;

  return {
    request,
    cargo,
    receiver,
    pickup: { ...pickup, lat: request?.pickup_location?.latitude ?? null, lng: request?.pickup_location?.longitude ?? null },
    dropoff: { ...dropoff, lat: request?.dropoff_location?.latitude ?? null, lng: request?.dropoff_location?.longitude ?? null },
    pickupNote: (request?.pickup_note as string | null) || null,
    dropoffNote: (request?.dropoff_note as string | null) || null,
    items,
    totalItems: items.length > 1 ? items.length : (qtyTotal || items.length),
    sizeSummary: summarizeSizes(items, cargo),
    weightKg: cargo?.total_weight_kg != null ? Number(cargo.total_weight_kg) : null,
    fragile: items.some((i: any) => i.fragile) || !!cargo?.is_fragile,
    dims: dims.every(v => Number(v) > 0) ? `${dims[0]} × ${dims[1]} × ${dims[2]} cm` : null,
    receiverName: receiver?.receiver_name || null,
    receiverPhone: request?.receiver_phone || receiver?.receiver_phone || null,
    senderId: request?.sender_id || sender?.user_id || null,
    senderName: sender ? [sender.first_name, sender.last_name].filter(Boolean).join(' ') || null : null,
    senderPhone: sender?.phone_number || null,
    returnDeposit: Number(request?.return_deposit) || 0,
    totalPaid: Number(request?.estimated_cost) || 0,
    isReturned: String(request?.delivery_status || '') === 'Returned',
    baseFare: (() => {
      const dep = Number(request?.return_deposit) || 0;
      const est = Number(request?.estimated_cost) || 0;
      return Number(request?.base_fare) || Math.max(0, est - dep);
    })(),
    platformFee: (() => {
      const dep = Number(request?.return_deposit) || 0;
      const est = Number(request?.estimated_cost) || 0;
      const base = Number(request?.base_fare) || Math.max(0, est - dep);
      return Math.round(base * 0.15 * 100) / 100;
    })(),
    earnings: (() => {
      const status = String(request?.delivery_status || '');
      const base = Number(request?.base_fare) || 0;
      const deposit = Number(request?.return_deposit) || 0;
      const est = Number(request?.estimated_cost) || 0;
      const net = Math.round(base * 0.85 * 100) / 100;
      if (status === 'Returned') return (net + deposit) || est;
      if (status === 'Completed') return net || est;
      return est;
    })(),
  };
};

const enrichDeliveries = async (list: any[]) => {
  if (!list || list.length === 0) return list;
  const senderIds = Array.from(new Set(list.map(d => d.delivery_requests?.sender_id).filter(Boolean)));
  const deliveryIds = list.map(d => d.delivery_id).filter(Boolean);
  const senders: Record<number, any> = {};
  const escrows: Record<number, any> = {};
  try {
    if (senderIds.length) {
      const { data } = await withTimeout(
        supabase.from('users').select('user_id, first_name, last_name, phone_number').in('user_id', senderIds as number[]),
        NETWORK_TIMEOUT_MS
      );
      (data || []).forEach((u: any) => { senders[u.user_id] = u; });
    }
  } catch { }
  try {
    if (deliveryIds.length) {
      const { data } = await withTimeout(
        supabase.from('escrow_payments').select('delivery_id, amount, escrow_status, bc_escrow_tx_hash').in('delivery_id', deliveryIds),
        NETWORK_TIMEOUT_MS
      );
      (data || []).forEach((e: any) => { escrows[e.delivery_id] = e; });
    }
  } catch { }
  return list.map(d => {
    const rawEscrow = d.escrow || escrows[d.delivery_id] || null;
    const provider = d.delivery_requests?.payment_provider || null;
    return {
      ...d,
      sender: d.sender || senders[d.delivery_requests?.sender_id] || null,
      escrow: rawEscrow ? { ...rawEscrow, payment_method: provider } : (provider ? { payment_method: provider } : null),
    };
  });
};

const isCancelledDelivery = (d: any): boolean => {
  if (!d) return false;
  const req = d.delivery_requests || {};
  const status = String(req.delivery_status || '').toLowerCase();

  if (status === 'completed' || status === 'returned') return false;
  if (status === 'cancelled' || status === 'canceled') return true;

  const hasDeliveryRecord = !!d.delivery_id || !!d.completed_at;
  if (hasDeliveryRecord) return false;

  const escrowStatus = String(d.escrow?.escrow_status || '').toLowerCase();
  const paymentStatus = String(req.payment_status || '').toLowerCase();
  const refundStatus = String(req.refund_status || '').toLowerCase();

  return (
    escrowStatus === 'refunded' ||
    escrowStatus === 'cancelled' ||
    paymentStatus === 'refunded' ||
    refundStatus === 'succeeded' ||
    refundStatus === 'completed' ||
    refundStatus === 'refunded'
  );
};

/* ==================================================================== */
/* Payment method badge                                                 */
/* ==================================================================== */
const PaymentMethodBadge = ({ provider, size = 20 }: { provider?: string | null; size?: number }) => {
  if (!provider) return null;
  const p = String(provider).toLowerCase();
  const isGcash = p.includes('gcash');
  const isMaya  = p.includes('maya');
  if (!isGcash && !isMaya) return null;

  const logo = isGcash ? GCASH_LOGO : MAYA_LOGO;
  const label = isGcash ? 'GCash' : 'Maya';
  const tint = isGcash ? '#0284C7' : '#059669';

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: '#FFFFFF',
      paddingHorizontal: 8, paddingVertical: 4,
      borderRadius: 10, borderWidth: 1, borderColor: `${tint}22`,
    }}>
      <View style={{
        width: size + 8, height: size + 8, borderRadius: 6, overflow: 'hidden',
        justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF',
      }}>
        <Image source={logo} style={{ width: size, height: size }} resizeMode="contain" />
      </View>
      <Text style={{ fontSize: 12, fontFamily: 'Poppins_700Bold', color: tint }}>{label}</Text>
    </View>
  );
};

const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

type TabType = 'active' | 'scheduled' | 'completed' | 'cancelled' | 'all';

export default function TaskScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const hasLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<any[]>([]);
  const [cancelledDeliveries, setCancelledDeliveries] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);

  const [routes, setRoutes] = useState<any[]>([]);
  const [activeRoute, setActiveRoute] = useState<any | null>(null);
  const [filterByActiveRoute, setFilterByActiveRoute] = useState(true);
  const [routePickerVisible, setRoutePickerVisible] = useState(false);
  const routesRef = useRef<any[]>([]);
  const activeRouteRef = useRef<any | null>(null);
  const providerIdRef = useRef<number | null>(null);

  useEffect(() => { routesRef.current = routes; }, [routes]);
  useEffect(() => { activeRouteRef.current = activeRoute; }, [activeRoute]);
  useEffect(() => { providerIdRef.current = providerId; }, [providerId]);

  const [pingingId, setPingingId] = useState<number | null>(null);

  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [scanned, setScanned] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [copied, setCopied] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const copyHashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHash = async (key: string, value?: string | null) => {
    if (!value) return;
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(value);
        if (isMountedRef.current) setCopiedHash(key);
        if (copyHashTimerRef.current) clearTimeout(copyHashTimerRef.current);
        copyHashTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setCopiedHash(null);
        }, 1800);
      } else {
        await Share.share({ message: value });
      }
    } catch { /* ignore */ }
  };
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyHashTimerRef.current) clearTimeout(copyHashTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [navInfo, setNavInfo] = useState<NavInfo>({ distanceM: null, durationS: null });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [pkgInfo, setPkgInfo] = useState<any | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [openingChat, setOpeningChat] = useState(false);

  const [deliveryOTPModalVisible, setDeliveryOTPModalVisible] = useState(false);
  const [deliveryOTPTarget, setDeliveryOTPTarget] = useState<any>(null);
  const [deliveryOTPInput, setDeliveryOTPInput] = useState('');
  const [deliveryOTPVerifying, setDeliveryOTPVerifying] = useState(false);

  const podCameraRef = useRef<any>(null);
  const [podCameraOpen, setPodCameraOpen] = useState(false);
  const [podPhotoUri, setPodPhotoUri] = useState<string | null>(null);
  const [podTakingPhoto, setPodTakingPhoto] = useState(false);

  const pickupCameraRef = useRef<any>(null);
  const [pickupPending, setPickupPending] = useState<{ deliveryId: number; requestId: number } | null>(null);
  const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupTakenAt, setPickupTakenAt] = useState<string>('');
  const [pickupTakingPhoto, setPickupTakingPhoto] = useState(false);
  const [pickupSubmitting, setPickupSubmitting] = useState(false);
  const [pickupCameraReady, setPickupCameraReady] = useState(false);

  const [graceModalVisible, setGraceModalVisible] = useState(false);
  const [graceDelivery, setGraceDelivery] = useState<any>(null);
  const [graceRemainingSec, setGraceRemainingSec] = useState<number>(600);
  const [contactLogs, setContactLogs] = useState<{ call: boolean; sms: boolean; chat: boolean }>({
    call: false,
    sms: false,
    chat: false,
  });
  const [failureCameraOpen, setFailureCameraOpen] = useState(false);
  const [failurePhotoUri, setFailurePhotoUri] = useState<string | null>(null);
  const [failureCoords, setFailureCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [failureTimestamp, setFailureTimestamp] = useState<string>('');
  const [submittingFailure, setSubmittingFailure] = useState(false);
  const failureCameraRef = useRef<any>(null);

  useEffect(() => {
    if (!graceModalVisible || !graceDelivery?.dropoff_arrived_at) return;
    const updateTimer = () => {
      const startedMs = new Date(graceDelivery.dropoff_arrived_at).getTime();
      if (Number.isNaN(startedMs)) {
        setGraceRemainingSec(600);
        return;
      }
      const elapsedSec = Math.floor((Date.now() - startedMs) / 1000);
      const remaining = Math.min(600, Math.max(0, 600 - elapsedSec));
      setGraceRemainingSec(remaining);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [graceModalVisible, graceDelivery?.dropoff_arrived_at]);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0, 300), animate(contentAnim, 0, 260)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    if (selectedId == null) return;
    detailAnim.setValue(0);
    Animated.timing(detailAnim, { toValue: 1, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [selectedId, detailAnim]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (podCameraOpen) { setPodCameraOpen(false); return true; }
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (mapModalVisible) { setMapModalVisible(false); return true; }
      if (routePickerVisible) { setRoutePickerVisible(false); return true; }
      if (selectedId != null) { setSelectedId(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [podCameraOpen, photoPreview, mapModalVisible, routePickerVisible, selectedId]);

  useEffect(() => {
    if (!verifyModalVisible || pickupPending) return;
    scanLineAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [verifyModalVisible, pickupPending, scanLineAnim]);

  const getProviderData = async () => {
    try {
      const { data: { user } } = await withTimeout(supabase.auth.getUser(), NETWORK_TIMEOUT_MS, 'Auth check timed out');
      if (!user) return null;
      const { data: uData } = await withTimeout(
        supabase.from('users').select('*').eq('auth_id', user.id).single(),
        NETWORK_TIMEOUT_MS,
        'User profile load timed out'
      );
      if (!isMountedRef.current || !uData) return uData?.user_id ?? null;
      setUserData(uData);
      setProviderId(uData.user_id);
      providerIdRef.current = uData.user_id;
      return uData.user_id;
    } catch { return null; }
  };

  const fetchProviderRoutes = useCallback(async (pid: number): Promise<any | null> => {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('provider_routes')
          .select(`
            *,
            start_location:locations!provider_routes_start_location_id_fkey(*),
            end_location:locations!provider_routes_end_location_id_fkey(*),
            vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
          `)
          .eq('provider_id', pid)
          .order('created_at', { ascending: false }),
        NETWORK_TIMEOUT_MS,
        'Routes load timed out'
      );

      if (error) throw error;

      const validRoutes = (data || [])
        .filter((r: any) => r.is_deleted !== true)
        .filter((r: any) => !isRouteExpired(r));

      if (!isMountedRef.current) return null;
      setRoutes(validRoutes);
      routesRef.current = validRoutes;

      const savedId = await getActiveRouteId();
      const restored = savedId ? validRoutes.find((r: any) => r.route_id === savedId) : null;

      if (restored) {
        if (isMountedRef.current) setActiveRoute(restored);
        activeRouteRef.current = restored;
        if (restored.is_selected !== true) void syncSelectedRouteToDb(restored.route_id, true);
        return restored;
      } else if (validRoutes.length > 0) {
        const first = validRoutes[0];
        if (isMountedRef.current) setActiveRoute(first);
        activeRouteRef.current = first;
        await setActiveRouteId(first.route_id);
        return first;
      } else {
        if (isMountedRef.current) setActiveRoute(null);
        activeRouteRef.current = null;
        await setActiveRouteId(null);
        return null;
      }
    } catch (e) {
      console.warn('[Task] fetchProviderRoutes error:', e);
      return activeRouteRef.current;
    }
  }, []);

  const fetchDeliveries = useCallback(async (pid: number) => {
    try {
      const deliveries = await withTimeout(
        getProviderDeliveries(pid),
        NETWORK_TIMEOUT_MS,
        'Deliveries load timed out'
      );

      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) =>
        a.findIndex(t => (t.request_id === v.request_id)) === i,
      );

      const hydrated = await enrichDeliveries(await hydrateQr(uniqueDeliveries));

      const cancelled = hydrated.filter(isCancelledDelivery);
      const completed = hydrated.filter(d => !isCancelledDelivery(d) && !!d.completed_at);
      const acceptedActive = hydrated.filter(d => !isCancelledDelivery(d) && !d.completed_at);

      if (!isMountedRef.current) return;
      setActiveDeliveries(acceptedActive);
      setCompletedDeliveries(completed);
      setCancelledDeliveries(cancelled);
    } catch (error) {
      console.error('Error fetching deliveries:', error);
    }
  }, []);

  useEffect(() => {
    return subscribeActiveRoute((newRouteId) => {
      if (!newRouteId) {
        if (isMountedRef.current) setActiveRoute(null);
        activeRouteRef.current = null;
        return;
      }
      if (activeRouteRef.current?.route_id === newRouteId) return;
      const found = routesRef.current.find((r: any) => r.route_id === newRouteId);
      if (found) {
        if (isMountedRef.current) setActiveRoute(found);
        activeRouteRef.current = found;
        if (providerIdRef.current) {
          void fetchDeliveries(providerIdRef.current);
        }
      } else if (providerIdRef.current) {
        void fetchProviderRoutes(providerIdRef.current).then(() => {
          if (providerIdRef.current) void fetchDeliveries(providerIdRef.current);
        });
      }
    });
  }, [fetchDeliveries, fetchProviderRoutes]);

  const handleSelectRoute = async (routeObj: any) => {
    setActiveRoute(routeObj);
    activeRouteRef.current = routeObj;
    setFilterByActiveRoute(true);
    setRoutePickerVisible(false);
    await setActiveRouteId(routeObj.route_id);
    if (providerId) {
      await fetchDeliveries(providerId);
    }
  };

  const handlePingSender = (delivery: any) => {
    Alert.alert(
      'On My Way to Pickup',
      'Select your estimated arrival time at the pickup point:',
      [
        { text: '5 mins', onPress: () => sendOnMyWayNotification(delivery, 5) },
        { text: '10 mins', onPress: () => sendOnMyWayNotification(delivery, 10) },
        { text: '15 mins', onPress: () => sendOnMyWayNotification(delivery, 15) },
        { text: '20+ mins', onPress: () => sendOnMyWayNotification(delivery, 25) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const sendOnMyWayNotification = async (delivery: any, etaMins: number) => {
    const senderId = (delivery.delivery_requests as any)?.sender_id
      ?? (delivery.delivery_requests as any)?.sender?.user_id;

    if (!senderId) {
      Alert.alert('Error', 'Could not find sender information for this delivery.');
      return;
    }

    setPingingId(delivery.delivery_id);
    try {
      const nowIso = new Date().toISOString();
      await withTimeout(
        supabase
          .from('deliveries')
          .update({ provider_on_way_at: nowIso, provider_eta_mins: etaMins })
          .eq('delivery_id', delivery.delivery_id),
        NETWORK_TIMEOUT_MS
      );

      const code = trackingCode((delivery.delivery_requests as any)?.request_id ?? delivery.delivery_id);
      await notifyUser(
        senderId,
        `Courier is ~${etaMins} mins away! 🚚`,
        `Your courier for #${code} is heading to pickup. Have you notified the receiver? Tap to call or message them now.`,
        { deliveryId: delivery.delivery_id, etaMins },
      );

      Alert.alert('Sender Pinged', `Sender has been notified (ETA: ~${etaMins} mins) and prompted to contact the receiver.`);
      if (providerId) await fetchDeliveries(providerId);
    } catch (error: any) {
      console.error('Failed to ping sender:', error);
      Alert.alert('Error', error?.message || 'Could not send the notification. Please try again.');
    } finally {
      if (isMountedRef.current) setPingingId(null);
    }
  };

  const openVerifyModal = async (delivery: any) => {
    const info = buildTaskInfo(delivery);
    const geo = await verifyProviderWithinGeofence(info.pickup.lat, info.pickup.lng, 'pickup');
    if (!geo.allowed) return;

    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res?.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to scan QR codes.');
        return;
      }
    }
    setVerifyTarget(delivery);
    setScanned(false);
    setPinInput('');
    setPickupCameraReady(false);
    setVerifyModalVisible(true);
  };

  const closeVerifyModal = () => {
    setVerifyModalVisible(false);
    setVerifyTarget(null);
    setScanned(false);
    setPinInput('');
    setPickupPending(null);
    setPickupPhotoUri(null);
    setPickupCoords(null);
    setPickupTakenAt('');
    setPickupTakingPhoto(false);
    setPickupSubmitting(false);
    setPickupCameraReady(false);
  };

  useEffect(() => {
    if (!verifyModalVisible || !pickupPending || pickupCameraReady) return;
    const t = setTimeout(() => setPickupCameraReady(true), 3000);
    return () => clearTimeout(t);
  }, [verifyModalVisible, pickupPending, pickupCameraReady]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setVerifyModalVisible(false);
        setVerifyTarget(null);
        setScanned(false);
        setPinInput('');
        setPickupPending(null);
        setPickupPhotoUri(null);
        setPickupCoords(null);
        setPickupTakenAt('');
        setPickupTakingPhoto(false);
        setPickupSubmitting(false);
        setPickupCameraReady(false);
        setPodCameraOpen(false);
        setFailureCameraOpen(false);
      };
    }, [])
  );

  const markPickupVerified = async (deliveryId: number, requestId: number) => {
    if (!requestId) {
      Alert.alert('Error', 'Request ID is missing. Cannot update delivery status.');
      return;
    }

    try {
      const isReturning = verifyTarget?.delivery_requests?.delivery_status === 'Returning';

      if (isReturning) {
        const now = new Date().toISOString();
        const { error: retQrErr } = await withTimeout(
          supabase
            .from('qr_verifications')
            .update({ return_verified: true, return_verified_at: now })
            .eq('delivery_id', deliveryId),
          NETWORK_TIMEOUT_MS
        );
        if (retQrErr) throw retQrErr;

        const { error: retDelErr } = await withTimeout(
          supabase
            .from('deliveries')
            .update({ returned_at: now, completed_at: now })
            .eq('delivery_id', deliveryId),
          NETWORK_TIMEOUT_MS
        );
        if (retDelErr) throw retDelErr;

        const { error: settleErr } = await withTimeout(
          supabase.rpc('settle_delivery_escrow', {
            p_delivery_id: deliveryId,
            p_outcome: 'returned_to_sender',
          }),
          NETWORK_TIMEOUT_MS
        );
        if (settleErr) throw settleErr;

        const senderId = (verifyTarget?.delivery_requests as any)?.sender_id;
        if (senderId) {
          await notifyUser(
            senderId,
            'Package Returned Safely 📦',
            `Your package (#PNS-${String(requestId).padStart(4, '0')}) has been returned to you.`,
            { deliveryId }
          );
        }

        Alert.alert('✅ Return Complete', 'Package returned to Sender. Full escrow (Base Fare + 50% Return Deposit) has been released to your wallet!');
        closeVerifyModal();
        if (providerId) await fetchDeliveries(providerId);
        return;
      }

      const { error: qrErr } = await withTimeout(
        supabase
          .from('qr_verifications')
          .update({ pickup_verified: true })
          .eq('delivery_id', deliveryId),
        NETWORK_TIMEOUT_MS
      );
      if (qrErr) throw qrErr;

      const { error: reqErr } = await withTimeout(
        supabase
          .from('delivery_requests')
          .update({ delivery_status: 'In Transit' })
          .eq('request_id', requestId),
        NETWORK_TIMEOUT_MS
      );
      if (reqErr) throw reqErr;

      const info = buildTaskInfo(verifyTarget);
      const courierName = userData ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim() : 'Your Courier';
      const plateNumber = verifyTarget?.vehicles?.plate_number || 'Assigned Vehicle';
      const etaText = verifyTarget?.estimated_eta ? formatDateTime(verifyTarget.estimated_eta) : 'Soon';

      const smsMsg = info.receiverPhone
        ? `Hi ${info.receiverName || 'Receiver'}, your package from ${info.senderName || 'Sender'} is on the way! Courier: ${courierName} (${plateNumber}). ETA: ${etaText}. Please be ready to receive it. Track here: https://packnship.streamlit.app/`
        : '';

      if (info.senderId) {
        try {
          await notifyUser(
            info.senderId,
            'Your courier is on the way! 🚚',
            `Package picked up. Have you notified ${info.receiverName || 'the receiver'}? Tap to call/message them.`,
            { deliveryId: verifyTarget?.delivery_id }
          );
        } catch (err) {
          console.warn('[Task] notify sender pickup failed', err);
        }
      }

      const alertButtons: any[] = [{ text: 'Close', style: 'cancel' }];
      if (info.receiverPhone) {
        alertButtons.push({
          text: 'Send SMS to Receiver',
          onPress: () => {
            const url = Platform.select({
              ios: `sms:${info.receiverPhone}&body=${encodeURIComponent(smsMsg)}`,
              android: `sms:${info.receiverPhone}?body=${encodeURIComponent(smsMsg)}`,
            });
            if (url) {
              Linking.openURL(url).catch(() => {
                Alert.alert('Cannot Open SMS', 'Your device cannot open the SMS app. Please notify the receiver manually.');
              });
            }
          },
        });
      }

      Alert.alert(
        '✅ Item Collected',
        info.receiverPhone
          ? `Pickup verified. Tap below to notify ${info.receiverName || 'the receiver'} via SMS from your phone.`
          : 'Pickup verified. (No receiver phone number on file.)',
        alertButtons
      );
      closeVerifyModal();
      if (providerId) await fetchDeliveries(providerId);
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify pickup.');
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned || !verifyTarget) return;
    setScanned(true);
    try {
      const qrData = data.trim();
      const { data: row, error } = await withTimeout(
        supabase
          .from('qr_verifications').select('*')
          .eq('pickup_qr', qrData).eq('delivery_id', verifyTarget.delivery_id).single(),
        NETWORK_TIMEOUT_MS
      );

      if (error || !row) {
        Alert.alert('Invalid QR', 'This QR does not match the selected delivery.', [
          { text: 'Try Again', onPress: () => setScanned(false) },
        ]);
        return;
      }
      const isReturning = verifyTarget?.delivery_requests?.delivery_status === 'Returning';
      if (row.pickup_verified && !isReturning) {
        Alert.alert('Already Verified', 'This pickup has already been verified.', [
          { text: 'OK', onPress: () => closeVerifyModal() },
        ]);
        return;
      }
      const reqId = verifyTarget.request_id ?? verifyTarget.delivery_requests?.request_id;
      if (isReturning) {
        await markPickupVerified(row.delivery_id, reqId);
      } else {
        setPickupPhotoUri(null);
        setPickupPending({ deliveryId: row.delivery_id, requestId: reqId });
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'QR scan failed.', [
        { text: 'Try Again', onPress: () => setScanned(false) },
      ]);
    }
  };

  const handlePinVerify = async () => {
    if (!verifyTarget || pinInput.trim().length !== 4) return;
    setPinVerifying(true);
    try {
      const { data: row, error } = await withTimeout(
        supabase
          .from('qr_verifications').select('*')
          .eq('delivery_id', verifyTarget.delivery_id).single(),
        NETWORK_TIMEOUT_MS
      );

      if (error || !row) throw new Error('QR record not found for this delivery.');
      const isReturning = verifyTarget?.delivery_requests?.delivery_status === 'Returning';
      if (row.pickup_verified && !isReturning) {
        Alert.alert('Already Verified', 'Pickup already verified.');
        return;
      }
      if (String(row.pickup_pin) !== String(pinInput).trim()) {
        Alert.alert('Wrong PIN', 'Please ask the sender for the correct 4-digit PIN.');
        return;
      }
      const reqId = verifyTarget.request_id ?? verifyTarget.delivery_requests?.request_id;
      if (isReturning) {
        await markPickupVerified(row.delivery_id, reqId);
      } else {
        setPickupPhotoUri(null);
        setPickupPending({ deliveryId: row.delivery_id, requestId: reqId });
      }
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify PIN.');
    } finally {
      if (isMountedRef.current) setPinVerifying(false);
    }
  };

  const getPhotoCoords = async (): Promise<{ lat: number; lng: number } | null> => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return null;
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3500)),
      ]);
      if (pos) return { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120000 });
      if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
    } catch { /* ignore */ }
    return null;
  };

  const capturePickupPhoto = async () => {
    if (pickupTakingPhoto) return;
    if (!pickupCameraRef.current || !pickupCameraReady) {
      Alert.alert('Camera not ready', 'Please wait a moment for the camera to start, then try again.');
      return;
    }
    setPickupTakingPhoto(true);
    try {
      const coordsPromise = getPhotoCoords();

      let photo: any = null;
      try {
        photo = await pickupCameraRef.current.takePictureAsync({ quality: 0.7 });
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 400));
        photo = await pickupCameraRef.current?.takePictureAsync({ quality: 0.7, skipProcessing: true });
      }
      if (!photo?.uri) throw new Error('The camera did not return an image. Please try again.');

      const coords = await coordsPromise;
      if (!isMountedRef.current) return;
      setPickupCoords(coords);
      setPickupTakenAt(new Date().toISOString());
      setPickupPhotoUri(photo.uri);
    } catch (e: any) {
      Alert.alert('Camera Error', e?.message || 'Failed to capture photo.');
    } finally {
      if (isMountedRef.current) setPickupTakingPhoto(false);
    }
  };

  const uploadPickupPhoto = async (uri: string, deliveryId: number): Promise<string> => {
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `pickup/delivery_${deliveryId}_${Date.now()}.${ext}`;
    const res = await withTimeout(fetch(uri), NETWORK_TIMEOUT_MS, 'Photo read timed out');
    const arrayBuffer = await res.arrayBuffer();

    const { error: upErr } = await withTimeout(
      supabase.storage
        .from(CARGO_PHOTO_BUCKET)
        .upload(filePath, arrayBuffer, {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          upsert: true,
        }),
      NETWORK_TIMEOUT_MS,
      'Photo upload timed out'
    );
    if (upErr) throw upErr;

    const { data } = supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  };

  const confirmPickupWithPhoto = async () => {
    if (!pickupPending || !pickupPhotoUri || pickupSubmitting) return;
    setPickupSubmitting(true);
    try {
      const url = await uploadPickupPhoto(pickupPhotoUri, pickupPending.deliveryId);
      const { error: photoErr } = await withTimeout(
        supabase
          .from('deliveries')
          .update({
            pickup_photo_url: url,
            pickup_photo_lat: pickupCoords?.lat ?? null,
            pickup_photo_lng: pickupCoords?.lng ?? null,
            pickup_photo_taken_at: pickupTakenAt || new Date().toISOString(),
          })
          .eq('delivery_id', pickupPending.deliveryId),
        NETWORK_TIMEOUT_MS
      );
      if (photoErr) throw photoErr;

      await markPickupVerified(pickupPending.deliveryId, pickupPending.requestId);
    } catch (e: any) {
      Alert.alert('Could not save pickup photo', e?.message || 'Please try again.');
    } finally {
      if (isMountedRef.current) setPickupSubmitting(false);
    }
  };

  const openDeliveryOTPModal = async (delivery: any) => {
    const info = buildTaskInfo(delivery);
    const geo = await verifyProviderWithinGeofence(info.dropoff.lat, info.dropoff.lng, 'drop-off');
    if (!geo.allowed) return;

    setDeliveryOTPTarget(delivery);
    setDeliveryOTPInput('');
    setPodPhotoUri(null);
    setPodCameraOpen(false);
    setDeliveryOTPModalVisible(true);
  };

  const closeDeliveryOTPModal = () => {
    setDeliveryOTPModalVisible(false);
    setDeliveryOTPTarget(null);
    setDeliveryOTPInput('');
    setPodPhotoUri(null);
    setPodCameraOpen(false);
    setDeliveryOTPVerifying(false);
  };

  const openPodCamera = async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res?.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to take a Proof of Delivery photo.');
        return;
      }
    }
    setPodCameraOpen(true);
  };

  const capturePodPhoto = async () => {
    if (!podCameraRef.current || podTakingPhoto) return;
    setPodTakingPhoto(true);
    try {
      const photo = await podCameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo?.uri && isMountedRef.current) {
        setPodPhotoUri(photo.uri);
        setPodCameraOpen(false);
      }
    } catch (e: any) {
      Alert.alert('Camera Error', e?.message || 'Failed to capture photo.');
    } finally {
      if (isMountedRef.current) setPodTakingPhoto(false);
    }
  };

  const uploadPodPhoto = async (uri: string, deliveryId: number): Promise<string> => {
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `pod/delivery_${deliveryId}_${Date.now()}.${ext}`;
    const res = await withTimeout(fetch(uri), NETWORK_TIMEOUT_MS, 'Photo read timed out');
    const arrayBuffer = await res.arrayBuffer();

    const { error: upErr } = await withTimeout(
      supabase.storage
        .from(CARGO_PHOTO_BUCKET)
        .upload(filePath, arrayBuffer, {
          contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
          upsert: true,
        }),
      NETWORK_TIMEOUT_MS,
      'Proof photo upload timed out'
    );

    if (upErr) throw upErr;

    const { data } = supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
  };

  const tryLocalSystemOtpFallback = async (deliveryId: number, otp: string): Promise<{ handled: boolean; success: boolean }> => {
    try {
      const { data: row, error } = await withTimeout(
        supabase.from('delivery_confirmations').select('*').eq('delivery_id', deliveryId).maybeSingle(),
        NETWORK_TIMEOUT_MS
      );

      if (error || !row) return { handled: false, success: false };
      if (row.contiguity_otp_id) return { handled: false, success: false };
      if (Number(row.attempts) >= 5) {
        Alert.alert('Too Many Attempts', 'Please request a new OTP.');
        return { handled: true, success: false };
      }
      if (String(row.system_otp || '').trim() !== String(otp).trim()) {
        await supabase.from('delivery_confirmations').update({ attempts: Number(row.attempts || 0) + 1 }).eq('delivery_id', deliveryId);
        Alert.alert('Invalid OTP', 'The code you entered is incorrect.');
        return { handled: true, success: false };
      }
      await supabase.from('delivery_confirmations').update({ otp_verified: true, otp_verified_at: new Date().toISOString() }).eq('delivery_id', deliveryId);
      return { handled: true, success: true };
    } catch { return { handled: false, success: false }; }
  };

  const completeDelivery = async () => {
    if (!deliveryOTPTarget || deliveryOTPInput.trim().length !== 6) return;
    if (!podPhotoUri) {
      Alert.alert('Photo Required', 'Please take a Proof of Delivery photo before completing.');
      return;
    }

    const deliveryId = deliveryOTPTarget.delivery_id;
    const requestId = deliveryOTPTarget.delivery_requests?.request_id;
    const otp = deliveryOTPInput.trim();

    setDeliveryOTPVerifying(true);
    try {
      let verified = false;
      const { data: verifyResult, error: verifyError } = await withTimeout(
        supabase.functions.invoke('contiguity-otp', { body: { action: 'verify', delivery_id: deliveryId, otp } }),
        NETWORK_TIMEOUT_MS,
        'OTP verification timed out'
      );

      if (!verifyError && verifyResult?.success) verified = true;

      if (!verified) {
        const local = await tryLocalSystemOtpFallback(deliveryId, otp);
        if (local.success) verified = true;
        else if (local.handled) return;
        else {
          const detail = await extractFunctionError(verifyError, verifyResult?.message || 'Could not verify OTP.');
          Alert.alert('Verification Failed', detail);
          return;
        }
      }

      if (!verified) {
        Alert.alert('Verification Failed', 'The code could not be verified. Please try again.');
        return;
      }

      const podPublicUrl = await uploadPodPhoto(podPhotoUri, deliveryId);
      const now = new Date().toISOString();

      await withTimeout(
        supabase.from('qr_verifications').update({ dropoff_verified: true }).eq('delivery_id', deliveryId),
        NETWORK_TIMEOUT_MS
      );

      const { error: delError } = await withTimeout(
        supabase
          .from('deliveries')
          .update({
            completed_at: now,
            pod_photo_url: podPublicUrl,
            pod_seen_by_sender: false,
          })
          .eq('delivery_id', deliveryId),
        NETWORK_TIMEOUT_MS
      );
      if (delError) throw delError;

      const { error: settleErr } = await withTimeout(
        supabase.rpc('settle_delivery_escrow', {
          p_delivery_id: deliveryId,
          p_outcome: 'completed_normal',
        }),
        NETWORK_TIMEOUT_MS
      );
      if (settleErr) throw settleErr;

      // Option A (Return to Sender): give the sender's return deposit back now that the delivery succeeded.
      // Runs in the background so the provider is never kept waiting; ActivityScreen retries if it fails.
      const returnDep = Number(deliveryOTPTarget?.delivery_requests?.return_deposit || 0);
      if (returnDep > 0 && requestId) {
        void requestDepositRefund(requestId, returnDep).then((r) => {
          if (!r.ok && r.status !== 'skipped') {
            console.warn('[completeDelivery] deposit refund not completed:', r.status, r.message);
          }
        });
      }

      Alert.alert('✅ Delivery Complete!', 'Proof of delivery uploaded and payment has been released to your wallet.', [{ text: 'OK' }]);
      const senderId = (deliveryOTPTarget?.delivery_requests as any)?.sender_id;
      if (senderId) {
        try {
          await notifyUser(senderId, 'Delivery complete 📦', `Parcel #PNS-${String(requestId).padStart(4, '0')} was delivered with photo proof.`, { deliveryId });
        } catch (err) {
          console.warn('[Task] notify sender delivery complete failed', err);
        }
      }
      try { await clearLocationFix(deliveryId); } catch {}
      closeDeliveryOTPModal();
      await loadData();
    } catch (error: any) {
      console.error('[completeDelivery] exception:', error);
      Alert.alert('Completion Failed', error.message || 'Could not complete the delivery.');
    } finally {
      if (isMountedRef.current) setDeliveryOTPVerifying(false);
    }
  };

  const handleStartDropoffGracePeriod = async (delivery: any) => {
    const info = buildTaskInfo(delivery);
    const geo = await verifyProviderWithinGeofence(info.dropoff.lat, info.dropoff.lng, 'drop-off');
    if (!geo.allowed) return;

    const { data: freshRow, error: freshErr } = await withTimeout(
      supabase
        .from('deliveries')
        .select('dropoff_arrived_at, dropoff_wait_lat, dropoff_wait_lng, call_receiver_at, sms_receiver_at, chat_sender_at')
        .eq('delivery_id', delivery.delivery_id)
        .maybeSingle(),
      NETWORK_TIMEOUT_MS
    );

    if (freshErr) {
      Alert.alert('Error', freshErr.message);
      return;
    }

    const existingArrivedAt = freshRow?.dropoff_arrived_at ?? delivery.dropoff_arrived_at ?? null;

    let updated = {
      ...delivery,
      dropoff_arrived_at: existingArrivedAt,
      call_receiver_at: freshRow?.call_receiver_at ?? delivery.call_receiver_at ?? null,
      sms_receiver_at: freshRow?.sms_receiver_at ?? delivery.sms_receiver_at ?? null,
      chat_sender_at: freshRow?.chat_sender_at ?? delivery.chat_sender_at ?? null,
    };

    if (!existingArrivedAt) {
      const nowIso = new Date().toISOString();
      const { error } = await withTimeout(
        supabase
          .from('deliveries')
          .update({
            dropoff_arrived_at: nowIso,
            dropoff_wait_lat: geo.lat,
            dropoff_wait_lng: geo.lng,
          })
          .eq('delivery_id', delivery.delivery_id),
        NETWORK_TIMEOUT_MS
      );
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      updated.dropoff_arrived_at = nowIso;

      if (info.senderId) {
        await notifyUser(
          info.senderId,
          '⚠️ Courier at Drop-off (10-Min Timer Started)',
          `Your courier has arrived at drop-off. Please ensure ${info.receiverName || 'the receiver'} meets them within 10 minutes!`,
          { deliveryId: delivery.delivery_id }
        );
      }

      if (providerId) fetchDeliveries(providerId).catch(() => {});
    }

    setContactLogs({
      call: !!updated.call_receiver_at,
      sms: !!updated.sms_receiver_at,
      chat: !!updated.chat_sender_at,
    });
    setFailurePhotoUri(null);
    setGraceDelivery(updated);
    setGraceModalVisible(true);
  };

  const logProviderContactAttempt = async (kind: 'call' | 'sms' | 'chat') => {
    if (!graceDelivery) return;
    const info = buildTaskInfo(graceDelivery);
    const nowIso = new Date().toISOString();

    if (kind === 'call') {
      if (!info.receiverPhone) return Alert.alert('No Phone', 'Receiver phone number unavailable.');
      await supabase.from('deliveries').update({ call_receiver_at: nowIso }).eq('delivery_id', graceDelivery.delivery_id);
      setContactLogs(prev => ({ ...prev, call: true }));
      Linking.openURL(`tel:${info.receiverPhone}`);
    } else if (kind === 'sms') {
      if (!info.receiverPhone) return;
      await supabase.from('deliveries').update({ sms_receiver_at: nowIso }).eq('delivery_id', graceDelivery.delivery_id);
      setContactLogs(prev => ({ ...prev, sms: true }));
      const msg = encodeURIComponent(`Hi ${info.receiverName || ''}, I am your Pack-N-Ship courier waiting at the drop-off location. Please meet me within 10 minutes.`);
      Linking.openURL(`sms:${info.receiverPhone}?body=${msg}`);
    } else if (kind === 'chat') {
      await supabase.from('deliveries').update({ chat_sender_at: nowIso }).eq('delivery_id', graceDelivery.delivery_id);
      setContactLogs(prev => ({ ...prev, chat: true }));
      const roomId = await getOrCreateChatRoom(graceDelivery.delivery_id);
      if (roomId && providerId) {
        await supabase.from('chat_messages').insert({
          room_id: roomId,
          sender_id: providerId,
          message: "I'm here at the drop-off location, but the receiver isn't answering. The 10-minute grace timer is running.",
        });
        Alert.alert('Sent to Sender', 'Message logged and sent to the Sender in chat.');
      }
    }
  };

  const captureFailureProofPhoto = async () => {
    if (!failureCameraRef.current) return;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const photo = await failureCameraRef.current.takePictureAsync({ quality: 0.75 });
      if (photo?.uri && isMountedRef.current) {
        setFailureCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setFailureTimestamp(new Date().toISOString());
        setFailurePhotoUri(photo.uri);
        setFailureCameraOpen(false);
      }
    } catch (e: any) {
      Alert.alert('Camera Error', e?.message || 'Failed to take proof photo.');
    }
  };

  const executeFallbackProtocol = async () => {
    if (!graceDelivery || !failurePhotoUri) return;
    setSubmittingFailure(true);
    try {
      const deliveryId = graceDelivery.delivery_id;
      const req = graceDelivery.delivery_requests || {};
      const requestId = req.request_id;
      const fallbackAction = req.fallback_action || 'return_to_sender';
      const fallbackRecipient = req.fallback_recipient_name || 'Guard / Authorized Person';
      const nowIso = new Date().toISOString();

      const proofUrl = await uploadPodPhoto(failurePhotoUri, deliveryId);

      if (fallbackAction === 'leave_with_guard') {
        const { error: proofErr } = await withTimeout(
          supabase
            .from('deliveries')
            .update({
              pod_photo_url: proofUrl,
              failure_photo_url: proofUrl,
              failure_reason: `Left with ${fallbackRecipient}`,
              failure_photo_lat: failureCoords?.lat ?? null,
              failure_photo_lng: failureCoords?.lng ?? null,
              pod_seen_by_sender: false,
            })
            .eq('delivery_id', deliveryId),
          NETWORK_TIMEOUT_MS
        );
        if (proofErr) throw proofErr;

        const { error: awaitErr } = await withTimeout(
          supabase
            .from('delivery_requests')
            .update({ delivery_status: 'Awaiting Approval' })
            .eq('request_id', requestId),
          NETWORK_TIMEOUT_MS
        );
        if (awaitErr) throw awaitErr;

        if (req.sender_id) {
          await notifyUser(
            req.sender_id,
            'Approve Handover 📦',
            `Receiver was unreachable. Your courier left the package with ${fallbackRecipient} and uploaded a photo. Open Activity to review it and approve the delivery.`,
            { deliveryId, requestId }
          );
        }
        Alert.alert(
          '📸 Proof Submitted',
          `Waiting for the sender to confirm the package was left with ${fallbackRecipient}. Your payout will be released once they approve.`
        );
      } else {
        await withTimeout(
          supabase
            .from('deliveries')
            .update({
              failed_at: nowIso,
              failure_reason: 'Receiver Unreachable (10m expired)',
              failure_photo_url: proofUrl,
              failure_photo_lat: failureCoords?.lat ?? null,
              failure_photo_lng: failureCoords?.lng ?? null,
            })
            .eq('delivery_id', deliveryId),
          NETWORK_TIMEOUT_MS
        );

        await withTimeout(
          supabase
            .from('delivery_requests')
            .update({ delivery_status: 'Returning' })
            .eq('request_id', requestId),
          NETWORK_TIMEOUT_MS
        );

        if (req.sender_id) {
          await notifyUser(
            req.sender_id,
            'Delivery Failed — Returning Package 🔄',
            `Receiver was unreachable after 10 mins. Your courier is returning the package to you. Show your Pickup QR/PIN upon arrival.`,
            { deliveryId, requestId }
          );
        }
        Alert.alert(
          '🔄 Returning to Sender',
          'Please drive back to the Pickup Address and scan the Sender’s QR/PIN to receive your full Escrow Payout (Base Fare + Return Deposit).'
        );
      }

      if (isMountedRef.current) {
        setGraceModalVisible(false);
        setGraceDelivery(null);
      }
      await loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not complete fallback action.');
    } finally {
      if (isMountedRef.current) setSubmittingFailure(false);
    }
  };

  const loadData = async () => {
    try {
      if (!hasLoadedRef.current && isMountedRef.current) setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await fetchProviderRoutes(pid);
        await fetchDeliveries(pid);
      }
    } finally {
      hasLoadedRef.current = true;
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const taskRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleTaskRefresh = useCallback((pid: number) => {
    if (taskRefreshTimerRef.current) clearTimeout(taskRefreshTimerRef.current);
    taskRefreshTimerRef.current = setTimeout(() => {
      taskRefreshTimerRef.current = null;
      void fetchDeliveries(pid);
    }, 250);
  }, [fetchDeliveries]);

  useEffect(() => {
    if (!providerId) return;
    const refresh = () => scheduleTaskRefresh(providerId);
    const channel = supabase
      .channel(`task-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escrow_payments', filter: `provider_id=eq.${providerId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes', filter: `provider_id=eq.${providerId}` }, () => {
        fetchProviderRoutes(providerId).then(() => fetchDeliveries(providerId));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh();
      });

    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });

    return () => {
      if (taskRefreshTimerRef.current) { clearTimeout(taskRefreshTimerRef.current); taskRefreshTimerRef.current = null; }
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [providerId, fetchDeliveries, fetchProviderRoutes, scheduleTaskRefresh]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    if (selectedId == null) return;
    const stillActive = activeDeliveries.some(d => d.delivery_id === selectedId);
    const stillCompleted = completedDeliveries.some(d => d.delivery_id === selectedId);
    const stillCancelled = cancelledDeliveries.some(d => d.delivery_id === selectedId);
    if (!stillActive && !stillCompleted && !stillCancelled) {
      setSelectedId(null);
      closeVerifyModal();
      closeDeliveryOTPModal();
    }
  }, [activeDeliveries, completedDeliveries, cancelledDeliveries, selectedId]);

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const scanLineY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, frameSize - 4] });

  const isPickupVerified = (delivery: any) => {
    const qr = delivery?.qr_verifications;
    if (qr) {
      if (Array.isArray(qr)) { if (qr[0]?.pickup_verified) return true; }
      else if (qr.pickup_verified) return true;
    }
    const status = delivery?.delivery_requests?.delivery_status;
    return status === 'In Transit' || status === 'Awaiting Approval' || status === 'Returning' || status === 'Completed' || status === 'Returned';
  };

  const isAwaitingApproval = (d: any): boolean =>
    String(d?.delivery_requests?.delivery_status || '') === 'Awaiting Approval' && !d?.completed_at;

  const isScheduledDelivery = (d: any): boolean => {
    const req = d?.delivery_requests || {};
    if (req.is_scheduled === true) return true;
    if (String(req.delivery_type || req.schedule_type || '').toLowerCase() === 'scheduled') return true;
    return !!req.scheduled_time;
  };

  const stageOf = (d: any): 'pickup' | 'transit' | 'done' | 'cancelled' => {
    if (isCancelledDelivery(d)) return 'cancelled';
    if (d?.completed_at) return 'done';
    return isPickupVerified(d) ? 'transit' : 'pickup';
  };

  const statusMeta = (stage: 'pickup' | 'transit' | 'done' | 'cancelled', awaitingApproval = false) => {
    if (awaitingApproval && stage === 'transit') {
      return { label: 'Awaiting Approval', bg: colors.warningBg, fg: colors.warning, icon: 'Clock' };
    }
    switch (stage) {
      case 'done':
        return { label: 'Completed', bg: colors.successBg, fg: colors.success, icon: 'CheckCircle' };
      case 'transit':
        return { label: 'In Transit', bg: colors.accentSoft, fg: colors.accent, icon: 'Routing' };
      case 'cancelled':
        return { label: 'Cancelled', bg: colors.errorBg, fg: colors.error, icon: 'CloseCircle' };
      case 'pickup':
      default:
        return { label: 'Awaiting Pickup', bg: 'rgba(59,130,246,0.14)', fg: BLUE, icon: 'Package' };
    }
  };

  const copyTracking = async (text: string) => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(text);
        if (isMountedRef.current) setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setCopied(false);
        }, 1800);
      } else { await Share.share({ message: text }); }
    } catch { }
  };

  const messageSender = async (d: any) => {
    try {
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(d.delivery_id);
      if (!roomId) { Alert.alert('Error', 'Could not open chat.'); return; }
      let current: any = navigation;
      while (current) {
        try {
          const names: string[] = current.getState?.()?.routeNames || [];
          const match = names.find(n => /message|chat|inbox/i.test(n));
          if (match) { current.navigate(match, { openRoomId: roomId }); return; }
        } catch { }
        current = current.getParent?.();
      }
      navigation.navigate('MainTabs', { screen: 'Messages', params: { openRoomId: roomId } });
    } catch {
      Alert.alert('Chat unavailable', 'Could not open the conversation with the sender.');
    } finally {
      if (isMountedRef.current) setOpeningChat(false);
    }
  };

  const allTasks = useMemo(() => {
    const map = new Map<number, any>();
    [...activeDeliveries, ...completedDeliveries, ...cancelledDeliveries].forEach(d => {
      map.set(d.delivery_id, d);
    });
    return Array.from(map.values());
  }, [activeDeliveries, completedDeliveries, cancelledDeliveries]);

  const matchesSelectedRoute = useCallback((d: any): boolean => {
    if (!filterByActiveRoute || !activeRoute?.route_id) return true;
    const targetRouteId = Number(activeRoute.route_id);
    const delRouteId = d?.route_id != null ? Number(d.route_id) : null;
    const prefRouteId = d?.delivery_requests?.preferred_route_id != null
      ? Number(d.delivery_requests.preferred_route_id)
      : (d?.request?.preferred_route_id != null ? Number(d.request.preferred_route_id) : null);

    if (delRouteId === targetRouteId || prefRouteId === targetRouteId) return true;
    if (delRouteId == null && prefRouteId == null) return true;
    return false;
  }, [filterByActiveRoute, activeRoute?.route_id]);

  const visibleActiveDeliveries = useMemo(
    () => activeDeliveries.filter(matchesSelectedRoute),
    [activeDeliveries, matchesSelectedRoute]
  );

  const visibleScheduledDeliveries = useMemo(
    () => activeDeliveries.filter(d => isScheduledDelivery(d) && matchesSelectedRoute(d)),
    [activeDeliveries, matchesSelectedRoute]
  );

  const openRoute = (d: any) => {
    const st = stageOf(d);
    if (st !== 'pickup' && st !== 'transit') return;
    const info = buildTaskInfo(d);
    const t = st === 'pickup' ? info.pickup : info.dropoff;
    if (t.lat == null || t.lng == null) {
      Alert.alert('Route unavailable', `This order has no map coordinates for the ${st === 'pickup' ? 'pickup' : 'drop-off'} location.`);
      return;
    }
    navigation.navigate('ProviderNavigation', { deliveryId: d.delivery_id });
  };

  const selectedTask = selectedId != null ? allTasks.find(d => d.delivery_id === selectedId) || null : null;

  const tabCount = (t: TabType) =>
    t === 'active' ? visibleActiveDeliveries.length
      : t === 'scheduled' ? visibleScheduledDeliveries.length
      : t === 'completed' ? completedDeliveries.length
      : t === 'cancelled' ? cancelledDeliveries.length
      : allTasks.length;

  const filteredTasks =
    activeTab === 'active' ? visibleActiveDeliveries
      : activeTab === 'scheduled' ? visibleScheduledDeliveries
      : activeTab === 'completed' ? completedDeliveries
      : activeTab === 'cancelled' ? cancelledDeliveries
      : allTasks;

  const SIZE_META: Record<string, { letter: string; kg: string; color: string; bg: string }> = {
    Small:  { letter: 'S', kg: `${SHIPMENT_SIZE_SPECS.Small.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Small.inchesLabel}`,  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
    Medium: { letter: 'M', kg: `${SHIPMENT_SIZE_SPECS.Medium.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Medium.inchesLabel}`, color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
    Large:  { letter: 'L', kg: `${SHIPMENT_SIZE_SPECS.Large.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Large.inchesLabel}`, color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
  };

  const pkgCount = (info: any) => `${info.totalItems} ${info.totalItems === 1 ? 'pkg' : 'pkgs'}`;

  const renderServicePill = (info: any) => (
    <View style={styles.svcPill}>
      <SolarIcon name="Package" variant="duotone" size={16} color={BLUE} />
      <Text style={styles.svcPillText}>{serviceLabel(info.request?.pickup_type)}</Text>
    </View>
  );

  const renderStatusPill = (meta: { label: string; bg: string; fg: string }) => (
    <View style={[styles.stPill, { backgroundColor: meta.bg }]}>
      <View style={[styles.stDot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.stPillText, { color: meta.fg }]}>{meta.label.toUpperCase()}</Text>
    </View>
  );

  const renderRoute = (info: any, opts: { notes?: boolean } = {}) => (
    <View>
      {[
        { key: 'p', label: 'PICKUP', pt: info.pickup, note: info.pickupNote, kind: 'pickup' as const },
        { key: 'd', label: 'DROP-OFF', pt: info.dropoff, note: info.dropoffNote, kind: 'dropoff' as const },
      ].map((r, i) => (
        <View key={r.key} style={styles.rtRow}>
          <View style={styles.rtRail}>
            {r.kind === 'pickup' ? (
              <View style={styles.rtPickPin}>
                <Ionicons name="cube" size={14} color="#FFFFFF" />
              </View>
            ) : (
              <View style={styles.rtDropPin}>
                <Ionicons name="person" size={16} color="#000000" />
              </View>
            )}
            {i === 0 && <View style={styles.rtLine} />}
          </View>
          <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
            <Text style={styles.rtLabel}>{r.label}</Text>
            <Text style={styles.rtMain} numberOfLines={1}>{r.pt.main}</Text>
            {!!r.pt.road && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <SolarIcon name="MapPoint" variant="linear" size={12} color={colors.textMuted} />
                <Text style={styles.rtSub} numberOfLines={2}>{r.pt.road}</Text>
              </View>
            )}
            {opts.notes && !!r.note && (
              <View style={styles.sdNote}>
                <SolarIcon name="ChatCircleText" variant="duotone" size={14} />
                <Text style={styles.sdNoteText}>{r.note}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderMiniContact = (o: {
    role: string;
    name: string | null;
    phone: string | null;
    color: string;
    hideCall?: boolean;
    subBadge?: string | null;
  }) => {
    const canCall = !o.hideCall && !!o.phone;

    const triggerCall = () => {
      if (!o.phone) {
        Alert.alert('No Phone Number', `No phone number is available for ${o.name || 'this contact'}.`);
        return;
      }
      const url = `tel:${String(o.phone).replace(/\s+/g, '')}`;
      Linking.openURL(url).catch(() => {
        Alert.alert('Unable to Call', 'Your device cannot open the phone dialer.');
      });
    };

    const handlePress = () => {
      Alert.alert(
        o.role,
        `Name: ${o.name || 'N/A'}\nPhone: ${o.phone || 'N/A'}${o.subBadge ? `\nStatus: ${o.subBadge}` : ''}`,
        canCall
          ? [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Call', onPress: triggerCall },
            ]
          : [{ text: 'OK' }],
      );
    };

    return (
      <TouchableOpacity style={styles.mcRow} onPress={handlePress} activeOpacity={0.7}>
        <View style={[styles.mcAvatarSmall, { backgroundColor: o.color }]}>
          <Text style={styles.mcAvatarTextSmall}>{initials(o.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mcRoleSmall} numberOfLines={1}>{o.role}</Text>
          <Text style={styles.mcNameSmall}>{o.name || 'N/A'}</Text>
          {!!o.subBadge && (
            <Text style={styles.mcSubBadgeSmall}>{o.subBadge}</Text>
          )}
        </View>
        {canCall && (
          <TouchableOpacity
            style={styles.mcCallSmall}
            onPress={(e) => {
              e.stopPropagation();
              triggerCall();
            }}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <SolarIcon name="Phone" variant="linear" size={16} color={colors.accent} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderTaskCard = (d: any) => {
    const info = buildTaskInfo(d);
    if (!info.request) return null;
    const stage = stageOf(d);
    const meta = statusMeta(stage, isAwaitingApproval(d));
    const isCancelled = stage === 'cancelled';
    const isCompleted = stage === 'done';
    const active = stage === 'pickup' || stage === 'transit';
    const isReturning = info.request?.delivery_status === 'Returning';
    const scheduled = isScheduledDelivery(d);

    return (
      <TouchableOpacity
        key={d.delivery_id}
        style={[styles.oCard, !active && { opacity: 0.92 }]}
        onPress={() => setSelectedId(d.delivery_id)}
        activeOpacity={0.92}
      >
        <View style={styles.oPad}>
          <View style={styles.oTopRow}>
            {renderServicePill(info)}
            {renderStatusPill(meta)}
          </View>

          {scheduled && !!info.request?.scheduled_time && (
            <View style={styles.scheduledBanner}>
              <Ionicons name="calendar-outline" size={14} color={colors.accent} />
              <Text style={styles.scheduledBannerText}>
                Scheduled: {formatDateTime(info.request.scheduled_time)}
              </Text>
            </View>
          )}

          {renderRoute(info)}

          {!!d.pickup_photo_url && (
            <TouchableOpacity
              style={[styles.cardPodBanner, { marginBottom: 8 }]}
              onPress={(e) => {
                e.stopPropagation();
                setPhotoPreview(d.pickup_photo_url);
              }}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: d.pickup_photo_url }}
                style={styles.cardPodThumb}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <SolarIcon name="Camera" variant="duotone" size={14} color={colors.accent} />
                  <Text style={styles.cardPodTitle}>Pickup Photo Attached</Text>
                </View>
                <Text style={styles.cardPodSub} numberOfLines={1}>
                  Tap photo to enlarge or tap card for full details
                </Text>
              </View>
              <SolarIcon name="Maximize" variant="linear" size={16} color={colors.accent} />
            </TouchableOpacity>
          )}

          {isCompleted && !!d.pod_photo_url && (
            <TouchableOpacity
              style={styles.cardPodBanner}
              onPress={(e) => {
                e.stopPropagation();
                setPhotoPreview(d.pod_photo_url);
              }}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: d.pod_photo_url }}
                style={styles.cardPodThumb}
                resizeMode="cover"
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <SolarIcon name="ShieldCheck" variant="duotone" size={14} color={colors.success} />
                  <Text style={styles.cardPodTitle}>Proof of Delivery Attached</Text>
                </View>
                <Text style={styles.cardPodSub} numberOfLines={1}>
                  Tap photo to enlarge or tap card for full details
                </Text>
              </View>
              <SolarIcon name="Maximize" variant="linear" size={16} color={colors.success} />
            </TouchableOpacity>
          )}

          <View style={styles.oContactsRow}>
            {renderMiniContact({
              role: 'SENDER',
              name: info.senderName,
              phone: info.senderPhone,
              color: BLUE,
              hideCall: isCompleted || isCancelled,
            })}
            {renderMiniContact({
              role: 'RECEIVER',
              name: info.receiverName,
              phone: info.receiverPhone,
              color: PURPLE,
              hideCall: isCompleted || isCancelled,
            })}
          </View>

          {isCancelled && <Text style={styles.mCancelledText}>Cancelled by the sender</Text>}
          {isReturning && !isCancelled && (
            <Text style={[styles.mCancelledText, { color: colors.warning }]}>
              Returning parcel to sender pickup pin
            </Text>
          )}
        </View>

        <View style={styles.oFooter}>
          <Text style={styles.oPayLabel}>Total pay:</Text>
          <Text numberOfLines={1} style={[styles.oPrice, isCancelled && { textDecorationLine: 'line-through', color: colors.textMuted }]}>
            {money(info.earnings)}
          </Text>
        </View>

        {active && (
          <View style={styles.oActions}>
            <TouchableOpacity
              style={[styles.oRouteBtn, { flex: 1 }]}
              onPress={(e) => {
                e.stopPropagation();
                openRoute(d);
              }}
              activeOpacity={0.9}
            >
              <Ionicons name="navigate" size={18} color="#FFFFFF" />
              <Text style={styles.oRouteText}>Start Route</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderActiveRouteFilterBar = () => {
    const startAddr = describePlace(activeRoute?.start_location);
    const endAddr = describePlace(activeRoute?.end_location);
    const currentTabPool =
      activeTab === 'scheduled'
        ? activeDeliveries.filter(isScheduledDelivery)
        : activeDeliveries;

    const thisRouteCount = activeRoute
      ? currentTabPool.filter((d) => {
          const targetRouteId = Number(activeRoute.route_id);
          const delRouteId = d?.route_id != null ? Number(d.route_id) : null;
          const prefRouteId =
            d?.delivery_requests?.preferred_route_id != null
              ? Number(d.delivery_requests.preferred_route_id)
              : d?.request?.preferred_route_id != null
                ? Number(d.request.preferred_route_id)
                : null;
          return (
            delRouteId === targetRouteId ||
            prefRouteId === targetRouteId ||
            (delRouteId == null && prefRouteId == null)
          );
        }).length
      : 0;

    const allRoutesCount = currentTabPool.length;
    const isFiltered = filterByActiveRoute && !!activeRoute;

    return (
      <View style={styles.routeFilterWrap}>
        <View
          style={[
            styles.routeFilterCard,
            isFiltered && styles.routeFilterCardActive,
          ]}
        >
          {/* Top Row: Corridor Info + Route Picker Trigger */}
          <TouchableOpacity
            style={styles.routeFilterTopRow}
            onPress={() => setRoutePickerVisible(true)}
            activeOpacity={0.85}
          >
            <View style={styles.routeFilterIconWrap}>
              <SolarIcon
                name="Routing"
                variant="duotone"
                size={20}
                color={colors.accent}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.routeFilterEyebrow}>
                {isFiltered ? 'FILTERED BY CORRIDOR' : 'CORRIDOR FILTER OFF'}
              </Text>

              {activeRoute ? (
                <>
                  <Text style={styles.routeFilterTitle} numberOfLines={1}>
                    {startAddr.main}{' '}
                    <Text style={{ color: colors.accent, fontFamily: 'Poppins_700Bold' }}>
                      →
                    </Text>{' '}
                    {endAddr.main}
                  </Text>
                  <Text style={styles.routeFilterSub} numberOfLines={1}>
                    {Number(activeRoute.remaining_weight_kg ?? 100).toFixed(0)} kg ·{' '}
                    {Number(activeRoute.remaining_volume_liters ?? 200).toFixed(0)} L left ·{' '}
                    {activeRoute.route_frequency}
                  </Text>
                </>
              ) : (
                <Text style={styles.routeFilterTitle} numberOfLines={1}>
                  No active route selected
                </Text>
              )}
            </View>

            <View style={styles.routeChangePill}>
              <Text style={styles.routeChangePillText}>
                {activeRoute ? 'Change' : 'Select'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textPrimary} />
            </View>
          </TouchableOpacity>

          {/* Bottom Segmented Control: Cleanly toggle between This Route and All Routes */}
          {activeRoute && (
            <View style={styles.routeSegmentBar}>
              <TouchableOpacity
                style={[
                  styles.routeSegmentBtn,
                  isFiltered && styles.routeSegmentBtnActive,
                ]}
                onPress={() => setFilterByActiveRoute(true)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.routeSegmentText,
                    isFiltered && styles.routeSegmentTextActive,
                  ]}
                  numberOfLines={1}
                >
                  This Route ({thisRouteCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.routeSegmentBtn,
                  !isFiltered && styles.routeSegmentBtnActive,
                ]}
                onPress={() => setFilterByActiveRoute(false)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.routeSegmentText,
                    !isFiltered && styles.routeSegmentTextActive,
                  ]}
                  numberOfLines={1}
                >
                  All Routes ({allRoutesCount})
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  const renderRoutePickerModal = () => (
    <Modal visible={routePickerVisible} transparent animationType="slide" onRequestClose={() => setRoutePickerVisible(false)}>
      <View style={styles.routeModalOverlay}>
        <View style={styles.routePickerSheet}>
          <View style={styles.routePickerHandle} />
          <View style={styles.routePickerHeader}>
            <Text style={styles.routePickerTitle}>Filter Tasks by Active Route</Text>
            <TouchableOpacity onPress={() => setRoutePickerVisible(false)} hitSlop={8}>
              <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {routes.length > 0 && (
            <TouchableOpacity
              style={[
                styles.routeOption,
                !filterByActiveRoute && styles.routeOptionSelected,
              ]}
              onPress={() => {
                setFilterByActiveRoute(false);
                setRoutePickerVisible(false);
              }}
              activeOpacity={0.85}
            >
              <View style={[styles.routeOptionDot, { backgroundColor: !filterByActiveRoute ? colors.accent : colors.textMuted }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeOptionTitle} numberOfLines={1}>
                  Show All Active Deliveries ({activeDeliveries.length})
                </Text>
                <Text style={styles.routeOptionSub} numberOfLines={1}>
                  Display tasks across all of your posted routes
                </Text>
              </View>
              {!filterByActiveRoute && <SolarIcon name="CheckCircle" variant="linear" size={22} color={colors.accent} />}
            </TouchableOpacity>
          )}

          {routes.length === 0 ? (
            <View style={styles.routePickerEmpty}>
              <SolarIcon name="Map" variant="duotone" size={40} color={colors.accent} />
              <Text style={styles.routePickerEmptyTitle}>No active routes posted</Text>
              <Text style={styles.routePickerEmptySub}>
                Post or manage your routes in the Jobs or Manage Routes screen to filter tasks by corridor.
              </Text>
              <TouchableOpacity
                style={styles.emptyManageRouteBtn}
                onPress={() => {
                  setRoutePickerVisible(false);
                  navigation.navigate('ManageRoutes');
                }}
                activeOpacity={0.85}
              >
                <SolarIcon name="Map" variant="linear" size={16} color={colors.accent} />
                <Text style={styles.emptyManageRouteText}>Manage Routes</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {routes.map((r: any) => {
                const isSelected = filterByActiveRoute && activeRoute?.route_id === r.route_id;
                const rDate = parseNaiveIsoString(r.departure_time);
                const timeStr = rDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const scheduleLabel =
                  r.route_frequency === 'Daily'
                    ? `Every day · ${timeStr}`
                    : r.route_frequency === 'Weekly'
                      ? `Every ${WEEKDAY_LABELS[rDate.getDay()]} · ${timeStr}`
                      : `${rDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${timeStr}`;

                const startAddr = describePlace(r.start_location);
                const endAddr = describePlace(r.end_location);
                const routeTaskCount = activeDeliveries.filter(
                  (d) =>
                    Number(d?.route_id) === Number(r.route_id) ||
                    Number(d?.delivery_requests?.preferred_route_id) === Number(r.route_id)
                ).length;

                return (
                  <TouchableOpacity
                    key={r.route_id}
                    style={[styles.routeOption, isSelected && styles.routeOptionSelected]}
                    onPress={() => handleSelectRoute(r)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.routeOptionDot, { backgroundColor: isSelected ? colors.accent : colors.textMuted }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.routeOptionTitle} numberOfLines={1}>
                        {startAddr.main} → {endAddr.main}
                      </Text>
                      <Text style={styles.routeOptionSub} numberOfLines={1}>
                        {scheduleLabel} · {r.route_frequency} · {routeTaskCount} active
                      </Text>
                    </View>
                    {isSelected && <SolarIcon name="CheckCircle" variant="linear" size={22} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                style={[styles.emptyManageRouteBtn, { alignSelf: 'center', marginTop: 10 }]}
                onPress={() => {
                  setRoutePickerVisible(false);
                  navigation.navigate('ManageRoutes');
                }}
                activeOpacity={0.85}
              >
                <SolarIcon name="Settings" variant="linear" size={16} color={colors.accent} />
                <Text style={styles.emptyManageRouteText}>Manage All Routes</Text>
              </TouchableOpacity>
              <View style={{ height: 30 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  const renderListView = () => (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Animated.View style={[styles.headerSection, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.pageTitle}>My Tasks</Text>

        {(activeTab === 'active' || activeTab === 'scheduled') && renderActiveRouteFilterBar()}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          {(['active', 'scheduled', 'completed', 'cancelled', 'all'] as const).map(t => {
            const on = activeTab === t;
            const count = tabCount(t);
            const label = t.charAt(0).toUpperCase() + t.slice(1);
            return (
              <TouchableOpacity key={t} style={[styles.tabItem, on && styles.tabItemActive]} onPress={() => setActiveTab(t)} activeOpacity={0.8}>
                <Text style={[styles.tabText, on && styles.tabTextActive]}>
                  {label}
                </Text>
                {count > 0 && (
                  <View style={[styles.tabCountBadge, on && styles.tabCountBadgeActive]}>
                    <Text style={[styles.tabCountText, on && styles.tabCountTextActive]}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Animated.View style={{ opacity: contentAnim }}>
          {filteredTasks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Image
                source={EMPTY_BOX_ICON}
                style={{ width: 140, height: 140, marginBottom: 20 }}
                resizeMode="contain"
              />
              <Text style={styles.emptyTitle}>
                {activeTab === 'cancelled'
                  ? 'No cancelled bookings'
                  : activeTab === 'scheduled'
                    ? 'No scheduled deliveries'
                    : activeTab === 'active' && filterByActiveRoute && activeDeliveries.length > 0
                      ? 'No active tasks on this route'
                      : allTasks.length === 0 ? 'No tasks yet' : 'Nothing here'}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === 'cancelled'
                  ? 'Bookings cancelled by the sender will appear here.'
                  : activeTab === 'scheduled'
                    ? 'Deliveries with a scheduled pickup time along your selected route will appear here.'
                    : activeTab === 'active' && filterByActiveRoute && activeDeliveries.length > 0
                      ? `You have ${activeDeliveries.length} active delivery task(s) on your other routes.`
                      : allTasks.length === 0
                        ? 'Deliveries you accept appear here.'
                        : 'Try another tab or route to view tasks.'}
              </Text>
              {(activeTab === 'active' || activeTab === 'scheduled') && filterByActiveRoute && activeDeliveries.length > 0 && (
                <TouchableOpacity
                  style={[styles.emptyManageRouteBtn, { marginTop: 16 }]}
                  onPress={() => setFilterByActiveRoute(false)}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="Routing" variant="duotone" size={16} color={colors.accent} />
                  <Text style={styles.emptyManageRouteText}>Show All Routes ({activeDeliveries.length})</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : filteredTasks.map(d => renderTaskCard(d))}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  const renderDetailView = (d: any) => {
    const info = buildTaskInfo(d);
    const stage = stageOf(d);
    const code = trackingCode(info.request?.request_id ?? d.delivery_id);
    const escrowStatus = String(d.escrow?.escrow_status || '');
    const released = stage === 'done' || /complet|releas/i.test(escrowStatus);
    const paymentLabel = released
      ? 'Completed'
      : /hold/i.test(escrowStatus) || !escrowStatus ? 'Held in escrow' : escrowStatus;
    const isCancelled = stage === 'cancelled';
    const isCompleted = stage === 'done';
    const active = stage === 'pickup' || stage === 'transit';

    const progressSteps = ['Accepted', 'To pickup', 'Picked up', 'To drop-off', 'Delivered'];
    const doneUpTo = stage === 'done' ? 4 : stage === 'transit' ? 2 : 0;
    const currentStep = stage === 'done' ? -1 : stage === 'transit' ? 3 : 1;

    const items: any[] = info.items || [];
    const awaitingApproval = isAwaitingApproval(d);
    const hintText = awaitingApproval
      ? 'Proof photo sent. Waiting for the sender to confirm the package was left with the authorized person. Your payout is released as soon as they approve.'
      : stage === 'pickup'
      ? 'Meet the sender, then verify with their QR or 4-digit PIN.'
      : `Hand over ${/door/i.test(info.request?.pickup_type || '') ? 'at the door' : 'at the curb or entrance'}, take a Proof of Delivery photo, and enter the receiver’s 6-digit OTP.`;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.dHeaderBar, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <TouchableOpacity
            style={styles.dRoundBtnInline}
            onPress={() => setSelectedId(null)}
            activeOpacity={0.85}
          >
            <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.dHeaderTitle} numberOfLines={1}>Task Details</Text>
          <TouchableOpacity
            style={styles.dRoundBtnInline}
            onPress={() => setMapModalVisible(true)}
            activeOpacity={0.85}
          >
            <SolarIcon name="Map" variant="linear" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: active ? insets.bottom + 130 : insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.dSheetBody, { opacity: detailAnim }]}>
            <View style={styles.oTopRow}>
              {renderServicePill(info)}
              {renderStatusPill(statusMeta(stage, isAwaitingApproval(d)))}
            </View>

            <View style={styles.dCodeRow}>
              <Text style={styles.dCode} selectable numberOfLines={1}>#{code}</Text>
              <TouchableOpacity
                onPress={() => copyTracking(code)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.trackTextCopy}
              >
                <SolarIcon name={copied ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                <Text style={styles.trackTextCopyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
            {!!info.request?.scheduled_time && (
              <Text style={styles.dWhen}>Scheduled · {formatDateTime(info.request.scheduled_time)}</Text>
            )}

            {!isCancelled && (
              <View style={styles.stepper}>
                {progressSteps.map((label, i) => {
                  const done = i <= doneUpTo;
                  const current = i === currentStep;
                  const reached = done || current;
                  return (
                    <View key={label} style={styles.stepCol}>
                      <View style={styles.stepLineRow}>
                        <View style={[styles.stepLine, i === 0 && { backgroundColor: 'transparent' }, reached && i > 0 && { backgroundColor: colors.accent }]} />
                        <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]}>
                          {done ? <SolarIcon name="Check" variant="linear" size={14} color="#FFFFFF" />
                            : current ? <View style={styles.stepDotInner} /> : null}
                        </View>
                        <View style={[styles.stepLine, i === progressSteps.length - 1 && { backgroundColor: 'transparent' }, done && i < progressSteps.length - 1 && { backgroundColor: colors.accent }]} />
                      </View>
                      <Text style={[styles.stepLabel, reached && styles.stepLabelOn]} numberOfLines={2}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {isCancelled ? (
              <View style={styles.cancelBanner}>
                <View style={styles.cancelBannerIcon}>
                  <SolarIcon name="CloseCircle" variant="duotone" size={22} color={colors.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cancelBannerTitle}>Booking cancelled</Text>
                  <Text style={styles.cancelBannerSub}>
                    The sender cancelled this booking. Any escrow amount is being refunded to them.
                  </Text>
                </View>
              </View>
            ) : isCompleted ? (
              <View style={styles.doneCard}>
                <View style={styles.doneIcon}><SolarIcon name="Check" variant="linear" size={20} color={colors.success} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doneTitle}>Delivered successfully</Text>
                  <Text style={styles.doneSub}>
                    {d.completed_at ? formatDateTime(d.completed_at) : ''}
                    {released ? `  ·  ${money(info.earnings)} added to your wallet` : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.dHint}>
                <SolarIcon name="Info" variant="duotone" size={18} color={colors.accent} />
                <Text style={styles.dHintText}>{hintText}</Text>
              </View>
            )}

            <View style={{ marginTop: 18 }}>{renderRoute(info, { notes: true })}</View>

            <View style={styles.senderSectionCard}>
              <View style={styles.senderTopRow}>
                <View style={[styles.mcAvatarSmall, { backgroundColor: BLUE }]}>
                  <Text style={styles.mcAvatarTextSmall}>{initials(info.senderName)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mcRoleSmall}>CUSTOMER / SENDER</Text>
                  <Text style={styles.mcNameSmall}>{info.senderName || 'N/A'}</Text>
                  {!!info.senderPhone && (
                    <Text style={styles.senderPhoneSub}>{info.senderPhone}</Text>
                  )}
                </View>

                {!isCompleted && !isCancelled && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {!!info.senderPhone && (
                      <TouchableOpacity
                        style={styles.mcCallSmall}
                        onPress={() => {
                          const url = `tel:${String(info.senderPhone).replace(/\s+/g, '')}`;
                          Linking.openURL(url).catch(() => {
                            Alert.alert('Unable to Call', 'Your device cannot open the phone dialer.');
                          });
                        }}
                        activeOpacity={0.8}
                        hitSlop={6}
                      >
                        <SolarIcon name="Phone" variant="linear" size={16} color={colors.accent} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={styles.senderChatPillBtn}
                      onPress={() => messageSender(d)}
                      disabled={openingChat}
                      activeOpacity={0.85}
                    >
                      {openingChat ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <>
                          <SolarIcon name="ChatCircleText" variant="linear" size={16} color={colors.accent} />
                          <Text style={styles.senderChatPillText}>Chat</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Receiver Card Container (Call only, hidden when completed/cancelled) */}
            <View style={styles.dSecHead}>
              <SolarIcon name="User" variant="duotone" size={18} color={PURPLE} />
              <Text style={styles.dSecTitle}>Receiver</Text>
            </View>

            <View style={styles.senderSectionCard}>
              <View style={styles.senderTopRow}>
                <View style={[styles.mcAvatarSmall, { backgroundColor: PURPLE }]}>
                  <Text style={styles.mcAvatarTextSmall}>{initials(info.receiverName)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mcRoleSmall}>RECIPIENT / RECEIVER</Text>
                  <Text style={styles.mcNameSmall}>{info.receiverName || 'N/A'}</Text>
                  {!!info.receiverPhone && (
                    <Text style={styles.senderPhoneSub}>{info.receiverPhone}</Text>
                  )}
                </View>

                {!isCompleted && !isCancelled && !!info.receiverPhone && (
                  <TouchableOpacity
                    style={styles.receiverCallPillBtn}
                    onPress={() => {
                      const url = `tel:${String(info.receiverPhone).replace(/\s+/g, '')}`;
                      Linking.openURL(url).catch(() => {
                        Alert.alert('Unable to Call', 'Your device cannot open the phone dialer.');
                      });
                    }}
                    activeOpacity={0.85}
                  >
                    <SolarIcon name="Phone" variant="linear" size={16} color={PURPLE} />
                    <Text style={styles.receiverCallPillText}>Call</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {stage === 'pickup' && (
              <View style={{ marginTop: 14, gap: 8 }}>
                <TouchableOpacity style={[styles.mSoftBtn, { flex: 0 }]} onPress={() => handlePingSender(d)} disabled={pingingId === d.delivery_id} activeOpacity={0.85}>
                  {pingingId === d.delivery_id ? (
                    <ActivityIndicator size="small" color={ORANGE} />
                  ) : (
                    <>
                      <Ionicons name="notifications" size={16} color={ORANGE} />
                      <Text style={styles.mSoftText}>Let sender know I’m on my way (Set ETA)</Text>
                    </>
                  )}
                </TouchableOpacity>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: d.receiver_notified ? colors.successBg : colors.warningBg,
                }}>
                  <Ionicons
                    name={d.receiver_notified ? 'checkmark-circle' : 'time-outline'}
                    size={16}
                    color={d.receiver_notified ? colors.success : colors.warning}
                  />
                  <Text style={{ fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: d.receiver_notified ? colors.success : colors.warning }}>
                    {d.receiver_notified ? 'Sender notified the receiver ✓' : 'Sender has not confirmed receiver yet'}
                  </Text>
                </View>
              </View>
            )}

            {stage === 'transit' && !awaitingApproval && d.delivery_requests?.delivery_status !== 'Returning' && (
              <TouchableOpacity
                style={[styles.mSoftBtn, { marginTop: 14, flex: 0, backgroundColor: colors.errorBg }]}
                onPress={() => handleStartDropoffGracePeriod(d)}
                activeOpacity={0.85}
              >
                <Ionicons name="timer-outline" size={17} color={colors.error} />
                <Text style={[styles.mSoftText, { color: colors.error }]}>
                  {d.dropoff_arrived_at ? 'Open 10-Min Drop-off Timer / Fallback' : "I'm at Drop-off (Start 10-Min Timer)"}
                </Text>
              </TouchableOpacity>
            )}

            {!!d.pickup_photo_url && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Camera" variant="duotone" size={18} color={colors.accent} />
                  <Text style={styles.dSecTitle}>Proof of Pickup</Text>
                </View>
                <TouchableOpacity
                  style={styles.podPhotoCard}
                  activeOpacity={0.9}
                  onPress={() => setPhotoPreview(d.pickup_photo_url)}
                >
                  <Image
                    source={{ uri: d.pickup_photo_url }}
                    style={styles.podPhotoImg}
                    resizeMode="cover"
                  />
                  <View style={styles.podPhotoOverlay}>
                    <View style={styles.podPhotoBadge}>
                      <SolarIcon name="Maximize" variant="linear" size={13} color="#FFFFFF" />
                      <Text style={styles.podPhotoBadgeText}>Tap to view full photo</Text>
                    </View>
                    {!!d.pickup_photo_taken_at && (
                      <Text style={styles.podPhotoTime}>{formatDateTime(d.pickup_photo_taken_at)}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}

            {!!d.pod_photo_url && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="ShieldCheck" variant="duotone" size={18} color={colors.success} />
                  <Text style={styles.dSecTitle}>Proof of Delivery</Text>
                  <View style={[styles.sdRatedBadge, { backgroundColor: colors.successBg }]}>
                    <SolarIcon name="CheckCircle" variant="linear" size={12} color={colors.success} />
                    <Text style={[styles.sdRatedBadgeText, { color: colors.success }]}>Verified</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.podPhotoCard}
                  activeOpacity={0.9}
                  onPress={() => setPhotoPreview(d.pod_photo_url)}
                >
                  <Image
                    source={{ uri: d.pod_photo_url }}
                    style={styles.podPhotoImg}
                    resizeMode="cover"
                  />
                  <View style={styles.podPhotoOverlay}>
                    <View style={styles.podPhotoBadge}>
                      <SolarIcon name="Maximize" variant="linear" size={13} color="#FFFFFF" />
                      <Text style={styles.podPhotoBadgeText}>Tap to view full photo</Text>
                    </View>
                    {!!d.completed_at && (
                      <Text style={styles.podPhotoTime}>{formatDateTime(d.completed_at)}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.dSecHead}>
              <SolarIcon name="Package" variant="duotone" size={18} />
              <Text style={styles.dSecTitle}>Package &amp; Payment</Text>
            </View>
            {items.some((it: any) => !!it.description || !!it.photo) && (
              <View style={{ gap: 8, marginBottom: 12 }}>
                {items.map((it: any, i: number) => {
                  const meta = it.size ? SIZE_META[it.size] : null;
                  return (
                    <View key={i} style={styles.dItemRow}>
                      {!!it.photo && !failedPhotos[it.photo] ? (
                        <TouchableOpacity activeOpacity={0.9} onPress={() => setPhotoPreview(it.photo)} style={styles.dItemPhotoWrap}>
                          <Image
                            source={{ uri: it.photo }}
                            style={styles.dItemPhoto}
                            resizeMode="cover"
                            onError={() => setFailedPhotos(p => ({ ...p, [it.photo]: true }))}
                          />
                          {meta && (
                            <View style={[styles.dItemPhotoTag, { backgroundColor: meta.bg }]}>
                              <Text style={[styles.dItemPhotoTagText, { color: meta.color }]}>{meta.letter}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <View style={[styles.dItemPhotoWrap, styles.dItemPhotoEmpty, meta && { backgroundColor: meta.bg }]}>
                          <Text style={[styles.dItemPhotoEmptyText, meta && { color: meta.color }]}>{meta ? meta.letter : i + 1}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.dItemTitle} numberOfLines={2}>
                          {items.length > 1 ? `Package ${i + 1}` : 'Package'}
                          {it.size ? ` · ${it.size}` : ''}
                          {it.fragile && (
                            <Text style={{ color: colors.error, fontFamily: 'Poppins_700Bold' }}> · Fragile</Text>
                          )}
                        </Text>
                        {!!it.description && <Text style={styles.dItemText} numberOfLines={2}>{it.description}</Text>}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.payRowsCard}>
              <View style={styles.payRow}>
                <Text style={styles.payRowLabel}>{isCancelled ? 'Earnings' : 'You Earn'}</Text>
                <Text
                  style={[
                    styles.payRowValue,
                    { color: isCancelled ? colors.textMuted : colors.success, fontFamily: 'Poppins_700Bold' },
                    isCancelled && { textDecorationLine: 'line-through' },
                  ]}
                >
                  {money(info.earnings)}
                </Text>
              </View>

              <View style={[styles.payRow, styles.payRowBorder]}>
                <Text style={styles.payRowLabel}>Payment Status</Text>
                <Text style={[styles.payRowValue, released && { color: colors.success }]}>
                  {isCancelled ? 'Refunded to sender' : paymentLabel}
                </Text>
              </View>

              {info.weightKg != null && (
                <View style={[styles.payRow, styles.payRowBorder]}>
                  <Text style={styles.payRowLabel}>Total Weight</Text>
                  <Text style={styles.payRowValue}>{info.weightKg} kg</Text>
                </View>
              )}

              {!!info.dims && (
                <View style={[styles.payRow, styles.payRowBorder]}>
                  <Text style={styles.payRowLabel}>Dimensions</Text>
                  <Text style={styles.payRowValue}>{info.dims}</Text>
                </View>
              )}

              {!!d.escrow?.payment_method && (
                <View style={[styles.payRow, styles.payRowBorder]}>
                  <Text style={styles.payRowLabel}>Sender Paid Via</Text>
                  <PaymentMethodBadge provider={d.escrow.payment_method} />
                </View>
              )}
            </View>

            {!isCancelled && info.baseFare > 0 && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Wallet" variant="duotone" size={18} />
                  <Text style={styles.dSecTitle}>Payment Breakdown</Text>
                </View>
                <View style={styles.payRowsCard}>
                  {([
                    ['Delivery fare', money(info.baseFare), undefined, false],
                    ['Platform fee (15%)', `-${money(info.platformFee)}`, colors.error, false],
                    ...(info.returnDeposit > 0
                      ? [[
                          info.isReturned ? 'Return deposit (kept for return trip)' : 'Return deposit (refunded to sender)',
                          info.isReturned ? `+${money(info.returnDeposit)}` : money(info.returnDeposit),
                          info.isReturned ? colors.success : colors.textMuted,
                          false,
                        ]]
                      : []),
                    [info.isReturned || !released ? 'Your earnings' : 'Net earnings', money(info.earnings), colors.success, true],
                    ['Sender paid in total', money(info.totalPaid), colors.textSecondary, false],
                  ] as [string, string, string | undefined, boolean][]).map(([label, value, color, bold], i) => (
                    <View key={label} style={[styles.payRow, i > 0 && styles.payRowBorder]}>
                      <Text style={styles.payRowLabel}>{label}</Text>
                      <Text
                        style={[
                          styles.payRowValue,
                          !!color && { color },
                          bold && { fontFamily: 'Poppins_700Bold' },
                        ]}
                      >
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {(!!(d.escrow?.bc_escrow_tx_hash) || !!(d.qr_verifications?.bc_pickup_tx_hash) || !!(d.qr_verifications?.bc_dropoff_tx_hash)) && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Link" variant="linear" size={18} color={colors.accent} />
                  <Text style={styles.dSecTitle}>Blockchain Record</Text>
                </View>
                <View style={styles.hashList}>
                {!!(d.escrow?.bc_escrow_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>ESCROW PAYMENT</Text>
                      <Text style={styles.hashValue}>{d.escrow?.bc_escrow_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('escrow', d.escrow?.bc_escrow_tx_hash)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'escrow' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                )}
                {!!(d.qr_verifications?.bc_pickup_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>PICKUP VERIFIED</Text>
                      <Text style={styles.hashValue}>{d.qr_verifications?.bc_pickup_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('pickup', d.qr_verifications?.bc_pickup_tx_hash)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'pickup' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                )}
                {!!(d.qr_verifications?.bc_dropoff_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>DROP-OFF VERIFIED</Text>
                      <Text style={styles.hashValue}>{d.qr_verifications?.bc_dropoff_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('dropoff', d.qr_verifications?.bc_dropoff_tx_hash)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'dropoff' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                )}
                </View>
              </>
            )}
          </Animated.View>
        </ScrollView>

        {active && (
          <View style={styles.dBar}>
            <TouchableOpacity style={[styles.mSoftBtn, { flex: 1 }]} onPress={() => openRoute(d)} activeOpacity={0.85}>
              <Ionicons name="navigate" size={18} color={colors.accent} />
              <Text style={styles.mSoftText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }, awaitingApproval && { opacity: 0.55 }]}
              disabled={awaitingApproval}
              onPress={() =>
                stage === 'pickup' || d.delivery_requests?.delivery_status === 'Returning'
                  ? openVerifyModal(d)
                  : openDeliveryOTPModal(d)
              }
              activeOpacity={0.9}
            >
              <Ionicons
                name={
                  awaitingApproval
                    ? 'time-outline'
                    : stage === 'pickup' || d.delivery_requests?.delivery_status === 'Returning'
                      ? 'qr-code-outline'
                      : 'checkmark-circle'
                }
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.mPrimaryText}>
                {awaitingApproval
                  ? 'Awaiting Sender Approval'
                  : d.delivery_requests?.delivery_status === 'Returning'
                    ? 'Verify Return QR'
                    : stage === 'pickup'
                      ? 'Verify Pickup'
                      : 'Complete'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderPickupPhotoStep = () => {
    const camBusy = pickupTakingPhoto || !pickupCameraReady;
    return !pickupPhotoUri ? (
      <>
        <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
          <TouchableOpacity style={styles.scannerCloseBtn} onPress={closeVerifyModal}>
            <SolarIcon name="CloseCircle" variant="linear" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
        <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, zIndex: 20, alignItems: 'center' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetHeading}>Take Pickup Photo</Text>
          <Text style={[styles.sheetSubheading, { textAlign: 'center' }]}>
            Code verified. Take a clear photo of the package as you collect it. The sender will see this photo.
          </Text>
          <TouchableOpacity
            style={[styles.mPrimaryBtn, { width: '100%', marginTop: 8 }, camBusy && { opacity: 0.6 }]}
            onPress={capturePickupPhoto}
            disabled={camBusy}
            activeOpacity={0.9}
          >
            {camBusy ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <SolarIcon name="Camera" variant="linear" size={20} color="#FFF" />
                <Text style={styles.mPrimaryText}>Capture Photo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </>
    ) : (
      <>
        <Image source={{ uri: pickupPhotoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
          <TouchableOpacity style={styles.scannerCloseBtn} onPress={closeVerifyModal} disabled={pickupSubmitting}>
            <SolarIcon name="CloseCircle" variant="linear" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>
        <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, zIndex: 20, alignItems: 'center' }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetHeading}>Use this photo?</Text>
          <Text style={[styles.sheetSubheading, { textAlign: 'center' }]}>
            Make sure the package is clearly visible. Pickup is confirmed once you tap Confirm.
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 }}>
            <TouchableOpacity
              style={{
                flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
                paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.accent,
                opacity: pickupSubmitting ? 0.5 : 1,
              }}
              onPress={() => { setPickupPhotoUri(null); setPickupCoords(null); setPickupTakenAt(''); }}
              disabled={pickupSubmitting}
              activeOpacity={0.85}
            >
              <SolarIcon name="Camera" variant="linear" size={18} color={colors.accent} />
              <Text style={{ color: colors.accent, fontSize: 14, fontFamily: 'Poppins_700Bold' }}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1 }, pickupSubmitting && { opacity: 0.7 }]}
              onPress={confirmPickupWithPhoto}
              disabled={pickupSubmitting}
              activeOpacity={0.9}
            >
              {pickupSubmitting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.mPrimaryText}>Confirm Pickup</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </>
    );
  };

  const renderScanStep = () => (
    <KeyboardAvoidingView
      style={{ flex: 1, justifyContent: 'space-between' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="none">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        <View style={{ flexDirection: 'row', height: frameSize }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
          <View style={{ width: frameSize, height: frameSize, overflow: 'hidden', position: 'relative' }}>
            <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        </View>
        <View style={{ flex: 2.2, backgroundColor: 'rgba(0,0,0,0.7)' }} />
      </View>

      <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
        <TouchableOpacity style={styles.scannerCloseBtn} onPress={closeVerifyModal}>
          <SolarIcon name="CloseCircle" variant="linear" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={[styles.scannerBottomSheetStatic, { paddingBottom: Math.max(insets.bottom, 16) + 12, zIndex: 20 }]}>
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
          <View style={styles.sheetHandle} />
          {(() => {
            const isReturning = verifyTarget?.delivery_requests?.delivery_status === 'Returning';
            return (
              <>
                <Text style={styles.sheetHeading}>
                  {isReturning ? 'Scan Return QR' : 'Scan Pickup QR'}
                </Text>
                <Text style={styles.sheetSubheading}>
                  {isReturning
                    ? "Point your camera at the Sender's screen to verify the return."
                    : "Point your camera at the Sender's screen to automatically verify pickup."}
                </Text>
              </>
            );
          })()}

          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>OR ENTER PIN</Text>
            <View style={styles.orLine} />
          </View>

          <View style={styles.pinRow}>
            <TextInput
              style={styles.pinInput}
              value={pinInput}
              onChangeText={(t) => setPinInput(t.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              placeholder="••••"
              placeholderTextColor={colors.textMuted}
              maxLength={4}
              returnKeyType="done"
              onSubmitEditing={handlePinVerify}
            />
            <TouchableOpacity
              style={[styles.pinBtn, (pinInput.length !== 4 || pinVerifying) && { opacity: 0.5 }]}
              disabled={pinInput.length !== 4 || pinVerifying}
              onPress={handlePinVerify}
              activeOpacity={0.9}
            >
              {pinVerifying ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={styles.pinBtnText}>Verify</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );

  const renderScannerModal = () => (
    <Modal visible={verifyModalVisible} animationType="slide" transparent={false} onRequestClose={closeVerifyModal}>
      <View style={styles.scannerRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        {cameraPermission?.granted && (
          <CameraView
            ref={pickupCameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            onCameraReady={() => setPickupCameraReady(true)}
            onMountError={(e: any) => console.warn('[Task] camera mount error:', e?.message)}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={!scanned && !pickupPending ? handleBarcodeScanned : undefined}
          />
        )}

        {pickupPending ? renderPickupPhotoStep() : renderScanStep()}
      </View>
    </Modal>
  );

  const renderMapModal = () => {
    if (!selectedTask) return null;
    const info = buildTaskInfo(selectedTask);
    return (
      <Modal visible={mapModalVisible} animationType="slide" onRequestClose={() => setMapModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {(() => {
            const st = stageOf(selectedTask);
            const t = st === 'pickup' ? info.pickup : info.dropoff;
            return (st === 'pickup' || st === 'transit') && t.lat != null && t.lng != null ? (
              <NavigationMap
                interactive
                showGuidance={false}
                target={{ latitude: t.lat, longitude: t.lng }}
                targetLabel={st === 'pickup' ? 'P' : 'D'}
                onInfo={setNavInfo}
                style={{ bottom: 150 + insets.bottom }}
                padTop={20} padBottom={30}
              />
            ) : (
              <RoutePreviewMap
                pickupLat={info.pickup.lat} pickupLng={info.pickup.lng}
                dropoffLat={info.dropoff.lat} dropoffLng={info.dropoff.lng}
                padTop={100} padBottom={260}
              />
            );
          })()}
          <TouchableOpacity style={[styles.mapCloseBtn, { top: insets.top + 12 }]} onPress={() => setMapModalVisible(false)} activeOpacity={0.85}>
            <SolarIcon name="ArrowLeft" variant="linear" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={[styles.mapSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.mapSheetRow}>
              <View style={styles.rtPickPin}><Ionicons name="cube" size={14} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rtLabel}>PICKUP</Text>
                <Text style={styles.rtMain} numberOfLines={1}>{info.pickup.main}</Text>
              </View>
            </View>
            <View style={styles.contactDivider} />
            <View style={styles.mapSheetRow}>
              <View style={styles.rtDropPin}><Ionicons name="person" size={16} color="#000000" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rtLabel}>DROP-OFF</Text>
                <Text style={styles.rtMain} numberOfLines={1}>{info.dropoff.main}</Text>
              </View>
            </View>
            {(() => {
              const st = stageOf(selectedTask);
              if (st !== 'pickup' && st !== 'transit') return null;
              return (
                <TouchableOpacity
                  style={[styles.mPrimaryBtn, { marginTop: 14 }]}
                  onPress={() => { setMapModalVisible(false); openRoute(selectedTask); }}
                  activeOpacity={0.9}
                >
                  <Ionicons name="navigate" size={18} color="#FFFFFF" />
                  <Text style={styles.mPrimaryText}>Open Route</Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      </Modal>
    );
  };

  const renderPhotoModal = () => (
    <Modal visible={!!photoPreview} transparent animationType="fade" onRequestClose={() => setPhotoPreview(null)}>
      <View style={styles.previewOverlay}>
        {!!photoPreview && <Image source={{ uri: photoPreview }} style={styles.previewImg} resizeMode="contain" />}
        <TouchableOpacity style={[styles.previewClose, { top: insets.top + 12 }]} onPress={() => setPhotoPreview(null)} activeOpacity={0.85}>
          <SolarIcon name="CloseCircle" variant="linear" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );

  const renderPkgModal = () => {
    const info = pkgInfo;
    const counts: Record<string, number> = { Small: 0, Medium: 0, Large: 0 };
    (info?.items || []).forEach((it: any) => { if (it?.size && counts[it.size] != null) counts[it.size] += 1; });
    if (!counts.Small && !counts.Medium && !counts.Large) {
      counts.Small = Number(info?.cargo?.small_box_qty) || 0;
      counts.Medium = Number(info?.cargo?.medium_box_qty) || 0;
      counts.Large = Number(info?.cargo?.large_box_qty) || 0;
    }
    const rows = (['Small', 'Medium', 'Large'] as const).filter(k => counts[k] > 0);
    return (
      <Modal visible={!!info} transparent animationType="fade" onRequestClose={() => setPkgInfo(null)}>
        <Pressable style={styles.pkgOverlay} onPress={() => setPkgInfo(null)}>
          <Pressable style={styles.pkgCard} onPress={() => { /* keep open */ }}>
            <View style={styles.pkgHead}>
              <Text style={styles.pkgTitle}>{info ? pkgCount(info) : ''} in this order</Text>
              <TouchableOpacity onPress={() => setPkgInfo(null)} hitSlop={10}>
                <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            {rows.length === 0 && <Text style={styles.pkgSub}>No size details were provided for this order.</Text>}
            {rows.map(k => (
              <View key={k} style={styles.pkgRow}>
                <View style={[styles.sizeBadge, { backgroundColor: SIZE_META[k].bg }]}>
                  <Text style={[styles.sizeBadgeText, { color: SIZE_META[k].color }]}>{SIZE_META[k].letter}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pkgName}>{k}</Text>
                  <Text style={styles.pkgSub}>{SIZE_META[k].kg}</Text>
                </View>
                <Text style={styles.pkgQty}>×{counts[k]}</Text>
              </View>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderDeliveryOTPModal = () => {
    const targetInfo = deliveryOTPTarget ? buildTaskInfo(deliveryOTPTarget) : null;
    const code = deliveryOTPTarget
      ? trackingCode(deliveryOTPTarget.delivery_requests?.request_id ?? deliveryOTPTarget.delivery_id)
      : '';

    return (
      <Modal visible={deliveryOTPModalVisible} transparent animationType="slide" onRequestClose={closeDeliveryOTPModal}>
        {podCameraOpen ? (
          <View style={styles.scannerRoot}>
            <StatusBar barStyle="light-content" backgroundColor="#000" />
            <CameraView ref={podCameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
              <TouchableOpacity style={styles.scannerCloseBtn} onPress={() => setPodCameraOpen(false)}>
                <SolarIcon name="CloseCircle" variant="linear" size={24} color="#FFF" />
              </TouchableOpacity>
            </View>
            <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, zIndex: 20, alignItems: 'center' }]}>
              <View style={styles.sheetHandle} />
              <Text style={styles.sheetHeading}>Take Proof of Delivery</Text>
              <Text style={[styles.sheetSubheading, { textAlign: 'center' }]}>
                Capture a clear photo of the package at the drop-off location or with the receiver.
              </Text>
              <TouchableOpacity
                style={[styles.mPrimaryBtn, { width: '100%', marginTop: 8 }]}
                onPress={capturePodPhoto}
                disabled={podTakingPhoto}
                activeOpacity={0.9}
              >
                {podTakingPhoto ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <SolarIcon name="Camera" variant="linear" size={20} color="#FFF" />
                    <Text style={styles.mPrimaryText}>Capture Photo</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.otpModalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.otpModalCard}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bounces={false}
              >
                <View style={styles.otpModalHeader}>
                  <View style={styles.otpModalIconBox}>
                    <SolarIcon name="ShieldCheck" variant="duotone" size={24} color={colors.success} />
                  </View>
                  <TouchableOpacity onPress={closeDeliveryOTPModal} style={styles.otpCloseBtn} hitSlop={8}>
                    <SolarIcon name="CloseCircle" variant="linear" size={24} color={colors.textPrimary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.otpModalTitle}>Confirm Delivery</Text>
                <Text style={styles.otpModalSubtitle}>
                  Complete both steps below to finish the handover and release your payout.
                </Text>

                {targetInfo && (
                  <View style={styles.otpSummaryStrip}>
                    <View>
                      <Text style={styles.otpSummaryCode}>#{code}</Text>
                      <Text style={styles.otpSummaryRcvr} numberOfLines={1}>
                        To: {targetInfo.receiverName || 'Receiver'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.otpSummaryPayLabel}>Payout</Text>
                      <Text style={styles.otpSummaryPayValue}>{money(targetInfo.earnings)}</Text>
                    </View>
                  </View>
                )}

                <View style={styles.otpStepHeaderRow}>
                  <View style={[styles.otpStepBadge, podPhotoUri && styles.otpStepBadgeDone]}>
                    <Text style={styles.otpStepBadgeText}>{podPhotoUri ? '✓' : '1'}</Text>
                  </View>
                  <Text style={styles.otpStepTitle}>Proof of Delivery Photo</Text>
                </View>

                {podPhotoUri ? (
                  <View style={styles.podPreviewBox}>
                    <Image source={{ uri: podPhotoUri }} style={styles.podPreviewImage} resizeMode="cover" />
                    <TouchableOpacity style={styles.podRetakePill} onPress={openPodCamera} activeOpacity={0.85}>
                      <SolarIcon name="Camera" variant="linear" size={14} color="#FFF" />
                      <Text style={styles.podRetakeText}>Retake Photo</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.podUploadDashedBtn}
                    onPress={openPodCamera}
                    activeOpacity={0.85}
                  >
                    <SolarIcon name="Camera" variant="linear" size={20} color={colors.accent} />
                    <Text style={styles.podUploadDashedText}>Take Proof of Delivery Photo</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.otpStepHeaderRow}>
                  <View style={[styles.otpStepBadge, deliveryOTPInput.length === 6 && styles.otpStepBadgeDone]}>
                    <Text style={styles.otpStepBadgeText}>{deliveryOTPInput.length === 6 ? '✓' : '2'}</Text>
                  </View>
                  <Text style={styles.otpStepTitle}>Receiver's 6-Digit OTP</Text>
                </View>

                <View style={styles.otpInputContainer}>
                  <TextInput
                    style={styles.otpInput}
                    value={deliveryOTPInput}
                    onChangeText={(t) => setDeliveryOTPInput(t.replace(/[^0-9]/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    placeholder="000000"
                    placeholderTextColor={colors.textMuted}
                    maxLength={6}
                    returnKeyType="done"
                  />
                </View>

                {!!deliveryOTPTarget?.escrow?.payment_method && (
                  <View style={styles.otpPayoutRow}>
                    <Text style={styles.otpPayoutLabel}>Sender paid via</Text>
                    <PaymentMethodBadge provider={deliveryOTPTarget.escrow.payment_method} size={18} />
                  </View>
                )}

                <View style={styles.otpActionRow}>
                  <TouchableOpacity
                    style={styles.otpCancelBtn}
                    onPress={closeDeliveryOTPModal}
                    disabled={deliveryOTPVerifying}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.otpCancelBtnText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.otpVerifyButton,
                      (deliveryOTPInput.length !== 6 || !podPhotoUri || deliveryOTPVerifying) && styles.otpVerifyButtonDisabled,
                    ]}
                    disabled={deliveryOTPInput.length !== 6 || !podPhotoUri || deliveryOTPVerifying}
                    onPress={completeDelivery}
                    activeOpacity={0.9}
                  >
                    {deliveryOTPVerifying ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <>
                        <SolarIcon name="CheckCircle" variant="linear" size={18} color="#FFF" />
                        <Text style={styles.otpVerifyButtonText}>Complete Delivery</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        )}
      </Modal>
    );
  };

  const navSessionId = useNavigationSession();
  const broadcastingDelivery = useMemo(() => {
    const inTransit = activeDeliveries.find((d: any) => stageOf(d) === 'transit' && !isAwaitingApproval(d));
    if (inTransit) return inTransit;
    if (navSessionId == null) return null;
    return activeDeliveries.find((d: any) => d.delivery_id === navSessionId && stageOf(d) === 'pickup') ?? null;
  }, [activeDeliveries, navSessionId]);

  const broadcastIdRef = useRef<number | null>(null);
  const pickupBroadcastRef = useRef<number | null>(null);
  useEffect(() => {
    broadcastIdRef.current = broadcastingDelivery?.delivery_id ?? null;
    const cur = broadcastingDelivery && stageOf(broadcastingDelivery) === 'pickup' ? broadcastingDelivery.delivery_id : null;
    const prev = pickupBroadcastRef.current;
    pickupBroadcastRef.current = cur;
    if (prev == null || prev === cur) return;
    const d = activeDeliveries.find((x: any) => x.delivery_id === prev);
    if (!d || stageOf(d) !== 'pickup') return;
    setTimeout(() => {
      if (broadcastIdRef.current !== prev) clearLocationFix(prev).catch(() => {});
    }, 1500);
  }, [broadcastingDelivery, activeDeliveries]);

  useProviderLocationBroadcast({
    deliveryId: broadcastingDelivery?.delivery_id ?? null,
    providerId,
    active: !!broadcastingDelivery && !!providerId,
  });

  const renderGracePeriodModal = () => {
    if (!graceDelivery) return null;
    const info = buildTaskInfo(graceDelivery);
    const req = graceDelivery.delivery_requests || {};
    const fallbackAction = req.fallback_action || 'return_to_sender';
    const fallbackRecipient = req.fallback_recipient_name || 'Guard / Reception';
    const mins = String(Math.floor(graceRemainingSec / 60)).padStart(2, '0');
    const secs = String(graceRemainingSec % 60).padStart(2, '0');
    const anyContacted = contactLogs.call || contactLogs.sms || contactLogs.chat;
    const isLeaveWithGuard = fallbackAction === 'leave_with_guard';
    const canMarkUnavailable = isLeaveWithGuard ? true : (graceRemainingSec === 0 && anyContacted);

    return (
      <Modal visible={graceModalVisible} animationType="slide" transparent onRequestClose={() => setGraceModalVisible(false)}>
        {failureCameraOpen ? (
          <View style={styles.scannerRoot}>
            <CameraView ref={failureCameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <View
              style={{
                position: 'absolute',
                top: insets.top + 64,
                left: 16,
                right: 16,
                backgroundColor: 'rgba(0,0,0,0.72)',
                padding: 12,
                borderRadius: 12,
                borderLeftWidth: 4,
                borderLeftColor: ORANGE,
              }}
            >
              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '900' }}>
                PACK-N-SHIP LIVE PROOF • #{trackingCode(req.request_id ?? graceDelivery.delivery_id)}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 11, marginTop: 2 }}>
                TIMESTAMP: {new Date().toLocaleString()}
              </Text>
              <Text style={{ color: '#D1D5DB', fontSize: 11 }}>
                FALLBACK: {isLeaveWithGuard ? `Leave with ${fallbackRecipient}` : 'Return to Sender'}
              </Text>
            </View>

            <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, alignItems: 'center' }]}>
              <Text style={styles.sheetHeading}>Capture Live Location & Package Proof</Text>
              <Text style={[styles.sheetSubheading, { textAlign: 'center' }]}>
                Gallery uploads are disabled. Capture the package clearly at the drop-off location or with {fallbackRecipient}.
              </Text>
              <TouchableOpacity style={[styles.mPrimaryBtn, { width: '100%' }]} onPress={captureFailureProofPhoto}>
                <Ionicons name="camera" size={20} color="#FFF" />
                <Text style={styles.mPrimaryText}>Take Stamped Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.otpModalOverlay}>
            <View style={[styles.otpModalCard, { maxWidth: 400 }]}>
              <View style={styles.otpModalHeader}>
                <View style={[styles.otpModalIconBox, { backgroundColor: isLeaveWithGuard ? colors.successBg : colors.warningBg }]}>
                  <Ionicons
                    name={isLeaveWithGuard ? 'shield-checkmark-outline' : 'timer-outline'}
                    size={24}
                    color={isLeaveWithGuard ? colors.success : ORANGE}
                  />
                </View>
                <TouchableOpacity onPress={() => setGraceModalVisible(false)}>
                  <Ionicons name="close" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.otpModalTitle}>
                {isLeaveWithGuard ? 'Safe Drop-off Authorized' : '10-Minute Drop-off Grace Period'}
              </Text>
              <Text style={styles.otpModalSubtitle}>
                {isLeaveWithGuard
                  ? `The sender pre-authorized leaving this package with "${fallbackRecipient}" if the receiver is unavailable.`
                  : 'Contact the receiver or sender below. If the receiver arrives, close this modal and tap "Complete".'}
              </Text>

              {isLeaveWithGuard ? (
                <View style={{ alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, backgroundColor: colors.successBg, borderRadius: 16, marginBottom: 14 }}>
                  <Text style={{ fontSize: 13, fontWeight: '900', color: colors.success, textAlign: 'center' }}>
                    ✓ NO 10-MINUTE WAIT REQUIRED
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 4, textAlign: 'center' }}>
                    Hand the package to {fallbackRecipient} and take a live stamped photo below to complete the delivery.
                  </Text>
                </View>
              ) : (
                <View style={{ alignItems: 'center', paddingVertical: 14, backgroundColor: colors.background, borderRadius: 16, marginBottom: 14 }}>
                  <Text style={{ fontSize: 34, fontWeight: '900', color: graceRemainingSec === 0 ? colors.error : ORANGE }}>
                    {mins}:{secs}
                  </Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 4 }}>
                    {graceRemainingSec > 0 ? 'WAITING FOR RECEIVER AT DROP-OFF PIN' : 'GRACE PERIOD EXPIRED — FALLBACK UNLOCKED'}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <TouchableOpacity
                  style={[styles.mSoftBtn, contactLogs.call && { borderColor: colors.success, borderWidth: 1.5 }]}
                  onPress={() => logProviderContactAttempt('call')}
                >
                  <Ionicons name="call" size={15} color={contactLogs.call ? colors.success : ORANGE} />
                  <Text style={[styles.mSoftText, contactLogs.call && { color: colors.success }]}>Call Rcvr</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mSoftBtn, contactLogs.sms && { borderColor: colors.success, borderWidth: 1.5 }]}
                  onPress={() => logProviderContactAttempt('sms')}
                >
                  <Ionicons name="chatbox-ellipses" size={15} color={contactLogs.sms ? colors.success : ORANGE} />
                  <Text style={[styles.mSoftText, contactLogs.sms && { color: colors.success }]}>SMS Rcvr</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.mSoftBtn, contactLogs.chat && { borderColor: colors.success, borderWidth: 1.5 }]}
                  onPress={() => logProviderContactAttempt('chat')}
                >
                  <Ionicons name="person" size={15} color={contactLogs.chat ? colors.success : ORANGE} />
                  <Text style={[styles.mSoftText, contactLogs.chat && { color: colors.success }]}>Msg Sender</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.otpInfoBox}>
                <Ionicons name="shield-checkmark-outline" size={18} color={ORANGE} />
                <Text style={styles.otpInfoText}>
                  {isLeaveWithGuard
                    ? `Sender Pre-Authorized Option B: Leave package with "${fallbackRecipient}" and take a live photo.`
                    : `Sender Pre-Authorized Option A: Return package to "${info.pickup.main}". You will earn the full fare + return deposit.`}
                </Text>
              </View>

              {failurePhotoUri ? (
                <View style={{ marginBottom: 12, borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                  <Image source={{ uri: failurePhotoUri }} style={{ width: '100%', height: 130 }} resizeMode="cover" />
                  <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.65)', padding: 6 }}>
                    <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>
                      GPS: {failureCoords?.lat.toFixed(5)}, {failureCoords?.lng.toFixed(5)} • {failureTimestamp}
                    </Text>
                  </View>
                </View>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.mSoftBtn,
                    { flex: 0, marginBottom: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: ORANGE },
                    !canMarkUnavailable && { opacity: 0.45 },
                  ]}
                  disabled={!canMarkUnavailable}
                  onPress={() => setFailureCameraOpen(true)}
                >
                  <Ionicons name="camera" size={18} color={ORANGE} />
                  <Text style={styles.mSoftText}>
                    {canMarkUnavailable ? 'Open Live Camera for Proof' : 'Wait 10m & Tap 1 Contact Button First'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.otpVerifyButton,
                  { backgroundColor: isLeaveWithGuard ? colors.success : RED, flex: 0, width: '100%' },
                  (!canMarkUnavailable || !failurePhotoUri || submittingFailure) && styles.otpVerifyButtonDisabled,
                ]}
                disabled={!canMarkUnavailable || !failurePhotoUri || submittingFailure}
                onPress={executeFallbackProtocol}
              >
                {submittingFailure ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <>
                    <Ionicons name={isLeaveWithGuard ? 'checkmark-circle' : 'alert-circle'} size={18} color="#FFF" />
                    <Text style={styles.otpVerifyButtonText}>
                      {isLeaveWithGuard
                        ? `Confirm Left with ${fallbackRecipient}`
                        : 'Confirm Unavailable & Return to Sender'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    );
  };

  if (loading) {
    return (
      <View style={[styles.safeArea, styles.loadingContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading tasks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {selectedTask ? renderDetailView(selectedTask) : renderListView()}

      {renderRoutePickerModal()}
      {renderScannerModal()}
      {renderMapModal()}
      {renderPhotoModal()}
      {renderPkgModal()}
      {renderDeliveryOTPModal()}
      {renderGracePeriodModal()}
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },

  headerSection: {
    paddingHorizontal: 24, paddingBottom: 16,
    backgroundColor: c.background,
    borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  pageTitle: {
    fontSize: 26,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    letterSpacing: -0.3,
  },

  routeFilterWrap: { marginTop: 12 },
  routeFilterCard: {
    borderRadius: 14,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    padding: 12,
    gap: 10,
  },
  routeFilterCardActive: {
    borderColor: c.accent,
  },
  routeFilterTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeFilterIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: c.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeFilterEyebrow: {
    fontSize: 9.5,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 0.7,
    color: c.accent,
  },
  routeFilterTitle: {
    fontSize: 14,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    marginTop: 1,
  },
  routeFilterSub: {
    fontSize: 11,
    fontFamily: 'Poppins_500Medium',
    color: c.textSecondary,
    marginTop: 1,
  },
  routeChangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  routeChangePillText: {
    fontSize: 11.5,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textPrimary,
  },
  routeSegmentBar: {
    flexDirection: 'row',
    backgroundColor: c.background,
    borderRadius: 10,
    padding: 3,
    gap: 4,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  },
  routeSegmentBtn: {
    flex: 1,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routeSegmentBtnActive: {
    backgroundColor: c.accent,
  },
  routeSegmentText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textSecondary,
  },
  routeSegmentTextActive: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_700Bold',
  },
  routeHiddenHint: {
    fontSize: 9.5,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textSecondary,
  },
  routeScopeToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: c.accent,
  },
  routeScopeToggleAll: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
  },
  routeScopeToggleText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  routeScopeToggleTextAll: {
    color: c.textSecondary,
  },
  routeSwapBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  routeModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  routePickerSheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  routePickerHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  routePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  routePickerTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  routePickerEmpty: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  routePickerEmptyTitle: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 8 },
  routePickerEmptySub: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  emptyManageRouteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    marginTop: 6,
  },
  emptyManageRouteText: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.accent },
  routeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: c.background,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  routeOptionSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
  routeOptionDot: { width: 10, height: 10, borderRadius: 5 },
  routeOptionTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  routeOptionSub: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 2 },

  tabBarScroll: { gap: 8, paddingTop: 16 },
  tabItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', gap: 6,
  },
  tabItemActive: { backgroundColor: c.accentSoft, borderColor: c.accent, borderWidth: 1.5 },
  tabText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  tabTextActive: { color: c.accent, fontFamily: 'Poppins_700Bold' },
  tabCountBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.divider, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  tabCountBadgeActive: { backgroundColor: 'rgba(242,112,36,0.18)' },
  tabCountText: { fontSize: 11, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  tabCountTextActive: { color: c.accent },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 80 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  emptySubtext: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  svcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  svcPillText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: BLUE },
  stPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  stDot: { width: 7, height: 7, borderRadius: 4 },
  stPillText: { fontSize: 11, fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 },

  scheduledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    marginBottom: 14,
  },
  scheduledBannerText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: c.accent,
  },

  rtRow: { flexDirection: 'row', gap: 14 },
  rtRail: { alignItems: 'center', width: 32 },
  rtPickPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: BRAND_ORANGE,
    borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  rtDropPin: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2, shadowRadius: 3, elevation: 3,
  },
  rtLine: { position: 'absolute', top: 36, bottom: -4, width: 2, borderRadius: 1, backgroundColor: c.border },
  rtText: { flex: 1 },
  rtLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  rtMain: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: 0, marginTop: 2 },
  rtSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  sdNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: c.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  sdNoteText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_500Medium', lineHeight: 17, color: c.textPrimary },

  cardPodBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: c.successBg,
    borderWidth: 1,
    borderColor: c.success,
  },
  cardPodThumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: c.card },
  cardPodTitle: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.success },
  cardPodSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },

  oCard: {
    backgroundColor: c.card, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.2 : 0.04, shadowRadius: 8, elevation: isDark ? 0 : 1,
  },
  oPad: { padding: 20 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },

  oContactsRow: { flexDirection: 'column', gap: 12, marginTop: 16 },
  mcRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mcAvatarSmall: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mcAvatarTextSmall: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Poppins_700Bold' },
  mcRoleSmall: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.4 },
  mcNameSmall: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  mcSubBadgeSmall: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: BLUE, marginTop: 1 },
  mcCallSmall: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  mCancelledText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.error, marginTop: 12 },

  oFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    backgroundColor: c.background, paddingHorizontal: 20, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },
  oPayLabel: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  oPrice: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2, flexShrink: 0 },
  oActions: { flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
  oRouteBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, borderRadius: 24, height: 48 },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },

  /* Detail view */
  dHeaderBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  dHeaderTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  dRoundBtnInline: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  dSheetBody: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 },
  dCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dCode: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.4 },
  dWhen: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent, marginTop: 4 },
  trackTextCopy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trackTextCopyLabel: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent },

  stepper: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 8, marginTop: 16, marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  stepCol: { flex: 1, alignItems: 'center' },
  stepLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  stepLine: { flex: 1, height: 3, backgroundColor: c.divider },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.divider, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: c.accent, borderColor: c.accent },
  stepDotCurrent: { borderColor: c.accent },
  stepDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
  stepLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: c.textMuted, marginTop: 8, textAlign: 'center' },
  stepLabelOn: { color: c.textPrimary },

  cancelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
    borderRadius: 12, padding: 16, marginBottom: 16,
  },
  cancelBannerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  cancelBannerTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.error },
  cancelBannerSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2, lineHeight: 18 },

  doneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: c.successBg,
    borderWidth: 1, borderColor: c.success, borderRadius: 12, padding: 16, marginBottom: 16,
  },
  doneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.success },
  doneSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2, lineHeight: 18 },

  dHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: c.accentSoft, borderRadius: 12, padding: 14, marginTop: 4 },
  dHintText: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, color: c.textPrimary },

  dSecHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 14 },
  dSecTitle: { flex: 1, fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },

  /* Sender & Receiver Card Containers */
  senderSectionCard: {
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    padding: 16,
  },
  senderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  senderPhoneSub: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: c.textSecondary,
    marginTop: 1,
  },
  senderChatPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.accent,
  },
  senderChatPillText: {
    fontSize: 13,
    fontFamily: 'Poppins_700Bold',
    color: c.accent,
  },
  receiverCallPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(139,92,246,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.35)',
  },
  receiverCallPillText: {
    fontSize: 13,
    fontFamily: 'Poppins_700Bold',
    color: PURPLE,
  },
  podPhotoCard: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: c.background,
    borderWidth: 1.5,
    borderColor: c.success,
  },
  podPhotoImg: { width: '100%', height: '100%' },
  podPhotoOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(17,24,39,0.72)',
  },
  podPhotoBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  podPhotoBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  podPhotoTime: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: 'Poppins_500Medium' },

  dItemText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 18, marginTop: 2 },
  dItemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: 12 },
  dItemTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  dItemPhotoWrap: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: c.divider },
  dItemPhoto: { width: '100%', height: '100%' },
  dItemPhotoTag: { position: 'absolute', right: 4, bottom: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  dItemPhotoTagText: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold' },
  dItemPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  dItemPhotoEmptyText: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },

  payRowsCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  payRowBorder: {
    borderTopWidth: 1,
    borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  payRowLabel: {
    fontSize: 13,
    fontFamily: 'Poppins_500Medium',
    color: c.textSecondary,
  },
  payRowValue: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textPrimary,
    textAlign: 'right',
  },

  hashList: { gap: 10 },
  hashRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 10 },
  hashLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  hashValue: { fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 4 },
  hashCopyBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },

  sdRatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sdRatedBadgeText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.accent },

  dBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  mPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, paddingVertical: 14, borderRadius: 12 },
  mPrimaryText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },
  mSoftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentSoft, paddingVertical: 14, borderRadius: 12 },
  mSoftText: { color: c.accent, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },

  contactDivider: { height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginVertical: 16 },
  mapCloseBtn: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  mapSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.04, shadowRadius: 12, elevation: 1,
    borderTopWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  mapSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  sizeBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  pkgOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  pkgCard: { backgroundColor: c.card, borderRadius: 24, padding: 24 },
  pkgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  pkgTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  pkgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.divider },
  pkgName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  pkgSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  pkgQty: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },

  scannerRoot: { flex: 1, backgroundColor: '#000' },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: c.accent, shadowColor: c.accent, shadowOpacity: 1, shadowRadius: 8 },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },
  scannerTopBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  scannerCloseBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  scannerBottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 12,
  },
  scannerBottomSheetStatic: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: c.border, marginBottom: 14,
  },
  sheetHeading: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 4 },
  sheetSubheading: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginBottom: 12, lineHeight: 18 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 1.2 },
  pinRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  pinInput: {
    flex: 1, borderWidth: 1.5, borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 20, letterSpacing: 6,
    color: c.textPrimary, fontFamily: 'Poppins_700Bold', textAlign: 'center', backgroundColor: c.background,
  },
  pinBtn: {
    backgroundColor: c.accent, paddingHorizontal: 24, justifyContent: 'center',
    borderRadius: 12, alignItems: 'center', minWidth: 104,
  },
  pinBtnText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 14 },

  /* Confirm Delivery Modal */
  otpModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center', padding: 18,
  },
  otpModalCard: {
    width: '100%', maxWidth: 400, maxHeight: '90%',
    backgroundColor: c.card, borderRadius: 24, padding: 22,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25, shadowRadius: 20, elevation: 10,
  },
  otpModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  otpModalIconBox: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: c.successBg,
    justifyContent: 'center', alignItems: 'center',
  },
  otpCloseBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.background, alignItems: 'center', justifyContent: 'center',
  },
  otpModalTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 4, letterSpacing: -0.3 },
  otpModalSubtitle: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 18, marginBottom: 14 },

  otpSummaryStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.background, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    marginBottom: 16,
  },
  otpSummaryCode: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  otpSummaryRcvr: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1, maxWidth: 190 },
  otpSummaryPayLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: c.textMuted, textTransform: 'uppercase' },
  otpSummaryPayValue: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.success },

  otpStepHeaderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  otpStepBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
  },
  otpStepBadgeDone: {
    backgroundColor: c.success,
  },
  otpStepBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_700Bold' },
  otpStepTitle: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary },

  podPreviewBox: {
    marginBottom: 16, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1.5, borderColor: c.success, height: 140,
  },
  podPreviewImage: { width: '100%', height: '100%' },
  podRetakePill: {
    position: 'absolute', bottom: 8, right: 8,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,0,0,0.75)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
  },
  podRetakeText: { color: '#FFF', fontSize: 12, fontFamily: 'Poppins_700Bold' },

  podUploadDashedBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.accent,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 15, marginBottom: 16,
  },
  podUploadDashedText: { color: c.accent, fontSize: 13, fontFamily: 'Poppins_700Bold' },

  otpInputContainer: { marginBottom: 14 },
  otpInput: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 26, letterSpacing: 10, color: c.textPrimary,
    fontFamily: 'Poppins_700Bold', textAlign: 'center', backgroundColor: c.background,
  },
  otpInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.divider, paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: 12, marginBottom: 16,
  },
  otpInfoText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
  otpPayoutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.background, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  otpPayoutLabel: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },

  otpActionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2,
  },
  otpCancelBtn: {
    flex: 0.85, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.background, borderRadius: 14, paddingVertical: 15,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  },
  otpCancelBtnText: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_700Bold' },
  otpVerifyButton: {
    flex: 1.45, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, borderRadius: 14,
    paddingVertical: 15, gap: 8,
  },
  otpVerifyButtonDisabled: { backgroundColor: c.textMuted, opacity: 0.65 },
  otpVerifyButtonText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
});