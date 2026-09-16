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

const ORANGE = '#F27024';

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

/** Group messages by day for date separators */
const shouldShowDateSeparator = (current: ChatMessage, previous: ChatMessage | null) => {
  if (!previous) return true;
  const currDate = new Date(current.sent_at).toDateString();
  const prevDate = new Date(previous.sent_at).toDateString();
  return currDate !== prevDate;
};

const formatDateSeparator = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
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

  // Animations
  const listHeaderAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const detailHeaderAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;
  const inputAnim = useRef(new Animated.Value(0)).current;
  const sendScale = useRef(new Animated.Value(1)).current;

  /* ------------------------------------------------------------------ */
  /* Entrance animations                                                 */
  /* ------------------------------------------------------------------ */
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
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  const animateSendPressIn = () => {
    Animated.spring(sendScale, { toValue: 0.9, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animateSendPressOut = () => {
    Animated.spring(sendScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  /* ------------------------------------------------------------------ */
  /* Current user                                                        */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Fetch conversations                                                 */
  /* ------------------------------------------------------------------ */
  const fetchConversations = async () => {
    const userId = currentUserId.current || (await getCurrentUserId());
    if (!userId) { setLoading(false); setRefreshing(false); return; }
    currentUserId.current = userId;

    try {
      const { data: providerDeliveries } = await supabase
        .from('deliveries')
        .select('delivery_id')
        .eq('provider_id', userId);

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

  /* ------------------------------------------------------------------ */
  /* Fetch messages                                                      */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Open / close conversation                                           */
  /* ------------------------------------------------------------------ */
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
    Keyboard.dismiss();
    setSelectedRoom(null);
    setMessages([]);
  };

  /* ------------------------------------------------------------------ */
  /* Realtime for open room                                              */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Load older                                                          */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Send                                                                */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Auto-open from route param                                          */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Avatar helper                                                       */
  /* ------------------------------------------------------------------ */
  const renderAvatar = (party: Party, size: number, badgeColor?: string) => {
    const initials = `${party.first_name?.charAt(0) || '?'}${party.last_name?.charAt(0) || ''}`;
    return (
      <View style={{ width: size, height: size, position: 'relative' }}>
        {party.profile_photo ? (
          <Image
            source={{ uri: party.profile_photo }}
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: '#F3F4F6',
            }}
          />
        ) : (
          <View
            style={{
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: ORANGE,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: size * 0.38 }}>
              {initials}
            </Text>
          </View>
        )}
        {badgeColor && (
          <View
            style={[
              styles.avatarBadge,
              { backgroundColor: badgeColor },
            ]}
          >
            <Ionicons name="checkmark" size={8} color="#FFFFFF" />
          </View>
        )}
      </View>
    );
  };

  /* ------------------------------------------------------------------ */
  /* Renderers                                                           */
  /* ------------------------------------------------------------------ */
  const renderConversationItem = ({ item }: { item: ChatRoom }) => (
    <TouchableOpacity style={styles.chatRow} onPress={() => openConversation(item)} activeOpacity={0.7}>
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
        {/* Online dot */}
        <View style={styles.onlineDot} />
      </View>

      <View style={styles.chatInfo}>
        <View style={styles.chatNameRow}>
          <Text style={styles.chatName} numberOfLines={1}>
            {item.other.first_name} {item.other.last_name}
          </Text>
          {item.latest_sent_at && (
            <Text
              style={[
                styles.chatTime,
                item.unread_count > 0 && styles.chatTimeUnread,
              ]}
            >
              {formatChatTime(item.latest_sent_at)}
            </Text>
          )}
        </View>
        <View style={styles.chatMsgRow}>
          <Text
            style={[
              styles.chatLastMsg,
              item.unread_count > 0 && styles.chatLastMsgUnread,
            ]}
            numberOfLines={1}
          >
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
  );

  /**
   * Messenger-style message row:
   * - Own messages: bubble aligned right, NO avatar
   * - Other messages: avatar on LEFT, bubble aligned left
   * - Consecutive messages from same sender hide the avatar for a cleaner look
   */
  const renderMessageItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.sender_id === currentUserId.current;
    const previous = index > 0 ? messages[index - 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, previous);

    // Show avatar if this is the first message in a group from this sender
    const prevSameSender = previous && previous.sender_id === item.sender_id;
    const showAvatar = !isMe && !prevSameSender;

    return (
      <View>
        {/* Date separator */}
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateSeparatorLine} />
            <Text style={styles.dateSeparatorText}>
              {formatDateSeparator(item.sent_at)}
            </Text>
            <View style={styles.dateSeparatorLine} />
          </View>
        )}

        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          {/* Other party's avatar (only on first message of group) */}
          {!isMe && (
            <View style={styles.msgAvatarSlot}>
              {showAvatar ? (
                renderAvatar(selectedRoom!.other, 32)
              ) : (
                <View style={{ width: 32 }} />
              )}
            </View>
          )}

          {/* Bubble */}
          <View
            style={[
              styles.msgBubble,
              isMe ? styles.myMsg : styles.theirMsg,
            ]}
          >
            <Text style={[styles.msgText, isMe && styles.myMsgText]}>
              {item.message}
            </Text>
            <View style={styles.msgMeta}>
              <Text style={[styles.msgTime, isMe && styles.myMsgTime]}>
                {new Date(item.sent_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Text>
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

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={ORANGE} />
        <View style={styles.listHeader}>
          <Text style={styles.headerSub}>Inbox</Text>
          <Text style={styles.mainTitle}>Messages</Text>
        </View>
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={ORANGE} />
          <Text style={styles.loadingText}>Loading conversations...</Text>
        </View>
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Conversations List                                                  */
  /* ------------------------------------------------------------------ */
  if (!selectedRoom) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

        <Animated.View style={[styles.listHeader, fadeUp(listHeaderAnim, -14)]}>
          <Text style={styles.headerSub}>Inbox</Text>
          <View style={styles.listHeaderRow}>
            <Text style={styles.mainTitle}>Messages</Text>
            {conversations.length > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{conversations.length}</Text>
              </View>
            )}
          </View>
        </Animated.View>

        {conversations.length === 0 ? (
          <Animated.View style={[styles.emptyContainer, fadeUp(listAnim, 20)]}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="chatbubbles-outline" size={40} color={ORANGE} />
            </View>
            <Text style={styles.emptyTitle}>No conversations yet</Text>
            <Text style={styles.emptySubtext}>
              Your messages with providers or senders will appear here.
            </Text>
          </Animated.View>
        ) : (
          <Animated.View style={{ flex: 1, opacity: listAnim }}>
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.room_id.toString()}
              renderItem={renderConversationItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={fetchConversations}
                  tintColor={ORANGE}
                  colors={[ORANGE]}
                />
              }
            />
          </Animated.View>
        )}
      </SafeAreaView>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Conversation Detail                                                 */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.detailContainer}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[styles.detailHeader, { paddingTop: insets.top + 12 }, fadeUp(detailHeaderAnim, -14)]}
      >
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
            <View
              style={[
                styles.headerRoleDot,
                { backgroundColor: selectedRoom.role === 'sender' ? '#93C5FD' : '#86EFAC' },
              ]}
            />
            <Text style={styles.headerSubtitle}>
              {selectedRoom.role === 'sender' ? 'Provider' : 'Sender'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.headerIconBtn} activeOpacity={0.85}>
          <Ionicons name="call-outline" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Keyboard-aware body */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        {/* Messages */}
        <Animated.View style={[styles.flex, { opacity: detailAnim }]}>
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.message_id.toString()}
            renderItem={renderMessageItem}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={loadOlderMessages}
            onEndReachedThreshold={0.2}
            ListFooterComponent={
              loadMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={ORANGE} />
                </View>
              ) : null
            }
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        </Animated.View>

        {/* Input Bar */}
        <Animated.View
          style={[
            styles.inputBar,
            { paddingBottom: Math.max(insets.bottom, 12) },
            fadeUp(inputAnim, 20),
          ]}
        >
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

          <Animated.View style={{ transform: [{ scale: sendScale }] }}>
            <TouchableOpacity
              style={[
                styles.sendBtn,
                newMessage.trim() ? styles.sendBtnActive : styles.sendBtnDisabled,
              ]}
              onPress={sendMessage}
              onPressIn={animateSendPressIn}
              onPressOut={animateSendPressOut}
              disabled={sending || !newMessage.trim()}
              activeOpacity={0.9}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="send" size={16} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  flex: { flex: 1 },

  /* ------------------------------------------------------------------ */
  /* List Header                                                         */
  /* ------------------------------------------------------------------ */
  listHeader: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  headerSub: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mainTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  countPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  countPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  centerLoader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Empty State                                                         */
  /* ------------------------------------------------------------------ */
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
    letterSpacing: -0.2,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
    fontWeight: '500',
  },

  /* ------------------------------------------------------------------ */
  /* Conversation List                                                   */
  /* ------------------------------------------------------------------ */
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  avatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: ORANGE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F3F4F6',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22C55E',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },

  chatInfo: {
    flex: 1,
    marginRight: 8,
  },
  chatNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
    flex: 1,
    marginRight: 8,
  },
  chatTime: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  chatTimeUnread: {
    color: ORANGE,
    fontWeight: '800',
  },
  chatMsgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chatLastMsg: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
    fontWeight: '500',
  },
  chatLastMsgUnread: {
    color: '#111827',
    fontWeight: '700',
  },
  unreadBadge: {
    backgroundColor: ORANGE,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
  },

  /* ------------------------------------------------------------------ */
  /* Conversation Detail                                                 */
  /* ------------------------------------------------------------------ */
  detailContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  detailHeader: {
    backgroundColor: ORANGE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerAvatarWrapper: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  headerAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  headerInfo: { flex: 1 },
  headerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  headerRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  headerRoleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },

  /* ------------------------------------------------------------------ */
  /* Messages — Messenger-style with chat heads                          */
  /* ------------------------------------------------------------------ */
  chatContent: {
    paddingHorizontal: 12,
    paddingVertical: 16,
    paddingBottom: 8,
  },

  /* Date separator */
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    paddingHorizontal: 24,
    gap: 10,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dateSeparatorText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  msgRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  msgRowMe: {
    justifyContent: 'flex-end',
  },

  /* The avatar slot on the left of received messages */
  msgAvatarSlot: {
    width: 32,
    marginRight: 8,
    justifyContent: 'flex-end',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  msgBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  myMsg: {
    backgroundColor: ORANGE,
    borderBottomRightRadius: 6,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  theirMsg: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  msgText: {
    fontSize: 14.5,
    color: '#111827',
    lineHeight: 20,
    fontWeight: '500',
  },
  myMsgText: {
    color: '#FFFFFF',
  },
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  msgTime: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  myMsgTime: {
    color: 'rgba(255,255,255,0.85)',
  },
  loadingMore: {
    paddingVertical: 10,
    alignItems: 'center',
  },

  /* ------------------------------------------------------------------ */
  /* Input Bar                                                           */
  /* ------------------------------------------------------------------ */
  inputBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#F3F4F6',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 3,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  inputWrapper: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 100,
  },
  textInput: {
    minHeight: 36,
    maxHeight: 90,
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    paddingTop: Platform.OS === 'ios' ? 8 : 4,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnActive: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  sendBtnDisabled: {
    backgroundColor: '#E5E7EB',
  },
});