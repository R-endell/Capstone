// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, StatusBar,
  Alert, ActivityIndicator, ScrollView, Platform, Animated, Easing,
  TextInput, Keyboard, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '../../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../../../utils/mapConfig';
import {
  getTodayRouteStats,
  createProviderRouteWithGuardrails,
  updateProviderRouteWithGuardrails,
  canEditRoute,
  softDeleteProviderRoute,
  MAX_DAILY_ROUTES,
} from '../../../../services/routeService';
import { getDemoMode, setDemoMode, subscribeDemoMode } from '../../../../services/activeRouteStore';

const ORANGE = '#FF751F';
const BLUE = '#3B82F6';
const RED = '#EF4444';
const PURPLE = '#8B5CF6';
const BLACK = '#111827';
const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 6;
const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;
const NEARBY_RADIUS_M = 200;
const LABEL_SNAP_M = 60;
const REJECTED_PLACE_TYPES = new Set(['route', 'street_address', 'postal_code', 'plus_code']);

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_API_KEY = GOOGLE_MAPS_API_KEY.length > 10;

interface LocationType {
  location_id: number;
  street_address: string;
  barangay: string;
  city: string;
  province: string;
  zip_code: string;
  latitude: number;
  longitude: number;
}
interface Vehicle {
  vehicle_id: number;
  vehicle_type: string;
  plate_number: string;
  max_weight_kg?: number;
  max_volume_liters?: number;
}
interface Route {
  route_id: number;
  departure_time: string;
  end_time?: string | null;
  route_frequency: string;
  created_at: string;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  route_distance_km?: number;
  remaining_weight_kg?: number;
  remaining_volume_liters?: number;
  fallback_unlocked?: boolean;
  fallback_reason?: 'CONDITION_A' | 'CONDITION_B' | null;
  fallback_used?: boolean;
  admin_review_flag?: boolean;
  is_deleted?: boolean;
  is_active?: boolean;
  start_location?: LocationType;
  end_location?: LocationType;
  vehicle?: Vehicle;
}
type Coord = { latitude: number; longitude: number };
type RecentEntry = { name: string; address: string; latitude: number; longitude: number; ts: number };
type SearchResult = {
  place_id: string; name: string; formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};
type NearbyPlace = { id: string; name: string; address: string; latitude: number; longitude: number; dist: number };
type Label = { name: string; sub?: string };

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */
const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

const parseNaiveIsoString = (isoString: string) => {
  if (!isoString) return new Date();
  const parts = isoString.split(/[-T:+Z]/);
  if (parts.length < 5) return new Date();
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const hh = parseInt(parts[3], 10);
  const mm = parseInt(parts[4], 10);
  return new Date(y, m, d, hh, mm);
};

export const isRouteExpired = (route: {
  route_frequency: string;
  departure_time: string;
  end_time?: string | null;
  is_deleted?: boolean;
  is_active?: boolean;
}): boolean => {
  if (route.is_deleted || route.is_active === false) return true;
  const freq = (route.route_frequency || '').trim().toLowerCase();
  if (freq === 'one-time' || freq === 'custom') {
    const endDt = route.end_time
      ? parseNaiveIsoString(route.end_time)
      : new Date(parseNaiveIsoString(route.departure_time).getTime() + 4 * 60 * 60 * 1000);
    return endDt.getTime() < Date.now();
  }
  return false;
};

const nextWeekday = (weekday: number, from = new Date()): Date => {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'] as const;
const DURATION_OPTIONS = [1, 2, 3, 4] as const; // Rule: Max 4 hours per route
type Frequency = typeof FREQUENCIES[number];
type RouteTab = 'active' | 'expired';

const metersBetween = (a: Coord, b: Coord) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(1)} km`);

const reverseGeocodeGoogle = async (coords: Coord) => {
  if (!HAS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`,
    );
    const json = await response.json();
    if (json.status === 'OK' && json.results.length > 0) {
      const result =
        json.results.find((r: any) =>
          (r.types || []).some((t: string) => ['point_of_interest', 'establishment', 'premise', 'street_address'].includes(t)),
        ) || json.results[0];
      const components = result.address_components || [];
      const get = (t: string) => components.find((c: any) => c.types.includes(t))?.long_name || '';
      const street = get('route') || result.formatted_address.split(',')[0];
      return {
        name: get('point_of_interest') || get('establishment') || get('premise') || street,
        sub: result.formatted_address as string,
        structured: {
          street_address: street,
          barangay: get('sublocality') || get('sublocality_level_1') || get('neighborhood') || 'Unknown',
          city: get('locality') || get('administrative_area_level_2') || 'Unknown',
          province: get('administrative_area_level_1') || 'Unknown',
          zip_code: get('postal_code') || '0000',
        },
      };
    }
  } catch (err) { /* fall through */ }
  return null;
};

const reverseGeocodeExpo = async (coords: Coord) => {
  try {
    const [addr] = await Location.reverseGeocodeAsync(coords);
    if (!addr) return null;
    const mainName = addr.name || addr.street || 'Selected Location';
    const subParts = [addr.street !== addr.name ? addr.street : null, addr.district || addr.subregion, addr.city, addr.region]
      .filter(Boolean).join(', ');
    return {
      name: mainName,
      sub: subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
      structured: {
        street_address: mainName, barangay: addr.district || 'Unknown', city: addr.city || 'Unknown',
        province: addr.region || 'Unknown', zip_code: addr.postalCode || '0000',
      },
    };
  } catch (err) { /* fall through */ }
  return null;
};

const fetchNearbyPlaces = async (coords: Coord): Promise<NearbyPlace[]> => {
  if (!HAS_API_KEY) return [];
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({
        maxResultCount: 12,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: coords, radius: NEARBY_RADIUS_M } },
      }),
    });
    const data = await response.json();
    return (data.places || [])
      .filter((p: any) => p.displayName?.text && p.location && !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
      .map((p: any) => {
        const pc = { latitude: p.location.latitude, longitude: p.location.longitude };
        return {
          id: p.id, name: p.displayName.text, address: p.formattedAddress || '',
          ...pc, dist: metersBetween(coords, pc),
        } as NearbyPlace;
      })
      .sort((a: NearbyPlace, b: NearbyPlace) => a.dist - b.dist);
  } catch (e) {
    console.warn('Nearby lookup failed', e);
  }
  return [];
};

const previewMapStyles = StyleSheet.create({
  mkDot: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 3,
  },
  mkDotText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
});

