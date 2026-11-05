// src/modules/Dashboard/Sender/Delivery/LocationSelectScreen.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar,
  ActivityIndicator, Animated, Easing, TextInput, FlatList, ScrollView,
  Keyboard, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PhIcon } from '../../../../components/ui/PhIcon';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { MAP_PROPS } from '../../../../utils/mapConfig';

const BLACK = '#111827';
const GREEN = '#16A34A';
const RED = '#DC2626';
const RECENTS_KEY = '@pns:recent_locations:v1';
const MAX_RECENTS = 6;

const ENDPOINT_OVERSHOOT_TOLERANCE_M = 25;

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_API_KEY = GOOGLE_MAPS_API_KEY.length > 10;

const REJECTED_PLACE_TYPES = new Set(['route', 'street_address', 'postal_code', 'plus_code']);

const ZOOM_DELTA = 0.003;
const SAME_SPOT_METERS = 8;
const NEARBY_RADIUS_M = 200;
const LABEL_SNAP_M = 60;

type Coord = { latitude: number; longitude: number };
type RecentEntry = { name: string; address: string; latitude: number; longitude: number; ts: number };
type SearchResult = {
  place_id: string; name: string; formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};
type NearbyPlace = { id: string; name: string; address: string; latitude: number; longitude: number; dist: number };
type Label = { name: string; sub?: string };

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

function pointToSegmentInfo(p: Coord, v: Coord, w: Coord) {
  const refLatRad = ((v.latitude + w.latitude) * 0.5 * Math.PI) / 180;
  const cosLat = Math.cos(refLatRad);
  const mPerDegLat = 111132.92;
  const mPerDegLng = 111412.84 * cosLat;

  const vx = 0;
  const vy = 0;
  const wx = (w.longitude - v.longitude) * mPerDegLng;
  const wy = (w.latitude - v.latitude) * mPerDegLat;
  const px = (p.longitude - v.longitude) * mPerDegLng;
  const py = (p.latitude - v.latitude) * mPerDegLat;

  const l2 = wx * wx + wy * wy;
  if (l2 === 0) {
    const dist = Math.hypot(px - vx, py - vy);
    return {
      distanceMeters: dist,
      clampedT: 0,
      rawT: 0,
      segLengthMeters: 0,
      projectedCoord: v,
    };
  }

  const rawT = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
  const clampedT = Math.max(0, Math.min(1, rawT));
  const projX = vx + clampedT * (wx - vx);
  const projY = vy + clampedT * (wy - vy);
  const distanceMeters = Math.hypot(px - projX, py - projY);
  const segLengthMeters = Math.sqrt(l2);

  const projectedCoord: Coord = {
    latitude: v.latitude + clampedT * (w.latitude - v.latitude),
    longitude: v.longitude + clampedT * (w.longitude - v.longitude),
  };

  return { distanceMeters, clampedT, rawT, segLengthMeters, projectedCoord };
}

function evaluateRouteAlignment(
  point: Coord,
  pointA: Coord,
  pointB: Coord,
  polyline: Coord[],
  maxCorridorMeters: number, // ✅ Pass the dynamic limit (500 or 1500)
) {
  const path = polyline.length >= 2 ? polyline : [pointA, pointB];

  const firstSeg = pointToSegmentInfo(point, path[0], path[Math.min(1, path.length - 1)]);
  const lastSeg = pointToSegmentInfo(point, path[Math.max(0, path.length - 2)], path[path.length - 1]);
  const abInfo = pointToSegmentInfo(point, pointA, pointB);

  const distToA = metersBetween(point, pointA);
  const distToB = metersBetween(point, pointB);

  const beforePointA =
    (abInfo.rawT < 0 && firstSeg.rawT < 0) && distToA > ENDPOINT_OVERSHOOT_TOLERANCE_M;
  const afterPointB =
    (abInfo.rawT > 1 && lastSeg.rawT > 1) && distToB > ENDPOINT_OVERSHOOT_TOLERANCE_M;

  let minDistance = Infinity;
  let totalRouteLen = 0;
  const segLengths: number[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const len = metersBetween(path[i], path[i + 1]);
    segLengths.push(len);
    totalRouteLen += len;
  }

  let bestDistanceAlong = 0;
  let accLen = 0;
  let nearestCoordOnRoute: Coord = pointA;

  for (let i = 0; i < path.length - 1; i++) {
    const info = pointToSegmentInfo(point, path[i], path[i + 1]);
    if (info.distanceMeters < minDistance) {
      minDistance = info.distanceMeters;
      bestDistanceAlong = accLen + info.clampedT * segLengths[i];
      nearestCoordOnRoute = info.projectedCoord;
    }
    accLen += segLengths[i];
  }

  const progress = totalRouteLen > 0 ? bestDistanceAlong / totalRouteLen : abInfo.clampedT;

  if (beforePointA) {
    return {
      aligned: false,
      distanceMeters: minDistance,
      progress,
      nearestCoordOnRoute: pointA,
      reason: 'Selected location is behind Point A. You must select a location strictly between Point A and Point B.',
    };
  }

  if (afterPointB) {
    return {
      aligned: false,
      distanceMeters: minDistance,
      progress,
      nearestCoordOnRoute: pointB,
      reason: 'Selected location is beyond Point B. You must select a location strictly between Point A and Point B.',
    };
  }

  if (minDistance > maxCorridorMeters) {
    return {
      aligned: false,
      distanceMeters: minDistance,
      progress,
      nearestCoordOnRoute,
      reason: `Selected pin is ${fmtDist(minDistance)} off the route. The limit is ${fmtDist(maxCorridorMeters)} for this delivery type. Place the pin on or near the orange route line.`,
    };
  }

  return {
    aligned: true,
    distanceMeters: minDistance,
    progress,
    nearestCoordOnRoute,
    reason: null,
  };
}

