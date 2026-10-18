// src/modules/Settings/PolicyDetailScreen.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { getPolicy, POLICY_VERSION } from './policyContent';

export default function PolicyDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const policy = getPolicy(route.params?.policyId);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{policy?.title ?? 'Policy'}</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}
      >
        <View style={styles.draftBanner}>
          <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
          <Text style={styles.draftText}>
            Draft version {POLICY_VERSION}. Not yet reviewed by a legal professional.
          </Text>
        </View>

        {!policy ? (
          <Text style={styles.body}>This policy could not be found.</Text>
        ) : (
          policy.sections.map((s) => (
            <View key={s.heading} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              {s.body.map((line, i) => (
                <Text key={i} style={styles.body}>{line}</Text>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  scrollContent: { paddingTop: 20, paddingHorizontal: 20 },
  draftBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.warningBg, borderRadius: 10, borderWidth: 1, borderColor: c.warning,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 20,
  },
  draftText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.warning },
  section: { marginBottom: 22 },
  heading: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 21, color: c.textSecondary, marginBottom: 8 },
});