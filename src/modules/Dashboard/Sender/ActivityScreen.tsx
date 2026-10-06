// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing, Modal,
  BackHandler, StatusBar, Platform, Linking, Share, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';

// Clipboard support — prefers expo-clipboard, falls back to community clipboard, then Share
let ClipboardApi: any = null;
try { ClipboardApi = require('expo-clipboard'); } catch {
  try { ClipboardApi = require('@react-native-clipboard/clipboard')?.default || require('@react-native-clipboard/clipboard'); } catch { /* not installed */ }
}

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (ClipboardApi) {
      if (typeof ClipboardApi.setStringAsync === 'function') { await ClipboardApi.setStringAsync(text); return true; }
      if (typeof ClipboardApi.setString === 'function') { ClipboardApi.setString(text); return true; }
    }
  } catch { /* fall through */ }
  return false;
};

const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
const RATING_QUICK_TAGS = ['On time', 'Careful handling', 'Friendly', 'Good communication', 'Fast delivery'];

const { width } = Dimensions.get('window');
const ORANGE = '#FF751F';

const FINDING_PROVIDER_ROUTE_NAMES = ['Booking', 'BookingScreen', 'FindingProvider'];

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

const getTabNavigations = (nav: any): any[] => {
  const found: any[] = [];
  let current = nav;
  while (current) {
    try {
      if (current.getState?.()?.type === 'tab') found.push(current);
    } catch { /* ignore */ }
    current = current.getParent?.();
  }
  if (found.length === 0) [nav, nav?.getParent?.()].forEach(n => n && found.push(n));
  return found;
};

/* ==================================================================== */
/* LeafletMap — OSRM road-following route with P and D markers          */
/* ==================================================================== */
const LeafletMap = ({
  pickupLat, pickupLng, dropoffLat, dropoffLng, interactive = false,
}: {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
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
            zoomControl: false,
            attributionControl: false,
            dragging: ${dragging},
            touchZoom: ${touchZoom},
            scrollWheelZoom: ${scrollWheelZoom},
            doubleClickZoom: ${doubleClickZoom},
          }).setView([${centerLat}, ${centerLng}], 13);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var pickupIcon = L.divIcon({
            className: '',
            html: '<div class="marker-pickup">P</div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          var dropoffIcon = L.divIcon({
            className: '',
            html: '<div class="marker-dropoff">D</div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });

          if (pickupLat != null && pickupLng != null) {
            L.marker([pickupLat, pickupLng], { icon: pickupIcon }).addTo(map);
          }
          if (dropoffLat != null && dropoffLng != null) {
            L.marker([dropoffLat, dropoffLng], { icon: dropoffIcon }).addTo(map);
          }

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
                  L.polyline(latlngs, {
                    color: '#FF751F',
                    weight: 5,
                    opacity: 0.9,
                    lineJoin: 'round',
                    lineCap: 'round',
                  }).addTo(map);
                  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
                } else {
                  L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], {
                    color: '#FF751F', weight: 4, opacity: 0.7, dashArray: '8, 8',
                  }).addTo(map);
                  map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
                }
              })
              .catch(function() {
                L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], {
                  color: '#FF751F', weight: 4, opacity: 0.7, dashArray: '8, 8',
                }).addTo(map);
                map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
              });
          } else if (pickupLat != null && pickupLng != null && dropoffLat == null) {
            map.setView([pickupLat, pickupLng], 14);
          } else if (dropoffLat != null && dropoffLng != null && pickupLat == null) {
            map.setView([dropoffLat, dropoffLng], 14);
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
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

const CARGO_PHOTO_BUCKET = 'cargo-photos';

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
      }));
  });
  if (sized.length > 0) return sized;

  return list.map((c: any) => {
    const qty = Number(c?.quantity ?? c?.item_quantity ?? c?.qty ?? 1);
    const w = c?.weight_kg ?? c?.weight ?? c?.estimated_weight ?? null;
    return {
      name: c?.item_name || c?.cargo_type || fallbackName,
      type: c?.cargo_type && c?.cargo_type !== c?.item_name ? String(c.cargo_type) : null,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      weight: w != null && w !== '' ? String(w) : null,
      notes: c?.description || c?.notes || c?.special_instructions || null,
      photos: resolvePhotoUrls(c),
    };
  });
};

const formatEta = (iso?: string | null): string => {
  if (!iso) return 'Calculating...';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Calculating...';
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (mins > 0 && mins < 180) return `${clock} (${mins} min)`;
  return clock;
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
  otp_expires_at: string;
  otp_verified: boolean;
  otp_verified_at: string | null;
  attempts: number;
}

interface MappedDelivery {
  request_id: number;
  pickup_type: string;
  cargo_name: string | null;
  date: string;
  time: string;
  pickup_main: string;
  pickup_sub: string;
  dropoff_main: string;
  dropoff_sub: string;
  status: string;
  status_time: string;
  provider_name: string;
  provider_id?: number;
  provider_phone?: string | null;
  cargo_items: CargoItem[];
  total_items: number;
  price: string;
  coords: {
    pickup: { latitude: number; longitude: number };
    dropoff: { latitude: number; longitude: number };
  };
  rawData: DeliveryRequest;
  deliveryData?: Delivery;
  isMatched: boolean;
  qr?: QrRow | null;
  receiver?: ReceiverInfo | null;
  confirmation?: DeliveryConfirmation | null;
}

