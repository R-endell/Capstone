// src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, StatusBar,
  Alert, Easing, ScrollView, Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import { supabase } from '../../../../utils/supabase';

const { height } = Dimensions.get('window');
const ORANGE = '#F27024';
const SEND_NOW_WINDOW_MINUTES = 5;
const MANILA_OFFSET_HOURS = 8;
const SEARCH_DURATION_MS = 60000;

const SHOW_ANIMATION_SWITCHER = false;
const ANIMATION_STYLES = [
  { key: 'radar', label: 'Radar' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'combined', label: 'Combo' },
] as const;
type FindingAnimation = typeof ANIMATION_STYLES[number]['key'];
const DEFAULT_FINDING_ANIMATION: FindingAnimation = 'radar';

const FINDING_STATUS_MESSAGES = [
  'Locating nearby delivery partners...',
  'Matching cargo capacity and vehicle type...',
  'Broadcasting your request to available riders...',
  'Pinging riders in your immediate area...',
  'Optimizing delivery route for best fare...',
  'Checking availability of nearby drivers...',
  'Notifying top-rated riders nearby...',
  'Almost there, waiting for a response...',
  'Expanding search radius for more options...',
  'Still searching, please hold on...',
  'Coordinating logistics with local partners...',
  'Waiting for a rider to accept your booking...',
];

const searchStartTimes = new Map<number, number>();

const parseManilaNaive = (naive: string): number => {
  const m = String(naive).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10) - MANILA_OFFSET_HOURS,
    parseInt(mi, 10),
    parseInt(s || '0', 10),
  );
};

