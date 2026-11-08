// src/modules/Dashboard/Provider/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  Alert, StatusBar, Animated, Easing, ActivityIndicator, BackHandler, Switch, Modal, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import { countNeedingMyAction } from '../../../services/ticketService';
import { setLastMode, clearLastMode } from '../../../utils/resolveHomeRoute';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { formatDate, formatDateTime } from '../../../utils/dateUtils';
import RoutePreviewMap from '../../../components/map/RoutePreviewMap';

const ORANGE = '#FA7A25';
const BLUE = '#3B82F6';
const BLACK = '#111827';
const PURPLE = '#8B5CF6';
const { height: SCREEN_H } = Dimensions.get('window');

export default function ProviderAccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isDark, colors, toggleDark } = useTheme();
  const styles = makeStyles(colors);

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [userEmail, setUserEmail] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [disputeCount, setDisputeCount] = useState(0);
  const [imgKey, setImgKey] = useState<number>(Date.now());

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'All' | 'Awaiting Pickup' | 'In Transit' | 'Completed' | 'Cancelled'>('All');
  const [selectedHistoryJob, setSelectedHistoryJob] = useState<any | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const avatarPulse = useRef(new Animated.Value(0)).current;
  const historyAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 180)]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(avatarPulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(avatarPulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [headerAnim, contentAnim, avatarPulse]);

  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        if (selectedHistoryJob) { setSelectedHistoryJob(null); return true; }
        if (showHistory) { setShowHistory(false); return true; }
        let nav: any = navigation;
        while (nav) {
          const st = nav.getState?.();
          if (st?.type === 'tab') {
            const current = st.routes?.[st.index]?.name;
            const first = st.routeNames?.[0];
            if (first && first !== current) { nav.navigate(first); return true; }
            return false;
          }
          nav = nav.getParent?.();
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [showHistory, selectedHistoryJob, navigation])
  );

  useEffect(() => {
    if (showHistory) {
      historyAnim.setValue(0);
      Animated.timing(historyAnim, {
        toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    }
  }, [showHistory, historyAnim]);

  const fetchHistory = useCallback(async (provId: number) => {
    try {
      setHistoryLoading(true);
      const { data, error } = await supabase
        .from('deliveries')
        .select(`
          delivery_id, completed_at, pod_photo_url,
          qr_verifications ( pickup_verified ),
          delivery_requests!inner (
            request_id, pickup_type, delivery_status, scheduled_time, created_at, estimated_cost, payment_status,
            pickup_note, dropoff_note, receiver_phone,
            cargo:cargo_id ( * ),
            pickup_location:locations!delivery_requests_pickup_location_id_fkey (street_address, barangay, city, province, latitude, longitude),
            dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (street_address, barangay, city, province, latitude, longitude),
            sender:users!delivery_requests_sender_id_fkey (first_name, last_name, phone_number),
            receiver:receivers (receiver_name, receiver_phone)
          )
        `)
        .eq('provider_id', provId)
        .order('delivery_id', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((r: any) => {
        const req = r.delivery_requests;
        const cargo = Array.isArray(req?.cargo) ? req.cargo[0] : req?.cargo;
        const sender = Array.isArray(req?.sender) ? req.sender[0] : req?.sender;
        const receiver = Array.isArray(req?.receiver) ? req.receiver[0] : req?.receiver;
        
        let itemsJson: any = cargo?.items_json;
        if (typeof itemsJson === 'string') {
          try { itemsJson = JSON.parse(itemsJson); } catch { itemsJson = null; }
        }
        const items = Array.isArray(itemsJson) && itemsJson.length > 0
          ? itemsJson.map((it: any) => ({
              description: it?.description || `${it?.size || 'Standard'} package`,
              size: it?.size ?? null,
              fragile: !!it?.fragile,
            }))
          : [{
              description: cargo?.description || 'Package',
              size: null,
              fragile: !!cargo?.is_fragile,
            }];

        const dims = [cargo?.cargo_length_cm, cargo?.cargo_width_cm, cargo?.cargo_height_cm];
        
        const dateObj = req?.scheduled_time ? new Date(req.scheduled_time) : new Date(req?.created_at || new Date());
        
        // Align cancellation detection with TaskScreen
        const rawStatus = (req?.delivery_status || 'Pending').trim();
        const escrowStatus = String(r.escrow?.escrow_status || '').toLowerCase();
        const paymentStatus = String(req?.payment_status || '').toLowerCase();
        const refundStatus = String(req?.refund_status || '').toLowerCase();
        
        const isCancelled = 
          /cancel/i.test(rawStatus) || 
          ['refunded', 'cancelled', 'canceled'].includes(escrowStatus) ||
          paymentStatus === 'refunded' ||
          ['succeeded', 'completed', 'refunded'].includes(refundStatus);

        const isCompleted = /complete|delivered/i.test(rawStatus) || !!r.completed_at;
        
        // Align transit detection with TaskScreen: checks QR verification first
        const qr = Array.isArray(r.qr_verifications) ? r.qr_verifications[0] : r.qr_verifications;
        const isPickupVerified = !!qr?.pickup_verified;
        const isTransit = (isPickupVerified && !isCompleted) || /transit|picked/i.test(rawStatus);

        let statusLabel = 'Awaiting Pickup';
        let statusColor = colors.warning;
        let statusBg = colors.warningBg;
        let statusIcon: any = 'time-outline';

        if (isCompleted) {
          statusLabel = 'Completed'; statusColor = colors.success; statusBg = colors.successBg; statusIcon = 'checkmark-circle';
        } else if (isCancelled) {
          statusLabel = 'Cancelled'; statusColor = colors.error; statusBg = colors.errorBg; statusIcon = 'close-circle';
        } else if (isTransit) {
          statusLabel = 'In Transit'; statusColor = '#0EA5E9'; statusBg = isDark ? '#0C2130' : '#E0F2FE'; statusIcon = 'car-sport';
        } else {
          // This handles 'Accepted' or 'Pending' statuses where pickup is not yet verified
          statusLabel = 'Awaiting Pickup'; statusColor = colors.warning; statusBg = colors.warningBg; statusIcon = 'time-outline';
        }

        return {
          id: String(r.delivery_id),
          requestId: req?.request_id,
          type: req?.pickup_type || 'Curb-side Drop-off',
          date: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          time: dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          rawDate: dateObj,
          
          pickup: req?.pickup_location?.street_address || 'Pickup location',
          pickupSub: [req?.pickup_location?.barangay, req?.pickup_location?.city].filter(Boolean).join(', '),
          pickupLat: req?.pickup_location?.latitude,
          pickupLng: req?.pickup_location?.longitude,
          pickupNote: req?.pickup_note,
          
          dropoff: req?.dropoff_location?.street_address || 'Dropoff location',
          dropoffSub: [req?.dropoff_location?.barangay, req?.dropoff_location?.city].filter(Boolean).join(', '),
          dropoffLat: req?.dropoff_location?.latitude,
          dropoffLng: req?.dropoff_location?.longitude,
          dropoffNote: req?.dropoff_note,

          sender: sender ? `${sender.first_name || ''} ${sender.last_name || ''}`.trim() || 'Unknown Sender' : 'Unknown Sender',
          senderPhone: sender?.phone_number,
          receiverName: receiver?.receiver_name || 'Receiver',
          receiverPhone: req?.receiver_phone || receiver?.receiver_phone,
          
          tracking: `PNS-${String(req?.request_id || r.delivery_id).padStart(4, '0')}`,
          price: Number(req?.estimated_cost || 0).toFixed(2),
          statusLabel, statusColor, statusBg, statusIcon,
          timestamp: dateObj.getTime(),
          
          items,
          weight: cargo?.total_weight_kg != null ? Number(cargo.total_weight_kg) : null,
          dims: dims.every((v: any) => Number(v) > 0) ? `${dims[0]} × ${dims[1]} × ${dims[2]} cm` : null,
          podPhotoUrl: r.pod_photo_url,
        };
      });

      mapped.sort((a, b) => b.timestamp - a.timestamp);
      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching provider history:', err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [colors, isDark]);

  useFocusEffect(
    useCallback(() => {
      const fetchUserData = async () => {
        try {
          setImgKey(Date.now());
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          if (user.user_metadata?.first_name) setFirstName(user.user_metadata.first_name);
          if (user.user_metadata?.last_name) setLastName(user.user_metadata.last_name);
          if (user.user_metadata?.avatar_url) {
            setAvatarUrl(user.user_metadata.avatar_url);
            setImageError(false);
          }
          setUserEmail(user.email || '');

          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, first_name, last_name, profile_photo')
            .eq('auth_id', user.id)
            .maybeSingle();

          if (userError || !userData) return;

          setUserId(userData.user_id);
          countNeedingMyAction().then(setDisputeCount).catch(() => {});

          if (!user.user_metadata?.first_name && userData.first_name) setFirstName(userData.first_name);
          if (!user.user_metadata?.last_name && userData.last_name) setLastName(userData.last_name);
          if (!user.user_metadata?.avatar_url && userData.profile_photo) {
            setAvatarUrl(userData.profile_photo);
            setImageError(false);
          }

          fetchHistory(userData.user_id);
        } catch (error) {
          console.error('Error fetching provider data:', error);
        }
      };
      fetchUserData();
    }, [fetchHistory])
  );

  const handleSwitchToSender = async () => {
    await setLastMode('sender');
    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] } as any);
  };

  const handleLogoutConfirm = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out', style: 'destructive',
        onPress: async () => {
          await clearLastMode();
          await supabase.auth.signOut();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ], { cancelable: true });
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const avatarScale = avatarPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  /* ---------------- History Detail Modal ---------------- */
  const renderHistoryDetailModal = () => {
    const item = selectedHistoryJob;
    if (!item) return null;

    const mapH = Math.round(SCREEN_H * 0.4);

    return (
      <Modal visible={!!item} animationType="slide" onRequestClose={() => setSelectedHistoryJob(null)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
          
          <TouchableOpacity
            style={[styles.modalRoundBtn, { top: Math.max(insets.top, 16) + 6, left: 16 }]}
            onPress={() => setSelectedHistoryJob(null)}
            activeOpacity={0.85}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <ScrollView
            style={StyleSheet.absoluteFill}
            contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ height: mapH - 28 }}>
              <View style={[styles.modalMap, { height: mapH + 24, position: 'relative' }]}>
                <RoutePreviewMap
                  pickupLat={item.pickupLat} pickupLng={item.pickupLng}
                  dropoffLat={item.dropoffLat} dropoffLng={item.dropoffLng}
                  padTop={insets.top + 70} padBottom={60}
                />
              </View>
            </View>

            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />

              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <View style={styles.serviceTypeBadge}>
                    <Text style={styles.serviceTypeText}>{item.type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: item.statusBg }]}>
                    <Ionicons name={item.statusIcon} size={12} color={item.statusColor} />
                    <Text style={[styles.statusBadgeText, { color: item.statusColor }]}>{item.statusLabel}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.modalCode}>#{item.tracking}</Text>
              <Text style={styles.modalDate}>{formatDateTime(item.rawDate.toISOString())}</Text>

              <View style={styles.routeBox}>
                <View style={styles.routeRow}>
                  <View style={styles.dotOrange} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeAddressText} numberOfLines={1}>{item.pickup}</Text>
                    {!!item.pickupSub && <Text style={styles.routeSubText} numberOfLines={1}>{item.pickupSub}</Text>}
                  </View>
                </View>
                <View style={styles.routeConnectorLine} />
                <View style={styles.routeRow}>
                  <View style={styles.dotDark} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.routeAddressText} numberOfLines={1}>{item.dropoff}</Text>
                    {!!item.dropoffSub && <Text style={styles.routeSubText} numberOfLines={1}>{item.dropoffSub}</Text>}
                  </View>
                </View>
              </View>

              {(!!item.pickupNote || !!item.dropoffNote) && (
                <View style={{ gap: 8, marginBottom: 16 }}>
                  {!!item.pickupNote && (
                    <View style={styles.modalNoteBox}>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={ORANGE} />
                      <Text style={styles.modalNoteText}>Pickup: {item.pickupNote}</Text>
                    </View>
                  )}
                  {!!item.dropoffNote && (
                    <View style={styles.modalNoteBox}>
                      <Ionicons name="chatbubble-ellipses-outline" size={14} color={ORANGE} />
                      <Text style={styles.modalNoteText}>Drop-off: {item.dropoffNote}</Text>
                    </View>
                  )}
                </View>
              )}

              <View style={styles.modalContactsRow}>
                <View style={styles.modalContactCard}>
                  <View style={[styles.modalContactAvatar, { backgroundColor: BLUE }]}>
                    <Text style={styles.modalContactAvatarText}>
                      {(item.sender.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalContactRole}>SENDER</Text>
                    <Text style={styles.modalContactName} numberOfLines={1}>{item.sender}</Text>
                  </View>
                </View>
                <View style={styles.modalContactCard}>
                  <View style={[styles.modalContactAvatar, { backgroundColor: PURPLE }]}>
                    <Text style={styles.modalContactAvatarText}>
                      {(item.receiverName.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('') || '?').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalContactRole}>RECEIVER</Text>
                    <Text style={styles.modalContactName} numberOfLines={1}>{item.receiverName}</Text>
                  </View>
                </View>
              </View>

              {item.podPhotoUrl && (
                <>
                  <View style={styles.modalSecHead}>
                    <Ionicons name="shield-checkmark-outline" size={17} color={colors.success} />
                    <Text style={styles.modalSecTitle}>Proof of Delivery</Text>
                  </View>
                  <Image
                    source={{ uri: item.podPhotoUrl }}
                    style={{ width: '100%', height: 180, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}
                    resizeMode="cover"
                  />
                </>
              )}

              <View style={styles.modalSecHead}>
                <Ionicons name="cube-outline" size={17} color={ORANGE} />
                <Text style={styles.modalSecTitle}>Package Details</Text>
              </View>

              <View style={styles.tileGrid}>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>PACKAGES</Text>
                  <Text style={styles.tileValue}>{item.items.length} {item.items.length === 1 ? 'item' : 'items'}</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>WEIGHT</Text>
                  <Text style={styles.tileValue}>{item.weight ? `${item.weight} kg` : '—'}</Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>HANDLING</Text>
                  <Text style={[styles.tileValue, item.items.some((i: any) => i.fragile) && { color: ORANGE }]}>
                    {item.items.some((i: any) => i.fragile) ? 'Fragile' : 'Standard'}
                  </Text>
                </View>
                <View style={styles.tile}>
                  <Text style={styles.tileLabel}>EARNINGS</Text>
                  <Text style={[styles.tileValue, { color: item.statusLabel === 'Cancelled' ? colors.textMuted : colors.success }]}>
                    ₱{item.price}
                  </Text>
                </View>
                {!!item.dims && (
                  <View style={styles.tile}>
                    <Text style={styles.tileLabel}>DIMENSIONS</Text>
                    <Text style={styles.tileValue}>{item.dims}</Text>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    );
  };

  /* ---------------- History sub-screen ---------------- */
  if (showHistory) {
    const filteredHistory = history.filter((item) => {
      if (historyFilter === 'All') return true;
      return item.statusLabel === historyFilter;
    });

    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

        <View style={[styles.historyHeader, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <TouchableOpacity onPress={() => setShowHistory(false)} style={styles.backBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.historyHeaderTitle}>Job History</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.historyContent} contentContainerStyle={styles.historyScroll} showsVerticalScrollIndicator={false}>
          <Animated.View style={{ opacity: historyAnim }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow} style={{ marginBottom: 20 }}>
              {(['All', 'Awaiting Pickup', 'In Transit', 'Completed', 'Cancelled'] as const).map((f) => {
                const active = historyFilter === f;
                return (
                  <TouchableOpacity key={f} style={[styles.filterChip, active && styles.filterChipActive]} onPress={() => setHistoryFilter(f)} activeOpacity={0.85}>
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f}</Text>
                    {f !== 'All' && (
                      <View style={[styles.filterCount, active && styles.filterCountActive]}>
                        <Text style={[styles.filterCountText, active && styles.filterCountTextActive]}>
                          {history.filter((h) => h.statusLabel === f).length}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {historyLoading ? (
              <View style={styles.historyStateContainer}>
                <ActivityIndicator color={ORANGE} size="large" />
                <Text style={styles.historyStateText}>Loading jobs...</Text>
              </View>
            ) : filteredHistory.length === 0 ? (
              <View style={styles.historyStateContainer}>
                <View style={styles.emptyIconBox}>
                  <Ionicons name="briefcase-outline" size={38} color={ORANGE} />
                </View>
                <Text style={styles.historyEmptyTitle}>No jobs found</Text>
                <Text style={styles.historyEmptySubtext}>
                  {historyFilter === 'All'
                    ? 'Your past deliveries and jobs will show up here.'
                    : `No ${historyFilter.toLowerCase()} jobs found.`}
                </Text>
              </View>
            ) : (
              filteredHistory.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.card,
                    (item.statusLabel === 'Completed' || item.statusLabel === 'Cancelled') ? styles.completedCard : null,
                  ]}
                  activeOpacity={0.85}
                  onPress={() => setSelectedHistoryJob(item)}
                >
                  <View style={styles.cardHeader}>
                    <View style={styles.cardHeaderLeft}>
                      <View style={styles.serviceTypeBadge}>
                        <Text style={styles.serviceTypeText}>
                          {item.type === 'door-to-door' ? 'Door-to-Door' : 'Curb-side'}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: item.statusBg }]}>
                        <Ionicons name={item.statusIcon} size={12} color={item.statusColor} />
                        <Text style={[styles.statusBadgeText, { color: item.statusColor }]}>{item.statusLabel}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.routeBox}>
                    <View style={styles.routeRow}>
                      <View style={styles.dotOrange} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>{item.pickup}</Text>
                    </View>
                    <View style={styles.routeConnectorLine} />
                    <View style={styles.routeRow}>
                      <View style={styles.dotDark} />
                      <Text style={styles.routeAddressText} numberOfLines={1}>{item.dropoff}</Text>
                    </View>
                  </View>

                  <View style={styles.cardContextRow}>
                    <View style={styles.contextDateBox}>
                      <Ionicons name="calendar-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.contextText}>{item.date} • {item.time}</Text>
                    </View>
                    {item.sender !== 'Unknown Sender' && (
                      <View style={styles.contextProviderPill}>
                        <Ionicons name="person" size={13} color={colors.success} />
                        <Text style={styles.contextProviderText} numberOfLines={1}>{item.sender}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.cardFooter}>
                    <View style={styles.hTrackingWrapper}>
                      <Ionicons name="barcode-outline" size={13} color={colors.textSecondary} />
                      <Text style={styles.hTracking}>{item.tracking}</Text>
                    </View>
                    <Text style={styles.priceText}>₱{item.price}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </Animated.View>
        </ScrollView>

        {renderHistoryDetailModal()}
      </View>
    );
  }

  /* ---------------- Main screen ---------------- */
  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <Animated.View style={[styles.fixedTopContainer, { paddingTop: Math.max(insets.top, 16) + 14 }, fadeUp(headerAnim, 14)]}>
        <View style={styles.headerTopBar}>
          <Text style={styles.headerTitle}>My Profile</Text>
        </View>

        <View style={styles.profileContainerCard}>
          <View style={styles.profileRow}>
            <Animated.View style={[{ transform: [{ scale: avatarScale }] }]}>
              <View style={styles.profilePicContainer}>
                {avatarUrl && !imageError ? (
                  <Image
                    key={`avatar-${imgKey}`}
                    source={{ uri: avatarUrl, cache: 'reload' }}
                    style={styles.profileImage}
                    onError={() => setImageError(true)}
                  />
                ) : (
                  <Ionicons name="person" size={28} color={ORANGE} />
                )}
              </View>
            </Animated.View>

            <View style={styles.nameContainer}>
              <View style={styles.nameAndBadgeRow}>
                <Text style={styles.profileName} numberOfLines={1}>{firstName} {lastName}</Text>
                <View style={[styles.roleBadgeInline, { backgroundColor: '#EFF6FF', borderColor: '#3B82F6' }]}>
                  <Text style={[styles.roleBadgeTextInline, { color: '#3B82F6' }]}>SENDER</Text>
                </View>
                <View style={[styles.roleBadgeInline, { backgroundColor: '#FFF7ED', borderColor: ORANGE }]}>
                  <Text style={[styles.roleBadgeTextInline, { color: ORANGE }]}>PROVIDER</Text>
                </View>
              </View>
              <Text style={styles.profileEmail} numberOfLines={1}>{userEmail}</Text>
            </View>

            <TouchableOpacity style={styles.editIconBtn} onPress={() => navigation.navigate('EditProfile' as any)} activeOpacity={0.8}>
              <Ionicons name="pencil" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.mainContent} contentContainerStyle={styles.mainScrollContent}>
        <Animated.View style={[styles.bodyContentWrapper, fadeUp(contentAnim, 20)]}>
          <Text style={styles.sectionTitle}>Account & Services</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToSender} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="swap-horizontal-outline" size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Switch to Sender Mode</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Send packages instead of delivering</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('PaymentMethods' as any)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#16243B' : '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={19} color="#3B82F6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Manage payout accounts</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('ManageVehicle' as any)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="car-sport-outline" size={19} color={colors.success} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Manage Vehicle</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Add or update your vehicles</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('ManageRoutes' as any)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#1E1436' : '#F5F3FF' }]}>
                  <Ionicons name="map-outline" size={19} color="#8B5CF6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Manage Travel Routes</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>View and edit your routes</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => setShowHistory(true)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.successBg }]}>
                  <Ionicons name="briefcase-outline" size={19} color={colors.success} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Job History</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Past deliveries & jobs</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => (navigation as any).navigate('Support', { role: 'provider' })} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="headset-outline" size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Customer Service</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    {disputeCount > 0 ? 'Reports waiting for your response' : 'Report a problem, track cases, contact support'}
                  </Text>
                </View>
              </View>
              {disputeCount > 0 && (
                <View style={styles.disputeBadge}><Text style={styles.disputeBadgeText}>{disputeCount}</Text></View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Preferences & System</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings' as any)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#1F262E' : '#F3F4F6' }]}>
                  <Ionicons name="settings-outline" size={19} color={colors.textSecondary} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Settings</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>App preferences & notifications</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#241A0B' : '#FFF7ED' }]}>
                  <Ionicons name={isDark ? 'moon' : 'moon-outline'} size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Dark Mode</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    {isDark ? 'Currently using dark theme' : 'Switch to dark theme'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isDark}
                onValueChange={toggleDark}
                trackColor={{ false: '#D1D5DB', true: ORANGE }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#D1D5DB"
              />
            </View>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleLogoutConfirm} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.errorBg }]}>
                  <Ionicons name="log-out-outline" size={19} color={colors.error} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.logoutText}>Log out</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Sign out of your account</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#FCA5A5" />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Pack-N-Ship Provider · v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                             */
