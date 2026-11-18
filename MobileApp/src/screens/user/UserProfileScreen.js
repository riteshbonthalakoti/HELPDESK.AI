import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  User,
  Mail,
  Building2,
  Shield,
  LogOut,
  ChevronRight,
  Sparkles,
  CheckCircle2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import EmailChangeModal from '../../components/EmailChangeModal';

export default function UserProfileScreen() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setProfile(data);
      } else {
        setProfile({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || 'Team Member',
          role: user.user_metadata?.role || 'user',
          company: user.user_metadata?.company || 'RITESH PVT LTD',
        });
      }
    } catch (e) {
      console.error('Fetch user profile error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchProfile();
  };

  const handleSignOut = async () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await supabase.auth.signOut();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const companyName = profile?.company || 'RITESH PVT LTD';
  const userInitials = (profile?.full_name || 'User')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerLabel}>ACCOUNT &amp; SETTINGS</Text>
          <Text style={styles.headerTitle}>User Profile</Text>
        </View>

        {/* Profile Identity Card */}
        <View style={styles.identityCard}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarText}>{userInitials}</Text>
          </View>
          <View style={styles.identityDetails}>
            <Text style={styles.userName}>{profile?.full_name || 'Helpdesk User'}</Text>
            <Text style={styles.userEmail} numberOfLines={1}>
              {profile?.email || 'user@riteshpvtltd.com'}
            </Text>
            <View style={styles.badgeRow}>
              <View style={styles.companyBadge}>
                <Building2 size={11} color={COLORS.primary} />
                <Text style={styles.companyBadgeText}>{companyName}</Text>
              </View>
              <View style={styles.roleBadge}>
                <Shield size={11} color="#6366f1" />
                <Text style={styles.roleBadgeText}>
                  {(profile?.role || 'user').toUpperCase()}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Email & OTP Verification Card */}
        <View style={styles.sectionCard}>
          <View style={styles.cardHeader}>
            <View style={styles.iconCircle}>
              <Mail size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Account Email / Verification</Text>
              <Text style={styles.cardSub}>6-digit OTP direct confirmation</Text>
            </View>
          </View>

          <View style={styles.cardBody}>
            <Text style={styles.fieldLabel}>REGISTERED WORK EMAIL</Text>
            <Text style={styles.emailValue}>{profile?.email || 'Not configured'}</Text>
            <Text style={styles.infoDesc}>
              Switch your {companyName} email directly using a 6-digit OTP sent to your new email. No old-email confirmation link required.
            </Text>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => setShowEmailModal(true)}
              activeOpacity={0.8}
            >
              <Mail size={16} color="#fff" />
              <Text style={styles.actionBtnText}>Change &amp; Verify Email</Text>
              <ChevronRight size={16} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Enterprise Organization Card */}
        <View style={styles.sectionCard}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconCircle, { backgroundColor: '#eff6ff' }]}>
              <Building2 size={18} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Enterprise Organization</Text>
              <Text style={styles.cardSub}>Single-company enforcement</Text>
            </View>
          </View>

          <View style={styles.cardBody}>
            <View style={styles.orgRow}>
              <Text style={styles.orgKey}>Company Name</Text>
              <Text style={styles.orgVal}>{companyName}</Text>
            </View>
            <View style={styles.orgRow}>
              <Text style={styles.orgKey}>Workspace Status</Text>
              <View style={styles.activeRow}>
                <CheckCircle2 size={13} color="#16a34a" />
                <Text style={styles.activeVal}>Verified Active</Text>
              </View>
            </View>
            <View style={styles.orgRow}>
              <Text style={styles.orgKey}>AI Engine Triage</Text>
              <View style={styles.activeRow}>
                <Sparkles size={13} color="#9333ea" />
                <Text style={[styles.activeVal, { color: '#9333ea' }]}>Connected</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Sign Out Card */}
        <TouchableOpacity
          style={styles.signOutBtn}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <LogOut size={18} color="#ef4444" />
          <Text style={styles.signOutText}>Sign Out of HELPDESK.AI</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 6-Digit OTP Email Change Modal */}
      <EmailChangeModal
        visible={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        currentEmail={profile?.email}
        onSuccess={(newEmail) => {
          setProfile((prev) => ({ ...prev, email: newEmail }));
          fetchProfile();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  header: {
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: -0.8,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 18,
    marginBottom: 16,
    ...SHADOWS.soft,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  avatarWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: COLORS.primaryLight,
    borderWidth: 2,
    borderColor: COLORS.primary + '40',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.primary,
  },
  identityDetails: {
    flex: 1,
    gap: 3,
  },
  userName: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },
  userEmail: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  companyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  companyBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eef2ff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4f46e5',
  },
  sectionCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    marginBottom: 16,
    overflow: 'hidden',
    ...SHADOWS.soft,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },
  cardSub: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  cardBody: {
    padding: 18,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  emailValue: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 6,
  },
  infoDesc: {
    fontSize: 12,
    color: COLORS.textLight,
    lineHeight: 18,
    marginBottom: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    height: 48,
    borderRadius: 14,
    ...SHADOWS.soft,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  orgRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  orgKey: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  orgVal: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  activeVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#16a34a',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingVertical: 14,
    borderRadius: 18,
    marginTop: 8,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ef4444',
  },
});
