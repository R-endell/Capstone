import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

type Party = {
  user_id: number;
  first_name: string;
  last_name: string;
  profile_photo: string | null;
};

type ChatRoom = {
  room_id: number;
  delivery_id: number;
  other: Party;
  role: 'sender' | 'provider';
  latest_message: string | null;
  latest_sent_at: string | null;
  unread_count: number;
};

type ChatMessage = {
  message_id: number;
  message: string;
  sent_at: string;
  sender_id: number;
  is_read: boolean;
};

const formatChatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diff < 604800000) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function MessagesScreen({ route: propsRoute }: any) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const openRoomIdParam: number | undefined =
    propsRoute?.params?.openRoomId ?? route.params?.openRoomId;

  const [conversations, setConversations] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loadMore, setLoadMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const flatListRef = useRef<FlatList>(null);
  const currentUserId = useRef<number | null>(null);
  const subscription = useRef<any>(null);
  const roomsSubscription = useRef<any>(null);
  const autoOpenHandled = useRef<number | null>(null);

  /* ---------------- Current user ---------------- */
  const getCurrentUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: userRecord } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();
    return userRecord?.user_id || null;
  };

  /* ---------------- Fetch conversations ---------------- */
  const fetchConversations = async () => {
    const userId = currentUserId.current || (await getCurrentUserId());
    if (!userId) { setLoading(false); setRefreshing(false); return; }
    currentUserId.current = userId;

    try {
      // Deliveries where the user is the provider
      const { data: providerDeliveries } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .eq('provider_id', userId);

      // Deliveries whose parent request was sent by the user
      const { data: senderRequests } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('sender_id', userId);
      const senderRequestIds = (senderRequests || []).map(r => r.request_id);

      let senderDeliveries: { delivery_id: number }[] = [];
      if (senderRequestIds.length > 0) {
        const { data } = await supabase
          .from('deliveries')
          .select('delivery_id')
          .in('request_id', senderRequestIds);
        senderDeliveries = data || [];
      }

      const deliveryIds = Array.from(new Set([
        ...(providerDeliveries || []).map(d => d.delivery_id),
        ...senderDeliveries.map(d => d.delivery_id),
      ]));

      if (deliveryIds.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      // Rooms for those deliveries
      const { data: rooms, error: roomError } = await supabase
        .from('chat_rooms')
        .select('room_id, delivery_id')
        .in('delivery_id', deliveryIds);
      if (roomError) throw roomError;
      if (!rooms || rooms.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const roomDeliveryIds = rooms.map(r => r.delivery_id);
      const { data: deliveriesInfo, error: dErr } = await supabase
        .from('deliveries')
        .select(`
          delivery_id,
          provider_id,
          request_id,
          provider:provider_id ( user_id, first_name, last_name, profile_photo ),
          delivery_requests:request_id (
            sender_id,
            sender:sender_id ( user_id, first_name, last_name, profile_photo )
          )
        `)
        .in('delivery_id', roomDeliveryIds);
      if (dErr) throw dErr;

      const list: ChatRoom[] = [];
      for (const room of rooms) {
        const d: any = (deliveriesInfo || []).find((x: any) => x.delivery_id === room.delivery_id);
        if (!d) continue;
        const req = Array.isArray(d.delivery_requests) ? d.delivery_requests[0] : d.delivery_requests;
        const provider: Party | null = Array.isArray(d.provider) ? d.provider[0] : d.provider;
        const sender: Party | null = Array.isArray(req?.sender) ? req.sender[0] : req?.sender;

        const isMeProvider = d.provider_id === userId;
        const other: Party | null = isMeProvider ? sender : provider;
        if (!other) continue;

        const [latestResult, unreadResult] = await Promise.all([
          supabase.from('chat_messages').select('message, sent_at')
            .eq('room_id', room.room_id).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('chat_messages').select('*', { count: 'exact', head: true })
            .eq('room_id', room.room_id).neq('sender_id', userId).eq('is_read', false),
        ]);

        list.push({
          room_id: room.room_id,
          delivery_id: room.delivery_id,
          other,
          role: isMeProvider ? 'provider' : 'sender',
          latest_message: latestResult.data?.message || null,
          latest_sent_at: latestResult.data?.sent_at || null,
          unread_count: unreadResult.count || 0,
        });
      }

      list.sort((a, b) => {
        const aT = a.latest_sent_at ? new Date(a.latest_sent_at).getTime() : 0;
        const bT = b.latest_sent_at ? new Date(b.latest_sent_at).getTime() : 0;
        return bT - aT;
      });
      setConversations(list);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  /* ---------------- Fetch messages ---------------- */
  const fetchMessages = async (roomId: number, olderThan?: string) => {
    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('sent_at', { ascending: false })
      .limit(30);
    if (olderThan) query = query.lt('sent_at', olderThan);
    const { data, error } = await query;
    if (error) { console.error(error); return []; }
    return data as ChatMessage[];
  };

  /* ---------------- Open / close ---------------- */
  const openConversation = async (room: ChatRoom) => {
    setSelectedRoom(room);
    const msgs = await fetchMessages(room.room_id);
    setMessages(msgs.reverse());
    setHasMore(msgs.length >= 30);

    if (currentUserId.current) {
      await supabase
        .from('chat_messages')
        .update({ is_read: true })
        .eq('room_id', room.room_id)
        .neq('sender_id', currentUserId.current)
        .eq('is_read', false);
      setConversations(prev =>
        prev.map(c => (c.room_id === room.room_id ? { ...c, unread_count: 0 } : c)),
      );
    }
    subscribeToRoom(room.room_id);
  };

  const closeConversation = () => {
    if (subscription.current) { subscription.current.unsubscribe(); subscription.current = null; }
    setSelectedRoom(null);
    setMessages([]);
  };

  /* ---------------- Realtime for open room ---------------- */
  const subscribeToRoom = (roomId: number) => {
    if (subscription.current) subscription.current.unsubscribe();
    subscription.current = supabase
      .channel(`chat-room-${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages(prev => (prev.some(m => m.message_id === newMsg.message_id) ? prev : [...prev, newMsg]));
          setConversations(prev =>
            prev.map(c => (c.room_id === roomId
              ? { ...c, latest_message: newMsg.message, latest_sent_at: newMsg.sent_at }
              : c)),
          );
          if (newMsg.sender_id !== currentUserId.current) {
            supabase.from('chat_messages').update({ is_read: true }).eq('message_id', newMsg.message_id);
          }
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        })
      .subscribe();
  };

  /* ---------------- Load older ---------------- */
  const loadOlderMessages = async () => {
    if (loadMore || !hasMore || !selectedRoom) return;
    setLoadMore(true);
    const oldest = messages[0];
    if (!oldest) { setLoadMore(false); return; }
    const older = await fetchMessages(selectedRoom.room_id, oldest.sent_at);
    setLoadMore(false);
    if (older.length < 30) setHasMore(false);
    if (older.length > 0) setMessages(prev => [...older.reverse(), ...prev]);
  };

  /* ---------------- Send ---------------- */
  const sendMessage = async () => {
    const trimmed = newMessage.trim();
    if (!trimmed || !selectedRoom || !currentUserId.current) return;

    setSending(true);
    const tempId = Date.now();
    const tempMsg: ChatMessage = {
      message_id: tempId,
      message: trimmed,
      sent_at: new Date().toISOString(),
      sender_id: currentUserId.current,
      is_read: false,
    };
    setMessages(prev => [...prev, tempMsg]);
    setNewMessage('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          message: trimmed,
          room_id: selectedRoom.room_id,
          sender_id: currentUserId.current,
        })
        .select('*')
        .single();
      if (error) throw error;

      setMessages(prev => prev.map(m => (m.message_id === tempId ? data : m)));
      setConversations(prev =>
        prev.map(c => (c.room_id === selectedRoom.room_id
          ? { ...c, latest_message: trimmed, latest_sent_at: data.sent_at }
          : c)),
      );
    } catch (error: any) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Unable to send message.');
      setMessages(prev => prev.filter(m => m.message_id !== tempId));
    } finally {
      setSending(false);
    }
  };

  /* ---------------- Auto-open from route param ---------------- */
  useEffect(() => {
    const tryAutoOpen = async () => {
      if (!openRoomIdParam) return;
      if (autoOpenHandled.current === openRoomIdParam) return;
      if (conversations.length === 0) return;

      const target = conversations.find(c => c.room_id === openRoomIdParam);
      if (target) {
        autoOpenHandled.current = openRoomIdParam;
        await openConversation(target);
      } else {
        setRefreshing(true);
        await fetchConversations();
      }
    };
    tryAutoOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRoomIdParam, conversations.length]);

  /* ---------------- Lifecycle ---------------- */
  useFocusEffect(
    useCallback(() => {
      if (!selectedRoom) fetchConversations();
      return () => {};
    }, [selectedRoom]),
  );

  useEffect(() => {
    roomsSubscription.current = supabase
      .channel(`chat-rooms-list-${Date.now()}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_rooms' },
        () => { fetchConversations(); })
      .subscribe();
    return () => {
      if (roomsSubscription.current) supabase.removeChannel(roomsSubscription.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (subscription.current) subscription.current.unsubscribe();
      if (roomsSubscription.current) supabase.removeChannel(roomsSubscription.current);
    };
  }, []);

  /* ---------------- Renderers ---------------- */
  const renderConversationItem = ({ item }: { item: ChatRoom }) => (
    <TouchableOpacity style={styles.chatRow} onPress={() => openConversation(item)}>
      <View style={styles.avatar}>
        {item.other.profile_photo ? (
          <Image source={{ uri: item.other.profile_photo }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>
            {item.other.first_name?.charAt(0) || '?'}{item.other.last_name?.charAt(0) || ''}
          </Text>
        )}
      </View>
      <View style={styles.chatInfo}>
        <Text style={styles.chatName}>
          {item.other.first_name} {item.other.last_name}
        </Text>
        <Text style={styles.chatLastMsg} numberOfLines={1}>
          {item.latest_message || 'Say hi 👋'}
        </Text>
      </View>
      <View style={styles.chatRight}>
        {item.latest_sent_at && (
          <Text style={styles.chatTime}>{formatChatTime(item.latest_sent_at)}</Text>
        )}
        {item.unread_count > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderMessageItem = ({ item }: { item: ChatMessage }) => {
    const isMe = item.sender_id === currentUserId.current;
    return (
      <View style={[styles.msgBubble, isMe ? styles.myMsg : styles.theirMsg]}>
        <Text style={styles.msgText}>{item.message}</Text>
        <Text style={styles.msgTime}>
          {new Date(item.sent_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          {isMe && <Text style={styles.msgStatus}>{' '}{item.is_read ? '✓✓' : '✓'}</Text>}
        </Text>
      </View>
    );
  };

  /* ---------------- Render ---------------- */
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.listHeader}>
          <Text style={styles.mainTitle}>Messages</Text>
          <Text style={styles.subTitle}>Chats</Text>
        </View>
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color="#F27024" />
        </View>
      </SafeAreaView>
    );
  }

  if (!selectedRoom) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.listHeader}>
          <Text style={styles.mainTitle}>Messages</Text>
          <Text style={styles.subTitle}>Chats</Text>
        </View>

        {conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={60} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No conversations</Text>
            <Text style={styles.emptySubtext}>
              Your messages with providers or senders will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.room_id.toString()}
            renderItem={renderConversationItem}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchConversations} />}
          />
        )}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.detailContainer}>
      <View style={[styles.detailHeader, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={closeConversation} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          {selectedRoom.other.profile_photo ? (
            <Image source={{ uri: selectedRoom.other.profile_photo }} style={styles.headerAvatarImage} />
          ) : (
            <Ionicons name="person" size={24} color="#FFF" />
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>
            {selectedRoom.other.first_name} {selectedRoom.other.last_name}
          </Text>
          <Text style={styles.headerSubtitle}>
            {selectedRoom.role === 'sender' ? 'Provider' : 'Sender'}
          </Text>
        </View>

        <TouchableOpacity style={styles.callBtn}>
          <Ionicons name="call" size={20} color="#000" />
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.message_id.toString()}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.chatContent}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.2}
        ListFooterComponent={loadMore ? <ActivityIndicator size="small" color="#F27024" /> : null}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <View style={[styles.inputBar, { paddingBottom: insets.bottom || 12 }]}>
          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="add" size={28} color="#4B5563" />
          </TouchableOpacity>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Type your message"
              placeholderTextColor="#9CA3AF"
              value={newMessage}
              onChangeText={setNewMessage}
              editable={!sending}
            />
          </View>

          <TouchableOpacity style={styles.iconBtn}>
            <Ionicons name="camera-outline" size={24} color="#4B5563" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconBtn, { opacity: sending ? 0.5 : 1 }]}
            onPress={sendMessage}
            disabled={sending || !newMessage.trim()}
          >
            <Ionicons
              name="send-outline"
              size={22}
              color={newMessage.trim() ? '#F27024' : '#9CA3AF'}
              style={{ transform: [{ rotate: '-45deg' }] }}
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  listHeader: { paddingHorizontal: 20, paddingTop: 25, paddingBottom: 10 },
  mainTitle: { fontSize: 30, fontWeight: '800', color: '#000', marginBottom: 20 },
  subTitle: { fontSize: 15, color: '#000', fontWeight: '500' },
  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 16 },
  emptySubtext: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 8 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },

  chatRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#D97706', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  avatarImage: { width: 56, height: 56, borderRadius: 28 },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  chatInfo: { flex: 1, paddingRight: 10 },
  chatName: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  chatLastMsg: { fontSize: 13, color: '#6B7280' },
  chatRight: { alignItems: 'flex-end' },
  chatTime: { fontSize: 11, color: '#6B7280', marginBottom: 4 },
  unreadBadge: { backgroundColor: '#F27024', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  unreadBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },

  detailContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  detailHeader: { backgroundColor: '#FA7A25', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 100 },
  backBtn: { paddingRight: 12, bottom: -50 },
  headerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#D97706', justifyContent: 'center', alignItems: 'center', marginRight: 12, bottom: -50, overflow: 'hidden' },
  headerAvatarImage: { width: 44, height: 44 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 18, fontWeight: '800', color: '#000', bottom: -50 },
  headerSubtitle: { fontSize: 12, color: '#111827', marginTop: 2, bottom: -50 },
  callBtn: { paddingLeft: 8, bottom: -50 },

  chatContent: { paddingHorizontal: 16, paddingVertical: 12 },
  msgBubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18, marginBottom: 8 },
  myMsg: { backgroundColor: '#E5E7EB', alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  theirMsg: { backgroundColor: '#F3F4F6', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: '#111827' },
  msgTime: { fontSize: 10, color: '#6B7280', marginTop: 4, alignSelf: 'flex-end' },
  msgStatus: { fontWeight: '600', color: '#10B981' },

  inputBar: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', backgroundColor: '#FFF' },
  iconBtn: { paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  inputWrapper: { flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, marginHorizontal: 8, paddingHorizontal: 12, justifyContent: 'center' },
  textInput: { height: 40, fontSize: 14, color: '#000' },
});