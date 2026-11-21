// src/modules/Dashboard/Provider/ProviderNavigationScreen.tsx
//
// Multi-stop navigation ("trip"). Opened from the Jobs screen with the "Drive now" button.
// It drives to the NEXT stop of the auto-sorted trip (pickups and drop-offs in the shortest order, never
// backtracking). When a parcel is picked up its drop-off unlocks and the trip re-sorts itself.
//
// Route params (all optional):
//   routeId      keep only the orders of this posted route (plus orders without a route)
//   deliveryIds  keep only these deliveries
//   deliveryId   legacy single-order mode (same as deliveryIds: [deliveryId])
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator,
  Animated, PanResponder, Dimensions, ScrollView, Modal, Pressable, Image, Alert, Linking,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NavigationMap, { NavInfo, NavStatus, NavigationMapHandle, MapStop, EndPoint } from '../../../components/map/NavigationMap';
import { fmtDistance, fmtDuration } from '../../../components/map/directions';
import { supabase } from '../../../utils/supabase';
import { getProviderDeliveries, SHIPMENT_SIZE_SPECS } from '../../../services/matchingService';
import { setNavigationSession, clearNavigationSession } from '../../../services/navigationSessionStore';
import { useNavLocation } from '../../../services/navLocationStore';
import { ordersFromDeliveries, planTrip, tripSignature, toTripPoint, TripOrder, TripStop } from '../../../services/tripPlanner';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';
import { Ionicons } from '@expo/vector-icons';
import { useReconnectEpoch } from '../../../services/connectivityStore';
<<<<<<< Updated upstream
=======
import { triggerDeliverySmsMilestone } from '../../../services/autoSmsService';
import { getOrCreateChatRoom } from '../../../utils/chatHelpers';
import { formatDateTime } from '../../../utils/dateUtils';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const BLUE = '#3B82F6';
const PURPLE = '#8B5CF6';
const money = (n: any) => `₱${Number(n || 0).toFixed(2)}`;
const initials = (n?: string | null) =>
  (n || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

>>>>>>> Stashed changes

// distances are always shown in METERS (1,240 m)
const fmtMeters = (m: number | null | undefined) =>
  m == null || !isFinite(m) ? '— m' : `${Math.max(0, Math.round(m)).toLocaleString('en-US')} m`;

const { height: SCREEN_H } = Dimensions.get('window');

// Panel heights for the resizable bottom sheet
const COLLAPSED_HEIGHT = 200;
const EXPANDED_HEIGHT = SCREEN_H * 0.72;
const SNAP_THRESHOLD = 100;
const POLL_MS = 15000;

type Phase = 'loading' | 'ready' | 'empty' | 'error';

const CARGO_PHOTO_BUCKET = 'cargo-photos';

const toPhotoUrl = (v: any): string | null => {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(file|content):/i.test(v)) return null;
  try {
    return supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(v.replace(/^\/+/, '')).data.publicUrl;
  } catch { return null; }
};

const buildCargoItems = (cargo: any) => {
  let itemsJson: any = cargo?.items_json;
  if (typeof itemsJson === 'string') {
    try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
  }
  if (Array.isArray(itemsJson) && itemsJson.length > 0) {
    const items = itemsJson.map((it: any) => ({
      description: it?.description || `${it?.size || 'Standard'} package`,
      size: (it?.size ?? null) as string | null,
      fragile: !!it?.fragile,
      photo: toPhotoUrl(it?.photo),
    }));
    const fallback = toPhotoUrl(cargo?.cargo_pic);
    if (fallback && !items.some((i: any) => i.photo)) items[0].photo = fallback;
    return items;
  }
  return [{
    description: cargo?.description || 'Package',
    size: null as string | null,
    fragile: !!cargo?.is_fragile,
    photo: toPhotoUrl(cargo?.cargo_pic),
  }];
};

type PkgDetails = {
  deliveryId: number;
  code: string;
  items: { description: string; size: string | null; fragile: boolean; photo: string | null }[];
  counts: Record<'Small' | 'Medium' | 'Large', number>;
  totalItems: number;
  weightKg: number | null;
  fragile: boolean;
  photo: string | null;
  pickup: string;
  dropoff: string;
};

const buildPkgDetails = (d: any): PkgDetails => {
  const req = d?.delivery_requests || {};
  const cargo = Array.isArray(req.cargo) ? req.cargo[0] : req.cargo;
  const items = buildCargoItems(cargo);
  const counts = { Small: 0, Medium: 0, Large: 0 };
  items.forEach(it => { if (it.size && (counts as any)[it.size] != null) (counts as any)[it.size] += 1; });
  if (!counts.Small && !counts.Medium && !counts.Large) {
    counts.Small = Number(cargo?.small_box_qty) || 0;
    counts.Medium = Number(cargo?.medium_box_qty) || 0;
    counts.Large = Number(cargo?.large_box_qty) || 0;
  }
  const qtyTotal = counts.Small + counts.Medium + counts.Large;
  const pk = toTripPoint(req.pickup_location);
  const dr = toTripPoint(req.dropoff_location);
  return {
    deliveryId: Number(d.delivery_id),
    code: `PNS-${String(d.request_id ?? d.delivery_id).padStart(4, '0')}`,
    items,
    counts,
    totalItems: items.length > 1 ? items.length : (qtyTotal || items.length),
    weightKg: cargo?.total_weight_kg != null ? Number(cargo.total_weight_kg) : null,
    fragile: items.some(i => i.fragile) || !!cargo?.is_fragile,
    photo: items.find(i => !!i.photo)?.photo ?? null,
    pickup: pk?.main || 'Pickup',
    dropoff: dr?.main || 'Drop-off',
  };
};

// ---- order details (mirrors the Task screen's detail view) ----
const PLUS_CODE = /[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}/i;
const isCodeLike = (s: string) => {
  const x = (s ?? '').trim();
  if (!x) return true;
  if (/^unknown$/i.test(x)) return true;
  if (PLUS_CODE.test(x)) return true;
  return /^[A-Za-z0-9+\-_.]{6,}$/.test(x) && /\d/.test(x) && /[A-Za-z]/.test(x);
};
const readableParts = (a?: string | null): string[] =>
  (a ?? '').replace(PLUS_CODE, '').split(',').map(p => p.trim())
    .filter(p => p && !isCodeLike(p) && !/^\d{4,6}$/.test(p));

const describePlace = (l: any): { main: string; road: string } => {
  const parts = readableParts(l?.street_address);
  const name = typeof l?.place_name === 'string' && !isCodeLike(l.place_name) ? l.place_name.trim() : '';
  const road = typeof l?.road === 'string' && !isCodeLike(l.road) ? l.road.trim() : '';
  const brgy = typeof l?.barangay === 'string' && !isCodeLike(l.barangay) ? l.barangay.trim() : '';
  const localities = [l?.city, l?.province, l?.barangay]
    .filter((v: any) => typeof v === 'string').map((v: string) => v.trim().toLowerCase());
  const placeParts = parts.filter(p => !localities.includes(p.toLowerCase()));
  const main = name || placeParts[0] || road || brgy || parts[0] || 'Selected location';
  const street = road || placeParts.find(p => p !== main) || '';
  const city = typeof l?.city === 'string' && !isCodeLike(l.city) ? l.city.trim() : '';
  const bottom = [street && street !== main ? street : '', brgy && brgy !== main ? brgy : '']
    .filter(Boolean).join(', ')
    || parts.slice(1, 3).join(', ')
    || (city && city !== main ? city : '');
  return { main, road: bottom };
};

