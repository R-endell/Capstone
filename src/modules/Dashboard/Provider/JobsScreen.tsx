import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, Image, TouchableOpacity, Switch, 
  SafeAreaView, Platform, Modal, Alert, ActivityIndicator, 
  ScrollView, TextInput, RefreshControl, Dimensions 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';

// Types
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

// Map component with interactive features
const InteractiveMap = ({ 
  lat, 
  lng, 
  zoom = 13,
  markers = [],
  onMapClick,
  onMapReady,
  searchQuery = '',
  showSearch = true
}: { 
  lat: number; 
  lng: number; 
  zoom?: number;
  markers?: Array<{lat: number, lng: number, color?: string, label?: string}>;
  onMapClick?: (lat: number, lng: number) => void;
  onMapReady?: () => void;
  searchQuery?: string;
  showSearch?: boolean;
}) => {
  const webViewRef = useRef<WebView>(null);
  const [mapInitialized, setMapInitialized] = useState(false);

  // Build marker scripts
  const markerScripts = markers.map((m, index) => `
    var marker${index} = L.circleMarker([${m.lat}, ${m.lng}], {
      radius: 10,
      fillColor: "${m.color || '#3B82F6'}",
      color: "#FFFFFF",
      weight: 2,
      opacity: 1,
      fillOpacity: 1
    }).addTo(map);
    
    ${m.label ? `
      marker${index}.bindPopup("<b>${m.label}</b>").openPopup();
    ` : ''}
    
    // Store marker for later use
    window.markers = window.markers || [];
    window.markers.push(marker${index});
  `).join('');

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script src="https://unpkg.com/leaflet-control-geocoder/dist/Control.Geocoder.js"></script>
        <style>
          html, body, #map { 
            margin: 0; 
            padding: 0; 
            width: 100%; 
            height: 100%; 
            background: #E5E7EB; 
          }
          .search-container {
            position: absolute;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            width: 90%;
            max-width: 400px;
          }
          .search-container input {
            width: 100%;
            padding: 12px 16px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.15);
            outline: none;
          }
          .search-results {
            position: absolute;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            width: 90%;
            max-width: 400px;
            max-height: 200px;
            overflow-y: auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.15);
          }
          .search-result-item {
            padding: 10px 16px;
            border-bottom: 1px solid #E5E7EB;
            cursor: pointer;
          }
          .search-result-item:hover {
            background: #F3F4F6;
          }
          .search-result-item:last-child {
            border-bottom: none;
          }
          .result-label {
            font-weight: 500;
            color: #111827;
          }
          .result-address {
            font-size: 12px;
            color: #6B7280;
          }
          .clear-search {
            position: absolute;
            right: 12px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            color: #9CA3AF;
            font-size: 18px;
          }
          .coords-info {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            background: rgba(255,255,255,0.9);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            color: #374151;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        
        <div class="coords-info" id="coordsInfo">
          Click on map to select location
        </div>

        <script>
          // Initialize map
          var map = L.map('map', {
            zoomControl: true,
            attributionControl: true,
          }).setView([${lat}, ${lng}], ${zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors'
          }).addTo(map);

          // Add scale control
          L.control.scale().addTo(map);

          // Track markers
          var markers = [];

          // Add initial markers
          ${markerScripts}

          // Function to add a marker
          function addMarker(lat, lng, color, label) {
            // Remove existing marker at the same position (for single selection)
            if (window.currentMarker) {
              map.removeLayer(window.currentMarker);
            }
            
            var marker = L.circleMarker([lat, lng], {
              radius: 10,
              fillColor: color || '#3B82F6',
              color: "#FFFFFF",
              weight: 2,
              opacity: 1,
              fillOpacity: 1
            }).addTo(map);
            
            if (label) {
              marker.bindPopup(label).openPopup();
            }
            
            window.currentMarker = marker;
            return marker;
          }

          // Function to remove all markers
          function clearMarkers() {
            if (window.currentMarker) {
              map.removeLayer(window.currentMarker);
              window.currentMarker = null;
            }
          }

          // Handle map clicks
          map.on('click', function(e) {
            var lat = e.latlng.lat;
            var lng = e.latlng.lng;
            
            // Update coordinates info
            document.getElementById('coordsInfo').innerHTML = 
              '📍 Selected: ' + lat.toFixed(6) + ', ' + lng.toFixed(6);
            
            // Notify React Native
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'mapClick',
              latitude: lat,
              longitude: lng
            }));
          });

          // Search function
          function searchLocation(query) {
            if (!query || query.length < 2) {
              document.getElementById('searchResults').style.display = 'none';
              return;
            }
            
            fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(query) + '&limit=5')
              .then(response => response.json())
              .then(data => {
                var resultsContainer = document.getElementById('searchResults');
                resultsContainer.innerHTML = '';
                resultsContainer.style.display = 'block';
                
                if (data.length === 0) {
                  resultsContainer.innerHTML = '<div class="search-result-item">No results found</div>';
                  return;
                }
                
                data.forEach(function(item) {
                  var div = document.createElement('div');
                  div.className = 'search-result-item';
                  div.innerHTML = 
                    '<div class="result-label">' + item.display_name.split(',')[0] + '</div>' +
                    '<div class="result-address">' + item.display_name + '</div>';
                  div.onclick = function() {
                    var lat = parseFloat(item.lat);
                    var lng = parseFloat(item.lon);
                    map.setView([lat, lng], 16);
                    addMarker(lat, lng, '#3B82F6', item.display_name);
                    document.getElementById('searchInput').value = item.display_name;
                    document.getElementById('searchResults').style.display = 'none';
                    
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'searchResult',
                      latitude: lat,
                      longitude: lng,
                      display_name: item.display_name,
                      address: item.display_name
                    }));
                  };
                  resultsContainer.appendChild(div);
                });
              })
              .catch(error => {
                console.error('Search error:', error);
              });
          }

          // Setup search
          ${showSearch ? `
            var searchContainer = document.createElement('div');
            searchContainer.className = 'search-container';
            searchContainer.innerHTML = 
              '<input id="searchInput" type="text" placeholder="Search for a location..." />' +
              '<span class="clear-search" onclick="document.getElementById(\\'searchInput\\').value=\\'\\'; document.getElementById(\\'searchResults\\').style.display=\\'none\\';">✕</span>';
            document.body.appendChild(searchContainer);
            
            var resultsContainer = document.createElement('div');
            resultsContainer.id = 'searchResults';
            resultsContainer.className = 'search-results';
            resultsContainer.style.display = 'none';
            document.body.appendChild(resultsContainer);
            
            document.getElementById('searchInput').addEventListener('input', function(e) {
              searchLocation(e.target.value);
            });
          ` : ''}

          // Handle resize
          setTimeout(function() {
            map.invalidateSize();
          }, 500);

          // Notify that map is ready
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'mapReady'
          }));
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapClick' && onMapClick) {
        onMapClick(data.latitude, data.longitude);
      }
      if (data.type === 'mapReady' && onMapReady) {
        onMapReady();
      }
      if (data.type === 'searchResult' && onMapClick) {
        onMapClick(data.latitude, data.longitude);
      }
    } catch (error) {
      console.error('Error parsing map message:', error);
    }
  };

  return (
    <WebView
      ref={webViewRef}
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      onMessage={handleMessage}
      javaScriptEnabled={true}
      domStorageEnabled={true}
    />
  );
};

