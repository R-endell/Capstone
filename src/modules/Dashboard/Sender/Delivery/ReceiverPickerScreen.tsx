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

  // Finds the sender's row in `users`; creates it if the account has none yet
  // (same fallback the booking flow uses), so "No user" can't happen for a signed-in sender.
  const fetchUser = async (): Promise<number | null> => {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      console.warn('fetchUser: no signed-in auth user', authErr?.message);
      return null;
    }
    const { data, error } = await supabase
      .from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
    if (error) console.warn('fetchUser: users lookup failed:', error.message);
    if (data?.user_id) return data.user_id;

    const meta = user.user_metadata || {};
    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        auth_id: user.id,
        first_name: meta.first_name || 'First',
        last_name: meta.last_name || 'Last',
        email: user.email || '',
        phone_number: meta.phone_number || '',
        is_verified: false,
        is_active: true,
      })
      .select('user_id')
      .single();
    if (createErr) {
      console.warn('fetchUser: could not create users row:', createErr.message);
      return null;
    }
    return created?.user_id ?? null;
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
          }
        }
      ]
    );
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return Alert.alert('Required', 'Please enter the receiver name.');
    if (!newPhone.trim()) return Alert.alert('Required', 'Please enter the receiver phone.');

    try {
      setSaving(true);
      // Don't trust the cached state: look the account up again if it was empty on load
      let uid = userId;
      if (!uid) {
        uid = await fetchUser();
        if (uid) setUserId(uid);
      }
      if (!uid) throw new Error('We could not find your account. Please sign out and sign in again.');

      const e164Phone = toE164(newPhone.trim());

      const { data, error } = await supabase
        .from('receivers')
        .insert({
          sender_id: uid,
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
      fetchReceivers(uid);

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
      <View style={[styles.itemCard, isSelected && styles.itemCardSelected]}>
        <TouchableOpacity
          style={styles.itemMainTouchable}
          onPress={() => handlePick(item)}
          activeOpacity={0.8}
        >
          {/* Avatar always keeps the orange background and white text for high visibility */}
          <View style={styles.itemAvatar}>
            <Text style={styles.itemAvatarText}>
              {(item.receiver_name || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, marginRight: 8 }}>
            <View style={styles.itemNameRow}>
              <Text style={styles.itemName} numberOfLines={1}>{item.receiver_name}</Text>
              {item.is_favorite && <Ionicons name="star" size={12} color="#F59E0B" style={{ marginLeft: 4 }} />}
            </View>
            <Text style={styles.itemPhone} numberOfLines={1}>{item.receiver_phone}</Text>
            {item.receiver_email ? (
              <Text style={styles.itemEmail} numberOfLines={1}>{item.receiver_email}</Text>
            ) : null}
          </View>
        </TouchableOpacity>

        <View style={styles.itemActions}>
          {isSelected && (
            <Ionicons name="checkmark-circle" size={20} color={ORANGE} style={{ marginRight: 10 }} />
          )}
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDeleteReceiver(item.receiver_id, item.receiver_name)}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
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
                  Auto-formatted to +63 for dispatch notifications
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
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 14, paddingTop: 6, gap: 12,
  },
  backBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  headerTitle: {
    flex: 1, fontSize: 18, fontWeight: '800', color: '#111827',
    letterSpacing: -0.3,
  },
  addBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB',
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
    marginHorizontal: 20, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02, shadowRadius: 4, elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827', padding: 0 },

  listContent: { paddingHorizontal: 20, paddingBottom: 40 },

  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#E5E7EB',
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03, shadowRadius: 6, elevation: 2,
  },
  itemCardSelected: {
    borderColor: ORANGE, backgroundColor: '#FFFBF5',
    borderWidth: 1.5,
  },
  itemMainTouchable: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14,
  },
  itemAvatar: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: ORANGE,
    justifyContent: 'center', alignItems: 'center',
  },
  itemAvatarText: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  itemNameRow: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 3,
  },
  itemName: {
    fontSize: 15, fontWeight: '700', color: '#111827',
    letterSpacing: -0.2, flexShrink: 1,
  },
  itemPhone: { fontSize: 13, color: '#4B5563', fontWeight: '500' },
  itemEmail: { fontSize: 11, color: '#9CA3AF', marginTop: 2, fontWeight: '400' },

  itemActions: {
    flexDirection: 'row', alignItems: 'center', paddingRight: 14,
  },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#FEF2F2',
    justifyContent: 'center', alignItems: 'center',
  },

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
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18, fontWeight: '800', color: '#111827', letterSpacing: -0.3,
  },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: {
    fontSize: 13, fontWeight: '700', color: '#374151',
    marginBottom: 6, letterSpacing: 0.1,
  },
  fieldHint: {
    fontSize: 11, color: '#9CA3AF', marginTop: 4, fontWeight: '500',
  },
  textInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: '#111827', fontWeight: '500',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: ORANGE, borderRadius: 14, paddingVertical: 14,
    gap: 8, marginTop: 12,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  saveBtnDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0, elevation: 0 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, letterSpacing: 0.2 },
});