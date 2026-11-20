// __tests__/routeService.test.ts
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../src/utils/supabase', () => ({
  supabase: {
    from: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

import {
  computePricing,
  quickEstimateKm,
  parseNaiveRouteTime,
} from '../src/services/routeService';
import { CTU_TO_IT_PARK_POLYLINE } from './fixtures/cebuRoutes';

describe('routeService — Pricing Rules', () => {
  const oneSmallItem = [
    { id: 'small-1', description: 'Small item', photoUri: '', size: 'Small' as const, fragile: false },
  ];
  const oneMediumFragile = [
    {
      id: 'medium-1',
      description: 'Medium item',
      photoUri: '',
      size: 'Medium' as const,
      fragile: true,
    },
  ];

  it('charges ₱20 base fee for Curb-side deliveries', () => {
    const res = computePricing({
      distanceKm: 3.0,
      items: oneSmallItem,
      scheduled: false,
      dropoffType: 'curb-side',
      refined: true,
    });
    expect(res.base).toBe(20);
    expect(res.total).toBeGreaterThanOrEqual(20);
  });

  it('charges ₱45 base fee for Door-to-Door deliveries (+₱25 over Curb-side)', () => {
    const curb = computePricing({
      distanceKm: 3.0,
      items: oneSmallItem,
      scheduled: false,
      dropoffType: 'curb-side',
      refined: true,
    });
    const door = computePricing({
      distanceKm: 3.0,
      items: oneSmallItem,
      scheduled: false,
      dropoffType: 'door-to-door',
      refined: true,
    });

    expect(door.base).toBe(45);
    expect(door.total - curb.total).toBe(25);
  });

  it('adds size and fragile handling fees accurately', () => {
    const standard = computePricing({
      distanceKm: 4.0,
      items: oneSmallItem,
      scheduled: false,
      dropoffType: 'door-to-door',
      refined: true,
    });
    const fragileMed = computePricing({
      distanceKm: 4.0,
      items: oneMediumFragile,
      scheduled: false,
      dropoffType: 'door-to-door',
      refined: true,
    });

    expect(fragileMed.fragile).toBeGreaterThan(0);
    expect(fragileMed.total).toBeGreaterThan(standard.total);
  });
});

describe('routeService — Distance & Naive Timezone Parsing', () => {
  it('estimates realistic road distance between CTU Main and Cebu IT Park (~3–6 km)', () => {
    const start = CTU_TO_IT_PARK_POLYLINE[0];
    const end = CTU_TO_IT_PARK_POLYLINE[CTU_TO_IT_PARK_POLYLINE.length - 1];
    const km = quickEstimateKm(start, end);
    expect(km).toBeGreaterThan(2.5);
    expect(km).toBeLessThan(7.0);
  });

  it('parses naive Manila DB timestamps without adding +8 hours', () => {
    const parsed = parseNaiveRouteTime('2026-11-21 08:15:00');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10); // November (0-indexed)
    expect(parsed.getDate()).toBe(21);
    expect(parsed.getHours()).toBe(8);
    expect(parsed.getMinutes()).toBe(15);
  });
});