import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  StatusBar, Alert, Modal, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import { 
  ArrowLeft, Send, Sparkles, User, Briefcase, Clock, 
  ChevronDown, CheckCircle2, AlertTriangle, Eye, Star, 
  Settings, Shield, ShieldAlert, Cpu, Globe, ArrowUpRight,
  ShieldCheck, X
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { compressAndUpload, QUALITY_PRESETS } from '../../utils/imageCompressor';
const TEAMS = ['Software Team', 'Hardware Support', 'Network Ops', 'Security Unit', 'General Support'];
const STATUSES = ['pending', 'in_progress', 'resolved', 'closed'];

// ── Memoized message item ──────
const MessageItem = memo(({ item }) => {
  const isSystem = item.sender_id === '00000000-0000-0000-0000-000000000000';
  const isAdmin = item.sender_role === 'admin' && !isSystem;
  
  if (isSystem) {
    return (
      <View style={styles.systemMessageContainer}>
        <Text style={styles.systemMessageText}>{item.message}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.messageBubbleContainer, isAdmin ? styles.alignRight : styles.alignLeft]}>
      {!isAdmin && (
        <View style={styles.chatAvatar}>
          <Text style={styles.avatarText}>{item.sender_name?.[0]?.toUpperCase() || 'U'}</Text>
        </View>
      )}
      <View style={[styles.messageBubble, isAdmin ? styles.adminBubble : styles.userBubble]}>
        <Text style={styles.senderLabel}>{item.sender_name}</Text>
        <Text style={[styles.messageText, isAdmin ? styles.textWhite : styles.textDark]}>{item.message}</Text>
        <Text style={[styles.messageTime, isAdmin ? styles.textWhiteMuted : styles.textDarkMuted]}>
          {new Date(item.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </View>
  );
});

const AdminTicketDetailScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { ticketId } = route.params;

  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [profile, setProfile] = useState(null);
  
  // Loading and action states
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isUpdating, setIsUpdating] = useState(null); // 'claim' | 'divert' | 'override' | 'resolve'
  const [agents, setAgents] = useState([]); // Company agents for re-routing

  // Modal Dialogs
  const [showDivertModal, setShowDivertModal] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);

  // Divert Form
  const [targetTeam, setTargetTeam] = useState('');
  const [targetAgent, setTargetAgent] = useState('');

  // Override Form
  const [overrideCategory, setOverrideCategory] = useState('');
  const [overrideSubcategory, setOverrideSubcategory] = useState('');
  const [overridePriority, setOverridePriority] = useState('');

  const flatListRef = useRef(null);

  const fetchTicketDetails = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      setCurrentUser(authUser);

      // Fetch user profile
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single();
      if (userProfile) setProfile(userProfile);

      // Fetch ticket
      const { data: ticketData, error } = await supabase
        .from('tickets')
        .select(`
          *,
          creator:profiles!tickets_user_id_fkey(full_name, email),
          assignee:profiles!tickets_assigned_agent_id_fkey(full_name, email)
        `)
        .eq('id', ticketId)
        .single();

      if (error) {
        // Fallback
        const { data: fallbackTicket } = await supabase
          .from('tickets')
          .select('*')
          .eq('id', ticketId)
          .single();
        setTicket(fallbackTicket);
      } else {
        setTicket(ticketData);
        // Pre-fill override forms
        setOverrideCategory(ticketData.category || '');
        setOverrideSubcategory(ticketData.subcategory || '');
        setOverridePriority(ticketData.priority || '');
      }

      // Fetch company agents/admins
      if (userProfile?.company) {
        const { data: companyAgents } = await supabase
          .from('profiles')
          .select('id, full_name, role')
          .eq('company', userProfile.company)
          .in('role', ['admin', 'super_admin', 'agent']);
        setAgents(companyAgents || []);
      }

      // Fetch messages
      const { data: msgData } = await supabase
        .from('ticket_messages')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: true });

      setMessages(msgData || []);

    } catch (e) {
      console.error('Fetch ticket details error:', e);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    fetchTicketDetails();

    // Subscribe to chat messages real-time inserts
    const chatChannel = supabase
      .channel(`ticket_chat_detail_${ticketId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'ticket_messages',
        filter: `ticket_id=eq.${ticketId}`
      }, (payload) => {
        setMessages(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
      })
      .subscribe();

    // Subscribe to ticket updates
    const ticketChannel = supabase
      .channel(`ticket_sync_detail_${ticketId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'tickets',
        filter: `id=eq.${ticketId}`
      }, (payload) => {
        setTicket(prev => ({ ...prev, ...payload.new }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(chatChannel);
      supabase.removeChannel(ticketChannel);
    };
  }, [ticketId, fetchTicketDetails]);

  const handleUpdateTicket = async (updates, actionType) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsUpdating(actionType);
    try {
      const { error } = await supabase
        .from('tickets')
        .update(updates)
        .eq('id', ticketId);

      if (error) {
        notifyError("Sync Error", "Could not complete manual update.");
      } else {
        // Refresh ticket details
        await fetchTicketDetails();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsUpdating(null);
    }
  };

  const handleClaim = () => {
    if (!currentUser) return;
    handleUpdateTicket({
      status: 'in_progress',
      assigned_agent_id: currentUser.id
    }, 'claim');

    // Insert auto system diagnostic chat log
    (async () => {
      try {
        await supabase.from('ticket_messages').insert({
          ticket_id: ticketId,
          sender_id: '00000000-0000-0000-0000-000000000000',
          sender_name: 'AI System',
          sender_role: 'admin',
          message: `Incident claimed by Administrator @${profile?.full_name || 'Admin'}.`
        });
      } catch (_) {}
    })();
  };

  const handleDivert = () => {
    if (!targetTeam && !targetAgent) {
      notifyError("Error", "Please select a support team or agent to divert.");
      return;
    }

    const updates = {};
    let desc = "";

    if (targetTeam) {
      updates.assigned_team = targetTeam;
      desc += `Re-routed to ${targetTeam}`;
    }
    if (targetAgent) {
      updates.assigned_agent_id = targetAgent;
      updates.status = 'in_progress';
      const agentObj = agents.find(a => a.id === targetAgent);
      desc += desc ? ` and assigned to @${agentObj?.full_name || 'Agent'}` : `Assigned to @${agentObj?.full_name || 'Agent'}`;
    }

    handleUpdateTicket(updates, 'divert');
    setShowDivertModal(false);

    // Insert system chat log
    (async () => {
      try {
        await supabase.from('ticket_messages').insert({
          ticket_id: ticketId,
          sender_id: '00000000-0000-0000-0000-000000000000',
          sender_name: 'AI System',
          sender_role: 'admin',
          message: `${desc} by Administrator.`
        });
      } catch (_) {}
    })();
  };

  const handleOverride = () => {
    if (!overrideCategory) {
      notifyError("Error", "Please select a refined category.");
      return;
    }

    const existingMetadata = ticket?.metadata || {};
    handleUpdateTicket({
      category: overrideCategory,
      subcategory: overrideSubcategory,
      priority: overridePriority,
      metadata: { ...existingMetadata, corrected_at: new Date().toISOString() }
    }, 'override');

    setShowOverrideModal(false);

    // Dynamic system message logging differences
    const changes = [];
    if (overrideCategory !== ticket.category) changes.push(`Category corrected to ${overrideCategory}`);
    if (overridePriority !== ticket.priority) changes.push(`Priority reassessed to ${overridePriority.toUpperCase()}`);

    (async () => {
      try {
        await supabase.from('ticket_messages').insert({
          ticket_id: ticketId,
          sender_id: '00000000-0000-0000-0000-000000000000',
          sender_name: 'AI System',
          sender_role: 'admin',
          message: `Manual Override: ${changes.join(', ') || 'neural classifications overrides modified'}.`
        });
      } catch (_) {}
    })();
  };

  const handleResolve = () => {
    const existingMetadata = ticket?.metadata || {};
    handleUpdateTicket({
      status: 'resolved',
      metadata: { ...existingMetadata, resolved_at: new Date().toISOString() }
    }, 'resolve');

    // System log
    (async () => {
      try {
        await supabase.from('ticket_messages').insert({
          ticket_id: ticketId,
          sender_id: '00000000-0000-0000-0000-000000000000',
          sender_name: 'AI System',
          sender_role: 'admin',
          message: `Incident marked as RESOLVED. Lifecycle protocol finalized.`
        });
      } catch (_) {}
    })();
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    const textToSend = inputText.trim();
    setInputText('');

    try {
      const { error } = await supabase
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          sender_id: currentUser.id,
          sender_name: profile?.full_name || 'Admin Support',
          sender_role: 'admin',
          message: textToSend
        });

      if (error) {
        notifyError("Error", "Could not send message.");
        setInputText(textToSend);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  const renderMessageItem = useCallback(({ item }) => (
    <MessageItem item={item} />
  ), []);

  const getStatusColor = (status) => {
    const rawStatus = String(status || '').toLowerCase().trim();
    if (rawStatus.includes('resolv') || rawStatus === 'closed') {
      return COLORS.success;
    }
    if (rawStatus === 'in progress' || rawStatus === 'in_progress') {
      return '#3b82f6';
    }
    return '#fbbf24';
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const creatorName = ticket?.creator?.full_name || ticket?.company || 'System User';
  const statusColor = getStatusColor(ticket?.status);
  const isResolved = ticket?.status?.toLowerCase()?.includes('resolv') || ticket?.status === 'closed';

  // Extract env telemetry
  const ip = ticket?.metadata?.env_metadata?.ip || '127.0.0.1';
  const signature = ticket?.metadata?.env_metadata?.user_agent || 'Neural Mobile Client';
  const confidence = ticket?.confidence ?? 0.85;
  const entities = ticket?.metadata?.entities || ticket?.entities || [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ArrowLeft size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>Inspection Console</Text>
          <Text style={styles.headerSubtitle}>#{String(ticketId).slice(0, 8).toUpperCase()}</Text>
        </View>
        
        {/* Real-time Indicator */}
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>SYNCED</Text>
        </View>
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={styles.chatScroll}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={15}
          ListHeaderComponent={
            <View style={styles.ticketDetailsSection}>
              
              {/* Action Buttons Toolbar */}
              {!isResolved && (
                <View style={styles.actionsContainer}>
                  {/* Primary Actions Row */}
                  <View style={styles.primaryActionsRow}>
                    {ticket?.assigned_agent_id !== currentUser?.id ? (
                      <>
                        <TouchableOpacity 
                          style={[styles.primaryActionBtn, styles.claimBtn]} 
                          onPress={handleClaim}
                          disabled={isUpdating !== null}
                        >
                          {isUpdating === 'claim' ? <ActivityIndicator size="small" color="#fff" /> : <ShieldCheck size={18} color="#fff" />}
                          <Text style={styles.primaryActionBtnText}>CLAIM</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[styles.primaryActionBtn, styles.resolveBtn]} 
                          onPress={handleResolve}
                          disabled={isUpdating !== null}
                        >
                          {isUpdating === 'resolve' ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={18} color="#fff" />}
                          <Text style={styles.primaryActionBtnText}>RESOLVE</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity 
                        style={[styles.primaryActionBtn, styles.resolveBtn, { flex: 1 }]} 
                        onPress={handleResolve}
                        disabled={isUpdating !== null}
                      >
                        {isUpdating === 'resolve' ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={18} color="#fff" />}
                        <Text style={styles.primaryActionBtnText}>RESOLVE TICKET</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Secondary Triage Actions Row */}
                  <View style={styles.secondaryActionsRow}>
                    <TouchableOpacity 
                      style={[styles.secondaryActionBtn, styles.divertBtn]} 
                      onPress={() => setShowDivertModal(true)}
                      disabled={isUpdating !== null}
                    >
                      <ArrowUpRight size={16} color={COLORS.text} />
                      <Text style={styles.secondaryActionBtnText}>DIVERT ROUTE</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                      style={[styles.secondaryActionBtn, styles.overrideBtn]} 
                      onPress={() => setShowOverrideModal(true)}
                      disabled={isUpdating !== null}
                    >
                      <Settings size={16} color={COLORS.text} />
                      <Text style={styles.secondaryActionBtnText}>OVERRIDE AI</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {isResolved && (
                <View style={styles.resolvedBanner}>
                  <CheckCircle2 size={18} color="#15803d" />
                  <Text style={styles.resolvedBannerText}>LIFECYCLE PROTOCOL RESOLVED</Text>
                </View>
              )}

              {/* Main Ticket Card */}
              <View style={styles.ticketMainCard}>
                <View style={styles.ticketMainHeader}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.ticketSubjectText}>{ticket?.subject}</Text>
                    <Text style={styles.ticketCreatorText}>Sender: {creatorName}</Text>
                  </View>
                  <View style={[styles.priorityBadge, { backgroundColor: ticket?.priority?.toLowerCase() === 'critical' ? '#fee2e2' : ticket?.priority?.toLowerCase() === 'high' ? '#fef3c7' : '#f0fdf4' }]}>
                    <Text style={[styles.priorityText, { color: ticket?.priority?.toLowerCase() === 'critical' ? '#ef4444' : ticket?.priority?.toLowerCase() === 'high' ? '#d97706' : '#16a34a' }]}>
                      {(ticket?.priority || 'Low').toUpperCase()}
                    </Text>
                  </View>
                </View>

                <Text style={styles.ticketDescBody}>{ticket?.description}</Text>

                {/* Visual Evidence Screenshot */}
                {(ticket?.image_url || ticket?.metadata?.capturedFileBase64) && (
                  <View style={styles.evidenceSection}>
                    <Text style={styles.detailsLabel}>VISUAL TELEMETRY EVIDENCE</Text>
                    <View style={styles.imageWrap}>
                      <Image 
                        source={{ uri: ticket.image_url || ticket.metadata.capturedFileBase64 }} 
                        style={styles.evidenceImage}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                )}

                {/* Predicted AI Telemetry details */}
                <View style={styles.aiTelemetryCard}>
                  <View style={styles.aiTelemetryHeader}>
                    <Sparkles size={16} color="#8b5cf6" />
                    <Text style={styles.aiTelemetryTitle}>AI Neural Inference Insights</Text>
                  </View>
                  
                  <View style={styles.telemetryRow}>
                    <Text style={styles.telemetryLabel}>Prediction Category</Text>
                    <Text style={styles.telemetryValue}>{ticket?.category || 'General'}</Text>
                  </View>
                  
                  <View style={styles.telemetryRow}>
                    <Text style={styles.telemetryLabel}>Sub-Category</Text>
                    <Text style={styles.telemetryValue}>{ticket?.subcategory || 'General Inquiry'}</Text>
                  </View>

                  <View style={styles.telemetryRow}>
                    <Text style={styles.telemetryLabel}>Routing Team</Text>
                    <Text style={styles.telemetryValue}>{ticket?.assigned_team || 'General Support'}</Text>
                  </View>

                  <View style={styles.telemetryRow}>
                    <Text style={styles.telemetryLabel}>Confidence Score</Text>
                    <Text style={[styles.telemetryValue, { color: '#8b5cf6', fontWeight: '900' }]}>
                      {(confidence * 100).toFixed(0)}% Match
                    </Text>
                  </View>

                  {/* proposed solutions steps */}
                  {ticket?.metadata?.solution_steps && ticket.metadata.solution_steps.length > 0 && (
                    <View style={styles.telemetrySolutions}>
                      <Text style={styles.telemetrySolutionHeading}>Proposed Resolution Steps:</Text>
                      {ticket.metadata.solution_steps.map((step, sIdx) => (
                        <Text key={sIdx} style={styles.telemetrySolutionStep}>{sIdx + 1}. {step}</Text>
                      ))}
                    </View>
                  )}
                </View>

                {/* Extracted Entities */}
                {entities.length > 0 && (
                  <View style={styles.tagSection}>
                    <Text style={styles.detailsLabel}>EXTRACTED TELEMETRY ENTITIES</Text>
                    <View style={styles.entityWrap}>
                      {entities.map((ent, idx) => (
                        <View key={idx} style={styles.entityTag}>
                          <Text style={styles.entityTagText}>
                            {typeof ent === 'object' ? ent.text : String(ent)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* CSAT Details (if closed/resolved) */}
                {ticket?.csat_rating && (
                  <View style={styles.csatCard}>
                    <View style={styles.csatHeader}>
                      <Star size={16} color="#f59e0b" fill="#f59e0b" />
                      <Text style={styles.csatTitle}>USER SATISFACTION FEEDBACK</Text>
                    </View>
                    <View style={styles.starsRow}>
                      {[1, 2, 3, 4, 5].map((starIdx) => (
                        <Star 
                          key={starIdx} 
                          size={18} 
                          color="#f59e0b" 
                          fill={starIdx <= ticket.csat_rating ? '#f59e0b' : 'transparent'} 
                        />
                      ))}
                    </View>
                    {ticket.csat_comment && (
                      <Text style={styles.csatCommentText}>"{ticket.csat_comment}"</Text>
                    )}
                  </View>
                )}

                {/* Environmental Technical Metadata */}
                <View style={styles.metaCard}>
                  <View style={styles.metaHeader}>
                    <Globe size={14} color={COLORS.textMuted} />
                    <Text style={styles.metaTitle}>ENVIRONMENT METADATA</Text>
                  </View>
                  <View style={styles.metaRowDetail}>
                    <Text style={styles.metaLabelText}>IP Address</Text>
                    <Text style={styles.metaValueText}>{ip}</Text>
                  </View>
                  <View style={[styles.metaRowDetail, { borderBottomWidth: 0, paddingBottom: 0 }]}>
                    <Text style={styles.metaLabelText}>Signature</Text>
                    <Text style={[styles.metaValueText, { fontSize: 10.5, lineHeight: 14 }]} numberOfLines={2}>
                      {signature}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Chat section divider */}
              <View style={styles.chatSectionDivider}>
                <Text style={styles.chatSectionTitle}>Support Resolution Chat</Text>
              </View>
            </View>
          }
        />

        {/* Messaging footer input bar */}
        <View style={styles.chatFooter}>
          <TextInput
            style={styles.chatInput}
            placeholder="Type your resolution response..."
            value={inputText}
            onChangeText={setInputText}
            multiline
            placeholderTextColor="rgba(0,0,0,0.3)"
          />
          <TouchableOpacity 
            style={[styles.sendBtn, !inputText.trim() && styles.disabledSendBtn]}
            onPress={handleSendMessage}
            disabled={sending || !inputText.trim()}
          >
            {sending ? <ActivityIndicator size="small" color="#fff" /> : <Send size={20} color="#fff" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Reassign / Divert Modal Dialog */}
      <Modal
        visible={showDivertModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDivertModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalSheetHeader}>
              <Text style={styles.modalSheetTitle}>DIVERT PROTOCOL</Text>
              <TouchableOpacity onPress={() => setShowDivertModal(false)}>
                <X size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalSheetBody}>
              <Text style={styles.modalLabel}>ROUTING SUPPORT TEAM</Text>
              <View style={styles.selectorsList}>
                {TEAMS.map((t) => (
                  <TouchableOpacity 
                    key={t} 
                    style={[styles.selectorBtn, targetTeam === t && styles.activeSelectorBtn]}
                    onPress={() => setTargetTeam(t)}
                  >
                    <Text style={[styles.selectorText, targetTeam === t && styles.activeSelectorText]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.separator} />

              <Text style={styles.modalLabel}>INDIVIDUAL SUPPORT AGENT</Text>
              <View style={styles.selectorsList}>
                {agents.map((a) => (
                  <TouchableOpacity 
                    key={a.id} 
                    style={[styles.selectorBtn, targetAgent === a.id && styles.activeSelectorBtn]}
                    onPress={() => setTargetAgent(a.id)}
                  >
                    <Text style={[styles.selectorText, targetAgent === a.id && styles.activeSelectorText]}>
                      {a.full_name} ({a.role.toUpperCase()})
                    </Text>
                  </TouchableOpacity>
                ))}
                {agents.length === 0 && (
                  <Text style={styles.noDataText}>No other agents found in company directory.</Text>
                )}
              </View>

              <TouchableOpacity style={styles.executeBtn} onPress={handleDivert}>
                <Text style={styles.executeBtnText}>EXECUTE DIVERT</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Override / Correct Classification Modal Dialog */}
      <Modal
        visible={showOverrideModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowOverrideModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalSheetHeader}>
              <Text style={styles.modalSheetTitle}>OVERRIDE PROTOCOL</Text>
              <TouchableOpacity onPress={() => setShowOverrideModal(false)}>
                <X size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalSheetBody}>
              <Text style={styles.modalLabel}>MANUAL CATEGORY RE-TRIAGE</Text>
              <View style={styles.selectorsListHorizontal}>
                {['Software', 'Hardware', 'Network', 'Access', 'Account'].map((cat) => (
                  <TouchableOpacity 
                    key={cat} 
                    style={[styles.selectorBtnMini, overrideCategory === cat && styles.activeSelectorBtnMini]}
                    onPress={() => setOverrideCategory(cat)}
                  >
                    <Text style={[styles.selectorTextMini, overrideCategory === cat && styles.activeSelectorTextMini]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.separator} />

              <Text style={styles.modalLabel}>RE-ASSESSMENT PRIORITY</Text>
              <View style={styles.selectorsListHorizontal}>
                {['low', 'medium', 'high', 'critical'].map((prio) => (
                  <TouchableOpacity 
                    key={prio} 
                    style={[styles.selectorBtnMini, overridePriority === prio && styles.activeSelectorBtnMini]}
                    onPress={() => setOverridePriority(prio)}
                  >
                    <Text style={[styles.selectorTextMini, overridePriority === prio && styles.activeSelectorTextMini]}>{prio.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.separator} />

              <Text style={styles.modalLabel}>SPECIFIC SUB-CATEGORY</Text>
              <TextInput 
                style={styles.overrideInput}
                value={overrideSubcategory}
                onChangeText={setOverrideSubcategory}
                placeholder="e.g. Broken screen, Data corruption"
                placeholderTextColor="rgba(0,0,0,0.3)"
              />

              <TouchableOpacity style={styles.executeBtn} onPress={handleOverride}>
                <Text style={styles.executeBtnText}>SAVE OVERRIDES</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)', backgroundColor: '#fff' },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  headerSubtitle: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, marginTop: 1 },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#22c55e' },
  liveText: { fontSize: 8.5, fontWeight: '800', color: '#15803d', letterSpacing: 0.5 },
  
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  
  // Toolbar Overhaul for Premium layout without squishing or overlapping
  actionsContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
    marginBottom: 4,
  },
  primaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  primaryActionBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...SHADOWS.soft,
  },
  secondaryActionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...SHADOWS.soft,
  },
  claimBtn: { backgroundColor: '#3b82f6' },
  resolveBtn: { backgroundColor: COLORS.primary },
  divertBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)' },
  overrideBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.08)' },
  primaryActionBtnText: { fontSize: 12, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  secondaryActionBtnText: { fontSize: 11, fontWeight: '800', color: COLORS.text, letterSpacing: 0.3 },

  resolvedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 12, backgroundColor: '#dcfce7', borderWidth: 1.5, borderColor: '#bbf7d0', borderRadius: 16 },
  resolvedBannerText: { fontSize: 11, fontWeight: '800', color: '#15803d', letterSpacing: 0.5 },

  // Ticket Main Card styling
  ticketDetailsSection: { padding: 20 },
  ticketMainCard: { backgroundColor: '#fff', borderRadius: 24, padding: 20, ...SHADOWS.soft, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  ticketMainHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  ticketSubjectText: { fontSize: 17, fontWeight: '950', color: COLORS.text, marginBottom: 4, flex: 1, marginRight: 8 },
  ticketCreatorText: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  priorityBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100 },
  priorityText: { fontSize: 9, fontWeight: '900' },
  ticketDescBody: { fontSize: 13.5, color: COLORS.textLight, lineHeight: 22, marginBottom: 20 },

  detailsLabel: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' },

  // evidence images
  evidenceSection: { marginBottom: 20 },
  imageWrap: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', backgroundColor: '#f9fafb', height: 200, justifyContent: 'center', alignItems: 'center' },
  evidenceImage: { width: '100%', height: '100%' },

  // AI telemetry diagnostics
  aiTelemetryCard: { backgroundColor: '#f5f0ff', borderWidth: 1.5, borderColor: '#dcd0ff', borderRadius: 20, padding: 16, marginBottom: 20 },
  aiTelemetryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  aiTelemetryTitle: { fontSize: 12.5, fontWeight: '900', color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.5 },
  telemetryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(139,92,246,0.1)' },
  telemetryLabel: { fontSize: 12, fontWeight: '600', color: COLORS.textLight },
  telemetryValue: { fontSize: 12, fontWeight: '800', color: COLORS.text },
  
  telemetrySolutions: { marginTop: 12, gap: 4 },
  telemetrySolutionHeading: { fontSize: 11.5, fontWeight: '800', color: '#8b5cf6', marginBottom: 4 },
  telemetrySolutionStep: { fontSize: 11.5, color: '#5b21b6', lineHeight: 18, fontWeight: '500' },

  tagSection: { marginBottom: 20 },
  entityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  entityTag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  entityTagText: { fontSize: 9.5, color: '#15803d', fontWeight: '800' },

  // csat
  csatCard: { backgroundColor: '#fffbeb', borderWidth: 1.5, borderColor: '#fde68a', borderRadius: 20, padding: 16, marginBottom: 20 },
  csatHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  csatTitle: { fontSize: 11.5, fontWeight: '900', color: '#d97706', letterSpacing: 0.5 },
  starsRow: { flexDirection: 'row', gap: 4, marginBottom: 8 },
  csatCommentText: { fontSize: 13, fontStyle: 'italic', color: '#78350f', backgroundColor: 'rgba(253,230,138,0.3)', padding: 10, borderRadius: 10 },

  // env metadata
  metaCard: { backgroundColor: '#f8faf9', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', borderRadius: 20, padding: 16 },
  metaHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  metaTitle: { fontSize: 11.5, fontWeight: '900', color: COLORS.textMuted, letterSpacing: 0.5 },
  metaRowDetail: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)' },
  metaLabelText: { fontSize: 12, fontWeight: '600', color: COLORS.textLight },
  metaValueText: { fontSize: 12, fontWeight: '700', color: COLORS.text, maxWidth: '65%', textAlign: 'right' },

  // Chat Section
  chatSectionDivider: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.06)', paddingBottom: 10, marginTop: 10 },
  chatSectionTitle: { fontSize: 13.5, fontWeight: '900', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Chat Bubbles list
  chatScroll: { padding: 20, paddingBottom: 120 },
  systemMessageContainer: { alignSelf: 'center', backgroundColor: '#f3f4f6', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginVertical: 8 },
  systemMessageText: { fontSize: 11, color: COLORS.textMuted, fontWeight: '700', textAlign: 'center' },
  messageBubbleContainer: { flexDirection: 'row', marginVertical: 8, maxWidth: '80%', gap: 8 },
  alignLeft: { alignSelf: 'flex-start' },
  alignRight: { alignSelf: 'flex-end' },
  chatAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end' },
  avatarText: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  messageBubble: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, ...SHADOWS.soft },
  adminBubble: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  userBubble: { backgroundColor: '#f3f4f6', borderBottomLeftRadius: 4 },
  senderLabel: { fontSize: 10, fontWeight: '800', color: 'rgba(0,0,0,0.25)', marginBottom: 2 },
  messageText: { fontSize: 14, fontWeight: '500', lineHeight: 20 },
  messageTime: { fontSize: 9, fontWeight: '700', alignSelf: 'flex-end', marginTop: 4 },
  textWhite: { color: '#fff' },
  textDark: { color: COLORS.text },
  textWhiteMuted: { color: 'rgba(255,255,255,0.6)' },
  textDarkMuted: { color: COLORS.textMuted },

  // Input footer
  chatFooter: { flexDirection: 'row', alignItems: 'center', padding: 12, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.04)', backgroundColor: '#fff', gap: 12 },
  chatInput: { flex: 1, backgroundColor: '#f3f4f6', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, fontWeight: '600', maxHeight: 80, color: COLORS.text },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', ...SHADOWS.medium, shadowColor: COLORS.primary },
  disabledSendBtn: { backgroundColor: COLORS.textMuted },

  // Modal Sheet Dialogs
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalSheet: { backgroundColor: '#fff', borderRadius: 28, maxHeight: '85%', overflow: 'hidden', padding: 20, ...SHADOWS.soft },
  modalSheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.05)' },
  modalSheetTitle: { fontSize: 15, fontWeight: '900', color: COLORS.text, letterSpacing: 0.8 },
  modalSheetBody: { paddingTop: 16, paddingBottom: 24 },
  
  modalLabel: { fontSize: 10.5, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  selectorsList: { gap: 6, marginBottom: 16 },
  selectorsListHorizontal: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  
  selectorBtn: { width: '100%', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  activeSelectorBtn: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '12' },
  selectorText: { fontSize: 13, fontWeight: '700', color: COLORS.textLight },
  activeSelectorText: { color: COLORS.text, fontWeight: '900' },

  selectorBtnMini: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  activeSelectorBtnMini: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '12' },
  selectorTextMini: { fontSize: 11.5, fontWeight: '700', color: COLORS.textLight },
  activeSelectorTextMini: { color: COLORS.text, fontWeight: '900' },

  overrideInput: { backgroundColor: '#f3f4f6', height: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  separator: { height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 12 },
  
  executeBtn: { backgroundColor: COLORS.primary, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 12, ...SHADOWS.soft },
  executeBtnText: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  noDataText: { fontSize: 12.5, fontStyle: 'italic', color: COLORS.textMuted, textAlign: 'center', paddingVertical: 8 }
});

export default AdminTicketDetailScreen;
