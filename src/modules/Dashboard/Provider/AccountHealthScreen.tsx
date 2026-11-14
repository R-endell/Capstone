// src/modules/Dashboard/Provider/AccountHealthScreen.tsx
//
// Provider accountability hub. Shows:
//   1. Account status (3-strike policy — strikes are issued by admins and
//      read from provider_strikes / provider_standing, not from open reports)
//   2. Strike policy ladder
//   3. Your numbers (deliveries, rating, active reports, strikes remaining)
//   4. Reports against you — sender-filed, respond once
//   5. Your tickets — Active / Resolved
//
// Sibling of HelpCenterScreen: Help handles chat + new reports, this screen
// handles everything about the provider's own accountability and case load.
//
// Visual system copied from RegisterProviderScreen: Poppins fonts, radius-16
// section cards with hairline borders (no shadows), numbered upload-style
// section headers, tinted notes, staged fade-up entrance.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  StatusBar, ActivityIndicator, RefreshControl, Animated, Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import {
  Ticket, buildTimeline, fetchMyTickets, fetchReportsAgainstMe, getMyUserId,
  isClosed, statusView, subscribeTickets, timeAgo, trackingIdFor,
} from '../../../services/ticketService';
import { iconForCategory } from '../../../services/ticketCatalog';
import {
  ScreenHeader, StatusPill, TicketStepper, SectionCard, ORANGE,
} from '../../Help/helpUi';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

const MAX_STRIKES = 3;

type StrikeLevel = 0 | 1 | 2 | 3;
type Tab = 'active' | 'closed';

type StrikeRow = {
  strike_id: number;
  reason_category: string;
  reason: string;
  weight: number;
  consequence: 'warning' | 'suspension' | 'removal';
  suspension_days: number | null;
  status: 'active' | 'revoked';
  issued_at: string;
  revoked_at: string | null;
};

