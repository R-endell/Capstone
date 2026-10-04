// src/modules/Dashboard/Sender/Delivery/ShipmentSizeScreen.tsx
import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Dimensions,
  Animated,
  Easing,
  StatusBar,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

const SIZE_META = {
  Small: { 
    image: require('../../../../../assets/package-size.png'), 
    range: 'Less than 5 kg', 
    color: '#3B82F6', 
    bg: '#EFF6FF',
    imgSize: 26 
  },
  Medium: { 
    image: require('../../../../../assets/package-size.png'), 
    range: '5 – 20 kg', 
    color: ORANGE, 
    bg: '#FFF7ED',
    imgSize: 36 
  },
  Large: { 
    image: require('../../../../../assets/package-size.png'), 
    range: 'More than 20 kg', 
    color: '#8B5CF6', 
    bg: '#F5F3FF',
    imgSize: 48 
  },
} as const;

export default function ShipmentSizeScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();

  // Modal States
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [fullScreenImage, setFullScreenImage] = useState<any>(null);

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

  /* ------------------------------------------------------------------ */
  /* Render Item                                                         */
  /* ------------------------------------------------------------------ */
  const renderItem = (item: any) => {
    const meta = SIZE_META[item.size as keyof typeof SIZE_META] || SIZE_META.Small;
    return (
      <View key={item.id} style={styles.itemCard}>
        <TouchableOpacity
          style={styles.itemCardContent}
          activeOpacity={0.7}
          onPress={() => setSelectedItem(item)}
        >
          <View style={[styles.itemSizeIcon, { backgroundColor: meta.bg }]}>
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={styles.itemPhoto} />
            ) : (
              <Image source={meta.image} style={styles.itemPhotoPlaceholder} resizeMode="contain" />
            )}
          </View>

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
        </TouchableOpacity>

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
            <Image 
              source={meta.image} 
              style={{ width: meta.imgSize, height: meta.imgSize }} 
              resizeMode="contain" 
            />
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
          { paddingTop: insets.top + 12 },
          fadeUp(headerAnim, -14),
        ]}
      >
        <View style={styles.headerInnerContent}>
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
        </View>

        <Animated.Image
          source={require('../../../../../assets/Car-Grey.png')} 
          style={[styles.headerGraphicImage, carSlide]}
          resizeMode="contain"
        />
      </Animated.View>

      {/* Scrollable Content Container */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.card, fadeUp(titleAnim, 20)]}>
          
          <View style={styles.textTitleContainer}>
            <View style={styles.titleWithBadge}>
              <Text style={styles.cardTitle}>What's in your shipment?</Text>
              {state.items.length > 0 && (
                <View style={styles.totalBadge}>
                  <Text style={styles.totalBadgeText}>{state.items.length}</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardSubtitle}>Tap a size below to add an item</Text>
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
                  <Image 
                    source={require('../../../../../assets/package-size.png')} 
                    style={styles.emptyImagePlaceholder} 
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.emptyTitle}>No items yet</Text>
                <Text style={styles.emptyText}>
                  Tap a size above to add your first item
                </Text>
              </View>
            ) : (
              <View style={{ width: '100%' }}>
                {state.items.map((item: any) => renderItem(item))}
              </View>
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
              <Text style={[
                  styles.confirmButtonText, 
                  state.items.length === 0 && styles.confirmButtonTextDisabled
                ]}>Continue</Text>
              <Ionicons 
                name="arrow-forward" 
                size={16} 
                color={state.items.length === 0 ? '#9CA3AF' : '#FFFFFF'} 
              />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </ScrollView>

      {/* Item Review Modal */}
      <Modal visible={!!selectedItem} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedItem(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
            {selectedItem && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Item Details</Text>
                  <TouchableOpacity onPress={() => setSelectedItem(null)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                <View style={styles.modalBody}>
                  <TouchableOpacity 
                    style={[styles.modalIconBox, { backgroundColor: SIZE_META[selectedItem.size as keyof typeof SIZE_META].bg }]}
                    activeOpacity={0.8}
                    onPress={() => setFullScreenImage(selectedItem)}
                  >
                    {selectedItem.photoUri ? (
                      <Image source={{ uri: selectedItem.photoUri }} style={styles.modalPhoto} />
                    ) : (
                      <Image
                        source={SIZE_META[selectedItem.size as keyof typeof SIZE_META].image}
                        style={styles.modalImagePlaceholder}
                        resizeMode="contain"
                      />
                    )}
                    <View style={styles.zoomIconIndicator}>
                      <Ionicons name="expand-outline" size={14} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>
                  
                  <Text style={styles.modalSize}>{selectedItem.size} Package</Text>
                  <Text style={styles.modalDesc}>{selectedItem.description || 'No specific description provided.'}</Text>

                  {selectedItem.fragile && (
                    <View style={styles.modalFragileLarge}>
                      <Ionicons name="warning" size={16} color="#EF4444" />
                      <Text style={styles.modalFragileTextLarge}>This item is marked as fragile</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Full-Screen Image Viewer Modal */}
      <Modal visible={!!fullScreenImage} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={() => setFullScreenImage(null)} 
          />
          
          <TouchableOpacity style={styles.fsCloseBtn} onPress={() => setFullScreenImage(null)}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {fullScreenImage && (
            <Image
              source={
                fullScreenImage.photoUri 
                  ? { uri: fullScreenImage.photoUri } 
                  : SIZE_META[fullScreenImage.size as keyof typeof SIZE_META].image
              }
              style={styles.fsImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#FFFFFF',
    position: 'relative', 
  },
  headerBackground: {
    backgroundColor: ORANGE,
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 22,
    zIndex: 1,
  },
  headerInnerContent: {
    paddingHorizontal: 24,
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  stepText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
    maxWidth: '52%',
    fontWeight: '500',
  },
  headerGraphicImage: {
    position: 'absolute',
    right: -45,
    bottom: -10,
    width: 220, 
    height: 145,
    zIndex: 2,
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    zIndex: 3,
    elevation: 3,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 0,
    padding: 0,
  },
  textTitleContainer: {
    marginBottom: 20,
    paddingBottom: 4,
  },
  titleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '400',
    lineHeight: 18,
  },
  totalBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
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
  sizesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 26,
    gap: 12,
  },
  sizeItemWrapper: { flex: 1 },
  sizeItem: {
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sizeIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    paddingHorizontal: 4,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  countBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  sizeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 3,
    letterSpacing: -0.2,
  },
  sizeSub: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
    textAlign: 'center',
  },
  itemsListContainer: {
    marginBottom: 10,
  },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  itemsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  itemsCount: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  emptyDashedBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  emptyImagePlaceholder: {
    width: 32,
    height: 32,
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  emptyText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  itemCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemSizeIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  itemPhotoPlaceholder: {
    width: 24,
    height: 24,
  },
  itemPhoto: { width: 44, height: 44, borderRadius: 12 },
  itemInfo: { flex: 1, marginRight: 8 },
  itemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  itemSizeLabel: {
    fontSize: 14,
    fontWeight: '700',
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
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    letterSpacing: 0.3,
  },
  itemDesc: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '400',
  },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
    marginLeft: 8,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 18,
    marginTop: 16,
    gap: 8,
  },
  confirmBtnDisabled: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  confirmButtonActive: {
    backgroundColor: '#111827',
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  confirmButtonTextDisabled: {
    color: '#9CA3AF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)', 
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBody: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  modalIconBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    position: 'relative',
  },
  zoomIconIndicator: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#111827',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  modalPhoto: {
    width: 80,
    height: 80,
    borderRadius: 24,
  },
  modalImagePlaceholder: {
    width: 48,
    height: 48,
  },
  modalSize: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  modalDesc: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  modalFragileLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  modalFragileTextLarge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  fsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)', 
    justifyContent: 'center',
    alignItems: 'center',
  },
  fsCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fsImage: {
    width: '100%',
    height: '80%',
  },
});