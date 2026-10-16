import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  StatusBar, Image,
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
import { useTheme, ThemeColors } from '../../utils/themeContext';

const GCASH_LOGO = require('../../../assets/gcash.png');
const MAYA_LOGO = require('../../../assets/maya.jpeg');

const ORANGE = '#FF751F';

export default function AddPaymentMethodScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

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
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment Method</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.subtitle}>
          Link your GCash or Maya account to enable faster, one-tap payments. You will be redirected to your wallet to authorize the link.
        </Text>

        <TouchableOpacity
          style={styles.providerCard}
          onPress={() => handleLink('gcash')}
          disabled={loading !== null}
          activeOpacity={0.8}
        >
          <View style={styles.providerIcon}>
            <Image source={GCASH_LOGO} style={styles.providerLogo} resizeMode="contain" />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>GCash</Text>
            <Text style={styles.providerDesc}>Link your GCash wallet</Text>
          </View>
          {loading === 'gcash'
            ? <ActivityIndicator color={ORANGE} />
            : <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.providerCard}
          onPress={() => handleLink('maya')}
          disabled={loading !== null}
          activeOpacity={0.8}
        >
          <View style={styles.providerIcon}>
            <Image source={MAYA_LOGO} style={styles.providerLogo} resizeMode="contain" />
          </View>
          <View style={styles.providerInfo}>
            <Text style={styles.providerName}>Maya</Text>
            <Text style={styles.providerDesc}>Link your Maya wallet</Text>
          </View>
          {loading === 'maya'
            ? <ActivityIndicator color={ORANGE} />
            : <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />}
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
  content: { padding: 20 },
  subtitle: {
    fontSize: 13, color: c.textSecondary, lineHeight: 20,
    marginBottom: 24, textAlign: 'center',
  },
  providerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 16, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 8, elevation: 2,
  },
  providerIcon: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 16, borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  providerLogo: { width: 40, height: 40 },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  providerDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
});