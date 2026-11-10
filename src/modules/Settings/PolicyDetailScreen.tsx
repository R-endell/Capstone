// src/modules/Settings/PolicyDetailScreen.tsx
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), tinted notes, numbered
// badges, and staged fade-up entrance.
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  ScreenHeader, SectionCard, Note, ORANGE, useStagedEntrance, fadeUp,
} from '../Help/helpUi';
import { getPolicy, POLICY_VERSION } from './policyContent';

// A line written entirely inside [brackets] is a decision the team has not made yet.
const isPending = (line: string) => /^\[.*\]$/.test(line.trim());

export default function PolicyDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const policy = getPolicy(route.params?.policyId);

  // Staged entrance: hero → draft note → sections (RegisterProvider section staggering).
  const [heroAnim, draftAnim, sectionsAnim] = useStagedEntrance(3);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Policy" onBack={() => navigation.goBack()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      >
        {!policy ? (
          <Animated.View style={fadeUp(heroAnim, 20)}>
            <SectionCard>
              <Text style={styles.paragraph}>This policy could not be found.</Text>
            </SectionCard>
          </Animated.View>
        ) : (
          <>
            {/* hero — SectionCard shell, RegisterProvider introCard geometry */}
            <Animated.View style={fadeUp(heroAnim, 20)}>
              <SectionCard style={styles.hero}>
                <View style={styles.heroIcon}>
                  <Ionicons name={policy.icon} size={26} color={ORANGE} />
                </View>
                <Text style={styles.heroTitle}>{policy.title}</Text>
                <Text style={styles.heroSummary}>{policy.summary}</Text>
                <View style={styles.heroMeta}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>
                      {policy.audience === 'providers' ? 'For providers' : 'For everyone'}
                    </Text>
                  </View>
                  <Text style={styles.metaText}>Version {POLICY_VERSION}</Text>
                </View>
              </SectionCard>
            </Animated.View>

            {/* draft note — shared Note pattern (tone warning) */}
            <Animated.View style={fadeUp(draftAnim, 20)}>
              <Note
                tone="warning"
                icon={<Ionicons name="information-circle-outline" size={16} color={colors.warning} />}
              >
                Draft. Not yet reviewed by a legal professional. Items in brackets are still to be confirmed.
              </Note>
            </Animated.View>

            {/* sections — SectionCard shell + numbered badge */}
            <Animated.View style={[fadeUp(sectionsAnim, 20), { gap: 12 }]}>
              {policy.sections.map((s, idx) => {
                const asList = s.body.length > 1;
                return (
                  <SectionCard key={s.heading} style={styles.section}>
                    <View style={styles.headRow}>
                      <View style={styles.num}><Text style={styles.numText}>{idx + 1}</Text></View>
                      <Text style={styles.heading}>{s.heading}</Text>
                    </View>

                    <View style={{ gap: 10 }}>
                      {s.body.map((line, i) =>
                        isPending(line) ? (
                          <View key={i} style={styles.pending}>
                            <Ionicons name="time-outline" size={15} color={colors.warning} />
                            <Text style={styles.pendingText}>{line.trim().slice(1, -1)}</Text>
                          </View>
                        ) : asList ? (
                          <View key={i} style={styles.bulletRow}>
                            <View style={styles.dot} />
                            <Text style={styles.bulletText}>{line}</Text>
                          </View>
                        ) : (
                          <Text key={i} style={styles.paragraph}>{line}</Text>
                        ),
                      )}
                    </View>

                    {s.rows && s.rows.length > 0 && (
                      <View style={styles.rows}>
                        {s.rows.map((r, i) => (
                          <View
                            key={r.label}
                            style={[
                              styles.rowItem,
                              i === s.rows!.length - 1 && { borderBottomWidth: 0 },
                            ]}
                          >
                            <Text style={styles.rowLabel}>{r.label}</Text>
                            <Text style={[styles.rowValue, isPending(r.value) && { color: colors.warning }]}>
                              {isPending(r.value) ? r.value.trim().slice(1, -1) : r.value}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </SectionCard>
                );
              })}
            </Animated.View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 14 },

  // hero — SectionCard supplies radius 16 + hairline border + no shadow
  hero: { padding: 20, gap: 8 },
  heroIcon: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroTitle: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.5 },
  heroSummary: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.accentSoft },
  pillText: { fontSize: 11.5, fontFamily: 'Poppins_800ExtraBold', color: ORANGE },
  metaText: { fontSize: 12, fontFamily: 'Poppins_600SemiBold', color: c.textMuted },

  // section — SectionCard supplies the shell; inner spacing only
  section: { padding: 18, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  numText: { fontSize: 12.5, fontFamily: 'Poppins_800ExtraBold', color: ORANGE },
  heading: { flex: 1, fontSize: 16, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.3 },

  paragraph: { fontSize: 14, lineHeight: 22, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  bulletRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ORANGE, marginTop: 9 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 22, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },

  // pending — tinted warning note (RegisterProvider manualNote pattern), radius 12
  pending: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, alignSelf: 'stretch',
    backgroundColor: c.warningBg, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: c.warning,
  },
  pendingText: { flex: 1, fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_600SemiBold', color: c.warning },

  // rows table — hairline border, radius 14 (input spec), no shadow
  rows: { borderRadius: 14, borderWidth: 1, borderColor: c.divider, backgroundColor: c.background, overflow: 'hidden' },
  rowItem: { paddingVertical: 12, paddingHorizontal: 14, gap: 3, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowLabel: { fontSize: 13.5, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary },
  rowValue: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
});