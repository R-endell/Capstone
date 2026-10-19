// src/components/SupportFab.tsx
import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView,
  Pressable, ActivityIndicator, Alert, TextInput, Platform,
  Animated, Easing, Keyboard, KeyboardEvent, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../utils/supabase';
import { useTheme, ThemeColors } from '../utils/themeContext';

const ORANGE = '#FF751F';
const FAB_SIZE = 54;
const EDGE_PADDING = 10;
const TOP_SAFE = 80;
const BOTTOM_SAFE = 100;
const DRAG_THRESHOLD = 6;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

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
};

export default function SupportFab({ role }: Props) {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // ---------- Drag / Move ----------
  const pan = useRef(new Animated.ValueXY({
    x: SCREEN_W - FAB_SIZE - EDGE_PADDING,
    y: SCREEN_H - FAB_SIZE - BOTTOM_SAFE,
  })).current;

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // PanResponder built once — moves the FAB while dragging,
  // and snaps to the closest side (left/right) on release.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > DRAG_THRESHOLD ||
        Math.abs(gesture.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        setIsDragging(true);
        const flat = (pan as any).__getValue?.() || { x: 0, y: 0 };
        dragStart.current = { x: flat.x, y: flat.y };
        pan.setOffset({ x: flat.x, y: flat.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: (_evt, gesture) => {
        pan.flattenOffset();
        const finalX = dragStart.current.x + gesture.dx;
        const finalY = dragStart.current.y + gesture.dy;

        // Snap to nearest edge (left or right)
        const centerX = finalX + FAB_SIZE / 2;
        const snapToRight = centerX > SCREEN_W / 2;
        const targetX = snapToRight
          ? SCREEN_W - FAB_SIZE - EDGE_PADDING
          : EDGE_PADDING;

        // Clamp Y within safe area
        const clampedY = Math.max(
          TOP_SAFE,
          Math.min(finalY, SCREEN_H - FAB_SIZE - BOTTOM_SAFE),
        );

        Animated.spring(pan, {
          toValue: { x: targetX, y: clampedY },
          useNativeDriver: false,
          friction: 7,
          tension: 60,
        }).start(() => {
          setIsDragging(false);
        });
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
        setIsDragging(false);
      },
    }),
  ).current;

  // ---------- Modal state ----------
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<number | null>(null);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const pulse = useRef(new Animated.Value(0)).current;

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

  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

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
          badge_color: colors.error,
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
            badge_color: colors.warning,
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
  }, [me, role, colors.error, colors.warning]);

  const openModal = () => {
    if (isDragging) return;
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
      {/* Draggable FAB */}
      <Animated.View
        style={[
          styles.fabWrap,
          {
            transform: pan.getTranslateTransform(),
          },
        ]}
        {...panResponder.panHandlers}
      >
        <Animated.View style={[styles.fabGlow, { opacity: glowOpacity }]} pointerEvents="none" />
        <TouchableOpacity
          style={styles.fab}
          onPress={openModal}
          activeOpacity={0.85}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="headset" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={closeModal} />

          <View
            style={[
              styles.sheet,
              { bottom: kbHeight, paddingBottom: kbHeight > 0 ? 16 : 28 },
            ]}
          >
            <View style={styles.handle} />

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
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {kbHeight === 0 && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.scrollBody}
              >
                <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
                <View style={styles.quickRow}>
                  <QuickAction
                    styles={styles}
                    colors={colors}
                    icon="alert-circle-outline"
                    label={role === 'provider' ? 'Report an issue' : 'Report a problem'}
                    onPress={() => { closeModal(); navigation.navigate('ReportIssue'); }}
                  />
                  <QuickAction
                    styles={styles}
                    colors={colors}
                    icon="shield-checkmark-outline"
                    label="Dispute center"
                    onPress={() => { closeModal(); navigation.navigate('DisputeCenter'); }}
                  />
                </View>

                <View style={styles.quickRow}>
                  <QuickAction
                    styles={styles}
                    colors={colors}
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
                    styles={styles}
                    colors={colors}
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
                    <Ionicons name="checkmark-circle" size={22} color={colors.success} />
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
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                placeholder="Describe your concern…"
                placeholderTextColor={colors.textMuted}
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!message.trim() || sending) && { opacity: 0.5 }]}
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

const QuickAction = ({ icon, label, onPress, styles, colors }: any) => (
  <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.quickIcon}>
      <Ionicons name={icon} size={18} color={ORANGE} />
    </View>
    <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
  </TouchableOpacity>
);

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 999,
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlow: {
    position: 'absolute', width: 62, height: 62, borderRadius: 31,
    backgroundColor: 'rgba(255,117,31,0.35)',
  },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
    borderWidth: 2, borderColor: c.card,
  },

  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17,24,39,0.45)',
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, maxHeight: '88%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 },
    shadowOpacity: isDark ? 0.5 : 0.12, shadowRadius: 20, elevation: 24,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: c.border, marginBottom: 16,
  },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18,
  },
  headerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ORANGE,
  },
  headerTitle: {
    fontSize: 17, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12, color: c.textSecondary, marginTop: 2, fontWeight: '500',
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.divider,
    alignItems: 'center', justifyContent: 'center',
  },

  scrollBody: { paddingBottom: 8 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: c.textMuted,
    letterSpacing: 1.2, marginBottom: 10,
  },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  quickCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.3 : 0.03, shadowRadius: 4, elevation: 1,
  },
  quickIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ORANGE,
  },
  quickLabel: {
    flex: 1, fontSize: 13, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.2,
  },

  caseList: {
    backgroundColor: c.card, borderRadius: 16,
    borderWidth: 1, borderColor: c.divider, overflow: 'hidden',
  },
  caseRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  caseRowLast: { borderBottomWidth: 0 },
  caseDot: { width: 8, height: 8, borderRadius: 4 },
  caseTitle: {
    fontSize: 13.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2,
  },
  caseSub: {
    fontSize: 12, color: c.textSecondary, marginTop: 3, fontWeight: '500',
  },

  center: { paddingVertical: 24, alignItems: 'center' },
  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.successBg, borderWidth: 1, borderColor: c.success,
    borderRadius: 14, padding: 14,
  },
  emptyText: { flex: 1, fontSize: 13, color: c.success, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  input: {
    flex: 1, backgroundColor: c.divider, borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    minHeight: 44, maxHeight: 110, fontSize: 14,
    color: c.textPrimary, fontWeight: '500',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
});