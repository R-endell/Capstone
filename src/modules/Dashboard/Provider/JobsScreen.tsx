// src/modules/Dashboard/Provider/JobsScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, Switch,
  Platform, Modal, Alert, ActivityIndicator, ScrollView,
  Animated, Easing, Linking, StatusBar
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getActiveRouteId, setActiveRouteId } from '../../../services/activeRouteStore';
import { findMatches } from '../../../services/matchingService';

const ORANGE = '#FF751F';
const OFFER_SECONDS = 45;
const CARGO_PHOTO_BUCKET = 'cargo-photos';

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
  cargo_length_cm: number;
  cargo_width_cm: number;
  cargo_height_cm: number;
  verification_status: string;
}
interface Route {
  route_id: number;
  departure_time: string;
  route_frequency: string;
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
  items: JobItem[];
  totalItems: number;
  weightKg: number | null;
  fragile: boolean;
  dims: string | null;
  senderName: string;
  receiverName: string | null;
}

const toNaiveIsoString = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
};

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

const normalizeRequest = (r: any, senders: Record<number, string>): JobRequest => {
  const cargo = Array.isArray(r.cargo) ? r.cargo[0] : r.cargo;

  let itemsJson: any = cargo?.items_json;
  if (typeof itemsJson === 'string') {
    try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
  }

  const sizeCounts: [string, any][] = [
    ['Small', cargo?.small_box_qty], ['Medium', cargo?.medium_box_qty], ['Large', cargo?.large_box_qty],
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
      boxes: null,
    }));
    const fallbackPhoto = toPhotoUrl(cargo?.cargo_pic);
    if (fallbackPhoto && !items.some(i => i.photo)) items[0].photo = fallbackPhoto;
  } else {
    items = [{
      description: cargo?.description || 'Package',
      size: null,
      fragile: !!cargo?.is_fragile,
      photo: toPhotoUrl(cargo?.cargo_pic),
      boxes: boxes || null,
    }];
  }

  const d = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
  const dims = d.every(v => Number(v) > 0) ? `${d[0]} × ${d[1]} × ${d[2]} cm` : null;
  const pu = splitAddress(r.pickup_location?.street_address);
  const dr = splitAddress(r.dropoff_location?.street_address);

  return {
    request_id: r.request_id,
    pickup_type: r.pickup_type,
    scheduled_time: r.scheduled_time ?? null,
    created_at: r.created_at ?? null,
    estimated_cost: Number(r.estimated_cost) || 0,
    pickup: { ...pu, lat: r.pickup_location?.latitude ?? null, lng: r.pickup_location?.longitude ?? null },
    dropoff: { ...dr, lat: r.dropoff_location?.latitude ?? null, lng: r.dropoff_location?.longitude ?? null },
    items,
    totalItems: Array.isArray(itemsJson) && itemsJson.length > 0 ? itemsJson.length : (boxTotal || 1),
    weightKg: Number(cargo?.total_weight_kg) || null,
    fragile: items.some(i => i.fragile) || !!cargo?.is_fragile,
    dims,
    senderName: senders[r.sender_id] || 'Sender',
    receiverName: r.receiver?.receiver_name || [r.receiver?.first_name, r.receiver?.last_name].filter(Boolean).join(' ') || null,
  };
};

