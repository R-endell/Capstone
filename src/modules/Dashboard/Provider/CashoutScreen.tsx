// src/modules/Dashboard/Provider/CashoutScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import {
  PaymentProvider,
  ProviderWallet,
  WithdrawalRequest,
} from '../../../types/payment';
import {
  MIN_CASHOUT_AMOUNT,
  MAX_CASHOUT_AMOUNT,
  fetchProviderWallet,
  fetchWithdrawalHistory,
  requestProviderCashout,
  reconcileWithdrawalStatus,
  generateCashoutIdempotencyKey,
  isValidPhMobileOrTestNumber,
  isSavedWalletNumberValid,
  XENDIT_TEST_SCENARIO_NUMBERS,
} from '../../../services/withdrawalService';

const GCASH_LOGO = require('../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../assets/maya.jpeg');

const ORANGE = '#FA7A25';

type StepState = 'form' | 'confirm' | 'result';

export default function CashoutScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const scrollRef = useRef<ScrollView | null>(null);
  const accountNumberInputRef = useRef<TextInput | null>(null);
  const accountHolderInputRef = useRef<TextInput | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const [providerId, setProviderId] = useState<number | null>(
    route.params?.providerId ?? null,
  );
  const [wallet, setWallet] = useState<ProviderWallet | null>(null);
  const [activeWithdrawal, setActiveWithdrawal] =
    useState<WithdrawalRequest | null>(null);

  const [step, setStep] = useState<StepState>('form');
  const [method, setMethod] = useState<PaymentProvider>('gcash');
  const [amountInput, setAmountInput] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [saveDestination, setSaveDestination] = useState(true);

  // Generated ONCE per logical confirmation attempt; reused on network retry
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [resultWithdrawal, setResultWithdrawal] =
    useState<WithdrawalRequest | null>(null);

  // Track keyboard height so inputs at the bottom are never covered on Android
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates?.height || 300);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollInputIntoView = (yOffset: number) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: yOffset, animated: true });
    }, 150);
  };

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Session Expired', 'Please sign in again.');
        navigation.goBack();
        return;
      }

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, phone_number')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (userErr || !userRow) {
        throw new Error('Could not load your provider profile.');
      }

      const pid = userRow.user_id;
      setProviderId(pid);

      const defaultName = [userRow.first_name, userRow.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();

      const walletRow = await fetchProviderWallet(pid);
      setWallet(walletRow);

      if (walletRow) {
        const holder = walletRow.bank_acc_holder || defaultName;
        setAccountHolderName(holder);

        if (isSavedWalletNumberValid(walletRow.gcash_number)) {
          setAccountNumber(walletRow.gcash_number!);
        } else if (isSavedWalletNumberValid(userRow.phone_number)) {
          setAccountNumber(userRow.phone_number!);
        }

        const history = await fetchWithdrawalHistory(walletRow.wallet_id);
        const inFlight =
          history.find((w) =>
            ['Pending', 'Processing', 'Pending_Compliance'].includes(w.status),
          ) || null;
        setActiveWithdrawal(inFlight);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not load cashout details.');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const handleSelectMethod = (nextMethod: PaymentProvider) => {
    setMethod(nextMethod);
    setIdempotencyKey('');
    if (!wallet) return;
    if (nextMethod === 'gcash' && isSavedWalletNumberValid(wallet.gcash_number)) {
      setAccountNumber(wallet.gcash_number!);
    } else if (
      nextMethod === 'maya' &&
      isSavedWalletNumberValid(wallet.maya_number)
    ) {
      setAccountNumber(wallet.maya_number!);
    }
  };

  useEffect(() => {
    const watchedId =
      resultWithdrawal?.withdrawal_id || activeWithdrawal?.withdrawal_id;
    if (!watchedId) return;

    const channel = supabase
      .channel(`cashout-watch-${watchedId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'withdrawal_requests',
          filter: `withdrawal_id=eq.${watchedId}`,
        },
        async (payload) => {
          const updated = payload.new as WithdrawalRequest;
          if (resultWithdrawal?.withdrawal_id === watchedId) {
            setResultWithdrawal({
              ...updated,
              amount: Number(updated.amount || 0),
            });
          }
          if (activeWithdrawal?.withdrawal_id === watchedId) {
            if (
              ['Completed', 'Failed', 'Rejected', 'Reversed'].includes(
                updated.status,
              )
            ) {
              setActiveWithdrawal(null);
            } else {
              setActiveWithdrawal({
                ...updated,
                amount: Number(updated.amount || 0),
              });
            }
          }
          if (providerId) {
            try {
              const refreshedWallet = await fetchProviderWallet(providerId);
              if (refreshedWallet) setWallet(refreshedWallet);
            } catch {}
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    resultWithdrawal?.withdrawal_id,
    activeWithdrawal?.withdrawal_id,
    providerId,
  ]);

  const availableBalance = Number(wallet?.balance || 0);
  const parsedAmount = Number(amountInput || 0);
  const cleanAccount = accountNumber.replace(/\s+/g, '');
  const isTestScenarioAccount = XENDIT_TEST_SCENARIO_NUMBERS.has(cleanAccount);

  const getValidationError = (): string | null => {
    if (!wallet) return 'Wallet is not initialized yet.';
    if (activeWithdrawal) {
      return 'You already have an active withdrawal in progress.';
    }
    if (!amountInput || isNaN(parsedAmount) || parsedAmount <= 0) {
      return 'Enter a cashout amount greater than ₱0.00.';
    }
    if (parsedAmount < MIN_CASHOUT_AMOUNT) {
      return `Minimum cashout amount is ₱${MIN_CASHOUT_AMOUNT.toFixed(2)}.`;
    }
    if (parsedAmount > MAX_CASHOUT_AMOUNT) {
      return `Maximum cashout per transaction is ₱${MAX_CASHOUT_AMOUNT.toLocaleString()}.`;
    }
    if (parsedAmount > availableBalance) {
      return `Amount exceeds your available balance of ₱${availableBalance.toFixed(2)}.`;
    }
    if (!isValidPhMobileOrTestNumber(cleanAccount, true)) {
      return 'Enter a valid 11-digit mobile number (09XXXXXXXXX).';
    }
    if (accountHolderName.trim().length < 2) {
      return 'Enter the full account holder name registered with your e-wallet.';
    }
    return null;
  };

  const validationError = getValidationError();

  const handleProceedToConfirm = () => {
    Keyboard.dismiss();
    if (validationError) {
      Alert.alert('Check Details', validationError);
      return;
    }
    if (!idempotencyKey) {
      setIdempotencyKey(generateCashoutIdempotencyKey(providerId));
    }
    setStep('confirm');
  };

  const handleConfirmCashout = async () => {
    if (submitting) return;
    const keyToUse =
      idempotencyKey || generateCashoutIdempotencyKey(providerId);
    if (!idempotencyKey) setIdempotencyKey(keyToUse);

    setSubmitting(true);
    try {
      const response = await requestProviderCashout({
        amount: Number(parsedAmount.toFixed(2)),
        method,
        accountNumber: cleanAccount,
        accountHolderName: accountHolderName.trim(),
        idempotencyKey: keyToUse,
        saveDestination: saveDestination && !isTestScenarioAccount,
      });

      const wd = response.withdrawal;
      setResultWithdrawal({
        ...wd,
        amount: Number(wd.amount || parsedAmount),
      });

      if (providerId) {
        const updatedWallet = await fetchProviderWallet(providerId);
        if (updatedWallet) setWallet(updatedWallet);
      }

      setStep('result');
    } catch (err: any) {
      setIdempotencyKey(generateCashoutIdempotencyKey(providerId));
      if (providerId) {
        try {
          const updatedWallet = await fetchProviderWallet(providerId);
          if (updatedWallet) setWallet(updatedWallet);
        } catch {}
      }
      Alert.alert(
        'Cashout Unable to Proceed',
        err?.message || 'Could not process your cashout right now.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async (withdrawalId: number) => {
    if (reconciling) return;
    setReconciling(true);
    try {
      const updated = await reconcileWithdrawalStatus(withdrawalId);
      if (updated) {
        if (resultWithdrawal?.withdrawal_id === withdrawalId) {
          setResultWithdrawal({
            ...updated,
            amount: Number(updated.amount || resultWithdrawal.amount),
          });
        }
        if (activeWithdrawal?.withdrawal_id === withdrawalId) {
          if (
            ['Completed', 'Failed', 'Rejected', 'Reversed'].includes(
              updated.status,
            )
          ) {
            setActiveWithdrawal(null);
          } else {
            setActiveWithdrawal({
              ...updated,
              amount: Number(updated.amount || activeWithdrawal.amount),
            });
          }
        }
      }
      if (providerId) {
        const refreshedWallet = await fetchProviderWallet(providerId);
        if (refreshedWallet) setWallet(refreshedWallet);
      }
    } catch (err: any) {
      Alert.alert('Status Check', err?.message || 'Could not refresh status.');
    } finally {
      setReconciling(false);
    }
  };

  const quickAmounts = [100, 200, 500, 1000].filter(
    (v) => v <= Math.max(availableBalance, 1000),
  );

  if (loading) {
    return (
      <View style={styles.loadingRoot}>
        <StatusBar
          barStyle={colors.statusBarStyle}
          translucent
          backgroundColor="transparent"
        />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading wallet...</Text>
      </View>
    );
  }

  /* ---------------------------------------------------------------- */
  /* STEP 3: RESULT / RECEIPT VIEW                                    */
  /* ---------------------------------------------------------------- */
  if (step === 'result' && resultWithdrawal) {
    const st = resultWithdrawal.status;
    const isCompleted = st === 'Completed';
    const isFailed = ['Failed', 'Rejected', 'Reversed'].includes(st);
    const isProcessing = ['Pending', 'Processing', 'Pending_Compliance'].includes(
      st,
    );

    const statusColor = isCompleted
      ? colors.success
      : isFailed
      ? colors.error
      : ORANGE;
    const statusBg = isCompleted
      ? colors.successBg
      : isFailed
      ? colors.errorBg
      : colors.accentSoft;
    const statusIcon = isCompleted
      ? 'checkmark-circle'
      : isFailed
      ? 'alert-circle'
      : 'time';

    return (
      <View style={styles.container}>
        <StatusBar
          barStyle={colors.statusBarStyle}
          translucent
          backgroundColor="transparent"
        />
        <View
          style={[
            styles.header,
            { paddingTop: Math.max(insets.top, 16) + 8 },
          ]}
        >
          <View style={{ width: 40 }} />
          <Text style={styles.headerTitle}>Cashout Status</Text>
          <TouchableOpacity
            style={styles.closeCircleBtn}
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 24) + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.resultHeroCard, { borderColor: statusColor }]}>
            <View
              style={[styles.resultIconWrap, { backgroundColor: statusBg }]}
            >
              <Ionicons name={statusIcon as any} size={38} color={statusColor} />
            </View>
            <Text style={[styles.resultStatusTitle, { color: statusColor }]}>
              {isCompleted
                ? 'Cashout Completed!'
                : isFailed
                ? `Cashout ${st} — Balance Restored`
                : st === 'Pending_Compliance'
                ? 'Under Compliance Review'
                : 'Payout Processing'}
            </Text>
            <Text style={styles.resultAmount}>
              ₱{Number(resultWithdrawal.amount).toFixed(2)}
            </Text>
            <Text style={styles.resultSubtext}>
              {isCompleted
                ? `Funds have been sent to your ${
                    String(resultWithdrawal.method).toLowerCase() === 'maya'
                      ? 'Maya'
                      : 'GCash'
                  } account.`
                : isFailed
                ? `Your cashout could not be completed (${
                    resultWithdrawal.failure_code || 'Channel rejected'
                  }). Full amount was returned to your Pack-N-Ship wallet.`
                : 'Xendit has accepted your payout request. This screen updates automatically as soon as the transfer settles.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionEyebrow}>RECEIPT DETAILS</Text>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Payout Method</Text>
              <Text style={styles.receiptValue}>
                {String(resultWithdrawal.method).toLowerCase() === 'maya'
                  ? 'Maya'
                  : 'GCash'}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Recipient Account</Text>
              <Text style={styles.receiptValue}>
                {resultWithdrawal.account_number || cleanAccount}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Account Holder</Text>
              <Text style={styles.receiptValue}>
                {resultWithdrawal.account_holder_name || accountHolderName}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Reference ID</Text>
              <Text style={styles.receiptValue}>
                {resultWithdrawal.xendit_reference_id ||
                  `pns_wd_${resultWithdrawal.withdrawal_id}`}
              </Text>
            </View>
            {!!resultWithdrawal.xendit_payout_id && (
              <View style={styles.receiptRow}>
                <Text style={styles.receiptLabel}>Xendit Payout ID</Text>
                <Text style={styles.receiptValue} numberOfLines={1}>
                  {resultWithdrawal.xendit_payout_id}
                </Text>
              </View>
            )}
            <View style={[styles.receiptRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.receiptLabel}>Remaining Wallet Balance</Text>
              <Text style={[styles.receiptValue, { color: ORANGE }]}>
                ₱{availableBalance.toFixed(2)}
              </Text>
            </View>
          </View>

          {isProcessing && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => handleCheckStatus(resultWithdrawal.withdrawal_id)}
              disabled={reconciling}
              activeOpacity={0.85}
            >
              {reconciling ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <>
                  <Ionicons name="refresh" size={16} color={ORANGE} />
                  <Text style={styles.secondaryBtnText}>
                    Refresh Gateway Status
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.9}
          >
            <Text style={styles.primaryBtnText}>Back to Earnings</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  /* ---------------------------------------------------------------- */
  /* STEP 2: CONFIRMATION VIEW                                        */
  /* ---------------------------------------------------------------- */
  if (step === 'confirm') {
    return (
      <View style={styles.container}>
        <StatusBar
          barStyle={colors.statusBarStyle}
          translucent
          backgroundColor="transparent"
        />
        <View
          style={[
            styles.header,
            { paddingTop: Math.max(insets.top, 16) + 8 },
          ]}
        >
          <TouchableOpacity
            style={styles.closeCircleBtn}
            onPress={() => !submitting && setStep('form')}
            disabled={submitting}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Confirm Cashout</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 24) + 20 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.confirmHero}>
            <Text style={styles.confirmEyebrow}>YOU ARE CASHING OUT</Text>
            <Text style={styles.confirmAmount}>₱{parsedAmount.toFixed(2)}</Text>
            <View style={styles.confirmFeePill}>
              <Ionicons
                name="checkmark-circle"
                size={13}
                color={colors.success}
              />
              <Text style={styles.confirmFeeText}>
                ₱0.00 Transfer Fee · Instant via Xendit Payouts v3
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionEyebrow}>DESTINATION SUMMARY</Text>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>E-Wallet Channel</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Image
                  source={method === 'gcash' ? GCASH_LOGO : MAYA_LOGO}
                  style={{ width: 18, height: 18, borderRadius: 4 }}
                  resizeMode="contain"
                />
                <Text style={styles.receiptValue}>
                  {method === 'gcash' ? 'GCash' : 'Maya'}
                </Text>
              </View>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Account Number</Text>
              <Text style={styles.receiptValue}>{cleanAccount}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Account Holder Name</Text>
              <Text style={styles.receiptValue}>
                {accountHolderName.trim()}
              </Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Current Wallet Balance</Text>
              <Text style={styles.receiptValue}>
                ₱{availableBalance.toFixed(2)}
              </Text>
            </View>
            <View style={[styles.receiptRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.receiptLabel}>Balance After Cashout</Text>
              <Text style={[styles.receiptValue, { color: ORANGE }]}>
                ₱{Math.max(0, availableBalance - parsedAmount).toFixed(2)}
              </Text>
            </View>
          </View>

          {isTestScenarioAccount && (
            <View style={styles.testScenarioBanner}>
              <Ionicons name="flask-outline" size={16} color={colors.warning} />
              <Text style={styles.testScenarioText}>
                Xendit Test Scenario number detected ({cleanAccount}). Xendit will
                accept the payout and asynchronously emit a simulated failure
                webhook to verify automatic wallet refunding.
              </Text>
            </View>
          )}

          <View style={styles.warningNote}>
            <Ionicons
              name="shield-checkmark-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text style={styles.warningNoteText}>
              Please verify that the recipient mobile number and registered name
              are accurate. If a transfer fails or is reversed by the channel,
              the funds are automatically restored to your Pack-N-Ship wallet.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, submitting && { opacity: 0.65 }]}
            onPress={handleConfirmCashout}
            disabled={submitting}
            activeOpacity={0.9}
          >
            {submitting ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>Submitting Payout...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="paper-plane" size={17} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>
                  Confirm & Send ₱{parsedAmount.toFixed(2)}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelTextBtn}
            onPress={() => setStep('form')}
            disabled={submitting}
          >
            <Text style={styles.cancelTextBtnLabel}>Edit Details</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  /* ---------------------------------------------------------------- */
  /* STEP 1: INPUT FORM VIEW                                          */
  /* ---------------------------------------------------------------- */
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <StatusBar
        barStyle={colors.statusBarStyle}
        translucent
        backgroundColor="transparent"
      />
      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, 16) + 8 },
        ]}
      >
        <TouchableOpacity
          style={styles.closeCircleBtn}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cash Out Earnings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              keyboardHeight > 0
                ? keyboardHeight + 140
                : Math.max(insets.bottom, 24) + 40,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Available Balance Banner */}
        <View style={styles.balanceBanner}>
          <View>
            <Text style={styles.balanceBannerLabel}>AVAILABLE TO CASH OUT</Text>
            <Text style={styles.balanceBannerValue}>
              ₱{availableBalance.toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.maxChip}
            onPress={() => {
              if (availableBalance > 0) {
                const capped = Math.min(availableBalance, MAX_CASHOUT_AMOUNT);
                setAmountInput(capped.toFixed(2));
                setIdempotencyKey('');
              }
            }}
          >
            <Text style={styles.maxChipText}>MAX</Text>
          </TouchableOpacity>
        </View>

        {/* Active In-Flight Withdrawal Lock Banner */}
        {activeWithdrawal && (
          <View style={styles.activeLockCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name="time" size={22} color={ORANGE} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activeLockTitle}>
                  Withdrawal in Progress (₱{activeWithdrawal.amount.toFixed(2)})
                </Text>
                <Text style={styles.activeLockSub}>
                  Status: {activeWithdrawal.status.replace('_', ' ')} • To{' '}
                  {String(activeWithdrawal.method).toUpperCase()} (
                  {activeWithdrawal.account_number})
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.activeLockBtn}
              onPress={() => handleCheckStatus(activeWithdrawal.withdrawal_id)}
              disabled={reconciling}
            >
              {reconciling ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <>
                  <Ionicons name="refresh" size={14} color={ORANGE} />
                  <Text style={styles.activeLockBtnText}>Check Status</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Amount Input Card */}
        <View style={styles.card}>
          <Text style={styles.sectionEyebrow}>CASHOUT AMOUNT (PHP)</Text>
          <View style={styles.amountInputRow}>
            <Text style={styles.currencyPrefix}>₱</Text>
            <TextInput
              style={styles.amountInput}
              value={amountInput}
              onChangeText={(txt) => {
                const cleaned = txt.replace(/[^0-9.]/g, '');
                const parts = cleaned.split('.');
                const formatted =
                  parts.length > 2
                    ? `${parts[0]}.${parts.slice(1).join('')}`
                    : cleaned;
                setAmountInput(formatted);
                setIdempotencyKey('');
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textMuted}
              editable={!activeWithdrawal}
            />
          </View>
          <Text style={styles.limitHelperText}>
            Min ₱{MIN_CASHOUT_AMOUNT.toFixed(2)} · Max ₱
            {MAX_CASHOUT_AMOUNT.toLocaleString()} per transaction
          </Text>

          <View style={styles.quickChipsRow}>
            {quickAmounts.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[
                  styles.quickChip,
                  Number(amountInput) === amt && styles.quickChipActive,
                ]}
                onPress={() => {
                  setAmountInput(String(amt));
                  setIdempotencyKey('');
                }}
                disabled={!!activeWithdrawal}
              >
                <Text
                  style={[
                    styles.quickChipText,
                    Number(amountInput) === amt && styles.quickChipTextActive,
                  ]}
                >
                  ₱{amt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* E-Wallet Method Selector */}
        <View style={styles.card}>
          <Text style={styles.sectionEyebrow}>SELECT E-WALLET</Text>
          <View style={styles.methodGrid}>
            {(['gcash', 'maya'] as const).map((m) => {
              const selected = method === m;
              const isGcash = m === 'gcash';
              const brandColor = isGcash ? '#0070F0' : '#059669';
              return (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.methodOption,
                    selected && {
                      borderColor: brandColor,
                      backgroundColor: isGcash
                        ? 'rgba(0,112,240,0.08)'
                        : 'rgba(5,150,105,0.08)',
                    },
                  ]}
                  onPress={() => handleSelectMethod(m)}
                  disabled={!!activeWithdrawal}
                  activeOpacity={0.85}
                >
                  <View style={styles.methodLogoBox}>
                    <Image
                      source={isGcash ? GCASH_LOGO : MAYA_LOGO}
                      style={{ width: 28, height: 28 }}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodTitle}>
                      {isGcash ? 'GCash' : 'Maya'}
                    </Text>
                    <Text style={styles.methodSub}>InstaPay · Instant</Text>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? brandColor : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Recipient Details */}
          <Text style={[styles.inputLabel, { marginTop: 18 }]}>
            {method === 'gcash' ? 'GCash' : 'Maya'} Mobile Number
          </Text>
          <TextInput
            ref={accountNumberInputRef}
            style={styles.textInput}
            value={accountNumber}
            onFocus={() => scrollInputIntoView(310)}
            onChangeText={(t) => {
              setAccountNumber(t.replace(/[^0-9]/g, '').slice(0, 11));
              setIdempotencyKey('');
            }}
            keyboardType="number-pad"
            placeholder="09171234567"
            placeholderTextColor={colors.textMuted}
            maxLength={11}
            returnKeyType="next"
            onSubmitEditing={() => accountHolderInputRef.current?.focus()}
            editable={!activeWithdrawal}
          />

          <Text style={[styles.inputLabel, { marginTop: 14 }]}>
            Account Holder Full Name
          </Text>
          <TextInput
            ref={accountHolderInputRef}
            style={styles.textInput}
            value={accountHolderName}
            onFocus={() => scrollInputIntoView(410)}
            onChangeText={(t) => {
              setAccountHolderName(t);
              setIdempotencyKey('');
            }}
            placeholder="Juan Dela Cruz"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            editable={!activeWithdrawal}
          />

          {!isTestScenarioAccount && (
            <TouchableOpacity
              style={styles.saveToggleRow}
              onPress={() => setSaveDestination((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={saveDestination ? 'checkbox' : 'square-outline'}
                size={20}
                color={saveDestination ? ORANGE : colors.textMuted}
              />
              <Text style={styles.saveToggleText}>
                Save as my default {method === 'gcash' ? 'GCash' : 'Maya'}{' '}
                payout number
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            (!!validationError || !!activeWithdrawal) && { opacity: 0.5 },
          ]}
          onPress={handleProceedToConfirm}
          disabled={!!activeWithdrawal}
          activeOpacity={0.9}
        >
          <Text style={styles.primaryBtnText}>Review Cashout</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    loadingRoot: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: c.background,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,
      color: c.textSecondary,
      fontWeight: '600',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 14,
      backgroundColor: c.card,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: c.textPrimary,
      letterSpacing: -0.3,
    },
    closeCircleBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.divider,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 20,
    },
    balanceBanner: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: ORANGE,
      borderRadius: 20,
      padding: 20,
      marginBottom: 16,
      shadowColor: ORANGE,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 10,
      elevation: 4,
    },
    balanceBannerLabel: {
      fontSize: 10,
      fontWeight: '800',
      color: '#FFE4D2',
      letterSpacing: 1,
    },
    balanceBannerValue: {
      fontSize: 32,
      fontWeight: '900',
      color: '#FFFFFF',
      marginTop: 4,
      letterSpacing: -0.8,
    },
    maxChip: {
      backgroundColor: '#FFFFFF',
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
    },
    maxChipText: {
      fontSize: 12,
      fontWeight: '900',
      color: ORANGE,
      letterSpacing: 0.5,
    },
    activeLockCard: {
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: ORANGE,
      borderRadius: 16,
      padding: 14,
      marginBottom: 16,
      gap: 10,
    },
    activeLockTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: c.textPrimary,
    },
    activeLockSub: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: 2,
      fontWeight: '600',
    },
    activeLockBtn: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: c.card,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: ORANGE,
    },
    activeLockBtnText: {
      fontSize: 12,
      fontWeight: '800',
      color: ORANGE,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 20,
      padding: 18,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    sectionEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
      marginBottom: 12,
    },
    amountInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 2,
      borderBottomColor: c.border,
      paddingBottom: 8,
    },
    currencyPrefix: {
      fontSize: 28,
      fontWeight: '800',
      color: c.textSecondary,
      marginRight: 6,
    },
    amountInput: {
      flex: 1,
      fontSize: 34,
      fontWeight: '900',
      color: c.textPrimary,
      paddingVertical: 4,
    },
    limitHelperText: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 8,
      fontWeight: '500',
    },
    quickChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 14,
    },
    quickChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.border,
    },
    quickChipActive: {
      backgroundColor: c.accentSoft,
      borderColor: ORANGE,
    },
    quickChipText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.textSecondary,
    },
    quickChipTextActive: {
      color: ORANGE,
      fontWeight: '800',
    },
    methodGrid: {
      gap: 10,
    },
    methodOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.border,
      backgroundColor: c.background,
      gap: 12,
    },
    methodLogoBox: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: '#FFFFFF',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.divider,
    },
    methodTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: c.textPrimary,
    },
    methodSub: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 2,
      fontWeight: '500',
    },
    inputLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
      marginBottom: 6,
    },
    textInput: {
      backgroundColor: c.background,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontWeight: '700',
      color: c.textPrimary,
    },
    saveToggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 14,
    },
    saveToggleText: {
      flex: 1,
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: '600',
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: ORANGE,
      borderRadius: 16,
      paddingVertical: 16,
      marginTop: 6,
      shadowColor: ORANGE,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.28,
      shadowRadius: 8,
      elevation: 4,
    },
    primaryBtnText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.card,
      borderWidth: 1.5,
      borderColor: ORANGE,
      borderRadius: 16,
      paddingVertical: 14,
      marginBottom: 12,
    },
    secondaryBtnText: {
      color: ORANGE,
      fontSize: 14,
      fontWeight: '800',
    },
    cancelTextBtn: {
      alignItems: 'center',
      paddingVertical: 14,
      marginTop: 4,
    },
    cancelTextBtnLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: c.textSecondary,
    },
    confirmHero: {
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 20,
      padding: 24,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    confirmEyebrow: {
      fontSize: 10,
      fontWeight: '800',
      color: c.textMuted,
      letterSpacing: 1,
    },
    confirmAmount: {
      fontSize: 38,
      fontWeight: '900',
      color: c.textPrimary,
      marginVertical: 8,
      letterSpacing: -1,
    },
    confirmFeePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: c.successBg,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    confirmFeeText: {
      fontSize: 11,
      fontWeight: '700',
      color: c.success,
    },
    receiptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 11,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      gap: 12,
    },
    receiptLabel: {
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: '600',
    },
    receiptValue: {
      flexShrink: 1,
      fontSize: 13,
      color: c.textPrimary,
      fontWeight: '800',
      textAlign: 'right',
    },
    testScenarioBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: c.warningBg,
      borderWidth: 1,
      borderColor: c.warning,
      borderRadius: 14,
      padding: 12,
      marginBottom: 14,
    },
    testScenarioText: {
      flex: 1,
      fontSize: 11,
      color: c.warning,
      fontWeight: '600',
      lineHeight: 16,
    },
    warningNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 12,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    warningNoteText: {
      flex: 1,
      fontSize: 11,
      color: c.textSecondary,
      lineHeight: 16,
      fontWeight: '500',
    },
    resultHeroCard: {
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 22,
      padding: 24,
      marginBottom: 16,
      borderWidth: 1.5,
    },
    resultIconWrap: {
      width: 68,
      height: 68,
      borderRadius: 34,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 12,
    },
    resultStatusTitle: {
      fontSize: 17,
      fontWeight: '900',
      textAlign: 'center',
    },
    resultAmount: {
      fontSize: 34,
      fontWeight: '900',
      color: c.textPrimary,
      marginVertical: 6,
      letterSpacing: -0.8,
    },
    resultSubtext: {
      fontSize: 12,
      color: c.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
      fontWeight: '500',
      marginTop: 4,
    },
  });