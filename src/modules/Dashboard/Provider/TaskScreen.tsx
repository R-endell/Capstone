// src/modules/Dashboard/Provider/TaskScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  StatusBar, ActivityIndicator, RefreshControl, Alert, Animated, Easing,
  Dimensions, Platform, BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { formatDate, formatDateTime } from '../../../utils/dateUtils';
import {
  getProviderDeliveries, findMatches
} from '../../../services/matchingService';

const ORANGE = '#FA7A25';
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const frameSize = Math.min(SCREEN_W * 0.72, 280);

/* ==================================================================== */
/* LeafletMap — single-point map (kept for reference)                    */
/* ==================================================================== */
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

/* ==================================================================== */
/* TaskRouteMap — two-point map with OSRM road-following route          */
/* ==================================================================== */
const TaskRouteMap = ({
  pickupLat, pickupLng,
  dropoffLat, dropoffLng,
  zoom = 12,
  interactive = false,
}: {
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  zoom?: number;
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
  const zoomControl = interactive ? 'true' : 'false';

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .marker-pickup { background: #0000CC; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
          .marker-dropoff { background: #D90429; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
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
            zoomControl: ${zoomControl},
            attributionControl: false,
            dragging: ${dragging},
            touchZoom: ${touchZoom},
            scrollWheelZoom: ${scrollWheelZoom},
            doubleClickZoom: ${doubleClickZoom},
          }).setView([${centerLat}, ${centerLng}], ${zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var pickupIcon = L.divIcon({ className: '', html: '<div class="marker-pickup">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
          var dropoffIcon = L.divIcon({ className: '', html: '<div class="marker-dropoff">D</div>', iconSize: [22, 22], iconAnchor: [11, 11] });

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
                  L.polyline(latlngs, { color: '#FA7A25', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map);
                  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
                } else {
                  L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], { color: '#FA7A25', weight: 4, opacity: 0.7, dashArray: '8, 8' }).addTo(map);
                  map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
                }
              })
              .catch(function() {
                L.polyline([[pickupLat, pickupLng], [dropoffLat, dropoffLng]], { color: '#FA7A25', weight: 4, opacity: 0.7, dashArray: '8, 8' }).addTo(map);
                map.fitBounds(L.latLngBounds([[pickupLat, pickupLng], [dropoffLat, dropoffLng]]), { padding: [40, 40] });
              });
          } else if (pickupLat != null && pickupLng != null && dropoffLat == null) {
            map.setView([pickupLat, pickupLng], ${zoom});
          } else if (dropoffLat != null && dropoffLng != null && pickupLat == null) {
            map.setView([dropoffLat, dropoffLng], ${zoom});
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
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */
const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

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

  const [verifyModalVisible, setVerifyModalVisible] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<any>(null);
  const [scanned, setScanned] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const [viewTarget, setViewTarget] = useState<any>(null);
  const [showFullMap, setShowFullMap] = useState(false);

  const [deliveryOTPModalVisible, setDeliveryOTPModalVisible] = useState(false);
  const [deliveryOTPTarget, setDeliveryOTPTarget] = useState<any>(null);
  const [deliveryOTPInput, setDeliveryOTPInput] = useState('');
  const [deliveryOTPVerifying, setDeliveryOTPVerifying] = useState(false);
  const [deliveryOTPResending, setDeliveryOTPResending] = useState(false);

  const [activeTab, setActiveTab] = useState<'all' | 'available' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const matchingPulse = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;

  // List / detail animation
  useEffect(() => {
    if (!viewTarget) {
      listAnim.setValue(0);
      Animated.timing(listAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else {
      detailAnim.setValue(0);
      Animated.timing(detailAnim, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [viewTarget, listAnim, detailAnim]);

  // Android back button: close full map, then detail view
  useEffect(() => {
    const backAction = () => {
      if (showFullMap) { setShowFullMap(false); return true; }
      if (viewTarget) { setViewTarget(null); return true; }
      return false;
    };
    const bh = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => bh.remove();
  }, [showFullMap, viewTarget]);

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
    setScanned(true);
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

  /* ==================================================================== */
  /* DELIVERY CONFIRMATION (OTP via Contiguity)                           */
  /* ==================================================================== */
  const openDeliveryOTPModal = (delivery: any) => {
    setDeliveryOTPTarget(delivery);
    setDeliveryOTPInput('');
    setDeliveryOTPModalVisible(true);
  };

  const closeDeliveryOTPModal = () => {
    setDeliveryOTPModalVisible(false);
    setDeliveryOTPTarget(null);
    setDeliveryOTPInput('');
    setDeliveryOTPVerifying(false);
    setDeliveryOTPResending(false);
  };

  const handleResendDeliveryOTP = async () => {
    if (!deliveryOTPTarget) return;

    Alert.alert(
      'Send New OTP',
      'A brand new 6-digit OTP will be sent to the receiver. The previous code will no longer work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send New OTP',
          onPress: async () => {
            try {
              setDeliveryOTPResending(true);

              const { data, error } = await supabase.functions.invoke('contiguity-otp', {
                body: {
                  action: 'regenerate',
                  delivery_id: deliveryOTPTarget.delivery_id,
                },
              });

              if (error || !data?.success) {
                Alert.alert('Error', data?.error || error?.message || 'Could not send new OTP.');
                return;
              }

              Alert.alert('OTP Sent', 'A new OTP has been sent to the receiver.');
              setDeliveryOTPInput('');
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Failed to send new OTP.');
            } finally {
              setDeliveryOTPResending(false);
            }
          },
        },
      ]
    );
  };

  const completeDelivery = async () => {
    if (!deliveryOTPTarget || deliveryOTPInput.trim().length !== 6) return;

    const deliveryId = deliveryOTPTarget.delivery_id;
    const requestId = deliveryOTPTarget.delivery_requests?.request_id;

    setDeliveryOTPVerifying(true);
    try {
      const { data: verifyResult, error: verifyError } = await supabase.functions.invoke(
        'contiguity-otp',
        {
          body: {
            action: 'verify',
            delivery_id: deliveryId,
            otp: deliveryOTPInput.trim(),
          },
        }
      );

      if (verifyError) {
        Alert.alert('Verification Failed', verifyError.message || 'Could not verify OTP.');
        return;
      }

      if (!verifyResult?.success) {
        Alert.alert(
          'Invalid OTP',
          verifyResult?.message || 'The code is incorrect or has expired. Please try again.'
        );
        return;
      }

      const now = new Date().toISOString();

      const { error: delError } = await supabase
        .from('deliveries')
        .update({ completed_at: now })
        .eq('delivery_id', deliveryId);
      if (delError) throw delError;

      if (requestId) {
        const { error: reqError } = await supabase
          .from('delivery_requests')
          .update({ delivery_status: 'Completed' })
          .eq('request_id', requestId);
        if (reqError) throw reqError;
      }

      await supabase
        .from('qr_verifications')
        .update({ dropoff_verified: true })
        .eq('delivery_id', deliveryId);

      const { data: escrowData } = await supabase
        .from('escrow_payments')
        .update({ escrow_status: 'Completed' })
        .eq('delivery_id', deliveryId)
        .select('*')
        .single();

      if (escrowData && escrowData.provider_id) {
        const { data: wallet } = await supabase
          .from('provider_wallet')
          .select('*')
          .eq('provider_id', escrowData.provider_id)
          .single();

        if (wallet) {
          await supabase
            .from('provider_wallet')
            .update({ balance: Number(wallet.balance) + Number(escrowData.amount) })
            .eq('wallet_id', wallet.wallet_id);
        }
      }

      await supabase.from('delivery_status_history').insert({
        delivery_id: deliveryId,
        status: 'Delivered',
        updated_at: now,
      });

      Alert.alert(
        '✅ Delivery Complete!',
        'Payment has been released to your wallet.',
        [{ text: 'OK' }]
      );

      closeDeliveryOTPModal();
      await loadData();
    } catch (error: any) {
      Alert.alert('Completion Failed', error.message || 'Could not complete the delivery.');
    } finally {
      setDeliveryOTPVerifying(false);
    }
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

    const channel = supabase
      .channel(`task-realtime-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => {
        runMatching(false);
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` }, () => {
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes', filter: `provider_id=eq.${providerId}` }, () => {
        runMatching(false);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications' }, () => {
        fetchDeliveries(providerId);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_confirmations' }, () => {
        fetchDeliveries(providerId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId]);

  useFocusEffect(
    useCallback(() => {
      setViewTarget(null);
      setShowFullMap(false);
      setActiveTab('all');
      setSearchQuery('');
      loadData();

      return () => {
        StatusBar.setBarStyle('dark-content', true);
      };
    }, [])
  );

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const pulseOpacity = matchingPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
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

  /* ==================================================================== */
  /* Combined list (available + active + completed) for the unified feed   */
  /* ==================================================================== */
  type FeedItem = {
    type: 'available' | 'active' | 'completed';
    key: string;
    request: any;
    delivery?: any;
    created_at: string;
  };

  const feedItems: FeedItem[] = [
    ...pendingRequests.map(r => ({
      type: 'available' as const,
      key: `p-${r.request_id}`,
      request: r,
      created_at: r.created_at || r.scheduled_time || '',
    })),
    ...activeDeliveries.map(d => ({
      type: 'active' as const,
      key: `a-${d.delivery_id}`,
      request: d.delivery_requests,
      delivery: d,
      created_at: d.accepted_at || d.delivery_requests?.created_at || '',
    })),
    ...completedDeliveries.map(d => ({
      type: 'completed' as const,
      key: `c-${d.delivery_id}`,
      request: d.delivery_requests,
      delivery: d,
      created_at: d.completed_at || d.accepted_at || '',
    })),
  ].filter(i => !!i.request);

  const filteredFeed = feedItems
    .filter(item => {
      if (activeTab === 'available') return item.type === 'available';
      if (activeTab === 'active') return item.type === 'active';
      if (activeTab === 'completed') return item.type === 'completed';
      return true;
    })
    .filter(item => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const req = item.request;
      return (
        String(req.request_id).toLowerCase().includes(q) ||
        String(req.pickup_location?.street_address || '').toLowerCase().includes(q) ||
        String(req.dropoff_location?.street_address || '').toLowerCase().includes(q) ||
        String(req.receiver?.receiver_name || '').toLowerCase().includes(q) ||
        String(req.receiver_phone || '').toLowerCase().includes(q) ||
        String(req.cargo?.item_name || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const getTabCount = (tab: string) => {
    if (tab === 'all') return feedItems.length;
    if (tab === 'available') return pendingRequests.length;
    if (tab === 'active') return activeDeliveries.length;
    if (tab === 'completed') return completedDeliveries.length;
    return 0;
  };

  /* ==================================================================== */
  /* List View                                                            */
  /* ==================================================================== */
  const renderTabBar = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarScroll}>
      {(['all', 'available', 'active', 'completed'] as const).map((tab) => {
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

  const renderFeedCard = (item: FeedItem) => {
    const req = item.request;
    const cargo = req.cargo || req.cargo_profiles;
    const receiver = req.receiver;
    const isAvailable = item.type === 'available';
    const isCompleted = item.type === 'completed';
    const pickupVerified = item.delivery ? isPickupVerified(item.delivery) : false;

    const statusLabel = isAvailable
      ? 'Available'
      : isCompleted
        ? 'Completed'
        : pickupVerified
          ? 'In Transit'
          : 'Awaiting Pickup';

    const statusBg = isAvailable
      ? '#FEF3C7'
      : isCompleted
        ? '#DCFCE7'
        : pickupVerified
          ? '#E0F2FE'
          : '#DBEAFE';

    const statusColor = isAvailable
      ? '#D97706'
      : isCompleted
        ? '#166534'
        : pickupVerified
          ? '#0369A1'
          : '#2563EB';

    const statusIcon: any = isAvailable
      ? 'flash'
      : isCompleted
        ? 'checkmark-done-circle'
        : pickupVerified
          ? 'cube-outline'
          : 'time-outline';

    return (
      <TouchableOpacity
        key={item.key}
        style={[
          styles.card,
          isCompleted && styles.completedCard,
          !isCompleted && item.type === 'active' && styles.activeCardStyle,
          isAvailable && styles.pendingCardStyle,
        ]}
        onPress={() => {
          if (item.delivery) setViewTarget(item.delivery);
        }}
        activeOpacity={isAvailable ? 1 : 0.9}
        disabled={isAvailable}
      >
        {/* Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.cardId}>#TASK-{String(req.request_id).padStart(4, '0')}</Text>
            <View style={styles.serviceTypeBadge}>
              <Text style={styles.serviceTypeText}>
                {req.pickup_type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={11} color={statusColor} />
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* Cargo Banner */}
        <View style={styles.cargoBanner}>
          <Ionicons name="cube-outline" size={13} color={ORANGE} />
          <Text style={styles.cargoBannerText} numberOfLines={1}>
            {cargo?.item_name || cargo?.cargo_type || 'Standard Parcel'}
          </Text>
        </View>

        {/* Route Summary */}
        <View style={styles.routeBox}>
          <View style={styles.routeRow}>
            <View style={styles.dotOrange} />
            <Text style={styles.routeAddressText} numberOfLines={1}>
              {req.pickup_location?.street_address || 'Pickup location'}
            </Text>
          </View>
          <View style={styles.routeConnectorLine} />
          <View style={styles.routeRow}>
            <View style={styles.dotDark} />
            <Text style={styles.routeAddressText} numberOfLines={1}>
              {req.dropoff_location?.street_address || 'Dropoff location'}
            </Text>
          </View>
        </View>

        {/* Context row */}
        <View style={styles.cardContextRow}>
          <View style={styles.contextItem}>
            <Ionicons name="calendar-outline" size={11} color="#6B7280" />
            <Text style={styles.contextText}>
              {formatDate(req.created_at, 'MMM d, yyyy')} • {formatDate(req.scheduled_time || req.created_at, 'h:mm a')}
            </Text>
          </View>

          {cargo && (
            <View style={styles.contextItem}>
              <Ionicons name="scale-outline" size={11} color="#6B7280" />
              <Text style={styles.contextText}>{cargo.total_weight_kg || 0} kg</Text>
            </View>
          )}

          {receiver && (
            <View style={styles.contextItem}>
              <Ionicons name="people-outline" size={11} color="#7C3AED" />
              <Text style={styles.contextText} numberOfLines={1}>
                {receiver.receiver_name || 'Receiver'}
              </Text>
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.footerLabel}>EARNINGS</Text>
            <Text style={styles.priceText}>₱{Number(req.estimated_cost || 0).toFixed(2)}</Text>
          </View>

          {isAvailable ? (
            <TouchableOpacity
              style={styles.acceptChip}
              onPress={() => acceptDelivery(req.request_id)}
              activeOpacity={0.9}
            >
              <Ionicons name="checkmark" size={13} color="#FFF" />
              <Text style={styles.acceptChipText}>Accept</Text>
            </TouchableOpacity>
          ) : isCompleted ? (
            <View style={styles.actionBadgeComplete}>
              <Ionicons name="checkmark-circle" size={12} color="#166534" />
              <Text style={styles.actionBadgeCompleteText}>Delivered</Text>
            </View>
          ) : (
            <View style={styles.footerActionsRow}>
              <TouchableOpacity
                style={styles.smallActionBtn}
                onPress={() => setViewTarget(item.delivery)}
                activeOpacity={0.85}
              >
                <Ionicons name="eye-outline" size={14} color="#4B5563" />
              </TouchableOpacity>
              {!pickupVerified ? (
                <TouchableOpacity
                  style={[styles.smallActionBtn, { backgroundColor: '#7C3AED' }]}
                  onPress={() => openVerifyModal(item.delivery)}
                  activeOpacity={0.9}
                >
                  <Ionicons name="qr-code-outline" size={14} color="#FFF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.smallActionBtn, { backgroundColor: '#22C55E' }]}
                  onPress={() => openDeliveryOTPModal(item.delivery)}
                  activeOpacity={0.9}
                >
                  <Ionicons name="shield-checkmark" size={14} color="#FFF" />
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderListView = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.headerSection}>
        <Text style={styles.pageTitle}>My Tasks</Text>
        <Text style={styles.pageSubtitle}>
          {userData?.first_name ? `Hi ${userData.first_name}, ` : ''}
          manage your delivery jobs
        </Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color="#9CA3AF" />
            <TextInput
              placeholder="Search task ID, address, receiver..."
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

      <ScrollView
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={ORANGE}
            colors={[ORANGE]}
          />
        }
      >
        <Animated.View style={{ opacity: listAnim }}>
          {isMatching && (
            <Animated.View style={[styles.matchingStatus, { opacity: pulseOpacity }]}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.matchingStatusText}>Looking for matches...</Text>
            </Animated.View>
          )}

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={ORANGE} />
              <Text style={styles.loadingText}>Loading tasks...</Text>
            </View>
          ) : filteredFeed.length === 0 ? (
            <View style={styles.noResultsContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="briefcase-outline" size={32} color={ORANGE} />
              </View>
              <Text style={styles.noResultsText}>No tasks found</Text>
              <Text style={styles.noResultsSubtext}>
                {feedItems.length === 0
                  ? 'New delivery requests will appear here when they match your route.'
                  : 'Try adjusting your search or tab filter.'}
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
          ) : (
            filteredFeed.map(renderFeedCard)
          )}
          <View style={styles.bottomSpacer} />
        </Animated.View>
      </ScrollView>
    </View>
  );

  /* ==================================================================== */
  /* Detail View                                                          */
  /* ==================================================================== */
  const renderDetailView = () => {
    if (!viewTarget) return null;
    const request = viewTarget.delivery_requests;
    if (!request) return null;
    const cargo = request.cargo;
    const receiver = request.receiver;
    const pickupVerified = isPickupVerified(viewTarget);
    const isCompleted = !!viewTarget.completed_at;

    let stepIndex = 0;
    if (pickupVerified) stepIndex = 2;
    if (isCompleted) stepIndex = 3;

    const statusLabel = isCompleted ? 'Completed' : pickupVerified ? 'In Transit' : 'Awaiting Pickup';
    const statusBg = isCompleted ? '#DCFCE7' : pickupVerified ? '#E0F2FE' : '#DBEAFE';
    const statusColor = isCompleted ? '#166534' : pickupVerified ? '#0369A1' : '#2563EB';
    const statusIcon: any = isCompleted ? 'checkmark-done-circle' : pickupVerified ? 'cube-outline' : 'time-outline';

    return (
      <ScrollView
        contentContainerStyle={styles.detailContainer}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: detailAnim }}>
          {/* Header bar */}
          <View style={styles.detailHeader}>
            <TouchableOpacity
              onPress={() => setViewTarget(null)}
              style={styles.backCircleBtnDetail}
              activeOpacity={0.8}
            >
              <Ionicons name="arrow-back" size={18} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>Task Details</Text>
            <TouchableOpacity
              onPress={() => setShowFullMap(true)}
              style={styles.fullMapBtn}
              activeOpacity={0.8}
            >
              <Ionicons name="map-outline" size={13} color={ORANGE} />
              <Text style={styles.fullMapBtnText}>Map</Text>
            </TouchableOpacity>
          </View>

          {/* Hero tracking & stepper */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.heroTrackingLabel}>TASK ID</Text>
                <Text style={styles.heroTrackingId}>
                  #TASK-{String(request.request_id).padStart(4, '0')}
                </Text>
              </View>
              <View style={[styles.heroStatusBadge, { backgroundColor: statusBg }]}>
                <Ionicons name={statusIcon} size={13} color={statusColor} />
                <Text style={[styles.heroStatusText, { color: statusColor }]}>
                  {statusLabel}
                </Text>
              </View>
            </View>

            <View style={styles.stepperContainer}>
              {[
                { label: 'Accepted', idx: 0 },
                { label: 'Collected', idx: 2 },
                { label: 'Delivered', idx: 3 },
              ].map((step, sIdx, arr) => {
                const isPassed = stepIndex >= step.idx;
                const isCurrent = stepIndex === step.idx;
                return (
                  <View key={sIdx} style={styles.stepItem}>
                    <View style={styles.stepRowIndicator}>
                      <View
                        style={[
                          styles.stepDot,
                          isPassed && styles.stepDotActive,
                          isCurrent && styles.stepDotCurrent,
                        ]}
                      >
                        {isPassed ? (
                          <Ionicons name="checkmark" size={10} color="#FFF" />
                        ) : (
                          <View style={styles.stepInnerDot} />
                        )}
                      </View>
                      {sIdx < arr.length - 1 && (
                        <View
                          style={[
                            styles.stepLine,
                            stepIndex > sIdx && styles.stepLineActive,
                          ]}
                        />
                      )}
                    </View>
                    <Text
                      style={[styles.stepLabel, isCurrent && styles.stepLabelActive]}
                      numberOfLines={1}
                    >
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Completed settlement banner */}
          {isCompleted && (
            <View style={styles.completedReceiptBanner}>
              <View style={styles.completedReceiptHeader}>
                <View style={styles.completedIconCircle}>
                  <Ionicons name="checkmark" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.completedBannerTitle}>Delivered & Settled</Text>
                  <Text style={styles.completedBannerSubtitle}>
                    {viewTarget.completed_at
                      ? formatDateTime(viewTarget.completed_at)
                      : formatDateTime(viewTarget.accepted_at)}
                  </Text>
                </View>
              </View>
              <View style={styles.completedReceiptDivider} />
              <View style={styles.completedFareRow}>
                <Text style={styles.completedFareLabel}>
                  Total Earnings (Escrow Released)
                </Text>
                <Text style={styles.completedFareValue}>
                  ₱{Number(request.estimated_cost || 0).toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          {/* Package & Fare Summary */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="cube-outline" size={15} color={ORANGE} />
              <Text style={styles.sectionHeaderTitle}>PACKAGE & FARE SUMMARY</Text>
            </View>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Cargo Item</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>
                  {cargo?.item_name || cargo?.cargo_type || 'Standard Parcel'}
                </Text>
              </View>
              <View style={styles.summaryDividerVertical} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Weight</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>
                  {cargo?.total_weight_kg ?? 0} kg
                </Text>
              </View>
              <View style={styles.summaryDividerVertical} />
              <View style={styles.summaryCol}>
                <Text style={styles.summaryLabel}>Earnings</Text>
                <Text style={[styles.summaryValue, { color: ORANGE }]} numberOfLines={1}>
                  ₱{Number(request.estimated_cost || 0).toFixed(2)}
                </Text>
              </View>
            </View>
          </View>

          {/* Pickup verify card */}
          {!isCompleted && !pickupVerified && (
            <TouchableOpacity
              style={styles.pickupQRCard}
              onPress={() => openVerifyModal(viewTarget)}
              activeOpacity={0.9}
            >
              <View style={styles.pickupQRIconBox}>
                <Ionicons name="qr-code" size={20} color="#FFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pickupQRTitle}>Verify Pickup</Text>
                <Text style={styles.pickupQRDesc}>
                  Scan sender QR or enter 4-digit PIN
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#FFF" />
            </TouchableOpacity>
          )}

          {/* Complete delivery card */}
          {!isCompleted && pickupVerified && (
            <TouchableOpacity
              style={styles.deliveryOTPCard}
              onPress={() => openDeliveryOTPModal(viewTarget)}
              activeOpacity={0.9}
            >
              <View style={styles.deliveryOTPHeader}>
                <View style={styles.deliveryOTPIconBox}>
                  <Ionicons name="shield-checkmark" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deliveryOTPTitle}>Complete Delivery</Text>
                  <Text style={styles.deliveryOTPSubtitle} numberOfLines={1}>
                    Ask receiver for 6-digit OTP to release payment
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#16A34A" />
              </View>
            </TouchableOpacity>
          )}

          {/* Map preview */}
          <TouchableOpacity
            style={styles.detailMapCard}
            activeOpacity={0.9}
            onPress={() => setShowFullMap(true)}
          >
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <TaskRouteMap
                pickupLat={request.pickup_location?.latitude}
                pickupLng={request.pickup_location?.longitude}
                dropoffLat={request.dropoff_location?.latitude}
                dropoffLng={request.dropoff_location?.longitude}
                zoom={12}
                interactive={false}
              />
            </View>
            <View style={styles.mapOverlayPill}>
              <Ionicons name="navigate" size={11} color={ORANGE} />
              <Text style={styles.overlayPillText}>
                {isCompleted ? 'Fulfilled Route' : 'Route Preview'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Route timeline */}
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
                  <Text style={styles.routeMain}>
                    {request.pickup_location?.street_address || 'N/A'}
                  </Text>
                </View>
              </View>
              <View style={styles.routeItem}>
                <View style={styles.routeIconWrapper}>
                  <View style={styles.dotDark} />
                </View>
                <View style={styles.routeTextWrapper}>
                  <Text style={styles.routeLabel}>DROPOFF LOCATION</Text>
                  <Text style={styles.routeMain}>
                    {request.dropoff_location?.street_address || 'N/A'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Receiver card */}
          {receiver && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Ionicons name="person-outline" size={15} color="#7C3AED" />
                <Text style={[styles.sectionHeaderTitle, { color: '#7C3AED' }]}>
                  RECEIVER
                </Text>
              </View>
              <View style={styles.receiverCardRow}>
                <View style={styles.receiverAvatar}>
                  <Text style={styles.receiverAvatarText}>
                    {(receiver.receiver_name || 'R').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.receiverInfo}>
                  <Text style={styles.receiverName} numberOfLines={1}>
                    {receiver.receiver_name || 'Receiver'}
                  </Text>
                  <Text style={styles.receiverPhone}>
                    {request.receiver_phone || '—'}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* Timeline history */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="time-outline" size={15} color="#6B7280" />
              <Text style={[styles.sectionHeaderTitle, { color: '#6B7280' }]}>
                TIMELINE
              </Text>
            </View>
            <View style={styles.viewTimelineRow}>
              <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              <View style={{ flex: 1 }}>
                <Text style={styles.viewTimelineTitle}>Accepted</Text>
                <Text style={styles.viewTimelineTime}>
                  {formatDateTime(viewTarget.accepted_at)}
                </Text>
              </View>
            </View>
            <View style={styles.viewTimelineRow}>
              <Ionicons
                name={pickupVerified ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={pickupVerified ? '#8B5CF6' : '#D1D5DB'}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.viewTimelineTitle,
                    !pickupVerified && { color: '#9CA3AF' },
                  ]}
                >
                  Item Collected
                </Text>
                <Text style={styles.viewTimelineTime}>
                  {pickupVerified ? 'Verified' : 'Waiting for pickup verification'}
                </Text>
              </View>
            </View>
            <View style={styles.viewTimelineRow}>
              <Ionicons
                name={isCompleted ? 'checkmark-circle' : 'ellipse-outline'}
                size={18}
                color={isCompleted ? '#22C55E' : '#D1D5DB'}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.viewTimelineTitle,
                    !isCompleted && { color: '#9CA3AF' },
                  ]}
                >
                  Delivered
                </Text>
                <Text style={styles.viewTimelineTime}>
                  {isCompleted && viewTarget.completed_at
                    ? formatDateTime(viewTarget.completed_at)
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
        </Animated.View>
      </ScrollView>
    );
  };

  /* ==================================================================== */
  /* Full Map View                                                        */
  /* ==================================================================== */
  const renderFullMapView = () => {
    if (!viewTarget) return null;
    const request = viewTarget.delivery_requests;
    if (!request) return null;
    return (
      <View style={styles.fullMapContainer}>
        <TaskRouteMap
          pickupLat={request.pickup_location?.latitude}
          pickupLng={request.pickup_location?.longitude}
          dropoffLat={request.dropoff_location?.latitude}
          dropoffLng={request.dropoff_location?.longitude}
          zoom={12}
          interactive={true}
        />
        <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
          <TouchableOpacity
            style={styles.backCircleBtn}
            onPress={() => setShowFullMap(false)}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={18} color="#111827" />
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>
              {viewTarget.completed_at
                ? 'Completed'
                : isPickupVerified(viewTarget)
                  ? 'In Transit'
                  : 'Awaiting Pickup'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  /* ==================================================================== */
  /* Scanner Modal                                                        */
  /* ==================================================================== */
  const renderScannerModal = () => (
    <Modal
      visible={verifyModalVisible}
      animationType="slide"
      transparent={false}
      onRequestClose={closeVerifyModal}
    >
      <View style={styles.scannerRoot}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {cameraPermission?.granted && (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={!scanned ? handleBarcodeScanned : undefined}
          />
        )}

        <View style={[StyleSheet.absoluteFill, { zIndex: 10 }]} pointerEvents="none">
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
          <View style={{ flexDirection: 'row', height: frameSize }}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
            <View
              style={{
                width: frameSize,
                height: frameSize,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <Animated.View
                style={[styles.scanLine, { transform: [{ translateY: scanLineY }] }]}
              />
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' }} />
          </View>
          <View style={{ flex: 2.2, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        </View>

        <View style={[styles.scannerTopBar, { paddingTop: insets.top + 10, zIndex: 20 }]}>
          <TouchableOpacity style={styles.scannerCloseBtn} onPress={closeVerifyModal}>
            <Ionicons name="close" size={24} color="#FFF" />
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.scannerBottomSheet,
            { paddingBottom: insets.bottom + 24, zIndex: 20 },
          ]}
        >
          <View style={styles.sheetHandle} />

          <Text style={styles.sheetHeading}>Scan Pickup QR</Text>
          <Text style={styles.sheetSubheading}>
            Point your camera at the sender's screen to automatically verify pickup.
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
              style={[
                styles.pinBtn,
                (pinInput.length !== 4 || pinVerifying) && { opacity: 0.5 },
              ]}
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

  /* ==================================================================== */
  /* Delivery OTP Modal                                                   */
  /* ==================================================================== */
  const renderDeliveryOTPModal = () => (
    <Modal
      visible={deliveryOTPModalVisible}
      transparent
      animationType="slide"
      onRequestClose={closeDeliveryOTPModal}
    >
      <View style={styles.otpModalOverlay}>
        <View style={styles.otpModalCard}>
          <View style={styles.otpModalHeader}>
            <View style={styles.otpModalIconBox}>
              <Ionicons name="shield-checkmark" size={24} color="#22C55E" />
            </View>
            <TouchableOpacity onPress={closeDeliveryOTPModal}>
              <Ionicons name="close" size={24} color="#111827" />
            </TouchableOpacity>
          </View>

          <Text style={styles.otpModalTitle}>Confirm Delivery</Text>
          <Text style={styles.otpModalSubtitle}>
            Ask the receiver for the 6-digit OTP sent to their phone. Verifying will release payment to your wallet.
          </Text>

          <View style={styles.otpInputContainer}>
            <TextInput
              style={styles.otpInput}
              value={deliveryOTPInput}
              onChangeText={(t) =>
                setDeliveryOTPInput(t.replace(/[^0-9]/g, '').slice(0, 6))
              }
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor="#9CA3AF"
              maxLength={6}
            />
          </View>

          <View style={styles.otpInfoBox}>
            <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
            <Text style={styles.otpInfoText} numberOfLines={2}>
              Delivery #{deliveryOTPTarget?.delivery_id} • Receiver:{' '}
              {deliveryOTPTarget?.delivery_requests?.receiver_phone ||
                deliveryOTPTarget?.delivery_requests?.receiver?.receiver_phone ||
                'N/A'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.otpVerifyButton,
              (deliveryOTPInput.length !== 6 || deliveryOTPVerifying) &&
                styles.otpVerifyButtonDisabled,
            ]}
            disabled={deliveryOTPInput.length !== 6 || deliveryOTPVerifying}
            onPress={completeDelivery}
            activeOpacity={0.9}
          >
            {deliveryOTPVerifying ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                <Text style={styles.otpVerifyButtonText}>Verify & Complete</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.otpResendButton}
            onPress={handleResendDeliveryOTP}
            disabled={deliveryOTPResending}
            activeOpacity={0.85}
          >
            {deliveryOTPResending ? (
              <ActivityIndicator size="small" color="#6B7280" />
            ) : (
              <>
                <Ionicons name="refresh" size={14} color="#6B7280" />
                <Text style={styles.otpResendText}>Send New OTP</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  /* ==================================================================== */
  /* Root render                                                          */
  /* ==================================================================== */
  return (
    <SafeAreaView
      style={styles.container}
      edges={showFullMap ? [] : ['top']}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      {showFullMap && viewTarget
        ? renderFullMapView()
        : viewTarget
          ? renderDetailView()
          : renderListView()}
      {renderScannerModal()}
      {renderDeliveryOTPModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },

  /* ---------- List header ---------- */
  headerSection: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 16,
  },
  searchRow: { marginBottom: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827', padding: 0 },

  tabBarScroll: { gap: 6, paddingTop: 14, paddingBottom: 2 },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  tabItemActive: { backgroundColor: '#FFF7ED', borderColor: ORANGE },
  tabText: { fontSize: 12, fontWeight: '700', color: '#4B5563' },
  tabTextActive: { color: ORANGE },
  tabCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabCountBadgeActive: { backgroundColor: 'rgba(255, 117, 31, 0.15)' },
  tabCountText: { fontSize: 10, fontWeight: '800', color: '#4B5563' },
  tabCountTextActive: { color: ORANGE },

  /* ---------- List body ---------- */
  listContainer: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 16 },
  bottomSpacer: { height: 80 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 50 },
  loadingText: { fontSize: 12, color: '#6B7280', marginTop: 8, fontWeight: '500' },
  noResultsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  noResultsText: { fontSize: 15, fontWeight: '800', color: '#111827' },
  noResultsSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 3,
    textAlign: 'center',
  },
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
  matchingStatusText: { fontSize: 13, color: ORANGE, fontWeight: '700' },
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

  /* ---------- Cards ---------- */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  completedCard: { backgroundColor: '#FAFAF9', borderColor: '#D1D5DB' },
  activeCardStyle: { borderLeftWidth: 4, borderLeftColor: '#7C3AED' },
  pendingCardStyle: { borderLeftWidth: 4, borderLeftColor: '#D97706' },

  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingRight: 8,
  },
  cardId: { fontSize: 11, fontWeight: '800', color: '#111827' },
  serviceTypeBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  serviceTypeText: { fontSize: 9, fontWeight: '700', color: '#4B5563' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
  },
  statusBadgeText: { fontSize: 9, fontWeight: '800' },

  cargoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  cargoBannerText: { fontSize: 11, fontWeight: '700', color: '#9A3412', flex: 1 },

  routeBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    gap: 6,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  routeConnectorLine: {
    width: 1,
    height: 12,
    backgroundColor: '#D1D5DB',
    marginLeft: 3,
  },
  routeAddressText: { fontSize: 12, fontWeight: '700', color: '#111827', flex: 1 },

  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#111827' },

  cardContextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  contextItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contextText: { fontSize: 10, color: '#6B7280', fontWeight: '600' },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  footerLabel: { fontSize: 8, color: '#9CA3AF', fontWeight: '800', letterSpacing: 0.5 },
  priceText: { fontSize: 14, fontWeight: '800', color: '#111827' },

  acceptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  acceptChipText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  actionBadgeComplete: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  actionBadgeCompleteText: { fontSize: 11, fontWeight: '800', color: '#166534' },
  footerActionsRow: { flexDirection: 'row', gap: 6 },
  smallActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ---------- Detail view ---------- */
  detailContainer: { paddingHorizontal: 20, paddingBottom: 40, paddingTop: 10 },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  backCircleBtnDetail: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  detailHeaderTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
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
  fullMapBtnText: { fontSize: 11, color: ORANGE, fontWeight: '800' },

  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroTrackingLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: '#9CA3AF',
    letterSpacing: 0.8,
  },
  heroTrackingId: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    marginTop: 2,
  },
  heroStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 5,
  },
  heroStatusText: { fontSize: 11, fontWeight: '800' },

  stepperContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
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
    width: 18,
    height: 18,
    borderRadius: 9,
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
  stepInnerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF' },
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
    fontSize: 9,
    fontWeight: '700',
    color: '#9CA3AF',
    marginTop: 6,
    textAlign: 'center',
  },
  stepLabelActive: { color: ORANGE, fontWeight: '900' },

  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  sectionHeaderTitle: {
    fontSize: 9,
    fontWeight: '900',
    color: ORANGE,
    letterSpacing: 0.8,
  },

  summaryGrid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryCol: { flex: 1, alignItems: 'center' },
  summaryDividerVertical: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 4,
  },
  summaryLabel: { fontSize: 9, color: '#6B7280', fontWeight: '600', marginBottom: 2 },
  summaryValue: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '800',
    textAlign: 'center',
  },

  completedReceiptBanner: {
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  completedReceiptHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  completedIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  completedBannerTitle: { fontSize: 13, fontWeight: '800', color: '#166534' },
  completedBannerSubtitle: { fontSize: 10, color: '#4B5563', fontWeight: '500' },
  completedReceiptDivider: { height: 1, backgroundColor: '#BBF7D0', marginVertical: 10 },
  completedFareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  completedFareLabel: { fontSize: 11, fontWeight: '700', color: '#166534' },
  completedFareValue: { fontSize: 14, fontWeight: '900', color: '#166534' },

  pickupQRCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  pickupQRIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickupQRTitle: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  pickupQRDesc: { color: '#E9D5FF', fontSize: 10, marginTop: 1 },

  deliveryOTPCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  deliveryOTPHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deliveryOTPIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  deliveryOTPTitle: { fontSize: 13, fontWeight: '800', color: '#166534' },
  deliveryOTPSubtitle: { fontSize: 10, color: '#16A34A', marginTop: 1 },

  detailMapCard: {
    width: '100%',
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  mapOverlayPill: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  overlayPillText: { fontSize: 10, fontWeight: '700', color: '#111827' },

  routeTimeline: { gap: 2, paddingLeft: 4 },
  routeItem: { flexDirection: 'row', alignItems: 'flex-start' },
  routeIconWrapper: {
    width: 16,
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  routeLine: {
    width: 1,
    height: 32,
    backgroundColor: '#E5E7EB',
    marginVertical: 2,
  },
  routeTextWrapper: { flex: 1, paddingBottom: 12 },
  routeLabel: {
    fontSize: 8,
    fontWeight: '900',
    color: ORANGE,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  routeMain: { fontSize: 12, fontWeight: '800', color: '#111827' },

  receiverCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  receiverAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#7C3AED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  receiverAvatarText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  receiverInfo: { flex: 1 },
  receiverName: { fontSize: 13, fontWeight: '800', color: '#111827' },
  receiverPhone: { fontSize: 11, color: '#6B7280', fontWeight: '600', marginTop: 2 },

  viewTimelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  viewTimelineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  viewTimelineTime: { fontSize: 11, color: '#6B7280' },

  viewEarningsCard: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewEarningsLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  viewEarningsValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },

  /* ---------- Full map ---------- */
  fullMapContainer: { flex: 1 },
  topOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statusPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  statusPillText: { fontSize: 11, fontWeight: '700', color: '#111827' },

  /* ---------- Scanner modal ---------- */
  scannerRoot: { flex: 1, backgroundColor: '#000' },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 5, borderLeftWidth: 5, borderTopLeftRadius: 16 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 5, borderRightWidth: 5, borderTopRightRadius: 16 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 5, borderLeftWidth: 5, borderBottomLeftRadius: 16 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 5, borderRightWidth: 5, borderBottomRightRadius: 16 },
  scannerTopBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  scannerCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerBottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
    marginBottom: 18,
  },
  sheetHeading: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 4 },
  sheetSubheading: { fontSize: 13, color: '#6B7280', marginBottom: 16, lineHeight: 18 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  orText: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1.2 },
  pinRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pinInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    letterSpacing: 6,
    color: '#111827',
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: '#F9FAFB',
  },
  pinBtn: {
    backgroundColor: ORANGE,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: 14,
    alignItems: 'center',
    minWidth: 100,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  pinBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  /* ---------- Delivery OTP modal ---------- */
  otpModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  otpModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
  },
  otpModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  otpModalIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  otpModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  otpModalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 19,
    marginBottom: 20,
  },
  otpInputContainer: { marginBottom: 16 },
  otpInput: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    fontSize: 28,
    letterSpacing: 12,
    color: '#111827',
    fontWeight: '800',
    textAlign: 'center',
    backgroundColor: '#F9FAFB',
  },
  otpInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 20,
  },
  otpInfoText: { flex: 1, fontSize: 11, color: '#6B7280', fontWeight: '500' },
  otpVerifyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    marginBottom: 12,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  otpVerifyButtonDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0, elevation: 0 },
  otpVerifyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  otpResendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  otpResendText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
});