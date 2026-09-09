// src/modules/Dashboard/Sender/ActivityScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Dimensions, 
  Alert, ActivityIndicator, TextInput, Modal, Image, RefreshControl 
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';

const { width, height } = Dimensions.get('window');

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
    const reqSub = supabase.channel('activity-req-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `sender_id=eq.${userId}` }, () => { fetchData(); }).subscribe();
    const delSub = supabase.channel('activity-del-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => { fetchData(); }).subscribe();
    return () => { supabase.removeChannel(reqSub); supabase.removeChannel(delSub); };
  }, [userId]);

  useFocusEffect(useCallback(() => { fetchData(); }, [userId]));

  const handleEdit = (rawData: any) => {
    if (!rawData) return;
    setSelectedDelivery(null);
    navigation.navigate('ScheduleDelivery', { editData: rawData, mode: rawData.scheduled_time ? 'schedule' : 'sendNow' });
  };

  const handleDelete = (rawData: any) => {
    if (!rawData) return;
    Alert.alert('Cancel Delivery', 'Are you sure you want to cancel and delete this delivery?', [
      { text: 'Keep Delivery', style: 'cancel' },
      { text: 'Yes, Cancel it', style: 'destructive', onPress: async () => {
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

  const renderTabBar = () => (
    <View style={styles.tabBar}>
      {['all', 'pending', 'active', 'completed'].map((tab) => (
        <TouchableOpacity key={tab} style={[styles.tabItem, activeTab === tab && styles.tabItemActive]} onPress={() => setActiveTab(tab as any)}>
          <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
          {activeTab === tab && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderListView = () => (
    <ScrollView contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}>
      <Text style={styles.pageTitle}>Active Delivery</Text>
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={20} color="#9CA3AF" style={{ marginRight: 8 }} />
        <TextInput placeholder="Search by location, package, ID..." placeholderTextColor="#9CA3AF" style={styles.searchInput} value={searchQuery} onChangeText={setSearchQuery} clearButtonMode="while-editing" />
      </View>
      {renderTabBar()}

      {isLoading ? (
        <ActivityIndicator size="large" color="#F27024" style={{ marginTop: 50 }} />
      ) : filteredDeliveries.length === 0 ? (
        <View style={styles.noResultsContainer}>
          <Ionicons name="inbox-outline" size={60} color="#D1D5DB" />
          <Text style={styles.noResultsText}>{deliveries.length === 0 ? "You have no deliveries yet." : "No deliveries found matching"}</Text>
          {searchQuery ? <Text style={styles.noResultsQuery}>"{searchQuery}"</Text> : null}
        </View>
      ) : (
        filteredDeliveries.map((item, index) => (
          <TouchableOpacity key={item.request_id || index} style={styles.card} onPress={() => setSelectedDelivery(item)} activeOpacity={0.9}>
            <View style={styles.cardTopRow}>
              <View style={styles.cardLeftCol}>
                <Text style={styles.dropType}>{item.pickup_type}</Text>
                <Text style={styles.dateTime}><Text style={styles.bold}>{item.date}</Text>   {item.time}</Text>

                <View style={styles.timeline}>
                  <View style={styles.timelineItem}>
                    <View style={styles.iconWrapper}><View style={styles.blueDot}><View style={styles.blueDotInner} /></View></View>
                    <View style={styles.addressWrapper}><Text style={styles.addressMain}>{item.pickup_main}</Text><Text style={styles.addressSub} numberOfLines={2}>{item.pickup_sub}</Text></View>
                  </View>
                  <View style={styles.connectingLine} />
                  <View style={[styles.timelineItem, { marginTop: 16 }]}>
                    <View style={styles.iconWrapper}><Ionicons name="location" size={18} color="#E11D48" /></View>
                    <View style={styles.addressWrapper}><Text style={styles.addressMain}>{item.dropoff_main}</Text><Text style={styles.addressSub} numberOfLines={2}>{item.dropoff_sub}</Text></View>
                  </View>
                </View>
              </View>

              <View style={styles.cardRightCol}>
                <View style={[styles.avatarPlaceholder, item.isMatched && styles.avatarMatched]}><Ionicons name="person" size={28} color="#FFF" /></View>
                <Text style={styles.providerName} numberOfLines={1}>{item.provider_name}</Text>
                {!item.isMatched && <View style={styles.matchingIndicator}><ActivityIndicator size="small" color="#F59E0B" /></View>}
              </View>
            </View>

            <View style={styles.divider} />
            <View style={styles.cardBottomRow}>
              <View style={styles.statusWrapper}>
                <View style={[styles.statusDot, { backgroundColor: getStatusColor(item.status) }]} />
                <View><Text style={styles.statusText}>{item.status}</Text><Text style={styles.statusTime}>{item.status_time}</Text></View>
              </View>
              <Text style={styles.priceText}>₱{item.price}</Text>
            </View>

            {item.isMatched && (item.status === 'In Progress' || item.status === 'Matched') && (
              <TouchableOpacity style={styles.trackBtn} onPress={() => setSelectedDelivery(item)}>
                <Ionicons name="navigate-outline" size={16} color="#FFF" />
                <Text style={styles.trackBtnText}>Track Delivery</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        ))
      )}
      <View style={styles.bottomSpacer} />
    </ScrollView>
  );

  const renderDetailView = () => (
    <ScrollView contentContainerStyle={styles.detailContainer} showsVerticalScrollIndicator={false}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={() => setSelectedDelivery(null)} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
        <TouchableOpacity onPress={() => setShowFullMap(true)} style={styles.fullMapBtn}>
          <Ionicons name="expand-outline" size={20} color="#6B7280" />
          <Text style={styles.fullMapBtnText}>Full Map</Text>
        </TouchableOpacity>
      </View>
      
      <View style={styles.titleRow}>
        <Text style={styles.pageTitleDetail}>Delivery Details</Text>
        <Text style={styles.trackingId}>#{selectedDelivery?.request_id}</Text>
      </View>

      <TouchableOpacity style={styles.detailMapCard} activeOpacity={0.8} onPress={() => setShowFullMap(true)}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LeafletMap 
            pickupLat={selectedDelivery?.coords.pickup.latitude}
            pickupLng={selectedDelivery?.coords.pickup.longitude}
            dropoffLat={selectedDelivery?.coords.dropoff.latitude}
            dropoffLng={selectedDelivery?.coords.dropoff.longitude}
          />
        </View>
        <View style={styles.mapOverlayPill}>
          <Ionicons name="bicycle" size={14} color="#FA7A25" />
          <Text style={styles.overlayPillText}>{selectedDelivery?.status === 'Completed' ? 'Delivered' : (selectedDelivery?.isMatched ? 'In Transit' : 'Awaiting Match')}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.packageStatusHeader}>
        <Text style={styles.packageStatusTitle}>Package Status</Text>
      </View>

      <View style={styles.statusTimeline}>
        <View style={styles.statusStep}>
          <View style={styles.statusIconContainer}><Ionicons name="checkmark-circle" size={24} color="#22C55E" /><View style={styles.statusLine} /></View>
          <View style={styles.statusTextContainer}><Text style={styles.statusStepTitle}>Order Confirmed</Text><Text style={styles.statusStepTime}>{selectedDelivery?.date}</Text></View>
        </View>

        <View style={styles.statusStep}>
          <View style={styles.statusIconContainer}>
            <View style={[styles.statusDot, { width: 20, height: 20, borderRadius: 10, backgroundColor: selectedDelivery?.isMatched ? '#3B82F6' : '#F59E0B' }]} />
            <View style={[styles.statusLine, selectedDelivery?.isMatched && styles.statusLineActive]} />
          </View>
          <View style={styles.statusTextContainer}>
            <Text style={[styles.statusStepTitle, selectedDelivery?.isMatched && { color: '#000' }]}>{selectedDelivery?.isMatched ? 'Provider Matched' : 'Finding Provider'}</Text>
            <Text style={styles.statusStepTime}>{selectedDelivery?.isMatched ? 'Provider assigned' : 'Searching for provider...'}</Text>
          </View>
        </View>

        <View style={styles.statusStep}>
          <View style={styles.statusIconContainer}>
            <View style={[styles.statusDot, { width: 20, height: 20, borderRadius: 10 }, (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') ? { backgroundColor: '#8B5CF6' } : { backgroundColor: '#D1D5DB' } ]} />
            <View style={[styles.statusLine, (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') && styles.statusLineActive]} />
          </View>
          <View style={styles.statusTextContainer}>
            <Text style={[styles.statusStepTitle, (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') ? { color: '#000' } : { color: '#9CA3AF' } ]}>Item Collected</Text>
            <Text style={[styles.statusStepTime, (selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') ? { color: '#6B7280' } : { color: '#D1D5DB' } ]}>{(selectedDelivery?.status === 'In Progress' || selectedDelivery?.status === 'Completed') ? 'In transit' : 'Pending pickup'}</Text>
          </View>
        </View>

        <View style={styles.statusStep}>
          <View style={styles.statusIconContainer}>
            <View style={[styles.statusDot, { width: 20, height: 20, borderRadius: 10 }, selectedDelivery?.status === 'Completed' ? { backgroundColor: '#22C55E' } : { backgroundColor: '#D1D5DB' } ]} />
          </View>
          <View style={styles.statusTextContainer}>
            <Text style={[styles.statusStepTitle, selectedDelivery?.status === 'Completed' ? { color: '#000' } : { color: '#9CA3AF' } ]}>Delivered Successfully</Text>
            <Text style={[styles.statusStepTime, selectedDelivery?.status === 'Completed' ? { color: '#6B7280' } : { color: '#D1D5DB' } ]}>{selectedDelivery?.status === 'Completed' ? 'Completed' : 'Awaiting delivery'}</Text>
          </View>
        </View>
      </View>

      {selectedDelivery?.isMatched && (
        <View style={styles.providerInfoCard}>
          <Text style={styles.providerInfoTitle}>Provider Details</Text>
          <View style={styles.providerInfoRow}>
            <View style={styles.providerAvatarSmall}><Ionicons name="person" size={24} color="#FFF" /></View>
            <View style={styles.providerInfoDetails}>
              <Text style={styles.providerInfoName}>{selectedDelivery.provider_name}</Text>
              <Text style={styles.providerInfoVehicle}>{selectedDelivery.deliveryData?.vehicle?.vehicle_type || 'Vehicle'} • {selectedDelivery.deliveryData?.vehicle?.plate_number || 'N/A'}</Text>
            </View>
          </View>
        </View>
      )}

      {selectedDelivery?.status !== 'Completed' && (
        <View style={styles.detailActionsRow}>
          {!selectedDelivery?.isMatched && (
            <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(selectedDelivery?.rawData)}>
              <Ionicons name="create-outline" size={16} color="#FFF" />
              <Text style={styles.editBtnText}>Edit Details</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(selectedDelivery?.rawData)}>
            <Ionicons name="close-circle-outline" size={16} color="#FFF" />
            <Text style={styles.deleteBtnText}>Cancel Booking</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );

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
          <TouchableOpacity style={styles.backCircleBtn} onPress={() => setShowFullMap(false)}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
          <View style={styles.statusPill}><View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedDelivery?.status || '') }]} /><Text style={styles.statusPillText}>{selectedDelivery?.status}</Text></View>
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
  blueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center' },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  tabBar: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  tabItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, position: 'relative' },
  tabItemActive: { backgroundColor: '#F27024' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  tabTextActive: { color: '#FFFFFF' },
  tabIndicator: { position: 'absolute', bottom: -1, left: '30%', right: '30%', height: 2, backgroundColor: '#F27024', borderRadius: 1 },
  listContainer: { paddingHorizontal: 16, paddingBottom: 30, paddingTop: 25 },
  pageTitle: { fontSize: 30, fontWeight: '700', color: '#000', marginBottom: 20 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 },
  searchInput: { flex: 1, fontSize: 14, color: '#000' },
  noResultsContainer: { paddingTop: 40, alignItems: 'center' },
  noResultsText: { fontSize: 14, color: '#6B7280', marginTop: 12 },
  noResultsQuery: { fontSize: 16, fontWeight: '600', color: '#111827', marginTop: 8 },
  scheduleBtn: { marginTop: 20, backgroundColor: '#F27024', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 25 },
  scheduleBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 14 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginTop: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardLeftCol: { flex: 1, paddingRight: 10 },
  dropType: { fontSize: 10, color: '#6B7280', marginBottom: 4 },
  dateTime: { fontSize: 13, color: '#000', marginBottom: 16 },
  bold: { fontWeight: '700' },
  timeline: { position: 'relative' },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start' },
  iconWrapper: { width: 20, alignItems: 'center', marginRight: 8, marginTop: 2 },
  connectingLine: { position: 'absolute', left: 9, top: 18, width: 1, height: 28, backgroundColor: '#D1D5DB' },
  addressWrapper: { flex: 1 },
  addressMain: { fontSize: 11, fontWeight: '600', color: '#000', marginBottom: 2 },
  addressSub: { fontSize: 9, color: '#6B7280', lineHeight: 12 },
  cardRightCol: { width: 90, alignItems: 'center' },
  avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#D97706', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  avatarMatched: { backgroundColor: '#22C55E' },
  providerName: { fontSize: 11, fontWeight: '700', color: '#000', textAlign: 'center', marginBottom: 10 },
  actionButtons: { flexDirection: 'row', justifyContent: 'space-between', width: 60 },
  circleBtn: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#000', justifyContent: 'center', alignItems: 'center' },
  matchingIndicator: { marginTop: 4 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginTop: 16, marginBottom: 12 },
  cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusWrapper: { flexDirection: 'row', alignItems: 'center' },
  statusText: { fontSize: 11, fontWeight: '600', color: '#000' },
  statusTime: { fontSize: 9, color: '#6B7280' },
  priceText: { fontSize: 14, fontWeight: '800', color: '#000' },
  trackBtn: { marginTop: 12, backgroundColor: '#F27024', borderRadius: 20, paddingVertical: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  trackBtnText: { color: '#FFFFFF', fontWeight: '600', fontSize: 12, marginLeft: 8 },
  bottomSpacer: { height: 80 },
  detailContainer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10 },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  fullMapBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  fullMapBtnText: { fontSize: 12, color: '#6B7280', marginLeft: 4, fontWeight: '500' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 },
  pageTitleDetail: { fontSize: 22, fontWeight: '700', color: '#000' },
  trackingId: { fontSize: 12, color: '#4B5563', marginBottom: 4 },
  detailMapCard: { width: '100%', height: 200, borderRadius: 16, overflow: 'hidden', marginBottom: 30, borderWidth: 1, borderColor: '#E5E7EB' },
  map: { ...StyleSheet.absoluteFill },
  mapOverlayPill: { position: 'absolute', bottom: 16, left: 16, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 6, flexDirection: 'row', alignItems: 'center' },
  overlayPillText: { fontSize: 9, fontWeight: '600', color: '#000', marginLeft: 6 },
  packageStatusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 },
  packageStatusTitle: { fontSize: 20, fontWeight: '700', color: '#000' },
  viewPackageText: { fontSize: 13, color: '#FA7A25', fontWeight: '600', marginBottom: 2 },
  statusTimeline: { paddingLeft: 4 },
  statusStep: { flexDirection: 'row', marginBottom: 0 },
  statusIconContainer: { width: 30, alignItems: 'center', marginRight: 12 },
  statusLine: { width: 1, height: 30, backgroundColor: '#D1D5DB', marginVertical: 4 },
  statusLineActive: { backgroundColor: '#3B82F6' },
  statusTextContainer: { flex: 1, paddingBottom: 24 },
  statusStepTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 2 },
  statusStepTime: { fontSize: 10, color: '#6B7280' },
  providerInfoCard: { backgroundColor: '#F0FDF4', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#BBF7D0' },
  providerInfoTitle: { fontSize: 13, fontWeight: '700', color: '#065F46', marginBottom: 12 },
  providerInfoRow: { flexDirection: 'row', alignItems: 'center' },
  providerAvatarSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#22C55E', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  providerInfoDetails: { flex: 1 },
  providerInfoName: { fontSize: 14, fontWeight: '600', color: '#000' },
  providerInfoVehicle: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  providerContactButtons: { flexDirection: 'row', gap: 8 },
  providerContactBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#F27024' },
  detailActionsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 30, borderTopWidth: 1, borderTopColor: '#E5E7EB', paddingTop: 24 },
  editBtn: { backgroundColor: '#FA7A25', paddingVertical: 14, borderRadius: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginLeft: 6 },
  deleteBtn: { backgroundColor: '#EF4444', paddingVertical: 14, borderRadius: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  deleteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, marginLeft: 6 },
  fullMapContainer: { flex: 1 },
  topOverlay: { position: 'absolute', left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 },
  backCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  statusPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4 },
  statusPillText: { fontSize: 12, fontWeight: '600', color: '#000', marginLeft: 6 },
});