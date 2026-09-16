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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';

/** Brand */
const ORANGE = '#FA7A25';

// Provider registration state
type ProviderState = 'none' | 'pending' | 'approved' | 'rejected';

// Mock Data for History View
const MOCK_HISTORY = [
  {
    id: 'h1',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    pickup: 'Landers Superstore Cebu',
    pickupSub: 'Skyrise 4 Tower, Geonzon Street, cor V. Padriga Street, Cebu City',
    dropoff: 'Gaisano Country Mall',
    dropoffSub: 'Gov. M. Cueno Ave Main Entrance',
    provider: 'Jun Joseph Pestaño',
    tracking: 'CXV34DA675FAS',
    price: '24.00',
  },
  {
    id: 'h2',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    pickup: 'Landers Superstore Cebu',
    pickupSub: 'Skyrise 4 Tower, Geonzon Street, cor V. Padriga Street, Cebu City',
    dropoff: 'Gaisano Country Mall',
    dropoffSub: 'Gov. M. Cueno Ave Main Entrance',
    provider: 'Jun Joseph Pestaño',
    tracking: 'CXV34DA675FAS',
    price: '24.00',
  },
  {
    id: 'h3',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    pickup: 'Landers Superstore Cebu',
    pickupSub: 'Skyrise 4 Tower, Geonzon Street, cor V. Padriga Street, Cebu City',
    dropoff: 'Gaisano Country Mall',
    dropoffSub: 'Gov. M. Cueno Ave Main Entrance',
    provider: 'Jun Joseph Pestaño',
    tracking: 'CXV34DA675FAS',
    price: '24.00',
  },
];

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
  /* Fetch user data + provider verification state                       */
  /* ------------------------------------------------------------------ */
  useFocusEffect(
    useCallback(() => {
      const fetchUserData = async () => {
        try {
          setImgKey(Date.now());

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          setUserEmail(user.email || 'john.doe@example.com');

          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, first_name, last_name, profile_photo')
            .eq('auth_id', user.id)
            .single();

          if (userError) {
            console.error('Error fetching user:', userError);
            return;
          }
          if (!userData) return;

          setUserId(userData.user_id);
          if (userData.first_name) setFirstName(userData.first_name);
          if (userData.last_name) setLastName(userData.last_name);

          if (userData.profile_photo) {
            setAvatarUrl(userData.profile_photo);
            setImageError(false);
          }

          // ---- Check role ----
          const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
              role_id,
              roles!inner (role_name)
            `)
            .eq('user_id', userData.user_id);

          if (rolesError) {
            console.error('Error fetching roles:', rolesError);
            return;
          }

          const hasProviderRole = (userRoles || []).some(
            (ur: any) => ur.roles?.role_name === 'Provider'
          );

          if (!hasProviderRole) {
            setUserRole('Sender');
            setProviderState('none');
            return;
          }

          // ---- Has Provider role → check verification status ----
          setUserRole('Provider');

          const { data: verif, error: verifError } = await supabase
            .from('provider_verifications')
            .select('verification_status, submitted_at')
            .eq('provider_id', userData.user_id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (verifError) {
            console.error('Error fetching verification:', verifError);
            // fallback: treat as pending if we can't tell
            setProviderState('pending');
            return;
          }

          if (!verif) {
            // Has role but no verification row → treat as pending (incomplete)
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
    }, [])
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

  /* ------------------------------------------------------------------ */
  /* Provider-switch handler — THE KEY LOGIC                             */
  /* ------------------------------------------------------------------ */
  const handleSwitchToProvider = () => {
    if (providerState === 'approved') {
      // ✅ Verified — enter provider mode
      navigation.navigate('ProviderTabs', { screen: 'Jobs' });
      return;
    }

    if (providerState === 'pending') {
      // ⏳ Awaiting admin approval — block, inform
      Alert.alert(
        'Awaiting Approval',
        'Your provider application is pending admin review. You will be able to switch to Provider Mode once it has been approved.',
        [{ text: 'OK' }]
      );
      return;
    }

    if (providerState === 'rejected') {
      // ❌ Rejected — offer re-apply
      Alert.alert(
        'Application Rejected',
        'Your previous provider application was rejected by an admin. You can submit a new application with updated documents.',
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

    // providerState === 'none' → not registered yet
    navigation.navigate('RegisterProvider');
  };

  const handlePaymentMethodsPress = () => {
    navigation.navigate('PaymentMethods');
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Derived UI values                                                   */
  /* ------------------------------------------------------------------ */
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
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

        <View style={[styles.historyHeader, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity
            onPress={() => setShowHistory(false)}
            style={styles.backBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.historyHeaderTitle}>View History</Text>
          <View style={{ width: 40 }} />
        </View>

        <Animated.ScrollView
          style={styles.historyContent}
          contentContainerStyle={styles.historyScroll}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ opacity: historyAnim }}>
            <Text style={styles.historyTitle}>History</Text>
            <View style={styles.historyHeaderRow}>
              <Text style={styles.historySubtitle}>Recent</Text>
              <TouchableOpacity>
                <Text style={styles.viewAllText}>View All</Text>
              </TouchableOpacity>
            </View>

            {MOCK_HISTORY.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.hCardAccent} />
                <Text style={styles.hCardType}>{item.type}</Text>
                <Text style={styles.hCardDate}>{item.date}   {item.time}</Text>

                <View style={styles.hCardBody}>
                  <View style={styles.hCardTimeline}>
                    <View style={styles.hTimelinePoint}>
                      <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
                      <View style={styles.hAddressWrapper}>
                        <Text style={styles.hAddressMain}>{item.pickup}</Text>
                        <Text style={styles.hAddressSub} numberOfLines={2}>{item.pickupSub}</Text>
                      </View>
                    </View>
                    <View style={styles.hTimelineLine} />
                    <View style={styles.hTimelinePoint}>
                      <Ionicons name="location" size={16} color="#E11D48" style={{ marginLeft: -1, marginRight: 6 }} />
                      <View style={styles.hAddressWrapper}>
                        <Text style={styles.hAddressMain}>{item.dropoff}</Text>
                        <Text style={styles.hAddressSub} numberOfLines={2}>{item.dropoffSub}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.hCardProvider}>
                    <View style={styles.hAvatar}>
                      <Ionicons name="person" size={22} color="#FFF" />
                    </View>
                    <Text style={styles.hProviderName} numberOfLines={2}>{item.provider}</Text>

                    <TouchableOpacity style={styles.hActionRow}>
                      <Text style={styles.hActionText}>Rate Provider</Text>
                      <Ionicons name="arrow-forward" size={12} color="#000" />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.hActionRow}>
                      <Text style={styles.hActionText}>Report</Text>
                      <Ionicons name="flag" size={12} color="#000" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.hCardDivider} />

                <View style={styles.hCardFooter}>
                  <View style={styles.hTrackingWrapper}>
                    <Ionicons name="barcode-outline" size={12} color="#6B7280" />
                    <Text style={styles.hTracking}>{item.tracking}</Text>
                  </View>
                  <Text style={styles.hPrice}>₱{item.price}</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        </Animated.ScrollView>
      </View>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Main Screen                                                         */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      <Animated.View
        style={[
          styles.mainHeader,
          { paddingTop: insets.top + 20 },
          fadeUp(headerAnim, 14),
        ]}
      >
        <Animated.View style={{ transform: [{ scale: avatarScale }] }}>
          <View style={styles.profilePicContainer}>
            {avatarUrl && !imageError ? (
              <Image
                key={`avatar-${imgKey}`}
                source={{ uri: avatarUrl, cache: 'reload' }}
                style={styles.profileImage}
                onError={(e) => {
                  console.warn('Image load error details:', e.nativeEvent.error);
                  setImageError(true);
                }}
              />
            ) : (
              <Ionicons name="person" size={36} color="#FFFFFF" />
            )}
          </View>
        </Animated.View>

        <View style={styles.nameContainer}>
          <View style={styles.nameTextWrapper}>
            <Text style={styles.profileName} numberOfLines={1}>{firstName} {lastName}</Text>
            <Text style={styles.profileEmail} numberOfLines={1}>{userEmail}</Text>
          </View>
          <TouchableOpacity
            style={styles.editIconBtn}
            onPress={() => navigation.navigate('EditProfile')}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil" size={15} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.mainContent}
        contentContainerStyle={styles.mainScrollContent}
      >
        <Animated.View style={fadeUp(contentAnim, 20)}>
          {/* Role Badge */}
          <View style={styles.roleBadgeRow}>
            <View
              style={[
                styles.roleBadge,
                providerState === 'approved'
                  ? styles.roleBadgeProvider
                  : providerState === 'pending'
                  ? styles.roleBadgePending
                  : providerState === 'rejected'
                  ? styles.roleBadgeRejected
                  : styles.roleBadgeSender,
              ]}
            >
              <Ionicons
                name={
                  providerState === 'approved'
                    ? 'shield-checkmark'
                    : providerState === 'pending'
                    ? 'time-outline'
                    : providerState === 'rejected'
                    ? 'close-circle-outline'
                    : 'cube-outline'
                }
                size={12}
                color={
                  providerState === 'approved'
                    ? '#10B981'
                    : providerState === 'pending'
                    ? '#F59E0B'
                    : providerState === 'rejected'
                    ? '#EF4444'
                    : ORANGE
                }
              />
              <Text
                style={[
                  styles.roleBadgeText,
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

          <Text style={styles.sectionTitle}>My Account</Text>

          {/* Menu Card */}
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSwitchToProvider}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FFF7ED' }]}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={ORANGE} />
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
                <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
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
                  <Ionicons name="card-outline" size={18} color="#3B82F6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Manage cards & wallets</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => setShowHistory(true)}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="time-outline" size={18} color="#10B981" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>View History</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Past deliveries & receipts</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>General</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleSettingsPress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F3F4F6' }]}>
                  <Ionicons name="settings-outline" size={18} color="#6B7280" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Settings</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>App preferences & notifications</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={handleLogoutConfirm}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FEF2F2' }]}>
                  <Ionicons name="log-out-outline" size={18} color="#EF4444" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.logoutText}>Log out</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Sign out of your account</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FCA5A5" />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  /* ------------------------------------------------------------------ */
  /* Main Header                                                         */
  /* ------------------------------------------------------------------ */
  mainHeader: {
    backgroundColor: ORANGE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 80,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  profilePicContainer: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nameTextWrapper: {
    flex: 1,
    marginRight: 8,
  },
  profileName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  profileEmail: {
    fontSize: 12,
    color: '#FFE0C7',
    fontWeight: '500',
    marginTop: 3,
  },
  editIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },

  /* ------------------------------------------------------------------ */
  /* Main Content                                                        */
  /* ------------------------------------------------------------------ */
  mainContent: {
    flex: 1,
    marginTop: -50,
  },
  mainScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 120,
  },

  roleBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 30,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
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
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    letterSpacing: -0.3,
  },

  /* ------------------------------------------------------------------ */
  /* Menu Card                                                           */
  /* ------------------------------------------------------------------ */
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  menuIconWrapper: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextWrapper: {
    flex: 1,
  },
  menuText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  menuSubtext: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 68,
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#EF4444',
  },
  versionText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 28,
    letterSpacing: 0.5,
  },

  /* ------------------------------------------------------------------ */
  /* History Screen                                                      */
  /* ------------------------------------------------------------------ */
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 20,
    backgroundColor: ORANGE,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  historyHeaderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  historyContent: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  historyScroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  historyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#000',
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  historySubtitle: { fontSize: 15, color: '#374151', fontWeight: '600' },
  viewAllText: { fontSize: 12, color: ORANGE, fontWeight: '700' },

  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    paddingLeft: 20,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
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
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  hCardType: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 4,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  hCardDate: {
    fontSize: 15,
    fontWeight: '800',
    color: '#000',
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  hCardBody: { flexDirection: 'row', justifyContent: 'space-between' },
  hCardTimeline: { flex: 1, paddingRight: 10 },
  hTimelinePoint: { flexDirection: 'row', alignItems: 'flex-start' },
  blueDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: '#0000CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginTop: 2,
  },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  hTimelineLine: { width: 1, height: 20, backgroundColor: '#D1D5DB', marginLeft: 6, marginVertical: 2 },
  hAddressWrapper: { flex: 1 },
  hAddressMain: { fontSize: 14, fontWeight: '700', color: '#000', marginBottom: 2 },
  hAddressSub: { fontSize: 9, color: '#6B7280', lineHeight: 12 },
  hCardProvider: { width: 100, alignItems: 'center' },
  hAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 2,
    borderColor: '#FFFBEB',
  },
  hProviderName: {
    fontSize: 10,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 8,
  },
  hActionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  hActionText: { fontSize: 9, color: '#000', marginRight: 4, fontWeight: '600' },
  hCardDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  hCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hTrackingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hTracking: { fontSize: 11, color: '#6B7280', fontWeight: '600', letterSpacing: 0.3 },
  hPrice: { fontSize: 16, fontWeight: '800', color: '#111827' },
});