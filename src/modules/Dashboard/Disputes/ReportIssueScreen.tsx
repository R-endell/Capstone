// src/modules/Dashboard/Disputes/ReportIssueScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import {
  ISSUE_TYPES, IssueType, ReportableDelivery, createDispute, fetchReportableDeliveries,
  getMyUserId, parseTrackingId, trackingIdFor,
} from '../../../services/disputeService';

/** Brand */
const ORANGE = '#F27024';
const ORANGE_SOFT = '#FFF4EC';
const ORANGE_BORDER = '#FFD9B8';

const MIN_DESC = 10;
const MAX_DESC = 500;

export default function ReportIssueScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const [deliveries, setDeliveries] = useState<ReportableDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingInput, setTrackingInput] = useState(
    route.params?.requestId ? trackingIdFor(Number(route.params.requestId)) : ''
  );
  const [issueType, setIssueType] = useState<IssueType | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const id = await getMyUserId();
        if (id) setDeliveries(await fetchReportableDeliveries(id));
      } catch (e) {
        console.error('Report load error:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const parsedId = parseTrackingId(trackingInput);
  const match = useMemo(
    () => (parsedId ? deliveries.find(d => d.request_id === parsedId) || null : null),
    [parsedId, deliveries]
  );

  const trackingError =
    trackingInput.trim().length > 0 && !loading && !match
      ? parsedId
        ? 'No delivery with this tracking ID was found on your account, or it has no provider yet.'
        : 'Enter a valid tracking ID, e.g. PNS-0012.'
      : match?.hasOpenDispute
        ? 'There is already an open report for this delivery.'
        : null;

  const canSubmit =
    !!match && !match.hasOpenDispute && !!issueType &&
    description.trim().length >= MIN_DESC && !submitting;

  const submit = async () => {
    if (!match || !issueType) return;
    try {
      setSubmitting(true);
      const d = await createDispute(match.request_id, issueType, description.trim());
      Alert.alert(
        'Report submitted',
        'The provider has been notified and can respond. An admin will review the case and you will be updated here.',
        [{ text: 'View report', onPress: () => navigation.replace('DisputeDetail', { disputeId: d.dispute_id }) }],
        { cancelable: false }
      );
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAFAFA" translucent />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          activeOpacity={0.8}
        >
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report an Issue</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 1. Tracking ID */}
          <Text style={styles.label}>1. Tracking ID</Text>
          <View
            style={[
              styles.inputWrap,
              trackingError
                ? styles.inputError
                : match && !match.hasOpenDispute
                ? styles.inputOk
                : null,
            ]}
          >
            <Ionicons name="barcode-outline" size={20} color="#6B7280" />
            <TextInput
              style={styles.input}
              value={trackingInput}
              onChangeText={setTrackingInput}
              placeholder="PNS-0000"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {match && !match.hasOpenDispute && (
              <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
            )}
          </View>
          {trackingError ? <Text style={styles.errorText}>{trackingError}</Text> : null}

          {match && !match.hasOpenDispute && (
            <View style={styles.matchCard}>
              <View style={styles.matchIconWrap}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchRoute} numberOfLines={2}>{match.route}</Text>
                <Text style={styles.matchMeta}>Provider: {match.providerName} · {match.date}</Text>
              </View>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={ORANGE} style={{ marginVertical: 12 }} />
          ) : deliveries.length > 0 ? (
            <>
              <Text style={styles.subLabel}>Or pick a recent delivery</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8 }}
              >
                {deliveries.slice(0, 10).map(d => {
                  const active = match?.request_id === d.request_id;
                  return (
                    <TouchableOpacity
                      key={d.request_id}
                      style={[styles.recent, active && styles.recentActive]}
                      onPress={() => setTrackingInput(d.tracking)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.recentId, active && { color: '#FFF' }]}>{d.tracking}</Text>
                      <Text style={[styles.recentSub, active && { color: '#FFEDD5' }]}>{d.date}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <Text style={styles.hint}>
              You have no deliveries with an assigned provider yet. Reports can only be filed on matched deliveries.
            </Text>
          )}

          {/* 2. Issue type */}
          <Text style={[styles.label, { marginTop: 24 }]}>2. What went wrong?</Text>
          <View style={styles.typeGrid}>
            {ISSUE_TYPES.map(t => {
              const active = issueType === t.type;
              return (
                <TouchableOpacity
                  key={t.type}
                  style={[styles.typeCard, active && styles.typeCardActive]}
                  onPress={() => setIssueType(t.type)}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.typeIconWrap,
                      active && { backgroundColor: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.4)' },
                    ]}
                  >
                    <Ionicons name={t.icon as any} size={20} color={active ? '#FFF' : ORANGE} />
                  </View>
                  <Text style={[styles.typeTitle, active && { color: '#FFF' }]}>{t.type}</Text>
                  <Text style={[styles.typeHint, active && { color: '#FFEDD5' }]} numberOfLines={2}>
                    {t.hint}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* 3. Description */}
          <Text style={[styles.label, { marginTop: 24 }]}>3. Describe what happened</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={t => setDescription(t.slice(0, MAX_DESC))}
            placeholder="Tell us what happened, when you noticed it, and the condition of the item…"
            placeholderTextColor="#9CA3AF"
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.counter}>
            {description.trim().length < MIN_DESC ? `At least ${MIN_DESC} characters · ` : ''}
            {description.length}/{MAX_DESC}
          </Text>

          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color="#1D4ED8" />
            <Text style={styles.noteText}>
              The provider will be asked to respond, then an admin reviews both sides. You will get a notification when the review is done.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            disabled={!canSubmit}
            onPress={submit}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="paper-plane-outline" size={18} color="#FFF" />
                <Text style={styles.submitText}>Submit Report</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },

  /* ── Header ─────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
  },

  /* ── Content ────────────────────────────────────── */
  content: { padding: 20, paddingBottom: 60 },

  label: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    marginTop: 14,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  /* Tracking input */
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  inputOk: { borderColor: '#16A34A' },
  inputError: { borderColor: '#EF4444' },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  errorText: { color: '#DC2626', fontSize: 12, marginTop: 8, fontWeight: '600' },
  hint: { color: '#6B7280', fontSize: 12, marginTop: 12, lineHeight: 18 },

  /* Matched delivery card */
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F0FDF4',
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  matchIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchRoute: { fontSize: 13, fontWeight: '800', color: '#14532D', letterSpacing: -0.2 },
  matchMeta: { fontSize: 12, color: '#166534', marginTop: 3, fontWeight: '500' },

  /* Recent chips */
  recent: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  recentActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  recentId: { fontSize: 13, fontWeight: '800', color: '#111827', letterSpacing: 0.3 },
  recentSub: { fontSize: 11, color: '#6B7280', marginTop: 2, fontWeight: '600' },

  /* Issue type cards */
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#F3F4F6',
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  typeCardActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  typeIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: ORANGE_SOFT,
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeTitle: { fontSize: 13.5, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  typeHint: { fontSize: 11, color: '#6B7280', lineHeight: 15, fontWeight: '500' },

  /* Description */
  textArea: {
    minHeight: 130,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  counter: { fontSize: 11, color: '#9CA3AF', textAlign: 'right', marginTop: 6, fontWeight: '600' },

  /* Info note */
  note: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#EFF6FF',
    padding: 14,
    borderRadius: 14,
    marginTop: 16,
  },
  noteText: { flex: 1, fontSize: 12, color: '#1E40AF', lineHeight: 18, fontWeight: '500' },

  /* Submit */
  submit: {
    flexDirection: 'row',
    backgroundColor: ORANGE,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  submitDisabled: {
    backgroundColor: '#FDBA74',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
});