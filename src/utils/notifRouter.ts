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
 * Helper to detect if a notification row is actually about a wallet withdrawal / cashout / payout,
 * even if a backend trigger or service accidentally tagged `type` as 'dispute'.
 */
export function isWithdrawalNotif(n: Pick<NotifRow, 'type' | 'title' | 'body'>): boolean {
  const t = (n.type || '').toLowerCase();
  const title = (n.title || '').toLowerCase();
  const body = (n.body || '').toLowerCase();

  if (
    t.startsWith('withdraw') ||
    t.startsWith('cashout') ||
    t.startsWith('payout') ||
    t === 'wallet'
  ) {
    return true;
  }

  // Catch notifications whose body/title clearly describes a withdrawal/cashout/GCash/Maya payout
  const text = `${title} ${body}`;
  if (
    /\b(withdrawal|withdrawn|cash\s*out|cashout|payout)\b/i.test(text) &&
    !/\b(dispute|parcel|package|sender|courier)\b/i.test(body)
  ) {
    return true;
  }

  return false;
}

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

  // ---- WITHDRAWAL / CASHOUT / PAYOUT / WALLET ---------------------
  if (isWithdrawalNotif(n)) {
    const withdrawalId = typeof ref === 'number' ? ref : null;
    try {
      navigation.navigate('ProviderTabs', {
        screen: 'Earnings',
        params: {
          initialTab: 'withdrawals',
          highlightWithdrawalId: withdrawalId,
        },
      });
    } catch {
      navigation.navigate('Earnings', {
        initialTab: 'withdrawals',
        highlightWithdrawalId: withdrawalId,
      });
    }
    return true;
  }

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

  // ---- TICKETS (new help flow) -------------------------------------
  if (type === 'ticket') {
    if (typeof ref === 'number') {
      navigation.navigate('TicketDetail', { ticketId: ref });
    } else {
      navigation.navigate('Support', { role });
    }
    return true;
  }

  // ---- SUPPORT (legacy types) --------------------------------------
  if (type.startsWith('support')) {
    navigation.navigate('Support', { role });
    return true;
  }

  // ---- DISPUTES ---------------------------------------------------
  if (type.startsWith('dispute')) {
    if (ref == null) {
      navigation.navigate('Support', { role });
      return true;
    }
    if (typeof ref === 'number') {
      // Admin decisions still arrive as 'dispute' notifications. If this dispute is
      // mirrored by a ticket, open the ticket; otherwise fall back to the old screen.
      try {
        const { data: tk } = await supabase
          .from('support_tickets')
          .select('ticket_id')
          .eq('legacy_dispute_id', ref)
          .maybeSingle();
        if (tk?.ticket_id) {
          navigation.navigate('TicketDetail', { ticketId: tk.ticket_id });
          return true;
        }
      } catch {}
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
        navigation.navigate('Support', { role });
      }
    } catch {
      navigation.navigate('Support', { role });
    }
    return true;
  }

  // ---- DELIVERY / MATCH / PAYMENT / ESCROW ------------------------
  if (
    type.startsWith('delivery') ||
    type === 'match' ||
    type === 'payment' ||
    type === 'escrow'
  ) {
    // Provider → Task Screen
    if (role === 'provider') {
      navigation.navigate('ProviderTabs', {
        screen: 'Task',
        params: { highlightDeliveryId: ref },
      });
    }
    // Sender → Activity Screen
    else {
      navigation.navigate('MainTabs', {
        screen: 'Activity',
        params: { highlightDeliveryId: ref },
      });
    }
    return true;
  }

  // ---- UNKNOWN ----------------------------------------------------
  return false;
}