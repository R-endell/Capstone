// src/modules/Dashboard/Provider/EarningsScreen.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Alert, ActivityIndicator, RefreshControl,
  Animated, Easing, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect } from '@react-navigation/native';

const ORANGE = '#FA7A25';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface EarningRow {
  // escrow_payments
  escrow_id: number;
  delivery_id: number;
  sender_id: number;
  escrow_status: string;
  emergency_frozen: boolean;
  amount: number;
  created_at: string;
  bc_escrow_tx_hash: string | null;

  // deliveries (joined)
  delivery_completed_at: string | null;
  delivery_accepted_at: string | null;

  // transactions (joined, may be null while pending)
  transaction_id: number | null;
  base_amount: number | null;
  service_fee: number | null;
  total_amount: number | null;
  penalty_fee: number | null;
  payment_method: string | null;
  transaction_status: string | null;
  processed_at: string | null;

  // derived
  display_status: 'earned' | 'pending' | 'frozen' | 'refunded';
  display_amount: number;
}

interface ProviderWallet {
  wallet_id?: number;
  provider_id: number;
  balance: number;
  gcash_number: string | null;
  bank_name: string | null;
  bank_acc_number: string | null;
  bank_acc_holder: string | null;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [walletData, setWalletData] = useState<ProviderWallet | null>(null);
  const [walletMissing, setWalletMissing] = useState(false);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);

  const [totalEarned, setTotalEarned] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [completedJobs, setCompletedJobs] = useState(0);
  const [averageRating, setAverageRating] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);

  const [detailRow, setDetailRow] = useState<EarningRow | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
    Animated.parallel([
      animate(headerAnim, 0),
      animate(contentAnim, 150),
    ]).start();
  }, [headerAnim, contentAnim]);

  /* ---------------------------------------------------------------- */
  /* Resolve provider id                                              */
  /* ---------------------------------------------------------------- */
  const getProviderId = async (): Promise<number | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: userData } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    return userData?.user_id ?? null;
  };

  /* ---------------------------------------------------------------- */
  /* Wallet                                                           */
  /* ---------------------------------------------------------------- */
  const fetchWallet = async (pid: number) => {
    const { data, error } = await supabase
      .from('provider_wallet')
      .select('*')
      .eq('provider_id', pid)
      .maybeSingle();

    if (error || !data) {
      setWalletData(null);
      setWalletMissing(true);
      return;
    }
    setWalletData(data as ProviderWallet);
    setWalletMissing(false);
  };

  /* ---------------------------------------------------------------- */
  /* Earnings                                                         */
  /* ---------------------------------------------------------------- */
  const fetchEarnings = async (pid: number) => {
    const { data: escrows, error: escrowErr } = await supabase
      .from('escrow_payments')
      .select(`
        escrow_id,
        delivery_id,
        sender_id,
        escrow_status,
        emergency_frozen,
        amount,
        created_at,
        bc_escrow_tx_hash,
        delivery:deliveries!escrow_payments_delivery_id_fkey (
          delivery_id,
          completed_at,
          accepted_at
        )
      `)
      .eq('provider_id', pid)
      .order('created_at', { ascending: false });

    if (escrowErr) {
      console.warn('[Earnings] escrow fetch failed', escrowErr.message);
      setEarnings([]);
      return;
    }

    if (!escrows || escrows.length === 0) {
      setEarnings([]);
      setTotalEarned(0);
      setTotalPending(0);
      setCompletedJobs(0);
      return;
    }

    const escrowIds = escrows.map((e: any) => e.escrow_id);

    const { data: txns, error: txnErr } = await supabase
      .from('transactions')
      .select('*')
      .in('escrow_id', escrowIds);

    if (txnErr) {
      console.warn('[Earnings] txn fetch failed', txnErr.message);
    }

    const txnByEscrow: Record<number, any> = {};
    (txns || []).forEach((t: any) => { txnByEscrow[t.escrow_id] = t; });

    const rows: EarningRow[] = escrows.map((e: any) => {
      const t = txnByEscrow[e.escrow_id];
      const delivery = e.delivery || {};

      const escrowStatusRaw = String(e.escrow_status || '').toLowerCase();
      const txnStatusRaw = String(t?.status || '').toLowerCase();
      const completedAt = delivery.completed_at || null;

      const isReleased =
        escrowStatusRaw === 'released' ||
        escrowStatusRaw === 'completed';

      let displayStatus: EarningRow['display_status'] = 'pending';
      if (e.emergency_frozen) {
        displayStatus = 'frozen';
      } else if (escrowStatusRaw === 'refunded') {
        displayStatus = 'refunded';
      } else if (isReleased || txnStatusRaw === 'completed') {
        displayStatus = 'earned';
      } else {
        displayStatus = 'pending';
      }

      const base = t?.base_amount != null ? Number(t.base_amount) : null;
      const escrowAmt = Number(e.amount || 0);
      const displayAmount = base != null ? base : escrowAmt;

      return {
        escrow_id: e.escrow_id,
        delivery_id: e.delivery_id,
        sender_id: e.sender_id,
        escrow_status: e.escrow_status,
        emergency_frozen: !!e.emergency_frozen,
        amount: escrowAmt,
        created_at: e.created_at,
        bc_escrow_tx_hash: e.bc_escrow_tx_hash ?? null,

        delivery_completed_at: completedAt,
        delivery_accepted_at: delivery.accepted_at ?? null,

        transaction_id: t?.transaction_id ?? null,
        base_amount: base,
        service_fee: t?.service_fee != null ? Number(t.service_fee) : null,
        total_amount: t?.total_amount != null ? Number(t.total_amount) : null,
        penalty_fee: t?.penalty_fee != null ? Number(t.penalty_fee) : null,
        payment_method: t?.payment_method ?? null,
        transaction_status: t?.status ?? null,
        processed_at: t?.processed_at ?? null,

        display_status: displayStatus,
        display_amount: displayAmount,
      };
    });

    setEarnings(rows);

    const earned = rows.filter(r => r.display_status === 'earned');
    const pending = rows.filter(r => r.display_status === 'pending');

    setTotalEarned(earned.reduce((s, r) => s + r.display_amount, 0));
    setTotalPending(pending.reduce((s, r) => s + r.display_amount, 0));
    setCompletedJobs(earned.length);
  };

  /* ---------------------------------------------------------------- */
  /* Ratings                                                          */
  /* ---------------------------------------------------------------- */
  const fetchAverageRating = async (pid: number) => {
    const { data } = await supabase
      .from('ratings_reviews')
      .select('rating')
      .eq('reviewee_id', pid);

    if (data && data.length > 0) {
      const total = data.reduce((s: number, r: any) => s + r.rating, 0);
      setAverageRating(Number((total / data.length).toFixed(1)));
      setRatingCount(data.length);
    } else {
      setAverageRating(0);
      setRatingCount(0);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Load everything                                                  */
  /* ---------------------------------------------------------------- */
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const pid = providerId || (await getProviderId());
      if (!pid) return;
      if (!providerId) setProviderId(pid);

      await Promise.all([
        fetchWallet(pid),
        fetchEarnings(pid),
        fetchAverageRating(pid),
      ]);
    } catch (e) {
      console.warn('[Earnings] loadData error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { loadData(); }, [providerId]));

  /* ---------------------------------------------------------------- */
  /* Realtime                                                         */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`earnings-${providerId}-${Date.now()}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'escrow_payments', filter: `provider_id=eq.${providerId}` },
        () => loadData(true))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'transactions' },
        () => loadData(true))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'provider_wallet', filter: `provider_id=eq.${providerId}` },
        () => loadData(true))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'deliveries' },
        () => loadData(true))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [providerId]);

  const onRefresh = () => { setRefreshing(true); loadData(true); };

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */
  const formatDate = (timestamp: string | null) => {
    if (!timestamp) return 'Pending';
    let raw = String(timestamp);
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
    const date = new Date(raw);
    if (isNaN(date.getTime())) return 'Pending';

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatFullDate = (timestamp: string | null) => {
    if (!timestamp) return '—';
    let raw = String(timestamp);
    if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  };

  const maskAccount = (num: string | null) => {
    if (!num) return null;
    const clean = num.replace(/\s/g, '');
    if (clean.length <= 4) return clean;
    return '•••• ' + clean.slice(-4);
  };

  const titleCase = (s: string | null | undefined) => {
    if (!s) return '—';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  /* ---------------------------------------------------------------- */
  /* Wallet card                                                      */
  /* ---------------------------------------------------------------- */
  const renderWalletCard = () => {
    const balance = Number(walletData?.balance || 0);
    const hasGcash = !!walletData?.gcash_number;
    const hasBank = !!(walletData?.bank_name && walletData?.bank_acc_number);

    return (
      <View style={styles.walletCard}>
        <View style={styles.walletHeader}>
          <View style={styles.walletIconBox}>
            <Ionicons name="wallet" size={20} color={ORANGE} />
          </View>
          <TouchableOpacity
            style={[styles.withdrawBtn, balance <= 0 && { opacity: 0.5 }]}
            activeOpacity={0.8}
            onPress={() => Alert.alert('Coming Soon', 'Cash-out will be enabled soon.')}
          >
            <Text style={styles.withdrawBtnText}>Cash Out</Text>
            <View style={styles.gcashPill}>
              <Text style={styles.gcashText}>Soon</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.balanceSection}>
          <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
          <Text style={styles.balanceAmount}>
            <Text style={styles.currencySymbol}>₱</Text>
            {balance.toFixed(2)}
          </Text>
          {totalPending > 0 && (
            <View style={styles.pendingRow}>
              <Ionicons name="time-outline" size={12} color="#D97706" />
              <Text style={styles.pendingText}>₱{totalPending.toFixed(2)} pending release</Text>
            </View>
          )}
        </View>

        {walletMissing && (
          <View style={styles.walletMissingBox}>
            <Ionicons name="alert-circle-outline" size={16} color="#D97706" />
            <Text style={styles.walletMissingText}>
              Wallet not initialized yet. Complete a delivery or contact support to activate.
            </Text>
          </View>
        )}

        {!walletMissing && (
          <>
            <View style={styles.statsDivider} />
            <View style={styles.payoutSection}>
              <Text style={styles.payoutHeading}>PAYOUT DESTINATIONS</Text>

              <View style={styles.payoutRow}>
                <View style={styles.payoutIconWrap}>
                  <Ionicons name="phone-portrait-outline" size={14} color="#0070F0" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payoutLabel}>GCash</Text>
                  <Text style={styles.payoutValue}>{hasGcash ? walletData!.gcash_number : 'Not set'}</Text>
                </View>
                <View style={[styles.payoutBadge, hasGcash ? styles.payoutBadgeOn : styles.payoutBadgeOff]}>
                  <Text style={[styles.payoutBadgeText, hasGcash ? { color: '#16A34A' } : { color: '#9CA3AF' }]}>
                    {hasGcash ? 'Linked' : 'Missing'}
                  </Text>
                </View>
              </View>

              <View style={styles.payoutRow}>
                <View style={styles.payoutIconWrap}>
                  <Ionicons name="business-outline" size={14} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payoutLabel}>{walletData?.bank_name || 'Bank account'}</Text>
                  <Text style={styles.payoutValue}>
                    {hasBank
                      ? `${maskAccount(walletData!.bank_acc_number)} · ${walletData!.bank_acc_holder || ''}`
                      : 'Not set'}
                  </Text>
                </View>
                <View style={[styles.payoutBadge, hasBank ? styles.payoutBadgeOn : styles.payoutBadgeOff]}>
                  <Text style={[styles.payoutBadgeText, hasBank ? { color: '#16A34A' } : { color: '#9CA3AF' }]}>
                    {hasBank ? 'Linked' : 'Missing'}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        <View style={styles.statsDivider} />
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{completedJobs}</Text>
            <Text style={styles.statLabel}>Completed Jobs</Text>
          </View>
          <View style={styles.verticalDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue} numberOfLines={1}>
              ₱{totalEarned.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </Text>
            <Text style={styles.statLabel}>Total Earned</Text>
          </View>
          <View style={styles.verticalDivider} />
          <View style={styles.statBox}>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={styles.statValue}>
                {averageRating > 0 ? averageRating.toFixed(1) : 'N/A'}
              </Text>
            </View>
            <Text style={styles.statLabel}>
              {ratingCount > 0 ? `${ratingCount} ratings` : 'No ratings yet'}
            </Text>
          </View>
        </View>

        {!!walletData?.updated_at && (
          <Text style={styles.walletUpdated}>
            Wallet updated {formatDate(walletData.updated_at)}
          </Text>
        )}
      </View>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Row renderer                                                     */
  /* ---------------------------------------------------------------- */
  const renderEarning = ({ item }: { item: EarningRow }) => {
    const isEarned = item.display_status === 'earned';
    const isPending = item.display_status === 'pending';
    const isFrozen = item.display_status === 'frozen';
    const isRefunded = item.display_status === 'refunded';

    let statusColor = '#D97706';
    let statusBg = '#FEF3C7';
    let statusIcon: any = 'time';
    let statusLabel = 'Pending payout';

    if (isEarned) {
      statusColor = '#16A34A';
      statusBg = '#DCFCE7';
      statusIcon = 'checkmark-circle';
      statusLabel = 'Earned';
    } else if (isFrozen) {
      statusColor = '#DC2626';
      statusBg = '#FEE2E2';
      statusIcon = 'snow';
      statusLabel = 'Frozen';
    } else if (isRefunded) {
      statusColor = '#6B7280';
      statusBg = '#F3F4F6';
      statusIcon = 'arrow-undo';
      statusLabel = 'Refunded';
    } else if (isPending) {
      statusLabel = item.delivery_completed_at ? 'Awaiting escrow release' : 'In escrow';
    }

    const stamp = item.processed_at || item.delivery_completed_at || item.created_at;

    return (
      <TouchableOpacity
        style={styles.transactionCard}
        activeOpacity={0.85}
        onPress={() => setDetailRow(item)}
      >
        <View style={styles.transactionLeft}>
          <View style={[styles.iconContainer, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={20} color={statusColor} />
          </View>
          <View style={styles.transactionDetails}>
            <Text style={styles.transactionTitle}>Delivery #{item.delivery_id}</Text>
            <Text style={styles.transactionSubtitle}>
              <Text style={{ color: statusColor, fontWeight: '700' }}>{statusLabel}</Text>
              {' • '}
              {formatDate(stamp)}
            </Text>
            <View style={styles.paymentMethodRow}>
              <Ionicons name="card-outline" size={11} color="#9CA3AF" />
              <Text style={styles.transactionPayment}>
                {item.payment_method ? titleCase(item.payment_method) : 'Payment method pending'}
                {item.service_fee != null ? ` • Fee ₱${item.service_fee.toFixed(2)}` : ''}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.transactionRight}>
          <Text
            style={[
              styles.transactionAmount,
              { color: isEarned ? '#16A34A' : isRefunded ? '#6B7280' : '#111827' },
              isRefunded && { textDecorationLine: 'line-through' },
            ]}
          >
            {isEarned ? '+' : ''}₱{item.display_amount.toFixed(2)}
          </Text>
          {!!item.penalty_fee && item.penalty_fee > 0 && (
            <Text style={styles.penaltyText}>-₱{item.penalty_fee.toFixed(2)} Penalty</Text>
          )}
          <Ionicons
            name="chevron-forward"
            size={14}
            color="#D1D5DB"
            style={{ marginTop: 6 }}
          />
        </View>
      </TouchableOpacity>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Detail modal — full transaction row                              */
  /* ---------------------------------------------------------------- */
  const renderDetailModal = () => {
    const r = detailRow;
    if (!r) return null;

    const isEarned = r.display_status === 'earned';
    const isPending = r.display_status === 'pending';
    const isFrozen = r.display_status === 'frozen';
    const isRefunded = r.display_status === 'refunded';

    let headColor = '#D97706';
    let headBg = '#FEF3C7';
    let headIcon: any = 'time';
    let headLabel = 'Pending payout';

    if (isEarned) {
      headColor = '#16A34A';
      headBg = '#DCFCE7';
      headIcon = 'checkmark-circle';
      headLabel = 'Earned';
    } else if (isFrozen) {
      headColor = '#DC2626';
      headBg = '#FEE2E2';
      headIcon = 'snow';
      headLabel = 'Frozen (emergency)';
    } else if (isRefunded) {
      headColor = '#6B7280';
      headBg = '#F3F4F6';
      headIcon = 'arrow-undo';
      headLabel = 'Refunded to sender';
    } else if (isPending) {
      headLabel = r.delivery_completed_at ? 'Awaiting escrow release' : 'In escrow';
    }

    const fare        = Number(r.total_amount ?? r.amount ?? 0);
    const baseAmount  = r.base_amount  != null ? Number(r.base_amount)  : null;
    const serviceFee  = r.service_fee  != null ? Number(r.service_fee)  : null;
    const penaltyFee  = r.penalty_fee  != null ? Number(r.penalty_fee)  : 0;

    return (
      <Modal
        visible={!!detailRow}
        transparent
        animationType="slide"
        onRequestClose={() => setDetailRow(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transaction Details</Text>
              <TouchableOpacity onPress={() => setDetailRow(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
            >
              {/* Hero */}
              <View style={[styles.heroBox, { backgroundColor: headBg }]}>
                <View style={[styles.heroIcon, { backgroundColor: '#FFFFFF' }]}>
                  <Ionicons name={headIcon} size={26} color={headColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heroStatus, { color: headColor }]}>{headLabel}</Text>
                  <Text style={styles.heroSub}>Delivery #{r.delivery_id}</Text>
                </View>
                <Text style={[styles.heroAmount, { color: headColor }]}>
                  {isEarned ? '+' : ''}₱{r.display_amount.toFixed(2)}
                </Text>
              </View>

              {/* TRANSACTION */}
              <Text style={styles.sectionLabel}>TRANSACTION</Text>

              <InfoRow
                label="Transaction ID"
                value={r.transaction_id != null ? `#${r.transaction_id}` : 'Not created yet'}
              />
              <InfoRow label="Status" value={titleCase(r.transaction_status) || '—'} />
              <InfoRow
                label="Payment method"
                value={r.payment_method ? titleCase(r.payment_method) : '—'}
              />
              <InfoRow label="Processed at" value={formatFullDate(r.processed_at)} last />

              {/* BREAKDOWN */}
              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>BREAKDOWN</Text>

              <BreakdownRow
                label="Total delivery fare"
                value={fare}
                muted={!isEarned}
              />
              <BreakdownRow
                label="Platform service fee"
                value={serviceFee != null ? -serviceFee : null}
                negative
              />
              <BreakdownRow
                label="Penalty fee"
                value={penaltyFee > 0 ? -penaltyFee : 0}
                negative={penaltyFee > 0}
              />

              <View style={styles.breakdownDivider} />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>
                  {isEarned ? 'You earned (base amount)' : 'Expected payout'}
                </Text>
                <Text style={[
                  styles.totalValue,
                  { color: isEarned ? '#16A34A' : '#111827' },
                ]}>
                  {isEarned ? '+' : ''}₱
                  {(baseAmount != null ? baseAmount : r.display_amount).toFixed(2)}
                </Text>
              </View>

              {/* ESCROW */}
              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>ESCROW</Text>

              <InfoRow label="Escrow ID" value={`#${r.escrow_id}`} />
              <InfoRow label="Escrow status" value={titleCase(r.escrow_status)} />
              <InfoRow label="Escrow amount" value={`₱${Number(r.amount || 0).toFixed(2)}`} />
              <InfoRow
                label="Emergency frozen"
                value={r.emergency_frozen ? 'Yes' : 'No'}
                valueColor={r.emergency_frozen ? '#DC2626' : undefined}
              />
              <InfoRow label="Funded at" value={formatFullDate(r.created_at)} last />

              {/* DELIVERY */}
              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>DELIVERY</Text>

              <InfoRow label="Delivery ID" value={`#${r.delivery_id}`} />
              <InfoRow label="Sender ID" value={`#${r.sender_id}`} />
              <InfoRow label="Accepted at" value={formatFullDate(r.delivery_accepted_at)} />
              <InfoRow label="Completed at" value={formatFullDate(r.delivery_completed_at)} last />

              {/* BLOCKCHAIN */}
              {(r.bc_escrow_tx_hash) && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>BLOCKCHAIN</Text>
                  <View style={styles.hashBox}>
                    <Ionicons name="cube-outline" size={14} color="#6B7280" />
                    <Text style={styles.hashText} numberOfLines={2}>
                      {r.bc_escrow_tx_hash}
                    </Text>
                  </View>
                </>
              )}

              {/* Notes */}
              {isPending && (
                <View style={styles.noteBox}>
                  <Ionicons name="information-circle-outline" size={14} color="#92400E" />
                  <Text style={styles.noteText}>
                    Still held in escrow. This will release automatically once
                    the delivery is confirmed.
                  </Text>
                </View>
              )}
              {isFrozen && (
                <View style={[styles.noteBox, { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }]}>
                  <Ionicons name="snow" size={14} color="#991B1B" />
                  <Text style={[styles.noteText, { color: '#991B1B' }]}>
                    This transaction is frozen due to an open issue.
                  </Text>
                </View>
              )}
              {isRefunded && (
                <View style={[styles.noteBox, { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' }]}>
                  <Ionicons name="arrow-undo" size={14} color="#4B5563" />
                  <Text style={[styles.noteText, { color: '#4B5563' }]}>
                    This delivery was refunded to the sender. No earnings were credited.
                  </Text>
                </View>
              )}
            </ScrollView>

            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setDetailRow(null)}
              activeOpacity={0.9}
            >
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  /* ---------------------------------------------------------------- */
  /* Loading / Render                                                 */
  /* ---------------------------------------------------------------- */
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

      <Animated.View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 16) + 12 },
          fadeUp(headerAnim, -14),
        ]}
      >
        <Text style={styles.headerTitle}>My Earnings</Text>
      </Animated.View>

      <Animated.View style={[styles.mainContent, fadeUp(contentAnim, 20)]}>
        <FlatList
          data={earnings}
          keyExtractor={(item) => item.escrow_id.toString()}
          renderItem={renderEarning}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ORANGE} />
          }
          ListHeaderComponent={
            <>
              {renderWalletCard()}
              <Text style={styles.sectionTitle}>Earnings History</Text>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="receipt-outline" size={36} color={ORANGE} />
              </View>
              <Text style={styles.emptyText}>No earnings yet</Text>
              <Text style={styles.emptySubText}>
                Once you complete a delivery and the escrow is released,
                your earnings will show up here.
              </Text>
            </View>
          }
        />
      </Animated.View>

      {renderDetailModal()}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Small row components                                                */
