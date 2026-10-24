// src/modules/Dashboard/Sender/LocationSelectScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar,
  Dimensions, ActivityIndicator, Animated, Easing, TextInput, FlatList, Keyboard, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext'; 

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

// INSERT YOUR API KEY HERE FOR SEARCH & GEOCODING
const GOOGLE_MAPS_API_KEY = 'AIzaSyCxrMHnuiiXQPAWpqFECYHjoE8CNOOxVrg';

const CEBU_QUICK_SPOTS = [
  { name: 'IT Park', lat: 10.3288, lon: 123.9065 },
  { name: 'Ayala Center', lat: 10.3179, lon: 123.9051 },
  { name: 'SM City Cebu', lat: 10.3126, lon: 123.9189 },
  { name: 'Colon St.', lat: 10.2974, lon: 123.8967 },
  { name: 'Fuente Osmeña', lat: 10.3120, lon: 123.8917 },
  { name: 'USC Talamban', lat: 10.3542, lon: 123.9125 },
];

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  
  const mapRef = useRef<MapView>(null);

  const [markerCoord, setMarkerCoord] = useState({
    latitude: initialCoords?.latitude || 10.3157,
    longitude: initialCoords?.longitude || 123.8854,
  });

  const [addressName, setAddressName] = useState<string>('Loading...');
  const [addressSub, setAddressSub] = useState<string>('');
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);

  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '',
    barangay: '',
    city: '',
    province: '',
    zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const topAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
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
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  // Google Maps Reverse Geocoding
  const reverseGeocode = async (coords: { latitude: number; longitude: number }) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const json = await response.json();
      
      if (json.status === 'OK' && json.results.length > 0) {
        const result = json.results[0];
        const components = result.address_components;

        const getComponent = (type: string) => 
          components.find((c: any) => c.types.includes(type))?.long_name || '';

        const street = getComponent('route') || result.formatted_address.split(',')[0];
        const barangay = getComponent('sublocality') || getComponent('neighborhood') || 'Unknown';
        const city = getComponent('locality') || getComponent('administrative_area_level_2') || 'Unknown';
        const province = getComponent('administrative_area_level_1') || 'Unknown';
        const zip = getComponent('postal_code') || '0000';

        setAddressName(street);
        setAddressSub(result.formatted_address);
        
        setStructuredAddress({
          street_address: street,
          barangay,
          city,
          province,
          zip_code: zip,
        });
        return;
      }
    } catch (err) {
      console.warn('Google Geocode failed, falling back to expo-location', err);
    }

    // Fallback to expo-location
    try {
      const [addr] = await Location.reverseGeocodeAsync(coords);
      if (addr) {
        const mainName = addr.name || addr.street || 'Selected Location';
        const subParts = [
          addr.street !== addr.name ? addr.street : null,
          addr.city,
          addr.region,
        ].filter(Boolean).join(', ');

        setAddressName(mainName);
        setAddressSub(subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
        
        setStructuredAddress({
          street_address: mainName,
          barangay: addr.district || addr.subregion || 'Unknown',
          city: addr.city || addr.subregion || 'Unknown',
          province: addr.region || 'Unknown',
          zip_code: addr.postalCode || '0000',
        });
        return;
      }
    } catch (err) {
      // Ignore
    }
    
    setAddressName('Unknown Location');
    setAddressSub('Unable to fetch address details');
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
      
      mapRef.current?.animateToRegion({
        latitude: newCoords.latitude,
        longitude: newCoords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    })();
  }, [type, initialCoords]);

  const handleLocateMe = async () => {
    try {
      setLocating(true);
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setMarkerCoord(newCoords);
      reverseGeocode(newCoords);
      
      mapRef.current?.animateToRegion({
        latitude: newCoords.latitude,
        longitude: newCoords.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      });
    } catch {
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
    setStructuredAddress({
      street_address: spot.name,
      barangay: 'Unknown',
      city: 'Cebu City',
      province: 'Cebu',
      zip_code: '6000',
    });
    
    mapRef.current?.animateToRegion({
      latitude: spot.lat,
      longitude: spot.lon,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    });
  };

  // Google Places API Text Search
  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      setSearchLoading(true);
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(text + ', Cebu, Philippines')}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.log('Search error:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectSearchResult = (item: any) => {
    const lat = item.geometry.location.lat;
    const lon = item.geometry.location.lng;
    const newCoords = { latitude: lat, longitude: lon };

    setMarkerCoord(newCoords);
    setAddressName(item.name || 'Selected Location');
    setAddressSub(item.formatted_address || '');
    
    // We do a fresh reverse geocode to get the structured fields properly
    reverseGeocode(newCoords);

    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    Keyboard.dismiss();

    mapRef.current?.animateToRegion({
      latitude: lat,
      longitude: lon,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    });
  };

  const confirmLocation = () => {
    const fullAddress = `${addressName}, ${addressSub}`;
    const locationInfo = {
      address: fullAddress, 
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress, 
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
      navigation.navigate('Booking', { mode });
    }
  };

  const isPickup = type === 'pickup';
  const badgeBg = isPickup
    ? (isDark ? '#2A1A0E' : '#FFF7ED')
    : (isDark ? '#2A1214' : '#FEF2F2');
  const badgeTextColor = isPickup
    ? (isDark ? '#FDBA74' : '#C2410C')
    : (isDark ? '#F87171' : '#DC2626');

  const onRegionChange = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
  };

  const onRegionChangeComplete = (region: Region) => {
    setIsDraggingMap(false);
    const newCoords = { latitude: region.latitude, longitude: region.longitude };
    setMarkerCoord(newCoords);
    reverseGeocode(newCoords);
  };

  const pinTranslateY = pinBounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -12],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={{
          latitude: markerCoord.latitude,
          longitude: markerCoord.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        onMapReady={() => setMapLoaded(true)}
        onRegionChange={onRegionChange}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation={false} 
        showsMyLocationButton={false}
        showsCompass={false}
      />

      {!mapLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

      {/* Floating Center Pin */}
      <View style={styles.centerPinContainer} pointerEvents="none">
        <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinTranslateY }] }]}>
          <View style={styles.pinHead}>
            <Ionicons name={isPickup ? 'radio-button-on' : 'location'} size={22} color="#FFFFFF" />
          </View>
          <View style={styles.pinPoint} />
        </Animated.View>
        <View style={styles.pinShadow} />
      </View>

      <Animated.View style={[styles.topOverlay, { top: insets.top + 10 }, fadeUp(topAnim, -20)]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
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
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </Animated.View>

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
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder={isPickup ? 'Search pickup in Cebu...' : 'Search drop-off in Cebu...'}
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={handleSearch}
                autoFocus
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearch('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
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
              <TouchableOpacity style={styles.searchResultItem} onPress={() => selectSearchResult(item)}>
                <View style={styles.searchResultIconBox}>
                  <Ionicons name="location-outline" size={18} color={ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.searchResultTitle} numberOfLines={1}>
                    {item.name || item.formatted_address?.split(',')[0]}
                  </Text>
                  <Text style={styles.searchResultSub} numberOfLines={2}>
                    {item.formatted_address}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

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

      <Animated.View style={[styles.locateMeWrapper, fadeUp(topAnim, -20)]} pointerEvents="box-none">
        <TouchableOpacity style={styles.locateMeBtn} onPress={handleLocateMe} disabled={locating} activeOpacity={0.85}>
          {locating ? (
            <ActivityIndicator size="small" color={ORANGE} />
          ) : (
            <Ionicons name="locate" size={20} color={ORANGE} />
          )}
        </TouchableOpacity>
      </Animated.View>

      <Animated.View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 16 }, fadeUp(sheetAnim, 30)]}>
        <View style={styles.dragHandle} />

        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderLeft}>
            <View style={[styles.sheetIconBox, { backgroundColor: badgeBg }]}>
              <Ionicons name={isPickup ? 'radio-button-on' : 'location'} size={18} color={badgeTextColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>
                {isPickup ? 'Confirm Pickup Location' : 'Confirm Drop-off Location'}
              </Text>
              <Text style={styles.sheetSub}>Pan map or select quick spot above</Text>
            </View>
          </View>
        </View>

        <View style={styles.addressCard}>
          <View style={styles.addressAccentBar} />
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressMainText} numberOfLines={1}>{addressName}</Text>
            <Text style={styles.addressSubText} numberOfLines={2}>
              {addressSub || 'Fetching exact address...'}
            </Text>
          </View>
        </View>

        <View style={styles.coordsRow}>
          <Ionicons name="navigate-outline" size={12} color={colors.textMuted} />
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
            <Ionicons name="arrow-forward" size={16} color={colors.card} />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  map: { flex: 1 },

  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  loadingText: { fontSize: 13, color: c.textSecondary, marginTop: 12, fontWeight: '500' },

  centerPinContainer: {
    position: 'absolute', top: '50%', left: '50%',
    marginLeft: -22, marginTop: -44,
    alignItems: 'center', zIndex: 4, pointerEvents: 'none',
  },
  pinWrapper: { alignItems: 'center' },
  pinHead: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
  pinPoint: {
    width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid',
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: ORANGE, marginTop: -1,
  },
  pinShadow: {
    width: 12, height: 4, borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.25)', marginTop: 2,
  },

  topOverlay: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', zIndex: 5,
  },
  backCircleBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 8, elevation: 5,
    marginRight: 10, borderWidth: 1, borderColor: c.border,
  },
  searchPill: {
    flex: 1, height: 54, backgroundColor: c.card, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.4 : 0.1, shadowRadius: 8, elevation: 5,
    borderWidth: 1, borderColor: c.border, gap: 10,
  },
  badgeIndicator: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  searchPillTextContainer: { flex: 1 },
  searchPillLabel: {
    fontSize: 8, fontWeight: '800', color: c.textMuted,
    letterSpacing: 0.8, marginBottom: 1,
  },
  searchPillText: {
    fontSize: 13, color: c.textPrimary, fontWeight: '700', letterSpacing: -0.2,
  },

  quickChipsWrapper: {
    position: 'absolute', top: 135, left: 0, right: 0, zIndex: 5,
  },
  quickChip: {
    backgroundColor: c.card, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.08, shadowRadius: 4, elevation: 3,
  },
  quickChipText: { fontSize: 11, fontWeight: '700', color: c.textPrimary },

  searchOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: c.background, zIndex: 20, flex: 1,
  },
  searchModalHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: c.divider, gap: 10,
  },
  searchInputWrapper: {
    flex: 1, height: 46, backgroundColor: c.card, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    borderWidth: 1, borderColor: c.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: c.textPrimary, fontWeight: '600' },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: c.divider, gap: 14,
  },
  searchResultIconBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: ORANGE,
  },
  searchResultTitle: {
    fontSize: 14, fontWeight: '700', color: c.textPrimary, marginBottom: 2,
  },
  searchResultSub: {
    fontSize: 11, color: c.textSecondary, fontWeight: '500', lineHeight: 15,
  },

  locateMeWrapper: { position: 'absolute', right: 16, bottom: 270, zIndex: 6 },
  locateMeBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 8, elevation: 5,
    borderWidth: 1, borderColor: c.border,
  },

  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: c.card, paddingTop: 8, paddingHorizontal: 20,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 12,
    zIndex: 5,
  },
  dragHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: c.border, alignSelf: 'center', marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  sheetHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sheetIconBox: {
    width: 38, height: 38, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  sheetTitle: {
    fontSize: 15, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2,
  },
  sheetSub: { fontSize: 11, color: c.textSecondary, marginTop: 1, fontWeight: '500' },

  addressCard: {
    flexDirection: 'row', backgroundColor: c.background, borderRadius: 14,
    padding: 12, paddingLeft: 16, marginBottom: 8,
    borderWidth: 1, borderColor: c.border,
    position: 'relative', overflow: 'hidden',
  },
  addressAccentBar: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
    backgroundColor: ORANGE, borderTopRightRadius: 4, borderBottomRightRadius: 4,
  },
  addressTextContainer: { flex: 1 },
  addressMainText: {
    fontSize: 14, fontWeight: '800', color: c.textPrimary,
    marginBottom: 2, letterSpacing: -0.2,
  },
  addressSubText: { fontSize: 11, color: c.textSecondary, lineHeight: 15, fontWeight: '500' },

  coordsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: 14, paddingLeft: 2,
  },
  coordsText: {
    fontSize: 10, color: c.textMuted, fontWeight: '600', letterSpacing: 0.3,
  },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.textPrimary, borderRadius: 16, paddingVertical: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 8, elevation: 4,
  },
  confirmBtnText: {
    color: c.card, fontSize: 15, fontWeight: '700', letterSpacing: 0.2,
  },
});