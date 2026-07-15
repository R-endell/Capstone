import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

export default function AddItemScreen({ route, navigation }: any) {
  const { size } = route.params;
  const { dispatch } = useSchedule();
  const [description, setDescription] = useState('');
  const [fragile, setFragile] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow access to photos to add a package picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const addItem = () => {
    if (!description.trim()) {
      Alert.alert('Missing', 'Please enter a description.');
      return;
    }
    dispatch({
      type: 'ADD_ITEM',
      payload: {
        id: Date.now().toString(),
        size,
        description: description.trim(),
        photoUri,
        fragile,
      },
    });
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Add {size} Item</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <TouchableOpacity style={styles.photoBox} onPress={pickImage}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={32} color="#9CA3AF" />
              <Text style={styles.photoPlaceholderText}>Add package photo</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g Glass Flower Vase"
          placeholderTextColor="#9CA3AF"
          value={description}
          onChangeText={setDescription}
        />

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Fragile / Handle with care</Text>
          <Switch
            trackColor={{ false: '#E5E7EB', true: '#D1FAE5' }}
            thumbColor={fragile ? '#10B981' : '#9CA3AF'}
            value={fragile}
            onValueChange={setFragile}
          />
        </View>

        <TouchableOpacity style={styles.addBtn} onPress={addItem}>
          <Text style={styles.addBtnText}>Add Item to Shipment</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  cancelText: { color: '#EF4444', fontWeight: '600' },
  content: { padding: 20 },
  photoBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 12,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  photoPreview: { width: '100%', height: '100%', borderRadius: 12 },
  photoPlaceholderText: { color: '#9CA3AF', fontSize: 13, marginTop: 6 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    marginBottom: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  toggleLabel: { fontSize: 14, fontWeight: '500', color: '#111827' },
  addBtn: {
    backgroundColor: '#111827',
    borderRadius: 50,
    paddingVertical: 16,
    alignItems: 'center',
  },
  addBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});