/* ==================================================================== */
/* RouteMap - OSRM road-following route (non-interactive preview)         */
/* ==================================================================== */
const RouteMap = ({ startLat, startLng, endLat, endLng, startLabel = 'S', endLabel = 'E' }: any) => {
  const lat = startLat ?? endLat ?? 10.3157;
  const lng = startLng ?? endLng ?? 123.8854;

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #EEF0F2; }
          .marker-start { background: #FF751F; border: 3px solid white; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; }
          .marker-end { background: #111827; border: 3px solid white; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false, attributionControl: false, dragging: false, touchZoom: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([${lat}, ${lng}], 13);
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

          ${startLat && startLng ? `
            L.marker([${startLat},${startLng}], { icon: L.divIcon({className: 'marker-start', html: '${startLabel}', iconSize: [24, 24], iconAnchor: [12, 12]}) }).addTo(map);
          ` : ''}
          ${endLat && endLng ? `
            L.marker([${endLat},${endLng}], { icon: L.divIcon({className: 'marker-end', html: '${endLabel}', iconSize: [24, 24], iconAnchor: [12, 12]}) }).addTo(map);
          ` : ''}

          ${startLat && startLng && endLat && endLng ? `
            var osrmUrl = 'https://router.project-osrm.org/route/v1/driving/'
              + ${startLng} + ',' + ${startLat} + ';'
              + ${endLng} + ',' + ${endLat}
              + '?overview=full&geometries=geojson';
            fetch(osrmUrl)
              .then(function(res) { return res.json(); })
              .then(function(data) {
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                  var coords = data.routes[0].geometry.coordinates;
                  var latlngs = coords.map(function(c) { return [c[1], c[0]]; });
                  L.polyline(latlngs, { color: '#FF751F', weight: 5, opacity: 0.85, lineJoin: 'round', lineCap: 'round' }).addTo(map);
                  map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
                } else {
                  L.polyline([[${startLat},${startLng}], [${endLat},${endLng}]], { color: '#FF751F', weight: 4, opacity: 0.6, dashArray: '8, 8' }).addTo(map);
                  map.fitBounds(L.latLngBounds([[${startLat},${startLng}], [${endLat},${endLng}]]), { padding: [40, 40] });
                }
              })
              .catch(function() {
                L.polyline([[${startLat},${startLng}], [${endLat},${endLng}]], { color: '#FF751F', weight: 4, opacity: 0.6, dashArray: '8, 8' }).addTo(map);
                map.fitBounds(L.latLngBounds([[${startLat},${startLng}], [${endLat},${endLng}]]), { padding: [40, 40] });
              });
          ` : ''}
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

/* ==================================================================== */
/* ProviderMap - live map: provider's current location, active route,    */
/* the incoming order, and (mock) demand zones                           */
/* ==================================================================== */
const PROVIDER_MAP_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #EEF0F2; }
      .me { position: relative; width: 44px; height: 44px; }
      .me .halo { position: absolute; left: 0; top: 0; width: 44px; height: 44px; border-radius: 50%; background: rgba(255,117,31,0.25); animation: pulse 2s ease-out infinite; }
      .me .dot { position: absolute; left: 11px; top: 11px; width: 22px; height: 22px; border-radius: 50%; background: #FF751F; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.35); }
      .me .head { position: absolute; left: 0; top: 0; width: 44px; height: 44px; }
      .me .head:after { content: ''; position: absolute; left: 17px; top: -4px; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 10px solid #FF751F; }
      @keyframes pulse { 0% { transform: scale(0.5); opacity: 0.9; } 100% { transform: scale(1.5); opacity: 0; } }
      .mk { width: 26px; height: 26px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font: 700 11px sans-serif; color: #fff; }
      .mk.p { background: #FF751F; } .mk.d { background: #111827; } .mk.s { background: #3B82F6; } .mk.e { background: #EF4444; }
      .zone { background: #fff; border-radius: 10px; padding: 2px 7px; font: 800 10px sans-serif; color: #9A4A12; border: 1px solid #FFD2B0; white-space: nowrap; box-shadow: 0 1px 4px rgba(0,0,0,0.15); }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([10.3157, 123.8854], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

      var meMarker = null;
      var routeLayer = L.layerGroup().addTo(map);
      var orderLayer = L.layerGroup().addTo(map);
      var demandLayer = L.layerGroup().addTo(map);
      var firstFix = true, lastTick = 0, routeKey = '', orderKey = '', demandKey = '';

      function meIcon(h) {
        var head = (h === null || h === undefined || isNaN(h)) ? '' : '<div class="head" style="transform: rotate(' + h + 'deg)"></div>';
        return L.divIcon({ className: '', html: '<div class="me"><div class="halo"></div>' + head + '<div class="dot"></div></div>', iconSize: [44, 44], iconAnchor: [22, 22] });
      }
      function mk(cls, t) {
        return L.divIcon({ className: '', html: '<div class="mk ' + cls + '">' + t + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
      }
      function drawRoad(layer, a, b, style) {
        var url = 'https://router.project-osrm.org/route/v1/driving/' + a.lng + ',' + a.lat + ';' + b.lng + ',' + b.lat + '?overview=full&geometries=geojson';
        fetch(url).then(function (r) { return r.json(); }).then(function (d) {
          if (d.code === 'Ok' && d.routes && d.routes.length) {
            var pts = d.routes[0].geometry.coordinates.map(function (c) { return [c[1], c[0]]; });
            L.polyline(pts, style).addTo(layer);
          } else {
            L.polyline([[a.lat, a.lng], [b.lat, b.lng]], Object.assign({ dashArray: '8, 8' }, style)).addTo(layer);
          }
        }).catch(function () {
          L.polyline([[a.lat, a.lng], [b.lat, b.lng]], Object.assign({ dashArray: '8, 8' }, style)).addTo(layer);
        });
      }
      function fit(points, padBottom) {
        if (!points.length) return;
        if (points.length === 1) { map.setView(points[0], 16); return; }
        map.fitBounds(L.latLngBounds(points), { paddingTopLeft: [30, 170], paddingBottomRight: [30, padBottom || 260], maxZoom: 16 });
      }

      window.updateState = function (s) {
        try {
          var me = s.provider ? [s.provider.lat, s.provider.lng] : null;
          if (me) {
            if (!meMarker) meMarker = L.marker(me, { icon: meIcon(s.provider.heading), zIndexOffset: 1000 }).addTo(map);
            else { meMarker.setLatLng(me); meMarker.setIcon(meIcon(s.provider.heading)); }
          }

          // Active route (blue)
          var rk = s.route ? [s.route.start.lat, s.route.start.lng, s.route.end.lat, s.route.end.lng].join(',') : '';
          if (rk !== routeKey) {
            routeKey = rk; routeLayer.clearLayers();
            if (s.route) {
              L.marker([s.route.start.lat, s.route.start.lng], { icon: mk('s', 'S') }).addTo(routeLayer);
              L.marker([s.route.end.lat, s.route.end.lng], { icon: mk('e', 'E') }).addTo(routeLayer);
              drawRoad(routeLayer, s.route.start, s.route.end, { color: '#3B82F6', weight: 5, opacity: 0.7 });
            }
          }

          // Incoming order (orange)
          var ok = s.order ? [s.order.pickup.lat, s.order.pickup.lng, s.order.dropoff.lat, s.order.dropoff.lng].join(',') : '';
          if (ok !== orderKey) {
            orderKey = ok; orderLayer.clearLayers();
            if (s.order) {
              L.marker([s.order.pickup.lat, s.order.pickup.lng], { icon: mk('p', 'P') }).addTo(orderLayer);
              L.marker([s.order.dropoff.lat, s.order.dropoff.lng], { icon: mk('d', 'D') }).addTo(orderLayer);
              drawRoad(orderLayer, s.order.pickup, s.order.dropoff, { color: '#FF751F', weight: 6, opacity: 0.9 });
              if (me) L.polyline([me, [s.order.pickup.lat, s.order.pickup.lng]], { color: '#111827', weight: 3, opacity: 0.5, dashArray: '6, 8' }).addTo(orderLayer);
              var pts = [[s.order.pickup.lat, s.order.pickup.lng], [s.order.dropoff.lat, s.order.dropoff.lng]];
              if (me) pts.push(me);
              fit(pts, s.padBottom);
            } else if (me) {
              map.setView(me, 15);
            }
          }

          // Demand zones (mock)
          var dk = (s.demand && me) ? me[0].toFixed(2) + ',' + me[1].toFixed(2) : '';
          if (dk !== demandKey) {
            demandKey = dk; demandLayer.clearLayers();
            if (dk) {
              var zones = [[0.007, 0.005, 1, '1.8x'], [-0.006, 0.008, 0.6, '1.4x'], [0.004, -0.009, 0.8, '1.6x'], [-0.008, -0.005, 0.3, '1.1x']];
              zones.forEach(function (z) {
                var c = [me[0] + z[0], me[1] + z[1]];
                L.circle(c, { radius: 450 + z[2] * 300, color: '#FF751F', weight: 1, fillColor: '#FF751F', fillOpacity: 0.1 + z[2] * 0.2 }).addTo(demandLayer);
                L.marker(c, { icon: L.divIcon({ className: '', html: '<div class="zone">' + z[3] + ' demand</div>', iconSize: [78, 18], iconAnchor: [39, 9] }) }).addTo(demandLayer);
              });
            }
          }

          // First GPS fix / recenter button
          if (firstFix && me && !s.order) { firstFix = false; map.setView(me, 15); }
          if (s.tick !== lastTick) { lastTick = s.tick; if (me) map.setView(me, 16, { animate: true }); }
        } catch (e) {}
      };
    </script>
  </body>
</html>
`;

const ProviderMap = ({ provider, route, order, demand, recenterTick, padBottom }: any) => {
  const ref = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const payload = JSON.stringify({ provider, route, order, demand, tick: recenterTick, padBottom });

  useEffect(() => {
    if (!ready) return;
    ref.current?.injectJavaScript(`window.updateState && window.updateState(${payload}); true;`);
  }, [ready, payload]);

  return (
    <WebView
      ref={ref}
      originWhitelist={['*']}
      source={{ html: PROVIDER_MAP_HTML }}
      style={{ flex: 1, backgroundColor: '#EEF0F2' }}
      javaScriptEnabled
      domStorageEnabled
      androidLayerType="hardware"
      onLoadEnd={() => setReady(true)}
    />
  );
};

/* ==================================================================== */
/* JobsScreen                                                           */
/* ==================================================================== */
export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [providerId, setProviderId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [activeRoute, setActiveRoute] = useState<Route | null>(null);

  const [requests, setRequests] = useState<JobRequest[]>([]);
  const [checkingMatches, setCheckingMatches] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<JobRequest | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});

  const [routePickerVisible, setRoutePickerVisible] = useState(false);

  // Live map
  const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; heading: number | null } | null>(null);
  const [locDenied, setLocDenied] = useState(false);
  const [recenterTick, setRecenterTick] = useState(0);
  const [showDemand, setShowDemand] = useState(false);

  // Incoming order popup
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  const [offerSecondsLeft, setOfferSecondsLeft] = useState(OFFER_SECONDS);

  // Departure confirmation sheet state
  const [confirmSheetVisible, setConfirmSheetVisible] = useState(false);
  const [pendingRoute, setPendingRoute] = useState<Route | null>(null);
  const [departureDate, setDepartureDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const onlinePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (v: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(v, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();
  }, [headerAnim, contentAnim]);

  useEffect(() => {
    if (!isOnline) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(onlinePulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(onlinePulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [isOnline, onlinePulse]);

  useEffect(() => { selectedIdRef.current = selectedRequest?.request_id ?? null; }, [selectedRequest]);

  const getProviderData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id, is_active')
        .eq('auth_id', user.id)
        .single();
      if (error) throw error;
      setProviderId(userData.user_id);
      setIsOnline(userData.is_active || false);
      return userData.user_id;
    } catch {
      return null;
    }
  };

  const createQuickRoute = async (pid: number) => {
    try {
      setLoading(true);

      // 1. Get or create vehicle
      let vehicleId: number | null = null;
      const { data: vehData } = await supabase
        .from('vehicles')
        .select('vehicle_id')
        .eq('provider_id', pid)
        .limit(1)
        .maybeSingle();

      if (vehData) {
        vehicleId = vehData.vehicle_id;
      } else {
        const { data: newVeh, error: vehErr } = await supabase
          .from('vehicles')
          .insert({
            provider_id: pid,
            vehicle_type: 'Motorcycle / Van',
            plate_number: 'PNS-999',
            max_volume_liters: 500,
            max_weight_kg: 100,
            cargo_length_cm: 100,
            cargo_width_cm: 100,
            cargo_height_cm: 100,
            verification_status: 'Verified',
          })
          .select('*')
          .single();

        if (vehErr) throw vehErr;
        vehicleId = newVeh.vehicle_id;
      }

      // 2. Create Start & End Locations
      const curLat = myLoc?.lat ?? 10.3157;
      const curLng = myLoc?.lng ?? 123.8854;

      const { data: startLoc, error: sErr } = await supabase
        .from('locations')
        .insert({
          street_address: 'Current Location',
          barangay: 'Lahug',
          city: 'Cebu City',
          province: 'Cebu',
          zip_code: '6000',
          latitude: curLat,
          longitude: curLng,
        })
        .select('*')
        .single();
      if (sErr) throw sErr;

      const { data: endLoc, error: eErr } = await supabase
        .from('locations')
        .insert({
          street_address: 'Cebu Metro Destination',
          barangay: 'Centro',
          city: 'Mandaue City',
          province: 'Cebu',
          zip_code: '6014',
          latitude: curLat + 0.03,
          longitude: curLng + 0.03,
        })
        .select('*')
        .single();
      if (eErr) throw eErr;

      // 3. Insert route
      const nowIso = toNaiveIsoString(new Date());
      const { data: simpleRoute, error: simpleErr } = await supabase
        .from('provider_routes')
        .insert({
          provider_id: pid,
          vehicle_id: vehicleId,
          start_location_id: startLoc.location_id,
          end_location_id: endLoc.location_id,
          departure_time: nowIso,
          route_frequency: 'On-Demand',
        })
        .select('*')
        .single();
      if (simpleErr) throw simpleErr;

      const builtRoute: Route = {
        ...simpleRoute,
        start_location: startLoc,
        end_location: endLoc,
        vehicle: vehData || { vehicle_id: vehicleId, vehicle_type: 'Motorcycle / Van', plate_number: 'PNS-999' } as any,
      };

      setActiveRoute(builtRoute);
      await setActiveRouteId(builtRoute.route_id);
      await fetchRoutes(pid);
      return builtRoute;
    } catch (err: any) {
      console.error('Failed to create quick route:', err);
      Alert.alert('Error', err?.message || 'Could not create active route.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const fetchRoutes = async (pid: number) => {
    try {
      let { data, error } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
        `)
        .eq('provider_id', pid)
        .order('created_at', { ascending: false });

      if (error || !data) {
        const { data: fkData, error: fkError } = await supabase
          .from('provider_routes')
          .select(`
            *,
            start_location:locations!start_location_id(*),
            end_location:locations!end_location_id(*),
            vehicle:vehicles(*)
          `)
          .eq('provider_id', pid)
          .order('created_at', { ascending: false });

        if (!fkError && fkData) {
          data = fkData;
          error = null;
        }
      }

      let list: Route[] = [];

      if (error || !data || data.length === 0) {
        const { data: simpleRoutes } = await supabase
          .from('provider_routes')
          .select('*')
          .eq('provider_id', pid)
          .order('created_at', { ascending: false });

        if (simpleRoutes && simpleRoutes.length > 0) {
          const locIds = Array.from(
            new Set(simpleRoutes.flatMap((r) => [r.start_location_id, r.end_location_id]).filter(Boolean))
          );
          const vIds = Array.from(new Set(simpleRoutes.map((r) => r.vehicle_id).filter(Boolean)));

          const { data: locs } = locIds.length > 0 
            ? await supabase.from('locations').select('*').in('location_id', locIds) 
            : { data: [] };
          const { data: vehs } = vIds.length > 0 
            ? await supabase.from('vehicles').select('*').in('vehicle_id', vIds) 
            : { data: [] };

          const locMap = new Map((locs || []).map((l: any) => [l.location_id, l]));
          const vehMap = new Map((vehs || []).map((v: any) => [v.vehicle_id, v]));

          list = simpleRoutes.map((r: any) => ({
            ...r,
            start_location: locMap.get(r.start_location_id),
            end_location: locMap.get(r.end_location_id),
            vehicle: vehMap.get(r.vehicle_id),
          }));
        }
      } else {
        list = data as Route[];
      }

      setRoutes(list);

      const savedId = await getActiveRouteId();
      const restored = savedId ? list.find((r) => r.route_id === savedId) : null;

      if (restored) {
        setActiveRoute(restored);
      } else if (list.length > 0) {
        setActiveRoute(list[0]);
        await setActiveRouteId(list[0].route_id);
      } else {
        setActiveRoute(null);
        await setActiveRouteId(null);
      }
    } catch (e) {
      console.error('fetchRoutes error:', e);
    }
  };

  const hydrateRequests = async (ids: number[]): Promise<JobRequest[]> => {
    if (ids.length === 0) return [];

    const { data: reqs, error } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, pickup_type, scheduled_time, created_at, estimated_cost,
        delivery_status, sender_id, receiver_id, receiver_phone,
        cargo:cargo_id ( * ),
        pickup_location:locations!delivery_requests_pickup_location_id_fkey ( * ),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( * ),
        receiver:receiver_id ( * )
      `)
      .in('request_id', ids)
      .eq('delivery_status', 'Pending');
    if (error) throw error;

    const { data: taken } = await supabase.from('deliveries').select('request_id').in('request_id', ids);
    const takenIds = new Set((taken || []).map((t: any) => t.request_id));
    const open = (reqs || []).filter((r: any) => !takenIds.has(r.request_id));

    const senderIds = Array.from(new Set(open.map((r: any) => r.sender_id).filter(Boolean)));
    const senders: Record<number, string> = {};
    if (senderIds.length > 0) {
      const { data: users } = await supabase
        .from('users').select('user_id, first_name, last_name').in('user_id', senderIds);
      (users || []).forEach((u: any) => {
        const last = u.last_name ? ` ${String(u.last_name).charAt(0)}.` : '';
        senders[u.user_id] = `${u.first_name || 'Sender'}${last}`;
      });
    }

    return open
      .map((r: any) => normalizeRequest(r, senders))
      .sort((a, b) => b.estimated_cost - a.estimated_cost);
  };

  const refreshMatches = async () => {
    if (!activeRoute) {
      setRequests([]);
      setRefreshing(false);
      return;
    }
    try {
      setCheckingMatches(true);
      const matches = await findMatches(activeRoute.route_id);
      const ids = Array.from(new Set(
        (matches || []).map((m: any) => m?.request?.request_id).filter((id: any) => id != null),
      )) as number[];
      const hydrated = await hydrateRequests(ids);
      setRequests(hydrated);

      if (selectedIdRef.current && !hydrated.some(r => r.request_id === selectedIdRef.current)) {
        selectedIdRef.current = null;
        setSelectedRequest(null);
        Alert.alert('Request unavailable', 'This request was accepted by another provider or cancelled.');
      }
    } catch (e) {
      console.warn('refreshMatches error:', e);
    } finally {
      setCheckingMatches(false);
      setRefreshing(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    const pid = await getProviderData();
    if (pid) await fetchRoutes(pid);
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    if (!isOnline || !activeRoute) {
      setRequests([]);
      setSelectedRequest(null);
      return;
    }

    refreshMatches();

    const channel = supabase
      .channel(`jobs-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests' }, () => { refreshMatches(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deliveries' }, () => { refreshMatches(); })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOnline, activeRoute?.route_id]);

  const toggleOnlineStatus = async (online: boolean) => {
    const pid = providerId || (await getProviderData());
    if (!pid) {
      Alert.alert('Error', 'Provider account details could not be loaded.');
      return;
    }

    if (online) {
      let currentRoute = activeRoute;

      if (!currentRoute) {
        if (routes.length > 0) {
          currentRoute = routes[0];
          setActiveRoute(currentRoute);
          await setActiveRouteId(currentRoute.route_id);
        } else {
          currentRoute = await createQuickRoute(pid);
        }
      }

      if (!currentRoute) {
        Alert.alert('Route Error', 'Unable to set an active route. Please try again.');
        return;
      }

      await supabase.from('users').update({ is_active: true }).eq('user_id', pid);
      setIsOnline(true);
      setTimeout(refreshMatches, 200);
    } else {
      Alert.alert(
        'Go Offline',
        'Going offline will stop matching new requests. Your route will remain saved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Go Offline', style: 'destructive', onPress: async () => {
              await supabase.from('users').update({ is_active: false }).eq('user_id', pid);
              setIsOnline(false);
              setRequests([]);
            },
          },
        ],
      );
    }
  };

  const openConfirmSheet = (route: Route) => {
    setPendingRoute(route);
    const dt = parseNaiveIsoString(route.departure_time);
    setDepartureDate(dt);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setConfirmSheetVisible(true);
  };

  const confirmDeparture = async () => {
    if (!pendingRoute || !providerId) return;

    try {
      const departureValue = toNaiveIsoString(departureDate);

      const { error: updateErr } = await supabase
        .from('provider_routes')
        .update({ departure_time: departureValue })
        .eq('route_id', pendingRoute.route_id);
      if (updateErr) throw updateErr;

      const { data: fullRoute } = await supabase
        .from('provider_routes')
        .select(`
          *,
          start_location:locations!provider_routes_start_location_id_fkey(*),
          end_location:locations!provider_routes_end_location_id_fkey(*),
          vehicle:vehicles!provider_routes_vehicle_id_fkey(*)
        `)
        .eq('route_id', pendingRoute.route_id)
        .single();

      if (!fullRoute) throw new Error('Failed to reload route');

      setActiveRoute(fullRoute as Route);
      await setActiveRouteId(pendingRoute.route_id);
      await supabase.from('users').update({ is_active: true }).eq('user_id', providerId);
      setIsOnline(true);

      setConfirmSheetVisible(false);
      setRoutePickerVisible(false);
      setPendingRoute(null);
      setTimeout(refreshMatches, 200);
    } catch (e: any) {
      console.error('confirmDeparture error:', e);
      Alert.alert('Error', e.message || 'Failed to set departure time');
    }
  };

  const goToTaskTab = (): boolean => {
    let current: any = navigation;
    while (current) {
      try {
        const names: string[] = current.getState?.()?.routeNames || [];
        const match = names.find(n => /task/i.test(n));
        if (match) { current.navigate(match); return true; }
      } catch { /* ignore */ }
      current = current.getParent?.();
    }
    return false;
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
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status !== 'granted') { if (!cancelled) setLocDenied(true); return; }
          if (!cancelled) setLocDenied(false);
          const last = await Location.getLastKnownPositionAsync();
          if (last && !cancelled) setMyLoc(toLoc(last));
          const cur = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!cancelled) setMyLoc(toLoc(cur));
          const watcher = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 10 },
            (p) => { if (!cancelled) setMyLoc(toLoc(p)); },
          );
          if (cancelled) watcher.remove(); else sub = watcher;
        } catch (e) {
          console.warn('Location error:', e);
        }
      })();
      return () => { cancelled = true; sub?.remove(); };
    }, []),
  );

  const offers = isOnline && !!activeRoute
    ? requests.filter(r => !dismissedIds.includes(r.request_id))
    : [];
  const currentOffer = offers[0] ?? null;

  const dismissOffer = (id: number) => setDismissedIds(prev => (prev.includes(id) ? prev : [...prev, id]));

  useEffect(() => { setDismissedIds([]); }, [isOnline, activeRoute?.route_id]);

  useEffect(() => {
    if (!currentOffer) return;
    setOfferSecondsLeft(OFFER_SECONDS);
    const t = setInterval(() => {
      setOfferSecondsLeft(sec => (selectedIdRef.current ? sec : sec - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [currentOffer?.request_id]);

  useEffect(() => {
    if (currentOffer && offerSecondsLeft <= 0) dismissOffer(currentOffer.request_id);
  }, [offerSecondsLeft]);

  const triggerSOS = () => {
    Alert.alert(
      'Emergency',
      'Do you need emergency help? You can call the national emergency hotline now.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911') },
      ],
    );
  };

  const doAccept = async (req: JobRequest) => {
    if (!providerId || !activeRoute) return;
    setAccepting(true);
    try {
      let vehicleId: number | null =
        activeRoute.vehicle?.verification_status === 'Verified' ? activeRoute.vehicle.vehicle_id : null;
      if (!vehicleId) {
        const { data: v } = await supabase
          .from('vehicles').select('vehicle_id')
          .eq('provider_id', providerId).eq('verification_status', 'Verified').limit(1).maybeSingle();
        vehicleId = v?.vehicle_id ?? null;
      }
      if (!vehicleId) {
        Alert.alert('Vehicle not verified', 'You need a verified vehicle before you can accept deliveries.');
        return;
      }

      const { data: fresh } = await supabase
        .from('delivery_requests').select('delivery_status').eq('request_id', req.request_id).maybeSingle();
      const { data: existing } = await supabase
        .from('deliveries').select('delivery_id').eq('request_id', req.request_id).limit(1);
      if (fresh?.delivery_status !== 'Pending' || (existing && existing.length > 0)) {
        Alert.alert('Request unavailable', 'This request was accepted by another provider or cancelled.');
        selectedIdRef.current = null;
        setSelectedRequest(null);
        refreshMatches();
        return;
      }

      const { data: delivery, error: deliveryError } = await supabase.from('deliveries').insert({
        request_id: req.request_id,
        provider_id: providerId,
        vehicle_id: vehicleId,
        route_id: activeRoute.route_id,
        accepted_at: new Date().toISOString(),
        estimated_eta: new Date(Date.now() + 3600000).toISOString(),
      }).select('*').single();
      if (deliveryError) throw deliveryError;

      const { error: qrError } = await supabase.from('qr_verifications').insert({
        delivery_id: delivery.delivery_id,
        pickup_qr: `PU-${randToken(14)}-${delivery.delivery_id}`,
        dropoff_qr: `DO-${randToken(14)}-${delivery.delivery_id}`,
        pickup_pin: randPin(),
        dropoff_pin: randPin(),
      });
      if (qrError) {
        await supabase.from('deliveries').delete().eq('delivery_id', delivery.delivery_id);
        throw qrError;
      }

      const { error: reqUpdateError } = await supabase
        .from('delivery_requests').update({ delivery_status: 'Accepted' }).eq('request_id', req.request_id);
      if (reqUpdateError) throw reqUpdateError;

      const { data: requestData } = await supabase
        .from('delivery_requests').select('estimated_cost, sender_id').eq('request_id', req.request_id).single();
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
      }

      selectedIdRef.current = null;
      setSelectedRequest(null);
      setDismissedIds(prev => [...prev, req.request_id]);
      refreshMatches();
      if (!goToTaskTab()) {
        Alert.alert('Delivery accepted', 'Find it in the Task tab. Ask the sender to show their pickup QR when you arrive.');
      }
    } catch (error: any) {
      Alert.alert('Error', error?.message || 'Failed to accept delivery.');
    } finally {
      setAccepting(false);
    }
  };

  const acceptRequest = (req: JobRequest) => {
    if (accepting) return;
    if (!providerId || !activeRoute) {
      Alert.alert('Select a route', 'Pick the route you are driving before accepting a request.');
      return;
    }
    Alert.alert(
      'Accept this delivery?',
      `You will earn ${money(req.estimated_cost)} for delivering from ${req.pickup.main} to ${req.dropoff.main}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Accept', onPress: () => doAccept(req) },
      ],
    );
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const pulseScale = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const pulseOpacity = onlinePulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] });

  const markFailed = (uri: string) => setFailedPhotos(prev => ({ ...prev, [uri]: true }));

  /* --------------------------- request details --------------------------- */
  const renderRequestDetail = (r: JobRequest) => {
    const cap = activeRoute?.vehicle?.max_weight_kg;
    const fits = r.weightKg != null && cap ? r.weightKg <= cap : null;
    const senderInitial = (r.senderName || 'S').charAt(0).toUpperCase();

    return (
      <View style={{ flex: 1 }}>
        <View style={[styles.detailHeader, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <TouchableOpacity
            style={styles.detailBack}
            onPress={() => { selectedIdRef.current = null; setSelectedRequest(null); }}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={18} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.detailHeaderTitle}>Request Details</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          style={styles.container}
          contentContainerStyle={[styles.detailScroll, { paddingBottom: 130 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Request ID */}
          <View style={styles.card}>
            <Text style={styles.eyebrow}>REQUEST ID</Text>
            <Text style={styles.bigId}>{requestCode(r.request_id)}</Text>
            <View style={[styles.chipRow, { marginTop: 14 }]}>
              <View style={styles.chipSolid}>
                <Ionicons name="flash" size={11} color="#FFFFFF" />
                <Text style={styles.chipSolidText}>NEW MATCH</Text>
              </View>
              <View style={styles.chip}>
                <Ionicons name={/door/i.test(r.pickup_type || '') ? 'home-outline' : 'walk-outline'} size={12} color="#6B7280" />
                <Text style={styles.chipText}>{serviceLabel(r.pickup_type)}</Text>
              </View>
              <View style={styles.chip}>
                <Ionicons name="calendar-outline" size={12} color="#6B7280" />
                <Text style={styles.chipText}>{whenLabel(r)}</Text>
              </View>
            </View>
          </View>

          {/* Pay */}
          <View style={styles.earnCard}>
            <Text style={styles.earnLabel}>YOU EARN</Text>
            <Text style={styles.earnValue}>{money(r.estimated_cost)}</Text>
            <View style={styles.earnNote}>
              <Ionicons name="shield-checkmark-outline" size={14} color="#FFE4D2" />
              <Text style={styles.earnNoteText}>
                Held in escrow once you accept, then released to your wallet when the receiver confirms delivery.
              </Text>
            </View>
          </View>

          {/* Package */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}><Ionicons name="cube" size={14} color={ORANGE} /></View>
              <Text style={styles.cardTitle}>Package</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>ITEMS</Text>
                <Text style={styles.statValue}>{r.totalItems}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statLabel}>WEIGHT</Text>
                <Text style={styles.statValue}>{r.weightKg != null ? `${r.weightKg} kg` : '—'}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statLabel}>FRAGILE</Text>
                <Text style={[styles.statValue, r.fragile && { color: '#EF4444' }]}>{r.fragile ? 'Yes' : 'No'}</Text>
              </View>
            </View>

            {(r.dims || fits !== null) && (
              <View style={styles.noteList}>
                {!!r.dims && (
                  <View style={styles.noteRow}>
                    <Ionicons name="resize-outline" size={14} color="#6B7280" />
                    <Text style={styles.noteText}>Size {r.dims}</Text>
                  </View>
                )}
                {fits !== null && (
                  <View style={styles.noteRow}>
                    <Ionicons
                      name={fits ? 'checkmark-circle' : 'alert-circle'}
                      size={14}
                      color={fits ? ORANGE : '#EF4444'}
                    />
                    <Text style={[styles.noteText, !fits && { color: '#EF4444' }]}>
                      {fits ? `Within your vehicle capacity (${cap} kg)` : `Heavier than your vehicle capacity (${cap} kg)`}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {r.items.map((it, i) => {
              const ok = !!it.photo && !failedPhotos[it.photo];
              return (
                <View key={i} style={styles.itemBlock}>
                  {ok ? (
                    <TouchableOpacity activeOpacity={0.92} onPress={() => setPreviewPhoto(it.photo!)} style={styles.itemPhotoWrap}>
                      <Image source={{ uri: it.photo! }} style={styles.itemPhoto} resizeMode="cover" onError={() => markFailed(it.photo!)} />
                      <View style={styles.enlargeHint}><Ionicons name="expand-outline" size={12} color="#FFFFFF" /></View>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.itemNoPhoto}>
                      <Ionicons name="image-outline" size={18} color="#9CA3AF" />
                      <Text style={styles.itemNoPhotoText}>
                        {it.photo ? "Photo couldn't be loaded" : 'No photo provided'}
                      </Text>
                    </View>
                  )}
                  <View style={styles.itemInfoRow}>
                    <View style={{ flex: 1 }}>
                      {r.items.length > 1 && <Text style={styles.eyebrow}>ITEM {i + 1}</Text>}
                      <Text style={styles.itemTitle} numberOfLines={3}>{it.description}</Text>
                      {!!it.boxes && <Text style={styles.itemSub}>{it.boxes}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      {!!it.size && (
                        <View style={styles.chip}><Text style={styles.chipText}>{it.size}</Text></View>
                      )}
                      {it.fragile && (
                        <View style={[styles.chip, styles.chipWarn]}>
                          <Ionicons name="warning" size={11} color="#EF4444" />
                          <Text style={[styles.chipText, { color: '#EF4444' }]}>Fragile</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Map + route */}
          <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
            <View style={styles.detailMap} pointerEvents="none">
              <RouteMap
                key={`req-${r.request_id}`}
                startLat={r.pickup.lat}
                startLng={r.pickup.lng}
                endLat={r.dropoff.lat}
                endLng={r.dropoff.lng}
                startLabel="P"
                endLabel="D"
              />
            </View>
            <View style={styles.routePad}>
              <View style={styles.routeRow}>
                <View style={styles.rail}>
                  <View style={styles.pinPickup}><View style={styles.pinPickupInner} /></View>
                  <View style={styles.railLine} />
                </View>
                <View style={styles.routeText}>
                  <Text style={styles.eyebrow}>PICKUP</Text>
                  <Text style={styles.routeMain} numberOfLines={2}>{r.pickup.main}</Text>
                  {!!r.pickup.sub && <Text style={styles.routeSub} numberOfLines={2}>{r.pickup.sub}</Text>}
                </View>
              </View>
              <View style={styles.routeRow}>
                <View style={styles.rail}>
                  <View style={styles.pinDropoff}><Ionicons name="location" size={10} color="#FFFFFF" /></View>
                </View>
                <View style={[styles.routeText, { paddingBottom: 0 }]}>
                  <Text style={styles.eyebrow}>DROP-OFF</Text>
                  <Text style={styles.routeMain} numberOfLines={2}>{r.dropoff.main}</Text>
                  {!!r.dropoff.sub && <Text style={styles.routeSub} numberOfLines={2}>{r.dropoff.sub}</Text>}
                </View>
              </View>
            </View>
          </View>

          {/* Sender + receiver */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderIcon}><Ionicons name="people" size={14} color={ORANGE} /></View>
              <Text style={styles.cardTitle}>People</Text>
            </View>
            <View style={styles.personRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{senderInitial}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>SENDER</Text>
                <Text style={styles.personName} numberOfLines={1}>{r.senderName}</Text>
              </View>
            </View>
            <View style={styles.personDivider} />
            <View style={styles.personRow}>
              <View style={[styles.avatar, styles.avatarSoft]}>
                <Ionicons name="person" size={16} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>RECEIVER</Text>
                <Text style={styles.personName} numberOfLines={1}>{r.receiverName || 'Receiver'}</Text>
              </View>
            </View>
            <Text style={styles.privacyNote}>Contact details are shared once you accept the delivery.</Text>
          </View>
        </ScrollView>

        {/* Sticky accept bar */}
        <View style={styles.acceptBar}>
          <View>
            <Text style={styles.eyebrow}>YOU EARN</Text>
            <Text style={styles.acceptPrice}>{money(r.estimated_cost)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.acceptBtn, accepting && { opacity: 0.7 }]}
            onPress={() => acceptRequest(r)}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                <Text style={styles.acceptBtnText}>Accept Delivery</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ------------------------------ main view ------------------------------ */

  const renderOfferPopup = (o: JobRequest) => {
    const me = myLoc;
    const toPickupKm = me && o.pickup.lat != null && o.pickup.lng != null
      ? roadKm(me.lat, me.lng, o.pickup.lat, o.pickup.lng) : null;
    const tripKm = o.pickup.lat != null && o.pickup.lng != null && o.dropoff.lat != null && o.dropoff.lng != null
      ? roadKm(o.pickup.lat, o.pickup.lng, o.dropoff.lat, o.dropoff.lng) : null;
    const etaMin = toPickupKm != null ? Math.max(1, Math.round((toPickupKm / 25) * 60)) : null;
    const pct = Math.max(0, Math.min(100, (offerSecondsLeft / OFFER_SECONDS) * 100));

    return (
      <View style={styles.offerSheet}>
        <View style={styles.offerTimerTrack}>
          <View style={[styles.offerTimerFill, { width: `${pct}%` as any }, offerSecondsLeft <= 10 && { backgroundColor: '#EF4444' }]} />
        </View>

        <View style={styles.offerTopRow}>
          <View style={styles.chipSolid}>
            <Ionicons name="flash" size={11} color="#FFFFFF" />
            <Text style={styles.chipSolidText}>NEW MATCH</Text>
          </View>
          {offers.length > 1 && <Text style={styles.offerCount}>1 of {offers.length}</Text>}
          <View style={{ flex: 1 }} />
          <View style={styles.offerTimerPill}>
            <Ionicons name="timer-outline" size={13} color={offerSecondsLeft <= 10 ? '#EF4444' : '#6B7280'} />
            <Text style={[styles.offerTimerText, offerSecondsLeft <= 10 && { color: '#EF4444' }]}>{Math.max(0, offerSecondsLeft)}s</Text>
          </View>
        </View>

        <View style={styles.offerMainRow}>
          <View>
            <Text style={styles.eyebrow}>YOU EARN</Text>
            <Text style={styles.offerPrice}>{money(o.estimated_cost)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.offerCode}>{requestCode(o.request_id)}</Text>
            <View style={[styles.chip, { marginTop: 6 }]}>
              <Ionicons name={/door/i.test(o.pickup_type || '') ? 'home-outline' : 'walk-outline'} size={12} color="#6B7280" />
              <Text style={styles.chipText}>{serviceLabel(o.pickup_type)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.offerStatsRow}>
          <View style={styles.offerStat}>
            <Text style={styles.offerStatValue}>{toPickupKm != null ? `${toPickupKm.toFixed(1)} km` : '—'}</Text>
            <Text style={styles.offerStatLabel}>{etaMin != null ? `to pickup · ~${etaMin} min` : 'to pickup'}</Text>
          </View>
          <View style={styles.offerStatDivider} />
          <View style={styles.offerStat}>
            <Text style={styles.offerStatValue}>{tripKm != null ? `${tripKm.toFixed(1)} km` : '—'}</Text>
            <Text style={styles.offerStatLabel}>trip distance</Text>
          </View>
          <View style={styles.offerStatDivider} />
          <View style={styles.offerStat}>
            <Text style={styles.offerStatValue}>{o.totalItems} · {o.weightKg != null ? `${o.weightKg}kg` : '—'}</Text>
            <Text style={styles.offerStatLabel}>{o.fragile ? 'items · fragile' : 'items · weight'}</Text>
          </View>
        </View>

        <View style={styles.offerRoute}>
          <View style={styles.reqRouteRow}>
            <View style={styles.pinPickup}><View style={styles.pinPickupInner} /></View>
            <Text style={styles.offerRouteText} numberOfLines={1}>{o.pickup.main}</Text>
          </View>
          <View style={styles.reqRouteLine} />
          <View style={styles.reqRouteRow}>
            <View style={styles.pinDropoff}><Ionicons name="location" size={10} color="#FFFFFF" /></View>
            <Text style={styles.offerRouteText} numberOfLines={1}>{o.dropoff.main}</Text>
          </View>
        </View>

        <View style={styles.offerBtnRow}>
          <TouchableOpacity
            style={styles.declineBtn}
            onPress={() => dismissOffer(o.request_id)}
            disabled={accepting}
            activeOpacity={0.85}
          >
            <Ionicons name="close" size={18} color="#EF4444" />
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.offerAcceptBtn, accepting && { opacity: 0.7 }]}
            onPress={() => doAccept(o)}
            disabled={accepting}
            activeOpacity={0.9}
          >
            {accepting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                <Text style={styles.offerAcceptText}>Accept</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.offerDetailsLink}
          onPress={() => { selectedIdRef.current = o.request_id; setSelectedRequest(o); }}
          activeOpacity={0.7}
        >
          <Text style={styles.offerDetailsText}>View package details</Text>
          <Ionicons name="chevron-forward" size={14} color={ORANGE} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderBottomPanel = () => {
    const dismissedCount = isOnline ? requests.length - offers.length : 0;

    return (
      <View style={styles.bottomPanel}>
        {/* Online Toggle Row */}
        <View style={styles.onlineToggleRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Animated.View
              style={[
                styles.liveDotBig,
                { backgroundColor: isOnline ? '#22C55E' : '#9CA3AF' },
                isOnline && { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
              ]}
            />
            <View>
              <Text style={styles.panelTitle}>
                {isOnline ? 'You are online' : 'You are offline'}
              </Text>
              <Text style={styles.panelSub}>
                {checkingMatches ? 'Looking for matches...' : isOnline ? 'Waiting for requests...' : 'Go online to receive requests'}
              </Text>
            </View>
          </View>
          <Switch
            trackColor={{ false: '#E5E7EB', true: ORANGE }}
            thumbColor={'#FFFFFF'}
            ios_backgroundColor="#E5E7EB"
            onValueChange={toggleOnlineStatus}
            value={isOnline}
          />
        </View>

        <View style={styles.panelDivider} />

        {/* Route / Vehicle Row */}
        <View style={styles.vehicleRow}>
          <View style={styles.vehicleIconBox}>
            <Ionicons name="car-sport" size={22} color={ORANGE} />
          </View>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.vehicleNameText}>
              {activeRoute?.vehicle?.vehicle_type || (activeRoute ? 'Active Route' : 'No Active Route')}
            </Text>
            <Text style={styles.vehiclePlateText} numberOfLines={1}>
              {activeRoute
                ? `${activeRoute.start_location?.city || activeRoute.start_location?.street_address || 'Start'} → ${activeRoute.end_location?.city || activeRoute.end_location?.street_address || 'End'}`
                : 'Tap to select or create a route'}
            </Text>
          </View>
          <TouchableOpacity style={styles.changeBtn} onPress={() => setRoutePickerVisible(true)} activeOpacity={0.85}>
            <Text style={styles.changeBtnText}>{activeRoute ? 'Change' : 'Select route'}</Text>
          </TouchableOpacity>
        </View>

        {dismissedCount > 0 && (
          <TouchableOpacity style={styles.reopenRow} onPress={() => setDismissedIds([])} activeOpacity={0.85}>
            <Ionicons name="flash" size={14} color={ORANGE} />
            <Text style={styles.reopenText}>{dismissedCount} matched {dismissedCount === 1 ? 'order' : 'orders'} dismissed</Text>
            <Text style={styles.reopenLink}>Show again</Text>
          </TouchableOpacity>
        )}

        {locDenied && (
          <TouchableOpacity style={styles.locWarnBottom} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
            <Ionicons name="location-outline" size={16} color="#B45309" />
            <Text style={styles.locWarnText}>Location is off. Tap to enable.</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderMain = () => {
    const fallback = {
      lat: activeRoute?.start_location?.latitude ?? 10.3157,
      lng: activeRoute?.start_location?.longitude ?? 123.8854,
      heading: null as number | null,
    };
    const loc = myLoc ?? fallback;
    const sLoc = activeRoute?.start_location;
    const eLoc = activeRoute?.end_location;
    const mapRoute = sLoc?.latitude != null && sLoc?.longitude != null && eLoc?.latitude != null && eLoc?.longitude != null
      ? { start: { lat: sLoc.latitude, lng: sLoc.longitude }, end: { lat: eLoc.latitude, lng: eLoc.longitude } }
      : null;
    const mapOrder = currentOffer
      && currentOffer.pickup.lat != null && currentOffer.pickup.lng != null
      && currentOffer.dropoff.lat != null && currentOffer.dropoff.lng != null
      ? {
          pickup: { lat: currentOffer.pickup.lat, lng: currentOffer.pickup.lng },
          dropoff: { lat: currentOffer.dropoff.lat, lng: currentOffer.dropoff.lng },
        }
      : null;

    return (
      <View style={{ flex: 1 }}>
        <ProviderMap
          provider={loc}
          route={mapRoute}
          order={mapOrder}
          demand={showDemand}
          recenterTick={recenterTick}
          padBottom={currentOffer ? 400 : 200}
        />

        {/* Right: map tools, positioned directly under safe area inset */}
        <View style={[styles.mapTools, { top: insets.top + 20 }]} pointerEvents="box-none">
          <TouchableOpacity style={styles.mapToolBtn} onPress={() => setRecenterTick(t => t + 1)} activeOpacity={0.85}>
            <Ionicons name="locate" size={20} color="#111827" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.mapToolBtn, showDemand && styles.mapToolBtnActive]}
            onPress={() => setShowDemand(d => !d)}
            activeOpacity={0.85}
          >
            <Ionicons name="flame" size={20} color={showDemand ? '#FFFFFF' : ORANGE} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.mapToolBtn}
            onPress={() => { setRefreshing(true); refreshMatches(); }}
            activeOpacity={0.85}
          >
            {refreshing || checkingMatches ? (
              <ActivityIndicator size="small" color={ORANGE} />
            ) : (
              <Ionicons name="refresh" size={20} color="#111827" />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mapToolBtn, styles.sosBtn]} onPress={triggerSOS} activeOpacity={0.85}>
            <Ionicons name="shield" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* Bottom: incoming order popup or sleek status panel */}
        <Animated.View style={[styles.bottomWrap, { opacity: contentAnim }]} pointerEvents="box-none">
          {currentOffer ? renderOfferPopup(currentOffer) : renderBottomPanel()}
        </Animated.View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: '#FAFAFA' }]}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#FAFAFA' }}>
      <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
      {selectedRequest ? renderRequestDetail(selectedRequest) : renderMain()}

      {/* ============================================================ */}
      {/* Route Picker Modal                                            */}
      {/* ============================================================ */}
      <Modal
        visible={routePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setRoutePickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.routePickerSheet}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <Text style={styles.routePickerTitle}>Select a Route</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                {providerId && (
                  <TouchableOpacity
                    style={styles.quickRouteHeaderBtn}
                    onPress={async () => {
                      const newR = await createQuickRoute(providerId);
                      if (newR) setRoutePickerVisible(false);
                    }}
                  >
                    <Ionicons name="add-circle" size={16} color={ORANGE} />
                    <Text style={styles.quickRouteHeaderBtnText}>+ Quick Route</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setRoutePickerVisible(false)}>
                  <Ionicons name="close" size={22} color="#111827" />
                </TouchableOpacity>
              </View>
            </View>

            {routes.length === 0 ? (
              <View style={styles.routePickerEmpty}>
                <Ionicons name="map-outline" size={40} color={ORANGE} />
                <Text style={styles.routePickerEmptyTitle}>No routes created yet</Text>
                <Text style={styles.routePickerEmptySub}>
                  Create an on-demand route now to start accepting nearby deliveries right away.
                </Text>
                <TouchableOpacity
                  style={styles.createQuickRouteBtn}
                  onPress={async () => {
                    if (providerId) {
                      const newR = await createQuickRoute(providerId);
                      if (newR) setRoutePickerVisible(false);
                    }
                  }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="flash" size={16} color="#FFFFFF" />
                  <Text style={styles.createQuickRouteBtnText}>Create Quick Route</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {routes.map((r) => {
                  const isSelected = activeRoute?.route_id === r.route_id;
                  const rDate = parseNaiveIsoString(r.departure_time);
                  return (
                    <TouchableOpacity
                      key={r.route_id}
                      style={[styles.routeOption, isSelected && styles.routeOptionSelected]}
                      onPress={() => openConfirmSheet(r)}
                      activeOpacity={0.85}
                    >
                      <View
                        style={[
                          styles.routeOptionDot,
                          { backgroundColor: isSelected ? ORANGE : '#D1D5DB' },
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routeOptionTitle} numberOfLines={1}>
                          {r.start_location?.city || 'Start'} → {r.end_location?.city || 'End'}
                        </Text>
                        <Text style={styles.routeOptionSub} numberOfLines={1}>
                          {rDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {r.route_frequency}
                        </Text>
                        <Text style={styles.routeOptionAddr} numberOfLines={1}>
                          {r.start_location?.street_address} → {r.end_location?.street_address}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={22} color={ORANGE} />
                      )}
                    </TouchableOpacity>
                  );
                })}
                <View style={{ height: 30 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ============================================================ */}
      {/* Confirm Departure Time Sheet                                  */}
      {/* ============================================================ */}
      <Modal
        visible={confirmSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirmSheetVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.confirmSheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.routePickerHandle} />
            <View style={styles.routePickerHeader}>
              <Text style={styles.routePickerTitle}>Confirm Departure</Text>
              <TouchableOpacity onPress={() => setConfirmSheetVisible(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            {pendingRoute && (
              <>
                <View style={styles.confirmRoutePreview}>
                  <View style={styles.confirmRouteRow}>
                    <View style={[styles.confirmDot, { backgroundColor: '#3B82F6' }]} />
                    <Text style={styles.confirmRouteText} numberOfLines={1}>
                      {pendingRoute.start_location?.street_address || 'Start'}
                    </Text>
                  </View>
                  <View style={styles.confirmRouteLine} />
                  <View style={styles.confirmRouteRow}>
                    <View style={[styles.confirmDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={styles.confirmRouteText} numberOfLines={1}>
                      {pendingRoute.end_location?.street_address || 'End'}
                    </Text>
                  </View>
                </View>

                <View style={styles.dateTimeRow}>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Departure Date</Text>
                    <TouchableOpacity
                      style={styles.dateTimeButton}
                      onPress={() => !showDatePicker && setShowDatePicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>
                        {departureDate.toLocaleDateString()}
                      </Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="date"
                        display="default"
                        minimumDate={new Date(Date.now() - 24 * 60 * 60 * 1000)}
                        onChange={(e, d) => {
                          if (Platform.OS === 'android') setShowDatePicker(false);
                          if (e.type === 'set' && d) {
                            const merged = new Date(d);
                            merged.setHours(departureDate.getHours(), departureDate.getMinutes(), 0, 0);
                            setDepartureDate(merged);
                          }
                        }}
                      />
                    )}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Departure Time</Text>
                    <TouchableOpacity
                      style={styles.dateTimeButton}
                      onPress={() => !showTimePicker && setShowTimePicker(true)}
                    >
                      <Ionicons name="time-outline" size={16} color={ORANGE} />
                      <Text style={styles.dateTimeValue}>
                        {departureDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker
                        value={departureDate}
                        mode="time"
                        display="default"
                        onChange={(e, t) => {
                          if (Platform.OS === 'android') setShowTimePicker(false);
                          if (e.type === 'set' && t) {
                            const merged = new Date(departureDate);
                            merged.setHours(t.getHours(), t.getMinutes(), 0, 0);
                            setDepartureDate(merged);
                          }
                        }}
                      />
                    )}
                  </View>
                </View>

                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color="#1E40AF" />
                  <Text style={styles.infoBoxText}>
                    The app will match requests within ±5 minutes of this departure time.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={confirmDeparture}
                  activeOpacity={0.9}
                >
                  <Ionicons name="checkmark-circle" size={18} color="#FFF" />
                  <Text style={styles.confirmBtnText}>Confirm & Go Online</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Item photo preview */}
      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          {!!previewPhoto && (
            <Image source={{ uri: previewPhoto }} style={styles.previewImg} resizeMode="contain" />
          )}
          <TouchableOpacity style={[styles.previewClose, { top: insets.top + 12 }]} onPress={() => setPreviewPhoto(null)} activeOpacity={0.85}>
            <Ionicons name="close" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  /* live map overlays */
  mapTools: { position: 'absolute', right: 12, gap: 10 },
  mapToolBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  mapToolBtnActive: { backgroundColor: ORANGE },
  sosBtn: { backgroundColor: '#EF4444' },

  bottomWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  /* bottom unified panel */
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },
  onlineToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  liveDotBig: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.5,
  },
  panelSub: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },
  panelDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 18,
  },
  locWarnBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  locWarnText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#92400E' },

  reopenRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14,
    backgroundColor: '#F9FAFB', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  reopenText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#4B5563' },
  reopenLink: { fontSize: 13, fontWeight: '800', color: ORANGE },
  
  /* vehicle / route */
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleIconBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: '#FFF1E6',
    alignItems: 'center', justifyContent: 'center',
  },
  vehicleNameText: { fontSize: 15, fontWeight: '800', color: '#111827' },
  vehiclePlateText: { fontSize: 13, color: '#6B7280', marginTop: 2, fontWeight: '600' },
  changeBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#FFF1E6' },
  changeBtnText: { color: ORANGE, fontWeight: '800', fontSize: 13 },

  /* incoming order popup */
  offerSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 16, paddingBottom: 14, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 16,
  },
  offerTimerTrack: { height: 5, backgroundColor: '#FFE4D2', marginHorizontal: -16 },
  offerTimerFill: { height: '100%', backgroundColor: ORANGE },
  offerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  offerCount: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  offerTimerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6',
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999,
  },
  offerTimerText: { fontSize: 12, fontWeight: '800', color: '#4B5563' },
  offerMainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 },
  offerPrice: { fontSize: 32, fontWeight: '900', color: '#111827', letterSpacing: -1, marginTop: 2 },
  offerCode: { fontSize: 13, fontWeight: '800', color: '#9CA3AF' },
  offerStatsRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', borderRadius: 16,
    paddingVertical: 12, marginTop: 12,
  },
  offerStat: { flex: 1, alignItems: 'center' },
  offerStatValue: { fontSize: 15, fontWeight: '900', color: '#111827' },
  offerStatLabel: { fontSize: 10, fontWeight: '700', color: '#6B7280', marginTop: 2 },
  offerStatDivider: { width: 1, height: 28, backgroundColor: '#E5E7EB' },
  offerRoute: { marginTop: 14 },
  offerRouteText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827' },
  offerBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  declineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 15, borderRadius: 16, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
  },
  declineBtnText: { fontSize: 15, fontWeight: '800', color: '#EF4444' },
  offerAcceptBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 16, backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  offerAcceptText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  offerDetailsLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 12 },
  offerDetailsText: { fontSize: 12, fontWeight: '800', color: ORANGE },

  container: { flex: 1, backgroundColor: '#FAFAFA' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', gap: 10 },
  loadingText: { color: '#6B7280', fontWeight: '600' },

  detailScroll: { padding: 16 },

  /* shared */
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#F1F1F1',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 1,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', color: '#9CA3AF', letterSpacing: 0.8 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardHeaderIcon: {
    width: 26, height: 26, borderRadius: 8, backgroundColor: '#FFF1E6',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 999, backgroundColor: '#F3F4F6',
  },
  chipText: { fontSize: 11, fontWeight: '700', color: '#4B5563' },
  chipWarn: { backgroundColor: '#FEF2F2' },
  chipSolid: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 999, backgroundColor: ORANGE,
  },
  chipSolidText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  pinPickup: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFF1E6',
    alignItems: 'center', justifyContent: 'center',
  },
  pinPickupInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  pinDropoff: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
  },

  detailMap: { height: 190, backgroundColor: '#EEF0F2' },
  routePad: { padding: 16 },
  
  /* detail */
  detailHeader: {
    backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12,
  },
  detailBack: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  detailHeaderTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  bigId: { fontSize: 26, fontWeight: '900', color: '#111827', marginTop: 6, letterSpacing: 0.5 },

  earnCard: { backgroundColor: ORANGE, borderRadius: 20, padding: 18, marginBottom: 14 },
  earnLabel: { color: '#FFE4D2', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  earnValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', marginTop: 4 },
  earnNote: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: 10,
  },
  earnNoteText: { flex: 1, color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontWeight: '600' },

  statsRow: { flexDirection: 'row', backgroundColor: '#FAFAFA', borderRadius: 14, paddingVertical: 12 },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 9, fontWeight: '800', color: '#9CA3AF', letterSpacing: 0.8 },
  statValue: { fontSize: 16, fontWeight: '900', color: '#111827' },
  statDivider: { width: 1, backgroundColor: '#E5E7EB' },
  noteList: { marginTop: 12, gap: 8 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  noteText: { fontSize: 12, color: '#4B5563', fontWeight: '600', flex: 1 },

  itemBlock: { marginTop: 14, borderTopWidth: 1, borderTopColor: '#F3F4F6', paddingTop: 14 },
  itemPhotoWrap: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#F3F4F6' },
  itemPhoto: { width: '100%', height: 200 },
  enlargeHint: {
    position: 'absolute', right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center',
  },
  itemNoPhoto: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F9FAFB',
    borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#F1F1F1', borderStyle: 'dashed',
  },
  itemNoPhotoText: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },
  itemInfoRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  itemTitle: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 2 },
  itemSub: { fontSize: 12, color: '#6B7280', marginTop: 3 },

  routeRow: { flexDirection: 'row', gap: 12 },
  rail: { alignItems: 'center', width: 18 },
  railLine: { flex: 1, width: 2, backgroundColor: '#FFD2B3', marginVertical: 4, borderRadius: 1 },
  routeText: { flex: 1, paddingBottom: 16 },
  routeMain: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 2 },
  routeSub: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 17 },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarSoft: { backgroundColor: '#FFF1E6' },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  personName: { fontSize: 14, fontWeight: '800', color: '#111827', marginTop: 2 },
  personDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  privacyNote: { marginTop: 14, fontSize: 11, color: '#9CA3AF', fontWeight: '600' },

  acceptBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    borderTopWidth: 1, borderTopColor: '#F1F1F1',
  },
  acceptPrice: { fontSize: 22, fontWeight: '900', color: ORANGE, marginTop: 2 },
  acceptBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 16, minWidth: 180,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  acceptBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  /* photo preview */
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImg: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  routePickerSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '80%',
  },
  routePickerHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB',
    alignSelf: 'center', marginBottom: 14,
  },
  routePickerHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 14,
  },
  routePickerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  routePickerEmpty: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  routePickerEmptyTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginTop: 8 },
  routePickerEmptySub: { fontSize: 12, color: '#6B7280', textAlign: 'center', paddingHorizontal: 20, marginBottom: 8 },
  quickRouteHeaderBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#FFF1E6' },
  quickRouteHeaderBtnText: { fontSize: 12, fontWeight: '800', color: ORANGE },
  createQuickRouteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ORANGE, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 10 },
  createQuickRouteBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },

  routeOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', borderRadius: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  routeOptionSelected: { backgroundColor: '#FFF7ED', borderColor: ORANGE },
  routeOptionDot: { width: 10, height: 10, borderRadius: 5 },
  routeOptionTitle: { fontSize: 14, fontWeight: '800', color: '#111827' },
  routeOptionSub: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '500' },
  routeOptionAddr: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },

  reqRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqRouteLine: { width: 1, height: 12, backgroundColor: '#E5E7EB', marginLeft: 8.5, marginVertical: 3 },

  /* Confirm departure sheet */
  confirmSheet: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10,
  },
  confirmRoutePreview: {
    backgroundColor: '#F9FAFB', borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: '#F3F4F6', marginBottom: 16,
  },
  confirmRouteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confirmDot: { width: 8, height: 8, borderRadius: 4 },
  confirmRouteText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#111827' },
  confirmRouteLine: {
    width: 1, height: 14, backgroundColor: '#E5E7EB',
    marginLeft: 3.5, marginVertical: 4,
  },

  dateTimeRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  inputGroup: { flex: 1 },
  inputLabel: { marginBottom: 6, fontWeight: '700', color: '#374151', fontSize: 11, letterSpacing: 0.2 },
  dateTimeButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  dateTimeValue: { fontSize: 13, color: '#111827', fontWeight: '600' },

  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: '#DBEAFE', marginBottom: 14,
  },
  infoBoxText: {
    flex: 1, fontSize: 11, color: '#1E40AF', fontWeight: '600', lineHeight: 16,
  },

  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 16, backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  confirmBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
});