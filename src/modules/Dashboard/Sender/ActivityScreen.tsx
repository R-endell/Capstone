// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing, Modal,
  BackHandler, StatusBar, Platform, Linking, Image, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Notifications from 'expo-notifications';
import RoutePreviewMap from '../../../components/map/RoutePreviewMap';
import { supabase } from '../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { notifyUser } from '../../../services/pushService';
import { formatDateTime } from '../../../utils/dateUtils';

const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.jpeg');

const ORANGE = '#FF751F';
const BLUE = '#3B82F6';
const PURPLE = '#8B5CF6';
const BLACK = '#111827';
const CARGO_PHOTO_BUCKET = 'cargo-photos';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const RATING_TAGS = ['On time', 'Careful handling', 'Friendly', 'Fast delivery', 'Good communication'];
const FINDING_PROVIDER_ROUTE_NAMES = ['Booking', 'BookingScreen', 'FindingProvider'];

const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const money = (n: any) => `₱${Number(n || 0).toFixed(2)}`;
const trackingCode = (id: any) => `PNS-${String(id).padStart(4, '0')}`;
const serviceLabel = (t?: string | null) => (/door/i.test(String(t || '')) ? 'Door-to-Door' : 'Curb-side');

const findRouteOwner = (nav: any, names: string[]): { owner: any; name: string } | null => {
  let current = nav;
  while (current) {
    try {
      const routeNames: string[] = current.getState?.()?.routeNames || [];
      const match = names.find(n => routeNames.includes(n));
      if (match) return { owner: current, name: match };
    } catch { /* ignore */ }
    current = current.getParent?.();
  }
  return null;
};

/* ==================================================================== */
/* Payment method badge                                                 */
/* ==================================================================== */
const PaymentMethodBadge = ({ provider, size = 20 }: { provider?: string | null; size?: number }) => {
  if (!provider) return null;
  const p = String(provider).toLowerCase();
  const isGcash = p.includes('gcash');
  const isMaya = p.includes('maya');
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
      <Text style={{ fontSize: 12, fontWeight: '800', color: tint }}>{label}</Text>
    </View>
  );
};

/* ==================================================================== */
/* Local notification helper — cancellation / refund confirmation      */
/* ==================================================================== */
const fireCancelNotification = async (opts: {
  requestId: number;
  amount?: number | null;
  refunded: boolean;
  refundFailed?: boolean;
}) => {
  const { requestId, amount, refunded, refundFailed } = opts;
  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;

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
        title: '❌ Booking Cancelled',
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
    console.warn('[ActivityScreen] local cancel notif failed:', err);
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
    console.warn('[ActivityScreen] provider cancel push failed:', err);
  }
};

/* ==================================================================== */
/* Cargo & Formatting Helpers                                          */
/* ==================================================================== */
interface CargoItem {
  name: string;
  type: string | null;
  quantity: number;
  weight: string | null;
  notes: string | null;
  photos: string[];
  hidePhotoSlot?: boolean;
  size?: string | null;
  fragile?: boolean;
  perItem?: boolean;
}

const resolvePhotoUrls = (c: any): string[] => {
  const raw = [
    c?.photo_urls, c?.photos, c?.images, c?.photo_url, c?.image_url,
    c?.cargo_pic, c?.photo, c?.image, c?.cargo_photo, c?.cargo_photo_url, c?.item_photo,
  ].filter(v => v != null && v !== '');

  const flat: string[] = [];
  raw.forEach((v: any) => {
    let val = v;
    if (typeof val === 'string' && val.trim().startsWith('[')) {
      try { val = JSON.parse(val); } catch { /* keep as string */ }
    }
    if (Array.isArray(val)) val.forEach((x: any) => typeof x === 'string' && flat.push(x));
    else if (typeof val === 'string') flat.push(val);
  });

  const urls = flat.map(p => {
    if (/^(https?:|file:|data:)/i.test(p)) return p;
    try {
      return supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(p.replace(/^\/+/, '')).data.publicUrl;
    } catch { return ''; }
  }).filter(Boolean);

  return Array.from(new Set(urls));
};

const normalizeCargoItems = (cargo: any, fallbackName: string): CargoItem[] => {
  const list: any[] = Array.isArray(cargo) ? cargo : cargo ? [cargo] : [];
  if (list.length === 0) {
    return [{ name: fallbackName, type: null, quantity: 1, weight: null, notes: null, photos: [] }];
  }
  const perItem: CargoItem[] = list.flatMap((c: any) => {
    let arr: any = c?.items_json;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { arr = null; } }
    if (!Array.isArray(arr)) return [];
    return arr.map((it: any): CargoItem => ({
      name: it?.description || `${it?.size || 'Standard'} package`,
      type: null,
      quantity: 1,
      weight: null,
      notes: null,
      photos: resolvePhotoUrls({ photo_url: it?.photo }),
      size: it?.size ?? null,
      fragile: !!it?.fragile,
      perItem: true,
    }));
  });
  if (perItem.length > 0) return perItem;

  const sized: CargoItem[] = list.flatMap((c: any) => {
    const sizes: [string, any][] = [
      ['Small', c?.small_box_qty], ['Medium', c?.medium_box_qty], ['Large', c?.large_box_qty],
    ];
    const photos = resolvePhotoUrls(c);
    return sizes
      .filter(([, q]) => Number(q) > 0)
      .map(([label, q], idx) => ({
        name: `${label} package`,
        type: null,
        quantity: Number(q),
        weight: null,
        notes: null,
        photos: idx === 0 ? photos : [],
        hidePhotoSlot: idx !== 0,
        size: label,
        fragile: !!c?.is_fragile,
      }));
  });
  if (sized.length > 0) return sized;

  return list.map((c: any) => {
    const qty = Number(c?.quantity ?? c?.item_quantity ?? c?.qty ?? 1);
    const w = c?.weight_kg ?? c?.total_weight_kg ?? c?.weight ?? c?.estimated_weight ?? null;
    return {
      name: c?.item_name || c?.description || c?.cargo_type || fallbackName,
      type: c?.cargo_type && c?.cargo_type !== c?.item_name ? String(c.cargo_type) : null,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      weight: w != null && w !== '' ? String(w) : null,
      notes: c?.description || c?.notes || c?.special_instructions || null,
      photos: resolvePhotoUrls(c),
      fragile: !!c?.is_fragile,
    };
  });
};

const formatDateTimeShort = (iso?: string | null): string => {
  if (!iso) return '';
  let raw = String(iso);
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
    raw = raw.replace(' ', 'T') + 'Z';
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';

  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  return `${month} ${day}, ${year} · ${hours}:${minutes} ${ampm}`;
};

interface DeliveryRequest {
  request_id: number;
  pickup_type: string;
  delivery_status: string;
  scheduled_time: string | null;
  estimated_cost: number;
  created_at: string;
  sender_id: number;
  cargo_id: number;
  pickup_location_id: number;
  dropoff_location_id: number;
  rate_id: number;
  receiver_id: number | null;
  receiver_phone: string | null;
  pickup_note?: string | null;
  dropoff_note?: string | null;
  payment_provider?: string | null;
  payment_status?: string | null;
  escrow_status?: string | null;
  refund_status?: string | null;
  cargo_profiles: any;
  pickup_location: any;
  dropoff_location: any;
  receiver?: any;
}

interface Delivery {
  delivery_id: number;
  estimated_eta: string | null;
  completed_at: string | null;
  request_id: number;
  provider_id: number;
  route_id: number;
  vehicle_id: number;
  accepted_at: string;
  provider?: any;
  vehicle?: any;
}

interface QrRow {
  pickup_qr: string;
  pickup_pin: string;
  pickup_verified: boolean;
  dropoff_qr: string;
  dropoff_pin: string;
  dropoff_verified: boolean;
}

interface ReceiverInfo {
  receiver_id?: number | null;
  receiver_name?: string | null;
  receiver_phone?: string;
  receiver_email?: string | null;
  is_favorite?: boolean;
}

interface DeliveryConfirmation {
  confirmation_id: number;
  delivery_id: number;
  contiguity_otp_id?: string | null;
  system_otp?: string | null;
  otp_expires_at: string;
  otp_verified: boolean;
  otp_verified_at: string | null;
  attempts: number;
}

