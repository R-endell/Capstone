import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, StatusBar, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../App';

import { supabase } from '../../../utils/supabase';

// Mock data – replace with real API calls later
const MOCK_PROVIDERS = [
  {
    name: 'Jun Joseph Pestaño',
    vehicle: 'Civic RS Turbo',
    plate: 'NDA-024',
    rating: 4.8,
    completedDeliveries: 12,
  },
  {
    name: 'Maria Santos',
    vehicle: 'Toyota Vios',
    plate: 'ABC-123',
    rating: 4.6,
    completedDeliveries: 8,
  },
  {
    name: 'FastTrack Logistics',
    vehicle: 'Van',
    plate: 'FT-5678',
    rating: 4.9,
    completedDeliveries: 25,
  },
  {
    name: 'LBC Express',
    vehicle: 'Van',
    plate: 'LBC-456',
    rating: 4.5,
    completedDeliveries: 30,
  },
];

const MOCK_COMPLETED = [
  {
    request_id: 2001,
    pickup_type: 'Curb-side',
    estimated_cost: 24.00,
    scheduled_time: '2026-04-20T15:30:00',
    pickup_location: { street_address: 'IT Park, Lahug, Cebu City' },
    dropoff_location: { street_address: 'Ayala Center Cebu' },
  },
  {
    request_id: 2002,
    pickup_type: 'Door-to-door',
    estimated_cost: 36.50,
    scheduled_time: '2026-04-18T09:00:00',
    pickup_location: { street_address: 'SM Seaside City Cebu' },
    dropoff_location: { street_address: 'Mactan Airport, Lapu-Lapu City' },
  },
  {
    request_id: 2003,
    pickup_type: 'Curb-side',
    estimated_cost: 18.75,
    scheduled_time: '2026-04-15T11:00:00',
    pickup_location: { street_address: 'Basilica del Santo Niño, Cebu City' },
    dropoff_location: { street_address: 'Temple of Leah, Cebu City' },
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [firstName, setFirstName] = useState('First');
  const [lastName, setLastName] = useState('Last');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        if (user.user_metadata?.first_name) setFirstName(user.user_metadata.first_name);
        if (user.user_metadata?.last_name) setLastName(user.user_metadata.last_name);
        if (user.user_metadata?.avatar_url) setAvatarUrl(user.user_metadata.avatar_url);
      }
    };
    fetchUser();
  }, []);

  const handleSendPackage = () => {
    Alert.alert('Coming Soon', 'Send Package feature will be available in the next update.');
  };

  const handleScheduleDelivery = () => {
    Alert.alert('Coming Soon', 'Schedule Delivery feature will be available in the next update.');
  };

  const handleViewProfile = () => {
    navigation.navigate('MainTabs', { screen: 'Account' });
  };

  const handleViewNotifications = () => {
    Alert.alert('Coming Soon', 'Notifications will be available in the next update.');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#F27024" />

      {/* Header */}
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
        {/* Banner */}
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

        {/* Action Buttons */}
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

        {/* Completed Deliveries */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading}>Completed Deliveries</Text>
          {MOCK_COMPLETED.map((item) => (
            <View key={item.request_id} style={styles.completedCard}>
              <View style={styles.completedHeader}>
                <View style={styles.completedHeaderLeft}>
                  <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                  <Text style={styles.deliveryId}>#{item.request_id}</Text>
                </View>
                <Text style={styles.deliveryType}>{item.pickup_type}</Text>
              </View>
              <View style={styles.routeRow}>
                <Ionicons name="location-outline" size={14} color="#3B82F6" />
                <Text style={styles.addressText} numberOfLines={1}>
                  {item.pickup_location?.street_address}
                </Text>
              </View>
              <Ionicons
                name="arrow-down"
                size={12}
                color="#D1D5DB"
                style={styles.arrowIcon}
              />
              <View style={styles.routeRow}>
                <Ionicons name="location-outline" size={14} color="#EF4444" />
                <Text style={styles.addressText} numberOfLines={1}>
                  {item.dropoff_location?.street_address}
                </Text>
              </View>
              <View style={styles.completedFooter}>
                <Text style={styles.dateText}>
                  {new Date(item.scheduled_time).toLocaleDateString()}
                </Text>
                <Text style={styles.costText}>₱{item.estimated_cost.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Recent Providers */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading}>Recent Providers</Text>
          {MOCK_PROVIDERS.map((provider, index) => (
            <View key={index} style={styles.providerCard}>
              <View style={styles.providerAvatar}>
                <Ionicons name="person" size={28} color="#FFFFFF" />
              </View>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{provider.name}</Text>
                <Text style={styles.providerDetail}>
                  <Ionicons name="car-sport-outline" size={12} color="#6B7280" /> {provider.vehicle} · {provider.plate}
                </Text>
                <View style={styles.ratingRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Ionicons
                      key={star}
                      name={star <= Math.floor(provider.rating) ? 'star' : 'star-outline'}
                      size={14}
                      color="#F59E0B"
                    />
                  ))}
                  <Text style={styles.ratingNumber}>{provider.rating}</Text>
                  <Text style={styles.deliveryCount}>
                    · {provider.completedDeliveries} deliveries
                  </Text>
                </View>
              </View>
              <TouchableOpacity style={styles.callButton}>
                <Ionicons name="call-outline" size={22} color="#F27024" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        
        {/* Bottom spacer for tab bar */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingBottom: 20,
  },
  bottomSpacer: {
    height: 80,
  },

  // Header
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

  // Banner
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

  // Action Cards
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

  // Section
  sectionContainer: {
    paddingHorizontal: 24,
    marginTop: 8,
    paddingBottom: 20,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 16,
  },

  // Completed Card
  completedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#10B981',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  completedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  completedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deliveryId: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginLeft: 6,
  },
  deliveryType: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  addressText: {
    fontSize: 12,
    color: '#374151',
    marginLeft: 6,
    flex: 1,
  },
  arrowIcon: {
    marginLeft: 10,
    marginVertical: 2,
  },
  completedFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  dateText: {
    fontSize: 11,
    color: '#6B7280',
  },
  costText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F27024',
  },

  // Provider Card
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: '#F27024',
  },
  providerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#CC5500',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  providerDetail: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    marginLeft: 4,
  },
  deliveryCount: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 2,
  },
  callButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
});