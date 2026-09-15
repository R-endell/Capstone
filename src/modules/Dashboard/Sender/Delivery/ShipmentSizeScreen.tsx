import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  Dimensions,
  Animated,
  Easing,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#FA7A25';

const SIZE_META = {
  Small: { icon: 'cube-outline', range: 'Less than 5 kg', color: '#3B82F6', bg: '#EFF6FF' },
  Medium: { icon: 'cube', range: '5 – 20 kg', color: ORANGE, bg: '#FFF7ED' },
  Large: { icon: 'file-tray-full-outline', range: 'More than 20 kg', color: '#8B5CF6', bg: '#F5F3FF' },
} as const;

export default function ShipmentSizeScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const carAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const smallAnim = useRef(new Animated.Value(0)).current;
  const mediumAnim = useRef(new Animated.Value(0)).current;
  const largeAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(carAnim, 120),
      animate(titleAnim, 200),
      animate(smallAnim, 320),
      animate(mediumAnim, 400),
      animate(largeAnim, 480),
      animate(listAnim, 560),
      animate(buttonAnim, 640),
    ]).start();
  }, [headerAnim, carAnim, titleAnim, smallAnim, mediumAnim, largeAnim, listAnim, buttonAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
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

  const carSlide = {
    opacity: carAnim,
    transform: [
      {
        translateX: carAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [40, 0],
        }),
      },
    ],
  };

  const addItem = (size: 'Small' | 'Medium' | 'Large') => {
    navigation.navigate('AddItem', { size, mode });
  };

  const removeItem = (id: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  };

  const getTotalWeight = () => {
    if (!state.items.length) return 0;
    return state.items.length * 3;
  };

  /* ------------------------------------------------------------------ */
  /* Render Item                                                         */
  /* ------------------------------------------------------------------ */
  const renderItem = ({ item }: any) => {
    const meta = SIZE_META[item.size as keyof typeof SIZE_META] || SIZE_META.Small;
    return (
      <View style={styles.itemCard}>
        {/* Size icon */}
        <View style={[styles.itemSizeIcon, { backgroundColor: meta.bg }]}>
          {item.photoUri ? (
            <Image source={{ uri: item.photoUri }} style={styles.itemPhoto} />
          ) : (
            <Ionicons name={meta.icon as any} size={18} color={meta.color} />
          )}
        </View>

        {/* Info */}
        <View style={styles.itemInfo}>
          <View style={styles.itemTopRow}>
            <Text style={styles.itemSizeLabel}>{item.size} item</Text>
            {item.fragile && (
              <View style={styles.fragileTag}>
                <Ionicons name="warning-outline" size={9} color="#EF4444" />
                <Text style={styles.fragileTagText}>Fragile</Text>
              </View>
            )}
          </View>
          <Text style={styles.itemDesc} numberOfLines={1}>
            {item.description || 'No description'}
          </Text>
        </View>

        {/* Remove */}
        <TouchableOpacity
          onPress={() => removeItem(item.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.removeBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={14} color="#EF4444" />
        </TouchableOpacity>
      </View>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Render Size Option                                                  */
  /* ------------------------------------------------------------------ */
  const renderSizeOption = (size: 'Small' | 'Medium' | 'Large', anim: Animated.Value) => {
    const meta = SIZE_META[size];
    const count = state.items.filter((i) => i.size === size).length;

    return (
      <Animated.View style={[styles.sizeItemWrapper, fadeUp(anim, 20)]}>
        <TouchableOpacity
          style={styles.sizeItem}
          onPress={() => addItem(size)}
          activeOpacity={0.85}
        >
          <View style={[styles.sizeIconCircle, { backgroundColor: meta.bg }]}>
            <Ionicons name={meta.icon as any} size={26} color={meta.color} />
            {count > 0 && (
              <View style={[styles.countBadge, { backgroundColor: meta.color }]}>
                <Text style={styles.countBadgeText}>{count}</Text>
              </View>
            )}
          </View>
          <Text style={styles.sizeLabel}>{size}</Text>
          <Text style={styles.sizeSub}>{meta.range}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[
          styles.headerBackground,
          { paddingTop: insets.top + 10 },
          fadeUp(headerAnim, -14),
        ]}
      >
        <View style={styles.stepRow}>
          <View style={styles.stepPill}>
            <Text style={styles.stepText}>STEP 2 OF 4</Text>
          </View>
        </View>

        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSub}>
              {mode === 'sendNow' ? 'Send Package Now' : 'Schedule Delivery'}
            </Text>
            <Text style={styles.headerTitle}>Shipment Size</Text>
          </View>
        </View>

        <Text style={styles.headerSubtitle}>
          Add the items you're sending so we can estimate your cost.
        </Text>

        <Animated.Image
          source={require('../../../../../assets/Car-Grey.png')}
          style={[styles.carImage, carSlide]}
        />
      </Animated.View>

      {/* Content */}
      <View style={styles.contentContainer}>
        <Animated.View style={[styles.card, fadeUp(titleAnim, 20)]}>
          {/* Card Header */}
          <View style={styles.cardTitleRow}>
            <View style={styles.cardIconBox}>
              <Ionicons name="cube-outline" size={22} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>What's in your shipment?</Text>
              <Text style={styles.cardSubtitle}>Tap a size to add an item</Text>
            </View>
            {state.items.length > 0 && (
              <View style={styles.totalBadge}>
                <Text style={styles.totalBadgeText}>{state.items.length}</Text>
              </View>
            )}
          </View>

          {/* Size Options */}
          <View style={styles.sizesRow}>
            {renderSizeOption('Small', smallAnim)}
            {renderSizeOption('Medium', mediumAnim)}
            {renderSizeOption('Large', largeAnim)}
          </View>

          {/* Items List */}
          <Animated.View style={[styles.itemsListContainer, fadeUp(listAnim, 20)]}>
            <View style={styles.itemsHeader}>
              <Text style={styles.itemsTitle}>Shipment Items</Text>
              <Text style={styles.itemsCount}>
                {state.items.length} {state.items.length === 1 ? 'item' : 'items'}
              </Text>
            </View>

            {state.items.length === 0 ? (
              <View style={styles.emptyDashedBox}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="cube-outline" size={28} color={ORANGE} />
                </View>
                <Text style={styles.emptyTitle}>No items yet</Text>
                <Text style={styles.emptyText}>
                  Tap a size above to add your first item
                </Text>
              </View>
            ) : (
              <FlatList
                data={state.items}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: 12 }}
              />
            )}
          </Animated.View>

          {/* Confirm Button */}
          <Animated.View style={fadeUp(buttonAnim, 20)}>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                state.items.length === 0 ? styles.confirmBtnDisabled : styles.confirmButtonActive,
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
              activeOpacity={0.9}
            >
              <Text style={styles.confirmButtonText}>Continue</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
  headerBackground: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingBottom: 80,
    position: 'relative',
    overflow: 'visible',
    height: 260,
    zIndex: 1,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  stepRow: { flexDirection: 'row', marginBottom: 14 },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  stepText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSub: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#FFE0C7',
    lineHeight: 18,
    maxWidth: '65%',
    fontWeight: '500',
  },
  carImage: {
    position: 'absolute',
    right: -30,
    bottom: 10,
    width: 240,
    height: 120,
    resizeMode: 'contain',
    zIndex: 2,
    opacity: 0.85,
  },

  /* ------------------------------------------------------------------ */
  /* Content                                                             */
  /* ------------------------------------------------------------------ */
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    zIndex: 0,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    flex: 1,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },

  /* Card Header */
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  cardIconBox: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },
  totalBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  totalBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  /* Size Options */
  sizesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 22,
    gap: 10,
  },
  sizeItemWrapper: { flex: 1 },
  sizeItem: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 6,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sizeIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    position: 'relative',
  },
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingHorizontal: 4,
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  sizeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 2,
    letterSpacing: -0.2,
  },
  sizeSub: {
    fontSize: 9,
    color: '#6B7280',
    fontWeight: '600',
    textAlign: 'center',
  },

  /* Items List */
  itemsListContainer: { flex: 1 },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  itemsTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  itemsCount: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '600',
  },

  emptyDashedBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  /* Item Card */
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  itemSizeIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  itemPhoto: { width: 42, height: 42, borderRadius: 12 },
  itemInfo: { flex: 1, marginRight: 8 },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  itemSizeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  fragileTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  fragileTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#EF4444',
    letterSpacing: 0.3,
  },
  itemDesc: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },

  /* Confirm Button */
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 12,
    gap: 8,
  },
  confirmBtnDisabled: {
    backgroundColor: '#D1D5DB',
  },
  confirmButtonActive: {
    backgroundColor: '#111827',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});