// src/utils/dateUtils.ts
import { formatDistanceToNow, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Hardcoded to Philippine Standard Time (UTC+8).
 * Use this everywhere so the app always displays Manila time,
 * regardless of the device's locale/timezone.
 */
export const MANILA_TZ = 'Asia/Manila';

/* ------------------------------------------------------------------ */
/* Core formatter                                                      */
/* ------------------------------------------------------------------ */
export const formatDate = (
  isoString: string | null | undefined,
  formatStr: string = 'MMM d, yyyy',
  timeZone: string = MANILA_TZ,
): string => {
  if (!isoString) return '—';
  try {
    // Supabase often returns timestamps WITHOUT a timezone indicator
    // (e.g. "2026-09-16T12:42:42.566174"). date-fns-tz then treats them as
    // already being in the target TZ, causing an N-hour display drift.
    // We force UTC interpretation by appending 'Z' when no TZ is present.
    const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(isoString);
    const normalized = hasTz ? isoString : `${isoString}Z`;

    return formatInTimeZone(normalized, timeZone, formatStr);
  } catch (error) {
    console.error('formatDate error:', error, 'input:', isoString);
    return 'Invalid Date';
  }
};

/* ------------------------------------------------------------------ */
/* Convenience wrappers                                                */
/* ------------------------------------------------------------------ */

/** "Sep 16, 2026" */
export const formatDateShort = (isoString?: string | null) =>
  formatDate(isoString, 'MMM d, yyyy');

/** "September 16, 2026" */
export const formatDateLong = (isoString?: string | null) =>
  formatDate(isoString, 'MMMM d, yyyy');

/** "10:30 AM" */
export const formatTime = (isoString?: string | null) =>
  formatDate(isoString, 'h:mm a');

/** "Sep 16, 2026 · 10:30 AM" */
export const formatDateTime = (isoString?: string | null) =>
  formatDate(isoString, 'MMM d, yyyy · h:mm a');

/** "Wed, Sep 16" — nice for route cards */
export const formatDateWithWeekday = (isoString?: string | null) =>
  formatDate(isoString, 'EEE, MMM d');

/** "Sept 16, 10:30 AM" — compact card-friendly */
export const formatCompactDateTime = (isoString?: string | null) =>
  formatDate(isoString, 'MMM d, h:mm a');

/* ------------------------------------------------------------------ */
/* Relative time — also anchored to Manila time                        */
/* ------------------------------------------------------------------ */
export const getTimeAgo = (isoString?: string | null): string => {
  if (!isoString) return '—';
  try {
    return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
  } catch {
    return 'Invalid Date';
  }
};

/* ------------------------------------------------------------------ */
/* Current time helpers                                                */
/* ------------------------------------------------------------------ */

/** Current moment formatted in Manila time */
export const nowInManila = (formatStr: string = 'MMM d, yyyy · h:mm a'): string =>
  formatInTimeZone(new Date(), MANILA_TZ, formatStr);

/** Current hour (0–23) in Manila — useful for greetings */
export const getManilaHour = (): number => {
  const s = formatInTimeZone(new Date(), MANILA_TZ, 'H');
  return parseInt(s, 10);
};

/**
 * Converts a `Date` object into an ISO string, treating the Date's local
 * components (year, month, day, hours, minutes) as Manila time.
 *
 * Why: when the provider picks "Sept 16, 10:30 AM" in the date picker,
 * the picker gives us a Date in *device-local* time. If the device is
 * outside Manila, sending that ISO to the DB would shift the actual
 * departure by the offset. This fixes it.
 */
export const dateToManilaIsoString = (date: Date, time: Date): string => {
  // Extract calendar parts from the Date
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  // Extract clock parts from the Time
  const hh = String(time.getHours()).padStart(2, '0');
  const mm = String(time.getMinutes()).padStart(2, '0');

  // Build a Manila-local ISO with +08:00 offset
  return `${y}-${m}-${d}T${hh}:${mm}:00+08:00`;
};