// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing, Modal,
  BackHandler, StatusBar, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../../../utils/supabase';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';

const { width } = Dimensions.get('window');
const ORANGE = '#FF751F';

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
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, email').eq('user_id', providerId).single();
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

        const cargoName = item.cargo_profiles?.item_name || item.cargo_profiles?.cargo_type || item.pickup_type || 'Standard Parcel';

        return {
          request_id: item.request_id,
          pickup_type: item.pickup_type,
          cargo_name: cargoName,
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
          if (provider) delivery.provider_name = `${provider.first_name} ${provider.last_name}`;
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

  // Reset view state back to default list when refocusing on the screen & ensure status bar cleanup on blur
  useFocusEffect(
    useCallback(() => {
      setSelectedDelivery(null);
      setShowFullMap(false);
      setActiveTab('all');
      setSearchQuery('');
      fetchData();

      return () => {
        // Clean up status bar styling when leaving this tab so it doesn't leak into HomeScreen
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
      {(['all', 'completed', 'pending', 'active'] as const).map((tab) => {
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
    <View style={{ flex: 1 }}>
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
              const isActiveItem = item.status === 'In Progress' || item.status === 'In Transit' || item.status === 'Matched';
              const isPendingItem = item.status === 'Waiting for Provider';

              return (
                <TouchableOpacity
                  key={item.request_id || index}
                  style={[
                    styles.card,
                    isCompletedItem && styles.completedCard,
                    isActiveItem && styles.activeCardStyle,
                    isPendingItem && styles.pendingCardStyle,
                  ]}
                  onPress={() => setSelectedDelivery(item)}
                  activeOpacity={0.9}
                >
                  {/* Header Row */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <Text style={styles.cardId}>#PNS-{String(item.request_id).padStart(4, '0')}</Text>
                      <View style={styles.serviceTypeBadge}>
                        <Text style={styles.serviceTypeText}>{item.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}</Text>
                      </View>
                    </View>
                    {!isCompletedItem && (
                      <View style={[styles.statusBadge, { backgroundColor: getStatusBg(item.status) }]}>
                        <Ionicons name={getStatusIcon(item.status)} size={11} color={getStatusColor(item.status)} />
                        <Text style={[styles.statusBadgeText, { color: getStatusColor(item.status) }]}>
                          {item.status}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Cargo & Item Info Banner */}
                  <View style={styles.cargoBanner}>
                    <Ionicons name="cube-outline" size={13} color={ORANGE} />
                    <Text style={styles.cargoBannerText} numberOfLines={1}>
                      {item.cargo_name}
                    </Text>
                  </View>

                  {/* Route Summary */}
                  <View style={styles.routeBox}>
                    <View style={styles.routeRow}>
                      <View style={styles.dotOrange} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>
                        {item.pickup_main}
                      </Text>
                    </View>
                    <View style={styles.routeConnectorLine} />
                    <View style={styles.routeRow}>
                      <View style={styles.dotDark} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>
                        {item.dropoff_main}
                      </Text>
                    </View>
                  </View>

                  {/* Informational Context Row */}
                  <View style={styles.cardContextRow}>
                    <View style={styles.contextItem}>
                      <Ionicons name="calendar-outline" size={11} color="#6B7280" />
                      <Text style={styles.contextText}>{item.date} • {item.time}</Text>
                    </View>

                    {item.isMatched && item.provider_name !== 'Finding...' && (
                      <View style={styles.contextItem}>
                        <Ionicons name="person-circle-outline" size={12} color="#16A34A" />
                        <Text style={[styles.contextText, { fontWeight: '700', color: '#16A34A' }]} numberOfLines={1}>
                          {item.provider_name}
                        </Text>
                      </View>
                    )}

                    {item.receiver?.receiver_name && (
                      <View style={styles.contextItem}>
                        <Ionicons name="people-outline" size={11} color="#7C3AED" />
                        <Text style={styles.contextText} numberOfLines={1}>
                          To: {item.receiver.receiver_name}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Footer Info */}
                  <View style={styles.cardFooter}>
                    <View>
                      <Text style={styles.footerLabel}>TOTAL FARE</Text>
                      <Text style={styles.priceText}>₱{item.price}</Text>
                    </View>

                    {isCompletedItem ? (
                      <View style={styles.actionBadgeComplete}>
                        <Ionicons name="checkmark-circle" size={12} color="#166534" />
                        <Text style={styles.actionBadgeCompleteText}>Delivered & Settled</Text>
                      </View>
                    ) : item.isMatched ? (
                      <View style={styles.actionBadgeActive}>
                        <Ionicons name="navigate-outline" size={12} color="#FFFFFF" />
                        <Text style={styles.actionBadgeActiveText}>Track Live</Text>
                      </View>
                    ) : (
                      <View style={styles.actionBadgePending}>
                        <Ionicons name="time-outline" size={12} color="#D97706" />
                        <Text style={styles.actionBadgePendingText}>Finding Provider</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  const renderDetailView = () => {
    const pickupVerified =
      selectedDelivery?.qr?.pickup_verified === true ||
      selectedDelivery?.status === 'In Transit' ||
      selectedDelivery?.status === 'Completed';

    const isCompleted =
      selectedDelivery?.status === 'Completed' ||
      !!selectedDelivery?.deliveryData?.completed_at;

    const showPickupQRButton =
      !!selectedDelivery?.isMatched &&
      !!selectedDelivery?.qr &&
      !selectedDelivery?.qr?.pickup_verified &&
      !isCompleted;

    const hasConfirmation = !!selectedDelivery?.confirmation;
    const otpVerified = selectedDelivery?.confirmation?.otp_verified === true;

    const receiverDisplayName =
      selectedDelivery?.receiver?.receiver_name?.trim() ||
      selectedDelivery?.receiver?.receiver_phone ||
      'Receiver';

    const receiverInitial = (() => {
      const name = selectedDelivery?.receiver?.receiver_name?.trim();
      if (name) return name.charAt(0).toUpperCase();
      const phone = selectedDelivery?.receiver?.receiver_phone;
      if (phone) return phone.replace(/\D/g, '').slice(-2) || 'R';
      return 'R';
    })();

    // Determine stepper stage index (0: Placed, 1: Matched, 2: In Transit, 3: Completed)
    const currentStatus = selectedDelivery?.status || 'Waiting for Provider';
    let stepIndex = 0;
    if (currentStatus === 'Matched') stepIndex = 1;
    else if (currentStatus === 'In Progress' || currentStatus === 'In Transit') stepIndex = 2;
    else if (currentStatus === 'Completed') stepIndex = 3;

    return (
      <ScrollView contentContainerStyle={styles.detailContainer} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: detailAnim }}>
          {/* Header Bar */}
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backCircleBtnDetail} activeOpacity={0.8}>
              <Ionicons name="arrow-back" size={18} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>Shipment Details</Text>
            <TouchableOpacity onPress={() => setShowFullMap(true)} style={styles.fullMapBtn} activeOpacity={0.8}>
              <Ionicons name="map-outline" size={13} color={ORANGE} />
              <Text style={styles.fullMapBtnText}>Map</Text>
            </TouchableOpacity>
          </View>

          {/* Hero Tracking & Status Card */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.heroTrackingLabel}>TRACKING CODE</Text>
                <Text style={styles.heroTrackingId}>#PNS-{String(selectedDelivery?.request_id).padStart(4, '0')}</Text>
              </View>
              <View style={[styles.heroStatusBadge, { backgroundColor: getStatusBg(currentStatus) }]}>
                <Ionicons name={getStatusIcon(currentStatus)} size={13} color={getStatusColor(currentStatus)} />
                <Text style={[styles.heroStatusText, { color: getStatusColor(currentStatus) }]}>{currentStatus}</Text>
              </View>
            </View>

            {/* Stepper Progress Bar */}
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

          {/* Completed Settlement Banner */}
          {isCompleted && (
            <View style={styles.completedReceiptBanner}>
              <View style={styles.completedReceiptHeader}>
                <View style={styles.completedIconCircle}>
                  <Ionicons name="checkmark" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.completedBannerTitle}>Delivered & Settled</Text>
                  <Text style={styles.completedBannerSubtitle}>
                    {selectedDelivery?.deliveryData?.completed_at ? new Date(selectedDelivery.deliveryData.completed_at).toLocaleString() : selectedDelivery?.date}
                  </Text>
                </View>
              </View>
              <View style={styles.completedReceiptDivider} />
              <View style={styles.completedFareRow}>
                <Text style={styles.completedFareLabel}>Total Fare Paid (Escrow Released)</Text>
                <Text style={styles.completedFareValue}>₱{selectedDelivery?.price}</Text>
              </View>
            </View>
          )}

          {/* Package & Fare Summary Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="cube-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>PACKAGE & FARE SUMMARY</Text>
            </View>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Cargo Item</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>{selectedDelivery?.cargo_name}</Text>
              </View>
              <View style={styles.summaryDividerVertical} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Service Type</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>{selectedDelivery?.pickup_type}</Text>
              </View>
              <View style={styles.summaryDividerVertical} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Total Fare</Text>
                <Text style={[styles.summaryValue, { color: ORANGE }]} numberOfLines={1}>₱{selectedDelivery?.price}</Text>
              </View>
            </View>
          </View>

          {/* Pickup QR Action Card */}
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

          {/* Receiver OTP Card */}
          {pickupVerified && !isCompleted && hasConfirmation && (
            <TouchableOpacity style={styles.deliveryOTPCard} onPress={() => setShowDeliveryOTP(true)} activeOpacity={0.9}>
              <View style={styles.deliveryOTPHeader}>
                <View style={styles.deliveryOTPIconBox}>
                  <Ionicons name={otpVerified ? 'shield-checkmark' : 'lock-closed'} size={18} color={otpVerified ? '#16A34A' : '#7C3AED'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deliveryOTPTitle}>{otpVerified ? 'Delivery Confirmed' : 'Receiver OTP Code'}</Text>
                  <Text style={styles.deliveryOTPSubtitle} numberOfLines={1}>
                    {otpVerified ? 'Funds successfully released.' : 'Tap to inspect drop-off confirmation code.'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={otpVerified ? '#16A34A' : '#7C3AED'} />
              </View>
            </TouchableOpacity>
          )}

          {/* Interactive Map Preview Card */}
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
          </TouchableOpacity>

          {/* Route Timeline Card */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="location-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>ROUTE TIMELINE</Text>
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

          {/* Designated Receiver Card */}
          {selectedDelivery?.receiver && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="person-outline" size={15} color="#7C3AED" />
                <Text style={[styles.sectionHeaderTitle, { color: '#7C3AED' }]}>DESIGNATED RECEIVER</Text>
              </View>
              <View style={styles.receiverCardRow}>
                <View style={styles.receiverAvatar}>
                  <Text style={styles.receiverAvatarText}>{receiverInitial}</Text>
                </View>
                <View style={styles.receiverInfo}>
                  <Text style={styles.receiverName} numberOfLines={1}>{receiverDisplayName}</Text>
                  <Text style={styles.receiverPhone}>{selectedDelivery.receiver.receiver_phone || '—'}</Text>
                </View>
              </View>
            </View>
          )}

          {/* Assigned Courier Partner Card */}
          {selectedDelivery?.isMatched && (
            <View style={styles.providerInfoCard}>
              <View style={styles.providerInfoHeader}>
                <Ionicons name="shield-checkmark-outline" size={15} color="#16A34A" />
                <Text style={styles.providerInfoTitle}>ASSIGNED COURIER PARTNER</Text>
              </View>
              <View style={styles.providerInfoRow}>
                <View style={styles.providerInfoDetails}>
                  <Text style={styles.providerInfoName}>{selectedDelivery.provider_name}</Text>
                  <Text style={styles.providerInfoVehicle}>
                    {selectedDelivery.deliveryData?.vehicle?.vehicle_type || 'Vehicle'} • {selectedDelivery.deliveryData?.vehicle?.plate_number || 'N/A'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.providerContactBtn}
                  activeOpacity={0.8}
                  onPress={() => handleMessageProvider(selectedDelivery)}
                  disabled={openingChat}
                >
                  {openingChat ? (
                    <ActivityIndicator size="small" color={ORANGE} />
                  ) : (
                    <Ionicons name="chatbubble-outline" size={16} color={ORANGE} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Bottom Actions Row */}
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

  pageTitle: { fontSize: 30, fontWeight: '800', color: '#111827', letterSpacing: -0.5, marginBottom: 16 },

  searchRow: {
    marginBottom: 4,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827', padding: 0 },

  tabBarScroll: { gap: 6, paddingTop: 14, paddingBottom: 2 },
  tabItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3, elevation: 1,
  },
  tabItemActive: {
    backgroundColor: '#FFF7ED', borderColor: ORANGE,
  },
  tabText: { fontSize: 12, fontWeight: '700', color: '#4B5563' },
  tabTextActive: { color: ORANGE },
  tabCountBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#F3F4F6', paddingHorizontal: 5, justifyContent: 'center', alignItems: 'center' },
  tabCountBadgeActive: { backgroundColor: 'rgba(255, 117, 31, 0.15)' },
  tabCountText: { fontSize: 10, fontWeight: '800', color: '#4B5563' },
  tabCountTextActive: { color: ORANGE },

  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 80 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  loadingText: { fontSize: 12, color: '#6B7280', marginTop: 8, fontWeight: '500' },
  noResultsContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50, paddingHorizontal: 20 },
  emptyIconCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#FFE4D2' },
  noResultsText: { fontSize: 15, fontWeight: '800', color: '#111827' },
  noResultsSubtext: { fontSize: 11, color: '#6B7280', marginTop: 3, textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  completedCard: {
    backgroundColor: '#FAFAF9',
    borderColor: '#D1D5DB',
  },
  activeCardStyle: {
    borderLeftWidth: 4,
    borderLeftColor: '#7C3AED',
  },
  pendingCardStyle: {
    borderLeftWidth: 4,
    borderLeftColor: '#D97706',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  cardId: { fontSize: 11, fontWeight: '800', color: '#111827' },
  serviceTypeBadge: {
    backgroundColor: '#F3F4F6', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
  },
  serviceTypeText: { fontSize: 9, fontWeight: '700', color: '#4B5563' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, gap: 4 },
  statusBadgeText: { fontSize: 9, fontWeight: '800' },

  cargoBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF7ED',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginBottom: 10, gap: 6,
    borderWidth: 1, borderColor: '#FFE4D2',
  },
  cargoBannerText: { fontSize: 11, fontWeight: '700', color: '#9A3412', flex: 1 },

  routeBox: {
    backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, marginBottom: 10,
    borderWidth: 1, borderColor: '#F3F4F6', gap: 6,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeConnectorLine: { width: 1, height: 12, backgroundColor: '#D1D5DB', marginLeft: 3 },
  routeAddressText: { fontSize: 12, fontWeight: '700', color: '#111827', flex: 1 },

  cardContextRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10,
    paddingHorizontal: 2,
  },
  contextItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contextText: { fontSize: 10, color: '#6B7280', fontWeight: '600' },

  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  footerLabel: { fontSize: 8, color: '#9CA3AF', fontWeight: '800', letterSpacing: 0.5 },
  priceText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  actionBadgeActive: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#7C3AED',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, gap: 4,
  },
  actionBadgeActiveText: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  actionBadgeComplete: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  actionBadgeCompleteText: { fontSize: 11, fontWeight: '800', color: '#166534' },
  actionBadgePending: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  actionBadgePendingText: { fontSize: 10, fontWeight: '800', color: '#92400E' },

  detailContainer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  backCircleBtnDetail: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  detailHeaderTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  fullMapBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF7ED',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, gap: 4,
    borderWidth: 1, borderColor: '#FFE4D2',
  },
  fullMapBtnText: { fontSize: 11, color: ORANGE, fontWeight: '800' },

  // Hero Card & Stepper
  heroCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  heroTrackingLabel: { fontSize: 8, fontWeight: '900', color: '#9CA3AF', letterSpacing: 0.8 },
  heroTrackingId: { fontSize: 17, fontWeight: '900', color: '#111827', marginTop: 2 },
  heroStatusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 5 },
  heroStatusText: { fontSize: 11, fontWeight: '800' },

  stepperContainer: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  stepItem: { flex: 1, alignItems: 'center' },
  stepRowIndicator: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
  stepDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  stepDotActive: { backgroundColor: ORANGE },
  stepDotCurrent: { backgroundColor: ORANGE, borderWidth: 3, borderColor: '#FFE4D2' },
  stepInnerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF' },
  stepLine: { position: 'absolute', left: '50%', right: '-50%', height: 2, backgroundColor: '#E5E7EB', zIndex: 1 },
  stepLineActive: { backgroundColor: ORANGE },
  stepLabel: { fontSize: 9, fontWeight: '700', color: '#9CA3AF', marginTop: 6, textAlign: 'center' },
  stepLabelActive: { color: ORANGE, fontWeight: '900' },

  sectionCard: {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionHeaderTitle: { fontSize: 9, fontWeight: '900', color: ORANGE, letterSpacing: 0.8 },
  
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
    flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 6,
  },
  editBtn: {
    backgroundColor: ORANGE, paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flex: 1,
  },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  deleteBtn: {
    backgroundColor: '#EF4444', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flex: 1,
  },
  deleteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

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