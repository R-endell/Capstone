// src/modules/Help/helpUi.tsx
import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Animated, Easing, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { SolarIcon } from '../../components/ui/SolarIcon';
import type { StatusView, Tone, TimelineStep } from '../../services/ticketService';

export const ORANGE = '#F27024';

/* ---------- motion helpers (copied from RegisterProviderScreen) ---------- */
export const fadeUp = (value: Animated.Value, distance = 24) => ({
  opacity: value,
  transform: [{
    translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
  }],
});

export const useStagedEntrance = (count: number) => {
  const anims = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    const animate = (v: Animated.Value, delay: number) =>
      Animated.timing(v, { toValue: 1, duration: 600, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel(anims.map((v, i) => animate(v, i * 150))).start();
  }, [anims]);
  return anims;
};

/* ---------- tone palette (unchanged) ---------- */
export const toneColors = (tone: Tone, c: ThemeColors, isDark: boolean) => {
  switch (tone) {
    case 'action': return { bg: isDark ? '#3A2411' : '#FFEDD5', fg: isDark ? '#FDBA74' : '#C2410C' };
    case 'review': return { bg: isDark ? '#0F2744' : '#DBEAFE', fg: isDark ? '#93C5FD' : '#1D4ED8' };
    case 'done':   return { bg: c.successBg, fg: c.success };
    default:       return { bg: isDark ? '#27272A' : '#F3F4F6', fg: c.textSecondary };
  }
};

/* ---------- StatusPill (design: radius 999, Poppins_800ExtraBold 11.5) ---------- */
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

/* ---------- ScreenHeader: RegisterProvider visual spec ---------- */
export function ScreenHeader({
  title, subtitle, onBack, right,
}: { title: string; subtitle?: string; onBack: () => void; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter]);
  return (
    <Animated.View style={[hdr.wrap, { paddingTop: insets.top + 12 }, fadeUp(enter, -14)]}>
      <TouchableOpacity
        onPress={onBack} activeOpacity={0.85}
        style={[hdr.back, {
          backgroundColor: colors.card,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
        }]}
      >
        <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={[hdr.title, { color: colors.textPrimary }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[hdr.sub, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={{ width: 42, alignItems: 'flex-end' }}>{right}</View>
    </Animated.View>
  );
}

/* ---------- SectionCard: the uploadSection/detailsSection shell ---------- */
export function SectionCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors, isDark } = useTheme();
  return (
    <View style={[card.wrap, {
      backgroundColor: colors.card,
      borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    }, style]}>
      {children}
    </View>
  );
}

