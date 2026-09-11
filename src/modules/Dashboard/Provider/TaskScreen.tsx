// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  ScrollView, 
  TouchableOpacity,
  Platform, 
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  Alert,
  AppState
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { 
  getProviderDeliveries,
  getPendingRequests,
  autoMatchAndCreateDeliveries,
  subscribeToNewRequests,
  subscribeToProviderRoutes,
  subscribeToDeliveryUpdates,
  findMatches
} from '../../../services/matchingService';

// Leaflet Map Component
const LeafletMap = ({ lat, lng, zoom }: { lat: number, lng: number, zoom: number }) => {
  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
          }).setView([${lat}, ${lng}], ${zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);

          var marker = L.circleMarker([${lat}, ${lng}], {
            radius: 8,
            fillColor: "#3B82F6",
            color: "#FFFFFF",
            weight: 2,
            opacity: 1,
            fillOpacity: 1
          }).addTo(map);
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
  scheduled_time: string | null;
  receiver_phone: string;
  total_distance: number;
  estimated_cost: number;
  delivery_status: string;
  emergency_flag: boolean;
  created_at: string;
  sender_id: number;
  cargo_id: number;
  receiver_id: number | null;
  pickup_location_id: number;
  dropoff_location_id: number;
  rate_id: number;
  pickup_location: any;
  dropoff_location: any;
  cargo: any;
  receiver: any;
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
  delivery_requests: DeliveryRequest;
}

