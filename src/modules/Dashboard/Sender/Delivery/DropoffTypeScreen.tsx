import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Dimensions, Animated, Easing, StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');
const ORANGE = '#FA7A25';

export default function DropoffTypeScreen({ route, navigation }: any) {
  const { state, dispatch } = useSchedule();
  const { mode, editData } = route.params || {};
  const insets = useSafeAreaInsets();

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const option1Anim = useRef(new Animated.Value(0)).current;
  const option2Anim = useRef(new Animated.Value(0)).current;
  const carAnim = useRef(new Animated.Value(0)).current;

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
      animate(carAnim, 120),
      animate(titleAnim, 200),
      animate(option1Anim, 320),
      animate(option2Anim, 420),
    ]).start();
  }, [headerAnim, carAnim, titleAnim, option1Anim, option2Anim]);

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

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
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
        {/* Step indicator */}
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
              <Ionicons name="map" size={22} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Select drop-off method</Text>
              <Text style={styles.cardSubtitle}>Choose the option that fits best</Text>
            </View>
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
                {/* Active indicator */}
                <View
                  style={[
                    styles.activeIndicator,
                    state.dropoffType === 'curb-side' && styles.activeIndicatorOn,
                  ]}
                >
                  {state.dropoffType === 'curb-side' && (
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={styles.optionIconBox}>
                  <Ionicons name="car-sport" size={44} color={ORANGE} />
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
                    <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={styles.optionIconBox}>
                  <Ionicons name="home" size={44} color="#8B4513" />
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
            <Ionicons name="information-circle-outline" size={16} color="#3B82F6" />
            <Text style={styles.infoFooterText}>
              You can change this later before confirming your booking.
            </Text>
          </View>
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
    height: 280,
    zIndex: 1,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 14,
  },
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
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 22,
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

  /* ------------------------------------------------------------------ */
  /* Options                                                             */
  /* ------------------------------------------------------------------ */
  optionsWrapper: {
    gap: 12,
    marginBottom: 18,
  },
  optionWrapper: { width: '100%' },
  optionBox: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  optionBoxActive: {
    borderColor: ORANGE,
    borderWidth: 2,
    backgroundColor: '#FFF7ED',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  activeIndicator: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIndicatorOn: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  optionIconBox: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  optionSub: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 15,
    paddingHorizontal: 8,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Info Footer                                                         */
  /* ------------------------------------------------------------------ */
  infoFooter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  infoFooterText: {
    flex: 1,
    fontSize: 11,
    color: '#1E40AF',
    fontWeight: '600',
    lineHeight: 16,
  },
});