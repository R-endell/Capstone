// src/modules/Dashboard/Sender/MessagesScreen.tsx
import React, {
  useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo,
} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList,
  Platform, ActivityIndicator, Alert, Image, RefreshControl,
  Animated, Easing, StatusBar, Keyboard, KeyboardAvoidingView, BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect, useRoute, useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';
import { formatDate } from '../../../utils/dateUtils';

const ORANGE = '#F27024';
const PAGE_SIZE = 30;

// Style applied to the bottom tab bar while a chat is open.
const TAB_BAR_HIDDEN_STYLE = { display: 'none' as const };
// Style restored when the chat is closed. `undefined` = fall back to the navigator's default.
// If your tab bar has a custom `tabBarStyle`, put the same object here so it is restored exactly.
const TAB_BAR_VISIBLE_STYLE: any = undefined;

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

// `previous` = the message that appears right before `current` in time (the older one)
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

const sortByLatest = (list: ChatRoom[]) =>
  [...list].sort((a, b) => {
    const aT = a.latest_sent_at ? new Date(a.latest_sent_at).getTime() : 0;
    const bT = b.latest_sent_at ? new Date(b.latest_sent_at).getTime() : 0;
    return bT - aT;
  });

const messageKey = (m: ChatMessage) =>
  m._temp_id !== undefined ? `temp-${m._temp_id}` : `msg-${m.message_id}`;

// Merge two message lists (dedupe) and keep them in ascending (oldest -> newest) order
const mergeMessages = (a: ChatMessage[], b: ChatMessage[]) => {
  const map = new Map<string, ChatMessage>();
  [...a, ...b].forEach(m => map.set(messageKey(m), m));
  return Array.from(map.values()).sort(
    (x, y) => new Date(x.sent_at).getTime() - new Date(y.sent_at).getTime()
  );
};

// Finds every navigator in the parent chain that is a tab navigator
const getTabNavigations = (nav: any): any[] => {
  const found: any[] = [];
  let current = nav;
  while (current) {
    try {
      if (current.getState?.()?.type === 'tab') found.push(current);
    } catch {
      /* ignore */
    }
    current = current.getParent?.();
  }
  if (found.length === 0) {
    // Fallback: apply to this screen and its direct parent
    [nav, nav?.getParent?.()].forEach(n => n && found.push(n));
  }
  return found;
};

