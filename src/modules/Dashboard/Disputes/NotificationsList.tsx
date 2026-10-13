// src/modules/Dashboard/Disputes/NotificationsList.tsx
import React, {
  useState, useCallback, useEffect, useRef,
} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { getMyUserId } from '../../../services/disputeService';

const ORANGE = '#FF751F';
const SENDER_NAME = 'Pack-N-Ship';

type Notif = {
  notif_id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  ref_id: number | null;
};

type SupportMessage = {
  notif_id: number;
  body: string;
  type: string;
  created_at: string;
  is_read: boolean;
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const timeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const iconForType = (type: string): keyof typeof Ionicons.glyphMap => {
  const t = (type || '').toLowerCase();
  if (t.startsWith('dispute')) return 'shield-checkmark-outline';
  if (t.startsWith('delivery')) return 'cube-outline';
  if (t === 'match') return 'flash-outline';
  if (t.startsWith('support')) return 'chatbubble-ellipses-outline';
  if (t === 'payment') return 'card-outline';
  return 'notifications-outline';
};

type Props = {
  /** When true, hides the internal top bar (used inside MessagesScreen). */
  embedded?: boolean;
};

export default function NotificationsList({ embedded = false }: Props) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const myId = useRef<number | null>(null);

  // Support thread modal
  const [openTicket, setOpenTicket] = useState<Notif | null>(null);
  const [thread, setThread] = useState<SupportMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadErr, setThreadErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);

  // Keep a ref to the open ticket so realtime handlers don't re-subscribe
  const openTicketRef = useRef<Notif | null>(null);
  useEffect(() => { openTicketRef.current = openTicket; }, [openTicket]);

  // ----------------------------------------------------------
  // Load list
  // ----------------------------------------------------------
  const load = useCallback(async () => {
    try {
      myId.current = myId.current ?? (await getMyUserId());
      if (!myId.current) return;

      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, type, is_read, created_at, ref_id')
        .eq('user_id', myId.current)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setItems((data || []) as Notif[]);
    } catch (e) {
      console.error('Notifications load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ----------------------------------------------------------
  // Support thread loading
  // ----------------------------------------------------------
  const loadThread = useCallback(async (ticketId: number) => {
    setThreadLoading(true);
    setThreadErr(null);
    try {
      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, body, type, created_at, is_read')
        .or(`notif_id.eq.${ticketId},ref_id.eq.${ticketId}`)
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Only show messages sent by admin/system to the user.
      const onlyInbound = ((data || []) as SupportMessage[]).filter(m => {
        const t = (m.type || '').toLowerCase();
        return t !== 'support_user_reply';
      });

      setThread(onlyInbound);
    } catch (e: any) {
      console.warn('thread load failed', e);
      setThreadErr(e?.message || 'Could not load this conversation.');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  // ----------------------------------------------------------
  // Realtime subscription (list + open thread)
  // ----------------------------------------------------------
  const channelIdRef = useRef(
    `notif-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  useEffect(() => {
    const ch = supabase
      .channel(channelIdRef.current)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_log' },
        () => {
          load();
          const current = openTicketRef.current;
          if (current) {
            const ticketId = current.type === 'support_reply'
              ? (current.ref_id ?? current.notif_id)
              : current.notif_id;
            loadThread(ticketId);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notification_log' },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [load, loadThread]);

  // ----------------------------------------------------------
  // Support thread open/close
  // ----------------------------------------------------------
  const openSupportThread = async (n: Notif) => {
    const ticketId = n.type === 'support_reply'
      ? (n.ref_id ?? n.notif_id)
      : n.notif_id;

    const { data: rootRow } = await supabase
      .from('notification_log')
      .select('notif_id, title, body, type, is_read, created_at, ref_id')
      .eq('notif_id', ticketId)
      .maybeSingle();

    const root: Notif = (rootRow as Notif) || n;
    setOpenTicket(root);
    loadThread(ticketId);

    if (!n.is_read) {
      setItems(prev =>
        prev.map(i => (i.notif_id === n.notif_id ? { ...i, is_read: true } : i))
      );
      supabase.from('notification_log')
        .update({ is_read: true })
        .eq('notif_id', n.notif_id)
        .then(() => {}, (e: any) => console.warn('mark read failed', e));
    }
  };

  const closeSupportThread = () => {
    setOpenTicket(null);
    setThread([]);
    setThreadErr(null);
  };

  // ----------------------------------------------------------
  // Non-support routing
  // ----------------------------------------------------------
  const routeGeneric = async (n: Notif) => {
    const type = (n.type || '').toLowerCase();
    const refId = n.ref_id;

    if (type.startsWith('dispute')) {
      if (refId == null) {
        navigation.navigate('DisputeCenter');
        return;
      }
      if (typeof refId === 'number') {
        navigation.navigate('DisputeDetail', { disputeId: refId });
        return;
      }
      try {
        const { data } = await supabase
          .from('disputes')
          .select('dispute_id')
          .eq('dispute_ref', String(refId))
          .maybeSingle();
        if (data?.dispute_id) {
          navigation.navigate('DisputeDetail', { disputeId: data.dispute_id });
        } else {
          navigation.navigate('DisputeCenter');
        }
      } catch {
        navigation.navigate('DisputeCenter');
      }
      return;
    }

    if (type.startsWith('delivery')) {
      navigation.navigate('DeliveryList', { status: 'Accepted' });
      return;
    }
    if (type === 'match') {
      navigation.navigate('MainTabs', { screen: 'Activity' });
      return;
    }
    if (type === 'payment' || type === 'escrow') {
      navigation.navigate('MainTabs', { screen: 'Activity' });
      return;
    }

    Alert.alert(n.title || 'Notification', n.body || '');
  };

  const open = async (n: Notif) => {
    const type = (n.type || '').toLowerCase();

    if (type.startsWith('support')) {
      await openSupportThread(n);
      return;
    }

    if (!n.is_read) {
      setItems(prev =>
        prev.map(i => (i.notif_id === n.notif_id ? { ...i, is_read: true } : i))
      );
      supabase.from('notification_log')
        .update({ is_read: true })
        .eq('notif_id', n.notif_id)
        .then(() => {}, (e: any) => console.warn('mark read failed', e));
    }

    await routeGeneric(n);
  };

  // ----------------------------------------------------------
  // List row
  // ----------------------------------------------------------
  const renderItem = ({ item }: { item: Notif }) => {
    const isSupport = (item.type || '').toLowerCase().startsWith('support');

    return (
      <TouchableOpacity
        style={[styles.item, !item.is_read && styles.itemUnread]}
        activeOpacity={0.8}
        onPress={() => open(item)}
      >
        <View style={styles.iconBox}>
          <Ionicons name={iconForType(item.type)} size={20} color={ORANGE} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={styles.title} numberOfLines={1}>
              {isSupport ? SENDER_NAME : item.title}
            </Text>
            {!item.is_read && <View style={styles.dot} />}
          </View>
          {isSupport && (
            <Text style={styles.subTitle} numberOfLines={1}>
              {item.title || 'Support message'}
            </Text>
          )}
          <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
          <Text style={styles.time}>{ago(item.created_at)}</Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color="#D1D5DB"
          style={{ alignSelf: 'center' }}
        />
      </TouchableOpacity>
    );
  };

  // ----------------------------------------------------------
  // Support thread modal (read-only, inbound only)
  // ----------------------------------------------------------
  const renderSupportModal = () => {
    if (!openTicket) return null;

    return (
      <Modal
        visible={!!openTicket}
        transparent={false}
        animationType="slide"
        onRequestClose={closeSupportThread}
      >
        <View style={styles.modalRoot}>
          {/* Header */}
          <View style={[styles.modalHeader, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={closeSupportThread}
              style={styles.modalBackBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={26} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.modalHeaderAvatar}>
              <Ionicons name="cube" size={20} color={ORANGE} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.modalHeaderName} numberOfLines={1}>
                {SENDER_NAME}
              </Text>
              <Text style={styles.modalHeaderSub} numberOfLines={1}>
                {openTicket.title || 'Message'}
              </Text>
            </View>
          </View>

          {/* Thread */}
          <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
            {threadLoading ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color={ORANGE} />
              </View>
            ) : threadErr ? (
              <View style={styles.center}>
                <Ionicons name="alert-circle-outline" size={36} color="#EF4444" />
                <Text
                  style={{
                    color: '#6B7280',
                    marginTop: 8,
                    textAlign: 'center',
                    paddingHorizontal: 40,
                  }}
                >
                  {threadErr}
                </Text>
              </View>
            ) : (
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() =>
                  scrollRef.current?.scrollToEnd({ animated: true })
                }
              >
                {thread.map((m, idx) => (
                  <View key={`${m.notif_id}-${idx}`} style={styles.msgRow}>
                    <View style={styles.supportAvatar}>
                      <Ionicons name="cube" size={14} color="#FFFFFF" />
                    </View>
                    <View style={styles.msgBubble}>
                      <Text style={styles.msgText}>{m.body}</Text>
                      <Text style={styles.msgTime}>
                        {SENDER_NAME} · {timeOnly(m.created_at)}
                      </Text>
                    </View>
                  </View>
                ))}

                {thread.length === 0 && (
                  <View style={styles.center}>
                    <Text style={{ color: '#9CA3AF', fontSize: 13 }}>
                      No messages in this conversation.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    );
  };

  // ----------------------------------------------------------
  // Loading
  // ----------------------------------------------------------
  if (loading) {
    return (
      <View style={[styles.container, embedded && { backgroundColor: 'transparent' }]}>
        {!embedded && (
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.topBarBackBtn}
              activeOpacity={0.7}
              hitSlop={10}
            >
              <Ionicons name="chevron-back" size={24} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.topBarTitle}>Notifications</Text>
            <View style={{ width: 32 }} />
          </View>
        )}
        <View style={styles.center}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      </View>
    );
  }

  // ----------------------------------------------------------
  // Main render
  // ----------------------------------------------------------
  return (
    <View style={[styles.container, embedded && { backgroundColor: 'transparent' }]}>
      {/* Top bar — only when used as a standalone screen */}
      {!embedded && (
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.topBarBackBtn}
            activeOpacity={0.7}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Notifications</Text>
          <View style={{ width: 32 }} />
        </View>
      )}

      {items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No notifications yet</Text>
          <Text style={styles.emptySub}>
            Updates about your reports and disputes will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => String(i.notif_id)}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: embedded ? 12 : insets.top + 12,
            paddingBottom: insets.bottom + 20,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={ORANGE}
            />
          }
          renderItem={renderItem}
        />
      )}

      {renderSupportModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  /* top bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  topBarBackBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 16,
  },
  emptySub: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },

  item: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  itemUnread: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },

  iconBox: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FFEDD5',
    alignItems: 'center', justifyContent: 'center',
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827' },
  subTitle: { fontSize: 12, color: '#6B7280', fontWeight: '600', marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  body: { fontSize: 13, color: '#4B5563', marginTop: 3, lineHeight: 18 },
  time: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },

  /* support modal */
  modalRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  modalBackBtn: { padding: 4, marginRight: 4 },
  modalHeaderAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  modalHeaderName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  modalHeaderSub: {
    color: '#FFE4D2',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },

  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  supportAvatar: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8, marginBottom: 2,
  },
  msgBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  msgText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
    fontWeight: '500',
  },
  msgTime: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
});