type AccountHealth = {
  totalDeliveries: number;
  avgRating: number | null;
  activeReports: number;
  strikes: StrikeLevel;
  suspendedUntil: string | null;
  removed: boolean;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

export default function AccountHealthScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [health, setHealth] = useState<AccountHealth | null>(null);
  const [me, setMe] = useState<number | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [reportsAgainstMe, setReportsAgainstMe] = useState<Ticket[]>([]);
  const [strikeList, setStrikeList] = useState<StrikeRow[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pulse = useRef(new Animated.Value(0.45)).current;
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

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      const { data: userData } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (!userData?.user_id) throw new Error('Could not find your account.');
      const provId = userData.user_id;

      // Best-effort: restore routes if a suspension has just run out.
      try { await supabase.rpc('lift_expired_suspensions'); } catch { /* ignore */ }

      const [id, deliveryRes, ratingRes, strikeRes, standingRes, against, mine] = await Promise.all([
        getMyUserId(),
        supabase
          .from('deliveries')
          .select('delivery_id', { count: 'exact', head: true })
          .eq('provider_id', provId)
          .not('completed_at', 'is', null),
        supabase
          .from('ratings_reviews')
          .select('rating')
          .eq('reviewee_id', provId),
        supabase
          .from('provider_strikes')
          .select('strike_id, reason_category, reason, weight, consequence, suspension_days, status, issued_at, revoked_at')
          .eq('provider_id', provId)
          .order('issued_at', { ascending: false }),
        supabase
          .from('provider_standing')
          .select('suspended_until, removed_by_strikes')
          .eq('provider_id', provId)
          .maybeSingle(),
        fetchReportsAgainstMe(),
        fetchMyTickets(),
      ]);

      setMe(id);
      setTickets(mine);
      setReportsAgainstMe(against);

      const totalDeliveries = deliveryRes.count ?? 0;
      const ratingRows = (ratingRes.data || []) as { rating: number | null }[];
      const numericRatings = ratingRows
        .map(r => (typeof r.rating === 'number' ? r.rating : null))
        .filter((v): v is number => v != null);
      const avgRating = numericRatings.length > 0
        ? Number((numericRatings.reduce((a, b) => a + b, 0) / numericRatings.length).toFixed(2))
        : null;

      // Strikes are issued by admins. A report alone is NOT a strike.
      const strikeRows = (strikeRes.data || []) as StrikeRow[];
      setStrikeList(strikeRows);
      const points = strikeRows
        .filter(s => s.status === 'active')
        .reduce((sum, s) => sum + (s.weight || 1), 0);
      const strikes = Math.min(MAX_STRIKES, points) as StrikeLevel;

      const standing = standingRes.data as
        | { suspended_until: string | null; removed_by_strikes: boolean }
        | null;

      const activeReports = against.filter(t => !isClosed(t.status)).length;

      setHealth({
        totalDeliveries,
        avgRating,
        activeReports,
        strikes,
        suspendedUntil: standing?.suspended_until ?? null,
        removed: !!standing?.removed_by_strikes,
      });
    } catch (e: any) {
      setError(e?.message || 'Could not load account health.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => subscribeTickets(load), [load]);

  // ---- derived state for the ticket sections ----
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
  const shown = tab === 'active' ? active : closed;

  const againstOpen = useMemo(
    () => reportsAgainstMe.filter(t => !isClosed(t.status)),
    [reportsAgainstMe],
  );

  // ---- navigation ----
  const openTicket = (t: Ticket) =>
    navigation.navigate('TicketDetail', { ticketId: t.ticket_id });
  const openAgainstMe = (t: Ticket) =>
    navigation.navigate('TicketDetail', { ticketId: t.ticket_id, source: 'reportAgainstMe' });
  const startReport = () => navigation.navigate('ReportIssue', { role: 'provider' });

  // ---- strike presentation ----
  const suspendedUntilDate = health?.suspendedUntil ? new Date(health.suspendedUntil) : null;
  const isSuspended = !!suspendedUntilDate && suspendedUntilDate.getTime() > Date.now();

  const strikeView = (strikes: StrikeLevel) => {
    switch (strikes) {
      case 3:
        return {
          label: 'Removed',
          color: colors.error,
          bg: colors.errorBg,
          headline: 'Your account has been removed',
          body: 'Reaching strike 3 means removal from the platform. Your wallet balance can still be withdrawn. Contact support if you believe this is a mistake.',
        };
      case 2:
        return isSuspended
          ? {
              label: 'Suspended',
              color: colors.error,
              bg: colors.errorBg,
              headline: 'Your account is temporarily suspended',
              body: `You can't go online or accept new jobs until ${fmtDate(health!.suspendedUntil!)}. Finish any delivery already in progress. One more strike removes your account.`,
            }
          : {
              label: 'Final warning',
              color: colors.error,
              bg: colors.errorBg,
              headline: 'You are one strike away from removal',
              body: 'Your suspension has ended, but one more strike removes your account from the platform.',
            };
      case 1:
        return {
          label: 'Warning',
          color: colors.warning,
          bg: colors.warningBg,
          headline: 'You have one warning on your account',
          body: 'Two more strikes remove your account from the platform. Keep deliveries on track and respond promptly to reports.',
        };
      default:
        return {
          label: 'Healthy',
          color: colors.success,
          bg: colors.successBg,
          headline: 'Your account is in good standing',
          body: 'No active strikes. Keep delivering on time and responding to reports to stay in good standing.',
        };
    }
  };

  const STATUS_STEPS = [
    { n: 1 as const, title: 'Warning', sub: 'A warning is issued.', tone: 'warning' as const },
    { n: 2 as const, title: 'Suspension', sub: 'Suspended 3–30 days. No new jobs.', tone: 'error' as const },
    { n: 3 as const, title: 'Removal', sub: 'Removed from the platform.', tone: 'error' as const },
  ];

  const sv = health ? strikeView(health.strikes) : null;
  const remaining = health ? Math.max(0, MAX_STRIKES - health.strikes) : MAX_STRIKES;

  // ---- ticket row renderers (moved from HelpCenterScreen) ----
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

  const renderEmptyTickets = () => (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={tab === 'active' ? 'checkmark-circle-outline' : 'archive-outline'} size={30} color={ORANGE} />
      </View>
      <Text style={styles.emptyTitle}>{tab === 'active' ? 'All clear' : 'Nothing resolved yet'}</Text>
      <Text style={styles.emptySub}>
        {tab === 'active'
          ? 'You have no open tickets of your own. If something goes wrong, report it from Help.'
          : 'Cases that have been decided will be kept here for your records.'}
      </Text>
    </View>
  );

  const ticketsSubtitle =
    tab === 'active'
      ? active.length > 0
        ? `${active.length} open ticket${active.length === 1 ? '' : 's'}`
        : 'Tap a ticket to see its status'
      : 'Tap a ticket to review the decision';

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor={colors.background} translucent />
      <ScreenHeader title="Account Health" onBack={() => navigation.goBack()} />

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.loadingText}>Loading your account…</Text>
        </View>
      ) : error ? (
        <View style={styles.loadingWrap}>
          <SolarIcon name="DangerCircle" variant="duotone" size={40} color={colors.error} />
          <Text style={styles.errorTitle}>Couldn't load account health</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => { setLoading(true); load(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={() => { setRefreshing(true); load(); }}
            />
          }
        >
          {/* 1. Status hero */}
          {sv && health && (
            <View style={styles.hero}>
              <View style={[styles.heroPill, { backgroundColor: sv.bg }]}>
                <SolarIcon
                  name={
                    health.strikes === 0 ? 'CheckCircle'
                    : health.strikes === 1 ? 'DangerTriangle'
                    : 'DangerCircle'
                  }
                  variant="bold"
                  size={14}
                  color={sv.color}
                />
                <Text style={[styles.heroPillText, { color: sv.color }]}>{sv.label}</Text>
              </View>
              <Text style={styles.heroTitle}>{sv.headline}</Text>
              <Text style={styles.heroBody}>{sv.body}</Text>

              <View style={styles.heroFoot}>
                <Text style={styles.heroFootLabel}>STRIKES</Text>
                <Text style={[styles.heroFootValue, { color: sv.color }]}>
                  {health.strikes} / {MAX_STRIKES}
                </Text>
                <Text style={styles.heroFootHint}>
                  {health.strikes >= MAX_STRIKES
                    ? 'Maximum reached'
                    : `${remaining} remaining`}
                </Text>
              </View>
            </View>
          )}

          {/* 2. Strike ladder */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Strike policy</Text>
            <Text style={styles.cardSub}>
              Strikes are issued by Pack-N-Ship staff after a report has been reviewed. A report on its
              own is not a strike. The consequences escalate with every strike, and a severe violation
              can lead straight to removal.
            </Text>

            <View style={styles.ladder}>
              {STATUS_STEPS.map((step, idx) => {
                const active = health ? health.strikes >= step.n : false;
                const current = health ? health.strikes === step.n : false;
                const toneColor = step.tone === 'error' ? colors.error : colors.warning;
                return (
                  <React.Fragment key={step.n}>
                    {idx > 0 && (
                      <View
                        style={[
                          styles.ladderLine,
                          health && health.strikes >= step.n
                            ? { backgroundColor: colors.error }
                            : null,
                        ]}
                      />
                    )}
                    <View style={styles.ladderStep}>
                      <View
                        style={[
                          styles.ladderDot,
                          active && { backgroundColor: toneColor, borderColor: toneColor },
                          current && styles.ladderDotCurrent,
                        ]}
                      >
                        {active ? (
                          <SolarIcon name="CloseCircle" variant="bold" size={14} color="#FFFFFF" />
                        ) : (
                          <Text style={styles.ladderDotText}>{step.n}</Text>
                        )}
                      </View>
                      <Text
                        style={[styles.ladderTitle, active && { color: toneColor }]}
                        numberOfLines={1}
                      >
                        {step.title}
                      </Text>
                      <Text style={styles.ladderSub} numberOfLines={2}>{step.sub}</Text>
                    </View>
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {/* Strike history */}
          {strikeList.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Strike history</Text>
              <Text style={styles.cardSub}>Why each strike was issued, and what it led to.</Text>
              <View style={{ gap: 10, marginTop: 4 }}>
                {strikeList.map(s => {
                  const live = s.status === 'active';
                  const tone = !live
                    ? { fg: colors.textMuted, bg: colors.divider }
                    : s.consequence === 'warning'
                      ? { fg: colors.warning, bg: colors.warningBg }
                      : { fg: colors.error, bg: colors.errorBg };
                  const outcome =
                    s.consequence === 'warning' ? 'Warning'
                    : s.consequence === 'suspension' ? `Suspension${s.suspension_days ? ` · ${s.suspension_days} days` : ''}`
                    : 'Removal';
                  return (
                    <View key={s.strike_id} style={[styles.strikeRow, !live && { opacity: 0.65 }]}>
                      <View style={styles.strikeTop}>
                        <View style={[styles.strikePill, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.strikePillText, { color: tone.fg }]}>
                            {live ? outcome : 'Revoked'}
                          </Text>
                        </View>
                        <Text style={styles.strikeDate}>{fmtDate(s.issued_at)}</Text>
                      </View>
                      <Text style={styles.strikeTitle}>{s.reason_category}</Text>
                      <Text style={styles.strikeBody}>{s.reason}</Text>
                      {!live && s.revoked_at && (
                        <Text style={styles.strikeMeta}>Removed on {fmtDate(s.revoked_at)} after review.</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* 3. Numbers */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your numbers</Text>

            <View style={styles.statRow}>
              <Stat styles={styles} label="TOTAL DELIVERIES" value={String(health?.totalDeliveries ?? 0)} icon="Box" color={colors.textPrimary} />
              <Stat styles={styles} label="AVERAGE RATING" value={health?.avgRating != null ? `${health.avgRating.toFixed(2)} ★` : '—'} icon="Star" color={health?.avgRating != null ? colors.accent : colors.textMuted} />
            </View>

            <View style={[styles.statRow, { marginTop: 10 }]}>
              <Stat styles={styles} label="ACTIVE REPORTS" value={String(health?.activeReports ?? 0)} icon="ShieldWarning" color={health && health.activeReports > 0 ? colors.error : colors.textPrimary} />
              <Stat styles={styles} label="STRIKES REMAINING" value={String(remaining)} icon="ShieldCheck" color={remaining === 0 ? colors.error : colors.success} />
            </View>
          </View>

          {/* 4. Reports against you — sender-filed */}
          {againstOpen.length > 0 && (
            <View>
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
            </View>
          )}

          {/* 5. Your tickets — Active / Resolved */}
          <View>
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
                    <TouchableOpacity
                      key={k}
                      style={[styles.tab, on && styles.tabOn]}
                      onPress={() => setTab(k)}
                      activeOpacity={0.85}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.tabText, on && styles.tabTextOn]}>
                        {k === 'active' ? 'Active' : 'Resolved'}
                      </Text>
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
                {shown.length > 0 ? <>{shown.map(renderRow)}</> : renderEmptyTickets()}
              </View>
            </SectionCard>
          </View>

          {/* New report CTA */}
          <TouchableOpacity
            style={styles.newReportBtn}
            onPress={startReport}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Ionicons name="flag-outline" size={16} color={ORANGE} />
            <Text style={styles.newReportText}>Report a new problem</Text>
            <Ionicons name="chevron-forward" size={16} color={ORANGE} />
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

function Stat({
  styles, label, value, icon, color,
}: {
  styles: any;
  label: string;
  value: string;
  icon: any;
  color: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIconRow}>
        <SolarIcon name={icon} variant="linear" size={16} color={color} />
        <Text style={styles.statLabel}>{label}</Text>
      </View>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  loadingText: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: c.textSecondary },
  errorTitle: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, textAlign: 'center' },
  errorSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', lineHeight: 19 },
  retryBtn: { marginTop: 8, backgroundColor: c.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 14 },
  retryText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 14 },

  scroll: { paddingHorizontal: 20, paddingTop: 4, gap: 14 },

  // Hero
  hero: {
    backgroundColor: c.card, borderRadius: 16, padding: 18, gap: 10,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  heroPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
  },
  heroPillText: { fontSize: 11.5, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.2 },
  heroTitle: { fontSize: 20, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.4 },
  heroBody: { fontSize: 13.5, fontFamily: 'Poppins_500Medium', color: c.textSecondary, lineHeight: 20 },

  heroFoot: {
    flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: c.divider,
  },
  heroFootLabel: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.8 },
  heroFootValue: { fontSize: 20, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.4 },
  heroFootHint: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: c.textSecondary, marginLeft: 4 },

  // Card shell
  card: {
    backgroundColor: c.card, borderRadius: 16, padding: 16, gap: 10,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  cardTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  cardSub: { fontSize: 12.5, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 18 },

  // Strike ladder
  ladder: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginTop: 6, paddingHorizontal: 4,
  },
  ladderStep: { flex: 1, alignItems: 'center', gap: 6 },
  ladderDot: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  ladderDotCurrent: { transform: [{ scale: 1.1 }] },
  ladderDotText: { fontSize: 13, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted },
  ladderLine: {
    flex: 0.4, height: 2, marginTop: 16, marginHorizontal: -4,
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  ladderTitle: { fontSize: 12.5, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  ladderSub: {
    fontSize: 10.5, fontFamily: 'Poppins_400Regular', color: c.textMuted,
    textAlign: 'center', paddingHorizontal: 4,
  },

  // Stats
  statRow: { flexDirection: 'row', gap: 10 },
  statCard: {
    flex: 1, backgroundColor: c.background, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    gap: 8,
  },
  statIconRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statLabel: { fontSize: 9.5, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 0.8 },
  statValue: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.4 },

  // Section headers (shared with the row blocks)
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionNumberBadge: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: c.accent,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 2,
  },
  sectionNumberText: { fontSize: 12, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  sectionTitle: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: c.textMuted, marginTop: 1 },

  // Tabs
  tabs: { flexDirection: 'row', backgroundColor: isDark ? '#1F1F23' : '#F3F4F6', borderRadius: 14, padding: 4 },
  tab: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 11 },
  tabOn: { backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
  tabText: { fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: c.textSecondary },
  tabTextOn: { color: c.textPrimary, fontFamily: 'Poppins_800ExtraBold' },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.divider },
  countOn: { backgroundColor: ORANGE },
  countText: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },

  // Compact rows (active + against-me)
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

  // Full rows (resolved)
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

  // Empty tickets state
  empty: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16, gap: 8 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: 'Poppins_800ExtraBold', color: c.textPrimary, letterSpacing: -0.3 },
  emptySub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19, fontFamily: 'Poppins_500Medium' },

  // New report CTA
  newReportBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16,
    borderWidth: 1, borderColor: ORANGE,
  },
  newReportText: { flex: 1, fontSize: 13.5, fontFamily: 'Poppins_700Bold', color: ORANGE },

  // Strike history
  strikeRow: {
    backgroundColor: c.background, borderRadius: 12, padding: 14, gap: 6,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  strikeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  strikePill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  strikePillText: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.2 },
  strikeDate: { fontSize: 11, fontFamily: 'Poppins_600SemiBold', color: c.textMuted },
  strikeTitle: { fontSize: 13.5, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, letterSpacing: -0.1 },
  strikeBody: { fontSize: 12.5, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 18 },
  strikeMeta: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: c.textMuted },
});