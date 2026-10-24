import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../utils/themeContext';
import { spacing, fontSize, fontWeight } from '../constants';

type Props = {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onActionPress?: () => void;
  style?: any;
};

export default function SectionHeader({ title, subtitle, actionLabel, onActionPress, style }: Props) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onActionPress ? (
        <TouchableOpacity onPress={onActionPress} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={[styles.action, { color: colors.textSecondary }]}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing['2xl'],
    marginBottom: spacing.md + 2,
  },
  textContainer: {
    flex: 1,
    paddingRight: spacing.lg,
  },
  title: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.extrabold,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: fontSize.base,
    marginTop: spacing.xs,
  },
  action: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    marginTop: 2,
  },
});
