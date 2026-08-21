import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Dimensions
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../utils/supabase';

const { width } = Dimensions.get('window');

// Mock data to match Screenshot 1 perfectly
const MOCK_CHATS = [
  { id: 'm1', name: 'Jun Joseph Pestaño', lastMsg: 'Hello sir on the way nako', time: '6:30 PM', vehicle: 'NDA-1234 • Honda Civic RS Turbo' },
  { id: 'm2', name: 'Rendell James Lumindas', lastMsg: 'Hello sir on the way nako', time: '10:15 AM' },
  { id: 'm3', name: 'Moises Padriga', lastMsg: 'Naa nako', time: 'Wed' },
  { id: 'm4', name: 'Kenchi Otida', lastMsg: 'Asa ka sir?', time: 'Tue' },
  { id: 'm5', name: 'Chris Canete', lastMsg: 'Traffic pa sir sorry kaayo', time: 'Mon' },
  { id: 'm6', name: 'Bryan Nikole Dionson', lastMsg: 'Thank you sir mayng gabie', time: 'Sun' },
];

// Mock messages for Jun Joseph's room to match Screenshot 2
const INITIAL_MESSAGES = [
  { id: 'sys1', type: 'system', text: 'Welcome to Pack-N-Ship!' },
  { 
    id: 'req1', 
    type: 'match_request', 
    title: 'Match Request Sent', 
    text: "You requested to match your requested delivery to Jun Joseph's route to Gaisano Country Mall.", 
    status: 'Waiting for confirmation' 
  },
  { id: 'msg1', type: 'me', text: 'Hello sir, pwede nmo mahapit?' },
];

