import React, { useEffect, useState, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';

import { supabase } from '../../../utils/supabase';

const { width } = Dimensions.get('window');

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

  const renderActivityCard = (item: any) => {
    const statusColors = getStatusColor(item.status);

    return (
      <TouchableOpacity
        key={item.id}
        style={styles.activityCard}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('MainTabs', { screen: 'Activity' })}
      >
        {/* Header */}
        <View style={styles.activityHeader}>
          <View style={styles.activityHeaderLeft}>
            <View style={styles.activityIconContainer}>
              <Ionicons name="cube-outline" size={18} color="#F27024" />
            </View>
            <View>
              <Text style={styles.activityId}>{item.id}</Text>
              <Text style={styles.activityDate}>{item.date}</Text>
            </View>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColors.bg }]}>
            <Ionicons name="location-outline" size={14} color="#3B82F6" as const />
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
                <Text style={styles.timelineLocation}>{item.origin}</Text>
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
                <Text style={styles.timelineLocation}>{item.destination}</Text>
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

  const renderProviderCard = (provider: any) => {
    return (
      <TouchableOpacity
        key={provider.id}
        style={styles.providerCard}
        activeOpacity={0.7}
        onPress={() => Alert.alert('Book Provider', `Booking ${provider.name}`)}
      >
        <View style={styles.providerCardTop}>
          <View style={styles.providerAvatarWrapper}>
            <View style={[styles.providerAvatarLarge, { backgroundColor: provider.color + '20' }]}>
              <Text style={[styles.providerAvatarText, { color: provider.color }]}>
                {provider.initials}
              </Text>
            </View>
          </View>
          <View style={styles.providerInfoWrapper}>
            <Text style={styles.providerNameLarge} numberOfLines={1}>{provider.name}</Text>
            <Text style={styles.providerVehicle}>{provider.vehicle}</Text>
          </View>
          <View style={styles.ratingWrapper}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={styles.ratingNumber}>{provider.rating}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.bookProviderBtn}>
          <Text style={styles.bookProviderText}>Book Provider</Text>
          <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#F27024" />

      <View style={styles.headerSection}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.profilePicContainer}
            onPress={handleViewProfile}
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
          </TouchableOpacity>
          <View>
            <Text style={styles.headerWelcome}>Welcome,</Text>
            <Text style={styles.headerUsername}>{firstName} {lastName} 👋</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.notificationIcon} onPress={handleViewNotifications}>
          <Ionicons name="notifications-outline" size={22} color="#FFF" />
          <View style={styles.notificationBadge} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.upperBanner}>
          <View style={styles.bannerTextContainer}>
            <Text style={styles.bannerTitle}>Ship Your Packages with Confidence</Text>
            <Text style={styles.bannerSubtitle}>Fast, secure, and hassle-free delivery.</Text>
          </View>
          <Image
            source={require('../../../../assets/Pack-N-Ship-Packages.png')}
            style={styles.bannerImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.actionContainer}>
          <TouchableOpacity style={styles.actionCard} onPress={handleSendPackage}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="cube-outline" size={28} color="#111827" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Send Package Now</Text>
              <Text style={styles.actionSubtitle}>Instant booking & tracking</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionCard} onPress={handleScheduleDelivery}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="calendar-outline" size={28} color="#111827" />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Schedule a Delivery</Text>
              <Text style={styles.actionSubtitle}>Plan for a future date</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Activity' })}>
              <Text style={styles.seeAllText}>See All</Text>
            </TouchableOpacity>
          </View>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#F27024" />
            </View>
          ) : recentDeliveries.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="cube-outline" size={48} color="#D1D5DB" />
              <Text style={styles.emptyText}>No recent deliveries</Text>
              <Text style={styles.emptySubtext}>Start shipping to see activity here</Text>
            </View>
          ) : (
            recentDeliveries.map(renderActivityCard)
          )}
        </View>

        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Available Providers</Text>
            <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Explore' })}>
              <Text style={styles.seeAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.providersScrollContent}
            decelerationRate="fast"
            snapToInterval={width * 0.75 + 16}
            snapToAlignment="start"
          >
            {MOCK_PROVIDERS.map(renderProviderCard)}
          </ScrollView>
        </View>

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

  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    backgroundColor: '#F27024',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profilePicContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 2,
    borderColor: '#E65A0D',
    overflow: 'hidden',
  },
  profileImage: {
    width: 58,
    height: 58,
    borderRadius: 30,
  },
  profileInitials: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F27024',
  },
  headerWelcome: {
    fontSize: 14,
    color: '#FFDDC2',
    fontWeight: '400',
  },
  headerUsername: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  notificationIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },

  upperBanner: {
    backgroundColor: '#F27024',
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  bannerTextContainer: {
    flex: 1.5,
    justifyContent: 'center',
  },
  bannerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 10,
  },
  bannerSubtitle: {
    color: '#FFFFFF',
    fontSize: 11,
    opacity: 0.9,
  },
  bannerImage: {
    width: 120,
    height: 80,
    marginRight: -20,
  },

  actionContainer: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 50,
    paddingVertical: 16,
    paddingHorizontal: 18,
    marginBottom: 14,
    elevation: 3,
  },
  actionIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  actionSubtitle: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
  },

  sectionContainer: {
    paddingHorizontal: 24,
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F27024',
  },

  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 150,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },

  activityCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
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
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityId: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: 0.5,
  },
  activityDate: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
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
    backgroundColor: '#F27024',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#F27024',
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
    backgroundColor: '#D1D5DB',
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
    fontWeight: '700',
    color: '#3B82F6',
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
    opacity: 0.6,
  },

  providersScrollContent: {
    paddingRight: 24,
    gap: 16,
  },
  providerCard: {
    width: width * 0.75,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  providerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  providerAvatarWrapper: {
    marginRight: 14,
  },
  providerAvatarLarge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  providerAvatarText: {
    fontSize: 20,
    fontWeight: '800',
  },
  providerInfoWrapper: {
    flex: 1,
  },
  providerNameLarge: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  providerVehicle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  ratingWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  ratingNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D97706',
    marginLeft: 4,
  },
  bookProviderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F27024',
    paddingVertical: 14,
    borderRadius: 30,
    gap: 8,
  },
  bookProviderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});