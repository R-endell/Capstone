// src/components/ProviderTermsModal.tsx
// Shown to a provider before they start a route, until they have accepted the current provider terms.
//
// Use in a screen:
//   const { ensureAccepted, termsModal } = useProviderTermsGate();
//   ...
//   if (!(await ensureAccepted())) return;   // before starting the route
//   ...
//   return (<View> ... {termsModal} </View>);
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, ActivityIndicator, Alert, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../utils/themeContext';
import { getPolicy, SIZE_LIMITS } from '../modules/Settings/policyContent';
import { PROVIDER_ROUTE_POLICIES, hasAccepted, recordAcceptance } from '../services/policyAgreementService';

const ORANGE = '#F27024';

const peso = (n: number) => `₱${n.toLocaleString('en-US')}`;

const KEY_POINTS: { icon: string; title: string; text: string }[] = [
  {
    icon: 'people-outline', title: 'You are an independent provider',
    text: 'Pack-N-Ship connects you with senders. We are not the carrier, and we do not insure packages.',
  },
  {
    icon: 'camera-outline', title: 'Take a photo at pickup and at drop-off',
    text: 'Every time. These photos are your proof, and they protect you if a claim is made.',
  },
  {
    icon: 'qr-code-outline', title: 'Use the QR code and PIN, keep location on',
    text: 'Confirm each handover in the app and keep location sharing on during a delivery.',
  },
  {
    icon: 'cube-outline', title: 'If you damage a package, the cost is shared',
    text: `If you are found at fault, you cover the item value up to ${SIZE_LIMITS.map(l => `${peso(l.amount)} (${l.label.toLowerCase()})`).join(', ')}, taken from your earnings. You never pay for damage you did not cause, damage that was already there, or accidents outside your control.`,
  },
  {
    icon: 'time-outline', title: 'Receiver not there?',
    text: 'Wait 5 minutes, then return the package to the sender and report it in the app.',
  },
  {
    icon: 'alert-circle-outline', title: 'Strikes',
    text: 'No-shows or damage you caused earn a strike. Strike 1 is a warning, strike 2 a suspension, strike 3 removal.',
  },
];

export function ProviderTermsModal({ visible, onDone }: { visible: boolean; onDone: (accepted: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const accept = async () => {
    if (!agreed || saving) return;
    try {
      setSaving(true);
      await recordAcceptance({ policyIds: PROVIDER_ROUTE_POLICIES, role: 'provider', context: 'route_start' });
      setAgreed(false); setOpen(null);
      onDone(true);
    } catch (e: any) {
      Alert.alert('Could not save your agreement', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => { if (!saving) { setAgreed(false); setOpen(null); onDone(false); } };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cancel}>
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroIcon}><Ionicons name="shield-checkmark-outline" size={30} color={ORANGE} /></View>
          <Text style={styles.title}>Before you start your route</Text>
          <Text style={styles.sub}>
            A quick reminder of the rules that protect you and your senders. You only need to accept once.
          </Text>

          <View style={styles.points}>
            {KEY_POINTS.map(p => (
              <View key={p.title} style={styles.point}>
                <View style={styles.pointIcon}><Ionicons name={p.icon as any} size={20} color={ORANGE} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.pointTitle}>{p.title}</Text>
                  <Text style={styles.pointText}>{p.text}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.readLabel}>READ THE FULL TEXT</Text>
          {PROVIDER_ROUTE_POLICIES.map(id => {
            const pol = getPolicy(id);
            if (!pol) return null;
            const isOpen = open === id;
            return (
              <View key={id} style={styles.acc}>
                <TouchableOpacity style={styles.accHead} onPress={() => setOpen(isOpen ? null : id)} activeOpacity={0.8}>
                  <Text style={styles.accTitle}>{pol.title}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </TouchableOpacity>
                {isOpen && (
                  <View style={styles.accBody}>
                    {pol.sections.map(s => (
                      <View key={s.heading} style={{ gap: 4 }}>
                        <Text style={styles.secHead}>{s.heading}</Text>
                        {s.body.map((line, i) => <Text key={i} style={styles.secText}>{line}</Text>)}
                        {s.rows?.map(r => (
                          <Text key={r.label} style={styles.secText}>{r.label}: {r.value}</Text>
                        ))}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={styles.checkRow} onPress={() => setAgreed(a => !a)} activeOpacity={0.8} disabled={saving}>
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={24} color={agreed ? ORANGE : colors.textMuted} />
            <Text style={styles.checkText}>
              I have read and agree to the Provider Agreement and the Package Damage and Responsibility Policy.
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.primary, (!agreed || saving) && styles.primaryOff]}
            disabled={!agreed || saving} onPress={accept} activeOpacity={0.9}
          >
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>Agree and start route</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={cancel} activeOpacity={0.8} disabled={saving}>
            <Text style={styles.ghostText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/** Returns ensureAccepted() (resolves true when the provider has accepted) and the modal to render. */
export function useProviderTermsGate() {
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ensureAccepted = useCallback(async (): Promise<boolean> => {
    let ok = false;
    try { ok = await hasAccepted(PROVIDER_ROUTE_POLICIES, 'provider'); } catch { ok = false; }
    if (ok) return true;
    await new Promise(r => setTimeout(r, 350)); // let a closing modal finish first
    return new Promise<boolean>(resolve => { resolver.current = resolve; setVisible(true); });
  }, []);

  const termsModal = (
    <ProviderTermsModal
      visible={visible}
      onDone={(accepted) => { setVisible(false); resolver.current?.(accepted); resolver.current = null; }}
    />
  );
  return { ensureAccepted, termsModal };
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, gap: 14 },
  heroIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.6 },
  sub: { fontSize: 14, lineHeight: 21, color: c.textSecondary, fontWeight: '500' },

  points: { backgroundColor: c.card, borderRadius: 20, borderWidth: 1, borderColor: c.divider, padding: 16, gap: 16 },
  point: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pointIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  pointTitle: { fontSize: 14.5, fontWeight: '800', color: c.textPrimary },
  pointText: { fontSize: 13, lineHeight: 19, color: c.textSecondary, fontWeight: '500' },

  readLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1, marginTop: 6 },
  acc: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.divider, overflow: 'hidden' },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  accTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: c.textPrimary },
  accBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 12, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12 },
  secHead: { fontSize: 13.5, fontWeight: '800', color: c.textPrimary },
  secText: { fontSize: 12.5, lineHeight: 19, color: c.textSecondary, fontWeight: '500' },

  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.card },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkText: { flex: 1, fontSize: 13.5, lineHeight: 20, color: c.textPrimary, fontWeight: '600' },
  primary: {
    backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  primaryOff: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
  ghost: { alignItems: 'center', paddingVertical: 8 },
  ghostText: { color: c.textSecondary, fontSize: 14.5, fontWeight: '700' },
});