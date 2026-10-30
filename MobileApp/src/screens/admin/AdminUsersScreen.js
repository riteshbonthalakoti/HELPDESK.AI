import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  StyleSheet, View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, Alert, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import {
  UserCheck, UserX, Users, Mail, Building2, ShieldAlert,
  Search, X, Eye, Trash2, Shield, Calendar, Hash, Loader2
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useNotification } from '../../components/NotificationProvider';

const { success, error: notifyError, warning, info } = useNotification();
// ── Memoized list item — prevents re-render on every parent state change ──────
const UserItem = React.memo(({ item, isPending, updatingUser, isUserAdmin, onApprove, onDecline, onProfileDetail }) => {
  return (
    <View style={styles.userCard}>
      <TouchableOpacity
        style={styles.avatar}
        onPress={() => onProfileDetail(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.avatarText}>{item.full_name?.[0]?.toUpperCase() || 'U'}</Text>
      </TouchableOpacity>

      <View style={styles.userInfo}>
        <TouchableOpacity onPress={() => onProfileDetail(item)} activeOpacity={0.7}>
          <Text style={styles.userName}>{item.full_name}</Text>
        </TouchableOpacity>
        <View style={styles.metaRow}>
          <Mail size={12} color={COLORS.textMuted} />
          <Text style={styles.metaText} numberOfLines={1}>{item.email}</Text>
        </View>
        <View style={styles.metaRow}>
          <Shield size={12} color={isUserAdmin ? COLORS.primary : COLORS.textMuted} />
          <Text style={[styles.metaText, isUserAdmin && { color: COLORS.primary, fontWeight: '700' }]}>
            {isUserAdmin ? 'Administrator' : 'Standard Employee'}
          </Text>
        </View>
      </View>

      {updatingUser === item.id ? (
        <ActivityIndicator size="small" color={COLORS.primary} style={{ marginRight: 10 }} />
      ) : isPending ? (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => onApprove(item)}
            title="Approve"
          >
            <UserCheck size={18} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.declineBtn]}
            onPress={() => onDecline(item)}
            title="Decline"
          >
            <UserX size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity
            style={styles.viewDetailsBtn}
            onPress={() => onProfileDetail(item)}
          >
            <Eye size={16} color={COLORS.textLight} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const AdminUsersScreen = () => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'active'
  const [searchQuery, setSearchQuery] = useState('');
  const [currentAdmin, setCurrentAdmin] = useState(null);

  // Modal / Detail States
  const [selectedUser, setSelectedUser] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [updatingUser, setUpdatingUser] = useState(null); // ID of user currently being modified in DB

  const fetchUsers = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentAdmin(user);

      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!adminProfile?.company) return;

      // Fetch all profiles belonging to the same company
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('company', adminProfile.company)
        .order('full_name', { ascending: true });

      if (!error && data) {
        // Exclude the current logged in admin themselves from directory list
        setProfiles(data.filter(p => p.id !== user.id));
      }
    } catch (e) {
      console.error('Fetch company users error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();

    // Subscribe to profile changes to update real-time
    const profilesChannel = supabase
      .channel('company_profiles_admin')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'profiles'
      }, () => fetchUsers())
      .subscribe();

    return () => {
      supabase.removeChannel(profilesChannel);
    };
  }, [fetchUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchUsers();
  };

  const handleApprove = useCallback(async (userItem) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setUpdatingUser(userItem.id);
    try {
      // 1. Update Profile in public.profiles
      const { error } = await supabase
        .from('profiles')
        .update({
          status: 'active',
          company_id: userItem.company_id || null
        })
        .eq('id', userItem.id);

      if (error) {
        notifyError("Error", "Could not approve user registration.");
      } else {
        // 2. Insert system notification to let user know they're approved
        await supabase.from('notifications').insert({
          user_id: userItem.id,
          title: "Account Approved",
          message: `Your registration for ${userItem.company} has been approved by the Administrator. Welcome!`,
          type: "status_change",
          is_unread: true
        });

        // 3. Try to trigger background edge email function if available (Non-blocking)
        (async () => {
          try {
            await supabase.functions.invoke('send-user-approval-email', {
              body: {
                userId: userItem.id,
                email: userItem.email,
                name: userItem.full_name,
                company: userItem.company
              }
            });
          } catch (_) { }
        })();

        fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingUser(null);
    }
  }, [fetchUsers]);

  const handleDecline = useCallback((userItem) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    warning("Declining Registration", `Rejecting ${userItem.full_name}'s registration.`);
    setUpdatingUser(userItem.id);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'rejected' })
        .eq('id', userItem.id);

      if (error) {
        notifyError("Error", "Could not reject user.");
      } else {
        fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingUser(null);
    }
  }, [fetchUsers]);

  const handleUpdateRole = async (userItem, newRole) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setUpdatingUser(userItem.id);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', userItem.id);

      if (error) {
        notifyError("Error", "Could not update user security clearance.");
      } else {
        if (selectedUser?.id === userItem.id) {
          setSelectedUser(prev => ({ ...prev, role: newRole }));
        }
        fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingUser(null);
    }
  };

  const handlePurgeUser = (userItem) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    warning("Purging User", `Permanently deleting @${userItem.full_name}'s profile.`);
    setUpdatingUser(userItem.id);
    try {
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userItem.id);

      if (error) {
        notifyError("Error", "Could not delete user profile from DB.");
      } else {
        setShowDetailModal(false);
        setSelectedUser(null);
        fetchUsers();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingUser(null);
    }
  };

  const getFilteredUsers = useMemo(() => {
    let filtered = profiles;

    // Tab Filter
    if (activeTab === 'pending') {
      filtered = filtered.filter(p => p.status === 'pending_approval');
    } else {
      filtered = filtered.filter(p => p.status === 'active');
    }

    // Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(p =>
        p.full_name?.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q) ||
        p.role?.toLowerCase().includes(q) ||
        String(p.id).includes(q)
      );
    }

    return filtered;
  }, [profiles, activeTab, searchQuery]);

  const openProfileDetail = useCallback((userItem) => {
    Haptics.selectionAsync();
    setSelectedUser(userItem);
    setShowDetailModal(true);
  }, []);

  const handleApproveCb = useCallback((item) => handleApprove(item), [handleApprove]);
  const handleDeclineCb = useCallback((item) => handleDecline(item), [handleDecline]);
  const openProfileDetailCb = useCallback((item) => openProfileDetail(item), [openProfileDetail]);

  const renderUserItem = useCallback(({ item }) => {
    const isPending = item.status === 'pending_approval';
    const isUserAdmin = item.role === 'admin' || item.role === 'master_admin';

    return (
      <UserItem
        item={item}
        isPending={isPending}
        isUserAdmin={isUserAdmin}
        updatingUser={updatingUser}
        onApprove={handleApproveCb}
        onDecline={handleDeclineCb}
        onProfileDetail={openProfileDetailCb}
      />
    );
  }, [updatingUser, handleApproveCb, handleDeclineCb, openProfileDetailCb]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Company Directory</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Search size={18} color={COLORS.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Search employees by name, email, role..."
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

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'pending' && styles.activeTabButton]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab('pending');
          }}
        >
          <ShieldAlert size={16} color={activeTab === 'pending' ? COLORS.primary : COLORS.textMuted} />
          <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>
            Pending Review ({profiles.filter(p => p.status === 'pending_approval').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'active' && styles.activeTabButton]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab('active');
          }}
        >
          <Users size={16} color={activeTab === 'active' ? COLORS.primary : COLORS.textMuted} />
          <Text style={[styles.tabText, activeTab === 'active' && styles.activeTabText]}>
            Active Members ({profiles.filter(p => p.status === 'active').length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={getFilteredUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderUserItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          initialNumToRender={10}
          getItemLayout={(data, index) => ({
            length: 80,
            offset: 80 * index,
            index,
          })}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Users size={48} color={COLORS.textMuted} strokeWidth={1} />
              <Text style={styles.emptyText}>
                {activeTab === 'pending' ? 'No registrations pending review' : 'No active members match your search'}
              </Text>
            </View>
          }
        />
      )}

      {/* Sliding Profile Detail Modal Sheet */}
      <Modal
        visible={showDetailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={styles.modalAvatar}>
                  <Text style={styles.modalAvatarText}>{selectedUser?.full_name?.[0]?.toUpperCase() || 'U'}</Text>
                </View>
                <View>
                  <Text style={styles.modalTitle} numberOfLines={1}>{selectedUser?.full_name}</Text>
                  <Text style={styles.modalSubtitle} numberOfLines={1}>{selectedUser?.email}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowDetailModal(false)} style={styles.closeBtn}>
                <X size={20} color={COLORS.textLight} />
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            {selectedUser && (
              <View style={styles.modalBody}>
                <Text style={styles.sectionHeader}>ENTITY METADATA</Text>

                <View style={styles.metaCard}>
                  <View style={styles.metaCardRow}>
                    <Hash size={14} color={COLORS.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.metaLabel}>SYSTEM UUID</Text>
                      <Text style={styles.metaValueMono}>{selectedUser.id}</Text>
                    </View>
                  </View>

                  <View style={[styles.metaCardRow, { borderBottomWidth: 0 }]}>
                    <Calendar size={14} color={COLORS.textMuted} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.metaLabel}>JOINED DATE</Text>
                      <Text style={styles.metaValue}>
                        {new Date(selectedUser.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.sectionHeader}>SECURITY PROTOCOLS</Text>

                <View style={styles.rolesRow}>
                  <TouchableOpacity
                    style={[styles.roleOptionCard, selectedUser.role === 'user' && styles.activeRoleCard]}
                    onPress={() => handleUpdateRole(selectedUser, 'user')}
                  >
                    <Users size={20} color={selectedUser.role === 'user' ? COLORS.primary : COLORS.textMuted} />
                    <Text style={[styles.roleOptionText, selectedUser.role === 'user' && styles.activeRoleText]}>Standard User</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.roleOptionCard, selectedUser.role === 'admin' && styles.activeRoleCard]}
                    onPress={() => handleUpdateRole(selectedUser, 'admin')}
                  >
                    <Shield size={20} color={selectedUser.role === 'admin' ? COLORS.primary : COLORS.textMuted} />
                    <Text style={[styles.roleOptionText, selectedUser.role === 'admin' && styles.activeRoleText]}>Administrator</Text>
                  </TouchableOpacity>
                </View>

                {/* Loading state indicator for updates */}
                {updatingUser === selectedUser.id && (
                  <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginVertical: 8 }}>
                    <ActivityIndicator size="small" color={COLORS.primary} />
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.primary }}>SYNCHRONIZING ROLES...</Text>
                  </View>
                )}

                {/* Direct Actions */}
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.purgeBtn}
                    onPress={() => handlePurgeUser(selectedUser)}
                    disabled={updatingUser === selectedUser.id}
                  >
                    <Trash2 size={16} color="#fff" />
                    <Text style={styles.purgeBtnText}>Purge Employee Record</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },

  // Search
  searchSection: { paddingHorizontal: 20, marginBottom: 12 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, paddingHorizontal: 16, height: 52,
    ...SHADOWS.soft, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)'
  },
  input: { flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '600', color: COLORS.text },
  clearSearchBtn: { padding: 4 },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 16,
    padding: 4,
    marginBottom: 16,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  activeTabButton: {
    backgroundColor: '#ffffff',
    ...SHADOWS.soft,
  },
  tabText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  activeTabText: {
    color: COLORS.text,
  },

  // Cards List
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
    ...SHADOWS.soft
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14
  },
  avatarText: { fontSize: 16, fontWeight: '800', color: COLORS.primary },
  userInfo: { flex: 1, gap: 3 },
  userName: { fontSize: 15, fontWeight: '800', color: COLORS.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600', maxWidth: '90%' },

  // Actions
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', ...SHADOWS.soft },
  approveBtn: { backgroundColor: COLORS.primary },
  declineBtn: { backgroundColor: '#ef4444' },

  viewDetailsBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100 },
  empty: { alignItems: 'center', marginTop: 100, gap: 12 },
  emptyText: { fontSize: 14, color: COLORS.textMuted, fontWeight: '600', textAlign: 'center', paddingHorizontal: 40 },

  // Sliding sheet modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    maxHeight: '85%',
    ...SHADOWS.soft
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalAvatar: { width: 50, height: 50, borderRadius: 16, backgroundColor: COLORS.primaryLight, justifyContent: 'center', alignItems: 'center' },
  modalAvatarText: { fontSize: 18, fontWeight: '900', color: COLORS.primary },
  modalTitle: { fontSize: 18, fontWeight: '900', color: COLORS.text, maxWidth: 220 },
  modalSubtitle: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600', marginTop: 2, maxWidth: 220 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f3f4f6', justifyContent: 'center', alignItems: 'center' },

  modalBody: { gap: 18 },
  sectionHeader: { fontSize: 10.5, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1.2 },

  metaCard: { backgroundColor: '#f8faf9', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  metaCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)' },
  metaLabel: { fontSize: 9.5, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 0.5 },
  metaValue: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginTop: 2 },
  metaValueMono: { fontSize: 11.5, fontFamily: 'monospace', fontWeight: '700', color: COLORS.text, marginTop: 2 },

  rolesRow: { flexDirection: 'row', gap: 12 },
  roleOptionCard: { flex: 1, paddingVertical: 16, alignItems: 'center', gap: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  activeRoleCard: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight + '12' },
  roleOptionText: { fontSize: 12.5, fontWeight: '700', color: COLORS.textMuted },
  activeRoleText: { color: COLORS.text, fontWeight: '900' },

  modalActions: { marginTop: 8 },
  purgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ef4444',
    height: 52,
    borderRadius: 18,
    ...SHADOWS.soft
  },
  purgeBtnText: { fontSize: 13, fontWeight: '800', color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }
});

export default AdminUsersScreen;
