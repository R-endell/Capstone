// src/modules/Dashboard/Sender/ExploreScreen.tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Dimensions,
  FlatList,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../../utils/supabase';
import { useSchedule } from '../Sender/Delivery/ScheduleContext';
import { WebView } from 'react-native-webview';
import { decode } from 'base64-arraybuffer';

const MiniMap = ({ lat, lng }: { lat: number; lng: number }) => {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .pin {
            width: 14px; height: 14px; border-radius: 50%;
            background: #F27024; border: 2px solid #FFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
          }).setView([${lat}, ${lng}], 14);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          L.marker([${lat}, ${lng}], {
            icon: L.divIcon({
              className: '',
              html: '<div class="pin"></div>',
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            })
          }).addTo(map);
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

const { height } = Dimensions.get('window');
const ORANGE = '#F27024';

type Trip = {
  id: string;
  routeId: number;
  providerId: number;
  name: string;
  status: 'Active' | 'Offline';
  rating: number;
  pickup: string;
  dropoff: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  accepts: string;
  estimate: string;
  timeLabel: string;
  isTimeExact: boolean;
  departureTime: Date;
  vehicleType: string;
  maxWeightKg: number;
};

type FilterState = {
  status: 'all' | 'Active' | 'Offline';
};

const deriveAccepts = (maxWeightKg: number): string => {
  if (maxWeightKg <= 100) return 'Small to Medium box';
  if (maxWeightKg <= 500) return 'Medium Box to Large box';
  return 'Large box to XL';
};

const deriveEstimate = (maxWeightKg: number): string => {
  if (maxWeightKg <= 100) return '₱15.00 - ₱25.00';
  if (maxWeightKg <= 500) return '₱20.00 - ₱36.00';
  return '₱35.00 - ₱50.00';
};

