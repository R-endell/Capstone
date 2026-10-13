// src/modules/Dashboard/Sender/HomeScreen.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  Image,
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

/** Brand */
const ORANGE = '#F27024';
const ORANGE_SOFT = '#FFF4EC';
const ORANGE_BORDER = '#FFD9B8';

type Notif = {
  notif_id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  ref_id: number | null;
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

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [userName, setUserName] = useState('there');
  const [myId, setMyId] = useState<number | null>(null);

  // Notifications
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

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

  // Realtime — reload the badge + list whenever a new notification arrives
  useEffect(() => {
    if (!myId) return;
    const ch = supabase
      .channel(`home-notif-${myId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` },
        () => loadNotifs()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notification_log', filter: `user_id=eq.${myId}` },
        () => loadNotifs()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [myId, loadNotifs]);

  /* ------------------ animations ------------------ */
  const headerAnim = useRef(new Animated.Value(0)).current;
  const actionsAnim = useRef(new Animated.Value(0)).current;
  const promoAnim = useRef(new Animated.Value(0)).current;
  const tipsAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.stagger(100, [
      animate(headerAnim, 0),
      animate(actionsAnim, 0),
      animate(promoAnim, 0),
      animate(tipsAnim, 0),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [headerAnim, actionsAnim, promoAnim, tipsAnim, bellPulse]);

  /* ------------------ handlers ------------------ */
  const handleSendPackage = () => {
    navigation.navigate('DropoffType', { mode: 'sendNow' });
  };
  const handleScheduleDelivery = () => {
    navigation.navigate('DropoffType', { mode: 'schedule' });
  };

  const handleOpenNotifs = () => {
    setNotifModalOpen(true);
    // Refresh in case it's been a while
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

    // Messages / chat → Messages tab
    if (type.startsWith('message') || type.startsWith('chat')) {
      navigation.navigate('MainTabs', { screen: 'Messages' });
      return;
    }

    // Support → Messages tab (Notification sub-tab lives there)
    if (type.startsWith('support')) {
      navigation.navigate('MainTabs', { screen: 'Messages' });
      return;
    }

    // Match / delivery → Activity tab
    if (type === 'match' || type.startsWith('delivery')) {
      navigation.navigate('MainTabs', { screen: 'Activity' });
      return;
    }

    // Payment / escrow → Activity
    if (type === 'payment' || type === 'escrow') {
      navigation.navigate('MainTabs', { screen: 'Activity' });
      return;
    }

    // Disputes → Dispute detail (resolve numeric id if ref is a string)
    if (type.startsWith('dispute')) {
      const refId = n.ref_id;
      if (refId == null) {
        navigation.navigate('DisputeCenter' as any);
        return;
      }
      if (typeof refId === 'number') {
        navigation.navigate('DisputeDetail' as any, { disputeId: refId });
        return;
      }
      try {
        const { data } = await supabase
          .from('disputes')
          .select('dispute_id')
          .eq('dispute_ref', String(refId))
          .maybeSingle();
        if (data?.dispute_id) {
          navigation.navigate('DisputeDetail' as any, { disputeId: data.dispute_id });
        } else {
          navigation.navigate('DisputeCenter' as any);
        }
      } catch {
        navigation.navigate('DisputeCenter' as any);
      }
      return;
    }

    // Fallback
    Alert.alert(n.title || 'Notification', n.body || '');
  };

  const handleContentTap = (title: string) => {
    Alert.alert(title, 'This feature will be available in a future update.');
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
    <Modal
      visible={notifModalOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setNotifModalOpen(false)}
    >
      <Pressable
        style={styles.modalBackdrop}
        onPress={() => setNotifModalOpen(false)}
      >
        <View style={[styles.modalCard, { marginTop: insets.top + 60 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => setNotifModalOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={22} color="#111827" />
            </TouchableOpacity>
          </View>

          {notifLoading ? (
            <View style={styles.modalCenter}>
              <ActivityIndicator size="small" color={ORANGE} />
            </View>
          ) : notifs.length === 0 ? (
            <View style={styles.modalCenter}>
              <Ionicons name="notifications-off-outline" size={40} color="#D1D5DB" />
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          ) : (
            <FlatList
              data={notifs}
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
                  <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={styles.modalFooter}
            onPress={() => {
              setNotifModalOpen(false);
              navigation.navigate('NotificationsList');
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.modalFooterText}>See all in Notifications</Text>
            <Ionicons name="arrow-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
      >
        {/* HEADER & GREETING SECTION */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -10)]}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingTitle}>Hello, {userName} 👋</Text>
            <Text style={styles.greetingSubtitle}>Ready to send a package today?</Text>
          </View>

          <Animated.View
            style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }}
            pointerEvents="box-none"
          >
            <TouchableOpacity
              style={styles.notificationIcon}
              onPress={handleOpenNotifs}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="notifications-outline" size={22} color="#111827" />
              {unreadCount > 0 && (
                <View style={styles.notificationBadge}>
                  {unreadCount <= 9 && (
                    <Text style={styles.notificationBadgeText}>{unreadCount}</Text>
                  )}
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* ACTIONS SECTION */}
        <Animated.View style={[styles.actionContainer, fadeUp(actionsAnim)]}>
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardPrimary]}
            onPress={handleSendPackage}
            activeOpacity={0.85}
          >
            <View style={[styles.actionIconContainer, styles.actionIconPrimary]}>
              <Image
                source={require('../../../../assets/send-package-now.png')}
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
              <Text style={styles.actionSubtitlePrimary}>
                Instant booking & real-time tracking
              </Text>
            </View>
            <View style={styles.chevronPrimary}>
              <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardSecondary]}
            onPress={handleScheduleDelivery}
            activeOpacity={0.85}
          >
            <View style={styles.actionIconContainer}>
              <Image
                source={require('../../../../assets/schedule-delivery-calendar.png')}
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Schedule a Delivery</Text>
              <Text style={styles.actionSubtitle}>
                Plan shipments for a future date
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>

        {/* PROMOTIONS SECTION */}
        <Animated.View style={[styles.sectionContainer, fadeUp(promoAnim)]}>
          <Text style={styles.sectionTitle}>Special Offers</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.promoScrollContainer}
          >
            <TouchableOpacity
              style={[styles.promoCard, { backgroundColor: '#FFF7ED', borderColor: '#FFE4D2' }]}
              activeOpacity={0.85}
              onPress={() => handleContentTap('20% Off Promotion')}
            >
              <View style={[styles.promoIconWrap, { backgroundColor: '#FFEDD5' }]}>
                <Ionicons name="ticket" size={24} color="#EA580C" />
              </View>
              <View>
                <Text style={styles.promoTitle}>20% Off First Delivery</Text>
                <Text style={styles.promoSub}>Use code WELCOME20</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.promoCard, { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7' }]}
              activeOpacity={0.85}
              onPress={() => handleContentTap('Free Priority Matching')}
            >
              <View style={[styles.promoIconWrap, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="flash" size={24} color="#16A34A" />
              </View>
              <View>
                <Text style={styles.promoTitle}>Fast Track Upgrade</Text>
                <Text style={styles.promoSub}>Free priority courier matching</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>

        {/* SHIPPING TIPS SECTION */}
        <Animated.View style={[styles.sectionContainer, fadeUp(tipsAnim)]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Shipping Tips & Guides</Text>
            <TouchableOpacity onPress={() => handleContentTap('All Tips')}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.tipCard}
            activeOpacity={0.8}
            onPress={() => handleContentTap('Packing Fragile Items')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="cube-outline" size={20} color={ORANGE} />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>How to Pack Fragile Items</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Use adequate bubble wrap and secure the corners to prevent any damage during transit.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tipCard}
            activeOpacity={0.8}
            onPress={() => handleContentTap('Weight Guidelines')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="scale-outline" size={20} color={ORANGE} />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>Understanding Weight Guidelines</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Ensure your package weight is accurate to avoid unexpected extra charges.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.tipCard}
            activeOpacity={0.8}
            onPress={() => handleContentTap('Prohibited Items')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="warning-outline" size={20} color="#EF4444" />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>Prohibited Delivery Items</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Review the list of items that our courier partners are not allowed to transport.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {renderNotifModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  scrollContent: {
    paddingBottom: Platform.OS === 'ios' ? 50 : 40,
  },

  /* ── Header & Greeting ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  greetingTextContainer: {
    flex: 1,
    paddingRight: 16,
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  greetingSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '400',
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  notificationBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  /* ── Action Cards ──────────────────────────────────── */
  actionContainer: {
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 14,
    minHeight: 80,
  },
  actionCardPrimary: {
    backgroundColor: ORANGE,
    borderWidth: 0,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  actionCardSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  actionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: ORANGE_SOFT,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
  },
  actionIconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  actionCustomIcon: {
    width: 28,
    height: 28,
  },
  actionTextContainer: {
    flex: 1,
    paddingRight: 8,
  },
  actionTitlePrimary: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  actionSubtitlePrimary: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    marginTop: 3,
    fontWeight: '400',
  },
  actionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  actionSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 3,
    fontWeight: '400',
  },
  chevronPrimary: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Bottom Content Sections ───────────────────────── */
  sectionContainer: {
    marginBottom: 28,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: ORANGE,
  },

  /* Promotions */
  promoScrollContainer: {
    paddingHorizontal: 24,
    gap: 12,
  },
  promoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    width: 260,
  },
  promoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  promoTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  promoSub: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },

  /* Shipping Tips */
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  tipIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  tipTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  tipSub: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },

  /* ── Notification modal ─────────────────────────────── */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    paddingHorizontal: 16,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingTop: 6,
    paddingBottom: 4,
    maxHeight: '78%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  modalCenter: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    marginTop: 10,
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },

  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  notifRowUnread: {
    backgroundColor: '#FFFBF5',
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFEDD5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notifTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  notifTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: '#111827',
  },
  notifDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: ORANGE,
  },
  notifBody: {
    fontSize: 12.5,
    color: '#4B5563',
    marginTop: 3,
    lineHeight: 17,
  },
  notifTime: {
    fontSize: 10.5,
    color: '#9CA3AF',
    marginTop: 5,
    fontWeight: '600',
  },

  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  modalFooterText: {
    color: ORANGE,
    fontWeight: '800',
    fontSize: 13,
  },
});