// src/modules/Dashboard/Sender/Delivery/DropoffTypeScreen.tsx
import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Dimensions, Animated, Easing, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

export default function DropoffTypeScreen({ route, navigation }: any) {
  const { state, dispatch } = useSchedule();
  const { mode, editData } = route.params || {};
  const insets = useSafeAreaInsets();

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const option1Anim = useRef(new Animated.Value(0)).current;
  const option2Anim = useRef(new Animated.Value(0)).current;
  const graphicAnim = useRef(new Animated.Value(0)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animation                                                  */
  /* ------------------------------------------------------------------ */
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
      animate(graphicAnim, 120),
      animate(titleAnim, 200),
      animate(option1Anim, 320),
      animate(option2Anim, 420),
    ]).start();
  }, [headerAnim, graphicAnim, titleAnim, option1Anim, option2Anim]);

  /* ------------------------------------------------------------------ */
  /* Reconstruct edit data                                               */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (editData) {
      const cargo = editData.cargo_profiles || {};
      const reconstructedItems: any[] = [];

      for (let i = 0; i < (cargo.small_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-small-${i}-${Date.now()}`,
          size: 'Small',
          description: cargo.description || 'Small box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }
      for (let i = 0; i < (cargo.medium_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-medium-${i}-${Date.now()}`,
          size: 'Medium',
          description: cargo.description || 'Medium box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }
      for (let i = 0; i < (cargo.large_box_qty || 0); i++) {
        reconstructedItems.push({
          id: `edit-large-${i}-${Date.now()}`,
          size: 'Large',
          description: cargo.description || 'Large box',
          photoUri: null,
          fragile: cargo.is_fragile || false,
        });
      }

      dispatch({
        type: 'SET_INITIAL_STATE',
        payload: {
          dropoffType: editData.pickup_type,
          items: reconstructedItems,
          scheduledDate: editData.scheduled_time ? new Date(editData.scheduled_time) : null,
          pickupLocation: {
            address: editData.pickup_location?.street_address,
            latitude: editData.pickup_location?.latitude,
            longitude: editData.pickup_location?.longitude,
          },
          dropoffLocation: {
            address: editData.dropoff_location?.street_address,
            latitude: editData.dropoff_location?.latitude,
            longitude: editData.dropoff_location?.longitude,
          },
          estimatedCost: editData.estimated_cost,
        },
      });
      dispatch({
        type: 'SET_EDIT_DATA',
        payload: {
          requestId: editData.request_id,
          cargoId: cargo.cargo_id,
          pickupLocId: editData.pickup_location.location_id,
          dropoffLocId: editData.dropoff_location.location_id,
        },
      });
    }
  }, [editData, dispatch]);

  useEffect(() => {
    if (mode) {
      dispatch({ type: 'SET_MODE', payload: mode });
    }
  }, [mode]);

  /* ------------------------------------------------------------------ */
  /* Select handler                                                      */
  /* ------------------------------------------------------------------ */
  const selectType = (type: 'curb-side' | 'door-to-door') => {
    dispatch({ type: 'SET_DROPOFF_TYPE', payload: type });
    navigation.navigate('ShipmentSize');
  };

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
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

  const graphicSlide = {
    opacity: graphicAnim,
    transform: [
      {
        translateX: graphicAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [40, 0],
        }),
      },
    ],
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Full-width Header */}
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
              <Text style={styles.stepText}>STEP 1 OF 4</Text>
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
              <Text style={styles.headerTitle}>Drop-off Type</Text>
            </View>
          </View>

          <Text style={styles.headerSubtitle}>
            Choose how the receiver will collect their package.
          </Text>
        </View>

        <Animated.Image
          source={require('../../../../../assets/drop-off-method.png')}
          style={[styles.headerGraphicImage, graphicSlide]}
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
            <Text style={styles.cardTitle}>Select drop-off method</Text>
            <Text style={styles.cardSubtitle}>Choose the option that fits best for your receiver</Text>
          </View>

          {/* Options */}
          <View style={styles.optionsWrapper}>
            {/* Curb-side */}
            <Animated.View style={[styles.optionWrapper, fadeUp(option1Anim, 20)]}>
              <TouchableOpacity
                style={[
                  styles.optionBox,
                  state.dropoffType === 'curb-side' && styles.optionBoxActive,
                ]}
                onPress={() => selectType('curb-side')}
                activeOpacity={0.9}
              >
                <View
                  style={[
                    styles.activeIndicator,
                    state.dropoffType === 'curb-side' && styles.activeIndicatorOn,
                  ]}
                >
                  {state.dropoffType === 'curb-side' && (
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  )}
                </View>

                <View style={styles.optionIconBox}>
                  <Image
                    source={require('../../../../../assets/curb-side-drop-off.png')}
                    style={styles.customOptionIcon}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.optionLabel}>Curb-side</Text>
                <Text style={styles.optionSub}>
                  Receiver meets the vehicle at the pickup point
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Door-to-Door */}
            <Animated.View style={[styles.optionWrapper, fadeUp(option2Anim, 20)]}>
              <TouchableOpacity
                style={[
                  styles.optionBox,
                  state.dropoffType === 'door-to-door' && styles.optionBoxActive,
                ]}
                onPress={() => selectType('door-to-door')}
                activeOpacity={0.9}
              >
                <View
                  style={[
                    styles.activeIndicator,
                    state.dropoffType === 'door-to-door' && styles.activeIndicatorOn,
                  ]}
                >
                  {state.dropoffType === 'door-to-door' && (
                    <Ionicons name="checkmark" size={10} color="#FFFFFF" />
                  )}
                </View>

                <View style={styles.optionIconBox}>
                  <Image
                    source={require('../../../../../assets/door-to-door.png')}
                    style={styles.customOptionIcon}
                    resizeMode="contain"
                  />
                </View>
                <Text style={styles.optionLabel}>Door-to-Door</Text>
                <Text style={styles.optionSub}>
                  We deliver straight to the receiver's doorstep
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          {/* Info footer */}
          <View style={styles.infoFooter}>
            <Ionicons name="information-circle-outline" size={16} color={ORANGE} />
            <Text style={styles.infoFooterText}>
              You can change this later before confirming your booking.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

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
    maxWidth: '58%',
    fontWeight: '500',
  },
  headerGraphicImage: {
    position: 'absolute',
    right: -10,
    bottom: -5,
    width: 190, 
    height: 130,
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
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '400',
    lineHeight: 18,
  },

  optionsWrapper: {
    gap: 14,
    marginBottom: 24,
  },
  optionWrapper: { width: '100%' },
  optionBox: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  optionBoxActive: {
    borderColor: ORANGE,
    borderWidth: 1.5,
    backgroundColor: '#FFFBF8',
  },
  activeIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIndicatorOn: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  optionIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  customOptionIcon: {
    width: 36,
    height: 36,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  optionSub: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 12,
    fontWeight: '400',
  },

  infoFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  infoFooterText: {
    flex: 1,
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
    lineHeight: 18,
  },
});