import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Animated, Image, StatusBar, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { supabase } from '../../../../utils/supabase';
import { deleteDelivery } from './scheduleService';

// ---------- MOCK ACTIVE DELIVERIES (Provider Routes) ----------
const MOCK_ACTIVE = [
  {
    request_id: 1001,
    pickup_type: 'Curb-side',
    delivery_status: 'Accepted',
    scheduled_time: null,
    estimated_cost: 24.00,
    cargo_profiles: {
      cargo_pic: null,
      description: 'Glass flower vase, books',
      small_box_qty: 1,
      medium_box_qty: 0,
      large_box_qty: 0,
      is_fragile: true,
    },
    pickup_location: {
      location_id: 201,
      street_address: 'Landers Superstore, Cebu',
      latitude: 10.3157,
      longitude: 123.8854,
    },
    dropoff_location: {
      location_id: 202,
      street_address: 'Ayala Center Cebu',
      latitude: 10.3178,
      longitude: 123.9050,
    },
    provider: {
      name: 'Jun Joseph Pestaño',
      vehicle: 'Civic RS Turbo',
      plate: 'NDA-024',
      rating: 4.8,
    },
  },
  {
    request_id: 1002,
    pickup_type: 'Door-to-door',
    delivery_status: 'Accepted',
    scheduled_time: null,
    estimated_cost: 36.50,
    cargo_profiles: {
      cargo_pic: null,
      description: 'Office chair, laptop stand',
      small_box_qty: 0,
      medium_box_qty: 1,
      large_box_qty: 0,
      is_fragile: false,
    },
    pickup_location: {
      location_id: 203,
      street_address: 'IT Park, Lahug, Cebu City',
      latitude: 10.3313,
      longitude: 123.9064,
    },
    dropoff_location: {
      location_id: 204,
      street_address: 'SM Seaside City Cebu',
      latitude: 10.2800,
      longitude: 123.8800,
    },
    provider: {
      name: 'Maria Santos',
      vehicle: 'Toyota Vios',
      plate: 'ABC-1234',
      rating: 4.6,
    },
  },
  {
    request_id: 1003,
    pickup_type: 'Curb-side',
    delivery_status: 'Accepted',
    scheduled_time: null,
    estimated_cost: 18.75,
    cargo_profiles: {
      cargo_pic: null,
      description: 'Box of clothes, shoes',
      small_box_qty: 2,
      medium_box_qty: 0,
      large_box_qty: 0,
      is_fragile: false,
    },
    pickup_location: {
      location_id: 205,
      street_address: 'Mactan Airport, Lapu-Lapu City',
      latitude: 10.3091,
      longitude: 123.9798,
    },
    dropoff_location: {
      location_id: 206,
      street_address: 'Basilica del Santo Niño, Cebu City',
      latitude: 10.2943,
      longitude: 123.9016,
    },
    provider: {
      name: 'FastTrack Logistics',
      vehicle: 'Van',
      plate: 'FT-5678',
      rating: 4.9,
    },
  },
];

// ---------- Animated "Looking for provider…" for pending ----------
const PendingPulse = () => {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.pendingBadge}>
      <Animated.Text style={{ color: '#D97706', fontWeight: '600', fontSize: 11, opacity: pulseAnim }}>
        Looking for provider…
      </Animated.Text>
    </View>
  );
};

