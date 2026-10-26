// src/modules/Dashboard/Sender/ExploreScreen.tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Dimensions, FlatList, RefreshControl, ActivityIndicator,
  Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { useSchedule } from '../Sender/Delivery/ScheduleContext';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import {
  LiveFix, fetchLiveFixes, subscribeLiveFixes, isFixFresh,
} from '../../../services/providerLiveService';
import ProviderTrackModal, { TrackTrip } from './ProviderTrackModal';

let Location: any = null;
try { Location = require('expo-location'); } catch { Location = null; }

const { height } = Dimensions.get('window');
const ORANGE = '#F27024';
const BLUE = '#3B82F6';
const BLACK = '#111827';

const HIDE_DEPARTED_AFTER_MIN = 180;
const SEND_NOW_WINDOW_MIN = 60;

const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

type Trip = {
  id: string;
  routeId: number;
  providerId: number;
  name: string;
  isActive: boolean;
  rating: number;
  pickup: string;
  dropoff: string;
  pickupSub: string;
  dropoffSub: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  timeLabel: string;
  departureTime: Date;
  vehicleType: string;
  maxWeightKg: number | null;
};

type TripState = 'live' | 'onRoad' | 'soon' | 'scheduled' | 'offline';

type CardTrip = Trip & {
  fix: LiveFix | null;
  state: TripState;
  distanceKm: number | null;
};

type FilterState = {
  show: 'all' | 'onTheWay' | 'upcoming';
  radiusKm: number | null;
};

const DEFAULT_RADIUS_KM = 10;
const RADIUS_OPTIONS: (number | null)[] = [2, 5, 10, 20, null];

type LocStatus = 'loading' | 'granted' | 'denied' | 'unavailable';

