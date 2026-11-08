// src/modules/Dashboard/Sender/Settings_Sender/PaymentMethodCard.tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { PaymentMethod } from '../../types/payment';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { SolarIcon } from '../../components/ui/SolarIcon';

const GCASH_LOGO = require('../../../assets/gcash.png');
const MAYA_LOGO = require('../../../assets/maya.png');

interface Props {
  method: PaymentMethod;
  onSetDefault: () => void;
  onUnlink: () => void;
}

export default function PaymentMethodCard({ method, onSetDefault, onUnlink }: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const providerLabel = method.provider === 'gcash' ? 'GCash' : 'Maya';
  const logo = method.provider === 'gcash' ? GCASH_LOGO : MAYA_LOGO;

  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <View style={styles.iconWrapper}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.info}>
          <Text style={styles.providerName}>{providerLabel}</Text>
          <Text style={styles.linkedText}>
            Linked {new Date(method.linked_at).toLocaleDateString()}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {method.is_default ? (
          <View style={styles.defaultBadge}>
            <SolarIcon name="CheckCircle" variant="bold" size={14} color={colors.success} />
            <Text style={styles.defaultText}>Default</Text>
          </View>
        ) : (
          <TouchableOpacity onPress={onSetDefault} style={styles.actionBtn} activeOpacity={0.7}>
            <Text style={styles.actionBtnText}>Set Default</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onUnlink} style={styles.unlinkBtn} activeOpacity={0.7}>
          <SolarIcon name="Trash" variant="linear" size={16} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 8, elevation: 0,
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrapper: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', overflow: 'hidden',
  },
  logo: { width: 34, height: 34 },
  info: { flex: 1 },
  providerName: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary },
  linkedText: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successBg,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4,
  },
  defaultText: { fontSize: 10, fontFamily: 'Poppins_700Bold', color: c.success },
  actionBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  actionBtnText: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  unlinkBtn: { padding: 6 },
});