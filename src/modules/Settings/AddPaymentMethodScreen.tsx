// src/modules/Dashboard/Sender/AddPaymentMethodScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  ScrollView,
} from 'react-native';
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

      const { data: userData } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();

      if (!userData) throw new Error('User not found');

      const url = await createLinkSession(userData.user_id, provider);
      await WebBrowser.openBrowserAsync(url, {
        dismissButtonStyle: 'close',
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
      });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Linking Failed', err.message || 'Something went wrong.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* Fixed Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment Method</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Content */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Hero / Intro Card */}
        <View style={styles.introCard}>
          <View style={styles.introIconBox}>
            <Ionicons name="shield-checkmark" size={22} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Secure Wallet Linking</Text>
            <Text style={styles.introSubtitle}>
              Link your GCash or Maya account to enable faster, one-tap payments.
              You will be redirected to your wallet to authorize the link.
            </Text>
          </View>
        </View>

        {/* Section title */}
        <Text style={styles.sectionTitle}>Choose a Provider</Text>

        {/* GCash Card */}
        <TouchableOpacity
          style={styles.providerCard}
          onPress={() => handleLink('gcash')}
          disabled={loading !== null}
          activeOpacity={0.85}
        >
          <View style={[styles.providerIcon, { backgroundColor: '#E0F2FE' }]}>
            <Ionicons name="phone-portrait" size={26} color="#0284C7" />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>GCash</Text>
            <Text style={styles.providerDesc}>Link your GCash wallet</Text>
          </View>
          {loading === 'gcash' ? (
            <ActivityIndicator color={ORANGE} />
          ) : (
            <View style={styles.chevronCircle}>
              <Ionicons name="chevron-forward" size={16} color="#6B7280" />
            </View>
          )}
        </TouchableOpacity>

        {/* Maya Card */}
        <TouchableOpacity
          style={styles.providerCard}
          onPress={() => handleLink('maya')}
          disabled={loading !== null}
          activeOpacity={0.85}
        >
          <View style={[styles.providerIcon, { backgroundColor: '#ECFDF5' }]}>
            <Ionicons name="wallet" size={26} color="#059669" />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>Maya</Text>
            <Text style={styles.providerDesc}>Link your Maya wallet</Text>
          </View>
          {loading === 'maya' ? (
            <ActivityIndicator color={ORANGE} />
          ) : (
            <View style={styles.chevronCircle}>
              <Ionicons name="chevron-forward" size={16} color="#6B7280" />
            </View>
          )}
        </TouchableOpacity>

        {/* Info footer */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={16} color="#6B7280" />
          <Text style={styles.infoText}>
            Your wallet credentials are never stored on our servers. Linking is handled
            securely by our payment partner.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  /* ---------- Header ---------- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },

  /* ---------- Content ---------- */
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  /* ---------- Intro card ---------- */
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  introIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  introTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  introSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
    fontWeight: '500',
  },

  /* ---------- Section ---------- */
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    letterSpacing: -0.3,
  },

  /* ---------- Provider cards ---------- */
  providerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  providerIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  providerInfo: { flex: 1 },
  providerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  providerDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 3,
    fontWeight: '500',
  },
  chevronCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ---------- Info footer ---------- */
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 16,
    fontWeight: '500',
  },
});