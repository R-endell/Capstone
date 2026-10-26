// src/modules/Dashboard/Sender/Delivery/ReceiverPickerScreen.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../utils/supabase';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

// Same palette as LocationSelectScreen / BookingScreen
const ORANGE = '#F27024';
const ORANGE_TINT = 'rgba(242,112,36,0.09)';

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

      setShowAddModal(false);
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

  // Flat list with small section labels (same look as the RECENT label in LocationSelect)
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
              {item.is_favorite && <Ionicons name="star" size={13} color={colors.warning} style={{ marginLeft: 6 }} />}
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>{subLine || '—'}</Text>
          </View>
          {isSelected && <Ionicons name="checkmark-circle" size={22} color={ORANGE} style={{ marginRight: 4 }} />}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteReceiver(item.receiver_id, item.receiver_name)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  }, [selectedId, colors, styles]);

  const renderAddRow = () => (
    <TouchableOpacity style={[styles.row, styles.addRow]} activeOpacity={0.85} onPress={() => setShowAddModal(true)}>
      <View style={styles.rowMain}>
        <View style={styles.rowIconCol}>
          <View style={[styles.avatar, { backgroundColor: ORANGE, borderColor: ORANGE }]}>
            <Ionicons name="person-add" size={18} color="#FFFFFF" />
          </View>
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Add new receiver</Text>
          <Text style={styles.rowSub} numberOfLines={1}>Save someone you send parcels to</Text>
        </View>
        <Ionicons name="add" size={22} color={ORANGE} style={{ marginRight: 14 }} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <StatusBar barStyle={colors.statusBarStyle} backgroundColor="transparent" translucent />

      {/* header: back + search, same as the LocationSelect search bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
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
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={styles.screenTitle}>Who is receiving this?</Text>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading receivers...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIconBox}>
            <Ionicons name={receivers.length === 0 ? 'people-outline' : 'search-outline'} size={36} color={ORANGE} />
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
            <TouchableOpacity style={styles.emptyCta} onPress={() => setShowAddModal(true)} activeOpacity={0.9}>
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
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowAddModal(false)} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.dragHandle} />

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Add new receiver</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.fieldRow}>
                <Ionicons name="person-outline" size={22} color={ORANGE} />
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
                <Ionicons name="call-outline" size={22} color={ORANGE} />
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
                <Ionicons name="mail-outline" size={22} color={ORANGE} />
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
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  /* header (mirrors LocationSelect search header) */
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center',
    marginRight: 12, borderWidth: 1, borderColor: c.border,
  },
  searchWrap: {
    flex: 1, height: 48, backgroundColor: c.card, borderRadius: 14, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, borderWidth: 1, borderColor: c.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: c.textPrimary, fontWeight: '500', padding: 0 },

  screenTitle: {
    fontSize: 22, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.4,
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10,
  },

  /* sections */
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6,
  },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  sectionCount: { fontSize: 12, fontWeight: '700', color: ORANGE },

  /* rows (mirrors LocationSelect rows) */
  row: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: c.divider,
    backgroundColor: c.card,
  },
  rowSelected: { backgroundColor: ORANGE_TINT },
  addRow: { backgroundColor: ORANGE_TINT, marginHorizontal: 0 },
  rowMain: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingLeft: 16, gap: 14,
  },
  rowIconCol: { width: 56, alignItems: 'center' },
  avatar: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.background, borderWidth: 1.5, borderColor: ORANGE,
  },
  avatarSelected: { backgroundColor: ORANGE },
  avatarText: { fontSize: 16, fontWeight: '800', color: ORANGE },
  rowText: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '700', color: c.textPrimary, flexShrink: 1 },
  rowSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  deleteBtn: { paddingHorizontal: 16, paddingVertical: 12 },

  /* loading / empty */
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: c.textSecondary, fontWeight: '500', fontSize: 13 },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingBottom: 80 },
  emptyIconBox: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: ORANGE_TINT,
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, marginBottom: 6, textAlign: 'center' },
  emptySubtitle: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 22 },
  emptyCta: {
    backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 14, paddingHorizontal: 28,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  emptyCtaText: { color: '#FFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },

  /* add sheet (mirrors LocationSelect bottom sheet) */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: c.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '88%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: isDark ? 0.5 : 0.08, shadowRadius: 12, elevation: 12,
  },
  dragHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: 'center', marginTop: 8, marginBottom: 6 },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },

  fieldRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: c.divider,
  },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: c.textMuted, letterSpacing: 1 },
  fieldInput: { fontSize: 16, fontWeight: '700', color: c.textPrimary, paddingVertical: 4, paddingHorizontal: 0 },
  fieldHint: { fontSize: 11, color: c.textMuted, marginTop: 2, fontWeight: '500' },

  confirmBtn: {
    marginHorizontal: 20, marginTop: 16, backgroundColor: ORANGE, borderRadius: 30, paddingVertical: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  confirmBtnDisabled: { backgroundColor: c.textMuted, shadowOpacity: 0, elevation: 0 },
  confirmBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  confirmHint: { fontSize: 11, color: c.textMuted, textAlign: 'center', marginTop: 10, fontWeight: '500' },
});