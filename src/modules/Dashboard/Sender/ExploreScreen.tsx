// src/modules/Dashboard/Sender/ExploreScreen.tsx
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  Dimensions, FlatList, RefreshControl, ActivityIndicator,
  Alert, Image, Linking, AppState,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import { useSchedule } from '../Sender/Delivery/ScheduleContext';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { useUser } from '../../../utils/userContext';
import { SolarIcon, SolarIconName } from '../../../components/ui/SolarIcon';
import {
  LiveFix, fetchLiveFixes, subscribeLiveFixes, isFixFresh,
} from '../../../services/providerLiveService';
import { parseNaiveRouteTime } from '../../../services/routeService';
import ProviderTrackModal, { TrackTrip } from './ProviderTrackModal';

let Location: any = null;
try { Location = require('expo-location'); } catch { Location = null; }

const { height } = Dimensions.get('window');
const ORANGE = '#F27024';
const BLUE = '#3B82F6';
const BRAND_ORANGE = '#FF751F';   // same orange as the pickup pin in LiveTrackingScreen

const HIDE_DEPARTED_AFTER_MIN = 180;
const SEND_NOW_WINDOW_MIN = 60;
const HIDE_FINISHED_AFTER_MS = 2 * 60 * 60 * 1000;

const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

const safeTime = (d?: Date | null): number => {
  if (!d) return Infinity;
  try {
    const t = d.getTime?.();
    return typeof t === 'number' && !isNaN(t) ? t : Infinity;
  } catch {
    return Infinity;
  }
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
  endTime?: Date | null;
  vehicleType: string;
  maxWeightKg: number | null;
  routeFrequency: string;
};

type TripState = 'live' | 'onRoad' | 'soon' | 'scheduled' | 'finished' | 'offline';

type CardTrip = Trip & {
  fix: LiveFix | null;
  state: TripState;
  distanceKm: number | null;
};

type FilterState = {
  show: 'all' | 'onTheWay' | 'upcoming';
  radiusKm: number | null;
};

const DEFAULT_RADIUS_KM: number | null = null; // show ALL providers by default (closest first)
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
// departure_time is a naive (no timezone) timestamp in the app's local frame, so compare with a naive local string.
const naiveNowString = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};
// Daily/Weekly routes store the FIRST run's date, so after that day they would look "finished" forever.
// Project them to their current/next run (today's window while it's still going, else the next one).
const occurrenceFor = (
  t: { departureTime: Date; endTime?: Date | null; routeFrequency: string },
  nowMs: number,
): { dep: Date; end: Date } => {
  const dep = t.departureTime;
  const depMs = safeTime(dep);
  const endMs = t.endTime ? safeTime(t.endTime) : Infinity;
  const durMs = endMs !== Infinity && endMs > depMs ? endMs - depMs : 4 * 60 * 60 * 1000;
  const freq = (t.routeFrequency || '').trim().toLowerCase();
  if ((freq !== 'daily' && freq !== 'weekly') || depMs > nowMs) {
    return { dep, end: new Date(depMs + durMs) };
  }
  const today = new Date(nowMs);
  for (let i = 0; i < 8; i++) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, dep.getHours(), dep.getMinutes());
    if (freq === 'weekly' && start.getDay() !== dep.getDay()) continue;
    if (start.getTime() + durMs >= nowMs) return { dep: start, end: new Date(start.getTime() + durMs) };
  }
  return { dep, end: new Date(depMs + durMs) };
};
const minutesUntil = (d: Date, now: number) => Math.round((safeTime(d) - now) / 60000);

