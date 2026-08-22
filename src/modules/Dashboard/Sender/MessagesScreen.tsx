import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

// 👇 Set this to true to use mock data, false to use real Supabase data
const USE_MOCK_DATA = true;

// Types
type User = {
  user_id: number;
  first_name: string;
  last_name: string;
  profile_photo: string | null;
};

type ChatRoom = {
  room_id: number;
  delivery_id: number;
  provider: User;
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

// Helper to format time
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

// ------ MOCK DATA (for UI testing) ------
const MOCK_CONVERSATIONS: ChatRoom[] = [
  {
    room_id: 9991,
    delivery_id: 1001,
    provider: {
      user_id: 1,
      first_name: 'Jun Joseph',
      last_name: 'Pestaño',
      profile_photo: null,
    },
    latest_message: 'Hello sir on the way nako',
    latest_sent_at: new Date().toISOString(),
    unread_count: 2,
  },
  {
    room_id: 9992,
    delivery_id: 1002,
    provider: {
      user_id: 2,
      first_name: 'Maria',
      last_name: 'Santos',
      profile_photo: null,
    },
    latest_message: 'Naa nako',
    latest_sent_at: new Date(Date.now() - 3600000).toISOString(),
    unread_count: 0,
  },
  {
    room_id: 9993,
    delivery_id: 1003,
    provider: {
      user_id: 3,
      first_name: 'Rendell James',
      last_name: 'Lumindas',
      profile_photo: null,
    },
    latest_message: 'Asa ka sir?',
    latest_sent_at: new Date(Date.now() - 7200000).toISOString(),
    unread_count: 1,
  },
  {
    room_id: 9994,
    delivery_id: 1004,
    provider: {
      user_id: 4,
      first_name: 'Kenchi',
      last_name: 'Otida',
      profile_photo: null,
    },
    latest_message: 'Thank you sir mayng gabie',
    latest_sent_at: new Date(Date.now() - 86400000).toISOString(),
    unread_count: 0,
  },
  {
    room_id: 9995,
    delivery_id: 1005,
    provider: {
      user_id: 5,
      first_name: 'Moises',
      last_name: 'Padriga',
      profile_photo: null,
    },
    latest_message: 'Traffic pa sir sorry kaayo',
    latest_sent_at: new Date(Date.now() - 172800000).toISOString(),
    unread_count: 0,
  },
  {
    room_id: 9996,
    delivery_id: 1006,
    provider: {
      user_id: 6,
      first_name: 'Chris',
      last_name: 'Canete',
      profile_photo: null,
    },
    latest_message: 'Hello sir, pwede nmo mahapit?',
    latest_sent_at: new Date(Date.now() - 259200000).toISOString(),
    unread_count: 0,
  },
];

const MOCK_MESSAGES: { [roomId: number]: ChatMessage[] } = {
  9991: [
    {
      message_id: 10001,
      message: 'Hello sir, pwede nmo mahapit?',
      sent_at: new Date(Date.now() - 1200000).toISOString(),
      sender_id: 1,
      is_read: true,
    },
    {
      message_id: 10002,
      message: 'Sige sir, waiting ko sa imo.',
      sent_at: new Date(Date.now() - 600000).toISOString(),
      sender_id: 10,
      is_read: true,
    },
    {
      message_id: 10003,
      message: 'On the way nako sir, 5 mins.',
      sent_at: new Date(Date.now() - 120000).toISOString(),
      sender_id: 1,
      is_read: false,
    },
  ],
  9992: [
    {
      message_id: 10004,
      message: 'Naa nako sa gawas.',
      sent_at: new Date(Date.now() - 4000000).toISOString(),
      sender_id: 2,
      is_read: true,
    },
    {
      message_id: 10005,
      message: 'Okay sir, coming down now.',
      sent_at: new Date(Date.now() - 3800000).toISOString(),
      sender_id: 10,
      is_read: true,
    },
  ],
  9993: [
    {
      message_id: 10006,
      message: 'Asa ka sir? Naa na ko.',
      sent_at: new Date(Date.now() - 7500000).toISOString(),
      sender_id: 3,
      is_read: true,
    },
    {
      message_id: 10007,
      message: 'Naa pa ko sa office, abot lang ko 5 mins.',
      sent_at: new Date(Date.now() - 7300000).toISOString(),
      sender_id: 10,
      is_read: true,
    },
    {
      message_id: 10008,
      message: 'Okay sir, sige huwat ko.',
      sent_at: new Date(Date.now() - 7200000).toISOString(),
      sender_id: 3,
      is_read: false,
    },
  ],
};

// -------- Main Component --------
export default function MessagesScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // State
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

  // Fetch current user ID (real data needs this)
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

  // -------- FETCH CONVERSATIONS (Mock or Real) --------
  const fetchConversations = async () => {
    if (USE_MOCK_DATA) {
      setLoading(true);
      setTimeout(() => {
        setConversations(MOCK_CONVERSATIONS);
        setLoading(false);
        setRefreshing(false);
      }, 300);
      return;
    }

    const userId = await getCurrentUserId();
    if (!userId) { setLoading(false); return; }
    currentUserId.current = userId;

    try {
      // 1. Get delivery_requests where user is sender
      const { data: requests, error: reqError } = await supabase
        .from('delivery_requests')
        .select('request_id')
        .eq('sender_id', userId);

      if (reqError) throw reqError;
      if (!requests || requests.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const requestIds = requests.map(r => r.request_id);

      // 2. Get deliveries for those requests
      const { data: deliveries, error: delError } = await supabase
        .from('deliveries')
        .select(`
          delivery_id,
          provider_id,
          users:provider_id ( user_id, first_name, last_name, profile_photo )
        `)
        .in('request_id', requestIds);

      if (delError) throw delError;
      if (!deliveries || deliveries.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      const deliveryIds = deliveries.map(d => d.delivery_id);

      // 3. Get chat rooms
      const { data: rooms, error: roomError } = await supabase
        .from('chat_rooms')
        .select('room_id, delivery_id')
        .in('delivery_id', deliveryIds)
        .order('room_id', { ascending: false });

      if (roomError) throw roomError;
      if (!rooms || rooms.length === 0) {
        setConversations([]);
        setLoading(false);
        return;
      }

      // 4. Build conversation list in parallel
      const conversationPromises = rooms.map(async (room) => {
        const delivery = deliveries.find(d => d.delivery_id === room.delivery_id);
        if (!delivery) return null;
        const provider = delivery.users?.[0]; // ✅ extract first element
        if (!provider) return null;

        const [latestResult, unreadResult] = await Promise.all([
          supabase
            .from('chat_messages')
            .select('message, sent_at')
            .eq('room_id', room.room_id)
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('chat_messages')
            .select('*', { count: 'exact', head: true })
            .eq('room_id', room.room_id)
            .neq('sender_id', userId)
            .eq('is_read', false),
        ]);

        return {
          room_id: room.room_id,
          delivery_id: room.delivery_id,
          provider: {
            user_id: provider.user_id,
            first_name: provider.first_name,
            last_name: provider.last_name,
            profile_photo: provider.profile_photo,
          },
          latest_message: latestResult.data?.message || null,
          latest_sent_at: latestResult.data?.sent_at || null,
          unread_count: unreadResult.count || 0,
        };
      });

      const results = await Promise.all(conversationPromises);
      const conversationsList = results.filter((item): item is ChatRoom => item !== null);

      // Sort by latest message time
      conversationsList.sort((a, b) => {
        const aTime = a.latest_sent_at ? new Date(a.latest_sent_at).getTime() : 0;
        const bTime = b.latest_sent_at ? new Date(b.latest_sent_at).getTime() : 0;
        return bTime - aTime;
      });

      setConversations(conversationsList);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      Alert.alert('Error', 'Could not load conversations. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // -------- FETCH MESSAGES (Real only; mock handled in openConversation) --------
  const fetchMessages = async (roomId: number, olderThan?: string) => {
    let query = supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('sent_at', { ascending: false })
      .limit(30);

    if (olderThan) {
      query = query.lt('sent_at', olderThan);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching messages:', error);
      return [];
    }
    return data as ChatMessage[];
  };

  // -------- OPEN CONVERSATION (Mock or Real) --------
  const openConversation = async (room: ChatRoom) => {
    setSelectedRoom(room);

    if (USE_MOCK_DATA) {
      const msgs = MOCK_MESSAGES[room.room_id] || [];
      setMessages(msgs);
      setConversations(prev =>
        prev.map(c =>
          c.room_id === room.room_id ? { ...c, unread_count: 0 } : c
        )
      );
      currentUserId.current = 10;
      return;
    }

    // Real data
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
        prev.map(c =>
          c.room_id === room.room_id ? { ...c, unread_count: 0 } : c
        )
      );
    }

    subscribeToRoom(room.room_id);
  };

  // -------- CLOSE CONVERSATION --------
  const closeConversation = () => {
    if (subscription.current) {
      subscription.current.unsubscribe();
      subscription.current = null;
    }
    setSelectedRoom(null);
    setMessages([]);
  };

  // -------- REAL-TIME SUBSCRIPTION (Real only) --------
  const subscribeToRoom = (roomId: number) => {
    if (USE_MOCK_DATA) return;
    if (subscription.current) subscription.current.unsubscribe();

    subscription.current = supabase
      .channel(`chat-room-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages(prev => {
            if (prev.some(m => m.message_id === newMsg.message_id)) return prev;
            return [...prev, newMsg];
          });
          setConversations(prev =>
            prev.map(c =>
              c.room_id === roomId
                ? { ...c, latest_message: newMsg.message, latest_sent_at: newMsg.sent_at }
                : c
            )
          );
          if (newMsg.sender_id !== currentUserId.current) {
            supabase
              .from('chat_messages')
              .update({ is_read: true })
              .eq('message_id', newMsg.message_id);
            setConversations(prev =>
              prev.map(c =>
                c.room_id === roomId
                  ? { ...c, unread_count: Math.max(0, c.unread_count - 1) }
                  : c
              )
            );
          }
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        }
      )
      .subscribe();
  };

  // -------- LOAD OLDER MESSAGES (Real only) --------
  const loadOlderMessages = async () => {
    if (USE_MOCK_DATA) return;
    if (loadMore || !hasMore || !selectedRoom) return;
    setLoadMore(true);
    const oldestMsg = messages[0];
    if (!oldestMsg) { setLoadMore(false); return; }
    const older = await fetchMessages(selectedRoom.room_id, oldestMsg.sent_at);
    setLoadMore(false);
    if (older.length < 30) setHasMore(false);
    if (older.length > 0) {
      setMessages(prev => [...older.reverse(), ...prev]);
    }
  };

  // -------- SEND MESSAGE (Mock or Real) --------
  const sendMessage = async () => {
    const trimmed = newMessage.trim();
    if (!trimmed || !selectedRoom) return;

    if (USE_MOCK_DATA) {
      const tempMsg: ChatMessage = {
        message_id: Date.now(),
        message: trimmed,
        sent_at: new Date().toISOString(),
        sender_id: currentUserId.current || 10,
        is_read: false,
      };
      setMessages(prev => [...prev, tempMsg]);
      setNewMessage('');
      setConversations(prev =>
        prev.map(c =>
          c.room_id === selectedRoom.room_id
            ? { ...c, latest_message: trimmed, latest_sent_at: new Date().toISOString() }
            : c
        )
      );
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }

    // Real send
    if (!currentUserId.current) return;
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

      setMessages(prev =>
        prev.map(m =>
          m.message_id === tempId ? { ...data, message_id: data.message_id } : m
        )
      );
      setConversations(prev =>
        prev.map(c =>
          c.room_id === selectedRoom.room_id
            ? { ...c, latest_message: trimmed, latest_sent_at: data.sent_at }
            : c
        )
      );
    } catch (error: any) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Unable to send message. Please try again.');
      setMessages(prev => prev.filter(m => m.message_id !== tempId));
    } finally {
      setSending(false);
    }
  };

  // -------- LIFECYCLE --------
  useFocusEffect(
    useCallback(() => {
      if (!selectedRoom) {
        fetchConversations();
      }
      return () => {};
    }, [selectedRoom])
  );

  useEffect(() => {
    return () => {
      if (subscription.current) {
        subscription.current.unsubscribe();
      }
    };
  }, []);

  // -------- RENDER HELPERS --------
  const renderConversationItem = ({ item }: { item: ChatRoom }) => (
    <TouchableOpacity style={styles.chatRow} onPress={() => openConversation(item)}>
      <View style={styles.avatar}>
        {item.provider.profile_photo ? (
          <Image source={{ uri: item.provider.profile_photo }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>
            {item.provider.first_name.charAt(0)}
            {item.provider.last_name.charAt(0)}
          </Text>
        )}
      </View>
      <View style={styles.chatInfo}>
        <Text style={styles.chatName}>
          {item.provider.first_name} {item.provider.last_name}
        </Text>
        <Text style={styles.chatLastMsg} numberOfLines={1}>
          {item.latest_message || 'No messages yet'}
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
    const isMe = item.sender_id === (currentUserId.current || 10);
    return (
      <View style={[styles.msgBubble, isMe ? styles.myMsg : styles.theirMsg]}>
        <Text style={styles.msgText}>{item.message}</Text>
        <Text style={styles.msgTime}>
          {new Date(item.sent_at).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })}
          {isMe && (
            <Text style={styles.msgStatus}>
              {' '}
              {item.is_read ? '✓✓' : '✓'}
            </Text>
          )}
        </Text>
      </View>
    );
  };

  // -------- RENDER --------
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
              Your messages with drivers will appear here.
            </Text>
          </View>
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(item) => item.room_id.toString()}
            renderItem={renderConversationItem}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={fetchConversations} />
            }
          />
        )}
      </SafeAreaView>
    );
  }

  // Chat detail view
  return (
    <View style={styles.detailContainer}>
      {/* Header */}
      <View style={[styles.detailHeader, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity onPress={closeConversation} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <View style={styles.headerAvatar}>
          {selectedRoom.provider.profile_photo ? (
            <Image source={{ uri: selectedRoom.provider.profile_photo }} style={styles.headerAvatarImage} />
          ) : (
            <Ionicons name="person" size={24} color="#FFF" />
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName}>
            {selectedRoom.provider.first_name} {selectedRoom.provider.last_name}
          </Text>
          <Text style={styles.headerSubtitle}>Driver</Text>
        </View>

        <TouchableOpacity style={styles.callBtn}>
          <Ionicons name="call" size={20} color="#000" />
        </TouchableOpacity>
      </View>

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.message_id.toString()}
        renderItem={renderMessageItem}
        contentContainerStyle={styles.chatContent}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.2}
        ListFooterComponent={
          loadMore ? <ActivityIndicator size="small" color="#F27024" /> : null
        }
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {/* Input Bar */}
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

// -------- STYLES --------
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

  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  avatarImage: { width: 56, height: 56, borderRadius: 28 },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  chatInfo: { flex: 1, paddingRight: 10 },
  chatName: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 4 },
  chatLastMsg: { fontSize: 13, color: '#6B7280' },
  chatRight: { alignItems: 'flex-end' },
  chatTime: { fontSize: 11, color: '#6B7280', marginBottom: 4 },
  unreadBadge: {
    backgroundColor: '#F27024',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },

  detailContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  detailHeader: {
    backgroundColor: '#FA7A25',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  backBtn: { paddingRight: 12, bottom: -50 },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D97706',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    bottom: -50,
    overflow: 'hidden',
  },
  headerAvatarImage: { width: 44, height: 44 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 18, fontWeight: '800', color: '#000', bottom: -50 },
  headerSubtitle: { fontSize: 12, color: '#111827', marginTop: 2, bottom: -50 },
  callBtn: { paddingLeft: 8, bottom: -50 },

  chatContent: { paddingHorizontal: 16, paddingVertical: 12 },
  msgBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    marginBottom: 8,
  },
  myMsg: {
    backgroundColor: '#E5E7EB',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  theirMsg: {
    backgroundColor: '#F3F4F6',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  msgText: { fontSize: 15, color: '#111827' },
  msgTime: { fontSize: 10, color: '#6B7280', marginTop: 4, alignSelf: 'flex-end' },
  msgStatus: { fontWeight: '600', color: '#10B981' },

  inputBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    backgroundColor: '#FFF',
  },
  iconBtn: { paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  inputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  textInput: { height: 40, fontSize: 14, color: '#000' },
});