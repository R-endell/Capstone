import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, Image,
  KeyboardAvoidingView, Platform, ActivityIndicator, Switch, StatusBar
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

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

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      Alert.alert("Error", "Could not pick an image.");
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
            upsert: true 
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
        }
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F27024" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          
          <View style={styles.imageUploadSection}>
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage} activeOpacity={0.8}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.profilePreview} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="person" size={50} color="#D1D5DB" />
                </View>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Name</Text>
              <TextInput 
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholderTextColor="#9CA3AF"
                placeholder="Jonel Jumao-as"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Mobile Number</Text>
              <TextInput 
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholderTextColor="#9CA3AF"
                placeholder="09123456567"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Enter your email address</Text>
              <TextInput 
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#9CA3AF"
                placeholder="jonelfogi@gmail.com"
              />
            </View>

            <TouchableOpacity 
              style={styles.saveButton} 
              onPress={handleSaveProfile}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#F27024" />
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.linkedAccountsSection}>
            <Text style={styles.linkedTitle}>Linked accounts</Text>
            
            <View style={styles.linkedRow}>
              <View style={styles.linkedLeft}>
                <Image 
                  source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Google_%22G%22_logo.svg/768px-Google_%22G%22_logo.svg.png' }} 
                  style={styles.googleIcon} 
                />
                <Text style={styles.linkedText}>Google</Text>
              </View>
              <Switch
                trackColor={{ false: '#D1D5DB', true: '#22C55E' }}
                thumbColor={'#FFFFFF'}
                ios_backgroundColor="#D1D5DB"
                onValueChange={() => setIsGoogleLinked(prev => !prev)}
                value={isGoogleLinked}
              />
            </View>
            <View style={styles.bottomDivider} />
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFFFFF' 
  },
  loadingContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    backgroundColor: '#FFFFFF'
  },
  header: {
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#FA7A25',
    paddingHorizontal: 20, 
    paddingBottom: 100,
  },
  backButton: { 
    marginRight: 12,
    bottom: -36,
  },
  headerTitle: { 
    fontSize: 23, 
    fontWeight: '800', 
    color: '#000', 
    bottom: -36,
  },
  scrollContent: { 
    paddingBottom: 100 
  },
  bottomSpacer: {
    height: 80,
  },
  imageUploadSection: { 
    alignItems: 'center', 
    marginTop: 30,
    marginBottom: 20 
  },
  imagePicker: {
    width: 90, 
    height: 90, 
    borderRadius: 45, 
    backgroundColor: '#4B5563',
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 4,
  },
  profilePreview: { 
    width: 100, 
    height: 100, 
    borderRadius: 50 
  },
  imagePlaceholder: { 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  formContainer: {
    paddingHorizontal: 30,
  },
  inputGroup: { 
    marginBottom: 16 
  },
  label: { 
    fontSize: 20, 
    color: '#000', 
    fontWeight: '600',
    marginBottom: 4 
  },
  input: {
    borderBottomWidth: 1, 
    borderColor: '#E5E7EB', 
    paddingVertical: 8,
    fontSize: 14, 
    color: '#6B7280', 
  },
  saveButton: {
    paddingVertical: 20, 
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  saveButtonText: { 
    color: '#FA7A25',
    fontWeight: '500', 
    fontSize: 14 
  },
  linkedAccountsSection: {
    marginTop: 10,
    paddingHorizontal: 20,
  },
  linkedTitle: {
    fontSize: 13,
    color: '#000',
    marginBottom: 16,
  },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
  },
  linkedLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleIcon: {
    width: 20,
    height: 20,
    marginRight: 10,
    resizeMode: 'contain',
  },
  linkedText: {
    fontSize: 13,
    color: '#374151',
  },
  bottomDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    width: '100%',
  },
});