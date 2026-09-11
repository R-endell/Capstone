// src/modules/Dashboard/Provider/AccountScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  StatusBar,
  Alert,
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

/** Brand */
const ORANGE = '#FA7A25';

export default function ProviderAccountScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [userEmail, setUserEmail] = useState<string>('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

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

  /* ------------------------------------------------------------------ */
  /* Fetch user data                                                     */
  /* ------------------------------------------------------------------ */
  useFocusEffect(
    useCallback(() => {
      const fetchUserData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserEmail(user.email || '');
          if (user.user_metadata?.first_name) {
            setFirstName(user.user_metadata.first_name);
          }
          if (user.user_metadata?.last_name) {
            setLastName(user.user_metadata.last_name);
          }
          if (user.user_metadata?.avatar_url) {
            setAvatarUrl(user.user_metadata.avatar_url);
            setImageError(false);
          }
        }
      };
      fetchUserData();
    }, [])
  );

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const handleSwitchToSender = () => {
    navigation.navigate('MainTabs');
  };

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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
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
                source={{ uri: avatarUrl }}
                style={styles.profileImage}
                onError={() => setImageError(true)}
              />
            ) : (
              <Ionicons name="person" size={36} color="#FFFFFF" />
            )}
          </View>
        </Animated.View>

        <View style={styles.nameContainer}>
          <View style={styles.nameTextWrapper}>
            <View style={styles.nameRow}>
              <Text style={styles.profileName} numberOfLines={1}>
                {firstName} {lastName}
              </Text>
              <TouchableOpacity
                style={styles.editIconBtn}
                onPress={() => navigation.navigate('EditProfile')}
                activeOpacity={0.8}
              >
                <Ionicons name="pencil" size={14} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <View style={styles.verifiedRow}>
              <Ionicons name="shield-checkmark" size={12} color="#FFFFFF" />
              <Text style={styles.verifiedText}>Verified Provider</Text>
            </View>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={12} color="#FACC15" />
              <Text style={styles.ratingScore}>4.9</Text>
              <Text style={styles.ratingCount}>· 128 deliveries</Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.mainContent}
        contentContainerStyle={styles.mainScrollContent}
      >
        <Animated.View style={fadeUp(contentAnim, 20)}>
          {/* Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconBox, { backgroundColor: '#FFF7ED' }]}>
                <Ionicons name="wallet-outline" size={18} color={ORANGE} />
              </View>
              <Text style={styles.statValue}>₱0</Text>
              <Text style={styles.statLabel}>Earnings</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconBox, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="checkmark-done-outline" size={18} color="#10B981" />
              </View>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconBox, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="flash-outline" size={18} color="#3B82F6" />
              </View>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>My Account</Text>

          {/* Menu Card */}
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToSender} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FFF7ED' }]}>
                  <Ionicons name="swap-horizontal-outline" size={18} color={ORANGE} />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Switch to Sender Mode</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Send packages instead of delivering
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={18} color="#3B82F6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Payment Methods</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Manage payout accounts
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('ManageVehicle')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="car-sport-outline" size={18} color="#10B981" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Manage Vehicle</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Add or update your vehicles
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('ManageRoutes')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F5F3FF' }]}>
                  <Ionicons name="map-outline" size={18} color="#8B5CF6" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Manage Travel Routes</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    View and edit your routes
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>General</Text>

          {/* General Menu */}
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.7}
            >
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#F3F4F6' }]}>
                  <Ionicons name="settings-outline" size={18} color="#6B7280" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.menuText}>Settings</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    App preferences & notifications
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleLogoutConfirm} activeOpacity={0.7}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.menuIconWrapper, { backgroundColor: '#FEF2F2' }]}>
                  <Ionicons name="log-out-outline" size={18} color="#EF4444" />
                </View>
                <View style={styles.menuTextWrapper}>
                  <Text style={styles.logoutText}>Log out</Text>
                  <Text style={styles.menuSubtext} numberOfLines={1}>
                    Sign out of your account
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#FCA5A5" />
            </TouchableOpacity>
          </View>

          <Text style={styles.versionText}>Pack-N-Ship Provider · v1.0.0</Text>
        </Animated.View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
  mainHeader: {
    backgroundColor: ORANGE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 78,
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
  },
  nameTextWrapper: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  profileName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
    flex: 1,
  },
  editIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    marginLeft: 8,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingScore: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  ratingCount: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Main Content                                                        */
  /* ------------------------------------------------------------------ */
  mainContent: {
    flex: 1,
    marginTop: -52,
  },
  mainScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 100,
  },

  /* ------------------------------------------------------------------ */
  /* Stats                                                               */
  /* ------------------------------------------------------------------ */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  statLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    marginTop: 2,
    letterSpacing: 0.2,
  },

  /* ------------------------------------------------------------------ */
  /* Section                                                             */
  /* ------------------------------------------------------------------ */
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
});