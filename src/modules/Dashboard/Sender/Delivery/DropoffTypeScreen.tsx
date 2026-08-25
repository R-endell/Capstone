import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');

export default function DropoffTypeScreen({ route, navigation }: any) {
  const { state, dispatch } = useSchedule();
  const { mode, editData } = route.params || {};
  const insets = useSafeAreaInsets();

  const selectType = (type: 'curb-side' | 'door-to-door') => {
    dispatch({ type: 'SET_DROPOFF_TYPE', payload: type });
    navigation.navigate('ShipmentSize');
  };

  useEffect(() => {
    if (editData) {
      // Reconstruct items from cargo_profiles
      const cargo = editData.cargo_profiles || {};
      const reconstructedItems: any[] = [];

      // Create one item per box (so the user can see and manage them)
      for (let i = 0; i < (cargo.small_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-small-${i}-${Date.now()}`,
          size: 'Small',
          description: cargo.description || 'Small box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }
      for (let i = 0; i < (cargo.medium_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-medium-${i}-${Date.now()}`,
          size: 'Medium',
          description: cargo.description || 'Medium box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }
      for (let i = 0; i < (cargo.large_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-large-${i}-${Date.now()}`,
          size: 'Large',
          description: cargo.description || 'Large box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }

      dispatch({
        type: 'SET_INITIAL_STATE',
        payload: {
          dropoffType: editData.pickup_type,
          items: reconstructedItems,
          scheduledDate: editData.scheduled_time ? new Date(editData.scheduled_time) : null,
          pickupLocation: {
            address: editData.pickup_location?.street_address,
            latitude: editData.pickup_location?.latitude,
            longitude: editData.pickup_location?.longitude,
          },
          dropoffLocation: {
            address: editData.dropoff_location?.street_address,
            latitude: editData.dropoff_location?.latitude,
            longitude: editData.dropoff_location?.longitude,
          },
          estimatedCost: editData.estimated_cost,
        },
      });
      dispatch({
        type: 'SET_EDIT_DATA',
        payload: {
          requestId: editData.request_id,
          cargoId: cargo.cargo_id,
          pickupLocId: editData.pickup_location.location_id,
          dropoffLocId: editData.dropoff_location.location_id,
        },
      });
    }
  }, [editData, dispatch]);

  useEffect(() => {
    if (mode) {
      dispatch({ type: 'SET_MODE', payload: mode });
    }
  }, [mode]);

  return (
    <View style={styles.container}>
      {/* Custom Orange Header with Car Image */}
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

        {/* Adjust the path below if Car-Grey.png is located elsewhere (e.g., '../assets/Car-Grey.png') */}
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
            {/* Using a map icon as a placeholder for the custom route pin icon */}
            <Ionicons name="map" size={32} color="#EA4335" style={{ marginRight: 10 }} />
            <Text style={styles.cardTitle}>Drop-off Type</Text>
          </View>

          {/* Options Container */}
          <View style={styles.optionsWrapper}>
            
            {/* Curb-side Option */}
            <TouchableOpacity
              style={[
                styles.optionBox, 
                state.dropoffType === 'curb-side' && styles.optionBoxActive
              ]}
              onPress={() => selectType('curb-side')}
              activeOpacity={0.8}
            >
              <View style={styles.iconPlaceholder}>
                <Ionicons name="car-sport" size={50} color="#555" />
              </View>
              <Text style={styles.optionLabel}>Curb-side</Text>
              <Text style={styles.optionSub}>Receiver meets at vehicle</Text>
            </TouchableOpacity>

            {/* Door-to-Door Option */}
            <TouchableOpacity
              style={[
                styles.optionBox, 
                state.dropoffType === 'door-to-door' && styles.optionBoxActive
              ]}
              onPress={() => selectType('door-to-door')}
              activeOpacity={0.8}
            >
              <View style={styles.iconPlaceholder}>
                <Ionicons name="home" size={50} color="#8B4513" />
              </View>
              <Text style={styles.optionLabel}>Door-to-Door</Text>
              <Text style={styles.optionSub}>Deliver to actual doorstep</Text>
            </TouchableOpacity>

          </View>
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
    paddingBottom: 80, // Extra padding to make room for the car
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
    bottom: 10, // Overlaps the bottom edge of the orange header
    width: 240,
    height: 120,
    resizeMode: 'contain',
    zIndex: 2,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 30, // Space below the header overhang
    zIndex: 0,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 30,
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
    marginBottom: 40 
  },
  cardTitle: { 
    fontSize: 20, 
    fontWeight: 'bold', 
    color: '#000000' 
  },
  optionsWrapper: {
    alignItems: 'center',
  },
  optionBox: {
    width: width * 0.65, // Adjust width to look like the screenshot
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 50,
    paddingHorizontal: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionBoxActive: { 
    borderColor: '#FA7A25', 
    borderWidth: 2,
    backgroundColor: '#FFF8F4',
  },
  iconPlaceholder: {
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  optionLabel: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    color: '#000000',
    marginBottom: 4,
  },
  optionSub: { 
    fontSize: 11, 
    color: '#555555',
    textAlign: 'center',
  },
});