// src/modules/Dashboard/Sender/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  StatusBar,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Brand */
const ORANGE = '#FF751F';

// Provider registration state
type ProviderState = 'none' | 'pending' | 'approved' | 'rejected';

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [userEmail, setUserEmail] = useState<string>('john.doe@example.com');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [userRole, setUserRole] = useState<string>('Sender');
  const [providerState, setProviderState] = useState<ProviderState>('none');
  const [userId, setUserId] = useState<number | null>(null);
  const [imgKey, setImgKey] = useState<number>(Date.now());

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'All' | 'Pending' | 'In Transit' | 'Completed' | 'Cancelled'>('All');

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const avatarPulse = useRef(new Animated.Value(0)).current;
  const historyAnim = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation                                                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(contentAnim, 180),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(avatarPulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(avatarPulse, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [headerAnim, contentAnim, avatarPulse]);

  /* ------------------------------------------------------------------ */
  /* History entrance                                                    */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (showHistory) {
      historyAnim.setValue(0);
      Animated.timing(historyAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [showHistory, historyAnim]);

  /* ------------------------------------------------------------------ */
  /* Fetch past delivery_requests for this sender                        */
  /* ------------------------------------------------------------------ */
  const fetchHistory = useCallback(async (senderId: number) => {
    try {
      setHistoryLoading(true);

      const { data, error } = await supabase
        .from('delivery_requests')
        .select(`
          request_id,
          pickup_type,
          delivery_status,
          scheduled_time,
          created_at,
          estimated_cost,
          pickup_location:locations!delivery_requests_pickup_location_id_fkey (
            street_address, barangay, city, province
          ),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey (
            street_address, barangay, city, province
          ),
          deliveries (
            delivery_id,
            completed_at,
            provider:users!deliveries_provider_id_fkey (
              first_name, last_name
            )
          )
        `)
        .eq('sender_id', senderId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((r: any) => {
        const delivery = r.deliveries?.[0];
        const provider = delivery?.provider;

        const dateObj = r.scheduled_time
          ? new Date(r.scheduled_time)
          : new Date(r.created_at);

        const pickupAddr = r.pickup_location?.street_address || 'Pickup location';
        const dropoffAddr = r.dropoff_location?.street_address || 'Dropoff location';

        const rawStatus = (r.delivery_status || 'Pending').trim();
        const isCancelled = /cancel/i.test(rawStatus);
        const isCompleted = /complete|delivered/i.test(rawStatus) || !!delivery?.completed_at;
        const isTransit = /transit|accepted|picked/i.test(rawStatus);

        let statusLabel = rawStatus;
        let statusColor = '#6B7280';
        let statusBg = '#F3F4F6';
        let statusIcon: any = 'time-outline';

        if (isCompleted) {
          statusLabel = 'Completed';
          statusColor = '#166534';
          statusBg = '#DCFCE7';
          statusIcon = 'checkmark-circle';
        } else if (isCancelled) {
          statusLabel = 'Cancelled';
          statusColor = '#991B1B';
          statusBg = '#FEE2E2';
          statusIcon = 'close-circle';
        } else if (isTransit) {
          statusLabel = 'In Transit';
          statusColor = '#0369A1';
          statusBg = '#E0F2FE';
          statusIcon = 'car-sport';
        } else {
          statusLabel = 'Pending';
          statusColor = '#92400E';
          statusBg = '#FEF3C7';
          statusIcon = 'time-outline';
        }

        return {
          id: String(r.request_id),
          type: r.pickup_type || 'Curb-side Drop-off',
          date: dateObj.toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
          }),
          time: dateObj.toLocaleTimeString('en-US', {
            hour: 'numeric', minute: '2-digit',
          }),
          pickup: pickupAddr,
          pickupSub: [
            r.pickup_location?.barangay,
            r.pickup_location?.city,
            r.pickup_location?.province,
          ].filter(Boolean).join(', '),
          dropoff: dropoffAddr,
          dropoffSub: [
            r.dropoff_location?.barangay,
            r.dropoff_location?.city,
            r.dropoff_location?.province,
          ].filter(Boolean).join(', '),
          provider: provider
            ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() || 'Unknown Provider'
            : 'Unassigned',
          tracking: `PNS-${String(r.request_id).padStart(4, '0')}`,
          price: Number(r.estimated_cost || 0).toFixed(2),
          statusLabel,
          statusColor,
          statusBg,
          statusIcon,
        };
      });

      setHistory(mapped);
    } catch (err) {
      console.error('Error fetching history:', err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  /* ------------------------------------------------------------------ */
  /* Fetch user data + provider verification state                       */
  /* ------------------------------------------------------------------ */
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

          setUserEmail(user.email || 'john.doe@example.com');

          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, first_name, last_name, profile_photo')
            .eq('auth_id', user.id)
            .maybeSingle();

          if (userError || !userData) return;

          setUserId(userData.user_id);

          if (!user.user_metadata?.first_name && userData.first_name) {
            setFirstName(userData.first_name);
          }
          if (!user.user_metadata?.last_name && userData.last_name) {
            setLastName(userData.last_name);
          }
          if (!user.user_metadata?.avatar_url && userData.profile_photo) {
            setAvatarUrl(userData.profile_photo);
            setImageError(false);
          }

          fetchHistory(userData.user_id);

          const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
              role_id,
              roles!inner (role_name)
            `)
            .eq('user_id', userData.user_id);

          if (rolesError) return;

          const hasProviderRole = (userRoles || []).some(
            (ur: any) => ur.roles?.role_name === 'Provider'
          );

          if (!hasProviderRole) {
            setUserRole('Sender');
            setProviderState('none');
            return;
          }

          setUserRole('Provider');

          const { data: verif, error: verifError } = await supabase
            .from('provider_verifications')
            .select('verification_status, submitted_at')
            .eq('provider_id', userData.user_id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (verifError || !verif) {
            setProviderState('pending');
            return;
          }

          const status = (verif.verification_status || '').toLowerCase();

          if (status === 'approved' || status === 'verified') {
            setProviderState('approved');
          } else if (status === 'rejected') {
            setProviderState('rejected');
          } else {
            setProviderState('pending');
          }

        } catch (error) {
          console.error('Error fetching user data:', error);
        }
      };
      fetchUserData();

      return () => {
        StatusBar.setBarStyle('dark-content', true);
      };
    }, [fetchHistory])
  );

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const handleLogoutConfirm = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('last_mode');
            await supabase.auth.signOut();
            navigation.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleSettingsPress = () => {
    navigation.navigate('Settings');
  };

  const handlePaymentMethodsPress = () => {
    Alert.alert('Coming Soon', 'Payment methods will be available in a future update.');
  };

  const handleSwitchToProvider = async () => {
    await AsyncStorage.setItem('last_mode', 'provider');

    if (providerState === 'approved') {
      navigation.navigate('ProviderTabs', { screen: 'Jobs' });
      return;
    }

    if (providerState === 'pending') {
      Alert.alert(
        'Awaiting Approval',
        'Your provider application is pending admin review. You will be able to switch to Provider Mode once approved.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (providerState === 'rejected') {
      Alert.alert(
        'Application Rejected',
        'Your previous provider application was rejected. You can submit a new application with updated documents.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Re-apply',
            onPress: () => navigation.navigate('RegisterProvider'),
          },
        ]
      );
      return;
    }

    navigation.navigate('RegisterProvider');
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  const avatarScale = avatarPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const providerMenuTitle = (() => {
    switch (providerState) {
      case 'approved': return 'Switch to Provider Mode';
      case 'pending':  return 'Provider Application Pending';
      case 'rejected': return 'Provider Application Rejected';
      default:         return 'Register as a Provider';
    }
  })();

  const providerMenuSubtext = (() => {
    switch (providerState) {
      case 'approved': return 'Manage delivery tasks';
      case 'pending':  return 'Waiting for admin approval';
      case 'rejected': return 'Tap to re-apply with new documents';
      default:         return 'Earn by delivering packages';
    }
  })();

  /* ------------------------------------------------------------------ */
  /* History Sub-Screen                                                  */
  /* ------------------------------------------------------------------ */
  if (showHistory) {
    const filteredHistory = history.filter((item) => {
      if (historyFilter === 'All') return true;
      return item.statusLabel === historyFilter;
    });

    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

        <View style={[styles.historyHeader, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
          <TouchableOpacity
            onPress={() => setShowHistory(false)}
            style={styles.backBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.historyHeaderTitle}>Delivery History</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          style={styles.historyContent}
          contentContainerStyle={styles.historyScroll}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: historyAnim }}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              style={{ marginBottom: 20 }}
            >
              {(['All', 'Pending', 'In Transit', 'Completed', 'Cancelled'] as const).map((f) => {
                const active = historyFilter === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setHistoryFilter(f)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                      {f}
                    </Text>
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
                <Text style={styles.historyStateText}>Loading history...</Text>
              </View>
            ) : filteredHistory.length === 0 ? (
              <View style={styles.historyStateContainer}>
                <View style={styles.emptyIconBox}>
                  <Ionicons name="receipt-outline" size={38} color={ORANGE} />
                </View>
                <Text style={styles.historyEmptyTitle}>No deliveries found</Text>
                <Text style={styles.historyEmptySubtext}>
                  {historyFilter === 'All'
                    ? 'Your past deliveries and receipts will show up here.'
                    : `No ${historyFilter.toLowerCase()} deliveries found.`}
                </Text>
              </View>
            ) : (
              filteredHistory.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.hCardAccent} />

                  <View style={styles.hCardTopRow}>
                    <Text style={styles.hCardType}>{item.type}</Text>
                    <View style={[styles.hStatusPill, { backgroundColor: item.statusBg }]}>
                      <Ionicons name={item.statusIcon} size={11} color={item.statusColor} />
                      <Text style={[styles.hStatusText, { color: item.statusColor }]}>
                        {item.statusLabel.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.hCardDate}>{item.date}   {item.time}</Text>

                  <View style={styles.hCardBody}>
                    <View style={styles.hCardTimeline}>
                      <View style={styles.hTimelinePoint}>
                        <View style={styles.blueDot}>
                          <View style={styles.blueDotInner} />
                        </View>
                        <View style={styles.hAddressWrapper}>
                          <Text style={styles.hAddressMain} numberOfLines={1}>{item.pickup}</Text>
                          <Text style={styles.hAddressSub} numberOfLines={2}>
                            {item.pickupSub}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.hTimelineLine} />
                      <View style={styles.hTimelinePoint}>
                        <Ionicons
                          name="location"
                          size={16}
                          color="#EF4444"
                          style={{ marginLeft: -1, marginRight: 6 }}
                        />
                        <View style={styles.hAddressWrapper}>
                          <Text style={styles.hAddressMain} numberOfLines={1}>{item.dropoff}</Text>
                          <Text style={styles.hAddressSub} numberOfLines={2}>
                            {item.dropoffSub}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.hCardDivider} />

                  <View style={styles.hCardFooter}>
                    <View style={styles.hTrackingWrapper}>
                      <Ionicons name="barcode-outline" size={13} color="#6B7280" />
                      <Text style={styles.hTracking}>{item.tracking}</Text>
                    </View>
                    <Text style={styles.hPrice}>₱{item.price}</Text>
                  </View>
                </View>
              ))
            )}
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Main Screen (Fixed Top Profile/Header + Scrollable Menu Content)    */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* FIXED TOP SECTION (Non-scrollable: Header & Compact Profile Card with Inline Mode Badge) */}
      <Animated.View
        style={[
          styles.fixedTopContainer,
          { paddingTop: Math.max(insets.top, 16) + 14 },
          fadeUp(headerAnim, 14),
        ]}
      >
        <View style={styles.headerTopBar}>
          <Text style={styles.headerTitle}>My Profile</Text>
        </View>

        {/* Compact Profile Card (Transparent background, no solid orange, with inline role badge) */}
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
                  <Ionicons name="person" size={32} color={ORANGE} />
                )}
              </View>
            </Animated.View>

            <View style={styles.nameContainer}>
              <View style={styles.nameAndBadgeRow}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {firstName} {lastName}
                </Text>
                <View
                  style={[
                    styles.roleBadgeInline,
                    providerState === 'approved'
                      ? styles.roleBadgeProvider
                      : providerState === 'pending'
                      ? styles.roleBadgePending
                      : providerState === 'rejected'
                      ? styles.roleBadgeRejected
                      : styles.roleBadgeSender,
                  ]}
                >
                  <Text
                    style={[
                      styles.roleBadgeTextInline,
                      {
                        color:
                          providerState === 'approved'
                            ? '#10B981'
                            : providerState === 'pending'
                            ? '#F59E0B'
                            : providerState === 'rejected'
                            ? '#EF4444'
                            : ORANGE,
                      },
                    ]}
                  >
                    {providerState === 'approved'
                      ? 'PROVIDER'
                      : providerState === 'pending'
                      ? 'PENDING'
                      : providerState === 'rejected'
                      ? 'REJECTED'
                      : 'SENDER'}
                  </Text>
                </View>
              </View>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {userEmail}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.editIconBtn}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil" size={16} color="#4B5563" />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* SCROLLABLE CONTENT SECTION (Account & Services, Preferences, etc.) */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.mainContent}
        contentContainerStyle={styles.mainScrollContent}
      >
        <Animated.View style={[styles.bodyContentWrapper, fadeUp(contentAnim, 20)]}>
          <Text style={styles.sectionTitle}>Account & Services</Text>

          {/* Menu Card */}
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSwitchToProvider}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FFF7ED' }]}>
                  <Ionicons name="swap-horizontal-outline" size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>{providerMenuTitle}</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    {providerMenuSubtext}
                  </Text>
                </View>
              </View>

              {providerState === 'approved' && (
                <View style={styles.providerBadge}>
                  <View style={styles.providerBadgeDot} />
                  <Text style={styles.providerBadgeText}>Active</Text>
                </View>
              )}

              {providerState === 'pending' && (
                <View style={styles.pendingBadge}>
                  <Ionicons name="time-outline" size={10} color="#F59E0B" />
                  <Text style={styles.pendingBadgeText}>Pending</Text>
                </View>
              )}

              {providerState === 'rejected' && (
                <View style={styles.rejectedBadge}>
                  <Ionicons name="close-circle-outline" size={10} color="#EF4444" />
                  <Text style={styles.rejectedBadgeText}>Rejected</Text>
                </View>
              )}

              {providerState === 'none' && (
                <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
              )}
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handlePaymentMethodsPress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={19} color="#3B82F6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Manage cards & wallets</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowHistory(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="time-outline" size={19} color="#10B981" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Delivery History</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Past deliveries & receipts
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Preferences & System</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSettingsPress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F3F4F6' }]}>
                  <Ionicons name="settings-outline" size={19} color="#6B7280" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Settings</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    App preferences & notifications
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogoutConfirm}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FEF2F2' }]}>
                  <Ionicons name="log-out-outline" size={19} color="#EF4444" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.logoutText}>Log out</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Sign out of your account
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#FCA5A5" />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  fixedTopContainer: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  headerTopBar: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  profileContainerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePicContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFE4D2',
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: {
    flex: 1,
    marginRight: 10,
    justifyContent: 'center',
  },
  nameAndBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  profileEmail: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 4,
  },
  editIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  roleBadgeInline: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  roleBadgeProvider: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  roleBadgeSender: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FFE4D2',
  },
  roleBadgePending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  roleBadgeRejected: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  roleBadgeTextInline: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  mainContent: { flex: 1 },
  mainScrollContent: {
    paddingBottom: 48,
  },
  bodyContentWrapper: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#6B7280',
    marginBottom: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },

  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    minHeight: 68,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  menuIconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextWrapper: { flex: 1 },
  menuText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },
  menuSubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 3,
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 72,
    marginRight: 12,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  providerBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  providerBadgeText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pendingBadgeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  rejectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  rejectedBadgeText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EF4444',
  },
  versionText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 24,
    letterSpacing: 0.4,
  },

  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  historyHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  historyContent: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  historyScroll: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 48,
  },

  historyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 24,
  },
  emptyIconBox: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  historyStateText: {
    marginTop: 14,
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  historyEmptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  historyEmptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },

  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    paddingLeft: 22,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    position: 'relative',
  },
  hCardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: ORANGE,
  },
  hCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  hCardType: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  hStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  hStatusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  hCardDate: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  hCardBody: { flexDirection: 'row', justifyContent: 'space-between' },
  hCardTimeline: { flex: 1 },
  hTimelinePoint: { flexDirection: 'row', alignItems: 'flex-start' },
  blueDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 20,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  filterChipActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    backgroundColor: '#F3F4F6',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  filterCountActive: {
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
  },
  filterCountTextActive: {
    color: '#FFFFFF',
  },
  blueDotInner: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: ORANGE,
  },
  hTimelineLine: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginLeft: 7,
    marginVertical: 3,
  },
  hAddressWrapper: { flex: 1 },
  hAddressMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 3,
  },
  hAddressSub: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  hCardDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 14,
  },
  hCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hTrackingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  hTracking: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  hPrice: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
});