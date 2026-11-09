// src/modules/Dashboard/Sender/Settings_Sender/DisputeCenterScreen.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { supabase } from '../../utils/supabase';
import {
  Dispute, fetchMyDisputes, getMyUserId, trackingIdFor, displayName, STATUS_STYLE,
} from '../../services/disputeService';
import { useTheme, ThemeColors } from '../../utils/themeContext';
import { SolarIcon } from '../../components/ui/SolarIcon';

type Filter = 'all' | 'action' | 'review' | 'closed';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
  ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function DisputeCenterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const providerMode = route.params?.mode === 'provider';

  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const myIdRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const id = myIdRef.current ?? (await getMyUserId());
      myIdRef.current = id;
      setMyId(id);
      setDisputes(await fetchMyDisputes());
    } catch (e) {
      console.error('Dispute load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const ch = supabase
      .channel('disputes-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'disputes' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const needsAction = (d: Dispute) => d.provider_id === myId && d.status === 'Awaiting Provider';

  const stats = useMemo(
    () => ({
      action: disputes.filter(needsAction).length,
      review: disputes.filter(
        d => d.status === 'Under Review' || (d.status === 'Awaiting Provider' && !needsAction(d))
      ).length,
      closed: disputes.filter(d => d.status === 'Resolved' || d.status === 'Dismissed').length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disputes, myId]
  );

  const visible = disputes.filter(d => {
    if (filter === 'action') return needsAction(d);
    if (filter === 'review')
      return d.status === 'Under Review' || (d.status === 'Awaiting Provider' && !needsAction(d));
    if (filter === 'closed') return d.status === 'Resolved' || d.status === 'Dismissed';
    return true;
  });

  const FILTERS: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: disputes.length },
    ...(!providerMode || stats.action > 0
      ? [{ key: 'action' as Filter, label: 'Needs response', count: stats.action }]
      : []),
    { key: 'review', label: 'In review', count: stats.review },
    { key: 'closed', label: 'Closed', count: stats.closed },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={10} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dispute Center</Text>
          <Text style={styles.headerSub}>
            {providerMode ? 'Reports filed against your deliveries' : 'Report and track delivery issues'}
          </Text>
        </View>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
      >
        {!providerMode && (
          <TouchableOpacity
            style={styles.fileButton}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ReportIssue')}
          >
            <SolarIcon name="AddCircle" variant="linear" size={20} color="#FFF" />
            <Text style={styles.fileButtonText}>Report an Issue</Text>
          </TouchableOpacity>
        )}

        {stats.action > 0 && (
          <View style={styles.actionBanner}>
            <View style={styles.actionBannerIcon}>
              <SolarIcon name="DangerCircle" variant="duotone" size={20} color={colors.warning} />
            </View>
            <Text style={styles.actionBannerText}>
              {stats.action} report{stats.action > 1 ? 's' : ''} waiting for your response
            </Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.warningBg, borderColor: colors.warning }]}>
              <SolarIcon name="DangerCircle" variant="linear" size={18} color={colors.warning} />
            </View>
            <Text style={[styles.statNumber, { color: colors.warning }]}>{stats.action}</Text>
            <Text style={styles.statLabel}>Needs response</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.infoSoft, borderColor: colors.info }]}>
              <SolarIcon name="Clock" variant="linear" size={18} color={colors.info} />
            </View>
            <Text style={[styles.statNumber, { color: colors.info }]}>{stats.review}</Text>
            <Text style={styles.statLabel}>In review</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: colors.successBg, borderColor: colors.success }]}>
              <SolarIcon name="CheckCircle" variant="linear" size={18} color={colors.success} />
            </View>
            <Text style={[styles.statNumber, { color: colors.success }]}>{stats.closed}</Text>
            <Text style={styles.statLabel}>Closed</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
                {typeof f.count === 'number' && (
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>{f.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <SolarIcon name="ShieldCheck" variant="duotone" size={32} color={colors.accent} />
            </View>
            <Text style={styles.emptyTitle}>No reports here</Text>
            <Text style={styles.emptySub}>
              {providerMode
                ? 'When a sender reports an issue on your delivery, it will show up here.'
                : 'Had a problem with a delivery? Tap “Report an Issue” and use your tracking ID.'}
            </Text>
          </View>
        ) : (
          visible.map(item => {
            const st = STATUS_STYLE[item.status];
            const mine = item.reported_by === myId;
            const other = mine ? displayName(item.provider) : displayName(item.reporter);
            const action = needsAction(item);
            return (
              <TouchableOpacity
                key={item.dispute_id}
                style={[styles.card, action && styles.cardAction]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('DisputeDetail', { disputeId: item.dispute_id })}
              >
                <View style={styles.cardTop}>
                  <View style={styles.boxIcon}>
                    <SolarIcon name="Package" variant="boldDuotone" size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.issue_type}</Text>

                    <View style={styles.metaRow}>
                      <SolarIcon name="QrCode" variant="linear" size={12} color={colors.textSecondary} />
                      <Text style={styles.meta}>Tracking ID: {trackingIdFor(item.request_id)}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <SolarIcon name="DocumentText" variant="linear" size={12} color={colors.textSecondary} />
                      <Text style={styles.meta}>Case: {item.dispute_ref || `#${item.dispute_id}`}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <SolarIcon name="Calendar" variant="linear" size={12} color={colors.textSecondary} />
                      <Text style={styles.dateText}>{fmt(item.created_at)}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                    </View>
                    <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.bottomRow}>
                  <View style={styles.avatar}>
                    <SolarIcon name="User" variant="bold" size={11} color="#FFF" />
                  </View>
                  <Text style={styles.bottomText}>
                    {mine ? 'Provider' : 'Reported by'}: <Text style={styles.bottomName}>{other}</Text>
                  </Text>
                  {action && (
                    <View style={styles.actionTag}>
                      <SolarIcon name="Lightning" variant="bold" size={11} color={colors.warning} />
                      <Text style={styles.actionTagText}>Respond now</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
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
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },

  content: { padding: 20, paddingBottom: 100 },

  fileButton: {
    flexDirection: 'row', backgroundColor: c.accent,
    paddingVertical: 16, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 3,
  },
  fileButtonText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },

  actionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.warningBg, padding: 14, borderRadius: 12, marginBottom: 16,
    borderWidth: 1, borderColor: c.warning,
  },
  actionBannerIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: isDark ? '#3A2411' : '#FDE68A',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBannerText: { color: c.warning, fontFamily: 'Poppins_600SemiBold', fontSize: 13, flex: 1 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statCard: {
    flex: 1, backgroundColor: c.card, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 10, alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 6, elevation: 0,
  },
  statIconWrap: {
    width: 32, height: 32, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 6,
  },
  statNumber: { fontSize: 22, fontFamily: 'Poppins_800ExtraBold', letterSpacing: -0.4 },
  statLabel: {
    fontSize: 10.5, color: c.textSecondary, fontFamily: 'Poppins_700Bold',
    marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3,
  },

  filterRow: { gap: 8, paddingBottom: 16, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  chipActive: {
    backgroundColor: c.accent, borderColor: c.accent,
    shadowColor: c.accent, shadowOpacity: 0.28, shadowRadius: 8, elevation: 4,
  },
  chipText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.textSecondary },
  chipTextActive: { color: '#FFF' },
  chipCount: {
    minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10,
    backgroundColor: c.divider, alignItems: 'center', justifyContent: 'center',
  },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  chipCountText: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textSecondary },
  chipCountTextActive: { color: '#FFF' },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: c.accentSoft, borderWidth: 1, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  emptySub: {
    fontSize: 13, color: c.textSecondary, textAlign: 'center',
    marginTop: 6, lineHeight: 19, fontFamily: 'Poppins_400Regular',
  },

  card: {
    backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.02, shadowRadius: 8, elevation: 0,
  },
  cardAction: {
    borderColor: c.warning, borderWidth: 1,
    backgroundColor: isDark ? '#2A1F0A' : '#FFFDF7',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  boxIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.accent,
  },
  cardTitle: {
    fontSize: 15.5, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary,
    marginBottom: 6, letterSpacing: -0.2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  meta: { fontSize: 11.5, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  dateText: { fontSize: 11, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.3, textTransform: 'uppercase' },

  divider: { height: 1, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', marginVertical: 12 },

  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
  },
  bottomText: { fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_500Medium' },
  bottomName: { color: c.textPrimary, fontFamily: 'Poppins_700Bold' },

  actionTag: {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
    backgroundColor: c.warningBg, borderWidth: 1, borderColor: c.warning,
  },
  actionTagText: { color: c.warning, fontFamily: 'Poppins_800ExtraBold', fontSize: 10.5, letterSpacing: 0.2 },
});