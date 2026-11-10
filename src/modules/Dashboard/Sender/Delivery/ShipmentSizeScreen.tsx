// src/modules/Dashboard/Sender/Delivery/ShipmentSizeScreen.tsx
import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Animated,
  Easing,
  StatusBar,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { SolarIcon } from '../../../../components/ui/SolarIcon'; 

const SIZE_META = {
  Small: {
    image: require('../../../../../assets/small-package-icon.png'),
    range: 'Less than 5 kg',
    dimensions: '12" × 12" × 12"',
    dimensionsCm: '30 × 30 × 30 cm',
    color: '#3B82F6',
    bg: '#EFF6FF',
    bgDark: '#0F2744',
  },
  Medium: {
    image: require('../../../../../assets/medium-package-icon.png'),
    range: '5 – 20 kg',
    dimensions: '18" × 14" × 14"',
    dimensionsCm: '45 × 35 × 35 cm',
    color: '#F27024',
    bg: '#FFF7ED',
    bgDark: '#2A1A0E',
  },
  Large: {
    image: require('../../../../../assets/large-package-icon.png'),
    range: 'More than 20 kg',
    dimensions: '24" × 18" × 18"',
    dimensionsCm: '60 × 45 × 45 cm',
    color: '#8B5CF6',
    bg: '#F5F3FF',
    bgDark: '#231542',
  },
} as const;

// 🚨 YOUR 3D EMPTY ASSET 🚨
const EMPTY_BOX_ICON = require('../../../../../assets/empty-box-icon.png');

