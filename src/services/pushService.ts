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

/**
 * Fire a push to another user via the send-push edge function.
 * Fails silently — pushes are non-critical.
 */
export async function notifyUser(
  targetUserId: number,
  title: string,
  body: string,
  data?: Record<string, any>,
): Promise<void> {
  try {
    await supabase.functions.invoke('send-push', {
      body: { user_id: targetUserId, title, body, data: data ?? {} },
    });
  } catch (e) {
    console.warn('[push] notify failed:', e);
  }
}