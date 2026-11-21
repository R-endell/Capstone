// src/modules/Dashboard/Provider/EarningsScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  StatusBar, Alert, ActivityIndicator, RefreshControl,
  Animated, Easing, Modal, ScrollView, Image, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../utils/supabase';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';
import { ProviderWallet, WithdrawalRequest } from '../../../types/payment';
import { fetchWithdrawalHistory, reconcileWithdrawalStatus, isSavedWalletNumberValid } from '../../../services/withdrawalService';

let Clipboard: any = null;
try { Clipboard = require('expo-clipboard'); } catch { Clipboard = null; }

const EMPTY_BOX_ICON = require('../../../../assets/empty-box-icon.png');
const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.png');

interface EarningRow {
  escrow_id: number;
  delivery_id: number;
  sender_id: number;
  escrow_status: string;
  emergency_frozen: boolean;
  amount: number;
  created_at: string;
  bc_escrow_tx_hash: string | null;
  bc_tx_hash: string | null;
  delivery_completed_at: string | null;
  delivery_accepted_at: string | null;
  transaction_id: number | null;
  base_amount: number | null;
  service_fee: number | null;
  total_amount: number | null;
  penalty_fee: number | null;
  payment_method: string | null;
  transaction_status: string | null;
  processed_at: string | null;
  display_status: 'earned' | 'pending' | 'frozen' | 'refunded';
  display_amount: number;
  base_fare: number | null;      // gross delivery fare before the platform fee
  return_deposit: number;        // sender's Return-to-Sender deposit
  is_returned: boolean;          // package went back to the sender (provider keeps the deposit)
  fallback_action: string | null;   // 'return_to_sender' (Option A) | 'leave_with_guard' (Option B)
  refund_status: string | null;     // state of the deposit refund to the sender
}

/* ------------------------------------------------------------------ */
/* 24-hour cash-out hold: an earning is only cashable 24h after the    */
/* delivery was completed.                                             */
/* ------------------------------------------------------------------ */
const CASHOUT_HOLD_MS = 24 * 60 * 60 * 1000;

const toMs = (ts: string | null | undefined): number | null => {
  if (!ts) return null;
  let raw = String(ts);
  // Naive DB timestamps are stored in UTC.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
  const ms = new Date(raw).getTime();
  return isNaN(ms) ? null : ms;
};

/** When this earning becomes cashable (ms epoch), or null if it is not an earned row. */
const cashableAtOf = (r: EarningRow): number | null => {
  if (r.display_status !== 'earned') return null;
  const base = toMs(r.delivery_completed_at) ?? toMs(r.processed_at) ?? toMs(r.created_at);
  return base == null ? null : base + CASHOUT_HOLD_MS;
};

