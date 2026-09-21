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
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

const ORANGE = '#FA7A25';
const BUCKET_NAME = 'vehicle-documents';

// ⚠️ DEV ONLY — Replace with your actual ID Analyzer key
const ID_ANALYZER_KEY = 'idk_lpCmsQcDtGPddpKFSEAFoWySTEwD3C3usJcIBzkz';

type Side = 'front' | 'back';

type ScanResult = {
  decision: string;
  confidence: number | null;
  documentType: string | null;
  documentName: string | null;
  data: any;
  raw: any;
} | null;

export default function RegisterProviderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(false);

  // License details
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Driver's license — front and back
  const [licenseFrontUri, setLicenseFrontUri] = useState<string | null>(null);
  const [licenseBackUri, setLicenseBackUri] = useState<string | null>(null);
  const [licenseFrontUrl, setLicenseFrontUrl] = useState<string | null>(null);
  const [licenseBackUrl, setLicenseBackUrl] = useState<string | null>(null);

  const [uploadingLicense, setUploadingLicense] = useState(false);
  const [scanningLicense, setScanningLicense] = useState(false);

  const [lastScanResult, setLastScanResult] = useState<ScanResult>(null);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const introAnim = useRef(new Animated.Value(0)).current;
  const detailsAnim = useRef(new Animated.Value(0)).current;
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
      animate(detailsAnim, 300),
      animate(licenseAnim, 450),
      animate(buttonAnim, 600),
    ]).start();
  }, [headerAnim, introAnim, detailsAnim, licenseAnim, buttonAnim]);

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
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
  /* Date helpers                                                        */
  /* ------------------------------------------------------------------ */
  const formatDateForApi = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const parseDateFromString = (s: string): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  };

  const handleDateChange = (event: any, selectedDate?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (event.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    if (selectedDate) {
      setLicenseExpiry(formatDateForApi(selectedDate));
    }
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /* unwrapField — handles strings, numbers, objects, and ARRAYS         */
  /* ------------------------------------------------------------------ */
  const unwrapField = (field: any): string | null => {
    if (!field) return null;
    if (typeof field === 'string') return field.trim();
    if (typeof field === 'number') return String(field);

    // ID Analyzer returns fields as arrays like [{value, confidence, index}]
    if (Array.isArray(field)) {
      if (field.length === 0) return null;
      return unwrapField(field[0]);
    }

    if (typeof field === 'object' && field.value != null) {
      return unwrapField(field.value);
    }

    return null;
  };

  /* ------------------------------------------------------------------ */
  /* ID Analyzer — /quickscan for OCR                                    */
  /* ------------------------------------------------------------------ */
  const runIdAnalyzerScan = async (
    frontSource: string,
    backSource?: string | null,
  ): Promise<ScanResult> => {
    try {
      setScanningLicense(true);
      console.log('=== Starting ID Analyzer quickscan ===');

      const payload: any = {
        document: frontSource,
      };

      if (backSource) {
        payload.documentBack = backSource;
      }

      const response = await fetch('https://api2.idanalyzer.com/quickscan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': ID_ANALYZER_KEY,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      console.log('ID Analyzer quickscan response:', JSON.stringify(result, null, 2));

      if (!response.ok || result.error) {
        const msg = result.error?.message || `Scan failed (${response.status})`;
        console.warn('ID Analyzer error:', msg);
        return {
          decision: 'error',
          confidence: null,
          documentType: null,
          documentName: null,
          data: {},
          raw: { error: msg },
        };
      }

      // Extract document type — from data.documentType (array)
      const rawDocType =
        result.data?.documentType ||
        result.documentType ||
        result.data?.document_type ||
        null;

      // Extract human-readable name
      const rawDocName = result.data?.documentName || null;

      const docType = unwrapField(rawDocType);
      const docName = unwrapField(rawDocName);

      console.log('Parsed documentType:', docType, '| documentName:', docName);

      return {
        decision: result.decision || 'review',
        confidence: result.confidence ?? null,
        documentType: docType ? docType.toUpperCase() : null,
        documentName: docName,
        data: result.data || {},
        raw: result,
      };
    } catch (err: any) {
      console.error('ID Analyzer fetch error:', err);
      return {
        decision: 'error',
        confidence: null,
        documentType: null,
        documentName: null,
        data: {},
        raw: { error: err.message },
      };
    } finally {
      setScanningLicense(false);
    }
  };

  const clearLicenseFields = () => {
    setLicenseNumber('');
    setLicenseExpiry('');
  };

  const applyScanResultToForm = (scan: ScanResult) => {
    if (!scan) return;

    if (scan.decision === 'error') {
      Alert.alert(
        'Scan Unavailable',
        'We could not scan your license automatically. Please enter the details manually.',
      );
      return;
    }

    // ✅ WHITELIST: only accept if ID Analyzer identifies this as a Driver's License
    // ID Analyzer codes: "D" = Driver's License, "I" = Identity Card, "P" = Passport
    const dt = (scan.documentType || '').toUpperCase();
    const dn = (scan.documentName || '').toLowerCase();

    const isDriverLicense =
      dt === 'D' ||
      dt === 'DL' ||
      dt === 'DRIVER_LICENSE' ||
      dt === 'DRIVERS_LICENSE' ||
      dn.includes("driver's license") ||
      dn.includes('drivers license') ||
      dn.includes('driver license') ||
      dn.includes('driver’s license');

    if (!isDriverLicense) {
      clearLicenseFields();
      const detected = scan.documentName || scan.documentType || 'an unknown document';
      Alert.alert(
        "Not a Driver's License",
        `We detected "${detected}". Only Philippine Driver's Licenses are accepted for provider registration. Please upload your Driver's License front and back.`,
      );
      return;
    }

    // ✅ It's a driver's license — auto-fill fields
    const d = scan.data || {};
    const docNum = unwrapField(d.documentNumber || d.licenseNumber);
    const expiry = unwrapField(d.dateOfExpiry || d.expiryDate);

    if (docNum) setLicenseNumber(docNum);

    if (expiry) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        setLicenseExpiry(expiry);
      } else {
        const m = expiry.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (m) {
          const [, a, b, y] = m;
          setLicenseExpiry(`${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`);
        } else {
          setLicenseExpiry(expiry);
        }
      }
    }

    if (scan.decision === 'accept') {
      Alert.alert(
        'License Verified ✓',
        "Your driver's license was successfully scanned. Please verify the auto-filled details.",
      );
    } else if (scan.decision === 'review') {
      Alert.alert(
        'License Scanned',
        'Your license was scanned. Please verify the auto-filled details and submit for admin review.',
      );
    } else if (scan.decision === 'reject') {
      Alert.alert(
        'License Not Verified',
        'The scan flagged your license. Please retake clearer photos or enter details manually.',
      );
    }
  };

  /* ------------------------------------------------------------------ */
  /* Image picker                                                        */
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
          await handlePickedImage(side, result.assets[0].uri);
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
          await handlePickedImage(side, result.assets[0].uri);
        }
      }
    } catch (error: any) {
      console.error('Pick error:', error);
      Alert.alert('Error', error?.message || 'Failed to pick image. Please try again.');
    }
  };

  const handlePickedImage = async (side: Side, uri: string) => {
    if (side === 'front') {
      setLicenseFrontUri(uri);
      setLicenseFrontUrl(null);
    } else {
      setLicenseBackUri(uri);
      setLicenseBackUrl(null);
    }

    try {
      setUploadingLicense(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const prefix = side === 'front' ? 'license_front' : 'license_back';
      const url = await uploadFile(uri, user.id, prefix);

      let frontUrl = licenseFrontUrl;
      let backUrl = licenseBackUrl;
      if (side === 'front') {
        setLicenseFrontUrl(url);
        frontUrl = url;
      } else {
        setLicenseBackUrl(url);
        backUrl = url;
      }

      console.log(`✅ ${prefix} uploaded:`, url);

      if (frontUrl && backUrl) {
        console.log('Both license sides ready — running ID Analyzer quickscan...');
        const scan = await runIdAnalyzerScan(frontUrl, backUrl);
        setLastScanResult(scan);
        applyScanResultToForm(scan);
      }
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

  /* ------------------------------------------------------------------ */
  /* File upload                                                         */
  /* ------------------------------------------------------------------ */
  const uploadFile = async (uri: string, userId: string, prefix: string): Promise<string> => {
    const rawExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileExt = ['jpg', 'jpeg', 'png'].includes(rawExt) ? rawExt : 'jpg';
    const contentType = `image/${fileExt}`;
    const fileName = `${userId}/${prefix}_${Date.now()}.${fileExt}`;

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, bytes, {
        contentType,
        upsert: true,
      });

    if (uploadError) throw new Error('Failed to upload file: ' + uploadError.message);

    const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
    if (!urlData?.publicUrl) throw new Error('Failed to get public URL');
    return urlData.publicUrl;
  };

  /* ------------------------------------------------------------------ */
  /* Register provider                                                   */
  /* ------------------------------------------------------------------ */
  const handleRegisterProvider = async () => {
    if (!licenseNumber.trim()) {
      Alert.alert('Required', "Please enter your Driver's License number.");
      return;
    }
    if (!licenseExpiry.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
      Alert.alert('Required', 'Please select a valid license expiry date.');
      return;
    }
    if (!licenseFrontUri || !licenseBackUri) {
      Alert.alert('Required', "Please upload both the FRONT and BACK of your Driver's License.");
      return;
    }
    if (!licenseFrontUrl || !licenseBackUrl) {
      Alert.alert('Please Wait', 'Your license images are still uploading. Please try again in a moment.');
      return;
    }

    // ✅ Final gate: only proceed if ID Analyzer confirmed it's a driver's license
    if (lastScanResult?.documentType || lastScanResult?.documentName) {
      const dt = (lastScanResult.documentType || '').toUpperCase();
      const dn = (lastScanResult.documentName || '').toLowerCase();

      const isDriverLicense =
        dt === 'D' ||
        dt === 'DL' ||
        dt === 'DRIVER_LICENSE' ||
        dt === 'DRIVERS_LICENSE' ||
        dn.includes("driver's license") ||
        dn.includes('drivers license') ||
        dn.includes('driver license') ||
        dn.includes('driver’s license');

      if (!isDriverLicense) {
        Alert.alert(
          "Not a Driver's License",
          `We detected "${lastScanResult.documentName || lastScanResult.documentType}". Please upload your Philippine Driver's License front and back.`,
        );
        return;
      }
    }

    setLoading(true);
    try {
      console.log('=== Starting Provider Application ===');

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!user) throw new Error('No user logged in');

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
        if (createRoleError) throw new Error('Failed to create Provider role: ' + createRoleError.message);
        providerRole = newRole;
      }
      if (!providerRole) throw new Error('Failed to resolve Provider role');

      const { data: existingRole } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userData.user_id)
        .eq('role_id', providerRole.role_id)
        .maybeSingle();

      const { data: existingVerif } = await supabase
        .from('provider_verifications')
        .select('verification_id, verification_status')
        .eq('provider_id', userData.user_id)
        .maybeSingle();

      if (existingRole || existingVerif) {
        const status = existingVerif?.verification_status || 'Unknown';
        const msg =
          status === 'Pending'
            ? 'Your application is already submitted and pending admin review.'
            : status === 'Approved'
            ? 'You are already an approved provider.'
            : status === 'Rejected'
            ? 'Your previous application was rejected. Please contact support to re-apply.'
            : 'You already have a provider application on file.';

        Alert.alert('Already Registered', msg, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        setLoading(false);
        return;
      }

      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({ user_id: userData.user_id, role_id: providerRole.role_id });
      if (assignError) throw new Error('Failed to assign role: ' + assignError.message);

      const { error: verifError } = await supabase
        .from('provider_verifications')
        .insert({
          provider_id: userData.user_id,
          drivers_license_number: licenseNumber.trim(),
          license_expiry_date: licenseExpiry.trim(),
          selfie_photo: licenseFrontUrl,
          selfie_photo_back: licenseBackUrl,
          verification_status: 'Pending',
          ...(lastScanResult
            ? {
                id_analyzer_decision: lastScanResult.decision || null,
                id_analyzer_confidence: lastScanResult.confidence ?? null,
                id_analyzer_raw: lastScanResult.raw || null,
              }
            : {}),
        });

      if (verifError) {
        await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userData.user_id)
          .eq('role_id', providerRole.role_id);

        console.error('Verification insert error:', verifError);
        throw new Error('Failed to submit verification: ' + verifError.message);
      }

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
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (error: any) {
      console.error('=== Registration Error ===', error);
      Alert.alert(
        'Registration Error',
        error.message || 'Failed to submit application. Please try again.',
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
              Enter your license details first, then upload the front and back photos of your
              Philippine Driver's License.
            </Text>
          </View>
        </Animated.View>

        {/* Progress indicator */}
        <Animated.View style={[styles.progressRow, fadeUp(introAnim, 20)]}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, detailsFilled && styles.progressDotDone]}>
              {detailsFilled ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>1</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, detailsFilled && styles.progressLabelDone]}>
              Details
            </Text>
          </View>
          <View style={[styles.progressLine, detailsFilled && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, licenseComplete && styles.progressDotDone]}>
              {licenseComplete ? (
                <Ionicons name="checkmark" size={12} color="#FFFFFF" />
              ) : (
                <Text style={styles.progressDotText}>2</Text>
              )}
            </View>
            <Text style={[styles.progressLabel, licenseComplete && styles.progressLabelDone]}>
              License
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

        {/* STEP 1: License Details */}
        <Animated.View style={[styles.detailsSection, fadeUp(detailsAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>1</Text>
              </View>
              <View>
                <Text style={styles.uploadTitle}>License Details</Text>
                <Text style={styles.uploadSubtitle}>
                  Enter the information printed on your license
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
            <TouchableOpacity
              style={styles.datePickerButton}
              onPress={() => setShowDatePicker(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="calendar-outline" size={18} color={ORANGE} />
              <Text
                style={[
                  styles.datePickerText,
                  !licenseExpiry && styles.datePickerPlaceholder,
                ]}
              >
                {licenseExpiry || 'Select expiry date'}
              </Text>
              <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={licenseExpiry ? parseDateFromString(licenseExpiry) : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
              minimumDate={new Date()}
            />
          )}

          {Platform.OS === 'ios' && showDatePicker && (
            <TouchableOpacity
              style={styles.iosDoneButton}
              onPress={() => setShowDatePicker(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.iosDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        {/* STEP 2: Driver's License images */}
        <Animated.View style={[styles.uploadSection, fadeUp(licenseAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>2</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Driver's License Photos</Text>
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

          {scanningLicense && (
            <View style={styles.scanningBadge}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.scanningText}>Scanning license...</Text>
            </View>
          )}

          {!scanningLicense && lastScanResult && (
            <View
              style={[
                styles.scanResultBadge,
                lastScanResult.decision === 'accept' && styles.scanResultAccept,
                lastScanResult.decision === 'review' && styles.scanResultReview,
                lastScanResult.decision === 'reject' && styles.scanResultReject,
                lastScanResult.decision === 'error' && styles.scanResultError,
              ]}
            >
              <Ionicons
                name={
                  lastScanResult.decision === 'accept'
                    ? 'checkmark-circle'
                    : lastScanResult.decision === 'review'
                    ? 'alert-circle'
                    : lastScanResult.decision === 'reject'
                    ? 'close-circle'
                    : 'information-circle'
                }
                size={16}
                color={
                  lastScanResult.decision === 'accept'
                    ? '#10B981'
                    : lastScanResult.decision === 'review'
                    ? '#F59E0B'
                    : lastScanResult.decision === 'reject'
                    ? '#EF4444'
                    : '#6B7280'
                }
              />
              <Text
                style={[
                  styles.scanResultText,
                  {
                    color:
                      lastScanResult.decision === 'accept'
                        ? '#065F46'
                        : lastScanResult.decision === 'review'
                        ? '#92400E'
                        : lastScanResult.decision === 'reject'
                        ? '#991B1B'
                        : '#374151',
                  },
                ]}
              >
                {lastScanResult.decision === 'accept'
                  ? 'License verified by ID Analyzer'
                  : lastScanResult.decision === 'review'
                  ? 'Scanned — pending admin review'
                  : lastScanResult.decision === 'reject'
                  ? 'License rejected by ID Analyzer'
                  : 'ID Analyzer unavailable — enter details manually'}
              </Text>
            </View>
          )}
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

  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

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
    ...StyleSheet.absoluteFill,
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

  scanningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  scanningText: {
    fontSize: 12,
    fontWeight: '700',
    color: ORANGE,
    letterSpacing: 0.2,
  },
  scanResultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  scanResultAccept: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  scanResultReview: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  scanResultReject: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  scanResultError: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  scanResultText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

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

  datePickerButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  datePickerText: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  datePickerPlaceholder: {
    color: '#9CA3AF',
    fontWeight: '500',
  },
  iosDoneButton: {
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: ORANGE,
    borderRadius: 10,
  },
  iosDoneText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

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