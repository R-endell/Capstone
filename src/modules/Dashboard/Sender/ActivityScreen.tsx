// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing, Modal,
  BackHandler, StatusBar, Platform, Linking, Image, Share, KeyboardAvoidingView, Pressable, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import * as Notifications from 'expo-notifications';
import { supabase } from '../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { notifyUser } from '../../../services/pushService';
import { formatDateTime } from '../../../utils/dateUtils';
import { useSchedule, ShipmentItem } from './Delivery/ScheduleContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';
import { Ionicons } from '@expo/vector-icons';
import { createTicket } from '../../../services/ticketService';
import AsyncStorage from '@react-native-async-storage/async-storage';

const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.png');
const SEARCH_ICON = require('../../../../assets/empty-state-magnifying-glass-icon.png');

const BLUE = '#3B82F6';
const PURPLE = '#8B5CF6';
const CARGO_PHOTO_BUCKET = 'cargo-photos';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const RATING_TAGS = ['On time', 'Careful handling', 'Friendly', 'Fast delivery', 'Good communication'];
const FINDING_PROVIDER_ROUTE_NAMES = ['Booking', 'BookingScreen', 'FindingProvider'];
const REFUND_SEEN_KEY = '@pns/refund_popup_seen_ids';
const EDIT_FLOW_ROUTE_NAMES = ['DropoffType', 'ScheduleDelivery'];

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
      <Text style={{ fontSize: 12, fontFamily: 'Poppins_700Bold', color: tint }}>{label}</Text>
    </View>
  );
};

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
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  fallback_recipient_name?: string | null;
  fallback_action?: string | null;
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
  pod_photo_url?: string | null;
  failure_photo_url?: string | null;
  failure_reason?: string | null;
  pod_seen_by_sender?: boolean;
  pickup_photo_url?: string | null;
  pickup_photo_taken_at?: string | null;
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
  bc_pickup_tx_hash?: string | null;
  bc_dropoff_tx_hash?: string | null;
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
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  hasPreferredProvider: boolean;
  cargo_items: CargoItem[];
  total_items: number;
  weight_kg: number | null;
  fragile: boolean;
  dims: string | null;
  price: string;
  payout_base: number;
  payout_fee: number;
  payout_deposit: number;
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
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { dispatch: scheduleDispatch } = useSchedule();

  const hasLoadedRef = useRef(false);
  // Guards against out-of-order responses when realtime fires several refreshes back-to-back.
  const fetchSeqRef = useRef(0);
  const [deliveries, setDeliveries] = useState<MappedDelivery[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showPickupQR, setShowPickupQR] = useState(false);
  const [showDeliveryOTP, setShowDeliveryOTP] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const selectedDelivery = useMemo(
    () => selectedId == null
      ? null
      : deliveries.find(delivery => delivery.request_id === selectedId) || null,
    [deliveries, selectedId],
  );

  const [activeTab, setActiveTab] = useState<'active' | 'pending' | 'completed' | 'cancelled' | 'all'>('active');
  const [openingChat, setOpeningChat] = useState(false);
  const [approvingHandover, setApprovingHandover] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const copyHashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHash = async (key: string, value?: string | null) => {
    if (!value) return;
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(value);
        setCopiedHash(key);
        if (copyHashTimerRef.current) clearTimeout(copyHashTimerRef.current);
        copyHashTimerRef.current = setTimeout(() => setCopiedHash(null), 1800);
      } else {
        await Share.share({ message: value });
      }
    } catch { /* ignore */ }
  };
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Handover-proof modal (Option B): request_id of the delivery whose proof is being reviewed
  const [handoverProofId, setHandoverProofId] = useState<number | null>(null);
  const [handoverImgLoading, setHandoverImgLoading] = useState(true);
  const [handoverImgFailed, setHandoverImgFailed] = useState(false);
  const handoverAutoShownRef = useRef<Set<number>>(new Set());
  const [pkgItem, setPkgItem] = useState<MappedDelivery | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ratingValue, setRatingValue] = useState(0);
  const [ratingTags, setRatingTags] = useState<string[]>([]);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [ratingSaved, setRatingSaved] = useState<{ rating: number; tags: string[]; comment: string | null } | null>(null);
  const [escrowRow, setEscrowRow] = useState<any>(null);

  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<MappedDelivery | null>(null);
  const [editPickupNote, setEditPickupNote] = useState('');
  const [editDropoffNote, setEditDropoffNote] = useState('');
  const [editReceiverName, setEditReceiverName] = useState('');
  const [editReceiverPhone, setEditReceiverPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  // ------------------------------------------------------------------
  // Refund popup — fires once when the sender returns to the app after
  // a delivery completes with a successful deposit refund.
  // ------------------------------------------------------------------
  const shownRefundIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!deliveries.length) return;

    const candidates = deliveries.filter(d =>
      d.status === 'Completed' &&
      (d.rawData?.refund_status === 'succeeded' || d.rawData?.refund_status === 'refunded') &&
      d.payout_deposit > 0
    );
    if (!candidates.length) return;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(REFUND_SEEN_KEY);
        const persisted: number[] = raw ? JSON.parse(raw) : [];
        const seenThisSession = Array.from(shownRefundIdsRef.current);

        const unseen = candidates.filter(c =>
          !persisted.includes(c.request_id) &&
          !seenThisSession.includes(c.request_id)
        );
        if (!unseen.length) return;

        // Mark immediately to prevent double-fire on concurrent re-renders.
        unseen.forEach(u => shownRefundIdsRef.current.add(u.request_id));

        const most = unseen[0];
        const refundTotal = unseen.reduce((sum, u) => sum + (u.payout_deposit || 0), 0);

        Alert.alert(
          '📦 Delivery Complete!',
          `Package #${trackingCode(most.request_id)} was delivered successfully.\n\n` +
          `₱${refundTotal.toFixed(2)} return deposit has been refunded to your account.`,
          [{ text: 'OK' }],
        );

        const updated = Array.from(new Set([...persisted, ...unseen.map(u => u.request_id)]));
        await AsyncStorage.setItem(REFUND_SEEN_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('[Activity] refund popup failed:', e);
      }
    })();
  }, [deliveries]);

  useEffect(() => {
    const params = route.params;
    if (params?.tab) {
      setActiveTab(params.tab);
    }
    if (params?.openRequestId) {
      setActiveTab('completed');
      setSelectedId(Number(params.openRequestId));
      navigation.setParams({ openRequestId: undefined, tab: undefined });
    }
  }, [route.params, navigation]);

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
      if (editModalVisible) { setEditModalVisible(false); return true; }
      if (pkgItem) { setPkgItem(null); return true; }
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (selectedId != null) { setSelectedId(null); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedId, photoPreview, editModalVisible, pkgItem]);

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const handleResumeFindingProvider = (item: MappedDelivery) => {
    if (item.isMatched) return;
    const target = findRouteOwner(navigation, FINDING_PROVIDER_ROUTE_NAMES);
    if (!target) {
      Alert.alert('Unavailable', 'Could not open the Booking screen.');
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
      return;
    }
    if (item.hasPreferredProvider && item.preferred_provider_id) {
      navigation.navigate('LiveTracking', {
        mode: 'provider',
        providerId: item.preferred_provider_id,
        routeId: item.preferred_route_id,
      });
      return;
    }
    Alert.alert(
      'Live tracking not available yet',
      'Live tracking becomes available once a courier accepts this booking.',
    );
  };

  const fetchUserRecord = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      return userRecord?.user_id || null;
    } catch { return null; }
  };

  const fetchData = async () => {
    const seq = ++fetchSeqRef.current;
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

      const allProviderIds = Array.from(
        new Set([
          ...deliveriesData.map(d => d.provider_id).filter(Boolean),
          ...(requests || []).map((r: any) => r.preferred_provider_id).filter(Boolean),
        ]),
      ) as number[];

      const providerById: Record<number, any> = {};
      if (allProviderIds.length > 0) {
        const { data: providerRows } = await supabase
          .from('users')
          .select('user_id, first_name, last_name, email, phone_number')
          .in('user_id', allProviderIds);
        (providerRows || []).forEach((p: any) => { providerById[p.user_id] = p; });
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

        const prefProviderId: number | null = item.preferred_provider_id ? Number(item.preferred_provider_id) : null;
        const prefRouteId: number | null = item.preferred_route_id ? Number(item.preferred_route_id) : null;
        const hasPreferredProvider = !!prefProviderId;

        let status = item.delivery_status;
        let statusDisplay = status;

        // Source of truth: delivery_status.
        const hasDeliveryRecord = !!delivery;
        const hasCompletedOrReturned =
          status === 'Completed' ||
          status === 'Returned' ||
          !!(delivery as any)?.returned_at ||
          !!delivery?.completed_at;

        // Cancelled in only two cases:
        //   1. delivery_requests.delivery_status is explicitly 'Cancelled'
        //   2. No courier ever picked it up (no delivery row) AND payment was refunded
        const isExplicitlyCancelled = /^cancel/i.test(String(status || ''));
        const refundedWithoutDelivery =
          !hasDeliveryRecord &&
          (
            item.payment_status === 'refunded' ||
            item.escrow_status === 'refunded' ||
            item.refund_status === 'succeeded' ||
            item.refund_status === 'refunded'
          );

        const isCancelledReq =
          !hasCompletedOrReturned && (isExplicitlyCancelled || refundedWithoutDelivery);

        if (isCancelledReq) statusDisplay = 'Cancelled';
        else if (status === 'Returned' || !!(delivery as any)?.returned_at) statusDisplay = 'Returned';
        else if (status === 'Returning') statusDisplay = 'Returning';
        else if (status === 'Awaiting Approval' && !delivery?.completed_at) statusDisplay = 'Awaiting Approval';
        else if (delivery?.completed_at || status === 'Completed') statusDisplay = 'Completed';
        else if (qrRow?.pickup_verified || status === 'In Transit') statusDisplay = 'In Transit';
        else if (status === 'Accepted') statusDisplay = 'In Progress';
        else if (status === 'Pending') {
          statusDisplay = delivery
            ? 'Matched'
            : hasPreferredProvider
              ? 'Waiting for Acceptance'
              : 'Waiting for Provider';
        }

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

        const resolvedProviderId = delivery?.provider_id ?? prefProviderId ?? undefined;
        const resolvedProviderObj = resolvedProviderId ? providerById[resolvedProviderId] : null;
        const resolvedProviderName = resolvedProviderObj
          ? `${resolvedProviderObj.first_name || ''} ${resolvedProviderObj.last_name || ''}`.trim()
          : delivery
            ? 'Courier Assigned'
            : hasPreferredProvider
              ? 'Selected Courier (Awaiting Acceptance)'
              : 'Finding courier...';

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
          provider_name: resolvedProviderName,
          provider_id: resolvedProviderId,
          provider_phone: resolvedProviderObj?.phone_number || null,
          preferred_provider_id: prefProviderId,
          preferred_route_id: prefRouteId,
          hasPreferredProvider,
          payout_base: Number(item.base_fare) || Math.max(0, (Number(item.estimated_cost) || 0) - (Number(item.return_deposit) || 0)),
          payout_fee: Math.round((Number(item.base_fare) || Math.max(0, (Number(item.estimated_cost) || 0) - (Number(item.return_deposit) || 0))) * 0.15 * 100) / 100,
          payout_deposit: Number(item.return_deposit) || 0,
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
            bc_pickup_tx_hash: qrRow.bc_pickup_tx_hash ?? null,
            bc_dropoff_tx_hash: qrRow.bc_dropoff_tx_hash ?? null,
          } : null,
          receiver: receiverInfo,
          confirmation: confirmationRow || null,
        };
      });

      // Ignore stale responses so an older fetch can never overwrite newer realtime data.
      if (seq === fetchSeqRef.current) setDeliveries(mappedDeliveries);
    } catch {
      // Keep showing the last good data on a transient realtime refetch failure.
      if (!hasLoadedRef.current) setDeliveries([]);
    } finally {
      hasLoadedRef.current = true;
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  // ── Realtime: no manual refresh needed ──────────────────────────────────────
  const fetchDataRef = useRef<() => Promise<void>>(async () => {});
  fetchDataRef.current = fetchData;
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Coalesce bursts of DB events (a single approval touches several tables) into one refetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchDataRef.current();
    }, 250);
  }, []);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`sender-activity-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `sender_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escrow_payments' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets', filter: `reporter_id=eq.${userId}` }, scheduleRefresh)
      .subscribe((status) => {
        // Catch up on anything missed while the socket was (re)connecting.
        if (status === 'SUBSCRIBED') scheduleRefresh();
      });

    // Catch up when the app returns to the foreground.
    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') scheduleRefresh();
    });

    return () => {
      if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
      appStateSub.remove();
      supabase.removeChannel(channel);
    };
  }, [userId, scheduleRefresh]);

  useEffect(() => {
    const pending = deliveries.filter(
      (d) => d.isMatched && d.qr?.pickup_verified && !d.deliveryData?.completed_at && !d.confirmation?.system_otp && d.status !== 'Cancelled' && d.status !== 'Awaiting Approval',
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

  const openEditModal = (item: MappedDelivery) => {
    setEditTarget(item);
    setEditPickupNote(item.pickup_note || '');
    setEditDropoffNote(item.dropoff_note || '');
    setEditReceiverName(item.receiver?.receiver_name || '');
    setEditReceiverPhone(item.receiver?.receiver_phone || item.rawData?.receiver_phone || '');
    setEditModalVisible(true);
  };

  const handleSaveQuickEdit = async () => {
    if (!editTarget) return;
    const trimmedPhone = editReceiverPhone.trim();
    if (!trimmedPhone) {
      Alert.alert('Receiver Phone Required', 'Please enter a valid contact number for the receiver.');
      return;
    }

    setEditSaving(true);
    try {
      const reqId = editTarget.request_id;
      const receiverId = editTarget.receiver?.receiver_id ?? editTarget.rawData?.receiver_id ?? null;

      if (receiverId) {
        await supabase
          .from('receivers')
          .update({
            receiver_name: editReceiverName.trim() || 'Receiver',
            receiver_phone: trimmedPhone,
          })
          .eq('receiver_id', receiverId);
      }

      const { error } = await supabase
        .from('delivery_requests')
        .update({
          pickup_note: editPickupNote.trim().slice(0, 200) || null,
          dropoff_note: editDropoffNote.trim().slice(0, 200) || null,
          receiver_phone: trimmedPhone,
        })
        .eq('request_id', reqId);

      if (error) throw error;

      setEditModalVisible(false);
      setEditTarget(null);
      await fetchData();
      Alert.alert('Updated', 'Your delivery details have been updated.');
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update delivery details.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleOpenFullEditWizard = (item: MappedDelivery) => {
    const raw = item.rawData;
    if (!raw) return;

    const cargoObj = Array.isArray(raw.cargo_profiles) ? raw.cargo_profiles[0] : raw.cargo_profiles;
    let parsedItems: ShipmentItem[] = [];
    let rawJson = cargoObj?.items_json;
    if (typeof rawJson === 'string') {
      try { rawJson = JSON.parse(rawJson); } catch { rawJson = null; }
    }
    if (Array.isArray(rawJson) && rawJson.length > 0) {
      parsedItems = rawJson.map((it: any, idx: number) => ({
        id: `edit-${idx}-${Date.now()}`,
        size: (it.size === 'Small' || it.size === 'Medium' || it.size === 'Large') ? it.size : 'Small',
        description: it.description || 'Package',
        photoUri: it.photo || null,
        fragile: !!it.fragile,
      }));
    } else {
      parsedItems = [{
        id: `edit-0-${Date.now()}`,
        size: Number(cargoObj?.large_box_qty) > 0 ? 'Large' : Number(cargoObj?.medium_box_qty) > 0 ? 'Medium' : 'Small',
        description: cargoObj?.description || item.cargo_name || 'Package',
        photoUri: cargoObj?.cargo_pic || null,
        fragile: !!cargoObj?.is_fragile,
      }];
    }

    const editMode = raw.scheduled_time ? 'schedule' : 'sendNow';
    const dropoffType = /door/i.test(String(raw.pickup_type || '')) ? 'door-to-door' : 'curb-side';

    scheduleDispatch({
      type: 'SET_INITIAL_STATE',
      payload: {
        isEdit: true,
        mode: editMode,
        dropoffType,
        items: parsedItems,
        scheduledDate: raw.scheduled_time ? new Date(raw.scheduled_time.replace(' ', 'T')) : null,
        pickupLocation: {
          address: raw.pickup_location?.street_address || item.pickup_main,
          latitude: Number(raw.pickup_location?.latitude) || 10.3157,
          longitude: Number(raw.pickup_location?.longitude) || 123.8854,
          note: raw.pickup_note || undefined,
        },
        dropoffLocation: {
          address: raw.dropoff_location?.street_address || item.dropoff_main,
          latitude: Number(raw.dropoff_location?.latitude) || 10.3157,
          longitude: Number(raw.dropoff_location?.longitude) || 123.8854,
          note: raw.dropoff_note || undefined,
        },
        estimatedCost: Number(raw.estimated_cost) || 0,
        receiver: (item.receiver || null) as any,
        preferredProviderId: item.preferred_provider_id ?? null,
        preferredRouteId: item.preferred_route_id ?? null,
        preferredProviderName: item.hasPreferredProvider ? item.provider_name : null,
      },
    });

    scheduleDispatch({
      type: 'SET_EDIT_DATA',
      payload: {
        requestId: raw.request_id,
        cargoId: raw.cargo_id,
        pickupLocId: raw.pickup_location_id,
        dropoffLocId: raw.dropoff_location_id,
      },
    });

    setEditModalVisible(false);
    setSelectedId(null);

    const target = findRouteOwner(navigation, EDIT_FLOW_ROUTE_NAMES);
    if (target) {
      target.owner.navigate(target.name, { mode: editMode, isEdit: true });
    } else {
      navigation.navigate('DropoffType', { mode: editMode, isEdit: true });
    }
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
          const providerId: number | null = selectedDelivery?.provider_id ?? rawData.preferred_provider_id ?? null;
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
        return Alert.alert('Please wait', 'Chat becomes available as soon as the courier accepts your request.');
      }
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(item.deliveryData.delivery_id);
      if (!roomId) {
        return Alert.alert('Error', 'Could not open chat.');
      }
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

  // Photo the provider took showing where the item was handed over.
  const getHandoverPhoto = (item: MappedDelivery): string | null => {
    const del: any = item.deliveryData || {};
    return del.pod_photo_url || del.failure_photo_url || null;
  };

  const openHandoverProof = (item: MappedDelivery) => {
    setHandoverImgLoading(true);
    setHandoverImgFailed(false);
    setHandoverProofId(item.request_id);
  };

  const closeHandoverProof = () => setHandoverProofId(null);

  // Option B (leave with guard): the sender must approve the handover before escrow is released.
  const isAwaitingApproval = (item: MappedDelivery) =>
    item.status === 'Awaiting Approval' && !item.deliveryData?.completed_at;

  const handleApproveHandover = (item: MappedDelivery) => {
    const deliveryId = item.deliveryData?.delivery_id;
    if (!deliveryId || approvingHandover) return;
    const recipient = item.rawData?.fallback_recipient_name || 'the authorized person';

    Alert.alert(
      'Approve Delivery?',
      `Confirm that your package was left with ${recipient} at the drop-off location. Approving releases the payment to your courier and cannot be undone.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Yes, Approve',
          onPress: async () => {
            setApprovingHandover(true);
            const nowIso = new Date().toISOString();
            try {
              const { error: doneErr } = await supabase
                .from('deliveries')
                .update({ completed_at: nowIso, pod_seen_by_sender: true })
                .eq('delivery_id', deliveryId);
              if (doneErr) throw doneErr;

              const { error: settleErr } = await supabase.rpc('settle_delivery_escrow', {
                p_delivery_id: deliveryId,
                p_outcome: 'completed_safe_drop',
              });
              if (settleErr) {
                // roll back so the sender can retry / dispute
                await supabase.from('deliveries').update({ completed_at: null }).eq('delivery_id', deliveryId);
                throw settleErr;
              }

              await supabase
                .from('delivery_requests')
                .update({ delivery_status: 'Completed' })
                .eq('request_id', item.request_id);

              if (item.provider_id) {
                try {
                  await notifyUser(
                    item.provider_id,
                    'Delivery Approved ✅',
                    `The sender confirmed the handover for #PNS-${String(item.request_id).padStart(4, '0')}. Your payout has been released.`,
                    { deliveryId, requestId: item.request_id, role: 'provider' },
                  );
                } catch { /* non-blocking */ }
              }

              Alert.alert('✅ Delivery Approved', 'Thanks! The payment has been released to your courier.');
              fetchData();
            } catch (e: any) {
              Alert.alert('Could not approve', /unauthorized/i.test(String(e?.message || ''))
                ? 'Your approval could not be processed right now. Please try again in a moment or contact support.'
                : (e?.message || 'Could not approve the delivery. Please try again.'));
            } finally {
              setApprovingHandover(false);
            }
          },
        },
      ],
    );
  };

  const handleDisputePackageMissing = async (item: MappedDelivery) => {
    const deliveryId = item.deliveryData?.delivery_id;
    if (!deliveryId || !userId) return;

    Alert.alert(
      isAwaitingApproval(item) ? 'Package Not Received?' : 'Dispute: Package Missing',
      'This will immediately freeze the Escrow payment and submit the courier’s GPS logs, Call/SMS timestamps, and Proof Photo to Admin Support for review. Proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Freeze Escrow & File Dispute',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error: freezeErr } = await supabase.rpc('settle_delivery_escrow', {
                p_delivery_id: deliveryId,
                p_outcome: 'freeze_dispute',
              });
              if (freezeErr) throw freezeErr;

              const del: any = item.deliveryData || {};
              const raw: any = item.rawData || {};
              const telemetrySummary = [
                `Dispute: Package Missing (#PNS-${String(item.request_id).padStart(4, '0')})`,
                `Fallback Chosen: ${raw.fallback_action || 'return_to_sender'} (${raw.fallback_recipient_name || 'N/A'})`,
                `Drop-off Arrived At: ${del.dropoff_arrived_at || 'N/A'}`,
                `Call Attempted At: ${del.call_receiver_at || 'None'}`,
                `SMS Attempted At: ${del.sms_receiver_at || 'None'}`,
                `Chat Attempted At: ${del.chat_sender_at || 'None'}`,
                `Proof Photo GPS: ${del.failure_photo_lat ?? 'N/A'}, ${del.failure_photo_lng ?? 'N/A'}`,
                `Proof Photo URL: ${del.failure_photo_url || del.pod_photo_url || 'None'}`,
              ].join('\n');

              let createdTicketId: number | null = null;
              try {
                const ticket = await createTicket({
                  type: 'dispute',
                  category: 'Problem with my package',
                  subIssue: 'Marked delivered, but not received',
                  description: telemetrySummary,
                  role: 'sender',
                  deliveryId,
                  requestedResolution: 'Refund',
                  legacyIssueType: 'Not received',
                });
                createdTicketId = ticket.ticket_id;
              } catch {
                const { data: fallbackTicket, error: tErr } = await supabase
                  .from('support_tickets')
                  .insert({
                    type: 'dispute',
                    category: 'Problem with my package',
                    sub_issue: 'Marked delivered, but not received',
                    description: telemetrySummary,
                    requested_resolution: 'Refund',
                    status: 'Open',
                    reporter_id: userId,
                    reporter_role: 'sender',
                    counterparty_id: item.provider_id ?? null,
                    delivery_id: deliveryId,
                    request_id: item.request_id,
                  })
                  .select('ticket_id')
                  .single();
                if (tErr) throw tErr;
                createdTicketId = fallbackTicket.ticket_id;
              }

              Alert.alert(
                '🔒 Escrow Frozen & Dispute Filed',
                `Support Ticket #${createdTicketId} has been created. Admin will review the courier's 10-minute GPS logs, contact logs, and stamped photo.`
              );
              fetchData();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not file dispute.');
            }
          },
        },
      ]
    );
  };

  const stageOf = (item: MappedDelivery): 'pending' | 'pickup' | 'transit' | 'done' | 'cancelled' => {
    if (item.status === 'Cancelled') return 'cancelled';
    if (item.status === 'Completed' || item.status === 'Returned' || !!item.deliveryData?.completed_at) return 'done';
    if (item.qr?.pickup_verified || item.status === 'In Transit' || item.status === 'Returning') return 'transit';
    if (item.isMatched || item.status === 'Matched' || item.status === 'In Progress') return 'pickup';
    return 'pending';
  };

  const statusMeta = (stage: 'pending' | 'pickup' | 'transit' | 'done' | 'cancelled', hasPreferredProvider = false) => {
    switch (stage) {
      case 'done':
        return { label: 'Completed', bg: colors.successBg, fg: colors.success, icon: 'CheckCircle' };
      case 'transit':
        return { label: 'In Transit', bg: colors.accentSoft, fg: colors.accent, icon: 'Routing' };
      case 'pickup':
        return { label: 'Awaiting Pickup', bg: 'rgba(59,130,246,0.14)', fg: BLUE, icon: 'Package' };
      case 'cancelled':
        return { label: 'Cancelled', bg: colors.errorBg, fg: colors.error, icon: 'CloseCircle' };
      case 'pending':
      default:
        return hasPreferredProvider
          ? { label: 'Waiting for Acceptance', bg: 'rgba(59,130,246,0.14)', fg: BLUE, icon: 'Hourglass' }
          : { label: 'Finding Courier', bg: colors.warningBg, fg: colors.warning, icon: 'Hourglass' };
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

  const pkgCount = (item: MappedDelivery) => `${item.total_items} ${item.total_items === 1 ? 'pkg' : 'pkgs'}`;

  const SIZE_META: Record<string, { letter: string; kg: string; color: string; bg: string }> = {
    Small:  { letter: 'S', kg: '~5 kg',  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
    Medium: { letter: 'M', kg: '~15 kg', color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
    Large:  { letter: 'L', kg: '~30 kg', color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
  };

  const sizeCountsOf = (item: MappedDelivery): Record<'Small' | 'Medium' | 'Large', number> => {
    const counts = { Small: 0, Medium: 0, Large: 0 };
    (item.cargo_items || []).forEach((ci: CargoItem) => {
      const k = ci.size as 'Small' | 'Medium' | 'Large' | null | undefined;
      if (k && counts[k] != null) counts[k] += ci.perItem ? 1 : (Number(ci.quantity) || 1);
    });
    return counts;
  };

  const cargoLabel = (item: MappedDelivery) => {
    const c = sizeCountsOf(item);
    const full = (['Small', 'Medium', 'Large'] as const).filter(k => c[k] > 0).map(k => `${c[k]} ${k}`).join(' · ');
    return full || `${item.total_items} ${item.total_items === 1 ? 'item' : 'items'}`;
  };

  const renderServicePill = (item: MappedDelivery) => (
    <View style={styles.svcPill}>
      <SolarIcon name="Package" variant="duotone" size={16} color={BLUE} />
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
        { key: 'p', label: 'PICKUP', main: item.pickup_main, road: item.pickup_road, color: colors.accent, note: item.pickup_note },
        { key: 'd', label: 'DROP-OFF', main: item.dropoff_main, road: item.dropoff_road, color: colors.textPrimary, note: item.dropoff_note },
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <SolarIcon name="MapPoint" variant="linear" size={12} color={colors.textMuted} />
                <Text style={styles.rtSub} numberOfLines={1}>{r.road}</Text>
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
    userId?: number | null;
    deliveryId?: number | null;
    color: string;
    subBadge?: string | null;
  }) => {
    const canCall = !!o.phone;

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
          : [{ text: 'OK' }]
      );
    };

    return (
      <TouchableOpacity style={styles.mcRow} onPress={handlePress} activeOpacity={0.7}>
        <View style={[styles.mcAvatarSmall, { backgroundColor: o.color }]}>
          <Text style={styles.mcAvatarTextSmall}>{initials(o.name)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.mcRoleSmall} numberOfLines={1}>{o.role}</Text>
          <Text style={styles.mcNameSmall} numberOfLines={1}>{o.name || 'N/A'}</Text>
          {!!o.subBadge && (
            <Text style={styles.mcSubBadgeSmall} numberOfLines={1}>{o.subBadge}</Text>
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

  const renderShipmentCard = (item: MappedDelivery) => {
    const stage = stageOf(item);
    const awaitingApproval = isAwaitingApproval(item);
    const meta = awaitingApproval
      ? { label: 'Approve Delivery', bg: colors.warningBg, fg: colors.warning, icon: 'Clock' }
      : statusMeta(stage, item.hasPreferredProvider);
    const isCancelled = stage === 'cancelled';
    const isActive = stage === 'pickup' || stage === 'transit' || stage === 'pending';
    const receiverName = item.receiver?.receiver_name || item.receiver?.receiver_phone || 'Receiver';
    const receiverPhone = item.receiver?.receiver_phone || null;

    const courierName = item.isMatched
      ? item.provider_name
      : item.hasPreferredProvider
        ? item.provider_name
        : 'Searching...';

    const courierSubBadge = !item.isMatched && item.hasPreferredProvider
      ? 'Awaiting acceptance'
      : null;

    return (
      <TouchableOpacity
        key={item.request_id}
        style={[styles.oCard, !isActive && { opacity: 0.92 }]}
        onPress={() => setSelectedId(item.request_id)}
        activeOpacity={0.92}
      >
        <View style={styles.oPad}>
          <View style={styles.oTopRow}>
            {renderServicePill(item)}
            {renderStatusPill(meta)}
          </View>

          {renderRoute(item)}

          {!!item.deliveryData?.pickup_photo_url && (
            <TouchableOpacity
              style={[styles.cardPodBanner, { marginBottom: 8 }]}
              onPress={(e) => {
                e.stopPropagation();
                setPhotoPreview(item.deliveryData?.pickup_photo_url || null);
              }}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: item.deliveryData.pickup_photo_url }}
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

          {stage === 'done' && !!item.deliveryData?.pod_photo_url && (
            <TouchableOpacity
              style={styles.cardPodBanner}
              onPress={(e) => {
                e.stopPropagation();
                setPhotoPreview(item.deliveryData?.pod_photo_url || null);
              }}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: item.deliveryData.pod_photo_url }}
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
              role: 'COURIER',
              name: courierName,
              phone: (item.isMatched || item.hasPreferredProvider) ? (item.provider_phone || null) : null,
              color: BLUE,
              subBadge: courierSubBadge,
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
          <TouchableOpacity style={styles.oChip} onPress={() => setPkgItem(item)} activeOpacity={0.8} hitSlop={6}>
            <SolarIcon name="Package" variant="duotone" size={14} color={colors.accent} />
            <Text style={styles.oChipText} numberOfLines={1}>{pkgCount(item)}</Text>
            <SolarIcon name="AltArrowRight" variant="linear" size={13} color={colors.textMuted} />
          </TouchableOpacity>
          {item.fragile && (
            <View style={styles.oChip}>
              <SolarIcon name="Star" variant="duotone" size={14} color={colors.accent} />
              <Text style={styles.oChipText} numberOfLines={1}>Fragile</Text>
            </View>
          )}
          {!!item.deliveryData?.pickup_photo_url && (
            <View style={[styles.oChip, { borderColor: colors.accent }]}>
              <SolarIcon name="Camera" variant="duotone" size={14} color={colors.accent} />
              <Text style={[styles.oChipText, { color: colors.accent }]} numberOfLines={1}>Pickup</Text>
            </View>
          )}
          {!!item.deliveryData?.pod_photo_url && (
            <View style={[styles.oChip, { borderColor: colors.success }]}>
              <SolarIcon name="Camera" variant="duotone" size={14} color={colors.success} />
              <Text style={[styles.oChipText, { color: colors.success }]} numberOfLines={1}>POD</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text numberOfLines={1} style={[styles.oPrice, isCancelled && { textDecorationLine: 'line-through', color: colors.textMuted }]}>
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
              {openingChat ? <ActivityIndicator size="small" color={colors.accent} /> : (
                <>
                  <SolarIcon name="ChatCircleText" variant="linear" size={16} color={colors.accent} />
                  <Text style={styles.oChatText}>Chat</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.oRouteBtn}
              onPress={() => {
                if (awaitingApproval) { setSelectedId(item.request_id); openHandoverProof(item); }
                else if (stage === 'pickup') setSelectedId(item.request_id); // not picked up yet -> "View" first
                else openLiveTrack(item); // picked up -> Live Track
              }}
              activeOpacity={0.9}
            >
              {!awaitingApproval && stage === 'pickup'
                ? <Ionicons name="eye-outline" size={16} color="#FFFFFF" />
                : <SolarIcon name={awaitingApproval ? 'CheckCircle' : 'Routing'} variant="linear" size={16} color="#FFFFFF" />}
              <Text style={styles.oRouteText}>
                {awaitingApproval ? 'Review & Approve' : stage === 'pickup' ? 'View' : 'Live Track'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'pending' && (
          <View style={styles.oActions}>
            <TouchableOpacity
              style={styles.oChatBtn}
              onPress={() => openEditModal(item)}
              activeOpacity={0.85}
            >
              <SolarIcon name="Pen" variant="linear" size={16} color={colors.accent} />
              <Text style={styles.oChatText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.oRouteBtn}
              onPress={() =>
                item.hasPreferredProvider
                  ? setSelectedId(item.request_id)
                  : handleResumeFindingProvider(item)
              }
              activeOpacity={0.9}
            >
              <SolarIcon
                name={item.hasPreferredProvider ? 'Hourglass' : 'Magnifier'}
                variant="linear"
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.oRouteText}>
                {item.hasPreferredProvider ? 'Awaiting Courier' : 'Find Courier'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

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
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <Animated.View style={{ opacity: contentAnim }}>
          {filteredDeliveries.length === 0 ? (
            <View style={styles.emptyContainer}>
              {deliveries.length === 0 ? (
                <View style={styles.emptyIconCircle}>
                  <SolarIcon name="Package" variant="duotone" size={32} />
                </View>
              ) : (
                <Image
                  source={SEARCH_ICON}
                  style={{ width: 140, height: 140, marginBottom: 20 }}
                  resizeMode="contain"
                />
              )}
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

  /* ---------------- Detail view: package-first, no top map, no Package Photos section ---------------- */
  const renderDetailView = (d: MappedDelivery) => {
    const stage = stageOf(d);
    const awaitingApproval = isAwaitingApproval(d);
    const meta = awaitingApproval
      ? { label: 'Awaiting Your Approval', bg: colors.warningBg, fg: colors.warning, icon: 'Clock' }
      : statusMeta(stage, d.hasPreferredProvider);
    const code = trackingCode(d.request_id);
    const isCancelled = stage === 'cancelled';
    const isCompleted = stage === 'done';
    const isInTransit = stage === 'transit';
    const active = stage === 'pickup' || stage === 'transit' || stage === 'pending';

    const progressSteps = [
      'Placed',
      d.hasPreferredProvider && !d.isMatched ? 'Awaiting' : 'Matched',
      'Picked up',
      'In Transit',
      'Delivered',
    ];
    const doneUpTo = stage === 'done' ? 4 : stage === 'transit' ? 2 : stage === 'pickup' ? 1 : 0;
    const currentStep = stage === 'done' ? -1 : stage === 'transit' ? 3 : stage === 'pickup' ? 2 : 1;

    const vehicle: any = d.deliveryData?.vehicle;
    const podPhotoUrl = getHandoverPhoto(d);
    const pickupPhotoUrl = (d.deliveryData as any)?.pickup_photo_url || null;

    const escrowStatus = String(escrowRow?.escrow_status || escrowRow?.status || d.rawData?.escrow_status || '');
    const released = isCompleted || /complet|releas/i.test(escrowStatus);
    const paymentLabel = isCancelled
      ? 'Refunded / Cancelled'
      : released
        ? 'Released to courier'
        : (d.isMatched || d.rawData?.payment_status === 'held')
          ? 'Held in escrow'
          : 'Awaiting courier';

    const payoutProvider = escrowRow?.payment_method || d.payment_method;

    const recipientName = d.rawData?.fallback_recipient_name || 'the authorized person';
    const hintText = awaitingApproval
      ? `Your courier couldn't reach the receiver and left the package with ${recipientName}. Check the photo below, then approve if it was handed to the right person.`
      : stage === 'pending'
      ? d.hasPreferredProvider
        ? `Sent directly to ${d.provider_name}. Waiting for the provider to accept your delivery request along their route.`
        : 'Looking for a nearby courier partner to accept your delivery request.'
      : stage === 'pickup'
        ? 'Your courier is heading to pickup. Show your Pickup QR or 4-digit PIN when they arrive.'
        : 'Your package is on the way! Share the 6-digit Delivery OTP with the receiver so they can confirm arrival.';

    const canRate = d.isMatched && isCompleted;

    const isReturnedToSender =
      d.status === 'Returned' ||
      !!(d.deliveryData as any)?.returned_at ||
      !!(d.qr as any)?.return_verified;
    const isApprovedSafeDrop =
      d.rawData?.fallback_action === 'leave_with_guard' &&
      isCompleted &&
      !!(d.deliveryData as any)?.failure_reason;
    // Returning: package still with courier -> can dispute. Returned: sender has it back -> no dispute.
    // Awaiting approval: sender may reject the handover by disputing. Approved safe-drop: already confirmed.
    const showDisputeButton =
      !isReturnedToSender &&
      !isApprovedSafeDrop &&
      (isCompleted || d.status === 'Returning' || awaitingApproval);
    const ratingLabels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
    const shownRating = ratingSaved ? ratingSaved.rating : ratingValue;

    const receiverName = d.receiver?.receiver_name || d.receiver?.receiver_phone || 'Receiver';
    const receiverPhone = d.receiver?.receiver_phone || null;

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
          <Text style={styles.dHeaderTitle} numberOfLines={1}>Shipment Details</Text>
          <TouchableOpacity
            style={styles.dRoundBtnInline}
            onPress={() => openLiveTrack(d)}
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
                <SolarIcon name={copied ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
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
                    This shipment was cancelled. Any held escrow payment is being refunded to your account.
                  </Text>
                </View>
              </View>
            ) : isCompleted ? (
              <View style={styles.doneCard}>
                <View style={styles.doneIcon}><SolarIcon name="Check" variant="linear" size={20} color={colors.success} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doneTitle}>
                    {d.status === 'Returned' ? 'Returned to sender' : 'Delivered successfully'}
                  </Text>
                  <Text style={styles.doneSub}>
                    {d.deliveryData?.completed_at ? formatDateTime(d.deliveryData.completed_at) : ''}
                    {released ? (
                      <>
                        {`  ·  ${money(
                          d.status === 'Returned'
                            ? d.payout_base * 0.85 + d.payout_deposit
                            : d.payout_base * 0.85,
                        )} released to courier`}
                        {d.status === 'Returned'
                          ? `  ·  deposit retained by courier for return trip`
                          : `  ·  ${money(d.payout_fee)} platform fee`}
                        {d.status !== 'Returned' && d.payout_deposit > 0 &&
                          `  ·  ${money(d.payout_deposit)} ${
                            d.rawData?.refund_status === 'succeeded'
                              ? 'refunded to you'
                              : d.rawData?.refund_status === 'failed'
                                ? 'refund pending — contact support'
                                : 'being refunded to you'
                          }`}
                      </>
                    ) : ''}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.dHint}>
                <SolarIcon name={d.hasPreferredProvider && !d.isMatched ? 'Hourglass' : 'Info'} variant="duotone" size={18} color={colors.accent} />
                <Text style={styles.dHintText}>{hintText}</Text>
              </View>
            )}

            <View style={{ marginTop: 18 }}>{renderRoute(d, { notes: true })}</View>

            <View style={styles.oContactsRow}>
              {renderMiniContact({
                role: 'COURIER',
                name: (d.isMatched || d.hasPreferredProvider) ? d.provider_name : 'Searching...',
                phone: (d.isMatched || d.hasPreferredProvider) ? (d.provider_phone || null) : null,
                color: BLUE,
                subBadge: !d.isMatched && d.hasPreferredProvider ? 'Waiting for acceptance' : null,
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

            <TouchableOpacity
              style={styles.trackCtaBtn}
              onPress={() => openLiveTrack(d)}
              activeOpacity={0.85}
            >
              <View style={styles.trackCtaIconBox}>
                <SolarIcon name="Routing" variant="duotone" size={22} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackCtaTitle}>Open live tracking</Text>
                <Text style={styles.trackCtaSub}>
                  {d.isMatched
                    ? 'See the courier’s live position on the map.'
                    : 'Live tracking unlocks once a courier accepts this booking.'}
                </Text>
              </View>
              <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.accent} />
            </TouchableOpacity>

            {!!pickupPhotoUrl && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Camera" variant="duotone" size={18} color={colors.accent} />
                  <Text style={styles.dSecTitle}>Proof of Pickup</Text>
                </View>
                <TouchableOpacity
                  style={styles.podPhotoCard}
                  activeOpacity={0.9}
                  onPress={() => setPhotoPreview(pickupPhotoUrl)}
                >
                  <Image
                    source={{ uri: pickupPhotoUrl }}
                    style={styles.podPhotoImg}
                    resizeMode="cover"
                  />
                  <View style={styles.podPhotoOverlay}>
                    <View style={styles.podPhotoBadge}>
                      <SolarIcon name="Maximize" variant="linear" size={13} color="#FFFFFF" />
                      <Text style={styles.podPhotoBadgeText}>Tap to view full photo</Text>
                    </View>
                    {!!(d.deliveryData as any)?.pickup_photo_taken_at && (
                      <Text style={styles.podPhotoTime}>{formatDateTime((d.deliveryData as any).pickup_photo_taken_at)}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}

            {!!podPhotoUrl && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="ShieldCheck" variant="duotone" size={18} color={colors.success} />
                  <Text style={styles.dSecTitle}>{awaitingApproval ? 'Proof of Handover' : 'Proof of Delivery'}</Text>
                  <View style={[styles.sdRatedBadge, { backgroundColor: awaitingApproval ? colors.warningBg : colors.successBg }]}>
                    <SolarIcon name={awaitingApproval ? 'Clock' : 'CheckCircle'} variant="linear" size={12} color={awaitingApproval ? colors.warning : colors.success} />
                    <Text style={[styles.sdRatedBadgeText, { color: awaitingApproval ? colors.warning : colors.success }]}>
                      {awaitingApproval ? 'Needs approval' : 'Verified'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.podPhotoCard}
                  activeOpacity={0.9}
                  onPress={() => (awaitingApproval ? openHandoverProof(d) : setPhotoPreview(podPhotoUrl))}
                >
                  <Image
                    source={{ uri: podPhotoUrl }}
                    style={styles.podPhotoImg}
                    resizeMode="cover"
                  />
                  <View style={styles.podPhotoOverlay}>
                    <View style={styles.podPhotoBadge}>
                      <SolarIcon name="Maximize" variant="linear" size={13} color="#FFFFFF" />
                      <Text style={styles.podPhotoBadgeText}>{awaitingApproval ? 'Tap to review handover proof' : 'Tap to view full photo'}</Text>
                    </View>
                    {!!d.deliveryData?.completed_at && (
                      <Text style={styles.podPhotoTime}>{formatDateTime(d.deliveryData.completed_at)}</Text>
                    )}
                  </View>
                </TouchableOpacity>
              </>
            )}

            <View style={styles.dSecHead}>
              <SolarIcon name="Package" variant="duotone" size={18} />
              <Text style={styles.dSecTitle}>Package Details</Text>
            </View>

            {d.cargo_items.length > 0 && (
              <View style={{ gap: 8, marginBottom: 12 }}>
                {d.cargo_items.map((it, i) => {
                  const meta = it.size ? SIZE_META[it.size] : null;
                  const thumb = (it.photos || [])[0];
                  const showThumb = thumb && !failedPhotos[thumb];
                  return (
                    <View key={i} style={styles.dItemRow}>
                      {showThumb ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setPhotoPreview(thumb)}
                          style={styles.dItemPhotoWrap}
                        >
                          <Image
                            source={{ uri: thumb }}
                            style={styles.dItemPhoto}
                            resizeMode="cover"
                            onError={() => setFailedPhotos(p => ({ ...p, [thumb]: true }))}
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
                          {d.cargo_items.length > 1 ? `Package ${i + 1}` : 'Package'}
                          {it.size ? ` · ${it.size}` : ''}
                          {it.fragile ? ' · Fragile' : ''}
                        </Text>
                        {!!it.name && (
                          <Text style={styles.dItemText} numberOfLines={2}>
                            {it.name}{it.notes ? ` — ${it.notes}` : ''}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>CARGO SIZE</Text>
                <Text style={styles.tileValue} numberOfLines={2}>{cargoLabel(d)}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>WEIGHT</Text>
                <Text style={styles.tileValue}>{d.weight_kg != null ? `${d.weight_kg} kg` : '—'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>HANDLING</Text>
                <Text style={[styles.tileValue, d.fragile && { color: colors.accent }]}>{d.fragile ? 'Fragile' : 'Standard'}</Text>
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

            {(!!(escrowRow?.bc_escrow_tx_hash) || !!(d.qr?.bc_pickup_tx_hash) || !!(d.qr?.bc_dropoff_tx_hash)) && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Link" variant="linear" size={18} color={colors.accent} />
                  <Text style={styles.dSecTitle}>Blockchain Record</Text>
                </View>
                <View style={styles.hashList}>
                {!!(escrowRow?.bc_escrow_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>ESCROW PAYMENT</Text>
                      <Text style={styles.hashValue}>{escrowRow?.bc_escrow_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('escrow', escrowRow?.bc_escrow_tx_hash)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'escrow' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                )}
                {!!(d.qr?.bc_pickup_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>PICKUP VERIFIED</Text>
                      <Text style={styles.hashValue}>{d.qr?.bc_pickup_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('pickup', d.qr?.bc_pickup_tx_hash)}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'pickup' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                )}
                {!!(d.qr?.bc_dropoff_tx_hash) && (
                  <View style={styles.hashRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hashLabel}>DROP-OFF VERIFIED</Text>
                      <Text style={styles.hashValue}>{d.qr?.bc_dropoff_tx_hash}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('dropoff', d.qr?.bc_dropoff_tx_hash)}
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

            {!isCancelled && (
              <>
                <View style={styles.dSecHead}>
                  <SolarIcon name="Star" variant="duotone" size={18} color={colors.accent} />
                  <Text style={styles.dSecTitle}>Rate Your Courier</Text>
                  {!!ratingSaved && (
                    <View style={styles.sdRatedBadge}>
                      <SolarIcon name="CheckCircle" variant="linear" size={12} color={colors.accent} />
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
                        <SolarIcon
                          name="Star"
                          variant={n <= shownRating ? 'duotone' : 'linear'}
                          size={36}
                          color={n <= shownRating ? colors.accent : (isDark ? '#5A3418' : '#FFC9A3')}
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
                      <SolarIcon name="Lock" variant="linear" size={14} color={colors.textMuted} />
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

            {!isCompleted && !isCancelled && !isInTransit && (
              <View style={styles.detailActionsRow}>
                {!d.isMatched && (
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(d)} activeOpacity={0.9}>
                    <SolarIcon name="Pen" variant="linear" size={16} color={colors.accent} />
                    <Text style={styles.editBtnText}>Edit Details</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.sdCancelBtn} onPress={() => handleCancelDelivery(d.rawData)} activeOpacity={0.9}>
                  <SolarIcon name="CloseCircle" variant="linear" size={16} color={colors.error} />
                  <Text style={styles.sdCancelBtnText}>Cancel Booking</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Option B: approve the handover (shown only while awaiting the sender's approval) */}
            {awaitingApproval && d.deliveryData?.delivery_id && (
              <TouchableOpacity
                style={[styles.mPrimaryBtn, { marginTop: 18 }, approvingHandover && { opacity: 0.7 }]}
                onPress={() => handleApproveHandover(d)}
                disabled={approvingHandover}
                activeOpacity={0.9}
              >
                {approvingHandover ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.mPrimaryText}>Approve Delivery &amp; Release Payment</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Dispute is hidden once the package is back with the sender (Returned) and after an approved handover */}
            {showDisputeButton && d.deliveryData?.delivery_id && (
              <TouchableOpacity
                style={[styles.sdCancelBtn, { marginTop: 18, flex: 0 }]}
                onPress={() => handleDisputePackageMissing(d)}
                activeOpacity={0.9}
              >
                <Ionicons name="shield-outline" size={16} color={colors.error} />
                <Text style={styles.sdCancelBtnText}>
                  {awaitingApproval ? 'Not received — Dispute (Freeze Escrow)' : 'Dispute: Package Missing (Freeze Escrow)'}
                </Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        </ScrollView>

        {(stage === 'pickup' || stage === 'transit') && (
          <View style={styles.dBar}>
            <TouchableOpacity
              style={styles.dBarIcon}
              onPress={() => handleMessageProvider(d)}
              disabled={openingChat}
              activeOpacity={0.85}
            >
              {openingChat ? <ActivityIndicator size="small" color={colors.accent} /> : <SolarIcon name="ChatCircleText" variant="linear" size={20} color={colors.accent} />}
            </TouchableOpacity>
            {stage === 'transit' && (
              <TouchableOpacity
                style={[styles.mSoftBtn, { flex: 1 }]}
                onPress={() => openLiveTrack(d)}
                activeOpacity={0.85}
              >
                <SolarIcon name="Routing" variant="linear" size={16} color={colors.accent} />
                <Text style={styles.mSoftText}>Track</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }, awaitingApproval && approvingHandover && { opacity: 0.7 }]}
              disabled={awaitingApproval && approvingHandover}
              onPress={() =>
                awaitingApproval
                  ? (getHandoverPhoto(d) ? openHandoverProof(d) : handleApproveHandover(d))
                  : stage === 'pickup' || d.status === 'Returning'
                    ? setShowPickupQR(true)
                    : setShowDeliveryOTP(true)
              }
              activeOpacity={0.9}
            >
              <Ionicons
                name={
                  awaitingApproval
                    ? 'checkmark-circle'
                    : stage === 'pickup' || d.status === 'Returning'
                      ? 'qr-code-outline'
                      : 'key-outline'
                }
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.mPrimaryText}>
                {awaitingApproval
                  ? (getHandoverPhoto(d) ? 'Review & Approve' : 'Approve Delivery')
                  : stage === 'pickup'
                    ? 'Pickup QR'
                    : d.status === 'Returning'
                      ? 'Return QR / PIN'
                      : 'Delivery OTP'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {stage === 'pending' && (
          <View style={styles.dBar}>
            <TouchableOpacity
              style={[styles.mSoftBtn, { flex: 1 }]}
              onPress={() => openEditModal(d)}
              activeOpacity={0.85}
            >
              <SolarIcon name="Pen" variant="linear" size={16} color={colors.accent} />
              <Text style={styles.mSoftText}>Edit Request</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }]}
              onPress={() =>
                d.hasPreferredProvider
                  ? openLiveTrack(d)
                  : handleResumeFindingProvider(d)
              }
              activeOpacity={0.9}
            >
              <SolarIcon
                name={d.hasPreferredProvider ? 'Routing' : 'Magnifier'}
                variant="linear"
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.mPrimaryText}>
                {d.hasPreferredProvider ? 'Track Provider' : 'Find Courier'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  /* --------------------------- Modals --------------------------- */
  const renderEditModal = () => {
    if (!editTarget) return null;
    const isPaid =
      editTarget.rawData?.payment_status === 'held' ||
      editTarget.rawData?.escrow_status === 'held';

    return (
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={[styles.modalCard, { maxWidth: 400, alignItems: 'stretch' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Shipment #{trackingCode(editTarget.request_id)}</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSubtitle, { textAlign: 'left', marginBottom: 14 }]}>
              Update receiver contact info or instructions for your courier.
            </Text>

            <Text style={styles.editFieldLabel}>RECEIVER NAME</Text>
            <TextInput
              style={styles.editInput}
              value={editReceiverName}
              onChangeText={setEditReceiverName}
              placeholder="Receiver's full name"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.editFieldLabel}>RECEIVER PHONE</Text>
            <TextInput
              style={styles.editInput}
              value={editReceiverPhone}
              onChangeText={setEditReceiverPhone}
              keyboardType="phone-pad"
              placeholder="09XXXXXXXXX"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.editFieldLabel}>PICKUP NOTE (OPTIONAL)</Text>
            <TextInput
              style={[styles.editInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={editPickupNote}
              onChangeText={setEditPickupNote}
              multiline
              maxLength={200}
              placeholder="Gate color, landmark, instructions for pickup..."
              placeholderTextColor={colors.textMuted}
            />

            <Text style={styles.editFieldLabel}>DROP-OFF NOTE (OPTIONAL)</Text>
            <TextInput
              style={[styles.editInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={editDropoffNote}
              onChangeText={setEditDropoffNote}
              multiline
              maxLength={200}
              placeholder="Floor, unit number, guardhouse instructions..."
              placeholderTextColor={colors.textMuted}
            />

            <TouchableOpacity
              style={[styles.mPrimaryBtn, { marginTop: 8 }, editSaving && { opacity: 0.7 }]}
              onPress={handleSaveQuickEdit}
              disabled={editSaving}
              activeOpacity={0.9}
            >
              {editSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <SolarIcon name="CheckCircle" variant="linear" size={18} color="#FFFFFF" />
                  <Text style={styles.mPrimaryText}>Save Changes</Text>
                </>
              )}
            </TouchableOpacity>

            {!isPaid && (
              <TouchableOpacity
                style={[styles.mSoftBtn, { marginTop: 10, flex: 0 }]}
                onPress={() => handleOpenFullEditWizard(editTarget)}
                activeOpacity={0.85}
              >
                <SolarIcon name="MapPoint" variant="linear" size={16} color={colors.accent} />
                <Text style={styles.mSoftText}>Change Route / Package Items</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
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
              <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
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
            <ActivityIndicator color={colors.accent} style={{ margin: 40 }} />
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
                <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {verified
                ? 'The receiver has confirmed this delivery.'
                : 'Send this 6-digit code to the receiver. They will read it to the courier on arrival.'}
            </Text>

            {verified ? (
              <View style={styles.verifiedBox}>
                <SolarIcon name="CheckCircle" variant="duotone" size={40} color={colors.success} />
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
                    <SolarIcon name="PaperPlane" variant="linear" size={16} color="#FFF" />
                    <Text style={styles.otpSendBtnText}>Send SMS to {receiverName}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={styles.otpCopyBtn} onPress={copySMS} disabled={!otp} activeOpacity={0.85}>
                  <SolarIcon name="Copy" variant="linear" size={16} color={colors.accent} />
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

  const renderPkgModal = () => {
    const item = pkgItem;
    const counts = item ? sizeCountsOf(item) : { Small: 0, Medium: 0, Large: 0 };
    const rows = (['Small', 'Medium', 'Large'] as const).filter(k => counts[k] > 0);
    return (
      <Modal visible={!!item} transparent animationType="fade" onRequestClose={() => setPkgItem(null)}>
        <Pressable style={styles.pkgOverlay} onPress={() => setPkgItem(null)}>
          <Pressable style={styles.pkgCard} onPress={() => { /* keep open */ }}>
            <View style={styles.pkgHead}>
              <Text style={styles.pkgTitle}>{item ? pkgCount(item) : ''} in this order</Text>
              <TouchableOpacity onPress={() => setPkgItem(null)} hitSlop={10}>
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
                  <Text style={styles.pkgSub}>{SIZE_META[k].kg} each</Text>
                </View>
                <Text style={styles.pkgQty}>×{counts[k]}</Text>
              </View>
            ))}
          </Pressable>
        </Pressable>
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
          <SolarIcon name="CloseCircle" variant="linear" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );

  // Auto-open the proof modal once per delivery as soon as it reaches "Awaiting Approval" (works in real time).
  useEffect(() => {
    if (isLoading) return;
    const next = deliveries.find(d =>
      d.status === 'Awaiting Approval' &&
      !d.deliveryData?.completed_at &&
      !!((d.deliveryData as any)?.pod_photo_url || (d.deliveryData as any)?.failure_photo_url) &&
      !handoverAutoShownRef.current.has(d.request_id),
    );
    if (next) {
      handoverAutoShownRef.current.add(next.request_id);
      setHandoverImgLoading(true);
      setHandoverImgFailed(false);
      setHandoverProofId(next.request_id);
    }
  }, [deliveries, isLoading]);

  // Close the modal automatically once the delivery is no longer awaiting approval (approved / disputed elsewhere).
  useEffect(() => {
    if (handoverProofId == null) return;
    const d = deliveries.find(x => x.request_id === handoverProofId);
    if (!d || d.status !== 'Awaiting Approval' || !!d.deliveryData?.completed_at) {
      setHandoverProofId(null);
    }
  }, [deliveries, handoverProofId]);

  const renderHandoverProofModal = () => {
    const item = handoverProofId == null ? null : deliveries.find(d => d.request_id === handoverProofId) || null;
    const photo = item ? getHandoverPhoto(item) : null;
    const visible = !!item && !!photo;
    const recipient = item?.rawData?.fallback_recipient_name || 'the authorized person';
    const senderNote: string | null = item?.rawData?.dropoff_note || null;
    const takenAt: string | null = (item?.deliveryData as any)?.failed_at || (item?.deliveryData as any)?.dropoff_arrived_at || null;

    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={closeHandoverProof}>
        <View style={styles.hpOverlay}>
          <View style={[styles.hpCard, { maxHeight: '92%' }]}>
            <View style={styles.hpHeader}>
              <View style={styles.hpHeaderIcon}>
                <SolarIcon name="ShieldCheck" variant="duotone" size={20} color={colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.hpTitle}>Proof of Handover</Text>
                <Text style={styles.hpSubtitle}>
                  {item ? `${trackingCode(item.request_id)} • Awaiting your approval` : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.hpCloseBtn} onPress={closeHandoverProof} activeOpacity={0.8}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
              <Text style={styles.hpCaption}>
                This is the photo taken by your courier showing where the item was handed over, based on your drop-off notes.
              </Text>

              <TouchableOpacity
                style={styles.hpPhotoWrap}
                activeOpacity={0.92}
                onPress={() => photo && setPhotoPreview(photo)}
              >
                {!!photo && !handoverImgFailed && (
                  <Image
                    source={{ uri: photo }}
                    style={styles.hpPhoto}
                    resizeMode="cover"
                    onLoadStart={() => setHandoverImgLoading(true)}
                    onLoadEnd={() => setHandoverImgLoading(false)}
                    onError={() => { setHandoverImgFailed(true); setHandoverImgLoading(false); }}
                  />
                )}
                {handoverImgLoading && !handoverImgFailed && (
                  <View style={styles.hpPhotoLoading}>
                    <ActivityIndicator color={colors.accent} />
                  </View>
                )}
                {handoverImgFailed && (
                  <View style={styles.hpPhotoLoading}>
                    <Ionicons name="image-outline" size={34} color={colors.textMuted} />
                    <Text style={[styles.hpMetaLabel, { marginTop: 8 }]}>PHOTO COULD NOT BE LOADED</Text>
                  </View>
                )}
                {!handoverImgFailed && (
                  <View style={styles.hpPhotoBadge}>
                    <Ionicons name="expand-outline" size={13} color="#FFFFFF" />
                    <Text style={styles.hpPhotoBadgeText}>Tap to enlarge</Text>
                  </View>
                )}
              </TouchableOpacity>

              <View style={styles.hpMetaBox}>
                <View style={styles.hpMetaRow}>
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hpMetaLabel}>LEFT WITH</Text>
                    <Text style={styles.hpMetaValue}>{recipient}</Text>
                  </View>
                </View>
                {!!senderNote && (
                  <View style={[styles.hpMetaRow, styles.hpMetaRowBorder]}>
                    <Ionicons name="document-text-outline" size={16} color={colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hpMetaLabel}>YOUR DROP-OFF NOTE</Text>
                      <Text style={styles.hpMetaValue}>{senderNote}</Text>
                    </View>
                  </View>
                )}
                {!!takenAt && (
                  <View style={[styles.hpMetaRow, styles.hpMetaRowBorder]}>
                    <Ionicons name="time-outline" size={16} color={colors.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hpMetaLabel}>PHOTO TAKEN</Text>
                      <Text style={styles.hpMetaValue}>{formatDateTime(takenAt)}</Text>
                    </View>
                  </View>
                )}
              </View>

              <Text style={styles.hpHint}>
                Approving confirms the package was left with the right person and releases the payment to your courier. This cannot be undone.
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.mPrimaryBtn, { marginTop: 14 }, approvingHandover && { opacity: 0.7 }]}
              disabled={approvingHandover || !item}
              activeOpacity={0.9}
              onPress={() => {
                if (!item) return;
                closeHandoverProof();
                // let the modal dismiss before the confirmation alert appears (iOS)
                setTimeout(() => handleApproveHandover(item), 350);
              }}
            >
              {approvingHandover ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.mPrimaryText}>Approve &amp; Release Payment</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sdCancelBtn, { marginTop: 10, flex: 0 }]}
              activeOpacity={0.9}
              onPress={() => {
                if (!item) return;
                closeHandoverProof();
                setTimeout(() => handleDisputePackageMissing(item), 350);
              }}
            >
              <Ionicons name="shield-outline" size={16} color={colors.error} />
              <Text style={styles.sdCancelBtnText}>Not received — Dispute</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hpLaterBtn} onPress={closeHandoverProof} activeOpacity={0.7}>
              <Text style={styles.hpLaterText}>Review later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.safeArea, styles.loadingContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading shipments...</Text>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {selectedDelivery ? renderDetailView(selectedDelivery) : renderListView()}
      {renderEditModal()}
      {renderPickupQRModal()}
      {renderDeliveryOTPModal()}
      {renderHandoverProofModal()}
      {renderPhotoPreviewModal()}
      {renderPkgModal()}
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
    letterSpacing: -0.3
  },
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
  emptyIconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  emptySubtext: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 20 },

  svcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  svcPillText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: BLUE },
  stPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  stDot: { width: 7, height: 7, borderRadius: 4 },
  stPillText: { fontSize: 11, fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 },

  rtRow: { flexDirection: 'row', gap: 14 },
  rtRail: { alignItems: 'center', width: 26 },
  rtRing: { width: 26, height: 26, borderRadius: 13, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  rtRingDot: { width: 8, height: 8, borderRadius: 4 },
  rtDots: { position: 'absolute', top: 30, bottom: -4, alignItems: 'center', justifyContent: 'space-evenly' },
  rtDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.border },
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
    backgroundColor: c.card, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 1, elevation: 0,
  },
  oPad: { padding: 20 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },

  oContactsRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  mcRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  mcAvatarSmall: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mcAvatarTextSmall: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Poppins_700Bold' },
  mcRoleSmall: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.4 },
  mcNameSmall: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  mcSubBadgeSmall: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: BLUE, marginTop: 1 },
  mcCallSmall: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  mCancelledText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.error, marginTop: 12 },

  oFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
  oChip: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  oChipText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  oPrice: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2, flexShrink: 0 },
  oActions: { flexDirection: 'row', gap: 12, padding: 16, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)' },
  oChatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 16 },
  oChatText: { color: c.accent, fontSize: 14, fontFamily: 'Poppins_700Bold' },
  oRouteBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16 },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },

  /* Detail view (package-first, no top map) */
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

  sizeBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  pkgOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  pkgCard: { backgroundColor: c.card, borderRadius: 16, padding: 24 },
  pkgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  pkgTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  pkgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.divider },
  pkgName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  pkgSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  pkgQty: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  hashList: { gap: 10 },
  hashRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12, paddingVertical: 12, paddingLeft: 14, paddingRight: 10 },
  hashLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  hashValue: { fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 4 },
  hashCopyBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 16 },
  tileLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  tileValue: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 6 },

  sdCardInner: { backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 16 },
  sdRatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sdRatedBadgeText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.accent },
  sdStarsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 4 },
  sdRatingLabel: { textAlign: 'center', fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.accent, marginTop: 8 },
  sdLockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  sdLockedNoteText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textMuted },
  sdTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  sdTag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', backgroundColor: c.card },
  sdTagOn: { backgroundColor: c.accentSoft, borderColor: c.accent },
  sdTagText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  sdTagTextOn: { color: c.accent },
  sdCommentInput: {
    marginTop: 14, minHeight: 74, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textPrimary,
    backgroundColor: c.card, textAlignVertical: 'top',
  },
  sdThanks: { marginTop: 4 },
  sdThanksComment: { marginTop: 12, fontSize: 13, fontFamily: 'Poppins_400Regular', fontStyle: 'italic', textAlign: 'center', color: c.textSecondary },
  sdThanksText: { marginTop: 10, textAlign: 'center', fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textMuted },

  detailActionsRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.accentSoft, paddingVertical: 14, borderRadius: 14,
  },
  editBtnText: { color: c.accent, fontFamily: 'Poppins_700Bold', fontSize: 14 },
  sdCancelBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
  },
  sdCancelBtnText: { color: c.error, fontFamily: 'Poppins_700Bold', fontSize: 14 },

  trackCtaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18,
    backgroundColor: c.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  trackCtaIconBox: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  trackCtaTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  trackCtaSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  editFieldLabel: {
    fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8, marginBottom: 6, marginTop: 10,
  },
  editInput: {
    borderWidth: 1.5, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textPrimary,
    backgroundColor: c.background, marginBottom: 6,
  },

  dBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  dBarIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  mPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, paddingVertical: 14, borderRadius: 12 },
  mPrimaryText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },
  mSoftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentSoft, paddingVertical: 14, borderRadius: 12 },
  mSoftText: { color: c.accent, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },

  hpOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  hpCard: { width: '100%', maxWidth: 400, backgroundColor: c.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  hpHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  hpHeaderIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.warningBg, alignItems: 'center', justifyContent: 'center' },
  hpTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  hpSubtitle: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.warning, marginTop: 1 },
  hpCloseBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
  hpCaption: { fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginBottom: 12 },
  hpPhotoWrap: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14, overflow: 'hidden', backgroundColor: c.background, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  hpPhoto: { width: '100%', height: '100%' },
  hpPhotoLoading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background },
  hpPhotoBadge: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  hpPhotoBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_600SemiBold' },
  hpMetaBox: { marginTop: 12, backgroundColor: c.background, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', paddingHorizontal: 14 },
  hpMetaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12 },
  hpMetaRowBorder: { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  hpMetaLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  hpMetaValue: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 2 },
  hpHint: { fontSize: 12, lineHeight: 17, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 12 },
  hpLaterBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 2 },
  hpLaterText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 360, backgroundColor: c.card, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  modalHeader: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  modalSubtitle: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  qrWrap: { width: 216, height: 216, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 16, marginBottom: 16, backgroundColor: '#FFFFFF', padding: 8 },
  modalDoneBtn: { width: '100%', backgroundColor: c.textPrimary, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  modalDoneBtnText: { color: c.card, fontFamily: 'Poppins_700Bold', fontSize: 15 },
  verifiedBox: { alignItems: 'center', paddingVertical: 20, marginBottom: 14 },
  verifiedText: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.success, marginTop: 12 },

  pinRevealBox: {
    width: '100%', backgroundColor: c.accentSoft, borderRadius: 12,
    borderWidth: 1.5, borderColor: c.accent,
    paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12,
  },
  pinRevealLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.accent, letterSpacing: 1.2, marginBottom: 6 },
  pinRevealValue: { fontSize: 32, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: 10 },
  pinRevealHint: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 8, textAlign: 'center' },

  otpBigBox: {
    backgroundColor: c.accentSoft, borderWidth: 2, borderColor: c.accent,
    borderRadius: 12, paddingVertical: 20, paddingHorizontal: 16,
    alignItems: 'center', marginBottom: 16, width: '100%',
  },
  otpBigLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.accent, letterSpacing: 1, marginBottom: 8 },
  otpBigValue: { fontSize: 34, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: 6 },
  otpSendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.accent, borderRadius: 12, paddingVertical: 14,
    marginBottom: 10, width: '100%',
  },
  otpSendBtnText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 14 },
  otpCopyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, borderRadius: 12, paddingVertical: 12, width: '100%',
    borderWidth: 1.5, borderColor: c.accent, marginBottom: 4,
  },
  otpCopyBtnText: { color: c.accent, fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
});