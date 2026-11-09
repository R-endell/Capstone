// src/modules/Dashboard/Disputes/ReportIssueScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ISSUE_TYPES, IssueType, ReportableDelivery, createDispute, fetchReportableDeliveries,
  getMyUserId, parseTrackingId, trackingIdFor,
} from '../../../services/disputeService';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon, SolarIconName } from '../../../components/ui/SolarIcon';

const MIN_DESC = 10;
const MAX_DESC = 500;

// Helper to map potential Ionicons/Phosphor strings from disputeService to Solar names
const mapIconName = (name: string): SolarIconName => {
  const n = name.toLowerCase();
  if (n.includes('alert') || n.includes('warning')) return 'DangerCircle';
  if (n.includes('package') || n.includes('box') || n.includes('cube')) return 'Package';
  if (n.includes('time') || n.includes('clock')) return 'Clock';
  if (n.includes('close') || n.includes('cancel')) return 'CloseCircle';
  if (n.includes('shield')) return 'ShieldCheck';
  return 'DangerCircle'; // Default fallback
};

export default function ReportIssueScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

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
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={10}
          activeOpacity={0.85}
        >
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Report an Issue</Text>
        <View style={{ width: 42 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.label}>1. Tracking ID</Text>
          <View
            style={[
              styles.inputWrap,
              trackingError ? styles.inputError
                : match && !match.hasOpenDispute ? styles.inputOk
                : null,
            ]}
          >
            <SolarIcon name="QrCode" variant="linear" size={20} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              value={trackingInput}
              onChangeText={setTrackingInput}
              placeholder="PNS-0000"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {match && !match.hasOpenDispute && (
              <SolarIcon name="CheckCircle" variant="linear" size={20} color={colors.success} />
            )}
          </View>
          {trackingError ? <Text style={styles.errorText}>{trackingError}</Text> : null}

          {match && !match.hasOpenDispute && (
            <View style={styles.matchCard}>
              <View style={styles.matchIconWrap}>
                <SolarIcon name="CheckCircle" variant="duotone" size={18} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.matchRoute} numberOfLines={2}>{match.route}</Text>
                <Text style={styles.matchMeta}>Provider: {match.providerName} · {match.date}</Text>
              </View>
            </View>
          )}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 12 }} />
          ) : deliveries.length > 0 ? (
            <>
              <Text style={styles.subLabel}>Or pick a recent delivery</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
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
                      <Text style={[styles.recentSub, active && { color: 'rgba(255,255,255,0.8)' }]}>{d.date}</Text>
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

          <Text style={[styles.label, { marginTop: 24 }]}>2. What went wrong?</Text>
          <View style={styles.typeGrid}>
            {ISSUE_TYPES.map(t => {
              const active = issueType === t.type;
              const iconName = mapIconName(t.icon);
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
                      active && { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)' },
                    ]}
                  >
                    <SolarIcon name={iconName} variant={active ? 'duotone' : 'linear'} size={20} color={active ? '#FFF' : colors.textPrimary} />
                  </View>
                  <Text style={[styles.typeTitle, active && { color: '#FFF' }]}>{t.type}</Text>
                  <Text style={[styles.typeHint, active && { color: 'rgba(255,255,255,0.9)' }]} numberOfLines={2}>
                    {t.hint}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 24 }]}>3. Describe what happened</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={t => setDescription(t.slice(0, MAX_DESC))}
            placeholder="Tell us what happened, when you noticed it, and the condition of the item…"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />
          <Text style={styles.counter}>
            {description.trim().length < MIN_DESC ? `At least ${MIN_DESC} characters · ` : ''}
            {description.length}/{MAX_DESC}
          </Text>

          <View style={styles.note}>
            <SolarIcon name="InfoCircle" variant="linear" size={18} color={colors.info} />
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
                <SolarIcon name="PaperPlane" variant="linear" size={18} color="#FFF" />
                <Text style={styles.submitText}>Submit Report</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

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

  content: { padding: 20, paddingBottom: 60 },

  label: {
    fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary,
    marginBottom: 10, letterSpacing: -0.2,
  },
  subLabel: {
    fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.textSecondary,
    marginTop: 14, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  inputOk: { borderColor: c.success },
  inputError: { borderColor: c.error },
  input: {
    flex: 1, paddingVertical: 14, fontSize: 16,
    color: c.textPrimary, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.5,
  },
  errorText: { color: c.error, fontSize: 12, marginTop: 8, fontFamily: 'Poppins_500Medium' },
  hint: { color: c.textSecondary, fontSize: 12, marginTop: 12, lineHeight: 18, fontFamily: 'Poppins_400Regular' },

  matchCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.successBg, borderRadius: 12, padding: 14, marginTop: 12,
    borderWidth: 1, borderColor: c.success,
  },
  matchIconWrap: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
  },
  matchRoute: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.success, letterSpacing: -0.2 },
  matchMeta: { fontSize: 12, color: c.success, marginTop: 3, fontFamily: 'Poppins_500Medium', opacity: 0.85 },

  recent: {
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 4, elevation: 0,
  },
  recentActive: {
    backgroundColor: c.accent, borderColor: c.accent,
    shadowColor: c.accent, shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  recentId: { fontSize: 13, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: 0.3 },
  recentSub: { fontSize: 11, color: c.textSecondary, marginTop: 2, fontFamily: 'Poppins_500Medium' },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: {
    width: '48%', backgroundColor: c.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  typeCardActive: {
    backgroundColor: c.accent, borderColor: c.accent,
    shadowColor: c.accent, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3,
  },
  typeIconWrap: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  typeTitle: { fontSize: 13.5, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  typeHint: { fontSize: 11, color: c.textSecondary, lineHeight: 15, fontFamily: 'Poppins_400Regular' },

  textArea: {
    minHeight: 130, backgroundColor: c.card,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12, padding: 16,
    fontSize: 14, color: c.textPrimary, fontFamily: 'Poppins_400Regular',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  counter: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontFamily: 'Poppins_500Medium' },

  note: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: c.infoSoft,
    padding: 14, borderRadius: 12, marginTop: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(96, 165, 250, 0.2)' : 'rgba(59, 130, 246, 0.2)',
  },
  noteText: {
    flex: 1, fontSize: 12,
    color: c.info,
    lineHeight: 18, fontFamily: 'Poppins_400Regular',
  },

  submit: {
    flexDirection: 'row', backgroundColor: c.accent,
    paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 22,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 4,
  },
  submitDisabled: {
    backgroundColor: c.accentSoft, shadowOpacity: 0, elevation: 0,
  },
  submitText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2 },
});