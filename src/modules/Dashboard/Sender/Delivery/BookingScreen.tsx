// src/modules/Dashboard/Sender/Delivery/BookingScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, StatusBar,
  Alert, Easing, ScrollView, Dimensions, ActivityIndicator, Platform,
} from 'react-native';
import RoutePreviewMap from '../../../../components/map/RoutePreviewMap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { useSchedule } from './ScheduleContext';
import { saveScheduleToDB, updateScheduleInDB } from './scheduleService';
import { supabase } from '../../../../utils/supabase';
import { getRoadDistanceKm, quickEstimateKm, computePricing, PricingBreakdown } from '../../../../services/routeService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { notifyUser } from '../../../../services/pushService';

const { height } = Dimensions.get('window');
const SHEET_MAX_H = Math.round(height * 0.5);
const ORANGE = '#F27024';
const SEND_NOW_WINDOW_MINUTES = 5;
const MANILA_OFFSET_HOURS = 8;

const SEARCH_DURATION_MS = 30000;

const SHOW_ANIMATION_SWITCHER = false;
const ANIMATION_STYLES = [
  { key: 'radar', label: 'Radar' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'combined', label: 'Combo' },
] as const;
type FindingAnimation = typeof ANIMATION_STYLES[number]['key'];
const DEFAULT_FINDING_ANIMATION: FindingAnimation = 'radar';

const FINDING_STATUS_MESSAGES = [
  'Locating nearby delivery partners...',
  'Matching cargo capacity and vehicle type...',
  'Broadcasting your request to available riders...',
  'Pinging riders in your immediate area...',
  'Optimizing delivery route for best fare...',
  'Checking availability of nearby drivers...',
  'Notifying top-rated riders nearby...',
  'Almost there, waiting for a response...',
  'Expanding search radius for more options...',
  'Still searching, please hold on...',
  'Coordinating logistics with local partners...',
  'Waiting for a rider to accept your booking...',
];

const searchStartTimes = new Map<number, number>();

const parseManilaNaive = (naive: string): number => {
  const m = String(naive).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10) - MANILA_OFFSET_HOURS,
    parseInt(mi, 10),
    parseInt(s || '0', 10),
  );
};

const nowManilaNaive = (): string => {
  const now = new Date();
  const manila = new Date(now.getTime() + MANILA_OFFSET_HOURS * 60 * 60 * 1000);
  const y = manila.getUTCFullYear();
  const m = String(manila.getUTCMonth() + 1).padStart(2, '0');
  const d = String(manila.getUTCDate()).padStart(2, '0');
  const hh = String(manila.getUTCHours()).padStart(2, '0');
  const mm = String(manila.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
};

const formatDepartureTime = (isoString: string | null | undefined) => {
  if (!isoString) return null;
  try {
    const d = new Date(isoString.replace(' ', 'T'));
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
};

interface ProviderRating {
  avg: number;
  count: number;
  recent: { rating: number; comment: string | null; created_at: string }[];
}

/* ==================================================================== */
/* Local match notification                                            */
/* ==================================================================== */
const fireMatchNotification = async (providerName: string, plate: string, deliveryId: number) => {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🎉 Provider Matched!',
        body: `${providerName} accepted your delivery. Vehicle: ${plate}`,
        data: { type: 'match', deliveryId },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local match notif failed:', err);
  }
};

/* ==================================================================== */
/* Local direct-provider request notification                          */
/* ==================================================================== */
const fireDirectRequestNotification = async (providerName: string, requestId: number) => {
  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📨 Request Sent to Provider!',
        body: `Your delivery #${trackingId} has been sent directly to ${providerName}.`,
        data: { type: 'direct_request', requestId },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local direct notif failed:', err);
  }
};

/* ==================================================================== */
/* Local cancellation / refund notification                            */
/* ==================================================================== */
const fireCancelNotification = async (opts: {
  requestId: number;
  amount?: number | null;
  refunded: boolean;
  refundFailed?: boolean;
}) => {
  const { requestId, amount, refunded, refundFailed } = opts;
  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;

  let title = '❌ Booking Cancelled';
  let body: string;

  if (refunded) {
    const amtText = typeof amount === 'number' && amount > 0 ? ` of ₱${amount.toFixed(2)}` : '';
    body = `Booking #${trackingId} was cancelled. A refund${amtText} has been initiated and should arrive within a few minutes to 3–5 business days.`;
  } else if (refundFailed) {
    body = `Booking #${trackingId} was cancelled, but the automatic refund could not be started. Your funds are still held in escrow — please contact support with this tracking ID.`;
  } else {
    body = `Booking #${trackingId} was cancelled. No payment was taken.`;
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: {
          type: 'cancellation',
          requestId,
          refunded: !!refunded,
          refundFailed: !!refundFailed,
        },
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        ...(Platform.OS === 'android' ? { channelId: 'default' } : {}),
      },
    });
  } catch (err) {
    console.warn('[BookingScreen] local cancel notif failed:', err);
  }
};