const fetchOsrmRoute = async (a: Coord, b: Coord): Promise<Coord[]> => {
  const fallback = [a, b];
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (data?.code === 'Ok' && data.routes?.[0]?.geometry?.coordinates) {
      return data.routes[0].geometry.coordinates.map((c: number[]) => ({
        latitude: c[1],
        longitude: c[0],
      }));
    }
  } catch { /* fall back to straight line */ }
  return fallback;
};

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const isPickup = type === 'pickup';
  const pinColor = isPickup ? colors.accent : BLACK;
  const tint = isPickup
    ? (isDark ? 'rgba(242,112,36,0.16)' : 'rgba(242,112,36,0.09)')
    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(17,24,39,0.06)');

  // ✅ Apply PDF Rule 2: 1500m for Door-to-Door, 500m for Curb-side
  const isDoorToDoor = /door/i.test(String(state.dropoffType || ''));
  const maxCorridorM = isDoorToDoor ? 1500 : 500;

  const preferredRoute = state.preferredRoute ?? null;
  const hasPreferredRoute = !!(
    preferredRoute &&
    preferredRoute.pickupCoords?.lat &&
    preferredRoute.pickupCoords?.lng &&
    preferredRoute.dropoffCoords?.lat &&
    preferredRoute.dropoffCoords?.lng
  );

  const routePointA: Coord | null = useMemo(
    () =>
      hasPreferredRoute && preferredRoute
        ? { latitude: preferredRoute.pickupCoords.lat, longitude: preferredRoute.pickupCoords.lng }
        : null,
    [hasPreferredRoute, preferredRoute],
  );

  const routePointB: Coord | null = useMemo(
    () =>
      hasPreferredRoute && preferredRoute
        ? { latitude: preferredRoute.dropoffCoords.lat, longitude: preferredRoute.dropoffCoords.lng }
        : null,
    [hasPreferredRoute, preferredRoute],
  );

  const [providerRouteCoords, setProviderRouteCoords] = useState<Coord[]>([]);
  const hasShownRouteOverview = useRef(false);

  const mapRef = useRef<MapView>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeq = useRef(0);
  const lastResolved = useRef<Coord | null>(null);
  const lastPoiTap = useRef(0);

  const [markerCoord, setMarkerCoord] = useState<Coord>(() => {
    const existingLoc = isPickup ? state.pickupLocation : state.dropoffLocation;
    if (state.isEdit && existingLoc?.latitude && existingLoc?.longitude) {
      return { latitude: existingLoc.latitude, longitude: existingLoc.longitude };
    }
    if (hasPreferredRoute && preferredRoute) {
      return isPickup
        ? { latitude: preferredRoute.pickupCoords.lat, longitude: preferredRoute.pickupCoords.lng }
        : { latitude: preferredRoute.dropoffCoords.lat, longitude: preferredRoute.dropoffCoords.lng };
    }
    return {
      latitude: initialCoords?.latitude || 10.3157,
      longitude: initialCoords?.longitude || 123.8854,
    };
  });
  const markerRef = useRef(markerCoord);
  markerRef.current = markerCoord;

  const [addressName, setAddressName] = useState('Locating...');
  const [addressSub, setAddressSub] = useState('');
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isDraggingMap, setIsDraggingMap] = useState(false);
  const [validatingPin, setValidatingPin] = useState(false);

  const [note, setNote] = useState<string>(
    () => ((isPickup ? state.pickupLocation : state.dropoffLocation) as any)?.note ?? '',
  );
  const [editingNote, setEditingNote] = useState(false);
  const [kbH, setKbH] = useState(0);

  const [structuredAddress, setStructuredAddress] = useState({
    street_address: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  const sheetAnim = useRef(new Animated.Value(0)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const pinPulse = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  /* ------------------ Fetch Provider Route Polyline ------------------ */
  useEffect(() => {
    if (!routePointA || !routePointB) {
      setProviderRouteCoords([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const coords = await fetchOsrmRoute(routePointA, routePointB);
      if (!cancelled) setProviderRouteCoords(coords);
    })();
    return () => { cancelled = true; };
  }, [routePointA, routePointB]);

  /* ------------------ Fit Map to Provider Route First ------------------ */
  const fitProviderRoute = useCallback(() => {
    if (!mapRef.current || !routePointA || !routePointB) return;
    const pts = providerRouteCoords.length >= 2 ? providerRouteCoords : [routePointA, routePointB];
    mapRef.current.fitToCoordinates(pts, {
      edgePadding: { top: insets.top + 120, right: 55, bottom: 80, left: 55 },
      animated: true,
    });
  }, [routePointA, routePointB, providerRouteCoords, insets.top]);

  useEffect(() => {
    if (!mapLoaded || !hasPreferredRoute || !routePointA || !routePointB) return;
    if (hasShownRouteOverview.current) return;
    hasShownRouteOverview.current = true;

    const t = setTimeout(() => {
      fitProviderRoute();
    }, 250);
    return () => clearTimeout(t);
  }, [mapLoaded, hasPreferredRoute, routePointA, routePointB, fitProviderRoute]);

  /* ------------------ Evaluate Route Alignment Live ------------------ */
  const routeAlignment = useMemo(() => {
    if (!hasPreferredRoute || !routePointA || !routePointB) {
      return {
        aligned: true,
        distanceMeters: 0,
        progress: 0,
        nearestCoordOnRoute: markerCoord,
        reason: null as string | null,
      };
    }
    // ✅ Pass maxCorridorM to validation
    const baseCheck = evaluateRouteAlignment(markerCoord, routePointA, routePointB, providerRouteCoords, maxCorridorM);
    if (!baseCheck.aligned) return baseCheck;

    if (!isPickup && state.pickupLocation) {
      const pickupCoord: Coord = {
        latitude: state.pickupLocation.latitude,
        longitude: state.pickupLocation.longitude,
      };
      const pickupCheck = evaluateRouteAlignment(pickupCoord, routePointA, routePointB, providerRouteCoords, maxCorridorM);
      const distFromPickup = metersBetween(pickupCoord, markerCoord);

      if (distFromPickup < 30) {
        return {
          aligned: false,
          distanceMeters: baseCheck.distanceMeters,
          progress: baseCheck.progress,
          nearestCoordOnRoute: routePointB,
          reason: 'Drop-off location cannot be the same as the pickup location.',
        };
      }

      if (baseCheck.progress < pickupCheck.progress - 0.01) {
        return {
          aligned: false,
          distanceMeters: baseCheck.distanceMeters,
          progress: baseCheck.progress,
          nearestCoordOnRoute: routePointB,
          reason:
            'Drop-off is disaligned with the provider’s direction (Point A → Point B). Please select a drop-off point further toward Point B than your pickup.',
        };
      }
    }

    return baseCheck;
  }, [
    hasPreferredRoute,
    routePointA,
    routePointB,
    markerCoord,
    providerRouteCoords,
    isPickup,
    state.pickupLocation,
    maxCorridorM, // ✅ Added to dependencies
  ]);

  /* ------------------------------ animations ------------------------------ */
  useEffect(() => {
    Animated.timing(sheetAnim, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [sheetAnim]);

  useEffect(() => {
    Animated.spring(pinBounce, { toValue: isDraggingMap ? 1 : 0, friction: 6, tension: 40, useNativeDriver: true }).start();
  }, [isDraggingMap, pinBounce]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pinPulse, { toValue: 1, duration: 1500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pinPulse, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pinPulse]);

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

  const animatePressIn = () => Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  const animatePressOut = () => Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();

  /* ------------------------------ recents ------------------------------ */
  const loadRecents = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(RECENTS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentEntry[];
        setRecents(Array.isArray(parsed) ? parsed : []);
      }
    } catch { /* ignore */ }
  }, []);

  const saveRecent = useCallback(async (entry: RecentEntry) => {
    try {
      const next = [
        entry,
        ...recents.filter(r => Math.abs(r.latitude - entry.latitude) > 1e-4 || Math.abs(r.longitude - entry.longitude) > 1e-4),
      ].slice(0, MAX_RECENTS);
      setRecents(next);
      await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  }, [recents]);

  const clearRecents = async () => {
    try { await AsyncStorage.removeItem(RECENTS_KEY); setRecents([]); } catch { /* ignore */ }
  };

  useEffect(() => { loadRecents(); }, [loadRecents]);

  /* ---------------------- address lookup ---------------------- */
  const fetchNearby = async (coords: Coord): Promise<NearbyPlace[]> => {
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

  const resolveAt = useCallback(async (coords: Coord, label?: Label) => {
    const seq = ++resolveSeq.current;
    lastResolved.current = coords;
    setValidatingPin(true);
    if (label) { setAddressName(label.name); setAddressSub(label.sub || ''); }

    const [geo, list] = await Promise.all([reverseGeocodeGoogle(coords), fetchNearby(coords)]);
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
  }, []);

  const moveTo = useCallback((coords: Coord, label?: Label) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setMarkerCoord(coords);
    mapRef.current?.animateToRegion({ ...coords, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }, 450);
    resolveAt(coords, label);
  }, [resolveAt]);

  const snapPinToRoute = useCallback(() => {
    if (!hasPreferredRoute) return;
    const target = routeAlignment.nearestCoordOnRoute;
    if (target) moveTo(target);
  }, [hasPreferredRoute, routeAlignment.nearestCoordOnRoute, moveTo]);

  /* ------------------------------ init ------------------------------ */
  useEffect(() => {
    const existingLoc = isPickup ? state.pickupLocation : state.dropoffLocation;
    if (state.isEdit && existingLoc?.latitude && existingLoc?.longitude) {
      const target = { latitude: existingLoc.latitude, longitude: existingLoc.longitude };
      setMarkerCoord(target);
      resolveAt(target, existingLoc.address ? { name: existingLoc.address.split(',')[0], sub: existingLoc.address } : undefined);
      return;
    }

    if (hasPreferredRoute && routePointA && routePointB) {
      const target = isPickup ? routePointA : routePointB;
      const defaultLabel = isPickup ? preferredRoute?.pickup : preferredRoute?.dropoff;
      setMarkerCoord(target);
      resolveAt(target, defaultLabel ? { name: defaultLabel.split(',')[0], sub: defaultLabel } : undefined);
      return;
    }

    if (type === 'dropoff' && initialCoords) {
      setMarkerCoord(initialCoords);
      resolveAt(initialCoords);
      return;
    }
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { resolveAt(markerRef.current); return; }
        const loc = await Location.getCurrentPositionAsync({});
        moveTo({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } catch {
        resolveAt(markerRef.current);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

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

  /* ------------------------------ search ------------------------------ */
  const runSearch = useCallback(async (text: string) => {
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
  }, []);

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
    setEditingNote(false);
    moveTo({ latitude: p.latitude, longitude: p.longitude }, { name: p.name, sub: p.address });
  };

  /* ------------------------------ confirm ------------------------------ */
  const confirmLocation = () => {
    if (hasPreferredRoute && !routeAlignment.aligned) {
      Alert.alert(
        'Location Disaligned With Route',
        routeAlignment.reason ||
          `The selected location is outside the provider’s route between Point A and Point B (must be within ${fmtDist(maxCorridorM)} of the route line).`,
        [
          { text: 'Snap Pin to Route', onPress: snapPinToRoute },
          { text: 'View Full Route', onPress: fitProviderRoute },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    const fullAddress = `${addressName}${addressSub && addressSub !== addressName ? ', ' + addressSub : ''}`;
    const locationInfo = {
      address: fullAddress,
      latitude: markerCoord.latitude,
      longitude: markerCoord.longitude,
      ...structuredAddress,
      note: note.trim() || undefined,
    };
    saveRecent({ name: addressName, address: addressSub || addressName, latitude: markerCoord.latitude, longitude: markerCoord.longitude, ts: Date.now() });

    if (route.params?.fromExplore) {
      dispatch({ type: route.params.for === 'pickup' ? 'SET_EXPLORE_PICKUP' : 'SET_EXPLORE_DROPOFF', payload: locationInfo });
      navigation.goBack();
      return;
    }
    if (type === 'pickup') {
      dispatch({ type: 'SET_PICKUP_LOCATION', payload: locationInfo });
      navigation.navigate('DropoffLocation', { type: 'dropoff', initialCoords: routePointB ?? markerCoord });
    } else {
      dispatch({ type: 'SET_DROPOFF_LOCATION', payload: locationInfo });
      navigation.navigate('Booking', { mode });
    }
  };

  /* ------------------------------ map handlers ------------------------------ */
  const onPanDrag = () => {
    if (!isDraggingMap) setIsDraggingMap(true);
    if (editingNote) { Keyboard.dismiss(); setEditingNote(false); }
  };

  const onRegionChangeComplete = (region: Region) => {
    setIsDraggingMap(false);
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
    setEditingNote(false);
    if (Date.now() - lastPoiTap.current < 500) return;
    const c = e.nativeEvent?.coordinate;
    if (!c) return;
    moveTo({ latitude: c.latitude, longitude: c.longitude });
  };

  const pinTranslateY = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
  const pinScale = pinBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const pulseScale = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pinPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] });

  const displayList: (SearchResult | RecentEntry)[] = searchQuery.trim().length > 0 ? searchResults : recents;
  const busy = validatingPin || isDraggingMap;
  const misaligned = hasPreferredRoute && !routeAlignment.aligned;

  // Filter nearby places when on a provider's route so only places strictly within the route corridor are suggested
  const alignedNearby = useMemo(() => {
    if (!hasPreferredRoute || !routePointA || !routePointB) return nearby;
    return nearby.filter(p => {
      const check = evaluateRouteAlignment(
        { latitude: p.latitude, longitude: p.longitude },
        routePointA,
        routePointB,
        providerRouteCoords,
        maxCorridorM,
      );
      return check.aligned;
    });
  }, [nearby, hasPreferredRoute, routePointA, routePointB, providerRouteCoords, maxCorridorM]);

  return (
    <View style={[styles.container, { paddingBottom: kbH }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      {/* ============================== MAP AREA ============================== */}
      <View style={styles.mapArea}>
        <MapView
          ref={mapRef}
          {...MAP_PROPS}
          style={StyleSheet.absoluteFill}
          initialRegion={{ ...markerCoord, latitudeDelta: ZOOM_DELTA, longitudeDelta: ZOOM_DELTA }}
          onMapReady={() => setMapLoaded(true)}
          onPanDrag={onPanDrag}
          onRegionChangeComplete={onRegionChangeComplete}
          onPoiClick={onPoiClick}
          onPress={onMapPress}
          showsUserLocation
          userInterfaceStyle="light"
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          {hasPreferredRoute && routePointA && routePointB && (
            <>
              <Polyline
                coordinates={providerRouteCoords.length >= 2 ? providerRouteCoords : [routePointA, routePointB]}
                strokeColor={routeAlignment.aligned ? colors.accent : RED}
                strokeWidth={6}
                tappable
                onPress={(e: any) => {
                  const c = e.nativeEvent?.coordinate;
                  if (c) moveTo({ latitude: c.latitude, longitude: c.longitude });
                }}
              />

              <Marker
                coordinate={routePointA}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={() =>
                  moveTo(routePointA, {
                    name: preferredRoute?.pickup?.split(',')[0] || 'Point A',
                    sub: preferredRoute?.pickup || '',
                  })
                }
              >
                <View style={[styles.routeEndpointMarkerA, { backgroundColor: colors.accent }]}>
                  <Text style={styles.routeEndpointText}>A</Text>
                </View>
              </Marker>

              <Marker
                coordinate={routePointB}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
                onPress={() =>
                  moveTo(routePointB, {
                    name: preferredRoute?.dropoff?.split(',')[0] || 'Point B',
                    sub: preferredRoute?.dropoff || '',
                  })
                }
              >
                <View style={[styles.routeEndpointMarkerB, { backgroundColor: BLACK }]}>
                  <Text style={styles.routeEndpointText}>B</Text>
                </View>
              </Marker>
            </>
          )}

          {!isPickup && state.pickupLocation && (
            <Marker
              coordinate={{
                latitude: state.pickupLocation.latitude,
                longitude: state.pickupLocation.longitude,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
            >
              <View style={[styles.confirmedPickupMarker, { backgroundColor: colors.accent }]}>
                <PhIcon name="Cube" size={12} color="#FFFFFF" weight="fill" />
              </View>
            </Marker>
          )}
        </MapView>

        {!mapLoaded && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        )}

        {/* Provider Route Banner & Alignment Status */}
        {hasPreferredRoute && preferredRoute && (
          <View style={[styles.routeBannerWrapper, { top: insets.top + 72 }]} pointerEvents="box-none">
            <View style={[styles.routeBanner, misaligned && styles.routeBannerError]}>
              <View style={styles.routeBannerTop}>
                <View
                  style={[
                    styles.routeStatusBadge,
                    { backgroundColor: routeAlignment.aligned ? 'rgba(22,163,74,0.14)' : 'rgba(220,38,38,0.14)' },
                  ]}
                >
                  <PhIcon
                    name={routeAlignment.aligned ? 'CheckCircle' : 'WarningCircle'}
                    size={15}
                    color={routeAlignment.aligned ? GREEN : RED}
                    weight="fill"
                  />
                  <Text
                    style={[
                      styles.routeStatusText,
                      { color: routeAlignment.aligned ? GREEN : RED },
                    ]}
                  >
                    {routeAlignment.aligned
                      ? `On Route (${fmtDist(routeAlignment.distanceMeters)} from line)`
                      : `Disaligned · ${fmtDist(routeAlignment.distanceMeters)} off route (max ${fmtDist(maxCorridorM)})`}
                  </Text>
                </View>

                {!routeAlignment.aligned ? (
                  <TouchableOpacity style={styles.snapRouteBtn} onPress={snapPinToRoute} activeOpacity={0.85}>
                    <PhIcon name="Magnet" size={14} color="#FFFFFF" weight="bold" />
                    <Text style={styles.snapRouteBtnText}>Snap to Route</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.fitRouteBtn, { backgroundColor: isDark ? 'rgba(242,112,36,0.22)' : 'rgba(242,112,36,0.12)' }]}
                    onPress={fitProviderRoute}
                    activeOpacity={0.85}
                  >
                    <PhIcon name="GitBranch" size={14} color={colors.accent} weight="bold" />
                    <Text style={[styles.fitRouteBtnText, { color: colors.accent }]}>Show Route</Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={[styles.routeCorridorText, { color: colors.textSecondary }]} numberOfLines={1}>
                A: {preferredRoute.pickup.split(',')[0]} → B: {preferredRoute.dropoff.split(',')[0]}
              </Text>

              {misaligned && !!routeAlignment.reason && (
                <Text style={styles.routeErrorSub} numberOfLines={2}>
                  {routeAlignment.reason}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* name bubble + pin, centred in the visible map */}
        <View style={styles.centerStack} pointerEvents="box-none">
          <Animated.View style={{ transform: [{ translateY: pinTranslateY }] }} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border }]}
              activeOpacity={0.9}
              onPress={() => setIsSearching(true)}
            >
              <Text style={[styles.bubbleText, { color: colors.textPrimary }]} numberOfLines={1}>{addressName}</Text>
              {busy
                ? <ActivityIndicator size="small" color={colors.textMuted} style={{ marginLeft: 8 }} />
                : <PhIcon name="CaretRight" size={14} color={colors.textMuted} weight="bold" style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          </Animated.View>

          <View style={styles.pinContainer} pointerEvents="none">
            <Animated.View style={[styles.pinWrapper, { transform: [{ translateY: pinTranslateY }, { scale: pinScale }] }]}>
              <Animated.View
                style={[
                  styles.pinHalo,
                  {
                    backgroundColor: misaligned ? RED : pinColor,
                    transform: [{ scale: pulseScale }],
                    opacity: pulseOpacity,
                  },
                ]}
              />
              <View
                style={[
                  styles.pinDot,
                  { backgroundColor: misaligned ? RED : pinColor },
                ]}
              >
                <View style={styles.pinDotInner} />
              </View>
              <View
                style={[
                  styles.pinStem,
                  { backgroundColor: misaligned ? RED : pinColor },
                ]}
              />
            </Animated.View>
            <View style={styles.pinShadow} />
          </View>
        </View>

        {/* Back button — glass premium floating */}
        <TouchableOpacity
          style={[styles.backBtn, { top: insets.top + 10 }]}
          onPress={() => navigation.goBack()}
          activeOpacity={0.85}
        >
          <PhIcon name="ArrowLeft" size={22} color={colors.textPrimary} weight="bold" />
        </TouchableOpacity>

        {/* Section pill — replaces "Step X of 4" for map context */}
        <View
          style={[styles.topPill, { top: insets.top + 14, backgroundColor: colors.card, borderColor: colors.border }]}
          pointerEvents="none"
        >
          <View style={[styles.topPillDot, { backgroundColor: pinColor }]} />
          <Text style={[styles.topPillText, { color: colors.textPrimary }]}>
            {isPickup ? 'Pickup location' : 'Drop-off location'}
          </Text>
        </View>

        {hasPreferredRoute && (
          <TouchableOpacity
            style={[styles.fitRouteFab, { bottom: 96, backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={fitProviderRoute}
            activeOpacity={0.85}
          >
            <PhIcon name="MapTrifold" size={22} color={colors.accent} weight="bold" />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.locateMeBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleLocateMe}
          disabled={locating}
          activeOpacity={0.85}
        >
          {locating
            ? <ActivityIndicator size="small" color={colors.textPrimary} />
            : <PhIcon name="Crosshair" size={22} color={colors.textPrimary} weight="bold" />}
        </TouchableOpacity>
      </View>

      {/* ============================== BOTTOM SHEET ============================== */}
      <Animated.View style={[styles.sheet, { opacity: sheetAnim }]}>
        <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />

        {!editingNote && (
          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {hasPreferredRoute && routePointA && routePointB && preferredRoute && (
              <View style={styles.quickEndpointsRow}>
                <TouchableOpacity
                  style={[styles.quickEndpointChip, { backgroundColor: colors.background, borderColor: colors.border }]}
                  activeOpacity={0.85}
                  onPress={() =>
                    moveTo(routePointA, {
                      name: preferredRoute.pickup.split(',')[0] || 'Point A',
                      sub: preferredRoute.pickup,
                    })
                  }
                >
                  <View style={[styles.quickDot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.quickEndpointText, { color: colors.textPrimary }]} numberOfLines={1}>
                    Point A: {preferredRoute.pickup.split(',')[0]}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.quickEndpointChip, { backgroundColor: colors.background, borderColor: colors.border }]}
                  activeOpacity={0.85}
                  onPress={() =>
                    moveTo(routePointB, {
                      name: preferredRoute.dropoff.split(',')[0] || 'Point B',
                      sub: preferredRoute.dropoff,
                    })
                  }
                >
                  <View style={[styles.quickDot, { backgroundColor: BLACK }]} />
                  <Text style={[styles.quickEndpointText, { color: colors.textPrimary }]} numberOfLines={1}>
                    Point B: {preferredRoute.dropoff.split(',')[0]}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={[styles.row, { backgroundColor: tint }]} activeOpacity={0.85} onPress={() => setIsSearching(true)}>
              <View style={styles.rowIconCol}>
                <View
                  style={[
                    styles.rowIcon,
                    { backgroundColor: misaligned ? RED : pinColor },
                  ]}
                >
                  <PhIcon name="MapPin" size={18} color="#FFFFFF" weight="fill" />
                </View>
              </View>
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>{addressName}</Text>
                <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
                  {busy ? 'Updating address...' : addressSub || 'Fetching address details...'}
                </Text>
              </View>
              <PhIcon name="PencilSimple" size={18} color={colors.textSecondary} weight="bold" />
            </TouchableOpacity>

            {alignedNearby.map(p => (
              <TouchableOpacity key={p.id} style={styles.row} activeOpacity={0.7} onPress={() => pickNearby(p)}>
                <View style={styles.rowIconCol}>
                  <View style={[styles.rowIconMuted, { backgroundColor: colors.background }]}>
                    <PhIcon name="MapPin" size={18} color={colors.textSecondary} weight="bold" />
                  </View>
                  <Text style={[styles.rowDist, { color: colors.textSecondary }]}>{fmtDist(p.dist)}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.textPrimary }]} numberOfLines={1}>{p.name}</Text>
                  <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>{p.address}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {alignedNearby.length === 0 && (
              <Text style={[styles.emptyNearby, { color: colors.textMuted }]}>
                {busy
                  ? 'Looking for nearby places...'
                  : hasPreferredRoute
                    ? `Drag the pin along the orange route line (max ${fmtDist(maxCorridorM)} away).`
                    : 'No named places nearby. Drag the map or search.'}
              </Text>
            )}
          </ScrollView>
        )}

        <View style={[styles.noteBar, { borderTopColor: colors.divider }]}>
          {editingNote ? (
            <View style={styles.noteEditRow}>
              <PhIcon name="NotePencil" size={22} color={pinColor} weight="bold" style={{ marginTop: 6 }} />
              <TextInput
                style={[styles.noteInput, { color: colors.textPrimary }]}
                value={note}
                onChangeText={setNote}
                autoFocus
                multiline
                maxLength={200}
                placeholder={isPickup ? 'e.g. Blue gate beside 7-Eleven, call when outside' : 'e.g. Leave with the guard, 3rd floor, unit 305'}
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={() => setEditingNote(false)}
              />
              <TouchableOpacity onPress={() => { Keyboard.dismiss(); setEditingNote(false); }} hitSlop={8}>
                <Text style={[styles.noteDone, { color: pinColor }]}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.noteRow} activeOpacity={0.8} onPress={() => setEditingNote(true)}>
              <PhIcon name="NotePencil" size={22} color={pinColor} weight="bold" />
              <Text
                style={[
                  styles.noteText,
                  note
                    ? { color: colors.textPrimary, fontWeight: '600' }
                    : { color: pinColor },
                ]}
                numberOfLines={2}
              >
                {note || 'Enter note for driver.'}
              </Text>
              {!!note && <PhIcon name="PencilSimple" size={16} color={colors.textSecondary} weight="bold" />}
            </TouchableOpacity>
          )}
          {editingNote && <Text style={[styles.noteCount, { color: colors.textMuted }]}>{note.length}/200</Text>}
        </View>

        <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
          <TouchableOpacity
            style={[
              styles.confirmBtn,
              { backgroundColor: colors.accent, shadowColor: colors.accent },
              misaligned && styles.confirmBtnDisaligned,
              busy && { opacity: 0.6 },
            ]}
            onPress={() => { Keyboard.dismiss(); confirmLocation(); }}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            activeOpacity={0.9}
            disabled={busy}
          >
            <Text style={styles.confirmBtnText}>
              {busy
                ? 'Updating...'
                : misaligned
                  ? 'Disaligned · Tap to Snap to Route'
                  : isPickup
                    ? 'Confirm pickup'
                    : 'Confirm drop-off'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
        <View style={{ height: kbH > 0 ? 8 : Math.max(insets.bottom, 12) }} />
      </Animated.View>

      {/* ============================== SEARCH OVERLAY ============================== */}
      {isSearching && (
        <View style={[styles.searchOverlay, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
          <View style={[styles.searchModalHeader, { borderBottomColor: colors.divider }]}>
            <TouchableOpacity
              style={[styles.searchBackBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={closeSearch}
            >
              <PhIcon name="ArrowLeft" size={22} color={colors.textPrimary} weight="bold" />
            </TouchableOpacity>
            <View style={[styles.searchInputWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <PhIcon name="MagnifyingGlass" size={18} color={colors.textMuted} weight="bold" style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { color: colors.textPrimary }]}
                placeholder="Search mall, school, landmark..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={10}>
                  <PhIcon name="XCircle" size={18} color={colors.textMuted} weight="fill" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {searchLoading && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 20 }} />}
          {!!searchError && !searchLoading && (
            <Text style={[styles.searchErrorText, { color: colors.textMuted }]}>{searchError}</Text>
          )}

          {searchQuery.trim().length === 0 && recents.length > 0 && (
            <View style={styles.recentsHeader}>
              <Text style={[styles.recentsLabel, { color: colors.textMuted }]}>RECENT</Text>
              <TouchableOpacity onPress={clearRecents}>
                <Text style={[styles.clearText, { color: colors.accent }]}>Clear</Text>
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
                  style={[styles.searchResultItem, { borderBottomColor: colors.divider }]}
                  onPress={() => (isRecent ? pickRecent(item as RecentEntry) : selectSearchResult(item as SearchResult))}
                >
                  <View style={[styles.searchResultIconBox, { backgroundColor: colors.background }]}>
                    <PhIcon
                      name={isRecent ? 'ClockCounterClockwise' : 'MapPin'}
                      size={18}
                      color={pinColor}
                      weight={isRecent ? 'bold' : 'fill'}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.searchResultTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.searchResultSub, { color: colors.textSecondary }]} numberOfLines={2}>
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
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  mapArea: { flex: 1, backgroundColor: isDark ? '#0B0F17' : '#F5F5F5', overflow: 'hidden' },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: isDark ? '#0B0F17' : '#F5F5F5',
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  routeEndpointMarkerA: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
  },
  routeEndpointMarkerB: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5,
  },
  routeEndpointText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  confirmedPickupMarker: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  routeBannerWrapper: { position: 'absolute', left: 16, right: 16, zIndex: 6 },
  routeBanner: {
    backgroundColor: c.card, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(22,163,74,0.35)' : 'rgba(22,163,74,0.28)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.4 : 0.1,
    shadowRadius: 10, elevation: 5,
  },
  routeBannerError: {
    borderColor: RED,
    backgroundColor: isDark ? 'rgba(220,38,38,0.12)' : '#FEF2F2',
  },
  routeBannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  routeStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, flexShrink: 1,
  },
  routeStatusText: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  fitRouteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
  },
  fitRouteBtnText: { fontSize: 11, fontWeight: '800' },
  snapRouteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    backgroundColor: RED,
  },
  snapRouteBtnText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  routeCorridorText: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  routeErrorSub: { fontSize: 11, fontWeight: '600', color: RED, marginTop: 4, lineHeight: 15 },
  fitRouteFab: {
    position: 'absolute', right: 16, width: 52, height: 52, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', zIndex: 5, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.4 : 0.12,
    shadowRadius: 10, elevation: 5,
  },
  quickEndpointsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  quickEndpointChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8,
  },
  quickDot: { width: 8, height: 8, borderRadius: 4 },
  quickEndpointText: { flex: 1, fontSize: 12, fontWeight: '700' },
  centerStack: {
    position: 'absolute', left: 0, right: 0, top: '50%',
    marginTop: -(32 + 8 + 42), height: 42 + 8 + 32,
    alignItems: 'center', zIndex: 4,
  },
  bubble: {
    height: 42, maxWidth: '78%', flexDirection: 'row', alignItems: 'center',
    borderRadius: 21, paddingHorizontal: 16, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.4 : 0.18,
    shadowRadius: 10, elevation: 6,
  },
  bubbleText: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
  pinContainer: { marginTop: 8, alignItems: 'center' },
  pinWrapper: { alignItems: 'center' },
  pinHalo: { position: 'absolute', top: 0, width: 24, height: 24, borderRadius: 12, opacity: 0.3 },
  pinDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: '#FFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 6, zIndex: 2,
  },
  pinDotInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFF' },
  pinStem: { width: 2, height: 8, marginTop: -2, zIndex: 1 },
  pinShadow: { position: 'absolute', bottom: -2, width: 8, height: 3, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.25)' },
  backBtn: {
    position: 'absolute', left: 16, width: 48, height: 48, borderRadius: 24,
    backgroundColor: isDark ? 'rgba(30,36,48,0.88)' : 'rgba(255,255,255,0.94)',
    justifyContent: 'center', alignItems: 'center', zIndex: 5,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.7)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  topPill: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, zIndex: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: isDark ? 0.35 : 0.12,
    shadowRadius: 8, elevation: 4,
  },
  topPillDot: { width: 8, height: 8, borderRadius: 4 },
  topPillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  locateMeBtn: {
    position: 'absolute', right: 16, bottom: 34, width: 52, height: 52, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', zIndex: 5, borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.4 : 0.12,
    shadowRadius: 10, elevation: 5,
  },
  sheet: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -22,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: isDark ? 0.5 : 0.08, shadowRadius: 14, elevation: 12, zIndex: 6,
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  list: { maxHeight: 232 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 14 },
  rowIconCol: { width: 56, alignItems: 'center' },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowIconMuted: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowDist: { fontSize: 11, marginTop: 4, fontWeight: '600' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowSub: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  emptyNearby: { textAlign: 'center', fontSize: 12, paddingVertical: 14, paddingHorizontal: 20, fontWeight: '500' },
  noteBar: { borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 14 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  noteText: { flex: 1, fontSize: 16, fontWeight: '700' },
  noteEditRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  noteInput: { flex: 1, fontSize: 15, minHeight: 40, maxHeight: 90, padding: 0, paddingTop: 8, textAlignVertical: 'top' },
  noteDone: { fontSize: 15, fontWeight: '800', marginTop: 8 },
  noteCount: { fontSize: 10, textAlign: 'right', marginTop: 4, fontWeight: '600' },
  confirmBtn: {
    marginHorizontal: 20, borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  confirmBtnDisaligned: { backgroundColor: RED, shadowColor: RED },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  searchOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  searchModalHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  searchBackBtn: {
    width: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1,
  },
  searchInputWrapper: {
    flex: 1, height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500' },
  searchErrorText: { textAlign: 'center', marginTop: 24, fontSize: 13, fontWeight: '500' },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
    borderBottomWidth: 1, gap: 14,
  },
  searchResultIconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  searchResultTitle: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  searchResultSub: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  recentsHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  recentsLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  clearText: { fontSize: 12, fontWeight: '700' },
});