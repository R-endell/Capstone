// src/modules/Dashboard/Provider/Manage/ManageVehicleScreen.tsx
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../../utils/supabase';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

import { brand } from '../../../constants';
const ORANGE = brand.orangeDark;

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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const [vehicleType, setVehicleType] = useState('Sedan');
  const [plateNumber, setPlateNumber] = useState('');
  const [maxVolume, setMaxVolume] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [cargoLength, setCargoLength] = useState('');
  const [cargoWidth, setCargoWidth] = useState('');
  const [cargoHeight, setCargoHeight] = useState('');
  const [vehicleDoc, setVehicleDoc] = useState<string | null>(null);
  const [docFileName, setDocFileName] = useState<string | null>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const modalAnim = useRef(new Animated.Value(0)).current;

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
      animate(listAnim, 200),
    ]).start();
  }, [headerAnim, listAnim]);

  useEffect(() => {
    if (modalVisible) {
      modalAnim.setValue(0);
      Animated.timing(modalAnim, {
        toValue: 1,
        duration: 350,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [modalVisible, modalAnim]);

  const fetchUserId = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .single();
      if (error) { console.error('Error fetching user:', error); return null; }
      return userData?.user_id || null;
    } catch (error) { console.error('Error fetching user ID:', error); return null; }
  };

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const id = await fetchUserId();
      if (!id) { setLoading(false); return; }
      setUserId(id);
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('provider_id', id)
        .order('vehicle_id', { ascending: false });
      if (error) { console.error('Error fetching vehicles:', error); Alert.alert('Error', 'Failed to load vehicles'); return; }
      setVehicles(data || []);
    } catch (error) { console.error('Error fetching vehicles:', error); Alert.alert('Error', 'Failed to load vehicles'); } finally { setLoading(false); }
  };

  useFocusEffect(useCallback(() => { fetchVehicles(); }, []));

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const asset = result.assets[0];
      const uri = asset.uri;
      const name = asset.name || 'document';
      const mimeType = asset.mimeType || 'application/octet-stream';

      await uploadDocument(uri, name, mimeType);
    } catch (error) {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant permission to access your photos.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.8,
        });
        if (!result.canceled && result.assets && result.assets.length > 0) {
          const uri = result.assets[0].uri;
          const name = 'image.jpg';
          const mimeType = 'image/jpeg';
          await uploadDocument(uri, name, mimeType);
        }
      } catch (err) {
        console.error('Error picking document:', err);
        Alert.alert('Error', 'Failed to pick document');
      }
    }
  };

  const uploadDocument = async (uri: string, fileName: string, mimeType: string) => {
    try {
      setUploading(true);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets?.some(b => b.name === 'vehicle-documents');
      if (!bucketExists) {
        await supabase.storage.createBucket('vehicle-documents', { public: true });
      }

      const fileExt = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const storagePath = `vehicles/${user.id}/${Date.now()}.${fileExt}`;

      const file = new File(uri);
      const base64 = await file.base64();

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const arrayBuffer = bytes.buffer;

      const { error: uploadError } = await supabase.storage
        .from('vehicle-documents')
        .upload(storagePath, arrayBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('vehicle-documents')
        .getPublicUrl(storagePath);

      setVehicleDoc(urlData.publicUrl);
      setDocFileName(fileName);
      Alert.alert('Success', 'Document uploaded successfully');
    } catch (error: any) {
      console.error('Upload error:', error);
      Alert.alert('Error', error.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!vehicleType || !plateNumber || !maxVolume || !maxWeight ||
        !cargoLength || !cargoWidth || !cargoHeight) {
      Alert.alert('Required', 'Please fill in all fields');
      return;
    }
    if (!userId) { Alert.alert('Error', 'User not found'); return; }

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
        const { error: updateError } = await supabase.from('vehicles').update(vehicleData).eq('vehicle_id', editingVehicle.vehicle_id);
        error = updateError;
      } else {
        const { error: insertError } = await supabase.from('vehicles').insert(vehicleData);
        error = insertError;
      }
      if (error) throw error;

      Alert.alert('Success', editingVehicle ? 'Vehicle updated successfully!' : 'Vehicle added successfully!', [
        { text: 'OK', onPress: () => { resetForm(); setModalVisible(false); fetchVehicles(); } }
      ]);
    } catch (error: any) {
      console.error('Submit error:', error);
      if (error.code === '23505') {
        Alert.alert('Error', 'This plate number is already registered');
      } else {
        Alert.alert('Error', error.message || 'Failed to save vehicle');
      }
    } finally { setSubmitting(false); }
  };

  const handleDelete = (vehicle: Vehicle) => {
    Alert.alert('Delete Vehicle', `Are you sure you want to delete ${vehicle.vehicle_type} (${vehicle.plate_number})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const { error } = await supabase.from('vehicles').delete().eq('vehicle_id', vehicle.vehicle_id);
            if (error) throw error;
            setVehicles(prev => prev.filter(v => v.vehicle_id !== vehicle.vehicle_id));
            Alert.alert('Success', 'Vehicle deleted successfully');
          } catch (error: any) { console.error('Delete error:', error); Alert.alert('Error', error.message || 'Failed to delete vehicle'); }
        }
      },
    ]);
  };

  const resetForm = () => {
    setVehicleType('Sedan');
    setPlateNumber('');
    setMaxVolume('');
    setMaxWeight('');
    setCargoLength('');
    setCargoWidth('');
    setCargoHeight('');
    setVehicleDoc(null);
    setDocFileName(null);
    setEditingVehicle(null);
  };

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
    if (vehicle.vehicle_doc) {
      const parts = vehicle.vehicle_doc.split('/');
      setDocFileName(parts[parts.length - 1] || 'document');
    }
    setModalVisible(true);
  };

  const handleAdd = () => { resetForm(); setModalVisible(true); };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({
        inputRange: [0, 1],
        outputRange: [distance, 0],
      }),
    }],
  });

  const modalScale = modalAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  const renderVehicleItem = ({ item }: { item: Vehicle }) => {
    const isVerified = item.verification_status === 'Verified';
    const isPending = item.verification_status === 'Pending';
    const isRejected = item.verification_status === 'Rejected';

    const statusBg = isVerified ? colors.successBg : isPending ? colors.warningBg : colors.errorBg;
    const statusColor = isVerified ? colors.success : isPending ? colors.warning : colors.error;
    const statusIcon: any = isVerified ? 'checkmark-circle' : isPending ? 'time' : 'close-circle';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View style={styles.vehicleIconBox}>
              <Ionicons name="car-sport" size={22} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.vehicleBrand} numberOfLines={1}>{item.vehicle_type}</Text>
              <View style={styles.plateRow}>
                <Ionicons name="pricetag-outline" size={12} color={colors.textSecondary} />
                <Text style={styles.vehiclePlate}>{item.plate_number}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            <Ionicons name={statusIcon} size={12} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>
              {item.verification_status}
            </Text>
          </View>
        </View>

        <View style={styles.specsRow}>
          <View style={styles.specItem}>
            <Ionicons name="water-outline" size={14} color={ORANGE} />
            <Text style={styles.specValue}>{item.max_volume_liters}</Text>
            <Text style={styles.specLabel}>Liters</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specItem}>
            <Ionicons name="barbell-outline" size={14} color={ORANGE} />
            <Text style={styles.specValue}>{item.max_weight_kg}</Text>
            <Text style={styles.specLabel}>kg</Text>
          </View>
          <View style={styles.specDivider} />
          <View style={styles.specItem}>
            <Ionicons name="cube-outline" size={14} color={ORANGE} />
            <Text style={styles.specValue}>
              {item.cargo_length_cm}×{item.cargo_width_cm}×{item.cargo_height_cm}
            </Text>
            <Text style={styles.specLabel}>cm</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(item)} activeOpacity={0.85}>
            <Ionicons name="create-outline" size={14} color={ORANGE} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item)} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={14} color={colors.error} />
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <Animated.View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }, fadeUp(headerAnim, -14)]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, paddingLeft: 14 }}>
          <Text style={styles.headerTitle}>Manage Vehicles</Text>
          <Text style={styles.headerSubtitle}>
            {vehicles.length} {vehicles.length === 1 ? 'vehicle' : 'vehicles'}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerAddBtn} onPress={handleAdd} activeOpacity={0.9}>
          <Ionicons name="add" size={22} color={ORANGE} />
        </TouchableOpacity>
      </Animated.View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading vehicles...</Text>
        </View>
      ) : vehicles.length === 0 ? (
        <Animated.View style={[styles.emptyContainer, fadeUp(listAnim, 20)]}>
          <View style={styles.emptyIconCircle}>
            <Ionicons name="car-outline" size={40} color={ORANGE} />
          </View>
          <Text style={styles.emptyTitle}>No vehicles yet</Text>
          <Text style={styles.emptySubtitle}>
            Add your first vehicle to start accepting deliveries
          </Text>
          <TouchableOpacity style={styles.emptyAddBtn} onPress={handleAdd} activeOpacity={0.9}>
            <Ionicons name="add-circle" size={18} color="#FFFFFF" />
            <Text style={styles.emptyAddBtnText}>Add Vehicle</Text>
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <Animated.View style={{ flex: 1, opacity: listAnim }}>
          <FlatList
            data={vehicles}
            keyExtractor={(item) => item.vehicle_id.toString()}
            renderItem={renderVehicleItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshing={loading}
            onRefresh={fetchVehicles}
            ListFooterComponent={<View style={{ height: 40 }} />}
          />
        </Animated.View>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => { resetForm(); setModalVisible(false); }}
      >
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContainer, { transform: [{ scale: modalScale }], opacity: modalAnim }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => { resetForm(); setModalVisible(false); }} style={styles.modalCloseBtn} activeOpacity={0.85}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {editingVehicle ? 'Edit Vehicle' : 'Add Vehicle'}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.formSection}>
                <Text style={styles.sectionLabel}>Vehicle Type</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.typeGridScroll}>
                  {VEHICLE_TYPES.map((type) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.typeBtn, vehicleType === type && styles.typeBtnActive]}
                      onPress={() => setVehicleType(type)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.typeBtnText, vehicleType === type && styles.typeBtnTextActive]}>
                        {type}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.formField}>
                <Text style={styles.inputLabel}>Plate Number</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    value={plateNumber}
                    onChangeText={setPlateNumber}
                    placeholder="ABC 1234"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                  />
                </View>
              </View>

              <View style={styles.rowInputs}>
                <View style={styles.halfField}>
                  <Text style={styles.inputLabel}>Max Volume (L)</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="water-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={maxVolume}
                      onChangeText={setMaxVolume}
                      placeholder="500"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
                <View style={styles.halfField}>
                  <Text style={styles.inputLabel}>Max Weight (kg)</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="barbell-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={maxWeight}
                      onChangeText={setMaxWeight}
                      placeholder="1000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              </View>

              <Text style={styles.sectionLabel}>Cargo Dimensions (cm)</Text>
              <View style={styles.rowInputs}>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabelSmall}>Length</Text>
                  <TextInput
                    style={styles.textInputCompact}
                    value={cargoLength}
                    onChangeText={setCargoLength}
                    placeholder="200"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabelSmall}>Width</Text>
                  <TextInput
                    style={styles.textInputCompact}
                    value={cargoWidth}
                    onChangeText={setCargoWidth}
                    placeholder="150"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.thirdField}>
                  <Text style={styles.inputLabelSmall}>Height</Text>
                  <TextInput
                    style={styles.textInputCompact}
                    value={cargoHeight}
                    onChangeText={setCargoHeight}
                    placeholder="100"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.formField}>
                <Text style={styles.inputLabel}>OR/CR Document (Optional)</Text>
                <TouchableOpacity
                  style={[styles.uploadBox, vehicleDoc && styles.uploadBoxFilled]}
                  onPress={pickDocument}
                  disabled={uploading}
                  activeOpacity={0.85}
                >
                  {uploading ? (
                    <View style={styles.uploadingContainer}>
                      <ActivityIndicator size="large" color={ORANGE} />
                      <Text style={styles.uploadingText}>Uploading...</Text>
                    </View>
                  ) : vehicleDoc ? (
                    <View style={styles.uploadedContainer}>
                      {vehicleDoc.endsWith('.pdf') ? (
                        <View style={styles.docIconBox}>
                          <Ionicons name="document-text" size={32} color={ORANGE} />
                        </View>
                      ) : (
                        <Image source={{ uri: vehicleDoc }} style={styles.uploadedImage} />
                      )}
                      <Text style={styles.uploadedText} numberOfLines={1}>
                        {docFileName || 'Document uploaded'}
                      </Text>
                      <TouchableOpacity style={styles.removeDocBtn} onPress={() => { setVehicleDoc(null); setDocFileName(null); }}>
                        <Ionicons name="trash-outline" size={14} color={colors.error} />
                        <Text style={styles.removeDocText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={styles.uploadIconBox}>
                        <Ionicons name="cloud-upload-outline" size={28} color={ORANGE} />
                      </View>
                      <Text style={styles.uploadText}>Tap to upload OR/CR</Text>
                      <Text style={styles.uploadSubtext}>Image or PDF</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={[styles.submitBtn, submitting && styles.submitBtnDisabled]} onPress={handleSubmit} disabled={submitting} activeOpacity={0.9}>
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>
                      {editingVehicle ? 'Update Vehicle' : 'Add Vehicle'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.divider,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '500',
  },
  headerAddBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: ORANGE,
  },

  listContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    marginTop: 4,
    color: c.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },

  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.textPrimary,
    marginTop: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: c.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 18,
  },
  emptyAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 24,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  card: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.06 : 0.3,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: c.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  vehicleIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  vehicleBrand: {
    fontSize: 15,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.2,
  },
  plateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  vehiclePlate: {
    fontSize: 12,
    color: c.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  specsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.background,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: c.divider,
  },
  specItem: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  specValue: {
    fontSize: 13,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.2,
  },
  specLabel: {
    fontSize: 10,
    color: c.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  specDivider: {
    width: 1,
    height: 28,
    backgroundColor: c.border,
  },

  cardFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.divider,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.accentSoft,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: ORANGE,
  },
  editBtnText: {
    color: ORANGE,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.errorBg,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: c.error,
  },
  deleteBtnText: {
    color: c.error,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: c.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    maxHeight: '94%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: c.statusBarStyle === 'dark-content' ? 0.15 : 0.5,
    shadowRadius: 20,
    elevation: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.divider,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.2,
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  formSection: { marginBottom: 20 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: c.textPrimary,
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  typeGridScroll: {
    paddingRight: 20,
    gap: 8,
  },
  typeBtn: {
    backgroundColor: c.card,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: c.border,
  },
  typeBtnActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  typeBtnText: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '700',
  },
  typeBtnTextActive: { color: '#FFFFFF' },

  formField: { marginBottom: 18 },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: c.textPrimary,
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  inputLabelSmall: {
    fontSize: 11,
    fontWeight: '700',
    color: c.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: 14,
  },
  inputIcon: {
    paddingLeft: 14,
    paddingRight: 4,
  },
  textInput: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 10,
    fontSize: 14,
    color: c.textPrimary,
    fontWeight: '600',
  },
  textInputCompact: {
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 14,
    color: c.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
  },

  rowInputs: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  halfField: { flex: 1 },
  thirdField: { flex: 1 },

  uploadBox: {
    borderWidth: 2,
    borderColor: c.border,
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 130,
    backgroundColor: c.background,
  },
  uploadBoxFilled: {
    borderStyle: 'solid',
    borderColor: ORANGE,
    backgroundColor: c.accentSoft,
  },
  uploadIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  uploadText: {
    fontSize: 13,
    color: c.textPrimary,
    fontWeight: '700',
    marginTop: 8,
  },
  uploadSubtext: {
    fontSize: 11,
    color: c.textMuted,
    fontWeight: '500',
    marginTop: 2,
  },
  uploadingContainer: { alignItems: 'center', gap: 10 },
  uploadingText: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '600',
  },
  uploadedContainer: {
    alignItems: 'center',
    gap: 8,
  },
  docIconBox: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: c.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadedImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  uploadedText: {
    fontSize: 12,
    color: c.textPrimary,
    fontWeight: '700',
    maxWidth: 220,
  },
  removeDocBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: c.errorBg,
  },
  removeDocText: {
    color: c.error,
    fontSize: 12,
    fontWeight: '700',
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 12,
    gap: 8,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 5,
  },
  submitBtnDisabled: {
    backgroundColor: c.textMuted,
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});