// src/services/callService.ts
import { Alert, Linking } from 'react-native';
import { supabase } from '../utils/supabase';
import { notifyUser } from './pushService';

type OutgoingCallListener = (session: any, calleeName: string, roleLabel: string) => void;
const outgoingListeners = new Set<OutgoingCallListener>();

export const onOutgoingCall = (fn: OutgoingCallListener) => {
  outgoingListeners.add(fn);
  return () => {
    outgoingListeners.delete(fn);
  };
};

export const startCall = async (opts: {
  calleeId?: number | null;
  calleePhone?: string | null;
  calleeName?: string | null;
  roleLabel?: string;
  deliveryId?: number | null;
}) => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      Alert.alert('Not signed in', 'Please log in to make a call.');
      return null;
    }

    const { data: me } = await supabase
      .from('users')
      .select('user_id, first_name, last_name')
      .eq('auth_id', session.user.id)
      .maybeSingle();

    if (!me?.user_id) return null;

    let targetUserId = opts.calleeId ?? null;

    // If calleeId wasn't passed (e.g., calling a Receiver who might have an account by phone)
    if (!targetUserId && opts.calleePhone) {
      const { data: matchedUser } = await supabase
        .from('users')
        .select('user_id')
        .eq('phone_number', opts.calleePhone.trim())
        .maybeSingle();
      if (matchedUser?.user_id) {
        targetUserId = matchedUser.user_id;
      }
    }

    // If still no registered user account (e.g., external Receiver), fall back to regular phone call
    if (!targetUserId) {
      if (opts.calleePhone) {
        Linking.openURL(`tel:${opts.calleePhone}`);
      } else {
        Alert.alert('Unavailable', 'This contact is not registered for in-app calls and has no phone number.');
      }
      return null;
    }

    if (Number(targetUserId) === Number(me.user_id)) {
      Alert.alert('Invalid Call', 'You cannot call yourself.');
      return null;
    }

    // Insert call session
    const { data: callRow, error } = await supabase
      .from('call_sessions')
      .insert({
        caller_id: me.user_id,
        callee_id: targetUserId,
        delivery_id: opts.deliveryId && opts.deliveryId > 0 ? opts.deliveryId : null,
        status: 'ringing',
      })
      .select('*')
      .single();

    if (error) throw error;

    // Immediately open the Outgoing Call modal on the caller's phone
    const displayName = opts.calleeName || 'Pack-N-Ship User';
    const roleLabel = opts.roleLabel || 'Contact';
    outgoingListeners.forEach(fn => fn(callRow, displayName, roleLabel));

    // Send a push notification in case the other person has the app in background
    const callerName = [me.first_name, me.last_name].filter(Boolean).join(' ') || 'Pack-N-Ship User';
    notifyUser(
      targetUserId,
      `📞 Incoming Call from ${callerName}`,
      'Tap to open Pack-N-Ship and answer the voice call.',
      { type: 'call', callId: callRow.call_id, deliveryId: opts.deliveryId || undefined }
    ).catch(() => {});

    return callRow;
  } catch (err: any) {
    console.error('[startCall] error:', err);
    Alert.alert('Call Failed', err?.message || 'Could not start in-app call.');
    return null;
  }
};

export const updateCallStatus = async (
  callId: number,
  status: 'active' | 'ended' | 'rejected',
  extraData?: Record<string, any>
) => {
  try {
    await supabase
      .from('call_sessions')
      .update({ status, ...(extraData || {}) })
      .eq('call_id', callId);
  } catch (err) {
    console.error('[updateCallStatus] error:', err);
  }
};

export const promptCallChoice = (opts: {
  name?: string | null;
  role: string;
  calleeId?: number | null;
  phone?: string | null;
  deliveryId?: number | null;
}) => {
  const displayName = opts.name || opts.role;
  const hasInApp = !!opts.calleeId;
  const hasPhone = !!opts.phone;

  if (hasInApp && hasPhone) {
    Alert.alert(
      `Call ${displayName}`,
      'Choose how you would like to call:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: '📱 Phone Dialer',
          onPress: () => Linking.openURL(`tel:${opts.phone}`),
        },
        {
          text: '🎧 In-App Call',
          onPress: () =>
            startCall({
              calleeId: opts.calleeId,
              calleePhone: opts.phone,
              calleeName: displayName,
              roleLabel: opts.role,
              deliveryId: opts.deliveryId,
            }),
        },
      ]
    );
    return;
  }

  if (hasInApp) {
    startCall({
      calleeId: opts.calleeId,
      calleeName: displayName,
      roleLabel: opts.role,
      deliveryId: opts.deliveryId,
    });
    return;
  }

  if (hasPhone) {
    Linking.openURL(`tel:${opts.phone}`);
    return;
  }

  Alert.alert('Unavailable', 'No contact information available for this user.');
};