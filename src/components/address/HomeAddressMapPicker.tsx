// src/components/address/HomeAddressMapPicker.tsx
//
// Reusable map-based home-address picker.
// Orange accent throughout. Draggable bottom sheet (press + drag down to
// reveal the full map; tap the handle to toggle).
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator,
  Animated, PanResponder, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../utils/mapConfig';
import {
  LatLng, ResolvedAddress, UNRESOLVED_ADDRESS,
  metersBetween, formatDistance, fetchGoogleAddress, getAccurateFix,
} from '../../utils/addressGeocoding';

const DEFAULT_ACCENT = '#F27024';
const GPS_MATCH_RADIUS_M = 150;
const GEOCODE_TIMEOUT_MS = 6000;
const GEOCODE_DEBOUNCE_MS = 250;
const REUSE_RADIUS_M = 25;

const SHEET_HEIGHT = 300;
const SHEET_COLLAPSED = 88;
const MAX_TRANSLATE = SHEET_HEIGHT - SHEET_COLLAPSED;

type Props = {
  visible: boolean;
  initialCoords?: { latitude: number; longitude: number } | null;
  accentColor?: string;
  onClose: () => void;
  onConfirm: (resolved: ResolvedAddress, coords: LatLng, gpsMatched: boolean) => void;
};

