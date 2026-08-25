// src/modules/Dashboard/Sender/Settings_Sender/LegalPoliciesScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function LegalPoliciesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  
  // Optional: State to manage which policy is actively selected if you want them to be toggleable.
  // For now, setting 'Terms of Service' as the default active item based on the design.
  const [activeItem, setActiveItem] = useState('Terms of Service');

  const policies = [
    { id: '1', title: 'Terms of Service', icon: 'document-text-outline' as const },
    { id: '2', title: 'Privacy Policy', icon: 'shield-checkmark-outline' as const },
    { id: '3', title: 'Provider Agreement', icon: 'briefcase-outline' as const },
    { id: '4', title: 'Community Guidelines', icon: 'people-outline' as const },
    { id: '5', title: 'Cookie Policy', icon: 'globe-outline' as const },
  ];

  const handlePress = (title: string) => {
    setActiveItem(title);
    // You can add navigation to specific PDF views or text screens here later
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FA7A25" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Legal Policies</Text>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={styles.scrollContent}
      >
        {policies.map((policy) => {
          const isActive = activeItem === policy.title;
          
          return (
            <View key={policy.id} style={styles.itemWrapper}>
              {/* Vertical Side Indicator */}
              <View 
                style={[
                  styles.sideIndicator, 
                  isActive ? styles.activeIndicator : styles.inactiveIndicator
                ]} 
              />
              
              {/* Policy Card */}
              <TouchableOpacity 
                style={[
                  styles.card, 
                  isActive ? styles.activeCard : styles.inactiveCard
                ]}
                onPress={() => handlePress(policy.title)}
                activeOpacity={0.8}
              >
                <View style={styles.cardLeft}>
                  <Ionicons 
                    name={policy.icon} 
                    size={20} 
                    color={isActive ? '#FFFFFF' : '#374151'} 
                    style={styles.icon}
                  />
                  <Text style={[
                    styles.cardTitle, 
                    isActive ? styles.activeText : styles.inactiveText
                  ]}>
                    {policy.title}
                  </Text>
                </View>
                <Ionicons 
                  name="chevron-forward" 
                  size={20} 
                  color={isActive ? '#FFFFFF' : '#6B7280'} 
                />
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FA7A25',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 100,
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
  scrollContent: {
    paddingTop: 30,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  itemWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sideIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
    marginRight: 12,
  },
  activeIndicator: {
    backgroundColor: '#FA7A25',
  },
  inactiveIndicator: {
    backgroundColor: '#E5E7EB',
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 8,
    // Shadows for Android & iOS
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  activeCard: {
    backgroundColor: '#FA7A25',
  },
  inactiveCard: {
    backgroundColor: '#FFFFFF',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  activeText: {
    color: '#FFFFFF',
  },
  inactiveText: {
    color: '#374151',
  },
});