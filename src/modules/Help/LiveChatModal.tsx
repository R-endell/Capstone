// src/modules/Help/LiveChatModal.tsx
// Live chat with the support team (the admin). Opens as a full-screen window from the Help screen,
// so it needs no new route. Messages live in notification_log, the same place the admin already
// answers support threads:
//   type 'support'            = first message of the chat (the thread id is its notif_id)
//   type 'support_user_reply' = later messages from the user (ref_id = thread id)
//   type 'support_reply'      = answers from the admin (ref_id = thread id)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, Modal,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { getMyUserId } from '../../services/ticketService';
import type { Role } from '../../services/ticketCatalog';
import { ScreenHeader, ORANGE } from './helpUi';

interface Msg { notif_id: number; body: string; type: string; created_at: string; ref_id: number | null }

const COLS = 'notif_id, body, type, created_at, ref_id';
const MAX_LEN = 1000;

const SUGGESTIONS: Record<Role, string[]> = {
  sender: ['Where is my package?', 'I have a payment problem', 'I need help with my account'],
  provider: ['I have a question about my earnings', 'Help with my route or vehicle', 'I need help with my account'],
};

const isAgent = (m: Msg) => m.type === 'support_reply';

const toDate = (iso: string) =>
  new Date(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');

const timeLabel = (iso: string) =>
  toDate(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const dayLabel = (iso: string) => {
  const d = toDate(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** Replies from support that you have not opened yet (used for the dot on the Help button). */
export const countUnreadAgentReplies = async (): Promise<number> => {
  const me = await getMyUserId();
  if (!me) return 0;
  const { count } = await supabase
    .from('notification_log')
    .select('notif_id', { count: 'exact', head: true })
    .eq('user_id', me).eq('type', 'support_reply').eq('is_read', false);
  return count || 0;
};

export default function LiveChatModal({
  visible, role, onClose, onReport,
}: { visible: boolean; role: Role; onClose: () => void; onReport?: () => void }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [me, setMe] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ticketRef = useRef<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const markRead = useCallback(async (list: Msg[]) => {
    const ids = list.filter(isAgent).map(m => m.notif_id);
    if (ids.length) await supabase.from('notification_log').update({ is_read: true }).in('notif_id', ids);
  }, []);

  const add = useCallback((m: Msg) => {
    setMsgs(prev => (prev.some(x => x.notif_id === m.notif_id) ? prev : [...prev, m]));
  }, []);

  const load = useCallback(async () => {
    try {
      const uid = await getMyUserId();
      setMe(uid);
      if (!uid) return;
      const { data: root } = await supabase
        .from('notification_log').select('notif_id')
        .eq('user_id', uid).eq('type', 'support')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      ticketRef.current = root?.notif_id ?? null;
      if (!ticketRef.current) { setMsgs([]); return; }
      const t = ticketRef.current;
      const { data } = await supabase
        .from('notification_log').select(COLS)
        .or(`notif_id.eq.${t},ref_id.eq.${t}`)
        .order('created_at', { ascending: true });
      const list = (data || []) as Msg[];
      setMsgs(list);
      markRead(list).catch(() => {});
    } catch (e) {
      console.warn('[LiveChat] load failed:', e);
    } finally {
      setLoading(false);
    }
  }, [markRead]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    load();
  }, [visible, load]);

  // New answers from support appear instantly while the window is open.
  useEffect(() => {
    if (!visible || !me) return;
    const ch = supabase
      .channel(`live-chat-${me}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${me}` },
        (payload: any) => {
          const row = payload.new as Msg;
          const t = ticketRef.current;
          if (!t || (row.notif_id !== t && row.ref_id !== t)) return;
          add(row);
          if (isAgent(row)) markRead([row]).catch(() => {});
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [visible, me, add, markRead]);

  useEffect(() => {
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [msgs.length, visible]);

  const send = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body || sending || !me) return;
    try {
      setSending(true);
      const t = ticketRef.current;
      const { data, error } = await supabase
        .from('notification_log')
        .insert(t
          ? { user_id: me, title: 'Live chat', body, type: 'support_user_reply', ref_id: t }
          : { user_id: me, title: 'Live chat', body, type: 'support' })
        .select(COLS).single();
      if (error) throw error;
      if (!t) ticketRef.current = (data as Msg).notif_id;
      add(data as Msg);
      setText('');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const canSend = text.trim().length > 0 && !sending;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <ScreenHeader title="Live support" subtitle="Chat with our team" onBack={onClose} />

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.greet}>
              <View style={styles.greetIcon}><Ionicons name="headset" size={18} color={ORANGE} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.greetTitle}>Hi! How can we help?</Text>
                <Text style={styles.greetText}>
                  Send us a message. Our support team replies here, and you will also get a notification.
                </Text>
              </View>
            </View>

            {onReport && (
              <TouchableOpacity style={styles.reportLink} onPress={onReport} activeOpacity={0.85}>
                <Ionicons name="alert-circle-outline" size={18} color="#3B82F6" />
                <Text style={styles.reportText}>Problem with a delivery? Report it so we can check both sides.</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}

            {loading ? (
              <ActivityIndicator color={ORANGE} style={{ marginTop: 24 }} />
            ) : msgs.length === 0 ? (
              <View style={styles.chips}>
                {SUGGESTIONS[role].map(s => (
                  <TouchableOpacity key={s} style={styles.chip} onPress={() => send(s)} activeOpacity={0.85}>
                    <Text style={styles.chipText}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              msgs.map((m, i) => {
                const agent = isAgent(m);
                const showDay = i === 0 || dayLabel(m.created_at) !== dayLabel(msgs[i - 1].created_at);
                return (
                  <View key={m.notif_id}>
                    {showDay && <Text style={styles.day}>{dayLabel(m.created_at)}</Text>}
                    <View style={[styles.row, agent ? styles.rowAgent : styles.rowMine]}>
                      {agent && <Text style={styles.who}>Support team</Text>}
                      <View style={[styles.bubble, agent ? styles.bubbleAgent : styles.bubbleMine]}>
                        <Text style={[styles.bubbleText, !agent && { color: '#FFF' }]}>{m.body}</Text>
                      </View>
                      <Text style={styles.time}>{timeLabel(m.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TextInput
              style={styles.input} value={text} multiline
              onChangeText={t => setText(t.slice(0, MAX_LEN))}
              placeholder="Message support…" placeholderTextColor={colors.textMuted}
            />
            <TouchableOpacity
              style={[styles.send, !canSend && styles.sendOff]} disabled={!canSend}
              onPress={() => send()} activeOpacity={0.85}
            >
              {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="arrow-up" size={20} color="#FFF" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  list: { padding: 20, paddingBottom: 16, gap: 12 },

  greet: {
    flexDirection: 'row', gap: 12, alignItems: 'flex-start',
    backgroundColor: c.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: c.divider,
  },
  greetIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  greetTitle: { fontSize: 14.5, fontWeight: '800', color: c.textPrimary },
  greetText: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, marginTop: 2, fontWeight: '500' },

  reportLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14,
    backgroundColor: isDark ? '#0F2744' : '#EFF6FF',
  },
  reportText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: isDark ? '#93C5FD' : '#1E40AF' },

  chips: { gap: 8, marginTop: 4 },
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1.5, borderColor: ORANGE, backgroundColor: c.accentSoft,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: ORANGE },

  day: { alignSelf: 'center', fontSize: 11.5, fontWeight: '700', color: c.textMuted, marginVertical: 8 },
  row: { gap: 3, marginBottom: 8 },
  rowMine: { alignItems: 'flex-end' },
  rowAgent: { alignItems: 'flex-start' },
  who: { fontSize: 11.5, fontWeight: '700', color: c.textMuted },
  bubble: { maxWidth: '85%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: ORANGE, borderBottomRightRadius: 6 },
  bubbleAgent: { backgroundColor: isDark ? '#0F2744' : '#EFF6FF', borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: c.textPrimary, fontWeight: '500' },
  time: { fontSize: 10.5, color: c.textMuted, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 42, backgroundColor: c.card, borderRadius: 21, borderWidth: 1.5, borderColor: c.border,
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, color: c.textPrimary,
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74' },
});