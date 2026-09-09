// src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Animated, StatusBar, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import { supabase } from '../../../../utils/supabase';

const { width } = Dimensions.get('window');

export default function BookingScreen({ route, navigation }: any) {
  const { mode: routeMode } = route.params || {};
  const { state, dispatch } = useSchedule();
  const mode = routeMode || state.mode;
  const insets = useSafeAreaInsets();

  const [bookingState, setBookingState] = useState<'review' | 'finding' | 'matched' | 'no_match'>('review');
  const [showNotification, setShowNotification] = useState(false);
  const [matchFound, setMatchFound] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [providerData, setProviderData] = useState<any>(null);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);

  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1.1)).current; 
  const pulseAnim3 = useRef(new Animated.Value(1)).current;
  const notificationSlide = useRef(new Animated.Value(-100)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  
  const matchChannelRef = useRef<any>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (bookingState === 'finding') {
      setIsSearching(true);
      Animated.timing(progressAnim, { toValue: 1, duration: 60000, useNativeDriver: false }).start();

      const createPulse = (anim: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1.05, duration: 600, delay, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0.95, duration: 600, useNativeDriver: true }),
          ])
        );
      };
      createPulse(pulseAnim1, 0).start();
      createPulse(pulseAnim2, 200).start();
      createPulse(pulseAnim3, 400).start();
    }
    
    if (bookingState === 'matched' || bookingState === 'no_match') {
      setShowNotification(true);
      Animated.spring(notificationSlide, { toValue: insets.top + 10, friction: 6, useNativeDriver: true }).start();
      setTimeout(() => {
        Animated.timing(notificationSlide, { toValue: -150, duration: 300, useNativeDriver: true }).start(() => setShowNotification(false));
      }, 4000);
    }
    
    return () => {
      if (matchChannelRef.current) supabase.removeChannel(matchChannelRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [bookingState, insets.top]);

  const startMatching = async () => {
    try {
      let savedRequest;
      if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        savedRequest = { request_id: state.editIds.requestId };
      } else {
        savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
      }

      if (!savedRequest) throw new Error('Failed to save request');
      setSavedRequestId(savedRequest.request_id);

      // Listen for the Provider to hit "Accept" (which creates the delivery record)
      const matchChannel = supabase
        .channel(`match-listener-${savedRequest.request_id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${savedRequest.request_id}` }, async (payload) => {
          const delivery = payload.new;
          
          const { data: provider } = await supabase.from('users').select('first_name, last_name, phone_number').eq('user_id', delivery.provider_id).single();
          const { data: vehicle } = await supabase.from('vehicles').select('vehicle_type, plate_number, max_weight_kg').eq('vehicle_id', delivery.vehicle_id).single();
          
          if (provider && vehicle) setProviderData({ ...provider, ...vehicle });

          setMatchFound(true);
          setBookingState('matched');
          setIsSearching(false);
          
          if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
          supabase.removeChannel(matchChannel);
        }).subscribe();
        
      matchChannelRef.current = matchChannel;

      // Give providers 60 seconds to review and accept the pending request on their Task Screen
      searchTimeoutRef.current = setTimeout(() => {
        if (bookingState === 'finding') {
          setBookingState('no_match');
          setIsSearching(false);
          supabase.removeChannel(matchChannel);
        }
      }, 60000);

    } catch (error) {
      console.error('Error starting matching:', error);
      Alert.alert('Error', 'Failed to process your booking. Please try again.');
      setBookingState('review');
    }
  };

  const handleBook = () => {
    setBookingState('finding');
    startMatching();
  };

  const handleCancelBooking = async () => {
    if (matchChannelRef.current) supabase.removeChannel(matchChannelRef.current);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    
    if (savedRequestId) {
      // Optional: Delete the pending request from DB so providers don't see a ghost request
      await supabase.from('delivery_requests').delete().eq('request_id', savedRequestId);
    }
    
    setBookingState('review');
  }

  const handleConfirmAction = () => {
    dispatch({ type: 'RESET' });
    navigation.navigate('MainTabs');
  };

  const parseAddress = (fullAddress: string | undefined) => {
    if (!fullAddress) return { main: 'Selected Location', sub: 'Coordinates' };
    const parts = fullAddress.split(', ');
    return { main: parts[0], sub: parts.slice(1).join(', ') || fullAddress };
  };

  const pickup = parseAddress(state.pickupLocation?.address);
  const dropoff = parseAddress(state.dropoffLocation?.address);

  const mapRegion = state.pickupLocation ? {
    latitude: (state.pickupLocation.latitude + (state.dropoffLocation?.latitude || state.pickupLocation.latitude)) / 2,
    longitude: (state.pickupLocation.longitude + (state.dropoffLocation?.longitude || state.pickupLocation.longitude)) / 2,
  } : { latitude: 10.3157, longitude: 123.8854 };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      <WebView
        style={styles.map}
        source={{ html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
              <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
              <style>body { margin: 0; padding: 0; } #map { height: 100vh; width: 100vw; background: #E5E7EB; }</style>
            </head>
            <body>
              <div id="map"></div>
              <script>
                var map = L.map('map').setView([${mapRegion.latitude}, ${mapRegion.longitude}], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
                L.marker([${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}]).bindPopup('Pickup').addTo(map).openPopup();
                L.marker([${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}]).bindPopup('Dropoff').addTo(map);
                L.polyline([
                  [${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}],
                  [${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}]
                ], { color: '#111827', weight: 4, dashArray: '10, 10' }).addTo(map);
              </script>
            </body>
          </html>
        `}}
        scrollEnabled={false}
        zoomEnabled={false}
      />

      {showNotification && (
        <Animated.View style={[styles.pushNotification, { transform: [{ translateY: notificationSlide }] }]}>
          <View style={styles.pushIconPlaceholder}><Ionicons name="cube-outline" size={24} color="#D1D5DB" /></View>
          <View style={styles.pushTextContainer}>
            <View style={styles.pushHeaderRow}>
              <Text style={styles.pushTitle}>{matchFound ? '🎉 Provider Matched!' : 'No match found'}</Text>
              <Text style={styles.pushTime}>{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text>
            </View>
            <Text style={styles.pushSub}>{matchFound ? 'A provider has been matched with your delivery!' : 'Try again later.'}</Text>
          </View>
        </Animated.View>
      )}

      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.pillsContainer}>
          <View style={styles.pillConnectorLine} />
          <View style={styles.locationPill}>
            <View style={styles.pillIconPickup}><View style={styles.pillIconPickupInner} /></View>
            <View style={styles.pillTextContainer}>
              <Text style={styles.pillMainText}>{pickup.main}</Text>
              <Text style={styles.pillSubText} numberOfLines={1}>{pickup.sub}</Text>
            </View>
          </View>
          <View style={styles.locationPill}>
            <Ionicons name="location" size={18} color="#E11D48" style={{ marginRight: 10 }} />
            <View style={styles.pillTextContainer}>
              <Text style={styles.pillMainText}>{dropoff.main}</Text>
              <Text style={styles.pillSubText} numberOfLines={1}>{dropoff.sub}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        {bookingState === 'review' && (
          <View style={styles.sheetCard}>
            <Text style={styles.sheetHeaderTitle}>{state.dropoffType === 'curb-side' ? 'Curb-side' : 'Door-to-Door'} Drop-off</Text>
            <View style={styles.timelineContainer}>
              <View style={styles.timelinePoint}>
                <View style={styles.dotPickupOuter}><View style={styles.dotPickupInner} /></View>
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineMainText}>{pickup.main}</Text>
                  <Text style={styles.timelineSubText} numberOfLines={1}>{pickup.sub}</Text>
                </View>
              </View>
              <View style={styles.timelineLine} />
              <View style={styles.timelinePoint}>
                <Ionicons name="location" size={18} color="#E11D48" style={styles.dotDropoff} />
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineMainText}>{dropoff.main}</Text>
                  <Text style={styles.timelineSubText} numberOfLines={1}>{dropoff.sub}</Text>
                </View>
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.costRow}>
              <Text style={styles.costLabel}>Estimated total cost</Text>
              <Text style={styles.costValue}>₱{state.estimatedCost?.toFixed(2) || '0.00'}</Text>
            </View>
            <TouchableOpacity style={styles.primaryButton} onPress={handleBook}>
              <Text style={styles.primaryButtonText}>{mode === 'sendNow' ? 'Book Now' : 'Schedule Delivery'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {bookingState === 'finding' && (
          <View style={styles.sheetCardFinding}>
            <Text style={styles.findingTitle}>{isSearching ? 'Waiting for provider to accept...' : 'Processing your booking...'}</Text>
            <View style={styles.progressContainer}>
              <Animated.View style={[styles.progressBar, { width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
            </View>
            <View style={styles.providerPlaceholders}>
              <Animated.View style={[styles.placeholderCard, { transform: [{ scale: pulseAnim1 }] }]}><View style={styles.placeholderAvatar}><Ionicons name="person" size={24} color="#C2410C" /></View><View style={styles.placeholderLine} /><View style={styles.placeholderLineShort} /></Animated.View>
              <Animated.View style={[styles.placeholderCardCenter, { transform: [{ scale: pulseAnim2 }] }]}><View style={styles.placeholderAvatar}><Ionicons name="person" size={28} color="#C2410C" /></View><View style={styles.placeholderLine} /><View style={styles.placeholderLineShort} /></Animated.View>
              <Animated.View style={[styles.placeholderCard, { transform: [{ scale: pulseAnim3 }] }]}><View style={styles.placeholderAvatar}><Ionicons name="person" size={24} color="#C2410C" /></View><View style={styles.placeholderLine} /><View style={styles.placeholderLineShort} /></Animated.View>
            </View>
            <Text style={styles.searchStatusText}>Your request has been sent to nearby providers.</Text>
            <TouchableOpacity style={styles.textButton} onPress={handleCancelBooking}>
              <Text style={styles.textButtonText}>Cancel Booking</Text>
            </TouchableOpacity>
          </View>
        )}

        {bookingState === 'matched' && matchFound && (
          <View style={styles.sheetCardMatched}>
            <Text style={styles.matchedTitle}>🎉 Provider Matched!</Text>
            <View style={styles.matchedInnerCard}>
              <View style={styles.matchedRow}>
                <View style={styles.matchedLeftCol}>
                  <View style={styles.matchedAvatarBox}>
                    <View style={styles.matchedAvatarCircle}><Ionicons name="person" size={32} color="#C2410C" /></View>
                  </View>
                </View>
                <View style={styles.matchedRightCol}>
                  <Text style={styles.matchedName}>{providerData ? `${providerData.first_name} ${providerData.last_name}` : 'Loading...'}</Text>
                  <View style={styles.carDetailRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.carText}>Car: {providerData?.vehicle_type || 'Loading...'}</Text>
                      <Text style={styles.carText}>Plate Number: {providerData?.plate_number || 'Loading...'}</Text>
                    </View>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>₱{state.estimatedCost?.toFixed(2)}</Text>
                  </View>
                </View>
              </View>
            </View>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.confirmTextButton} onPress={handleConfirmAction}>
              <Text style={styles.confirmTextButtonLabel}>Confirm & Proceed</Text>
            </TouchableOpacity>
          </View>
        )}

        {bookingState === 'no_match' && (
          <View style={styles.sheetCardNoMatch}>
            <Ionicons style={styles.noMatchIcon} name="sad-outline" size={60} color="#9CA3AF" />
            <Text style={styles.noMatchTitle}>No Provider Available</Text>
            <Text style={styles.noMatchSubtitle}>We couldn't find a provider on this route right now.</Text>
            <View style={styles.noMatchActions}>
              <TouchableOpacity style={[styles.noMatchBtn, styles.retryBtn]} onPress={() => startMatching()}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.noMatchBtn, styles.modifyBtn]} onPress={handleCancelBooking}>
                <Text style={styles.modifyBtnText}>Modify Details</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  map: { ...StyleSheet.absoluteFill },
  topOverlay: { position: 'absolute', left: 20, right: 40, flexDirection: 'row', alignItems: 'flex-start', zIndex: 10 },
  backCircleBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 4, marginRight: 12 },
  pillsContainer: { flex: 1, position: 'relative' },
  pillConnectorLine: { position: 'absolute', right: -15, top: 23, bottom: 33, width: 30, borderTopWidth: 2, borderBottomWidth: 2, borderRightWidth: 2, borderColor: '#000', zIndex: -1 },
  locationPill: { backgroundColor: '#FFF', borderRadius: 25, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  pillIconPickup: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  pillIconPickupInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  pillTextContainer: { flex: 1 },
  pillMainText: { fontSize: 13, fontWeight: '700', color: '#000' },
  pillSubText: { fontSize: 10, color: '#6B7280', marginTop: 2 },
  pushNotification: { position: 'absolute', left: 10, right: 10, backgroundColor: 'rgba(90,90,90, 0.95)', borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', zIndex: 20 },
  pushIconPlaceholder: { width: 40, height: 40, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  pushTextContainer: { flex: 1 },
  pushHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  pushTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: '#FFF', lineHeight: 18, marginRight: 8 },
  pushTime: { fontSize: 11, color: '#D1D5DB' },
  pushSub: { fontSize: 12, color: '#D1D5DB', marginTop: 4 },
  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  sheetCard: { backgroundColor: '#FFF', width: '100%', padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5, borderWidth: 1, borderColor: '#E5E7EB', bottom: -20 },
  sheetHeaderTitle: { fontSize: 13, fontWeight: '600', color: '#000', marginBottom: 16 },
  timelineContainer: { marginLeft: 8 },
  timelinePoint: { flexDirection: 'row', alignItems: 'center' },
  dotPickupOuter: { width: 16, height: 16, borderRadius: 8, borderWidth: 4, borderColor: '#0000CC', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  dotPickupInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#0000CC' },
  dotDropoff: { marginRight: 10, marginLeft: -1 },
  timelineLine: { width: 1, height: 24, backgroundColor: '#D1D5DB', marginLeft: 7, marginVertical: 4 },
  timelineTextContainer: { flex: 1 },
  timelineMainText: { fontSize: 13, fontWeight: '500', color: '#000' },
  timelineSubText: { fontSize: 10, color: '#6B7280', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E5E7EB', marginVertical: 16 },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  costLabel: { fontSize: 12, color: '#374151' },
  costValue: { fontSize: 12, fontWeight: '700', color: '#000' },
  primaryButton: { backgroundColor: '#FA7A25', borderRadius: 30, paddingVertical: 14, alignItems: 'center' },
  primaryButtonText: { color: '#FFF', fontSize: 14, fontWeight: '600' },
  sheetCardFinding: { width: '100%', backgroundColor: '#FFF', padding: 20, alignItems: 'center', bottom: -20 },
  findingTitle: { fontSize: 16, fontWeight: '700', color: '#000', textAlign: 'center', marginBottom: 16 },
  progressContainer: { width: '100%', height: 4, backgroundColor: '#E5E7EB', borderRadius: 2, marginBottom: 20, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: '#F27024', borderRadius: 2 },
  providerPlaceholders: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  placeholderCard: { width: 60, height: 80, backgroundColor: '#FED7AA', borderRadius: 8, marginHorizontal: 8, padding: 8, alignItems: 'center', opacity: 0.7 },
  placeholderCardCenter: { width: 70, height: 95, backgroundColor: '#FDBA74', borderRadius: 8, marginHorizontal: 8, padding: 10, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
  placeholderAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#EA580C', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  placeholderLine: { width: '80%', height: 4, backgroundColor: '#FFF', borderRadius: 2, marginBottom: 4 },
  placeholderLineShort: { width: '50%', height: 4, backgroundColor: '#FFF', borderRadius: 2 },
  searchStatusText: { fontSize: 12, color: '#6B7280', marginBottom: 16 },
  textButton: { paddingVertical: 10 },
  textButtonText: { color: '#FA7A25', fontWeight: '600', fontSize: 14 },
  sheetCardMatched: { width: '100%', backgroundColor: '#FFF', bottom: -20, padding: 20 },
  matchedTitle: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 16 },
  matchedInnerCard: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 16 },
  matchedRow: { flexDirection: 'row' },
  matchedLeftCol: { width: '35%', alignItems: 'center', marginRight: 16 },
  matchedAvatarBox: { width: '100%', backgroundColor: '#FDBA74', borderRadius: 8, padding: 10, alignItems: 'center', marginBottom: 10 },
  matchedAvatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EA580C', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  matchedRightCol: { flex: 1 },
  matchedName: { fontSize: 16, fontWeight: '700', color: '#000', marginBottom: 4 },
  carDetailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  carText: { fontSize: 9, color: '#000', marginBottom: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: '#000' },
  totalValue: { fontSize: 14, fontWeight: '700', color: '#000' },
  confirmTextButton: { alignItems: 'center', paddingVertical: 8 },
  confirmTextButtonLabel: { color: '#FA7A25', fontWeight: '600', fontSize: 14 },
  sheetCardNoMatch: { width: '100%', backgroundColor: '#FFF', bottom: -20, padding: 30, alignItems: 'center' },
  noMatchIcon: { marginBottom: 20 },
  noMatchTitle: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 8 },
  noMatchSubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  noMatchActions: { flexDirection: 'row', gap: 12, width: '100%' },
  noMatchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 25, gap: 8 },
  retryBtn: { backgroundColor: '#F27024' },
  retryBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  modifyBtn: { backgroundColor: '#F3F4F6', borderWidth: 1, borderColor: '#E5E7EB' },
  modifyBtnText: { color: '#6B7280', fontWeight: '600', fontSize: 14 },
});