// src/modules/Dashboard/Disputes/DisputeDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import {
  Dispute, fetchDispute, getMyUserId, respondToDispute, trackingIdFor, displayName, STATUS_STYLE,
} from '../../../services/disputeService';
import { useTheme, ThemeColors } from '../../../utils/themeContext';

const ORANGE = '#F27024';

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
        activeOpacity={0.8}
      >
        <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Dispute Details</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
        {header}
        <ActivityIndicator color={ORANGE} style={{ marginTop: 60 }} />
      </View>
    );
  }

  if (!dispute) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
        {header}
        <View style={styles.missingWrap}>
          <View style={styles.missingIcon}>
            <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
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
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
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
              <Ionicons name="barcode-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Tracking ID: {trackingIdFor(dispute.request_id)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Reported by: {isReporter ? 'You' : displayName(dispute.reporter)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="cube-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.meta}>Provider: {isProvider ? 'You' : displayName(dispute.provider)}</Text>
            </View>
          </View>

          {/* Needs action */}
          {canRespond && (
            <View style={styles.actionBanner}>
              <View style={styles.actionBannerIcon}>
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
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
                    {s.done && <Ionicons name="checkmark" size={12} color="#FFF" />}
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
              <View style={[styles.sectionIconWrap, isDark
                ? { backgroundColor: '#0F2744', borderColor: '#1E3A5F' }
                : { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#3B82F6" />
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
                <View style={[styles.sectionIconWrap, { backgroundColor: colors.accentSoft, borderColor: ORANGE }]}>
                  <Ionicons name="chatbox-ellipses-outline" size={16} color={ORANGE} />
                </View>
                <Text style={styles.sectionTitle}>Provider's response</Text>
              </View>
              <View style={[styles.quoteBox, { backgroundColor: colors.accentSoft, borderColor: ORANGE }]}>
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
                    <Ionicons name="paper-plane-outline" size={18} color="#FFF" />
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
                <Ionicons name="time-outline" size={18} color={isDark ? '#93C5FD' : '#1D4ED8'} />
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
                  borderColor: dispute.status === 'Resolved' ? colors.success : colors.border,
                  backgroundColor: dispute.status === 'Resolved' ? colors.successBg : colors.card,
                },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <View
                  style={[
                    styles.sectionIconWrap,
                    {
                      backgroundColor: dispute.status === 'Resolved' ? colors.successBg : colors.divider,
                      borderColor: dispute.status === 'Resolved' ? colors.success : colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={dispute.status === 'Resolved' ? 'checkmark-done-outline' : 'close-outline'}
                    size={16}
                    color={dispute.status === 'Resolved' ? colors.success : colors.textSecondary}
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
    width: 40, height: 40, borderRadius: 20, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.06, shadowRadius: 6, elevation: 2,
  },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 20, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4,
  },
  missingWrap: { alignItems: 'center', marginTop: 80, gap: 12 },
  missingIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.divider,
    alignItems: 'center', justifyContent: 'center',
  },
  missing: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },

  /* ── Content ────────────────────────────────────── */
  content: { padding: 20, paddingBottom: 60, gap: 14 },

  card: {
    backgroundColor: c.card, borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.3 : 0.05, shadowRadius: 8, elevation: 2,
  },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  caseRef: { fontSize: 12, fontWeight: '800', color: c.textSecondary, letterSpacing: 0.4 },
  issue: {
    fontSize: 20, fontWeight: '800', color: c.textPrimary,
    marginTop: 10, marginBottom: 12, letterSpacing: -0.4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  meta: { fontSize: 12.5, color: c.textSecondary, fontWeight: '500' },

  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },

  /* Action banner */
  actionBanner: {
    flexDirection: 'row', gap: 12, backgroundColor: c.warningBg,
    padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.warning,
  },
  actionBannerIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: isDark ? '#3A2411' : '#FDE68A',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBannerText: { flex: 1, color: c.warning, fontSize: 13, lineHeight: 19, fontWeight: '600' },

  /* Section headers */
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionIconWrap: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  sectionTitle: {
    fontSize: 14.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2,
  },
  quoteBox: {
    backgroundColor: c.background, padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: c.divider,
  },
  body: { fontSize: 14, color: c.textSecondary, lineHeight: 21, fontWeight: '500' },
  stamp: { fontSize: 11, color: c.textMuted, marginTop: 10, fontWeight: '600' },

  /* Progress */
  stepRow: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center', width: 22 },
  dot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE, shadowOpacity: 0.4, shadowRadius: 5, elevation: 3,
  },
  dotCurrent: { backgroundColor: c.card, borderWidth: 3, borderColor: ORANGE },
  line: { flex: 1, width: 2, backgroundColor: c.border, marginVertical: 2 },
  lineDone: { backgroundColor: ORANGE },
  stepTitle: { fontSize: 14, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.2 },
  stepSub: { fontSize: 12, color: c.textSecondary, marginTop: 3, fontWeight: '500' },

  /* Response input */
  textArea: {
    minHeight: 120, backgroundColor: c.background,
    borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    padding: 14, fontSize: 14, color: c.textPrimary, fontWeight: '500',
  },
  counter: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontWeight: '600' },

  /* Submit */
  submit: {
    flexDirection: 'row', backgroundColor: ORANGE,
    paddingVertical: 15, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 12, elevation: 5,
  },
  submitDisabled: {
    backgroundColor: isDark ? '#5A3418' : '#FDBA74',
    shadowOpacity: 0, elevation: 0,
  },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  footnote: {
    fontSize: 11, color: c.textSecondary, textAlign: 'center', marginTop: 10, fontWeight: '500',
  },

  /* Waiting card */
  waitCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: isDark ? '#0F2744' : '#EFF6FF',
    padding: 14, borderRadius: 16, borderWidth: 1,
    borderColor: isDark ? '#1E3A5F' : '#DBEAFE',
  },
  waitIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: isDark ? '#1E3A5F' : '#DBEAFE',
    alignItems: 'center', justifyContent: 'center',
  },
  waitText: {
    flex: 1, fontSize: 13,
    color: isDark ? '#93C5FD' : '#1E40AF',
    lineHeight: 19, fontWeight: '500',
  },
});