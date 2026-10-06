// src/modules/Dashboard/Sender/HomeScreen.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  Easing,
  Image,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../../App';

/** Brand */
const ORANGE = '#F27024';
const ORANGE_SOFT = '#FFF4EC';
const ORANGE_BORDER = '#FFD9B8';

export default function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  // Simulated User Data for UI Polish
  const [userName] = useState('Kenchi');

  // Entrance Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const actionsAnim = useRef(new Animated.Value(0)).current;
  const promoAnim = useRef(new Animated.Value(0)).current;
  const tipsAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.stagger(100, [
      animate(headerAnim, 0),
      animate(actionsAnim, 0),
      animate(promoAnim, 0),
      animate(tipsAnim, 0),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bellPulse, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();

    return () => pulse.stop();
  }, [headerAnim, actionsAnim, promoAnim, tipsAnim, bellPulse]);

  const handleSendPackage = () => {
    navigation.navigate('DropoffType', { mode: 'sendNow' });
  };

  const handleScheduleDelivery = () => {
    navigation.navigate('DropoffType', { mode: 'schedule' });
  };

  const handleViewNotifications = () => {
    Alert.alert('Coming Soon', 'Notifications will be available in the next update.');
  };

  const handleContentTap = (title: string) => {
    Alert.alert(title, 'This feature will be available in a future update.');
  };

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

  const bellScale = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const bellOpacity = bellPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.85],
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
      >
        {/* HEADER & GREETING SECTION */}
        <Animated.View style={[styles.header, fadeUp(headerAnim, -10)]}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingTitle}>Hello, {userName} 👋</Text>
            <Text style={styles.greetingSubtitle}>Ready to send a package today?</Text>
          </View>

          <Animated.View style={{ transform: [{ scale: bellScale }], opacity: bellOpacity }}>
            <TouchableOpacity
              style={styles.notificationIcon}
              onPress={handleViewNotifications}
              activeOpacity={0.8}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="notifications-outline" size={22} color="#111827" />
              <View style={styles.notificationBadge} />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>

        {/* ACTIONS SECTION */}
        <Animated.View style={[styles.actionContainer, fadeUp(actionsAnim)]}>
          {/* Primary: Send Package Now */}
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardPrimary]}
            onPress={handleSendPackage}
            activeOpacity={0.85}
          >
            <View style={[styles.actionIconContainer, styles.actionIconPrimary]}>
              <Image
                source={require('../../../../assets/send-package-now.png')}
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitlePrimary}>Send Package Now</Text>
              <Text style={styles.actionSubtitlePrimary}>
                Instant booking & real-time tracking
              </Text>
            </View>
            <View style={styles.chevronPrimary}>
              <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
            </View>
          </TouchableOpacity>

          {/* Secondary: Schedule a Delivery */}
          <TouchableOpacity
            style={[styles.actionCard, styles.actionCardSecondary]}
            onPress={handleScheduleDelivery}
            activeOpacity={0.85}
          >
            <View style={styles.actionIconContainer}>
              <Image
                source={require('../../../../assets/schedule-delivery-calendar.png')}
                style={styles.actionCustomIcon}
                resizeMode="contain"
              />
            </View>
            <View style={styles.actionTextContainer}>
              <Text style={styles.actionTitle}>Schedule a Delivery</Text>
              <Text style={styles.actionSubtitle}>
                Plan shipments for a future date
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>

        {/* PROMOTIONS SECTION */}
        <Animated.View style={[styles.sectionContainer, fadeUp(promoAnim)]}>
          <Text style={styles.sectionTitle}>Special Offers</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.promoScrollContainer}
          >
            <TouchableOpacity 
              style={[styles.promoCard, { backgroundColor: '#FFF7ED', borderColor: '#FFE4D2' }]}
              activeOpacity={0.85}
              onPress={() => handleContentTap('20% Off Promotion')}
            >
              <View style={[styles.promoIconWrap, { backgroundColor: '#FFEDD5' }]}>
                <Ionicons name="ticket" size={24} color="#EA580C" />
              </View>
              <View>
                <Text style={styles.promoTitle}>20% Off First Delivery</Text>
                <Text style={styles.promoSub}>Use code WELCOME20</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.promoCard, { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7' }]}
              activeOpacity={0.85}
              onPress={() => handleContentTap('Free Priority Matching')}
            >
              <View style={[styles.promoIconWrap, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="flash" size={24} color="#16A34A" />
              </View>
              <View>
                <Text style={styles.promoTitle}>Fast Track Upgrade</Text>
                <Text style={styles.promoSub}>Free priority courier matching</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>

        {/* SHIPPING TIPS SECTION */}
        <Animated.View style={[styles.sectionContainer, fadeUp(tipsAnim)]}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Shipping Tips & Guides</Text>
            <TouchableOpacity onPress={() => handleContentTap('All Tips')}>
              <Text style={styles.seeAllText}>See all</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            style={styles.tipCard} 
            activeOpacity={0.8}
            onPress={() => handleContentTap('Packing Fragile Items')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="cube-outline" size={20} color={ORANGE} />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>How to Pack Fragile Items</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Use adequate bubble wrap and secure the corners to prevent any damage during transit.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.tipCard} 
            activeOpacity={0.8}
            onPress={() => handleContentTap('Weight Guidelines')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="scale-outline" size={20} color={ORANGE} />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>Understanding Weight Guidelines</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Ensure your package weight is accurate to avoid unexpected extra charges.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.tipCard} 
            activeOpacity={0.8}
            onPress={() => handleContentTap('Prohibited Items')}
          >
            <View style={styles.tipIconWrap}>
              <Ionicons name="warning-outline" size={20} color="#EF4444" />
            </View>
            <View style={styles.tipTextWrap}>
              <Text style={styles.tipTitle}>Prohibited Delivery Items</Text>
              <Text style={styles.tipSub} numberOfLines={2}>
                Review the list of items that our courier partners are not allowed to transport.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
          </TouchableOpacity>
        </Animated.View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  scrollContent: {
    paddingBottom: Platform.OS === 'ios' ? 50 : 40,
  },

  /* ── Header & Greeting ─────────────────────────────── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 32,
  },
  greetingTextContainer: {
    flex: 1,
    paddingRight: 16,
  },
  greetingTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  greetingSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '400',
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  notificationBadge: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },

  /* ── Action Cards ──────────────────────────────────── */
  actionContainer: {
    paddingHorizontal: 24,
    marginBottom: 28,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 16,
    marginBottom: 14,
    minHeight: 80,
  },
  actionCardPrimary: {
    backgroundColor: ORANGE,
    borderWidth: 0,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  actionCardSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  actionIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: ORANGE_SOFT,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
  },
  actionIconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  actionCustomIcon: {
    width: 28,
    height: 28,
  },
  actionTextContainer: {
    flex: 1,
    paddingRight: 8,
  },
  actionTitlePrimary: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  actionSubtitlePrimary: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    marginTop: 3,
    fontWeight: '400',
  },
  actionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  actionSubtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 3,
    fontWeight: '400',
  },
  chevronPrimary: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Bottom Content Sections ───────────────────────── */
  sectionContainer: {
    marginBottom: 28,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
    paddingHorizontal: 24,
    marginBottom: 14,
  },
  seeAllText: {
    fontSize: 14,
    fontWeight: '700',
    color: ORANGE,
  },

  /* Promotions */
  promoScrollContainer: {
    paddingHorizontal: 24,
    gap: 12,
  },
  promoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    width: 260,
  },
  promoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  promoTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  promoSub: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '500',
  },

  /* Shipping Tips */
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 24,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  tipIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  tipTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  tipTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  tipSub: {
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 16,
  },
});