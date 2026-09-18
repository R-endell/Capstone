// src/modules/Dashboard/Sender/MessagesScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  Platform, ActivityIndicator, Alert, Image, RefreshControl,
  Animated, Easing, StatusBar, Keyboard, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { formatDate } from '../../../utils/dateUtils';

const ORANGE = '#F27024';

type Party = {
  user_id: number;
  first_name: string;
  last_name: string;
  profile_photo: string | null;
};

type ChatRoom = {
  room_id: number;
  all_room_ids: number[];
  delivery_id: number;
  other: Party;
  role: 'sender' | 'provider';
  latest_message: string | null;
  latest_sent_at: string | null;
  unread_count: number;
  is_archived: boolean;
};

type ChatMessage = {
  message_id: number;
  room_id: number;
  message: string;
  sent_at: string;
  sender_id: number;
  is_read: boolean;
  _temp_id?: number;
};

const formatChatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return formatDate(timestamp, 'h:mm a');
  if (diff < 604800000) return formatDate(timestamp, 'EEE');
  return formatDate(timestamp, 'MMM d');
};

const shouldShowDateSeparator = (current: ChatMessage, previous: ChatMessage | null) => {
  if (!previous) return true;
  const currDay = formatDate(current.sent_at, 'yyyy-MM-dd');
  const prevDay = formatDate(previous.sent_at, 'yyyy-MM-dd');
  return currDay !== prevDay;
};

const formatDateSeparator = (timestamp: string) => {
  const day = formatDate(timestamp, 'yyyy-MM-dd');
  const today = formatDate(new Date().toISOString(), 'yyyy-MM-dd');

  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = formatDate(y.toISOString(), 'yyyy-MM-dd');

  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return formatDate(timestamp, 'EEEE, MMM d');
};

