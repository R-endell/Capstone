// src/modules/Dashboard/Sender/HomeScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  Platform,
  ScrollView,
  Alert,
  Modal,
  FlatList,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import NotificationsList from '../Disputes/NotificationsList';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { routeNotification, NotifRow } from '../../../utils/notifRouter';

const ORANGE = '#F27024';

type Notif = NotifRow;

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

const iconForType = (type: string): keyof typeof Ionicons.glyphMap => {
  const t = (type || '').toLowerCase();
  if (t.startsWith('dispute')) return 'shield-checkmark-outline';
  if (t.startsWith('delivery')) return 'cube-outline';
  if (t === 'match') return 'flash-outline';
  if (t.startsWith('message') || t.startsWith('chat')) return 'chatbubble-ellipses-outline';
  if (t.startsWith('support')) return 'chatbubble-ellipses-outline';
  if (t === 'payment' || t === 'escrow') return 'card-outline';
  return 'notifications-outline';
};

const titleForType = (type: string, fallback: string): string => {
  const t = (type || '').toLowerCase();
  if (t === 'match') return 'New Delivery Match';
  if (t.startsWith('delivery')) return 'Delivery Update';
  if (t.startsWith('message') || t.startsWith('chat')) return 'New Message';
  if (t.startsWith('dispute')) return 'Dispute Update';
  if (t.startsWith('support')) return 'Pack-N-Ship';
  if (t === 'payment' || t === 'escrow') return 'Payment Update';
  return fallback;
};

/* ------------------ static content (edit freely) ------------------ */
const STEPS = [
  { icon: 'search-outline', title: 'Find a provider', text: 'Open Explore to see providers traveling near your location.' },
  { icon: 'flash-outline', title: 'Send Now or Schedule', text: 'Tap Send Package Now for an instant booking, or Schedule a Delivery to plan a future date.' },
  { icon: 'navigate-outline', title: 'Track your delivery', text: 'Follow your package in Activity until it is confirmed delivered.' },
] as const;

const APP_UPDATES = [
  { icon: 'camera-outline', tag: 'New', title: 'Live selfie verification', text: 'Providers now take a live selfie when they register, for safer deliveries.' },
  { icon: 'shield-checkmark-outline', tag: 'New', title: 'Dispute Center', text: 'Report a problem with a delivery and follow it until it is resolved.' },
  { icon: 'moon-outline', tag: 'Update', title: 'Light & dark mode', text: 'The app now follows your theme and matches your phone’s navigation bar.' },
] as const;

const GUIDES = [
  {
    icon: 'cube-outline', title: 'How to prepare your package',
    points: [
      'Use a sturdy box and seal every seam with strong tape.',
      'Wrap fragile items in bubble wrap or soft cloth and fill empty space so nothing shifts.',
      'Mark the box fragile in the app so your provider handles it with care.',
      'Add a clear photo of the packed box before you send the request.',
    ],
  },
  {
    icon: 'scale-outline', title: 'Choosing a box size and weight',
    points: [
      'Pick Small, Medium or Large based on your box, not on how heavy it is.',
      'Enter the real weight. Each provider’s vehicle has a maximum load, and heavier packages cannot be matched.',
      'If you are between sizes, choose the bigger one to avoid problems at pickup.',
    ],
  },
  {
    icon: 'walk-outline', title: 'Curb-side vs Door-to-door',
    points: [
      'Curb-side Drop-off: the provider meets you at the pickup point and leaves the package at the drop-off point.',
      'Door-to-door: the provider collects from and delivers to the door.',
      'Be reachable at the pickup point a few minutes before the departure time.',
    ],
  },
  {
    icon: 'warning-outline', title: 'Items you should not send', danger: true,
    points: [
      'Illegal or restricted goods, weapons and anything dangerous.',
      'Flammable, explosive or hazardous materials.',
      'Cash, valuables and documents you cannot afford to lose.',
      'Live animals and perishable food that cannot survive the trip.',
    ],
  },
] as const;

