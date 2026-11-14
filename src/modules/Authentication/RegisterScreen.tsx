// src/modules/Authentication/RegisterScreen.tsx
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
  ActivityIndicator, Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import TermsModal from '../../components/terms/TermsModal';
import { recordTermsAcceptance } from '../../services/termsService';
import { POLICY_VERSION } from '../Settings/policyContent';

const ORANGE = '#F27024';
const COOLDOWN_SECONDS = 60;

const getDeviceCoords = async (): Promise<{ lat: number; lng: number } | null> => {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const permissionReq = await Location.requestForegroundPermissionsAsync();
      status = permissionReq.status;
    }
    if (status !== 'granted') {
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    if (
      location?.coords &&
      typeof location.coords.latitude === 'number' &&
      typeof location.coords.longitude === 'number'
    ) {
      return {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      };
    }

    return null;
  } catch {
    return null;
  }
};

const friendlyAuthError = (err: any): string => {
  const raw = String(err?.message || '');
  let friendly = raw || 'Something went wrong.';
  if (err?.status === 429 || /rate limit|too many|only request this once|security purposes/i.test(raw)) {
    friendly = 'Too many verification emails were requested. Please wait a few minutes and try again.';
  } else if (/not authorized|sending (confirmation|email|magic)|smtp|unable to send/i.test(raw)) {
    friendly = "We couldn't send the verification email right now. Please check your email address and try again shortly.";
  }
  return __DEV__ && friendly !== raw ? `${friendly}\n\n[dev] ${raw}` : friendly;
};

