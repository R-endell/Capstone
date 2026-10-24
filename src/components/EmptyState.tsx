import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/themeContext';
import { spacing, fontSize, fontWeight } from '../constants';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  iconColor?: string;
};

export default function EmptyState({ icon = 'file-tray-outline', title, description, iconColor }: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.container} accessibilityRole="text">
      <View style={[styles.iconWrap, { backgroundColor: colors.divider }]}>
        <Ionicons name={icon} size={28} color={iconColor || colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['5xl'],
    paddingHorizontal: spacing['2xl'],
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  description: {
    fontSize: fontSize.base,
    textAlign: 'center',
    lineHeight: 20,
  },
});
