// src/modules/Settings/SupportScreen.tsx
// Customer Service page (moved from the old floating SupportFab button).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  ActivityIndicator, Alert, TextInput, Platform, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../utils/supabase';
import { useTheme, ThemeColors } from '../../utils/themeContext';

const ORANGE = '#FF751F';

type SupportCase = {
  kind: 'dispute' | 'issue' | 'delivery';
  id: number;
  title: string;
  subtitle: string;
  status: string;
  created_at: string;
  ref?: string | null;
  badge_color: string;
};

type Role = 'sender' | 'provider';

export default function SupportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  // The Account screens pass the role. If it is missing, fall back to looking
  // at which tab navigator sits lower in the stack.
  const paramRole: Role | undefined = route.params?.role;
  const role: Role = useMemo(() => {
    if (paramRole === 'provider' || paramRole === 'sender') return paramRole;
    const routes: any[] = navigation.getState?.()?.routes ?? [];
    for (let i = routes.length - 1; i >= 0; i--) {
      if (routes[i].name === 'ProviderTabs') return 'provider';
      if (routes[i].name === 'MainTabs') return 'sender';
    }
    return 'sender';
  }, [navigation, paramRole]);

  const [loading, setLoading] = useState(false);
  const [me, setMe] = useState<number | null>(null);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      if (data?.user_id) setMe(data.user_id);
    })();
  }, []);

  const loadCases = useCallback(async () => {
    if (!me) return;
    setLoading(true);
    try {
      const list: SupportCase[] = [];

      const { data: disputes } = await supabase
        .from('disputes')
        .select('dispute_id, dispute_ref, issue_type, status, created_at, reported_by, provider_id')
        .or(`reported_by.eq.${me},provider_id.eq.${me}`)
        .order('created_at', { ascending: false })
        .limit(10);

      (disputes || []).forEach((d: any) => {
        list.push({
          kind: 'dispute',
          id: d.dispute_id,
          title: `Dispute · ${d.issue_type}`,
          subtitle: d.dispute_ref || `DISP-${d.dispute_id}`,
          status: d.status,
          created_at: d.created_at,
          ref: d.dispute_ref,
          badge_color: colors.error,
        });
      });

      const { data: myDeliveries } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .or(`provider_id.eq.${me}`);

      const myDeliveryIds = (myDeliveries || []).map((d: any) => d.delivery_id);

      const { data: myReqs } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('sender_id', me);

      const reqIds = (myReqs || []).map((r: any) => r.request_id);

      if (reqIds.length) {
        const { data: senderDelivs } = await supabase
          .from('deliveries').select('delivery_id').in('request_id', reqIds);
        (senderDelivs || []).forEach((d: any) => myDeliveryIds.push(d.delivery_id));
      }

      const uniqueDeliveryIds = Array.from(new Set(myDeliveryIds));

      if (uniqueDeliveryIds.length) {
        const { data: issues } = await supabase
          .from('delivery_issues')
          .select('issue_id, issue_type, description, status, created_at, delivery_id')
          .in('delivery_id', uniqueDeliveryIds)
          .order('created_at', { ascending: false })
          .limit(10);

        (issues || []).forEach((i: any) => {
          list.push({
            kind: 'issue',
            id: i.issue_id,
            title: `Issue · ${i.issue_type}`,
            subtitle: i.description?.slice(0, 60) || 'Delivery issue',
            status: i.status,
            created_at: i.created_at,
            ref: `DEL-${i.delivery_id}`,
            badge_color: colors.warning,
          });
        });
      }

      if (role === 'provider' && uniqueDeliveryIds.length) {
        const { data: active } = await supabase
          .from('deliveries')
          .select('delivery_id, accepted_at, completed_at, request_id')
          .in('delivery_id', uniqueDeliveryIds)
          .is('completed_at', null)
          .order('accepted_at', { ascending: false })
          .limit(3);

        (active || []).forEach((d: any) => {
          list.push({
            kind: 'delivery',
            id: d.delivery_id,
            title: `Active delivery · PNS-${String(d.request_id).padStart(4, '0')}`,
            subtitle: 'Tap to view task details',
            status: 'In Progress',
            created_at: d.accepted_at,
            ref: `DEL-${d.delivery_id}`,
            badge_color: ORANGE,
          });
        });
      }

      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setCases(list);
    } catch (e) {
      console.warn('[support] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [me, role, colors.error, colors.warning]);

  // Reload whenever the page is shown (e.g. coming back from a dispute).
  useFocusEffect(
    useCallback(() => {
      loadCases();
    }, [loadCases]),
  );

  const sendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !me) return;
    setSending(true);
    try {
      const { error } = await supabase.from('notification_log').insert({
        user_id: me,
        title: 'Support request',
        body: trimmed,
        type: 'support',
        ref_id: null,
      });
      if (error) throw error;
      setMessage('');
      Keyboard.dismiss();
      Alert.alert('Message sent', 'Our support team will reply soon.');
      loadCases();
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const goToMessages = () => {
    if (role === 'provider') navigation.navigate('ProviderTabs', { screen: 'Messages' });
    else navigation.navigate('MainTabs', { screen: 'Messages' });
  };

  const handleCasePress = (c: SupportCase) => {
    if (c.kind === 'dispute') {
      navigation.navigate('DisputeDetail', { disputeId: c.id });
    } else if (c.kind === 'issue') {
      navigation.navigate('DisputeCenter', role === 'provider' ? { mode: 'provider' } : undefined);
    } else if (c.kind === 'delivery' && role === 'provider') {
      navigation.navigate('ProviderTabs', { screen: 'Task' });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Customer Service</Text>
          <Text style={styles.headerSub}>
            {role === 'provider' ? 'Provider help center' : 'We usually reply within a few minutes'}
          </Text>
        </View>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.body}
        contentContainerStyle={styles.scrollBody}
      >
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.quickRow}>
          <QuickAction
            styles={styles}
            icon="alert-circle-outline"
            label={role === 'provider' ? 'Report an issue' : 'Report a problem'}
            onPress={() => navigation.navigate('ReportIssue')}
          />
          <QuickAction
            styles={styles}
            icon="shield-checkmark-outline"
            label="Dispute center"
            onPress={() => navigation.navigate('DisputeCenter', role === 'provider' ? { mode: 'provider' } : undefined)}
          />
        </View>
        <View style={styles.quickRow}>
          <QuickAction
            styles={styles}
            icon="chatbubbles-outline"
            label="Messages"
            onPress={goToMessages}
          />
          <QuickAction
            styles={styles}
            icon="document-text-outline"
            label="Policies"
            onPress={() => navigation.navigate('LegalPolicies')}
          />
        </View>

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>YOUR CASES</Text>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={ORANGE} /></View>
        ) : cases.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-circle" size={22} color={colors.success} />
            <Text style={styles.emptyText}>No open cases — you're all set.</Text>
          </View>
        ) : (
          <View style={styles.caseList}>
            {cases.map((c, idx) => (
              <TouchableOpacity
                key={`${c.kind}-${c.id}`}
                style={[styles.caseRow, idx === cases.length - 1 && styles.caseRowLast]}
                onPress={() => handleCasePress(c)}
                activeOpacity={0.7}
              >
                <View style={[styles.caseDot, { backgroundColor: c.badge_color }]} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.caseTitle} numberOfLines={1}>{c.title}</Text>
                  <Text style={styles.caseSub} numberOfLines={1}>
                    {c.subtitle} · {c.status}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Composer pinned to the bottom */}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          style={styles.input}
          placeholder="Describe your concern…"
          placeholderTextColor={colors.textMuted}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!message.trim() || sending) && { opacity: 0.5 }]}
          onPress={sendMessage}
          disabled={!message.trim() || sending}
          activeOpacity={0.85}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="send" size={16} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const QuickAction = ({ icon, label, onPress, styles }: any) => (
  <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.8}>
    <View style={styles.quickIcon}>
      <Ionicons name={icon} size={18} color={ORANGE} />
    </View>
    <Text style={styles.quickLabel} numberOfLines={2}>{label}</Text>
  </TouchableOpacity>
);

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: c.card,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: c.divider,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: c.textSecondary, marginTop: 2, fontWeight: '500' },

  body: { flex: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 24 },

  sectionLabel: {
    fontSize: 10, fontWeight: '800', color: c.textMuted,
    letterSpacing: 1.2, marginBottom: 10,
  },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  quickCard: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.divider,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: isDark ? 0.3 : 0.03, shadowRadius: 4, elevation: 1,
  },
  quickIcon: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.accentSoft,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: ORANGE,
  },
  quickLabel: {
    flex: 1, fontSize: 13, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.2,
  },

  caseList: {
    backgroundColor: c.card, borderRadius: 16,
    borderWidth: 1, borderColor: c.divider, overflow: 'hidden',
  },
  caseRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 14, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  caseRowLast: { borderBottomWidth: 0 },
  caseDot: { width: 8, height: 8, borderRadius: 4 },
  caseTitle: { fontSize: 13.5, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },
  caseSub: { fontSize: 12, color: c.textSecondary, marginTop: 3, fontWeight: '500' },

  center: { paddingVertical: 24, alignItems: 'center' },
  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.successBg, borderWidth: 1, borderColor: c.success,
    borderRadius: 14, padding: 14,
  },
  emptyText: { flex: 1, fontSize: 13, color: c.success, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: c.card,
    borderTopWidth: 1, borderTopColor: c.border,
  },
  input: {
    flex: 1, backgroundColor: c.divider, borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
    minHeight: 44, maxHeight: 110, fontSize: 14,
    color: c.textPrimary, fontWeight: '500',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
});