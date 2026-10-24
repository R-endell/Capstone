import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ImageSourcePropType } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/themeContext';
import { brand, spacing, borderRadius, fontSize, fontWeight, shadows, touchTarget } from '../constants';

type Props = {
  title: string;
  subtitle: string;
  onPress: () => void;
  imageSource?: ImageSourcePropType;
  variant?: 'primary' | 'secondary';
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export default function ActionCard({
  title,
  subtitle,
  onPress,
  imageSource,
  variant = 'primary',
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const { colors, isDark } = useTheme();
  const isPrimary = variant === 'primary';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isPrimary ? styles.cardPrimary : styles.cardSecondary,
        isPrimary ? shadows.orange : shadows.md,
        { borderColor: isPrimary ? 'transparent' : colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint || subtitle}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <View style={[styles.iconContainer, isPrimary ? styles.iconPrimary : styles.iconSecondary, { borderColor: isPrimary ? 'rgba(255,255,255,0.35)' : brand.orange }]}>
        <Image source={imageSource} style={styles.icon} resizeMode="contain" />
      </View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, isPrimary ? styles.titlePrimary : { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.subtitle, isPrimary ? styles.subtitlePrimary : { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      {isPrimary ? (
        <View style={styles.chevronPrimary}>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing.lg + 2,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md + 2,
    minHeight: touchTarget.min + 36,
  },
  cardPrimary: {
    backgroundColor: brand.orange,
    borderWidth: 0,
  },
  cardSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
  },
  iconContainer: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md + 2,
    borderWidth: 1,
  },
  iconPrimary: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  iconSecondary: {
    backgroundColor: '#FFF7ED',
  },
  icon: {
    width: 28,
    height: 28,
  },
  textContainer: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  titlePrimary: {
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: fontSize.base,
    marginTop: 3,
    fontWeight: fontWeight.regular,
  },
  subtitlePrimary: {
    color: 'rgba(255,255,255,0.88)',
  },
  chevronPrimary: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
