// src/modules/Help/HelpCenterScreen.tsx
// Support surface for both roles: chat with support and report a new problem.
//
// Ticket browsing is NOT here anymore:
//   - Senders still see "Your tickets" on the sender Account screen.
//   - Providers see "Reports against you" + "Your tickets" on AccountHealthScreen.
//
// The "needs your attention" banner is retained so a provider who lands here
// still sees a nudge to switch to Account Health for action items.
//
// Params: { role?: Role, mode?: 'provider' }
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Animated, Easing, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  Ticket, fetchMyTickets, getMyUserId, isClosed, statusView, subscribeTickets,
} from '../../services/ticketService';
import { Role } from '../../services/ticketCatalog';
import {
  ScreenHeader, SectionCard, ORANGE, useStagedEntrance, fadeUp,
} from './helpUi';
import LiveChatModal, { countUnreadAgentReplies } from './LiveChatModal';

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

  const [me, setMe] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  const [greetAnim, actionsAnim] = useStagedEntrance(2);

  const load = useCallback(async () => {
    try {
      const [id, mine] = await Promise.all([getMyUserId(), fetchMyTickets()]);
      setMe(id);
      setTickets(mine);
      countUnreadAgentReplies().then(setUnreadChat).catch(() => {});
    } catch {
      // Banner degrades silently; the actions below still work.
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
  const actionList = useMemo(
    () => tickets
      .filter(t => !isClosed(t.status) && t.reporter_id === me && isAction(t)),
    [tickets, me, isAction],
  );

  const openTicket = (t: Ticket) =>
    navigation.navigate('TicketDetail', { ticketId: t.ticket_id });
  const startReport = () => navigation.navigate('ReportIssue', { role });
  const closeChat = () => {
    setChatOpen(false);
    countUnreadAgentReplies().then(setUnreadChat).catch(() => {});
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Help" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={ORANGE}
            onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <Animated.View style={fadeUp(greetAnim, 20)}>
          <Text style={styles.hello}>How can we help?</Text>
          <Text style={styles.helloSub}>Chat with our team, or report a new problem. Every case is tracked end-to-end.</Text>
        </Animated.View>

        {actionList.length > 0 && (
          <Animated.View style={fadeUp(greetAnim, 20)}>
            <TouchableOpacity
              style={styles.attention}
              activeOpacity={0.88}
              onPress={() =>
                role === 'provider'
                  ? navigation.navigate('AccountHealth')
                  : openTicket(actionList[0])
              }
              accessibilityRole="button"
            >
              <View style={styles.attentionIcon}><Ionicons name="notifications" size={20} color="#FFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.attentionTitle}>
                  {actionList.length === 1
                    ? '1 ticket needs your reply'
                    : `${actionList.length} tickets need your reply`}
                </Text>
                <Text style={styles.attentionSub} numberOfLines={1}>
                  {role === 'provider'
                    ? 'Open Account Health to respond'
                    : actionList.length === 1
                      ? actionList[0].sub_issue
                      : 'Tap to open your most recent case'}
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

  link: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  linkText: { flex: 1, fontSize: 14, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
});