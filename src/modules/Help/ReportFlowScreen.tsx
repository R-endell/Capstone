// src/modules/Help/ReportFlowScreen.tsx
// Registered as the 'ReportIssue' route. Params (all optional):
//   { role?: 'sender' | 'provider', deliveryId?: number, requestId?: number }
// Opened from a delivery, it skips straight to "what went wrong".
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Image,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  MyDelivery, Ticket, MAX_PHOTOS, createTicket, fetchMyDeliveries, getMyUserId, uploadPhotos,
} from '../../services/ticketService';
import { CATEGORIES, Category, Role, SubIssue } from '../../services/ticketCatalog';
import { ScreenHeader, ORANGE } from './helpUi';

const MIN_DESC = 10;
const MAX_DESC = 600;
const STEPS = 4;

export default function ReportFlowScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const roleParam: Role | undefined = route.params?.role;
  const presetDeliveryId: number | undefined = route.params?.deliveryId ? Number(route.params.deliveryId) : undefined;
  const presetRequestId: number | undefined = route.params?.requestId ? Number(route.params.requestId) : undefined;
  const hasPreset = !!(presetDeliveryId || presetRequestId);

  const [step, setStep] = useState(0);
  const [deliveries, setDeliveries] = useState<MyDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivery, setDelivery] = useState<MyDelivery | null>(null);
  const [noDelivery, setNoDelivery] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const [sub, setSub] = useState<SubIssue | null>(null);
  const [description, setDescription] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<Ticket | null>(null);

  const role: Role = delivery?.myRole ?? roleParam ?? 'sender';

  useEffect(() => {
    (async () => {
      try {
        const list = await fetchMyDeliveries(roleParam ? [roleParam] : ['sender', 'provider']);
        setDeliveries(list);
        const hit = list.find(d =>
          (presetDeliveryId && d.delivery_id === presetDeliveryId) ||
          (presetRequestId && d.request_id === presetRequestId && (!roleParam || d.myRole === roleParam)));
        if (hit) { setDelivery(hit); setStep(1); }
      } catch (e) {
        console.warn('[ReportFlow] load deliveries failed:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [roleParam, presetDeliveryId, presetRequestId]);

  const categories = useMemo(() => {
    const all = CATEGORIES[role];
    if (noDelivery) return all.filter(c => c.delivery !== 'required');
    if (delivery?.openTicketId) return all.filter(c => c.type !== 'dispute'); // one open report per delivery
    return all;
  }, [role, noDelivery, delivery]);

  // Search by delivery ID (PNS-0012, 0012 or just 12), or by address / person name.
  const shownDeliveries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deliveries;
    const compact = q.replace(/[^a-z0-9]/g, '');
    return deliveries.filter(d =>
      d.tracking.toLowerCase().replace(/[^a-z0-9]/g, '').includes(compact) ||
      String(d.request_id) === compact ||
      d.route.toLowerCase().includes(q) ||
      d.otherName.toLowerCase().includes(q));
  }, [deliveries, query]);

  const goBack = useCallback(() => {
    if (created) { navigation.goBack(); return true; }
    if (step === 0 || (step === 1 && hasPreset)) { navigation.goBack(); return true; }
    setStep(s => s - 1);
    return true;
  }, [created, step, hasPreset, navigation]);

  useEffect(() => {
    const bh = BackHandler.addEventListener('hardwareBackPress', goBack);
    return () => bh.remove();
  }, [goBack]);

  // ---------------- photos
  const addPhotos = async (fromCamera: boolean) => {
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow ${fromCamera ? 'camera' : 'photo'} access to attach pictures.`);
      return;
    }
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.6,
        });
    if (res.canceled) return;
    setPhotos(p => [...p, ...res.assets.map(a => a.uri)].slice(0, MAX_PHOTOS));
  };

  // ---------------- navigation between steps
  const canNext =
    step === 0 ? !!delivery || noDelivery
    : step === 1 ? !!category && !!sub
    : step === 2 ? description.trim().length >= MIN_DESC
    : !submitting;

  const next = () => {
    if (!canNext) return;
    if (step < STEPS - 1) setStep(step + 1); else submit();
  };

  const pickDelivery = (d: MyDelivery) => {
    if (d.openTicketId) {
      navigation.navigate('TicketDetail', { ticketId: d.openTicketId });
      return;
    }
    setDelivery(d); setNoDelivery(false); setCategory(null); setSub(null);
  };

  const pickCategory = (c: Category) => {
    setCategory(c); setSub(null); setOutcome(null);
  };

  const submit = async () => {
    if (!category || !sub) return;
    try {
      setSubmitting(true);
      let attachments: { path: string }[] = [];
      if (photos.length) {
        const me = await getMyUserId();
        if (!me) throw new Error('Please sign in again.');
        attachments = await uploadPhotos(me, photos);
      }
      const t = await createTicket({
        type: category.type,
        category: category.label,
        subIssue: sub.label,
        description: description.trim(),
        role,
        deliveryId: delivery?.delivery_id ?? null,
        requestedResolution: outcome,
        attachments,
        legacyIssueType: sub.legacy,
      });
      setCreated(t);
    } catch (e: any) {
      Alert.alert('Could not submit', e?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------- success
  if (created) {
    const withOther = !!created.counterparty_id;
    return (
      <View style={styles.container}>
        <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
        <ScrollView contentContainerStyle={[styles.doneWrap, { paddingTop: insets.top + 56 }]}>
          <View style={styles.doneIcon}><Ionicons name="checkmark" size={40} color="#FFF" /></View>
          <Text style={styles.doneTitle}>We got your report</Text>
          <Text style={styles.doneRef}>{created.ticket_ref}</Text>

          <View style={styles.nextCard}>
            <Text style={styles.nextTitle}>What happens next</Text>
            {(withOther
              ? [
                  `The ${role === 'sender' ? 'provider' : 'sender'} is notified and asked for their side.`,
                  'Our team reviews both sides and the photos.',
                  'You get a notification here with the decision.',
                ]
              : [
                  'Our support team reads your message.',
                  'You get a reply in this ticket. We may ask for more details.',
                ]
            ).map((line, i) => (
              <View key={i} style={styles.nextRow}>
                <View style={styles.nextDot} />
                <Text style={styles.nextText}>{line}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.primary} activeOpacity={0.9}
            onPress={() => navigation.replace('TicketDetail', { ticketId: created.ticket_id })}
          >
            <Text style={styles.primaryText}>View ticket</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.ghostText}>Done</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  const titles = ['Which delivery?', 'What went wrong?', 'Tell us more', 'Review and send'];

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Report a problem" onBack={goBack} />

      <View style={styles.progress}>
        {Array.from({ length: STEPS }).map((_, i) => (
          <View key={i} style={[styles.seg, i <= step && styles.segOn]} />
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.stepTitle}>{titles[step]}</Text>

          {/* ---------------- step 0: delivery */}
          {step === 0 && (
            <>
              <Text style={styles.stepSub}>Pick the delivery this is about so we can look into it faster.</Text>
              {loading ? (
                <ActivityIndicator color={ORANGE} style={{ marginVertical: 24 }} />
              ) : (
                <View style={{ gap: 10 }}>
                  {deliveries.length > 0 && (
                    <View style={styles.search}>
                      <Ionicons name="search" size={18} color={colors.textMuted} />
                      <TextInput
                        style={styles.searchInput} value={query} onChangeText={setQuery}
                        placeholder="Search by delivery ID, e.g. PNS-0012"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="characters" autoCorrect={false} returnKeyType="search"
                      />
                      {query.length > 0 && (
                        <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  {deliveries.length > 0 && shownDeliveries.length === 0 && (
                    <Text style={styles.hint}>No delivery matches "{query.trim()}". Check the ID and try again.</Text>
                  )}
                  {shownDeliveries.map(d => {
                    const on = delivery?.delivery_id === d.delivery_id && delivery?.myRole === d.myRole;
                    return (
                      <TouchableOpacity key={`${d.myRole}-${d.delivery_id}`} onPress={() => pickDelivery(d)}
                        activeOpacity={0.85} style={[styles.card, on && styles.cardOn]}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={styles.cardTop}>
                            <Text style={styles.cardTitle}>{d.tracking}</Text>
                            {!roleParam && (
                              <Text style={styles.roleTag}>{d.myRole === 'sender' ? 'You sent' : 'You delivered'}</Text>
                            )}
                          </View>
                          <Text style={styles.cardSub} numberOfLines={2}>{d.route}</Text>
                          <Text style={styles.cardMeta}>
                            {d.myRole === 'sender' ? 'Provider' : 'Sender'}: {d.otherName}   {d.date}
                          </Text>
                          {d.openTicketId ? <Text style={styles.openTag}>Report already open. Tap to view</Text> : null}
                        </View>
                        {on && <Ionicons name="checkmark-circle" size={22} color={ORANGE} />}
                      </TouchableOpacity>
                    );
                  })}

                  <TouchableOpacity
                    onPress={() => { setNoDelivery(true); setDelivery(null); setCategory(null); setSub(null); }}
                    activeOpacity={0.85} style={[styles.card, noDelivery && styles.cardOn]}>
                    <Ionicons name="help-buoy-outline" size={22} color={ORANGE} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>It's not about a delivery</Text>
                      <Text style={styles.cardSub}>Payments, account, verification or the app</Text>
                    </View>
                    {noDelivery && <Ionicons name="checkmark-circle" size={22} color={ORANGE} />}
                  </TouchableOpacity>

                  {deliveries.length === 0 && (
                    <Text style={styles.hint}>
                      You have no matched deliveries yet. Delivery reports become available once a provider is assigned.
                    </Text>
                  )}
                </View>
              )}
            </>
          )}

          {/* ---------------- step 1: category + sub-issue */}
          {step === 1 && (
            <>
              {delivery && (
                <View style={styles.context}>
                  <Ionicons name="cube-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.contextText} numberOfLines={1}>{delivery.tracking}   {delivery.route}</Text>
                </View>
              )}
              {delivery?.openTicketId ? (
                <TouchableOpacity style={styles.banner} onPress={() => navigation.navigate('TicketDetail', { ticketId: delivery.openTicketId })}>
                  <Ionicons name="information-circle-outline" size={18} color="#3B82F6" />
                  <Text style={styles.bannerText}>You already have an open report for this delivery. Tap to view it.</Text>
                </TouchableOpacity>
              ) : null}

              <View style={{ gap: 10 }}>
                {categories.map(c => {
                  const on = category?.key === c.key;
                  return (
                    <View key={c.key}>
                      <TouchableOpacity onPress={() => pickCategory(c)} activeOpacity={0.85} style={[styles.card, on && styles.cardOn]}>
                        <View style={styles.catIcon}><Ionicons name={c.icon as any} size={20} color={ORANGE} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardTitle}>{c.label}</Text>
                          <Text style={styles.cardSub}>{c.blurb}</Text>
                        </View>
                        <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                      </TouchableOpacity>

                      {on && (
                        <View style={styles.subList}>
                          {c.subIssues.map(s => {
                            const sel = sub?.key === s.key;
                            return (
                              <TouchableOpacity key={s.key} style={styles.subRow} onPress={() => setSub(s)} activeOpacity={0.8}>
                                <View style={[styles.radio, sel && styles.radioOn]}>
                                  {sel && <View style={styles.radioDot} />}
                                </View>
                                <Text style={[styles.subText, sel && { color: colors.textPrimary, fontWeight: '800' }]}>{s.label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ---------------- step 2: details */}
          {step === 2 && category && sub && (
            <>
              <Text style={styles.stepSub}>{category.label}: {sub.label}</Text>

              <Text style={styles.label}>What happened?</Text>
              <TextInput
                style={styles.textArea} value={description} multiline textAlignVertical="top"
                onChangeText={t => setDescription(t.slice(0, MAX_DESC))}
                placeholder="When did it happen, and what's the condition now? The more specific, the faster we can help."
                placeholderTextColor={colors.textMuted}
              />
              <Text style={styles.counter}>
                {description.trim().length < MIN_DESC ? `At least ${MIN_DESC} characters   ` : ''}{description.length}/{MAX_DESC}
              </Text>

              <Text style={[styles.label, { marginTop: 18 }]}>
                Photos {category.photos ? '(recommended)' : '(optional)'}
              </Text>
              <View style={styles.photoGrid}>
                {photos.map((uri, i) => (
                  <View key={uri + i} style={styles.photoBox}>
                    <Image source={{ uri }} style={styles.photo} />
                    <TouchableOpacity style={styles.photoX} onPress={() => setPhotos(p => p.filter((_, j) => j !== i))} hitSlop={8}>
                      <Ionicons name="close" size={14} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <>
                    <TouchableOpacity style={styles.photoAdd} onPress={() => addPhotos(true)} activeOpacity={0.8}>
                      <Ionicons name="camera-outline" size={22} color={ORANGE} />
                      <Text style={styles.photoAddText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.photoAdd} onPress={() => addPhotos(false)} activeOpacity={0.8}>
                      <Ionicons name="images-outline" size={22} color={ORANGE} />
                      <Text style={styles.photoAddText}>Gallery</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              {category.outcomes.length > 0 && (
                <>
                  <Text style={[styles.label, { marginTop: 18 }]}>What outcome would you like?</Text>
                  <View style={styles.chips}>
                    {category.outcomes.map(o => {
                      const on = outcome === o;
                      return (
                        <TouchableOpacity key={o} style={[styles.chip, on && styles.chipOn]}
                          onPress={() => setOutcome(on ? null : o)} activeOpacity={0.85}>
                          <Text style={[styles.chipText, on && { color: '#FFF' }]}>{o}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </>
          )}

          {/* ---------------- step 3: review */}
          {step === 3 && category && sub && (
            <>
              <View style={styles.review}>
                {delivery && <ReviewRow styles={styles} label="Delivery" value={`${delivery.tracking}\n${delivery.route}`} />}
                <ReviewRow styles={styles} label="Issue" value={`${category.label}\n${sub.label}`} />
                <ReviewRow styles={styles} label="Details" value={description.trim()} />
                {outcome ? <ReviewRow styles={styles} label="Requested outcome" value={outcome} /> : null}
                <ReviewRow styles={styles} label="Photos" value={photos.length ? `${photos.length} attached` : 'None'} last />
              </View>
              <View style={styles.banner}>
                <Ionicons name="information-circle-outline" size={18} color="#3B82F6" />
                <Text style={styles.bannerText}>
                  {category.type === 'dispute'
                    ? `The ${role === 'sender' ? 'provider' : 'sender'} will be asked to respond, then our team reviews both sides.`
                    : 'Our support team will reply to you in the ticket.'}
                </Text>
              </View>
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
          <TouchableOpacity
            style={[styles.primary, !canNext && styles.primaryOff]} disabled={!canNext} onPress={next} activeOpacity={0.9}>
            {submitting
              ? <ActivityIndicator color="#FFF" />
              : <Text style={styles.primaryText}>{step === STEPS - 1 ? 'Submit report' : 'Continue'}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function ReviewRow({ styles, label, value, last }: { styles: any; label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.reviewRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.reviewLabel}>{label}</Text>
      <Text style={styles.reviewValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  progress: { flexDirection: 'row', gap: 6, paddingHorizontal: 20, paddingBottom: 6 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.divider },
  segOn: { backgroundColor: ORANGE },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  stepTitle: { fontSize: 24, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.6 },
  stepSub: { fontSize: 13.5, color: c.textSecondary, lineHeight: 20, marginBottom: 4, fontWeight: '500' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card,
    borderWidth: 1.5, borderColor: c.border, borderRadius: 14, paddingHorizontal: 14, height: 48,
  },
  searchInput: { flex: 1, fontSize: 14, color: c.textPrimary, fontWeight: '600', paddingVertical: 0 },
  hint: { fontSize: 12.5, color: c.textSecondary, lineHeight: 18, marginTop: 4 },
  label: { fontSize: 14.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2, marginBottom: 8 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.card, borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 6, elevation: 1,
  },
  cardOn: { borderColor: ORANGE, backgroundColor: c.accentSoft },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  cardSub: { fontSize: 12.5, color: c.textSecondary, lineHeight: 17, fontWeight: '500' },
  cardMeta: { fontSize: 11.5, color: c.textMuted, fontWeight: '600', marginTop: 2 },
  roleTag: { fontSize: 11, fontWeight: '800', color: ORANGE },
  openTag: { fontSize: 11.5, fontWeight: '800', color: '#3B82F6', marginTop: 4 },
  catIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },

  context: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.card, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.divider },
  contextText: { flex: 1, fontSize: 12, color: c.textSecondary, fontWeight: '600' },

  subList: { backgroundColor: c.card, borderRadius: 16, marginTop: 6, paddingVertical: 4, borderWidth: 1, borderColor: c.divider },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  subText: { flex: 1, fontSize: 14, color: c.textSecondary, fontWeight: '600' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: ORANGE },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },

  textArea: {
    minHeight: 130, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, borderRadius: 16, padding: 16,
    fontSize: 14, color: c.textPrimary, fontWeight: '500',
  },
  counter: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontWeight: '600' },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoBox: { width: 86, height: 86, borderRadius: 14, overflow: 'hidden' },
  photo: { width: '100%', height: '100%' },
  photoX: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  photoAdd: {
    width: 86, height: 86, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ORANGE,
    alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.accentSoft,
  },
  photoAddText: { fontSize: 11, fontWeight: '800', color: ORANGE },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: c.border, backgroundColor: c.card },
  chipOn: { backgroundColor: ORANGE, borderColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '700', color: c.textPrimary },

  review: { backgroundColor: c.card, borderRadius: 18, borderWidth: 1, borderColor: c.divider, paddingHorizontal: 16 },
  reviewRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.divider, gap: 4 },
  reviewLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  reviewValue: { fontSize: 14, fontWeight: '600', color: c.textPrimary, lineHeight: 20 },

  banner: { flexDirection: 'row', gap: 10, backgroundColor: isDark ? '#0F2744' : '#EFF6FF', padding: 14, borderRadius: 14, alignItems: 'center' },
  bannerText: { flex: 1, fontSize: 12.5, color: isDark ? '#93C5FD' : '#1E40AF', lineHeight: 18, fontWeight: '500' },

  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background },
  primary: {
    backgroundColor: ORANGE, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  primaryOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74', shadowOpacity: 0, elevation: 0 },
  primaryText: { color: '#FFF', fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },
  ghost: { alignItems: 'center', paddingVertical: 16 },
  ghostText: { color: c.textSecondary, fontSize: 14.5, fontWeight: '700' },

  doneWrap: { alignItems: 'stretch', paddingHorizontal: 24, paddingBottom: 40, gap: 14 },
  doneIcon: { alignSelf: 'center', width: 84, height: 84, borderRadius: 42, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { fontSize: 24, fontWeight: '800', color: c.textPrimary, textAlign: 'center', letterSpacing: -0.6, marginTop: 8 },
  doneRef: { fontSize: 15, fontWeight: '800', color: ORANGE, textAlign: 'center', letterSpacing: 0.4 },
  nextCard: { backgroundColor: c.card, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: c.divider, gap: 12, marginVertical: 8 },
  nextTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary },
  nextRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  nextDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE, marginTop: 6 },
  nextText: { flex: 1, fontSize: 13.5, color: c.textSecondary, lineHeight: 20, fontWeight: '500' },
});