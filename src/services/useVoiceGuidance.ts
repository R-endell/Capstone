// src/services/useVoiceGuidance.ts
// Spoken turn-by-turn, driven by the REAL navigation progress (navigationEngine.computeProgress),
// not by static text. Each upcoming maneuver is announced at most once per distance tier:
//
//     far  (<= 500 m)  "In 500 meters, turn right onto Osmeña Boulevard."
//     near (<= 150 m)  "In 100 meters, turn right onto Osmeña Boulevard."
//     now  (<=  30 m)  "Turn right onto Osmeña Boulevard."
//
// Plus: start of navigation, rerouting, GPS lost / restored, and arrival.
// If speech is unavailable on the device every call fails silently (the visual banner still works).
import { useCallback, useEffect, useRef, useState } from 'react';

// Loaded defensively: if the installed app build does not contain the native speech module yet,
// voice is simply off and navigation keeps working (instead of crashing the app on load).
let Speech: typeof import('expo-speech') | null = null;
try { Speech = require('expo-speech'); } catch { Speech = null; }
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NOW_THRESHOLD_M, OFF_ROUTE_M } from './navigationEngine';
import type { NavProgress } from './navigationEngine';

const MUTE_KEY = 'nav_voice_muted';
const FAR_M = 500;
const NEAR_M = 150;
const TIERS = ['far', 'near', 'now'] as const;
type Tier = (typeof TIERS)[number];

type Status =
  | 'locating' | 'routing' | 'active' | 'rerouting' | 'paused' | 'arrived'
  | 'permission-denied' | 'services-off' | 'gps-error';

/* ------------------------------ mute (saved) ------------------------------ */
/** Same shape as useState(false), but remembers the choice between orders / app restarts. */
export function usePersistedMute() {
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(MUTE_KEY).then(v => { if (v === '1') setMutedState(true); }).catch(() => {});
  }, []);
  const setMuted = useCallback((next: boolean | ((m: boolean) => boolean)) => {
    setMutedState(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      AsyncStorage.setItem(MUTE_KEY, value ? '1' : '0').catch(() => {});
      return value;
    });
  }, []);
  return [muted, setMuted] as const;
}

/* -------------------------------- wording -------------------------------- */
const spokenDistance = (m: number) => {
  if (m >= 1000) return `${Math.round(m / 100) / 10} kilometers`;
  return `${Math.max(50, Math.round(m / 50) * 50)} meters`;
};
// Google can return multi-line text ("Turn right onto X\nPass by Y"): keep the maneuver line only.
const cleanInstruction = (s: string) => (s || '').split('\n')[0].replace(/\s+/g, ' ').trim();
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/* -------------------------------- speaking -------------------------------- */
let sayId = 0;
async function say(text: string, interrupt = true) {
  if (!Speech) return;
  const id = ++sayId;
  try {
    if (interrupt && (await Speech.isSpeakingAsync())) await Speech.stop();
    if (id !== sayId && interrupt) return;           // a newer announcement took over
    Speech.speak(text, { language: 'en-US', rate: 0.95, onError: () => {} });
  } catch { /* speech not available: stay silent */ }
}

/* --------------------------------- hook ---------------------------------- */
type Args = {
  /** false = muted, or this map is just a preview, or GPS is blocked */
  enabled: boolean;
  progress: NavProgress | null;
  status: Status;
  /** changes when the destination changes (pickup -> drop-off) */
  targetKey: string;
  targetLabel: 'P' | 'D';
};

export function useVoiceGuidance({ enabled, progress, status, targetKey, targetLabel }: Args) {
  const place = targetLabel === 'P' ? 'pickup location' : 'drop-off location';
  const mem = useRef({
    sig: '', minD: Infinity, spoken: new Set<Tier>(),
    startedFor: '', arrivedFor: '', lastStatus: '' as string, introAt: 0,
  });

  // muting (or leaving the screen) silences speech right away
  useEffect(() => {
    if (!enabled) { try { void Speech?.stop(); } catch { /* ignore */ } }
  }, [enabled]);
  useEffect(() => () => { try { void Speech?.stop(); } catch { /* ignore */ } }, []);

  /* events: start, reroute, GPS lost / back, arrival */
  useEffect(() => {
    const m = mem.current;
    const prev = m.lastStatus;
    m.lastStatus = status;
    if (!enabled) return;

    if (status === 'active' && m.startedFor !== targetKey) {
      m.startedFor = targetKey;
      m.sig = ''; m.minD = Infinity; m.spoken.clear();
      m.introAt = Date.now();
      void say(`Navigating to the ${place}.`);
      return;
    }
    if (status === 'arrived' && m.arrivedFor !== targetKey) {
      m.arrivedFor = targetKey;
      void say(`You have arrived at the ${place}.`);
      return;
    }
    if (status === 'rerouting' && prev !== 'rerouting') { void say('Rerouting.'); return; }
    if (status === 'paused' && prev !== 'paused') { void say('GPS signal lost.'); return; }
    if (status === 'active' && prev === 'paused') { void say('GPS signal restored.'); }
  }, [status, enabled, targetKey, place]);

  /* maneuvers: speak each upcoming instruction once per tier */
  useEffect(() => {
    if (!enabled || !progress || status !== 'active') return;
    if (progress.offRouteM > OFF_ROUTE_M) return;     // position doesn't match the route: don't guess

    const m = mem.current;
    const d = progress.distToManeuverM;
    const sig = `${progress.maneuver}|${progress.instruction}`;
    // new maneuver, or we passed one and the next is farther away (even if it reads the same)
    if (sig !== m.sig || d > m.minD + 60) { m.sig = sig; m.minD = d; m.spoken.clear(); }
    m.minD = Math.min(m.minD, d);

    const tier: Tier | null = d <= NOW_THRESHOLD_M ? 'now' : d <= NEAR_M ? 'near' : d <= FAR_M ? 'far' : null;
    if (!tier || m.spoken.has(tier)) return;
    // the tier we are in, and any farther tier we skipped, count as done
    for (const t of TIERS) { m.spoken.add(t); if (t === tier) break; }

    let text = '';
    if (progress.isArrival) {
      if (tier === 'now') return;                      // "You have arrived" is spoken by the status event
      text = `Your ${place} is in ${spokenDistance(d)}.`;
    } else {
      const instr = cleanInstruction(progress.instruction);
      if (!instr) return;
      if (tier === 'far' && progress.maneuver === 'STRAIGHT') return;   // "continue" is not worth a far warning
      text = tier === 'now' ? instr : `In ${spokenDistance(d)}, ${lowerFirst(instr)}`;
    }
    // don't cut off the "Navigating to…" intro with the first departure instruction
    const interrupt = Date.now() - m.introAt > 4000;
    void say(text, interrupt);
  }, [enabled, progress, status, place]);
}