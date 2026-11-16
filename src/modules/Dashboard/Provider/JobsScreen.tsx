// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity,
  Platform, Modal, Alert, ActivityIndicator, ScrollView,
  Animated, Linking, StatusBar, FlatList, Pressable,
  TextInput, Keyboard, useWindowDimensions, Easing, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import {
  getActiveRouteId,
  setActiveRouteId,
  subscribeActiveRoute,
  getDemoMode,
  subscribeDemoMode,
  syncSelectedRouteToDb,
} from '../../../services/activeRouteStore';
import {
  evaluateAndFetchRouteMatches,
  fetchDirectRequestMatches,
  computeCargoVolumeLiters,
  parseRequestCreatedTime,
  isRequestWithinRouteCorridor,
  declineDirectRequest as declineDirectRequestService,
  declineMatchedRequest as declineMatchedRequestService,
  RouteMatchRow,
} from '../../../services/matchingService';
import { createProviderRouteWithGuardrails, getTodayRouteStats } from '../../../services/routeService';
import { notifyUser } from '../../../services/pushService';
import NotificationsList from '../Disputes/NotificationsList';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { routeNotification, NotifRow, isWithdrawalNotif } from '../../../utils/notifRouter';
import { MAP_PROPS, BRAND_ORANGE } from '../../../utils/mapConfig';
import { setTabBarHidden } from '../../../services/tabBarVisibilityStore';
import { isRouteExpired } from './Manage/ManageRoutesScreen';
import { SolarIcon, SolarIconName } from '../../../components/ui/SolarIcon';
import DraggableSheet, { DraggableSheetHandle } from '../../../components/ui/DraggableSheet';

const EMPTY_COMPASS_ICON = require('../../../../assets/empty-state-compass-icon.png');

const AWAITING_MAX_AGE_HOURS = 24;
const DISMISSED_KEY = '@pns:dismissed_requests:v1';   // per provider: requests this provider declined
const DISMISSED_TTL_MS = 48 * 3600 * 1000;
const POLL_INTERVAL_MS = 20000;                       // safety net in case a realtime event is missed
const POLL_EVALUATE_EVERY = 3;                        // every 3rd poll also re-evaluates the corridor
const CARGO_PHOTO_BUCKET = 'cargo-photos';
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCIES = ['One-time', 'Daily', 'Weekly'] as const;
type Frequency = typeof FREQUENCIES[number];

const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 6;
const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;
const NEARBY_RADIUS_M = 200;
const LABEL_SNAP_M = 60;
const REJECTED_PLACE_TYPES = new Set(['route', 'street_address', 'postal_code', 'plus_code']);
const DEFAULT_CENTER = { latitude: 10.3157, longitude: 123.8854 };

// Pin dimensions matching ProviderTrackModal.tsx
const PIN = 44;
const LABEL_H = 26;
const LABEL_H2 = 42;
const LABEL_GAP = 6;

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_API_KEY = GOOGLE_MAPS_API_KEY.length > 10;

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
  verification_status: string;
}
interface Route {
  route_id: number;
  departure_time: string;
  end_time?: string | null;
  route_frequency: string;
  route_distance_km?: number;
  remaining_weight_kg?: number;
  remaining_volume_liters?: number;
  fallback_unlocked?: boolean;
  fallback_reason?: 'CONDITION_A' | 'CONDITION_B' | null;
  fallback_used?: boolean;
  admin_review_flag?: boolean;
  is_deleted?: boolean;
  is_active?: boolean;
  is_selected?: boolean;
  start_location_id: number;
  end_location_id: number;
  provider_id: number;
  vehicle_id: number;
  start_location?: Location;
  end_location?: Location;
  vehicle?: Vehicle;
}

interface JobItem {
  description: string;
  size: string | null;
  fragile: boolean;
  photo: string | null;
  localOnly?: boolean;
  boxes: string | null;
}
interface JobPlace {
  main: string;
  sub: string;
  lat: number | null;
  lng: number | null;
}
interface JobRequest {
  request_id: number;
  pickup_type: string;
  scheduled_time: string | null;
  created_at: string | null;
  estimated_cost: number;
  pickup: JobPlace;
  dropoff: JobPlace;
  pickupNote: string | null;
  dropoffNote: string | null;
  items: JobItem[];
  totalItems: number;
  sizeSummary: string;
  weightKg: number | null;
  volumeL: number;
  fragile: boolean;
  dims: string | null;
  senderName: string;
  receiverName: string | null;
  preferred_provider_id?: number | null;
  preferred_route_id?: number | null;
  isDirectRequest?: boolean;
  matchScore?: number;
  isFallback?: boolean;
  fallbackType?: 'CONDITION_A' | 'CONDITION_B' | null;
  pickupDistM?: number;
  dropoffDistM?: number;
  matchId?: number;
}

type Notif = NotifRow;
type Coord = { latitude: number; longitude: number };
type RecentEntry = { name: string; address: string; latitude: number; longitude: number; ts: number };
type SearchResult = {
  place_id: string; name: string; formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};
type NearbyPlace = { id: string; name: string; address: string; latitude: number; longitude: number; dist: number };
type Label = { name: string; sub?: string };

const parseNaiveIsoString = (s: string): Date => {
  if (!s) return new Date();
  const parts = s.split(/[-T:+Z]/);
  if (parts.length < 5) return new Date();
  return new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
    parseInt(parts[3], 10),
    parseInt(parts[4], 10),
  );
};

const nextWeekday = (weekday: number, from = new Date()): Date => {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
};

const randToken = (len = 16) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

const money = (n: any) => `₱${Number(n || 0).toFixed(2)}`;
const requestCode = (id: number) => `PNS-${String(id).padStart(4, '0')}`;
const serviceLabel = (t?: string | null) => (/door/i.test(String(t || '')) ? 'Door-to-Door' : 'Curb-side');
const isLocalPhoto = (v: any) => typeof v === 'string' && /^(file|content):/i.test(v);

const toPhotoUrl = (v: any): string | null => {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(file|content):/i.test(v)) return null;
  try {
    return supabase.storage.from(CARGO_PHOTO_BUCKET).getPublicUrl(v.replace(/^\/+/, '')).data.publicUrl;
  } catch { return null; }
};

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected Location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

// Plus Codes and random-looking ids are not place names.
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

// main = the place the sender picked, sub = the street / avenue (+ barangay) shown right under it
const describePlace = (l: any): { main: string; sub: string } => {
  const parts = readableParts(l?.street_address);
  const name = typeof l?.place_name === 'string' && !isCodeLike(l.place_name) ? l.place_name.trim() : '';
  const road = typeof l?.road === 'string' && !isCodeLike(l.road) ? l.road.trim() : '';
  const brgy = typeof l?.barangay === 'string' && !isCodeLike(l.barangay) ? l.barangay.trim() : '';
  const city = typeof l?.city === 'string' && !isCodeLike(l.city) ? l.city.trim() : '';
  const localities = [l?.city, l?.province, l?.barangay]
    .filter((v: any) => typeof v === 'string').map((v: string) => v.trim().toLowerCase());
  const placeParts = parts.filter(p => !localities.includes(p.toLowerCase()));

  const main = name || placeParts[0] || road || brgy || parts[0] || 'Selected Location';
  const street = road || placeParts.find(p => p !== main) || '';
  const sub = [street && street !== main ? street : '', brgy && brgy !== main ? brgy : '']
    .filter(Boolean).join(', ')
    || parts.slice(1, 3).join(', ')
    || (city && city !== main ? city : '');
  return { main, sub };
};

