// src/modules/Help/HelpCenterScreen.tsx
// One entry point for help. Registered under the old route names 'Support' and
// 'DisputeCenter' too, so every existing navigate('Support') keeps working.
//
// Params: { role?: Role, mode?: 'provider', focus?: 'againstMe' | 'tickets' }
//
// A sender's report AGAINST a provider is NOT the provider's own ticket. It
// appears in "Reports against you" (and in the notification center as a
// notification), and opens TicketDetailScreen read-only with a one-time
// response. "Your tickets" only contains tickets you opened yourself.
//
// Collapsed "Reports against you" rows are plain summary rows: title + tracking
// + a subtle "needs your reply" cue. The RegisterProvider-style timeline and
// layout only appear once the row is tapped, inside TicketDetailScreen.
//
// `focus` (optional) scrolls the screen to the "Reports against you" or
// "Your tickets" section on mount, used by the Account screen's
// "Disputes & reports" row.
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), numbered upload-style
// section headers, tinted notes, staged fade-up entrance.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Animated, Easing, RefreshControl, LayoutChangeEvent,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  Ticket, buildTimeline, fetchMyTickets, fetchReportsAgainstMe, getMyUserId,
  isClosed, statusView, subscribeTickets, timeAgo, trackingIdFor,
} from '../../services/ticketService';
import { iconForCategory, Role } from '../../services/ticketCatalog';
import {
  ScreenHeader, StatusPill, TicketStepper, SectionCard, ORANGE, useStagedEntrance, fadeUp,
} from './helpUi';
import LiveChatModal, { countUnreadAgentReplies } from './LiveChatModal';

type Tab = 'active' | 'closed';
type Focus = 'againstMe' | 'tickets' | undefined;

const COPY: Record<Role, { chat: string; report: string }> = {
  sender: {
    chat: 'Quick questions about a delivery, a payment or your account.',
    report: 'A package was damaged, late or lost, a charge looks wrong, or a provider behaved badly.',
  },
  provider: {
    chat: 'Quick questions about earnings, cash-outs, routes or your account.',
    report: 'A problem with a sender or a drop-off, or an issue with your earnings.',
  },
};

