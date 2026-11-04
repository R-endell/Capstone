// src/modules/Dashboard/Sender/ExploreScreen.tsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Dimensions, FlatList, RefreshControl, ActivityIndicator,
  Alert, Image, Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import { useSchedule } from '../Sender/Delivery/ScheduleContext';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { useUser } from '../../../utils/userContext';
import { PhIcon } from '../../../components/ui/PhIcon';
import {
  LiveFix, fetchLiveFixes, subscribeLiveFixes, isFixFresh,
} from '../../../services/providerLiveService';
import ProviderTrackModal, { TrackTrip } from './ProviderTrackModal';

let Location: any = null;
try { Location = require('expo-location'); } catch { Location = null; }

const { height } = Dimensions.get('window');
const ORANGE = '#F27024';
const BLUE = '#3B82F6';

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
  routeFrequency: string;
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
  const { user } = useUser();

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
      let myUserId: number | null = user?.user_id != null ? Number(user.user_id) : null;
      if (myUserId == null) {
        const { data: authData } = await supabase.auth.getUser();
        const authId = authData?.user?.id;
        if (authId) {
          const { data: userRow } = await supabase
            .from('users')
            .select('user_id')
            .eq('auth_id', authId)
            .maybeSingle();
          if (userRow?.user_id != null) {
            myUserId = Number(userRow.user_id);
          }
        }
      }

      let query = supabase
        .from('provider_routes')
        .select(`
          route_id, departure_time, route_frequency, provider_id,
          provider:users!provider_routes_provider_id_fkey ( user_id, first_name, last_name, is_active ),
          start_location:locations!provider_routes_start_location_id_fkey ( street_address, barangay, city, latitude, longitude ),
          end_location:locations!provider_routes_end_location_id_fkey ( street_address, barangay, city, latitude, longitude ),
          vehicle:vehicles!provider_routes_vehicle_id_fkey ( vehicle_type, max_weight_kg )
        `)
        .order('departure_time', { ascending: true });

      if (myUserId != null) {
        query = query.neq('provider_id', myUserId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped: Trip[] = (data || [])
        .filter((r: any) => myUserId == null || Number(r.provider_id) !== myUserId)
        .filter((r: any) => {
          const freq = (r.route_frequency || '').trim().toLowerCase();
          if (freq === 'one-time' || freq === 'custom') {
            const dep = r.departure_time ? new Date(r.departure_time) : new Date();
            if (dep.getTime() < Date.now()) return false;
          }
          return true;
        })
        .map((r: any) => {
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
            providerId: Number(r.provider_id),
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
            routeFrequency: r.route_frequency || 'Daily',
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
  }, [user?.user_id]);

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
    const myUserId = user?.user_id != null ? Number(user.user_id) : null;
    const out: CardTrip[] = [];
    trips.forEach((t) => {
      if (myUserId != null && t.providerId === myUserId) return;

      const freq = (t.routeFrequency || '').trim().toLowerCase();
      if (freq === 'one-time' || freq === 'custom') {
        if (t.departureTime.getTime() < now) return;
      }

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
  }, [trips, fixes, now, myCoords, user?.user_id]);

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
      const startCoords = trip.pickupCoords?.lat && trip.pickupCoords?.lng
        ? trip.pickupCoords
        : myCoords;

      if (!startCoords) {
        Alert.alert(
          'Location needed',
          'Turn on location so we can set up your pickup point along this route.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      scheduleDispatch({ type: 'RESET' });
      scheduleDispatch({ type: 'SET_MODE', payload: 'sendNow' });
      scheduleDispatch({
        type: 'SET_PICKUP_LOCATION',
        payload: {
          address: trip.pickup || 'Point A along route',
          latitude: startCoords.lat,
          longitude: startCoords.lng,
        },
      });
      scheduleDispatch({
        type: 'SET_PREFERRED_PROVIDER',
        payload: {
          providerId: trip.providerId,
          routeId: trip.routeId,
          name: trip.name,
          route: {
            pickup: trip.pickup,
            dropoff: trip.dropoff,
            pickupCoords: trip.pickupCoords,
            dropoffCoords: trip.dropoffCoords,
          },
        },
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
        return { label: 'On the way', color: colors.success, bg: colors.successBg, icon: 'NavigationArrow' as const };
      case 'onRoad':
        return { label: 'On the way', color: ORANGE, bg: colors.accentSoft, icon: 'Package' as const };
      case 'soon':
        return { label: 'Leaving soon', color: colors.warning, bg: colors.warningBg, icon: 'Clock' as const };
      default:
        return { label: 'Scheduled', color: BLUE, bg: 'rgba(59,130,246,0.14)', icon: 'Clock' as const };
    }
  };

  const renderTripCard = ({ item }: { item: CardTrip }) => {
    const badge = stateBadge(item.state);
    const pickupMain = splitAddress(item.pickup).main;
    const dropoffMain = splitAddress(item.dropoff).main;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.92}
        onPress={() => setTrackRouteId(item.routeId)}
      >
        <View style={styles.cardPad}>
          <View style={styles.cardTopRow}>
            <View style={styles.vehiclePill}>
              <PhIcon name="Package" size={14} color={BLUE} />
              <Text style={styles.vehiclePillText} numberOfLines={1}>{item.vehicleType}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
              <PhIcon name={badge.icon} size={12} color={badge.color} />
              <Text style={[styles.statusPillText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          </View>

          <View style={styles.routeContainer}>
            {[
              { key: 'p', label: 'START', main: pickupMain, sub: item.pickupSub, color: ORANGE },
              { key: 'd', label: 'DESTINATION', main: dropoffMain, sub: item.dropoffSub, color: colors.textPrimary },
            ].map((r, i) => (
              <View key={r.key} style={styles.routeRow}>
                <View style={styles.routeRail}>
                  <View style={[styles.routeRing, { borderColor: r.color }]}>
                    <View style={[styles.routeRingDot, { backgroundColor: r.color }]} />
                  </View>
                  {i === 0 && (
                    <View style={styles.routeDots}>
                      {[0, 1, 2].map(k => <View key={k} style={styles.routeDot} />)}
                    </View>
                  )}
                </View>
                <View style={[styles.routeTextWrap, i === 0 && { paddingBottom: 16 }]}>
                  <Text style={styles.routeLabel}>{r.label}</Text>
                  <Text style={styles.routeMain} numberOfLines={1}>{r.main}</Text>
                  {!!r.sub && (
                    <Text style={styles.routeSub} numberOfLines={1}>{r.sub}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.courierCard}>
            <View style={[styles.courierAvatar, { backgroundColor: BLUE }]}>
              <Text style={styles.courierAvatarText}>{initials(item.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.courierRole}>COURIER PARTNER</Text>
              <Text style={styles.courierName} numberOfLines={1}>{item.name}</Text>
            </View>
            <View style={styles.ratingBadge}>
              <PhIcon name="Star" weight="fill" size={12} color={colors.warning} />
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.infoPill}>
            <PhIcon name={item.state === 'scheduled' ? 'Clock' : 'Clock'} size={14} color={ORANGE} />
            <Text style={styles.infoPillText} numberOfLines={1}>{item.timeLabel}</Text>
          </View>
          {item.maxWeightKg != null && (
            <View style={styles.infoPill}>
              <PhIcon name="Package" size={14} color={ORANGE} />
              <Text style={styles.infoPillText}>{item.maxWeightKg} kg</Text>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {item.distanceKm !== null && (
            <Text style={styles.distanceText}>{formatKm(item.distanceKm)}</Text>
          )}
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.trackBtn}
            onPress={() => setTrackRouteId(item.routeId)}
            activeOpacity={0.85}
          >
            <PhIcon name="NavigationArrow" size={16} color={ORANGE} />
            <Text style={styles.trackBtnText}>Track</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.requestBtn}
            onPress={() => requestAlongRoute(item)}
            activeOpacity={0.9}
          >
            <PhIcon name="PaperPlaneTilt" weight="fill" size={16} color="#FFFFFF" />
            <Text style={styles.requestBtnText}>Request Delivery</Text>
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
        {/* PRIMARY CTA */}
        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardPrimary]}
          onPress={() => {
            scheduleDispatch({ type: 'RESET' });
            navigation.navigate('SendNowIntro');
          }}
          activeOpacity={0.85}
        >
          <View style={[styles.actionIconContainer, styles.actionIconPrimary]}>
            <Image source={require('../../../../assets/package-icon.png')} style={styles.actionCustomIcon} resizeMode="contain" />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
            <Text style={styles.actionSubtitlePrimary}>Instant booking & real-time tracking</Text>
          </View>
          <View style={styles.chevronPrimary}>
            <PhIcon name="CaretRight" size={18} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* SECONDARY CTA - NOW USING schedule-icon.png */}
        <TouchableOpacity
          style={[styles.actionCard, styles.actionCardSecondary]}
          onPress={() => {
            scheduleDispatch({ type: 'RESET' });
            navigation.navigate('ScheduleIntro');
          }}
          activeOpacity={0.85}
        >
          <View style={styles.actionIconContainer}>
            <Image 
              source={require('../../../../assets/schedule-icon.png')} 
              style={styles.actionCustomIcon} 
              resizeMode="contain" 
            />
          </View>
          <View style={styles.actionTextContainer}>
            <Text style={styles.actionTitle}>Schedule a Delivery</Text>
            <Text style={styles.actionSubtitle}>Plan shipments for a future date</Text>
          </View>
          <PhIcon name="CaretRight" size={18} color={colors.textMuted} />
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
                <PhIcon name="X" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          {filters.radiusKm !== DEFAULT_RADIUS_KM && (
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>Within: {radiusLabel(filters.radiusKm)}</Text>
              <TouchableOpacity onPress={() => setFilters({ ...filters, radiusKm: DEFAULT_RADIUS_KM })}>
                <PhIcon name="X" size={14} color={colors.textSecondary} />
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
          <PhIcon name="NavigationArrow" size={16} color={ORANGE} />
          <Text style={styles.locBannerText}>
            {filters.radiusKm === null ? 'Showing providers closest to you' : `Providers within ${filters.radiusKm} km of you`}
          </Text>
          <TouchableOpacity onPress={locateMe} hitSlop={10}>
            <PhIcon name="ArrowsClockwise" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.locBanner, styles.locBannerWarn]}>
          <PhIcon name="MapPinLine" size={16} color={colors.error} />
          <Text style={styles.locBannerText}>
            {locStatus === 'denied' ? 'Location is off, so all providers are shown.' : 'Could not get your location.'}
          </Text>
          <TouchableOpacity onPress={locStatus === 'denied' ? () => Linking.openSettings() : locateMe} hitSlop={10}>
            <Text style={styles.locBannerAction}>{locStatus === 'denied' ? 'Settings' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.sectionHeaderRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sectionTitle}>Providers Near You</Text>
          <Text style={styles.sectionSubtitleTight}>Tap a provider to see their live location and request a delivery.</Text>
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]}
          onPress={() => setFilterModalVisible(true)}
        >
          <PhIcon name="Gear" size={22} color={hasActiveFilters ? ORANGE : colors.textPrimary} />
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
              {/* EMPTY STATE NOW USING empty-box-icon.png */}
              <Image 
                source={require('../../../../assets/empty-box-icon.png')} 
                style={styles.emptyImage} 
                resizeMode="contain" 
              />
              <Text style={styles.emptyText}>
                {locationKnown && cardTrips.length > 0 ? 'No providers near you' : 'No providers on the road'}
              </Text>
              <Text style={styles.emptySubtext}>
                {cardTrips.length === 0
                  ? 'Nobody is traveling right now. Check back soon!'
                  : locationKnown && filters.radiusKm !== null
                    ? `Nobody is traveling within ${filters.radiusKm} km of you right now.`
                    : 'Try adjusting your filters.'}
              </Text>
              {locationKnown && cardTrips.length > 0 && filters.radiusKm !== null && (
                <TouchableOpacity style={styles.emptyAction} activeOpacity={0.85} onPress={() => setFilters({ ...filters, radiusKm: nextRadius() })}>
                  <Text style={styles.emptyActionText}>Widen radius{nextRadius() === null ? ' to any distance' : ` to ${nextRadius()} km`}</Text>
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

      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setFilterModalVisible(false)} activeOpacity={1} />
          <View style={[styles.filterModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <PhIcon name="X" size={24} color={colors.textPrimary} />
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
              {!locationKnown && <Text style={styles.filterHint}>Turn on location to filter by distance.</Text>}
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
  pageTitle: { fontSize: 32, fontWeight: '800', color: c.textPrimary, marginBottom: 20, letterSpacing: -0.5 },

  /* Action Cards */
  actionContainer: { marginHorizontal: 4, marginBottom: 20 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingVertical: 18, paddingHorizontal: 16,
    marginBottom: 14, minHeight: 80,
  },
  actionCardPrimary: {
    backgroundColor: c.accent, borderWidth: 0,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 6,
  },
  actionCardSecondary: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 8, elevation: 2,
  },
  actionIconContainer: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
    marginRight: 14, borderWidth: 1, borderColor: c.accent,
  },
  actionIconPrimary: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.35)' },
  actionCustomIcon: { width: 32, height: 32 }, // Adjusted for PNG icons
  actionTextContainer: { flex: 1, paddingRight: 8 },
  actionTitlePrimary: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  actionSubtitlePrimary: { color: 'rgba(255,255,255,0.88)', fontSize: 13, marginTop: 3, fontWeight: '400' },
  actionTitle: { color: c.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.3 },
  actionSubtitle: { color: c.textSecondary, fontSize: 13, marginTop: 3, fontWeight: '400' },
  chevronPrimary: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center',
  },

  /* Section Header */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  sectionSubtitleTight: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  filterBtn: {
    width: 44, height: 44, borderWidth: 1, borderColor: c.border,
    borderRadius: 12, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center', position: 'relative',
  },
  filterBtnActive: { borderColor: c.accent },
  filterDot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent },

  /* Filters & Banners */
  activeFiltersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, gap: 6 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.divider,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, gap: 4,
  },
  filterChipText: { fontSize: 12, color: c.textSecondary },
  clearAllText: { fontSize: 12, color: c.accent, fontWeight: '600' },
  locBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.accentSoft, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16,
  },
  locBannerWarn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  locBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.textPrimary, lineHeight: 16 },
  locBannerAction: { fontSize: 12, fontWeight: '800', color: c.accent },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  listContainer: { paddingHorizontal: 20, paddingBottom: 100 },

  /* Provider Card */
  card: {
    backgroundColor: c.card, borderRadius: 22, marginBottom: 16,
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  cardPad: { padding: 16 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  vehiclePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(59,130,246,0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  vehiclePillText: { fontSize: 12, fontWeight: '700', color: BLUE },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  statusPillText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },

  routeContainer: { marginBottom: 16 },
  routeRow: { flexDirection: 'row', gap: 14 },
  routeRail: { alignItems: 'center', width: 24 },
  routeRing: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.card,
  },
  routeRingDot: { width: 8, height: 8, borderRadius: 4 },
  routeDots: { position: 'absolute', top: 26, bottom: -4, alignItems: 'center', justifyContent: 'space-evenly' },
  routeDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: c.border },
  routeTextWrap: { flex: 1 },
  routeLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.5 },
  routeMain: { fontSize: 16, fontWeight: '800', color: c.textPrimary, marginTop: 1 },
  routeSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },

  courierCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.background, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: c.divider,
  },
  courierAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  courierAvatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  courierRole: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.5 },
  courierName: { fontSize: 14, fontWeight: '700', color: c.textPrimary },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.card, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: c.border,
  },
  ratingText: { fontSize: 12, fontWeight: '800', color: c.textPrimary },

  cardFooter: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.background, paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  infoPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: c.border,
  },
  infoPillText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  distanceText: { fontSize: 15, fontWeight: '800', color: c.textPrimary },

  cardActions: { flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: c.divider },
  trackBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 14,
  },
  trackBtnText: { color: c.accent, fontSize: 14, fontWeight: '800' },
  requestBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14,
  },
  requestBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  
  // Updated empty state styles to fit the new 3D image
  emptyImage: {
    width: 140,
    height: 140,
    marginBottom: 16,
  },
  
  emptyText: { fontSize: 17, fontWeight: '700', color: c.textPrimary, marginBottom: 6 },
  emptySubtext: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 },
  emptyAction: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, backgroundColor: c.accentSoft,
  },
  emptyActionText: { color: c.accent, fontWeight: '700', fontSize: 13 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, maxHeight: height * 0.7,
  },
  filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  filterModalTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary },
  filterSection: { marginBottom: 24 },
  filterSectionTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 12 },
  filterOptionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterOption: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
  },
  filterOptionActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
  filterOptionText: { fontSize: 14, color: c.textSecondary, fontWeight: '500' },
  filterOptionTextActive: { color: c.accent, fontWeight: '700' },
  filterHint: { fontSize: 12, color: c.textMuted, marginTop: 8 },
  applyFiltersBtn: { backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  applyFiltersBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  resetFiltersBtn: { paddingVertical: 14, alignItems: 'center' },
  resetFiltersBtnText: { color: c.textSecondary, fontWeight: '600', fontSize: 14 },
});