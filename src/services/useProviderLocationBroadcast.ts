// src/services/useProviderLocationBroadcast.ts
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import {
  pushLocationFix,
  requestForegroundLocationPermission,
  ProviderFix,
} from './locationService';

type Options = {
  deliveryId: number | null | undefined;
  providerId: number | null | undefined;
  active: boolean;
  intervalMs?: number;
};

/**
 * Broadcasts the provider's GPS to Supabase while `active` is true.
 * Foreground-only — the courier must have the app open (they do, while delivering).
 */
export function useProviderLocationBroadcast({
  deliveryId,
  providerId,
  active,
  intervalMs = 8000,
}: Options) {
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const lastPushRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!active || !deliveryId || !providerId) return;

      const granted = await requestForegroundLocationPermission();
      if (!granted || cancelled) return;

      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: intervalMs,
            distanceInterval: 10,
          },
          (pos) => {
            const now = Date.now();
            if (now - lastPushRef.current < intervalMs - 500) return;
            lastPushRef.current = now;

            const fix: ProviderFix = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              heading: Number.isFinite(pos.coords.heading as any) ? pos.coords.heading : null,
              speed: Number.isFinite(pos.coords.speed as any) ? pos.coords.speed : null,
              accuracy: Number.isFinite(pos.coords.accuracy as any) ? pos.coords.accuracy : null,
              updated_at: new Date(pos.timestamp).toISOString(),
            };

            pushLocationFix(deliveryId, providerId, fix);
          },
        );

        if (cancelled) sub.remove();
        else subRef.current = sub;
      } catch (e) {
        console.warn('[broadcast] watchPositionAsync failed:', e);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
    };
  }, [active, deliveryId, providerId, intervalMs]);
}