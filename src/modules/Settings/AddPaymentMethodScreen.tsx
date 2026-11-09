// src/modules/Dashboard/Sender/Settings_Sender/AddPaymentMethodScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert,
  StatusBar, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../../utils/supabase';
import { createLinkSession, fetchPaymentMethods } from '../../services/paymentService';
import type { PaymentProvider } from '../../types/payment';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { SolarIcon } from '../../components/ui/SolarIcon';

const GCASH_LOGO = require('../../../assets/gcash.png');
const MAYA_LOGO = require('../../../assets/maya.png');

export default function AddPaymentMethodScreen() {
  const navigation = useNavigation<any>();
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
      
      // Browser closed. Wait for the Xendit webhook to hit our DB.
      // Poll every 1 second for up to 15 seconds.
      let linked = false;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const methods = await fetchPaymentMethods(userData.user_id);
        if (methods.some((m: any) => m.provider === provider)) {
          linked = true;
          break;
        }
      }
      
      if (linked) {
        Alert.alert('Success', `${provider === 'gcash' ? 'GCash' : 'Maya'} linked successfully!`);
      } else {
        Alert.alert(
          'Pending', 
          'The link is taking a bit longer to process. Please check your payment methods in a few moments.'
        );
      }
      
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Linking Failed', err.message || 'Something went wrong.');
    } finally { setLoading(null); }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment Method</Text>
        <View style={{ width: 42 }} />
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
            ? <ActivityIndicator color={colors.accent} />
            : <SolarIcon name="AltArrowRight" variant="linear" size={20} color={colors.textMuted} />}
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
            ? <ActivityIndicator color={colors.accent} />
            : <SolarIcon name="AltArrowRight" variant="linear" size={20} color={colors.textMuted} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
  content: { padding: 20 },
  subtitle: {
    fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 20,
    marginBottom: 24, textAlign: 'center',
  },
  providerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 12, padding: 18, marginBottom: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 8, elevation: 0,
  },
  providerIcon: {
    width: 52, height: 52, borderRadius: 12,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden',
  },
  providerLogo: { width: 40, height: 40 },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  providerDesc: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
});