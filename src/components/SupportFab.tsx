// src/components/SupportFab.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  Pressable, ActivityIndicator, Alert, TextInput, Platform,
  Animated, Easing, Keyboard, KeyboardEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../utils/supabase';

const ORANGE = '#FF751F';
const ORANGE_SOFT = '#FFF4EC';
const ORANGE_BORDER = '#FFE4D2';

type SupportCase = {
  kind: 'dispute' | 'issue' | 'delivery';
  id: number;
  title: string;
  subtitle: string;
  status: string;
  created_at: string;
  ref?: string | null;
  badge_color: string;
};

type Props = {
  role: 'sender' | 'provider';
  bottomOffset?: number;
};

export default function SupportFab({ role, bottomOffset = 90 }: Props) {
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<number | null>(null);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

  /* ---------- Keyboard listener (this is the actual fix) ---------- */
  useEffect(() => {
    const onShow = (e: KeyboardEvent) => {
      setKbHeight(e.endCoordinates.height);
    };
    const onHide = () => setKbHeight(0);

    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      onShow,
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      onHide,
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /* ---------- Pulse animation ---------- */
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  /* ---------- Resolve current user id ---------- */
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      if (data?.user_id) setMe(data.user_id);
    })();
  }, []);

  const loadCases = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    try {
      const list: SupportCase[] = [];

      const { data: disputes } = await supabase
        .from('disputes')
        .select('dispute_id, dispute_ref, issue_type, status, created_at, reported_by, provider_id')
        .or(`reported_by.eq.${me},provider_id.eq.${me}`)
        .order('created_at', { ascending: false })
        .limit(10);

      (disputes || []).forEach((d: any) => {
        list.push({
          kind: 'dispute',
          id: d.dispute_id,
          title: `Dispute · ${d.issue_type}`,
          subtitle: d.dispute_ref || `DISP-${d.dispute_id}`,
          status: d.status,
          created_at: d.created_at,
          ref: d.dispute_ref,
          badge_color: '#EF4444',
        });
      });

      const { data: myDeliveries } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .or(`provider_id.eq.${me}`);

      const myDeliveryIds = (myDeliveries || []).map((d: any) => d.delivery_id);

      const { data: myReqs } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('sender_id', me);

      const reqIds = (myReqs || []).map((r: any) => r.request_id);

      if (reqIds.length) {
        const { data: senderDelivs } = await supabase
          .from('deliveries').select('delivery_id').in('request_id', reqIds);
        (senderDelivs || []).forEach((d: any) => myDeliveryIds.push(d.delivery_id));
      }

      const uniqueDeliveryIds = Array.from(new Set(myDeliveryIds));

      if (uniqueDeliveryIds.length) {
        const { data: issues } = await supabase
          .from('delivery_issues')
          .select('issue_id, issue_type, description, status, created_at, delivery_id')
          .in('delivery_id', uniqueDeliveryIds)
          .order('created_at', { ascending: false })
          .limit(10);

        (issues || []).forEach((i: any) => {
          list.push({
            kind: 'issue',
            id: i.issue_id,
            title: `Issue · ${i.issue_type}`,
            subtitle: i.description?.slice(0, 60) || 'Delivery issue',
            status: i.status,
            created_at: i.created_at,
            ref: `DEL-${i.delivery_id}`,
            badge_color: '#F59E0B',
          });
        });
      }

      if (role === 'provider' && uniqueDeliveryIds.length) {
        const { data: active } = await supabase
          .from('deliveries')
          .select('delivery_id, accepted_at, completed_at, request_id')
          .in('delivery_id', uniqueDeliveryIds)
          .is('completed_at', null)
          .order('accepted_at', { ascending: false })
          .limit(3);

        (active || []).forEach((d: any) => {
          list.push({
            kind: 'delivery',
            id: d.delivery_id,
            title: `Active delivery · PNS-${String(d.request_id).padStart(4, '0')}`,
            subtitle: 'Tap to view task details',
            status: 'In Progress',
            created_at: d.accepted_at,
            ref: `DEL-${d.delivery_id}`,
            badge_color: ORANGE,
          });
        });
      }

      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setCases(list);
    } catch (e) {
      console.warn('[support] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [me, role]);

  const openModal = () => {
    setOpen(true);
    if (me) loadCases();
  };

  const closeModal = () => {
    Keyboard.dismiss();
    setOpen(false);
  };

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !me) return;
    setSending(true);
    try {
      const { error } = await supabase.from('notification_log').insert({
        user_id: me,
        title: 'Support request',
        body: trimmed,
        type: 'support',
        ref_id: null,
      });
      if (error) throw error;
      setMessage('');
      Keyboard.dismiss();
      Alert.alert('Message sent', 'Our support team will reply soon.');
      loadCases();
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleCasePress = (c: SupportCase) => {
    closeModal();
    if (c.kind === 'dispute') {
      navigation.navigate('DisputeDetail', { disputeId: c.id });
      return;
    }
    if (c.kind === 'issue') {
      navigation.navigate('DisputeCenter');
      return;
    }
    if (c.kind === 'delivery' && role === 'provider') {
      let cur: any = navigation;
      while (cur) {
        try {
          const names: string[] = cur.getState?.()?.routeNames || [];
          const match = names.find((n) => /task/i.test(n));
          if (match) { cur.navigate(match); return; }
        } catch {}
        cur = cur.getParent?.();
      }
    }
  };

  return (
    <>
      {/* Floating button */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.fabWrap,
          { bottom: bottomOffset, transform: [{ scale }] },
        ]}
      >
        <Animated.View style={[styles.fabGlow, { opacity: glow }]} pointerEvents="none" />
        <TouchableOpacity
          style={styles.fab}
          onPress={openModal}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="headset" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Modal */}
      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeModal} />

          {/*
            The sheet is anchored to the bottom with `bottom: kbHeight`.
            When the keyboard is up, kbHeight > 0, so the sheet slides
            up by exactly the keyboard height — no overlap.
          */}
          <View
            style={[
              styles.sheet,
              { bottom: kbHeight, paddingBottom: kbHeight > 0 ? 16 : 28 },
            ]}
          >
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="headset" size={20} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Customer Support</Text>
                <Text style={styles.headerSub}>
                  {role === 'provider' ? 'Provider help center' : 'We usually reply within a few minutes'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={closeModal}
                hitSlop={10}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={18} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Scrollable body — hidden when keyboard is up so the composer is fully visible */}
            {kbHeight === 0 && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollBody}
              >
                <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
                <View style={styles.quickRow}>
                  <QuickAction
                    icon="alert-circle-outline"
                    label={role === 'provider' ? 'Report an issue' : 'Report a problem'}
                    onPress={() => { closeModal(); navigation.navigate('ReportIssue'); }}
                  />
                  <QuickAction
                    icon="shield-checkmark-outline"
                    label="Dispute center"
                    onPress={() => { closeModal(); navigation.navigate('DisputeCenter'); }}
                  />
                </View>

                <View style={styles.quickRow}>
                  <QuickAction
                    icon="chatbubbles-outline"
                    label="Messages"
                    onPress={() => {
                      closeModal();
                      let cur: any = navigation;
                      while (cur) {
                        try {
                          const names: string[] = cur.getState?.()?.routeNames || [];
                          const match = names.find((n) => /message/i.test(n));
                          if (match) { cur.navigate(match); return; }
                        } catch {}
                        cur = cur.getParent?.();
                      }
                    }}
                  />
                  <QuickAction
                    icon="document-text-outline"
                    label="Policies"
                    onPress={() => { closeModal(); navigation.navigate('LegalPolicies'); }}
                  />
                </View>

                <Text style={[styles.sectionLabel, { marginTop: 20 }]}>YOUR CASES</Text>
                {loading ? (
                  <View style={styles.center}><ActivityIndicator color={ORANGE} /></View>
                ) : cases.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                    <Text style={styles.emptyText}>No open cases — you're all set.</Text>
                  </View>
                ) : (
                  <View style={styles.caseList}>
                    {cases.map((c, idx) => (
                      <TouchableOpacity
                        key={`${c.kind}-${c.id}`}
                        style={[
                          styles.caseRow,
                          idx === cases.length - 1 && styles.caseRowLast,
                        ]}
                        onPress={() => handleCasePress(c)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.caseDot, { backgroundColor: c.badge_color }]} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.caseTitle} numberOfLines={1}>{c.title}</Text>
                          <Text style={styles.caseSub} numberOfLines={1}>
                            {c.subtitle} · {c.status}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}

            {/* Composer */}
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                placeholder="Describe your concern…"
                placeholderTextColor="#9CA3AF"
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  (!message.trim() || sending) && { opacity: 0.5 },
                ]}
                onPress={sendMessage}
                disabled={!message.trim() || sending}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="send" size={16} color="#FFFFFF" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const QuickAction = ({ icon, label, onPress }: any) => (
  <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.quickIcon}>
      <Ionicons name={icon} size={18} color={ORANGE} />
    </View>
    <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  /* FAB */
  fabWrap: {
    position: 'absolute',
    right: 18,
    zIndex: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlow: {
    position: 'absolute',
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: 'rgba(255,117,31,0.35)',
  },
  fab: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 8,
    borderWidth: 2, borderColor: '#FFFFFF',
  },

  /* Modal */
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 16,
  },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  headerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: ORANGE_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },

  /* Body */
  scrollBody: { paddingBottom: 8 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 1.2,
    marginBottom: 10,
  },

  quickRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  quickCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F1F1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  quickIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: ORANGE_SOFT,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
  },
  quickLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },

  caseList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F1F1F1',
    overflow: 'hidden',
  },
  caseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  caseRowLast: { borderBottomWidth: 0 },
  caseDot: { width: 8, height: 8, borderRadius: 4 },
  caseTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  caseSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 3,
    fontWeight: '500',
  },

  center: { paddingVertical: 24, alignItems: 'center' },
  emptyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    borderRadius: 14,
    padding: 14,
  },
  emptyText: {
    flex: 1,
    fontSize: 13,
    color: '#166534',
    fontWeight: '600',
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  input: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    minHeight: 44,
    maxHeight: 110,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
});