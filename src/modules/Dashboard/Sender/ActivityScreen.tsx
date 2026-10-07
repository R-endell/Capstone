// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
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

const { width } = Dimensions.get('window');
const ORANGE = '#FF751F';

// Real copy-to-clipboard needs: npx expo install expo-clipboard
// If it isn't installed yet, the Copy button falls back to the system share sheet.
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
  const [copied, setCopied] = useState(false);
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

  // Load payment + existing rating whenever a shipment's details are opened
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
        .from('escrow_payments').select('*').eq('delivery_id', detailDeliveryId).limit(1).maybeSingle();
      if (!cancelled && esc) setEscrowRow(esc);

      const { data: rt } = await supabase
        .from('provider_ratings').select('*').eq('delivery_id', detailDeliveryId).limit(1).maybeSingle();
      if (!cancelled && rt) {
        setRatingSaved({
          rating: Number(rt.rating) || 0,
          tags: Array.isArray(rt.tags) ? rt.tags : [],
          comment: rt.comment ?? null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [detailRequestId, detailDeliveryId]);

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
    setRatingSubmitting(true);
    try {
      const comment = ratingComment.trim() || null;
      const { error } = await supabase.from('provider_ratings').upsert(
        {
          delivery_id: dd.delivery_id,
          provider_id: dd.provider_id ?? selectedDelivery?.provider_id ?? null,
          sender_id: userId,
          rating: ratingValue,
          tags: ratingTags,
          comment,
        },
        { onConflict: 'delivery_id' }
      );
      if (error) throw error;
      setRatingSaved({ rating: ratingValue, tags: ratingTags, comment });
    } catch (e: any) {
      console.warn('Rating save failed:', e?.message || e);
      Alert.alert('Could not save rating', 'Please try again in a moment.');
    } finally {
      setRatingSubmitting(false);
    }
  };

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
                  {/* Header: Service Type + Status (Side by side) */}
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
                      <Ionicons name="cube-outline" size={12} color="#6B7280" />
                      <Text style={styles.sdItemsChipText}>
                        {item.total_items} {item.total_items === 1 ? 'item' : 'items'}
                      </Text>
                    </View>
                  </View>

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
    const d = selectedDelivery;
    const pickupVerified =
      d?.qr?.pickup_verified === true ||
      d?.status === 'In Transit' ||
      d?.status === 'Completed';

    const isCompleted = d?.status === 'Completed' || !!d?.deliveryData?.completed_at;

    const showPickupQRButton =
      !!d?.isMatched && !!d?.qr && !d?.qr?.pickup_verified && !isCompleted;

    const hasConfirmation = !!d?.confirmation;
    const otpVerified = d?.confirmation?.otp_verified === true;

    const receiverDisplayName =
      d?.receiver?.receiver_name?.trim() || d?.receiver?.receiver_phone || 'Receiver';

    const currentStatus = d?.status || 'Waiting for Provider';
    let stepIndex = 0;
    if (currentStatus === 'Matched') stepIndex = 1;
    else if (currentStatus === 'In Progress' || currentStatus === 'In Transit') stepIndex = 2;
    else if (currentStatus === 'Completed') stepIndex = 3;

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
        : d?.isMatched
          ? 'Held in escrow'
          : 'Awaiting courier';
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
          {/* Header */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backCircleBtnDetail} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>Shipment Details</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* 1. Tracking ID + copy */}
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
                <Ionicons name="cube-outline" size={12} color="#6B7280" />
                <Text style={styles.sdInfoChipText}>
                  {d?.total_items ?? 0} {(d?.total_items ?? 0) === 1 ? 'item' : 'items'}
                </Text>
              </View>
              <View style={styles.sdInfoChip}>
                <Ionicons name={d?.pickup_type === 'door-to-door' ? 'home-outline' : 'walk-outline'} size={12} color="#6B7280" />
                <Text style={styles.sdInfoChipText}>
                  {d?.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}
                </Text>
              </View>
            </View>

            <View style={styles.stepperContainer}>
              {[
                { label: 'Placed', idx: 0 },
                { label: 'Matched', idx: 1 },
                { label: 'In Transit', idx: 2 },
                { label: 'Delivered', idx: 3 },
              ].map((step, sIdx) => {
                const isPassed = stepIndex >= step.idx;
                const isCurrent = stepIndex === step.idx;
                return (
                  <View key={sIdx} style={styles.stepItem}>
                    <View style={styles.stepRowIndicator}>
                      <View style={[styles.stepDot, isPassed && styles.stepDotActive, isCurrent && styles.stepDotCurrent]}>
                        {isPassed ? <Ionicons name="checkmark" size={10} color="#FFF" /> : <View style={styles.stepInnerDot} />}
                      </View>
                      {sIdx < 3 && <View style={[styles.stepLine, stepIndex > sIdx && styles.stepLineActive]} />}
                    </View>
                    <Text style={[styles.stepLabel, isCurrent && styles.stepLabelActive]} numberOfLines={1}>
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* 2. Map + pickup / drop-off */}
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

          {/* Action cards (needed during the delivery) */}
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

          {pickupVerified && !isCompleted && hasConfirmation && (
            <TouchableOpacity style={styles.sdOtpCard} onPress={() => setShowDeliveryOTP(true)} activeOpacity={0.9}>
              <View style={styles.sdOtpIcon}>
                <Ionicons name={otpVerified ? 'shield-checkmark' : 'lock-closed'} size={18} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sdOtpTitle}>{otpVerified ? 'Delivery Confirmed' : 'Receiver OTP Code'}</Text>
                <Text style={styles.sdOtpSub} numberOfLines={1}>
                  {otpVerified ? 'Funds successfully released.' : 'Tap to view the drop-off confirmation code.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={ORANGE} />
            </TouchableOpacity>
          )}

          {/* 3. Rate the provider */}
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
                    color={n <= shownRating ? ORANGE : '#FFC9A3'}
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
                <Ionicons name="lock-closed-outline" size={12} color="#9CA3AF" />
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
                  placeholderTextColor="#9CA3AF"
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

          {/* 4. Provider profile */}
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

          {/* 5. Payment */}
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

          {/* Bottom actions */}
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
  activeCardStyle: {},
  pendingCardStyle: {},
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
  cardId: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.2,
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
  cargoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  cargoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  cargoBannerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9A3412',
    flex: 1,
  },
  itemCountPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  itemCountText: {
    fontSize: 10,
    fontWeight: '800',
    color: ORANGE,
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
  routeTextCol: {
    flex: 1,
  },
  routeLabelMini: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    marginBottom: 2,
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
  footerLabel: {
    fontSize: 9,
    color: '#9CA3AF',
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
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
  fullMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  fullMapBtnText: {
    fontSize: 11,
    color: ORANGE,
    fontWeight: '800',
  },

  // Hero Card & Stepper
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroTrackingLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  heroTrackingId: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
    marginTop: 3,
    letterSpacing: -0.4,
  },
  heroStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    gap: 6,
  },
  heroStatusText: {
    fontSize: 12,
    fontWeight: '800',
  },

  stepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  stepItem: { flex: 1, alignItems: 'center' },
  stepRowIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
  },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  stepDotActive: { backgroundColor: ORANGE },
  stepDotCurrent: {
    backgroundColor: ORANGE,
    borderWidth: 3,
    borderColor: '#FFE4D2',
  },
  stepInnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#9CA3AF',
  },
  stepLine: {
    position: 'absolute',
    left: '50%',
    right: '-50%',
    height: 2,
    backgroundColor: '#E5E7EB',
    zIndex: 1,
  },
  stepLineActive: { backgroundColor: ORANGE },
  stepLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },
  stepLabelActive: {
    color: ORANGE,
    fontWeight: '900',
  },

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
  
  summaryGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryDividerVertical: { width: 1, height: 24, backgroundColor: '#E5E7EB', marginHorizontal: 4 },
  summaryLabel: { fontSize: 9, color: '#6B7280', fontWeight: '600', marginBottom: 2 },
  summaryValue: { fontSize: 12, color: '#111827', fontWeight: '800', textAlign: 'center' },

  completedReceiptBanner: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  completedReceiptHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  completedIconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#DCFCE7', justifyContent: 'center', alignItems: 'center' },
  completedBannerTitle: { fontSize: 13, fontWeight: '800', color: '#166534' },
  completedBannerSubtitle: { fontSize: 10, color: '#4B5563', fontWeight: '500' },
  completedReceiptDivider: { height: 1, backgroundColor: '#BBF7D0', marginVertical: 10 },
  completedFareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  completedFareLabel: { fontSize: 11, fontWeight: '700', color: '#166534' },
  completedFareValue: { fontSize: 14, fontWeight: '900', color: '#166534' },

  pickupQRCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: ORANGE,
    borderRadius: 14, padding: 14, marginBottom: 12, gap: 12,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  pickupQRIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  pickupQRTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  pickupQRDesc: { color: '#FFE0C7', fontSize: 10, marginTop: 1 },

  deliveryOTPCard: {
    backgroundColor: '#F5F3FF', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  deliveryOTPHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deliveryOTPIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#EDE9FE' },
  deliveryOTPTitle: { fontSize: 13, fontWeight: '800', color: '#5B21B6' },
  deliveryOTPSubtitle: { fontSize: 10, color: '#7C3AED', marginTop: 1 },

  detailMapCard: {
    width: '100%', height: 160, borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  mapOverlayPill: {
    position: 'absolute', bottom: 10, left: 10, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  overlayPillText: { fontSize: 10, fontWeight: '700', color: '#111827' },

  routeTimeline: { gap: 2, paddingLeft: 4 },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start' },
  routeIconWrapper: { width: 16, alignItems: 'center', marginRight: 10, marginTop: 2 },
  routeLine: { width: 1, height: 32, backgroundColor: '#E5E7EB', marginVertical: 2 },
  routeTextWrapper: { flex: 1, paddingBottom: 12 },
  routeLabel: { fontSize: 8, fontWeight: '900', color: ORANGE, letterSpacing: 0.8, marginBottom: 2 },
  routeMain: { fontSize: 12, fontWeight: '800', color: '#111827' },
  routeSub: { fontSize: 10, color: '#6B7280', marginTop: 1 },

  receiverCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  receiverAvatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#7C3AED',
    justifyContent: 'center', alignItems: 'center',
  },
  receiverAvatarText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  receiverInfo: { flex: 1 },
  receiverName: { fontSize: 13, fontWeight: '800', color: '#111827' },
  receiverPhone: { fontSize: 11, color: '#6B7280', fontWeight: '600', marginTop: 2 },

  providerInfoCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, marginBottom: 14,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  providerInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  providerInfoTitle: { fontSize: 9, fontWeight: '900', color: '#16A34A', letterSpacing: 0.8 },
  providerInfoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerInfoDetails: { flex: 1 },
  providerInfoName: { fontSize: 14, fontWeight: '800', color: '#111827' },
  providerInfoVehicle: { fontSize: 11, color: '#4B5563', marginTop: 2, fontWeight: '500' },
  providerContactBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#BBF7D0',
  },

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

  // ---------- Shipment details (one-column redesign, #FF751F + white) ----------
  sdCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#F1F1F1',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  sdEyebrow: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1 },
  sdTrackRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sdTrackId: { fontSize: 26, fontWeight: '900', color: '#111827', letterSpacing: -0.6, marginTop: 4 },
  sdCopyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFF4EC',
    borderWidth: 1, borderColor: '#FFD9BF', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
  },
  sdCopyBtnDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  sdCopyBtnText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  sdChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 16 },
  sdStatusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFF4EC',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
  },
  sdStatusChipSolid: { backgroundColor: ORANGE },
  sdStatusChipText: { fontSize: 11, fontWeight: '800', color: ORANGE },
  sdInfoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F9FAFB',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#F1F1F1',
  },
  sdInfoChipText: { fontSize: 11, fontWeight: '700', color: '#4B5563' },

  sdMap: { width: '100%', height: 190, backgroundColor: '#F3F4F6' },
  sdRoutePad: { padding: 18 },
  sdRouteRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sdRouteRail: { width: 22, alignItems: 'center', marginRight: 12 },
  sdPinPickup: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: ORANGE,
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF',
  },
  sdPinPickupInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE },
  sdPinDropoff: { width: 20, height: 20, borderRadius: 10, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  sdRailLine: { width: 2, flex: 1, minHeight: 28, backgroundColor: '#FFD9BF', marginVertical: 3, borderRadius: 1 },
  sdRouteText: { flex: 1, paddingBottom: 16 },
  sdRouteMain: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 3 },
  sdRouteSub: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },
  sdReceiverRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  sdReceiverIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFF4EC', justifyContent: 'center', alignItems: 'center' },
  sdReceiverName: { fontSize: 13, fontWeight: '800', color: '#111827', marginTop: 2 },

  sdOtpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1.5, borderColor: ORANGE,
  },
  sdOtpIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF4EC', justifyContent: 'center', alignItems: 'center' },
  sdOtpTitle: { fontSize: 13, fontWeight: '800', color: '#111827' },
  sdOtpSub: { fontSize: 11, color: '#6B7280', marginTop: 2 },

  sdCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sdCardHeaderIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF4EC', justifyContent: 'center', alignItems: 'center' },
  sdCardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  sdRatedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF4EC', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  sdRatedBadgeText: { fontSize: 10, fontWeight: '800', color: ORANGE },

  sdStarsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 4 },
  sdRatingLabel: { textAlign: 'center', fontSize: 14, fontWeight: '800', color: ORANGE, marginTop: 8 },
  sdLockedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  sdLockedNoteText: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  sdTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  sdTag: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
  sdTagOn: { backgroundColor: '#FFF4EC', borderColor: ORANGE },
  sdTagText: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  sdTagTextOn: { color: ORANGE },
  sdCommentInput: {
    marginTop: 14, minHeight: 78, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 13, color: '#111827',
    backgroundColor: '#FAFAFA', textAlignVertical: 'top',
  },
  sdPrimaryBtn: {
    marginTop: 14, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  sdPrimaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sdThanks: { marginTop: 4 },
  sdThanksComment: { marginTop: 12, fontSize: 13, color: '#4B5563', fontStyle: 'italic', textAlign: 'center' },
  sdThanksText: { marginTop: 12, textAlign: 'center', fontSize: 12, fontWeight: '700', color: '#9CA3AF' },

  sdProviderTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  sdAvatar: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFE4D2',
  },
  sdAvatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', letterSpacing: 0.5 },
  sdProviderName: { fontSize: 17, fontWeight: '900', color: '#111827', letterSpacing: -0.3 },
  sdVerifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  sdVerifiedText: { fontSize: 12, fontWeight: '700', color: ORANGE },
  sdStatsRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: 14,
    paddingVertical: 12, marginTop: 16, borderWidth: 1, borderColor: '#F1F1F1',
  },
  sdStat: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  sdStatLabel: { fontSize: 9, fontWeight: '800', color: '#9CA3AF', letterSpacing: 0.8 },
  sdStatValue: { fontSize: 13, fontWeight: '800', color: '#111827', marginTop: 4 },
  sdStatDivider: { width: 1, height: 28, backgroundColor: '#E5E7EB' },
  sdBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  sdPrimaryBtnSm: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 13,
  },
  sdOutlineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 13, borderWidth: 1.5, borderColor: ORANGE,
  },
  sdOutlineBtnText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  sdFindingBox: { alignItems: 'center', paddingVertical: 6 },
  sdFindingIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF4EC', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  sdFindingTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  sdFindingSub: { fontSize: 12, color: '#6B7280', textAlign: 'center', marginTop: 4, lineHeight: 17 },

  sdPayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  sdPayLabel: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  sdPayValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sdPayValue: { fontSize: 13, color: '#111827', fontWeight: '800' },
  sdPayDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 10 },
  sdTotalBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: ORANGE, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginTop: 16,
  },
  sdTotalLabel: { fontSize: 13, fontWeight: '700', color: '#FFE4D2' },
  sdTotalValue: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5 },

  sdCancelBtn: {
    flex: 1, paddingVertical: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#EF4444',
  },
  sdCancelBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  sdItemsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F9FAFB',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#F1F1F1',
  },
  sdItemsChipText: { fontSize: 11, fontWeight: '700', color: '#6B7280' },

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

  headerSpacer: { width: 36, height: 36 },
  itemsValueRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  reviewLink: { fontSize: 9, fontWeight: '800', color: ORANGE, marginTop: 2 },
  mapTapHint: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(17,24,39,0.75)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  mapTapHintText: { fontSize: 10, fontWeight: '700', color: '#FFFFFF' },

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

  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  bottomSheetCard: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 28, alignItems: 'center',
  },
  sheetGrabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 12 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  itemIndex: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FFE4D2' },
  itemIndexText: { fontSize: 11, fontWeight: '800', color: ORANGE },
  itemName: { fontSize: 13, fontWeight: '800', color: '#111827' },
  itemMeta: { fontSize: 10, color: '#6B7280', marginTop: 2, fontWeight: '600' },
  itemNotes: { fontSize: 10, color: '#9CA3AF', marginTop: 3 },
  cargoSummaryBox: { backgroundColor: '#F9FAFB', borderRadius: 14, borderWidth: 1, borderColor: '#F3F4F6', padding: 12, marginBottom: 6 },
  cargoHeroPhoto: { width: '100%', height: 170, borderRadius: 12, backgroundColor: '#F3F4F6', marginBottom: 10 },
  cargoDescText: { fontSize: 13, fontWeight: '700', color: '#111827', lineHeight: 18 },
  fragileTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8,
  },
  fragileTagText: { fontSize: 10, fontWeight: '700', color: '#EF4444' },
  photoStrip: { gap: 8, paddingTop: 8 },
  itemPhoto: { width: 96, height: 96, borderRadius: 12, backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  itemPhotoFallback: { justifyContent: 'center', alignItems: 'center' },
  noPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  noPhotoText: { fontSize: 10, color: '#9CA3AF', fontWeight: '600' },
  photoPreviewOverlay: {
    ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  photoPreviewImage: { width: '92%', height: '70%' },
  photoPreviewClose: {
    position: 'absolute', top: 50, right: 20, width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
  },
  itemQtyBadge: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  itemQtyText: { fontSize: 12, fontWeight: '800', color: '#111827' },

  mapInfoSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 14,
  },
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

  itemsSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 24, maxHeight: '88%',
  },
  itemsSheetHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  itemsSheetTitle: { fontSize: 18, fontWeight: '900', color: '#111827', letterSpacing: -0.3 },
  itemsSheetSub: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginTop: 2 },
  itemsCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  itemCard: {
    backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#E5E7EB',
    padding: 12, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  itemCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  itemNumberPill: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  itemNumberText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.8 },
  itemChipsRow: { flexDirection: 'row', gap: 6 },
  itemChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  itemChipText: { fontSize: 10, fontWeight: '800' },
  itemPhotoWrap: { borderRadius: 14, overflow: 'hidden', marginBottom: 10 },
  itemPhotoLarge: { width: '100%', height: 190, backgroundColor: '#F3F4F6' },
  enlargeHint: {
    position: 'absolute', right: 8, bottom: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(17,24,39,0.7)', justifyContent: 'center', alignItems: 'center',
  },
  itemPhotoFailed: {
    height: 110, borderRadius: 14, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    justifyContent: 'center', alignItems: 'center', gap: 4, marginBottom: 10,
  },
  itemNoPhoto: {
    height: 64, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#E5E7EB',
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 10, backgroundColor: '#FAFAFA',
  },
  itemTitle: { fontSize: 15, fontWeight: '800', color: '#111827', lineHeight: 20 },

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