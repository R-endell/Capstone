// src/modules/Dashboard/Provider/Manage/ManageRoutesScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, StatusBar,
  Alert, ActivityIndicator, ScrollView, Platform, Animated, Easing,
  TextInput,
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

const ORANGE = '#FF751F';
const BLUE = '#3B82F6';
const BLACK = '#111827';
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
const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

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

export const isRouteExpired = (route: { route_frequency: string; departure_time: string }): boolean => {
  const freq = (route.route_frequency || '').trim().toLowerCase();
  if (freq === 'one-time' || freq === 'custom') {
    const dt = parseNaiveIsoString(route.departure_time);
    return dt.getTime() < Date.now();
  }
  return false;
};

const nextWeekday = (weekday: number, from = new Date()): Date => {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
};

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCIES = ['One-time', 'Daily', 'Weekly', 'Custom'] as const;
type Frequency = typeof FREQUENCIES[number];
type RouteTab = 'active' | 'expired';

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
  visible, onClose, onSelect, initialCoords, title, pinColor,
}: {
  visible: boolean; onClose: () => void; onSelect: (loc: any) => void; initialCoords?: Coord | null; title: string; pinColor: string;
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

  const resolveAt = async (coords: Coord, label?: { name: string; sub: string }) => {
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

  const moveTo = (coords: Coord, label?: { name: string; sub: string }) => {
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
      ...structuredAddress,
    });
    saveRecent({ name: addressName, address: addressSub, latitude: markerCoord.latitude, longitude: markerCoord.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

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

          <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, alignItems: 'center', marginTop: -60 }} pointerEvents="box-none">
            <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, elevation: 4, marginBottom: 8, maxWidth: '80%' }}>
              <Text style={{ fontWeight: '800', color: '#111827', fontSize: 14 }} numberOfLines={1}>{addressName}</Text>
            </View>
            <Animated.View style={{ transform: [{ translateY: pinTranslateY }], alignItems: 'center' }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: pinColor, borderWidth: 3, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, elevation: 5 }} />
              <View style={{ width: 2, height: 10, backgroundColor: pinColor, marginTop: -2 }} />
            </Animated.View>
          </View>

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

        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#111827' }}>{title}</Text>
          <Text style={{ fontSize: 14, color: '#6B7280', marginTop: 4, marginBottom: 20 }}>{busy ? 'Finding address...' : addressSub}</Text>
          <TouchableOpacity onPress={confirm} disabled={busy} style={{ backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, alignItems: 'center', opacity: busy ? 0.7 : 1 }}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Confirm {title}</Text>}
          </TouchableOpacity>
        </View>

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
  const [activeTab, setActiveTab] = useState<RouteTab>('active');

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [selectedFrequency, setSelectedFrequency] = useState<Frequency>('Daily');
  const [departureDate, setDepartureDate] = useState(new Date());
  const [departureTime, setDepartureTime] = useState(new Date());
  const [selectedWeekday, setSelectedWeekday] = useState<number>(new Date().getDay());
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  const [startLocation, setStartLocation] = useState<LocationType | null>(null);
  const [endLocation, setEndLocation] = useState<LocationType | null>(null);

  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerType, setPickerType] = useState<'start' | 'end'>('start');

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

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

  // Partition routes into Active and Expired
  const { activeRoutes, expiredRoutes } = useMemo(() => {
    const active: Route[] = [];
    const expired: Route[] = [];
    for (const r of routes) {
      if (isRouteExpired(r)) {
        expired.push(r);
      } else {
        active.push(r);
      }
    }
    return { activeRoutes: active, expiredRoutes: expired };
  }, [routes]);

  const displayedRoutes = activeTab === 'active' ? activeRoutes : expiredRoutes;

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

    const now = new Date();
    const effectiveDate = computeEffectiveDate();
    const combined = new Date(
      effectiveDate.getFullYear(),
      effectiveDate.getMonth(),
      effectiveDate.getDate(),
      departureTime.getHours(),
      departureTime.getMinutes(),
      0,
      0,
    );

    const isSameDayAsToday =
      effectiveDate.getFullYear() === now.getFullYear() &&
      effectiveDate.getMonth() === now.getMonth() &&
      effectiveDate.getDate() === now.getDate();

    if (selectedFrequency === 'Daily') {
      if (combined.getTime() < now.getTime()) {
        return Alert.alert(
          'Invalid Time',
          `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Please pick a departure time that has not passed yet today.`,
        );
      }
    } else if (selectedFrequency === 'Weekly') {
      if (isSameDayAsToday && combined.getTime() < now.getTime()) {
        return Alert.alert(
          'Invalid Time',
          `That time has already passed for today (${WEEKDAY_LABELS[selectedWeekday]}). Please choose a later time or another day.`,
        );
      }
    } else {
      if (combined.getTime() < now.getTime()) {
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
      setActiveTab('active');
      fetchRoutes();
    } catch (err) {
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
    const expired = isRouteExpired(route);

    // If rescheduling an expired route, default date/time to 15 minutes from now
    const defaultFuture = new Date(Date.now() + 15 * 60 * 1000);
    const baseDate = expired ? defaultFuture : dt;
    const baseTime = expired ? defaultFuture : dt;

    setDepartureDate(baseDate);
    setDepartureTime(baseTime);
    setSelectedWeekday(baseDate.getDay());

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
    const initial = new Date(Date.now() + 15 * 60 * 1000);
    setSelectedFrequency('Daily');
    setDepartureDate(initial);
    setDepartureTime(initial);
    setSelectedWeekday(initial.getDay());
    setSelectedVehicleId(null);
    setStartLocation(null);
    setEndLocation(null);
    setEditingRoute(null);
  };

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
          setPreviewCoords([{ latitude: startLocation.latitude, longitude: startLocation.longitude }, { latitude: endLocation.latitude, longitude: endLocation.longitude }]);
        }
      } catch {
        setPreviewCoords([{ latitude: startLocation.latitude, longitude: startLocation.longitude }, { latitude: endLocation.latitude, longitude: endLocation.longitude }]);
      }
    })();
  }, [startLocation, endLocation]);

  const frequencyMeta = (freq: string, expired = false) => {
    if (expired) {
      return { label: 'Expired', bg: colors.errorBg, fg: colors.error };
    }
    switch (freq) {
      case 'Daily':
        return { label: 'Daily', bg: colors.successBg, fg: colors.success };
      case 'Weekly':
        return { label: 'Weekly', bg: colors.accentSoft, fg: ORANGE };
      case 'One-time':
        return { label: 'One-Time', bg: colors.warningBg, fg: colors.warning };
      default:
        return { label: freq || 'Custom', bg: 'rgba(59,130,246,0.14)', fg: BLUE };
    }
  };

  /* ==================================================================== */
  /* Route Card — TaskScreen style (oCard)                                */
  /* ==================================================================== */
  const renderRouteCard = ({ item }: { item: Route }) => {
    const dt = parseNaiveIsoString(item.departure_time);
    const expired = isRouteExpired(item);
    const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const scheduleText = (() => {
      if (item.route_frequency === 'Daily') return `Every day · ${timeStr}`;
      if (item.route_frequency === 'Weekly') return `Every ${WEEKDAY_LABELS[dt.getDay()]} · ${timeStr}`;
      return `${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${timeStr}`;
    })();

    const meta = frequencyMeta(item.route_frequency, expired);
    const startSplit = splitAddress(item.start_location?.street_address);
    const endSplit = splitAddress(item.end_location?.street_address);
    const startRoad = [item.start_location?.barangay, item.start_location?.city].filter(Boolean).join(', ') || startSplit.sub;
    const endRoad = [item.end_location?.barangay, item.end_location?.city].filter(Boolean).join(', ') || endSplit.sub;

    return (
      <TouchableOpacity
        style={[styles.oCard, expired && styles.oCardExpired]}
        activeOpacity={0.92}
        onPress={() => handleEdit(item)}
      >
        <View style={styles.oPad}>
          {/* Top Row: Vehicle Pill + Frequency Pill */}
          <View style={styles.oTopRow}>
            <View style={styles.svcPill}>
              <Ionicons name="car-sport-outline" size={14} color={BLUE} />
              <Text style={styles.svcPillText}>
                {item.vehicle ? item.vehicle.vehicle_type : 'Vehicle'}
              </Text>
            </View>
            <View style={[styles.stPill, { backgroundColor: meta.bg }]}>
              <View style={[styles.stDot, { backgroundColor: meta.fg }]} />
              <Text style={[styles.stPillText, { color: meta.fg }]}>{meta.label.toUpperCase()}</Text>
            </View>
          </View>

          {/* Route Section: Ring + Dotted Line Rail */}
          <View>
            {[
              { key: 'p', label: 'STARTING POINT', main: startSplit.main, road: startRoad, color: ORANGE },
              { key: 'd', label: 'DESTINATION', main: endSplit.main, road: endRoad, color: BLACK },
            ].map((r, i) => (
              <View key={r.key} style={styles.rtRow}>
                <View style={styles.rtRail}>
                  <View style={[styles.rtRing, { borderColor: r.color }]}>
                    <View style={[styles.rtRingDot, { backgroundColor: r.color }]} />
                  </View>
                  {i === 0 && (
                    <View style={styles.rtDots}>
                      {[0, 1, 2, 3].map(k => <View key={k} style={styles.rtDot} />)}
                    </View>
                  )}
                </View>
                <View style={[styles.rtText, i === 0 && { paddingBottom: 14 }]}>
                  <Text style={styles.rtLabel}>{r.label}</Text>
                  <Text style={styles.rtMain} numberOfLines={1}>{r.main}</Text>
                  {!!r.road && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <Ionicons name="map-outline" size={12} color={colors.textMuted} />
                      <Text style={styles.rtSub} numberOfLines={1}>{r.road}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Footer Row: Schedule + Plate Number */}
        <View style={styles.oFooter}>
          <View style={styles.oChip}>
            <Ionicons name="time-outline" size={14} color={expired ? colors.error : ORANGE} />
            <Text style={styles.oChipText}>{scheduleText}</Text>
          </View>
          {item.vehicle?.plate_number && (
            <View style={styles.oChip}>
              <Ionicons name="pricetag-outline" size={14} color={ORANGE} />
              <Text style={styles.oChipText}>{item.vehicle.plate_number}</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
        </View>

        {/* Actions Row: Delete + Edit / Reschedule Route */}
        <View style={styles.oActions}>
          <TouchableOpacity
            style={styles.oDeleteBtn}
            onPress={() => handleDelete(item)}
            activeOpacity={0.85}
          >
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.oDeleteText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.oRouteBtn}
            onPress={() => handleEdit(item)}
            activeOpacity={0.9}
          >
            <Ionicons name={expired ? 'calendar-outline' : 'create-outline'} size={16} color="#FFFFFF" />
            <Text style={styles.oRouteText}>{expired ? 'Reschedule' : 'Edit Route'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingLeft: 14 }}>
          <Text style={styles.headerTitle}>Manage Routes</Text>
          <Text style={styles.headerSubtitle}>
            {activeRoutes.length} active · {expiredRoutes.length} expired
          </Text>
        </View>
        <TouchableOpacity style={styles.headerAddBtn} onPress={handleAdd} activeOpacity={0.9}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Active vs Expired Tab Bar */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'active' && styles.tabButtonActive]}
          onPress={() => setActiveTab('active')}
          activeOpacity={0.85}
        >
          <Ionicons
            name="navigate-circle-outline"
            size={16}
            color={activeTab === 'active' ? '#FFFFFF' : colors.textSecondary}
          />
          <Text style={[styles.tabButtonText, activeTab === 'active' && styles.tabButtonTextActive]}>
            Active ({activeRoutes.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'expired' && styles.tabButtonActive]}
          onPress={() => setActiveTab('expired')}
          activeOpacity={0.85}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={activeTab === 'expired' ? '#FFFFFF' : colors.textSecondary}
          />
          <Text style={[styles.tabButtonText, activeTab === 'expired' && styles.tabButtonTextActive]}>
            Expired ({expiredRoutes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading routes...</Text>
        </View>
      ) : displayedRoutes.length === 0 ? (
        <Animated.View style={[styles.emptyContainer, fadeUp(contentAnim, 20)]}>
          <View style={styles.emptyIconCircle}>
            <Ionicons
              name={activeTab === 'active' ? 'map-outline' : 'time-outline'}
              size={32}
              color={ORANGE}
            />
          </View>
          <Text style={styles.emptyTitle}>
            {activeTab === 'active' ? 'No active routes' : 'No expired routes'}
          </Text>
          <Text style={styles.emptySubtext}>
            {activeTab === 'active'
              ? 'Add your regular travel routes so senders along your way can book deliveries with you.'
              : 'One-time or custom routes that have passed their departure time will appear here.'}
          </Text>
          {activeTab === 'active' && (
            <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd} activeOpacity={0.9}>
              <Ionicons name="add-circle" size={18} color="#FFFFFF" />
              <Text style={styles.emptyAddBtnText}>Add Route</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: contentAnim }}>
          <FlatList
            data={displayedRoutes}
            keyExtractor={i => i.route_id.toString()}
            renderItem={renderRouteCard}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        </Animated.View>
      )}

      {/* Add / Edit Modal */}
      <Modal animationType="slide" transparent visible={modalVisible} onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editingRoute ? 'Edit Route' : 'Add Route'}</Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
              {/* Route Locations */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Route Locations</Text>
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('start'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, startLocation && { backgroundColor: ORANGE }]}>
                    <Ionicons name="radio-button-on" size={14} color="#FFF" />
                  </View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>
                    {startLocation ? startLocation.street_address : 'Set Starting Point'}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 10 }} />
                <TouchableOpacity style={styles.locationSelectorBtn} onPress={() => { setPickerType('end'); setPickerVisible(true); }}>
                  <View style={[styles.locSelectorIcon, endLocation && { backgroundColor: BLACK }]}>
                    <Ionicons name="location" size={14} color="#FFF" />
                  </View>
                  <Text style={styles.locationSelectorText} numberOfLines={1}>
                    {endLocation ? endLocation.street_address : 'Set Destination'}
                  </Text>
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

              {/* Date/Time */}
              {selectedFrequency === 'Daily' ? (
                <View style={styles.formGroup}>
                  <Text style={styles.inputLabel}>Departure Time (Today)</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                    <Ionicons name="time-outline" size={16} color={ORANGE} />
                    <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                  </TouchableOpacity>
                  {showTimePicker && (
                    <DateTimePicker
                      value={departureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) {
                          const now = new Date();
                          const candidate = new Date(
                            now.getFullYear(),
                            now.getMonth(),
                            now.getDate(),
                            t.getHours(),
                            t.getMinutes(),
                            0,
                            0,
                          );
                          if (candidate.getTime() < now.getTime()) {
                            Alert.alert(
                              'Invalid Time',
                              `It is currently ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You cannot select a time that has already passed today.`,
                            );
                            return;
                          }
                          setDepartureTime(t);
                        }
                      }}
                    />
                  )}
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
                  {showTimePicker && (
                    <DateTimePicker
                      value={departureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) setDepartureTime(t);
                      }}
                    />
                  )}
                </View>
              ) : (
                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Date</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureDate.toLocaleDateString()}</Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="date"
                        minimumDate={new Date()}
                        onChange={(e, d) => {
                          setShowDatePicker(Platform.OS === 'ios');
                          if (e.type === 'set' && d) setDepartureDate(d);
                        }}
                      />
                    )}
                  </View>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Time</Text>
                    <TouchableOpacity style={styles.dateTimeButton} onPress={() => setShowTimePicker(true)}>
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>{departureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureTime}
                        mode="time"
                        onChange={(e, t) => {
                          setShowTimePicker(Platform.OS === 'ios');
                          if (e.type === 'set' && t) setDepartureTime(t);
                        }}
                      />
                    )}
                  </View>
                </View>
              )}

              {/* Vehicle */}
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                <View style={styles.vehicleOptions}>
                  {vehicles.map(v => (
                    <TouchableOpacity
                      key={v.vehicle_id}
                      style={[styles.vehicleOption, selectedVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                      onPress={() => setSelectedVehicleId(v.vehicle_id)}
                    >
                      <Ionicons name="car-sport" size={14} color={selectedVehicleId === v.vehicle_id ? '#FFF' : colors.textSecondary} />
                      <Text style={[styles.vehicleOptionText, selectedVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                        {v.plate_number}
                      </Text>
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
        pinColor={pickerType === 'start' ? ORANGE : BLACK}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, color: c.textSecondary, fontWeight: '500', marginTop: 1 },
  headerAddBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
  },

  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 4,
    padding: 4,
    backgroundColor: c.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  tabButtonActive: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.textSecondary,
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
  },

  listContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyIconCircle: {
    width: 68, height: 68, borderRadius: 34,
    backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
    marginBottom: 14, borderWidth: 1, borderColor: c.border,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary },
  emptySubtext: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19, marginBottom: 20 },
  emptyAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14,
  },
  emptyAddBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },

  /* TaskScreen Card & Route Styles */
  oCard: {
    backgroundColor: c.card, borderRadius: 22, marginBottom: 14,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  oCardExpired: {
    opacity: 0.88,
  },
  oPad: { padding: 16 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  svcPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  svcPillText: { fontSize: 12, fontWeight: '800', color: BLUE },
  stPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
  },
  stDot: { width: 7, height: 7, borderRadius: 4 },
  stPillText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.4 },

  rtRow: { flexDirection: 'row', gap: 14 },
  rtRail: { alignItems: 'center', width: 26 },
  rtRing: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.card,
  },
  rtRingDot: { width: 8, height: 8, borderRadius: 4 },
  rtDots: { position: 'absolute', top: 30, bottom: -4, alignItems: 'center', justifyContent: 'space-evenly' },
  rtDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.border },
  rtText: { flex: 1 },
  rtLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  rtMain: { fontSize: 18, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.2, marginTop: 1 },
  rtSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },

  oFooter: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
    backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  oChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
  },
  oChipText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },

  oActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oDeleteBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.errorBg, borderRadius: 14, paddingVertical: 14,
  },
  oDeleteText: { color: c.error, fontSize: 14, fontWeight: '800' },
  oRouteBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
  },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  /* Modal Styles */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 8, maxHeight: '94%', flex: 1 },
  modalHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 6, marginBottom: 6 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  modalCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  modalTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  modalScrollContent: { padding: 20, paddingBottom: 40 },

  modalMapContainer: { height: 160, borderRadius: 16, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: c.border },

  locationSelectorBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, gap: 12 },
  locSelectorIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center' },
  locationSelectorText: { flex: 1, fontWeight: '700', color: c.textPrimary, fontSize: 14 },

  formGroup: { marginBottom: 20 },
  inputLabel: { marginBottom: 8, fontWeight: '800', color: c.textPrimary, fontSize: 12, letterSpacing: 0.3 },
  frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  frequencyOption: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card },
  frequencyOptionSelected: { backgroundColor: c.accentSoft, borderColor: ORANGE },
  frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  frequencyOptionTextSelected: { color: ORANGE, fontWeight: '800' },

  weekdayRow: { flexDirection: 'row', gap: 6 },
  weekdayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', backgroundColor: c.card },
  weekdayChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  weekdayChipText: { fontSize: 12, fontWeight: '800', color: c.textSecondary },
  weekdayChipTextActive: { color: '#FFF' },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  dateTimeButton: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14 },
  dateTimeValue: { fontSize: 14, color: c.textPrimary, fontWeight: '700' },

  vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleOption: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.background, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderWidth: 1.5, borderColor: c.border },
  vehicleOptionActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  vehicleOptionTextActive: { color: '#FFF' },

  submitBtn: { backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 6 },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '900' },
});