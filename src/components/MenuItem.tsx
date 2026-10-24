import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/themeContext';
import { touchTarget, spacing } from '../constants';

type MenuItemProps = {
  label: string;
  subtext?: string;
  onPress?: () => void;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  badge?: React.ReactNode;
  showChevron?: boolean;
  chevronColor?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: ViewStyle;
  disabled?: boolean;
};

export default function MenuItem({
  label,
  subtext,
  onPress,
  leftIcon,
  rightIcon,
  badge,
  showChevron = true,
  chevronColor,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  disabled = false,
}: MenuItemProps) {
  const { colors } = useTheme();

  const content = (
    <View style={[styles.container, style]}>
      <View style={styles.left}>
        {leftIcon ? <View style={styles.iconWrapper}>{leftIcon}</View> : null}
        <View style={styles.textWrapper}>
          <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>
            {label}
          </Text>
          {subtext ? (
            <Text style={[styles.subtext, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtext}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        {badge}
        {rightIcon}
        {showChevron && !rightIcon && !badge && onPress ? (
          <Ionicons name="chevron-forward" size={18} color={chevronColor || colors.textMuted} />
        ) : null}
      </View>
    </View>
  );

  if (onPress && !disabled) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        accessibilityHint={accessibilityHint}
        hitSlop={{ top: 2, bottom: 2, left: 2, right: 2 }}
        testID={testID}
        style={{ minHeight: touchTarget.min }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={{ minHeight: touchTarget.min }}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    minHeight: touchTarget.min,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },
  iconWrapper: {
    marginRight: 12,
  },
  textWrapper: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtext: {
    fontSize: 12,
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
