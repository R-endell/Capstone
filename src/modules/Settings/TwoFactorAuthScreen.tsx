// src/modules/Settings/TwoFactorAuthScreen.tsx
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';

import { brand } from '../../constants';
const ORANGE = brand.orangeDark;

export default function TwoFactorAuthScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Two-Factor Auth</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark-outline" size={56} color={ORANGE} />
          </View>

          <Text style={styles.statusPill}>COMING SOON</Text>

          <Text style={styles.instructionText}>
            Two-factor authentication is not available yet.
          </Text>
          <Text style={styles.footerText}>
            When it is released, you will be able to protect your account with a code from an
            authenticator app, in addition to your password. Provider and admin accounts, which
            handle identity documents and payouts, will be asked to use it first.
          </Text>
          <Text style={[styles.footerText, { marginTop: 12 }]}>
            Until then, use a strong, unique password and never share it.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  card: {
    backgroundColor: c.card, borderRadius: 20, paddingVertical: 32, paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.1, shadowRadius: 4, elevation: 3,
  },

  iconContainer: { marginBottom: 16 },
  statusPill: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1, color: ORANGE,
    backgroundColor: c.accentSoft, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 999, overflow: 'hidden', marginBottom: 14,
  },

  instructionText: {
    fontSize: 16, color: c.textSecondary, textAlign: 'center',
    fontWeight: '500', marginBottom: 10, lineHeight: 22,
  },
  phoneNumber: {
    fontSize: 16, color: c.textPrimary, fontWeight: '700', marginBottom: 24,
  },

  codeContainer: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 10, marginBottom: 16,
  },
  codeInput: {
    width: 40, height: 50,
    borderWidth: 1, borderColor: c.border, borderRadius: 6,
    textAlign: 'center', fontSize: 20, fontWeight: '600',
    color: c.textPrimary, backgroundColor: c.background,
  },

  timerText: { fontSize: 13, color: c.textSecondary, marginBottom: 24 },

  resendButton: {
    width: '100%', backgroundColor: c.divider,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 12,
    borderWidth: 1, borderColor: c.border,
  },
  resendButtonText: { color: c.textSecondary, fontWeight: '600', fontSize: 14 },

  verifyButton: {
    width: '100%', backgroundColor: ORANGE,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 24,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 8, elevation: 3,
  },
  verifyButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },

  footerText: {
    fontSize: 11, color: c.textMuted, textAlign: 'center', lineHeight: 16,
  },
});