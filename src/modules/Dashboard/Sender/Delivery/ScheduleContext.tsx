import React, { createContext, useContext, useReducer } from 'react';

// ---- Types ----
type DropoffType = 'curb-side' | 'door-to-door' | null;
type ShipmentSize = 'Small' | 'Medium' | 'Large';

export interface ShipmentItem {
  id: string;
  size: ShipmentSize;
  description: string;
  photoUri: string | null;
  fragile: boolean;
}

interface LocationInfo {
  address: string;
  latitude: number;
  longitude: number;
}

export interface ScheduleState {
  dropoffType: DropoffType;
  items: ShipmentItem[];
  scheduledDate: Date | null;
  pickupLocation: LocationInfo | null;
  dropoffLocation: LocationInfo | null;
  estimatedCost: number | null;
  isEdit?: boolean;
  mode?: 'sendNow' | 'schedule';
  editIds?: {
    requestId: number;
    cargoId: number;
    pickupLocId: number;
    dropoffLocId: number;
  };
}

type Action =
  | { type: 'SET_MODE'; payload: 'sendNow' | 'schedule' }
  | { type: 'SET_EDIT_DATA'; payload: ScheduleState['editIds'] }
  | { type: 'SET_DROPOFF_TYPE'; payload: DropoffType }
  | { type: 'ADD_ITEM'; payload: ShipmentItem }
  | { type: 'REMOVE_ITEM'; payload: string } // id
  | { type: 'SET_SCHEDULED_DATE'; payload: Date }
  | { type: 'SET_PICKUP_LOCATION'; payload: LocationInfo }
  | { type: 'SET_DROPOFF_LOCATION'; payload: LocationInfo }
  | { type: 'SET_ESTIMATED_COST'; payload: number }
  | { type: 'RESET' }
  | { type: 'SET_INITIAL_STATE'; payload: Partial<ScheduleState> };

const initialState: ScheduleState = {
  dropoffType: null,
  items: [],
  scheduledDate: null,
  pickupLocation: null,
  dropoffLocation: null,
  estimatedCost: null,
  isEdit: false,
  mode: undefined,
  editIds: undefined,
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
    case 'SET_INITIAL_STATE':
      return { ...state, ...action.payload };
    case 'SET_EDIT_DATA':
      return { ...state, isEdit: true, editIds: action.payload };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
}

const ScheduleContext = createContext<{
  state: ScheduleState;
  dispatch: React.Dispatch<Action>;
}>({ state: initialState, dispatch: () => {} });

export const ScheduleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(scheduleReducer, initialState);
  return (
    <ScheduleContext.Provider value={{ state, dispatch }}>
      {children}
    </ScheduleContext.Provider>
  );
};

export const useSchedule = () => useContext(ScheduleContext);