// ---------- Empty State Component ----------
const EmptyState = ({ status }: { status: string }) => {
  const isActive = status === 'Accepted';
  return (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons 
          name={isActive ? 'car-sport-outline' : 'calendar-outline'} 
          size={48} 
          color="#D1D5DB" 
        />
      </View>
      <Text style={styles.emptyTitle}>
        {isActive ? 'No Active Deliveries' : 'No Scheduled Deliveries'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {isActive 
          ? 'Your active deliveries will appear here once accepted by a provider.'
          : 'Schedule a delivery and it will show up here.'}
      </Text>
      {!isActive && (
        <TouchableOpacity style={styles.emptyActionBtn}>
          <Ionicons name="add-circle-outline" size={20} color="#FFF" />
          <Text style={styles.emptyActionText}>Schedule Delivery</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default function DeliveryListScreen({ route, navigation }: any) {
  const { status } = route.params || {};
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<any>(null);

  // Load data: mock for Accepted, real for Pending
  const fetchDeliveries = async () => {
    if (status === 'Accepted') {
      // Fetch real active deliveries from Supabase
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: userRecord } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();
      if (!userRecord) { setLoading(false); return; }

      const { data } = await supabase
        .from('delivery_requests')
        .select(`
          request_id, pickup_type, delivery_status, scheduled_time, estimated_cost,
          cargo_profiles ( cargo_id, cargo_pic, description, small_box_qty, medium_box_qty, large_box_qty, is_fragile ),
          pickup_location:locations!delivery_requests_pickup_location_id_fkey ( location_id, street_address, latitude, longitude ),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( location_id, street_address, latitude, longitude )
        `)
        .eq('sender_id', userRecord.user_id)
        .eq('delivery_status', 'Accepted')
        .order('created_at', { ascending: false });
      setDeliveries(data || []);
      setLoading(false);
      return;
    }

    // Fetch real scheduled deliveries from Supabase
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: userRecord } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();
    if (!userRecord) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, pickup_type, delivery_status, scheduled_time, estimated_cost,
        cargo_profiles ( cargo_id, cargo_pic, description, small_box_qty, medium_box_qty, large_box_qty, is_fragile ),
        pickup_location:locations!delivery_requests_pickup_location_id_fkey ( location_id, street_address, latitude, longitude ),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( location_id, street_address, latitude, longitude )
      `)
      .eq('sender_id', userRecord.user_id)
      .eq('delivery_status', 'Pending')
      .order('created_at', { ascending: false });
    setDeliveries(data || []);
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', fetchDeliveries);
    return unsubscribe;
  }, []);

  const handleDelete = (item: any) => {
    Alert.alert(
      'Delete Delivery',
      'Are you sure you want to delete this delivery? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            setDeletingId(item.request_id);
            try {
              if (status === 'Pending') {
                await deleteDelivery(
                  item.request_id,
                  item.cargo_profiles.cargo_id,
                  item.pickup_location.location_id,
                  item.dropoff_location.location_id
                );
              } else {
                setDeliveries(prev => prev.filter(d => d.request_id !== item.request_id));
              }
              fetchDeliveries(); // refresh list after delete
            } catch (error: any) {
              Alert.alert('Delete Failed', error.message || 'Could not delete delivery.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleEdit = (item: any) => {
    navigation.navigate('ScheduleDelivery', {
      editData: item,
      mode: item.scheduled_time ? 'schedule' : 'sendNow',
    });
  };

  const handleTrackDelivery = (item: any) => {
    // Navigate to tracking screen
    setSelectedDelivery(item);
    // navigation.navigate('TrackDelivery', { delivery: item });
  };

  const renderItem = ({ item }: any) => {
    const pickup = item.pickup_location;
    const dropoff = item.dropoff_location;
    const cargo = item.cargo_profiles || {};
    const provider = item.provider || null;   // exists only in mock
    const isActive = status === 'Accepted';

    return (
      <View style={styles.card}>
        {/* Status Banner */}
        <View style={[styles.statusBanner, { backgroundColor: isActive ? '#D1FAE5' : '#FEF3C7' }]}>
          <View style={styles.statusBannerContent}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? '#10B981' : '#F59E0B' }]} />
            <Text style={[styles.statusText, { color: isActive ? '#059669' : '#D97706' }]}>
              {isActive ? 'Active Delivery' : 'Awaiting Provider'}
            </Text>
          </View>
          <Text style={styles.deliveryIdBadge}>#{item.request_id}</Text>
        </View>

        {/* Mini Map with route */}
        <MapView
          style={styles.miniMap}
          scrollEnabled={false}
          zoomEnabled={false}
          initialRegion={{
            latitude: pickup.latitude,
            longitude: pickup.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
        >
          <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }}>
            <View style={styles.markerPickup}>
              <Ionicons name="location" size={16} color="#FFF" />
            </View>
          </Marker>
          <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }}>
            <View style={styles.markerDropoff}>
              <Ionicons name="flag" size={14} color="#FFF" />
            </View>
          </Marker>
          <Polyline
            coordinates={[
              { latitude: pickup.latitude, longitude: pickup.longitude },
              { latitude: dropoff.latitude, longitude: dropoff.longitude },
            ]}
            strokeColor="#F27024"
            strokeWidth={3}
          />
        </MapView>

        <View style={styles.cardBody}>
          {/* Pickup Type & Cost */}
          <View style={styles.cardHeaderRow}>
            <View style={styles.pickupTypeChip}>
              <Ionicons 
                name={item.pickup_type === 'Door-to-door' ? 'home-outline' : 'cube-outline'} 
                size={14} 
                color="#F27024" 
              />
              <Text style={styles.pickupTypeText}>{item.pickup_type}</Text>
            </View>
            <Text style={styles.headerCost}>₱{item.estimated_cost.toFixed(2)}</Text>
          </View>

          {/* Route Timeline */}
          <View style={styles.routeTimeline}>
            <View style={styles.routePoint}>
              <View style={styles.routeDotPickup}>
                <View style={styles.routeDotInner} />
              </View>
              <View style={styles.routeContent}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeText} numberOfLines={2}>{pickup.street_address}</Text>
              </View>
            </View>
            
            <View style={styles.routeLineContainer}>
              <View style={styles.routeLine} />
              {isActive && (
                <View style={styles.routeProgress}>
                  <Ionicons name="car-sport-outline" size={14} color="#F27024" />
                </View>
              )}
            </View>

            <View style={styles.routePoint}>
              <View style={styles.routeDotDropoff}>
                <View style={styles.routeDotInner} />
              </View>
              <View style={styles.routeContent}>
                <Text style={styles.routeLabel}>DROPOFF</Text>
                <Text style={styles.routeText} numberOfLines={2}>{dropoff.street_address}</Text>
              </View>
            </View>
          </View>

          {/* Cargo Details */}
          <View style={styles.cargoSection}>
            <Text style={styles.sectionTitle}>Package Details</Text>
            {cargo.cargo_pic ? (
              <Image source={{ uri: cargo.cargo_pic }} style={styles.cargoPhoto} />
            ) : null}
            <Text style={styles.cargoDescription}>{cargo.description || 'No description'}</Text>
            
            <View style={styles.itemSizes}>
              <View style={styles.sizeChip}>
                <Text style={styles.sizeChipText}>Small: {cargo.small_box_qty || 0}</Text>
              </View>
              <View style={styles.sizeChip}>
                <Text style={styles.sizeChipText}>Medium: {cargo.medium_box_qty || 0}</Text>
              </View>
              <View style={styles.sizeChip}>
                <Text style={styles.sizeChipText}>Large: {cargo.large_box_qty || 0}</Text>
              </View>
            </View>

            {cargo.is_fragile && (
              <View style={styles.fragileBadge}>
                <Ionicons name="warning-outline" size={12} color="#EF4444" />
                <Text style={styles.fragileText}>Fragile Items</Text>
              </View>
            )}
          </View>

          {/* Schedule (if any) */}
          {item.scheduled_time && (
            <View style={styles.scheduleSection}>
              <Ionicons name="calendar-outline" size={16} color="#F27024" />
              <Text style={styles.scheduleText}>
                {new Date(item.scheduled_time).toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </Text>
            </View>
          )}

          {/* Provider (active only) */}
          {provider && (
            <View style={styles.providerCard}>
              <View style={styles.providerHeader}>
                <View style={styles.providerAvatarCircle}>
                  <Ionicons name="person" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>{provider.name}</Text>
                  <View style={styles.providerMeta}>
                    <Ionicons name="car-sport-outline" size={12} color="#6B7280" />
                    <Text style={styles.providerMetaText}>{provider.vehicle} · {provider.plate}</Text>
                  </View>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={12} color="#F59E0B" />
                    <Text style={styles.ratingText}>{provider.rating}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.providerActions}>
                <TouchableOpacity style={styles.callBtn}>
                  <Ionicons name="call-outline" size={18} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.messageBtn}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#F27024" />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Track Button (active only) */}
          {isActive && (
            <TouchableOpacity 
              style={styles.trackButton}
              onPress={() => handleTrackDelivery(item)}
            >
              <Ionicons name="navigate-outline" size={18} color="#FFF" />
              <Text style={styles.trackButtonText}>Track Delivery</Text>
            </TouchableOpacity>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(item)}>
              <Ionicons name="create-outline" size={16} color="#FFF" />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.deleteBtn} 
              onPress={() => handleDelete(item)}
              disabled={deletingId === item.request_id}
            >
              {deletingId === item.request_id ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color="#FFF" />
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle="light-content" backgroundColor="#F27024" />
        <View style={styles.headerSection}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerTitle}>
                {status === 'Pending' ? 'Scheduled Deliveries' : 'Active Deliveries'}
              </Text>
              <Text style={styles.headerSubtitle}>Loading your deliveries...</Text>
            </View>
          </View>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#F27024" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#F27024" />
      
      {/* Custom Header */}
      <View style={styles.headerSection}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>
              {status === 'Pending' ? 'Scheduled Deliveries' : 'Active Deliveries'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'} found
            </Text>
          </View>
        </View>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{deliveries.length}</Text>
        </View>
      </View>

      {/* Summary Cards */}
      {deliveries.length > 0 && (
        <View style={styles.summaryContainer}>
          <View style={styles.summaryCard}>
            <Ionicons name="cash-outline" size={20} color="#10B981" />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Total Cost</Text>
              <Text style={styles.summaryValue}>
                ₱{deliveries.reduce((sum: number, d: any) => sum + d.estimated_cost, 0).toFixed(2)}
              </Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="cube-outline" size={20} color="#3B82F6" />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Packages</Text>
              <Text style={styles.summaryValue}>{deliveries.length}</Text>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={deliveries}
        keyExtractor={(item) => item.request_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState status={status} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F9FAFB' 
  },
  center: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  
  // Header
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#F27024',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#FFDDC2',
    marginTop: 2,
  },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headerBadgeText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  
  // Summary Cards
  summaryContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F27024',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  summaryContent: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
    marginBottom: 2,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  
  // List
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  
  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  
  // Status Banner
  statusBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  statusBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deliveryIdBadge: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  
  // Map
  miniMap: { 
    height: 140 
  },
  markerPickup: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    padding: 6,
  },
  markerDropoff: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    padding: 6,
  },
  
  // Card Body
  cardBody: { 
    padding: 16 
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickupTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  pickupTypeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F27024',
    marginLeft: 6,
  },
  headerCost: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F27024',
  },
  
  // Route Timeline
  routeTimeline: {
    marginBottom: 16,
  },
  routePoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  routeDotPickup: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  routeDotDropoff: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  routeDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  routeContent: {
    flex: 1,
  },
  routeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1,
    marginBottom: 2,
  },
  routeText: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
    lineHeight: 18,
  },
  routeLineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 11,
    marginVertical: 4,
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
  },
  routeProgress: {
    marginLeft: -6,
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 2,
  },
  
  // Cargo Section
  cargoSection: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  cargoPhoto: { 
    width: '100%', 
    height: 120, 
    borderRadius: 8, 
    marginBottom: 8, 
    resizeMode: 'cover' 
  },
  cargoDescription: {
    fontSize: 13,
    color: '#374151',
    marginBottom: 8,
    lineHeight: 18,
  },
  itemSizes: { 
    flexDirection: 'row', 
    gap: 8 
  },
  sizeChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sizeChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
  },
  fragileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  fragileText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 11,
    marginLeft: 4,
  },
  
  // Schedule Section
  scheduleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  scheduleText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
    marginLeft: 8,
  },
  
  // Provider Card
  providerCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  providerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  providerAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#CC5500',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: { 
    fontSize: 15, 
    fontWeight: '700', 
    color: '#111827',
    marginBottom: 2,
  },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  providerMetaText: { 
    fontSize: 12, 
    color: '#6B7280', 
    marginLeft: 4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: { 
    fontSize: 12, 
    color: '#6B7280', 
    marginLeft: 4,
    fontWeight: '600',
  },
  providerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  callBtn: {
    backgroundColor: '#F27024',
    borderRadius: 20,
    padding: 8,
    flex: 1,
    alignItems: 'center',
  },
  messageBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 8,
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  
  // Track Button
  trackButton: {
    backgroundColor: '#111827',
    borderRadius: 50,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  trackButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 8,
  },
  
  // Action Buttons
  actions: { 
    flexDirection: 'row', 
    gap: 10,
  },
  editBtn: { 
    backgroundColor: '#F27024', 
    paddingVertical: 10, 
    paddingHorizontal: 16, 
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  editBtnText: { 
    color: '#FFFFFF', 
    fontWeight: '700', 
    fontSize: 13,
    marginLeft: 6,
  },
  deleteBtn: { 
    backgroundColor: '#EF4444', 
    paddingVertical: 10, 
    paddingHorizontal: 16, 
    borderRadius: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  deleteBtnText: { 
    color: '#FFFFFF', 
    fontWeight: '700', 
    fontSize: 13,
    marginLeft: 6,
  },
  
  // Pending Badge
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  
  // Empty State
  emptyStateContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyActionBtn: {
    backgroundColor: '#F27024',
    borderRadius: 50,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    marginLeft: 8,
  },
});