// src/modules/Dashboard/Sender/Delivery/DeliveryListScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator,
  Animated, Image, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { supabase } from '../../../../utils/supabase';
import { deleteDelivery } from './scheduleService';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

const PendingPulse = ({ styles }: any) => {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);
  return (
    <View style={styles.pendingBadge}>
      <Animated.Text style={{ color: '#D97706', fontWeight: '600', fontSize: 11, opacity: pulseAnim }}>
        Looking for provider…
      </Animated.Text>
    </View>
  );
};

const EmptyState = ({ status, styles, colors }: any) => {
  const isActive = status === 'Accepted';
  return (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons
          name={isActive ? 'car-sport-outline' : 'calendar-outline'}
          size={48}
          color={colors.textMuted}
        />
      </View>
      <Text style={styles.emptyTitle}>
        {isActive ? 'No Active Deliveries' : 'No Scheduled Deliveries'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {isActive
          ? 'Your active deliveries will appear here once accepted by a provider.'
          : 'Schedule a delivery and it will show up here.'}
      </Text>
      {!isActive && (
        <TouchableOpacity style={styles.emptyActionBtn}>
          <Ionicons name="add-circle-outline" size={20} color="#FFF" />
          <Text style={styles.emptyActionText}>Schedule Delivery</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default function DeliveryListScreen({ route, navigation }: any) {
  const { status } = route.params || {};
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState<any>(null);

  const fetchDeliveries = async () => {
    if (status === 'Accepted') {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
      if (!userRecord) { setLoading(false); return; }

      const { data } = await supabase
        .from('delivery_requests')
        .select(`
          request_id, pickup_type, delivery_status, scheduled_time, estimated_cost,
          cargo_profiles ( cargo_id, cargo_pic, description, small_box_qty, medium_box_qty, large_box_qty, is_fragile ),
          pickup_location:locations!delivery_requests_pickup_location_id_fkey ( location_id, street_address, latitude, longitude ),
          dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( location_id, street_address, latitude, longitude )
        `)
        .eq('sender_id', userRecord.user_id)
        .eq('delivery_status', 'Accepted')
        .order('created_at', { ascending: false });
      setDeliveries(data || []);
      setLoading(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
    if (!userRecord) { setLoading(false); return; }

    const { data } = await supabase
      .from('delivery_requests')
      .select(`
        request_id, pickup_type, delivery_status, scheduled_time, estimated_cost,
        cargo_profiles ( cargo_id, cargo_pic, description, small_box_qty, medium_box_qty, large_box_qty, is_fragile ),
        pickup_location:locations!delivery_requests_pickup_location_id_fkey ( location_id, street_address, latitude, longitude ),
        dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( location_id, street_address, latitude, longitude )
      `)
      .eq('sender_id', userRecord.user_id)
      .eq('delivery_status', 'Pending')
      .order('created_at', { ascending: false });
    setDeliveries(data || []);
    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', fetchDeliveries);
    return unsubscribe;
  }, []);

  const handleDelete = (item: any) => {
    Alert.alert(
      'Delete Delivery',
      'Are you sure you want to delete this delivery? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeletingId(item.request_id);
            try {
              if (status === 'Pending') {
                await deleteDelivery(
                  item.request_id,
                  item.cargo_profiles.cargo_id,
                  item.pickup_location.location_id,
                  item.dropoff_location.location_id
                );
              } else {
                setDeliveries(prev => prev.filter(d => d.request_id !== item.request_id));
              }
              fetchDeliveries();
            } catch (error: any) {
              Alert.alert('Delete Failed', error.message || 'Could not delete delivery.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ]
    );
  };

  const handleEdit = (item: any) => {
    navigation.navigate('ScheduleDelivery', {
      editData: item,
      mode: item.scheduled_time ? 'schedule' : 'sendNow',
    });
  };

  const handleTrackDelivery = (item: any) => {
    setSelectedDelivery(item);
  };

  const renderItem = ({ item }: any) => {
    const pickup = item.pickup_location;
    const dropoff = item.dropoff_location;
    const cargo = item.cargo_profiles || {};
    const provider = item.provider || null;
    const isActive = status === 'Accepted';

    return (
      <View style={styles.card}>
        <View style={[styles.statusBanner, { backgroundColor: isActive ? colors.successBg : colors.warningBg }]}>
          <View style={styles.statusBannerContent}>
            <View style={[styles.statusDot, { backgroundColor: isActive ? colors.success : colors.warning }]} />
            <Text style={[styles.statusText, { color: isActive ? colors.success : colors.warning }]}>
              {isActive ? 'Active Delivery' : 'Awaiting Provider'}
            </Text>
          </View>
          <Text style={styles.deliveryIdBadge}>#{item.request_id}</Text>
        </View>

        <MapView
          style={styles.miniMap}
          scrollEnabled={false}
          zoomEnabled={false}
          initialRegion={{
            latitude: pickup.latitude,
            longitude: pickup.longitude,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
        >
          <Marker coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }}>
            <View style={styles.markerPickup}>
              <Ionicons name="location" size={16} color="#FFF" />
            </View>
          </Marker>
          <Marker coordinate={{ latitude: dropoff.latitude, longitude: dropoff.longitude }}>
            <View style={styles.markerDropoff}>
              <Ionicons name="flag" size={14} color="#FFF" />
            </View>
          </Marker>
          <Polyline
            coordinates={[
              { latitude: pickup.latitude, longitude: pickup.longitude },
              { latitude: dropoff.latitude, longitude: dropoff.longitude },
            ]}
            strokeColor="#F27024"
            strokeWidth={3}
          />
        </MapView>

        <View style={styles.cardBody}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.pickupTypeChip}>
              <Ionicons
                name={item.pickup_type === 'Door-to-door' ? 'home-outline' : 'cube-outline'}
                size={14}
                color={colors.accent}
              />
              <Text style={styles.pickupTypeText}>{item.pickup_type}</Text>
            </View>
            <Text style={styles.headerCost}>₱{item.estimated_cost.toFixed(2)}</Text>
          </View>

          <View style={styles.routeTimeline}>
            <View style={styles.routePoint}>
              <View style={styles.routeDotPickup}>
                <View style={styles.routeDotInner} />
              </View>
              <View style={styles.routeContent}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeText} numberOfLines={2}>{pickup.street_address}</Text>
              </View>
            </View>

            <View style={styles.routeLineContainer}>
              <View style={styles.routeLine} />
              {isActive && (
                <View style={styles.routeProgress}>
                  <Ionicons name="car-sport-outline" size={14} color={colors.accent} />
                </View>
              )}
            </View>

            <View style={styles.routePoint}>
              <View style={styles.routeDotDropoff}>
                <View style={styles.routeDotInner} />
              </View>
              <View style={styles.routeContent}>
                <Text style={styles.routeLabel}>DROPOFF</Text>
                <Text style={styles.routeText} numberOfLines={2}>{dropoff.street_address}</Text>
              </View>
            </View>
          </View>

          <View style={styles.cargoSection}>
            <Text style={styles.sectionTitle}>Package Details</Text>
            {cargo.cargo_pic ? (
              <Image source={{ uri: cargo.cargo_pic }} style={styles.cargoPhoto} />
            ) : null}
            <Text style={styles.cargoDescription}>{cargo.description || 'No description'}</Text>

            <View style={styles.itemSizes}>
              <View style={styles.sizeChip}><Text style={styles.sizeChipText}>Small: {cargo.small_box_qty || 0}</Text></View>
              <View style={styles.sizeChip}><Text style={styles.sizeChipText}>Medium: {cargo.medium_box_qty || 0}</Text></View>
              <View style={styles.sizeChip}><Text style={styles.sizeChipText}>Large: {cargo.large_box_qty || 0}</Text></View>
            </View>

            {cargo.is_fragile && (
              <View style={styles.fragileBadge}>
                <Ionicons name="warning-outline" size={12} color={colors.error} />
                <Text style={styles.fragileText}>Fragile Items</Text>
              </View>
            )}
          </View>

          {item.scheduled_time && (
            <View style={styles.scheduleSection}>
              <Ionicons name="calendar-outline" size={16} color={colors.accent} />
              <Text style={styles.scheduleText}>
                {new Date(item.scheduled_time).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </Text>
            </View>
          )}

          {provider && (
            <View style={styles.providerCard}>
              <View style={styles.providerHeader}>
                <View style={styles.providerAvatarCircle}>
                  <Ionicons name="person" size={20} color="#FFFFFF" />
                </View>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>{provider.name}</Text>
                  <View style={styles.providerMeta}>
                    <Ionicons name="car-sport-outline" size={12} color={colors.textSecondary} />
                    <Text style={styles.providerMetaText}>{provider.vehicle} · {provider.plate}</Text>
                  </View>
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={12} color={colors.warning} />
                    <Text style={styles.ratingText}>{provider.rating}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.providerActions}>
                <TouchableOpacity style={styles.callBtn}>
                  <Ionicons name="call-outline" size={18} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.messageBtn}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isActive && (
            <TouchableOpacity style={styles.trackButton} onPress={() => handleTrackDelivery(item)}>
              <Ionicons name="navigate-outline" size={18} color="#FFF" />
              <Text style={styles.trackButtonText}>Track Delivery</Text>
            </TouchableOpacity>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.editBtn} onPress={() => handleEdit(item)}>
              <Ionicons name="create-outline" size={16} color="#FFF" />
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item)}
              disabled={deletingId === item.request_id}
            >
              {deletingId === item.request_id ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="trash-outline" size={16} color="#FFF" />
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} />
        <View style={styles.headerSection}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={22} color="#FFF" />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerTitle}>
                {status === 'Pending' ? 'Scheduled Deliveries' : 'Active Deliveries'}
              </Text>
              <Text style={styles.headerSubtitle}>Loading your deliveries...</Text>
            </View>
          </View>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} />

      <View style={styles.headerSection}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>
              {status === 'Pending' ? 'Scheduled Deliveries' : 'Active Deliveries'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {deliveries.length} {deliveries.length === 1 ? 'delivery' : 'deliveries'} found
            </Text>
          </View>
        </View>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>{deliveries.length}</Text>
        </View>
      </View>

      {deliveries.length > 0 && (
        <View style={styles.summaryContainer}>
          <View style={styles.summaryCard}>
            <Ionicons name="cash-outline" size={20} color={colors.success} />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Total Cost</Text>
              <Text style={styles.summaryValue}>
                ₱{deliveries.reduce((sum: number, d: any) => sum + d.estimated_cost, 0).toFixed(2)}
              </Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Ionicons name="cube-outline" size={20} color="#3B82F6" />
            <View style={styles.summaryContent}>
              <Text style={styles.summaryLabel}>Packages</Text>
              <Text style={styles.summaryValue}>{deliveries.length}</Text>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={deliveries}
        keyExtractor={(item) => item.request_id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState status={status} styles={styles} colors={colors} />}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  headerSection: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 20,
    backgroundColor: c.accent,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  backButton: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 12, color: '#FFDDC2', marginTop: 2 },
  headerBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6,
  },
  headerBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  summaryContainer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: c.accent, gap: 12,
  },
  summaryCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 12, padding: 12, gap: 10,
  },
  summaryContent: { flex: 1 },
  summaryLabel: { fontSize: 11, color: c.textSecondary, fontWeight: '600', marginBottom: 2 },
  summaryValue: { fontSize: 16, fontWeight: '800', color: c.textPrimary },

  listContent: { padding: 16, paddingBottom: 40 },

  card: {
    backgroundColor: c.card, borderRadius: 16, marginBottom: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: isDark ? 0.4 : 0.08, shadowRadius: 12, elevation: 4,
    borderWidth: 1, borderColor: c.border,
  },

  statusBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  statusBannerContent: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { fontSize: 12, fontWeight: '700' },
  deliveryIdBadge: { fontSize: 13, fontWeight: '800', color: c.textSecondary },

  miniMap: { height: 140 },
  markerPickup: { backgroundColor: '#3B82F6', borderRadius: 12, padding: 6 },
  markerDropoff: { backgroundColor: '#EF4444', borderRadius: 12, padding: 6 },

  cardBody: { padding: 16 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pickupTypeChip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.accentSoft,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: c.accent,
  },
  pickupTypeText: { fontSize: 12, fontWeight: '600', color: c.accent, marginLeft: 6 },
  headerCost: { fontSize: 20, fontWeight: '800', color: c.accent },

  routeTimeline: { marginBottom: 16 },
  routePoint: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  routeDotPickup: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#3B82F6',
    justifyContent: 'center', alignItems: 'center', marginRight: 10, marginTop: 2,
  },
  routeDotDropoff: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: '#EF4444',
    justifyContent: 'center', alignItems: 'center', marginRight: 10, marginTop: 2,
  },
  routeDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  routeContent: { flex: 1 },
  routeLabel: { fontSize: 10, fontWeight: '700', color: c.textSecondary, letterSpacing: 1, marginBottom: 2 },
  routeText: { fontSize: 13, color: c.textPrimary, fontWeight: '500', lineHeight: 18 },
  routeLineContainer: { flexDirection: 'row', alignItems: 'center', marginLeft: 11, marginVertical: 4 },
  routeLine: { width: 2, height: 20, backgroundColor: c.border },
  routeProgress: { marginLeft: -6, backgroundColor: c.card, borderRadius: 10, padding: 2 },

  cargoSection: { backgroundColor: c.background, borderRadius: 12, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textPrimary, marginBottom: 8 },
  cargoPhoto: { width: '100%', height: 120, borderRadius: 8, marginBottom: 8, resizeMode: 'cover' },
  cargoDescription: { fontSize: 13, color: c.textPrimary, marginBottom: 8, lineHeight: 18 },
  itemSizes: { flexDirection: 'row', gap: 8 },
  sizeChip: {
    backgroundColor: c.card, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 8, borderWidth: 1, borderColor: c.border,
  },
  sizeChipText: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  fragileBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.errorBg,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    alignSelf: 'flex-start', marginTop: 8,
  },
  fragileText: { color: c.error, fontWeight: '600', fontSize: 11, marginLeft: 4 },

  scheduleSection: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successBg,
    borderRadius: 10, padding: 10, marginBottom: 12,
  },
  scheduleText: { fontSize: 13, color: c.success, fontWeight: '600', marginLeft: 8 },

  providerCard: {
    backgroundColor: c.accentSoft, borderRadius: 12, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: c.accent,
  },
  providerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  providerAvatarCircle: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  providerInfo: { flex: 1 },
  providerName: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 2 },
  providerMeta: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  providerMetaText: { fontSize: 12, color: c.textSecondary, marginLeft: 4 },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingText: { fontSize: 12, color: c.textSecondary, marginLeft: 4, fontWeight: '600' },
  providerActions: { flexDirection: 'row', gap: 10 },
  callBtn: { backgroundColor: c.accent, borderRadius: 20, padding: 8, flex: 1, alignItems: 'center' },
  messageBtn: {
    backgroundColor: c.card, borderRadius: 20, padding: 8, flex: 1, alignItems: 'center',
    borderWidth: 1, borderColor: c.accent,
  },

  trackButton: {
    backgroundColor: c.textPrimary, borderRadius: 50, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  trackButtonText: { color: c.card, fontWeight: '700', fontSize: 14, marginLeft: 8 },

  actions: { flexDirection: 'row', gap: 10 },
  editBtn: {
    backgroundColor: c.accent, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 25,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1,
  },
  editBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, marginLeft: 6 },
  deleteBtn: {
    backgroundColor: c.error, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 25,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1,
  },
  deleteBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, marginLeft: 6 },

  pendingBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.warningBg,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10,
  },

  emptyStateContainer: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  emptyIconContainer: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: c.card,
    justifyContent: 'center', alignItems: 'center', marginBottom: 24,
    borderWidth: 1, borderColor: c.border,
  },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyActionBtn: {
    backgroundColor: c.accent, borderRadius: 50, paddingVertical: 14, paddingHorizontal: 24,
    flexDirection: 'row', alignItems: 'center',
  },
  emptyActionText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginLeft: 8 },
});