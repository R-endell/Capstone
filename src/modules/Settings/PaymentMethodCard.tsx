import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PaymentMethod } from '../../types/payment';
import { useTheme, ThemeColors } from '../../utils/themeContext';

const GCASH_LOGO = require('../../../assets/gcash.png');
const MAYA_LOGO = require('../../../assets/maya.jpeg');

const ORANGE = '#FF751F';

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
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <Text style={styles.defaultText}>Default</Text>
          </View>
        ) : (
          <TouchableOpacity onPress={onSetDefault} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>Set Default</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onUnlink} style={styles.unlinkBtn}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: c.card, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 8, elevation: 2,
  },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconWrapper: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden',
  },
  logo: { width: 34, height: 34 },
  info: { flex: 1 },
  providerName: { fontSize: 15, fontWeight: '700', color: c.textPrimary },
  linkedText: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: c.successBg,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4,
  },
  defaultText: { fontSize: 10, fontWeight: '700', color: c.success },
  actionBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1, borderColor: c.border,
  },
  actionBtnText: { fontSize: 11, fontWeight: '600', color: c.textSecondary },
  unlinkBtn: { padding: 6 },
});