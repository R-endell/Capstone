// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity,
  Platform, StatusBar, ActivityIndicator, RefreshControl, Alert, AppState
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { 
  getProviderDeliveries, getPendingRequests, autoMatchAndCreateDeliveries,
  subscribeToNewRequests, subscribeToProviderRoutes, subscribeToDeliveryUpdates
} from '../../../services/matchingService';

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
  
  const appStateRef = useRef(AppState.currentState);

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
      // DEDUPLICATE: Prevent race conditions from displaying the same delivery twice
      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) => a.findIndex(t => (t.request_id === v.request_id)) === i);
      
      setActiveDeliveries(uniqueDeliveries.filter((d: any) => !d.completed_at));
      setCompletedDeliveries(uniqueDeliveries.filter((d: any) => d.completed_at));
    } catch (error) { console.error('Error fetching deliveries:', error); }
  };

  const fetchPendingRequests = async (pid: number) => {
    try {
      const { data, error } = await supabase
        .from('delivery_requests')
        .select('*, pickup_location:pickup_location_id(*), dropoff_location:dropoff_location_id(*), cargo:cargo_id(*), receiver:receiver_id(*)')
        .eq('delivery_status', 'Pending')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setPendingRequests(data || []);
    } catch (error) { console.error('Error fetching pending requests:', error); }
  };

  const runMatching = async (showAlert: boolean = false) => {
    if (isMatching || !providerId) return;
    try {
      setIsMatching(true);
      const matches = await autoMatchAndCreateDeliveries();
      if (matches.length > 0) {
        if (showAlert) Alert.alert('🎯 New Matches Found!', `${matches.length} delivery matches found.`, [{ text: 'Great!', onPress: () => loadData() }]);
        await loadData();
      }
    } catch (error) { console.error(error); } finally { setIsMatching(false); }
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
      { text: 'Yes, Complete', onPress: async () => {
          try {
            setLoading(true);

            // 1. Mark delivery as completed
            const { error: delError } = await supabase.from('deliveries').update({ completed_at: new Date().toISOString() }).eq('delivery_id', deliveryId);
            if (delError) throw delError;

            // 2. Mark request as completed
            const { error: reqError } = await supabase.from('delivery_requests').update({ delivery_status: 'Completed' }).eq('request_id', requestId);
            if (reqError) throw reqError;

            // 3. Mark escrow as completed and fetch the amount
            const { data: escrowData, error: escError } = await supabase
              .from('escrow_payments')
              .update({ escrow_status: 'Completed' })
              .eq('delivery_id', deliveryId)
              .select('*')
              .single();
              
            if (escError) console.warn('Escrow update error:', escError.message);

            // 4. Update the Provider's Wallet balance
            if (escrowData && escrowData.provider_id) {
              const { data: wallet } = await supabase.from('provider_wallet').select('*').eq('provider_id', escrowData.provider_id).single();
              if (wallet) {
                await supabase.from('provider_wallet')
                  .update({ balance: Number(wallet.balance) + Number(escrowData.amount) })
                  .eq('wallet_id', wallet.wallet_id);
              }
            }

            Alert.alert('Success', 'Delivery completed! Payment has been released to your wallet.');
            await loadData();
          } catch (error: any) { 
            console.error('Completion Error:', error);
            Alert.alert('Completion Failed', error.message || 'Could not complete the delivery. Please check database permissions.'); 
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await Promise.all([fetchDeliveries(pid), fetchPendingRequests(pid)]);
        runMatching(false);
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
      subscribeToDeliveryUpdates(providerId, async () => {
        await loadData();
      })
    ];
    return () => subs.forEach(sub => sub?.unsubscribe?.());
  }, [providerId]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const renderTaskCard = (delivery: any, isActive: boolean) => {
    const request = delivery.delivery_requests;
    if (!request) return null;
    const cargo = request.cargo;
    const receiver = request.receiver;

    return (
      <View key={delivery.delivery_id} style={styles.taskCard}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.taskType}>{request.pickup_type || 'Curb-side'}</Text>
            <Text style={styles.taskDateTime}>{new Date(request.created_at).toLocaleDateString()} {new Date(request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <View style={[styles.statusBadge, isActive ? styles.statusActive : styles.statusCompleted]}>
            <Text style={[styles.statusText, isActive ? styles.statusTextActive : styles.statusTextCompleted]}>{isActive ? 'In Progress' : 'Completed'}</Text>
          </View>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="radio-button-on" size={18} color="#0000FF" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Pickup</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.pickup_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
            <View style={styles.connectingLine} />
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="location" size={18} color="#D90429" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Dropoff</Text>
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
            <View style={styles.cargoDetails}>
              <Ionicons name="cube-outline" size={14} color="#6B7280" />
              <Text style={styles.cargoText}>{cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}</Text>
            </View>
          )}
          {receiver && (
            <View style={styles.receiverDetails}>
              <Ionicons name="person-outline" size={14} color="#6B7280" />
              <Text style={styles.receiverText}>{receiver.receiver_name || 'Unknown'} • {receiver.receiver_phone || 'N/A'}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2)}</Text>
          </View>
          <View style={styles.footerRight}>
            {isActive ? (
              <TouchableOpacity style={[styles.actionBtn, styles.completeBtn]} onPress={() => completeDelivery(delivery.delivery_id, request.request_id)}>
                <Text style={styles.actionBtnText}>Complete</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.actionBtn, styles.viewBtn]}><Text style={styles.viewBtnText}>View</Text></TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderPendingRequest = (request: any) => {
    const cargo = request.cargo;

    return (
      <View key={request.request_id} style={[styles.taskCard, styles.pendingCard]}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.taskType}>{request.pickup_type || 'Curb-side'}</Text>
            <Text style={styles.taskDateTime}>{new Date(request.created_at).toLocaleDateString()} {new Date(request.scheduled_time || request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <View style={[styles.statusBadge, styles.statusPending]}>
            <Text style={styles.statusTextPending}>Available</Text>
          </View>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="radio-button-on" size={18} color="#0000FF" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Pickup</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{request.pickup_location?.street_address || 'N/A'}</Text>
              </View>
            </View>
            <View style={styles.connectingLine} />
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}><Ionicons name="location" size={18} color="#D90429" /></View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>Dropoff</Text>
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
            <View style={styles.cargoDetails}>
              <Ionicons name="cube-outline" size={14} color="#6B7280" />
              <Text style={styles.cargoText}>{cargo.total_weight_kg || 0}kg {cargo.is_fragile && '• Fragile'}</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.priceText}>₱{request.estimated_cost?.toFixed(2)}</Text>
          </View>
          <View style={styles.footerRight}>
            <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={() => acceptDelivery(request.request_id)}>
              <Text style={styles.actionBtnText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color="#000" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Tasks</Text>
        </View>

        {isMatching && (
          <View style={styles.matchingStatus}><ActivityIndicator size="small" color="#F27024" /><Text style={styles.matchingStatusText}> Looking for matches...</Text></View>
        )}

        {activeDeliveries.length > 0 && (
          <View style={styles.section}><Text style={styles.sectionTitle}>Active ({activeDeliveries.length})</Text>{activeDeliveries.map(d => renderTaskCard(d, true))}</View>
        )}

        {pendingRequests.length > 0 && (
          <View style={styles.section}><Text style={styles.sectionTitle}>Available Jobs ({pendingRequests.length})</Text>{pendingRequests.map(renderPendingRequest)}</View>
        )}

        {completedDeliveries.length > 0 && (
          <View style={styles.section}><Text style={styles.sectionTitle}>Completed ({completedDeliveries.length})</Text>{completedDeliveries.map(d => renderTaskCard(d, false))}</View>
        )}

        {activeDeliveries.length === 0 && pendingRequests.length === 0 && completedDeliveries.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="briefcase-outline" size={60} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No tasks yet</Text>
            <TouchableOpacity style={styles.matchNowButton} onPress={() => runMatching(true)} disabled={isMatching}>
              <Text style={styles.matchNowButtonText}>{isMatching ? 'Searching...' : '🔍 Force Check Matches'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingHorizontal: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { marginTop: Platform.OS === 'android' ? 60 : 10, marginBottom: 20 },
  pageTitle: { fontSize: 35, fontWeight: '700', color: '#000' },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 22, fontWeight: '600', color: '#000', marginBottom: 16 },
  taskCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6', elevation: 3 },
  pendingCard: { borderColor: '#F27024', borderWidth: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  taskType: { fontSize: 12, color: '#6B7280', marginBottom: 2 },
  taskDateTime: { fontSize: 15, fontWeight: '600', color: '#111827' },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  statusPending: { backgroundColor: '#FEF3C7' },
  statusActive: { backgroundColor: '#DBEAFE' },
  statusCompleted: { backgroundColor: '#86EFAC' },
  statusText: { fontSize: 12, fontWeight: '500' },
  statusTextPending: { color: '#D97706' },
  statusTextActive: { color: '#2563EB' },
  statusTextCompleted: { color: '#166534' },
  locationSection: { flexDirection: 'row', justifyContent: 'space-between' },
  locationDetails: { flex: 1, marginRight: 12, position: 'relative' },
  locationItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  iconWrapper: { width: 24, alignItems: 'center', marginRight: 8, zIndex: 2, backgroundColor: '#FFF' },
  connectingLine: { position: 'absolute', left: 11, top: 20, bottom: 30, width: 1, backgroundColor: '#D1D5DB', zIndex: 1 },
  locationTextWrapper: { flex: 1 },
  locationName: { fontSize: 14, fontWeight: '500', color: '#111827' },
  locationAddress: { fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 14 },
  miniMapWrapper: { width: 90, height: 70, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' },
  taskDetails: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 },
  cargoDetails: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  cargoText: { fontSize: 11, color: '#6B7280', marginLeft: 4 },
  receiverDetails: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  receiverText: { fontSize: 11, color: '#6B7280', marginLeft: 4 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  priceText: { fontSize: 16, fontWeight: '700', color: '#111827' },
  actionBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  acceptBtn: { backgroundColor: '#F27024' },
  completeBtn: { backgroundColor: '#34C759' },
  viewBtn: { backgroundColor: '#F3F4F6' },
  actionBtnText: { color: '#FFF', fontSize: 13, fontWeight: '500' },
  viewBtnText: { color: '#6B7280', fontSize: 13, fontWeight: '500' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: '#374151', marginTop: 16 },
  matchingStatus: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: '#FEF3C7', borderRadius: 8, marginBottom: 16 },
  matchingStatusText: { marginLeft: 8, fontSize: 13, color: '#D97706', fontWeight: '500' },
  matchNowButton: { backgroundColor: '#F27024', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 25, marginTop: 16 },
  matchNowButtonText: { color: '#FFF', fontWeight: '600', fontSize: 14 }
});