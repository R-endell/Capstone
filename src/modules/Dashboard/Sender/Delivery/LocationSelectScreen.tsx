import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, StatusBar, Dimensions, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');

export default function LocationSelectScreen({ route, navigation }: any) {
  const { type, initialCoords } = route.params;
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);

  const [region] = useState({
    latitude: 10.3157,
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
  const [mapLoaded, setMapLoaded] = useState(false);

  const reverseGeocode = async (coords: { latitude: number; longitude: number }) => {
    try {
      const [addr] = await Location.reverseGeocodeAsync(coords);
      if (addr) {
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

  const isPickup = type === 'pickup';
  const themeColor = isPickup ? '#0000CC' : '#C8102E';

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

  // OpenStreetMap HTML with interactive marker
  const openStreetMapHtml = `
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
          var map = L.map('map').setView([${markerCoord.latitude}, ${markerCoord.longitude}], 15);
          
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            maxZoom: 19
          }).addTo(map);

          var marker = L.marker([${markerCoord.latitude}, ${markerCoord.longitude}], {
            draggable: true
          }).addTo(map);

          marker.on('dragend', function(e) {
            var pos = marker.getLatLng();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              latitude: pos.lat,
              longitude: pos.lng
            }));
          });

          map.on('click', function(e) {
            var pos = e.latlng;
            marker.setLatLng(pos);
            window.ReactNativeWebView.postMessage(JSON.stringify({
              latitude: pos.lat,
              longitude: pos.lng
            }));
          });
        </script>
      </body>
    </html>
  `;

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.latitude && data.longitude) {
        const newCoords = { latitude: data.latitude, longitude: data.longitude };
        setMarkerCoord(newCoords);
        reverseGeocode(newCoords);
      }
    } catch (error) {
      console.log('Error parsing map message:', error);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      
      {/* Interactive Map via WebView (OpenStreetMap) */}
      <WebView
        ref={webViewRef}
        style={styles.map}
        source={{ html: openStreetMapHtml }}
        onMessage={handleMessage}
        onLoadEnd={() => setMapLoaded(true)}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
      />

      {!mapLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#F27024" />
          <Text style={styles.loadingText}>Loading map...</Text>
        </View>
      )}

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
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 12,
  },
  topOverlay: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 5,
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
    zIndex: 5,
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