const whenLabel = (r: JobRequest) => {
  if (r.scheduled_time) {
    const d = parseNaiveIsoString(String(r.scheduled_time).replace(' ', 'T'));
    return `Scheduled · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  const d = r.created_at ? new Date(r.created_at) : new Date();
  return `Requested · ${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
};

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const roadKm = (aLat: number, aLng: number, bLat: number, bLng: number) => haversineKm(aLat, aLng, bLat, bLng) * 1.3;

const metersBetween = (a: Coord, b: Coord) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fmtDist = (m: number) => (m < 1000 ? `${Math.max(1, Math.round(m))} m` : `${(m / 1000).toFixed(1)} km`);

const iconForNotif = (n: Notif): SolarIconName => {
  if (isWithdrawalNotif(n)) return 'Wallet';
  const t = (n.type || '').toLowerCase();
  if (t.startsWith('dispute')) return 'ShieldCheck';
  if (t.startsWith('delivery')) return 'Package';
  if (t === 'match' || t.includes('direct')) return 'Lightning';
  if (t.startsWith('message') || t.startsWith('chat') || t.startsWith('support')) return 'ChatCircleText';
  if (t === 'payment' || t === 'escrow') return 'Card';
  return 'Bell';
};

const titleForNotif = (n: Notif): string => {
  const rawTitle = (n.title || '').trim();
  if (isWithdrawalNotif(n)) {
    if (!rawTitle || /dispute/i.test(rawTitle)) {
      const b = (n.body || '').toLowerCase();
      if (b.includes('completed') || b.includes('sent') || b.includes('credited')) return 'Cashout Completed';
      if (b.includes('failed') || b.includes('rejected') || b.includes('reversed') || b.includes('restored')) return 'Cashout Refunded';
      if (b.includes('processing') || b.includes('submitted') || b.includes('requested')) return 'Cashout Processing';
      return 'Cashout Update';
    }
    return rawTitle;
  }
  if (rawTitle) return rawTitle;
  const t = (n.type || '').toLowerCase();
  if (t === 'match') return 'New Delivery Match';
  if (t.includes('direct')) return 'Direct Route Request';
  if (t.startsWith('delivery')) return 'Delivery Update';
  if (t.startsWith('message') || t.startsWith('chat')) return 'New Message';
  if (t.startsWith('dispute')) return 'Dispute Update';
  if (t.startsWith('support')) return 'Pack-N-Ship';
  if (t === 'payment' || t === 'escrow') return 'Payment Update';
  return 'Notification';
};

const summarizeSizes = (sizes: (string | null | undefined)[]): string => {
  const counts: Record<string, number> = {};
  sizes.forEach(z => { if (z) counts[z] = (counts[z] || 0) + 1; });
  return ['Small', 'Medium', 'Large']
    .filter(k => counts[k])
    .map(k => `${counts[k]} ${k}`)
    .join(' · ');
};

const fetchSenderMap = async (senderIds: number[]): Promise<Record<number, string>> => {
  const unique = Array.from(new Set(senderIds.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data: users } = await supabase
    .from('users')
    .select('user_id, first_name, last_name')
    .in('user_id', unique);
  const map: Record<number, string> = {};
  (users || []).forEach((u: any) => {
    const last = u.last_name ? ` ${String(u.last_name).charAt(0)}.` : '';
    map[u.user_id] = `${u.first_name || 'Sender'}${last}`;
  });
  return map;
};

const normalizeMatchRow = (
  m: RouteMatchRow,
  senders: Record<number, string>,
  currentProviderId?: number | null,
): JobRequest => {
  const r = m.request;
  const cargo = Array.isArray(r.cargo) ? r.cargo[0] : r.cargo;

  let itemsJson: any = cargo?.items_json;
  if (typeof itemsJson === 'string') {
    try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
  }

  const sizeCounts: [string, any][] = [
    ['Small', cargo?.small_box_qty],
    ['Medium', cargo?.medium_box_qty],
    ['Large', cargo?.large_box_qty],
  ];
  const boxes = sizeCounts.filter(([, q]) => Number(q) > 0).map(([l, q]) => `${l} ×${q}`).join(' · ');
  const boxTotal = sizeCounts.reduce((s, [, q]) => s + (Number(q) || 0), 0);

  let items: JobItem[];
  if (Array.isArray(itemsJson) && itemsJson.length > 0) {
    items = itemsJson.map((it: any) => ({
      description: it?.description || `${it?.size || 'Standard'} package`,
      size: it?.size ?? null,
      fragile: !!it?.fragile,
      photo: toPhotoUrl(it?.photo),
      localOnly: isLocalPhoto(it?.photo),
      boxes: null,
    }));
    const fallbackPhoto = toPhotoUrl(cargo?.cargo_pic);
    if (fallbackPhoto && !items.some(i => i.photo)) items[0].photo = fallbackPhoto;
    if (isLocalPhoto(cargo?.cargo_pic) && !items.some(i => i.photo)) items[0].localOnly = true;
  } else {
    items = [{
      description: cargo?.description || 'Package',
      size: null,
      fragile: !!cargo?.is_fragile,
      photo: toPhotoUrl(cargo?.cargo_pic),
      localOnly: isLocalPhoto(cargo?.cargo_pic),
      boxes: boxes || null,
    }];
  }

  const d = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const dims = d.every(v => Number(v) > 0) ? `${d[0]} × ${d[1]} × ${d[2]} cm` : null;
  const pu = describePlace(r.pickup_location);
  const dr = describePlace(r.dropoff_location);

  const prefProviderId = r.preferred_provider_id != null ? Number(r.preferred_provider_id) : null;
  const isDirectRequest =
    prefProviderId != null &&
    currentProviderId != null &&
    prefProviderId === Number(currentProviderId);

  return {
    request_id: r.request_id,
    pickup_type: r.pickup_type,
    scheduled_time: r.scheduled_time ?? null,
    created_at: r.created_at ?? null,
    estimated_cost: Number(r.estimated_cost) || 0,
    pickup: { ...pu, lat: r.pickup_location?.latitude ?? null, lng: r.pickup_location?.longitude ?? null },
    dropoff: { ...dr, lat: r.dropoff_location?.latitude ?? null, lng: r.dropoff_location?.longitude ?? null },
    pickupNote: r.pickup_note || null,
    dropoffNote: r.dropoff_note || null,
    items,
    totalItems: Array.isArray(itemsJson) && itemsJson.length > 0 ? itemsJson.length : (boxTotal || 1),
    sizeSummary: Array.isArray(itemsJson) && itemsJson.length > 0
      ? summarizeSizes(items.map(i => i.size))
      : sizeCounts.filter(([, q]) => Number(q) > 0).map(([l, q]) => `${q} ${l}`).join(' · '),
    weightKg: Number(cargo?.total_weight_kg) || null,
    // cargo volume in liters: per-item sizes when we have them, else the box quantities on the cargo profile
    volumeL: Math.round(
      Array.isArray(itemsJson) && itemsJson.length > 0
        ? computeCargoVolumeLiters(items)
        : computeCargoVolumeLiters(cargo),
    ),
    fragile: items.some(i => i.fragile) || !!cargo?.is_fragile,
    dims,
    senderName: senders[r.sender_id] || 'Sender',
    receiverName: r.receiver?.receiver_name || [r.receiver?.first_name, r.receiver?.last_name].filter(Boolean).join(' ') || null,
    preferred_provider_id: prefProviderId,
    preferred_route_id: r.preferred_route_id ?? m.route_id ?? null,
    isDirectRequest,
    matchScore: m.match_score,
    isFallback: m.is_fallback,
    fallbackType: m.fallback_type,
    pickupDistM: m.pickup_dist_m,
    dropoffDistM: m.dropoff_dist_m,
    matchId: m.match_id,
  };
};

/** Keep at most `max` points so the polyline stays cheap to draw. */
const thin = <T,>(pts: T[], max = 220): T[] => {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(pts[Math.round(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
};

const OSRM_TIMEOUT_MS = 8000;
// Road geometry per start/end pair, kept for the whole app session so a remount never has to re-fetch it.
const ROAD_CACHE = new Map<string, Coord[]>();
const roadCacheKey = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  `${a.lat.toFixed(5)},${a.lng.toFixed(5)}|${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

/**
 * Road geometry between two points, or null when the router could not be reached.
 * The public OSRM server is slow / rate-limited from time to time, so every attempt has a timeout
 * and one quick retry. Callers decide what to show while there is no geometry.
 */
const fetchRoadCoordsStrict = async (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<Coord[] | null> => {
  const key = roadCacheKey(a, b);
  const cached = ROAD_CACHE.get(key);
  if (cached) return cached;

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.ok) {
        const data = await res.json();
        const pts = data?.routes?.[0]?.geometry?.coordinates;
        if (data?.code === 'Ok' && Array.isArray(pts) && pts.length > 1) {
          const coords = thin(pts.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
          ROAD_CACHE.set(key, coords);
          return coords;
        }
      }
    } catch { /* timeout / offline: retry once, then give up */ }
    finally { clearTimeout(timer); }
    if (attempt === 0) await new Promise<void>(r => setTimeout(r, 600));
  }
  return null;
};

/** Same as above, but falls back to a straight line (used by the add-route preview). */
const fetchRoadCoords = async (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): Promise<Coord[]> => {
  const coords = await fetchRoadCoordsStrict(a, b);
  return coords ?? [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
  ];
};

/* ------------------------------- map markers ------------------------------- */

// Identical pins to ProviderTrackModal.tsx: orange start pin / white destination pin with label pill underneath.
const makeMapStyles = () => StyleSheet.create({
  placeWrap: { alignItems: 'center', paddingHorizontal: 4 },
  pickPin: {
    width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: BRAND_ORANGE,
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },
  dropPin: {
    width: PIN, height: PIN, borderRadius: PIN / 2, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4, elevation: 6,
  },
  courierPin: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6,
  },
  labelPill: {
    maxWidth: 200, minHeight: LABEL_H, justifyContent: 'center', marginTop: LABEL_GAP, paddingVertical: 3,
    backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4, elevation: 5,
  },
  labelText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#111827' },
  labelSub: { fontSize: 10.5, fontFamily: 'Poppins_500Medium', color: '#6B7280', marginTop: -1 },
});

type MapMarkerStyles = ReturnType<typeof makeMapStyles>;

const RoutePlaceMarker = React.memo(function RoutePlaceMarker({
  lat, lng, title, street, kind, mk,
}: { lat: number; lng: number; title: string; street?: string; kind: 'start' | 'end'; mk: MapMarkerStyles }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 800);
    return () => clearTimeout(t);
  }, [title, street]);
  const labelH = street ? LABEL_H2 : LABEL_H;

  return (
    <Marker
      coordinate={{ latitude: lat, longitude: lng }}
      anchor={{ x: 0.5, y: (PIN / 2) / (PIN + LABEL_GAP + labelH) }}
      tracksViewChanges={track}
      zIndex={5}
    >
      <View style={mk.placeWrap}>
        {kind === 'start' ? (
          <View style={mk.pickPin}>
            <SolarIcon name="MapPoint" variant="bold" size={22} color="#FFFFFF" />
          </View>
        ) : (
          <View style={mk.dropPin}>
            <SolarIcon name="Flag" variant="bold" size={22} color="#000000" />
          </View>
        )}
        <View style={mk.labelPill}>
          <Text style={mk.labelText} numberOfLines={1}>{title}</Text>
          {!!street && <Text style={mk.labelSub} numberOfLines={1}>{street}</Text>}
        </View>
      </View>
    </Marker>
  );
});

// The provider's own position: white circle with a vehicle icon (same container as the courier pin elsewhere).
const ProviderPin = React.memo(function ProviderPin({
  lat, lng, online, accent, mk,
}: { lat: number; lng: number; online: boolean; accent: string; mk: MapMarkerStyles }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 1000);
    return () => clearTimeout(t);
  }, [online]);

  return (
    <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track} zIndex={10}>
      <View style={mk.courierPin}>
        <SolarIcon name="Car" variant="bold" size={26} color={online ? accent : '#64748B'} />
      </View>
    </Marker>
  );
});

// Shows the provider's selected route (start pin, destination pin, road line) and the provider's live position.
const toNum = (v: any): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

const ProviderMap = React.memo(({ provider, route, recenterTick, padBottom, online = true }: any) => {
  const { colors } = useTheme();
  const mapStyles = useMemo(() => makeMapStyles(), []);
  const focused = useIsFocused();

  const mapRef = useRef<MapView>(null);
  const [road, setRoad] = useState<{ key: string; coords: Coord[] } | null>(null);
  // Bumped when the native map may have dropped its overlays; remounts the line + pins.
  const [overlayEpoch, setOverlayEpoch] = useState(0);

  const roadLoadedKey = useRef('');
  const lastFitKey = useRef('');
  const firstFix = useRef(true);
  const wasFocused = useRef(focused);

  // Primitive, validated coordinates: the effects below only re-run when the route really changes,
  // not every time the parent re-renders and hands us a fresh `route` object.
  const sLat = toNum(route?.start?.lat);
  const sLng = toNum(route?.start?.lng);
  const eLat = toNum(route?.end?.lat);
  const eLng = toNum(route?.end?.lng);
  const hasRoute = sLat != null && sLng != null && eLat != null && eLng != null;
  const routeKey = hasRoute ? roadCacheKey({ lat: sLat!, lng: sLng! }, { lat: eLat!, lng: eLng! }) : '';

  // Load the road line. A failed / slow request never blocks the line: a straight placeholder is
  // drawn straight away and the real road replaces it as soon as it arrives (retrying in the background).
  useEffect(() => {
    if (!routeKey) { roadLoadedKey.current = ''; setRoad(null); return; }
    if (roadLoadedKey.current === routeKey) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const load = async (attempt: number) => {
      const coords = await fetchRoadCoordsStrict({ lat: sLat!, lng: sLng! }, { lat: eLat!, lng: eLng! });
      if (cancelled) return;
      if (coords) {
        roadLoadedKey.current = routeKey;
        setRoad({ key: routeKey, coords });
      } else if (attempt < 3) {
        retryTimer = setTimeout(() => { void load(attempt + 1); }, 4000 * (attempt + 1));
      }
    };
    void load(0);
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [routeKey]);

  const lineCoords = useMemo<Coord[]>(() => {
    if (!hasRoute) return [];
    if (road && road.key === routeKey) return road.coords;
    return [
      { latitude: sLat!, longitude: sLng! },
      { latitude: eLat!, longitude: eLng! },
    ];
  }, [hasRoute, road, routeKey, sLat, sLng, eLat, eLng]);

  // Android can drop the native line / pins when the map surface is recreated (app resumed from the
  // background or lock screen, screen refocused). Remount the overlays so they are drawn again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setOverlayEpoch(e => e + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (focused && !wasFocused.current) setOverlayEpoch(e => e + 1);
    wasFocused.current = focused;
  }, [focused]);

  // frame the whole selected route above the bottom sheet
  useEffect(() => {
    if (!hasRoute) { lastFitKey.current = ''; return; }
    const key = `${routeKey}|${padBottom}`;
    if (key === lastFitKey.current) return;
    lastFitKey.current = key;

    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        [
          { latitude: sLat!, longitude: sLng! },
          { latitude: eLat!, longitude: eLng! },
        ],
        { edgePadding: { top: 190, right: 64, bottom: padBottom || 260, left: 64 }, animated: true },
      );
    }, 180);
    return () => clearTimeout(t);
  }, [routeKey, padBottom]);

  useEffect(() => {
    if (!provider || hasRoute || !firstFix.current) return;
    firstFix.current = false;

    const t = setTimeout(() => {
      mapRef.current?.animateToRegion(
        { latitude: provider.lat, longitude: provider.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        450,
      );
    }, 150);
    return () => clearTimeout(t);
  }, [provider?.lat, provider?.lng, hasRoute]);

  useEffect(() => {
    if (!recenterTick || !provider) return;
    mapRef.current?.animateToRegion(
      { latitude: provider.lat, longitude: provider.lng, latitudeDelta: 0.012, longitudeDelta: 0.012 },
      350,
    );
  }, [recenterTick]);

  return (
    <MapView
      ref={mapRef}
      {...MAP_PROPS}
      userInterfaceStyle="light"
      style={StyleSheet.absoluteFill}
      initialRegion={{
        latitude: provider?.lat ?? DEFAULT_CENTER.latitude,
        longitude: provider?.lng ?? DEFAULT_CENTER.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {hasRoute && (
        <Polyline
          key={`line-${overlayEpoch}`}
          coordinates={lineCoords}
          strokeColor={BRAND_ORANGE}
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
        />
      )}
      {hasRoute && (
        <RoutePlaceMarker
          key={`start-${overlayEpoch}`}
          lat={sLat!}
          lng={sLng!}
          title={route.start.title || 'Starting Point'}
          street={route.start.sub}
          kind="start"
          mk={mapStyles}
        />
      )}
      {hasRoute && (
        <RoutePlaceMarker
          key={`end-${overlayEpoch}`}
          lat={eLat!}
          lng={eLng!}
          title={route.end.title || 'Destination'}
          street={route.end.sub}
          kind="end"
          mk={mapStyles}
        />
      )}

      {provider && (
        <ProviderPin
          key={`me-${overlayEpoch}`}
          lat={provider.lat}
          lng={provider.lng}
          online={online}
          accent={colors.accent}
          mk={mapStyles}
        />
      )}
    </MapView>
  );
});

const reverseGeocodeGoogle = async (coords: Coord) => {
  if (!HAS_API_KEY) return null;
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.latitude},${coords.longitude}&key=${GOOGLE_MAPS_API_KEY}`,
    );
    const json = await response.json();
    if (json.status === 'OK' && json.results.length > 0) {
      const result =
        json.results.find((r: any) =>
          (r.types || []).some((t: string) => ['point_of_interest', 'establishment', 'premise', 'street_address'].includes(t)),
        ) || json.results[0];
      const components = result.address_components || [];
      const get = (t: string) => components.find((c: any) => c.types.includes(t))?.long_name || '';
      const street = get('route') || result.formatted_address.split(',')[0];
      return {
        name: get('point_of_interest') || get('establishment') || get('premise') || street,
        sub: result.formatted_address as string,
        structured: {
          street_address: street,
          barangay: get('sublocality') || get('sublocality_level_1') || get('neighborhood') || 'Unknown',
          city: get('locality') || get('administrative_area_level_2') || 'Unknown',
          province: get('administrative_area_level_1') || 'Unknown',
          zip_code: get('postal_code') || '0000',
        },
      };
    }
  } catch (err) { console.warn(err); }
  return null;
};

const reverseGeocodeExpo = async (coords: Coord) => {
  try {
    const [addr] = await Location.reverseGeocodeAsync(coords);
    if (!addr) return null;
    const mainName = addr.name || addr.street || 'Selected Location';
    const subParts = [addr.street !== addr.name ? addr.street : null, addr.district || addr.subregion, addr.city, addr.region]
      .filter(Boolean).join(', ');
    return {
      name: mainName,
      sub: subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`,
      structured: {
        street_address: mainName, barangay: addr.district || 'Unknown', city: addr.city || 'Unknown',
        province: addr.region || 'Unknown', zip_code: addr.postalCode || '0000',
      },
    };
  } catch (err) { console.warn(err); }
  return null;
};

const fetchNearbyPlaces = async (coords: Coord): Promise<NearbyPlace[]> => {
  if (!HAS_API_KEY) return [];
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
      },
      body: JSON.stringify({
        maxResultCount: 12,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: coords, radius: NEARBY_RADIUS_M } },
      }),
    });
    const data = await response.json();
    return (data.places || [])
      .filter((p: any) => p.displayName?.text && p.location && !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
      .map((p: any) => {
        const pc = { latitude: p.location.latitude, longitude: p.location.longitude };
        return {
          id: p.id, name: p.displayName.text, address: p.formattedAddress || '',
          ...pc, dist: metersBetween(coords, pc),
        } as NearbyPlace;
      })
      .sort((a: NearbyPlace, b: NearbyPlace) => a.dist - b.dist);
  } catch (e) {
    console.warn('Nearby lookup failed', e);
  }
  return [];
};

const RouteLocationPickerModal = ({
  visible, onClose, onSelect, initialCoords, title, pinColor, asOverlay = false,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (loc: any) => void;
  initialCoords?: Coord | null;
  title: string;
  pinColor: string;
  asOverlay?: boolean;
}) => {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makePickerStyles(colors, isDark), [colors, isDark]);

  const mapRef = useRef<MapView>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);
  const lastResolved = useRef<Coord | null>(null);
  const lastPoiTap = useRef(0);
  const ignoreRegionUntil = useRef(0);
  const markerRef = useRef<Coord>(initialCoords || DEFAULT_CENTER);

  const [markerCoord, setMarkerCoord] = useState<Coord>(initialCoords || DEFAULT_CENTER);
  markerRef.current = markerCoord;

  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);
  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [kbH, setKbH] = useState(0);

  const pinBounce = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadRecents();
    if (initialCoords) {
      setMarkerCoord(initialCoords);
      resolveAt(initialCoords);
      const t = setTimeout(() => {
        ignoreRegionUntil.current = Date.now() + 600;
        mapRef.current?.animateToRegion({ ...initialCoords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 0);
      }, 50);
      return () => { cancelled = true; clearTimeout(t); };
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') { resolveAt(markerRef.current); return; }
        const loc = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch { if (!cancelled) resolveAt(markerRef.current); }
    })();
    return () => { cancelled = true; };
  }, [visible, initialCoords?.latitude, initialCoords?.longitude]);

  useEffect(() => {
    Animated.spring(pinBounce, { toValue: isDraggingMap ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true }).start();
  }, [isDraggingMap, pinBounce]);

  useEffect(() => () => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', e => setKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const loadRecents = async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentEntry[];
        setRecents(Array.isArray(parsed) ? parsed : []);
      }
    } catch { /* ignore */ }
  };

  const saveRecent = async (entry: RecentEntry) => {
    try {
      const next = [
        entry,
        ...recents.filter(r => Math.abs(r.latitude - entry.latitude) > 1e-4 || Math.abs(r.longitude - entry.longitude) > 1e-4),
      ].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  const resolveAt = async (coords: Coord, label?: Label) => {
    const seq = ++resolveSeq.current;
    lastResolved.current = coords;
    setValidatingPin(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub || ''); }

    const [geo, list] = await Promise.all([reverseGeocodeGoogle(coords), fetchNearbyPlaces(coords)]);
    if (seq !== resolveSeq.current) return;

    let g = geo;
    if (!g) g = await reverseGeocodeExpo(coords);
    if (seq !== resolveSeq.current) return;

    const close = label ? null : list.find(p => p.dist <= LABEL_SNAP_M) || null;
    const name = label?.name || close?.name || g?.name || 'Pinned location';
    const sub =
      label?.sub ||
      (close ? close.address || g?.sub || '' : g?.sub) ||
      `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;

    setAddressName(name);
    setAddressSub(sub);
    setNearby(list.filter(p => p.name !== name));
    setStructuredAddress(
      g?.structured || { street_address: name, barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000' },
    );
    setValidatingPin(false);
  };

  const moveTo = (coords: Coord, label?: Label) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    ignoreRegionUntil.current = Date.now() + 900;
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  };

  const handleLocateMe = async () => {
    if (locating) return;
    Keyboard.dismiss();
    try {
      setLocating(true);
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location is off', 'Allow location access so the map can jump to where you are.');
        return;
      }
      let first: Coord | null = null;
      try {
        const last = await Location.getLastKnownPositionAsync();
        if (last) { first = { latitude: last.coords.latitude, longitude: last.coords.longitude }; moveTo(first); }
      } catch { /* ignore */ }
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
      if (!first || metersBetween(first, here) > 15) moveTo(here);
    } catch {
      Alert.alert('Error', 'Could not fetch your current location.');
    } finally {
      setLocating(false);
    }
  };

  const runSearch = async (text: string) => {
    setSearchError(null);
    if (!text.trim()) { setSearchResults([]); return; }
    if (!HAS_API_KEY) { setSearchError('Search unavailable.'); return; }
    try {
      setSearchLoading(true);
      const c = markerRef.current;
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
        },
        body: JSON.stringify({
          textQuery: text, languageCode: 'en', regionCode: 'PH',
          locationBias: { circle: { center: { latitude: c.latitude, longitude: c.longitude }, radius: 50000.0 } },
        }),
      });
      const data = await response.json();
      if (data.error) { setSearchError(data.error.message); setSearchResults([]); return; }
      const detailed: SearchResult[] = (data.places || [])
        .filter((p: any) => !(p.types || []).some((t: string) => REJECTED_PLACE_TYPES.has(t)))
        .map((p: any) => ({
          place_id: p.id,
          name: p.displayName?.text || '',
          formatted_address: p.formattedAddress || '',
          geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
        }));
      setSearchResults(detailed);
      if (detailed.length === 0) setSearchError('Only streets matched.');
    } catch {
      setSearchError('Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!text.trim()) { setSearchResults([]); setSearchError(null); return; }
    searchDebounce.current = setTimeout(() => runSearch(text), 350);
  };

  const closeSearch = () => {
    setIsSearching(false); setSearchQuery(''); setSearchResults([]); setSearchError(null);
    Keyboard.dismiss();
  };

  const selectSearchResult = (item: SearchResult) => {
    const coords = { latitude: item.geometry.location.lat, longitude: item.geometry.location.lng };
    moveTo(coords, { name: item.name, sub: item.formatted_address });
    saveRecent({ name: item.name, address: item.formatted_address, latitude: coords.latitude, longitude: coords.longitude, ts: Date.now() });
    closeSearch();
  };

  const pickRecent = (r: RecentEntry) => {
    moveTo({ latitude: r.latitude, longitude: r.longitude }, { name: r.name, sub: r.address });
    closeSearch();
  };

  const pickNearby = (p: NearbyPlace) => {
    Keyboard.dismiss();
    moveTo({ latitude: p.latitude, longitude: p.longitude }, { name: p.name, sub: p.address });
  };

  const confirm = () => {
    const fullAddress = `${addressName}${addressSub && addressSub !== addressName ? ', ' + addressSub : ''}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress,
    };
    saveRecent({ name: addressName, address: addressSub || addressName, latitude: markerCoord.latitude, longitude: markerCoord.longitude, ts: Date.now() });
    onSelect(locationInfo);
  };

  const onPanDrag = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
  };

  const onRegionChangeComplete = (region: Region, details?: { isGesture?: boolean }) => {
    setIsDraggingMap(false);
    if (details?.isGesture === false) return;
    if (details?.isGesture !== true && Date.now() < ignoreRegionUntil.current) return;
    const center = { latitude: region.latitude, longitude: region.longitude };
    if (lastResolved.current && metersBetween(lastResolved.current, center) < SAME_SPOT_METERS) return;
    setMarkerCoord(center);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => resolveAt(center), 350);
  };

  const onPoiClick = (e: any) => {
    const { coordinate, name } = e.nativeEvent || {};
    if (!coordinate) return;
    lastPoiTap.current = Date.now();
    moveTo(
      { latitude: coordinate.latitude, longitude: coordinate.longitude },
      name ? { name: String(name).replace(/\n/g, ' ') } : undefined,
    );
  };

  const onMapPress = (e: any) => {
    Keyboard.dismiss();
    if (Date.now() - lastPoiTap.current < 500) return;
    const c = e.nativeEvent?.coordinate;
    if (!c) return;
    moveTo({ latitude: c.latitude, longitude: c.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const pinScale = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });

  const displayList: (SearchResult | RecentEntry)[] = searchQuery.trim().length > 0 ? searchResults : recents;
  const busy = validatingPin || isDraggingMap;

  const body = (
    <View style={[styles.container, { paddingBottom: kbH }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} translucent backgroundColor="transparent" />

      <View style={styles.mapArea}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          userInterfaceStyle="light"
          style={StyleSheet.absoluteFill}
          initialRegion={{ ...markerCoord, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }}
          onMapReady={() => setMapLoaded(true)}
          onPanDrag={onPanDrag}
          onRegionChangeComplete={onRegionChangeComplete}
          onPoiClick={onPoiClick}
          onPress={onMapPress}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        />

        {!mapLoaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}

        <View style={styles.centerStack} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: pinTranslateY }] }} pointerEvents="box-none">
            <TouchableOpacity style={styles.bubble} activeOpacity={0.9} onPress={() => setIsSearching(true)}>
              <Text style={styles.bubbleText} numberOfLines={1}>{addressName}</Text>
              {busy
                ? <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 8 }} />
                : <SolarIcon name="AltArrowRight" variant="bold" size={16} color={colors.textMuted} style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          </Animated.View>

          <View style={styles.pinContainer} pointerEvents="none">
            <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinTranslateY }, { scale: pinScale }] }]}>
              <View style={[styles.pinDot, { backgroundColor: pinColor }]}>
                <View style={styles.pinDotInner} />
              </View>
              <View style={[styles.pinStem, { backgroundColor: pinColor }]} />
            </Animated.View>
            <View style={styles.pinShadow} />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.iconBtn, { top: insets.top + 10 }]}
          onPress={onClose}
          activeOpacity={0.85}
        >
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.locateMeBtn} onPress={handleLocateMe} disabled={locating} activeOpacity={0.85}>
          {locating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <SolarIcon name="Compass" variant="linear" size={24} color={colors.textPrimary} />}
        </TouchableOpacity>
      </View>

      <View style={styles.sheet}>
        <View style={styles.dragHandle} />

        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={[styles.row, { backgroundColor: colors.accentSoft }]} activeOpacity={0.85} onPress={() => setIsSearching(true)}>
            <View style={styles.rowIconCol}>
              <View style={[styles.rowIcon, { backgroundColor: pinColor }]}>
                <SolarIcon name="MapPoint" variant="boldDuotone" size={18} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{addressName}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {busy ? 'Updating address...' : addressSub || 'Fetching address details...'}
              </Text>
            </View>
            <SolarIcon name="Pen" variant="linear" size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          {nearby.map(p => (
            <TouchableOpacity key={p.id} style={styles.row} activeOpacity={0.7} onPress={() => pickNearby(p)}>
              <View style={styles.rowIconCol}>
                <View style={[styles.rowIconMuted, { backgroundColor: colors.background }]}>
                  <SolarIcon name="MapPoint" variant="linear" size={18} color={colors.textSecondary} />
                </View>
                <Text style={styles.rowDist}>{fmtDist(p.dist)}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{p.address}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {nearby.length === 0 && (
            <Text style={styles.emptyNearby}>
              {busy ? 'Looking for nearby places...' : 'No named places nearby. Drag the map or search.'}
            </Text>
          )}
        </ScrollView>

        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: pinColor }, busy && { opacity: 0.6 }]}
          onPress={() => { Keyboard.dismiss(); confirm(); }}
          activeOpacity={0.9}
          disabled={busy}
        >
          <Text style={styles.confirmBtnText}>
            {busy ? 'Updating...' : `Confirm ${title}`}
          </Text>
        </TouchableOpacity>
        <View style={{ height: kbH > 0 ? 8 : Math.max(insets.bottom, 12) }} />
      </View>

      {isSearching && (
        <View style={[styles.searchOverlay, { backgroundColor: colors.background, paddingTop: insets.top + 10 }]}>
          <View style={styles.searchModalHeader}>
            <TouchableOpacity style={styles.searchBackBtn} onPress={closeSearch}>
              <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <View style={styles.searchInputWrapper}>
              <SolarIcon name="Magnifier" variant="linear" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search mall, school, landmark..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={10}>
                  <SolarIcon name="CloseCircle" variant="linear" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {searchLoading && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 20 }} />}
          {!!searchError && !searchLoading && <Text style={styles.searchErrorText}>{searchError}</Text>}

          {searchQuery.trim().length === 0 && recents.length > 0 && (
            <View style={styles.recentsHeader}>
              <Text style={styles.recentsLabel}>RECENT</Text>
              <TouchableOpacity onPress={async () => { try { await AsyncStorage.removeItem(RECENTS_KEY); setRecents([]); } catch { /* ignore */ } }}>
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}

          <FlatList
            data={displayList}
            keyExtractor={(item: any, index) => (item.place_id || item.name) + index}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 }}
            renderItem={({ item }) => {
              const isRecent = !('place_id' in item);
              return (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => (isRecent ? pickRecent(item as RecentEntry) : selectSearchResult(item as SearchResult))}
                >
                  <View style={styles.searchResultIconBox}>
                    <SolarIcon name={isRecent ? 'History' : 'MapPoint'} variant="linear" size={18} color={pinColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.searchResultTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.searchResultSub} numberOfLines={2}>
                      {isRecent ? (item as RecentEntry).address : (item as SearchResult).formatted_address}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}
    </View>
  );

  if (asOverlay) {
    if (!visible) return null;
    return <View style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}>{body}</View>;
  }

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      {body}
    </Modal>
  );
};

const makePickerStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  mapArea: { flex: 1, backgroundColor: isDark ? '#0B0F17' : '#F5F5F5', overflow: 'hidden' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  centerStack: {
    position: 'absolute', left: 0, right: 0, top: '50%',
    marginTop: -(32 + 8 + 42), height: 42 + 8 + 32,
    alignItems: 'center', zIndex: 4,
  },
  bubble: {
    height: 42, maxWidth: '78%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 21, paddingHorizontal: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  bubbleText: { flexShrink: 1, fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  pinContainer: { marginTop: 8, alignItems: 'center' },
  pinWrapper: { alignItems: 'center' },
  pinDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  pinDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  pinStem: { width: 2, height: 8, marginTop: -2, zIndex: 1 },
  pinShadow: { position: 'absolute', bottom: -2, width: 8, height: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.25)' },
  iconBtn: {
    position: 'absolute', left: 16, width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  locateMeBtn: {
    position: 'absolute', right: 16, bottom: 34, width: 52, height: 52, borderRadius: 14, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -24,
    zIndex: 6,
    borderTopWidth: 1, borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 6, backgroundColor: c.border },
  list: { maxHeight: 232 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 14 },
  rowIconCol: { width: 56, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowIconMuted: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowDist: { fontSize: 11, color: c.textSecondary, marginTop: 4, fontFamily: 'Poppins_600SemiBold' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  rowSub: { fontSize: 13, color: c.textSecondary, marginTop: 2, fontFamily: 'Poppins_400Regular' },
  emptyNearby: { textAlign: 'center', fontSize: 12, color: c.textMuted, paddingVertical: 14, paddingHorizontal: 20, fontFamily: 'Poppins_400Regular' },
  confirmBtn: {
    marginHorizontal: 20, marginTop: 6, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  searchBackBtn: {
    width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, backgroundColor: c.card, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  searchInputWrapper: { flex: 1, height: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: 1, backgroundColor: c.card, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Poppins_500Medium', color: c.textPrimary },
  searchErrorText: { textAlign: 'center', marginTop: 24, fontSize: 13, color: c.textMuted, fontFamily: 'Poppins_400Regular' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 14 },
  searchResultIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  searchResultTitle: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 3 },
  searchResultSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 16 },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  recentsLabel: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 1 },
  clearText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.accent },
});

// Green status dot with an expanding halo. The loop is restarted every time the screen gains focus, so it keeps
// pulsing after the provider switches to another tab and comes back (native loops can be paused while blurred).
const OnlinePulseDot = React.memo(function OnlinePulseDot({ online, color }: { online: boolean; color: string }) {
  const focused = useIsFocused();
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    halo.setValue(0);
    if (!online || !focused) return;
    const loop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [online, focused, halo]);

  const scale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = halo.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.18, 0] });

  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      {online && (
        <Animated.View
          style={{
            position: 'absolute', width: 10, height: 10, borderRadius: 5,
            backgroundColor: color, opacity, transform: [{ scale }],
          }}
        />
      )}
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: online ? color : '#94A3B8' }} />
    </View>
  );
});

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);
  const [usedTodayCount, setUsedTodayCount] = useState(0);
  const [, setDemoModeState] = useState(false);

  const providerIdRef = useRef<number | null>(null);
  const activeRouteRef = useRef<Route | null>(null);
  const routesRef = useRef<Route[]>([]);

  const hasLoadedRef = useRef(false);
  const loadInFlightRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const modalOpenRef = useRef(false);
  const loadDataRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Map<number, number>>(new Map());   // request_id -> declined at (ms)
  const [rtEpoch, setRtEpoch] = useState(0);                      // bump to rebuild the realtime channel
  const screenFocused = useIsFocused();

  useEffect(() => { providerIdRef.current = providerId; }, [providerId]);
  useEffect(() => { activeRouteRef.current = activeRoute; }, [activeRoute]);
  useEffect(() => { routesRef.current = routes; }, [routes]);

  const [requests, setRequests] = useState<JobRequest[]>([]);
  const [checkingMatches, setCheckingMatches] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  const [detailRequestId, setDetailRequestId] = useState<number | null>(null);
  const [routePickerVisible, setRoutePickerVisible] = useState(false);

  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);

  const [awaiting, setAwaiting] = useState<JobRequest[]>([]);
  const [lapsedIds, setLapsedIds] = useState<number[]>([]);
  const awaitingSeqRef = useRef(0);

  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullListOpen, setFullListOpen] = useState(false);

  // bottom sheet (same geometry as LiveTrackingScreen)
  const { height: winH } = useWindowDimensions();
  const sheetHeight = Math.round(winH * 0.4);
  const expandedH = Math.round(winH * 0.9);
  const collapsedY = expandedH - sheetHeight;
  const sheetY = useRef(new Animated.Value(collapsedY)).current;
  const sheetRef = useRef<DraggableSheetHandle>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const awaitingIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    awaitingIdsRef.current = new Set([...awaiting, ...requests].map(r => Number(r.request_id)));
  }, [awaiting, requests]);
  // opening the details page unmounts the sheet, so its open state must not linger
  useEffect(() => { if (detailRequestId != null) setSheetOpen(false); }, [detailRequestId]);

  const [addRouteModalVisible, setAddRouteModalVisible] = useState(false);
  const [routeLocationPickerVisible, setRouteLocationPickerVisible] = useState(false);
  const [routeLocationPickerType, setRouteLocationPickerType] = useState<'start' | 'end'>('start');
  const [newRouteStart, setNewRouteStart] = useState<Location | null>(null);
  const [newRouteEnd, setNewRouteEnd] = useState<Location | null>(null);
  const [newRouteFrequency, setNewRouteFrequency] = useState<Frequency>('Daily');
  const [newRouteDepartureDate, setNewRouteDepartureDate] = useState(new Date());
  const [newRouteDepartureTime, setNewRouteDepartureTime] = useState(new Date(Date.now() + 135 * 60 * 1000));
  const [newRouteDurationHours, setNewRouteDurationHours] = useState<number>(2);
  const [newRouteSelectedWeekday, setNewRouteSelectedWeekday] = useState<number>(new Date().getDay());
  const [newRouteVehicleId, setNewRouteVehicleId] = useState<number | null>(null);
  const [newRouteVehicles, setNewRouteVehicles] = useState<Vehicle[]>([]);
  const [newRouteSubmitting, setNewRouteSubmitting] = useState(false);
  const [newRouteShowDatePicker, setNewRouteShowDatePicker] = useState(false);
  const [newRouteShowTimePicker, setNewRouteShowTimePicker] = useState(false);
  const [newRoutePreviewCoords, setNewRoutePreviewCoords] = useState<Coord[]>([]);

  const addRoutePreviewMapRef = useRef<MapView>(null);
  const notifiedMatchIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    getDemoMode().then(setDemoModeState);
    return subscribeDemoMode(setDemoModeState);
  }, []);

  // ---- Route switching (single source of truth) ----------------------------------------------
  // Timestamp of the last route switch made on this device. Background reloads use it to know
  // that the provider's choice must win over whatever an older, slower load resolved.
  const lastLocalSelectAtRef = useRef(0);
  const applyRouteRef = useRef<(r: Route, persist: boolean) => Promise<void>>(async () => {});

  // loadData() silently bails when another load is running or a modal is open. For reloads we
  // really need (route list changed / unknown route selected), retry until it can run.
  const reloadWhenIdle = useCallback(() => {
    let attempt = 0;
    const tryNow = () => {
      if (!loadInFlightRef.current && !modalOpenRef.current) { void loadDataRef.current(true); return; }
      if (++attempt < 10) setTimeout(tryNow, 500);
    };
    tryNow();
  }, []);

  // Route selected from somewhere else in the app (e.g. Manage Routes): follow it immediately.
  useEffect(() => {
    return subscribeActiveRoute((newRouteId) => {
      if (!newRouteId || activeRouteRef.current?.route_id === newRouteId) return;
      const found = routesRef.current.find(r => r.route_id === newRouteId);
      if (found) void applyRouteRef.current(found, false);
      else reloadWhenIdle();
    });
  }, [reloadWhenIdle]);

  const fireLocalMatchNotification = async (body: string) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Route Match Available',
          body,
          data: { type: 'match' },
          sound: true,
        },
        trigger: null,
      });
    } catch { /* ignore */ }
  };

  const loadNotifs = useCallback(async () => {
    const pid = providerIdRef.current;
    if (!pid) return;
    setNotifLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, type, is_read, created_at, ref_id')
        .eq('user_id', pid)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const list = (data || []) as Notif[];
      setNotifs(list);
      setUnreadCount(list.filter(n => !n.is_read).length);
    } catch (e) { console.warn('[jobs] notif load failed', e); }
    finally { setNotifLoading(false); }
  }, []);

  const handleOpenNotifs = () => { setNotifModalOpen(true); loadNotifs(); };

  const markNotifRead = async (n: Notif) => {
    if (n.is_read) return;
    setNotifs(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, is_read: true } : x));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notif_id); }
    catch { /* ignore */ }
  };

  const handleNotifPress = async (n: Notif) => {
    await markNotifRead(n);
    setNotifModalOpen(false);
    const type = (n.type || '').toLowerCase();
    if (type.startsWith('support') && !isWithdrawalNotif(n)) { setFullListOpen(true); return; }
    const handled = await routeNotification(navigation, n, { role: 'provider' });
    if (!handled) { Alert.alert(titleForNotif(n), n.body || ''); }
  };

  const getProviderData = async (): Promise<number | null> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id, is_online')
        .eq('auth_id', user.id)
        .single();
      if (error) throw error;
      setProviderId(userData.user_id);
      providerIdRef.current = userData.user_id;
      setIsOnline(!!(userData as any).is_online);
      return userData.user_id;
    } catch { return null; }
  };

  const hasOffers = awaiting.length > 0;

  useFocusEffect(
    useCallback(() => {
      setTabBarHidden(!loading && !isOnline && !hasOffers);
      return () => setTabBarHidden(false);
    }, [isOnline, loading, hasOffers]),
  );

  const goToTasks = () => {
    try {
      let cur: any = navigation;
      while (cur) {
        const names: string[] = cur.getState?.()?.routeNames || [];
        const match = names.find(n => /task/i.test(n));
        if (match) { cur.navigate(match); return; }
        cur = cur.getParent?.();
      }
      navigation.navigate('MainTabs', { screen: 'Tasks' });
    } catch {
      navigation.goBack();
    }
  };

  const goToManageRoutes = () => {
    setRoutePickerVisible(false);
    navigation.navigate('ManageRoutes');
  };

  const fetchRoutes = async (pid: number): Promise<{ resolvedRoute: Route | null; validRoutes: Route[] }> => {
    try {
      const [stats, { data, error }] = await Promise.all([
        getTodayRouteStats(pid),
        supabase
          .from('provider_routes')
          .select(`
            *,
            start_location:locations!provider_routes_start_location_id_fkey(*),
            end_location:locations!provider_routes_end_location_id_fkey(*),
            vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
          `)
          .eq('provider_id', pid)
          .order('created_at', { ascending: false }),
      ]);
      setUsedTodayCount(stats.usedTodayCount);
      if (error) throw error;

      const validRoutes = ((data || []) as Route[]).filter((r) => r.is_deleted !== true && !isRouteExpired(r));
      setRoutes(validRoutes);
      routesRef.current = validRoutes;

      const savedId = await getActiveRouteId();
      const restored = savedId ? validRoutes.find((r) => r.route_id === savedId) : null;

      if (restored) {
        setActiveRoute(restored);
        activeRouteRef.current = restored;
        if (restored.is_selected !== true) void syncSelectedRouteToDb(restored.route_id, true);
        return { resolvedRoute: restored, validRoutes };
      } else if (validRoutes.length > 0) {
        const firstRoute = validRoutes[0];
        setActiveRoute(firstRoute);
        activeRouteRef.current = firstRoute;
        await setActiveRouteId(firstRoute.route_id);
        return { resolvedRoute: firstRoute, validRoutes };
      } else {
        setActiveRoute(null);
        activeRouteRef.current = null;
        await setActiveRouteId(null);
        return { resolvedRoute: null, validRoutes: [] };
      }
    } catch (e) {
      console.error('fetchRoutes error:', e);
      return { resolvedRoute: activeRouteRef.current, validRoutes: routesRef.current };
    }
  };

  const refreshSeqRef = useRef(0);

  const loadAwaiting = useCallback(async (pid: number | null, selectedRoute?: Route | null) => {
    const seq = ++awaitingSeqRef.current;
    const isLatest = () => seq === awaitingSeqRef.current;
    if (!pid || !selectedRoute) { setAwaiting([]); setLapsedIds([]); return; }
    try {
      const sel = `*, pickup_location:locations!delivery_requests_pickup_location_id_fkey(*), dropoff_location:locations!delivery_requests_dropoff_location_id_fkey(*), cargo:cargo_id(*), receiver:receiver_id(*)`;
      const [directRes, matchRes] = await Promise.all([
        supabase.from('delivery_requests').select(sel)
          .eq('preferred_provider_id', pid)
          .eq('delivery_status', 'Pending')
          .in('payment_status', ['held', 'paid', 'released']),
        supabase.from('route_request_matches')
          .select(`*, route:provider_routes(route_id, is_active, is_deleted, fallback_unlocked, corridor_path, start_location:locations!provider_routes_start_location_id_fkey(latitude,longitude), end_location:locations!provider_routes_end_location_id_fkey(latitude,longitude)), request:delivery_requests (${sel})`)
          .eq('provider_id', pid)
          .eq('route_id', selectedRoute.route_id)
          .in('status', ['matched', 'expired'])
          .order('match_score', { ascending: false }),
      ]);

      const byReq = new Map<number, RouteMatchRow>();
      const lapsed = new Set<number>();
      const maxAgeMs = AWAITING_MAX_AGE_HOURS * 3600000;

      for (const m of (matchRes.data || []) as any[]) {
        const req = m.request;
        const route = Array.isArray(m.route) ? m.route[0] : m.route;
        if (!req || req.delivery_status !== 'Pending') continue;
        // sender has not paid yet (still choosing receiver / setting up payment): not a request for the provider
        if (!['held', 'paid', 'released'].includes(String(req.payment_status || '').toLowerCase())) continue;
        if (route && (route.is_deleted || route.is_active === false)) continue;
        if (req.preferred_provider_id != null && Number(req.preferred_provider_id) !== Number(pid)) continue;
        const isDirect = req.preferred_provider_id != null && Number(req.preferred_provider_id) === Number(pid);
        // Strict corridor: the provider must really drive within ~200 m of BOTH pickup and drop-off.
        // Stored rows from older versions / DB functions that don't satisfy it are hidden and revoked.
        if (!isDirect && !isRequestWithinRouteCorridor(route ?? selectedRoute, req)) {
          supabase.from('route_request_matches').update({ status: 'revoked' }).eq('match_id', m.match_id)
            .then(() => {}, () => {});
          continue;
        }
        const live = m.status === 'matched';
        if (!live && !isDirect) {
          const ageMs = Date.now() - parseRequestCreatedTime(req).getTime();
          if (ageMs > maxAgeMs) continue;
        }
        const id = Number(m.request_id);
        const prev = byReq.get(id);
        if (prev && (prev.status === 'matched' || !live)) continue;
        byReq.set(id, { ...m, request: req } as RouteMatchRow);
        if (live || isDirect) lapsed.delete(id); else lapsed.add(id);
      }

      for (const dr of (directRes.data || []) as any[]) {
        if (dr.delivery_status !== 'Pending') continue;
        const id = Number(dr.request_id);
        if (byReq.has(id) && byReq.get(id)!.status === 'matched') continue;
        byReq.set(id, {
          match_id: 0, route_id: Number(dr.preferred_route_id || selectedRoute.route_id), request_id: id, provider_id: pid,
          match_score: 100, is_fallback: false, fallback_type: null,
          pickup_dist_m: 0, dropoff_dist_m: 0, pickup_fraction: 0, dropoff_fraction: 1, extra_detour_km: 0,
          status: 'matched', request: dr,
        } as RouteMatchRow);
        lapsed.delete(id);
      }

      const candidateIds = Array.from(byReq.keys());
      if (candidateIds.length > 0) {
        const { data: claimedRows } = await supabase
          .from('deliveries')
          .select('request_id')
          .in('request_id', candidateIds);
        for (const c of (claimedRows || []) as any[]) {
          const cid = Number(c.request_id);
          byReq.delete(cid);
          lapsed.delete(cid);
        }
      }

      const rows = Array.from(byReq.values());
      if (rows.length === 0) {
        if (isLatest()) { setAwaiting([]); setLapsedIds([]); }
        return;
      }

      const senders = await fetchSenderMap(rows.map(m => m.request?.sender_id));

      rows.sort((a, b) => {
        const al = lapsed.has(Number(a.request_id)) ? 1 : 0;
        const bl = lapsed.has(Number(b.request_id)) ? 1 : 0;
        if (al !== bl) return al - bl;
        return Number(b.match_score) - Number(a.match_score);
      });

      if (!isLatest()) return;
      const normalized = rows
        .map(m => normalizeMatchRow(m, senders, pid))
        .filter(r => !dismissedRef.current.has(Number(r.request_id)));
      setAwaiting(normalized);
      setLapsedIds(rows.filter(m => lapsed.has(Number(m.request_id))).map(m => Number(m.request_id)));
    } catch (e) {
      console.warn('[Jobs] loadAwaiting error:', e);
    }
  }, []);

  const refreshMatches = useCallback(async (
    overridePid?: number | null,
    overrideActiveRoute?: Route | null,
    evaluate = false,
    silent = false,
  ) => {
    const pid = overridePid ?? providerIdRef.current;
    if (!pid) return;

    const selected = overrideActiveRoute !== undefined ? overrideActiveRoute : activeRouteRef.current;
    const seq = ++refreshSeqRef.current;
    const isLatest = () => seq === refreshSeqRef.current;

    try {
      if (!silent) setCheckingMatches(true);

      // Rule 1: no posted/selected route => zero requests shown.
      if (!selected) {
        if (isLatest()) {
          setRequests([]);
          setAwaiting([]);
          setLapsedIds([]);
        }
        return;
      }

      const isDemo = await getDemoMode();
      const [directMatches, standardMatches] = await Promise.all([
        fetchDirectRequestMatches(pid, selected.route_id),
        evaluateAndFetchRouteMatches(selected.route_id, isDemo, { evaluate }),
      ]);

      await loadAwaiting(pid, selected);

      const allMatches: RouteMatchRow[] = [...directMatches];
      for (const sm of standardMatches) {
        if (!allMatches.some(m => m.request_id === sm.request_id)) allMatches.push(sm);
      }

      if (!isLatest()) return;

      if (allMatches.length === 0) {
        setRequests([]);
        return;
      }

      const candidateIds = allMatches.map(m => Number(m.request_id));
      const { data: claimedRows } = await supabase
        .from('deliveries')
        .select('request_id')
        .in('request_id', candidateIds);
      const claimedSet = new Set((claimedRows || []).map((c: any) => Number(c.request_id)));
      const openMatches = allMatches.filter(m =>
        !claimedSet.has(Number(m.request_id)) &&
        !dismissedRef.current.has(Number(m.request_id)) &&
        m.request?.delivery_status === 'Pending');

      if (!isLatest()) return;

      if (openMatches.length === 0) {
        setRequests([]);
        return;
      }

      const senders = await fetchSenderMap(openMatches.map(m => m.request?.sender_id));
      if (!isLatest()) return;

      const hydrated = openMatches.map(m => normalizeMatchRow(m, senders, pid));

      for (const req of hydrated) {
        if (!notifiedMatchIdsRef.current.has(req.request_id)) {
          notifiedMatchIdsRef.current.add(req.request_id);
          fireLocalMatchNotification(
            req.isDirectRequest
              ? `A sender requested your route from ${req.pickup.main} to ${req.dropoff.main}.`
              : `New ${Math.round(req.matchScore || 0)}% route match from ${req.pickup.main} to ${req.dropoff.main}.`,
          );
        }
      }

      setRequests(hydrated);
    } catch (e) {
      console.warn('refreshMatches error:', e);
    } finally {
      if (isLatest()) setCheckingMatches(false);
    }
  }, [loadAwaiting]);

  // Switch the active route right now: update UI + refs synchronously, drop the previous route's
  // requests, invalidate any in-flight fetch for the old route, then persist and re-match.
  const applyActiveRoute = useCallback(async (r: Route, persist: boolean) => {
    if (!r) return;
    lastLocalSelectAtRef.current = Date.now();
    refreshSeqRef.current += 1;      // stale refreshMatches() calls can no longer write state
    awaitingSeqRef.current += 1;     // same for loadAwaiting()
    setActiveRoute(r);
    activeRouteRef.current = r;
    setRequests([]);
    setAwaiting([]);
    setLapsedIds([]);
    if (persist) await setActiveRouteId(r.route_id);
    await refreshMatches(providerIdRef.current, r, true);
  }, [refreshMatches]);
  applyRouteRef.current = applyActiveRoute;

  modalOpenRef.current = addRouteModalVisible || routeLocationPickerVisible;

  const loadData = async (force = false) => {
    if (modalOpenRef.current) return;
    if (loadInFlightRef.current) return;
    if (!force && hasLoadedRef.current && Date.now() - lastLoadAtRef.current < 2000) return;

    loadInFlightRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const pid = await getProviderData();
      if (pid) {
        void loadNotifs();
        const switchedAt = lastLocalSelectAtRef.current;
        const { resolvedRoute } = await fetchRoutes(pid);
        // If the provider switched route while this load was running, their choice wins.
        const routeNow = lastLocalSelectAtRef.current !== switchedAt
          ? activeRouteRef.current
          : resolvedRoute;
        await refreshMatches(pid, routeNow, true);
      }
    } catch (e) {
      console.warn('loadData error:', e);
    } finally {
      hasLoadedRef.current = true;
      lastLoadAtRef.current = Date.now();
      loadInFlightRef.current = false;
      setLoading(false);
    }
  };
  loadDataRef.current = loadData;

  useFocusEffect(
    useCallback(() => {
      void loadDataRef.current();
    }, [])
  );

  // Requests this provider declined stay hidden even if a later re-evaluation would match them again.
  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(`${DISMISSED_KEY}:${providerId}`);
        const stored: Record<string, number> = raw ? JSON.parse(raw) : {};
        const cutoff = Date.now() - DISMISSED_TTL_MS;
        Object.entries(stored).forEach(([id, ts]) => {
          if (Number(ts) > cutoff && !dismissedRef.current.has(Number(id))) dismissedRef.current.set(Number(id), Number(ts));
        });
        if (cancelled || dismissedRef.current.size === 0) return;
        const hide = (r: JobRequest) => !dismissedRef.current.has(Number(r.request_id));
        setAwaiting(prev => prev.filter(hide));
        setRequests(prev => prev.filter(hide));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [providerId]);

  // LIVE UPDATES: realtime channel (+ resync on connect, app foreground and a light poll as a safety net)
  useEffect(() => {
    if (!providerId) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let routeTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      realtimeDebounceRef.current = setTimeout(() => {
        void refreshMatches(providerIdRef.current, activeRouteRef.current, false, true);
      }, 250);
    };

    // my own routes changed (edited, ended, capacity changed, selected elsewhere): reload routes + matches
    const scheduleRouteReload = () => {
      if (routeTimer) clearTimeout(routeTimer);
      // our own is_selected writes echo back as provider_routes events: let a fresh local switch settle first
      const sinceLocal = Date.now() - lastLocalSelectAtRef.current;
      const delay = sinceLocal < 4000 ? 4000 - sinceLocal + 300 : 800;
      routeTimer = setTimeout(() => { reloadWhenIdle(); }, delay);
    };

    // A change to someone else's request must not trigger a full refetch on every provider's phone.
    const concernsMe = (payload: any) => {
      const rec = payload?.new && Object.keys(payload.new).length ? payload.new : payload?.old;
      if (!rec || rec.request_id == null) return true;                       // cannot tell: be safe
      if (awaitingIdsRef.current.has(Number(rec.request_id))) return true;   // one of the requests on my screen changed
      return rec.preferred_provider_id != null && Number(rec.preferred_provider_id) === Number(providerIdRef.current);
    };

    const channel = supabase
      .channel(`jobs-unified-${providerId}-${rtEpoch}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'route_request_matches', filter: `provider_id=eq.${providerId}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'route_request_matches', filter: `provider_id=eq.${providerId}` }, scheduleRefresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'route_request_matches' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_requests' }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'delivery_requests' }, (payload) => { if (concernsMe(payload)) scheduleRefresh(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'delivery_requests' }, (payload) => { if (concernsMe(payload)) scheduleRefresh(); })
      // another provider accepting a request inserts a deliveries row: drop it from my list right away
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries' }, (payload) => { if (concernsMe(payload)) scheduleRefresh(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_routes', filter: `provider_id=eq.${providerId}` }, scheduleRouteReload)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${providerId}` }, (payload) => {
        void loadNotifs();
        const row: any = payload.new;
        const t = (row?.type || '').toLowerCase();
        if (t === 'match' || t.includes('direct')) {
          fireLocalMatchNotification(row?.body || 'A new sender request matches your route.');
          scheduleRefresh();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_log', filter: `user_id=eq.${providerId}` }, () => {
        void loadNotifs();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // anything that happened while the socket was down or still connecting
          scheduleRefresh();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[jobs] realtime', status, '- retrying');
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => setRtEpoch(e => e + 1), 5000);
        }
      });

    return () => {
      if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
      if (routeTimer) clearTimeout(routeTimer);
      if (retryTimer) clearTimeout(retryTimer);
      supabase.removeChannel(channel);
    };
  }, [providerId, rtEpoch, refreshMatches, loadNotifs, reloadWhenIdle]);

  // coming back from the background: the socket may have been suspended, so resync immediately
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !providerIdRef.current) return;
      void refreshMatches(providerIdRef.current, activeRouteRef.current, true, true);
      void loadNotifs();
    });
    return () => sub.remove();
  }, [refreshMatches, loadNotifs]);

  // light safety-net poll while this screen is on top (silent: no spinner)
  useEffect(() => {
    if (!providerId || !screenFocused) return;
    let tick = 0;
    const id = setInterval(() => {
      if (modalOpenRef.current || loadInFlightRef.current) return;
      tick += 1;
      void refreshMatches(providerIdRef.current, activeRouteRef.current, tick % POLL_EVALUATE_EVERY === 0, true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [providerId, screenFocused, refreshMatches]);

  const fetchVehiclesForNewRoute = async (pid: number) => {
    const { data } = await supabase
      .from('vehicles')
      .select('vehicle_id, vehicle_type, plate_number, max_volume_liters, max_weight_kg, verification_status')
      .eq('provider_id', pid)
      .eq('verification_status', 'Verified');
    return (data || []) as Vehicle[];
  };

  const openAddRouteModal = async () => {
    const pid = providerId || (await getProviderData());
    if (!pid) { Alert.alert('Error', 'Provider account details not loaded yet.'); return; }
    setRoutePickerVisible(false);
    const initial = new Date(Date.now() + 135 * 60 * 1000);
    setNewRouteStart(null);
    setNewRouteEnd(null);
    setNewRouteFrequency('Daily');
    setNewRouteDepartureDate(initial);
    setNewRouteDepartureTime(initial);
    setNewRouteDurationHours(2);
    setNewRouteSelectedWeekday(initial.getDay());
    setNewRouteVehicleId(null);
    setNewRouteShowDatePicker(false);
    setNewRouteShowTimePicker(false);
    setNewRoutePreviewCoords([]);
    const vehicles = await fetchVehiclesForNewRoute(pid);
    setNewRouteVehicles(vehicles);
    setAddRouteModalVisible(true);
  };

  const handleNewRouteLocationSelect = async (locData: any, type: 'start' | 'end') => {
    try {
      const { data: existing, error: existingErr } = await supabase
        .from('locations')
        .select('*')
        .eq('latitude', locData.latitude)
        .eq('longitude', locData.longitude)
        .limit(1);

      if (existingErr) throw existingErr;

      let location: Location | null = existing && existing.length > 0 ? existing[0] : null;

      if (!location) {
        const { data: newLoc, error } = await supabase.from('locations').insert({
          street_address: locData.street_address || 'Pinned location',
          barangay: locData.barangay || 'Unknown',
          city: locData.city || 'Unknown',
          province: locData.province || 'Unknown',
          zip_code: locData.zip_code || '0000',
          latitude: locData.latitude,
          longitude: locData.longitude,
        }).select('*').single();
        if (error) throw error;
        location = newLoc;
      }

      if (type === 'start') setNewRouteStart(location);
      else setNewRouteEnd(location);

      setRouteLocationPickerVisible(false);
    } catch (err: any) {
      console.error(err);
      Alert.alert('Error', 'Failed to save location to database.');
    }
  };

  useEffect(() => {
    if (!newRouteStart || !newRouteEnd) { setNewRoutePreviewCoords([]); return; }
    let cancelled = false;
    fetchRoadCoords(
      { lat: newRouteStart.latitude, lng: newRouteStart.longitude },
      { lat: newRouteEnd.latitude, lng: newRouteEnd.longitude },
    ).then((coords) => {
      if (!cancelled) setNewRoutePreviewCoords(coords);
    });
    return () => { cancelled = true; };
  }, [newRouteStart?.location_id, newRouteEnd?.location_id]);

  useEffect(() => {
    if (!newRouteStart || !newRouteEnd) return;
    const pts = newRoutePreviewCoords.length >= 2
      ? newRoutePreviewCoords
      : [
          { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude },
          { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude },
        ];
    const t = setTimeout(() => {
      addRoutePreviewMapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [newRouteStart?.location_id, newRouteEnd?.location_id, newRoutePreviewCoords.length]);

  const computeNewRouteEffectiveDate = (): Date => {
    if (newRouteFrequency === 'Daily') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (newRouteFrequency === 'Weekly') {
      return nextWeekday(newRouteSelectedWeekday);
    }
    return newRouteDepartureDate;
  };

  const handleAddRouteSubmit = async () => {
    if (!providerId) { Alert.alert('Error', 'Provider not loaded.'); return; }
    if (!newRouteStart || !newRouteEnd || !newRouteVehicleId || !newRouteStart.location_id || !newRouteEnd.location_id) {
      Alert.alert('Required', 'Please select start location, destination, and vehicle.');
      return;
    }

    const effectiveDate = computeNewRouteEffectiveDate();
    const combined = new Date(
      effectiveDate.getFullYear(),
      effectiveDate.getMonth(),
      effectiveDate.getDate(),
      newRouteDepartureTime.getHours(),
      newRouteDepartureTime.getMinutes(),
      0,
      0,
    );
    const endTimeObj = new Date(combined.getTime() + newRouteDurationHours * 60 * 60 * 1000);

    setNewRouteSubmitting(true);
    try {
      const res = await createProviderRouteWithGuardrails({
        providerId,
        vehicleId: newRouteVehicleId,
        startLocation: {
          location_id: newRouteStart.location_id,
          latitude: newRouteStart.latitude,
          longitude: newRouteStart.longitude,
          street_address: newRouteStart.street_address,
        },
        endLocation: {
          location_id: newRouteEnd.location_id,
          latitude: newRouteEnd.latitude,
          longitude: newRouteEnd.longitude,
          street_address: newRouteEnd.street_address,
        },
        departureDateObj: combined,
        endTimeObj,
        routeFrequency: newRouteFrequency,
      });

      Alert.alert(
        'Route Posted Successfully!',
        res.adminReviewFlag
          ? `Route distance is ${res.distanceKm} km. Flagged for Admin coverage review (>25 km).`
          : `Route corridor active (${res.distanceKm} km). Scanning for forward matches...`,
      );

      setAddRouteModalVisible(false);

      if (res.route) {
        const vehicleObj = newRouteVehicles.find(v => v.vehicle_id === newRouteVehicleId) || null;
        const optimisticRoute: Route = {
          ...res.route,
          start_location: newRouteStart,
          end_location: newRouteEnd,
          vehicle: vehicleObj as any,
        };

        setRoutes(prev => (prev.some(r => r.route_id === optimisticRoute.route_id) ? prev : [optimisticRoute, ...prev]));
        routesRef.current = routesRef.current.some(r => r.route_id === optimisticRoute.route_id)
          ? routesRef.current
          : [optimisticRoute, ...routesRef.current];

        setActiveRoute(optimisticRoute);
        activeRouteRef.current = optimisticRoute;
        await setActiveRouteId(optimisticRoute.route_id);
      }

      const { resolvedRoute } = await fetchRoutes(providerId);
      await refreshMatches(providerId, resolvedRoute, true);
    } catch (err: any) {
      console.error('handleAddRouteSubmit error:', err);
      Alert.alert('Guardrail Check', err?.message || 'Failed to save route.');
    } finally {
      setNewRouteSubmitting(false);
    }
  };

  const toggleOnlineStatus = async (online: boolean) => {
    const pid = providerId || (await getProviderData());
    if (!pid) { Alert.alert('Error', 'Provider account details could not be loaded.'); return; }

    if (online) {
      let currentRoute = activeRoute && !isRouteExpired(activeRoute) ? activeRoute : null;
      if (!currentRoute) {
        if (routes.length > 0) {
          currentRoute = routes[0];
          setActiveRoute(currentRoute);
          activeRouteRef.current = currentRoute;
          await setActiveRouteId(currentRoute.route_id);
        } else {
          await openAddRouteModal();
          Alert.alert('Post a Route First', 'Pack-N-Ship requires an active route before going online.');
          return;
        }
      }

      await supabase.from('users').update({ is_online: true }).eq('user_id', pid);
      setIsOnline(true);
      await refreshMatches(pid, currentRoute, true);
    } else {
      Alert.alert('Go Offline', 'Going offline will pause new corridor matching.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go Offline', style: 'destructive', onPress: async () => {
            await supabase.from('users').update({ is_online: false }).eq('user_id', pid);
            setIsOnline(false);
            setRequests(prev => prev.filter(r => r.isDirectRequest));
          },
        },
      ]);
    }
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let sub: Location.LocationSubscription | null = null;
      const toLoc = (p: Location.LocationObject) => ({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        heading: p.coords.heading != null && p.coords.heading >= 0 ? p.coords.heading : null,
      });
      const lastSet = { lat: 0, lng: 0 };
      const accept = (loc: { lat: number; lng: number; heading: number | null }) => {
        if (Math.abs(loc.lat - lastSet.lat) < 0.00012 && Math.abs(loc.lng - lastSet.lng) < 0.00012) return;   // ~13 m
        lastSet.lat = loc.lat; lastSet.lng = loc.lng;
        setMyLoc(loc);
      };
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') { if (!cancelled) setLocDenied(true); return; }
          if (!cancelled) setLocDenied(false);
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled) accept(toLoc(last));
          const watcher = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 20 },
            (p) => { if (!cancelled) accept(toLoc(p)); },
          );
          if (cancelled) watcher.remove(); else sub = watcher;
        } catch (e) { console.warn('Location error:', e); }
      })();
      return () => { cancelled = true; sub?.remove(); };
    }, []),
  );

  const decliningRef = useRef<Set<number>>(new Set());

  const persistDismissed = (pid: number) => {
    const obj: Record<string, number> = {};
    dismissedRef.current.forEach((ts, id) => { obj[String(id)] = ts; });
    AsyncStorage.setItem(`${DISMISSED_KEY}:${pid}`, JSON.stringify(obj)).catch(() => {});
  };

  // Works for every request: a direct request is released back to the sender, a normal route match is simply dropped for me.
  const declineRequest = async (req: JobRequest) => {
    const pid = providerIdRef.current ?? providerId;
    if (!pid || decliningRef.current.has(req.request_id)) return;
    decliningRef.current.add(req.request_id);

    // remove it from the screen right away so the list feels live
    const id = Number(req.request_id);
    dismissedRef.current.set(id, Date.now());
    setAwaiting(prev => prev.filter(r => Number(r.request_id) !== id));
    setRequests(prev => prev.filter(r => Number(r.request_id) !== id));
    setLapsedIds(prev => prev.filter(x => x !== id));
    if (detailRequestId === id) setDetailRequestId(null);

    try {
      const res = req.isDirectRequest
        ? await declineDirectRequestService(id, pid)
        : await declineMatchedRequestService(id, pid);
      if (!res.ok) {
        dismissedRef.current.delete(id);
        Alert.alert('Could not decline', res.message);
      } else {
        persistDismissed(pid);
      }
    } catch (e: any) {
      dismissedRef.current.delete(id);
      Alert.alert('Could not decline', e?.message || 'Please try again.');
    } finally {
      decliningRef.current.delete(id);
      void refreshMatches(providerIdRef.current, activeRouteRef.current, false, true);
    }
  };

  const confirmDecline = (req: JobRequest) => {
    Alert.alert(
      'Decline this request?',
      req.isDirectRequest
        ? "The sender will be told, and we'll look for another courier for them."
        : 'It will be removed from your list. Other providers on the route can still accept it.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => { void declineRequest(req); } },
      ],
    );
  };

  const triggerSOS = () => {
    Alert.alert('Emergency', 'Do you need emergency help? You can call the national emergency hotline now.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
    ]);
  };

  const doAccept = async (req: JobRequest) => {
    if (!providerId) return;
    setAccepting(true);
    try {
      let vehicleId: number | null =
        activeRoute?.vehicle?.verification_status === 'Verified' ? activeRoute.vehicle.vehicle_id : null;
      if (!vehicleId) {
        const { data: v } = await supabase
          .from('vehicles')
          .select('vehicle_id')
          .eq('provider_id', providerId)
          .eq('verification_status', 'Verified')
          .limit(1)
          .maybeSingle();
        vehicleId = v?.vehicle_id ?? null;
      }
      if (!vehicleId) {
        const { data: anyVeh } = await supabase
          .from('vehicles')
          .select('vehicle_id')
          .eq('provider_id', providerId)
          .limit(1)
          .maybeSingle();
        vehicleId = anyVeh?.vehicle_id ?? null;
      }
      if (!vehicleId) {
        Alert.alert('Vehicle not verified', 'You need a verified vehicle before you can accept deliveries.');
        return;
      }

      let resolvedRouteId: number | null =
        req.preferred_route_id ?? activeRoute?.route_id ?? routes[0]?.route_id ?? null;
      if (!resolvedRouteId) {
        const { data: rRow } = await supabase
          .from('provider_routes')
          .select('route_id')
          .eq('provider_id', providerId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedRouteId = rRow?.route_id ?? null;
      }

      let claimed: { request_id: number; sender_id: number; estimated_cost: number } | null = null;
      let claimErr: { message: string } | null = null;

      const rpcRes = await supabase.rpc('claim_delivery_request', { p_request_id: req.request_id });
      if (!rpcRes.error) {
        const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
        claimed = row ?? null;
      } else {
        const direct = await supabase
          .from('delivery_requests')
          .update({ delivery_status: 'Accepted' })
          .eq('request_id', req.request_id)
          .eq('delivery_status', 'Pending')
          .select('request_id, sender_id, estimated_cost')
          .maybeSingle();
        claimed = (direct.data as any) ?? null;
        claimErr = direct.error;
      }

      if (claimErr) {
        Alert.alert('Could not accept request', `Please try again. (${claimErr.message})`);
        void refreshMatches(providerIdRef.current, activeRouteRef.current, false);
        return;
      }

      if (!claimed) {
        const [existingRes, stillRes] = await Promise.all([
          supabase.from('deliveries').select('delivery_id, provider_id').eq('request_id', req.request_id).limit(1),
          supabase.from('delivery_requests').select('delivery_status, preferred_provider_id').eq('request_id', req.request_id).maybeSingle(),
        ]);
        const existing = existingRes.data;
        const still = stillRes.data;

        if (existingRes.error || stillRes.error) {
          Alert.alert('Could not verify request', `We couldn't check this request's status. Please try again.`);
        } else if (existing && existing.length > 0) {
          if (Number(existing[0].provider_id) === Number(providerId)) {
            setDetailRequestId(null);
            void refreshMatches(providerIdRef.current, activeRouteRef.current, false);
            goToTasks();
            return;
          }
          Alert.alert('Request unavailable', 'This request was already accepted by another provider.');
        } else if (!still) {
          Alert.alert('Request unavailable', 'The sender cancelled or removed this request.');
        } else if (still.delivery_status === 'Pending') {
          Alert.alert('Could not accept request', 'Server refused the update. Please contact support.');
        } else {
          Alert.alert('Request unavailable', `This request is now "${still.delivery_status}".`);
        }
        void refreshMatches(providerIdRef.current, activeRouteRef.current, false);
        return;
      }

      const { data: delivery, error: deliveryError } = await supabase.from('deliveries').insert({
        request_id: req.request_id,
        provider_id: providerId,
        vehicle_id: vehicleId,
        route_id: resolvedRouteId,
        accepted_at: new Date().toISOString(),
        estimated_eta: new Date(Date.now() + 3600000).toISOString(),
      }).select('*').single();
      if (deliveryError) {
        await supabase.from('delivery_requests').update({ delivery_status: 'Pending' }).eq('request_id', req.request_id);
        throw deliveryError;
      }

      const { error: qrError } = await supabase.from('qr_verifications').insert({
        delivery_id: delivery.delivery_id,
        pickup_qr: `PU-${randToken(14)}-${delivery.delivery_id}`,
        dropoff_qr: `DO-${randToken(14)}-${delivery.delivery_id}`,
        pickup_pin: randPin(),
        dropoff_pin: randPin(),
      });
      if (qrError) {
        await supabase.from('deliveries').delete().eq('delivery_id', delivery.delivery_id);
        await supabase.from('delivery_requests').update({ delivery_status: 'Pending' }).eq('request_id', req.request_id);
        throw qrError;
      }

      await Promise.all([
        supabase
          .from('route_request_matches')
          .update({ status: 'accepted' })
          .eq('request_id', req.request_id)
          .eq('provider_id', providerId),
        supabase
          .from('route_request_matches')
          .update({ status: 'expired' })
          .eq('request_id', req.request_id)
          .neq('provider_id', providerId)
          .eq('status', 'matched'),
      ]);

      const capacityRoute = routes.find(r => r.route_id === resolvedRouteId) ?? activeRoute;
      if (capacityRoute) {
        const cargoWeight = req.weightKg || 5;
        const cargoVol = computeCargoVolumeLiters(req.items);
        const newWeight = Math.max(0, Number(capacityRoute.remaining_weight_kg ?? 100) - cargoWeight);
        const newVol = Math.max(0, Number(capacityRoute.remaining_volume_liters ?? 300) - cargoVol);
        await supabase
          .from('provider_routes')
          .update({
            remaining_weight_kg: newWeight,
            remaining_volume_liters: newVol,
            ...(req.isFallback ? { fallback_used: true } : {}),
          })
          .eq('route_id', capacityRoute.route_id);
      }

      const { data: requestData } = await supabase
        .from('delivery_requests')
        .select('estimated_cost, sender_id')
        .eq('request_id', req.request_id)
        .single();
      if (requestData) {
        await supabase.from('escrow_payments').insert({
          amount: requestData.estimated_cost,
          delivery_id: delivery.delivery_id,
          sender_id: requestData.sender_id,
          provider_id: providerId,
          escrow_status: 'On hold',
          emergency_frozen: false,
          created_at: new Date().toISOString(),
        });

        if (requestData.sender_id) {
          const code = requestCode(req.request_id);
          try {
            await notifyUser(
              requestData.sender_id,
              'Route-Matched Courier Accepted! 🚚',
              `Your courier accepted parcel #${code} along the declared route.`,
              { deliveryId: delivery.delivery_id },
            );
          } catch { /* ignore */ }
        }
      }

      setDetailRequestId(null);
      void refreshMatches(providerIdRef.current, activeRouteRef.current, false);
      goToTasks();
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to accept delivery.');
    } finally { setAccepting(false); }
  };

  const acceptRequest = (req: JobRequest) => {
    if (accepting) return;
    if (!providerId) { Alert.alert('Please wait', 'Your provider account is still loading.'); return; }
    Alert.alert(
      'Accept this route match?',
      `You will earn ${money(req.estimated_cost)} for delivering from ${req.pickup.main} to ${req.dropoff.main}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept Along Route', onPress: () => doAccept(req) },
      ],
    );
  };

  const markFailed = (uri: string) => setFailedPhotos(prev => ({ ...prev, [uri]: true }));

  const distancesFor = (o: JobRequest) => {
    const me = myLoc;
    const toPickupKm = me && o.pickup.lat != null && o.pickup.lng != null
      ? roadKm(me.lat, me.lng, o.pickup.lat, o.pickup.lng) : null;
    const tripKm = o.pickup.lat != null && o.pickup.lng != null && o.dropoff.lat != null && o.dropoff.lng != null
      ? roadKm(o.pickup.lat, o.pickup.lng, o.dropoff.lat, o.dropoff.lng) : null;
    const etaMin = toPickupKm != null ? Math.max(1, Math.round((toPickupKm / 25) * 60)) : null;
    return { toPickupKm, tripKm, etaMin };
  };

  const renderServicePill = (r: JobRequest) => (
    <View style={styles.svcPill}>
      <SolarIcon name="Package" variant="duotone" size={12} color={colors.info} />
      <Text style={styles.svcPillText}>{serviceLabel(r.pickup_type)}</Text>
    </View>
  );

  const renderRingRoute = (r: JobRequest, notes = false) => (
    <View>
      {[
        { key: 'p', label: 'PICKUP', pt: r.pickup, note: r.pickupNote, kind: 'pickup' as const },
        { key: 'd', label: 'DROP-OFF', pt: r.dropoff, note: r.dropoffNote, kind: 'dropoff' as const },
      ].map((x, i) => (
        <View key={x.key} style={styles.rtRow}>
          <View style={styles.rtRail}>
            {x.kind === 'pickup' ? (
              <View style={styles.rtPickPin}><SolarIcon name="Package" variant="bold" size={15} color="#FFFFFF" /></View>
            ) : (
              <View style={styles.rtDropPin}><SolarIcon name="User" variant="bold" size={15} color="#000000" /></View>
            )}
            {i === 0 && <View style={styles.rtLine} />}
          </View>
          <View style={[styles.rtText, i === 0 && { paddingBottom: 12 }]}>
            <Text style={styles.rtLabel}>{x.label}</Text>
            <Text style={styles.rtMain} numberOfLines={1}>{x.pt.main}</Text>
            {!!x.pt.sub && (
              <View style={styles.rtStreetRow}>
                <SolarIcon name="MapPoint" variant="linear" size={12} color={colors.textMuted} />
                <Text style={styles.rtSub} numberOfLines={2}>{x.pt.sub}</Text>
              </View>
            )}
            {notes && !!x.note && (
              <View style={styles.routeNote}>
                <SolarIcon name="ChatCircleText" variant="duotone" size={13} color={colors.accent} />
                <Text style={styles.routeNoteText}>{x.note}</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderPeople = (r: JobRequest) => (
    <View style={styles.mcRow}>
      {[
        { role: 'SENDER', name: r.senderName || 'Sender', color: colors.info },
        { role: 'RECEIVER', name: r.receiverName || 'Receiver', color: colors.secondary },
      ].map(p => (
        <View key={p.role} style={styles.mcCard}>
          <View style={[styles.mcAvatar, { backgroundColor: p.color }]}>
            <Text style={styles.mcAvatarText}>{(p.name.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mcRole}>{p.role}</Text>
            <Text style={styles.mcName} numberOfLines={1}>{p.name}</Text>
          </View>
        </View>
      ))}
    </View>
  );

  const renderFullDetails = () => {
    const o = detailRequestId != null
      ? (awaiting.find(r => r.request_id === detailRequestId) ?? requests.find(r => r.request_id === detailRequestId))
      : null;
    if (!o) return null;

    const photos = o.items.filter(i => i.photo && !failedPhotos[i.photo!]).map(i => i.photo!);
    const localOnly = o.items.some(i => i.localOnly && !i.photo);
    const cap = activeRoute?.vehicle?.max_weight_kg;
    const capVol = activeRoute?.vehicle?.max_volume_liters;
    const fitsWeight = o.weightKg != null && cap ? o.weightKg <= cap : null;
    const fitsVol = capVol ? o.volumeL <= capVol : null;
    const fits = fitsWeight === null && fitsVol === null ? null : fitsWeight !== false && fitsVol !== false;
    const capText = [cap ? `${cap} kg` : null, capVol ? `${Math.round(capVol)} L` : null].filter(Boolean).join(' · ');
    const exceedsText = [fitsWeight === false ? 'weight' : null, fitsVol === false ? 'volume' : null].filter(Boolean).join(' & ');
    const hasNotes = !!o.pickupNote || !!o.dropoffNote;
    const { toPickupKm, tripKm, etaMin } = distancesFor(o);

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 12, paddingTop: insets.top + 6, paddingBottom: 12,
            backgroundColor: colors.card,
            borderBottomWidth: 1, borderBottomColor: colors.divider,
          }}
        >
          <TouchableOpacity
            onPress={() => setDetailRequestId(null)}
            style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.7}
          >
            <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.dCode}>{requestCode(o.request_id)}</Text>
            <Text style={styles.dWhen}>{whenLabel(o)}</Text>
          </View>
          <View style={{ width: 42 }} />
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.oTopRow}>
              {renderServicePill(o)}
              {o.matchScore != null && (
                <View style={styles.scoreBadge}>
                  <SolarIcon name="CheckCircle" variant="linear" size={13} color={colors.success} />
                  <Text style={[styles.scoreBadgeText, { color: colors.success }]}>{Math.round(o.matchScore)}% Match</Text>
                </View>
              )}
              {o.isFallback && (
                <View style={styles.fallbackBadge}>
                  <SolarIcon name="Routing" variant="linear" size={12} color="#FFFFFF" />
                  <Text style={styles.fallbackBadgeText}>FALLBACK ({o.fallbackType === 'CONDITION_A' ? 'ADD-ON' : '1H BACKUP'})</Text>
                </View>
              )}
            </View>
            {renderRingRoute(o, true)}
          </View>

          <View style={styles.earnCard}>
            <Text style={styles.earnLabel}>YOU EARN</Text>
            <Text style={styles.earnValue}>{money(o.estimated_cost)}</Text>
            <View style={styles.earnNote}>
              <SolarIcon name="ShieldCheck" variant="duotone" size={15} color="#FFFFFF" />
              <Text style={styles.earnNoteText}>
                Held in escrow once accepted, released to your wallet when delivery is verified.
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <SolarIcon name="Routing" variant="duotone" size={15} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>Corridor &amp; Trip Summary</Text>
            </View>
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>TO PICKUP</Text>
                <Text style={styles.tileValue}>
                  {toPickupKm != null ? `${toPickupKm.toFixed(1)} km${etaMin != null ? ` · ${etaMin} min` : ''}` : '—'}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>TRIP</Text>
                <Text style={styles.tileValue}>{tripKm != null ? `${tripKm.toFixed(1)} km` : '—'}</Text>
              </View>
              {o.pickupDistM != null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>PICKUP FROM ROUTE</Text>
                  <Text style={styles.tileValue}>{Math.round(o.pickupDistM)} m</Text>
                </View>
              )}
              {o.dropoffDistM != null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>DROPOFF FROM ROUTE</Text>
                  <Text style={styles.tileValue}>{Math.round(o.dropoffDistM)} m</Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <SolarIcon name="Gallery" variant="duotone" size={15} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>Package Photos</Text>
            </View>
            {photos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {photos.map((uri, idx) => (
                  <TouchableOpacity key={`${uri}-${idx}`} activeOpacity={0.9} onPress={() => setPreviewPhoto(uri)}>
                    <Image source={{ uri }} style={styles.dPhoto} resizeMode="cover" onError={() => markFailed(uri)} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.offerNoPhoto}>
                <SolarIcon name="Gallery" variant="linear" size={18} color={colors.warning} />
                <Text style={styles.offerNoPhotoText}>
                  {localOnly ? "The sender's photo wasn't uploaded." : "The sender didn't add a photo."}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <SolarIcon name="Package" variant="duotone" size={15} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>Package Details</Text>
            </View>
            {o.items.some(i => !!i.description) && (
              <View style={{ gap: 4, marginBottom: 10 }}>
                {o.items.map((it, i) =>
                  !!it.description ? (
                    <Text key={i} style={styles.dItemText} numberOfLines={2}>
                      {o.items.length > 1 ? `${i + 1}. ` : ''}
                      {it.description}
                      {it.boxes ? `  ·  ${it.boxes}` : ''}
                      {it.size ? `  ·  ${it.size}` : ''}
                    </Text>
                  ) : null,
                )}
              </View>
            )}
            <View style={styles.tileGrid}>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>CARGO SIZE</Text>
                <Text style={styles.tileValue} numberOfLines={2}>
                  {o.sizeSummary || `${o.totalItems} ${o.totalItems === 1 ? 'item' : 'items'}`}
                </Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>WEIGHT</Text>
                <Text style={styles.tileValue}>{o.weightKg != null ? `${o.weightKg} kg` : '—'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>VOLUME</Text>
                <Text style={styles.tileValue}>{o.volumeL > 0 ? `${o.volumeL} L` : '—'}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileLabel}>HANDLING</Text>
                <Text style={[styles.tileValue, o.fragile && { color: colors.accent }]}>
                  {o.fragile ? 'Fragile' : 'Standard'}
                </Text>
              </View>
              {fits !== null && (
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>VEHICLE CAPACITY</Text>
                  <Text style={[styles.tileValue, { color: fits ? colors.success : colors.error }]} numberOfLines={2}>
                    {fits ? `Fits (${capText} max)` : `Exceeds ${exceedsText} (max ${capText})`}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {hasNotes && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderIcon}>
                  <SolarIcon name="ChatCircleText" variant="duotone" size={15} color={colors.accent} />
                </View>
                <Text style={styles.cardTitle}>Notes</Text>
              </View>
              {!!o.pickupNote && (
                <View style={[styles.routeNote, { marginBottom: 6 }]}>
                  <SolarIcon name="ChatCircleText" variant="duotone" size={13} color={colors.accent} />
                  <Text style={styles.routeNoteText}>Pickup: {o.pickupNote}</Text>
                </View>
              )}
              {!!o.dropoffNote && (
                <View style={styles.routeNote}>
                  <SolarIcon name="ChatCircleText" variant="duotone" size={13} color={colors.accent} />
                  <Text style={styles.routeNoteText}>Drop-off: {o.dropoffNote}</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}>
                <SolarIcon name="User" variant="linear" size={15} color={colors.accent} />
              </View>
              <Text style={styles.cardTitle}>People</Text>
            </View>
            {renderPeople(o)}
            <Text style={styles.privacyNote}>Contact details are shared once you accept the delivery.</Text>
          </View>
        </ScrollView>

        <View style={[styles.acceptBar, { paddingBottom: Math.max(16, insets.bottom) }]}>
          <View>
            <Text style={styles.eyebrow}>YOU EARN</Text>
            <Text style={styles.acceptPrice}>{money(o.estimated_cost)}</Text>
          </View>
          <View style={styles.detailActions}>
            <TouchableOpacity
              style={styles.detailDeclineBtn}
              onPress={() => confirmDecline(o)}
              disabled={accepting}
              activeOpacity={0.85}
            >
              <Text style={styles.declineText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptBtn, { flex: 1, minWidth: 0 }, accepting && { opacity: 0.7 }]}
              onPress={() => acceptRequest(o)}
              disabled={accepting}
              activeOpacity={0.9}
            >
              {accepting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <SolarIcon name="CheckCircle" variant="linear" size={18} color="#FFFFFF" />
                  <Text style={styles.acceptBtnText} numberOfLines={1}>Accept</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderTag = (label: string, color: string, bg: string) => (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );

  const renderRequestCard = (r: JobRequest) => {
    const lapsed = lapsedIds.includes(r.request_id);
    return (
      <View key={r.request_id} style={styles.reqCard}>
        <View style={styles.reqTop}>
          <View style={styles.reqTags}>
            {renderServicePill(r)}
            {r.matchScore != null && renderTag(`${Math.round(r.matchScore)}% MATCH`, colors.success, 'rgba(34,197,94,0.12)')}
            {r.isDirectRequest && renderTag('DIRECT', colors.accent, colors.accentSoft)}
            {lapsed && renderTag('BACKUP', colors.warning, 'rgba(245,158,11,0.12)')}
          </View>
          <Text style={styles.reqPrice}>{money(r.estimated_cost)}</Text>
        </View>

        <View style={{ marginTop: 14 }}>{renderRingRoute(r)}</View>

        <View style={styles.reqActions}>
          <TouchableOpacity style={styles.declineBtn} onPress={() => confirmDecline(r)} disabled={accepting} activeOpacity={0.85}>
            <Text style={styles.declineText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.detailsBtn} onPress={() => setDetailRequestId(r.request_id)} activeOpacity={0.85}>
            <Text style={styles.detailsText}>Details</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptBtnPill, accepting && { opacity: 0.6 }]}
            onPress={() => acceptRequest(r)}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.acceptPillText}>Accept</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderSheetHeader = () => {
    const start = describePlace(activeRoute?.start_location);
    const end = describePlace(activeRoute?.end_location);
    const rDate = activeRoute ? parseNaiveIsoString(activeRoute.departure_time) : null;
    const timeStr = rDate ? rDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    return (
      <View style={styles.sheetHeader}>
        <View style={[styles.statusBanner, isOnline && styles.statusBannerOnline]}>
          <OnlinePulseDot online={isOnline} color={colors.success} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.statusTitle} numberOfLines={1}>{isOnline ? 'You are online' : 'You are offline'}</Text>
            <Text style={styles.statusSub} numberOfLines={1}>
              {isOnline
                ? (checkingMatches ? 'Scanning your route…' : `${awaiting.length} matched request${awaiting.length === 1 ? '' : 's'}`)
                : 'Go online to receive requests'}
            </Text>
          </View>
          <TouchableOpacity
            style={isOnline ? styles.offlineBtn : styles.onlineBtn}
            onPress={() => toggleOnlineStatus(!isOnline)}
            activeOpacity={0.85}
          >
            <Text style={isOnline ? styles.offlineBtnText : styles.onlineBtnText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sheetTitleRow}>
          <Text style={styles.sheetTitle}>Awaiting Acceptance</Text>
          <View style={styles.countBadge}><Text style={styles.countBadgeText}>{awaiting.length}</Text></View>
          <View style={{ flex: 1 }} />
          {checkingMatches && <ActivityIndicator size="small" color={colors.accent} />}
        </View>

        {activeRoute ? (
          <TouchableOpacity style={styles.routeRow} onPress={() => setRoutePickerVisible(true)} activeOpacity={0.85}>
            <View style={styles.routeRowIcon}>
              <SolarIcon name="Routing" variant="bold" size={16} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {/* From / To on their own lines so long street names never push the capacity off screen */}
              <View style={styles.routeStopRow}>
                <View style={[styles.routeStopDot, { backgroundColor: BRAND_ORANGE }]} />
                <Text style={styles.routeStopText} numberOfLines={1}>{start.main}</Text>
              </View>
              <View style={styles.routeStopRow}>
                <View style={[styles.routeStopDot, { backgroundColor: colors.textPrimary }]} />
                <Text style={styles.routeStopText} numberOfLines={1}>{end.main}</Text>
              </View>
              {/* Chips wrap to a second line when the screen is narrow, so kg and L are always fully visible */}
              <View style={styles.routeMetaWrap}>
                <View style={styles.routeChip}>
                  <Text style={styles.routeChipText}>{activeRoute.route_frequency}{timeStr ? ` · ${timeStr}` : ''}</Text>
                </View>
                <View style={styles.routeChip}>
                  <Text style={styles.routeChipText}>{Number(activeRoute.remaining_weight_kg ?? 100).toFixed(0)} kg left</Text>
                </View>
                <View style={styles.routeChip}>
                  <Text style={styles.routeChipText}>{Number(activeRoute.remaining_volume_liters ?? 300).toFixed(0)} L left</Text>
                </View>
              </View>
            </View>
            <View style={styles.changePill}>
              <Text style={styles.changePillText}>Change</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.routeRow} onPress={openAddRouteModal} activeOpacity={0.85}>
            <View style={styles.routeRowIcon}>
              <SolarIcon name="AddCircle" variant="bold" size={16} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.routeRowTitle}>No route posted yet</Text>
              <Text style={styles.routeRowSub} numberOfLines={1}>Post a route to match with sender packages.</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderMain = () => {
    const fallback = {
      lat: activeRoute?.start_location?.latitude ?? DEFAULT_CENTER.latitude,
      lng: activeRoute?.start_location?.longitude ?? DEFAULT_CENTER.longitude,
      heading: null as number | null,
    };
    const loc = myLoc ?? fallback;
    const sLoc = activeRoute?.start_location;
    const eLoc = activeRoute?.end_location;
    const sAddr = describePlace(sLoc);
    const eAddr = describePlace(eLoc);

    const mapRoute = sLoc?.latitude != null && sLoc?.longitude != null && eLoc?.latitude != null && eLoc?.longitude != null
      ? {
          start: { lat: sLoc.latitude, lng: sLoc.longitude, title: sAddr.main, sub: sAddr.sub },
          end: { lat: eLoc.latitude, lng: eLoc.longitude, title: eAddr.main, sub: eAddr.sub },
        }
      : null;

    // top controls fade out while the sheet is pulled up
    const topOpacity = sheetY.interpolate({ inputRange: [collapsedY * 0.5, collapsedY], outputRange: [0, 1], extrapolate: 'clamp' });

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <ProviderMap
          provider={loc}
          route={mapRoute}
          online={isOnline}
          recenterTick={recenterTick}
          padBottom={sheetHeight + 24}
        />

        <Animated.View
          style={[styles.topOverlayWrap, { top: insets.top + 10, opacity: topOpacity }]}
          pointerEvents={sheetOpen ? 'none' : 'box-none'}
        >
          {/* Back button (offline only); the online status now lives in the bottom sheet so the map stays clear */}
          {!isOnline && (
            <View style={styles.topRow} pointerEvents="box-none">
              <TouchableOpacity onPress={goToTasks} style={styles.floatingBackBtn} activeOpacity={0.85}>
                <SolarIcon name="ArrowLeft" variant="linear" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Map tools */}
          <View style={styles.sideToolsCol} pointerEvents="box-none">
            <TouchableOpacity style={styles.mapToolBtn} onPress={handleOpenNotifs} activeOpacity={0.85}>
              <SolarIcon name="Bell" variant="duotone" size={20} color={BRAND_ORANGE} />
              {unreadCount > 0 && (
                <View style={styles.mapToolBadge}>
                  {unreadCount <= 9 && <Text style={styles.mapToolBadgeText}>{unreadCount}</Text>}
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.mapToolBtn} onPress={goToManageRoutes} activeOpacity={0.85}>
              <SolarIcon name="Settings" variant="duotone" size={20} color={colors.info} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.mapToolBtn} onPress={() => setRecenterTick(t => t + 1)} activeOpacity={0.85}>
              <SolarIcon name="Compass" variant="duotone" size={20} color={colors.textPrimary} />
            </TouchableOpacity>

            {isOnline && (
              <TouchableOpacity style={[styles.mapToolBtn, styles.sosToolBtn]} onPress={triggerSOS} activeOpacity={0.85}>
                <SolarIcon name="ShieldCheck" variant="bold" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>

          {locDenied && (
            <TouchableOpacity style={styles.locWarn} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
              <SolarIcon name="MapPoint" variant="linear" size={15} color={colors.warning} />
              <Text style={styles.locWarnText}>Location is off. Tap to enable.</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        <DraggableSheet
          ref={sheetRef}
          y={sheetY}
          collapsedY={collapsedY}
          height={expandedH}
          contentPaddingBottom={insets.bottom + 24}
          style={styles.sheet}
          handleHitAreaStyle={styles.grabberWrap}
          handleStyle={styles.grabber}
          onOpenChange={setSheetOpen}
          header={renderSheetHeader()}
        >
          {awaiting.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Image source={EMPTY_COMPASS_ICON} style={{ width: 64, height: 64 }} resizeMode="contain" />
              <Text style={styles.emptyTitle}>Nothing awaiting acceptance</Text>
              <Text style={styles.emptySub}>
                Sender requests that match your selected route appear here until you or another provider accepts them.
              </Text>
            </View>
          ) : (
            awaiting.map(renderRequestCard)
          )}
        </DraggableSheet>
      </View>
    );
  };

  const renderNotifModal = () => (
    <Modal visible={notifModalOpen} transparent animationType="fade" onRequestClose={() => setNotifModalOpen(false)}>
      <Pressable style={styles.notifBackdrop} onPress={() => setNotifModalOpen(false)}>
        <Pressable style={[styles.notifCard, { marginTop: insets.top + 60 }]} onPress={() => {}}>
          <View style={styles.notifHeader}>
            <Text style={styles.notifHeaderTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setNotifModalOpen(false)} hitSlop={10}>
              <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {notifLoading ? (
            <View style={styles.notifCenter}><ActivityIndicator size="small" color={colors.accent} /></View>
          ) : notifs.length === 0 ? (
            <View style={styles.notifCenter}>
              <SolarIcon name="Bell" variant="linear" size={40} color={colors.textMuted} />
              <Text style={styles.notifEmptyText}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={notifs.slice(0, 8)}
              keyExtractor={(i) => String(i.notif_id)}
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.notifRow, !item.is_read && styles.notifRowUnread]} onPress={() => handleNotifPress(item)} activeOpacity={0.85}>
                  <View style={styles.notifIconBox}>
                    <SolarIcon name={iconForNotif(item)} variant="duotone" size={18} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.notifTitleRow}>
                      <Text style={styles.notifTitle} numberOfLines={1}>{titleForNotif(item)}</Text>
                      {!item.is_read && <View style={styles.notifDot} />}
                    </View>
                    <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                  </View>
                  <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.notifFooter} onPress={() => { setNotifModalOpen(false); setFullListOpen(true); }} activeOpacity={0.85}>
            <Text style={styles.notifFooterText}>See all in Notifications</Text>
            <SolarIcon name="AltArrowRight" variant="bold" size={16} color={colors.accent} />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderFullListModal = () => (
    <Modal visible={fullListOpen} animationType="slide" onRequestClose={() => setFullListOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
          backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.divider,
        }}>
          <TouchableOpacity onPress={() => setFullListOpen(false)} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }} activeOpacity={0.7} hitSlop={10}>
            <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontFamily: 'Poppins_700Bold', color: colors.textPrimary, letterSpacing: -0.3 }}>
            Notifications
          </Text>
          <View style={{ width: 42 }} />
        </View>
        <View style={{ flex: 1 }}>
          <NotificationsList embedded role="provider" />
        </View>
      </View>
    </Modal>
  );

  const renderAddRouteModal = () => (
    <Modal
      visible={addRouteModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (routeLocationPickerVisible) setRouteLocationPickerVisible(false);
        else setAddRouteModalVisible(false);
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.addRouteSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
          <View style={styles.addRouteHandle} />
          <View style={styles.addRouteHeader}>
            <TouchableOpacity onPress={() => setAddRouteModalVisible(false)} style={styles.addRouteCloseBtn}>
              <SolarIcon name="CloseCircle" variant="linear" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.addRouteTitle}>Post a Route ({usedTodayCount}/3 today)</Text>
            <View style={{ width: 42 }} />
          </View>

          <ScrollView contentContainerStyle={styles.addRouteScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.guardrailNotice}>
              <SolarIcon name="ShieldCheck" variant="duotone" size={16} color={colors.accent} />
              <Text style={styles.guardrailNoticeText}>
                Guardrail: Post ≥2 hrs early for Condition B fallback · Destinations must be ≥3 km apart · Max 4-hr window.
              </Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Route Locations</Text>
              <TouchableOpacity
                style={styles.locationSelectorBtn}
                onPress={() => { setRouteLocationPickerType('start'); setRouteLocationPickerVisible(true); }}
                activeOpacity={0.85}
              >
                <View style={[styles.locSelectorIcon, newRouteStart && { backgroundColor: colors.accent }]}>
                  <SolarIcon name="MapPoint" variant="linear" size={14} color="#FFF" />
                </View>
                <Text style={styles.locationSelectorText} numberOfLines={1}>
                  {newRouteStart ? newRouteStart.street_address : 'Set Starting Point'}
                </Text>
              </TouchableOpacity>
              <View style={{ height: 10 }} />
              <TouchableOpacity
                style={styles.locationSelectorBtn}
                onPress={() => { setRouteLocationPickerType('end'); setRouteLocationPickerVisible(true); }}
                activeOpacity={0.85}
              >
                <View style={[styles.locSelectorIcon, newRouteEnd && { backgroundColor: colors.textPrimary }]}>
                  <SolarIcon name="MapPoint" variant="linear" size={14} color="#FFF" />
                </View>
                <Text style={styles.locationSelectorText} numberOfLines={1}>
                  {newRouteEnd ? newRouteEnd.street_address : 'Set Destination (≥3 km apart)'}
                </Text>
              </TouchableOpacity>
            </View>

            {newRouteStart && newRouteEnd && (
              <View style={styles.modalMapContainer}>
                <MapView
                  ref={addRoutePreviewMapRef}
                  style={StyleSheet.absoluteFill}
                  provider={PROVIDER_GOOGLE}
                  userInterfaceStyle="light"
                  initialRegion={{
                    latitude: newRouteStart.latitude,
                    longitude: newRouteStart.longitude,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                  showsCompass={false}
                  toolbarEnabled={false}
                >
                  <Marker coordinate={{ latitude: newRouteStart.latitude, longitude: newRouteStart.longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                    <View style={[styles.mkDot, { backgroundColor: BRAND_ORANGE }]}>
                      <SolarIcon name="MapPoint" variant="bold" size={15} color="#FFFFFF" />
                    </View>
                  </Marker>
                  <Marker coordinate={{ latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                    <View style={[styles.mkDot, { backgroundColor: '#FFFFFF' }]}>
                      <SolarIcon name="Flag" variant="bold" size={15} color="#000000" />
                    </View>
                  </Marker>
                  {newRoutePreviewCoords.length > 0 && (
                    <Polyline coordinates={newRoutePreviewCoords} strokeColor={BRAND_ORANGE} strokeWidth={4} />
                  )}
                </MapView>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Route Frequency</Text>
              <View style={styles.frequencyOptions}>
                {FREQUENCIES.map(freq => (
                  <TouchableOpacity
                    key={freq}
                    style={[styles.frequencyOption, newRouteFrequency === freq && styles.frequencyOptionSelected]}
                    onPress={() => setNewRouteFrequency(freq)}
                  >
                    <Text style={[styles.frequencyOptionText, newRouteFrequency === freq && styles.frequencyOptionTextSelected]}>
                      {freq}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Active Time Window (Max 4 Hours)</Text>
              <View style={styles.frequencyOptions}>
                {[1, 2, 3, 4].map(hr => (
                  <TouchableOpacity
                    key={hr}
                    style={[styles.frequencyOption, newRouteDurationHours === hr && styles.frequencyOptionSelected]}
                    onPress={() => setNewRouteDurationHours(hr)}
                  >
                    <Text style={[styles.frequencyOptionText, newRouteDurationHours === hr && styles.frequencyOptionTextSelected]}>
                      {hr} {hr === 1 ? 'hr' : 'hrs'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {newRouteFrequency === 'Daily' ? (
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Departure Time (Today)</Text>
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                  <SolarIcon name="Clock" variant="linear" size={16} color={colors.accent} />
                  <Text style={styles.dateTimeValue}>
                    {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
                {newRouteShowTimePicker && (
                  <DateTimePicker
                    value={newRouteDepartureTime}
                    mode="time"
                    onChange={(e, t) => {
                      setNewRouteShowTimePicker(Platform.OS === 'ios');
                      if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                    }}
                  />
                )}
              </View>
            ) : newRouteFrequency === 'Weekly' ? (
              <View style={styles.formGroup}>
                <Text style={styles.inputLabel}>Repeats on</Text>
                <View style={styles.weekdayRow}>
                  {WEEKDAY_LABELS.map((label, idx) => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.weekdayChip, newRouteSelectedWeekday === idx && styles.weekdayChipActive]}
                      onPress={() => setNewRouteSelectedWeekday(idx)}
                    >
                      <Text style={[styles.weekdayChipText, newRouteSelectedWeekday === idx && styles.weekdayChipTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ height: 14 }} />
                <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                  <SolarIcon name="Clock" variant="linear" size={16} color={colors.accent} />
                  <Text style={styles.dateTimeValue}>
                    {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
                {newRouteShowTimePicker && (
                  <DateTimePicker
                    value={newRouteDepartureTime}
                    mode="time"
                    onChange={(e, t) => {
                      setNewRouteShowTimePicker(Platform.OS === 'ios');
                      if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                    }}
                  />
                )}
              </View>
            ) : (
              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowDatePicker(true)}>
                    <SolarIcon name="Calendar" variant="linear" size={16} color={colors.accent} />
                    <Text style={styles.dateTimeValue}>{newRouteDepartureDate.toLocaleDateString()}</Text>
                  </TouchableOpacity>
                  {newRouteShowDatePicker && (
                    <DateTimePicker
                      value={newRouteDepartureDate}
                      mode="date"
                      minimumDate={new Date()}
                      onChange={(e, d) => {
                        setNewRouteShowDatePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && d) setNewRouteDepartureDate(d);
                      }}
                    />
                  )}
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Time</Text>
                  <TouchableOpacity style={styles.dateTimeButton} onPress={() => setNewRouteShowTimePicker(true)}>
                    <SolarIcon name="Clock" variant="linear" size={16} color={colors.accent} />
                    <Text style={styles.dateTimeValue}>
                      {newRouteDepartureTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </TouchableOpacity>
                  {newRouteShowTimePicker && (
                    <DateTimePicker
                      value={newRouteDepartureTime}
                      mode="time"
                      onChange={(e, t) => {
                        setNewRouteShowTimePicker(Platform.OS === 'ios');
                        if (e.type === 'set' && t) setNewRouteDepartureTime(t);
                      }}
                    />
                  )}
                </View>
              </View>
            )}

            <View style={styles.formGroup}>
              <Text style={styles.inputLabel}>Vehicle</Text>
              {newRouteVehicles.length === 0 ? (
                <View style={styles.noVehiclesBox}>
                  <SolarIcon name="InfoCircle" variant="linear" size={20} color={colors.warning} />
                  <Text style={styles.noVehiclesText}>
                    No verified vehicles found. Add and verify a vehicle first.
                  </Text>
                </View>
              ) : (
                <View style={styles.vehicleOptions}>
                  {newRouteVehicles.map(v => (
                    <TouchableOpacity
                      key={v.vehicle_id}
                      style={[styles.vehicleOption, newRouteVehicleId === v.vehicle_id && styles.vehicleOptionActive]}
                      onPress={() => setNewRouteVehicleId(v.vehicle_id)}
                    >
                      <SolarIcon
                        name="Package"
                        variant="linear"
                        size={14}
                        color={newRouteVehicleId === v.vehicle_id ? '#FFF' : colors.textSecondary}
                      />
                      <Text style={[styles.vehicleOptionText, newRouteVehicleId === v.vehicle_id && styles.vehicleOptionTextActive]}>
                        {v.plate_number}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, newRouteSubmitting && { opacity: 0.7 }]}
              onPress={handleAddRouteSubmit}
              disabled={newRouteSubmitting}
              activeOpacity={0.9}
            >
              {newRouteSubmitting ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.submitBtnText}>Post Route</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>

        <RouteLocationPickerModal
          asOverlay
          key={routeLocationPickerType}
          visible={routeLocationPickerVisible}
          onClose={() => setRouteLocationPickerVisible(false)}
          onSelect={(loc) => handleNewRouteLocationSelect(loc, routeLocationPickerType)}
          initialCoords={
            routeLocationPickerType === 'start'
              ? (newRouteStart ? { latitude: newRouteStart.latitude, longitude: newRouteStart.longitude } : undefined)
              : (newRouteEnd ? { latitude: newRouteEnd.latitude, longitude: newRouteEnd.longitude } : undefined)
          }
          title={routeLocationPickerType === 'start' ? 'Starting Point' : 'Destination'}
          pinColor={routeLocationPickerType === 'start' ? colors.accent : colors.textPrimary}
        />
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading route matching...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar translucent backgroundColor="transparent" barStyle={colors.statusBarStyle} />

      {detailRequestId != null ? renderFullDetails() : renderMain()}

      {renderNotifModal()}
      {renderFullListModal()}

      <Modal visible={routePickerVisible} transparent animationType="slide" onRequestClose={() => setRoutePickerVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.routePickerSheet}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <Text style={styles.routePickerTitle}>Select Active Route ({usedTodayCount}/3 today)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => { setRoutePickerVisible(false); openAddRouteModal(); }}
                  activeOpacity={0.85}
                  hitSlop={8}
                >
                  <SolarIcon name="Plus" variant="bold" size={20} color="#FFFFFF" />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setRoutePickerVisible(false)} hitSlop={8}>
                  <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            {routes.length === 0 ? (
              <View style={styles.routePickerEmpty}>
                <SolarIcon name="Map" variant="duotone" size={40} color={colors.accent} />
                <Text style={styles.routePickerEmptyTitle}>Post a route to see matched deliveries.</Text>
                <Text style={styles.routePickerEmptySub}>
                  Rule 1: Providers see zero requests until they post a route.
                </Text>
                <TouchableOpacity
                  style={styles.createQuickRouteBtn}
                  onPress={() => { setRoutePickerVisible(false); openAddRouteModal(); }}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="AddCircle" variant="linear" size={16} color="#FFFFFF" />
                  <Text style={styles.createQuickRouteBtnText}>Post a Route</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.emptyManageRouteBtn} onPress={goToManageRoutes} activeOpacity={0.85}>
                  <SolarIcon name="Map" variant="linear" size={16} color={colors.accent} />
                  <Text style={styles.emptyManageRouteText}>Manage Routes</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {routes.map((r) => {
                  const isSelected = activeRoute?.route_id === r.route_id;
                  const rDate = parseNaiveIsoString(r.departure_time);
                  const timeStr = rDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  const scheduleLabel =
                    r.route_frequency === 'Daily'
                      ? `Every day · ${timeStr}`
                      : r.route_frequency === 'Weekly'
                        ? `Every ${WEEKDAY_LABELS[rDate.getDay()]} · ${timeStr}`
                        : `${rDate.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${timeStr}`;

                  const startAddr = splitAddress(r.start_location?.street_address);
                  const endAddr = splitAddress(r.end_location?.street_address);

                  return (
                    <TouchableOpacity
                      key={r.route_id}
                      style={[styles.routeOption, isSelected && styles.routeOptionSelected]}
                      onPress={() => {
                        setRoutePickerVisible(false);
                        if (activeRouteRef.current?.route_id === r.route_id) return;
                        void applyActiveRoute(r, true);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.routeOptionDot, { backgroundColor: isSelected ? colors.accent : colors.textMuted }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeOptionTitle} numberOfLines={1}>
                          {startAddr.main} → {endAddr.main}
                        </Text>
                        <Text style={styles.routeOptionSub} numberOfLines={1}>
                          {scheduleLabel} · {r.route_frequency}
                        </Text>
                      </View>
                      {isSelected && <SolarIcon name="CheckCircle" variant="linear" size={22} color={colors.accent} />}
                    </TouchableOpacity>
                  );
                })}
                <View style={{ height: 30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {renderAddRouteModal()}

      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          {!!previewPhoto && <Image source={{ uri: previewPhoto }} style={styles.previewImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.previewClose, { top: insets.top + 12 }]} onPress={() => setPreviewPhoto(null)} activeOpacity={0.85}>
            <SolarIcon name="CloseCircle" variant="linear" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => {
  const hair = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  return StyleSheet.create({
    topOverlayWrap: { position: 'absolute', left: 16, right: 16, zIndex: 10 },
    floatingBackBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: hair,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
    sideToolsCol: { alignSelf: 'flex-end', marginTop: 12, gap: 10 },
    mapToolBtn: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: hair,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: isDark ? 0.4 : 0.1, shadowRadius: 8, elevation: 4,
  },
    sosToolBtn: {
        backgroundColor: c.error, borderColor: c.error,
      },
    mapToolBadge: {
        position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18,
        borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.error,
        borderWidth: 1.5, borderColor: c.card, justifyContent: 'center', alignItems: 'center',
      },
    mapToolBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_800ExtraBold' },
    locWarnText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.warning },
    svcPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.infoSoft, borderWidth: 1, borderColor: c.info, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
    svcPillText: { fontSize: 11.5, fontFamily: 'Poppins_800ExtraBold', color: c.info },
    oTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
    rtRow: { flexDirection: 'row', gap: 12 },
    rtRail: { alignItems: 'center', width: 30 },
    rtText: { flex: 1 },
    rtLabel: { fontSize: 9.5, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.7 },
    rtMain: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 1 },
    rtSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 1 },
    mcRow: { flexDirection: 'row', gap: 10 },
    mcCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderRadius: 12, borderWidth: 1, borderColor: c.divider, padding: 10 },
    mcAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    mcAvatarText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Poppins_800ExtraBold' },
    mcRole: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.8 },
    mcName: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    dCode: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.5 },
    dWhen: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.accent, marginTop: 2 },
    dPhoto: { width: 92, height: 92, borderRadius: 12, backgroundColor: c.background, borderWidth: 1, borderColor: c.border },
    dItemText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 20 },
    tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 12, padding: 14 },
    tileLabel: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.8 },
    tileValue: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 4 },
    card: {
        backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 14,
        borderWidth: 1, borderColor: hair,
      },
    eyebrow: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.8 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    cardHeaderIcon: {
        width: 26, height: 26, borderRadius: 8, backgroundColor: c.accentSoft,
        alignItems: 'center', justifyContent: 'center',
      },
    cardTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    scoreBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
      },
    scoreBadgeText: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold' },
    fallbackBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: c.secondary, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
      },
    fallbackBadgeText: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF', letterSpacing: 0.4 },
    routeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: c.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
    routeNoteText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.textPrimary, fontFamily: 'Poppins_500Medium' },
    privacyNote: { marginTop: 14, fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted },
    earnCard: { backgroundColor: c.accent, borderRadius: 12, padding: 18, marginBottom: 14 },
    earnLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
    earnValue: { color: '#FFFFFF', fontSize: 32, fontFamily: 'Poppins_800ExtraBold', marginTop: 4 },
    earnNote: {
        flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
        backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 10,
      },
    earnNoteText: { flex: 1, color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_500Medium', lineHeight: 16 },
    acceptBar: {
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: c.card,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 16,
        borderTopWidth: 1, borderTopColor: c.border,
      },
    acceptPrice: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.accent, marginTop: 2 },
    acceptBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        backgroundColor: c.accent, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 14, minWidth: 180,
      },
    acceptBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
    offerNoPhoto: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 8,
        backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
        borderRadius: 12, padding: 12,
      },
    offerNoPhotoText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_500Medium', lineHeight: 17, color: c.warning },
    loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
    loadingText: { color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
    previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
    previewImg: { width: '100%', height: '80%' },
    previewClose: {
        position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
      },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
    routePickerSheet: {
        backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 10,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        maxHeight: '80%',
      },
    routePickerHandle: {
        width: 40, height: 4, borderRadius: 2, backgroundColor: c.border,
        alignSelf: 'center', marginBottom: 14,
      },
    routePickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
    routePickerTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    routePickerEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
    routePickerEmptyTitle: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 8 },
    routePickerEmptySub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', paddingHorizontal: 20, marginBottom: 8 },
    addRouteHeaderBtn: {
        width: 34, height: 34, borderRadius: 17, backgroundColor: c.accent,
        alignItems: 'center', justifyContent: 'center',
      },
    emptyManageRouteBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
        backgroundColor: c.accentSoft, marginTop: 6,
      },
    emptyManageRouteText: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.accent },
    createQuickRouteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.accent, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 10 },
    createQuickRouteBtnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },
    routeOption: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: 12,
        backgroundColor: c.background, borderRadius: 12, marginBottom: 8,
        borderWidth: 1, borderColor: 'transparent',
      },
    routeOptionSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
    routeOptionDot: { width: 10, height: 10, borderRadius: 5 },
    routeOptionTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    routeOptionSub: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 2 },
    weekdayRow: { flexDirection: 'row', gap: 6 },
    weekdayChip: {
        flex: 1, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
        borderColor: c.border, alignItems: 'center', backgroundColor: c.card,
      },
    weekdayChipActive: { backgroundColor: c.accent, borderColor: c.accent },
    weekdayChipText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },
    weekdayChipTextActive: { color: '#FFF' },
    dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
    inputGroup: { flex: 1 },
    inputLabel: { marginBottom: 6, fontFamily: 'Poppins_700Bold', color: c.textPrimary, fontSize: 11, letterSpacing: 0.2 },
    dateTimeButton: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
        borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      },
    dateTimeValue: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    notifBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', paddingHorizontal: 16 },
    notifCard: {
        backgroundColor: c.card, borderRadius: 16,
        paddingTop: 6, paddingBottom: 4, maxHeight: '78%',
        borderWidth: 1, borderColor: hair,
      },
    notifHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: c.divider,
      },
    notifHeaderTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    notifCenter: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
    notifEmptyText: { marginTop: 10, color: c.textMuted, fontSize: 13, fontFamily: 'Poppins_500Medium' },
    notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
    notifRowUnread: { backgroundColor: c.accentSoft },
    notifIconBox: {
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center',
      },
    notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    notifTitle: { flex: 1, fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    notifDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.accent },
    notifBody: { fontSize: 12.5, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 3, lineHeight: 17 },
    notifFooter: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.divider,
      },
    notifFooterText: { color: c.accent, fontFamily: 'Poppins_700Bold', fontSize: 13 },
    addRouteSheet: {
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingTop: 8, maxHeight: '94%', flex: 1,
      },
    addRouteHandle: {
        alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
        backgroundColor: c.border, marginTop: 6, marginBottom: 6,
      },
    addRouteHeader: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: c.divider,
      },
    addRouteCloseBtn: {
        width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider,
        justifyContent: 'center', alignItems: 'center',
      },
    addRouteTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    addRouteScroll: { padding: 20, paddingBottom: 40 },
    guardrailNotice: {
        flexDirection: 'row', alignItems: 'flex-start', gap: 8,
        backgroundColor: c.accentSoft, padding: 12, borderRadius: 12,
        borderWidth: 1, borderColor: c.accent, marginBottom: 16,
      },
    guardrailNoticeText: { flex: 1, fontSize: 11.5, fontFamily: 'Poppins_500Medium', color: c.textPrimary, lineHeight: 17 },
    formGroup: { marginBottom: 20 },
    locationSelectorBtn: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: c.background,
        padding: 14, borderRadius: 12, borderWidth: 1, borderColor: hair, gap: 12,
      },
    locSelectorIcon: {
        width: 26, height: 26, borderRadius: 13, backgroundColor: c.divider,
        justifyContent: 'center', alignItems: 'center',
      },
    locationSelectorText: { flex: 1, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, fontSize: 14 },
    modalMapContainer: {
        height: 160, borderRadius: 12, overflow: 'hidden', marginBottom: 20,
        borderWidth: 1, borderColor: hair,
      },
    frequencyOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    frequencyOption: {
        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
        borderWidth: 1, borderColor: c.border, backgroundColor: c.card,
      },
    frequencyOptionSelected: { backgroundColor: c.accentSoft, borderColor: c.accent },
    frequencyOptionText: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_600SemiBold' },
    frequencyOptionTextSelected: { color: c.accent, fontFamily: 'Poppins_700Bold' },
    vehicleOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    vehicleOption: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: c.background, paddingHorizontal: 14, paddingVertical: 10,
        borderRadius: 999, borderWidth: 1, borderColor: c.border,
      },
    vehicleOptionActive: { backgroundColor: c.accent, borderColor: c.accent },
    vehicleOptionText: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_600SemiBold' },
    vehicleOptionTextActive: { color: '#FFF' },
    noVehiclesBox: {
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
        borderRadius: 12, padding: 12,
      },
    noVehiclesText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.warning },
    submitBtn: {
        backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14,
        alignItems: 'center', marginTop: 6,
      },
    submitBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
    mkDot: {
        width: 30, height: 30, borderRadius: 15,
        borderWidth: 3, borderColor: '#FFFFFF',
        alignItems: 'center', justifyContent: 'center',
      },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statusBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12,
    backgroundColor: c.background, borderRadius: 16, borderWidth: 1, borderColor: hair,
    paddingLeft: 12, paddingRight: 8, paddingVertical: 8,
  },
    statusBannerOnline: { backgroundColor: c.successBg, borderColor: 'rgba(34,197,94,0.35)' },
    statusDot: { width: 10, height: 10, borderRadius: 5 },
    statusTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    statusSub: { fontSize: 11.5, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: -1 },
    offlineBtn: { height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.card, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', alignItems: 'center', justifyContent: 'center' },
    offlineBtnText: { fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: c.error },
    onlineBtn: { height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    onlineBtnText: { fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },
    locWarn: {
    alignSelf: 'flex-start', marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.card, borderRadius: 12, borderWidth: 1, borderColor: hair, paddingHorizontal: 12, paddingVertical: 8,
  },
    sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: isDark ? 0.5 : 0.1, shadowRadius: 16, elevation: 14,
  },
    grabberWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
    grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border },
    sheetHeader: { paddingBottom: 10 },
    sheetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingHorizontal: 4 },
    sheetTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
    countBadge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    countBadgeText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
    routeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: hair, padding: 12,
  },
    routeRowIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: BRAND_ORANGE, alignItems: 'center', justifyContent: 'center' },
    routeRowTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    routeStopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    routeStopText: { flex: 1, fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
    routeStopDot: { width: 8, height: 8, borderRadius: 4 },
    routeMetaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    routeChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: c.card, borderWidth: 1, borderColor: c.divider },
    routeChipText: { fontSize: 11.5, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
    routeRowSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 1 },
    changePill: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    changePillText: { fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: c.accent },
    reqCard: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: hair, padding: 16, marginBottom: 14 },
    reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    reqTags: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
    reqPrice: { fontSize: 20, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.4 },
    reqActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
    declineBtn: { height: 46, paddingHorizontal: 16, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', alignItems: 'center', justifyContent: 'center' },
    detailActions: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 16 },
    detailDeclineBtn: { height: 48, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', alignItems: 'center', justifyContent: 'center' },
    declineText: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.error },
    detailsBtn: { flex: 1, height: 46, borderRadius: 23, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
    detailsText: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.accent },
    acceptBtnPill: { flex: 1.4, height: 46, borderRadius: 23, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
    acceptPillText: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },
    tag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
    tagText: { fontSize: 10.5, fontFamily: 'Poppins_700Bold', letterSpacing: 0.4 },
    rtPickPin: { width: 30, height: 30, borderRadius: 15, backgroundColor: BRAND_ORANGE, alignItems: 'center', justifyContent: 'center' },
    rtDropPin: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
    rtLine: { position: 'absolute', top: 34, bottom: -4, width: 2, borderRadius: 1, backgroundColor: c.border },
    rtStreetRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 3 },
    emptyWrap: { alignItems: 'center', paddingTop: 24, paddingBottom: 8 },
    emptyTitle: { marginTop: 10, fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
    emptySub: { marginTop: 4, fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, textAlign: 'center', paddingHorizontal: 24, lineHeight: 18 },
  });
};