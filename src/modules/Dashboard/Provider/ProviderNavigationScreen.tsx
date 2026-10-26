// src/modules/Dashboard/Provider/ProviderNavigationScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, StatusBar, ActivityIndicator, 
  Switch, Alert, Animated, PanResponder, Dimensions, ScrollView, Share, Linking
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NavigationMap, { NavInfo, NavStatus, NavigationMapHandle } from '../../../components/map/NavigationMap';
import { fmtDistance, fmtDuration } from '../../../components/map/directions';
import { supabase } from '../../../utils/supabase';
import { getProviderDeliveries } from '../../../services/matchingService';
import { setNavigationSession, clearNavigationSession } from '../../../services/navigationSessionStore';
import { useTheme, ThemeColors } from '../../../utils/themeContext';
import { BRAND_ORANGE, DROPOFF_BLACK } from '../../../utils/mapConfig';

const { height: SCREEN_H } = Dimensions.get('window');

// Panel heights for the resizable bottom sheet
const COLLAPSED_HEIGHT = 200; 
const EXPANDED_HEIGHT = SCREEN_H * 0.72; 
const SNAP_THRESHOLD = 100;

type Phase = 'loading' | 'ready' | 'not-found' | 'cancelled' | 'done' | 'no-coords' | 'error';
type Stage = 'pickup' | 'transit';
type Point = { lat: number; lng: number; main: string; sub: string };
type Order = { requestId: number | null; code: string; stage: Stage; target: Point; other: Point | null; note: string };

