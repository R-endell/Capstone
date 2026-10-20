// src/modules/Authentication/VerifyEmailScreen.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { resolveHomeRoute } from '../../utils/resolveHomeRoute';

const ORANGE = '#F27024';

type VerifyEmailRouteParamList = {
  VerifyEmail: {
    token_hash: string;
    type: string;
  };
};
type VerifyEmailRoute = RouteProp<VerifyEmailRouteParamList, 'VerifyEmail'>;

export default function VerifyEmailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<VerifyEmailRoute>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const { token_hash, type } = route.params || {};

  const [phase, setPhase] = useState<'verifying' | 'error' | 'success'>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        if (!token_hash || !type) {
          throw new Error('Missing token or type in link.');
        }

        // Verify the OTP token sent by SendGrid/Supabase
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash,
          type: type as any, // usually 'signup' or 'email'
        });

        if (cancelled) return;

        if (error) {
          const msg = (error.message || '').toLowerCase();
          const friendly = msg.includes('expired')
            ? 'This verification link has expired. Please log in to request a new one.'
            : msg.includes('invalid') || msg.includes('token')
            ? 'This verification link is invalid or has already been used.'
            : 'We could not verify your email. Please try again.';
          setErrorMsg(friendly);
          setPhase('error');
          return;
        }

        // Successfully verified!
        setPhase('success');

        // Wait 1.5 seconds, then route them to their home screen
        setTimeout(async () => {
          let targetRoute: 'MainTabs' | 'ProviderTabs' | 'Login' = 'Login';
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              targetRoute = await resolveHomeRoute(session.user.id);
            }
          } catch (e) {
            console.warn('[VerifyEmail] resolveHomeRoute failed:', e);
          }
          navigation.reset({ index: 0, routes: [{ name: targetRoute }] });
        }, 1500);

      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err.message || 'Verification failed.');
        setPhase('error');
      }
    }

    verify();
    return () => { cancelled = true; };
  }, [token_hash, type, navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.centerBlock}>
        {phase === 'verifying' && (
          <>
            <ActivityIndicator size="large" color={ORANGE} />
            <Text style={styles.text}>Verifying your email…</Text>
          </>
        )}

        {phase === 'error' && (
          <>
            <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
            <Text style={[styles.title, { color: colors.textPrimary }]}>Verification Failed</Text>
            <Text style={styles.text}>{errorMsg}</Text>
            <TouchableOpacity 
              style={styles.button} 
              onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
            >
              <Text style={styles.buttonText}>Back to Login</Text>
            </TouchableOpacity>
          </>
        )}

        {phase === 'success' && (
          <>
            <Ionicons name="checkmark-circle" size={72} color={ORANGE} />
            <Text style={[styles.title, { color: colors.textPrimary }]}>Email Verified!</Text>
            <Text style={styles.text}>Your account is ready. Taking you to your dashboard…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, justifyContent: 'center' },
  centerBlock: { alignItems: 'center', paddingHorizontal: 32 },
  title: { fontSize: 24, fontWeight: '700', marginTop: 16, marginBottom: 8, textAlign: 'center' },
  text: { fontSize: 15, color: c.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 22 },
  button: { backgroundColor: ORANGE, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 24 },
  buttonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 15 },
});