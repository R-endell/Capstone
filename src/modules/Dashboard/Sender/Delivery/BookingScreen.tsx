// src/modules/Dashboard/Sender/BookingScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  ActivityIndicator, 
  Dimensions, 
  Animated, 
  StatusBar,
  Alert
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import { autoMatchAndCreateDeliveries } from '../../../../services/matchingService';

const { width } = Dimensions.get('window');

export default function BookingScreen({ route, navigation }: any) {
  const { mode: routeMode } = route.params || {};
  const { state, dispatch } = useSchedule();
  const mode = routeMode || state.mode;
  const insets = useSafeAreaInsets();

  const [bookingState, setBookingState] = useState<'review' | 'finding' | 'matched' | 'matched_with_alert'>('review');
  const [saving, setSaving] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [matchFound, setMatchFound] = useState(false);

  const matchedProvider = {
    name: 'Jun Joseph Pestaño',
    vehicle: 'Honda Civic RS Turbo',
    color: 'Sonic Gray Pearl',
    plate: 'NDA-1234',
    schedule: state.scheduledDate 
      ? state.scheduledDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'April 25, 2026 6:40 PM',
    cost: state.estimatedCost ? state.estimatedCost.toFixed(2) : '24.00'
  };

  // Animation values
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1.1)).current; 
  const pulseAnim3 = useRef(new Animated.Value(1)).current;
  const notificationSlide = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    if (bookingState === 'finding') {
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
    
    if (bookingState === 'matched' || bookingState === 'matched_with_alert') {
      setShowNotification(true);
      Animated.spring(notificationSlide, {
        toValue: insets.top + 10,
        friction: 6,
        useNativeDriver: true,
      }).start();

      // Hide notification after 4 seconds
      setTimeout(() => {
        Animated.timing(notificationSlide, {
          toValue: -150,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setShowNotification(false));
      }, 4000);
    }
  }, [bookingState]);

  const handleBook = () => {
    setBookingState('finding');
    // Simulate finding a match
    setTimeout(() => {
      // Check if we actually found a match (this would come from the matching service)
      const matchFound = Math.random() > 0.5; // Simulate match found
      if (matchFound) {
        setMatchFound(true);
        setBookingState('matched');
      } else {
        setMatchFound(false);
        setBookingState('matched_with_alert');
      }
    }, 4000);
  };

  const handleConfirmAction = async () => {
    setSaving(true);
    try {
      let savedRequest = null;
      
      if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        savedRequest = { request_id: state.editIds.requestId };
      } else {
        savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
      }
      
      // After saving, try to match with a provider
      if (savedRequest) {
        const matches = await autoMatchAndCreateDeliveries();
        
        if (matches.length > 0) {
          // A match was found!
          setMatchFound(true);
          Alert.alert(
            '🎉 Match Found!',
            `Your delivery has been automatically matched with a provider. They will pick up your package soon.`,
            [{ text: 'Awesome!' }]
          );
        } else {
          // No immediate match found
          Alert.alert(
            '📦 Delivery Scheduled',
            'We\'ll notify you once a provider is matched with your delivery.',
            [{ text: 'OK' }]
          );
        }
      }
      
      dispatch({ type: 'RESET' });
      navigation.navigate('MainTabs');
    } catch (err) {
      console.error('Failed to save:', err);
      Alert.alert('Error', 'Failed to schedule delivery. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Parse address
  const parseAddress = (fullAddress: string | undefined) => {
    if (!fullAddress) return { main: 'Selected Location', sub: 'Coordinates' };
    const parts = fullAddress.split(', ');
    return {
      main: parts[0],
      sub: parts.slice(1).join(', ') || fullAddress
    };
  };

  const pickup = parseAddress(state.pickupLocation?.address);
  const dropoff = parseAddress(state.dropoffLocation?.address);

  // Map Region
  const mapRegion = state.pickupLocation ? {
    latitude: (state.pickupLocation.latitude + (state.dropoffLocation?.latitude || state.pickupLocation.latitude)) / 2,
    longitude: (state.pickupLocation.longitude + (state.dropoffLocation?.longitude || state.pickupLocation.longitude)) / 2,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  } : { latitude: 10.3157, longitude: 123.8854, latitudeDelta: 0.05, longitudeDelta: 0.05 };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* Map */}
      <WebView
        style={styles.map}
        source={{ html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
              <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
              <style>
                body { margin: 0; padding: 0; }
                #map { height: 100vh; width: 100vw; background: #E5E7EB; }
              </style>
            </head>
            <body>
              <div id="map"></div>
              <script>
                var map = L.map('map').setView([${mapRegion.latitude}, ${mapRegion.longitude}], 14);
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                  attribution: '© OpenStreetMap',
                  maxZoom: 19
                }).addTo(map);

                L.marker([${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}])
                  .bindPopup('📍 Pickup')
                  .addTo(map)
                  .openPopup();

                L.marker([${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}])
                  .bindPopup('📍 Dropoff')
                  .addTo(map);

                L.polyline([
                  [${state.pickupLocation?.latitude || 10.3157}, ${state.pickupLocation?.longitude || 123.8854}],
                  [${state.dropoffLocation?.latitude || 10.3178}, ${state.dropoffLocation?.longitude || 123.9050}]
                ], {
                  color: '#111827',
                  weight: 4,
                  dashArray: '10, 10'
                }).addTo(map);
              </script>
            </body>
          </html>
        `}}
        scrollEnabled={false}
        zoomEnabled={false}
      />

      {/* Notification */}
      {showNotification && (
        <Animated.View style={[styles.pushNotification, { transform: [{ translateY: notificationSlide }] }]}>
          <View style={styles.pushIconPlaceholder}>
             <Ionicons name="cube-outline" size={24} color="#D1D5DB" />
          </View>
          <View style={styles.pushTextContainer}>
            <View style={styles.pushHeaderRow}>
              <Text style={styles.pushTitle}>
                {matchFound ? 'Provider has been matched!' : 'Provider matching in progress...'}
              </Text>
              <Text style={styles.pushTime}>10:00 AM</Text>
            </View>
            <Text style={styles.pushSub}>
              {matchFound ? 'Your delivery has been confirmed. Track your package now.' : 'We\'re finding the best provider for you.'}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Top Overlay */}
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

      {/* Bottom Sheet */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        
        {/* REVIEW STATE */}
        {bookingState === 'review' && (
          <View style={styles.sheetCard}>
            <Text style={styles.sheetHeaderTitle}>
              {state.dropoffType === 'curb-side' ? 'Curb-side' : 'Door-to-Door'} Drop-off
            </Text>

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
              <Text style={styles.costValue}>₱20.00 - ₱36.00</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={handleBook}>
              <Text style={styles.primaryButtonText}>Book</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* FINDING STATE */}
        {bookingState === 'finding' && (
          <View style={styles.sheetCardFinding}>
            <Text style={styles.findingTitle}>
              Confirming your advance booking. We will assign a provider shortly.
            </Text>

            <View style={styles.providerPlaceholders}>
              <Animated.View style={[styles.placeholderCard, { transform: [{ scale: pulseAnim1 }] }]}>
                <View style={styles.placeholderAvatar}><Ionicons name="person" size={24} color="#C2410C" /></View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
              <Animated.View style={[styles.placeholderCardCenter, { transform: [{ scale: pulseAnim2 }] }]}>
                <View style={styles.placeholderAvatar}><Ionicons name="person" size={28} color="#C2410C" /></View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
              <Animated.View style={[styles.placeholderCard, { transform: [{ scale: pulseAnim3 }] }]}>
                <View style={styles.placeholderAvatar}><Ionicons name="person" size={24} color="#C2410C" /></View>
                <View style={styles.placeholderLine} />
                <View style={styles.placeholderLineShort} />
              </Animated.View>
            </View>

            <View style={styles.sheetCardInside}>
              <Text style={styles.sheetHeaderTitle}>
                {state.dropoffType === 'curb-side' ? 'Curb-side' : 'Door-to-Door'} Drop-off
              </Text>
              
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
                <Text style={styles.costValue}>₱20.00 - ₱36.00</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.textButton} onPress={() => setBookingState('review')}>
              <Text style={styles.textButtonText}>Cancel Booking</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MATCHED STATE */}
        {(bookingState === 'matched' || bookingState === 'matched_with_alert') && (
          <View style={styles.sheetCardMatched}>
            <Text style={styles.matchedTitle}>
              {matchFound ? 'Provider has been matched!' : 'No provider available yet'}
            </Text>
            
            <View style={styles.matchedInnerCard}>
              <View style={styles.matchedRow}>
                <View style={styles.matchedLeftCol}>
                  <View style={styles.matchedAvatarBox}>
                    <View style={styles.matchedAvatarCircle}>
                      <Ionicons name="person" size={32} color="#C2410C" />
                    </View>
                    <View style={styles.matchedAvatarLines}>
                       <View style={styles.placeholderLine} />
                       <View style={styles.placeholderLineShort} />
                    </View>
                  </View>
                  <View style={styles.qrCodeBox}>
                     <Ionicons name="qr-code-outline" size={60} color="#000" />
                  </View>
                </View>

                <View style={styles.matchedRightCol}>
                  <Text style={styles.matchedName}>
                    {matchFound ? matchedProvider.name : 'Searching for provider...'}
                  </Text>
                  
                  <View style={styles.carDetailRow}>
                    <View style={{flex: 1}}>
                      <Text style={styles.carText}>
                        {matchFound ? `Car: ${matchedProvider.vehicle}` : 'Waiting for match...'}
                      </Text>
                      <Text style={styles.carText}>
                        {matchFound ? `Color: ${matchedProvider.color}` : ''}
                      </Text>
                      <Text style={styles.carText}>
                        {matchFound ? `Plate Number: ${matchedProvider.plate}` : ''}
                      </Text>
                    </View>
                    <View style={styles.contactIcons}>
                      <View style={styles.contactIconCircle}><Ionicons name="chatbubbles" size={14} color="#000" /></View>
                      <View style={styles.contactIconCircle}><Ionicons name="call" size={14} color="#000" /></View>
                    </View>
                  </View>

                  <View style={styles.timelineSmall}>
                    <View style={styles.timelinePointSmall}>
                      <View style={[styles.dotPickupOuter, { width: 12, height: 12, marginRight: 6 }]}><View style={[styles.dotPickupInner, { width: 4, height: 4 }]} /></View>
                      <View style={{flex: 1}}>
                        <Text style={styles.timelineMainTextSmall}>{pickup.main}</Text>
                        <Text style={styles.timelineSubTextSmall} numberOfLines={1}>{pickup.sub}</Text>
                      </View>
                    </View>
                    <View style={styles.timelineLineSmall} />
                    <View style={styles.timelinePointSmall}>
                      <Ionicons name="location" size={14} color="#E11D48" style={{ marginRight: 5, marginLeft: -1 }} />
                      <View style={{flex: 1}}>
                        <Text style={styles.timelineMainTextSmall}>{dropoff.main}</Text>
                        <Text style={styles.timelineSubTextSmall} numberOfLines={1}>{dropoff.sub}</Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.scheduledForText}>Scheduled for:</Text>
                  <Text style={styles.scheduledTimeText}>
                    {matchFound ? matchedProvider.schedule : 'Pending match...'}
                  </Text>

                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>₱{matchFound ? matchedProvider.cost : '0.00'}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.divider} />
              
              <TouchableOpacity style={styles.confirmTextButton} onPress={handleConfirmAction} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color="#F97316" />
                ) : (
                  <Text style={styles.confirmTextButtonLabel}>
                    {matchFound ? 'Confirm' : 'Continue'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F3F4F6',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 40,
    flexDirection: 'row',
    alignItems: 'flex-start',
    zIndex: 10,
  },
  backCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    marginRight: 12,
  },
  pillsContainer: {
    flex: 1,
    position: 'relative',
  },
  pillConnectorLine: {
    position: 'absolute',
    right: -15,
    top: 23,
    bottom: 33,
    width: 30,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderColor: '#000',
    zIndex: -1,
  },
  locationPill: {
    backgroundColor: '#FFF',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  pillTextContainer: {
    flex: 1,
  },
  pillMainText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  pillSubText: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  pushNotification: {
    position: 'absolute',
    left: 10,
    right: 10,
    backgroundColor: 'rgba(90,90,90, 0.95)',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },
  pushIconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  pushTextContainer: {
    flex: 1,
  },
  pushHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pushTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#FFF',
    lineHeight: 18,
    marginRight: 8,
  },
  pushTime: {
    fontSize: 11,
    color: '#D1D5DB',
  },
  pushSub: {
    fontSize: 12,
    color: '#D1D5DB',
    marginTop: 4,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  sheetCard: {
    backgroundColor: '#FFF',
    width: '100%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    bottom: -20,
  },
  sheetHeaderTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000',
    marginBottom: 16,
  },
  timelineContainer: {
    marginLeft: 8,
  },
  timelinePoint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  dotDropoff: {
    marginRight: 10,
    marginLeft: -1,
  },
  timelineLine: {
    width: 1,
    height: 24,
    backgroundColor: '#D1D5DB',
    marginLeft: 7,
    marginVertical: 4,
  },
  timelineTextContainer: {
    flex: 1,
  },
  timelineMainText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#000',
  },
  timelineSubText: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  costLabel: {
    fontSize: 12,
    color: '#374151',
  },
  costValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
  },
  primaryButton: {
    backgroundColor: '#FA7A25',
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetCardFinding: {
    width: '100%',
    backgroundColor: '#FFF',
    padding: 20,
    alignItems: 'center',
    bottom: -20,
  },
  findingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 20,
  },
  providerPlaceholders: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  placeholderCard: {
    width: 60,
    height: 80,
    backgroundColor: '#FED7AA',
    borderRadius: 8,
    marginHorizontal: 8,
    padding: 8,
    alignItems: 'center',
    opacity: 0.7,
  },
  placeholderCardCenter: {
    width: 70,
    height: 95,
    backgroundColor: '#FDBA74',
    borderRadius: 8,
    marginHorizontal: 8,
    padding: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  placeholderAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EA580C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  placeholderLine: {
    width: '80%',
    height: 4,
    backgroundColor: '#FFF',
    borderRadius: 2,
    marginBottom: 4,
  },
  placeholderLineShort: {
    width: '50%',
    height: 4,
    backgroundColor: '#FFF',
    borderRadius: 2,
  },
  sheetCardInside: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  textButton: {
    paddingVertical: 10,
  },
  textButtonText: {
    color: '#FA7A25',
    fontWeight: '600',
    fontSize: 14,
  },
  sheetCardMatched: {
    width: '100%',
    backgroundColor: '#FFF',
    bottom: -20,
    padding: 20,
  },
  matchedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 16,
  },
  matchedInnerCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 16,
  },
  matchedRow: {
    flexDirection: 'row',
  },
  matchedLeftCol: {
    width: '35%',
    alignItems: 'center',
    marginRight: 16,
  },
  matchedAvatarBox: {
    width: '100%',
    backgroundColor: '#FDBA74', 
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  matchedAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EA580C',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  matchedAvatarLines: {
    width: '100%',
    alignItems: 'center',
  },
  qrCodeBox: {
    width: 70,
    height: 70,
    justifyContent: 'center',
    alignItems: 'center',
  },
  matchedRightCol: {
    flex: 1,
  },
  matchedName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  carDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  carText: {
    fontSize: 9,
    color: '#000',
    marginBottom: 2,
  },
  contactIcons: {
    justifyContent: 'space-around',
  },
  contactIconCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  timelineSmall: {
    marginBottom: 12,
  },
  timelinePointSmall: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timelineLineSmall: {
    width: 1,
    height: 16,
    backgroundColor: '#D1D5DB',
    marginLeft: 5,
    marginVertical: 2,
  },
  timelineMainTextSmall: {
    fontSize: 10,
    fontWeight: '500',
    color: '#000',
  },
  timelineSubTextSmall: {
    fontSize: 8,
    color: '#6B7280',
  },
  scheduledForText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  scheduledTimeText: {
    fontSize: 11,
    color: '#000',
    marginBottom: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 12,
    color: '#000',
  },
  totalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  confirmTextButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  confirmTextButtonLabel: {
    color: '#FA7A25',
    fontWeight: '600',
    fontSize: 14,
  },
});