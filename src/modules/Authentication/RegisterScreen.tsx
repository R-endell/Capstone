// src/modules/Authentication/RegisterScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard,
  ActivityIndicator, Animated, Easing, Modal
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { GOOGLE_MAP_ID } from '../../utils/mapConfig';

const ORANGE = '#F27024';
const COOLDOWN_SECONDS = 60;

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
  
  // Location State
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  
  // Structured Address State
  const [structuredAddress, setStructuredAddress] = useState({
    barangay: '',
    city: '',
    province: '',
    zip_code: '',
  });
  
  // Map Modal State
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [mapCenter, setMapCenter] = useState({ lat: 10.3157, lng: 123.8854 }); // Default to Cebu
  const mapRef = useRef<MapView>(null);

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
  const validateAddress = (addr: string) => {
    if (!addr) return 'Please select your home address on the map';
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

  // --- MAP LOGIC ---
  const handleLocateMe = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location is needed to find your current position.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      
      setMapCenter(newCoords);
      
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: newCoords.lat,
          longitude: newCoords.lng,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 500);
      }
    } catch {
      Alert.alert('Error', 'Could not fetch your current location.');
    }
  };

  const confirmMapLocation = async () => {
    setIsGeocoding(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${mapCenter.lat}&lon=${mapCenter.lng}&addressdetails=1`,
        {
          headers: { 'User-Agent': 'PackNShipMobileApp/1.0 (capstone.ctu@gmail.com)', 'Accept': 'application/json' },
        }
      );
      const json = await response.json();
      
      let street = 'Selected Location';
      let city = 'Unknown City';
      let barangay = 'Unknown';
      let province = 'Unknown';
      let zipCode = '0000';
      
      if (json && json.address) {
        const a = json.address;
        const streetParts = [a.house_number, a.road].filter(Boolean);
        street = streetParts.length > 0 ? streetParts.join(' ') : (json.display_name ? json.display_name.split(',')[0] : 'Selected Location');
        city = a.city || a.town || a.municipality || 'Unknown City';
        barangay = a.suburb || a.neighbourhood || a.village || a.quarter || 'Unknown';
        province = a.state || a.state_district || a.county || a.province || a.region || 'Unknown';
        zipCode = (a.postcode && a.postcode.length === 4) ? a.postcode : '0000';
      }

      setAddress(`${street}, ${city}`);
      setLat(mapCenter.lat);
      setLng(mapCenter.lng);
      setStructuredAddress({
        barangay,
        city,
        province,
        zip_code: zipCode,
      });
      setAddressError('');
      setIsMapVisible(false);
    } catch (err) {
      Alert.alert('Error', 'Could not get the address for this location. Please try again.');
    } finally {
      setIsGeocoding(false);
    }
  };

  // --- SIGN UP ---
  const handleSignUp = async () => {
    const firstNameValidation = validateName(firstName, 'First name');
    const lastNameValidation = validateName(lastName, 'Last name');
    const phoneValidation = validatePhone(phone);
    const emailValidation = validateEmail(email);
    const addressValidation = validateAddress(address);
    const passwordValidation = validatePassword(password);
    const confirmValidation = validateConfirmPassword(password, confirmPassword);

    if (firstNameValidation) { setFirstNameError(firstNameValidation); return; }
    if (lastNameValidation) { setLastNameError(lastNameValidation); return; }
    if (phoneValidation) { setPhoneError(phoneValidation); return; }
    if (emailValidation) { setEmailError(emailValidation); return; }
    if (addressValidation) { setAddressError(addressValidation); return; }
    if (passwordValidation) { setPasswordError(passwordValidation); return; }
    if (confirmValidation) { setConfirmPasswordError(confirmValidation); return; }

    if (!lat || !lng) {
      Alert.alert('Location Required', 'Please select your home address on the map.');
      return;
    }

    setLoading(true);
    try {
      const cleanedPhone = phone.trim();
      
      const { data: existingPhone } = await supabase.from('users').select('user_id').eq('phone_number', cleanedPhone).maybeSingle();
      if (existingPhone) {
        setPhoneError('This phone number is already registered.');
        setLoading(false);
        return;
      }

      const { data: existingEmail } = await supabase.from('users').select('user_id').eq('email', email.trim().toLowerCase()).maybeSingle();
      if (existingEmail) {
        setEmailError('This email is already registered.');
        setLoading(false);
        return;
      }

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
      if (!signUpData?.user) throw new Error("No user returned from Supabase Auth.");

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password,
      });

      if (signInError) {
        console.warn("Could not sign in immediately after signup.");
      }

      await new Promise(resolve => setTimeout(resolve, 1500));

      let avatarUrl = '';
      if (imageBase64) {
        try {
          const fileName = `${signUpData.user.id}_${Date.now()}.jpg`;
          const { error: uploadError } = await supabase.storage.from('avatars').upload(fileName, decode(imageBase64), { contentType: 'image/jpeg', upsert: true });
          if (!uploadError) {
             const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
             avatarUrl = publicUrl;
             await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
          }
        } catch (uploadErr) {
          console.warn('Avatar upload failed:', uploadErr);
        }
      }

      const { data: locData, error: locError } = await supabase
        .from('locations')
        .insert({
          street_address: address,
          barangay: structuredAddress.barangay,
          city: structuredAddress.city,
          province: structuredAddress.province,
          zip_code: structuredAddress.zip_code,
          latitude: lat,
          longitude: lng,
        })
        .select('location_id')
        .single();

      if (locError) {
        console.error("Location Insert Error:", locError);
        throw locError;
      }

      const { error: userError } = await supabase
        .from('users')
        .update({
          location_id: locData.location_id,
          profile_photo: avatarUrl || null,
        })
        .eq('auth_id', signUpData.user.id);

      if (userError) {
        console.error("User Update Error:", userError);
        throw userError;
      }
      
      await supabase.auth.signOut();

      setSentTo(email.trim().toLowerCase());
      setPhase('otp');
      setCooldown(COOLDOWN_SECONDS);
    } catch (error: any) {
      console.error('SIGNUP FATAL ERROR:', error);
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

      await supabase.auth.signOut();
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

      {/* Hide animations when map is open to prevent WebView flickering */}
      {!isMapVisible && (
        <View style={styles.backgroundLayer} pointerEvents="none">
          <Animated.View style={[styles.glow, styles.glowTop, { transform: [{ scale: glowScale }], opacity: glowOpacity }]} />
          <View style={[styles.glow, styles.glowBottom]} />
        </View>
      )}

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
                <>
                  <View style={styles.headerContainer}>
                    <View style={styles.brandRow}>
                      <Image source={require('../../../assets/appiconfinal2.png')} style={styles.logoImage} resizeMode="contain" />
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
                    <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, firstNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'firstName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="First Name" placeholderTextColor={colors.textMuted} value={firstName} onChangeText={(t) => { setFirstName(t); setFirstNameError(validateName(t, 'First name')); }} onFocus={() => setFocusedInput('firstName')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputFocused, lastNameError && styles.inputError]}>
                      <Ionicons name="person-outline" size={20} color={focusedInput === 'lastName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Last Name" placeholderTextColor={colors.textMuted} value={lastName} onChangeText={(t) => { setLastName(t); setLastNameError(validateName(t, 'Last name')); }} onFocus={() => setFocusedInput('lastName')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputFocused, phoneError && styles.inputError]}>
                      <Ionicons name="call-outline" size={20} color={focusedInput === 'phone' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Phone Number (e.g., 09123456789)" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={(t) => { const c = t.replace(/[^0-9+]/g, ''); setPhone(c); setPhoneError(validatePhone(c)); }} onFocus={() => setFocusedInput('phone')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'email' && styles.inputFocused, emailError && styles.inputError]}>
                      <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Email Address" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={(t) => { setEmail(t); setEmailError(validateEmail(t)); }} onFocus={() => setFocusedInput('email')} onBlur={() => setFocusedInput(null)} />
                    </View>
                    {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                    <TouchableOpacity 
                      style={[styles.inputWrapper, addressError && styles.inputError, { justifyContent: 'space-between' }]} 
                      onPress={() => { Keyboard.dismiss(); setIsMapVisible(true); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                        <Ionicons name="home-outline" size={20} color={ORANGE} style={styles.inputIcon} />
                        <Text style={[styles.input, { paddingTop: 15, color: address ? colors.textPrimary : colors.textMuted }]} numberOfLines={1}>
                          {address || 'Select Home Address on Map'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-down" size={20} color={colors.textSecondary} style={{ marginRight: 16 }} />
                    </TouchableOpacity>
                    {addressError ? <Text style={styles.errorText}>{addressError}</Text> : null}

                    <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                      <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                      <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.textMuted} secureTextEntry={!showPassword} value={password} onChangeText={(t) => { setPassword(t); setPasswordError(validatePassword(t)); if (confirmPassword) setConfirmPasswordError(validateConfirmPassword(t, confirmPassword)); }} onFocus={() => setFocusedInput('password')} onBlur={() => setFocusedInput(null)} />
                      <TouchableOpacity style={styles.eyeButton} onPress={() => setShowPassword(!showPassword)}>
                        <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

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

      {/* MAP MODAL */}
      <Modal visible={isMapVisible} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={{ flex: 1 }}
            googleMapId={GOOGLE_MAP_ID}
            userInterfaceStyle="light"
            initialRegion={{
              latitude: mapCenter.lat,
              longitude: mapCenter.lng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            onRegionChangeComplete={(region) => {
              setMapCenter({ lat: region.latitude, lng: region.longitude });
            }}
            showsUserLocation={true}
            showsMyLocationButton={false}
            showsCompass={false}
            toolbarEnabled={false}
          />
          
          <View style={styles.mapPinContainer} pointerEvents="none">
            <View style={styles.mapPinHead}>
              <Ionicons name="home" size={22} color="#FFFFFF" />
            </View>
            <View style={styles.mapPinPoint} />
          </View>

          <View style={[styles.mapTopOverlay, { paddingTop: insets.top + 10 }]}>
            <TouchableOpacity style={styles.mapBackBtn} onPress={() => setIsMapVisible(false)}>
              <Ionicons name="close" size={24} color="#111" />
            </TouchableOpacity>
            <View style={styles.mapInstructionBox}>
              <Text style={styles.mapInstructionText}>Drag map to select exact location</Text>
            </View>
          </View>

          <TouchableOpacity 
            style={[styles.mapLocateBtn, { bottom: insets.bottom + 100 }]} 
            onPress={handleLocateMe}
          >
            <Ionicons name="locate" size={24} color={ORANGE} />
          </TouchableOpacity>

          <View style={[styles.mapBottomOverlay, { paddingBottom: insets.bottom + 20 }]}>
            <TouchableOpacity 
              style={[styles.mapConfirmBtn, isGeocoding && { opacity: 0.7 }]} 
              onPress={confirmMapLocation}
              disabled={isGeocoding}
            >
              {isGeocoding ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#FFF" />
                  <Text style={styles.mapConfirmText}>Confirm Home Address</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  keyboardAvoid: { flex: 1 },
  themeToggle: { position: 'absolute', right: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 6, elevation: 3 },
  
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
  brandText: { fontSize: 25, fontWeight: '800', fontStyle: 'italic', color: c.textPrimary, letterSpacing: -0.3, marginLeft: -12 },
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
  input: { flex: 1, height: '100%', fontSize: 15, color: c.textPrimary, paddingTop: 14 },
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

  // --- MAP MODAL STYLES ---
  mapPinContainer: {
    position: 'absolute', top: '50%', left: '50%',
    marginLeft: -22, marginTop: -44,
    alignItems: 'center', zIndex: 4,
  },
  mapPinHead: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 8,
  },
  mapPinPoint: {
    width: 0, height: 0, backgroundColor: 'transparent', borderStyle: 'solid',
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: ORANGE, marginTop: -1,
  },
  mapTopOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12,
  },
  mapBackBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  mapInstructionBox: {
    flex: 1, backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },
  mapInstructionText: { fontWeight: '700', color: '#111827', textAlign: 'center' },
  
  mapLocateBtn: {
    position: 'absolute', right: 20, width: 50, height: 50, borderRadius: 25, backgroundColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
  },

  mapBottomOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
  },
  mapConfirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  mapConfirmText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});