// src/services/pushService.ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from '../utils/supabase';

// Foreground handler — show the notification even if the app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request permission, get the Expo push token, save it for the signed-in user.
 * Idempotent — safe to call on every app start.
 */
export async function registerPushToken(userId: number): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return false;

    const projectId =
      (Constants?.expoConfig?.extra as any)?.eas?.projectId ??
      (Constants?.easConfig as any)?.projectId;
    if (!projectId) {
      console.warn('[push] no EAS projectId');
      return false;
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenResp.data;
    if (!token) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF751F',
      });
    }

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, platform: Platform.OS, updated_at: new Date().toISOString() },
        { onConflict: 'token' },
      );
    if (error) {
      console.warn('[push] token save failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[push] register failed:', e);
    return false;
  }
}

let lastPushError: string | null = null;
/** Reason the most recent notifyUser() did not deliver (null if it did). */
export const getLastPushError = () => lastPushError;

/** supabase.functions.invoke does NOT throw on HTTP errors - dig the real reason out. */
async function describeInvokeError(error: any): Promise<string> {
  try {
    const ctx = error?.context;
    if (ctx && typeof ctx.text === 'function') {
      return `${error?.message ?? 'error'} :: ${await ctx.text()}`;
    }
  } catch { /* ignore */ }
  return String(error?.message ?? error);
}

/**
 * Fire a push to another user via the send-push edge function.
 * Never throws (pushes are non-critical) but now resolves to true only when the
 * push was really handed to at least one device, and logs why when it wasn't.
 */
export async function notifyUser(
  targetUserId: number,
  title: string,
  body: string,
  data?: Record<string, any>,
): Promise<boolean> {
  if (!targetUserId || !Number.isFinite(Number(targetUserId))) {
    lastPushError = 'invalid target user id';
    console.warn('[push] notifyUser called without a valid target user id');
    return false;
  }

  const payload: Record<string, any> = { ...(data ?? {}) };
  if (!payload.type) payload.type = 'general';

  try {
    const { data: resp, error } = await supabase.functions.invoke('send-push', {
      body: { user_id: Number(targetUserId), title, body, data: payload },
    });

    if (error) {
      lastPushError = await describeInvokeError(error);
      console.warn('[push] send-push failed:', lastPushError);
      return false;
    }
    const r: any = resp ?? {};
    if (r.success === false) {
      lastPushError = `send-push error: ${r.error ?? JSON.stringify(r)}`;
      console.warn('[push]', lastPushError);
      return false;
    }
    if (!r.delivered) {
      // e.g. the recipient has no row in push_tokens, or Expo rejected every ticket
      lastPushError = `not delivered to user ${targetUserId}: ${r.reason ?? 'no device accepted the push'}${
        r.errors?.length ? ` ${JSON.stringify(r.errors)}` : ''
      }`;
      console.warn('[push]', lastPushError);
      return false;
    }
    lastPushError = null;
    return true;
  } catch (e: any) {
    lastPushError = String(e?.message ?? e);
    console.warn('[push] notify failed:', e);
    return false;
  }
}