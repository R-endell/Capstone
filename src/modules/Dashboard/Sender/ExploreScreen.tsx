import React, { useState, useMemo } from 'react';
import { 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  Modal,
  Dimensions,
  FlatList,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
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
  },
  {
    id: '4',
    name: 'Maria Santos',
    status: 'Active',
    rating: 4.7,
    type: 'Curb-side Drop-off',
    pickup: 'SM Seaside Cebu',
    dropoff: 'Ayala Center Cebu',
    accepts: 'Small to Medium box',
    estimate: '₱15.00 - ₱25.00',
    timeLabel: 'Leaves in 5 mins',
    isTimeExact: false,
  },
  {
    id: '5',
    name: 'FastTrack Logistics',
    status: 'Active',
    rating: 4.9,
    type: 'Door-to-door',
    pickup: 'Mactan Airport',
    dropoff: 'IT Park',
    accepts: 'Large box to XL',
    estimate: '₱35.00 - ₱50.00',
    timeLabel: 'Leaves in 30 mins',
    isTimeExact: false,
  },
];

// Mock Data for the Bottom Sheet Shipment Items
const MOCK_SHIPMENT = [
  { id: 's1', size: 'Small', title: 'Small Item #1', desc: 'Flower vase please handle with care thanks.', fragile: true },
  { id: 's2', size: 'Small', title: 'Small Item #2', desc: 'No description.', fragile: false },
  { id: 'm1', size: 'Medium', title: 'Medium Item #1', desc: 'Flat screen TV pls take care', fragile: true },
];

type FilterState = {
  status: 'all' | 'Active' | 'Offline';
  type: 'all' | 'Door-to-door' | 'Curb-side Drop-off';
};

