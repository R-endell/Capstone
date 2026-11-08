// src/modules/Dashboard/Sender/HomeScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Animated, Easing, Platform, ScrollView, Alert, Modal,
  FlatList, ActivityIndicator, Pressable, Image, Dimensions,
  NativeSyntheticEvent, NativeScrollEvent, ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Svg, { Defs, LinearGradient, Stop, Rect, RadialGradient, Circle, G } from 'react-native-svg';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import NotificationsList from '../Disputes/NotificationsList';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { routeNotification, NotifRow } from '../../../utils/notifRouter';
import { SolarIcon, SolarIconName } from '../../../components/ui/SolarIcon';

const ICON_3D_SEND = require('../../../../assets/package-icon.png');
const ICON_3D_SCHEDULE = require('../../../../assets/schedule-icon.png');

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

const iconForType = (type: string): SolarIconName => {
  const t = (type || '').toLowerCase();
  if (t.startsWith('dispute')) return 'Warning';
  if (t.startsWith('delivery')) return 'Package';
  if (t === 'match') return 'Lightning';
  if (t.startsWith('message') || t.startsWith('chat')) return 'ChatCircleText';
  if (t.startsWith('support')) return 'ChatCircleText';
  if (t === 'payment' || t === 'escrow') return 'Card';
  return 'Bell';
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

type BannerItem = {
  source: ImageSourcePropType;
  onPress?: (nav: NativeStackNavigationProp<RootStackParamList>) => void;
  accessibilityLabel: string;
};

const BANNERS: BannerItem[] = [
  { source: require('../../../../assets/banner1.png'), accessibilityLabel: 'Pack-N-Ship promotion banner 1' },
  { source: require('../../../../assets/banner2.png'), accessibilityLabel: 'Join the movement – open Explore', onPress: (nav) => (nav as any).navigate('Explore') },
  { source: require('../../../../assets/banner3.png'), accessibilityLabel: 'Book a micro-move delivery', onPress: (nav) => (nav as any).navigate('Explore', { mode: 'sendNow', ts: Date.now() }) },
  { source: require('../../../../assets/banner4.png'), accessibilityLabel: 'Become a provider', onPress: (nav) => (nav as any).navigate('RegisterProvider') },
  { source: require('../../../../assets/banner5.png'), accessibilityLabel: 'Pack-N-Ship promotion banner 5' },
  { source: require('../../../../assets/banner6.png'), accessibilityLabel: 'Pack-N-Ship promotion banner 6' },
];

const BANNER_ASPECT = 2.2;
const AUTOPLAY_MS = 4500;

const GUIDES = [
  { icon: 'Package' as SolarIconName, title: 'Prepare your package', points: ['Use a sturdy box and seal every seam with strong tape.', 'Wrap fragile items and fill empty space so nothing shifts.', 'Add a clear photo of the packed box before you send the request.'] },
  { icon: 'Scales' as SolarIconName, title: 'Pick size & weight', points: ['Choose Small, Medium or Large based on your box, not its weight.', 'Enter the real weight — each vehicle has a maximum load.', 'If you are between sizes, pick the bigger one.'] },
  { icon: 'Warning' as SolarIconName, title: 'What not to send', danger: true, points: ['Illegal or restricted goods, weapons and anything dangerous.', 'Flammable, explosive or hazardous materials.', 'Cash, valuables, and perishable or live items.'] },
] as const;

const FAQS = [
  { q: 'How do I book a delivery?', a: 'Open the Explore tab. Tap Send Package Now for an instant booking or Schedule a Delivery to plan ahead, then set your pickup and drop-off points and describe your package.' },
  { q: 'Send Now vs. Schedule?', a: 'Send Package Now books a delivery right away. Schedule a Delivery lets you choose a future date and time.' },
  { q: 'How is the price estimated?', a: 'The estimate depends on box size and the provider’s vehicle. You’ll see it on each provider’s card before sending a request.' },
  { q: 'What if something goes wrong?', a: 'Report it from the Dispute Center. Add details and photos so the team can review the case.' },
] as const;

function BannerCarousel({ colors, navigation }: { colors: ThemeColors; navigation: NativeStackNavigationProp<RootStackParamList>; }) {
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

  useEffect(() => { indexRef.current = index; }, [index]);

  useEffect(() => {
    const id = setInterval(() => {
      if (paused.current) return;
      const next = (indexRef.current + 1) % BANNERS.length;
      listRef.current?.scrollToOffset({ offset: next * snap, animated: true });
    }, AUTOPLAY_MS);
    return () => { clearInterval(id); if (resumeTimer.current) clearTimeout(resumeTimer.current); };
  }, [snap]);

  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })).current;
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / snap);
    setIndex(Math.max(0, Math.min(BANNERS.length - 1, i)));
  };

  return (
    <View style={{ marginBottom: 0 }}>
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
        onScrollBeginDrag={() => { paused.current = true; if (resumeTimer.current) clearTimeout(resumeTimer.current); }}
        onScrollEndDrag={() => { if (resumeTimer.current) clearTimeout(resumeTimer.current); resumeTimer.current = setTimeout(() => { paused.current = false; }, 6000); }}
        getItemLayout={(_, i) => ({ length: snap, offset: snap * i, index: i })}
        windowSize={3}
        initialNumToRender={1}
        removeClippedSubviews
        renderItem={({ item }) => {
          const Wrapper: any = item.onPress ? TouchableOpacity : View;
          const wrapperProps = item.onPress ? { activeOpacity: 0.92, onPress: () => item.onPress!(navigation) } : {};
          return (
            <Wrapper
              {...wrapperProps}
              style={{ width: cardW, height: cardH, borderRadius: 12, overflow: 'hidden' }}
              accessible
              accessibilityRole={item.onPress ? 'button' : 'image'}
              accessibilityLabel={item.accessibilityLabel}
            >
              <Image source={item.source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </Wrapper>
          );
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 14 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {BANNERS.map((_, i) => {
          const inputRange = [(i - 1) * snap, i * snap, (i + 1) * snap];
          const width = scrollX.interpolate({ inputRange, outputRange: [6, 18, 6], extrapolate: 'clamp' });
          const opacity = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
          return <Animated.View key={i} style={{ width, height: 6, borderRadius: 3, backgroundColor: colors.accent, opacity }} />;
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

  const isNightTime = useMemo(() => {
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
  }, []);

  const [userName, setUserName] = useState('there');
  const [myId, setMyId] = useState<number | null>(null);
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [fullListOpen, setFullListOpen] = useState(false);
  const notifChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const driftY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const driftAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(driftY, { toValue: -8, duration: 10000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(driftY, { toValue: 0, duration: 10000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    driftAnimation.start();
    return () => driftAnimation.stop();
  }, [driftY]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase.from('users').select('user_id, first_name').eq('auth_id', user.id).maybeSingle();
        if (!active) return;
        if (data?.first_name) setUserName(data.first_name);
        if (data?.user_id) setMyId(data.user_id);
      } catch {}
    })();
    return () => { active = false; };
  }, []);

  useFocusEffect(useCallback(() => {
    if (myId) loadNotifs();
  }, [myId]));

  const loadNotifs = useCallback(async () => {
    if (!myId) { setNotifLoading(false); return; }
    setNotifLoading(true);
    try {
      const { data, error } = await supabase.from('notification_log').select('notif_id, title, body, type, is_read, created_at, ref_id').eq('user_id', myId).order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      const list = (data || []) as Notif[];
      setNotifs(list);
      setUnreadCount(list.filter(n => !n.is_read).length);
    } catch (e) { console.warn('[home] notif load failed', e); } finally { setNotifLoading(false); }
  }, [myId]);

  useEffect(() => { if (myId) loadNotifs(); }, [myId, loadNotifs]);

  useEffect(() => {
    if (!myId) return;
    if (notifChannelRef.current) { supabase.removeChannel(notifChannelRef.current); notifChannelRef.current = null; }
    const channelName = `home-notif-${myId}-${Date.now()}`;
    const ch = supabase.channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` }, () => loadNotifs())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` }, () => loadNotifs())
      .subscribe();
    notifChannelRef.current = ch;
    return () => { supabase.removeChannel(ch); if (notifChannelRef.current === ch) notifChannelRef.current = null; };
  }, [myId, loadNotifs]);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) => Animated.timing(value, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.stagger(80, [animate(headerAnim, 0), animate(contentAnim, 0)]).start();
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [headerAnim, contentAnim, bellPulse]);

  const handleOpenNotifs = () => { setNotifModalOpen(true); loadNotifs(); };

  const markRead = async (n: Notif) => {
    if (n.is_read) return;
    setNotifs(prev => prev.map(x => x.notif_id === n.notif_id ? { ...x, is_read: true } : x));
    setUnreadCount(c => Math.max(0, c - 1));
    try { await supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notif_id); } catch (e) { console.warn('mark read failed', e); }
  };

  const handleNotifPress = async (n: Notif) => {
    await markRead(n);
    setNotifModalOpen(false);
    const type = (n.type || '').toLowerCase();
    if (type.startsWith('support')) { setFullListOpen(true); return; }
    const handled = await routeNotification(navigation as any, n, { role: 'sender' });
    if (!handled) Alert.alert(n.title || 'Notification', n.body || '');
  };

  const fadeUp = (value: Animated.Value, distance = 16) => ({
    opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const bellScale = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const bellOpacity = bellPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.85] });

  const renderNotifModal = () => (
    <Modal visible={notifModalOpen} transparent animationType="fade" onRequestClose={() => setNotifModalOpen(false)}>
      <Pressable style={styles.modalBackdrop} onPress={() => setNotifModalOpen(false)}>
        <View style={[styles.modalCard, { marginTop: insets.top + 60 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setNotifModalOpen(false)} hitSlop={10}>
              <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {notifLoading ? (
            <View style={styles.modalCenter}><ActivityIndicator size="small" color={colors.accent} /></View>
          ) : notifs.length === 0 ? (
            <View style={styles.modalCenter}>
              <SolarIcon name="Bell" variant="duotone" size={40} />
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={notifs.slice(0, 8)}
              keyExtractor={(i) => String(i.notif_id)}
              contentContainerStyle={{ paddingBottom: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={[styles.notifRow, !item.is_read && styles.notifRowUnread]} onPress={() => handleNotifPress(item)} activeOpacity={0.85}>
                  <View style={styles.notifIcon}>
                    <SolarIcon name={iconForType(item.type)} variant="duotone" size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.notifTitleRow}>
                      <Text style={styles.notifTitle} numberOfLines={1}>{titleForType(item.type, item.title)}</Text>
                      {!item.is_read && <View style={styles.notifDot} />}
                    </View>
                    <Text style={styles.notifBody} numberOfLines={2}>{item.body}</Text>
                    <Text style={styles.notifTime}>{ago(item.created_at)}</Text>
                  </View>
                  <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity style={styles.modalFooter} onPress={() => { setNotifModalOpen(false); setFullListOpen(true); }} activeOpacity={0.85}>
            <Text style={styles.modalFooterText}>See all in Notifications</Text>
            <SolarIcon name="ArrowRight" variant="bold" size={16} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  const renderFullListModal = () => (
    <Modal visible={fullListOpen} animationType="slide" onRequestClose={() => setFullListOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.fullListHeader}>
          <TouchableOpacity onPress={() => setFullListOpen(false)} style={styles.fullListBackBtn} activeOpacity={0.7} hitSlop={10}>
            <SolarIcon name="AltArrowLeft" variant="linear" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.fullListTitle}>Notifications</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={{ flex: 1 }}><NotificationsList embedded role="sender" /></View>
      </View>
    </Modal>
  );

  const stars = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 220; i++) {
      const isHero = Math.random() > 0.95;
      const isMid = !isHero && Math.random() > 0.25;
      let r = 0; let opacity = 0;
      if (isHero) { r = Math.random() * 0.3 + 0.25; opacity = Math.random() * 0.3 + 0.6; }
      else if (isMid) { r = Math.random() * 0.2 + 0.01; opacity = Math.random() * 0.2 + 0.2; }
      else { r = Math.random() * 0.01 + 0.25; opacity = Math.random() * 0.1 + 0.05; }
      arr.push({ cx: `${Math.random() * 100}%`, cy: `${Math.random() * 65}%`, r, opacity, hasGlow: isHero, glowR: isHero ? r * 2 : 0 });
    }
    return arr;
  }, []);

  const renderActionSheet = () => (
    <Modal visible={actionSheetOpen} transparent animationType="slide" onRequestClose={() => setActionSheetOpen(false)}>
      <Pressable style={styles.actionBackdrop} onPress={() => setActionSheetOpen(false)}>
        <Pressable style={styles.actionSheetCard} onPress={() => {}}>
          <View style={styles.actionHandle} />
          <Text style={styles.actionTitle}>What would you like to do?</Text>

          <TouchableOpacity
            style={styles.actionCardPrimary}
            onPress={() => { setActionSheetOpen(false); navigation.navigate('SendNowIntro'); }}
            activeOpacity={0.9}
          >
            <View style={styles.primaryIconBox}>
              <Image source={ICON_3D_SEND} style={styles.actionIcon3D} resizeMode="contain" />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
              <Text style={styles.actionSubPrimary}>Instant booking & real-time tracking</Text>
            </View>
            <View style={styles.primaryArrowBox}>
              <SolarIcon name="AltArrowRight" variant="bold" size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCardSecondary}
            onPress={() => { setActionSheetOpen(false); navigation.navigate('ScheduleIntro'); }}
            activeOpacity={0.9}
          >
            <View style={styles.secondaryIconBox}>
              <Image source={ICON_3D_SCHEDULE} style={styles.actionIcon3D} resizeMode="contain" />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={styles.actionTitleSecondary}>Schedule a Delivery</Text>
              <Text style={styles.actionSubSecondary}>Plan shipments for a future date</Text>
            </View>
            <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCancelBtn} onPress={() => setActionSheetOpen(false)} activeOpacity={0.8}>
            <Text style={styles.actionCancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isNightTime ? 'light-content' : 'dark-content'} backgroundColor="transparent" translucent />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroSection}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id="baseGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0.1" stopColor={isNightTime ? '#0F172A' : colors.background} stopOpacity="0.9" />
                  <Stop offset="0.1" stopColor={isNightTime ? '#0F172A' : colors.background} stopOpacity="0.9" />
                  <Stop offset="1" stopColor={colors.background} stopOpacity="0.1" />
                </LinearGradient>
                <RadialGradient id="glow" cx="100%" cy="5%" r="60%" fx="30%" fy="10%">
                  <Stop offset="0" stopColor={colors.accent} stopOpacity={isNightTime ? '0.2' : '0'} />
                  <Stop offset="1" stopColor={colors.accent} stopOpacity="0" />
                </RadialGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#baseGrad)" />
              <Rect width="100%" height="100%" fill="url(#glow)" />
            </Svg>
          </View>

          {isNightTime && (
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: driftY }] }]} pointerEvents="none">
              <Svg height="110%" width="110%" viewBox="0 0 100 100" style={{ marginLeft: '-5%', marginTop: '-5%' }}>
                <Defs>
                  <RadialGradient id="starGlow" cx="50%" cy="50%" r="50%">
                    <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.8" />
                    <Stop offset="0.4" stopColor="#FFFFFF" stopOpacity="0.3" />
                    <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                {stars.map((star, i) => (
                  <G key={i}>
                    {star.hasGlow && <Circle cx={star.cx} cy={star.cy} r={star.glowR} fill="url(#starGlow)" />}
                    <Circle cx={star.cx} cy={star.cy} r={star.r} fill="#FFFFFF" opacity={star.opacity} />
                  </G>
                ))}
              </Svg>
            </Animated.View>
          )}

          <Animated.View style={[styles.header, fadeUp(headerAnim, -10), { paddingTop: insets.top + 16 }]}>
            <View style={styles.greetingTextContainer}>
              <Text style={[styles.greetingTitle, { color: isNightTime ? '#FFFFFF' : colors.textPrimary }]}>Hello, {userName}</Text>
              <Text style={[styles.greetingSubtitle, { color: isNightTime ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>Ready to send something today?</Text>
            </View>

            <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }} pointerEvents="box-none">
              <TouchableOpacity style={[styles.glassBell, { backgroundColor: isNightTime ? 'rgba(255,255,255,0.08)' : colors.card }]} onPress={handleOpenNotifs} activeOpacity={0.8} hitSlop={8}>
                <SolarIcon name="Bell" variant="linear" size={22} color={isNightTime ? '#FFFFFF' : colors.textPrimary} />
                {unreadCount > 0 && (
                  <View style={styles.notificationBadge}>
                    {unreadCount <= 9 && (<Text style={styles.notificationBadgeText}>{unreadCount}</Text>)}
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </View>

        <Animated.View style={[styles.contentWrapper, fadeUp(contentAnim)]}>
          <View style={styles.bannersContainer}>
            <BannerCarousel colors={colors} navigation={navigation} />
          </View>

          <View style={styles.helpSection}>
            <Text style={styles.sectionHeaderTitle}>Help & Guides</Text>

            <View style={styles.groupCard}>
              {GUIDES.map((g, i) => {
                const key = `guide-${i}`; const open = openItem === key; const danger = 'danger' in g && g.danger; const isLast = i === GUIDES.length - 1;
                return (
                  <View key={key} style={!isLast && styles.rowDivider}>
                    <TouchableOpacity style={styles.rowHead} onPress={() => setOpenItem(open ? null : key)} activeOpacity={0.75}>
                      <View style={styles.menuIconWrapper}>
                        <SolarIcon name={g.icon} variant="duotone" size={24} />
                      </View>
                      <Text style={styles.rowTitle} numberOfLines={1}>{g.title}</Text>
                      <SolarIcon name={open ? 'AltArrowUp' : 'AltArrowDown'} variant="linear" size={16} color={colors.textMuted} />
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

            <Text style={[styles.sectionHeaderTitle, { marginTop: 32 }]}>Common questions</Text>
            <View style={styles.groupCard}>
              {FAQS.map((f, i) => {
                const key = `faq-${i}`; const open = openItem === key; const isLast = i === FAQS.length - 1;
                return (
                  <View key={key} style={!isLast && styles.rowDivider}>
                    <TouchableOpacity style={styles.rowHead} onPress={() => setOpenItem(open ? null : key)} activeOpacity={0.75}>
                      <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={2}>{f.q}</Text>
                      <SolarIcon name={open ? 'Minus' : 'Plus'} variant="duotone" size={18} color={colors.accent} />
                    </TouchableOpacity>
                    {open && <Text style={styles.rowBodyText}>{f.a}</Text>}
                  </View>
                );
              })}
            </View>

            <TouchableOpacity style={styles.supportLink} activeOpacity={0.8} onPress={() => (navigation as any).navigate('Support')}>
              <SolarIcon name="ChatCircleText" variant="duotone" size={16} color={colors.accent} />
              <Text style={styles.supportLinkText}>Still need help? Contact support</Text>
              <SolarIcon name="AltArrowRight" variant="linear" size={14} color={colors.accent} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>

      {renderNotifModal()}
      {renderFullListModal()}
      {renderActionSheet()}
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  scrollContent: { paddingBottom: Platform.OS === 'ios' ? 50 : 40 },

  heroSection: { width: '100%', paddingBottom: 10, zIndex: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginBottom: 24 },
  greetingTextContainer: { flex: 1, paddingRight: 16 },

  greetingTitle: {
    fontSize: 26,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: -0.3,
    marginBottom: 4
  },
  greetingSubtitle: { fontSize: 15, fontFamily: 'Poppins_400Regular' },

  glassBell: {
    width: 46, height: 46, borderRadius: 23,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.05)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.2 : 0.03, shadowRadius: isDark ? 10 : 4, elevation: isDark ? 5 : 2,
  },
  notificationBadge: {
    position: 'absolute', top: 10, right: 10, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: c.error, borderWidth: 1.5, borderColor: '#0F172A', justifyContent: 'center', alignItems: 'center',
  },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_800ExtraBold' },

  contentWrapper: { paddingHorizontal: 24, zIndex: 0 },

  bannersContainer: { marginBottom: 32, marginHorizontal: -24 },

  helpSection: { marginBottom: 24 },

  sectionHeaderTitle: {
    fontSize: 20,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    letterSpacing: -0.2,
    marginBottom: 20
  },

  groupCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 1,
    elevation: 0,
  },

  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },

  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 22,
    paddingHorizontal: 20,
    minHeight: 64
  },

  menuIconWrapper: {
    width: 32, height: 42,
    justifyContent: 'center', alignItems: 'flex-start',
    marginRight: 0,
  },

  rowTitle: { flex: 1, fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: 0 },
  rowBody: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 0, gap: 10 },
  rowBodyText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 22, paddingHorizontal: 20, paddingBottom: 20 },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.accent, marginTop: 8 },
  bulletText: { flex: 1, fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 22 },

  supportLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  supportLinkText: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.accent },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.45)', paddingHorizontal: 16 },
  modalCard: { backgroundColor: c.card, borderRadius: 16, paddingTop: 6, paddingBottom: 4, maxHeight: '78%', shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: isDark ? 0.5 : 0.18, shadowRadius: 20, elevation: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },

  modalTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },

  modalCenter: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { marginTop: 10, color: c.textMuted, fontSize: 13, fontFamily: 'Poppins_500Medium' },

  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  notifRowUnread: { backgroundColor: c.accentSoft },
  notifIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.accentSoft, justifyContent: 'center', alignItems: 'center' },
  notifTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifTitle: { flex: 1, fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  notifDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: c.accent },
  notifBody: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 3, lineHeight: 18 },
  notifTime: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textMuted, marginTop: 5 },

  modalFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderTopWidth: 1, borderTopColor: c.divider },
  modalFooterText: { color: c.accent, fontFamily: 'Poppins_700Bold', fontSize: 14 },

  fullListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: c.divider },
  fullListBackBtn: { padding: 4 },
  fullListTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },

  actionBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  actionSheetCard: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  actionHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: c.border, marginBottom: 20,
  },
  actionTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 20, textAlign: 'center', letterSpacing: -0.2 },

  actionCardPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.accent,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  actionCardSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: isDark ? 0.2 : 0.04, shadowRadius: 12, elevation: 3,
  },
  primaryIconBox: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  secondaryIconBox: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  actionIcon3D: { width: 36, height: 36 },
  actionTextWrap: { flex: 1 },
  actionTitlePrimary: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', marginBottom: 2 },
  actionSubPrimary: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: 'rgba(255,255,255,0.85)' },
  actionTitleSecondary: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 2 },
  actionSubSecondary: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary },
  primaryArrowBox: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  actionCancelBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: c.divider,
  },
  actionCancelText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
});