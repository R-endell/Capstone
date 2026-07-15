import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params; // 'pickup' or 'dropoff'
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();

  const [region, setRegion] = useState({
    latitude: 10.3157, // Defaulted to Cebu City based on screenshots
    longitude: 123.8854,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  });
  
  const [markerCoord, setMarkerCoord] = useState({
    latitude: region.latitude,
    longitude: region.longitude,
  });
  
  const [addressName, setAddressName] = useState<string>('Loading...');
  const [addressSub, setAddressSub] = useState<string>('');

  const reverseGeocode = async (coords: { latitude: number; longitude: number }) => {
    try {
      const [addr] = await Location.reverseGeocodeAsync(coords);
      if (addr) {
        // Try to separate a main point of interest name from the rest of the street address
        const mainName = addr.name || addr.street || 'Selected Location';
        const subParts = [addr.street !== addr.name ? addr.street : null, addr.city, addr.region]
          .filter(Boolean)
          .join(', ');
        
        setAddressName(mainName);
        setAddressSub(subParts || `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      } else {
        setAddressName('Selected Location');
        setAddressSub(`${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`);
      }
    } catch {
      setAddressName('Unknown Location');
      setAddressSub('Unable to fetch address details');
    }
  };

  useEffect(() => {
    if (type === 'dropoff' && initialCoords) {
      setRegion(prev => ({ ...prev, ...initialCoords }));
      setMarkerCoord(initialCoords);
      reverseGeocode(initialCoords);
      return;
    }

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Location is needed to select an address.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const newCoords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setRegion(prev => ({ ...prev, ...newCoords }));
      setMarkerCoord(newCoords);
      reverseGeocode(newCoords);
    })();
  }, [type, initialCoords]);

  const confirmLocation = () => {
    const fullAddress = `${addressName}, ${addressSub}`;
    const locationInfo = { address: fullAddress, latitude: markerCoord.latitude, longitude: markerCoord.longitude };
    
    if (type === 'pickup') {
      dispatch({ type: 'SET_PICKUP_LOCATION', payload: locationInfo });
      navigation.navigate('DropoffLocation', {
        type: 'dropoff',
        initialCoords: markerCoord,
      });
    } else {
      dispatch({ type: 'SET_DROPOFF_LOCATION', payload: locationInfo });
      const cost = Math.floor(Math.random() * 30) + 20;
      dispatch({ type: 'SET_ESTIMATED_COST', payload: cost });
      navigation.navigate('Booking', { mode });   
    }
  };

  // UI Helpers based on type
  const isPickup = type === 'pickup';
  const themeColor = isPickup ? '#0000CC' : '#C8102E'; // Blue for pickup, Red for dropoff

  const TypeIcon = ({ size = 20 }: { size?: number }) => {
    if (isPickup) {
      return (
        <View style={[styles.pickupIconOuter, { width: size, height: size, borderRadius: size / 2, borderColor: themeColor }]}>
          <View style={[styles.pickupIconInner, { backgroundColor: themeColor, width: size * 0.4, height: size * 0.4, borderRadius: size * 0.2 }]} />
        </View>
      );
    }
    return <Ionicons name="location" size={size * 1.2} color={themeColor} />;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* Full Screen Map */}
      <MapView
        style={styles.map}
        region={region}
        onRegionChangeComplete={setRegion}
        onPress={(e) => {
          const coord = e.nativeEvent.coordinate;
          setMarkerCoord(coord);
          reverseGeocode(coord);
        }}
        showsUserLocation={true}
      >
        <Marker
          draggable
          coordinate={markerCoord}
          onDragEnd={(e) => {
            setMarkerCoord(e.nativeEvent.coordinate);
            reverseGeocode(e.nativeEvent.coordinate);
          }}
        >
          {/* Custom Marker matching screenshot */}
          <View style={styles.customPinContainer}>
             <View style={styles.customPinHead} />
             <View style={styles.customPinStick} />
          </View>
        </Marker>
      </MapView>

      {/* Floating Top Search Bar Area */}
      <View style={[styles.topOverlay, { top: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backCircleBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.searchPill}>
          <TypeIcon size={16} />
          <Text style={styles.searchPillText}>
            {isPickup ? 'Pick up at?' : 'Where to Drop-off?'}
          </Text>
        </View>
      </View>

      {/* Bottom Sheet UI */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        <Text style={styles.sheetTitle}>
          {isPickup ? 'Pick-up point' : 'Drop-off Location'}
        </Text>

        <View style={styles.addressRow}>
          <View style={styles.iconContainer}>
            <TypeIcon size={24} />
          </View>
          <View style={styles.addressTextContainer}>
            <Text style={styles.addressMainText} numberOfLines={1}>{addressName}</Text>
            <Text style={styles.addressSubText} numberOfLines={2}>{addressSub}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <TouchableOpacity style={styles.confirmBtn} onPress={confirmLocation} activeOpacity={0.8}>
          <Text style={styles.confirmBtnText}>Confirm</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFF' 
  },
  map: { 
    flex: 1,
  },
  customPinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  customPinHead: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E11D48',
    borderWidth: 2,
    borderColor: '#000',
    zIndex: 2,
  },
  customPinStick: {
    width: 2,
    height: 15,
    backgroundColor: '#000',
    marginTop: -2,
    zIndex: 1,
  },
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backCircleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
    marginRight: 12,
  },
  searchPill: {
    flex: 1,
    height: 44,
    backgroundColor: '#FFF',
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  searchPillText: {
    marginLeft: 12,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  pickupIconOuter: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupIconInner: {},
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFF',
    paddingTop: 24,
    paddingHorizontal: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 20,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconContainer: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  addressTextContainer: {
    flex: 1,
  },
  addressMainText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 4,
  },
  addressSubText: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 20,
  },
  confirmBtn: {
    backgroundColor: '#1C1C1E',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});