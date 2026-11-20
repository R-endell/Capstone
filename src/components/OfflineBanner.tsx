// src/components/OfflineBanner.tsx
//
// Alert strip (NOT a modal) shown over every screen while there is no internet.
// "Reconnect" re-checks right away; as soon as the internet is back the strip turns green, screens refresh
// themselves (they listen to useReconnectEpoch) and the strip slides away.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useConnectivity, retryConnection } from '../services/connectivityStore';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const { status, checking, justRestored } = useConnectivity();
  const visible = status === 'offline' || justRestored;

  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !visible) setMounted(false); });
  }, [visible, slide]);

  if (!mounted) return null;

  const restored = status === 'online';
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { paddingTop: insets.top + 6 },
        { opacity: slide, transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }] },
      ]}
    >
      <View style={[styles.bar, restored ? styles.barOk : styles.barOff]}>
        <Ionicons name={restored ? 'checkmark-circle' : 'cloud-offline'} size={20} color="#FFFFFF" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{restored ? 'Back online' : 'No internet connection'}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {restored ? 'Refreshing your data…' : 'Maps and jobs may not update until you reconnect.'}
          </Text>
        </View>
        {!restored && (
          <TouchableOpacity style={styles.btn} activeOpacity={0.85} onPress={() => { void retryConnection(); }} disabled={checking}>
            {checking
              ? <ActivityIndicator size="small" color="#B91C1C" />
              : <Text style={styles.btnText}>Reconnect</Text>}
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, zIndex: 9999, elevation: 9999 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 12,
  },
  barOff: { backgroundColor: '#B91C1C' },
  barOk: { backgroundColor: '#15803D' },
  title: { color: '#FFFFFF', fontSize: 13.5, fontFamily: 'Poppins_700Bold' },
  sub: { color: 'rgba(255,255,255,0.88)', fontSize: 11.5, fontFamily: 'Poppins_500Medium' },
  btn: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 12, height: 34, minWidth: 92, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#B91C1C', fontSize: 12.5, fontFamily: 'Poppins_700Bold' },
});