import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  SafeAreaView, 
  ScrollView, 
  TouchableOpacity,
  Platform,
  StatusBar 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview'; // <-- NEW IMPORT

// Inline helper component for the free OpenStreetMap
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

// Mock data for tasks
const UNFINISHED_TASKS = [
  {
    id: '1',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    status: 'Unfinished',
    pickup: {
      name: 'Landers Superstore Cebu',
      address: 'Skyrise 4 Tower, Geonzon Street. cor V. Padriga Street, Cebu City',
      lat: 10.3288,
      lng: 123.9050,
    },
    dropoff: {
      name: 'Gaisano Country Mall',
      address: 'Gov. M. Cuenca Ave Main Entrance',
      lat: 10.3396,
      lng: 123.9109,
    },
    price: '₱53.00'
  }
];

const COMPLETED_TASKS = [
  {
    id: '2',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    status: 'Completed',
    pickup: {
      name: 'Landers Superstore Cebu',
      address: 'Skyrise 4 Tower, Geonzon Street. cor V. Padriga Street, Cebu City',
      lat: 10.3288,
      lng: 123.9050,
    },
    dropoff: {
      name: 'Gaisano Country Mall',
      address: 'Gov. M. Cuenca Ave Main Entrance',
      lat: 10.3396,
      lng: 123.9109,
    },
    price: '₱24.00'
  },
  {
    id: '3',
    type: 'Curb-side Drop-off',
    date: 'April 25, 2026',
    time: '6:40 PM',
    status: 'Completed',
    pickup: {
      name: 'Landers Superstore Cebu',
      address: 'Skyrise 4 Tower, Geonzon Street. cor V. Padriga Street, Cebu City',
      lat: 10.3288,
      lng: 123.9050,
    },
    dropoff: {
      name: 'Gaisano Country Mall',
      address: 'Gov. M. Cuenca Ave Main Entrance',
      lat: 10.3396,
      lng: 123.9109,
    },
    price: '₱67.00'
  }
];

export default function TaskScreen() {
  const renderTaskCard = (task: any) => {
    const isCompleted = task.status === 'Completed';

    return (
      <View key={task.id} style={styles.taskCard}>
        {/* Header Row */}
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.taskType}>{task.type}</Text>
            <Text style={styles.taskDateTime}>
              {task.date}   {task.time}
            </Text>
          </View>
          <View style={[styles.statusBadge, isCompleted ? styles.statusCompleted : styles.statusUnfinished]}>
            <Text style={[styles.statusText, isCompleted ? styles.statusTextCompleted : styles.statusTextUnfinished]}>
              {task.status}
            </Text>
          </View>
        </View>

        {/* Location Row with Mini Map */}
        <View style={styles.locationSection}>
          <View style={styles.locationDetails}>
            
            {/* Pickup */}
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="radio-button-on" size={18} color="#0000FF" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>{task.pickup.name}</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{task.pickup.address}</Text>
              </View>
            </View>

            {/* Connecting Line */}
            <View style={styles.connectingLine} />

            {/* Dropoff */}
            <View style={styles.locationItem}>
              <View style={styles.iconWrapper}>
                <Ionicons name="location" size={18} color="#D90429" />
              </View>
              <View style={styles.locationTextWrapper}>
                <Text style={styles.locationName}>{task.dropoff.name}</Text>
                <Text style={styles.locationAddress} numberOfLines={2}>{task.dropoff.address}</Text>
              </View>
            </View>

          </View>

          {/* Mini Map using WebView */}
          <View style={styles.miniMapWrapper}>
            <LeafletMap lat={task.pickup.lat} lng={task.pickup.lng} zoom={14} />
          </View>
        </View>

        <View style={styles.divider} />

        {/* Footer */}
        <View style={styles.cardFooter}>
          <TouchableOpacity>
            <Text style={styles.viewTaskBtn}>View Task</Text>
          </TouchableOpacity>
          <Text style={styles.priceText}>{task.price}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        
        {/* Main Header */}
        <View style={styles.header}>
          <Text style={styles.pageTitle}>Task</Text>
          <Text style={styles.pageSubtitle}>You have {UNFINISHED_TASKS.length} task today</Text>
        </View>

        {/* Unfinished Section */}
        <View style={styles.section}>
          {UNFINISHED_TASKS.map(renderTaskCard)}
        </View>

        {/* Completed Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Completed</Text>
          {COMPLETED_TASKS.map(renderTaskCard)}
        </View>

        {/* Bottom padding for scrolling */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
  },
  header: {
    marginTop: Platform.OS === 'android' ? 85 : 10,
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 35,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 18,
    color: '#111827',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  taskType: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  taskDateTime: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusUnfinished: {
    backgroundColor: '#E5E7EB',
  },
  statusCompleted: {
    backgroundColor: '#86EFAC', 
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextUnfinished: {
    color: '#374151',
  },
  statusTextCompleted: {
    color: '#166534',
  },
  locationSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  locationDetails: {
    flex: 1,
    marginRight: 12,
    position: 'relative',
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  iconWrapper: {
    width: 24,
    alignItems: 'center',
    marginRight: 8,
    zIndex: 2,
    backgroundColor: '#FFF',
  },
  connectingLine: {
    position: 'absolute',
    left: 11, // centers line under the 24px iconWrapper
    top: 20,
    bottom: 30,
    width: 1,
    backgroundColor: '#D1D5DB',
    zIndex: 1,
  },
  locationTextWrapper: {
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  locationAddress: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 14,
  },
  miniMapWrapper: {
    width: 90,
    height: 70,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  viewTaskBtn: {
    color: '#F27024',
    fontSize: 15,
    fontWeight: '500',
  },
  priceText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
});