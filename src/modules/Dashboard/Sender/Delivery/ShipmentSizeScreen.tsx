import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');

export default function ShipmentSizeScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();

  const addItem = (size: 'Small' | 'Medium' | 'Large') => {
    navigation.navigate('AddItem', { size, mode });
  };

  const removeItem = (id: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  };

  const renderItem = ({ item }: any) => (
    <View style={styles.itemCard}>
      <View style={styles.itemPhotoPlaceholder}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={styles.itemPhoto} />
        ) : (
          <Ionicons name="camera-outline" size={20} color="#9CA3AF" />
        )}
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemSizeLabel}>{item.size} item</Text>
        {item.fragile && <Text style={styles.fragileTag}>Fragile</Text>}
        <Text style={styles.itemDesc}>{item.description}</Text>
      </View>
      <TouchableOpacity onPress={() => removeItem(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Text style={styles.removeText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Custom Orange Header matching DropoffTypeScreen */}
      <View style={[styles.headerBackground, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Schedule Delivery</Text>
        </View>
        
        <Text style={styles.headerSubtitle}>
          Your trusted partner in fast, secure, and{'\n'}hassle-free delivery services.
        </Text>

        {/* Adjust path to match where you stored Car-Grey.png */}
        <Image 
          source={require('../../../../../assets/Car-Grey.png')} 
          style={styles.carImage} 
        />
      </View>

      {/* Main Content Area */}
      <View style={styles.contentContainer}>
        <View style={styles.card}>
          
          {/* Card Title */}
          <View style={styles.cardTitleRow}>
            {/* Using the package icon tinted orange as a placeholder for the title */}
            <Image 
              source={require('../../../../../assets/package-sizes.png')} 
              style={[styles.titleIcon, { tintColor: '#F59E0B' }]} 
            />
            <Text style={styles.cardTitle}>What's in your shipment?</Text>
          </View>

          {/* Size Options Row */}
          <View style={styles.sizesRow}>
            {/* Small */}
            <TouchableOpacity style={styles.sizeItem} onPress={() => addItem('Small')} activeOpacity={0.7}>
              <Image source={require('../../../../../assets/package-sizes.png')} style={styles.sizeIcon} />
              <Text style={styles.sizeLabel}>Small</Text>
              <Text style={styles.sizeSub}>Less than 5kg</Text>
            </TouchableOpacity>

            {/* Medium */}
            <TouchableOpacity style={styles.sizeItem} onPress={() => addItem('Medium')} activeOpacity={0.7}>
              <Image source={require('../../../../../assets/package-sizes.png')} style={styles.sizeIcon} />
              <Text style={styles.sizeLabel}>Medium</Text>
              <Text style={styles.sizeSub}>5 to 20kg</Text>
            </TouchableOpacity>

            {/* Large */}
            <TouchableOpacity style={styles.sizeItem} onPress={() => addItem('Large')} activeOpacity={0.7}>
              <Image source={require('../../../../../assets/package-sizes.png')} style={styles.sizeIcon} />
              <Text style={styles.sizeLabel}>Large</Text>
              <Text style={styles.sizeSub}>More than 20kg</Text>
            </TouchableOpacity>
          </View>

          {/* Shipment Items List Area */}
          <View style={styles.itemsListContainer}>
            <Text style={styles.itemsTitle}>Shipment Items ({state.items.length})</Text>
            
            {state.items.length === 0 ? (
              <View style={styles.emptyDashedBox}>
                <Text style={styles.emptyText}>No items added yet. Tap a size above to add.</Text>
              </View>
            ) : (
              <FlatList
                data={state.items}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 20 }}
              />
            )}
          </View>

          {/* Confirm Button */}
          <TouchableOpacity 
            style={[
              styles.confirmButton, 
              state.items.length === 0 ? styles.confirmBtnDisabled : styles.confirmButtonActive
            ]} 
            disabled={state.items.length === 0}
            onPress={() => {
              const currentMode = state.mode || 'sendNow';
              if (currentMode === 'sendNow') {
                navigation.navigate('PickupLocation', { type: 'pickup' });
              } else {
                navigation.navigate('ScheduleCalendar');
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.confirmButtonText}>Confirm</Text>
          </TouchableOpacity>

        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FA' 
  },
  headerBackground: {
    backgroundColor: '#FA7A25',
    paddingHorizontal: 15,
    paddingBottom: 80, 
    position: 'relative',
    overflow: 'visible',
    height: 240,
    zIndex: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  backButton: {
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
    maxWidth: '70%',
  },
  carImage: {
    position: 'absolute',
    right: -30,
    bottom: 10, 
    width: 240,
    height: 120,
    resizeMode: 'contain',
    zIndex: 2,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 30, 
    zIndex: 0,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    flex: 1,
    marginBottom: 20,
  },
  cardTitleRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 30 
  },
  titleIcon: {
    width: 32,
    height: 32,
    marginRight: 10,
    resizeMode: 'contain',
  },
  cardTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#000000' 
  },
  sizesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    paddingHorizontal: 10,
  },
  sizeItem: {
    alignItems: 'center',
  },
  sizeIcon: {
    width: 45,
    height: 45,
    resizeMode: 'contain',
    marginBottom: 8,
    tintColor: '#9CA3AF', 
  },
  sizeLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 2,
  },
  sizeSub: {
    fontSize: 9,
    color: '#6B7280',
  },
  itemsListContainer: {
    flex: 1,
  },
  itemsTitle: {
    fontSize: 12,
    color: '#374151',
    marginBottom: 10,
    marginLeft: 4,
  },
  emptyDashedBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9CA3AF',
    borderRadius: 8,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#6B7280',
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemPhotoPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  itemPhoto: { width: 40, height: 40, borderRadius: 8 },
  itemInfo: { flex: 1 },
  itemSizeLabel: { fontSize: 12, fontWeight: '700', color: '#111827' },
  fragileTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  itemDesc: { fontSize: 11, color: '#6B7280' },
  removeText: { color: '#EF4444', fontWeight: '700', fontSize: 12 },
  confirmButton: {
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  confirmBtnDisabled: {
    backgroundColor: '#6B7280', 
  },
  confirmButtonActive: {
    backgroundColor: '#111827', 
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});