// src/modules/Dashboard/Sender/RegisterProviderScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

const ORANGE = '#FA7A25';

export default function RegisterProviderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);
  const [orcrImage, setOrcrImage] = useState<string | null>(null);
  const [driversLicenseImage, setDriversLicenseImage] = useState<string | null>(null);
  const [uploadingOrcr, setUploadingOrcr] = useState(false);
  const [uploadingLicense, setUploadingLicense] = useState(false);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const introAnim = useRef(new Animated.Value(0)).current;
  const orcrAnim = useRef(new Animated.Value(0)).current;
  const licenseAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

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
      animate(introAnim, 150),
      animate(orcrAnim, 300),
      animate(licenseAnim, 450),
      animate(buttonAnim, 600),
    ]).start();
  }, [headerAnim, introAnim, orcrAnim, licenseAnim, buttonAnim]);

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({
        inputRange: [0, 1],
        outputRange: [distance, 0],
      }),
    }],
  });

  /* ------------------------------------------------------------------ */
  /* Image picker & upload                                               */
  /* ------------------------------------------------------------------ */
  const pickImage = async (type: 'orcr' | 'license') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant permission to access your photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        if (type === 'orcr') {
          setOrcrImage(uri);
          await uploadImage(uri, 'orcr');
        } else {
          setDriversLicenseImage(uri);
          await uploadImage(uri, 'license');
        }
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const uploadImage = async (uri: string, type: 'orcr' | 'license') => {
    try {
      if (type === 'orcr') setUploadingOrcr(true);
      else setUploadingLicense(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${user.id}/${type}_${Date.now()}.${fileExt}`;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      try {
        const { data, error } = await supabase.storage
          .from('provider-documents')
          .upload(fileName, arrayBuffer, {
            contentType: `image/${fileExt}`,
            upsert: true,
          });

        if (error) {
          if (error.message?.includes('bucket not found')) {
            await supabase.storage.createBucket('provider-documents', { public: true });

            const { data: retryData, error: retryError } = await supabase.storage
              .from('provider-documents')
              .upload(fileName, arrayBuffer, {
                contentType: `image/${fileExt}`,
                upsert: true,
              });

            if (retryError) throw retryError;
          } else {
            throw error;
          }
        }
      } catch (uploadError: any) {
        console.error('Upload error:', uploadError);
        throw new Error('Failed to upload image: ' + uploadError.message);
      }

      const { data: urlData } = supabase.storage
        .from('provider-documents')
        .getPublicUrl(fileName);

      if (type === 'orcr') setOrcrImage(urlData.publicUrl);
      else setDriversLicenseImage(urlData.publicUrl);

    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Upload Error', error.message || 'Failed to upload image');
    } finally {
      if (type === 'orcr') setUploadingOrcr(false);
      else setUploadingLicense(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Register provider                                                   */
  /* ------------------------------------------------------------------ */
  const handleRegisterProvider = async () => {
    if (!orcrImage || !driversLicenseImage) {
      Alert.alert('Required', "Please upload both OR/CR and Driver's License.");
      return;
    }

    setLoading(true);
    try {
      console.log('=== Starting Provider Registration ===');

      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError) {
        console.error('Auth error:', authError);
        throw new Error('Authentication error: ' + authError.message);
      }
      if (!user) {
        console.error('No user found');
        throw new Error('No user logged in');
      }

      let { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, email')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (!userData) {
        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert({
            auth_id: user.id,
            first_name: user.user_metadata?.first_name || 'User',
            last_name: user.user_metadata?.last_name || '',
            email: user.email || '',
            is_verified: true,
            is_active: true,
          })
          .select('user_id, first_name, last_name, email')
          .maybeSingle();

        if (createError) throw new Error('Failed to create user: ' + createError.message);
        userData = newUser;
      }

      if (!userData) throw new Error('Failed to get or create user');

      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id, role_name')
        .eq('role_name', 'Provider')
        .maybeSingle();

      if (roleError) throw new Error('Error fetching Provider role: ' + roleError.message);

      let providerRole = roleData;

      if (!providerRole) {
        const { data: newRole, error: createRoleError } = await supabase
          .from('roles')
          .insert({ role_name: 'Provider' })
          .select('role_id, role_name')
          .maybeSingle();

        if (createRoleError) throw new Error('Failed to create Provider role: ' + createRoleError.message);
        if (!newRole) throw new Error('Failed to create Provider role');
        providerRole = newRole;
      }

      const { data: existingRole, error: checkError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userData.user_id)
        .eq('role_id', providerRole.role_id)
        .maybeSingle();

      if (existingRole) {
        Alert.alert(
          'Already Registered',
          'You are already registered as a Provider!',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        setLoading(false);
        return;
      }

      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({
          user_id: userData.user_id,
          role_id: providerRole.role_id,
        });

      if (assignError) throw new Error('Failed to assign role: ' + assignError.message);

      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          role: 'Provider',
          provider_documents: {
            orcr: orcrImage,
            drivers_license: driversLicenseImage,
            registered_at: new Date().toISOString(),
          },
        },
      });

      if (updateError) console.warn('Failed to update auth metadata, but role was assigned');

      Alert.alert(
        'Success! 🎉',
        'You have been registered as a Provider! You can now switch to Provider mode.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );

    } catch (error: any) {
      console.error('=== Registration Error ===');
      console.error('Error:', error);
      Alert.alert(
        'Registration Error',
        error.message || 'Failed to register as provider. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const bothUploaded = !!orcrImage && !!driversLicenseImage;

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>Become a partner</Text>
          <Text style={styles.headerTitle}>Register as Provider</Text>
        </View>
      </Animated.View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro card */}
        <Animated.View style={[styles.introCard, fadeUp(introAnim, 20)]}>
          <View style={styles.introIconBox}>
            <Ionicons name="shield-checkmark" size={22} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Verify your identity</Text>
            <Text style={styles.introText}>
              Upload clear photos of your documents to get verified and start accepting deliveries.
            </Text>
          </View>
        </Animated.View>

        {/* Progress indicator */}
        <Animated.View style={[styles.progressRow, fadeUp(introAnim, 20)]}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, orcrImage && styles.progressDotDone]}>
              {orcrImage ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>1</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, orcrImage && styles.progressLabelDone]}>OR/CR</Text>
          </View>
          <View style={[styles.progressLine, orcrImage && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, driversLicenseImage && styles.progressDotDone]}>
              {driversLicenseImage ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>2</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, driversLicenseImage && styles.progressLabelDone]}>
              License
            </Text>
          </View>
          <View style={[styles.progressLine, bothUploaded && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, bothUploaded && styles.progressDotDone]}>
              {bothUploaded ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>3</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, bothUploaded && styles.progressLabelDone]}>
              Ready
            </Text>
          </View>
        </Animated.View>

        {/* OR/CR Upload */}
        <Animated.View style={[styles.uploadSection, fadeUp(orcrAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>1</Text>
              </View>
              <View>
                <Text style={styles.uploadTitle}>OR / CR</Text>
                <Text style={styles.uploadSubtitle}>Official Receipt & Certificate of Registration</Text>
              </View>
            </View>
            {orcrImage && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                <Text style={styles.completedBadgeText}>Uploaded</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.uploadBox, orcrImage && styles.uploadBoxFilled]}
            onPress={() => pickImage('orcr')}
            disabled={uploadingOrcr}
            activeOpacity={0.85}
          >
            {uploadingOrcr ? (
              <View style={styles.uploadingContainer}>
                <ActivityIndicator size="large" color={ORANGE} />
                <Text style={styles.uploadingText}>Uploading...</Text>
              </View>
            ) : orcrImage ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: orcrImage }} style={styles.previewImage} />
                <View style={styles.previewOverlay}>
                  <View style={styles.replaceBadge}>
                    <Ionicons name="camera-reverse-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.replaceText}>Replace</Text>
                  </View>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.uploadIconCircle}>
                  <Ionicons name="cloud-upload-outline" size={28} color={ORANGE} />
                </View>
                <Text style={styles.uploadButtonText}>Tap to upload OR/CR</Text>
                <Text style={styles.uploadHint}>JPG · PNG</Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* License Upload */}
        <Animated.View style={[styles.uploadSection, fadeUp(licenseAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>2</Text>
              </View>
              <View>
                <Text style={styles.uploadTitle}>Driver's License</Text>
                <Text style={styles.uploadSubtitle}>Valid professional or non-professional license</Text>
              </View>
            </View>
            {driversLicenseImage && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                <Text style={styles.completedBadgeText}>Uploaded</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.uploadBox, driversLicenseImage && styles.uploadBoxFilled]}
            onPress={() => pickImage('license')}
            disabled={uploadingLicense}
            activeOpacity={0.85}
          >
            {uploadingLicense ? (
              <View style={styles.uploadingContainer}>
                <ActivityIndicator size="large" color={ORANGE} />
                <Text style={styles.uploadingText}>Uploading...</Text>
              </View>
            ) : driversLicenseImage ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: driversLicenseImage }} style={styles.previewImage} />
                <View style={styles.previewOverlay}>
                  <View style={styles.replaceBadge}>
                    <Ionicons name="camera-reverse-outline" size={14} color="#FFFFFF" />
                    <Text style={styles.replaceText}>Replace</Text>
                  </View>
                </View>
              </View>
            ) : (
              <>
                <View style={styles.uploadIconCircle}>
                  <Ionicons name="cloud-upload-outline" size={28} color={ORANGE} />
                </View>
                <Text style={styles.uploadButtonText}>Tap to upload Driver's License</Text>
                <Text style={styles.uploadHint}>JPG · PNG</Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Info note */}
        <Animated.View style={[styles.infoNote, fadeUp(buttonAnim, 20)]}>
          <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
          <Text style={styles.infoNoteText}>
            Your documents are stored securely and only used for verification purposes.
          </Text>
        </Animated.View>

        {/* Register Button */}
        <Animated.View
          style={[
            { width: '100%' },
            fadeUp(buttonAnim, 20),
            { transform: [{ scale: buttonScale }] },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.registerButton,
              !bothUploaded && styles.registerButtonDisabled,
            ]}
            onPress={handleRegisterProvider}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            disabled={loading || !bothUploaded}
            activeOpacity={0.9}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.registerButtonText}>Registering...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.registerButtonText}>Register as Provider</Text>
              </>
            )}
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  /* Header */
  header: {
    backgroundColor: ORANGE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 26,
    gap: 12,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },

  /* Content */
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  /* Intro */
  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  introIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  introTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  introText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    fontWeight: '500',
  },

  /* Progress */
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
    paddingHorizontal: 10,
  },
  progressStep: { alignItems: 'center', gap: 6 },
  progressDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  progressDotDone: { backgroundColor: '#10B981' },
  progressDotText: { fontSize: 12, fontWeight: '800', color: '#9CA3AF' },
  progressLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.3,
  },
  progressLabelDone: { color: '#10B981' },
  progressLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 8,
    marginBottom: 20,
  },
  progressLineDone: { backgroundColor: '#10B981' },

  /* Upload Section */
  uploadSection: { marginBottom: 20 },
  uploadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  uploadTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  uploadNumberBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  uploadNumberText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  uploadTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  uploadSubtitle: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 1,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  completedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.2,
  },

  uploadBox: {
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
    backgroundColor: '#FAFAFA',
  },
  uploadBoxFilled: {
    borderStyle: 'solid',
    borderColor: '#FFE4D2',
    padding: 0,
    backgroundColor: '#FFF7ED',
    overflow: 'hidden',
    minHeight: 180,
  },
  uploadIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  uploadButtonText: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  uploadHint: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  uploadingContainer: { alignItems: 'center', gap: 10 },
  uploadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  previewContainer: {
    width: '100%',
    height: 180,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  previewOverlay: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  replaceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  replaceText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  /* Info note */
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  infoNoteText: {
    flex: 1,
    fontSize: 11,
    color: '#1E40AF',
    fontWeight: '600',
    lineHeight: 16,
  },

  /* Register Button */
  registerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 4,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  registerButtonDisabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  registerButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});