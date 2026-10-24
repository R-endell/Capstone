// src/modules/Settings/SettingsScreen.tsx
import React, { useMemo, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Switch, Alert, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { supabase } from '../../utils/supabase';
import { brand, spacing, borderRadius } from '../../constants';
import MenuItem from '../../components/MenuItem';
import Card from '../../components/Card';

const ORANGE = brand.orangeDark;

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [loading2FA, setLoading2FA] = useState(true);

  useEffect(() => {
    // Load initial 2FA state from user metadata
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.user_metadata?.two_factor_enabled) {
        setIs2FAEnabled(true);
      }
      setLoading2FA(false);
    };
    fetchUser();
  }, []);

  const toggle2FA = async (value: boolean) => {
    setLoading2FA(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { two_factor_enabled: value }
      });
      if (error) throw error;
      setIs2FAEnabled(value);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not update 2FA setting.');
    } finally {
      setLoading2FA(false);
    }
  };

  const handleLegalPress = () => navigation.navigate('LegalPolicies');

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.mainContent} contentContainerStyle={styles.mainScrollContent}>
        
        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>

        <Card padding="xs" style={{ paddingVertical: 0 }}>
          <MenuItem
            label="Two-Factor Authentication"
            subtext="Require an OTP when logging in"
            accessibilityLabel="Two-Factor Authentication"
            accessibilityHint={is2FAEnabled ? 'Disable two-factor authentication' : 'Enable two-factor authentication'}
            leftIcon={
              <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#231542' : '#F5F3FF' }]}>
                <Ionicons name="shield-checkmark-outline" size={19} color="#8B5CF6" />
              </View>
            }
            rightIcon={
              loading2FA ? (
                <ActivityIndicator size="small" color={ORANGE} />
              ) : (
                <Switch
                  value={is2FAEnabled}
                  onValueChange={toggle2FA}
                  trackColor={{ false: colors.border, true: ORANGE }}
                  thumbColor={'#FFFFFF'}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: is2FAEnabled }}
                />
              )
            }
            showChevron={false}
          />
        </Card>

        {/* Legal */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Legal</Text>

        <Card padding="xs" style={{ paddingVertical: 0 }}>
          <MenuItem
            label="Legal Policies"
            subtext="Terms, privacy, and community guidelines"
            onPress={handleLegalPress}
            accessibilityLabel="Legal Policies"
            accessibilityHint="View terms, privacy policy, and community guidelines"
            leftIcon={
              <View style={[styles.menuIconWrapper, { backgroundColor: isDark ? '#0F2744' : '#EFF6FF' }]}>
                <Ionicons name="document-text-outline" size={19} color="#3B82F6" />
              </View>
            }
          />
        </Card>

        <Text style={styles.versionText}>Pack-N-Ship · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg + 4, paddingBottom: spacing.lg, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
  backBtn: { width: 42, height: 42, borderRadius: borderRadius.full, backgroundColor: c.divider, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: c.border },
  headerTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  mainContent: { flex: 1 },
  mainScrollContent: { paddingHorizontal: spacing.lg + 4, paddingTop: spacing.lg + 4, paddingBottom: spacing['5xl'] },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.textSecondary, marginBottom: spacing.md, letterSpacing: 0.2, textTransform: 'uppercase' },
  menuCard: { backgroundColor: c.card, borderRadius: borderRadius.xl, paddingHorizontal: spacing.xs + 2, paddingVertical: spacing.xs + 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.3 : 0.05, shadowRadius: 10, elevation: 2, borderWidth: 1, borderColor: c.border },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 12, borderRadius: 14, minHeight: 68 },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  menuIconWrapper: { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  menuTextWrapper: { flex: 1 },
  menuText: { fontSize: 16, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.2 },
  menuSubtext: { fontSize: 13, color: c.textSecondary, marginTop: 3, fontWeight: '500' },
  versionText: { textAlign: 'center', color: c.textMuted, fontSize: 12, fontWeight: '600', marginTop: 28, marginBottom: 24, letterSpacing: 0.4 },
});