export default function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, toggleDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [phase, setPhase] = useState<'form' | 'otp' | 'success'>('form');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [structuredAddress, setStructuredAddress] = useState({
    street: '',
    barangay: '',
    city: '',
    province: '',
    zip_code: '',
  });

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState('');

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
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
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
    if (!name.trim()) return `${field} is required`;
    if (name.trim().length < 2) return `${field} must be at least 2 characters`;
    return '';
  };

  const validatePhone = (phoneVal: string) => {
    if (!phoneVal) return 'Phone number is required';
    const phoneRegex = /^(09|\+639)\d{9}$/;
    if (!phoneRegex.test(phoneVal.replace(/\s/g, ''))) return 'Enter a valid PH number (e.g., 09XXXXXXXXX)';
    return '';
  };

  const validateEmail = (emailVal: string) => {
    if (!emailVal) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailVal)) return 'Enter a valid email address';
    return '';
  };

  const validateStructuredAddress = (addr: typeof structuredAddress) => {
    if (
      !addr.street.trim() ||
      !addr.barangay.trim() ||
      !addr.city.trim() ||
      !addr.province.trim() ||
      !addr.zip_code.trim()
    ) {
      return 'Please complete all home address fields (Street, Barangay, City, Province, and Zip Code)';
    }
    return '';
  };

  const validatePassword = (pass: string) => {
    if (!pass) return 'Password is required';
    if (pass.length < 8) return 'At least 8 characters';
    if (!/[A-Z]/.test(pass)) return 'Include at least 1 uppercase letter';
    if (!/[a-z]/.test(pass)) return 'Include at least 1 lowercase letter';
    if (!/[0-9]/.test(pass)) return 'Include at least 1 number';
    if (!/[!@#$%^&*]/.test(pass)) return 'Include at least 1 special character (!@#$%^&*)';
    return '';
  };

  const validateConfirmPassword = (pass: string, confirm: string) => {
    if (!confirm) return 'Please confirm your password';
    if (pass !== confirm) return 'Passwords do not match';
    return '';
  };

  const dupCheckCache = useRef(new Map<string, { at: number; promise: Promise<boolean> }>());
  const phoneRef = useRef('');
  const emailRef = useRef('');
  phoneRef.current = phone;
  emailRef.current = email;

  const checkTaken = useCallback((column: 'phone_number' | 'email', value: string): Promise<boolean> => {
    const key = `${column}:${value}`;
    const hit = dupCheckCache.current.get(key);
    if (hit && Date.now() - hit.at < 120000) return hit.promise;
    const promise = (async () => {
      const { data } = await supabase.from('users').select('user_id').eq(column, value).maybeSingle();
      return !!data;
    })().catch(() => {
      dupCheckCache.current.delete(key);
      return false;
    });
    dupCheckCache.current.set(key, { at: Date.now(), promise });
    return promise;
  }, []);

  const pendingFinalizeRef = useRef<Promise<void> | null>(null);
  const profileLinkRef = useRef<{ authUserId: string; update: Record<string, unknown> } | null>(null);
  const termsPendingRef = useRef(false);

  const handleSignUp = async () => {
    const firstNameValidation = validateName(firstName, 'First name');
    const lastNameValidation = validateName(lastName, 'Last name');
    const phoneValidation = validatePhone(phone);
    const emailValidation = validateEmail(email);
    const addressValidation = validateStructuredAddress(structuredAddress);
    const passwordValidation = validatePassword(password);
    const confirmValidation = validateConfirmPassword(password, confirmPassword);

    if (firstNameValidation) { setFirstNameError(firstNameValidation); return; }
    if (lastNameValidation) { setLastNameError(lastNameValidation); return; }
    if (phoneValidation) { setPhoneError(phoneValidation); return; }
    if (emailValidation) { setEmailError(emailValidation); return; }
    if (addressValidation) { setAddressError(addressValidation); return; }
    if (passwordValidation) { setPasswordError(passwordValidation); return; }
    if (confirmValidation) { setConfirmPasswordError(confirmValidation); return; }
    if (!agreedToTerms) {
      setTermsError('Please agree to the Terms and Policies to create your account.');
      return;
    }

    setLoading(true);
    pendingFinalizeRef.current = null;
    profileLinkRef.current = null;
    termsPendingRef.current = false;

    const coords = await getDeviceCoords();
    if (!coords) {
      setLoading(false);
      Alert.alert('Location Required', 'Location is required to save your address.');
      return;
    }

    const t0 = Date.now();
    const lap = (label: string) => {
      if (__DEV__) console.log(`[signup] ${label}: ${Date.now() - t0}ms`);
    };

    try {
      const cleanedPhone = phone.trim();
      const cleanedEmail = email.trim().toLowerCase();

      const [phoneTaken, emailTaken] = await Promise.all([
        checkTaken('phone_number', cleanedPhone),
        checkTaken('email', cleanedEmail),
      ]);
      if (phoneTaken) {
        setPhoneError('This phone number is already registered.');
        return;
      }
      if (emailTaken) {
        setEmailError('This email is already registered.');
        return;
      }
      lap('duplicate checks');

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: cleanedPhone,
            avatar_url: '',
            terms_version: POLICY_VERSION,
            terms_accepted_at: new Date().toISOString(),
          },
        },
      });
      lap('signUp (also sends the verification email)');

      if (signUpError) throw signUpError;
      if (!signUpData?.user) throw new Error('No user returned from Supabase Auth.');
      const authUserId = signUpData.user.id;
      const hasSession = !!signUpData.session;

      if (Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        setEmailError('This email is already registered.');
        return;
      }

      const finalizeProfile = async () => {
        if (!hasSession) {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (signInError) console.warn('Could not sign in immediately after signup.');
        }

        const uploadAvatarPromise = (async () => {
          if (!imageBase64) return '';
          try {
            const fileName = `${authUserId}_${Date.now()}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('avatars')
              .upload(fileName, decode(imageBase64), { contentType: 'image/jpeg', upsert: true });
            if (!uploadError) {
              const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
              return publicUrl;
            }
          } catch (uploadErr) {
            console.warn('Avatar upload failed:', uploadErr);
          }
          return '';
        })();

        const insertLocationPromise = (async () => {
          const { data: locData, error: locError } = await supabase
            .from('locations')
            .insert({
              street_address: structuredAddress.street.trim(),
              barangay: structuredAddress.barangay.trim(),
              city: structuredAddress.city.trim(),
              province: structuredAddress.province.trim(),
              zip_code: structuredAddress.zip_code.trim(),
              latitude: coords.lat,
              longitude: coords.lng,
            })
            .select('location_id')
            .single();
          if (locError) throw locError;
          return locData.location_id;
        })();

        const [avatarUrl, locationId] = await Promise.all([uploadAvatarPromise, insertLocationPromise]);

        const authMetaPromise: Promise<unknown> = avatarUrl
          ? supabase.auth
              .updateUser({ data: { avatar_url: avatarUrl } })
              .catch((e: unknown) => console.warn('Avatar metadata update failed:', e))
          : Promise.resolve();

        const profileUpdate = { location_id: locationId, profile_photo: avatarUrl || null };
        const deadline = Date.now() + 2500;
        let profileLinked = false;
        while (!profileLinked && Date.now() < deadline) {
          const { data: updatedRows, error: userError } = await supabase
            .from('users')
            .update(profileUpdate)
            .eq('auth_id', authUserId)
            .select('user_id');
          if (userError) {
            console.error('User Update Error:', userError);
            throw userError;
          }
          if (updatedRows && updatedRows.length > 0) profileLinked = true;
          else await new Promise((resolve) => setTimeout(resolve, 80));
        }
        if (!profileLinked) {
          console.warn('users row not updatable before verification; will retry after the code is accepted.');
          profileLinkRef.current = { authUserId, update: profileUpdate };
        }

        if (profileLinked) {
          try {
            await recordTermsAcceptance('signup');
          } catch (e) {
            console.warn('Could not record terms acceptance yet; will retry after verification:', e);
            termsPendingRef.current = true;
          }
        } else {
          termsPendingRef.current = true;
        }

        await authMetaPromise;
        await supabase.auth.signOut({ scope: 'local' });
      };

      pendingFinalizeRef.current = finalizeProfile().then(
        () => lap('address, photo and profile saved (background)'),
        (e: unknown) => {
          console.error('Profile save failed after signup:', e);
          Alert.alert(
            'Account created',
            "Your account was created, but we couldn't save your home address or photo. Please check them after you sign in.",
          );
        },
      );

      if (hasSession) {
        console.warn(
          '[signup] signUp returned a session: email confirmation is OFF on this Supabase project, so no code was sent. ' +
            'Turn on "Confirm email" (Authentication > Providers > Email) to send codes.',
        );
        await pendingFinalizeRef.current;
        Alert.alert(
          'Account created',
          'Email verification is switched off on the server, so no code was sent. You can log in now.',
          [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) }],
        );
        return;
      }

      setSentTo(cleanedEmail);
      setPhase('otp');
      setCooldown(COOLDOWN_SECONDS);
      lap('verification screen shown');
    } catch (error: any) {
      console.error('SIGNUP FATAL ERROR:', error);
      dupCheckCache.current.clear();
      Alert.alert('Signup Failed', friendlyAuthError(error));
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
      await pendingFinalizeRef.current;

      const { error } = await supabase.auth.verifyOtp({
        email: sentTo,
        token: otpCode.trim(),
        type: 'signup',
      });

      if (error) throw error;

      const pendingLink = profileLinkRef.current;
      if (pendingLink) {
        profileLinkRef.current = null;
        const { error: linkError } = await supabase
          .from('users')
          .update(pendingLink.update)
          .eq('auth_id', pendingLink.authUserId);
        if (linkError) console.warn('Could not link profile after verification:', linkError);
      }

      if (termsPendingRef.current) {
        try {
          await recordTermsAcceptance('signup');
          termsPendingRef.current = false;
        } catch (e) {
          console.warn('Could not record terms acceptance after verification:', e);
        }
      }

      await supabase.auth.signOut({ scope: 'local' });
      setPhase('success');

      setTimeout(() => {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }, 1000);
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
      console.error('RESEND ERROR:', err);
      Alert.alert('Error', friendlyAuthError(err) || 'Could not resend the code.');
    } finally {
      setLoading(false);
    }
  };

  const updateAddressField = (field: keyof typeof structuredAddress, value: string) => {
    const next = { ...structuredAddress, [field]: value };
    setStructuredAddress(next);
    if (addressError) {
      setAddressError(validateStructuredAddress(next));
    }
  };

  const glowScale = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.12] });
  const fadeUpStyle = {
    opacity: fadeAnim,
    transform: [{ translateY: fadeAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TouchableOpacity style={[styles.themeToggle, { top: insets.top + 12 }]} onPress={toggleDark} activeOpacity={0.85}>
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
              {phase === 'success' ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="checkmark-circle" size={72} color={ORANGE} />
                  <Text style={[styles.header, { marginTop: 16 }]}>Email Verified!</Text>
                  <Text style={styles.subHeader}>Taking you to the login screen…</Text>
                </View>
              ) : phase === 'otp' ? (
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
                    <View
                      style={[
                        styles.inputWrapper,
                        { height: 64, marginBottom: 20 },
                        focusedInput === 'otp' && styles.inputFocused,
                      ]}
                    >
                      <Ionicons
                        name="keypad-outline"
                        size={24}
                        color={focusedInput === 'otp' ? ORANGE : colors.textMuted}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={[styles.input, { fontSize: 24, letterSpacing: 6, fontFamily: 'Poppins_700Bold' }]}
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
                    <Text style={{ color: colors.textSecondary, fontSize: 13, fontFamily: 'Poppins_400Regular', textDecorationLine: 'underline' }}>
                      Entered the wrong email? Go back
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Image source={require('../../../assets/appiconfinal2.png')} style={styles.logoImage} resizeMode="contain" />
                      <Text style={styles.brandText}>
                        Pack-<Text style={styles.brandTextOrange}>N-Ship</Text>
                      </Text>
                    </View>
                    <Text style={styles.header}>Create Account</Text>
                    <Text style={styles.subHeader}>Start shipping your packages securely today.</Text>
                  </View>

                  <View style={styles.imageUploadSection}>
                    <TouchableOpacity
                      style={styles.imagePicker}
                      onPress={async () => {
                        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                        if (status !== 'granted') return;
                        const res = await ImagePicker.launchImageLibraryAsync({
                          mediaTypes: ['images'],
                          allowsEditing: true,
                          aspect: [1, 1],
                          quality: 0.4,
                          exif: false,
                          base64: true,
                        });
                        if (!res.canceled && res.assets.length > 0) {
                          setImageUri(res.assets[0].uri);
                          setImageBase64(res.assets[0].base64 || null);
                        }
                      }}
                    >
                      {imageUri ? (
                        <Image source={{ uri: imageUri }} style={styles.profilePreview} />
                      ) : (
                        <View style={styles.imagePlaceholder}>
                          <Ionicons name="camera-outline" size={26} color={colors.textMuted} />
                        </View>
                      )}
                      <View style={styles.uploadBadge}>
                        <Ionicons name="add" size={14} color="#FFF" />
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.formContainer}>
                    <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, Boolean(firstNameError) && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'firstName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="First Name"
                        placeholderTextColor={colors.textMuted}
                        value={firstName}
                        onChangeText={(t) => {
                          setFirstName(t);
                          setFirstNameError(validateName(t, 'First name'));
                        }}
                        onFocus={() => setFocusedInput('firstName')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                    {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputFocused, Boolean(lastNameError) && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'lastName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Last Name"
                        placeholderTextColor={colors.textMuted}
                        value={lastName}
                        onChangeText={(t) => {
                          setLastName(t);
                          setLastNameError(validateName(t, 'Last name'));
                        }}
                        onFocus={() => setFocusedInput('lastName')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>
                    {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputFocused, Boolean(phoneError) && styles.inputError]}>
                      <Ionicons name="call-outline" size={20} color={focusedInput === 'phone' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Phone Number (e.g., 09123456789)"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        value={phone}
                        onChangeText={(t) => {
                          const c = t.replace(/[^0-9+]/g, '');
                          setPhone(c);
                          setPhoneError(validatePhone(c));
                        }}
                        onFocus={() => setFocusedInput('phone')}
                        onBlur={() => {
                          setFocusedInput(null);
                          const v = phone.trim();
                          if (!validatePhone(v)) {
                            checkTaken('phone_number', v).then((taken) => {
                              if (taken && phoneRef.current.trim() === v) {
                                setPhoneError('This phone number is already registered.');
                              }
                            });
                          }
                        }}
                      />
                    </View>
                    {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'email' && styles.inputFocused, Boolean(emailError) && styles.inputError]}>
                      <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Email Address"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        value={email}
                        onChangeText={(t) => {
                          setEmail(t);
                          setEmailError(validateEmail(t));
                        }}
                        onFocus={() => setFocusedInput('email')}
                        onBlur={() => {
                          setFocusedInput(null);
                          const v = email.trim().toLowerCase();
                          if (!validateEmail(email.trim())) {
                            checkTaken('email', v).then((taken) => {
                              if (taken && emailRef.current.trim().toLowerCase() === v) {
                                setEmailError('This email is already registered.');
                              }
                            });
                          }
                        }}
                      />
                    </View>
                    {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                    {/* Home Address Text Inputs */}
                    <View style={[styles.inputWrapper, focusedInput === 'street' && styles.inputFocused, Boolean(addressError && !structuredAddress.street.trim()) && styles.inputError]}>
                      <Ionicons name="home-outline" size={20} color={focusedInput === 'street' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Street Address / House No. / Unit"
                        placeholderTextColor={colors.textMuted}
                        value={structuredAddress.street}
                        onChangeText={(t) => updateAddressField('street', t)}
                        onFocus={() => setFocusedInput('street')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>

                    <View style={[styles.inputWrapper, focusedInput === 'barangay' && styles.inputFocused, Boolean(addressError && !structuredAddress.barangay.trim()) && styles.inputError]}>
                      <Ionicons name="location-outline" size={20} color={focusedInput === 'barangay' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Barangay"
                        placeholderTextColor={colors.textMuted}
                        value={structuredAddress.barangay}
                        onChangeText={(t) => updateAddressField('barangay', t)}
                        onFocus={() => setFocusedInput('barangay')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>

                    <View style={[styles.inputWrapper, focusedInput === 'city' && styles.inputFocused, Boolean(addressError && !structuredAddress.city.trim()) && styles.inputError]}>
                      <Ionicons name="business-outline" size={20} color={focusedInput === 'city' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="City / Municipality"
                        placeholderTextColor={colors.textMuted}
                        value={structuredAddress.city}
                        onChangeText={(t) => updateAddressField('city', t)}
                        onFocus={() => setFocusedInput('city')}
                        onBlur={() => setFocusedInput(null)}
                      />
                    </View>

                    <View style={styles.addressRow}>
                      <View style={[styles.inputWrapper, { flex: 1, marginRight: 6 }, focusedInput === 'province' && styles.inputFocused, Boolean(addressError && !structuredAddress.province.trim()) && styles.inputError]}>
                        <Ionicons name="map-outline" size={20} color={focusedInput === 'province' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                        <TextInput
                          style={styles.input}
                          placeholder="Province"
                          placeholderTextColor={colors.textMuted}
                          value={structuredAddress.province}
                          onChangeText={(t) => updateAddressField('province', t)}
                          onFocus={() => setFocusedInput('province')}
                          onBlur={() => setFocusedInput(null)}
                        />
                      </View>

                      <View style={[styles.inputWrapper, { flex: 0.85, marginLeft: 6 }, focusedInput === 'zip_code' && styles.inputFocused, Boolean(addressError && !structuredAddress.zip_code.trim()) && styles.inputError]}>
                        <Ionicons name="mail-open-outline" size={20} color={focusedInput === 'zip_code' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                        <TextInput
                          style={styles.input}
                          placeholder="Zip Code"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="number-pad"
                          value={structuredAddress.zip_code}
                          onChangeText={(t) => updateAddressField('zip_code', t)}
                          onFocus={() => setFocusedInput('zip_code')}
                          onBlur={() => setFocusedInput(null)}
                        />
                      </View>
                    </View>
                    {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, Boolean(passwordError) && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={(t) => {
                          setPassword(t);
                          setPasswordError(validatePassword(t));
                          if (confirmPassword) setConfirmPasswordError(validateConfirmPassword(t, confirmPassword));
                        }}
                        onFocus={() => setFocusedInput('password')}
                        onBlur={() => setFocusedInput(null)}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'confirmPassword' && styles.inputFocused, Boolean(confirmPasswordError) && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'confirmPassword' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Confirm Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showConfirmPassword}
                        value={confirmPassword}
                        onChangeText={(t) => {
                          setConfirmPassword(t);
                          setConfirmPasswordError(validateConfirmPassword(password, t));
                        }}
                        onFocus={() => setFocusedInput('confirmPassword')}
                        onBlur={() => setFocusedInput(null)}
                      />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                        <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
                  </View>

                  <TouchableOpacity
                    style={styles.termsRow}
                    onPress={() => { setAgreedToTerms((a) => !a); setTermsError(''); }}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreedToTerms }}
                  >
                    <View style={[styles.termsBox, agreedToTerms && styles.termsBoxOn]}>
                      {agreedToTerms && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                    </View>
                    <Text style={styles.termsText}>
                      I have read and agree to the{' '}
                      <Text style={styles.termsLink} onPress={() => setTermsOpen(true)}>Terms and Policies</Text>.
                    </Text>
                  </TouchableOpacity>
                  {termsError ? <Text style={[styles.errorText, { marginTop: 0 }]}>{termsError}</Text> : null}

                  <TouchableOpacity style={[styles.button, (loading || !agreedToTerms) && styles.buttonDisabled]} onPress={handleSignUp} disabled={loading}>
                    {loading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <ActivityIndicator color="#FFFFFF" size="small" />
                        <Text style={styles.buttonText}>Sending your code…</Text>
                      </View>
                    ) : (
                      <Text style={styles.buttonText}>Create Account</Text>
                    )}
                  </TouchableOpacity>

                  <TermsModal visible={termsOpen} variant="general" mode="read" onClose={() => setTermsOpen(false)} />

                  <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkContainer}>
                    <Text style={styles.link}>
                      Already have an account? <Text style={styles.linkBold}>Log In</Text>
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

const makeStyles = (c: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    keyboardAvoid: { flex: 1 },
    themeToggle: {
      position: 'absolute', right: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20,
      backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: c.border, shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 6, elevation: 3,
    },

    backgroundLayer: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, overflow: 'hidden' },
    glow: { position: 'absolute', borderRadius: 999, backgroundColor: ORANGE },
    glowTop: { width: 360, height: 360, top: -160, right: -140 },
    glowBottom: { width: 300, height: 300, bottom: -140, left: -120, opacity: 0.05 },

    innerContainer: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40, flexGrow: 1, justifyContent: 'center' },
    contentWrapper: { flex: 1, justifyContent: 'center' },
    centerBlock: { alignItems: 'center', justifyContent: 'center' },

    headerContainer: { marginBottom: 24, alignItems: 'flex-start' },
    brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
    logoImage: { width: 64, height: 64 },
    brandText: { fontSize: 25, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3, marginLeft: -12 },
    brandTextOrange: { color: ORANGE },
    header: { fontSize: 28, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
    subHeader: { fontSize: 15, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 22 },
    emailHighlight: { color: c.textPrimary, fontFamily: 'Poppins_600SemiBold' },

    imageUploadSection: { alignItems: 'center', marginBottom: 20 },
    imagePicker: {
      width: 76, height: 76, borderRadius: 38, backgroundColor: c.card,
      justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border, position: 'relative',
    },
    imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
    profilePreview: { width: 76, height: 76, borderRadius: 38 },
    uploadBadge: {
      position: 'absolute', bottom: 0, right: 0, backgroundColor: ORANGE,
      width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center',
      borderWidth: 2, borderColor: c.card,
    },

    formContainer: { marginBottom: 16 },
    addressRow: { flexDirection: 'row', justifyContent: 'space-between' },
    inputWrapper: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: c.card,
      borderWidth: 1, borderColor: c.border, borderRadius: 12, marginBottom: 12, height: 52,
    },
    inputIcon: { paddingLeft: 16, paddingRight: 8 },
    input: { flex: 1, height: '100%', fontSize: 15, fontFamily: 'Poppins_400Regular', color: c.textPrimary, paddingTop: 14 },
    inputFocused: { borderColor: ORANGE },
    inputError: { borderColor: c.error, backgroundColor: c.errorBg },
    eyeButton: { paddingHorizontal: 16, height: '100%', justifyContent: 'center' },
    errorText: { color: c.error, fontSize: 12, fontFamily: 'Poppins_600SemiBold', marginTop: -8, marginBottom: 10, marginLeft: 4 },

    button: {
      backgroundColor: ORANGE, height: 54, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', width: '100%', marginBottom: 20,
    },
    buttonDisabled: { opacity: 0.7 },
    termsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 6 },
    termsBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    termsBoxOn: { backgroundColor: ORANGE, borderColor: ORANGE },
    termsText: { flex: 1, fontSize: 13, lineHeight: 19, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
    termsLink: { color: ORANGE, fontFamily: 'Poppins_700Bold', textDecorationLine: 'underline' },
    buttonText: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', fontSize: 16 },

    linkContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
    link: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_400Regular' },
    linkBold: { color: ORANGE, fontFamily: 'Poppins_600SemiBold' },
  });