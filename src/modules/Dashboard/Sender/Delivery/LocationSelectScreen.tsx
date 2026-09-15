import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar,
  Dimensions, ActivityIndicator, Animated, Easing, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  const [region] = useState({
    latitude: 10.3157,
    longitude: 123.8854,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  });

  const [markerCoord, setMarkerCoord] = useState({
    latitude: region.latitude,
    longitude: region.longitude,
  });

  const [addressName, setAddressName] = useState<string>('Loading...');
  const [addressSub, setAddressSub] = useState<string>('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);

  // Animations
  const topAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

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
      animate(topAnim, 0),
      animate(sheetAnim, 220),
    ]).start();

    const bounce = Animated.loop(
      Animated.sequence([
        Animated.timing(pinBounce, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pinBounce, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    bounce.start();
    return () => bounce.stop();
  }, [topAnim, sheetAnim, pinBounce]);

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

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

  /* ------------------------------------------------------------------ */
  /* Reverse geocode                                                     */
  /* ------------------------------------------------------------------ */
  const reverseGeocode = async (coords: { latitude: number; longitude: number }) => {
    try {
      const [addr] = await Location.reverseGeocodeAsync(coords);
      if (addr) {
        const mainName = addr.name || addr.street || 'Selected Location';
        const subParts = [
          addr.street !== addr.name ? addr.street : null,
          addr.city,
          addr.region,
        ]
          .filter(Boolean)
          .join(', ');

        setAddressName(mainName);
        setAddressSub(subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      } else {
        setAddressName('Selected Location');
        setAddressSub(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      }
    } catch {
      setAddressName('Unknown Location');
      setAddressSub('Unable to fetch address details');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Initial load                                                        */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (type === 'dropoff' && initialCoords) {
      setMarkerCoord(initialCoords);
      reverseGeocode(initialCoords);
      return;
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location is needed to select an address.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMarkerCoord(newCoords);
      reverseGeocode(newCoords);
    })();
  }, [type, initialCoords]);

  /* ------------------------------------------------------------------ */
  /* Locate me button                                                    */
  /* ------------------------------------------------------------------ */
  const handleLocateMe = async () => {
    try {
      setLocating(true);
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMarkerCoord(newCoords);
      reverseGeocode(newCoords);
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (window.map && window.marker) {
            window.map.setView([${newCoords.latitude}, ${newCoords.longitude}], 15);
            window.marker.setLatLng([${newCoords.latitude}, ${newCoords.longitude}]);
          }
          true;
        `);
      }
    } catch (error) {
      Alert.alert('Error', 'Could not fetch your current location.');
    } finally {
      setLocating(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Confirm                                                             */
  /* ------------------------------------------------------------------ */
  const confirmLocation = () => {
    const fullAddress = `${addressName}, ${addressSub}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
    };

    if (type === 'pickup') {
      dispatch({ type: 'SET_PICKUP_LOCATION', payload: locationInfo });
      navigation.navigate('DropoffLocation', {
        type: 'dropoff',
        initialCoords: markerCoord,
      });
    } else {
      dispatch({ type: 'SET_DROPOFF_LOCATION', payload: locationInfo });
      const cost = Math.floor(Math.random() * 30) + 20;
      dispatch({ type: 'SET_ESTIMATED_COST', payload: cost });
      navigation.navigate('Booking', { mode });
    }
  };

  const isPickup = type === 'pickup';
  const themeColor = isPickup ? '#0000CC' : '#C8102E';

  const TypeIcon = ({ size = 20 }: { size?: number }) => {
    if (isPickup) {
      return (
        <View
          style={[
            styles.pickupIconOuter,
            { width: size, height: size, borderRadius: size / 2, borderColor: themeColor },
          ]}
        >
          <View
            style={[
              styles.pickupIconInner,
              {
                backgroundColor: themeColor,
                width: size * 0.4,
                height: size * 0.4,
                borderRadius: size * 0.2,
              },
            ]}
          />
        </View>
      );
    }
    return <Ionicons name="location" size={size * 1.2} color={themeColor} />;
  };

  /* ------------------------------------------------------------------ */
  /* Map HTML                                                            */
  /* ------------------------------------------------------------------ */
  const openStreetMapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { height: 100vh; width: 100vw; background: #E5E7EB; }
          .custom-pin {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            background: ${themeColor};
            border: 3px solid white;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          window.map = L.map('map').setView([${markerCoord.latitude}, ${markerCoord.longitude}], 15);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19
          }).addTo(window.map);

          var pinIcon = L.divIcon({
            className: '',
            html: '<div class="custom-pin"></div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
          });

          window.marker = L.marker([${markerCoord.latitude}, ${markerCoord.longitude}], {
            draggable: true,
            icon: pinIcon
          }).addTo(window.map);

          window.marker.on('dragend', function(e) {
            var pos = window.marker.getLatLng();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              latitude: pos.lat,
              longitude: pos.lng
            }));
          });

          window.map.on('click', function(e) {
            var pos = e.latlng;
            window.marker.setLatLng(pos);
            window.ReactNativeWebView.postMessage(JSON.stringify({
              latitude: pos.lat,
              longitude: pos.lng
            }));
          });
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.latitude && data.longitude) {
        const newCoords = { latitude: data.latitude, longitude: data.longitude };
        setMarkerCoord(newCoords);
        reverseGeocode(newCoords);
      }
    } catch (error) {
      console.log('Error parsing map message:', error);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const pinScale = pinBounce.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Map */}
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: openStreetMapHtml }}
        onMessage={handleMessage}
        onLoadEnd={() => setMapLoaded(true)}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        androidLayerType="hardware"
      />

      {!mapLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      {/* Center pin shadow */}
      <View style={styles.centerPinOverlay} pointerEvents="none">
        <Animated.View style={[styles.centerPinShadow, { transform: [{ scale: pinScale }] }]} />
      </View>

      {/* Top Overlay */}
      <Animated.View
        style={[styles.topOverlay, { top: insets.top + 10 }, fadeUp(topAnim, -20)]}
      >
        <TouchableOpacity
          style={styles.backCircleBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>

        <View style={styles.searchPill}>
          <TypeIcon size={16} />
          <View style={styles.searchPillTextContainer}>
            <Text style={styles.searchPillLabel}>
              {isPickup ? 'PICKUP POINT' : 'DROPOFF POINT'}
            </Text>
            <Text style={styles.searchPillText}>
              {isPickup ? 'Where do we pick up?' : 'Where do we drop off?'}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Locate Me Button */}
      <Animated.View
        style={[styles.locateMeWrapper, fadeUp(topAnim, -20)]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          style={styles.locateMeBtn}
          onPress={handleLocateMe}
          disabled={locating}
          activeOpacity={0.85}
        >
          {locating ? (
            <ActivityIndicator size="small" color={ORANGE} />
          ) : (
            <Ionicons name="locate" size={20} color={ORANGE} />
          )}
        </TouchableOpacity>
      </Animated.View>

      {/* Bottom Sheet */}
      <Animated.View
        style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }, fadeUp(sheetAnim, 30)]}
      >
        <View style={styles.dragHandle} />

        {/* Header */}
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderLeft}>
            <View
              style={[
                styles.sheetIconBox,
                { backgroundColor: isPickup ? '#EFF6FF' : '#FEF2F2' },
              ]}
            >
              <TypeIcon size={16} />
            </View>
            <View>
              <Text style={styles.sheetTitle}>
                {isPickup ? 'Pick-up point' : 'Drop-off point'}
              </Text>
              <Text style={styles.sheetSub}>
                Drag the pin or tap the map to adjust
              </Text>
            </View>
          </View>
        </View>

        {/* Address Card */}
        <View style={styles.addressCard}>
          <View
            style={[
              styles.addressAccentBar,
              { backgroundColor: themeColor },
            ]}
          />
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressMainText} numberOfLines={1}>
              {addressName}
            </Text>
            <Text style={styles.addressSubText} numberOfLines={2}>
              {addressSub || 'Fetching address...'}
            </Text>
          </View>
        </View>

        {/* Coordinates */}
        <View style={styles.coordsRow}>
          <Ionicons name="navigate-outline" size={12} color="#9CA3AF" />
          <Text style={styles.coordsText}>
            {markerCoord.latitude.toFixed(5)}, {markerCoord.longitude.toFixed(5)}
          </Text>
        </View>

        {/* Confirm */}
        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          <TouchableOpacity
            style={[styles.confirmBtn, { backgroundColor: themeColor }]}
            onPress={confirmLocation}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            activeOpacity={0.9}
          >
            <Text style={styles.confirmBtnText}>
              {isPickup ? 'Confirm Pickup' : 'Confirm Dropoff'}
            </Text>
            <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  map: { flex: 1 },

  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 12,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Center Pin Overlay                                                  */
  /* ------------------------------------------------------------------ */
  centerPinOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -20,
    marginTop: -20,
    zIndex: 3,
    pointerEvents: 'none',
  },
  centerPinShadow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(242,112,36,0.15)',
  },

  /* ------------------------------------------------------------------ */
  /* Top Overlay                                                         */
  /* ------------------------------------------------------------------ */
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5,
  },
  backCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  searchPill: {
    flex: 1,
    height: 56,
    backgroundColor: '#FFF',
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    gap: 12,
  },
  searchPillTextContainer: { flex: 1 },
  searchPillLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1,
    marginBottom: 2,
  },
  searchPillText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  pickupIconOuter: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupIconInner: {},

  /* ------------------------------------------------------------------ */
  /* Locate Me                                                           */
  /* ------------------------------------------------------------------ */
  locateMeWrapper: {
    position: 'absolute',
    right: 20,
    bottom: 380,
    zIndex: 6,
  },
  locateMeBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },

  /* ------------------------------------------------------------------ */
  /* Bottom Sheet                                                        */
  /* ------------------------------------------------------------------ */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    paddingTop: 10,
    paddingHorizontal: 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 5,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  sheetIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  sheetSub: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },

  /* Address Card */
  addressCard: {
    flexDirection: 'row',
    backgroundColor: '#FAFAFA',
    borderRadius: 16,
    padding: 14,
    paddingLeft: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    position: 'relative',
    overflow: 'hidden',
  },
  addressAccentBar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  addressTextContainer: { flex: 1 },
  addressMainText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  addressSubText: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 15,
    fontWeight: '500',
  },

  /* Coordinates */
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 16,
    paddingLeft: 4,
  },
  coordsText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  /* Confirm */
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});