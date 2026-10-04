// src/modules/Dashboard/Sender/LocationSelectScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar,
  Dimensions, ActivityIndicator, Animated, Easing, TextInput, FlatList, Keyboard, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

// Popular Cebu quick-select landmarks for effortless micro-move booking
const CEBU_QUICK_SPOTS = [
  { name: 'IT Park', lat: 10.3288, lon: 123.9065 },
  { name: 'Ayala Center', lat: 10.3179, lon: 123.9051 },
  { name: 'SM City Cebu', lat: 10.3126, lon: 123.9189 },
  { name: 'Colon St.', lat: 10.2974, lon: 123.8967 },
  { name: 'Fuente Osmeña', lat: 10.3120, lon: 123.8917 },
  { name: 'USC Talamban', lat: 10.3542, lon: 123.9125 },
];

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
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        window.map = L.map('map', {zoomControl: false}).setView([10.3157, 123.8854], 16);
        
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
          maxZoom: 19
        }).addTo(window.map);

        window.map.on('movestart', function() {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MOVE_START' }));
        });

        window.map.on('moveend', function() {
          var center = window.map.getCenter();
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'MOVE_END',
            latitude: center.lat,
            longitude: center.lng
          }));
        });
      </script>
    </body>
  </html>
`;

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  const [markerCoord, setMarkerCoord] = useState({
    latitude: initialCoords?.latitude || 10.3157,
    longitude: initialCoords?.longitude || 123.8854,
  });

  const [addressName, setAddressName] = useState<string>('Loading...');
  const [addressSub, setAddressSub] = useState<string>('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);

  // Search States
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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
  }, [topAnim, sheetAnim]);

  useEffect(() => {
    Animated.timing(pinBounce, {
      toValue: isDraggingMap ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [isDraggingMap, pinBounce]);

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

  /* Reverse Geocode */
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
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (window.map) {
            window.map.setView([${newCoords.latitude}, ${newCoords.longitude}], 16);
          }
          true;
        `);
      }
    })();
  }, [type, initialCoords]);

  const handleLocateMe = async () => {
    try {
      setLocating(true);
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMarkerCoord(newCoords);
      reverseGeocode(newCoords);
      if (webViewRef.current) {
        webViewRef.current.injectJavaScript(`
          if (window.map) {
            window.map.setView([${newCoords.latitude}, ${newCoords.longitude}], 16);
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

  const handleQuickSpotSelect = (spot: { lat: number; lon: number; name: string }) => {
    const newCoords = { latitude: spot.lat, longitude: spot.lon };
    setMarkerCoord(newCoords);
    setAddressName(spot.name);
    setAddressSub('Cebu City, Cebu, Philippines');
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (window.map) {
          window.map.setView([${spot.lat}, ${spot.lon}], 17);
        }
        true;
      `);
    }
  };

  /* Fixed Search Bar with proper User-Agent headers */
  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setSearchLoading(true);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text + ', Cebu, Philippines')}&addressdetails=1&limit=8`,
        {
          headers: {
            'User-Agent': 'PackNShipMobileApp/1.0 (capstone.ctu@gmail.com)',
            'Accept': 'application/json',
          },
        }
      );
      const data = await response.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.log('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectSearchResult = (item: any) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    const newCoords = { latitude: lat, longitude: lon };

    setMarkerCoord(newCoords);
    setAddressName(item.display_name ? item.display_name.split(',')[0] : 'Selected Location');
    setAddressSub(item.display_name || '');
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    Keyboard.dismiss();

    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (window.map) {
          window.map.setView([${lat}, ${lon}], 17);
        }
        true;
      `);
    }
  };

  const confirmLocation = () => {
    const fullAddress = `${addressName}, ${addressSub}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
    };

    if (route.params?.fromExplore) {
      if (route.params.for === 'pickup') {
        dispatch({ type: 'SET_EXPLORE_PICKUP', payload: locationInfo });
      } else {
        dispatch({ type: 'SET_EXPLORE_DROPOFF', payload: locationInfo });
      }
      navigation.goBack();
      return;
    }

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
  // Distinct modern palette for Pack-N-Ship (Deep Navy & Vibrant Orange accent)
  const themeColor = ORANGE;
  const badgeBg = isPickup ? '#FFF7ED' : '#FEF2F2';
  const badgeTextColor = isPickup ? '#C2410C' : '#DC2626';

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MOVE_START') {
        setIsDraggingMap(true);
      } else if (data.type === 'MOVE_END' && data.latitude && data.longitude) {
        setIsDraggingMap(false);
        const newCoords = { latitude: data.latitude, longitude: data.longitude };
        setMarkerCoord(newCoords);
        reverseGeocode(newCoords);
      }
    } catch (error) {
      console.log('Error parsing map message:', error);
    }
  };

  const handleWebViewLoad = () => {
    setMapLoaded(true);
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`
        if (window.map) {
          window.map.setView([${markerCoord.latitude}, ${markerCoord.longitude}], 16);
        }
        true;
      `);
    }
  };

  const pinTranslateY = pinBounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -12],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: openStreetMapHtml }}
        onMessage={handleMessage}
        onLoadEnd={handleWebViewLoad}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        androidLayerType="hardware"
        originWhitelist={['*']}
        mixedContentMode="always"
      />

      {!mapLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      {/* Floating Center Pin with Pack-N-Ship Branding */}
      <View style={styles.centerPinContainer} pointerEvents="none">
        <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinTranslateY }] }]}>
          <View style={styles.pinHead}>
            <Ionicons name={isPickup ? "radio-button-on" : "location"} size={22} color="#FFFFFF" />
          </View>
          <View style={styles.pinPoint} />
        </Animated.View>
        <View style={styles.pinShadow} />
      </View>

      {/* Top Floating Glass Header */}
      <Animated.View
        style={[styles.topOverlay, { top: insets.top + 10 }, fadeUp(topAnim, -20)]}
      >
        <TouchableOpacity
          style={styles.backCircleBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.searchPill}
          activeOpacity={0.9}
          onPress={() => setIsSearching(true)}
        >
          <View style={[styles.badgeIndicator, { backgroundColor: badgeBg }]}>
            <Text style={[styles.badgeText, { color: badgeTextColor }]}>
              {isPickup ? 'STEP 1' : 'STEP 2'}
            </Text>
          </View>
          <View style={styles.searchPillTextContainer}>
            <Text style={styles.searchPillLabel}>
              {isPickup ? 'SET PICKUP LOCATION' : 'SET DROPOFF LOCATION'}
            </Text>
            <Text style={styles.searchPillText} numberOfLines={1}>
              {addressName !== 'Loading...' ? addressName : 'Tap to search Cebu address...'}
            </Text>
          </View>
          <Ionicons name="search-outline" size={18} color="#6B7280" />
        </TouchableOpacity>
      </Animated.View>

      {/* Search Modal / Overlay */}
      {isSearching && (
        <View style={[styles.searchOverlay, { paddingTop: insets.top + 10 }]}>
          <View style={styles.searchModalHeader}>
            <TouchableOpacity
              style={styles.backCircleBtn}
              onPress={() => {
                setIsSearching(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#111827" />
            </TouchableOpacity>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder={isPickup ? 'Search pickup in Cebu...' : 'Search drop-off in Cebu...'}
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={handleSearch}
                autoFocus
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearch('')}>
                  <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {searchLoading && (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={ORANGE} />
            </View>
          )}

          <FlatList
            data={searchResults}
            keyExtractor={(item, index) => `${item.place_id || index}`}
            keyboardShouldPersistTaps="handled"
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.searchResultItem}
                onPress={() => selectSearchResult(item)}
              >
                <View style={styles.searchResultIconBox}>
                  <Ionicons name="location-outline" size={18} color={ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultTitle} numberOfLines={1}>
                    {item.display_name ? item.display_name.split(',')[0] : 'Location'}
                  </Text>
                  <Text style={styles.searchResultSub} numberOfLines={2}>
                    {item.display_name}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Quick Access Cebu Hotspot Chips */}
      <Animated.View style={[styles.quickChipsWrapper, fadeUp(topAnim, -10)]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
        >
          {CEBU_QUICK_SPOTS.map((spot, idx) => (
            <TouchableOpacity
              key={idx}
              style={styles.quickChip}
              onPress={() => handleQuickSpotSelect(spot)}
              activeOpacity={0.8}
            >
              <Ionicons name="flash-outline" size={12} color={ORANGE} />
              <Text style={styles.quickChipText}>{spot.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Animated.View>

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

      {/* Floating Modern Bottom Sheet Card */}
      <Animated.View
        style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }, fadeUp(sheetAnim, 30)]}
      >
        <View style={styles.dragHandle} />

        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderLeft}>
            <View style={[styles.sheetIconBox, { backgroundColor: badgeBg }]}>
              <Ionicons
                name={isPickup ? "radio-button-on" : "location"}
                size={18}
                color={badgeTextColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>
                {isPickup ? 'Confirm Pickup Location' : 'Confirm Drop-off Location'}
              </Text>
              <Text style={styles.sheetSub}>
                Pan map or select quick spot above
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.addressCard}>
          <View style={styles.addressAccentBar} />
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressMainText} numberOfLines={1}>
              {addressName}
            </Text>
            <Text style={styles.addressSubText} numberOfLines={2}>
              {addressSub || 'Fetching exact address...'}
            </Text>
          </View>
        </View>

        <View style={styles.coordsRow}>
          <Ionicons name="navigate-outline" size={12} color="#9CA3AF" />
          <Text style={styles.coordsText}>
            GPS: {markerCoord.latitude.toFixed(5)}, {markerCoord.longitude.toFixed(5)}
          </Text>
        </View>

        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={confirmLocation}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            activeOpacity={0.9}
          >
            <Text style={styles.confirmBtnText}>
              {isPickup ? 'Confirm Pickup Point' : 'Confirm Dropoff Point'}
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

  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -22,
    marginTop: -44,
    alignItems: 'center',
    zIndex: 4,
    pointerEvents: 'none',
  },
  pinWrapper: {
    alignItems: 'center',
  },
  pinHead: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 8,
  },
  pinPoint: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: ORANGE,
    marginTop: -1,
  },
  pinShadow: {
    width: 12,
    height: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.25)',
    marginTop: 2,
  },

  topOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
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
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchPill: {
    flex: 1,
    height: 54,
    backgroundColor: '#FFF',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 10,
  },
  badgeIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  searchPillTextContainer: { flex: 1 },
  searchPillLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.8,
    marginBottom: 1,
  },
  searchPillText: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  quickChipsWrapper: {
    position: 'absolute',
    top: 135,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  quickChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  quickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111827',
  },

  searchOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFFFFF',
    zIndex: 20,
    flex: 1,
  },
  searchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    height: 46,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
    gap: 14,
  },
  searchResultIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  searchResultTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  searchResultSub: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    lineHeight: 15,
  },

  locateMeWrapper: {
    position: 'absolute',
    right: 16,
    bottom: 270,
    zIndex: 6,
  },
  locateMeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 12,
    zIndex: 5,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  sheetIconBox: {
    width: 38,
    height: 38,
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
    marginTop: 1,
    fontWeight: '500',
  },

  addressCard: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 12,
    paddingLeft: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    position: 'relative',
    overflow: 'hidden',
  },
  addressAccentBar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 4,
    backgroundColor: ORANGE,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  addressTextContainer: { flex: 1 },
  addressMainText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  addressSubText: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 15,
    fontWeight: '500',
  },

  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 14,
    paddingLeft: 2,
  },
  coordsText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});