// src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, StatusBar,
  Alert, Platform, Easing,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import { supabase } from '../../../../utils/supabase';

const ORANGE = '#FA7A25';

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
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const sheetScale = useRef(new Animated.Value(1)).current;

  const matchChannelRef = useRef<any>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /* ------------------------------------------------------------------ */
  /* Sheet entrance animation                                            */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    sheetAnim.setValue(0);
    Animated.timing(sheetAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bookingState, sheetAnim]);

  /* ------------------------------------------------------------------ */
  /* State-driven animation effects                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (bookingState === 'finding') {
      setIsSearching(true);
      progressAnim.setValue(0);
      Animated.timing(progressAnim, { toValue: 1, duration: 60000, useNativeDriver: false }).start();

      const createPulse = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, { toValue: 1.05, duration: 600, delay, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0.95, duration: 600, useNativeDriver: true }),
          ])
        );
      const p1 = createPulse(pulseAnim1, 0);
      const p2 = createPulse(pulseAnim2, 200);
      const p3 = createPulse(pulseAnim3, 400);
      p1.start(); p2.start(); p3.start();
      return () => { p1.stop(); p2.stop(); p3.stop(); };
    }

    if (bookingState === 'matched' || bookingState === 'no_match') {
      setShowNotification(true);
      Animated.spring(notificationSlide, {
        toValue: insets.top + 10,
        friction: 6,
        useNativeDriver: true,
      }).start();
      setTimeout(() => {
        Animated.timing(notificationSlide, {
          toValue: -150,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setShowNotification(false));
      }, 4000);
    }

    return () => {
      if (matchChannelRef.current) supabase.removeChannel(matchChannelRef.current);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [bookingState, insets.top]);

  /* ------------------------------------------------------------------ */
  /* Matching logic                                                      */
  /* ------------------------------------------------------------------ */
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
      await supabase.from('delivery_requests').delete().eq('request_id', savedRequestId);
    }
    setBookingState('review');
  };

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

  const mapRegion = state.pickupLocation
    ? {
        latitude: (state.pickupLocation.latitude + (state.dropoffLocation?.latitude || state.pickupLocation.latitude)) / 2,
        longitude: (state.pickupLocation.longitude + (state.dropoffLocation?.longitude || state.pickupLocation.longitude)) / 2,
      }
    : { latitude: 10.3157, longitude: 123.8854 };

  const sheetFadeUp = {
    opacity: sheetAnim,
    transform: [
      {
        translateY: sheetAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [30, 0],
        }),
      },
    ],
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <WebView
        style={styles.map}
        source={{
          html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
              <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
              <style>
                body { margin: 0; padding: 0; }
                #map { height: 100vh; width: 100vw; background: #E5E7EB; }
                .pickup-marker { background: #0000CC; border: 3px solid white; border-radius: 50%; width: 18px; height: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
                .dropoff-marker { background: #E11D48; border: 3px solid white; border-radius: 50%; width: 18px; height: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
              </style>
            </head>
            <body>
              <div id="map"></div>
              <script>
                var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${mapRegion.latitude}, ${mapRegion.longitude}], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

                var pickupIcon = L.divIcon({ className: 'pickup-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
                var dropoffIcon = L.divIcon({ className: 'dropoff-marker', iconSize: [18, 18], iconAnchor: [9, 9] });

                L.marker([${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}], { icon: pickupIcon }).addTo(map);
                L.marker([${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}], { icon: dropoffIcon }).addTo(map);

                L.polyline([
                  [${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}],
                  [${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}]
                ], { color: '#FA7A25', weight: 4, dashArray: '10, 10', opacity: 0.85 }).addTo(map);

                map.fitBounds([
                  [${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}],
                  [${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}]
                ], { padding: [80, 80] });
              </script>
            </body>
          </html>
        `,
        }}
        scrollEnabled={false}
        zoomEnabled={false}
      />

      {/* Push Notification */}
      {showNotification && (
        <Animated.View
          style={[styles.pushNotification, { transform: [{ translateY: notificationSlide }] }]}
        >
          <View style={[styles.pushIconBox, { backgroundColor: matchFound ? '#DCFCE7' : '#FEE2E2' }]}>
            <Ionicons
              name={matchFound ? 'checkmark-circle' : 'alert-circle'}
              size={22}
              color={matchFound ? '#22C55E' : '#EF4444'}
            />
          </View>
          <View style={styles.pushTextContainer}>
            <View style={styles.pushHeaderRow}>
              <Text style={styles.pushTitle}>
                {matchFound ? 'Provider Matched!' : 'No match found'}
              </Text>
              <Text style={styles.pushTime}>
                {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
            <Text style={styles.pushSub}>
              {matchFound
                ? 'A provider has been matched with your delivery!'
                : 'Try again later.'}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Top Overlay */}
      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <TouchableOpacity
          style={styles.backCircleBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>

        <View style={styles.pillsContainer}>
          <View style={styles.locationPill}>
            <View style={styles.pillIconPickup}>
              <View style={styles.pillIconPickupInner} />
            </View>
            <View style={styles.pillTextContainer}>
              <Text style={styles.pillLabel}>PICKUP</Text>
              <Text style={styles.pillMainText} numberOfLines={1}>{pickup.main}</Text>
              <Text style={styles.pillSubText} numberOfLines={1}>{pickup.sub}</Text>
            </View>
          </View>
          <View style={styles.locationPill}>
            <Ionicons name="location" size={16} color="#E11D48" style={{ marginRight: 10 }} />
            <View style={styles.pillTextContainer}>
              <Text style={[styles.pillLabel, { color: '#E11D48' }]}>DROPOFF</Text>
              <Text style={styles.pillMainText} numberOfLines={1}>{dropoff.main}</Text>
              <Text style={styles.pillSubText} numberOfLines={1}>{dropoff.sub}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Bottom Sheet */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        {/* ==================== REVIEW ==================== */}
        {bookingState === 'review' && (
          <Animated.View style={[styles.sheetCard, sheetFadeUp]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetTitleRow}>
              <View style={styles.sheetIconBox}>
                <Ionicons name="cube-outline" size={18} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetHeaderTitle}>
                  {state.dropoffType === 'curb-side' ? 'Curb-side' : 'Door-to-Door'} Drop-off
                </Text>
                <Text style={styles.sheetHeaderSub}>
                  {mode === 'sendNow' ? 'Send now · Immediate pickup' : 'Scheduled delivery'}
                </Text>
              </View>
            </View>

            <View style={styles.timelineContainer}>
              <View style={styles.timelinePoint}>
                <View style={styles.dotPickupOuter}>
                  <View style={styles.dotPickupInner} />
                </View>
                <View style={styles.timelineTextContainer}>
                  <Text style={styles.timelineLabel}>PICKUP</Text>
                  <Text style={styles.timelineMainText} numberOfLines={1}>{pickup.main}</Text>
                  <Text style={styles.timelineSubText} numberOfLines={1}>{pickup.sub}</Text>
                </View>
              </View>
              <View style={styles.timelineLine} />
              <View style={styles.timelinePoint}>
                <Ionicons
                  name="location"
                  size={18}
                  color="#E11D48"
                  style={styles.dotDropoff}
                />
                <View style={styles.timelineTextContainer}>
                  <Text style={[styles.timelineLabel, { color: '#E11D48' }]}>DROPOFF</Text>
                  <Text style={styles.timelineMainText} numberOfLines={1}>{dropoff.main}</Text>
                  <Text style={styles.timelineSubText} numberOfLines={1}>{dropoff.sub}</Text>
                </View>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.costRow}>
              <View>
                <Text style={styles.costLabel}>Estimated total</Text>
                <Text style={styles.costSub}>Includes delivery & handling</Text>
              </View>
              <Text style={styles.costValue}>₱{state.estimatedCost?.toFixed(2) || '0.00'}</Text>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleBook}
              activeOpacity={0.9}
            >
              <Ionicons
                name={mode === 'sendNow' ? 'flash' : 'calendar'}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.primaryButtonText}>
                {mode === 'sendNow' ? 'Book Now' : 'Schedule Delivery'}
              </Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ==================== FINDING ==================== */}
        {bookingState === 'finding' && (
          <Animated.View style={[styles.sheetCardFinding, sheetFadeUp]}>
            <View style={styles.sheetHandle} />

            <View style={styles.findingHeaderRow}>
              <View style={styles.findingPulseDot}>
                <View style={styles.findingPulseDotInner} />
              </View>
              <Text style={styles.findingTitle}>
                {isSearching ? 'Finding your provider...' : 'Processing your booking...'}
              </Text>
            </View>
            <Text style={styles.findingSub}>
              Your request has been sent to nearby providers.
            </Text>

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

            <View style={styles.providerPlaceholders}>
              <Animated.View
                style={[styles.placeholderCard, { transform: [{ scale: pulseAnim1 }] }]}
              >
                <View style={styles.placeholderAvatar}>
                  <Ionicons name="person" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
              <Animated.View
                style={[styles.placeholderCardCenter, { transform: [{ scale: pulseAnim2 }] }]}
              >
                <View style={[styles.placeholderAvatar, { width: 36, height: 36, borderRadius: 18 }]}>
                  <Ionicons name="person" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
              <Animated.View
                style={[styles.placeholderCard, { transform: [{ scale: pulseAnim3 }] }]}
              >
                <View style={styles.placeholderAvatar}>
                  <Ionicons name="person" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
            </View>

            <TouchableOpacity
              style={styles.cancelTextButton}
              onPress={handleCancelBooking}
              activeOpacity={0.85}
            >
              <Ionicons name="close-circle-outline" size={16} color="#EF4444" />
              <Text style={styles.cancelTextButtonLabel}>Cancel Booking</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ==================== MATCHED ==================== */}
        {bookingState === 'matched' && matchFound && (
          <Animated.View style={[styles.sheetCardMatched, sheetFadeUp]}>
            <View style={styles.sheetHandle} />

            <View style={styles.matchedHeader}>
              <View style={styles.matchedHeaderIcon}>
                <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchedHeaderTitle}>Provider Matched!</Text>
                <Text style={styles.matchedHeaderSub}>
                  Your delivery is on the way
                </Text>
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
                      <Text style={styles.carText} numberOfLines={1}>
                        {providerData?.vehicle_type || 'Loading...'}
                      </Text>
                    </View>
                    <View style={styles.carDetailRow}>
                      <Ionicons name="pricetag-outline" size={12} color="#6B7280" />
                      <Text style={styles.carText}>{providerData?.plate_number || 'Loading...'}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.matchedDivider} />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>₱{state.estimatedCost?.toFixed(2)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.confirmButton}
              onPress={handleConfirmAction}
              activeOpacity={0.9}
            >
              <Text style={styles.confirmButtonText}>Confirm & Proceed</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ==================== NO MATCH ==================== */}
        {bookingState === 'no_match' && (
          <Animated.View style={[styles.sheetCardNoMatch, sheetFadeUp]}>
            <View style={styles.sheetHandle} />

            <View style={styles.noMatchIconCircle}>
              <Ionicons name="cloud-offline-outline" size={36} color={ORANGE} />
            </View>
            <Text style={styles.noMatchTitle}>No Provider Available</Text>
            <Text style={styles.noMatchSubtitle}>
              We couldn't find a provider on this route right now. Try again or adjust your details.
            </Text>

            <View style={styles.noMatchActions}>
              <TouchableOpacity
                style={[styles.noMatchBtn, styles.retryBtn]}
                onPress={() => startMatching()}
                activeOpacity={0.9}
              >
                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.noMatchBtn, styles.modifyBtn]}
                onPress={handleCancelBooking}
                activeOpacity={0.9}
              >
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
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  map: { ...StyleSheet.absoluteFillObject },

  /* ------------------------------------------------------------------ */
  /* Top Overlay                                                         */
  /* ------------------------------------------------------------------ */
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  backCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  pillsContainer: { flex: 1 },
  locationPill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  pillIconPickup: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: '#0000CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pillIconPickupInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#0000CC',
  },
  pillTextContainer: { flex: 1 },
  pillLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0000CC',
    letterSpacing: 1,
    marginBottom: 2,
  },
  pillMainText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  pillSubText: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 1,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Push Notification                                                   */
  /* ------------------------------------------------------------------ */
  pushNotification: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: 'rgba(17,24,39,0.95)',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  pushIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pushTextContainer: { flex: 1 },
  pushHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pushTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 18,
    marginRight: 8,
  },
  pushTime: { fontSize: 11, color: '#9CA3AF', fontWeight: '500' },
  pushSub: {
    fontSize: 11,
    color: '#D1D5DB',
    marginTop: 3,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Bottom Sheet                                                        */
  /* ------------------------------------------------------------------ */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 14,
  },

  /* ---- Review ---- */
  sheetCard: {
    backgroundColor: '#FFFFFF',
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  sheetIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  sheetHeaderSub: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },

  timelineContainer: { marginLeft: 6, marginBottom: 4 },
  timelinePoint: { flexDirection: 'row', alignItems: 'center' },
  dotPickupOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: '#0000CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dotPickupInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0000CC',
  },
  dotDropoff: { marginRight: 10, marginLeft: -1 },
  timelineLine: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
    marginLeft: 7,
    marginVertical: 4,
  },
  timelineTextContainer: { flex: 1 },
  timelineLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0000CC',
    letterSpacing: 1,
    marginBottom: 2,
  },
  timelineMainText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
  },
  timelineSubText: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 1,
    fontWeight: '500',
  },

  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 16,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  costLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  costSub: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 2,
  },
  costValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  /* ---- Finding ---- */
  sheetCardFinding: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    alignItems: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  findingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  findingPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(242,112,36,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  findingPulseDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ORANGE,
  },
  findingTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  findingSub: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginBottom: 18,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    height: 5,
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
    marginBottom: 24,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: ORANGE,
    borderRadius: 3,
  },
  providerPlaceholders: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    gap: 8,
  },
  placeholderCard: {
    width: 66,
    height: 84,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  placeholderCardCenter: {
    width: 78,
    height: 96,
    backgroundColor: '#FFEDD5',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#FDBA74',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  placeholderAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  placeholderLine: {
    width: '80%',
    height: 4,
    backgroundColor: '#FDBA74',
    borderRadius: 2,
    marginBottom: 4,
  },
  placeholderLineShort: {
    width: '50%',
    height: 4,
    backgroundColor: '#FDBA74',
    borderRadius: 2,
  },
  cancelTextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  cancelTextButtonLabel: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 13,
  },

  /* ---- Matched ---- */
  sheetCardMatched: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  matchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  matchedHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchedHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  matchedHeaderSub: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },
  matchedInnerCard: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 16,
    padding: 14,
    backgroundColor: '#FAFAFA',
    marginBottom: 16,
  },
  matchedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  matchedLeftCol: {
    width: 70,
    alignItems: 'center',
    marginRight: 14,
    position: 'relative',
  },
  matchedAvatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  matchedVerifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  matchedRightCol: { flex: 1 },
  matchedName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  carDetailBox: {
    gap: 3,
  },
  carDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  carText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
  matchedDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  /* ---- No Match ---- */
  sheetCardNoMatch: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    alignItems: 'center',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  noMatchIconCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  noMatchTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  noMatchSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 22,
    paddingHorizontal: 10,
    fontWeight: '500',
  },
  noMatchActions: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  noMatchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    gap: 6,
  },
  retryBtn: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  modifyBtn: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modifyBtnText: {
    color: '#6B7280',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.2,
  },
});