// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, StatusBar,
  Alert, ActivityIndicator, ScrollView, Platform, Animated, Easing,
  TextInput, Keyboard, Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../../../utils/mapConfig';

const ORANGE = '#FA7A25';
const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 5;
const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;

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
type Coord = { latitude: number; longitude: number };

/* ==================================================================== */
/* Helpers                                                              */
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
const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'] as const;
type Frequency = typeof FREQUENCIES[number];

const metersBetween = (a: Coord, b: Coord) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const reverseGeocodeCoordinates = async (lat: number, lng: number) => {
  let result = {
    street_address: `Location at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000',
  };
  try {
    const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (addr) {
      const streetParts = [addr.name, addr.street].filter(Boolean);
      result.street_address = streetParts.length > 0 ? Array.from(new Set(streetParts)).join(', ') : result.street_address;
      result.barangay = addr.district || addr.subregion || addr.name || 'Unknown';
      result.city = addr.city || addr.subregion || 'Unknown';
      result.province = addr.region || 'Unknown';
      result.zip_code = addr.postalCode || '0000';
      if (result.barangay !== 'Unknown' && result.city !== 'Unknown') return result;
    }
  } catch (err) { }

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
      headers: { 'User-Agent': 'PackNShipMobileApp/1.0', 'Accept': 'application/json' },
    });
    const json = await response.json();
    if (json && json.address) {
      const a = json.address;
      const streetParts = [a.house_number, a.road].filter(Boolean);
      result.street_address = streetParts.length > 0 ? streetParts.join(' ') : (json.display_name ? json.display_name.split(',')[0] : result.street_address);
      result.barangay = a.suburb || a.neighbourhood || a.village || a.quarter || 'Unknown';
      result.city = a.city || a.town || a.municipality || 'Unknown';
      result.province = a.state || a.province || 'Unknown';
      result.zip_code = a.postcode || '0000';
    }
  } catch (err) { }
  return result;
};

/* ==================================================================== */
/* Location Picker Modal (Drag-to-select)                               */
/* ==================================================================== */
const LocationPickerModal = ({ 
  visible, onClose, onSelect, initialCoords, title, pinColor 
}: { 
  visible: boolean, onClose: () => void, onSelect: (loc: any) => void, initialCoords?: Coord | null, title: string, pinColor: string 
}) => {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResolved = useRef<Coord | null>(null);

  const [markerCoord, setMarkerCoord] = useState<Coord>(initialCoords || { latitude: 10.3157, longitude: 123.8854 });
  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [structuredAddress, setStructuredAddress] = useState({ street_address: '', barangay: '', city: '', province: '', zip_code: '' });

  // Search State
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recents, setRecents] = useState<any[]>([]);

  const pinBounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (initialCoords) {
        setMarkerCoord(initialCoords);
        resolveAt(initialCoords);
        mapRef.current?.animateToRegion({ ...initialCoords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 0);
      } else {
        handleLocateMe();
      }
      loadRecents();
    }
  }, [visible, initialCoords]);

  useEffect(() => {
    Animated.spring(pinBounce, { toValue: isDragging ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true }).start();
  }, [isDragging, pinBounce]);

  const loadRecents = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) setRecents(JSON.parse(raw) || []);
    } catch { }
  };

  const saveRecent = async (entry: any) => {
    try {
      const next = [entry, ...recents.filter(r => metersBetween(r, entry) > 100)].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { }
  };

  const resolveAt = async (coords: Coord, label?: { name: string, sub: string }) => {
    lastResolved.current = coords;
    setBusy(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub); }

    const geo = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
    const name = label?.name || geo.street_address;
    const sub = label?.sub || `${geo.barangay}, ${geo.city}`;

    setAddressName(name);
    setAddressSub(sub);
    setStructuredAddress(geo);
    setBusy(false);
  };

  const moveTo = (coords: Coord, label?: { name: string, sub: string }) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  };

  const handleLocateMe = async () => {
    try {
      setBusy(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Location off', 'Enable location to find yourself.');
      const loc = await Location.getCurrentPositionAsync({});
      moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch {
      Alert.alert('Error', 'Could not fetch location.');
    }
  };

  const onRegionChangeComplete = (region: Region) => {
    setIsDragging(false);
    const center = { latitude: region.latitude, longitude: region.longitude };
    if (lastResolved.current && metersBetween(lastResolved.current, center) < SAME_SPOT_METERS) return;
    setMarkerCoord(center);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => resolveAt(center), 500);
  };

  const confirm = () => {
    onSelect({
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      street_address: addressName,
      ...structuredAddress
    });
    saveRecent({ name: addressName, address: addressSub, latitude: markerCoord.latitude, longitude: markerCoord.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        
        {/* Map Area */}
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            googleMapId={GOOGLE_MAP_ID}
            style={StyleSheet.absoluteFill}
            initialRegion={{ ...markerCoord, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }}
            onPanDrag={() => setIsDragging(true)}
            onRegionChangeComplete={onRegionChangeComplete}
            showsUserLocation
            showsCompass={false}
            toolbarEnabled={false}
          />

          {/* Center Pin */}
          <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, alignItems: 'center', marginTop: -60 }} pointerEvents="box-none">
            <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 4, marginBottom: 8, maxWidth: '80%' }}>
              <Text style={{ fontWeight: '800', color: '#111827', fontSize: 14 }} numberOfLines={1}>{addressName}</Text>
            </View>
            <Animated.View style={{ transform: [{ translateY: pinTranslateY }], alignItems: 'center' }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: pinColor, borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 }} />
              <View style={{ width: 2, height: 10, backgroundColor: pinColor, marginTop: -2 }} />
            </Animated.View>
          </View>

          {/* Header Controls */}
          <View style={{ position: 'absolute', top: insets.top + 10, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
            <TouchableOpacity onPress={onClose} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, elevation: 4 }}>
              <Ionicons name="arrow-back" size={24} color="#111827" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setIsSearching(true)} style={{ flex: 1, marginLeft: 12, backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 16, justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, elevation: 4 }}>
              <Text style={{ color: '#9CA3AF', fontSize: 14 }}>Search {title}...</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={handleLocateMe} style={{ position: 'absolute', right: 16, bottom: 20, width: 50, height: 50, borderRadius: 25, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, elevation: 4 }}>
            <Ionicons name="locate" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Bottom Sheet */}
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>{title}</Text>
          <Text style={{ fontSize: 14, color: '#6B7280', marginTop: 4, marginBottom: 20 }}>{busy ? 'Finding address...' : addressSub}</Text>
          <TouchableOpacity onPress={confirm} disabled={busy} style={{ backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Confirm {title}</Text>}
          </TouchableOpacity>
        </View>

        {/* Search Overlay */}
        {isSearching && (
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#fff', paddingTop: insets.top + 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
              <TouchableOpacity onPress={() => setIsSearching(false)} style={{ marginRight: 12 }}>
                <Ionicons name="arrow-back" size={24} color="#111827" />
              </TouchableOpacity>
              <TextInput
                style={{ flex: 1, height: 48, backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 16, fontSize: 16 }}
                placeholder="Search address..."
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <FlatList
              data={recents}
              keyExtractor={(i, idx) => i.name + idx}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => { moveTo(item, { name: item.name, sub: item.address }); setIsSearching(false); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
                  <Ionicons name="time-outline" size={20} color="#6B7280" style={{ marginRight: 12 }} />
                  <View>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>{item.name}</Text>
                    <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{item.address}</Text>
                  </View>
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </View>
    </Modal>
  );
};

/* ==================================================================== */
/* Main Component                                                       */
/* ==================================================================== */
export default function ManageRoutesScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  // Form State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<Frequency>('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedWeekday, setSelectedWeekday] = useState<number>(new Date().getDay());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  
  const [startLocation, setStartLocation] = useState<LocationType | null>(null);
  const [endLocation, setEndLocation] = useState<LocationType | null>(null);

  // Picker State
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<'start' | 'end'>('start');

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

  const handleLocationSelect = async (locData: any, type: 'start' | 'end') => {
    try {
      const { data: existing } = await supabase.from('locations').select('*').eq('latitude', locData.latitude).eq('longitude', locData.longitude).limit(1);
      
      let location = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: locData.street_address,
          barangay: locData.barangay,
          city: locData.city,
          province: locData.province,
          zip_code: locData.zip_code,
          latitude: locData.latitude,
          longitude: locData.longitude,
        }).select('*').single();
        
        if (error) throw error;
        location = newLoc;
      }

      if (type === 'start') setStartLocation(location);
      else setEndLocation(location);
      
      setPickerVisible(false);
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to save location to database.');
    }
  };

  const computeEffectiveDate = (): Date => {
    if (selectedFrequency === 'Daily') {
      const d = new Date(); d.setHours(0, 0, 0, 0); return d;
    }
    if (selectedFrequency === 'Weekly') return nextWeekday(selectedWeekday);
    return departureDate;
  };

  const handleSubmit = async () => {
    if (!startLocation || !endLocation || !selectedVehicleId || !userId) {
      return Alert.alert('Required', 'Please fill all fields');
    }

    const effectiveDate = computeEffectiveDate();
    const combined = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate(), departureTime.getHours(), departureTime.getMinutes());

    if (selectedFrequency === 'One-time' || selectedFrequency === 'Custom') {
      if (combined < new Date()) return Alert.alert('Invalid Time', 'You cannot schedule a route in the past.');
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
        const { error: updateError } = await supabase.from('provider_routes').update(routeData).eq('route_id', editingRoute.route_id);
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
      Alert.alert('Error', editingRoute ? 'Failed to update route' : 'Failed to save route');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (route: Route) => {
    Alert.alert('Delete Route', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('provider_routes').delete().eq('route_id', route.route_id);
          setRoutes(prev => prev.filter(r => r.route_id !== route.route_id));
      }},
    ]);
  };

  const handleEdit = (route: Route) => {
    setEditingRoute(route);
    const dt = parseNaiveIsoString(route.departure_time);
    setDepartureDate(dt); setDepartureTime(dt); setSelectedWeekday(dt.getDay());
    const freq = (route.route_frequency || 'Daily') as Frequency;
    setSelectedFrequency(FREQUENCIES.includes(freq) ? freq : 'Daily');
    setSelectedVehicleId(route.vehicle_id || null);
    setStartLocation(route.start_location || null);
    setEndLocation(route.end_location || null);
    setModalVisible(true);
  };

  const handleAdd = () => {
    resetForm();
    setModalVisible(true);
  };

  const resetForm = () => {
    setSelectedFrequency('Daily'); setDepartureDate(new Date()); setDepartureTime(new Date());
    setSelectedWeekday(new Date().getDay()); setSelectedVehicleId(null);
    setStartLocation(null); setEndLocation(null); setEditingRoute(null);
  };

  // Preview Map for Modal
  const [previewCoords, setPreviewCoords] = useState<Coord[]>([]);
  useEffect(() => {
    if (!startLocation || !endLocation) { setPreviewCoords([]); return; }
    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${startLocation.longitude},${startLocation.latitude};${endLocation.longitude},${endLocation.latitude}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.routes?.[0]?.geometry?.coordinates) {
          setPreviewCoords(data.routes[0].geometry.coordinates.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
        } else {
          setPreviewCoords([{latitude: startLocation.latitude, longitude: startLocation.longitude}, {latitude: endLocation.latitude, longitude: endLocation.longitude}]);
        }
      } catch {
        setPreviewCoords([{latitude: startLocation.latitude, longitude: startLocation.longitude}, {latitude: endLocation.latitude, longitude: endLocation.longitude}]);
      }
    })();
  }, [startLocation, endLocation]);

  const renderRouteCard = ({ item }: { item: Route }) => {
    const dt = parseNaiveIsoString(item.departure_time);
    const freqLabel = (() => {
      const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (item.route_frequency === 'Daily') return `Every day · ${timeStr}`;
      if (item.route_frequency === 'Weekly') return `Every ${WEEKDAY_LABELS[dt.getDay()]} · ${timeStr}`;
      return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${timeStr}`;
    })();

    return (
      <View style={styles.routeCard}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeDate}>{freqLabel}</Text>
            <Text style={styles.routeTime}>{item.route_frequency}</Text>
          </View>
          <View style={styles.frequencyBadge}><Text style={styles.frequencyText}>{item.route_frequency}</Text></View>
        </View>

        <View style={styles.timeline}>
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconWrapper}><View style={styles.blueDot} /><View style={styles.timelineLine} /></View>
            <View style={styles.timelineText}>
              <Text style={styles.timelineLabel}>START</Text>
              <Text style={styles.timelineAddress} numberOfLines={1}>{item.start_location?.street_address || 'N/A'}</Text>
            </View>
          </View>
          <View style={styles.timelineItem}>
            <View style={styles.timelineIconWrapper}><Ionicons name="location" size={16} color={colors.error} /></View>
            <View style={styles.timelineText}>
              <Text style={[styles.timelineLabel, { color: colors.error }]}>END</Text>
              <Text style={styles.timelineAddress} numberOfLines={1}>{item.end_location?.street_address || 'N/A'}</Text>
            </View>
          </View>
        </View>

        {item.vehicle && (
          <View style={styles.vehicleRow}>
            <Ionicons name="car-sport-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.vehicleText}>{item.vehicle.vehicle_type} · {item.vehicle.plate_number}</Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(item)}>
            <Ionicons name="create-outline" size={14} color={ORANGE} /><Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)}>
            <Ionicons name="trash-outline" size={14} color={colors.error} /><Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Routes</Text>
        <TouchableOpacity style={styles.headerAddBtn} onPress={handleAdd}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={ORANGE} /></View>
      ) : routes.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="map-outline" size={40} color={ORANGE} />
          <Text style={styles.emptyTitle}>No routes yet</Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd}><Text style={styles.emptyAddBtnText}>Add Route</Text></TouchableOpacity>
        </View>
      ) : (
        <FlatList data={routes} keyExtractor={i => i.route_id.toString()} renderItem={renderRouteCard} contentContainerStyle={styles.listContent} />
      )}

      {/* Add / Edit Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editingRoute ? 'Edit Route' : 'Add Route'}</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              
              {/* Route Locations */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Locations</Text>
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('start'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, startLocation && { backgroundColor: '#3B82F6' }]}><Ionicons name="radio-button-on" size={14} color="#FFF" /></View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>{startLocation ? startLocation.street_address : 'Set Starting Point'}</Text>
                </TouchableOpacity>
                <View style={{ height: 10 }} />
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('end'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, endLocation && { backgroundColor: colors.error }]}><Ionicons name="location" size={14} color="#FFF" /></View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>{endLocation ? endLocation.street_address : 'Set Destination'}</Text>
                </TouchableOpacity>
              </View>

              {/* Map Preview */}
              {startLocation && endLocation && (
                <View style={styles.modalMapContainer}>
                  <MapView
                    style={StyleSheet.absoluteFill}
                    provider={PROVIDER_GOOGLE}
                    googleMapId={GOOGLE_MAP_ID}
                    initialRegion={{ latitude: startLocation.latitude, longitude: startLocation.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
                    scrollEnabled={false} zoomEnabled={false} pitchEnabled={false}
                  >
                    <Marker coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }} title="Start" />
                    <Marker coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }} title="End" />
                    {previewCoords.length > 0 && <Polyline coordinates={previewCoords} strokeColor={ORANGE} strokeWidth={4} />}
                  </MapView>
                </View>
              )}

              {/* Frequency */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Frequency</Text>
                <View style={styles.frequencyOptions}>
                  {FREQUENCIES.map(freq => (
                    <TouchableOpacity key={freq} style={[styles.frequencyOption, selectedFrequency === freq && styles.frequencyOptionSelected]} onPress={() => setSelectedFrequency(freq)}>
                      <Text style={[styles.frequencyOptionText, selectedFrequency === freq && styles.frequencyOptionTextSelected]}>{freq}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Date/Time */}
              {selectedFrequency === 'Daily' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Departure Time</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && <DateTimePicker value={departureTime} mode="time" onChange={(e, t) => { setShowTimePicker(Platform.OS === 'ios'); if (t) setDepartureTime(t); }} />}
                </View>
              ) : selectedFrequency === 'Weekly' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Repeats on</Text>
                  <View style={styles.weekdayRow}>
                    {WEEKDAY_LABELS.map((label, idx) => (
                      <TouchableOpacity key={label} style={[styles.weekdayChip, selectedWeekday === idx && styles.weekdayChipActive]} onPress={() => setSelectedWeekday(idx)}>
                        <Text style={[styles.weekdayChipText, selectedWeekday === idx && styles.weekdayChipTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ height: 14 }} />
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && <DateTimePicker value={departureTime} mode="time" onChange={(e, t) => { setShowTimePicker(Platform.OS === 'ios'); if (t) setDepartureTime(t); }} />}
                </View>
              ) : (
                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Date</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    {showDatePicker && <DateTimePicker value={departureDate} mode="date" minimumDate={new Date()} onChange={(e, d) => { setShowDatePicker(Platform.OS === 'ios'); if (d) setDepartureDate(d); }} />}
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </TouchableOpacity>
                    {showTimePicker && <DateTimePicker value={departureTime} mode="time" onChange={(e, t) => { setShowTimePicker(Platform.OS === 'ios'); if (t) setDepartureTime(t); }} />}
                  </View>
                </View>
              )}

              {/* Vehicle */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                <View style={styles.vehicleOptions}>
                  {vehicles.map(v => (
                    <TouchableOpacity key={v.vehicle_id} style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]} onPress={() => setSelectedVehicleId(v.vehicle_id)}>
                      <Ionicons name="car-sport" size={14} color={selectedVehicleId === v.vehicle_id ? '#FFF' : colors.textSecondary} />
                      <Text style={[styles.vehicleOptionText, selectedVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>{v.plate_number}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.7 }]} onPress={handleSubmit} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>{editingRoute ? 'Update Route' : 'Save Route'}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Location Picker Modal */}
      <LocationPickerModal
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        onSelect={(loc) => handleLocationSelect(loc, pickerType)}
        initialCoords={pickerType === 'start' ? (startLocation ? { latitude: startLocation.latitude, longitude: startLocation.longitude } : undefined) : (endLocation ? { latitude: endLocation.latitude, longitude: endLocation.longitude } : undefined)}
        title={pickerType === 'start' ? 'Starting Point' : 'Destination'}
        pinColor={pickerType === 'start' ? '#3B82F6' : '#EF4444'}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  headerAddBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  
  listContent: { padding: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, marginTop: 16 },
  emptyAddBtn: { marginTop: 20, backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20 },
  emptyAddBtnText: { color: '#FFF', fontWeight: '700' },

  routeCard: { backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: c.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  routeDate: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  routeTime: { fontSize: 16, color: c.textPrimary, fontWeight: '800', marginTop: 2 },
  frequencyBadge: { backgroundColor: c.divider, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  frequencyText: { fontSize: 10, fontWeight: '800', color: c.textSecondary },

  timeline: { marginBottom: 12 },
  timelineItem: { flexDirection: 'row', marginBottom: 8 },
  timelineIconWrapper: { width: 22, alignItems: 'center', marginRight: 10, zIndex: 2 },
  blueDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: '#3B82F6' },
  timelineLine: { width: 1, height: 22, backgroundColor: c.border },
  timelineText: { flex: 1 },
  timelineLabel: { fontSize: 9, fontWeight: '800', color: '#3B82F6', letterSpacing: 1, marginBottom: 2 },
  timelineAddress: { fontSize: 13, fontWeight: '600', color: c.textPrimary },

  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.background, padding: 8, borderRadius: 8, marginBottom: 12 },
  vehicleText: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  cardFooter: { flexDirection: 'row', gap: 10 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft, padding: 10, borderRadius: 12, gap: 6 },
  editBtnText: { color: ORANGE, fontSize: 13, fontWeight: '700' },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.errorBg, padding: 10, borderRadius: 12, gap: 6 },
  deleteBtnText: { color: c.error, fontSize: 13, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '94%', flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary },
  modalScrollContent: { padding: 20, paddingBottom: 40 },

  modalMapContainer: { height: 160, borderRadius: 16, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: c.border },
  
  locationSelectorBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, gap: 12 },
  locSelectorIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  locationSelectorText: { flex: 1, fontWeight: '600', color: c.textPrimary },

  formGroup: { marginBottom: 20 },
  inputLabel: { marginBottom: 8, fontWeight: '700', color: c.textPrimary, fontSize: 12 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5, borderColor: c.border },
  frequencyOptionSelected: { backgroundColor: ORANGE, borderColor: ORANGE },
  frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  frequencyOptionTextSelected: { color: '#FFF' },

  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekdayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center' },
  weekdayChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  weekdayChipTextActive: { color: '#FFF' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  dateTimeButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 12 },
  dateTimeValue: { fontSize: 13, color: c.textPrimary, fontWeight: '600' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.background, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, borderWidth: 1.5, borderColor: c.border },
  vehicleOptionActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFF' },

  submitBtn: { backgroundColor: ORANGE, padding: 16, borderRadius: 16, alignItems: 'center' },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});