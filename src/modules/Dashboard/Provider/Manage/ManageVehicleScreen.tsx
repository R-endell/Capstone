// src/modules/Dashboard/Provider/Manage/ManageVehicleScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
  StatusBar,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase'; 
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';

interface Vehicle {
  vehicle_id: number;
  vehicle_type: string;
  plate_number: string;
  max_volume_liters: number;
  max_weight_kg: number;
  cargo_length_cm: number;
  cargo_width_cm: number;
  cargo_height_cm: number;
  vehicle_doc: string | null;
  verification_status: 'Pending' | 'Verified' | 'Rejected';
  provider_id: number;
}

const VEHICLE_TYPES = ['Sedan', 'SUV', 'MPV', 'Hatchback', 'Van', 'Truck', 'Motorcycle'];

export default function ManageVehicleScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  
  // Form State
  const [vehicleType, setVehicleType] = useState('Sedan');
  const [plateNumber, setPlateNumber] = useState('');
  const [maxVolume, setMaxVolume] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [cargoLength, setCargoLength] = useState('');
  const [cargoWidth, setCargoWidth] = useState('');
  const [cargoHeight, setCargoHeight] = useState('');
  const [vehicleDoc, setVehicleDoc] = useState<string | null>(null);

  // Fetch user ID
  const fetchUserId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching user:', error);
        return null;
      }

      return userData?.user_id || null;
    } catch (error) {
      console.error('Error fetching user ID:', error);
      return null;
    }
  };

  // Fetch vehicles
  const fetchVehicles = async () => {
    try {
      setLoading(true);
      
      const id = await fetchUserId();
      if (!id) {
        setLoading(false);
        return;
      }

      setUserId(id);

      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('provider_id', id)
        .order('vehicle_id', { ascending: false });

      if (error) {
        console.error('Error fetching vehicles:', error);
        Alert.alert('Error', 'Failed to load vehicles');
        return;
      }

      setVehicles(data || []);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      Alert.alert('Error', 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchVehicles();
    }, [])
  );

  // Pick image for vehicle document
  const pickDocument = async () => {
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
        await uploadDocument(uri);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    }
  };

  // Upload document to Supabase Storage
  const uploadDocument = async (uri: string) => {
    try {
      setUploading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `vehicles/${user.id}/${Date.now()}.${fileExt}`;

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      // Check if bucket exists
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === 'vehicle-documents');
      
      if (!bucketExists) {
        await supabase.storage.createBucket('vehicle-documents', {
          public: true,
        });
      }

      const { error } = await supabase.storage
        .from('vehicle-documents')
        .upload(fileName, arrayBuffer, {
          contentType: `image/${fileExt}`,
          upsert: true,
        });

      if (error) throw error;

      const { data: urlData } = supabase.storage
        .from('vehicle-documents')
        .getPublicUrl(fileName);

      setVehicleDoc(urlData.publicUrl);
      Alert.alert('Success', 'Document uploaded successfully');
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Error', 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  // Add or Update Vehicle
  const handleSubmit = async () => {
    // Validate form
    if (!vehicleType || !plateNumber || !maxVolume || !maxWeight || 
        !cargoLength || !cargoWidth || !cargoHeight) {
      Alert.alert('Required', 'Please fill in all fields');
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'User not found');
      return;
    }

    setSubmitting(true);
    try {
      const vehicleData = {
        vehicle_type: vehicleType,
        plate_number: plateNumber.toUpperCase(),
        max_volume_liters: parseFloat(maxVolume),
        max_weight_kg: parseFloat(maxWeight),
        cargo_length_cm: parseFloat(cargoLength),
        cargo_width_cm: parseFloat(cargoWidth),
        cargo_height_cm: parseFloat(cargoHeight),
        provider_id: userId,
        verification_status: 'Pending',
        vehicle_doc: vehicleDoc,
      };

      let error;

      if (editingVehicle) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update(vehicleData)
          .eq('vehicle_id', editingVehicle.vehicle_id);

        error = updateError;
      } else {
        // Insert new vehicle
        const { error: insertError } = await supabase
          .from('vehicles')
          .insert(vehicleData);

        error = insertError;
      }

      if (error) {
        console.error('Submit error:', error);
        throw error;
      }

      Alert.alert(
        'Success',
        editingVehicle ? 'Vehicle updated successfully!' : 'Vehicle added successfully!',
        [
          {
            text: 'OK',
            onPress: () => {
              resetForm();
              setModalVisible(false);
              fetchVehicles();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('Submit error:', error);
      
      // Check for duplicate plate number
      if (error.code === '23505') {
        Alert.alert('Error', 'This plate number is already registered');
      } else {
        Alert.alert('Error', error.message || 'Failed to save vehicle');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Vehicle
  const handleDelete = (vehicle: Vehicle) => {
    Alert.alert(
      'Delete Vehicle',
      `Are you sure you want to delete ${vehicle.vehicle_type} (${vehicle.plate_number})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('vehicles')
                .delete()
                .eq('vehicle_id', vehicle.vehicle_id);

              if (error) throw error;

              setVehicles(prev => prev.filter(v => v.vehicle_id !== vehicle.vehicle_id));
              Alert.alert('Success', 'Vehicle deleted successfully');
            } catch (error: any) {
              console.error('Delete error:', error);
              Alert.alert('Error', error.message || 'Failed to delete vehicle');
            }
          },
        },
      ]
    );
  };

  // Reset form
  const resetForm = () => {
    setVehicleType('Sedan');
    setPlateNumber('');
    setMaxVolume('');
    setMaxWeight('');
    setCargoLength('');
    setCargoWidth('');
    setCargoHeight('');
    setVehicleDoc(null);
    setEditingVehicle(null);
  };

  // Open edit modal
  const handleEdit = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleType(vehicle.vehicle_type);
    setPlateNumber(vehicle.plate_number);
    setMaxVolume(vehicle.max_volume_liters.toString());
    setMaxWeight(vehicle.max_weight_kg.toString());
    setCargoLength(vehicle.cargo_length_cm.toString());
    setCargoWidth(vehicle.cargo_width_cm.toString());
    setCargoHeight(vehicle.cargo_height_cm.toString());
    setVehicleDoc(vehicle.vehicle_doc);
    setModalVisible(true);
  };

  // Open add modal
  const handleAdd = () => {
    resetForm();
    setModalVisible(true);
  };

  // Render vehicle item
  const renderVehicleItem = ({ item }: { item: Vehicle }) => {
    const isVerified = item.verification_status === 'Verified';
    const isPending = item.verification_status === 'Pending';
    const isRejected = item.verification_status === 'Rejected';

    const getStatusColor = () => {
      if (isVerified) return styles.statusVerified;
      if (isPending) return styles.statusPending;
      return styles.statusRejected;
    };

    const getStatusTextColor = () => {
      if (isVerified) return styles.statusTextVerified;
      if (isPending) return styles.statusTextPending;
      return styles.statusTextRejected;
    };

    return (
      <View style={styles.vehicleRow}>
        <View style={styles.vehicleLeft}>
          <Ionicons name="car-sport" size={40} color="#FA7A25" />
          <View style={styles.vehicleInfo}>
            <Text style={styles.vehicleBrand}>{item.vehicle_type}</Text>
            <Text style={styles.vehiclePlate}>{item.plate_number}</Text>
            <Text style={styles.vehicleDetails}>
              {item.max_volume_liters}L • {item.max_weight_kg}kg
            </Text>
          </View>
        </View>
        
        <View style={styles.vehicleRight}>
          <View style={[styles.statusBadge, getStatusColor()]}>
            <Text style={[styles.statusText, getStatusTextColor()]}>
              {item.verification_status}
            </Text>
          </View>
          <View style={styles.actionButtons}>
            <TouchableOpacity 
              style={styles.editBtn} 
              onPress={() => handleEdit(item)}
            >
              <Ionicons name="pencil" size={20} color="#4B5563" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.deleteBtn} 
              onPress={() => handleDelete(item)}
            >
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manage Vehicles</Text>
        </View>

        <TouchableOpacity 
          style={styles.addVehicleBtn}
          onPress={handleAdd}
        >
          <Ionicons name="add" size={18} color="#000" />
          <Text style={styles.addVehicleText}>Add Vehicle</Text>
        </TouchableOpacity>
      </View>

      {/* Vehicle List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FA7A25" />
          <Text style={styles.loadingText}>Loading vehicles...</Text>
        </View>
      ) : vehicles.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="car-outline" size={64} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No vehicles yet</Text>
          <Text style={styles.emptySubtitle}>
            Add your first vehicle to start accepting deliveries
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd}>
            <Text style={styles.emptyAddBtnText}>Add Vehicle</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.vehicle_id.toString()}
          renderItem={renderVehicleItem}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={fetchVehicles}
        />
      )}

      {/* Add/Edit Vehicle Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => {
          resetForm();
          setModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView 
            style={styles.modalScrollView}
            contentContainerStyle={styles.modalContentContainer}
          >
            <View style={styles.modalContent}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <TouchableOpacity 
                  onPress={() => {
                    resetForm();
                    setModalVisible(false);
                  }} 
                  style={styles.modalBackBtn}
                >
                  <Ionicons name="arrow-back" size={24} color="#000" />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>
                  {editingVehicle ? 'Edit Vehicle' : 'Add Vehicle'}
                </Text>
                <View style={{ width: 24 }} />
              </View>

              {/* Vehicle Type */}
              <View style={styles.formSection}>
                <Text style={styles.sectionLabel}>Vehicle Type</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.typeGrid}>
                    {VEHICLE_TYPES.map((type) => (
                      <TouchableOpacity 
                        key={type} 
                        style={[styles.typeBtn, vehicleType === type && styles.typeBtnActive]}
                        onPress={() => setVehicleType(type)}
                      >
                        <Text style={[styles.typeBtnText, vehicleType === type && styles.typeBtnTextActive]}>
                          {type}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Plate Number */}
              <View style={styles.formField}>
                <Text style={styles.inputLabel}>Plate Number</Text>
                <TextInput 
                  style={styles.textInput} 
                  value={plateNumber}
                  onChangeText={setPlateNumber}
                  placeholder="Enter plate number"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="characters"
                />
              </View>

              {/* Dimensions Row */}
              <View style={styles.rowInputs}>
                <View style={styles.halfField}>
                  <Text style={styles.inputLabel}>Max Volume (L)</Text>
                  <TextInput 
                    style={styles.textInput} 
                    value={maxVolume}
                    onChangeText={setMaxVolume}
                    placeholder="e.g., 500"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfField}>
                  <Text style={styles.inputLabel}>Max Weight (kg)</Text>
                  <TextInput 
                    style={styles.textInput} 
                    value={maxWeight}
                    onChangeText={setMaxWeight}
                    placeholder="e.g., 1000"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* Cargo Dimensions */}
              <Text style={styles.sectionLabel}>Cargo Dimensions</Text>
              <View style={styles.rowInputs}>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabel}>Length (cm)</Text>
                  <TextInput 
                    style={styles.textInput} 
                    value={cargoLength}
                    onChangeText={setCargoLength}
                    placeholder="e.g., 200"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabel}>Width (cm)</Text>
                  <TextInput 
                    style={styles.textInput} 
                    value={cargoWidth}
                    onChangeText={setCargoWidth}
                    placeholder="e.g., 150"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabel}>Height (cm)</Text>
                  <TextInput 
                    style={styles.textInput} 
                    value={cargoHeight}
                    onChangeText={setCargoHeight}
                    placeholder="e.g., 100"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              {/* OR/CR Document Upload */}
              <View style={styles.formField}>
                <Text style={styles.inputLabel}>OR/CR Document (Optional)</Text>
                <TouchableOpacity 
                  style={styles.uploadBox} 
                  onPress={pickDocument}
                  disabled={uploading}
                >
                  {uploading ? (
                    <ActivityIndicator size="large" color="#FA7A25" />
                  ) : vehicleDoc ? (
                    <View style={styles.uploadedContainer}>
                      <Ionicons name="checkmark-circle" size={40} color="#10B981" />
                      <Text style={styles.uploadedText}>Document Uploaded</Text>
                      <TouchableOpacity 
                        style={styles.removeDocBtn}
                        onPress={() => setVehicleDoc(null)}
                      >
                        <Text style={styles.removeDocText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <Ionicons name="cloud-upload-outline" size={40} color="#FA7A25" />
                      <Text style={styles.uploadText}>Tap to upload OR/CR</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Submit Button */}
              <TouchableOpacity 
                style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>
                    {editingVehicle ? 'Update Vehicle' : 'Add Vehicle'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    paddingHorizontal: 20,
    paddingBottom: 80,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backBtn: {
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000',
  },
  addVehicleBtn: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  addVehicleText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#000',
    marginLeft: 4,
  },
  listContent: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  emptyAddBtn: {
    backgroundColor: '#FA7A25',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  emptyAddBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  vehicleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  vehicleInfo: {
    marginLeft: 12,
    flex: 1,
  },
  vehicleBrand: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  vehiclePlate: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 2,
  },
  vehicleDetails: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  vehicleRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  statusVerified: { backgroundColor: '#86EFAC' },
  statusPending: { backgroundColor: '#FDE047' },
  statusRejected: { backgroundColor: '#FCA5A5' },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
  },
  statusTextVerified: { color: '#166534' },
  statusTextPending: { color: '#854D0E' },
  statusTextRejected: { color: '#991B1B' },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editBtn: {
    padding: 4,
    marginRight: 4,
  },
  deleteBtn: {
    padding: 4,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalScrollView: {
    flex: 1,
  },
  modalContentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalBackBtn: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  formSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingVertical: 4,
  },
  typeBtn: {
    backgroundColor: '#F3F4F6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  typeBtnActive: {
    backgroundColor: '#FA7A25',
  },
  typeBtnText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  typeBtnTextActive: {
    color: '#FFFFFF',
  },
  formField: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#000',
    backgroundColor: '#FFF',
  },
  rowInputs: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  halfField: {
    flex: 1,
    marginRight: 8,
  },
  thirdField: {
    flex: 1,
    marginRight: 8,
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  uploadText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
  },
  uploadedContainer: {
    alignItems: 'center',
  },
  uploadedText: {
    fontSize: 14,
    color: '#10B981',
    marginTop: 8,
    fontWeight: '500',
  },
  removeDocBtn: {
    marginTop: 8,
  },
  removeDocText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '500',
  },
  submitBtn: {
    backgroundColor: '#FA7A25',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});