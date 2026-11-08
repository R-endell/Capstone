// src/modules/Help/TicketDetailScreen.tsx
// Params: { ticketId: number }  (or legacy { disputeId: number }, resolved to its ticket)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, TextInput, Image, Modal,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Pressable,
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
import { ScreenHeader, StatusPill, ORANGE } from './helpUi';
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
          <Ionicons name="alert-circle-outline" size={34} color={colors.textMuted} />
          <Text style={styles.centerTitle}>We couldn't find this ticket</Text>
          <Text style={styles.centerSub}>It may have been removed, or it belongs to another account.</Text>
        </View>
      </View>
    );
  }

  const timeline = buildTimeline(ticket, events);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title={ticket.ticket_ref || 'Ticket'} subtitle={ticket.category} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* summary */}
          <View style={styles.summary}>
            <Text style={styles.sumTitle}>{ticket.sub_issue}</Text>
            <StatusPill view={view} />
            <Text style={styles.sumHint}>{view.hint}</Text>
            <View style={styles.facts}>
              {ticket.request_id ? <Fact styles={styles} label="Delivery" value={trackingIdFor(ticket.request_id)} /> : null}
              <Fact styles={styles} label="Reported by"
                value={iAmCounterparty ? displayName(ticket.reporter) : 'You'} />
              {ticket.requested_resolution ? <Fact styles={styles} label="Requested outcome" value={ticket.requested_resolution} /> : null}
              <Fact styles={styles} label="Opened" value={fmtDateTime(ticket.created_at)} />
            </View>
          </View>

          {/* timeline */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Progress</Text>
            {timeline.map((s, i) => (
              <View key={s.key} style={styles.tlRow}>
                <View style={styles.tlRail}>
                  <View style={[styles.tlDot, s.done && styles.tlDotDone, s.current && styles.tlDotNow]}>
                    {s.done && <Ionicons name="checkmark" size={12} color="#FFF" />}
                  </View>
                  {i < timeline.length - 1 && <View style={[styles.tlLine, s.done && { backgroundColor: ORANGE }]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: i < timeline.length - 1 ? 18 : 0 }}>
                  <Text style={[styles.tlTitle, !s.done && !s.current && { color: colors.textMuted }]}>{s.title}</Text>
                  <Text style={styles.tlSub}>{s.sub}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* resolution */}
          {closed && ticket.resolution ? (
            <View style={styles.resolution}>
              <View style={styles.resHead}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.success} />
                <Text style={styles.resTitle}>{ticket.status === 'Resolved' ? 'Decision' : 'Closed'}</Text>
              </View>
              <Text style={styles.resBody}>{ticket.resolution}</Text>
            </View>
          ) : null}

          {/* conversation */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Messages</Text>
            <View style={styles.privacy}>
              <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.privacyText}>
                {iAmCounterparty
                  ? 'The report and its photos are shown below. Your response goes to our support team only, and the decision is shared with both sides.'
                  : 'Only you and our support team can see your messages. Everyone on this ticket sees the original report and the final decision.'}
              </Text>
            </View>
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
          </View>
        </ScrollView>

        {/* composer */}
        {closed ? (
          <View style={[styles.closedBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            {appeal.state === 'available' ? (
              <>
                <Text style={styles.closedText}>
                  Not happy with the decision? You can appeal once within {APPEAL_WINDOW_DAYS} days. The result of an appeal is final.
                </Text>
                <TouchableOpacity style={[styles.respondBtn, { marginTop: 10 }]} onPress={() => setAppealOpen(true)} activeOpacity={0.9}>
                  <Ionicons name="repeat-outline" size={18} color="#FFF" />
                  <Text style={styles.respondBtnText}>Appeal this decision</Text>
                </TouchableOpacity>
              </>
            ) : appeal.state === 'filed' && appeal.appealTicketId ? (
              <>
                <Text style={styles.closedText}>You already appealed this decision.</Text>
                <TouchableOpacity
                  style={[styles.respondBtn, { marginTop: 10 }]} activeOpacity={0.9}
                  onPress={() => navigation.navigate('TicketDetail', { ticketId: appeal.appealTicketId })}>
                  <Text style={styles.respondBtnText}>View my appeal</Text>
                </TouchableOpacity>
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
                <TouchableOpacity style={styles.respondBtn} onPress={() => setRespondOpen(true)} activeOpacity={0.9}>
                  <Ionicons name="shield-outline" size={18} color="#FFF" />
                  <Text style={styles.respondBtnText}>Dispute this report</Text>
                </TouchableOpacity>
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
              style={[styles.respondBtn, (text.trim().length < 10 || sending) && styles.respondBtnOff]}
              disabled={text.trim().length < 10 || sending} onPress={send} activeOpacity={0.9}>
              {sending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.respondBtnText}>Submit my response</Text>}
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
              style={[styles.respondBtn, (appealText.trim().length < APPEAL_MIN_CHARS || appealing) && styles.respondBtnOff]}
              disabled={appealText.trim().length < APPEAL_MIN_CHARS || appealing} onPress={sendAppeal} activeOpacity={0.9}>
              {appealing ? <ActivityIndicator color="#FFF" /> : <Text style={styles.respondBtnText}>Submit appeal</Text>}
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  centerTitle: { fontSize: 16, fontWeight: '800', color: c.textPrimary },
  centerSub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },

  summary: { backgroundColor: c.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: c.divider, gap: 10 },
  sumTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.5 },
  sumHint: { fontSize: 13, color: c.textSecondary, lineHeight: 19, fontWeight: '500' },
  facts: { marginTop: 4, gap: 10, borderTopWidth: 1, borderTopColor: c.divider, paddingTop: 12 },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  factLabel: { fontSize: 12.5, color: c.textSecondary, fontWeight: '600' },
  factValue: { fontSize: 13, color: c.textPrimary, fontWeight: '700', flexShrink: 1, textAlign: 'right' },

  block: { backgroundColor: c.card, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: c.divider },
  blockTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginBottom: 14, letterSpacing: -0.2 },

  tlRow: { flexDirection: 'row', gap: 14 },
  tlRail: { alignItems: 'center', width: 22 },
  tlDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  tlDotDone: { backgroundColor: ORANGE, borderColor: ORANGE },
  tlDotNow: { borderColor: ORANGE, borderWidth: 3 },
  tlLine: { flex: 1, width: 2, backgroundColor: c.divider, marginVertical: 2 },
  tlTitle: { fontSize: 14, fontWeight: '800', color: c.textPrimary },
  tlSub: { fontSize: 12.5, color: c.textSecondary, marginTop: 2, fontWeight: '500' },

  resolution: { backgroundColor: c.successBg, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: c.success, gap: 8 },
  resHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resTitle: { fontSize: 15, fontWeight: '800', color: c.success },
  resBody: { fontSize: 14, color: c.textPrimary, lineHeight: 21, fontWeight: '500' },

  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: -6, marginBottom: 14 },
  privacyText: { flex: 1, fontSize: 12, lineHeight: 17, color: c.textSecondary, fontWeight: '500' },
  emptyThread: { fontSize: 13, lineHeight: 19, color: c.textSecondary, textAlign: 'center', paddingVertical: 8 },

  msgWrap: { gap: 4 },
  msgWho: { fontSize: 11.5, color: c.textMuted, fontWeight: '600' },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  bubbleMine: { backgroundColor: ORANGE, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: isDark ? '#27272A' : '#F3F4F6', borderBottomLeftRadius: 6 },
  bubbleStaff: { backgroundColor: isDark ? '#0F2744' : '#EFF6FF', borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20, color: c.textPrimary, fontWeight: '500' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  thumbLoading: { backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center' },

  composer: { borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background, paddingHorizontal: 14, paddingTop: 10 },
  composerNote: { fontSize: 12, color: ORANGE, fontWeight: '700', marginBottom: 8, paddingHorizontal: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attach: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1, maxHeight: 120, minHeight: 42, backgroundColor: c.card, borderRadius: 21, borderWidth: 1.5, borderColor: c.border,
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 12 : 8, paddingBottom: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 14, color: c.textPrimary,
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74' },
  pendBox: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden' },
  pendImg: { width: '100%', height: '100%' },
  pendX: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },

  respondBar: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background, gap: 10 },
  respondNote: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', fontWeight: '500' },
  respondBtn: {
    flexDirection: 'row', gap: 8, backgroundColor: ORANGE, paddingVertical: 15, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12, elevation: 6,
  },
  respondBtnOff: { backgroundColor: isDark ? '#5A3418' : '#FDBA74', shadowOpacity: 0, elevation: 0 },
  respondBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  respondedText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18, fontWeight: '500', paddingBottom: 4 },

  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,24,39,0.5)' },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, marginBottom: 14 },
  sheetTitle: { fontSize: 19, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4 },
  sheetSub: { fontSize: 13, color: c.textSecondary, lineHeight: 19, marginTop: 6, marginBottom: 14, fontWeight: '500' },
  sheetInput: {
    minHeight: 120, maxHeight: 200, backgroundColor: c.background, borderRadius: 16, borderWidth: 1.5, borderColor: c.border,
    padding: 14, fontSize: 14, color: c.textPrimary, fontWeight: '500',
  },
  sheetCount: { fontSize: 11, color: c.textMuted, textAlign: 'right', marginTop: 6, fontWeight: '600' },
  sheetAdd: {
    width: 56, height: 56, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: ORANGE,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft,
  },

  closedBar: { paddingHorizontal: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.divider, backgroundColor: c.background },
  closedText: { fontSize: 12.5, color: c.textSecondary, textAlign: 'center', lineHeight: 18, fontWeight: '500' },

  viewerBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '82%' },
  viewerClose: { position: 'absolute', right: 16, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});