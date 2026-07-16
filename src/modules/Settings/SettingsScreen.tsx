// src/modules/Dashboard/Sender/Settings_Sender/SettingsScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const handleSecurityPress = () => {
    console.log('Security and Verification pressed');
  };

  const handleTwoFactorPress = () => {
    // Navigates to the new Two-Factor Authentication screen
    navigation.navigate('TwoFactorAuth');
  };

  const handleIdentityPress = () => {
    // Navigates to the Identity Verification screen
    navigation.navigate('IdentityVerification');
  };

  const handleDisputePress = () => {
    navigation.navigate('DisputeCenter');
  };

  const handleLegalPress = () => {
    // Navigates to the Legal Policies screen
    navigation.navigate('LegalPolicies');
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      {/* Custom Orange Header */}
      <View style={[styles.mainHeader, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>

        {/* Gray Car Image placed inside the header */}
        <Image 
          source={require('../../../assets/Car-Grey.png')} // Adjust relative path to your assets folder as needed
          style={styles.carImage}
          resizeMode="contain"
        />
      </View>

      {/* Menu Content */}
      <ScrollView 
        showsVerticalScrollIndicator={false} 
        style={styles.mainContent} 
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* Security and Verification Section */}
        <Text style={styles.sectionTitle}>Security and Verification</Text>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleTwoFactorPress}>
          <Text style={styles.menuText}>Two-Factor Authentication</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={handleIdentityPress}>
          <Text style={styles.menuText}>Identity Verification</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        {/* Support & Legal Section */}
        <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Support & Legal</Text>
        
        <TouchableOpacity style={styles.menuItem} onPress={handleDisputePress}>
          <Text style={styles.menuText}>Dispute Center</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { borderBottomWidth: 0 }]} onPress={handleLegalPress}>
          <Text style={styles.menuText}>Legal Policies</Text>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFFFFF' 
  },
  mainHeader: {
    backgroundColor: '#FA7A25', 
    flexDirection: 'row', 
    alignItems: 'center',
    paddingHorizontal: 24, 
    paddingBottom: 100,
    position: 'relative', 
    overflow: 'hidden',    
  },
  backButton: {
    marginRight: 12,
    bottom: -40,
    zIndex: 10, 
  },
  headerTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#000',
    bottom: -40,
    zIndex: 10, 
  },
  carImage: {
    position: 'absolute',
    right: -15,   
    bottom: -15,  
    width: 250,   
    height: 130,  
    zIndex: 1,
  },
  mainContent: { 
    paddingHorizontal: 20, 
    paddingTop: 24,
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
    borderColor: '#F3F4F6',
  },
  menuText: { 
    fontSize: 20, 
    color: '#374151' 
  },
});