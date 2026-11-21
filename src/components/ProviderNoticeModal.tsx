// src/components/ProviderNoticeModal.tsx
//
// Global in-app notice for PROVIDERS. Mounted once in App.tsx (inside NavigationContainer), so it
// shows on top of ANY screen: tabs, live navigation, chat, etc.
//
// It shows a modal when:
//   1. Admin issues / revokes a strike   -> notification_log row (type 'account_strike'),
//        loaded on app open / foreground and pushed live through Supabase Realtime.
//        "Understood" marks the row is_read = true, so it never shows twice.
//   2. A sender files a NEW report against the provider -> detected through the same
//        subscribeTickets() feed the Account Health screen already uses.
//        (Reports that were already open when the app started are NOT re-announced.)
//
// The phone push notification (server -> send-push) covers the case where the app is closed;
// this modal covers the case where the app is open. They complement each other.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useTheme } from '../utils/themeContext';
import { isApprovedProvider } from '../utils/resolveHomeRoute';
import {
  fetchReportsAgainstMe, isClosed, subscribeTickets, trackingIdFor,
} from '../services/ticketService';
import { ORANGE } from '../modules/Help/helpUi';

type Tone = 'danger' | 'warning' | 'good';

type Notice =
  | { kind: 'strike'; key: string; notifId: number; title: string; body: string; tone: Tone }
  | { kind: 'complaint'; key: string; ticketId: number; title: string; body: string };

const TONE: Record<Tone, { icon: string; color: string; bg: string }> = {
  danger: { icon: 'alert-circle', color: '#DC2626', bg: '#FEE2E2' },
  warning: { icon: 'warning', color: ORANGE, bg: '#FFF1E6' },
  good: { icon: 'checkmark-circle', color: '#16A34A', bg: '#DCFCE7' },
};

