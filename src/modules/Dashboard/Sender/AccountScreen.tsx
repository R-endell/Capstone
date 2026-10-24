// src/modules/Dashboard/Sender/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  Alert, StatusBar, Animated, Easing, BackHandler, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import { setLastMode, clearLastMode } from '../../../utils/resolveHomeRoute';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { brand, spacing } from '../../../constants';
import MenuItem from '../../../components/MenuItem';
import Card from '../../../components/Card';

const ORANGE = brand.orangeDark;

type ProviderState = 'none' | 'pending' | 'approved' | 'rejected';

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { isDark, colors, toggleDark } = useTheme();
  const styles = makeStyles(colors);

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [userEmail, setUserEmail] = useState<string>('john.doe@example.com');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [providerState, setProviderState] = useState<ProviderState>('none');
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

          if (!hasProviderRole) {
            setProviderState('none');
            return;
          }

          const { data: verif, error: verifError } = await supabase
            .from('provider_verifications')
            .select('verification_status, submitted_at')
            .eq('provider_id', userData.user_id)
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (verifError || !verif) { setProviderState('pending'); return; }

          const status = (verif.verification_status || '').toLowerCase();
          if (status === 'approved' || status === 'verified') setProviderState('approved');
          else if (status === 'rejected') setProviderState('rejected');
          else setProviderState('pending');
        } catch (error) {
          console.error('Error fetching user data:', error);
        }
      };
      fetchUserData();
    }, [])
  );

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

  const handleSwitchToProvider = async () => {
    // Only an APPROVED provider may be remembered as "provider mode". Saving it
    // before this check let pending/rejected/never-applied users get sent to the
    // Provider interface on the next app start.
    if (providerState === 'approved') {
      await setLastMode('provider');
      // reset (not navigate) so Back can't walk back into the other interface
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
      case 'rejected': return 'Tap to re-apply with new documents';
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
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
              accessibilityHint="Update your personal information"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
          <Text style={styles.sectionTitle}>Account & Services</Text>

          <Card padding="xs" style={{ paddingVertical: 0 }}>
            <MenuItem
              label={providerMenuTitle}
              subtext={providerMenuSubtext}
              onPress={handleSwitchToProvider}
              accessibilityLabel={providerMenuTitle}
              accessibilityHint={providerMenuSubtext}
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="swap-horizontal-outline" size={19} color={ORANGE} />
                </View>
              }
              badge={
                providerState === 'approved' ? (
                  <View style={styles.providerBadge}>
                    <View style={styles.providerBadgeDot} />
                    <Text style={styles.providerBadgeText}>Active</Text>
                  </View>
                ) : providerState === 'pending' ? (
                  <View style={styles.pendingBadge}>
                    <Ionicons name="time-outline" size={10} color={colors.warning} />
                    <Text style={styles.pendingBadgeText}>Pending</Text>
                  </View>
                ) : providerState === 'rejected' ? (
                  <View style={styles.rejectedBadge}>
                    <Ionicons name="close-circle-outline" size={10} color={colors.error} />
                    <Text style={styles.rejectedBadgeText}>Rejected</Text>
                  </View>
                ) : undefined
              }
              showChevron={providerState === 'none'}
            />

            <View style={styles.menuDivider} />

            <MenuItem
              label="Payment Methods"
              subtext="Manage cards & wallets"
              onPress={() => navigation.navigate('PaymentMethods')}
              accessibilityLabel="Payment Methods"
              accessibilityHint="Manage cards and wallets"
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#16243B' : '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={19} color="#3B82F6" />
                </View>
              }
            />

            <View style={styles.menuDivider} />

            <MenuItem
              label="Dispute Center"
              subtext="Report a problem with a delivery"
              onPress={() => navigation.navigate('DisputeCenter' as any)}
              accessibilityLabel="Dispute Center"
              accessibilityHint="Report a problem with a delivery"
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#2A1F0A' : '#FEF3C7' }]}>
                  <Ionicons name="shield-checkmark-outline" size={19} color="#D97706" />
                </View>
              }
            />

            <View style={styles.menuDivider} />

            <MenuItem
              label="Customer Service"
              subtext="Report a problem, track cases, contact support"
              onPress={() => (navigation as any).navigate('Support', { role: 'sender' })}
              accessibilityLabel="Customer Service"
              accessibilityHint="Report a problem, track cases, contact support"
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.accentSoft }]}>
                  <Ionicons name="headset-outline" size={19} color={ORANGE} />
                </View>
              }
            />
          </Card>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Preferences & System</Text>

          <View style={styles.menuCard}>
            <MenuItem
              label="Settings"
              subtext="App preferences & notifications"
              onPress={() => navigation.navigate('Settings')}
              accessibilityLabel="Settings"
              accessibilityHint="App preferences and notifications"
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#1F262E' : '#F3F4F6' }]}>
                  <Ionicons name="settings-outline" size={19} color={colors.textSecondary} />
                </View>
              }
            />

            <View style={styles.menuDivider} />

            {/* ≡ƒîÖ Dark Mode toggle ΓÇö placed directly below Settings */}
            <MenuItem
              label="Dark Mode"
              subtext={isDark ? 'Currently using dark theme' : 'Switch to dark theme'}
              accessibilityLabel="Dark Mode"
              accessibilityHint={isDark ? 'Turn off dark theme' : 'Turn on dark theme'}
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#241A0B' : '#FFF7ED' }]}>
                  <Ionicons
                    name={isDark ? 'moon' : 'moon-outline'}
                    size={19}
                    color={ORANGE}
                  />
                </View>
              }
              rightIcon={
                <Switch
                  value={isDark}
                  onValueChange={toggleDark}
                  trackColor={{ false: '#D1D5DB', true: ORANGE }}
                  thumbColor="#FFFFFF"
                  ios_backgroundColor="#D1D5DB"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: isDark }}
                />
              }
              showChevron={false}
            />

            <View style={styles.menuDivider} />

            <MenuItem
              label="Log out"
              subtext="Sign out of your account"
              onPress={handleLogoutConfirm}
              accessibilityLabel="Log out"
              accessibilityHint="Sign out of your account"
              leftIcon={
                <View style={[styles.menuIconWrapper, { backgroundColor: colors.errorBg }]}>
                  <Ionicons name="log-out-outline" size={19} color={colors.error} />
                </View>
              }
              chevronColor="#FCA5A5"
            />
          </View>

          <Text style={styles.versionText}>Pack-N-Ship ┬╖ v1.0.0</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Styles ΓÇö generated from the current theme                           */
/* ------------------------------------------------------------------ */
const makeStyles = (c: ThemeColors) => StyleSheet.create({
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
});