export default function ExploreScreen() {
  const navigation = useNavigation<any>();
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    status: 'all',
    type: 'all',
  });
  const insets = useSafeAreaInsets();

  // Filter logic
  const filteredTrips = useMemo(() => {
    return MOCK_TRIPS.filter((trip) => {
      // Search filter
      const searchLower = search.toLowerCase();
      const matchesSearch = 
        trip.name.toLowerCase().includes(searchLower) ||
        trip.pickup.toLowerCase().includes(searchLower) ||
        trip.dropoff.toLowerCase().includes(searchLower) ||
        trip.type.toLowerCase().includes(searchLower);

      if (!matchesSearch) return false;

      // Status filter
      if (filters.status !== 'all' && trip.status !== filters.status) return false;

      // Type filter
      if (filters.type !== 'all' && trip.type !== filters.type) return false;

      return true;
    });
  }, [search, filters]);

  const resetFilters = () => {
    setFilters({ status: 'all', type: 'all' });
  };

  const hasActiveFilters = filters.status !== 'all' || filters.type !== 'all';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.headerContainer}>
        <Text style={styles.pageTitle}>Explore Trips</Text>

        {/* Search & Filter Row */}
        <View style={styles.searchRow}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={20} color="#9CA3AF" />
            <TextInput
              placeholder="Search by name, pickup, dropoff..."
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity 
            style={[styles.filterBtn, hasActiveFilters && styles.filterBtnActive]} 
            onPress={() => setFilterModalVisible(true)}
          >
            <Ionicons 
              name="options-outline" 
              size={24} 
              color={hasActiveFilters ? '#F27024' : '#374151'} 
            />
            {hasActiveFilters && <View style={styles.filterDot} />}
          </TouchableOpacity>
        </View>

        {/* Active filters display */}
        {hasActiveFilters && (
          <View style={styles.activeFiltersRow}>
            {filters.status !== 'all' && (
              <View style={styles.filterChip}>
                <Text style={styles.filterChipText}>Status: {filters.status}</Text>
                <TouchableOpacity onPress={() => setFilters({ ...filters, status: 'all' })}>
                  <Ionicons name="close-circle" size={14} color="#6B7280" />
                </TouchableOpacity>
              </View>
            )}
            {filters.type !== 'all' && (
              <View style={styles.filterChip}>
                <Text style={styles.filterChipText}>Type: {filters.type}</Text>
                <TouchableOpacity onPress={() => setFilters({ ...filters, type: 'all' })}>
                  <Ionicons name="close-circle" size={14} color="#6B7280" />
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity onPress={resetFilters}>
              <Text style={styles.clearAllText}>Clear All</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionTitle}>Active Trips Heading Your Way</Text>
        <Text style={styles.sectionSubtitle}>
          These riders are already on your path. Save money by matching.
        </Text>
      </View>

      <FlatList
        data={filteredTrips}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.tripCard}>
            {/* Header */}
            <View style={styles.cardHeader}>
              <View style={styles.avatarCircle}>
                <Ionicons name="person" size={24} color="#FFF" />
              </View>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{item.name}</Text>
                <View style={styles.badgesRow}>
                  <View style={[styles.statusBadge, item.status === 'Active' ? styles.statusActive : styles.statusOffline]}>
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                  <Ionicons name="star" size={14} color="#FBBF24" style={{ marginLeft: 6, marginRight: 2 }} />
                  <Text style={styles.ratingText}>{item.rating}</Text>
                  <TouchableOpacity style={styles.chatIcon}>
                    <Ionicons name="chatbubbles-outline" size={14} color="#000" />
                  </TouchableOpacity>
                </View>
              </View>
              <Text style={styles.dropType}>{item.type}</Text>
            </View>

            {/* Timeline */}
            <View style={styles.routeSection}>
              <View style={styles.timeline}>
                <View style={styles.timelinePoint}>
                  <View style={styles.blueDot}><View style={styles.blueDotInner} /></View>
                  <Text style={styles.timelineText} numberOfLines={1}>{item.pickup}</Text>
                </View>
                <View style={styles.timelineLine} />
                <View style={styles.timelinePoint}>
                  <Ionicons name="location" size={18} color="#E11D48" style={{ marginLeft: -1, marginRight: 7 }} />
                  <Text style={styles.timelineText} numberOfLines={1}>{item.dropoff}</Text>
                </View>
              </View>

              {/* Mini Map */}
              <View style={styles.miniMap}>
                <View style={styles.mapGridLineH} />
                <View style={styles.mapGridLineV} />
                <View style={styles.miniMapPin} />
              </View>
            </View>

            <View style={styles.divider} />

            {/* Footer */}
            <View style={styles.cardFooter}>
              <View style={styles.footerLeft}>
                <Text style={styles.footerLabel}>Accepts</Text>
                <Text style={styles.acceptsText}>{item.accepts}</Text>
                <View style={styles.timeRow}>
                  <Ionicons name={item.isTimeExact ? "calendar-outline" : "timer-outline"} size={14} color="#000" />
                  <Text style={styles.timeText}>{item.timeLabel}</Text>
                </View>
              </View>
              <View style={styles.footerRight}>
                <Text style={styles.footerLabel}>Estimate</Text>
                <Text style={styles.estimateText}>{item.estimate}</Text>
                <TouchableOpacity onPress={() => setSelectedProvider(item)}>
                  <Text style={styles.bookBtnText}>Book this Provider</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>No trips found</Text>
            <Text style={styles.emptySubtext}>Try adjusting your search or filters</Text>
          </View>
        }
      />

      {/* FILTER MODAL */}
      <Modal
        visible={filterModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            onPress={() => setFilterModalVisible(false)} 
            activeOpacity={1}
          />
          <View style={[styles.filterModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setFilterModalVisible(false)}>
                <Ionicons name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Status</Text>
              <View style={styles.filterOptionsRow}>
                {['all', 'Active', 'Offline'].map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.filterOption,
                      filters.status === status && styles.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, status: status as any })}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.status === status && styles.filterOptionTextActive,
                      ]}
                    >
                      {status === 'all' ? 'All' : status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>Type</Text>
              <View style={styles.filterOptionsRow}>
                {['all', 'Door-to-door', 'Curb-side Drop-off'].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.filterOption,
                      filters.type === type && styles.filterOptionActive,
                    ]}
                    onPress={() => setFilters({ ...filters, type: type as any })}
                  >
                    <Text
                      style={[
                        styles.filterOptionText,
                        filters.type === type && styles.filterOptionTextActive,
                      ]}
                    >
                      {type === 'all' ? 'All' : type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity 
              style={styles.applyFiltersBtn}
              onPress={() => setFilterModalVisible(false)}
            >
              <Text style={styles.applyFiltersBtnText}>Apply Filters</Text>
            </TouchableOpacity>

            {hasActiveFilters && (
              <TouchableOpacity onPress={resetFilters} style={styles.resetFiltersBtn}>
                <Text style={styles.resetFiltersBtnText}>Reset Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* BOTTOM SHEET MODAL (Match) */}
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
    marginBottom: 12,
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
    position: 'relative',
  },
  filterBtnActive: {
    borderColor: '#F27024',
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F27024',
  },
  activeFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 6,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    gap: 4,
  },
  filterChipText: {
    fontSize: 12,
    color: '#374151',
  },
  clearAllText: {
    fontSize: 12,
    color: '#F27024',
    fontWeight: '600',
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
    paddingBottom: 100,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },

  // Filter Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  filterModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: height * 0.6,
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  filterModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  filterSection: {
    marginBottom: 20,
  },
  filterSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 10,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  filterOptionActive: {
    borderColor: '#F27024',
    backgroundColor: '#FFF7ED',
  },
  filterOptionText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  filterOptionTextActive: {
    color: '#F27024',
    fontWeight: '700',
  },
  applyFiltersBtn: {
    backgroundColor: '#F27024',
    borderRadius: 30,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  applyFiltersBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  resetFiltersBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  resetFiltersBtnText: {
    color: '#6B7280',
    fontWeight: '600',
    fontSize: 14,
  },

  // Bottom Sheet
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
});