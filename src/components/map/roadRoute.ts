// src/components/map/roadRoute.ts
import { getNavRoute } from './directions';

export type LatLng = { latitude: number; longitude: number };

export async function fetchRoadRoute(a: LatLng, b: LatLng, maxPoints = 300): Promise<LatLng[]> {
  try {
    const nav = await getNavRoute(a, b);
    let pts = nav.coords;
    if (pts.length > maxPoints) {
      const step = (pts.length - 1) / (maxPoints - 1);
      const thin: LatLng[] = [];
      for (let i = 0; i < maxPoints - 1; i++) thin.push(pts[Math.round(i * step)]);
      thin.push(pts[pts.length - 1]);
      pts = thin;
    }
    return pts;
  } catch {
    return [a, b];
  }
}