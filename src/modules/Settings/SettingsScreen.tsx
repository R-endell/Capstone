// src/modules/Dashboard/Sender/Settings_Sender/SettingsScreen.tsx
import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';

const ORANGE = '#FA7A25';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const handleTwoFactorPress = () => navigation.navigate('TwoFactorAuth');
  const handleLegalPress = () => navigation.navigate('LegalPolicies');

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.mainContent}
        contentContainerStyle={styles.mainScrollContent}
      >
        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>

        <View style={styles.menuCard}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleTwoFactorPress}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#231542' : '#F5F3FF' }]}>
                <Ionicons name="shield-checkmark-outline" size={19} color="#8B5CF6" />
              </View>
              <View style={styles.menuTextWrapper}>
                <Text style={styles.menuText}>Two-Factor Authentication</Text>
                <Text style={styles.menuSubtext} numberOfLines={1}>
                  Extra layer of security for your account
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Legal</Text>

        <View style={styles.menuCard}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleLegalPress}
            activeOpacity={0.7}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#0F2744' : '#EFF6FF' }]}>
                <Ionicons name="document-text-outline" size={19} color="#3B82F6" />
              </View>
              <View style={styles.menuTextWrapper}>
                <Text style={styles.menuText}>Legal Policies</Text>
                <Text style={styles.menuSubtext} numberOfLines={1}>
                  Terms, privacy, and community guidelines
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: c.divider,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: c.textPrimary,
    letterSpacing: -0.3,
  },

  mainContent: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },

  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.textSecondary,
    marginBottom: 12,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },

  menuCard: {
    backgroundColor: c.card,
    borderRadius: 18,
    paddingHorizontal: 6,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: c.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 14,
    minHeight: 68,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  menuIconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuTextWrapper: { flex: 1 },
  menuText: {
    fontSize: 16,
    fontWeight: '700',
    color: c.textPrimary,
    letterSpacing: -0.2,
  },
  menuSubtext: {
    fontSize: 13,
    color: c.textSecondary,
    marginTop: 3,
    fontWeight: '500',
  },

  versionText: {
    textAlign: 'center',
    color: c.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 28,
    marginBottom: 24,
    letterSpacing: 0.4,
  },
});