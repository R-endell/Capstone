// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import {
  getProviderDeliveries, findMatches,
  subscribeToNewRequests, subscribeToProviderRoutes, subscribeToDeliveryUpdates
} from '../../../services/matchingService';

const ORANGE = '#F27024';

const LeafletMap = ({ lat, lng, zoom }: { lat: number, lng: number, zoom: number }) => {
  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }</style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([${lat}, ${lng}], ${zoom});
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          L.circleMarker([${lat}, ${lng}], { radius: 8, fillColor: "#3B82F6", color: "#FFFFFF", weight: 2, opacity: 1, fillOpacity: 1 }).addTo(map);
        </script>
      </body>
    </html>
  `;
  return (
    <WebView originWhitelist={['*']} source={{ html: mapHtml }} style={{ flex: 1, backgroundColor: 'transparent' }} scrollEnabled={false} />
  );
};

export default function TaskScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [isMatching, setIsMatching] = useState(false);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const matchingPulse = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation                                                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(contentAnim, 180),
    ]).start();
  }, [headerAnim, contentAnim]);

  /* ------------------------------------------------------------------ */
  /* Matching pulse                                                      */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
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
      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.request_id === v.request_id)) === i);
      setActiveDeliveries(uniqueDeliveries.filter((d: any) => !d.completed_at));
      setCompletedDeliveries(uniqueDeliveries.filter((d: any) => d.completed_at));
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

      const { error: reqUpdateError } = await supabase.from('delivery_requests').update({ delivery_status: 'Accepted' }).eq('request_id', requestId);
      if (reqUpdateError) throw reqUpdateError;

      const { data: requestData } = await supabase.from('delivery_requests').select('estimated_cost, sender_id').eq('request_id', requestId).single();
      if (requestData) {
        await supabase.from('escrow_payments').insert({
          amount: requestData.estimated_cost, delivery_id: delivery.delivery_id, sender_id: requestData.sender_id,
          provider_id: providerId, escrow_status: 'On hold', emergency_frozen: false, created_at: new Date().toISOString()
        });
      }
      Alert.alert('Success', 'Delivery accepted successfully!');
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to accept delivery.');
    } finally { setLoading(false); }
  };

  const completeDelivery = async (deliveryId: number, requestId: number) => {
    Alert.alert('Complete Delivery', 'Have you successfully delivered the package to the receiver?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, Complete', onPress: async () => {
          try {
            setLoading(true);
            const { error: delError } = await supabase.from('deliveries').update({ completed_at: new Date().toISOString() }).eq('delivery_id', deliveryId);
            if (delError) throw delError;

            const { error: reqError } = await supabase.from('delivery_requests').update({ delivery_status: 'Completed' }).eq('request_id', requestId);
            if (reqError) throw reqError;

            const { data: escrowData, error: escError } = await supabase.from('escrow_payments').update({ escrow_status: 'Completed' }).eq('delivery_id', deliveryId).select('*').single();

            if (escrowData && escrowData.provider_id) {
              const { data: wallet } = await supabase.from('provider_wallet').select('*').eq('provider_id', escrowData.provider_id).single();
              if (wallet) {
                await supabase.from('provider_wallet').update({ balance: Number(wallet.balance) + Number(escrowData.amount) }).eq('wallet_id', wallet.wallet_id);
              }
            }

            Alert.alert('Success', 'Delivery completed! Payment has been released to your wallet.');
            await loadData();
          } catch (error: any) {
            Alert.alert('Completion Failed', error.message || 'Could not complete the delivery.');
          } finally { setLoading(false); }
        }
      }
    ]);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await fetchDeliveries(pid);
        await runMatching(false);
      }
    } finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  useEffect(() => {
    if (!providerId) return;
    const subs = [
      subscribeToNewRequests(async () => await runMatching(true)),
      subscribeToProviderRoutes(providerId, async () => await runMatching(false)),
      subscribeToDeliveryUpdates(providerId, async () => await loadData())
    ];
    return () => subs.forEach(sub => sub?.unsubscribe?.());
  }, [providerId]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  const pulseOpacity = matchingPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

  /* ------------------------------------------------------------------ */
  /* Render Task Card (Active / Completed)                               */
  /* ------------------------------------------------------------------ */
  const renderTaskCard = (delivery: any, isActive: boolean) => {
    const request = delivery.delivery_requests;
    if (!request) return null;
    const cargo = request.cargo;
    const receiver = request.receiver;

    return (
      <View key={delivery.delivery_id} style={styles.taskCard}>
        <View style={[styles.cardAccent, { backgroundColor: isActive ? '#3B82F6' : '#22C55E' }]} />

        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.typeBadge, { backgroundColor: isActive ? '#DBEAFE' : '#DCFCE7' }]}>
              <Ionicons name="cube-outline" size={12} color={isActive ? '#3B82F6' : '#22C55E'} />
              <Text style={[styles.typeBadgeText, { color: isActive ? '#3B82F6' : '#22C55E' }]}>
                {request.pickup_type || 'Curb-side'}
              </Text>
            </View>
            <Text style={styles.taskId}>#{request.request_id}</Text>
          </View>
          <View style={[styles.statusBadge, isActive ? styles.statusActive : styles.statusCompleted]}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? '#2563EB' : '#166534' }]} />
            <Text style={[styles.statusText, isActive ? styles.statusTextActive : styles.statusTextCompleted]}>
              {isActive ? 'In Progress' : 'Completed'}
            </Text>
          </View>
        </View>

        <Text style={styles.taskDateTime}>
          {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {new Date(request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><View style={styles.blueDot}><View style={styles.blueDotInner} /></View></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationLabel}>PICKUP</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.pickup_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
            <View style={styles.connectingLine} />
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="location" size={16} color="#D90429" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={[styles.locationLabel, { color: '#D90429' }]}>DROPOFF</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.dropoff_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.miniMapWrapper}>
            <LeafletMap lat={request.pickup_location?.latitude || 10.3188} lng={request.pickup_location?.longitude || 123.9050} zoom={14} />
          </View>
        </View>

        <View style={styles.taskDetails}>
          {cargo && (
            <View style={styles.detailChip}>
              <Ionicons name="cube-outline" size={12} color="#6B7280" />
              <Text style={styles.detailChipText}>{cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}</Text>
            </View>
          )}
          {receiver && (
            <View style={styles.detailChip}>
              <Ionicons name="person-outline" size={12} color="#6B7280" />
              <Text style={styles.detailChipText} numberOfLines={1}>{receiver.receiver_name || 'Unknown'}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>Earnings</Text>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2)}</Text>
          </View>
          <View style={styles.footerRight}>
            {isActive ? (
              <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => completeDelivery(delivery.delivery_id, request.request_id)} activeOpacity={0.9}>
                <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Complete</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionBtn, styles.viewBtn]} activeOpacity={0.9}>
                <Text style={styles.viewBtnText}>View</Text>
                <Ionicons name="chevron-forward" size={12} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Render Pending Request                                              */
  /* ------------------------------------------------------------------ */
  const renderPendingRequest = (request: any) => {
    const cargo = request.cargo;

    return (
      <View key={request.request_id} style={[styles.taskCard, styles.pendingCard]}>
        <View style={[styles.cardAccent, { backgroundColor: ORANGE }]} />

        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={[styles.typeBadge, { backgroundColor: '#FFF7ED' }]}>
              <Ionicons name="flash" size={12} color={ORANGE} />
              <Text style={[styles.typeBadgeText, { color: ORANGE }]}>NEW</Text>
            </View>
            <Text style={styles.taskId}>#{request.request_id}</Text>
          </View>
          <View style={[styles.statusBadge, styles.statusPending]}>
            <View style={[styles.statusDot, { backgroundColor: '#D97706' }]} />
            <Text style={styles.statusTextPending}>Available</Text>
          </View>
        </View>

        <Text style={styles.taskDateTime}>
          {new Date(request.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {new Date(request.scheduled_time || request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><View style={styles.blueDot}><View style={styles.blueDotInner} /></View></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationLabel}>PICKUP</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.pickup_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
            <View style={styles.connectingLine} />
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="location" size={16} color="#D90429" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={[styles.locationLabel, { color: '#D90429' }]}>DROPOFF</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.dropoff_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.miniMapWrapper}>
            <LeafletMap lat={request.pickup_location?.latitude || 10.3188} lng={request.pickup_location?.longitude || 123.9050} zoom={14} />
          </View>
        </View>

        <View style={styles.taskDetails}>
          {cargo && (
            <View style={styles.detailChip}>
              <Ionicons name="cube-outline" size={12} color="#6B7280" />
              <Text style={styles.detailChipText}>{cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerLabel}>Earnings</Text>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2)}</Text>
          </View>
          <View style={styles.footerRight}>
            <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={() => acceptDelivery(request.request_id)} activeOpacity={0.9}>
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
              <Text style={styles.actionBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading tasks...</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View style={[styles.header, fadeUp(headerAnim, 14)]}>
        <View>
          <Text style={styles.headerGreeting}>
            {userData?.first_name ? `Hi, ${userData.first_name}` : 'Welcome back'}
          </Text>
          <Text style={styles.pageTitle}>My Tasks</Text>
        </View>
        <View style={styles.headerStats}>
          <View style={styles.statPill}>
            <Text style={styles.statPillValue}>{activeDeliveries.length}</Text>
            <Text style={styles.statPillLabel}>Active</Text>
          </View>
          <View style={[styles.statPill, styles.statPillOrange]}>
            <Text style={[styles.statPillValue, { color: ORANGE }]}>{pendingRequests.length}</Text>
            <Text style={[styles.statPillLabel, { color: ORANGE }]}>New</Text>
          </View>
        </View>
      </Animated.View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} colors={[ORANGE]} />
        }
      >
        <Animated.View style={{ opacity: contentAnim }}>
          {/* Matching status */}
          {isMatching && (
            <Animated.View style={[styles.matchingStatus, { opacity: pulseOpacity }]}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.matchingStatusText}>Looking for matches...</Text>
            </Animated.View>
          )}

          {/* Active */}
          {activeDeliveries.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.sectionDot, { backgroundColor: '#3B82F6' }]} />
                  <Text style={styles.sectionTitle}>Active</Text>
                </View>
                <View style={styles.sectionCountBadge}>
                  <Text style={styles.sectionCountText}>{activeDeliveries.length}</Text>
                </View>
              </View>
              {activeDeliveries.map(d => renderTaskCard(d, true))}
            </View>
          )}

          {/* Pending */}
          {pendingRequests.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.sectionDot, { backgroundColor: ORANGE }]} />
                  <Text style={styles.sectionTitle}>Available Jobs</Text>
                </View>
                <View style={[styles.sectionCountBadge, { backgroundColor: '#FFF7ED' }]}>
                  <Text style={[styles.sectionCountText, { color: ORANGE }]}>{pendingRequests.length}</Text>
                </View>
              </View>
              {pendingRequests.map(renderPendingRequest)}
            </View>
          )}

          {/* Completed */}
          {completedDeliveries.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <View style={[styles.sectionDot, { backgroundColor: '#22C55E' }]} />
                  <Text style={styles.sectionTitle}>Completed</Text>
                </View>
                <View style={[styles.sectionCountBadge, { backgroundColor: '#DCFCE7' }]}>
                  <Text style={[styles.sectionCountText, { color: '#166534' }]}>{completedDeliveries.length}</Text>
                </View>
              </View>
              {completedDeliveries.map(d => renderTaskCard(d, false))}
            </View>
          )}

          {/* Empty */}
          {activeDeliveries.length === 0 && pendingRequests.length === 0 && completedDeliveries.length === 0 && (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="briefcase-outline" size={40} color={ORANGE} />
              </View>
              <Text style={styles.emptyTitle}>No tasks yet</Text>
              <Text style={styles.emptySubtext}>
                New delivery requests will appear here when they match your route.
              </Text>
              <TouchableOpacity
                style={styles.matchNowButton}
                onPress={() => runMatching(true)}
                disabled={isMatching}
                activeOpacity={0.9}
              >
                <Ionicons name="search" size={16} color="#FFFFFF" />
                <Text style={styles.matchNowButtonText}>
                  {isMatching ? 'Searching...' : 'Check for Matches'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  headerGreeting: {
    fontSize: 12,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  headerStats: {
    flexDirection: 'row',
    gap: 8,
  },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    alignItems: 'center',
    minWidth: 52,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  statPillOrange: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  statPillValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statPillLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFE0C7',
    letterSpacing: 0.5,
    marginTop: 1,
  },

  /* ------------------------------------------------------------------ */
  /* Sections                                                            */
  /* ------------------------------------------------------------------ */
  section: { marginBottom: 22 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  sectionCountBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    minWidth: 28,
    alignItems: 'center',
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
  },

  /* ------------------------------------------------------------------ */
  /* Task Card                                                           */
  /* ------------------------------------------------------------------ */
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    paddingLeft: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  pendingCard: {
    borderColor: '#FFE4D2',
    borderWidth: 1.5,
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
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  taskId: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  statusPending: { backgroundColor: '#FEF3C7' },
  statusActive: { backgroundColor: '#DBEAFE' },
  statusCompleted: { backgroundColor: '#DCFCE7' },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  statusTextPending: { fontSize: 10, fontWeight: '800', color: '#D97706', letterSpacing: 0.3 },
  statusTextActive: { color: '#2563EB' },
  statusTextCompleted: { color: '#166534' },

  taskDateTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 14,
  },

  /* Location */
  locationSection: { flexDirection: 'row', justifyContent: 'space-between' },
  locationDetails: { flex: 1, marginRight: 12, position: 'relative' },
  locationItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  iconWrapper: { width: 22, alignItems: 'center', marginRight: 10, zIndex: 2, backgroundColor: '#FFFFFF' },
  blueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center' },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  connectingLine: { position: 'absolute', left: 10, top: 18, bottom: 22, width: 1, backgroundColor: '#E5E7EB', zIndex: 1 },
  locationTextWrapper: { flex: 1 },
  locationLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0000CC',
    letterSpacing: 1,
    marginBottom: 2,
  },
  locationAddress: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 16,
  },
  miniMapWrapper: {
    width: 88,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  /* Details */
  taskDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 6,
  },
  detailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  detailChipText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },

  /* Footer */
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  footerLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
  priceText: { fontSize: 17, fontWeight: '800', color: '#111827' },

  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    gap: 5,
  },
  acceptBtn: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  completeBtn: {
    backgroundColor: '#22C55E',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  viewBtn: {
    backgroundColor: '#F3F4F6',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  viewBtnText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '700',
  },

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Matching Status                                                     */
  /* ------------------------------------------------------------------ */
  matchingStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFE4D2',
    gap: 10,
  },
  matchingStatusText: {
    fontSize: 13,
    color: ORANGE,
    fontWeight: '700',
  },

  /* ------------------------------------------------------------------ */
  /* Empty                                                               */
  /* ------------------------------------------------------------------ */
  emptyContainer: {
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
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },
  matchNowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 24,
    marginTop: 20,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  matchNowButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.2,
  },

  bottomSpacer: { height: 60 },
});