// src/modules/Dashboard/Sender/Settings_Sender/SettingsScreen.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Switch, Alert, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { supabase } from '../../utils/supabase';
import { SolarIcon } from '../../components/ui/SolarIcon';

export default function SettingsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [loading2FA, setLoading2FA] = useState(true);

  useEffect(() => {
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={styles.mainContent} contentContainerStyle={styles.mainScrollContent}>
        
        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>

        <View style={styles.menuCard}>
          <View style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconWrapper, { backgroundColor: colors.secondarySoft }]}>
                <SolarIcon name="ShieldCheck" variant="duotone" size={19} color={colors.secondary} />
              </View>
              <View style={styles.menuTextWrapper}>
                <Text style={styles.menuText}>Two-Factor Authentication</Text>
                <Text style={styles.menuSubtext} numberOfLines={1}>
                  Require an OTP when logging in
                </Text>
              </View>
            </View>
            {loading2FA ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 10 }} />
            ) : (
              <Switch
                value={is2FAEnabled}
                onValueChange={toggle2FA}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={'#FFFFFF'}
              />
            )}
          </View>
        </View>

        {/* Legal */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Legal</Text>

        <View style={styles.menuCard}>
          <TouchableOpacity style={styles.menuItem} onPress={handleLegalPress} activeOpacity={0.7}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.menuIconWrapper, { backgroundColor: colors.infoSoft }]}>
                <SolarIcon name="DocumentText" variant="linear" size={19} color={colors.info} />
              </View>
              <View style={styles.menuTextWrapper}>
                <Text style={styles.menuText}>Legal Policies</Text>
                <Text style={styles.menuSubtext} numberOfLines={1}>
                  Terms, privacy, and community guidelines
                </Text>
              </View>
            </View>
            <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: 20, paddingBottom: 16, backgroundColor: c.card, 
    borderBottomWidth: 1, borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' 
  },
  backBtn: { 
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.background, 
    justifyContent: 'center', alignItems: 'center', 
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' 
  },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
  mainContent: { flex: 1 },
  mainScrollContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 60 },
  sectionTitle: { 
    fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textMuted, 
    marginBottom: 12, letterSpacing: 0.5, textTransform: 'uppercase' 
  },
  menuCard: { 
    backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 6, paddingVertical: 6, 
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 10, elevation: 0, 
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' 
  },
  menuItem: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingVertical: 16, paddingHorizontal: 12, borderRadius: 12, minHeight: 68 
  },
  menuItemLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  menuIconWrapper: { width: 46, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  menuTextWrapper: { flex: 1 },
  menuText: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  menuSubtext: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 3 },
  versionText: { textAlign: 'center', color: c.textMuted, fontSize: 12, fontFamily: 'Poppins_500Medium', marginTop: 28, marginBottom: 24, letterSpacing: 0.4 },
});