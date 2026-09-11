import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch, StatusBar,
  Animated, Easing,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

/** Brand */
const ORANGE = '#FA7A25';

export default function EditProfileScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGoogleLinked, setIsGoogleLinked] = useState(true);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const avatarAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  const linkedAnim = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation                                                  */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(avatarAnim, 150),
      animate(formAnim, 300),
      animate(linkedAnim, 450),
    ]).start();
  }, [headerAnim, avatarAnim, formAnim, linkedAnim]);

  /* ------------------------------------------------------------------ */
  /* Fetch user data                                                     */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const fetchUserData = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();

      if (error) {
        Alert.alert('Error', 'Could not load user data.');
      } else if (user) {
        const first = user.user_metadata?.first_name || '';
        const last = user.user_metadata?.last_name || '';
        setFullName(`${first} ${last}`.trim());
        setPhone(user.user_metadata?.phone || '');
        setEmail(user.email || '');
        setImageUri(user.user_metadata?.avatar_url || null);
      }
      setLoading(false);
    };
    fetchUserData();
  }, []);

  /* ------------------------------------------------------------------ */
  /* Handlers                                                            */
  /* ------------------------------------------------------------------ */
  const pickImage = async () => {
    try {
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
    } catch (error) {
      Alert.alert('Error', 'Could not pick an image.');
    }
  };

  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      Alert.alert('Error', 'Please enter your name.');
      return;
    }

    setSaving(true);
    let finalAvatarUrl = imageUri;

    try {
      const nameParts = fullName.trim().split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

      if (imageBase64) {
        const fileExt = 'jpg';
        const fileName = `${Date.now()}_${firstName.toLowerCase()}.${fileExt}`;

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

        finalAvatarUrl = publicUrl;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone,
          avatar_url: finalAvatarUrl,
        },
      });

      if (updateError) throw updateError;

      Alert.alert('Success', 'Your profile has been updated!');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Update Error', error.message || 'Could not save profile changes.');
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + 16 },
          fadeUp(headerAnim, -14),
        ]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 42 }} />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar */}
          <Animated.View style={[styles.imageUploadSection, fadeUp(avatarAnim, 20)]}>
            <TouchableOpacity
              style={styles.imagePicker}
              onPress={pickImage}
              activeOpacity={0.85}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.profilePreview} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="person" size={48} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={14} color="#FFFFFF" />
              </View>
            </TouchableOpacity>
            <Text style={styles.uploadHint}>Tap to change photo</Text>
          </Animated.View>

          {/* Form */}
          <Animated.View style={[styles.formContainer, fadeUp(formAnim, 20)]}>
            {/* Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <View
                style={[
                  styles.inputWrapper,
                  focusedInput === 'name' && styles.inputWrapperFocused,
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={focusedInput === 'name' ? ORANGE : '#9CA3AF'}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  value={fullName}
                  onChangeText={setFullName}
                  placeholderTextColor="#9CA3AF"
                  placeholder="Juan Dela Cruz"
                  onFocus={() => setFocusedInput('name')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            {/* Phone */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <View
                style={[
                  styles.inputWrapper,
                  focusedInput === 'phone' && styles.inputWrapperFocused,
                ]}
              >
                <Ionicons
                  name="call-outline"
                  size={18}
                  color={focusedInput === 'phone' ? ORANGE : '#9CA3AF'}
                  style={styles.inputIcon}
                />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholderTextColor="#9CA3AF"
                  placeholder="09123456789"
                  onFocus={() => setFocusedInput('phone')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View
                style={[
                  styles.inputWrapper,
                  focusedInput === 'email' && styles.inputWrapperFocused,
                  styles.inputWrapperDisabled,
                ]}
              >
                <Ionicons name="mail-outline" size={18} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: '#9CA3AF' }]}
                  value={email}
                  editable={false}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#9CA3AF"
                  placeholder="you@example.com"
                />
                <Ionicons name="lock-closed-outline" size={14} color="#9CA3AF" style={{ marginRight: 14 }} />
              </View>
              <Text style={styles.helperText}>Email cannot be changed</Text>
            </View>

            {/* Save Button */}
            <TouchableOpacity
              style={[styles.saveButton, saving && { opacity: 0.8 }]}
              onPress={handleSaveProfile}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <View style={styles.savingContainer}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.saveButtonText}>Saving...</Text>
                </View>
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>Save Changes</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* Linked Accounts */}
          <Animated.View style={[styles.linkedAccountsSection, fadeUp(linkedAnim, 20)]}>
            <Text style={styles.sectionTitle}>Linked Accounts</Text>

            <View style={styles.linkedCard}>
              <View style={styles.linkedRow}>
                <View style={styles.linkedLeft}>
                  <View style={styles.googleIconWrapper}>
                    <Image
                      source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/768px-Google_%22G%22_logo.svg.png' }}
                      style={styles.googleIcon}
                    />
                  </View>
                  <View>
                    <Text style={styles.linkedText}>Google</Text>
                    <Text style={styles.linkedSubtext}>
                      {isGoogleLinked ? 'Connected' : 'Not connected'}
                    </Text>
                  </View>
                </View>
                <Switch
                  trackColor={{ false: '#E5E7EB', true: '#22C55E' }}
                  thumbColor={'#FFFFFF'}
                  ios_backgroundColor="#E5E7EB"
                  onValueChange={() => setIsGoogleLinked(prev => !prev)}
                  value={isGoogleLinked}
                />
              </View>
            </View>
          </Animated.View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingBottom: 30,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  /* ------------------------------------------------------------------ */
  /* Scroll                                                              */
  /* ------------------------------------------------------------------ */
  scrollContent: {
    paddingBottom: 60,
  },
  bottomSpacer: {
    height: 40,
  },

  /* ------------------------------------------------------------------ */
  /* Avatar                                                              */
  /* ------------------------------------------------------------------ */
  imageUploadSection: {
    alignItems: 'center',
    marginTop: -46,
    marginBottom: 24,
    
  },
  imagePicker: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
    overflow: 'visible',
  },
  profilePreview: {
    width: 102,
    height: 102,
    borderRadius: 51,
    
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  uploadHint: {
    marginTop: 12,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Form                                                                */
  /* ------------------------------------------------------------------ */
  formContainer: {
    paddingHorizontal: 24,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  inputWrapperFocused: {
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  inputWrapperDisabled: {
    backgroundColor: '#F9FAFB',
  },
  inputIcon: {
    paddingLeft: 14,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  helperText: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 6,
    marginLeft: 4,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Save Button                                                         */
  /* ------------------------------------------------------------------ */
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 8,
    marginBottom: 8,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  savingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  /* ------------------------------------------------------------------ */
  /* Linked Accounts                                                     */
  /* ------------------------------------------------------------------ */
  linkedAccountsSection: {
    paddingHorizontal: 24,
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  linkedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  linkedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  googleIcon: {
    width: 22,
    height: 22,
    resizeMode: 'contain',
  },
  linkedText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '700',
  },
  linkedSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },
});