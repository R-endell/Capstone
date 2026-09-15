import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  StatusBar,
  Alert,
  Dimensions,
  ActivityIndicator,
  Animated,
  Easing,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';

import { supabase } from '../../../utils/supabase';

const { width } = Dimensions.get('window');

/** Brand */
const ORANGE = '#F27024';

// Mock providers – keep for now until we implement provider fetching
const MOCK_PROVIDERS = [
  {
    id: 'p1',
    name: 'Jun Joseph Pestaño',
    vehicle: 'Civic RS Turbo',
    rating: 4.8,
    deliveries: 12,
    initials: 'JP',
    color: '#F27024',
  },
  {
    id: 'p2',
    name: 'Maria Santos',
    vehicle: 'Toyota Vios',
    rating: 4.6,
    deliveries: 8,
    initials: 'MS',
    color: '#3B82F6',
  },
  {
    id: 'p3',
    name: 'FastTrack Logistics',
    vehicle: 'Van',
    rating: 4.9,
    deliveries: 25,
    initials: 'FL',
    color: '#10B981',
  },
  {
    id: 'p4',
    name: 'LBC Express',
    vehicle: 'Van',
    rating: 4.5,
    deliveries: 30,
    initials: 'LE',
    color: '#8B5CF6',
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [firstName, setFirstName] = useState('First');
  const [lastName, setLastName] = useState('Last');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [recentDeliveries, setRecentDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Entrance animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const actionsAnim = useRef(new Animated.Value(0)).current;
  const activityAnim = useRef(new Animated.Value(0)).current;
  const providersAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation (staggered)                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 650) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(bannerAnim, 120),
      animate(actionsAnim, 240),
      animate(activityAnim, 360),
      animate(providersAnim, 480),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bellPulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [headerAnim, bannerAnim, actionsAnim, activityAnim, providersAnim, bellPulse]);

  /* ------------------------------------------------------------------ */
  /* Data fetching                                                       */
  /* ------------------------------------------------------------------ */
  const fetchUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      if (user.user_metadata?.first_name) setFirstName(user.user_metadata.first_name);
      if (user.user_metadata?.last_name) setLastName(user.user_metadata.last_name);
      if (user.user_metadata?.avatar_url) setAvatarUrl(user.user_metadata.avatar_url);
    }
    return user;
  };

  const fetchRecentDeliveries = async (userId: string) => {
    try {
      const { data: userRecord } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', userId)
        .single();

      if (!userRecord) return;

      const { data, error } = await supabase
        .from('delivery_requests')
        .select(`
          request_id,
          pickup_type,
          delivery_status,
          scheduled_time,
          estimated_cost,
          created_at,
          pickup_location:locations!delivery_requests_pickup_location_id_fkey ( street_address ),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( street_address )
        `)
        .eq('sender_id', userRecord.user_id)
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;

      if (data && data.length > 0) {
        const mapped = data.map((item: any) => {
          const scheduleDate = item.scheduled_time ? new Date(item.scheduled_time) : new Date(item.created_at);
          const status = item.delivery_status;
          const isDelivered = status === 'Completed' || status === 'Delivered';
          const isTransit = status === 'In Transit' || status === 'Accepted';

          const parseAddr = (addr: any) => {
            if (!addr) return '';
            return addr.street_address || '';
          };
          const origin = parseAddr(item.pickup_location);
          const destination = parseAddr(item.dropoff_location);

          return {
            id: `PNS-${String(item.request_id).padStart(4, '0')}`,
            date: scheduleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            startTime: scheduleDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            endTime: isDelivered ? scheduleDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '--:--',
            status: status === 'Completed' ? 'Delivered' : status === 'Accepted' ? 'In Transit' : status,
            origin: origin || 'Pickup',
            destination: destination || 'Dropoff',
            progress: isDelivered ? 100 : isTransit ? 65 : 20,
            type: item.pickup_type || 'Standard',
            cost: item.estimated_cost || 0,
          };
        });
        setRecentDeliveries(mapped);
      } else {
        setRecentDeliveries([]);
      }
    } catch (error) {
      console.error('Error fetching recent deliveries:', error);
      setRecentDeliveries([]);
    } finally {
      setLoading(false);
    }
  };

  const loadData = async () => {
    const user = await fetchUser();
    if (user) {
      await fetchRecentDeliveries(user.id);
    } else {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const handleSendPackage = () => {
    navigation.navigate('DropoffType', { mode: 'sendNow' });
  };

  const handleScheduleDelivery = () => {
    navigation.navigate('DropoffType', { mode: 'schedule' });
  };

  const handleViewProfile = () => {
    navigation.navigate('Account');
  };

  const handleViewNotifications = () => {
    Alert.alert('Coming Soon', 'Notifications will be available in the next update.');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Delivered':
        return { bg: '#ECFDF5', text: '#10B981', icon: 'checkmark-circle' };
      case 'In Transit':
        return { bg: '#FEF3C7', text: '#D97706', icon: 'car-sport' };
      case 'Pending':
        return { bg: '#F3F4F6', text: '#6B7280', icon: 'time-outline' };
      default:
        return { bg: '#F3F4F6', text: '#6B7280', icon: 'time-outline' };
    }
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

  const bellScale = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const bellOpacity = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.85],
  });

  /* ------------------------------------------------------------------ */
  /* Render Activity Card                                                */
  /* ------------------------------------------------------------------ */
  const renderActivityCard = (item: any) => {
    const statusColors = getStatusColor(item.status);

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.activityCard}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('MainTabs', { screen: 'Activity' })}
      >
        {/* Left accent bar */}
        <View style={[styles.activityAccent, { backgroundColor: statusColors.text }]} />

        {/* Header */}
        <View style={styles.activityHeader}>
          <View style={styles.activityHeaderLeft}>
            <View style={[styles.activityIconContainer, { backgroundColor: statusColors.bg }]}>
              <Ionicons name="cube-outline" size={18} color={statusColors.text} />
            </View>
            <View>
              <Text style={styles.activityId}>{item.id}</Text>
              <Text style={styles.activityDate}>{item.date}</Text>
            </View>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
            <Ionicons name={statusColors.icon as any} size={12} color={statusColors.text} />
            <Text style={[styles.statusPillText, { color: statusColors.text }]}>
              {item.status}
            </Text>
          </View>
        </View>

        <View style={styles.activityBody}>
          <View style={styles.timelineColumn}>
            {/* Pickup */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDotSolid} />
                <View style={styles.timelineLineDashed} />
              </View>
              <View style={styles.timelineTextContainer}>
                <View style={styles.timelineLabelRow}>
                  <Ionicons name="arrow-up-circle" size={14} color="#3B82F6" />
                  <Text style={[styles.timelineLabel, { color: '#3B82F6' }]}>PICKUP</Text>
                </View>
                <Text style={styles.timelineTime}>{item.startTime}</Text>
                <Text style={styles.timelineLocation} numberOfLines={1}>{item.origin}</Text>
              </View>
            </View>

            {/* Dropoff */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDotHollow} />
              </View>
              <View style={styles.timelineTextContainer}>
                <View style={styles.timelineLabelRow}>
                  <Ionicons name="arrow-down-circle" size={14} color="#EF4444" />
                  <Text style={[styles.timelineLabel, { color: '#EF4444' }]}>DROPOFF</Text>
                </View>
                <Text style={styles.timelineTime}>{item.endTime}</Text>
                <Text style={styles.timelineLocation} numberOfLines={1}>{item.destination}</Text>
              </View>
            </View>
          </View>

          <View style={styles.packageColumn}>
            <Image
              source={require('../../../../assets/Pack-N-Ship-Packages.png')}
              style={styles.packageImage}
              resizeMode="contain"
            />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Render Provider Card                                                */
  /* ------------------------------------------------------------------ */
  const renderProviderCard = (provider: any) => {
    return (
      <TouchableOpacity
        key={provider.id}
        style={styles.providerCard}
        activeOpacity={0.85}
        onPress={() => Alert.alert('Book Provider', `Booking ${provider.name}`)}
      >
        <View style={styles.providerCardTop}>
          <View style={styles.providerAvatarWrapper}>
            <View style={[styles.providerAvatarLarge, { backgroundColor: provider.color + '15' }]}>
              <Text style={[styles.providerAvatarText, { color: provider.color }]}>
                {provider.initials}
              </Text>
            </View>
            <View style={styles.providerVerifiedBadge}>
              <Ionicons name="checkmark" size={10} color="#FFF" />
            </View>
          </View>
          <View style={styles.providerInfoWrapper}>
            <Text style={styles.providerNameLarge} numberOfLines={1}>{provider.name}</Text>
            <View style={styles.providerMetaRow}>
              <Ionicons name="car-outline" size={12} color="#6B7280" />
              <Text style={styles.providerVehicle} numberOfLines={1}>{provider.vehicle}</Text>
            </View>
          </View>
          <View style={styles.ratingWrapper}>
            <Ionicons name="star" size={12} color="#F59E0B" />
            <Text style={styles.ratingNumber}>{provider.rating}</Text>
          </View>
        </View>

        <View style={styles.providerStatsRow}>
          <View style={styles.providerStatItem}>
            <Text style={styles.providerStatValue}>{provider.deliveries}</Text>
            <Text style={styles.providerStatLabel}>Deliveries</Text>
          </View>
          <View style={styles.providerStatDivider} />
          <View style={styles.providerStatItem}>
            <Text style={styles.providerStatValue}>{provider.rating}</Text>
            <Text style={styles.providerStatLabel}>Rating</Text>
          </View>
          <View style={styles.providerStatDivider} />
          <View style={styles.providerStatItem}>
            <Ionicons name="shield-checkmark" size={16} color="#10B981" />
            <Text style={styles.providerStatLabel}>Verified</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.bookProviderBtn} activeOpacity={0.9}>
          <Text style={styles.bookProviderText}>Book Provider</Text>
          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View style={[styles.headerSection, fadeUp(headerAnim, 14)]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.profilePicContainer}
            onPress={handleViewProfile}
            activeOpacity={0.85}
          >
            {avatarUrl && !imageError ? (
              <Image
                source={{ uri: avatarUrl }}
                style={styles.profileImage}
                onError={() => setImageError(true)}
              />
            ) : (
              <Text style={styles.profileInitials}>
                {firstName.charAt(0)}{lastName.charAt(0)}
              </Text>
            )}
            <View style={styles.onlineDot} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerWelcome}>Welcome back,</Text>
            <Text style={styles.headerUsername}>{firstName} {lastName}</Text>
          </View>
        </View>
        <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }}>
          <TouchableOpacity style={styles.notificationIcon} onPress={handleViewNotifications}>
            <Ionicons name="notifications-outline" size={22} color="#FFF" />
            <View style={styles.notificationBadge} />
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={ORANGE}
            colors={[ORANGE]}
          />
        }
      >
        {/* Banner */}
        <Animated.View style={[styles.upperBanner, fadeUp(bannerAnim, 20)]}>
          <View style={styles.bannerTextContainer}>
            <View style={styles.bannerBadge}>
              <Ionicons name="flash" size={11} color={ORANGE} />
              <Text style={styles.bannerBadgeText}>EXPRESS DELIVERY</Text>
            </View>
            <Text style={styles.bannerTitle}>Ship Your Packages with Confidence</Text>
            <Text style={styles.bannerSubtitle}>Fast, secure, and hassle-free delivery.</Text>
          </View>
          <Image
            source={require('../../../../assets/Pack-N-Ship-Packages.png')}
            style={styles.bannerImage}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Action Cards */}
        <Animated.View style={[styles.actionContainer, fadeUp(actionsAnim, 20)]}>
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardPrimary]}
            onPress={handleSendPackage}
            activeOpacity={0.9}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: ORANGE }]}>
              <Ionicons name="cube-outline" size={26} color="#FFFFFF" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
              <Text style={styles.actionSubtitlePrimary}>Instant booking & tracking</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color={ORANGE} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardSecondary]}
            onPress={handleScheduleDelivery}
            activeOpacity={0.9}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: '#FFFFFF' }]}>
              <Ionicons name="calendar-outline" size={26} color="#111827" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Schedule a Delivery</Text>
              <Text style={styles.actionSubtitle}>Plan for a future date</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Recent Activity */}
        <Animated.View style={[styles.sectionContainer, fadeUp(activityAnim, 20)]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Text style={styles.sectionSubtitle}>Your latest shipments</Text>
            </View>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('MainTabs', { screen: 'Activity' })}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAllText}>See All</Text>
              <Ionicons name="chevron-forward" size={14} color={ORANGE} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={ORANGE} />
            </View>
          ) : recentDeliveries.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="cube-outline" size={32} color={ORANGE} />
              </View>
              <Text style={styles.emptyText}>No recent deliveries</Text>
              <Text style={styles.emptySubtext}>Start shipping to see activity here</Text>
            </View>
          ) : (
            recentDeliveries.map(renderActivityCard)
          )}
        </Animated.View>

        {/* Available Providers */}
        <Animated.View style={[styles.sectionContainer, fadeUp(providersAnim, 20)]}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>Available Providers</Text>
              <Text style={styles.sectionSubtitle}>Trusted partners near you</Text>
            </View>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('MainTabs', { screen: 'Explore' })}
              activeOpacity={0.7}
            >
              <Text style={styles.seeAllText}>View All</Text>
              <Ionicons name="chevron-forward" size={14} color={ORANGE} />
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.providersScrollContent}
            decelerationRate="fast"
            snapToInterval={width * 0.78 + 16}
            snapToAlignment="start"
          >
            {MOCK_PROVIDERS.map(renderProviderCard)}
          </ScrollView>
        </Animated.View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  bottomSpacer: {
    height: 80,
  },

  /* Header */
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 18,
    backgroundColor: ORANGE,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePicContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  profileImage: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  profileInitials: {
    fontSize: 18,
    fontWeight: '800',
    color: ORANGE,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  headerWelcome: {
    fontSize: 13,
    color: '#FFE0C7',
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  headerUsername: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 1,
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  notificationBadge: {
    position: 'absolute',
    top: 11,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: ORANGE,
  },

  /* Banner */
  upperBanner: {
    backgroundColor: ORANGE,
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  bannerTextContainer: {
    flex: 1.5,
    justifyContent: 'center',
  },
  bannerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    marginBottom: 10,
    gap: 4,
  },
  bannerBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: ORANGE,
    letterSpacing: 0.8,
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    marginBottom: 8,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  bannerSubtitle: {
    color: '#FFE0C7',
    fontSize: 12,
    fontWeight: '500',
  },
  bannerImage: {
    width: 120,
    height: 90,
    marginRight: -20,
  },

  /* Action Cards */
  actionContainer: {
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 8,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 22,
    paddingVertical: 18,
    paddingHorizontal: 18,
    marginBottom: 14,
  },
  actionCardPrimary: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1.5,
    borderColor: '#FFE4D2',
  },
  actionCardSecondary: {
    backgroundColor: '#111827',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  actionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitlePrimary: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  actionSubtitlePrimary: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 3,
    fontWeight: '500',
  },
  actionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  actionSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 3,
    fontWeight: '500',
  },

  /* Sections */
  sectionContainer: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: ORANGE,
  },

  /* Loading & Empty */
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 150,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: '#F3F4F6',
    borderStyle: 'dashed',
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },

  /* Activity Card */
  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    paddingLeft: 22,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  activityAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  activityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  activityHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityId: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 0.4,
  },
  activityDate: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  activityBody: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 120,
  },
  timelineColumn: {
    flex: 2,
    justifyContent: 'center',
    paddingRight: 12,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
  },
  timelineDotContainer: {
    alignItems: 'center',
    width: 16,
    marginRight: 12,
    paddingVertical: 2,
  },
  timelineDotSolid: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ORANGE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: ORANGE,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  timelineDotHollow: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  timelineLineDashed: {
    width: 2,
    height: 20,
    backgroundColor: '#E5E7EB',
    marginVertical: 2,
  },
  timelineTextContainer: {
    flex: 1,
    paddingTop: 2,
  },
  timelineTime: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  timelineLocation: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginTop: 1,
  },
  timelineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  timelineLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginLeft: 4,
  },
  packageColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  packageImage: {
    width: 80,
    height: 70,
    opacity: 0.5,
  },

  /* Provider Card */
  providersScrollContent: {
    paddingRight: 24,
    gap: 16,
    paddingVertical: 4,
  },
  providerCard: {
    width: width * 0.78,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  providerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  providerAvatarWrapper: {
    marginRight: 14,
    position: 'relative',
  },
  providerAvatarLarge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerVerifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  providerAvatarText: {
    fontSize: 19,
    fontWeight: '800',
  },
  providerInfoWrapper: {
    flex: 1,
  },
  providerNameLarge: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  providerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  providerVehicle: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  ratingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 3,
  },
  ratingNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D97706',
  },
  providerStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  providerStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  providerStatValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  providerStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6B7280',
    letterSpacing: 0.3,
  },
  providerStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
  },
  bookProviderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 14,
    borderRadius: 30,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  bookProviderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});