const TINT = '#FFF3EB';   // soft Pack-N-Ship orange

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        {phase === 'loading' ? (
          <ActivityIndicator size="large" color={BRAND_ORANGE} />
        ) : (
          <View style={styles.stateCard}>
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
    { icon: 'call', label: 'Call', onPress: handleCall },
    { icon: 'chatbubble-ellipses', label: 'Message', onPress: handleMessage },
    { icon: 'notifications', label: 'On my way', onPress: handlePing },
    { icon: 'share-social', label: 'Share ETA', onPress: handleShare },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

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
          activeOpacity={0.8}
        >
          <Ionicons name="locate" size={24} color={BRAND_ORANGE} />
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.iconBtnMap} 
          onPress={() => mapHandle.current?.overview()}
          activeOpacity={0.8}
        >
          <Ionicons name="scan" size={24} color={BRAND_ORANGE} />
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
              <Text style={styles.etaText}>
                {arrived ? 'Arrived' : fmtDuration(info.durationS)}
              </Text>
              <Text style={styles.etaLabel}>ETA</Text>
            </View>

            <View style={styles.statsRight}>
              <Text style={styles.distanceText}>
                {fmtDistance(info.distanceM)}
              </Text>
              <Text style={styles.distanceLabel}>Arriving {etaClock}</Text>
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
              <Ionicons name={isPickup ? 'cube' : 'home'} size={12} color="#fff" />
              <Text style={styles.destChipText}>{isPickup ? 'PICKUP' : 'DROP-OFF'}</Text>
            </View>
            <Text style={styles.orderCode}>#{order.code}</Text>
          </View>
          <Text style={styles.destTitle} numberOfLines={2}>{order.target.main}</Text>
          {!!order.target.sub && <Text style={styles.destAddress} numberOfLines={2}>{order.target.sub}</Text>}

          {!!order.note && (
            <View style={styles.noteBox}>
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={BRAND_ORANGE} />
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
                <View style={styles.quickCircle}><Ionicons name={q.icon as any} size={22} color={BRAND_ORANGE} /></View>
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
                <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? BRAND_ORANGE : '#C4C9D0'} />
                <Text style={[styles.checkText, on && styles.checkTextDone]}>{t}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.divider} />

          {/* settings */}
          <TouchableOpacity style={styles.listRow} onPress={() => mapHandle.current?.overview()}>
            <Ionicons name="map" size={22} color={BRAND_ORANGE} style={styles.listIcon} />
            <Text style={styles.listText}>Route overview</Text>
            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
          </TouchableOpacity>
          <View style={styles.listRow}>
            <Ionicons name="volume-high" size={22} color={BRAND_ORANGE} style={styles.listIcon} />
            <Text style={styles.listText}>Voice guidance</Text>
            <Switch value={voiceOn} onValueChange={setVoiceOn} trackColor={{ true: BRAND_ORANGE, false: '#D1D5DB' }} thumbColor="#fff" />
          </View>
          <View style={styles.listRow}>
            <Ionicons name="close-circle" size={22} color={BRAND_ORANGE} style={styles.listIcon} />
            <Text style={styles.listText}>Avoid tolls</Text>
            <Switch value={avoidTolls} onValueChange={setAvoidTolls} trackColor={{ true: BRAND_ORANGE, false: '#D1D5DB' }} thumbColor="#fff" />
          </View>
          <View style={styles.listRow}>
            <Ionicons name="pause-circle" size={22} color={BRAND_ORANGE} style={styles.listIcon} />
            <Text style={styles.listText}>Stop orders after this delivery</Text>
            <Switch value={stopAfter} onValueChange={setStopAfter} trackColor={{ true: BRAND_ORANGE, false: '#D1D5DB' }} thumbColor="#fff" />
          </View>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.listRow} onPress={handleReport}>
            <Ionicons name="flag" size={22} color={BRAND_ORANGE} style={styles.listIcon} />
            <Text style={styles.listText}>Report a problem</Text>
            <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.sosBtn} onPress={handleSOS} activeOpacity={0.85}>
            <Ionicons name="warning" size={20} color="#fff" />
            <Text style={styles.sosText}>Emergency SOS</Text>
          </TouchableOpacity>
        </ScrollView>

      </Animated.View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  // Floating Map Tools
  mapTools: {
    position: 'absolute',
    right: 16,
    top: '45%',
    gap: 12,
  },
  iconBtnMap: {
    width: 48, height: 48, borderRadius: 24, 
    backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, 
    shadowOpacity: 0.15, shadowRadius: 6, elevation: 5,
    borderWidth: 1, borderColor: '#E5E7EB',
  },

  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 0, borderTopRightRadius: 0,
    paddingHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 20,
  },
  
  panelHeader: {
    paddingTop: 10,
    paddingBottom: 4,
    borderTopLeftRadius: 0, borderTopRightRadius: 0,
  },
  dragHandleWrap: {
    alignItems: 'center',
    paddingVertical: 8,
    marginBottom: 8,
  },
  dragHandle: {
    width: 40, height: 4, backgroundColor: '#DDD', borderRadius: 2,
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
  
  etaText: { color: BRAND_ORANGE, fontSize: 28, fontWeight: '800', lineHeight: 32 },
  etaLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginTop: 2, letterSpacing: 0.5, textTransform: 'uppercase' },
  
  distanceText: { color: '#111827', fontSize: 22, fontWeight: '800', lineHeight: 32 },
  distanceLabel: { color: '#6B7280', fontSize: 13, fontWeight: '500', marginTop: 2 },

  exitBtn: {
    backgroundColor: '#111827',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24,
    marginLeft: 12,
  },
  exitText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  divider: { height: 1, backgroundColor: '#EEE', marginVertical: 14 },

  destChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  destChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: BRAND_ORANGE, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  destChipText: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  orderCode: { color: '#9CA3AF', fontSize: 12, fontWeight: '700' },
  destTitle: { color: '#111827', fontSize: 20, fontWeight: '800' },
  destAddress: { color: '#6B7280', fontSize: 14, marginTop: 2, lineHeight: 20 },
  noteBox: { flexDirection: 'row', gap: 10, backgroundColor: TINT, borderRadius: 14, padding: 12, marginTop: 12 },
  noteLabel: { color: BRAND_ORANGE, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  noteText: { color: '#111827', fontSize: 14, lineHeight: 20, marginTop: 2 },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  quickItem: { alignItems: 'center', flex: 1 },
  quickCircle: { width: 54, height: 54, borderRadius: 27, backgroundColor: TINT, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: '#374151', fontSize: 12, fontWeight: '700', marginTop: 6 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 6 },
  sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
  sectionCount: { color: BRAND_ORANGE, fontSize: 13, fontWeight: '800' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  checkText: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '500' },
  checkTextDone: { color: '#9CA3AF', textDecorationLine: 'line-through' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  listIcon: { marginRight: 14 },
  listText: { color: '#111827', fontSize: 15, fontWeight: '600', flex: 1 },
  sosBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#DC2626', borderRadius: 14, paddingVertical: 14, marginTop: 14 },
  sosText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  stateCard: { alignItems: 'center' },
  stateTitle: { color: '#000', fontSize: 18, marginBottom: 20 },
  btn: { backgroundColor: '#F0F0F0', padding: 16, borderRadius: 12 },
  btnText: { color: '#000', fontWeight: '700' },
});