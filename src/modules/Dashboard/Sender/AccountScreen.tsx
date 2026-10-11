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
  BackHandler,
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

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const avatarPulse = useRef(new Animated.Value(0)).current;

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

  // Back button: return to the first tab (exit only from the first tab)
  useFocusEffect(
    useCallback(() => {
      const onBack = () => {
        let nav: any = navigation;
        while (nav) {
          const st = nav.getState?.();
          if (st?.type === 'tab') {
            const current = st.routes?.[st.index]?.name;
            const first = st.routeNames?.[0];
            if (first && first !== current) {
              nav.navigate(first);
              return true;
            }
            return false;
          }
          nav = nav.getParent?.();
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [navigation])
  );

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

  const handleDisputePress = () => {
    navigation.navigate('DisputeCenter' as any);
  };

  const handlePaymentMethodsPress = () => {
    navigation.navigate('PaymentMethods');
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
                  <Ionicons name="person" size={28} color={ORANGE} />
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
              onPress={handleDisputePress}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="shield-checkmark-outline" size={19} color="#D97706" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Dispute Center</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Report a problem with a delivery
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
    paddingBottom: 12,
  },
  headerTopBar: {
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  profileContainerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePicContainer: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#FFE4D2',
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: {
    flex: 1,
    marginRight: 8,
    justifyContent: 'center',
  },
  nameAndBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  profileName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  profileEmail: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },
  editIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },

  roleBadgeInline: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
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
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  mainContent: { flex: 1 },
  mainScrollContent: {
    paddingBottom: 40,
  },
  bodyContentWrapper: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    letterSpacing: -0.3,
  },

  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
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
  menuTextWrapper: { flex: 1 },
  menuText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  menuSubtext: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginLeft: 66,
    marginRight: 10,
  },
  providerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  providerBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
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
    marginTop: 24,
    marginBottom: 20,
    letterSpacing: 0.5,
  },
});