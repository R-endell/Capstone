import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  Keyboard, Alert, Image, ActivityIndicator, Animated, Easing
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';

WebBrowser.maybeCompleteAuthSession();

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

  // Animated values for smooth password toggle
  const passwordFadeAnim = useRef(new Animated.Value(1)).current;

  // Validation functions
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

  // Smooth password toggle with animation
  const togglePasswordVisibility = () => {
    Animated.sequence([
      Animated.timing(passwordFadeAnim, {
        toValue: 0.7,
        duration: 100,
        useNativeDriver: true,
        easing: Easing.ease,
      }),
      Animated.timing(passwordFadeAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
        easing: Easing.ease,
      }),
    ]).start(() => {
      setShowPassword(!showPassword);
    });
  };

  // Get user-friendly error message
  const getFriendlyErrorMessage = (error: any) => {
    const message = error?.message || '';

    if (message.includes('Invalid login credentials')) {
      return 'Invalid email or password. Please try again.';
    }
    if (message.includes('Email not confirmed')) {
      return 'Please verify your email address before logging in. Check your inbox.';
    }
    if (message.includes('Too many requests')) {
      return 'Too many login attempts. Please try again later.';
    }
    if (message.includes('User not found')) {
      return 'No account found with this email. Please sign up first.';
    }
    if (message.includes('network')) {
      return 'Network error. Please check your internet connection.';
    }
    return 'Something went wrong. Please try again.';
  };

  const handleLogin = async () => {
    // Validate before sending to Supabase
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password);

    if (emailValidation) {
      setEmailError(emailValidation);
      return;
    }
    if (passwordValidation) {
      setPasswordError(passwordValidation);
      return;
    }

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

      // Success – navigate to main app
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
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
            // ✅ Let Supabase handle the redirect – no redirectTo needed!
            const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                queryParams: {
                access_type: 'offline',
                prompt: 'consent',
                },
            },
            });

            if (error) throw error;

            if (data?.url) {
            const result = await WebBrowser.openAuthSessionAsync(data.url);

            if (result.type === 'success') {
                // ✅ Supabase automatically handles the session
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData?.session) {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'Home' }],
                });
                }
            }
            }
        } catch (error: any) {
            Alert.alert('Google Login Failed', error.message);
        } finally {
            setLoading(false);
        }
        };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.innerContainer}>

            {/* Logo */}
            <View style={styles.logoSection}>
              <Image
                source={require('../../../assets/Pack-N-Ship-Logo2.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
              <Text style={styles.logoText}>
                Pack-<Text style={styles.logoTextOrange}>N-Ship</Text>
              </Text>
              <Text style={styles.logoSubText}>Logistics & Moving Services</Text>
            </View>

            {/* Header */}
            <View style={styles.headerContainer}>
              <Text style={styles.header}>Welcome Back! 👋</Text>
              <Text style={styles.subHeader}>Log in to manage your deliveries and track packages.</Text>
            </View>

            {/* Email Input */}
            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, focusedInput === 'email' && styles.inputFocused, emailError && styles.inputError]}
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
                <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <Animated.View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <TextInput
                    style={styles.passwordInput}
                    placeholder="Password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                    editable={!loading}
                    />
                </Animated.View>
                <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={togglePasswordVisibility}
                    disabled={loading}
                >
                    <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={22}
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
              style={[styles.loginButton, loading && { opacity: 0.8 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.loginText}>Logging in...</Text>
                </View>
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
              style={[styles.googleButton, loading && { opacity: 0.5 }]}
              onPress={handleGoogleLogin}
              disabled={loading}
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

          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  keyboardAvoid: { flex: 1 },
  innerContainer: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'center',
    paddingTop: 20,
    paddingBottom: 40,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoImage: {
    width: 140,
    height: 80,
    marginBottom: -5,
  },
  logoText: {
    fontSize: 28,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#111827',
  },
  logoTextOrange: {
    color: '#F27024',
  },
  logoSubText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  headerContainer: {
    width: '100%',
    marginBottom: 24,
  },
  header: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
    color: '#111827',
  },
  subHeader: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '400',
  },
  inputContainer: {
    width: '100%',
    marginBottom: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
    },
  inputIcon: {
    paddingLeft: 14,
    paddingRight: 8, // Added to create space between icon and text
    },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    paddingLeft: 12, // Match the 12px left padding from the email input
    paddingRight: 0,
    paddingHorizontal: 0, // Remove horizontal padding to let parent handle spacing
    fontSize: 15,
    color: '#111827',
    },
  inputWithoutIcon: {
    paddingLeft: 1,
  },
  inputFocused: {
    borderColor: '#F27024',
    shadowColor: '#F27024',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  inputError: {
    borderColor: '#EF4444',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
    marginLeft: 4,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    marginBottom: 8,
  },
  forgotPasswordText: {
    color: '#F27024',
    fontSize: 14,
    fontWeight: '600',
  },
  loginButton: {
    backgroundColor: '#F27024',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    marginTop: 6,
    marginBottom: 20,
    shadowColor: '#F27024',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  loginText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    backgroundColor: '#D1D5DB',
  },
  dividerText: {
    marginHorizontal: 15,
    color: '#6B7280',
    fontWeight: '600',
    fontSize: 14,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 14,
    width: '100%',
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
  },
  googleIcon: {
    width: 24,
    height: 24,
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
    fontWeight: '400',
    fontSize: 14,
  },
  signUpTextBold: {
    color: '#F27024',
    fontWeight: '700',
  },
});