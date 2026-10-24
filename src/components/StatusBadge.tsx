import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../utils/themeContext';
import { borderRadius, fontSize, fontWeight, spacing } from '../constants';

export type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'orange';

type Props = {
  label: string;
  variant?: StatusVariant;
  accessibilityLabel?: string;
};

const getColors = (variant: StatusVariant, isDark: boolean) => {
  switch (variant) {
    case 'success':
      return {
        bg: isDark ? '#0F2A1F' : '#ECFDF5',
        text: isDark ? '#34D399' : '#065F46',
        border: isDark ? '#1F5138' : '#A7F3D0',
      };
    case 'warning':
      return {
        bg: isDark ? '#2A1F0A' : '#FFFBEB',
        text: isDark ? '#FBBF24' : '#92400E',
        border: isDark ? '#5A3418' : '#FDE68A',
      };
    case 'error':
      return {
        bg: isDark ? '#2A1214' : '#FEF2F2',
        text: isDark ? '#F87171' : '#991B1B',
        border: isDark ? '#5A1F22' : '#FECACA',
      };
    case 'info':
      return {
        bg: isDark ? '#16243B' : '#EFF6FF',
        text: isDark ? '#93C5FD' : '#1E40AF',
        border: isDark ? '#1E3A8A' : '#BFDBFE',
      };
    case 'orange':
      return {
        bg: isDark ? '#2A1A0E' : '#FFF7ED',
        text: isDark ? '#FB923C' : '#9A3412',
        border: isDark ? '#5A3418' : '#FED7AA',
      };
    case 'neutral':
    default:
      return {
        bg: isDark ? '#1F262E' : '#F9FAFB',
        text: isDark ? '#D1D5DB' : '#374151',
        border: isDark ? '#232B34' : '#E5E7EB',
      };
  }
};

export default function StatusBadge({ label, variant = 'neutral', accessibilityLabel }: Props) {
  const { isDark } = useTheme();
  const colors = getColors(variant, isDark);

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel || label}
    >
      <Text style={[styles.text, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 1,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
});
