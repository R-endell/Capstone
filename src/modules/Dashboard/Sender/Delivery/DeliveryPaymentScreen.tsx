// src/modules/Dashboard/Sender/Delivery/DeliveryPaymentScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, StatusBar, ScrollView, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
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

  // ---- DOUBLE-TAP GUARDS ----
  const payingRef = useRef(false);
  const navigatedRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { data: userData } = await supabase
          .from('users')
          .select('user_id')
          .eq('auth_id', user.id)
          .single();

        if (!userData) throw new Error('User profile not found');

        const list = await fetchPaymentMethods(userData.user_id);
        setMethods(list);

        const def = list.find((m) => m.is_default);
        if (def) setSelected(def.provider);
        else if (list[0]) setSelected(list[0].provider);
      } catch (e: any) {
        Alert.alert('Error', e.message || 'Failed to load payment methods');
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Navigate back to Booking at most once, no matter how many code paths trigger it
  const goBackToBooking = (rid: number) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    payingRef.current = false;
    setPaying(false);

    navigation.navigate('Booking', {
      paymentJustCompleted: true,
      requestId: rid,
    });
  };

  const handlePay = async () => {
    if (!selected) return;

    // Synchronous guard — no awaits before this check
    if (payingRef.current) return;
    payingRef.current = true;
    setPaying(true);

    try {
      const res = await chargeDelivery(requestId, selected);

      if (res.status === 'held') {
        goBackToBooking(requestId);
        return;
      }

      if (!res.payment_url) throw new Error('No payment URL returned');

      await WebBrowser.openBrowserAsync(res.payment_url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });

      // Clear any existing poll before starting a new one
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const status = await getDeliveryPaymentStatus(requestId);
          if (status.payment_status === 'held' || status.payment_status === 'released') {
            goBackToBooking(requestId);
            return;
          }
          if (status.payment_status === 'failed') {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            payingRef.current = false;
            setPaying(false);
            Alert.alert('Payment Failed', 'Your payment was declined. Please try another method.');
            return;
          }
        } catch (e) {
          console.warn('Poll error', e);
        }

        if (attempts >= 30) {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          payingRef.current = false;
          setPaying(false);
          Alert.alert(
            'Still Processing',
            'Your payment is taking longer than expected. Check Activity screen in a moment.',
          );
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

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          disabled={paying}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>TOTAL TO PAY</Text>
          <Text style={styles.amountValue}>₱{Number(amount).toFixed(2)}</Text>
          <Text style={styles.amountNote}>Held in escrow until delivery is confirmed</Text>
        </View>

        <Text style={styles.sectionTitle}>Choose payment method</Text>

        {methods.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="card-outline" size={36} color={ORANGE} />
            <Text style={styles.emptyText}>No payment methods linked</Text>
            <TouchableOpacity
              style={styles.linkBtn}
              onPress={() => navigation.navigate('AddPaymentMethod')}
            >
              <Text style={styles.linkBtnText}>Add Payment Method</Text>
            </TouchableOpacity>
          </View>
        ) : (
          methods.map((m) => {
            const isSelected = selected === m.provider;
            const label = m.provider === 'gcash' ? 'GCash' : 'Maya';
            const logo = m.provider === 'gcash' ? GCASH_LOGO : MAYA_LOGO;

            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.methodRow, isSelected && styles.methodRowSelected]}
                onPress={() => setSelected(m.provider)}
                activeOpacity={0.85}
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
                  name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={isSelected ? ORANGE : colors.textMuted}
                />
              </TouchableOpacity>
            );
          })
        )}

        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={16} color={isDark ? '#C4B5FD' : '#7C3AED'} />
          <Text style={styles.infoText}>
            Your payment is held securely and only released to the provider after delivery is confirmed.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          style={[styles.payBtn, (!selected || paying || methods.length === 0) && styles.payBtnDisabled]}
          onPress={handlePay}
          disabled={!selected || paying || methods.length === 0}
          activeOpacity={0.9}
        >
          {paying ? (
            <ActivityIndicator color={colors.card} />
          ) : (
            <>
              <Ionicons name="lock-closed" size={16} color={colors.card} />
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 16, backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: c.textPrimary },
  content: { padding: 20, paddingBottom: 40 },
  amountCard: {
    backgroundColor: c.card, borderRadius: 20, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: c.border, marginBottom: 24,
  },
  amountLabel: { fontSize: 11, fontWeight: '800', color: c.textSecondary, letterSpacing: 1 },
  amountValue: { fontSize: 36, fontWeight: '900', color: c.textPrimary, marginVertical: 8, letterSpacing: -1 },
  amountNote: { fontSize: 11, color: c.textSecondary, textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: c.textPrimary, marginBottom: 12 },
  methodRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
    borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 2, borderColor: c.border,
  },
  methodRowSelected: { borderColor: ORANGE, backgroundColor: c.accentSoft },
  methodIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  methodLogo: { width: 32, height: 32 },
  methodName: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
  methodDefault: { fontSize: 10, color: c.success, fontWeight: '700', marginTop: 2 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { marginTop: 12, fontSize: 13, color: c.textSecondary },
  linkBtn: { marginTop: 12, backgroundColor: ORANGE, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  linkBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: isDark ? '#231542' : '#F5F3FF',
    borderRadius: 12, padding: 12, marginTop: 20,
    borderWidth: 1, borderColor: isDark ? '#5B21B6' : '#DDD6FE',
  },
  infoText: { flex: 1, fontSize: 11, color: isDark ? '#C4B5FD' : '#5B21B6', fontWeight: '600', lineHeight: 15 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: c.card,
    borderTopWidth: 1, borderTopColor: c.border,
  },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.textPrimary, borderRadius: 16, paddingVertical: 16, gap: 8,
  },
  payBtnDisabled: { backgroundColor: c.textMuted },
  payBtnText: { color: c.card, fontSize: 16, fontWeight: '800' },
});