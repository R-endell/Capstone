// src/services/navigationSessionStore.ts
// "Which delivery is the provider actively navigating to PICKUP right now?"
//
// Set by ProviderNavigationScreen while it is open on the pickup leg; read by TaskScreen,
// which remains the only owner of useProviderLocationBroadcast. This is how location
// sharing starts when navigation starts (and not when an order is merely accepted - a
// scheduled order may be accepted days ahead) and ends when navigation ends.
import { useSyncExternalStore } from 'react';

let activeDeliveryId: number | null = null;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach(l => l());

export function setNavigationSession(deliveryId: number): void {
  if (activeDeliveryId === deliveryId) return;
  activeDeliveryId = deliveryId;
  emit();
}

/** Only clears if `deliveryId` is still the active one (a newer screen may have replaced it). */
export function clearNavigationSession(deliveryId: number): void {
  if (activeDeliveryId !== deliveryId) return;
  activeDeliveryId = null;
  emit();
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const getSnapshot = () => activeDeliveryId;

export const useNavigationSession = (): number | null => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);