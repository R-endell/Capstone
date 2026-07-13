import React, { useState, useRef } from 'react';
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

  // Animated value for smooth toggle
  const passwordFadeAnim = useRef(new Animated.Value(1)).current;
  const confirmPasswordFadeAnim = useRef(new Animated.Value(1)).current;

  // Validation functions
  const validateName = (name: string, field: string) => {
    if (!name) return `${field} is required`;
    if (name.length < 2) return `${field} must be at least 2 characters`;
    return '';
  };

  const validatePhone = (phone: string) => {
    if (!phone) return 'Phone number is required';
    // Allow PH numbers: 09xxxxxxxxx or +639xxxxxxxxx
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

  // Handlers with validation
  const handleFirstNameChange = (text: string) => {
    setFirstName(text);
    setFirstNameError(validateName(text, 'First name'));
  };

  const handleLastNameChange = (text: string) => {
    setLastName(text);
    setLastNameError(validateName(text, 'Last name'));
  };

  const handlePhoneChange = (text: string) => {
    // Allow numbers and + only
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

  // Smooth toggle functions
  const togglePasswordVisibility = () => {
    Animated.sequence([
      Animated.timing(passwordFadeAnim, { toValue: 0.7, duration: 100, useNativeDriver: true, easing: Easing.ease }),
      Animated.timing(passwordFadeAnim, { toValue: 1, duration: 100, useNativeDriver: true, easing: Easing.ease }),
    ]).start(() => setShowPassword(!showPassword));
  };

  const toggleConfirmPasswordVisibility = () => {
    Animated.sequence([
      Animated.timing(confirmPasswordFadeAnim, { toValue: 0.7, duration: 100, useNativeDriver: true, easing: Easing.ease }),
      Animated.timing(confirmPasswordFadeAnim, { toValue: 1, duration: 100, useNativeDriver: true, easing: Easing.ease }),
    ]).start(() => setShowConfirmPassword(!showConfirmPassword));
  };

  // Image picker
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

  // Get user-friendly error message
  const getFriendlyErrorMessage = (error: any) => {
    const message = error?.message || '';
    if (message.includes('User already registered')) return 'This email is already registered. Please log in instead.';
    if (message.includes('Password should be at least 6 characters')) return 'Password must be at least 6 characters.';
    if (message.includes('Invalid email')) return 'Please enter a valid email address.';
    if (message.includes('network')) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
  };

  const handleSignUp = async () => {
    // Validate all fields
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
    let avatarUrl = '';

    try {
      // Upload avatar if selected
      if (imageBase64) {
        const fileName = `${Date.now()}_${firstName.toLowerCase()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, decode(imageBase64), {
            contentType: 'image/jpeg',
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);
        avatarUrl = publicUrl;
      }

      // Sign up user
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone.trim(),
            avatar_url: avatarUrl,
          },
          emailRedirectTo: 'packnship://auth/confirm',
        }
      });

      if (signUpError) throw signUpError;

      Alert.alert(
        'Registration Successful! 🎉',
        'Please check your email to verify your account before logging in.',
        [{ text: 'OK', onPress: () => navigation.navigate('Login') }]
      );

    } catch (error: any) {
      Alert.alert('Signup Failed', getFriendlyErrorMessage(error));
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
          <ScrollView contentContainerStyle={styles.innerContainer} showsVerticalScrollIndicator={false}>

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
            </View>

            <View style={styles.headerContainer}>
              <Text style={styles.header}>Create Account 🚀</Text>
              <Text style={styles.subHeader}>Start shipping your packages securely today.</Text>
            </View>

            {/* Avatar Picker */}
            <View style={styles.imageUploadSection}>
              <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.profilePreview} />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Ionicons name="camera" size={32} color="#9CA3AF" />
                  </View>
                )}
                <View style={styles.uploadBadge}>
                  <Ionicons name="add" size={16} color="#FFF" />
                </View>
              </TouchableOpacity>
              <Text style={styles.uploadText}>Upload Profile Picture</Text>
            </View>

            {/* Input Fields */}
            <View style={styles.inputContainer}>
              {/* First Name */}
              <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputFocused, firstNameError && styles.inputError]}>
                <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
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
                <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
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
                <Ionicons name="call-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
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
                <Ionicons name="mail-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
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

              {/* Password with smooth toggle */}
              <View style={[styles.inputWrapper, focusedInput === 'password' && styles.inputFocused, passwordError && styles.inputError]}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <Animated.View style={{ flex: 1, opacity: passwordFadeAnim }}>
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
                </Animated.View>
                <TouchableOpacity style={styles.eyeButton} onPress={togglePasswordVisibility}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color="#6B7280" />
                </TouchableOpacity>
              </View>
              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

              {/* Confirm Password with smooth toggle */}
              <View style={[styles.inputWrapper, focusedInput === 'confirmPassword' && styles.inputFocused, confirmPasswordError && styles.inputError]}>
                <Ionicons name="lock-closed-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <Animated.View style={{ flex: 1, opacity: confirmPasswordFadeAnim }}>
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
                </Animated.View>
                <TouchableOpacity style={styles.eyeButton} onPress={toggleConfirmPasswordVisibility}>
                  <Ionicons name={showConfirmPassword ? "eye-off-outline" : "eye-outline"} size={22} color="#6B7280" />
                </TouchableOpacity>
              </View>
              {confirmPasswordError ? <Text style={styles.errorText}>{confirmPasswordError}</Text> : null}
            </View>

            {/* Sign Up Button */}
            <TouchableOpacity
              style={[styles.button, loading && { opacity: 0.8 }]}
              onPress={handleSignUp}
              disabled={loading}
            >
              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.buttonText}>Creating account...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </TouchableOpacity>

            {/* Login Link */}
            <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.linkContainer}>
              <Text style={styles.link}>Already have an account? <Text style={styles.linkBold}>Log In</Text></Text>
            </TouchableOpacity>

          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  keyboardAvoid: { flex: 1 },
  innerContainer: {
    paddingHorizontal: 28,
    paddingTop: 10,
    paddingBottom: 40,
    flexGrow: 1,
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 4,
  },
  logoImage: {
    width: 120,
    height: 70,
  },
  logoText: {
    fontSize: 24,
    fontWeight: '900',
    fontStyle: 'italic',
    color: '#111827',
  },
  logoTextOrange: { color: '#F27024' },
  headerContainer: {
    width: '100%',
    marginBottom: 16,
    alignItems: 'center',
  },
  header: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  subHeader: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '400',
    textAlign: 'center',
  },
  imageUploadSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  imagePicker: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePreview: {
    width: 86,
    height: 86,
    borderRadius: 43,
  },
  uploadBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#F27024',
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  uploadText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 6,
  },
  inputContainer: {
    width: '100%',
    marginBottom: 8,
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
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
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
    marginBottom: 6,
    marginLeft: 4,
  },
  button: {
    backgroundColor: '#F27024',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
    marginBottom: 16,
    shadowColor: '#F27024',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonText: {
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
  linkContainer: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  link: {
    textAlign: 'center',
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '400',
  },
  linkBold: {
    color: '#F27024',
    fontWeight: '700',
  },
});