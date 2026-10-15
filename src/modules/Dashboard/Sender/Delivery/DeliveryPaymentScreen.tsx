import React, { useState, useEffect, useRef } from 'react';
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

// ── Payment provider logos ──────────────────────────────────────────
const GCASH_LOGO = require('../../../../../assets/gcash.png');
const MAYA_LOGO = require('../../../../../assets/maya.jpeg');

const ORANGE = '#F27024';

export default function DeliveryPaymentScreen({ route, navigation }: any) {
  const { requestId, amount } = route.params;
  const insets = useSafeAreaInsets();

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selected, setSelected] = useState<PaymentProvider | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const payingRef = useRef(false); // synchronous guard against double-tap

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
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handlePay = async () => {
    if (!selected) return;
    if (payingRef.current) return; // hard block re-entry
    payingRef.current = true;
    setPaying(true);

    try {
      const res = await chargeDelivery(requestId, selected);

      if (res.status === 'held') {
        navigation.navigate('Booking', { paymentJustCompleted: true, requestId });
        return;
      }

      if (!res.payment_url) throw new Error('No payment URL returned');

      await WebBrowser.openBrowserAsync(res.payment_url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });

      // Start polling for webhook confirmation
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        try {
          const status = await getDeliveryPaymentStatus(requestId);
          if (status.payment_status === 'held' || status.payment_status === 'released') {
            if (pollRef.current) clearInterval(pollRef.current);
            payingRef.current = false;
            setPaying(false);
            navigation.navigate('Booking', { paymentJustCompleted: true, requestId });
            return;
          }
          if (status.payment_status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            payingRef.current = false;
            setPaying(false);
            Alert.alert('Payment Failed', 'Your payment was declined. Please try another method.');
            return;
          }
        } catch (e) {
          console.warn('Poll error', e);
        }
        if (attempts >= 30) { // 30 × 2s = 60s
          if (pollRef.current) clearInterval(pollRef.current);
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
        <ActivityIndicator size="large" color={ORANGE} style={{ marginTop: 100 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} disabled={paying}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
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
                  color={isSelected ? ORANGE : '#D1D5DB'}
                />
              </TouchableOpacity>
            );
          })
        )}

        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#7C3AED" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#FFFFFF',
    borderBottomWidth: 1, borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  content: { padding: 20, paddingBottom: 40 },
  amountCard: {
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 24,
  },
  amountLabel: { fontSize: 11, fontWeight: '800', color: '#6B7280', letterSpacing: 1 },
  amountValue: { fontSize: 36, fontWeight: '900', color: '#111827', marginVertical: 8, letterSpacing: -1 },
  amountNote: { fontSize: 11, color: '#6B7280', textAlign: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '800', color: '#374151', marginBottom: 12 },
  methodRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF',
    borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 2, borderColor: '#E5E7EB',
  },
  methodRowSelected: { borderColor: ORANGE, backgroundColor: '#FFF7ED' },
  methodIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: '#E5E7EB', overflow: 'hidden',
  },
  methodLogo: { width: 32, height: 32 },
  methodName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  methodDefault: { fontSize: 10, color: '#10B981', fontWeight: '700', marginTop: 2 },
  emptyBox: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { marginTop: 12, fontSize: 13, color: '#6B7280' },
  linkBtn: { marginTop: 12, backgroundColor: ORANGE, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10 },
  linkBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F5F3FF',
    borderRadius: 12, padding: 12, marginTop: 20, borderWidth: 1, borderColor: '#DDD6FE',
  },
  infoText: { flex: 1, fontSize: 11, color: '#5B21B6', fontWeight: '600', lineHeight: 15 },
  footer: {
    paddingHorizontal: 20, paddingTop: 12, backgroundColor: '#FFFFFF',
    borderTopWidth: 1, borderTopColor: '#E5E7EB',
  },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#111827', borderRadius: 16, paddingVertical: 16, gap: 8,
  },
  payBtnDisabled: { backgroundColor: '#9CA3AF' },
  payBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});