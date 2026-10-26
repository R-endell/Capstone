import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, StatusBar, ScrollView, Image, BackHandler, AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase';
import { fetchPaymentMethods, chargeDelivery, getDeliveryPaymentStatus } from '../../../../services/paymentService';
import type { PaymentMethod, PaymentProvider } from '../../../../types/payment';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

const GCASH_LOGO = require('../../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../../assets/maya.jpeg');
const ORANGE = '#F27024';

export default function DeliveryPaymentScreen({ route, navigation }: any) {
  const { requestId, amount } = route.params;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<PaymentProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const payingRef = useRef(false);
  const navigatedRef = useRef(false);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Resolve user_id once ----
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) return;
        const { data } = await supabase
          .from('users').select('user_id').eq('auth_id', user.id).single();
        if (active && data?.user_id) setUserId(data.user_id);
      } catch (e) { console.warn('[payment] userId lookup failed', e); }
    })();
    return () => { active = false; };
  }, []);

  // ---- Central loader (used by focus, realtime, and appstate) ----
  const applyList = useCallback((list: PaymentMethod[]) => {
    setMethods(list);
    setSelected(prev => {
      if (prev && list.some(m => m.provider === prev)) return prev;
      const def = list.find(m => m.is_default);
      return def ? def.provider : (list[0]?.provider || null);
    });
  }, []);

  const loadMethods = useCallback(async () => {
    if (!userId) return;
    try {
      const list = await fetchPaymentMethods(userId);
      applyList(list);
    } catch (e) {
      console.warn('[payment] fetch methods failed', e);
    } finally {
      setLoading(false);
    }
  }, [userId, applyList]);

  // ---- On focus: re-fetch ----
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      if (methods.length === 0) setLoading(true);
      loadMethods();
      // NOTE: do NOT include methods.length in deps — that causes loop.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, loadMethods]),
  );

  // ---- Realtime: catches the Xendit webhook the instant it fires ----
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`payment-methods-${userId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_payment_methods', filter: `user_id=eq.${userId}` },
        () => loadMethods(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, loadMethods]);

  // ---- AppState fallback: browser closed → poll 30s in case realtime is down ----
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !userId) return;
      if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
      let attempts = 0;
      bgPollRef.current = setInterval(async () => {
        attempts++;
        try {
          const list = await fetchPaymentMethods(userId);
          if (list.length > 0) {
            applyList(list);
            if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
            return;
          }
        } catch { /* ignore */ }
        if (attempts >= 20) {
          if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
        }
      }, 1500);
    });
    return () => {
      sub.remove();
      if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
    };
  }, [userId, applyList]);

  // ---- Cleanup status poll on unmount ----
  useEffect(() => {
    return () => {
      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
      if (bgPollRef.current) { clearInterval(bgPollRef.current); bgPollRef.current = null; }
    };
  }, []);

  // ---- Cleanup unpaid request on leave ----
  const cleanedUpRef = useRef(false);

  const handleBack = useCallback(async () => {
    // Block while a payment session is live, or once we've already
    // navigated away via goBackToBooking (payment success path).
    if (payingRef.current || navigatedRef.current) return;

    if (!cleanedUpRef.current) {
      cleanedUpRef.current = true;
      try {
        const { data: row } = await supabase
          .from('delivery_requests')
          .select('payment_status, payment_reference, delivery_status, cargo_id')
          .eq('request_id', requestId)
          .maybeSingle();
        const safeToDelete =
          row &&
          row.delivery_status === 'Pending' &&
          row.payment_status === 'unpaid' &&
          !row.payment_reference;

        if (safeToDelete) {
          const cargoId = row.cargo_id;
          const { error: delErr } = await supabase
            .from('delivery_requests')
            .delete()
            .eq('request_id', requestId);

          if (delErr) {
            console.warn('[payment] cleanup: delete request failed', delErr);
          } else if (cargoId) {
            await supabase
              .from('cargo_profiles')
              .delete()
              .eq('cargo_id', cargoId);
          }
          console.log('[payment] cleaned up unpaid request', requestId);
        }
      } catch (e) {
        console.warn('[payment] cleanup on leave failed', e);
      }
    }

    navigation.goBack();
  }, [requestId, navigation]);

  // Android hardware back — swallow during active payment.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (payingRef.current) return true; // block during payment
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack]);

  const goBackToBooking = (rid: number) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
    payingRef.current = false;
    setPaying(false);

    navigation.navigate('Booking', { paymentJustCompleted: true, requestId: rid });
  };

  const handlePay = async () => {
    if (!selected) return;
    if (payingRef.current) return;
    payingRef.current = true;
    setPaying(true);

    try {
      const res = await chargeDelivery(requestId, selected);

      if (res.status === 'held') { goBackToBooking(requestId); return; }
      if (!res.payment_url) throw new Error('No payment URL returned');

      await WebBrowser.openBrowserAsync(res.payment_url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });

      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
      let attempts = 0;
      statusPollRef.current = setInterval(async () => {
        attempts++;
        try {
          const status = await getDeliveryPaymentStatus(requestId);
          if (status.payment_status === 'held' || status.payment_status === 'released') {
            goBackToBooking(requestId); return;
          }
          if (status.payment_status === 'failed') {
            if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
            payingRef.current = false; setPaying(false);
            Alert.alert('Payment Failed', 'Your payment was declined. Please try another method.');
            return;
          }
        } catch (e) { console.warn('Poll error', e); }
        if (attempts >= 30) {
          if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
          payingRef.current = false; setPaying(false);
          Alert.alert('Still Processing', 'Your payment is taking longer than expected. Check Activity screen in a moment.');
        }
      }, 2000);
    } catch (e: any) {
      payingRef.current = false;
      setPaying(false);
      Alert.alert('Payment Failed', e.message || 'Something went wrong');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={ORANGE} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn} disabled={paying} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ---- total ---- */}
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>TOTAL TO PAY</Text>
          <Text style={styles.amountValue}>₱{Number(amount).toFixed(2)}</Text>
          <View style={styles.escrowRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.success} />
            <Text style={styles.amountNote}>
              Held in escrow and released to the provider only after delivery is confirmed
            </Text>
          </View>
        </View>

        {/* ---- methods ---- */}
        <Text style={styles.sectionLabel}>PAYMENT METHOD</Text>

        {methods.length === 0 ? (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIconBox}>
              <Ionicons name="card-outline" size={34} color={ORANGE} />
            </View>
            <Text style={styles.emptyTitle}>No payment methods linked</Text>
            <Text style={styles.emptyText}>Link GCash or Maya to pay for this delivery.</Text>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => navigation.navigate('AddPaymentMethod')}
              activeOpacity={0.9}
            >
              <Text style={styles.linkBtnText}>Add payment method</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.methodList}>
            {methods.map((m, i) => {
              const isSelected = selected === m.provider;
              const label = m.provider === 'gcash' ? 'GCash' : 'Maya';
              const logo = m.provider === 'gcash' ? GCASH_LOGO : MAYA_LOGO;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.methodRow,
                    isSelected && styles.methodRowSelected,
                    i === methods.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => setSelected(m.provider)}
                  activeOpacity={0.7}
                  disabled={paying}
                >
                  <View style={styles.methodIcon}>
                    <Image source={logo} style={styles.methodLogo} resizeMode="contain" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodName}>{label}</Text>
                    {m.is_default && <Text style={styles.methodDefault}>Default</Text>}
                  </View>
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={isSelected ? ORANGE : colors.textMuted}
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[styles.payBtn, (!selected || paying || methods.length === 0) && styles.payBtnDisabled]}
          onPress={handlePay}
          disabled={!selected || paying || methods.length === 0}
          activeOpacity={0.9}
        >
          {paying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="lock-closed" size={16} color="#FFFFFF" />
              <Text style={styles.payBtnText}>Pay ₱{Number(amount).toFixed(2)}</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  /* header (same as the receiver picker / location screens) */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4 },

  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },

  /* total */
  amountCard: {
    backgroundColor: c.card, borderRadius: 18, paddingVertical: 22, paddingHorizontal: 20,
    alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 6, elevation: 2,
  },
  amountLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  amountValue: { fontSize: 38, fontWeight: '900', color: ORANGE, marginVertical: 6, letterSpacing: -1 },
  escrowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 8 },
  amountNote: { flexShrink: 1, fontSize: 12, lineHeight: 17, color: c.textSecondary, textAlign: 'center', fontWeight: '500' },

  /* methods */
  sectionLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1, marginBottom: 8, paddingHorizontal: 4 },
  methodList: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  methodRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: c.divider, backgroundColor: c.card,
  },
  methodRowSelected: { backgroundColor: 'rgba(242,112,36,0.09)' },
  methodIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  methodLogo: { width: 30, height: 30 },
  methodName: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  methodDefault: { fontSize: 12, color: c.success, fontWeight: '700', marginTop: 2 },

  /* empty */
  emptyBox: {
    alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24,
    backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.border,
  },
  emptyIconBox: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(242,112,36,0.09)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary, marginBottom: 4 },
  emptyText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  linkBtn: {
    marginTop: 18, backgroundColor: ORANGE, borderRadius: 30, paddingHorizontal: 26, paddingVertical: 13,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  linkBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, letterSpacing: 0.2 },

  /* footer */
  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.divider },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 16,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  payBtnDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  payBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
});