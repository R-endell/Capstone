// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing,
  Dimensions, Platform, Image, Linking, Share, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { formatDate, formatDateTime } from '../../../utils/dateUtils';
import {
  getProviderDeliveries, findMatches
} from '../../../services/matchingService';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';

const ORANGE = '#FF751F';
const CARGO_PHOTO_BUCKET = 'cargo-photos';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const { width: SCREEN_W } = Dimensions.get('window');
const frameSize = Math.min(SCREEN_W * 0.72, 280);

/* ==================================================================== */
/* TaskRouteMap — two-point map with OSRM road-following route          */
/* ==================================================================== */
const TaskRouteMap = ({
  pickupLat, pickupLng,
  dropoffLat, dropoffLng,
  zoom = 12,
  interactive = false,
}: {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  zoom?: number;
  interactive?: boolean;
}) => {
  const hasPickup = pickupLat != null && pickupLng != null;
  const hasDropoff = dropoffLat != null && dropoffLng != null;

  const centerLat = hasPickup ? pickupLat : (hasDropoff ? dropoffLat : 10.3157);
  const centerLng = hasPickup ? pickupLng : (hasDropoff ? dropoffLng : 123.8854);

  const dragging = interactive ? 'true' : 'false';
  const touchZoom = interactive ? 'true' : 'false';
  const scrollWheelZoom = interactive ? 'true' : 'false';
  const doubleClickZoom = interactive ? 'true' : 'false';
  const zoomControl = interactive ? 'true' : 'false';

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .marker-pickup { background: #FF751F; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
          .marker-dropoff { background: #111827; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var pickupLat = ${hasPickup ? pickupLat : 'null'};
          var pickupLng = ${hasPickup ? pickupLng : 'null'};
          var dropoffLat = ${hasDropoff ? dropoffLat : 'null'};
          var dropoffLng = ${hasDropoff ? dropoffLng : 'null'};

          var map = L.map('map', {
            zoomControl: ${zoomControl},
            attributionControl: false,
            dragging: ${dragging},
            touchZoom: ${touchZoom},
            scrollWheelZoom: ${scrollWheelZoom},
            doubleClickZoom: ${doubleClickZoom},
          }).setView([${centerLat}, ${centerLng}], ${zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var pickupIcon = L.divIcon({ className: '', html: '<div class="marker-pickup">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
          var dropoffIcon = L.divIcon({ className: '', html: '<div class="marker-dropoff">D</div>', iconSize: [22, 22], iconAnchor: [11, 11] });

          if (pickupLat != null && pickupLng != null) L.marker([pickupLat, pickupLng], { icon: pickupIcon }).addTo(map);
          if (dropoffLat != null && dropoffLng != null) L.marker([dropoffLat, dropoffLng], { icon: dropoffIcon }).addTo(map);

          if (pickupLat != null && pickupLng != null && dropoffLat != null && dropoffLng != null) {
            var osrmUrl = 'https://router.project-osrm.org/route/v1/driving/'
              + pickupLng + ',' + pickupLat + ';'
              + dropoffLng + ',' + dropoffLat
              + '?overview=full&geometries=geojson';

            fetch(osrmUrl)
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                  var coords = data.routes[0].geometry.coordinates;
                  var latlngs = coords.map(function(c) { return [c[1], c[0]]; });
                  L.polyline(latlngs, { color: '#FF751F', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map);
                  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
                } else {
                  L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], { color: '#FF751F', weight: 4, opacity: 0.7, dashArray: '8, 8' }).addTo(map);
                  map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
                }
              })
              .catch(function() {
                L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], { color: '#FF751F', weight: 4, opacity: 0.7, dashArray: '8, 8' }).addTo(map);
                map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
              });
          } else if (pickupLat != null && pickupLng != null && dropoffLat == null) {
            map.setView([pickupLat, pickupLng], ${zoom});
          } else if (dropoffLat != null && dropoffLng != null && pickupLat == null) {
            map.setView([dropoffLat, dropoffLng], ${zoom});
          }
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={interactive}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */
const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

const hydrateQr = async (deliveries: any[]) => {
  if (!deliveries || deliveries.length === 0) return deliveries;
  const ids = deliveries.map(d => d.delivery_id).filter(Boolean);
  if (ids.length === 0) return deliveries;

  const { data: qrRows } = await supabase
    .from('qr_verifications')
    .select('*')
    .in('delivery_id', ids);

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
  return {
    request,
    cargo,
    receiver,
    pickup: { ...pickup, lat: request?.pickup_location?.latitude ?? null, lng: request?.pickup_location?.longitude ?? null },
    dropoff: { ...dropoff, lat: request?.dropoff_location?.latitude ?? null, lng: request?.dropoff_location?.longitude ?? null },
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

const openMaps = (lat?: number | null, lng?: number | null) => {
  if (lat == null || lng == null) {
    Alert.alert('No location', 'This stop has no map coordinates.');
    return;
  }
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
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
  return list.map(d => ({
    ...d,
    sender: d.sender || senders[d.delivery_requests?.sender_id] || null,
    escrow: d.escrow || escrows[d.delivery_id] || null,
  }));
};

/* ==================================================================== */
/* TaskScreen                                                           */
/* ==================================================================== */
export default function TaskScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const hasLoadedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [isMatching, setIsMatching] = useState(false);

  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [scanned, setScanned] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'completed' | 'all'>('active');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapModalVisible, setMapModalVisible] = useState(false);
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
  const matchingPulse = useRef(new Animated.Value(0)).current;
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
    if (!isMatching) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(matchingPulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(matchingPulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isMatching, matchingPulse]);

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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (mapModalVisible) { setMapModalVisible(false); return true; }
      if (selectedId != null) { setSelectedId(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [photoPreview, mapModalVisible, selectedId]);

  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData } = await supabase.from('users').select('*').eq('auth_id', user.id).single();
      setUserData(userData);
      setProviderId(userData.user_id);
      return userData.user_id;
    } catch (error) { return null; }
  };

  const fetchDeliveries = async (pid: number) => {
    try {
      const deliveries = await getProviderDeliveries(pid);
      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) =>
        a.findIndex(t => (t.request_id === v.request_id)) === i,
      );

      const hydrated = await enrichDeliveries(await hydrateQr(uniqueDeliveries));

      setActiveDeliveries(hydrated.filter((d: any) => !d.completed_at));
      setCompletedDeliveries(hydrated.filter((d: any) => d.completed_at));
    } catch (error) { console.error('Error fetching deliveries:', error); }
  };

  const runMatching = async (showAlert: boolean = false) => {
    if (isMatching || !providerId) return;
    try {
      setIsMatching(true);
      const allMatches = await findMatches();
      const myMatches = allMatches.filter(m => m.route.provider_id === providerId);
      const matchedRequests = myMatches.map(m => m.request);
      const uniqueRequests = Array.from(new Map(matchedRequests.map(r => [r.request_id, r])).values());
      setPendingRequests(uniqueRequests);

      if (uniqueRequests.length > 0 && showAlert) {
        Alert.alert('🎯 New Matches Found!', `${uniqueRequests.length} delivery matches found for your route.`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsMatching(false);
    }
  };

  const acceptDelivery = async (requestId: number) => {
    try {
      setLoading(true);
      const { data: vehicle } = await supabase.from('vehicles').select('vehicle_id').eq('provider_id', providerId).eq('verification_status', 'Verified').limit(1).single();
      if (!vehicle) return Alert.alert('Error', 'No verified vehicle found.');

      const { data: route } = await supabase.from('provider_routes').select('route_id').eq('provider_id', providerId).limit(1).single();
      if (!route) return Alert.alert('Error', 'No active route found. Please create a route first.');

      const { data: delivery, error: deliveryError } = await supabase.from('deliveries').insert({
        request_id: requestId, provider_id: providerId, vehicle_id: vehicle.vehicle_id, route_id: route.route_id,
        accepted_at: new Date().toISOString(), estimated_eta: new Date(Date.now() + 3600000).toISOString()
      }).select('*').single();

      if (deliveryError) throw deliveryError;

      const qrPayload = {
        delivery_id: delivery.delivery_id,
        pickup_qr: `PU-${randToken(14)}-${delivery.delivery_id}`,
        dropoff_qr: `DO-${randToken(14)}-${delivery.delivery_id}`,
        pickup_pin: randPin(),
        dropoff_pin: randPin(),
      };

      const { error: qrError } = await supabase.from('qr_verifications').insert(qrPayload);
      if (qrError) {
        await supabase.from('deliveries').delete().eq('delivery_id', delivery.delivery_id);
        throw qrError;
      }

      const { error: reqUpdateError } = await supabase.from('delivery_requests').update({ delivery_status: 'Accepted' }).eq('request_id', requestId);
      if (reqUpdateError) throw reqUpdateError;

      const { data: requestData } = await supabase.from('delivery_requests').select('estimated_cost, sender_id').eq('request_id', requestId).single();
      if (requestData) {
        await supabase.from('escrow_payments').insert({
          amount: requestData.estimated_cost, delivery_id: delivery.delivery_id, sender_id: requestData.sender_id,
          provider_id: providerId, escrow_status: 'On hold', emergency_frozen: false, created_at: new Date().toISOString()
        });
      }
      Alert.alert('Success', 'Delivery accepted! Ask the sender to show their pickup QR.');
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to accept delivery.');
    } finally { setLoading(false); }
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

      await supabase.from('delivery_status_history').insert({
        delivery_id: deliveryId,
        status: 'Picked up',
        updated_at: new Date().toISOString(),
      });

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
        .from('qr_verifications')
        .select('*')
        .eq('pickup_qr', data)
        .eq('delivery_id', verifyTarget.delivery_id)
        .single();

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
        .from('qr_verifications')
        .select('*')
        .eq('delivery_id', verifyTarget.delivery_id)
        .single();

      if (error || !row) throw new Error('QR record not found for this delivery.');
      if (row.pickup_verified) {
        Alert.alert('Already Verified', 'Pickup already verified.');
        return;
      }
      if (String(row.pickup_pin) !== String(pinInput).trim()) {
        Alert.alert('Wrong PIN', 'Please ask the sender for the correct 4-digit PIN.');
        return;
      }
      await markPickupVerified(row.delivery_id, verifyTarget.request_id);
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify PIN.');
    } finally {
      setPinVerifying(false);
    }
  };

  /* ---------------- DELIVERY CONFIRMATION (OTP via Contiguity) ---------------- */
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

  const handleResendDeliveryOTP = async () => {
    if (!deliveryOTPTarget) return;

    Alert.alert(
      'Send New OTP',
      'A brand new 6-digit OTP will be sent to the receiver. The previous code will no longer work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send New OTP',
          onPress: async () => {
            try {
              setDeliveryOTPResending(true);
              const { data, error } = await supabase.functions.invoke('contiguity-otp', {
                body: { action: 'regenerate', delivery_id: deliveryOTPTarget.delivery_id },
              });

              if (error || !data?.success) {
                Alert.alert('Error', data?.error || error?.message || 'Could not send new OTP.');
                return;
              }

              Alert.alert('OTP Sent', 'A new OTP has been sent to the receiver.');
              setDeliveryOTPInput('');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to send new OTP.');
            } finally {
              setDeliveryOTPResending(false);
            }
          },
        },
      ]
    );
  };

  const completeDelivery = async () => {
    if (!deliveryOTPTarget || deliveryOTPInput.trim().length !== 6) return;

    const deliveryId = deliveryOTPTarget.delivery_id;
    const requestId = deliveryOTPTarget.delivery_requests?.request_id;

    setDeliveryOTPVerifying(true);
    try {
      const { data: verifyResult, error: verifyError } = await supabase.functions.invoke(
        'contiguity-otp',
        { body: { action: 'verify', delivery_id: deliveryId, otp: deliveryOTPInput.trim() } }
      );

      if (verifyError) {
        Alert.alert('Verification Failed', verifyError.message || 'Could not verify OTP.');
        return;
      }

      if (!verifyResult?.success) {
        Alert.alert('Invalid OTP', verifyResult?.message || 'The code is incorrect or has expired. Please try again.');
        return;
      }

      const now = new Date().toISOString();

      const { error: delError } = await supabase
        .from('deliveries')
        .update({ completed_at: now })
        .eq('delivery_id', deliveryId);
      if (delError) throw delError;

      if (requestId) {
        const { error: reqError } = await supabase
          .from('delivery_requests')
          .update({ delivery_status: 'Completed' })
          .eq('request_id', requestId);
        if (reqError) throw reqError;
      }

      await supabase
        .from('qr_verifications')
        .update({ dropoff_verified: true })
        .eq('delivery_id', deliveryId);

      const { data: escrowData } = await supabase
        .from('escrow_payments')
        .update({ escrow_status: 'Completed' })
        .eq('delivery_id', deliveryId)
        .select('*')
        .single();

      if (escrowData && escrowData.provider_id) {
        const { data: wallet } = await supabase
          .from('provider_wallet')
          .select('*')
          .eq('provider_id', escrowData.provider_id)
          .single();

        if (wallet) {
          await supabase
            .from('provider_wallet')
            .update({ balance: Number(wallet.balance) + Number(escrowData.amount) })
            .eq('wallet_id', wallet.wallet_id);
        }
      }

      await supabase.from('delivery_status_history').insert({
        delivery_id: deliveryId,
        status: 'Delivered',
        updated_at: now,
      });

      Alert.alert('✅ Delivery Complete!', 'Payment has been released to your wallet.', [{ text: 'OK' }]);

      closeDeliveryOTPModal();
      await loadData();
    } catch (error: any) {
      Alert.alert('Completion Failed', error.message || 'Could not complete the delivery.');
    } finally {
      setDeliveryOTPVerifying(false);
    }
  };

  const loadData = async () => {
    try {
      if (!hasLoadedRef.current) setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await fetchDeliveries(pid);
        await runMatching(false);
      }
    } finally { hasLoadedRef.current = true; setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  useEffect(() => {
    if (!providerId) return;

    const channel = supabase
      .channel(`task-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => {
        runMatching(false);
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` }, () => {
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes', filter: `provider_id=eq.${providerId}` }, () => {
        runMatching(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, () => {
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, () => {
        fetchDeliveries(providerId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const pulseOpacity = matchingPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  const scanLineY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, frameSize - 4] });

  const isPickupVerified = (delivery: any) => {
    const qr = delivery?.qr_verifications;
    if (qr) {
      if (Array.isArray(qr)) {
        if (qr[0]?.pickup_verified) return true;
      } else if (qr.pickup_verified) {
        return true;
      }
    }
    const status = delivery?.delivery_requests?.delivery_status;
    return status === 'In Transit' || status === 'Completed';
  };

  const stageOf = (d: any): 'pickup' | 'transit' | 'done' =>
    d?.completed_at ? 'done' : isPickupVerified(d) ? 'transit' : 'pickup';

  const statusMeta = (stage: 'pickup' | 'transit' | 'done') =>
    stage === 'done'
      ? { label: 'Completed', bg: '#DCFCE7', fg: '#166534', icon: 'checkmark-circle' }
      : stage === 'transit'
        ? { label: 'In Transit', bg: '#FFF4EC', fg: ORANGE, icon: 'navigate' }
        : { label: 'Awaiting Pickup', bg: '#FEF3C7', fg: '#92400E', icon: 'time-outline' };

  const dateLabel = (request: any) => {
    try {
      return formatDate(request?.scheduled_time || request?.created_at, 'MMM d, yyyy');
    } catch { return ''; }
  };

  const copyTracking = async (text: string) => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
      } else {
        await Share.share({ message: text });
      }
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
      setOpeningChat(false);
    }
  };

  const allTasks = [...activeDeliveries, ...completedDeliveries];
  const selectedTask = selectedId != null ? allTasks.find(d => d.delivery_id === selectedId) || null : null;
  const tabCount = (t: 'active' | 'completed' | 'all') =>
    t === 'active' ? activeDeliveries.length : t === 'completed' ? completedDeliveries.length : allTasks.length;

  const filteredTasks =
    activeTab === 'active' ? activeDeliveries :
    activeTab === 'completed' ? completedDeliveries :
    allTasks;

  /* ---------------------------- list card ---------------------------- */
  const renderTaskCard = (d: any) => {
    const info = buildTaskInfo(d);
    if (!info.request) return null;
    const stage = stageOf(d);
    const meta = statusMeta(stage);
    const target = stage === 'pickup' ? info.pickup : info.dropoff;

    return (
      <TouchableOpacity
        key={d.delivery_id}
        style={[styles.card, stage === 'done' && styles.cardDone]}
        onPress={() => setSelectedId(d.delivery_id)}
        activeOpacity={0.9}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.serviceBadge}>
              <Text style={styles.serviceBadgeText}>{serviceLabel(info.request.pickup_type)}</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
              <Ionicons name={meta.icon as any} size={12} color={meta.fg} />
              <Text style={[styles.statusBadgeText, { color: meta.fg }]}>{meta.label}</Text>
            </View>
          </View>
          <View style={styles.itemsChip}>
            <Ionicons name="cube-outline" size={12} color="#6B7280" />
            <Text style={styles.itemsChipText}>{info.totalItems} {info.totalItems === 1 ? 'item' : 'items'}</Text>
          </View>
        </View>

        <Text style={styles.cardDate}>{dateLabel(info.request)}</Text>

        <View style={styles.routeBox}>
          <View style={styles.routeRow}>
            <View style={styles.dotOrange} />
            <Text style={styles.routeAddressText} numberOfLines={1}>{info.pickup.main}</Text>
          </View>
          <View style={styles.routeConnectorLine} />
          <View style={styles.routeRow}>
            <View style={styles.dotDark} />
            <Text style={styles.routeAddressText} numberOfLines={1}>{info.dropoff.main}</Text>
          </View>
        </View>

        {stage !== 'done' && (
          <TouchableOpacity
            style={styles.nextStopRow}
            onPress={() => openMaps(target.lat, target.lng)}
            activeOpacity={0.85}
          >
            <View style={styles.nextStopIcon}>
              <Ionicons name="navigate" size={14} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.nextStopEyebrow}>NEXT STOP · {stage === 'pickup' ? 'PICKUP' : 'DROP-OFF'}</Text>
              <Text style={styles.nextStopMain} numberOfLines={1}>{target.main}</Text>
            </View>
            <Text style={styles.nextStopLink}>Navigate</Text>
          </TouchableOpacity>
        )}

        <View style={styles.cardChipRow}>
          {info.weightKg != null && (
            <View style={styles.infoChip}>
              <Ionicons name="barbell-outline" size={12} color="#6B7280" />
              <Text style={styles.infoChipText}>{info.weightKg} kg</Text>
            </View>
          )}
          {info.fragile && (
            <View style={[styles.infoChip, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
              <Ionicons name="warning" size={12} color="#EF4444" />
              <Text style={[styles.infoChipText, { color: '#EF4444' }]}>Fragile</Text>
            </View>
          )}
          {!!info.receiverName && (
            <View style={styles.infoChip}>
              <Ionicons name="person-outline" size={12} color="#6B7280" />
              <Text style={styles.infoChipText} numberOfLines={1}>{info.receiverName}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.footerLabel}>YOU EARN</Text>
            <Text style={styles.priceText}>{money(info.earnings)}</Text>
          </View>
          {stage === 'pickup' ? (
            <TouchableOpacity style={styles.actionBtn} onPress={() => openVerifyModal(d)} activeOpacity={0.9}>
              <Ionicons name="qr-code-outline" size={15} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Verify Pickup</Text>
            </TouchableOpacity>
          ) : stage === 'transit' ? (
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGreen]} onPress={() => openDeliveryOTPModal(d)} activeOpacity={0.9}>
              <Ionicons name="shield-checkmark" size={15} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Complete</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.doneBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#166534" />
              <Text style={styles.doneBadgeText}>Delivered</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  /* --------------------------- pending request card --------------------------- */
  const renderPendingRequest = (request: any) => {
    const cargo = request.cargo;
    const pickup = splitAddress(request.pickup_location?.street_address);
    const dropoff = splitAddress(request.dropoff_location?.street_address);

    return (
      <View key={request.request_id} style={[styles.card, styles.pendingCard]}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.serviceBadge, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="flash" size={12} color={ORANGE} />
              <Text style={[styles.serviceBadgeText, { color: ORANGE, marginLeft: 4 }]}>NEW</Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: '#FEF3C7' }]}>
              <Ionicons name="time-outline" size={12} color="#92400E" />
              <Text style={[styles.statusBadgeText, { color: '#92400E' }]}>Available</Text>
            </View>
          </View>
          <View style={styles.itemsChip}>
            <Ionicons name="cube-outline" size={12} color="#6B7280" />
            <Text style={styles.itemsChipText}>{cargo?.total_weight_kg || 0} kg</Text>
          </View>
        </View>

        <Text style={styles.cardDate}>
          {formatDate(request.created_at, 'MMM d, yyyy')} · {formatDate(request.scheduled_time || request.created_at, 'h:mm a')}
        </Text>

        <View style={styles.routeBox}>
          <View style={styles.routeRow}>
            <View style={styles.dotOrange} />
            <Text style={styles.routeAddressText} numberOfLines={1}>{pickup.main}</Text>
          </View>
          <View style={styles.routeConnectorLine} />
          <View style={styles.routeRow}>
            <View style={styles.dotDark} />
            <Text style={styles.routeAddressText} numberOfLines={1}>{dropoff.main}</Text>
          </View>
        </View>

        <View style={styles.cardChipRow}>
          {cargo && (
            <View style={styles.infoChip}>
              <Ionicons name="cube-outline" size={12} color="#6B7280" />
              <Text style={styles.infoChipText}>{cargo.total_weight_kg || 0} kg {cargo.is_fragile && '· Fragile'}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.footerLabel}>YOU EARN</Text>
            <Text style={styles.priceText}>{money(request.estimated_cost)}</Text>
          </View>
          <TouchableOpacity style={styles.actionBtn} onPress={() => acceptDelivery(request.request_id)} activeOpacity={0.9}>
            <Ionicons name="checkmark" size={15} color="#FFFFFF" />
            <Text style={styles.actionBtnText}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ---------------------------- list view ---------------------------- */
  const renderListView = () => (
    <View style={{ flex: 1 }}>
      <Animated.View style={[styles.headerSection, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.pageTitle}>My Tasks</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
          {(['active', 'completed', 'all'] as const).map(t => {
            const on = activeTab === t;
            const count = tabCount(t);
            return (
              <TouchableOpacity
                key={t}
                style={[styles.tabItem, on && styles.tabItemActive]}
                onPress={() => setActiveTab(t)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, on && styles.tabTextActive]}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
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
          {isMatching && (
            <Animated.View style={[styles.matchingStatus, { opacity: pulseOpacity }]}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.matchingStatusText}>Looking for matches...</Text>
            </Animated.View>
          )}

          {filteredTasks.length === 0 && pendingRequests.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name={allTasks.length === 0 ? 'briefcase-outline' : 'search-outline'} size={30} color={ORANGE} />
              </View>
              <Text style={styles.emptyTitle}>
                {allTasks.length === 0 ? 'No tasks yet' : 'No deliveries here'}
              </Text>
              <Text style={styles.emptySubtext}>
                {allTasks.length === 0
                  ? 'Deliveries you accept appear here. Review matched requests in the Jobs tab.'
                  : 'Try another tab to view history.'}
              </Text>
            </View>
          ) : (
            <>
              {filteredTasks.map(renderTaskCard)}
              {activeTab !== 'completed' && pendingRequests.length > 0 && (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeaderTitle}>Available Jobs</Text>
                    <View style={styles.sectionHeaderCount}>
                      <Text style={styles.sectionHeaderCountText}>{pendingRequests.length}</Text>
                    </View>
                  </View>
                  {pendingRequests.map(renderPendingRequest)}
                </>
              )}
            </>
          )}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  /* --------------------------- detail view --------------------------- */
  const renderContactRow = (o: { role: string; name: string | null; phone: string | null; icon: string; onMessage?: () => void }) => (
    <View style={styles.contactRow}>
      <View style={styles.contactAvatar}>
        <Ionicons name={o.icon as any} size={18} color={ORANGE} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.eyebrow}>{o.role}</Text>
        <Text style={styles.contactName} numberOfLines={1}>{o.name || 'Not available'}</Text>
        {!!o.phone && <Text style={styles.contactPhone}>{o.phone}</Text>}
      </View>
      {!!o.onMessage && (
        <TouchableOpacity style={styles.roundBtn} onPress={o.onMessage} disabled={openingChat} activeOpacity={0.85}>
          {openingChat ? <ActivityIndicator size="small" color={ORANGE} /> : <Ionicons name="chatbubble-ellipses-outline" size={18} color={ORANGE} />}
        </TouchableOpacity>
      )}
      {!!o.phone && (
        <TouchableOpacity style={[styles.roundBtn, styles.roundBtnPrimary]} onPress={() => Linking.openURL(`tel:${o.phone}`)} activeOpacity={0.85}>
          <Ionicons name="call" size={17} color="#FFFFFF" />
        </TouchableOpacity>
      )}
    </View>
  );

  const renderDetailView = (d: any) => {
    const info = buildTaskInfo(d);
    const stage = stageOf(d);
    const meta = statusMeta(stage);
    const code = trackingCode(info.request?.request_id ?? d.delivery_id);
    const stepIndex = stage === 'pickup' ? 0 : stage === 'transit' ? 1 : 2;
    const target = stage === 'pickup' ? info.pickup : info.dropoff;
    const escrowStatus = String(d.escrow?.escrow_status || '');
    const released = stage === 'done' || /complet|releas/i.test(escrowStatus);
    const paymentLabel = released ? 'Released to your wallet' : /hold/i.test(escrowStatus) || !escrowStatus ? 'Held in escrow' : escrowStatus;

    return (
      <View style={{ flex: 1 }}>
        <Animated.View style={[styles.detailHeader, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
          <TouchableOpacity onPress={() => setSelectedId(null)} style={styles.backCircleBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={20} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle}>Task Details</Text>
          <View style={styles.headerSpacer} />
        </Animated.View>

        <ScrollView contentContainerStyle={styles.detailContainer} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: detailAnim }}>
            {/* 1. Tracking ID + status + progress */}
            <View style={styles.sdCard}>
              <View style={styles.sdTrackRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eyebrow}>TRACKING ID</Text>
                  <Text style={styles.sdTrackId} numberOfLines={1}>#{code}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.sdCopyBtn, copied && styles.sdCopyBtnDone]}
                  onPress={() => copyTracking(code)}
                  activeOpacity={0.85}
                >
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? '#FFFFFF' : ORANGE} />
                  <Text style={[styles.sdCopyBtnText, copied && { color: '#FFFFFF' }]}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.sdChipRow}>
                <View style={[styles.sdStatusChip, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon as any} size={12} color={meta.fg} />
                  <Text style={[styles.sdStatusChipText, { color: meta.fg }]}>{meta.label}</Text>
                </View>
                <View style={styles.infoChip}>
                  <Ionicons name="cube-outline" size={12} color="#6B7280" />
                  <Text style={styles.infoChipText}>{info.totalItems} {info.totalItems === 1 ? 'item' : 'items'}</Text>
                </View>
                <View style={styles.infoChip}>
                  <Ionicons name={/door/i.test(info.request?.pickup_type || '') ? 'home-outline' : 'walk-outline'} size={12} color="#6B7280" />
                  <Text style={styles.infoChipText}>{serviceLabel(info.request?.pickup_type)}</Text>
                </View>
              </View>

              <View style={styles.stepperContainer}>
                {['Accepted', 'Picked up', 'Delivered'].map((label, i) => {
                  const passed = i === 0 || stepIndex >= i;
                  const current = stepIndex === i;
                  return (
                    <View key={label} style={styles.stepItem}>
                      <View style={styles.stepRowIndicator}>
                        <View style={[styles.stepDot, passed && styles.stepDotActive, current && styles.stepDotCurrent]}>
                          {passed ? <Ionicons name="checkmark" size={10} color="#FFF" /> : <View style={styles.stepInnerDot} />}
                        </View>
                        {i < 2 && <View style={[styles.stepLine, stepIndex > i && styles.stepLineActive]} />}
                      </View>
                      <Text style={[styles.stepLabel, current && styles.stepLabelActive]} numberOfLines={1}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* 2. Next step */}
            {stage !== 'done' ? (
              <View style={styles.nextCard}>
                <View style={styles.nextTop}>
                  <View style={styles.nextIcon}>
                    <Ionicons name={stage === 'pickup' ? 'qr-code' : 'shield-checkmark'} size={22} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nextEyebrow}>NEXT STEP</Text>
                    <Text style={styles.nextTitle}>{stage === 'pickup' ? 'Pick up the package' : 'Deliver to the receiver'}</Text>
                  </View>
                </View>
                <Text style={styles.nextDesc}>
                  {stage === 'pickup'
                    ? `Head to ${info.pickup.main}. Scan the sender's QR code, or ask for their 4-digit PIN, to confirm pickup.`
                    : `Head to ${info.dropoff.main}. Ask the receiver for the 6-digit OTP to confirm delivery and release your payment.`}
                </Text>
                <View style={styles.nextBtnRow}>
                  <TouchableOpacity style={styles.nextGhostBtn} onPress={() => openMaps(target.lat, target.lng)} activeOpacity={0.85}>
                    <Ionicons name="navigate-outline" size={17} color="#FFFFFF" />
                    <Text style={styles.nextGhostText}>Navigate</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.nextPrimaryBtn}
                    onPress={() => (stage === 'pickup' ? openVerifyModal(d) : openDeliveryOTPModal(d))}
                    activeOpacity={0.9}
                  >
                    <Ionicons name={stage === 'pickup' ? 'qr-code-outline' : 'checkmark-circle'} size={18} color={ORANGE} />
                    <Text style={styles.nextPrimaryText}>{stage === 'pickup' ? 'Verify Pickup' : 'Complete Delivery'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.doneCard}>
                <View style={styles.doneIcon}><Ionicons name="checkmark" size={20} color="#16A34A" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.doneTitle}>Delivered successfully</Text>
                  <Text style={styles.doneSub}>
                    {d.completed_at ? formatDateTime(d.completed_at) : ''}
                    {released ? `  ·  ${money(info.earnings)} added to your wallet` : ''}
                  </Text>
                </View>
              </View>
            )}

            {/* 3. Map + pickup / drop-off */}
            <View style={[styles.sdCard, { padding: 0, overflow: 'hidden' }]}>
              <TouchableOpacity style={styles.sdMap} activeOpacity={0.9} onPress={() => setMapModalVisible(true)}>
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <TaskRouteMap
                    pickupLat={info.pickup.lat}
                    pickupLng={info.pickup.lng}
                    dropoffLat={info.dropoff.lat}
                    dropoffLng={info.dropoff.lng}
                    zoom={12}
                    interactive={false}
                  />
                </View>
                <View style={styles.mapTapHint}>
                  <Text style={styles.mapTapHintText}>Full map</Text>
                  <Ionicons name="expand-outline" size={11} color="#FFFFFF" />
                </View>
              </TouchableOpacity>

              <View style={styles.sdRoutePad}>
                <View style={styles.sdRouteRow}>
                  <View style={styles.sdRouteRail}>
                    <View style={styles.sdPinPickup}><View style={styles.sdPinPickupInner} /></View>
                    <View style={styles.sdRailLine} />
                  </View>
                  <View style={styles.sdRouteText}>
                    <Text style={styles.eyebrow}>PICKUP</Text>
                    <Text style={styles.sdRouteMain} numberOfLines={2}>{info.pickup.main}</Text>
                    {!!info.pickup.sub && <Text style={styles.sdRouteSub} numberOfLines={2}>{info.pickup.sub}</Text>}
                  </View>
                  <TouchableOpacity style={styles.navMini} onPress={() => openMaps(info.pickup.lat, info.pickup.lng)} activeOpacity={0.85}>
                    <Ionicons name="navigate" size={16} color={ORANGE} />
                  </TouchableOpacity>
                </View>
                <View style={styles.sdRouteRow}>
                  <View style={styles.sdRouteRail}>
                    <View style={styles.sdPinDropoff}><Ionicons name="location" size={11} color="#FFFFFF" /></View>
                  </View>
                  <View style={[styles.sdRouteText, { paddingBottom: 0 }]}>
                    <Text style={styles.eyebrow}>DROP-OFF</Text>
                    <Text style={styles.sdRouteMain} numberOfLines={2}>{info.dropoff.main}</Text>
                    {!!info.dropoff.sub && <Text style={styles.sdRouteSub} numberOfLines={2}>{info.dropoff.sub}</Text>}
                  </View>
                  <TouchableOpacity style={styles.navMini} onPress={() => openMaps(info.dropoff.lat, info.dropoff.lng)} activeOpacity={0.85}>
                    <Ionicons name="navigate" size={16} color={ORANGE} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* 4. Contacts */}
            <View style={styles.sdCard}>
              <View style={styles.sdCardHeader}>
                <View style={styles.sdCardHeaderIcon}><Ionicons name="people-outline" size={15} color={ORANGE} /></View>
                <Text style={styles.sdCardTitle}>Contacts</Text>
              </View>
              {renderContactRow({
                role: 'SENDER · PICKUP', name: info.senderName, phone: info.senderPhone, icon: 'person-outline',
                onMessage: () => messageSender(d),
              })}
              <View style={styles.contactDivider} />
              {renderContactRow({
                role: 'RECEIVER · DROP-OFF', name: info.receiverName, phone: info.receiverPhone, icon: 'person',
              })}
            </View>

            {/* 5. Package */}
            <View style={styles.sdCard}>
              <View style={styles.sdCardHeader}>
                <View style={styles.sdCardHeaderIcon}><Ionicons name="cube-outline" size={15} color={ORANGE} /></View>
                <Text style={styles.sdCardTitle}>Package details</Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>ITEMS</Text>
                  <Text style={styles.statValue}>{info.totalItems}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>WEIGHT</Text>
                  <Text style={styles.statValue}>{info.weightKg != null ? `${info.weightKg} kg` : '—'}</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statLabel}>FRAGILE</Text>
                  <Text style={[styles.statValue, info.fragile && { color: '#EF4444' }]}>{info.fragile ? 'Yes' : 'No'}</Text>
                </View>
              </View>

              {!!info.dims && (
                <View style={styles.noteRow}>
                  <Ionicons name="resize-outline" size={15} color="#6B7280" />
                  <Text style={styles.noteText}>Size {info.dims}</Text>
                </View>
              )}

              <View style={[styles.handlingBox, info.fragile && styles.handlingBoxWarn]}>
                <Ionicons
                  name={info.fragile ? 'warning' : 'information-circle-outline'}
                  size={16}
                  color={info.fragile ? '#EF4444' : ORANGE}
                />
                <Text style={[styles.handlingText, info.fragile && { color: '#B91C1C' }]}>
                  {info.fragile ? 'Fragile — handle with care and keep upright. ' : ''}
                  {/door/i.test(info.request?.pickup_type || '')
                    ? 'Door-to-door: collect from and hand over at the door.'
                    : 'Curb-side: collect from and hand over at the curb or entrance.'}
                </Text>
              </View>

              {info.items.map((it: any, i: number) => {
                const ok = !!it.photo && !failedPhotos[it.photo];
                return (
                  <View key={i} style={styles.itemBlock}>
                    {ok ? (
                      <TouchableOpacity activeOpacity={0.92} onPress={() => setPhotoPreview(it.photo)} style={styles.itemPhotoWrap}>
                        <Image
                          source={{ uri: it.photo }}
                          style={styles.itemPhoto}
                          resizeMode="cover"
                          onError={() => setFailedPhotos(p => ({ ...p, [it.photo]: true }))}
                        />
                        <View style={styles.enlargeHint}><Ionicons name="expand-outline" size={12} color="#FFFFFF" /></View>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.itemNoPhoto}>
                        <Ionicons name="image-outline" size={18} color="#9CA3AF" />
                        <Text style={styles.itemNoPhotoText}>{it.photo ? "Photo couldn't be loaded" : 'No photo provided'}</Text>
                      </View>
                    )}
                    <View style={styles.itemInfoRow}>
                      <View style={{ flex: 1 }}>
                        {info.items.length > 1 && <Text style={styles.eyebrow}>ITEM {i + 1}</Text>}
                        <Text style={styles.itemTitle} numberOfLines={3}>{it.description}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        {!!it.size && <View style={styles.infoChip}><Text style={styles.infoChipText}>{it.size}</Text></View>}
                        {it.fragile && (
                          <View style={[styles.infoChip, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                            <Ionicons name="warning" size={11} color="#EF4444" />
                            <Text style={[styles.infoChipText, { color: '#EF4444' }]}>Fragile</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* 6. Timeline */}
            <View style={styles.sdCard}>
              <View style={styles.sdCardHeader}>
                <View style={styles.sdCardHeaderIcon}><Ionicons name="time-outline" size={15} color={ORANGE} /></View>
                <Text style={styles.sdCardTitle}>Delivery timeline</Text>
              </View>
              <View style={styles.tlRow}>
                <Ionicons name="checkmark-circle" size={20} color={ORANGE} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tlTitle}>Accepted</Text>
                  <Text style={styles.tlSub}>{d.accepted_at ? formatDateTime(d.accepted_at) : '—'}</Text>
                </View>
              </View>
              <View style={styles.tlRow}>
                <Ionicons name={stage !== 'pickup' ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={stage !== 'pickup' ? ORANGE : '#D1D5DB'} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tlTitle, stage === 'pickup' && { color: '#9CA3AF' }]}>Package picked up</Text>
                  <Text style={styles.tlSub}>{stage !== 'pickup' ? 'Verified with sender QR / PIN' : 'Waiting for pickup verification'}</Text>
                </View>
              </View>
              <View style={styles.tlRow}>
                <Ionicons name={stage === 'done' ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={stage === 'done' ? ORANGE : '#D1D5DB'} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.tlTitle, stage !== 'done' && { color: '#9CA3AF' }]}>Delivered</Text>
                  <Text style={styles.tlSub}>
                    {stage === 'done' && d.completed_at
                      ? formatDateTime(d.completed_at)
                      : d.estimated_eta ? `Estimated arrival ${formatDateTime(d.estimated_eta)}` : 'Awaiting delivery'}
                  </Text>
                </View>
              </View>
            </View>

            {/* 7. Earnings */}
            <View style={styles.sdCard}>
              <View style={styles.sdCardHeader}>
                <View style={styles.sdCardHeaderIcon}><Ionicons name="wallet-outline" size={15} color={ORANGE} /></View>
                <Text style={styles.sdCardTitle}>Earnings</Text>
              </View>
              <View style={styles.payRow}>
                <Text style={styles.payLabel}>Payment type</Text>
                <View style={styles.payValueRow}>
                  <Ionicons name="shield-checkmark-outline" size={15} color="#4B5563" />
                  <Text style={styles.payValue}>Escrow payment</Text>
                </View>
              </View>
              <View style={styles.payRow}>
                <Text style={styles.payLabel}>Payment status</Text>
                <View style={[styles.payChip, released && styles.payChipDone]}>
                  <Text style={[styles.payChipText, released && styles.payChipTextDone]}>{paymentLabel}</Text>
                </View>
              </View>
              <View style={styles.sdTotalBox}>
                <Text style={styles.sdTotalLabel}>You earn</Text>
                <Text style={styles.sdTotalValue}>{money(info.earnings)}</Text>
              </View>
            </View>
          </Animated.View>
        </ScrollView>
      </View>
    );
  };

  const renderScannerModal = () => (
    <Modal
      visible={verifyModalVisible}
      animationType="slide"
      transparent={false}
      onRequestClose={closeVerifyModal}
    >
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
          <Text style={styles.sheetSubheading}>
            Point your camera at the Sender's screen to automatically verify pickup.
          </Text>
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
              placeholderTextColor="#9CA3AF"
              maxLength={4}
            />
            <TouchableOpacity
              style={[styles.pinBtn, (pinInput.length !== 4 || pinVerifying) && { opacity: 0.5 }]}
              disabled={pinInput.length !== 4 || pinVerifying}
              onPress={handlePinVerify}
              activeOpacity={0.9}
            >
              {pinVerifying ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.pinBtnText}>Verify</Text>
              )}
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
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <View style={StyleSheet.absoluteFill}>
            <TaskRouteMap
              pickupLat={info.pickup.lat}
              pickupLng={info.pickup.lng}
              dropoffLat={info.dropoff.lat}
              dropoffLng={info.dropoff.lng}
              zoom={12}
              interactive
            />
          </View>
          <TouchableOpacity
            style={[styles.mapCloseBtn, { top: insets.top + 12 }]}
            onPress={() => setMapModalVisible(false)}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={20} color="#111827" />
          </TouchableOpacity>

          <View style={[styles.mapSheet, { paddingBottom: insets.bottom + 16 }]}>
            <TouchableOpacity style={styles.mapSheetRow} onPress={() => openMaps(info.pickup.lat, info.pickup.lng)} activeOpacity={0.85}>
              <View style={styles.sdPinPickup}><View style={styles.sdPinPickupInner} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>PICKUP</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{info.pickup.main}</Text>
              </View>
              <View style={styles.navMini}><Ionicons name="navigate" size={16} color={ORANGE} /></View>
            </TouchableOpacity>
            <View style={styles.contactDivider} />
            <TouchableOpacity style={styles.mapSheetRow} onPress={() => openMaps(info.dropoff.lat, info.dropoff.lng)} activeOpacity={0.85}>
              <View style={styles.sdPinDropoff}><Ionicons name="location" size={11} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>DROP-OFF</Text>
                <Text style={styles.sdRouteMain} numberOfLines={1}>{info.dropoff.main}</Text>
              </View>
              <View style={styles.navMini}><Ionicons name="navigate" size={16} color={ORANGE} /></View>
            </TouchableOpacity>
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
    <Modal
      visible={deliveryOTPModalVisible}
      transparent
      animationType="slide"
      onRequestClose={closeDeliveryOTPModal}
    >
      <View style={styles.otpModalOverlay}>
        <View style={styles.otpModalCard}>
          <View style={styles.otpModalHeader}>
            <View style={styles.otpModalIconBox}>
              <Ionicons name="shield-checkmark" size={24} color="#22C55E" />
            </View>
            <TouchableOpacity onPress={closeDeliveryOTPModal}>
              <Ionicons name="close" size={24} color="#111827" />
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
              placeholderTextColor="#9CA3AF"
              maxLength={6}
            />
          </View>

          <View style={styles.otpInfoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={styles.otpInfoText} numberOfLines={2}>
              Delivery #{deliveryOTPTarget?.delivery_id} • Receiver:{' '}
              {deliveryOTPTarget?.delivery_requests?.receiver_phone ||
                deliveryOTPTarget?.delivery_requests?.receiver?.receiver_phone ||
                'N/A'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.otpVerifyButton,
              (deliveryOTPInput.length !== 6 || deliveryOTPVerifying) && styles.otpVerifyButtonDisabled,
            ]}
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

          <TouchableOpacity
            style={styles.otpResendButton}
            onPress={handleResendDeliveryOTP}
            disabled={deliveryOTPResending}
            activeOpacity={0.85}
          >
            {deliveryOTPResending ? (
              <ActivityIndicator size="small" color="#6B7280" />
            ) : (
              <>
                <Ionicons name="refresh" size={14} color="#6B7280" />
                <Text style={styles.otpResendText}>Send New OTP</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={[styles.safeArea, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading tasks...</Text>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      {selectedTask ? renderDetailView(selectedTask) : renderListView()}

      {renderScannerModal()}
      {renderMapModal()}
      {renderPhotoModal()}
      {renderDeliveryOTPModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },

  /* list header */
  headerSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  pageTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  tabBarScroll: { gap: 8, paddingTop: 14 },
  tabItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', gap: 6,
  },
  tabItemActive: { backgroundColor: '#FFF7ED', borderColor: ORANGE, borderWidth: 1.5 },
  tabText: { fontSize: 13, fontWeight: '700', color: '#4B5563' },
  tabTextActive: { color: ORANGE },
  tabCountBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#F3F4F6', paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  tabCountBadgeActive: { backgroundColor: 'rgba(255, 117, 31, 0.18)' },
  tabCountText: { fontSize: 11, fontWeight: '800', color: '#4B5563' },
  tabCountTextActive: { color: ORANGE },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 60 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: '#FFE4D2' },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  emptySubtext: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 6, lineHeight: 19 },

  matchingStatus: {
    flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#FFF7ED',
    borderRadius: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FFE4D2', gap: 10,
  },
  matchingStatusText: { fontSize: 13, color: ORANGE, fontWeight: '700' },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 12 },
  sectionHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  sectionHeaderCount: { backgroundColor: '#FFF7ED', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, minWidth: 28, alignItems: 'center' },
  sectionHeaderCountText: { fontSize: 11, fontWeight: '800', color: ORANGE },

  /* list card */
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  cardDone: { backgroundColor: '#FAFAF9', opacity: 0.95 },
  pendingCard: { borderColor: '#FFE4D2', borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8, flexWrap: 'wrap' },
  serviceBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  serviceBadgeText: { fontSize: 11, fontWeight: '800', color: '#374151' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },
  itemsChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9FAFB', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: '#F1F1F1' },
  itemsChipText: { fontSize: 11, fontWeight: '700', color: '#6B7280' },
  cardDate: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 10 },

  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#111827' },
  routeBox: { backgroundColor: '#F9FAFB', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeConnectorLine: { width: 1, height: 12, backgroundColor: '#D1D5DB', marginLeft: 3.5, marginVertical: 3 },
  routeAddressText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827' },

  nextStopRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF7ED',
    borderWidth: 1, borderColor: '#FFE4D2', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  nextStopIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  nextStopEyebrow: { fontSize: 9, fontWeight: '800', color: ORANGE, letterSpacing: 0.8 },
  nextStopMain: { fontSize: 13, fontWeight: '800', color: '#111827', marginTop: 1 },
  nextStopLink: { fontSize: 12, fontWeight: '800', color: ORANGE },
  cardChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  infoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F9FAFB',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#F1F1F1',
  },
  infoChipText: { fontSize: 11, fontWeight: '700', color: '#4B5563', maxWidth: 160 },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  footerLabel: { fontSize: 9, color: '#9CA3AF', fontWeight: '800', letterSpacing: 0.6, marginBottom: 2 },
  priceText: { fontSize: 20, fontWeight: '900', color: '#111827', letterSpacing: -0.4 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ORANGE,
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  actionBtnGreen: { backgroundColor: '#22C55E', shadowColor: '#22C55E' },
  actionBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  doneBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, gap: 5, borderWidth: 1, borderColor: '#BBF7D0' },
  doneBadgeText: { fontSize: 13, fontWeight: '700', color: '#166534' },

  /* detail */
  detailContainer: { paddingHorizontal: 20, paddingBottom: 60, paddingTop: 16 },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backCircleBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB',
  },
  detailHeaderTitle: { fontSize: 18, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  headerSpacer: { width: 40, height: 40 },

  sdCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1 },
  sdTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sdTrackId: { fontSize: 26, fontWeight: '900', color: '#111827', letterSpacing: -0.6, marginTop: 4 },
  sdCopyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF4EC',
    borderWidth: 1, borderColor: '#FFD9BF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
  },
  sdCopyBtnDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  sdCopyBtnText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  sdChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 16 },
  sdStatusChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  sdStatusChipText: { fontSize: 11, fontWeight: '800' },

  stepperContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  stepItem: { flex: 1, alignItems: 'center' },
  stepRowIndicator: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  stepDotActive: { backgroundColor: ORANGE },
  stepDotCurrent: { backgroundColor: ORANGE, borderWidth: 3, borderColor: '#FFE4D2' },
  stepInnerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF' },
  stepLine: { position: 'absolute', left: '50%', right: '-50%', height: 2, backgroundColor: '#E5E7EB', zIndex: 1 },
  stepLineActive: { backgroundColor: ORANGE },
  stepLabel: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', marginTop: 8, textAlign: 'center' },
  stepLabelActive: { color: ORANGE, fontWeight: '900' },

  nextCard: {
    backgroundColor: ORANGE, borderRadius: 20, padding: 18, marginBottom: 14,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 14, elevation: 6,
  },
  nextTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  nextEyebrow: { fontSize: 10, fontWeight: '800', color: '#FFE4D2', letterSpacing: 1 },
  nextTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.3, marginTop: 2 },
  nextDesc: { fontSize: 13, lineHeight: 19, color: '#FFF1E6', marginTop: 12, fontWeight: '500' },
  nextBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  nextGhostBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)',
  },
  nextGhostText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  nextPrimaryBtn: {
    flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: '#FFFFFF',
  },
  nextPrimaryText: { color: ORANGE, fontSize: 14, fontWeight: '900' },
  doneCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F0FDF4',
    borderWidth: 1, borderColor: '#BBF7D0', borderRadius: 20, padding: 16, marginBottom: 14,
  },
  doneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 15, fontWeight: '800', color: '#166534' },
  doneSub: { fontSize: 12, color: '#4B5563', marginTop: 2, lineHeight: 17 },

  sdMap: { width: '100%', height: 190, backgroundColor: '#F3F4F6' },
  mapTapHint: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(17,24,39,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  mapTapHintText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },
  sdRoutePad: { padding: 18 },
  sdRouteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sdRouteRail: { width: 22, alignItems: 'center', marginRight: 12 },
  sdPinPickup: { width: 20, height: 20, borderRadius: 10, borderWidth: 4, borderColor: ORANGE, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  sdPinPickupInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE },
  sdPinDropoff: { width: 20, height: 20, borderRadius: 10, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  sdRailLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: '#FFD9BF', marginVertical: 3, borderRadius: 1 },
  sdRouteText: { flex: 1, paddingBottom: 16 },
  sdRouteMain: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 3 },
  sdRouteSub: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },
  navMini: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF4EC', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },

  sdCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sdCardHeaderIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF4EC', justifyContent: 'center', alignItems: 'center' },
  sdCardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  contactAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFF4EC', alignItems: 'center', justifyContent: 'center' },
  contactName: { fontSize: 15, fontWeight: '800', color: '#111827', marginTop: 2 },
  contactPhone: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginTop: 1 },
  contactDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 14 },
  roundBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFF4EC', alignItems: 'center', justifyContent: 'center' },
  roundBtnPrimary: { backgroundColor: ORANGE },

  statsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#F3F4F6' },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: '800', color: '#9CA3AF', letterSpacing: 0.8 },
  statValue: { fontSize: 15, fontWeight: '800', color: '#111827', marginTop: 4 },
  statDivider: { width: 1, height: 28, backgroundColor: '#E5E7EB' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  noteText: { fontSize: 13, color: '#4B5563', fontWeight: '600' },
  handlingBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12,
    backgroundColor: '#FFF7ED', borderRadius: 12, padding: 12,
  },
  handlingBoxWarn: { backgroundColor: '#FEF2F2' },
  handlingText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#9A4A12', fontWeight: '600' },

  itemBlock: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  itemPhotoWrap: { width: '100%', height: 170, borderRadius: 14, overflow: 'hidden', backgroundColor: '#F3F4F6' },
  itemPhoto: { width: '100%', height: '100%' },
  enlargeHint: { position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(17,24,39,0.7)', alignItems: 'center', justifyContent: 'center' },
  itemNoPhoto: { height: 64, borderRadius: 14, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  itemNoPhotoText: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  itemInfoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
  itemTitle: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 2 },

  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  tlTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  tlSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },

  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  payLabel: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  payValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  payValue: { fontSize: 13, color: '#111827', fontWeight: '800' },
  payChip: { backgroundColor: '#FFF4EC', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  payChipDone: { backgroundColor: '#DCFCE7' },
  payChipText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  payChipTextDone: { color: '#166534' },
  sdTotalBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: ORANGE, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginTop: 14,
  },
  sdTotalLabel: { fontSize: 13, fontWeight: '700', color: '#FFE4D2' },
  sdTotalValue: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 },

  /* full map + photo preview */
  mapCloseBtn: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6,
  },
  mapSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 12,
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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#E5E7EB', marginBottom: 18,
  },
  sheetHeading: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 4 },
  sheetSubheading: { fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 18 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  orText: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1.2 },
  pinRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pinInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, letterSpacing: 6,
    color: '#111827', fontWeight: '700', textAlign: 'center', backgroundColor: '#F9FAFB'
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
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24,
  },
  otpModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  otpModalIconBox: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#DCFCE7',
    justifyContent: 'center', alignItems: 'center',
  },
  otpModalTitle: {
    fontSize: 20, fontWeight: '800', color: '#111827',
    marginBottom: 8, letterSpacing: -0.3,
  },
  otpModalSubtitle: {
    fontSize: 13, color: '#6B7280', lineHeight: 19, marginBottom: 20,
  },
  otpInputContainer: { marginBottom: 16 },
  otpInput: {
    borderWidth: 2, borderColor: '#E5E7EB', borderRadius: 16,
    paddingHorizontal: 20, paddingVertical: 18,
    fontSize: 28, letterSpacing: 12, color: '#111827',
    fontWeight: '800', textAlign: 'center', backgroundColor: '#F9FAFB',
  },
  otpInfoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F3F4F6', paddingHorizontal: 12,
    paddingVertical: 10, borderRadius: 10, marginBottom: 20,
  },
  otpInfoText: { flex: 1, fontSize: 11, color: '#6B7280', fontWeight: '500' },
  otpVerifyButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#22C55E', borderRadius: 16,
    paddingVertical: 16, gap: 8, marginBottom: 12,
    shadowColor: '#22C55E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  otpVerifyButtonDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0, elevation: 0 },
  otpVerifyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  otpResendButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12,
  },
  otpResendText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
});