import React, { useEffect, useState, useCallback, memo } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, SHADOWS } from '../../styles/theme';
import { Ticket, Clock, CheckCircle2, AlertTriangle, ChevronRight, Inbox } from 'lucide-react-native';

const FILTERS = ['All', 'Active', 'Resolved'];

const getStatusConfig = (status) => {
  switch (status) {
    case 'resolved': return { color: COLORS.success, label: 'RESOLVED', icon: CheckCircle2 };
    case 'in_progress': return { color: '#3b82f6', label: 'IN PROGRESS', icon: Clock };
    case 'pending_human': return { color: '#f59e0b', label: 'ESCALATED', icon: AlertTriangle };
    default: return { color: '#f59e0b', label: 'PENDING', icon: Clock };
  }
};

const TicketCard = memo(({ item, onPress }) => {
  const config = getStatusConfig(item.status);
  const StatusIcon = config.icon;

  return (
    <TouchableOpacity
      style={styles.ticketCard}
      onPress={() => onPress(item.id)}
      activeOpacity={0.8}
    >
      <View style={[styles.cardStripe, { backgroundColor: config.color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject || 'Untitled Request'}</Text>
          <View style={[styles.badge, { backgroundColor: config.color + '15' }]}>
            <StatusIcon size={10} color={config.color} />
            <Text style={[styles.badgeText, { color: config.color }]}>{config.label}</Text>
          </View>
        </View>
        <Text style={styles.ticketDesc} numberOfLines={2}>
          {item.description || 'No details provided.'}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={styles.ticketId}>#{item.id?.slice(0, 6).toUpperCase()}</Text>
          <View style={styles.dateRow}>
            <Clock size={12} color={COLORS.textMuted} />
            <Text style={styles.dateText}>
              {item.created_at ? new Date(item.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
            </Text>
          </View>
        </View>
      </View>
      <ChevronRight size={18} color={COLORS.textMuted} style={{ alignSelf: 'center', marginRight: 16 }} />
    </TouchableOpacity>
  );
});

const TicketsListScreen = () => {
  const navigation = useNavigation();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');

  const fetchTickets = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error) setTickets(data || []);
    } catch (e) {
      console.error('Fetch tickets error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Realtime subscription
  useEffect(() => {
    let userId = null;
    const setup = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      userId = user?.id;
      if (!userId) return;

      const channel = supabase
        .channel('tickets-list')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'tickets',
          filter: `user_id=eq.${userId}`,
        }, () => fetchTickets())
        .subscribe();

      return () => supabase.removeChannel(channel);
    };
    setup();
  }, [fetchTickets]);

  const filteredTickets = tickets.filter((t) => {
    if (activeFilter === 'Active') return t.status !== 'resolved';
    if (activeFilter === 'Resolved') return t.status === 'resolved';
    return true;
  });

  const handleTicketPress = useCallback((ticketId) => {
    navigation.navigate('TicketTracking', { ticketId });
  }, [navigation]);

  const renderTicket = useCallback(({ item }) => (
    <TicketCard item={item} onPress={handleTicketPress} />
  ), [handleTicketPress]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>SUPPORT CENTER</Text>
          <Text style={styles.headerTitle}>My Tickets</Text>
        </View>
        <View style={styles.countBadge}>
          <Ticket size={16} color={COLORS.primary} />
          <Text style={styles.countText}>{tickets.length}</Text>
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.chip, activeFilter === f && styles.chipActive]}
            onPress={() => setActiveFilter(f)}
            activeOpacity={0.8}
          >
            <Text style={[styles.chipText, activeFilter === f && styles.chipTextActive]}>{f}</Text>
            {f !== 'All' && (
              <Text style={[styles.chipCount, activeFilter === f && styles.chipCountActive]}>
                {f === 'Active'
                  ? tickets.filter(t => t.status !== 'resolved').length
                  : tickets.filter(t => t.status === 'resolved').length}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <FlatList
          data={filteredTickets}
          keyExtractor={(item) => item.id}
          renderItem={renderTicket}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchTickets(); }} colors={[COLORS.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Inbox size={56} color={COLORS.textMuted} strokeWidth={1.2} />
              <Text style={styles.emptyTitle}>No Tickets Found</Text>
              <Text style={styles.emptyMsg}>
                {activeFilter === 'All' ? "You haven't submitted any tickets yet." : `No ${activeFilter.toLowerCase()} tickets.`}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 20,
  },
  headerLabel: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.5, marginBottom: 4 },
  headerTitle: { fontSize: 30, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },
  countBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primaryLight, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 14, borderWidth: 1, borderColor: COLORS.primary + '30',
  },
  countText: { fontSize: 16, fontWeight: '900', color: COLORS.primary },
  // Filters
  filterRow: { flexDirection: 'row', paddingHorizontal: 24, gap: 10, marginBottom: 16 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: COLORS.textLight },
  chipTextActive: { color: '#fff' },
  chipCount: { fontSize: 12, fontWeight: '800', color: COLORS.textMuted },
  chipCountActive: { color: 'rgba(255,255,255,0.8)' },
  // List
  listContent: { paddingHorizontal: 20, paddingBottom: 120 },
  ticketCard: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 22,
    marginBottom: 14, overflow: 'hidden',
    ...SHADOWS.soft, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)',
  },
  cardStripe: { width: 5 },
  cardBody: { flex: 1, padding: 18 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  ticketSubject: { fontSize: 15, fontWeight: '800', color: COLORS.text, flex: 1, marginRight: 10 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100,
  },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  ticketDesc: { fontSize: 13, color: COLORS.textLight, lineHeight: 20, marginBottom: 14 },
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.04)', paddingTop: 12,
  },
  ticketId: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted, backgroundColor: COLORS.background, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  // Empty
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyWrap: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  emptyMsg: { fontSize: 14, color: COLORS.textLight, textAlign: 'center' },
});

export default TicketsListScreen;
