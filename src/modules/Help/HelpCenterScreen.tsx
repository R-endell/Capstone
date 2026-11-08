// src/modules/Help/HelpCenterScreen.tsx
// One entry point for help. Registered under the old route names 'Support' and
// 'DisputeCenter' too, so every existing navigate('Support') keeps working.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import {
  Ticket, fetchMyTickets, getMyUserId, isClosed, statusView, subscribeTickets, timeAgo, trackingIdFor,
} from '../../services/ticketService';
import { iconForCategory, Role } from '../../services/ticketCatalog';
import { ScreenHeader, StatusPill, ORANGE } from './helpUi';
import LiveChatModal, { countUnreadAgentReplies } from './LiveChatModal';

type Tab = 'active' | 'closed';

export default function HelpCenterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // Old callers pass { role } (Support) or { mode: 'provider' } (DisputeCenter).
  const role: Role = route.params?.role ?? (route.params?.mode === 'provider' ? 'provider' : 'sender');

  const [me, setMe] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [id, list] = await Promise.all([getMyUserId(), fetchMyTickets()]);
      setMe(id);
      setTickets(list);
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
  const needsAction = tickets.filter(t => !isClosed(t.status) && views.get(t.ticket_id)?.tone === 'action');
  const active = tickets.filter(t => !isClosed(t.status) && !needsAction.includes(t));
  const closed = tickets.filter(t => isClosed(t.status));

  const openTicket = (t: Ticket) => navigation.navigate('TicketDetail', { ticketId: t.ticket_id });
  const startReport = () => navigation.navigate('ReportIssue', { role });

  const renderRow = (t: Ticket) => {
    const v = views.get(t.ticket_id)!;
    return (
      <TouchableOpacity key={t.ticket_id} style={styles.row} onPress={() => openTicket(t)} activeOpacity={0.85}>
        <View style={styles.rowIcon}>
          <Ionicons name={iconForCategory(t.category) as any} size={20} color={ORANGE} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{t.sub_issue}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {t.ticket_ref}{t.request_id ? `   ${trackingIdFor(t.request_id)}` : ''}
          </Text>
          <View style={styles.rowFoot}>
            <StatusPill view={v} />
            <Text style={styles.rowTime}>{timeAgo(t.last_activity_at)}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  const shown = tab === 'active' ? active : closed;

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader
        title="Help"
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            style={styles.chatBtn} onPress={() => setChatOpen(true)}
            activeOpacity={0.85} hitSlop={8} accessibilityLabel="Live chat with support"
          >
            <Ionicons name="headset-outline" size={24} color={colors.textPrimary} />
            <Text style={styles.chatLabel} numberOfLines={1}>Live chat</Text>
            {unreadChat > 0 && <View style={styles.chatDot} />}
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={ORANGE}
            onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        <TouchableOpacity style={styles.cta} onPress={startReport} activeOpacity={0.9}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaTitle}>Report a problem</Text>
            <Text style={styles.ctaSub}>
              Something wrong with a delivery, a payment or your account? Tell us once and follow it here.
            </Text>
          </View>
          <View style={styles.ctaIcon}>
            <Ionicons name="add" size={26} color={ORANGE} />
          </View>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator color={ORANGE} style={{ marginTop: 40 }} />
        ) : error ? (
          <View style={styles.empty}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Couldn't load your tickets</Text>
            <Text style={styles.emptySub}>{error}</Text>
            <TouchableOpacity onPress={load} style={styles.retry}><Text style={styles.retryText}>Try again</Text></TouchableOpacity>
          </View>
        ) : (
          <>
            {needsAction.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Needs your attention</Text>
                {needsAction.map(renderRow)}
              </View>
            )}

            <View style={styles.tabs}>
              {(['active', 'closed'] as Tab[]).map(k => {
                const on = tab === k;
                const n = k === 'active' ? active.length : closed.length;
                return (
                  <TouchableOpacity key={k} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(k)} activeOpacity={0.85}>
                    <Text style={[styles.tabText, on && styles.tabTextOn]}>
                      {k === 'active' ? 'In progress' : 'Resolved'}{n ? `  ${n}` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {shown.length > 0 ? (
              <View style={{ gap: 10 }}>{shown.map(renderRow)}</View>
            ) : needsAction.length > 0 && tab === 'active' ? null : (
              <View style={styles.empty}>
                <Ionicons name={tab === 'active' ? 'chatbubbles-outline' : 'checkmark-done-outline'} size={32} color={colors.textMuted} />
                <Text style={styles.emptyTitle}>
                  {tab === 'active' ? 'Nothing in progress' : 'No resolved tickets yet'}
                </Text>
                <Text style={styles.emptySub}>
                  {tab === 'active'
                    ? 'When you report a problem, you can follow every update and reply right here.'
                    : 'Closed cases and their decisions will be kept here.'}
                </Text>
              </View>
            )}
          </>
        )}

        <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('LegalPolicies')} activeOpacity={0.8}>
          <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.linkText}>Terms and policies</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </ScrollView>

      <LiveChatModal
        visible={chatOpen}
        role={role}
        onClose={() => { setChatOpen(false); countUnreadAgentReplies().then(setUnreadChat).catch(() => {}); }}
        onReport={() => { setChatOpen(false); startReport(); }}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  content: { padding: 20, paddingBottom: 60, gap: 18 },

  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: ORANGE, borderRadius: 22, padding: 20,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 7,
  },
  ctaTitle: { color: '#FFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  ctaSub: { color: '#FFEDD5', fontSize: 13, lineHeight: 19, marginTop: 6, fontWeight: '500' },
  ctaIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center' },

  chatBtn: { minWidth: 40, height: 44, alignItems: 'center', justifyContent: 'center', gap: 1 },
  chatLabel: { fontSize: 10, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.1 },
  chatDot: {
    position: 'absolute', top: 0, right: 4, width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#EF4444', borderWidth: 2, borderColor: c.background,
  },

  section: { gap: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },

  tabs: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 14, padding: 4, borderWidth: 1, borderColor: c.divider },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  tabOn: { backgroundColor: c.accentSoft },
  tabText: { fontSize: 13, fontWeight: '700', color: c.textSecondary },
  tabTextOn: { color: ORANGE, fontWeight: '800' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.card, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDark ? 0.3 : 0.04, shadowRadius: 6, elevation: 1,
  },
  rowIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 14.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  rowMeta: { fontSize: 12, color: c.textSecondary, fontWeight: '600' },
  rowFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  rowTime: { fontSize: 11.5, color: c.textMuted, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, marginTop: 4 },
  emptySub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  retry: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, backgroundColor: c.accentSoft },
  retryText: { color: ORANGE, fontWeight: '800', fontSize: 13 },

  link: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: c.divider, marginTop: 6,
  },
  linkText: { flex: 1, fontSize: 14, fontWeight: '700', color: c.textPrimary },
});