const FAQS = [
  { q: 'How do I book a delivery?', a: 'Open the Explore tab. Tap Send Package Now for an instant booking or Schedule a Delivery to plan ahead, then set your pickup and drop-off points and describe your package. You can also book one of the providers listed near you.' },
  { q: 'What is the difference between Send Now and Schedule?', a: 'Send Package Now books a delivery right away. Schedule a Delivery lets you choose a future date and time for your shipment.' },
  { q: 'Why do I see providers near me?', a: 'Explore lists providers whose trips start close to your location, so your package rides along a route they are already making. That keeps the cost lower than a dedicated courier.' },
  { q: 'How is the price estimated?', a: 'The estimate depends on the box size and the provider’s vehicle. You can see the estimate on each provider’s card before you send a request.' },
  { q: 'What if my package is late or damaged?', a: 'Report it from the Dispute Center. Add details and photos so the team can review the case.' },
  { q: 'Who are the providers?', a: 'Providers are registered providers who submitted an ID, a live selfie and their vehicle details for verification before they could accept deliveries.' },
] as const;

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [userName, setUserName] = useState('there');
  const [myId, setMyId] = useState<number | null>(null);

  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullListOpen, setFullListOpen] = useState(false);

  const notifChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const [openGuide, setOpenGuide] = useState<number | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  /* ------------------ user + notifications ------------------ */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase
          .from('users')
          .select('user_id, first_name')
          .eq('auth_id', user.id)
          .maybeSingle();
        if (!active) return;
        if (data?.first_name) setUserName(data.first_name);
        if (data?.user_id) setMyId(data.user_id);
      } catch {
        /* keep default */
      }
    })();
    return () => { active = false; };
  }, []);

  const loadNotifs = useCallback(async () => {
    if (!myId) {
      setNotifLoading(false);
      return;
    }
    setNotifLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, type, is_read, created_at, ref_id')
        .eq('user_id', myId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      const list = (data || []) as Notif[];
      setNotifs(list);
      setUnreadCount(list.filter(n => !n.is_read).length);
    } catch (e) {
      console.warn('[home] notif load failed', e);
    } finally {
      setNotifLoading(false);
    }
  }, [myId]);

  useEffect(() => { if (myId) loadNotifs(); }, [myId, loadNotifs]);
  useFocusEffect(useCallback(() => { if (myId) loadNotifs(); }, [myId, loadNotifs]));

  useEffect(() => {
    if (!myId) return;
    if (notifChannelRef.current) {
      supabase.removeChannel(notifChannelRef.current);
      notifChannelRef.current = null;
    }
    const channelName = `home-notif-${myId}-${Date.now()}`;
    const ch = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` }, () => loadNotifs())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` }, () => loadNotifs())
      .subscribe();
    notifChannelRef.current = ch;
    return () => {
      supabase.removeChannel(ch);
      if (notifChannelRef.current === ch) notifChannelRef.current = null;
    };
  }, [myId, loadNotifs]);

  /* ------------------ animations ------------------ */
  const headerAnim = useRef(new Animated.Value(0)).current;
  const stepsAnim = useRef(new Animated.Value(0)).current;
  const updatesAnim = useRef(new Animated.Value(0)).current;
  const guidesAnim = useRef(new Animated.Value(0)).current;
  const faqAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.stagger(100, [
      animate(headerAnim, 0),
      animate(stepsAnim, 0),
      animate(updatesAnim, 0),
      animate(guidesAnim, 0),
      animate(faqAnim, 0),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [headerAnim, stepsAnim, updatesAnim, guidesAnim, faqAnim, bellPulse]);

  /* ------------------ handlers ------------------ */
  // Booking now lives on the Explore tab; Home only points the way.
  const goToExplore = (mode?: 'sendNow' | 'schedule') => {
    (navigation as any).navigate('Explore', mode ? { mode, ts: Date.now() } : undefined);
  };
  const handleOpenNotifs = () => {
    setNotifModalOpen(true);
    loadNotifs();
  };

  const markRead = async (n: Notif) => {
    if (n.is_read) return;
    setNotifs(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, is_read: true } : x));
    setUnreadCount(c => Math.max(0, c - 1));
    try {
      await supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notif_id);
    } catch (e) {
      console.warn('mark read failed', e);
    }
  };

  // ---- NEW: shared routing ----
  const handleNotifPress = async (n: Notif) => {
    await markRead(n);
    setNotifModalOpen(false);

    const type = (n.type || '').toLowerCase();

    // Support notifications only live in the Notifications list
    if (type.startsWith('support')) {
      setFullListOpen(true);
      return;
    }

    const handled = await routeNotification(navigation as any, n, { role: 'sender' });
    if (!handled) {
      Alert.alert(n.title || 'Notification', n.body || '');
    }
  };

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const bellScale = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const bellOpacity = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  /* ------------------ notification modal ------------------ */
  const renderNotifModal = () => (
    <Modal visible={notifModalOpen} transparent animationType="fade" onRequestClose={() => setNotifModalOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setNotifModalOpen(false)}>
        <View style={[styles.modalCard, { marginTop: insets.top + 60 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setNotifModalOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {notifLoading ? (
            <View style={styles.modalCenter}><ActivityIndicator size="small" color={ORANGE} /></View>
          ) : notifs.length === 0 ? (
            <View style={styles.modalCenter}>
              <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={notifs.slice(0, 8)}
              keyExtractor={(i) => String(i.notif_id)}
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.notifRow, !item.is_read && styles.notifRowUnread]}
                  onPress={() => handleNotifPress(item)}
                  activeOpacity={0.85}
                >
                  <View style={styles.notifIcon}>
                    <Ionicons name={iconForType(item.type)} size={18} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.notifTitleRow}>
                      <Text style={styles.notifTitle} numberOfLines={1}>
                        {titleForType(item.type, item.title)}
                      </Text>
                      {!item.is_read && <View style={styles.notifDot} />}
                    </View>
                    <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                    <Text style={styles.notifTime}>{ago(item.created_at)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={styles.modalFooter}
            onPress={() => { setNotifModalOpen(false); setFullListOpen(true); }}
            activeOpacity={0.85}
          >
            <Text style={styles.modalFooterText}>See all in Notifications</Text>
            <Ionicons name="arrow-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  /* ------------------ full notifications modal ------------------ */
  const renderFullListModal = () => (
    <Modal visible={fullListOpen} animationType="slide" onRequestClose={() => setFullListOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
          backgroundColor: colors.card,
          borderBottomWidth: 1, borderBottomColor: colors.divider,
        }}>
          <TouchableOpacity
            onPress={() => setFullListOpen(false)}
            style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.7}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{
            flex: 1, textAlign: 'center',
            fontSize: 18, fontWeight: '800',
            color: colors.textPrimary, letterSpacing: -0.3,
          }}>Notifications</Text>
          <View style={{ width: 32 }} />
        </View>

        <View style={{ flex: 1 }}>
          <NotificationsList embedded role="sender" />
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
      >
        {/* HEADER & GREETING */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -10)]}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingTitle}>Hello, {userName} 👋</Text>
            <Text style={styles.greetingSubtitle}>Learn how to ship smarter with Pack-N-Ship</Text>
          </View>

          <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.notificationIcon}
              onPress={handleOpenNotifs}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="notifications-outline" size={22} color={colors.textPrimary} />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  {unreadCount <= 9 && (<Text style={styles.notificationBadgeText}>{unreadCount}</Text>)}
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* HOW IT WORKS */}
        <Animated.View style={[styles.sectionContainer, fadeUp(stepsAnim)]}>
          <Text style={styles.sectionTitle}>How Pack-N-Ship Works</Text>
          <View style={styles.stepsCard}>
            {STEPS.map((st, i) => (
              <View key={st.title} style={styles.stepRow}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{i + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{st.title}</Text>
                  <Text style={styles.stepText}>{st.text}</Text>
                </View>
                <Ionicons name={st.icon} size={20} color={ORANGE} />
              </View>
            ))}
            <View style={styles.stepsLinks}>
              <TouchableOpacity style={styles.stepsLink} onPress={() => goToExplore('sendNow')} activeOpacity={0.85}>
                <Ionicons name="flash" size={14} color={ORANGE} />
                <Text style={styles.stepsLinkText}>Send Now</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stepsLink} onPress={() => goToExplore('schedule')} activeOpacity={0.85}>
                <Ionicons name="calendar-outline" size={14} color={ORANGE} />
                <Text style={styles.stepsLinkText}>Schedule</Text>
              </TouchableOpacity>
              <Text style={styles.stepsLinksHint}>Both are in Explore</Text>
            </View>
          </View>
        </Animated.View>

        {/* APP UPDATES */}
        <Animated.View style={[styles.sectionContainer, fadeUp(updatesAnim)]}>
          <Text style={styles.sectionTitle}>What’s New</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.updateScroll}>
            {APP_UPDATES.map((u) => (
              <View key={u.title} style={styles.updateCard}>
                <View style={styles.updateTop}>
                  <View style={styles.updateIconWrap}>
                    <Ionicons name={u.icon} size={20} color={ORANGE} />
                  </View>
                  <View style={styles.updateTag}><Text style={styles.updateTagText}>{u.tag}</Text></View>
                </View>
                <Text style={styles.updateTitle}>{u.title}</Text>
                <Text style={styles.updateText}>{u.text}</Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>

        {/* PACKING & SHIPPING GUIDES */}
        <Animated.View style={[styles.sectionContainer, fadeUp(guidesAnim)]}>
          <Text style={styles.sectionTitle}>Shipping Guides</Text>
          {GUIDES.map((g, i) => {
            const open = openGuide === i;
            const danger = 'danger' in g && g.danger;
            return (
              <View key={g.title} style={styles.tipCard}>
                <TouchableOpacity
                  style={styles.accordionHead}
                  onPress={() => setOpenGuide(open ? null : i)}
                  activeOpacity={0.8}
                >
                  <View style={styles.tipIconWrap}>
                    <Ionicons name={g.icon} size={20} color={danger ? colors.error : ORANGE} />
                  </View>
                  <Text style={[styles.tipTitle, { flex: 1, marginBottom: 0 }]}>{g.title}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
                {open && (
                  <View style={styles.accordionBody}>
                    {g.points.map((p) => (
                      <View key={p} style={styles.bulletRow}>
                        <View style={[styles.bulletDot, danger && { backgroundColor: colors.error }]} />
                        <Text style={styles.bulletText}>{p}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </Animated.View>

        {/* FAQ */}
        <Animated.View style={[styles.sectionContainer, fadeUp(faqAnim)]}>
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          {FAQS.map((f, i) => {
            const open = openFaq === i;
            return (
              <View key={f.q} style={styles.tipCard}>
                <TouchableOpacity
                  style={styles.accordionHead}
                  onPress={() => setOpenFaq(open ? null : i)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.tipTitle, { flex: 1, marginBottom: 0, paddingRight: 8 }]}>{f.q}</Text>
                  <Ionicons name={open ? 'remove' : 'add'} size={20} color={ORANGE} />
                </TouchableOpacity>
                {open && <Text style={styles.faqAnswer}>{f.a}</Text>}
              </View>
            );
          })}
        </Animated.View>
      </ScrollView>

      {renderNotifModal()}
      {renderFullListModal()}
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scrollContent: { paddingBottom: Platform.OS === 'ios' ? 50 : 40 },

  /* ── Header & Greeting ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  greetingTextContainer: { flex: 1, paddingRight: 16 },
  greetingTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  greetingSubtitle: { fontSize: 15, color: c.textSecondary, fontWeight: '400' },
  notificationIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.08 : 0.4,
    shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: c.divider,
  },
  notificationBadge: {
    position: 'absolute', top: 8, right: 8,
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: c.error,
    borderWidth: 1.5, borderColor: c.card,
    justifyContent: 'center', alignItems: 'center',
  },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

  /* ── Sections ──────────────────────────────────────── */
  sectionContainer: { marginBottom: 28 },
  sectionTitle: {
    fontSize: 18, fontWeight: '800', color: c.textPrimary,
    letterSpacing: -0.4, paddingHorizontal: 24, marginBottom: 14,
  },

  /* How it works */
  stepsCard: {
    marginHorizontal: 24, backgroundColor: c.card, borderRadius: 18,
    borderWidth: 1, borderColor: c.border, padding: 16, gap: 14,
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
  },
  stepNumberText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  stepTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginBottom: 2 },
  stepText: { fontSize: 12, color: c.textSecondary, lineHeight: 16 },
  stepsLinks: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12,
  },
  stepsLink: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: ORANGE, borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  stepsLinkText: { color: ORANGE, fontWeight: '800', fontSize: 12 },
  stepsLinksHint: { flex: 1, textAlign: 'right', fontSize: 11, color: c.textMuted, fontWeight: '600' },

  /* What's new */
  updateScroll: { paddingHorizontal: 24, gap: 12 },
  updateCard: {
    width: 250, backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: c.border,
  },
  updateTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  updateIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  updateTag: { backgroundColor: c.accentSoft, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  updateTagText: { color: ORANGE, fontSize: 10, fontWeight: '800' },
  updateTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  updateText: { fontSize: 12, color: c.textSecondary, lineHeight: 17 },

  /* Guides + FAQ accordions */
  tipCard: {
    backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border,
    borderRadius: 16, padding: 14,
    marginHorizontal: 24, marginBottom: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.03 : 0.3,
    shadowRadius: 4, elevation: 1,
  },
  accordionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tipIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  tipTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 4 },
  accordionBody: {
    marginTop: 12, paddingTop: 12, gap: 8,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ORANGE, marginTop: 6 },
  bulletText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
  faqAnswer: {
    fontSize: 13, color: c.textSecondary, lineHeight: 19,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider,
  },

  /* ── Notification modal ─────────────────────────────── */
  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(17,24,39,0.45)',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: c.card, borderRadius: 20,
    paddingTop: 6, paddingBottom: 4, maxHeight: '78%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.18 : 0.5,
    shadowRadius: 20, elevation: 12,
    borderWidth: 1, borderColor: c.border,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  modalCenter: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { marginTop: 10, color: c.textMuted, fontSize: 13, fontWeight: '600' },

  notifRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  notifRowUnread: { backgroundColor: c.accentSoft },
  notifIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { flex: 1, fontSize: 13.5, fontWeight: '800', color: c.textPrimary },
  notifDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: ORANGE },
  notifBody: { fontSize: 12.5, color: c.textSecondary, marginTop: 3, lineHeight: 17 },
  notifTime: { fontSize: 10.5, color: c.textMuted, marginTop: 5, fontWeight: '600' },

  modalFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  modalFooterText: { color: ORANGE, fontWeight: '800', fontSize: 13 },
});