import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import {
  Search,
  ChevronRight,
  AlertCircle,
  Clock,
  CheckCircle2,
  SlidersHorizontal,
  X,
  ChevronDown,
  UserCheck,
  UserPlus,
  Inbox,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useNotification } from '../../components/NotificationProvider';

const FILTER_TABS = [
  { id: 'all', label: 'All Queue' },
  { id: 'pending', label: 'Open / Pending' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];

const STATUS_OPTIONS = [
  { id: 'pending', label: 'Open / Pending', color: '#fbbf24', bg: '#fefce8' },
  { id: 'in_progress', label: 'In Progress', color: '#3b82f6', bg: '#eff6ff' },
  { id: 'resolved', label: 'Resolved', color: COLORS.success, bg: '#f0fdf4' },
  { id: 'closed', label: 'Closed', color: '#64748b', bg: '#f8fafc' },
];

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Low', color: '#16a34a', bg: '#f0fdf4' },
  { id: 'medium', label: 'Medium', color: '#3b82f6', bg: '#eff6ff' },
  { id: 'high', label: 'High', color: '#d97706', bg: '#fef3c7' },
  { id: 'critical', label: 'Critical', color: '#ef4444', bg: '#fee2e2' },
];

import {
  normalizeStatus,
  calculateKpiCounts,
  filterTickets,
  fetchTicketsQuery,
  updateTicketAction,
  claimTicketAction,
} from '../../lib/adminTicketOperations';

export {
  normalizeStatus,
  calculateKpiCounts,
  filterTickets,
  fetchTicketsQuery,
  updateTicketAction,
  claimTicketAction,
};

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

const formatTime = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
};

// ── Memoized list item with inline controls ──────────────────────────────────
const TicketItem = memo(
  ({
    item,
    currentUserId,
    onPress,
    onOpenStatusPicker,
    onOpenPriorityPicker,
    onClaim,
  }) => {
    const rawStatus = String(item.status || '').toLowerCase().trim();
    const isClosedOrResolved =
      rawStatus === 'closed' ||
      rawStatus === 'resolved' ||
      rawStatus === 'auto_resolved' ||
      rawStatus.includes('resolv');
    const statusColor = getStatusColor(item.status);
    const creatorName = item.creator?.full_name || 'System User';
    const isClaimedByMe =
      item.assigned_agent_id === currentUserId || item.assigned_to === currentUserId;
    const isClaimedByOther =
      !isClaimedByMe && (item.assigned_agent_id || item.assigned_to);

    const priorityLower = String(item.priority || 'low').toLowerCase();
    const priorityColor =
      priorityLower === 'critical'
        ? '#ef4444'
        : priorityLower === 'high'
        ? '#d97706'
        : priorityLower === 'medium'
        ? '#3b82f6'
        : '#16a34a';
    const priorityBg =
      priorityLower === 'critical'
        ? '#fee2e2'
        : priorityLower === 'high'
        ? '#fef3c7'
        : priorityLower === 'medium'
        ? '#eff6ff'
        : '#f0fdf4';

    return (
      <TouchableOpacity
        style={styles.ticketCard}
        onPress={() => onPress(item.id)}
        activeOpacity={0.85}
      >
        <View style={[styles.statusStripe, { backgroundColor: statusColor }]} />
        <View style={styles.cardContent}>
          {/* Header row: creator, date, priority badge */}
          <View style={styles.cardHeader}>
            <View style={styles.creatorInfo}>
              <Text style={styles.creatorName}>{creatorName}</Text>
              <Text style={styles.ticketDate}>{formatTime(item.created_at)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.priorityBadge, { backgroundColor: priorityBg }]}
              onPress={(e) => {
                e.stopPropagation?.();
                onOpenPriorityPicker(item.id, item.priority);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.priorityText, { color: priorityColor }]}>
                {(item.priority || 'Low').toUpperCase()}
              </Text>
              <ChevronDown size={11} color={priorityColor} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          </View>

          {/* Subject & snippet */}
          <Text style={styles.subjectText} numberOfLines={1}>
            {item.subject}
          </Text>
          <Text style={styles.descSnippet} numberOfLines={2}>
            {item.description}
          </Text>

          {/* Badges row: category, AI auto, status badge */}
          <View style={styles.cardMetaRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>
                {(item.category || 'General').toUpperCase()}
              </Text>
            </View>
            <View style={styles.footerRight}>
              {item.auto_resolve && (
                <View style={styles.aiBadge}>
                  <Text style={styles.aiBadgeText}>AI AUTO</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onOpenStatusPicker(item.id, item.status);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor }]}>
                  {String(item.status || 'PENDING').replace('_', ' ').toUpperCase()}
                </Text>
                <ChevronDown size={11} color={statusColor} style={{ marginLeft: 3 }} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Inline Action Bar: Inline Controls */}
          <View style={styles.inlineControlsBar}>
            <View style={styles.inlinePillsGroup}>
              {/* Inline Status Control Pill */}
              <TouchableOpacity
                style={styles.quickPill}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onOpenStatusPicker(item.id, item.status);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.quickPillLabel}>Status:</Text>
                <Text style={[styles.quickPillVal, { color: statusColor }]}>
                  {String(item.status || 'pending').replace('_', ' ')}
                </Text>
                <ChevronDown size={10} color={COLORS.textMuted} />
              </TouchableOpacity>

              {/* Inline Priority Control Pill */}
              <TouchableOpacity
                style={styles.quickPill}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onOpenPriorityPicker(item.id, item.priority);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.quickPillLabel}>Priority:</Text>
                <Text style={[styles.quickPillVal, { color: priorityColor }]}>
                  {String(item.priority || 'low')}
                </Text>
                <ChevronDown size={10} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Inline Claim Action */}
            {isClaimedByMe ? (
              <View style={styles.claimedBadge}>
                <CheckCircle2 size={12} color="#16a34a" />
                <Text style={styles.claimedBadgeText}>Claimed (You)</Text>
              </View>
            ) : isClaimedByOther ? (
              <View style={styles.claimedOtherBadge}>
                <UserCheck size={12} color="#6366f1" />
                <Text style={styles.claimedOtherText} numberOfLines={1}>
                  {item.assigned_agent?.full_name || 'Assigned'}
                </Text>
              </View>
            ) : isClosedOrResolved ? null : (
              <TouchableOpacity
                style={styles.claimBtn}
                onPress={(e) => {
                  e.stopPropagation?.();
                  onClaim(item.id);
                }}
                activeOpacity={0.8}
              >
                <UserPlus size={12} color="#ffffff" />
                <Text style={styles.claimBtnText}>Claim</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <ChevronRight size={18} color={COLORS.textMuted} style={{ marginRight: 14 }} />
      </TouchableOpacity>
    );
  }
);

