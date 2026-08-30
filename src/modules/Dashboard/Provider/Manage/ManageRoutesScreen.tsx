// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  StatusBar,
  Alert,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width, height } = Dimensions.get('window');

interface Location {
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
}

interface Route {
  route_id: number;
  departure_time: string;
  route_frequency: string;
  created_at: string;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location?: Location;
  end_location?: Location;
  vehicle?: Vehicle;
}

const FREQUENCIES = ['On-time', 'Daily', 'Weekdays', 'Custom'];

// Interactive Map Component with Click to Select
const InteractiveMap = ({ 
  onLocationSelect,
  startLat, 
  startLng, 
  endLat, 
  endLng,
  startName = 'Starting Point',
  endName = 'Destination',
  mode = 'view',
}: { 
  onLocationSelect?: (lat: number, lng: number) => void;
  startLat?: number; 
  startLng?: number; 
  endLat?: number; 
  endLng?: number;
  startName?: string;
  endName?: string;
  mode?: string;
}) => {
  const defaultLat = 10.3157;
  const defaultLng = 123.8854;
  
  const centerLat = startLat || endLat || defaultLat;
  const centerLng = startLng || endLng || defaultLng;

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { 
            margin: 0; 
            padding: 0; 
            width: 100%; 
            height: 100%; 
            background: #E5E7EB;
          }
          .marker-start {
            background: #3B82F6;
            border: 3px solid white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            color: white;
            z-index: 1000;
          }
          .marker-end {
            background: #EF4444;
            border: 3px solid white;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            font-weight: bold;
            color: white;
            z-index: 1000;
          }
          .marker-temp {
            background: #F59E0B;
            border: 3px solid white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 8px;
            font-weight: bold;
            color: white;
            z-index: 999;
          }
          .popup-content {
            padding: 4px;
          }
          .popup-content h4 {
            margin: 0;
            font-size: 13px;
            font-weight: bold;
            color: #111827;
          }
          .popup-content p {
            margin: 2px 0 0 0;
            font-size: 11px;
            color: #6B7280;
          }
          .select-instruction {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            z-index: 2000;
            text-align: center;
            white-space: nowrap;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        ${mode !== 'view' ? `<div class="select-instruction">Tap on the map to set ${mode === 'select_start' ? 'START' : 'END'} location</div>` : ''}
        <script>
          var map = L.map('map', {
            zoomControl: true,
            attributionControl: false,
          }).setView([${centerLat}, ${centerLng}], 14);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
          }).addTo(map);

          var startMarker = null;
          var endMarker = null;
          var tempMarker = null;

          // Start Marker
          ${startLat && startLng ? `
            var startIcon = L.divIcon({
              className: 'marker-start',
              html: 'S',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });
            startMarker = L.marker([${startLat}, ${startLng}], { icon: startIcon })
              .addTo(map)
              .bindPopup('<div class="popup-content"><h4>📍 ${startName}</h4><p>Starting Point</p></div>');
          ` : ''}

          // End Marker
          ${endLat && endLng ? `
            var endIcon = L.divIcon({
              className: 'marker-end',
              html: 'E',
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });
            endMarker = L.marker([${endLat}, ${endLng}], { icon: endIcon })
              .addTo(map)
              .bindPopup('<div class="popup-content"><h4>📍 ${endName}</h4><p>Destination</p></div>');
          ` : ''}

          // Draw route line
          ${startLat && startLng && endLat && endLng ? `
            var routeLine = L.polyline([
              [${startLat}, ${startLng}],
              [${endLat}, ${endLng}]
            ], {
              color: '#FA7A25',
              weight: 4,
              opacity: 0.8,
              dashArray: '8, 8',
            }).addTo(map);

            var bounds = L.latLngBounds([
              [${startLat}, ${startLng}],
              [${endLat}, ${endLng}]
            ]);
            map.fitBounds(bounds, { padding: [40, 40] });
          ` : ''}

          // Click handler for location selection
          ${mode !== 'view' ? `
            map.on('click', function(e) {
              var lat = e.latlng.lat;
              var lng = e.latlng.lng;
              
              // Remove temp marker
              if (tempMarker) {
                map.removeLayer(tempMarker);
              }
              
              // Add temp marker
              var tempIcon = L.divIcon({
                className: 'marker-temp',
                html: '?',
                iconSize: [20, 20],
                iconAnchor: [10, 10],
              });
              tempMarker = L.marker([lat, lng], { icon: tempIcon })
                .addTo(map)
                .bindPopup('<div class="popup-content"><p>📍 Selected location</p></div>')
                .openPopup();

              // Send to React Native
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'location_select',
                lat: lat,
                lng: lng
              }));
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
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'location_select' && onLocationSelect) {
            onLocationSelect(data.lat, data.lng);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
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

  // Form State
  const [selectedFrequency, setSelectedFrequency] = useState('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [endLocation, setEndLocation] = useState<Location | null>(null);
  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Location[]>([]);

  // Fetch user ID
  const fetchUserId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching user:', error);
        return null;
      }

      return userData?.user_id || null;
    } catch (error) {
      console.error('Error fetching user ID:', error);
      return null;
    }
  };

  // Fetch vehicles
  const fetchVehicles = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('vehicle_id, vehicle_type, plate_number')
        .eq('provider_id', providerId)
        .eq('verification_status', 'Verified');

      if (error) {
        console.error('Error fetching vehicles:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      return [];
    }
  };

  // Fetch routes
  const fetchRoutes = async () => {
    try {
      setLoading(true);
      
      const id = await fetchUserId();
      if (!id) {
        setLoading(false);
        return;
      }

      setUserId(id);

      const { data, error } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:start_location_id (*),
          end_location:end_location_id (*),
          vehicle:vehicle_id (*)
        `)
        .eq('provider_id', id)
        .order('route_id', { ascending: false });

      if (error) {
        console.error('Error fetching routes:', error);
        Alert.alert('Error', 'Failed to load routes');
        return;
      }

      setRoutes(data || []);
      
      const vehicleData = await fetchVehicles(id);
      setVehicles(vehicleData);
    } catch (error) {
      console.error('Error fetching routes:', error);
      Alert.alert('Error', 'Failed to load routes');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchRoutes();
    }, [])
  );

  // Handle location selection from map - SAVES TO DATABASE
  const handleLocationSelect = async (lat: number, lng: number) => {
    try {
      // First, try to find if this location already exists
      const { data: existingLocations, error: searchError } = await supabase
        .from('locations')
        .select('*')
        .eq('latitude', lat)
        .eq('longitude', lng)
        .limit(1);

      if (searchError) {
        console.error('Error searching location:', searchError);
      }

      let location: Location | null = null;

      if (existingLocations && existingLocations.length > 0) {
        // Location exists, use it
        location = existingLocations[0];
      } else {
        // Create new location with placeholder data
        const { data: newLocation, error: insertError } = await supabase
          .from('locations')
          .insert({
            street_address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            barangay: 'Unknown',
            city: 'Unknown',
            province: 'Unknown',
            zip_code: '0000',
            latitude: lat,
            longitude: lng,
          })
          .select('*')
          .single();

        if (insertError) {
          console.error('Error inserting location:', insertError);
          Alert.alert('Error', 'Failed to save location. Please try searching for an existing location instead.');
          return;
        }

        location = newLocation;
        Alert.alert('Location Saved', 'New location has been saved to the database.');
      }

      if (!location) {
        Alert.alert('Error', 'Failed to get location');
        return;
      }

      // Set the location based on mode
      if (mapMode === 'select_start') {
        setStartLocation(location);
        setMapMode('view');
        Alert.alert('Start Location Set', 'Starting point has been set on the map.');
      } else if (mapMode === 'select_end') {
        setEndLocation(location);
        setMapMode('view');
        Alert.alert('End Location Set', 'Destination has been set on the map.');
      }
    } catch (error) {
      console.error('Error setting location:', error);
      Alert.alert('Error', 'Failed to set location. Please try searching for an existing location instead.');
    }
  };

  // Search locations
  const searchLocations = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .or(`street_address.ilike.%${query}%,barangay.ilike.%${query}%,city.ilike.%${query}%,province.ilike.%${query}%`)
        .limit(10);

      if (error) {
        console.error('Error searching locations:', error);
        return;
      }

      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching locations:', error);
    }
  };

  // Select location from search
  const selectLocation = (location: Location) => {
    if (mapMode === 'select_start') {
      setStartLocation(location);
      setMapMode('view');
    } else if (mapMode === 'select_end') {
      setEndLocation(location);
      setMapMode('view');
    }
    setSearchResults([]);
    setSearchQuery('');
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!startLocation || !endLocation) {
      Alert.alert('Required', 'Please select both start and end locations');
      return;
    }

    if (!selectedVehicleId) {
      Alert.alert('Required', 'Please select a vehicle');
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'User not found');
      return;
    }

    setSubmitting(true);
    try {
      // Combine date and time
      const departureDateTime = new Date(
        departureDate.getFullYear(),
        departureDate.getMonth(),
        departureDate.getDate(),
        departureTime.getHours(),
        departureTime.getMinutes()
      );

      const routeData = {
        departure_time: departureDateTime.toISOString(),
        route_frequency: selectedFrequency,
        start_location_id: startLocation.location_id,
        end_location_id: endLocation.location_id,
        provider_id: userId,
        vehicle_id: selectedVehicleId,
      };

      let error;

      if (editingRoute) {
        const { error: updateError } = await supabase
          .from('provider_routes')
          .update(routeData)
          .eq('route_id', editingRoute.route_id);

        error = updateError;
      } else {
        const { error: insertError } = await supabase
          .from('provider_routes')
          .insert(routeData);

        error = insertError;
      }

      if (error) throw error;

      Alert.alert(
        'Success',
        editingRoute ? 'Route updated successfully!' : 'Route added successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              resetForm();
              setModalVisible(false);
              fetchRoutes();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('Submit error:', error);
      Alert.alert('Error', error.message || 'Failed to save route');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete route
  const handleDelete = (route: Route) => {
    Alert.alert(
      'Delete Route',
      'Are you sure you want to delete this route?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('provider_routes')
                .delete()
                .eq('route_id', route.route_id);

              if (error) throw error;

              setRoutes(prev => prev.filter(r => r.route_id !== route.route_id));
              Alert.alert('Success', 'Route deleted successfully');
            } catch (error: any) {
              console.error('Delete error:', error);
              Alert.alert('Error', error.message || 'Failed to delete route');
            }
          },
        },
      ]
    );
  };

  // Reset form
  const resetForm = () => {
    setSelectedFrequency('Daily');
    setDepartureDate(new Date());
    setDepartureTime(new Date());
    setSelectedVehicleId(null);
    setStartLocation(null);
    setEndLocation(null);
    setSearchQuery('');
    setSearchResults([]);
    setMapMode('view');
    setEditingRoute(null);
  };

  // Open edit modal
  const handleEdit = (route: Route) => {
    setEditingRoute(route);
    setSelectedFrequency(route.route_frequency);
    setSelectedVehicleId(route.vehicle_id);
    setStartLocation(route.start_location || null);
    setEndLocation(route.end_location || null);

    const date = new Date(route.departure_time);
    setDepartureDate(date);
    setDepartureTime(date);

    setModalVisible(true);
  };

  // Handle date change (FIXED - using onValueChange)
  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) {
      setDepartureDate(selectedDate);
    }
  };

  // Handle time change (FIXED - using onValueChange)
  const handleTimeChange = (event: any, selectedTime?: Date) => {
    setShowTimePicker(false);
    if (selectedTime) {
      setDepartureTime(selectedTime);
    }
  };

  // Render route card
  const renderRouteCard = ({ item }: { item: Route }) => {
    const isActive = new Date(item.departure_time) > new Date();
    
    return (
      <View style={styles.routeCard}>
        <View style={styles.cardHeader}>
          {isActive && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeText}>Active</Text>
            </View>
          )}
          <Text style={styles.dateTimeText}>
            {new Date(item.departure_time).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })} • {new Date(item.departure_time).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <Text style={styles.frequencyText}>{item.route_frequency}</Text>
        </View>

        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="radio-button-on" size={18} color="#3B82F6" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>
                  {item.start_location?.street_address || 'N/A'}
                </Text>
                <Text style={styles.locationAddress}>
                  {item.start_location?.barangay}, {item.start_location?.city}
                </Text>
              </View>
            </View>

            <View style={styles.connectingLine} />

            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="location" size={18} color="#EF4444" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>
                  {item.end_location?.street_address || 'N/A'}
                </Text>
                <Text style={styles.locationAddress}>
                  {item.end_location?.barangay}, {item.end_location?.city}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.miniMapWrapper}>
            <InteractiveMap 
              startLat={item.start_location?.latitude}
              startLng={item.start_location?.longitude}
              endLat={item.end_location?.latitude}
              endLng={item.end_location?.longitude}
              startName={item.start_location?.street_address || 'Start'}
              endName={item.end_location?.street_address || 'End'}
              mode="view"
            />
          </View>
        </View>

        <View style={styles.vehicleInfo}>
          <Ionicons name="car-sport" size={16} color="#6B7280" />
          <Text style={styles.vehicleInfoText}>
            {item.vehicle?.vehicle_type || 'N/A'} • {item.vehicle?.plate_number || 'N/A'}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleEdit(item)}>
            <Ionicons name="pencil" size={22} color="#4B5563" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleDelete(item)}>
            <Ionicons name="trash" size={22} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Routes</Text>
        </View>

        <TouchableOpacity style={styles.addRouteBtn} onPress={() => {
          resetForm();
          setModalVisible(true);
        }}>
          <Ionicons name="add" size={18} color="#000" />
          <Text style={styles.addRouteText}>Add New Route</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FA7A25" />
          <Text style={styles.loadingText}>Loading routes...</Text>
        </View>
      ) : routes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="map-outline" size={64} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No routes yet</Text>
          <Text style={styles.emptySubtitle}>
            Add your first route to start accepting deliveries
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={() => {
            resetForm();
            setModalVisible(true);
          }}>
            <Text style={styles.emptyAddBtnText}>Add Route</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(item) => item.route_id.toString()}
          renderItem={renderRouteCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={fetchRoutes}
        />
      )}

      {/* Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => {
          resetForm();
          setModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView 
            style={styles.modalScrollView}
            contentContainerStyle={styles.modalContentContainer}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity 
                  onPress={() => {
                    resetForm();
                    setModalVisible(false);
                  }} 
                  style={styles.modalBackBtn}
                >
                  <Ionicons name="arrow-back" size={24} color="#000" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>
                  {editingRoute ? 'Edit Route' : 'Add Route'}
                </Text>
                <View style={{ width: 24 }} />
              </View>

              {/* Interactive Map */}
              <View style={styles.modalMapContainer}>
                <InteractiveMap 
                  onLocationSelect={handleLocationSelect}
                  startLat={startLocation?.latitude}
                  startLng={startLocation?.longitude}
                  endLat={endLocation?.latitude}
                  endLng={endLocation?.longitude}
                  startName={startLocation?.street_address || 'Starting Point'}
                  endName={endLocation?.street_address || 'Destination'}
                  mode={mapMode}
                />
              </View>

              {/* Location Selection Buttons */}
              <View style={styles.locationSelectorsRow}>
                <TouchableOpacity 
                  style={[styles.locationSelectorBtn, startLocation && styles.locationSelected]}
                  onPress={() => setMapMode(mapMode === 'select_start' ? 'view' : 'select_start')}
                >
                  <Ionicons name="radio-button-on" size={16} color={startLocation ? "#3B82F6" : "#6B7280"} />
                  <Text style={[styles.locationSelectorText, startLocation && styles.locationSelectedText]}>
                    {startLocation ? '✓ Start Set' : mapMode === 'select_start' ? 'Tap Map for Start' : 'Set Start'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.locationSelectorBtn, endLocation && styles.locationSelected]}
                  onPress={() => setMapMode(mapMode === 'select_end' ? 'view' : 'select_end')}
                >
                  <Ionicons name="location" size={16} color={endLocation ? "#EF4444" : "#6B7280"} />
                  <Text style={[styles.locationSelectorText, endLocation && styles.locationSelectedText]}>
                    {endLocation ? '✓ End Set' : mapMode === 'select_end' ? 'Tap Map for End' : 'Set End'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Search Locations */}
              <View style={styles.searchContainer}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search for a location..."
                  placeholderTextColor="#9CA3AF"
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    searchLocations(text);
                  }}
                />
                {searchResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchResults.map((location) => (
                      <TouchableOpacity
                        key={location.location_id}
                        style={styles.searchResultItem}
                        onPress={() => selectLocation(location)}
                      >
                        <Text style={styles.searchResultText}>
                          {location.street_address}, {location.barangay}, {location.city}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Date Picker - FIXED with onValueChange */}
              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <TouchableOpacity 
                    style={styles.dateTimeButton}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Text style={styles.dateTimeButtonText}>
                      {departureDate.toLocaleDateString('en-US', {
                        month: 'long',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                    <Ionicons name="calendar-outline" size={20} color="#6B7280" />
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      value={departureDate}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleDateChange}
                    />
                  )}
                </View>

                {/* Time Picker - FIXED with onValueChange */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Departure Time</Text>
                  <TouchableOpacity 
                    style={styles.dateTimeButton}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={styles.dateTimeButtonText}>
                      {departureTime.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                    <Ionicons name="time-outline" size={20} color="#6B7280" />
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker
                      value={departureTime}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={handleTimeChange}
                    />
                  )}
                </View>
              </View>

              {/* Frequency */}
              <View style={styles.frequencyGroup}>
                <Text style={styles.inputLabel}>Frequency</Text>
                <View style={styles.frequencyRow}>
                  {FREQUENCIES.map((freq) => (
                    <TouchableOpacity
                      key={freq}
                      style={[styles.freqBtn, selectedFrequency === freq && styles.freqBtnActive]}
                      onPress={() => setSelectedFrequency(freq)}
                    >
                      <Text style={[styles.freqText, selectedFrequency === freq && styles.freqTextActive]}>
                        {freq}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Vehicle Selection */}
              <View style={styles.vehicleInputGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                {vehicles.length === 0 ? (
                  <View style={styles.noVehicleContainer}>
                    <Text style={styles.noVehicleText}>
                      No verified vehicles found. Please add a vehicle first.
                    </Text>
                    <TouchableOpacity 
                      style={styles.addVehicleLink}
                      onPress={() => {
                        setModalVisible(false);
                        navigation.navigate('ManageVehicle' as never);
                      }}
                    >
                      <Text style={styles.addVehicleLinkText}>Add Vehicle</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.vehicleOptions}>
                      {vehicles.map((vehicle) => (
                        <TouchableOpacity
                          key={vehicle.vehicle_id}
                          style={[
                            styles.vehicleOption,
                            selectedVehicleId === vehicle.vehicle_id && styles.vehicleOptionActive,
                          ]}
                          onPress={() => setSelectedVehicleId(vehicle.vehicle_id)}
                        >
                          <Ionicons 
                            name="car-sport" 
                            size={20} 
                            color={selectedVehicleId === vehicle.vehicle_id ? '#FFF' : '#4B5563'} 
                          />
                          <Text style={[
                            styles.vehicleOptionText,
                            selectedVehicleId === vehicle.vehicle_id && styles.vehicleOptionTextActive,
                          ]}>
                            {vehicle.vehicle_type}
                          </Text>
                          <Text style={[
                            styles.vehicleOptionPlate,
                            selectedVehicleId === vehicle.vehicle_id && styles.vehicleOptionTextActive,
                          ]}>
                            {vehicle.plate_number}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {editingRoute ? 'Update Route' : 'Save Route'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    backgroundColor: '#FA7A25',
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000',
  },
  addRouteBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  addRouteText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginLeft: 4,
  },
  listContent: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  emptyAddBtn: {
    backgroundColor: '#FA7A25',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyAddBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    marginBottom: 12,
  },
  activeBadge: {
    backgroundColor: '#86EFAC',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginBottom: 6,
  },
  activeText: {
    color: '#166534',
    fontSize: 10,
    fontWeight: '600',
  },
  dateTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  frequencyText: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  locationSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  locationDetails: {
    flex: 1,
    marginRight: 12,
    position: 'relative',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 24,
    alignItems: 'center',
    marginRight: 8,
    zIndex: 2,
    backgroundColor: '#FFF',
  },
  connectingLine: {
    position: 'absolute',
    left: 11,
    top: 20,
    bottom: 30,
    width: 1,
    backgroundColor: '#D1D5DB',
    zIndex: 1,
  },
  locationTextWrapper: {
    flex: 1,
  },
  locationName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  locationAddress: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 14,
  },
  miniMapWrapper: {
    width: 100,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  vehicleInfoText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 8,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  actionBtn: {
    padding: 4,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalScrollView: {
    flex: 1,
  },
  modalContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalBackBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  modalMapContainer: {
    height: 220,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  locationSelectorsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  locationSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    width: '48%',
    justifyContent: 'center',
  },
  locationSelected: {
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  locationSelectedText: {
    color: '#1E40AF',
  },
  locationSelectorText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
  },
  searchContainer: {
    marginBottom: 12,
    position: 'relative',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#FFF',
  },
  searchResults: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    maxHeight: 150,
    zIndex: 10,
  },
  searchResultItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  searchResultText: {
    fontSize: 12,
    color: '#374151',
  },
  dateTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  inputGroup: {
    width: '48%',
  },
  inputLabel: {
    fontSize: 12,
    color: '#111827',
    marginBottom: 6,
    fontWeight: '500',
  },
  dateTimeButton: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  dateTimeButtonText: {
    fontSize: 12,
    color: '#000',
  },
  frequencyGroup: {
    marginBottom: 12,
  },
  frequencyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  freqBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  freqBtnActive: {
    backgroundColor: '#FA7A25',
  },
  freqText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
  freqTextActive: {
    color: '#FFFFFF',
  },
  vehicleInputGroup: {
    marginBottom: 16,
  },
  vehicleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  vehicleOptionActive: {
    backgroundColor: '#FA7A25',
  },
  vehicleOptionText: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
    marginLeft: 6,
  },
  vehicleOptionTextActive: {
    color: '#FFFFFF',
  },
  vehicleOptionPlate: {
    fontSize: 10,
    color: '#6B7280',
    marginLeft: 4,
  },
  noVehicleContainer: {
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
  },
  noVehicleText: {
    fontSize: 12,
    color: '#92400E',
    textAlign: 'center',
  },
  addVehicleLink: {
    marginTop: 8,
  },
  addVehicleLinkText: {
    color: '#FA7A25',
    fontSize: 14,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#FA7A25',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});