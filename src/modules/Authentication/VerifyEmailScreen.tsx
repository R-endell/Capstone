// src/modules/Authentication/VerifyEmailScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Easing,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';

const ORANGE = '#F27024';

type VerifyEmailRouteParamList = {
  VerifyEmail: {
    access_token?: string;
    refresh_token?: string;
    code?: string;
  };
};
type VerifyEmailRoute = RouteProp<VerifyEmailRouteParamList, 'VerifyEmail'>;

export default function VerifyEmailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<VerifyEmailRoute>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const { access_token, refresh_token, code } = route.params || {};

  const [phase, setPhase] = useState<'verifying' | 'error' | 'success'>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [fadeAnim, glowAnim]);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      try {
        let error = null;

        if (code) {
          const res = await supabase.auth.exchangeCodeForSession(code);
          error = res.error;
        } else if (access_token && refresh_token) {
          const res = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          error = res.error;
        } else {
          throw new Error('Missing session tokens in the verification link.');
        }

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

        // Sign out so they have to log in manually
        await supabase.auth.signOut();

        // Show success, then route to Login
        setTimeout(() => {
          Alert.alert(
            'Email Verified!',
            'Your account has been successfully verified. Please log in to continue.',
            [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }]
          );
        }, 500);

      } catch (err: any) {
        if (cancelled) return;
        setErrorMsg(err.message || 'Verification failed.');
        setPhase('error');
      }
    }

    verify();
    return () => { cancelled = true; };
  }, [access_token, refresh_token, code, navigation]);

  const glowScale = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const fadeUpStyle = {
    opacity: fadeAnim,
    transform: [{
      translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }),
    }],
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity
        style={[styles.themeToggle, { top: insets.top + 12 }]}
        onPress={toggleDark}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View style={[styles.glow, styles.glowTop, { transform: [{ scale: glowScale }], opacity: glowOpacity }]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoid}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.contentWrapper, fadeUpStyle]}>
              
              {phase === 'verifying' && (
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator size="large" color={ORANGE} />
                  <Text style={[styles.subHeader, { marginTop: 16 }]}>Verifying your email…</Text>
                </View>
              )}

              {phase === 'error' && (
                <>
                  <View style={styles.successIconWrap}>
                    <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
                  </View>
                  <Text style={styles.header}>Verification Failed</Text>
                  <Text style={styles.subHeader}>{errorMsg}</Text>
                  
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryButtonText}>Back to Login</Text>
                  </TouchableOpacity>
                </>
              )}

              {phase === 'success' && (
                <>
                  <View style={styles.successIconWrap}>
                    <Ionicons name="checkmark-circle" size={64} color={ORANGE} />
                  </View>
                  <Text style={styles.header}>Email Verified!</Text>
                  <Text style={styles.subHeader}>
                    Your account has been successfully verified. Please log in to continue.
                  </Text>

                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Login' }] })}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.primaryButtonText}>Proceed to Login</Text>
                  </TouchableOpacity>
                </>
              )}

            </Animated.View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  keyboardAvoid: { flex: 1 },

  themeToggle: {
    position: 'absolute', right: 20, zIndex: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 6, elevation: 3,
  },

  backgroundLayer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: ORANGE },
  glowTop: { width: 360, height: 360, top: -160, right: -140 },
  glowBottom: { width: 300, height: 300, bottom: -140, left: -120, opacity: 0.05 },

  innerContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
  contentWrapper: { flex: 1, justifyContent: 'center' },

  header: { fontSize: 28, fontWeight: '700', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  subHeader: { fontSize: 15, color: c.textSecondary, fontWeight: '400', lineHeight: 22 },

  successIconWrap: { alignItems: 'center', marginBottom: 24 },

  primaryButton: {
    backgroundColor: ORANGE, height: 54, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 20, marginBottom: 20,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
});