// src/modules/Dashboard/Sender/Delivery/DropoffTypeScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, ScrollView, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { SolarIcon } from '../../../../components/ui/SolarIcon'; // ✅ Unified Icons

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

  const [curbConfirmVisible, setCurbConfirmVisible] = useState(false);

  const proceedWithType = (type: 'curb-side' | 'door-to-door') => {
    setCurbConfirmVisible(false);
    dispatch({ type: 'SET_DROPOFF_TYPE', payload: type });
    navigation.navigate('ShipmentSize');
  };

  const selectType = (type: 'curb-side' | 'door-to-door') => {
    if (type === 'curb-side') {
      setCurbConfirmVisible(true);
      return;
    }
    proceedWithType('door-to-door');
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
              <SolarIcon name="ArrowLeft" variant="linear" size={22} color="#FFFFFF" />
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
                    <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={[styles.optionIconBox, state.dropoffType === 'curb-side' && styles.optionIconBoxActive]}>
                  <SolarIcon name="MapPoint" variant="duotone" size={28} />
                </View>

                <View style={styles.priceBadgeRow}>
                  <Text style={styles.optionLabel}>Curb-side</Text>
                  <View style={styles.pricePill}>
                    <Text style={styles.pricePillText}>₱20 base</Text>
                  </View>
                </View>

                <View style={styles.policyTag}>
                  <Text style={styles.policyTagText}>STRICT NO DETOUR · MAIN ROAD ONLY</Text>
                </View>

                <Text style={styles.optionSub}>
                  Drivers stay strictly on their main route. Both you and your receiver must meet the driver curbside at the nearest main-road landmark (within 200 m).
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
                    <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" />
                  )}
                </View>

                <View style={[styles.optionIconBox, state.dropoffType === 'door-to-door' && styles.optionIconBoxActive]}>
                  <SolarIcon name="Routing" variant="duotone" size={28} />
                </View>

                <View style={styles.priceBadgeRow}>
                  <Text style={styles.optionLabel}>Door-to-Door</Text>
                  <View style={[styles.pricePill, styles.pricePillAccent]}>
                    <Text style={[styles.pricePillText, { color: '#FFFFFF' }]}>₱45 base (+₱25)</Text>
                  </View>
                </View>

                <Text style={styles.optionSub}>
                  Driver detours off the main road (up to 500 m) to pick up and deliver straight to your exact gate or doorstep.
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          <View style={styles.infoFooter}>
            <SolarIcon name="ShieldCheck" variant="duotone" size={18} color={colors.accent} />
            <Text style={styles.infoFooterText}>
              Your delivery type is final once payment is completed. Choose Door-to-Door if you cannot walk to the main road.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Curb-side No-Detour Confirmation Modal */}
      <Modal
        visible={curbConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCurbConfirmVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCurbConfirmVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalIconWrap}>
              <SolarIcon name="MapPoint" variant="bold" size={26} color={colors.accent} />
            </View>
            <Text style={styles.modalTitle}>Curb-side Rules (No Detour)</Text>
            <Text style={styles.modalSub}>
              Before choosing Curb-side (₱20 base), please make sure you and your receiver agree to the following:
            </Text>

            <View style={styles.ruleList}>
              <View style={styles.ruleRow}>
                <SolarIcon name="CheckCircle" variant="duotone" size={16} color={colors.accent} />
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>No side-street detours: </Text>
                  The driver will stay strictly on their main route and will not enter inner streets or subdivisions.
                </Text>
              </View>
              <View style={styles.ruleRow}>
                <SolarIcon name="CheckCircle" variant="duotone" size={16} color={colors.accent} />
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>Meet at a main-road landmark: </Text>
                  If your pin is more than 15 m off the route, the app will guide you to the nearest landmark (e.g. store or corner) along the driver’s path.
                </Text>
              </View>
              <View style={styles.ruleRow}>
                <SolarIcon name="CheckCircle" variant="duotone" size={16} color={colors.accent} />
                <Text style={styles.ruleText}>
                  <Text style={styles.ruleBold}>Remind your receiver: </Text>
                  Your receiver must also wait curbside along the main road. This choice is final once paid.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => proceedWithType('curb-side')}
              activeOpacity={0.9}
            >
              <Text style={styles.modalPrimaryText}>I Understand, Keep Curb-side (₱20)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSwitchBtn}
              onPress={() => proceedWithType('door-to-door')}
              activeOpacity={0.85}
            >
              <Text style={styles.modalSwitchText}>Switch to Door-to-Door (₱45 · +₱25)</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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
  
  // ✅ ATOME TYPOGRAPHY
  stepText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontFamily: 'Poppins_800ExtraBold',
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
  
  // ✅ ATOME TYPOGRAPHY
  headerSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Poppins_600SemiBold',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 20,
    maxWidth: '90%',
    fontFamily: 'Poppins_400Regular',
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
  
  // ✅ ATOME TYPOGRAPHY
  cardTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: c.textSecondary,
    fontFamily: 'Poppins_400Regular',
    lineHeight: 20,
  },

  optionsWrapper: {
    gap: 16,
    marginBottom: 24,
  },
  optionWrapper: { width: '100%' },
  
  // ✅ ATOME BORDERS & SHADOWS
  optionBox: {
    width: '100%',
    backgroundColor: c.card,
    borderRadius: 12, // Flatter radius
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', // Subtle border
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02, // Flat shadow
    shadowRadius: 1,
    elevation: 0,
  },
  optionBoxActive: {
    borderColor: c.accent,
    borderWidth: 1.5,
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
    borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
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
    borderRadius: 12, // Matches card radius
    backgroundColor: c.background,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  optionIconBoxActive: {
    backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : '#FFFFFF', // Handles dark mode
    borderColor: c.accent,
  },
  
  // ✅ ATOME TYPOGRAPHY
  optionLabel: {
    fontSize: 16,
    fontFamily: 'Poppins_700Bold',
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
    fontFamily: 'Poppins_400Regular',
  },

  infoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.accentSoft,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: c.accent,
  },
  
  // ✅ ATOME TYPOGRAPHY
  infoFooterText: {
    flex: 1,
    fontSize: 13,
    color: c.textPrimary,
    fontFamily: 'Poppins_500Medium',
    lineHeight: 18,
  },

  priceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pricePill: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: c.background,
    borderWidth: 1,
    borderColor: c.border,
  },
  pricePillAccent: {
    backgroundColor: c.accent,
    borderColor: c.accent,
  },
  pricePillText: {
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
  },
  policyTag: {
    backgroundColor: c.warningBg,
    borderWidth: 1,
    borderColor: c.warning,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  policyTagText: {
    fontSize: 9.5,
    fontFamily: 'Poppins_800ExtraBold',
    color: c.warning,
    letterSpacing: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: c.card,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  modalIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: c.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: c.textPrimary,
    textAlign: 'center',
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 12.5,
    fontFamily: 'Poppins_400Regular',
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  ruleList: {
    gap: 10,
    backgroundColor: c.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  ruleText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: c.textPrimary,
    lineHeight: 17,
  },
  ruleBold: {
    fontFamily: 'Poppins_700Bold',
  },
  modalPrimaryBtn: {
    backgroundColor: c.accent,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: 'Poppins_700Bold',
  },
  modalSwitchBtn: {
    backgroundColor: c.accentSoft,
    borderWidth: 1,
    borderColor: c.accent,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalSwitchText: {
    color: c.accent,
    fontSize: 13.5,
    fontFamily: 'Poppins_700Bold',
  },
});