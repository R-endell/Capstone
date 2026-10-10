// src/modules/Authentication/LoginScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  Keyboard, Alert, Image, ActivityIndicator, Animated, Easing,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';

WebBrowser.maybeCompleteAuthSession();

/** Brand */
const ORANGE = '#F27024';

export default function LoginScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Entrance & Glow Animations
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
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    glow.start();

    return () => glow.stop();
  }, [fadeAnim, glowAnim]);

  /* ------------------------------------------------------------------ */
  /* Validation                                                          */
  /* ------------------------------------------------------------------ */
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
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        Alert.alert('Login Failed', getFriendlyErrorMessage(error));
        return;
      }
      const lastMode = await AsyncStorage.getItem('last_mode');
      const route = lastMode === 'provider' ? 'ProviderTabs' : 'MainTabs';
      navigation.reset({
        index: 0,
        routes: [{ name: route }],
      });
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
        skipBrowserRedirect: true,   // we open the browser ourselves
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) throw error;
    if (!data?.url) throw new Error('No OAuth URL returned');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'success' && result.url) {
      const url = new URL(result.url);
      const code = url.searchParams.get('code');

      if (!code) throw new Error('No auth code in redirect URL');

      const { data: exchangeData, error: exchangeError } =
        await supabase.auth.exchangeCodeForSession(code);

      if (exchangeError) throw exchangeError;

      if (exchangeData?.session) {
        const lastMode = await AsyncStorage.getItem('last_mode');
        const route = lastMode === 'provider' ? 'ProviderTabs' : 'MainTabs';
        navigation.reset({
          index: 0,
          routes: [{ name: route }],
        });
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

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 0.12],
  });

  const fadeUpStyle = {
    opacity: fadeAnim,
    transform: [{
      translateY: fadeAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [20, 0],
      })
    }],
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Ambient Background Glows */}
      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View
          style={[
            styles.glow,
            styles.glowTop,
            { transform: [{ scale: glowScale }], opacity: glowOpacity },
          ]}
        />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>

            <Animated.View style={[styles.contentWrapper, fadeUpStyle]}>
              {/* Header with Larger Brand Logo Identity */}
              <View style={styles.headerContainer}>
                <View style={styles.brandRow}>
                  <Image
                    source={require('../../../assets/Pack-N-Ship-Logo2.png')}
                    style={styles.logoImage}
                    resizeMode="contain"
                  />
                  <Text style={styles.brandText}>
                    Pack-<Text style={styles.brandTextOrange}>N-Ship</Text>
                  </Text>
                </View>
                <Text style={styles.header}>Welcome Back</Text>
                <Text style={styles.subHeader}>Log in to manage your deliveries and track packages.</Text>
              </View>

              {/* Form */}
              <View style={styles.formContainer}>
                {/* Email */}
                <View
                  style={[
                    styles.inputWrapper,
                    focusedInput === 'email' && styles.inputFocused,
                    emailError && styles.inputError,
                  ]}
                >
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={focusedInput === 'email' ? ORANGE : '#9CA3AF'}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor="#9CA3AF"
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

                {/* Password */}
                <View
                  style={[
                    styles.inputWrapper,
                    focusedInput === 'password' && styles.inputFocused,
                    passwordError && styles.inputError,
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={focusedInput === 'password' ? ORANGE : '#9CA3AF'}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                    editable={!loading}
                  />
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={togglePasswordVisibility}
                    disabled={loading}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
                {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                <TouchableOpacity style={styles.forgotPasswordButton} disabled={loading}>
                  <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={[styles.loginButton, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.loginText}>Log In</Text>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.dividerContainer}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Google Button */}
              <TouchableOpacity
                style={[styles.googleButton, loading && styles.buttonDisabled]}
                onPress={handleGoogleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                <Image
                  source={require('../../../assets/google.png')}
                  style={styles.googleIcon}
                  resizeMode="contain"
                />
                <Text style={styles.googleText}>Continue With Google</Text>
              </TouchableOpacity>

              {/* Sign Up Link */}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  keyboardAvoid: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  glowTop: {
    width: 360,
    height: 360,
    top: -160,
    right: -140,
  },
  glowBottom: {
    width: 300,
    height: 300,
    bottom: -140,
    left: -120,
    opacity: 0.05,
  },
  innerContainer: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    flexGrow: 1,
    justifyContent: 'center',
  },
  contentWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  headerContainer: {
    marginBottom: 24,
    alignItems: 'flex-start',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  logoImage: {
    width: 54, // Increased logo size
    height: 54, // Increased logo size
  },
  brandText: {
    fontSize: 22, // Balanced size with larger logo
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#111827',
    letterSpacing: -0.3,
  },
  brandTextOrange: {
    color: ORANGE,
  },
  header: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subHeader: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '400',
    lineHeight: 22,
  },
  formContainer: {
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 12,
    height: 52,
  },
  inputIcon: {
    paddingLeft: 16,
    paddingRight: 8,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: '#111827',
  },
  inputFocused: {
    backgroundColor: '#FFFFFF',
    borderColor: ORANGE,
  },
  inputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  eyeButton: {
    paddingHorizontal: 16,
    height: '100%',
    justifyContent: 'center',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '500',
    marginTop: -8,
    marginBottom: 10,
    marginLeft: 4,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    marginBottom: 12,
  },
  forgotPasswordText: {
    color: ORANGE,
    fontSize: 14,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: ORANGE,
    height: 54,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  loginText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    height: 54,
    width: '100%',
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  googleIcon: {
    width: 22,
    height: 22,
    marginRight: 10,
  },
  googleText: {
    color: '#111827',
    fontWeight: '600',
    fontSize: 15,
  },
  signUpContainer: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  signUpText: {
    color: '#6B7280',
    fontSize: 14,
  },
  signUpTextBold: {
    color: ORANGE,
    fontWeight: '600',
  },
});