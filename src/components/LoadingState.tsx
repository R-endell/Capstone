import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../utils/themeContext';
import { spacing, fontSize, fontWeight, brand } from '../constants';

type Props = {
  message?: string;
};

export default function LoadingState({ message = 'Loading...' }: Props) {
  const { colors } = useTheme();

  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={brand.orange} />
      {message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
  },
  message: {
    marginTop: spacing.lg,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
});
