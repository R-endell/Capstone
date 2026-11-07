// src/components/ProofOfDeliveryModal.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Modal, View, Text, Image, TouchableOpacity, StyleSheet,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { useTheme } from '../utils/themeContext';
import { formatDateTime } from '../utils/dateUtils';

const ORANGE = '#FF751F';
const { width: SCREEN_W } = Dimensions.get('window');

interface UnseenPodDelivery {
  delivery_id: number;
  request_id: number;
  completed_at: string;
  pod_photo_url: string;
  dropoff_address: string;
  provider_name: string;
  amount: string;
}

export default function ProofOfDeliveryModal({
  isSenderMode,
  onViewDetails,
}: {
  isSenderMode: boolean;
  onViewDetails?: (requestId: number) => void;
}) {
  const { colors } = useTheme();
  const [senderId, setSenderId] = useState<number | null>(null);
  const [podItem, setPodItem] = useState<UnseenPodDelivery | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const checkingRef = useRef(false);

  const checkUnseenPods = useCallback(async (uid: number) => {
    if (!isSenderMode || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const { data: rows, error } = await supabase
        .from('deliveries')
        .select(`
          delivery_id,
          request_id,
          completed_at,
          pod_photo_url,
          pod_seen_by_sender,
          provider_id,
          delivery_requests!inner (
            request_id,
            sender_id,
            estimated_cost,
            dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( street_address )
          )
        `)
        .eq('delivery_requests.sender_id', uid)
        .neq('provider_id', uid) // Never show to the courier who delivered it
        .eq('pod_seen_by_sender', false)
        .not('pod_photo_url', 'is', null)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1);

      if (error || !rows || rows.length === 0) return;

      const row: any = rows[0];
      const req = Array.isArray(row.delivery_requests) ? row.delivery_requests[0] : row.delivery_requests;

      let providerName = 'Your Courier';
      if (row.provider_id) {
        const { data: prov } = await supabase
          .from('users')
          .select('first_name, last_name')
          .eq('user_id', row.provider_id)
          .maybeSingle();
        if (prov) {
          providerName = `${prov.first_name || ''} ${prov.last_name || ''}`.trim() || 'Your Courier';
        }
      }

      setPodItem({
        delivery_id: row.delivery_id,
        request_id: row.request_id,
        completed_at: row.completed_at,
        pod_photo_url: row.pod_photo_url,
        dropoff_address: req?.dropoff_location?.street_address || 'Drop-off location',
        provider_name: providerName,
        amount: Number(req?.estimated_cost || 0).toFixed(2),
      });
    } catch (e) {
      console.warn('[ProofOfDeliveryModal] check error:', e);
    } finally {
      checkingRef.current = false;
    }
  }, [isSenderMode]);

  // Immediately hide if user switches to Provider mode
  useEffect(() => {
    if (!isSenderMode) {
      setPodItem(null);
    } else if (senderId) {
      checkUnseenPods(senderId);
    }
  }, [isSenderMode, senderId, checkUnseenPods]);

  useEffect(() => {
    let channel: any = null;
    let isMounted = true;

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setSenderId(null);
        setPodItem(null);
        return;
      }

      const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', session.user.id)
        .maybeSingle();

      if (!isMounted || !userRow?.user_id) return;
      const uid = userRow.user_id;
      setSenderId(uid);

      if (isSenderMode) {
        await checkUnseenPods(uid);
      }

      channel = supabase
        .channel(`global-pod-listener-${uid}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'deliveries' },
          (payload) => {
            const updated = payload.new as any;
            if (
              updated?.pod_photo_url &&
              updated?.pod_seen_by_sender === false &&
              Number(updated?.provider_id) !== Number(uid)
            ) {
              checkUnseenPods(uid);
            }
          }
        )
        .subscribe();
    };

    init();

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setSenderId(null);
        setPodItem(null);
      } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        init();
      }
    });

    return () => {
      isMounted = false;
      if (channel) supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
    };
  }, [checkUnseenPods, isSenderMode]);

  const handleDismiss = async (openCompletedActivity = false) => {
    if (!podItem) return;
    setAcknowledging(true);
    const targetReqId = podItem.request_id;
    try {
      await supabase
        .from('deliveries')
        .update({ pod_seen_by_sender: true })
        .eq('delivery_id', podItem.delivery_id);
    } catch { /* ignore */ } finally {
      setAcknowledging(false);
      setPodItem(null);
      if (openCompletedActivity && onViewDetails) {
        onViewDetails(targetReqId);
      }
      if (senderId && isSenderMode) {
        setTimeout(() => checkUnseenPods(senderId), 600);
      }
    }
  };

  if (!isSenderMode || !podItem) return null;

  const code = `PNS-${String(podItem.request_id).padStart(4, '0')}`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => handleDismiss(false)}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.badgeRow, { backgroundColor: colors.successBg }]}>
            <Ionicons name="checkmark-done-circle" size={20} color={colors.success} />
            <Text style={[styles.badgeText, { color: colors.success }]}>PROOF OF DELIVERY</Text>
          </View>

          <Text style={[styles.title, { color: colors.textPrimary }]}>Package Delivered! 🎉</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Shipment <Text style={{ fontWeight: '800', color: ORANGE }}>#{code}</Text> was delivered by {podItem.provider_name}.
          </Text>

          <View style={[styles.photoBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Image source={{ uri: podItem.pod_photo_url }} style={styles.photo} resizeMode="cover" />
            <View style={styles.photoCaption}>
              <Ionicons name="time-outline" size={13} color="#FFFFFF" />
              <Text style={styles.photoCaptionText}>{formatDateTime(podItem.completed_at)}</Text>
            </View>
          </View>

          <View style={[styles.infoTile, { backgroundColor: colors.background, borderColor: colors.divider }]}>
            <Ionicons name="location" size={18} color={ORANGE} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.infoLabel, { color: colors.textMuted }]}>DROPPED OFF AT</Text>
              <Text style={[styles.infoValue, { color: colors.textPrimary }]} numberOfLines={2}>
                {podItem.dropoff_address}
              </Text>
            </View>
          </View>

          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { backgroundColor: colors.accentSoft }]}
              onPress={() => handleDismiss(true)}
              disabled={acknowledging}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryBtnText}>View in Completed</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => handleDismiss(false)}
              disabled={acknowledging}
              activeOpacity={0.9}
            >
              {acknowledging ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Got It</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: Math.min(SCREEN_W - 36, 390),
    borderRadius: 26,
    padding: 22,
    borderWidth: 1,
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 12,
  },
  badgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  title: { fontSize: 22, fontWeight: '900', letterSpacing: -0.4, textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, marginBottom: 16 },
  photoBox: {
    width: '100%',
    height: 230,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 14,
  },
  photo: { width: '100%', height: '100%' },
  photoCaption: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(17,24,39,0.78)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  photoCaptionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  infoTile: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 18,
  },
  infoLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  infoValue: { fontSize: 13, fontWeight: '800', marginTop: 2 },
  btnRow: { flexDirection: 'row', width: '100%', gap: 10 },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: ORANGE, fontSize: 13, fontWeight: '800' },
  primaryBtn: {
    flex: 1.1,
    backgroundColor: ORANGE,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});