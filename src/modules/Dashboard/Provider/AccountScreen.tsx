// src/modules/Dashboard/Provider/AccountScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  StatusBar,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

export default function ProviderAccountScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [firstName, setFirstName] = useState<string>('First');
  const [lastName, setLastName] = useState<string>('Last');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const fetchUserData = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      <View style={[styles.mainHeader, { paddingTop: insets.top + 20 }]}>
        <View style={styles.profilePicContainer}>
          {avatarUrl && !imageError ? (
            <Image 
              source={{ uri: avatarUrl }} 
              style={styles.profileImage} 
              onError={() => setImageError(true)}
            />
          ) : (
            <Ionicons name="person" size={40} color="#D1D5DB" />
          )}
        </View>
        
        <View style={styles.nameContainer}>
          <View style={styles.nameRow}>
            <Text style={styles.profileName}>{firstName} {lastName}</Text>
            
            <TouchableOpacity 
              style={styles.editIconBtn}
              onPress={() => navigation.navigate('EditProfile')}
            >
              <Ionicons name="pencil" size={16} color="#000" />
            </TouchableOpacity>
          </View>
          
          <Text style={styles.verifiedText}>Verified Provider</Text>
          <View style={styles.ratingRow}>
            <Text style={styles.ratingScore}>4.9</Text>
            <View style={styles.starsContainer}>
              <Ionicons name="star" size={14} color="#FACC15" />
              <Ionicons name="star" size={14} color="#FACC15" />
              <Ionicons name="star" size={14} color="#FACC15" />
              <Ionicons name="star" size={14} color="#FACC15" />
              <Ionicons name="star" size={14} color="#FACC15" />
            </View>
          </View>
        </View>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        style={styles.mainContent} 
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <Text style={styles.sectionTitle}>My Account</Text>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleSwitchToSender}>
          <Text style={styles.menuText}>Switch to Sender Mode</Text>
          <Ionicons name="swap-horizontal-outline" size={24} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Text style={styles.menuText}>Payment Methods</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.menuItem} 
          onPress={() => navigation.navigate('ManageVehicle')}
        >
          <Text style={styles.menuText}>Manage Vehicle</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* UPDATED: Added navigation for Manage Travel Routes */}
        <TouchableOpacity 
          style={styles.menuItem}
          onPress={() => navigation.navigate('ManageRoutes')}
        >
          <Text style={styles.menuText}>Manage Travel Routes</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>General</Text>
        
        <TouchableOpacity style={styles.menuItem} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.menuText}>Settings</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleLogoutConfirm}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Pack-N-Ship v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  mainHeader: {
    backgroundColor: '#FA7A25', 
    flexDirection: 'row', 
    alignItems: 'center',
    paddingHorizontal: 24, 
    paddingBottom: 100,
  },
  profilePicContainer: {
    width: 70, height: 70, borderRadius: 35, 
    backgroundColor: '#4B5563', justifyContent: 'center', 
    alignItems: 'center', marginRight: 16, overflow: 'hidden', 
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, shadowRadius: 5, elevation: 4, bottom: -40,
  },
  profileImage: { width: '100%', height: '100%' },
  nameContainer: { bottom: -45 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  profileName: { fontSize: 20, fontWeight: '800', color: '#000' },
  editIconBtn: { marginLeft: 8, padding: 4 },
  verifiedText: { fontSize: 12, fontWeight: '700', color: '#059669', marginBottom: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingScore: { fontSize: 13, fontWeight: '800', color: '#000', marginRight: 6 },
  starsContainer: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  mainContent: { paddingHorizontal: 20, paddingTop: 36 },
  sectionTitle: { fontSize: 23, fontWeight: '800', color: '#111827', marginBottom: 16 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, borderBottomWidth: 1, borderColor: '#F3F4F6',
  },
  menuText: { fontSize: 20, color: '#374151' },
  logoutText: { fontSize: 20, color: '#EF4444' },
  versionText: { textAlign: 'center', color: '#9CA3AF', fontSize: 11, fontWeight: '500', marginTop: 30 },
});