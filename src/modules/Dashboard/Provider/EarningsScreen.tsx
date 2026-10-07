// src/modules/Dashboard/Provider/EarningsScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  FlatList, 
  TouchableOpacity, 
  Platform,
  StatusBar,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Easing
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';

const ORANGE = '#FA7A25';

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
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletData, setWalletData] = useState<ProviderWallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [totalJobs, setTotalJobs] = useState(0);
  const [averageRating, setAverageRating] = useState(0);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(contentAnim, 150),
    ]).start();
  }, [headerAnim, contentAnim]);

  // Get provider ID from user_roles
  const getProviderId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .maybeSingle();  

      if (userError || !userData) return null;

      const { data: walletData, error: walletError } = await supabase
        .from('provider_wallet')
        .select('provider_id')
        .eq('provider_id', userData.user_id)
        .maybeSingle();

      if (walletData) {
        setProviderId(walletData.provider_id);
        return walletData.provider_id;
      }

      const { data: routeData } = await supabase
        .from('provider_routes')
        .select('provider_id')
        .eq('provider_id', userData.user_id)
        .maybeSingle();

      if (routeData) {
        setProviderId(routeData.provider_id);
        return routeData.provider_id;
      }

      setProviderId(userData.user_id);
      return userData.user_id;
    } catch (error) {
      console.error('Error in getProviderId:', error);
      return null;
    }
  };

  const fetchWalletData = async (providerId: number) => {
    try {
      const { data, error } = await supabase
        .from('provider_wallet')
        .select('*')
        .eq('provider_id', providerId)
        .maybeSingle();

      if (error) throw error;
      setWalletData(data);
      return data;
    } catch (error) {
      console.error('Error fetching wallet data:', error);
      return null;
    }
  };

  const fetchTransactions = async (providerId: number) => {
    try {
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

      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .select('*')
        .in('escrow_id', escrowIds)
        .order('processed_at', { ascending: false })
        .limit(20);

      if (transactionError) throw transactionError;

      const transactionsWithProvider = (transactionData || []).map(t => ({
        ...t,
        provider_id: providerId
      }));

      setTransactions(transactionsWithProvider);
      
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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

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

  const formatDate = (timestamp: string | null) => {
    if (!timestamp) return 'Pending';
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({
        inputRange: [0, 1],
        outputRange: [distance, 0],
      }),
    }],
  });

  const renderTransaction = ({ item }: { item: Transaction }) => {
    const isCompleted = item.status === 'completed' || item.status === 'Completed';
    const isPending = item.status === 'pending' || item.status === 'Pending';
    
    let statusColor = '#6B7280';
    let statusBg = '#F3F4F6';
    let statusIcon: any = 'time-outline';

    if (isCompleted) {
      statusColor = '#16A34A';
      statusBg = '#DCFCE7';
      statusIcon = 'checkmark-circle';
    } else if (isPending) {
      statusColor = '#D97706';
      statusBg = '#FEF3C7';
      statusIcon = 'time';
    } else {
      statusColor = '#DC2626';
      statusBg = '#FEE2E2';
      statusIcon = 'close-circle';
    }

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionLeft}>
          <View style={[styles.iconContainer, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={20} color={statusColor} />
          </View>
          <View style={styles.transactionDetails}>
            <Text style={styles.transactionTitle}>Transaction #{item.transaction_id}</Text>
            <Text style={styles.transactionSubtitle}>
              <Text style={{ color: statusColor, fontWeight: '600' }}>{item.status}</Text>
              {' • '}
              {formatDate(item.processed_at)}
            </Text>
            <View style={styles.paymentMethodRow}>
              <Ionicons name="card-outline" size={11} color="#9CA3AF" />
              <Text style={styles.transactionPayment}>
                {item.payment_method} • Fee: ₱{item.service_fee.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.transactionRight}>
          <Text style={[styles.transactionAmount, { color: isCompleted ? '#16A34A' : '#111827' }]}>
            {isCompleted ? '+' : ''}₱{item.total_amount.toFixed(2)}
          </Text>
          {item.penalty_fee && item.penalty_fee > 0 && (
            <Text style={styles.penaltyText}>-₱{item.penalty_fee.toFixed(2)} Penalty</Text>
          )}
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading earnings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Modern Header */}
      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.headerTitle}>My Earnings</Text>
      </Animated.View>

      <Animated.View style={[styles.mainContent, fadeUp(contentAnim, 20)]}>
        <FlatList
          data={transactions}
          keyExtractor={(item) => item.transaction_id.toString()}
          renderItem={renderTransaction}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} />}
          ListHeaderComponent={
            <>
              {/* Main Wallet Card */}
              <View style={styles.walletCard}>
                <View style={styles.walletHeader}>
                  <View style={styles.walletIconBox}>
                    <Ionicons name="wallet" size={20} color={ORANGE} />
                  </View>
                  <TouchableOpacity style={styles.withdrawBtn} activeOpacity={0.8} onPress={handleWithdraw}>
                    <Text style={styles.withdrawBtnText}>Cash Out</Text>
                    <View style={styles.gcashPill}>
                      <Text style={styles.gcashText}>GCash</Text>
                    </View>
                  </TouchableOpacity>
                </View>

                <View style={styles.balanceSection}>
                  <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
                  <Text style={styles.balanceAmount}>
                    <Text style={styles.currencySymbol}>₱</Text>
                    {walletData?.balance?.toFixed(2) || '0.00'}
                  </Text>
                </View>

                <View style={styles.statsDivider} />

                <View style={styles.statsRow}>
                  <View style={styles.statBox}>
                    <Text style={styles.statValue}>{totalJobs}</Text>
                    <Text style={styles.statLabel}>Completed Jobs</Text>
                  </View>
                  <View style={styles.verticalDivider} />
                  <View style={styles.statBox}>
                    <View style={styles.ratingRow}>
                      <Ionicons name="star" size={14} color="#F59E0B" />
                      <Text style={styles.statValue}>{averageRating > 0 ? averageRating.toFixed(1) : 'N/A'}</Text>
                    </View>
                    <Text style={styles.statLabel}>Average Rating</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Recent Transactions</Text>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="receipt-outline" size={36} color={ORANGE} />
              </View>
              <Text style={styles.emptyText}>No transactions yet</Text>
              <Text style={styles.emptySubText}>Your completed deliveries and payouts will appear here.</Text>
            </View>
          }
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '500',
  },
  
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  
  mainContent: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  walletCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  walletIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 8,
  },
  withdrawBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
  },
  gcashPill: {
    backgroundColor: '#0070F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gcashText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  
  balanceSection: {
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6B7280',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 40,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -1,
  },
  currencySymbol: {
    fontSize: 28,
    color: '#4B5563',
    marginRight: 2,
  },
  
  statsDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  verticalDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E5E7EB',
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#374151',
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  
  transactionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  iconContainer: {
    width: 42,
    height: 42,
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
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  transactionSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  paymentMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  transactionPayment: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  penaltyText: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '600',
    marginTop: 4,
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  emptySubText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
  },
});