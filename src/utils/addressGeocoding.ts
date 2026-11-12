// src/utils/addressGeocoding.ts
//
// Pure geocoding + GPS helpers extracted from RegisterScreen.
// No React, no UI — just math + Google Geocoder + expo-location.
import * as Location from 'expo-location';
import Constants from 'expo-constants';

export const CEBU_ZIP_FALLBACK: Record<string, string> = {
  'cebu city': '6000', 'mandaue': '6014', 'mandaue city': '6014',
  'lapu-lapu': '6015', 'lapu-lapu city': '6015', 'talisay': '6045', 'talisay city': '6045',
  'consolacion': '6001', 'liloan': '6002', 'minglanilla': '6046', 'naga': '6037',
  'naga city': '6037', 'cordova': '6017',
};

const rawKey: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig as any)?.android?.config?.googleMaps?.apiKey ||
  (Constants.expoConfig as any)?.ios?.config?.googleMapsApiKey ||
  '';
export const GOOGLE_MAPS_API_KEY = rawKey;
export const HAS_GOOGLE_KEY = rawKey.length > 10;

export type LatLng = { lat: number; lng: number };
export type ResolvedAddress = {
  street: string; barangay: string; city: string;
  province: string; zip_code: string; formatted: string;
};

export const UNRESOLVED_ADDRESS: ResolvedAddress = {
  street: 'Not identified', barangay: 'Not identified', city: 'Not identified',
  province: 'Not identified', zip_code: '',
  formatted: 'Address details unavailable. Move the pin slightly or try again.',
};

export const metersBetween = (a: LatLng, b: LatLng): number => {
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

export const formatDistance = (m: number): string =>
  m < 1000 ? `${Math.max(1, Math.round(m))}m` : `${(m / 1000).toFixed(2)} km`;

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

export const parseGoogleAddress = (results: any[], coords: LatLng): ResolvedAddress => {
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

export const fetchGoogleAddress = async (
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

const GPS_CACHED_MAX_ACCURACY_M = 35;
const GPS_GOOD_ENOUGH_M = 25;
const GPS_ACCEPTABLE_M = 60;
const GPS_SOFT_WAIT_MS = 1500;
const GPS_MAX_WAIT_MS = 5000;

export const getAccurateFix = async (): Promise<Location.LocationObject> => {
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