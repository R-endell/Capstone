// src/modules/Dashboard/Sender/Settings_Sender/PaymentMethodsScreen.tsx
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../utils/supabase';
import {
  fetchPaymentMethods,
  unlinkPaymentMethod,
  setDefaultPaymentMethod,
} from '../../services/paymentService';
import { PaymentMethod } from '../../types/payment';
import PaymentMethodCard from './PaymentMethodCard';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { SolarIcon } from '../../components/ui/SolarIcon';

export default function PaymentMethodsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<number | null>(null);

  const loadMethods = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();
    if (!userData) return;
    setUserId(userData.user_id);
    const data = await fetchPaymentMethods(userData.user_id);
    setMethods(data);
  }, []);

  // Load on focus
  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadMethods().finally(() => setLoading(false));
    }, [loadMethods])
  );

  // REALTIME: Automatically update if webhook fires while on this screen
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`payment-methods-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_payment_methods', filter: `user_id=eq.${userId}` },
        () => loadMethods()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, loadMethods]);

  const handleSetDefault = async (provider: 'gcash' | 'maya') => {
    if (!userId) return;
    try {
      await setDefaultPaymentMethod(userId, provider);
      await loadMethods();
    } catch {
      Alert.alert('Error', 'Failed to set default.');
    }
  };

  const handleUnlink = (provider: 'gcash' | 'maya') => {
    Alert.alert(
      'Unlink Payment Method',
      `Unlink your ${provider === 'gcash' ? 'GCash' : 'Maya'} account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            if (!userId) return;
            try {
              await unlinkPaymentMethod(userId, provider);
              await loadMethods();
            } catch {
              Alert.alert('Error', 'Failed to unlink.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : methods.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <SolarIcon name="Card" variant="duotone" size={40} color={colors.accent} />
            </View>
            <Text style={styles.emptyTitle}>No payment methods linked</Text>
            <Text style={styles.emptySubtext}>
              Link your GCash or Maya account for faster checkout.
            </Text>
          </View>
        ) : (
          methods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              method={method}
              onSetDefault={() => handleSetDefault(method.provider)}
              onUnlink={() => handleUnlink(method.provider)}
            />
          ))
        )}

        <TouchableOpacity
          style={styles.addButton}
          onPress={() => navigation.navigate('AddPaymentMethod')}
          activeOpacity={0.85}
        >
          <SolarIcon name="AddCircle" variant="linear" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Add Payment Method</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },

  content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40 },
  center: { paddingVertical: 60, alignItems: 'center' },

  emptyContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 4 },
  emptySubtext: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', lineHeight: 18 },

  addButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14, marginTop: 12, gap: 8,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  addButtonText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Poppins_700Bold' },
});