export default function MessagesScreen({ route: propsRoute }: any) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const openRoomIdParam: number | undefined =
    propsRoute?.params?.openRoomId ?? route.params?.openRoomId;

  const [activeTab, setActiveTab] = useState<'inbox' | 'archived'>('inbox');
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

  const listHeaderAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const detailHeaderAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;
  const inputAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 500) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    if (!selectedRoom) {
      listHeaderAnim.setValue(0);
      listAnim.setValue(0);
      Animated.parallel([
        animate(listHeaderAnim, 0),
        animate(listAnim, 150),
      ]).start();
    } else {
      detailHeaderAnim.setValue(0);
      detailAnim.setValue(0);
      inputAnim.setValue(0);
      Animated.parallel([
        animate(detailHeaderAnim, 0),
        animate(detailAnim, 120),
        animate(inputAnim, 240),
      ]).start();
    }
  }, [selectedRoom, listHeaderAnim, listAnim, detailHeaderAnim, detailAnim, inputAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

  const getCurrentUserId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: userRecord } = await supabase.from('users').select('user_id').eq('auth_id', user.id).single();
    return userRecord?.user_id || null;
  };

  const fetchConversations = async () => {
    const userId = currentUserId.current || (await getCurrentUserId());
    if (!userId) { setLoading(false); setRefreshing(false); return; }
    currentUserId.current = userId;

    try {
      const { data: roomStates } = await supabase
        .from('chat_room_states')
        .select('room_id, is_archived, is_deleted')
        .eq('user_id', userId);

      const stateMap = new Map();
      roomStates?.forEach(s => stateMap.set(s.room_id, s));

      const { data: providerDeliveries } = await supabase.from('deliveries').select('delivery_id').eq('provider_id', userId);
      const { data: senderRequests } = await supabase.from('delivery_requests').select('request_id').eq('sender_id', userId);
      const senderRequestIds = (senderRequests || []).map(r => r.request_id);

      let senderDeliveries: { delivery_id: number }[] = [];
      if (senderRequestIds.length > 0) {
        const { data } = await supabase.from('deliveries').select('delivery_id').in('request_id', senderRequestIds);
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

      const { data: rooms, error: roomError } = await supabase.from('chat_rooms').select('room_id, delivery_id').in('delivery_id', deliveryIds);
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
        const rState = stateMap.get(room.room_id);
        if (rState?.is_deleted) continue;

        const d: any = (deliveriesInfo || []).find((x: any) => x.delivery_id === room.delivery_id);
        if (!d) continue;
        const req = Array.isArray(d.delivery_requests) ? d.delivery_requests[0] : d.delivery_requests;
        const provider: Party | null = Array.isArray(d.provider) ? d.provider[0] : d.provider;
        const sender: Party | null = Array.isArray(req?.sender) ? req.sender[0] : req?.sender;

        const isMeProvider = d.provider_id === userId;
        const other: Party | null = isMeProvider ? sender : provider;
        if (!other) continue;

        const [latestResult, unreadResult] = await Promise.all([
          supabase.from('chat_messages').select('message, sent_at').eq('room_id', room.room_id).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('chat_messages').select('*', { count: 'exact', head: true }).eq('room_id', room.room_id).neq('sender_id', userId).eq('is_read', false),
        ]);

        list.push({
          room_id: room.room_id,
          all_room_ids: [room.room_id],
          delivery_id: room.delivery_id,
          other,
          role: isMeProvider ? 'provider' : 'sender',
          latest_message: latestResult.data?.message || null,
          latest_sent_at: latestResult.data?.sent_at || null,
          unread_count: unreadResult.count || 0,
          is_archived: rState?.is_archived || false,
        });
      }

      list.sort((a, b) => {
        const aT = a.latest_sent_at ? new Date(a.latest_sent_at).getTime() : 0;
        const bT = b.latest_sent_at ? new Date(b.latest_sent_at).getTime() : 0;
        return bT - aT;
      });

      const uniqueConversations: ChatRoom[] = [];
      const seenUsers = new Map<number, ChatRoom>();

      for (const c of list) {
        if (!seenUsers.has(c.other.user_id)) {
          seenUsers.set(c.other.user_id, c);
          uniqueConversations.push(c);
        } else {
          const existing = seenUsers.get(c.other.user_id)!;
          existing.unread_count += c.unread_count;
          if (!existing.all_room_ids.includes(c.room_id)) {
             existing.all_room_ids.push(c.room_id);
          }
        }
      }

      setConversations(uniqueConversations);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchMessages = async (roomIds: number[], olderThan?: string) => {
    let query = supabase.from('chat_messages').select('*').in('room_id', roomIds).order('sent_at', { ascending: false }).limit(30);
    if (olderThan) query = query.lt('sent_at', olderThan);
    const { data, error } = await query;
    if (error) { console.error(error); return []; }
    return (data || []).map((m: any) => ({ ...m, _temp_id: undefined })) as ChatMessage[];
  };

  const openConversation = async (room: ChatRoom) => {
    setSelectedRoom(room);
    const msgs = await fetchMessages(room.all_room_ids);
    setMessages(msgs.reverse());
    setHasMore(msgs.length >= 30);

    if (currentUserId.current) {
      await supabase.from('chat_messages').update({ is_read: true }).in('room_id', room.all_room_ids).neq('sender_id', currentUserId.current).eq('is_read', false);
      setConversations(prev => prev.map(c => (c.room_id === room.room_id ? { ...c, unread_count: 0 } : c)));
    }
    subscribeToRoom(room.all_room_ids);
  };

  const closeConversation = () => {
    if (subscription.current) { subscription.current.unsubscribe(); subscription.current = null; }
    Keyboard.dismiss();
    setSelectedRoom(null);
    setMessages([]);
  };

  const subscribeToRoom = (roomIds: number[]) => {
    if (subscription.current) { subscription.current.unsubscribe(); subscription.current = null; }
    subscription.current = supabase
      .channel(`chat-room-active-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
          const newMsg = payload.new as ChatMessage;
          
          if (!roomIds.includes(newMsg.room_id)) return;

          setMessages(prev => {
            if (prev.some(m => m.message_id === newMsg.message_id)) return prev;
            const tempIdx = prev.findIndex(m => m._temp_id !== undefined && m.sender_id === newMsg.sender_id && m.message === newMsg.message);
            if (tempIdx !== -1) {
              const next = [...prev];
              next[tempIdx] = { ...newMsg, _temp_id: undefined };
              return next;
            }
            return [...prev, newMsg];
          });

          setConversations(prev => prev.map(c => (c.all_room_ids.includes(newMsg.room_id) ? { ...c, latest_message: newMsg.message, latest_sent_at: newMsg.sent_at } : c)));

          if (newMsg.sender_id !== currentUserId.current) {
            supabase.from('chat_messages').update({ is_read: true }).eq('message_id', newMsg.message_id);
          }
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
        })
      .subscribe();
  };

  const loadOlderMessages = async () => {
    if (loadMore || !hasMore || !selectedRoom) return;
    setLoadMore(true);
    const oldest = messages[0];
    if (!oldest) { setLoadMore(false); return; }
    const older = await fetchMessages(selectedRoom.all_room_ids, oldest.sent_at);
    setLoadMore(false);
    if (older.length < 30) setHasMore(false);
    if (older.length > 0) setMessages(prev => [...older.reverse(), ...prev]);
  };

  const sendMessage = async () => {
    const trimmed = newMessage.trim();
    if (!trimmed || !selectedRoom || !currentUserId.current) return;

    setSending(true);
    const tempId = Date.now();
    const tempMsg: ChatMessage = {
      message_id: tempId, room_id: selectedRoom.room_id, message: trimmed, sent_at: new Date().toISOString(),
      sender_id: currentUserId.current, is_read: false, _temp_id: tempId,
    };
    setMessages(prev => [...prev, tempMsg]);
    setNewMessage('');
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const { data, error } = await supabase.from('chat_messages').insert({
          message: trimmed, room_id: selectedRoom.room_id, sender_id: currentUserId.current,
        }).select('*').single();
      if (error) throw error;

      await supabase.from('chat_room_states').upsert(
        selectedRoom.all_room_ids.map(id => ({
          room_id: id,
          user_id: currentUserId.current,
          is_archived: false,
          is_deleted: false
        }))
      );

      setMessages(prev => prev.map(m => (m._temp_id === tempId ? { ...data, _temp_id: undefined } : m)));
      setConversations(prev => prev.map(c => (c.room_id === selectedRoom.room_id ? { ...c, latest_message: trimmed, latest_sent_at: data.sent_at, is_archived: false } : c)));
    } catch (error: any) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Unable to send message.');
      setMessages(prev => prev.filter(m => m._temp_id !== tempId));
    } finally {
      setSending(false);
    }
  };

  const openChatOptions = (room: ChatRoom) => {
    const isArchived = room.is_archived;
    
    Alert.alert(
      'Conversation Options',
      `Manage chat with ${room.other.first_name}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: isArchived ? 'Unarchive' : 'Archive', 
          onPress: () => toggleArchiveChat(room, !isArchived) 
        },
        { text: 'Delete Chat', style: 'destructive', onPress: () => deleteChat(room) },
      ]
    );
  };

  const toggleArchiveChat = async (room: ChatRoom, archive: boolean) => {
    // Optimistic UI update
    setConversations(prev => prev.map(c => c.room_id === room.room_id ? { ...c, is_archived: archive } : c));
    try {
      const payloads = room.all_room_ids.map(id => ({
        room_id: id,
        user_id: currentUserId.current,
        is_archived: archive,
        is_deleted: false
      }));
      await supabase.from('chat_room_states').upsert(payloads);
    } catch (error) {
      console.error('Error toggling archive:', error);
      fetchConversations();
    }
  };

  const deleteChat = async (room: ChatRoom) => {
    Alert.alert(
      'Delete Conversation',
      'Are you sure? This will permanently remove the chat from your inbox.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setConversations(prev => prev.filter(c => c.room_id !== room.room_id));
            try {
              const payloads = room.all_room_ids.map(id => ({
                room_id: id,
                user_id: currentUserId.current,
                is_deleted: true,
                is_archived: false
              }));
              await supabase.from('chat_room_states').upsert(payloads);
            } catch (error) {
              console.error('Error deleting chat:', error);
              fetchConversations();
            }
          }
        }
      ]
    );
  };

  useEffect(() => {
    const tryAutoOpen = async () => {
      if (!openRoomIdParam) return;
      if (autoOpenHandled.current === openRoomIdParam) return;
      if (conversations.length === 0) return;

      const target = conversations.find(c => c.all_room_ids.includes(openRoomIdParam));
      if (target) {
        autoOpenHandled.current = openRoomIdParam;
        await openConversation(target);
      } else {
        setRefreshing(true);
        await fetchConversations();
      }
    };
    tryAutoOpen();
  }, [openRoomIdParam, conversations.length]);

  useFocusEffect(
    useCallback(() => {
      if (!selectedRoom) fetchConversations();
      return () => {};
    }, [selectedRoom]),
  );

  useEffect(() => {
    roomsSubscription.current = supabase
      .channel(`chat-rooms-list-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, () => fetchConversations())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => fetchConversations())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => fetchConversations())
      .subscribe();
      
    return () => {
      if (roomsSubscription.current) supabase.removeChannel(roomsSubscription.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (subscription.current) subscription.current.unsubscribe();
      if (roomsSubscription.current) supabase.removeChannel(roomsSubscription.current);
    };
  }, []);

  // Filter conversations based on the active tab
  const filteredConversations = conversations.filter(c => 
    activeTab === 'archived' ? c.is_archived : !c.is_archived
  );

  const renderAvatar = (party: Party, size: number, badgeColor?: string) => {
    const initials = `${party.first_name?.charAt(0) || '?'}${party.last_name?.charAt(0) || ''}`;
    return (
      <View style={{ width: size, height: size, position: 'relative' }}>
        {party.profile_photo ? (
          <Image
            source={{ uri: party.profile_photo }}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#F3F4F6' }}
          />
        ) : (
          <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
          </View>
        )}
        {badgeColor && (
          <View style={[styles.avatarBadge, { backgroundColor: badgeColor }]}>
            <Ionicons name="checkmark" size={8} color="#FFFFFF" />
          </View>
        )}
      </View>
    );
  };

  const renderConversationItem = ({ item }: { item: ChatRoom }) => (
    <View style={styles.chatRowWrapper}>
      <TouchableOpacity 
        style={styles.chatRow} 
        onPress={() => openConversation(item)} 
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrapper}>
          {item.other.profile_photo ? (
            <Image source={{ uri: item.other.profile_photo }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>
                {item.other.first_name?.charAt(0) || '?'}{item.other.last_name?.charAt(0) || ''}
              </Text>
            </View>
          )}
          {item.unread_count > 0 && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.chatInfo}>
          <View style={styles.chatNameRow}>
            <Text style={styles.chatName} numberOfLines={1}>
              {item.other.first_name} {item.other.last_name}
            </Text>
            {item.latest_sent_at && (
              <Text style={[styles.chatTime, item.unread_count > 0 && styles.chatTimeUnread]}>
                {formatChatTime(item.latest_sent_at)}
              </Text>
            )}
          </View>
          <View style={styles.chatMsgRow}>
            <Text style={[styles.chatLastMsg, item.unread_count > 0 && styles.chatLastMsgUnread]} numberOfLines={1}>
              {item.latest_message || 'Say hi 👋'}
            </Text>
            {item.unread_count > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unread_count}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
      
      {/* Dropdown Options Icon */}
      <TouchableOpacity 
        style={styles.optionsButton} 
        onPress={() => openChatOptions(item)}
        activeOpacity={0.6}
      >
        <Ionicons name="ellipsis-vertical" size={18} color="#9CA3AF" />
      </TouchableOpacity>
    </View>
  );

  const renderMessageItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.sender_id === currentUserId.current;
    const previous = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previous);
    const prevSameSender = previous && previous.sender_id === item.sender_id;
    const showAvatar = !isMe && !prevSameSender;

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateSeparatorLine} />
            <Text style={styles.dateSeparatorText}>{formatDateSeparator(item.sent_at)}</Text>
            <View style={styles.dateSeparatorLine} />
          </View>
        )}

        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          {!isMe && (
            <View style={styles.msgAvatarSlot}>
              {showAvatar ? renderAvatar(selectedRoom!.other, 32) : <View style={{ width: 32 }} />}
            </View>
          )}

          <View style={[styles.msgBubble, isMe ? styles.myMsg : styles.theirMsg]}>
            <Text style={[styles.msgText, isMe && styles.myMsgText]}>{item.message}</Text>
            <View style={styles.msgMeta}>
              <Text style={[styles.msgTime, isMe && styles.myMsgTime]}>{formatDate(item.sent_at, 'h:mm a')}</Text>
              {isMe && (
                <Ionicons
                  name={item.is_read ? 'checkmark-done' : 'checkmark'}
                  size={12}
                  color={item.is_read ? '#93C5FD' : 'rgba(255,255,255,0.7)'}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={ORANGE} />
        <View style={styles.listHeader}>
          <Text style={styles.mainTitle}>Messages</Text>
        </View>
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!selectedRoom) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

        <Animated.View style={[styles.listHeader, fadeUp(listHeaderAnim, -14)]}>
          <View style={styles.listHeaderTop}>
            <Text style={styles.mainTitle}>Messages</Text>
            {conversations.length > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{conversations.length}</Text>
              </View>
            )}
          </View>
          
          {/* Tab Navigation */}
          <View style={styles.tabContainer}>
            <TouchableOpacity 
              style={[styles.tabButton, activeTab === 'inbox' && styles.tabButtonActive]}
              onPress={() => setActiveTab('inbox')}
            >
              <Text style={[styles.tabText, activeTab === 'inbox' && styles.tabTextActive]}>Inbox</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.tabButton, activeTab === 'archived' && styles.tabButtonActive]}
              onPress={() => setActiveTab('archived')}
            >
              <Text style={[styles.tabText, activeTab === 'archived' && styles.tabTextActive]}>Archived</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {filteredConversations.length === 0 ? (
          <Animated.View style={[styles.emptyContainer, fadeUp(listAnim, 20)]}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name={activeTab === 'inbox' ? 'chatbubbles-outline' : 'archive-outline'} size={40} color={ORANGE} />
            </View>
            <Text style={styles.emptyTitle}>
              {activeTab === 'inbox' ? 'No conversations yet' : 'No archived chats'}
            </Text>
            <Text style={styles.emptySubtext}>
              {activeTab === 'inbox' 
                ? 'Your messages with providers or senders will appear here.'
                : 'Chats you archive will be saved here.'}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: listAnim }}>
            <FlatList
              data={filteredConversations}
              keyExtractor={(item) => item.room_id.toString()}
              renderItem={renderConversationItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchConversations} tintColor={ORANGE} colors={[ORANGE]} />}
            />
          </Animated.View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.detailContainer}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      <Animated.View style={[styles.detailHeader, { paddingTop: insets.top + 12 }, fadeUp(detailHeaderAnim, -14)]}>
        <TouchableOpacity onPress={closeConversation} style={styles.backBtn} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.headerAvatarWrapper}>
          {selectedRoom.other.profile_photo ? (
            <Image source={{ uri: selectedRoom.other.profile_photo }} style={styles.headerAvatarImage} />
          ) : (
            <View style={styles.headerAvatarFallback}>
              <Text style={styles.headerAvatarInitials}>
                {selectedRoom.other.first_name?.charAt(0) || '?'}
                {selectedRoom.other.last_name?.charAt(0) || ''}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {selectedRoom.other.first_name} {selectedRoom.other.last_name}
          </Text>
          <View style={styles.headerRoleRow}>
            <View style={[styles.headerRoleDot, { backgroundColor: selectedRoom.role === 'sender' ? '#93C5FD' : '#86EFAC' }]} />
            <Text style={styles.headerSubtitle}>
              {selectedRoom.role === 'sender' ? 'Provider' : 'Sender'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.85}>
          <Ionicons name="call-outline" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        <Animated.View style={[styles.flex, { opacity: detailAnim }]}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item._temp_id !== undefined ? `temp-${item._temp_id}` : `msg-${item.message_id}`}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={loadOlderMessages}
            onEndReachedThreshold={0.2}
            ListFooterComponent={loadMore ? <View style={styles.loadingMore}><ActivityIndicator size="small" color={ORANGE} /></View> : null}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        </Animated.View>

        <Animated.View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }, fadeUp(inputAnim, 20)]}>
          <TouchableOpacity style={styles.attachBtn} activeOpacity={0.7}>
            <Ionicons name="add" size={24} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.textInput}
              placeholder="Type your message..."
              placeholderTextColor="#9CA3AF"
              value={newMessage}
              onChangeText={setNewMessage}
              editable={!sending}
              multiline
              maxLength={500}
            />
          </View>

          <TouchableOpacity style={styles.attachBtn} activeOpacity={0.7}>
            <Ionicons name="camera-outline" size={22} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sendBtn, newMessage.trim() ? styles.sendBtnActive : styles.sendBtnDisabled]}
            onPress={sendMessage}
            disabled={sending || !newMessage.trim()}
            activeOpacity={0.7}
          >
            {sending ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="send" size={16} color="#FFFFFF" />}
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  flex: { flex: 1 },

  listHeader: {
    backgroundColor: ORANGE, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    shadowColor: ORANGE, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6,
  },
  listHeaderTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  mainTitle: { fontSize: 26, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.4 },
  countPill: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  countPillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  
  tabContainer: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 20, padding: 4 },
  tabButton: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 16 },
  tabButtonActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 },
  tabText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: ORANGE, fontWeight: '800' },

  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyIconCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#FFF7ED', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#111827', marginTop: 4, letterSpacing: -0.2 },
  emptySubtext: { fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 18, fontWeight: '500' },

  listContent: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  
  chatRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
    borderRadius: 16,
    borderWidth: 1, 
    borderColor: '#F3F4F6',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  chatRow: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingLeft: 12 },
  optionsButton: { paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center', alignItems: 'center' },
  
  avatarWrapper: { position: 'relative', marginRight: 14 },
  avatarFallback: { width: 54, height: 54, borderRadius: 27, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#F3F4F6' },
  avatarText: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#22C55E', borderWidth: 2.5, borderColor: '#FFFFFF' },

  chatInfo: { flex: 1, marginRight: 8 },
  chatNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  chatName: { fontSize: 15, fontWeight: '800', color: '#111827', letterSpacing: -0.2, flex: 1, marginRight: 8 },
  chatTime: { fontSize: 11, color: '#9CA3AF', fontWeight: '600' },
  chatTimeUnread: { color: ORANGE, fontWeight: '800' },
  chatMsgRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatLastMsg: { fontSize: 13, color: '#6B7280', flex: 1, fontWeight: '500' },
  chatLastMsgUnread: { color: '#111827', fontWeight: '700' },
  unreadBadge: { backgroundColor: ORANGE, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' },
  unreadBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },

  detailContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  detailHeader: { backgroundColor: ORANGE, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, gap: 10, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, shadowColor: ORANGE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  headerAvatarWrapper: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },
  headerAvatarImage: { width: 42, height: 42, borderRadius: 21 },
  headerAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center' },
  headerAvatarInitials: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  headerRoleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  headerRoleDot: { width: 6, height: 6, borderRadius: 3 },
  headerSubtitle: { fontSize: 11, color: '#FFE0C7', fontWeight: '600', letterSpacing: 0.2 },
  headerIconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },

  chatContent: { paddingHorizontal: 12, paddingVertical: 16, paddingBottom: 8 },
  dateSeparator: { flexDirection: 'row', alignItems: 'center', marginVertical: 16, paddingHorizontal: 24, gap: 10 },
  dateSeparatorLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dateSeparatorText: { fontSize: 11, color: '#9CA3AF', fontWeight: '700', letterSpacing: 0.3 },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4, paddingHorizontal: 4 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgAvatarSlot: { width: 32, marginRight: 8, justifyContent: 'flex-end' },
  avatarBadge: { position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#FFFFFF' },

  msgBubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  myMsg: { backgroundColor: ORANGE, borderBottomRightRadius: 6, shadowColor: ORANGE, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 2 },
  theirMsg: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 6, borderWidth: 1, borderColor: '#F3F4F6', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  msgText: { fontSize: 14.5, color: '#111827', lineHeight: 20, fontWeight: '500' },
  myMsgText: { color: '#FFFFFF' },
  msgMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4 },
  msgTime: { fontSize: 10, color: '#9CA3AF', fontWeight: '600' },
  myMsgTime: { color: 'rgba(255,255,255,0.85)' },
  loadingMore: { paddingVertical: 10, alignItems: 'center' },

  inputBar: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderColor: '#F3F4F6', alignItems: 'flex-end', backgroundColor: '#FFFFFF', gap: 6, shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 3 },
  attachBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  inputWrapper: { flex: 1, backgroundColor: '#F9FAFB', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4, borderWidth: 1, borderColor: '#E5E7EB', maxHeight: 100 },
  textInput: { minHeight: 36, maxHeight: 90, fontSize: 14, color: '#111827', fontWeight: '500', paddingTop: Platform.OS === 'ios' ? 8 : 4, paddingBottom: Platform.OS === 'ios' ? 8 : 4 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  sendBtnActive: { backgroundColor: ORANGE, shadowColor: ORANGE, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 3 },
  sendBtnDisabled: { backgroundColor: '#E5E7EB' },
});