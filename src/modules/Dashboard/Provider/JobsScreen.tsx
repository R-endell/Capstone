// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Switch,
  Platform, Modal, Alert, ActivityIndicator, ScrollView,
  Animated, Easing, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { getActiveRouteId, setActiveRouteId } from '../../../services/activeRouteStore';
import { findMatches } from '../../../services/matchingService';

const ORANGE = '#FA7A25';
const { width } = Dimensions.get('window');

interface Location {
  location_id?: number;
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
  max_volume_liters: number;
  max_weight_kg: number;
  cargo_length_cm: number;
  cargo_width_cm: number;
  cargo_height_cm: number;
  verification_status: string;
}
interface Route {
  route_id: number;
  departure_time: string;
  route_frequency: string;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location?: Location;
  end_location?: Location;
  vehicle?: Vehicle;
}

/* ------------------------------------------------------------------ */
/* Map (view only)                                                     */
/* ------------------------------------------------------------------ */
const RouteMap = ({
  startLat, startLng, endLat, endLng,
  centerLat, centerLng,
}: any) => {
  const lat = startLat ?? endLat ?? centerLat ?? 10.3157;
  const lng = startLng ?? endLng ?? centerLng ?? 123.8854;

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .marker-start { background: #3B82F6; border: 3px solid white; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; z-index: 1000; }
          .marker-end { background: #EF4444; border: 3px solid white; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; z-index: 1000; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 14);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          ${startLat && startLng ? `
            L.marker([${startLat}, ${startLng}], { icon: L.divIcon({className: 'marker-start', html: 'S', iconSize: [24, 24], iconAnchor: [12, 12]}) }).addTo(map);
          ` : ''}
          ${endLat && endLng ? `
            L.marker([${endLat}, ${endLng}], { icon: L.divIcon({className: 'marker-end', html: 'E', iconSize: [24, 24], iconAnchor: [12, 12]}) }).addTo(map);
          ` : ''}
          ${startLat && startLng && endLat && endLng ? `
            L.polyline([[${startLat}, ${startLng}], [${endLat}, ${endLng}]], { color: '#FA7A25', weight: 4, opacity: 0.8, dashArray: '8, 8' }).addTo(map);
            map.fitBounds(L.latLngBounds([[${startLat}, ${startLng}], [${endLat}, ${endLng}]]), { padding: [40, 40] });
          ` : ''}
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      androidLayerType="hardware"
    />
  );
};

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);

  const [matchedCount, setMatchedCount] = useState(0);
  const [checkingMatches, setCheckingMatches] = useState(false);

  const [routePickerVisible, setRoutePickerVisible] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const onlinePulse = useRef(new Animated.Value(0)).current;
  const matchBannerAnim = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animations                                                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    Animated.parallel([animate(headerAnim, 0), animate(sheetAnim, 220)]).start();
  }, [headerAnim, sheetAnim]);

  useEffect(() => {
    if (!isOnline) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(onlinePulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(onlinePulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isOnline, onlinePulse]);

  useEffect(() => {
    matchBannerAnim.setValue(0);
    if (matchedCount > 0) {
      Animated.timing(matchBannerAnim, {
        toValue: 1, duration: 400,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [matchedCount, matchBannerAnim]);

  /* ------------------------------------------------------------------ */
  /* Data load                                                           */
  /* ------------------------------------------------------------------ */
  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id, is_active')
        .eq('auth_id', user.id)
        .single();
      if (error) throw error;
      setProviderId(userData.user_id);
      setIsOnline(userData.is_active || false);
      return userData.user_id;
    } catch {
      return null;
    }
  };

  const fetchRoutes = async (pid: number) => {
    const { data } = await supabase
      .from('provider_routes')
      .select(`
        *,
        start_location:locations!provider_routes_start_location_id_fkey(*),
        end_location:locations!provider_routes_end_location_id_fkey(*),
        vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
      `)
      .eq('provider_id', pid)
      .order('created_at', { ascending: false });

    const list = (data || []) as Route[];
    setRoutes(list);

    const savedId = await getActiveRouteId();
    const restored = savedId ? list.find((r) => r.route_id === savedId) : null;

    if (restored) {
      setActiveRoute(restored);
    } else if (list.length > 0 && !activeRoute) {
      setActiveRoute(list[0]);
      await setActiveRouteId(list[0].route_id);
    } else if (list.length === 0) {
      setActiveRoute(null);
      await setActiveRouteId(null);
    }
  };

  const refreshMatches = async () => {
    if (!activeRoute) {
      setMatchedCount(0);
      return;
    }
    try {
      setCheckingMatches(true);
      const matches = await findMatches(activeRoute.route_id);
      const pending = matches.filter(
        (m) => m.request && (m.request as any).delivery_status !== 'Accepted',
      );
      setMatchedCount(pending.length);
    } catch (e) {
      console.warn('refreshMatches error:', e);
    } finally {
      setCheckingMatches(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const pid = await getProviderData();
    if (pid) await fetchRoutes(pid);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    refreshMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoute?.route_id]);

  useEffect(() => {
    if (!isOnline || !activeRoute) return;
    const iv = setInterval(refreshMatches, 10000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, activeRoute?.route_id]);

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const toggleOnlineStatus = async (online: boolean) => {
    if (!providerId) return;

    if (online && !activeRoute) {
      Alert.alert(
        'Select a Route',
        'Please pick a route before going online. Your app will only match requests along that route.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Pick Route', onPress: () => setRoutePickerVisible(true) },
        ],
      );
      return;
    }

    if (!online && activeRoute) {
      Alert.alert(
        'Go Offline',
        'Going offline will stop matching new requests. Your route will remain saved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Go Offline', style: 'destructive', onPress: async () => {
              await supabase.from('users').update({ is_active: false }).eq('user_id', providerId);
              setIsOnline(false);
              setMatchedCount(0);
            },
          },
        ],
      );
      return;
    }

    await supabase.from('users').update({ is_active: online }).eq('user_id', providerId);
    setIsOnline(online);
    if (online) refreshMatches();
  };

  const pickRoute = async (route: Route) => {
    setActiveRoute(route);
    await setActiveRouteId(route.route_id);
    setRoutePickerVisible(false);
    setTimeout(refreshMatches, 100);
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const pulseScale = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const pulseOpacity = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });
  const bannerTranslate = matchBannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] });

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* Header */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -14)]}>
          <View>
            <Text style={styles.headerGreeting}>{isOnline ? 'You are online' : 'You are offline'}</Text>
            <Text style={styles.headerTitle}>Jobs</Text>
          </View>

          <View style={[styles.statusPill, isOnline ? styles.statusPillOnline : styles.statusPillOffline]}>
            <Animated.View
              style={[
                styles.statusPillDot,
                isOnline && { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                { backgroundColor: isOnline ? '#FFFFFF' : '#9CA3AF' },
              ]}
            />
            <Text style={[styles.statusPillText, { color: isOnline ? '#FFFFFF' : '#6B7280' }]}>
              {isOnline ? 'LIVE' : 'OFFLINE'}
            </Text>
          </View>

          <Image source={require('../../../../assets/Car-Grey.png')} style={styles.vanImage} />
        </Animated.View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <RouteMap
            key={`${isOnline ? 'online' : 'offline'}-${activeRoute?.route_id ?? 'none'}`}
            startLat={activeRoute?.start_location?.latitude}
            startLng={activeRoute?.start_location?.longitude}
            endLat={activeRoute?.end_location?.latitude}
            endLng={activeRoute?.end_location?.longitude}
            centerLat={10.3157}
            centerLng={123.8854}
          />
        </View>

        {/* Bottom Sheet */}
        <Animated.View style={[styles.bottomSheet, fadeUp(sheetAnim, 40)]}>
          <View style={styles.dragHandle} />

          {/* Matched packages banner */}
          {matchedCount > 0 && isOnline && (
            <Animated.View
              style={[
                styles.matchBanner,
                { opacity: matchBannerAnim, transform: [{ translateY: bannerTranslate }] },
              ]}
            >
              <View style={styles.matchBannerIcon}>
                <Ionicons name="flash" size={16} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchBannerTitle}>
                  {matchedCount} {matchedCount === 1 ? 'package matches' : 'packages match'} your route!
                </Text>
                <Text style={styles.matchBannerSub}>
                  Head to the Task tab to review and accept.
                </Text>
              </View>
            </Animated.View>
          )}

          {/* Vehicle / route row */}
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleInfoLeft}>
              <View style={styles.vehicleIconBox}>
                <Ionicons name="car-sport" size={22} color={ORANGE} />
              </View>
              <View style={styles.vehicleTextContainer}>
                <Text style={styles.vehicleNameText}>
                  {activeRoute?.vehicle?.vehicle_type || 'No Active Route'}
                </Text>
                <Text style={styles.vehiclePlateText}>
                  {activeRoute?.vehicle?.plate_number || 'Pick a route below'}
                </Text>
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <Text style={styles.toggleText}>{isOnline ? 'Online' : 'Offline'}</Text>
              <Switch
                trackColor={{ false: '#E5E7EB', true: '#34C759' }}
                thumbColor={'#FFFFFF'}
                ios_backgroundColor="#E5E7EB"
                onValueChange={toggleOnlineStatus}
                value={isOnline}
              />
            </View>
          </View>

          {/* Route selector / CTA */}
          <View style={styles.dynamicContentArea}>
            {!isOnline ? (
              <View style={styles.offlineContainer}>
                <View style={styles.offlineIconBox}>
                  <Ionicons name="moon-outline" size={24} color="#6B7280" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.offlineTextMain}>You are offline</Text>
                  <Text style={styles.offlineTextSub}>Turn on to receive delivery offers.</Text>
                </View>
              </View>
            ) : !activeRoute ? (
              <TouchableOpacity
                style={styles.travelEarnBtn}
                onPress={() => setRoutePickerVisible(true)}
                activeOpacity={0.9}
              >
                <View style={styles.travelEarnIconBox}>
                  <Ionicons name="add" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.travelEarnTitle}>Select a Route</Text>
                  <Text style={styles.travelEarnDesc}>
                    Pick which route you're driving today to start matching.
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.activeRouteBanner}
                onPress={() => setRoutePickerVisible(true)}
                activeOpacity={0.9}
              >
                <View style={styles.activeRouteIconBox}>
                  <Ionicons name="location" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.activeRouteTitle} numberOfLines={1}>
                    {activeRoute.start_location?.city || 'Start'} → {activeRoute.end_location?.city || 'End'}
                  </Text>
                  <Text style={styles.activeRouteDesc} numberOfLines={1}>
                    {activeRoute.start_location?.street_address || ''} → {activeRoute.end_location?.street_address || ''}
                  </Text>
                </View>
                <Ionicons name="chevron-up" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>

        {/* Route Picker Modal */}
        <Modal
          visible={routePickerVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setRoutePickerVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.routePickerSheet}>
              <View style={styles.routePickerHandle} />
              <View style={styles.routePickerHeader}>
                <Text style={styles.routePickerTitle}>Select a Route</Text>
                <TouchableOpacity onPress={() => setRoutePickerVisible(false)}>
                  <Ionicons name="close" size={22} color="#111827" />
                </TouchableOpacity>
              </View>

              {routes.length === 0 ? (
                <View style={styles.routePickerEmpty}>
                  <Ionicons name="map-outline" size={40} color={ORANGE} />
                  <Text style={styles.routePickerEmptyTitle}>No routes yet</Text>
                  <Text style={styles.routePickerEmptySub}>
                    Create routes in Manage Routes, then come back here to select one.
                  </Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {routes.map((r) => {
                    const isSelected = activeRoute?.route_id === r.route_id;
                    return (
                      <TouchableOpacity
                        key={r.route_id}
                        style={[styles.routeOption, isSelected && styles.routeOptionSelected]}
                        onPress={() => pickRoute(r)}
                        activeOpacity={0.85}
                      >
                        <View
                          style={[
                            styles.routeOptionDot,
                            { backgroundColor: isSelected ? ORANGE : '#D1D5DB' },
                          ]}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.routeOptionTitle} numberOfLines={1}>
                            {r.start_location?.city || 'Start'} → {r.end_location?.city || 'End'}
                          </Text>
                          <Text style={styles.routeOptionSub} numberOfLines={1}>
                            {new Date(r.departure_time).toLocaleString()} · {r.route_frequency}
                          </Text>
                          <Text style={styles.routeOptionAddr} numberOfLines={1}>
                            {r.start_location?.street_address} → {r.end_location?.street_address}
                          </Text>
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark-circle" size={22} color={ORANGE} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  <View style={{ height: 30 }} />
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: ORANGE },
  container: { flex: 1, backgroundColor: '#E5E7EB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 13, fontWeight: '500' },

  header: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 26 : 14,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
    zIndex: 10,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerGreeting: { color: '#FFE0C7', fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, gap: 6, borderWidth: 1, zIndex: 5,
  },
  statusPillOnline: { backgroundColor: 'rgba(52,199,89,0.9)', borderColor: 'rgba(255,255,255,0.4)' },
  statusPillOffline: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)' },
  statusPillDot: { width: 8, height: 8, borderRadius: 4 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  vanImage: { position: 'absolute', right: -20, bottom: -18, width: 160, height: 90, opacity: 0.35, zIndex: 1 },

  mapContainer: { position: 'absolute', top: 100, left: 0, right: 0, bottom: 0, zIndex: 1 },

  bottomSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5,
    backgroundColor: '#FFFFFF', paddingTop: 10, paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
  },
  dragHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginBottom: 14 },

  matchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#22C55E', borderRadius: 16, padding: 12, marginBottom: 12,
    shadowColor: '#22C55E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  matchBannerIcon: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
  },
  matchBannerTitle: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: -0.1 },
  matchBannerSub: { color: 'rgba(255,255,255,0.9)', fontSize: 11, marginTop: 2, fontWeight: '600' },

  vehicleRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  vehicleInfoLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  vehicleIconBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  vehicleTextContainer: { flex: 1 },
  vehicleNameText: { fontSize: 14, fontWeight: '800', color: '#111827' },
  vehiclePlateText: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '500', letterSpacing: 0.3 },
  toggleContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggleText: { fontSize: 12, fontWeight: '700', color: '#111827' },

  dynamicContentArea: { marginTop: 14, minHeight: 68, justifyContent: 'center' },
  offlineContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB',
    borderRadius: 16, padding: 14, gap: 12, borderWidth: 1, borderColor: '#F3F4F6',
  },
  offlineIconBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#F3F4F6',
  },
  offlineTextMain: { fontSize: 14, fontWeight: '800', color: '#111827', marginBottom: 2 },
  offlineTextSub: { fontSize: 11, color: '#6B7280', fontWeight: '500' },

  travelEarnBtn: {
    backgroundColor: '#111827', borderRadius: 18, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 10, elevation: 5,
  },
  travelEarnIconBox: {
    width: 44, height: 44, backgroundColor: ORANGE, borderRadius: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  travelEarnTextCol: { flex: 1 },
  travelEarnTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginBottom: 3, letterSpacing: -0.2 },
  travelEarnDesc: { color: '#9CA3AF', fontSize: 11, lineHeight: 15, fontWeight: '500' },

  activeRouteBanner: {
    backgroundColor: '#34C759', borderRadius: 18, padding: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    shadowColor: '#34C759', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  activeRouteIconBox: {
    width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 22, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  activeRouteTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginBottom: 3, letterSpacing: -0.2 },
  activeRouteDesc: { color: 'rgba(255,255,255,0.9)', fontSize: 11, lineHeight: 15, fontWeight: '600' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  routePickerSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  routePickerHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginBottom: 14,
  },
  routePickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  routePickerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  routePickerEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  routePickerEmptyTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginTop: 8 },
  routePickerEmptySub: { fontSize: 12, color: '#6B7280', textAlign: 'center', paddingHorizontal: 20 },

  routeOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  routeOptionSelected: { backgroundColor: '#FFF7ED', borderColor: ORANGE },
  routeOptionDot: { width: 10, height: 10, borderRadius: 5 },
  routeOptionTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  routeOptionSub: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '500' },
  routeOptionAddr: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
});