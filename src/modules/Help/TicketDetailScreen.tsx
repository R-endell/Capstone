// src/modules/Help/TicketDetailScreen.tsx
// Params: { ticketId: number, source?: 'reportAgainstMe' }
//         (or legacy { disputeId: number }, resolved to its ticket)
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), numbered upload-style
// section headers, tinted notes, primary button with press spring, staged
// fade-up entrance. Chat bubbles + bottom sheets keep their own idioms
// (there is no form equivalent) but align typography/inputs to the system.
//
// When the viewer is the counterparty (i.e. a sender reported them), this
// screen shows the report read-only plus a one-time "Dispute this report"
// action. That's the flow for a report AGAINST you — it isn't your ticket.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Image, Modal,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Pressable, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  Attachment, MAX_PHOTOS, Ticket, TicketEvent, TicketMessage,
  buildTimeline, displayName, fetchThread, fetchTicket, fetchTicketIdByDispute, fmtDateTime,
  getMyUserId, isClosed, sendMessage, signAttachmentUrls, statusView, subscribeTickets,
  trackingIdFor, uploadPhotos,
} from '../../services/ticketService';
import {
  ScreenHeader, StatusPill, TicketStepper, SectionCard, Note, ORANGE, useStagedEntrance, fadeUp,
} from './helpUi';
import { APPEAL_MIN_CHARS, APPEAL_WINDOW_DAYS, AppealState, loadAppealState, submitAppeal } from '../../services/appealService';

