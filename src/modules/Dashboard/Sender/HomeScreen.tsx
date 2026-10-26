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
  Image,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  ImageSourcePropType,
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

/* ------------------ banner config ------------------ */
type BannerItem = {
  source: ImageSourcePropType;
  onPress?: (nav: NativeStackNavigationProp<RootStackParamList>) => void;
  accessibilityLabel: string;
};

const BANNERS: BannerItem[] = [
  {
    source: require('../../../../assets/banner1.png'),
    accessibilityLabel: 'Pack-N-Ship promotion banner 1',
  },
  {
    source: require('../../../../assets/banner2.png'),
    accessibilityLabel: 'Join the movement – open Explore',
    onPress: (nav) => (nav as any).navigate('Explore'),
  },
  {
    source: require('../../../../assets/banner3.png'),
    accessibilityLabel: 'Book a micro-move delivery',
    onPress: (nav) => (nav as any).navigate('Explore', { mode: 'sendNow', ts: Date.now() }),
  },
  {
    source: require('../../../../assets/banner4.png'),
    accessibilityLabel: 'Become a provider',
    onPress: (nav) => (nav as any).navigate('RegisterProvider'),
  },
  {
    source: require('../../../../assets/banner5.png'),
    accessibilityLabel: 'Pack-N-Ship promotion banner 5',
  },
  {
    source: require('../../../../assets/banner6.png'),
    accessibilityLabel: 'Pack-N-Ship promotion banner 6',
  },
];

const BANNER_ASPECT = 2.2;
const AUTOPLAY_MS = 4500;

/* ------------------ content (trimmed & reorganized) ------------------ */

// "How it works" is now expressed by the 3 banners + the primary CTA.
// We keep a very short trust line under the CTA instead of a 3-step list.
const TRUST_POINTS = [
  { icon: 'shield-checkmark-outline', label: 'Verified providers' },
  { icon: 'navigate-outline', label: 'Live tracking' },
  { icon: 'card-outline', label: 'Secure payment' },
] as const;

// Guides reduced to the 3 that matter most before a first delivery.
const GUIDES = [
  {
    icon: 'cube-outline',
    title: 'Prepare your package',
    points: [
      'Use a sturdy box and seal every seam with strong tape.',
      'Wrap fragile items and fill empty space so nothing shifts.',
      'Add a clear photo of the packed box before you send the request.',
    ],
  },
  {
    icon: 'scale-outline',
    title: 'Pick size & weight',
    points: [
      'Choose Small, Medium or Large based on your box, not its weight.',
      'Enter the real weight — each vehicle has a maximum load.',
      'If you are between sizes, pick the bigger one.',
    ],
  },
  {
    icon: 'warning-outline',
    title: 'What not to send',
    danger: true,
    points: [
      'Illegal or restricted goods, weapons and anything dangerous.',
      'Flammable, explosive or hazardous materials.',
      'Cash, valuables, and perishable or live items.',
    ],
  },
] as const;

// FAQs trimmed from 6 to 4 — the ones users actually ask before booking.
const FAQS = [
  { q: 'How do I book a delivery?', a: 'Open the Explore tab. Tap Send Package Now for an instant booking or Schedule a Delivery to plan ahead, then set your pickup and drop-off points and describe your package.' },
  { q: 'Send Now vs. Schedule?', a: 'Send Package Now books a delivery right away. Schedule a Delivery lets you choose a future date and time.' },
  { q: 'How is the price estimated?', a: 'The estimate depends on box size and the provider’s vehicle. You’ll see it on each provider’s card before sending a request.' },
  { q: 'What if something goes wrong?', a: 'Report it from the Dispute Center. Add details and photos so the team can review the case.' },
] as const;

