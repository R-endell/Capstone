// src/services/providerApplicationNotifier.ts
//
// Push notification when the admin APPROVES (or rejects) a provider application.
//
// How it works
//  * RegisterProviderScreen calls markApplicationPending() right after the application is submitted.
//  * AccountScreen calls notifyOnApplicationDecision() whenever it learns the current status (on open and live,
//    through the realtime subscription on provider_verifications).
//  * A notification is only sent for a REAL change: the stored last status was "pending" and now it is
//    "approved" / "rejected". Opening the app later never repeats it.
//
// Two ways to deliver the push:
//  1) SERVER (recommended, works even when the app is closed): run
//     supabase/migrations/20261122_provider_application_push.sql, then set SERVER_PUSH_ENABLED = true below.
//     The database itself sends the push the moment the admin changes the status.
//  2) CLIENT fallback (SERVER_PUSH_ENABLED = false): the phone sends the push to itself when it sees the change.
//     This only works while the app is running (foreground or kept alive in the background).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notifyUser } from './pushService';

/** Set to true after the SQL trigger is installed, so the phone does not send a duplicate. */
export const SERVER_PUSH_ENABLED = false;

type AppStatus = 'none' | 'pending' | 'approved' | 'rejected';

const storageKey = (userId: number) => `provider_application_status_${userId}`;
const busy = new Set<number>();

/** Call right after a provider application is submitted. */
export const markApplicationPending = async (userId: number) => {
  try { await AsyncStorage.setItem(storageKey(userId), 'pending'); } catch { /* ignore */ }
};

export const notifyOnApplicationDecision = async (userId: number, status: AppStatus, reason?: string | null) => {
  if (!userId || busy.has(userId)) return;      // fetch + realtime can report the same change at once
  busy.add(userId);
  try {
    const prev = await AsyncStorage.getItem(storageKey(userId));
    if (prev === status) return;
    await AsyncStorage.setItem(storageKey(userId), status);

    if (prev !== 'pending') return;              // only pending -> approved / rejected is a decision
    if (SERVER_PUSH_ENABLED) return;             // the database already sent it

    if (status === 'approved') {
      await notifyUser(
        userId,
        'Provider application approved 🎉',
        'Congratulations! Your provider application was approved. Switch to Provider Mode to start accepting deliveries.',
        { type: 'provider_application', status: 'approved' },
      );
    } else if (status === 'rejected') {
      await notifyUser(
        userId,
        'Provider application not approved',
        reason?.trim()
          ? `Reason: ${reason.trim()}`
          : 'Your provider application was not approved. Open the app to review and apply again.',
        { type: 'provider_application', status: 'rejected' },
      );
    }
  } catch (e) {
    console.warn('[providerApplicationNotifier]', e);
  } finally {
    busy.delete(userId);
  }
};