// src/modules/Dashboard/Sender/RegisterProviderScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert,
  StatusBar, ActivityIndicator, Animated, Easing, TextInput, Platform,
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
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const ORANGE = '#FA7A25';
const BUCKET_NAME = 'vehicle-documents';

const ID_ANALYZER_KEY = 'idk_lpCmsQcDtGPddpKFSEAFoWySTEwD3C3usJcIBzkz';
const MIN_CONFIDENCE_PERCENT = 55; // Minimum confidence required to accept an ID photo

type Side = 'front' | 'back';

type ScanResult = {
  decision: string;
  confidence: number | null;
  documentType: string | null;
  documentName: string | null;
  documentNumber: string | null;
  documentSide: string | null;
  isValidDriverLicense: boolean;
  errorMessage?: string | null;
  data: any;
  raw: any;
} | null;

export default function RegisterProviderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(false);

  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [licenseFrontUri, setLicenseFrontUri] = useState<string | null>(null);
  const [licenseBackUri, setLicenseBackUri] = useState<string | null>(null);
  const [licenseFrontBase64, setLicenseFrontBase64] = useState<string | null>(null);
  const [licenseBackBase64, setLicenseBackBase64] = useState<string | null>(null);
  const [licenseFrontUrl, setLicenseFrontUrl] = useState<string | null>(null);
  const [licenseBackUrl, setLicenseBackUrl] = useState<string | null>(null);

  const [frontVerified, setFrontVerified] = useState(false);
  const [backVerified, setBackVerified] = useState(false);

  const [uploadingSide, setUploadingSide] = useState<Side | null>(null);

  // Live selfie (camera only, front camera). Stored separately from the license photos.
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [uploadingSelfie, setUploadingSelfie] = useState(false);
  const [scanningLicense, setScanningLicense] = useState(false);

  const [lastScanResult, setLastScanResult] = useState<ScanResult>(null);

  // Controls whether the License NUMBER field can be edited manually.
  // Only unlocked if the photo IS verified as a Driver's License, but OCR missed the number string.
  const [manualNumberEntryAllowed, setManualNumberEntryAllowed] = useState(false);

  // Tracks whether scanner has completed (success or fail) since last photo change
  const [scanAttempted, setScanAttempted] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const introAnim = useRef(new Animated.Value(0)).current;
  const licenseAnim = useRef(new Animated.Value(0)).current;
  const detailsAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
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
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

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

  const unwrapField = (field: any): string | null => {
    if (!field) return null;
    if (typeof field === 'string') return field.trim();
    if (typeof field === 'number') return String(field);
    if (Array.isArray(field)) {
      if (field.length === 0) return null;
      return unwrapField(field[0]);
    }
    if (typeof field === 'object' && field.value != null) {
      return unwrapField(field.value);
    }
    return null;
  };

  const extractConfidenceFromRaw = (rawResult: any): number | null => {
    if (!rawResult || typeof rawResult !== 'object') return null;

    if (typeof rawResult.confidence === 'number' && rawResult.confidence > 0) {
      const percentage = rawResult.confidence <= 1 ? rawResult.confidence * 100 : rawResult.confidence;
      return Number(percentage.toFixed(1));
    }

    const dataObj = rawResult.data;
    if (dataObj && typeof dataObj === 'object') {
      const allScores: number[] = [];

      for (const key of Object.keys(dataObj)) {
        const fieldArray = dataObj[key];
        if (Array.isArray(fieldArray) && fieldArray.length > 0) {
          const field = fieldArray[0];
          if (typeof field.confidence === 'number' && field.confidence > 0) {
            allScores.push(field.confidence);
          }
        }
      }

      if (allScores.length > 0) {
        const avg = allScores.reduce((acc, v) => acc + v, 0) / allScores.length;
        const percentage = avg <= 1 ? avg * 100 : avg;
        return Number(percentage.toFixed(1));
      }
    }

    return null;
  };

  /**
   * Checks if the scanned document is genuinely a Driver's License
   * and contains actual ID fields (not a random photo of a pet, vehicle, or scenery).
   */
  const checkIsDriverLicense = (
    docType: string | null,
    docName: string | null,
    dataObj: any,
    confidence: number | null
  ): boolean => {
    const dt = (docType || '').toUpperCase();
    const dn = (docName || '').toLowerCase();

    const matchesDriverLicenseType =
      dt === 'D' ||
      dt === 'DL' ||
      dt === 'DRIVER_LICENSE' ||
      dt === 'DRIVERS_LICENSE' ||
      dn.includes("driver's license") ||
      dn.includes('drivers license') ||
      dn.includes('driver license') ||
      dn.includes('driver’s license') ||
      dn.includes('driving licence') ||
      dn.includes('driving license');

    if (!matchesDriverLicenseType) return false;

    // Must have extracted at least some recognizable personal/ID fields
    const hasMeaningfulFields = Boolean(
      unwrapField(dataObj?.documentNumber) ||
      unwrapField(dataObj?.licenseNumber) ||
      unwrapField(dataObj?.firstName) ||
      unwrapField(dataObj?.lastName) ||
      unwrapField(dataObj?.fullName) ||
      unwrapField(dataObj?.dateOfBirth)
    );

    if (!hasMeaningfulFields) return false;

    // Reject ultra-low confidence hallucinations
    if (confidence !== null && confidence < MIN_CONFIDENCE_PERCENT) {
      return false;
    }

    return true;
  };

  /**
   * Validates that a single image (used when Back is uploaded before Front, or verifying Back)
   * actually looks like an ID document and not a random object/animal/truck.
   */
  const checkIsAtLeastIdDocument = (result: any, confidence: number | null): boolean => {
    if (!result || result.error) return false;
    const dataObj = result.data || {};
    const fieldKeys = Object.keys(dataObj);

    // If ID Analyzer couldn't extract any ID fields at all, it's a random image
    if (fieldKeys.length === 0) return false;

    const dt = (unwrapField(dataObj.documentType || result.documentType) || '').toUpperCase();
    const dn = (unwrapField(dataObj.documentName || result.documentName) || '').toLowerCase();

    const hasDocIdentity =
      dt.length > 0 ||
      dn.length > 0 ||
      Boolean(unwrapField(dataObj.documentSide)) ||
      Boolean(unwrapField(dataObj.documentNumber)) ||
      Boolean(unwrapField(dataObj.firstName)) ||
      Boolean(unwrapField(dataObj.lastName)) ||
      Boolean(unwrapField(dataObj.barcode)) ||
      Boolean(unwrapField(dataObj.mrz));

    if (!hasDocIdentity) return false;
    if (confidence !== null && confidence < MIN_CONFIDENCE_PERCENT) return false;

    return true;
  };

  const resolveValidIdTypeFromScan = (scan: ScanResult): string => {
    const rawData = scan?.raw?.data || scan?.data || {};
    const rawDocName = unwrapField(rawData.documentName) || scan?.documentName || '';
    const rawDocType = (unwrapField(rawData.documentType) || scan?.documentType || '').toUpperCase();

    if (
      rawDocType === 'D' ||
      rawDocType === 'DL' ||
      rawDocType === 'DRIVER_LICENSE' ||
      rawDocType === 'DRIVERS_LICENSE' ||
      rawDocName.toLowerCase().includes('driver')
    ) {
      return "Driver's License";
    }
    if (rawDocName) return rawDocName;
    if (rawDocType) return rawDocType;
    return "Driver's License";
  };

  const resolveValidIdNumberFromScan = (scan: ScanResult, fallbackLicenseNumber: string): string => {
    const rawData = scan?.raw?.data || scan?.data || {};
    const fromRaw =
      unwrapField(rawData.documentNumber) ||
      unwrapField(rawData.licenseNumber) ||
      unwrapField(rawData.idNumber) ||
      scan?.documentNumber ||
      null;
    return (fromRaw || fallbackLicenseNumber).trim();
  };

  const runIdAnalyzerScan = async (
    frontSource: string,
    backSource?: string | null,
  ): Promise<ScanResult> => {
    try {
      setScanningLicense(true);
      console.log('=== Starting ID Analyzer quickscan ===');

      const payload: any = { document: frontSource };
      if (backSource) payload.documentBack = backSource;

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
          documentNumber: null,
          documentSide: null,
          isValidDriverLicense: false,
          errorMessage: msg,
          data: {},
          raw: { error: msg, confidence: null },
        };
      }

      const rawDocType = result.data?.documentType || result.documentType || result.data?.document_type || null;
      const rawDocName = result.data?.documentName || result.documentName || null;
      const rawDocNumber = result.data?.documentNumber || result.data?.licenseNumber || null;
      const rawDocSide = result.data?.documentSide || result.documentSide || null;

      const docType = unwrapField(rawDocType);
      const docName = unwrapField(rawDocName);
      const docNumber = unwrapField(rawDocNumber);
      const docSide = unwrapField(rawDocSide);

      const computedConfidence = extractConfidenceFromRaw(result);
      const isDL = checkIsDriverLicense(
        docType ? docType.toUpperCase() : null,
        docName,
        result.data || {},
        computedConfidence
      );

      const enrichedRaw = {
        ...result,
        confidence: computedConfidence,
      };

      return {
        decision: result.decision || 'review',
        confidence: computedConfidence,
        documentType: docType ? docType.toUpperCase() : null,
        documentName: docName,
        documentNumber: docNumber,
        documentSide: docSide ? docSide.toUpperCase() : null,
        isValidDriverLicense: isDL,
        errorMessage: null,
        data: result.data || {},
        raw: enrichedRaw,
      };
    } catch (err: any) {
      console.error('ID Analyzer fetch error:', err);
      return {
        decision: 'error',
        confidence: null,
        documentType: null,
        documentName: null,
        documentNumber: null,
        documentSide: null,
        isValidDriverLicense: false,
        errorMessage: err.message || 'Network error while scanning ID',
        data: {},
        raw: { error: err.message, confidence: null },
      };
    } finally {
      setScanningLicense(false);
    }
  };

  const clearLicenseFields = () => {
    setLicenseNumber('');
    setLicenseExpiry('');
  };

  const resetSideState = (side: Side) => {
    if (side === 'front') {
      setLicenseFrontUri(null);
      setLicenseFrontBase64(null);
      setLicenseFrontUrl(null);
      setFrontVerified(false);
    } else {
      setLicenseBackUri(null);
      setLicenseBackBase64(null);
      setLicenseBackUrl(null);
      setBackVerified(false);
    }
  };

  const populateFieldsFromScan = (scan: ScanResult) => {
    if (!scan || !scan.isValidDriverLicense) return;

    const d = scan.data || {};
    const docNum = unwrapField(d.documentNumber || d.licenseNumber);
    const expiry = unwrapField(d.dateOfExpiry || d.expiryDate);

    if (docNum) {
      setLicenseNumber(docNum);
      setManualNumberEntryAllowed(false);
    } else {
      // Valid Driver's License detected, but OCR missed the number string
      setManualNumberEntryAllowed(true);
    }

    if (expiry) {
      let formatted = expiry;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
        const m = expiry.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (m) {
          const [, a, b, y] = m;
          formatted = `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
        }
      }
      setLicenseExpiry(formatted);
    }
  };

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
          mediaTypes: ['images'], allowsEditing: true, quality: 0.85,
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
          mediaTypes: ['images'], allowsEditing: true, quality: 0.85,
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

  /**
   * Validates the chosen image with ID Analyzer BEFORE accepting it or uploading to Supabase.
   * Rejects non-ID photos (cats, vehicles, random objects) and non-Driver's License IDs immediately.
   */
  const handlePickedImage = async (side: Side, uri: string) => {
    setUploadingSide(side);
    setScanAttempted(false);

    // Temporarily show preview while scanning
    if (side === 'front') {
      setLicenseFrontUri(uri);
      setLicenseFrontUrl(null);
      setFrontVerified(false);
    } else {
      setLicenseBackUri(uri);
      setLicenseBackUrl(null);
      setBackVerified(false);
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      // Read image as Base64 so we can scan it BEFORE uploading to Supabase storage
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (side === 'front') {
        // 1. Scan the FRONT image directly (or together with back if back is already verified)
        const scan = await runIdAnalyzerScan(
          base64,
          backVerified && licenseBackBase64 ? licenseBackBase64 : null
        );

        // Block random photos, animals, trucks, blurry images, or rejected scans
        if (!scan || scan.decision === 'error' || scan.decision === 'reject' || !scan.isValidDriverLicense) {
          resetSideState('front');
          clearLicenseFields();
          setManualNumberEntryAllowed(false);
          setLastScanResult(null);

          const detected = scan?.documentName || scan?.documentType;
          const rejectionMessage =
            detected && !scan?.isValidDriverLicense
              ? `We detected "${detected}". Only a valid Philippine Driver's License is accepted.`
              : "This photo is not recognized as a valid Philippine Driver's License. Random photos, objects, or blurry images are not accepted. Please upload a clear photo of the FRONT of your Driver's License.";

          Alert.alert('Invalid Front License Photo', rejectionMessage);
          return;
        }

        // Front is a valid Driver's License! Upload to Supabase
        const url = await uploadFileFromBase64(uri, base64, user.id, 'license_front');
        setLicenseFrontBase64(base64);
        setLicenseFrontUrl(url);
        setFrontVerified(true);
        setLastScanResult(scan);
        setScanAttempted(true);
        populateFieldsFromScan(scan);

        if (backVerified) {
          Alert.alert(
            'License Verified ✓',
            "Both front and back of your Driver's License have been verified. Please confirm the expiry date below."
          );
        }
      } else {
        // Scanning the BACK image:
        // Step A: First scan the back image on its own to make sure it isn't a random photo (e.g., truck/cat)
        const singleBackScan = await runIdAnalyzerScan(base64, null);
        const isBackAtLeastId = checkIsAtLeastIdDocument(singleBackScan?.raw, singleBackScan?.confidence ?? null);

        if (!singleBackScan || singleBackScan.decision === 'error' || singleBackScan.decision === 'reject' || !isBackAtLeastId) {
          resetSideState('back');
          Alert.alert(
            'Invalid Back License Photo',
            "This photo does not appear to be the back of a valid Driver's License. Random photos (such as vehicles, pets, or objects) and blurry images are strictly not accepted."
          );
          return;
        }

        // Make sure the user didn't upload a completely different type of ID for the back
        if (singleBackScan.documentType && singleBackScan.documentName) {
          const dt = singleBackScan.documentType.toUpperCase();
          const dn = singleBackScan.documentName.toLowerCase();
          const isOtherIdType =
            dt !== 'D' && dt !== 'DL' && dt !== 'DRIVER_LICENSE' && dt !== 'DRIVERS_LICENSE' &&
            !dn.includes('driver') && !dn.includes('driving');

          if (isOtherIdType) {
            resetSideState('back');
            Alert.alert(
              "Not a Driver's License",
              `We detected "${singleBackScan.documentName || singleBackScan.documentType}". Please upload the BACK of your Philippine Driver's License.`
            );
            return;
          }
        }

        // Prevent uploading the exact same front image as the back image
        const singleBackDocNum = unwrapField(singleBackScan.data?.documentNumber || singleBackScan.data?.licenseNumber);
        const singleBackHasPortrait = Boolean(unwrapField(singleBackScan.data?.face) || singleBackScan.raw?.face);
        if (licenseFrontBase64 && base64 === licenseFrontBase64) {
          resetSideState('back');
          Alert.alert(
            'Duplicate Photo',
            "You uploaded the exact same photo for both Front and Back. Please upload the actual BACK side of your Driver's License."
          );
          return;
        }

        // Step B: If front is already uploaded, run a combined Dual Scan to verify front + back match
        let finalScan = singleBackScan;
        if (frontVerified && licenseFrontBase64) {
          const dualScan = await runIdAnalyzerScan(licenseFrontBase64, base64);
          if (!dualScan || dualScan.decision === 'error' || dualScan.decision === 'reject' || !dualScan.isValidDriverLicense) {
            resetSideState('back');
            Alert.alert(
              'Back Photo Verification Failed',
              "The back photo could not be verified with the front of your Driver's License. Please upload a clear photo of the back of the same license."
            );
            return;
          }
          finalScan = dualScan;
        }

        // Back is verified! Upload to Supabase
        const url = await uploadFileFromBase64(uri, base64, user.id, 'license_back');
        setLicenseBackBase64(base64);
        setLicenseBackUrl(url);
        setBackVerified(true);

        if (frontVerified && finalScan.isValidDriverLicense) {
          setLastScanResult(finalScan);
          setScanAttempted(true);
          populateFieldsFromScan(finalScan);
          Alert.alert(
            'License Verified ✓',
            "Both front and back of your Driver's License have been verified. Please confirm the expiry date below."
          );
        }
      }
    } catch (error: any) {
      console.error('Upload/Scan error:', error);
      Alert.alert('Upload Error', error.message || 'Failed to verify and upload image');
      resetSideState(side);
    } finally {
      setUploadingSide(null);
    }
  };

  const handleTakeSelfie = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please grant camera permission to take your selfie.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        cameraType: ImagePicker.CameraType.front,
        allowsEditing: false,
        quality: 0.8,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const uri = result.assets[0].uri;
      setSelfieUri(uri);
      setSelfieUrl(null);
      setUploadingSelfie(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const url = await uploadFileFromBase64(uri, base64, user.id, 'live_selfie');
      setSelfieUrl(url);
    } catch (error: any) {
      console.error('Selfie error:', error);
      Alert.alert('Selfie Error', error?.message || 'Could not capture or upload your selfie. Please try again.');
      setSelfieUri(null);
      setSelfieUrl(null);
    } finally {
      setUploadingSelfie(false);
    }
  };

  const uploadFileFromBase64 = async (
    uri: string,
    base64: string,
    userId: string,
    prefix: string
  ): Promise<string> => {
    const rawExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileExt = ['jpg', 'jpeg', 'png'].includes(rawExt) ? rawExt : 'jpg';
    const contentType = `image/${fileExt}`;
    const fileName = `${userId}/${prefix}_${Date.now()}.${fileExt}`;

    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, bytes, { contentType, upsert: true });

    if (uploadError) throw new Error('Failed to upload file: ' + uploadError.message);

    const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(fileName);
    if (!urlData?.publicUrl) throw new Error('Failed to get public URL');
    return urlData.publicUrl;
  };

  const handleRegisterProvider = async () => {
    if (!licenseFrontUri || !licenseBackUri || !frontVerified || !backVerified) {
      Alert.alert(
        'Valid License Required',
        "Please upload clear, valid photos of both the FRONT and BACK of your Philippine Driver's License."
      );
      return;
    }
    if (!licenseFrontUrl || !licenseBackUrl) {
      Alert.alert('Please Wait', 'Your license images are still uploading. Please try again in a moment.');
      return;
    }
    if (!lastScanResult || !lastScanResult.isValidDriverLicense) {
      Alert.alert(
        "Invalid Driver's License",
        "Your uploaded photos could not be verified as a valid Philippine Driver's License. Please upload clear photos of your actual license."
      );
      return;
    }
    if (!licenseNumber.trim()) {
      Alert.alert('Required', "Please enter your Driver's License number.");
      return;
    }
    if (!licenseExpiry.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry)) {
      Alert.alert('Required', 'Please select a valid license expiry date.');
      return;
    }
    if (!selfieUri) {
      Alert.alert('Required', 'Please take a live selfie. It is used to confirm you match your license.');
      return;
    }
    if (!selfieUrl) {
      Alert.alert('Please Wait', 'Your selfie is still uploading. Please try again in a moment.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw new Error('Authentication error: ' + authError.message);
      if (!user) throw new Error('No user logged in');

      const resolvedIdType = resolveValidIdTypeFromScan(lastScanResult);
      const resolvedIdNumber = resolveValidIdNumberFromScan(lastScanResult, licenseNumber.trim());

      const resolvedConfidence =
        lastScanResult?.confidence ?? extractConfidenceFromRaw(lastScanResult?.raw);

      const resolvedRaw = lastScanResult?.raw
        ? {
            ...lastScanResult.raw,
            confidence_percentage: resolvedConfidence,
          }
        : null;

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
            id_photo: licenseFrontUrl,
            valid_id_type: resolvedIdType,
            valid_id_number: resolvedIdNumber,
            is_verified: false,
            is_active: true,
          })
          .select('user_id, first_name, last_name, email')
          .maybeSingle();

        if (createError) throw new Error('Failed to create user: ' + createError.message);
        userData = newUser;
      }
      if (!userData) throw new Error('Failed to get or create user');

      const { data: duplicateLicense, error: dupCheckError } = await supabase
        .from('provider_verifications')
        .select('verification_id, provider_id, verification_status')
        .eq('drivers_license_number', resolvedIdNumber)
        .maybeSingle();

      if (dupCheckError) {
        console.warn('Duplicate license check failed:', dupCheckError);
      } else if (duplicateLicense) {
        setLoading(false);
        Alert.alert(
          'License Already Registered',
          `This Driver's License number (${resolvedIdNumber}) is already registered to another provider account. If this is your license and you believe this is a mistake, please contact support.`,
          [{ text: 'OK' }],
        );
        return;
      }

      let { data: providerRole } = await supabase
        .from('roles').select('role_id, role_name').eq('role_name', 'Provider').maybeSingle();

      if (!providerRole) {
        const { data: newRole, error: createRoleError } = await supabase
          .from('roles').insert({ role_name: 'Provider' })
          .select('role_id, role_name').maybeSingle();
        if (createRoleError) throw new Error('Failed to create Provider role: ' + createRoleError.message);
        providerRole = newRole;
      }
      if (!providerRole) throw new Error('Failed to resolve Provider role');

      const { data: existingRole } = await supabase
        .from('user_roles').select('*')
        .eq('user_id', userData.user_id).eq('role_id', providerRole.role_id).maybeSingle();

      const { data: existingVerif } = await supabase
        .from('provider_verifications')
        .select('verification_id, verification_status')
        .eq('provider_id', userData.user_id).maybeSingle();

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

        Alert.alert('Already Registered', msg, [{ text: 'OK', onPress: () => navigation.goBack() }]);
        setLoading(false);
        return;
      }

      const { error: assignError } = await supabase
        .from('user_roles').insert({ user_id: userData.user_id, role_id: providerRole.role_id });
      if (assignError) throw new Error('Failed to assign role: ' + assignError.message);

      const { error: verifError } = await supabase
        .from('provider_verifications')
        .insert({
          provider_id: userData.user_id,
          drivers_license_number: resolvedIdNumber,
          license_expiry_date: licenseExpiry.trim(),
          selfie_photo: licenseFrontUrl,
          selfie_photo_back: licenseBackUrl,
          live_selfie_photo: selfieUrl,
          verification_status: 'Pending',
          id_analyzer_decision: lastScanResult?.decision || null,
          id_analyzer_confidence: resolvedConfidence,
          id_analyzer_raw: resolvedRaw,
        });

      if (verifError) {
        await supabase
          .from('user_roles').delete()
          .eq('user_id', userData.user_id).eq('role_id', providerRole.role_id);

        if (verifError.code === '23505') {
          console.warn('Duplicate license caught by DB constraint:', verifError.message);
          Alert.alert(
            'License Already Registered',
            `This Driver's License number (${resolvedIdNumber}) is already registered to another provider account. If this is your license and you believe this is a mistake, please contact support.`,
            [{ text: 'OK' }],
          );
          return;
        }

        console.error('Verification insert error:', verifError);
        throw new Error('Failed to submit verification: ' + verifError.message);
      }

      const { error: updateUserError } = await supabase
        .from('users')
        .update({
          id_photo: licenseFrontUrl,
          valid_id_type: resolvedIdType,
          valid_id_number: resolvedIdNumber,
        })
        .eq('user_id', userData.user_id);

      if (updateUserError) {
        console.warn('Failed to update user ID fields on public.users:', updateUserError.message);
      }

      await supabase.auth.updateUser({
        data: {
          role: 'Provider',
          provider_documents: {
            drivers_license_front: licenseFrontUrl,
            drivers_license_back: licenseBackUrl,
            license_number: resolvedIdNumber,
            valid_id_type: resolvedIdType,
            id_analyzer_confidence: resolvedConfidence,
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

      const isDuplicateLicense =
        error?.code === '23505' ||
        (typeof error?.message === 'string' &&
          error.message.includes('provider_verifications_license_unique'));

      if (isDuplicateLicense) {
        Alert.alert(
          'License Already Registered',
          `This Driver's License number (${licenseNumber.trim()}) is already registered to another provider account. If this is your license and you believe this is a mistake, please contact support.`,
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert('Registration Error', error.message || 'Failed to submit application. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const uploadingLicense = uploadingSide !== null;
  const licenseComplete =
    frontVerified &&
    backVerified &&
    !!licenseFrontUri &&
    !!licenseBackUri &&
    !!licenseFrontUrl &&
    !!licenseBackUrl &&
    !!lastScanResult?.isValidDriverLicense;

  const detailsFilled =
    licenseNumber.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(licenseExpiry.trim());
  const selfieComplete = !!selfieUri && !!selfieUrl;
  const canSubmit = licenseComplete && detailsFilled && selfieComplete;

  const numberLocked = !manualNumberEntryAllowed;

  const showWaitingHint =
    !licenseComplete && !scanningLicense && numberLocked;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      <Animated.View style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>Become a partner</Text>
          <Text style={styles.headerTitle}>Register as Provider</Text>
        </View>
      </Animated.View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.introCard, fadeUp(introAnim, 20)]}>
          <View style={styles.introIconBox}>
            <Ionicons name="shield-checkmark" size={22} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Apply to become a provider</Text>
            <Text style={styles.introText}>
              Upload clear front and back photos of your Philippine Driver's License. Each photo
              is automatically verified — non-ID photos or other ID types will be rejected.
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.progressRow, fadeUp(introAnim, 20)]}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, licenseComplete && styles.progressDotDone]}>
              {licenseComplete ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>1</Text>}
            </View>
            <Text style={[styles.progressLabel, licenseComplete && styles.progressLabelDone]}>License</Text>
          </View>
          <View style={[styles.progressLine, licenseComplete && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, detailsFilled && styles.progressDotDone]}>
              {detailsFilled ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>2</Text>}
            </View>
            <Text style={[styles.progressLabel, detailsFilled && styles.progressLabelDone]}>Details</Text>
          </View>
          <View style={[styles.progressLine, selfieComplete && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, selfieComplete && styles.progressDotDone]}>
              {selfieComplete ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>3</Text>}
            </View>
            <Text style={[styles.progressLabel, selfieComplete && styles.progressLabelDone]}>Selfie</Text>
          </View>
          <View style={[styles.progressLine, canSubmit && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, canSubmit && styles.progressDotDone]}>
              {canSubmit ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>4</Text>}
            </View>
            <Text style={[styles.progressLabel, canSubmit && styles.progressLabelDone]}>Ready</Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.uploadSection, fadeUp(licenseAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Driver's License Photos</Text>
                <Text style={styles.uploadSubtitle}>Upload front & back — verified automatically</Text>
              </View>
            </View>
            {licenseComplete && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                <Text style={styles.completedBadgeText}>Verified</Text>
              </View>
            )}
          </View>

          <View style={styles.tilesRow}>
            <TouchableOpacity
              style={[styles.tile, frontVerified && styles.tileFilled]}
              onPress={() => handlePickLicense('front')}
              disabled={uploadingLicense || scanningLicense}
              activeOpacity={0.85}
            >
              {licenseFrontUri ? (
                <>
                  <Image source={{ uri: licenseFrontUri }} style={styles.tileImage} />
                  <View style={styles.tileLabelBadge}>
                    <Text style={styles.tileLabelText}>
                      {frontVerified ? 'FRONT ✓' : 'VERIFYING...'}
                    </Text>
                  </View>
                  {uploadingSide === 'front' && (
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

            <TouchableOpacity
              style={[styles.tile, backVerified && styles.tileFilled]}
              onPress={() => handlePickLicense('back')}
              disabled={uploadingLicense || scanningLicense}
              activeOpacity={0.85}
            >
              {licenseBackUri ? (
                <>
                  <Image source={{ uri: licenseBackUri }} style={styles.tileImage} />
                  <View style={styles.tileLabelBadge}>
                    <Text style={styles.tileLabelText}>
                      {backVerified ? 'BACK ✓' : 'VERIFYING...'}
                    </Text>
                  </View>
                  {uploadingSide === 'back' && (
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
            Tip: use a flat surface and good lighting. Non-license photos will be rejected.
          </Text>

          {scanningLicense && (
            <View style={styles.scanningBadge}>
              <ActivityIndicator size="small" color={ORANGE} />
              <Text style={styles.scanningText}>Verifying Driver's License photo...</Text>
            </View>
          )}

          {!scanningLicense && lastScanResult && lastScanResult.isValidDriverLicense && (
            <View
              style={[
                styles.scanResultBadge,
                lastScanResult.decision === 'accept' ? styles.scanResultAccept : styles.scanResultReview,
              ]}
            >
              <Ionicons
                name={lastScanResult.decision === 'accept' ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={lastScanResult.decision === 'accept' ? colors.success : colors.warning}
              />
              <Text
                style={[
                  styles.scanResultText,
                  {
                    color: lastScanResult.decision === 'accept' ? colors.success : colors.warning,
                  },
                ]}
              >
                {lastScanResult.decision === 'accept'
                  ? `Driver's License verified${lastScanResult.confidence != null ? ` (${Math.round(lastScanResult.confidence)}%)` : ''}`
                  : `Driver's License scanned — subject to admin review${lastScanResult.confidence != null ? ` (${Math.round(lastScanResult.confidence)}%)` : ''}`}
              </Text>
            </View>
          )}
        </Animated.View>

        <Animated.View style={[styles.detailsSection, fadeUp(detailsAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>2</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>License Details</Text>
                <Text style={styles.uploadSubtitle}>
                  {numberLocked
                    ? scanningLicense
                      ? 'Scanning your license...'
                      : scanAttempted
                      ? 'License number auto-filled · pick expiry date'
                      : 'Upload valid license photos to auto-fill'
                    : 'Enter the license number printed on your ID'}
                </Text>
              </View>
              {numberLocked ? (
                <View style={styles.lockedBadge}>
                  <Ionicons name="lock-closed" size={10} color={colors.success} />
                  <Text style={styles.lockedBadgeText}>AUTO</Text>
                </View>
              ) : (
                <View style={styles.unlockedBadge}>
                  <Ionicons name="pencil" size={10} color={colors.warning} />
                  <Text style={styles.unlockedBadgeText}>MANUAL</Text>
                </View>
              )}
            </View>
          </View>

          {numberLocked && frontVerified && scanAttempted && !scanningLicense && (
            <View style={styles.lockedNote}>
              <Ionicons name="sparkles" size={14} color={colors.success} />
              <Text style={styles.lockedNoteText}>
                License number was auto-filled from your verified Driver's License. Please pick
                the correct expiry date below.
              </Text>
            </View>
          )}

          {showWaitingHint && (
            <View style={styles.waitingNote}>
              <Ionicons name="cloud-upload-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.waitingNoteText}>
                Upload clear photos of both the front and back of your Driver's License above to
                auto-fill your license number.
              </Text>
            </View>
          )}

          {!numberLocked && (
            <View style={styles.manualNote}>
              <Ionicons name="pencil-outline" size={14} color={colors.warning} />
              <Text style={styles.manualNoteText}>
                Your Driver's License was verified, but the number was unclear. Please type it
                manually below.
              </Text>
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Driver's License Number</Text>
            <TextInput
              style={[styles.textInput, numberLocked && styles.textInputLocked]}
              placeholder={numberLocked ? 'Auto-filled after valid scan...' : 'e.g. D06-11-009385'}
              placeholderTextColor={colors.textMuted}
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!numberLocked}
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
              <Text style={[styles.datePickerText, !licenseExpiry && styles.datePickerPlaceholder]}>
                {licenseExpiry || 'Select expiry date'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={styles.manualDateHint}>
              Always verify the expiry date manually — the scan may misread it.
            </Text>
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
            <TouchableOpacity style={styles.iosDoneButton} onPress={() => setShowDatePicker(false)} activeOpacity={0.85}>
              <Text style={styles.iosDoneText}>Done</Text>
            </TouchableOpacity>
          )}
        </Animated.View>

        <Animated.View style={[styles.uploadSection, fadeUp(licenseAnim, 20)]}>
          <View style={styles.uploadHeader}>
            <View style={styles.uploadTitleRow}>
              <View style={styles.uploadNumberBadge}>
                <Text style={styles.uploadNumberText}>3</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.uploadTitle}>Live Selfie</Text>
                <Text style={styles.uploadSubtitle}>Take a photo now, face clearly visible</Text>
              </View>
            </View>
            {selfieComplete && (
              <View style={styles.completedBadge}>
                <Ionicons name="checkmark-circle" size={12} color={colors.success} />
                <Text style={styles.completedBadgeText}>Uploaded</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.tile, styles.selfieTile, selfieUri && styles.tileFilled]}
            onPress={handleTakeSelfie}
            disabled={uploadingSelfie}
            activeOpacity={0.85}
          >
            {selfieUri ? (
              <>
                <Image source={{ uri: selfieUri }} style={styles.tileImage} />
                <View style={styles.tileLabelBadge}>
                  <Text style={styles.tileLabelText}>SELFIE · TAP TO RETAKE</Text>
                </View>
                {!selfieUrl && uploadingSelfie && (
                  <View style={styles.tileOverlay}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                )}
              </>
            ) : (
              <View style={styles.tileEmpty}>
                <Ionicons name="camera-outline" size={30} color={ORANGE} />
                <Text style={styles.tileEmptyText}>Take selfie</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.uploadHint}>
            Use good lighting, no filters, no sunglasses or mask. An admin compares it with your license.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.infoNote, fadeUp(buttonAnim, 20)]}>
          <Ionicons name="information-circle-outline" size={16} color={isDark ? '#93C5FD' : '#3B82F6'} />
          <Text style={styles.infoNoteText}>
            Your application will be reviewed by an admin. You'll be able to accept deliveries
            once approved.
          </Text>
        </Animated.View>

        <Animated.View style={[{ width: '100%' }, fadeUp(buttonAnim, 20), { transform: [{ scale: buttonScale }] }]}>
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

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    backgroundColor: ORANGE,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 26, gap: 12,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSubtitle: { fontSize: 11, color: '#FFE0C7', fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },

  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  introCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: c.card, borderRadius: 18, padding: 16, gap: 12, marginBottom: 20,
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.3 : 0.05, shadowRadius: 12, elevation: 2,
  },
  introIconBox: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  introTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginBottom: 3, letterSpacing: -0.2 },
  introText: { fontSize: 12, color: c.textSecondary, lineHeight: 17, fontWeight: '500' },

  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 26, paddingHorizontal: 10,
  },
  progressStep: { alignItems: 'center', gap: 6 },
  progressDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.border,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: c.card,
  },
  progressDotDone: { backgroundColor: c.success },
  progressDotText: { fontSize: 12, fontWeight: '800', color: c.textMuted },
  progressLabel: { fontSize: 10, fontWeight: '700', color: c.textMuted, letterSpacing: 0.3 },
  progressLabelDone: { color: c.success },
  progressLine: { flex: 1, height: 2, backgroundColor: c.border, marginHorizontal: 6, marginBottom: 20 },
  progressLineDone: { backgroundColor: c.success },

  uploadSection: { marginBottom: 20 },
  uploadHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  uploadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  uploadNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  uploadNumberText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  uploadTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  uploadSubtitle: { fontSize: 11, color: c.textMuted, fontWeight: '500', marginTop: 1 },
  completedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: c.success,
  },
  completedBadgeText: { fontSize: 10, fontWeight: '800', color: c.success, letterSpacing: 0.2 },

  tilesRow: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1, height: 140, borderRadius: 16,
    borderWidth: 2, borderStyle: 'dashed', borderColor: c.border,
    backgroundColor: c.background, overflow: 'hidden', position: 'relative',
  },
  selfieTile: { flex: 0, width: '100%', height: 200 },
  tileFilled: { borderStyle: 'solid', borderColor: ORANGE, backgroundColor: c.accentSoft },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileEmptyText: { fontSize: 12, fontWeight: '700', color: c.textSecondary, letterSpacing: 0.2 },
  tileImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  tileLabelBadge: {
    position: 'absolute', bottom: 8, left: 8,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  tileLabelText: { fontSize: 10, color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.5 },
  tileOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadHint: {
    fontSize: 11, color: c.textMuted, fontWeight: '500',
    marginTop: 10, letterSpacing: 0.2, textAlign: 'center',
  },

  scanningBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: c.accentSoft, borderRadius: 10,
    borderWidth: 1, borderColor: ORANGE,
  },
  scanningText: { fontSize: 12, fontWeight: '700', color: ORANGE, letterSpacing: 0.2 },
  scanResultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1,
  },
  scanResultAccept: { backgroundColor: c.successBg, borderColor: c.success },
  scanResultReview: { backgroundColor: c.warningBg, borderColor: c.warning },
  scanResultReject: { backgroundColor: c.errorBg, borderColor: c.error },
  scanResultError: { backgroundColor: c.divider, borderColor: c.border },
  scanResultText: { flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },

  detailsSection: { marginBottom: 20 },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: c.textPrimary, marginBottom: 6, letterSpacing: 0.2 },
  textInput: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textPrimary, fontWeight: '600',
  },
  textInputLocked: {
    backgroundColor: c.divider,
    color: c.textSecondary,
    borderColor: c.divider,
  },

  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: c.success,
  },
  lockedBadgeText: { fontSize: 9, fontWeight: '900', color: c.success, letterSpacing: 0.6 },
  unlockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.warningBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    borderWidth: 1, borderColor: c.warning,
  },
  unlockedBadgeText: { fontSize: 9, fontWeight: '900', color: c.warning, letterSpacing: 0.6 },

  lockedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.successBg, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.success,
  },
  lockedNoteText: { flex: 1, fontSize: 11, color: c.success, fontWeight: '600', lineHeight: 15 },

  waitingNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.divider, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.border,
  },
  waitingNoteText: { flex: 1, fontSize: 11, color: c.textSecondary, fontWeight: '600', lineHeight: 15 },

  manualNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.warningBg, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.warning,
  },
  manualNoteText: { flex: 1, fontSize: 11, color: c.warning, fontWeight: '600', lineHeight: 15 },

  datePickerButton: {
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  datePickerText: { flex: 1, fontSize: 14, color: c.textPrimary, fontWeight: '600' },
  datePickerPlaceholder: { color: c.textMuted, fontWeight: '500' },
  manualDateHint: {
    fontSize: 11, color: c.textMuted, fontWeight: '500', marginTop: 6,
    fontStyle: 'italic',
  },
  iosDoneButton: {
    marginTop: 8, alignSelf: 'flex-end',
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: ORANGE, borderRadius: 10,
  },
  iosDoneText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: isDark ? '#0F172A' : '#EFF6FF',
    borderRadius: 14, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: isDark ? '#1E3A5F' : '#DBEAFE',
  },
  infoNoteText: {
    flex: 1, fontSize: 11,
    color: isDark ? '#93C5FD' : '#1E40AF',
    fontWeight: '600', lineHeight: 16,
  },

  registerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, marginTop: 4, gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  registerButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  registerButtonText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.2 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});