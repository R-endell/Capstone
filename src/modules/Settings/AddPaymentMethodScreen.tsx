import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { createLinkSession } from '../../services/paymentService';
import type { PaymentProvider } from '../../types/payment';

const ORANGE = '#FF751F';

export default function AddPaymentMethodScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState<PaymentProvider | null>(null);

  const handleLink = async (provider: PaymentProvider) => {
    try {
      setLoading(provider);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: userData } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
      if (!userData) throw new Error('User not found');

      const url = await createLinkSession(userData.user_id, provider);
      await WebBrowser.openBrowserAsync(url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Linking Failed', err.message || 'Something went wrong.');
    } finally { setLoading(null); }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment Method</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.content}>
        <Text style={styles.subtitle}>
          Link your GCash or Maya account to enable faster, one-tap payments. You will be redirected to your wallet to authorize the link.
        </Text>
        <TouchableOpacity style={styles.providerCard} onPress={() => handleLink('gcash')} disabled={loading !== null} activeOpacity={0.8}>
          <View style={[styles.providerIcon, { backgroundColor: '#E0F2FE' }]}><Ionicons name="phone-portrait" size={28} color="#0284C7" /></View>
          <View style={styles.providerInfo}><Text style={styles.providerName}>GCash</Text><Text style={styles.providerDesc}>Link your GCash wallet</Text></View>
          {loading === 'gcash' ? <ActivityIndicator color={ORANGE} /> : <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />}
        </TouchableOpacity>
        <TouchableOpacity style={styles.providerCard} onPress={() => handleLink('maya')} disabled={loading !== null} activeOpacity={0.8}>
          <View style={[styles.providerIcon, { backgroundColor: '#ECFDF5' }]}><Ionicons name="wallet" size={28} color="#059669" /></View>
          <View style={styles.providerInfo}><Text style={styles.providerName}>Maya</Text><Text style={styles.providerDesc}>Link your Maya wallet</Text></View>
          {loading === 'maya' ? <ActivityIndicator color={ORANGE} /> : <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F3F4F6', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  content: { padding: 20 },
  subtitle: { fontSize: 13, color: '#6B7280', lineHeight: 20, marginBottom: 24, textAlign: 'center' },
  providerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E5E7EB', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  providerIcon: { width: 52, height: 52, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 16, fontWeight: '700', color: '#111827' },
  providerDesc: { fontSize: 12, color: '#6B7280', marginTop: 2 },
});