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
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';


const ORANGE = '#FA7A25';
const BUCKET_NAME = 'vehicle-documents';

type Side = 'front' | 'back';

export default function RegisterProviderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);

  // Driver's license — front and back
  const [licenseFrontUri, setLicenseFrontUri] = useState<string | null>(null);
  const [licenseBackUri, setLicenseBackUri] = useState<string | null>(null);
  const [licenseFrontUrl, setLicenseFrontUrl] = useState<string | null>(null);
  const [licenseBackUrl, setLicenseBackUrl] = useState<string | null>(null);

  const [uploadingLicense, setUploadingLicense] = useState(false);

  // License details
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState(''); // YYYY-MM-DD

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const introAnim = useRef(new Animated.Value(0)).current;
  const licenseAnim = useRef(new Animated.Value(0)).current;
  const detailsAnim = useRef(new Animated.Value(0)).current;
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
      animate(licenseAnim, 300),
      animate(detailsAnim, 450),
      animate(buttonAnim, 600),
    ]).start();
  }, [headerAnim, introAnim, licenseAnim, detailsAnim, buttonAnim]);

  const animatePressIn = () => {
    Animated.spring(buttonScale, {
      toValue: 0.97,
      useNativeDriver: true,
      speed: 30,
      bounciness: 4,
    }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 6,
    }).start();
  };

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
  /* License picker — front or back, camera or gallery                   */
  /* ------------------------------------------------------------------ */
  const handlePickLicense = (side: Side) => {
    const title = side === 'front' ? "Front of Driver's License" : "Back of Driver's License";
    Alert.alert(title, 'Choose how you want to provide the photo.', [
      { text: 'Take Photo', onPress: () => pickImage(side, 'camera') },
      { text: 'Choose from Gallery', onPress: () => pickImage(side, 'library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const pickImage = async (side: Side, source: 'camera' | 'library') => {
    try {
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant camera permission to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!result.canceled && result.assets.length > 0) {
          await handlePicked(side, result.assets[0].uri);
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant permission to access your photos.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.85,
        });
        if (!result.canceled && result.assets.length > 0) {
          await handlePicked(side, result.assets[0].uri);
        }
      }
    } catch (error: any) {
      console.error('Pick error:', error);
      Alert.alert('Error', error?.message || 'Failed to pick image. Please try again.');
    }
  };

  const handlePicked = async (side: Side, uri: string) => {
    // Show preview immediately, clear the previous uploaded URL
    if (side === 'front') {
      setLicenseFrontUri(uri);
      setLicenseFrontUrl(null);
    } else {
      setLicenseBackUri(uri);
      setLicenseBackUrl(null);
    }

    // Upload in background
    try {
      setUploadingLicense(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const prefix = side === 'front' ? 'license_front' : 'license_back';
      const url = await uploadSingle(uri, user.id, prefix);

      if (side === 'front') setLicenseFrontUrl(url);
      else setLicenseBackUrl(url);

      console.log(`✅ ${prefix} uploaded:`, url);
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Upload Error', error.message || 'Failed to upload image');
      if (side === 'front') {
        setLicenseFrontUri(null);
        setLicenseFrontUrl(null);
      } else {
        setLicenseBackUri(null);
        setLicenseBackUrl(null);
      }
    } finally {
      setUploadingLicense(false);
    }
  };

  const uploadSingle = async (uri: string, userId: string, prefix: string): Promise<string> => {
    const rawExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileExt = ['jpg', 'jpeg', 'png'].includes(rawExt) ? rawExt : 'jpg';
    const fileName = `${userId}/${prefix}_${Date.now()}.${fileExt}`;

    const file = new File(uri);
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, arrayBuffer, {
        contentType: `image/${fileExt}`,
        upsert: true,
      });

    if (uploadError) throw new Error('Failed to upload image: ' + uploadError.message);

    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(fileName);

    if (!urlData?.publicUrl) throw new Error('Failed to get public URL');
    return urlData.publicUrl;
  };

  /* ------------------------------------------------------------------ */
  /* Register provider                                                   */
  /* ------------------------------------------------------------------ */
  const handleRegisterProvider = async () => {
    if (!licenseFrontUri || !licenseBackUri) {
      Alert.alert('Required', "Please upload both the FRONT and BACK of your Driver's License.");
      return;
    }
    if (!licenseFrontUrl || !licenseBackUrl) {
      Alert.alert('Please Wait', 'Your license images are still uploading. Please try again in a moment.');
      return;
    }
    if (!licenseNumber.trim()) {
      Alert.alert('Required', "Please enter your Driver's License number.");
      return;
    }
    if (!licenseExpiry.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
      Alert.alert('Required', 'Please enter a valid license expiry date (YYYY-MM-DD).');
      return;
    }

    setLoading(true);
    try {
      console.log('=== Starting Provider Application ===');

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!user) throw new Error('No user logged in');

      // Get or create users row
      let { data: userData } = await supabase
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
            is_verified: false,
            is_active: true,
          })
          .select('user_id, first_name, last_name, email')
          .maybeSingle();

        if (createError) throw new Error('Failed to create user: ' + createError.message);
        userData = newUser;
      }
      if (!userData) throw new Error('Failed to get or create user');

      // Get or create Provider role
      let { data: providerRole } = await supabase
        .from('roles')
        .select('role_id, role_name')
        .eq('role_name', 'Provider')
        .maybeSingle();

      if (!providerRole) {
        const { data: newRole, error: createRoleError } = await supabase
          .from('roles')
          .insert({ role_name: 'Provider' })
          .select('role_id, role_name')
          .maybeSingle();
        if (createRoleError)
          throw new Error('Failed to create Provider role: ' + createRoleError.message);
        providerRole = newRole;
      }
      if (!providerRole) throw new Error('Failed to resolve Provider role');

      // Check if user already has Provider role
      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userData.user_id)
        .eq('role_id', providerRole.role_id)
        .maybeSingle();

      if (existingRole) {
        const { data: existingVerif } = await supabase
          .from('provider_verifications')
          .select('verification_id, verification_status')
          .eq('provider_id', userData.user_id)
          .maybeSingle();

        const statusMsg = existingVerif?.verification_status
          ? `Your application is currently: ${existingVerif.verification_status}.`
          : 'You are already registered as a Provider.';

        Alert.alert('Already Registered', statusMsg, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        setLoading(false);
        return;
      }

      // Assign Provider role
      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({ user_id: userData.user_id, role_id: providerRole.role_id });
      if (assignError) throw new Error('Failed to assign role: ' + assignError.message);

      // Submit verification row
      const { error: verifError } = await supabase
        .from('provider_verifications')
        .insert({
          provider_id: userData.user_id,
          drivers_license_number: licenseNumber.trim(),
          license_expiry_date: licenseExpiry.trim(),
          selfie_photo: licenseFrontUrl,
          selfie_photo_back: licenseBackUrl,
          verification_status: 'Pending',
        });

      if (verifError) {
        console.error('Verification insert error:', verifError);
        throw new Error('Failed to submit verification: ' + verifError.message);
      }

      // Update auth metadata
      await supabase.auth.updateUser({
        data: {
          role: 'Provider',
          provider_documents: {
            drivers_license_front: licenseFrontUrl,
            drivers_license_back: licenseBackUrl,
            license_number: licenseNumber.trim(),
            registered_at: new Date().toISOString(),
          },
        },
      });

      Alert.alert(
        'Application Submitted',
        'Your provider application is pending admin approval. You will be notified once verified.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error: any) {
      console.error('=== Registration Error ===', error);
      Alert.alert(
        'Registration Error',
        error.message || 'Failed to submit application. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const detailsFilled =
    licenseNumber.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry.trim());
  const licenseComplete =
    !!licenseFrontUri && !!licenseBackUri && !!licenseFrontUrl && !!licenseBackUrl;
  const canSubmit = licenseComplete && detailsFilled;

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
            <Text style={styles.introTitle}>Apply to become a provider</Text>
            <Text style={styles.introText}>
              Upload the front and back of your driver's license for admin review.
            </Text>
          </View>
        </Animated.View>

        {/* Progress indicator */}
        <Animated.View style={[styles.progressRow, fadeUp(introAnim, 20)]}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, licenseComplete && styles.progressDotDone]}>
              {licenseComplete ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>1</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, licenseComplete && styles.progressLabelDone]}>
              License
            </Text>
          </View>
          <View style={[styles.progressLine, detailsFilled && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, detailsFilled && styles.progressDotDone]}>
              {detailsFilled ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>2</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, detailsFilled && styles.progressLabelDone]}>
              Details
            </Text>
          </View>
          <View style={[styles.progressLine, canSubmit && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, canSubmit && styles.progressDotDone]}>
              {canSubmit ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>3</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, canSubmit && styles.progressLabelDone]}>
              Ready
            </Text>
          </View>
        </Animated.View>

        {/* Driver's License — front & back tiles */}
        <Animated.View style={[styles.uploadSection, fadeUp(licenseAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Driver's License</Text>
                <Text style={styles.uploadSubtitle}>
                  Upload front & back — camera or gallery
                </Text>
              </View>
            </View>
            {licenseComplete && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                <Text style={styles.completedBadgeText}>Uploaded</Text>
              </View>
            )}
          </View>

          <View style={styles.tilesRow}>
            {/* FRONT tile */}
            <TouchableOpacity
              style={[styles.tile, licenseFrontUri && styles.tileFilled]}
              onPress={() => handlePickLicense('front')}
              disabled={uploadingLicense}
              activeOpacity={0.85}
            >
              {licenseFrontUri ? (
                <>
                  <Image source={{ uri: licenseFrontUri }} style={styles.tileImage} />
                  <View style={styles.tileLabelBadge}>
                    <Text style={styles.tileLabelText}>FRONT</Text>
                  </View>
                  {!licenseFrontUrl && uploadingLicense && (
                    <View style={styles.tileOverlay}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.tileEmpty}>
                  <Ionicons name="card-outline" size={26} color={ORANGE} />
                  <Text style={styles.tileEmptyText}>Front</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* BACK tile */}
            <TouchableOpacity
              style={[styles.tile, licenseBackUri && styles.tileFilled]}
              onPress={() => handlePickLicense('back')}
              disabled={uploadingLicense}
              activeOpacity={0.85}
            >
              {licenseBackUri ? (
                <>
                  <Image source={{ uri: licenseBackUri }} style={styles.tileImage} />
                  <View style={styles.tileLabelBadge}>
                    <Text style={styles.tileLabelText}>BACK</Text>
                  </View>
                  {!licenseBackUrl && uploadingLicense && (
                    <View style={styles.tileOverlay}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.tileEmpty}>
                  <Ionicons name="card-outline" size={26} color={ORANGE} />
                  <Text style={styles.tileEmptyText}>Back</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.uploadHint}>
            Tip: use a flat surface and good lighting for clearer photos.
          </Text>
        </Animated.View>

        {/* License details */}
        <Animated.View style={[styles.detailsSection, fadeUp(detailsAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>2</Text>
              </View>
              <View>
                <Text style={styles.uploadTitle}>License Details</Text>
                <Text style={styles.uploadSubtitle}>
                  Enter the information on your license
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Driver's License Number</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. D06-11-009385"
              placeholderTextColor="#9CA3AF"
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>License Expiry Date</Text>
            <TextInput
              style={styles.textInput}
              placeholder="YYYY-MM-DD (e.g. 2026-12-31)"
              placeholderTextColor="#9CA3AF"
              value={licenseExpiry}
              onChangeText={setLicenseExpiry}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
            />
          </View>
        </Animated.View>

        {/* Info note */}
        <Animated.View style={[styles.infoNote, fadeUp(buttonAnim, 20)]}>
          <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
          <Text style={styles.infoNoteText}>
            Your application will be reviewed by an admin. You'll be able to accept deliveries
            once approved.
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
            style={[styles.registerButton, !canSubmit && styles.registerButtonDisabled]}
            onPress={handleRegisterProvider}
            onPressIn={animatePressIn}
            onPressOut={animatePressOut}
            disabled={loading || !canSubmit}
            activeOpacity={0.9}
          >
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="small" color="#FFF" />
                <Text style={styles.registerButtonText}>Submitting...</Text>
              </View>
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.registerButtonText}>Submit for Verification</Text>
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
    marginHorizontal: 6,
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

  /* Two-tile layout for front & back */
  tilesRow: {
    flexDirection: 'row',
    gap: 12,
  },
  tile: {
    flex: 1,
    height: 140,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
    overflow: 'hidden',
    position: 'relative',
  },
  tileFilled: {
    borderStyle: 'solid',
    borderColor: '#FFE4D2',
    backgroundColor: '#FFF7ED',
  },
  tileEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tileEmptyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.2,
  },
  tileImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  tileLabelBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  tileLabelText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tileOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadHint: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 10,
    letterSpacing: 0.2,
    textAlign: 'center',
  },

  /* Details section */
  detailsSection: { marginBottom: 20 },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
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