// src/modules/Dashboard/Sender/RegisterProviderScreen.tsx
import React, { useState } from 'react';
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

export default function RegisterProviderScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(false);
  const [orcrImage, setOrcrImage] = useState<string | null>(null);
  const [driversLicenseImage, setDriversLicenseImage] = useState<string | null>(null);
  const [uploadingOrcr, setUploadingOrcr] = useState(false);
  const [uploadingLicense, setUploadingLicense] = useState(false);

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
      if (type === 'orcr') {
        setUploadingOrcr(true);
      } else {
        setUploadingLicense(true);
      }

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

      // Try to upload, create bucket if it doesn't exist
      try {
        const { data, error } = await supabase.storage
          .from('provider-documents')
          .upload(fileName, arrayBuffer, {
            contentType: `image/${fileExt}`,
            upsert: true,
          });

        if (error) {
          // If bucket doesn't exist, create it
          if (error.message?.includes('bucket not found')) {
            await supabase.storage.createBucket('provider-documents', {
              public: true,
            });
            
            // Try upload again
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

      if (type === 'orcr') {
        setOrcrImage(urlData.publicUrl);
      } else {
        setDriversLicenseImage(urlData.publicUrl);
      }

    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Upload Error', error.message || 'Failed to upload image');
    } finally {
      if (type === 'orcr') {
        setUploadingOrcr(false);
      } else {
        setUploadingLicense(false);
      }
    }
  };

  const handleRegisterProvider = async () => {
    if (!orcrImage || !driversLicenseImage) {
      Alert.alert('Required', 'Please upload both OR/CR and Driver\'s License.');
      return;
    }

    setLoading(true);
    try {
      console.log('=== Starting Provider Registration ===');
      
      // Step 1: Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      
      if (authError) {
        console.error('Auth error:', authError);
        throw new Error('Authentication error: ' + authError.message);
      }
      if (!user) {
        console.error('No user found');
        throw new Error('No user logged in');
      }

      console.log('Auth User ID:', user.id);
      console.log('Auth User Email:', user.email);

      // Step 2: Get or create user in users table
      let { data: userData, error: userError } = await supabase
        .from('users')
        .select('user_id, first_name, last_name, email')
        .eq('auth_id', user.id)
        .maybeSingle();

      // If user doesn't exist, create them
      if (!userData) {
        console.log('Creating user profile...');
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

        if (createError) {
          console.error('Create user error:', createError);
          throw new Error('Failed to create user: ' + createError.message);
        }
        userData = newUser;
        console.log('User created with ID:', userData?.user_id);
      } else {
        console.log('User found with ID:', userData.user_id);
      }

      if (!userData) {
        throw new Error('Failed to get or create user');
      }

      // Step 3: Get Provider role_id - using maybeSingle() instead of single()
      console.log('Fetching Provider role...');
      const { data: roleData, error: roleError } = await supabase
        .from('roles')
        .select('role_id, role_name')
        .eq('role_name', 'Provider')
        .maybeSingle();

      if (roleError) {
        console.error('Role fetch error:', roleError);
        throw new Error('Error fetching Provider role: ' + roleError.message);
      }

      // If role doesn't exist, create it
      if (!roleData) {
        console.log('Provider role not found, creating it...');
        const { data: newRole, error: createRoleError } = await supabase
          .from('roles')
          .insert({ role_name: 'Provider' })
          .select('role_id, role_name')
          .maybeSingle();

        if (createRoleError) {
          console.error('Create role error:', createRoleError);
          throw new Error('Failed to create Provider role: ' + createRoleError.message);
        }

        if (!newRole) {
          throw new Error('Failed to create Provider role');
        }

        roleData = newRole;
        console.log('Provider role created with ID:', roleData.role_id);
      } else {
        console.log('Provider role found:', roleData);
      }

      // Step 4: Check if user already has Provider role
      console.log('Checking if user already has Provider role...');
      const { data: existingRole, error: checkError } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userData.user_id)
        .eq('role_id', roleData.role_id)
        .maybeSingle();

      if (checkError) {
        console.error('Check role error:', checkError);
        // Continue anyway
      }

      if (existingRole) {
        console.log('User already has Provider role');
        Alert.alert(
          'Already Registered',
          'You are already registered as a Provider!',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        setLoading(false);
        return;
      }

      // Step 5: Assign Provider role to user
      console.log('Assigning Provider role to user...');
      const { error: assignError } = await supabase
        .from('user_roles')
        .insert({
          user_id: userData.user_id,
          role_id: roleData.role_id,
        });

      if (assignError) {
        console.error('Assign role error:', assignError);
        throw new Error('Failed to assign role: ' + assignError.message);
      }

      console.log('Role assigned successfully!');

      // Step 6: Update auth user metadata
      console.log('Updating auth metadata...');
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          role: 'Provider',
          provider_documents: {
            orcr: orcrImage,
            drivers_license: driversLicenseImage,
            registered_at: new Date().toISOString(),
          }
        }
      });

      if (updateError) {
        console.error('Auth update error:', updateError);
        // Don't throw here, role is already assigned
        console.warn('Failed to update auth metadata, but role was assigned');
      } else {
        console.log('Auth metadata updated successfully');
      }

      console.log('=== Registration Complete ===');

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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Register as Provider</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.description}>
          To register as a provider, please upload the following documents:
        </Text>

        {/* OR/CR Upload */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadTitle}>OR/CR (Official Receipt / Certificate of Registration)</Text>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => pickImage('orcr')}
            disabled={uploadingOrcr}
          >
            {uploadingOrcr ? (
              <ActivityIndicator size="small" color="#FA7A25" />
            ) : orcrImage ? (
              <View style={styles.uploadedContainer}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                <Text style={styles.uploadedText}>Uploaded</Text>
              </View>
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={32} color="#FA7A25" />
                <Text style={styles.uploadButtonText}>Tap to upload OR/CR</Text>
              </>
            )}
          </TouchableOpacity>
          {orcrImage && (
            <Image source={{ uri: orcrImage }} style={styles.previewImage} />
          )}
        </View>

        {/* Driver's License Upload */}
        <View style={styles.uploadSection}>
          <Text style={styles.uploadTitle}>Driver's License</Text>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={() => pickImage('license')}
            disabled={uploadingLicense}
          >
            {uploadingLicense ? (
              <ActivityIndicator size="small" color="#FA7A25" />
            ) : driversLicenseImage ? (
              <View style={styles.uploadedContainer}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                <Text style={styles.uploadedText}>Uploaded</Text>
              </View>
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={32} color="#FA7A25" />
                <Text style={styles.uploadButtonText}>Tap to upload Driver's License</Text>
              </>
            )}
          </TouchableOpacity>
          {driversLicenseImage && (
            <Image source={{ uri: driversLicenseImage }} style={styles.previewImage} />
          )}
        </View>

        <TouchableOpacity
          style={[styles.registerButton, (!orcrImage || !driversLicenseImage) && styles.registerButtonDisabled]}
          onPress={handleRegisterProvider}
          disabled={loading || !orcrImage || !driversLicenseImage}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text style={styles.registerButtonText}>Register as Provider</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FA7A25',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 20,
    paddingTop: 10,
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#000',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  description: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 24,
    lineHeight: 22,
  },
  uploadSection: {
    marginBottom: 24,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  uploadButton: {
    borderWidth: 2,
    borderColor: '#FA7A25',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
    backgroundColor: '#FFF8F3',
  },
  uploadButtonText: {
    color: '#FA7A25',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 8,
  },
  uploadedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadedText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#10B981',
    marginLeft: 8,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginTop: 8,
  },
  registerButton: {
    backgroundColor: '#FA7A25',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 40,
  },
  registerButtonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  registerButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});