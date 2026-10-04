// src/modules/Dashboard/Sender/HomeScreen.tsx
import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';
import { supabase } from '../../../utils/supabase';

/** Brand */
const ORANGE = '#F27024';

/* ==================================================================== */
/* HomeMap — Interactive HD Leaflet Map for Sender Dashboard            */
/* ==================================================================== */
const HomeMap = ({ centerLat, centerLng }: { centerLat: number; centerLng: number }) => {
  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
          .user-marker { background: #3B82F6; border: 3px solid white; border-radius: 50%; width: 22px; height: 22px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
          .pulse { width: 10px; height: 10px; background-color: white; border-radius: 50%; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          // Initialize map with HD Retina detection for crisp rendering
          var map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false,
            detectRetina: true 
          }).setView([${centerLat}, ${centerLng}], 15);

          // Use high-res tile rendering parameters
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
            maxZoom: 19,
            tileSize: 256,
            zoomOffset: 0
          }).addTo(map);

          // Render User's Current GPS Location Marker
          L.marker([${centerLat}, ${centerLng}], { 
            icon: L.divIcon({className: 'user-marker', html: '<div class="pulse"></div>', iconSize: [22, 22], iconAnchor: [11, 11]}) 
          }).addTo(map);
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      originWhitelist={['*']}
      source={{ html: mapHtml }}
      style={{ flex: 1, backgroundColor: 'transparent' }}
      scrollEnabled={false}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled
    />
  );
};

/* ==================================================================== */
/* HomeScreen                                                           */
/* ==================================================================== */
export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  
  // Real-time Location State (Defaults to Cebu City coordinates)
  const [userLocation, setUserLocation] = useState({ lat: 10.3157, lng: 123.8854 });

  // Entrance Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const actionsAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 650) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(actionsAnim, 150),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bellPulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [headerAnim, actionsAnim, bellPulse]);

  // Fetch Real-Time GPS Location
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.warn('Permission to access location was denied. Using default coordinates.');
          return;
        }

        let location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        
        setUserLocation({
          lat: location.coords.latitude,
          lng: location.coords.longitude,
        });
      } catch (error) {
        console.warn('Error fetching location:', error);
      }
    })();
  }, []);

  const handleSendPackage = () => {
    navigation.navigate('DropoffType', { mode: 'sendNow' });
  };

  const handleScheduleDelivery = () => {
    navigation.navigate('DropoffType', { mode: 'schedule' });
  };

  const handleViewNotifications = () => {
    Alert.alert('Coming Soon', 'Notifications will be available in the next update.');
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  const bellScale = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const bellOpacity = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.85],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* TOP HALF: HD Interactive Map Section (Overlaps status bar completely, no orange bg) */}
      <View style={styles.mapContainer}>
        <HomeMap centerLat={userLocation.lat} centerLng={userLocation.lng} />

        {/* Floating Header Overlay (Positioned safely below status bar icons) */}
        <Animated.View 
          style={[
            styles.floatingHeader, 
            { top: Math.max(insets.top + 8, Platform.OS === 'android' ? 36 : 14) }, 
            fadeUp(headerAnim, -14)
          ]}
        >
          <View /> 

          <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }}>
            <TouchableOpacity style={styles.notificationIcon} onPress={handleViewNotifications} activeOpacity={0.8}>
              <Ionicons name="notifications-outline" size={22} color="#111827" />
              <View style={styles.notificationBadge} />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>

      {/* BOTTOM HALF: Professional Minimalist Action Sheet (Clean Neutral Background) */}
      <Animated.View style={[styles.bottomSheet, fadeUp(actionsAnim, 30)]}>
        <View style={styles.sheetDragHandle} />
        
        <View style={styles.actionContainer}>
          <Text style={styles.bottomSheetTitle}>What would you like to do?</Text>

          {/* Send Package Now Card */}
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardPrimary]}
            onPress={handleSendPackage}
            activeOpacity={0.85}
          >
            <View style={styles.actionIconContainer}>
              <Image
                source={require('../../../../assets/send-package-now.png')} 
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
              <Text style={styles.actionSubtitlePrimary}>Instant booking & real-time tracking</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#F27024" />
          </TouchableOpacity>

          {/* Schedule a Delivery Card */}
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardSecondary]}
            onPress={handleScheduleDelivery}
            activeOpacity={0.85}
          >
            <View style={styles.actionIconContainer}>
              <Image
                source={require('../../../../assets/schedule-delivery-calendar.png')} 
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Schedule a Delivery</Text>
              <Text style={styles.actionSubtitle}>Plan shipments for a future date</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mapContainer: {
    flex: 1, 
    position: 'relative',
    backgroundColor: '#E5E7EB',
  },
  floatingHeader: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  notificationBadge: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingTop: 10,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 20,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  sheetDragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center',
    marginBottom: 18,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  actionContainer: {
    paddingHorizontal: 24,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  actionCardPrimary: {
    borderColor: '#F27024',
    backgroundColor: '#FFFFFF',
    shadowColor: '#F27024',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  actionCardSecondary: {
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  actionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  actionCustomIcon: {
    width: 26,
    height: 26,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitlePrimary: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  actionSubtitlePrimary: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 2,
    fontWeight: '400',
  },
  actionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  actionSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 2,
    fontWeight: '400',
  },
});