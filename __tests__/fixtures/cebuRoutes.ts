// __tests__/fixtures/cebuRoutes.ts
export type Coord = { latitude: number; longitude: number };

// Real Cebu City corridor: CTU Main Campus (M.J. Cuenco) -> Mabolo -> Cebu IT Park
export const CTU_TO_IT_PARK_POLYLINE: Coord[] = [
  { latitude: 10.29743, longitude: 123.90670 }, // CTU Main / M.J. Cuenco Ave
  { latitude: 10.30163, longitude: 123.90656 }, // M.J. Cuenco Northbound
  { latitude: 10.30617, longitude: 123.90617 }, // Carreta / Mabolo boundary
  { latitude: 10.31056, longitude: 123.90416 }, // Mabolo Church area
  { latitude: 10.31530, longitude: 123.90163 }, // Pope John Paul II Ave
  { latitude: 10.32026, longitude: 123.90377 }, // Approaching IT Park
  { latitude: 10.32500, longitude: 123.90692 }, // Salinas Dr / IT Park entrance
  { latitude: 10.32733, longitude: 123.90627 }, // Cebu IT Park (Jose Maria del Mar)
];

export const MOCK_ROUTE_PRIMARY = {
  route_id: 101,
  provider_id: 1,
  is_active: true,
  is_deleted: false,
  fallback_unlocked: false,
  fallback_used: false,
  corridor_path: CTU_TO_IT_PARK_POLYLINE,
  start_location: {
    place_name: 'CTU Gymnatorium',
    street_address: 'M.J. Cuenco Avenue, Cebu City',
    latitude: 10.29743,
    longitude: 123.90670,
  },
  end_location: {
    place_name: 'Cebu IT Park',
    street_address: 'Jose Maria del Mar Avenue, Apas, Cebu City',
    latitude: 10.32733,
    longitude: 123.90627,
  },
};

export const MOCK_ROUTE_WITH_FALLBACK = {
  ...MOCK_ROUTE_PRIMARY,
  route_id: 102,
  fallback_unlocked: true,
  fallback_used: false,
};

// Points at known perpendicular offsets from the CTU -> IT Park corridor
export const PINS = {
  // ~10m off-route near M.J. Cuenco (valid Curb-side pickup)
  onRouteStart: { latitude: 10.30165, longitude: 123.90665 },
  // ~100m off-route near Mabolo (valid Curb-side, triggers >15m landmark snap)
  curbside100m: { latitude: 10.31056, longitude: 123.90505 },
  // ~350m off-route near Mabolo (outside 200m Curb-side, inside 500m Door-to-Door)
  doorToDoor350m: { latitude: 10.31056, longitude: 123.90735 },
  // ~750m off-route (outside 500m primary, inside 1000m Door-to-Door fallback)
  fallback750m: { latitude: 10.31056, longitude: 123.91100 },
  // ~1.8km off-route (outside all corridors)
  farOffRoute: { latitude: 10.31056, longitude: 123.92060 },
  // ~20m off-route near IT Park (valid forward drop-off)
  onRouteEnd: { latitude: 10.32510, longitude: 123.90685 },
};

export const buildMockRequest = (overrides: {
  pickup_type?: 'curb-side' | 'door-to-door';
  pickup?: Coord;
  dropoff?: Coord;
}) => ({
  request_id: 500,
  pickup_type: overrides.pickup_type ?? 'curb-side',
  delivery_status: 'Pending',
  payment_status: 'held',
  pickup_location: {
    latitude: (overrides.pickup ?? PINS.onRouteStart).latitude,
    longitude: (overrides.pickup ?? PINS.onRouteStart).longitude,
  },
  dropoff_location: {
    latitude: (overrides.dropoff ?? PINS.onRouteEnd).latitude,
    longitude: (overrides.dropoff ?? PINS.onRouteEnd).longitude,
  },
});