const nowManilaNaive = (): string => {
  const now = new Date();
  const manila = new Date(now.getTime() + MANILA_OFFSET_HOURS * 60 * 60 * 1000);
  const y = manila.getUTCFullYear();
  const m = String(manila.getUTCMonth() + 1).padStart(2, '0');
  const d = String(manila.getUTCDate()).padStart(2, '0');
  const hh = String(manila.getUTCHours()).padStart(2, '0');
  const mm = String(manila.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
};

export default function BookingScreen({ route, navigation }: any) {
  const { mode: routeMode } = route.params || {};
  const { state, dispatch } = useSchedule();
  const mode = routeMode || state.mode;
  const insets = useSafeAreaInsets();

  const [bookingState, setBookingState] = useState<'review' | 'finding' | 'matched' | 'no_match'>('review');
  const [matchFound, setMatchFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [providerData, setProviderData] = useState<any>(null);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);

  const resumeRequestId: number | undefined = route.params?.requestId ?? route.params?.request_id;
  const isResume = !!route.params?.resume && !!resumeRequestId;
  const [resumeInfo, setResumeInfo] = useState<any>(null);
  const [resumeSubId, setResumeSubId] = useState<number | null>(null);
  const resumedRef = useRef<number | null>(null);
  const resumeReceiverRef = useRef<any>(null);
  const searchStartRef = useRef<number | null>(null);

  const [longSearch, setLongSearch] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [animStyle, setAnimStyle] = useState<FindingAnimation>(DEFAULT_FINDING_ANIMATION);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const travelAnim = useRef(new Animated.Value(0)).current;
  const bobAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const radarAnim1 = useRef(new Animated.Value(0)).current;
  const radarAnim2 = useRef(new Animated.Value(0)).current;
  const radarAnim3 = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const isResumedSession = useRef(false);
  const matchChannelRef = useRef<any>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [receiver, setReceiver] = useState<any>(state.receiver || null);

  useEffect(() => {
    if (state.receiver) setReceiver(state.receiver);
  }, [state.receiver]);

  useEffect(() => {
    sheetAnim.setValue(0);
    Animated.timing(sheetAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bookingState, sheetAnim]);

  useEffect(() => {
    if (bookingState === 'finding') {
      setIsSearching(true);

      const startedAt = searchStartRef.current ?? Date.now();
      searchStartRef.current = startedAt;
      const elapsed = Math.max(0, Date.now() - startedAt);
      const remaining = Math.max(SEARCH_DURATION_MS - elapsed, 0);
      progressAnim.setValue(Math.min(elapsed / SEARCH_DURATION_MS, 1));
      setLongSearch(remaining === 0);
      let longSearchTimer: ReturnType<typeof setTimeout> | null = null;

      if (remaining > 0) {
        Animated.timing(progressAnim, {
          toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: false,
        }).start();
        longSearchTimer = setTimeout(() => setLongSearch(true), remaining);
      }

      const spinLoop = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 2800, easing: Easing.linear, useNativeDriver: true })
      );
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      spinAnim.setValue(0);
      pulseAnim.setValue(0);
      spinLoop.start();
      pulseLoop.start();
      const dotsTimer = setInterval(() => setDotCount(c => (c + 1) % 4), 450);

      const createRadarWave = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true,
            }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        );

      const r1 = createRadarWave(radarAnim1, 0);
      const r2 = createRadarWave(radarAnim2, 650);
      const r3 = createRadarWave(radarAnim3, 1300);

      r1.start(); r2.start(); r3.start();

      return () => {
        r1.stop(); r2.stop(); r3.stop();
        spinLoop.stop(); pulseLoop.stop();
        progressAnim.stopAnimation();
        clearInterval(dotsTimer);
        if (longSearchTimer) clearTimeout(longSearchTimer);
      };
    }
  }, [bookingState, radarAnim1, radarAnim2, radarAnim3, progressAnim, spinAnim, pulseAnim]);

  useEffect(() => {
    if (bookingState !== 'finding') return;

    setStatusIndex(0);
    textAnim.setValue(1);

    const timer = setInterval(() => {
      Animated.timing(textAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setStatusIndex(i => (i + 1) % FINDING_STATUS_MESSAGES.length);
        Animated.timing(textAnim, {
          toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }).start();
      });
    }, 4000);

    return () => {
      clearInterval(timer);
      textAnim.stopAnimation();
    };
  }, [bookingState, textAnim]);

  const cycleAnimStyle = () => {
    setAnimStyle(cur => {
      const i = ANIMATION_STYLES.findIndex(a => a.key === cur);
      return ANIMATION_STYLES[(i + 1) % ANIMATION_STYLES.length].key;
    });
  };

  const startMatching = async () => {
    try {
      if (!receiver?.receiver_id && !receiver?.receiver_phone) {
        Alert.alert('Required', 'Please select a receiver before booking.');
        return;
      }

      let savedRequest;
      if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        savedRequest = { request_id: state.editIds.requestId };
      } else {
        savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
      }

      if (!savedRequest) throw new Error('Failed to save request');
      setSavedRequestId(savedRequest.request_id);
      searchStartTimes.set(savedRequest.request_id, searchStartRef.current ?? Date.now());

      const matchChannel = supabase
        .channel(`match-listener-${savedRequest.request_id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${savedRequest.request_id}` },
          async (payload) => {
            const delivery = payload.new;

            const { data: provider } = await supabase
              .from('users')
              .select('first_name, last_name, phone_number')
              .eq('user_id', delivery.provider_id)
              .single();
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('vehicle_type, plate_number, max_weight_kg')
              .eq('vehicle_id', delivery.vehicle_id)
              .single();

            if (provider && vehicle) setProviderData({ ...provider, ...vehicle });

            // NOTE: OTP is no longer sent at booking time. The sender will
            // generate and forward the delivery OTP from ActivityScreen after
            // the courier scans the pickup QR / enters the PIN.

            setMatchFound(true);
            setBookingState('matched');
            setIsSearching(false);

            if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
            supabase.removeChannel(matchChannel);
          }
        )
        .subscribe();

      matchChannelRef.current = matchChannel;

      searchTimeoutRef.current = setTimeout(() => {
        if (bookingState === 'finding') {
          setBookingState('no_match');
          setIsSearching(false);
          supabase.removeChannel(matchChannel);
        }
      }, SEARCH_DURATION_MS);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to process your booking. Please try again.');
      setBookingState('review');
    }
  };

  const loadProviderForDelivery = async (delivery: any) => {
    const { data: provider } = await supabase
      .from('users')
      .select('first_name, last_name, phone_number')
      .eq('user_id', delivery.provider_id)
      .single();
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('vehicle_type, plate_number, max_weight_kg')
      .eq('vehicle_id', delivery.vehicle_id)
      .single();
    if (provider && vehicle) setProviderData({ ...provider, ...vehicle });
  };

  const resumeBooking = async (requestId: number) => {
    if (savedRequestId === requestId && bookingState !== 'review') return;
    try {
      const { data: req, error } = await supabase
        .from('delivery_requests')
        .select(`*, pickup_location:locations!delivery_requests_pickup_location_id_fkey (*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (*), receiver:receivers!delivery_requests_receiver_id_fkey (receiver_id, receiver_name, receiver_phone, receiver_email, is_favorite)`)
        .eq('request_id', requestId)
        .maybeSingle();
      if (error) throw error;
      if (!req) {
        Alert.alert('Order not found', 'This delivery request no longer exists.');
        navigation.goBack();
        return;
      }

      isResumedSession.current = true;
      setSavedRequestId(requestId);

      setResumeInfo({
        pickupLocation: { address: req.pickup_location?.street_address, latitude: req.pickup_location?.latitude ?? null, longitude: req.pickup_location?.longitude ?? null },
        dropoffLocation: { address: req.dropoff_location?.street_address, latitude: req.dropoff_location?.latitude ?? null, longitude: req.dropoff_location?.longitude ?? null },
        estimatedCost: Number(req.estimated_cost) || 0,
      });

      const rcv = req.receiver
        ? { receiver_id: req.receiver.receiver_id ?? req.receiver_id ?? null, receiver_name: req.receiver.receiver_name ?? null, receiver_phone: req.receiver.receiver_phone ?? req.receiver_phone ?? '', receiver_email: req.receiver.receiver_email ?? null, is_favorite: req.receiver.is_favorite ?? false }
        : req.receiver_phone ? { receiver_id: req.receiver_id ?? null, receiver_name: null, receiver_phone: req.receiver_phone } : null;

      resumeReceiverRef.current = rcv;
      if (rcv) setReceiver(rcv);

      const { data: delivery } = await supabase.from('deliveries').select('*').eq('request_id', requestId).order('accepted_at', { ascending: false }).limit(1).maybeSingle();

      if (delivery) {
        await loadProviderForDelivery(delivery);
        // NOTE: OTP generation happens later, from ActivityScreen, once pickup is verified.
        setMatchFound(true);
        setIsSearching(false);
        setBookingState('matched');
        return;
      }

      if (req.delivery_status !== 'Pending') {
        Alert.alert('Order updated', `This order is now ${req.delivery_status}.`);
        navigation.goBack();
        return;
      }

      const createdMs = req.created_at ? new Date(req.created_at).getTime() : NaN;
      searchStartRef.current = searchStartTimes.get(requestId) ?? (!isNaN(createdMs) ? createdMs : Date.now());
      setResumeSubId(requestId);
      setBookingState('finding');
    } catch (err: any) {
      Alert.alert('Error', 'Could not load this order.');
      navigation.goBack();
    }
  };

  useEffect(() => {
    if (!isResume || !resumeRequestId) return;
    if (resumedRef.current === resumeRequestId) return;
    resumedRef.current = resumeRequestId;
    resumeBooking(resumeRequestId);
  }, [isResume, resumeRequestId]);

  useEffect(() => {
    if (bookingState !== 'finding' || !resumeSubId) return;
    const requestId = resumeSubId;

    supabase.getChannels().filter((c: any) => c.topic === `realtime:match-listener-${requestId}`).forEach((c: any) => supabase.removeChannel(c));

    const channel = supabase
      .channel(`match-listener-${requestId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${requestId}` },
        async (payload) => {
          const delivery = payload.new;
          await loadProviderForDelivery(delivery);
          // NOTE: OTP generation happens later, from ActivityScreen, once pickup is verified.
          setMatchFound(true);
          setBookingState('matched');
          setIsSearching(false);
          supabase.removeChannel(channel);
        }
      )
      .subscribe();

    matchChannelRef.current = channel;
  }, [bookingState, resumeSubId]);

  const handleBook = () => {
    if (!receiver?.receiver_id && !receiver?.receiver_phone) {
      Alert.alert('Receiver Required', 'Please select who will receive this package before booking.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Select Receiver', onPress: handleSelectReceiver },
      ]);
      return;
    }

    if (mode === 'sendNow' && state.scheduledDate) {
      const scheduledMs = parseManilaNaive(String(state.scheduledDate));
      const nowMs = parseManilaNaive(nowManilaNaive());
      if (!isNaN(scheduledMs) && !isNaN(nowMs)) {
        const diffMinutes = Math.abs(scheduledMs - nowMs) / 60000;
        if (diffMinutes > SEND_NOW_WINDOW_MINUTES) {
          Alert.alert('Schedule Too Far', `Send Now requests must be scheduled within ${SEND_NOW_WINDOW_MINUTES} minutes.\n\nYour request is ${Math.round(diffMinutes)} minutes away.`, [
            { text: 'Edit Schedule', onPress: () => navigation.goBack() },
            { text: 'Cancel', style: 'cancel' },
          ]);
          return;
        }
      }
    }

    searchStartRef.current = Date.now();
    setBookingState('finding');
    startMatching();
  };

  const handleCancelBooking = async () => {
    if (matchChannelRef.current) supabase.removeChannel(matchChannelRef.current);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (savedRequestId) {
      await supabase.from('delivery_requests').delete().eq('request_id', savedRequestId);
    }
    setResumeSubId(null);

    if (isResumedSession.current) {
      isResumedSession.current = false;
      navigation.goBack();
      return;
    }
    setBookingState('review');
  };

  const handleConfirmAction = () => {
    dispatch({ type: 'RESET' });
    navigation.navigate('MainTabs');
  };

  const handleSelectReceiver = () => {
    navigation.navigate('ReceiverPicker', {
      selectedReceiverId: receiver?.receiver_id || null,
    });
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const picked = route.params?.pickedReceiver;
      if (picked) {
        setReceiver(picked);
        dispatch({ type: 'SET_INITIAL_STATE', payload: { ...state, receiver: picked } as any });
        navigation.setParams({ pickedReceiver: undefined });
      }
    });
    return unsubscribe;
  }, [navigation, route.params?.pickedReceiver]);

  const parseAddress = (fullAddress: string | undefined) => {
    if (!fullAddress) return { main: 'Selected Location', sub: 'Coordinates' };
    const parts = fullAddress.split(', ');
    return { main: parts[0], sub: parts.slice(1).join(', ') || fullAddress };
  };

  const viewPickupLocation = resumeInfo?.pickupLocation ?? state.pickupLocation;
  const viewDropoffLocation = resumeInfo?.dropoffLocation ?? state.dropoffLocation;
  const displayCost: number | undefined = resumeInfo?.estimatedCost ?? state.estimatedCost;

  const pickup = parseAddress(viewPickupLocation?.address);
  const dropoff = parseAddress(viewDropoffLocation?.address);

  const pickupLat = viewPickupLocation?.latitude ?? null;
  const pickupLng = viewPickupLocation?.longitude ?? null;
  const dropoffLat = viewDropoffLocation?.latitude ?? null;
  const dropoffLng = viewDropoffLocation?.longitude ?? null;

  const sheetFadeUp = {
    opacity: sheetAnim,
    transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  const mapTopPad = Math.round(insets.top + 120);
  const mapBottomPad = 320;

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { height: 100vh; width: 100vw; background: #E5E7EB; }
          .marker-pickup { background: #F27024; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
          .marker-dropoff { background: #111827; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; color: white; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var pickupLat = ${pickupLat === null ? 'null' : pickupLat};
          var pickupLng = ${pickupLng === null ? 'null' : pickupLng};
          var dropoffLat = ${dropoffLat === null ? 'null' : dropoffLat};
          var dropoffLng = ${dropoffLng === null ? 'null' : dropoffLng};

          var centerLat = (pickupLat !== null) ? pickupLat : ((dropoffLat !== null) ? dropoffLat : 10.3157);
          var centerLng = (pickupLng !== null) ? pickupLng : ((dropoffLng !== null) ? dropoffLng : 123.8854);

          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([centerLat, centerLng], 12);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);

          var pickupIcon = L.divIcon({ className: '', html: '<div class="marker-pickup">P</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
          var dropoffIcon = L.divIcon({ className: '', html: '<div class="marker-dropoff">D</div>', iconSize: [22, 22], iconAnchor: [11, 11] });

          var fitOpts = { paddingTopLeft: [40, ${mapTopPad}], paddingBottomRight: [40, ${mapBottomPad}], maxZoom: 15 };
          var markers = [];
          if (pickupLat !== null && pickupLng !== null) {
            markers.push(L.marker([pickupLat, pickupLng], { icon: pickupIcon }).addTo(map));
          }
          if (dropoffLat !== null && dropoffLng !== null) {
            markers.push(L.marker([dropoffLat, dropoffLng], { icon: dropoffIcon }).addTo(map));
          }

          if (pickupLat !== null && pickupLng !== null && dropoffLat !== null && dropoffLng !== null) {
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
                  var polyline = L.polyline(latlngs, {
                    color: '#F27024', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round'
                  }).addTo(map);
                  map.fitBounds(polyline.getBounds(), fitOpts);
                } else {
                  var group = new L.featureGroup(markers);
                  map.fitBounds(group.getBounds(), fitOpts);
                }
              })
              .catch(function() {
                var group = new L.featureGroup(markers);
                map.fitBounds(group.getBounds(), fitOpts);
              });
          } else if (markers.length > 0) {
            var group = new L.featureGroup(markers);
            map.fitBounds(group.getBounds(), fitOpts);
          }
        </script>
      </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <WebView
        style={styles.map}
        source={{ html: mapHtml }}
        scrollEnabled={false}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        originWhitelist={['*']}
        mixedContentMode="always"
      />

      <View style={[styles.topOverlay, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </TouchableOpacity>

        <View style={styles.pillsContainer}>
          <View style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeIconSlot}>
                <View style={styles.pillIconPickup}>
                  <View style={styles.pillIconPickupInner} />
                </View>
              </View>
              <View style={styles.pillTextContainer}>
                <Text style={styles.pillLabel}>PICKUP</Text>
                <Text numberOfLines={1}>
                  <Text style={styles.pillMainText}>{pickup.main}</Text>
                  <Text style={styles.pillSubText}>{pickup.sub ? `  ${pickup.sub}` : ''}</Text>
                </Text>
              </View>
            </View>
            <View style={styles.routeDivider} />
            <View style={styles.routeRow}>
              <View style={styles.routeIconSlot}>
                <Ionicons name="location" size={18} color="#EF4444" />
              </View>
              <View style={styles.pillTextContainer}>
                <Text style={[styles.pillLabel, { color: '#EF4444' }]}>DROPOFF</Text>
                <Text numberOfLines={1}>
                  <Text style={styles.pillMainText}>{dropoff.main}</Text>
                  <Text style={styles.pillSubText}>{dropoff.sub ? `  ${dropoff.sub}` : ''}</Text>
                </Text>
              </View>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.bottomSheet, bookingState === 'finding' && styles.bottomSheetFinding]}>

        {/* --- REVIEW STATE --- */}
        {bookingState === 'review' && (
          <Animated.View style={[styles.sheetCard, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <View style={styles.sheetIconBox}>
                <Ionicons name="person-outline" size={18} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetHeaderTitle}>Recipient & Delivery</Text>
                <Text style={styles.sheetHeaderSub}>
                  {mode === 'sendNow' ? 'Send now · Immediate pickup' : 'Scheduled delivery'}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={[styles.receiverCard, !receiver && styles.receiverCardEmpty]} onPress={handleSelectReceiver} activeOpacity={0.85}>
              <View style={[styles.receiverIconBox, receiver ? styles.receiverIconBoxFilled : styles.receiverIconBoxEmpty]}>
                <Ionicons name={receiver ? 'person' : 'person-add-outline'} size={18} color={receiver ? '#FFFFFF' : ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.receiverLabel}>DESIGNATED RECEIVER</Text>
                {receiver ? (
                  <>
                    <Text style={styles.receiverName} numberOfLines={1}>
                      {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                    </Text>
                    <Text style={styles.receiverPhone} numberOfLines={1}>
                      {receiver.receiver_phone || receiver.phone_number || '—'}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.receiverPlaceholder}>Tap to select receiver</Text>
                    <Text style={styles.receiverHelper}>Who will receive this package?</Text>
                  </>
                )}
              </View>
              <Ionicons name={receiver ? 'create-outline' : 'chevron-forward'} size={18} color={receiver ? '#6B7280' : ORANGE} />
            </TouchableOpacity>

            {receiver && (
              <View style={styles.otpInfoBanner}>
                <Ionicons name="qr-code-outline" size={14} color="#7C3AED" />
                <Text style={styles.otpInfoBannerText}>
                  When the courier arrives, show your pickup QR code (or read them the 4-digit PIN) to confirm pickup. After that, a delivery OTP will be generated for you to forward to the receiver.
                </Text>
              </View>
            )}

            <View style={styles.divider} />
            <View style={styles.costRow}>
              <View>
                <Text style={styles.costLabel}>Estimated total</Text>
                <Text style={styles.costSub}>Includes delivery & handling</Text>
              </View>
              <Text style={styles.costValue}>₱{displayCost?.toFixed(2) || '0.00'}</Text>
            </View>

            <TouchableOpacity style={[styles.primaryButton, !receiver && styles.primaryButtonDisabled]} onPress={handleBook} activeOpacity={0.9}>
              <Ionicons name={mode === 'sendNow' ? 'flash' : 'calendar'} size={16} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>{mode === 'sendNow' ? 'Book Now' : 'Schedule Delivery'}</Text>
            </TouchableOpacity>

            {!receiver && <Text style={styles.primaryButtonHint}>Select a receiver first to enable booking</Text>}
          </Animated.View>
        )}

        {/* --- FINDING STATE --- */}
        {bookingState === 'finding' && (
          <Animated.View style={[styles.sheetCardFinding, sheetFadeUp]} pointerEvents="box-none">
            <View style={{ width: '100%', alignItems: 'center', paddingTop: 8 }}>
              <View style={styles.sheetHandle} />
            </View>

            <ScrollView
              style={styles.findingScrollView}
              contentContainerStyle={[styles.findingScrollContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
              showsVerticalScrollIndicator={false}
            >

              {/* TWO COLUMN LAYOUT FOR SEARCHING UI - Animation Left, Text Right */}
              <View style={styles.findingTopRow}>
                <View style={styles.radarContainer}>
                  <View style={[styles.radarGuideRing, { width: 56, height: 56, borderRadius: 28 }]} />
                  <View style={[styles.radarGuideRing, { width: 80, height: 80, borderRadius: 40 }]} />

                  {[radarAnim1, radarAnim2, radarAnim3].map((anim, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.radarWaveRing,
                        {
                          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
                          opacity: anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.4 - i * 0.08, 0] }),
                        },
                      ]}
                    />
                  ))}

                  <Animated.View
                    style={[
                      styles.radarHalo,
                      {
                        transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
                        opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.5] }),
                      },
                    ]}
                  />

                  <Animated.View
                    style={[
                      styles.radarCenterCore,
                      { transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] },
                    ]}
                  >
                    <Ionicons name="location" size={16} color="#FFFFFF" />
                  </Animated.View>
                </View>

                <View style={styles.findingTextGroup}>
                  <View style={styles.findingTitleRow}>
                    <Text style={styles.findingTitle}>
                      {longSearch ? 'Still searching' : 'Finding provider'}
                    </Text>
                    <Text style={[styles.findingTitle, styles.findingDots]}>{'.'.repeat(dotCount)}</Text>
                  </View>
                  <Animated.View
                    style={[
                      styles.findingSubWrap,
                      longSearch ? null : {
                        opacity: textAnim,
                        transform: [{ translateY: textAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
                      },
                    ]}
                  >
                    <Text style={styles.findingSub}>
                      {longSearch
                        ? "Taking longer than usual. You can leave this screen — we'll keep looking."
                        : FINDING_STATUS_MESSAGES[statusIndex]}
                    </Text>
                  </Animated.View>
                </View>
              </View>

              {/* DETAILS CARDS BELOW ANIMATION */}
              <View style={styles.findingInfoRow}>
                {receiver && (
                  <View style={styles.searchingReceiverMiniCard}>
                    <View style={styles.searchMiniAvatar}>
                      <Ionicons name="person" size={15} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.searchMiniLabelRow}>
                        <Text style={styles.searchMiniLabel}>RECIPIENT</Text>
                        <Ionicons name="shield-checkmark" size={12} color="#7C3AED" />
                      </View>
                      <Text style={styles.searchMiniName} numberOfLines={1}>
                        {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Receiver'}
                      </Text>
                      <Text style={styles.searchMiniPhone} numberOfLines={1}>
                        {receiver.receiver_phone || receiver.phone_number || 'No Phone'}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={[styles.searchCostOnlyBox, !receiver && { flex: 1 }]}>
                  <Text style={styles.searchCostLabel}>TOTAL FARE</Text>
                  <Text style={styles.searchCostValue}>₱{displayCost?.toFixed(2) || '0.00'}</Text>
                </View>
              </View>

              <View style={styles.progressContainer}>
                <Animated.View
                  style={[
                    styles.progressBar,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>

              <TouchableOpacity style={styles.cancelTextButton} onPress={handleCancelBooking} activeOpacity={0.85}>
                <Ionicons name="close-circle-outline" size={18} color="#EF4444" />
                <Text style={styles.cancelTextButtonLabel}>Cancel Search</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        )}

        {/* --- MATCHED STATE --- */}
        {bookingState === 'matched' && matchFound && (
          <Animated.View style={[styles.sheetCardMatched, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.matchedHeader}>
              <View style={styles.matchedHeaderIcon}>
                <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchedHeaderTitle}>Provider Matched!</Text>
                <Text style={styles.matchedHeaderSub}>Your delivery partner is on the way</Text>
              </View>
            </View>

            <View style={styles.matchedInnerCard}>
              <View style={styles.matchedRow}>
                <View style={styles.matchedLeftCol}>
                  <View style={styles.matchedAvatarCircle}>
                    <Ionicons name="person" size={28} color="#FFFFFF" />
                  </View>
                  <View style={styles.matchedVerifiedBadge}>
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  </View>
                </View>
                <View style={styles.matchedRightCol}>
                  <Text style={styles.matchedName} numberOfLines={1}>
                    {providerData ? `${providerData.first_name} ${providerData.last_name}` : 'Loading...'}
                  </Text>
                  <View style={styles.carDetailBox}>
                    <View style={styles.carDetailRow}>
                      <Ionicons name="car-sport-outline" size={12} color="#6B7280" />
                      <Text style={styles.carText} numberOfLines={1}>{providerData?.vehicle_type || 'Loading...'}</Text>
                    </View>
                    <View style={styles.carDetailRow}>
                      <Ionicons name="pricetag-outline" size={12} color="#6B7280" />
                      <Text style={styles.carText}>{providerData?.plate_number || 'Loading...'}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {receiver && (
                <>
                  <View style={styles.matchedDivider} />
                  <View style={styles.matchedReceiverRow}>
                    <Ionicons name="person-circle-outline" size={16} color="#6B7280" />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={styles.matchedReceiverLabel}>CONFIRMED RECEIVER</Text>
                      <Text style={styles.matchedReceiverName} numberOfLines={1}>
                        {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                      </Text>
                      <Text style={styles.matchedReceiverPhone} numberOfLines={1}>
                        {receiver.receiver_phone || receiver.phone_number || '—'}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              <View style={styles.otpSentBanner}>
                <Ionicons name="qr-code-outline" size={16} color="#22C55E" />
                <Text style={styles.otpSentText}>
                  Show your pickup QR code when the courier arrives
                </Text>
              </View>

              <View style={styles.matchedDivider} />
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₱{displayCost?.toFixed(2)}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmAction} activeOpacity={0.9}>
              <Text style={styles.confirmButtonText}>Confirm & Proceed</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* --- NO MATCH STATE --- */}
        {bookingState === 'no_match' && (
          <Animated.View style={[styles.sheetCardNoMatch, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.noMatchIconCircle}>
              <Ionicons name="cloud-offline-outline" size={36} color={ORANGE} />
            </View>
            <Text style={styles.noMatchTitle}>No Provider Available</Text>
            <Text style={styles.noMatchSubtitle}>
              We couldn't find an available provider on this route right now. Please try again or modify your request.
            </Text>

            <View style={styles.noMatchActions}>
              <TouchableOpacity style={[styles.noMatchBtn, styles.retryBtn]} onPress={() => startMatching()} activeOpacity={0.9}>
                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.noMatchBtn, styles.modifyBtn]} onPress={handleCancelBooking} activeOpacity={0.9}>
                <Ionicons name="create-outline" size={15} color="#6B7280" />
                <Text style={styles.modifyBtnText}>Modify</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  map: { ...StyleSheet.absoluteFill },

  topOverlay: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-start', zIndex: 10 },
  backCircleBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
    marginRight: 10, borderWidth: 1, borderColor: '#E5E7EB',
  },
  pillsContainer: { flex: 1 },
  routeCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
  routeIconSlot: { width: 22, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  routeDivider: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 32 },
  pillIconPickup: {
    width: 16, height: 16, borderRadius: 8, borderWidth: 3,
    borderColor: ORANGE, justifyContent: 'center', alignItems: 'center',
  },
  pillIconPickupInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE },
  pillTextContainer: { flex: 1 },
  pillLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 0.8, marginBottom: 1 },
  pillMainText: { fontSize: 14, fontWeight: '700', color: '#111827', letterSpacing: -0.2 },
  pillSubText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },

  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  bottomSheetFinding: { bottom: 0 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 6 },

  sheetCard: {
    backgroundColor: '#FFFFFF', width: '100%', paddingHorizontal: 24, paddingTop: 6,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 12,
  },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  sheetIconBox: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#FFE4D2',
  },
  sheetHeaderTitle: { fontSize: 15, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  sheetHeaderSub: { fontSize: 11, color: '#6B7280', fontWeight: '500', marginTop: 2 },

  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 12 },

  receiverCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, padding: 14,
  },
  receiverCardEmpty: { borderStyle: 'dashed', borderColor: '#FDBA74', backgroundColor: '#FFFBF5' },
  receiverIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  receiverIconBoxFilled: { backgroundColor: ORANGE },
  receiverIconBoxEmpty: { backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FFE4D2' },
  receiverLabel: { fontSize: 9, fontWeight: '800', color: '#6B7280', letterSpacing: 0.8, marginBottom: 3 },
  receiverName: { fontSize: 14, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  receiverPhone: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '500' },
  receiverPlaceholder: { fontSize: 13, fontWeight: '700', color: ORANGE },
  receiverHelper: { fontSize: 10, color: '#9CA3AF', marginTop: 2, fontWeight: '500' },

  otpInfoBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F5F3FF', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, borderWidth: 1, borderColor: '#DDD6FE',
  },
  otpInfoBannerText: { flex: 1, fontSize: 11, color: '#5B21B6', fontWeight: '600', lineHeight: 15 },

  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  costLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  costSub: { fontSize: 10, color: '#9CA3AF', fontWeight: '500', marginTop: 2 },
  costValue: { fontSize: 20, fontWeight: '800', color: '#111827', letterSpacing: -0.4 },

  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111827', borderRadius: 16, paddingVertical: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  primaryButtonDisabled: { backgroundColor: '#F3F4F6', shadowOpacity: 0, elevation: 0 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  primaryButtonHint: { textAlign: 'center', fontSize: 11, color: '#9CA3AF', marginTop: 8, fontWeight: '500' },

  // Finding Sheet Layout (Two-Column Flow)
  sheetCardFinding: {
    width: '100%', backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1, shadowRadius: 16, elevation: 12,
    maxHeight: height * 0.45,
    minHeight: 320,
  },
  findingScrollView: { flex: 1, width: '100%' },
  findingScrollContent: { paddingHorizontal: 20, paddingTop: 10, alignItems: 'center' },

  // TWO COLUMN STRUCTURE
  findingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 4,
    marginBottom: 16,
  },

  // Scaled Down Radar Animation
  radarContainer: {
    width: 80, height: 80,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 16 // Spacing between animation and text
  },
  radarGuideRing: { position: 'absolute', borderWidth: 1, borderColor: '#FFEDD5' },
  radarWaveRing: {
    position: 'absolute', width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: ORANGE, backgroundColor: 'rgba(242,112,36,0.08)',
  },
  radarHalo: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(242,112,36,0.14)' },
  radarCenterCore: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5, zIndex: 2,
  },

  // Left-aligned Text Group
  findingTextGroup: { flex: 1, alignItems: 'flex-start' },
  findingTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  findingTitle: { fontSize: 17, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  findingDots: { width: 20, textAlign: 'left', color: ORANGE },
  findingSubWrap: { minHeight: 36, justifyContent: 'flex-start' },
  findingSub: { fontSize: 12, lineHeight: 16, color: '#6B7280', fontWeight: '500' },

  findingInfoRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, width: '100%', marginBottom: 12 },
  searchingReceiverMiniCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FFE4D2',
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchMiniAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  searchMiniLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  searchMiniLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 0.8 },
  searchMiniName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  searchMiniPhone: { fontSize: 12, fontWeight: '500', color: '#6B7280', marginTop: 1 },

  searchCostOnlyBox: {
    minWidth: 104, backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center',
  },
  searchCostLabel: { fontSize: 10, fontWeight: '800', color: '#6B7280', letterSpacing: 0.8, marginBottom: 2 },
  searchCostValue: { fontSize: 18, fontWeight: '800', color: '#111827', letterSpacing: -0.4 },

  progressContainer: { width: '100%', height: 5, backgroundColor: '#F3F4F6', borderRadius: 3, marginBottom: 16, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: ORANGE, borderRadius: 3 },

  cancelTextButton: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
  },
  cancelTextButtonLabel: { color: '#EF4444', fontWeight: '700', fontSize: 15 },

  sheetCardMatched: {
    width: '100%', backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingTop: 8,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 12,
  },
  matchedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  matchedHeaderIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#DCFCE7',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#BBF7D0',
  },
  matchedHeaderTitle: { fontSize: 16, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },
  matchedHeaderSub: { fontSize: 11, color: '#6B7280', fontWeight: '500', marginTop: 2 },
  matchedInnerCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, padding: 14, backgroundColor: '#F9FAFB', marginBottom: 14 },
  matchedRow: { flexDirection: 'row', alignItems: 'center' },
  matchedLeftCol: { width: 70, alignItems: 'center', marginRight: 14, position: 'relative' },
  matchedAvatarCircle: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFFFFF', shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  matchedVerifiedBadge: {
    position: 'absolute', bottom: 0, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#22C55E',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFFFFF',
  },
  matchedRightCol: { flex: 1 },
  matchedName: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 6, letterSpacing: -0.2 },
  carDetailBox: { gap: 3 },
  carDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  carText: { fontSize: 11, color: '#6B7280', fontWeight: '600' },
  matchedDivider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 10 },
  matchedReceiverRow: { flexDirection: 'row', alignItems: 'center' },
  matchedReceiverLabel: { fontSize: 9, fontWeight: '800', color: '#6B7280', letterSpacing: 0.8, marginBottom: 2 },
  matchedReceiverName: { fontSize: 13, fontWeight: '700', color: '#111827' },
  matchedReceiverPhone: { fontSize: 11, color: '#6B7280', marginTop: 1, fontWeight: '500' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  totalValue: { fontSize: 18, fontWeight: '800', color: '#111827', letterSpacing: -0.3 },

  confirmButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827', borderRadius: 16,
    paddingVertical: 16, gap: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 4,
  },
  confirmButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  otpSentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#DCFCE7', borderRadius: 12,
    padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#BBF7D0',
  },
  otpSentText: { flex: 1, fontSize: 12, color: '#166534', fontWeight: '600' },

  sheetCardNoMatch: {
    width: '100%', backgroundColor: '#FFFFFF', paddingHorizontal: 24, paddingTop: 8,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 12,
  },
  noMatchIconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center',
    marginBottom: 12, marginTop: 2, borderWidth: 1, borderColor: '#FFE4D2',
  },
  noMatchTitle: { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 4, letterSpacing: -0.3, textAlign: 'center' },
  noMatchSubtitle: { fontSize: 12, color: '#6B7280', textAlign: 'center', lineHeight: 18, marginBottom: 18, paddingHorizontal: 10, fontWeight: '500' },
  noMatchActions: { flexDirection: 'row', gap: 12, width: '100%' },
  noMatchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 16, gap: 6 },
  retryBtn: { backgroundColor: ORANGE, shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
  modifyBtn: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  modifyBtnText: { color: '#6B7280', fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
});