// src/modules/Dashboard/Sender/EditProfileScreen.tsx
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), numbered upload-style
// section headers, primary button with press spring, staged fade-up entrance.
// The orange hero header + avatar overlap are kept because they are a hero,
// not a form section (RegisterProvider has no hero to copy).
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
  Animated, Easing, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const ORANGE = '#FA7A25';

export default function EditProfileScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [streetAddress, setStreetAddress] = useState('');
  const [unitInfo, setUnitInfo] = useState('');
  const [cityState, setCityState] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [locationId, setLocationId] = useState<number | null>(null);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGoogleLinked, setIsGoogleLinked] = useState(true);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const avatarAnim = useRef(new Animated.Value(0)).current;
  const profileAnim = useRef(new Animated.Value(0)).current;
  const addressAnim = useRef(new Animated.Value(0)).current;
  const linkedAnim = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([
      animate(headerAnim, 0),
      animate(avatarAnim, 150),
      animate(profileAnim, 300),
      animate(addressAnim, 450),
      animate(linkedAnim, 600),
    ]).start();
  }, [headerAnim, avatarAnim, profileAnim, addressAnim, linkedAnim]);

  const pressIn = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();

  useEffect(() => {
    const fetchUserData = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) {
        Alert.alert('Error', 'Could not load user data.');
      } else if (user) {
        setFirstName(user.user_metadata?.first_name || '');
        setLastName(user.user_metadata?.last_name || '');
        setPhone(user.user_metadata?.phone || '');
        setEmail(user.email || '');
        setImageUri(user.user_metadata?.avatar_url || null);

        const { data: userData } = await supabase
          .from('users')
          .select('location_id, locations (street_address, barangay, city, province, zip_code)')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (userData?.locations) {
          const loc: any = userData.locations;
          setStreetAddress(loc.street_address || '');
          setUnitInfo(loc.barangay !== 'Unknown' ? loc.barangay : '');
          setCityState(loc.city && loc.city !== 'Unknown' ? `${loc.city}, ${loc.province}` : '');
          setZipCode(loc.zip_code !== '0000' ? loc.zip_code : '');
          setLocationId(userData.location_id || null);
        }
      }
      setLoading(false);
    };
    fetchUserData();
  }, []);

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImageUri(result.assets[0].uri);
        setImageBase64(result.assets[0].base64 || null);
      }
    } catch { Alert.alert('Error', 'Could not pick an image.'); }
  };

  const geocodeAddress = async (fullAddress: string) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fullAddress)}&limit=1&countrycodes=ph`,
        { headers: { 'User-Agent': 'PackNShipMobileApp/1.0 (capstone.ctu@gmail.com)' } }
      );
      const data = await response.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    } catch (e) {
      console.warn('Geocode error', e);
    }
    return null;
  };

  const handleSaveProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Error', 'Please enter both first and last name.');
      return;
    }
    if (!streetAddress.trim() || !cityState.trim()) {
      Alert.alert('Error', 'Please enter at least a Street Address and City/State.');
      return;
    }

    setSaving(true);
    let finalAvatarUrl = imageUri;

    try {
      if (imageBase64) {
        const fileName = `${Date.now()}_${firstName.toLowerCase()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, decode(imageBase64), { contentType: 'image/jpeg', upsert: true });
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(fileName);
        finalAvatarUrl = publicUrl;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        data: { first_name: firstName, last_name: lastName, phone, avatar_url: finalAvatarUrl },
      });
      if (updateError) throw updateError;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: tableError } = await supabase
          .from('users')
          .update({ first_name: firstName, last_name: lastName, profile_photo: finalAvatarUrl })
          .eq('auth_id', user.id);

        if (tableError) console.warn('Could not update users table:', tableError);

        const fullTextAddress = `${streetAddress}${unitInfo ? ', ' + unitInfo : ''}, ${cityState} ${zipCode}`;
        const coords = await geocodeAddress(fullTextAddress);

        const finalLat = coords?.lat || 10.3157;
        const finalLng = coords?.lng || 123.8854;

        const cityParts = cityState.split(',');
        const finalCity = cityParts[0]?.trim() || 'Unknown';
        const finalProvince = cityParts[1]?.trim() || 'Unknown';

        if (locationId) {
          await supabase.from('locations').update({
            street_address: streetAddress,
            barangay: unitInfo || 'Unknown',
            city: finalCity,
            province: finalProvince,
            zip_code: zipCode || '0000',
            latitude: finalLat,
            longitude: finalLng,
          }).eq('location_id', locationId);
        } else {
          const { data: newLoc } = await supabase.from('locations').insert({
            street_address: streetAddress,
            barangay: unitInfo || 'Unknown',
            city: finalCity,
            province: finalProvince,
            zip_code: zipCode || '0000',
            latitude: finalLat,
            longitude: finalLng,
          }).select('location_id').single();

          if (newLoc) {
            await supabase.from('users').update({ location_id: newLoc.location_id }).eq('auth_id', user.id);
          }
        }
      }

      Alert.alert('Success', 'Your profile has been updated!');
      navigation.goBack();
    } catch (error: any) {
      Alert.alert('Update Error', error.message || 'Could not save profile changes.');
    } finally { setSaving(false); }
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        <ActivityIndicator size="large" color={ORANGE} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      <Animated.View style={[styles.header, { paddingTop: insets.top + 16 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={{ width: 42 }} />
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* Avatar */}
          <Animated.View style={[styles.avatarSection, fadeUp(avatarAnim, 20)]}>
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.85}>
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

          {/* Section 1: Personal details */}
          <Animated.View style={fadeUp(profileAnim, 20)}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumberBadge}>
                  <Text style={styles.sectionNumberText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Personal details</Text>
                  <Text style={styles.sectionSubtitle}>Name, contact and email</Text>
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.label}>First Name</Text>
                  <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputWrapperFocused]}>
                    <TextInput
                      style={styles.input} value={firstName} onChangeText={setFirstName}
                      placeholderTextColor={colors.textMuted} placeholder="Juan"
                      onFocus={() => setFocusedInput('firstName')} onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>

                <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                  <Text style={styles.label}>Last Name</Text>
                  <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputWrapperFocused]}>
                    <TextInput
                      style={styles.input} value={lastName} onChangeText={setLastName}
                      placeholderTextColor={colors.textMuted} placeholder="Dela Cruz"
                      onFocus={() => setFocusedInput('lastName')} onBlur={() => setFocusedInput(null)}
                    />
                  </View>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Mobile Number</Text>
                <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputWrapperFocused]}>
                  <TextInput
                    style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                    placeholderTextColor={colors.textMuted} placeholder="09123456789"
                    onFocus={() => setFocusedInput('phone')} onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, { marginBottom: 0 }]}>
                <Text style={styles.label}>Email Address</Text>
                <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                  <TextInput
                    style={[styles.input, { color: colors.textMuted }]}
                    value={email} editable={false}
                    placeholderTextColor={colors.textMuted}
                  />
                  <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} style={{ marginRight: 14 }} />
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Section 2: Home address */}
          <Animated.View style={fadeUp(addressAnim, 20)}>
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumberBadge}>
                  <Text style={styles.sectionNumberText}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Home address</Text>
                  <Text style={styles.sectionSubtitle}>Where you receive deliveries</Text>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Building No. & Street (Line 1)</Text>
                <View style={[styles.inputWrapper, focusedInput === 'street' && styles.inputWrapperFocused]}>
                  <TextInput
                    style={styles.input} value={streetAddress} onChangeText={setStreetAddress}
                    placeholder="e.g., Bldg 12, 123 Main St." placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedInput('street')} onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Unit / Floor / Apt (Line 2)</Text>
                <View style={[styles.inputWrapper, focusedInput === 'unit' && styles.inputWrapperFocused]}>
                  <TextInput
                    style={styles.input} value={unitInfo} onChangeText={setUnitInfo}
                    placeholder="e.g., Apt 4B, 3rd Floor (Optional)" placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedInput('unit')} onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>City and Province</Text>
                <View style={[styles.inputWrapper, focusedInput === 'city' && styles.inputWrapperFocused]}>
                  <TextInput
                    style={styles.input} value={cityState} onChangeText={setCityState}
                    placeholder="e.g., Cebu City, Cebu" placeholderTextColor={colors.textMuted}
                    onFocus={() => setFocusedInput('city')} onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, { marginBottom: 0 }]}>
                <Text style={styles.label}>Postal Code</Text>
                <View style={[styles.inputWrapper, focusedInput === 'zip' && styles.inputWrapperFocused]}>
                  <TextInput
                    style={styles.input} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad"
                    placeholder="e.g., 6000" placeholderTextColor={colors.textMuted} maxLength={4}
                    onFocus={() => setFocusedInput('zip')} onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Save — registerButton spec */}
          <Animated.View style={[fadeUp(addressAnim, 20), { transform: [{ scale: btnScale }] }]}>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSaveProfile}
              onPressIn={pressIn} onPressOut={pressOut}
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

          {/* Section 3: Linked accounts */}
          <Animated.View style={fadeUp(linkedAnim, 20)}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionNumberBadge}>
                <Text style={styles.sectionNumberText}>3</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Linked accounts</Text>
                <Text style={styles.sectionSubtitle}>Connected sign-in providers</Text>
              </View>
            </View>
            <View style={styles.linkedCard}>
              <View style={styles.linkedRow}>
                <View style={styles.linkedLeft}>
                  <View style={styles.googleIconWrapper}>
                    <Image source={require('../../../../assets/google.png')} style={styles.googleIcon} />
                  </View>
                  <View>
                    <Text style={styles.linkedText}>Google</Text>
                    <Text style={styles.linkedSubtext}>{isGoogleLinked ? 'Connected' : 'Not connected'}</Text>
                  </View>
                </View>
                <Switch
                  trackColor={{ false: colors.border, true: colors.success }}
                  thumbColor={'#FFFFFF'}
                  ios_backgroundColor={colors.border}
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

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background, gap: 12 },
  loadingText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },

  // Orange hero header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: ORANGE, paddingHorizontal: 20, paddingBottom: 26,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6, zIndex: 10,
  },
  backButton: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerTitle: { fontSize: 19, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.2 },

  scrollContent: { paddingBottom: 60, paddingTop: 10, paddingHorizontal: 20, gap: 16 },
  bottomSpacer: { height: 40 },

  // Avatar overlaps the header bottom edge
  avatarSection: { alignItems: 'center', marginTop: -42, marginBottom: 8, zIndex: 5 },
  imagePicker: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: c.card, shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 6, overflow: 'visible',
  },
  profilePreview: { width: 102, height: 102, borderRadius: 51 },
  imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2, width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.textPrimary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: c.card,
  },
  uploadHint: { marginTop: 12, fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary },

  // Section card — RegisterProvider uploadSection shell
  sectionCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  sectionNumberText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  sectionTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },

  row: { flexDirection: 'row', justifyContent: 'space-between' },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, marginBottom: 6, letterSpacing: 0.2 },

  // textInput — RegisterProvider tokens (radius 14, hairline, no shadow)
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.background,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
  },
  inputWrapperFocused: { borderColor: c.accent },
  inputWrapperDisabled: { backgroundColor: c.divider },
  input: { flex: 1, fontSize: 14, fontFamily: 'Poppins_500Medium', color: c.textPrimary, padding: 0 },

  // registerButton spec
  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent,
    paddingVertical: 16, borderRadius: 14, gap: 8,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  saveButtonDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  saveButtonText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 15, letterSpacing: 0.2 },
  savingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // Linked accounts card — hairline shell, no shadow
  linkedCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  linkedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkedLeft: { flexDirection: 'row', alignItems: 'center' },
  googleIconWrapper: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  googleIcon: { width: 22, height: 22, resizeMode: 'contain' },
  linkedText: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  linkedSubtext: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
});