// src/services/providerLiveService.ts
//
// Live location of providers who are ONLINE on a route, before any delivery is
// accepted. (Once a delivery is accepted, tracking continues through the
// existing delivery_locations table / useProviderLocationBroadcast.)
//
//  - Provider side : useProviderRouteBroadcast()  -> writes provider_live_locations
//  - Sender side   : fetchLiveFixes(), subscribeLiveFixes() -> read / realtime
import { useEffect, useRef } from 'react';
import * as Location from 'expo-location';
import { supabase } from '../utils/supabase';
import { requestForegroundLocationPermission } from './locationService';

export type LiveFix = {
  providerId: number;
  routeId: number | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  updated_at: string;
};

/** A fix older than this is shown as "Stale" / not live. */
export const LIVE_STALE_MS = 60_000;

export const isFixFresh = (fix?: LiveFix | null, now = Date.now()) =>
  !!fix && now - new Date(fix.updated_at).getTime() <= LIVE_STALE_MS;

const isFiniteNum = (n: any): n is number => typeof n === 'number' && Number.isFinite(n);

const rowToFix = (r: any): LiveFix => ({
  providerId: r.provider_id,
  routeId: r.route_id ?? null,
  latitude: r.latitude,
  longitude: r.longitude,
  heading: r.heading ?? null,
  speed: r.speed ?? null,
  accuracy: r.accuracy ?? null,
  updated_at: r.updated_at,
});

/* ------------------------------ sender side ------------------------------ */

/** Latest fixes for the given providers. Never rejects. */
export async function fetchLiveFixes(providerIds: number[]): Promise<Record<number, LiveFix>> {
  const out: Record<number, LiveFix> = {};
  try {
    const ids = Array.from(new Set(providerIds.filter(Boolean)));
    if (ids.length === 0) return out;
    const { data, error } = await supabase
      .from('provider_live_locations')
      .select('provider_id, route_id, latitude, longitude, heading, speed, accuracy, updated_at')
      .in('provider_id', ids);
    if (error) {
      console.warn('[live] fetchLiveFixes error:', error.message);
      return out;
    }
    (data || []).forEach((r: any) => { out[r.provider_id] = rowToFix(r); });
  } catch (e) {
    console.warn('[live] fetchLiveFixes threw:', e);
  }
  return out;
}

/**
 * Realtime stream of every provider's fix. Callback gets a fix, or
 * { providerId, deleted: true } when a provider goes offline.
 * Returns an unsubscribe function.
 */
export function subscribeLiveFixes(
  onChange: (change: { fix?: LiveFix; providerId: number; deleted?: boolean }) => void,
): () => void {
  const ch = supabase
    .channel(`provider-live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'provider_live_locations' },
      (payload: any) => {
        try {
          if (payload.eventType === 'DELETE') {
            const id = payload.old?.provider_id;
            if (id) onChange({ providerId: id, deleted: true });
            return;
          }
          const row = payload.new;
          if (row?.provider_id) onChange({ providerId: row.provider_id, fix: rowToFix(row) });
        } catch (e) {
          console.warn('[live] realtime handler error:', e);
        }
      },
    )
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

/* ----------------------------- provider side ----------------------------- */

type BroadcastOptions = {
  providerId: number | null | undefined;
  routeId: number | null | undefined;
  /** true while the provider is online with an active route */
  active: boolean;
  intervalMs?: number;
};

/**
 * Publishes the provider's position while they are online on a route, and removes
 * it when they go offline / leave the screen. Foreground only (while the app is open).
 */
export function useProviderRouteBroadcast({
  providerId, routeId, active, intervalMs = 8000,
}: BroadcastOptions) {
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const lastPushRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    const stop = async () => {
      if (subRef.current) { subRef.current.remove(); subRef.current = null; }
      if (providerId) {
        try {
          await supabase.from('provider_live_locations').delete().eq('provider_id', providerId);
        } catch { /* ignore */ }
      }
    };

    const start = async () => {
      if (!active || !providerId || !routeId) { await stop(); return; }
      try {
        if (!(await Location.hasServicesEnabledAsync())) return;
      } catch { return; }
      const granted = await requestForegroundLocationPermission().catch(() => false);
      if (!granted || cancelled) return;

      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: intervalMs, distanceInterval: 10 },
          (pos) => {
            try {
              const now = Date.now();
              if (now - lastPushRef.current < intervalMs - 500) return;
              lastPushRef.current = now;
              const { latitude, longitude, heading, speed, accuracy } = pos.coords;
              if (!isFiniteNum(latitude) || !isFiniteNum(longitude)) return;
              supabase
                .from('provider_live_locations')
                .upsert(
                  {
                    provider_id: providerId,
                    route_id: routeId,
                    latitude,
                    longitude,
                    heading: isFiniteNum(heading) ? heading : null,
                    speed: isFiniteNum(speed) ? speed : null,
                    accuracy: isFiniteNum(accuracy) ? accuracy : null,
                    updated_at: new Date(pos.timestamp).toISOString(),
                  },
                  { onConflict: 'provider_id' },
                )
                .then(({ error }) => { if (error) console.warn('[live] push failed:', error.message); });
            } catch (e) {
              console.warn('[live] position handler error:', e);
            }
          },
        );
        if (cancelled) sub.remove(); else subRef.current = sub;
      } catch (e) {
        console.warn('[live] watchPositionAsync failed:', e);
      }
    };

    start().catch((e) => console.warn('[live] start() rejected:', e));

    return () => {
      cancelled = true;
      stop().catch(() => {});
    };
  }, [active, providerId, routeId, intervalMs]);
}