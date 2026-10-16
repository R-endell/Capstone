// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing, Modal,
  BackHandler, StatusBar, Platform, Linking, Image, KeyboardAvoidingView, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const { width } = Dimensions.get('window');
const ORANGE = '#FF751F';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const RATING_TAGS = ['On time', 'Careful handling', 'Friendly', 'Fast delivery', 'Good communication'];

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
/* LeafletMap — unchanged light tiles                                   */
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [deliveries, setDeliveries] = useState<MappedDelivery[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<MappedDelivery | null>(null);
  const [showFullMap, setShowFullMap] = useState(false);
  const [showPickupQR, setShowPickupQR] = useState(false);
  const [showDeliveryOTP, setShowDeliveryOTP] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'completed' | 'pending' | 'active'>('all');
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
      Animated.timing(detailAnim, {
        toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, [selectedDelivery, listAnim, detailAnim]);

  useEffect(() => {
    const backAction = () => {
      if (photoPreview) { setPhotoPreview(null); return true; }
      if (showFullMap) { setShowFullMap(false); return true; }
      if (selectedDelivery) { setSelectedDelivery(null); return true; }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedDelivery, showFullMap, photoPreview]);

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
        const { data: deliveries } = await supabase
          .from('deliveries')
          .select('*, vehicle:vehicles(*)')
          .in('request_id', requestIds)
          .order('accepted_at', { ascending: false });
        deliveriesData = deliveries || [];

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
          if (!full) return { main: 'Selected Location', sub: '' };
          const parts = full.split(', ');
          return { main: parts[0], sub: parts.slice(1).join(', ') || full };
        };

        const pickup = parseAddr(item.pickup_location?.street_address);
        const dropoff = parseAddr(item.dropoff_location?.street_address);

        let status = item.delivery_status;
        let statusDisplay = status;

        if (status === 'Pending') statusDisplay = delivery ? 'Matched' : 'Waiting for Provider';
        else if (status === 'Accepted') statusDisplay = 'In Progress';
        else if (status === 'In Transit') statusDisplay = 'In Transit';
        else if (status === 'Completed') statusDisplay = 'Completed';

        const qrRow = delivery ? qrByDeliveryId[delivery.delivery_id] : null;
        const confirmationRow = delivery ? confirmationByDeliveryId[delivery.delivery_id] : null;

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

        const rawCargoName = item.cargo_profiles?.item_name || item.cargo_profiles?.cargo_type;
        const cargoName = rawCargoName && rawCargoName !== item.pickup_type ? rawCargoName : 'Standard Parcel';

        const cargoItems = normalizeCargoItems(item.cargo_profiles, cargoName);
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
    } catch {
      setDeliveries([]);
    } finally {
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
      (d) => d.isMatched && d.qr?.pickup_verified && !d.deliveryData?.completed_at && !d.confirmation?.system_otp,
    );

    pending.forEach(async (d) => {
      const deliveryId = d.deliveryData?.delivery_id;
      if (!deliveryId) return;
      try {
        const { data, error } = await supabase.functions.invoke('generate-delivery-otp', {
          body: { action: 'generate', delivery_id: deliveryId },
        });
        if (error || !data?.success) {
          console.warn('[OTP] generate failed for', deliveryId, data?.error || error?.message);
          return;
        }
        fetchData();
      } catch (e) {
        console.warn('[OTP] generate threw', e);
      }
    });
  }, [deliveries]);

  useEffect(() => {
    if (!selectedDelivery) return;
    const updatedMatch = deliveries.find(d => d.request_id === selectedDelivery.request_id);
    if (!updatedMatch) return;
    setSelectedDelivery(updatedMatch);
  }, [deliveries]);

  const detailRequestId = selectedDelivery?.request_id ?? null;
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
  }, [detailRequestId, detailDeliveryId, userId]);

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
    } catch { /* user dismissed */ }
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
      console.warn('Rating save failed:', e?.message || e);
      Alert.alert('Could not save rating', e?.message || 'Please try again in a moment.');
    } finally {
      setRatingSubmitting(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setSelectedDelivery(null);
      setShowFullMap(false);
      setActiveTab('all');
      fetchData();

      return () => {
        StatusBar.setBarStyle(colors.statusBarStyle, true);
      };
    }, [userId, colors.statusBarStyle])
  );

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
          } catch { Alert.alert('Error', 'Could not delete delivery.'); }
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
      navigation.navigate('MainTabs', { screen: 'Messages', params: { openRoomId: roomId } });
    } catch {
      Alert.alert('Error', 'Could not open chat.');
    } finally {
      setOpeningChat(false);
    }
  };

  const filteredDeliveries = deliveries.filter((item) => {
    if (activeTab === 'pending' && item.status !== 'Waiting for Provider') return false;
    if (activeTab === 'active' && item.status !== 'In Progress' && item.status !== 'Matched' && item.status !== 'In Transit') return false;
    if (activeTab === 'completed' && item.status !== 'Completed') return false;
    return true;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return colors.warning;
      case 'Matched': return '#2563EB';
      case 'In Progress': return '#7C3AED';
      case 'In Transit': return '#0284C7';
      case 'Completed': return colors.success;
      default: return colors.textSecondary;
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return colors.warningBg;
      case 'Matched': return isDark ? '#0F2744' : '#DBEAFE';
      case 'In Progress': return isDark ? '#231542' : '#F3E8FF';
      case 'In Transit': return isDark ? '#0C2130' : '#E0F2FE';
      case 'Completed': return colors.successBg;
      default: return colors.divider;
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
                <Text style={[styles.tabCountText, isActive && styles.tabCountTextActive]}>{count}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );

  const packagePhotosOf = (item: any): { url: string; label: string }[] => {
    const out: { url: string; label: string }[] = [];
    const seen = new Set<string>();
    (item?.cargo_items || []).forEach((ci: CargoItem, i: number) => {
      (ci.photos || []).forEach(url => {
        if (url && !seen.has(url)) { seen.add(url); out.push({ url, label: ci.name || `Item ${i + 1}` }); }
      });
    });
    return out;
  };

  const renderListView = () => (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.headerSection}>
        <Text style={styles.pageTitle}>Activity & Shipments</Text>
        {renderTabBar()}
      </View>

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
                {deliveries.length === 0 ? 'Your scheduled shipments will appear here' : 'No deliveries in this tab yet'}
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
                    <View style={styles.sdItemsChip}>
                      <Ionicons name="cube-outline" size={12} color={colors.textSecondary} />
                      <Text style={styles.sdItemsChipText}>
                        {item.total_items} {item.total_items === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                  </View>

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

                  {packagePhotosOf(item).length > 0 && (
                    <View style={styles.cardPhotoRow}>
                      {packagePhotosOf(item).slice(0, 3).map((ph, i) => (
                        failedPhotos[ph.url] ? (
                          <View key={`${ph.url}-${i}`} style={[styles.cardPhoto, styles.pkgThumbFailed]}>
                            <Ionicons name="image-outline" size={16} color={colors.textMuted} />
                          </View>
                        ) : (
                          <Image
                            key={`${ph.url}-${i}`}
                            source={{ uri: ph.url }}
                            style={styles.cardPhoto}
                            onError={() => setFailedPhotos(f => ({ ...f, [ph.url]: true }))}
                          />
                        )
                      ))}
                      {packagePhotosOf(item).length > 3 && (
                        <View style={[styles.cardPhoto, styles.cardPhotoMore]}>
                          <Text style={styles.cardPhotoMoreText}>+{packagePhotosOf(item).length - 3}</Text>
                        </View>
                      )}
                      <Text style={styles.cardPhotoLabel}>Package photos</Text>
                    </View>
                  )}

                  <View style={styles.cardContextRow}>
                    <View style={styles.contextDateBox}>
                      <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.contextText}>{item.date}</Text>
                    </View>
                    {item.isMatched && item.provider_name !== 'Finding...' && (
                      <View style={styles.contextProviderPill}>
                        <Ionicons name="car-sport" size={13} color={colors.success} />
                        <Text style={styles.contextProviderText} numberOfLines={1}>{item.provider_name}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardFooter}>
                    <Text style={styles.priceText}>₱{item.price}</Text>

                    {isCompletedItem ? (
                      <View style={styles.actionBadgeComplete}>
                        <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                        <Text style={styles.actionBadgeCompleteText}>Delivered</Text>
                      </View>
                    ) : item.isMatched ? (
                      <TouchableOpacity
                        style={styles.actionBadgeActive}
                        onPress={() => {
                          const id = item.deliveryData?.delivery_id;
                          if (!id) return;
                          navigation.navigate('LiveTracking', { deliveryId: id });
                        }}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="navigate-outline" size={14} color="#FFFFFF" />
                        <Text style={styles.actionBadgeActiveText}>Track</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.actionBadgePending}
                        onPress={() => handleResumeFindingProvider(item)}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="time-outline" size={13} color={colors.warning} />
                        <Text style={styles.actionBadgePendingText}>Find courier</Text>
                        <Ionicons name="chevron-forward" size={12} color={colors.warning} />
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
              <Ionicons name="car-sport-outline" size={11} color={colors.textSecondary} />
              <Text style={styles.infoChipText}>{vehicle?.vehicle_type || 'Vehicle'}</Text>
            </View>
            <View style={[styles.infoChip, styles.plateChip]}>
              <Ionicons name="card-outline" size={11} color={colors.textPrimary} />
              <Text style={[styles.infoChipText, { color: colors.textPrimary, fontWeight: '800' }]}>
                {vehicle?.plate_number || 'N/A'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const renderPackagePhotosCard = (item: any) => {
    const photos = packagePhotosOf(item);
    return (
      <View style={styles.sdCard}>
        <View style={styles.sdCardHeader}>
          <View style={styles.sdCardHeaderIcon}><Ionicons name="images-outline" size={14} color={ORANGE} /></View>
          <Text style={styles.sdCardTitle}>Package you requested</Text>
          {photos.length > 0 && <Text style={styles.pkgCount}>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</Text>}
        </View>

        {photos.length === 0 ? (
          <View style={styles.pkgEmpty}>
            <Ionicons name="image-outline" size={18} color={colors.textMuted} />
            <Text style={styles.pkgEmptyText}>No package photo was added to this request</Text>
          </View>
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pkgRow}>
              {photos.map((ph, i) => {
                const ok = !failedPhotos[ph.url];
                return (
                  <TouchableOpacity
                    key={`${ph.url}-${i}`}
                    activeOpacity={0.9}
                    onPress={() => ok && setPhotoPreview(ph.url)}
                    style={styles.pkgThumbWrap}
                  >
                    {ok ? (
                      <Image
                        source={{ uri: ph.url }}
                        style={styles.pkgThumb}
                        resizeMode="cover"
                        onError={() => setFailedPhotos(f => ({ ...f, [ph.url]: true }))}
                      />
                    ) : (
                      <View style={[styles.pkgThumb, styles.pkgThumbFailed]}>
                        <Ionicons name="image-outline" size={22} color={colors.textMuted} />
                      </View>
                    )}
                    <Text style={styles.pkgThumbLabel} numberOfLines={1}>{ph.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.pkgHint}>Review what you asked to be delivered. Tap a photo to enlarge.</Text>
          </>
        )}
      </View>
    );
  };

  const renderPhotoPreviewModal = () => (
    <Modal visible={!!photoPreview} transparent animationType="fade" onRequestClose={() => setPhotoPreview(null)}>
      <View style={styles.previewOverlay}>
        {!!photoPreview && <Image source={{ uri: photoPreview }} style={styles.previewImg} resizeMode="contain" />}
        <TouchableOpacity style={styles.previewClose} onPress={() => setPhotoPreview(null)} activeOpacity={0.85}>
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </Modal>
  );

  const renderDetailView = () => {
    const d = selectedDelivery;
    const pickupVerified = d?.qr?.pickup_verified === true;
    const isCompleted = !!d?.deliveryData?.completed_at;

    const showPickupQRButton = !!d?.isMatched && !!d?.qr && !d?.qr?.pickup_verified && !isCompleted;
    const hasConfirmation = !!d?.confirmation;

    const receiverDisplayName = d?.receiver?.receiver_name?.trim() || d?.receiver?.receiver_phone || 'Receiver';
    const currentStatus = d?.status || 'Waiting for Provider';

    let stepIndex = 0;
    if (d?.isMatched) stepIndex = 1;
    if (pickupVerified) stepIndex = 2;
    if (pickupVerified && !isCompleted) stepIndex = 3;
    if (isCompleted) stepIndex = 4;

    const trackingId = `PNS-${String(d?.request_id).padStart(4, '0')}`;
    const canResume = !!d && !d.isMatched && currentStatus === 'Waiting for Provider';

    const providerName = d?.provider_name && d.provider_name !== 'Finding...' ? d.provider_name : 'Courier Partner';
    const providerInitials =
      providerName.split(' ').filter(Boolean).slice(0, 2).map(s => s.charAt(0).toUpperCase()).join('') || 'P';
    const vehicle: any = d?.deliveryData?.vehicle;

    const canRate = !!d?.isMatched && isCompleted;
    const ratingLabels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
    const shownRating = ratingSaved ? ratingSaved.rating : ratingValue;

    const escrowStatusText = isCompleted
      ? 'Released to courier'
      : escrowRow?.status
        ? String(escrowRow.status).charAt(0).toUpperCase() + String(escrowRow.status).slice(1)
        : d?.isMatched ? 'Held in escrow' : 'Awaiting courier';

    const paymentTypeText = (() => {
      const raw = escrowRow?.payment_method || escrowRow?.payment_type || escrowRow?.method;
      if (!raw) return 'Escrow Payment';
      return String(raw).replace(/[_-]/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    })();

    return (
      <ScrollView
        contentContainerStyle={styles.detailContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: detailAnim }}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backCircleBtnDetail} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>Shipment Details</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.sdCard}>
            <View style={styles.sdTrackRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sdEyebrow}>TRACKING ID</Text>
                <Text style={styles.sdTrackId} numberOfLines={1}>{trackingId}</Text>
              </View>
              <TouchableOpacity
                style={[styles.sdCopyBtn, copied && styles.sdCopyBtnDone]}
                onPress={() => copyTrackingId(trackingId)}
                activeOpacity={0.85}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? '#FFFFFF' : ORANGE} />
                <Text style={[styles.sdCopyBtnText, copied && { color: '#FFFFFF' }]}>{copied ? 'Copied' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.sdChipRow}>
              <TouchableOpacity
                disabled={!canResume}
                onPress={() => d && handleResumeFindingProvider(d)}
                activeOpacity={0.8}
                style={[styles.sdStatusChip, isCompleted && styles.sdStatusChipSolid]}
              >
                <Ionicons name={getStatusIcon(currentStatus)} size={12} color={isCompleted ? '#FFFFFF' : ORANGE} />
                <Text style={[styles.sdStatusChipText, isCompleted && { color: '#FFFFFF' }]}>{currentStatus}</Text>
                {canResume && <Ionicons name="chevron-forward" size={12} color={ORANGE} />}
              </TouchableOpacity>
              <View style={styles.sdInfoChip}>
                <Ionicons name="cube-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.sdInfoChipText}>
                  {d?.total_items ?? 0} {(d?.total_items ?? 0) === 1 ? 'item' : 'items'}
                </Text>
              </View>
              <View style={styles.sdInfoChip}>
                <Ionicons name={d?.pickup_type === 'door-to-door' ? 'home-outline' : 'walk-outline'} size={12} color={colors.textSecondary} />
                <Text style={styles.sdInfoChipText}>
                  {d?.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}
                </Text>
              </View>
            </View>

            <View style={styles.stepperContainer}>
              {[
                { label: 'Placed', idx: 0 },
                { label: 'Matched', idx: 1 },
                { label: 'Item Collected', idx: 2 },
                { label: 'In Transit', idx: 3 },
                { label: 'Delivered', idx: 4 },
              ].map((step, sIdx) => {
                const isPassed = stepIndex >= step.idx;
                const isCurrent = stepIndex === step.idx;
                return (
                  <View key={sIdx} style={styles.stepItem}>
                    <View style={styles.stepRowIndicator}>
                      <View style={[styles.stepDot, isPassed && styles.stepDotActive, isCurrent && styles.stepDotCurrent]}>
                        {isPassed ? <Ionicons name="checkmark" size={10} color="#FFF" /> : <View style={styles.stepInnerDot} />}
                      </View>
                      {sIdx < 4 && <View style={[styles.stepLine, stepIndex > sIdx && styles.stepLineActive]} />}
                    </View>
                    <Text style={[styles.stepLabel, isCurrent && styles.stepLabelActive]} numberOfLines={1}>
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {renderPackagePhotosCard(d)}

          <View style={[styles.sdCard, { padding: 0, overflow: 'hidden' }]}>
            <TouchableOpacity style={styles.sdMap} activeOpacity={0.9} onPress={() => setShowFullMap(true)}>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                <LeafletMap
                  pickupLat={d?.coords.pickup.latitude}
                  pickupLng={d?.coords.pickup.longitude}
                  dropoffLat={d?.coords.dropoff.latitude}
                  dropoffLng={d?.coords.dropoff.longitude}
                />
              </View>
              <View style={styles.mapOverlayPill}>
                <Ionicons name="navigate" size={11} color={ORANGE} />
                <Text style={styles.overlayPillText}>
                  {isCompleted ? 'Fulfilled Route Map' : pickupVerified ? 'In Transit Along Cebu' : 'Live Route Preview'}
                </Text>
              </View>
              <View style={styles.mapTapHint}>
                <Text style={styles.mapTapHintText}>Tap for details</Text>
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
                  <Text style={styles.sdEyebrow}>PICKUP</Text>
                  <Text style={styles.sdRouteMain} numberOfLines={2}>{d?.pickup_main}</Text>
                  {!!d?.pickup_sub && <Text style={styles.sdRouteSub} numberOfLines={2}>{d.pickup_sub}</Text>}
                </View>
              </View>
              <View style={styles.sdRouteRow}>
                <View style={styles.sdRouteRail}>
                  <View style={styles.sdPinDropoff}>
                    <Ionicons name="location" size={11} color="#FFFFFF" />
                  </View>
                </View>
                <View style={[styles.sdRouteText, { paddingBottom: 0 }]}>
                  <Text style={styles.sdEyebrow}>DROP-OFF</Text>
                  <Text style={styles.sdRouteMain} numberOfLines={2}>{d?.dropoff_main}</Text>
                  {!!d?.dropoff_sub && <Text style={styles.sdRouteSub} numberOfLines={2}>{d.dropoff_sub}</Text>}
                </View>
              </View>

              {!!d?.receiver && (
                <View style={styles.sdReceiverRow}>
                  <View style={styles.sdReceiverIcon}>
                    <Ionicons name="person" size={14} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sdEyebrow}>RECEIVER</Text>
                    <Text style={styles.sdReceiverName} numberOfLines={1}>
                      {receiverDisplayName}
                      {d.receiver.receiver_name && d.receiver.receiver_phone ? `  ·  ${d.receiver.receiver_phone}` : ''}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          {showPickupQRButton && (
            <TouchableOpacity style={styles.pickupQRCard} onPress={() => setShowPickupQR(true)} activeOpacity={0.9}>
              <View style={styles.pickupQRIconBox}>
                <Ionicons name="qr-code" size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickupQRTitle}>Show Pickup QR Code</Text>
                <Text style={styles.pickupQRDesc}>Tap to present verification code to courier</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#FFF" />
            </TouchableOpacity>
          )}

          {pickupVerified && !isCompleted && (
            <TouchableOpacity style={styles.pickupQRCard} onPress={() => setShowDeliveryOTP(true)} activeOpacity={0.9}>
              <View style={styles.pickupQRIconBox}>
                <Ionicons name="key" size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickupQRTitle}>
                  {hasConfirmation && selectedDelivery?.confirmation?.system_otp ? 'Delivery OTP Ready' : 'Generating OTP…'}
                </Text>
                <Text style={styles.pickupQRDesc}>Tap to view the code and send it to the receiver</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#FFF" />
            </TouchableOpacity>
          )}

          <View style={styles.sdCard}>
            <View style={styles.sdCardHeader}>
              <View style={styles.sdCardHeaderIcon}>
                <Ionicons name="star" size={14} color={ORANGE} />
              </View>
              <Text style={styles.sdCardTitle}>Rate your courier</Text>
              {!!ratingSaved && (
                <View style={styles.sdRatedBadge}>
                  <Ionicons name="checkmark-circle" size={12} color={ORANGE} />
                  <Text style={styles.sdRatedBadgeText}>Rated</Text>
                </View>
              )}
            </View>

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
                    size={38}
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
                  {d?.isMatched ? 'You can rate once the delivery is completed.' : 'Available after a courier is assigned.'}
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
                  style={[styles.sdPrimaryBtn, ratingSubmitting && { opacity: 0.7 }]}
                  onPress={submitRating}
                  disabled={ratingSubmitting}
                  activeOpacity={0.9}
                >
                  {ratingSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.sdPrimaryBtnText}>Submit Rating</Text>
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

          <View style={styles.sdCard}>
            <View style={styles.sdCardHeader}>
              <View style={styles.sdCardHeaderIcon}>
                <Ionicons name="person" size={14} color={ORANGE} />
              </View>
              <Text style={styles.sdCardTitle}>Provider profile</Text>
            </View>

            {d?.isMatched ? (
              <>
                <View style={styles.sdProviderTop}>
                  <View style={styles.sdAvatar}>
                    <Text style={styles.sdAvatarText}>{providerInitials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sdProviderName} numberOfLines={1}>{providerName}</Text>
                    <View style={styles.sdVerifiedRow}>
                      <Ionicons name="shield-checkmark" size={12} color={ORANGE} />
                      <Text style={styles.sdVerifiedText}>Verified courier partner</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.sdStatsRow}>
                  <View style={styles.sdStat}>
                    <Text style={styles.sdStatLabel}>VEHICLE</Text>
                    <Text style={styles.sdStatValue} numberOfLines={1}>{vehicle?.vehicle_type || '—'}</Text>
                  </View>
                  <View style={styles.sdStatDivider} />
                  <View style={styles.sdStat}>
                    <Text style={styles.sdStatLabel}>PLATE NO.</Text>
                    <Text style={styles.sdStatValue} numberOfLines={1}>{vehicle?.plate_number || '—'}</Text>
                  </View>
                  {vehicle?.max_weight_kg != null && (
                    <>
                      <View style={styles.sdStatDivider} />
                      <View style={styles.sdStat}>
                        <Text style={styles.sdStatLabel}>CAPACITY</Text>
                        <Text style={styles.sdStatValue} numberOfLines={1}>{vehicle.max_weight_kg} kg</Text>
                      </View>
                    </>
                  )}
                </View>

                <View style={styles.sdBtnRow}>
                  <TouchableOpacity
                    style={styles.sdPrimaryBtnSm}
                    activeOpacity={0.9}
                    onPress={() => d && handleMessageProvider(d)}
                    disabled={openingChat}
                  >
                    {openingChat ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Ionicons name="chatbubble-ellipses-outline" size={15} color="#FFFFFF" />
                        <Text style={styles.sdPrimaryBtnText}>Message</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  {!!d?.provider_phone && (
                    <TouchableOpacity
                      style={styles.sdOutlineBtn}
                      activeOpacity={0.9}
                      onPress={() => Linking.openURL(`tel:${d.provider_phone}`)}
                    >
                      <Ionicons name="call-outline" size={15} color={ORANGE} />
                      <Text style={styles.sdOutlineBtnText}>Call</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <View style={styles.sdFindingBox}>
                <View style={styles.sdFindingIcon}>
                  <Ionicons name="search" size={20} color={ORANGE} />
                </View>
                <Text style={styles.sdFindingTitle}>No courier assigned yet</Text>
                <Text style={styles.sdFindingSub}>We're still looking for a courier partner for this shipment.</Text>
                {currentStatus === 'Waiting for Provider' && (
                  <TouchableOpacity
                    style={[styles.sdPrimaryBtnSm, { alignSelf: 'stretch', marginTop: 12 }]}
                    onPress={() => d && handleResumeFindingProvider(d)}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="time-outline" size={15} color="#FFFFFF" />
                    <Text style={styles.sdPrimaryBtnText}>Find courier</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          <View style={styles.sdCard}>
            <View style={styles.sdCardHeader}>
              <View style={styles.sdCardHeaderIcon}>
                <Ionicons name="card" size={14} color={ORANGE} />
              </View>
              <Text style={styles.sdCardTitle}>Payment</Text>
            </View>

            <View style={styles.sdPayRow}>
              <Text style={styles.sdPayLabel}>Payment type</Text>
              <View style={styles.sdPayValueRow}>
                <Ionicons name="shield-checkmark-outline" size={14} color={ORANGE} />
                <Text style={styles.sdPayValue}>{paymentTypeText}</Text>
              </View>
            </View>
            <View style={styles.sdPayDivider} />
            <View style={styles.sdPayRow}>
              <Text style={styles.sdPayLabel}>Payment status</Text>
              <Text style={styles.sdPayValue}>{escrowStatusText}</Text>
            </View>

            <View style={styles.sdTotalBox}>
              <Text style={styles.sdTotalLabel}>{isCompleted ? 'Total paid' : 'Total payment'}</Text>
              <Text style={styles.sdTotalValue}>₱{d?.price}</Text>
            </View>
          </View>

          <View style={styles.sdCard}>
            <View style={styles.sdCardHeader}>
              <View style={styles.sdCardHeaderIcon}>
                <Ionicons name="time-outline" size={14} color={ORANGE} />
              </View>
              <Text style={styles.sdCardTitle}>Delivery timeline</Text>
            </View>

            <View style={styles.tlRow}>
              <Ionicons name={d?.isMatched ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={d?.isMatched ? ORANGE : colors.border} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tlTitle, !d?.isMatched && { color: colors.textMuted }]}>Accepted</Text>
                <Text style={styles.tlSub}>
                  {d?.deliveryData?.accepted_at ? formatDateTimeShort(d.deliveryData.accepted_at) : d?.isMatched ? 'Courier assigned' : 'Waiting for a courier'}
                </Text>
              </View>
            </View>

            <View style={styles.tlRow}>
              <Ionicons name={pickupVerified ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={pickupVerified ? ORANGE : colors.border} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tlTitle, !pickupVerified && { color: colors.textMuted }]}>Package picked up</Text>
                <Text style={styles.tlSub}>
                  {pickupVerified ? 'Verified with sender QR / PIN' : d?.isMatched ? 'Waiting for courier to scan QR or enter PIN' : 'Awaiting courier'}
                </Text>
              </View>
            </View>

            <View style={[styles.tlRow, { paddingBottom: 0 }]}>
              <Ionicons name={isCompleted ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={isCompleted ? ORANGE : colors.border} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tlTitle, !isCompleted && { color: colors.textMuted }]}>Delivered</Text>
                <Text style={styles.tlSub}>
                  {isCompleted && d?.deliveryData?.completed_at
                    ? formatDateTimeShort(d.deliveryData.completed_at)
                    : d?.deliveryData?.estimated_eta
                      ? `Estimated arrival ${formatDateTimeShort(d.deliveryData.estimated_eta)}`
                      : 'Awaiting delivery'}
                </Text>
              </View>
            </View>
          </View>

          {!isCompleted && (
            <View style={styles.detailActionsRow}>
              {!d?.isMatched && (
                <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(d?.rawData)} activeOpacity={0.9}>
                  <Text style={styles.editBtnText}>Edit Details</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.sdCancelBtn} onPress={() => handleDelete(d?.rawData)} activeOpacity={0.9}>
                <Text style={styles.sdCancelBtnText}>Cancel Booking</Text>
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
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{selectedDelivery?.status}</Text>
        </View>
      </View>

      {selectedDelivery && (
        <View style={[styles.mapInfoSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetGrabber} />
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 360 }}>
            <View style={styles.etaPayRow}>
              <View style={styles.etaPayBox}>
                <View style={styles.etaPayLabelRow}>
                  <Ionicons name="time-outline" size={12} color={ORANGE} />
                  <Text style={styles.etaPayLabel}>ESTIMATED ARRIVAL</Text>
                </View>
                <Text style={styles.etaPayValue} numberOfLines={1}>
                  {selectedDelivery.deliveryData?.completed_at
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
                      <Ionicons name="call-outline" size={15} color={colors.textPrimary} />
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
            <Text style={styles.modalTitle}>Pickup Verification</Text>
            <TouchableOpacity onPress={() => setShowPickupQR(false)}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            Show this QR to your courier. Or read them the 4-digit PIN below.
          </Text>

          {selectedDelivery?.qr?.pickup_qr ? (
            <View style={styles.qrWrap}>
              <QRCode value={selectedDelivery.qr.pickup_qr} size={200} color={colors.textPrimary} backgroundColor={colors.card} />
            </View>
          ) : (
            <ActivityIndicator color={ORANGE} style={{ margin: 40 }} />
          )}

          {!!selectedDelivery?.qr?.pickup_pin && (
            <View style={styles.pinRevealBox}>
              <Text style={styles.pinRevealLabel}>PIN CODE</Text>
              <Text style={styles.pinRevealValue}>{selectedDelivery.qr.pickup_pin}</Text>
              <Text style={styles.pinRevealHint}>Courier can enter this PIN instead of scanning the QR.</Text>
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
    const smsMessage = `Hi ${receiverName}, here is your delivery OTP for shipment #${trackingId}: ${otp || '------'}. Please read this code to the courier when they arrive.`;

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
      } catch {}
    };

    return (
      <Modal visible={showDeliveryOTP} transparent animationType="slide" onRequestClose={() => setShowDeliveryOTP(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 360 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Delivery OTP</Text>
              <TouchableOpacity onPress={() => setShowDeliveryOTP(false)}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {verified
                ? 'The receiver has confirmed this delivery.'
                : 'Send this code to the receiver. They will read it back to the courier on arrival.'}
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
                    <Text style={styles.otpSendBtnText}>Send to {receiverName}</Text>
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

  return (
    <SafeAreaView style={styles.container} edges={showFullMap ? [] : ['top']}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {showFullMap && selectedDelivery ? renderFullMapView() : selectedDelivery ? renderDetailView() : renderListView()}
      {renderPickupQRModal()}
      {renderDeliveryOTPModal()}
      {renderPhotoPreviewModal()}
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  headerSection: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },

  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textPrimary },

  pageTitle: {
    fontSize: 28, fontWeight: '800', color: c.textPrimary,
    letterSpacing: -0.5, marginBottom: 12,
  },

  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingBottom: 16 },
  tlTitle: { fontSize: 14, fontWeight: '700', color: c.textPrimary },
  tlSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 },

  tabBarScroll: { gap: 8, paddingTop: 16, paddingBottom: 4 },
  tabItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, gap: 6,
  },
  tabItemActive: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  tabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  tabTextActive: { color: ORANGE },
  tabCountBadge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.divider, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  tabCountBadgeActive: { backgroundColor: 'rgba(255, 117, 31, 0.18)' },
  tabCountText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
  tabCountTextActive: { color: ORANGE },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 80 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  loadingText: { fontSize: 12, color: c.textSecondary, marginTop: 8, fontWeight: '500' },
  noResultsContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 20 },
  emptyIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: ORANGE },
  noResultsText: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  noResultsSubtext: { fontSize: 11, color: c.textSecondary, marginTop: 3, textAlign: 'center' },

  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.06 : 0.3, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: c.border,
  },
  completedCard: { backgroundColor: c.background, borderColor: c.border, opacity: 0.95 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  serviceTypeBadge: { backgroundColor: c.divider, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  serviceTypeText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },

  routeBox: {
    backgroundColor: c.background, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 12, borderWidth: 1, borderColor: c.divider,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeConnectorLine: { width: 2, height: 10, backgroundColor: c.border, marginLeft: 3, marginVertical: 3 },
  routeAddressText: { fontSize: 14, fontWeight: '600', color: c.textPrimary, flex: 1 },

  pkgCount: { fontSize: 11, fontWeight: '700', color: c.textSecondary },
  pkgRow: { gap: 12, paddingRight: 4 },
  pkgThumbWrap: { width: 150 },
  pkgThumb: { width: 150, height: 150, borderRadius: 14, backgroundColor: c.divider },
  pkgThumbFailed: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border },
  pkgThumbLabel: { marginTop: 6, fontSize: 12, fontWeight: '600', color: c.textSecondary },
  pkgHint: { marginTop: 12, fontSize: 12, color: c.textSecondary, lineHeight: 17 },
  pkgEmpty: {
    height: 64, borderRadius: 14, backgroundColor: c.background,
    borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  pkgEmptyText: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  cardPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardPhoto: { width: 48, height: 48, borderRadius: 10, backgroundColor: c.divider },
  cardPhotoMore: { alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft },
  cardPhotoMoreText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  cardPhotoLabel: { marginLeft: 4, fontSize: 11, fontWeight: '700', color: c.textMuted },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', top: 48, right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  cardContextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  contextDateBox: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  contextText: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  contextProviderPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successBg,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 5,
    borderWidth: 1, borderColor: c.success, flexShrink: 1,
  },
  contextProviderText: { fontSize: 11, fontWeight: '700', color: c.success },

  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider,
  },
  priceText: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  actionBadgeActive: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#7C3AED',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, gap: 6,
  },
  actionBadgeActiveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  actionBadgeComplete: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successBg,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, gap: 5,
    borderWidth: 1, borderColor: c.success,
  },
  actionBadgeCompleteText: { fontSize: 13, fontWeight: '700', color: c.success },
  actionBadgePending: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.warningBg,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, gap: 5,
    borderWidth: 1, borderColor: c.warning,
  },
  actionBadgePendingText: { fontSize: 12, fontWeight: '700', color: c.warning },

  sdItemsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.background,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: c.divider,
  },
  sdItemsChipText: { fontSize: 11, fontWeight: '700', color: c.textSecondary },

  detailContainer: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 12 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backCircleBtnDetail: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border,
  },
  detailHeaderTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  headerSpacer: { width: 36, height: 36 },

  sdCard: {
    backgroundColor: c.card, borderRadius: 20, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.06 : 0.3,
    shadowRadius: 12, elevation: 3,
  },
  sdEyebrow: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  sdTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sdTrackId: { fontSize: 26, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.6, marginTop: 4 },
  sdCopyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accentSoft,
    borderWidth: 1, borderColor: ORANGE, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
  },
  sdCopyBtnDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  sdCopyBtnText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  sdChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 16 },
  sdStatusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.accentSoft,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  sdStatusChipSolid: { backgroundColor: ORANGE },
  sdStatusChipText: { fontSize: 11, fontWeight: '800', color: ORANGE },
  sdInfoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.background,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: c.divider,
  },
  sdInfoChipText: { fontSize: 11, fontWeight: '700', color: c.textSecondary },

  stepperContainer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider,
  },
  stepItem: { flex: 1, alignItems: 'center' },
  stepRowIndicator: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepDot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: c.border,
    justifyContent: 'center', alignItems: 'center', zIndex: 2,
  },
  stepDotActive: { backgroundColor: ORANGE },
  stepDotCurrent: { backgroundColor: ORANGE, borderWidth: 3, borderColor: isDark ? '#3A2411' : '#FFE4D2' },
  stepInnerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.textMuted },
  stepLine: { position: 'absolute', left: '50%', right: '-50%', height: 2, backgroundColor: c.border, zIndex: 1 },
  stepLineActive: { backgroundColor: ORANGE },
  stepLabel: { fontSize: 9, fontWeight: '700', color: c.textMuted, marginTop: 8, textAlign: 'center' },
  stepLabelActive: { color: ORANGE, fontWeight: '900' },

  sdMap: { width: '100%', height: 190, backgroundColor: '#F3F4F6' },
  sdRoutePad: { padding: 18 },
  sdRouteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sdRouteRail: { width: 22, alignItems: 'center', marginRight: 12 },
  sdPinPickup: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: ORANGE,
    justifyContent: 'center', alignItems: 'center', backgroundColor: c.card,
  },
  sdPinPickupInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE },
  sdPinDropoff: { width: 20, height: 20, borderRadius: 10, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  sdRailLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: ORANGE, marginVertical: 3, borderRadius: 1, opacity: 0.4 },
  sdRouteText: { flex: 1, paddingBottom: 16 },
  sdRouteMain: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 3 },
  sdRouteSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 16 },
  sdReceiverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  sdReceiverIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  sdReceiverName: { fontSize: 13, fontWeight: '800', color: c.textPrimary, marginTop: 2 },

  mapOverlayPill: {
    position: 'absolute', bottom: 10, left: 10, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  overlayPillText: { fontSize: 10, fontWeight: '700', color: c.textPrimary },
  mapTapHint: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(17,24,39,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  mapTapHintText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },

  pickupQRCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: ORANGE,
    borderRadius: 14, padding: 14, marginBottom: 12, gap: 12,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  pickupQRIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  pickupQRTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  pickupQRDesc: { color: '#FFE0C7', fontSize: 10, marginTop: 1 },

  sdCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sdCardHeaderIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center' },
  sdCardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  sdRatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accentSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sdRatedBadgeText: { fontSize: 10, fontWeight: '800', color: ORANGE },

  sdStarsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 4 },
  sdRatingLabel: { textAlign: 'center', fontSize: 14, fontWeight: '800', color: ORANGE, marginTop: 8 },
  sdLockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  sdLockedNoteText: { fontSize: 12, color: c.textMuted, fontWeight: '600' },
  sdTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  sdTag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  sdTagOn: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  sdTagText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  sdTagTextOn: { color: ORANGE },
  sdCommentInput: {
    marginTop: 14, minHeight: 78, borderWidth: 1, borderColor: c.border, borderRadius: 14,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 13, color: c.textPrimary,
    backgroundColor: c.background, textAlignVertical: 'top',
  },
  sdPrimaryBtn: {
    marginTop: 14, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  sdPrimaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sdThanks: { marginTop: 4 },
  sdThanksComment: { marginTop: 12, fontSize: 13, color: c.textSecondary, fontStyle: 'italic', textAlign: 'center' },
  sdThanksText: { marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: '700', color: c.textMuted },

  sdProviderTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sdAvatar: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: ORANGE,
  },
  sdAvatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  sdProviderName: { fontSize: 17, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.3 },
  sdVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sdVerifiedText: { fontSize: 12, fontWeight: '700', color: ORANGE },
  sdStatsRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, borderRadius: 14,
    paddingVertical: 12, marginTop: 16, borderWidth: 1, borderColor: c.divider,
  },
  sdStat: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  sdStatLabel: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  sdStatValue: { fontSize: 13, fontWeight: '800', color: c.textPrimary, marginTop: 4 },
  sdStatDivider: { width: 1, height: 28, backgroundColor: c.border },
  sdBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sdPrimaryBtnSm: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 13,
  },
  sdOutlineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.card, borderRadius: 14, paddingVertical: 13, borderWidth: 1.5, borderColor: ORANGE,
  },
  sdOutlineBtnText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  sdFindingBox: { alignItems: 'center', paddingVertical: 6 },
  sdFindingIcon: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  sdFindingTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  sdFindingSub: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 17 },

  sdPayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  sdPayLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  sdPayValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sdPayValue: { fontSize: 13, color: c.textPrimary, fontWeight: '800' },
  sdPayDivider: { height: 1, backgroundColor: c.divider, marginVertical: 10 },
  sdTotalBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: ORANGE, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginTop: 16,
  },
  sdTotalLabel: { fontSize: 13, fontWeight: '700', color: '#FFE4D2' },
  sdTotalValue: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 },

  detailActionsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8, marginBottom: 8 },
  editBtn: {
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', flex: 1,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  sdCancelBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.error,
  },
  sdCancelBtnText: { color: c.error, fontWeight: '700', fontSize: 14 },

  fullMapContainer: { flex: 1, backgroundColor: c.background },
  topOverlay: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10,
  },
  backCircleBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border,
  },
  statusPill: {
    backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: c.border,
  },
  statusPillText: { fontSize: 11, fontWeight: '700', color: c.textPrimary },

  courierIdentityRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  courierAvatarWrap: { width: 52, height: 52 },
  courierAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: c.textPrimary,
    justifyContent: 'center', alignItems: 'center',
  },
  courierAvatarText: { color: c.card, fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  courierVerifiedDot: {
    position: 'absolute', right: -1, bottom: -1, width: 18, height: 18, borderRadius: 9,
    backgroundColor: c.success, borderWidth: 2, borderColor: c.card,
    justifyContent: 'center', alignItems: 'center',
  },
  courierName: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  courierSub: { fontSize: 10, color: c.success, fontWeight: '700', marginTop: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  infoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.divider,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  plateChip: { backgroundColor: isDark ? '#2A1F0A' : '#FEF9C3', borderWidth: 1, borderColor: c.warning },
  infoChipText: { fontSize: 10, fontWeight: '700', color: c.textSecondary },
  courierActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  courierMsgBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ORANGE, paddingVertical: 11, borderRadius: 12,
  },
  courierMsgBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  courierCallBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.card, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: c.border,
  },
  courierCallBtnText: { color: c.textPrimary, fontWeight: '700', fontSize: 12 },

  mapInfoSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.5,
    shadowRadius: 16, elevation: 14,
  },
  sheetGrabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 12 },
  etaPayRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  etaPayBox: { flex: 1, backgroundColor: c.accentSoft, borderRadius: 12, borderWidth: 1, borderColor: ORANGE, padding: 12 },
  etaPayLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  etaPayLabel: { fontSize: 8, fontWeight: '900', color: ORANGE, letterSpacing: 0.6 },
  etaPayValue: { fontSize: 15, fontWeight: '900', color: c.textPrimary },
  mapSection: {
    backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.divider,
    padding: 12, marginBottom: 12,
  },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingText: { flex: 1, fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  detailLine: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 5, gap: 12,
  },
  detailLineLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  detailLineValue: { fontSize: 11, color: c.textPrimary, fontWeight: '800', flexShrink: 1, textAlign: 'right' },
  trackerPlaceholder: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: isDark ? '#231542' : '#F5F3FF',
    borderRadius: 14, borderWidth: 1, borderColor: '#7C3AED', padding: 12, marginBottom: 6,
  },
  trackerIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
  },
  trackerTitle: { fontSize: 12, fontWeight: '800', color: isDark ? '#C4B5FD' : '#5B21B6' },
  trackerSub: { fontSize: 10, color: isDark ? '#A78BFA' : '#7C3AED', marginTop: 1 },
  soonBadge: { backgroundColor: '#7C3AED', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  soonBadgeText: { fontSize: 8, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.6 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 340, backgroundColor: c.card, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  modalHeader: { flexDirection: 'row', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary },
  modalSubtitle: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginBottom: 14 },
  qrWrap: { width: 200, height: 200, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12, marginBottom: 14, backgroundColor: '#FFFFFF', padding: 8 },
  modalDoneBtn: { width: '100%', backgroundColor: c.textPrimary, paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  modalDoneBtnText: { color: c.card, fontWeight: '700', fontSize: 13 },
  verifiedBox: { alignItems: 'center', paddingVertical: 20, marginBottom: 14 },
  verifiedText: { fontSize: 15, fontWeight: '800', color: c.success, marginTop: 8 },

  pinRevealBox: {
    width: '100%', backgroundColor: c.accentSoft, borderRadius: 16,
    borderWidth: 1.5, borderColor: ORANGE,
    paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', marginBottom: 14,
  },
  pinRevealLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 1.2, marginBottom: 6 },
  pinRevealValue: { fontSize: 34, fontWeight: '900', color: c.textPrimary, letterSpacing: 10 },
  pinRevealHint: { fontSize: 10, color: c.textSecondary, marginTop: 8, textAlign: 'center', fontWeight: '600' },

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
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  otpSendBtnText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  otpCopyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 12, width: '100%',
    borderWidth: 1.5, borderColor: ORANGE,
  },
  otpCopyBtnText: { color: ORANGE, fontSize: 13, fontWeight: '800' },
});