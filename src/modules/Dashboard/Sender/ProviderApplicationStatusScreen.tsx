// src/modules/Dashboard/Sender/ProviderApplicationStatusScreen.tsx
// Shows a sender where their "become a provider" application stands, as a timeline.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar,
  ActivityIndicator, Animated, Easing, RefreshControl, BackHandler, Image, ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../../utils/supabase';
import { setLastMode } from '../../../utils/resolveHomeRoute';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

type AppStatus = 'pending' | 'approved' | 'rejected';
type StepState = 'done' | 'current' | 'upcoming' | 'error';

type Verification = {
  verification_id: number;
  verification_status: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
};

// ---- STATUS ARTWORK PLACEHOLDERS ------------------------------------------
// Put your own icons in the project, then replace `null` with a require(), e.g.
//   pending: require('../../../../assets/status/pending.png'),
// While a slot is null, a built-in icon is shown instead. Suggested size: 128x128 PNG.
const STATUS_ICONS: Record<AppStatus, ImageSourcePropType | null> = {
  pending: null,
  approved: null,
  rejected: null,
};

const normalize = (s: string | null | undefined): AppStatus => {
  const v = (s || '').toLowerCase();
  if (v === 'approved' || v === 'verified') return 'approved';
  if (v === 'rejected') return 'rejected';
  return 'pending';
};

const fmtWhen = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const fmtAgo = (iso: string | null) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return null;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
};

