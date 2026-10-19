// src/utils/notifRouter.ts
import { supabase } from './supabase';

export type NotifRow = {
  notif_id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  ref_id: number | null;
};

export type NotifRouterOptions = {
  /** 'sender' | 'provider' — used to pick the right tab stack when possible. */
  role?: 'sender' | 'provider';
};

/**
 * Given a notification row and a navigation object, this navigates
 * to the correct screen. Returns true if it handled the navigation,
 * false if the caller should fall back to showing an Alert.
 */
export async function routeNotification(
  navigation: any,
  n: NotifRow,
  options: NotifRouterOptions = {},
): Promise<boolean> {
  const type = (n.type || '').toLowerCase();
  const ref = n.ref_id;
  const role = options.role || 'sender';

  // ---- CHAT (real chat, not support) ------------------------------
  if (type === 'chat') {
    const roomId = typeof ref === 'number' ? ref : null;
    if (role === 'provider') {
      navigation.navigate('ProviderTabs', {
        screen: 'Messages',
        params: roomId ? { openRoomId: roomId } : undefined,
      });
    } else {
      navigation.navigate('MainTabs', {
        screen: 'Messages',
        params: roomId ? { openRoomId: roomId } : undefined,
      });
    }
    return true;
  }

  // ---- SUPPORT ----------------------------------------------------
  if (type.startsWith('support')) {
    // Support is not a separate screen in the app — open Notifications
    // list so the support thread modal can be opened there.
    navigation.navigate('NotificationsList');
    return true;
  }

  // ---- DISPUTES ---------------------------------------------------
  if (type.startsWith('dispute')) {
    if (ref == null) {
      navigation.navigate('DisputeCenter');
      return true;
    }
    if (typeof ref === 'number') {
      navigation.navigate('DisputeDetail', { disputeId: ref });
      return true;
    }
    // ref is a string (dispute_ref). Look up the numeric id.
    try {
      const { data } = await supabase
        .from('disputes')
        .select('dispute_id')
        .eq('dispute_ref', String(ref))
        .maybeSingle();
      if (data?.dispute_id) {
        navigation.navigate('DisputeDetail', { disputeId: data.dispute_id });
      } else {
        navigation.navigate('DisputeCenter');
      }
    } catch {
      navigation.navigate('DisputeCenter');
    }
    return true;
  }

  // ---- DELIVERY / MATCH / PAYMENT ---------------------------------
  if (
    type.startsWith('delivery') ||
    type === 'match' ||
    type === 'payment' ||
    type === 'escrow'
  ) {
    // We want to redirect to the list screens (Activity/Task), NOT LiveTracking.
    // We pass the ref (which is usually the delivery_id or request_id) as a param 
    // so the destination screen can highlight or scroll to the correct item.
    
    // Provider → Task Screen
    if (role === 'provider') {
      navigation.navigate('ProviderTabs', { 
        screen: 'Task',
        params: { highlightDeliveryId: ref } 
      });
    } 
    // Sender → Activity Screen
    else {
      navigation.navigate('MainTabs', { 
        screen: 'Activity',
        params: { highlightDeliveryId: ref } 
      });
    }
    return true;
  }

  // ---- UNKNOWN ----------------------------------------------------
  return false;
}