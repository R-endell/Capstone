// src/modules/Dashboard/Provider/ProviderNavigationScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator, 
  Switch, Alert, Animated, PanResponder, Dimensions, ScrollView, Share, Linking
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NavigationMap, { NavInfo, NavStatus, NavigationMapHandle } from '../../../components/map/NavigationMap';
import { fmtDistance, fmtDuration } from '../../../components/map/directions';
import { supabase } from '../../../utils/supabase';
import { getProviderDeliveries } from '../../../services/matchingService';
import { setNavigationSession, clearNavigationSession } from '../../../services/navigationSessionStore';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { SolarIcon } from '../../../components/ui/SolarIcon';

const { height: SCREEN_H } = Dimensions.get('window');

// Panel heights for the resizable bottom sheet
const COLLAPSED_HEIGHT = 200; 
const EXPANDED_HEIGHT = SCREEN_H * 0.72; 
const SNAP_THRESHOLD = 100;

type Phase = 'loading' | 'ready' | 'not-found' | 'cancelled' | 'done' | 'no-coords' | 'error';
type Stage = 'pickup' | 'transit';
type Point = { lat: number; lng: number; main: string; sub: string };
type Order = { requestId: number | null; code: string; stage: Stage; target: Point; other: Point | null; note: string };

const trackingCode = (id: any) => `PNS-${String(id).padStart(4, '0')}`;

const splitAddress = (full?: string | null) => {
  if (!full) return { main: 'Selected location', sub: '' };
  const parts = full.split(', ');
  return { main: parts[0], sub: parts.slice(1).join(', ') };
};

const toPoint = (loc: any): Point | null => {
  const lat = Number(loc?.latitude);
  const lng = Number(loc?.longitude);
  if (loc?.latitude == null || loc?.longitude == null || !isFinite(lat) || !isFinite(lng)) return null;
  return { lat, lng, ...splitAddress(loc?.street_address) };
};

