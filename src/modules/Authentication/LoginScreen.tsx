// src/modules/Authentication/LoginScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  Keyboard, Alert, Image, ActivityIndicator, Animated, Easing, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { registerPushToken } from '../../services/pushService';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { resolveHomeRoute, clearLastMode } from '../../utils/resolveHomeRoute';

WebBrowser.maybeCompleteAuthSession();

const ORANGE = '#F27024';

export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 500,
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

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) return 'Email is required';
    if (!emailRegex.test(email)) return 'Please enter a valid email address';
    return '';
  };

  const validatePassword = (password: string) => {
    if (!password) return 'Password is required';
    if (password.length < 8) return 'Password must be at least 8 characters';
    return '';
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError(validateEmail(text));
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordError(validatePassword(text));
  };

  const togglePasswordVisibility = () => setShowPassword(!showPassword);

  const getFriendlyErrorMessage = (error: any) => {
    const message = error?.message || '';
    if (message.includes('Invalid login credentials')) return 'Invalid email or password. Please try again.';
    if (message.includes('Email not confirmed')) return 'Please verify your email address before logging in. Check your inbox.';
    if (message.includes('Too many requests')) return 'Too many login attempts. Please try again later.';
    if (message.includes('User not found')) return 'No account found with this email. Please sign up first.';
    if (message.includes('network')) return 'Network error. Please check your internet connection.';
    return 'Something went wrong. Please try again.';
  };

  const handleLogin = async () => {
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password);
    if (emailValidation) { setEmailError(emailValidation); return; }
    if (passwordValidation) { setPasswordError(passwordValidation); return; }

    setLoading(true);
    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        Alert.alert('Login Failed', getFriendlyErrorMessage(error));
        return;
      }

      // A fresh login never inherits another session's mode; Provider is only
      // restored for an approved provider whose own last mode was "provider".
      const loggedInId = signInData?.user?.id;
      const route = loggedInId ? await resolveHomeRoute(loggedInId) : (await clearLastMode(), 'MainTabs' as const);

      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const { data: userRow } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
          if (userRow?.user_id) await registerPushToken(userRow.user_id);
        } catch (e) {
          console.warn('[push] registration skipped:', e);
        }
      })();

      navigation.reset({ index: 0, routes: [{ name: route }] });
    } catch (error: any) {
      Alert.alert('Error', getFriendlyErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const redirectTo = 'packnship://auth/callback';
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });

      if (error) throw error;
      if (!data?.url) throw new Error('No OAuth URL returned');

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const code = url.searchParams.get('code');
        if (!code) throw new Error('No auth code in redirect URL');

        const { data: exchangeData, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;

        if (exchangeData?.session) {
          const route = await resolveHomeRoute(exchangeData.session.user.id);

          (async () => {
            try {
              const uid = exchangeData.session.user.id;
              const { data: userRow } = await supabase.from('users').select('user_id').eq('auth_id', uid).maybeSingle();
              if (userRow?.user_id) await registerPushToken(userRow.user_id);
            } catch (e) {
              console.warn('[push] google registration skipped:', e);
            }
          })();

          navigation.reset({ index: 0, routes: [{ name: route }] });
        } else {
          Alert.alert('Error', 'Could not retrieve session.');
        }
      } else if (result.type === 'cancel') {
        Alert.alert('Cancelled', 'Google login was cancelled.');
      }
    } catch (error: any) {
      console.error('Google login error:', error);
      Alert.alert('Google Login Failed', error.message || 'Something went wrong.');
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
      {/* Dark mode toggle — top-right */}
      <TouchableOpacity
        style={[styles.themeToggle, { top: insets.top + 12 }]}
        onPress={toggleDark}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={isDark ? 'sunny-outline' : 'moon-outline'}
          size={20}
          color={colors.textPrimary}
        />
      </TouchableOpacity>

      {/* Ambient Background Glows */}
      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View
          style={[styles.glow, styles.glowTop, { transform: [{ scale: glowScale }], opacity: glowOpacity }]}
        />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoid}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.contentWrapper, fadeUpStyle]}>
              <View style={styles.headerContainer}>
                <View style={styles.brandRow}>
                  <Image source={require('../../../assets/Pack-N-Ship-Logo2.png')} style={styles.logoImage} resizeMode="contain" />
                  <Text style={styles.brandText}>
                    Pack-<Text style={styles.brandTextOrange}>N-Ship</Text>
                  </Text>
                </View>
                <Text style={styles.header}>Welcome Back</Text>
                <Text style={styles.subHeader}>Log in to manage your deliveries and track packages.</Text>
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
                    value={email}
                    onChangeText={handleEmailChange}
                    onFocus={() => setFocusedInput('email')}
                    onBlur={() => setFocusedInput(null)}
                    editable={!loading}
                  />
                </View>
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                <View style={[
                  styles.inputWrapper,
                  focusedInput === 'password' && styles.inputFocused,
                  passwordError && styles.inputError,
                ]}>
                  <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                    editable={!loading}
                  />
                  <TouchableOpacity style={styles.eyeButton} onPress={togglePasswordVisibility} disabled={loading}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                <TouchableOpacity
                  style={styles.forgotPasswordButton}
                  disabled={loading}
                  onPress={() => navigation.navigate('ForgotPassword')}
                >
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.loginButton, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.loginText}>Log In</Text>}
              </TouchableOpacity>

              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <TouchableOpacity
                style={[styles.googleButton, loading && styles.buttonDisabled]}
                onPress={handleGoogleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Image source={require('../../../assets/google.png')} style={styles.googleIcon} resizeMode="contain" />
                <Text style={styles.googleText}>Continue With Google</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.signUpContainer}
                onPress={() => navigation.navigate('Register')}
                disabled={loading}
              >
                <Text style={styles.signUpText}>
                  Don't have an account? <Text style={styles.signUpTextBold}>Sign Up</Text>
                </Text>
              </TouchableOpacity>
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
    position: 'absolute',
    right: 20,
    zIndex: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.4 : 0.08,
    shadowRadius: 6,
    elevation: 3,
  },

  backgroundLayer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: ORANGE },
  glowTop: { width: 360, height: 360, top: -160, right: -140 },
  glowBottom: { width: 300, height: 300, bottom: -140, left: -120, opacity: 0.05 },

  innerContainer: {
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40,
    flexGrow: 1, justifyContent: 'center',
  },
  contentWrapper: { flex: 1, justifyContent: 'center' },

  headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  logoImage: { width: 54, height: 54 },
  brandText: {
    fontSize: 22, fontWeight: '800', fontStyle: 'italic',
    color: c.textPrimary, letterSpacing: -0.3,
  },
  brandTextOrange: { color: ORANGE },
  header: {
    fontSize: 28, fontWeight: '700', color: c.textPrimary,
    marginBottom: 6, letterSpacing: -0.5,
  },
  subHeader: { fontSize: 15, color: c.textSecondary, fontWeight: '400', lineHeight: 22 },

  formContainer: { marginBottom: 16 },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border,
    borderRadius: 12, marginBottom: 12, height: 52,
  },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, height: '100%', fontSize: 15, color: c.textPrimary },
  inputFocused: { backgroundColor: c.card, borderColor: ORANGE },
  inputError: { borderColor: c.error, backgroundColor: c.errorBg },
  eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
  errorText: {
    color: c.error, fontSize: 12, fontWeight: '500',
    marginTop: -8, marginBottom: 10, marginLeft: 4,
  },
  forgotPasswordButton: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 12 },
  forgotPasswordText: { color: ORANGE, fontSize: 14, fontWeight: '600' },

  loginButton: {
    backgroundColor: ORANGE, height: 54, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    width: '100%', marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.7 },
  loginText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },

  dividerContainer: { flexDirection: 'row', alignItems: 'center', width: '100%', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
  dividerText: { marginHorizontal: 12, color: c.textMuted, fontWeight: '500', fontSize: 14 },

  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.border, borderRadius: 12, height: 54,
    width: '100%', marginBottom: 24, backgroundColor: c.card,
  },
  googleIcon: { width: 22, height: 22, marginRight: 10 },
  googleText: { color: c.textPrimary, fontWeight: '600', fontSize: 15 },

  signUpContainer: { width: '100%', alignItems: 'center', paddingVertical: 8 },
  signUpText: { color: c.textSecondary, fontSize: 14 },
  signUpTextBold: { color: ORANGE, fontWeight: '600' },
});