// __tests__/corridorBuffer.test.ts
import { buildCorridorPolygon } from '../src/utils/corridorBuffer';
import { CTU_TO_IT_PARK_POLYLINE } from './fixtures/cebuRoutes';

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => any;

const haversineM = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) => {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

describe('corridorBuffer — buildCorridorPolygon', () => {
  it('returns an empty array when given fewer than 2 coordinates or non-positive radius', () => {
    expect(buildCorridorPolygon([], 200)).toEqual([]);
    expect(buildCorridorPolygon([CTU_TO_IT_PARK_POLYLINE[0]], 200)).toEqual([]);
    expect(buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, 0)).toEqual([]);
    expect(buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, -100)).toEqual([]);
  });

  it('builds a valid closed polygon ring for a 200m Curb-side corridor', () => {
    const poly = buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, 200);
    expect(poly.length).toBeGreaterThan(10);

    // Every point must have finite lat/lng
    for (const pt of poly) {
      expect(Number.isFinite(pt.latitude)).toBe(true);
      expect(Number.isFinite(pt.longitude)).toBe(true);
    }

    // Ring should be closed (first point === last point)
    const first = poly[0];
    const last = poly[poly.length - 1];
    expect(first.latitude).toBeCloseTo(last.latitude, 6);
    expect(first.longitude).toBeCloseTo(last.longitude, 6);
  });

  it('produces wider envelopes for 500m Door-to-Door and 1000m Fallback than 200m Curb-side', () => {
    const mid = CTU_TO_IT_PARK_POLYLINE[3];
    const curbPoly = buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, 200);
    const doorPoly = buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, 500);
    const fallbackPoly = buildCorridorPolygon(CTU_TO_IT_PARK_POLYLINE, 1000);

    const minDistToMid = (poly: typeof curbPoly) =>
      Math.min(...poly.map(p => haversineM(p, mid)));

    const dCurb = minDistToMid(curbPoly);
    const dDoor = minDistToMid(doorPoly);
    const dFallback = minDistToMid(fallbackPoly);

    expect(dCurb).toBeGreaterThan(150);
    expect(dDoor).toBeGreaterThan(dCurb);
    expect(dFallback).toBeGreaterThan(dDoor);
  });
});