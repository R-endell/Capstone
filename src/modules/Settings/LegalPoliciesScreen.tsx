// src/modules/Settings/LegalPoliciesScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { PhIcon } from '../../components/ui/PhIcon';
import { POLICIES } from './policyContent';

export default function LegalPoliciesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [activeItem, setActiveItem] = useState('Terms of Service');

  const policies = POLICIES;

  const handlePress = (policy: { id: string; title: string }) => {
    setActiveItem(policy.title);
    navigation.navigate('PolicyDetail', { policyId: policy.id });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <PhIcon name="ArrowLeft" size={22} color={colors.textPrimary} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Legal Policies</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}>
        
        {/* Policies List */}
        {policies.map((policy) => {
          const isActive = activeItem === policy.title;
          return (
            <View key={policy.id} style={styles.itemWrapper}>
              <View style={[styles.sideIndicator, isActive ? styles.activeIndicator : styles.inactiveIndicator]} />
              <TouchableOpacity
                style={[styles.card, isActive ? styles.activeCard : styles.inactiveCard]}
                onPress={() => handlePress(policy)}
                activeOpacity={0.8}
              >
                <View style={styles.cardLeft}>
                  <View style={styles.iconWrapper}>
                    <PhIcon
                      name="FileText"
                      size={20}
                      color={isActive ? '#FFFFFF' : colors.textPrimary}
                      weight={isActive ? 'fill' : 'regular'}
                    />
                  </View>
                  <Text style={[styles.cardTitle, isActive ? styles.activeText : styles.inactiveText]}>
                    {policy.title}
                  </Text>
                </View>
                <PhIcon
                  name="CaretRight"
                  size={18}
                  color={isActive ? '#FFFFFF' : colors.textMuted}
                  weight="bold"
                />
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Credits & Attributions Section */}
        <View style={styles.creditsSection}>
          <View style={styles.creditsDivider} />
          <Text style={styles.creditsTitle}>Credits & Attributions</Text>
          
          <View style={styles.creditCard}>
            <Text style={styles.creditName}>Solar Icons</Text>
            <Text style={styles.creditDetail}>Created by: 480 Design</Text>
            <Text style={styles.creditDetail}>Source: https://solar-icons.dev</Text>
            <Text style={styles.creditDetail}>License: CC BY 4.0</Text>
          </View>

          <View style={styles.creditCard}>
            <Text style={styles.creditName}>Phosphor Icons</Text>
            <Text style={styles.creditDetail}>Created by: Phosphor Icons</Text>
            <Text style={styles.creditDetail}>Source: https://phosphoricons.com</Text>
            <Text style={styles.creditDetail}>License: MIT</Text>
          </View>
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
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  scrollContent: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 40 },

  itemWrapper: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sideIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 12 },
  activeIndicator: { backgroundColor: c.accent },
  inactiveIndicator: { backgroundColor: c.border },

  card: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 20, borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.04, shadowRadius: 8, elevation: 2,
  },
  activeCard: { 
    backgroundColor: c.accent, 
    borderColor: c.accent,
    shadowColor: c.accent, shadowOpacity: 0.3, elevation: 4,
  },
  inactiveCard: { backgroundColor: c.card, borderColor: c.border },

  cardLeft: { flexDirection: 'row', alignItems: 'center' },
  iconWrapper: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.03)',
    justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  activeText: { color: '#FFFFFF' },
  inactiveText: { color: c.textPrimary },

  /* Credits Section Styles */
  creditsSection: { marginTop: 24 },
  creditsDivider: { height: 1, backgroundColor: c.divider, marginBottom: 20 },
  creditsTitle: { fontSize: 13, fontWeight: '800', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  creditCard: {
    backgroundColor: c.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 10,
  },
  creditName: { fontSize: 14, fontWeight: '800', color: c.textPrimary, marginBottom: 6 },
  creditDetail: { fontSize: 12, color: c.textSecondary, lineHeight: 18, fontWeight: '500' },
});