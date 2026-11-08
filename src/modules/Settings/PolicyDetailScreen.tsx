// src/modules/Settings/PolicyDetailScreen.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { ScreenHeader, ORANGE } from '../Help/helpUi';
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Policy" onBack={() => navigation.goBack()} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + insets.bottom }]}
      >
        {!policy ? (
          <Text style={styles.paragraph}>This policy could not be found.</Text>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Ionicons name={policy.icon} size={26} color={ORANGE} />
              </View>
              <Text style={styles.heroTitle}>{policy.title}</Text>
              <Text style={styles.heroSummary}>{policy.summary}</Text>
              <View style={styles.heroMeta}>
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{policy.audience === 'providers' ? 'For providers' : 'For everyone'}</Text>
                </View>
                <Text style={styles.metaText}>Version {POLICY_VERSION}</Text>
              </View>
            </View>

            <View style={styles.draft}>
              <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
              <Text style={styles.draftText}>
                Draft. Not yet reviewed by a legal professional. Items in brackets are still to be confirmed.
              </Text>
            </View>

            {policy.sections.map((s, idx) => {
              const asList = s.body.length > 1;
              return (
                <View key={s.heading} style={styles.section}>
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
                        <View key={r.label} style={[styles.rowItem, i === s.rows!.length - 1 && { borderBottomWidth: 0 }]}>
                          <Text style={styles.rowLabel}>{r.label}</Text>
                          <Text style={[styles.rowValue, isPending(r.value) && { color: colors.warning }]}>
                            {isPending(r.value) ? r.value.trim().slice(1, -1) : r.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, paddingTop: 6, gap: 14 },

  hero: {
    backgroundColor: c.card, borderRadius: 22, padding: 20, gap: 8,
    borderWidth: 1, borderColor: c.divider,
  },
  heroIcon: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.5 },
  heroSummary: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontWeight: '500' },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.accentSoft },
  pillText: { fontSize: 11.5, fontWeight: '800', color: ORANGE },
  metaText: { fontSize: 12, fontWeight: '600', color: c.textMuted },

  draft: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.warningBg, borderRadius: 14, borderWidth: 1, borderColor: c.warning,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  draftText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: c.warning },

  section: {
    backgroundColor: c.card, borderRadius: 20, padding: 18, gap: 14,
    borderWidth: 1, borderColor: c.divider,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  num: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  numText: { fontSize: 12.5, fontWeight: '800', color: ORANGE },
  heading: { flex: 1, fontSize: 16, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  paragraph: { fontSize: 14, lineHeight: 22, color: c.textSecondary, fontWeight: '500' },
  bulletRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ORANGE, marginTop: 9 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 22, color: c.textSecondary, fontWeight: '500' },

  pending: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, alignSelf: 'stretch',
    backgroundColor: c.warningBg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
  },
  pendingText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: c.warning },

  rows: { borderRadius: 14, borderWidth: 1, borderColor: c.divider, backgroundColor: c.background, overflow: 'hidden' },
  rowItem: { paddingVertical: 12, paddingHorizontal: 14, gap: 3, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowLabel: { fontSize: 13.5, fontWeight: '800', color: c.textPrimary },
  rowValue: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontWeight: '500' },
});