// src/services/useProviderLocationBroadcast.ts
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import {
  pushLocationFix,
  requestForegroundLocationPermission,
  ProviderFix,
} from './locationService';
import { setBroadcastTarget } from './locationBroadcastStore';
import {
  startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from './backgroundLocationTask';

type Options = {
  deliveryId: number | null | undefined;
  providerId: number | null | undefined;
  active: boolean;
  intervalMs?: number;
};

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
      if (!active || !deliveryId || !providerId) {
        await setBroadcastTarget(null).catch(() => {});
        await stopBackgroundLocationUpdates().catch(() => {});
        return;
      }

      // 1) GPS HARDWARE GUARD — this is the fix for the crash
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          console.warn('[broadcast] Location Services OFF — skipping broadcast');
          await stopBackgroundLocationUpdates().catch(() => {});
          return;
        }
      } catch (e) {
        console.warn('[broadcast] hasServicesEnabledAsync threw:', e);
        return;
      }

      // 2) Permission
      let granted = false;
      try {
        granted = await requestForegroundLocationPermission();
      } catch (e) {
        console.warn('[broadcast] permission request threw:', e);
      }
      if (!granted || cancelled) return;

      // 3) Persist target for the background task
      try {
        await setBroadcastTarget({
          deliveryId,
          providerId,
          startedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('[broadcast] setBroadcastTarget failed:', e);
      }

      // 4) Background updates (guarded — could throw if location is off mid-session)
      try {
        await startBackgroundLocationUpdates();
      } catch (e) {
        console.warn('[broadcast] startBackgroundLocationUpdates failed:', e);
      }

      // 5) Foreground subscription
      try {
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: intervalMs,
            distanceInterval: 10,
          },
          (pos) => {
            try {
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
              // IMPORTANT: don't let pushLocationFix reject upstream
              pushLocationFix(deliveryId, providerId, fix).catch((e) =>
                console.warn('[broadcast] pushLocationFix failed:', e),
              );
            } catch (e) {
              console.warn('[broadcast] position handler error:', e);
            }
          },
        );

        if (cancelled) sub.remove();
        else subRef.current = sub;
      } catch (e) {
        console.warn('[broadcast] watchPositionAsync failed:', e);
      }
    };

    // The .catch() here is what stops the "Uncaught in promise" crash
    start().catch((e) => console.warn('[broadcast] start() rejected:', e));

    return () => {
      cancelled = true;
      if (subRef.current) {
        subRef.current.remove();
        subRef.current = null;
      }
    };
  }, [active, deliveryId, providerId, intervalMs]);
}