const buildOrderInfo = (d: any) => {
  const request = d?.delivery_requests || null;
  const cargo = Array.isArray(request?.cargo) ? request.cargo[0] : request?.cargo;
  const receiver = Array.isArray(request?.receiver) ? request.receiver[0] : request?.receiver;
  const dims = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const deposit = Number(request?.return_deposit) || 0;
  const est = Number(request?.estimated_cost) || 0;
  const baseFare = Number(request?.base_fare) || Math.max(0, est - deposit);
  const status = String(request?.delivery_status || '');
  const net = Math.round((Number(request?.base_fare) || 0) * 0.85 * 100) / 100;
  const earnings = status === 'Returned' ? ((net + deposit) || est) : status === 'Completed' ? (net || est) : est;
  return {
    serviceLabel: /door/i.test(String(request?.pickup_type || '')) ? 'Door-to-Door' : 'Curb-side',
    isDoor: /door/i.test(String(request?.pickup_type || '')),
    scheduledTime: (request?.scheduled_time as string | null) || null,
    pickup: describePlace(request?.pickup_location),
    dropoff: describePlace(request?.dropoff_location),
    pickupNote: (request?.pickup_note as string | null) || null,
    dropoffNote: (request?.dropoff_note as string | null) || null,
    receiverName: (receiver?.receiver_name as string | null) || null,
    receiverPhone: (request?.receiver_phone || receiver?.receiver_phone || null) as string | null,
    senderId: (request?.sender_id ?? null) as number | null,
    dims: dims.every(v => Number(v) > 0) ? `${dims[0]} × ${dims[1]} × ${dims[2]} cm` : null,
    baseFare,
    platformFee: Math.round(baseFare * 0.15 * 100) / 100,
    returnDeposit: deposit,
    totalPaid: est,
    isReturned: status === 'Returned',
    earnings,
    paymentProvider: (request?.payment_provider as string | null) || null,
    pickupPhoto: toPhotoUrl(d?.pickup_photo_url) || (typeof d?.pickup_photo_url === 'string' ? d.pickup_photo_url : null),
    pickupPhotoAt: (d?.pickup_photo_taken_at as string | null) || null,
  };
};

const SIZE_META: Record<'Small' | 'Medium' | 'Large', { letter: string; kg: string; color: string; bg: string }> = {
  Small:  { letter: 'S', kg: `${SHIPMENT_SIZE_SPECS.Small.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Small.inchesLabel}`,  color: '#0284C7', bg: 'rgba(2,132,199,0.12)' },
  Medium: { letter: 'M', kg: `${SHIPMENT_SIZE_SPECS.Medium.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Medium.inchesLabel}`, color: '#D97706', bg: 'rgba(217,119,6,0.14)' },
  Large:  { letter: 'L', kg: `${SHIPMENT_SIZE_SPECS.Large.weightRangeLabel} · ${SHIPMENT_SIZE_SPECS.Large.inchesLabel}`, color: '#7C3AED', bg: 'rgba(124,58,237,0.12)' },
};