const formatTimeLabel = (dep: Date): { label: string; exact: boolean } => {
  const diffMin = Math.round((dep.getTime() - Date.now()) / 60000);
  if (diffMin < 0) return { label: 'Departed', exact: false };
  if (diffMin < 60) return { label: `Leaves in ${diffMin} mins`, exact: false };
  if (diffMin < 1440) {
    return {
      label: `Today at ${dep.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      exact: true,
    };
  }
  return {
    label:
      dep.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' +
      dep.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    exact: true,
  };
};

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [search, setSearch] = useState('');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<Trip | null>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ status: 'all' });

  const [sheetSize, setSheetSize] = useState<'Small' | 'Medium' | 'Large'>('Small');
  const [sheetPickupType, setSheetPickupType] = useState<'Curb-side Drop-off' | 'Door-to-door'>('Curb-side Drop-off');
  const [sheetWeight, setSheetWeight] = useState('');
  const [sheetDescription, setSheetDescription] = useState('');
  const [sheetFragile, setSheetFragile] = useState(false);
  const [sheetSubmitting, setSheetSubmitting] = useState(false);

  const { state: scheduleState, dispatch: scheduleDispatch } = useSchedule();
  const pickupLocation = scheduleState.explorePickup;
  const dropoffLocation = scheduleState.exploreDropoff;

  const fetchTrips = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('provider_routes')
        .select(`
          route_id,
          departure_time,
          route_frequency,
          provider_id,
          provider:users!provider_routes_provider_id_fkey (
            user_id, first_name, last_name, is_active
          ),
          start_location:locations!provider_routes_start_location_id_fkey (
            street_address, barangay, city, latitude, longitude
          ),
          end_location:locations!provider_routes_end_location_id_fkey (
            street_address, barangay, city, latitude, longitude
          ),
          vehicle:vehicles!provider_routes_vehicle_id_fkey (
            vehicle_type, max_weight_kg
          )
        `)
        .order('departure_time', { ascending: true });

      if (error) throw error;

      const mapped: Trip[] = (data || []).map((r: any) => {
        const provider = r.provider || {};
        const vehicle = r.vehicle || {};
        const start = r.start_location || {};
        const end = r.end_location || {};

        const dep = r.departure_time ? new Date(r.departure_time) : new Date();
        const { label, exact } = formatTimeLabel(dep);

        return {
          id: String(r.route_id),
          routeId: r.route_id,
          providerId: r.provider_id,
          name: `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'Unknown Provider',
          status: provider.is_active ? 'Active' : 'Offline',
          rating: 4.9,
          pickup: start.street_address || 'Pickup location',
          dropoff: end.street_address || 'Dropoff location',
          pickupCoords: { lat: Number(start.latitude) || 0, lng: Number(start.longitude) || 0 },
          dropoffCoords: { lat: Number(end.latitude) || 0, lng: Number(end.longitude) || 0 },
          accepts: deriveAccepts(Number(vehicle.max_weight_kg) || 0),
          estimate: deriveEstimate(Number(vehicle.max_weight_kg) || 0),
          timeLabel: label,
          isTimeExact: exact,
          departureTime: dep,
          vehicleType: vehicle.vehicle_type || 'Unknown',
          maxWeightKg: Number(vehicle.max_weight_kg) || 0,
        };
      });

      setTrips(mapped);
    } catch (err) {
      console.error('Error fetching trips:', err);
      setTrips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { fetchTrips(); }, [fetchTrips]));

  const onRefresh = () => { setRefreshing(true); fetchTrips(); };

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        trip.name.toLowerCase().includes(q) ||
        trip.pickup.toLowerCase().includes(q) ||
        trip.dropoff.toLowerCase().includes(q);
      if (!matchesSearch) return false;
      if (filters.status !== 'all' && trip.status !== filters.status) return false;
      return true;
    });
  }, [trips, search, filters]);

  const resetFilters = () => setFilters({ status: 'all' });
  const hasActiveFilters = filters.status !== 'all';

  const openLocationPicker = (which: 'pickup' | 'dropoff') => {
    navigation.navigate('PickupLocation', {
      type: which,
      for: which,
      fromExplore: true,
    });
  };

  const upsertLocation = async (loc: { address: string; latitude: number; longitude: number }): Promise<number> => {
    const { data: existing } = await supabase
      .from('locations')
      .select('location_id')
      .eq('latitude', loc.latitude)
      .eq('longitude', loc.longitude)
      .limit(1)
      .maybeSingle();

    if (existing) return existing.location_id;

    const parts = loc.address.split(',').map((s) => s.trim());
    const { data: inserted, error } = await supabase
      .from('locations')
      .insert({
        street_address: parts[0] || loc.address,
        barangay: parts[1] || 'Unknown',
        city: parts[2] || 'Unknown',
        province: parts[3] || 'Unknown',
        zip_code: '0000',
        latitude: loc.latitude,
        longitude: loc.longitude,
      })
      .select('location_id')
      .single();

    if (error) throw error;
    return inserted.location_id;
  };

  const handleSendMatchRequest = async () => {
    if (!selectedProvider) return;

    const weight = parseFloat(sheetWeight);
    if (!pickupLocation) { Alert.alert('Required', 'Please choose a pickup location.'); return; }
    if (!dropoffLocation) { Alert.alert('Required', 'Please choose a dropoff location.'); return; }
    if (!weight || weight <= 0) { Alert.alert('Required', 'Please enter a weight.'); return; }
    if (weight > selectedProvider.maxWeightKg) {
      Alert.alert('Too Heavy', `${selectedProvider.name.split(' ')[0]}'s vehicle accepts up to ${selectedProvider.maxWeightKg} kg.`);
      return;
    }

    setSheetSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be logged in.');

      const { data: sender } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .maybeSingle();
      if (!sender) throw new Error('Could not find your user record.');

      let cargoPicUrl: string | null = null;

        if (sheetImageBase64) {
          try {
            setSheetUploadingImage(true);
            const fileName = `cargo_${sender.user_id}_${Date.now()}.jpg`;
            const { error: upErr } = await supabase.storage
              .from('cargo-images')   // ⚠️ see note below
              .upload(fileName, decode(sheetImageBase64), {
                contentType: 'image/jpeg',
                upsert: true,
              });
            if (upErr) throw upErr;

            const { data: urlData } = supabase.storage
              .from('cargo-images')
              .getPublicUrl(fileName);

            cargoPicUrl = urlData?.publicUrl || null;
          } catch (upErr: any) {
            console.warn('Cargo image upload failed:', upErr?.message);
            // Continue without the image — don't fail the whole request
          } finally {
            setSheetUploadingImage(false);
          }
        }

      const qty =
        sheetSize === 'Small' ? { small_box_qty: 1, medium_box_qty: 0, large_box_qty: 0 } :
        sheetSize === 'Medium' ? { small_box_qty: 0, medium_box_qty: 1, large_box_qty: 0 } :
                                 { small_box_qty: 0, medium_box_qty: 0, large_box_qty: 1 };

      const { data: cargo, error: cargoErr } = await supabase
        .from('cargo_profiles')
        .insert({
          description: sheetDescription.trim() || 'No description.',
          total_weight_kg: weight,
          is_fragile: sheetFragile,
          cargo_pic: cargoPicUrl, 
          sender_id: sender.user_id,
          ...qty,
        })
        .select('cargo_id')
        .single();
      if (cargoErr) throw cargoErr;

      const pickupLocId = await upsertLocation(pickupLocation);
      const dropoffLocId = await upsertLocation(dropoffLocation);

      const { data: rate } = await supabase
        .from('delivery_rates')
        .select('rate_id')
        .limit(1)
        .maybeSingle();
      if (!rate) throw new Error('No delivery rates configured.');

      const priceMatch = selectedProvider.estimate.match(/₱([\d.]+)/);
      const estimatedCost = priceMatch ? parseFloat(priceMatch[1]) : 20;

      const { data: request, error: reqErr } = await supabase
        .from('delivery_requests')
        .insert({
          pickup_type: sheetPickupType,
          delivery_status: 'Pending',
          scheduled_time: selectedProvider.departureTime.toISOString(),
          receiver_phone: '0000000000',
          total_distance: 5.0,
          estimated_cost: estimatedCost,
          pickup_location_id: pickupLocId,
          dropoff_location_id: dropoffLocId,
          rate_id: rate.rate_id,
          sender_id: sender.user_id,
          cargo_id: cargo.cargo_id,
        })
        .select('request_id')
        .single();
      if (reqErr) throw reqErr;

      Alert.alert(
        'Request Sent',
        `Your match request was sent to ${selectedProvider.name.split(' ')[0]}.`,
        [{ text: 'OK', onPress: () => { setSelectedProvider(null); resetSheet(); } }]
      );
    } catch (err: any) {
      console.error('Match request error:', err);
      Alert.alert('Error', err?.message || 'Failed to send match request.');
    } finally {
      setSheetSubmitting(false);
    }
  };

  const resetSheet = () => {
    setSheetSize('Small');
    setSheetPickupType('Curb-side Drop-off');
    setSheetWeight('');
    setSheetDescription('');
    setSheetFragile(false);
    scheduleDispatch({ type: 'SET_EXPLORE_PICKUP', payload: null });
    scheduleDispatch({ type: 'SET_EXPLORE_DROPOFF', payload: null });
    setSheetImageUri(null);
    setSheetImageBase64(null);
  };

  const [sheetImageUri, setSheetImageUri] = useState<string | null>(null);
  const [sheetImageBase64, setSheetImageBase64] = useState<string | null>(null);
  const [sheetUploadingImage, setSheetUploadingImage] = useState(false);

  const pickShipmentImage = () => {
    launchImage('library');
  };

  const launchImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow photo access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (!result.canceled && result.assets[0]) {
        setSheetImageUri(result.assets[0].uri);
        setSheetImageBase64(result.assets[0].base64 || null);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not pick image.');
    }
  };

  const renderTripCard = ({ item }: { item: Trip }) => (
    <View style={styles.tripCard}>
      <View style={styles.cardHeader}>
        <View style={styles.avatarCircle}>
          <Ionicons name="person" size={24} color="#FFF" />
        </View>
        <View style={styles.providerInfo}>
          <Text style={styles.providerName}>{item.name}</Text>
          <View style={styles.badgesRow}>
            <View style={[styles.statusBadge, item.status === 'Active' ? styles.statusActive : styles.statusOffline]}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
            <Ionicons name="star" size={14} color="#FBBF24" style={{ marginLeft: 6, marginRight: 2 }} />
            <Text style={styles.ratingText}>{item.rating}</Text>
            <TouchableOpacity style={styles.chatIcon}>
              <Ionicons name="chatbubbles-outline" size={14} color="#000" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.routeSection}>
        <View style={styles.timeline}>
          <View style={styles.timelinePoint}>
            <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
            <Text style={styles.timelineText} numberOfLines={1}>{item.pickup}</Text>
          </View>
          <View style={styles.timelineLine} />
          <View style={styles.timelinePoint}>
            <Ionicons name="location" size={18} color="#E11D48" style={{ marginLeft: -1, marginRight: 7 }} />
            <Text style={styles.timelineText} numberOfLines={1}>{item.dropoff}</Text>
          </View>
        </View>
        <View style={styles.miniMap}>
          <MiniMap
            lat={item.pickupCoords.lat || 10.3157}
            lng={item.pickupCoords.lng || 123.8854}
          />
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerLabel}>Accepts</Text>
          <Text style={styles.acceptsText}>{item.accepts}</Text>
          <View style={styles.timeRow}>
            <Ionicons name={item.isTimeExact ? 'calendar-outline' : 'timer-outline'} size={14} color="#000" />
            <Text style={styles.timeText}>{item.timeLabel}</Text>
          </View>
        </View>
        <View style={styles.footerRight}>
          <Text style={styles.footerLabel}>Estimate</Text>
          <Text style={styles.estimateText}>{item.estimate}</Text>
          <TouchableOpacity onPress={() => { resetSheet(); setSelectedProvider(item); }}>
            <Text style={styles.bookBtnText}>Book this Provider</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerContainer}>
        <Text style={styles.pageTitle}>Explore Trips</Text>
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color="#9CA3AF" />
            <TextInput
              placeholder="Search by name, pickup, dropoff..."
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
            onPress={() => setFilterModalVisible(true)}
          >
            <Ionicons name="options-outline" size={24} color={hasActiveFilters ? ORANGE : '#374151'} />
            {hasActiveFilters && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>

        {hasActiveFilters && (
          <View style={styles.activeFiltersRow}>
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>Status: {filters.status}</Text>
              <TouchableOpacity onPress={() => setFilters({ ...filters, status: 'all' })}>
                <Ionicons name="close-circle" size={14} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={resetFilters}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>Active Trips Heading Your Way</Text>
        <Text style={styles.sectionSubtitle}>
          These riders are already on your path. Save money by matching.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading trips...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTrips}
          keyExtractor={(item) => item.id}
          renderItem={renderTripCard}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} colors={[ORANGE]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>No trips found</Text>
              <Text style={styles.emptySubtext}>
                {trips.length === 0
                  ? 'No active routes right now. Check back soon.'
                  : 'Try adjusting your search or filters.'}
              </Text>
            </View>
          }
        />
      )}

      {/* FILTER MODAL */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setFilterModalVisible(false)} activeOpacity={1} />
          <View style={[styles.filterModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Status</Text>
              <View style={styles.filterOptionsRow}>
                {(['all', 'Active', 'Offline'] as const).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[styles.filterOption, filters.status === status && styles.filterOptionActive]}
                    onPress={() => setFilters({ ...filters, status })}
                  >
                    <Text style={[styles.filterOptionText, filters.status === status && styles.filterOptionTextActive]}>
                      {status === 'all' ? 'All' : status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.applyFiltersBtn} onPress={() => setFilterModalVisible(false)}>
              <Text style={styles.applyFiltersBtnText}>Apply Filters</Text>
            </TouchableOpacity>
            {hasActiveFilters && (
              <TouchableOpacity onPress={resetFilters} style={styles.resetFiltersBtn}>
                <Text style={styles.resetFiltersBtnText}>Reset Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* MATCH BOTTOM SHEET */}
      <Modal
        visible={!!selectedProvider}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedProvider(null)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setSelectedProvider(null)} activeOpacity={1} />
          <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
            {selectedProvider && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>Match with {selectedProvider.name.split(' ')[0]}?</Text>
                <Text style={styles.modalDesc}>
                  {selectedProvider.name.split(' ')[0]} is traveling to{' '}
                  <Text style={{ fontWeight: '700' }}>{selectedProvider.dropoff}</Text>. Choose your pickup
                  and dropoff, then tell us what you're sending.
                </Text>

                <Text style={styles.fieldLabel}>Pickup location</Text>
                <TouchableOpacity
                  style={styles.locationRow}
                  onPress={() => openLocationPicker('pickup')}
                  activeOpacity={0.85}
                >
                  <View style={styles.locationDot}><View style={styles.locationDotInner} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.locationText, !pickupLocation && { color: '#9CA3AF' }]} numberOfLines={1}>
                      {pickupLocation ? pickupLocation.address : 'Tap to choose pickup point'}
                    </Text>
                    {pickupLocation && (
                      <Text style={styles.locationCoords}>
                        {pickupLocation.latitude.toFixed(5)}, {pickupLocation.longitude.toFixed(5)}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                </TouchableOpacity>

                <Text style={styles.fieldLabel}>Dropoff location</Text>
                <TouchableOpacity
                  style={styles.locationRow}
                  onPress={() => openLocationPicker('dropoff')}
                  activeOpacity={0.85}
                >
                  <Ionicons name="location" size={18} color="#E11D48" style={{ marginLeft: -1, marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.locationText, !dropoffLocation && { color: '#9CA3AF' }]} numberOfLines={1}>
                      {dropoffLocation ? dropoffLocation.address : 'Tap to choose dropoff point'}
                    </Text>
                    {dropoffLocation && (
                      <Text style={styles.locationCoords}>
                        {dropoffLocation.latitude.toFixed(5)}, {dropoffLocation.longitude.toFixed(5)}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                </TouchableOpacity>

                <View style={styles.shipmentHeaderRow}>
                  <View style={styles.orangeBoxIcon}>
                    <Ionicons name="cube" size={24} color="#FFF" />
                  </View>
                  <Text style={styles.shipmentHeader}>What's in your shipment?</Text>
                </View>

                <Text style={styles.fieldLabel}>Service type</Text>
                <View style={styles.sizeSelectorRow}>
                  {(['Curb-side Drop-off', 'Door-to-door'] as const).map((t) => {
                    const active = sheetPickupType === t;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={[styles.sizeBox, active && styles.sizeBoxActive, { height: 70 }]}
                        onPress={() => setSheetPickupType(t)}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={t === 'Door-to-door' ? 'home-outline' : 'walk-outline'}
                          size={22}
                          color={active ? ORANGE : '#9CA3AF'}
                        />
                        <Text style={[styles.sizeText, active && { color: ORANGE }]}>
                          {t === 'Door-to-door' ? 'Door-to-door' : 'Curb-side'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>Box size</Text>
                <View style={styles.sizeSelectorRow}>
                  {(['Small', 'Medium', 'Large'] as const).map((s) => {
                    const active = sheetSize === s;
                    const iconSize = s === 'Small' ? 24 : s === 'Medium' ? 30 : 36;
                    return (
                      <TouchableOpacity
                        key={s}
                        style={[styles.sizeBox, active && styles.sizeBoxActive]}
                        onPress={() => setSheetSize(s)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="cube-outline" size={iconSize} color={active ? ORANGE : '#9CA3AF'} />
                        <Text style={[styles.sizeText, active && { color: ORANGE }]}>{s}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={styles.fieldLabel}>Total weight (kg)</Text>
                <TextInput
                  style={styles.textInput}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 3.5"
                  placeholderTextColor="#9CA3AF"
                  value={sheetWeight}
                  onChangeText={setSheetWeight}
                />

                <Text style={styles.fieldLabel}>Description (optional)</Text>
                <TextInput
                  style={[styles.textInput, { height: 70, textAlignVertical: 'top' }]}
                  multiline
                  placeholder="e.g. Flower vase, please handle with care"
                  placeholderTextColor="#9CA3AF"
                  value={sheetDescription}
                  onChangeText={setSheetDescription}
                />

                <Text style={styles.fieldLabel}>Photo of package (optional)</Text>
                  <TouchableOpacity
                    style={styles.imagePickerRow}
                    onPress={pickShipmentImage}
                    activeOpacity={0.85}
                  >
                    {sheetImageUri ? (
                      <>
                        <Image source={{ uri: sheetImageUri }} style={styles.imagePreview} />
                        <View style={styles.imagePickerOverlay}>
                          <Ionicons name="camera-reverse-outline" size={18} color="#FFFFFF" />
                          <Text style={styles.imagePickerOverlayText}>Change</Text>
                        </View>
                      </>
                    ) : (
                      <View style={styles.imagePickerEmpty}>
                        <View style={styles.imagePickerEmptyIcon}>
                          <Ionicons name="cloud-upload-outline" size={26} color={ORANGE} />
                        </View>
                        <Text style={styles.imagePickerEmptyText}>Tap to add a photo</Text>
                        <Text style={styles.imagePickerEmptyHint}>JPEG or PNG • Max 5 MB</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                <TouchableOpacity
                  style={styles.fragileRow}
                  onPress={() => setSheetFragile((v) => !v)}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={sheetFragile ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={sheetFragile ? ORANGE : '#9CA3AF'}
                  />
                  <Text style={styles.fragileText}>This item is fragile</Text>
                </TouchableOpacity>

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Estimated Total</Text>
                  <Text style={styles.totalPrice}>
                    {selectedProvider.estimate.split(' - ')[0]}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.sendRequestBtn, sheetSubmitting && { opacity: 0.7 }]}
                  onPress={handleSendMatchRequest}
                  disabled={sheetSubmitting}
                  activeOpacity={0.9}
                >
                  {sheetSubmitting ? (
                    <ActivityIndicator color="#064E3B" />
                  ) : (
                    <Text style={styles.sendRequestBtnText}>Send Request to Match</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  headerContainer: { paddingHorizontal: 20, paddingTop: 25, backgroundColor: '#FAFAFA', zIndex: 1 },
  pageTitle: { fontSize: 30, fontWeight: '800', color: '#000000', marginBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginRight: 10,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 14, color: '#000' },
  filterBtn: {
    width: 44, height: 44, borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 8, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center', position: 'relative',
  },
  filterBtnActive: { borderColor: ORANGE },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  activeFiltersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, gap: 6 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, gap: 4,
  },
  filterChipText: { fontSize: 12, color: '#374151' },
  clearAllText: { fontSize: 12, color: ORANGE, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#000', marginBottom: 4 },
  sectionSubtitle: { fontSize: 11, color: '#6B7280', marginBottom: 16, lineHeight: 16 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  listContainer: { paddingHorizontal: 20, paddingBottom: 100 },

  tripCard: {
    backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: '#E5E7EB',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  avatarCircle: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#D97706',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 4 },
  badgesRow: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  statusActive: { backgroundColor: '#A3E635' },
  statusOffline: { backgroundColor: '#D1D5DB' },
  statusText: { fontSize: 10, fontWeight: '600', color: '#111827' },
  ratingText: { fontSize: 12, fontWeight: '600', color: '#000', marginRight: 8 },
  chatIcon: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#000',
    justifyContent: 'center', alignItems: 'center',
  },
  routeSection: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  timeline: { flex: 1, paddingRight: 16 },
  timelinePoint: { flexDirection: 'row', alignItems: 'center' },
  blueDot: {
    width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: '#0000CC',
    justifyContent: 'center', alignItems: 'center', marginRight: 8,
  },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  timelineLine: { width: 1, height: 16, backgroundColor: '#D1D5DB', marginLeft: 6, marginVertical: 4 },
  timelineText: { fontSize: 12, color: '#111827' },
  miniMap: {
  width: 80,
  height: 60,
  backgroundColor: '#F3F4F6',
  borderRadius: 8,
  overflow: 'hidden',
  borderWidth: 1,
  borderColor: '#E5E7EB',
},
  divider: { height: 1, backgroundColor: '#E5E7EB', marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  footerLeft: { flex: 1 },
  footerRight: { alignItems: 'flex-end' },
  footerLabel: { fontSize: 9, color: '#6B7280', marginBottom: 2 },
  acceptsText: { fontSize: 11, fontWeight: '600', color: '#111827', marginBottom: 8 },
  timeRow: { flexDirection: 'row', alignItems: 'center' },
  timeText: { fontSize: 12, fontWeight: '700', color: '#000', marginLeft: 4 },
  estimateText: { fontSize: 11, fontWeight: '700', color: '#111827', marginBottom: 8 },
  bookBtnText: { fontSize: 12, fontWeight: '600', color: ORANGE },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#6B7280', marginTop: 12 },
  emptySubtext: { fontSize: 13, color: '#9CA3AF', marginTop: 4, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: height * 0.6,
  },
  filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  filterModalTitle: { fontSize: 20, fontWeight: '800', color: '#111827' },
  filterSection: { marginBottom: 20 },
  filterSectionTitle: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 10 },
  filterOptionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterOption: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF',
  },
  filterOptionActive: { borderColor: ORANGE, backgroundColor: '#FFF7ED' },
  filterOptionText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  filterOptionTextActive: { color: ORANGE, fontWeight: '700' },
  applyFiltersBtn: { backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  applyFiltersBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  resetFiltersBtn: { paddingVertical: 12, alignItems: 'center' },
  resetFiltersBtnText: { color: '#6B7280', fontWeight: '600', fontSize: 14 },

  bottomSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: height * 0.9,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#000', marginBottom: 8 },
  modalDesc: { fontSize: 13, color: '#374151', lineHeight: 18, marginBottom: 20 },
  shipmentHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  orangeBoxIcon: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#F59E0B',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
    transform: [{ rotate: '-10deg' }],
  },
  shipmentHeader: { fontSize: 18, fontWeight: '800', color: '#000' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#374151', marginBottom: 6 },
  sizeSelectorRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  sizeBox: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, height: 80,
    justifyContent: 'center', alignItems: 'center', marginHorizontal: 4,
    borderWidth: 2, borderColor: 'transparent',
  },
  sizeBoxActive: { backgroundColor: '#FFF7ED', borderColor: ORANGE },
  sizeText: { fontSize: 10, fontWeight: '600', color: '#000', marginTop: 6 },
  textInput: {
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#111827', marginBottom: 16,
  },
  fragileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 },
  fragileText: { fontSize: 13, color: '#374151', fontWeight: '600' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  totalLabel: { fontSize: 14, color: '#374151' },
  totalPrice: { fontSize: 18, fontWeight: '700', color: '#000' },
  sendRequestBtn: { backgroundColor: '#A3E635', borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  sendRequestBtnText: { color: '#064E3B', fontSize: 15, fontWeight: '600' },

  locationRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16, gap: 10,
  },
  locationDot: {
    width: 14, height: 14, borderRadius: 7, borderWidth: 3,
    justifyContent: 'center', alignItems: 'center',
  },
  locationDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  locationText: { fontSize: 13, color: '#111827', fontWeight: '600' },
  locationCoords: { fontSize: 10, color: '#9CA3AF', marginTop: 2, fontWeight: '500' },

  imagePickerRow: {
  height: 100,
  borderRadius: 12,
  borderWidth: 1.5,
  borderStyle: 'dashed',
  borderColor: '#E5E7EB',
  backgroundColor: '#F9FAFB',
  marginBottom: 16,
  overflow: 'hidden',
  position: 'relative',
},
imagePickerEmpty: {
  flex: 1,
  justifyContent: 'center',
  alignItems: 'center',
  gap: 4,
},
imagePreview: {
  width: '100%',
  height: '100%',
  resizeMode: 'cover',
},
imagePickerOverlay: {
  position: 'absolute',
  bottom: 8,
  right: 8,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  backgroundColor: 'rgba(17,24,39,0.75)',
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 8,
},
imagePickerOverlayText: {
  color: '#FFFFFF',
  fontSize: 10,
  fontWeight: '800',
  letterSpacing: 0.3,
},

imagePickerEmptyIcon: {
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: '#FFF7ED',
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: 6,
},
imagePickerEmptyText: {
  fontSize: 12,
  color: '#374151',
  fontWeight: '700',
},
imagePickerEmptyHint: {
  fontSize: 10,
  color: '#9CA3AF',
  fontWeight: '500',
  marginTop: 2,
},
});