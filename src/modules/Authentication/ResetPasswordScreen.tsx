// src/modules/Authentication/ResetPasswordScreen.tsx
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { resolveHomeRoute } from '../../utils/resolveHomeRoute';
import {
  checkPasswordStrength,
  validatePassword,
  validateConfirmPassword,
} from '../../utils/passwordValidation';

const ORANGE = '#F27024';

type ResetRouteParamList = {
  ResetPassword: {
    token_hash: string;
    type: string;
  };
};
type ResetRoute = RouteProp<ResetRouteParamList, 'ResetPassword'>;
type ResetPasswordNavigationParamList = RootStackParamList & {
  ForgotPassword: undefined;
};

export default function ResetPasswordScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ResetPasswordNavigationParamList>>();
  const route = useRoute<ResetRoute>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const { token_hash, type } = route.params;

  // 'verifying' | 'error' | 'form' | 'success'
  const [phase, setPhase] = useState<'verifying' | 'error' | 'form' | 'success'>('verifying');
  const [verifyErrorMsg, setVerifyErrorMsg] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true,
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
    (async () => {
      try {
        const { error } = await supabase.auth.verifyOtp({
          token_hash,
          type: (type as any) || 'recovery',
        });

        if (cancelled) return;

        if (error) {
          const msg = (error.message || '').toLowerCase();
          const friendly = msg.includes('expired')
            ? 'This password reset link has expired. Please request a new one.'
            : msg.includes('invalid') || msg.includes('token')
            ? 'This password reset link is invalid. Please request a new one.'
            : 'We could not verify your reset link. Please request a new one.';
          setVerifyErrorMsg(friendly);
          setPhase('error');
          return;
        }

        setPhase('form');
      } catch {
        if (cancelled) return;
        setVerifyErrorMsg('We could not verify your reset link. Please check your connection and try again.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token_hash, type]);

  const handlePasswordChange = (t: string) => {
    setPassword(t);
    setPasswordError(validatePassword(t));
    if (confirmPassword) setConfirmPasswordError(validateConfirmPassword(t, confirmPassword));
  };

  const handleConfirmChange = (t: string) => {
    setConfirmPassword(t);
    setConfirmPasswordError(validateConfirmPassword(password, t));
  };

  const handleSubmit = async () => {
    const pwErr = validatePassword(password);
    const confirmErr = validateConfirmPassword(password, confirmPassword);
    if (pwErr) { setPasswordError(pwErr); return; }
    if (confirmErr) { setConfirmPasswordError(confirmErr); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('session') || msg.includes('jwt') || msg.includes('expired')) {
          setVerifyErrorMsg(
            'Your reset session has expired. Please request a new password reset email.',
          );
          setPhase('error');
          return;
        }
        setPasswordError(error.message || 'Could not update password. Please try again.');
        return;
      }

      // Session is now valid. Show success briefly, then route to home.
      setPhase('success');

      setTimeout(async () => {
        let targetRoute: 'MainTabs' | 'ProviderTabs' | 'Login' = 'Login';
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            targetRoute = await resolveHomeRoute(session.user.id);
          }
        } catch (e) {
          console.warn('[ResetPassword] resolveHomeRoute failed:', e);
        }
        navigation.reset({ index: 0, routes: [{ name: targetRoute }] });
      }, 1500);
    } catch {
      setPasswordError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestNew = () => {
    navigation.reset({ index: 0, routes: [{ name: 'ForgotPassword' }] });
  };

  const handleBackToLogin = async () => {
    // If verify succeeded but user abandoned, sign out so they don't
    // accidentally get routed into the app with a "half-reset" state.
    try { await supabase.auth.signOut(); } catch {}
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  const glowScale = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const fadeUpStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  const strength = checkPasswordStrength(password);
  const showStrength = password.length > 0;

  // ---------- RENDER ----------
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
              {/* VERIFYING */}
              {phase === 'verifying' && (
                <View style={styles.centerBlock}>
                  <ActivityIndicator size="large" color={ORANGE} />
                  <Text style={styles.verifyText}>Verifying your reset link…</Text>
                </View>
              )}

              {/* ERROR */}
              {phase === 'error' && (
                <>
                  <View style={styles.errorIconWrap}>
                    <Ionicons name="alert-circle-outline" size={64} color={colors.error} />
                  </View>
                  <Text style={styles.header}>Link problem</Text>
                  <Text style={styles.subHeader}>{verifyErrorMsg}</Text>

                  <TouchableOpacity style={styles.primaryButton} onPress={handleRequestNew} activeOpacity={0.8}>
                    <Text style={styles.primaryButtonText}>Request New Link</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.linkContainer} onPress={handleBackToLogin}>
                    <Text style={styles.link}><Text style={styles.linkBold}>Back to Login</Text></Text>
                  </TouchableOpacity>
                </>
              )}

              {/* SUCCESS */}
              {phase === 'success' && (
                <View style={styles.centerBlock}>
                  <Ionicons name="checkmark-circle" size={72} color={ORANGE} />
                  <Text style={[styles.header, { marginTop: 16 }]}>Password updated!</Text>
                  <Text style={styles.subHeader}>Taking you to your home screen…</Text>
                </View>
              )}

              {/* FORM */}
              {phase === 'form' && (
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Ionicons name="shield-checkmark-outline" size={36} color={ORANGE} />
                    </View>
                    <Text style={styles.header}>Set New Password</Text>
                    <Text style={styles.subHeader}>
                      Choose a strong password you haven't used before.
                    </Text>
                  </View>

                  <View style={styles.formContainer}>
                    <View style={[
                      styles.inputWrapper,
                      focusedInput === 'password' && styles.inputFocused,
                      passwordError && styles.inputError,
                    ]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="New Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={handlePasswordChange}
                        onFocus={() => setFocusedInput('password')}
                        onBlur={() => setFocusedInput(null)}
                        editable={!submitting}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)} disabled={submitting}>
                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                    {showStrength && (
                      <View style={styles.strengthList}>
                        <StrengthRow label="At least 8 characters" ok={strength.minLength} c={colors} />
                        <StrengthRow label="Uppercase letter" ok={strength.hasUppercase} c={colors} />
                        <StrengthRow label="Lowercase letter" ok={strength.hasLowercase} c={colors} />
                        <StrengthRow label="Number" ok={strength.hasNumber} c={colors} />
                        <StrengthRow label="Special character (!@#$%^&*)" ok={strength.hasSpecial} c={colors} />
                      </View>
                    )}

                    <View style={[
                      styles.inputWrapper,
                      focusedInput === 'confirm' && styles.inputFocused,
                      confirmPasswordError && styles.inputError,
                    ]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'confirm' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Confirm New Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showConfirmPassword}
                        value={confirmPassword}
                        onChangeText={handleConfirmChange}
                        onFocus={() => setFocusedInput('confirm')}
                        onBlur={() => setFocusedInput(null)}
                        editable={!submitting}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(!showConfirmPassword)} disabled={submitting}>
                        <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, submitting && styles.buttonDisabled]}
                    onPress={handleSubmit}
                    disabled={submitting}
                    activeOpacity={0.8}
                  >
                    {submitting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Update Password</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.linkContainer} onPress={handleBackToLogin} disabled={submitting}>
                    <Text style={styles.link}><Text style={styles.linkBold}>Cancel</Text></Text>
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

