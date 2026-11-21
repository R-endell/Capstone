// src/utils/corridorBuffer.ts
// Converts a road polyline into a closed geographic buffer Polygon of `radiusM` meters
// on both sides, with rounded start/end caps and miter-clamped corners.

export type LatLng = { latitude: number; longitude: number };

type XY = { x: number; y: number };

const CAP_STEPS = 6;

function thinBySpacing(pts: LatLng[], minSpacingM: number, maxPoints = 70): LatLng[] {
  if (pts.length <= 2) return pts;
  const refLat = pts[0].latitude;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((refLat * Math.PI) / 180);

  const kept: LatLng[] = [pts[0]];
  let last = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const dx = (pts[i].longitude - last.longitude) * mLng;
    const dy = (pts[i].latitude - last.latitude) * mLat;
    if (Math.hypot(dx, dy) >= minSpacingM) {
      kept.push(pts[i]);
      last = pts[i];
    }
  }
  kept.push(pts[pts.length - 1]);

  if (kept.length <= maxPoints) return kept;
  const step = (kept.length - 1) / (maxPoints - 1);
  const out: LatLng[] = [];
  for (let i = 0; i < maxPoints - 1; i++) out.push(kept[Math.round(i * step)]);
  out.push(kept[kept.length - 1]);
  return out;
}

export function buildCorridorPolygon(polyline: LatLng[], radiusM: number): LatLng[] {
  if (!polyline || polyline.length < 2 || radiusM <= 0) return [];

  const sampled = thinBySpacing(polyline, Math.max(25, radiusM * 0.25), 70);
  if (sampled.length < 2) return [];

  const refLat = sampled[Math.floor(sampled.length / 2)].latitude;
  const refLng = sampled[Math.floor(sampled.length / 2)].longitude;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((refLat * Math.PI) / 180);

  const toXY = (p: LatLng): XY => ({
    x: (p.longitude - refLng) * mLng,
    y: (p.latitude - refLat) * mLat,
  });
  const toLL = (p: XY): LatLng => ({
    latitude: refLat + p.y / mLat,
    longitude: refLng + p.x / mLng,
  });

  const pts = sampled.map(toXY);
  const n = pts.length;

  // Unit left-hand normals per segment
  const segNormals: XY[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    segNormals.push({ x: -dy / len, y: dx / len });
  }

  const left: XY[] = [];
  const right: XY[] = [];

  for (let i = 0; i < n; i++) {
    let nx: number;
    let ny: number;
    let scale = radiusM;

    if (i === 0) {
      nx = segNormals[0].x;
      ny = segNormals[0].y;
    } else if (i === n - 1) {
      nx = segNormals[n - 2].x;
      ny = segNormals[n - 2].y;
    } else {
      const n1 = segNormals[i - 1];
      const n2 = segNormals[i];
      const bx = n1.x + n2.x;
      const by = n1.y + n2.y;
      const bLen = Math.hypot(bx, by);
      if (bLen < 1e-4) {
        nx = n1.x;
        ny = n1.y;
      } else {
        nx = bx / bLen;
        ny = by / bLen;
        const dot = Math.max(0.65, nx * n1.x + ny * n1.y);
        scale = Math.min(radiusM * 1.45, radiusM / dot);
      }
    }

    left.push({ x: pts[i].x + nx * scale, y: pts[i].y + ny * scale });
    right.push({ x: pts[i].x - nx * scale, y: pts[i].y - ny * scale });
  }

  const ring: XY[] = [...left];

  // Rounded end cap (from +normal to -normal around last point)
  const endCenter = pts[n - 1];
  const endAngle = Math.atan2(segNormals[n - 2].y, segNormals[n - 2].x);
  for (let s = 1; s < CAP_STEPS; s++) {
    const a = endAngle - (Math.PI * s) / CAP_STEPS;
    ring.push({ x: endCenter.x + Math.cos(a) * radiusM, y: endCenter.y + Math.sin(a) * radiusM });
  }

  for (let i = n - 1; i >= 0; i--) ring.push(right[i]);

  // Rounded start cap (from -normal to +normal around first point)
  const startCenter = pts[0];
  const startAngle = Math.atan2(-segNormals[0].y, -segNormals[0].x);
  for (let s = 1; s < CAP_STEPS; s++) {
    const a = startAngle - (Math.PI * s) / CAP_STEPS;
    ring.push({ x: startCenter.x + Math.cos(a) * radiusM, y: startCenter.y + Math.sin(a) * radiusM });
  }

  // Close polygon ring
  ring.push(ring[0]);
  return ring.map(toLL);
}