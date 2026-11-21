// __tests__/matchingService.test.ts
// Jest provides these globals at runtime. Keeping the declarations local avoids
// requiring the optional @jest/globals package during type-checking.
declare const describe: any;
declare const expect: any;
declare const it: any;
declare const jest: any;

jest.mock('../src/utils/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import {
  CURBSIDE_CORRIDOR_M,
  DOOR_TO_DOOR_CORRIDOR_M,
  DOOR_TO_DOOR_FALLBACK_M,
  CURBSIDE_LANDMARK_SNAP_M,
  computeCargoVolumeLiters,
  isRequestWithinRouteCorridor,
  isDoorToDoorType,
} from '../src/services/matchingService';
import {
  MOCK_ROUTE_PRIMARY,
  MOCK_ROUTE_WITH_FALLBACK,
  PINS,
  buildMockRequest,
} from './fixtures/cebuRoutes';

describe('matchingService — Policy Constants', () => {
  it('enforces exact corridor radii and landmark snap threshold', () => {
    expect(CURBSIDE_CORRIDOR_M).toBe(200);
    expect(DOOR_TO_DOOR_CORRIDOR_M).toBe(500);
    expect(DOOR_TO_DOOR_FALLBACK_M).toBe(1000);
    expect(CURBSIDE_LANDMARK_SNAP_M).toBe(15);
  });

  it('identifies Door-to-Door vs Curb-side pickup types', () => {
    expect(isDoorToDoorType('door-to-door')).toBe(true);
    expect(isDoorToDoorType('Door-to-Door')).toBe(true);
    expect(isDoorToDoorType('curb-side')).toBe(false);
    expect(isDoorToDoorType(null)).toBe(false);
  });
});

describe('matchingService — Corridor & Direction Matching', () => {
  it('matches a forward Curb-side request inside the 200m band', () => {
    const req = buildMockRequest({
      pickup_type: 'curb-side',
      pickup: PINS.curbside100m,
      dropoff: PINS.onRouteEnd,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_PRIMARY, req)).toBe(true);
  });

  it('rejects a Curb-side request at 350m off-route (outside 200m)', () => {
    const req = buildMockRequest({
      pickup_type: 'curb-side',
      pickup: PINS.doorToDoor350m,
      dropoff: PINS.onRouteEnd,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_PRIMARY, req)).toBe(false);
  });

  it('matches a Door-to-Door request at 350m off-route (inside 500m)', () => {
    const req = buildMockRequest({
      pickup_type: 'door-to-door',
      pickup: PINS.doorToDoor350m,
      dropoff: PINS.onRouteEnd,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_PRIMARY, req)).toBe(true);
  });

  it('rejects a 750m Door-to-Door request on primary route, but accepts it when fallback is unlocked', () => {
    const req = buildMockRequest({
      pickup_type: 'door-to-door',
      pickup: PINS.fallback750m,
      dropoff: PINS.onRouteEnd,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_PRIMARY, req)).toBe(false);
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_WITH_FALLBACK, req)).toBe(true);
  });

  it('rejects requests that go in the reverse direction (backtracking)', () => {
    const reverseReq = buildMockRequest({
      pickup_type: 'curb-side',
      pickup: PINS.onRouteEnd,
      dropoff: PINS.onRouteStart,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_PRIMARY, reverseReq)).toBe(false);
  });

  it('rejects requests far outside all corridors (1.8km away)', () => {
    const farReq = buildMockRequest({
      pickup_type: 'door-to-door',
      pickup: PINS.farOffRoute,
      dropoff: PINS.onRouteEnd,
    });
    expect(isRequestWithinRouteCorridor(MOCK_ROUTE_WITH_FALLBACK, farReq)).toBe(false);
  });
});

describe('matchingService — Cargo Volume Calculation', () => {
  it('computes positive volume in liters from item arrays and box quantities', () => {
    const fromItems = computeCargoVolumeLiters([
      { size: 'Small' },
      { size: 'Medium' },
    ]);
    const fromBoxes = computeCargoVolumeLiters({
      small_box_qty: 1,
      medium_box_qty: 1,
      large_box_qty: 0,
    });

    expect(fromItems).toBeGreaterThan(0);
    expect(fromItems).toBe(fromBoxes);
  });
});