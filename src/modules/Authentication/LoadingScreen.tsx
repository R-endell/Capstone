// src/modules/Authentication/LoadingScreen.tsx
import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
  LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../App';
import { supabase } from '../../utils/supabase';
import { resolveHomeRoute } from '../../utils/resolveHomeRoute';
import { registerPushToken } from '../../services/pushService';
import { useTheme, ThemeColors } from '../../utils/themeContext';

/** Timing */
const SPLASH_DURATION = 2500;
const STATUS_INTERVAL = 900;
const STATUS_MESSAGES = [
  'Connecting to service',
  'Securing your session',
  'Preparing your workspace',
];

export default function LoadingScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  /** Animated values */
  const logoAnim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const footerAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const statusAnim = useRef(new Animated.Value(1)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  const [statusIndex, setStatusIndex] = useState(0);
  const [trackWidth, setTrackWidth] = useState(200);

  /* ------------------------------------------------------------------ */
  /* Navigation                                                          */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          navigation.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
          return;
        }

        const route = await resolveHomeRoute(session.user.id);

        (async () => {
          try {
            const { data: userRow } = await supabase
              .from('users')
              .select('user_id')
              .eq('auth_id', session.user.id)
              .maybeSingle();
            if (userRow?.user_id) {
              await registerPushToken(userRow.user_id);
            }
          } catch (e) {
            console.warn('[push] boot registration skipped:', e);
          }
        })();

        navigation.reset({
          index: 0,
          routes: [{ name: route }],
        });
      } catch (error) {
        console.error('Session restore error:', error);
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' }],
        });
      }
    }, SPLASH_DURATION);

    return () => clearTimeout(timer);
  }, [navigation]);

  /* ------------------------------------------------------------------ */
  /* Logo entrance + breathing pulse + background glow                   */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    // Staggered Entrance
    Animated.sequence([
      Animated.timing(logoAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(titleAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(footerAnim, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();
    glow.start();

    return () => {
      pulse.stop();
      glow.stop();
    };
  }, [logoAnim, titleAnim, footerAnim, pulseAnim, glowAnim]);

  /* ------------------------------------------------------------------ */
  /* Progress bar & Shimmer                                              */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: SPLASH_DURATION,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();

    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    shimmerLoop.start();

    return () => shimmerLoop.stop();
  }, [progressAnim, shimmerAnim]);

  /* ------------------------------------------------------------------ */
  /* Status message rotation                                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const interval = setInterval(() => {
      Animated.timing(statusAnim, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setStatusIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
        Animated.timing(statusAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }, STATUS_INTERVAL);

    return () => clearInterval(interval);
  }, [statusAnim]);

  /* ------------------------------------------------------------------ */
  /* Interpolations                                                      */
  /* ------------------------------------------------------------------ */
  const logoScale = logoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });
  const logoTranslateY = logoAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });
  const titleTranslateY = titleAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 0],
  });
  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.035],
  });
  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const footerTranslateY = footerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [15, 0],
  });
  const progressTranslateX = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-trackWidth, 0],
  });
  const shimmerTranslateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-trackWidth, trackWidth],
  });

  const handleTrackLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0 && width !== trackWidth) {
      setTrackWidth(width);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.backgroundLayer} pointerEvents="none">
        <Animated.View
          style={[
            styles.glow,
            styles.glowTop,
            { transform: [{ scale: glowScale }] },
          ]}
        />
        <View style={[styles.glow, styles.glowBottom]} />
      </View>

      <View style={styles.contentContainer}>
        
        {/* Logo Section */}
        <View style={styles.logoSection}>
          <Animated.View
            style={[
              styles.logoWrapper,
              {
                opacity: logoAnim,
                transform: [{ translateY: logoTranslateY }, { scale: logoScale }],
              },
            ]}
          >
            <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
              <Image
                source={require('../../../assets/appiconfinal2.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </Animated.View>
          </Animated.View>

          <Animated.View style={{ opacity: titleAnim, transform: [{ translateY: titleTranslateY }] }}>
            <Text style={styles.logoText}>
              Pack-<Text style={styles.logoTextOrange}>N</Text>-Ship
            </Text>
          </Animated.View>
        </View>

        {/* Footer Section (Progress & Status) */}
        <Animated.View
          style={[
            styles.bottomSection,
            {
              opacity: footerAnim,
              transform: [{ translateY: footerTranslateY }],
              paddingBottom: Math.max(insets.bottom, 24),
            },
          ]}
        >
          <View style={styles.progressTrack} onLayout={handleTrackLayout}>
            <Animated.View
              style={[
                styles.progressFill,
                { transform: [{ translateX: progressTranslateX }] },
              ]}
            />
            {/* Shimmer Overlay */}
            <Animated.View
              style={[
                styles.shimmerOverlay,
                { transform: [{ translateX: shimmerTranslateX }, { skewX: '-20deg' }] },
              ]}
            />
          </View>

          <Animated.Text style={[styles.loadingText, { opacity: statusAnim }]}>
            {STATUS_MESSAGES[statusIndex]}
          </Animated.Text>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: isDark ? 'rgba(242, 112, 36, 0.1)' : 'rgba(242, 112, 36, 0.06)',
  },
  glowTop: {
    width: 340,
    height: 340,
    top: -150,
    right: -130,
  },
  glowBottom: {
    width: 280,
    height: 280,
    bottom: -120,
    left: -110,
  },
  contentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 48,
  },
  logoSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8, // Clean spacing between image and text
  },
  logoWrapper: {
    marginBottom: 10,
  },
  logoImage: {
    width: 220, // Slightly smaller for better proportion
    height: 120,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '900',
    color: c.textPrimary,
    letterSpacing: -1.5, // Tighter, more modern typography
  },
  logoTextOrange: {
    color: c.accent,
  },
  bottomSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
  },
  progressTrack: {
    width: 220,
    height: 6, // Slightly thicker for a more premium feel
    borderRadius: 999,
    backgroundColor: c.divider,
    overflow: 'hidden',
    marginBottom: 20, // Breathing room before text
    position: 'relative',
  },
  progressFill: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: c.accent,
  },
  shimmerOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.textSecondary,
    letterSpacing: 0.5, // Wider tracking for subtitle
    textAlign: 'center',
  },
});