export default function MessagesScreen({ route: propsRoute }: any) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const openRoomIdParam: number | undefined =
    propsRoute?.params?.openRoomId ?? route.params?.openRoomId;

  const [activeTab, setActiveTab] = useState<'messages' | 'notification'>('messages');

  const [conversations, setConversations] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]); // ascending (oldest -> newest)
  const [chatLoading, setChatLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [loadMore, setLoadMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const flatListRef = useRef<FlatList>(null);
  const currentUserId = useRef<number | null>(null);
  const subscription = useRef<any>(null);
  const roomsSubscription = useRef<any>(null);
  const autoOpenHandled = useRef<number | null>(null);
  const autoOpenFetched = useRef<number | null>(null);
  const openToken = useRef(0);
  const loadingOlder = useRef(false);
  const openRoomIdRef = useRef<number | undefined>(openRoomIdParam);
  openRoomIdRef.current = openRoomIdParam;

  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const tabBarHidden = useRef(false);

  const listHeaderAnim = useRef(new Animated.Value(0)).current;
  const listAnim = useRef(new Animated.Value(0)).current;
  const detailHeaderAnim = useRef(new Animated.Value(0)).current;
  const detailAnim = useRef(new Animated.Value(0)).current;
  const inputAnim = useRef(new Animated.Value(0)).current;

  // Newest first, used by the inverted chat list (so the latest message is always shown first)
  const displayMessages = useMemo(() => [...messages].reverse(), [messages]);

  // ---------------------------------------------------------------------------
  // Bottom tab bar: hidden ONLY while a specific chat is open
  // ---------------------------------------------------------------------------
  const setTabBarHidden = useCallback((hidden: boolean) => {
    if (tabBarHidden.current === hidden) return;
    tabBarHidden.current = hidden;
    getTabNavigations(navigationRef.current).forEach(nav => {
      try {
        nav.setOptions({ tabBarStyle: hidden ? TAB_BAR_HIDDEN_STYLE : TAB_BAR_VISIBLE_STYLE });
      } catch {
        /* ignore */
      }
    });
  }, []);

  useLayoutEffect(() => {
    setTabBarHidden(isFocused && !!selectedRoom);
  }, [isFocused, selectedRoom, setTabBarHidden]);

  // Always bring the tab bar back when this screen unmounts
  useEffect(() => {
    return () => setTabBarHidden(false);
  }, [setTabBarHidden]);

  // Android hardware back: close the chat first
  useEffect(() => {
    const backAction = () => {
      if (selectedRoom) {
        closeConversation();
        return true;
      }
      return false;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedRoom]);

  // Fetch conversations when screen gains focus
  useFocusEffect(
    useCallback(() => {
      // Coming back to the tab always shows the inbox, unless we are auto-opening a room
      if (!openRoomIdRef.current) {
        openToken.current++;
        setSelectedRoom(null);
        setMessages([]);
        setChatLoading(false);
      }
      fetchConversations();

      return () => {
        if (subscription.current) {
          supabase.removeChannel(subscription.current);
          subscription.current = null;
        }
        StatusBar.setBarStyle('dark-content', true);
      };
    }, [])
  );

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 400) =>
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
        animate(detailAnim, 100),
        animate(inputAnim, 150),
      ]).start();
    }
  }, [selectedRoom, listHeaderAnim, listAnim, detailHeaderAnim, detailAnim, inputAnim]);

  const fadeUp = (value: Animated.Value, distance = 15) => ({
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
        .select('room_id, is_deleted')
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
        return;
      }

      const { data: rooms, error: roomError } = await supabase.from('chat_rooms').select('room_id, delivery_id').in('delivery_id', deliveryIds);
      if (roomError) throw roomError;
      if (!rooms || rooms.length === 0) {
        setConversations([]);
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

      const built = await Promise.all(
        rooms.map(async (room): Promise<ChatRoom | null> => {
          const rState = stateMap.get(room.room_id);
          if (rState?.is_deleted) return null;

          const d: any = (deliveriesInfo || []).find((x: any) => x.delivery_id === room.delivery_id);
          if (!d) return null;
          const req = Array.isArray(d.delivery_requests) ? d.delivery_requests[0] : d.delivery_requests;
          const provider: Party | null = Array.isArray(d.provider) ? d.provider[0] : d.provider;
          const sender: Party | null = Array.isArray(req?.sender) ? req.sender[0] : req?.sender;

          const isMeProvider = d.provider_id === userId;
          const other: Party | null = isMeProvider ? sender : provider;
          if (!other) return null;

          const [latestResult, unreadResult] = await Promise.all([
            supabase.from('chat_messages').select('message, sent_at').eq('room_id', room.room_id).order('sent_at', { ascending: false }).limit(1).maybeSingle(),
            supabase.from('chat_messages').select('*', { count: 'exact', head: true }).eq('room_id', room.room_id).neq('sender_id', userId).eq('is_read', false),
          ]);

          return {
            room_id: room.room_id,
            all_room_ids: [room.room_id],
            delivery_id: room.delivery_id,
            other,
            role: isMeProvider ? 'provider' : 'sender',
            latest_message: latestResult.data?.message || null,
            latest_sent_at: latestResult.data?.sent_at || null,
            unread_count: unreadResult.count || 0,
          };
        })
      );

      const list = sortByLatest(built.filter((c): c is ChatRoom => c !== null));

      // Merge rooms that belong to the same person into one conversation (latest room is the main one)
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

  const handleRefresh = () => {
    setRefreshing(true);
    fetchConversations();
  };

  // Returns messages in ascending order (oldest -> newest)
  const fetchMessages = async (roomIds: number[], olderThan?: string) => {
    let query = supabase
      .from('chat_messages')
      .select('*')
      .in('room_id', roomIds)
      .order('sent_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (olderThan) query = query.lt('sent_at', olderThan);
    const { data, error } = await query;
    if (error) { console.error(error); return []; }
    return (data || [])
      .map((m: any) => ({ ...m, _temp_id: undefined }))
      .reverse() as ChatMessage[];
  };

  const subscribeToRoom = (roomIds: number[]) => {
    if (subscription.current) { supabase.removeChannel(subscription.current); subscription.current = null; }
    subscription.current = supabase
      .channel(`chat-room-active-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        const incoming = payload.new as ChatMessage;
        if (!roomIds.includes(incoming.room_id)) return;

        const isMine = incoming.sender_id === currentUserId.current;
        const newMsg: ChatMessage = isMine ? incoming : { ...incoming, is_read: true };

        setMessages(prev => {
          if (prev.some(m => m._temp_id === undefined && m.message_id === newMsg.message_id)) return prev;
          const tempIdx = prev.findIndex(m => m._temp_id !== undefined && m.sender_id === newMsg.sender_id && m.message === newMsg.message);
          if (tempIdx !== -1) {
            const next = [...prev];
            next[tempIdx] = { ...newMsg, _temp_id: undefined };
            return next;
          }
          return [...prev, newMsg];
        });

        setConversations(prev =>
          sortByLatest(
            prev.map(c =>
              c.all_room_ids.includes(newMsg.room_id)
                ? { ...c, latest_message: newMsg.message, latest_sent_at: newMsg.sent_at }
                : c
            )
          )
        );

        if (!isMine) {
          // NOTE: Supabase queries only run when awaited / .then() is called
          supabase
            .from('chat_messages')
            .update({ is_read: true })
            .eq('message_id', newMsg.message_id)
            .then(() => {}, (e: any) => console.warn('Mark read error:', e));
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (payload) => {
        const updated = payload.new as ChatMessage;
        if (!roomIds.includes(updated.room_id)) return;
        setMessages(prev =>
          prev.map(m =>
            m._temp_id === undefined && m.message_id === updated.message_id
              ? { ...m, is_read: updated.is_read }
              : m
          )
        );
      })
      .subscribe();
  };

  const openConversation = async (room: ChatRoom) => {
    const token = ++openToken.current;

    // Reset chat state so the newest messages are loaded fresh and shown at the bottom
    setMessages([]);
    setHasMore(true);
    setLoadMore(false);
    loadingOlder.current = false;
    setChatLoading(true);
    setSelectedRoom(room);

    // Subscribe first so nothing is missed while the history is loading
    subscribeToRoom(room.all_room_ids);

    const latest = await fetchMessages(room.all_room_ids);
    if (token !== openToken.current) return; // chat was closed / another one was opened

    setMessages(prev => mergeMessages(latest, prev));
    setHasMore(latest.length >= PAGE_SIZE);
    setChatLoading(false);

    if (currentUserId.current) {
      try {
        await supabase
          .from('chat_messages')
          .update({ is_read: true })
          .in('room_id', room.all_room_ids)
          .neq('sender_id', currentUserId.current)
          .eq('is_read', false);
      } catch (e) {
        console.warn('Mark read error:', e);
      }
      if (token !== openToken.current) return;
      setConversations(prev => prev.map(c => (c.room_id === room.room_id ? { ...c, unread_count: 0 } : c)));
    }
  };

  const closeConversation = () => {
    openToken.current++;
    if (subscription.current) { supabase.removeChannel(subscription.current); subscription.current = null; }
    Keyboard.dismiss();
    setSelectedRoom(null);
    setMessages([]);
    setChatLoading(false);
    setNewMessage('');
  };

  const loadOlderMessages = async () => {
    if (loadingOlder.current || !hasMore || !selectedRoom || chatLoading) return;
    const oldest = messages.find(m => m._temp_id === undefined);
    if (!oldest) return;

    loadingOlder.current = true;
    setLoadMore(true);
    const older = await fetchMessages(selectedRoom.all_room_ids, oldest.sent_at);
    if (older.length < PAGE_SIZE) setHasMore(false);
    if (older.length > 0) setMessages(prev => mergeMessages(older, prev));
    setLoadMore(false);
    loadingOlder.current = false;
  };

  const scrollToLatest = (animated = true) => {
    // The chat list is inverted, so offset 0 is the newest message
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  };

  const sendMessage = async () => {
    const trimmed = newMessage.trim();
    if (!trimmed || !selectedRoom || !currentUserId.current) return;

    const roomId = selectedRoom.room_id;
    const allRoomIds = selectedRoom.all_room_ids;
    const tempId = Date.now();
    const tempMsg: ChatMessage = {
      message_id: tempId, room_id: roomId, message: trimmed, sent_at: new Date().toISOString(),
      sender_id: currentUserId.current, is_read: false, _temp_id: tempId,
    };
    setMessages(prev => [...prev, tempMsg]);
    setNewMessage('');
    setTimeout(() => scrollToLatest(true), 50);

    try {
      const { data, error } = await supabase.from('chat_messages').insert({
        message: trimmed, room_id: roomId, sender_id: currentUserId.current,
      }).select('*').single();
      if (error) throw error;

      await supabase.from('chat_room_states').upsert(
        allRoomIds.map(id => ({
          room_id: id,
          user_id: currentUserId.current,
          is_deleted: false,
        }))
      );

      setMessages(prev => {
        const hasReal = prev.some(m => m._temp_id === undefined && m.message_id === data.message_id);
        if (hasReal) return prev.filter(m => m._temp_id !== tempId); // realtime already replaced it
        return prev.map(m => (m._temp_id === tempId ? { ...data, _temp_id: undefined } : m));
      });
      setConversations(prev =>
        sortByLatest(
          prev.map(c =>
            c.all_room_ids.includes(roomId)
              ? { ...c, latest_message: trimmed, latest_sent_at: data.sent_at }
              : c
          )
        )
      );
    } catch (error: any) {
      console.error('Send error:', error);
      Alert.alert('Error', 'Unable to send message.');
      setMessages(prev => prev.filter(m => m._temp_id !== tempId));
      setNewMessage(trimmed);
    }
  };

  const openChatOptions = (room: ChatRoom) => {
    Alert.alert(
      'Conversation Options',
      `Manage chat with ${room.other.first_name}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Chat', style: 'destructive', onPress: () => deleteChat(room) },
      ]
    );
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
              }));
              await supabase.from('chat_room_states').upsert(payloads);
            } catch (error) {
              console.error('Error deleting chat:', error);
              fetchConversations();
            }
          },
        },
      ]
    );
  };

  // Auto-open a chat when navigated here with `openRoomId`
  useEffect(() => {
    if (!openRoomIdParam) {
      autoOpenHandled.current = null;
      autoOpenFetched.current = null;
      return;
    }
    if (loading) return;
    if (autoOpenHandled.current === openRoomIdParam) return;

    const target = conversations.find(c => c.all_room_ids.includes(openRoomIdParam));
    if (target) {
      autoOpenHandled.current = openRoomIdParam;
      // Consume the param so clicking the Messages tab later never re-opens this chat
      navigation.setParams({ openRoomId: undefined });
      openConversation(target);
      return;
    }

    // Room not in the list yet (e.g. it was just created) - refresh once and look again
    if (autoOpenFetched.current !== openRoomIdParam) {
      autoOpenFetched.current = openRoomIdParam;
      fetchConversations();
    }
  }, [openRoomIdParam, conversations, loading]);

  // Realtime updates for the inbox list
  useEffect(() => {
    roomsSubscription.current = supabase
      .channel(`chat-rooms-list-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_rooms' }, () => fetchConversations())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, () => fetchConversations())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, () => fetchConversations())
      .subscribe();

    return () => {
      if (roomsSubscription.current) supabase.removeChannel(roomsSubscription.current);
      if (subscription.current) supabase.removeChannel(subscription.current);
    };
  }, []);

  const renderAvatar = (party: Party, size: number, badgeColor?: string) => {
    const initial = party.first_name ? party.first_name.charAt(0).toUpperCase() : '?';

    return (
      <View style={{ width: size, height: size, position: 'relative' }}>
        {party.profile_photo ? (
          <Image
            source={{ uri: party.profile_photo }}
            style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ORANGE }}
          />
        ) : (
          <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ORANGE, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.45 }}>{initial}</Text>
          </View>
        )}
        {badgeColor && (
          <View style={[styles.avatarBadge, { backgroundColor: badgeColor }]}>
            <Ionicons name="checkmark" size={size * 0.25} color="#FFFFFF" />
          </View>
        )}
      </View>
    );
  };

  const renderConversationItem = ({ item }: { item: ChatRoom }) => {
    const isUnread = item.unread_count > 0;

    return (
      <View style={styles.chatRowWrapper}>
        <TouchableOpacity
          style={[styles.inboxItem, isUnread && styles.inboxItemUnread]}
          onPress={() => openConversation(item)}
          activeOpacity={0.7}
          onLongPress={() => openChatOptions(item)}
        >
          <View style={styles.inboxAvatarWrapper}>
            {renderAvatar(item.other, 48)}
            {isUnread && <View style={styles.unreadDotIndicator} />}
          </View>

          <View style={styles.inboxInfo}>
            <View style={styles.inboxHeaderRow}>
              <Text style={[styles.inboxName, isUnread && styles.inboxNameUnread]} numberOfLines={1}>
                {item.other.first_name} {item.other.last_name}
              </Text>
              {item.latest_sent_at && (
                <Text style={[styles.inboxTime, isUnread && styles.inboxTimeUnread]}>
                  {formatChatTime(item.latest_sent_at)}
                </Text>
              )}
            </View>
            <View style={styles.inboxMsgRow}>
              <Text style={[styles.inboxLastMsg, isUnread && styles.inboxLastMsgUnread]} numberOfLines={2}>
                {item.latest_message || 'No messages yet'}
              </Text>
              {isUnread && (
                <View style={styles.unreadBadgeMoveIt}>
                  <Text style={styles.unreadBadgeMoveItText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.optionsButton}
          onPress={() => openChatOptions(item)}
          activeOpacity={0.6}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    );
  };

  // The chat list is inverted: index 0 = newest message, index + 1 = the older neighbour
  const renderMessageItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.sender_id === currentUserId.current;
    const older = index + 1 < displayMessages.length ? displayMessages[index + 1] : null;
    const showDateSeparator = shouldShowDateSeparator(item, older);
    const olderSameSender = older && older.sender_id === item.sender_id;
    const showAvatar = !isMe && !olderSameSender;

    return (
      <View>
        {showDateSeparator && (
          <View style={styles.dateSeparator}>
            <Text style={styles.dateSeparatorText}>{formatDateSeparator(item.sent_at)}</Text>
          </View>
        )}

        <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
          {!isMe && (
            <View style={styles.msgAvatarSlot}>
              {showAvatar ? renderAvatar(selectedRoom!.other, 28) : <View style={{ width: 28 }} />}
            </View>
          )}

          <View style={[styles.msgBubble, isMe ? styles.myMsg : styles.theirMsg]}>
            <Text style={[styles.msgText, isMe && styles.myMsgText]}>{item.message}</Text>
            <View style={styles.msgMeta}>
              <Text style={[styles.msgTime, isMe && styles.myMsgTime]}>{formatDate(item.sent_at, 'h:mm a')}</Text>
              {isMe && (
                <Ionicons
                  name={item.is_read ? 'checkmark-done' : 'checkmark'}
                  size={14}
                  color={item.is_read ? '#FFFFFF' : 'rgba(255,255,255,0.7)'}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    );
  };

  // Header UI copied from the Provider Messages screen
  const renderTabHeader = () => (
    <View style={styles.listHeaderFlat}>
      <View style={styles.headerTopRow}>
        <Text style={styles.mainTitle}>Messages</Text>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'messages' && styles.tabButtonActive]}
          onPress={() => setActiveTab('messages')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'messages' && styles.tabTextActive]}>Messages</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'notification' && styles.tabButtonActive]}
          onPress={() => setActiveTab('notification')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'notification' && styles.tabTextActive]}>Notification</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  // If a chat room is open, render the active chat view
  if (selectedRoom) {
    return (
      <View style={styles.detailContainer}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

        <SafeAreaView edges={['top']} style={{ backgroundColor: ORANGE }}>
          <Animated.View style={[styles.chatHeaderFlat, fadeUp(detailHeaderAnim, -10)]}>
            <TouchableOpacity onPress={closeConversation} style={styles.backBtnFlat} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={28} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.chatHeaderInfo}>
              <Text style={styles.chatHeaderName} numberOfLines={1}>
                {selectedRoom.other.first_name} {selectedRoom.other.last_name}
              </Text>
              <Text style={styles.chatHeaderSubtitle}>
                {selectedRoom.role === 'sender' ? 'Provider' : 'Sender'}
              </Text>
            </View>

            <TouchableOpacity style={styles.callBtnFlat} activeOpacity={0.7}>
              <Ionicons name="call" size={22} color={ORANGE} />
            </TouchableOpacity>
          </Animated.View>
        </SafeAreaView>

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Animated.View style={[styles.flex, { opacity: detailAnim, backgroundColor: '#F9FAFB' }]}>
            {chatLoading ? (
              <View style={styles.centerLoader}>
                <ActivityIndicator size="small" color={ORANGE} />
              </View>
            ) : (
              <FlatList
                ref={flatListRef}
                data={displayMessages}
                inverted
                keyExtractor={messageKey}
                renderItem={renderMessageItem}
                contentContainerStyle={styles.chatContentArea}
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
              />
            )}
          </Animated.View>

          <Animated.View style={[styles.inputContainerFlat, { paddingBottom: Math.max(insets.bottom, 12) }, fadeUp(inputAnim, 15)]}>
            <TouchableOpacity style={styles.attachBtnFlat} activeOpacity={0.7}>
              <Ionicons name="add-circle" size={32} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.inputWrapperFlat}>
              <TextInput
                style={styles.textInputFlat}
                placeholder="Type a message..."
                placeholderTextColor="#9CA3AF"
                value={newMessage}
                onChangeText={setNewMessage}
                onFocus={() => setTimeout(() => scrollToLatest(true), 150)}
                multiline
                maxLength={500}
              />
            </View>

            <TouchableOpacity
              style={[styles.sendBtnFlat, !newMessage.trim() && { opacity: 0.5 }]}
              onPress={sendMessage}
              disabled={!newMessage.trim()}
              activeOpacity={0.7}
            >
              <Ionicons name="send" size={24} color={ORANGE} />
            </TouchableOpacity>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // Inbox screen with Messages & Notification tabs (bottom tab bar stays visible here)
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <Animated.View style={fadeUp(listHeaderAnim, -10)}>
        <View style={styles.listHeaderFlat}>
          <View style={styles.headerTopRow}>
            <Text style={styles.mainTitle}>Messages</Text>
          </View>

          <View style={styles.tabContainer}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'messages' && styles.tabButtonActive]}
              onPress={() => setActiveTab('messages')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'messages' && styles.tabTextActive]}>Messages</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'notification' && styles.tabButtonActive]}
              onPress={() => setActiveTab('notification')}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === 'notification' && styles.tabTextActive]}>Notification</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {loading ? (
        <View style={styles.centerLoader}>
          <ActivityIndicator size="large" color={ORANGE} />
        </View>
      ) : activeTab === 'messages' ? (
        <Animated.View style={[styles.flex, fadeUp(listAnim, 15)]}>
        {conversations.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles-outline" size={48} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtext}>When you contact a provider or sender, your conversation will show up here.</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.room_id.toString()}
              renderItem={renderConversationItem}
              contentContainerStyle={styles.listContentFlat}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={ORANGE} />}
            />
          </View>
        )}
        </Animated.View>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-outline" size={48} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Notifications</Text>
          <Text style={styles.emptySubtext}>Your notifications and updates will appear here soon.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },

  listHeaderFlat: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  mainTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 12,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: ORANGE,
    fontWeight: '800',
  },

  centerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginTop: 16, letterSpacing: -0.2 },
  emptySubtext: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 8, lineHeight: 20 },

  listContentFlat: { paddingBottom: 24, paddingTop: 8 },

  chatRowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
  },

  inboxItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
  },
  inboxItemUnread: {
    backgroundColor: '#F9FAFB',
  },
  inboxAvatarWrapper: {
    marginRight: 16,
    position: 'relative',
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
  unreadDotIndicator: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ORANGE,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  inboxInfo: { flex: 1, justifyContent: 'center' },
  inboxHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  inboxName: { fontSize: 16, fontWeight: '600', color: '#111827', flex: 1, marginRight: 8 },
  inboxNameUnread: { fontWeight: '700' },
  inboxTime: { fontSize: 12, color: '#9CA3AF', fontWeight: '500' },
  inboxTimeUnread: { color: ORANGE, fontWeight: '600' },
  inboxMsgRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  inboxLastMsg: { fontSize: 14, color: '#6B7280', flex: 1, lineHeight: 20 },
  inboxLastMsgUnread: { color: '#374151', fontWeight: '600' },
  unreadBadgeMoveIt: { backgroundColor: ORANGE, borderRadius: 10, paddingHorizontal: 6, height: 20, minWidth: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  unreadBadgeMoveItText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  optionsButton: { paddingHorizontal: 16, paddingVertical: 14, justifyContent: 'center', alignItems: 'center' },

  // Detail Screen Flat Header
  detailContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  chatHeaderFlat: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ORANGE,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  backBtnFlat: { padding: 4, marginRight: 8, marginLeft: -8 },
  chatHeaderInfo: { flex: 1 },
  chatHeaderName: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 },
  chatHeaderSubtitle: { fontSize: 13, color: '#FFE4D2', marginTop: 2, fontWeight: '500' },
  callBtnFlat: { padding: 8, backgroundColor: '#FFFFFF', borderRadius: 20 },

  // Chat Content (list is inverted, so top/bottom padding are swapped:
  // paddingTop = space under the newest message, paddingBottom = space above the oldest one)
  chatContentArea: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32 },
  dateSeparator: { alignItems: 'center', marginVertical: 16 },
  dateSeparatorText: { fontSize: 12, color: '#9CA3AF', fontWeight: '600' },

  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgAvatarSlot: { marginRight: 8, paddingBottom: 2 },

  msgBubble: { maxWidth: '78%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18 },
  myMsg: {
    backgroundColor: ORANGE,
    borderBottomRightRadius: 4,
  },
  theirMsg: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  msgText: { fontSize: 15, lineHeight: 22 },
  myMsgText: { color: '#FFFFFF' },
  msgMeta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4 },
  msgTime: { fontSize: 11, color: '#9CA3AF' },
  myMsgTime: { color: 'rgba(255,255,255,0.7)' },
  loadingMore: { paddingVertical: 12 },

  // Bottom Input Bar
  inputContainerFlat: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  attachBtnFlat: { paddingBottom: 8, marginRight: 8 },
  inputWrapperFlat: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 16,
    marginBottom: 8,
    minHeight: 40,
    maxHeight: 120,
    justifyContent: 'center',
  },
  textInputFlat: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
  },
  sendBtnFlat: { paddingBottom: 10, paddingLeft: 12, paddingRight: 4 },
});