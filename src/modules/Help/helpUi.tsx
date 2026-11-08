// src/modules/Help/helpUi.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import type { StatusView, Tone } from '../../services/ticketService';

export const ORANGE = '#F27024';

export const toneColors = (tone: Tone, c: ThemeColors, isDark: boolean) => {
  switch (tone) {
    case 'action': return { bg: isDark ? '#3A2411' : '#FFEDD5', fg: isDark ? '#FDBA74' : '#C2410C' };
    case 'review': return { bg: isDark ? '#0F2744' : '#DBEAFE', fg: isDark ? '#93C5FD' : '#1D4ED8' };
    case 'done':   return { bg: c.successBg, fg: c.success };
    default:       return { bg: isDark ? '#27272A' : '#F3F4F6', fg: c.textSecondary };
  }
};

export function StatusPill({ view }: { view: StatusView }) {
  const { colors, isDark } = useTheme();
  const t = toneColors(view.tone, colors, isDark);
  return (
    <View style={[pill.wrap, { backgroundColor: t.bg }]}>
      {view.tone === 'action' && <View style={[pill.dot, { backgroundColor: t.fg }]} />}
      <Text style={[pill.text, { color: t.fg }]} numberOfLines={1}>{view.label}</Text>
    </View>
  );
}

export function ScreenHeader({
  title, subtitle, onBack, right,
}: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  return (
    <View style={[hdr.wrap, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity
        onPress={onBack} hitSlop={10} activeOpacity={0.8}
        style={[hdr.back, { backgroundColor: colors.card, borderColor: colors.divider, shadowOpacity: isDark ? 0.3 : 0.06 }]}
      >
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={[hdr.title, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[hdr.sub, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={{ width: 40, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

const pill = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11.5, fontWeight: '800', letterSpacing: -0.1 },
});

const hdr = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  back: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowRadius: 6, elevation: 2,
  },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4 },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 1 },
});