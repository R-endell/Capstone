import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
  Animated, Easing, Modal
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

import { brand } from '../../../constants';
const ORANGE = brand.orangeDark;

export default function EditProfileScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  
  // Location State
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locationId, setLocationId] = useState<number | null>(null);

  // Map Modal State
  const [isMapVisible, setIsMapVisible] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [mapCenter, setMapCenter] = useState({ lat: 10.3157, lng: 123.8854 });
  const mapWebViewRef = useRef<WebView>(null);

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isGoogleLinked, setIsGoogleLinked] = useState(true);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const avatarAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  const linkedAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([
      animate(headerAnim, 0), animate(avatarAnim, 150),
      animate(formAnim, 300), animate(linkedAnim, 450),
    ]).start();
  }, [headerAnim, avatarAnim, formAnim, linkedAnim]);

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

        // Fetch Location Details
        const { data: userData } = await supabase
          .from('users')
          .select('location_id, locations (street_address, latitude, longitude)')
          .eq('auth_id', user.id)
          .maybeSingle();

        if (userData?.locations) {
          const loc: any = userData.locations;
          setAddress(loc.street_address || '');
          setLat(loc.latitude || null);
          setLng(loc.longitude || null);
          setLocationId(userData.location_id || null);
          setMapCenter({ 
            lat: loc.latitude || 10.3157, 
            lng: loc.longitude || 123.8854 
          });
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

  // --- MAP LOGIC ---
  const handleMapMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MOVE_END' && data.latitude && data.longitude) {
        setMapCenter({ lat: data.latitude, lng: data.longitude });
      }
    } catch (error) {
      console.warn('Map message error:', error);
    }
  };

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
      if (mapWebViewRef.current) {
        mapWebViewRef.current.injectJavaScript(`
          if (window.map) {
            window.map.setView([${newCoords.lat}, ${newCoords.lng}], 16);
          }
          true;
        `);
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
        
        // 1. Build a nice street address
        const streetParts = [a.house_number, a.road].filter(Boolean);
        street = streetParts.length > 0 ? streetParts.join(' ') : (json.display_name ? json.display_name.split(',')[0] : 'Selected Location');
        
        // 2. Extract City/Municipality
        city = a.city || a.town || a.municipality || a.suburb || 'Unknown City';
        
        // 3. Extract Barangay (Try suburb, neighbourhood, village, or quarter)
        barangay = a.suburb || a.neighbourhood || a.village || a.quarter || 'Unknown';
        
        // 4. Extract Province (Try state, state_district, or county)
        province = a.state || a.state_district || a.county || a.province || a.region || 'Unknown';
        
        // 5. Extract Zip Code
        zipCode = (a.postcode && a.postcode.length === 4) ? a.postcode : '0000';
      }

      setAddress(`${street}, ${city}`);
      setLat(mapCenter.lat);
      setLng(mapCenter.lng);
      
      // Update the structured address
      setStructuredAddress({
        barangay,
        city,
        province,
        zip_code: zipCode,
      });
      
      setIsMapVisible(false);
    } catch (err) {
      Alert.alert('Error', 'Could not get the address for this location.');
    } finally {
      setIsGeocoding(false);
    }
  };

  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { height: 100vh; width: 100vw; background: #E5E7EB; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false }).setView([${mapCenter.lat}, ${mapCenter.lng}], 16);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

          window.map.on('moveend', function() {
            var center = window.map.getCenter();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'MOVE_END',
              latitude: center.lat,
              longitude: center.lng
            }));
          });
        </script>
      </body>
    </html>
  `;

  const handleSaveProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) { 
      Alert.alert('Error', 'Please enter both first and last name.'); 
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
        // Update users table
        const { error: tableError } = await supabase
          .from('users')
          .update({ first_name: firstName, last_name: lastName, profile_photo: finalAvatarUrl })
          .eq('auth_id', user.id);
        
        if (tableError) console.warn('Could not update users table:', tableError);

        // Update or Insert Location
        if (address && lat && lng) {
          if (locationId) {
            await supabase.from('locations').update({
              street_address: address, latitude: lat, longitude: lng
            }).eq('location_id', locationId);
          } else {
            const { data: newLoc } = await supabase.from('locations').insert({
              street_address: address, latitude: lat, longitude: lng,
              barangay: 'Unknown', city: 'Unknown', province: 'Unknown', zip_code: '0000'
            }).select('location_id').single();
            
            if (newLoc) {
              await supabase.from('users').update({ location_id: newLoc.location_id }).eq('auth_id', user.id);
            }
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
          
          {/* Avatar Section */}
          <Animated.View style={[styles.imageUploadSection, fadeUp(avatarAnim, 20)]}>
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

          <Animated.View style={[styles.formContainer, fadeUp(formAnim, 20)]}>
            
            {/* First Name & Last Name Row */}
            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                <Text style={styles.label}>First Name</Text>
                <View style={[styles.inputWrapper, focusedInput === 'firstName' && styles.inputWrapperFocused]}>
                  <Ionicons name="person-outline" size={18} color={focusedInput === 'firstName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholderTextColor={colors.textMuted}
                    placeholder="Juan"
                    onFocus={() => setFocusedInput('firstName')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, { flex: 1, marginLeft: 8 }]}>
                <Text style={styles.label}>Last Name</Text>
                <View style={[styles.inputWrapper, focusedInput === 'lastName' && styles.inputWrapperFocused]}>
                  <Ionicons name="person-outline" size={18} color={focusedInput === 'lastName' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholderTextColor={colors.textMuted}
                    placeholder="Dela Cruz"
                    onFocus={() => setFocusedInput('lastName')}
                    onBlur={() => setFocusedInput(null)}
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <View style={[styles.inputWrapper, focusedInput === 'phone' && styles.inputWrapperFocused]}>
                <Ionicons name="call-outline" size={18} color={focusedInput === 'phone' ? ORANGE : colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  placeholderTextColor={colors.textMuted}
                  placeholder="09123456789"
                  onFocus={() => setFocusedInput('phone')}
                  onBlur={() => setFocusedInput(null)}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <View style={[styles.inputWrapper, styles.inputWrapperDisabled]}>
                <Ionicons name="mail-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.textMuted }]}
                  value={email}
                  editable={false}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor={colors.textMuted}
                  placeholder="you@example.com"
                />
                <Ionicons name="lock-closed-outline" size={14} color={colors.textMuted} style={{ marginRight: 14 }} />
              </View>
              <Text style={styles.helperText}>Email cannot be changed</Text>
            </View>

            {/* Home Address Dropdown */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Home Address</Text>
              <TouchableOpacity 
                style={[styles.inputWrapper, { justifyContent: 'space-between' }]} 
                onPress={() => setIsMapVisible(true)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                  <Ionicons name="home-outline" size={18} color={ORANGE} style={styles.inputIcon} />
                  <Text style={[styles.input, { color: address ? colors.textPrimary : colors.textMuted }]} numberOfLines={1}>
                    {address || 'Select Home Address on Map'}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={18} color={colors.textSecondary} style={{ marginRight: 14 }} />
              </TouchableOpacity>
            </View>

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

          <Animated.View style={[styles.linkedAccountsSection, fadeUp(linkedAnim, 20)]}>
            <Text style={styles.sectionTitle}>Linked Accounts</Text>

            <View style={styles.linkedCard}>
              <View style={styles.linkedRow}>
                <View style={styles.linkedLeft}>
                  <View style={styles.googleIconWrapper}>
                    <Image
                      source={require('../../../../assets/google.png')}
                      style={styles.googleIcon}
                    />
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

      {/* MAP MODAL */}
      <Modal visible={isMapVisible} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <WebView
            ref={mapWebViewRef}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            style={{ flex: 1, backgroundColor: 'transparent' }}
            onMessage={handleMapMessage}
            androidLayerType="hardware"
            overScrollMode="never"
            bounces={false}
            javaScriptEnabled
            domStorageEnabled
            useWebKit
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
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.background, gap: 12 },
  loadingText: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: ORANGE, paddingHorizontal: 20, paddingBottom: 26,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
    zIndex: 10, 
  },
  backButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },

  // Adjusted spacing to prevent overlapping with header
  scrollContent: { paddingBottom: 60, paddingTop: 10 },
  bottomSpacer: { height: 40 },

  imageUploadSection: { alignItems: 'center', marginTop: -42, marginBottom: 24, zIndex: 5 },
  imagePicker: {
    width: 110, height: 110, borderRadius: 55, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: c.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18, shadowRadius: 12, elevation: 6, overflow: 'visible',
  },
  profilePreview: { width: 102, height: 102, borderRadius: 51 },
  imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  cameraBadge: {
    position: 'absolute', bottom: 2, right: 2, width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.textPrimary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 3, borderColor: c.card,
  },
  uploadHint: { marginTop: 12, fontSize: 12, color: c.textSecondary, fontWeight: '500' },

  formContainer: { paddingHorizontal: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 13, color: c.textPrimary, fontWeight: '700', marginBottom: 8, letterSpacing: 0.2 },
  
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.03 : 0.25, shadowRadius: 4, elevation: 1,
    paddingVertical: 14, paddingHorizontal: 12,
  },
  inputWrapperFocused: {
    borderColor: ORANGE, shadowColor: ORANGE, shadowOpacity: 0.12, shadowRadius: 8, elevation: 2,
  },
  inputWrapperDisabled: { backgroundColor: c.divider },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 14, color: c.textPrimary, fontWeight: '500', padding: 0 },
  helperText: { fontSize: 11, color: c.textMuted, marginTop: 6, marginLeft: 4, fontWeight: '500' },

  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16,
    marginTop: 8, marginBottom: 8, gap: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  saveButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, letterSpacing: 0.2 },
  savingContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  linkedAccountsSection: { paddingHorizontal: 24, marginTop: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 12, letterSpacing: -0.2 },
  linkedCard: {
    backgroundColor: c.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.04 : 0.25, shadowRadius: 10, elevation: 2,
  },
  linkedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkedLeft: { flexDirection: 'row', alignItems: 'center' },
  googleIconWrapper: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
    borderWidth: 1, borderColor: c.divider,
  },
  googleIcon: { width: 22, height: 22, resizeMode: 'contain' },
  linkedText: { fontSize: 14, color: c.textPrimary, fontWeight: '700' },
  linkedSubtext: { fontSize: 11, color: c.textSecondary, marginTop: 2, fontWeight: '500' },

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