/* ==================================================================== */
/* Location Picker Modal                                                */
/* ==================================================================== */
const LocationPickerModal = ({
  visible, onClose, onSelect, initialCoords, title, pinColor,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (loc: any) => void;
  initialCoords?: Coord | null;
  title: string;
  pinColor: string;
}) => {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);
  const lastResolved = useRef<Coord | null>(null);
  const lastPoiTap = useRef(0);
  const markerRef = useRef<Coord>(initialCoords || { latitude: 10.3157, longitude: 123.8854 });

  const [markerCoord, setMarkerCoord] = useState<Coord>(initialCoords || { latitude: 10.3157, longitude: 123.8854 });
  markerRef.current = markerCoord;

  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);
  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [kbH, setKbH] = useState(0);

  const pinBounce = useRef(new Animated.Value(0)).current;
  const pinPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (initialCoords) {
      setMarkerCoord(initialCoords);
      resolveAt(initialCoords);
      const t = setTimeout(() => {
        mapRef.current?.animateToRegion(
          { ...initialCoords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA },
          0,
        );
      }, 50);
      return () => clearTimeout(t);
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { resolveAt(markerRef.current); return; }
        const loc = await Location.getCurrentPositionAsync({});
        moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch { resolveAt(markerRef.current); }
    })();
    loadRecents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialCoords?.latitude, initialCoords?.longitude]);

  useEffect(() => {
    Animated.spring(pinBounce, {
      toValue: isDraggingMap ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true,
    }).start();
  }, [isDraggingMap, pinBounce]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pinPulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pinPulse]);

  useEffect(() => () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', e => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const loadRecents = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentEntry[];
        setRecents(Array.isArray(parsed) ? parsed : []);
      }
    } catch { /* ignore */ }
  };

  const saveRecent = async (entry: RecentEntry) => {
    try {
      const next = [
        entry,
        ...recents.filter(
          r => Math.abs(r.latitude - entry.latitude) > 1e-4 || Math.abs(r.longitude - entry.longitude) > 1e-4,
        ),
      ].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const resolveAt = async (coords: Coord, label?: Label) => {
    const seq = ++resolveSeq.current;
    lastResolved.current = coords;
    setValidatingPin(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub || ''); }

    const [geo, list] = await Promise.all([reverseGeocodeGoogle(coords), fetchNearbyPlaces(coords)]);
    if (seq !== resolveSeq.current) return;

    let g = geo;
    if (!g) g = await reverseGeocodeExpo(coords);
    if (seq !== resolveSeq.current) return;

    const close = label ? null : list.find(p => p.dist <= LABEL_SNAP_M) || null;
    const name = label?.name || close?.name || g?.name || 'Pinned location';
    const sub =
      label?.sub ||
      (close ? close.address || g?.sub || '' : g?.sub) ||
      `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;

    setAddressName(name);
    setAddressSub(sub);
    setNearby(list.filter(p => p.name !== name));
    setStructuredAddress(
      g?.structured || { street_address: name, barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000' },
    );
    setValidatingPin(false);
  };

  const moveTo = (coords: Coord, label?: Label) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  };

  const handleLocateMe = async () => {
    if (locating) return;
    Keyboard.dismiss();
    try {
      setLocating(true);
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location is off', 'Allow location access so the map can jump to where you are.');
        return;
      }
      let first: Coord | null = null;
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last) { first = { latitude: last.coords.latitude, longitude: last.coords.longitude }; moveTo(first); }
      } catch { /* ignore */ }
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
      if (!first || metersBetween(first, here) > 15) moveTo(here);
    } catch {
      Alert.alert('Error', 'Could not fetch your current location.');
    } finally {
      setLocating(false);
    }
  };

  const runSearch = async (text: string) => {
    setSearchError(null);
    if (!text.trim()) { setSearchResults([]); return; }
    if (!HAS_API_KEY) { setSearchError('Search unavailable.'); return; }
    try {
      setSearchLoading(true);
      const c = markerRef.current;
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
        },
        body: JSON.stringify({
          textQuery: text, languageCode: 'en', regionCode: 'PH',
          locationBias: { circle: { center: { latitude: c.latitude, longitude: c.longitude }, radius: 50000.0 } },
        }),
      });
      const data = await response.json();
      if (data.error) { setSearchError(data.error.message); setSearchResults([]); return; }
      const detailed: SearchResult[] = (data.places || [])
        .filter((p: any) => !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
        .map((p: any) => ({
          place_id: p.id,
          name: p.displayName?.text || '',
          formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
        }));
      setSearchResults(detailed);
      if (detailed.length === 0) setSearchError('Only streets matched.');
    } catch {
      setSearchError('Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!text.trim()) { setSearchResults([]); setSearchError(null); return; }
    searchDebounce.current = setTimeout(() => runSearch(text), 350);
  };

  const closeSearch = () => {
    setIsSearching(false); setSearchQuery(''); setSearchResults([]); setSearchError(null);
    Keyboard.dismiss();
  };

  const selectSearchResult = (item: SearchResult) => {
    const coords = { latitude: item.geometry.location.lat, longitude: item.geometry.location.lng };
    moveTo(coords, { name: item.name, sub: item.formatted_address });
    saveRecent({
      name: item.name, address: item.formatted_address,
      latitude: coords.latitude, longitude: coords.longitude, ts: Date.now(),
    });
    closeSearch();
  };

  const pickRecent = (r: RecentEntry) => {
    moveTo({ latitude: r.latitude, longitude: r.longitude }, { name: r.name, sub: r.address });
    closeSearch();
  };

  const pickNearby = (p: NearbyPlace) => {
    Keyboard.dismiss();
    moveTo({ latitude: p.latitude, longitude: p.longitude }, { name: p.name, sub: p.address });
  };

  const confirm = () => {
    const fullAddress = `${addressName}${addressSub && addressSub !== addressName ? ', ' + addressSub : ''}`;
    const payload = {
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress,
      address: fullAddress,
    };
    saveRecent({
      name: addressName, address: addressSub || addressName,
      latitude: markerCoord.latitude, longitude: markerCoord.longitude, ts: Date.now(),
    });
    onSelect(payload);
  };

  const onPanDrag = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
  };

  const onRegionChangeComplete = (region: Region) => {
    setIsDraggingMap(false);
    const center = { latitude: region.latitude, longitude: region.longitude };
    if (lastResolved.current && metersBetween(lastResolved.current, center) < SAME_SPOT_METERS) return;
    setMarkerCoord(center);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => resolveAt(center), 350);
  };

  const onPoiClick = (e: any) => {
    const { coordinate, name } = e.nativeEvent || {};
    if (!coordinate) return;
    lastPoiTap.current = Date.now();
    moveTo(
      { latitude: coordinate.latitude, longitude: coordinate.longitude },
      name ? { name: String(name).replace(/\n/g, ' ') } : undefined,
    );
  };

  const onMapPress = (e: any) => {
    Keyboard.dismiss();
    if (Date.now() - lastPoiTap.current < 500) return;
    const c = e.nativeEvent?.coordinate;
    if (!c) return;
    moveTo({ latitude: c.latitude, longitude: c.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const pinScale = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const pulseScale = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  const displayList: (SearchResult | RecentEntry)[] = searchQuery.trim().length > 0 ? searchResults : recents;
  const busy = validatingPin || isDraggingMap;

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={[pickerStyles.container, { paddingBottom: kbH }]}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

        <View style={pickerStyles.mapArea}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            googleMapId={GOOGLE_MAP_ID}
            style={StyleSheet.absoluteFill}
            initialRegion={{ ...markerCoord, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }}
            onMapReady={() => setMapLoaded(true)}
            onPanDrag={onPanDrag}
            onRegionChangeComplete={onRegionChangeComplete}
            onPoiClick={onPoiClick}
            onPress={onMapPress}
            showsUserLocation
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          />

          {!mapLoaded && (
            <View style={pickerStyles.loadingOverlay}>
              <ActivityIndicator size="large" color={ORANGE} />
            </View>
          )}

          <View style={pickerStyles.centerStack} pointerEvents="box-none">
            <Animated.View style={{ transform: [{ translateY: pinTranslateY }] }} pointerEvents="box-none">
              <TouchableOpacity style={pickerStyles.bubble} activeOpacity={0.9} onPress={() => setIsSearching(true)}>
                <Text style={pickerStyles.bubbleText} numberOfLines={1}>{addressName}</Text>
                {busy
                  ? <ActivityIndicator size="small" color="#9CA3AF" style={{ marginLeft: 8 }} />
                  : <Ionicons name="chevron-forward" size={16} color="#9CA3AF" style={{ marginLeft: 6 }} />}
              </TouchableOpacity>
            </Animated.View>

            <View style={pickerStyles.pinContainer} pointerEvents="none">
              <Animated.View style={[pickerStyles.pinWrapper, { transform: [{ translateY: pinTranslateY }, { scale: pinScale }] }]}>
                <Animated.View
                  style={[pickerStyles.pinHalo, { backgroundColor: pinColor, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]}
                />
                <View style={[pickerStyles.pinDot, { backgroundColor: pinColor }]}>
                  <View style={pickerStyles.pinDotInner} />
                </View>
                <View style={[pickerStyles.pinStem, { backgroundColor: pinColor }]} />
              </Animated.View>
              <View style={pickerStyles.pinShadow} />
            </View>
          </View>

          <TouchableOpacity
            style={[pickerStyles.iconBtn, { top: insets.top + 10 }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>

          <TouchableOpacity
            style={pickerStyles.locateMeBtn}
            onPress={handleLocateMe}
            disabled={locating}
            activeOpacity={0.85}
          >
            {locating
              ? <ActivityIndicator size="small" color="#111827" />
              : <Ionicons name="locate" size={24} color="#111827" />}
          </TouchableOpacity>
        </View>

        <View style={pickerStyles.sheet}>
          <View style={pickerStyles.dragHandle} />

          <ScrollView
            style={pickerStyles.list}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity
              style={[pickerStyles.row, { backgroundColor: 'rgba(242,112,36,0.09)' }]}
              activeOpacity={0.85}
              onPress={() => setIsSearching(true)}
            >
              <View style={pickerStyles.rowIconCol}>
                <View style={[pickerStyles.rowIcon, { backgroundColor: pinColor }]}>
                  <Ionicons name="location" size={18} color="#FFFFFF" />
                </View>
              </View>
              <View style={pickerStyles.rowText}>
                <Text style={pickerStyles.rowTitle} numberOfLines={1}>{addressName}</Text>
                <Text style={pickerStyles.rowSub} numberOfLines={1}>
                  {busy ? 'Updating address...' : addressSub || 'Fetching address details...'}
                </Text>
              </View>
              <Ionicons name="pencil" size={18} color="#6B7280" />
            </TouchableOpacity>

            {nearby.map(p => (
              <TouchableOpacity key={p.id} style={pickerStyles.row} activeOpacity={0.7} onPress={() => pickNearby(p)}>
                <View style={pickerStyles.rowIconCol}>
                  <View style={pickerStyles.rowIconMuted}>
                    <Ionicons name="location-outline" size={18} color="#6B7280" />
                  </View>
                  <Text style={pickerStyles.rowDist}>{fmtDist(p.dist)}</Text>
                </View>
                <View style={pickerStyles.rowText}>
                  <Text style={pickerStyles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={pickerStyles.rowSub} numberOfLines={1}>{p.address}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {nearby.length === 0 && (
              <Text style={pickerStyles.emptyNearby}>
                {busy ? 'Looking for nearby places...' : 'No named places nearby. Drag the map or search.'}
              </Text>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[pickerStyles.confirmBtn, { backgroundColor: pinColor }, busy && { opacity: 0.6 }]}
            onPress={() => { Keyboard.dismiss(); confirm(); }}
            activeOpacity={0.9}
            disabled={busy}
          >
            <Text style={pickerStyles.confirmBtnText}>
              {busy ? 'Updating...' : `Confirm ${title}`}
            </Text>
          </TouchableOpacity>
          <View style={{ height: kbH > 0 ? 8 : Math.max(insets.bottom, 12) }} />
        </View>

        {isSearching && (
          <View style={[pickerStyles.searchOverlay, { paddingTop: insets.top + 10 }]}>
            <View style={pickerStyles.searchModalHeader}>
              <TouchableOpacity style={pickerStyles.searchBackBtn} onPress={closeSearch}>
                <Ionicons name="arrow-back" size={22} color="#111827" />
              </TouchableOpacity>
              <View style={pickerStyles.searchInputWrapper}>
                <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
                <TextInput
                  style={pickerStyles.searchInput}
                  placeholder="Search mall, school, landmark..."
                  placeholderTextColor="#9CA3AF"
                  value={searchQuery}
                  onChangeText={handleSearchChange}
                  autoFocus
                  returnKeyType="search"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={10}>
                    <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {searchLoading && <ActivityIndicator size="small" color={ORANGE} style={{ marginTop: 20 }} />}
            {!!searchError && !searchLoading && <Text style={pickerStyles.searchErrorText}>{searchError}</Text>}

            {searchQuery.trim().length === 0 && recents.length > 0 && (
              <View style={pickerStyles.recentsHeader}>
                <Text style={pickerStyles.recentsLabel}>RECENT</Text>
                <TouchableOpacity
                  onPress={async () => { try { await AsyncStorage.removeItem(RECENTS_KEY); setRecents([]); } catch { /* ignore */ } }}
                >
                  <Text style={pickerStyles.clearText}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}

            <FlatList
              data={displayList}
              keyExtractor={(item: any, index) => (item.place_id || item.name) + index}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }}
              renderItem={({ item }) => {
                const isRecent = !('place_id' in item);
                return (
                  <TouchableOpacity
                    style={pickerStyles.searchResultItem}
                    onPress={() => (isRecent ? pickRecent(item as RecentEntry) : selectSearchResult(item as SearchResult))}
                  >
                    <View style={pickerStyles.searchResultIconBox}>
                      <Ionicons name={isRecent ? 'time-outline' : 'location-outline'} size={18} color={pinColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={pickerStyles.searchResultTitle} numberOfLines={1}>{item.name}</Text>
                      <Text style={pickerStyles.searchResultSub} numberOfLines={2}>
                        {isRecent ? (item as RecentEntry).address : (item as SearchResult).formatted_address}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};

const pickerStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  mapArea: { flex: 1, backgroundColor: '#F5F5F5', overflow: 'hidden' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  centerStack: {
    position: 'absolute', left: 0, right: 0, top: '50%',
    marginTop: -(32 + 8 + 42), height: 42 + 8 + 32,
    alignItems: 'center', zIndex: 4,
  },
  bubble: {
    height: 42, maxWidth: '78%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 21, paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 6,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)',
  },
  bubbleText: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: '#111827' },
  pinContainer: { marginTop: 8, alignItems: 'center' },
  pinWrapper: { alignItems: 'center' },
  pinHalo: { position: 'absolute', top: 0, width: 24, height: 24, borderRadius: 12, opacity: 0.3 },
  pinDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6, zIndex: 2,
  },
  pinDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  pinStem: { width: 2, height: 8, marginTop: -2, zIndex: 1 },
  pinShadow: { position: 'absolute', bottom: -2, width: 8, height: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.25)' },
  iconBtn: {
    position: 'absolute', left: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  locateMeBtn: {
    position: 'absolute', right: 16, bottom: 34, width: 52, height: 52, borderRadius: 14, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 5,
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -22,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 12,
    zIndex: 6,
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  list: { maxHeight: 232 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 14 },
  rowIconCol: { width: 56, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowIconMuted: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  rowDist: { fontSize: 11, color: '#6B7280', marginTop: 4, fontWeight: '500' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  rowSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  emptyNearby: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', paddingVertical: 14, paddingHorizontal: 20 },
  confirmBtn: {
    marginHorizontal: 20, marginTop: 6, borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 5,
  },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', zIndex: 20 },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  searchBackBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: '#E5E7EB',
  },
  searchInputWrapper: { flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: '#E5E7EB' },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', fontWeight: '500' },
  searchErrorText: { textAlign: 'center', marginTop: 24, fontSize: 13, color: '#9CA3AF' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 14 },
  searchResultIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center' },
  searchResultTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 3 },
  searchResultSub: { fontSize: 12, color: '#6B7280', fontWeight: '400', lineHeight: 16 },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  recentsLabel: { fontSize: 11, fontWeight: '800', color: '#9CA3AF', letterSpacing: 1 },
  clearText: { fontSize: 12, fontWeight: '700', color: ORANGE },
});

/* ==================================================================== */
/* Main Component                                                       */
/* ==================================================================== */
export default function ManageRoutesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<RouteTab>('active');
  const [usedTodayCount, setUsedTodayCount] = useState(0);
  const [demoMode, setDemoModeState] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<Frequency>('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [routeDurationHours, setRouteDurationHours] = useState<number>(2); // Max 4 hours cap
  const [selectedWeekday, setSelectedWeekday] = useState<number>(new Date().getDay());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  const [startLocation, setStartLocation] = useState<LocationType | null>(null);
  const [endLocation, setEndLocation] = useState<LocationType | null>(null);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<'start' | 'end'>('start');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const previewMapRef = useRef<MapView>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    getDemoMode().then(setDemoModeState);
    return subscribeDemoMode(setDemoModeState);
  }, []);

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const fetchUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
    return data?.user_id || null;
  };

  const fetchVehicles = async (providerId: number) => {
    const { data } = await supabase
      .from('vehicles')
      .select('vehicle_id, vehicle_type, plate_number, max_weight_kg, max_volume_liters')
      .eq('provider_id', providerId)
      .eq('verification_status', 'Verified');
    return data || [];
  };

  const fetchRoutes = async () => {
    setLoading(true);
    const id = await fetchUserId();
    if (!id) return setLoading(false);
    setUserId(id);

    try {
      const stats = await getTodayRouteStats(id);
      setUsedTodayCount(stats.usedTodayCount);
    } catch {
      // ignore
    }

    const { data } = await supabase
      .from('provider_routes')
      .select('*, start_location:start_location_id (*), end_location:end_location_id (*), vehicle:vehicle_id (*)')
      .eq('provider_id', id)
      .order('route_id', { ascending: false });

    // Hide soft-deleted routes from UI list while keeping them counted in usedTodayCount
    const nonDeleted = (data || []).filter((r: Route) => r.is_deleted !== true);
    setRoutes(nonDeleted);
    setVehicles(await fetchVehicles(id));
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchRoutes(); }, []));

  const { activeRoutes, expiredRoutes } = useMemo(() => {
    const active: Route[] = [];
    const expired: Route[] = [];
    for (const r of routes) {
      if (isRouteExpired(r)) expired.push(r);
      else active.push(r);
    }
    return { activeRoutes: active, expiredRoutes: expired };
  }, [routes]);

  const displayedRoutes = activeTab === 'active' ? activeRoutes : expiredRoutes;

  const handleToggleDemo = async (val: boolean) => {
    setDemoModeState(val);
    await setDemoMode(val);
  };

  const handleLocationSelect = async (locData: any, type: 'start' | 'end') => {
    try {
      const streetAddress =
        locData.street_address || locData.address || 'Selected location';
      const barangay = locData.barangay || 'Unknown';
      const city = locData.city || 'Unknown';
      const province = locData.province || 'Unknown';
      const zip = locData.zip_code || '0000';

      const { data: existing } = await supabase
        .from('locations')
        .select('*')
        .eq('latitude', locData.latitude)
        .eq('longitude', locData.longitude)
        .limit(1);

      let location: LocationType | null = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase
          .from('locations')
          .insert({
            street_address: streetAddress,
            barangay, city, province,
            zip_code: zip,
            latitude: locData.latitude,
            longitude: locData.longitude,
          })
          .select('*')
          .single();
        if (error) throw error;
        location = newLoc as LocationType;
      }

      if (type === 'start') setStartLocation(location);
      else setEndLocation(location);

      setPickerVisible(false);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to save location to database.');
    }
  };

  const computeEffectiveDate = (): Date => {
    if (selectedFrequency === 'Daily') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (selectedFrequency === 'Weekly') return nextWeekday(selectedWeekday);
    return departureDate;
  };

  const handleSubmit = async () => {
    if (!startLocation || !endLocation || !selectedVehicleId || !userId) {
      return Alert.alert('Required', 'Please fill all fields');
    }

    const now = new Date();
    const effectiveDate = computeEffectiveDate();
    const combined = new Date(
      effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate(),
      departureTime.getHours(), departureTime.getMinutes(), 0, 0,
    );

    const isSameDayAsToday =
      effectiveDate.getFullYear() === now.getFullYear() &&
      effectiveDate.getMonth() === now.getMonth() &&
      effectiveDate.getDate() === now.getDate();

    if (selectedFrequency === 'Daily') {
      if (combined.getTime() < now.getTime()) {
        return Alert.alert(
          'Invalid Time',
          `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Please pick a departure time that has not passed yet today.`,
        );
      }
    } else if (selectedFrequency === 'Weekly') {
      if (isSameDayAsToday && combined.getTime() < now.getTime()) {
        return Alert.alert(
          'Invalid Time',
          `That time has already passed for today (${WEEKDAY_LABELS[selectedWeekday]}). Please choose a later time or another day.`,
        );
      }
    } else {
      if (combined.getTime() < now.getTime()) {
        return Alert.alert('Invalid Time', 'You cannot schedule a route in the past. Please select a valid future date and time.');
      }
    }

    const endTimeObj = new Date(combined.getTime() + routeDurationHours * 60 * 60 * 1000);

    setSubmitting(true);
    try {
      if (editingRoute) {
        const res = await updateProviderRouteWithGuardrails(
          editingRoute.route_id,
          editingRoute.departure_time,
          {
            providerId: userId,
            vehicleId: selectedVehicleId,
            startLocation,
            endLocation,
            departureDateObj: combined,
            endTimeObj,
            routeFrequency: selectedFrequency,
          },
        );
        Alert.alert(
          'Route Updated',
          res.adminReviewFlag
            ? `Route updated (${res.distanceKm} km). Note: Routes over 25 km are flagged for Admin coverage review.`
            : 'Route updated and corridor matches refreshed!',
        );
      } else {
        const res = await createProviderRouteWithGuardrails({
          providerId: userId,
          vehicleId: selectedVehicleId,
          startLocation,
          endLocation,
          departureDateObj: combined,
          endTimeObj,
          routeFrequency: selectedFrequency,
        });
        Alert.alert(
          'Route Posted!',
          res.adminReviewFlag
            ? `Route saved (${res.distanceKm} km). Note: Routes over 25 km are flagged for Admin coverage review.`
            : 'Your route corridor is active and scanning for forward matches!',
        );
      }

      resetForm();
      setModalVisible(false);
      setActiveTab('active');
      fetchRoutes();
    } catch (err: any) {
      Alert.alert('Guardrail Check', err?.message || (editingRoute ? 'Failed to update route' : 'Failed to save route'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (route: Route) => {
    Alert.alert(
      'Delete Route?',
      'Anti-Gaming Guardrail: Deleted routes STILL count toward your 3-route daily limit. You will not regain this daily slot if you delete it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Route',
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteProviderRoute(route.route_id);
              await fetchRoutes();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Could not delete route.');
            }
          },
        },
      ],
    );
  };

  const handleEdit = (route: Route) => {
    const expired = isRouteExpired(route);
    if (!expired) {
      const check = canEditRoute(route.departure_time, demoMode);
      if (!check.allowed) {
        Alert.alert('Route Edit Locked 🔒', check.reason);
        return;
      }
    }

    setEditingRoute(route);
    const dt = parseNaiveIsoString(route.departure_time);
    const defaultFuture = new Date(Date.now() + 2 * 60 * 60 * 1000 + 15 * 60 * 1000);
    const baseDate = expired ? defaultFuture : dt;
    const baseTime = expired ? defaultFuture : dt;

    setDepartureDate(baseDate);
    setDepartureTime(baseTime);
    setSelectedWeekday(baseDate.getDay());

    if (route.end_time) {
      const endDt = parseNaiveIsoString(route.end_time);
      const hrs = Math.round((endDt.getTime() - dt.getTime()) / (1000 * 60 * 60));
      setRouteDurationHours(hrs >= 1 && hrs <= 4 ? hrs : 2);
    } else {
      setRouteDurationHours(2);
    }

    const freq = (route.route_frequency || 'Daily') as Frequency;
    setSelectedFrequency(FREQUENCIES.includes(freq) ? freq : 'Daily');
    setSelectedVehicleId(route.vehicle_id || null);
    setStartLocation(route.start_location || null);
    setEndLocation(route.end_location || null);
    setModalVisible(true);
  };

  const handleAdd = () => {
    if (usedTodayCount >= MAX_DAILY_ROUTES) {
      Alert.alert(
        'Daily Route Limit Reached (3/3)',
        'You can post a maximum of 3 routes per day. Deleted routes still count toward your daily limit.',
      );
      return;
    }
    resetForm();
    setModalVisible(true);
  };

  const resetForm = () => {
    // Default 2h 15m ahead so Condition B (>= 2 hours before departure) is naturally satisfied
    const initial = new Date(Date.now() + 135 * 60 * 1000);
    setSelectedFrequency('Daily');
    setDepartureDate(initial);
    setDepartureTime(initial);
    setRouteDurationHours(2);
    setSelectedWeekday(initial.getDay());
    setSelectedVehicleId(vehicles[0]?.vehicle_id ?? null);
    setStartLocation(null);
    setEndLocation(null);
    setEditingRoute(null);
  };

  const [previewCoords, setPreviewCoords] = useState<Coord[]>([]);
  useEffect(() => {
    if (!startLocation || !endLocation) { setPreviewCoords([]); return; }
    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${startLocation.longitude},${startLocation.latitude};${endLocation.longitude},${endLocation.latitude}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.routes?.[0]?.geometry?.coordinates) {
          setPreviewCoords(data.routes[0].geometry.coordinates.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
        } else {
          setPreviewCoords([{ latitude: startLocation.latitude, longitude: startLocation.longitude }, { latitude: endLocation.latitude, longitude: endLocation.longitude }]);
        }
      } catch {
        setPreviewCoords([{ latitude: startLocation.latitude, longitude: startLocation.longitude }, { latitude: endLocation.latitude, longitude: endLocation.longitude }]);
      }
    })();
  }, [startLocation, endLocation]);

  useEffect(() => {
    if (!startLocation || !endLocation) return;
    const pts = previewCoords.length >= 2
      ? previewCoords
      : [
          { latitude: startLocation.latitude, longitude: startLocation.longitude },
          { latitude: endLocation.latitude, longitude: endLocation.longitude },
        ];
    const t = setTimeout(() => {
      previewMapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [startLocation?.location_id, endLocation?.location_id, previewCoords.length]);

  const frequencyMeta = (freq: string, expired = false) => {
    if (expired) return { label: 'Expired', bg: colors.errorBg, fg: colors.error };
    switch (freq) {
      case 'Daily': return { label: 'Daily', bg: colors.successBg, fg: colors.success };
      case 'Weekly': return { label: 'Weekly', bg: colors.accentSoft, fg: ORANGE };
      case 'One-time': return { label: 'One-Time', bg: colors.warningBg, fg: colors.warning };
      default: return { label: freq || 'Custom', bg: 'rgba(59,130,246,0.14)', fg: BLUE };
    }
  };

  const renderRouteCard = ({ item }: { item: Route }) => {
    const dt = parseNaiveIsoString(item.departure_time);
    const expired = isRouteExpired(item);
    const editLock = !expired ? canEditRoute(item.departure_time, demoMode) : { allowed: true };
    const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const scheduleText = (() => {
      if (item.route_frequency === 'Daily') return `Every day · ${timeStr}`;
      if (item.route_frequency === 'Weekly') return `Every ${WEEKDAY_LABELS[dt.getDay()]} · ${timeStr}`;
      return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${timeStr}`;
    })();

    const meta = frequencyMeta(item.route_frequency, expired);
    const startSplit = splitAddress(item.start_location?.street_address);
    const endSplit = splitAddress(item.end_location?.street_address);
    const startRoad = [item.start_location?.barangay, item.start_location?.city].filter(Boolean).join(', ') || startSplit.sub;
    const endRoad = [item.end_location?.barangay, item.end_location?.city].filter(Boolean).join(', ') || endSplit.sub;

    return (
      <TouchableOpacity
        style={[styles.oCard, expired && styles.oCardExpired]}
        activeOpacity={0.92}
        onPress={() => handleEdit(item)}
      >
        <View style={styles.oPad}>
          <View style={styles.oTopRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
              <View style={styles.svcPill}>
                <Ionicons name="car-sport-outline" size={14} color={BLUE} />
                <Text style={styles.svcPillText}>
                  {item.vehicle ? item.vehicle.vehicle_type : 'Vehicle'}
                </Text>
              </View>
              {item.route_distance_km != null && Number(item.route_distance_km) > 0 && (
                <View style={styles.distPill}>
                  <Ionicons name="git-branch-outline" size={12} color={ORANGE} />
                  <Text style={styles.distPillText}>{Number(item.route_distance_km).toFixed(1)} km</Text>
                </View>
              )}
            </View>
            <View style={[styles.stPill, { backgroundColor: meta.bg }]}>
              <View style={[styles.stDot, { backgroundColor: meta.fg }]} />
              <Text style={[styles.stPillText, { color: meta.fg }]}>{meta.label.toUpperCase()}</Text>
            </View>
          </View>

          {item.admin_review_flag && (
            <View style={styles.flagBanner}>
              <Ionicons name="warning-outline" size={14} color={ORANGE} />
              <Text style={styles.flagBannerText}>
                Coverage Flag (&gt;25 km): Queued for Admin coverage review
              </Text>
            </View>
          )}

          <View>
            {[
              { key: 'p', label: 'STARTING POINT', main: startSplit.main, road: startRoad, color: ORANGE },
              { key: 'd', label: 'DESTINATION', main: endSplit.main, road: endRoad, color: BLACK },
            ].map((r, i) => (
              <View key={r.key} style={styles.rtRow}>
                <View style={styles.rtRail}>
                  <View style={[styles.rtRing, { borderColor: r.color }]}>
                    <View style={[styles.rtRingDot, { backgroundColor: r.color }]} />
                  </View>
                  {i === 0 && (
                    <View style={styles.rtDots}>
                      {[0, 1, 2, 3].map(k => <View key={k} style={styles.rtDot} />)}
                    </View>
                  )}
                </View>
                <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
                  <Text style={styles.rtLabel}>{r.label}</Text>
                  <Text style={styles.rtMain} numberOfLines={1}>{r.main}</Text>
                  {!!r.road && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Ionicons name="map-outline" size={12} color={colors.textMuted} />
                      <Text style={styles.rtSub} numberOfLines={1}>{r.road}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.oFooter}>
          <View style={styles.oChip}>
            <Ionicons name="time-outline" size={14} color={expired ? colors.error : ORANGE} />
            <Text style={styles.oChipText}>{scheduleText}</Text>
          </View>
          {item.remaining_weight_kg != null && Number(item.remaining_weight_kg) > 0 && (
            <View style={styles.oChip}>
              <Ionicons name="cube-outline" size={14} color={BLUE} />
              <Text style={styles.oChipText}>
                {Number(item.remaining_weight_kg).toFixed(0)} kg · {Number(item.remaining_volume_liters || 0).toFixed(0)} L left
              </Text>
            </View>
          )}
          <View style={[styles.oChip, item.fallback_unlocked && { borderColor: PURPLE }]}>
            <Ionicons
              name={item.fallback_used ? 'checkmark-done' : item.fallback_unlocked ? 'Locate' : 'lock-closed-outline'}
              size={13}
              color={item.fallback_unlocked ? PURPLE : colors.textMuted}
            />
            <Text style={[styles.oChipText, item.fallback_unlocked && { color: PURPLE }]}>
              Fallback: {item.fallback_used ? 'Used (1/1)' : item.fallback_unlocked ? 'Unlocked (1/1)' : '0/1'}
            </Text>
          </View>
        </View>

        <View style={styles.oActions}>
          <TouchableOpacity
            style={styles.oDeleteBtn}
            onPress={() => handleDelete(item)}
            activeOpacity={0.85}
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.oDeleteText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.oRouteBtn, !editLock.allowed && { backgroundColor: colors.textMuted }]}
            onPress={() => handleEdit(item)}
            activeOpacity={0.9}
          >
            <Ionicons
              name={expired ? 'calendar-outline' : editLock.allowed ? 'create-outline' : 'lock-closed'}
              size={16}
              color="#FFFFFF"
            />
            <Text style={styles.oRouteText}>
              {expired ? 'Reschedule' : editLock.allowed ? 'Edit Route' : 'Locked (24h)'}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingLeft: 14 }}>
          <Text style={styles.headerTitle}>Manage Routes</Text>
          <Text style={styles.headerSubtitle}>
            {usedTodayCount}/{MAX_DAILY_ROUTES} routes used today · {activeRoutes.length} active
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.headerAddBtn, usedTodayCount >= MAX_DAILY_ROUTES && { opacity: 0.45 }]}
          onPress={handleAdd}
          activeOpacity={0.9}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Defense DEMO_MODE banner */}
      <View style={styles.demoStrip}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Ionicons name="flask-outline" size={16} color={ORANGE} />
          <Text style={styles.demoStripText}>
            Defense DEMO_MODE (1-min fallback & edit lock)
          </Text>
        </View>
        <Switch
          value={demoMode}
          onValueChange={handleToggleDemo}
          trackColor={{ false: colors.border, true: ORANGE }}
        />
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'active' && styles.tabButtonActive]}
          onPress={() => setActiveTab('active')}
          activeOpacity={0.85}
        >
          <Ionicons
            name="navigate-circle-outline"
            size={16}
            color={activeTab === 'active' ? '#FFFFFF' : colors.textSecondary}
          />
          <Text style={[styles.tabButtonText, activeTab === 'active' && styles.tabButtonTextActive]}>
            Active ({activeRoutes.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'expired' && styles.tabButtonActive]}
          onPress={() => setActiveTab('expired')}
          activeOpacity={0.85}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={activeTab === 'expired' ? '#FFFFFF' : colors.textSecondary}
          />
          <Text style={[styles.tabButtonText, activeTab === 'expired' && styles.tabButtonTextActive]}>
            Expired ({expiredRoutes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading routes...</Text>
        </View>
      ) : displayedRoutes.length === 0 ? (
        <Animated.View style={[styles.emptyContainer, fadeUp(contentAnim, 20)]}>
          <View style={styles.emptyIconCircle}>
            <Ionicons
              name={activeTab === 'active' ? 'map-outline' : 'time-outline'}
              size={32}
              color={ORANGE}
            />
          </View>
          <Text style={styles.emptyTitle}>
            {activeTab === 'active' ? 'Post a route to see matched deliveries.' : 'No expired routes'}
          </Text>
          <Text style={styles.emptySubtext}>
            {activeTab === 'active'
              ? 'Declare the forward travel route you are already driving (max 3 routes/day, ≥3 km apart). Only requests along your corridor will match.'
              : 'One-time or custom routes that have passed their departure window will appear here.'}
          </Text>
          {activeTab === 'active' && (
            <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd} activeOpacity={0.9}>
              <Ionicons name="add-circle" size={18} color="#FFFFFF" />
              <Text style={styles.emptyAddBtnText}>
                Post Route ({Math.max(0, MAX_DAILY_ROUTES - usedTodayCount)} left today)
              </Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: contentAnim }}>
          <FlatList
            data={displayedRoutes}
            keyExtractor={i => i.route_id.toString()}
            renderItem={renderRouteCard}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </Animated.View>
      )}

      {/* Add / Edit Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingRoute ? 'Edit Route' : `Post Route (${usedTodayCount}/${MAX_DAILY_ROUTES} today)`}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.guardrailNotice}>
                <Ionicons name="shield-checkmark-outline" size={16} color={ORANGE} />
                <Text style={styles.guardrailNoticeText}>
                  Guardrails: Post ≥2 hrs early to qualify for Condition B fallback · Destinations must be ≥3 km apart · Max 4-hr window · Locked 24h before departure.
                </Text>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Locations</Text>
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('start'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, startLocation && { backgroundColor: ORANGE }]}>
                    <Ionicons name="radio-button-on" size={14} color="#FFF" />
                  </View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>
                    {startLocation ? startLocation.street_address : 'Set Starting Point'}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 10 }} />
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('end'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, endLocation && { backgroundColor: BLACK }]}>
                    <Ionicons name="location" size={14} color="#FFF" />
                  </View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>
                    {endLocation ? endLocation.street_address : 'Set Destination (≥3 km from other routes)'}
                  </Text>
                </TouchableOpacity>
              </View>

              {startLocation && endLocation && (
                <View style={styles.modalMapContainer}>
                  <MapView
                    ref={previewMapRef}
                    style={StyleSheet.absoluteFill}
                    provider={PROVIDER_GOOGLE}
                    googleMapId={GOOGLE_MAP_ID}
                    initialRegion={{
                      latitude: startLocation.latitude,
                      longitude: startLocation.longitude,
                      latitudeDelta: 0.05,
                      longitudeDelta: 0.05,
                    }}
                    showsCompass={false}
                    toolbarEnabled={false}
                  >
                    <Marker
                      coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={[previewMapStyles.mkDot, { backgroundColor: BLUE }]}>
                        <Text style={previewMapStyles.mkDotText}>S</Text>
                      </View>
                    </Marker>
                    <Marker
                      coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      tracksViewChanges={false}
                    >
                      <View style={[previewMapStyles.mkDot, { backgroundColor: RED }]}>
                        <Text style={previewMapStyles.mkDotText}>E</Text>
                      </View>
                    </Marker>
                    {previewCoords.length > 0 && (
                      <Polyline coordinates={previewCoords} strokeColor={BLUE} strokeWidth={4} />
                    )}
                  </MapView>
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Frequency</Text>
                <View style={styles.frequencyOptions}>
                  {FREQUENCIES.map(freq => (
                    <TouchableOpacity
                      key={freq}
                      style={[styles.frequencyOption, selectedFrequency === freq && styles.frequencyOptionSelected]}
                      onPress={() => setSelectedFrequency(freq)}
                    >
                      <Text style={[styles.frequencyOptionText, selectedFrequency === freq && styles.frequencyOptionTextSelected]}>
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Time Window Cap (Max 4 Hours) */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Active Time Window (Max 4 Hours)</Text>
                <View style={styles.frequencyOptions}>
                  {DURATION_OPTIONS.map(hr => (
                    <TouchableOpacity
                      key={hr}
                      style={[styles.frequencyOption, routeDurationHours === hr && styles.frequencyOptionSelected]}
                      onPress={() => setRouteDurationHours(hr)}
                    >
                      <Text style={[styles.frequencyOptionText, routeDurationHours === hr && styles.frequencyOptionTextSelected]}>
                        {hr} {hr === 1 ? 'hr' : 'hrs'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {selectedFrequency === 'Daily' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Departure Time (Today)</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker
                      value={departureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) {
                          const now = new Date();
                          const candidate = new Date(
                            now.getFullYear(), now.getMonth(), now.getDate(),
                            t.getHours(), t.getMinutes(), 0, 0,
                          );
                          if (candidate.getTime() < now.getTime()) {
                            Alert.alert(
                              'Invalid Time',
                              `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You cannot select a time that has already passed today.`,
                            );
                            return;
                          }
                          setDepartureTime(t);
                        }
                      }}
                    />
                  )}
                </View>
              ) : selectedFrequency === 'Weekly' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Repeats on</Text>
                  <View style={styles.weekdayRow}>
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <TouchableOpacity key={label} style={[styles.weekdayChip, selectedWeekday === idx && styles.weekdayChipActive]} onPress={() => setSelectedWeekday(idx)}>
                        <Text style={[styles.weekdayChipText, selectedWeekday === idx && styles.weekdayChipTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ height: 14 }} />
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker
                      value={departureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) setDepartureTime(t);
                      }}
                    />
                  )}
                </View>
              ) : (
                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Date</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="date"
                        minimumDate={new Date()}
                        onChange={(e, d) => {
                          setShowDatePicker(Platform.OS === 'ios');
                          if (e.type === 'set' && d) setDepartureDate(d);
                        }}
                      />
                    )}
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureTime}
                        mode="time"
                        onChange={(e, t) => {
                          setShowTimePicker(Platform.OS === 'ios');
                          if (e.type === 'set' && t) setDepartureTime(t);
                        }}
                      />
                    )}
                  </View>
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                <View style={styles.vehicleOptions}>
                  {vehicles.map(v => (
                    <TouchableOpacity
                      key={v.vehicle_id}
                      style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                      onPress={() => setSelectedVehicleId(v.vehicle_id)}
                    >
                      <Ionicons name="car-sport" size={14} color={selectedVehicleId === v.vehicle_id ? '#FFF' : colors.textSecondary} />
                      <Text style={[styles.vehicleOptionText, selectedVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                        {v.plate_number}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.7 }]} onPress={handleSubmit} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>{editingRoute ? 'Update Route' : 'Post Route'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <LocationPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(loc) => handleLocationSelect(loc, pickerType)}
        initialCoords={
          pickerType === 'start'
            ? (startLocation ? { latitude: startLocation.latitude, longitude: startLocation.longitude } : undefined)
            : (endLocation ? { latitude: endLocation.latitude, longitude: endLocation.longitude } : undefined)
        }
        title={pickerType === 'start' ? 'Starting Point' : 'Destination'}
        pinColor={pickerType === 'start' ? ORANGE : BLACK}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, color: c.textSecondary, fontWeight: '600', marginTop: 1 },
  headerAddBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
  },

  demoStrip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 20, marginTop: 12, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: c.accentSoft, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,117,31,0.3)',
  },
  demoStripText: { fontSize: 12, fontWeight: '700', color: c.textPrimary },

  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20, marginTop: 10, marginBottom: 4,
    padding: 4, backgroundColor: c.card, borderRadius: 14,
    borderWidth: 1, borderColor: c.border, gap: 6,
  },
  tabButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 10, gap: 6,
  },
  tabButtonActive: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 2,
  },
  tabButtonText: { fontSize: 13, fontWeight: '800', color: c.textSecondary },
  tabButtonTextActive: { color: '#FFFFFF' },

  listContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyIconCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
    marginBottom: 14, borderWidth: 1, borderColor: c.border,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19, marginBottom: 20 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14,
  },
  emptyAddBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  oCard: {
    backgroundColor: c.card, borderRadius: 22, marginBottom: 14,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  oCardExpired: { opacity: 0.88 },
  oPad: { padding: 16 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 8 },
  svcPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  svcPillText: { fontSize: 12, fontWeight: '800', color: BLUE },
  distPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.accentSoft, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8,
  },
  distPillText: { fontSize: 11.5, fontWeight: '800', color: ORANGE },
  stPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  stDot: { width: 7, height: 7, borderRadius: 4 },
  stPillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },

  flagBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,117,31,0.12)', paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 10, marginBottom: 12,
  },
  flagBannerText: { flex: 1, fontSize: 11.5, fontWeight: '700', color: ORANGE },

  rtRow: { flexDirection: 'row', gap: 14 },
  rtRail: { alignItems: 'center', width: 26 },
  rtRing: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.card,
  },
  rtRingDot: { width: 8, height: 8, borderRadius: 4 },
  rtDots: { position: 'absolute', top: 30, bottom: -4, alignItems: 'center', justifyContent: 'space-evenly' },
  rtDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.border },
  rtText: { flex: 1 },
  rtLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  rtMain: { fontSize: 18, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.2, marginTop: 1 },
  rtSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },

  oFooter: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  oChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
  },
  oChipText: { fontSize: 12.5, fontWeight: '700', color: c.textPrimary },

  oActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oDeleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.errorBg, borderRadius: 14, paddingVertical: 14,
  },
  oDeleteText: { color: c.error, fontSize: 14, fontWeight: '800' },
  oRouteBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
  },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '94%', flex: 1 },
  modalHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 6, marginBottom: 6 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary },
  modalScrollContent: { padding: 20, paddingBottom: 40 },

  guardrailNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.accentSoft, padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,117,31,0.3)', marginBottom: 16,
  },
  guardrailNoticeText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: c.textPrimary, lineHeight: 17 },

  modalMapContainer: { height: 180, borderRadius: 16, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: c.border },

  locationSelectorBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, gap: 12 },
  locSelectorIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  locationSelectorText: { flex: 1, fontWeight: '700', color: c.textPrimary, fontSize: 14 },

  formGroup: { marginBottom: 20 },
  inputLabel: { marginBottom: 8, fontWeight: '800', color: c.textPrimary, fontSize: 12, letterSpacing: 0.3 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card },
  frequencyOptionSelected: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  frequencyOptionTextSelected: { color: ORANGE, fontWeight: '800' },

  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekdayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', backgroundColor: c.card },
  weekdayChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  weekdayChipTextActive: { color: '#FFF' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  dateTimeButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14 },
  dateTimeValue: { fontSize: 14, color: c.textPrimary, fontWeight: '700' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.background, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: c.border },
  vehicleOptionActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFF' },

  submitBtn: { backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 6 },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
});