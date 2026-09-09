// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, Image, TouchableOpacity, Switch, 
  Platform, Modal, Alert, ActivityIndicator, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';

// Types
interface Location { location_id?: number; street_address: string; barangay: string; city: string; province: string; zip_code: string; latitude: number; longitude: number; }
interface Vehicle { vehicle_id: number; vehicle_type: string; plate_number: string; max_volume_liters: number; max_weight_kg: number; cargo_length_cm: number; cargo_width_cm: number; cargo_height_cm: number; verification_status: string; }

// --- MAP COMPONENT EXACTLY AS IN MANAGE ROUTES ---
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
          var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${centerLat}, ${centerLng}], 14);
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
      scrollEnabled={mode === 'view' ? false : true}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'location_select' && onLocationSelect) onLocationSelect(data.lat, data.lng);
        } catch (error) {}
      }}
    />
  );
};

// Geocoding service
const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
    const data = await response.json();
    if (data && data.display_name) return data.display_name.split(',')[0];
    return null;
  } catch (error) { return null; }
};

export default function JobsScreen() {
  const [isOnline, setIsOnline] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Provider data
  const [providerId, setProviderId] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [existingRoutes, setExistingRoutes] = useState<any[]>([]);
  
  // Route form data
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [routeFrequency, setRouteFrequency] = useState('One-time');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Form Map Mode exactly like ManageRoutesScreen
  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');

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

  const toggleOnlineStatus = async (online: boolean) => {
    if (!providerId) return;

    if (!online && existingRoutes.length > 0) {
      Alert.alert('Go Offline', 'Going offline will cancel your active route. Do you want to continue?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Go Offline', style: 'destructive', onPress: async () => {
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
      const departureDateTime = new Date(departureDate);
      departureDateTime.setHours(departureTime.getHours(), departureTime.getMinutes(), 0, 0);

      await supabase.from('provider_routes').insert({
        departure_time: departureDateTime.toISOString(), 
        route_frequency: routeFrequency, 
        start_location_id: startLocation.location_id, 
        end_location_id: endLocation.location_id, 
        provider_id: providerId, 
        vehicle_id: selectedVehicle.vehicle_id
      });

      setModalVisible(false);
      
      // Auto-toggle online if they post a route
      await supabase.from('users').update({ is_active: true }).eq('user_id', providerId);
      setIsOnline(true);
      
      loadData();
    } catch (error) { 
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
      { text: 'Cancel Route', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', routeId);
          setExistingRoutes(existingRoutes.filter(r => r.route_id !== routeId));
        }
      }
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F27024" />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasActiveRoute = existingRoutes.length > 0;
  const activeRoute = hasActiveRoute ? existingRoutes[0] : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Jobs</Text>
          <Image source={require('../../../../assets/Car-Grey.png')} style={styles.vanImage} />
        </View>

        {/* Full Screen Background Map */}
        <View style={styles.mapContainer}>
          <InteractiveMap 
            key={hasActiveRoute ? activeRoute.route_id.toString() : 'no-route'}
            startLat={isOnline && hasActiveRoute ? activeRoute.start_location.latitude : null}
            startLng={isOnline && hasActiveRoute ? activeRoute.start_location.longitude : null}
            endLat={isOnline && hasActiveRoute ? activeRoute.end_location.latitude : null}
            endLng={isOnline && hasActiveRoute ? activeRoute.end_location.longitude : null}
            centerLat={10.3157}
            centerLng={123.8854}
            mode="view"
          />
        </View>

        {/* Bottom Panel */}
        <View style={styles.bottomSheet}>
          
          <View style={styles.vehicleRow}>
            <View style={styles.vehicleInfoLeft}>
              <Ionicons name="car-sport" size={28} color="#000" />
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
              <Text style={styles.toggleText}>Go {isOnline ? 'offline' : 'online'}</Text>
              <Switch
                trackColor={{ false: '#D1D5DB', true: '#34C759' }}
                thumbColor={'#ffffff'}
                onValueChange={toggleOnlineStatus}
                value={isOnline}
                style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
              />
            </View>
          </View>

          <View style={styles.dynamicContentArea}>
            {!isOnline ? (
              <View style={styles.offlineContainer}>
                <Text style={styles.offlineTextMain}>You are offline.</Text>
                <Text style={styles.offlineTextSub}>Turn on to receive an offer.</Text>
              </View>
            ) : !hasActiveRoute ? (
              <TouchableOpacity 
                style={styles.travelEarnBtn} 
                activeOpacity={0.8}
                onPress={() => {
                  if (vehicles.length === 0) return Alert.alert('No Vehicle', 'Please add a verified vehicle first.');
                  resetForm();
                  setModalVisible(true);
                }}
              >
                <View style={styles.travelEarnIconBox}>
                  <Ionicons name="add" size={24} color="#000" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.travelEarnTitle}>Travel & Earn</Text>
                  <Text style={styles.travelEarnDesc}>
                    Register your One off trip route to pick up packages on your way, and maximize your earnings.
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.activeRouteBanner}>
                <View style={styles.activeRouteIconBox}>
                  <Ionicons name="location" size={20} color="#E11D48" />
                </View>
                <View style={styles.travelEarnTextCol}>
                  <Text style={styles.activeRouteTitle}>
                    Active Route: {activeRoute.end_location?.city || 'Destination'}
                  </Text>
                  <Text style={styles.activeRouteDesc}>
                    We are matching you with parcel on this path.
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteRoute(activeRoute.route_id)} style={styles.activeRouteCloseBtn}>
                  <Ionicons name="close" size={24} color="#000" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* Add Route Modal directly matching ManageRoutes functionality */}
        <Modal animationType="slide" transparent={true} visible={modalVisible}>
          <View style={styles.modalOverlay}>
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Ionicons name="close" size={28} color="#000" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Post Your Route</Text>
                <View style={{width: 28}}/>
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
                <TouchableOpacity style={[styles.locationSelectorBtn, startLocation && styles.locationSelected]} onPress={() => setMapMode('select_start')}>
                  <Text style={styles.locationSelectorText}>{startLocation ? '✓ Start Set' : 'Set Start'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.locationSelectorBtn, endLocation && styles.locationSelected]} onPress={() => setMapMode('select_end')}>
                  <Text style={styles.locationSelectorText}>{endLocation ? '✓ End Set' : 'Set End'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.pickedLocationsDisplay}>
                <Text style={styles.pickedLocationText} numberOfLines={1}>
                  <Text style={{fontWeight: 'bold'}}>Start:</Text> {startLocation?.street_address || 'Tap "Set Start" & pick on map'}
                </Text>
                <Text style={styles.pickedLocationText} numberOfLines={1}>
                  <Text style={{fontWeight: 'bold'}}>End:</Text> {endLocation?.street_address || 'Tap "Set End" & pick on map'}
                </Text>
              </View>

              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                    <Text style={styles.pickerValue}>{departureDate.toLocaleDateString()}</Text>
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
                    <Text style={styles.pickerValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker value={departureTime} mode="time" display="default" onChange={(e, t) => {
                      if (Platform.OS === 'android') setShowTimePicker(false);
                      if (e.type === 'set' && t) setDepartureTime(t);
                    }}/>
                  )}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Frequency</Text>
                <View style={styles.frequencyOptions}>
                  {['One-time', 'Daily', 'Weekly', 'Custom'].map((freq) => (
                    <TouchableOpacity key={freq} style={[styles.frequencyOption, routeFrequency === freq && styles.frequencyOptionSelected]} onPress={() => setRouteFrequency(freq)}>
                      <Text style={[styles.frequencyText, routeFrequency === freq && styles.frequencyTextSelected]}>{freq}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                <TouchableOpacity style={styles.vehicleSelector} onPress={() => setShowVehicleSelector(true)}>
                  <View style={styles.vehicleSelectorLeft}>
                    <Ionicons name="car-sport" size={24} color="#000" />
                    <Text style={styles.vehicleSelectorValue}>{selectedVehicle ? `${selectedVehicle.vehicle_type} - ${selectedVehicle.plate_number}` : 'Select a vehicle'}</Text>
                  </View>
                  <Ionicons name="chevron-down" size={24} color="#6B7280" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={createRoute} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Post Route</Text>}
              </TouchableOpacity>

            </ScrollView>
          </View>
        </Modal>

        {/* Vehicle Selector Modal */}
        <Modal visible={showVehicleSelector} transparent={true} animationType="slide" onRequestClose={() => setShowVehicleSelector(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.vehicleSelectorModal}>
              <Text style={styles.vehicleSelectorModalTitle}>Select Vehicle</Text>
              {vehicles.map((v) => (
                <TouchableOpacity key={v.vehicle_id} style={[styles.vehicleOption, selectedVehicle?.vehicle_id === v.vehicle_id && styles.vehicleOptionSelected]} onPress={() => { setSelectedVehicle(v); setShowVehicleSelector(false); }}>
                  <Ionicons name="car-sport" size={24} color={selectedVehicle?.vehicle_id === v.vehicle_id ? '#FA7A25' : '#6B7280'} />
                  <View style={styles.vehicleOptionDetails}>
                    <Text style={styles.vehicleOptionName}>{v.vehicle_type}</Text>
                    <Text style={styles.vehicleOptionPlate}>{v.plate_number}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.closeVehicleModal} onPress={() => setShowVehicleSelector(false)}><Text style={styles.closeVehicleModalText}>Close</Text></TouchableOpacity>
            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FA7A25' },
  container: { flex: 1, backgroundColor: '#E5E7EB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14 },
  header: {
    backgroundColor: '#FA7A25',
    height: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 30 : 10,
    overflow: 'hidden',
    zIndex: 10,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 1,
  },
  vanImage: {
    position: 'absolute',
    right: -10,
    bottom: -15,
    width: 180,
    height: 100,
    zIndex: 1,
  },
  mapContainer: {
    ...StyleSheet.absoluteFillObject,
    top: 100,
    zIndex: 0,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
  },
  vehicleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  vehicleInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleTextContainer: {
    marginLeft: 10,
  },
  vehicleNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  vehiclePlateText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginRight: 6,
  },
  dynamicContentArea: {
    marginTop: 16,
    minHeight: 60,
    justifyContent: 'center',
  },
  offlineContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  offlineTextMain: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  offlineTextSub: {
    fontSize: 13,
    color: '#6B7280',
  },
  travelEarnBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  travelEarnIconBox: {
    width: 40,
    height: 40,
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  travelEarnTextCol: {
    flex: 1,
  },
  travelEarnTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  travelEarnDesc: {
    color: '#D1D5DB',
    fontSize: 10,
    lineHeight: 14,
  },
  activeRouteBanner: {
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeRouteIconBox: {
    width: 40,
    height: 40,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activeRouteTitle: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 2,
  },
  activeRouteDesc: {
    color: '#000000',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  activeRouteCloseBtn: {
    padding: 4,
  },
  
  // MODAL STYLES (MATCHING MANAGE ROUTES SCREEN)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 'bold' },
  modalMapContainer: { height: 200, borderRadius: 12, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: '#E5E7EB' },
  locationSelectorsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  locationSelectorBtn: { flex: 1, backgroundColor: '#F3F4F6', padding: 12, borderRadius: 8, marginHorizontal: 4, alignItems: 'center' },
  locationSelected: { backgroundColor: '#E0F2FE', borderColor: '#3B82F6', borderWidth: 1 },
  locationSelectorText: { fontWeight: '600', color: '#111827' },
  pickedLocationsDisplay: { marginBottom: 20, paddingHorizontal: 4 },
  pickedLocationText: { fontSize: 13, color: '#4B5563', marginBottom: 4 },
  
  formGroup: { marginBottom: 20 },
  inputLabel: { marginBottom: 6, fontWeight: '600', color: '#374151', fontSize: 13 },
  dateTimeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  inputGroup: { flex: 1, marginHorizontal: 4 },
  dateTimePicker: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center' },
  pickerValue: { fontSize: 14, color: '#111827', fontWeight: '500' },
  
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
  frequencyOptionSelected: { backgroundColor: '#FA7A25', borderColor: '#FA7A25' },
  frequencyText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  frequencyTextSelected: { color: '#FFFFFF' },
  
  vehicleSelector: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vehicleSelectorLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleSelectorValue: { fontSize: 14, color: '#111827', fontWeight: '600' },
  
  submitBtn: { backgroundColor: '#FA7A25', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 10, marginBottom: 40 },
  disabledBtn: { opacity: 0.6 },
  submitBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  
  vehicleSelectorModal: { backgroundColor: '#FFFFFF', padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  vehicleSelectorModalTitle: { fontSize: 18, fontWeight: '600', color: '#000000', marginBottom: 16 },
  vehicleOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 12 },
  vehicleOptionSelected: { backgroundColor: '#FEF3E8', borderRadius: 8 },
  vehicleOptionDetails: { flex: 1 },
  vehicleOptionName: { fontSize: 14, fontWeight: '500', color: '#111827' },
  vehicleOptionPlate: { fontSize: 12, color: '#6B7280' },
  closeVehicleModal: { marginTop: 16, paddingVertical: 12, alignItems: 'center', borderRadius: 8, backgroundColor: '#F3F4F6' },
  closeVehicleModalText: { color: '#6B7280', fontSize: 16, fontWeight: '500' },
});