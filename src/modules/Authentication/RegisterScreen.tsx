// src/modules/Authentication/RegisterScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, TouchableWithoutFeedback,
  Keyboard, ActivityIndicator, Animated, Easing
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';

/** Brand */
const ORANGE = '#F27024';

export default function RegisterScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Form state
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

  // Image states
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // Error states
  const [firstNameError, setFirstNameError] = useState('');
  const [lastNameError, setLastNameError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

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
  /* Validation functions                                                */
  /* ------------------------------------------------------------------ */
  const validateName = (name: string, field: string) => {
    if (!name) return `${field} is required`;
    if (name.length < 2) return `${field} must be at least 2 characters`;
    return '';
  };

  const validatePhone = (phone: string) => {
    if (!phone) return 'Phone number is required';
    const phoneRegex = /^(09|\+639)\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
      return 'Enter a valid PH number (e.g., 09XXXXXXXXX)';
    }
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

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const handleFirstNameChange = (text: string) => {
    setFirstName(text);
    setFirstNameError(validateName(text, 'First name'));
  };

  const handleLastNameChange = (text: string) => {
    setLastName(text);
    setLastNameError(validateName(text, 'Last name'));
  };

  const handlePhoneChange = (text: string) => {
    const cleaned = text.replace(/[^0-9+]/g, '');
    setPhone(cleaned);
    setPhoneError(validatePhone(cleaned));
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    setEmailError(validateEmail(text));
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    setPasswordError(validatePassword(text));
    if (confirmPassword) {
      setConfirmPasswordError(validateConfirmPassword(text, confirmPassword));
    }
  };

  const handleConfirmPasswordChange = (text: string) => {
    setConfirmPassword(text);
    setConfirmPasswordError(validateConfirmPassword(password, text));
  };

  const togglePasswordVisibility = () => setShowPassword(!showPassword);
  const toggleConfirmPasswordVisibility = () => setShowConfirmPassword(!showConfirmPassword);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri);
        setImageBase64(result.assets[0].base64 || null);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not pick an image.');
    }
  };

  const getFriendlyErrorMessage = (error: any) => {
    const message = error?.message || '';
    const raw = JSON.stringify(error);  

    if (raw.includes('users_phone_number_key') || message.includes('duplicate key')) {
      return 'This phone number is already registered. Please log in or use a different number.';
    }

    if (message.includes('User already registered')) return 'This email is already registered. Please log in instead.';
    if (message.includes('Password should be at least 6 characters')) return 'Password must be at least 6 characters.';
    if (message.includes('Invalid email')) return 'Please enter a valid email address.';
    if (message.includes('network')) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
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
      const { data: existingPhone, error: phoneCheckError } = await supabase
        .from('users')
        .select('user_id')
        .eq('phone_number', cleanedPhone)
        .maybeSingle();

      if (phoneCheckError) console.error('Phone check error:', phoneCheckError);

      if (existingPhone) {
        setPhoneError('This phone number is already registered.');
        Alert.alert(
          'Phone Number Already Used',
          'An account already exists with this phone number. Please log in or use a different number.',
          [{ text: 'OK' }]
        );
        setLoading(false);
        return;
      }

      const { data: existingEmail } = await supabase
        .from('users')
        .select('user_id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (existingEmail) {
        setEmailError('This email is already registered.');
        Alert.alert(
          'Email Already Used',
          'An account already exists with this email. Please log in instead.',
          [{ text: 'OK' }]
        );
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
          emailRedirectTo: 'packnship://auth/confirm',
        },
      });

      if (signUpError) throw signUpError;

      if (imageBase64 && signUpData?.user) {
        try {
          const fileName = `${signUpData.user.id}_${Date.now()}.jpg`;
          const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, decode(imageBase64), {
              contentType: 'image/jpeg',
              upsert: true,
            });

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);

          await supabase.auth.updateUser({ data: { avatar_url: publicUrl } });
        } catch (uploadErr: any) {
          console.warn('Avatar upload failed:', uploadErr?.message);
        }
      }

      // Navigate to the new Permissions Prompt screen
      navigation.reset({
        index: 0,
        routes: [{ name: 'PermissionsPrompt' }],
      });
    } catch (error: any) {
      console.error('SIGNUP ERROR:', error);
      Alert.alert('Signup Failed', getFriendlyErrorMessage(error));
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
                <Text style={styles.header}>Create Account</Text>
                <Text style={styles.subHeader}>Start shipping your packages securely today.</Text>
              </View>

              {/* Avatar Picker */}
              <View style={styles.imageUploadSection}>
                <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.85}>
                  {imageUri ? (
                    <Image source={{ uri: imageUri }} style={styles.profilePreview} />
                  ) : (
                    <View style={styles.imagePlaceholder}>
                      <Ionicons name="camera-outline" size={26} color="#9CA3AF" />
                    </View>
                  )}
                  <View style={styles.uploadBadge}>
                    <Ionicons name="add" size={14} color="#FFF" />
                  </View>
                </TouchableOpacity>
              </View>

              {/* Input Fields */}
              <View style={styles.formContainer}>
                {/* First Name */}
                <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, firstNameError && styles.inputError]}>
                  <Ionicons name="person-outline" size={20} color={focusedInput === 'firstName' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="First Name"
                    placeholderTextColor="#9CA3AF"
                    value={firstName}
                    onChangeText={handleFirstNameChange}
                    onFocus={() => setFocusedInput('firstName')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
                {firstNameError ? <Text style={styles.errorText}>{firstNameError}</Text> : null}

                {/* Last Name */}
                <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputFocused, lastNameError && styles.inputError]}>
                  <Ionicons name="person-outline" size={20} color={focusedInput === 'lastName' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Last Name"
                    placeholderTextColor="#9CA3AF"
                    value={lastName}
                    onChangeText={handleLastNameChange}
                    onFocus={() => setFocusedInput('lastName')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
                {lastNameError ? <Text style={styles.errorText}>{lastNameError}</Text> : null}

                {/* Phone */}
                <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputFocused, phoneError && styles.inputError]}>
                  <Ionicons name="call-outline" size={20} color={focusedInput === 'phone' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number (e.g., 09123456789)"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={handlePhoneChange}
                    onFocus={() => setFocusedInput('phone')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
                {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

                {/* Email */}
                <View style={[styles.inputWrapper, focusedInput === 'email' && styles.inputFocused, emailError && styles.inputError]}>
                  <Ionicons name="mail-outline" size={20} color={focusedInput === 'email' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
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
                  />
                </View>
                {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

                {/* Password */}
                <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                  <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'password' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => setFocusedInput('password')}
                    onBlur={() => setFocusedInput(null)}
                  />
                  <TouchableOpacity style={styles.eyeButton} onPress={togglePasswordVisibility}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

                {/* Confirm Password */}
                <View style={[styles.inputWrapper, focusedInput === 'confirmPassword' && styles.inputFocused, confirmPasswordError && styles.inputError]}>
                  <Ionicons name="lock-closed-outline" size={20} color={focusedInput === 'confirmPassword' ? ORANGE : '#9CA3AF'} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm Password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={handleConfirmPasswordChange}
                    onFocus={() => setFocusedInput('confirmPassword')}
                    onBlur={() => setFocusedInput(null)}
                  />
                  <TouchableOpacity style={styles.eyeButton} onPress={toggleConfirmPasswordVisibility}>
                    <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
              </View>

              {/* Sign Up Button */}
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleSignUp}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.buttonText}>Create Account</Text>
                )}
              </TouchableOpacity>

              {/* Login Link */}
              <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkContainer}>
                <Text style={styles.link}>
                  Already have an account? <Text style={styles.linkBold}>Log In</Text>
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
  },
  contentWrapper: {
    flex: 1,
  },
  headerContainer: {
    marginBottom: 20,
    alignItems: 'flex-start',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  logoImage: {
    width: 54,
    height: 54,
  },
  brandText: {
    fontSize: 22,
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
  imageUploadSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  imagePicker: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    position: 'relative',
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePreview: {
    width: 76,
    height: 76,
    borderRadius: 38,
  },
  uploadBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: ORANGE,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  formContainer: {
    marginBottom: 12,
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
  button: {
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
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  linkContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  link: {
    color: '#6B7280',
    fontSize: 14,
  },
  linkBold: {
    color: ORANGE,
    fontWeight: '600',
  },
});