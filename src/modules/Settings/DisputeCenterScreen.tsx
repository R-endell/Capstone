// src/modules/Dashboard/Sender/Settings_Sender/DisputeCenterScreen.tsx
import React from 'react';
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

interface DisputeItem {
  id: string;
  title: string;
  deliveryRef: string;
  disputeId: string;
  date: string;
  status: 'Under Review' | 'Resolved';
  providerName: string;
}

export default function DisputeCenterScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // Mock data matching the screenshot
  const disputes: DisputeItem[] = [
    {
      id: '1',
      title: 'Item Damaged',
      deliveryRef: 'ORD-2025-1045',
      disputeId: 'DISP-2025-0142',
      date: 'May 11, 2025, 10:20 AM',
      status: 'Under Review',
      providerName: 'Jun Joseph Pestano',
    },
    {
      id: '2',
      title: 'Item Damaged',
      deliveryRef: 'ORD-2025-4321',
      disputeId: 'DISP-2025-2336',
      date: 'May 01, 2025, 10:20 AM',
      status: 'Resolved',
      providerName: 'Bryan Nicole Dionsoo',
    },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FA7A25" />

      {/* Custom Orange Header */}
      <View style={[styles.mainHeader, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dispute Center</Text>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        style={styles.mainContent}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {/* File New Dispute Button */}
        <TouchableOpacity style={styles.fileButton} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={22} color="#FFFFFF" style={styles.btnIcon} />
          <Text style={styles.fileButtonText}>File New Dispute</Text>
        </TouchableOpacity>

        {/* Stats Section Grid */}
        <View style={styles.statsContainer}>
          {/* Open Disputes */}
          <View style={styles.statCard}>
            <View style={[styles.statCircle, { backgroundColor: '#FA7A25' }]}>
              <Text style={styles.statNumber}>3</Text>
            </View>
            <Text style={styles.statLabel}>Open Disputes</Text>
          </View>

          {/* In Review */}
          <View style={styles.statCard}>
            <View style={[styles.statCircle, { backgroundColor: '#2563EB' }]}>
              <Text style={styles.statNumber}>1</Text>
            </View>
            <Text style={styles.statLabel}>In Review</Text>
          </View>

          {/* Resolved */}
          <View style={styles.statCard}>
            <View style={[styles.statCircle, { backgroundColor: '#16A34A' }]}>
              <Text style={styles.statNumber}>5</Text>
            </View>
            <Text style={styles.statLabel}>Resolved</Text>
          </View>
        </View>

        {/* Dispute List Cards */}
        {disputes.map((item) => (
          <View key={item.id} style={styles.disputeCard}>
            <View style={styles.cardHeaderRow}>
              {/* Box Icon Container */}
              <View style={styles.boxContainer}>
                <Ionicons name="cube" size={28} color="#D97706" />
              </View>

              {/* Text Meta Content */}
              <View style={styles.metaContent}>
                <Text style={styles.disputeItemTitle}>{item.title}</Text>
                <Text style={styles.metaSubText}>Delivery Ref: {item.deliveryRef}</Text>
                <Text style={styles.metaSubText}>Dispute ID: {item.disputeId}</Text>
                
                <View style={styles.dateRow}>
                  <Ionicons name="calendar-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                  <Text style={styles.dateText}>{item.date}</Text>
                </View>
              </View>

              {/* Right Side Pill Badge & Action Arrow */}
              <View style={styles.rightActionColumn}>
                <View style={[
                  styles.statusBadge, 
                  item.status === 'Under Review' ? styles.badgeBlue : styles.badgeGreen
                ]}>
                  <Text style={styles.badgeText}>{item.status}</Text>
                </View>
                
                <TouchableOpacity style={styles.chevronButton}>
                  <Ionicons name="chevron-forward" size={20} color="#6B7280" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Separator Line */}
            <View style={styles.cardDivider} />

            {/* Bottom Provider details row */}
            <View style={styles.providerRow}>
              <View style={styles.providerAvatar}>
                <Ionicons name="person" size={12} color="#FFFFFF" />
              </View>
              <Text style={styles.providerText}>Provider: {item.providerName}</Text>
            </View>
          </View>
        ))}
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
  mainContent: { 
    paddingHorizontal: 20, 
    paddingTop: 24,
  },
  fileButton: {
    backgroundColor: '#FA7A25',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  btnIcon: {
    marginRight: 8,
  },
  fileButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  statCard: {
    backgroundColor: '#FFFFFF',
    width: '30%',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  statCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statNumber: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '600',
    textAlign: 'center',
  },
  disputeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  boxContainer: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#FEF3C7', // Light orange/yellow background for package icon
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  metaContent: {
    flex: 1,
  },
  disputeItemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  metaSubText: {
    fontSize: 11,
    color: '#4B5563',
    lineHeight: 16,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  dateText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  rightActionColumn: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 80,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeBlue: {
    backgroundColor: '#2563EB',
  },
  badgeGreen: {
    backgroundColor: '#16A34A',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  chevronButton: {
    padding: 4,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  providerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  providerText: {
    fontSize: 11,
    color: '#4B5563',
    fontWeight: '500',
  },
});