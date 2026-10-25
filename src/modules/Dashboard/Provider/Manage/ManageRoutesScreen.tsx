// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, StatusBar,
  Alert, ActivityIndicator, ScrollView, Platform, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { supabase } from '../../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

// IMPORT THE MAP ID
import { GOOGLE_MAP_ID } from '../../../../utils/mapConfig';

const ORANGE = '#FA7A25';

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
interface Vehicle { vehicle_id: number; vehicle_type: string; plate_number: string; }
interface Route {
  route_id: number;
  departure_time: string;
  route_frequency: string;
  created_at: string;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location?: LocationType;
  end_location?: LocationType;
  vehicle?: Vehicle;
}

/* ==================================================================== */
/* Timezone helpers                                                      */
/* ==================================================================== */
const toNaiveIsoString = (dateObj: Date, timeObj: Date) => {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  const hh = String(timeObj.getHours()).padStart(2, '0');
  const mm = String(timeObj.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
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

const nextWeekday = (weekday: number, from = new Date()): Date => {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ==================================================================== */
/* Reverse Geocode Helper                                                */
/* ==================================================================== */
const reverseGeocodeCoordinates = async (lat: number, lng: number) => {
  let result = {
    street_address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    barangay: 'Unknown',
    city: 'Unknown',
    province: 'Unknown',
    zip_code: '0000',
  };

  try {
    const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (addr) {
      const streetParts = [addr.name, addr.street].filter(Boolean);
      result.street_address = streetParts.length > 0
        ? Array.from(new Set(streetParts)).join(', ')
        : `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      
      result.barangay = addr.district || addr.subregion || addr.name || 'Unknown';
      result.city = addr.city || addr.subregion || 'Unknown';
      result.province = addr.region || 'Unknown';
      result.zip_code = addr.postalCode || '0000';

      if (result.barangay === 'Unknown' || result.city === 'Unknown') {
        throw new Error('Fallback to Nominatim');
      }
      return result;
    }
  } catch (err) { }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'PackNShipMobileApp/1.0 (capstone.ctu@gmail.com)',
          'Accept': 'application/json',
        },
      }
    );
    const json = await response.json();
    if (json && json.address) {
      const a = json.address;
      const streetParts = [a.house_number, a.road].filter(Boolean);
      result.street_address = streetParts.length > 0 
        ? streetParts.join(' ') 
        : (json.display_name ? json.display_name.split(',')[0] : result.street_address);
      
      result.barangay = a.suburb || a.neighbourhood || a.village || a.quarter || 'Unknown';
      result.city = a.city || a.town || a.municipality || 'Unknown';
      result.province = a.state || a.province || 'Unknown';
      result.zip_code = a.postcode || '0000';
    }
  } catch (err) {
    console.warn('Nominatim reverse geocode failed:', err);
  }

  return result;
};

/* ==================================================================== */
/* InteractiveMap — Native Google Maps                                  */
/* ==================================================================== */
const InteractiveMap = ({
  onLocationSelect,
  startLat, startLng, endLat, endLng,
  startName = 'Starting Point', endName = 'Destination',
  mode = 'view',
}: any) => {
  const mapRef = useRef<MapView>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  
  const centerLat = startLat || endLat || 10.3157;
  const centerLng = startLng || endLng || 123.8854;

  useEffect(() => {
    if (!startLat || !startLng || !endLat || !endLng) { setCoords([]); return; }
    let cancelled = false;
    (async () => {
      const line = await fetchRoadCoords(
        { lat: startLat, lng: startLng },
        { lat: endLat, lng: endLng },
      );
      if (cancelled) return;
      setCoords(line);
      const t = setTimeout(() => {
        mapRef.current?.fitToCoordinates(line, {
          edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
          animated: false,
        });
      }, 150);
      return () => clearTimeout(t);
    })();
    return () => { cancelled = true; };
  }, [startLat, startLng, endLat, endLng]);

  const fetchRoadCoords = async (
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ): Promise<{ latitude: number; longitude: number }[]> => {
    const fallback = [
      { latitude: a.lat, longitude: a.lng },
      { latitude: b.lat, longitude: b.lng },
    ];
    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data?.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
        return data.routes[0].geometry.coordinates.map((c: number[]) => ({
          latitude: c[1],
          longitude: c[0],
        }));
      }
    } catch { }
    return fallback;
  };

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      googleMapId={GOOGLE_MAP_ID}
      userInterfaceStyle="light"
      initialRegion={{
        latitude: centerLat,
        longitude: centerLng,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      scrollEnabled={true}
      zoomEnabled={true}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      onPress={(e) => {
        if (mode !== 'view' && onLocationSelect) {
          onLocationSelect(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
        }
      }}
    >
      {startLat && startLng && (
        <Marker
          coordinate={{ latitude: startLat, longitude: startLng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={startName}
          description="Starting Point"
        >
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#3B82F6', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFF' }}>S</Text>
          </View>
        </Marker>
      )}

      {endLat && endLng && (
        <Marker
          coordinate={{ latitude: endLat, longitude: endLng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={endName}
          description="Destination"
        >
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFF' }}>E</Text>
          </View>
        </Marker>
      )}

      {coords.length > 1 && (
        <Polyline coordinates={coords} strokeColor={ORANGE} strokeWidth={5} />
      )}
    </MapView>
  );
};

const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'] as const;
type Frequency = typeof FREQUENCIES[number];

export default function ManageRoutesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<Frequency>('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedWeekday, setSelectedWeekday] = useState<number>(new Date().getDay());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [startLocation, setStartLocation] = useState<LocationType | null>(null);
  const [endLocation, setEndLocation] = useState<LocationType | null>(null);
  const [mapMode, setMapMode] = useState<'view' | 'select_start' | 'select_end'>('view');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const modalAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([animate(headerAnim, 0), animate(listAnim, 180)]).start();
  }, [headerAnim, listAnim]);

  useEffect(() => {
    if (modalVisible) {
      modalAnim.setValue(0);
      Animated.timing(modalAnim, {
        toValue: 1, duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [modalVisible, modalAnim]);

  const fetchUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
    return data?.user_id || null;
  };

  const fetchVehicles = async (providerId: number) => {
    const { data } = await supabase
      .from('vehicles')
      .select('vehicle_id, vehicle_type, plate_number')
      .eq('provider_id', providerId)
      .eq('verification_status', 'Verified');
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

  const handleLocationSelect = async (lat: number, lng: number) => {
    try {
      const { data: existing } = await supabase
        .from('locations')
        .select('*')
        .eq('latitude', lat)
        .eq('longitude', lng)
        .limit(1);
      
      let location = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const geoData = await reverseGeocodeCoordinates(lat, lng);

        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: geoData.street_address,
          barangay: geoData.barangay,
          city: geoData.city,
          province: geoData.province,
          zip_code: geoData.zip_code,
          latitude: lat,
          longitude: lng,
        }).select('*').single();
        
        if (error) throw error;
        location = newLoc;
      }

      if (mapMode === 'select_start') {
        setStartLocation(location);
        setMapMode('view');
        setIsMapFullscreen(false);
      } else if (mapMode === 'select_end') {
        setEndLocation(location);
        setMapMode('view');
        setIsMapFullscreen(false);
      }
    } catch (err) {
      console.error('handleLocationSelect error:', err);
      Alert.alert('Error', 'Failed to save location.');
    }
  };

  const computeEffectiveDate = (): Date => {
    if (selectedFrequency === 'Daily') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (selectedFrequency === 'Weekly') {
      return nextWeekday(selectedWeekday);
    }
    return departureDate;
  };

  const handleSubmit = async () => {
    if (!startLocation || !endLocation || !selectedVehicleId || !userId) {
      return Alert.alert('Required', 'Please fill all fields');
    }

    const effectiveDate = computeEffectiveDate();
    const combined = new Date(
      effectiveDate.getFullYear(),
      effectiveDate.getMonth(),
      effectiveDate.getDate(),
      departureTime.getHours(),
      departureTime.getMinutes(),
    );

    if (selectedFrequency === 'One-time' || selectedFrequency === 'Custom') {
      if (combined < new Date()) {
        return Alert.alert('Invalid Time', 'You cannot schedule a route in the past. Please select a valid future date and time.');
      }
    }

    setSubmitting(true);
    try {
      const departureValue = toNaiveIsoString(effectiveDate, departureTime);
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
        const { error: updateError } = await supabase
          .from('provider_routes').update(routeData).eq('route_id', editingRoute.route_id);
        error = updateError;
      } else {
        const { error: insertError } = await supabase.from('provider_routes').insert(routeData);
        error = insertError;
      }

      if (error) throw error;

      Alert.alert('Success', editingRoute ? 'Route updated successfully!' : 'Route added successfully!');
      resetForm();
      setModalVisible(false);
      fetchRoutes();
    } catch (err) {
      console.error(err);
      Alert.alert('Error', editingRoute ? 'Failed to update route' : 'Failed to save route');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (route: Route) => {
    Alert.alert('Delete Route', 'Are you sure you want to delete this route?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', route.route_id);
          setRoutes(prev => prev.filter(r => r.route_id !== route.route_id));
        },
      },
    ]);
  };

  const handleEdit = (route: Route) => {
    setEditingRoute(route);
    const dt = parseNaiveIsoString(route.departure_time);
    setDepartureDate(dt);
    setDepartureTime(dt);
    setSelectedWeekday(dt.getDay());
    const freq = (route.route_frequency || 'Daily') as Frequency;
    setSelectedFrequency(FREQUENCIES.includes(freq) ? freq : 'Daily');
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
    setSelectedWeekday(new Date().getDay());
    setSelectedVehicleId(null);
    setStartLocation(null);
    setEndLocation(null);
    setMapMode('view');
    setEditingRoute(null);
    setIsMapFullscreen(false);
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const modalScale = modalAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  const renderRouteCard = ({ item }: { item: Route }) => {
    const dt = parseNaiveIsoString(item.departure_time);

    const freqColor =
      item.route_frequency === 'Daily' ? { bg: isDark ? '#0F2744' : '#DBEAFE', fg: isDark ? '#93C5FD' : '#2563EB' } :
      item.route_frequency === 'Weekly' ? { bg: isDark ? '#231542' : '#EDE9FE', fg: isDark ? '#C4B5FD' : '#7C3AED' } :
      item.route_frequency === 'One-time' ? { bg: isDark ? '#2A1F0A' : '#FEF3C7', fg: isDark ? '#FCD34D' : '#D97706' } :
      { bg: colors.divider, fg: colors.textSecondary };

    const freqLabel = (() => {
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (item.route_frequency === 'Daily') return `Every day · ${timeStr}`;
      if (item.route_frequency === 'Weekly') return `Every ${WEEKDAY_LABELS[dt.getDay()]} · ${timeStr}`;
      return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${timeStr}`;
    })();

    return (
      <View style={styles.routeCard}>
        <View style={[styles.cardAccent, { backgroundColor: freqColor.fg }]} />
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.routeIconBox}>
              <Ionicons name="map-outline" size={20} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeDate}>{freqLabel}</Text>
              <Text style={styles.routeTime}>{item.route_frequency}</Text>
            </View>
          </View>
          <View style={[styles.frequencyBadge, { backgroundColor: freqColor.bg }]}>
            <Text style={[styles.frequencyText, { color: freqColor.fg }]}>{item.route_frequency}</Text>
          </View>
        </View>

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
              <Ionicons name="location" size={16} color={colors.error} />
            </View>
            <View style={styles.timelineText}>
              <Text style={[styles.timelineLabel, { color: colors.error }]}>DROPOFF</Text>
              <Text style={styles.timelineAddress} numberOfLines={2}>
                {item.end_location?.street_address || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {item.vehicle && (
          <View style={styles.vehicleRow}>
            <Ionicons name="car-sport-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.vehicleText} numberOfLines={1}>
              {item.vehicle.vehicle_type} · {item.vehicle.plate_number}
            </Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(item)}>
            <Ionicons name="create-outline" size={14} color={ORANGE} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
            <Ionicons name="trash-outline" size={14} color={colors.error} />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Routes</Text>
        <TouchableOpacity style={styles.headerAddBtn} onPress={handleAdd} activeOpacity={0.85}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

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
          <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd}>
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

      {isMapFullscreen && (
        <Modal animationType="fade" transparent={false} visible={isMapFullscreen} onRequestClose={() => setIsMapFullscreen(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <InteractiveMap
              onLocationSelect={handleLocationSelect}
              startLat={startLocation?.latitude}
              startLng={startLocation?.longitude}
              endLat={endLocation?.latitude}
              endLng={endLocation?.longitude}
              mode={mapMode}
            />
            <View style={[styles.fullscreenMapHeader, { paddingTop: insets.top }]}>
              <TouchableOpacity style={styles.fullscreenCloseBtn} onPress={() => setIsMapFullscreen(false)}>
                <Ionicons name="close" size={28} color="#000" />
              </TouchableOpacity>
              <View style={styles.fullscreenInstructionBox}>
                <Text style={styles.fullscreenInstructionText}>
                  {mapMode === 'select_start' ? 'Tap map to set Starting Point' : mapMode === 'select_end' ? 'Tap map to set Destination' : 'Map View'}
                </Text>
              </View>
            </View>
          </View>
        </Modal>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => { resetForm(); setModalVisible(false); }}
      >
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContainer, { transform: [{ scale: modalScale }], opacity: modalAnim }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { resetForm(); setModalVisible(false); }} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editingRoute ? 'Edit Route' : 'Add Route'}</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
              <TouchableOpacity style={styles.modalMapContainer} onPress={() => setIsMapFullscreen(true)} activeOpacity={0.9}>
                <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                  <InteractiveMap
                    onLocationSelect={handleLocationSelect}
                    startLat={startLocation?.latitude}
                    startLng={startLocation?.longitude}
                    endLat={endLocation?.latitude}
                    endLng={endLocation?.longitude}
                    mode={mapMode}
                  />
                </View>
                <View style={styles.mapExpandOverlay}>
                  <Ionicons name="expand" size={20} color="#FFF" />
                  <Text style={styles.mapExpandText}>Tap to Expand Map</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.locationSelectorsRow}>
                <TouchableOpacity
                  style={[styles.locationSelectorBtn, startLocation && styles.locationSelected]}
                  onPress={() => { setMapMode('select_start'); setIsMapFullscreen(true); }}
                >
                  <View style={[styles.locSelectorIcon, startLocation && { backgroundColor: '#3B82F6' }]}>
                    <Ionicons name="radio-button-on" size={14} color={startLocation ? '#FFFFFF' : colors.textSecondary} />
                  </View>
                  <Text style={[styles.locationSelectorText, startLocation && styles.locationSelectorTextSelected]}>
                    {startLocation ? 'Start Set' : 'Set Start'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locationSelectorBtn, endLocation && styles.locationSelected]}
                  onPress={() => { setMapMode('select_end'); setIsMapFullscreen(true); }}
                >
                  <View style={[styles.locSelectorIcon, endLocation && { backgroundColor: colors.error }]}>
                    <Ionicons name="location" size={14} color={endLocation ? '#FFFFFF' : colors.textSecondary} />
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
                    {startLocation?.street_address || 'Tap "Set Start" to pick on map'}
                  </Text>
                </View>
                <View style={styles.pickedRow}>
                  <View style={[styles.pickedDot, { backgroundColor: colors.error }]} />
                  <Text style={styles.pickedLocationText} numberOfLines={1}>
                    <Text style={{ fontWeight: '700' }}>End: </Text>
                    {endLocation?.street_address || 'Tap "Set End" to pick on map'}
                  </Text>
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Frequency</Text>
                <View style={styles.frequencyOptions}>
                  {FREQUENCIES.map((freq) => (
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

              {selectedFrequency === 'Daily' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Departure Time</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
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
                        if (e.type === 'set' && t) setDepartureTime(t);
                      }}
                    />
                  )}
                  <Text style={styles.helperText}>This route will recur every day at the selected time.</Text>
                </View>
              ) : selectedFrequency === 'Weekly' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Repeats on</Text>
                  <View style={styles.weekdayRow}>
                    {WEEKDAY_LABELS.map((label, idx) => {
                      const on = selectedWeekday === idx;
                      return (
                        <TouchableOpacity
                          key={label}
                          style={[styles.weekdayChip, on && styles.weekdayChipActive]}
                          onPress={() => setSelectedWeekday(idx)}
                          activeOpacity={0.85}
                        >
                          <Text style={[styles.weekdayChipText, on && styles.weekdayChipTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <Text style={[styles.inputLabel, { marginTop: 14 }]}>Departure Time</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
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
                        if (e.type === 'set' && t) setDepartureTime(t);
                      }}
                    />
                  )}
                  <Text style={styles.helperText}>
                    This route will recur every {WEEKDAY_LABELS[selectedWeekday]} at the selected time.
                  </Text>
                </View>
              ) : (
                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Date</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showDatePicker && setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="date"
                        display="default"
                        minimumDate={new Date()}
                        onChange={(e, d) => {
                          if (Platform.OS === 'android') setShowDatePicker(false);
                          if (e.type === 'set' && d) setDepartureDate(d);
                        }}
                      />
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => !showTimePicker && setShowTimePicker(true)}>
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
                          if (e.type === 'set' && t) setDepartureTime(t);
                        }}
                      />
                    )}
                  </View>
                </View>
              )}

              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                {vehicles.length === 0 ? (
                  <View style={styles.noVehiclesBox}>
                    <Ionicons name="car-outline" size={20} color={colors.textMuted} />
                    <Text style={styles.noVehiclesText}>No verified vehicles found</Text>
                  </View>
                ) : (
                  <View style={styles.vehicleOptions}>
                    {vehicles.map((v) => (
                      <TouchableOpacity
                        key={v.vehicle_id}
                        style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                        onPress={() => setSelectedVehicleId(v.vehicle_id)}
                      >
                        <Ionicons name="car-sport" size={14} color={selectedVehicleId === v.vehicle_id ? '#FFFFFF' : colors.textSecondary} />
                        <Text style={[styles.vehicleOptionText, selectedVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                          {v.plate_number}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity style={[styles.submitBtn, submitting && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>{editingRoute ? 'Update Route' : 'Save Route'}</Text>
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

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  headerAddBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },

  listContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: c.textSecondary, fontSize: 13, fontWeight: '500' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, marginTop: 4 },
  emptySubtitle: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 8, marginBottom: 24, lineHeight: 18 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ORANGE,
    paddingHorizontal: 22, paddingVertical: 13, borderRadius: 24,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  emptyAddBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },

  routeCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 16, paddingLeft: 20, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.3, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden', position: 'relative',
  },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  routeIconBox: { width: 46, height: 46, borderRadius: 14, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  routeDate: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  routeTime: { fontSize: 16, color: c.textPrimary, fontWeight: '800', marginTop: 2, letterSpacing: -0.2 },
  frequencyBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  frequencyText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  timeline: { marginBottom: 12 },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  timelineIconWrapper: { width: 22, alignItems: 'center', marginRight: 10, zIndex: 2 },
  blueDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#3B82F6', justifyContent: 'center', alignItems: 'center' },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#3B82F6' },
  timelineLine: { width: 1, height: 22, backgroundColor: c.border, marginVertical: 2 },
  timelineText: { flex: 1, paddingTop: 1 },
  timelineLabel: { fontSize: 9, fontWeight: '800', color: '#3B82F6', letterSpacing: 1, marginBottom: 3 },
  timelineAddress: { fontSize: 13, fontWeight: '600', color: c.textPrimary, lineHeight: 16 },

  vehicleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.background, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12,
    borderWidth: 1, borderColor: c.divider,
  },
  vehicleText: { fontSize: 11, fontWeight: '600', color: c.textSecondary, flex: 1 },

  cardFooter: { flexDirection: 'row', gap: 10 },
  editBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accentSoft, paddingVertical: 10, borderRadius: 12, gap: 6,
    borderWidth: 1, borderColor: ORANGE,
  },
  editBtnText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.errorBg, paddingVertical: 10, borderRadius: 12, gap: 6,
    borderWidth: 1, borderColor: c.error,
  },
  deleteBtnText: { color: c.error, fontSize: 13, fontWeight: '700' },

  fullscreenMapHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', paddingHorizontal: 20, paddingTop: 20, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  fullscreenCloseBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  fullscreenInstructionBox: {
    flex: 1, marginLeft: 16, backgroundColor: '#FFF',
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  fullscreenInstructionText: { fontWeight: '700', color: '#111827', textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: {
    backgroundColor: c.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 8, maxHeight: '94%', flex: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.5,
    shadowRadius: 20, elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  modalCloseBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center',
  },
  modalTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  modalScrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },

  modalMapContainer: {
    height: 180, borderRadius: 16, overflow: 'hidden', marginBottom: 16,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
  },
  mapExpandOverlay: {
    position: 'absolute', backgroundColor: 'rgba(17,24,39,0.7)',
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  mapExpandText: { color: '#FFF', fontWeight: '700', fontSize: 12 },

  locationSelectorsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  locationSelectorBtn: {
    flex: 1, backgroundColor: c.background,
    paddingVertical: 12, paddingHorizontal: 12, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, borderWidth: 1.5, borderColor: c.border,
  },
  locationSelected: { backgroundColor: isDark ? '#0F2744' : '#F0F9FF', borderColor: '#3B82F6' },
  locSelectorIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center',
  },
  locationSelectorText: { fontWeight: '700', color: c.textSecondary, fontSize: 13 },
  locationSelectorTextSelected: { color: c.textPrimary },

  pickedLocationsDisplay: {
    marginBottom: 20, padding: 14,
    backgroundColor: c.background, borderRadius: 14, gap: 8,
    borderWidth: 1, borderColor: c.divider,
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickedDot: { width: 8, height: 8, borderRadius: 4 },
  pickedLocationText: { flex: 1, fontSize: 12, color: c.textSecondary, fontWeight: '500' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  inputLabel: { marginBottom: 8, fontWeight: '700', color: c.textPrimary, fontSize: 12, letterSpacing: 0.2 },
  dateTimeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  dateTimeValue: { fontSize: 13, color: c.textPrimary, fontWeight: '600' },
  helperText: { marginTop: 8, fontSize: 11, color: c.textMuted, fontWeight: '500', fontStyle: 'italic' },

  formGroup: { marginBottom: 20 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22,
    borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card,
  },
  frequencyOptionSelected: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  frequencyOptionTextSelected: { color: '#FFFFFF' },

  weekdayRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  weekdayChip: {
    flex: 1, minWidth: 44, paddingVertical: 10, borderRadius: 12,
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  weekdayChipActive: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  weekdayChipTextActive: { color: '#FFFFFF' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 22, borderWidth: 1.5, borderColor: c.border,
  },
  vehicleOptionActive: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 3,
  },
  vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFFFFF' },
  noVehiclesBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.background, padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: c.border, borderStyle: 'dashed',
  },
  noVehiclesText: { fontSize: 13, color: c.textMuted, fontWeight: '600' },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16,
    marginTop: 8, gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  submitBtnDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  submitBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
});