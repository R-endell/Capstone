// src/modules/Authentication/PermissionsPromptScreen.tsx
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Dimensions, Animated, Easing
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../App';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';

const PERMISSION_STEPS = [
  {
    id: 1,
    title: 'Turn on notifications',
    subtitle: "If you don't allow it, the app won't be able to send updates about the driver's arrival or your order status. To turn on notifications, please grant permission again.",
    buttonText: 'Grant permission again',
    imageSource: require('../../../assets/CellphoneNotification.png'),
  },
  {
    id: 2,
    title: 'Enable location services',
    subtitle: 'If location services are disabled, the app may show the wrong initial address and creating an order could take longer. To enable it, please grant location permission again.',
    buttonText: 'Grant permission again',
    imageSource: require('../../../assets/AllowLocation.png'),
  },
  {
    id: 3,
    title: 'Grant access to your phone',
    subtitle: 'Details about your device help us keep your personal data secure. To grant access, please request permission again.',
    buttonText: 'Grant permission again',
    imageSource: require('../../../assets/AllowAccess.png'),
  },
];

export default function PermissionsPromptScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [currentIndex, setCurrentIndex] = useState(0);
  const slideAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [glowAnim]);

  const handleNext = () => {
    Animated.sequence([
      Animated.timing(slideAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    if (currentIndex < PERMISSION_STEPS.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    }
  };

  const handleSkip = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' }],
    });
  };

  const currentStep = PERMISSION_STEPS[currentIndex];

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });
  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.06, 0.12],
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Ambient Background Glows */}
      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View
          style={[
            styles.glow,
            styles.glowTop,
            { transform: [{ scale: glowScale }], opacity: glowOpacity },
          ]}
        />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <Animated.View style={[styles.content, { opacity: slideAnim }]}>
        
        {/* Header with Brand Identity */}
        <View style={styles.headerContainer}>
          <View style={styles.brandRow}>
            <Image
              source={require('../../../assets/Pack-N-Ship-Logo2.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.brandText}>
              Pack-<Text style={styles.brandTextOrange}>N-Ship</Text>
            </Text>
          </View>
        </View>

        {/* Illustration Container */}
        <View style={styles.illustrationContainer}>
          <Image
            source={currentStep.imageSource}
            style={styles.illustrationImage}
            resizeMode="contain"
          />
        </View>

        {/* Text Details */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>{currentStep.title}</Text>
          <Text style={styles.subtitle}>{currentStep.subtitle}</Text>
        </View>

        {/* Pagination Indicators */}
        <View style={styles.paginationRow}>
          {PERMISSION_STEPS.map((step, index) => (
            <View
              key={step.id}
              style={[
                styles.paginationDot,
                index === currentIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>

        {/* Action Buttons */}
        <View style={styles.footerContainer}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={handleNext}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>{currentStep.buttonText}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            activeOpacity={0.7}
          >
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </View>

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  glowTop: {
    width: 360,
    height: 360,
    top: -160,
    right: -140,
  },
  glowBottom: {
    width: 300,
    height: 300,
    bottom: -140,
    left: -120,
    opacity: 0.05,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingVertical: 20,
  },
  headerContainer: {
    alignItems: 'flex-start',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoImage: {
    width: 42,
    height: 42,
  },
  brandText: {
    fontSize: 20,
    fontWeight: '800',
    fontStyle: 'italic',
    color: '#111827',
    letterSpacing: -0.3,
  },
  brandTextOrange: {
    color: ORANGE,
  },
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: width * 0.7,
  },
  illustrationImage: {
    width: width * 0.65,
    height: width * 0.65,
  },
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  paginationDot: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 24,
    backgroundColor: ORANGE,
  },
  dotInactive: {
    width: 6,
    backgroundColor: '#E5E7EB',
  },
  footerContainer: {
    gap: 8,
  },
  primaryButton: {
    backgroundColor: ORANGE,
    height: 54,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  skipButton: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  skipButtonText: {
    color: ORANGE,
    fontWeight: '600',
    fontSize: 15,
  },
});