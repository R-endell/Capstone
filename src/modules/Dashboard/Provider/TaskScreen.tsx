// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing,
  Dimensions, Image, Linking, Share, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NavigationMap, { NavInfo } from '../../../components/map/NavigationMap';
import RoutePreviewMap from '../../../components/map/RoutePreviewMap';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { formatDate, formatDateTime } from '../../../utils/dateUtils';
import {
  getProviderDeliveries,
  getNearbyUnmatchedRequests,
  NearbyRequestResult,
} from '../../../services/matchingService';
import { getActiveRouteId } from '../../../services/activeRouteStore';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { useProviderLocationBroadcast } from '../../../services/useProviderLocationBroadcast';
import { useNavigationSession } from '../../../services/navigationSessionStore';
import { clearLocationFix } from '../../../services/locationService';
import { notifyUser } from '../../../services/pushService';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.jpeg');

const ORANGE = '#FF751F';
const CARGO_PHOTO_BUCKET = 'cargo-photos';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }
const { width: SCREEN_W } = Dimensions.get('window');
const frameSize = Math.min(SCREEN_W * 0.72, 280);

const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

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

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */
const hydrateQr = async (deliveries: any[]) => {
  if (!deliveries || deliveries.length === 0) return deliveries;
  const ids = deliveries.map(d => d.delivery_id).filter(Boolean);
  if (ids.length === 0) return deliveries;

  const { data: qrRows } = await supabase.from('qr_verifications').select('*').in('delivery_id', ids);
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

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
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

const buildTaskInfo = (d: any) => {
  const request = d?.delivery_requests || null;
  const cargo = Array.isArray(request?.cargo) ? request.cargo[0] : request?.cargo;
  const receiver = Array.isArray(request?.receiver) ? request.receiver[0] : request?.receiver;
  const pickup = splitAddress(request?.pickup_location?.street_address);
  const dropoff = splitAddress(request?.dropoff_location?.street_address);
  const items = buildCargoItems(cargo);
  const qtyTotal = (Number(cargo?.small_box_qty) || 0) + (Number(cargo?.medium_box_qty) || 0) + (Number(cargo?.large_box_qty) || 0);
  const dims = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const sender = d?.sender || null;

  const pickupRoad = [request?.pickup_location?.road, request?.pickup_location?.barangay].filter(Boolean).join(', ');
  const dropoffRoad = [request?.dropoff_location?.road, request?.dropoff_location?.barangay].filter(Boolean).join(', ');

  return {
    request,
    cargo,
    receiver,
    pickup: { ...pickup, lat: request?.pickup_location?.latitude ?? null, lng: request?.pickup_location?.longitude ?? null, road: pickupRoad || pickup.sub },
    dropoff: { ...dropoff, lat: request?.dropoff_location?.latitude ?? null, lng: request?.dropoff_location?.longitude ?? null, road: dropoffRoad || dropoff.sub },
    pickupNote: (request?.pickup_note as string | null) || null,
    dropoffNote: (request?.dropoff_note as string | null) || null,
    items,
    totalItems: items.length > 1 ? items.length : (qtyTotal || items.length),
    weightKg: cargo?.total_weight_kg != null ? Number(cargo.total_weight_kg) : null,
    fragile: items.some((i: any) => i.fragile) || !!cargo?.is_fragile,
    dims: dims.every(v => Number(v) > 0) ? `${dims[0]} × ${dims[1]} × ${dims[2]} cm` : null,
    receiverName: receiver?.receiver_name || null,
    receiverPhone: request?.receiver_phone || receiver?.receiver_phone || null,
    senderName: sender ? [sender.first_name, sender.last_name].filter(Boolean).join(' ') || null : null,
    senderPhone: sender?.phone_number || null,
    earnings: Number(request?.estimated_cost) || 0,
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
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, phone_number').in('user_id', senderIds as number[]);
      (data || []).forEach((u: any) => { senders[u.user_id] = u; });
    }
  } catch { }
  try {
    if (deliveryIds.length) {
      const { data } = await supabase.from('escrow_payments').select('delivery_id, amount, escrow_status').in('delivery_id', deliveryIds);
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

const enrichNearbyRequests = async (nearbyList: NearbyRequestResult[], providerId: number) => {
  if (!nearbyList || nearbyList.length === 0) return [];
  const senderIds = Array.from(new Set(nearbyList.map(n => n.request?.sender_id).filter(Boolean)));
  const senders: Record<number, any> = {};
  try {
    if (senderIds.length) {
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, phone_number').in('user_id', senderIds as number[]);
      (data || []).forEach((u: any) => { senders[u.user_id] = u; });
    }
  } catch { }

  return nearbyList.map(n => {
    const isDirect =
      !!n.isDirectRequest ||
      (n.request?.preferred_provider_id != null && Number(n.request.preferred_provider_id) === Number(providerId));

    return {
      ...n,
      syntheticDelivery: {
        delivery_id: -n.request.request_id, // negative ID distinguishes nearby/direct preview from accepted delivery
        request_id: n.request.request_id,
        delivery_requests: n.request,
        sender: senders[n.request.sender_id] || null,
        escrow: n.request.payment_provider ? { payment_method: n.request.payment_provider } : null,
        nearbyMeta: {
          route: n.route,
          pickupDistToCorridorKm: n.pickupDistToCorridorKm,
          dropoffDistToCorridorKm: n.dropoffDistToCorridorKm,
          extraDetourKm: n.extraDetourKm,
          isDirectRequest: isDirect,
        },
      },
    };
  });
};

/* ==================================================================== */
/* Cancellation detection                                               */
/* ==================================================================== */
const isCancelledDelivery = (d: any): boolean => {
  if (!d) return false;
  const req = d.delivery_requests || {};
  const status = String(req.delivery_status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled') return true;

  const escrowStatus = String(d.escrow?.escrow_status || '').toLowerCase();
  if (escrowStatus === 'refunded' || escrowStatus === 'cancelled' || escrowStatus === 'canceled') return true;

  const paymentStatus = String(req.payment_status || '').toLowerCase();
  if (paymentStatus === 'refunded') return true;

  const refundStatus = String(req.refund_status || '').toLowerCase();
  if (refundStatus === 'succeeded' || refundStatus === 'completed' || refundStatus === 'refunded') return true;

  return false;
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
      <Text style={{ fontSize: 12, fontWeight: '800', color: tint }}>{label}</Text>
    </View>
  );
};

/* ==================================================================== */
/* TaskScreen                                                           */
/* ==================================================================== */
const BLUE = '#3B82F6';
const RED = '#EF4444';
const PURPLE = '#8B5CF6';
const BLACK = '#111827';
const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

type TabType = 'active' | 'nearby' | 'completed' | 'cancelled' | 'all';

export default function TaskScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const hasLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<any[]>([]);
  const [cancelledDeliveries, setCancelledDeliveries] = useState<any[]>([]);
  const [nearbyDeliveries, setNearbyDeliveries] = useState<any[]>([]);
  const [acceptingRequestId, setAcceptingRequestId] = useState<number | null>(null);
  const [userData, setUserData] = useState<any>(null);

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
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [navInfo, setNavInfo] = useState<NavInfo>({ distanceM: null, durationS: null });
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [openingChat, setOpeningChat] = useState(false);

  const [deliveryOTPModalVisible, setDeliveryOTPModalVisible] = useState(false);
  const [deliveryOTPTarget, setDeliveryOTPTarget] = useState<any>(null);
  const [deliveryOTPInput, setDeliveryOTPInput] = useState('');
  const [deliveryOTPVerifying, setDeliveryOTPVerifying] = useState(false);
  const [deliveryOTPResending, setDeliveryOTPResending] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    if (selectedId == null) return;
    detailAnim.setValue(0);
    Animated.timing(detailAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [selectedId, detailAnim]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (mapModalVisible) { setMapModalVisible(false); return true; }
      if (selectedId != null) { setSelectedId(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [photoPreview, mapModalVisible, selectedId]);

  useEffect(() => {
    if (!verifyModalVisible) return;
    scanLineAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [verifyModalVisible, scanLineAnim]);

  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData } = await supabase.from('users').select('*').eq('auth_id', user.id).single();
      setUserData(userData);
      setProviderId(userData.user_id);
      return userData.user_id;
    } catch { return null; }
  };

  const fetchDeliveries = async (pid: number) => {
    try {
      const [deliveries, rawNearby] = await Promise.all([
        getProviderDeliveries(pid),
        getNearbyUnmatchedRequests(pid),
      ]);

      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) =>
        a.findIndex(t => (t.request_id === v.request_id)) === i,
      );

      const hydrated = await enrichDeliveries(await hydrateQr(uniqueDeliveries));

      const cancelled = hydrated.filter(isCancelledDelivery);
      const completed = hydrated.filter(d => !isCancelledDelivery(d) && !!d.completed_at);
      const acceptedActive = hydrated.filter(d => !isCancelledDelivery(d) && !d.completed_at);

      const enrichedNearby = await enrichNearbyRequests(rawNearby, pid);
      const nearbySynthetics = enrichedNearby.map(n => n.syntheticDelivery);

      // Direct requests (where sender explicitly selected this provider) appear at the top of Active
      // as "Waiting for Acceptance", as well as in Nearby
      const directAwaitingSynthetics = nearbySynthetics.filter(s => s?.nearbyMeta?.isDirectRequest);

      setActiveDeliveries([...directAwaitingSynthetics, ...acceptedActive]);
      setCompletedDeliveries(completed);
      setCancelledDeliveries(cancelled);
      setNearbyDeliveries(nearbySynthetics);
    } catch (error) {
      console.error('Error fetching deliveries:', error);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Accept Nearby / Direct Delivery Request                            */
  /* ------------------------------------------------------------------ */
  const doAcceptNearbyRequest = async (syntheticTask: any) => {
    const req = syntheticTask?.delivery_requests;
    if (!providerId || !req) return;

    setAcceptingRequestId(req.request_id);
    try {
      // 1. Resolve verified vehicle (or fallback to any vehicle owned by provider)
      const { data: v } = await supabase
        .from('vehicles')
        .select('vehicle_id')
        .eq('provider_id', providerId)
        .eq('verification_status', 'Verified')
        .limit(1)
        .maybeSingle();

      let vehicleId = v?.vehicle_id ?? syntheticTask?.nearbyMeta?.route?.vehicle_id ?? null;
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
        Alert.alert('Vehicle Not Found', 'You need a registered vehicle before you can accept deliveries.');
        return;
      }

      // 2. Resolve route_id (preferred_route_id -> nearbyMeta route -> active route -> latest route)
      let routeId: number | null =
        req.preferred_route_id ||
        syntheticTask?.nearbyMeta?.route?.route_id ||
        (await getActiveRouteId());
      if (!routeId) {
        const { data: latestRoute } = await supabase
          .from('provider_routes')
          .select('route_id')
          .eq('provider_id', providerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        routeId = latestRoute?.route_id ?? null;
      }

      // 3. Ensure request is still Pending & unassigned
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
        Alert.alert('Request Unavailable', 'This delivery request was already accepted or cancelled.');
        await fetchDeliveries(providerId);
        return;
      }

      // 4. Create delivery row
      const { data: delivery, error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          request_id: req.request_id,
          provider_id: providerId,
          vehicle_id: vehicleId,
          route_id: routeId,
          accepted_at: new Date().toISOString(),
          estimated_eta: new Date(Date.now() + 3600000).toISOString(),
        })
        .select('*')
        .single();
      if (deliveryError) throw deliveryError;

      // 5. Generate QR verifications & PINs
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

      // 6. Update delivery_requests status
      const { error: reqUpdateError } = await supabase
        .from('delivery_requests')
        .update({ delivery_status: 'Accepted' })
        .eq('request_id', req.request_id);
      if (reqUpdateError) throw reqUpdateError;

      // 7. Create escrow payment hold
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

        // Notify sender
        if (requestData.sender_id) {
          const code = trackingCode(req.request_id);
          notifyUser(
            requestData.sender_id,
            'Courier Accepted Your Delivery! 🚚',
            `Your courier accepted parcel #${code} and will head to the pickup location.`,
            { deliveryId: delivery.delivery_id },
          ).catch(() => {});
        }
      }

      setSelectedId(null);
      setActiveTab('active');
      await fetchDeliveries(providerId);
      Alert.alert(
        '✅ Delivery Accepted!',
        'The route is now in your Active tasks. Ask the sender for their pickup QR or PIN when you arrive.',
      );
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to accept delivery.');
    } finally {
      setAcceptingRequestId(null);
    }
  };

  const confirmAcceptNearby = (syntheticTask: any) => {
    if (acceptingRequestId != null) return;
    const info = buildTaskInfo(syntheticTask);
    const isDirect = !!syntheticTask?.nearbyMeta?.isDirectRequest;
    Alert.alert(
      isDirect ? 'Accept Direct Route Request?' : 'Accept Nearby Delivery?',
      `You will earn ${money(info.earnings)} for delivering from ${info.pickup.main} to ${info.dropoff.main}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept Delivery', onPress: () => doAcceptNearbyRequest(syntheticTask) },
      ],
    );
  };

  const handlePingSender = async (delivery: any) => {
    const senderId = (delivery.delivery_requests as any)?.sender_id
      ?? (delivery.delivery_requests as any)?.sender?.user_id;

    if (!senderId) {
      Alert.alert('Error', 'Could not find sender information for this delivery.');
      return;
    }

    setPingingId(delivery.delivery_id);
    try {
      const code = trackingCode((delivery.delivery_requests as any)?.request_id ?? delivery.delivery_id);

      await notifyUser(
        senderId,
        'Courier is on the way! 🚚',
        `Your courier is heading to the pickup location for parcel #${code}. Please have the package ready.`,
        { deliveryId: delivery.delivery_id },
      );

      Alert.alert('Sender Pinged', 'The sender has been notified that you are on your way to pick up the package.');
    } catch (error) {
      console.error('Failed to ping sender:', error);
      Alert.alert('Error', 'Could not send the notification. Please try again.');
    } finally {
      setPingingId(null);
    }
  };

  const openVerifyModal = async (delivery: any) => {
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
    setVerifyModalVisible(true);
  };

  const closeVerifyModal = () => {
    setVerifyModalVisible(false);
    setVerifyTarget(null);
    setScanned(false);
    setPinInput('');
  };

  const markPickupVerified = async (deliveryId: number, requestId: number) => {
    try {
      const { error: qrErr } = await supabase
        .from('qr_verifications')
        .update({ pickup_verified: true })
        .eq('delivery_id', deliveryId);
      if (qrErr) throw qrErr;

      const { error: reqErr } = await supabase
        .from('delivery_requests')
        .update({ delivery_status: 'In Transit' })
        .eq('request_id', requestId);
      if (reqErr) throw reqErr;

      const patchDelivery = (list: any[]) =>
        list.map(d => {
          if (d.delivery_id !== deliveryId) return d;
          const currentQr = d.qr_verifications
            ? (Array.isArray(d.qr_verifications) ? d.qr_verifications[0] : d.qr_verifications)
            : {};
          return {
            ...d,
            qr_verifications: { ...currentQr, pickup_verified: true },
            delivery_requests: d.delivery_requests
              ? { ...d.delivery_requests, delivery_status: 'In Transit' }
              : d.delivery_requests,
          };
        });

      setActiveDeliveries(prev => patchDelivery(prev));
      setCompletedDeliveries(prev => patchDelivery(prev));

      Alert.alert('✅ Item Collected', 'Pickup verified. You can now deliver to the receiver.');
      const senderId = (verifyTarget?.delivery_requests as any)?.sender_id
        ?? (verifyTarget?.delivery_requests as any)?.sender?.user_id;
      if (senderId) {
        notifyUser(senderId, 'Package picked up', 'Your courier picked up your parcel and is now in transit.', { deliveryId: verifyTarget?.delivery_id });
      }
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
      const { data: row, error } = await supabase
        .from('qr_verifications').select('*')
        .eq('pickup_qr', data).eq('delivery_id', verifyTarget.delivery_id).single();

      if (error || !row) {
        Alert.alert('Invalid QR', 'This QR does not match the selected delivery.', [
          { text: 'Try Again', onPress: () => setScanned(false) },
        ]);
        return;
      }
      if (row.pickup_verified) {
        Alert.alert('Already Verified', 'This pickup has already been verified.', [
          { text: 'OK', onPress: () => closeVerifyModal() },
        ]);
        return;
      }
      await markPickupVerified(row.delivery_id, verifyTarget.request_id);
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
      const { data: row, error } = await supabase
        .from('qr_verifications').select('*')
        .eq('delivery_id', verifyTarget.delivery_id).single();

      if (error || !row) throw new Error('QR record not found for this delivery.');
      if (row.pickup_verified) { Alert.alert('Already Verified', 'Pickup already verified.'); return; }
      if (String(row.pickup_pin) !== String(pinInput).trim()) {
        Alert.alert('Wrong PIN', 'Please ask the sender for the correct 4-digit PIN.');
        return;
      }
      await markPickupVerified(row.delivery_id, verifyTarget.request_id);
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify PIN.');
    } finally { setPinVerifying(false); }
  };

  const openDeliveryOTPModal = (delivery: any) => {
    setDeliveryOTPTarget(delivery);
    setDeliveryOTPInput('');
    setDeliveryOTPModalVisible(true);
  };

  const closeDeliveryOTPModal = () => {
    setDeliveryOTPModalVisible(false);
    setDeliveryOTPTarget(null);
    setDeliveryOTPInput('');
    setDeliveryOTPVerifying(false);
    setDeliveryOTPResending(false);
  };

  const tryLocalSystemOtpFallback = async (deliveryId: number, otp: string): Promise<{ handled: boolean; success: boolean }> => {
    try {
      const { data: row, error } = await supabase
        .from('delivery_confirmations').select('*').eq('delivery_id', deliveryId).maybeSingle();

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

    const deliveryId = deliveryOTPTarget.delivery_id;
    const requestId = deliveryOTPTarget.delivery_requests?.request_id;
    const otp = deliveryOTPInput.trim();

    setDeliveryOTPVerifying(true);
    try {
      let verified = false;
      const { data: verifyResult, error: verifyError } = await supabase.functions.invoke(
        'contiguity-otp',
        { body: { action: 'verify', delivery_id: deliveryId, otp } },
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

      const now = new Date().toISOString();

      await supabase
        .from('qr_verifications')
        .update({ dropoff_verified: true })
        .eq('delivery_id', deliveryId);

      const { error: delError } = await supabase
        .from('deliveries')
        .update({ completed_at: now })
        .eq('delivery_id', deliveryId);
      if (delError) throw delError;

      Alert.alert('✅ Delivery Complete!', 'Payment has been released to your wallet.', [{ text: 'OK' }]);
      const senderId = (deliveryOTPTarget?.delivery_requests as any)?.sender_id;
      if (senderId) {
        notifyUser(senderId, 'Delivery complete', `Parcel #PNS-${String(requestId).padStart(4, '0')} was delivered.`, { deliveryId });
      }
      try { await clearLocationFix(deliveryId); } catch {}
      closeDeliveryOTPModal();
      await loadData();
    } catch (error: any) {
      console.error('[completeDelivery] exception:', error);
      Alert.alert('Completion Failed', error.message || 'Could not complete the delivery.');
    } finally {
      setDeliveryOTPVerifying(false);
    }
  };

  const loadData = async () => {
    try {
      if (!hasLoadedRef.current) setLoading(true);
      const pid = await getProviderData();
      if (pid) await fetchDeliveries(pid);
    } finally { hasLoadedRef.current = true; setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`task-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => { fetchDeliveries(providerId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => { fetchDeliveries(providerId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, () => { fetchDeliveries(providerId); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, () => { fetchDeliveries(providerId); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [providerId]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    if (selectedId == null) return;
    const stillActive = activeDeliveries.some(d => d.delivery_id === selectedId);
    const stillCompleted = completedDeliveries.some(d => d.delivery_id === selectedId);
    const stillCancelled = cancelledDeliveries.some(d => d.delivery_id === selectedId);
    const stillNearby = nearbyDeliveries.some(d => d.delivery_id === selectedId);
    if (!stillActive && !stillCompleted && !stillCancelled && !stillNearby) {
      setSelectedId(null);
      closeVerifyModal();
      closeDeliveryOTPModal();
    }
  }, [activeDeliveries, completedDeliveries, cancelledDeliveries, nearbyDeliveries, selectedId]);

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
    return status === 'In Transit' || status === 'Completed';
  };

  const stageOf = (d: any): 'pickup' | 'transit' | 'done' | 'cancelled' | 'nearby' | 'awaiting_acceptance' => {
    if (d?.nearbyMeta?.isDirectRequest) return 'awaiting_acceptance';
    if (d?.nearbyMeta) return 'nearby';
    if (isCancelledDelivery(d)) return 'cancelled';
    if (d?.completed_at) return 'done';
    return isPickupVerified(d) ? 'transit' : 'pickup';
  };

  const statusMeta = (stage: 'pickup' | 'transit' | 'done' | 'cancelled' | 'nearby' | 'awaiting_acceptance') => {
    switch (stage) {
      case 'awaiting_acceptance':
        return { label: 'Waiting for Acceptance', bg: colors.accentSoft, fg: ORANGE, icon: 'hourglass-outline' };
      case 'nearby':
        return { label: 'Nearby Route', bg: 'rgba(59,130,246,0.14)', fg: BLUE, icon: 'compass-outline' };
      case 'done':
        return { label: 'Completed', bg: colors.successBg, fg: colors.success, icon: 'checkmark-circle' };
      case 'transit':
        return { label: 'In Transit', bg: colors.accentSoft, fg: ORANGE, icon: 'navigate' };
      case 'cancelled':
        return { label: 'Cancelled', bg: colors.errorBg, fg: colors.error, icon: 'close-circle' };
      case 'pickup':
      default:
        return { label: 'Awaiting Pickup', bg: colors.warningBg, fg: colors.warning, icon: 'time-outline' };
    }
  };

  const copyTracking = async (text: string) => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
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
    } finally { setOpeningChat(false); }
  };

  // Deduplicate between activeDeliveries and nearbyDeliveries when building allTasks
  const allTasks = useMemo(() => {
    const map = new Map<number, any>();
    [...activeDeliveries, ...completedDeliveries, ...cancelledDeliveries].forEach(d => {
      map.set(d.delivery_id, d);
    });
    return Array.from(map.values());
  }, [activeDeliveries, completedDeliveries, cancelledDeliveries]);

  const allLookupTasks = useMemo(() => {
    const map = new Map<number, any>();
    [...allTasks, ...nearbyDeliveries].forEach(d => {
      map.set(d.delivery_id, d);
    });
    return Array.from(map.values());
  }, [allTasks, nearbyDeliveries]);

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

  const selectedTask = selectedId != null ? allLookupTasks.find(d => d.delivery_id === selectedId) || null : null;

  const tabCount = (t: TabType) =>
    t === 'active' ? activeDeliveries.length
      : t === 'nearby' ? nearbyDeliveries.length
      : t === 'completed' ? completedDeliveries.length
      : t === 'cancelled' ? cancelledDeliveries.length
      : allTasks.length;

  const filteredTasks =
    activeTab === 'active' ? activeDeliveries
      : activeTab === 'nearby' ? nearbyDeliveries
      : activeTab === 'completed' ? completedDeliveries
      : activeTab === 'cancelled' ? cancelledDeliveries
      : allTasks;

  /* --------------------------- shared pieces --------------------------- */
  const renderServicePill = (info: any) => (
    <View style={styles.svcPill}>
      <Ionicons name="add-circle-outline" size={13} color={BLUE} />
      <Text style={styles.svcPillText}>{serviceLabel(info.request?.pickup_type)}</Text>
    </View>
  );

  const renderStatusPill = (meta: any) => (
    <View style={[styles.stPill, { backgroundColor: meta.bg }]}>
      <View style={[styles.stDot, { backgroundColor: meta.fg }]} />
      <Text style={[styles.stPillText, { color: meta.fg }]}>{meta.label.toUpperCase()}</Text>
    </View>
  );

  const renderRoute = (info: any, opts: { notes?: boolean } = {}) => (
    <View>
      {[
        { key: 'p', label: 'PICKUP', pt: info.pickup, color: ORANGE, note: info.pickupNote },
        { key: 'd', label: 'DROP-OFF', pt: info.dropoff, color: BLACK, note: info.dropoffNote },
      ].map((r, i) => (
        <View key={r.key} style={styles.rtRow}>
          <View style={styles.rtRail}>
            <View style={[styles.rtRing, { borderColor: r.color }]}><View style={[styles.rtRingDot, { backgroundColor: r.color }]} /></View>
            {i === 0 && (
              <View style={styles.rtDots}>
                {[0, 1, 2, 3].map(k => <View key={k} style={styles.rtDot} />)}
              </View>
            )}
          </View>
          <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
            <Text style={styles.rtLabel}>{r.label}</Text>
            <Text style={styles.rtMain} numberOfLines={1}>{r.pt.main}</Text>

            {!!r.pt.road && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <Ionicons name="map-outline" size={12} color={colors.textMuted} />
                <Text style={styles.rtSub} numberOfLines={1}>{r.pt.road}</Text>
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

  const renderMiniContact = (o: { role: string; name: string | null; phone: string | null; color: string; hideCall?: boolean }) => {
    const handlePress = () => {
      Alert.alert(
        o.role,
        `Name: ${o.name || 'N/A'}\nPhone: ${o.hideCall ? 'Hidden until accepted' : (o.phone || 'N/A')}`,
        !o.hideCall && o.phone ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call', onPress: () => Linking.openURL(`tel:${o.phone}`) },
        ] : [{ text: 'OK' }],
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
        {!o.hideCall && !!o.phone && (
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

  const cargoLabel = (info: any) =>
    `${info.totalItems} ${info.items?.[0]?.size || (info.totalItems === 1 ? 'item' : 'items')}`;

  /* ---------------------------- list card ---------------------------- */
  const renderTaskCard = (d: any) => {
    const info = buildTaskInfo(d);
    if (!info.request) return null;
    const stage = stageOf(d);
    const meta = statusMeta(stage);
    const isCancelled = stage === 'cancelled';
    const isUnaccepted = stage === 'nearby' || stage === 'awaiting_acceptance';
    const isDirect = stage === 'awaiting_acceptance';
    const active = stage === 'pickup' || stage === 'transit';
    const isAcceptingThis = isUnaccepted && acceptingRequestId === info.request.request_id;

    return (
      <TouchableOpacity
        key={d.delivery_id}
        style={[
          styles.oCard,
          isDirect && { borderColor: ORANGE, borderWidth: 1.5 },
          !active && !isUnaccepted && { opacity: 0.88 },
        ]}
        onPress={() => setSelectedId(d.delivery_id)}
        activeOpacity={0.92}
      >
        <View style={styles.oPad}>
          <View style={styles.oTopRow}>
            {renderServicePill(info)}
            {renderStatusPill(meta)}
          </View>

          {isUnaccepted && d.nearbyMeta && (
            <View style={styles.nearbyBadgeRow}>
              {isDirect ? (
                <View style={styles.nearbyDistPill}>
                  <Ionicons name="person-circle-outline" size={14} color={ORANGE} />
                  <Text style={styles.nearbyDistText}>
                    Sender selected your route · Waiting for your acceptance
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.nearbyDistPill}>
                    <Ionicons name="git-branch-outline" size={13} color={ORANGE} />
                    <Text style={styles.nearbyDistText}>
                      {d.nearbyMeta.pickupDistToCorridorKm.toFixed(1)} km from your route
                    </Text>
                  </View>
                  <View style={styles.nearbyDetourPill}>
                    <Ionicons name="navigate-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.nearbyDetourText}>
                      +{d.nearbyMeta.extraDetourKm.toFixed(1)} km detour
                    </Text>
                  </View>
                </>
              )}
            </View>
          )}

          {renderRoute(info)}

          <View style={styles.oContacts}>
            {renderMiniContact({ role: 'SENDER', name: info.senderName, phone: info.senderPhone, color: BLUE, hideCall: isUnaccepted })}
            {renderMiniContact({ role: 'RECEIVER', name: info.receiverName, phone: info.receiverPhone, color: PURPLE, hideCall: isUnaccepted })}
          </View>
          {isCancelled && <Text style={styles.mCancelledText}>Cancelled by the sender</Text>}
        </View>

        <View style={styles.oFooter}>
          <View style={styles.oChip}>
            <Ionicons name="cube-outline" size={14} color={ORANGE} />
            <Text style={styles.oChipText}>{cargoLabel(info)}</Text>
          </View>
          {info.fragile && (
            <View style={styles.oChip}>
              <Ionicons name="star-outline" size={14} color={ORANGE} />
              <Text style={styles.oChipText}>Fragile</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          <Text style={[styles.oPrice, isCancelled && { textDecorationLine: 'line-through', color: colors.textMuted }]}>
            {money(info.earnings)}
          </Text>
        </View>

        {active && (
          <View style={styles.oActions}>
            <TouchableOpacity style={styles.oChatBtn} onPress={() => messageSender(d)} disabled={openingChat} activeOpacity={0.85}>
              {openingChat ? <ActivityIndicator size="small" color={ORANGE} /> : (
                <>
                  <Ionicons name="chatbubble-outline" size={16} color={ORANGE} />
                  <Text style={styles.oChatText}>Chat</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.oRouteBtn} onPress={() => openRoute(d)} activeOpacity={0.9}>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
              <Text style={styles.oRouteText}>Start Route</Text>
            </TouchableOpacity>
          </View>
        )}

        {isUnaccepted && (
          <View style={styles.oActions}>
            <TouchableOpacity
              style={styles.oChatBtn}
              onPress={() => setSelectedId(d.delivery_id)}
              activeOpacity={0.85}
            >
              <Ionicons name="eye-outline" size={16} color={ORANGE} />
              <Text style={styles.oChatText}>Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.oRouteBtn, isAcceptingThis && { opacity: 0.7 }]}
              onPress={() => confirmAcceptNearby(d)}
              disabled={isAcceptingThis}
              activeOpacity={0.9}
            >
              {isAcceptingThis ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.oRouteText}>Accept Delivery</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  /* ---------------------------- list view ---------------------------- */
  const renderListView = () => (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Animated.View style={[styles.headerSection, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.pageTitle}>My Tasks</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          {(['active', 'nearby', 'completed', 'cancelled', 'all'] as const).map(t => {
            const on = activeTab === t;
            const count = tabCount(t);
            const label = t === 'nearby' ? 'Nearby' : t.charAt(0).toUpperCase() + t.slice(1);
            return (
              <TouchableOpacity key={t} style={[styles.tabItem, on && styles.tabItemActive]} onPress={() => setActiveTab(t)} activeOpacity={0.8}>
                {t === 'nearby' && (
                  <Ionicons name="compass-outline" size={14} color={on ? ORANGE : colors.textSecondary} />
                )}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} />}
      >
        <Animated.View style={{ opacity: contentAnim }}>
          {activeTab === 'nearby' && nearbyDeliveries.length > 0 && (
            <View style={styles.nearbyInfoBanner}>
              <Ionicons name="location-outline" size={16} color={ORANGE} />
              <Text style={styles.nearbyInfoBannerText}>
                Showing direct route requests and unassigned sender routes close to your current route corridor.
              </Text>
            </View>
          )}

          {filteredTasks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name={
                    activeTab === 'cancelled' ? 'close-circle-outline'
                      : activeTab === 'nearby' ? 'compass-outline'
                      : allTasks.length === 0 ? 'briefcase-outline'
                      : 'search-outline'
                  }
                  size={30}
                  color={ORANGE}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {activeTab === 'cancelled'
                  ? 'No cancelled bookings'
                  : activeTab === 'nearby'
                  ? 'No nearby sender routes right now'
                  : allTasks.length === 0 ? 'No tasks yet' : 'Nothing here'}
              </Text>
              <Text style={styles.emptySubtext}>
                {activeTab === 'cancelled'
                  ? 'Bookings cancelled by the sender will appear here.'
                  : activeTab === 'nearby'
                  ? 'Sender routes close to your current active route will appear here so you can accept them.'
                  : allTasks.length === 0
                    ? 'Deliveries you accept or direct route requests appear here.'
                    : 'Try another tab to view history.'}
              </Text>
            </View>
          ) : filteredTasks.map(renderTaskCard)}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  /* --------------------------- detail view --------------------------- */
  const renderDetailView = (d: any) => {
    const info = buildTaskInfo(d);
    const stage = stageOf(d);
    const code = trackingCode(info.request?.request_id ?? d.delivery_id);
    const escrowStatus = String(d.escrow?.escrow_status || '');
    const released = stage === 'done' || /complet|releas/i.test(escrowStatus);
    const paymentLabel = released
      ? 'Released to your wallet'
      : /hold/i.test(escrowStatus) || !escrowStatus ? 'Held in escrow' : escrowStatus;
    const isCancelled = stage === 'cancelled';
    const isUnaccepted = stage === 'nearby' || stage === 'awaiting_acceptance';
    const isDirect = stage === 'awaiting_acceptance';
    const active = stage === 'pickup' || stage === 'transit';
    const isAcceptingThis = isUnaccepted && acceptingRequestId === info.request?.request_id;

    const progressSteps = ['Accepted', 'To pickup', 'Picked up', 'To drop-off', 'Delivered'];
    const doneUpTo = stage === 'done' ? 4 : stage === 'transit' ? 2 : 0;
    const currentStep = stage === 'done' ? -1 : stage === 'transit' ? 3 : 1;

    const H = Dimensions.get('window').height;
    const mapH = Math.round(H * 0.46);
    const items: any[] = info.items || [];
    const photos = items.filter((it: any) => !!it.photo && !failedPhotos[it.photo]);
    const hintText = isDirect
      ? 'The sender specifically selected your route for this delivery! Tap Accept Delivery below to confirm and start.'
      : stage === 'nearby'
      ? `This sender route is ${d.nearbyMeta?.pickupDistToCorridorKm?.toFixed(1) || '0'} km from your current route (+${d.nearbyMeta?.extraDetourKm?.toFixed(1) || '0'} km detour). Tap Accept below to take this job.`
      : stage === 'pickup'
      ? 'Meet the sender, then verify with their QR or 4-digit PIN.'
      : `Hand over ${/door/i.test(info.request?.pickup_type || '') ? 'at the door' : 'at the curb or entrance'}, then enter the receiver’s 6-digit OTP.`;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TouchableOpacity style={[styles.dRoundBtn, { top: Math.max(insets.top, 16) + 6, left: 16 }]} onPress={() => setSelectedId(null)} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.dRoundBtn, { top: Math.max(insets.top, 16) + 6, right: 16 }]} onPress={() => setMapModalVisible(true)} activeOpacity={0.85}>
          <Ionicons name="expand-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>

        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={{ paddingBottom: (active || isUnaccepted) ? insets.bottom + 110 : insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ height: mapH - 28 }}>
            <View style={[styles.dMap, { height: mapH + 24, position: 'relative' }]}>
              <RoutePreviewMap
                pickupLat={info.pickup.lat} pickupLng={info.pickup.lng}
                dropoffLat={info.dropoff.lat} dropoffLng={info.dropoff.lng}
                padTop={insets.top + 70} padBottom={60}
              />
            </View>
          </View>

          <Animated.View style={[styles.dSheet, { opacity: detailAnim }]}>
            <View style={styles.dHandle} />

            <View style={styles.oTopRow}>
              {renderServicePill(info)}
              {renderStatusPill(statusMeta(stage))}
            </View>

            <View style={styles.dCodeRow}>
              <Text style={styles.dCode} selectable numberOfLines={1}>#{code}</Text>
              <TouchableOpacity onPress={() => copyTracking(code)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.trackTextCopy}>
                <Ionicons name={copied ? 'checkmark-circle' : 'copy-outline'} size={16} color={ORANGE} />
                <Text style={styles.trackTextCopyLabel}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
            {!!info.request?.scheduled_time && (
              <Text style={styles.dWhen}>Scheduled · {formatDateTime(info.request.scheduled_time)}</Text>
            )}

            {!isCancelled && !isUnaccepted && (
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
                    The sender cancelled this booking. Any escrow amount is being refunded to them.
                  </Text>
                </View>
              </View>
            ) : stage === 'done' ? (
              <View style={styles.doneCard}>
                <View style={styles.doneIcon}><Ionicons name="checkmark" size={20} color={colors.success} /></View>
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
                <Ionicons name={isDirect ? 'hourglass-outline' : isUnaccepted ? 'compass' : 'information-circle'} size={18} color={ORANGE} />
                <Text style={styles.dHintText}>{hintText}</Text>
              </View>
            )}

            <View style={{ marginTop: 18 }}>{renderRoute(info, { notes: true })}</View>

            <View style={styles.oContacts}>
              {renderMiniContact({ role: 'SENDER', name: info.senderName, phone: info.senderPhone, color: BLUE, hideCall: isUnaccepted })}
              {renderMiniContact({ role: 'RECEIVER', name: info.receiverName, phone: info.receiverPhone, color: PURPLE, hideCall: isUnaccepted })}
            </View>

            {stage === 'pickup' && (
              <TouchableOpacity style={[styles.mSoftBtn, { marginTop: 14, flex: 0 }]} onPress={() => handlePingSender(d)} disabled={pingingId === d.delivery_id} activeOpacity={0.85}>
                {pingingId === d.delivery_id ? (
                  <ActivityIndicator size="small" color={ORANGE} />
                ) : (
                  <>
                    <Ionicons name="notifications" size={16} color={ORANGE} />
                    <Text style={styles.mSoftText}>Let sender know I’m on my way</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {photos.length > 0 && (
              <>
                <View style={styles.dSecHead}>
                  <Ionicons name="images-outline" size={17} color={ORANGE} />
                  <Text style={styles.dSecTitle}>Package Photos</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {photos.map((it: any, i: number) => (
                    <TouchableOpacity key={i} activeOpacity={0.9} onPress={() => setPhotoPreview(it.photo)}>
                      <Image
                        source={{ uri: it.photo }}
                        style={styles.dPhoto}
                        resizeMode="cover"
                        onError={() => setFailedPhotos(p => ({ ...p, [it.photo]: true }))}
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
            {items.some((it: any) => !!it.description) && (
              <View style={{ gap: 4, marginBottom: 10 }}>
                {items.map((it: any, i: number) => !!it.description && (
                  <Text key={i} style={styles.dItemText} numberOfLines={2}>
                    {items.length > 1 ? `${i + 1}. ` : ''}{it.description}
                  </Text>
                ))}
              </View>
            )}
            <View style={styles.tileGrid}>
              <View style={styles.tile}><Text style={styles.tileLabel}>CARGO SIZE</Text><Text style={styles.tileValue}>{cargoLabel(info)}</Text></View>
              <View style={styles.tile}><Text style={styles.tileLabel}>WEIGHT</Text><Text style={styles.tileValue}>{info.weightKg != null ? `${info.weightKg} kg` : '—'}</Text></View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>HANDLING</Text>
                <Text style={[styles.tileValue, info.fragile && { color: ORANGE }]}>{info.fragile ? 'Fragile' : 'Standard'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>{isCancelled ? 'EARNINGS' : 'YOU EARN'}</Text>
                <Text style={[styles.tileValue, { color: isCancelled ? colors.textMuted : colors.success }, isCancelled && { textDecorationLine: 'line-through' }]}>{money(info.earnings)}</Text>
              </View>
              {!!info.dims && (
                <View style={styles.tile}><Text style={styles.tileLabel}>DIMENSIONS</Text><Text style={styles.tileValue}>{info.dims}</Text></View>
              )}
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>PAYMENT</Text>
                <Text style={[styles.tileValue, released && { color: colors.success }]} numberOfLines={2}>{isCancelled ? 'Refunded to sender' : paymentLabel}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>PAYOUT</Text>
                <View style={{ marginTop: 2, alignSelf: 'flex-start' }}><PaymentMethodBadge provider={d.escrow?.payment_method} /></View>
              </View>
            </View>
          </Animated.View>
        </ScrollView>

        {active && (
          <View style={[styles.dBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
            <TouchableOpacity style={styles.dBarIcon} onPress={() => messageSender(d)} disabled={openingChat} activeOpacity={0.85}>
              {openingChat ? <ActivityIndicator size="small" color={ORANGE} /> : <Ionicons name="chatbubble-outline" size={20} color={ORANGE} />}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.mSoftBtn, { flex: 1 }]} onPress={() => openRoute(d)} activeOpacity={0.85}>
              <Ionicons name="arrow-forward" size={16} color={ORANGE} />
              <Text style={styles.mSoftText}>Navigate</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.4 }]}
              onPress={() => (stage === 'pickup' ? openVerifyModal(d) : openDeliveryOTPModal(d))}
              activeOpacity={0.9}
            >
              <Ionicons name={stage === 'pickup' ? 'qr-code-outline' : 'checkmark-circle'} size={18} color="#FFFFFF" />
              <Text style={styles.mPrimaryText}>{stage === 'pickup' ? 'Verify Pickup' : 'Complete'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isUnaccepted && (
          <View style={[styles.dBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>YOU EARN</Text>
              <Text style={{ fontSize: 22, fontWeight: '900', color: ORANGE }}>{money(info.earnings)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.mPrimaryBtn, { flex: 1.5 }, isAcceptingThis && { opacity: 0.7 }]}
              onPress={() => confirmAcceptNearby(d)}
              disabled={isAcceptingThis}
              activeOpacity={0.9}
            >
              {isAcceptingThis ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.mPrimaryText}>Accept Delivery</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderScannerModal = () => (
    <Modal visible={verifyModalVisible} animationType="slide" transparent={false} onRequestClose={closeVerifyModal}>
      <View style={styles.scannerRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {cameraPermission?.granted && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={!scanned ? handleBarcodeScanned : undefined}
          />
        )}

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
            <Ionicons name="close" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, zIndex: 20 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetHeading}>Scan Pickup QR</Text>
          <Text style={styles.sheetSubheading}>Point your camera at the Sender's screen to automatically verify pickup.</Text>

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
        </View>
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
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={[styles.mapSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.mapSheetRow}>
              <View style={styles.sdPinPickup}><Text style={styles.sdPinLetter}>P</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>PICKUP</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{info.pickup.main}</Text>
              </View>
            </View>
            <View style={styles.contactDivider} />
            <View style={styles.mapSheetRow}>
              <View style={styles.sdPinDropoff}><Text style={styles.sdPinLetter}>D</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>DROP-OFF</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{info.dropoff.main}</Text>
              </View>
            </View>
            {(() => {
              const st = stageOf(selectedTask);
              if (st === 'nearby' || st === 'awaiting_acceptance') {
                return (
                  <TouchableOpacity
                    style={[styles.actionBtn, { justifyContent: 'center', marginTop: 14, paddingVertical: 14 }]}
                    onPress={() => { setMapModalVisible(false); confirmAcceptNearby(selectedTask); }}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                    <Text style={styles.actionBtnText}>Accept This Delivery</Text>
                  </TouchableOpacity>
                );
              }
              if (st !== 'pickup' && st !== 'transit') return null;
              return (
                <TouchableOpacity
                  style={[styles.actionBtn, { justifyContent: 'center', marginTop: 14, paddingVertical: 14 }]}
                  onPress={() => { setMapModalVisible(false); openRoute(selectedTask); }}
                  activeOpacity={0.9}
                >
                  <Ionicons name="navigate" size={16} color="#FFFFFF" />
                  <Text style={styles.actionBtnText}>Open Route</Text>
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
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );

  const renderDeliveryOTPModal = () => (
    <Modal visible={deliveryOTPModalVisible} transparent animationType="slide" onRequestClose={closeDeliveryOTPModal}>
      <View style={styles.otpModalOverlay}>
        <View style={styles.otpModalCard}>
          <View style={styles.otpModalHeader}>
            <View style={styles.otpModalIconBox}>
              <Ionicons name="shield-checkmark" size={24} color={colors.success} />
            </View>
            <TouchableOpacity onPress={closeDeliveryOTPModal}>
              <Ionicons name="close" size={24} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.otpModalTitle}>Confirm Delivery</Text>
          <Text style={styles.otpModalSubtitle}>
            Ask the receiver for the 6-digit OTP sent to their phone. Verifying will release payment to your wallet.
          </Text>

          <View style={styles.otpInputContainer}>
            <TextInput
              style={styles.otpInput}
              value={deliveryOTPInput}
              onChangeText={(t) => setDeliveryOTPInput(t.replace(/[^0-9]/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor={colors.textMuted}
              maxLength={6}
            />
          </View>

          <View style={styles.otpInfoBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.otpInfoText} numberOfLines={2}>
              Delivery #{deliveryOTPTarget?.delivery_id} • Receiver:{' '}
              {deliveryOTPTarget?.delivery_requests?.receiver_phone ||
                deliveryOTPTarget?.delivery_requests?.receiver?.receiver_phone ||
                'N/A'}
            </Text>
          </View>

          {!!deliveryOTPTarget?.escrow?.payment_method && (
            <View style={styles.otpPayoutRow}>
              <Text style={styles.otpPayoutLabel}>Sender paid via</Text>
              <PaymentMethodBadge provider={deliveryOTPTarget.escrow.payment_method} size={18} />
            </View>
          )}

          <TouchableOpacity
            style={[styles.otpVerifyButton, (deliveryOTPInput.length !== 6 || deliveryOTPVerifying) && styles.otpVerifyButtonDisabled]}
            disabled={deliveryOTPInput.length !== 6 || deliveryOTPVerifying}
            onPress={completeDelivery}
            activeOpacity={0.9}
          >
            {deliveryOTPVerifying ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.otpVerifyButtonText}>Verify & Complete</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const navSessionId = useNavigationSession();
  const broadcastingDelivery = useMemo(() => {
    const inTransit = activeDeliveries.find((d: any) => stageOf(d) === 'transit');
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

  if (loading) {
    return (
      <View style={[styles.safeArea, styles.loadingContainer]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading tasks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {selectedTask ? renderDetailView(selectedTask) : renderListView()}

      {renderScannerModal()}
      {renderMapModal()}
      {renderPhotoModal()}
      {renderDeliveryOTPModal()}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
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

  nearbyInfoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentSoft, borderWidth: 1, borderColor: 'rgba(255,117,31,0.3)',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14,
  },
  nearbyInfoBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.textPrimary, lineHeight: 17 },
  nearbyBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  nearbyDistPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: c.accentSoft, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,117,31,0.3)',
  },
  nearbyDistText: { fontSize: 11.5, fontWeight: '800', color: ORANGE },
  nearbyDetourPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.background, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: c.divider,
  },
  nearbyDetourText: { fontSize: 11.5, fontWeight: '700', color: c.textSecondary },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ORANGE,
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  actionBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  eyebrow: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },

  cancelBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
    borderRadius: 20, padding: 16, marginBottom: 14,
  },
  cancelBannerIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelBannerTitle: { fontSize: 15, fontWeight: '800', color: c.error },
  cancelBannerSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  stepper: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6, marginBottom: 14, borderWidth: 1, borderColor: c.divider },
  stepCol: { flex: 1, alignItems: 'center' },
  stepLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  stepLine: { flex: 1, height: 3, backgroundColor: c.divider },
  stepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.divider, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  stepDotCurrent: { borderColor: ORANGE },
  stepDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  stepLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, marginTop: 6, textAlign: 'center' },
  stepLabelOn: { color: c.textPrimary },

  mCancelledText: { fontSize: 12, color: c.error, fontWeight: '700', marginTop: 8 },
  mPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, paddingVertical: 13, borderRadius: 14 },
  mPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  mSoftBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.accentSoft, paddingVertical: 12, borderRadius: 14 },
  mSoftText: { color: ORANGE, fontSize: 13, fontWeight: '800' },

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
  oFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  oChipText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  oPrice: { fontSize: 20, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.3 },
  oActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oChatBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 14 },
  oChatText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  oRouteBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14 },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  dMap: { overflow: 'hidden' },
  dRoundBtn: { position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 6, zIndex: 10 },
  dSheet: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingBottom: 24, minHeight: 500 },
  dHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10, marginBottom: 16 },
  dCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dCode: { fontSize: 26, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.5 },
  dWhen: { fontSize: 12, fontWeight: '700', color: ORANGE, marginTop: 2 },
  dHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, marginTop: 10 },
  dHintText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: c.textPrimary },
  dSecHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 12 },
  dSecTitle: { fontSize: 16, fontWeight: '900', color: c.textPrimary },
  dPhoto: { width: 92, height: 92, borderRadius: 14, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
  dItemText: { fontSize: 14, color: c.textSecondary, lineHeight: 20 },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  tileValue: { fontSize: 16, fontWeight: '900', color: c.textPrimary, marginTop: 4 },
  dBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.divider },
  dBarIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },

  trackTextCopy: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trackTextCopyLabel: { fontSize: 12, fontWeight: '800', color: ORANGE },

  doneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.successBg,
    borderWidth: 1, borderColor: c.success, borderRadius: 20, padding: 16, marginBottom: 14,
  },
  doneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 15, fontWeight: '800', color: c.success },
  doneSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  sdPinPickup: { width: 24, height: 24, borderRadius: 12, backgroundColor: ORANGE, borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 2 },
  sdPinDropoff: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.textPrimary, borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 2 },
  sdPinLetter: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  sdRouteMain: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 3 },
  sdNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: 'rgba(255,117,31,0.10)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  sdNoteText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.textPrimary, fontWeight: '600' },

  contactDivider: { height: 1, backgroundColor: c.divider, marginVertical: 14 },

  mapCloseBtn: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: c.border,
  },
  mapSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.4,
    shadowRadius: 12, elevation: 12,
    borderTopWidth: 1, borderColor: c.border,
  },
  mapSheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },

  scannerRoot: { flex: 1, backgroundColor: '#000' },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: ORANGE, shadowColor: ORANGE, shadowOpacity: 1, shadowRadius: 8 },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },
  scannerTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
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
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: c.border, marginBottom: 18,
  },
  sheetHeading: { fontSize: 18, fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  sheetSubheading: { fontSize: 13, color: c.textSecondary, marginBottom: 16, lineHeight: 18 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 1.2 },
  pinRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pinInput: {
    flex: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, letterSpacing: 6,
    color: c.textPrimary, fontWeight: '700', textAlign: 'center', backgroundColor: c.background,
  },
  pinBtn: {
    backgroundColor: ORANGE, paddingHorizontal: 24, justifyContent: 'center',
    borderRadius: 14, alignItems: 'center', minWidth: 100,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  pinBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  otpModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  otpModalCard: {
    width: '100%', maxWidth: 380,
    backgroundColor: c.card, borderRadius: 24, padding: 24,
    borderWidth: 1, borderColor: c.border,
  },
  otpModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  otpModalIconBox: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: c.successBg,
    justifyContent: 'center', alignItems: 'center',
  },
  otpModalTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.3 },
  otpModalSubtitle: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginBottom: 20 },
  otpInputContainer: { marginBottom: 16 },
  otpInput: {
    borderWidth: 2, borderColor: c.border, borderRadius: 16,
    paddingHorizontal: 20, paddingVertical: 18,
    fontSize: 28, letterSpacing: 12, color: c.textPrimary,
    fontWeight: '800', textAlign: 'center', backgroundColor: c.background,
  },
  otpInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.divider, paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: 10, marginBottom: 20,
  },
  otpInfoText: { flex: 1, fontSize: 11, color: c.textSecondary, fontWeight: '500' },
  otpPayoutRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.background, borderRadius: 12, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  otpPayoutLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  otpVerifyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.success, borderRadius: 16,
    paddingVertical: 16, gap: 8, marginBottom: 12,
    shadowColor: c.success, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  otpVerifyButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  otpVerifyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});