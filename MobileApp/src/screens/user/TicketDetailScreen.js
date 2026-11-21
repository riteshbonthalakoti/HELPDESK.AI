import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import { ArrowLeft, Send, User, Bot } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';

const MessageBubble = memo(({ item }) => {
  const isUser = item.sender_role === 'user';
  const isAI = item.sender_role === 'ai';

  return (
    <View style={[
      styles.messageBubble,
      isUser ? styles.userBubble : styles.adminBubble,
      isAI && styles.aiBubble
    ]}>
      {!isUser && (
        <View style={styles.senderHeader}>
          {isAI ? <Bot size={14} color={COLORS.primary} /> : <User size={14} color={COLORS.textLight} />}
          <Text style={styles.senderName}>{isAI ? 'AI Assistant' : item.sender_name || 'Support'}</Text>
        </View>
      )}
      <Text style={[styles.messageText, isUser && styles.userMessageText]}>
        {item.message}
      </Text>
      <Text style={[styles.messageTime, isUser && styles.userTimeText]}>
        {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
      </Text>
    </View>
  );
});

const TicketDetailScreen = ({ route }) => {
  const { ticketId } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [ticket, setTicket] = useState(null);
  const navigation = useNavigation();
  const flatListRef = useRef(null);

  useEffect(() => {
    fetchTicketDetails();
    fetchMessages();

    // Set up real-time subscription for messages
    const channel = supabase
      .channel(`ticket_messages:${ticketId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ticket_messages',
        filter: `ticket_id=eq.${ticketId}`
      }, (payload) => {
        setMessages(prev => [...prev, payload.new]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ticketId]);

  const fetchTicketDetails = async () => {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();
    
    if (!error) setTicket(data);
  };

  const fetchMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const userMessage = newMessage;
    setNewMessage('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      
      const { error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: user.id,
          sender_name: profile?.full_name || 'User',
          message: userMessage,
          sender_role: 'user'
        });

      if (error) throw error;
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const renderMessage = useCallback(({ item }) => (
    <MessageBubble item={item} />
  ), []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ticket?.subject || t.titleFallback}
          </Text>
          <Text style={styles.headerSubtitle}>#{ticketId?.slice(0, 8).toUpperCase()}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={20}
      >
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messagesList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t.emptyMessages}</Text>
              </View>
            }
          />
        )}

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder={t.inputPlaceholder}
            value={newMessage}
            onChangeText={setNewMessage}
            multiline
          />
          <TouchableOpacity 
            style={[styles.sendBtn, !newMessage.trim() && styles.sendBtnDisabled]} 
            onPress={sendMessage}
            disabled={!newMessage.trim()}
          >
            <Send size={20} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    ...SHADOWS.soft
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  headerSubtitle: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messagesList: { padding: 16, paddingBottom: 32 },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 20,
    marginBottom: 16,
    ...SHADOWS.soft
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4
  },
  adminBubble: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.white,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)'
  },
  aiBubble: {
    borderColor: COLORS.primaryLight,
    borderWidth: 1,
    backgroundColor: COLORS.primaryLight + '20'
  },
  senderHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 4 },
  senderName: { fontSize: 10, fontWeight: '700', color: COLORS.textMuted },
  messageText: { fontSize: 15, color: COLORS.text, lineHeight: 20 },
  userMessageText: { color: COLORS.white },
  messageTime: { fontSize: 10, color: COLORS.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  userTimeText: { color: 'rgba(255,255,255,0.7)' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingBottom: 20,
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxHeight: 100,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.medium
  },
  sendBtnDisabled: { backgroundColor: COLORS.textMuted, elevation: 0 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  emptyText: { textAlign: 'center', color: COLORS.textMuted, fontSize: 14 }
});

export default TicketDetailScreen;