export default function TicketDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [ticketId, setTicketId] = useState<number | null>(
    route.params?.ticketId ? Number(route.params.ticketId) : null,
  );
  const [me, setMe] = useState<number | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [text, setText] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [respondOpen, setRespondOpen] = useState(false);
  const [appeal, setAppeal] = useState<{ state: AppealState; appealTicketId?: number }>({ state: 'na' });
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealText, setAppealText] = useState('');
  const [appealing, setAppealing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Staged entrance: summary → stepper → resolution → messages
  const [summaryAnim, stepperAnim, resolutionAnim, messagesAnim] = useStagedEntrance(4);
  const btnScale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();

  // Legacy deep link: { disputeId } -> the ticket that mirrors it
  useEffect(() => {
    if (ticketId || !route.params?.disputeId) return;
    (async () => {
      const id = await fetchTicketIdByDispute(Number(route.params.disputeId));
      if (id) setTicketId(id);
      else { setNotFound(true); setLoading(false); }
    })();
  }, [ticketId, route.params?.disputeId]);

  const load = useCallback(async () => {
    if (!ticketId) return;
    try {
      const [myId, t, thread] = await Promise.all([getMyUserId(), fetchTicket(ticketId), fetchThread(ticketId)]);
      setMe(myId);
      if (!t) { setNotFound(true); return; }
      setTicket(t);
      setMessages(thread.messages);
      setEvents(thread.events);
      const paths = thread.messages.flatMap(m => (m.attachments || []).map(a => a.path));
      setUrls(await signAttachmentUrls(paths));
    } catch (e: any) {
      console.warn('[TicketDetail] load failed:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => (ticketId ? subscribeTickets(load, ticketId) : undefined), [ticketId, load]);

  // Can this person appeal the decision? (one appeal, within the allowed days)
  useEffect(() => {
    if (!ticket || !me || !isClosed(ticket.status)) { setAppeal({ state: 'na' }); return; }
    loadAppealState(ticket, me).then(setAppeal).catch(() => setAppeal({ state: 'na' }));
  }, [ticket, me]);

  const view = ticket ? statusView(ticket, me) : null;
  const closed = ticket ? isClosed(ticket.status) : false;
  const iAmCounterparty = !!ticket && ticket.counterparty_id === me;
  const needsMyReply = view?.tone === 'action';

  const otherName = (m: TicketMessage) => {
    if (m.sender_kind === 'staff') return 'Support team';
    if (m.sender_kind === 'reporter') return displayName(ticket?.reporter);
    if (m.sender_kind === 'counterparty') return displayName(ticket?.counterparty);
    return 'Pick N Ship';
  };

  // The original report is the one message both parties see; everything else is a private thread with support.
  const isSharedReport = (m: TicketMessage) => m.audience_id == null && m.sender_kind === 'reporter';
  const hasPrivate = messages.some(m => m.audience_id != null);
  // The reported party (provider) cannot chat: they get one response, then read-only.
  const hasResponded = messages.some(m => m.sender_kind === 'counterparty' && m.sender_id === me);
  const canRespond = iAmCounterparty && !closed && !hasResponded;
  const whoLabel = (m: TicketMessage) =>
    isSharedReport(m)
      ? (m.sender_id === me ? 'Your report' : `Report from ${displayName(ticket?.reporter)}`)
      : (m.sender_id === me && m.sender_kind !== 'staff' ? 'You' : otherName(m));

  const addPhotos = async () => {
    const room = MAX_PHOTOS - pending.length;
    if (room <= 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach pictures.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 0.6,
    });
    if (!res.canceled) setPending(p => [...p, ...res.assets.map(a => a.uri)].slice(0, MAX_PHOTOS));
  };

  const send = async () => {
    if (!ticket || !me || sending) return;
    const body = text.trim();
    if (!body && pending.length === 0) return;
    try {
      setSending(true);
      let attachments: Attachment[] = [];
      if (pending.length) attachments = await uploadPhotos(me, pending);
      await sendMessage(ticket, body, attachments);
      setText(''); setPending([]);
      setRespondOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const sendAppeal = async () => {
    if (!ticket || !me || appealing) return;
    try {
      setAppealing(true);
      const t = await submitAppeal(ticket, me, appealText, pending);
      setAppealOpen(false); setAppealText(''); setPending([]);
      navigation.replace('TicketDetail', { ticketId: t.ticket_id });
    } catch (e: any) {
      Alert.alert('Could not send appeal', e?.message || 'Please try again.');
    } finally {
      setAppealing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator color={ORANGE} />
      </View>
    );
  }

  if (notFound || !ticket || !view) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Ticket" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <SectionCard style={{ alignItems: 'center', gap: 8 }}>
            <Ionicons name="alert-circle-outline" size={34} color={colors.textMuted} />
            <Text style={styles.centerTitle}>We couldn't find this ticket</Text>
            <Text style={styles.centerSub}>It may have been removed, or it belongs to another account.</Text>
          </SectionCard>
        </View>
      </View>
    );
  }

  const timeline = buildTimeline(ticket, events);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader
        title={ticket.ticket_ref || 'Ticket'}
        subtitle={iAmCounterparty ? 'Report against you' : ticket.category}
        onBack={() => navigation.goBack()}
      />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* summary */}
          <Animated.View style={fadeUp(summaryAnim, 20)}>
            <SectionCard>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumberBadge}>
                  <Text style={styles.sectionNumberText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Summary</Text>
                  <Text style={styles.sectionSubtitle}>{ticket.ticket_ref}</Text>
                </View>
              </View>

              <Text style={styles.sumTitle}>{ticket.sub_issue}</Text>
              <View style={{ marginTop: 8 }}>
                <StatusPill view={view} />
              </View>
              <Text style={styles.sumHint}>{view.hint}</Text>
              <View style={styles.facts}>
                {ticket.request_id ? <Fact styles={styles} label="Delivery" value={trackingIdFor(ticket.request_id)} /> : null}
                <Fact styles={styles} label="Reported by"
                  value={iAmCounterparty ? displayName(ticket.reporter) : 'You'} />
                {ticket.requested_resolution ? <Fact styles={styles} label="Requested outcome" value={ticket.requested_resolution} /> : null}
                <Fact styles={styles} label="Opened" value={fmtDateTime(ticket.created_at)} />
              </View>
            </SectionCard>
          </Animated.View>

          {/* progress stepper */}
          <Animated.View style={fadeUp(stepperAnim, 20)}>
            <TicketStepper steps={timeline} />
          </Animated.View>

          {/* resolution */}
          {closed && ticket.resolution ? (
            <Animated.View style={fadeUp(resolutionAnim, 20)}>
              <View style={styles.resolution}>
                <View style={styles.resHead}>
                  <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
                  <Text style={styles.resTitle}>{ticket.status === 'Resolved' ? 'Decision' : 'Closed'}</Text>
                </View>
                <Text style={styles.resBody}>{ticket.resolution}</Text>
              </View>
            </Animated.View>
          ) : null}

          {/* conversation */}
          <Animated.View style={fadeUp(messagesAnim, 20)}>
            <SectionCard>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionNumberBadge}>
                  <Text style={styles.sectionNumberText}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Messages</Text>
                  <Text style={styles.sectionSubtitle}>
                    {iAmCounterparty
                      ? 'Your response goes to support only'
                      : 'Private between you and support'}
                  </Text>
                </View>
              </View>

              <Note
                tone="neutral"
                icon={<Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />}
              >
                {iAmCounterparty
                  ? 'The report and its photos are shown below. Your response goes to our support team only, and the decision is shared with both sides.'
                  : 'Only you and our support team can see your messages. Everyone on this ticket sees the original report and the final decision.'}
              </Note>

              <View style={{ gap: 12 }}>
                {messages.map(m => {
                  const mine = m.sender_id === me && m.sender_kind !== 'staff';
                  const staff = m.sender_kind === 'staff';
                  return (
                    <View key={m.message_id} style={[styles.msgWrap, mine ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
                      <Text style={styles.msgWho}>{whoLabel(m)}   {fmtDateTime(m.created_at)}</Text>
                      <View style={[styles.bubble, mine ? styles.bubbleMine : staff ? styles.bubbleStaff : styles.bubbleOther]}>
                        {m.body ? <Text style={[styles.bubbleText, mine && { color: '#FFF' }]}>{m.body}</Text> : null}
                        {(m.attachments || []).length > 0 && (
                          <View style={styles.thumbs}>
                            {m.attachments.map(a => urls[a.path] ? (
                              <TouchableOpacity key={a.path} onPress={() => setViewer(urls[a.path])} activeOpacity={0.85}>
                                <Image source={{ uri: urls[a.path] }} style={styles.thumb} />
                              </TouchableOpacity>
                            ) : (
                              <View key={a.path} style={[styles.thumb, styles.thumbLoading]}>
                                <Ionicons name="image-outline" size={18} color={colors.textMuted} />
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    </View>
                  );
                })}
                {!closed && !(iAmCounterparty ? hasResponded : hasPrivate) && (
                  <Text style={styles.emptyThread}>
                    {iAmCounterparty
                      ? 'Review the report and photos above, then tap "Dispute this report" to explain your side.'
                      : 'Replies from our team will appear here. You can add more details or photos any time.'}
                  </Text>
                )}
              </View>
            </SectionCard>
          </Animated.View>
        </ScrollView>

        {/* composer */}
        {closed ? (
          <View style={[styles.closedBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {appeal.state === 'available' ? (
              <>
                <Text style={styles.closedText}>
                  Not happy with the decision? You can appeal once within {APPEAL_WINDOW_DAYS} days. The result of an appeal is final.
                </Text>
                <Animated.View style={{ width: '100%', marginTop: 10, transform: [{ scale: btnScale }] }}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setAppealOpen(true)}
                    onPressIn={pressIn} onPressOut={pressOut}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="repeat-outline" size={18} color="#FFF" />
                    <Text style={styles.primaryBtnText}>Appeal this decision</Text>
                  </TouchableOpacity>
                </Animated.View>
              </>
            ) : appeal.state === 'filed' && appeal.appealTicketId ? (
              <>
                <Text style={styles.closedText}>You already appealed this decision.</Text>
                <Animated.View style={{ width: '100%', marginTop: 10, transform: [{ scale: btnScale }] }}>
                  <TouchableOpacity
                    style={styles.primaryBtn} activeOpacity={0.9}
                    onPressIn={pressIn} onPressOut={pressOut}
                    onPress={() => navigation.navigate('TicketDetail', { ticketId: appeal.appealTicketId })}>
                    <Text style={styles.primaryBtnText}>View my appeal</Text>
                  </TouchableOpacity>
                </Animated.View>
              </>
            ) : appeal.state === 'expired' ? (
              <Text style={styles.closedText}>
                The {APPEAL_WINDOW_DAYS}-day appeal period has ended. Need more help? Chat with support from Help.
              </Text>
            ) : (
              <Text style={styles.closedText}>This ticket is closed. Need more help? Start a new report from Help.</Text>
            )}
          </View>
        ) : iAmCounterparty ? (
          <View style={[styles.respondBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {canRespond ? (
              <>
                <Text style={styles.respondNote}>You can respond once. Our team reviews both sides before deciding.</Text>
                <Animated.View style={{ width: '100%', transform: [{ scale: btnScale }] }}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setRespondOpen(true)}
                    onPressIn={pressIn} onPressOut={pressOut}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="shield-outline" size={18} color="#FFF" />
                    <Text style={styles.primaryBtnText}>Dispute this report</Text>
                  </TouchableOpacity>
                </Animated.View>
              </>
            ) : (
              <Text style={styles.respondedText}>
                Your response was sent. You can't message the sender; our team will review both sides and notify you of the decision.
              </Text>
            )}
          </View>
        ) : (
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            {needsMyReply && (
              <Text style={styles.composerNote}>Support is waiting for your reply.</Text>
            )}
            {pending.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
                {pending.map((uri, i) => (
                  <View key={uri + i} style={styles.pendBox}>
                    <Image source={{ uri }} style={styles.pendImg} />
                    <TouchableOpacity style={styles.pendX} onPress={() => setPending(p => p.filter((_, j) => j !== i))} hitSlop={8}>
                      <Ionicons name="close" size={12} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.inputRow}>
              <TouchableOpacity style={styles.attach} onPress={addPhotos} activeOpacity={0.8} hitSlop={6}>
                <Ionicons name="image-outline" size={22} color={ORANGE} />
              </TouchableOpacity>
              <TextInput
                style={styles.input} value={text} onChangeText={t => setText(t.slice(0, 1000))} multiline
                placeholder="Message support…"
                placeholderTextColor={colors.textMuted}
              />
              <TouchableOpacity
                style={[styles.send, (!text.trim() && pending.length === 0) && styles.sendOff]}
                disabled={sending || (!text.trim() && pending.length === 0)} onPress={send} activeOpacity={0.85}>
                {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Ionicons name="arrow-up" size={20} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={respondOpen} transparent animationType="slide" onRequestClose={() => !sending && setRespondOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.sheetBackdrop} onPress={() => !sending && setRespondOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Your side of what happened</Text>
            <Text style={styles.sheetSub}>
              This goes to our support team only. The sender will not see it, and you can send it once. Add photos if they help.
            </Text>
            <TextInput
              style={styles.sheetInput} value={text} multiline textAlignVertical="top"
              onChangeText={t => setText(t.slice(0, 1000))}
              placeholder="Explain what happened from your side…"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.sheetCount}>
              {text.trim().length < 10 ? 'At least 10 characters   ' : ''}{text.length}/1000
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {pending.map((uri, i) => (
                <View key={uri + i} style={styles.pendBox}>
                  <Image source={{ uri }} style={styles.pendImg} />
                  <TouchableOpacity style={styles.pendX} onPress={() => setPending(p => p.filter((_, j) => j !== i))} hitSlop={8}>
                    <Ionicons name="close" size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {pending.length < MAX_PHOTOS && (
                <TouchableOpacity style={styles.sheetAdd} onPress={addPhotos} activeOpacity={0.8}>
                  <Ionicons name="image-outline" size={20} color={ORANGE} />
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.primaryBtn, (text.trim().length < 10 || sending) && styles.primaryBtnOff]}
              disabled={text.trim().length < 10 || sending} onPress={send} activeOpacity={0.9}>
              {sending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Submit my response</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={appealOpen} transparent animationType="slide" onRequestClose={() => !appealing && setAppealOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.sheetBackdrop} onPress={() => !appealing && setAppealOpen(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Appeal this decision</Text>
            <Text style={styles.sheetSub}>
              Tell us what you think was missed. Add new details or photos if you have them. You can appeal once, and the result is final.
            </Text>
            <TextInput
              style={styles.sheetInput} value={appealText} multiline textAlignVertical="top"
              onChangeText={t => setAppealText(t.slice(0, 1000))}
              placeholder="Why should this decision be reviewed again?"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.sheetCount}>
              {appealText.trim().length < APPEAL_MIN_CHARS ? `At least ${APPEAL_MIN_CHARS} characters   ` : ''}{appealText.length}/1000
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {pending.map((uri, i) => (
                <View key={uri + i} style={styles.pendBox}>
                  <Image source={{ uri }} style={styles.pendImg} />
                  <TouchableOpacity style={styles.pendX} onPress={() => setPending(p => p.filter((_, j) => j !== i))} hitSlop={8}>
                    <Ionicons name="close" size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              {pending.length < MAX_PHOTOS && (
                <TouchableOpacity style={styles.sheetAdd} onPress={addPhotos} activeOpacity={0.8}>
                  <Ionicons name="image-outline" size={20} color={ORANGE} />
                </TouchableOpacity>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.primaryBtn, (appealText.trim().length < APPEAL_MIN_CHARS || appealing) && styles.primaryBtnOff]}
              disabled={appealText.trim().length < APPEAL_MIN_CHARS || appealing} onPress={sendAppeal} activeOpacity={0.9}>
              {appealing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>Submit appeal</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.viewerBg} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={styles.viewerImg} resizeMode="contain" /> : null}
          <View style={[styles.viewerClose, { top: insets.top + 12 }]}>
            <Ionicons name="close" size={22} color="#FFF" />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function Fact({ styles, label, value }: { styles: any; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, paddingBottom: 24, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTitle: { fontSize: 16, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, textAlign: 'center' },
  centerSub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19, fontFamily: 'Poppins_500Medium' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  sectionNumberText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  sectionTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },

  sumTitle: { fontSize: 20, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.5 },
  sumHint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, fontFamily: 'Poppins_500Medium', marginTop: 8 },
  facts: { marginTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  factLabel: { fontSize: 12.5, color: c.textSecondary, fontFamily: 'Poppins_600SemiBold' },
  factValue: { fontSize: 13, color: c.textPrimary, fontFamily: 'Poppins_700Bold', flexShrink: 1, textAlign: 'right' },

  resolution: { backgroundColor: c.successBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.success, gap: 8 },
  resHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resTitle: { fontSize: 15, fontFamily: 'Poppins_800ExtraBold', color: c.success },
  resBody: { fontSize: 14, color: c.textPrimary, lineHeight: 21, fontFamily: 'Poppins_500Medium' },

  emptyThread: { fontSize: 13, lineHeight: 19, color: c.textSecondary, textAlign: 'center', paddingVertical: 8, fontFamily: 'Poppins_500Medium' },
  msgWrap: { gap: 4 },
  msgWho: { fontSize: 11.5, color: c.textMuted, fontFamily: 'Poppins_600SemiBold' },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  bubbleMine: { backgroundColor: ORANGE, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: isDark ? '#27272A' : '#F3F4F6', borderBottomLeftRadius: 6 },
  bubbleStaff: { backgroundColor: isDark ? '#0F2744' : '#EFF6FF', borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: c.textPrimary, fontFamily: 'Poppins_500Medium' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  thumbLoading: { backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },

  composer: { borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background, paddingHorizontal: 14, paddingTop: 10 },
  composerNote: { fontSize: 12, color: ORANGE, fontFamily: 'Poppins_700Bold', marginBottom: 8, paddingHorizontal: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attach: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, maxHeight: 120, minHeight: 42, backgroundColor: c.card, borderRadius: 21, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, color: c.textPrimary, fontFamily: 'Poppins_500Medium',
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74' },
  pendBox: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  pendImg: { width: '100%', height: '100%' },
  pendX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },

  primaryBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: c.accent, paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  primaryBtnOff: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },

  respondBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background, gap: 10 },
  respondNote: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', fontFamily: 'Poppins_500Medium' },
  respondedText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18, fontFamily: 'Poppins_500Medium', paddingBottom: 4 },

  closedBar: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background },
  closedText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18, fontFamily: 'Poppins_500Medium' },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(17,24,39,0.5)' },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.4 },
  sheetSub: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 6, marginBottom: 14, fontFamily: 'Poppins_500Medium' },
  sheetInput: {
    minHeight: 120, maxHeight: 200, backgroundColor: c.background, borderRadius: 14, borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    padding: 14, fontSize: 14, color: c.textPrimary, fontFamily: 'Poppins_500Medium',
  },
  sheetCount: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontFamily: 'Poppins_600SemiBold' },
  sheetAdd: {
    width: 56, height: 56, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ORANGE,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft,
  },

  viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '82%' },
  viewerClose: { position: 'absolute', right: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});