const formatTimeLabel = (dep: Date): string => {
  const diffMin = Math.round((safeTime(dep) - Date.now()) / 60000);
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

  // Out-of-order guard: a slow older fetch must never overwrite a newer one.
  const fetchSeqRef = useRef(0);

  const fetchTrips = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
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
          route_id, departure_time, end_time, route_frequency, provider_id, is_selected,
          provider:users!provider_routes_provider_id_fkey ( user_id, first_name, last_name, is_active ),
          start_location:locations!provider_routes_start_location_id_fkey ( place_name, street_address, barangay, city, latitude, longitude ),
          end_location:locations!provider_routes_end_location_id_fkey ( place_name, street_address, barangay, city, latitude, longitude ),
          vehicle:vehicles!provider_routes_vehicle_id_fkey ( vehicle_type, max_weight_kg )
        `)
        .eq('is_deleted', false)
        .eq('is_active', true)
        .eq('is_selected', true)
        .order('departure_time', { ascending: true });

      if (myUserId != null) {
        query = query.neq('provider_id', myUserId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const mapped: Trip[] = (data || [])
        .filter((r: any) => myUserId == null || Number(r.provider_id) !== myUserId)
        .map((r: any) => {
          const provider = r.provider || {};
          const vehicle = r.vehicle || {};
          const start = r.start_location || {};
          const end = r.end_location || {};
          const dep = r.departure_time ? parseNaiveRouteTime(r.departure_time) : new Date();

          let endTimeObj: Date;
          try {
            const parsedEnd = r.end_time ? parseNaiveRouteTime(r.end_time) : null;
            endTimeObj = parsedEnd && !isNaN(parsedEnd.getTime())
              ? parsedEnd
              : new Date(dep.getTime() + 4 * 60 * 60 * 1000);
          } catch {
            endTimeObj = new Date(dep.getTime() + 4 * 60 * 60 * 1000);
          }

          const startTitle = (start.place_name || '').trim() || splitAddress(start.street_address).main;
          const endTitle = (end.place_name || '').trim() || splitAddress(end.street_address).main;
          const startSub = [
            start.street_address && start.street_address !== startTitle ? start.street_address : '',
            start.barangay && start.barangay !== 'Unknown' ? start.barangay : '',
            start.city && start.city !== 'Unknown' ? start.city : '',
          ].filter(Boolean).join(', ');
          const endSub = [
            end.street_address && end.street_address !== endTitle ? end.street_address : '',
            end.barangay && end.barangay !== 'Unknown' ? end.barangay : '',
            end.city && end.city !== 'Unknown' ? end.city : '',
          ].filter(Boolean).join(', ');

          return {
            id: String(r.route_id),
            routeId: r.route_id,
            providerId: Number(r.provider_id),
            name: `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'Unknown Provider',
            isActive: !!provider.is_active,
            rating: 4.9,
            pickup: startTitle || 'Starting point',
            dropoff: endTitle || 'Destination',
            pickupSub: startSub,
            dropoffSub: endSub,
            pickupCoords: { lat: Number(start.latitude) || 0, lng: Number(start.longitude) || 0 },
            dropoffCoords: { lat: Number(end.latitude) || 0, lng: Number(end.longitude) || 0 },
            timeLabel: formatTimeLabel(dep),
            departureTime: dep,
            endTime: endTimeObj,
            vehicleType: vehicle.vehicle_type || 'Vehicle',
            maxWeightKg: vehicle.max_weight_kg != null ? Number(vehicle.max_weight_kg) : null,
            routeFrequency: r.route_frequency || 'Daily',
          };
        });

      if (seq !== fetchSeqRef.current) return;
      setTrips(mapped);
      const liveFixes = await fetchLiveFixes(mapped.map((t) => t.providerId));
      if (seq !== fetchSeqRef.current) return;
      setFixes(liveFixes);
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

      // REALTIME: a provider switching their selected route (or posting / ending one) flips
      // provider_routes.is_selected / is_active / is_deleted. Refetch silently, debounced so the
      // two-step is_selected swap lands as one update instead of flickering.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const refetch = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => { void fetchTrips(); }, 350);
      };
      let firstSubscribe = true;
      const channel = supabase
        .channel(`explore-routes-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes' }, refetch)
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            if (firstSubscribe) { firstSubscribe = false; return; }
            refetch();   // reconnected: catch up on anything missed
          }
        });
      const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') refetch(); });

      return () => {
        unsub();
        clearInterval(tick);
        if (debounce) clearTimeout(debounce);
        supabase.removeChannel(channel);
        appSub.remove();
      };
    }, [fetchTrips, locateMe]),
  );

  useEffect(() => { setNow(Date.now()); }, [trips]);

  const onRefresh = () => { setRefreshing(true); fetchTrips(); locateMe(); };

  const cardTrips = useMemo<CardTrip[]>(() => {
    const myUserId = user?.user_id != null ? Number(user.user_id) : null;
    const out: CardTrip[] = [];
    trips.forEach((t) => {
      if (myUserId != null && t.providerId === myUserId) return;

      // current/next run of this route (matters for Daily/Weekly routes)
      const occ = occurrenceFor(t, now);

      const fix = fixes[t.providerId] ?? null;
      const live = isFixFresh(fix, now);
      const mins = minutesUntil(occ.dep, now);

      const endTimeMs = safeTime(occ.end);
      const isFinished = endTimeMs !== Infinity && now > endTimeMs;

      let state: TripState;
      if (live) state = 'live';
      else if (isFinished) state = 'finished';
      else if (t.isActive && mins <= 0) state = 'onRoad';
      else if (mins > 0 && mins <= SEND_NOW_WINDOW_MIN) state = 'soon';
      else if (mins > SEND_NOW_WINDOW_MIN) state = 'scheduled';
      else state = 'offline';

      if (state === 'finished' && endTimeMs !== Infinity && now > endTimeMs + HIDE_FINISHED_AFTER_MS) return;
      // 'offline' (provider not online yet) routes are still listed so every provider route is visible

      const ref = live && fix
        ? { lat: fix.latitude, lng: fix.longitude }
        : t.pickupCoords;
      const hasRef = !!(ref.lat || ref.lng);
      const distanceKm = myCoords && hasRef ? haversineKm(myCoords.lat, myCoords.lng, ref.lat, ref.lng) : null;

      out.push({
        ...t,
        departureTime: occ.dep,
        endTime: occ.end,
        timeLabel: formatTimeLabel(occ.dep),
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
      list.sort((a, b) => {
        const distDiff = (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
        if (distDiff !== 0) return distDiff;
        return safeTime(a.departureTime) - safeTime(b.departureTime);
      });
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
    if ((trip as any).state === 'finished') {
      Alert.alert('Route Finished', 'This provider has already arrived at their destination and cannot accept new deliveries on this route.');
      return;
    }

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

  const stateBadge = (s: TripState): { label: string; color: string; bg: string; icon: SolarIconName } => {
    switch (s) {
      case 'live':
        return { label: 'On the way', color: colors.success, bg: colors.successBg, icon: 'Routing' };
      case 'onRoad':
        return { label: 'On the way', color: ORANGE, bg: colors.accentSoft, icon: 'Package' };
      case 'soon':
        return { label: 'Leaving soon', color: colors.warning, bg: colors.warningBg, icon: 'Clock' };
      case 'offline':
        return { label: 'Not online yet', color: isDark ? '#94A3B8' : '#64748B', bg: isDark ? 'rgba(148,163,184,0.18)' : '#F1F5F9', icon: 'Clock' };
      case 'finished':
        return {
          label: 'Route Finished',
          color: isDark ? '#94A3B8' : '#64748B',
          bg: isDark ? 'rgba(148,163,184,0.18)' : '#F1F5F9',
          icon: 'Flag',
        };
      default:
        return { label: 'Scheduled', color: BLUE, bg: 'rgba(59,130,246,0.14)', icon: 'Calendar' };
    }
  };

  const renderTripCard = ({ item }: { item: CardTrip }) => {
    const badge = stateBadge(item.state);
    const pickupMain = splitAddress(item.pickup).main;
    const dropoffMain = splitAddress(item.dropoff).main;
    const isFinished = item.state === 'finished';
    const timeIcon: SolarIconName = isFinished ? 'Flag' : item.state === 'scheduled' ? 'Calendar' : 'Clock';

    return (
      <TouchableOpacity
        style={[styles.tcCard, isFinished && { opacity: 0.65 }]}
        activeOpacity={0.92}
        onPress={() => setTrackRouteId(item.routeId)}
      >
        {/* Status + distance */}
        <View style={styles.tcTopRow}>
          <View style={[styles.tcStatusPill, { backgroundColor: badge.bg }]}>
            <SolarIcon name={badge.icon} variant="bold" size={12} color={badge.color} />
            <Text style={[styles.tcStatusText, { color: badge.color }]} numberOfLines={1}>{badge.label}</Text>
          </View>
          {item.distanceKm !== null && (
            <View style={styles.tcDistance}>
              <SolarIcon name="MapPoint" variant="bold" size={14} color={isFinished ? colors.textMuted : colors.accent} />
              <Text style={styles.tcDistanceText}>{formatKm(item.distanceKm)} away</Text>
            </View>
          )}
        </View>

        {/* Provider */}
        <View style={styles.tcProfile}>
          <View style={[styles.tcAvatar, isFinished && { backgroundColor: '#94A3B8' }]}>
            <Text style={styles.tcAvatarText}>{initials(item.name)}</Text>
          </View>
          <View style={styles.tcProfileText}>
            <Text style={styles.tcName} numberOfLines={1}>{item.name}</Text>
            <View style={styles.tcMetaRow}>
              <SolarIcon name="Star" variant="bold" size={13} color={colors.warning} />
              <Text style={styles.tcMetaStrong}>{item.rating}</Text>
              <Text style={styles.tcMetaDot}>•</Text>
              <Text style={styles.tcMeta} numberOfLines={1}>{item.vehicleType}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tcDivider} />

        {/* Route timeline */}
        <View style={styles.tcTlRow}>
          <View style={styles.tcTlRail}>
            <View style={styles.tcPickIcon}>
              <SolarIcon name="MapPoint" variant="bold" size={18} color="#FFFFFF" />
            </View>
            <View style={styles.tcTlLine} />
          </View>
          <View style={styles.tcTlBody}>
            <Text style={styles.tcTlLabel}>START</Text>
            <Text style={styles.tcTlTitle} numberOfLines={1}>{pickupMain}</Text>
            {!!item.pickupSub && <Text style={styles.tcTlSub} numberOfLines={1}>{item.pickupSub}</Text>}
          </View>
        </View>

        <View style={styles.tcTlRow}>
          <View style={styles.tcTlRail}>
            <View style={styles.tcDropIcon}>
              <SolarIcon name="Flag" variant="bold" size={16} color="#000000" />
            </View>
          </View>
          <View style={[styles.tcTlBody, { paddingBottom: 0 }]}>
            <Text style={styles.tcTlLabel}>DESTINATION</Text>
            <Text style={styles.tcTlTitle} numberOfLines={1}>{dropoffMain}</Text>
            {!!item.dropoffSub && <Text style={styles.tcTlSub} numberOfLines={1}>{item.dropoffSub}</Text>}
          </View>
        </View>

        {/* Departure + capacity */}
        <View style={styles.tcInfo}>
          <View style={styles.tcInfoCell}>
            <SolarIcon name={timeIcon} variant="bold" size={16} color={isFinished ? colors.textMuted : colors.accent} />
            <View style={styles.tcInfoText}>
              <Text style={styles.tcInfoLabel}>{isFinished ? 'STATUS' : 'DEPARTURE'}</Text>
              <Text style={styles.tcInfoValue} numberOfLines={1}>{isFinished ? 'Arrived' : item.timeLabel}</Text>
            </View>
          </View>
          {item.maxWeightKg != null && (
            <>
              <View style={styles.tcInfoSep} />
              <View style={styles.tcInfoCell}>
                <SolarIcon name="Package" variant="bold" size={16} color={isFinished ? colors.textMuted : colors.accent} />
                <View style={styles.tcInfoText}>
                  <Text style={styles.tcInfoLabel}>CAPACITY</Text>
                  <Text style={styles.tcInfoValue} numberOfLines={1}>{item.maxWeightKg} kg</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Actions */}
        <View style={styles.tcActions}>
          <TouchableOpacity style={styles.tcViewBtn} onPress={() => setTrackRouteId(item.routeId)} activeOpacity={0.85}>
            <SolarIcon name="Routing" variant="duotone" size={16} color={colors.accent} />
            <Text style={styles.tcViewText}>View</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tcRequestBtn, isFinished && { backgroundColor: '#94A3B8' }]}
            onPress={() => requestAlongRoute(item)}
            activeOpacity={0.9}
          >
            <SolarIcon name={isFinished ? 'CloseCircle' : 'PaperPlane'} variant="duotone" size={16} color="#FFFFFF" />
            <Text style={styles.tcRequestText} numberOfLines={1}>
              {isFinished ? 'Route Finished' : 'Request Delivery'}
            </Text>
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
            <Text style={styles.actionTitlePrimary}>Send Package Today</Text>
            <Text style={styles.actionSubtitlePrimary}>Instant booking & real-time tracking</Text>
          </View>
          <View style={styles.chevronPrimary}>
            <SolarIcon name="AltArrowRight" variant="linear" size={18} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

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
          <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
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
                <SolarIcon name="CloseCircle" variant="linear" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          {filters.radiusKm !== DEFAULT_RADIUS_KM && (
            <View style={styles.filterChip}>
              <Text style={styles.filterChipText}>Within: {radiusLabel(filters.radiusKm)}</Text>
              <TouchableOpacity onPress={() => setFilters({ ...filters, radiusKm: DEFAULT_RADIUS_KM })}>
                <SolarIcon name="CloseCircle" variant="linear" size={14} color={colors.textSecondary} />
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
          <SolarIcon name="Routing" variant="duotone" size={16} color={ORANGE} />
          <Text style={styles.locBannerText}>
            {filters.radiusKm === null ? 'Showing all providers, closest first' : `Providers within ${filters.radiusKm} km of you`}
          </Text>
          <TouchableOpacity onPress={locateMe} hitSlop={10}>
            <SolarIcon name="Refresh" variant="linear" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.locBanner, styles.locBannerWarn]}>
          <SolarIcon name="MapPoint" variant="bold" size={16} color={colors.error} />
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
          <SolarIcon name="Settings" variant="duotone" size={22} color={hasActiveFilters ? ORANGE : colors.textPrimary} />
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

      {!!trackTrip && (
        <ProviderTrackModal
          visible={!!trackTrip}
          trip={trackTrip}
          fix={trackTrip ? fixes[trackTrip.providerId] ?? null : null}
          myCoords={myCoords}
          onClose={() => setTrackRouteId(null)}
          onRequest={requestAlongRoute}
        />
      )}

      <Modal visible={filterModalVisible} transparent animationType="slide" onRequestClose={() => setFilterModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setFilterModalVisible(false)} activeOpacity={1} />
          <View style={[styles.filterModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <SolarIcon name="CloseCircle" variant="linear" size={24} color={colors.textPrimary} />
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
  pageTitle: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    marginBottom: 20,
    letterSpacing: -0.3,
  },

  actionContainer: { marginHorizontal: 4, marginBottom: 20 },
  actionCard: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 20, paddingVertical: 18, paddingHorizontal: 16,
    marginBottom: 14, minHeight: 80,
  },
  actionCardPrimary: {
    backgroundColor: c.accent,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 1,
  },
  actionCardSecondary: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 1,
    elevation: 0,
  },
  actionIconContainer: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
    marginRight: 14, borderWidth: 1, borderColor: c.accent,
  },
  actionIconPrimary: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.35)' },
  actionCustomIcon: { width: 32, height: 32 },
  actionTextContainer: { flex: 1, paddingRight: 8 },
  actionTitlePrimary: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: -0.3,
  },
  actionSubtitlePrimary: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    marginTop: 3,
    fontFamily: 'Poppins_400Regular',
  },
  actionTitle: {
    color: c.textPrimary,
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: -0.3,
  },
  actionSubtitle: {
    color: c.textSecondary,
    fontSize: 13,
    marginTop: 3,
    fontFamily: 'Poppins_400Regular',
  },
  chevronPrimary: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center', alignItems: 'center',
  },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  sectionTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  sectionSubtitleTight: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
    lineHeight: 20,
  },
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
  filterChipText: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
  },
  clearAllText: {
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
    color: c.accent,
  },
  locBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  locBannerWarn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  locBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textPrimary,
    lineHeight: 16,
  },
  locBannerAction: {
    fontSize: 12,
    fontFamily: 'Poppins_700Bold',
    color: c.accent,
  },

  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
  },
  listContainer: { paddingHorizontal: 20, paddingBottom: 100 },

  /* ---------- TRIP CARD (matches LiveTrackingScreen card language) ---------- */
  tcCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 8,
    elevation: isDark ? 0 : 1,
  },
  tcTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 },
  tcStatusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, flexShrink: 1,
  },
  tcStatusText: { fontSize: 11, fontFamily: 'Poppins_700Bold', textTransform: 'uppercase', letterSpacing: 0.3, flexShrink: 1 },
  tcDistance: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  tcDistanceText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },

  tcProfile: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tcAvatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: c.success,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  tcAvatarText: { color: '#FFFFFF', fontFamily: 'Poppins_800ExtraBold', fontSize: 16 },
  tcProfileText: { flex: 1, minWidth: 0 },
  tcName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  tcMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  tcMetaStrong: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  tcMetaDot: { fontSize: 12, color: c.textMuted },
  tcMeta: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, flexShrink: 1 },

  tcDivider: { height: 1, backgroundColor: c.border, marginVertical: 14 },

  tcTlRow: { flexDirection: 'row', gap: 12 },
  tcTlRail: { width: 34, alignItems: 'center' },
  tcPickIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND_ORANGE,
    alignItems: 'center', justifyContent: 'center',
  },
  tcDropIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center',
  },
  tcTlLine: { flex: 1, width: 2, backgroundColor: c.border, marginTop: 4, marginBottom: -4 },
  tcTlBody: { flex: 1, minWidth: 0, paddingBottom: 14 },
  tcTlLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  tcTlTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  tcTlSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 1 },

  tcInfo: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.background, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
    marginTop: 14,
  },
  tcInfoCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  tcInfoSep: { width: 1, alignSelf: 'stretch', backgroundColor: c.border, marginHorizontal: 12 },
  tcInfoText: { flex: 1, minWidth: 0 },
  tcInfoLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.6 },
  tcInfoValue: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },

  tcActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  tcViewBtn: {
    flex: 1, height: 48, borderRadius: 24, backgroundColor: c.accentSoft,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  tcViewText: { color: c.accent, fontSize: 14, fontFamily: 'Poppins_700Bold' },
  tcRequestBtn: {
    flex: 2, height: 48, borderRadius: 24, backgroundColor: c.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8,
  },
  tcRequestText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold', flexShrink: 1 },

  /* Empty state */
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingTop: 40 },
  emptyImage: { width: 140, height: 140, marginBottom: 16 },
  emptyText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
  },
  emptyAction: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 24, backgroundColor: c.accentSoft,
  },
  emptyActionText: {
    color: c.accent,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
  },

  /* Filter modal */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  filterModal: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24, maxHeight: height * 0.7,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  filterModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  filterModalTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    letterSpacing: -0.2,
  },
  filterSection: { marginBottom: 24 },
  filterSectionTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textPrimary,
    marginBottom: 12,
  },
  filterOptionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterOption: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', backgroundColor: c.card,
  },
  filterOptionActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
  filterOptionText: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textSecondary,
  },
  filterOptionTextActive: {
    color: c.accent,
    fontFamily: 'Poppins_600SemiBold',
  },
  filterHint: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: c.textMuted,
    marginTop: 8,
  },
  applyFiltersBtn: {
    backgroundColor: c.accent,
    borderRadius: 12,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  applyFiltersBtnText: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
  },
  resetFiltersBtn: { paddingVertical: 14, alignItems: 'center' },
  resetFiltersBtnText: {
    color: c.textSecondary,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
  },
});