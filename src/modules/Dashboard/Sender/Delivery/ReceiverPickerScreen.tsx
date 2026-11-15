// src/modules/Dashboard/Sender/Delivery/ReceiverPickerScreen.tsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Alert, Platform, Modal, ScrollView, StatusBar,
  Animated, PanResponder, Keyboard, Easing, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { SolarIcon } from '../../../../components/ui/SolarIcon';

/** Normalize PH phone number to E.164 (+63XXXXXXXXXX) */
const toE164 = (raw: string): string => {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '63' + digits.slice(1);
  else if (digits.startsWith('9') && digits.length === 10) digits = '63' + digits;
  else if (!digits.startsWith('63') && digits.length === 10) digits = '63' + digits;
  return '+' + digits;
};

type Row =
  | { type: 'header'; key: string; label: string; count?: number }
  | { type: 'receiver'; key: string; data: any };

export default function ReceiverPickerScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [receivers, setReceivers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');

  const selectedId = route.params?.selectedReceiverId || null;

  // ---- draggable add-receiver sheet ----
  const { height: winH } = useWindowDimensions();
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetRef = useRef<View>(null);
  const kbShiftRef = useRef(0);
  const [kbShift, setKbShift] = useState(0);
  const [kbH, setKbH] = useState(0);

  const closeSheet = useCallback(() => {
    Keyboard.dismiss();
    Animated.timing(dragY, { toValue: winH, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(() => { setShowAddModal(false); dragY.setValue(0); });
  }, [dragY, winH]);

  const openSheet = useCallback(() => {
    dragY.setValue(winH);
    setShowAddModal(true);
  }, [dragY, winH]);

  useEffect(() => {
    if (showAddModal) {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 16 }).start();
    }
  }, [showAddModal, dragY]);

  // lift the sheet exactly as far as the keyboard covers it (works with or without window resizing)
  useEffect(() => {
    if (!showAddModal) { kbShiftRef.current = 0; setKbShift(0); setKbH(0); return; }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    let timer: any;
    const onShow = (e: any) => {
      const h = e?.endCoordinates?.height ?? 0;
      const kbTop = e?.endCoordinates?.screenY ?? (winH - h);
      setKbH(h);
      clearTimeout(timer);
      timer = setTimeout(() => {
        sheetRef.current?.measureInWindow((_x, y, _w, hh) => {
          const overlap = y + hh - kbTop + 8;
          const next = Math.max(0, kbShiftRef.current + overlap);
          kbShiftRef.current = next;
          setKbShift(next);
        });
      }, 120);
    };
    const onHide = () => { clearTimeout(timer); kbShiftRef.current = 0; setKbShift(0); setKbH(0); };
    const a = Keyboard.addListener(showEvt, onShow);
    const b = Keyboard.addListener(hideEvt, onHide);
    return () => { clearTimeout(timer); a.remove(); b.remove(); };
  }, [showAddModal, winH]);

  // dragging the handle / title area pulls the sheet down; release past the threshold closes it
  const closeRef = useRef(closeSheet);
  closeRef.current = closeSheet;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { Keyboard.dismiss(); dragY.stopAnimation(); },
    onPanResponderMove: (_e, g) => { dragY.setValue(Math.max(0, g.dy)); },
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 110 || g.vy > 0.8) closeRef.current();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
    },
  })).current;
  const backdropOpacity = dragY.interpolate({ inputRange: [0, winH * 0.6], outputRange: [1, 0], extrapolate: 'clamp' });

  const fetchUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .maybeSingle();
    return data?.user_id || null;
  };

  const fetchReceivers = async (uid: number) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('receivers')
        .select('*')
        .eq('sender_id', uid)
        .order('is_favorite', { ascending: false })
        .order('receiver_name', { ascending: true });
      if (error) throw error;
      setReceivers(data || []);
    } catch (e: any) {
      console.error('Fetch receivers error:', e);
      Alert.alert('Error', 'Failed to load receivers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      const uid = await fetchUser();
      setUserId(uid);
      if (uid) {
        await fetchReceivers(uid);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  const handlePick = (receiver: any) => {
    navigation.navigate('Booking', { pickedReceiver: receiver }, { merge: true });
  };

  const handleDeleteReceiver = (receiverId: number, receiverName: string) => {
    Alert.alert(
      'Delete Receiver',
      `Are you sure you want to remove ${receiverName} from your saved receivers?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('receivers')
                .delete()
                .eq('receiver_id', receiverId);

              if (error) throw error;
              setReceivers(prev => prev.filter(r => r.receiver_id !== receiverId));
            } catch (e: any) {
              console.error('Delete receiver error:', e);
              Alert.alert('Error', 'Failed to delete receiver.');
            }
          },
        },
      ]
    );
  };

  const canAdd =
    !!userId &&
    !saving &&
    newName.trim().length > 0 &&
    newPhone.trim().length > 0;

  const handleAddNew = async () => {
    if (!newName.trim()) return Alert.alert('Required', 'Please enter the receiver name.');
    if (!newPhone.trim()) return Alert.alert('Required', 'Please enter the receiver phone.');

    if (!userId) {
      Alert.alert('Please wait', 'Still loading your account. Try again in a moment.');
      return;
    }

    try {
      setSaving(true);

      const e164Phone = toE164(newPhone.trim());

      const { data, error } = await supabase
        .from('receivers')
        .insert({
          sender_id: userId,
          receiver_name: newName.trim(),
          receiver_phone: e164Phone,
          receiver_email: newEmail.trim() || null,
          is_favorite: false,
        })
        .select('*')
        .single();

      if (error) throw error;

      Keyboard.dismiss();
      setShowAddModal(false);
      dragY.setValue(0);
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      if (userId) fetchReceivers(userId);
      if (data) handlePick(data);
    } catch (e: any) {
      console.error('Add receiver error:', e);
      Alert.alert('Error', e.message || 'Failed to add receiver.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return receivers;
    const q = search.toLowerCase();
    return receivers.filter(r =>
      (r.receiver_name || '').toLowerCase().includes(q) ||
      (r.receiver_phone || '').toLowerCase().includes(q)
    );
  }, [receivers, search]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (search.trim()) {
      filtered.forEach(r => out.push({ type: 'receiver', key: `r-${r.receiver_id}`, data: r }));
      return out;
    }
    const favs = filtered.filter(r => r.is_favorite);
    const others = filtered.filter(r => !r.is_favorite);
    if (favs.length > 0) {
      out.push({ type: 'header', key: 'h-fav', label: 'FAVORITES', count: favs.length });
      favs.forEach(r => out.push({ type: 'receiver', key: `r-${r.receiver_id}`, data: r }));
      if (others.length > 0) {
        out.push({ type: 'header', key: 'h-all', label: 'ALL RECEIVERS', count: others.length });
        others.forEach(r => out.push({ type: 'receiver', key: `r-${r.receiver_id}`, data: r }));
      }
    } else {
      out.push({ type: 'header', key: 'h-all', label: 'SAVED RECEIVERS', count: others.length });
      others.forEach(r => out.push({ type: 'receiver', key: `r-${r.receiver_id}`, data: r }));
    }
    return out;
  }, [filtered, search]);

  const renderItem = useCallback(({ item: row }: { item: Row }) => {
    if (row.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>{row.label}</Text>
          {row.count != null && <Text style={styles.sectionCount}>{row.count}</Text>}
        </View>
      );
    }

    const item = row.data;
    const isSelected = item.receiver_id === selectedId;
    const subLine = [item.receiver_phone, item.receiver_email].filter(Boolean).join('  ·  ');
    return (
      <View style={[styles.row, isSelected && styles.rowSelected]}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={() => handlePick(item)}
          activeOpacity={0.7}
        >
          <View style={styles.rowIconCol}>
            <View style={[styles.avatar, isSelected && styles.avatarSelected]}>
              <Text style={[styles.avatarText, isSelected && { color: '#FFFFFF' }]}>
                {(item.receiver_name || '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
          <View style={styles.rowText}>
            <View style={styles.nameRow}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.receiver_name}</Text>
              {item.is_favorite && (
                <SolarIcon name="Star" variant="boldDuotone" size={13} color={colors.warning} style={{ marginLeft: 6 }} />
              )}
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>{subLine || '—'}</Text>
          </View>
          {isSelected && (
            <SolarIcon name="CheckCircle" variant="duotone" size={22} color={colors.accent} style={{ marginRight: 4 }} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteReceiver(item.receiver_id, item.receiver_name)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <SolarIcon name="Trash" variant="linear" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  }, [selectedId, colors, styles]);

  const renderAddRow = () => (
    <TouchableOpacity style={[styles.row, styles.addRow]} activeOpacity={0.85} onPress={() => openSheet()}>
      <View style={styles.rowMain}>
        <View style={styles.rowIconCol}>
          <View style={[styles.avatar, { backgroundColor: colors.accent, borderColor: colors.accent }]}>
            <SolarIcon name="Plus" variant="bold" size={18} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Add new receiver</Text>
          <Text style={styles.rowSub} numberOfLines={1}>Save someone you send parcels to</Text>
        </View>
        <SolarIcon name="Plus" variant="bold" size={22} color={colors.accent} style={{ marginRight: 14 }} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.searchWrap}>
          <SolarIcon name="Magnifier" variant="linear" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search receiver name or phone"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={10}>
              <SolarIcon name="CloseCircle" variant="linear" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={styles.screenTitle}>Who is receiving this?</Text>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading receivers...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIconBox}>
            <SolarIcon 
              name={receivers.length === 0 ? 'UsersGroup' : 'Magnifier'} 
              variant="duotone" 
              size={36} 
              color={colors.accent} 
            />
          </View>
          <Text style={styles.emptyTitle}>
            {receivers.length === 0 ? 'No receivers yet' : 'No matches'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {receivers.length === 0
              ? 'Add your first receiver to start booking deliveries.'
              : 'Try a different name or phone number.'}
          </Text>
          {receivers.length === 0 && (
            <TouchableOpacity style={styles.emptyCta} onPress={() => openSheet()} activeOpacity={0.9}>
              <Text style={styles.emptyCtaText}>Add new receiver</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderItem}
          ListHeaderComponent={search.trim() ? null : renderAddRow()}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* ===================== ADD RECEIVER SHEET ===================== */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeSheet}
      >
        <View style={styles.modalOverlay}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeSheet} />
          </Animated.View>

          <Animated.View
            ref={sheetRef as any}
            collapsable={false}
            style={[
              styles.sheet,
              {
                paddingBottom: kbH > 0 ? 12 : Math.max(insets.bottom, 12),
                marginBottom: kbShift,
                maxHeight: kbH > 0 ? Math.max(260, winH - kbH - insets.top - 16) : winH * 0.88,
                transform: [{ translateY: dragY }],
              },
            ]}
          >
            <View {...pan.panHandlers}>
              <View style={styles.dragHandleHit}><View style={styles.dragHandle} /></View>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Add new receiver</Text>
                <TouchableOpacity onPress={closeSheet} hitSlop={10}>
                  <SolarIcon name="CloseCircle" variant="linear" size={24} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              overScrollMode="never"
              nestedScrollEnabled
            >
              <View style={styles.fieldRow}>
                <SolarIcon name="User" variant="linear" size={22} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>RECEIVER NAME</Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="Full name"
                    placeholderTextColor={colors.textMuted}
                    value={newName}
                    onChangeText={setNewName}
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <SolarIcon name="Phone" variant="linear" size={22} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="e.g. 0917 123 4567"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="phone-pad"
                    value={newPhone}
                    onChangeText={setNewPhone}
                  />
                  <Text style={styles.fieldHint}>Auto-formatted to +63 for dispatch notifications</Text>
                </View>
              </View>

              <View style={[styles.fieldRow, { borderBottomWidth: 0 }]}>
                <SolarIcon name="Letter" variant="linear" size={22} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>EMAIL (OPTIONAL)</Text>
                  <TextInput
                    style={styles.fieldInput}
                    placeholder="receiver@email.com"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={newEmail}
                    onChangeText={setNewEmail}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.confirmBtn, !canAdd && styles.confirmBtnDisabled]}
                onPress={handleAddNew}
                disabled={!canAdd}
                activeOpacity={0.9}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.confirmBtnText}>
                    {!userId ? 'Loading account…' : 'Save & select'}
                  </Text>
                )}
              </TouchableOpacity>

              {!canAdd && !saving && (
                <Text style={styles.confirmHint}>
                  {!userId
                    ? 'Preparing your account…'
                    : 'Enter a name and phone number to continue.'}
                </Text>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  /* header */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  searchWrap: {
    flex: 1, height: 48, backgroundColor: c.card, borderRadius: 12, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  searchInput: { flex: 1, fontSize: 15, color: c.textPrimary, fontFamily: 'Poppins_500Medium', padding: 0 },

  screenTitle: {
    fontSize: 22, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.4,
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10,
  },

  /* sections */
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6,
  },
  sectionLabel: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 1 },
  sectionCount: { fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.accent },

  /* rows */
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: c.divider,
    backgroundColor: c.card,
  },
  rowSelected: { backgroundColor: c.accentSoft },
  addRow: { backgroundColor: c.accentSoft, marginHorizontal: 0 },
  rowMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingLeft: 16, gap: 14,
  },
  rowIconCol: { width: 56, alignItems: 'center' },
  avatar: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.background, borderWidth: 1.5, borderColor: c.accent,
  },
  avatarSelected: { backgroundColor: c.accent },
  avatarText: { fontSize: 16, fontFamily: 'Poppins_700Bold', color: c.accent },
  rowText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, flexShrink: 1 },
  rowSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, marginTop: 2 },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 12 },

  /* loading / empty */
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: c.textSecondary, fontFamily: 'Poppins_500Medium', fontSize: 13 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  emptyIconBox: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: c.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 22 },
  emptyCta: {
    backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  emptyCtaText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },

  /* add sheet */
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: isDark ? 0.5 : 0.08, shadowRadius: 12, elevation: 12,
  },
  dragHandleHit: { alignItems: 'center', paddingTop: 10, paddingBottom: 8 },
  dragHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: c.border },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12,
  },
  sheetTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.3 },

  fieldRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  fieldLabel: { fontSize: 11, fontFamily: 'Poppins_800ExtraBold', color: c.textMuted, letterSpacing: 1 },
  fieldInput: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: c.textPrimary, paddingVertical: 4, paddingHorizontal: 0 },
  fieldHint: { fontSize: 11, color: c.textMuted, marginTop: 2, fontFamily: 'Poppins_500Medium' },

  confirmBtn: {
    marginHorizontal: 20, marginTop: 16, backgroundColor: c.accent, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  confirmBtnDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontFamily: 'Poppins_700Bold', letterSpacing: 0.2 },
  confirmHint: { fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 10, fontFamily: 'Poppins_500Medium' },
});