/* ------------------------------------------------------------------ */
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  fixedTopContainer: { backgroundColor: 'transparent', paddingHorizontal: 20, paddingBottom: 12 },
  headerTopBar: { marginBottom: 14 },
  headerTitle: { fontSize: 30, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.5 },

  profileContainerCard: {
    backgroundColor: c.card, borderRadius: 20, padding: 14,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.25,
    shadowRadius: 8, elevation: 2,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  profilePicContainer: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
    overflow: 'hidden', borderWidth: 1.5, borderColor: c.border,
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: { flex: 1, marginRight: 8, justifyContent: 'center' },
  nameAndBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  profileName: { fontSize: 16, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  profileEmail: { fontSize: 12, color: c.textSecondary, fontWeight: '500', marginTop: 2 },
  editIconBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border,
  },
  roleBadgeInline: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  roleBadgeTextInline: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  mainContent: { flex: 1 },
  mainScrollContent: { paddingBottom: 100 },
  bodyContentWrapper: { paddingHorizontal: 20, paddingTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary, marginBottom: 12, letterSpacing: -0.3 },

  menuCard: {
    backgroundColor: c.card, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.25,
    shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: c.border,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 10, borderRadius: 14,
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  menuIconWrapper: {
    width: 42, height: 42, borderRadius: 13,
    justifyContent: 'center', alignItems: 'center', marginRight: 14,
  },
  menuTextWrapper: { flex: 1 },
  menuText: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
  menuSubtext: { fontSize: 12, color: c.textSecondary, marginTop: 2, fontWeight: '500' },
  menuDivider: { height: 1, backgroundColor: c.divider, marginLeft: 66, marginRight: 10 },

  disputeBadge: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: c.error,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginRight: 8,
  },
  disputeBadgeText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  logoutText: { fontSize: 15, fontWeight: '700', color: c.error },
  versionText: {
    textAlign: 'center', color: c.textMuted, fontSize: 11,
    fontWeight: '600', marginTop: 24, marginBottom: 20, letterSpacing: 0.5,
  },

  historyHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 16,
    backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border,
  },
  historyHeaderTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  historyContent: { flex: 1, backgroundColor: c.background },
  historyScroll: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 100 },

  historyStateContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 64, paddingHorizontal: 24 },
  emptyIconBox: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: c.border,
  },
  historyStateText: { marginTop: 14, fontSize: 14, color: c.textSecondary, fontWeight: '500' },
  historyEmptyTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary, marginBottom: 6 },
  historyEmptySubtext: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },

  filterRow: { flexDirection: 'row', gap: 8, paddingRight: 20 },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, gap: 6,
  },
  filterChipActive: {
    backgroundColor: ORANGE, borderColor: ORANGE,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 3,
  },
  filterChipText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  filterChipTextActive: { color: '#FFFFFF' },
  filterCount: {
    backgroundColor: c.divider, minWidth: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6,
  },
  filterCountActive: { backgroundColor: 'rgba(255,255,255,0.28)' },
  filterCountText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
  filterCountTextActive: { color: '#FFFFFF' },

  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.06 : 0.3,
    shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: c.border,
  },
  completedCard: { backgroundColor: c.cardElevated, borderColor: c.border, opacity: 0.95 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  serviceTypeBadge: { backgroundColor: c.divider, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  serviceTypeText: { fontSize: 11, fontWeight: '800', color: c.textSecondary },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, gap: 4,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '800' },
  
  routeBox: {
    backgroundColor: c.background, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 12, borderWidth: 1, borderColor: c.divider,
  },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dotOrange: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE, marginTop: 6 },
  dotDark: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.textPrimary, marginTop: 6 },
  routeConnectorLine: { width: 2, height: 14, backgroundColor: c.border, marginLeft: 3, marginVertical: 3 },
  routeAddressText: { fontSize: 14, fontWeight: '700', color: c.textPrimary, flex: 1 },
  routeSubText: { fontSize: 12, color: c.textSecondary, marginTop: 2 },

  cardContextRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  contextDateBox: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  contextText: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  contextProviderPill: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.successBg, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, gap: 5, borderWidth: 1, borderColor: c.success, flexShrink: 1,
  },
  contextProviderText: { fontSize: 11, fontWeight: '700', color: c.success },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider,
  },
  priceText: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  hTrackingWrapper: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: c.background, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 10, borderWidth: 1, borderColor: c.border,
  },
  hTracking: { fontSize: 12, color: c.textSecondary, fontWeight: '700', letterSpacing: 0.3 },

  /* Modal Details Styles */
  modalRoundBtn: {
    position: 'absolute', width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 5, elevation: 6, zIndex: 10,
  },
  modalMap: { overflow: 'hidden' },
  modalSheet: {
    backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: 24, minHeight: 500,
  },
  modalHandle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10, marginBottom: 16 },
  modalCode: { fontSize: 24, fontWeight: '900', color: c.textPrimary, letterSpacing: -0.5 },
  modalDate: { fontSize: 13, fontWeight: '700', color: ORANGE, marginTop: 4, marginBottom: 16 },
  
  modalNoteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: 'rgba(255,117,31,0.10)', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  modalNoteText: { flex: 1, fontSize: 13, lineHeight: 18, color: c.textPrimary, fontWeight: '600' },

  modalContactsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modalContactCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.background, borderRadius: 14, borderWidth: 1, borderColor: c.divider, padding: 12,
  },
  modalContactAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  modalContactAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  modalContactRole: { fontSize: 9, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  modalContactName: { fontSize: 14, fontWeight: '800', color: c.textPrimary },

  modalSecHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 12 },
  modalSecTitle: { fontSize: 16, fontWeight: '900', color: c.textPrimary },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, backgroundColor: c.background, borderWidth: 1, borderColor: c.divider, borderRadius: 14, padding: 14 },
  tileLabel: { fontSize: 10, fontWeight: '800', color: c.textMuted, letterSpacing: 0.8 },
  tileValue: { fontSize: 15, fontWeight: '900', color: c.textPrimary, marginTop: 4 },
});