export default function ProviderApplicationStatusScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [verif, setVerif] = useState<Verification | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: u } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
      if (!u?.user_id) return;
      setUserId(u.user_id);
      const { data: v } = await supabase
        .from('provider_verifications')
        .select('verification_id, verification_status, rejection_reason, submitted_at')
        .eq('provider_id', u.user_id)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setVerif((v as Verification) ?? null);
    } catch (e) {
      console.warn('[application-status] load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Live update: the screen changes the moment an admin approves or rejects.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`app-status-${userId}-${Math.random().toString(36).slice(2, 8)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'provider_verifications', filter: `provider_id=eq.${userId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, load]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { navigation.goBack(); return true; });
    return () => sub.remove();
  }, [navigation]);

  const status: AppStatus = normalize(verif?.verification_status);
  const submittedAt = fmtWhen(verif?.submitted_at ?? null);
  const submittedAgo = fmtAgo(verif?.submitted_at ?? null);

  const steps: { key: string; title: string; sub: string; state: StepState }[] = verif ? [
    {
      key: 'submitted', state: 'done', title: 'Application submitted',
      sub: submittedAt ? `${submittedAt}${submittedAgo ? ` · ${submittedAgo}` : ''}` : 'We received your application.',
    },
    {
      key: 'docs', state: 'done', title: 'Documents received',
      sub: 'Your driver\u2019s license and vehicle documents are with our team.',
    },
    {
      key: 'review',
      state: status === 'pending' ? 'current' : 'done',
      title: 'Under review',
      sub: status === 'pending'
        ? 'An admin is checking your documents by hand to keep every delivery safe.'
        : 'Your documents were reviewed.',
    },
    status === 'approved'
      ? { key: 'decision', state: 'done', title: 'Approved', sub: 'You can now switch to Provider Mode and start posting routes.' }
      : status === 'rejected'
        ? {
            key: 'decision', state: 'error', title: 'Not approved',
            sub: verif.rejection_reason?.trim() || 'No specific reason was given. Please review your documents and apply again.',
          }
        : { key: 'decision', state: 'upcoming', title: 'Waiting for approval', sub: 'You will get a notification as soon as there is a decision.' },
  ] : [];

  const pill = status === 'approved'
    ? { label: 'Approved', fg: colors.success, bg: colors.successBg }
    : status === 'rejected'
      ? { label: 'Not approved', fg: colors.error, bg: colors.errorBg }
      : { label: 'Pending review', fg: colors.warning, bg: colors.warningBg };

  const goProvider = async () => {
    await setLastMode('provider');
    navigation.reset({ index: 0, routes: [{ name: 'ProviderTabs', params: { screen: 'Jobs' } }] });
  };

  const dotColor = (s: StepState) =>
    s === 'done' ? colors.success : s === 'current' ? colors.accent : s === 'error' ? colors.error : colors.border;

  return (
    <View style={styles.container}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) + 10 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Provider application</Text>
        <View style={{ width: 42 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : !verif ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No application yet</Text>
          <Text style={styles.emptyText}>Register as a provider to start earning by delivering packages.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('RegisterProvider')} activeOpacity={0.9}>
            <Text style={styles.primaryBtnText}>Register as a provider</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.accent} />}
        >
          <View style={styles.summary}>
            <View style={[styles.statusIconBox, { backgroundColor: pill.bg }]}>
              {STATUS_ICONS[status] ? (
                <Image source={STATUS_ICONS[status] as ImageSourcePropType} style={styles.statusIconImg} resizeMode="contain" />
              ) : (
                <SolarIcon
                  name={status === 'approved' ? 'CheckCircle' : status === 'rejected' ? 'CloseCircle' : 'Clock'}
                  variant="duotone" size={44} color={pill.fg}
                />
              )}
            </View>
            <View style={[styles.pill, { backgroundColor: pill.bg }]}>
              <Text style={[styles.pillText, { color: pill.fg }]}>{pill.label.toUpperCase()}</Text>
            </View>
            <Text style={styles.summaryTitle}>
              {status === 'approved' ? 'You\u2019re approved!' : status === 'rejected' ? 'Your application needs changes' : 'We\u2019re reviewing your application'}
            </Text>
            <Text style={styles.summaryText}>
              {status === 'approved'
                ? 'Welcome to the Pack-N-Ship provider community.'
                : status === 'rejected'
                  ? 'See the reason below, then apply again with updated documents.'
                  : 'You don\u2019t need to do anything. We\u2019ll notify you when it\u2019s done. Pull down to refresh.'}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>PROGRESS</Text>
          <View style={styles.timelineCard}>
            {steps.map((st, i) => {
              const last = i === steps.length - 1;
              const c = dotColor(st.state);
              return (
                <View key={st.key} style={styles.stepRow}>
                  <View style={styles.rail}>
                    <View style={styles.dotWrap}>
                      {st.state === 'current' && (
                        <Animated.View style={[styles.halo, { backgroundColor: c, transform: [{ scale: haloScale }], opacity: haloOpacity }]} />
                      )}
                      <View style={[
                        styles.dot,
                        st.state === 'upcoming' ? { backgroundColor: colors.card, borderColor: c } : { backgroundColor: c, borderColor: c },
                      ]}>
                        {st.state === 'done' && <SolarIcon name="Check" variant="bold" size={12} color="#FFFFFF" />}
                        {st.state === 'error' && <SolarIcon name="CloseCircle" variant="bold" size={12} color="#FFFFFF" />}
                        {st.state === 'current' && <View style={styles.dotCore} />}
                      </View>
                    </View>
                    {!last && <View style={[styles.line, (st.state === 'done') && { backgroundColor: colors.success }]} />}
                  </View>
                  <View style={[styles.stepBody, last && { paddingBottom: 0 }]}>
                    <Text style={[styles.stepTitle, st.state === 'upcoming' && { color: colors.textMuted }, st.state === 'error' && { color: colors.error }]}>
                      {st.title}
                    </Text>
                    <Text style={styles.stepSub}>{st.sub}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {status === 'approved' && (
            <TouchableOpacity style={styles.primaryBtn} onPress={goProvider} activeOpacity={0.9}>
              <Text style={styles.primaryBtnText}>Switch to Provider Mode</Text>
            </TouchableOpacity>
          )}
          {status === 'rejected' && (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('RegisterProvider')} activeOpacity={0.9}>
              <Text style={styles.primaryBtnText}>Apply again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.helpLink} onPress={() => navigation.navigate('Support', { role: 'sender' })} activeOpacity={0.8}>
            <SolarIcon name="HeadphonesRound" variant="duotone" size={16} color={colors.accent} />
            <Text style={styles.helpLinkText}>Questions about your application? Contact support</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 14,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  headerTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  emptyText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: 12 },

  content: { paddingHorizontal: 20, paddingTop: 6 },

  summary: {
    backgroundColor: c.card, borderRadius: 16, padding: 20, marginBottom: 24, alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  statusIconBox: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  statusIconImg: { width: 56, height: 56 },
  pill: { alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginBottom: 12 },
  pillText: { fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 1 },
  summaryTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2, textAlign: 'center' },
  summaryText: { fontSize: 14, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 21, marginTop: 6, textAlign: 'center' },

  sectionLabel: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 1, marginBottom: 10, paddingHorizontal: 4 },
  timelineCard: {
    backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 18,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  stepRow: { flexDirection: 'row' },
  rail: { width: 28, alignItems: 'center' },
  dotWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 26, height: 26, borderRadius: 13 },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  line: { flex: 1, width: 3, backgroundColor: c.border, marginVertical: 2, borderRadius: 2 },
  stepBody: { flex: 1, paddingLeft: 12, paddingBottom: 24 },
  stepTitle: { fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary },
  stepSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, lineHeight: 19, marginTop: 2 },

  primaryBtn: {
    marginTop: 22, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
    alignSelf: 'stretch',
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Poppins_700Bold' },
  helpLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 20 },
  helpLinkText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent },
});
