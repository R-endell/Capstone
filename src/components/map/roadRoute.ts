// src/components/map/roadRoute.ts
// Road geometry between two points (OSRM, no API key). Falls back to a straight line.
export type LatLng = { latitude: number; longitude: number };

export async function fetchRoadRoute(a: LatLng, b: LatLng, maxPoints = 300): Promise<LatLng[]> {
  const straight = [a, b];
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${a.longitude},${a.latitude};${b.longitude},${b.latitude}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (data?.code === 'Ok' && Array.isArray(coords) && coords.length > 1) {
      let pts: LatLng[] = coords.map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
      if (pts.length > maxPoints) {
        const step = (pts.length - 1) / (maxPoints - 1);
        const thin: LatLng[] = [];
        for (let i = 0; i < maxPoints - 1; i++) thin.push(pts[Math.round(i * step)]);
        thin.push(pts[pts.length - 1]);
        pts = thin;
      }
      return pts;
    }
  } catch { /* fall back */ }
  return straight;
}