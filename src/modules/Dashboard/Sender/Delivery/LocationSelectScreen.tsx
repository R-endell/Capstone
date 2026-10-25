// src/modules/Dashboard/Sender/Delivery/LocationSelectScreen.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar,
  ActivityIndicator, Animated, Easing, TextInput, FlatList, ScrollView,
  Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../../../utils/mapConfig';

const ORANGE = '#F27024';
const BLACK = '#111827';
const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 6;

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_API_KEY = GOOGLE_MAPS_API_KEY.length > 10;

const REJECTED_PLACE_TYPES = new Set(['route', 'street_address', 'postal_code', 'plus_code']);

const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;
const NEARBY_RADIUS_M = 200;
const LABEL_SNAP_M = 60;

type Coord = { latitude: number; longitude: number };
type RecentEntry = { name: string; address: string; latitude: number; longitude: number; ts: number };
type SearchResult = {
  place_id: string; name: string; formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};
type NearbyPlace = { id: string; name: string; address: string; latitude: number; longitude: number; dist: number };
type Label = { name: string; sub?: string };

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

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const isPickup = type === 'pickup';
  const pinColor = isPickup ? ORANGE : BLACK;
  const tint = isPickup ? 'rgba(242,112,36,0.09)' : 'rgba(17,24,39,0.06)';

  const mapRef = useRef<MapView>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);
  const lastResolved = useRef<Coord | null>(null);
  const lastPoiTap = useRef(0);

  const [markerCoord, setMarkerCoord] = useState<Coord>({
    latitude: initialCoords?.latitude || 10.3157,
    longitude: initialCoords?.longitude || 123.8854,
  });
  const markerRef = useRef(markerCoord);
  markerRef.current = markerCoord;

  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);

  const [note, setNote] = useState<string>(
    () => ((isPickup ? state.pickupLocation : state.dropoffLocation) as any)?.note ?? '',
  );
  const [editingNote, setEditingNote] = useState(false);
  const [kbH, setKbH] = useState(0);

  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  const sheetAnim = useRef(new Animated.Value(0)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const pinPulse = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(sheetAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [sheetAnim]);

  useEffect(() => {
    Animated.spring(pinBounce, { toValue: isDraggingMap ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true }).start();
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

  const animatePressIn = () => Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  const animatePressOut = () => Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();

  const loadRecents = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentEntry[];
        setRecents(Array.isArray(parsed) ? parsed : []);
      }
    } catch { /* ignore */ }
  }, []);

  const saveRecent = useCallback(async (entry: RecentEntry) => {
    try {
      const next = [
        entry,
        ...recents.filter(r => Math.abs(r.latitude - entry.latitude) > 1e-4 || Math.abs(r.longitude - entry.longitude) > 1e-4),
      ].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }, [recents]);

  const clearRecents = async () => {
    try { await AsyncStorage.removeItem(RECENTS_KEY); setRecents([]); } catch { /* ignore */ }
  };

  useEffect(() => { loadRecents(); }, [loadRecents]);

  const fetchNearby = async (coords: Coord): Promise<NearbyPlace[]> => {
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
    } catch (err) { console.warn(err); }
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
    } catch (err) { console.warn(err); }
    return null;
  };

  const resolveAt = useCallback(async (coords: Coord, label?: Label) => {
    const seq = ++resolveSeq.current;
    lastResolved.current = coords;
    setValidatingPin(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub || ''); }

    const [geo, list] = await Promise.all([reverseGeocodeGoogle(coords), fetchNearby(coords)]);
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
  }, []);

  const moveTo = useCallback((coords: Coord, label?: Label) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  }, [resolveAt]);

  useEffect(() => {
    if (type === 'dropoff' && initialCoords) {
      setMarkerCoord(initialCoords);
      resolveAt(initialCoords);
      return;
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { resolveAt(markerRef.current); return; }
        const loc = await Location.getCurrentPositionAsync({});
        moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        resolveAt(markerRef.current);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

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

  const runSearch = useCallback(async (text: string) => {
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
  }, []);

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
    saveRecent({ name: item.name, address: item.formatted_address, latitude: coords.latitude, longitude: coords.longitude, ts: Date.now() });
    closeSearch();
  };

  const pickRecent = (r: RecentEntry) => {
    moveTo({ latitude: r.latitude, longitude: r.longitude }, { name: r.name, sub: r.address });
    closeSearch();
  };

  const pickNearby = (p: NearbyPlace) => {
    Keyboard.dismiss();
    setEditingNote(false);
    moveTo({ latitude: p.latitude, longitude: p.longitude }, { name: p.name, sub: p.address });
  };

  const confirmLocation = () => {
    const fullAddress = `${addressName}${addressSub && addressSub !== addressName ? ', ' + addressSub : ''}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress,
      note: note.trim() || undefined,
    };
    saveRecent({ name: addressName, address: addressSub || addressName, latitude: markerCoord.latitude, longitude: markerCoord.longitude, ts: Date.now() });

    if (route.params?.fromExplore) {
      dispatch({ type: route.params.for === 'pickup' ? 'SET_EXPLORE_PICKUP' : 'SET_EXPLORE_DROPOFF', payload: locationInfo });
      navigation.goBack();
      return;
    }
    if (type === 'pickup') {
      dispatch({ type: 'SET_PICKUP_LOCATION', payload: locationInfo });
      navigation.navigate('DropoffLocation', { type: 'dropoff', initialCoords: markerCoord });
    } else {
      dispatch({ type: 'SET_DROPOFF_LOCATION', payload: locationInfo });
      navigation.navigate('Booking', { mode });
    }
  };

  const onPanDrag = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
    if (editingNote) { Keyboard.dismiss(); setEditingNote(false); }
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
    setEditingNote(false);
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
    <View style={[styles.container, { paddingBottom: kbH }]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <View style={styles.mapArea}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.mapArea}
          googleMapId={GOOGLE_MAP_ID}
          userInterfaceStyle="light"
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
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={ORANGE} />
          </View>
        )}

        <View style={styles.centerStack} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: pinTranslateY }] }} pointerEvents="box-none">
            <TouchableOpacity style={styles.bubble} activeOpacity={0.9} onPress={() => setIsSearching(true)}>
              <Text style={styles.bubbleText} numberOfLines={1}>{addressName}</Text>
              {busy
                ? <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 8 }} />
                : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          </Animated.View>

          <View style={styles.pinContainer} pointerEvents="none">
            <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinTranslateY }, { scale: pinScale }] }]}>
              <Animated.View style={[styles.pinHalo, { backgroundColor: pinColor, transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
              <View style={[styles.pinDot, { backgroundColor: pinColor }]}>
                <View style={styles.pinDotInner} />
              </View>
              <View style={[styles.pinStem, { backgroundColor: pinColor }]} />
            </Animated.View>
            <View style={styles.pinShadow} />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.iconBtn, { top: insets.top + 10 }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.locateMeBtn} onPress={handleLocateMe} disabled={locating} activeOpacity={0.85}>
          {locating ? <ActivityIndicator size="small" color="#111827" /> : <Ionicons name="locate" size={24} color="#111827" />}
        </TouchableOpacity>
      </View>

      <Animated.View style={[styles.sheet, { opacity: sheetAnim }]}>
        <View style={styles.dragHandle} />

        {!editingNote && (
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity style={[styles.row, { backgroundColor: tint }]} activeOpacity={0.85} onPress={() => setIsSearching(true)}>
              <View style={styles.rowIconCol}>
                <View style={[styles.rowIcon, { backgroundColor: pinColor }]}>
                  <Ionicons name="location" size={18} color="#FFFFFF" />
                </View>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{addressName}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {busy ? 'Updating address...' : addressSub || 'Fetching address details...'}
                </Text>
              </View>
              <Ionicons name="pencil" size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            {nearby.map(p => (
              <TouchableOpacity key={p.id} style={styles.row} activeOpacity={0.7} onPress={() => pickNearby(p)}>
                <View style={styles.rowIconCol}>
                  <View style={styles.rowIconMuted}>
                    <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                  </View>
                  <Text style={styles.rowDist}>{fmtDist(p.dist)}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{p.address}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {nearby.length === 0 && (
              <Text style={styles.emptyNearby}>{busy ? 'Looking for nearby places...' : 'No named places nearby. Drag the map or search.'}</Text>
            )}
          </ScrollView>
        )}

        <View style={styles.noteBar}>
          {editingNote ? (
            <View style={styles.noteEditRow}>
              <Ionicons name="create-outline" size={22} color={pinColor} style={{ marginTop: 6 }} />
              <TextInput
                style={styles.noteInput}
                value={note}
                onChangeText={setNote}
                autoFocus
                multiline
                maxLength={200}
                placeholder={isPickup ? 'e.g. Blue gate beside 7-Eleven, call when outside' : 'e.g. Leave with the guard, 3rd floor, unit 305'}
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={() => setEditingNote(false)}
              />
              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setEditingNote(false); }} hitSlop={8}>
                <Text style={[styles.noteDone, { color: pinColor }]}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.noteRow} activeOpacity={0.8} onPress={() => setEditingNote(true)}>
              <Ionicons name="create-outline" size={22} color={pinColor} />
              <Text
                style={[styles.noteText, note ? { color: colors.textPrimary, fontWeight: '600' } : { color: pinColor }]}
                numberOfLines={2}
              >
                {note || 'Enter note for driver.'}
              </Text>
              {!!note && <Ionicons name="pencil" size={16} color={colors.textSecondary} />}
            </TouchableOpacity>
          )}
          {editingNote && <Text style={styles.noteCount}>{note.length}/200</Text>}
        </View>

        <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
          <TouchableOpacity
            style={[styles.confirmBtn, busy && { opacity: 0.6 }]}
            onPress={() => { Keyboard.dismiss(); confirmLocation(); }}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            activeOpacity={0.9}
            disabled={busy}
          >
            <Text style={styles.confirmBtnText}>
              {busy ? 'Updating...' : isPickup ? 'Confirm pickup' : 'Confirm drop-off'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
        <View style={{ height: kbH > 0 ? 8 : Math.max(insets.bottom, 12) }} />
      </Animated.View>

      {isSearching && (
        <View style={[styles.searchOverlay, { paddingTop: insets.top + 10 }]}>
          <View style={styles.searchModalHeader}>
            <TouchableOpacity style={styles.searchBackBtn} onPress={closeSearch}>
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.searchInputWrapper}>
              <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search mall, school, landmark..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {searchLoading && <ActivityIndicator size="small" color={ORANGE} style={{ marginTop: 20 }} />}
          {!!searchError && !searchLoading && <Text style={styles.searchErrorText}>{searchError}</Text>}

          {searchQuery.trim().length === 0 && recents.length > 0 && (
            <View style={styles.recentsHeader}>
              <Text style={styles.recentsLabel}>RECENT</Text>
              <TouchableOpacity onPress={clearRecents}><Text style={styles.clearText}>Clear</Text></TouchableOpacity>
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
                  style={styles.searchResultItem}
                  onPress={() => (isRecent ? pickRecent(item as RecentEntry) : selectSearchResult(item as SearchResult))}
                >
                  <View style={styles.searchResultIconBox}>
                    <Ionicons name={isRecent ? 'time-outline' : 'location-outline'} size={18} color={pinColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.searchResultSub} numberOfLines={2}>
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
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.card },
  mapArea: { flex: 1, backgroundColor: '#F5F5F5', overflow: 'hidden' },

  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', zIndex: 10 },

  /* bubble + pin stack. Pin = 24 dot + 8 stem = 32px; its tip sits on the map centre. */
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

  /* sheet */
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 22, borderTopRightRadius: 22, marginTop: -22,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: isDark ? 0.5 : 0.08, shadowRadius: 12, elevation: 12,
    zIndex: 6,
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  list: { maxHeight: 232 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 14 },
  rowIconCol: { width: 56, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowIconMuted: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center' },
  rowDist: { fontSize: 11, color: c.textSecondary, marginTop: 4, fontWeight: '500' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  rowSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  emptyNearby: { textAlign: 'center', fontSize: 12, color: c.textMuted, paddingVertical: 14 },

  noteBar: { borderTopWidth: 1, borderTopColor: c.divider, paddingHorizontal: 20, paddingVertical: 14 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteText: { flex: 1, fontSize: 16, fontWeight: '700' },
  noteEditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  noteInput: { flex: 1, fontSize: 15, color: c.textPrimary, minHeight: 40, maxHeight: 90, padding: 0, paddingTop: 8, textAlignVertical: 'top' },
  noteDone: { fontSize: 15, fontWeight: '800', marginTop: 8 },
  noteCount: { fontSize: 10, color: c.textMuted, textAlign: 'right', marginTop: 4 },

  confirmBtn: {
    marginHorizontal: 20, backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },

  /* search overlay */
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.background, zIndex: 20 },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  searchBackBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: c.border,
  },
  searchInputWrapper: { flex: 1, height: 48, backgroundColor: c.card, borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: c.border },
  searchInput: { flex: 1, fontSize: 15, color: c.textPrimary, fontWeight: '500' },
  searchErrorText: { textAlign: 'center', marginTop: 24, fontSize: 13, color: c.textMuted },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 14 },
  searchResultIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center' },
  searchResultTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 3 },
  searchResultSub: { fontSize: 12, color: c.textSecondary, fontWeight: '400', lineHeight: 16 },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  recentsLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  clearText: { fontSize: 12, fontWeight: '700', color: ORANGE },
});