// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions,
  Alert, ActivityIndicator, TextInput, RefreshControl, Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';

const { width, height } = Dimensions.get('window');

/** Brand */
const ORANGE = '#F27024';

// --- LEAFLET MAP COMPONENT ---
const LeafletMap = ({ pickupLat, pickupLng, dropoffLat, dropoffLng }: any) => {
  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .pickup-marker { background: #0000CC; border: 3px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
          .dropoff-marker { background: #E11D48; border: 3px solid white; border-radius: 50%; width: 14px; height: 14px; box-shadow: 0 2px 5px rgba(0,0,0,0.3); }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([${pickupLat}, ${pickupLng}], 14);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var pickupIcon = L.divIcon({ className: 'pickup-marker', iconSize: [14, 14], iconAnchor: [7, 7] });
          var dropoffIcon = L.divIcon({ className: 'dropoff-marker', iconSize: [14, 14], iconAnchor: [7, 7] });

          L.marker([${pickupLat}, ${pickupLng}], { icon: pickupIcon }).addTo(map);
          L.marker([${dropoffLat}, ${dropoffLng}], { icon: dropoffIcon }).addTo(map);

          L.polyline([
            [${pickupLat}, ${pickupLng}],
            [${dropoffLat}, ${dropoffLng}]
          ], { color: '#0000CC', weight: 4, dashArray: '10, 10' }).addTo(map);

          map.fitBounds([
            [${pickupLat}, ${pickupLng}],
            [${dropoffLat}, ${dropoffLng}]
          ], { padding: [40, 40] });
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    />
  );
};

// Types
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
  cargo_profiles: any;
  pickup_location: any;
  dropoff_location: any;
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

interface MappedDelivery {
  request_id: number;
  pickup_type: string;
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
}

export default function ActivityScreen() {
  const navigation = useNavigation<any>();
  const [deliveries, setDeliveries] = useState<MappedDelivery[]>([]);
  const [selectedDelivery, setSelectedDelivery] = useState<MappedDelivery | null>(null);
  const [showFullMap, setShowFullMap] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'active' | 'completed'>('all');
  const insets = useSafeAreaInsets();

  // Animations
  const listAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animations                                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!selectedDelivery) {
      listAnim.setValue(0);
      Animated.timing(listAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      detailAnim.setValue(0);
      Animated.timing(detailAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [selectedDelivery, listAnim, detailAnim]);

  /* ------------------------------------------------------------------ */
  /* Data fetching                                                       */
  /* ------------------------------------------------------------------ */
  const fetchUserRecord = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      return userRecord?.user_id || null;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  };

  const fetchProviderDetails = async (providerId: number) => {
    try {
      const { data } = await supabase.from('users').select('user_id, first_name, last_name, email').eq('user_id', providerId).single();
      return data;
    } catch (error) {
      return null;
    }
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
        .select(`*, cargo_profiles (*), pickup_location:locations!delivery_requests_pickup_location_id_fkey (*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (*)`)
        .eq('sender_id', currentUserId)
        .order('created_at', { ascending: false });

      if (requestsError) throw requestsError;

      const requestIds = requests?.map((r: any) => r.request_id) || [];
      let deliveriesData: Delivery[] = [];

      if (requestIds.length > 0) {
        const { data: deliveries } = await supabase.from('deliveries').select('*').in('request_id', requestIds).order('accepted_at', { ascending: false });
        deliveriesData = deliveries || [];
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
        } else if (status === 'Completed') {
          statusDisplay = 'Completed';
        }

        return {
          request_id: item.request_id,
          pickup_type: item.pickup_type,
          date: scheduleDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          time: scheduleDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          pickup_main: pickup.main,
          pickup_sub: pickup.sub,
          dropoff_main: dropoff.main,
          dropoff_sub: dropoff.sub,
          status: statusDisplay,
          status_time: delivery?.accepted_at ? new Date(delivery.accepted_at).toLocaleString() : 'Recently updated',
          provider_name: delivery ? 'Provider Assigned' : 'Assigning...',
          provider_id: delivery?.provider_id,
          price: item.estimated_cost?.toFixed(2) || '0.00',
          coords: {
            pickup: { latitude: item.pickup_location?.latitude || 10.3157, longitude: item.pickup_location?.longitude || 123.8854 },
            dropoff: { latitude: item.dropoff_location?.latitude || 10.3157, longitude: item.dropoff_location?.longitude || 123.8854 }
          },
          rawData: item,
          deliveryData: delivery,
          isMatched: !!delivery
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
      console.error('Error fetching data:', error);
      setDeliveries([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (selectedDelivery) {
      const updatedMatch = deliveries.find(d => d.request_id === selectedDelivery.request_id);
      if (updatedMatch && updatedMatch.status !== selectedDelivery.status) {
        setSelectedDelivery(updatedMatch);
      }
    }
  }, [deliveries]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase.channel(`activity-updates-${userId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `sender_id=eq.${userId}` }, () => { fetchData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => { fetchData(); })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useFocusEffect(useCallback(() => { fetchData(); }, [userId]));

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
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
        text: 'Yes, Cancel it', style: 'destructive', onPress: async () => {
          try {
            await supabase.from('escrow_payments').delete().eq('delivery_id', rawData.request_id);
            await supabase.from('deliveries').delete().eq('request_id', rawData.request_id);
            await supabase.from('delivery_requests').delete().eq('request_id', rawData.request_id);
            setSelectedDelivery(null);
            fetchData();
          } catch (error: any) { Alert.alert('Delete Failed', 'Could not delete delivery.'); }
        }
      }
    ]);
  };

  const filteredDeliveries = deliveries.filter((item) => {
    if (activeTab === 'pending' && item.status !== 'Waiting for Provider') return false;
    if (activeTab === 'active' && item.status !== 'In Progress' && item.status !== 'Matched') return false;
    if (activeTab === 'completed' && item.status !== 'Completed') return false;
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (item.pickup_main + " " + item.pickup_sub).toLowerCase().includes(query) ||
      (item.dropoff_main + " " + item.dropoff_sub).toLowerCase().includes(query) ||
      String(item.request_id).toLowerCase().includes(query) ||
      String(item.provider_name).toLowerCase().includes(query);
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return '#F59E0B';
      case 'Matched': return '#3B82F6';
      case 'In Progress': return '#8B5CF6';
      case 'Completed': return '#22C55E';
      default: return '#6B7280';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'Waiting for Provider': return '#FEF3C7';
      case 'Matched': return '#DBEAFE';
      case 'In Progress': return '#EDE9FE';
      case 'Completed': return '#DCFCE7';
      default: return '#F3F4F6';
    }
  };

  const getStatusIcon = (status: string): any => {
    switch (status) {
      case 'Waiting for Provider': return 'time-outline';
      case 'Matched': return 'checkmark-circle-outline';
      case 'In Progress': return 'car-sport-outline';
      case 'Completed': return 'checkmark-done-circle';
      default: return 'ellipse-outline';
    }
  };

  const getTabCount = (tab: string) => {
    if (tab === 'all') return deliveries.length;
    if (tab === 'pending') return deliveries.filter(d => d.status === 'Waiting for Provider').length;
    if (tab === 'active') return deliveries.filter(d => d.status === 'In Progress' || d.status === 'Matched').length;
    if (tab === 'completed') return deliveries.filter(d => d.status === 'Completed').length;
    return 0;
  };

  /* ------------------------------------------------------------------ */
  /* Tab Bar                                                             */
  /* ------------------------------------------------------------------ */
  const renderTabBar = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabBarScroll}
    >
      {(['all', 'pending', 'active', 'completed'] as const).map((tab) => {
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

  /* ------------------------------------------------------------------ */
  /* List View                                                           */
  /* ------------------------------------------------------------------ */
  const renderListView = () => (
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
        {/* Header */}
        <View style={styles.listHeader}>
          <View>
            <Text style={styles.pageTitle}>My Deliveries</Text>
            <Text style={styles.pageSubtitle}>
              {deliveries.length} {deliveries.length === 1 ? 'shipment' : 'shipments'} total
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color="#9CA3AF" />
          <TextInput
            placeholder="Search by location, package, ID..."
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

        {/* Tabs */}
        {renderTabBar()}

        {/* Content */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ORANGE} />
            <Text style={styles.loadingText}>Loading deliveries...</Text>
          </View>
        ) : filteredDeliveries.length === 0 ? (
          <View style={styles.noResultsContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="cube-outline" size={40} color={ORANGE} />
            </View>
            <Text style={styles.noResultsText}>
              {deliveries.length === 0 ? 'No deliveries yet' : 'No deliveries found'}
            </Text>
            <Text style={styles.noResultsSubtext}>
              {deliveries.length === 0
                ? 'Start shipping to see your activity here'
                : searchQuery
                  ? `No results for "${searchQuery}"`
                  : 'Try a different filter'}
            </Text>
          </View>
        ) : (
          filteredDeliveries.map((item, index) => (
            <TouchableOpacity
              key={item.request_id || index}
              style={styles.card}
              onPress={() => setSelectedDelivery(item)}
              activeOpacity={0.9}
            >
              {/* Status accent bar */}
              <View style={[styles.cardAccent, { backgroundColor: getStatusColor(item.status) }]} />

              {/* Header */}
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <View style={[styles.cardTypeBadge, { backgroundColor: getStatusBg(item.status) }]}>
                    <Ionicons name="cube-outline" size={12} color={getStatusColor(item.status)} />
                    <Text style={[styles.cardTypeText, { color: getStatusColor(item.status) }]}>
                      {item.pickup_type}
                    </Text>
                  </View>
                  <Text style={styles.cardId}>#{item.request_id}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: getStatusBg(item.status) }]}>
                  <Ionicons name={getStatusIcon(item.status)} size={12} color={getStatusColor(item.status)} />
                  <Text style={[styles.statusBadgeText, { color: getStatusColor(item.status) }]}>
                    {item.status}
                  </Text>
                </View>
              </View>

              {/* Body */}
              <View style={styles.cardBody}>
                <View style={styles.cardLeftCol}>
                  <Text style={styles.dateTime}>
                    <Text style={styles.bold}>{item.date}</Text>   {item.time}
                  </Text>

                  <View style={styles.timeline}>
                    <View style={styles.timelineItem}>
                      <View style={styles.iconWrapper}>
                        <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
                      </View>
                      <View style={styles.addressWrapper}>
                        <Text style={styles.timelineLabel}>PICKUP</Text>
                        <Text style={styles.addressMain} numberOfLines={1}>{item.pickup_main}</Text>
                        <Text style={styles.addressSub} numberOfLines={2}>{item.pickup_sub}</Text>
                      </View>
                    </View>
                    <View style={styles.connectingLine} />
                    <View style={[styles.timelineItem, { marginTop: 14 }]}>
                      <View style={styles.iconWrapper}>
                        <Ionicons name="location" size={16} color="#E11D48" />
                      </View>
                      <View style={styles.addressWrapper}>
                        <Text style={[styles.timelineLabel, { color: '#E11D48' }]}>DROPOFF</Text>
                        <Text style={styles.addressMain} numberOfLines={1}>{item.dropoff_main}</Text>
                        <Text style={styles.addressSub} numberOfLines={2}>{item.dropoff_sub}</Text>
                      </View>
                    </View>
                  </View>
                </View>

                <View style={styles.cardRightCol}>
                  <View style={[styles.avatarPlaceholder, item.isMatched && styles.avatarMatched]}>
                    <Ionicons name="person" size={24} color="#FFF" />
                    {item.isMatched && (
                      <View style={styles.avatarVerifiedBadge}>
                        <Ionicons name="checkmark" size={9} color="#FFF" />
                      </View>
                    )}
                  </View>
                  <Text style={styles.providerName} numberOfLines={2}>{item.provider_name}</Text>
                  {!item.isMatched && (
                    <View style={styles.matchingIndicator}>
                      <ActivityIndicator size="small" color="#F59E0B" />
                      <Text style={styles.matchingText}>Finding...</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Footer */}
              <View style={styles.divider} />
              <View style={styles.cardFooter}>
                <View style={styles.footerLeft}>
                  <Text style={styles.footerLabel}>Total</Text>
                  <Text style={styles.priceText}>₱{item.price}</Text>
                </View>
                {item.isMatched && (item.status === 'In Progress' || item.status === 'Matched') && (
                  <TouchableOpacity
                    style={styles.trackBtn}
                    onPress={() => setSelectedDelivery(item)}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="navigate-outline" size={14} color="#FFF" />
                    <Text style={styles.trackBtnText}>Track</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
        <View style={styles.bottomSpacer} />
      </Animated.View>
    </ScrollView>
  );

  /* ------------------------------------------------------------------ */
  /* Detail View                                                         */
  /* ------------------------------------------------------------------ */
  const renderDetailView = () => (
    <ScrollView contentContainerStyle={styles.detailContainer} showsVerticalScrollIndicator={false}>
      <Animated.View style={{ opacity: detailAnim }}>
        {/* Header */}
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle}>Delivery Details</Text>
          <TouchableOpacity onPress={() => setShowFullMap(true)} style={styles.fullMapBtn} activeOpacity={0.8}>
            <Ionicons name="expand-outline" size={16} color={ORANGE} />
            <Text style={styles.fullMapBtnText}>Map</Text>
          </TouchableOpacity>
        </View>

        {/* Tracking ID + Status */}
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.trackingLabel}>TRACKING ID</Text>
            <Text style={styles.trackingId}>#PNS-{String(selectedDelivery?.request_id).padStart(4, '0')}</Text>
          </View>
          <View style={[styles.statusBadgeLarge, { backgroundColor: getStatusBg(selectedDelivery?.status || '') }]}>
            <Ionicons
              name={getStatusIcon(selectedDelivery?.status || '')}
              size={14}
              color={getStatusColor(selectedDelivery?.status || '')}
            />
            <Text style={[styles.statusBadgeLargeText, { color: getStatusColor(selectedDelivery?.status || '') }]}>
              {selectedDelivery?.status}
            </Text>
          </View>
        </View>

        {/* Map Card */}
        <TouchableOpacity
          style={styles.detailMapCard}
          activeOpacity={0.9}
          onPress={() => setShowFullMap(true)}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <LeafletMap
              pickupLat={selectedDelivery?.coords.pickup.latitude}
              pickupLng={selectedDelivery?.coords.pickup.longitude}
              dropoffLat={selectedDelivery?.coords.dropoff.latitude}
              dropoffLng={selectedDelivery?.coords.dropoff.longitude}
            />
          </View>
          <View style={styles.mapOverlayPill}>
            <Ionicons name="bicycle" size={13} color={ORANGE} />
            <Text style={styles.overlayPillText}>
              {selectedDelivery?.status === 'Completed'
                ? 'Delivered'
                : selectedDelivery?.isMatched
                  ? 'In Transit'
                  : 'Awaiting Match'}
            </Text>
          </View>
          <View style={styles.mapExpandPill}>
            <Ionicons name="expand-outline" size={13} color="#FFF" />
          </View>
        </TouchableOpacity>

        {/* Route Card */}
        <View style={styles.routeCard}>
          <View style={styles.routeTimeline}>
            <View style={styles.routeItem}>
              <View style={styles.routeIconWrapper}>
                <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
                <View style={styles.routeLine} />
              </View>
              <View style={styles.routeTextWrapper}>
                <Text style={[styles.routeLabel, { color: '#0000CC' }]}>PICKUP</Text>
                <Text style={styles.routeMain}>{selectedDelivery?.pickup_main}</Text>
                <Text style={styles.routeSub} numberOfLines={2}>{selectedDelivery?.pickup_sub}</Text>
              </View>
            </View>
            <View style={styles.routeItem}>
              <View style={styles.routeIconWrapper}>
                <Ionicons name="location" size={18} color="#E11D48" />
              </View>
              <View style={styles.routeTextWrapper}>
                <Text style={[styles.routeLabel, { color: '#E11D48' }]}>DROPOFF</Text>
                <Text style={styles.routeMain}>{selectedDelivery?.dropoff_main}</Text>
                <Text style={styles.routeSub} numberOfLines={2}>{selectedDelivery?.dropoff_sub}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Package Status */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>Package Status</Text>
        </View>

        <View style={styles.statusTimeline}>
          <View style={styles.statusStep}>
            <View style={styles.statusIconContainer}>
              <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
              <View style={[styles.statusLine, { backgroundColor: '#22C55E' }]} />
            </View>
            <View style={styles.statusTextContainer}>
              <Text style={styles.statusStepTitle}>Order Confirmed</Text>
              <Text style={styles.statusStepTime}>{selectedDelivery?.date}</Text>
            </View>
          </View>

          <View style={styles.statusStep}>
            <View style={styles.statusIconContainer}>
              <View style={[styles.statusDotLarge, { backgroundColor: selectedDelivery?.isMatched ? '#3B82F6' : '#F59E0B' }]} />
              <View style={[styles.statusLine, selectedDelivery?.isMatched && { backgroundColor: '#3B82F6' }]} />
            </View>
            <View style={styles.statusTextContainer}>
              <Text style={[styles.statusStepTitle, !selectedDelivery?.isMatched && { color: '#6B7280' }]}>
                {selectedDelivery?.isMatched ? 'Provider Matched' : 'Finding Provider'}
              </Text>
              <Text style={styles.statusStepTime}>
                {selectedDelivery?.isMatched ? 'Provider assigned' : 'Searching...'}
              </Text>
            </View>
          </View>

          <View style={styles.statusStep}>
            <View style={styles.statusIconContainer}>
              <View style={[
                styles.statusDotLarge,
                (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed')
                  ? { backgroundColor: '#8B5CF6' }
                  : { backgroundColor: '#D1D5DB' }
              ]} />
              <View style={[
                styles.statusLine,
                (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') && { backgroundColor: '#8B5CF6' }
              ]} />
            </View>
            <View style={styles.statusTextContainer}>
              <Text style={[
                styles.statusStepTitle,
                (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed')
                  ? { color: '#111827' }
                  : { color: '#9CA3AF' }
              ]}>
                Item Collected
              </Text>
              <Text style={[
                styles.statusStepTime,
                (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed')
                  ? { color: '#6B7280' }
                  : { color: '#D1D5DB' }
              ]}>
                {(selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed')
                  ? 'In transit'
                  : 'Pending pickup'}
              </Text>
            </View>
          </View>

          <View style={styles.statusStep}>
            <View style={styles.statusIconContainer}>
              <View style={[
                styles.statusDotLarge,
                selectedDelivery?.status === 'Completed'
                  ? { backgroundColor: '#22C55E' }
                  : { backgroundColor: '#D1D5DB' }
              ]} />
            </View>
            <View style={styles.statusTextContainer}>
              <Text style={[
                styles.statusStepTitle,
                selectedDelivery?.status === 'Completed'
                  ? { color: '#111827' }
                  : { color: '#9CA3AF' }
              ]}>
                Delivered Successfully
              </Text>
              <Text style={[
                styles.statusStepTime,
                selectedDelivery?.status === 'Completed'
                  ? { color: '#6B7280' }
                  : { color: '#D1D5DB' }
              ]}>
                {selectedDelivery?.status === 'Completed' ? 'Completed' : 'Awaiting delivery'}
              </Text>
            </View>
          </View>
        </View>

        {/* Provider Info */}
        {selectedDelivery?.isMatched && (
          <View style={styles.providerInfoCard}>
            <View style={styles.providerInfoHeader}>
              <Ionicons name="shield-checkmark" size={14} color="#10B981" />
              <Text style={styles.providerInfoTitle}>ASSIGNED PROVIDER</Text>
            </View>
            <View style={styles.providerInfoRow}>
              <View style={styles.providerAvatarSmall}>
                <Ionicons name="person" size={22} color="#FFF" />
              </View>
              <View style={styles.providerInfoDetails}>
                <Text style={styles.providerInfoName}>{selectedDelivery.provider_name}</Text>
                <Text style={styles.providerInfoVehicle}>
                  {selectedDelivery.deliveryData?.vehicle?.vehicle_type || 'Vehicle'} • {selectedDelivery.deliveryData?.vehicle?.plate_number || 'N/A'}
                </Text>
              </View>
              <TouchableOpacity style={styles.providerContactBtn} activeOpacity={0.8}>
                <Ionicons name="chatbubble-outline" size={16} color={ORANGE} />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Actions */}
        {selectedDelivery?.status !== 'Completed' && (
          <View style={styles.detailActionsRow}>
            {!selectedDelivery?.isMatched && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => handleEdit(selectedDelivery?.rawData)}
                activeOpacity={0.9}
              >
                <Ionicons name="create-outline" size={16} color="#FFF" />
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(selectedDelivery?.rawData)}
              activeOpacity={0.9}
            >
              <Ionicons name="close-circle-outline" size={16} color="#FFF" />
              <Text style={styles.deleteBtnText}>Cancel Booking</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </ScrollView>
  );

  /* ------------------------------------------------------------------ */
  /* Full Map View                                                       */
  /* ------------------------------------------------------------------ */
  const renderFullMapView = () => {
    return (
      <View style={styles.fullMapContainer}>
        <LeafletMap
          pickupLat={selectedDelivery?.coords.pickup.latitude}
          pickupLng={selectedDelivery?.coords.pickup.longitude}
          dropoffLat={selectedDelivery?.coords.dropoff.latitude}
          dropoffLng={selectedDelivery?.coords.dropoff.longitude}
        />
        <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
          <TouchableOpacity style={styles.backCircleBtn} onPress={() => setShowFullMap(false)} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <View style={[styles.statusDotSmall, { backgroundColor: getStatusColor(selectedDelivery?.status || '') }]} />
            <Text style={styles.statusPillText}>{selectedDelivery?.status}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={showFullMap ? [] : ['top']}>
      {showFullMap && selectedDelivery ? renderFullMapView() : selectedDelivery ? renderDetailView() : renderListView()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },

  /* ------------------------------------------------------------------ */
  /* Shared                                                              */
  /* ------------------------------------------------------------------ */
  blueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center' },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  statusDotSmall: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },

  /* ------------------------------------------------------------------ */
  /* List Header                                                         */
  /* ------------------------------------------------------------------ */
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 4,
  },

  /* ------------------------------------------------------------------ */
  /* Search                                                              */
  /* ------------------------------------------------------------------ */
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827', padding: 0 },

  /* ------------------------------------------------------------------ */
  /* Tab Bar                                                             */
  /* ------------------------------------------------------------------ */
  tabBarScroll: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 16,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  tabItemActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  tabText: { fontSize: 13, fontWeight: '700', color: '#6B7280' },
  tabTextActive: { color: '#FFFFFF' },
  tabCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabCountBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabCountText: { fontSize: 10, fontWeight: '800', color: '#6B7280' },
  tabCountTextActive: { color: '#FFFFFF' },

  /* ------------------------------------------------------------------ */
  /* List                                                                */
  /* ------------------------------------------------------------------ */
  listContainer: { paddingHorizontal: 20, paddingBottom: 30, paddingTop: 20 },
  bottomSpacer: { height: 80 },

  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  loadingText: { fontSize: 13, color: '#6B7280', marginTop: 12, fontWeight: '500' },

  noResultsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  noResultsText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
    textAlign: 'center',
  },
  noResultsSubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ------------------------------------------------------------------ */
  /* Card                                                                */
  /* ------------------------------------------------------------------ */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    paddingLeft: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    overflow: 'hidden',
    position: 'relative',
  },
  cardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTypeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  cardTypeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  cardId: { fontSize: 12, fontWeight: '700', color: '#6B7280', letterSpacing: 0.3 },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },

  cardBody: { flexDirection: 'row', justifyContent: 'space-between' },
  cardLeftCol: { flex: 1, paddingRight: 10 },
  dateTime: { fontSize: 13, color: '#111827', marginBottom: 14 },
  bold: { fontWeight: '800' },

  timeline: { position: 'relative' },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start' },
  iconWrapper: { width: 20, alignItems: 'center', marginRight: 10, marginTop: 2 },
  connectingLine: { position: 'absolute', left: 9, top: 18, width: 1, height: 26, backgroundColor: '#E5E7EB' },
  timelineLabel: { fontSize: 9, fontWeight: '800', color: '#0000CC', letterSpacing: 1, marginBottom: 3 },
  addressWrapper: { flex: 1 },
  addressMain: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 2 },
  addressSub: { fontSize: 10, color: '#6B7280', lineHeight: 14 },

  cardRightCol: { width: 92, alignItems: 'center' },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#FFFBEB',
    position: 'relative',
  },
  avatarMatched: { backgroundColor: '#22C55E', borderColor: '#DCFCE7' },
  avatarVerifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  providerName: { fontSize: 10, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 8, lineHeight: 13 },
  matchingIndicator: { alignItems: 'center', gap: 4 },
  matchingText: { fontSize: 9, color: '#F59E0B', fontWeight: '600' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginTop: 14, marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  footerLabel: { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  priceText: { fontSize: 17, fontWeight: '800', color: '#111827' },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  trackBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12, letterSpacing: 0.2 },

  /* ------------------------------------------------------------------ */
  /* Detail                                                              */
  /* ------------------------------------------------------------------ */
  detailContainer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  detailHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  fullMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  fullMapBtnText: { fontSize: 12, color: ORANGE, fontWeight: '700' },

  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  trackingLabel: { fontSize: 9, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1.2, marginBottom: 4 },
  trackingId: { fontSize: 20, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  statusBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    gap: 6,
  },
  statusBadgeLargeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },

  detailMapCard: {
    width: '100%',
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  mapOverlayPill: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FFE4D2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  overlayPillText: { fontSize: 11, fontWeight: '700', color: '#111827' },
  mapExpandPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(17,24,39,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  routeTimeline: { gap: 4 },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start' },
  routeIconWrapper: { width: 22, alignItems: 'center', marginRight: 12, marginTop: 2 },
  routeLine: { width: 1, height: 34, backgroundColor: '#E5E7EB', marginVertical: 2 },
  routeTextWrapper: { flex: 1, paddingBottom: 14 },
  routeLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 1, marginBottom: 3 },
  routeMain: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 2 },
  routeSub: { fontSize: 11, color: '#6B7280', lineHeight: 15 },

  sectionHeaderRow: { marginBottom: 18 },
  sectionHeaderTitle: { fontSize: 17, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },

  statusTimeline: { paddingLeft: 2, marginBottom: 20 },
  statusStep: { flexDirection: 'row' },
  statusIconContainer: { width: 28, alignItems: 'center', marginRight: 14 },
  statusDotLarge: { width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, elevation: 1 },
  statusLine: { width: 2, height: 34, backgroundColor: '#E5E7EB', marginVertical: 3, borderRadius: 1 },
  statusTextContainer: { flex: 1, paddingBottom: 22 },
  statusStepTitle: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 3 },
  statusStepTime: { fontSize: 11, color: '#6B7280', fontWeight: '500' },

  providerInfoCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  providerInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  providerInfoTitle: { fontSize: 10, fontWeight: '800', color: '#10B981', letterSpacing: 1 },
  providerInfoRow: { flexDirection: 'row', alignItems: 'center' },
  providerAvatarSmall: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  providerInfoDetails: { flex: 1 },
  providerInfoName: { fontSize: 14, fontWeight: '800', color: '#111827' },
  providerInfoVehicle: { fontSize: 11, color: '#6B7280', marginTop: 3, fontWeight: '500' },
  providerContactBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FFE4D2',
  },

  detailActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 22,
  },
  editBtn: {
    backgroundColor: ORANGE,
    paddingVertical: 14,
    borderRadius: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  deleteBtn: {
    backgroundColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: 6,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  deleteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  /* ------------------------------------------------------------------ */
  /* Full Map                                                            */
  /* ------------------------------------------------------------------ */
  fullMapContainer: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backCircleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
  },
  statusPillText: { fontSize: 12, fontWeight: '700', color: '#111827' },
});