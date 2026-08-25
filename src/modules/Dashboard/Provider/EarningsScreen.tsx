import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  FlatList, 
  TouchableOpacity, 
  Platform,
  StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Mock data for the transactions
const TRANSACTIONS = [
  { id: '1', title: 'Live Delivery', status: 'Completed', date: 'Today, 9:45 AM', amount: '+ ₱89.00' },
  { id: '2', title: 'Live Delivery', status: 'Completed', date: 'Today, 1:45 PM', amount: '+ ₱32.00' },
  { id: '3', title: 'Live Delivery', status: 'Completed', date: 'Yesterday', amount: '+ ₱43.00' },
  { id: '4', title: 'Live Delivery', status: 'Completed', date: 'Yesterday', amount: '+ ₱23.00' },
];

export default function EarningsScreen() {
  
  const renderTransaction = ({ item }: { item: typeof TRANSACTIONS[0] }) => (
    <View style={styles.transactionCard}>
      <View style={styles.transactionLeft}>
        {/* Green Icon Box */}
        <View style={styles.iconContainer}>
          <Ionicons name="checkmark-circle" size={24} color="#FFFFFF" style={styles.checkIcon} />
        </View>
        
        {/* Transaction Text */}
        <View style={styles.transactionDetails}>
          <Text style={styles.transactionTitle}>{item.title}</Text>
          <Text style={styles.transactionSubtitle}>
            {item.status} • {item.date}
          </Text>
        </View>
      </View>
      
      {/* Amount */}
      <Text style={styles.transactionAmount}>{item.amount}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        
        {/* Header */}
        <Text style={styles.headerTitle}>My Earnings</Text>

        {/* Main Earnings Card */}
        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>Total Earnings</Text>
          <Text style={styles.earningsAmount}>₱2,421.00</Text>
          
          <View style={styles.divider} />
          
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>34</Text>
              <Text style={styles.statLabel}>Jobs Done</Text>
            </View>
            
            <View style={styles.verticalDivider} />
            
            <View style={styles.statBox}>
              <Text style={styles.statValue}>4.9</Text>
              <Text style={styles.statLabel}>Ratings</Text>
            </View>
          </View>
        </View>

        {/* Recent Transactions Header */}
        <View style={styles.recentHeaderRow}>
          <Text style={styles.recentTitle}>Recent Transactions</Text>
          
          <TouchableOpacity style={styles.withdrawButton} activeOpacity={0.7}>
            <View style={styles.withdrawTextContainer}>
              <Text style={styles.withdrawText}>Withdraw via</Text>
              <Text style={styles.withdrawTextBold}>GCash</Text>
            </View>
            <View style={styles.gcashIcon}>
              <Text style={styles.gcashG}>G</Text>
              <Ionicons name="wifi" size={10} color="#FFFFFF" style={styles.gcashWifi} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Transactions List */}
        <FlatList
          data={TRANSACTIONS}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 35,
    fontWeight: '600',
    color: '#000000',
    marginTop: Platform.OS === 'android' ? 80 : 10,
    marginBottom: 20,
  },
  earningsCard: {
    backgroundColor: '#1E1E1E',
    borderRadius: 16,
    padding: 24,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  earningsLabel: {
    color: '#E5E7EB',
    fontSize: 15,
    marginBottom: 8,
  },
  earningsAmount: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },
  divider: {
    height: 1,
    backgroundColor: '#4B5563',
    marginVertical: 20,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  statLabel: {
    color: '#E5E7EB',
    fontSize: 12,
  },
  verticalDivider: {
    width: 1,
    height: 35,
    backgroundColor: '#4B5563',
  },
  recentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  recentTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#000000',
  },
  withdrawButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  withdrawTextContainer: {
    marginRight: 8,
    alignItems: 'flex-end',
  },
  withdrawText: {
    fontSize: 10,
    color: '#111827',
  },
  withdrawTextBold: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#111827',
  },
  gcashIcon: {
    backgroundColor: '#0070F0',
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  gcashG: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
    marginRight: -2,
  },
  gcashWifi: {
    transform: [{ rotate: '90deg' }],
  },
  listContent: {
    paddingBottom: 20,
  },
  transactionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 44,
    height: 44,
    backgroundColor: '#95F25C',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  checkIcon: {
    color: '#0AA505',
  },
  transactionDetails: {
    justifyContent: 'center',
  },
  transactionTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
    marginBottom: 4,
  },
  transactionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0AA505',
  },
});