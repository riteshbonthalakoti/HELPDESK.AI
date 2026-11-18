import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, StatusBar, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import {
  Ticket, Activity, ShieldCheck, AlertTriangle, Clock,
  Cpu, Users, ChevronRight, BarChart3, Settings
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const StatCard = ({ label, value, color, subtitle, icon: Icon }) => {
  return (
    <View style={[styles.statCard, { borderLeftColor: color, borderLeftWidth: 4 }]}>
      <View style={styles.statCardHeader}>
        <Text style={styles.statLabel}>{label}</Text>
        <View style={[styles.statIconContainer, { backgroundColor: color + '15' }]}>
          <Icon size={18} color={color} />
        </View>
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSubtitle}>{subtitle}</Text>
    </View>
  );
};

const AdminDashboardScreen = () => {
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const fetchData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch profile details
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileData) setProfile(profileData);

      // Fetch all company tickets (filter by verified company_id workspace UUID)
      let query = supabase
        .from('tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (profileData?.company_id) {
        query = query.eq('company_id', profileData.company_id);
      } else if (profileData?.company) {
        query = query.eq('company', profileData.company);
      }
      
      const { data: ticketData, error } = await query;
      if (!error && ticketData) {
        setTickets(ticketData);
      }
    } catch (e) {
      console.error('Admin Dashboard fetch error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Subscribe to all company ticket changes
    const ticketsChannel = supabase
      .channel('admin_dashboard_tickets')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'tickets' 
      }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(ticketsChannel);
    };
  }, [fetchData]);

  // Keep countdown updated
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchData();
  };

  // KPIs
  const totalTickets = tickets.length;
  const activeTickets = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed').length;
  const autoResolved = tickets.filter(t => t.status?.includes('auto') || (t.status === 'resolved' && t.auto_resolve)).length;
  const escalatedTickets = tickets.filter(t => t.status === 'in_progress' || t.status === 'pending').length;

  // SLA calculations
  const getSlaState = (ticket) => {
    if (ticket.status === 'resolved' || ticket.status === 'closed') return 'met';
    if (ticket.sla_status === 'BREACHED') return 'breached';
    if (!ticket.sla_breach_at) return 'active';
    
    const deadline = new Date(ticket.sla_breach_at).getTime();
    const remaining = deadline - nowMs;
    if (remaining <= 0) return 'breached';
    if (remaining <= 60 * 60 * 1000) return 'warning'; // 1 hour warning
    return 'active';
  };

  const actionableTickets = tickets.filter(t => t.status !== 'resolved' && t.status !== 'closed');
  const breachedCount = actionableTickets.filter(t => getSlaState(t) === 'breached').length;
  const warningCount = actionableTickets.filter(t => getSlaState(t) === 'warning').length;
  const criticalCount = actionableTickets.filter(t => String(t.priority || '').toLowerCase() === 'critical').length;
  const healthyCount = actionableTickets.filter(t => getSlaState(t) === 'active').length;

  const getNextSlaCountdown = () => {
    const nextTicket = actionableTickets
      .map(t => ({ t, deadline: t.sla_breach_at ? new Date(t.sla_breach_at).getTime() : null }))
      .filter(item => item.deadline && item.deadline > nowMs)
      .sort((a, b) => a.deadline - b.deadline)[0];

    if (!nextTicket) return 'No active deadlines';
    const remaining = nextTicket.deadline - nowMs;
    const totalMinutes = Math.ceil(remaining / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `Next deadline in ${hours}h ${minutes}m`;
    return `Next deadline in ${minutes}m`;
  };

  // AI models data
  const totalCount = tickets.length || 1;
  const categorized = tickets.filter(t => t.category && t.category.toLowerCase() !== 'unassigned' && t.category !== 'Other').length;
  const prioritized = tickets.filter(t => t.priority).length;

  const aiSubsystems = [
    { name: 'Classifier Engine', status: categorized > 0 ? 'Active' : 'Standby', details: `${((categorized / totalCount) * 100).toFixed(0)}% Coverage`, icon: Cpu, color: '#16a34a' },
    { name: 'Priority Routing', status: prioritized > 0 ? 'Active' : 'Standby', details: `${((prioritized / totalCount) * 100).toFixed(0)}% Routed`, icon: BarChart3, color: '#3b82f6' },
    { name: 'Semantic Analysis', status: tickets.length > 0 ? 'Active' : 'Standby', details: `${tickets.length} Scanned`, icon: Activity, color: '#8b5cf6' },
    { name: 'Duplicate Detection', status: 'Active', details: 'Optimal', icon: ShieldCheck, color: '#f97316' },
  ];

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Admin Portal</Text>
            <Text style={styles.subtitle}>{profile?.company || 'RITESH PVT LTD'}</Text>
          </View>
          <View style={styles.activePill}>
            <View style={styles.pulseDot} />
            <Text style={styles.activePillText}>System Live</Text>
          </View>
        </View>

        {/* KPIs Grid */}
        <View style={styles.kpiContainer}>
          <StatCard label="Total Tickets" value={totalTickets} color="#3b82f6" subtitle="Lifetime generated" icon={Ticket} />
          <StatCard label="Active Tickets" value={activeTickets} color="#fbbf24" subtitle="Need attention" icon={Activity} />
          <StatCard label="AI Auto-Resolved" value={autoResolved} color="#10b981" subtitle="Resolved by AI" icon={Cpu} />
          <StatCard label="Escalated Queue" value={escalatedTickets} color="#ef4444" subtitle="Requires human agent" icon={Users} />
        </View>

        {/* SLA Compliance panel */}
        <View style={styles.panelCard}>
          <View style={styles.panelHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Clock size={20} color="#dc2626" />
              <Text style={styles.panelTitle}>SLA Compliance</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Tickets')}>
              <Text style={styles.viewQueueText}>View Queue</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.slaDeadlineCountdown}>{getNextSlaCountdown()}</Text>

          <View style={styles.slaGrid}>
            <View style={[styles.slaIndicatorCard, { backgroundColor: '#fef2f2', borderColor: '#fecaca' }]}>
              <View style={styles.slaHeaderRow}>
                <AlertTriangle size={16} color="#dc2626" />
                <Text style={[styles.slaValue, { color: '#dc2626' }]}>{breachedCount}</Text>
              </View>
              <Text style={[styles.slaLabel, { color: '#dc2626' }]}>Breached</Text>
            </View>

            <View style={[styles.slaIndicatorCard, { backgroundColor: '#fffbeb', borderColor: '#fde68a' }]}>
              <View style={styles.slaHeaderRow}>
                <Clock size={16} color="#d97706" />
                <Text style={[styles.slaValue, { color: '#d97706' }]}>{warningCount}</Text>
              </View>
              <Text style={[styles.slaLabel, { color: '#d97706' }]}>Warning</Text>
            </View>

            <View style={[styles.slaIndicatorCard, { backgroundColor: '#fff7ed', borderColor: '#fed7aa' }]}>
              <View style={styles.slaHeaderRow}>
                <Activity size={16} color="#ea580c" />
                <Text style={[styles.slaValue, { color: '#ea580c' }]}>{criticalCount}</Text>
              </View>
              <Text style={[styles.slaLabel, { color: '#ea580c' }]}>Critical</Text>
            </View>

            <View style={[styles.slaIndicatorCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
              <View style={styles.slaHeaderRow}>
                <ShieldCheck size={16} color="#16a34a" />
                <Text style={[styles.slaValue, { color: '#16a34a' }]}>{healthyCount}</Text>
              </View>
              <Text style={[styles.slaLabel, { color: '#16a34a' }]}>Healthy</Text>
            </View>
          </View>
        </View>

        {/* AI Health Matrix */}
        <View style={styles.panelCard}>
          <View style={[styles.panelHeader, { marginBottom: 16 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Cpu size={20} color={COLORS.primary} />
              <Text style={styles.panelTitle}>AI Subsystem Diagnostics</Text>
            </View>
          </View>

          <View style={styles.aiList}>
            {aiSubsystems.map((sub, idx) => {
              const SubIcon = sub.icon;
              return (
                <View key={idx} style={styles.aiRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={[styles.aiIconWrap, { backgroundColor: sub.color + '12' }]}>
                      <SubIcon size={18} color={sub.color} />
                    </View>
                    <View>
                      <Text style={styles.aiSubName}>{sub.name}</Text>
                      <Text style={styles.aiSubDetails}>{sub.details}</Text>
                    </View>
                  </View>
                  <View style={[styles.aiStatusBadge, { backgroundColor: sub.status === 'Active' ? '#dcfce7' : '#f3f4f6', borderColor: sub.status === 'Active' ? '#bbf7d0' : '#e5e7eb' }]}>
                    <View style={[styles.aiStatusDot, { backgroundColor: sub.status === 'Active' ? '#22c55e' : '#9ca3af' }]} />
                    <Text style={[styles.aiStatusText, { color: sub.status === 'Active' ? '#15803d' : '#6b7280' }]}>{sub.status}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Recent Tickets queue summary */}
        <View style={styles.panelCard}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Recent Tickets</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Tickets')}>
              <Text style={styles.viewQueueText}>View All ({totalTickets})</Text>
            </TouchableOpacity>
          </View>

          {tickets.slice(0, 4).map((ticket, idx) => (
            <TouchableOpacity 
              key={ticket.id} 
              style={[styles.ticketRow, idx === Math.min(tickets.length, 4) - 1 && { borderBottomWidth: 0 }]}
              onPress={() => navigation.navigate('AdminTicketDetail', { ticketId: ticket.id })}
            >
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.ticketSubject} numberOfLines={1}>{ticket.subject}</Text>
                <Text style={styles.ticketMeta}>{ticket.category} • {ticket.assigned_team || 'Unassigned'}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.priorityBadge, { backgroundColor: ticket.priority === 'Critical' ? '#fee2e2' : ticket.priority === 'High' ? '#fef3c7' : '#f0fdf4' }]}>
                  <Text style={[styles.priorityBadgeText, { color: ticket.priority === 'Critical' ? '#ef4444' : ticket.priority === 'High' ? '#d97706' : '#16a34a' }]}>
                    {ticket.priority || 'Low'}
                  </Text>
                </View>
                <ChevronRight size={16} color={COLORS.textMuted} />
              </View>
            </TouchableOpacity>
          ))}
          {tickets.length === 0 && (
            <View style={styles.emptyTickets}>
              <Text style={styles.emptyText}>No company tickets submitted yet</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  scrollContent: { paddingBottom: 120 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: 24, 
    paddingTop: 16, 
    paddingBottom: 20 
  },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },
  subtitle: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted, marginTop: 2 },
  activePill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6, 
    backgroundColor: '#f0fdf4', 
    borderWidth: 1, 
    borderColor: '#bbf7d0', 
    borderRadius: 100, 
    paddingHorizontal: 12, 
    paddingVertical: 5 
  },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  activePillText: { fontSize: 10, fontWeight: '800', color: '#15803d', letterSpacing: 0.5, textTransform: 'uppercase' },

  // KPIs
  kpiContainer: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 18, gap: 10, marginBottom: 20 },
  statCard: { 
    width: '48%', 
    backgroundColor: '#ffffff', 
    borderRadius: 20, 
    padding: 16, 
    borderLeftWidth: 4, 
    ...SHADOWS.soft 
  },
  statCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statLabel: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  statIconContainer: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: 2 },
  statSubtitle: { fontSize: 10, color: COLORS.textMuted, fontWeight: '600' },

  // Panels
  panelCard: { 
    backgroundColor: '#ffffff', 
    borderRadius: 24, 
    marginHorizontal: 20, 
    padding: 20, 
    marginBottom: 20, 
    borderWidth: 1, 
    borderColor: 'rgba(0,0,0,0.03)', 
    ...SHADOWS.soft 
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  panelTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  viewQueueText: { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  slaDeadlineCountdown: { fontSize: 11, fontWeight: '800', color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 },
  
  // SLA
  slaGrid: { flexDirection: 'row', gap: 8 },
  slaIndicatorCard: { flex: 1, borderRadius: 16, padding: 12, borderWidth: 1 },
  slaHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slaValue: { fontSize: 18, fontWeight: '900' },
  slaLabel: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.2, marginTop: 8 },

  // AI Matrix
  aiList: { gap: 10 },
  aiRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: '#f8faf9', 
    padding: 12, 
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.01)'
  },
  aiIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  aiSubName: { fontSize: 13, fontWeight: '700', color: COLORS.text },
  aiSubDetails: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
  aiStatusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  aiStatusDot: { width: 4, height: 4, borderRadius: 2 },
  aiStatusText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },

  // Recent queue row
  ticketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)' },
  ticketSubject: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  ticketMeta: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600', marginTop: 3 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 100 },
  priorityBadgeText: { fontSize: 9, fontWeight: '800' },
  emptyTickets: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' }
});

export default AdminDashboardScreen;