export default function ShipmentSizeScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const mode = state.mode;
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [fullScreenImage, setFullScreenImage] = useState<any>(null);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const smallAnim = useRef(new Animated.Value(0)).current;
  const mediumAnim = useRef(new Animated.Value(0)).current;
  const largeAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(titleAnim, 200),
      animate(smallAnim, 320),
      animate(mediumAnim, 400),
      animate(largeAnim, 480),
      animate(listAnim, 560),
      animate(buttonAnim, 640),
    ]).start();
  }, [headerAnim, titleAnim, smallAnim, mediumAnim, largeAnim, listAnim, buttonAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const addItem = (size: 'Small' | 'Medium' | 'Large') => {
    navigation.navigate('AddItem', { size, mode });
  };

  const removeItem = (id: string) => {
    dispatch({ type: 'REMOVE_ITEM', payload: id });
  };

  const sizeBg = (size: 'Small' | 'Medium' | 'Large') =>
    isDark ? SIZE_META[size].bgDark : SIZE_META[size].bg;

  const renderItem = (item: any) => {
    const meta = SIZE_META[item.size as keyof typeof SIZE_META] || SIZE_META.Small;
    return (
      <View key={item.id} style={styles.itemCard}>
        <TouchableOpacity
          style={styles.itemCardContent}
          activeOpacity={0.7}
          onPress={() => setSelectedItem(item)}
        >
          <View style={[styles.itemSizeIcon, { backgroundColor: sizeBg(item.size) }]}>
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
                  <SolarIcon name="Warning" variant="bold" size={10} color={colors.error} />
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
          <SolarIcon name="CloseCircle" variant="linear" size={16} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderSizeOption = (size: 'Small' | 'Medium' | 'Large', anim: Animated.Value) => {
    const meta = SIZE_META[size];
    const count = state.items.filter((i) => i.size === size).length;

    return (
      <Animated.View style={[styles.sizeItemWrapper, fadeUp(anim, 20)]}>
        <TouchableOpacity style={styles.sizeItem} onPress={() => addItem(size)} activeOpacity={0.85}>
          <View style={[styles.sizeIconCircle, { backgroundColor: sizeBg(size) }]}>
            <Image source={meta.image} style={styles.sizeIconImage} resizeMode="contain" />
            {count > 0 && (
              <View style={[styles.countBadge, { backgroundColor: meta.color }]}>
                <Text style={styles.countBadgeText}>{count}</Text>
              </View>
            )}
          </View>
          <Text style={styles.sizeLabel}>{size}</Text>
          <Text style={styles.sizeSub}>{meta.range}</Text>
          {/* Added Dimensions */}
          <Text style={styles.sizeDimensions}>{meta.dimensions}</Text>
          <Text style={styles.sizeDimensionsCm}>{meta.dimensionsCm}</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />

      {/* Clean Premium Header */}
      <Animated.View style={[styles.headerBackground, { paddingTop: insets.top + 12 }, fadeUp(headerAnim, -14)]}>
        <View style={styles.headerInnerContent}>
          <View style={styles.stepRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>STEP 2 OF 4</Text>
            </View>
          </View>

          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
              <SolarIcon name="ArrowLeft" variant="linear" size={22} color="#FFFFFF" />
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
      </Animated.View>

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

          <View style={styles.sizesRow}>
            {renderSizeOption('Small', smallAnim)}
            {renderSizeOption('Medium', mediumAnim)}
            {renderSizeOption('Large', largeAnim)}
          </View>

          <Animated.View style={[styles.itemsListContainer, fadeUp(listAnim, 20)]}>
            <View style={styles.itemsHeader}>
              <Text style={styles.itemsTitle}>Shipment Items</Text>
              <Text style={styles.itemsCount}>
                {state.items.length} {state.items.length === 1 ? 'item' : 'items'}
              </Text>
            </View>

            {state.items.length === 0 ? (
              <View style={styles.emptyBox}>
                <Image 
                  source={EMPTY_BOX_ICON} 
                  style={styles.emptyImage} 
                  resizeMode="contain" 
                />
                <Text style={styles.emptyTitle}>No items yet</Text>
                <Text style={styles.emptyText}>Tap a size above to add your first item</Text>
              </View>
            ) : (
              <View style={{ width: '100%' }}>
                {state.items.map((item: any) => renderItem(item))}
              </View>
            )}
          </Animated.View>

          <Animated.View style={fadeUp(buttonAnim, 20)}>
            <TouchableOpacity
              style={[styles.confirmButton, state.items.length === 0 ? styles.confirmBtnDisabled : styles.confirmButtonActive]}
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
              <Text style={[styles.confirmButtonText, state.items.length === 0 && styles.confirmButtonTextDisabled]}>
                Continue
              </Text>
              <SolarIcon
                name="AltArrowRight"
                variant="linear"
                size={18}
                color={state.items.length === 0 ? colors.textMuted : '#FFFFFF'}
              />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </ScrollView>

      {/* Item Review Modal */}
      <Modal visible={!!selectedItem} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelectedItem(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalContent}>
            {selectedItem && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Item Details</Text>
                  <TouchableOpacity onPress={() => setSelectedItem(null)} style={styles.modalCloseBtn}>
                    <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.modalBody}>
                  <TouchableOpacity
                    style={[styles.modalIconBox, { backgroundColor: sizeBg(selectedItem.size) }]}
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
                      <SolarIcon name="Maximize" variant="linear" size={14} color="#FFFFFF" />
                    </View>
                  </TouchableOpacity>

                  <Text style={styles.modalSize}>{selectedItem.size} Package</Text>
                  
                  {/* Added Max Size in Modal */}
                  <Text style={styles.modalDimensions}>
                    Max Size: {SIZE_META[selectedItem.size as keyof typeof SIZE_META].dimensions} ({SIZE_META[selectedItem.size as keyof typeof SIZE_META].dimensionsCm})
                  </Text>

                  <Text style={styles.modalDesc}>
                    {selectedItem.description || 'No specific description provided.'}
                  </Text>

                  {selectedItem.fragile && (
                    <View style={styles.modalFragileLarge}>
                      <SolarIcon name="Warning" variant="duotone" size={18} color={colors.error} />
                      <Text style={styles.modalFragileTextLarge}>This item is marked as fragile</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Full-Screen Image Viewer */}
      <Modal visible={!!fullScreenImage} transparent animationType="fade">
        <View style={styles.fsOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setFullScreenImage(null)}
          />
          <TouchableOpacity style={styles.fsCloseBtn} onPress={() => setFullScreenImage(null)}>
            <SolarIcon name="CloseCircle" variant="linear" size={28} color="#FFFFFF" />
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

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  headerBackground: {
    backgroundColor: c.accent,
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 1,
  },
  headerInnerContent: { paddingHorizontal: 24 },
  stepRow: { flexDirection: 'row', marginBottom: 12 },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  
  stepText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 16 },
  backButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSubtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20, maxWidth: '90%', fontFamily: 'Poppins_400Regular', marginTop: 4,
  },

  scrollView: { flex: 1, backgroundColor: c.background, zIndex: 3, elevation: 3 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  card: { backgroundColor: c.background },
  textTitleContainer: { marginBottom: 20 },
  titleWithBadge: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  
  cardTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  cardSubtitle: { fontSize: 14, color: c.textSecondary, fontFamily: 'Poppins_400Regular', lineHeight: 20 },
  
  totalBadge: {
    minWidth: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8,
  },
  totalBadgeText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Poppins_700Bold' },

  sizesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28, gap: 12 },
  sizeItemWrapper: { flex: 1 },
  
  sizeItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: c.card,
    borderRadius: 12,
    paddingVertical: 20, paddingHorizontal: 8,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02, shadowRadius: 1, elevation: 0,
  },
  sizeIconCircle: {
    width: 64, height: 64, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 14, position: 'relative',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },
  sizeIconImage: { width: 40, height: 40 },
  countBadge: {
    position: 'absolute', top: -6, right: -6,
    minWidth: 22, height: 22, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: c.card,
    paddingHorizontal: 4, elevation: 2,
  },
  countBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins_700Bold' },
  sizeLabel: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 4 },
  sizeSub: { fontSize: 11, color: c.textSecondary, fontFamily: 'Poppins_500Medium', textAlign: 'center' },
  
  // New styles for dimensions
  sizeDimensions: { 
    fontSize: 10, 
    color: c.textPrimary, 
    fontFamily: 'Poppins_600SemiBold', 
    textAlign: 'center', 
    marginTop: 6 
  },
  sizeDimensionsCm: { 
    fontSize: 9, 
    color: c.textMuted, 
    fontFamily: 'Poppins_400Regular', 
    textAlign: 'center',
    marginTop: 2
  },

  itemsListContainer: { marginBottom: 16 },
  itemsHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12, paddingHorizontal: 2,
  },
  itemsTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  itemsCount: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_600SemiBold' },

  emptyBox: {
    borderRadius: 12, paddingVertical: 40,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.card,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  
  emptyImage: {
    width: 120,
    height: 120,
    marginBottom: 16,
  },
  
  emptyTitle: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 6 },
  emptyText: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_400Regular', textAlign: 'center' },

  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  itemCardContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  itemSizeIcon: {
    width: 48, height: 48, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
  },
  itemPhotoPlaceholder: { width: 28, height: 28 },
  itemPhoto: { width: 48, height: 48, borderRadius: 12 },
  itemInfo: { flex: 1, marginRight: 8 },
  itemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  itemSizeLabel: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  fragileTag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.errorBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
  },
  fragileTagText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.error },
  itemDesc: { fontSize: 13, color: c.textSecondary, fontFamily: 'Poppins_400Regular' },
  removeBtn: {
    width: 34, height: 34, borderRadius: 12, backgroundColor: c.errorBg,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.error, marginLeft: 8,
  },

  confirmButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, paddingVertical: 18, marginTop: 10, gap: 8,
  },
  confirmBtnDisabled: {
    backgroundColor: c.divider, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  confirmButtonActive: { 
    backgroundColor: c.accent,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 1,
  },
  confirmButtonText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Poppins_700Bold' },
  confirmButtonTextDisabled: { color: c.textMuted },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalContent: {
    width: '100%', backgroundColor: c.card, borderRadius: 16, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 16, elevation: 5,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  modalCloseBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
  },
  modalBody: { alignItems: 'center', paddingBottom: 8 },
  modalIconBox: {
    width: 88, height: 88, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    position: 'relative',
  },
  zoomIconIndicator: {
    position: 'absolute', bottom: -6, right: -6,
    width: 28, height: 28, borderRadius: 14, backgroundColor: c.textPrimary,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: c.card,
  },
  modalPhoto: { width: 88, height: 88, borderRadius: 16 },
  modalImagePlaceholder: { width: 52, height: 52 },
  modalSize: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 8 },
  
  // New style for modal dimensions
  modalDimensions: {
    fontSize: 13, 
    color: c.textSecondary, 
    fontFamily: 'Poppins_600SemiBold',
    marginBottom: 12,
    textAlign: 'center',
  },
  
  modalDesc: {
    fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 20,
    paddingHorizontal: 12, marginBottom: 16, fontFamily: 'Poppins_400Regular',
  },
  modalFragileLarge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.errorBg, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderColor: c.error,
  },
  modalFragileTextLarge: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.error },

  fsOverlay: {
    flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)',
    justifyContent: 'center', alignItems: 'center',
  },
  fsCloseBtn: {
    position: 'absolute', top: 50, right: 20,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10,
  },
  fsImage: { width: '100%', height: '80%' },
});