/* ------------------------------------------------------------------ */
const InfoRow: React.FC<{
  label: string;
  value: string;
  valueColor?: string;
  last?: boolean;
}> = ({ label, value, valueColor, last }) => (
  <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text
      style={[styles.infoValue, valueColor ? { color: valueColor } : null]}
      numberOfLines={2}
    >
      {value}
    </Text>
  </View>
);

const BreakdownRow: React.FC<{
  label: string;
  value: number | null;
  negative?: boolean;
  muted?: boolean;
}> = ({ label, value, negative, muted }) => {
  const display =
    value == null
      ? '—'
      : `${negative && value > 0 ? '−' : ''}₱${Math.abs(value).toFixed(2)}`;

  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text
        style={[
          styles.breakdownValue,
          muted && { color: '#9CA3AF' },
          negative && value != null && value > 0 && { color: '#DC2626' },
        ]}
      >
        {display}
      </Text>
    </View>
  );
};

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: { marginTop: 12, color: '#6B7280', fontSize: 14, fontWeight: '500' },

  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },

  mainContent: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  /* wallet card */
  walletCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20, padding: 20, marginBottom: 28,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06, shadowRadius: 14, elevation: 3,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  walletHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  walletIconBox: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center',
  },
  withdrawBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F9FAFB',
    paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', gap: 8,
  },
  withdrawBtnText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  gcashPill: {
    backgroundColor: '#0070F0',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  gcashText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  balanceSection: { marginBottom: 4 },
  balanceLabel: {
    fontSize: 11, fontWeight: '800', color: '#6B7280',
    letterSpacing: 0.8, marginBottom: 4,
  },
  balanceAmount: { fontSize: 40, fontWeight: '800', color: '#111827', letterSpacing: -1 },
  currencySymbol: { fontSize: 28, color: '#4B5563', marginRight: 2 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  pendingText: { fontSize: 12, color: '#D97706', fontWeight: '700' },

  walletMissingBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 12, padding: 12, marginTop: 12,
  },
  walletMissingText: { flex: 1, fontSize: 12, color: '#92400E', fontWeight: '600', lineHeight: 16 },

  statsDivider: { height: 1, backgroundColor: '#F3F4F6', marginTop: 16, marginBottom: 14 },

  payoutSection: { marginTop: 2 },
  payoutHeading: {
    fontSize: 10, fontWeight: '800', color: '#9CA3AF',
    letterSpacing: 1, marginBottom: 10,
  },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  payoutIconWrap: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },
  payoutLabel: { fontSize: 12, fontWeight: '700', color: '#111827' },
  payoutValue: { fontSize: 11, color: '#6B7280', marginTop: 1, fontWeight: '500' },
  payoutBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  payoutBadgeOn: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  payoutBadgeOff: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  payoutBadgeText: { fontSize: 10, fontWeight: '800' },

  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statBox: { alignItems: 'center', flex: 1, paddingHorizontal: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 2 },
  statLabel: { fontSize: 11, color: '#6B7280', fontWeight: '500', textAlign: 'center' },
  verticalDivider: { width: 1, height: 24, backgroundColor: '#E5E7EB' },
  walletUpdated: {
    fontSize: 10, color: '#9CA3AF', textAlign: 'center',
    marginTop: 14, fontStyle: 'italic',
  },

  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: '#374151',
    marginBottom: 14, letterSpacing: -0.2,
  },

  /* transaction row */
  transactionCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  transactionLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  iconContainer: {
    width: 42, height: 42, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  transactionDetails: { flex: 1, justifyContent: 'center' },
  transactionTitle: {
    fontSize: 14, fontWeight: '700', color: '#111827',
    marginBottom: 2, letterSpacing: -0.2,
  },
  transactionSubtitle: { fontSize: 12, color: '#6B7280' },
  paymentMethodRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 },
  transactionPayment: { fontSize: 11, color: '#6B7280', fontWeight: '500' },
  transactionRight: { alignItems: 'flex-end' },
  transactionAmount: { fontSize: 16, fontWeight: '800', letterSpacing: -0.5 },
  penaltyText: { fontSize: 11, color: '#EF4444', fontWeight: '600', marginTop: 4 },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyIconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
    borderWidth: 1, borderColor: '#FFE4D2',
  },
  emptyText: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 6 },
  emptySubText: {
    fontSize: 13, color: '#6B7280', textAlign: 'center',
    lineHeight: 18, paddingHorizontal: 20,
  },

  /* modal */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 18,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },

  heroBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 16, padding: 14, marginBottom: 20,
  },
  heroIcon: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
  },
  heroStatus: { fontSize: 15, fontWeight: '800' },
  heroSub: { fontSize: 12, color: '#4B5563', marginTop: 2, fontWeight: '600' },
  heroAmount: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: '#9CA3AF',
    letterSpacing: 1, marginBottom: 8,
  },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 12,
  },
  infoLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  infoValue: {
    flexShrink: 1, fontSize: 12, color: '#111827',
    fontWeight: '800', textAlign: 'right',
  },

  breakdownRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 8,
  },
  breakdownLabel: { fontSize: 13, color: '#4B5563', fontWeight: '600' },
  breakdownValue: { fontSize: 14, fontWeight: '800', color: '#111827' },
  breakdownDivider: {
    height: 1, backgroundColor: '#E5E7EB',
    marginTop: 10, marginBottom: 12,
  },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginTop: 2,
  },
  totalLabel: { fontSize: 13, color: '#374151', fontWeight: '800' },
  totalValue: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },

  hashBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#F9FAFB', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 12, padding: 12,
  },
  hashText: {
    flex: 1, fontSize: 11, color: '#4B5563',
    fontFamily: 'monospace' as any, fontWeight: '600',
  },

  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FDE68A',
    borderRadius: 12, padding: 12, marginTop: 16,
  },
  noteText: { flex: 1, fontSize: 11, color: '#92400E', fontWeight: '600', lineHeight: 16 },

  modalDoneBtn: {
    marginTop: 16,
    backgroundColor: '#111827', borderRadius: 14,
    paddingVertical: 15, alignItems: 'center',
  },
  modalDoneBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});