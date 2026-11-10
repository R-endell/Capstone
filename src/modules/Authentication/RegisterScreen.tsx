// src/modules/Authentication/RegisterScreen.tsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
  ActivityIndicator, Animated, Easing, Modal
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { decode } from 'base64-arraybuffer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE, Circle } from 'react-native-maps';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../utils/mapConfig';

const ORANGE = '#F27024';
const GREEN = '#16A34A';
const AMBER = '#D97706';
const COOLDOWN_SECONDS = 60;
const GPS_MATCH_RADIUS_M = 150;

const GOOGLE_MAPS_API_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
const HAS_GOOGLE_KEY = GOOGLE_MAPS_API_KEY.length > 10;

const CEBU_ZIP_FALLBACK: Record<string, string> = {
  'cebu city': '6000', 'mandaue': '6014', 'mandaue city': '6014',
  'lapu-lapu': '6015', 'lapu-lapu city': '6015', 'talisay': '6045', 'talisay city': '6045',
  'consolacion': '6001', 'liloan': '6002', 'minglanilla': '6046', 'naga': '6037',
  'naga city': '6037', 'cordova': '6017',
};

type LatLng = { lat: number; lng: number };

const metersBetween = (a: LatLng, b: LatLng): number => {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.max(1, Math.round(m))}m` : `${(m / 1000).toFixed(2)} km`;

const ADDRESS_REUSE_RADIUS_M = 25;
const GEOCODE_DEBOUNCE_MS = 250;
const GEOCODE_TIMEOUT_MS = 6000;

const GPS_CACHED_MAX_ACCURACY_M = 35;
const GPS_GOOD_ENOUGH_M = 25;
const GPS_ACCEPTABLE_M = 60;
const GPS_SOFT_WAIT_MS = 1500;
const GPS_MAX_WAIT_MS = 5000;
const PREFETCH_MAX_AGE_MS = 90000;

type ResolvedAddress = {
  street: string;
  barangay: string;
  city: string;
  province: string;
  zip_code: string;
  formatted: string;
};

const UNRESOLVED_ADDRESS: ResolvedAddress = {
  street: 'Not identified', barangay: 'Not identified', city: 'Not identified',
  province: 'Not identified', zip_code: '',
  formatted: 'Address details unavailable. Move the pin slightly or try again.',
};

const REGION_NAME_RE = /central visayas|gitnang kabisayaan|kabisayaan|region\s*(vii|7)\b/i;

const normKey = (v: string): string =>
  (v || '')
    .toLowerCase()
    .replace(/\b(city|municipality|of|province)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

const CEBU_LGU_KEYS = new Set(
  ('cebu mandaue lapulapu talisay naga danao carcar toledo bogo alcantara alcoy alegria ' +
    'aloguinsan argao asturias badian balamban bantayan barili boljoon borbon carmen catmon ' +
    'compostela consolacion cordova daanbantayan dalaguete dumanjug ginatilan liloan madridejos ' +
    'malabuyoc medellin minglanilla moalboal oslob pilar pinamungajan poro ronda samboan ' +
    'sanfernando sanfrancisco sanremigio santafe santander sibonga sogod tabogon tabuelan ' +
    'tuburan tudela').split(' '),
);

const CITY_DISPLAY: Record<string, string> = {
  cebu: 'Cebu City', mandaue: 'Mandaue City', lapulapu: 'Lapu-Lapu City',
  talisay: 'Talisay City', naga: 'Naga City', danao: 'Danao City',
  carcar: 'Carcar City', toledo: 'Toledo City', bogo: 'Bogo City',
};

const inCebuProvince = (c: LatLng): boolean =>
  c.lat >= 9.4 && c.lat <= 11.4 && c.lng >= 123.2 && c.lng <= 124.6 &&
  (c.lng <= 124.05 || c.lat >= 10.45);

const hasType = (r: any, types: string[]): boolean =>
  (r?.types || []).some((t: string) => types.includes(t));

const compOf = (r: any, types: string[]): string => {
  const comps: any[] = r?.address_components || [];
  for (const t of types) {
    const hit = comps.find((c: any) => (c.types || []).includes(t));
    if (hit?.long_name) return hit.long_name;
  }
  return '';
};

const parseGoogleAddress = (results: any[], coords: LatLng): ResolvedAddress => {
  const barangayResult =
    results.find((r) =>
      hasType(r, ['sublocality_level_1', 'sublocality', 'administrative_area_level_4']),
    ) || results.find((r) => hasType(r, ['neighborhood']));
  const cityResult = results.find((r) => hasType(r, ['locality']));
  const areaResult = barangayResult || cityResult || results[0];

  const barangay = compOf(barangayResult, [
    'sublocality_level_1', 'sublocality', 'administrative_area_level_4', 'neighborhood',
  ])
    .replace(/^Brgy\.?\s*/i, '')
    .replace(/^Barangay\s+/i, '')
    .trim();

  const admin2Raw =
    compOf(areaResult, ['administrative_area_level_2']) ||
    compOf(cityResult, ['administrative_area_level_2']);

  let cityRaw = compOf(areaResult, ['locality']) || compOf(cityResult, ['locality']);
  if (!cityRaw && /\bcity\b/i.test(admin2Raw)) cityRaw = admin2Raw;
  if (!cityRaw) {
    const admin3 =
      compOf(areaResult, ['administrative_area_level_3']) ||
      compOf(cityResult, ['administrative_area_level_3']);
    if (admin3 && normKey(admin3) !== normKey(barangay)) cityRaw = admin3;
  }
  if (REGION_NAME_RE.test(cityRaw)) cityRaw = '';
  const cityKey = normKey(cityRaw);
  const city = (CITY_DISPLAY[cityKey] || cityRaw).trim();
  const inCebu = CEBU_LGU_KEYS.has(cityKey) && inCebuProvince(coords);

  const admin2 = admin2Raw.replace(/^province of\s+/i, '').replace(/\s+province$/i, '').trim();
  const admin2Usable = !!admin2 && !REGION_NAME_RE.test(admin2) && !/\bcity\b/i.test(admin2);
  let province = admin2Usable ? admin2 : '';
  if (!province && inCebu) province = 'Cebu';
  if (REGION_NAME_RE.test(province)) province = '';

  const isAddressResult = (r: any) => hasType(r, ['street_address', 'premise', 'subpremise']);
  const streetCandidates = [
    ...results.filter(isAddressResult),
    ...results.filter((r) => !isAddressResult(r) && hasType(r, ['route'])),
  ];
  const streetResult =
    streetCandidates.find((r) => {
      const loc = compOf(r, ['locality']);
      return !loc || normKey(loc) === cityKey;
    }) || streetCandidates[0];

  const streetNumber = compOf(streetResult, ['street_number']);
  const route = compOf(streetResult, ['route']);
  const premise = compOf(streetResult, ['premise']);
  const street = (route ? [streetNumber, route].filter(Boolean).join(' ') : premise).trim();

  const zipCode =
    (inCebu && CEBU_ZIP_FALLBACK[city.toLowerCase()]) ||
    compOf(streetResult, ['postal_code']) ||
    compOf(areaResult, ['postal_code']) ||
    '';

  return {
    street: street || 'Not identified',
    barangay: barangay || 'Not identified',
    city: city || 'Not identified',
    province: province || 'Not identified',
    zip_code: zipCode,
    formatted: [street, barangay ? `Brgy. ${barangay}` : '', city, province, zipCode]
      .filter(Boolean)
      .join(', '),
  };
};

const fetchGoogleAddress = async (
  coords: LatLng,
  signal: AbortSignal,
): Promise<ResolvedAddress> => {
  if (!HAS_GOOGLE_KEY) throw new Error('Google Maps API key is missing.');
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` +
    `&key=${GOOGLE_MAPS_API_KEY}&language=en&region=ph`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geocoder HTTP error: ${res.status}`);
  const json: any = await res.json();
  if (json.status !== 'OK' || !Array.isArray(json.results) || !json.results.length) {
    throw new Error(`Google Geocoder failed: ${json.status || 'No results'}`);
  }
  return parseGoogleAddress(json.results, coords);
};

const getAccurateFix = async (): Promise<Location.LocationObject> => {
  const cached = await Location.getLastKnownPositionAsync({
    maxAge: 30000,
    requiredAccuracy: GPS_CACHED_MAX_ACCURACY_M,
  });
  if (cached) return cached;

  return new Promise<Location.LocationObject>((resolve, reject) => {
    const startedAt = Date.now();
    let best: Location.LocationObject | null = null;
    let sub: Location.LocationSubscription | null = null;
    let settled = false;

    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      sub?.remove();
      if (best) resolve(best);
      else reject(err ?? new Error('No GPS fix'));
    };
    const hardTimer = setTimeout(() => finish(), GPS_MAX_WAIT_MS);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 500, distanceInterval: 0 },
      (loc) => {
        const acc = loc.coords.accuracy ?? Infinity;
        if (!best || acc < (best.coords.accuracy ?? Infinity)) best = loc;
        const bestAcc = best.coords.accuracy ?? Infinity;
        const elapsed = Date.now() - startedAt;
        if (acc <= GPS_GOOD_ENOUGH_M || (elapsed >= GPS_SOFT_WAIT_MS && bestAcc <= GPS_ACCEPTABLE_M)) {
          finish();
        }
      },
    )
      .then((s) => {
        sub = s;
        if (settled) s.remove();
      })
      .catch((e) => finish(e));
  });
};

const friendlyAuthError = (err: any): string => {
  const raw = String(err?.message || '');
  let friendly = raw || 'Something went wrong.';
  if (err?.status === 429 || /rate limit|too many|only request this once|security purposes/i.test(raw)) {
    friendly = 'Too many verification emails were requested. Please wait a few minutes and try again.';
  } else if (/not authorized|sending (confirmation|email|magic)|smtp|unable to send/i.test(raw)) {
    friendly = "We couldn't send the verification email right now. Please check your email address and try again shortly.";
  }
  return __DEV__ && friendly !== raw ? `${friendly}\n\n[dev] ${raw}` : friendly;
};

export default function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [phase, setPhase] = useState<'form' | 'otp' | 'success'>('form');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [isGpsMatched, setIsGpsMatched] = useState(false);

  const [structuredAddress, setStructuredAddress] = useState({
    street: '', barangay: '', city: '', province: '', zip_code: '',
  });

  const [isMapVisible, setIsMapVisible] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [mapCenter, setMapCenter] = useState<LatLng>({ lat: 10.3157, lng: 123.8854 });
  const [deviceGps, setDeviceGps] = useState<LatLng | null>(null);
  const [livePreviewAddress, setLivePreviewAddress] = useState({
    street: 'Locating street...',
    barangay: '...',
    city: 'Cebu City',
    province: 'Cebu',
    zip_code: '6000',
    formatted: 'Fetching exact address details...',
  });

  const mapRef = useRef<MapView>(null);
  const geocodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [fadeAnim, glowAnim]);

  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [phase, fadeAnim]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const validateName = (name: string, field: string) => {
    if (!name) return `${field} is required`;
    if (name.length < 2) return `${field} must be at least 2 characters`;
    return '';
  };
  const validatePhone = (phone: string) => {
    if (!phone) return 'Phone number is required';
    const phoneRegex = /^(09|\+639)\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) return 'Enter a valid PH number (e.g., 09XXXXXXXXX)';
    return '';
  };
  const validateEmail = (email: string) => {
    if (!email) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Enter a valid email address';
    return '';
  };
  const validateAddress = (addr: string) => {
    if (!addr) return 'Please select your home address on the map';
    return '';
  };
  const validatePassword = (password: string) => {
    if (!password) return 'Password is required';
    if (password.length < 8) return 'At least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Include at least 1 uppercase letter';
    if (!/[a-z]/.test(password)) return 'Include at least 1 lowercase letter';
    if (!/[0-9]/.test(password)) return 'Include at least 1 number';
    if (!/[!@#$%^&*]/.test(password)) return 'Include at least 1 special character (!@#$%^&*)';
    return '';
  };
  const validateConfirmPassword = (password: string, confirm: string) => {
    if (!confirm) return 'Please confirm your password';
    if (password !== confirm) return 'Passwords do not match';
    return '';
  };

  const geocodeCache = useRef<Map<string, ResolvedAddress>>(new Map());
  const geocodeRequestIdRef = useRef(0);
  const lastResolvedCoordsRef = useRef<LatLng | null>(null);
  const inFlightRef = useRef<{ coords: LatLng; promise: Promise<ResolvedAddress> } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const locatingRef = useRef(false);
  const prefetchedFixRef = useRef<{ coords: LatLng; at: number } | null>(null);

  const findReusableAddress = useCallback((coords: LatLng): ResolvedAddress | null => {
    let best: ResolvedAddress | null = null;
    let bestDist = ADDRESS_REUSE_RADIUS_M;
    for (const [key, value] of geocodeCache.current.entries()) {
      const [cLat, cLng] = key.split(',').map(Number);
      if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
      const d = metersBetween({ lat: cLat, lng: cLng }, coords);
      if (d < bestDist) {
        best = value;
        bestDist = d;
      }
    }
    return best;
  }, []);

  const rememberAddress = useCallback((coords: LatLng, value: ResolvedAddress) => {
    geocodeCache.current.set(`${coords.lat},${coords.lng}`, value);
    if (geocodeCache.current.size > 40) {
      const oldest = geocodeCache.current.keys().next().value;
      if (oldest) geocodeCache.current.delete(oldest);
    }
  }, []);

  const resolveFullAddressAtCoords = useCallback(
    async (coords: LatLng): Promise<ResolvedAddress> => {
      const reusable = findReusableAddress(coords);
      if (reusable) {
        geocodeRequestIdRef.current += 1;
        abortRef.current?.abort();
        inFlightRef.current = null;
        setLivePreviewAddress(reusable);
        setIsGeocoding(false);
        return reusable;
      }

      const pending = inFlightRef.current;
      if (pending && metersBetween(pending.coords, coords) < ADDRESS_REUSE_RADIUS_M) {
        return pending.promise;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = ++geocodeRequestIdRef.current;
      setIsGeocoding(true);

      const promise: Promise<ResolvedAddress> = (async () => {
        const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
        try {
          const result = await fetchGoogleAddress(coords, controller.signal);
          rememberAddress(coords, result);
          if (requestId === geocodeRequestIdRef.current) {
            lastResolvedCoordsRef.current = coords;
            setLivePreviewAddress(result);
          }
          return result;
        } catch (err) {
          if (requestId === geocodeRequestIdRef.current) {
            console.warn('Geocode error:', err);
            setLivePreviewAddress(UNRESOLVED_ADDRESS);
          }
          return UNRESOLVED_ADDRESS;
        } finally {
          clearTimeout(timer);
          if (requestId === geocodeRequestIdRef.current) setIsGeocoding(false);
          if (inFlightRef.current?.coords === coords) inFlightRef.current = null;
        }
      })();

      inFlightRef.current = { coords, promise };
      return promise;
    },
    [findReusableAddress, rememberAddress],
  );

  const scheduleGeocode = useCallback(
    (coords: LatLng) => {
      if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
      const pending = inFlightRef.current;
      if (
        findReusableAddress(coords) ||
        (pending && metersBetween(pending.coords, coords) < ADDRESS_REUSE_RADIUS_M)
      ) {
        resolveFullAddressAtCoords(coords);
        return;
      }
      setIsGeocoding(true);
      geocodeTimeoutRef.current = setTimeout(() => {
        resolveFullAddressAtCoords(coords);
      }, GEOCODE_DEBOUNCE_MS);
    },
    [findReusableAddress, resolveFullAddressAtCoords],
  );

  useEffect(
    () => () => {
      if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch('https://maps.googleapis.com/', { method: 'HEAD' }).catch(() => {});
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await getAccurateFix();
        if (cancelled) return;
        const coords: LatLng = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        prefetchedFixRef.current = { coords, at: Date.now() };
        resolveFullAddressAtCoords(coords);
      } catch {
        // warm-up is best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveFullAddressAtCoords]);

  const handleLocateMe = useCallback(async () => {
    locatingRef.current = true;
    setIsLocatingGps(true);
    setShowConfirmSheet(false);
    try {
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        ({ status } = await Location.requestForegroundPermissionsAsync());
      }
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location permission is needed to find your current address.');
        return;
      }

      let loc: Location.LocationObject | null = null;
      try {
        loc = await getAccurateFix();
      } catch {
        loc = await Location.getLastKnownPositionAsync();
      }
      if (!loc) throw new Error('No GPS fix');

      const currentCoords: LatLng = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
      };

      setDeviceGps(currentCoords);
      setMapCenter(currentCoords);

      mapRef.current?.animateToRegion(
        {
          latitude: currentCoords.lat,
          longitude: currentCoords.lng,
          latitudeDelta: 0.0028,
          longitudeDelta: 0.0028,
        },
        400,
      );

      await resolveFullAddressAtCoords(currentCoords);
    } catch {
      Alert.alert('Error', 'Could not fetch your current GPS location.');
    } finally {
      locatingRef.current = false;
      setIsLocatingGps(false);
    }
  }, [resolveFullAddressAtCoords]);

  const handleOpenMapModal = async () => {
    Keyboard.dismiss();
    setShowConfirmSheet(false);
    setIsMapVisible(true);

    if (lat !== null && lng !== null) {
      const savedPin = { lat, lng };
      const savedAddress: ResolvedAddress = { ...structuredAddress, formatted: address };
      rememberAddress(savedPin, savedAddress);
      lastResolvedCoordsRef.current = savedPin;
      setLivePreviewAddress(savedAddress);
      setIsGeocoding(false);
      setMapCenter(savedPin);
      setTimeout(() => {
        mapRef.current?.animateToRegion(
          {
            latitude: savedPin.lat,
            longitude: savedPin.lng,
            latitudeDelta: 0.0028,
            longitudeDelta: 0.0028,
          },
          250,
        );
      }, 100);
      return;
    }

    const warm = prefetchedFixRef.current;
    if (warm && Date.now() - warm.at < PREFETCH_MAX_AGE_MS) {
      setDeviceGps(warm.coords);
      setMapCenter(warm.coords);
      resolveFullAddressAtCoords(warm.coords);
      return;
    }

    await handleLocateMe();
  };

  const livePinDistanceM = useMemo(() => {
    if (!deviceGps) return null;
    return metersBetween(deviceGps, mapCenter);
  }, [deviceGps, mapCenter]);

  const isPinAtCurrentGps =
    livePinDistanceM !== null && livePinDistanceM <= GPS_MATCH_RADIUS_M;

  const applyConfirmedLocation = (
    resolved: {
      street: string; barangay: string; city: string;
      province: string; zip_code: string; formatted: string;
    },
    gpsMatched: boolean,
  ) => {
    setStructuredAddress({
      street: resolved.street,
      barangay: resolved.barangay,
      city: resolved.city,
      province: resolved.province,
      zip_code: resolved.zip_code,
    });
    setAddress(resolved.formatted);
    setLat(mapCenter.lat);
    setLng(mapCenter.lng);
    setIsGpsMatched(gpsMatched);
    setAddressError('');
    setShowConfirmSheet(false);
    setIsMapVisible(false);
  };

  const handlePressConfirmBtn = async () => {
    if (geocodeTimeoutRef.current) clearTimeout(geocodeTimeoutRef.current);
    const resolved = await resolveFullAddressAtCoords(mapCenter);
    const dist = deviceGps ? metersBetween(deviceGps, mapCenter) : null;

    if (dist === null || dist <= GPS_MATCH_RADIUS_M) {
      applyConfirmedLocation(resolved, true);
      return;
    }

    setShowConfirmSheet(true);
  };

  const dupCheckCache = useRef<Map<string, { at: number; promise: Promise<boolean> }>>(new Map());
  const phoneRef = useRef('');
  const emailRef = useRef('');
  phoneRef.current = phone;
  emailRef.current = email;

  const checkTaken = useCallback((column: 'phone_number' | 'email', value: string): Promise<boolean> => {
    const key = `${column}:${value}`;
    const hit = dupCheckCache.current.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.promise;
    const promise = (async () => {
      const { data } = await supabase.from('users').select('user_id').eq(column, value).maybeSingle();
      return !!data;
    })().catch(() => {
      dupCheckCache.current.delete(key);
      return false;
    });
    dupCheckCache.current.set(key, { at: Date.now(), promise });
    return promise;
  }, []);

  const pendingFinalizeRef = useRef<Promise<void> | null>(null);
  const profileLinkRef = useRef<{ authUserId: string; update: Record<string, unknown> } | null>(null);

  const handleSignUp = async () => {
    const firstNameValidation = validateName(firstName, 'First name');
    const lastNameValidation = validateName(lastName, 'Last name');
    const phoneValidation = validatePhone(phone);
    const emailValidation = validateEmail(email);
    const addressValidation = validateAddress(address);
    const passwordValidation = validatePassword(password);
    const confirmValidation = validateConfirmPassword(password, confirmPassword);

    if (firstNameValidation) { setFirstNameError(firstNameValidation); return; }
    if (lastNameValidation) { setLastNameError(lastNameValidation); return; }
    if (phoneValidation) { setPhoneError(phoneValidation); return; }
    if (emailValidation) { setEmailError(emailValidation); return; }
    if (addressValidation) { setAddressError(addressValidation); return; }
    if (passwordValidation) { setPasswordError(passwordValidation); return; }
    if (confirmValidation) { setConfirmPasswordError(confirmValidation); return; }

    if (lat === null || lng === null) {
      Alert.alert('Location Required', 'Please select your home address on the map.');
      return;
    }

    setLoading(true);
    pendingFinalizeRef.current = null;
    profileLinkRef.current = null;
    const t0 = Date.now();
    const lap = (label: string) => {
      if (__DEV__) console.log(`[signup] ${label}: ${Date.now() - t0}ms`);
    };
    try {
      const cleanedPhone = phone.trim();
      const cleanedEmail = email.trim().toLowerCase();

      const [phoneTaken, emailTaken] = await Promise.all([
        checkTaken('phone_number', cleanedPhone),
        checkTaken('email', cleanedEmail),
      ]);
      if (phoneTaken) {
        setPhoneError('This phone number is already registered.');
        return;
      }
      if (emailTaken) {
        setEmailError('This email is already registered.');
        return;
      }
      lap('duplicate checks');

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: cleanedPhone,
            avatar_url: '',
          },
        },
      });
      lap('signUp (also sends the verification email)');

      if (signUpError) throw signUpError;
      if (!signUpData?.user) throw new Error('No user returned from Supabase Auth.');
      const authUserId = signUpData.user.id;
      const hasSession = !!signUpData.session;

      if (Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        setEmailError('This email is already registered.');
        return;
      }

      const finalizeProfile = async () => {
        if (!hasSession) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (signInError) console.warn('Could not sign in immediately after signup.');
        }

        const uploadAvatarPromise = (async () => {
          if (!imageBase64) return '';
          try {
            const fileName = `${authUserId}_${Date.now()}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(fileName, decode(imageBase64), { contentType: 'image/jpeg', upsert: true });
            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
              return publicUrl;
            }
          } catch (uploadErr) {
            console.warn('Avatar upload failed:', uploadErr);
          }
          return '';
        })();

        const insertLocationPromise = (async () => {
          const { data: locData, error: locError } = await supabase
            .from('locations')
            .insert({
              street_address: structuredAddress.street || address,
              barangay: structuredAddress.barangay,
              city: structuredAddress.city,
              province: structuredAddress.province,
              zip_code: structuredAddress.zip_code,
              latitude: lat,
              longitude: lng,
            })
            .select('location_id')
            .single();
          if (locError) throw locError;
          return locData.location_id;
        })();

        const [avatarUrl, locationId] = await Promise.all([uploadAvatarPromise, insertLocationPromise]);

        const authMetaPromise: Promise<unknown> = avatarUrl
          ? supabase.auth
              .updateUser({ data: { avatar_url: avatarUrl } })
              .catch((e: unknown) => console.warn('Avatar metadata update failed:', e))
          : Promise.resolve();

        const profileUpdate = { location_id: locationId, profile_photo: avatarUrl || null };
        const deadline = Date.now() + 2500;
        let profileLinked = false;
        while (!profileLinked && Date.now() < deadline) {
          const { data: updatedRows, error: userError } = await supabase
            .from('users')
            .update(profileUpdate)
            .eq('auth_id', authUserId)
            .select('user_id');
          if (userError) {
            console.error('User Update Error:', userError);
            throw userError;
          }
          if (updatedRows && updatedRows.length > 0) profileLinked = true;
          else await new Promise((resolve) => setTimeout(resolve, 80));
        }
        if (!profileLinked) {
          console.warn('users row not updatable before verification; will retry after the code is accepted.');
          profileLinkRef.current = { authUserId, update: profileUpdate };
        }

        await authMetaPromise;
        await supabase.auth.signOut({ scope: 'local' });
      };

      pendingFinalizeRef.current = finalizeProfile().then(
        () => lap('address, photo and profile saved (background)'),
        (e: unknown) => {
          console.error('Profile save failed after signup:', e);
          Alert.alert(
            'Account created',
            "Your account was created, but we couldn't save your home address or photo. Please check them after you sign in.",
          );
        },
      );

      if (hasSession) {
        console.warn(
          '[signup] signUp returned a session: email confirmation is OFF on this Supabase project, so no code was sent. ' +
            'Turn on "Confirm email" (Authentication > Providers > Email) to send codes.',
        );
        await pendingFinalizeRef.current;
        Alert.alert(
          'Account created',
          'Email verification is switched off on the server, so no code was sent. You can log in now.',
          [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }],
        );
        return;
      }

      setSentTo(cleanedEmail);
      setPhase('otp');
      setCooldown(COOLDOWN_SECONDS);
      lap('verification screen shown');
    } catch (error: any) {
      console.error('SIGNUP FATAL ERROR:', error);
      dupCheckCache.current.clear();
      Alert.alert('Signup Failed', friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code sent to your email.');
      return;
    }

    setVerifyingOtp(true);
    try {
      await pendingFinalizeRef.current;

      const { error } = await supabase.auth.verifyOtp({
        email: sentTo,
        token: otpCode.trim(),
        type: 'signup',
      });

      if (error) throw error;

      const pendingLink = profileLinkRef.current;
      if (pendingLink) {
        profileLinkRef.current = null;
        const { error: linkError } = await supabase
          .from('users')
          .update(pendingLink.update)
          .eq('auth_id', pendingLink.authUserId);
        if (linkError) console.warn('Could not link profile after verification:', linkError);
      }

      await supabase.auth.signOut({ scope: 'local' });
      setPhase('success');

      setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }, 1000);
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'The code is invalid or has expired.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: sentTo,
      });
      if (error) throw error;
      setCooldown(COOLDOWN_SECONDS);
      Alert.alert('Code Sent', 'A new 6-digit code has been sent to your email.');
    } catch (err: any) {
      console.error('RESEND ERROR:', err);
      Alert.alert('Error', friendlyAuthError(err) || 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  const glowScale = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const fadeUpStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity style={[styles.themeToggle, { top: insets.top + 12 }]} onPress={toggleDark} activeOpacity={0.85}>
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.textPrimary} />
      </TouchableOpacity>

      {!isMapVisible && (
        <View style={styles.backgroundLayer} pointerEvents="none">
          <Animated.View style={[styles.glow, styles.glowTop, { transform: [{ scale: glowScale }], opacity: glowOpacity }]} />
          <View style={[styles.glow, styles.glowBottom]} />
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoid}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.contentWrapper, fadeUpStyle]}>
              {phase === 'success' ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="checkmark-circle" size={72} color={ORANGE} />
                  <Text style={[styles.header, { marginTop: 16 }]}>Email Verified!</Text>
                  <Text style={styles.subHeader}>Taking you to the login screen…</Text>
                </View>
              ) : phase === 'otp' ? (
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Ionicons name="shield-checkmark-outline" size={36} color={ORANGE} />
                    </View>
                    <Text style={styles.header}>Verify your email</Text>
                    <Text style={styles.subHeader}>
                      We sent a 6-digit code to{'\n'}
                      <Text style={styles.emailHighlight}>{sentTo}</Text>
                    </Text>
                  </View>

                  <View style={styles.formContainer}>
                    <View
                      style={[
                        styles.inputWrapper,
                        { height: 64, marginBottom: 20 },
                        focusedInput === 'otp' && styles.inputFocused,
                      ]}
                    >
                      <Ionicons
                        name="keypad-outline"
                        size={24}
                        color={focusedInput === 'otp' ? ORANGE : colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={[styles.input, { fontSize: 24, letterSpacing: 6, fontFamily: 'Poppins_700Bold' }]}
                        placeholder="000000"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        maxLength={6}
                        value={otpCode}
                        onChangeText={setOtpCode}
                        onFocus={() => setFocusedInput('otp')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.button, (verifyingOtp || otpCode.length < 6) && styles.buttonDisabled]}
                    onPress={handleVerifyOtp}
                    disabled={verifyingOtp || otpCode.length < 6}
                    activeOpacity={0.8}
                  >
                    {verifyingOtp ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.buttonText}>Verify Account</Text>}
                  </TouchableOpacity>

                  <View style={styles.linkContainer}>
                    <Text style={styles.link}>Didn't receive it? </Text>
                    <TouchableOpacity onPress={handleResendOtp} disabled={cooldown > 0 || loading}>
                      <Text style={[styles.linkBold, { color: cooldown > 0 ? colors.textMuted : ORANGE }]}>
                        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity onPress={() => setPhase('form')} style={{ marginTop: 24, alignItems: 'center' }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, fontFamily: 'Poppins_400Regular', textDecorationLine: 'underline' }}>
                      Entered the wrong email? Go back
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Image source={require('../../../assets/appiconfinal2.png')} style={styles.logoImage} resizeMode="contain" />
                      <Text style={styles.brandText}>
                        Pack-<Text style={styles.brandTextOrange}>N-Ship</Text>
                      </Text>
                    </View>
                    <Text style={styles.header}>Create Account</Text>
                    <Text style={styles.subHeader}>Start shipping your packages securely today.</Text>
                  </View>

                  <View style={styles.imageUploadSection}>
                    <TouchableOpacity
                      style={styles.imagePicker}
                      onPress={async () => {
                        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                        if (status !== 'granted') return;
                        const res = await ImagePicker.launchImageLibraryAsync({
                          mediaTypes: ['images'],
                          allowsEditing: true,
                          aspect: [1, 1],
                          quality: 0.4,
                          exif: false,
                          base64: true,
                        });
                        if (!res.canceled && res.assets.length > 0) {
                          setImageUri(res.assets[0].uri);
                          setImageBase64(res.assets[0].base64 || null);
                        }
                      }}
                    >
                      {imageUri ? (
                        <Image source={{ uri: imageUri }} style={styles.profilePreview} />
                      ) : (
                        <View style={styles.imagePlaceholder}>
                          <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={styles.uploadBadge}>
                        <Ionicons name="add" size={14} color="#FFF" />
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.formContainer}>
                    <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, firstNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'firstName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="First Name"
                        placeholderTextColor={colors.textMuted}
                        value={firstName}
                        onChangeText={(t) => {
                          setFirstName(t);
                          setFirstNameError(validateName(t, 'First name'));
                        }}
                        onFocus={() => setFocusedInput('firstName')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                    {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputFocused, lastNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'lastName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Last Name"
                        placeholderTextColor={colors.textMuted}
                        value={lastName}
                        onChangeText={(t) => {
                          setLastName(t);
                          setLastNameError(validateName(t, 'Last name'));
                        }}
                        onFocus={() => setFocusedInput('lastName')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                    {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputFocused, phoneError && styles.inputError]}>
                      <Ionicons name="call-outline" size={20} color={focusedInput === 'phone' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Phone Number (e.g., 09123456789)"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        value={phone}
                        onChangeText={(t) => {
                          const c = t.replace(/[^0-9+]/g, '');
                          setPhone(c);
                          setPhoneError(validatePhone(c));
                        }}
                        onFocus={() => setFocusedInput('phone')}
                        onBlur={() => {
                          setFocusedInput(null);
                          const v = phone.trim();
                          if (!validatePhone(v)) {
                            checkTaken('phone_number', v).then((taken) => {
                              if (taken && phoneRef.current.trim() === v) {
                                setPhoneError('This phone number is already registered.');
                              }
                            });
                          }
                        }}
                      />
                    </View>
                    {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'email' && styles.inputFocused, emailError && styles.inputError]}>
                      <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Email Address"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={email}
                        onChangeText={(t) => {
                          setEmail(t);
                          setEmailError(validateEmail(t));
                        }}
                        onFocus={() => setFocusedInput('email')}
                        onBlur={() => {
                          setFocusedInput(null);
                          const v = email.trim().toLowerCase();
                          if (!validateEmail(email.trim())) {
                            checkTaken('email', v).then((taken) => {
                              if (taken && emailRef.current.trim().toLowerCase() === v) {
                                setEmailError('This email is already registered.');
                              }
                            });
                          }
                        }}
                      />
                    </View>
                    {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                    <TouchableOpacity
                      style={[
                        styles.addressCardTrigger,
                        addressError && styles.inputError,
                        address && isGpsMatched && { borderColor: GREEN },
                      ]}
                      onPress={handleOpenMapModal}
                      activeOpacity={0.8}
                    >
                      <View style={styles.addressHeaderRow}>
                        <View style={styles.addressIconBadge}>
                          <Ionicons name="home" size={18} color={address && isGpsMatched ? GREEN : ORANGE} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.addressFieldLabel}>
                            {address ? 'HOME ADDRESS' : 'SELECT HOME ADDRESS'}
                          </Text>
                          <Text
                            style={[
                              styles.addressMainText,
                              { color: address ? colors.textPrimary : colors.textMuted },
                            ]}
                            numberOfLines={2}
                          >
                            {address || 'Tap to auto-locate your current address on map'}
                          </Text>
                        </View>
                        <View style={styles.changePinPill}>
                          <Ionicons name="locate" size={13} color={ORANGE} />
                          <Text style={styles.changePinText}>{address ? 'Edit' : 'Map'}</Text>
                        </View>
                      </View>

                      {address ? (
                        <>
                          <View style={styles.structuredPillsWrap}>
                            <View style={styles.miniTag}>
                              <Text style={styles.miniTagText}>Brgy. {structuredAddress.barangay}</Text>
                            </View>
                            <View style={styles.miniTag}>
                              <Text style={styles.miniTagText}>{structuredAddress.city}</Text>
                            </View>
                            <View style={styles.miniTag}>
                              <Text style={styles.miniTagText}>{structuredAddress.province}</Text>
                            </View>
                            <View style={styles.miniTag}>
                              <Text style={styles.miniTagText}>ZIP {structuredAddress.zip_code}</Text>
                            </View>
                          </View>

                          <View
                            style={[
                              styles.verificationBadgeRow,
                              {
                                backgroundColor: isGpsMatched
                                  ? 'rgba(22,163,74,0.12)'
                                  : 'rgba(242,112,36,0.12)',
                              },
                            ]}
                          >
                            <Ionicons
                              name={isGpsMatched ? 'shield-checkmark' : 'location'}
                              size={15}
                              color={isGpsMatched ? GREEN : ORANGE}
                            />
                            <Text
                              style={[
                                styles.verificationBadgeText,
                                { color: isGpsMatched ? GREEN : ORANGE },
                              ]}
                            >
                              {isGpsMatched
                                ? 'GPS Verified • Exact Current Location'
                                : `Map Pin Confirmed (${lat?.toFixed(4)}, ${lng?.toFixed(4)})`}
                            </Text>
                          </View>
                        </>
                      ) : null}
                    </TouchableOpacity>
                    {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={(t) => {
                          setPassword(t);
                          setPasswordError(validatePassword(t));
                          if (confirmPassword) setConfirmPasswordError(validateConfirmPassword(t, confirmPassword));
                        }}
                        onFocus={() => setFocusedInput('password')}
                        onBlur={() => setFocusedInput(null)}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'confirmPassword' && styles.inputFocused, confirmPasswordError && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'confirmPassword' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Confirm Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showConfirmPassword}
                        value={confirmPassword}
                        onChangeText={(t) => {
                          setConfirmPassword(t);
                          setConfirmPasswordError(validateConfirmPassword(password, t));
                        }}
                        onFocus={() => setFocusedInput('confirmPassword')}
                        onBlur={() => setFocusedInput(null)}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                        <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
                  </View>

                  <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignUp} disabled={loading}>
                    {loading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator color="#FFFFFF" size="small" />
                        <Text style={styles.buttonText}>Sending your code…</Text>
                      </View>
                    ) : (
                      <Text style={styles.buttonText}>Create Account</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkContainer}>
                    <Text style={styles.link}>
                      Already have an account? <Text style={styles.linkBold}>Log In</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </Animated.View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* --- MAP & CONFIRM HOME ADDRESS MODAL --- */}
      <Modal visible={isMapVisible} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            googleMapId={GOOGLE_MAP_ID}
            userInterfaceStyle="light"
            initialRegion={{
              latitude: mapCenter.lat,
              longitude: mapCenter.lng,
              latitudeDelta: 0.0028,
              longitudeDelta: 0.0028,
            }}
            onRegionChangeComplete={(region) => {
              const nextCenter = { lat: region.latitude, lng: region.longitude };
              setMapCenter(nextCenter);
              if (!locatingRef.current) scheduleGeocode(nextCenter);
            }}
            pitchEnabled={false}
            rotateEnabled={false}
            showsBuildings={false}
            showsTraffic={false}
            showsIndoors={false}
            minZoomLevel={12}
            showsUserLocation={true}
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
          >
            {deviceGps && (
              <Circle
                center={{ latitude: deviceGps.lat, longitude: deviceGps.lng }}
                radius={GPS_MATCH_RADIUS_M}
                strokeColor={GREEN}
                strokeWidth={2}
                fillColor="rgba(22, 163, 74, 0.12)"
              />
            )}
          </MapView>

          <View style={styles.mapPinContainer} pointerEvents="none">
            <View style={[styles.pinFloatingPill, isPinAtCurrentGps && { backgroundColor: GREEN }]}>
              <Text style={styles.pinFloatingText}>
                {isGeocoding ? 'Locating...' : isPinAtCurrentGps ? 'Exact GPS Spot' : 'Home Pin'}
              </Text>
            </View>
            <View style={[styles.mapPinHead, isPinAtCurrentGps && { backgroundColor: GREEN }]}>
              <Ionicons name="home" size={21} color="#FFFFFF" />
            </View>
            <View style={[styles.mapPinPoint, isPinAtCurrentGps && { borderTopColor: GREEN }]} />
            <View style={styles.mapPinShadow} />
          </View>

          <View style={[styles.mapTopOverlay, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={styles.mapBackBtn} onPress={() => setIsMapVisible(false)} activeOpacity={0.85}>
              <Ionicons name="arrow-back" size={22} color="#111827" />
            </TouchableOpacity>

            <View style={styles.mapStatusPill}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isLocatingGps ? ORANGE : isPinAtCurrentGps ? GREEN : AMBER },
                ]}
              />
              <Text style={styles.mapInstructionText} numberOfLines={1}>
                {isLocatingGps
                  ? 'Finding your current location...'
                  : isPinAtCurrentGps
                    ? 'Within your live GPS zone'
                    : livePinDistanceM !== null
                      ? `${formatDistance(livePinDistanceM)} from your current GPS`
                      : 'Drag map to position pin'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.mapLocateBtn, { bottom: insets.bottom + 278 }]}
            onPress={handleLocateMe}
            disabled={isLocatingGps}
            activeOpacity={0.85}
          >
            {isLocatingGps ? (
              <ActivityIndicator size="small" color={ORANGE} />
            ) : (
              <Ionicons name="locate" size={22} color={ORANGE} />
            )}
          </TouchableOpacity>

          <View style={[styles.mapBottomSheet, { paddingBottom: Math.max(insets.bottom + 14, 20) }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetIconBox}>
                <Ionicons
                  name={isPinAtCurrentGps ? 'shield-checkmark' : 'location'}
                  size={22}
                  color={isPinAtCurrentGps ? GREEN : ORANGE}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.sheetOverline}>PINNED HOME ADDRESS</Text>
                  {isGeocoding && <ActivityIndicator size="small" color={ORANGE} style={{ transform: [{ scale: 0.75 }] }} />}
                </View>
                <Text style={styles.sheetFullAddress} numberOfLines={2}>
                  {livePreviewAddress.formatted}
                </Text>
              </View>
            </View>

            <View style={styles.sheetBreakdownGrid}>
              <View style={styles.sheetGridItem}>
                <Text style={styles.sheetGridLabel}>STREET / ROAD</Text>
                <Text style={styles.sheetGridValue} numberOfLines={1}>
                  {livePreviewAddress.street}
                </Text>
              </View>
              <View style={styles.sheetGridItem}>
                <Text style={styles.sheetGridLabel}>BARANGAY</Text>
                <Text style={styles.sheetGridValue} numberOfLines={1}>
                  Brgy. {livePreviewAddress.barangay}
                </Text>
              </View>
              <View style={styles.sheetGridItem}>
                <Text style={styles.sheetGridLabel}>CITY / MUNICIPALITY</Text>
                <Text style={styles.sheetGridValue} numberOfLines={1}>
                  {livePreviewAddress.city}
                </Text>
              </View>
              <View style={styles.sheetGridItem}>
                <Text style={styles.sheetGridLabel}>PROVINCE & ZIP</Text>
                <Text style={styles.sheetGridValue} numberOfLines={1}>
                  {livePreviewAddress.province} • {livePreviewAddress.zip_code}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.mapConfirmBtn,
                isPinAtCurrentGps && { backgroundColor: GREEN, shadowColor: GREEN },
                isGeocoding && { opacity: 0.65 },
              ]}
              onPress={handlePressConfirmBtn}
              disabled={isGeocoding}
              activeOpacity={0.88}
            >
              {isGeocoding ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons
                    name={isPinAtCurrentGps ? 'shield-checkmark' : 'checkmark-circle'}
                    size={20}
                    color="#FFF"
                  />
                  <Text style={styles.mapConfirmText}>
                    {isPinAtCurrentGps ? 'Confirm GPS-Matched Home' : 'Confirm Home Address'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {showConfirmSheet && (
            <View style={styles.verifyOverlay}>
              <View style={styles.verifyModalCard}>
                <View style={styles.verifyIconCircle}>
                  <Ionicons name="navigate-circle" size={34} color={ORANGE} />
                </View>

                <Text style={styles.verifyModalTitle}>Confirm Home Location?</Text>
                <Text style={styles.verifyModalSub}>
                  This pin is{' '}
                  <Text style={{ fontFamily: 'Poppins_700Bold', color: '#111827' }}>
                    {livePinDistanceM !== null ? formatDistance(livePinDistanceM) : 'away'}
                  </Text>{' '}
                  from your phone's current GPS position.
                </Text>

                <View style={styles.verifyAddressBox}>
                  <Ionicons name="home" size={18} color={ORANGE} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.verifyAddressTitle}>{livePreviewAddress.street}</Text>
                    <Text style={styles.verifyAddressSub}>
                      Brgy. {livePreviewAddress.barangay}, {livePreviewAddress.city}, {livePreviewAddress.province}{' '}
                      {livePreviewAddress.zip_code}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.verifyPrimaryBtn}
                  onPress={() => applyConfirmedLocation(livePreviewAddress, false)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-circle" size={19} color="#FFF" />
                  <Text style={styles.verifyPrimaryBtnText}>Yes, Use This Home Address</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.verifySecondaryBtn}
                  onPress={handleLocateMe}
                  activeOpacity={0.8}
                >
                  <Ionicons name="locate" size={18} color={ORANGE} />
                  <Text style={styles.verifySecondaryBtnText}>Snap Back to My Current GPS</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    keyboardAvoid: { flex: 1 },
    themeToggle: {
      position: 'absolute', right: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20,
      backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 6, elevation: 3,
    },

    backgroundLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden' },
    glow: { position: 'absolute', borderRadius: 999, backgroundColor: ORANGE },
    glowTop: { width: 360, height: 360, top: -160, right: -140 },
    glowBottom: { width: 300, height: 300, bottom: -140, left: -120, opacity: 0.05 },

    innerContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
    contentWrapper: { flex: 1, justifyContent: 'center' },
    centerBlock: { alignItems: 'center', justifyContent: 'center' },

    headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
    brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
    logoImage: { width: 64, height: 64 },
    brandText: { fontSize: 25, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3, marginLeft: -12 },
    brandTextOrange: { color: ORANGE },
    header: { fontSize: 28, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
    subHeader: { fontSize: 15, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 22 },
    emailHighlight: { color: c.textPrimary, fontFamily: 'Poppins_600SemiBold' },

    imageUploadSection: { alignItems: 'center', marginBottom: 20 },
    imagePicker: {
      width: 76, height: 76, borderRadius: 38, backgroundColor: c.card,
      justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border, position: 'relative',
    },
    imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
    profilePreview: { width: 76, height: 76, borderRadius: 38 },
    uploadBadge: {
      position: 'absolute', bottom: 0, right: 0, backgroundColor: ORANGE,
      width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center',
      borderWidth: 2, borderColor: c.card,
    },

    formContainer: { marginBottom: 16 },
    inputWrapper: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border, borderRadius: 12, marginBottom: 12, height: 52,
    },
    inputIcon: { paddingLeft: 16, paddingRight: 8 },
    input: { flex: 1, height: '100%', fontSize: 15, fontFamily: 'Poppins_400Regular', color: c.textPrimary, paddingTop: 14 },
    inputFocused: { borderColor: ORANGE },
    inputError: { borderColor: c.error, backgroundColor: c.errorBg },
    eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
    errorText: { color: c.error, fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginTop: -8, marginBottom: 10, marginLeft: 4 },

    addressCardTrigger: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 14, padding: 14, marginBottom: 12,
    },
    addressHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    addressIconBadge: {
      width: 38, height: 38, borderRadius: 10,
      backgroundColor: 'rgba(242,112,36,0.12)', alignItems: 'center', justifyContent: 'center',
    },
    addressFieldLabel: {
      fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.6, marginBottom: 2,
    },
    addressMainText: {
      fontSize: 14, fontFamily: 'Poppins_600SemiBold', lineHeight: 19,
    },
    changePinPill: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: 'rgba(242,112,36,0.12)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
    },
    changePinText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: ORANGE },
    structuredPillsWrap: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12,
      paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border,
    },
    miniTag: {
      backgroundColor: c.background, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    },
    miniTagText: { fontSize: 11, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
    verificationBadgeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginTop: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    },
    verificationBadgeText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_700Bold' },

    button: {
      backgroundColor: ORANGE, height: 54, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20,
    },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', fontSize: 16 },

    linkContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
    link: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_400Regular' },
    linkBold: { color: ORANGE, fontFamily: 'Poppins_600SemiBold' },

    mapPinContainer: {
      position: 'absolute', top: '42%', left: '50%',
      marginLeft: -55, marginTop: -70, width: 110,
      alignItems: 'center', zIndex: 4,
    },
    pinFloatingPill: {
      backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 4,
      borderRadius: 999, marginBottom: 6,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
    },
    pinFloatingText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_700Bold', letterSpacing: 0.3 },
    mapPinHead: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 3, borderColor: '#FFFFFF',
      shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28, shadowRadius: 8, elevation: 8,
    },
    mapPinPoint: {
      width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid',
      borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
      borderLeftColor: 'transparent', borderRightColor: 'transparent',
      borderTopColor: ORANGE, marginTop: -1,
    },
    mapPinShadow: {
      width: 12, height: 4, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.28)', marginTop: 2,
    },

    mapTopOverlay: {
      position: 'absolute', top: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 10,
    },
    mapBackBtn: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF',
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 4,
    },
    mapStatusPill: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: '#FFF', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 22,
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 6, elevation: 4,
    },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    mapInstructionText: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#111827' },

    mapLocateBtn: {
      position: 'absolute', right: 18, width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF',
      justifyContent: 'center', alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 5,
    },

    mapBottomSheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: '#FFFFFF',
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      paddingHorizontal: 20, paddingTop: 10,
      shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 14,
    },
    sheetHandle: {
      width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB',
      alignSelf: 'center', marginBottom: 14,
    },
    sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
    sheetIconBox: {
      width: 46, height: 46, borderRadius: 14,
      backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FFEDD5',
      alignItems: 'center', justifyContent: 'center',
    },
    sheetOverline: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: '#6B7280', letterSpacing: 0.7 },
    sheetFullAddress: {
      fontSize: 15, fontFamily: 'Poppins_700Bold', color: '#111827', marginTop: 2, lineHeight: 20,
    },
    sheetBreakdownGrid: {
      flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
      gap: 8, marginBottom: 16,
    },
    sheetGridItem: {
      width: '48.5%', backgroundColor: '#F9FAFB', borderRadius: 10,
      paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#F3F4F6',
    },
    sheetGridLabel: { fontSize: 9, fontFamily: 'Poppins_700Bold', color: '#9CA3AF', letterSpacing: 0.5 },
    sheetGridValue: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: '#1F2937', marginTop: 2 },

    mapConfirmBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, gap: 8,
      shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 8, elevation: 5,
    },
    mapConfirmText: { color: '#FFF', fontSize: 16, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },

    verifyOverlay: {
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      backgroundColor: 'rgba(17, 24, 39, 0.55)',
      justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, zIndex: 30,
    },
    verifyModalCard: {
      width: '100%', backgroundColor: '#FFFFFF', borderRadius: 24,
      padding: 22, alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 16, elevation: 12,
    },
    verifyIconCircle: {
      width: 60, height: 60, borderRadius: 30,
      backgroundColor: 'rgba(242, 112, 36, 0.12)',
      alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    verifyModalTitle: { fontSize: 19, fontFamily: 'Poppins_700Bold', color: '#111827', marginBottom: 6 },
    verifyModalSub: {
      fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#6B7280', textAlign: 'center', lineHeight: 19, marginBottom: 16,
    },
    verifyAddressBox: {
      width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
      borderRadius: 14, padding: 12, marginBottom: 18,
    },
    verifyAddressTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: '#111827' },
    verifyAddressSub: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: '#4B5563', marginTop: 2, lineHeight: 17 },
    verifyPrimaryBtn: {
      width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: ORANGE, paddingVertical: 14, borderRadius: 14, marginBottom: 10,
    },
    verifyPrimaryBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
    verifySecondaryBtn: {
      width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: 'rgba(242, 112, 36, 0.1)', paddingVertical: 13, borderRadius: 14,
    },
    verifySecondaryBtnText: { color: ORANGE, fontSize: 14, fontFamily: 'Poppins_700Bold' },
  });