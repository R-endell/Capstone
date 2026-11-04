// src/modules/Dashboard/Sender/Delivery/DropoffTypeScreen.tsx
import React, { useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { PhIcon } from '../../../../components/ui/PhIcon';

export default function DropoffTypeScreen({ route, navigation }: any) {
  const { state, dispatch } = useSchedule();
  const { mode, editData } = route.params || {};
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const option1Anim = useRef(new Animated.Value(0)).current;
  const option2Anim = useRef(new Animated.Value(0)).current;

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
      animate(option1Anim, 320),
      animate(option2Anim, 420),
    ]).start();
  }, [headerAnim, titleAnim, option1Anim, option2Anim]);

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

  const selectType = (type: 'curb-side' | 'door-to-door') => {
    dispatch({ type: 'SET_DROPOFF_TYPE', payload: type });
    navigation.navigate('ShipmentSize');
  };

  const fadeUp = (value: Animated.Value, distance = 24) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />

      {/* Clean, premium header */}
      <Animated.View style={[styles.headerBackground, { paddingTop: insets.top + 12 }, fadeUp(headerAnim, -14)]}>
        <View style={styles.headerInnerContent}>
          <View style={styles.stepRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>STEP 1 OF 4</Text>
            </View>
          </View>

          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
              <PhIcon name="ArrowLeft" size={22} color="#FFFFFF" />
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
      </Animated.View>

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

          <View style={styles.optionsWrapper}>
            {/* Curb-side Option */}
            <Animated.View style={[styles.optionWrapper, fadeUp(option1Anim, 20)]}>
              <TouchableOpacity
                style={[styles.optionBox, state.dropoffType === 'curb-side' && styles.optionBoxActive]}
                onPress={() => selectType('curb-side')}
                activeOpacity={0.9}
              >
                <View style={[styles.activeIndicator, state.dropoffType === 'curb-side' && styles.activeIndicatorOn]}>
                  {state.dropoffType === 'curb-side' && (
                    <PhIcon name="Check" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={[styles.optionIconBox, state.dropoffType === 'curb-side' && styles.optionIconBoxActive]}>
                  <PhIcon 
                    name="MapPinLine" 
                    size={28} 
                    color={state.dropoffType === 'curb-side' ? colors.accent : colors.textPrimary} 
                  />
                </View>
                <Text style={styles.optionLabel}>Curb-side</Text>
                <Text style={styles.optionSub}>
                  Receiver meets the vehicle at the pickup point
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Door-to-door Option */}
            <Animated.View style={[styles.optionWrapper, fadeUp(option2Anim, 20)]}>
              <TouchableOpacity
                style={[styles.optionBox, state.dropoffType === 'door-to-door' && styles.optionBoxActive]}
                onPress={() => selectType('door-to-door')}
                activeOpacity={0.9}
              >
                <View style={[styles.activeIndicator, state.dropoffType === 'door-to-door' && styles.activeIndicatorOn]}>
                  {state.dropoffType === 'door-to-door' && (
                    <PhIcon name="Check" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={[styles.optionIconBox, state.dropoffType === 'door-to-door' && styles.optionIconBoxActive]}>
                  <PhIcon 
                    name="House" 
                    size={28} 
                    color={state.dropoffType === 'door-to-door' ? colors.accent : colors.textPrimary} 
                  />
                </View>
                <Text style={styles.optionLabel}>Door-to-Door</Text>
                <Text style={styles.optionSub}>
                  We deliver straight to the receiver's doorstep
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          <View style={styles.infoFooter}>
            <PhIcon name="Info" size={18} color={colors.accent} />
            <Text style={styles.infoFooterText}>
              You can change this later before confirming your booking.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  headerBackground: {
    backgroundColor: c.accent,
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 1,
  },
  headerInnerContent: {
    paddingHorizontal: 24,
  },
  stepRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
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
    gap: 16,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    maxWidth: '90%',
    fontWeight: '500',
    marginTop: 4,
  },

  scrollView: {
    flex: 1,
    backgroundColor: c.background,
    zIndex: 3,
    elevation: 3,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: c.background,
  },
  textTitleContainer: {
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: c.textSecondary,
    fontWeight: '400',
    lineHeight: 20,
  },

  optionsWrapper: {
    gap: 16,
    marginBottom: 24,
  },
  optionWrapper: { width: '100%' },
  optionBox: {
    width: '100%',
    backgroundColor: c.card,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: c.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  optionBoxActive: {
    borderColor: c.accent,
    borderWidth: 2,
    backgroundColor: c.accentSoft,
  },
  activeIndicator: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: c.border,
    backgroundColor: c.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeIndicatorOn: {
    backgroundColor: c.accent,
    borderColor: c.accent,
  },
  optionIconBox: {
    width: 72,
    height: 72,
    borderRadius: 24, // Squircle shape
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: c.border,
  },
  optionIconBoxActive: {
    backgroundColor: '#FFFFFF', // Solid white when active
    borderColor: c.accent,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: c.textPrimary,
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  optionSub: {
    fontSize: 13,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 20,
    fontWeight: '500',
  },

  infoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.accentSoft,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: c.accent,
  },
  infoFooterText: {
    flex: 1,
    fontSize: 13,
    color: c.textPrimary,
    fontWeight: '600',
    lineHeight: 18,
  },
});