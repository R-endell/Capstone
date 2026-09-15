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
import DateTimePicker from '@react-native-community/datetimepicker';

const ORANGE = '#FA7A25';
const { width } = Dimensions.get('window');

// Types
interface Location { location_id?: number; street_address: string; barangay: string; city: string; province: string; zip_code: string; latitude: number; longitude: number; }
interface Vehicle { vehicle_id: number; vehicle_type: string; plate_number: string; max_volume_liters: number; max_weight_kg: number; cargo_length_cm: number; cargo_width_cm: number; cargo_height_cm: number; verification_status: string; }

const pad = (n: number) => String(n).padStart(2, '0');

const toLocalIsoString = (date: Date, time: Date) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = time.getHours();
  const mm = time.getMinutes();
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`;
};

// --- MAP COMPONENT ---
const InteractiveMap = ({
  onLocationSelect,
  startLat, startLng, endLat, endLng,
  startName = 'Starting Point',
  endName = 'Destination',
  mode = 'view',
  centerLat,
  centerLng,
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
          .marker-temp { background: #F59E0B; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; color: white; z-index: 999; }
          .popup-content { padding: 4px; }
          .popup-content h4 { margin: 0; font-size: 13px; font-weight: bold; color: #111827; }
          .popup-content p { margin: 2px 0 0 0; font-size: 11px; color: #6B7280; }
          .select-instruction { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.75); color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; z-index: 2000; text-align: center; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        ${mode !== 'view' ? `<div class="select-instruction">Tap on the map to set ${mode === 'select_start' ? 'START' : 'END'} location</div>` : ''}
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${lat}, ${lng}], 14);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          var tempMarker = null;
          ${startLat && startLng ? `
            L.marker([${startLat}, ${startLng}], { icon: L.divIcon({className: 'marker-start', html: 'S', iconSize: [24, 24], iconAnchor: [12, 12]}) })
              .addTo(map).bindPopup('<div class="popup-content"><h4>📍 ${startName}</h4><p>Starting Point</p></div>');
          ` : ''}
          ${endLat && endLng ? `
            L.marker([${endLat}, ${endLng}], { icon: L.divIcon({className: 'marker-end', html: 'E', iconSize: [24, 24], iconAnchor: [12, 12]}) })
              .addTo(map).bindPopup('<div class="popup-content"><h4>📍 ${endName}</h4><p>Destination</p></div>');
          ` : ''}
          ${startLat && startLng && endLat && endLng ? `
            L.polyline([[${startLat}, ${startLng}], [${endLat}, ${endLng}]], { color: '#FA7A25', weight: 4, opacity: 0.8, dashArray: '8, 8' }).addTo(map);
            map.fitBounds(L.latLngBounds([[${startLat}, ${startLng}], [${endLat}, ${endLng}]]), { padding: [40, 40] });
          ` : ''}
          ${mode !== 'view' ? `
            map.on('click', function(e) {
              if (tempMarker) map.removeLayer(tempMarker);
              tempMarker = L.marker([e.latlng.lat, e.latlng.lng], { icon: L.divIcon({className: 'marker-temp', html: '?', iconSize: [20, 20], iconAnchor: [10, 10]}) })
                .addTo(map).bindPopup('<div class="popup-content"><p>📍 Selected location</p></div>').openPopup();
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'location_select', lat: e.latlng.lat, lng: e.latlng.lng }));
            });
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
      scrollEnabled={mode !== 'view'}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
      useWebKit
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'location_select' && onLocationSelect) onLocationSelect(data.lat, data.lng);
        } catch (error) {}
      }}
    />
  );
};

