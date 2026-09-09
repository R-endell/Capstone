// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, TextInput, StatusBar, Alert, ActivityIndicator, ScrollView, Dimensions, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width, height } = Dimensions.get('window');

interface Location { location_id: number; street_address: string; barangay: string; city: string; province: string; zip_code: string; latitude: number; longitude: number; }
interface Vehicle { vehicle_id: number; vehicle_type: string; plate_number: string; }
interface Route { route_id: number; departure_time: string; route_frequency: string; created_at: string; start_location_id: number; end_location_id: number; provider_id: number; vehicle_id: number; start_location?: Location; end_location?: Location; vehicle?: Vehicle; }

const FREQUENCIES = ['On-time', 'Daily', 'Weekdays', 'Custom'];

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
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'location_select' && onLocationSelect) onLocationSelect(data.lat, data.lng);
        } catch (error) {}
      }}
    />
  );
};

export default function ManageRoutesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  const [selectedFrequency, setSelectedFrequency] = useState('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

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
    const { data } = await supabase.from('provider_routes').select('*, start_location:start_location_id (*), end_location:end_location_id (*), vehicle:vehicle_id (*)').eq('provider_id', id).order('route_id', { ascending: false });
    setRoutes(data || []);
    setVehicles(await fetchVehicles(id));
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { fetchRoutes(); }, []));

  const handleLocationSelect = async (lat: number, lng: number) => {
    try {
      const { data: existing } = await supabase.from('locations').select('*').eq('latitude', lat).eq('longitude', lng).limit(1);
      let location = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000', latitude: lat, longitude: lng,
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

  const handleSubmit = async () => {
    if (!startLocation || !endLocation || !selectedVehicleId || !userId) return Alert.alert('Required', 'Please fill all fields');
    setSubmitting(true);
    try {
      // Create a unified Date object to ensure the timestamp is strictly accurate
      const combinedDateTime = new Date(departureDate);
      combinedDateTime.setHours(departureTime.getHours(), departureTime.getMinutes(), 0, 0);

      const routeData = {
        departure_time: combinedDateTime.toISOString(),
        route_frequency: selectedFrequency,
        start_location_id: startLocation.location_id,
        end_location_id: endLocation.location_id,
        provider_id: userId,
        vehicle_id: selectedVehicleId,
      };

      if (editingRoute) {
        await supabase.from('provider_routes').update(routeData).eq('route_id', editingRoute.route_id);
      } else {
        await supabase.from('provider_routes').insert(routeData);
      }

      resetForm();
      setModalVisible(false);
      fetchRoutes();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to save route');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (route: Route) => {
    Alert.alert('Delete', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', route.route_id);
          setRoutes(prev => prev.filter(r => r.route_id !== route.route_id));
        }
      }
    ]);
  };

  const resetForm = () => {
    setSelectedFrequency('Daily'); setDepartureDate(new Date()); setDepartureTime(new Date());
    setSelectedVehicleId(null); setStartLocation(null); setEndLocation(null); setMapMode('view'); setEditingRoute(null);
  };

  const renderRouteCard = ({ item }: { item: Route }) => (
    <View style={styles.routeCard}>
      <View style={styles.cardHeader}>
        <Text style={styles.dateTimeText}>
          {new Date(item.departure_time).toLocaleDateString()} • {new Date(item.departure_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        <Text style={styles.frequencyText}>{item.route_frequency}</Text>
      </View>
      <View style={styles.locationSection}>
        <View style={styles.locationDetails}>
          <Text style={styles.locationName}>🔵 {item.start_location?.street_address}</Text>
          <Text style={styles.locationName}>🔴 {item.end_location?.street_address}</Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item)}><Ionicons name="trash" size={22} color="#EF4444" /></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}><Ionicons name="arrow-back" size={24} color="#000" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Routes</Text>
        <TouchableOpacity style={styles.addRouteBtn} onPress={() => { resetForm(); setModalVisible(true); }}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={styles.addRouteText}>Add</Text>
        </TouchableOpacity>
      </View>

      {loading ? <ActivityIndicator size="large" color="#FA7A25" style={{marginTop: 50}}/> : (
        <FlatList data={routes} keyExtractor={(i) => i.route_id.toString()} renderItem={renderRouteCard} contentContainerStyle={{padding: 20}} />
      )}

      <Modal animationType="slide" transparent={true} visible={modalVisible}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setModalVisible(false)}><Ionicons name="close" size={28} color="#000" /></TouchableOpacity>
              <Text style={styles.modalTitle}>Add Route</Text>
              <View style={{width: 28}}/>
            </View>

            <View style={styles.modalMapContainer}>
              <InteractiveMap onLocationSelect={handleLocationSelect} startLat={startLocation?.latitude} startLng={startLocation?.longitude} endLat={endLocation?.latitude} endLng={endLocation?.longitude} mode={mapMode} />
            </View>

            <View style={styles.locationSelectorsRow}>
              <TouchableOpacity style={[styles.locationSelectorBtn, startLocation && styles.locationSelected]} onPress={() => setMapMode('select_start')}>
                <Text style={styles.locationSelectorText}>{startLocation ? '✓ Start Set' : 'Set Start'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.locationSelectorBtn, endLocation && styles.locationSelected]} onPress={() => setMapMode('select_end')}>
                <Text style={styles.locationSelectorText}>{endLocation ? '✓ End Set' : 'Set End'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateTimeRow}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Date</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                  <Text>{departureDate.toLocaleDateString()}</Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker value={departureDate} mode="date" display="default" onChange={(e, d) => {
                    if (Platform.OS === 'android') setShowDatePicker(false);
                    if (e.type === 'set' && d) setDepartureDate(d);
                  }}/>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Time</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                  <Text>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker value={departureTime} mode="time" display="default" onChange={(e, t) => {
                    if (Platform.OS === 'android') setShowTimePicker(false);
                    if (e.type === 'set' && t) setDepartureTime(t);
                  }}/>
                )}
              </View>
            </View>

            <View style={styles.vehicleInputGroup}>
              <Text style={styles.inputLabel}>Vehicle</Text>
              <View style={styles.vehicleOptions}>
                {vehicles.map((v) => (
                  <TouchableOpacity key={v.vehicle_id} style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]} onPress={() => setSelectedVehicleId(v.vehicle_id)}>
                    <Text style={selectedVehicleId === v.vehicle_id ? {color: '#FFF'} : {color: '#000'}}>{v.plate_number}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Save Route</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  header: { backgroundColor: '#FA7A25', paddingHorizontal: 20, paddingBottom: 20, flexDirection: 'row', alignItems: 'center' },
  backBtn: { marginRight: 15 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#000', flex: 1 },
  addRouteBtn: { backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center' },
  addRouteText: { marginLeft: 4, fontWeight: 'bold' },
  routeCard: { backgroundColor: '#FFF', padding: 16, borderRadius: 12, marginBottom: 12, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  dateTimeText: { fontWeight: 'bold' },
  frequencyText: { color: '#6B7280' },
  locationSection: { marginVertical: 8 },
  locationDetails: { gap: 4 },
  locationName: { fontSize: 13, color: '#374151' },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 },
  actionBtn: { padding: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  modalMapContainer: { height: 200, borderRadius: 12, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: '#E5E7EB' },
  locationSelectorsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  locationSelectorBtn: { flex: 1, backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginHorizontal: 4, alignItems: 'center' },
  locationSelected: { backgroundColor: '#E0F2FE', borderColor: '#3B82F6', borderWidth: 1 },
  locationSelectorText: { fontWeight: '500' },
  dateTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  inputGroup: { flex: 1, marginHorizontal: 4 },
  inputLabel: { marginBottom: 6, fontWeight: '500', color: '#374151' },
  dateTimeButton: { borderWidth: 1, borderColor: '#D1D5DB', padding: 12, borderRadius: 8, alignItems: 'center' },
  vehicleInputGroup: { marginBottom: 24 },
  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: { backgroundColor: '#F3F4F6', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  vehicleOptionActive: { backgroundColor: '#FA7A25' },
  submitBtn: { backgroundColor: '#FA7A25', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 40 },
  submitBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
});