export default function HomeAddressMapPicker({
  visible, initialCoords, accentColor = DEFAULT_ACCENT, onClose, onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark, accentColor), [colors, isDark, accentColor]);

  const [mapCenter, setMapCenter] = useState<LatLng>({ lat: 10.3157, lng: 123.8854 });
  const [deviceGps, setDeviceGps] = useState<LatLng | null>(null);
  const [preview, setPreview] = useState<ResolvedAddress>({
    street: 'Locating street...', barangay: '...',
    city: 'Cebu City', province: 'Cebu', zip_code: '6000',
    formatted: 'Fetching exact address details...',
  });
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const mapRef = useRef<MapView>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<{ coords: LatLng; promise: Promise<ResolvedAddress> } | null>(null);
  const cacheRef = useRef<Map<string, ResolvedAddress>>(new Map());
  const requestIdRef = useRef(0);
  const locatingRef = useRef(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const snapRef = useRef<0 | 1>(0);

  useEffect(() => {
    if (!visible) return;
    setCollapsed(false);
    snapRef.current = 0;
    sheetAnim.setValue(0);

    const seed = initialCoords
      ? { lat: initialCoords.latitude, lng: initialCoords.longitude }
      : null;
    const start = seed || { lat: 10.3157, lng: 123.8854 };
    setMapCenter(start);
    setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: start.lat, longitude: start.lng, latitudeDelta: 0.0028, longitudeDelta: 0.0028 },
        250,
      );
    }, 100);

    if (seed) resolveAddress(seed);
    else locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const findReusable = (coords: LatLng): ResolvedAddress | null => {
    let best: ResolvedAddress | null = null;
    let bestDist = REUSE_RADIUS_M;
    for (const [key, val] of cacheRef.current.entries()) {
      const [cLat, cLng] = key.split(',').map(Number);
      const d = metersBetween({ lat: cLat, lng: cLng }, coords);
      if (d < bestDist) { best = val; bestDist = d; }
    }
    return best;
  };

  const resolveAddress = useCallback(async (coords: LatLng): Promise<ResolvedAddress> => {
    const reusable = findReusable(coords);
    if (reusable) {
      requestIdRef.current += 1;
      abortRef.current?.abort();
      inFlightRef.current = null;
      setPreview(reusable);
      setIsGeocoding(false);
      return reusable;
    }
    const pending = inFlightRef.current;
    if (pending && metersBetween(pending.coords, coords) < REUSE_RADIUS_M) return pending.promise;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;
    setIsGeocoding(true);

    const promise: Promise<ResolvedAddress> = (async () => {
      const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
      try {
        const result = await fetchGoogleAddress(coords, controller.signal);
        cacheRef.current.set(`${coords.lat},${coords.lng}`, result);
        if (requestId === requestIdRef.current) setPreview(result);
        return result;
      } catch {
        if (requestId === requestIdRef.current) setPreview(UNRESOLVED_ADDRESS);
        return UNRESOLVED_ADDRESS;
      } finally {
        clearTimeout(timer);
        if (requestId === requestIdRef.current) setIsGeocoding(false);
        if (inFlightRef.current?.coords === coords) inFlightRef.current = null;
      }
    })();
    inFlightRef.current = { coords, promise };
    return promise;
  }, []);

  const scheduleGeocode = (coords: LatLng) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (findReusable(coords)) { resolveAddress(coords); return; }
    setIsGeocoding(true);
    debounceRef.current = setTimeout(() => { resolveAddress(coords); }, GEOCODE_DEBOUNCE_MS);
  };

  const locateMe = async () => {
    locatingRef.current = true;
    setIsLocatingGps(true);
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') ({ status } = await Location.requestForegroundPermissionsAsync());
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is needed to find your address.');
        return;
      }
      let loc: Location.LocationObject | null = null;
      try { loc = await getAccurateFix(); }
      catch { loc = await Location.getLastKnownPositionAsync(); }
      if (!loc) throw new Error('No GPS fix');

      const next = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setDeviceGps(next);
      setMapCenter(next);
      mapRef.current?.animateToRegion(
        { latitude: next.lat, longitude: next.lng, latitudeDelta: 0.0028, longitudeDelta: 0.0028 }, 400,
      );
      await resolveAddress(next);
    } catch {
      Alert.alert('Error', 'Could not fetch your current GPS location.');
    } finally {
      locatingRef.current = false;
      setIsLocatingGps(false);
    }
  };

  const snapTo = (toCollapsed: boolean) => {
    snapRef.current = toCollapsed ? 1 : 0;
    setCollapsed(toCollapsed);
    Animated.spring(sheetAnim, {
      toValue: toCollapsed ? MAX_TRANSLATE : 0,
      useNativeDriver: true, friction: 10, tension: 60,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
      onPanResponderMove: (_, g) => {
        const base = snapRef.current === 1 ? MAX_TRANSLATE : 0;
        const next = Math.max(0, Math.min(MAX_TRANSLATE, base + g.dy));
        sheetAnim.setValue(next);
        setCollapsed(next > MAX_TRANSLATE / 2);
      },
      onPanResponderRelease: (_, g) => {
        // Tap (no significant movement) → toggle
        if (Math.abs(g.dy) < 5 && Math.abs(g.vy) < 0.15) {
          snapTo(snapRef.current === 0);
          return;
        }
        const base = snapRef.current === 1 ? MAX_TRANSLATE : 0;
        const next = base + g.dy;
        const shouldCollapse = next > MAX_TRANSLATE / 2 || g.vy > 0.4;
        snapTo(shouldCollapse);
      },
    }),
  ).current;

  const handleConfirm = async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const resolved = await resolveAddress(mapCenter);
    const dist = deviceGps ? metersBetween(deviceGps, mapCenter) : null;
    const gpsMatched = dist !== null && dist <= GPS_MATCH_RADIUS_M;
    onConfirm(resolved, mapCenter, gpsMatched);
  };

  const pinMatched =
    deviceGps !== null && metersBetween(deviceGps, mapCenter) <= GPS_MATCH_RADIUS_M;

  const initialRegion = initialCoords
    ? {
        latitude: initialCoords.latitude,
        longitude: initialCoords.longitude,
        latitudeDelta: 0.0028,
        longitudeDelta: 0.0028,
      }
    : {
        latitude: mapCenter.lat,
        longitude: mapCenter.lng,
        latitudeDelta: 0.0028,
        longitudeDelta: 0.0028,
      };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          googleMapId={GOOGLE_MAP_ID}
          userInterfaceStyle="light"
          initialRegion={initialRegion}
          onRegionChangeComplete={(r) => {
            const next = { lat: r.latitude, lng: r.longitude };
            setMapCenter(next);
            if (!locatingRef.current) scheduleGeocode(next);
          }}
          pitchEnabled={false}
          rotateEnabled={false}
          showsBuildings={false}
          showsTraffic={false}
          showsIndoors={false}
          minZoomLevel={12}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          {deviceGps && (
            <Circle
              center={{ latitude: deviceGps.lat, longitude: deviceGps.lng }}
              radius={GPS_MATCH_RADIUS_M}
              strokeColor={accentColor}
              strokeWidth={2}
              fillColor={`${accentColor}22`}
            />
          )}
        </MapView>

        <View style={styles.pinWrap} pointerEvents="none">
          <View style={[styles.pinPill, pinMatched && { backgroundColor: accentColor }]}>
            <Text style={styles.pinPillText}>
              {isGeocoding ? 'Locating...' : pinMatched ? 'Exact GPS Spot' : 'Home Pin'}
            </Text>
          </View>
          <View style={[styles.pinHead, pinMatched && { backgroundColor: accentColor }]}>
            <Ionicons name="home" size={21} color="#FFF" />
          </View>
          <View style={[styles.pinTip, pinMatched && { borderTopColor: accentColor }]} />
          <View style={styles.pinShadow} />
        </View>

        <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: isLocatingGps ? accentColor : pinMatched ? accentColor : '#D97706' },
              ]}
            />
            <Text style={styles.statusText} numberOfLines={1}>
              {isLocatingGps
                ? 'Finding your location...'
                : pinMatched
                  ? 'Within your live GPS zone'
                  : deviceGps
                    ? `${formatDistance(metersBetween(deviceGps, mapCenter))} from your GPS`
                    : 'Drag map to position pin'}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.locateFab, { bottom: insets.bottom + MAX_TRANSLATE + 18 }]}
          onPress={locateMe}
          disabled={isLocatingGps}
          activeOpacity={0.85}
        >
          {isLocatingGps
            ? <ActivityIndicator size="small" color={accentColor} />
            : <Ionicons name="locate" size={22} color={accentColor} />}
        </TouchableOpacity>

        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: sheetAnim }] }]}
          pointerEvents={collapsed ? 'box-none' : 'auto'}
        >
          <View style={styles.handleHitArea} {...panResponder.panHandlers}>
            <View style={styles.handleBar} />
          </View>

          <View style={styles.sheetHeaderRow}>
            <View style={styles.sheetIcon}>
              <Ionicons
                name={pinMatched ? 'shield-checkmark' : 'location'}
                size={22}
                color={accentColor}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.overline}>PINNED HOME ADDRESS</Text>
                {isGeocoding && (
                  <ActivityIndicator
                    size="small"
                    color={accentColor}
                    style={{ transform: [{ scale: 0.75 }] }}
                  />
                )}
              </View>
              <Text style={styles.fullAddress} numberOfLines={2}>
                {preview.formatted}
              </Text>
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>STREET / ROAD</Text>
              <Text style={styles.gridValue} numberOfLines={1}>{preview.street}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>BARANGAY</Text>
              <Text style={styles.gridValue} numberOfLines={1}>Brgy. {preview.barangay}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>CITY / MUNICIPALITY</Text>
              <Text style={styles.gridValue} numberOfLines={1}>{preview.city}</Text>
            </View>
            <View style={styles.gridItem}>
              <Text style={styles.gridLabel}>PROVINCE & ZIP</Text>
              <Text style={styles.gridValue} numberOfLines={1}>
                {preview.province} • {preview.zip_code}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.confirmBtn, isGeocoding && { opacity: 0.65 }]}
            onPress={handleConfirm}
            disabled={isGeocoding}
            activeOpacity={0.88}
          >
            {isGeocoding ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons
                  name={pinMatched ? 'shield-checkmark' : 'checkmark-circle'}
                  size={20}
                  color="#FFF"
                />
                <Text style={styles.confirmText}>
                  {pinMatched ? 'Confirm GPS-Matched Home' : 'Confirm Home Address'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, _isDark: boolean, accent: string) =>
  StyleSheet.create({
    pinWrap: {
      position: 'absolute', top: '42%', left: '50%',
      marginLeft: -55, marginTop: -70, width: 110, alignItems: 'center', zIndex: 4,
    },
    pinPill: {
      backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 999, marginBottom: 6,
    },
    pinPillText: { color: '#FFF', fontSize: 10, fontFamily: 'Poppins_700Bold', letterSpacing: 0.3 },
    pinHead: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: accent,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 3, borderColor: '#FFF',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28, shadowRadius: 8, elevation: 8,
    },
    pinTip: {
      width: 0, height: 0, backgroundColor: 'transparent',
      borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
      borderLeftColor: 'transparent', borderRightColor: 'transparent',
      borderTopColor: accent, marginTop: -1,
    },
    pinShadow: {
      width: 12, height: 4, borderRadius: 6,
      backgroundColor: 'rgba(0,0,0,0.28)', marginTop: 2,
    },

    topBar: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10,
    },
    backBtn: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF',
      justifyContent: 'center', alignItems: 'center', elevation: 4,
    },
    statusPill: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: '#FFF', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22, elevation: 4,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#111827' },

    locateFab: {
      position: 'absolute', right: 18, width: 48, height: 48, borderRadius: 24,
      backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', elevation: 5,
    },

    sheet: {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: SHEET_HEIGHT,
      backgroundColor: '#FFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
      paddingHorizontal: 20, paddingBottom: 20,
      shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.18, shadowRadius: 12, elevation: 14,
    },
    handleHitArea: { paddingVertical: 10, alignItems: 'center' },
    handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB' },

    sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
    sheetIcon: {
      width: 46, height: 46, borderRadius: 14,
      backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FFEDD5',
      alignItems: 'center', justifyContent: 'center',
    },
    overline: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: '#6B7280', letterSpacing: 0.7 },
    fullAddress: {
      fontSize: 15, fontFamily: 'Poppins_700Bold', color: '#111827',
      marginTop: 2, lineHeight: 20,
    },

    grid: {
      flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
      gap: 8, marginBottom: 14,
    },
    gridItem: {
      width: '48.5%', backgroundColor: '#F9FAFB', borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#F3F4F6',
    },
    gridLabel: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: '#9CA3AF', letterSpacing: 0.5 },
    gridValue: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#1F2937', marginTop: 2 },

    confirmBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: accent, paddingVertical: 15, borderRadius: 16, gap: 8,
      shadowColor: accent, shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28, shadowRadius: 8, elevation: 5,
    },
    confirmText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
  });