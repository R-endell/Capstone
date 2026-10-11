// src/modules/Dashboard/Disputes/NotificationsList.tsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { getMyUserId } from '../../../services/disputeService';

const ORANGE = '#FF751F';

type Notif = {
  notif_id: number;
  title: string;
  body: string;
  type: string;
  is_read: boolean;
  created_at: string;
  ref_id: number | null;
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function NotificationsList() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const myId = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      myId.current = myId.current ?? (await getMyUserId());
      if (!myId.current) return;
      const { data, error } = await supabase
        .from('notification_log')
        .select('notif_id, title, body, type, is_read, created_at, ref_id')
        .eq('user_id', myId.current)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setItems((data || []) as Notif[]);
    } catch (e) {
      console.error('Notifications load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const ch = supabase
      .channel('notif-list')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_log' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const open = async (n: Notif) => {
    if (!n.is_read) {
      setItems(prev => prev.map(i => (i.notif_id === n.notif_id ? { ...i, is_read: true } : i)));
      supabase.from('notification_log').update({ is_read: true }).eq('notif_id', n.notif_id).then(() => {});
    }
    if (n.type === 'dispute' && n.ref_id) {
      navigation.navigate('DisputeDetail', { disputeId: n.ref_id });
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View style={styles.center}>
        <Ionicons name="notifications-outline" size={48} color="#D1D5DB" />
        <Text style={styles.emptyTitle}>No notifications yet</Text>
        <Text style={styles.emptySub}>Updates about your reports and disputes will appear here.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={i => String(i.notif_id)}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={ORANGE} />
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.item, !item.is_read && styles.itemUnread]}
          activeOpacity={0.8}
          onPress={() => open(item)}
        >
          <View style={styles.iconBox}>
            <Ionicons name="shield-checkmark-outline" size={20} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.row}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              {!item.is_read && <View style={styles.dot} />}
            </View>
            <Text style={styles.body} numberOfLines={3}>{item.body}</Text>
            <Text style={styles.time}>{ago(item.created_at)}</Text>
          </View>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 16 },
  emptySub: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  item: {
    flexDirection: 'row', gap: 12, backgroundColor: '#FFF', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#F3F4F6',
  },
  itemUnread: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  iconBox: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFEDD5',
    alignItems: 'center', justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ORANGE },
  body: { fontSize: 13, color: '#4B5563', marginTop: 3, lineHeight: 18 },
  time: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },
});