export default function ActivityScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [deliveries, setDeliveries] = useState<MappedDelivery[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<MappedDelivery | null>(null);
  const [showFullMap, setShowFullMap] = useState(false);
  const [showPickupQR, setShowPickupQR] = useState(false);
  const [showDeliveryOTP, setShowDeliveryOTP] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'completed' | 'pending' | 'active'>('all');
  const [openingChat, setOpeningChat] = useState(false);

  // Rating state
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [ratingTags, setRatingTags] = useState<string[]>([]);
  const [submittedRating, setSubmittedRating] = useState(false);

  // Tracking ID copy state
  const [copiedTracking, setCopiedTracking] = useState(false);
  const copyTimer = useRef<any>(null);

  const isFocused = useIsFocused();
  const tabBarHidden = useRef(false);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;

  const listAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!selectedDelivery) {
      listAnim.setValue(0);
      Animated.timing(listAnim, {
        toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else {
      detailAnim.setValue(0);
      setSubmittedRating(false);
      setRatingStars(5);
      setRatingComment('');
      setRatingTags([]);
      setCopiedTracking(false);
      Animated.timing(detailAnim, {
        toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, [selectedDelivery, listAnim, detailAnim]);

  // Handle Android Hardware Back Button
  useEffect(() => {
    const backAction = () => {
      if (showFullMap) {
        setShowFullMap(false);
        return true;
      }
      if (selectedDelivery) {
        setSelectedDelivery(null);
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedDelivery, showFullMap]);

  // Hide the bottom tab bar while the full-screen map is open
  const setTabBarHidden = useCallback((hidden: boolean) => {
    if (tabBarHidden.current === hidden) return;
    tabBarHidden.current = hidden;
    getTabNavigations(navigationRef.current).forEach(nav => {
      try {
        nav.setOptions({ tabBarStyle: hidden ? { display: 'none' } : undefined });
      } catch { /* ignore */ }
    });
  }, []);

  useLayoutEffect(() => {
    setTabBarHidden(isFocused && showFullMap);
  }, [isFocused, showFullMap, setTabBarHidden]);

  useEffect(() => () => setTabBarHidden(false), [setTabBarHidden]);

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

  const fetchUserRecord = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      return userRecord?.user_id || null;
    } catch (error) {
      return null;
    }
  };

  const fetchProviderDetails = async (providerId: number) => {
    try {
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, email, phone_number').eq('user_id', providerId).single();
      return data;
    } catch (error) { return null; }
  };

  const fetchData = async () => {
    try {
      const currentUserId = userId || await fetchUserRecord();
      if (!currentUserId) {
        setDeliveries([]);
        setIsLoading(false);
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
        new Set(
          (requests || [])
            .map((r: any) => r.receiver_id)
            .filter((id: any) => id != null)
        )
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
        const { data: deliveries } = await supabase
          .from('deliveries')
          .select('*, vehicle:vehicles(*)')
          .in('request_id', requestIds)
          .order('accepted_at', { ascending: false });
        deliveriesData = deliveries || [];

        const deliveryIds = deliveriesData.map(d => d.delivery_id);
        if (deliveryIds.length > 0) {
          const { data: qrs } = await supabase
            .from('qr_verifications')
            .select('*')
            .in('delivery_id', deliveryIds);
          (qrs || []).forEach((q: any) => { qrByDeliveryId[q.delivery_id] = q; });

          const { data: confirmations } = await supabase
            .from('delivery_confirmations')
            .select('*')
            .in('delivery_id', deliveryIds);
          (confirmations || []).forEach((c: any) => { confirmationByDeliveryId[c.delivery_id] = c; });
        }
      }

      const mappedDeliveries: MappedDelivery[] = (requests || []).map((item: any) => {
        const scheduleDate = item.scheduled_time ? new Date(item.scheduled_time) : new Date(item.created_at);
        const delivery = deliveriesData.find((d: any) => d.request_id === item.request_id);

        const parseAddr = (full: string) => {
          if (!full) return { main: 'Selected Location', sub: '' };
          const parts = full.split(', ');
          return { main: parts[0], sub: parts.slice(1).join(', ') || full };
        };

        const pickup = parseAddr(item.pickup_location?.street_address);
        const dropoff = parseAddr(item.dropoff_location?.street_address);

        let status = item.delivery_status;
        let statusDisplay = status;

        if (status === 'Pending') {
          statusDisplay = delivery ? 'Matched' : 'Waiting for Provider';
        } else if (status === 'Accepted') {
          statusDisplay = 'In Progress';
        } else if (status === 'In Transit') {
          statusDisplay = 'In Transit';
        } else if (status === 'Completed') {
          statusDisplay = 'Completed';
        }

        const qrRow = delivery ? qrByDeliveryId[delivery.delivery_id] : null;
        const confirmationRow = delivery ? confirmationByDeliveryId[delivery.delivery_id] : null;

        const joinedReceiver =
          item.receiver ||
          (item.receiver_id != null ? receiverById[item.receiver_id] : null);

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

        const rawCargoName = item.cargo_profiles?.item_name || item.cargo_profiles?.cargo_type;
        // Specifically ignoring the "Standard Parcel" fallback logic to hide it on the UI
        const cargoName = rawCargoName && rawCargoName !== item.pickup_type && rawCargoName !== 'Standard Parcel' ? rawCargoName : null;

        const cargoItems = normalizeCargoItems(item.cargo_profiles, cargoName || 'Package');
        const totalItems = cargoItems.reduce((sum, c) => sum + c.quantity, 0);

        return {
          request_id: item.request_id,
          pickup_type: item.pickup_type,
          cargo_name: cargoName,
          cargo_items: cargoItems,
          total_items: totalItems,
          date: scheduleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: scheduleDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          pickup_main: pickup.main,
          pickup_sub: pickup.sub,
          dropoff_main: dropoff.main,
          dropoff_sub: dropoff.sub,
          status: statusDisplay,
          status_time: delivery?.accepted_at ? new Date(delivery.accepted_at).toLocaleString() : 'Recently updated',
          provider_name: delivery ? 'Provider Assigned' : 'Finding...',
          provider_id: delivery?.provider_id,
          price: item.estimated_cost?.toFixed(2) || '0.00',
          coords: {
            pickup: { latitude: item.pickup_location?.latitude || 10.3157, longitude: item.pickup_location?.longitude || 123.8854 },
            dropoff: { latitude: item.dropoff_location?.latitude || 10.3157, longitude: item.dropoff_location?.longitude || 123.8854 }
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
            delivery.provider_name = `${provider.first_name} ${provider.last_name}`;
            delivery.provider_phone = (provider as any).phone_number || null;
          }
        }
      }

      setDeliveries(mappedDeliveries);
    } catch (error) {
      setDeliveries([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selectedDelivery) return;
    const updatedMatch = deliveries.find(d => d.request_id === selectedDelivery.request_id);
    if (!updatedMatch) return;
    if (updatedMatch.status !== selectedDelivery.status) {
      setSelectedDelivery(updatedMatch);
    }
  }, [deliveries]);

  useFocusEffect(
    useCallback(() => {
      setSelectedDelivery(null);
      setShowFullMap(false);
      setActiveTab('all');
      setSearchQuery('');
      fetchData();

      return () => {
        StatusBar.setBarStyle('dark-content', true);
      };
    }, [userId])
  );

  const handleCopyTracking = async () => {
    if (!selectedDelivery) return;
    const code = `#PNS-${String(selectedDelivery.request_id).padStart(4, '0')}`;
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopiedTracking(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedTracking(false), 2000);
    } else {
      try {
        await Share.share({ message: `Tracking ID: ${code} for Pack-N-Ship delivery.` });
      } catch {
        Alert.alert('Tracking ID', code);
      }
    }
  };

  const toggleRatingTag = (tag: string) => {
    setRatingTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleEdit = (rawData: any) => {
    if (!rawData) return;
    setSelectedDelivery(null);
    navigation.navigate('ScheduleDelivery', { editData: rawData, mode: rawData.scheduled_time ? 'schedule' : 'sendNow' });
  };

  const handleDelete = (rawData: any) => {
    if (!rawData) return;
    Alert.alert('Cancel Delivery', 'Are you sure you want to cancel and delete this delivery?', [
      { text: 'Keep Delivery', style: 'cancel' },
      {
        text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
          try {
            const deliveryId = selectedDelivery?.deliveryData?.delivery_id;
            if (deliveryId) {
              await supabase.from('delivery_confirmations').delete().eq('delivery_id', deliveryId);
              await supabase.from('qr_verifications').delete().eq('delivery_id', deliveryId);
              await supabase.from('escrow_payments').delete().eq('delivery_id', deliveryId);
              await supabase.from('deliveries').delete().eq('delivery_id', deliveryId);
            }
            await supabase.from('delivery_requests').delete().eq('request_id', rawData.request_id);
            setSelectedDelivery(null);
            fetchData();
          } catch (error: any) { Alert.alert('Error', 'Could not delete delivery.'); }
        }
      }
    ]);
  };

  const handleMessageProvider = async (item: MappedDelivery) => {
    try {
      if (!item.deliveryData?.delivery_id) {
        return Alert.alert('Please wait', 'Provider details are still loading.');
      }
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(item.deliveryData.delivery_id);
      if (!roomId) {
        setOpeningChat(false);
        return Alert.alert('Error', 'Could not open chat.');
      }
      navigation.navigate('MainTabs', {
        screen: 'Messages',
        params: { openRoomId: roomId },
      });
    } catch (err: any) {
      Alert.alert('Error', 'Could not open chat.');
    } finally {
      setOpeningChat(false);
    }
  };

  const filteredDeliveries = deliveries.filter((item) => {
    if (activeTab === 'pending' && item.status !== 'Waiting for Provider') return false;
    if (activeTab === 'active' && item.status !== 'In Progress' && item.status !== 'Matched' && item.status !== 'In Transit') return false;
    if (activeTab === 'completed' && item.status !== 'Completed') return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (item.pickup_main + " " + item.pickup_sub).toLowerCase().includes(query) ||
      (item.dropoff_main + " " + item.dropoff_sub).toLowerCase().includes(query) ||
      String(item.request_id).toLowerCase().includes(query) ||
      String(item.provider_name).toLowerCase().includes(query) ||
      String(item.cargo_name || '').toLowerCase().includes(query) ||
      String(item.receiver?.receiver_name || '').toLowerCase().includes(query) ||
      String(item.receiver?.receiver_phone || '').toLowerCase().includes(query);
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return '#D97706';
      case 'Matched': return '#2563EB';
      case 'In Progress': return '#7C3AED';
      case 'In Transit': return '#0284C7';
      case 'Completed': return '#16A34A';
      default: return '#4B5563';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return '#FEF3C7';
      case 'Matched': return '#DBEAFE';
      case 'In Progress': return '#F3E8FF';
      case 'In Transit': return '#E0F2FE';
      case 'Completed': return '#DCFCE7';
      default: return '#F3F4F6';
    }
  };

  const getStatusIcon = (status: string): any => {
    switch (status) {
      case 'Waiting for Provider': return 'time-outline';
      case 'Matched': return 'checkmark-circle-outline';
      case 'In Progress': return 'car-sport-outline';
      case 'In Transit': return 'cube-outline';
      case 'Completed': return 'checkmark-done-circle';
      default: return 'ellipse-outline';
    }
  };

  const getTabCount = (tab: string) => {
    if (tab === 'all') return deliveries.length;
    if (tab === 'pending') return deliveries.filter(d => d.status === 'Waiting for Provider').length;
    if (tab === 'active') return deliveries.filter(d => d.status === 'In Progress' || d.status === 'Matched' || d.status === 'In Transit').length;
    if (tab === 'completed') return deliveries.filter(d => d.status === 'Completed').length;
    return 0;
  };

  const renderTabBar = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
      {(['all', 'active', 'pending', 'completed'] as const).map((tab) => {
        const isActive = activeTab === tab;
        const count = getTabCount(tab);
        return (
          <TouchableOpacity
            key={tab}
            style={[styles.tabItem, isActive && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
            {count > 0 && (
              <View style={[styles.tabCountBadge, isActive && styles.tabCountBadgeActive]}>
                <Text style={[styles.tabCountText, isActive && styles.tabCountTextActive]}>
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const renderListView = () => (
    <KeyboardAvoidingView 
      style={{ flex: 1 }} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header Section */}
      <View style={styles.headerSection}>
        <Text style={styles.pageTitle}>Activity & Shipments</Text>
        
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color="#9CA3AF" />
            <TextInput
              placeholder="Search item, address, receiver, ID..."
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {renderTabBar()}
      </View>

      {/* Main List Content */}
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
        <Animated.View style={{ opacity: listAnim }}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={ORANGE} />
              <Text style={styles.loadingText}>Loading activity...</Text>
            </View>
          ) : filteredDeliveries.length === 0 ? (
            <View style={styles.noResultsContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="cube-outline" size={32} color={ORANGE} />
              </View>
              <Text style={styles.noResultsText}>No deliveries found</Text>
              <Text style={styles.noResultsSubtext}>
                {deliveries.length === 0
                  ? 'Your scheduled shipments will appear here'
                  : 'Try adjusting your search or tab filter'}
              </Text>
            </View>
          ) : (
            filteredDeliveries.map((item, index) => {
              const isCompletedItem = item.status === 'Completed';

              const statusLabel =
                item.status === 'Waiting for Provider' ? 'Waiting'
                : item.status === 'In Progress' ? 'Active'
                : item.status === 'In Transit' ? 'In Transit'
                : item.status === 'Matched' ? 'Matched'
                : item.status === 'Completed' ? 'Delivered'
                : item.status;

              return (
                <TouchableOpacity
                  key={item.request_id || index}
                  style={[styles.card, isCompletedItem && styles.completedCard]}
                  onPress={() => setSelectedDelivery(item)}
                  activeOpacity={0.9}
                >
                  {/* Header: Service Type + Status */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <View style={styles.serviceTypeBadge}>
                        <Text style={styles.serviceTypeText}>
                          {item.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}
                        </Text>
                      </View>
                      {!isCompletedItem && (
                        <View style={[styles.statusBadge, { backgroundColor: getStatusBg(item.status) }]}>
                          <Ionicons name={getStatusIcon(item.status)} size={12} color={getStatusColor(item.status)} />
                          <Text style={[styles.statusBadgeText, { color: getStatusColor(item.status) }]}>
                            {statusLabel}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Package title (Rendered only if cargo_name exists & is not Standard Parcel) */}
                  {item.cargo_name && (
                    <Text style={styles.cargoTitle} numberOfLines={1}>
                      {item.cargo_name}
                      {item.total_items > 1 ? ` · ${item.total_items} items` : ''}
                    </Text>
                  )}

                  {/* Route: pickup → dropoff */}
                  <View style={styles.routeBox}>
                    <View style={styles.routeRow}>
                      <View style={styles.dotOrange} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>{item.pickup_main}</Text>
                    </View>
                    <View style={styles.routeConnectorLine} />
                    <View style={styles.routeRow}>
                      <View style={styles.dotDark} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>{item.dropoff_main}</Text>
                    </View>
                  </View>

                  {/* Date + Presentable Provider Row with Car Icon */}
                  <View style={styles.cardContextRow}>
                    <View style={styles.contextDateBox}>
                      <Ionicons name="calendar-outline" size={13} color="#6B7280" />
                      <Text style={styles.contextText}>{item.date}</Text>
                    </View>
                    {item.isMatched && item.provider_name !== 'Finding...' && (
                      <View style={styles.contextProviderPill}>
                        <Ionicons name="car-sport" size={13} color="#16A34A" />
                        <Text style={styles.contextProviderText} numberOfLines={1}>
                          {item.provider_name}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Footer: price + action */}
                  <View style={styles.cardFooter}>
                    <Text style={styles.priceText}>₱{item.price}</Text>

                    {isCompletedItem ? (
                      <View style={styles.actionBadgeComplete}>
                        <Ionicons name="checkmark-circle" size={14} color="#166534" />
                        <Text style={styles.actionBadgeCompleteText}>Delivered</Text>
                      </View>
                    ) : item.isMatched ? (
                      <View style={styles.actionBadgeActive}>
                        <Ionicons name="navigate-outline" size={14} color="#FFFFFF" />
                        <Text style={styles.actionBadgeActiveText}>Track</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.actionBadgePending}
                        onPress={() => handleResumeFindingProvider(item)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="time-outline" size={13} color="#D97706" />
                        <Text style={styles.actionBadgePendingText}>Find courier</Text>
                        <Ionicons name="chevron-forward" size={12} color="#92400E" />
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderProviderIdentity = (d: MappedDelivery) => {
    const initials = (d.provider_name || 'P')
      .split(' ').filter(Boolean).slice(0, 2).map(s => s.charAt(0).toUpperCase()).join('') || 'P';
    const vehicle = d.deliveryData?.vehicle;
    return (
      <View style={styles.courierIdentityRow}>
        <View style={styles.courierAvatarWrap}>
          <View style={styles.courierAvatar}>
            <Text style={styles.courierAvatarText}>{initials}</Text>
          </View>
          <View style={styles.courierVerifiedDot}>
            <Ionicons name="checkmark" size={9} color="#FFFFFF" />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.courierName} numberOfLines={1}>{d.provider_name}</Text>
          <Text style={styles.courierSub}>Verified courier partner</Text>
          <View style={styles.chipRow}>
            <View style={styles.infoChip}>
              <Ionicons name="car-sport-outline" size={11} color="#4B5563" />
              <Text style={styles.infoChipText}>{vehicle?.vehicle_type || 'Vehicle'}</Text>
            </View>
            <View style={[styles.infoChip, styles.plateChip]}>
              <Ionicons name="card-outline" size={11} color="#111827" />
              <Text style={[styles.infoChipText, { color: '#111827', fontWeight: '800' }]}>{vehicle?.plate_number || 'N/A'}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderDetailView = () => {
    const pickupVerified =
      selectedDelivery?.qr?.pickup_verified === true ||
      selectedDelivery?.status === 'In Transit' ||
      selectedDelivery?.status === 'Completed';

    const isCompleted =
      selectedDelivery?.status === 'Completed' ||
      !!selectedDelivery?.deliveryData?.completed_at;

    const trackingCodeStr = `#PNS-${String(selectedDelivery?.request_id).padStart(4, '0')}`;

    return (
      <ScrollView contentContainerStyle={styles.detailContainer} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: detailAnim }}>
          {/* Header Bar */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backCircleBtnDetail} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>Shipment Details</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* 1. Tracking ID with Copy Feature (First) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="barcode-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>TRACKING ID</Text>
            </View>
            <View style={styles.trackingIdCardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackingIdValue}>{trackingCodeStr}</Text>
                <Text style={styles.trackingIdSub}>Keep this code for shipment reference</Text>
              </View>
              <TouchableOpacity
                style={[styles.copyButton, copiedTracking && styles.copyButtonCopied]}
                activeOpacity={0.8}
                onPress={handleCopyTracking}
              >
                <Ionicons name={copiedTracking ? 'checkmark' : 'copy-outline'} size={15} color="#FFFFFF" />
                <Text style={styles.copyButtonText}>{copiedTracking ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 2. The Map */}
          <TouchableOpacity style={styles.detailMapCard} activeOpacity={0.9} onPress={() => setShowFullMap(true)}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <LeafletMap
                pickupLat={selectedDelivery?.coords.pickup.latitude}
                pickupLng={selectedDelivery?.coords.pickup.longitude}
                dropoffLat={selectedDelivery?.coords.dropoff.latitude}
                dropoffLng={selectedDelivery?.coords.dropoff.longitude}
              />
            </View>
            <View style={styles.mapOverlayPill}>
              <Ionicons name="navigate" size={11} color={ORANGE} />
              <Text style={styles.overlayPillText}>
                {isCompleted ? 'Fulfilled Route Map' : pickupVerified ? 'In Transit Along Cebu' : 'Live Route Preview'}
              </Text>
            </View>
            <View style={styles.mapTapHint}>
              <Text style={styles.mapTapHintText}>Tap for full map</Text>
              <Ionicons name="expand-outline" size={11} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          {/* 3. Pick up and drop off location (Route Timeline) */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="location-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>PICKUP & DROP-OFF LOCATION</Text>
            </View>
            <View style={styles.routeTimeline}>
              <View style={styles.routeItem}>
                <View style={styles.routeIconWrapper}>
                  <View style={styles.dotOrange} />
                  <View style={styles.routeLine} />
                </View>
                <View style={styles.routeTextWrapper}>
                  <Text style={styles.routeLabel}>PICKUP LOCATION</Text>
                  <Text style={styles.routeMain}>{selectedDelivery?.pickup_main}</Text>
                  <Text style={styles.routeSub} numberOfLines={2}>{selectedDelivery?.pickup_sub}</Text>
                </View>
              </View>
              <View style={styles.routeItem}>
                <View style={styles.routeIconWrapper}>
                  <View style={styles.dotDark} />
                </View>
                <View style={styles.routeTextWrapper}>
                  <Text style={styles.routeLabel}>DROPOFF LOCATION</Text>
                  <Text style={styles.routeMain}>{selectedDelivery?.dropoff_main}</Text>
                  <Text style={styles.routeSub} numberOfLines={2}>{selectedDelivery?.dropoff_sub}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 4. Rate the Provider — shown ONLY for completed deliveries */}
          {isCompleted && selectedDelivery?.isMatched && (
            <View style={styles.ratingCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="star" size={15} color={ORANGE} />
                <Text style={styles.sectionHeaderTitle}>RATE YOUR PROVIDER</Text>
              </View>
              {!submittedRating ? (
                <View style={styles.ratingCardContent}>
                  <Text style={styles.ratingPromptText}>
                    How was your delivery experience with {selectedDelivery.provider_name}?
                  </Text>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <TouchableOpacity
                        key={star}
                        onPress={() => setRatingStars(star)}
                        activeOpacity={0.7}
                        style={styles.starTouch}
                      >
                        <Ionicons
                          name={star <= ratingStars ? 'star' : 'star-outline'}
                          size={34}
                          color={ORANGE}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.ratingLabelPill}>
                    <Text style={styles.ratingLabelText}>{RATING_LABELS[ratingStars - 1]}</Text>
                  </View>
                  <View style={styles.ratingTagsWrap}>
                    {RATING_QUICK_TAGS.map((tag) => {
                      const active = ratingTags.includes(tag);
                      return (
                        <TouchableOpacity
                          key={tag}
                          style={[styles.ratingTagChip, active && styles.ratingTagChipActive]}
                          onPress={() => toggleRatingTag(tag)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.ratingTagChipText, active && styles.ratingTagChipTextActive]}>
                            {tag}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    style={styles.ratingInput}
                    placeholder="Write a brief review or feedback (optional)..."
                    placeholderTextColor="#9CA3AF"
                    value={ratingComment}
                    onChangeText={setRatingComment}
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.submitRatingBtn}
                    onPress={() => {
                      setSubmittedRating(true);
                      Alert.alert('Thank You', 'Your provider rating has been submitted successfully.');
                    }}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="paper-plane-outline" size={15} color="#FFFFFF" />
                    <Text style={styles.submitRatingBtnText}>Submit Rating</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.ratingCardContent}>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Ionicons
                        key={star}
                        name={star <= ratingStars ? 'star' : 'star-outline'}
                        size={26}
                        color={ORANGE}
                      />
                    ))}
                  </View>
                  {ratingTags.length > 0 && (
                    <View style={styles.ratingTagsWrap}>
                      {ratingTags.map((tag) => (
                        <View key={tag} style={[styles.ratingTagChip, styles.ratingTagChipActive]}>
                          <Text style={[styles.ratingTagChipText, styles.ratingTagChipTextActive]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!!ratingComment.trim() && (
                    <Text style={styles.ratingCommentEcho}>"{ratingComment.trim()}"</Text>
                  )}
                  <View style={styles.submittedBadge}>
                    <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
                    <Text style={styles.submittedBadgeText}>Rating submitted — {RATING_LABELS[ratingStars - 1]} ({ratingStars}/5)</Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 5. Below the rating is the provider profile */}
          {selectedDelivery?.isMatched && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="person-circle-outline" size={15} color={ORANGE} />
                <Text style={styles.sectionHeaderTitle}>PROVIDER PROFILE</Text>
              </View>
              {renderProviderIdentity(selectedDelivery)}
              <View style={styles.courierActionsRow}>
                <TouchableOpacity
                  style={styles.courierMsgBtn}
                  activeOpacity={0.85}
                  onPress={() => handleMessageProvider(selectedDelivery)}
                  disabled={openingChat}
                >
                  {openingChat ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FFFFFF" />
                      <Text style={styles.courierMsgBtnText}>Message</Text>
                    </>
                  )}
                </TouchableOpacity>
                {!!selectedDelivery.provider_phone && (
                  <TouchableOpacity
                    style={styles.courierCallBtn}
                    activeOpacity={0.85}
                    onPress={() => Linking.openURL(`tel:${selectedDelivery.provider_phone}`)}
                  >
                    <Ionicons name="call-outline" size={15} color="#111827" />
                    <Text style={styles.courierCallBtnText}>Call</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* 6. Payment Type and Total Payment */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="wallet-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>PAYMENT DETAILS</Text>
            </View>
            <View style={styles.paymentRowsWrap}>
              <View style={styles.paymentRow}>
                <View style={styles.paymentRowIcon}>
                  <Ionicons name="card-outline" size={16} color={ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentLabel}>Payment Type</Text>
                  <Text style={styles.paymentValue}>Secure Escrow / Online</Text>
                </View>
              </View>
              <View style={styles.paymentRowDivider} />
              <View style={styles.paymentRow}>
                <View style={styles.paymentRowIcon}>
                  <Ionicons name="cash-outline" size={16} color={ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentLabel}>Total Payment</Text>
                  <Text style={styles.paymentTotalValue}>₱{selectedDelivery?.price}</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Bottom Actions Row (Edit / Cancel - hidden if completed) */}
          {!isCompleted && (
            <View style={styles.detailActionsRow}>
              {!selectedDelivery?.isMatched && (
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => handleEdit(selectedDelivery?.rawData)}
                  activeOpacity={0.9}
                >
                  <Text style={styles.editBtnText}>Edit Details</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDelete(selectedDelivery?.rawData)}
                activeOpacity={0.9}
              >
                <Text style={styles.deleteBtnText}>Cancel Booking</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    );
  };

  const renderFullMapView = () => (
    <View style={styles.fullMapContainer}>
      <LeafletMap
        pickupLat={selectedDelivery?.coords.pickup.latitude}
        pickupLng={selectedDelivery?.coords.pickup.longitude}
        dropoffLat={selectedDelivery?.coords.dropoff.latitude}
        dropoffLng={selectedDelivery?.coords.dropoff.longitude}
        interactive={true}
      />
      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => setShowFullMap(false)} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={18} color="#111827" />
        </TouchableOpacity>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{selectedDelivery?.status}</Text>
        </View>
      </View>

      {selectedDelivery && (
        <View style={[styles.mapInfoSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetGrabber} />
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }}>
            {/* ETA + Pay */}
            <View style={styles.etaPayRow}>
              <View style={styles.etaPayBox}>
                <View style={styles.etaPayLabelRow}>
                  <Ionicons name="time-outline" size={12} color={ORANGE} />
                  <Text style={styles.etaPayLabel}>ESTIMATED ARRIVAL</Text>
                </View>
                <Text style={styles.etaPayValue} numberOfLines={1}>
                  {selectedDelivery.status === 'Completed'
                    ? 'Delivered'
                    : selectedDelivery.isMatched
                      ? formatEta(selectedDelivery.deliveryData?.estimated_eta)
                      : 'Awaiting provider'}
                </Text>
              </View>
              <View style={styles.etaPayBox}>
                <View style={styles.etaPayLabelRow}>
                  <Ionicons name="cash-outline" size={12} color={ORANGE} />
                  <Text style={styles.etaPayLabel}>TOTAL PAY</Text>
                </View>
                <Text style={styles.etaPayValue}>₱{selectedDelivery.price}</Text>
              </View>
            </View>

            {/* Provider */}
            {selectedDelivery.isMatched ? (
              <View style={styles.mapSection}>
                {renderProviderIdentity(selectedDelivery)}
                <View style={styles.courierActionsRow}>
                  <TouchableOpacity
                    style={styles.courierMsgBtn}
                    activeOpacity={0.85}
                    onPress={() => handleMessageProvider(selectedDelivery)}
                    disabled={openingChat}
                  >
                    <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FFFFFF" />
                    <Text style={styles.courierMsgBtnText}>Message</Text>
                  </TouchableOpacity>
                  {!!selectedDelivery.provider_phone && (
                    <TouchableOpacity
                      style={styles.courierCallBtn}
                      activeOpacity={0.85}
                      onPress={() => Linking.openURL(`tel:${selectedDelivery.provider_phone}`)}
                    >
                      <Ionicons name="call-outline" size={15} color="#111827" />
                      <Text style={styles.courierCallBtnText}>Call</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ) : (
              <View style={[styles.mapSection, styles.waitingRow]}>
                <ActivityIndicator size="small" color={ORANGE} />
                <Text style={styles.waitingText}>Still finding a courier partner for this shipment.</Text>
              </View>
            )}

            {/* Details */}
            <View style={styles.mapSection}>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Tracking code</Text>
                <Text style={styles.detailLineValue}>#PNS-{String(selectedDelivery.request_id).padStart(4, '0')}</Text>
              </View>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Items</Text>
                <Text style={styles.detailLineValue}>{selectedDelivery.total_items}</Text>
              </View>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Service</Text>
                <Text style={styles.detailLineValue}>{selectedDelivery.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}</Text>
              </View>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Pickup</Text>
                <Text style={styles.detailLineValue} numberOfLines={1}>{selectedDelivery.pickup_main}</Text>
              </View>
              <View style={styles.detailLine}>
                <Text style={styles.detailLineLabel}>Drop-off</Text>
                <Text style={styles.detailLineValue} numberOfLines={1}>{selectedDelivery.dropoff_main}</Text>
              </View>
              {!!selectedDelivery.receiver && (
                <View style={styles.detailLine}>
                  <Text style={styles.detailLineLabel}>Receiver</Text>
                  <Text style={styles.detailLineValue} numberOfLines={1}>
                    {selectedDelivery.receiver.receiver_name || selectedDelivery.receiver.receiver_phone || '—'}
                  </Text>
                </View>
              )}
            </View>

            {/* Live tracker placeholder */}
            <View style={styles.trackerPlaceholder}>
              <View style={styles.trackerIconBox}>
                <Ionicons name="radio-outline" size={18} color="#7C3AED" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trackerTitle}>Live Courier Tracking</Text>
                <Text style={styles.trackerSub}>Real-time location is coming soon. Route shown is a preview.</Text>
              </View>
              <View style={styles.soonBadge}>
                <Text style={styles.soonBadgeText}>SOON</Text>
              </View>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );

  const renderPickupQRModal = () => (
    <Modal visible={showPickupQR} transparent animationType="slide" onRequestClose={() => setShowPickupQR(false)}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Pickup QR Code</Text>
            <TouchableOpacity onPress={() => setShowPickupQR(false)}>
              <Ionicons name="close" size={20} color="#111827" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>Present this code to your courier partner.</Text>
          {selectedDelivery?.qr?.pickup_qr ? (
            <View style={styles.qrWrap}>
              <QRCode value={selectedDelivery.qr.pickup_qr} size={200} color="#111827" backgroundColor="#FFFFFF" />
            </View>
          ) : (
            <ActivityIndicator color={ORANGE} style={{ margin: 40 }} />
          )}
          <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowPickupQR(false)}>
            <Text style={styles.modalDoneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderDeliveryOTPModal = () => {
    if (!selectedDelivery?.confirmation) return null;
    const otpVerified = selectedDelivery.confirmation.otp_verified;

    return (
      <Modal visible={showDeliveryOTP} transparent animationType="slide" onRequestClose={() => setShowDeliveryOTP(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Receiver Confirmation OTP</Text>
              <TouchableOpacity onPress={() => setShowDeliveryOTP(false)}>
                <Ionicons name="close" size={20} color="#111827" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>
              {otpVerified ? 'Delivery verified by receiver.' : 'Code sent to receiver phone for validation upon drop-off.'}
            </Text>
            {otpVerified ? (
              <View style={styles.verifiedBox}>
                <Ionicons name="checkmark-circle" size={40} color="#16A34A" />
                <Text style={styles.verifiedText}>Verified & Completed</Text>
              </View>
            ) : (
              <View style={styles.otpBox}>
                <Ionicons name="phone-portrait-outline" size={24} color="#7C3AED" />
                <Text style={styles.otpHint}>Sent to {selectedDelivery.receiver?.receiver_phone || 'receiver'}</Text>
              </View>
            )}
            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowDeliveryOTP(false)}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={showFullMap ? [] : ['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      {showFullMap && selectedDelivery ? renderFullMapView() : selectedDelivery ? renderDetailView() : renderListView()}
      {renderPickupQRModal()}
      {renderDeliveryOTPModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },

  headerSection: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },

  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#111827' },

  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 16,
  },

  searchRow: {
    marginBottom: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },

  tabBarScroll: {
    gap: 8,
    paddingTop: 16,
    paddingBottom: 4,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  tabItemActive: {
    backgroundColor: '#FFF7ED',
    borderColor: ORANGE,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  tabTextActive: {
    color: ORANGE,
  },
  tabCountBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabCountBadgeActive: {
    backgroundColor: 'rgba(255, 117, 31, 0.18)',
  },
  tabCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4B5563',
  },
  tabCountTextActive: {
    color: ORANGE,
  },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 80 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  loadingText: { fontSize: 12, color: '#6B7280', marginTop: 8, fontWeight: '500' },
  noResultsContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 20 },
  emptyIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#FFE4D2' },
  noResultsText: { fontSize: 15, fontWeight: '800', color: '#111827' },
  noResultsSubtext: { fontSize: 11, color: '#6B7280', marginTop: 3, textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  completedCard: {
    backgroundColor: '#FAFAF9',
    borderColor: '#E5E7EB',
    opacity: 0.95,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  serviceTypeBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  serviceTypeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },

  cargoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
    marginBottom: 12,
  },

  routeBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  routeConnectorLine: {
    width: 2,
    height: 10,
    backgroundColor: '#D1D5DB',
    marginLeft: 3,
    marginVertical: 3,
  },
  routeAddressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },

  cardContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  contextDateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  contextText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  contextProviderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    flexShrink: 1,
  },
  contextProviderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  priceText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },

  actionBadgeActive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 6,
  },
  actionBadgeActiveText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  actionBadgeComplete: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  actionBadgeCompleteText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#166534',
  },
  actionBadgePending: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  actionBadgePendingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
  },

  detailContainer: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    paddingTop: 12,
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backCircleBtnDetail: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  detailHeaderTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  headerSpacer: { width: 36, height: 36 },

  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: ORANGE,
    letterSpacing: 0.8,
  },

  // Tracking ID Card styles
  trackingIdCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFA',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  trackingIdValue: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.3,
  },
  trackingIdSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '600',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  copyButtonCopied: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
  },
  copyButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },

  // Rating Provider UI styles
  ratingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FFE4D2',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  ratingCardContent: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  ratingPromptText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 12,
    textAlign: 'center',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  starTouch: {
    padding: 4,
  },
  ratingLabelPill: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFE4D2',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 14,
  },
  ratingLabelText: {
    fontSize: 12,
    fontWeight: '800',
    color: ORANGE,
  },
  ratingTagsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  ratingTagChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  ratingTagChipActive: {
    backgroundColor: '#FFF7ED',
    borderColor: ORANGE,
  },
  ratingTagChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  ratingTagChipTextActive: {
    color: ORANGE,
  },
  ratingCommentEcho: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#4B5563',
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 12,
  },
  ratingInput: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    color: '#111827',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  submitRatingBtn: {
    width: '100%',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: ORANGE,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  submitRatingBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  submittedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    width: '100%',
    justifyContent: 'center',
  },
  submittedBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#166534',
  },

  // Payment Details styles
  paymentRowsWrap: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  paymentRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFE4D2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paymentRowDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginLeft: 48,
  },
  paymentLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  paymentValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  paymentTotalValue: {
    fontSize: 18,
    fontWeight: '900',
    color: ORANGE,
    letterSpacing: -0.3,
  },

  detailMapCard: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  mapOverlayPill: {
    position: 'absolute', bottom: 10, left: 10, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  overlayPillText: { fontSize: 10, fontWeight: '700', color: '#111827' },
  mapTapHint: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(17,24,39,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  mapTapHintText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },

  routeTimeline: { gap: 2, paddingLeft: 4 },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start' },
  routeIconWrapper: { width: 16, alignItems: 'center', marginRight: 10, marginTop: 2 },
  routeLine: { width: 1, height: 32, backgroundColor: '#E5E7EB', marginVertical: 2 },
  routeTextWrapper: { flex: 1, paddingBottom: 12 },
  routeLabel: { fontSize: 8, fontWeight: '900', color: ORANGE, letterSpacing: 0.8, marginBottom: 2 },
  routeMain: { fontSize: 12, fontWeight: '800', color: '#111827' },
  routeSub: { fontSize: 10, color: '#6B7280', marginTop: 1 },

  courierIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courierAvatarWrap: { width: 52, height: 52 },
  courierAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#111827',
    justifyContent: 'center', alignItems: 'center',
  },
  courierAvatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  courierVerifiedDot: {
    position: 'absolute', right: -1, bottom: -1, width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#16A34A', borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
  },
  courierName: { fontSize: 15, fontWeight: '800', color: '#111827' },
  courierSub: { fontSize: 10, color: '#16A34A', fontWeight: '700', marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  infoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  plateChip: { backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE68A' },
  infoChipText: { fontSize: 10, fontWeight: '700', color: '#4B5563' },
  courierActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  courierMsgBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ORANGE, paddingVertical: 11, borderRadius: 12,
  },
  courierMsgBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  courierCallBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#FFFFFF', paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: '#D1D5DB',
  },
  courierCallBtnText: { color: '#111827', fontWeight: '700', fontSize: 12 },

  detailActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  editBtn: {
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  editBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  deleteBtn: {
    backgroundColor: '#EF4444',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  deleteBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },

  fullMapContainer: { flex: 1 },
  topOverlay: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10,
  },
  backCircleBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  statusPill: {
    backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  statusPillText: { fontSize: 11, fontWeight: '700', color: '#111827' },

  mapInfoSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 14,
  },
  sheetGrabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 12 },
  etaPayRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  etaPayBox: { flex: 1, backgroundColor: '#FFF7ED', borderRadius: 12, borderWidth: 1, borderColor: '#FFE4D2', padding: 12 },
  etaPayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  etaPayLabel: { fontSize: 8, fontWeight: '900', color: '#9A3412', letterSpacing: 0.6 },
  etaPayValue: { fontSize: 15, fontWeight: '900', color: '#111827' },
  mapSection: { backgroundColor: '#F9FAFB', borderRadius: 14, borderWidth: 1, borderColor: '#F3F4F6', padding: 12, marginBottom: 12 },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingText: { flex: 1, fontSize: 11, color: '#6B7280', fontWeight: '600' },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, gap: 12 },
  detailLineLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  detailLineValue: { fontSize: 11, color: '#111827', fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  trackerPlaceholder: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F5F3FF',
    borderRadius: 14, borderWidth: 1, borderColor: '#DDD6FE', padding: 12, marginBottom: 6,
  },
  trackerIconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  trackerTitle: { fontSize: 12, fontWeight: '800', color: '#5B21B6' },
  trackerSub: { fontSize: 10, color: '#7C3AED', marginTop: 1 },
  soonBadge: { backgroundColor: '#7C3AED', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  soonBadgeText: { fontSize: 8, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 320, backgroundColor: '#FFF', borderRadius: 20, padding: 20, alignItems: 'center' },
  modalHeader: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  modalSubtitle: { fontSize: 11, color: '#6B7280', textAlign: 'center', marginBottom: 14 },
  qrWrap: { width: 200, height: 200, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, marginBottom: 14 },
  modalDoneBtn: { width: '100%', backgroundColor: '#111827', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  modalDoneBtnText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  verifiedBox: { alignItems: 'center', paddingVertical: 20, marginBottom: 14 },
  verifiedText: { fontSize: 15, fontWeight: '800', color: '#16A34A', marginTop: 8 },
  otpBox: { alignItems: 'center', paddingVertical: 20, marginBottom: 14, backgroundColor: '#F5F3FF', width: '100%', borderRadius: 12 },
  otpHint: { fontSize: 12, fontWeight: '700', color: '#5B21B6', marginTop: 8 },
});