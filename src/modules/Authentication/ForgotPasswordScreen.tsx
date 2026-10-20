// src/modules/Authentication/ForgotPasswordScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { validateEmail } from '../../utils/passwordValidation';

const ORANGE = '#F27024';
const REDIRECT_TO = 'packnship://reset-password';
const COOLDOWN_SECONDS = 60;

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [cooldown, setCooldown] = useState(0);

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
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const getFriendlyError = (error: any) => {
    const msg = error?.message || '';
    if (msg.includes('rate limit') || msg.includes('Too many requests')) {
      return 'Too many requests. Please wait a few minutes and try again.';
    }
    if (msg.includes('network')) {
      return 'Network error. Please check your connection.';
    }
    return 'Something went wrong. Please try again.';
  };

  const handleSend = async () => {
    const validation = validateEmail(email);
    if (validation) {
      setEmailError(validation);
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: REDIRECT_TO,
      });

      // For security, we always show the same neutral state even if the email
      // doesn't exist. Only surface real errors like rate limits / network.
      if (error && (error.message.includes('rate') || error.message.includes('network'))) {
        Alert.alert('Please Wait', getFriendlyError(error));
        return;
      }

      setSentTo(email.trim().toLowerCase());
      setSent(true);
      setCooldown(COOLDOWN_SECONDS);
    } catch (err: any) {
      Alert.alert('Error', getFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

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
              {!sent ? (
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Ionicons name="lock-closed-outline" size={36} color={ORANGE} />
                    </View>
                    <Text style={styles.header}>Forgot Password?</Text>
                    <Text style={styles.subHeader}>
                      Enter the email associated with your account and we'll send you a link to reset
                      your password.
                    </Text>
                  </View>

                  <View style={styles.formContainer}>
                    <View style={[
                      styles.inputWrapper,
                      focusedInput === 'email' && styles.inputFocused,
                      emailError && styles.inputError,
                    ]}>
                      <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Email Address"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        value={email}
                        onChangeText={(t) => { setEmail(t); setEmailError(validateEmail(t)); }}
                        onFocus={() => setFocusedInput('email')}
                        onBlur={() => setFocusedInput(null)}
                        editable={!loading}
                      />
                    </View>
                    {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleSend}
                    disabled={loading}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.linkContainer}
                    onPress={() => navigation.navigate('Login')}
                    disabled={loading}
                  >
                    <Text style={styles.link}>
                      Remembered it? <Text style={styles.linkBold}>Back to Login</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.successIconWrap}>
                    <Ionicons name="checkmark-circle" size={64} color={ORANGE} />
                  </View>
                  <Text style={styles.header}>Check your email</Text>
                  <Text style={styles.subHeader}>
                    If an account exists for{' '}
                    <Text style={styles.emailHighlight}>{sentTo}</Text>, we've sent a password
                    reset link. The link will expire in 1 hour.
                  </Text>
                  <Text style={styles.helperText}>
                    Didn't receive it? Check your spam folder, or try again below.
                  </Text>

                  <TouchableOpacity
                    style={[styles.primaryButton, (loading || cooldown > 0) && styles.buttonDisabled]}
                    onPress={handleSend}
                    disabled={loading || cooldown > 0}
                    activeOpacity={0.8}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Link'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.linkContainer}
                    onPress={() => navigation.navigate('Login')}
                  >
                    <Text style={styles.link}>
                      <Text style={styles.linkBold}>Back to Login</Text>
                    </Text>
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

  headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
  brandRow: { marginBottom: 16 },
  header: { fontSize: 28, fontWeight: '700', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  subHeader: { fontSize: 15, color: c.textSecondary, fontWeight: '400', lineHeight: 22 },
  emailHighlight: { color: c.textPrimary, fontWeight: '600' },
  helperText: { fontSize: 13, color: c.textMuted, marginTop: 12, marginBottom: 20, lineHeight: 18 },

  formContainer: { marginBottom: 16 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
    borderRadius: 12, marginBottom: 12, height: 52,
  },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, height: '100%', fontSize: 15, color: c.textPrimary },
  inputFocused: { borderColor: ORANGE },
  inputError: { borderColor: c.error, backgroundColor: c.errorBg },
  errorText: { color: c.error, fontSize: 12, fontWeight: '500', marginTop: -8, marginBottom: 10, marginLeft: 4 },

  primaryButton: {
    backgroundColor: ORANGE, height: 54, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },

  linkContainer: { alignItems: 'center', paddingVertical: 8 },
  link: { color: c.textSecondary, fontSize: 14 },
  linkBold: { color: ORANGE, fontWeight: '600' },

  successIconWrap: { alignItems: 'center', marginBottom: 24 },
});