export default function HelpCenterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const role: Role = route.params?.role ?? (route.params?.mode === 'provider' ? 'provider' : 'sender');
  const focus: Focus = route.params?.focus;

  const [me, setMe] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [reportsAgainstMe, setReportsAgainstMe] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  const [greetAnim, actionsAnim, againstAnim, ticketsAnim] = useStagedEntrance(4);
  const pulse = useRef(new Animated.Value(0.45)).current;

  // Refs + layout positions for programmatic scroll on `focus`.
  const scrollRef = useRef<ScrollView>(null);
  const againstY = useRef<number | null>(null);
  const ticketsY = useRef<number | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.45, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [id, mine, against] = await Promise.all([
        getMyUserId(),
        fetchMyTickets(),
        fetchReportsAgainstMe(),
      ]);
      setMe(id);
      setTickets(mine);
      setReportsAgainstMe(against);
      countUnreadAgentReplies().then(setUnreadChat).catch(() => {});
    } catch (e: any) {
      setError(e?.message || 'Could not load your tickets.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => subscribeTickets(load), [load]);

  const views = useMemo(
    () => new Map(tickets.map(t => [t.ticket_id, statusView(t, me)])),
    [tickets, me],
  );
  const isAction = useCallback(
    (t: Ticket) => !isClosed(t.status) && views.get(t.ticket_id)?.tone === 'action',
    [views],
  );

  const active = useMemo(
    () => tickets
      .filter(t => !isClosed(t.status) && t.reporter_id === me)
      .sort((a, b) => Number(isAction(b)) - Number(isAction(a))),
    [tickets, me, isAction],
  );
  const closed = useMemo(
    () => tickets.filter(t => isClosed(t.status) && t.reporter_id === me),
    [tickets, me],
  );
  const actionList = active.filter(isAction);
  const shown = tab === 'active' ? active : closed;

  const againstOpen = useMemo(
    () => reportsAgainstMe.filter(t => !isClosed(t.status)),
    [reportsAgainstMe],
  );

  // Scroll to the focused section once its layout is known and data has loaded.
  useEffect(() => {
    if (scrolled || !focus || loading) return;
    const target = focus === 'againstMe' ? againstY.current : ticketsY.current;
    if (target == null) return;
    // A small offset so the section header isn't flush against the top.
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(target - 12, 0), animated: true });
      setScrolled(true);
    }, 80);
    return () => clearTimeout(id);
  }, [focus, loading, scrolled]);

  const onAgainstLayout = (e: LayoutChangeEvent) => {
    againstY.current = e.nativeEvent.layout.y;
  };
  const onTicketsLayout = (e: LayoutChangeEvent) => {
    ticketsY.current = e.nativeEvent.layout.y;
  };

  const openTicket = (t: Ticket) =>
    navigation.navigate('TicketDetail', { ticketId: t.ticket_id });
  const openAgainstMe = (t: Ticket) =>
    navigation.navigate('TicketDetail', { ticketId: t.ticket_id, source: 'reportAgainstMe' });
  const startReport = () => navigation.navigate('ReportIssue', { role });
  const closeChat = () => {
    setChatOpen(false);
    countUnreadAgentReplies().then(setUnreadChat).catch(() => {});
  };

  const renderActiveRow = (t: Ticket) => {
    const action = isAction(t);
    return (
      <TouchableOpacity
        key={t.ticket_id}
        style={[styles.rowCompact, action && styles.rowCompactAction]}
        onPress={() => openTicket(t)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t.sub_issue}
      >
        {action && <View style={styles.actionBar} />}
        <View style={styles.rowIconCompact}>
          <Ionicons name={iconForCategory(t.category) as any} size={16} color={ORANGE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitleCompact} numberOfLines={1}>{t.sub_issue}</Text>
          <Text style={styles.rowMetaCompact} numberOfLines={1}>
            {t.ticket_ref}{t.request_id ? `   ${trackingIdFor(t.request_id)}` : ''}
          </Text>
        </View>
        <View style={styles.rowRightCompact}>
          <Text style={styles.rowTimeCompact}>{timeAgo(t.last_activity_at)}</Text>
          <Ionicons name="chevron-forward" size={14} color={action ? ORANGE : colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderClosedRow = (t: Ticket) => {
    const v = views.get(t.ticket_id)!;
    return (
      <TouchableOpacity
        key={t.ticket_id}
        style={styles.row}
        onPress={() => openTicket(t)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${t.sub_issue}. ${v.label}`}
      >
        <View style={styles.rowTop}>
          <View style={styles.rowIcon}>
            <Ionicons name={iconForCategory(t.category) as any} size={20} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{t.sub_issue}</Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {t.ticket_ref}{t.request_id ? `   ${trackingIdFor(t.request_id)}` : ''}
            </Text>
          </View>
          <Text style={styles.rowTime}>{timeAgo(t.last_activity_at)}</Text>
        </View>

        <View style={styles.rowStepper}>
          <TicketStepper steps={buildTimeline(t, [])} compact />
        </View>

        <View style={styles.rowBottom}>
          <StatusPill view={v} />
          <View style={styles.rowGo}>
            <Text style={styles.rowGoText}>View</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Report against me: collapsed summary row only. Shows the issue + tracking
  // + a subtle "needs your reply" cue. The full RegisterProvider-style
  // timeline and layout live in TicketDetailScreen once the row is tapped.
  const renderAgainstRow = (t: Ticket) => {
    const needsReply = t.status === 'Awaiting Other Party' || t.status === 'Open';
    return (
      <TouchableOpacity
        key={t.ticket_id}
        style={[styles.rowCompact, needsReply && styles.rowCompactAction]}
        onPress={() => openAgainstMe(t)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Report against you: ${t.sub_issue}`}
      >
        {needsReply && <View style={styles.actionBar} />}
        <View style={styles.rowIconCompact}>
          <Ionicons name="shield-outline" size={16} color={ORANGE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitleCompact} numberOfLines={1}>{t.sub_issue}</Text>
          <Text style={styles.rowMetaCompact} numberOfLines={1}>
            {t.request_id ? trackingIdFor(t.request_id) : t.ticket_ref} · from sender
          </Text>
        </View>
        <View style={styles.rowRightCompact}>
          <Text style={styles.rowTimeCompact}>{timeAgo(t.last_activity_at)}</Text>
          <Ionicons name="chevron-forward" size={14} color={needsReply ? ORANGE : colors.textMuted} />
        </View>
      </TouchableOpacity>
    );
  };

  const renderRow = (t: Ticket) => (tab === 'active' ? renderActiveRow(t) : renderClosedRow(t));

  const renderSkeleton = () => (
    <Animated.View style={{ opacity: pulse, gap: 10 }}>
      {[0, 1, 2].map(i => (
        <View key={i} style={styles.rowCompact}>
          <View style={[styles.rowIconCompact, { backgroundColor: colors.divider }]} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={[styles.skel, { width: '60%', height: 12 }]} />
            <View style={[styles.skel, { width: '36%', height: 10 }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );

  const renderEmpty = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={tab === 'active' ? 'checkmark-circle-outline' : 'archive-outline'} size={30} color={ORANGE} />
      </View>
      <Text style={styles.emptyTitle}>{tab === 'active' ? 'All clear' : 'Nothing resolved yet'}</Text>
      <Text style={styles.emptySub}>
        {tab === 'active'
          ? "You have no open tickets of your own. If something goes wrong, report it and you'll follow every step here."
          : 'Cases that have been decided will be kept here for your records.'}
      </Text>
      {tab === 'active' && (
        <TouchableOpacity style={styles.emptyBtn} onPress={startReport} activeOpacity={0.85}>
          <Text style={styles.emptyBtnText}>Report a problem</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const ticketsSubtitle =
    tab === 'active'
      ? actionList.length > 0
        ? actionList.length === 1
          ? '1 ticket needs your reply'
          : `${actionList.length} tickets need your reply`
        : 'Tap a ticket to see its status'
      : 'Tap a ticket to review the decision';

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Help" onBack={() => navigation.goBack()} />

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={ORANGE}
            onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Animated.View style={[fadeUp(greetAnim, 20)]}>
          <Text style={styles.hello}>How can we help?</Text>
          <Text style={styles.helloSub}>Pick what fits best. Everything you send us is tracked in one place.</Text>
        </Animated.View>

        {actionList.length > 0 && (
          <Animated.View style={[fadeUp(greetAnim, 20)]}>
            <TouchableOpacity
              style={styles.attention}
              activeOpacity={0.88}
              onPress={() => (actionList.length === 1 ? openTicket(actionList[0]) : setTab('active'))}
              accessibilityRole="button"
            >
              <View style={styles.attentionIcon}><Ionicons name="notifications" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.attentionTitle}>
                  {actionList.length === 1 ? '1 ticket needs your reply' : `${actionList.length} tickets need your reply`}
                </Text>
                <Text style={styles.attentionSub} numberOfLines={1}>
                  {actionList.length === 1 ? actionList[0].sub_issue : 'Tap to see them in your tickets below'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#FDBA74' : '#C2410C'} />
            </TouchableOpacity>
          </Animated.View>
        )}

        <Animated.View style={[fadeUp(actionsAnim, 20), { gap: 12 }]}>
          <SectionCard style={styles.actionCard}>
            <TouchableOpacity
              style={styles.actionTouch}
              onPress={() => setChatOpen(true)}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Chat with support"
            >
              <View style={styles.actionIcon}>
                <Ionicons name="chatbubbles" size={24} color={ORANGE} />
                {unreadChat > 0 && <View style={styles.dot} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.actionTitleRow}>
                  <Text style={styles.actionTitle}>Chat with support</Text>
                  {unreadChat > 0 && (
                    <View style={styles.newPill}><Text style={styles.newPillText}>New reply</Text></View>
                  )}
                </View>
                <Text style={styles.actionSub}>{COPY[role].chat}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </SectionCard>

          <SectionCard style={styles.actionCard}>
            <TouchableOpacity
              style={styles.actionTouch}
              onPress={startReport}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Report a problem"
            >
              <View style={styles.actionIcon}>
                <Ionicons name="flag" size={22} color={ORANGE} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.actionTitle}>Report a problem</Text>
                <Text style={styles.actionSub}>{COPY[role].report}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </SectionCard>
        </Animated.View>

        {role === 'provider' && againstOpen.length > 0 && (
          <Animated.View
            onLayout={onAgainstLayout}
            style={fadeUp(againstAnim, 20)}
          >
            <SectionCard>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionNumberBadge, { backgroundColor: colors.warning ?? ORANGE }]}>
                  <Ionicons name="shield-half" size={13} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Reports against you</Text>
                  <Text style={styles.sectionSubtitle}>
                    {againstOpen.length === 1
                      ? '1 sender report is waiting for your response'
                      : `${againstOpen.length} sender reports are waiting for your response`}
                  </Text>
                </View>
              </View>
              <View style={{ gap: 10 }}>
                {againstOpen.map(renderAgainstRow)}
              </View>
            </SectionCard>
          </Animated.View>
        )}

        <Animated.View
          onLayout={onTicketsLayout}
          style={[fadeUp(ticketsAnim, 20)]}
        >
          <SectionCard>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionNumberBadge}>
                <Text style={styles.sectionNumberText}>1</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Your tickets</Text>
                <Text style={styles.sectionSubtitle}>{ticketsSubtitle}</Text>
              </View>
            </View>

            <View style={styles.tabs}>
              {(['active', 'closed'] as Tab[]).map(k => {
                const on = tab === k;
                const n = k === 'active' ? active.length : closed.length;
                return (
                  <TouchableOpacity key={k} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(k)}
                    activeOpacity={0.85} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                    <Text style={[styles.tabText, on && styles.tabTextOn]}>{k === 'active' ? 'Active' : 'Resolved'}</Text>
                    {n > 0 && (
                      <View style={[styles.count, on && styles.countOn]}>
                        <Text style={[styles.countText, on && { color: '#FFF' }]}>{n}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={{ gap: 10, marginTop: 12 }}>
              {loading ? renderSkeleton()
                : error ? (
                  <View style={styles.empty}>
                    <View style={styles.emptyIcon}><Ionicons name="cloud-offline-outline" size={28} color={ORANGE} /></View>
                    <Text style={styles.emptyTitle}>Couldn't load your tickets</Text>
                    <Text style={styles.emptySub}>{error}</Text>
                    <TouchableOpacity style={styles.emptyBtn} onPress={() => { setLoading(true); load(); }} activeOpacity={0.85}>
                      <Text style={styles.emptyBtnText}>Try again</Text>
                    </TouchableOpacity>
                  </View>
                )
                : shown.length > 0 ? <>{shown.map(renderRow)}</>
                : renderEmpty()}
            </View>
          </SectionCard>
        </Animated.View>

        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('LegalPolicies')} activeOpacity={0.8}>
          <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.linkText}>Terms and policies</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>

      <LiveChatModal
        visible={chatOpen}
        role={role}
        onClose={closeChat}
        onReport={() => { setChatOpen(false); startReport(); }}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 56, gap: 20 },

  hello: { fontSize: 26, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.7 },
  helloSub: { fontSize: 14, lineHeight: 20, color: c.textSecondary, marginTop: 6, fontFamily: 'Poppins_500Medium' },

  attention: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: isDark ? '#3A2411' : '#FFF4E8', borderWidth: 1, borderColor: ORANGE,
  },
  attentionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  attentionTitle: { fontSize: 14.5, fontFamily: 'Poppins_800ExtraBold', color: isDark ? '#FDBA74' : '#9A3412', letterSpacing: -0.2 },
  attentionSub: { fontSize: 12.5, color: isDark ? '#FDBA74' : '#C2410C', marginTop: 2, fontFamily: 'Poppins_600SemiBold' },

  actionCard: { padding: 0 },
  actionTouch: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  actionIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  actionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  actionSub: { fontSize: 12.5, lineHeight: 18, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  dot: { position: 'absolute', top: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: '#EF4444', borderWidth: 2, borderColor: c.card },
  newPill: { backgroundColor: isDark ? '#3A2411' : '#FEE2E2', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  newPillText: { fontSize: 10.5, fontFamily: 'Poppins_800ExtraBold', color: isDark ? '#FDBA74' : '#B91C1C' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  sectionNumberText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  sectionTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },

  tabs: { flexDirection: 'row', backgroundColor: isDark ? '#1F1F23' : '#F3F4F6', borderRadius: 14, padding: 4 },
  tab: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 11 },
  tabOn: { backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  tabText: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  tabTextOn: { color: c.textPrimary, fontFamily: 'Poppins_800ExtraBold' },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.divider },
  countOn: { backgroundColor: ORANGE },
  countText: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },

  rowCompact: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.background, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  rowCompactAction: { borderColor: ORANGE },
  actionBar: { width: 3, alignSelf: 'stretch', backgroundColor: ORANGE, borderRadius: 2, marginRight: 2 },
  rowIconCompact: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitleCompact: { fontSize: 13.5, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.1 },
  rowMetaCompact: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },
  rowRightCompact: { alignItems: 'flex-end', gap: 4 },
  rowTimeCompact: { fontSize: 10.5, fontFamily: 'Poppins_600SemiBold', color: c.textMuted },

  row: {
    backgroundColor: c.background, borderRadius: 14, padding: 14, borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  rowMeta: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  rowTime: { fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_600SemiBold' },
  rowStepper: { marginTop: 14, marginBottom: 2 },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  rowGo: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  rowGoText: { fontSize: 12.5, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },

  skel: { backgroundColor: c.divider, borderRadius: 7 },

  empty: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 8 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.3 },
  emptySub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19, fontFamily: 'Poppins_500Medium' },
  emptyBtn: { marginTop: 10, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14, backgroundColor: ORANGE },
  emptyBtnText: { color: '#FFF', fontFamily: 'Poppins_800ExtraBold', fontSize: 13.5 },

  link: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  linkText: { flex: 1, fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
});