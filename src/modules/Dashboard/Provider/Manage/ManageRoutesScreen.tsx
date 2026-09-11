// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, StatusBar,
  Alert, ActivityIndicator, ScrollView, Platform, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';

const ORANGE = '#FA7A25';

interface Location { location_id: number; street_address: string; barangay: string; city: string; province: string; zip_code: string; latitude: number; longitude: number; }
interface Vehicle { vehicle_id: number; vehicle_type: string; plate_number: string; }
interface Route {
  route_id: number; departure_time: string; route_frequency: string; created_at: string;
  start_location_id: number; end_location_id: number; provider_id: number; vehicle_id: number;
  start_location?: Location; end_location?: Location; vehicle?: Vehicle;
}

const pad = (n: number) => String(n).padStart(2, '0');

const toLocalIsoString = (date: Date, time: Date) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const hh = time.getHours();
  const mm = time.getMinutes();
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`;
};

const InteractiveMap = ({ onLocationSelect, startLat, startLng, endLat, endLng, startName = 'Starting Point', endName = 'Destination', mode = 'view' }: any) => {
  const centerLat = startLat || endLat || 10.3157;
  const centerLng = startLng || endLng || 123.8854;

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
          .select-instruction { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.7); color: white; padding: 8px 16px; border-radius: 20px; font-size: 12px; z-index: 2000; text-align: center; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        ${mode !== 'view' ? `<div class="select-instruction">Tap on the map to set ${mode === 'select_start' ? 'START' : 'END'} location</div>` : ''}
        <script>
          var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([${centerLat}, ${centerLng}], 14);
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
      scrollEnabled={false}
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

const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'];

export default function ManageRoutesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  /** NEW: track the route being edited (null = adding new) */
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);

  const [selectedFrequency, setSelectedFrequency] = useState('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const modalAnim = useRef(new Animated.Value(0)).current;

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
      animate(listAnim, 180),
    ]).start();
  }, [headerAnim, listAnim]);

  useEffect(() => {
    if (modalVisible) {
      modalAnim.setValue(0);
      Animated.timing(modalAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [modalVisible, modalAnim]);

  /* ------------------------------------------------------------------ */
  /* Data                                                                */
  /* ------------------------------------------------------------------ */
  const fetchUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
    return data?.user_id || null;
  };

  const fetchVehicles = async (providerId: number) => {
    const { data } = await supabase.from('vehicles').select('vehicle_id, vehicle_type, plate_number').eq('provider_id', providerId).eq('verification_status', 'Verified');
    return data || [];
  };

  const fetchRoutes = async () => {
    setLoading(true);
    const id = await fetchUserId();
    if (!id) return setLoading(false);
    setUserId(id);
    const { data } = await supabase
      .from('provider_routes')
      .select('*, start_location:start_location_id (*), end_location:end_location_id (*), vehicle:vehicle_id (*)')
      .eq('provider_id', id)
      .order('route_id', { ascending: false });
    setRoutes(data || []);
    setVehicles(await fetchVehicles(id));
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchRoutes(); }, []));

  /* ------------------------------------------------------------------ */
  /* Location Select                                                     */
  /* ------------------------------------------------------------------ */
  const handleLocationSelect = async (lat: number, lng: number) => {
    try {
      const { data: existing } = await supabase.from('locations').select('*').eq('latitude', lat).eq('longitude', lng).limit(1);
      let location = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000',
          latitude: lat, longitude: lng,
        }).select('*').single();
        if (error) throw error;
        location = newLoc;
      }

      if (mapMode === 'select_start') { setStartLocation(location); setMapMode('view'); }
      else if (mapMode === 'select_end') { setEndLocation(location); setMapMode('view'); }
    } catch (error) {
      Alert.alert('Error', 'Failed to save location.');
    }
  };

  /* ------------------------------------------------------------------ */
  /* Submit (Add or Update)                                              */
  /* ------------------------------------------------------------------ */
  const handleSubmit = async () => {
    if (!startLocation || !endLocation || !selectedVehicleId || !userId) {
      return Alert.alert('Required', 'Please fill all fields');
    }
    setSubmitting(true);
    try {
      const departureValue = toLocalIsoString(departureDate, departureTime);
      const routeData = {
        departure_time: departureValue,
        route_frequency: selectedFrequency,
        start_location_id: startLocation.location_id,
        end_location_id: endLocation.location_id,
        provider_id: userId,
        vehicle_id: selectedVehicleId,
      };

      let error;
      if (editingRoute) {
        // UPDATE existing route
        const { error: updateError } = await supabase
          .from('provider_routes')
          .update(routeData)
          .eq('route_id', editingRoute.route_id);
        error = updateError;
      } else {
        // INSERT new route
        const { error: insertError } = await supabase.from('provider_routes').insert(routeData);
        error = insertError;
      }

      if (error) throw error;

      Alert.alert('Success', editingRoute ? 'Route updated successfully!' : 'Route added successfully!');
      resetForm();
      setModalVisible(false);
      fetchRoutes();
    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', editingRoute ? 'Failed to update route' : 'Failed to save route');
    } finally {
      setSubmitting(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Delete                                                              */
  /* ------------------------------------------------------------------ */
  const handleDelete = (route: Route) => {
    Alert.alert('Delete Route', 'Are you sure you want to delete this route?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', route.route_id);
          setRoutes(prev => prev.filter(r => r.route_id !== route.route_id));
        }
      }
    ]);
  };

  /* ------------------------------------------------------------------ */
  /* Edit / Add / Reset                                                  */
  /* ------------------------------------------------------------------ */
  const handleEdit = (route: Route) => {
    setEditingRoute(route);

    // Prefill all fields from the route being edited
    const dt = new Date(route.departure_time);
    setDepartureDate(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()));
    setDepartureTime(new Date(1970, 0, 1, dt.getHours(), dt.getMinutes()));
    setSelectedFrequency(route.route_frequency || 'Daily');
    setSelectedVehicleId(route.vehicle_id || null);
    setStartLocation(route.start_location || null);
    setEndLocation(route.end_location || null);
    setMapMode('view');

    setModalVisible(true);
  };

  const handleAdd = () => {
    resetForm();
    setModalVisible(true);
  };

  const resetForm = () => {
    setSelectedFrequency('Daily');
    setDepartureDate(new Date());
    setDepartureTime(new Date());
    setSelectedVehicleId(null);
    setStartLocation(null);
    setEndLocation(null);
    setMapMode('view');
    setEditingRoute(null);
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

  const modalScale = modalAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  /* ------------------------------------------------------------------ */
  /* Route Card                                                          */
  /* ------------------------------------------------------------------ */
  const renderRouteCard = ({ item }: { item: Route }) => {
    const dt = new Date(item.departure_time);
    const freqColor =
      item.route_frequency === 'Daily' ? { bg: '#DBEAFE', fg: '#2563EB' } :
      item.route_frequency === 'Weekly' ? { bg: '#EDE9FE', fg: '#7C3AED' } :
      item.route_frequency === 'One-time' ? { bg: '#FEF3C7', fg: '#D97706' } :
      { bg: '#F3F4F6', fg: '#6B7280' };

    return (
      <View style={styles.routeCard}>
        {/* Accent bar */}
        <View style={[styles.cardAccent, { backgroundColor: freqColor.fg }]} />

        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.routeIconBox}>
              <Ionicons name="map-outline" size={20} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeDate}>
                {dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
              <Text style={styles.routeTime}>
                {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
          <View style={[styles.frequencyBadge, { backgroundColor: freqColor.bg }]}>
            <Text style={[styles.frequencyText, { color: freqColor.fg }]}>
              {item.route_frequency}
            </Text>
          </View>
        </View>

        {/* Timeline */}
        <View style={styles.timeline}>
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconWrapper}>
              <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.timelineText}>
              <Text style={styles.timelineLabel}>PICKUP</Text>
              <Text style={styles.timelineAddress} numberOfLines={2}>
                {item.start_location?.street_address || 'N/A'}
              </Text>
            </View>
          </View>
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconWrapper}>
              <Ionicons name="location" size={16} color="#E11D48" />
            </View>
            <View style={styles.timelineText}>
              <Text style={[styles.timelineLabel, { color: '#E11D48' }]}>DROPOFF</Text>
              <Text style={styles.timelineAddress} numberOfLines={2}>
                {item.end_location?.street_address || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Vehicle */}
        {item.vehicle && (
          <View style={styles.vehicleRow}>
            <Ionicons name="car-sport-outline" size={14} color="#6B7280" />
            <Text style={styles.vehicleText} numberOfLines={1}>
              {item.vehicle.vehicle_type} · {item.vehicle.plate_number}
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={styles.cardFooter}>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => handleEdit(item)}
            activeOpacity={0.85}
          >
            <Ionicons name="create-outline" size={14} color={ORANGE} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            activeOpacity={0.85}
          >
            <Ionicons name="trash-outline" size={14} color="#EF4444" />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSubtitle}>
              {routes.length} {routes.length === 1 ? 'route' : 'routes'}
            </Text>
            <Text style={styles.headerTitle}>Manage Routes</Text>
          </View>
          <TouchableOpacity
            style={styles.headerAddBtn}
            onPress={handleAdd}
            activeOpacity={0.9}
          >
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading routes...</Text>
        </View>
      ) : routes.length === 0 ? (
        <Animated.View style={[styles.emptyContainer, fadeUp(listAnim, 20)]}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="map-outline" size={40} color={ORANGE} />
          </View>
          <Text style={styles.emptyTitle}>No routes yet</Text>
          <Text style={styles.emptySubtitle}>
            Add a travel route so you can be matched with packages on your way.
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd} activeOpacity={0.9}>
            <Ionicons name="add-circle" size={18} color="#FFFFFF" />
            <Text style={styles.emptyAddBtnText}>Add Route</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: listAnim }}>
          <FlatList
            data={routes}
            keyExtractor={(i) => i.route_id.toString()}
            renderItem={renderRouteCard}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshing={loading}
            onRefresh={fetchRoutes}
            ListFooterComponent={<View style={{ height: 40 }} />}
          />
        </Animated.View>
      )}

      {/* Add / Edit Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => { resetForm(); setModalVisible(false); }}
      >
        <View style={styles.modalOverlay}>
          <Animated.View
            style={[
              styles.modalContainer,
              { transform: [{ scale: modalScale }], opacity: modalAnim },
            ]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => { resetForm(); setModalVisible(false); }}
                style={styles.modalCloseBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={20} color="#111827" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingRoute ? 'Edit Route' : 'Add Route'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Map */}
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

              {/* Location selectors */}
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

              {/* Picked locations */}
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

              {/* Date + Time */}
              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <TouchableOpacity
                    style={styles.dateTimeButton}
                    onPress={() => !showDatePicker && setShowDatePicker(true)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
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
                  <TouchableOpacity
                    style={styles.dateTimeButton}
                    onPress={() => !showTimePicker && setShowTimePicker(true)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>
                      {departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
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

              {/* Frequency */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Frequency</Text>
                <View style={styles.frequencyOptions}>
                  {FREQUENCIES.map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      style={[styles.frequencyOption, selectedFrequency === freq && styles.frequencyOptionSelected]}
                      onPress={() => setSelectedFrequency(freq)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.frequencyOptionText, selectedFrequency === freq && styles.frequencyOptionTextSelected]}>
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Vehicle */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                {vehicles.length === 0 ? (
                  <View style={styles.noVehiclesBox}>
                    <Ionicons name="car-outline" size={20} color="#9CA3AF" />
                    <Text style={styles.noVehiclesText}>No verified vehicles found</Text>
                  </View>
                ) : (
                  <View style={styles.vehicleOptions}>
                    {vehicles.map((v) => (
                      <TouchableOpacity
                        key={v.vehicle_id}
                        style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                        onPress={() => setSelectedVehicleId(v.vehicle_id)}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name="car-sport"
                          size={14}
                          color={selectedVehicleId === v.vehicle_id ? '#FFFFFF' : '#6B7280'}
                        />
                        <Text style={[styles.vehicleOptionText, selectedVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                          {v.plate_number}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
                activeOpacity={0.9}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>
                      {editingRoute ? 'Update Route' : 'Save Route'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  /* Header */
  header: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingBottom: 26,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  headerAddBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  /* List */
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#6B7280', fontSize: 13, fontWeight: '500' },

  /* Empty */
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginTop: 4 },
  emptySubtitle: {
    fontSize: 13, color: '#6B7280', textAlign: 'center',
    marginTop: 8, marginBottom: 24, lineHeight: 18,
  },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE,
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 24,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  emptyAddBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  /* Route Card */
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    paddingLeft: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    overflow: 'hidden',
    position: 'relative',
  },
  cardAccent: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0, width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  routeIconBox: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  routeDate: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  routeTime: { fontSize: 16, color: '#111827', fontWeight: '800', marginTop: 2, letterSpacing: -0.2 },
  frequencyBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  frequencyText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  timeline: { marginBottom: 12 },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  timelineIconWrapper: { width: 22, alignItems: 'center', marginRight: 10, zIndex: 2 },
  blueDot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 3, borderColor: '#0000CC',
    justifyContent: 'center', alignItems: 'center',
  },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  timelineLine: { width: 1, height: 22, backgroundColor: '#E5E7EB', marginVertical: 2 },
  timelineText: { flex: 1, paddingTop: 1 },
  timelineLabel: {
    fontSize: 9, fontWeight: '800', color: '#0000CC',
    letterSpacing: 1, marginBottom: 3,
  },
  timelineAddress: { fontSize: 13, fontWeight: '600', color: '#111827', lineHeight: 16 },

  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F9FAFB',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    marginBottom: 12,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  vehicleText: { fontSize: 11, fontWeight: '600', color: '#6B7280', flex: 1 },

  cardFooter: { flexDirection: 'row', gap: 10 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF7ED',
    paddingVertical: 10, borderRadius: 12, gap: 6,
    borderWidth: 1, borderColor: '#FFE4D2',
  },
  editBtnText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    paddingVertical: 10, borderRadius: 12, gap: 6,
    borderWidth: 1, borderColor: '#FECACA',
  },
  deleteBtnText: { color: '#EF4444', fontSize: 13, fontWeight: '700' },

  /* Modal */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    maxHeight: '94%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.15, shadowRadius: 20, elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6',
  },
  modalCloseBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  modalScrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  modalMapContainer: {
    height: 200, borderRadius: 16, overflow: 'hidden',
    marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB',
  },

  locationSelectorsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  locationSelectorBtn: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
    borderWidth: 1.5, borderColor: '#E5E7EB',
  },
  locationSelected: { backgroundColor: '#F0F9FF', borderColor: '#3B82F6' },
  locSelectorIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center', alignItems: 'center',
  },
  locationSelectorText: { fontWeight: '700', color: '#6B7280', fontSize: 13 },
  locationSelectorTextSelected: { color: '#111827' },

  pickedLocationsDisplay: {
    marginBottom: 20, padding: 14,
    backgroundColor: '#F9FAFB', borderRadius: 14, gap: 8,
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickedDot: { width: 8, height: 8, borderRadius: 4 },
  pickedLocationText: { flex: 1, fontSize: 12, color: '#4B5563', fontWeight: '500' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  inputLabel: {
    marginBottom: 8, fontWeight: '700',
    color: '#374151', fontSize: 12, letterSpacing: 0.2,
  },
  dateTimeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  dateTimeValue: { fontSize: 13, color: '#111827', fontWeight: '600' },

  formGroup: { marginBottom: 20 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  frequencyOptionSelected: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  frequencyOptionText: { fontSize: 13, color: '#6B7280', fontWeight: '700' },
  frequencyOptionTextSelected: { color: '#FFFFFF' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1.5, borderColor: '#E5E7EB',
  },
  vehicleOptionActive: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  vehicleOptionText: { fontSize: 13, color: '#6B7280', fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFFFFF' },
  noVehiclesBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F9FAFB',
    padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  noVehiclesText: { fontSize: 13, color: '#9CA3AF', fontWeight: '600' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 16, borderRadius: 16,
    marginTop: 8, gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  submitBtnDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0, elevation: 0 },
  submitBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});