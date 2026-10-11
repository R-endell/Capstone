// src/modules/Dashboard/Disputes/DisputeDetailScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
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

const ORANGE = '#FA7A25';
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
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'disputes', filter: `dispute_id=eq.${disputeId}` },
        () => load())
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
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
        <Ionicons name="arrow-back" size={24} color="#000" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Dispute Details</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <ActivityIndicator color={ORANGE} style={{ marginTop: 60 }} />
      </View>
    );
  }
  if (!dispute) {
    return (
      <View style={styles.container}>
        {header}
        <Text style={styles.missing}>This report could not be found.</Text>
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
      <StatusBar barStyle="dark-content" backgroundColor={ORANGE} />
      {header}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.caseRef}>{dispute.dispute_ref || `Case #${dispute.dispute_id}`}</Text>
              <View style={[styles.badge, { backgroundColor: st.bg }]}>
                <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
              </View>
            </View>
            <Text style={styles.issue}>{dispute.issue_type}</Text>
            <Text style={styles.meta}>Tracking ID: {trackingIdFor(dispute.request_id)}</Text>
            <Text style={styles.meta}>Reported by: {isReporter ? 'You' : displayName(dispute.reporter)}</Text>
            <Text style={styles.meta}>Provider: {isProvider ? 'You' : displayName(dispute.provider)}</Text>
          </View>

          {/* Needs action */}
          {canRespond && (
            <View style={styles.actionBanner}>
              <Ionicons name="alert-circle" size={20} color="#92400E" />
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
                <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
                  <Text style={[styles.stepTitle, !s.done && !s.current && { color: '#9CA3AF' }]}>{s.title}</Text>
                  <Text style={styles.stepSub}>{s.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Sender's report */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Sender’s report</Text>
            <Text style={styles.body}>{dispute.description}</Text>
          </View>

          {/* Provider side */}
          {responded && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Provider’s response</Text>
              <Text style={styles.body}>{dispute.provider_response}</Text>
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
                placeholderTextColor="#9CA3AF"
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
                {sending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>Submit Response</Text>}
              </TouchableOpacity>
              <Text style={styles.footnote}>You can only respond once. After that the admin reviews the case.</Text>
            </View>
          )}

          {/* Waiting hints */}
          {!closed && !canRespond && (
            <View style={styles.waitCard}>
              <Ionicons name="time-outline" size={18} color="#1D4ED8" />
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
            <View style={[styles.card, { borderColor: dispute.status === 'Resolved' ? '#86EFAC' : '#E5E7EB' }]}>
              <Text style={styles.sectionTitle}>Admin decision</Text>
              <View style={[styles.badge, { backgroundColor: st.bg, alignSelf: 'flex-start', marginBottom: 8 }]}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 20, gap: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#000' },
  missing: { textAlign: 'center', color: '#6B7280', marginTop: 60 },
  content: { padding: 20, paddingBottom: 60, gap: 14 },
  card: { backgroundColor: '#FFF', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caseRef: { fontSize: 12, fontWeight: '700', color: '#6B7280', letterSpacing: 0.3 },
  issue: { fontSize: 20, fontWeight: '800', color: '#111827', marginVertical: 6 },
  meta: { fontSize: 12, color: '#4B5563', lineHeight: 18 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  actionBanner: {
    flexDirection: 'row', gap: 10, backgroundColor: '#FEF3C7', padding: 14, borderRadius: 12,
  },
  actionBannerText: { flex: 1, color: '#92400E', fontSize: 13, lineHeight: 19, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#111827', marginBottom: 10 },
  body: { fontSize: 14, color: '#374151', lineHeight: 21 },
  stamp: { fontSize: 11, color: '#9CA3AF', marginTop: 8 },
  stepRow: { flexDirection: 'row', gap: 12 },
  stepRail: { alignItems: 'center', width: 22 },
  dot: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#E5E7EB',
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: ORANGE },
  dotCurrent: { backgroundColor: '#FFF', borderWidth: 3, borderColor: ORANGE },
  line: { flex: 1, width: 2, backgroundColor: '#E5E7EB', marginVertical: 2 },
  lineDone: { backgroundColor: ORANGE },
  stepTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  stepSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  textArea: {
    minHeight: 120, backgroundColor: '#F9FAFB', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 12, padding: 14, fontSize: 14, color: '#111827',
  },
  counter: { fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 6 },
  submit: { backgroundColor: ORANGE, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  submitDisabled: { backgroundColor: '#FDBA74' },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  footnote: { fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 10 },
  waitCard: { flexDirection: 'row', gap: 10, backgroundColor: '#EFF6FF', padding: 14, borderRadius: 12 },
  waitText: { flex: 1, fontSize: 13, color: '#1E40AF', lineHeight: 19 },
});