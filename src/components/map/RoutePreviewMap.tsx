// src/components/map/RoutePreviewMap.tsx
// Google Map that shows pickup (orange) -> drop-off (black) and "fills in" the
// route line in brand orange, from pickup to drop-off.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, StyleProp, ViewStyle, Easing } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

// 1. Import the Map ID from your utils folder
import { GOOGLE_MAP_ID } from '../../utils/mapConfig';

export const BRAND_ORANGE = '#FF751F';   // same orange as the app logo / notification colour
const DROPOFF_BLACK = '#111827';

type LatLng = { latitude: number; longitude: number };

type Props = {
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  /** space reserved for overlays so the route is framed in the visible area */
  padTop?: number;
  padBottom?: number;
  padSide?: number;
  /** how long the fill animation takes (ms) */
  fillDuration?: number;
  style?: StyleProp<ViewStyle>;
};

/* ---------------------------- geometry helpers ---------------------------- */

const haversine = (a: LatLng, b: LatLng) => {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/** Keep at most `max` points so redrawing every frame stays cheap. */
const thin = (pts: LatLng[], max = 220): LatLng[] => {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: LatLng[] = [];
  for (let i = 0; i < max - 1; i++) out.push(pts[Math.round(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
};

const fetchRoad = async (a: LatLng, b: LatLng): Promise<LatLng[]> => {
  const straight = [a, b];
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (data?.code === 'Ok' && Array.isArray(coords) && coords.length > 1) {
      return thin(coords.map((c: number[]) => ({ latitude: c[1], longitude: c[0] })));
    }
  } catch { /* fall back to a straight line */ }
  return straight;
};

/** Portion [0..1] of the polyline, measured by distance (so the fill moves at a steady speed). */
const slice = (pts: LatLng[], cum: number[], t: number): LatLng[] => {
  const total = cum[cum.length - 1];
  if (total <= 0 || t >= 1) return pts;
  const target = total * t;
  let i = 1;
  while (i < cum.length && cum[i] < target) i++;
  const prev = pts[i - 1];
  const next = pts[i];
  const segLen = cum[i] - cum[i - 1] || 1;
  const f = (target - cum[i - 1]) / segLen;
  const tip = {
    latitude: prev.latitude + (next.latitude - prev.latitude) * f,
    longitude: prev.longitude + (next.longitude - prev.longitude) * f,
  };
  return [...pts.slice(0, i), tip];
};

/* -------------------------------- component -------------------------------- */

export default function RoutePreviewMap({
  pickupLat, pickupLng, dropoffLat, dropoffLng,
  padTop = 120, padBottom = 320, padSide = 40,
  fillDuration = 1800, style,
}: Props) {
  const mapRef = useRef<MapView>(null);
  const [road, setRoad] = useState<LatLng[]>([]);
  const [filled, setFilled] = useState<LatLng[]>([]);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasPickup = pickupLat != null && pickupLng != null;
  const hasDropoff = dropoffLat != null && dropoffLng != null;

  const pickup: LatLng | null = hasPickup ? { latitude: pickupLat!, longitude: pickupLng! } : null;
  const dropoff: LatLng | null = hasDropoff ? { latitude: dropoffLat!, longitude: dropoffLng! } : null;

  const fit = useCallback((pts: LatLng[], animated: boolean) => {
    if (pts.length === 0) return;
    mapRef.current?.fitToCoordinates(pts, {
      edgePadding: { top: padTop, right: padSide, bottom: padBottom, left: padSide },
      animated,
    });
  }, [padTop, padBottom, padSide]);

  const stopAnim = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  /* load the road geometry whenever the two points change */
  useEffect(() => {
    stopAnim();
    setFilled([]);
    if (!pickup || !dropoff) { setRoad([]); return; }

    let cancelled = false;
    (async () => {
      const line = await fetchRoad(pickup, dropoff);
      if (cancelled) return;
      setRoad(line);
      fit(line, true);

      // let the camera settle, then fill the line up
      timer.current = setTimeout(() => {
        if (cancelled) return;
        const cum: number[] = [0];
        for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversine(line[i - 1], line[i]));

        const startedAt = Date.now();
        let lastDraw = 0;
        const ease = Easing.inOut(Easing.cubic);

        const tick = () => {
          if (cancelled) return;
          const t = Math.min(1, (Date.now() - startedAt) / fillDuration);
          const now = Date.now();
          if (now - lastDraw >= 33 || t >= 1) {          // ~30 fps is plenty for a polyline
            lastDraw = now;
            setFilled(slice(line, cum, ease(t)));
          }
          if (t < 1) raf.current = requestAnimationFrame(tick);
        };
        raf.current = requestAnimationFrame(tick);
      }, 450);
    })();

    return () => {
      cancelled = true;
      stopAnim();
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng, fillDuration]);

  /* only one point known (e.g. dropoff not chosen yet) */
  useEffect(() => {
    if (pickup && dropoff) return;
    const one = pickup || dropoff;
    if (!one) return;
    mapRef.current?.animateToRegion({ ...one, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLat, pickupLng, dropoffLat, dropoffLng]);

  const initial = pickup || dropoff || { latitude: 10.3157, longitude: 123.8854 };

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      userInterfaceStyle="light"
      googleMapId={GOOGLE_MAP_ID} // <--- Map ID applied here
      style={[StyleSheet.absoluteFill, style]}
      initialRegion={{ ...initial, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
      onMapReady={() => { if (road.length > 1) fit(road, false); }}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsCompass={false}
      showsMyLocationButton={false}
      showsUserLocation={false}
    >
      {/* faint full track so the fill reads as "filling up" */}
      {road.length > 1 && (
        <Polyline
          coordinates={road}
          strokeColor="rgba(255,117,31,0.22)"
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
        />
      )}

      {/* the animated orange fill */}
      {filled.length > 1 && (
        <Polyline
          coordinates={filled}
          strokeColor={BRAND_ORANGE}
          strokeWidth={6}
          lineCap="round"
          lineJoin="round"
        />
      )}

      {pickup && (
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.dot, { backgroundColor: BRAND_ORANGE }]}>
            <Text style={styles.dotText}>P</Text>
          </View>
        </Marker>
      )}
      {dropoff && (
        <Marker coordinate={dropoff} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.dot, { backgroundColor: DROPOFF_BLACK }]}>
            <Text style={styles.dotText}>D</Text>
          </View>
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 3, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  dotText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
});