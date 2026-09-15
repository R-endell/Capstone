// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing,
  Dimensions, Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import {
  getProviderDeliveries, findMatches,
  subscribeToNewRequests, subscribeToProviderRoutes, subscribeToDeliveryUpdates
} from '../../../services/matchingService';

const ORANGE = '#FA7A25';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const frameSize = Math.min(SCREEN_W * 0.72, 280);

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
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      androidLayerType="hardware"
    />
  );
};

// token + pin helpers
const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000)); // 4 digit pin

const hydrateQr = async (deliveries: any[]) => {
  if (!deliveries || deliveries.length === 0) return deliveries;
  const ids = deliveries.map(d => d.delivery_id).filter(Boolean);
  if (ids.length === 0) return deliveries;

  const { data: qrRows } = await supabase
    .from('qr_verifications')
    .select('*')
    .in('delivery_id', ids);

  const byId: Record<number, any> = {};
  (qrRows || []).forEach((q: any) => { byId[q.delivery_id] = q; });

  return deliveries.map(d => ({
    ...d,
    qr_verifications: d.qr_verifications || byId[d.delivery_id] || null,
  }));
};

export default function TaskScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [activeDeliveries, setActiveDeliveries] = useState<any[]>([]);
  const [completedDeliveries, setCompletedDeliveries] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [isMatching, setIsMatching] = useState(false);

  // QR verification state
  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [scanned, setScanned] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // View detail modal state
  const [viewTarget, setViewTarget] = useState<any>(null);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const matchingPulse = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

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

  // Laser scanner animation
  useEffect(() => {
    if (!verifyModalVisible) return;
    scanLineAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [verifyModalVisible, scanLineAnim]);

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
      const uniqueDeliveries = deliveries.filter((v: any, i: number, a: any[]) =>
        a.findIndex(t => (t.request_id === v.request_id)) === i,
      );

      const hydrated = await hydrateQr(uniqueDeliveries);

      setActiveDeliveries(hydrated.filter((d: any) => !d.completed_at));
      setCompletedDeliveries(hydrated.filter((d: any) => d.completed_at));
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

      const qrPayload = {
        delivery_id: delivery.delivery_id,
        pickup_qr: `PU-${randToken(14)}-${delivery.delivery_id}`,
        dropoff_qr: `DO-${randToken(14)}-${delivery.delivery_id}`,
        pickup_pin: randPin(),
        dropoff_pin: randPin(),
      };

      const { error: qrError } = await supabase.from('qr_verifications').insert(qrPayload);
      if (qrError) {
        await supabase.from('deliveries').delete().eq('delivery_id', delivery.delivery_id);
        throw qrError;
      }

      const { error: reqUpdateError } = await supabase.from('delivery_requests').update({ delivery_status: 'Accepted' }).eq('request_id', requestId);
      if (reqUpdateError) throw reqUpdateError;

      const { data: requestData } = await supabase.from('delivery_requests').select('estimated_cost, sender_id').eq('request_id', requestId).single();
      if (requestData) {
        await supabase.from('escrow_payments').insert({
          amount: requestData.estimated_cost, delivery_id: delivery.delivery_id, sender_id: requestData.sender_id,
          provider_id: providerId, escrow_status: 'On hold', emergency_frozen: false, created_at: new Date().toISOString()
        });
      }
      Alert.alert('Success', 'Delivery accepted! Ask the sender to show their pickup QR.');
      await loadData();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to accept delivery.');
    } finally { setLoading(false); }
  };

  const openVerifyModal = async (delivery: any) => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res?.granted) {
        Alert.alert('Camera Permission', 'Camera access is required to scan QR codes.');
        return;
      }
    }
    setVerifyTarget(delivery);
    setScanned(false);
    setPinInput('');
    setVerifyModalVisible(true);
  };

  const closeVerifyModal = () => {
    setVerifyModalVisible(false);
    setVerifyTarget(null);
    setScanned(false);
    setPinInput('');
  };

  const markPickupVerified = async (deliveryId: number, requestId: number) => {
    try {
      const { error: qrErr } = await supabase
        .from('qr_verifications')
        .update({ pickup_verified: true })
        .eq('delivery_id', deliveryId);
      if (qrErr) throw qrErr;

      const { error: reqErr } = await supabase
        .from('delivery_requests')
        .update({ delivery_status: 'In Transit' })
        .eq('request_id', requestId);
      if (reqErr) throw reqErr;

      await supabase.from('delivery_status_history').insert({
        delivery_id: deliveryId,
        status: 'Picked up',
        updated_at: new Date().toISOString(),
      });

      const patchDelivery = (list: any[]) =>
        list.map(d => {
          if (d.delivery_id !== deliveryId) return d;
          const currentQr = d.qr_verifications
            ? (Array.isArray(d.qr_verifications) ? d.qr_verifications[0] : d.qr_verifications)
            : {};
          return {
            ...d,
            qr_verifications: { ...currentQr, pickup_verified: true },
            delivery_requests: d.delivery_requests
              ? { ...d.delivery_requests, delivery_status: 'In Transit' }
              : d.delivery_requests,
          };
        });

      setActiveDeliveries(prev => patchDelivery(prev));
      setCompletedDeliveries(prev => patchDelivery(prev));

      Alert.alert('✅ Item Collected', 'Pickup verified. You can now deliver to the receiver.');
      closeVerifyModal();

      if (providerId) await fetchDeliveries(providerId);
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify pickup.');
    }
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned || !verifyTarget) return;
    setScanned(true); // Disable future scans instantly until reset
    try {
      const { data: row, error } = await supabase
        .from('qr_verifications')
        .select('*')
        .eq('pickup_qr', data)
        .eq('delivery_id', verifyTarget.delivery_id)
        .single();

      if (error || !row) {
        Alert.alert('Invalid QR', 'This QR does not match the selected delivery.', [
          { text: 'Try Again', onPress: () => setScanned(false) },
        ]);
        return;
      }
      if (row.pickup_verified) {
        Alert.alert('Already Verified', 'This pickup has already been verified.', [
          { text: 'OK', onPress: () => closeVerifyModal() },
        ]);
        return;
      }

      await markPickupVerified(row.delivery_id, verifyTarget.request_id);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'QR scan failed.', [
        { text: 'Try Again', onPress: () => setScanned(false) },
      ]);
    }
  };

  const handlePinVerify = async () => {
    if (!verifyTarget || pinInput.trim().length !== 4) return;
    setPinVerifying(true);
    try {
      const { data: row, error } = await supabase
        .from('qr_verifications')
        .select('*')
        .eq('delivery_id', verifyTarget.delivery_id)
        .single();

      if (error || !row) throw new Error('QR record not found for this delivery.');
      if (row.pickup_verified) {
        Alert.alert('Already Verified', 'Pickup already verified.');
        return;
      }
      if (String(row.pickup_pin) !== String(pinInput).trim()) {
        Alert.alert('Wrong PIN', 'Please ask the sender for the correct 4-digit PIN.');
        return;
      }
      await markPickupVerified(row.delivery_id, verifyTarget.request_id);
    } catch (e: any) {
      Alert.alert('Verification Failed', e.message || 'Could not verify PIN.');
    } finally {
      setPinVerifying(false);
    }
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

            await supabase.from('qr_verifications').update({ dropoff_verified: true }).eq('delivery_id', deliveryId);

            const { data: escrowData } = await supabase.from('escrow_payments').update({ escrow_status: 'Completed' }).eq('delivery_id', deliveryId).select('*').single();

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
      subscribeToNewRequests(async () => { await runMatching(true); }),
      subscribeToProviderRoutes(providerId, async () => { await runMatching(false); }),
      subscribeToDeliveryUpdates(providerId, async () => { await loadData(); }),
    ];

    const qrChannel = supabase
      .channel(`provider-qr-${providerId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'qr_verifications' },
        () => { fetchDeliveries(providerId); },
      )
      .subscribe();

    const hasActive = activeDeliveries.length > 0;
    let interval: any = null;
    if (hasActive) {
      interval = setInterval(() => { fetchDeliveries(providerId); }, 8000);
    }

    return () => {
      subs.forEach(sub => sub?.unsubscribe?.());
      supabase.removeChannel(qrChannel);
      if (interval) clearInterval(interval);
    };
  }, [providerId, activeDeliveries.length]);

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const pulseOpacity = matchingPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  
  // Calculate scan line movement inside the transparent window frame
  const scanLineY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, frameSize - 4] });

  const isPickupVerified = (delivery: any) => {
    const qr = delivery?.qr_verifications;
    if (qr) {
      if (Array.isArray(qr)) {
        if (qr[0]?.pickup_verified) return true;
      } else if (qr.pickup_verified) {
        return true;
      }
    }
    const status = delivery?.delivery_requests?.delivery_status;
    return status === 'In Transit' || status === 'Completed';
  };

  const renderTaskCard = (delivery: any, isActive: boolean) => {
    const request = delivery.delivery_requests;
    if (!request) return null;
    const cargo = request.cargo;
    const receiver = request.receiver;
    const pickupVerified = isPickupVerified(delivery);

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
              {isActive ? (pickupVerified ? 'In Transit' : 'Awaiting Pickup') : 'Completed'}
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
              <>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.viewBtn]}
                  onPress={() => setViewTarget(delivery)}
                  activeOpacity={0.9}
                >
                  <Ionicons name="eye-outline" size={14} color="#6B7280" />
                  <Text style={styles.viewBtnText}>View</Text>
                </TouchableOpacity>

                {!pickupVerified ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.scanBtn]}
                    onPress={() => openVerifyModal(delivery)}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="qr-code-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.actionBtnText}>Verify</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.completeBtn]}
                    onPress={() => completeDelivery(delivery.delivery_id, request.request_id)}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" />
                    <Text style={styles.actionBtnText}>Complete</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <TouchableOpacity
                style={[styles.actionBtn, styles.viewBtn]}
                onPress={() => setViewTarget(delivery)}
                activeOpacity={0.9}
              >
                <Ionicons name="eye-outline" size={14} color="#6B7280" />
                <Text style={styles.viewBtnText}>View</Text>
              </TouchableOpacity>
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
  /* Full-screen Scanner Modal (FIXED CENTERING)                         */
  /* ------------------------------------------------------------------ */
  const renderScannerModal = () => {
    return (
      <Modal
        visible={verifyModalVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={closeVerifyModal}
      >
        <View style={styles.scannerRoot}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />

          {/* Automatic Camera Scanner */}
          {cameraPermission?.granted && (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={!scanned ? handleBarcodeScanned : undefined}
            />
          )}

          {/* Perfectly Centered Transparent Hole-Punch Overlay */}
          <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="none">
            {/* Top Overlay: Flex 1 pushes the hole down */}
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
            
            <View style={{ flexDirection: 'row', height: frameSize }}>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
              
              {/* The clear scanning window */}
              <View style={{ width: frameSize, height: frameSize, overflow: 'hidden', position: 'relative' }}>
                {/* Laser animation */}
                <Animated.View style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]} />
                
                {/* White Corner Markers */}
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
            </View>
            
            {/* Bottom Overlay: slightly larger flex accounts for the bottom sheet so it visually centers */}
            <View style={{ flex: 2.2, backgroundColor: 'rgba(0,0,0,0.7)' }} />
          </View>

          {/* Header Close Button */}
          <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
            <TouchableOpacity style={styles.scannerCloseBtn} onPress={closeVerifyModal}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          {/* Bottom Sheet Context */}
          <View style={[styles.scannerBottomSheet, { paddingBottom: insets.bottom + 24, zIndex: 20 }]}>
            <View style={styles.sheetHandle} />

            <Text style={styles.sheetHeading}>Scan Pickup QR</Text>
            <Text style={styles.sheetSubheading}>
              Point your camera at the Sender's screen to automatically verify pickup.
            </Text>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR ENTER PIN</Text>
              <View style={styles.orLine} />
            </View>

            <View style={styles.pinRow}>
              <TextInput
                style={styles.pinInput}
                value={pinInput}
                onChangeText={(t) => setPinInput(t.replace(/[^0-9]/g, '').slice(0, 4))}
                keyboardType="number-pad"
                placeholder="••••"
                placeholderTextColor="#9CA3AF"
                maxLength={4}
              />
              <TouchableOpacity
                style={[styles.pinBtn, (pinInput.length !== 4 || pinVerifying) && { opacity: 0.5 }]}
                disabled={pinInput.length !== 4 || pinVerifying}
                onPress={handlePinVerify}
                activeOpacity={0.9}
              >
                {pinVerifying ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.pinBtnText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderViewModal = () => {
    if (!viewTarget) return null;
    const request = viewTarget.delivery_requests;
    if (!request) return null;
    const cargo = request.cargo;
    const receiver = request.receiver;
    const pickupVerified = isPickupVerified(viewTarget);
    const isCompleted = !!viewTarget.completed_at;

    return (
      <Modal
        visible={!!viewTarget}
        animationType="slide"
        transparent
        onRequestClose={() => setViewTarget(null)}
      >
        <View style={styles.viewOverlay}>
          <View style={styles.viewSheet}>
            <View style={styles.viewHeader}>
              <View>
                <Text style={styles.viewEyebrow}>DELIVERY DETAILS</Text>
                <Text style={styles.viewTitle}>#{request.request_id}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setViewTarget(null)}
                style={styles.viewCloseBtn}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.viewScrollContent}
            >
              <View
                style={[
                  styles.viewStatusPill,
                  isCompleted
                    ? { backgroundColor: '#DCFCE7' }
                    : pickupVerified
                      ? { backgroundColor: '#E0F2FE' }
                      : { backgroundColor: '#FEF3C7' },
                ]}
              >
                <Ionicons
                  name={isCompleted ? 'checkmark-done-circle' : pickupVerified ? 'cube-outline' : 'time-outline'}
                  size={14}
                  color={isCompleted ? '#166534' : pickupVerified ? '#0369A1' : '#92400E'}
                />
                <Text
                  style={[
                    styles.viewStatusPillText,
                    isCompleted
                      ? { color: '#166534' }
                      : pickupVerified
                        ? { color: '#0369A1' }
                        : { color: '#92400E' },
                  ]}
                >
                  {isCompleted ? 'Completed' : pickupVerified ? 'In Transit' : 'Awaiting Pickup'}
                </Text>
              </View>

              <View style={styles.viewMapWrap}>
                <LeafletMap
                  lat={request.pickup_location?.latitude || 10.3188}
                  lng={request.pickup_location?.longitude || 123.9050}
                  zoom={14}
                />
              </View>

              <Text style={styles.viewSectionTitle}>Route</Text>
              <View style={styles.viewCard}>
                <View style={styles.viewRouteRow}>
                  <View style={styles.viewRouteDotBlue}>
                    <View style={styles.viewRouteDotBlueInner} />
                  </View>
                  <View style={styles.viewRouteTextWrap}>
                    <Text style={styles.viewRouteLabelBlue}>PICKUP</Text>
                    <Text style={styles.viewRouteAddress}>{request.pickup_location?.street_address || 'N/A'}</Text>
                  </View>
                </View>
                <View style={styles.viewRouteDivider} />
                <View style={styles.viewRouteRow}>
                  <Ionicons name="location" size={18} color="#D90429" />
                  <View style={styles.viewRouteTextWrap}>
                    <Text style={styles.viewRouteLabelRed}>DROPOFF</Text>
                    <Text style={styles.viewRouteAddress}>{request.dropoff_location?.street_address || 'N/A'}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.viewSectionTitle}>Package</Text>
              <View style={styles.viewCard}>
                <View style={styles.viewInfoRow}>
                  <Ionicons name="cube-outline" size={16} color="#6B7280" />
                  <Text style={styles.viewInfoLabel}>Weight</Text>
                  <Text style={styles.viewInfoValue}>{cargo?.total_weight_kg ?? 0} kg</Text>
                </View>
                <View style={styles.viewInfoRow}>
                  <Ionicons name="resize-outline" size={16} color="#6B7280" />
                  <Text style={styles.viewInfoLabel}>Size (L × W × H)</Text>
                  <Text style={styles.viewInfoValue}>
                    {cargo?.cargo_length_cm ?? '-'} × {cargo?.cargo_width_cm ?? '-'} × {cargo?.cargo_height_cm ?? '-'} cm
                  </Text>
                </View>
                <View style={styles.viewInfoRow}>
                  <Ionicons name="warning-outline" size={16} color="#6B7280" />
                  <Text style={styles.viewInfoLabel}>Fragile</Text>
                  <Text style={styles.viewInfoValue}>{cargo?.is_fragile ? 'Yes' : 'No'}</Text>
                </View>
                <View style={styles.viewInfoRow}>
                  <Ionicons name="pricetag-outline" size={16} color="#6B7280" />
                  <Text style={styles.viewInfoLabel}>Type</Text>
                  <Text style={styles.viewInfoValue}>{request.pickup_type || 'Curb-side'}</Text>
                </View>
              </View>

              {receiver && (
                <>
                  <Text style={styles.viewSectionTitle}>Receiver</Text>
                  <View style={styles.viewCard}>
                    <View style={styles.viewInfoRow}>
                      <Ionicons name="person-outline" size={16} color="#6B7280" />
                      <Text style={styles.viewInfoLabel}>Name</Text>
                      <Text style={styles.viewInfoValue}>{receiver.receiver_name || 'Unknown'}</Text>
                    </View>
                    <View style={styles.viewInfoRow}>
                      <Ionicons name="call-outline" size={16} color="#6B7280" />
                      <Text style={styles.viewInfoLabel}>Phone</Text>
                      <Text style={styles.viewInfoValue}>{request.receiver_phone || 'N/A'}</Text>
                    </View>
                  </View>
                </>
              )}

              <Text style={styles.viewSectionTitle}>Status</Text>
              <View style={styles.viewCard}>
                <View style={styles.viewTimelineRow}>
                  <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.viewTimelineTitle}>Accepted</Text>
                    <Text style={styles.viewTimelineTime}>
                      {new Date(viewTarget.accepted_at).toLocaleString()}
                    </Text>
                  </View>
                </View>
                <View style={styles.viewTimelineRow}>
                  <Ionicons
                    name={pickupVerified ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={pickupVerified ? '#8B5CF6' : '#D1D5DB'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.viewTimelineTitle, !pickupVerified && { color: '#9CA3AF' }]}>
                      Item Collected
                    </Text>
                    <Text style={styles.viewTimelineTime}>
                      {pickupVerified ? 'Verified by QR' : 'Waiting for QR'}
                    </Text>
                  </View>
                </View>
                <View style={styles.viewTimelineRow}>
                  <Ionicons
                    name={isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={isCompleted ? '#22C55E' : '#D1D5DB'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.viewTimelineTitle, !isCompleted && { color: '#9CA3AF' }]}>
                      Delivered
                    </Text>
                    <Text style={styles.viewTimelineText}>
                      {isCompleted && viewTarget.completed_at
                        ? new Date(viewTarget.completed_at).toLocaleString()
                        : 'Awaiting delivery'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.viewEarningsCard}>
                <Text style={styles.viewEarningsLabel}>You earn</Text>
                <Text style={styles.viewEarningsValue}>
                  ₱{Number(request.estimated_cost || 0).toFixed(2)}
                </Text>
              </View>
            </ScrollView>

            <View style={styles.viewFooter}>
              <TouchableOpacity
                style={styles.viewFooterClose}
                onPress={() => setViewTarget(null)}
                activeOpacity={0.9}
              >
                <Text style={styles.viewFooterCloseText}>Close</Text>
              </TouchableOpacity>

              {!isCompleted && !pickupVerified && (
                <TouchableOpacity
                  style={styles.viewFooterPrimary}
                  onPress={() => {
                    const t = viewTarget;
                    setViewTarget(null);
                    setTimeout(() => openVerifyModal(t), 150);
                  }}
                  activeOpacity={0.9}
                >
                  <Ionicons name="qr-code-outline" size={16} color="#FFF" />
                  <Text style={styles.viewFooterPrimaryText}>Verify Pickup</Text>
                </TouchableOpacity>
              )}
              {!isCompleted && pickupVerified && (
                <TouchableOpacity
                  style={[styles.viewFooterPrimary, { backgroundColor: '#22C55E' }]}
                  onPress={() => {
                    const t = viewTarget;
                    setViewTarget(null);
                    setTimeout(() => completeDelivery(t.delivery_id, t.delivery_requests.request_id), 150);
                  }}
                  activeOpacity={0.9}
                >
                  <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                  <Text style={styles.viewFooterPrimaryText}>Complete Delivery</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>
    );
  };

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

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
          {isMatching && (
            <Animated.View style={[styles.matchingStatus, { opacity: pulseOpacity }]}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.matchingStatusText}>Looking for matches...</Text>
            </Animated.View>
          )}

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

      {renderScannerModal()}
      {renderViewModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: ORANGE, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  headerGreeting: { fontSize: 12, color: '#FFE0C7', fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  pageTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  headerStats: { flexDirection: 'row', gap: 8 },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
    alignItems: 'center', minWidth: 52, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  statPillOrange: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  statPillValue: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  statPillLabel: { fontSize: 9, fontWeight: '700', color: '#FFE0C7', letterSpacing: 0.5, marginTop: 1 },

  section: { marginBottom: 22 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  sectionCountBadge: { backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, minWidth: 28, alignItems: 'center' },
  sectionCountText: { fontSize: 11, fontWeight: '800', color: '#6B7280' },

  taskCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, paddingLeft: 20, marginBottom: 12,
    borderWidth: 1, borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
    overflow: 'hidden', position: 'relative',
  },
  pendingCard: { borderColor: '#FFE4D2', borderWidth: 1.5 },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  typeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  taskId: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.3 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, gap: 5 },
  statusPending: { backgroundColor: '#FEF3C7' },
  statusActive: { backgroundColor: '#DBEAFE' },
  statusCompleted: { backgroundColor: '#DCFCE7' },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  statusTextPending: { fontSize: 10, fontWeight: '800', color: '#D97706', letterSpacing: 0.3 },
  statusTextActive: { color: '#2563EB' },
  statusTextCompleted: { color: '#166534' },

  taskDateTime: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginBottom: 14 },

  locationSection: { flexDirection: 'row', justifyContent: 'space-between' },
  locationDetails: { flex: 1, marginRight: 12, position: 'relative' },
  locationItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  iconWrapper: { width: 22, alignItems: 'center', marginRight: 10, zIndex: 2, backgroundColor: '#FFFFFF' },
  blueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center' },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  connectingLine: { position: 'absolute', left: 10, top: 18, bottom: 22, width: 1, backgroundColor: '#E5E7EB', zIndex: 1 },
  locationTextWrapper: { flex: 1 },
  locationLabel: { fontSize: 9, fontWeight: '800', color: '#0000CC', letterSpacing: 1, marginBottom: 2 },
  locationAddress: { fontSize: 12, fontWeight: '600', color: '#111827', lineHeight: 16 },
  miniMapWrapper: { width: 88, height: 72, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E5E7EB' },

  taskDetails: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  detailChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 5,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  detailChipText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  footerLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  footerLabel: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
  priceText: { fontSize: 17, fontWeight: '800', color: '#111827' },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 20, gap: 5,
  },
  acceptBtn: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  scanBtn: {
    backgroundColor: '#7C3AED',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  completeBtn: {
    backgroundColor: '#22C55E',
    shadowColor: '#22C55E', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  viewBtn: { backgroundColor: '#F3F4F6' },
  actionBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  viewBtnText: { color: '#4B5563', fontSize: 11, fontWeight: '700' },

  /* Loading / matching */
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  matchingStatus: {
    flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#FFF7ED',
    borderRadius: 14, marginBottom: 16, borderWidth: 1, borderColor: '#FFE4D2', gap: 10,
  },
  matchingStatusText: { fontSize: 13, color: ORANGE, fontWeight: '700' },

  /* Empty */
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 24 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginTop: 4 },
  emptySubtext: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 18 },
  matchNowButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: ORANGE,
    paddingHorizontal: 20, paddingVertical: 13, borderRadius: 24, marginTop: 20, gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  matchNowButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, letterSpacing: 0.2 },
  bottomSpacer: { height: 60 },

  /* ==================== Scanner Modal ==================== */
  scannerRoot: { flex: 1, backgroundColor: '#000' },

  cameraPermissionFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', gap: 14, paddingHorizontal: 30 },
  cameraPermissionText: { color: '#E5E7EB', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  cameraPermissionBtn: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, backgroundColor: ORANGE, borderRadius: 24 },
  cameraPermissionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  
  scanWindow: { backgroundColor: 'transparent', overflow: 'hidden', position: 'relative' },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: ORANGE, shadowColor: ORANGE, shadowOpacity: 1, shadowRadius: 8 },

  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },

  scannerTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start',
    paddingHorizontal: 20, paddingBottom: 12,
  },
  scannerCloseBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },

  scannerBottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 5, borderRadius: 3,
    backgroundColor: '#E5E7EB', marginBottom: 18,
  },
  sheetHeading: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 4 },
  sheetSubheading: { fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 18 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  orText: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1.2 },

  pinRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pinInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, letterSpacing: 6,
    color: '#111827', fontWeight: '700', textAlign: 'center', backgroundColor: '#F9FAFB'
  },
  pinBtn: {
    backgroundColor: ORANGE, paddingHorizontal: 24, justifyContent: 'center',
    borderRadius: 14, alignItems: 'center', minWidth: 100,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  pinBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  /* ==================== View Modal ==================== */
  viewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  viewSheet: {
    backgroundColor: '#F9FAFB', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 18, maxHeight: '92%',
  },
  viewHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 22, paddingBottom: 14,
  },
  viewEyebrow: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1.2, marginBottom: 4 },
  viewTitle: { fontSize: 22, fontWeight: '800', color: '#111827' },
  viewCloseBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },
  viewScrollContent: { paddingHorizontal: 22, paddingBottom: 24 },
  viewStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, marginBottom: 14,
  },
  viewStatusPillText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  viewMapWrap: {
    height: 160, borderRadius: 18, overflow: 'hidden', marginBottom: 18,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  viewSectionTitle: { fontSize: 13, fontWeight: '800', color: '#111827', marginBottom: 8, letterSpacing: 0.2 },
  viewCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 18,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  viewRouteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  viewRouteDotBlue: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#0000CC',
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  viewRouteDotBlueInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  viewRouteTextWrap: { flex: 1 },
  viewRouteLabelBlue: { fontSize: 9, fontWeight: '800', color: '#0000CC', letterSpacing: 1, marginBottom: 2 },
  viewRouteLabelRed: { fontSize: 9, fontWeight: '800', color: '#D90429', letterSpacing: 1, marginBottom: 2 },
  viewRouteAddress: { fontSize: 13, color: '#111827', fontWeight: '600', lineHeight: 18 },
  viewRouteDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12, marginLeft: 26 },

  viewInfoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F9FAFB',
  },
  viewInfoLabel: { flex: 1, fontSize: 12, color: '#6B7280', fontWeight: '600' },
  viewInfoValue: { fontSize: 12, color: '#111827', fontWeight: '700' },

  viewTimelineRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8,
  },
  viewTimelineTitle: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 2 },
  viewTimelineTime: { fontSize: 11, color: '#6B7280' },
  viewTimelineText: { fontSize: 11, color: '#6B7280' },

  viewEarningsCard: {
    backgroundColor: '#111827', borderRadius: 16, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  viewEarningsLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  viewEarningsValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },

  viewFooter: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 22,
    paddingTop: 14, paddingBottom: 20,
    borderTopWidth: 1, borderTopColor: '#F3F4F6', backgroundColor: '#FFF',
  },
  viewFooterClose: {
    flex: 1, paddingVertical: 14, borderRadius: 30, alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  viewFooterCloseText: { color: '#4B5563', fontWeight: '800', fontSize: 14 },
  viewFooterPrimary: {
    flex: 1.4, paddingVertical: 14, borderRadius: 30, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    backgroundColor: '#7C3AED',
    shadowColor: '#7C3AED', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  viewFooterPrimaryText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
});