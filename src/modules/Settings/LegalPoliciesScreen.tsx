// src/modules/Settings/LegalPoliciesScreen.tsx
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), tinted tags, staged fade-up.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { ScreenHeader, SectionCard, ORANGE, useStagedEntrance, fadeUp } from '../Help/helpUi';
import { POLICIES, POLICY_VERSION } from './policyContent';

export default function LegalPoliciesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // Policy list comes from policyContent.ts so Register and Settings stay in sync.
  const open = (id: string) => navigation.navigate('PolicyDetail', { policyId: id });

  // Staged entrance: intro → list → version (matches RegisterProviderScreen sections).
  const [introAnim, listAnim, versionAnim] = useStagedEntrance(3);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Terms and policies" onBack={() => navigation.goBack()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      >
        <Animated.View style={fadeUp(introAnim, 20)}>
          <Text style={styles.intro}>
            The rules that keep senders and providers safe, and what happens when something goes wrong.
          </Text>
        </Animated.View>

        <Animated.View style={[fadeUp(listAnim, 20), { gap: 12 }]}>
          {POLICIES.map((p) => (
            <SectionCard key={p.id} style={styles.card}>
              <TouchableOpacity
                style={styles.cardTouch}
                onPress={() => open(p.id)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={p.title}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={p.icon} size={22} color={ORANGE} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title} numberOfLines={2}>{p.title}</Text>
                    {p.audience === 'providers' && (
                      <View style={styles.tag}><Text style={styles.tagText}>Providers</Text></View>
                    )}
                  </View>
                  <Text style={styles.summary} numberOfLines={2}>{p.summary}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </SectionCard>
          ))}
        </Animated.View>

        <Animated.View style={fadeUp(versionAnim, 20)}>
          <Text style={styles.version}>Version {POLICY_VERSION}</Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 16 },

  // intro — Poppins_500Medium, matches RegisterProvider body copy
  intro: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },

  // card — SectionCard supplies radius 16 + hairline border + no shadow; touchable owns inner padding
  card: { padding: 0 },
  cardTouch: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  iconWrap: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { flexShrink: 1, fontSize: 15, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.2 },
  summary: { fontSize: 12.5, lineHeight: 17, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.accentSoft },
  tagText: { fontSize: 10.5, fontFamily: 'Poppins_800ExtraBold', color: ORANGE, letterSpacing: 0.3 },

  version: { textAlign: 'center', fontSize: 11.5, color: c.textMuted, fontFamily: 'Poppins_600SemiBold', marginTop: 6 },
});