const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
    const data = await response.json();
    if (data && data.display_name) return data.display_name.split(',')[0];
    return null;
  } catch (error) { return null; }
};

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [existingRoutes, setExistingRoutes] = useState<any[]>([]);

  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [routeFrequency, setRouteFrequency] = useState('One-time');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;
  const onlinePulse = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation                                                  */
  /* ------------------------------------------------------------------ */
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
      animate(headerAnim, 0),
      animate(sheetAnim, 220),
    ]).start();
  }, [headerAnim, sheetAnim]);

  /* ------------------------------------------------------------------ */
  /* Online pulse                                                        */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, is_active')
        .eq('auth_id', user.id)
        .single();
      if (userError) throw userError;

      setProviderId(userData.user_id);
      setIsOnline(userData.is_active || false);
      return userData.user_id;
    } catch (error) { return null; }
  };

  const fetchVehicles = async (pid: number) => {
    try {
      const { data } = await supabase.from('vehicles').select('*').eq('provider_id', pid).eq('verification_status', 'Verified');
      setVehicles(data || []);
      if (data && data.length > 0) setSelectedVehicle(data[0]);
    } catch (error) { console.error(error); }
  };

  const fetchRoutes = async (pid: number) => {
    try {
      const { data } = await supabase
        .from('provider_routes')
        .select(`*, start_location:locations!provider_routes_start_location_id_fkey(*), end_location:locations!provider_routes_end_location_id_fkey(*)`)
        .eq('provider_id', pid)
        .order('created_at', { ascending: false });

      setExistingRoutes(data || []);
    } catch (error) { console.error(error); }
  };

  const loadData = async () => {
    setLoading(true);
    const pid = await getProviderData();
    if (pid) {
      await Promise.all([fetchVehicles(pid), fetchRoutes(pid)]);
    }
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const toggleOnlineStatus = async (online: boolean) => {
    if (!providerId) return;

    if (!online && existingRoutes.length > 0) {
      Alert.alert('Go Offline', 'Going offline will cancel your active route. Do you want to continue?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go Offline', style: 'destructive', onPress: async () => {
            await supabase.from('users').update({ is_active: false }).eq('user_id', providerId);
            await deleteRoute(existingRoutes[0].route_id, true);
            setIsOnline(false);
          }
        }
      ]);
    } else {
      await supabase.from('users').update({ is_active: online }).eq('user_id', providerId);
      setIsOnline(online);
    }
  };

  const handleLocationSelect = async (lat: number, lng: number) => {
    try {
      const address = await reverseGeocode(lat, lng) || `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

      const { data: existing } = await supabase.from('locations').select('*').eq('latitude', lat).eq('longitude', lng).limit(1);
      let location = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: address, barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000', latitude: lat, longitude: lng,
        }).select('*').single();
        if (error) throw error;
        location = newLoc;
      }

      if (mapMode === 'select_start') {
        setStartLocation(location);
        setMapMode('view');
      } else if (mapMode === 'select_end') {
        setEndLocation(location);
        setMapMode('view');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save location.');
    }
  };

  const resetForm = () => {
    setStartLocation(null);
    setEndLocation(null);
    setMapMode('view');
    setRouteFrequency('One-time');
    setDepartureDate(new Date());
    setDepartureTime(new Date());
  };

  const createRoute = async () => {
    if (!providerId || !selectedVehicle) return Alert.alert('Error', 'Please select a vehicle');
    if (!startLocation || !endLocation) return Alert.alert('Error', 'Please set both Start and End locations on the map.');

    setSubmitting(true);
    try {
      const departureValue = toLocalIsoString(departureDate, departureTime);

      const { error } = await supabase.from('provider_routes').insert({
        departure_time: departureValue,
        route_frequency: routeFrequency,
        start_location_id: startLocation.location_id,
        end_location_id: endLocation.location_id,
        provider_id: providerId,
        vehicle_id: selectedVehicle.vehicle_id,
      });
      if (error) throw error;

      setModalVisible(false);
      await supabase.from('users').update({ is_active: true }).eq('user_id', providerId);
      setIsOnline(true);
      loadData();
    } catch (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to post route.');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteRoute = async (routeId: number, silent: boolean = false) => {
    if (silent) {
      await supabase.from('provider_routes').delete().eq('route_id', routeId);
      setExistingRoutes(existingRoutes.filter(r => r.route_id !== routeId));
      return;
    }
    Alert.alert('Cancel Route', 'Are you sure you want to cancel your active route?', [
      { text: 'Keep Route', style: 'cancel' },
      {
        text: 'Cancel Route', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', routeId);
          setExistingRoutes(existingRoutes.filter(r => r.route_id !== routeId));
        }
      }
    ]);
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({
        inputRange: [0, 1],
        outputRange: [distance, 0],
      }),
    }],
  });

  const pulseScale = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const pulseOpacity = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

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

  const hasActiveRoute = existingRoutes.length > 0;
  const activeRoute = hasActiveRoute ? existingRoutes[0] : null;

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* Header */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -14)]}>
          <View>
            <Text style={styles.headerGreeting}>
              {isOnline ? 'You are online' : 'You are offline'}
            </Text>
            <Text style={styles.headerTitle}>Jobs</Text>
          </View>

          {/* Online status pill */}
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
          <InteractiveMap
            key={`${isOnline ? 'online' : 'offline'}-${activeRoute?.route_id ?? 'none'}`}
            startLat={isOnline && hasActiveRoute ? activeRoute.start_location.latitude : null}
            startLng={isOnline && hasActiveRoute ? activeRoute.start_location.longitude : null}
            endLat={isOnline && hasActiveRoute ? activeRoute.end_location.latitude : null}
            endLng={isOnline && hasActiveRoute ? activeRoute.end_location.longitude : null}
            centerLat={10.3157}
            centerLng={123.8854}
            mode="view"
          />
        </View>

        {/* Bottom Sheet */}
        <Animated.View style={[styles.bottomSheet, fadeUp(sheetAnim, 40)]}>
          {/* Drag handle */}
          <View style={styles.dragHandle} />

          {/* Vehicle Row */}
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleInfoLeft}>
              <View style={styles.vehicleIconBox}>
                <Ionicons name="car-sport" size={22} color={ORANGE} />
              </View>
              <View style={styles.vehicleTextContainer}>
                <Text style={styles.vehicleNameText}>
                  {selectedVehicle ? `${selectedVehicle.vehicle_type}` : 'No Verified Vehicle'}
                </Text>
                <Text style={styles.vehiclePlateText}>
                  {selectedVehicle ? selectedVehicle.plate_number : 'Please add a vehicle'}
                </Text>
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <Text style={styles.toggleText}>
                {isOnline ? 'Online' : 'Offline'}
              </Text>
              <Switch
                trackColor={{ false: '#E5E7EB', true: '#34C759' }}
                thumbColor={'#FFFFFF'}
                ios_backgroundColor="#E5E7EB"
                onValueChange={toggleOnlineStatus}
                value={isOnline}
              />
            </View>
          </View>

          {/* Dynamic Content */}
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
            ) : !hasActiveRoute ? (
              <TouchableOpacity
                style={styles.travelEarnBtn}
                activeOpacity={0.9}
                onPress={() => {
                  if (vehicles.length === 0) return Alert.alert('No Vehicle', 'Please add a verified vehicle first.');
                  resetForm();
                  setModalVisible(true);
                }}
              >
                <View style={styles.travelEarnIconBox}>
                  <Ionicons name="add" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.travelEarnTitle}>Travel & Earn</Text>
                  <Text style={styles.travelEarnDesc}>
                    Post your trip route to pick up packages along the way.
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            ) : (
              <View style={styles.activeRouteBanner}>
                <View style={styles.activeRouteIconBox}>
                  <Ionicons name="location" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.activeRouteTitle} numberOfLines={1}>
                    {activeRoute.end_location?.city || 'Destination'}
                  </Text>
                  <Text style={styles.activeRouteDesc} numberOfLines={1}>
                    Matching parcels on this path
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteRoute(activeRoute.route_id)} style={styles.activeRouteCloseBtn}>
                  <Ionicons name="close-circle" size={26} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </Animated.View>

        {/* Add Route Modal */}
        <Modal animationType="slide" transparent={true} visible={modalVisible}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>

                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={22} color="#111827" />
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>Post Your Route</Text>
                  <View style={{ width: 40 }} />
                </View>

                <View style={styles.modalMapContainer}>
                  <InteractiveMap
                    onLocationSelect={handleLocationSelect}
                    startLat={startLocation?.latitude}
                    startLng={startLocation?.longitude}
                    endLat={endLocation?.latitude}
                    endLng={endLocation?.longitude}
                    mode={mapMode}
                  />
                </View>

                <View style={styles.locationSelectorsRow}>
                  <TouchableOpacity
                    style={[styles.locationSelectorBtn, startLocation && styles.locationSelected]}
                    onPress={() => setMapMode('select_start')}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.locSelectorIcon, startLocation && { backgroundColor: '#3B82F6' }]}>
                      <Ionicons name="radio-button-on" size={14} color={startLocation ? '#FFFFFF' : '#6B7280'} />
                    </View>
                    <Text style={[styles.locationSelectorText, startLocation && styles.locationSelectorTextSelected]}>
                      {startLocation ? 'Start Set' : 'Set Start'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.locationSelectorBtn, endLocation && styles.locationSelected]}
                    onPress={() => setMapMode('select_end')}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.locSelectorIcon, endLocation && { backgroundColor: '#EF4444' }]}>
                      <Ionicons name="location" size={14} color={endLocation ? '#FFFFFF' : '#6B7280'} />
                    </View>
                    <Text style={[styles.locationSelectorText, endLocation && styles.locationSelectorTextSelected]}>
                      {endLocation ? 'End Set' : 'Set End'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.pickedLocationsDisplay}>
                  <View style={styles.pickedRow}>
                    <View style={[styles.pickedDot, { backgroundColor: '#3B82F6' }]} />
                    <Text style={styles.pickedLocationText} numberOfLines={1}>
                      <Text style={{ fontWeight: '700' }}>Start: </Text>
                      {startLocation?.street_address || 'Tap "Set Start" and pick on map'}
                    </Text>
                  </View>
                  <View style={styles.pickedRow}>
                    <View style={[styles.pickedDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={styles.pickedLocationText} numberOfLines={1}>
                      <Text style={{ fontWeight: '700' }}>End: </Text>
                      {endLocation?.street_address || 'Tap "Set End" and pick on map'}
                    </Text>
                  </View>
                </View>

                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Date</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showDatePicker && setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.pickerValue}>{departureDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="date"
                        display="default"
                        onChange={(e, d) => {
                          if (Platform.OS === 'android') setShowDatePicker(false);
                          if (e.type === 'set' && d) {
                            setDepartureDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                          }
                        }}
                      />
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.pickerValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureTime}
                        mode="time"
                        display="default"
                        onChange={(e, t) => {
                          if (Platform.OS === 'android') setShowTimePicker(false);
                          if (e.type === 'set' && t) {
                            setDepartureTime(new Date(1970, 0, 1, t.getHours(), t.getMinutes()));
                          }
                        }}
                      />
                    )}
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Route Frequency</Text>
                  <View style={styles.frequencyOptions}>
                    {['One-time', 'Daily', 'Weekly', 'Custom'].map((freq) => (
                      <TouchableOpacity
                        key={freq}
                        style={[styles.frequencyOption, routeFrequency === freq && styles.frequencyOptionSelected]}
                        onPress={() => setRouteFrequency(freq)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.frequencyText, routeFrequency === freq && styles.frequencyTextSelected]}>
                          {freq}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Vehicle</Text>
                  <TouchableOpacity
                    style={styles.vehicleSelector}
                    onPress={() => setShowVehicleSelector(true)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.vehicleSelectorLeft}>
                      <View style={styles.vehicleSelectorIconBox}>
                        <Ionicons name="car-sport" size={20} color={ORANGE} />
                      </View>
                      <Text style={styles.vehicleSelectorValue} numberOfLines={1}>
                        {selectedVehicle ? `${selectedVehicle.vehicle_type} - ${selectedVehicle.plate_number}` : 'Select a vehicle'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
                  onPress={createRoute}
                  disabled={submitting}
                  activeOpacity={0.9}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                      <Text style={styles.submitBtnText}>Post Route</Text>
                    </>
                  )}
                </TouchableOpacity>

              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Vehicle Selector Modal */}
        <Modal visible={showVehicleSelector} transparent={true} animationType="slide" onRequestClose={() => setShowVehicleSelector(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.vehicleSelectorModal}>
              <View style={styles.vehicleModalHandle} />
              <Text style={styles.vehicleSelectorModalTitle}>Select Vehicle</Text>
              {vehicles.map((v) => (
                <TouchableOpacity
                  key={v.vehicle_id}
                  style={[styles.vehicleOption, selectedVehicle?.vehicle_id === v.vehicle_id && styles.vehicleOptionSelected]}
                  onPress={() => { setSelectedVehicle(v); setShowVehicleSelector(false); }}
                  activeOpacity={0.85}
                >
                  <View style={[styles.vehicleOptionIconBox, selectedVehicle?.vehicle_id === v.vehicle_id && { backgroundColor: '#FFF7ED' }]}>
                    <Ionicons name="car-sport" size={22} color={selectedVehicle?.vehicle_id === v.vehicle_id ? ORANGE : '#6B7280'} />
                  </View>
                  <View style={styles.vehicleOptionDetails}>
                    <Text style={styles.vehicleOptionName}>{v.vehicle_type}</Text>
                    <Text style={styles.vehicleOptionPlate}>{v.plate_number}</Text>
                  </View>
                  {selectedVehicle?.vehicle_id === v.vehicle_id && (
                    <Ionicons name="checkmark-circle" size={22} color={ORANGE} />
                  )}
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.closeVehicleModal} onPress={() => setShowVehicleSelector(false)} activeOpacity={0.9}>
                <Text style={styles.closeVehicleModalText}>Close</Text>
              </TouchableOpacity>
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

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
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
  headerGreeting: {
    color: '#FFE0C7',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    zIndex: 5,
  },
  statusPillOnline: {
    backgroundColor: 'rgba(52,199,89,0.9)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  statusPillOffline: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: 'rgba(255,255,255,0.3)',
  },
  statusPillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  vanImage: {
    position: 'absolute',
    right: -20,
    bottom: -18,
    width: 160,
    height: 90,
    opacity: 0.35,
    zIndex: 1,
  },

  /* ------------------------------------------------------------------ */
  /* Map                                                                 */
  /* ------------------------------------------------------------------ */
  mapContainer: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },

  /* ------------------------------------------------------------------ */
  /* Bottom Sheet                                                        */
  /* ------------------------------------------------------------------ */
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    backgroundColor: '#FFFFFF',
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 14,
  },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  vehicleInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  vehicleIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  vehicleTextContainer: { flex: 1 },
  vehicleNameText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  vehiclePlateText: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },

  /* ------------------------------------------------------------------ */
  /* Dynamic Content                                                     */
  /* ------------------------------------------------------------------ */
  dynamicContentArea: {
    marginTop: 14,
    minHeight: 68,
    justifyContent: 'center',
  },
  offlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  offlineIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  offlineTextMain: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  offlineTextSub: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  travelEarnBtn: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  travelEarnIconBox: {
    width: 44,
    height: 44,
    backgroundColor: ORANGE,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  travelEarnTextCol: {
    flex: 1,
  },
  travelEarnTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  travelEarnDesc: {
    color: '#9CA3AF',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  activeRouteBanner: {
    backgroundColor: '#34C759',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  activeRouteIconBox: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  activeRouteTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  activeRouteDesc: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  activeRouteCloseBtn: {
    padding: 4,
  },

  /* ------------------------------------------------------------------ */
  /* Modal                                                               */
  /* ------------------------------------------------------------------ */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    paddingTop: 16,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  modalMapContainer: {
    height: 200,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  locationSelectorsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  locationSelectorBtn: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  locationSelected: {
    backgroundColor: '#F0F9FF',
    borderColor: '#3B82F6',
  },
  locSelectorIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locationSelectorText: {
    fontWeight: '700',
    color: '#6B7280',
    fontSize: 13,
  },
  locationSelectorTextSelected: {
    color: '#111827',
  },
  pickedLocationsDisplay: {
    marginBottom: 20,
    padding: 14,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickedLocationText: {
    flex: 1,
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },

  formGroup: { marginBottom: 20 },
  inputLabel: {
    marginBottom: 8,
    fontWeight: '700',
    color: '#374151',
    fontSize: 12,
    letterSpacing: 0.2,
  },
  dateTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 12,
  },
  inputGroup: { flex: 1 },
  dateTimeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '600',
  },

  frequencyOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frequencyOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  frequencyOptionSelected: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  frequencyText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '700',
  },
  frequencyTextSelected: { color: '#FFFFFF' },

  vehicleSelector: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vehicleSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  vehicleSelectorIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleSelectorValue: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '700',
    flex: 1,
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 6,
    marginBottom: 20,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  /* ------------------------------------------------------------------ */
  /* Vehicle Selector Modal                                              */
  /* ------------------------------------------------------------------ */
  vehicleSelectorModal: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    paddingTop: 12,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  vehicleModalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginBottom: 16,
  },
  vehicleSelectorModalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginBottom: 6,
    gap: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  vehicleOptionSelected: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FFE4D2',
  },
  vehicleOptionIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleOptionDetails: { flex: 1 },
  vehicleOptionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  vehicleOptionPlate: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  closeVehicleModal: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
  },
  closeVehicleModalText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '700',
  },
});