interface MappedDelivery {
  request_id: number;
  pickup_type: string;
  cargo_name: string;
  date: string;
  time: string;
  pickup_main: string;
  pickup_sub: string;
  pickup_road: string;
  dropoff_main: string;
  dropoff_sub: string;
  dropoff_road: string;
  pickup_note: string | null;
  dropoff_note: string | null;
  status: string;
  status_time: string;
  provider_name: string;
  provider_id?: number;
  provider_phone?: string | null;
  cargo_items: CargoItem[];
  total_items: number;
  weight_kg: number | null;
  fragile: boolean;
  dims: string | null;
  price: string;
  payment_method: string | null;
  coords: {
    pickup: { latitude: number | null; longitude: number | null };
    dropoff: { latitude: number | null; longitude: number | null };
  };
  rawData: DeliveryRequest;
  deliveryData?: Delivery;
  isMatched: boolean;
  qr?: QrRow | null;
  receiver?: ReceiverInfo | null;
  confirmation?: DeliveryConfirmation | null;
}

/* ==================================================================== */
/* ActivityScreen                                                       */
/* ==================================================================== */
export default function ActivityScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const hasLoadedRef = useRef(false);
  const [deliveries, setDeliveries] = useState<MappedDelivery[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showFullMap, setShowFullMap] = useState(false);
  const [showPickupQR, setShowPickupQR] = useState(false);
  const [showDeliveryOTP, setShowDeliveryOTP] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'completed' | 'cancelled' | 'all'>('active');
  const [openingChat, setOpeningChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ratingValue, setRatingValue] = useState(0);
  const [ratingTags, setRatingTags] = useState<string[]>([]);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingSaved, setRatingSaved] = useState<{ rating: number; tags: string[]; comment: string | null } | null>(null);
  const [escrowRow, setEscrowRow] = useState<any>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  const selectedDelivery = useMemo(
    () => (selectedId != null ? deliveries.find(d => d.request_id === selectedId) || null : null),
    [deliveries, selectedId]
  );

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    if (selectedId == null) return;
    detailAnim.setValue(0);
    Animated.timing(detailAnim, {
      toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
  }, [selectedId, detailAnim]);

  useEffect(() => {
    const backAction = () => {
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (showFullMap) { setShowFullMap(false); return true; }
      if (selectedId != null) { setSelectedId(null); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedId, showFullMap, photoPreview]);

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const handleResumeFindingProvider = (item: MappedDelivery) => {
    if (item.isMatched || item.status !== 'Waiting for Provider') return;
    const target = findRouteOwner(navigation, FINDING_PROVIDER_ROUTE_NAMES);
    if (!target) {
      Alert.alert('Unavailable', 'Could not open the Finding Provider screen.');
      return;
    }
    target.owner.navigate(target.name, {
      requestId: item.request_id,
      request_id: item.request_id,
      resume: true,
      fromActivity: true,
    });
  };

  const openLiveTrack = (item: MappedDelivery) => {
    const id = item.deliveryData?.delivery_id;
    if (id) {
      navigation.navigate('LiveTracking', { deliveryId: id });
    } else {
      setShowFullMap(true);
    }
  };

  const fetchUserRecord = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      return userRecord?.user_id || null;
    } catch { return null; }
  };

  const fetchProviderDetails = async (providerId: number) => {
    try {
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, email, phone_number').eq('user_id', providerId).single();
      return data;
    } catch { return null; }
  };

  const fetchData = async () => {
    try {
      if (!hasLoadedRef.current) setIsLoading(true);
      const currentUserId = userId || await fetchUserRecord();
      if (!currentUserId) {
        setDeliveries([]);
        return;
      }
      if (!userId) setUserId(currentUserId);

      const { data: requests, error: requestsError } = await supabase
        .from('delivery_requests')
        .select(`
          *,
          cargo_profiles (*),
          pickup_location:locations!delivery_requests_pickup_location_id_fkey (*),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (*),
          receiver:receivers!delivery_requests_receiver_id_fkey (
            receiver_id,
            receiver_name,
            receiver_phone,
            receiver_email,
            is_favorite
          )
        `)
        .eq('sender_id', currentUserId)
        .order('created_at', { ascending: false });

      if (requestsError) throw requestsError;

      const requestIds = requests?.map((r: any) => r.request_id) || [];
      const receiverIds = Array.from(
        new Set((requests || []).map((r: any) => r.receiver_id).filter((id: any) => id != null))
      ) as number[];

      const receiverById: Record<number, any> = {};
      if (receiverIds.length > 0) {
        const { data: receiverRows } = await supabase
          .from('receivers')
          .select('receiver_id, receiver_name, receiver_phone, receiver_email, is_favorite')
          .in('receiver_id', receiverIds);
        (receiverRows || []).forEach((r: any) => { receiverById[r.receiver_id] = r; });
      }

      let deliveriesData: Delivery[] = [];
      const qrByDeliveryId: Record<number, any> = {};
      const confirmationByDeliveryId: Record<number, DeliveryConfirmation> = {};

      if (requestIds.length > 0) {
        const { data: dels } = await supabase
          .from('deliveries')
          .select('*, vehicle:vehicles(*)')
          .in('request_id', requestIds)
          .order('accepted_at', { ascending: false });
        deliveriesData = dels || [];

        const deliveryIds = deliveriesData.map(d => d.delivery_id);
        if (deliveryIds.length > 0) {
          const { data: qrs } = await supabase.from('qr_verifications').select('*').in('delivery_id', deliveryIds);
          (qrs || []).forEach((q: any) => { qrByDeliveryId[q.delivery_id] = q; });

          const { data: confirmations } = await supabase.from('delivery_confirmations').select('*').in('delivery_id', deliveryIds);
          (confirmations || []).forEach((c: any) => { confirmationByDeliveryId[c.delivery_id] = c; });
        }
      }

      const mappedDeliveries: MappedDelivery[] = (requests || []).map((item: any) => {
        const scheduleDate = item.scheduled_time ? new Date(item.scheduled_time) : new Date(item.created_at);
        const delivery = deliveriesData.find((d: any) => d.request_id === item.request_id);

        const parseAddr = (full: string) => {
          if (!full) return { main: 'Selected location', sub: '' };
          const parts = full.split(', ');
          return { main: parts[0], sub: parts.slice(1).join(', ') };
        };

        const pickup = parseAddr(item.pickup_location?.street_address);
        const dropoff = parseAddr(item.dropoff_location?.street_address);
        const pickupRoad = [item.pickup_location?.road, item.pickup_location?.barangay].filter(Boolean).join(', ') || pickup.sub;
        const dropoffRoad = [item.dropoff_location?.road, item.dropoff_location?.barangay].filter(Boolean).join(', ') || dropoff.sub;

        const qrRow = delivery ? qrByDeliveryId[delivery.delivery_id] : null;
        const confirmationRow = delivery ? confirmationByDeliveryId[delivery.delivery_id] : null;

        let status = item.delivery_status;
        let statusDisplay = status;

        const isCancelledReq =
          /cancel/i.test(String(status || '')) ||
          /refund/i.test(String(item.payment_status || '')) ||
          /refund|cancel/i.test(String(item.escrow_status || '')) ||
          /succeed|complet|refund/i.test(String(item.refund_status || ''));

        if (isCancelledReq) statusDisplay = 'Cancelled';
        else if (delivery?.completed_at || status === 'Completed') statusDisplay = 'Completed';
        else if (qrRow?.pickup_verified || status === 'In Transit') statusDisplay = 'In Transit';
        else if (status === 'Accepted') statusDisplay = 'In Progress';
        else if (status === 'Pending') statusDisplay = delivery ? 'Matched' : 'Waiting for Provider';

        const joinedReceiver = item.receiver || (item.receiver_id != null ? receiverById[item.receiver_id] : null);
        const receiverInfo: ReceiverInfo | null = joinedReceiver
          ? {
              receiver_id: joinedReceiver.receiver_id ?? item.receiver_id ?? null,
              receiver_name: joinedReceiver.receiver_name ?? null,
              receiver_phone: joinedReceiver.receiver_phone ?? item.receiver_phone ?? '',
              receiver_email: joinedReceiver.receiver_email ?? null,
              is_favorite: joinedReceiver.is_favorite ?? false,
            }
          : item.receiver_phone
            ? {
                receiver_id: item.receiver_id ?? null,
                receiver_name: null,
                receiver_phone: item.receiver_phone,
                receiver_email: null,
                is_favorite: false,
              }
            : null;

        const cargoObj = Array.isArray(item.cargo_profiles) ? item.cargo_profiles[0] : item.cargo_profiles;
        const rawCargoName = cargoObj?.item_name || cargoObj?.description || cargoObj?.cargo_type;
        const cargoName = rawCargoName && rawCargoName !== item.pickup_type ? rawCargoName : 'Standard Parcel';

        const cargoItems = normalizeCargoItems(cargoObj, cargoName);
        const qtyTotal = (Number(cargoObj?.small_box_qty) || 0) + (Number(cargoObj?.medium_box_qty) || 0) + (Number(cargoObj?.large_box_qty) || 0);
        const totalItems = cargoItems.length > 1 ? cargoItems.length : (qtyTotal || cargoItems.reduce((sum, c) => sum + c.quantity, 0));
        const weightKg = cargoObj?.total_weight_kg != null
          ? Number(cargoObj.total_weight_kg)
          : cargoObj?.weight_kg != null ? Number(cargoObj.weight_kg) : null;
        const fragile = cargoItems.some(i => i.fragile) || !!cargoObj?.is_fragile;
        const dimsArr = [cargoObj?.cargo_length_cm, cargoObj?.cargo_width_cm, cargoObj?.cargo_height_cm];
        const dims = dimsArr.every(v => Number(v) > 0) ? `${dimsArr[0]} × ${dimsArr[1]} × ${dimsArr[2]} cm` : null;

        return {
          request_id: item.request_id,
          pickup_type: item.pickup_type,
          cargo_name: cargoName,
          cargo_items: cargoItems,
          total_items: totalItems,
          weight_kg: weightKg,
          fragile,
          dims,
          date: scheduleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: scheduleDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          pickup_main: pickup.main,
          pickup_sub: pickup.sub,
          pickup_road: pickupRoad,
          dropoff_main: dropoff.main,
          dropoff_sub: dropoff.sub,
          dropoff_road: dropoffRoad,
          pickup_note: item.pickup_note || null,
          dropoff_note: item.dropoff_note || null,
          status: statusDisplay,
          status_time: delivery?.accepted_at ? new Date(delivery.accepted_at).toLocaleString() : 'Recently updated',
          provider_name: delivery ? 'Courier Assigned' : 'Finding courier...',
          provider_id: delivery?.provider_id,
          price: item.estimated_cost?.toFixed(2) || '0.00',
          payment_method: item.payment_provider || null,
          coords: {
            pickup: {
              latitude: item.pickup_location?.latitude ?? null,
              longitude: item.pickup_location?.longitude ?? null,
            },
            dropoff: {
              latitude: item.dropoff_location?.latitude ?? null,
              longitude: item.dropoff_location?.longitude ?? null,
            },
          },
          rawData: item,
          deliveryData: delivery,
          isMatched: !!delivery,
          qr: qrRow ? {
            pickup_qr: qrRow.pickup_qr,
            pickup_pin: qrRow.pickup_pin,
            pickup_verified: qrRow.pickup_verified,
            dropoff_qr: qrRow.dropoff_qr,
            dropoff_pin: qrRow.dropoff_pin,
            dropoff_verified: qrRow.dropoff_verified,
          } : null,
          receiver: receiverInfo,
          confirmation: confirmationRow || null,
        };
      });

      const matchedDeliveries = mappedDeliveries.filter(d => d.isMatched);
      for (const delivery of matchedDeliveries) {
        if (delivery.provider_id) {
          const provider = await fetchProviderDetails(delivery.provider_id);
          if (provider) {
            delivery.provider_name = `${provider.first_name} ${provider.last_name}`.trim();
            delivery.provider_phone = (provider as any).phone_number || null;
          }
        }
      }

      setDeliveries(mappedDeliveries);
    } catch {
      setDeliveries([]);
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`sender-activity-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `sender_id=eq.${userId}` }, () => { fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => { fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, () => { fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, () => { fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escrow_payments' }, () => { fetchData(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  useEffect(() => {
    const pending = deliveries.filter(
      (d) => d.isMatched && d.qr?.pickup_verified && !d.deliveryData?.completed_at && !d.confirmation?.system_otp && d.status !== 'Cancelled',
    );

    pending.forEach(async (d) => {
      const deliveryId = d.deliveryData?.delivery_id;
      if (!deliveryId) return;
      try {
        const { data, error } = await supabase.functions.invoke('generate-delivery-otp', {
          body: { action: 'generate', delivery_id: deliveryId },
        });
        if (error || !data?.success) return;
        fetchData();
      } catch { /* ignore */ }
    });
  }, [deliveries]);

  const detailDeliveryId: number | null = (selectedDelivery?.deliveryData as any)?.delivery_id ?? null;

  useEffect(() => {
    setRatingSaved(null);
    setRatingValue(0);
    setRatingTags([]);
    setRatingComment('');
    setEscrowRow(null);
    setCopied(false);

    if (!detailDeliveryId) return;

    let cancelled = false;
    (async () => {
      const { data: esc } = await supabase
        .from('escrow_payments')
        .select('*')
        .eq('delivery_id', detailDeliveryId)
        .limit(1)
        .maybeSingle();
      if (!cancelled && esc) setEscrowRow(esc);

      if (!userId) return;
      const { data: rt } = await supabase
        .from('ratings_reviews')
        .select('*')
        .eq('delivery_id', detailDeliveryId)
        .eq('reviewer_id', userId)
        .maybeSingle();

      if (!cancelled && rt) {
        setRatingSaved({
          rating: Number(rt.rating) || 0,
          tags: Array.isArray((rt as any).tags) ? (rt as any).tags : [],
          comment: rt.review_text ?? null,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [selectedId, detailDeliveryId, userId]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      return () => {
        StatusBar.setBarStyle(colors.statusBarStyle, true);
      };
    }, [userId, colors.statusBarStyle])
  );

  const copyTrackingId = async (text: string) => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
      } else {
        await Share.share({ message: text });
      }
    } catch { /* ignore */ }
  };

  const submitRating = async () => {
    const dd: any = selectedDelivery?.deliveryData;
    if (!dd?.delivery_id || ratingValue < 1) return;

    if (!userId) {
      Alert.alert('Please wait', 'Your account is still loading.');
      return;
    }

    const providerId = dd.provider_id ?? selectedDelivery?.provider_id ?? null;
    if (!providerId) {
      Alert.alert('Error', 'No provider found for this delivery.');
      return;
    }

    setRatingSubmitting(true);
    try {
      const comment = ratingComment.trim() || null;

      const { error } = await supabase
        .from('ratings_reviews')
        .upsert(
          {
            delivery_id: dd.delivery_id,
            reviewer_id: userId,
            reviewee_id: providerId,
            rating: ratingValue,
            review_text: comment,
            tags: ratingTags,
          },
          { onConflict: 'delivery_id,reviewer_id' }
        );

      if (error) throw error;

      setRatingSaved({ rating: ratingValue, tags: ratingTags, comment });
      Alert.alert('Thanks!', 'Your rating has been saved.');
    } catch (e: any) {
      Alert.alert('Could not save rating', e?.message || 'Please try again in a moment.');
    } finally {
      setRatingSubmitting(false);
    }
  };

  const handleEdit = (rawData: any) => {
    if (!rawData) return;
    setSelectedId(null);
    navigation.navigate('ScheduleDelivery', { editData: rawData, mode: rawData.scheduled_time ? 'schedule' : 'sendNow' });
  };

  const handleCancelDelivery = (rawData: any) => {
    if (!rawData) return;
    if (
      rawData.delivery_status === 'In Transit' ||
      selectedDelivery?.status === 'In Transit' ||
      selectedDelivery?.qr?.pickup_verified
    ) {
      Alert.alert('Cannot Cancel', 'This package has already been picked up and is in transit.');
      return;
    }

    Alert.alert('Cancel Delivery', 'Are you sure you want to cancel this delivery?', [
      { text: 'Keep Delivery', style: 'cancel' },
      {
        text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
          const reqId: number = rawData.request_id;
          const providerId: number | null = selectedDelivery?.provider_id ?? null;
          const amount: number = Number(selectedDelivery?.price) || 0;

          let refundSucceeded = false;
          let refundFailed = false;

          try {
            const { data: reqRow } = await supabase
              .from('delivery_requests')
              .select('payment_status, escrow_status, delivery_status')
              .eq('request_id', reqId)
              .maybeSingle();

            if (reqRow?.delivery_status === 'In Transit') {
              Alert.alert('Cannot Cancel', 'This package has already been picked up and is in transit.');
              fetchData();
              return;
            }

            const wasHeld =
              reqRow?.payment_status === 'held' ||
              reqRow?.escrow_status === 'held';

            const updateData: any = { delivery_status: 'Cancelled' };

            if (wasHeld) {
              try {
                const { data: refundResult, error: refundErr } = await supabase.functions.invoke(
                  'xendit-refund',
                  { body: { request_id: reqId, reason: 'REQUESTED_BY_CUSTOMER' } },
                );
                const ok = !refundErr && refundResult?.success;
                if (ok) {
                  refundSucceeded = true;
                } else {
                  refundFailed = true;
                  updateData.refund_status = refundResult?.needs_manual ? 'manual_required' : 'failed';
                }
              } catch {
                refundFailed = true;
                updateData.refund_status = 'failed';
              }
            }

            await supabase.from('delivery_requests').update(updateData).eq('request_id', reqId);

            setSelectedId(null);
            fetchData();

            fireCancelNotification({
              requestId: reqId,
              amount,
              refunded: refundSucceeded,
              refundFailed,
            });

            if (providerId) {
              notifyProviderOfCancellation({
                providerId,
                requestId: reqId,
                amount,
              });
            }
          } catch {
            Alert.alert('Error', 'Could not cancel the delivery.');
          }
        }
      }
    ]);
  };

  const handleMessageProvider = async (item: MappedDelivery) => {
    try {
      if (!item.deliveryData?.delivery_id) {
        return Alert.alert('Please wait', 'Courier details are still loading.');
      }
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(item.deliveryData.delivery_id);
      if (!roomId) {
        return Alert.alert('Error', 'Could not open chat.');
      }
      setShowFullMap(false);
      let current: any = navigation;
      while (current) {
        try {
          const names: string[] = current.getState?.()?.routeNames || [];
          const match = names.find(n => /message|chat|inbox/i.test(n));
          if (match) { current.navigate(match, { openRoomId: roomId }); return; }
        } catch { /* ignore */ }
        current = current.getParent?.();
      }
      navigation.navigate('MainTabs', { screen: 'Messages', params: { openRoomId: roomId } });
    } catch {
      Alert.alert('Error', 'Could not open chat.');
    } finally {
      setOpeningChat(false);
    }
  };

  /* --------------------------- Stage & Status --------------------------- */
  const stageOf = (item: MappedDelivery): 'pending' | 'pickup' | 'transit' | 'done' | 'cancelled' => {
    if (item.status === 'Cancelled') return 'cancelled';
    if (item.status === 'Completed' || !!item.deliveryData?.completed_at) return 'done';
    if (item.qr?.pickup_verified || item.status === 'In Transit') return 'transit';
    if (item.isMatched || item.status === 'Matched' || item.status === 'In Progress') return 'pickup';
    return 'pending';
  };

  const statusMeta = (stage: 'pending' | 'pickup' | 'transit' | 'done' | 'cancelled') => {
    switch (stage) {
      case 'done':
        return { label: 'Completed', bg: colors.successBg, fg: colors.success, icon: 'checkmark-circle' };
      case 'transit':
        return { label: 'In Transit', bg: colors.accentSoft, fg: ORANGE, icon: 'navigate' };
      case 'pickup':
        return { label: 'Awaiting Pickup', bg: 'rgba(59,130,246,0.14)', fg: BLUE, icon: 'car-sport' };
      case 'cancelled':
        return { label: 'Cancelled', bg: colors.errorBg, fg: colors.error, icon: 'close-circle' };
      case 'pending':
      default:
        return { label: 'Finding Courier', bg: colors.warningBg, fg: colors.warning, icon: 'time-outline' };
    }
  };

  const getTabCount = (tab: 'active' | 'pending' | 'completed' | 'cancelled' | 'all') => {
    if (tab === 'all') return deliveries.length;
    if (tab === 'pending') return deliveries.filter(d => stageOf(d) === 'pending').length;
    if (tab === 'active') return deliveries.filter(d => { const s = stageOf(d); return s === 'pickup' || s === 'transit'; }).length;
    if (tab === 'completed') return deliveries.filter(d => stageOf(d) === 'done').length;
    if (tab === 'cancelled') return deliveries.filter(d => stageOf(d) === 'cancelled').length;
    return 0;
  };

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((item) => {
      const st = stageOf(item);
      if (activeTab === 'pending') return st === 'pending';
      if (activeTab === 'active') return st === 'pickup' || st === 'transit';
      if (activeTab === 'completed') return st === 'done';
      if (activeTab === 'cancelled') return st === 'cancelled';
      return true;
    });
  }, [deliveries, activeTab]);

  const packagePhotosOf = (item: MappedDelivery | null): { url: string; label: string }[] => {
    if (!item) return [];
    const out: { url: string; label: string }[] = [];
    const seen = new Set<string>();
    (item.cargo_items || []).forEach((ci: CargoItem, i: number) => {
      (ci.photos || []).forEach(url => {
        if (url && !seen.has(url)) { seen.add(url); out.push({ url, label: ci.name || `Item ${i + 1}` }); }
      });
    });
    return out;
  };

  const cargoLabel = (item: MappedDelivery) => {
    const firstSize = item.cargo_items?.[0]?.size;
    return `${item.total_items} ${firstSize || (item.total_items === 1 ? 'item' : 'items')}`;
  };

  /* --------------------------- Shared Pieces (TaskScreen style) --------------------------- */
  const renderServicePill = (item: MappedDelivery) => (
    <View style={styles.svcPill}>
      <Ionicons name="add-circle-outline" size={13} color={BLUE} />
      <Text style={styles.svcPillText}>{serviceLabel(item.pickup_type)}</Text>
    </View>
  );

  const renderStatusPill = (meta: { label: string; bg: string; fg: string }) => (
    <View style={[styles.stPill, { backgroundColor: meta.bg }]}>
      <View style={[styles.stDot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.stPillText, { color: meta.fg }]}>{meta.label.toUpperCase()}</Text>
    </View>
  );

  const renderRoute = (item: MappedDelivery, opts: { notes?: boolean } = {}) => (
    <View>
      {[
        { key: 'p', label: 'PICKUP', main: item.pickup_main, road: item.pickup_road, color: ORANGE, note: item.pickup_note },
        { key: 'd', label: 'DROP-OFF', main: item.dropoff_main, road: item.dropoff_road, color: BLACK, note: item.dropoff_note },
      ].map((r, i) => (
        <View key={r.key} style={styles.rtRow}>
          <View style={styles.rtRail}>
            <View style={[styles.rtRing, { borderColor: r.color }]}>
              <View style={[styles.rtRingDot, { backgroundColor: r.color }]} />
            </View>
            {i === 0 && (
              <View style={styles.rtDots}>
                {[0, 1, 2, 3].map(k => <View key={k} style={styles.rtDot} />)}
              </View>
            )}
          </View>
          <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
            <Text style={styles.rtLabel}>{r.label}</Text>
            <Text style={styles.rtMain} numberOfLines={1}>{r.main}</Text>
            {!!r.road && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Ionicons name="map-outline" size={12} color={colors.textMuted} />
                <Text style={styles.rtSub} numberOfLines={1}>{r.road}</Text>
              </View>
            )}
            {opts.notes && !!r.note && (
              <View style={styles.sdNote}>
                <Ionicons name="chatbubble-ellipses-outline" size={13} color={ORANGE} />
                <Text style={styles.sdNoteText}>{r.note}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderMiniContact = (o: { role: string; name: string | null; phone: string | null; color: string }) => {
    const handlePress = () => {
      Alert.alert(
        o.role,
        `Name: ${o.name || 'N/A'}\nPhone: ${o.phone || 'N/A'}`,
        o.phone ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => Linking.openURL(`tel:${o.phone}`) },
        ] : [{ text: 'OK' }]
      );
    };

    return (
      <TouchableOpacity style={styles.mcCard} onPress={handlePress} activeOpacity={0.7}>
        <View style={[styles.mcAvatar, { backgroundColor: o.color }]}>
          <Text style={styles.mcAvatarText}>{initials(o.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mcRole}>{o.role}</Text>
          <Text style={styles.mcName} numberOfLines={1}>{o.name || 'N/A'}</Text>
        </View>
        {!!o.phone && (
          <TouchableOpacity
            style={styles.mcCall}
            onPress={(e) => { e.stopPropagation(); Linking.openURL(`tel:${o.phone}`); }}
            activeOpacity={0.8}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="call" size={14} color={ORANGE} />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  /* ---------------------------- List Card (TaskScreen style) ---------------------------- */
  const renderShipmentCard = (item: MappedDelivery) => {
    const stage = stageOf(item);
    const meta = statusMeta(stage);
    const isCancelled = stage === 'cancelled';
    const isActive = stage === 'pickup' || stage === 'transit' || stage === 'pending';
    const receiverName = item.receiver?.receiver_name || item.receiver?.receiver_phone || 'Receiver';
    const receiverPhone = item.receiver?.receiver_phone || null;
    const courierName = item.isMatched ? item.provider_name : 'Searching...';

    return (
      <TouchableOpacity
        key={item.request_id}
        style={[styles.oCard, !isActive && { opacity: 0.88 }]}
        onPress={() => setSelectedId(item.request_id)}
        activeOpacity={0.92}
      >
        <View style={styles.oPad}>
          <View style={styles.oTopRow}>
            {renderServicePill(item)}
            {renderStatusPill(meta)}
          </View>

          {renderRoute(item)}

          <View style={styles.oContacts}>
            {renderMiniContact({
              role: 'COURIER',
              name: courierName,
              phone: item.isMatched ? (item.provider_phone || null) : null,
              color: BLUE,
            })}
            {renderMiniContact({
              role: 'RECEIVER',
              name: receiverName,
              phone: receiverPhone,
              color: PURPLE,
            })}
          </View>

          {isCancelled && <Text style={styles.mCancelledText}>Booking cancelled</Text>}
        </View>

        <View style={styles.oFooter}>
          <View style={styles.oChip}>
            <Ionicons name="cube-outline" size={14} color={ORANGE} />
            <Text style={styles.oChipText}>{cargoLabel(item)}</Text>
          </View>
          {item.fragile && (
            <View style={styles.oChip}>
              <Ionicons name="star-outline" size={14} color={ORANGE} />
              <Text style={styles.oChipText}>Fragile</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text style={[styles.oPrice, isCancelled && { textDecorationLine: 'line-through', color: colors.textMuted }]}>
            {money(item.price)}
          </Text>
        </View>

        {(stage === 'pickup' || stage === 'transit') && (
          <View style={styles.oActions}>
            <TouchableOpacity
              style={styles.oChatBtn}
              onPress={() => handleMessageProvider(item)}
              disabled={openingChat}
              activeOpacity={0.85}
            >
              {openingChat ? <ActivityIndicator size="small" color={ORANGE} /> : (
                <>
                  <Ionicons name="chatbubble-outline" size={16} color={ORANGE} />
                  <Text style={styles.oChatText}>Chat</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.oRouteBtn}
              onPress={() => openLiveTrack(item)}
              activeOpacity={0.9}
            >
              <Ionicons name="navigate" size={16} color="#FFFFFF" />
              <Text style={styles.oRouteText}>Live Track</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'pending' && (
          <View style={styles.oActions}>
            <TouchableOpacity
              style={styles.oChatBtn}
              onPress={() => handleEdit(item.rawData)}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={16} color={ORANGE} />
              <Text style={styles.oChatText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.oRouteBtn}
              onPress={() => handleResumeFindingProvider(item)}
              activeOpacity={0.9}
            >
              <Ionicons name="search" size={16} color="#FFFFFF" />
              <Text style={styles.oRouteText}>Find Courier</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  /* ---------------------------- List View ---------------------------- */
  const renderListView = () => (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Animated.View style={[styles.headerSection, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.pageTitle}>My Shipments</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          {(['active', 'pending', 'completed', 'cancelled', 'all'] as const).map(t => {
            const on = activeTab === t;
            const count = getTabCount(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.tabItem, on && styles.tabItemActive]}
                onPress={() => setActiveTab(t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, on && styles.tabTextActive]}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
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
            onRefresh={() => { setRefreshing(true); fetchData(); }}
            tintColor={ORANGE}
            colors={[ORANGE]}
          />
        }
      >
        <Animated.View style={{ opacity: contentAnim }}>
          {filteredDeliveries.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name={
                    activeTab === 'cancelled' ? 'close-circle-outline'
                      : deliveries.length === 0 ? 'cube-outline'
                      : 'search-outline'
                  }
                  size={30}
                  color={ORANGE}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'cancelled'
                  ? 'No cancelled bookings'
                  : deliveries.length === 0 ? 'No shipments yet' : 'Nothing here'}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === 'cancelled'
                  ? 'Bookings you cancel will appear here.'
                  : deliveries.length === 0
                    ? 'Deliveries you book appear here. Schedule or send a package from the Home tab.'
                    : 'Try another tab to view your shipment history.'}
              </Text>
            </View>
          ) : (
            filteredDeliveries.map(renderShipmentCard)
          )}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  /* --------------------------- Detail View (TaskScreen style) --------------------------- */
  const renderDetailView = (d: MappedDelivery) => {
    const stage = stageOf(d);
    const meta = statusMeta(stage);
    const code = trackingCode(d.request_id);
    const isCancelled = stage === 'cancelled';
    const isCompleted = stage === 'done';
    const isInTransit = stage === 'transit';
    const active = stage === 'pickup' || stage === 'transit' || stage === 'pending';

    const progressSteps = ['Placed', 'Matched', 'Picked up', 'In Transit', 'Delivered'];
    const doneUpTo = stage === 'done' ? 4 : stage === 'transit' ? 2 : stage === 'pickup' ? 1 : 0;
    const currentStep = stage === 'done' ? -1 : stage === 'transit' ? 3 : stage === 'pickup' ? 2 : 1;

    const H = Dimensions.get('window').height;
    const mapH = Math.round(H * 0.46);
    const photos = packagePhotosOf(d).filter(ph => !failedPhotos[ph.url]);
    const vehicle: any = d.deliveryData?.vehicle;

    const escrowStatus = String(escrowRow?.escrow_status || escrowRow?.status || d.rawData?.escrow_status || '');
    const released = isCompleted || /complet|releas/i.test(escrowStatus);
    const paymentLabel = isCancelled
      ? 'Refunded / Cancelled'
      : released
        ? 'Released to courier'
        : d.isMatched ? 'Held in escrow' : 'Awaiting courier';

    const payoutProvider = escrowRow?.payment_method || d.payment_method;

    const hintText = stage === 'pending'
      ? 'Looking for a nearby courier partner to accept your delivery request.'
      : stage === 'pickup'
        ? 'Your courier is heading to pickup. Show your Pickup QR or 4-digit PIN when they arrive.'
        : 'Your package is on the way! Share the 6-digit Delivery OTP with the receiver so they can confirm arrival.';

    const canRate = d.isMatched && isCompleted;
    const ratingLabels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
    const shownRating = ratingSaved ? ratingSaved.rating : ratingValue;

    const receiverName = d.receiver?.receiver_name || d.receiver?.receiver_phone || 'Receiver';
    const receiverPhone = d.receiver?.receiver_phone || null;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TouchableOpacity
          style={[styles.dRoundBtn, { top: Math.max(insets.top, 16) + 6, left: 16 }]}
          onPress={() => setSelectedId(null)}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.dRoundBtn, { top: Math.max(insets.top, 16) + 6, right: 16 }]}
          onPress={() => setShowFullMap(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="expand-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ paddingBottom: active ? insets.bottom + 110 : insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ height: mapH - 28 }}>
            <View style={[styles.dMap, { height: mapH + 24, position: 'relative' }]}>
              <RoutePreviewMap
                pickupLat={d.coords.pickup.latitude}
                pickupLng={d.coords.pickup.longitude}
                dropoffLat={d.coords.dropoff.latitude}
                dropoffLng={d.coords.dropoff.longitude}
                padTop={insets.top + 70}
                padBottom={60}
              />
            </View>
          </View>

          <Animated.View style={[styles.dSheet, { opacity: detailAnim }]}>
            <View style={styles.dHandle} />

            <View style={styles.oTopRow}>
              {renderServicePill(d)}
              {renderStatusPill(meta)}
            </View>

            <View style={styles.dCodeRow}>
              <Text style={styles.dCode} selectable numberOfLines={1}>#{code}</Text>
              <TouchableOpacity
                onPress={() => copyTrackingId(code)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.trackTextCopy}
              >
                <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={16} color={ORANGE} />
                <Text style={styles.trackTextCopyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
            {!!d.rawData?.scheduled_time && (
              <Text style={styles.dWhen}>Scheduled · {formatDateTime(d.rawData.scheduled_time)}</Text>
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
                        <View style={[styles.stepLine, i === 0 && { backgroundColor: 'transparent' }, reached && i > 0 && { backgroundColor: ORANGE }]} />
                        <View style={[styles.stepDot, done && styles.stepDotDone, current && styles.stepDotCurrent]}>
                          {done ? <Ionicons name="checkmark" size={14} color="#FFFFFF" />
                            : current ? <View style={styles.stepDotInner} /> : null}
                        </View>
                        <View style={[styles.stepLine, i === progressSteps.length - 1 && { backgroundColor: 'transparent' }, done && i < progressSteps.length - 1 && { backgroundColor: ORANGE }]} />
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
                  <Ionicons name="close-circle" size={22} color={colors.error} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cancelBannerTitle}>Booking cancelled</Text>
                  <Text style={styles.cancelBannerSub}>
                    This shipment was cancelled. Any held escrow payment is being refunded to your account.
                  </Text>
                </View>
              </View>
            ) : isCompleted ? (
              <View style={styles.doneCard}>
                <View style={styles.doneIcon}><Ionicons name="checkmark" size={20} color={colors.success} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doneTitle}>Delivered successfully</Text>
                  <Text style={styles.doneSub}>
                    {d.deliveryData?.completed_at ? formatDateTime(d.deliveryData.completed_at) : ''}
                    {released ? `  ·  ${money(d.price)} released to courier` : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.dHint}>
                <Ionicons name="information-circle" size={18} color={ORANGE} />
                <Text style={styles.dHintText}>{hintText}</Text>
              </View>
            )}

            <View style={{ marginTop: 18 }}>{renderRoute(d, { notes: true })}</View>

            <View style={styles.oContacts}>
              {renderMiniContact({
                role: 'COURIER',
                name: d.isMatched ? d.provider_name : 'Searching...',
                phone: d.isMatched ? (d.provider_phone || null) : null,
                color: BLUE,
              })}
              {renderMiniContact({
                role: 'RECEIVER',
                name: receiverName,
                phone: receiverPhone,
                color: PURPLE,
              })}
            </View>

            {d.isMatched && vehicle && (
              <View style={[styles.tileGrid, { marginTop: 10 }]}>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>VEHICLE</Text>
                  <Text style={styles.tileValue}>{vehicle.vehicle_type || 'Standard'}</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>PLATE NUMBER</Text>
                  <Text style={styles.tileValue}>{vehicle.plate_number || '—'}</Text>
                </View>
              </View>
            )}

            {photos.length > 0 && (
              <>
                <View style={styles.dSecHead}>
                  <Ionicons name="images-outline" size={17} color={ORANGE} />
                  <Text style={styles.dSecTitle}>Package Photos</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {photos.map((ph, i) => (
                    <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => setPhotoPreview(ph.url)}>
                      <Image
                        source={{ uri: ph.url }}
                        style={styles.dPhoto}
                        resizeMode="cover"
                        onError={() => setFailedPhotos(p => ({ ...p, [ph.url]: true }))}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={styles.dSecHead}>
              <Ionicons name="cube-outline" size={17} color={ORANGE} />
              <Text style={styles.dSecTitle}>Package Details</Text>
            </View>
            {d.cargo_items.some(it => !!it.name) && (
              <View style={{ gap: 4, marginBottom: 10 }}>
                {d.cargo_items.map((it, i) => !!it.name && (
                  <Text key={i} style={styles.dItemText} numberOfLines={2}>
                    {d.cargo_items.length > 1 ? `${i + 1}. ` : ''}{it.name}
                    {it.notes ? ` — ${it.notes}` : ''}
                  </Text>
                ))}
              </View>
            )}
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>CARGO SIZE</Text>
                <Text style={styles.tileValue}>{cargoLabel(d)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>WEIGHT</Text>
                <Text style={styles.tileValue}>{d.weight_kg != null ? `${d.weight_kg} kg` : '—'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>HANDLING</Text>
                <Text style={[styles.tileValue, d.fragile && { color: ORANGE }]}>{d.fragile ? 'Fragile' : 'Standard'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>TOTAL COST</Text>
                <Text style={[
                  styles.tileValue,
                  { color: isCancelled ? colors.textMuted : colors.textPrimary },
                  isCancelled && { textDecorationLine: 'line-through' },
                ]}>
                  {money(d.price)}
                </Text>
              </View>
              {!!d.dims && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>DIMENSIONS</Text>
                  <Text style={styles.tileValue}>{d.dims}</Text>
                </View>
              )}
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>PAYMENT STATUS</Text>
                <Text style={[styles.tileValue, released && { color: colors.success }]} numberOfLines={2}>
                  {paymentLabel}
                </Text>
              </View>
              {!!payoutProvider && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>PAID VIA</Text>
                  <View style={{ marginTop: 4, alignSelf: 'flex-start' }}>
                    <PaymentMethodBadge provider={payoutProvider} />
                  </View>
                </View>
              )}
            </View>

            {/* Timeline Section */}
            <View style={styles.dSecHead}>
              <Ionicons name="time-outline" size={17} color={ORANGE} />
              <Text style={styles.dSecTitle}>Delivery Timeline</Text>
            </View>
            <View style={styles.sdCardInner}>
              <View style={styles.tlRow}>
                <Ionicons name={d.isMatched ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={d.isMatched ? ORANGE : colors.border} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tlTitle, !d.isMatched && { color: colors.textMuted }]}>Courier Accepted</Text>
                  <Text style={styles.tlSub}>
                    {d.deliveryData?.accepted_at ? formatDateTimeShort(d.deliveryData.accepted_at) : d.isMatched ? 'Courier assigned' : 'Waiting for a courier'}
                  </Text>
                </View>
              </View>
              <View style={styles.tlRow}>
                <Ionicons name={isInTransit || isCompleted ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isInTransit || isCompleted ? ORANGE : colors.border} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tlTitle, !(isInTransit || isCompleted) && { color: colors.textMuted }]}>Package Picked Up</Text>
                  <Text style={styles.tlSub}>
                    {isInTransit || isCompleted ? 'Verified with sender QR / PIN' : d.isMatched ? 'Waiting for courier pickup scan' : 'Awaiting courier'}
                  </Text>
                </View>
              </View>
              <View style={[styles.tlRow, { paddingBottom: 0 }]}>
                <Ionicons name={isCompleted ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isCompleted ? ORANGE : colors.border} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tlTitle, !isCompleted && { color: colors.textMuted }]}>Delivered</Text>
                  <Text style={styles.tlSub}>
                    {isCompleted && d.deliveryData?.completed_at
                      ? formatDateTimeShort(d.deliveryData.completed_at)
                      : d.deliveryData?.estimated_eta
                        ? `Estimated arrival ${formatDateTimeShort(d.deliveryData.estimated_eta)}`
                        : 'Awaiting delivery'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Rating Section */}
            {!isCancelled && (
              <>
                <View style={styles.dSecHead}>
                  <Ionicons name="star" size={17} color={ORANGE} />
                  <Text style={styles.dSecTitle}>Rate Your Courier</Text>
                  {!!ratingSaved && (
                    <View style={styles.sdRatedBadge}>
                      <Ionicons name="checkmark-circle" size={12} color={ORANGE} />
                      <Text style={styles.sdRatedBadgeText}>Rated</Text>
                    </View>
                  )}
                </View>
                <View style={styles.sdCardInner}>
                  <View style={styles.sdStarsRow}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <TouchableOpacity
                        key={n}
                        disabled={!canRate || !!ratingSaved}
                        onPress={() => setRatingValue(n)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <Ionicons
                          name={n <= shownRating ? 'star' : 'star-outline'}
                          size={36}
                          color={n <= shownRating ? ORANGE : (isDark ? '#5A3418' : '#FFC9A3')}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>

                  {canRate ? (
                    <Text style={styles.sdRatingLabel}>
                      {shownRating > 0 ? ratingLabels[shownRating - 1] : 'Tap a star to rate'}
                    </Text>
                  ) : (
                    <View style={styles.sdLockedNote}>
                      <Ionicons name="lock-closed-outline" size={12} color={colors.textMuted} />
                      <Text style={styles.sdLockedNoteText}>
                        {d.isMatched ? 'You can rate once the delivery is completed.' : 'Available after a courier is assigned.'}
                      </Text>
                    </View>
                  )}

                  {canRate && !ratingSaved && shownRating > 0 && (
                    <>
                      <View style={styles.sdTagWrap}>
                        {RATING_TAGS.map(tag => {
                          const on = ratingTags.includes(tag);
                          return (
                            <TouchableOpacity
                              key={tag}
                              style={[styles.sdTag, on && styles.sdTagOn]}
                              onPress={() => setRatingTags(prev => (on ? prev.filter(t => t !== tag) : [...prev, tag]))}
                              activeOpacity={0.8}
                            >
                              <Text style={[styles.sdTagText, on && styles.sdTagTextOn]}>{tag}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <TextInput
                        style={styles.sdCommentInput}
                        placeholder="Add a comment (optional)"
                        placeholderTextColor={colors.textMuted}
                        value={ratingComment}
                        onChangeText={setRatingComment}
                        multiline
                        maxLength={240}
                      />
                      <TouchableOpacity
                        style={[styles.mPrimaryBtn, { marginTop: 14 }, ratingSubmitting && { opacity: 0.7 }]}
                        onPress={submitRating}
                        disabled={ratingSubmitting}
                        activeOpacity={0.9}
                      >
                        {ratingSubmitting ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Text style={styles.mPrimaryText}>Submit Rating</Text>
                        )}
                      </TouchableOpacity>
                    </>
                  )}

                  {!!ratingSaved && (
                    <View style={styles.sdThanks}>
                      {ratingSaved.tags.length > 0 && (
                        <View style={styles.sdTagWrap}>
                          {ratingSaved.tags.map(tag => (
                            <View key={tag} style={[styles.sdTag, styles.sdTagOn]}>
                              <Text style={[styles.sdTagText, styles.sdTagTextOn]}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                      {!!ratingSaved.comment && <Text style={styles.sdThanksComment}>"{ratingSaved.comment}"</Text>}
                      <Text style={styles.sdThanksText}>Thanks for your feedback!</Text>
                    </View>
                  )}
                </View>
              </>
            )}

            {/* Cancel / Edit Booking buttons before In Transit */}
            {!isCompleted && !isCancelled && !isInTransit && (
              <View style={styles.detailActionsRow}>
                {!d.isMatched && (
                  <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(d.rawData)} activeOpacity={0.9}>
                    <Ionicons name="create-outline" size={16} color={ORANGE} />
                    <Text style={styles.editBtnText}>Edit Details</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.sdCancelBtn} onPress={() => handleCancelDelivery(d.rawData)} activeOpacity={0.9}>
                  <Ionicons name="close-circle-outline" size={16} color={colors.error} />
                  <Text style={styles.sdCancelBtnText}>Cancel Booking</Text>
                </TouchableOpacity>
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Sticky Bottom Bar (TaskScreen dBar style) */}
        {(stage === 'pickup' || stage === 'transit') && (
          <View style={[styles.dBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              style={styles.dBarIcon}
              onPress={() => handleMessageProvider(d)}
              disabled={openingChat}
              activeOpacity={0.85}
            >
              {openingChat ? <ActivityIndicator size="small" color={ORANGE} /> : <Ionicons name="chatbubble-outline" size={20} color={ORANGE} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mSoftBtn, { flex: 1 }]}
              onPress={() => openLiveTrack(d)}
              activeOpacity={0.85}
            >
              <Ionicons name="navigate" size={16} color={ORANGE} />
              <Text style={styles.mSoftText}>Live Track</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }]}
              onPress={() => (stage === 'pickup' ? setShowPickupQR(true) : setShowDeliveryOTP(true))}
              activeOpacity={0.9}
            >
              <Ionicons name={stage === 'pickup' ? 'qr-code-outline' : 'key-outline'} size={18} color="#FFFFFF" />
              <Text style={styles.mPrimaryText}>{stage === 'pickup' ? 'Pickup QR' : 'Delivery OTP'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'pending' && (
          <View style={[styles.dBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity
              style={[styles.mSoftBtn, { flex: 1 }]}
              onPress={() => handleEdit(d.rawData)}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={16} color={ORANGE} />
              <Text style={styles.mSoftText}>Edit Request</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }]}
              onPress={() => handleResumeFindingProvider(d)}
              activeOpacity={0.9}
            >
              <Ionicons name="search" size={18} color="#FFFFFF" />
              <Text style={styles.mPrimaryText}>Find Courier</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  /* --------------------------- Modals --------------------------- */
  const renderFullMapModal = () => {
    if (!selectedDelivery) return null;
    const st = stageOf(selectedDelivery);
    return (
      <Modal
        visible={showFullMap}
        animationType="slide"
        onRequestClose={() => setShowFullMap(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <RoutePreviewMap
            pickupLat={selectedDelivery.coords.pickup.latitude}
            pickupLng={selectedDelivery.coords.pickup.longitude}
            dropoffLat={selectedDelivery.coords.dropoff.latitude}
            dropoffLng={selectedDelivery.coords.dropoff.longitude}
            padTop={100}
            padBottom={260}
          />
          <TouchableOpacity
            style={[styles.mapCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setShowFullMap(false)}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={[styles.mapSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.mapSheetRow}>
              <View style={styles.sdPinPickup}><Text style={styles.sdPinLetter}>P</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>PICKUP</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{selectedDelivery.pickup_main}</Text>
              </View>
            </View>
            <View style={styles.contactDivider} />
            <View style={styles.mapSheetRow}>
              <View style={styles.sdPinDropoff}><Text style={styles.sdPinLetter}>D</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>DROP-OFF</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{selectedDelivery.dropoff_main}</Text>
              </View>
            </View>
            {(st === 'pickup' || st === 'transit') && !!selectedDelivery.deliveryData?.delivery_id && (
              <TouchableOpacity
                style={[styles.mPrimaryBtn, { marginTop: 14 }]}
                onPress={() => {
                  setShowFullMap(false);
                  openLiveTrack(selectedDelivery);
                }}
                activeOpacity={0.9}
              >
                <Ionicons name="navigate" size={16} color="#FFFFFF" />
                <Text style={styles.mPrimaryText}>Open Live Tracking</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  const renderPickupQRModal = () => (
    <Modal visible={showPickupQR} transparent animationType="slide" onRequestClose={() => setShowPickupQR(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Pickup Verification</Text>
            <TouchableOpacity onPress={() => setShowPickupQR(false)}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            Show this QR code to your courier at pickup, or read them the 4-digit PIN below.
          </Text>

          {selectedDelivery?.qr?.pickup_qr ? (
            <View style={styles.qrWrap}>
              <QRCode value={selectedDelivery.qr.pickup_qr} size={200} color="#111827" backgroundColor="#FFFFFF" />
            </View>
          ) : (
            <ActivityIndicator color={ORANGE} style={{ margin: 40 }} />
          )}

          {!!selectedDelivery?.qr?.pickup_pin && (
            <View style={styles.pinRevealBox}>
              <Text style={styles.pinRevealLabel}>4-DIGIT PICKUP PIN</Text>
              <Text style={styles.pinRevealValue}>{selectedDelivery.qr.pickup_pin}</Text>
              <Text style={styles.pinRevealHint}>Courier can enter this PIN if their camera cannot scan.</Text>
            </View>
          )}

          <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowPickupQR(false)}>
            <Text style={styles.modalDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderDeliveryOTPModal = () => {
    if (!selectedDelivery) return null;
    const otp = selectedDelivery.confirmation?.system_otp;
    const verified = selectedDelivery.confirmation?.otp_verified;
    const receiverPhone = selectedDelivery.receiver?.receiver_phone || '';
    const receiverName = selectedDelivery.receiver?.receiver_name || 'the receiver';

    const trackingId = `PNS-${String(selectedDelivery.request_id).padStart(4, '0')}`;
    const smsMessage = `Hi ${receiverName}, here is your delivery OTP for shipment #${trackingId}: ${otp || '------'}. Please read this code to the courier when they arrive.\n\nYou can also track your package here: https://packnship.streamlit.app/`;

    const sendSMS = () => {
      if (!otp) return;
      const url = Platform.select({
        ios: `sms:${receiverPhone}&body=${encodeURIComponent(smsMessage)}`,
        android: `sms:${receiverPhone}?body=${encodeURIComponent(smsMessage)}`,
      });
      if (url) Linking.openURL(url);
    };

    const copySMS = async () => {
      if (!otp) return;
      try {
        if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(smsMessage);
        else await Share.share({ message: smsMessage });
      } catch { /* ignore */ }
    };

    return (
      <Modal visible={showDeliveryOTP} transparent animationType="slide" onRequestClose={() => setShowDeliveryOTP(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delivery OTP</Text>
              <TouchableOpacity onPress={() => setShowDeliveryOTP(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {verified
                ? 'The receiver has confirmed this delivery.'
                : 'Send this 6-digit code to the receiver. They will read it to the courier on arrival.'}
            </Text>

            {verified ? (
              <View style={styles.verifiedBox}>
                <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                <Text style={styles.verifiedText}>Verified & Completed</Text>
              </View>
            ) : (
              <>
                <View style={styles.otpBigBox}>
                  <Text style={styles.otpBigLabel}>DELIVERY OTP</Text>
                  <Text style={styles.otpBigValue}>{otp || '------'}</Text>
                </View>

                {!!receiverPhone && (
                  <TouchableOpacity style={styles.otpSendBtn} onPress={sendSMS} disabled={!otp} activeOpacity={0.9}>
                    <Ionicons name="chatbubble-ellipses" size={16} color="#FFF" />
                    <Text style={styles.otpSendBtnText}>Send SMS to {receiverName}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.otpCopyBtn} onPress={copySMS} disabled={!otp} activeOpacity={0.85}>
                  <Ionicons name="copy-outline" size={16} color={ORANGE} />
                  <Text style={styles.otpCopyBtnText}>Copy message</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowDeliveryOTP(false)}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderPhotoPreviewModal = () => (
    <Modal visible={!!photoPreview} transparent animationType="fade" onRequestClose={() => setPhotoPreview(null)}>
      <View style={styles.previewOverlay}>
        {!!photoPreview && <Image source={{ uri: photoPreview }} style={styles.previewImg} resizeMode="contain" />}
        <TouchableOpacity
          style={[styles.previewClose, { top: insets.top + 12 }]}
          onPress={() => setPhotoPreview(null)}
          activeOpacity={0.85}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );

  if (isLoading) {
    return (
      <View style={[styles.safeArea, styles.loadingContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading shipments...</Text>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {selectedDelivery ? renderDetailView(selectedDelivery) : renderListView()}
      {renderFullMapModal()}
      {renderPickupQRModal()}
      {renderDeliveryOTPModal()}
      {renderPhotoPreviewModal()}
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },

  headerSection: {
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  pageTitle: { fontSize: 28, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.5 },
  tabBarScroll: { gap: 8, paddingTop: 14 },
  tabItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border, gap: 6,
  },
  tabItemActive: { backgroundColor: c.accentSoft, borderColor: ORANGE, borderWidth: 1.5 },
  tabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  tabTextActive: { color: ORANGE },
  tabCountBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.divider, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  tabCountBadgeActive: { backgroundColor: 'rgba(255, 117, 31, 0.18)' },
  tabCountText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
  tabCountTextActive: { color: ORANGE },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 60 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: c.border },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  emptySubtext: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  /* TaskScreen Shared Card & Route Styles */
  svcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  svcPillText: { fontSize: 12, fontWeight: '800', color: BLUE },
  stPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  stDot: { width: 7, height: 7, borderRadius: 4 },
  stPillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },

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
  sdNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: 'rgba(255,117,31,0.10)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  sdNoteText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.textPrimary, fontWeight: '600' },

  oCard: { backgroundColor: c.card, borderRadius: 22, marginBottom: 14, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  oPad: { padding: 16 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  oContacts: { flexDirection: 'row', gap: 10, marginTop: 14 },
  mcCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.divider, padding: 10 },
  mcAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mcAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  mcRole: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  mcName: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  mcCall: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  mCancelledText: { fontSize: 12, color: c.error, fontWeight: '700', marginTop: 8 },

  oFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  oChipText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  oPrice: { fontSize: 20, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.3 },
  oActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oChatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 14 },
  oChatText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  oRouteBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14 },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  /* TaskScreen Detail View Styles */
  dMap: { overflow: 'hidden' },
  dRoundBtn: { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 6, zIndex: 10 },
  dSheet: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 24, minHeight: 500 },
  dHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10, marginBottom: 16 },
  dCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dCode: { fontSize: 26, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.5 },
  dWhen: { fontSize: 12, fontWeight: '700', color: ORANGE, marginTop: 2 },
  trackTextCopy: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trackTextCopyLabel: { fontSize: 12, fontWeight: '800', color: ORANGE },

  stepper: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6, marginTop: 14, marginBottom: 14, borderWidth: 1, borderColor: c.divider },
  stepCol: { flex: 1, alignItems: 'center' },
  stepLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  stepLine: { flex: 1, height: 3, backgroundColor: c.divider },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.divider, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  stepDotCurrent: { borderColor: ORANGE },
  stepDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  stepLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, marginTop: 6, textAlign: 'center' },
  stepLabelOn: { color: c.textPrimary },

  cancelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
    borderRadius: 20, padding: 16, marginBottom: 14,
  },
  cancelBannerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  cancelBannerTitle: { fontSize: 15, fontWeight: '800', color: c.error },
  cancelBannerSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  doneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.successBg,
    borderWidth: 1, borderColor: c.success, borderRadius: 20, padding: 16, marginBottom: 14,
  },
  doneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 15, fontWeight: '800', color: c.success },
  doneSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  dHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, marginTop: 4 },
  dHintText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: c.textPrimary },

  dSecHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 12 },
  dSecTitle: { flex: 1, fontSize: 16, fontWeight: '900', color: c.textPrimary },
  dPhoto: { width: 92, height: 92, borderRadius: 14, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  dItemText: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  tileValue: { fontSize: 16, fontWeight: '900', color: c.textPrimary, marginTop: 4 },

  sdCardInner: { backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 16, padding: 16 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 14 },
  tlTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  tlSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  /* Rating Styles */
  sdRatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sdRatedBadgeText: { fontSize: 10, fontWeight: '800', color: ORANGE },
  sdStarsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 4 },
  sdRatingLabel: { textAlign: 'center', fontSize: 14, fontWeight: '800', color: ORANGE, marginTop: 8 },
  sdLockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  sdLockedNoteText: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  sdTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  sdTag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  sdTagOn: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  sdTagText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  sdTagTextOn: { color: ORANGE },
  sdCommentInput: {
    marginTop: 14, minHeight: 74, borderWidth: 1, borderColor: c.border, borderRadius: 14,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 13, color: c.textPrimary,
    backgroundColor: c.card, textAlignVertical: 'top',
  },
  sdThanks: { marginTop: 4 },
  sdThanksComment: { marginTop: 12, fontSize: 13, color: c.textSecondary, fontStyle: 'italic', textAlign: 'center' },
  sdThanksText: { marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: '700', color: c.textMuted },

  /* Edit & Cancel Actions */
  detailActionsRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, paddingVertical: 14, borderRadius: 14,
  },
  editBtnText: { color: ORANGE, fontWeight: '800', fontSize: 14 },
  sdCancelBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 14, backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
  },
  sdCancelBtnText: { color: c.error, fontWeight: '800', fontSize: 14 },

  /* Bottom Sticky Bar */
  dBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.divider },
  dBarIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  mPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, paddingVertical: 13, borderRadius: 14 },
  mPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  mSoftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.accentSoft, paddingVertical: 13, borderRadius: 14 },
  mSoftText: { color: ORANGE, fontSize: 13, fontWeight: '800' },

  /* Full Map Modal (TaskScreen style) */
  mapCloseBtn: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 8, elevation: 6, borderWidth: 1, borderColor: c.border,
  },
  mapSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.4,
    shadowRadius: 12, elevation: 12, borderTopWidth: 1, borderColor: c.border,
  },
  mapSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sdPinPickup: { width: 24, height: 24, borderRadius: 12, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  sdPinDropoff: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.textPrimary, borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  sdPinLetter: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  eyebrow: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  sdRouteMain: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 3 },
  contactDivider: { height: 1, backgroundColor: c.divider, marginVertical: 14 },

  /* Photo Preview Modal */
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },

  /* Pickup QR & Delivery OTP Modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 360, backgroundColor: c.card, borderRadius: 24, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  modalHeader: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary },
  modalSubtitle: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  qrWrap: { width: 216, height: 216, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 16, marginBottom: 16, backgroundColor: '#FFFFFF', padding: 8 },
  modalDoneBtn: { width: '100%', backgroundColor: c.textPrimary, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  modalDoneBtnText: { color: c.card, fontWeight: '800', fontSize: 14 },
  verifiedBox: { alignItems: 'center', paddingVertical: 20, marginBottom: 14 },
  verifiedText: { fontSize: 15, fontWeight: '800', color: c.success, marginTop: 8 },

  pinRevealBox: {
    width: '100%', backgroundColor: c.accentSoft, borderRadius: 16,
    borderWidth: 1.5, borderColor: ORANGE,
    paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12,
  },
  pinRevealLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 1.2, marginBottom: 6 },
  pinRevealValue: { fontSize: 32, fontWeight: '900', color: c.textPrimary, letterSpacing: 10 },
  pinRevealHint: { fontSize: 11, color: c.textSecondary, marginTop: 8, textAlign: 'center', fontWeight: '600' },

  otpBigBox: {
    backgroundColor: c.accentSoft, borderWidth: 2, borderColor: ORANGE,
    borderRadius: 16, paddingVertical: 20, paddingHorizontal: 16,
    alignItems: 'center', marginBottom: 16, width: '100%',
  },
  otpBigLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 1, marginBottom: 8 },
  otpBigValue: { fontSize: 34, fontWeight: '900', color: c.textPrimary, letterSpacing: 6 },
  otpSendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
    marginBottom: 10, width: '100%',
  },
  otpSendBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  otpCopyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 12, width: '100%',
    borderWidth: 1.5, borderColor: ORANGE, marginBottom: 4,
  },
  otpCopyBtnText: { color: ORANGE, fontSize: 13, fontWeight: '800' },
});