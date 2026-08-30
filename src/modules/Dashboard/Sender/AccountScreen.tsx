// src/modules/Dashboard/Sender/AccountScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';

// Types
interface UserData {
  user_id: number;
  first_name: string;
  last_name: string;
  profile_photo: string | null;
}

interface HistoryItem {
  id: string;
  type: string;
  date: string;
  time: string;
  pickup: string;
  pickupSub: string;
  dropoff: string;
  dropoffSub: string;
  provider: string;
  tracking: string;
  price: string;
}

// Mock Data for History View
const MOCK_HISTORY: HistoryItem[] = [
  {
    id: 'h1',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    pickup: 'Landers Superstore Cebu',
    pickupSub: 'Skyrise 4 Tower, Geonzon Street, cor V. Padriga Street, Cebu City',
    dropoff: 'Gaisano Country Mall',
    dropoffSub: 'Gov. M. Cuenco Ave Main Entrance',
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
    dropoffSub: 'Gov. M. Cuenco Ave Main Entrance',
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
    dropoffSub: 'Gov. M. Cuenco Ave Main Entrance',
    provider: 'Jun Joseph Pestaño',
    tracking: 'CXV34DA675FAS',
    price: '24.00',
  },
];

export default function AccountScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  
  // State
  const [userData, setUserData] = useState<UserData | null>(null);
  const [userEmail, setUserEmail] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('Sender');
  const [isProviderRegistered, setIsProviderRegistered] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'main' | 'payment' | 'history'>('main');

  // Helper function to get proper image URL
  const getImageUrl = (path: string | null): string | null => {
    if (!path) return null;
    
    // If it's already a full URL, return it
    if (path.startsWith('http')) {
      return path;
    }
    
    // If it's a Supabase storage path
    try {
      const { data } = supabase.storage
        .from('avatars') // Make sure this matches your bucket name
        .getPublicUrl(path);
      
      return data.publicUrl;
    } catch (error) {
      console.error('Error getting public URL:', error);
      return null;
    }
  };

  // Fetch user data
  const fetchUserData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
        return;
      }

      setUserEmail(user.email || '');

      // Get user data from your users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, profile_photo')
        .eq('auth_id', user.id)
        .single();

      if (userError) {
        console.error('Error fetching user:', userError);
        setUserData({
          user_id: 0,
          first_name: 'First',
          last_name: 'Last',
          profile_photo: null,
        });
        return;
      }

      if (userData) {
        setUserData(userData);
        
        // Handle profile photo
        if (userData.profile_photo) {
          const imageUrl = getImageUrl(userData.profile_photo);
          setAvatarUrl(imageUrl);
          setImageError(false);
        } else {
          setAvatarUrl(null);
        }

        // Check if user has Provider role
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

        if (userRoles && userRoles.length > 0) {
          const hasProviderRole = userRoles.some(
            (ur: any) => ur.roles?.role_name === 'Provider'
          );
          setIsProviderRegistered(hasProviderRole);
          setUserRole(hasProviderRole ? 'Provider' : 'Sender');
        } else {
          setUserRole('Sender');
          setIsProviderRegistered(false);
        }
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      Alert.alert('Error', 'Failed to load user data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  // Refresh data when screen is focused
  useFocusEffect(
    useCallback(() => {
      fetchUserData();
    }, [fetchUserData])
  );

  // Handlers
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
            try {
              await supabase.auth.signOut();
              navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
              });
            } catch (error) {
              Alert.alert('Error', 'Failed to log out. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleSwitchToProvider = () => {
    if (isProviderRegistered) {
      navigation.navigate('ProviderTabs');
    } else {
      navigation.navigate('RegisterProvider');
    }
  };

  const handleRateProvider = (providerName: string) => {
    Alert.alert(
      'Rate Provider',
      `How was your experience with ${providerName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rate', onPress: () => console.log('Rate provider') },
      ]
    );
  };

  const handleReportIssue = (trackingId: string) => {
    Alert.alert(
      'Report Issue',
      `Report an issue with delivery #${trackingId}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit Report', onPress: () => console.log('Report submitted') },
      ]
    );
  };

  // Loading state
  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#FA7A25" />
      </View>
    );
  }

  // --- SUB-SCREEN: PAYMENT METHODS ---
  if (currentView === 'payment') {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: '#FA7A25' }]}>
        <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={() => setCurrentView('main')} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>All Payment Methods</Text>
        </View>
        <View style={styles.subContent}>
          <TouchableOpacity 
            style={styles.menuItem} 
            onPress={() => {
              Alert.alert('Coming Soon', 'GCash payment integration will be available soon.');
            }}
          >
            <View style={styles.paymentRowLeft}>
              <View style={styles.gcashIcon}>
                <Text style={styles.gcashText}>G</Text>
                <Ionicons name="wifi" size={10} color="#FFF" style={styles.gcashWifi} />
              </View>
              <Text style={styles.menuText}>GCash</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#000" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              Alert.alert('Coming Soon', 'PayMaya payment integration will be available soon.');
            }}
          >
            <View style={styles.paymentRowLeft}>
              <View style={[styles.gcashIcon, { backgroundColor: '#004B87' }]}>
                <Text style={styles.gcashText}>P</Text>
              </View>
              <Text style={styles.menuText}>PayMaya</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#000" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => {
              Alert.alert('Coming Soon', 'Bank transfer payment integration will be available soon.');
            }}
          >
            <View style={styles.paymentRowLeft}>
              <View style={[styles.gcashIcon, { backgroundColor: '#1F2937' }]}>
                <Ionicons name="business" size={14} color="#FFF" />
              </View>
              <Text style={styles.menuText}>Bank Transfer</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#000" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- SUB-SCREEN: VIEW HISTORY ---
  if (currentView === 'history') {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: '#FA7A25' }]}>
        <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={() => setCurrentView('main')} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>View History</Text>
        </View>
        
        <ScrollView 
          style={styles.subContent} 
          contentContainerStyle={styles.historyScroll}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.historyTitle}>History</Text>
          <View style={styles.historyHeaderRow}>
            <Text style={styles.historySubtitle}>Recent</Text>
            <TouchableOpacity>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>

          {MOCK_HISTORY.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="time-outline" size={50} color="#D1D5DB" />
              <Text style={styles.emptyStateText}>No history yet</Text>
              <Text style={styles.emptyStateSubText}>Your completed deliveries will appear here</Text>
            </View>
          ) : (
            MOCK_HISTORY.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <Text style={styles.hCardType}>{item.type}</Text>
                <Text style={styles.hCardDate}>{item.date}   {item.time}</Text>

                <View style={styles.hCardBody}>
                  {/* Left: Timeline */}
                  <View style={styles.hCardTimeline}>
                    <View style={styles.hTimelinePoint}>
                      <View style={styles.blueDot}>
                        <View style={styles.blueDotInner} />
                      </View>
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

                  {/* Right: Provider */}
                  <View style={styles.hCardProvider}>
                    <View style={styles.hAvatar}>
                      <Ionicons name="person" size={24} color="#FFF" />
                    </View>
                    <Text style={styles.hProviderName}>{item.provider}</Text>
                    
                    <TouchableOpacity 
                      style={styles.hActionRow} 
                      onPress={() => handleRateProvider(item.provider)}
                    >
                      <Text style={styles.hActionText}>Rate Provider</Text>
                      <Ionicons name="star" size={12} color="#F59E0B" />
                    </TouchableOpacity>
                    
                    <TouchableOpacity 
                      style={styles.hActionRow} 
                      onPress={() => handleReportIssue(item.tracking)}
                    >
                      <Text style={styles.hActionText}>Report</Text>
                      <Ionicons name="flag" size={12} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.hCardDivider} />
                
                <View style={styles.hCardFooter}>
                  <Text style={styles.hTracking}>Tracking: {item.tracking}</Text>
                  <Text style={styles.hPrice}>₱{item.price}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  // --- MAIN SCREEN ---
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      {/* Custom Orange Header */}
      <View style={styles.mainHeader}>
        <View style={styles.profilePicContainer}>
          {avatarUrl && !imageError ? (
            <Image 
              source={{ uri: avatarUrl }} 
              style={styles.profileImage} 
              onError={(e) => {
                console.log('Image load error:', e.nativeEvent.error);
                setImageError(true);
              }}
              onLoad={() => {
                console.log('Image loaded successfully');
              }}
            />
          ) : (
            <Ionicons name="person" size={40} color="#D1D5DB" />
          )}
        </View>
        
        <View style={styles.nameContainer}>
          <Text style={styles.profileName}>
            {userData?.first_name || 'First'} {userData?.last_name || 'Last'}
          </Text>
          
          <TouchableOpacity 
            style={styles.editIconBtn}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Ionicons name="pencil" size={16} color="#000" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Menu Content */}
      <ScrollView 
        showsVerticalScrollIndicator={false} 
        style={styles.mainContent} 
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text style={styles.sectionTitle}>My Account</Text>
        
        {/* Switch to Provider Mode */}
        <TouchableOpacity 
          style={styles.menuItem} 
          onPress={handleSwitchToProvider}
        >
          <View style={styles.menuItemLeft}>
            <Text style={styles.menuText}>
              {isProviderRegistered ? 'Switch to Provider Mode' : 'Register as a Provider'}
            </Text>
            {isProviderRegistered && (
              <View style={styles.providerBadge}>
                <Text style={styles.providerBadgeText}>Active</Text>
              </View>
            )}
          </View>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* Payment Methods */}
        <TouchableOpacity style={styles.menuItem} onPress={() => setCurrentView('payment')}>
          <Text style={styles.menuText}>Payment Methods</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* View History */}
        <TouchableOpacity style={styles.menuItem} onPress={() => setCurrentView('history')}>
          <Text style={styles.menuText}>View History</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* General Section */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>General</Text>
        
        {/* Settings */}
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.menuText}>Settings</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* Help & Support */}
        <TouchableOpacity 
          style={styles.menuItem} 
          onPress={() => {
            Alert.alert('Help & Support', 'Contact us at support@packngo.com');
          }}
        >
          <Text style={styles.menuText}>Help & Support</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* About */}
        <TouchableOpacity 
          style={styles.menuItem} 
          onPress={() => {
            Alert.alert(
              'About Pack-N-Go',
              'Pack-N-Go v1.0.0\n\nYour trusted delivery service partner.'
            );
          }}
        >
          <Text style={styles.menuText}>About</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* Logout */}
        <TouchableOpacity 
          style={[styles.menuItem, { borderBottomWidth: 0 }]} 
          onPress={handleLogoutConfirm}
        >
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Pack-N-Go v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFFFFF' 
  },
  centerContent: { 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  
  // --- Main Screen Styles ---
  mainHeader: { 
    backgroundColor: '#FA7A25', 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 24, 
    paddingBottom: 100,
    paddingTop: 20,
  },
  profilePicContainer: { 
    width: 70, 
    height: 70, 
    borderRadius: 35, 
    backgroundColor: '#4B5563', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 16, 
    overflow: 'hidden', 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.15, 
    shadowRadius: 5, 
    elevation: 4, 
    bottom: -40 
  },
  profileImage: { 
    width: '100%', 
    height: '100%' 
  },
  nameContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    bottom: -40 
  },
  profileName: { 
    fontSize: 20, 
    fontWeight: '800', 
    color: '#000' 
  },
  editIconBtn: { 
    marginLeft: 8, 
    padding: 4 
  },
  mainContent: { 
    paddingHorizontal: 20, 
    paddingTop: 24 
  },
  sectionTitle: { 
    fontSize: 23, 
    fontWeight: '800', 
    color: '#111827', 
    marginBottom: 16 
  },
  menuItem: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingVertical: 16, 
    borderBottomWidth: 1, 
    borderColor: '#F3F4F6' 
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  providerBadgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '600',
  },
  menuText: { 
    fontSize: 20, 
    color: '#374151' 
  },
  logoutText: { 
    fontSize: 20, 
    color: '#EF4444' 
  },
  versionText: { 
    textAlign: 'center', 
    color: '#9CA3AF', 
    fontSize: 11, 
    fontWeight: '500', 
    marginTop: 30 
  },
  
  // --- Sub-Screen Shared Styles ---
  subHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingBottom: 140, 
    backgroundColor: '#FA7A25' 
  },
  backBtn: { 
    marginRight: 12, 
    bottom: -60 
  },
  subHeaderTitle: { 
    fontSize: 23, 
    fontWeight: '800', 
    color: '#000', 
    bottom: -60 
  },
  subContent: { 
    flex: 1, 
    backgroundColor: '#FFFFFF', 
    paddingHorizontal: 20 
  },
  
  // --- Payment Methods Styles ---
  paymentRowLeft: { 
    flexDirection: 'row', 
    alignItems: 'center' 
  },
  gcashIcon: { 
    width: 24, 
    height: 24, 
    backgroundColor: '#007DFE', 
    borderRadius: 4, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 12, 
    position: 'relative' 
  },
  gcashText: { 
    color: '#FFF', 
    fontWeight: '800', 
    fontSize: 14 
  },
  gcashWifi: { 
    position: 'absolute', 
    top: 2, 
    right: 2, 
    opacity: 0.8 
  },
  
  // --- View History Styles ---
  historyScroll: { 
    paddingTop: 24, 
    paddingBottom: 40 
  },
  historyTitle: { 
    fontSize: 24, 
    fontWeight: '800', 
    color: '#000', 
    marginBottom: 12 
  },
  historyHeaderRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 20 
  },
  historySubtitle: { 
    fontSize: 16, 
    color: '#374151' 
  },
  viewAllText: { 
    fontSize: 12, 
    color: '#FA7A25', 
    fontWeight: '600' 
  },
  historyCard: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 12, 
    padding: 16, 
    marginBottom: 16, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.05, 
    shadowRadius: 5, 
    elevation: 2, 
    borderWidth: 1, 
    borderColor: '#F3F4F6' 
  },
  hCardType: { 
    fontSize: 15, 
    color: '#6B7280', 
    marginBottom: 4 
  },
  hCardDate: { 
    fontSize: 15, 
    fontWeight: '800', 
    color: '#000', 
    marginBottom: 16 
  },
  hCardBody: { 
    flexDirection: 'row', 
    justifyContent: 'space-between' 
  },
  hCardTimeline: { 
    flex: 1, 
    paddingRight: 10 
  },
  hTimelinePoint: { 
    flexDirection: 'row', 
    alignItems: 'flex-start' 
  },
  blueDot: { 
    width: 14, 
    height: 14, 
    borderRadius: 7, 
    borderWidth: 3, 
    borderColor: '#0000CC', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 8, 
    marginTop: 2 
  },
  blueDotInner: { 
    width: 4, 
    height: 4, 
    borderRadius: 2, 
    backgroundColor: '#0000CC' 
  },
  hTimelineLine: { 
    width: 1, 
    height: 20, 
    backgroundColor: '#D1D5DB', 
    marginLeft: 6, 
    marginVertical: 2 
  },
  hAddressWrapper: { 
    flex: 1 
  },
  hAddressMain: { 
    fontSize: 14, 
    fontWeight: '700', 
    color: '#000', 
    marginBottom: 2 
  },
  hAddressSub: { 
    fontSize: 8, 
    color: '#6B7280', 
    lineHeight: 11 
  },
  hCardProvider: { 
    width: 100, 
    alignItems: 'center' 
  },
  hAvatar: { 
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: '#D97706', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 6 
  },
  hProviderName: { 
    fontSize: 10, 
    fontWeight: '700', 
    color: '#000', 
    textAlign: 'center', 
    marginBottom: 8 
  },
  hActionRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 6 
  },
  hActionText: { 
    fontSize: 9, 
    color: '#000', 
    marginRight: 4 
  },
  hCardDivider: { 
    height: 1, 
    backgroundColor: '#F3F4F6', 
    marginVertical: 12 
  },
  hCardFooter: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  hTracking: { 
    fontSize: 11, 
    color: '#6B7280' 
  },
  hPrice: { 
    fontSize: 14, 
    fontWeight: '800', 
    color: '#000' 
  },
  emptyState: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center',
    paddingVertical: 60 
  },
  emptyStateText: { 
    fontSize: 18, 
    fontWeight: '600',
    color: '#374151', 
    marginTop: 12 
  },
  emptyStateSubText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
});