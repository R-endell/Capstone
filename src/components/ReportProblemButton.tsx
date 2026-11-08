// src/components/ReportProblemButton.tsx
// Drop into any delivery detail view. Opens the report flow with the delivery pre-selected.
//   <ReportProblemButton deliveryId={d.delivery_id} role="sender" />
//   <ReportProblemButton deliveryId={task.delivery_id} role="provider" variant="link" />
import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/themeContext';

const ORANGE = '#F27024';

type Props = {
  deliveryId?: number | null;
  requestId?: number | null;
  role: 'sender' | 'provider';
  variant?: 'outline' | 'link';
  label?: string;
};

export default function ReportProblemButton({ deliveryId, requestId, role, variant = 'outline', label }: Props) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  if (!deliveryId && !requestId) return null;

  const onPress = () =>
    navigation.navigate('ReportIssue', {
      role,
      deliveryId: deliveryId ?? undefined,
      requestId: requestId ?? undefined,
    });

  if (variant === 'link') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={s.link} hitSlop={8}>
        <Ionicons name="flag-outline" size={16} color={ORANGE} />
        <Text style={s.linkText}>{label || 'Report a problem'}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity
      onPress={onPress} activeOpacity={0.85}
      style={[s.btn, { borderColor: colors.border, backgroundColor: colors.card }]}
    >
      <Ionicons name="flag-outline" size={18} color={ORANGE} />
      <Text style={[s.btnText, { color: colors.textPrimary }]}>{label || 'Report a problem'}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5,
  },
  btnText: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  linkText: { fontSize: 13.5, fontWeight: '800', color: ORANGE },
});