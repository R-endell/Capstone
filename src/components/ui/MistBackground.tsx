// src/components/ui/MistBackground.tsx
import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '../../utils/themeContext';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

export const MistBackground = () => {
  const { isDark } = useTheme();

  // We simulate a gradient using stacked views with decreasing opacities.
  // This is highly performant and avoids the Android Fabric crash.
  const layers = isDark ? 6 : 8;
  const baseColor = '242, 112, 36'; // Orange RGB

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 0 }]} pointerEvents="none">
      {Array.from({ length: layers }).map((_, i) => {
        const progress = i / layers;
        // In dark mode, the mist fades faster and is more subtle
        const opacity = isDark 
          ? 0.15 - (progress * 0.15) 
          : 0.10 - (progress * 0.10);
        
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: (SCREEN_H * 0.45) * (1 - progress * 0.5), // Shrinks as it goes down
              backgroundColor: `rgba(${baseColor}, ${opacity})`,
              borderBottomLeftRadius: SCREEN_W,
              borderBottomRightRadius: SCREEN_W,
            }}
          />
        );
      })}
    </View>
  );
};