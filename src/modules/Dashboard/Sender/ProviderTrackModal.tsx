// src/modules/Dashboard/Sender/ProviderTrackModal.tsx
//
// Full-screen live view of ONE provider who is on their way (before any package
// exists). Shows the provider's route, where they are right now, and where the
// sender is. Contains NO package information. The sender can ask for a delivery
// along this provider's route from here.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Image, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { LiveFix, isFixFresh } from '../../../services/providerLiveService';

const ORANGE = '#FF751F';
const AVG_CITY_SPEED_KMH = 22;  

export type TrackTrip = {
  routeId: number;
  providerId: number;
  name: string;
  vehicleType: string;
  pickup: string;
  dropoff: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
  timeLabel: string;
  departureTime: Date;
  rating: number;
};

type Props = {
  visible: boolean;
  trip: TrackTrip | null;
  fix: LiveFix | null;
  myCoords: { lat: number; lng: number } | null;
  onClose: () => void;
  onRequest: (trip: TrackTrip) => void;
};

const toRad = (d: number) => (d * Math.PI) / 180;
const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const formatKm = (km: number) => (km < 1 ? `${Math.max(50, Math.round(km * 10) * 100)} m` : `${km.toFixed(1)} km`);

const formatLastSeen = (iso?: string | null) => {
  if (!iso) return 'Waiting for the provider’s GPS…';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 5_000) return 'Updated just now';
  if (ms < 60_000) return `Updated ${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `Updated ${Math.floor(ms / 60_000)}m ago`;
  return `Last seen ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

