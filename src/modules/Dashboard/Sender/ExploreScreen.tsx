import React, { useState } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  StyleSheet, 
  Modal,
  Image,
  Dimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
const { height } = Dimensions.get('window');

// Mock Data for Trips
const MOCK_TRIPS = [
  {
    id: '1',
    name: 'Jun Joseph Pestaño',
    status: 'Active',
    rating: 4.9,
    type: 'Door-to-door',
    pickup: 'Landers Superstore Cebu',
    dropoff: 'Gaisano Country Mall',
    accepts: 'Medium Box to Large box',
    estimate: '₱20.00 - ₱36.00',
    timeLabel: 'Leaves in 14 mins',
    isTimeExact: false,
  },
  {
    id: '2',
    name: 'Darwin Otida',
    status: 'Offline',
    rating: 4.9,
    type: 'Curb-side Drop-off',
    pickup: 'Landers Superstore Cebu',
    dropoff: 'Gaisano Country Mall',
    accepts: 'Medium Box to Large box',
    estimate: '₱20.00 - ₱36.00',
    timeLabel: 'Today at 10:30 AM',
    isTimeExact: true,
  },
  {
    id: '3',
    name: 'Adrian Paul Lucernas',
    status: 'Active',
    rating: 4.9,
    type: 'Door-to-door',
    pickup: 'Landers Superstore Cebu',
    dropoff: 'Gaisano Country Mall',
    accepts: 'Medium Box to Large box',
    estimate: '₱20.00 - ₱36.00',
    timeLabel: 'Leaves in 14 mins',
    isTimeExact: false,
  }
];