const toRad = (d: number) => (d * Math.PI) / 180;
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const formatKm = (km: number) => (km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`);
const radiusLabel = (r: number | null) => (r === null ? 'Any distance' : `${r} km`);
const minutesUntil = (d: Date, now: number) => Math.round((d.getTime() - now) / 60000);

const formatTimeLabel = (dep: Date): string => {
  const diffMin = Math.round((dep.getTime() - Date.now()) / 60000);
  if (diffMin < 0) return 'On the road now';
  if (diffMin < 60) return `Leaves in ${diffMin} mins`;
  if (diffMin < 1440) {
    return `Today at ${dep.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return (
    dep.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' +
    dep.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
};

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { dispatch: scheduleDispatch } = useSchedule();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [fixes, setFixes] = useState<Record<number, LiveFix>>({});
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>({ show: 'all', radiusKm: DEFAULT_RADIUS_KM });
  const [trackRouteId, setTrackRouteId] = useState<number | null>(null);
  const [requesting, setRequesting] = useState(false);

  const [myCoords, setMyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<LocStatus>('loading');

  const fetchTrips = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('provider_routes')
        .select(`
          route_id, departure_time, route_frequency, provider_id,
          provider:users!provider_routes_provider_id_fkey ( user_id, first_name, last_name, is_active ),
          start_location:locations!provider_routes_start_location_id_fkey ( street_address, barangay, city, latitude, longitude ),
          end_location:locations!provider_routes_end_location_id_fkey ( street_address, barangay, city, latitude, longitude ),
          vehicle:vehicles!provider_routes_vehicle_id_fkey ( vehicle_type, max_weight_kg )
        `)
        .order('departure_time', { ascending: true });

      if (error) throw error;

      const mapped: Trip[] = (data || []).map((r: any) => {
        const provider = r.provider || {};
        const vehicle = r.vehicle || {};
        const start = r.start_location || {};
        const end = r.end_location || {};
        const dep = r.departure_time ? new Date(r.departure_time) : new Date();

        const startSplit = splitAddress(start.street_address);
        const endSplit = splitAddress(end.street_address);
        const startSub = [start.barangay, start.city].filter(Boolean).join(', ') || startSplit.sub;
        const endSub = [end.barangay, end.city].filter(Boolean).join(', ') || endSplit.sub;

        return {
          id: String(r.route_id),
          routeId: r.route_id,
          providerId: r.provider_id,
          name: `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'Unknown Provider',
          isActive: !!provider.is_active,
          rating: 4.9,
          pickup: start.street_address || 'Starting point',
          dropoff: end.street_address || 'Destination',
          pickupSub: startSub,
          dropoffSub: endSub,
          pickupCoords: { lat: Number(start.latitude) || 0, lng: Number(start.longitude) || 0 },
          dropoffCoords: { lat: Number(end.latitude) || 0, lng: Number(end.longitude) || 0 },
          timeLabel: formatTimeLabel(dep),
          departureTime: dep,
          vehicleType: vehicle.vehicle_type || 'Vehicle',
          maxWeightKg: vehicle.max_weight_kg != null ? Number(vehicle.max_weight_kg) : null,
        };
      });

      setTrips(mapped);
      setFixes(await fetchLiveFixes(mapped.map((t) => t.providerId)));
    } catch (err) {
      console.error('Error fetching trips:', err);
      setTrips([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const locateMe = useCallback(async () => {
    if (!Location) { setLocStatus('unavailable'); return; }
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') { setLocStatus('denied'); return; }

      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) {
        setMyCoords({ lat: last.coords.latitude, lng: last.coords.longitude });
        setLocStatus('granted');
      }
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setMyCoords({ lat: fresh.coords.latitude, lng: fresh.coords.longitude });
      setLocStatus('granted');
    } catch (e) {
      console.warn('Location error:', e);
      setLocStatus((prev) => (prev === 'granted' ? 'granted' : 'unavailable'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTrips();
      locateMe();
      const unsub = subscribeLiveFixes(({ providerId, fix, deleted }) => {
        setFixes((prev) => {
          if (deleted) {
            if (!(providerId in prev)) return prev;
            const next = { ...prev };
            delete next[providerId];
            return next;
          }
          return fix ? { ...prev, [providerId]: fix } : prev;
        });
      });
      const tick = setInterval(() => setNow(Date.now()), 15_000);
      return () => { unsub(); clearInterval(tick); };
    }, [fetchTrips, locateMe]),
  );

  useEffect(() => { setNow(Date.now()); }, [trips]);

  const onRefresh = () => { setRefreshing(true); fetchTrips(); locateMe(); };

  const cardTrips = useMemo<CardTrip[]>(() => {
    const out: CardTrip[] = [];
    trips.forEach((t) => {
      const fix = fixes[t.providerId] ?? null;
      const live = isFixFresh(fix, now);
      const mins = minutesUntil(t.departureTime, now);

      let state: TripState;
      if (live) state = 'live';
      else if (t.isActive && mins <= 0) state = 'onRoad';
      else if (mins > 0 && mins <= SEND_NOW_WINDOW_MIN) state = 'soon';
      else if (mins > SEND_NOW_WINDOW_MIN) state = 'scheduled';
      else state = 'offline';

      if (state === 'offline' && mins < -HIDE_DEPARTED_AFTER_MIN) return;
      if (state === 'offline') return;

      const ref = live && fix
        ? { lat: fix.latitude, lng: fix.longitude }
        : t.pickupCoords;
      const hasRef = !!(ref.lat || ref.lng);
      const distanceKm = myCoords && hasRef ? haversineKm(myCoords.lat, myCoords.lng, ref.lat, ref.lng) : null;

      out.push({
        ...t,
        timeLabel: formatTimeLabel(t.departureTime),
        fix: live ? fix : null,
        state,
        distanceKm,
      });
    });
    return out;
  }, [trips, fixes, now, myCoords]);

  const filteredTrips = useMemo(() => {
    const list = cardTrips.filter((t) => {
      if (myCoords && filters.radiusKm !== null) {
        if (t.distanceKm === null || t.distanceKm > filters.radiusKm) return false;
      }
      if (filters.show === 'onTheWay' && !(t.state === 'live' || t.state === 'onRoad')) return false;
      if (filters.show === 'upcoming' && !(t.state === 'soon' || t.state === 'scheduled')) return false;
      return true;
    });
    if (myCoords) {
      list.sort((a, b) =>
        (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
        a.departureTime.getTime() - b.departureTime.getTime());
    }
    return list;
  }, [cardTrips, filters, myCoords]);

  const resetFilters = () => setFilters({ show: 'all', radiusKm: DEFAULT_RADIUS_KM });
  const hasActiveFilters = filters.show !== 'all' || filters.radiusKm !== DEFAULT_RADIUS_KM;
  const locationKnown = !!myCoords;

  const trackTrip: (CardTrip & TrackTrip) | null = useMemo(
    () => (trackRouteId == null ? null : (cardTrips.find((t) => t.routeId === trackRouteId) as any) ?? null),
    [trackRouteId, cardTrips],
  );

  const requestAlongRoute = async (trip: TrackTrip) => {
    if (requesting) return;
    setRequesting(true);
    try {
      let coords = myCoords;
      if (!coords) {
        await locateMe();
        coords = myCoords;
      }
      if (!coords && Location) {
        try {
          const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          coords = { lat: p.coords.latitude, lng: p.coords.longitude };
        } catch { /* handled below */ }
      }
      if (!coords) {
        Alert.alert(
          'Location needed',
          'Turn on location so we can use your current position as the pickup point.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      let address = 'My current location';
      try {
        if (Location) {
          const [a] = await Location.reverseGeocodeAsync({ latitude: coords.lat, longitude: coords.lng });
          if (a) {
            const parts = [a.street || a.name, a.district || a.subregion, a.city, a.region].filter(Boolean);
            if (parts.length) address = parts.join(', ');
          }
        }
      } catch { /* keep default */ }

      scheduleDispatch({ type: 'RESET' });
      scheduleDispatch({ type: 'SET_MODE', payload: 'sendNow' });
      scheduleDispatch({
        type: 'SET_PICKUP_LOCATION',
        payload: { address, latitude: coords.lat, longitude: coords.lng },
      });
      scheduleDispatch({
        type: 'SET_PREFERRED_PROVIDER',
        payload: { providerId: trip.providerId, routeId: trip.routeId, name: trip.name },
      });

      setTrackRouteId(null);
      navigation.navigate('DropoffType', { mode: 'sendNow' });
    } finally {
      setRequesting(false);
    }
  };

  const stateBadge = (s: TripState) => {
    switch (s) {
      case 'live':
        return { label: 'On the way · Live', color: colors.success, bg: colors.successBg, icon: 'navigate' as const };
      case 'onRoad':
        return { label: 'On the way', color: ORANGE, bg: colors.accentSoft, icon: 'car-sport-outline' as const };
      case 'soon':
        return { label: 'Leaving soon', color: colors.warning, bg: colors.warningBg, icon: 'time-outline' as const };
      default:
        return { label: 'Scheduled', color: BLUE, bg: 'rgba(59,130,246,0.14)', icon: 'calendar-outline' as const };
    }
  };

  /* ==================================================================== */
  /* Providers Near You Card — TaskScreen style (oCard)                  */
  /* ==================================================================== */
  const renderTripCard = ({ item }: { item: CardTrip }) => {
    const badge = stateBadge(item.state);
    const pickupMain = splitAddress(item.pickup).main;
    const dropoffMain = splitAddress(item.dropoff).main;

    return (
      <TouchableOpacity
        style={styles.oCard}
        activeOpacity={0.92}
        onPress={() => setTrackRouteId(item.routeId)}
      >
        <View style={styles.oPad}>
          {/* Top Row: Vehicle Pill + Status Pill */}
          <View style={styles.oTopRow}>
            <View style={styles.svcPill}>
              <Ionicons name="car-sport-outline" size={14} color={BLUE} />
              <Text style={styles.svcPillText} numberOfLines={1}>{item.vehicleType}</Text>
            </View>
            <View style={[styles.stPill, { backgroundColor: badge.bg }]}>
              <View style={[styles.stDot, { backgroundColor: badge.color }]} />
              <Text style={[styles.stPillText, { color: badge.color }]}>{badge.label.toUpperCase()}</Text>
            </View>
          </View>

          {/* Route Section: Ring + Dotted Line Rail */}
          <View>
            {[
              { key: 'p', label: 'STARTING POINT', main: pickupMain, road: item.pickupSub, color: ORANGE },
              { key: 'd', label: 'DESTINATION', main: dropoffMain, road: item.dropoffSub, color: BLACK },
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

          {/* Mini Contact Row: Courier Identity + Rating */}
          <View style={styles.oContacts}>
            <View style={styles.mcCard}>
              <View style={[styles.mcAvatar, { backgroundColor: BLUE }]}>
                <Text style={styles.mcAvatarText}>{initials(item.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.mcRole}>COURIER PARTNER</Text>
                <Text style={styles.mcName} numberOfLines={1}>{item.name}</Text>
              </View>
              <View style={styles.mcRatingBadge}>
                <Ionicons name="star" size={13} color={colors.warning} />
                <Text style={styles.mcRatingText}>{item.rating}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Footer Row: Departure Time + Capacity + Distance */}
        <View style={styles.oFooter}>
          <View style={styles.oChip}>
            <Ionicons
              name={item.state === 'scheduled' ? 'calendar-outline' : 'time-outline'}
              size={14}
              color={ORANGE}
            />
            <Text style={styles.oChipText} numberOfLines={1}>{item.timeLabel}</Text>
          </View>
          {item.maxWeightKg != null && (
            <View style={styles.oChip}>
              <Ionicons name="cube-outline" size={14} color={ORANGE} />
              <Text style={styles.oChipText}>{item.maxWeightKg} kg</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {item.distanceKm !== null && (
            <Text style={styles.oDistPrice}>{formatKm(item.distanceKm)}</Text>
          )}
        </View>

        {/* Bottom Actions: Track + Request Delivery */}
        <View style={styles.oActions}>
          <TouchableOpacity
            style={styles.oChatBtn}
            onPress={() => setTrackRouteId(item.routeId)}
            activeOpacity={0.85}
          >
            <Ionicons name="navigate-outline" size={16} color={ORANGE} />
            <Text style={styles.oChatText}>Track</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.oRouteBtn}
            onPress={() => requestAlongRoute(item)}
            activeOpacity={0.9}
          >
            <Ionicons name="paper-plane" size={16} color="#FFFFFF" />
            <Text style={styles.oRouteText}>Request Delivery</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const nextRadius = () => RADIUS_OPTIONS.find((r) => r === null || (filters.radiusKm !== null && r > filters.radiusKm)) ?? null;

  const headerEl = (
    <View style={styles.headerContainer}>
      <Text style={styles.pageTitle}>Explore</Text>

      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardPrimary]}
          onPress={() => navigation.navigate('DropoffType', { mode: 'sendNow' })}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconContainer, styles.actionIconPrimary]}>
            <Image
              source={require('../../../../assets/send-package-now.png')}
              style={styles.actionCustomIcon}
              resizeMode="contain"
            />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
            <Text style={styles.actionSubtitlePrimary}>Instant booking & real-time tracking</Text>
          </View>
          <View style={styles.chevronPrimary}>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardSecondary]}
          onPress={() => navigation.navigate('DropoffType', { mode: 'schedule' })}
          activeOpacity={0.85}
        >
          <View style={styles.actionIconContainer}>
            <Image
              source={require('../../../../assets/schedule-delivery-calendar.png')}
              style={styles.actionCustomIcon}
              resizeMode="contain"
            />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitle}>Schedule a Delivery</Text>
            <Text style={styles.actionSubtitle}>Plan shipments for a future date</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {hasActiveFilters && (
        <View style={styles.activeFiltersRow}>
          {filters.show !== 'all' && (
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>
                {filters.show === 'onTheWay' ? 'On the way' : 'Leaving later'}
              </Text>
              <TouchableOpacity onPress={() => setFilters({ ...filters, show: 'all' })}>
                <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          {filters.radiusKm !== DEFAULT_RADIUS_KM && (
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>Within: {radiusLabel(filters.radiusKm)}</Text>
              <TouchableOpacity onPress={() => setFilters({ ...filters, radiusKm: DEFAULT_RADIUS_KM })}>
                <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          <TouchableOpacity onPress={resetFilters}>
            <Text style={styles.clearAllText}>Clear All</Text>
          </TouchableOpacity>
        </View>
      )}

      {locStatus === 'loading' && !locationKnown ? (
        <View style={styles.locBanner}>
          <ActivityIndicator size="small" color={ORANGE} />
          <Text style={styles.locBannerText}>Finding your location…</Text>
        </View>
      ) : locationKnown ? (
        <View style={styles.locBanner}>
          <Ionicons name="location" size={16} color={ORANGE} />
          <Text style={styles.locBannerText}>
            {filters.radiusKm === null
              ? 'Showing providers closest to you'
              : `Providers within ${filters.radiusKm} km of you`}
          </Text>
          <TouchableOpacity onPress={locateMe} hitSlop={10}>
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.locBanner, styles.locBannerWarn]}>
          <Ionicons name="location-outline" size={16} color={colors.error} />
          <Text style={styles.locBannerText}>
            {locStatus === 'denied'
              ? 'Location is off, so all providers are shown. Turn it on to see who is near you.'
              : 'Could not get your location, so all providers are shown.'}
          </Text>
          <TouchableOpacity onPress={locStatus === 'denied' ? () => Linking.openSettings() : locateMe} hitSlop={10}>
            <Text style={styles.locBannerAction}>{locStatus === 'denied' ? 'Settings' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionHeaderRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sectionTitle}>Providers Near You</Text>
          <Text style={styles.sectionSubtitleTight}>
            These providers are already on their way. Tap one to see where they are right now, or request a delivery along their route.
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
        >
          <Ionicons name="options-outline" size={24} color={hasActiveFilters ? ORANGE : colors.textPrimary} />
          {hasActiveFilters && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {loading ? (
        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          {headerEl}
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={ORANGE} />
            <Text style={styles.loadingText}>Finding providers near you...</Text>
          </View>
        </View>
      ) : (
        <FlatList
          data={filteredTrips}
          ListHeaderComponent={headerEl}
          keyExtractor={(item) => item.id}
          renderItem={renderTripCard}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} colors={[ORANGE]} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="car-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {locationKnown && cardTrips.length > 0 ? 'No providers near you' : 'No providers on the road'}
              </Text>
              <Text style={styles.emptySubtext}>
                {cardTrips.length === 0
                  ? 'Nobody is on their way right now. Check back soon.'
                  : locationKnown && filters.radiusKm !== null
                    ? `Nobody is traveling within ${filters.radiusKm} km of you right now.`
                    : 'Try adjusting your filters.'}
              </Text>
              {locationKnown && cardTrips.length > 0 && filters.radiusKm !== null && (
                <TouchableOpacity
                  style={styles.emptyAction}
                  activeOpacity={0.85}
                  onPress={() => setFilters({ ...filters, radiusKm: nextRadius() })}
                >
                  <Text style={styles.emptyActionText}>
                    Widen radius{nextRadius() === null ? ' to any distance' : ` to ${nextRadius()} km`}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      <ProviderTrackModal
        visible={!!trackTrip}
        trip={trackTrip}
        fix={trackTrip ? fixes[trackTrip.providerId] ?? null : null}
        myCoords={myCoords}
        onClose={() => setTrackRouteId(null)}
        onRequest={requestAlongRoute}
      />

      <Modal visible={filterModalVisible} transparent animationType="fade" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setFilterModalVisible(false)} activeOpacity={1} />
          <View style={[styles.filterModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Show</Text>
              <View style={styles.filterOptionsRow}>
                {([
                  { key: 'all', label: 'All' },
                  { key: 'onTheWay', label: 'On the way' },
                  { key: 'upcoming', label: 'Leaving later' },
                ] as const).map((o) => (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.filterOption, filters.show === o.key && styles.filterOptionActive]}
                    onPress={() => setFilters({ ...filters, show: o.key })}
                  >
                    <Text style={[styles.filterOptionText, filters.show === o.key && styles.filterOptionTextActive]}>
                      {o.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Distance from you</Text>
              <View style={styles.filterOptionsRow}>
                {RADIUS_OPTIONS.map((r) => (
                  <TouchableOpacity
                    key={String(r)}
                    style={[styles.filterOption, filters.radiusKm === r && styles.filterOptionActive]}
                    onPress={() => setFilters({ ...filters, radiusKm: r })}
                  >
                    <Text style={[styles.filterOptionText, filters.radiusKm === r && styles.filterOptionTextActive]}>
                      {r === null ? 'Any' : `${r} km`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!locationKnown && (
                <Text style={styles.filterHint}>Turn on location to filter by distance.</Text>
              )}
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
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  headerContainer: { paddingTop: 25, backgroundColor: c.background },
  pageTitle: { fontSize: 30, fontWeight: '800', color: c.textPrimary, marginBottom: 16 },

  /* Same size/layout as the original Home action cards */
  actionContainer: { marginHorizontal: 4, marginBottom: 20 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 18, paddingVertical: 18, paddingHorizontal: 16,
    marginBottom: 14, minHeight: 80,
  },
  actionCardPrimary: {
    backgroundColor: ORANGE, borderWidth: 0,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  actionCardSecondary: {
    backgroundColor: c.card,
    borderWidth: 1.5, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.3,
    shadowRadius: 6, elevation: 2,
  },
  actionIconContainer: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 14,
    borderWidth: 1, borderColor: ORANGE,
  },
  actionIconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  actionCustomIcon: { width: 28, height: 28 },
  actionTextContainer: { flex: 1, paddingRight: 8 },
  actionTitlePrimary: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  actionSubtitlePrimary: { color: 'rgba(255,255,255,0.88)', fontSize: 13, marginTop: 3, fontWeight: '400' },
  actionTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  actionSubtitle: { color: c.textSecondary, fontSize: 13, marginTop: 3, fontWeight: '400' },
  chevronPrimary: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center',
  },

  /* Section header + filter */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  sectionSubtitleTight: { fontSize: 11, color: c.textSecondary, lineHeight: 16 },
  filterBtn: {
    width: 44, height: 44, borderWidth: 1, borderColor: c.border,
    borderRadius: 8, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', position: 'relative',
  },
  filterBtnActive: { borderColor: ORANGE },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  activeFiltersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, gap: 6 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.divider,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16, gap: 4,
  },
  filterChipText: { fontSize: 12, color: c.textSecondary },
  clearAllText: { fontSize: 12, color: ORANGE, fontWeight: '600' },

  locBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentSoft, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14,
  },
  locBannerWarn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  locBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.textPrimary, lineHeight: 16 },
  locBannerAction: { fontSize: 12, fontWeight: '800', color: ORANGE },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  listContainer: { paddingHorizontal: 20, paddingBottom: 100 },

  /* ================================================================== */
  /* Providers Near You Card — TaskScreen style (oCard)                 */
  /* ================================================================== */
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

  oCard: {
    backgroundColor: c.card, borderRadius: 22, marginBottom: 14,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  oPad: { padding: 16 },
  oTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  oContacts: { flexDirection: 'row', gap: 10, marginTop: 14 },
  mcCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.background, borderRadius: 14,
    borderWidth: 1, borderColor: c.divider, padding: 10,
  },
  mcAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mcAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  mcRole: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  mcName: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  mcRatingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10,
  },
  mcRatingText: { fontSize: 12, fontWeight: '800', color: c.textPrimary },

  oFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  oChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10,
  },
  oChipText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  oDistPrice: { fontSize: 16, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.3 },

  oActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  oChatBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 14,
  },
  oChatText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  oRouteBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
  },
  oRouteText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyText: { fontSize: 16, fontWeight: '600', color: c.textSecondary, marginTop: 12 },
  emptySubtext: { fontSize: 13, color: c.textMuted, marginTop: 4, textAlign: 'center' },
  emptyAction: {
    marginTop: 16, paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1.5, borderColor: ORANGE,
  },
  emptyActionText: { color: ORANGE, fontWeight: '800', fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: height * 0.7,
  },
  filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  filterModalTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary },
  filterSection: { marginBottom: 20 },
  filterSectionTitle: { fontSize: 14, fontWeight: '600', color: c.textPrimary, marginBottom: 10 },
  filterOptionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterOption: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
  },
  filterOptionActive: { borderColor: ORANGE, backgroundColor: c.accentSoft },
  filterOptionText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  filterOptionTextActive: { color: ORANGE, fontWeight: '700' },
  filterHint: { fontSize: 11, color: c.textMuted, marginTop: 8 },
  applyFiltersBtn: { backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  applyFiltersBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  resetFiltersBtn: { paddingVertical: 12, alignItems: 'center' },
  resetFiltersBtnText: { color: c.textSecondary, fontWeight: '600', fontSize: 14 },
});