export default function ProviderNavigationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const routeId: number | null = route.params?.routeId != null ? Number(route.params.routeId) : null;
  const onlyIds: number[] | null = useMemo(() => {
    const p = route.params;
    if (Array.isArray(p?.deliveryIds) && p.deliveryIds.length) return p.deliveryIds.map(Number);
    if (p?.deliveryId != null) return [Number(p.deliveryId)];
    return null;
  }, [route.params]);
  const onlyIdsKey = onlyIds ? onlyIds.join(',') : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [orders, setOrders] = useState<TripOrder[]>([]);
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [info, setInfo] = useState<NavInfo>({ distanceM: null, durationS: null });
  const [status, setStatus] = useState<NavStatus>('locating');
  const [providerId, setProviderId] = useState<number | null>(null);
  const [rawDeliveries, setRawDeliveries] = useState<any[]>([]);
  const paramEnd = route.params?.routeEnd as { lat: number; lng: number; title?: string; sub?: string } | null | undefined;
  const [endPoint, setEndPoint] = useState<EndPoint | null>(
    paramEnd && Number.isFinite(Number(paramEnd.lat)) && Number.isFinite(Number(paramEnd.lng))
      ? { coordinate: { latitude: Number(paramEnd.lat), longitude: Number(paramEnd.lng) }, title: paramEnd.title }
      : null,
  );
  const paramStart = route.params?.routeStart as { lat: number; lng: number; title?: string; sub?: string } | null | undefined;
  const [startPoint, setStartPoint] = useState<EndPoint | null>(
    paramStart && Number.isFinite(Number(paramStart.lat)) && Number.isFinite(Number(paramStart.lng))
      ? { coordinate: { latitude: Number(paramStart.lat), longitude: Number(paramStart.lng) }, title: paramStart.title }
      : null,
  );
  const [routeLine, setRouteLine] = useState<{ latitude: number; longitude: number }[] | null>(null);
  const [pkgDeliveryId, setPkgDeliveryId] = useState<number | null>(null);
  const [orderExtra, setOrderExtra] = useState<Record<number, { sender: any | null; escrowStatus: string | null }>>({});
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  // sender contact + payment status are not part of the trip list, so load them when an order is opened
  useEffect(() => {
    if (pkgDeliveryId == null) return;
    const dRaw = rawDeliveries.find(x => Number(x?.delivery_id) === pkgDeliveryId);
    if (!dRaw) return;
    const senderId = dRaw?.delivery_requests?.sender_id ?? null;
    let cancelled = false;
    (async () => {
      let sender: any = null;
      let escrowStatus: string | null = null;
      try {
        if (senderId != null) {
          const { data } = await supabase.from('users').select('user_id, first_name, last_name, phone_number').eq('user_id', senderId).maybeSingle();
          sender = data || null;
        }
      } catch { /* optional */ }
      try {
        const { data } = await supabase.from('escrow_payments').select('escrow_status').eq('delivery_id', pkgDeliveryId).limit(1).maybeSingle();
        escrowStatus = (data as any)?.escrow_status ?? null;
      } catch { /* optional */ }
      if (!cancelled) setOrderExtra(prev => ({ ...prev, [pkgDeliveryId]: { sender, escrowStatus } }));
    })();
    return () => { cancelled = true; };
  }, [pkgDeliveryId]);
  const [trafficOn, setTrafficOn] = useState(true);
  const netEpoch = useReconnectEpoch();   // +1 every time the internet comes back
  const mapHandle = useRef<NavigationMapHandle>(null);
  const readyRef = useRef(false);
  const aliveRef = useRef(true);

  const loc = useNavLocation(true);
  const fixRef = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    fixRef.current = loc.fix ? { lat: loc.fix.latitude, lng: loc.fix.longitude } : null;
    // the first GPS fix decides where the trip is sorted from
    if (loc.fix && origin == null) setOrigin({ lat: loc.fix.latitude, lng: loc.fix.longitude });
  }, [loc.fix, origin]);

  // --- Bottom Panel Drag Logic ---
  const panAnim = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const currentHeight = useRef(COLLAPSED_HEIGHT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        const newHeight = currentHeight.current - g.dy;
        if (newHeight >= COLLAPSED_HEIGHT - 20 && newHeight <= EXPANDED_HEIGHT + 50) panAnim.setValue(newHeight);
      },
      onPanResponderRelease: (_, g) => {
        const newHeight = currentHeight.current - g.dy;
        let snapTo = COLLAPSED_HEIGHT;
        if (newHeight > COLLAPSED_HEIGHT + SNAP_THRESHOLD) snapTo = EXPANDED_HEIGHT;
        currentHeight.current = snapTo;
        Animated.spring(panAnim, { toValue: snapTo, useNativeDriver: false, bounciness: 4 }).start();
      },
    })
  ).current;

  const togglePanel = () => {
    const snapTo = currentHeight.current === COLLAPSED_HEIGHT ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    currentHeight.current = snapTo;
    Animated.spring(panAnim, { toValue: snapTo, useNativeDriver: false, bounciness: 4 }).start();
  };

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const loadOrders = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (aliveRef.current && !readyRef.current) setPhase('error'); return; }

      const { data: me, error: meErr } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
      if (meErr || !me) throw meErr || new Error('No profile');
      if (aliveRef.current) setProviderId(Number(me.user_id));

      const list: any[] = (await getProviderDeliveries(me.user_id)) || [];
      if (!aliveRef.current) return;
      setRawDeliveries(list);

      let next = ordersFromDeliveries(list, onlyIds ? null : routeId);
      if (onlyIds) next = next.filter(o => onlyIds.includes(o.deliveryId));

      // keep the previous array when nothing changed, so we do not re-sort / re-render for nothing
      setOrders(prev => {
        const sig = (a: TripOrder[]) => a.map(o => `${o.deliveryId}:${o.stage}`).join('|');
        return sig(prev) === sig(next) ? prev : next;
      });
      readyRef.current = true;
      setPhase(next.length ? 'ready' : 'empty');
    } catch {
      if (aliveRef.current && !readyRef.current) setPhase('error');
    }
  }, [routeId, onlyIdsKey]);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { if (netEpoch > 0) void loadOrders(); }, [netEpoch, loadOrders]);

  // the route's final destination (always shown on the map). Uses the route passed in, else the route of the orders.
  const effectiveRouteId: number | null = useMemo(() => {
    if (routeId != null) return routeId;
    const d = rawDeliveries.find(x => x?.route_id != null);
    return d ? Number(d.route_id) : null;
  }, [routeId, rawDeliveries]);

  // road line of the posted route (start -> end). Straight line first, the real road replaces it when it arrives.
  const lineKey = startPoint && endPoint
    ? `${startPoint.coordinate.latitude.toFixed(5)},${startPoint.coordinate.longitude.toFixed(5)}|${endPoint.coordinate.latitude.toFixed(5)},${endPoint.coordinate.longitude.toFixed(5)}`
    : '';
  // Posted-route road line. A line that is already on the map is NEVER erased by a failed request (that is what made it
  // vanish / look broken when the internet dropped): it is only cleared when the route itself changes, and a failed
  // request retries by itself and again as soon as the internet is back.
  const lastLineKey = useRef('');
  useEffect(() => {
    if (!startPoint || !endPoint) { lastLineKey.current = ''; setRouteLine(null); return; }
    if (lastLineKey.current !== lineKey) { lastLineKey.current = lineKey; setRouteLine(null); }
    const a = startPoint.coordinate, b = endPoint.coordinate;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ctrl: AbortController | null = null;

    const load = async (attempt: number) => {
      ctrl = new AbortController();
      const timer = setTimeout(() => ctrl?.abort(), 9000);
      try {
        const res = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`,
          { signal: ctrl.signal },
        );
        const data = await res.json();
        const pts = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code === 'Ok' && Array.isArray(pts) && pts.length > 1) {
          if (!cancelled) setRouteLine(pts.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
          return;
        }
      } catch { /* offline / timeout: retry below */ }
      finally { clearTimeout(timer); }
      if (!cancelled && attempt < 4) retry = setTimeout(() => { void load(attempt + 1); }, 3000 * (attempt + 1));
    };
    void load(0);
    return () => { cancelled = true; if (retry) clearTimeout(retry); ctrl?.abort(); };
  }, [lineKey, netEpoch]);

  useEffect(() => {
    if (effectiveRouteId == null) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('provider_routes')
        .select(
          'start_location:locations!provider_routes_start_location_id_fkey(latitude,longitude,street_address,place_name),' +
          'end_location:locations!provider_routes_end_location_id_fkey(latitude,longitude,street_address,place_name)',
        )
        .eq('route_id', effectiveRouteId)
        .maybeSingle();
      if (cancelled) return;
      const raw: any = (data as any)?.end_location;
      const loc = Array.isArray(raw) ? raw[0] : raw;
      const pt = toTripPoint(loc);
      if (pt) setEndPoint({ coordinate: { latitude: pt.lat, longitude: pt.lng }, title: pt.main, sub: pt.sub } as any);
      const rawS: any = (data as any)?.start_location;
      const sp = toTripPoint(Array.isArray(rawS) ? rawS[0] : rawS);
      if (sp) setStartPoint({ coordinate: { latitude: sp.lat, longitude: sp.lng }, title: sp.main });
    })();
    return () => { cancelled = true; };
  }, [effectiveRouteId]);

  // When an order changes stage (pickup verified, delivered, cancelled) the trip is re-sorted from where the
  // provider is right now, so the remaining stops always stay in the shortest order.
  const ordersSig = orders.map(o => `${o.deliveryId}:${o.stage}`).join('|');
  const lastSigRef = useRef('');
  useEffect(() => {
    if (lastSigRef.current && lastSigRef.current !== ordersSig && fixRef.current) setOrigin(fixRef.current);
    lastSigRef.current = ordersSig;
  }, [ordersSig]);

  // realtime refresh + a slow poll as a safety net
  const idsKey = orders.map(o => `${o.deliveryId}/${o.requestId ?? ''}`).join(',');
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadOrders(); }, 400);
    };
    let ch = supabase.channel(`provider-trip-${providerId ?? 'x'}-${Date.now()}`);
    if (providerId != null) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `provider_id=eq.${providerId}` }, refresh);
    }
    for (const o of orders) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications', filter: `delivery_id=eq.${o.deliveryId}` }, refresh);
      if (o.requestId != null) {
        ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `request_id=eq.${o.requestId}` }, refresh);
      }
    }
    ch.subscribe();
    const poll = setInterval(() => { void loadOrders(); }, POLL_MS);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [providerId, idsKey, loadOrders, netEpoch]);

  // ---- the auto-sorted trip ----
  const plan: TripStop[] = useMemo(() => planTrip(orders, origin), [orders, origin]);
  const current: TripStop | null = plan[0] ?? null;
  const rest = plan.slice(1);

  // package details (photo, sizes, weight) of every active delivery, for the map pins and the details modal
  const pkgMap = useMemo(() => {
    const m: Record<number, PkgDetails> = {};
    for (const d of rawDeliveries) {
      if (d?.delivery_id == null) continue;
      m[Number(d.delivery_id)] = buildPkgDetails(d);
    }
    return m;
  }, [rawDeliveries]);

  // pins for the other stops: pickups, and drop-offs of parcels that are already on board
  const mapStops: MapStop[] = useMemo(
    () => rest
      .map((s, i) => ({ s, order: i + 2 }))
      .filter(({ s }) => !s.locked)
      .map(({ s, order }) => ({
        key: s.key,
        coordinate: { latitude: s.point.lat, longitude: s.point.lng },
        label: s.kind === 'pickup' ? 'P' as const : 'D' as const,
        order,
        photo: pkgMap[s.deliveryId]?.photo ?? null,
      })),
    [rest, pkgMap],
  );

  // every stop after the current one (including drop-offs still locked): the orange line runs through them to the route end
  const routeWaypoints = useMemo(
    () => rest.map(st => ({ latitude: st.point.lat, longitude: st.point.lng })),
    [rest],
  );

  const openStopDetails = useCallback((key: string) => {
    const st = plan.find(x => x.key === key);
    if (st) setPkgDeliveryId(st.deliveryId);
  }, [plan]);

  const curDelivery = current?.deliveryId ?? null;
  const curIsPickup = current?.kind === 'pickup';
  useEffect(() => {
    if (curDelivery == null || !curIsPickup) return;
    setNavigationSession(curDelivery);
    return () => clearNavigationSession(curDelivery);
  }, [curDelivery, curIsPickup]);

  // straight-line distance from the provider to the end of the posted route (shown in the "Route end" chip)
  const endDistM = useMemo(() => {
    if (!endPoint || !loc.fix) return null;
    const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
    const dLat = toRad(endPoint.coordinate.latitude - loc.fix.latitude);
    const dLng = toRad(endPoint.coordinate.longitude - loc.fix.longitude);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(loc.fix.latitude)) * Math.cos(toRad(endPoint.coordinate.latitude)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }, [endPoint, loc.fix ? Math.round(loc.fix.latitude * 2000) : 0, loc.fix ? Math.round(loc.fix.longitude * 2000) : 0]);

  const etaClock = info.durationS != null
    ? new Date(Date.now() + info.durationS * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const close = () => navigation.goBack();
  // opens the Task screen straight on the request (pickup scan / hand-over depending on its stage)
  // Finds the provider's Task tab wherever it lives in the navigation tree (same idea as the Jobs screen:
  // 'MainTabs' is the SENDER home, so it must not be hard-coded here) and navigates to it with the nested params.
  const goToTasks = (deliveryId?: number | null, action?: 'verify' | 'complete') => {
    setPkgDeliveryId(null);
    const toPlain = (p: EndPoint | null) =>
      p ? { lat: p.coordinate.latitude, lng: p.coordinate.longitude, title: p.title } : null;
    const params = deliveryId != null
      ? {
          openDeliveryId: Number(deliveryId),
          openAction: action,
          // lets the Task screen bring the provider BACK to this navigation screen
          returnToNav: { routeId: effectiveRouteId, routeEnd: toPlain(endPoint), routeStart: toPlain(startPoint) },
        }
      : undefined;

    const findPath = (state: any, prefix: string[]): string[] | null => {
      if (!state) return null;
      const names: string[] = state.routeNames || [];
      const hit = names.find(n => /^tasks?$/i.test(n)) || names.find(n => /task/i.test(n));
      if (hit) return [...prefix, hit];
      for (const r of state.routes || []) {
        const sub = findPath(r.state, [...prefix, r.name]);
        if (sub) return sub;
      }
      return null;
    };

    try {
      let root: any = navigation;
      while (root.getParent?.()) root = root.getParent();
      const path = findPath(root.getState?.(), []);
      if (path && path.length) {
        // build { screen, params: { screen, params: ... } } from the outside in
        let nested: any = params;
        for (let i = path.length - 1; i >= 1; i--) nested = { screen: path[i], params: nested };
        navigation.navigate(path[0], nested);
        return;
      }
    } catch { /* fall through */ }
    navigation.navigate('MainTabs', { screen: 'Tasks', params });
  };

  if (phase !== 'ready' || !current) {
    const title =
      phase === 'empty' ? 'No stops left'
      : phase === 'error' ? 'Navigation unavailable'
      : 'Navigation unavailable';
    const body =
      phase === 'empty' ? 'All pickups and drop-offs are done. Accept more jobs to build a new trip.'
      : phase === 'error' ? 'We could not load your trip. Check your connection and try again.'
      : '';
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        {phase === 'loading' ? (
          <ActivityIndicator size="large" color={colors.accent} />
        ) : (
          <View style={styles.stateCard}>
            <SolarIcon name="DangerCircle" variant="duotone" size={40} color={colors.warning} style={{ marginBottom: 12 }} />
            <Text style={styles.stateTitle}>{title}</Text>
            {!!body && <Text style={styles.stateBody}>{body}</Text>}
            <TouchableOpacity style={styles.btn} onPress={close}>
              <Text style={styles.btnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  const callPhone = (phone: string | null | undefined, name?: string | null) => {
    if (!phone) { Alert.alert('No Phone Number', `No phone number is available for ${name || 'this contact'}.`); return; }
    Linking.openURL(`tel:${String(phone).replace(/\s+/g, '')}`).catch(() => {
      Alert.alert('Unable to Call', 'Your device cannot open the phone dialer.');
    });
  };

  const copyCode = async (code: string) => {
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(code);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 1800);
      }
    } catch { /* ignore */ }
  };

  const messageSender = async (deliveryId: number) => {
    if (openingChat) return;
    try {
      setOpeningChat(true);
      const roomId = await getOrCreateChatRoom(deliveryId);
      if (!roomId) { Alert.alert('Error', 'Could not open chat.'); return; }
      setPkgDeliveryId(null);
      navigation.navigate('ProviderTabs', { screen: 'Messages', params: { openRoomId: roomId } });
    } catch {
      Alert.alert('Chat unavailable', 'Could not open the conversation with the sender.');
    } finally {
      if (aliveRef.current) setOpeningChat(false);
    }
  };

  const renderPkgModal = () => {
    const p = pkgDeliveryId != null ? pkgMap[pkgDeliveryId] : null;
    const dRaw = pkgDeliveryId != null ? rawDeliveries.find(x => Number(x?.delivery_id) === pkgDeliveryId) : null;
    const visible = !!p && !!dRaw;
    const o = visible ? buildOrderInfo(dRaw) : null;
    const extra = p ? orderExtra[p.deliveryId] : undefined;
    const senderName = extra?.sender ? [extra.sender.first_name, extra.sender.last_name].filter(Boolean).join(' ') || null : null;
    const senderPhone: string | null = extra?.sender?.phone_number ?? null;

    const stage = p ? orders.find(x => x.deliveryId === p.deliveryId)?.stage : undefined;
    const isTransit = stage === 'transit';
    const isReturnStage = stage === 'return';
    const goAction: 'verify' | 'complete' = isTransit ? 'complete' : 'verify';
    const goLabel = isTransit ? 'Go to Task · Hand over' : isReturnStage ? 'Go to Task · Verify return' : 'Go to Task · Verify pickup';

    const statusMeta = isTransit
      ? { label: 'In Transit', bg: colors.accentSoft, fg: colors.accent }
      : isReturnStage
        ? { label: 'Returning', bg: colors.warningBg, fg: colors.warning }
        : { label: 'Awaiting Pickup', bg: 'rgba(59,130,246,0.14)', fg: BLUE };

    const progressSteps = ['Accepted', 'To pickup', 'Picked up', 'To drop-off', 'Delivered'];
    const doneUpTo = isTransit || isReturnStage ? 2 : 0;
    const currentStep = isTransit || isReturnStage ? 3 : 1;

    const hintText = isReturnStage
      ? 'The drop-off could not be completed. Bring the parcel back to the sender’s pickup pin and verify the return.'
      : isTransit
        ? `Hand over ${o?.isDoor ? 'at the door' : 'at the curb or entrance'}, take a Proof of Delivery photo, and enter the receiver’s 6-digit OTP.`
        : 'Meet the sender, then verify with their QR or 4-digit PIN.';

    const escrowStatus = String(extra?.escrowStatus || '');
    const released = /complet|releas/i.test(escrowStatus);
    const paymentLabel = released ? 'Completed' : (!escrowStatus || /hold/i.test(escrowStatus)) ? 'Held in escrow' : escrowStatus;
    const payProvider = String(o?.paymentProvider || '').toLowerCase();
    const payVia = payProvider.includes('gcash') ? 'GCash' : payProvider.includes('maya') ? 'Maya' : null;

    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (photoPreview) setPhotoPreview(null); else setPkgDeliveryId(null); }}>
        <View style={styles.odOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPkgDeliveryId(null)} />

          {!!p && !!o && (
            <View style={[styles.odSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <View style={styles.odHandle} />

              <View style={styles.odHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.odHeaderTitle}>Order Details</Text>
                  <Text style={styles.odHeaderSub}>{p.totalItems} {p.totalItems === 1 ? 'package' : 'packages'} in this order</Text>
                </View>
                <TouchableOpacity style={styles.odCloseBtn} onPress={() => setPkgDeliveryId(null)} hitSlop={10} activeOpacity={0.85}>
                  <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.odBody} showsVerticalScrollIndicator={false}>
                {/* service + status */}
                <View style={styles.odTopRow}>
                  <View style={styles.odSvcPill}>
                    <SolarIcon name="Package" variant="duotone" size={16} color={BLUE} />
                    <Text style={styles.odSvcPillText}>{o.serviceLabel}</Text>
                  </View>
                  <View style={[styles.odStPill, { backgroundColor: statusMeta.bg }]}>
                    <View style={[styles.odStDot, { backgroundColor: statusMeta.fg }]} />
                    <Text style={[styles.odStPillText, { color: statusMeta.fg }]}>{statusMeta.label.toUpperCase()}</Text>
                  </View>
                </View>

                {/* tracking code */}
                <View style={styles.odCodeRow}>
                  <Text style={styles.odCode} selectable numberOfLines={1}>#{p.code}</Text>
                  <TouchableOpacity onPress={() => copyCode(p.code)} activeOpacity={0.7} hitSlop={8} style={styles.odCopy}>
                    <SolarIcon name={copiedCode ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    <Text style={styles.odCopyLabel}>{copiedCode ? 'Copied' : 'Copy'}</Text>
                  </TouchableOpacity>
                </View>
                {!!o.scheduledTime && <Text style={styles.odWhen}>Scheduled · {formatDateTime(o.scheduledTime)}</Text>}

                {/* progress */}
                <View style={styles.odStepper}>
                  {progressSteps.map((label, i) => {
                    const done = i <= doneUpTo;
                    const cur = i === currentStep;
                    const reached = done || cur;
                    return (
                      <View key={label} style={styles.odStepCol}>
                        <View style={styles.odStepLineRow}>
                          <View style={[styles.odStepLine, i === 0 && { backgroundColor: 'transparent' }, reached && i > 0 && { backgroundColor: colors.accent }]} />
                          <View style={[styles.odStepDot, done && styles.odStepDotDone, cur && styles.odStepDotCurrent]}>
                            {done ? <SolarIcon name="Check" variant="linear" size={14} color="#FFFFFF" />
                              : cur ? <View style={styles.odStepDotInner} /> : null}
                          </View>
                          <View style={[styles.odStepLine, i === progressSteps.length - 1 && { backgroundColor: 'transparent' }, done && i < progressSteps.length - 1 && { backgroundColor: colors.accent }]} />
                        </View>
                        <Text style={[styles.odStepLabel, reached && styles.odStepLabelOn]} numberOfLines={2}>{label}</Text>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.odHint}>
                  <SolarIcon name="Info" variant="duotone" size={18} color={colors.accent} />
                  <Text style={styles.odHintText}>{hintText}</Text>
                </View>

                {/* route */}
                <View style={{ marginTop: 18 }}>
                  {[
                    { key: 'p', label: 'PICKUP', pt: o.pickup, note: o.pickupNote, kind: 'pickup' as const },
                    { key: 'd', label: 'DROP-OFF', pt: o.dropoff, note: o.dropoffNote, kind: 'dropoff' as const },
                  ].map((r, i) => (
                    <View key={r.key} style={styles.odRtRow}>
                      <View style={styles.odRtRail}>
                        {r.kind === 'pickup' ? (
                          <View style={styles.odRtPickPin}><Ionicons name="cube" size={14} color="#FFFFFF" /></View>
                        ) : (
                          <View style={styles.odRtDropPin}><Ionicons name="person" size={16} color="#000000" /></View>
                        )}
                        {i === 0 && <View style={styles.odRtLine} />}
                      </View>
                      <View style={[styles.odRtText, i === 0 && { paddingBottom: 14 }]}>
                        <Text style={styles.odRtLabel}>{r.label}</Text>
                        <Text style={styles.odRtMain} numberOfLines={2}>{r.pt.main}</Text>
                        {!!r.pt.road && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                            <SolarIcon name="MapPoint" variant="linear" size={12} color={colors.textMuted} />
                            <Text style={styles.odRtSub} numberOfLines={2}>{r.pt.road}</Text>
                          </View>
                        )}
                        {!!r.note && (
                          <View style={styles.odNote}>
                            <SolarIcon name="ChatCircleText" variant="duotone" size={14} />
                            <Text style={styles.odNoteText}>{r.note}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>

                {/* sender */}
                <View style={styles.odSecHead}>
                  <SolarIcon name="User" variant="duotone" size={18} color={BLUE} />
                  <Text style={styles.odSecTitle}>Sender</Text>
                </View>
                <View style={styles.odCard}>
                  <View style={styles.odContactRow}>
                    <View style={[styles.odAvatar, { backgroundColor: BLUE }]}>
                      <Text style={styles.odAvatarText}>{initials(senderName)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.odRole}>CUSTOMER / SENDER</Text>
                      <Text style={styles.odName} numberOfLines={1}>{senderName || (extra ? 'N/A' : 'Loading…')}</Text>
                      {!!senderPhone && <Text style={styles.odPhone}>{senderPhone}</Text>}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {!!senderPhone && (
                        <TouchableOpacity style={styles.odCallCircle} onPress={() => callPhone(senderPhone, senderName)} activeOpacity={0.8} hitSlop={6}>
                          <SolarIcon name="Phone" variant="linear" size={16} color={colors.accent} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.odChatPill} onPress={() => messageSender(p.deliveryId)} disabled={openingChat} activeOpacity={0.85}>
                        {openingChat ? (
                          <ActivityIndicator size="small" color={colors.accent} />
                        ) : (
                          <>
                            <SolarIcon name="ChatCircleText" variant="linear" size={16} color={colors.accent} />
                            <Text style={styles.odChatPillText}>Chat</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* receiver */}
                <View style={styles.odSecHead}>
                  <SolarIcon name="User" variant="duotone" size={18} color={PURPLE} />
                  <Text style={styles.odSecTitle}>Receiver</Text>
                </View>
                <View style={styles.odCard}>
                  <View style={styles.odContactRow}>
                    <View style={[styles.odAvatar, { backgroundColor: PURPLE }]}>
                      <Text style={styles.odAvatarText}>{initials(o.receiverName)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.odRole}>RECIPIENT / RECEIVER</Text>
                      <Text style={styles.odName} numberOfLines={1}>{o.receiverName || 'N/A'}</Text>
                      {!!o.receiverPhone && <Text style={styles.odPhone}>{o.receiverPhone}</Text>}
                    </View>
                    {!!o.receiverPhone && (
                      <TouchableOpacity style={styles.odReceiverCall} onPress={() => callPhone(o.receiverPhone, o.receiverName)} activeOpacity={0.85}>
                        <SolarIcon name="Phone" variant="linear" size={16} color={PURPLE} />
                        <Text style={styles.odReceiverCallText}>Call</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* proof of pickup */}
                {!!o.pickupPhoto && (
                  <>
                    <View style={styles.odSecHead}>
                      <SolarIcon name="Camera" variant="duotone" size={18} color={colors.accent} />
                      <Text style={styles.odSecTitle}>Proof of Pickup</Text>
                    </View>
                    <TouchableOpacity style={styles.odPodCard} activeOpacity={0.9} onPress={() => setPhotoPreview(o.pickupPhoto)}>
                      <Image source={{ uri: o.pickupPhoto }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      <View style={styles.odPodOverlay}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <SolarIcon name="Maximize" variant="linear" size={13} color="#FFFFFF" />
                          <Text style={styles.odPodBadgeText}>Tap to view full photo</Text>
                        </View>
                        {!!o.pickupPhotoAt && <Text style={styles.odPodTime}>{formatDateTime(o.pickupPhotoAt)}</Text>}
                      </View>
                    </TouchableOpacity>
                  </>
                )}

                {/* package & payment */}
                <View style={styles.odSecHead}>
                  <SolarIcon name="Package" variant="duotone" size={18} />
                  <Text style={styles.odSecTitle}>Package &amp; Payment</Text>
                </View>
                <View style={{ gap: 8, marginBottom: 12 }}>
                  {p.items.map((it, i) => {
                    const meta = it.size && (SIZE_META as any)[it.size] ? (SIZE_META as any)[it.size] : null;
                    const showPhoto = !!it.photo && !failedPhotos[it.photo];
                    return (
                      <View key={i} style={styles.odItemRow}>
                        {showPhoto ? (
                          <TouchableOpacity activeOpacity={0.9} onPress={() => setPhotoPreview(it.photo)} style={styles.odItemPhotoWrap}>
                            <Image
                              source={{ uri: it.photo as string }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                              onError={() => setFailedPhotos(prev => ({ ...prev, [it.photo as string]: true }))}
                            />
                            {meta && (
                              <View style={[styles.odItemTag, { backgroundColor: meta.bg }]}>
                                <Text style={[styles.odItemTagText, { color: meta.color }]}>{meta.letter}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.odItemPhotoWrap, { alignItems: 'center', justifyContent: 'center' }, meta && { backgroundColor: meta.bg }]}>
                            <Text style={[styles.odItemEmptyText, meta && { color: meta.color }]}>{meta ? meta.letter : i + 1}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.odItemTitle} numberOfLines={2}>
                            {p.items.length > 1 ? `Package ${i + 1}` : 'Package'}
                            {it.size ? ` · ${it.size}` : ''}
                            {it.fragile && <Text style={{ color: colors.error, fontFamily: 'Poppins_700Bold' }}> · Fragile</Text>}
                          </Text>
                          {!!it.description && <Text style={styles.odItemText} numberOfLines={2}>{it.description}</Text>}
                          {!!meta && <Text style={styles.odItemText}>{meta.kg}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.odPayCard}>
                  <View style={styles.odPayRow}>
                    <Text style={styles.odPayLabel}>You Earn</Text>
                    <Text style={[styles.odPayValue, { color: colors.success, fontFamily: 'Poppins_700Bold' }]}>{money(o.earnings)}</Text>
                  </View>
                  <View style={[styles.odPayRow, styles.odPayBorder]}>
                    <Text style={styles.odPayLabel}>Payment Status</Text>
                    <Text style={[styles.odPayValue, released && { color: colors.success }]}>{paymentLabel}</Text>
                  </View>
                  {p.weightKg != null && (
                    <View style={[styles.odPayRow, styles.odPayBorder]}>
                      <Text style={styles.odPayLabel}>Total Weight</Text>
                      <Text style={styles.odPayValue}>{p.weightKg} kg</Text>
                    </View>
                  )}
                  {!!o.dims && (
                    <View style={[styles.odPayRow, styles.odPayBorder]}>
                      <Text style={styles.odPayLabel}>Dimensions</Text>
                      <Text style={styles.odPayValue}>{o.dims}</Text>
                    </View>
                  )}
                  {!!payVia && (
                    <View style={[styles.odPayRow, styles.odPayBorder]}>
                      <Text style={styles.odPayLabel}>Sender Paid Via</Text>
                      <Text style={[styles.odPayValue, { color: payVia === 'GCash' ? '#0284C7' : '#059669' }]}>{payVia}</Text>
                    </View>
                  )}
                </View>

                {o.baseFare > 0 && (
                  <>
                    <View style={styles.odSecHead}>
                      <SolarIcon name="Wallet" variant="duotone" size={18} />
                      <Text style={styles.odSecTitle}>Payment Breakdown</Text>
                    </View>
                    <View style={styles.odPayCard}>
                      {([
                        ['Delivery fare', money(o.baseFare), undefined, false],
                        ['Platform fee (15%)', `-${money(o.platformFee)}`, colors.error, false],
                        ...(o.returnDeposit > 0
                          ? [[
                              o.isReturned ? 'Return deposit (kept for return trip)' : 'Return deposit (refunded to sender)',
                              o.isReturned ? `+${money(o.returnDeposit)}` : money(o.returnDeposit),
                              o.isReturned ? colors.success : colors.textMuted,
                              false,
                            ]]
                          : []),
                        [o.isReturned || !released ? 'Your earnings' : 'Net earnings', money(o.earnings), colors.success, true],
                        ['Sender paid in total', money(o.totalPaid), colors.textSecondary, false],
                      ] as [string, string, string | undefined, boolean][]).map(([label, value, color, bold], i) => (
                        <View key={label} style={[styles.odPayRow, i > 0 && styles.odPayBorder]}>
                          <Text style={[styles.odPayLabel, { flex: 1, paddingRight: 10 }]}>{label}</Text>
                          <Text style={[styles.odPayValue, !!color && { color }, bold && { fontFamily: 'Poppins_700Bold' }]}>{value}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </ScrollView>

              <View style={styles.odFooter}>
                <TouchableOpacity style={styles.odGoBtn} activeOpacity={0.85} onPress={() => goToTasks(p.deliveryId, goAction)}>
                  <SolarIcon name="Package" variant="bold" size={18} color="#FFFFFF" />
                  <Text style={styles.odGoText} numberOfLines={1}>{goLabel}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* full-size photo viewer (inside the same modal so it works on iOS too) */}
          {!!photoPreview && (
            <Pressable style={styles.odPhotoViewer} onPress={() => setPhotoPreview(null)}>
              <Image source={{ uri: photoPreview }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
              <Text style={styles.odPhotoViewerHint}>Tap anywhere to close</Text>
            </Pressable>
          )}
        </View>
      </Modal>
    );
  };

  const isPickup = current.kind === 'pickup';
  const arrived = status === 'arrived';
  const who = current.isReturn ? 'sender' : isPickup ? 'sender' : 'receiver';

  const arrivalAction = {
    label: isPickup ? 'Verify pickup' : current.isReturn ? 'Hand parcel back' : 'Hand over parcel',
    icon: isPickup ? 'qr-code' : 'checkmark-circle',
    onPress: () => goToTasks(current.deliveryId, isPickup || current.isReturn ? 'verify' : 'complete'),
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <NavigationMap
        ref={mapHandle}
        target={{ latitude: current.point.lat, longitude: current.point.lng }}
        targetLabel={isPickup ? 'P' : 'D'}
        stops={mapStops}
        endPoint={endPoint}
        startPoint={startPoint}
        routeLine={routeLine}
        routeWaypoints={routeWaypoints}
        showsTraffic={trafficOn}
        onTargetPress={() => { if (current) setPkgDeliveryId(current.deliveryId); }}
        onStopPress={openStopDetails}
        interactive
        onInfo={setInfo}
        onStatusChange={setStatus}
        style={{ bottom: 0 }}
        bannerTop={insets.top}
        padTop={0}
        padBottom={24}
        controlsBottom={260}
        arrivalAction={arrivalAction}
        arrivalActionBottom={COLLAPSED_HEIGHT + 16}
      />

      {/* end of the provider's posted route: always visible, even when the map is zoomed in on the next stop */}
      {!!endPoint && (
        <TouchableOpacity
          style={[styles.endChip, { top: insets.top + 124 }]}
          activeOpacity={0.85}
          onPress={() => mapHandle.current?.overview()}
        >
          <View style={styles.endChipIcon}><SolarIcon name="Flag" variant="bold" size={14} color="#000000" /></View>
          <View style={{ maxWidth: 190 }}>
            <Text style={styles.endChipLabel}>ROUTE END{endDistM != null ? ` · ${fmtDistance(endDistM)}` : ''}</Text>
            <Text style={styles.endChipTitle} numberOfLines={1}>{endPoint.title || 'Destination'}</Text>
          </View>
        </TouchableOpacity>
      )}

      {renderPkgModal()}

      {/* Floating Map Tools */}
      <View style={styles.mapTools}>
        <TouchableOpacity style={styles.iconBtnMap} onPress={() => mapHandle.current?.recenter()} activeOpacity={0.85}>
          <SolarIcon name="MapPoint" variant="linear" size={24} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtnMap} onPress={() => mapHandle.current?.overview()} activeOpacity={0.85}>
          <SolarIcon name="Maximize" variant="linear" size={24} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.iconBtnMap, trafficOn && { backgroundColor: colors.accent }]}
          onPress={() => setTrafficOn(v => !v)}
          activeOpacity={0.85}
        >
          <Ionicons name="car-sport" size={22} color={trafficOn ? '#FFFFFF' : colors.accent} />
        </TouchableOpacity>
      </View>

      {/* live-traffic legend */}
      {trafficOn && (
        <View style={[styles.trafficLegend, { top: insets.top + (endPoint ? 184 : 124) }]} pointerEvents="none">
          <Text style={styles.trafficTitle}>LIVE TRAFFIC</Text>
          <View style={styles.trafficRow}>
            <View style={[styles.trafficDot, { backgroundColor: '#22C55E' }]} /><Text style={styles.trafficText}>Light</Text>
            <View style={[styles.trafficDot, { backgroundColor: '#F59E0B' }]} /><Text style={styles.trafficText}>Moderate</Text>
            <View style={[styles.trafficDot, { backgroundColor: '#EF4444' }]} /><Text style={styles.trafficText}>Heavy</Text>
          </View>
        </View>
      )}

      {/* Animated Resizable Bottom Panel */}
      <Animated.View style={[styles.bottomPanel, { height: panAnim }]}>
        <View {...panResponder.panHandlers} style={styles.panelHeader}>
          <TouchableOpacity activeOpacity={1} onPress={togglePanel} style={styles.dragHandleWrap}>
            <View style={styles.dragHandle} />
          </TouchableOpacity>

          <View style={styles.statsRow}>
            <View style={styles.statsLeft}>
              <Text style={styles.etaText}>{arrived ? 'Arrived' : fmtDuration(info.durationS)}</Text>
              <Text style={styles.etaLabel}>ETA</Text>
            </View>

            <View style={styles.statsRight}>
              <Text style={styles.distanceText}>{fmtMeters(arrived ? 0 : info.distanceM)}</Text>
              <Text style={styles.distanceLabel}>to stop · arriving {etaClock}</Text>
            </View>

            <TouchableOpacity style={styles.exitBtn} onPress={close} activeOpacity={0.8}>
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
          {/* current stop */}
          <View style={styles.destChipRow}>
            <View style={styles.destChip}>
              <SolarIcon name={isPickup ? 'Package' : 'Home'} variant="duotone" size={12} color="#FFFFFF" />
              <Text style={styles.destChipText}>{isPickup ? 'PICKUP' : current.isReturn ? 'RETURN' : 'DROP-OFF'}</Text>
            </View>
            <Text style={styles.orderCode}>#{current.code}</Text>
            {plan.length > 1 && <Text style={styles.stopCounter}>Stop 1 of {plan.length}</Text>}
          </View>
          <Text style={styles.destTitle} numberOfLines={2}>{current.point.main}</Text>
          {!!current.point.sub && <Text style={styles.destAddress} numberOfLines={2}>{current.point.sub}</Text>}

          {!!current.note && (
            <View style={styles.noteBox}>
              <SolarIcon name="ChatCircleText" variant="duotone" size={16} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.noteLabel}>NOTE FROM {who.toUpperCase()}</Text>
                <Text style={styles.noteText}>{current.note}</Text>
              </View>
            </View>
          )}

          {/* where the posted route ends */}
          {!!endPoint && (
            <View style={styles.endRow}>
              <View style={styles.endDot}><SolarIcon name="Flag" variant="bold" size={14} color="#000000" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stopKind}>ROUTE END</Text>
                <Text style={styles.stopTitle} numberOfLines={1}>{endPoint.title || 'Destination'}</Text>
              </View>
            </View>
          )}

          {/* the whole sorted trip */}
          {plan.length > 1 && (
            <>
              <View style={styles.divider} />
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Trip order</Text>
                <Text style={styles.sectionCount}>{plan.length} stops</Text>
              </View>
              {plan.map((s, i) => (
                <View key={s.key} style={styles.stopRow}>
                  <View style={styles.stopRail}>
                    <View style={[styles.stopDot, s.kind === 'pickup' ? styles.stopDotPickup : styles.stopDotDrop, i === 0 && styles.stopDotNow]}>
                      <Text style={[styles.stopDotText, s.kind === 'dropoff' && { color: '#FFFFFF' }]}>{i + 1}</Text>
                    </View>
                    {i < plan.length - 1 && <View style={styles.stopLine} />}
                  </View>
                  <View style={styles.stopBody}>
                    <Text style={styles.stopKind}>
                      {s.kind === 'pickup' ? 'PICKUP' : s.isReturn ? 'RETURN' : 'DROP-OFF'} · #{s.code}
                      {i === 0 ? '  ·  NEXT' : ''}
                    </Text>
                    <Text style={styles.stopTitle} numberOfLines={1}>{s.point.main}</Text>
                    {!!s.point.sub && <Text style={styles.stopSub} numberOfLines={1}>{s.point.sub}</Text>}
                    {s.locked && <Text style={styles.stopLocked}>Appears on the map after pickup</Text>}
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  mapTools: { position: 'absolute', right: 16, top: '45%', gap: 12 },
  iconBtnMap: {
    width: 48, height: 48, borderRadius: 14,
    backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },

  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: isDark ? 0.05 : 0.04, shadowRadius: 12, elevation: 1,
  },

  panelHeader: { paddingTop: 10, paddingBottom: 4, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  dragHandleWrap: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  dragHandle: { width: 40, height: 4, backgroundColor: c.border, borderRadius: 2 },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsLeft: { flexDirection: 'column', flex: 1, alignItems: 'flex-start' },
  statsRight: { flexDirection: 'column', flex: 1, alignItems: 'flex-start', marginLeft: 20 },

  etaText: { color: c.accent, fontSize: 28, fontFamily: 'Poppins_800ExtraBold', lineHeight: 32 },
  etaLabel: { color: c.textMuted, fontSize: 12, fontFamily: 'Poppins_700Bold', marginTop: 2, letterSpacing: 0.5, textTransform: 'uppercase' },

  distanceText: { color: c.textPrimary, fontSize: 22, fontFamily: 'Poppins_800ExtraBold', lineHeight: 32 },
  distanceLabel: { color: c.textSecondary, fontSize: 13, fontFamily: 'Poppins_500Medium', marginTop: 2 },

  exitBtn: { backgroundColor: c.textPrimary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginLeft: 12 },
  exitText: { color: c.card, fontSize: 15, fontFamily: 'Poppins_700Bold' },

  divider: { height: 1, backgroundColor: c.divider, marginVertical: 14 },

  destChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  destChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  destChipText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
  orderCode: { color: c.textMuted, fontSize: 12, fontFamily: 'Poppins_700Bold' },
  stopCounter: { marginLeft: 'auto', color: c.textSecondary, fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  destTitle: { color: c.textPrimary, fontSize: 20, fontFamily: 'Poppins_700Bold' },
  destAddress: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 2, lineHeight: 20 },
  noteBox: { flexDirection: 'row', gap: 10, backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, marginTop: 12 },
  noteLabel: { color: c.accent, fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
  noteText: { color: c.textPrimary, fontSize: 14, fontFamily: 'Poppins_500Medium', lineHeight: 20, marginTop: 2 },

  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { color: c.textPrimary, fontSize: 16, fontFamily: 'Poppins_700Bold' },
  sectionCount: { color: c.accent, fontSize: 13, fontFamily: 'Poppins_800ExtraBold' },

  stopRow: { flexDirection: 'row', gap: 12 },
  stopRail: { alignItems: 'center', width: 28 },
  stopDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stopDotPickup: { backgroundColor: c.accent },
  stopDotDrop: { backgroundColor: '#111827' },
  stopDotNow: { borderWidth: 3, borderColor: c.accentSoft },
  stopDotText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Poppins_800ExtraBold' },
  stopLine: { width: 2, flex: 1, backgroundColor: c.divider, marginVertical: 2 },
  stopBody: { flex: 1, paddingBottom: 14 },
  stopKind: { color: c.textMuted, fontSize: 10.5, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.6 },
  stopTitle: { color: c.textPrimary, fontSize: 15, fontFamily: 'Poppins_600SemiBold', marginTop: 1 },
  stopSub: { color: c.textSecondary, fontSize: 12.5, fontFamily: 'Poppins_400Regular' },
  stopLocked: { color: c.textMuted, fontSize: 11.5, fontFamily: 'Poppins_500Medium', marginTop: 2 },

  // ---- order details sheet (same look as the Task screen's detail view) ----
  odOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  odSheet: { backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '92%', overflow: 'hidden' },
  odHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.divider, marginTop: 10 },
  odHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  odHeaderTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
  odHeaderSub: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1 },
  odCloseBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  odBody: { paddingHorizontal: 20, paddingBottom: 24 },
  odTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  odSvcPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(59,130,246,0.12)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.35)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  odSvcPillText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: BLUE },
  odStPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  odStDot: { width: 7, height: 7, borderRadius: 4 },
  odStPillText: { fontSize: 11, fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 },
  odCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  odCode: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.4, flexShrink: 1 },
  odCopy: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  odCopyLabel: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent },
  odWhen: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent, marginTop: 4 },
  odStepper: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 8, marginTop: 16, marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  odStepCol: { flex: 1, alignItems: 'center' },
  odStepLineRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  odStepLine: { flex: 1, height: 3, backgroundColor: c.divider },
  odStepDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: c.divider, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  odStepDotDone: { backgroundColor: c.accent, borderColor: c.accent },
  odStepDotCurrent: { borderColor: c.accent },
  odStepDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
  odStepLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: c.textMuted, marginTop: 8, textAlign: 'center' },
  odStepLabelOn: { color: c.textPrimary },
  odHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: c.accentSoft, borderRadius: 12, padding: 14, marginTop: 4 },
  odHintText: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 19, color: c.textPrimary },
  odRtRow: { flexDirection: 'row', gap: 14 },
  odRtRail: { alignItems: 'center', width: 32 },
  odRtPickPin: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F27024', borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4 },
  odRtDropPin: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 3 },
  odRtLine: { position: 'absolute', top: 36, bottom: -4, width: 2, borderRadius: 1, backgroundColor: c.border },
  odRtText: { flex: 1 },
  odRtLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  odRtMain: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 2 },
  odRtSub: { flex: 1, fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary },
  odNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: c.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  odNoteText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_500Medium', lineHeight: 17, color: c.textPrimary },
  odSecHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 14 },
  odSecTitle: { flex: 1, fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  odCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: 16 },
  odContactRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  odAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  odAvatarText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Poppins_700Bold' },
  odRole: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.4 },
  odName: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  odPhone: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1 },
  odCallCircle: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  odChatPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accentSoft, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: c.accent },
  odChatPillText: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.accent },
  odReceiverCall: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(139,92,246,0.12)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(139,92,246,0.35)' },
  odReceiverCallText: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: PURPLE },
  odPodCard: { width: '100%', height: 200, borderRadius: 12, overflow: 'hidden', backgroundColor: c.background, borderWidth: 1.5, borderColor: c.success },
  odPodOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: 'rgba(17,24,39,0.72)' },
  odPodBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  odPodTime: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: 'Poppins_500Medium' },
  odItemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', padding: 12 },
  odItemPhotoWrap: { width: 64, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: c.divider },
  odItemTag: { position: 'absolute', right: 4, bottom: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  odItemTagText: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold' },
  odItemEmptyText: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },
  odItemTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  odItemText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 18, marginTop: 2 },
  odPayCard: { backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden' },
  odPayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  odPayBorder: { borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  odPayLabel: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
  odPayValue: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, textAlign: 'right' },
  odFooter: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background },
  odGoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, borderRadius: 14, height: 52, paddingHorizontal: 16 },
  odGoText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold', flexShrink: 1 },
  odPhotoViewer: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  odPhotoViewerHint: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: 'Poppins_500Medium', marginTop: 12 },

  pkgOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  pkgCard: { backgroundColor: c.card, borderRadius: 24, padding: 24, maxHeight: '85%' },
  pkgHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  pkgTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  pkgCode: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.textMuted, marginTop: 1 },
  pkgPhoto: { width: 96, height: 96, borderRadius: 14, backgroundColor: c.divider },
  pkgRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.divider },
  pkgName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  pkgSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  pkgQty: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  sizeBadge: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },
  sizeBadgeText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  pkgMetaRow: { flexDirection: 'row', gap: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider },
  pkgMeta: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  pkgRoute: { marginTop: 10, gap: 2 },
  pkgGoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accent, borderRadius: 14, height: 50, marginTop: 16 },
  pkgGoText: { color: '#FFFFFF', fontSize: 14.5, fontFamily: 'Poppins_700Bold' },
  pkgRouteText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textPrimary },

  endChip: {
    position: 'absolute', left: 14, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.card, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 6,
  },
  endChipIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  endChipLabel: { color: c.textMuted, fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.6 },
  endChipTitle: { color: c.textPrimary, fontSize: 13, fontFamily: 'Poppins_700Bold' },
  trafficLegend: {
    position: 'absolute', left: 14, backgroundColor: c.card, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)', elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4,
  },
  trafficTitle: { color: c.textMuted, fontSize: 9.5, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.6, marginBottom: 3 },
  trafficRow: { flexDirection: 'row', alignItems: 'center' },
  trafficDot: { width: 9, height: 9, borderRadius: 5, marginRight: 4 },
  trafficText: { color: c.textPrimary, fontSize: 11, fontFamily: 'Poppins_600SemiBold', marginRight: 10 },
  endRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider },
  endDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  stateCard: { alignItems: 'center' },
  stateTitle: { color: c.textPrimary, fontSize: 18, fontFamily: 'Poppins_700Bold', marginBottom: 8 },
  stateBody: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginBottom: 20, paddingHorizontal: 12 },
  btn: { backgroundColor: c.divider, padding: 16, borderRadius: 14 },
  btnText: { color: c.textPrimary, fontFamily: 'Poppins_700Bold' },
});