/* ------------------ Banner carousel ------------------ */
function BannerCarousel({
  colors,
  navigation,
}: {
  colors: ThemeColors;
  navigation: NativeStackNavigationProp<RootStackParamList>;
}) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<BannerItem>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const paused = useRef(false);
  const indexRef = useRef(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { width: winW } = Dimensions.get('window');
  const GUTTER = 24;
  const GAP = 12;
  const cardW = winW - GUTTER * 2;
  const cardH = cardW / BANNER_ASPECT;
  const snap = cardW + GAP;

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    const id = setInterval(() => {
      if (paused.current) return;
      const next = (indexRef.current + 1) % BANNERS.length;
      listRef.current?.scrollToOffset({ offset: next * snap, animated: true });
    }, AUTOPLAY_MS);
    return () => {
      clearInterval(id);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [snap]);

  // IMPORTANT: useNativeDriver is set to false here on purpose.
  // The scrollX value is interpolated into a `width` style for the
  // pagination dots below, and `width` is NOT supported by the native
  // animated module (native driver only supports transform & opacity).
  // Keeping this on the JS driver avoids:
  //   "Style property 'width' is not supported by native animated module"
  const onScroll = useRef(
    Animated.event(
      [{ nativeEvent: { contentOffset: { x: scrollX } } }],
      { useNativeDriver: false },
    ),
  ).current;

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
    setIndex(Math.max(0, Math.min(BANNERS.length - 1, i)));
  };

  return (
    <View style={{ marginBottom: 20 }}>
      <Animated.FlatList
        ref={listRef as any}
        data={BANNERS}
        keyExtractor={(_, i) => String(i)}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        disableIntervalMomentum
        bounces={false}
        contentContainerStyle={{ paddingHorizontal: GUTTER, gap: GAP }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        onScrollBeginDrag={() => {
          paused.current = true;
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
        }}
        onScrollEndDrag={() => {
          if (resumeTimer.current) clearTimeout(resumeTimer.current);
          resumeTimer.current = setTimeout(() => {
            paused.current = false;
          }, 6000);
        }}
        getItemLayout={(_, i) => ({ length: snap, offset: snap * i, index: i })}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews
        renderItem={({ item, index: i }) => {
          const Wrapper: any = item.onPress ? TouchableOpacity : View;
          const wrapperProps = item.onPress
            ? { activeOpacity: 0.92, onPress: () => item.onPress!(navigation) }
            : {};
          return (
            <Wrapper
              {...wrapperProps}
              style={{
                width: cardW,
                height: cardH,
                borderRadius: 18,
                overflow: 'hidden',
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
              accessible
              accessibilityRole={item.onPress ? 'button' : 'image'}
              accessibilityLabel={item.accessibilityLabel}
            >
              <Image
                source={item.source}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            </Wrapper>
          );
        }}
      />

      <View
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {BANNERS.map((_, i) => {
          const inputRange = [(i - 1) * snap, i * snap, (i + 1) * snap];
          const width = scrollX.interpolate({
            inputRange, outputRange: [6, 18, 6], extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={{ width, height: 6, borderRadius: 3, backgroundColor: ORANGE, opacity }}
            />
          );
        })}
      </View>
    </View>
  );
}

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

  // Accordion state — one shared open-key so only one item is expanded across
  // both the Guides and FAQ groups (reduces visual noise + scroll length).
  const [openItem, setOpenItem] = useState<string | null>(null);

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
  const ctaAnim = useRef(new Animated.Value(0)).current;
  const helpAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.stagger(80, [
      animate(headerAnim, 0),
      animate(ctaAnim, 0),
      animate(helpAnim, 0),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [headerAnim, ctaAnim, helpAnim, bellPulse]);

  /* ------------------ handlers ------------------ */
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

  const handleNotifPress = async (n: Notif) => {
    await markRead(n);
    setNotifModalOpen(false);
    const type = (n.type || '').toLowerCase();
    if (type.startsWith('support')) {
      setFullListOpen(true);
      return;
    }
    const handled = await routeNotification(navigation as any, n, { role: 'sender' });
    if (!handled) {
      Alert.alert(n.title || 'Notification', n.body || '');
    }
  };

  const fadeUp = (value: Animated.Value, distance = 16) => ({
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
        {/* ─── HEADER ─── */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -10)]}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingTitle}>Hello, {userName} 👋</Text>
            <Text style={styles.greetingSubtitle}>Ready to send something today?</Text>
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

        {/* ─── BANNERS (carousel) ─── */}
        <BannerCarousel colors={colors} navigation={navigation} />

        {/* ─── PRIMARY CTA ─── */}
        <Animated.View style={fadeUp(ctaAnim, 12)}>
          <TouchableOpacity
            style={styles.ctaCard}
            activeOpacity={0.9}
            onPress={() => goToExplore('sendNow')}
            accessibilityRole="button"
            accessibilityLabel="Start a delivery"
          >
            <View style={styles.ctaIconWrap}>
              <Ionicons name="cube" size={22} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaTitle}>Start a delivery</Text>
              <Text style={styles.ctaSubtitle}>
                Book a provider now, or schedule for later
              </Text>
            </View>
            <View style={styles.ctaChevron}>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          {/* Trust row — reassures the user without adding a whole section */}
          <View style={styles.trustRow}>
            {TRUST_POINTS.map((t) => (
              <View key={t.label} style={styles.trustItem}>
                <Ionicons name={t.icon} size={14} color={colors.textMuted} />
                <Text style={styles.trustLabel}>{t.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>

        {/* ─── HELP & GUIDES (merged Guides + FAQ) ─── */}
        <Animated.View style={[styles.sectionContainer, fadeUp(helpAnim)]}>
          <Text style={styles.sectionTitle}>Help &amp; Guides</Text>

          {/* Sub-group: Shipping tips */}
          <Text style={styles.subHeader}>Before you ship</Text>
          <View style={styles.groupCard}>
            {GUIDES.map((g, i) => {
              const key = `guide-${i}`;
              const open = openItem === key;
              const danger = 'danger' in g && g.danger;
              const isLast = i === GUIDES.length - 1;
              return (
                <View key={key} style={!isLast && styles.rowDivider}>
                  <TouchableOpacity
                    style={styles.rowHead}
                    onPress={() => setOpenItem(open ? null : key)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.rowIcon, danger && { backgroundColor: 'rgba(220,38,38,0.1)' }]}>
                      <Ionicons name={g.icon} size={18} color={danger ? colors.error : ORANGE} />
                    </View>
                    <Text style={styles.rowTitle} numberOfLines={1}>{g.title}</Text>
                    <Ionicons
                      name={open ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                  {open && (
                    <View style={styles.rowBody}>
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
          </View>

          {/* Sub-group: FAQs */}
          <Text style={styles.subHeader}>Common questions</Text>
          <View style={styles.groupCard}>
            {FAQS.map((f, i) => {
              const key = `faq-${i}`;
              const open = openItem === key;
              const isLast = i === FAQS.length - 1;
              return (
                <View key={key} style={!isLast && styles.rowDivider}>
                  <TouchableOpacity
                    style={styles.rowHead}
                    onPress={() => setOpenItem(open ? null : key)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={2}>{f.q}</Text>
                    <Ionicons
                      name={open ? 'remove' : 'add'}
                      size={18}
                      color={ORANGE}
                    />
                  </TouchableOpacity>
                  {open && <Text style={styles.rowBodyText}>{f.a}</Text>}
                </View>
              );
            })}
          </View>

          {/* Support handoff */}
          <TouchableOpacity
            style={styles.supportLink}
            activeOpacity={0.8}
            onPress={() => (navigation as any).navigate('Support')}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={ORANGE} />
            <Text style={styles.supportLinkText}>Still need help? Contact support</Text>
            <Ionicons name="chevron-forward" size={14} color={ORANGE} />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {renderNotifModal()}
      {renderFullListModal()}
    </View>
  );
}

/* ────────────────────────────────────────────────────────────
   Styles — unified spacing scale: 24 (screen gutter), 20 (section
   gap), 14 (card padding), 10/6 (inner rhythm).
   Shadows only on the notification bell (needs to float).
   Orange reserved for: CTA, active states, badges, brand accents.
   ──────────────────────────────────────────────────────────── */
const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scrollContent: { paddingBottom: Platform.OS === 'ios' ? 50 : 40 },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
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

  /* ── Primary CTA ── */
  ctaCard: {
    marginHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: ORANGE,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 16,
    // No shadow: solid brand color is the emphasis.
  },
  ctaIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  ctaSubtitle: { color: 'rgba(255,255,255,0.9)', fontSize: 12.5, marginTop: 2, fontWeight: '500' },
  ctaChevron: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },

  /* ── Trust row ── */
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginTop: 12,
    marginBottom: 24,
  },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trustLabel: { fontSize: 11.5, color: c.textMuted, fontWeight: '600' },

  /* ── Sections ── */
  sectionContainer: { paddingHorizontal: 24 },
  sectionTitle: {
    fontSize: 18, fontWeight: '800', color: c.textPrimary,
    letterSpacing: -0.4, marginBottom: 14,
  },
  subHeader: {
    fontSize: 12, fontWeight: '800', color: c.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: 8, marginTop: 4,
  },

  /* ── Grouped list card (Guides + FAQ) ── */
  groupCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    borderWidth: 1, borderColor: c.border,
    overflow: 'hidden',
    marginBottom: 20,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: {
    flex: 1,
    fontSize: 14.5, fontWeight: '700',
    color: c.textPrimary,
  },
  rowBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 0,
    gap: 8,
  },
  rowBodyText: {
    fontSize: 13, color: c.textSecondary, lineHeight: 19,
    paddingHorizontal: 14, paddingBottom: 14,
  },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletDot: {
    width: 5, height: 5, borderRadius: 2.5,
    backgroundColor: ORANGE, marginTop: 7,
  },
  bulletText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 19 },

  /* ── Support handoff ── */
  supportLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginTop: -6,
  },
  supportLinkText: {
    fontSize: 13, fontWeight: '700', color: ORANGE,
  },

  /* ── Notification modal ── */
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