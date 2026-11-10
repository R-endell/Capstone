// src/modules/Dashboard/Sender/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  Alert, StatusBar, Animated, Easing, BackHandler, Switch, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import { setLastMode, clearLastMode } from '../../../utils/resolveHomeRoute';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

type ProviderState = 'none' | 'pending' | 'approved' | 'rejected';

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isDark, colors, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

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
      Animated.timing(value, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });

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
        await checkAndShowRejectionAutoModal(userData.user_id, verif.verification_id ?? null, reason);
      } else {
        setProviderState('pending');
        setRejectionReason(null);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    }
  }, [checkAndShowRejectionAutoModal]);

  useFocusEffect(useCallback(() => { fetchUserData(); }, [fetchUserData]));

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`account-provider-verif-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_verifications', filter: `provider_id=eq.${userId}` },
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
    return () => { supabase.removeChannel(channel); };
  }, [userId]);

  const handleLogoutConfirm = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
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
    ], { cancelable: true });
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
      (navigation as any).navigate('ProviderApplicationStatus');
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
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
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
      case 'pending':  return 'Tap to track your application';
      case 'rejected':
        return rejectionReason ? `Reason: ${rejectionReason}` : 'Tap to view rejection reason & register again';
      default:         return 'Earn by delivering packages';
    }
  })();

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
                  <SolarIcon name="User" variant="boldDuotone" size={28} color={colors.accent} />
                )}
              </View>
            </Animated.View>

            <View style={styles.nameContainer}>
              <View style={styles.nameAndBadgeRow}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {firstName} {lastName}
                </Text>
                <View style={styles.roleBadgeSender}>
                  <Text style={[styles.roleBadgeTextInline, { color: colors.accent }]}>SENDER</Text>
                </View>
                {providerState === 'approved' && (
                  <View style={styles.roleBadgeProvider}>
                    <Text style={[styles.roleBadgeTextInline, { color: colors.success }]}>PROVIDER</Text>
                  </View>
                )}
              </View>
              <Text style={styles.profileEmail} numberOfLines={1}>{userEmail}</Text>
            </View>

            <TouchableOpacity style={styles.editIconBtn} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.8}>
              <SolarIcon name="Pen" variant="linear" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.mainContent} contentContainerStyle={styles.mainScrollContent}>
        <Animated.View style={[styles.bodyContentWrapper, fadeUp(contentAnim, 20)]}>

          {providerState === 'rejected' && (
            <TouchableOpacity style={styles.rejectionAlertBanner} onPress={() => setRejectionModalVisible(true)} activeOpacity={0.85}>
              <View style={styles.rejectionBannerIconWrap}>
                <SolarIcon name="DangerCircle" variant="boldDuotone" size={22} />
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
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="TransferHorizontal" size={24} />
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
                  <SolarIcon name="Clock" variant="bold" size={10} color={colors.warning} />
                  <Text style={styles.pendingBadgeText}>Pending</Text>
                </View>
              )}
              {providerState === 'rejected' && (
                <View style={styles.rejectedBadge}>
                  <SolarIcon name="CloseCircle" variant="bold" size={10} color={colors.error} />
                  <Text style={styles.rejectedBadgeText}>Rejected</Text>
                </View>
              )}
              {providerState === 'none' && (
                <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
              )}
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('PaymentMethods')} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="Card" size={24} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Manage cards & wallets</Text>
                </View>
              </View>
              <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={() => (navigation as any).navigate('Support', { role: 'sender' })} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="HeadphonesRound" size={24} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Customer Service</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Report a problem, track cases, contact support</Text>
                </View>
              </View>
              <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Preferences & System</Text>

          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="Settings" size={24} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Settings</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>App preferences & notifications</Text>
                </View>
              </View>
              <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <View style={styles.menuItem}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="Moon" size={24} />
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
                trackColor={{ false: '#D1D5DB', true: colors.accent }}
                thumbColor="#FFFFFF"
                ios_backgroundColor="#D1D5DB"
              />
            </View>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleLogoutConfirm} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={styles.menuIconWrapper}>
                  <SolarIcon name="Logout" size={24} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.logoutText}>Log out</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>Sign out of your account</Text>
                </View>
              </View>
              <SolarIcon name="AltArrowRight" variant="linear" size={16} color={colors.error} />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
        </Animated.View>
      </ScrollView>

      <Modal visible={rejectionModalVisible} transparent animationType="fade" onRequestClose={() => setRejectionModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconCircle}>
              <SolarIcon name="CloseCircle" variant="boldDuotone" size={38} />
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
              <TouchableOpacity style={styles.modalSecondaryBtn} onPress={() => setRejectionModalVisible(false)} activeOpacity={0.8}>
                <Text style={styles.modalSecondaryBtnText}>Close</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalPrimaryBtn} onPress={handleReapplyProvider} activeOpacity={0.85}>
                <SolarIcon name="Refresh" variant="bold" size={17} color="#FFFFFF" />
                <Text style={styles.modalPrimaryBtnText}>Register Again</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  fixedTopContainer: { backgroundColor: 'transparent', paddingHorizontal: 20, paddingBottom: 12 },
  headerTopBar: { marginBottom: 16 },

  headerTitle: { fontSize: 28, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.4 },

  profileContainerCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 18,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 1,
    elevation: 0,
  },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  profilePicContainer: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 14, overflow: 'hidden',
    borderWidth: 1.5, borderColor: c.accent,
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: { flex: 1, marginRight: 8, justifyContent: 'center' },
  nameAndBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },

  profileName: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  profileEmail: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  editIconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },

  roleBadgeProvider: { backgroundColor: c.successBg, borderColor: c.success, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  roleBadgeSender:   { backgroundColor: c.accentSoft, borderColor: c.accent, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  roleBadgeTextInline: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 1 },

  mainContent: { flex: 1 },
  mainScrollContent: { paddingBottom: 40 },
  bodyContentWrapper: { paddingHorizontal: 20, paddingTop: 8 },

  rejectionAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    gap: 12,
  },
  rejectionBannerIconWrap: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: isDark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
    justifyContent: 'center', alignItems: 'center',
  },
  rejectionBannerTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.error },
  rejectionBannerSubtext: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 3, lineHeight: 16 },
  rejectionBannerActionPill: { backgroundColor: c.error, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10 },
  rejectionBannerActionText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_700Bold' },

  sectionTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 16, letterSpacing: -0.2 },

  menuCard: {
    backgroundColor: c.card,
    borderRadius: 12,
    paddingHorizontal: 6, paddingVertical: 6,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 1,
    elevation: 0,
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 18,
    paddingHorizontal: 10, borderRadius: 12,
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },

  menuIconWrapper: {
    width: 32, height: 42,
    justifyContent: 'center', alignItems: 'flex-start',
    marginRight: 14,
  },

  menuTextWrapper: { flex: 1 },

  menuText: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: 0 },
  menuSubtext: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },

  menuDivider: {
    height: 1,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
    marginLeft: 56, marginRight: 10
  },

  providerBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.successBg, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, gap: 6, borderWidth: 1, borderColor: c.success,
  },
  providerBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.success },
  providerBadgeText: { color: c.success, fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.5 },

  pendingBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.warningBg, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, gap: 6, borderWidth: 1, borderColor: c.warning,
  },
  pendingBadgeText: { color: c.warning, fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.5 },

  rejectedBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.errorBg, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 10, gap: 6, borderWidth: 1, borderColor: c.error,
  },
  rejectedBadgeText: { color: c.error, fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.5 },

  logoutText: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.error, letterSpacing: 0 },
  versionText: {
    textAlign: 'center', color: c.textMuted, fontSize: 11,
    fontFamily: 'Poppins_500Medium', marginTop: 24, marginBottom: 20, letterSpacing: 0.5,
  },

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
    borderRadius: 16,
    padding: 26,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  modalIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: c.errorBg,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 18,
    borderWidth: 1.5, borderColor: c.error,
  },
  modalTitle: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  modalDescription: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  reasonBox: {
    width: '100%',
    backgroundColor: c.errorBg,
    borderWidth: 1,
    borderColor: c.error,
    borderRadius: 12,
    padding: 16,
    marginBottom: 18,
  },
  reasonLabel: {
    fontSize: 10,
    fontFamily: 'Poppins_800ExtraBold',
    color: c.error,
    letterSpacing: 1,
    marginBottom: 8,
  },
  reasonValue: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: c.textPrimary,
    lineHeight: 20,
  },
  modalHint: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: c.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 24,
  },
  modalActionsRow: { flexDirection: 'row', width: '100%', gap: 12 },
  modalSecondaryBtn: {
    flex: 1, height: 50, borderRadius: 12,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
  },
  modalSecondaryBtnText: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  modalPrimaryBtn: {
    flex: 1.6, height: 50, borderRadius: 12,
    backgroundColor: c.accent,
    flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center',
    gap: 8,
    shadowColor: c.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalPrimaryBtnText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },
});