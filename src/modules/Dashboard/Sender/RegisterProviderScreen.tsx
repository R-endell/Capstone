// src/modules/Dashboard/Sender/RegisterProviderScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image, Alert,
  StatusBar, ActivityIndicator, Animated, Easing, TextInput, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

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

    const hasMeaningfulFields = Boolean(
      unwrapField(dataObj?.documentNumber) ||
      unwrapField(dataObj?.licenseNumber) ||
      unwrapField(dataObj?.firstName) ||
      unwrapField(dataObj?.lastName) ||
      unwrapField(dataObj?.fullName) ||
      unwrapField(dataObj?.dateOfBirth)
    );

    if (!hasMeaningfulFields) return false;

    if (confidence !== null && confidence < MIN_CONFIDENCE_PERCENT) {
      return false;
    }

    return true;
  };

  const checkIsAtLeastIdDocument = (result: any, confidence: number | null): boolean => {
    if (!result || result.error) return false;
    const dataObj = result.data || {};
    const fieldKeys = Object.keys(dataObj);

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
    const title = side === 'front' ? "Front of Driver's License" : "Back of Driver's License (Optional)";
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

  const handlePickedImage = async (side: Side, uri: string) => {
    setUploadingSide(side);
    setScanAttempted(false);

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

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (side === 'front') {
        const scan = await runIdAnalyzerScan(
          base64,
          backVerified && licenseBackBase64 ? licenseBackBase64 : null
        );

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
            "Front of your Driver's License is verified. Since the front is valid, the back is optional."
          );
        }
      } else {
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

        if (licenseFrontBase64 && base64 === licenseFrontBase64) {
          resetSideState('back');
          Alert.alert(
            'Duplicate Photo',
            "You uploaded the exact same photo for both Front and Back. Please upload the actual BACK side of your Driver's License."
          );
          return;
        }

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
    // We only strictly require the FRONT photo to be valid. Back is optional.
    if (!licenseFrontUri || !frontVerified) {
      Alert.alert(
        'Valid License Required',
        "Please upload a clear, valid photo of the FRONT of your Philippine Driver's License."
      );
      return;
    }
    if (!licenseFrontUrl) {
      Alert.alert('Please Wait', 'Your license image is still uploading. Please try again in a moment.');
      return;
    }
    if (!lastScanResult || !lastScanResult.isValidDriverLicense) {
      Alert.alert(
        "Invalid Driver's License",
        "Your uploaded photo could not be verified as a valid Philippine Driver's License. Please upload a clear photo of your actual license."
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
          selfie_photo_back: licenseBackUrl || null, // Optional
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
            drivers_license_back: licenseBackUrl || null,
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
  
  // Back is no longer required if the front is verified.
  const licenseComplete =
    frontVerified &&
    !!licenseFrontUri &&
    !!licenseFrontUrl &&
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
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />

      <Animated.View style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>Become a partner</Text>
          <Text style={styles.headerTitle}>Register as Provider</Text>
        </View>
      </Animated.View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={[styles.introCard, fadeUp(introAnim, 20)]}>
          <View style={styles.introIconBox}>
            <SolarIcon name="ShieldCheck" variant="duotone" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Apply to become a provider</Text>
            <Text style={styles.introText}>
              Upload a clear photo of the FRONT of your Philippine Driver's License. Each photo
              is automatically verified — non-ID photos or other ID types will be rejected. The Back photo is optional.
            </Text>
          </View>
        </Animated.View>

        <Animated.View style={[styles.progressRow, fadeUp(introAnim, 20)]}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, licenseComplete && styles.progressDotDone]}>
              {licenseComplete ? <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>1</Text>}
            </View>
            <Text style={[styles.progressLabel, licenseComplete && styles.progressLabelDone]}>License</Text>
          </View>
          <View style={[styles.progressLine, licenseComplete && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, detailsFilled && styles.progressDotDone]}>
              {detailsFilled ? <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>2</Text>}
            </View>
            <Text style={[styles.progressLabel, detailsFilled && styles.progressLabelDone]}>Details</Text>
          </View>
          <View style={[styles.progressLine, selfieComplete && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, selfieComplete && styles.progressDotDone]}>
              {selfieComplete ? <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>3</Text>}
            </View>
            <Text style={[styles.progressLabel, selfieComplete && styles.progressLabelDone]}>Selfie</Text>
          </View>
          <View style={[styles.progressLine, canSubmit && styles.progressLineDone]} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, canSubmit && styles.progressDotDone]}>
              {canSubmit ? <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" /> : <Text style={styles.progressDotText}>4</Text>}
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
                <Text style={styles.uploadSubtitle}>Upload Front (Back is optional)</Text>
              </View>
            </View>
            {licenseComplete && (
              <View style={styles.completedBadge}>
                <SolarIcon name="CheckCircle" variant="duotone" size={12} color={colors.success} />
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
                  <SolarIcon name="DocumentText" variant="linear" size={26} color={colors.accent} />
                  <Text style={styles.tileEmptyText}>Front (Required)</Text>
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
                  <SolarIcon name="DocumentText" variant="linear" size={26} color={colors.accent} />
                  <Text style={styles.tileEmptyText}>Back (Optional)</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.uploadHint}>
            Tip: use a flat surface and good lighting. Non-license photos will be rejected.
          </Text>

          {scanningLicense && (
            <View style={styles.scanningBadge}>
              <ActivityIndicator size="small" color={colors.accent} />
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
              <SolarIcon
                name={lastScanResult.decision === 'accept' ? 'CheckCircle' : 'DangerCircle'}
                variant="duotone"
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
                  <SolarIcon name="Lock" variant="linear" size={10} color={colors.success} />
                  <Text style={styles.lockedBadgeText}>AUTO</Text>
                </View>
              ) : (
                <View style={styles.unlockedBadge}>
                  <SolarIcon name="Pen" variant="linear" size={10} color={colors.warning} />
                  <Text style={styles.unlockedBadgeText}>MANUAL</Text>
                </View>
              )}
            </View>
          </View>

          {numberLocked && frontVerified && scanAttempted && !scanningLicense && (
            <View style={styles.lockedNote}>
              <SolarIcon name="Star" variant="duotone" size={14} color={colors.success} />
              <Text style={styles.lockedNoteText}>
                License number was auto-filled from your verified Driver's License. Please pick
                the correct expiry date below.
              </Text>
            </View>
          )}

          {showWaitingHint && (
            <View style={styles.waitingNote}>
              <SolarIcon name="CloudUpload" variant="linear" size={14} color={colors.textSecondary} />
              <Text style={styles.waitingNoteText}>
                Upload a clear photo of the FRONT of your Driver's License above to auto-fill your license number.
              </Text>
            </View>
          )}

          {!numberLocked && (
            <View style={styles.manualNote}>
              <SolarIcon name="Pen" variant="linear" size={14} color={colors.warning} />
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
              <SolarIcon name="Calendar" variant="linear" size={18} color={colors.accent} />
              <Text style={[styles.datePickerText, !licenseExpiry && styles.datePickerPlaceholder]}>
                {licenseExpiry || 'Select expiry date'}
              </Text>
              <SolarIcon name="AltArrowDown" variant="linear" size={18} color={colors.textMuted} />
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
                <SolarIcon name="CheckCircle" variant="duotone" size={12} color={colors.success} />
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
                <SolarIcon name="Camera" variant="linear" size={30} color={colors.accent} />
                <Text style={styles.tileEmptyText}>Take selfie</Text>
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.uploadHint}>
            Use good lighting, no filters, no sunglasses or mask. An admin compares it with your license.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.infoNote, fadeUp(buttonAnim, 20)]}>
          <SolarIcon name="InfoCircle" variant="linear" size={16} color={colors.info} />
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
                <SolarIcon name="ShieldCheck" variant="linear" size={18} color="#FFFFFF" />
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
    backgroundColor: c.accent,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 26, gap: 12,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.8)', fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.2 },

  content: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  introCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: c.card, borderRadius: 12, padding: 16, gap: 12, marginBottom: 20,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 12, elevation: 0,
  },
  introIconBox: {
    width: 46, height: 46, borderRadius: 12, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
  },
  introTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 3, letterSpacing: -0.2 },
  introText: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 17 },

  progressRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 26, paddingHorizontal: 10,
  },
  progressStep: { alignItems: 'center', gap: 6 },
  progressDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: c.card,
  },
  progressDotDone: { backgroundColor: c.success },
  progressDotText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted },
  progressLabel: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: c.textMuted, letterSpacing: 0.3 },
  progressLabelDone: { color: c.success },
  progressLine: { flex: 1, height: 2, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginHorizontal: 6, marginBottom: 20 },
  progressLineDone: { backgroundColor: c.success },

  uploadSection: { marginBottom: 20 },
  uploadHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10,
  },
  uploadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  uploadNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  uploadNumberText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  uploadTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  uploadSubtitle: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },
  completedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: c.success,
  },
  completedBadgeText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.success, letterSpacing: 0.2 },

  tilesRow: { flexDirection: 'row', gap: 12 },
  tile: {
    flex: 1, height: 140, borderRadius: 12,
    borderWidth: 2, borderStyle: 'dashed', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    backgroundColor: c.background, overflow: 'hidden', position: 'relative',
  },
  selfieTile: { flex: 0, width: '100%', height: 200 },
  tileFilled: { borderStyle: 'solid', borderColor: c.accent, backgroundColor: c.accentSoft },
  tileEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tileEmptyText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary, letterSpacing: 0.2 },
  tileImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  tileLabelBadge: {
    position: 'absolute', bottom: 8, left: 8,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  tileLabelText: { fontSize: 10, color: '#FFFFFF', fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.5 },
  tileOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadHint: {
    fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted,
    marginTop: 10, letterSpacing: 0.2, textAlign: 'center',
  },

  scanningBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: c.accentSoft, borderRadius: 8,
    borderWidth: 1, borderColor: c.accent,
  },
  scanningText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.accent, letterSpacing: 0.2 },
  scanResultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
  },
  scanResultAccept: { backgroundColor: c.successBg, borderColor: c.success },
  scanResultReview: { backgroundColor: c.warningBg, borderColor: c.warning },
  scanResultReject: { backgroundColor: c.errorBg, borderColor: c.error },
  scanResultError: { backgroundColor: c.divider, borderColor: c.border },
  scanResultText: { flex: 1, fontSize: 12, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.2 },

  detailsSection: { marginBottom: 20 },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 6, letterSpacing: 0.2 },
  textInput: {
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.textPrimary, fontFamily: 'Poppins_500Medium',
  },
  textInputLocked: {
    backgroundColor: c.divider,
    color: c.textSecondary,
    borderColor: c.divider,
  },

  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.successBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: c.success,
  },
  lockedBadgeText: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: c.success, letterSpacing: 0.6 },
  unlockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.warningBg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: c.warning,
  },
  unlockedBadgeText: { fontSize: 9, fontFamily: 'Poppins_800ExtraBold', color: c.warning, letterSpacing: 0.6 },

  lockedNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.successBg, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.success,
  },
  lockedNoteText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.success, lineHeight: 15 },

  waitingNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.divider, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  waitingNoteText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textSecondary, lineHeight: 15 },

  manualNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.warningBg, borderRadius: 12, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.warning,
  },
  manualNoteText: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.warning, lineHeight: 15 },

  datePickerButton: {
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  datePickerText: { flex: 1, fontSize: 14, fontFamily: 'Poppins_500Medium', color: c.textPrimary },
  datePickerPlaceholder: { color: c.textMuted },
  manualDateHint: {
    fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 6,
    fontStyle: 'italic',
  },
  iosDoneButton: {
    marginTop: 8, alignSelf: 'flex-end',
    paddingVertical: 8, paddingHorizontal: 16,
    backgroundColor: c.accent, borderRadius: 10,
  },
  iosDoneText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 13 },

  infoNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: c.infoSoft,
    borderRadius: 12, padding: 12, marginBottom: 20,
    borderWidth: 1, borderColor: isDark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(59, 130, 246, 0.2)',
  },
  infoNoteText: {
    flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium',
    color: c.info,
    lineHeight: 16,
  },

  registerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14, marginTop: 4, gap: 8,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  registerButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  registerButtonText: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: 0.2 },
  loadingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});