// src/modules/Dashboard/Disputes/DisputeDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import {
  Dispute, fetchDispute, getMyUserId, respondToDispute, trackingIdFor, displayName, STATUS_STYLE,
} from '../../../services/disputeService';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

const MIN_RESPONSE = 10;
const MAX_RESPONSE = 500;

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '';

export default function DisputeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const disputeId: number = route.params?.disputeId;

  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [response, setResponse] = useState('');
  const [sending, setSending] = useState(false);
  const myIdRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      myIdRef.current = myIdRef.current ?? (await getMyUserId());
      setMyId(myIdRef.current);
      setDispute(await fetchDispute(disputeId));
    } catch (e) {
      console.error('Dispute detail error:', e);
    } finally {
      setLoading(false);
    }
  }, [disputeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`dispute-${disputeId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'disputes', filter: `dispute_id=eq.${disputeId}` },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [disputeId, load]);

  const isProvider = !!dispute && dispute.provider_id === myId;
  const isReporter = !!dispute && dispute.reported_by === myId;
  const canRespond = isProvider && dispute?.status === 'Awaiting Provider';

  const submitResponse = async () => {
    if (!dispute) return;
    try {
      setSending(true);
      await respondToDispute(dispute.dispute_id, response.trim());
      setResponse('');
      await load();
      Alert.alert('Response sent', 'The admin will now review the case. You will be notified once it is done.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
      load();
    } finally {
      setSending(false);
    }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => navigation.goBack()}
        hitSlop={10}
        activeOpacity={0.85}
      >
        <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Dispute Details</Text>
      <View style={{ width: 42 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
        {header}
        <ActivityIndicator color={colors.accent} style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!dispute) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
        {header}
        <View style={styles.missingWrap}>
          <View style={styles.missingIcon}>
            <SolarIcon name="DangerCircle" variant="duotone" size={32} color={colors.textMuted} />
          </View>
          <Text style={styles.missing}>This report could not be found.</Text>
        </View>
      </View>
    );
  }

  const st = STATUS_STYLE[dispute.status];
  const closed = dispute.status === 'Resolved' || dispute.status === 'Dismissed';
  const responded = !!dispute.provider_responded_at;

  const steps: { title: string; sub: string; done: boolean; current?: boolean }[] = [
    { title: 'Report filed', sub: fmt(dispute.created_at), done: true },
    {
      title: 'Provider response',
      sub: responded ? fmt(dispute.provider_responded_at) : 'Waiting for the provider to explain',
      done: responded,
      current: !responded && !closed,
    },
    {
      title: 'Admin review',
      sub: closed ? 'Completed' : responded ? 'In progress' : 'Starts after the provider responds',
      done: closed,
      current: responded && !closed,
    },
    {
      title: dispute.status === 'Dismissed' ? 'Dismissed' : 'Resolved',
      sub: closed ? fmt(dispute.resolved_at) : 'Pending decision',
      done: closed,
    },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />
      {header}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.caseRef}>{dispute.dispute_ref || `Case #${dispute.dispute_id}`}</Text>
              <View style={[styles.badge, { backgroundColor: st.bg }]}>
                <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
              </View>
            </View>
            <Text style={styles.issue}>{dispute.issue_type}</Text>
            <View style={styles.metaRow}>
              <SolarIcon name="QrCode" variant="linear" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Tracking ID: {trackingIdFor(dispute.request_id)}</Text>
            </View>
            <View style={styles.metaRow}>
              <SolarIcon name="User" variant="linear" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Reported by: {isReporter ? 'You' : displayName(dispute.reporter)}</Text>
            </View>
            <View style={styles.metaRow}>
              <SolarIcon name="Package" variant="linear" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Provider: {isProvider ? 'You' : displayName(dispute.provider)}</Text>
            </View>
          </View>

          {/* Needs action */}
          {canRespond && (
            <View style={styles.actionBanner}>
              <View style={styles.actionBannerIcon}>
                <SolarIcon name="DangerCircle" variant="duotone" size={20} color={colors.warning} />
              </View>
              <Text style={styles.actionBannerText}>
                A sender reported an issue on this delivery. Please explain what happened so the admin can review both sides.
              </Text>
            </View>
          )}

          {/* Progress */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Progress</Text>
            {steps.map((s, i) => (
              <View key={s.title} style={styles.stepRow}>
                <View style={styles.stepRail}>
                  <View style={[styles.dot, s.done && styles.dotDone, s.current && styles.dotCurrent]}>
                    {s.done && <SolarIcon name="Check" variant="bold" size={12} color="#FFF" />}
                  </View>
                  {i < steps.length - 1 && <View style={[styles.line, s.done && styles.lineDone]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
                  <Text style={[styles.stepTitle, !s.done && !s.current && { color: colors.textMuted }]}>
                    {s.title}
                  </Text>
                  <Text style={styles.stepSub}>{s.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Sender's report */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={[styles.sectionIconWrap, { backgroundColor: colors.infoSoft, borderColor: colors.info }]}>
                <SolarIcon name="ChatCircleText" variant="linear" size={16} color={colors.info} />
              </View>
              <Text style={styles.sectionTitle}>Sender's report</Text>
            </View>
            <View style={styles.quoteBox}>
              <Text style={styles.body}>{dispute.description}</Text>
            </View>
          </View>

          {/* Provider side */}
          {responded && (
            <View style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <View style={[styles.sectionIconWrap, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                  <SolarIcon name="ChatCircleText" variant="linear" size={16} color={colors.textPrimary} />
                </View>
                <Text style={styles.sectionTitle}>Provider's response</Text>
              </View>
              <View style={[styles.quoteBox, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
                <Text style={styles.body}>{dispute.provider_response}</Text>
              </View>
              <Text style={styles.stamp}>{fmt(dispute.provider_responded_at)}</Text>
            </View>
          )}

          {canRespond && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Your response</Text>
              <TextInput
                style={styles.textArea}
                value={response}
                onChangeText={t => setResponse(t.slice(0, MAX_RESPONSE))}
                placeholder="Explain what happened during the delivery, the condition of the item, and any proof you can describe…"
                placeholderTextColor={colors.textMuted}
                multiline
                textAlignVertical="top"
              />
              <Text style={styles.counter}>
                {response.trim().length < MIN_RESPONSE ? `At least ${MIN_RESPONSE} characters · ` : ''}
                {response.length}/{MAX_RESPONSE}
              </Text>
              <TouchableOpacity
                style={[styles.submit, (response.trim().length < MIN_RESPONSE || sending) && styles.submitDisabled]}
                disabled={response.trim().length < MIN_RESPONSE || sending}
                onPress={submitResponse}
                activeOpacity={0.85}
              >
                {sending ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <SolarIcon name="PaperPlane" variant="linear" size={18} color="#FFF" />
                    <Text style={styles.submitText}>Submit Response</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.footnote}>
                You can only respond once. After that the admin reviews the case.
              </Text>
            </View>
          )}

          {/* Waiting hints */}
          {!closed && !canRespond && (
            <View style={styles.waitCard}>
              <View style={styles.waitIcon}>
                <SolarIcon name="Clock" variant="linear" size={18} color={colors.info} />
              </View>
              <Text style={styles.waitText}>
                {dispute.status === 'Awaiting Provider'
                  ? isReporter
                    ? 'Waiting for the provider to respond. We will notify you of any update.'
                    : 'Waiting for a response.'
                  : 'An admin is reviewing this case. You will be notified once the review is done.'}
              </Text>
            </View>
          )}

          {/* Decision */}
          {closed && (
            <View
              style={[
                styles.card,
                {
                  borderColor: dispute.status === 'Resolved' ? colors.success : colors.error,
                  backgroundColor: dispute.status === 'Resolved' ? colors.successBg : colors.errorBg,
                },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <View
                  style={[
                    styles.sectionIconWrap,
                    {
                      backgroundColor: dispute.status === 'Resolved' ? colors.card : colors.card,
                      borderColor: dispute.status === 'Resolved' ? colors.success : colors.error,
                    },
                  ]}
                >
                  <SolarIcon
                    name={dispute.status === 'Resolved' ? 'CheckCircle' : 'CloseCircle'}
                    variant="linear"
                    size={16}
                    color={dispute.status === 'Resolved' ? colors.success : colors.error}
                  />
                </View>
                <Text style={styles.sectionTitle}>Admin decision</Text>
              </View>

              <View style={[styles.badge, { backgroundColor: st.bg, alignSelf: 'flex-start', marginBottom: 12 }]}>
                <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
              </View>
              <Text style={styles.body}>{dispute.resolution || 'No additional notes.'}</Text>
              <Text style={styles.stamp}>{fmt(dispute.resolved_at)}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  /* ── Header ─────────────────────────────────────── */
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 12, gap: 12,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3,
  },
  missingWrap: { alignItems: 'center', marginTop: 80, gap: 12 },
  missingIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.divider,
    alignItems: 'center', justifyContent: 'center',
  },
  missing: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_500Medium' },

  /* ── Content ────────────────────────────────────── */
  content: { padding: 20, paddingBottom: 60, gap: 14 },

  card: {
    backgroundColor: c.card, borderRadius: 12, padding: 18,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 8, elevation: 0,
  },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  caseRef: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary, letterSpacing: 0.4 },
  issue: {
    fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary,
    marginTop: 10, marginBottom: 12, letterSpacing: -0.4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  meta: { fontSize: 12.5, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },

  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 10.5, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.4, textTransform: 'uppercase' },

  /* Action banner */
  actionBanner: {
    flexDirection: 'row', gap: 12, backgroundColor: c.warningBg,
    padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.warning,
  },
  actionBannerIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: isDark ? '#3A2411' : '#FDE68A',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBannerText: { flex: 1, color: c.warning, fontSize: 13, lineHeight: 19, fontFamily: 'Poppins_600SemiBold' },

  /* Section headers */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionIconWrap: {
    width: 30, height: 30, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 14.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2,
  },
  quoteBox: {
    backgroundColor: c.background, padding: 14, borderRadius: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  body: { fontSize: 14, color: c.textSecondary, lineHeight: 21, fontFamily: 'Poppins_400Regular' },
  stamp: { fontSize: 11, color: c.textMuted, marginTop: 10, fontFamily: 'Poppins_500Medium' },

  /* Progress */
  stepRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  stepRail: { alignItems: 'center', width: 22 },
  dot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: {
    backgroundColor: c.accent,
    shadowColor: c.accent, shadowOpacity: 0.4, shadowRadius: 5, elevation: 3,
  },
  dotCurrent: { backgroundColor: c.card, borderWidth: 3, borderColor: c.accent },
  line: { flex: 1, width: 2, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginVertical: 2 },
  lineDone: { backgroundColor: c.accent },
  stepTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  stepSub: { fontSize: 12, color: c.textSecondary, marginTop: 3, fontFamily: 'Poppins_400Regular' },

  /* Response input */
  textArea: {
    minHeight: 120, backgroundColor: c.background,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    padding: 14, fontSize: 14, color: c.textPrimary, fontFamily: 'Poppins_400Regular',
    marginTop: 12, textAlignVertical: 'top',
  },
  counter: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontFamily: 'Poppins_500Medium' },

  /* Submit */
  submit: {
    flexDirection: 'row', backgroundColor: c.accent,
    paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  submitDisabled: {
    backgroundColor: c.accentSoft, shadowOpacity: 0, elevation: 0,
  },
  submitText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2 },
  footnote: {
    fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 10, fontFamily: 'Poppins_400Regular',
  },

  /* Waiting card */
  waitCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: c.infoSoft,
    padding: 14, borderRadius: 12, borderWidth: 1,
    borderColor: isDark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(59, 130, 246, 0.2)',
  },
  waitIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
  },
  waitText: {
    flex: 1, fontSize: 13,
    color: c.info,
    lineHeight: 19, fontFamily: 'Poppins_400Regular',
  },
});