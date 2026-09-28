// src/modules/Dashboard/Sender/Delivery/ReceiverPickerScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../../utils/supabase';

const ORANGE = '#FA7A25';

/** Normalize PH phone number to E.164 (+63XXXXXXXXXX) */
const toE164 = (raw: string): string => {
  let digits = (raw || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '63' + digits.slice(1);
  else if (digits.startsWith('9') && digits.length === 10) digits = '63' + digits;
  else if (!digits.startsWith('63') && digits.length === 10) digits = '63' + digits;
  return '+' + digits;
};

export default function ReceiverPickerScreen({ route, navigation }: any) {
  const insets = useSafeAreaInsets();
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
    const { data } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
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
      if (uid) await fetchReceivers(uid);
      else setLoading(false);
    })();
  }, []);

  const handlePick = (receiver: any) => {
    navigation.navigate('Booking', { pickedReceiver: receiver }, { merge: true });
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return Alert.alert('Required', 'Please enter the receiver name.');
    if (!newPhone.trim()) return Alert.alert('Required', 'Please enter the receiver phone.');

    try {
      setSaving(true);
      if (!userId) throw new Error('No user');

      // ✅ Normalize phone to E.164 for Contiguity
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

      if (data) handlePick(data);
    } catch (e: any) {
      console.error('Add receiver error:', e);
      Alert.alert('Error', e.message || 'Failed to add receiver.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = receivers.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.receiver_name || '').toLowerCase().includes(q) ||
      (r.receiver_phone || '').toLowerCase().includes(q)
    );
  });

  const renderItem = ({ item }: any) => {
    const isSelected = item.receiver_id === selectedId;
    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.itemSelected]}
        onPress={() => handlePick(item)}
        activeOpacity={0.85}
      >
        <View style={[styles.itemAvatar, isSelected && styles.itemAvatarSelected]}>
          <Text style={styles.itemAvatarText}>
            {(item.receiver_name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.itemNameRow}>
            <Text style={styles.itemName} numberOfLines={1}>{item.receiver_name}</Text>
            {item.is_favorite && <Ionicons name="star" size={12} color="#F59E0B" />}
          </View>
          <Text style={styles.itemPhone} numberOfLines={1}>{item.receiver_phone}</Text>
          {item.receiver_email ? (
            <Text style={styles.itemEmail} numberOfLines={1}>{item.receiver_email}</Text>
          ) : null}
        </View>
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={22} color={ORANGE} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color="#D1D5DB" />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Receiver</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)} activeOpacity={0.85}>
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color="#9CA3AF" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search receivers..."
          placeholderTextColor="#9CA3AF"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading receivers...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyBox}>
          <View style={styles.emptyIconBox}>
            <Ionicons name="people-outline" size={38} color={ORANGE} />
          </View>
          <Text style={styles.emptyTitle}>
            {receivers.length === 0 ? 'No receivers yet' : 'No matches'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {receivers.length === 0
              ? 'Add your first receiver to start booking deliveries.'
              : 'Try a different search term.'}
          </Text>
          {receivers.length === 0 && (
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.9}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <Text style={styles.emptyCtaText}>Add New Receiver</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.receiver_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

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
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Receiver</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={22} color="#111827" />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Receiver Name</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Full name"
                  placeholderTextColor="#9CA3AF"
                  value={newName}
                  onChangeText={setNewName}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. 0917 123 4567"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  value={newPhone}
                  onChangeText={setNewPhone}
                />
                <Text style={styles.fieldHint}>
                  We'll auto-format to +63 for SMS delivery
                </Text>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Email (optional)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="receiver@email.com"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={newEmail}
                  onChangeText={setNewEmail}
                />
              </View>

              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={handleAddNew}
                disabled={saving}
                activeOpacity={0.9}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color="#FFF" />
                    <Text style={styles.saveBtnText}>Save & Select</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAFA' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 12, gap: 12,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  headerTitle: {
    flex: 1, fontSize: 18, fontWeight: '800', color: '#111827',
    letterSpacing: -0.2,
  },
  addBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E5E7EB',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    marginHorizontal: 20, marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827', padding: 0 },

  listContent: { paddingHorizontal: 20, paddingBottom: 40 },

  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  itemSelected: {
    borderColor: ORANGE, backgroundColor: '#FFFBF5',
    shadowColor: ORANGE, shadowOpacity: 0.15,
  },
  itemAvatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: '#F3F4F6',
    justifyContent: 'center', alignItems: 'center',
  },
  itemAvatarSelected: { backgroundColor: ORANGE },
  itemAvatarText: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  itemNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2,
  },
  itemName: {
    fontSize: 14, fontWeight: '800', color: '#111827',
    letterSpacing: -0.2, flexShrink: 1,
  },
  itemPhone: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  itemEmail: { fontSize: 11, color: '#9CA3AF', marginTop: 1, fontWeight: '500' },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#6B7280', fontWeight: '500', fontSize: 13 },

  emptyBox: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 40, paddingBottom: 60,
  },
  emptyIconBox: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#FFF7ED',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18, fontWeight: '800', color: '#111827',
    marginBottom: 6, textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13, color: '#6B7280', textAlign: 'center',
    lineHeight: 18, marginBottom: 20,
  },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: ORANGE, paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 14,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  emptyCtaText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 22, paddingTop: 18, paddingBottom: 30,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 18,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '800', color: '#111827', letterSpacing: -0.2,
  },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: '#374151',
    marginBottom: 6, letterSpacing: 0.2,
  },
  fieldHint: {
    fontSize: 10, color: '#9CA3AF', marginTop: 4, fontWeight: '500',
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#111827', fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, borderRadius: 16, paddingVertical: 15,
    gap: 8, marginTop: 8,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 5,
  },
  saveBtnDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, letterSpacing: 0.2 },
});