function StrengthRow({ label, ok, c }: { label: string; ok: boolean; c: ThemeColors }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={14}
        color={ok ? '#10B981' : c.textMuted}
      />
      <Text style={{ marginLeft: 6, fontSize: 12, color: ok ? c.textPrimary : c.textMuted }}>
        {label}
      </Text>
    </View>
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

  centerBlock: { alignItems: 'center', justifyContent: 'center' },
  verifyText: { marginTop: 16, fontSize: 15, color: c.textSecondary, fontWeight: '500' },

  headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
  brandRow: { marginBottom: 16 },
  header: { fontSize: 28, fontWeight: '700', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  subHeader: { fontSize: 15, color: c.textSecondary, fontWeight: '400', lineHeight: 22 },

  errorIconWrap: { alignItems: 'center', marginBottom: 24 },

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
  eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
  errorText: { color: c.error, fontSize: 12, fontWeight: '500', marginTop: -8, marginBottom: 10, marginLeft: 4 },

  strengthList: { marginTop: -4, marginBottom: 12, paddingLeft: 4 },

  primaryButton: {
    backgroundColor: ORANGE, height: 54, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },

  linkContainer: { alignItems: 'center', paddingVertical: 8 },
  link: { color: c.textSecondary, fontSize: 14 },
  linkBold: { color: ORANGE, fontWeight: '600' },
});