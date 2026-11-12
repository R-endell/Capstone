// src/modules/Dashboard/Sender/Delivery/ScheduleContext.tsx
import React, { createContext, useContext, useReducer } from 'react';

type DropoffType = 'curb-side' | 'door-to-door' | null;
type ShipmentSize = 'Small' | 'Medium' | 'Large';
export type FallbackActionType = 'return_to_sender' | 'leave_with_guard';

export interface ShipmentItem {
  id: string;
  size: ShipmentSize;
  description: string;
  photoUri: string | null;
  fragile: boolean;
}

interface LocationInfo {
  name?: string;
  address: string;
  latitude: number;
  longitude: number;
  note?: string;
}

export interface PreferredRouteInfo {
  pickup: string;
  dropoff: string;
  pickupCoords: { lat: number; lng: number };
  dropoffCoords: { lat: number; lng: number };
}

export interface ScheduleState {
  receiver: any | null;
  dropoffType: DropoffType;
  items: ShipmentItem[];
  scheduledDate: Date | null;
  pickupLocation: LocationInfo | null;
  dropoffLocation: LocationInfo | null;
  estimatedCost: number | null;
  baseFare: number | null;
  returnDeposit: number;
  fallbackAction: FallbackActionType;
  fallbackRecipientName: string;
  isEdit?: boolean;
  mode?: 'sendNow' | 'schedule';
  editIds?: {
    requestId: number;
    cargoId: number;
    pickupLocId: number;
    dropoffLocId: number;
  };
  explorePickup: LocationInfo | null;
  exploreDropoff: LocationInfo | null;
  preferredProviderId?: number | null;
  preferredRouteId?: number | null;
  preferredProviderName?: string | null;
  preferredRoute?: PreferredRouteInfo | null;
}

type Action =
  | { type: 'SET_MODE'; payload: 'sendNow' | 'schedule' }
  | { type: 'SET_EDIT_DATA'; payload: ScheduleState['editIds'] }
  | { type: 'SET_DROPOFF_TYPE'; payload: DropoffType }
  | { type: 'ADD_ITEM'; payload: ShipmentItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'SET_SCHEDULED_DATE'; payload: Date }
  | { type: 'SET_PICKUP_LOCATION'; payload: LocationInfo }
  | { type: 'SET_DROPOFF_LOCATION'; payload: LocationInfo }
  | { type: 'SET_ESTIMATED_COST'; payload: number }
  | { type: 'SET_FALLBACK_CONFIG'; payload: { fallbackAction: FallbackActionType; fallbackRecipientName?: string; baseFare?: number; returnDeposit?: number } }
  | { type: 'RESET' }
  | { type: 'SET_INITIAL_STATE'; payload: Partial<ScheduleState> }
  | { type: 'SET_EXPLORE_PICKUP'; payload: LocationInfo | null }
  | { type: 'SET_EXPLORE_DROPOFF'; payload: LocationInfo | null }
  | {
      type: 'SET_PREFERRED_PROVIDER';
      payload: {
        providerId: number;
        routeId: number;
        name?: string | null;
        route?: PreferredRouteInfo | null;
      } | null;
    };

const initialState: ScheduleState = {
  dropoffType: null,
  items: [],
  scheduledDate: null,
  pickupLocation: null,
  dropoffLocation: null,
  estimatedCost: null,
  baseFare: null,
  returnDeposit: 0,
  fallbackAction: 'return_to_sender',
  fallbackRecipientName: '',
  isEdit: false,
  mode: undefined,
  editIds: undefined,
  explorePickup: null,
  exploreDropoff: null,
  preferredProviderId: null,
  preferredRouteId: null,
  preferredProviderName: null,
  preferredRoute: null,
  receiver: null,
};

function scheduleReducer(state: ScheduleState, action: Action): ScheduleState {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.payload };
    case 'SET_DROPOFF_TYPE':
      return { ...state, dropoffType: action.payload };
    case 'ADD_ITEM':
      return { ...state, items: [...state.items, action.payload] };
    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter(i => i.id !== action.payload) };
    case 'SET_SCHEDULED_DATE':
      return { ...state, scheduledDate: action.payload };
    case 'SET_PICKUP_LOCATION':
      return { ...state, pickupLocation: action.payload };
    case 'SET_DROPOFF_LOCATION':
      return { ...state, dropoffLocation: action.payload };
    case 'SET_ESTIMATED_COST':
      return { ...state, estimatedCost: action.payload };
    case 'SET_FALLBACK_CONFIG':
      return {
        ...state,
        fallbackAction: action.payload.fallbackAction,
        fallbackRecipientName: action.payload.fallbackRecipientName ?? state.fallbackRecipientName,
        baseFare: action.payload.baseFare ?? state.baseFare,
        returnDeposit: action.payload.returnDeposit ?? state.returnDeposit,
      };
    case 'SET_INITIAL_STATE':
      return { ...state, ...action.payload };
    case 'SET_EDIT_DATA':
      return { ...state, isEdit: true, editIds: action.payload };
    case 'RESET':
      return initialState;
    case 'SET_EXPLORE_PICKUP':
      return { ...state, explorePickup: action.payload };
    case 'SET_EXPLORE_DROPOFF':
      return { ...state, exploreDropoff: action.payload };
    case 'SET_PREFERRED_PROVIDER':
      if (!action.payload) {
        return {
          ...state,
          preferredProviderId: null,
          preferredRouteId: null,
          preferredProviderName: null,
          preferredRoute: null,
        };
      }
      return {
        ...state,
        preferredProviderId: action.payload.providerId,
        preferredRouteId: action.payload.routeId,
        preferredProviderName: action.payload.name ?? null,
        preferredRoute: action.payload.route ?? null,
      };
    default:
      return state;
  }
}

const ScheduleContext = createContext<{
  state: ScheduleState;
  dispatch: React.Dispatch<Action>;
}>({
  state: initialState,
  dispatch: () => null,
});

export const ScheduleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(scheduleReducer, initialState);
  return (
    <ScheduleContext.Provider value={{ state, dispatch }}>
      {children}
    </ScheduleContext.Provider>
  );
};

export const useSchedule = () => useContext(ScheduleContext);