// src/modules/Dashboard/Sender/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  Alert, StatusBar, Animated, Easing, BackHandler, Switch, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import { setLastMode, clearLastMode } from '../../../utils/resolveHomeRoute';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const ORANGE = '#FF751F';

type ProviderState = 'none' | 'pending' | 'approved' | 'rejected';

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isDark, colors, toggleDark } = useTheme();
  const styles = makeStyles(colors, isDark);

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [userEmail, setUserEmail] = useState<string>('john.doe@example.com');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [providerState, setProviderState] = useState<ProviderState>('none');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [rejectionModalVisible, setRejectionModalVisible] = useState<boolean>(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [imgKey, setImgKey] = useState<number>(Date.now());

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;
  const avatarPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(contentAnim, 180),
    ]).start();

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

  const checkAndShowRejectionAutoModal = useCallback(
    async (uid: number, verifId: number | null, reasonText: string | null) => {
      try {
        const seenKey = `provider_rejection_seen_${uid}_${verifId || 'latest'}_${reasonText || ''}`;
        const alreadySeen = await AsyncStorage.getItem(seenKey);
        if (!alreadySeen) {
          await AsyncStorage.setItem(seenKey, 'true');
          setRejectionModalVisible(true);
        }
      } catch {
        setRejectionModalVisible(true);
      }
    },
    []
  );

  const fetchUserData = useCallback(async () => {
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

      if (!user.user_metadata?.first_name && userData.first_name) setFirstName(userData.first_name);
      if (!user.user_metadata?.last_name && userData.last_name) setLastName(userData.last_name);
      if (!user.user_metadata?.avatar_url && userData.profile_photo) {
        setAvatarUrl(userData.profile_photo);
        setImageError(false);
      }

      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select(`role_id, roles!inner (role_name)`)
        .eq('user_id', userData.user_id);

      if (rolesError) return;

      const hasProviderRole = (userRoles || []).some(
        (ur: any) => ur.roles?.role_name === 'Provider'
      );

      // Also check provider_verifications directly in case they applied
      const { data: verif, error: verifError } = await supabase
        .from('provider_verifications')
        .select('verification_id, verification_status, rejection_reason, submitted_at')
        .eq('provider_id', userData.user_id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!hasProviderRole && !verif) {
        setProviderState('none');
        setRejectionReason(null);
        return;
      }

      if (verifError || !verif) {
        setProviderState('pending');
        setRejectionReason(null);
        return;
      }

      const status = (verif.verification_status || '').toLowerCase();
      if (status === 'approved' || status === 'verified') {
        setProviderState('approved');
        setRejectionReason(null);
      } else if (status === 'rejected') {
        const reason = verif.rejection_reason?.trim() || null;
        setProviderState('rejected');
        setRejectionReason(reason);
        await checkAndShowRejectionAutoModal(
          userData.user_id,
          verif.verification_id ?? null,
          reason
        );
      } else {
        setProviderState('pending');
        setRejectionReason(null);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  }, [checkAndShowRejectionAutoModal]);

  useFocusEffect(
    useCallback(() => {
      fetchUserData();
    }, [fetchUserData])
  );

  // Realtime subscription so if the admin rejects/approves while the user is on AccountScreen, it updates immediately
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`account-provider-verif-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'provider_verifications',
          filter: `provider_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated) return;
          const status = String(updated.verification_status || '').toLowerCase();
          if (status === 'rejected') {
            const reason = updated.rejection_reason?.trim() || null;
            setProviderState('rejected');
            setRejectionReason(reason);
            setRejectionModalVisible(true);
          } else if (status === 'approved' || status === 'verified') {
            setProviderState('approved');
            setRejectionReason(null);
            setRejectionModalVisible(false);
          } else if (status === 'pending') {
            setProviderState('pending');
            setRejectionReason(null);
            setRejectionModalVisible(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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
            await clearLastMode();
            await supabase.auth.signOut();
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleReapplyProvider = () => {
    setRejectionModalVisible(false);
    navigation.navigate('RegisterProvider');
  };

  const handleSwitchToProvider = async () => {
    if (providerState === 'approved') {
      await setLastMode('provider');
      navigation.reset({
        index: 0,
        routes: [{ name: 'ProviderTabs', params: { screen: 'Jobs' } }],
      } as any);
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
      setRejectionModalVisible(true);
      return;
    }

    navigation.navigate('RegisterProvider');
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const avatarScale = avatarPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

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
      case 'rejected':
        return rejectionReason
          ? `Reason: ${rejectionReason}`
          : 'Tap to view rejection reason & register again';
      default:         return 'Earn by delivering packages';
    }
  })();

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle={colors.statusBarStyle}
        backgroundColor="transparent"
        translucent
      />

      <Animated.View
        style={[styles.fixedTopContainer, { paddingTop: Math.max(insets.top, 16) + 14 }, fadeUp(headerAnim, 14)]}
      >
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
                <Text style={styles.profileName} numberOfLines={1}>
                  {firstName} {lastName}
                </Text>
                <View style={[
                  styles.roleBadgeInline,
                  providerState === 'approved' ? styles.roleBadgeProvider
                    : providerState === 'pending' ? styles.roleBadgePending
                    : providerState === 'rejected' ? styles.roleBadgeRejected
                    : styles.roleBadgeSender,
                ]}>
                  <Text style={[styles.roleBadgeTextInline, {
                    color:
                      providerState === 'approved' ? colors.success
                      : providerState === 'pending' ? colors.warning
                      : providerState === 'rejected' ? colors.error
                      : ORANGE,
                  }]}>
                    {providerState === 'approved' ? 'PROVIDER'
                      : providerState === 'pending' ? 'PENDING'
                      : providerState === 'rejected' ? 'REJECTED'
                      : 'SENDER'}
                  </Text>
                </View>
              </View>
              <Text style={styles.profileEmail} numberOfLines={1}>{userEmail}</Text>
            </View>

            <TouchableOpacity
              style={styles.editIconBtn}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.8}
            >
              <Ionicons name="pencil" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.mainContent}
        contentContainerStyle={styles.mainScrollContent}
      >
        <Animated.View style={[styles.bodyContentWrapper, fadeUp(contentAnim, 20)]}>

          {/* Prominent Rejection Banner on Account Screen if rejected */}
          {providerState === 'rejected' && (
            <TouchableOpacity
              style={styles.rejectionAlertBanner}
              onPress={() => setRejectionModalVisible(true)}
              activeOpacity={0.85}
            >
              <View style={styles.rejectionBannerIconWrap}>
                <Ionicons name="alert-circle" size={22} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rejectionBannerTitle}>Provider Application Rejected</Text>
                <Text style={styles.rejectionBannerSubtext} numberOfLines={2}>
                  {rejectionReason
                    ? `Reason: ${rejectionReason}`
                    : 'Your application was not approved. Tap to review and register again.'}
                </Text>
              </View>
              <View style={styles.rejectionBannerActionPill}>
                <Text style={styles.rejectionBannerActionText}>Re-apply</Text>
              </View>
            </TouchableOpacity>
          )}

          <Text style={styles.sectionTitle}>Account & Services</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToProvider} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="swap-horizontal-outline" size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>{providerMenuTitle}</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>{providerMenuSubtext}</Text>
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
                  <Ionicons name="time-outline" size={10} color={colors.warning} />
                  <Text style={styles.pendingBadgeText}>Pending</Text>
                </View>
              )}
              {providerState === 'rejected' && (
                <View style={styles.rejectedBadge}>
                  <Ionicons name="close-circle-outline" size={10} color={colors.error} />
                  <Text style={styles.rejectedBadgeText}>Rejected</Text>
                </View>
              )}
              {providerState === 'none' && (
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              )}
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('PaymentMethods')} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#16243B' : '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={19} color="#3B82F6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Manage cards & wallets</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('DisputeCenter' as any)} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#2A1F0A' : '#FEF3C7' }]}>
                  <Ionicons name="shield-checkmark-outline" size={19} color="#D97706" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Dispute Center</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Report a problem with a delivery</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => (navigation as any).navigate('Support', { role: 'sender' })} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="headset-outline" size={19} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Customer Service</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Report a problem, track cases, contact support</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Preferences & System</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
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
                  <Ionicons
                    name={isDark ? 'moon' : 'moon-outline'}
                    size={19}
                    color={ORANGE}
                  />
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

          <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
        </Animated.View>
      </ScrollView>

      {/* ================================================================ */}
      {/* PROVIDER REJECTION MODAL                                         */}
      {/* ================================================================ */}
      <Modal
        visible={rejectionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectionModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconCircle}>
              <Ionicons name="close-circle" size={38} color={colors.error} />
            </View>

            <Text style={styles.modalTitle}>Application Rejected</Text>
            <Text style={styles.modalDescription}>
              Your provider verification request was not approved by the administrator.
            </Text>

            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>REASON FOR REJECTION</Text>
              <Text style={styles.reasonValue}>
                {rejectionReason || 'No specific reason was provided. Please review your submitted license and vehicle documents.'}
              </Text>
            </View>

            <Text style={styles.modalHint}>
              You can submit a new provider application at any time with updated documents and clear photos.
            </Text>

            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalSecondaryBtn}
                onPress={() => setRejectionModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSecondaryBtnText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={handleReapplyProvider}
                activeOpacity={0.85}
              >
                <Ionicons name="refresh-outline" size={17} color="#FFFFFF" />
                <Text style={styles.modalPrimaryBtnText}>Register Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles — generated from the current theme                           */
/* ------------------------------------------------------------------ */
const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  fixedTopContainer: {
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTopBar: { marginBottom: 14 },
  headerTitle: {
    fontSize: 30, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.5,
  },
  profileContainerCard: {
    backgroundColor: c.card,
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.25,
    shadowRadius: 8,
    elevation: 2,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  profilePicContainer: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12, overflow: 'hidden',
    borderWidth: 1.5, borderColor: c.border,
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: { flex: 1, marginRight: 8, justifyContent: 'center' },
  nameAndBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  profileName: { fontSize: 16, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  profileEmail: { fontSize: 12, color: c.textSecondary, fontWeight: '500', marginTop: 2 },
  editIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },

  roleBadgeInline: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  roleBadgeProvider: { backgroundColor: c.successBg, borderColor: c.success },
  roleBadgeSender:   { backgroundColor: c.accentSoft, borderColor: c.accent },
  roleBadgePending:  { backgroundColor: c.warningBg, borderColor: c.warning },
  roleBadgeRejected: { backgroundColor: c.errorBg, borderColor: c.error },
  roleBadgeTextInline: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  mainContent: { flex: 1 },
  mainScrollContent: { paddingBottom: 40 },
  bodyContentWrapper: { paddingHorizontal: 20, paddingTop: 8 },

  rejectionAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    borderRadius: 18,
    padding: 14,
    marginBottom: 18,
    gap: 12,
  },
  rejectionBannerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: isDark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rejectionBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: c.error,
  },
  rejectionBannerSubtext: {
    fontSize: 12,
    fontWeight: '500',
    color: c.textSecondary,
    marginTop: 2,
  },
  rejectionBannerActionPill: {
    backgroundColor: c.error,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  rejectionBannerActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: c.textPrimary,
    marginBottom: 12, letterSpacing: -0.3,
  },

  menuCard: {
    backgroundColor: c.card,
    borderRadius: 20,
    paddingHorizontal: 6, paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.25,
    shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: c.border,
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

  providerBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, gap: 4, borderWidth: 1, borderColor: c.success,
  },
  providerBadgeDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.success },
  providerBadgeText: { color: c.success, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  pendingBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.warningBg, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, gap: 4, borderWidth: 1, borderColor: c.warning,
  },
  pendingBadgeText: { color: c.warning, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  rejectedBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.errorBg, paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 10, gap: 4, borderWidth: 1, borderColor: c.error,
  },
  rejectedBadgeText: { color: c.error, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  logoutText: { fontSize: 15, fontWeight: '700', color: c.error },
  versionText: {
    textAlign: 'center', color: c.textMuted, fontSize: 11,
    fontWeight: '600', marginTop: 24, marginBottom: 20, letterSpacing: 0.5,
  },

  /* Rejection Modal Styles */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: c.card,
    borderRadius: 26,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 10,
  },
  modalIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: c.errorBg,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.error,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalDescription: {
    fontSize: 13,
    fontWeight: '500',
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  reasonBox: {
    width: '100%',
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  reasonLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: c.error,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  reasonValue: {
    fontSize: 14,
    fontWeight: '700',
    color: c.textPrimary,
    lineHeight: 20,
  },
  modalHint: {
    fontSize: 12,
    fontWeight: '500',
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 22,
  },
  modalActionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  modalSecondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSecondaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: c.textSecondary,
  },
  modalPrimaryBtn: {
    flex: 1.4,
    height: 48,
    borderRadius: 14,
    backgroundColor: ORANGE,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  modalPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});