const AdminTicketsScreen = () => {
  const navigation = useNavigation();
  const notification = useNotification();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [currentUser, setCurrentUser] = useState(null);
  const [currentProfile, setCurrentProfile] = useState(null);

  // Modal Sheet picker state
  const [pickerModal, setPickerModal] = useState({
    visible: false,
    type: null, // 'status' | 'priority'
    ticketId: null,
    currentVal: null,
  });

  // Ref to track in-flight and recent ticket mutations to prevent stale fetch overwrites
  const pendingMutationsRef = React.useRef(new Map());

  const fetchTickets = useCallback(async () => {
    const fetchStartTime = Date.now();
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUser(user);

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profile) setCurrentProfile(profile);

      const data = await fetchTicketsQuery(supabase, {
        company: profile?.company,
        companyId: profile?.company_id,
      });

      // Preserve newer pending/optimistic edits so older fetch response does not overwrite them
      setTickets((prev) => {
        return data.map((fetched) => {
          const pending = pendingMutationsRef.current.get(fetched.id);
          if (pending && pending.timestamp >= fetchStartTime) {
            return { ...fetched, ...pending.fields };
          }
          return fetched;
        });
      });
    } catch (e) {
      console.error('Fetch admin tickets queue error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTickets();
    }, [fetchTickets])
  );

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchTickets();
  };

  // ── KPI Counts for 2x2 Grid ────────────────────────────────────────────────
  const { totalCount, pendingCount, inProgressCount, resolvedCount } = calculateKpiCounts(tickets);

  const getFilteredTickets = () => {
    return filterTickets(tickets, activeFilter, searchQuery);
  };

  const handleTicketPress = useCallback(
    (ticketId) => {
      Haptics.selectionAsync();
      navigation.navigate('AdminTicketDetail', { ticketId });
    },
    [navigation]
  );

  // ── Inline Actions ─────────────────────────────────────────────────────────
  const handleOpenStatusPicker = useCallback((ticketId, currentVal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerModal({
      visible: true,
      type: 'status',
      ticketId,
      currentVal: String(currentVal || 'pending').toLowerCase(),
    });
  }, []);

  const handleOpenPriorityPicker = useCallback((ticketId, currentVal) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerModal({
      visible: true,
      type: 'priority',
      ticketId,
      currentVal: String(currentVal || 'low').toLowerCase(),
    });
  }, []);

  const handleSelectOption = async (optionId) => {
    const { type, ticketId } = pickerModal;
    setPickerModal({ visible: false, type: null, ticketId: null, currentVal: null });
    if (!ticketId || !type) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // Save previous snapshot of the specific ticket for safe targeted rollback
    const previousTicket = tickets.find((t) => t.id === ticketId);

    const updatePayload =
      type === 'status'
        ? { status: optionId, updated_at: new Date().toISOString() }
        : { priority: optionId, updated_at: new Date().toISOString() };

    // Register pending mutation timestamp
    pendingMutationsRef.current.set(ticketId, {
      fields: updatePayload,
      timestamp: Date.now(),
    });

    // Optimistic local update
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, ...updatePayload } : t))
    );

    try {
      const updatedRow = await updateTicketAction(supabase, ticketId, updatePayload);
      pendingMutationsRef.current.delete(ticketId);

      // Merge verified row into local state
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, ...updatedRow } : t))
      );

      notification?.success?.(
        'Updated Successfully',
        `Ticket ${type === 'status' ? 'status' : 'priority'} set to ${optionId.toUpperCase()}.`
      );
    } catch (err) {
      console.error('Update ticket error:', err);
      pendingMutationsRef.current.delete(ticketId);
      // Roll back ONLY the affected ticket without blowing away the queue
      if (previousTicket) {
        setTickets((prev) =>
          prev.map((t) => (t.id === ticketId ? previousTicket : t))
        );
      }
      notification?.error?.('Update Failed', err?.message || 'Could not update ticket.');
    }
  };

  const handleClaimTicket = useCallback(
    async (ticketId) => {
      if (!currentUser?.id) return;

      const targetTicket = tickets.find((t) => t.id === ticketId);
      if (targetTicket) {
        const s = String(targetTicket.status || '').toLowerCase().trim();
        if (s === 'closed' || s.includes('resolv')) {
          notification?.warning?.('Cannot Claim', 'Closed or resolved tickets cannot be claimed.');
          return;
        }
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const previousTicket = targetTicket;
      const optimisticFields = {
        assigned_agent_id: currentUser.id,
        status: 'in_progress',
        assigned_agent: { full_name: currentProfile?.full_name || 'Admin' },
      };

      pendingMutationsRef.current.set(ticketId, {
        fields: optimisticFields,
        timestamp: Date.now(),
      });

      // Optimistic update
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId
            ? {
                ...t,
                ...optimisticFields,
              }
            : t
        )
      );

      try {
        const res = await claimTicketAction(supabase, ticketId, currentUser.id);
        pendingMutationsRef.current.delete(ticketId);

        if (!res.success && res.conflict) {
          // Revert optimistic update for this ticket
          if (previousTicket) {
            setTickets((prev) =>
              prev.map((t) => (t.id === ticketId ? previousTicket : t))
            );
          }
          notification?.warning?.('Claim Conflict', 'This ticket has already been claimed by another agent.');
          fetchTickets();
          return;
        }

        // Merge updated row
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? {
                  ...t,
                  ...res.ticket,
                  assigned_agent: { full_name: currentProfile?.full_name || 'Admin' },
                }
              : t
          )
        );
        notification?.success?.('Ticket Claimed', 'Assigned to your queue in progress.');
      } catch (err) {
        console.error('Claim ticket error:', err);
        pendingMutationsRef.current.delete(ticketId);
        // Roll back specific ticket from snapshot
        if (previousTicket) {
          setTickets((prev) =>
            prev.map((t) => (t.id === ticketId ? previousTicket : t))
          );
        }
        notification?.error?.('Claim Failed', err?.message || 'Could not claim ticket.');
      }
    },
    [currentUser, currentProfile, tickets, notification, fetchTickets]
  );

  const renderTicketItem = useCallback(
    ({ item }) => (
      <TicketItem
        item={item}
        currentUserId={currentUser?.id}
        onPress={handleTicketPress}
        onOpenStatusPicker={handleOpenStatusPicker}
        onOpenPriorityPicker={handleOpenPriorityPicker}
        onClaim={handleClaimTicket}
      />
    ),
    [
      currentUser?.id,
      handleTicketPress,
      handleOpenStatusPicker,
      handleOpenPriorityPicker,
      handleClaimTicket,
    ]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Incident Queue</Text>
          <Text style={styles.subtitle}>
            {currentProfile?.company || 'RITESH PVT LTD'} · Operations
          </Text>
        </View>
        <View style={styles.activePill}>
          <View style={styles.pulseDot} />
          <Text style={styles.activePillText}>LIVE FEED</Text>
        </View>
      </View>

      {/* 2x2 KPI Cards Section */}
      <View style={styles.kpiGrid}>
        {/* Row 1 */}
        <View style={styles.kpiRow}>
          <TouchableOpacity
            style={[styles.kpiCard, activeFilter === 'all' && styles.kpiCardActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFilter('all');
            }}
            activeOpacity={0.75}
          >
            <View style={styles.kpiTop}>
              <Text style={styles.kpiLabel}>Total Queue</Text>
              <View style={[styles.kpiIconWrap, { backgroundColor: '#eff6ff' }]}>
                <Inbox size={15} color="#3b82f6" />
              </View>
            </View>
            <Text style={[styles.kpiValue, { color: '#1e293b' }]}>{totalCount}</Text>
            <Text style={styles.kpiSub}>All tickets</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.kpiCard, activeFilter === 'pending' && styles.kpiCardActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFilter('pending');
            }}
            activeOpacity={0.75}
          >
            <View style={styles.kpiTop}>
              <Text style={styles.kpiLabel}>Open / Pending</Text>
              <View style={[styles.kpiIconWrap, { backgroundColor: '#fefce8' }]}>
                <Clock size={15} color="#d97706" />
              </View>
            </View>
            <Text style={[styles.kpiValue, { color: '#d97706' }]}>{pendingCount}</Text>
            <Text style={styles.kpiSub}>Needs review</Text>
          </TouchableOpacity>
        </View>

        {/* Row 2 */}
        <View style={styles.kpiRow}>
          <TouchableOpacity
            style={[styles.kpiCard, activeFilter === 'in_progress' && styles.kpiCardActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFilter('in_progress');
            }}
            activeOpacity={0.75}
          >
            <View style={styles.kpiTop}>
              <Text style={styles.kpiLabel}>In Progress</Text>
              <View style={[styles.kpiIconWrap, { backgroundColor: '#eef2ff' }]}>
                <SlidersHorizontal size={15} color="#6366f1" />
              </View>
            </View>
            <Text style={[styles.kpiValue, { color: '#4f46e5' }]}>{inProgressCount}</Text>
            <Text style={styles.kpiSub}>Under triage</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.kpiCard, activeFilter === 'resolved' && styles.kpiCardActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFilter('resolved');
            }}
            activeOpacity={0.75}
          >
            <View style={styles.kpiTop}>
              <Text style={styles.kpiLabel}>Resolved</Text>
              <View style={[styles.kpiIconWrap, { backgroundColor: '#f0fdf4' }]}>
                <CheckCircle2 size={15} color="#16a34a" />
              </View>
            </View>
            <Text style={[styles.kpiValue, { color: '#16a34a' }]}>{resolvedCount}</Text>
            <Text style={styles.kpiSub}>Closed / solved</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Search size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Search by subject, description, category, user..."
            placeholderTextColor="rgba(0,0,0,0.3)"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <X size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Tabs scrollbar */}
      <View style={styles.tabWrapper}>
        <FlatList
          data={FILTER_TABS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.tabScroll}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.tabItem, activeFilter === item.id && styles.activeTabItem]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveFilter(item.id);
              }}
            >
              <Text
                style={[
                  styles.tabLabel,
                  activeFilter === item.id && styles.activeTabLabel,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Queue list */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={getFilteredTickets()}
          keyExtractor={(item) => item.id}
          renderItem={renderTicketItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={Platform.OS !== 'ios'}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <AlertCircle size={48} color={COLORS.textMuted} strokeWidth={1} />
              <Text style={styles.emptyText}>No tickets match your filters</Text>
            </View>
          }
        />
      )}

      {/* Inline Picker Modal (Status / Priority) */}
      <Modal
        visible={pickerModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerModal({ visible: false, type: null, ticketId: null, currentVal: null })}
      >
        <TouchableOpacity
          style={styles.pickerBackdrop}
          activeOpacity={1}
          onPress={() => setPickerModal({ visible: false, type: null, ticketId: null, currentVal: null })}
        >
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>
                {pickerModal.type === 'status' ? 'Update Ticket Status' : 'Update Ticket Priority'}
              </Text>
              <TouchableOpacity
                onPress={() => setPickerModal({ visible: false, type: null, ticketId: null, currentVal: null })}
                style={styles.pickerCloseBtn}
              >
                <X size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerOptionsList}>
              {(pickerModal.type === 'status' ? STATUS_OPTIONS : PRIORITY_OPTIONS).map((opt) => {
                const isSelected =
                  pickerModal.type === 'status'
                    ? normalizeStatus(pickerModal.currentVal) === opt.id
                    : pickerModal.currentVal === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[styles.pickerOptionItem, isSelected && styles.pickerOptionItemActive]}
                    onPress={() => handleSelectOption(opt.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.pickerOptionLeft}>
                      <View style={[styles.pickerDot, { backgroundColor: opt.color }]} />
                      <Text
                        style={[
                          styles.pickerOptionLabel,
                          isSelected && { color: opt.color, fontWeight: '800' },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </View>
                    {isSelected && <CheckCircle2 size={16} color={opt.color} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  title: { fontSize: 26, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  activePillText: { fontSize: 9, fontWeight: '800', color: '#15803d', letterSpacing: 0.5 },

  // 2x2 KPI Grid
  kpiGrid: {
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 12,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    ...SHADOWS.soft,
  },
  kpiCardActive: {
    borderColor: COLORS.primary,
    borderWidth: 1.5,
  },
  kpiTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 0.2,
  },
  kpiIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  kpiSub: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textMuted,
    marginTop: 2,
  },

  // Search
  searchSection: { paddingHorizontal: 20, marginBottom: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 48,
    ...SHADOWS.soft,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  input: { flex: 1, marginLeft: 8, fontSize: 13, fontWeight: '600', color: COLORS.text },
  clearSearchBtn: { padding: 4 },

  // Tabs scroll
  tabWrapper: { marginBottom: 10 },
  tabScroll: { paddingHorizontal: 20, gap: 8 },
  tabItem: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    ...SHADOWS.soft,
  },
  activeTabItem: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabLabel: { fontSize: 12, fontWeight: '700', color: COLORS.textLight },
  activeTabLabel: { color: '#fff' },

  // List Cards
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  ticketCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 22,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.04)',
    ...SHADOWS.soft,
  },
  statusStripe: { width: 5, alignSelf: 'stretch' },
  cardContent: { flex: 1, padding: 16 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  creatorInfo: { gap: 1 },
  creatorName: { fontSize: 13, fontWeight: '800', color: COLORS.text },
  ticketDate: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600' },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  priorityText: { fontSize: 9, fontWeight: '800' },
  subjectText: { fontSize: 14.5, fontWeight: '800', color: COLORS.text, marginBottom: 3 },
  descSnippet: { fontSize: 12.5, color: COLORS.textLight, lineHeight: 17, marginBottom: 10 },

  cardMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryBadge: {
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryText: { fontSize: 9.5, fontWeight: '800', color: COLORS.textLight },

  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  aiBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  aiBadgeText: { fontSize: 9, fontWeight: '900', color: COLORS.primary },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 100,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 9, fontWeight: '800' },

  // Inline action bar on ticket card
  inlineControlsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  inlinePillsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  quickPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  quickPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  quickPillVal: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  claimBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  claimBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  claimedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  claimedBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#16a34a',
  },
  claimedOtherBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    maxWidth: 110,
  },
  claimedOtherText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4f46e5',
  },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  emptyContainer: { alignItems: 'center', marginTop: 100, gap: 12 },
  emptyText: { fontSize: 15, color: COLORS.textMuted, fontWeight: '600' },

  // Picker Modal
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pickerSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    ...SHADOWS.card,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.text,
  },
  pickerCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerOptionsList: {
    gap: 8,
  },
  pickerOptionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  pickerOptionItemActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryLight,
  },
  pickerOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pickerOptionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
});

export default AdminTicketsScreen;
