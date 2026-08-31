// src/modules/Dashboard/Provider/EarningsScreen.tsx
import React, { useState, useCallback } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  FlatList, 
  TouchableOpacity, 
  Platform,
  StatusBar,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';

// Types based on your schema
interface Transaction {
  transaction_id: number;
  base_amount: number;
  service_fee: number;
  total_amount: number;
  penalty_fee: number | null;
  payment_method: string;
  status: string;
  processed_at: string | null;
  escrow_id: number;
  provider_id?: number;
  sender_id?: number;
}

interface ProviderWallet {
  wallet_id?: number;
  provider_id: number;
  balance: number;
  gcash_number: string;
  bank_name: string | null;
  bank_acc_number: string | null;
  bank_acc_holder: string | null;
  updated_at: string;
}

export default function EarningsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletData, setWalletData] = useState<ProviderWallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [totalJobs, setTotalJobs] = useState(0);
  const [averageRating, setAverageRating] = useState(0);

  // Get provider ID from user_roles
  const getProviderId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('No user found');
        return null;
      }

      // Get user_id from users table
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();

      if (userError) {
        console.error('Error fetching user:', userError);
        return null;
      }

      console.log('User ID:', userData.user_id);

      // Check if user has Provider role
      const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select(`
          role_id,
          roles!inner (role_name)
        `)
        .eq('user_id', userData.user_id)
        .single();

      if (roleError) {
        console.error('Error checking user role:', roleError);
        // Try to get provider_id directly from provider_wallet
      } else if (userRole?.roles?.role_name !== 'Provider') {
        console.log('User does not have Provider role');
        // Try to get provider_id directly from provider_wallet anyway
      }

      // Get provider_id from provider_wallet
      const { data: walletData, error: walletError } = await supabase
        .from('provider_wallet')
        .select('provider_id')
        .eq('provider_id', userData.user_id)
        .single();

      if (walletError) {
        console.error('Error fetching from provider_wallet:', walletError);
        
        // Try provider_routes as fallback
        const { data: routeData, error: routeError } = await supabase
          .from('provider_routes')
          .select('provider_id')
          .eq('provider_id', userData.user_id)
          .single();

        if (routeError) {
          console.error('Error fetching from provider_routes:', routeError);
          Alert.alert(
            'Provider Account Not Found',
            'You need to register as a provider first.'
          );
          return null;
        }
        
        setProviderId(routeData.provider_id);
        return routeData.provider_id;
      }

      setProviderId(walletData.provider_id);
      return walletData.provider_id;
    } catch (error) {
      console.error('Error in getProviderId:', error);
      return null;
    }
  };

  // Fetch wallet data from provider_wallet table
  const fetchWalletData = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('provider_wallet')
        .select('*')
        .eq('provider_id', providerId)
        .single();

      if (error) throw error;
      setWalletData(data);
      return data;
    } catch (error) {
      console.error('Error fetching wallet data:', error);
      return null;
    }
  };

  // Fetch transactions through escrow_payments
  const fetchTransactions = async (providerId: number) => {
    try {
      // First get escrow payments for this provider
      const { data: escrowData, error: escrowError } = await supabase
        .from('escrow_payments')
        .select('escrow_id')
        .eq('provider_id', providerId);

      if (escrowError) throw escrowError;

      if (!escrowData || escrowData.length === 0) {
        setTransactions([]);
        setTotalJobs(0);
        return [];
      }

      const escrowIds = escrowData.map(e => e.escrow_id);

      // Then get transactions for these escrow payments
      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .select('*')
        .in('escrow_id', escrowIds)
        .order('processed_at', { ascending: false })
        .limit(20);

      if (transactionError) throw transactionError;

      // Add provider_id to transactions for display
      const transactionsWithProvider = (transactionData || []).map(t => ({
        ...t,
        provider_id: providerId
      }));

      setTransactions(transactionsWithProvider);
      
      // Count completed transactions
      const completedJobs = transactionsWithProvider.filter(
        (t: Transaction) => t.status === 'completed' || t.status === 'Completed'
      );
      setTotalJobs(completedJobs.length);

      return transactionsWithProvider;
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setTransactions([]);
      return [];
    }
  };

  // Fetch average rating from ratings_reviews table
  const fetchAverageRating = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('ratings_reviews')
        .select('rating')
        .eq('reviewee_id', providerId);

      if (error) throw error;

      if (data && data.length > 0) {
        const total = data.reduce((sum: number, item: any) => sum + item.rating, 0);
        const avg = total / data.length;
        setAverageRating(Number(avg.toFixed(1)));
      } else {
        setAverageRating(0);
      }
    } catch (error) {
      console.error('Error fetching ratings:', error);
      setAverageRating(0);
    }
  };

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const providerId = await getProviderId();
      
      if (providerId) {
        await Promise.all([
          fetchWalletData(providerId),
          fetchTransactions(providerId),
          fetchAverageRating(providerId),
        ]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  // Handle refresh
  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // Handle withdraw to GCash
  const handleWithdraw = async () => {
    if (!walletData) {
      Alert.alert('Error', 'No wallet found');
      return;
    }

    if (walletData.balance <= 0) {
      Alert.alert('Insufficient Balance', 'You need at least ₱1.00 to withdraw');
      return;
    }

    if (!walletData.gcash_number) {
      Alert.alert('No GCash Account', 'Please set up your GCash account in your profile');
      return;
    }

    Alert.alert(
      'Withdraw to GCash',
      `Are you sure you want to withdraw ₱${walletData.balance.toFixed(2)} to ${walletData.gcash_number}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Withdraw',
          style: 'default',
          onPress: async () => {
            try {
              // Create withdrawal request
              const { error: withdrawalError } = await supabase
                .from('withdrawal_requests')
                .insert({
                  provider_wallet_id: walletData.wallet_id,
                  amount: walletData.balance,
                  method: 'GCash',
                  status: 'pending',
                  requested_at: new Date().toISOString(),
                });

              if (withdrawalError) throw withdrawalError;

              // Update wallet balance to 0
              const { error: updateError } = await supabase
                .from('provider_wallet')
                .update({ 
                  balance: 0,
                  updated_at: new Date().toISOString()
                })
                .eq('provider_id', providerId);

              if (updateError) throw updateError;

              Alert.alert(
                'Withdrawal Initiated',
                `Your withdrawal of ₱${walletData.balance.toFixed(2)} is being processed.`,
                [{ text: 'OK' }]
              );

              // Refresh data
              await loadData();
            } catch (error) {
              console.error('Withdrawal error:', error);
              Alert.alert('Error', 'Failed to process withdrawal. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Format date helper
  const formatDate = (timestamp: string | null) => {
    if (!timestamp) return 'Pending';
    
    const date = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date >= today) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (date >= yesterday) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric' 
      });
    }
  };

  // Render transaction item
  const renderTransaction = ({ item }: { item: Transaction }) => {
    const isCompleted = item.status === 'completed' || item.status === 'Completed';
    const isPending = item.status === 'pending' || item.status === 'Pending';
    const isFailed = item.status === 'failed' || item.status === 'Failed';
    
    let statusColor = '#6B7280';
    let statusIcon = 'time-outline';
    let statusText = item.status;

    if (isCompleted) {
      statusColor = '#0AA505';
      statusIcon = 'checkmark-circle';
    } else if (isPending) {
      statusColor = '#F59E0B';
      statusIcon = 'time-outline';
    } else if (isFailed) {
      statusColor = '#EF4444';
      statusIcon = 'close-circle';
    }

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionLeft}>
          <View style={[styles.iconContainer, { backgroundColor: isCompleted ? '#95F25C' : isPending ? '#FCD34D' : '#FCA5A5' }]}>
            <Ionicons 
              name={statusIcon} 
              size={24} 
              color={isCompleted ? '#0AA505' : isPending ? '#D97706' : '#EF4444'} 
            />
          </View>
          <View style={styles.transactionDetails}>
            <Text style={styles.transactionTitle}>
              Transaction #{item.transaction_id}
            </Text>
            <Text style={styles.transactionSubtitle}>
              <Text style={{ color: statusColor }}>{statusText}</Text>
              {' • '}
              {formatDate(item.processed_at)}
            </Text>
            <Text style={styles.transactionPayment}>
              {item.payment_method} • Fee: ₱{item.service_fee.toFixed(2)}
            </Text>
          </View>
        </View>
        <View style={styles.transactionRight}>
          <Text style={[styles.transactionAmount, { color: isCompleted ? '#0AA505' : '#6B7280' }]}>
            {isCompleted ? '+' : ''}₱{item.total_amount.toFixed(2)}
          </Text>
          {item.penalty_fee && item.penalty_fee > 0 && (
            <Text style={styles.penaltyText}>
              Penalty: -₱{item.penalty_fee.toFixed(2)}
            </Text>
          )}
        </View>
      </View>
    );
  };

  // Loading state
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>Loading earnings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        
        {/* Header */}
        <Text style={styles.headerTitle}>My Earnings</Text>

        {/* Main Earnings Card */}
        <View style={styles.earningsCard}>
          <Text style={styles.earningsLabel}>Total Earnings</Text>
          <Text style={styles.earningsAmount}>
            ₱{walletData?.balance?.toFixed(2) || '0.00'}
          </Text>
          
          <View style={styles.divider} />
          
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{totalJobs}</Text>
              <Text style={styles.statLabel}>Jobs Done</Text>
            </View>
            
            <View style={styles.verticalDivider} />
            
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {averageRating > 0 ? averageRating.toFixed(1) : 'N/A'}
              </Text>
              <Text style={styles.statLabel}>
                {averageRating > 0 ? '⭐ Ratings' : 'No Ratings'}
              </Text>
            </View>
          </View>
        </View>

        {/* Recent Transactions Header */}
        <View style={styles.recentHeaderRow}>
          <Text style={styles.recentTitle}>Recent Transactions</Text>
          
          <TouchableOpacity 
            style={styles.withdrawButton} 
            activeOpacity={0.7}
            onPress={handleWithdraw}
          >
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
          data={transactions}
          keyExtractor={(item) => item.transaction_id.toString()}
          renderItem={renderTransaction}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#000000"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="receipt-outline" size={50} color="#D1D5DB" />
              <Text style={styles.emptyText}>No transactions yet</Text>
              <Text style={styles.emptySubText}>
                Your completed deliveries will appear here
              </Text>
            </View>
          }
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
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
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionDetails: {
    flex: 1,
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
  transactionPayment: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '600',
  },
  penaltyText: {
    fontSize: 10,
    color: '#EF4444',
    marginTop: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptySubText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
    textAlign: 'center',
  },
});