/* ==================================================================== */
/* Push notification to the assigned provider on cancellation          */
/* ==================================================================== */
const notifyProviderOfCancellation = async (opts: {
  providerId: number | null | undefined;
  requestId: number;
  amount?: number | null;
}) => {
  const { providerId, requestId, amount } = opts;
  if (!providerId) return;

  const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
  try {
    await notifyUser(
      providerId,
      '🚫 Delivery Cancelled',
      `Booking #${trackingId} was cancelled by the sender before pickup. No action needed on your end.${
        typeof amount === 'number' && amount > 0 ? ` The sender's ₱${amount.toFixed(2)} escrow is being refunded.` : ''
      }`,
      { type: 'cancellation', requestId, role: 'provider' },
    );
  } catch (err) {
    console.warn('[BookingScreen] provider cancel push failed:', err);
  }
};

/* ==================================================================== */
/* Persistent snapshot of preferred-provider info captured at payment  */
/* time. Survives context resets and DB write failures.               */
/* ==================================================================== */
type PreferredSnapshot = {
  requestId: number | null;
  providerId: number | null;
  routeId: number | null;
  name: string | null;
};

export default function BookingScreen({ route, navigation }: any) {
  const { mode: routeMode } = route.params || {};
  const { state, dispatch } = useSchedule();
  const mode = routeMode || state.mode;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [bookingState, setBookingState] = useState<'review' | 'finding' | 'matched' | 'no_match'>('review');
  const [matchFound, setMatchFound] = useState(false);
  const [isDirectPreferredProvider, setIsDirectPreferredProvider] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [providerData, setProviderData] = useState<any>(null);
  const [savedRequestId, setSavedRequestId] = useState<number | null>(null);

  const [departureTime, setDepartureTime] = useState<string | null>(null);

  const [providerRating, setProviderRating] = useState<ProviderRating | null>(null);

  const resumeRequestId: number | undefined = route.params?.requestId ?? route.params?.request_id;
  const isResume = !!route.params?.resume && !!resumeRequestId;
  const [resumeInfo, setResumeInfo] = useState<any>(null);
  const [resumeSubId, setResumeSubId] = useState<number | null>(null);
  const resumedRef = useRef<number | null>(null);
  const resumeReceiverRef = useRef<any>(null);
  const searchStartRef = useRef<number | null>(null);

  const [longSearch, setLongSearch] = useState(false);
  const [dotCount, setDotCount] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [animStyle, setAnimStyle] = useState<FindingAnimation>(DEFAULT_FINDING_ANIMATION);

  const spinAnim = useRef(new Animated.Value(0)).current;
  const travelAnim = useRef(new Animated.Value(0)).current;
  const bobAnim = useRef(new Animated.Value(0)).current;
  const textAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const radarAnim1 = useRef(new Animated.Value(0)).current;
  const radarAnim2 = useRef(new Animated.Value(0)).current;
  const radarAnim3 = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const isResumedSession = useRef(false);
  const matchChannelRef = useRef<any>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- DOUBLE-TAP GUARD ----
  const proceedingRef = useRef(false);
  const proceedReturnToRef = useRef<number | null>(null);
  const [savingBooking, setSavingBooking] = useState(false);

  const cancellingRef = useRef(false);

  // ---- PREFERRED-PROVIDER SNAPSHOT ----
  // Captured right before navigating to DeliveryPayment. Used by the
  // post-payment effect and by resumeBooking so we NEVER accidentally
  // enter the finding radar for route bookings, even if the Schedule
  // context is reset by the payment screen or the DB write fails.
  const preferredAtPaymentRef = useRef<PreferredSnapshot>({
    requestId: null,
    providerId: null,
    routeId: null,
    name: null,
  });

  const [receiver, setReceiver] = useState<any>(state.receiver || null);

  const [pricing, setPricing] = useState<PricingBreakdown | null>(null);
  const [refiningDistance, setRefiningDistance] = useState(false);

  useEffect(() => {
    if (!state.pickupLocation || !state.dropoffLocation) return;

    const scheduled = mode === 'schedule' || !!state.scheduledDate;

    const quickKm = quickEstimateKm(state.pickupLocation, state.dropoffLocation);
    const quickResult = computePricing({
      distanceKm: quickKm,
      items: state.items,
      scheduled,
      refined: false,
    });
    setPricing(quickResult);
    dispatch({ type: 'SET_ESTIMATED_COST', payload: quickResult.total });

    let cancelled = false;
    setRefiningDistance(true);

    (async () => {
      try {
        const realKm = await getRoadDistanceKm(state.pickupLocation!, state.dropoffLocation!);
        if (cancelled) return;

        if (Math.abs(realKm - quickKm) < 0.05) {
          setRefiningDistance(false);
          return;
        }

        const refinedResult = computePricing({
          distanceKm: realKm,
          items: state.items,
          scheduled,
          refined: true,
        });
        setPricing(refinedResult);
        dispatch({ type: 'SET_ESTIMATED_COST', payload: refinedResult.total });
      } catch (e) {
        console.warn('Fare refinement failed', e);
      } finally {
        if (!cancelled) setRefiningDistance(false);
      }
    })();

    return () => { cancelled = true; };
  }, [state.pickupLocation, state.dropoffLocation, state.items, mode, state.scheduledDate]);

  useEffect(() => {
    if (state.receiver) setReceiver(state.receiver);
  }, [state.receiver]);

  useEffect(() => {
    sheetAnim.setValue(0);
    Animated.timing(sheetAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [bookingState, sheetAnim]);

  useEffect(() => {
    return () => {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }
    };
  }, []);

  // Re-enable the Proceed button ONLY when the user comes back to this screen
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (proceedReturnToRef.current !== null) {
        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        setSavingBooking(false);
      }
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    if (bookingState === 'finding') {
      setIsSearching(true);

      const startedAt = searchStartRef.current ?? Date.now();
      searchStartRef.current = startedAt;
      const elapsed = Math.max(0, Date.now() - startedAt);
      const remaining = Math.max(0, SEARCH_DURATION_MS - elapsed);
      progressAnim.setValue(Math.min(elapsed / SEARCH_DURATION_MS, 1));
      setLongSearch(remaining === 0);
      let longSearchTimer: ReturnType<typeof setTimeout> | null = null;

      if (remaining > 0) {
        Animated.timing(progressAnim, {
          toValue: 1, duration: remaining, easing: Easing.linear, useNativeDriver: false,
        }).start();
        longSearchTimer = setTimeout(() => setLongSearch(true), remaining);
      }

      const spinLoop = Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 2800, easing: Easing.linear, useNativeDriver: true })
      );
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      spinAnim.setValue(0);
      pulseAnim.setValue(0);
      spinLoop.start();
      pulseLoop.start();
      const dotsTimer = setInterval(() => setDotCount(c => (c + 1) % 4), 450);

      const createRadarWave = (anim: Animated.Value, delay: number) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, {
              toValue: 1, duration: 2000, easing: Easing.out(Easing.ease), useNativeDriver: true,
            }),
            Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          ])
        );

      const r1 = createRadarWave(radarAnim1, 0);
      const r2 = createRadarWave(radarAnim2, 650);
      const r3 = createRadarWave(radarAnim3, 1300);

      r1.start(); r2.start(); r3.start();

      return () => {
        r1.stop(); r2.stop(); r3.stop();
        spinLoop.stop(); pulseLoop.stop();
        progressAnim.stopAnimation();
        clearInterval(dotsTimer);
        if (longSearchTimer) clearTimeout(longSearchTimer);
      };
    }
  }, [bookingState, radarAnim1, radarAnim2, radarAnim3, progressAnim, spinAnim, pulseAnim]);

  useEffect(() => {
    if (bookingState !== 'finding') return;

    setStatusIndex(0);
    textAnim.setValue(1);

    const timer = setInterval(() => {
      Animated.timing(textAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setStatusIndex(i => (i + 1) % FINDING_STATUS_MESSAGES.length);
        Animated.timing(textAnim, {
          toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }).start();
      });
    }, 4000);

    return () => {
      clearInterval(timer);
      textAnim.stopAnimation();
    };
  }, [bookingState, textAnim]);

  const loadProviderRating = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('ratings_reviews')
        .select('rating, review_text, created_at')
        .eq('reviewee_id', providerId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const rows = data || [];
      if (rows.length === 0) {
        setProviderRating({ avg: 0, count: 0, recent: [] });
        return;
      }
      const sum = rows.reduce((s: number, r: any) => s + Number(r.rating || 0), 0);
      const avg = sum / rows.length;

      setProviderRating({
        avg: Number(avg.toFixed(1)),
        count: rows.length,
        recent: rows.slice(0, 2).map((r: any) => ({
          rating: Number(r.rating) || 0,
          comment: r.review_text ?? null,
          created_at: r.created_at,
        })),
      });
    } catch (e: any) {
      console.warn('[Booking] rating fetch failed', e?.message || e);
      setProviderRating(null);
    }
  };

  const loadProviderDeparture = async (routeId: number | null | undefined) => {
    if (!routeId) {
      setDepartureTime(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('provider_routes')
        .select('departure_time')
        .eq('route_id', routeId)
        .maybeSingle();

      if (!error && data?.departure_time) {
        setDepartureTime(data.departure_time);
      } else {
        setDepartureTime(null);
      }
    } catch (e) {
      console.warn('[Booking] departure fetch failed', e);
      setDepartureTime(null);
    }
  };

  const finalizePreferredProviderBooking = async (opts: {
    requestId: number;
    providerId: number;
    routeId?: number | null;
    notifyProvider?: boolean;
  }) => {
    const { requestId, providerId, routeId, notifyProvider = false } = opts;

    try {
      const { data: provider } = await supabase
        .from('users')
        .select('first_name, last_name, phone_number')
        .eq('user_id', providerId)
        .maybeSingle();

      let vehicle: any = null;
      let depTime: string | null = null;

      if (routeId) {
        const { data: routeRow } = await supabase
          .from('provider_routes')
          .select('departure_time, vehicle:vehicles!provider_routes_vehicle_id_fkey(vehicle_type, plate_number, max_weight_kg)')
          .eq('route_id', routeId)
          .maybeSingle();
        if (routeRow) {
          depTime = routeRow.departure_time ?? null;
          vehicle = Array.isArray((routeRow as any).vehicle)
            ? (routeRow as any).vehicle[0]
            : (routeRow as any).vehicle;
        }
      }

      if (!vehicle) {
        const { data: vRow } = await supabase
          .from('vehicles')
          .select('vehicle_type, plate_number, max_weight_kg')
          .eq('provider_id', providerId)
          .limit(1)
          .maybeSingle();
        vehicle = vRow;
      }

      setProviderData({
        first_name: provider?.first_name || state.preferredProviderName?.split(' ')[0] || 'Selected',
        last_name: provider?.last_name || state.preferredProviderName?.split(' ').slice(1).join(' ') || 'Provider',
        phone_number: provider?.phone_number || '',
        vehicle_type: vehicle?.vehicle_type || 'Courier Vehicle',
        plate_number: vehicle?.plate_number || 'Assigned Route',
        max_weight_kg: vehicle?.max_weight_kg ?? null,
      });

      setDepartureTime(depTime);
      loadProviderRating(providerId);

      const providerFullName =
        provider
          ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim()
          : state.preferredProviderName || 'your selected provider';

      if (notifyProvider) {
        const trackingId = `PNS-${String(requestId).padStart(4, '0')}`;
        try {
          await notifyUser(
            providerId,
            '📦 New Route Delivery Request!',
            `A sender requested a delivery (#${trackingId}) along your route. Open the Jobs tab to review and accept it.`,
            { type: 'direct_route_request', requestId, routeId: routeId ?? null },
          );
        } catch (err) {
          console.warn('[BookingScreen] direct provider push failed:', err);
        }
        fireDirectRequestNotification(providerFullName, requestId);
      }

      setIsDirectPreferredProvider(true);
      setMatchFound(true);
      setIsSearching(false);
      setBookingState('matched');
    } catch (e) {
      console.warn('[BookingScreen] finalizePreferredProviderBooking failed:', e);
      setIsDirectPreferredProvider(true);
      setMatchFound(true);
      setIsSearching(false);
      setBookingState('matched');
    }
  };

  const startMatching = async (opts?: { reuseRequestId?: number | null }) => {
    try {
      if (!receiver?.receiver_id && !receiver?.receiver_phone) {
        Alert.alert('Required', 'Please select a receiver before booking.');
        return;
      }

      let requestId: number;

      if (opts?.reuseRequestId) {
        requestId = opts.reuseRequestId;
      } else if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        requestId = state.editIds.requestId;
      } else {
        const savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
        if (!savedRequest) throw new Error('Failed to save request');
        requestId = savedRequest.request_id;
      }

      setSavedRequestId(requestId);
      searchStartTimes.set(requestId, searchStartRef.current ?? Date.now());

      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      const matchChannel = supabase
        .channel(`match-listener-${requestId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${requestId}` },
          async (payload) => {
            const delivery = payload.new;

            const { data: provider } = await supabase
              .from('users')
              .select('first_name, last_name, phone_number')
              .eq('user_id', delivery.provider_id)
              .single();
            const { data: vehicle } = await supabase
              .from('vehicles')
              .select('vehicle_type, plate_number, max_weight_kg')
              .eq('vehicle_id', delivery.vehicle_id)
              .single();

            if (provider && vehicle) setProviderData({ ...provider, ...vehicle });
            if (delivery.provider_id) loadProviderRating(delivery.provider_id);

            if (delivery.route_id) loadProviderDeparture(delivery.route_id);
            else setDepartureTime(null);

            fireMatchNotification(
              provider ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'A courier' : 'A courier',
              vehicle?.plate_number || '—',
              delivery.delivery_id,
            );

            setIsDirectPreferredProvider(false);
            setMatchFound(true);
            setBookingState('matched');
            setIsSearching(false);

            if (searchTimeoutRef.current) {
              clearTimeout(searchTimeoutRef.current);
              searchTimeoutRef.current = null;
            }
            supabase.removeChannel(matchChannel);
            matchChannelRef.current = null;
          }
        )
        .subscribe();

      matchChannelRef.current = matchChannel;

      searchTimeoutRef.current = setTimeout(() => {
        setBookingState(prev => (prev === 'finding' ? 'no_match' : prev));
        setIsSearching(false);
        if (matchChannelRef.current) {
          supabase.removeChannel(matchChannelRef.current);
          matchChannelRef.current = null;
        }
        searchTimeoutRef.current = null;
      }, SEARCH_DURATION_MS);
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to process your booking. Please try again.');
      setBookingState('review');
    }
  };

  const loadProviderForDelivery = async (delivery: any) => {
    const { data: provider } = await supabase
      .from('users')
      .select('first_name, last_name, phone_number')
      .eq('user_id', delivery.provider_id)
      .single();
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('vehicle_type, plate_number, max_weight_kg')
      .eq('vehicle_id', delivery.vehicle_id)
      .single();
    if (provider && vehicle) setProviderData({ ...provider, ...vehicle });

    if (delivery.provider_id) loadProviderRating(delivery.provider_id);

    if (delivery.route_id) loadProviderDeparture(delivery.route_id);
    else setDepartureTime(null);
  };

  const resumeBooking = async (requestId: number) => {
    if (savedRequestId === requestId && bookingState !== 'review') return;
    try {
      const { data: req, error } = await supabase
        .from('delivery_requests')
        .select(`*, pickup_location:locations!delivery_requests_pickup_location_id_fkey (*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (*), receiver:receivers!delivery_requests_receiver_id_fkey (receiver_id, receiver_name, receiver_phone, receiver_email, is_favorite)`)
        .eq('request_id', requestId)
        .maybeSingle();
      if (error) throw error;
      if (!req) {
        Alert.alert('Order not found', 'This delivery request no longer exists.');
        navigation.goBack();
        return;
      }

      isResumedSession.current = true;
      setSavedRequestId(requestId);

      setResumeInfo({
        pickupLocation: { address: req.pickup_location?.street_address, latitude: req.pickup_location?.latitude ?? null, longitude: req.pickup_location?.longitude ?? null },
        dropoffLocation: { address: req.dropoff_location?.street_address, latitude: req.dropoff_location?.latitude ?? null, longitude: req.dropoff_location?.longitude ?? null },
        estimatedCost: Number(req.estimated_cost) || 0,
      });

      const rcv = req.receiver
        ? { receiver_id: req.receiver.receiver_id ?? req.receiver_id ?? null, receiver_name: req.receiver.receiver_name ?? null, receiver_phone: req.receiver.receiver_phone ?? req.receiver_phone ?? '', receiver_email: req.receiver.receiver_email ?? null, is_favorite: req.receiver.is_favorite ?? false }
        : req.receiver_phone ? { receiver_id: req.receiver_id ?? null, receiver_name: null, receiver_phone: req.receiver_phone } : null;

      resumeReceiverRef.current = rcv;
      if (rcv) setReceiver(rcv);

      const { data: delivery } = await supabase.from('deliveries').select('*').eq('request_id', requestId).order('accepted_at', { ascending: false }).limit(1).maybeSingle();

      if (delivery) {
        await loadProviderForDelivery(delivery);
        setIsDirectPreferredProvider(false);
        setMatchFound(true);
        setIsSearching(false);
        setBookingState('matched');
        return;
      }

      // If this booking was made for a specific preferred provider from Explore,
      // do NOT show the finding radar. Read from DB first, then fall back to the
      // snapshot captured just before navigating to payment.
      const preferredFromRequest = req.preferred_provider_id ? Number(req.preferred_provider_id) : null;
      const snapshotMatches = preferredAtPaymentRef.current.requestId === requestId;
      const preferredFromSnapshot = snapshotMatches ? preferredAtPaymentRef.current.providerId : null;
      const effectivePreferredId = preferredFromRequest ?? preferredFromSnapshot;
      const effectivePreferredRoute = req.preferred_route_id
        ? Number(req.preferred_route_id)
        : snapshotMatches
          ? preferredAtPaymentRef.current.routeId
          : null;

      if (effectivePreferredId) {
        await finalizePreferredProviderBooking({
          requestId,
          providerId: effectivePreferredId,
          routeId: effectivePreferredRoute ?? null,
          notifyProvider: false,
        });
        return;
      }

      if (req.delivery_status !== 'Pending') {
        Alert.alert('Order updated', `This order is now ${req.delivery_status}.`);
        navigation.goBack();
        return;
      }

      const createdMs = req.created_at ? new Date(req.created_at).getTime() : NaN;
      searchStartRef.current = searchStartTimes.get(requestId) ?? (!isNaN(createdMs) ? createdMs : Date.now());
      setResumeSubId(requestId);
      setBookingState('finding');
    } catch (err: any) {
      Alert.alert('Error', 'Could not load this order.');
      navigation.goBack();
    }
  };

  useEffect(() => {
    if (!isResume || !resumeRequestId) return;
    if (resumedRef.current === resumeRequestId) return;
    resumedRef.current = resumeRequestId;
    resumeBooking(resumeRequestId);
  }, [isResume, resumeRequestId]);

  useEffect(() => {
    if (bookingState !== 'finding' || !resumeSubId) return;
    const requestId = resumeSubId;

    supabase.getChannels().filter((c: any) => c.topic === `realtime:match-listener-${requestId}`).forEach((c: any) => supabase.removeChannel(c));

    const channel = supabase
      .channel(`match-listener-${requestId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deliveries', filter: `request_id=eq.${requestId}` },
        async (payload) => {
          const delivery = payload.new;
          await loadProviderForDelivery(delivery);

          const { data: provider } = await supabase
            .from('users')
            .select('first_name, last_name')
            .eq('user_id', delivery.provider_id)
            .single();
          const { data: vehicle } = await supabase
            .from('vehicles')
            .select('plate_number')
            .eq('vehicle_id', delivery.vehicle_id)
            .single();

          fireMatchNotification(
            provider ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'A courier' : 'A courier',
            vehicle?.plate_number || '—',
            delivery.delivery_id,
          );

          setIsDirectPreferredProvider(false);
          setMatchFound(true);
          setBookingState('matched');
          setIsSearching(false);
          supabase.removeChannel(channel);
        }
      )
      .subscribe();

    matchChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (matchChannelRef.current === channel) matchChannelRef.current = null;
    };
  }, [bookingState, resumeSubId]);

  // ---- Handle return from DeliveryPaymentScreen ----
  //
  // Route bookings (Explore → Request Delivery):
  //   provider is already chosen → NO radar, NO matched screen.
  //   Notify provider, fire local confirmation, go home.
  //
  // Generic bookings (Send Package Now / Schedule a Delivery):
  //   run the provider-matching radar as usual.
  useEffect(() => {
    const justPaid = route.params?.paymentJustCompleted;
    const reqId = route.params?.requestId;
    if (!justPaid || !reqId) return;

    const numericReqId = Number(reqId);
    navigation.setParams({ paymentJustCompleted: undefined, requestId: undefined });
    setSavedRequestId(numericReqId);

    (async () => {
      // Resolve preferred provider using three layers of defence:
      //   1) live Schedule context (fastest, but can be reset by payment screen)
      //   2) snapshot captured in handleProceedToPayment (survives context reset)
      //   3) DB row (survives app restarts; backed by our belt-and-suspenders write)
      let prefProviderId: number | null = state.preferredProviderId ?? null;
      let prefRouteId: number | null = state.preferredRouteId ?? null;
      let prefProviderName: string | null = state.preferredProviderName ?? null;

      if (!prefProviderId && preferredAtPaymentRef.current.requestId === numericReqId) {
        prefProviderId = preferredAtPaymentRef.current.providerId;
        prefRouteId = preferredAtPaymentRef.current.routeId;
        prefProviderName = preferredAtPaymentRef.current.name;
      }

      if (!prefProviderId) {
        const { data: reqRow } = await supabase
          .from('delivery_requests')
          .select('preferred_provider_id, preferred_route_id')
          .eq('request_id', numericReqId)
          .maybeSingle();
        if (reqRow?.preferred_provider_id) {
          prefProviderId = Number(reqRow.preferred_provider_id);
          prefRouteId = reqRow.preferred_route_id ? Number(reqRow.preferred_route_id) : null;
        }
      }

      if (prefProviderId) {
        // ============================================================
        // ROUTE BOOKING — provider already chosen.
        // NO radar, NO matched screen. Notify + go home.
        // ============================================================
        try {
          const { data: provider } = await supabase
            .from('users')
            .select('first_name, last_name')
            .eq('user_id', prefProviderId)
            .maybeSingle();

          const trackingId = `PNS-${String(numericReqId).padStart(4, '0')}`;
          const providerFullName = provider
            ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'your selected provider'
            : prefProviderName || 'your selected provider';

          try {
            await notifyUser(
              prefProviderId,
              '📦 New Route Delivery Request!',
              `A sender requested a delivery (#${trackingId}) along your route. Open the Jobs tab to review and accept it.`,
              { type: 'direct_route_request', requestId: numericReqId, routeId: prefRouteId ?? null },
            );
          } catch (err) {
            console.warn('[BookingScreen] direct provider push failed:', err);
          }

          fireDirectRequestNotification(providerFullName, numericReqId);
        } catch (e) {
          console.warn('[BookingScreen] post-payment provider notify failed:', e);
        }

        preferredAtPaymentRef.current = { requestId: null, providerId: null, routeId: null, name: null };

        if (matchChannelRef.current) {
          supabase.removeChannel(matchChannelRef.current);
          matchChannelRef.current = null;
        }
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }

        dispatch({ type: 'RESET' });
        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        setSavingBooking(false);
        navigation.navigate('MainTabs');
        return;
      }

      // ============================================================
      // GENERIC BOOKING (Send Package Now / Schedule a Delivery) —
      // run the provider-matching radar.
      // ============================================================
      searchStartRef.current = Date.now();
      setBookingState('finding');
      startMatching({ reuseRequestId: numericReqId });
    })();
  }, [route.params?.paymentJustCompleted, route.params?.requestId]);

  // ---- DOUBLE-TAP SAFE ----
  const handleProceedToPayment = async () => {
    if (proceedingRef.current) return;
    proceedingRef.current = true;
    setSavingBooking(true);

    try {
      if (!receiver?.receiver_id && !receiver?.receiver_phone) {
        Alert.alert('Receiver Required', 'Please select who will receive this package.');
        proceedingRef.current = false;
        setSavingBooking(false);
        return;
      }

      if (mode === 'sendNow' && state.scheduledDate) {
        const scheduledMs = parseManilaNaive(String(state.scheduledDate));
        const nowMs = parseManilaNaive(nowManilaNaive());
        if (!isNaN(scheduledMs) && !isNaN(nowMs)) {
          const diffMinutes = Math.abs(scheduledMs - nowMs) / 60000;
          if (diffMinutes > SEND_NOW_WINDOW_MINUTES) {
            Alert.alert(
              'Schedule Too Far',
              `Send Now requests must be within ${SEND_NOW_WINDOW_MINUTES} minutes.`,
            );
            proceedingRef.current = false;
            setSavingBooking(false);
            return;
          }
        }
      }

      let requestId: number;

      if (state.isEdit && state.editIds) {
        await updateScheduleInDB(state, state.editIds);
        requestId = state.editIds.requestId;
      } else {
        const savedRequest = await saveScheduleToDB(state, mode || 'sendNow');
        if (!savedRequest) throw new Error('Failed to save request');
        requestId = savedRequest.request_id;
      }

      // Belt-and-suspenders: explicitly persist preferred_provider_id so the
      // post-payment effect and resume flow can always detect route bookings,
      // even if saveScheduleToDB doesn't copy these fields.
      if (state.preferredProviderId) {
        try {
          await supabase
            .from('delivery_requests')
            .update({
              preferred_provider_id: state.preferredProviderId,
              preferred_route_id: state.preferredRouteId ?? null,
            })
            .eq('request_id', requestId);
        } catch (e) {
          console.warn('[BookingScreen] failed to persist preferred provider:', e);
        }
      }

      // Snapshot preferred-provider info so the post-payment effect can
      // still detect a route booking even if the Schedule context has been
      // reset by the payment screen.
      preferredAtPaymentRef.current = {
        requestId,
        providerId: state.preferredProviderId ?? null,
        routeId: state.preferredRouteId ?? null,
        name: state.preferredProviderName ?? null,
      };

      proceedReturnToRef.current = requestId;
      setSavedRequestId(requestId);
      const amount = pricing?.total ?? state.estimatedCost ?? 0;

      navigation.navigate('DeliveryPayment', { requestId, amount });
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Could not save your request. Please try again.');
      proceedingRef.current = false;
      proceedReturnToRef.current = null;
      setSavingBooking(false);
    }
  };

  const handleCancelBooking = async () => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;

    let wasPaid = false;
    let refundSucceeded = false;
    let refundFailed = false;
    let cancelledAmount: number | null = null;
    let cancelledProviderId: number | null = null;
    let cancelledRequestId: number | null = null;

    try {
      if (matchChannelRef.current) {
        supabase.removeChannel(matchChannelRef.current);
        matchChannelRef.current = null;
      }
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = null;
      }

      if (savedRequestId) {
        cancelledRequestId = savedRequestId;

        const { data: reqRow } = await supabase
          .from('delivery_requests')
          .select('payment_status, escrow_status, estimated_cost, payment_provider, refund_status, preferred_provider_id')
          .eq('request_id', savedRequestId)
          .maybeSingle();

        cancelledAmount = Number(reqRow?.estimated_cost) || 0;

        const { data: deliveryRow } = await supabase
          .from('deliveries')
          .select('delivery_id, provider_id')
          .eq('request_id', savedRequestId)
          .order('accepted_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        cancelledProviderId = deliveryRow?.provider_id ?? reqRow?.preferred_provider_id ?? null;

        const wasHeld =
          reqRow?.payment_status === 'held' ||
          reqRow?.escrow_status === 'held';
        wasPaid = wasHeld;

        if (wasHeld) {
          try {
            const { data: refundResult, error: refundErr } = await supabase.functions.invoke(
              'xendit-refund',
              { body: { request_id: savedRequestId, reason: 'REQUESTED_BY_CUSTOMER' } },
            );

            const ok = !refundErr && refundResult?.success;

            if (!ok) {
              refundFailed = true;

              const msg =
                refundResult?.error ||
                refundErr?.message ||
                'Refund could not be started.';
              const needsManual = refundResult?.needs_manual === true;

              await supabase
                .from('delivery_requests')
                .update({
                  delivery_status: 'Cancelled',
                  refund_status: needsManual ? 'manual_required' : 'failed',
                })
                .eq('request_id', savedRequestId);

              await supabase.from('escrow_transactions').insert({
                request_id: savedRequestId,
                event: 'refund_auto_failed',
                amount: Number(reqRow?.estimated_cost) || 0,
                provider: reqRow?.payment_provider ?? null,
                notes: `Auto-refund failed: ${msg}`,
              });

              Alert.alert(
                'Booking Cancelled',
                `Your booking has been cancelled.\n\n` +
                  `The automatic refund could not be started:\n${msg}\n\n` +
                  `Your funds are still held in escrow. Please contact support with ` +
                  `tracking ID PNS-${String(savedRequestId).padStart(4, '0')} so we can process your refund manually.`,
                [{ text: 'OK' }],
              );
            } else {
              refundSucceeded = true;

              await supabase
                .from('delivery_requests')
                .update({ delivery_status: 'Cancelled' })
                .eq('request_id', savedRequestId);

              Alert.alert(
                'Booking Cancelled',
                'Your refund has been initiated.\n\n' +
                  'Most GCash/Maya refunds arrive within a few minutes, but may take ' +
                  'up to 3–5 business days depending on your wallet provider.',
              );
            }
          } catch (e: any) {
            refundFailed = true;

            await supabase
              .from('delivery_requests')
              .update({ delivery_status: 'Cancelled', refund_status: 'failed' })
              .eq('request_id', savedRequestId);

            Alert.alert(
              'Booking Cancelled',
              `Your booking was cancelled, but we could not reach the payment service ` +
                `(${e?.message || 'network error'}). Your funds are still held in escrow — ` +
                `please contact support with tracking ID PNS-${String(savedRequestId).padStart(4, '0')}.`,
            );
          }
        } else {
          const { data: cargoRow } = await supabase
            .from('delivery_requests')
            .select('cargo_id')
            .eq('request_id', savedRequestId)
            .maybeSingle();
          await supabase.from('delivery_requests').delete().eq('request_id', savedRequestId);
          if (cargoRow?.cargo_id) {
            await supabase.from('cargo_profiles').delete().eq('cargo_id', cargoRow.cargo_id);
          }
        }
      }

      setResumeSubId(null);
      preferredAtPaymentRef.current = { requestId: null, providerId: null, routeId: null, name: null };

      if (cancelledRequestId != null) {
        fireCancelNotification({
          requestId: cancelledRequestId,
          amount: cancelledAmount,
          refunded: refundSucceeded,
          refundFailed,
        });
      }

      if (cancelledProviderId && cancelledRequestId != null) {
        notifyProviderOfCancellation({
          providerId: cancelledProviderId,
          requestId: cancelledRequestId,
          amount: cancelledAmount,
        });
      }

      if (isResumedSession.current) {
        isResumedSession.current = false;
        navigation.goBack();
        return;
      }

      if (wasPaid) {
        dispatch({ type: 'RESET' });
        setSavedRequestId(null);
        proceedingRef.current = false;
        proceedReturnToRef.current = null;
        setSavingBooking(false);
        navigation.navigate('MainTabs');
        return;
      }

      setBookingState('review');
    } finally {
      cancellingRef.current = false;
    }
  };

  const handleGoHome = () => {
    if (matchChannelRef.current) {
      supabase.removeChannel(matchChannelRef.current);
      matchChannelRef.current = null;
    }
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    setIsSearching(false);
    proceedingRef.current = false;
    proceedReturnToRef.current = null;
    setSavingBooking(false);
    dispatch({ type: 'RESET' });
    navigation.navigate('MainTabs');
  };

  const handleTryAgain = () => {
    searchStartRef.current = Date.now();
    setBookingState('finding');
    startMatching({ reuseRequestId: savedRequestId });
  };

  const handleConfirmAction = () => {
    dispatch({ type: 'RESET' });
    proceedingRef.current = false;
    proceedReturnToRef.current = null;
    setSavingBooking(false);
    navigation.navigate('MainTabs');
  };

  const handleSelectReceiver = () => {
    navigation.navigate('ReceiverPicker', {
      selectedReceiverId: receiver?.receiver_id || null,
    });
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      const picked = route.params?.pickedReceiver;
      if (picked) {
        setReceiver(picked);
        dispatch({ type: 'SET_INITIAL_STATE', payload: { ...state, receiver: picked } as any });
        navigation.setParams({ pickedReceiver: undefined });
      }
    });
    return unsubscribe;
  }, [navigation, route.params?.pickedReceiver]);

  const viewPickupLocation = resumeInfo?.pickupLocation ?? state.pickupLocation;
  const viewDropoffLocation = resumeInfo?.dropoffLocation ?? state.dropoffLocation;
  const displayCost: number | undefined = resumeInfo?.estimatedCost ?? state.estimatedCost;

  const pickupLat = viewPickupLocation?.latitude ?? null;
  const pickupLng = viewPickupLocation?.longitude ?? null;
  const dropoffLat = viewDropoffLocation?.latitude ?? null;
  const dropoffLng = viewDropoffLocation?.longitude ?? null;

  const sheetFadeUp = {
    opacity: sheetAnim,
    transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  const mapTopPad = Math.round(insets.top + 70);
  const mapBottomPad = SHEET_MAX_H + 16;

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <RoutePreviewMap
        pickupLat={pickupLat}
        pickupLng={pickupLng}
        dropoffLat={dropoffLat}
        dropoffLng={dropoffLng}
        padTop={mapTopPad}
        padBottom={mapBottomPad}
      />

      <View style={[styles.topOverlay, { top: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={[styles.bottomSheet, bookingState === 'finding' && styles.bottomSheetFinding]}>

        {/* --- REVIEW STATE --- */}
        {bookingState === 'review' && (
          <Animated.View style={[styles.sheetCard, styles.sheetCardCapped, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              bounces={false}
            >
              <View style={styles.rvHeader}>
                <Text style={styles.rvTitle}>Review & pay</Text>
              </View>

              {state.preferredProviderId && (
                <View style={styles.preferredProviderBanner}>
                  <View style={styles.preferredProviderIcon}>
                    <Ionicons name="car-sport" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.preferredProviderLabel}>SELECTED COURIER PARTNER</Text>
                    <Text style={styles.preferredProviderName} numberOfLines={1}>
                      {state.preferredProviderName || `Provider #${state.preferredProviderId}`}
                    </Text>
                    {state.preferredRoute && (
                      <Text style={styles.preferredProviderRoute} numberOfLines={1}>
                        Route: {state.preferredRoute.pickup.split(',')[0]} → {state.preferredRoute.dropoff.split(',')[0]}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                </View>
              )}

              <View style={[styles.rvCard, !receiver && styles.rvCardEmpty]}>
                <TouchableOpacity
                  style={styles.rvReceiverRow}
                  onPress={handleSelectReceiver}
                  activeOpacity={0.8}
                  disabled={savingBooking}
                >
                  <View style={[styles.rvAvatar, !receiver && styles.rvAvatarEmpty]}>
                    {receiver ? (
                      <Text style={styles.rvAvatarText}>
                        {(receiver.receiver_name || receiver.first_name || '?').trim().charAt(0).toUpperCase()}
                      </Text>
                    ) : (
                      <Ionicons name="person-add-outline" size={18} color={ORANGE} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    {receiver ? (
                      <>
                        <Text style={styles.rvReceiverName} numberOfLines={1}>
                          {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                        </Text>
                        <Text style={styles.rvReceiverSub} numberOfLines={1}>
                          {receiver.receiver_phone || receiver.phone_number || '—'}
                        </Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.rvReceiverName, { color: ORANGE }]}>Select receiver</Text>
                        <Text style={styles.rvReceiverSub}>Who will receive this package?</Text>
                      </>
                    )}
                  </View>
                  {receiver ? (
                    <View style={styles.rvChangePill}>
                      <Text style={styles.rvChangeText}>Change</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={ORANGE} />
                  )}
                </TouchableOpacity>

                {receiver && (
                  <View style={styles.rvNote}>
                    <Ionicons name="qr-code-outline" size={14} color={colors.textSecondary} />
                    <Text style={styles.rvNoteText}>
                      Show your pickup QR or PIN when the courier arrives. A delivery OTP follows for the receiver.
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.rvCard}>
                {pricing ? (
                  <View style={styles.rvFareRows}>
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Base fee</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.base.toFixed(2)}</Text>
                    </View>
                    <View style={styles.rvFareRow}>
                      <Text style={styles.rvFareLabel}>Distance · {pricing.distanceKm.toFixed(1)} km</Text>
                      <Text style={styles.rvFareValue}>₱{pricing.distance.toFixed(2)}</Text>
                    </View>
                    {pricing.size > 0 && (
                      <View style={styles.rvFareRow}>
                        <Text style={styles.rvFareLabel}>Package size</Text>
                        <Text style={styles.rvFareValue}>₱{pricing.size.toFixed(2)}</Text>
                      </View>
                    )}
                    {pricing.fragile > 0 && (
                      <View style={styles.rvFareRow}>
                        <Text style={styles.rvFareLabel}>Fragile handling</Text>
                        <Text style={styles.rvFareValue}>₱{pricing.fragile.toFixed(2)}</Text>
                      </View>
                    )}
                    {pricing.schedule > 0 && (
                      <View style={styles.rvFareRow}>
                        <Text style={styles.rvFareLabel}>Scheduled delivery</Text>
                        <Text style={styles.rvFareValue}>₱{pricing.schedule.toFixed(2)}</Text>
                      </View>
                    )}
                    {pricing.emergency > 0 && (
                      <View style={styles.rvFareRow}>
                        <Text style={styles.rvFareLabel}>Emergency priority</Text>
                        <Text style={styles.rvFareValue}>₱{pricing.emergency.toFixed(2)}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.rvCalcRow}>
                    <ActivityIndicator size="small" color={ORANGE} />
                    <Text style={styles.rvFareLabel}>Calculating fare…</Text>
                  </View>
                )}
              </View>

            </ScrollView>

            <View style={styles.sheetFooter}>
              <View style={styles.rvTotalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rvTotalLabel}>Total{refiningDistance ? ' · updating…' : ''}</Text>
                  <View style={styles.rvEscrowRow}>
                    <Ionicons name="shield-checkmark-outline" size={12} color={colors.success} />
                    <Text style={styles.rvEscrowText}>Held in escrow until delivery</Text>
                  </View>
                </View>
                <Text style={styles.rvTotalValue}>
                  ₱{pricing ? pricing.total.toFixed(2) : (displayCost?.toFixed(2) || '0.00')}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  ((!receiver || !pricing) || savingBooking) && styles.primaryButtonDisabled,
                ]}
                onPress={handleProceedToPayment}
                disabled={!receiver || !pricing || savingBooking}
                activeOpacity={0.9}
              >
                {savingBooking ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="card-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>
                      {pricing ? 'Proceed to Payment' : 'Calculating fare…'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {!receiver && <Text style={styles.primaryButtonHint}>Select a receiver first to enable payment</Text>}
            </View>
          </Animated.View>
        )}

        {/* --- FINDING STATE --- */}
        {bookingState === 'finding' && (
          <Animated.View style={[styles.sheetCardFinding, sheetFadeUp]} pointerEvents="box-none">
            <View style={{ width: '100%', alignItems: 'center', paddingTop: 8 }}>
              <View style={styles.sheetHandle} />
            </View>

            <ScrollView
              style={styles.findingScrollView}
              contentContainerStyle={[styles.findingScrollContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.findingTopRow}>
                <View style={styles.radarContainer}>
                  <View style={[styles.radarGuideRing, { width: 56, height: 56, borderRadius: 28 }]} />
                  <View style={[styles.radarGuideRing, { width: 80, height: 80, borderRadius: 40 }]} />

                  {[radarAnim1, radarAnim2, radarAnim3].map((anim, i) => (
                    <Animated.View
                      key={i}
                      style={[
                        styles.radarWaveRing,
                        {
                          transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
                          opacity: anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.4 - i * 0.08, 0] }),
                        },
                      ]}
                    />
                  ))}

                  <Animated.View
                    style={[
                      styles.radarHalo,
                      {
                        transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] }) }],
                        opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.5] }),
                      },
                    ]}
                  />

                  <Animated.View
                    style={[
                      styles.radarCenterCore,
                      { transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] },
                    ]}
                  >
                    <Ionicons name="location" size={16} color="#FFFFFF" />
                  </Animated.View>
                </View>

                <View style={styles.findingTextGroup}>
                  <View style={styles.findingTitleRow}>
                    <Text style={styles.findingTitle}>
                      {longSearch ? 'Still searching' : 'Finding provider'}
                    </Text>
                    <Text style={[styles.findingTitle, styles.findingDots]}>{'.'.repeat(dotCount)}</Text>
                  </View>
                  <Animated.View
                    style={[
                      styles.findingSubWrap,
                      longSearch ? null : {
                        opacity: textAnim,
                        transform: [{ translateY: textAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
                      },
                    ]}
                  >
                    <Text style={styles.findingSub}>
                      {longSearch
                        ? "Taking longer than usual. You can leave this screen — we'll keep looking."
                        : FINDING_STATUS_MESSAGES[statusIndex]}
                    </Text>
                  </Animated.View>
                </View>
              </View>

              <View style={styles.findingInfoRow}>
                {receiver && (
                  <View style={styles.searchingReceiverMiniCard}>
                    <View style={styles.searchMiniAvatar}>
                      <Ionicons name="person" size={15} color="#FFFFFF" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.searchMiniLabelRow}>
                        <Text style={styles.searchMiniLabel}>RECIPIENT</Text>
                        <Ionicons name="shield-checkmark" size={12} color="#7C3AED" />
                      </View>
                      <Text style={styles.searchMiniName} numberOfLines={1}>
                        {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Receiver'}
                      </Text>
                      <Text style={styles.searchMiniPhone} numberOfLines={1}>
                        {receiver.receiver_phone || receiver.phone_number || 'No Phone'}
                      </Text>
                    </View>
                  </View>
                )}

                <View style={[styles.searchCostOnlyBox, !receiver && { flex: 1 }]}>
                  <Text style={styles.searchCostLabel}>TOTAL FARE</Text>
                  <Text style={styles.searchCostValue}>
                    ₱{pricing ? pricing.total.toFixed(2) : (displayCost?.toFixed(2) || '0.00')}
                  </Text>
                </View>
              </View>

              <View style={styles.progressContainer}>
                <Animated.View
                  style={[
                    styles.progressBar,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>

              <TouchableOpacity style={styles.cancelTextButton} onPress={handleCancelBooking} activeOpacity={0.85}>
                <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                <Text style={styles.cancelTextButtonLabel}>Cancel Search</Text>
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        )}

        {/* --- MATCHED / SELECTED PROVIDER STATE --- */}
        {bookingState === 'matched' && matchFound && (
          <Animated.View style={[styles.sheetCardMatched, styles.sheetCardCapped, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <ScrollView
              style={styles.sheetScroll}
              contentContainerStyle={styles.sheetScrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              bounces={false}
            >
              <View style={styles.matchedHeader}>
                <View style={styles.matchedHeaderIcon}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchedHeaderTitle}>
                    {isDirectPreferredProvider ? 'Request Sent to Provider!' : 'Provider Matched!'}
                  </Text>
                  <Text style={styles.matchedHeaderSub}>
                    {isDirectPreferredProvider
                      ? 'Your selected courier partner has been notified along this route'
                      : 'Your delivery partner is on the way'}
                  </Text>
                </View>
              </View>

              <View style={styles.matchedInnerCard}>
                <View style={styles.matchedRow}>
                  <View style={styles.matchedLeftCol}>
                    <View style={styles.matchedAvatarCircle}>
                      <Ionicons name="person" size={28} color="#FFFFFF" />
                    </View>
                    <View style={styles.matchedVerifiedBadge}>
                      <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                    </View>
                  </View>
                  <View style={styles.matchedRightCol}>
                    <Text style={styles.matchedName} numberOfLines={1}>
                      {providerData ? `${providerData.first_name} ${providerData.last_name}` : 'Loading...'}
                    </Text>
                    <View style={styles.carDetailBox}>
                      <View style={styles.carDetailRow}>
                        <Ionicons name="car-sport-outline" size={12} color={colors.textSecondary} />
                        <Text style={styles.carText} numberOfLines={1}>{providerData?.vehicle_type || 'Loading...'}</Text>
                      </View>
                      <View style={styles.carDetailRow}>
                        <Ionicons name="pricetag-outline" size={12} color={colors.textSecondary} />
                        <Text style={styles.carText}>{providerData?.plate_number || 'Loading...'}</Text>
                      </View>
                      {departureTime && (
                        <View style={styles.carDetailRow}>
                          <Ionicons name="time-outline" size={12} color={colors.textSecondary} />
                          <Text style={styles.carText}>
                            Departure: {formatDepartureTime(departureTime)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>

                {providerRating && (
                  <>
                    <View style={styles.matchedDivider} />
                    <View style={styles.ratingSummaryRow}>
                      <View style={styles.ratingStarsInline}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <Ionicons
                            key={n}
                            name={n <= Math.round(providerRating.avg) ? 'star' : 'star-outline'}
                            size={14}
                            color={colors.warning}
                          />
                        ))}
                      </View>
                      <Text style={styles.ratingAvgText}>
                        {providerRating.count > 0
                          ? `${providerRating.avg.toFixed(1)} · ${providerRating.count} review${providerRating.count === 1 ? '' : 's'}`
                          : 'No reviews yet'}
                      </Text>
                    </View>

                    {providerRating.recent.length > 0 && (
                      <View style={styles.recentReviewsWrap}>
                        {providerRating.recent.map((r, i) => (
                          <View key={i} style={styles.recentReviewItem}>
                            <View style={styles.recentReviewHead}>
                              {[1, 2, 3, 4, 5].map(n => (
                                <Ionicons
                                  key={n}
                                  name={n <= r.rating ? 'star' : 'star-outline'}
                                  size={11}
                                  color={colors.warning}
                                />
                              ))}
                            </View>
                            {!!r.comment && (
                              <Text style={styles.recentReviewComment} numberOfLines={2}>
                                "{r.comment}"
                              </Text>
                            )}
                          </View>
                        ))}
                      </View>
                    )}
                  </>
                )}

                {receiver && (
                  <>
                    <View style={styles.matchedDivider} />
                    <View style={styles.matchedReceiverRow}>
                      <Ionicons name="person-circle-outline" size={16} color={colors.textSecondary} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.matchedReceiverLabel}>CONFIRMED RECEIVER</Text>
                        <Text style={styles.matchedReceiverName} numberOfLines={1}>
                          {receiver.receiver_name || `${receiver.first_name || ''} ${receiver.last_name || ''}`.trim() || 'Selected Receiver'}
                        </Text>
                        <Text style={styles.matchedReceiverPhone} numberOfLines={1}>
                          {receiver.receiver_phone || receiver.phone_number || '—'}
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <View style={styles.otpSentBanner}>
                  <Ionicons name="qr-code-outline" size={16} color={colors.success} />
                  <Text style={styles.otpSentText}>
                    Show your pickup QR code when the courier arrives
                  </Text>
                </View>

                <View style={styles.matchedDivider} />
                <View style={styles.totalRow}>
                  <View>
                    <Text style={styles.totalLabel}>Total paid</Text>
                    <Text style={styles.totalPaidBadge}>Held in escrow</Text>
                  </View>
                  <Text style={styles.totalValue}>
                    ₱{pricing ? pricing.total.toFixed(2) : (displayCost?.toFixed(2) || '0.00')}
                  </Text>
                </View>
              </View>

            </ScrollView>

            <View style={styles.sheetFooter}>
              <TouchableOpacity style={styles.confirmButton} onPress={handleConfirmAction} activeOpacity={0.9}>
                <Text style={styles.confirmButtonText}>Confirm & Proceed</Text>
                <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* --- NO MATCH STATE --- */}
        {bookingState === 'no_match' && (
          <Animated.View style={[styles.sheetCardNoMatch, sheetFadeUp, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.noMatchIconCircle}>
              <Ionicons name="cloud-offline-outline" size={36} color={ORANGE} />
            </View>
            <Text style={styles.noMatchTitle}>No Provider Available</Text>
            <Text style={styles.noMatchSubtitle}>
              We couldn't find an available provider on this route right now. Please try again or modify your request.
            </Text>

            <View style={styles.noMatchActions}>
              <TouchableOpacity
                style={[styles.noMatchBtn, styles.retryBtn]}
                onPress={handleTryAgain}
                activeOpacity={0.9}
              >
                <Ionicons name="refresh" size={15} color="#FFFFFF" />
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.noMatchBtn, styles.modifyBtn]}
                onPress={handleGoHome}
                activeOpacity={0.9}
              >
                <Ionicons name="home-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.modifyBtnText}>Go Home</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  map: { ...StyleSheet.absoluteFill },

  topOverlay: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', zIndex: 10 },
  backCircleBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.4 : 0.12, shadowRadius: 8, elevation: 5,
    marginRight: 12, borderWidth: 1, borderColor: c.border,
  },

  bottomSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center' },
  bottomSheetFinding: { bottom: 0 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 6 },

  sheetCard: {
    backgroundColor: c.card, width: '100%', paddingHorizontal: 24, paddingTop: 6,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 12,
  },
  sheetCardCapped: { maxHeight: SHEET_MAX_H },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetScrollContent: { paddingBottom: 8 },
  sheetFooter: { paddingTop: 10, borderTopWidth: 1, borderTopColor: c.divider },
  /* review sheet */
  rvHeader: { marginBottom: 12 },
  rvTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  preferredProviderBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.accentSoft, borderWidth: 1, borderColor: ORANGE,
    borderRadius: 16, padding: 12, marginBottom: 10,
  },
  preferredProviderIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
  },
  preferredProviderLabel: { fontSize: 9, fontWeight: '800', color: ORANGE, letterSpacing: 0.8 },
  preferredProviderName: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 1 },
  preferredProviderRoute: { fontSize: 11, fontWeight: '600', color: c.textSecondary, marginTop: 2 },

  rvCard: {
    backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: c.border,
    marginBottom: 10, overflow: 'hidden',
  },
  rvCardEmpty: { borderStyle: 'dashed', borderColor: ORANGE, backgroundColor: c.accentSoft },

  rvReceiverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rvAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  rvAvatarEmpty: { backgroundColor: c.card, borderWidth: 1.5, borderColor: ORANGE },
  rvAvatarText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  rvReceiverName: { fontSize: 15, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  rvReceiverSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, fontWeight: '500' },
  rvChangePill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  rvChangeText: { fontSize: 12, fontWeight: '700', color: ORANGE },
  rvNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  rvNoteText: { flex: 1, fontSize: 11, lineHeight: 15, color: c.textSecondary, fontWeight: '500' },

  rvFareRows: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  rvFareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  rvFareLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  rvFareValue: { fontSize: 13, color: c.textPrimary, fontWeight: '700' },
  rvCalcRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14 },
  rvTotalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 4, paddingBottom: 12,
  },
  rvTotalLabel: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  rvEscrowRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  rvEscrowText: { fontSize: 11, color: c.textMuted, fontWeight: '500' },
  rvTotalValue: { fontSize: 22, fontWeight: '900', color: ORANGE, letterSpacing: -0.5 },

  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.textPrimary, borderRadius: 16, paddingVertical: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 8, elevation: 4,
  },
  primaryButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  primaryButtonText: { color: c.card, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  primaryButtonHint: { textAlign: 'center', fontSize: 11, color: c.textMuted, marginTop: 8, fontWeight: '500' },

  sheetCardFinding: {
    width: '100%', backgroundColor: c.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 12,
    maxHeight: height * 0.45, minHeight: 320,
  },
  findingScrollView: { flex: 1, width: '100%' },
  findingScrollContent: { paddingHorizontal: 20, paddingTop: 10, alignItems: 'center' },

  findingTopRow: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    marginTop: 4, marginBottom: 16,
  },

  radarContainer: {
    width: 80, height: 80,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 16,
  },
  radarGuideRing: { position: 'absolute', borderWidth: 1, borderColor: ORANGE, opacity: 0.15 },
  radarWaveRing: {
    position: 'absolute', width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: ORANGE, backgroundColor: 'rgba(242,112,36,0.08)',
  },
  radarHalo: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(242,112,36,0.14)' },
  radarCenterCore: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 5, zIndex: 2,
  },

  findingTextGroup: { flex: 1, alignItems: 'flex-start' },
  findingTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  findingTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  findingDots: { width: 20, textAlign: 'left', color: ORANGE },
  findingSubWrap: { minHeight: 36, justifyContent: 'flex-start' },
  findingSub: { fontSize: 12, lineHeight: 16, color: c.textSecondary, fontWeight: '500' },

  findingInfoRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10, width: '100%', marginBottom: 12 },
  searchingReceiverMiniCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.accentSoft, borderWidth: 1, borderColor: ORANGE,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchMiniAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  searchMiniLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 },
  searchMiniLabel: { fontSize: 10, fontWeight: '800', color: ORANGE, letterSpacing: 0.8 },
  searchMiniName: { fontSize: 14, fontWeight: '700', color: c.textPrimary },
  searchMiniPhone: { fontSize: 12, fontWeight: '500', color: c.textSecondary, marginTop: 1 },

  searchCostOnlyBox: {
    minWidth: 104, backgroundColor: c.background, borderWidth: 1, borderColor: c.border,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  searchCostLabel: { fontSize: 10, fontWeight: '800', color: c.textSecondary, letterSpacing: 0.8, marginBottom: 2 },
  searchCostValue: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4 },

  progressContainer: { width: '100%', height: 5, backgroundColor: c.divider, borderRadius: 3, marginBottom: 16, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: ORANGE, borderRadius: 3 },

  cancelTextButton: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: c.errorBg, borderWidth: 1, borderColor: c.error,
  },
  cancelTextButtonLabel: { color: c.error, fontWeight: '700', fontSize: 15 },

  sheetCardMatched: {
    width: '100%', backgroundColor: c.card, paddingHorizontal: 24, paddingTop: 8,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 12,
  },
  matchedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  matchedHeaderIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: c.successBg,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.success,
  },
  matchedHeaderTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  matchedHeaderSub: { fontSize: 11, color: c.textSecondary, fontWeight: '500', marginTop: 2 },
  matchedInnerCard: {
    borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 14,
    backgroundColor: c.background, marginBottom: 14,
  },
  matchedRow: { flexDirection: 'row', alignItems: 'center' },
  matchedLeftCol: { width: 70, alignItems: 'center', marginRight: 14, position: 'relative' },
  matchedAvatarCircle: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: c.card,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  matchedVerifiedBadge: {
    position: 'absolute', bottom: 0, right: 4, width: 20, height: 20, borderRadius: 10,
    backgroundColor: c.success,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: c.card,
  },
  noMatchModifyLink: { marginTop: 14, alignItems: 'center' },
  noMatchModifyLinkText: { fontSize: 12, fontWeight: '700', color: c.textMuted, textDecorationLine: 'underline' },
  matchedRightCol: { flex: 1 },
  matchedName: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 6, letterSpacing: -0.2 },
  carDetailBox: { gap: 3 },
  carDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  carText: { fontSize: 11, color: c.textSecondary, fontWeight: '600' },
  matchedDivider: { height: 1, backgroundColor: c.border, marginVertical: 10 },
  matchedReceiverRow: { flexDirection: 'row', alignItems: 'center' },
  matchedReceiverLabel: { fontSize: 9, fontWeight: '800', color: c.textSecondary, letterSpacing: 0.8, marginBottom: 2 },
  matchedReceiverName: { fontSize: 13, fontWeight: '700', color: c.textPrimary },
  matchedReceiverPhone: { fontSize: 11, color: c.textSecondary, marginTop: 1, fontWeight: '500' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  totalValue: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  totalPaidBadge: { fontSize: 10, color: c.success, fontWeight: '700', marginTop: 2 },

  ratingSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  ratingStarsInline: { flexDirection: 'row', gap: 2 },
  ratingAvgText: { fontSize: 12, fontWeight: '800', color: c.textPrimary },
  recentReviewsWrap: { marginTop: 10, gap: 8 },
  recentReviewItem: {
    backgroundColor: isDark ? '#2A1F0A' : '#FFFBEB',
    borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: c.warning,
  },
  recentReviewHead: { flexDirection: 'row', gap: 2, marginBottom: 4 },
  recentReviewComment: {
    fontSize: 12, color: isDark ? '#FCD34D' : '#78350F',
    fontWeight: '600', lineHeight: 16,
  },

  confirmButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.textPrimary, borderRadius: 16, paddingVertical: 16, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.4 : 0.15, shadowRadius: 8, elevation: 4,
  },
  confirmButtonText: { color: c.card, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  otpSentBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.successBg, borderRadius: 12, padding: 10, marginTop: 10,
    borderWidth: 1, borderColor: c.success,
  },
  otpSentText: { flex: 1, fontSize: 12, color: c.success, fontWeight: '600' },

  sheetCardNoMatch: {
    width: '100%', backgroundColor: c.card, paddingHorizontal: 24, paddingTop: 8,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 12,
  },
  noMatchIconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12, marginTop: 2, borderWidth: 1, borderColor: ORANGE,
  },
  noMatchTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, marginBottom: 4, letterSpacing: -0.3, textAlign: 'center' },
  noMatchSubtitle: {
    fontSize: 12, color: c.textSecondary, textAlign: 'center',
    lineHeight: 18, marginBottom: 18, paddingHorizontal: 10, fontWeight: '500',
  },
  noMatchActions: { flexDirection: 'row', gap: 12, width: '100%' },
  noMatchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: 16, gap: 6 },
  retryBtn: { backgroundColor: ORANGE, shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 3 },
  retryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
  modifyBtn: { backgroundColor: c.divider, borderWidth: 1, borderColor: c.border },
  modifyBtnText: { color: c.textSecondary, fontWeight: '700', fontSize: 13, letterSpacing: 0.2 },
});