export default function TaskScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<Delivery[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<Delivery[]>([]);
  const [pendingRequests, setPendingRequests] = useState<DeliveryRequest[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [isMatching, setIsMatching] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [lastMatchTime, setLastMatchTime] = useState<Date | null>(null);
  
  const subscriptionRef = useRef<any>(null);
  const routeSubscriptionRef = useRef<any>(null);
  const deliverySubscriptionRef = useRef<any>(null);
  const appStateRef = useRef(AppState.currentState);
  const matchingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Get provider ID and user data
  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
        return null;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('auth_id', user.id)
        .single();

      if (userError) throw userError;
      setUserData(userData);

      const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select('role_id, roles!inner (role_name)')
        .eq('user_id', userData.user_id)
        .single();

      if (roleError || userRole?.roles?.role_name !== 'Provider') {
        Alert.alert('Access Denied', 'You need to be a provider to view tasks');
        return null;
      }

      setProviderId(userData.user_id);
      return userData.user_id;
    } catch (error) {
      console.error('Error getting provider data:', error);
      return null;
    }
  };

  // Fetch deliveries for this provider
  const fetchDeliveries = async (pid: number) => {
    try {
      const deliveries = await getProviderDeliveries(pid);
      
      // Separate active and completed
      const active = deliveries.filter((d: any) => !d.completed_at);
      const completed = deliveries.filter((d: any) => d.completed_at);
      
      setActiveDeliveries(active);
      setCompletedDeliveries(completed);
      
      return { active, completed };
    } catch (error) {
      console.error('Error fetching deliveries:', error);
      return { active: [], completed: [] };
    }
  };

  // Fetch pending requests available for this provider
  const fetchPendingRequests = async (pid: number) => {
    try {
      // Get provider's routes to find nearby areas
      const { data: routes, error: routeError } = await supabase
        .from('provider_routes')
        .select('start_location_id, end_location_id')
        .eq('provider_id', pid);

      if (routeError) throw routeError;

      const locationIds = routes ? 
        routes.flatMap((r: any) => [r.start_location_id, r.end_location_id]) : [];

      // Fetch pending delivery requests
      let query = supabase
        .from('delivery_requests')
        .select(`
          *,
          pickup_location:pickup_location_id(*),
          dropoff_location:dropoff_location_id(*),
          cargo:cargo_id(*),
          receiver:receiver_id(*)
        `)
        .eq('delivery_status', 'Pending')
        .order('created_at', { ascending: false })
        .limit(20);

      // If provider has routes, prioritize requests near their routes
      if (locationIds.length > 0) {
        query = query.in('pickup_location_id', locationIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      setPendingRequests(data || []);
      return data || [];
    } catch (error) {
      console.error('Error fetching pending requests:', error);
      setPendingRequests([]);
      return [];
    }
  };

  // Run matching algorithm
  const runMatching = async (showAlert: boolean = false) => {
    if (isMatching || !providerId) return;
    
    try {
      setIsMatching(true);
      const matches = await autoMatchAndCreateDeliveries();
      
      if (matches.length > 0) {
        setMatchCount(prev => prev + matches.length);
        setLastMatchTime(new Date());
        
        if (showAlert) {
          Alert.alert(
            '🎯 New Matches Found!',
            `${matches.length} delivery${matches.length > 1 ? 's' : ''} have been automatically matched to your route.`,
            [{ text: 'Great!', onPress: () => loadData() }]
          );
        }
        await loadData();
      }
    } catch (error) {
      console.error('Error running matching:', error);
    } finally {
      setIsMatching(false);
    }
  };

  // Accept a delivery request manually
  const acceptDelivery = async (requestId: number) => {
    try {
      setLoading(true);

      // Get provider's default vehicle
      const { data: vehicle, error: vehicleError } = await supabase
        .from('vehicles')
        .select('vehicle_id')
        .eq('provider_id', providerId)
        .eq('verification_status', 'Verified')
        .limit(1)
        .single();

      if (vehicleError) {
        Alert.alert('Error', 'No verified vehicle found. Please add a vehicle first.');
        return;
      }

      // Get provider's routes
      const { data: route, error: routeError } = await supabase
        .from('provider_routes')
        .select('route_id')
        .eq('provider_id', providerId)
        .limit(1)
        .single();

      if (routeError) {
        Alert.alert('Error', 'No route found. Please create a route first.');
        return;
      }

      // Create delivery record
      const { data: delivery, error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          request_id: requestId,
          provider_id: providerId,
          vehicle_id: vehicle.vehicle_id,
          route_id: route.route_id,
          accepted_at: new Date().toISOString(),
          estimated_eta: new Date(Date.now() + 3600000).toISOString()
        })
        .select('*')
        .single();

      if (deliveryError) throw deliveryError;

      // Update delivery request status
      const { error: updateError } = await supabase
        .from('delivery_requests')
        .update({ delivery_status: 'Accepted' })
        .eq('request_id', requestId);

      if (updateError) throw updateError;

      // Get the request details for escrow
      const { data: requestData } = await supabase
        .from('delivery_requests')
        .select('estimated_cost, sender_id')
        .eq('request_id', requestId)
        .single();

      // Create escrow payment
      if (requestData) {
        await supabase
          .from('escrow_payments')
          .insert({
            amount: requestData.estimated_cost,
            delivery_id: delivery.delivery_id,
            sender_id: requestData.sender_id,
            provider_id: providerId,
            escrow_status: 'On hold',
            emergency_frozen: false,
            created_at: new Date().toISOString()
          });
      }

      Alert.alert('Success', 'Delivery accepted successfully!');
      await loadData();
    } catch (error) {
      console.error('Error accepting delivery:', error);
      Alert.alert('Error', 'Failed to accept delivery. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Complete a delivery
  const completeDelivery = async (deliveryId: number, requestId: number) => {
    Alert.alert(
      'Complete Delivery',
      'Have you delivered the package?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Complete',
          onPress: async () => {
            try {
              const { error: deliveryError } = await supabase
                .from('deliveries')
                .update({
                  completed_at: new Date().toISOString()
                })
                .eq('delivery_id', deliveryId);

              if (deliveryError) throw deliveryError;

              const { error: requestError } = await supabase
                .from('delivery_requests')
                .update({ delivery_status: 'Completed' })
                .eq('request_id', requestId);

              if (requestError) throw requestError;

              // Update escrow status
              const { error: escrowError } = await supabase
                .from('escrow_payments')
                .update({ escrow_status: 'Completed' })
                .eq('delivery_id', deliveryId);

              if (escrowError) throw escrowError;

              Alert.alert('Success', 'Delivery completed successfully!');
              await loadData();
            } catch (error) {
              console.error('Error completing delivery:', error);
              Alert.alert('Error', 'Failed to complete delivery');
            }
          }
        }
      ]
    );
  };

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await Promise.all([
          fetchDeliveries(pid),
          fetchPendingRequests(pid)
        ]);
        // Auto-run matching in background
        runMatching(false);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Set up real-time subscriptions
  useEffect(() => {
    if (!providerId) return;

    // Store all subscriptions in an array for cleanup
    const subs: any[] = [];

    // Subscribe to new pending requests
    const newRequestSub = subscribeToNewRequests(async (payload) => {
      console.log('New pending request:', payload);
      await runMatching(true);
    });
    subs.push(newRequestSub);

    // Subscribe to provider route changes
    const routeSub = subscribeToProviderRoutes(
      providerId,
      async (payload) => {
        console.log('Route changed:', payload);
        await runMatching(false);
      }
    );
    subs.push(routeSub);

    // Subscribe to new deliveries
    const deliverySub = subscribeToDeliveryUpdates(
      providerId,
      async (payload) => {
        console.log('New delivery assigned:', payload);
        await loadData();
        Alert.alert(
          '📦 New Delivery Assigned!',
          'A new delivery has been assigned to you.',
          [{ text: 'View', onPress: () => loadData() }]
        );
      }
    );
    subs.push(deliverySub);

    // Set up periodic matching every 30 seconds
    matchingIntervalRef.current = setInterval(() => {
      runMatching(false);
    }, 30000);

    // Handle app state changes
    const appStateSubscription = AppState.addEventListener('change', (nextAppState) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        runMatching(false);
      }
      appStateRef.current = nextAppState;
    });

    // Cleanup function
    return () => {
      // Unsubscribe all subscriptions
      subs.forEach(sub => {
        try {
          if (sub && typeof sub.unsubscribe === 'function') {
            sub.unsubscribe();
          }
        } catch (error) {
          console.error('Error unsubscribing:', error);
        }
      });
      
      if (matchingIntervalRef.current) {
        clearInterval(matchingIntervalRef.current);
        matchingIntervalRef.current = null;
      }
      
      appStateSubscription.remove();
    };
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
      return () => {
        // Cleanup on unfocus if needed
      };
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Render task card
  const renderTaskCard = (delivery: any, isActive: boolean) => {
    const request = delivery.delivery_requests;
    if (!request) return null;
    
    const pickup = request.pickup_location;
    const dropoff = request.dropoff_location;
    const cargo = request.cargo;
    const receiver = request.receiver;

    return (
      <View key={delivery.delivery_id} style={styles.taskCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.taskType}>{request.pickup_type || 'Curb-side'}</Text>
            <Text style={styles.taskDateTime}>
              {new Date(request.created_at).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric' 
              })}
              {'  '}
              {new Date(request.created_at).toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit' 
              })}
            </Text>
          </View>
          <View style={[
            styles.statusBadge,
            isActive ? styles.statusActive : styles.statusCompleted
          ]}>
            <Text style={[
              styles.statusText,
              isActive ? styles.statusTextActive : styles.statusTextCompleted
            ]}>
              {isActive ? 'In Progress' : 'Completed'}
            </Text>
          </View>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="radio-button-on" size={18} color="#0000FF" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Pickup</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {pickup?.street_address || 'N/A'}, {pickup?.barangay || ''}
                </Text>
              </View>
            </View>

            <View style={styles.connectingLine} />

            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="location" size={18} color="#D90429" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Dropoff</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {dropoff?.street_address || 'N/A'}, {dropoff?.barangay || ''}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.miniMapWrapper}>
            <LeafletMap 
              lat={pickup?.latitude || 10.3188} 
              lng={pickup?.longitude || 123.9050} 
              zoom={14} 
            />
          </View>
        </View>

        <View style={styles.taskDetails}>
          {cargo && (
            <View style={styles.cargoDetails}>
              <Ionicons name="cube-outline" size={14} color="#6B7280" />
              <Text style={styles.cargoText}>
                {cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}
                {cargo.small_box_qty > 0 && ` • ${cargo.small_box_qty} Small`}
                {cargo.medium_box_qty > 0 && ` • ${cargo.medium_box_qty} Medium`}
                {cargo.large_box_qty > 0 && ` • ${cargo.large_box_qty} Large`}
              </Text>
            </View>
          )}
          {receiver && (
            <View style={styles.receiverDetails}>
              <Ionicons name="person-outline" size={14} color="#6B7280" />
              <Text style={styles.receiverText}>
                {receiver.receiver_name || 'Unknown'} • {receiver.receiver_phone || 'N/A'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.distanceText}>
              {request.total_distance?.toFixed(1) || 'N/A'} km
            </Text>
            {request.emergency_flag && (
              <View style={styles.emergencyBadge}>
                <Ionicons name="alert" size={12} color="#EF4444" />
                <Text style={styles.emergencyText}>Emergency</Text>
              </View>
            )}
          </View>
          <View style={styles.footerRight}>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2) || '0.00'}</Text>
            {isActive ? (
              <TouchableOpacity 
                style={[styles.actionBtn, styles.completeBtn]}
                onPress={() => completeDelivery(delivery.delivery_id, request.request_id)}
              >
                <Text style={styles.actionBtnText}>Complete</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionBtn, styles.viewBtn]}>
                <Text style={styles.viewBtnText}>View</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  // Render pending request card
  const renderPendingRequest = (request: DeliveryRequest) => {
    const pickup = request.pickup_location;
    const dropoff = request.dropoff_location;
    const cargo = request.cargo;

    return (
      <View key={request.request_id} style={[styles.taskCard, styles.pendingCard]}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.taskType}>{request.pickup_type || 'Curb-side'}</Text>
            <Text style={styles.taskDateTime}>
              {new Date(request.created_at).toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric' 
              })}
              {'  '}
              {new Date(request.scheduled_time || request.created_at).toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit' 
              })}
            </Text>
          </View>
          <View style={[styles.statusBadge, styles.statusPending]}>
            <Text style={styles.statusTextPending}>Available</Text>
          </View>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="radio-button-on" size={18} color="#0000FF" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Pickup</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {pickup?.street_address || 'N/A'}, {pickup?.barangay || ''}
                </Text>
              </View>
            </View>

            <View style={styles.connectingLine} />

            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="location" size={18} color="#D90429" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Dropoff</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>
                  {dropoff?.street_address || 'N/A'}, {dropoff?.barangay || ''}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.miniMapWrapper}>
            <LeafletMap 
              lat={pickup?.latitude || 10.3188} 
              lng={pickup?.longitude || 123.9050} 
              zoom={14} 
            />
          </View>
        </View>

        <View style={styles.taskDetails}>
          {cargo && (
            <View style={styles.cargoDetails}>
              <Ionicons name="cube-outline" size={14} color="#6B7280" />
              <Text style={styles.cargoText}>
                {cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.distanceText}>
              {request.total_distance?.toFixed(1) || 'N/A'} km
            </Text>
            {request.emergency_flag && (
              <View style={styles.emergencyBadge}>
                <Ionicons name="alert" size={12} color="#EF4444" />
                <Text style={styles.emergencyText}>Emergency</Text>
              </View>
            )}
          </View>
          <View style={styles.footerRight}>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2) || '0.00'}</Text>
            <TouchableOpacity 
              style={[styles.actionBtn, styles.acceptBtn]}
              onPress={() => acceptDelivery(request.request_id)}
            >
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView 
        style={styles.container} 
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Task</Text>
          <Text style={styles.pageSubtitle}>
            You have {activeDeliveries.length} active tasks
            {matchCount > 0 && ` • ${matchCount} new matches`}
            {lastMatchTime && ` • Last match: ${lastMatchTime.toLocaleTimeString()}`}
          </Text>
        </View>

        {/* Auto-matching status */}
        {isMatching && (
          <View style={styles.matchingStatus}>
            <ActivityIndicator size="small" color="#F27024" />
            <Text style={styles.matchingStatusText}>Looking for matching deliveries...</Text>
          </View>
        )}

        {/* Active Deliveries Section */}
        {activeDeliveries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active ({activeDeliveries.length})</Text>
            {activeDeliveries.map(delivery => renderTaskCard(delivery, true))}
          </View>
        )}

        {/* Pending Requests Section */}
        {pendingRequests.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Available Jobs ({pendingRequests.length})</Text>
            {pendingRequests.map(renderPendingRequest)}
          </View>
        )}

        {/* Completed Deliveries Section */}
        {completedDeliveries.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Completed ({completedDeliveries.length})</Text>
            {completedDeliveries.map(delivery => renderTaskCard(delivery, false))}
          </View>
        )}

        {activeDeliveries.length === 0 && pendingRequests.length === 0 && completedDeliveries.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="briefcase-outline" size={60} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No tasks yet</Text>
            <Text style={styles.emptySubtext}>
              Go online and wait for delivery requests to appear here
            </Text>
            <TouchableOpacity 
              style={styles.matchNowButton}
              onPress={() => runMatching(true)}
              disabled={isMatching}
            >
              <Text style={styles.matchNowButtonText}>
                {isMatching ? 'Searching...' : '🔍 Check for Matches'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  header: {
    marginTop: Platform.OS === 'android' ? 85 : 10,
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 35,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 16,
    color: '#111827',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  pendingCard: {
    borderColor: '#F27024',
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  taskType: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  taskDateTime: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusPending: {
    backgroundColor: '#FEF3C7',
  },
  statusActive: {
    backgroundColor: '#DBEAFE',
  },
  statusCompleted: {
    backgroundColor: '#86EFAC',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextPending: {
    color: '#D97706',
  },
  statusTextActive: {
    color: '#2563EB',
  },
  statusTextCompleted: {
    color: '#166534',
  },
  locationSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  locationDetails: {
    flex: 1,
    marginRight: 12,
    position: 'relative',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 24,
    alignItems: 'center',
    marginRight: 8,
    zIndex: 2,
    backgroundColor: '#FFF',
  },
  connectingLine: {
    position: 'absolute',
    left: 11,
    top: 20,
    bottom: 30,
    width: 1,
    backgroundColor: '#D1D5DB',
    zIndex: 1,
  },
  locationTextWrapper: {
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  locationAddress: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 14,
  },
  miniMapWrapper: {
    width: 90,
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  taskDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 8,
  },
  cargoDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  cargoText: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 4,
  },
  receiverDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  receiverText: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  distanceText: {
    fontSize: 12,
    color: '#6B7280',
  },
  emergencyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  emergencyText: {
    fontSize: 10,
    color: '#EF4444',
    marginLeft: 4,
    fontWeight: '500',
  },
  priceText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  acceptBtn: {
    backgroundColor: '#F27024',
  },
  acceptBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  completeBtn: {
    backgroundColor: '#34C759',
  },
  viewBtn: {
    backgroundColor: '#F3F4F6',
  },
  viewBtnText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '500',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 8,
    textAlign: 'center',
  },
  matchingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    marginBottom: 16,
  },
  matchingStatusText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#D97706',
    fontWeight: '500',
  },
  matchNowButton: {
    backgroundColor: '#F27024',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 16,
  },
  matchNowButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});