export default function MessagesScreen({ navigation: navProp }: any) {
  const navigation = useNavigation<any>();
  const [chats, setChats] = useState<any[]>(MOCK_CHATS);
  const [loading, setLoading] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const fetchChats = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
    };
    const unsubscribe = navProp.addListener('focus', fetchChats);
    return unsubscribe;
  }, []);

  const openChat = (item: any) => {
    setSelectedRoom(item);
    setMessages(INITIAL_MESSAGES);
  };

  const sendMessage = () => {
    if (!newMsg.trim()) return;
    const msg = { id: Date.now().toString(), type: 'me', text: newMsg.trim() };
    setMessages(prev => [...prev, msg]);
    setNewMsg('');
  };

  const renderMessage = ({ item }: any) => {
    if (item.type === 'system') {
      return (
        <Text style={styles.systemText}>{item.text}</Text>
      );
    }

    if (item.type === 'match_request') {
      return (
        <View style={styles.matchRequestWrapper}>
          <View style={styles.matchRequestShadow}>
            <View style={styles.matchRequestInner}>
              <View style={styles.matchRow}>
                <Ionicons name="swap-horizontal" size={24} color="#000" style={styles.matchIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.matchTitle}>{item.title}</Text>
                  <Text style={styles.matchText}>{item.text}</Text>
                  
                  <View style={styles.statusPill}>
                    <Ionicons name="time-outline" size={14} color="#000" />
                    <Text style={styles.statusText}>{item.status}</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
          <TouchableOpacity>
            <Text style={styles.cancelText}>Cancel Request</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const isMe = item.type === 'me';
    return (
      <View style={[styles.msgBubble, isMe ? styles.myMsg : styles.theirMsg]}>
        <Text style={styles.msgText}>{item.text}</Text>
      </View>
    );
  };

  // --- DETAIL VIEW (Active Chat) ---
  if (selectedRoom) {
    return (
      <View style={styles.detailContainer}>
        <View style={[styles.detailHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={() => setSelectedRoom(null)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          
          <View style={styles.headerAvatar}>
            <Ionicons name="person" size={24} color="#FFF" />
          </View>
          
          <View style={styles.headerInfo}>
            <Text style={styles.headerName}>{selectedRoom.name}</Text>
            {selectedRoom.vehicle && (
              <Text style={styles.headerSubtitle}>{selectedRoom.vehicle}</Text>
            )}
          </View>

          <TouchableOpacity style={styles.callBtn}>
            <Ionicons name="call" size={20} color="#000" />
          </TouchableOpacity>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.inputBar, { paddingBottom: insets.bottom || 12 }]}>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="add" size={28} color="#4B5563" />
            </TouchableOpacity>
            
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.textInput}
                placeholder="Type your message"
                placeholderTextColor="#9CA3AF"
                value={newMsg}
                onChangeText={setNewMsg}
              />
            </View>

            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="camera-outline" size={24} color="#4B5563" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconBtn} onPress={sendMessage}>
              <Ionicons name="send-outline" size={22} color="#000" style={{ transform: [{ rotate: '-45deg' }] }} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // --- LIST VIEW (Chats List) ---
  return (
    <SafeAreaView style={styles.listContainer} edges={['top']}>
      <View style={styles.listHeader}>
        <Text style={styles.mainTitle}>Messages</Text>
        <Text style={styles.subTitle}>Chats</Text>
      </View>

      {loading ? (
        <ActivityIndicator color="#FA7A25" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.chatRow} onPress={() => openChat(item)}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={28} color="#FFF" />
              </View>
              <View style={styles.chatInfo}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={styles.chatLastMsg} numberOfLines={1}>{item.lastMessage || item.lastMsg}</Text>
              </View>
              <Text style={styles.chatTime}>{item.time}</Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // --- List View Styles ---
  listContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  listHeader: { paddingHorizontal: 20, paddingTop: 25, paddingBottom: 10 },
  mainTitle: { fontSize: 30, fontWeight: '800', color: '#000', marginBottom: 20 },
  subTitle: { fontSize: 15, color: '#000', fontWeight: '500' },
  chatRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 14, 
  },
  avatar: { 
    width: 56, 
    height: 56, 
    borderRadius: 28, 
    backgroundColor: '#D97706',
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 14 
  },
  chatInfo: { flex: 1, paddingRight: 10 },
  chatName: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 4 },
  chatLastMsg: { color: '#6B7280', fontSize: 13 },
  chatTime: { color: '#6B7280', fontSize: 11 },

  // --- Detail View Styles ---
  detailContainer: { flex: 1, backgroundColor: '#FFFFFF' },
  detailHeader: { 
    backgroundColor: '#FA7A25',
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingBottom: 100 
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
  },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 20, fontWeight: '800', color: '#000', bottom: -50 },
  headerSubtitle: { fontSize: 11, color: '#111827', marginTop: 2, bottom: -50 },
  callBtn: { paddingLeft: -20, bottom: -50 },

  chatContent: { padding: 20 },
  
  systemText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#4B5563',
    marginVertical: 16,
  },
  
  matchRequestWrapper: {
    marginBottom: 24,
    marginTop: 8,
  },
  matchRequestShadow: {
    backgroundColor: '#FA7A25',
    borderRadius: 16,
    paddingLeft: 6,
    paddingBottom: 4,
  },
  matchRequestInner: {
    backgroundColor: '#65F529',
    borderRadius: 16,
    padding: 16,
  },
  matchRow: {
    flexDirection: 'row',
  },
  matchIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  matchTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000',
    marginBottom: 4,
  },
  matchText: {
    fontSize: 12,
    color: '#000',
    lineHeight: 16,
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFD700',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000',
    marginLeft: 4,
  },
  cancelText: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 8,
  },

  msgBubble: { 
    maxWidth: '75%', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderRadius: 20, 
    marginBottom: 12 
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
  msgText: {
    fontSize: 14,
    color: '#111827',
  },

  inputBar: { 
    flexDirection: 'row', 
    paddingHorizontal: 12, 
    paddingTop: 12,
    borderTopWidth: 1, 
    borderColor: '#E5E7EB', 
    alignItems: 'center',
    backgroundColor: '#FFF'
  },
  iconBtn: {
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    marginHorizontal: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  textInput: { 
    height: 40,
    fontSize: 14,
    color: '#000',
  },
});