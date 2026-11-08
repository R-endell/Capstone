// src/components/SupportFab.tsx
// Draggable help button. It no longer holds its own support modal or data loading:
// it just opens the Help Center, with a badge when a ticket is waiting on you.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Easing, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../utils/themeContext';
import { countNeedingMyAction, subscribeTickets } from '../services/ticketService';

const ORANGE = '#FF751F';
const FAB_SIZE = 54;
const EDGE_PADDING = 10;
const TOP_SAFE = 80;
const BOTTOM_SAFE = 100;
const DRAG_THRESHOLD = 6;

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

type Props = {
  role: 'sender' | 'provider';
};

export default function SupportFab({ role }: Props) {
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // ---------- Drag / Move ----------
  const pan = useRef(new Animated.ValueXY({
    x: SCREEN_W - FAB_SIZE - EDGE_PADDING,
    y: SCREEN_H - FAB_SIZE - BOTTOM_SAFE,
  })).current;

  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  // PanResponder built once — moves the FAB while dragging,
  // and snaps to the closest side (left/right) on release.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > DRAG_THRESHOLD ||
        Math.abs(gesture.dy) > DRAG_THRESHOLD,
      onPanResponderGrant: () => {
        setIsDragging(true);
        const flat = (pan as any).__getValue?.() || { x: 0, y: 0 };
        dragStart.current = { x: flat.x, y: flat.y };
        pan.setOffset({ x: flat.x, y: flat.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: (_evt, gesture) => {
        pan.flattenOffset();
        const finalX = dragStart.current.x + gesture.dx;
        const finalY = dragStart.current.y + gesture.dy;

        // Snap to nearest edge (left or right)
        const centerX = finalX + FAB_SIZE / 2;
        const snapToRight = centerX > SCREEN_W / 2;
        const targetX = snapToRight
          ? SCREEN_W - FAB_SIZE - EDGE_PADDING
          : EDGE_PADDING;

        // Clamp Y within safe area
        const clampedY = Math.max(
          TOP_SAFE,
          Math.min(finalY, SCREEN_H - FAB_SIZE - BOTTOM_SAFE),
        );

        Animated.spring(pan, {
          toValue: { x: targetX, y: clampedY },
          useNativeDriver: false,
          friction: 7,
          tension: 60,
        }).start(() => {
          setIsDragging(false);
        });
      },
      onPanResponderTerminate: () => {
        pan.flattenOffset();
        setIsDragging(false);
      },
    }),
  ).current;

  // ---------- Pulse + badge ----------
  const pulse = useRef(new Animated.Value(0)).current;
  const [badge, setBadge] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  const refreshBadge = useCallback(() => {
    countNeedingMyAction().then(setBadge).catch(() => {});
  }, []);
  useFocusEffect(useCallback(() => { refreshBadge(); }, [refreshBadge]));
  useEffect(() => subscribeTickets(refreshBadge), [refreshBadge]);

  const openHelp = () => {
    if (isDragging) return;
    navigation.navigate('Support', { role });
  };

  return (
    <Animated.View
      style={[styles.fabWrap, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      <Animated.View style={[styles.fabGlow, { opacity: glowOpacity }]} pointerEvents="none" />
      <TouchableOpacity
        style={styles.fab}
        onPress={openHelp}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Help"
      >
        <Ionicons name="headset" size={22} color="#FFFFFF" />
      </TouchableOpacity>
      {badge > 0 && (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Animated.View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  fabWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 999,
    width: FAB_SIZE,
    height: FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlow: {
    position: 'absolute', width: 62, height: 62, borderRadius: 31,
    backgroundColor: 'rgba(255,117,31,0.35)',
  },
  fab: {
    width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 8,
    borderWidth: 2, borderColor: c.card,
  },
  badge: {
    position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10,
    paddingHorizontal: 5, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: c.background,
  },
  badgeText: { color: '#FFF', fontSize: 10.5, fontWeight: '800' },
});