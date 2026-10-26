// src/services/tabBarVisibilityStore.ts
// Tiny shared flag: screens ask for the bottom tab bar to be hidden, and the
// tab navigator in App.tsx listens. Keeps the navigator's own tab bar styling.
import { useSyncExternalStore } from 'react';

let hidden = false;
const listeners = new Set<() => void>();

export function setTabBarHidden(next: boolean) {
  if (hidden === next) return;
  hidden = next;
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => hidden);
}