// Mock Data for the Bottom Sheet Shipment Items
const MOCK_SHIPMENT = [
  { id: 's1', size: 'Small', title: 'Small Item #1', desc: 'Flower vase please handle with care thanks.', fragile: true },
  { id: 's2', size: 'Small', title: 'Small Item #2', desc: 'No description.', fragile: false },
  { id: 'm1', size: 'Medium', title: 'Medium Item #1', desc: 'Flat screen TV pls take care', fragile: true },
];

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const insets = useSafeAreaInsets();

  const handleNavigateToHome = () => {
    navigation.navigate('Home');
  };

  const handleNavigateToAccount = () => {
    navigation.navigate('Account');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerContainer}>
        <Text style={styles.pageTitle}>Explore Trips</Text>

        {/* Search & Filter Row */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color="#9CA3AF" />
            <TextInput
              placeholder="Search..."
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
            />
          </View>
          <TouchableOpacity style={styles.filterBtn}>
            <Ionicons name="options-outline" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Active Trips Heading Your Way</Text>
        <Text style={styles.sectionSubtitle}>
          These riders are already on your path. Save money by matching.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.listContainer} showsVerticalScrollIndicator={false}>
        {MOCK_TRIPS.map((trip) => (
          <View key={trip.id} style={styles.tripCard}>
            
            {/* Header: Avatar, Name, Badges, Type */}
            <View style={styles.cardHeader}>
              <View style={styles.avatarCircle}>
                <Ionicons name="person" size={24} color="#FFF" />
              </View>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{trip.name}</Text>
                <View style={styles.badgesRow}>
                  <View style={[styles.statusBadge, trip.status === 'Active' ? styles.statusActive : styles.statusOffline]}>
                    <Text style={styles.statusText}>{trip.status}</Text>
                  </View>
                  <Ionicons name="star" size={14} color="#FBBF24" style={{ marginLeft: 6, marginRight: 2 }} />
                  <Text style={styles.ratingText}>{trip.rating}</Text>
                  <TouchableOpacity style={styles.chatIcon}>
                    <Ionicons name="chatbubbles-outline" size={14} color="#000" />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.dropType}>{trip.type}</Text>
            </View>

            {/* Timeline & Mini Map */}
            <View style={styles.routeSection}>
              <View style={styles.timeline}>
                <View style={styles.timelinePoint}>
                  <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
                  <Text style={styles.timelineText} numberOfLines={1}>{trip.pickup}</Text>
                </View>
                <View style={styles.timelineLine} />
                <View style={styles.timelinePoint}>
                  <Ionicons name="location" size={18} color="#E11D48" style={{ marginLeft: -1, marginRight: 7 }} />
                  <Text style={styles.timelineText} numberOfLines={1}>{trip.dropoff}</Text>
                </View>
              </View>

              {/* Mini Map Placeholder */}
              <View style={styles.miniMap}>
                <View style={styles.mapGridLineH} />
                <View style={styles.mapGridLineV} />
                <View style={styles.miniMapPin} />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Footer details */}
            <View style={styles.cardFooter}>
              <View style={styles.footerLeft}>
                <Text style={styles.footerLabel}>Accepts</Text>
                <Text style={styles.acceptsText}>{trip.accepts}</Text>
                <View style={styles.timeRow}>
                  <Ionicons name={trip.isTimeExact ? "calendar-outline" : "timer-outline"} size={14} color="#000" />
                  <Text style={styles.timeText}>{trip.timeLabel}</Text>
                </View>
              </View>

              <View style={styles.footerRight}>
                <Text style={styles.footerLabel}>Estimate</Text>
                <Text style={styles.estimateText}>{trip.estimate}</Text>
                <TouchableOpacity onPress={() => setSelectedProvider(trip)}>
                  <Text style={styles.bookBtnText}>Book this Provider</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}
        
        {/* Bottom spacer for tab bar */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* MATCH MODAL (BOTTOM SHEET) */}
      <Modal
        visible={!!selectedProvider}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedProvider(null)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setSelectedProvider(null)} />
          
          <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
            {selectedProvider && (
              <>
                <Text style={styles.modalTitle}>Match with {selectedProvider.name.split(' ')[0]}?</Text>
                <Text style={styles.modalDesc}>
                  {selectedProvider.name.split(' ')[0]} is traveling to <Text style={{fontWeight: '700'}}>Gaisano Country Mall</Text>. If you are also sending a package near this location, you can match to save.
                </Text>

                <View style={styles.shipmentHeaderRow}>
                  <View style={styles.orangeBoxIcon}>
                     <Ionicons name="cube" size={24} color="#FFF" />
                  </View>
                  <Text style={styles.shipmentHeader}>What's in your shipment?</Text>
                </View>

                {/* Size Selectors */}
                <View style={styles.sizeSelectorRow}>
                  <View style={styles.sizeBox}>
                    <Ionicons name="cube-outline" size={24} color="#9CA3AF" />
                    <Text style={styles.sizeText}>Small</Text>
                  </View>
                  <View style={styles.sizeBox}>
                    <Ionicons name="cube-outline" size={30} color="#9CA3AF" />
                    <Text style={styles.sizeText}>Medium</Text>
                  </View>
                  <View style={styles.sizeBox}>
                    <Ionicons name="cube-outline" size={36} color="#9CA3AF" />
                    <Text style={styles.sizeText}>Large</Text>
                  </View>
                </View>

                <Text style={styles.itemsCount}>Shipment Items (3)</Text>

                {/* Items List */}
                <ScrollView style={styles.itemsList} showsVerticalScrollIndicator={false}>
                  {MOCK_SHIPMENT.map((item, index) => (
                    <View key={index} style={styles.itemRowCard}>
                      <View style={styles.itemGraySquare} />
                      <View style={styles.itemDetails}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.itemTitle}>{item.title}</Text>
                          {item.fragile && <Text style={styles.itemFragile}>Fragile</Text>}
                        </View>
                        <Text style={styles.itemDesc} numberOfLines={1}>{item.desc}</Text>
                      </View>
                      <TouchableOpacity>
                        <Text style={styles.removeText}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </ScrollView>

                {/* Total & Action */}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Estimated Total</Text>
                  <Text style={styles.totalPrice}>₱54.00</Text>
                </View>

                <TouchableOpacity style={styles.sendRequestBtn} onPress={() => setSelectedProvider(null)}>
                  <Text style={styles.sendRequestBtnText}>Send Request to Match</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity 
          style={styles.navItem} 
          onPress={handleNavigateToHome}
        >
          <Ionicons name="home-outline" size={28} color="#6B7280" />
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.navItem} 
          onPress={handleNavigateToAccount}
        >
          <Ionicons name="person-outline" size={28} color="#6B7280" />
          <Text style={styles.navLabel}>Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },
  headerContainer: {
    paddingHorizontal: 20,
    paddingTop: 25,
    backgroundColor: '#FAFAFA',
    zIndex: 1,
  },
  pageTitle: { 
    fontSize: 30, 
    fontWeight: '800', 
    color: '#000000',
    marginBottom: 16
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#000',
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionTitle: { 
    fontSize: 15, 
    fontWeight: '800', 
    color: '#000',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 16,
    lineHeight: 16,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  bottomSpacer: {
    height: 80,
  },
  tripCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  providerInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  statusActive: { backgroundColor: '#A3E635' },
  statusOffline: { backgroundColor: '#D1D5DB' },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#111827',
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#000',
    marginRight: 8,
  },
  chatIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropType: {
    fontSize: 10,
    color: '#374151',
  },
  routeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  timeline: {
    flex: 1,
    paddingRight: 16,
  },
  timelinePoint: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  blueDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: '#0000CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  blueDotInner: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#0000CC' },
  timelineLine: {
    width: 1,
    height: 16,
    backgroundColor: '#D1D5DB',
    marginLeft: 6,
    marginVertical: 4,
  },
  timelineText: {
    fontSize: 12,
    color: '#111827',
  },
  miniMap: {
    width: 80,
    height: 60,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  mapGridLineH: { position: 'absolute', width: '100%', height: 2, backgroundColor: '#E5E7EB', top: '50%' },
  mapGridLineV: { position: 'absolute', height: '100%', width: 2, backgroundColor: '#E5E7EB', left: '50%' },
  miniMapPin: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3B82F6' },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerLeft: { flex: 1 },
  footerRight: { alignItems: 'flex-end' },
  footerLabel: {
    fontSize: 9,
    color: '#6B7280',
    marginBottom: 2,
  },
  acceptsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
    marginLeft: 4,
  },
  estimateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  bookBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FA7A25',
  },

  // --- Modal / Bottom Sheet Styles ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: height * 0.85,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000',
    marginBottom: 8,
  },
  modalDesc: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
    marginBottom: 20,
  },
  shipmentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  orangeBoxIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    transform: [{ rotate: '-10deg' }],
  },
  shipmentHeader: {
    fontSize: 18,
    fontWeight: '800',
    color: '#000',
  },
  sizeSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  sizeBox: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    borderRadius: 8,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  sizeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000',
    marginTop: 6,
  },
  itemsCount: {
    fontSize: 11,
    color: '#374151',
    marginBottom: 8,
  },
  itemsList: {
    maxHeight: 220,
    marginBottom: 20,
  },
  itemRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  itemGraySquare: {
    width: 32,
    height: 32,
    backgroundColor: '#D1D5DB',
    borderRadius: 6,
    marginRight: 12,
  },
  itemDetails: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#000',
    marginRight: 6,
  },
  itemFragile: {
    fontSize: 8,
    color: '#EF4444',
    fontStyle: 'italic',
  },
  itemDesc: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 2,
  },
  removeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#EF4444',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  totalLabel: {
    fontSize: 14,
    color: '#374151',
  },
  totalPrice: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
  },
  sendRequestBtn: {
    backgroundColor: '#A3E635',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  sendRequestBtnText: {
    color: '#064E3B',
    fontSize: 15,
    fontWeight: '600',
  },

  // Bottom Navigation
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingVertical: 10,
    paddingBottom: 10,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  navItem: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  navLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
});