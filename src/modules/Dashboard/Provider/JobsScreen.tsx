import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Switch, SafeAreaView, Platform, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';

// A local helper component to render the free OpenStreetMap via WebView
const LeafletMap = ({ lat, lng, zoom }: { lat: number, lng: number, zoom: number }) => {
  const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #E5E7EB; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            touchZoom: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
          }).setView([${lat}, ${lng}], ${zoom});

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
          }).addTo(map);

          // Add a blue location dot
          var marker = L.circleMarker([${lat}, ${lng}], {
            radius: 8,
            fillColor: "#3B82F6",
            color: "#FFFFFF",
            weight: 2,
            opacity: 1,
            fillOpacity: 1
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
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    />
  );
};


export default function JobsScreen() {
  const [isOnline, setIsOnline] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Jobs</Text>
          <Image 
            source={require('../../../../assets/Car-Grey.png')}
            style={styles.carImage}
            resizeMode="contain"
          />
        </View>

        {/* Map Area using WebView */}
        <View style={styles.mapContainer}>
          <LeafletMap lat={10.3188} lng={123.9050} zoom={15} />
        </View>

        {/* Bottom Overlay / Dashboard */}
        <View style={styles.bottomOverlay}>
          {/* Vehicle Info & Status Toggle */}
          <View style={styles.statusRow}>
            <View style={styles.vehicleInfo}>
              <Ionicons name="car-sport" size={36} color="#000" />
              <View style={styles.vehicleTextContainer}>
                <Text style={styles.vehicleName}>Toyota Vios 2022</Text>
                <Text style={styles.vehiclePlate}>SCV-4312</Text>
              </View>
            </View>

            <View style={styles.toggleContainer}>
              <Text style={styles.toggleText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
              <Switch
                trackColor={{ false: '#D1D5DB', true: '#34C759' }}
                thumbColor={'#ffffff'}
                ios_backgroundColor="#D1D5DB"
                onValueChange={() => setIsOnline(!isOnline)}
                value={isOnline}
                style={{ transform: [{ scaleX: 0.9 }, { scaleY: 0.9 }] }}
              />
            </View>
          </View>

          {/* Travel & Earn Card */}
          <TouchableOpacity 
            style={styles.travelCard} 
            activeOpacity={0.9}
            onPress={() => setModalVisible(true)}
          >
            <View style={styles.addIconContainer}>
              <Ionicons name="add" size={28} color="#000" />
            </View>
            <View style={styles.travelTextContainer}>
              <Text style={styles.travelTitle}>Travel & Earn</Text>
              <Text style={styles.travelDescription}>
                Register your One off trip route to pick up packages on your way and maximize your earnings.
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Travel & Earn Modal */}
        <Modal
          animationType="fade"
          transparent={true}
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              
              {/* Modal Header */}
              <TouchableOpacity 
                style={styles.modalBackButton}
                onPress={() => setModalVisible(false)}
              >
                <Ionicons name="arrow-back" size={28} color="#000" />
              </TouchableOpacity>

              {/* Mini Map using WebView */}
              <View style={styles.miniMapContainer}>
                <LeafletMap lat={10.3396} lng={123.9109} zoom={14} />
              </View>

              {/* Location Selectors */}
              <View style={styles.locationSelectorsRow}>
                <TouchableOpacity style={styles.locationSelectorBtn}>
                  <Ionicons name="radio-button-on" size={18} color="#0000FF" />
                  <Text style={styles.locationSelectorText}>Starting Point</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.locationSelectorBtn}>
                  <Ionicons name="location" size={18} color="#FF0000" />
                  <Text style={styles.locationSelectorText}>Destination</Text>
                </TouchableOpacity>
              </View>

              {/* Date & Time Row */}
              <View style={styles.dateTimeRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Date</Text>
                  <View style={styles.inputField}>
                    <Text style={styles.inputText}>May 15, 2026</Text>
                    <Ionicons name="pencil" size={16} color="#000" />
                  </View>
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Departure Time</Text>
                  <View style={styles.inputField}>
                    <Text style={styles.inputText}>7:00 AM - 6:30 PM</Text>
                    <Ionicons name="pencil" size={16} color="#000" />
                  </View>
                </View>
              </View>

              {/* Vehicle Selection */}
              <View style={styles.vehicleInputGroup}>
                <Text style={styles.inputLabel}>Vehicle</Text>
                <View style={styles.vehicleInputField}>
                  <View style={styles.vehicleInputLeft}>
                    <Ionicons name="car-sport" size={20} color="#000" />
                    <Text style={styles.vehicleInputText}>Toyota Vios 2022</Text>
                  </View>
                  <Text style={styles.vehicleInputPlate}>SCV-4312</Text>
                </View>
              </View>

              {/* Info Banner */}
              <View style={styles.infoBanner}>
                <Ionicons name="information-circle" size={20} color="#000" style={styles.infoIcon} />
                <Text style={styles.infoText}>
                  By posting your route, our system will prioritize showing you jobs that are within a 2km radius of your path.
                </Text>
              </View>

              {/* Action Button */}
              <TouchableOpacity style={styles.finishBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.finishBtnText}>Finish Posting</Text>
              </TouchableOpacity>

            </View>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F27024', 
  },
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    backgroundColor: '#F27024',
    height: 180,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 30 : 0,
    overflow: 'hidden',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 1,
  },
  carImage: {
    position: 'absolute',
    right: -15,   
    bottom: -15,  
    width: 250,   
    height: 130,  
    zIndex: 1,
  },
  mapContainer: {
    flex: 1,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleTextContainer: {
    marginLeft: 12,
  },
  vehicleName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  vehiclePlate: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginRight: 8,
  },
  travelCard: {
    backgroundColor: '#222222',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  addIconContainer: {
    width: 50,
    height: 50,
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  travelTextContainer: {
    flex: 1,
  },
  travelTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  travelDescription: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    width: '85%',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalBackButton: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  miniMapContainer: {
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  locationSelectorsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  locationSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 3,
    width: '48%',
    justifyContent: 'center',
  },
  locationSelectorText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },
  dateTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  inputGroup: {
    width: '48%',
  },
  inputLabel: {
    fontSize: 12,
    color: '#111827',
    marginBottom: 4,
    fontWeight: '500',
  },
  inputField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputText: {
    fontSize: 13,
    color: '#111827',
  },
  vehicleInputGroup: {
    marginBottom: 16,
  },
  vehicleInputField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  vehicleInputLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  vehicleInputText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
  },
  vehicleInputPlate: {
    fontSize: 13,
    color: '#6B7280',
  },
  infoBanner: {
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    marginBottom: 20,
  },
  infoIcon: {
    marginRight: 8,
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
  },
  finishBtn: {
    backgroundColor: '#F27024',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    width: '70%',
    alignSelf: 'center',
  },
  finishBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});