// src/components/map/MapDot.tsx
// Round numbered/lettered marker body, used inside <Marker>.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function MapDot({ color, label, size = 26 }: { color: string; label?: string; size?: number }) {
  return (
    <View style={[styles.dot, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}>
      {!!label && <Text style={styles.text}>{label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  text: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
});