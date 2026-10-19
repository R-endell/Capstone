// src/modules/Settings/LegalPoliciesScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { POLICIES } from './policyContent';

const ORANGE = '#FA7A25';

export default function LegalPoliciesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [activeItem, setActiveItem] = useState('Terms of Service');

  // Policy list comes from policyContent.ts so Register and Settings stay in sync.
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
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Legal Policies</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: 40 + insets.bottom }]}>
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
                  <Ionicons
                    name={policy.icon}
                    size={20}
                    color={isActive ? '#FFFFFF' : colors.textPrimary}
                    style={styles.icon}
                  />
                  <Text style={[styles.cardTitle, isActive ? styles.activeText : styles.inactiveText]}>
                    {policy.title}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={isActive ? '#FFFFFF' : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          );
        })}
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

  scrollContent: { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 40 },

  itemWrapper: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sideIndicator: { width: 4, height: 40, borderRadius: 2, marginRight: 12 },
  activeIndicator: { backgroundColor: ORANGE },
  inactiveIndicator: { backgroundColor: c.border },

  card: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 20, borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.3 : 0.1, shadowRadius: 3, elevation: 2,
  },
  activeCard: { backgroundColor: ORANGE, borderColor: ORANGE },
  inactiveCard: { backgroundColor: c.card, borderColor: c.border },

  cardLeft: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 12 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  activeText: { color: '#FFFFFF' },
  inactiveText: { color: c.textPrimary },
});