export default function ProviderNoticeModal({ navigationRef }: { navigationRef: any }) {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<Notice[]>([]);

  const userIdRef = useRef<number | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const knownTicketsRef = useRef<Set<number> | null>(null); // baseline of reports that already existed

  const current = queue[0] ?? null;

  const enqueue = useCallback((n: Notice) => {
    if (seenRef.current.has(n.key)) return;
    seenRef.current.add(n.key);
    setQueue(q => [...q, n]);
  }, []);

  // ---- 1) strike notices (notification_log) ----
  const loadStrikeNotices = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    try {
      const { data } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, ref_id')
        .eq('user_id', uid)
        .eq('type', 'account_strike')
        .eq('is_read', false)
        .order('notif_id', { ascending: true })
        .limit(5);

      for (const row of data || []) {
        let tone: Tone = 'warning';
        if (row.ref_id) {
          const { data: s } = await supabase
            .from('provider_strikes')
            .select('consequence, status')
            .eq('strike_id', row.ref_id)
            .maybeSingle();
          if (s?.status === 'revoked') tone = 'good';
          else if (s?.consequence === 'suspension' || s?.consequence === 'removal') tone = 'danger';
        }
        enqueue({
          kind: 'strike',
          key: `n-${row.notif_id}`,
          notifId: row.notif_id,
          title: row.title,
          body: row.body,
          tone,
        });
      }
    } catch (e) {
      console.log('[ProviderNotice] strike load failed', e);
    }
  }, [enqueue]);

  // ---- 2) new reports against me ----
  const checkComplaints = useCallback(async () => {
    try {
      const list = await fetchReportsAgainstMe();
      // Only reports filed by a SENDER against me as a provider (not provider-filed reports against me as a sender)
      const open = list.filter(t => !isClosed(t.status) && t.reporter_role === 'sender');
      if (knownTicketsRef.current === null) {
        knownTicketsRef.current = new Set(open.map(t => t.ticket_id));
        return; // first load = baseline, do not announce old reports
      }
      for (const t of open) {
        if (knownTicketsRef.current.has(t.ticket_id)) continue;
        knownTicketsRef.current.add(t.ticket_id);
        enqueue({
          kind: 'complaint',
          key: `c-${t.ticket_id}`,
          ticketId: t.ticket_id,
          title: 'New report against you',
          body:
            `A sender reported "${t.sub_issue || 'an issue'}"` +
            `${t.request_id ? ` on ${trackingIdFor(t.request_id)}` : ''}. ` +
            'Please review it and send your response.',
        });
      }
    } catch (e) {
      console.log('[ProviderNotice] complaint check failed', e);
    }
  }, [enqueue]);

  // ---- wiring ----
  useEffect(() => {
    let cancelled = false;
    let channel: any = null;
    let unsubTickets: (() => void) | null = null;
    let initedFor: number | null = null;

    const teardown = () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
      if (unsubTickets) { unsubTickets(); unsubTickets = null; }
    };

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user) {
        teardown();
        initedFor = null;
        userIdRef.current = null;
        knownTicketsRef.current = null;
        setQueue([]);
        return;
      }

      const ok = await isApprovedProvider(session.user.id);
      if (cancelled || ok === false) return;

      const { data: u } = await supabase
        .from('users').select('user_id').eq('auth_id', session.user.id).maybeSingle();
      if (cancelled || !u?.user_id) return;
      if (initedFor === u.user_id) return; // already wired for this account

      teardown();
      initedFor = u.user_id;
      userIdRef.current = u.user_id;
      knownTicketsRef.current = null;

      await loadStrikeNotices();
      await checkComplaints();
      if (cancelled) return;

      channel = supabase
        .channel(`provider-notice-${u.user_id}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${u.user_id}` },
          () => { loadStrikeNotices(); },
        )
        .subscribe();
      unsubTickets = subscribeTickets(checkComplaints);
    };

    init();
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') init();
    });
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { loadStrikeNotices(); checkComplaints(); }
    });

    return () => {
      cancelled = true;
      teardown();
      authSub?.subscription?.unsubscribe();
      appSub.remove();
    };
  }, [loadStrikeNotices, checkComplaints]);

  // ---- actions ----
  const dismiss = useCallback(async () => {
    const n = queue[0];
    if (!n) return;
    setQueue(q => q.slice(1));
    if (n.kind === 'strike') {
      try { await supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notifId); } catch { /* shows again next launch */ }
    }
  }, [queue]);

  const primary = useCallback(async () => {
    const n = queue[0];
    if (!n) return;
    await dismiss();
    if (!navigationRef?.isReady?.()) return;
    if (n.kind === 'strike') navigationRef.navigate('AccountHealth');
    else navigationRef.navigate('TicketDetail', { ticketId: n.ticketId, source: 'reportAgainstMe' });
  }, [queue, dismiss, navigationRef]);

  if (!current) return null;

  const tone: Tone = current.kind === 'strike' ? current.tone : 'warning';
  const t = TONE[tone];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
            <Ionicons
              name={(current.kind === 'complaint' ? 'document-text' : t.icon) as any}
              size={30}
              color={t.color}
            />
          </View>

          <Text style={[styles.title, { color: colors.textPrimary }]}>{current.title}</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>{current.body}</Text>

          {queue.length > 1 && (
            <Text style={[styles.more, { color: colors.textMuted }]}>+{queue.length - 1} more notice(s)</Text>
          )}

          <View style={styles.row}>
            <Pressable
              onPress={dismiss}
              style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.textPrimary }]}>
                {current.kind === 'complaint' ? 'Later' : 'Understood'}
              </Text>
            </Pressable>
            <Pressable
              onPress={primary}
              style={[styles.btn, { backgroundColor: ORANGE }]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: '#FFFFFF' }]}>
                {current.kind === 'complaint' ? 'Respond now' : 'View Account Health'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  card: {
    width: '100%', maxWidth: 380, borderRadius: 20, borderWidth: 1, padding: 22, alignItems: 'center',
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 17, textAlign: 'center', marginBottom: 8 },
  body: { fontFamily: 'Poppins_400Regular', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  more: { fontFamily: 'Poppins_500Medium', fontSize: 11, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, textAlign: 'center' },
});