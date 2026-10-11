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

const ORANGE = '#FA7A25';
type Filter = 'all' | 'action' | 'review' | 'closed';

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
  ', ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export default function DisputeCenterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  // Provider screens pass { mode: 'provider' } so the "Report an Issue" button is hidden
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

  const stats = useMemo(() => ({
    action: disputes.filter(needsAction).length,
    review: disputes.filter(d => d.status === 'Under Review' || (d.status === 'Awaiting Provider' && !needsAction(d))).length,
    closed: disputes.filter(d => d.status === 'Resolved' || d.status === 'Dismissed').length,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [disputes, myId]);

  const visible = disputes.filter(d => {
    if (filter === 'action') return needsAction(d);
    if (filter === 'review') return d.status === 'Under Review' || (d.status === 'Awaiting Provider' && !needsAction(d));
    if (filter === 'closed') return d.status === 'Resolved' || d.status === 'Dismissed';
    return true;
  });

  const FILTERS: { key: Filter; label: string; count?: number }[] = [
    { key: 'all', label: 'All', count: disputes.length },
    ...(!providerMode || stats.action > 0 ? [{ key: 'action' as Filter, label: 'Needs response', count: stats.action }] : []),
    { key: 'review', label: 'In review', count: stats.review },
    { key: 'closed', label: 'Closed', count: stats.closed },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={ORANGE} />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Dispute Center</Text>
          <Text style={styles.headerSub}>
            {providerMode ? 'Reports filed against your deliveries' : 'Report and track delivery issues'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={ORANGE} />
        }
      >
        {!providerMode && (
          <TouchableOpacity
            style={styles.fileButton}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ReportIssue')}
          >
            <Ionicons name="add-circle-outline" size={22} color="#FFF" />
            <Text style={styles.fileButtonText}>Report an Issue</Text>
          </TouchableOpacity>
        )}

        {stats.action > 0 && (
          <View style={styles.actionBanner}>
            <Ionicons name="alert-circle" size={20} color="#92400E" />
            <Text style={styles.actionBannerText}>
              {stats.action} report{stats.action > 1 ? 's' : ''} waiting for your response
            </Text>
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#92400E' }]}>{stats.action}</Text>
            <Text style={styles.statLabel}>Needs response</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#2563EB' }]}>{stats.review}</Text>
            <Text style={styles.statLabel}>In review</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statNumber, { color: '#16A34A' }]}>{stats.closed}</Text>
            <Text style={styles.statLabel}>Closed</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipActive]}
              onPress={() => setFilter(f.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>
                {f.label}{typeof f.count === 'number' ? ` (${f.count})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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
                onPress={() => navigation.navigate('DisputeDetail', { disputeId: item.dispute_id })}
              >
                <View style={styles.cardTop}>
                  <View style={styles.boxIcon}>
                    <Ionicons name="cube" size={24} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{item.issue_type}</Text>
                    <Text style={styles.meta}>Tracking ID: {trackingIdFor(item.request_id)}</Text>
                    <Text style={styles.meta}>Case: {item.dispute_ref || `#${item.dispute_id}`}</Text>
                    <View style={styles.dateRow}>
                      <Ionicons name="calendar-outline" size={13} color="#6B7280" />
                      <Text style={styles.dateText}>{fmt(item.created_at)}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.bottomRow}>
                  <View style={styles.avatar}><Ionicons name="person" size={12} color="#FFF" /></View>
                  <Text style={styles.meta}>
                    {mine ? 'Provider' : 'Reported by'}: {other}
                  </Text>
                  {action && <Text style={styles.actionTag}>Respond now</Text>}
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
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 20, gap: 12,
  },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#000' },
  headerSub: { fontSize: 12, color: '#431407', marginTop: 2 },
  content: { padding: 20, paddingBottom: 100 },
  fileButton: {
    backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 12, gap: 8, marginBottom: 16, elevation: 2,
  },
  fileButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  actionBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7',
    padding: 12, borderRadius: 10, marginBottom: 16,
  },
  actionBannerText: { color: '#92400E', fontWeight: '700', fontSize: 13, flex: 1 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#F3F4F6',
  },
  statNumber: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: '#4B5563', fontWeight: '600', marginTop: 2 },
  filterRow: { gap: 8, paddingBottom: 14 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: '#FFF',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  chipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '600', color: '#4B5563' },
  chipTextActive: { color: '#FFF' },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF7ED',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 6, lineHeight: 19 },
  card: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: '#F3F4F6', elevation: 1,
  },
  cardAction: { borderColor: '#F59E0B', borderWidth: 1.5 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  boxIcon: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: '#FEF3C7',
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 3 },
  meta: { fontSize: 11, color: '#4B5563', lineHeight: 16 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
  dateText: { fontSize: 11, color: '#6B7280' },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: '#D97706',
    alignItems: 'center', justifyContent: 'center',
  },
  actionTag: { marginLeft: 'auto', color: '#B45309', fontWeight: '800', fontSize: 11 },
});