const formatCountdown = (ms: number): string => {
  const totalMins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

export default function EarningsScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reconcilingId, setReconcilingId] = useState<number | null>(null);

  const [walletData, setWalletData] = useState<ProviderWallet | null>(null);
  const [walletMissing, setWalletMissing] = useState(false);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [historyTab, setHistoryTab] = useState<'earnings' | 'withdrawals'>('earnings');
  const [providerId, setProviderId] = useState<number | null>(null);

  const [totalEarned, setTotalEarned] = useState(0);
  const [totalPending, setTotalPending] = useState(0);
  const [completedJobs, setCompletedJobs] = useState(0);

  // Ticks every minute so held earnings unlock on screen without a manual refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const [detailRow, setDetailRow] = useState<EarningRow | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [wdHashes, setWdHashes] = useState<Record<number, string>>({});
  const copyHashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyHash = async (key: string, value?: string | null) => {
    if (!value) return;
    try {
      if (Clipboard?.setStringAsync) {
        await Clipboard.setStringAsync(value);
        setCopiedHash(key);
        if (copyHashTimerRef.current) clearTimeout(copyHashTimerRef.current);
        copyHashTimerRef.current = setTimeout(() => setCopiedHash(null), 1800);
      } else {
        await Share.share({ message: value });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    return () => {
      if (copyHashTimerRef.current) clearTimeout(copyHashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const ids = withdrawals.map((w) => Number(w.withdrawal_id)).filter(Boolean);
    if (ids.length === 0) { setWdHashes({}); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('withdrawal_requests').select('withdrawal_id, bc_tx_hash').in('withdrawal_id', ids);
      if (cancelled) return;
      const map: Record<number, string> = {};
      (data || []).forEach((r: any) => { if (r.bc_tx_hash) map[Number(r.withdrawal_id)] = r.bc_tx_hash; });
      setWdHashes(map);
    })();
    return () => { cancelled = true; };
  }, [withdrawals]);

  const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalRequest | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([animate(headerAnim, 0), animate(contentAnim, 150)]).start();
  }, [headerAnim, contentAnim]);

  const getProviderId = async (): Promise<number | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: userData } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
    return userData?.user_id ?? null;
  };

  const fetchWalletAndWithdrawals = async (pid: number) => {
    const { data, error } = await supabase.from('provider_wallet').select('*').eq('provider_id', pid).maybeSingle();
    if (error || !data) { setWalletData(null); setWalletMissing(true); setWithdrawals([]); return; }
    const typedWallet = data as ProviderWallet;
    setWalletData(typedWallet);
    setWalletMissing(false);
    try {
      const wdList = await fetchWithdrawalHistory(typedWallet.wallet_id);
      setWithdrawals(wdList);
    } catch (e) {
      console.warn('[Earnings] fetchWithdrawalHistory warning:', e);
    }
  };

  const fetchEarnings = async (pid: number) => {
    const { data: escrows, error: escrowErr } = await supabase
      .from('escrow_payments')
      .select(`
        escrow_id, delivery_id, sender_id, escrow_status, emergency_frozen, amount, created_at, bc_escrow_tx_hash,
        delivery:deliveries!escrow_payments_delivery_id_fkey (
          delivery_id, completed_at, accepted_at,
          delivery_requests!deliveries_request_id_fkey (
            request_id, base_fare, return_deposit, delivery_status,
            fallback_action, refund_status, payment_provider
          )
        )
      `)
      .eq('provider_id', pid).order('created_at', { ascending: false });

    if (escrowErr) { setEarnings([]); return; }
    if (!escrows || escrows.length === 0) {
      setEarnings([]);
      setTotalEarned(0);
      setTotalPending(0);
      setCompletedJobs(0);
      return;
    }

    const escrowIds = escrows.map((e: any) => e.escrow_id);
    const { data: txns } = await supabase.from('transactions').select('*').in('escrow_id', escrowIds);
    const txnByEscrow: Record<number, any> = {};
    (txns || []).forEach((t: any) => { txnByEscrow[t.escrow_id] = t; });

    const rows: EarningRow[] = escrows.map((e: any) => {
      const t = txnByEscrow[e.escrow_id];
      const delivery = e.delivery || {};
      const escrowStatusRaw = String(e.escrow_status || '').toLowerCase();
      const txnStatusRaw = String(t?.status || '').toLowerCase();
      const completedAt = delivery.completed_at || null;
      const isReleased = escrowStatusRaw === 'released' || escrowStatusRaw === 'completed';

      let displayStatus: EarningRow['display_status'] = 'pending';
      if (e.emergency_frozen) displayStatus = 'frozen';
      else if (escrowStatusRaw === 'refunded') displayStatus = 'refunded';
      else if (isReleased || txnStatusRaw === 'completed') displayStatus = 'earned';

      const request = Array.isArray(delivery?.delivery_requests)
        ? delivery.delivery_requests[0]
        : delivery?.delivery_requests;
      const requestStatus = String(request?.delivery_status || '').toLowerCase();
      const baseFare = request?.base_fare != null ? Number(request.base_fare) : 0;
      const deposit = request?.return_deposit != null ? Number(request.return_deposit) : 0;
      const escrowAmt = Number(e.amount || 0);

      // Platform fee = 15% of the delivery fare (the return deposit is never charged a fee)
      const isReturned = requestStatus === 'returned';
      const platformFee = baseFare > 0 ? Math.round(baseFare * 0.15 * 100) / 100 : null;
      const netBase = baseFare > 0 ? Math.round((baseFare - (platformFee || 0)) * 100) / 100 : 0;
      let courierAmount: number;
      if (isReleased) {
        courierAmount = isReturned
          ? (netBase + deposit || escrowAmt)
          : (netBase || escrowAmt);
      } else {
        // not released yet: show what the courier will actually receive, not the sender's full escrow
        courierAmount = netBase > 0 ? (isReturned ? netBase + deposit : netBase) : escrowAmt;
      }

      return {
        escrow_id: e.escrow_id,
        delivery_id: e.delivery_id,
        sender_id: e.sender_id,
        escrow_status: e.escrow_status,
        emergency_frozen: !!e.emergency_frozen,
        amount: escrowAmt,
        created_at: e.created_at,
        bc_escrow_tx_hash: e.bc_escrow_tx_hash ?? null,
        bc_tx_hash: t?.bc_tx_hash ?? null,
        delivery_completed_at: completedAt,
        delivery_accepted_at: delivery.accepted_at ?? null,
        transaction_id: t?.transaction_id ?? null,
        base_amount: courierAmount,
        service_fee: platformFee,
        total_amount: courierAmount,
        penalty_fee: t?.penalty_fee != null ? Number(t.penalty_fee) : null,
        payment_method: t?.payment_method ?? request?.payment_provider ?? null,
        transaction_status: t?.status ?? null,
        processed_at: t?.processed_at ?? null,
        display_status: displayStatus,
        display_amount: courierAmount,
        base_fare: baseFare > 0 ? baseFare : null,
        return_deposit: deposit,
        is_returned: isReturned,
        fallback_action: request?.fallback_action ?? null,
        refund_status: request?.refund_status ?? null,
      };
    });

    setEarnings(rows);
    const earned = rows.filter(r => r.display_status === 'earned');
    const pending = rows.filter(r => r.display_status === 'pending');
    setTotalEarned(earned.reduce((s, r) => s + r.display_amount, 0));
    setTotalPending(pending.reduce((s, r) => s + r.display_amount, 0));
    setCompletedJobs(earned.length);
  };

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const pid = providerId || (await getProviderId());
      if (!pid) return;
      if (!providerId) setProviderId(pid);
      await Promise.all([fetchWalletAndWithdrawals(pid), fetchEarnings(pid)]);
    } catch (e) {
      console.warn('[Earnings] loadData error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { loadData(); }, [providerId]));

  useEffect(() => {
    const params = route.params || {};
    if (params.initialTab === 'withdrawals' || params.highlightWithdrawalId) {
      setHistoryTab('withdrawals');
    }
    if (params.highlightWithdrawalId && withdrawals.length > 0) {
      const match = withdrawals.find(
        (w) => Number(w.withdrawal_id) === Number(params.highlightWithdrawalId),
      );
      if (match) {
        setSelectedWithdrawal(match);
        navigation.setParams({ highlightWithdrawalId: undefined });
      }
    }
  }, [route.params, withdrawals, navigation]);

  useEffect(() => {
    if (!providerId) return;
    const channel = supabase
      .channel(`earnings-${providerId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'escrow_payments', filter: `provider_id=eq.${providerId}` }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'provider_wallet', filter: `provider_id=eq.${providerId}` }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawal_requests' }, () => loadData(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => loadData(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [providerId]);

  const onRefresh = () => { setRefreshing(true); loadData(true); };

  const handleReconcile = async (withdrawalId: number) => {
    setReconcilingId(withdrawalId);
    try {
      const updated = await reconcileWithdrawalStatus(withdrawalId);
      await loadData(true);
      if (updated && selectedWithdrawal?.withdrawal_id === withdrawalId) {
        setSelectedWithdrawal({ ...updated, amount: Number(updated.amount || selectedWithdrawal.amount) });
      }
    } catch (err: any) {
      Alert.alert('Status Check', err?.message || 'Could not refresh payout status.');
    } finally {
      setReconcilingId(null);
    }
  };

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

  const maskAccount = (num: string | null | undefined) => {
    if (!num) return null;
    const clean = num.replace(/\s/g, '');
    if (clean.length <= 4) return clean;
    return '•••• ' + clean.slice(-4);
  };

  const titleCase = (s: string | null | undefined) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '—';

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const activeWithdrawalsTotal = withdrawals
    .filter((w) => ['Pending', 'Processing', 'Pending_Compliance'].includes(w.status))
    .reduce((sum, w) => sum + Number(w.amount || 0), 0);

  const renderWalletCard = () => {
    const balance = Number(walletData?.balance || 0);

    // Earnings completed less than 24h ago are still on hold and cannot be cashed out.
    const heldRows = earnings.filter((r) => {
      const at = cashableAtOf(r);
      return at != null && at > nowMs;
    });
    const lockedAmount = Math.round(heldRows.reduce((s, r) => s + r.display_amount, 0) * 100) / 100;
    const cashableBalance = Math.max(0, Math.round((balance - lockedAmount) * 100) / 100);
    const nextUnlockAt = heldRows.reduce<number | null>((min, r) => {
      const at = cashableAtOf(r)!;
      return min == null || at < min ? at : min;
    }, null);

    const openCashout = () => {
      if (walletMissing) {
        Alert.alert('Wallet Not Ready', 'Complete a delivery first to initialize your wallet.');
        return;
      }
      if (cashableBalance <= 0) {
        Alert.alert(
          'Earnings on hold',
          lockedAmount > 0 && nextUnlockAt != null
            ? `Earnings can be cashed out 24 hours after the delivery is completed.\n\n₱${lockedAmount.toFixed(2)} unlocks in ${formatCountdown(nextUnlockAt - nowMs)}.`
            : 'You have no cashable balance yet.',
        );
        return;
      }
      navigation.navigate('Cashout', { providerId, cashableBalance, lockedAmount });
    };

    const hasGcash = isSavedWalletNumberValid(walletData?.gcash_number);
    const hasMaya = isSavedWalletNumberValid(walletData?.maya_number);

    return (
      <View style={styles.walletCard}>
        {/* Top Row: Balance + Cash Out Action */}
        <View style={styles.walletTopRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.balanceHeaderRow}>
              <View style={styles.walletIconBox}>
                <SolarIcon name="Wallet" variant="duotone" size={18} color={colors.accent} />
              </View>
              <Text style={styles.balanceLabel}>CASHABLE BALANCE</Text>
            </View>
            <Text style={styles.balanceAmount} numberOfLines={1} adjustsFontSizeToFit>
              <Text style={styles.currencySymbol}>₱</Text>
              {cashableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.withdrawBtn}
            activeOpacity={0.85}
            onPress={openCashout}
          >
            <SolarIcon name="AltArrowUp" variant="bold" size={16} color="#FFFFFF" />
            <Text style={styles.withdrawBtnText}>Cash Out</Text>
          </TouchableOpacity>
        </View>

        {/* Status Pills (Pending Escrow / Payout in Progress) */}
        {(totalPending > 0 || activeWithdrawalsTotal > 0 || lockedAmount > 0) && (
          <View style={styles.walletStatusList}>
            {totalPending > 0 && (
              <View style={styles.pendingPill}>
                <SolarIcon name="Clock" variant="bold" size={13} color={colors.warning} />
                <Text style={styles.pendingText}>
                  ₱{totalPending.toFixed(2)} held in escrow
                </Text>
              </View>
            )}
            {lockedAmount > 0 && nextUnlockAt != null && (
              <View style={styles.pendingPill}>
                <SolarIcon name="Clock" variant="bold" size={13} color={colors.warning} />
                <Text style={styles.pendingText}>
                  ₱{lockedAmount.toFixed(2)} on hold · next unlock in {formatCountdown(nextUnlockAt - nowMs)}
                </Text>
              </View>
            )}
            {activeWithdrawalsTotal > 0 && (
              <View style={[styles.pendingPill, { backgroundColor: colors.accentSoft }]}>
                <SolarIcon name="Refresh" variant="bold" size={13} color={colors.accent} />
                <Text style={[styles.pendingText, { color: colors.accent }]}>
                  ₱{activeWithdrawalsTotal.toFixed(2)} cashout processing
                </Text>
              </View>
            )}
          </View>
        )}

        {walletMissing && (
          <View style={styles.walletMissingBox}>
            <SolarIcon name="DangerCircle" variant="linear" size={16} color={colors.warning} secondaryColor={colors.warning} />
            <Text style={styles.walletMissingText}>
              Wallet not initialized yet. Complete a delivery to activate payouts.
            </Text>
          </View>
        )}

        {/* Compact 2-Column Payout Destinations */}
        {!walletMissing && (
          <>
            <View style={styles.statsDivider} />
            <Text style={styles.payoutHeading}>PAYOUT ACCOUNTS</Text>
            <View style={styles.payoutGrid}>
              <TouchableOpacity
                style={styles.payoutTile}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Cashout', { providerId, cashableBalance, lockedAmount })}
              >
                <View style={styles.payoutLogoBox}>
                  <Image source={GCASH_LOGO} style={{ width: 20, height: 20 }} resizeMode="contain" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.payoutLabel}>GCash</Text>
                  <Text style={styles.payoutValue} numberOfLines={1}>
                    {hasGcash ? maskAccount(walletData!.gcash_number) : 'Not linked'}
                  </Text>
                </View>
                <View style={[styles.payoutDot, { backgroundColor: hasGcash ? colors.success : colors.textMuted }]} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.payoutTile}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Cashout', { providerId, cashableBalance, lockedAmount })}
              >
                <View style={styles.payoutLogoBox}>
                  <Image source={MAYA_LOGO} style={{ width: 20, height: 20 }} resizeMode="contain" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.payoutLabel}>Maya</Text>
                  <Text style={styles.payoutValue} numberOfLines={1}>
                    {hasMaya ? maskAccount(walletData!.maya_number) : 'Not linked'}
                  </Text>
                </View>
                <View style={[styles.payoutDot, { backgroundColor: hasMaya ? colors.success : colors.textMuted }]} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Bottom Stats Bar */}
        <View style={styles.statsDivider} />
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{completedJobs}</Text>
            <Text style={styles.statLabel}>Completed</Text>
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
            <Text style={[styles.statValue, totalPending > 0 && { color: colors.warning }]} numberOfLines={1}>
              ₱{totalPending.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </Text>
            <Text style={styles.statLabel}>In Escrow</Text>
          </View>
        </View>
      </View>
    );
  };

  const renderEarning = ({ item }: { item: EarningRow }) => {
    const isEarned = item.display_status === 'earned';
    const isPending = item.display_status === 'pending';
    const isFrozen = item.display_status === 'frozen';
    const isRefunded = item.display_status === 'refunded';

    let statusColor = colors.warning;
    let statusBg = colors.warningBg;
    let statusIcon: any = 'Clock';
    let statusLabel = 'Pending';

    if (isEarned) { statusColor = colors.success; statusBg = colors.successBg; statusIcon = 'CheckCircle'; statusLabel = 'Earned'; }
    else if (isFrozen) { statusColor = colors.error; statusBg = colors.errorBg; statusIcon = 'Snowflake'; statusLabel = 'Frozen'; }
    else if (isRefunded) { statusColor = colors.textSecondary; statusBg = colors.divider; statusIcon = 'ArrowLeft'; statusLabel = 'Refunded'; }
    else if (isPending) { statusLabel = item.delivery_completed_at ? 'Releasing' : 'In Escrow'; }

    const rowCashAt = cashableAtOf(item);
    if (isEarned && rowCashAt != null && rowCashAt > nowMs) {
      statusColor = colors.warning; statusBg = colors.warningBg; statusIcon = 'Clock';
      statusLabel = `Unlocks in ${formatCountdown(rowCashAt - nowMs)}`;
    }

    const stamp = item.processed_at || item.delivery_completed_at || item.created_at;

    return (
      <TouchableOpacity style={styles.transactionCard} activeOpacity={0.85} onPress={() => setDetailRow(item)}>
        <View style={styles.transactionLeft}>
          <View style={[styles.iconContainer, { backgroundColor: statusBg }]}>
            <SolarIcon name={statusIcon} variant="linear" size={20} color={statusColor} />
          </View>
          <View style={styles.transactionDetails}>
            <Text style={styles.transactionTitle} numberOfLines={1}>
              Delivery #{item.delivery_id}
            </Text>
            <Text style={styles.transactionSubtitle} numberOfLines={1}>
              {formatDate(stamp)}
              {item.payment_method ? ` • ${titleCase(item.payment_method)}` : ''}
            </Text>
            <View style={styles.badgeRow}>
              <View style={[styles.miniStatusPill, { backgroundColor: statusBg }]}>
                <Text style={[styles.miniStatusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
              {isReturnOption(item) && (
                <View style={styles.returnPill}>
                  <Text style={styles.returnPillText}>
                    {item.is_returned ? 'Returned' : 'Return to Sender'}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <View style={styles.transactionRight}>
          <Text
            style={[
              styles.transactionAmount,
              { color: isEarned ? colors.success : isRefunded ? colors.textSecondary : colors.textPrimary },
              isRefunded && { textDecorationLine: 'line-through' },
            ]}
          >
            {isEarned ? '+' : ''}₱{item.display_amount.toFixed(2)}
          </Text>
          {item.service_fee != null && item.service_fee > 0 && !isRefunded && (
            <Text style={[styles.penaltyText, { color: colors.textMuted }]}>₱{item.service_fee.toFixed(2)} platform fee</Text>
          )}
          {!!item.penalty_fee && item.penalty_fee > 0 && (
            <Text style={styles.penaltyText}>-₱{item.penalty_fee.toFixed(2)} Penalty</Text>
          )}
          <SolarIcon name="AltArrowRight" variant="linear" size={14} color={colors.textMuted} style={{ marginTop: 4 }} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderWithdrawalItem = ({ item }: { item: WithdrawalRequest }) => {
    const st = item.status;
    const isCompleted = st === 'Completed';
    const isRefunded = ['Failed', 'Rejected', 'Reversed'].includes(st);
    const isMaya = String(item.method || '').toLowerCase() === 'maya';

    const statusColor = isCompleted ? colors.success : isRefunded ? colors.error : colors.accent;
    const statusBg = isCompleted ? colors.successBg : isRefunded ? colors.errorBg : colors.accentSoft;
    const statusIcon = isCompleted ? 'CheckCircle' : isRefunded ? 'ArrowLeft' : 'Clock';
    const statusLabel = st === 'Pending_Compliance' ? 'Under Review' : isRefunded ? 'Refunded' : st;

    const stamp = item.processed_at || item.requested_at;

    return (
      <TouchableOpacity style={styles.transactionCard} activeOpacity={0.85} onPress={() => setSelectedWithdrawal(item)}>
        <View style={styles.transactionLeft}>
          <View style={[styles.iconContainer, { backgroundColor: statusBg }]}>
            <SolarIcon name={statusIcon as any} variant="linear" size={20} color={statusColor} />
          </View>
          <View style={styles.transactionDetails}>
            <View style={styles.txTitleRow}>
              <Text style={styles.transactionTitle}>{isMaya ? 'Maya' : 'GCash'} Cashout</Text>
              <View style={[styles.miniStatusPill, { backgroundColor: statusBg }]}>
                <Text style={[styles.miniStatusText, { color: statusColor }]}>{statusLabel}</Text>
              </View>
            </View>
            <View style={styles.paymentMethodRow}>
              <Image source={isMaya ? MAYA_LOGO : GCASH_LOGO} style={{ width: 13, height: 13, borderRadius: 3 }} resizeMode="contain" />
              <Text style={styles.transactionSubtitle} numberOfLines={1}>
                {maskAccount(item.account_number) || 'Account'} • {formatDate(stamp)}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.transactionRight}>
          <Text
            style={[
              styles.transactionAmount,
              { color: isRefunded ? colors.textSecondary : isCompleted ? colors.textPrimary : colors.accent },
              isRefunded && { textDecorationLine: 'line-through' },
            ]}
          >
            -₱{Number(item.amount || 0).toFixed(2)}
          </Text>
          {isRefunded && <Text style={[styles.penaltyText, { color: colors.success }]}>Restored</Text>}
          <SolarIcon name="AltArrowRight" variant="linear" size={14} color={colors.textMuted} style={{ marginTop: 4 }} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderWithdrawalModal = () => {
    const w = selectedWithdrawal;
    if (!w) return null;
    const st = w.status;
    const isCompleted = st === 'Completed';
    const isRefunded = ['Failed', 'Rejected', 'Reversed'].includes(st);
    const isProcessing = ['Pending', 'Processing', 'Pending_Compliance'].includes(st);

    const headColor = isCompleted ? colors.success : isRefunded ? colors.error : colors.accent;
    const headBg = isCompleted ? colors.successBg : isRefunded ? colors.errorBg : colors.accentSoft;
    const headIcon = isCompleted ? 'CheckCircle' : isRefunded ? 'DangerCircle' : 'Clock';

    return (
      <Modal visible={!!selectedWithdrawal} transparent animationType="slide" onRequestClose={() => setSelectedWithdrawal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.dHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cashout Details</Text>
              <TouchableOpacity onPress={() => setSelectedWithdrawal(null)} hitSlop={10} style={styles.modalCloseBtn}>
                <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={[styles.heroBox, { backgroundColor: headBg }]}>
                <View style={[styles.heroIcon, { backgroundColor: colors.card }]}>
                  <SolarIcon name={headIcon as any} variant="linear" size={24} color={headColor} secondaryColor={headColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heroStatus, { color: headColor }]}>
                    {st === 'Pending_Compliance' ? 'Under Compliance Review' : isRefunded ? `${st} — Restored` : st}
                  </Text>
                  <Text style={styles.heroSub}>Withdrawal #{w.withdrawal_id}</Text>
                </View>
                <Text style={[styles.heroAmount, { color: headColor }]}>₱{Number(w.amount || 0).toFixed(2)}</Text>
              </View>

              <Text style={styles.sectionLabel}>PAYOUT SUMMARY</Text>
              <View style={styles.detailGroupCard}>
                <InfoRow styles={styles} colors={colors} label="Method" value={String(w.method).toLowerCase() === 'maya' ? 'Maya' : 'GCash'} />
                <InfoRow styles={styles} colors={colors} label="Recipient Number" value={w.account_number || '—'} />
                <InfoRow styles={styles} colors={colors} label="Account Holder" value={w.account_holder_name || '—'} />
                <InfoRow styles={styles} colors={colors} label="Reference ID" value={w.xendit_reference_id || `pns_wd_${w.withdrawal_id}`} />
                {!!w.xendit_payout_id && <InfoRow styles={styles} colors={colors} label="Xendit Payout ID" value={w.xendit_payout_id} />}
                <InfoRow styles={styles} colors={colors} label="Requested At" value={formatFullDate(w.requested_at)} />
                <InfoRow styles={styles} colors={colors} label="Processed At" value={formatFullDate(w.processed_at)} last={!w.failure_code} />
                {!!w.failure_code && (
                  <InfoRow
                    styles={styles}
                    colors={colors}
                    label="Gateway Failure"
                    value={`${w.failure_code}${w.failure_message ? ` (${w.failure_message})` : ''}`}
                    valueColor={colors.error}
                    last
                  />
                )}
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>BLOCKCHAIN RECORD</Text>
              <View style={styles.hashList}>
                <View style={styles.hashRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hashLabel}>WITHDRAWAL TRANSACTION</Text>
                    <Text style={[styles.hashValue, !((w as any).bc_tx_hash || wdHashes[Number(w.withdrawal_id)]) && { color: colors.textMuted }]}>
                      {(w as any).bc_tx_hash || wdHashes[Number(w.withdrawal_id)] || 'Not yet recorded on the blockchain'}
                    </Text>
                  </View>
                  {!!((w as any).bc_tx_hash || wdHashes[Number(w.withdrawal_id)]) && (
                    <TouchableOpacity
                      style={styles.hashCopyBtn}
                      onPress={() => copyHash('wd', (w as any).bc_tx_hash || wdHashes[Number(w.withdrawal_id)])}
                      activeOpacity={0.7}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <SolarIcon name={copiedHash === 'wd' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {isRefunded && (
                <View style={[styles.noteBox, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
                  <SolarIcon name="CheckCircle" variant="linear" size={15} color={colors.success} />
                  <Text style={[styles.noteText, { color: colors.success }]}>
                    ₱{Number(w.amount || 0).toFixed(2)} was automatically restored to your Pack-N-Ship wallet.
                  </Text>
                </View>
              )}

              {isProcessing && (
                <TouchableOpacity
                  style={styles.reconcileBtn}
                  onPress={() => handleReconcile(w.withdrawal_id)}
                  disabled={reconcilingId === w.withdrawal_id}
                  activeOpacity={0.85}
                >
                  {reconcilingId === w.withdrawal_id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <>
                      <SolarIcon name="Refresh" variant="linear" size={16} color={colors.accent} />
                      <Text style={styles.reconcileBtnText}>Refresh Gateway Status</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </ScrollView>

            <View style={[styles.modalFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setSelectedWithdrawal(null)} activeOpacity={0.9}>
                <Text style={styles.modalDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderDetailModal = () => {
    const r = detailRow;
    if (!r) return null;
    const isEarned = r.display_status === 'earned';
    const isPending = r.display_status === 'pending';
    const isFrozen = r.display_status === 'frozen';
    const isRefunded = r.display_status === 'refunded';

    let headColor = colors.warning, headBg = colors.warningBg, headIcon: any = 'Clock', headLabel = 'Pending payout';
    if (isEarned) { headColor = colors.success; headBg = colors.successBg; headIcon = 'CheckCircle'; headLabel = 'Earned'; }
    else if (isFrozen) { headColor = colors.error; headBg = colors.errorBg; headIcon = 'Snowflake'; headLabel = 'Frozen (emergency)'; }
    else if (isRefunded) { headColor = colors.textSecondary; headBg = colors.divider; headIcon = 'ArrowLeft'; headLabel = 'Refunded to sender'; }
    else if (isPending) { headLabel = r.delivery_completed_at ? 'Awaiting escrow release' : 'In escrow'; }

    const detailCashAt = cashableAtOf(r);
    if (isEarned && detailCashAt != null && detailCashAt > nowMs) {
      headColor = colors.warning; headBg = colors.warningBg; headIcon = 'Clock';
      headLabel = `Earned · cashable in ${formatCountdown(detailCashAt - nowMs)}`;
    }

    const fare = Number(r.base_fare ?? r.total_amount ?? r.amount ?? 0);
    const baseAmount = r.base_amount != null ? Number(r.base_amount) : null;
    const serviceFee = r.service_fee != null ? Number(r.service_fee) : null;
    const penaltyFee = r.penalty_fee != null ? Number(r.penalty_fee) : 0;

    return (
      <Modal visible={!!detailRow} transparent animationType="slide" onRequestClose={() => setDetailRow(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.dHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Transaction Details</Text>
              <TouchableOpacity onPress={() => setDetailRow(null)} hitSlop={10} style={styles.modalCloseBtn}>
                <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              <View style={[styles.heroBox, { backgroundColor: headBg }]}>
                <View style={[styles.heroIcon, { backgroundColor: colors.card }]}>
                  <SolarIcon name={headIcon} variant="linear" size={24} color={headColor} secondaryColor={headColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heroStatus, { color: headColor }]}>{headLabel}</Text>
                  <Text style={styles.heroSub}>Delivery #{r.delivery_id}</Text>
                </View>
                <Text style={[styles.heroAmount, { color: headColor }]}>
                  {isEarned ? '+' : ''}₱{r.display_amount.toFixed(2)}
                </Text>
              </View>

              <Text style={styles.sectionLabel}>BREAKDOWN</Text>
              <View style={styles.detailGroupCard}>
                <BreakdownRow styles={styles} colors={colors} label="Delivery fare" value={fare} muted={!isEarned} />
                {r.is_returned && r.return_deposit > 0 && (
                  <BreakdownRow styles={styles} colors={colors} label="Return deposit (kept for return trip)" value={r.return_deposit} muted={!isEarned} />
                )}
                {serviceFee != null && serviceFee > 0 && (
                  <BreakdownRow styles={styles} colors={colors} label="Platform service fee (15%)" value={serviceFee} negative />
                )}
                {penaltyFee > 0 && (
                  <BreakdownRow styles={styles} colors={colors} label="Penalty fee" value={penaltyFee} negative />
                )}
                <View style={styles.breakdownDivider} />
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>{isEarned ? 'Net credited to wallet' : 'Expected payout'}</Text>
                  <Text style={[styles.totalValue, { color: isEarned ? colors.success : colors.textPrimary }]}>
                    {isEarned ? '+' : ''}₱{(baseAmount != null ? baseAmount : r.display_amount).toFixed(2)}
                  </Text>
                </View>
              </View>

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>TRANSACTION</Text>
              <View style={styles.detailGroupCard}>
                <InfoRow styles={styles} colors={colors} label="Transaction ID" value={r.transaction_id != null ? `#${r.transaction_id}` : 'Pending release'} />
                <InfoRow styles={styles} colors={colors} label="Status" value={titleCase(r.transaction_status) || (isEarned ? 'Completed' : 'Pending')} />
                <InfoRow styles={styles} colors={colors} label="Sender paid via" value={r.payment_method ? titleCase(r.payment_method) : '—'} />
                <InfoRow styles={styles} colors={colors} label="Processed at" value={formatFullDate(r.processed_at)} last />
              </View>

              {isReturnOption(r) && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>RETURN TO SENDER</Text>
                  <View style={styles.detailGroupCard}>
                    <InfoRow styles={styles} colors={colors} label="Sender's option" value="Option A · Return to sender" />
                    <InfoRow styles={styles} colors={colors} label="Return deposit" value={`₱${Number(r.return_deposit).toFixed(2)}`} />
                    <InfoRow styles={styles} colors={colors} label="Deposit status" value={returnDepositStatus(r)} last />
                  </View>
                  <Text style={[styles.privacyNoteE, { marginTop: 8 }]}>
                    {r.is_returned
                      ? 'The package could not be delivered and was returned, so the return deposit is added to your earnings.'
                      : 'If the delivery succeeds the deposit goes back to the sender and is not part of your earnings.'}
                  </Text>
                </>
              )}

              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>ESCROW &amp; DELIVERY</Text>
              <View style={styles.detailGroupCard}>
                <InfoRow styles={styles} colors={colors} label="Escrow ID" value={`#${r.escrow_id}`} />
                <InfoRow styles={styles} colors={colors} label="Escrow status" value={titleCase(r.escrow_status)} />
                <InfoRow styles={styles} colors={colors} label="Escrow amount" value={`₱${Number(r.amount || 0).toFixed(2)}`} />
                <InfoRow styles={styles} colors={colors} label="Accepted at" value={formatFullDate(r.delivery_accepted_at)} />
                <InfoRow styles={styles} colors={colors} label="Completed at" value={formatFullDate(r.delivery_completed_at)} last />
              </View>

              {(!!r.bc_escrow_tx_hash || !!r.bc_tx_hash) && (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: 18 }]}>BLOCKCHAIN RECORD</Text>
                  <View style={styles.hashList}>
                    {!!r.bc_escrow_tx_hash && (
                      <View style={styles.hashRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.hashLabel}>ESCROW PAYMENT</Text>
                          <Text style={styles.hashValue}>{r.bc_escrow_tx_hash}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.hashCopyBtn}
                          onPress={() => copyHash('escrow', r.bc_escrow_tx_hash)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <SolarIcon name={copiedHash === 'escrow' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                        </TouchableOpacity>
                      </View>
                    )}
                    {!!r.bc_tx_hash && (
                      <View style={styles.hashRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.hashLabel}>PAYMENT TRANSACTION</Text>
                          <Text style={styles.hashValue}>{r.bc_tx_hash}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.hashCopyBtn}
                          onPress={() => copyHash('payout', r.bc_tx_hash)}
                          activeOpacity={0.7}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <SolarIcon name={copiedHash === 'payout' ? 'CheckCircle' : 'Copy'} variant="linear" size={16} color={colors.accent} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </>
              )}

              {isPending && (
                <View style={styles.noteBox}>
                  <SolarIcon name="InfoCircle" variant="linear" size={14} color={colors.warning} />
                  <Text style={styles.noteText}>
                    Still held in escrow. Funds release automatically once delivery is verified.
                  </Text>
                </View>
              )}
              {isFrozen && (
                <View style={[styles.noteBox, { backgroundColor: colors.errorBg, borderColor: colors.error }]}>
                  <SolarIcon name="Snowflake" variant="linear" size={14} color={colors.error} />
                  <Text style={[styles.noteText, { color: colors.error }]}>
                    This transaction is frozen due to an open issue.
                  </Text>
                </View>
              )}
              {isRefunded && (
                <View style={[styles.noteBox, { backgroundColor: colors.divider, borderColor: colors.border }]}>
                  <SolarIcon name="ArrowLeft" variant="linear" size={14} color={colors.textSecondary} />
                  <Text style={[styles.noteText, { color: colors.textSecondary }]}>
                    This delivery was refunded to the sender. No earnings were credited.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={[styles.modalFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setDetailRow(null)} activeOpacity={0.9}>
                <Text style={styles.modalDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingText}>Loading earnings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <Text style={styles.headerTitle}>My Earnings</Text>
      </Animated.View>

      <Animated.View style={[styles.mainContent, fadeUp(contentAnim, 20)]}>
        <FlatList
          data={(historyTab === 'earnings' ? earnings : withdrawals) as any[]}
          keyExtractor={(item: any) => historyTab === 'earnings' ? `earn-${item.escrow_id}` : `wd-${item.withdrawal_id}`}
          renderItem={historyTab === 'earnings' ? (renderEarning as any) : (renderWithdrawalItem as any)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />}
          ListHeaderComponent={
            <>
              {renderWalletCard()}
              <View style={styles.historyTabsRow}>
                <TouchableOpacity
                  style={[styles.historyTabBtn, historyTab === 'earnings' && styles.historyTabBtnActive]}
                  onPress={() => setHistoryTab('earnings')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.historyTabText, historyTab === 'earnings' && styles.historyTabTextActive]}>
                    Earnings ({earnings.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.historyTabBtn, historyTab === 'withdrawals' && styles.historyTabBtnActive]}
                  onPress={() => setHistoryTab('withdrawals')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.historyTabText, historyTab === 'withdrawals' && styles.historyTabTextActive]}>
                    Withdrawals ({withdrawals.length})
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Image source={EMPTY_BOX_ICON} style={{ width: 120, height: 120, marginBottom: 16 }} resizeMode="contain" />
              <Text style={styles.emptyText}>{historyTab === 'earnings' ? 'No earnings yet' : 'No withdrawals yet'}</Text>
              <Text style={styles.emptySubText}>
                {historyTab === 'earnings'
                  ? 'Once you complete a delivery and the escrow is released, your earnings will show up here.'
                  : 'When you cash out your wallet balance to GCash or Maya, your payout history will appear here.'}
              </Text>
            </View>
          }
        />
      </Animated.View>
      {renderDetailModal()}
      {renderWithdrawalModal()}
    </View>
  );
}

const InfoRow: React.FC<{ label: string; value: string; valueColor?: string; last?: boolean; styles: any; colors: ThemeColors }> = ({ label, value, valueColor, last, styles }) => (
  <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, valueColor ? { color: valueColor } : null]} numberOfLines={2}>{value}</Text>
  </View>
);