export default function ProviderNavigationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const deliveryId: number | null = route.params?.deliveryId != null ? Number(route.params.deliveryId) : null;

  const [phase, setPhase] = useState<Phase>('loading');
  const [order, setOrder] = useState<Order | null>(null);
  const [info, setInfo] = useState<NavInfo>({ distanceM: null, durationS: null });
  const [status, setStatus] = useState<NavStatus>('locating');
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [voiceOn, setVoiceOn] = useState(true);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [stopAfter, setStopAfter] = useState(false);
  const mapHandle = useRef<NavigationMapHandle>(null);
  const readyRef = useRef(false);
  const aliveRef = useRef(true);

  // --- Bottom Panel Drag Logic ---
  const panAnim = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const currentHeight = useRef(COLLAPSED_HEIGHT);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const newHeight = currentHeight.current - gestureState.dy;
        if (newHeight >= COLLAPSED_HEIGHT - 20 && newHeight <= EXPANDED_HEIGHT + 50) {
          panAnim.setValue(newHeight);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const newHeight = currentHeight.current - gestureState.dy;
        let snapTo = COLLAPSED_HEIGHT;

        if (newHeight > COLLAPSED_HEIGHT + SNAP_THRESHOLD) {
          snapTo = EXPANDED_HEIGHT;
        }
        
        currentHeight.current = snapTo;
        Animated.spring(panAnim, {
          toValue: snapTo,
          useNativeDriver: false,
          bounciness: 4,
        }).start();
      },
    })
  ).current;

  const togglePanel = () => {
    const snapTo = currentHeight.current === COLLAPSED_HEIGHT ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
    currentHeight.current = snapTo;
    Animated.spring(panAnim, {
      toValue: snapTo,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  };

  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);

  const loadOrder = useCallback(async () => {
    if (deliveryId == null || !isFinite(deliveryId)) { setPhase('not-found'); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (aliveRef.current) setPhase('not-found'); return; }

      const { data: me, error: meErr } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
      if (meErr || !me) throw meErr || new Error('No profile');

      const list: any[] = (await getProviderDeliveries(me.user_id)) || [];
      const d = list.find(x => Number(x?.delivery_id) === deliveryId);
      if (!aliveRef.current) return;
      
      if (!d) {
        setOrder(null); setPhase('not-found'); readyRef.current = false;
        return;
      }

      const req = d.delivery_requests || {};
      const reqStatus = String(req.delivery_status || '').toLowerCase();
      if (reqStatus === 'cancelled' || reqStatus === 'canceled' || d.completed_at) {
        setPhase(d.completed_at ? 'done' : 'cancelled'); readyRef.current = false; return;
      }

      const stage: Stage = reqStatus === 'in transit' ? 'transit' : 'pickup';
      const pickup = toPoint(req.pickup_location);
      const dropoff = toPoint(req.dropoff_location);
      const target = stage === 'pickup' ? pickup : dropoff;
      
      if (!target) { setOrder(null); setPhase('no-coords'); readyRef.current = false; return; }

      setOrder({
        requestId: d.request_id != null ? Number(d.request_id) : null,
        code: trackingCode(d.request_id ?? d.delivery_id),
        stage,
        target,
        other: stage === 'pickup' ? dropoff : pickup,
        note: String((stage === 'pickup' ? req.pickup_note : req.dropoff_note) || '').trim(),
      });
      setPhase('ready');
      readyRef.current = true;
    } catch (e) {
      if (aliveRef.current && !readyRef.current) setPhase('error');
    }
  }, [deliveryId]);

  useEffect(() => { void loadOrder(); }, [loadOrder]);

  const requestId = order?.requestId ?? null;
  useEffect(() => {
    if (deliveryId == null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadOrder(); }, 400);
    };
    let ch = supabase
      .channel(`provider-nav-${deliveryId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qr_verifications', filter: `delivery_id=eq.${deliveryId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries', filter: `delivery_id=eq.${deliveryId}` }, refresh);
    if (requestId != null) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_requests', filter: `request_id=eq.${requestId}` }, refresh);
    }
    ch.subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, [deliveryId, requestId, loadOrder]);

  const stageNow = order?.stage ?? null;
  useEffect(() => {
    if (deliveryId == null || phase !== 'ready' || stageNow !== 'pickup') return;
    setNavigationSession(deliveryId);
    return () => clearNavigationSession(deliveryId);
  }, [deliveryId, phase, stageNow]);

  const etaClock = info.durationS != null
    ? new Date(Date.now() + info.durationS * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—';

  const close = () => navigation.goBack();

  if (phase !== 'ready' || !order) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar barStyle={colors.statusBarStyle} translucent backgroundColor="transparent" />
        {phase === 'loading' ? (
          <ActivityIndicator size="large" color={colors.accent} />
        ) : (
          <View style={styles.stateCard}>
            <SolarIcon name="DangerCircle" variant="duotone" size={40} color={colors.warning} style={{ marginBottom: 12 }} />
            <Text style={styles.stateTitle}>Navigation unavailable</Text>
            <TouchableOpacity style={styles.btn} onPress={close}>
              <Text style={styles.btnText}>Go back</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  const isPickup = order.stage === 'pickup';
  const arrived = status === 'arrived';

  const who = isPickup ? 'sender' : 'receiver';
  const checklist = isPickup
    ? ['Package matches the description', 'Packed securely / sealed', 'Take a photo of the package', 'Ask the sender for their QR or 4-digit PIN']
    : ['Confirm the receiver’s name', 'Hand over the package carefully', 'Take a photo at hand-over', 'Ask for the 6-digit OTP'];
  const doneCount = checklist.filter((_, i) => checks[`${order.stage}:${i}`]).length;

  const handleCall = () => Alert.alert(`Call ${who}`, 'Demo: this will dial the ' + who + '’s number.');
  const handleMessage = () => Alert.alert(`Message ${who}`, 'Demo: opens the in-app chat with the ' + who + '.');
  const handlePing = () => Alert.alert('On my way', `Demo: the ${who} gets a notification that you are on your way (${etaClock}).`);
  const handleShare = () => {
    Share.share({ message: `Pack-N-Ship ${order.code} — arriving ${etaClock} (${fmtDuration(info.durationS)} away).` }).catch(() => {});
  };
  const handleReport = () => {
    const sent = (what: string) => Alert.alert('Report sent', `Demo: “${what}” was reported to Pack-N-Ship support.`);
    Alert.alert('Report a problem', 'What happened?', [
      { text: `Can’t reach the ${who}`, onPress: () => sent(`Can’t reach the ${who}`) },
      { text: 'Wrong or unclear address', onPress: () => sent('Wrong or unclear address') },
      { text: 'Package damaged / not as described', onPress: () => sent('Package damaged / not as described') },
      { text: 'Vehicle problem', onPress: () => sent('Vehicle problem') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const handleSOS = () => {
    Alert.alert('Emergency', 'Call emergency services (911)?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Call 911', style: 'destructive', onPress: () => Linking.openURL('tel:911').catch(() => {}) },
    ]);
  };

  const quick = [
    { icon: 'Phone', label: 'Call', onPress: handleCall },
    { icon: 'ChatCircleText', label: 'Message', onPress: handleMessage },
    { icon: 'Bell', label: 'On my way', onPress: handlePing },
    { icon: 'PaperPlane', label: 'Share ETA', onPress: handleShare },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <NavigationMap
        ref={mapHandle}
        target={{ latitude: order.target.lat, longitude: order.target.lng }}
        targetLabel={isPickup ? 'P' : 'D'}
        secondary={order.other ? { coordinate: { latitude: order.other.lat, longitude: order.other.lng }, label: isPickup ? 'D' : 'P' } : null}
        interactive
        onInfo={setInfo}
        onStatusChange={setStatus}
        style={{ bottom: 0 }}
        bannerTop={insets.top}
        padTop={0}
        padBottom={24}
        controlsBottom={260}
      />

      {/* Floating Map Tools */}
      <View style={styles.mapTools}>
        <TouchableOpacity 
          style={styles.iconBtnMap} 
          onPress={() => mapHandle.current?.recenter()}
          activeOpacity={0.85}
        >
          <SolarIcon name="MapPoint" variant="linear" size={24} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.iconBtnMap} 
          onPress={() => mapHandle.current?.overview()}
          activeOpacity={0.85}
        >
          <SolarIcon name="Maximize" variant="linear" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {/* Animated Resizable Bottom Panel */}
      <Animated.View style={[styles.bottomPanel, { height: panAnim }]}>
        
        {/* Draggable Header Area */}
        <View {...panResponder.panHandlers} style={styles.panelHeader}>
          <TouchableOpacity activeOpacity={1} onPress={togglePanel} style={styles.dragHandleWrap}>
            <View style={styles.dragHandle} />
          </TouchableOpacity>

          {/* Balanced Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statsLeft}>
              <Text style={styles.etaText} maxFontSizeMultiplier={1.15} numberOfLines={1}>
                {arrived ? 'Arrived' : fmtDuration(info.durationS)}
              </Text>
              <Text style={styles.etaLabel} maxFontSizeMultiplier={1.15}>ETA</Text>
            </View>

            <View style={styles.statsRight}>
              <Text style={styles.distanceText} maxFontSizeMultiplier={1.15} numberOfLines={1}>
                {fmtDistance(info.distanceM)}
              </Text>
              <Text style={styles.distanceLabel} maxFontSizeMultiplier={1.15} numberOfLines={1}>Arriving {etaClock}</Text>
            </View>

            <TouchableOpacity style={styles.exitBtn} onPress={close} activeOpacity={0.8}>
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}>
          {/* destination */}
          <View style={styles.destChipRow}>
            <View style={styles.destChip}>
              <SolarIcon name={isPickup ? 'Package' : 'Home'} variant="duotone" size={12} color="#FFFFFF" />
              <Text style={styles.destChipText}>{isPickup ? 'PICKUP' : 'DROP-OFF'}</Text>
            </View>
            <Text style={styles.orderCode}>#{order.code}</Text>
          </View>
          <Text style={styles.destTitle} numberOfLines={2}>{order.target.main}</Text>
          {!!order.target.sub && <Text style={styles.destAddress} numberOfLines={2}>{order.target.sub}</Text>}

          {!!order.note && (
            <View style={styles.noteBox}>
              <SolarIcon name="ChatCircleText" variant="duotone" size={16} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.noteLabel}>NOTE FROM {who.toUpperCase()}</Text>
                <Text style={styles.noteText}>{order.note}</Text>
              </View>
            </View>
          )}

          {/* quick actions */}
          <View style={styles.quickRow}>
            {quick.map(q => (
              <TouchableOpacity key={q.label} style={styles.quickItem} onPress={q.onPress} activeOpacity={0.8}>
                <View style={styles.quickCircle}>
                  <SolarIcon name={q.icon as any} variant="linear" size={22} color={colors.accent} />
                </View>
                <Text style={styles.quickLabel}>{q.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* checklist */}
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{isPickup ? 'Pickup checklist' : 'Delivery checklist'}</Text>
            <Text style={styles.sectionCount}>{doneCount}/{checklist.length}</Text>
          </View>
          {checklist.map((t, i) => {
            const k = `${order.stage}:${i}`;
            const on = !!checks[k];
            return (
              <TouchableOpacity key={k} style={styles.checkRow} activeOpacity={0.7} onPress={() => setChecks(p => ({ ...p, [k]: !p[k] }))}>
                <SolarIcon 
                  name="CheckCircle" 
                  variant={on ? 'duotone' : 'linear'}
                  size={24} 
                  color={on ? colors.accent : colors.textMuted} 
                />
                <Text style={[styles.checkText, on && styles.checkTextDone]}>{t}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.divider} />

          {/* settings */}
          <TouchableOpacity style={styles.listRow} onPress={() => mapHandle.current?.overview()}>
            <SolarIcon name="Map" variant="linear" size={22} color={colors.accent} style={styles.listIcon} />
            <Text style={styles.listText}>Route overview</Text>
            <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.listRow}>
            <SolarIcon name="VolumeHigh" variant="linear" size={22} color={colors.accent} style={styles.listIcon} />
            <Text style={styles.listText}>Voice guidance</Text>
            <Switch value={voiceOn} onValueChange={setVoiceOn} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
          </View>
          <View style={styles.listRow}>
            <SolarIcon name="CloseCircle" variant="linear" size={22} color={colors.accent} style={styles.listIcon} />
            <Text style={styles.listText}>Avoid tolls</Text>
            <Switch value={avoidTolls} onValueChange={setAvoidTolls} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
          </View>
          <View style={styles.listRow}>
            <SolarIcon name="Hourglass" variant="linear" size={22} color={colors.accent} style={styles.listIcon} />
            <Text style={styles.listText}>Stop orders after this delivery</Text>
            <Switch value={stopAfter} onValueChange={setStopAfter} trackColor={{ true: colors.accent, false: colors.border }} thumbColor="#fff" />
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.listRow} onPress={handleReport}>
            <SolarIcon name="Flag" variant="linear" size={22} color={colors.accent} style={styles.listIcon} />
            <Text style={styles.listText}>Report a problem</Text>
            <SolarIcon name="AltArrowRight" variant="linear" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sosBtn} onPress={handleSOS} activeOpacity={0.85}>
            <SolarIcon name="ShieldWarning" variant="linear" size={20} color="#FFFFFF" />
            <Text style={styles.sosText}>Emergency SOS</Text>
          </TouchableOpacity>
        </ScrollView>

      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  // Floating Map Tools — Atome-flat shadow (was elevation: 5 / opacity: 0.15–0.4)
  mapTools: {
    position: 'absolute',
    right: 16,
    top: '45%',
    gap: 12,
  },
  iconBtnMap: {
    width: 48, height: 48, borderRadius: 14, 
    backgroundColor: c.card,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, 
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },

  // Resizable Bottom Panel — Atome-flat shadow + 1px top border for legibility on map
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: c.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: isDark ? 0.05 : 0.04, shadowRadius: 12, elevation: 1,
  },
  
  panelHeader: {
    paddingTop: 10,
    paddingBottom: 4,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
  },
  dragHandleWrap: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  dragHandle: {
    width: 40, height: 4, backgroundColor: c.border, borderRadius: 2,
  },
  
  // Balanced Stats Layout
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  statsLeft: { 
    flexDirection: 'column', flex: 1, alignItems: 'flex-start' 
  },
  statsRight: { 
    flexDirection: 'column', flex: 1, alignItems: 'flex-start', marginLeft: 20
  },
  
  // Type scale (Poppins): every style has an explicit lineHeight (~1.35x) so Android never clips
  // Poppins' tall ascenders/descenders, and ExtraBold (800) is gone - at small sizes it smeared.
  etaText: { color: c.accent, fontSize: 26, lineHeight: 34, fontFamily: 'Poppins_700Bold' },
  etaLabel: { color: c.textMuted, fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.5, textTransform: 'uppercase' },

  // Same size + lineHeight as etaText so the two columns share one baseline.
  distanceText: { color: c.textPrimary, fontSize: 26, lineHeight: 34, fontFamily: 'Poppins_700Bold' },
  distanceLabel: { color: c.textSecondary, fontSize: 13, lineHeight: 18, fontFamily: 'Poppins_500Medium' },

  exitBtn: {
    backgroundColor: c.textPrimary,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14,
    marginLeft: 12,
  },
  exitText: { color: c.card, fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_600SemiBold' },

  divider: { height: 1, backgroundColor: c.divider, marginVertical: 14 },

  destChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  destChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  destChipText: { color: '#FFFFFF', fontSize: 11, lineHeight: 16, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.6 },
  orderCode: { color: c.textMuted, fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold' },
  destTitle: { color: c.textPrimary, fontSize: 20, lineHeight: 28, fontFamily: 'Poppins_700Bold' },
  destAddress: { color: c.textSecondary, fontSize: 14, fontFamily: 'Poppins_400Regular', marginTop: 2, lineHeight: 20 },
  noteBox: { flexDirection: 'row', gap: 10, backgroundColor: c.accentSoft, borderRadius: 12, padding: 12, marginTop: 12 },
  noteLabel: { color: c.accent, fontSize: 11, lineHeight: 16, fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.6 },
  noteText: { color: c.textPrimary, fontSize: 14, lineHeight: 20, fontFamily: 'Poppins_400Regular', marginTop: 2 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  quickItem: { alignItems: 'center', flex: 1 },
  quickCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: c.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: 'Poppins_600SemiBold', marginTop: 6, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 },
  sectionTitle: { color: c.textPrimary, fontSize: 16, lineHeight: 24, fontFamily: 'Poppins_700Bold' },
  sectionCount: { color: c.accent, fontSize: 13, lineHeight: 18, fontFamily: 'Poppins_600SemiBold' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  checkText: { flex: 1, color: c.textPrimary, fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_500Medium' },
  checkTextDone: { color: c.textMuted, textDecorationLine: 'line-through' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  listIcon: { marginRight: 14 },
  listText: { color: c.textPrimary, fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_500Medium', flex: 1 },
  sosBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.error, borderRadius: 14, paddingVertical: 14, marginTop: 14 },
  sosText: { color: '#FFFFFF', fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_600SemiBold' },

  stateCard: { alignItems: 'center' },
  stateTitle: { color: c.textPrimary, fontSize: 18, lineHeight: 26, fontFamily: 'Poppins_700Bold', marginBottom: 20 },
  btn: { backgroundColor: c.divider, padding: 16, borderRadius: 14 },
  btnText: { color: c.textPrimary, fontSize: 15, lineHeight: 22, fontFamily: 'Poppins_600SemiBold' },
});