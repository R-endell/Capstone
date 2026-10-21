// src/modules/Authentication/RegisterScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
  ActivityIndicator, Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';

const ORANGE = '#F27024';
const COOLDOWN_SECONDS = 60;

export default function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // 'form' | 'otp' | 'success'
  const [phase, setPhase] = useState<'form' | 'otp' | 'success'>('form');

  // --- Form State ---
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  // --- OTP State ---
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState('');

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

  // Trigger fade animation on phase change
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [phase, fadeAnim]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const validateName = (name: string, field: string) => {
    if (!name) return `${field} is required`;
    if (name.length < 2) return `${field} must be at least 2 characters`;
    return '';
  };
  const validatePhone = (phone: string) => {
    if (!phone) return 'Phone number is required';
    const phoneRegex = /^(09|\+639)\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) return 'Enter a valid PH number (e.g., 09XXXXXXXXX)';
    return '';
  };
  const validateEmail = (email: string) => {
    if (!email) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return 'Enter a valid email address';
    return '';
  };
  const validatePassword = (password: string) => {
    if (!password) return 'Password is required';
    if (password.length < 8) return 'At least 8 characters';
    if (!/[A-Z]/.test(password)) return 'Include at least 1 uppercase letter';
    if (!/[a-z]/.test(password)) return 'Include at least 1 lowercase letter';
    if (!/[0-9]/.test(password)) return 'Include at least 1 number';
    if (!/[!@#$%^&*]/.test(password)) return 'Include at least 1 special character (!@#$%^&*)';
    return '';
  };
  const validateConfirmPassword = (password: string, confirm: string) => {
    if (!confirm) return 'Please confirm your password';
    if (password !== confirm) return 'Passwords do not match';
    return '';
  };

  const handleSignUp = async () => {
    const firstNameValidation = validateName(firstName, 'First name');
    const lastNameValidation = validateName(lastName, 'Last name');
    const phoneValidation = validatePhone(phone);
    const emailValidation = validateEmail(email);
    const passwordValidation = validatePassword(password);
    const confirmValidation = validateConfirmPassword(password, confirmPassword);

    if (firstNameValidation) { setFirstNameError(firstNameValidation); return; }
    if (lastNameValidation) { setLastNameError(lastNameValidation); return; }
    if (phoneValidation) { setPhoneError(phoneValidation); return; }
    if (emailValidation) { setEmailError(emailValidation); return; }
    if (passwordValidation) { setPasswordError(passwordValidation); return; }
    if (confirmValidation) { setConfirmPasswordError(confirmValidation); return; }

    setLoading(true);
    try {
      const cleanedPhone = phone.trim();
      const { data: existingPhone } = await supabase.from('users').select('user_id').eq('phone_number', cleanedPhone).maybeSingle();
      if (existingPhone) {
        setPhoneError('This phone number is already registered.');
        Alert.alert('Phone Number Already Used', 'An account already exists with this phone number.');
        setLoading(false);
        return;
      }

      const { data: existingEmail } = await supabase.from('users').select('user_id').eq('email', email.trim().toLowerCase()).maybeSingle();
      if (existingEmail) {
        setEmailError('This email is already registered.');
        Alert.alert('Email Already Used', 'An account already exists with this email.');
        setLoading(false);
        return;
      }

      // Create user. Supabase will trigger the OTP email.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: cleanedPhone,
            avatar_url: '',
          },
        },
      });

      if (signUpError) throw signUpError;

      if (imageBase64 && signUpData?.user) {
        try {
          const fileName = `${signUpData.user.id}_${Date.now()}.jpg`;
          const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, decode(imageBase64), { contentType: 'image/jpeg', upsert: true });
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
          await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
        } catch (uploadErr: any) {
          console.warn('Avatar upload failed:', uploadErr?.message);
        }
      }

      // Move to OTP verification state
      setSentTo(email.trim().toLowerCase());
      setPhase('otp');
      setCooldown(COOLDOWN_SECONDS);
    } catch (error: any) {
      console.error('SIGNUP ERROR:', error);
      Alert.alert('Signup Failed', error.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the 6-digit code sent to your email.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: sentTo,
        token: otpCode.trim(),
        type: 'signup',
      });

      if (error) throw error;

      // 1. Supabase automatically logs them in when verifyOtp succeeds.
      // We must sign them out so they are forced to log in manually.
      await supabase.auth.signOut();

      // 2. Show success state and redirect to Login
      setPhase('success');
      
      setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }, 1800);
      
    } catch (err: any) {
      Alert.alert('Verification Failed', err.message || 'The code is invalid or has expired.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: sentTo,
      });
      if (error) throw error;
      setCooldown(COOLDOWN_SECONDS);
      Alert.alert('Code Sent', 'A new 6-digit code has been sent to your email.');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  const glowScale = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const fadeUpStyle = { opacity: fadeAnim, transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity style={[styles.themeToggle, { top: insets.top + 12 }]} onPress={toggleDark} activeOpacity={0.85}>
        <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.textPrimary} />
      </TouchableOpacity>

      {/* Background Glows */}
      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View style={[styles.glow, styles.glowTop, { transform: [{ scale: glowScale }], opacity: glowOpacity }]} />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardAvoid}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.contentWrapper, fadeUpStyle]}>
              
              {phase === 'success' ? (
                /* --- SUCCESS STATE --- */
                <View style={styles.centerBlock}>
                  <Ionicons name="checkmark-circle" size={72} color={ORANGE} />
                  <Text style={[styles.header, { marginTop: 16 }]}>Email Verified!</Text>
                  <Text style={styles.subHeader}>Taking you to the login screen…</Text>
                </View>
              ) : phase === 'otp' ? (
                /* --- OTP VERIFICATION STATE --- */
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Ionicons name="shield-checkmark-outline" size={36} color={ORANGE} />
                    </View>
                    <Text style={styles.header}>Verify your email</Text>
                    <Text style={styles.subHeader}>
                      We sent a 6-digit code to{'\n'}
                      <Text style={styles.emailHighlight}>{sentTo}</Text>
                    </Text>
                  </View>

                  <View style={styles.formContainer}>
                    <View style={[
                      styles.inputWrapper, 
                      { height: 64, marginBottom: 20 },
                      focusedInput === 'otp' && styles.inputFocused
                    ]}>
                      <Ionicons name="keypad-outline" size={24} color={focusedInput === 'otp' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={[styles.input, { fontSize: 24, letterSpacing: 6, fontWeight: '700' }]}
                        placeholder="000000"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        maxLength={6}  
                        value={otpCode}
                        onChangeText={setOtpCode}
                        onFocus={() => setFocusedInput('otp')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.button, (verifyingOtp || otpCode.length < 6) && styles.buttonDisabled]}
                    onPress={handleVerifyOtp}
                    disabled={verifyingOtp || otpCode.length < 6}
                    activeOpacity={0.8} 
                  >
                    {verifyingOtp ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.buttonText}>Verify Account</Text>}
                  </TouchableOpacity>

                  <View style={styles.linkContainer}>
                    <Text style={styles.link}>Didn't receive it? </Text>
                    <TouchableOpacity onPress={handleResendOtp} disabled={cooldown > 0 || loading}>
                      <Text style={[styles.linkBold, { color: cooldown > 0 ? colors.textMuted : ORANGE }]}>
                        {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity onPress={() => setPhase('form')} style={{ marginTop: 24, alignItems: 'center' }}>
                    <Text style={{ color: colors.textSecondary, fontSize: 13, textDecorationLine: 'underline' }}>
                      Entered the wrong email? Go back
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                /* --- REGISTRATION FORM STATE --- */
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Image source={require('../../../assets/Pack-N-Ship-Logo2.png')} style={styles.logoImage} resizeMode="contain" />
                      <Text style={styles.brandText}>Pack-<Text style={styles.brandTextOrange}>N-Ship</Text></Text>
                    </View>
                    <Text style={styles.header}>Create Account</Text>
                    <Text style={styles.subHeader}>Start shipping your packages securely today.</Text>
                  </View>

                  <View style={styles.imageUploadSection}>
                    <TouchableOpacity style={styles.imagePicker} onPress={async () => {
                      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                      if (status !== 'granted') return;
                      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true });
                      if (!res.canceled && res.assets.length > 0) { setImageUri(res.assets[0].uri); setImageBase64(res.assets[0].base64 || null); }
                    }}>
                      {imageUri ? <Image source={{ uri: imageUri }} style={styles.profilePreview} /> : <View style={styles.imagePlaceholder}><Ionicons name="camera-outline" size={26} color={colors.textMuted} /></View>}
                      <View style={styles.uploadBadge}><Ionicons name="add" size={14} color="#FFF" /></View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.formContainer}>
                    {/* First Name */}
                    <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, firstNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'firstName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="First Name" placeholderTextColor={colors.textMuted} value={firstName} onChangeText={(t) => { setFirstName(t); setFirstNameError(validateName(t, 'First name')); }} onFocus={() => setFocusedInput('firstName')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}

                    {/* Last Name */}
                    <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputFocused, lastNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'lastName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Last Name" placeholderTextColor={colors.textMuted} value={lastName} onChangeText={(t) => { setLastName(t); setLastNameError(validateName(t, 'Last name')); }} onFocus={() => setFocusedInput('lastName')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}

                    {/* Phone */}
                    <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputFocused, phoneError && styles.inputError]}>
                      <Ionicons name="call-outline" size={20} color={focusedInput === 'phone' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Phone Number (e.g., 09123456789)" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={(t) => { const c = t.replace(/[^0-9+]/g, ''); setPhone(c); setPhoneError(validatePhone(c)); }} onFocus={() => setFocusedInput('phone')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                    {/* Email */}
                    <View style={[styles.inputWrapper, focusedInput === 'email' && styles.inputFocused, emailError && styles.inputError]}>
                      <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Email Address" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={(t) => { setEmail(t); setEmailError(validateEmail(t)); }} onFocus={() => setFocusedInput('email')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                    {/* Password */}
                    <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.textMuted} secureTextEntry={!showPassword} value={password} onChangeText={(t) => { setPassword(t); setPasswordError(validatePassword(t)); if (confirmPassword) setConfirmPasswordError(validateConfirmPassword(t, confirmPassword)); }} onFocus={() => setFocusedInput('password')} onBlur={() => setFocusedInput(null)} />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                    {/* Confirm Password */}
                    <View style={[styles.inputWrapper, focusedInput === 'confirmPassword' && styles.inputFocused, confirmPasswordError && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'confirmPassword' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Confirm Password" placeholderTextColor={colors.textMuted} secureTextEntry={!showConfirmPassword} value={confirmPassword} onChangeText={(t) => { setConfirmPassword(t); setConfirmPasswordError(validateConfirmPassword(password, t)); }} onFocus={() => setFocusedInput('confirmPassword')} onBlur={() => setFocusedInput(null)} />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                        <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
                  </View>

                  <TouchableOpacity style={[styles.button, loading && styles.buttonDisabled]} onPress={handleSignUp} disabled={loading}>
                    {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.buttonText}>Create Account</Text>}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkContainer}>
                    <Text style={styles.link}>Already have an account? <Text style={styles.linkBold}>Log In</Text></Text>
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
  themeToggle: { position: 'absolute', right: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 6, elevation: 3 },
  
  // Using explicit width/height to ensure it covers the whole screen even inside a ScrollView
  backgroundLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden' },
  glow: { position: 'absolute', borderRadius: 999, backgroundColor: ORANGE },
  glowTop: { width: 360, height: 360, top: -160, right: -140 },
  glowBottom: { width: 300, height: 300, bottom: -140, left: -120, opacity: 0.05 },
  
  innerContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
  contentWrapper: { flex: 1, justifyContent: 'center' },
  centerBlock: { alignItems: 'center', justifyContent: 'center' },
  
  headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  logoImage: { width: 54, height: 54 },
  brandText: { fontSize: 22, fontWeight: '800', fontStyle: 'italic', color: c.textPrimary, letterSpacing: -0.3 },
  brandTextOrange: { color: ORANGE },
  header: { fontSize: 28, fontWeight: '700', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  subHeader: { fontSize: 15, color: c.textSecondary, fontWeight: '400', lineHeight: 22 },
  emailHighlight: { color: c.textPrimary, fontWeight: '600' },
  
  imageUploadSection: { alignItems: 'center', marginBottom: 20 },
  imagePicker: { width: 76, height: 76, borderRadius: 38, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border, position: 'relative' },
  imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  profilePreview: { width: 76, height: 76, borderRadius: 38 },
  uploadBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: ORANGE, width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: c.card },
  
  formContainer: { marginBottom: 16 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 12, marginBottom: 12, height: 52 },
  inputIcon: { paddingLeft: 16, paddingRight: 8 },
  input: { flex: 1, height: '100%', fontSize: 15, color: c.textPrimary },
  inputFocused: { borderColor: ORANGE },
  inputError: { borderColor: c.error, backgroundColor: c.errorBg },
  eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
  errorText: { color: c.error, fontSize: 12, fontWeight: '500', marginTop: -8, marginBottom: 10, marginLeft: 4 },
  
  button: { backgroundColor: ORANGE, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  
  linkContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  link: { color: c.textSecondary, fontSize: 14 },
  linkBold: { color: ORANGE, fontWeight: '600' },
});