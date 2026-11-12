// src/components/terms/TermsModal.tsx
// The pop-up shown before a booking, when applying as a provider, when posting a route,
// and when the Terms change. Two views inside one sheet, so nothing navigates away:
//   summary: the key points + checkbox + button
//   full:    every policy from policyContent.ts, expandable
// mode 'read' = no checkbox, just reading (used by the link on the sign-up form).
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { POLICIES, POLICY_VERSION } from '../../modules/Settings/policyContent';
import { TERMS_COPY, TermsVariant } from '../../services/termsService';

const ORANGE = '#F27024';

// A line written entirely inside [brackets] is a decision the team has not made yet (same rule as PolicyDetailScreen).
const isPending = (line: string) => /^\[.*\]$/.test(line.trim());

type Props = {
  visible: boolean;
  variant: TermsVariant;
  /** 'accept' asks for the checkbox and records agreement; 'read' only shows the text. */
  mode?: 'accept' | 'read';
  /** Overrides the default title (e.g. "We've updated our Terms and Policies"). */
  title?: string;
  busy?: boolean;
  /** false = cannot be dismissed (used when the user must accept to continue). */
  dismissible?: boolean;
  onAccept?: () => void;
  onClose?: () => void;
};

export default function TermsModal({
  visible, variant, mode = 'accept', title, busy = false, dismissible = true, onAccept, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const copy = TERMS_COPY[variant];

  const [agreed, setAgreed] = useState(false);
  const [view, setView] = useState<'summary' | 'full'>('summary');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setAgreed(false); setView('summary'); setOpenId(null); }
  }, [visible]);

  const close = () => { if (!busy && dismissible) onClose?.(); };
  const onBack = () => { if (view === 'full') setView('summary'); else close(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onBack}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />

          {view === 'summary' ? (
            <>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
                <View style={styles.iconTile}>
                  <Ionicons name="document-text-outline" size={26} color={ORANGE} />
                </View>
                <Text style={styles.title}>{title || copy.title}</Text>
                <Text style={styles.subtitle}>{copy.subtitle}</Text>

                <View style={styles.points}>
                  {copy.points.map((p, i) => (
                    <View key={i} style={styles.pointRow}>
                      <View style={styles.pointDot}><Ionicons name="checkmark" size={12} color="#FFF" /></View>
                      <Text style={styles.pointText}>{p}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity style={styles.fullLink} onPress={() => setView('full')} activeOpacity={0.8}>
                  <Ionicons name="reader-outline" size={18} color={ORANGE} />
                  <Text style={styles.fullLinkText}>Read the full Terms and Policies</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
                <Text style={styles.version}>Version {POLICY_VERSION}</Text>
              </ScrollView>

              {mode === 'accept' ? (
                <View style={styles.footer}>
                  <TouchableOpacity
                    style={styles.checkRow} onPress={() => !busy && setAgreed(a => !a)} activeOpacity={0.8}
                    accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}
                  >
                    <View style={[styles.box, agreed && styles.boxOn]}>
                      {agreed && <Ionicons name="checkmark" size={15} color="#FFF" />}
                    </View>
                    <Text style={styles.checkText}>I have read and agree to the Terms and Policies.</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.primary, (!agreed || busy) && styles.primaryOff]}
                    disabled={!agreed || busy} onPress={onAccept} activeOpacity={0.9}
                  >
                    {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>{copy.cta}</Text>}
                  </TouchableOpacity>

                  {dismissible && (
                    <TouchableOpacity style={styles.ghost} onPress={close} disabled={busy} activeOpacity={0.7}>
                      <Text style={styles.ghostText}>Not now</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <View style={styles.footer}>
                  <TouchableOpacity style={styles.primary} onPress={close} activeOpacity={0.9}>
                    <Text style={styles.primaryText}>Close</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          ) : (
            <>
              <View style={styles.fullHead}>
                <TouchableOpacity onPress={() => setView('summary')} hitSlop={10} style={styles.backBtn}>
                  <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fullTitle}>Terms and Policies</Text>
                  <Text style={styles.version}>Version {POLICY_VERSION}</Text>
                </View>
              </View>

              <View style={styles.draftNote}>
                <Ionicons name="information-circle-outline" size={16} color={colors.warning} />
                <Text style={styles.draftText}>Draft. Not yet reviewed by a legal professional. Items in brackets are still to be confirmed.</Text>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                {POLICIES.map(p => {
                  const open = openId === p.id;
                  return (
                    <View key={p.id} style={styles.policy}>
                      <TouchableOpacity style={styles.policyHead} onPress={() => setOpenId(open ? null : p.id)} activeOpacity={0.8}>
                        <View style={styles.policyIcon}><Ionicons name={p.icon} size={18} color={ORANGE} /></View>
                        <Text style={styles.policyTitle} numberOfLines={2}>{p.title}</Text>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                      </TouchableOpacity>
                      {open && (
                        <View style={styles.policyBody}>
                          {p.sections.map(s => (
                            <View key={s.heading} style={{ gap: 6 }}>
                              <Text style={styles.sectionHeading}>{s.heading}</Text>
                              {s.body.map((line, i) =>
                                isPending(line) ? (
                                  <Text key={i} style={styles.pendingText}>To be confirmed: {line.trim().slice(1, -1)}</Text>
                                ) : s.body.length > 1 ? (
                                  <View key={i} style={styles.bulletRow}>
                                    <View style={styles.bullet} />
                                    <Text style={styles.bulletText}>{line}</Text>
                                  </View>
                                ) : (
                                  <Text key={i} style={styles.bodyText}>{line}</Text>
                                ),
                              )}
                              {s.rows?.map(r => (
                                <View key={r.label} style={styles.rowItem}>
                                  <Text style={styles.rowLabel}>{r.label}</Text>
                                  <Text style={[styles.bodyText, isPending(r.value) && styles.pendingText]}>
                                    {isPending(r.value) ? `To be confirmed: ${r.value.trim().slice(1, -1)}` : r.value}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.footer}>
                <TouchableOpacity style={styles.primary} onPress={() => setView('summary')} activeOpacity={0.9}>
                  <Text style={styles.primaryText}>Back</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,24,39,0.55)' },
  sheet: {
    backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, maxHeight: '90%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 16 },

  iconTile: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium', marginTop: 6 },

  points: { gap: 12, marginTop: 18 },
  pointRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  pointDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  pointText: { flex: 1, fontSize: 14, lineHeight: 21, color: c.textPrimary, fontFamily: 'Poppins_500Medium' },

  fullLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, padding: 14, borderRadius: 14,
    backgroundColor: c.card, borderWidth: 1, borderColor: c.divider,
  },
  fullLinkText: { flex: 1, fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  version: { fontSize: 11.5, color: c.textMuted, fontFamily: 'Poppins_600SemiBold', marginTop: 10 },

  footer: { paddingTop: 12, gap: 4, borderTopWidth: 1, borderTopColor: c.divider, marginTop: 8 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
  boxOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  checkText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: c.textPrimary, fontFamily: 'Poppins_600SemiBold' },
  primary: {
    backgroundColor: ORANGE, paddingVertical: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  primaryOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74', shadowOpacity: 0, elevation: 0 },
  primaryText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
  ghost: { alignItems: 'center', paddingVertical: 12 },
  ghostText: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_600SemiBold' },

  fullHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.divider },
  fullTitle: { fontSize: 18, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.3 },
  draftNote: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 12, marginBottom: 12,
    backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
  },
  draftText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.warning, fontFamily: 'Poppins_600SemiBold' },

  policy: { backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.divider, overflow: 'hidden' },
  policyHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  policyIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  policyTitle: { flex: 1, fontSize: 14, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary },
  policyBody: { paddingHorizontal: 14, paddingBottom: 16, gap: 16, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 14 },
  sectionHeading: { fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  bodyText: { fontSize: 13, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 20, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: ORANGE, marginTop: 8 },
  pendingText: { fontSize: 12.5, lineHeight: 18, color: c.warning, fontFamily: 'Poppins_600SemiBold' },
  rowItem: { paddingVertical: 8, gap: 2, borderTopWidth: 1, borderTopColor: c.divider },
  rowLabel: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
});