/* ------------------------------------------------------------------ */
/* Leaflet page. Rebuilt only when the route / sender position changes; */
/* provider movement is pushed with injectJavaScript (no reload).       */
/* ------------------------------------------------------------------ */
function buildMapHtml(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
  sender: { lat: number; lng: number } | null,
  provider: { lat: number; lng: number } | null,
  bottomInsetPx: number,
) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin:0; padding:0; width:100%; height:100%; background:#E5E7EB; }
    .pin { display:flex; align-items:center; justify-content:center; font-weight:900; color:#FFF; box-shadow:0 2px 8px rgba(0,0,0,0.35); }
    .pin-start { background:#FF751F; border:3px solid #FFF; border-radius:50%; width:24px; height:24px; font-size:10px; }
    .pin-end { background:#111827; border:3px solid #FFF; border-radius:50%; width:24px; height:24px; font-size:10px; }
    .pin-me { background:#2563EB; border:3px solid #FFF; border-radius:50%; width:18px; height:18px; box-shadow:0 0 0 6px rgba(37,99,235,0.22); }
    .pin-provider { background:#22C55E; border:3px solid #FFF; border-radius:50%; width:36px; height:36px; font-size:17px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var START = [${start.lat}, ${start.lng}];
    var END = [${end.lat}, ${end.lng}];
    var ME = ${sender ? `[${sender.lat}, ${sender.lng}]` : 'null'};
    var PROV = ${provider ? `[${provider.lat}, ${provider.lng}]` : 'null'};
    var BOTTOM_INSET = ${Math.max(0, Math.round(bottomInsetPx))};

    var map = L.map('map', { zoomControl:false, attributionControl:false }).setView(START, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19 }).addTo(map);

    function icon(cls, html, size) {
      return L.divIcon({ className:'', html:'<div class="pin ' + cls + '">' + html + '</div>', iconSize:[size,size], iconAnchor:[size/2,size/2] });
    }
    L.marker(START, { icon: icon('pin-start', 'S', 24) }).addTo(map);
    L.marker(END,   { icon: icon('pin-end', 'D', 24) }).addTo(map);

    var meMarker = null, provMarker = null, routeLine = null, lastRouteAt = 0, lastRouteFrom = null;
    if (ME) meMarker = L.marker(ME, { icon: icon('pin-me', '', 18), zIndexOffset: 500 }).addTo(map);
    if (PROV) provMarker = L.marker(PROV, { icon: icon('pin-provider', '🚗', 36), zIndexOffset: 1000 }).addTo(map);

    function fitAll() {
      var pts = [START, END];
      if (ME) pts.push(ME);
      if (provMarker) pts.push(provMarker.getLatLng());
      map.fitBounds(L.latLngBounds(pts), { paddingTopLeft:[50,70], paddingBottomRight:[50, 50 + BOTTOM_INSET], maxZoom: 16 });
    }

    function post(msg) { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }

    // Route from where the provider is NOW (or their start point) to their destination.
    async function drawRoute(from) {
      lastRouteAt = Date.now(); lastRouteFrom = from;
      try {
        var url = 'https://router.project-osrm.org/route/v1/driving/' + from[1] + ',' + from[0] + ';' + END[1] + ',' + END[0] + '?overview=full&geometries=geojson';
        var res = await fetch(url); var data = await res.json();
        if (data && data.code === 'Ok' && data.routes && data.routes[0]) {
          var coords = data.routes[0].geometry.coordinates.map(function(c){ return [c[1], c[0]]; });
          if (routeLine) map.removeLayer(routeLine);
          routeLine = L.polyline(coords, { color:'#FF751F', weight:5, opacity:0.9, lineJoin:'round', lineCap:'round' }).addTo(map);
          return;
        }
      } catch (e) {}
      if (routeLine) map.removeLayer(routeLine);
      routeLine = L.polyline([from, END], { color:'#FF751F', weight:4, opacity:0.7, dashArray:'8,8' }).addTo(map);
    }

    window.updateProvider = function(lat, lng) {
      var p = [lat, lng];
      if (!provMarker) provMarker = L.marker(p, { icon: icon('pin-provider', '🚗', 36), zIndexOffset: 1000 }).addTo(map);
      else provMarker.setLatLng(p);
      var moved = lastRouteFrom ? map.distance(lastRouteFrom, p) : 99999;
      if (Date.now() - lastRouteAt > 20000 && moved > 100) drawRoute(p);
    };
    window.setBottomInset = function(px) { BOTTOM_INSET = Math.max(0, px | 0); };
    window.recenter = function() { fitAll(); };

    drawRoute(PROV || START);
    fitAll();
    true;
  </script>
</body>
</html>`;
}

export default function ProviderTrackModal({ visible, trip, fix, myCoords, onClose, onRequest }: Props) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const webRef = useRef<WebView>(null);
  const lastSentRef = useRef('');

  const [sheetHeight, setSheetHeight] = useState(330);
  const [profile, setProfile] = useState<{ photo: string | null } | null>(null);
  const [, setTick] = useState(0);

  // keep "Updated 12s ago" / Live-vs-Stale fresh
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setTick((x) => x + 1), 10_000);
    return () => clearInterval(t);
  }, [visible]);

  useEffect(() => {
    if (!visible || !trip) { setProfile(null); lastSentRef.current = ''; return; }
    let active = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('users').select('profile_photo').eq('user_id', trip.providerId).maybeSingle();
        if (active) setProfile({ photo: (data as any)?.profile_photo ?? null });
      } catch { if (active) setProfile({ photo: null }); }
    })();
    return () => { active = false; };
  }, [visible, trip?.providerId]);

  const live = isFixFresh(fix);
  const providerPos = fix ? { lat: fix.latitude, lng: fix.longitude } : null;

  const distanceKm = useMemo(() => {
    if (!myCoords || !trip) return null;
    const p = providerPos ?? trip.pickupCoords;
    if (!p.lat && !p.lng) return null;
    return haversineKm(myCoords.lat, myCoords.lng, p.lat, p.lng);
  }, [myCoords, providerPos?.lat, providerPos?.lng, trip]);

  const etaMin = distanceKm != null && live ? Math.max(1, Math.round((distanceKm / AVG_CITY_SPEED_KMH) * 60)) : null;

  // Structural HTML (do NOT depend on the live fix, or the map reloads on every GPS tick)
  const html = useMemo(() => {
    if (!trip) return '';
    return buildMapHtml(
      trip.pickupCoords.lat || trip.pickupCoords.lng ? trip.pickupCoords : { lat: 10.3157, lng: 123.8854 },
      trip.dropoffCoords.lat || trip.dropoffCoords.lng ? trip.dropoffCoords : { lat: 10.3157, lng: 123.8854 },
      myCoords,
      providerPos,
      sheetHeight + insets.bottom,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.routeId, myCoords ? myCoords.lat.toFixed(3) : null, myCoords ? myCoords.lng.toFixed(3) : null, sheetHeight, insets.bottom]);

  useEffect(() => {
    if (!providerPos || !webRef.current) return;
    const key = `${providerPos.lat.toFixed(6)},${providerPos.lng.toFixed(6)}`;
    if (key === lastSentRef.current) return;
    lastSentRef.current = key;
    webRef.current.injectJavaScript(`window.updateProvider(${providerPos.lat}, ${providerPos.lng}); true;`);
  }, [providerPos?.lat, providerPos?.lng]);

  useEffect(() => {
    webRef.current?.injectJavaScript(`window.setBottomInset(${sheetHeight + insets.bottom}); true;`);
  }, [sheetHeight, insets.bottom]);

  if (!trip) return null;

  const initials = trip.name.split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || 'P';
  const onTheRoad = trip.departureTime.getTime() <= Date.now();
  const statusText = live ? 'Live' : fix ? 'Stale' : 'Not shared';
  const statusColor = live ? colors.success : colors.warning;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

        <WebView
          ref={webRef}
          originWhitelist={['*']}
          source={{ html }}
          style={StyleSheet.absoluteFill}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled
          androidLayerType="hardware"
          mixedContentMode="always"
        />

        <View style={[styles.topBar, { top: insets.top + 10 }]}>
          <TouchableOpacity style={styles.circleBtn} onPress={onClose} activeOpacity={0.85}>
            <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={[styles.livePill, !live && styles.livePillStale]}>
            <View style={[styles.liveDot, { backgroundColor: statusColor }]} />
            <Text style={styles.liveText}>{live ? 'Live' : fix ? 'Stale' : 'No live GPS'}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.fab, { bottom: sheetHeight + insets.bottom + 12 }]}
          onPress={() => webRef.current?.injectJavaScript('window.recenter(); true;')}
          activeOpacity={0.85}
        >
          <Ionicons name="locate" size={20} color={ORANGE} />
        </TouchableOpacity>

        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.grabber} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <View style={styles.providerRow}>
              <View style={styles.avatar}>
                {profile?.photo ? (
                  <Image source={{ uri: profile.photo }} style={styles.avatarImg} />
                ) : (
                  <Text style={styles.avatarText}>{initials}</Text>
                )}
                <View style={styles.verifiedDot}><Ionicons name="checkmark" size={9} color="#FFFFFF" /></View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.providerName} numberOfLines={1}>{trip.name}</Text>
                <View style={styles.subRow}>
                  <Text style={styles.providerSub}>{trip.vehicleType}</Text>
                  <Ionicons name="star" size={12} color={colors.warning} />
                  <Text style={styles.providerSub}>{trip.rating}</Text>
                </View>
              </View>
              <View style={[styles.whenPill, { backgroundColor: onTheRoad ? colors.successBg : colors.warningBg }]}>
                <Text style={[styles.whenPillText, { color: onTheRoad ? colors.success : colors.warning }]}>
                  {onTheRoad ? 'On the way' : 'Leaving soon'}
                </Text>
              </View>
            </View>

            <View style={styles.routeBox}>
              <View style={styles.routeRow}>
                <View style={styles.dotOrange} />
                <Text style={styles.routeText} numberOfLines={1}>{trip.pickup}</Text>
              </View>
              <View style={styles.routeLine} />
              <View style={styles.routeRow}>
                <View style={styles.dotDark} />
                <Text style={styles.routeText} numberOfLines={1}>{trip.dropoff}</Text>
              </View>
            </View>

            <View style={styles.stats}>
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>FROM YOU</Text>
                <Text style={styles.statValue}>{distanceKm != null ? formatKm(distanceKm) : '—'}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>REACHES YOU</Text>
                <Text style={styles.statValue}>{etaMin != null ? `~${etaMin} min` : '—'}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBox}>
                <Text style={styles.statLabel}>GPS</Text>
                <Text style={[styles.statValue, { color: statusColor }]}>{statusText}</Text>
              </View>
            </View>
            <Text style={styles.updated}>
              {fix ? formatLastSeen(fix.updated_at) : `${trip.timeLabel} · live GPS appears once the provider is on the road`}
            </Text>

            <TouchableOpacity style={styles.requestBtn} onPress={() => onRequest(trip)} activeOpacity={0.9}>
              <Ionicons name="paper-plane" size={16} color="#FFFFFF" />
              <Text style={styles.requestBtnText}>Request Delivery Along This Route</Text>
            </TouchableOpacity>
            <Text style={styles.privacyNote}>
              Your pickup will be your current location. Package details are only shared once you send a request.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  topBar: {
    position: 'absolute', left: 16, right: 16, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', zIndex: 20,
  },
  circleBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.4, shadowRadius: 6, elevation: 4,
  },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
  },
  livePillStale: { borderColor: c.warning },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveText: { fontSize: 11, fontWeight: '800', color: c.textPrimary, letterSpacing: 0.4 },
  fab: {
    position: 'absolute', right: 16, width: 46, height: 46, borderRadius: 23, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, zIndex: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5, shadowRadius: 8, elevation: 6,
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, maxHeight: '62%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.12 : 0.5, shadowRadius: 16, elevation: 14,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 12 },

  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: isDark ? '#3A2411' : '#FFE4D2', overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  verifiedDot: {
    position: 'absolute', right: -1, bottom: -1, width: 16, height: 16, borderRadius: 8,
    backgroundColor: c.success, borderWidth: 2, borderColor: c.card, alignItems: 'center', justifyContent: 'center',
  },
  providerName: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  providerSub: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  whenPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  whenPillText: { fontSize: 11, fontWeight: '800' },

  routeBox: {
    backgroundColor: c.background, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    marginTop: 14, borderWidth: 1, borderColor: c.divider,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeLine: { width: 2, height: 10, backgroundColor: c.border, marginLeft: 3, marginVertical: 3 },
  routeText: { fontSize: 14, fontWeight: '600', color: c.textPrimary, flex: 1 },
  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textPrimary },

  stats: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, borderRadius: 14,
    paddingVertical: 12, marginTop: 12, borderWidth: 1, borderColor: c.divider,
  },
  statBox: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statLabel: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  statValue: { fontSize: 15, fontWeight: '900', color: c.textPrimary, marginTop: 4, letterSpacing: -0.2 },
  statDivider: { width: 1, height: 26, backgroundColor: c.border },
  updated: { fontSize: 11, color: c.textSecondary, fontWeight: '600', marginTop: 10, textAlign: 'center' },

  requestBtn: {
    marginTop: 16, backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  requestBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  privacyNote: { marginTop: 10, fontSize: 11, color: c.textMuted, textAlign: 'center', lineHeight: 16 },
});