import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BrainCircuit, Clock, LogOut, RefreshCw } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';

export default function PendingApprovalScreen({ onRefreshStatus }) {
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const handleRefresh = async () => {
    if (checking) return;
    setChecking(true);
    try {
      if (typeof onRefreshStatus === 'function') {
        await onRefreshStatus();
      } else {
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData?.session?.user?.id;
        if (!userId) {
          await supabase.auth.signOut();
          return;
        }
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, status')
          .eq('id', userId)
          .single();

        if (
          profile?.status !== 'pending_approval' &&
          profile?.status !== 'pending' &&
          profile?.role !== 'pending_approval'
        ) {
          await supabase.auth.refreshSession();
        } else {
          Alert.alert('Status Check', 'Your account is still awaiting administrator approval. Please check back later.');
        }
      }
    } catch (err) {
      Alert.alert('Status Check', err?.message || 'Unable to refresh approval status.');
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch (err) {
      Alert.alert('Error', err?.message || 'Failed to sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#0b1f17', '#0f2e22', '#064e3b']} style={styles.heroBanner}>
        <View style={styles.brandRow}>
          <View style={styles.logoBadge}>
            <BrainCircuit size={22} color="#34d399" />
          </View>
          <Text style={styles.brandTitle}>
            HELPDESK<Text style={styles.brandAccent}>.AI</Text>
          </Text>
        </View>
        <Text style={styles.heroSubtitle}>Enterprise AI IT Service Management</Text>
      </LinearGradient>

      <View style={styles.cardContainer}>
        <View style={styles.contentCard}>
          <View style={styles.iconContainer}>
            <Clock size={40} color="#f59e0b" />
          </View>
          <Text style={styles.cardTitle}>Account Under Review</Text>
          <Text style={styles.cardDescription}>
            Your registration was submitted successfully and is awaiting administrator approval.
            Once an administrator activates your account, you will have immediate access to your workspace.
          </Text>

          <TouchableOpacity
            style={styles.refreshButton}
            onPress={handleRefresh}
            disabled={checking}
            activeOpacity={0.8}
          >
            {checking ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <RefreshCw size={18} color="#ffffff" />
                <Text style={styles.refreshButtonText}>Check Approval Status</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.signOutButton}
            onPress={handleSignOut}
            disabled={signingOut}
            activeOpacity={0.8}
          >
            {signingOut ? (
              <ActivityIndicator color={COLORS.error} size="small" />
            ) : (
              <>
                <LogOut size={16} color={COLORS.error} />
                <Text style={styles.signOutButtonText}>Sign Out</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b1f17',
  },
  heroBanner: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 36,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(52, 211, 153, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  brandAccent: {
    color: '#34d399',
  },
  heroSubtitle: {
    fontSize: 13,
    color: '#a7f3d0',
    marginTop: 8,
    fontWeight: '500',
  },
  cardContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    justifyContent: 'center',
  },
  contentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    ...SHADOWS.medium,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fef3c7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  cardDescription: {
    fontSize: 14,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    marginBottom: 12,
  },
  refreshButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'transparent',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
  },
  signOutButtonText: {
    color: COLORS.error,
    fontSize: 14,
    fontWeight: '600',
  },
});