// Geocoding service to convert address to coordinates
const geocodeAddress = async (address: string): Promise<{lat: number, lng: number} | null> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Reverse geocoding to get address from coordinates
const reverseGeocode = async (lat: number, lng: number): Promise<string | null> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
    );
    const data = await response.json();
    if (data && data.display_name) {
      return data.display_name;
    }
    return null;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
};

export default function JobsScreen() {
  const [isOnline, setIsOnline] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  
  // Provider data
  const [providerId, setProviderId] = useState<number | null>(null);
  const [providerData, setProviderData] = useState<any>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [existingRoutes, setExistingRoutes] = useState<any[]>([]);
  
  // Route form data
  const [startLocation, setStartLocation] = useState<Location>({
    street_address: 'IT Park Cebu City',
    barangay: 'Apas',
    city: 'Cebu City',
    province: 'Cebu',
    zip_code: '6000',
    latitude: 10.3188,
    longitude: 123.9050
  });
  const [endLocation, setEndLocation] = useState<Location>({
    street_address: 'SM City Cebu',
    barangay: 'Cogon Ramos',
    city: 'Cebu City',
    province: 'Cebu',
    zip_code: '6000',
    latitude: 10.3396,
    longitude: 123.9109
  });
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [routeFrequency, setRouteFrequency] = useState('One-time');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showVehicleSelector, setShowVehicleSelector] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Location selection state
  const [selectingLocation, setSelectingLocation] = useState<'start' | 'end' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [mapMarkers, setMapMarkers] = useState<Array<{lat: number, lng: number, color?: string, label?: string}>>([]);
  const [selectedCoords, setSelectedCoords] = useState<{lat: number, lng: number} | null>(null);

  // Get provider ID and data
  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please login first');
        return null;
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, email')
        .eq('auth_id', user.id)
        .single();

      if (userError) throw userError;
      setProviderData(userData);

      const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select('role_id, roles!inner (role_name)')
        .eq('user_id', userData.user_id)
        .single();

      if (roleError || userRole?.roles?.role_name !== 'Provider') {
        Alert.alert('Access Denied', 'You need to be a provider to access this screen');
        return null;
      }

      setProviderId(userData.user_id);
      return userData.user_id;
    } catch (error) {
      console.error('Error getting provider data:', error);
      Alert.alert('Error', 'Failed to load provider data');
      return null;
    }
  };

  // Fetch vehicles
  const fetchVehicles = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('provider_id', providerId)
        .eq('verification_status', 'Verified');

      if (error) throw error;
      setVehicles(data || []);
      if (data && data.length > 0) {
        setSelectedVehicle(data[0]);
      }
      return data;
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      return [];
    }
  };

  // Fetch existing routes
  const fetchRoutes = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles(*)
        `)
        .eq('provider_id', providerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExistingRoutes(data || []);
      return data;
    } catch (error) {
      console.error('Error fetching routes:', error);
      return [];
    }
  };

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const pid = await getProviderData();
      if (pid) {
        await Promise.all([
          fetchVehicles(pid),
          fetchRoutes(pid)
        ]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Open location picker
  const openLocationPicker = (type: 'start' | 'end') => {
    setSelectingLocation(type);
    const location = type === 'start' ? startLocation : endLocation;
    setSelectedCoords({ lat: location.latitude, lng: location.longitude });
    setMapMarkers([{
      lat: location.latitude,
      lng: location.longitude,
      color: type === 'start' ? '#3B82F6' : '#EF4444',
      label: type === 'start' ? 'Starting Point' : 'Destination'
    }]);
    setShowLocationModal(true);
  };

  // Handle map click in location picker
  const handleMapClick = async (lat: number, lng: number) => {
    setSelectedCoords({ lat, lng });
    setMapMarkers([{
      lat,
      lng,
      color: selectingLocation === 'start' ? '#3B82F6' : '#EF4444',
      label: selectingLocation === 'start' ? 'Starting Point' : 'Destination'
    }]);

    // Get address from coordinates
    const address = await reverseGeocode(lat, lng);
    if (address && selectingLocation) {
      // Parse address components
      const addressParts = address.split(',');
      const streetAddress = addressParts[0]?.trim() || '';
      
      // Update location
      if (selectingLocation === 'start') {
        setStartLocation(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          street_address: streetAddress
        }));
      } else {
        setEndLocation(prev => ({
          ...prev,
          latitude: lat,
          longitude: lng,
          street_address: streetAddress
        }));
      }
    }
  };

  // Confirm location selection
  const confirmLocation = () => {
    if (selectedCoords) {
      handleMapClick(selectedCoords.lat, selectedCoords.lng);
    }
    setShowLocationModal(false);
    setSelectingLocation(null);
  };

  // Search and select location
  const handleSearchSelect = async (address: string) => {
    const coords = await geocodeAddress(address);
    if (coords && selectingLocation) {
      setSelectedCoords(coords);
      setMapMarkers([{
        lat: coords.lat,
        lng: coords.lng,
        color: selectingLocation === 'start' ? '#3B82F6' : '#EF4444',
        label: selectingLocation === 'start' ? 'Starting Point' : 'Destination'
      }]);
      
      // Update location
      if (selectingLocation === 'start') {
        setStartLocation(prev => ({
          ...prev,
          latitude: coords.lat,
          longitude: coords.lng,
          street_address: address.split(',')[0] || address
        }));
      } else {
        setEndLocation(prev => ({
          ...prev,
          latitude: coords.lat,
          longitude: coords.lng,
          street_address: address.split(',')[0] || address
        }));
      }
    }
  };

  // Create or get location
  const createLocation = async (location: Location): Promise<number | null> => {
    try {
      // Check if location exists
      const { data: existing, error: checkError } = await supabase
        .from('locations')
        .select('location_id')
        .eq('street_address', location.street_address)
        .eq('barangay', location.barangay)
        .eq('city', location.city)
        .eq('province', location.province)
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') throw checkError;

      if (existing) {
        return existing.location_id;
      }

      // Create new location
      const { data: newLocation, error: insertError } = await supabase
        .from('locations')
        .insert({
          street_address: location.street_address,
          barangay: location.barangay,
          city: location.city,
          province: location.province,
          zip_code: location.zip_code,
          latitude: location.latitude,
          longitude: location.longitude
        })
        .select('location_id')
        .single();

      if (insertError) throw insertError;
      return newLocation.location_id;
    } catch (error) {
      console.error('Error creating location:', error);
      return null;
    }
  };

  // Create route
  const createRoute = async () => {
    if (!providerId || !selectedVehicle) {
      Alert.alert('Error', 'Please select a vehicle');
      return;
    }

    if (!startLocation.street_address || !endLocation.street_address) {
      Alert.alert('Error', 'Please fill in all location details');
      return;
    }

    try {
      setSubmitting(true);

      const startLocId = await createLocation(startLocation);
      const endLocId = await createLocation(endLocation);

      if (!startLocId || !endLocId) {
        Alert.alert('Error', 'Failed to create locations');
        return;
      }

      const departureDateTime = new Date(departureDate);
      departureDateTime.setHours(departureTime.getHours());
      departureDateTime.setMinutes(departureTime.getMinutes());
      departureDateTime.setSeconds(0);

      const { data: route, error: routeError } = await supabase
        .from('provider_routes')
        .insert({
          departure_time: departureDateTime.toISOString(),
          route_frequency: routeFrequency,
          start_location_id: startLocId,
          end_location_id: endLocId,
          provider_id: providerId,
          vehicle_id: selectedVehicle.vehicle_id
        })
        .select('*')
        .single();

      if (routeError) throw routeError;

      Alert.alert(
        'Success',
        'Your route has been posted successfully!',
        [{ text: 'OK', onPress: () => {
          setModalVisible(false);
          loadData();
        }}]
      );

    } catch (error) {
      console.error('Error creating route:', error);
      Alert.alert('Error', 'Failed to post route. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle online status
  const toggleOnlineStatus = async (online: boolean) => {
    setIsOnline(online);
  };

  // Render route card
  const renderRouteCard = (route: any) => {
    const start = route.start_location;
    const end = route.end_location;
    const depTime = new Date(route.departure_time);
    
    return (
      <View key={route.route_id} style={styles.routeCard}>
        <View style={styles.routeHeader}>
          <Text style={styles.routeDate}>
            {depTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
          <Text style={styles.routeTime}>
            {depTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </Text>
          <View style={styles.routeFrequencyBadge}>
            <Text style={styles.routeFrequencyText}>{route.route_frequency}</Text>
          </View>
        </View>
        
        <View style={styles.routeLocations}>
          <View style={styles.routeLocationItem}>
            <View style={styles.routeDotStart} />
            <Text style={styles.routeLocationText}>{start.street_address}, {start.barangay}</Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routeLocationItem}>
            <View style={styles.routeDotEnd} />
            <Text style={styles.routeLocationText}>{end.street_address}, {end.barangay}</Text>
          </View>
        </View>
        
        <View style={styles.routeFooter}>
          <Text style={styles.routeVehicle}>
            <Ionicons name="car-sport" size={14} color="#6B7280" />
            {' '}{route.vehicle?.plate_number || 'N/A'}
          </Text>
          <TouchableOpacity 
            onPress={() => deleteRoute(route.route_id)}
            style={styles.deleteRouteBtn}
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Delete route
  const deleteRoute = async (routeId: number) => {
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
                .eq('route_id', routeId);

              if (error) throw error;
              setExistingRoutes(existingRoutes.filter(r => r.route_id !== routeId));
              Alert.alert('Success', 'Route deleted successfully');
            } catch (error) {
              console.error('Error deleting route:', error);
              Alert.alert('Error', 'Failed to delete route');
            }
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F27024" />
          <Text style={styles.loadingText}>Loading jobs...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Jobs</Text>
          <Image 
            source={require('../../../../assets/Car-Grey.png')}
            style={styles.carImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.mapContainer}>
          <InteractiveMap 
            lat={10.3188} 
            lng={123.9050} 
            zoom={13}
            markers={[
              { lat: startLocation.latitude, lng: startLocation.longitude, color: '#3B82F6', label: 'Start' },
              { lat: endLocation.latitude, lng: endLocation.longitude, color: '#EF4444', label: 'End' }
            ]}
          />
        </View>

        <ScrollView 
          style={styles.bottomOverlay}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.statusRow}>
            <View style={styles.vehicleInfo}>
              <Ionicons name="car-sport" size={36} color="#000" />
              <View style={styles.vehicleTextContainer}>
                <Text style={styles.vehicleName}>
                  {selectedVehicle ? `${selectedVehicle.vehicle_type} ${selectedVehicle.plate_number}` : 'No Vehicle'}
                </Text>
                <Text style={styles.vehiclePlate}>
                  {selectedVehicle ? `Max: ${selectedVehicle.max_weight_kg}kg` : 'Add a vehicle first'}
                </Text>
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <Text style={styles.toggleText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
              <Switch
                trackColor={{ false: '#D1D5DB', true: '#34C759' }}
                thumbColor={'#ffffff'}
                ios_backgroundColor="#D1D5DB"
                onValueChange={toggleOnlineStatus}
                value={isOnline}
                style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
              />
            </View>
          </View>

          {existingRoutes.length > 0 && (
            <View style={styles.routesSection}>
              <Text style={styles.routesTitle}>Your Active Routes</Text>
              {existingRoutes.slice(0, 3).map(renderRouteCard)}
              {existingRoutes.length > 3 && (
                <TouchableOpacity style={styles.viewMoreBtn}>
                  <Text style={styles.viewMoreText}>View all {existingRoutes.length} routes</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <TouchableOpacity 
            style={styles.travelCard} 
            activeOpacity={0.9}
            onPress={() => {
              if (vehicles.length === 0) {
                Alert.alert('No Vehicle', 'Please add a verified vehicle first');
                return;
              }
              setModalVisible(true);
            }}
          >
            <View style={styles.addIconContainer}>
              <Ionicons name="add" size={28} color="#000" />
            </View>
            <View style={styles.travelTextContainer}>
              <Text style={styles.travelTitle}>Travel & Earn</Text>
              <Text style={styles.travelDescription}>
                Register your One off trip route to pick up packages on your way and maximize your earnings.
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        {/* Post Route Modal */}
        <Modal
          animationType="slide"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity 
                  style={styles.modalBackButton}
                  onPress={() => setModalVisible(false)}
                >
                  <Ionicons name="arrow-back" size={28} color="#000" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Post Your Route</Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Location picker buttons */}
                <View style={styles.locationPickerRow}>
                  <TouchableOpacity 
                    style={[styles.locationPickerBtn, styles.startBtn]}
                    onPress={() => openLocationPicker('start')}
                  >
                    <Ionicons name="radio-button-on" size={18} color="#3B82F6" />
                    <View style={styles.locationPickerText}>
                      <Text style={styles.locationPickerLabel}>Starting Point</Text>
                      <Text style={styles.locationPickerValue} numberOfLines={1}>
                        {startLocation.street_address || 'Select location on map'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#6B7280" />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.locationPickerBtn, styles.endBtn]}
                    onPress={() => openLocationPicker('end')}
                  >
                    <Ionicons name="location" size={18} color="#EF4444" />
                    <View style={styles.locationPickerText}>
                      <Text style={styles.locationPickerLabel}>Destination</Text>
                      <Text style={styles.locationPickerValue} numberOfLines={1}>
                        {endLocation.street_address || 'Select location on map'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {/* Date & Time */}
                <View style={styles.dateTimeRow}>
                  <TouchableOpacity 
                    style={styles.dateTimePicker}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Text style={styles.pickerLabel}>Date</Text>
                    <Text style={styles.pickerValue}>
                      {departureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                    <Ionicons name="calendar-outline" size={20} color="#6B7280" />
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.dateTimePicker}
                    onPress={() => setShowTimePicker(true)}
                  >
                    <Text style={styles.pickerLabel}>Departure Time</Text>
                    <Text style={styles.pickerValue}>
                      {departureTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </Text>
                    <Ionicons name="time-outline" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {showDatePicker && (
                  <DateTimePicker
                    value={departureDate}
                    mode="date"
                    display="default"
                    onChange={(event, selectedDate) => {
                      setShowDatePicker(false);
                      if (selectedDate) setDepartureDate(selectedDate);
                    }}
                  />
                )}

                {showTimePicker && (
                  <DateTimePicker
                    value={departureTime}
                    mode="time"
                    display="default"
                    onChange={(event, selectedTime) => {
                      setShowTimePicker(false);
                      if (selectedTime) setDepartureTime(selectedTime);
                    }}
                  />
                )}

                {/* Route Frequency */}
                <View style={styles.formGroup}>
                  <Text style={styles.formLabel}>Route Frequency</Text>
                  <View style={styles.frequencyOptions}>
                    {['One-time', 'Daily', 'Weekly', 'Custom'].map((freq) => (
                      <TouchableOpacity
                        key={freq}
                        style={[
                          styles.frequencyOption,
                          routeFrequency === freq && styles.frequencyOptionSelected
                        ]}
                        onPress={() => setRouteFrequency(freq)}
                      >
                        <Text style={[
                          styles.frequencyText,
                          routeFrequency === freq && styles.frequencyTextSelected
                        ]}>
                          {freq}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Vehicle Selection */}
                <TouchableOpacity
                  style={styles.vehicleSelector}
                  onPress={() => setShowVehicleSelector(true)}
                >
                  <View style={styles.vehicleSelectorLeft}>
                    <Ionicons name="car-sport" size={24} color="#000" />
                    <View>
                      <Text style={styles.vehicleSelectorLabel}>Vehicle</Text>
                      <Text style={styles.vehicleSelectorValue}>
                        {selectedVehicle ? `${selectedVehicle.vehicle_type} - ${selectedVehicle.plate_number}` : 'Select a vehicle'}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="chevron-down" size={24} color="#6B7280" />
                </TouchableOpacity>

                <View style={styles.infoBanner}>
                  <Ionicons name="information-circle" size={20} color="#000" style={styles.infoIcon} />
                  <Text style={styles.infoText}>
                    By posting your route, our system will prioritize showing you jobs that are within a 2km radius of your path.
                  </Text>
                </View>

                <TouchableOpacity 
                  style={[styles.finishBtn, submitting && styles.disabledBtn]}
                  onPress={createRoute}
                  disabled={submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.finishBtnText}>Post Route</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Location Picker Modal */}
        <Modal
          visible={showLocationModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowLocationModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalContent, styles.locationModalContent]}>
              <View style={styles.modalHeader}>
                <TouchableOpacity 
                  style={styles.modalBackButton}
                  onPress={() => setShowLocationModal(false)}
                >
                  <Ionicons name="arrow-back" size={28} color="#000" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>
                  {selectingLocation === 'start' ? 'Select Starting Point' : 'Select Destination'}
                </Text>
                <TouchableOpacity 
                  style={styles.confirmLocationBtn}
                  onPress={confirmLocation}
                >
                  <Text style={styles.confirmLocationText}>Confirm</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.locationModalMap}>
                <InteractiveMap 
                  lat={selectedCoords?.lat || 10.3188}
                  lng={selectedCoords?.lng || 123.9050}
                  zoom={14}
                  markers={mapMarkers}
                  onMapClick={handleMapClick}
                  showSearch={true}
                />
              </View>

              <View style={styles.locationModalFooter}>
                <View style={styles.coordsDisplay}>
                  <Text style={styles.coordsLabel}>Selected Location</Text>
                  <Text style={styles.coordsValue}>
                    {selectedCoords ? `${selectedCoords.lat.toFixed(6)}, ${selectedCoords.lng.toFixed(6)}` : 'Click on the map to select'}
                  </Text>
                </View>
                <View style={styles.locationModalActions}>
                  <TouchableOpacity 
                    style={[styles.locationModalBtn, styles.cancelLocationBtn]}
                    onPress={() => setShowLocationModal(false)}
                  >
                    <Text style={styles.cancelLocationText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.locationModalBtn, styles.confirmLocationBtnFull]}
                    onPress={confirmLocation}
                  >
                    <Text style={styles.confirmLocationTextFull}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* Vehicle Selector Modal */}
        <Modal
          visible={showVehicleSelector}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowVehicleSelector(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.vehicleSelectorModal}>
              <Text style={styles.vehicleSelectorModalTitle}>Select Vehicle</Text>
              {vehicles.map((vehicle) => (
                <TouchableOpacity
                  key={vehicle.vehicle_id}
                  style={[
                    styles.vehicleOption,
                    selectedVehicle?.vehicle_id === vehicle.vehicle_id && styles.vehicleOptionSelected
                  ]}
                  onPress={() => {
                    setSelectedVehicle(vehicle);
                    setShowVehicleSelector(false);
                  }}
                >
                  <Ionicons name="car-sport" size={24} color={selectedVehicle?.vehicle_id === vehicle.vehicle_id ? '#F27024' : '#6B7280'} />
                  <View style={styles.vehicleOptionDetails}>
                    <Text style={styles.vehicleOptionName}>{vehicle.vehicle_type}</Text>
                    <Text style={styles.vehicleOptionPlate}>{vehicle.plate_number}</Text>
                  </View>
                  {selectedVehicle?.vehicle_id === vehicle.vehicle_id && (
                    <Ionicons name="checkmark-circle" size={24} color="#34C759" />
                  )}
                </TouchableOpacity>
              ))}
              {vehicles.length === 0 && (
                <Text style={styles.noVehiclesText}>No verified vehicles found. Please add a vehicle first.</Text>
              )}
              <TouchableOpacity
                style={styles.closeVehicleModal}
                onPress={() => setShowVehicleSelector(false)}
              >
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
  safeArea: {
    flex: 1,
    backgroundColor: '#F27024',
  },
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  header: {
    backgroundColor: '#F27024',
    height: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 30 : 0,
    overflow: 'hidden',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 1,
  },
  carImage: {
    position: 'absolute',
    right: -15,
    bottom: -15,
    width: 250,
    height: 130,
    zIndex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '60%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleTextContainer: {
    marginLeft: 12,
  },
  vehicleName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  vehiclePlate: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginRight: 8,
  },
  routesSection: {
    marginBottom: 16,
  },
  routesTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
  },
  routeCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  routeDate: {
    fontSize: 12,
    color: '#6B7280',
    marginRight: 8,
  },
  routeTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    marginRight: 8,
  },
  routeFrequencyBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  routeFrequencyText: {
    fontSize: 10,
    color: '#6B7280',
  },
  routeLocations: {
    marginVertical: 4,
  },
  routeLocationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  routeDotStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
    marginRight: 8,
  },
  routeDotEnd: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  routeLine: {
    width: 2,
    height: 12,
    backgroundColor: '#D1D5DB',
    marginLeft: 3,
    marginVertical: 2,
  },
  routeLocationText: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  routeFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  routeVehicle: {
    fontSize: 12,
    color: '#6B7280',
  },
  deleteRouteBtn: {
    padding: 4,
  },
  viewMoreBtn: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  viewMoreText: {
    color: '#F27024',
    fontSize: 13,
    fontWeight: '500',
  },
  travelCard: {
    backgroundColor: '#222222',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  addIconContainer: {
    width: 50,
    height: 50,
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  travelTextContainer: {
    flex: 1,
  },
  travelTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  travelDescription: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  locationModalContent: {
    maxHeight: '100%',
    height: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalBackButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    flex: 1,
    marginLeft: 8,
  },
  confirmLocationBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F27024',
    borderRadius: 20,
  },
  confirmLocationText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  locationModalMap: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#E5E7EB',
  },
  locationModalFooter: {
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  coordsDisplay: {
    marginBottom: 12,
  },
  coordsLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  coordsValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  locationModalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  locationModalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelLocationBtn: {
    backgroundColor: '#F3F4F6',
  },
  cancelLocationText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '500',
  },
  confirmLocationBtnFull: {
    backgroundColor: '#F27024',
  },
  confirmLocationTextFull: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
  },
  locationPickerRow: {
    gap: 12,
    marginBottom: 16,
  },
  locationPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  startBtn: {
    borderColor: '#3B82F6',
  },
  endBtn: {
    borderColor: '#EF4444',
  },
  locationPickerText: {
    flex: 1,
    marginLeft: 12,
  },
  locationPickerLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  locationPickerValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    marginTop: 2,
  },
  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  dateTimePicker: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  pickerLabel: {
    fontSize: 12,
    color: '#6B7280',
    width: '100%',
    marginBottom: 4,
  },
  pickerValue: {
    fontSize: 14,
    color: '#111827',
    flex: 1,
  },
  frequencyOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  frequencyOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  frequencyOptionSelected: {
    backgroundColor: '#F27024',
    borderColor: '#F27024',
  },
  frequencyText: {
    fontSize: 13,
    color: '#6B7280',
  },
  frequencyTextSelected: {
    color: '#FFFFFF',
  },
  vehicleSelector: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  vehicleSelectorLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  vehicleSelectorLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  vehicleSelectorValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  infoBanner: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    marginBottom: 20,
  },
  infoIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
  },
  finishBtn: {
    backgroundColor: '#F27024',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
  },
  disabledBtn: {
    opacity: 0.6,
  },
  finishBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  vehicleSelectorModal: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  vehicleSelectorModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
  },
  vehicleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  vehicleOptionSelected: {
    backgroundColor: '#FEF3E8',
    borderRadius: 8,
  },
  vehicleOptionDetails: {
    flex: 1,
  },
  vehicleOptionName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  vehicleOptionPlate: {
    fontSize: 12,
    color: '#6B7280',
  },
  noVehiclesText: {
    textAlign: 'center',
    color: '#6B7280',
    paddingVertical: 20,
  },
  closeVehicleModal: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  closeVehicleModalText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '500',
  },
});