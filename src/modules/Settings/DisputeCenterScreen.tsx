// src/modules/Dashboard/Sender/Settings_Sender/DisputeCenterScreen.tsx
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import {
  Dispute, fetchMyDisputes, getMyUserId, trackingIdFor, displayName, STATUS_STYLE,
} from '../../services/disputeService';

/** Brand */
const ORANGE = '#F27024';
const ORANGE_SOFT = '#FFF4EC';
const ORANGE_BORDER = '#FFD9B8';

type Filter = 'all' | 'action' | 'review' | 'closed';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
  ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function DisputeCenterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
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
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dispute Center</Text>
          <Text style={styles.headerSub}>
            {providerMode
              ? 'Reports filed against your deliveries'
              : 'Report and track delivery issues'}
          </Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={ORANGE}
          />
        }
      >
        {/* REPORT BUTTON */}
        {!providerMode && (
          <TouchableOpacity
            style={styles.fileButton}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ReportIssue')}
          >
            <Ionicons name="add-circle-outline" size={20} color="#FFF" />
            <Text style={styles.fileButtonText}>Report an Issue</Text>
          </TouchableOpacity>
        )}

        {/* ACTION BANNER */}
        {stats.action > 0 && (
          <View style={styles.actionBanner}>
            <View style={styles.actionBannerIcon}>
              <Ionicons name="alert-circle" size={20} color="#92400E" />
            </View>
            <Text style={styles.actionBannerText}>
              {stats.action} report{stats.action > 1 ? 's' : ''} waiting for your response
            </Text>
          </View>
        )}

        {/* STATS */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' }]}>
              <Ionicons name="alert-circle-outline" size={18} color="#92400E" />
            </View>
            <Text style={[styles.statNumber, { color: '#92400E' }]}>{stats.action}</Text>
            <Text style={styles.statLabel}>Needs response</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' }]}>
              <Ionicons name="time-outline" size={18} color="#2563EB" />
            </View>
            <Text style={[styles.statNumber, { color: '#2563EB' }]}>{stats.review}</Text>
            <Text style={styles.statLabel}>In review</Text>
          </View>

          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7' }]}>
              <Ionicons name="checkmark-done-outline" size={18} color="#16A34A" />
            </View>
            <Text style={[styles.statNumber, { color: '#16A34A' }]}>{stats.closed}</Text>
            <Text style={styles.statLabel}>Closed</Text>
          </View>
        </View>

        {/* FILTER CHIPS */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map(f => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f.label}
                </Text>
                {typeof f.count === 'number' && (
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>
                      {f.count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* LIST */}
        {loading ? (
          <ActivityIndicator color={ORANGE} style={{ marginTop: 40 }} />
        ) : visible.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="shield-checkmark-outline" size={32} color={ORANGE} />
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
                onPress={() =>
                  navigation.navigate('DisputeDetail', { disputeId: item.dispute_id })
                }
              >
                <View style={styles.cardTop}>
                  <View style={styles.boxIcon}>
                    <Ionicons name="cube" size={22} color={ORANGE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.issue_type}</Text>

                    <View style={styles.metaRow}>
                      <Ionicons name="barcode-outline" size={12} color="#6B7280" />
                      <Text style={styles.meta}>Tracking ID: {trackingIdFor(item.request_id)}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="document-text-outline" size={12} color="#6B7280" />
                      <Text style={styles.meta}>
                        Case: {item.dispute_ref || `#${item.dispute_id}`}
                      </Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Ionicons name="calendar-outline" size={12} color="#6B7280" />
                      <Text style={styles.dateText}>{fmt(item.created_at)}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 8 }}>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.bottomRow}>
                  <View style={styles.avatar}>
                    <Ionicons name="person" size={11} color="#FFF" />
                  </View>
                  <Text style={styles.bottomText}>
                    {mine ? 'Provider' : 'Reported by'}: <Text style={styles.bottomName}>{other}</Text>
                  </Text>
                  {action && (
                    <View style={styles.actionTag}>
                      <Ionicons name="flash" size={11} color="#B45309" />
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
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '500',
  },

  /* ── Content ────────────────────────────────────── */
  content: { padding: 20, paddingBottom: 100 },

  /* Report button */
  fileButton: {
    flexDirection: 'row',
    backgroundColor: ORANGE,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  fileButtonText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },

  /* Action banner */
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEF3C7',
    padding: 14,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  actionBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBannerText: { color: '#92400E', fontWeight: '700', fontSize: 13, flex: 1 },

  /* Stats */
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: 6,
  },
  statNumber: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  statLabel: {
    fontSize: 10.5,
    color: '#4B5563',
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  /* Filter chips */
  filterRow: { gap: 8, paddingBottom: 16, paddingRight: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  chipActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  chipText: { fontSize: 13, fontWeight: '700', color: '#4B5563' },
  chipTextActive: { color: '#FFF' },
  chipCount: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  chipCountText: { fontSize: 11, fontWeight: '800', color: '#4B5563' },
  chipCountTextActive: { color: '#FFF' },

  /* Empty state */
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ORANGE_SOFT,
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  emptySub: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 19,
    fontWeight: '500',
  },

  /* Dispute card */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardAction: {
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    backgroundColor: '#FFFDF7',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  boxIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: ORANGE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
  },
  cardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
    letterSpacing: -0.2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  meta: { fontSize: 11.5, color: '#4B5563', fontWeight: '500' },
  dateText: { fontSize: 11, color: '#6B7280', fontWeight: '500' },

  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' },

  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },

  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomText: { fontSize: 12, color: '#4B5563', fontWeight: '500' },
  bottomName: { color: '#111827', fontWeight: '800' },

  actionTag: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  actionTagText: { color: '#B45309', fontWeight: '800', fontSize: 10.5, letterSpacing: 0.2 },
});