/* ---------- SectionHeader: numbered badge + title + subtitle + right slot ---------- */
export function SectionHeader({
  number, title, subtitle, right,
}: { number: number; title: string; subtitle?: string; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={shead.row}>
      <View style={[shead.badge, { backgroundColor: colors.accent, shadowColor: colors.accent }]}>
        <Text style={shead.badgeText}>{number}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[shead.title, { color: colors.textPrimary }]}>{title}</Text>
        {subtitle ? <Text style={[shead.sub, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/* ---------- Note: lockedNote / manualNote / infoNote pattern ---------- */
type NoteTone = 'success' | 'warning' | 'info' | 'neutral';
export function Note({
  tone = 'info', icon, children,
}: { tone?: NoteTone; icon: React.ReactNode; children: React.ReactNode }) {
  const { colors, isDark } = useTheme();
  const bg = tone === 'success' ? colors.successBg
    : tone === 'warning' ? colors.warningBg
    : tone === 'info' ? colors.infoSoft
    : colors.divider;
  const border = tone === 'success' ? colors.success
    : tone === 'warning' ? colors.warning
    : tone === 'info' ? (isDark ? 'rgba(96,165,250,0.2)' : 'rgba(59,130,246,0.2)')
    : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)');
  const fg = tone === 'success' ? colors.success
    : tone === 'warning' ? colors.warning
    : tone === 'info' ? colors.info
    : colors.textSecondary;
  return (
    <View style={[note.wrap, { backgroundColor: bg, borderColor: border }]}>
      {icon}
      <Text style={[note.text, { color: fg }]}>{children}</Text>
    </View>
  );
}

/* ---------- PrimaryButton: registerButton with press spring ---------- */
export function PrimaryButton({
  label, onPress, disabled, loading, icon,
}: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; icon?: React.ReactNode }) {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  return (
    <Animated.View style={{ width: '100%', transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
        disabled={disabled || loading} activeOpacity={0.9}
        style={[btn.base, { backgroundColor: disabled || loading ? colors.textMuted : colors.accent, shadowColor: colors.accent }]}
      >
        {loading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={btn.text}>{label}</Text>
          </View>
        ) : (
          <>
            {icon}
            <Text style={btn.text}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ---------- EmptyTile: dashed upload tile ---------- */
export function EmptyTile({
  label, icon, filled, onPress, disabled, height = 140,
}: { label: string; icon: React.ReactNode; filled?: boolean; onPress: () => void; disabled?: boolean; height?: number }) {
  const { colors, isDark } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress} disabled={disabled} activeOpacity={0.85}
      style={[tile.base, {
        height,
        backgroundColor: filled ? colors.accentSoft : colors.background,
        borderColor: filled ? colors.accent : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'),
        borderStyle: filled ? 'solid' : 'dashed',
      }]}
    >
      <View style={{ alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {icon}
        <Text style={[tile.text, { color: colors.textSecondary }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

/* ---------- TicketStepper: aligned to RegisterProvider progressRow ---------- */
const STEP_LABEL: Record<string, string> = {
  submitted: 'Submitted', response: 'Response', review: 'Review', decision: 'Decision',
};
const stepLabel = (s: TimelineStep) => STEP_LABEL[s.key] ?? s.title;

export function TicketStepper({ steps, compact }: { steps: TimelineStep[]; compact?: boolean }) {
  const { colors, isDark } = useTheme();
  const track = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const size = compact ? 18 : 26;
  return (
    <View style={[
      st.row,
      compact
        ? { paddingVertical: 2 }
        : { backgroundColor: colors.card, borderColor: track, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingTop: 16, paddingBottom: 6 },
    ]}>
      {steps.map((s, i) => {
        const done = s.done;
        const now = s.current && !s.done;
        return (
          <React.Fragment key={s.key}>
            {i > 0 && (
              <View style={[st.line, { backgroundColor: steps[i - 1].done ? colors.success : track }, compact && { marginBottom: 0 }]} />
            )}
            <View style={st.step}>
              <View style={[
                st.dot,
                { width: size, height: size, borderRadius: size / 2, backgroundColor: done ? colors.success : track },
                now && { backgroundColor: colors.card, borderWidth: 2, borderColor: colors.accent },
              ]}>
                {done ? (
                  <SolarIcon name="Check" variant="bold" size={compact ? 9 : 12} color="#FFFFFF" />
                ) : (
                  <Text style={[st.dotText, compact && { fontSize: 9 }, now && { color: colors.accent }]}>{i + 1}</Text>
                )}
              </View>
              {!compact && (
                <Text style={[st.label, done && { color: colors.success }, now && { color: colors.accent }]}>
                  {stepLabel(s)}
                </Text>
              )}
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

/* ---------- styles ---------- */
const pill = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 11.5, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.1 },
});

const hdr = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  title: { fontSize: 20, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2 },
  sub: { fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 1 },
});

const card = StyleSheet.create({
  wrap: { borderRadius: 16, padding: 16, borderWidth: 1 },
});

const shead = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  badge: {
    width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  badgeText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  title: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', letterSpacing: -0.2 },
  sub: { fontSize: 11, fontFamily: 'Poppins_400Regular', marginTop: 1 },
});

const note = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, padding: 10, borderWidth: 1, marginBottom: 14 },
  text: { flex: 1, fontSize: 11, fontFamily: 'Poppins_500Medium', lineHeight: 15 },
});

const btn = StyleSheet.create({
  base: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 14,
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  text: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: 0.2 },
});

const tile = StyleSheet.create({
  base: { borderRadius: 14, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.2 },
});

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: { alignItems: 'center', gap: 6 },
  dot: { justifyContent: 'center', alignItems: 'center' },
  dotText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#9CA3AF' },
  label: { fontSize: 10, fontFamily: 'Poppins_600SemiBold', color: '#9CA3AF', letterSpacing: 0.3 },
  line: { flex: 1, height: 2, marginHorizontal: 6, marginBottom: 20 },
});