/** Sender picked Option A (Return to Sender) and paid a return deposit. */
const isReturnOption = (r: { fallback_action: string | null; return_deposit: number }) =>
  r.fallback_action === 'return_to_sender' && Number(r.return_deposit) > 0;

const returnDepositStatus = (r: EarningRow): string => {
  if (r.is_returned) return 'Kept by you for the return trip';
  if (r.display_status === 'refunded') return 'Refunded to sender';
  if (!r.delivery_completed_at) return 'Held in escrow';
  const rs = String(r.refund_status || '').toLowerCase();
  if (rs === 'succeeded' || rs === 'refunded') return 'Refunded to sender';
  if (rs === 'failed' || rs === 'manual_required') return 'Refund to sender pending';
  return 'Being refunded to sender';
};

const BreakdownRow: React.FC<{ label: string; value: number | null; negative?: boolean; muted?: boolean; styles: any; colors: ThemeColors }> = ({ label, value, negative, muted, styles, colors }) => {
  const display = value == null ? '—' : `${negative && value > 0 ? '−' : ''}₱${Math.abs(value).toFixed(2)}`;
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={[styles.breakdownValue, muted && { color: colors.textMuted }, negative && value != null && value > 0 && { color: colors.error }]}>{display}</Text>
    </View>
  );
};

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background },
  loadingText: { marginTop: 12, color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_500Medium' },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.background,
    borderBottomWidth: 1,
    borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  headerTitle: { fontSize: 26, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
  mainContent: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 100 },

  /* Wallet Card */
  walletCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: isDark ? 0.2 : 0.04,
    shadowRadius: 8,
    elevation: isDark ? 0 : 1,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  walletTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  balanceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  walletIconBox: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 10.5,
    fontFamily: 'Poppins_700Bold',
    color: c.textSecondary,
    letterSpacing: 0.8,
  },
  balanceAmount: {
    fontSize: 34,
    fontFamily: 'Poppins_800ExtraBold',
    color: c.textPrimary,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  currencySymbol: { fontSize: 24, color: c.textSecondary },
  withdrawBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.accent,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    gap: 6,
  },
  withdrawBtnText: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },

  walletStatusList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.warningBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  pendingText: { fontSize: 11.5, fontFamily: 'Poppins_600SemiBold', color: c.warning },

  walletMissingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  walletMissingText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.warning, lineHeight: 16 },

  statsDivider: { height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginVertical: 14 },

  /* 2-Column Payout Accounts */
  payoutHeading: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: c.textMuted,
    letterSpacing: 0.9,
    marginBottom: 8,
  },
  payoutGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  payoutTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: c.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  },
  payoutLogoBox: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  payoutLabel: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  payoutValue: { fontSize: 10.5, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1 },
  payoutDot: { width: 7, height: 7, borderRadius: 3.5 },

  /* 3-Column Stats Bar */
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statBox: { alignItems: 'center', flex: 1, paddingHorizontal: 4 },
  statValue: {
    fontSize: 15.5,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    marginBottom: 2,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, textAlign: 'center' },
  verticalDivider: { width: 1, height: 24, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },

  /* History Tabs */
  historyTabsRow: {
    flexDirection: 'row',
    backgroundColor: c.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  historyTabBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  historyTabBtnActive: {
    backgroundColor: c.accentSoft,
  },
  historyTabText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  historyTabTextActive: { color: c.accent, fontFamily: 'Poppins_700Bold' },

  /* Transaction / Withdrawal Row Card */
  transactionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  iconContainer: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  transactionDetails: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  txTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  transactionTitle: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  miniStatusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  miniStatusText: { fontSize: 10, fontFamily: 'Poppins_700Bold' },
  returnPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: c.infoSoft },
  returnPillText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.info },
  privacyNoteE: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, lineHeight: 16 },
  transactionSubtitle: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary },
  paymentMethodRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 5 },
  transactionRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  transactionAmount: { fontSize: 15.5, fontFamily: 'Poppins_700Bold', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  penaltyText: { fontSize: 10.5, fontFamily: 'Poppins_600SemiBold', color: c.error, marginTop: 2 },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
  },
  emptyText: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 6 },
  emptySubText: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', lineHeight: 19 },

  /* Bottom Sheet Modals */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: c.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '88%',
  },
  dHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  modalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: c.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBox: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, padding: 14, marginBottom: 18 },
  heroIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heroStatus: { fontSize: 14.5, fontFamily: 'Poppins_700Bold' },
  heroSub: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginTop: 1 },
  heroAmount: { fontSize: 20, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },

  sectionLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.9, marginBottom: 8 },
  detailGroupCard: {
    backgroundColor: c.background,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    gap: 12,
  },
  infoLabel: { fontSize: 12.5, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
  infoValue: { flexShrink: 1, fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary, textAlign: 'right' },

  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
  breakdownLabel: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
  breakdownValue: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary, fontVariant: ['tabular-nums'] },
  breakdownDivider: { height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)', marginVertical: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  totalLabel: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  totalValue: { fontSize: 18, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },

  hashList: { gap: 10 },
  hashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 10,
  },
  hashLabel: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.textMuted, letterSpacing: 0.8 },
  hashValue: { fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginTop: 3 },
  hashCopyBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  },

  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  noteText: { flex: 1, fontSize: 11.5, fontFamily: 'Poppins_500Medium', color: c.warning, lineHeight: 16 },
  reconcileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.accent,
    backgroundColor: c.accentSoft,
  },
  reconcileBtnText: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.accent },

  modalFooter: {
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
  },
  modalDoneBtn: {
    backgroundColor: c.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalDoneBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
});
