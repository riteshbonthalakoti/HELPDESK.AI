import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet, View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, RefreshControl, Switch, StatusBar, Alert, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import { 
  Cpu, Database, ShieldCheck, Save, RotateCcw, 
  Clock, Bell, Inbox, Mail, ChevronRight 
} from 'lucide-react-native';
import { useNotification } from '../../components/NotificationProvider';
import EmailChangeModal from '../../components/EmailChangeModal';
import * as Haptics from 'expo-haptics';

const StepperControl = ({ label, value, onValueChange, min = 0.1, max = 1.0, step = 0.05, suffix = '%' }) => {
  const handleDecrement = () => {
    if (value > min) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onValueChange(Math.max(min, parseFloat((value - step).toFixed(2))));
    }
  };

  const handleIncrement = () => {
    if (value < max) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onValueChange(Math.min(max, parseFloat((value + step).toFixed(2))));
    }
  };

  const displayValue = suffix === '%' ? `${(value * 100).toFixed(0)}%` : value.toFixed(0);

  return (
    <View style={styles.settingControlRow}>
      <Text style={styles.controlLabel}>{label}</Text>
      <View style={styles.stepperContainer}>
        <TouchableOpacity 
          style={[styles.stepperBtn, value <= min && styles.disabledBtn]} 
          onPress={handleDecrement}
          disabled={value <= min}
        >
          <Text style={styles.stepperBtnText}>-</Text>
        </TouchableOpacity>
        
        <View style={styles.stepperValueContainer}>
          <Text style={styles.stepperValueText}>{displayValue}</Text>
        </View>

        <TouchableOpacity 
          style={[styles.stepperBtn, value >= max && styles.disabledBtn]} 
          onPress={handleIncrement}
          disabled={value >= max}
        >
          <Text style={styles.stepperBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const AdminSettingsScreen = () => {
  const { success, error: toastError } = useNotification();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);

  // Settings states
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.80);
  const [duplicateSensitivity, setDuplicateSensitivity] = useState(0.85);
  const [enableAutoResolve, setEnableAutoResolve] = useState(false);
  const [autoCloseEnabled, setAutoCloseEnabled] = useState(true);
  const [autoCloseDays, setAutoCloseDays] = useState(7);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [adminAlerts, setAdminAlerts] = useState(true);
  const [digestFrequency, setDigestFrequency] = useState('daily'); // 'daily' | 'weekly'

  const fetchSettings = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (profileData) {
        setProfile(profileData);
        
        const companyId = profileData.company_id;
        if (companyId) {
          // Fetch settings from system_settings
          const { data: settings, error } = await supabase
            .from('system_settings')
            .select('*')
            .eq('company_id', companyId)
            .single();

          if (!error && settings) {
            setConfidenceThreshold(settings.ai_confidence_threshold ?? 0.80);
            setDuplicateSensitivity(settings.duplicate_sensitivity ?? 0.85);
            setEnableAutoResolve(settings.enable_auto_resolve ?? false);
            setAutoCloseEnabled(settings.auto_close_enabled ?? true);
            setAutoCloseDays(settings.auto_close_days ?? 7);
            setEmailNotifications(settings.email_notifications ?? true);
            setAdminAlerts(settings.admin_alerts ?? true);
            setDigestFrequency(settings.digest_frequency ?? 'daily');
          }
        }
      }
    } catch (e) {
      console.error('Fetch settings error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileData) {
        setProfile(profileData);
      }
    } catch (e) {
      console.error('Refresh profile error:', e);
    }
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSettings();
  };

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSaveSettings = async () => {
    const companyId = profile?.company_id;
    if (!companyId) {
      toastError("Link Error", "Your profile is not associated with any company.");
      return;
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSaving(true);

    try {
      // Upsert into system_settings mapping to precise columns
      const { error } = await supabase
        .from('system_settings')
        .upsert({
          company_id: companyId,
          ai_confidence_threshold: confidenceThreshold,
          duplicate_sensitivity: duplicateSensitivity,
          enable_auto_resolve: enableAutoResolve,
          auto_close_enabled: autoCloseEnabled,
          auto_close_days: autoCloseDays,
          email_notifications: emailNotifications,
          admin_alerts: adminAlerts,
          digest_frequency: digestFrequency,
          updated_at: new Date().toISOString()
        });

      if (error) {
        console.error('Save settings error details:', error);
        toastError("Save Failed", "Could not synchronize settings to database.");
      } else {
        success("Settings Saved", "AI thresholds and SLA guidelines synchronized successfully!");
      }
    } catch (e) {
      console.error(e);
      toastError("Error", "An unexpected error occurred during save.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfidenceThreshold(0.80);
    setDuplicateSensitivity(0.85);
    setEnableAutoResolve(false);
    setAutoCloseEnabled(true);
    setAutoCloseDays(7);
    setEmailNotifications(true);
    setAdminAlerts(true);
    setDigestFrequency('daily');
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>System Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
      >
        {/* Section 0: Account Email / Gmail Verification */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Mail size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>Account Email / Verification</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Switch your {profile?.company || 'RITESH PVT LTD'} email directly using a 6-digit OTP sent to your new email. Direct verification to the new email only, no old-email link.
          </Text>

          <View style={styles.emailCardBody}>
            <View style={styles.emailInfoRow}>
              <Text style={styles.emailLabel}>REGISTERED ADMIN EMAIL</Text>
              <Text style={styles.emailValue}>{profile?.email || 'Not configured'}</Text>
            </View>

            <TouchableOpacity
              style={styles.emailChangeBtn}
              onPress={() => setShowEmailModal(true)}
              activeOpacity={0.8}
            >
              <Mail size={16} color="#fff" />
              <Text style={styles.emailChangeBtnText}>Change &amp; Verify Email</Text>
              <ChevronRight size={16} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 1: AI Engine Benchmarks */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Cpu size={20} color={COLORS.primary} />
            <Text style={styles.sectionTitle}>AI Neural Benchmarks</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Configure standard confidence limits to bypass manual ticketing queues.
          </Text>

          <View style={styles.controlsList}>
            <StepperControl
              label="Routing Confidence"
              value={confidenceThreshold}
              onValueChange={setConfidenceThreshold}
              min={0.1}
              max={1.0}
              suffix="%"
            />
            <Text style={styles.helpText}>
              Tickets with category classification confidence above this threshold will bypass manual triage.
            </Text>

            <View style={styles.separator} />

            <View style={styles.settingControlRow}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={styles.controlLabel}>AI Auto-Resolution</Text>
                <Text style={styles.helpText}>
                  Allow the system to automatically close tickets when a verified solution RAG score exceeds 95%.
                </Text>
              </View>
              <Switch
                value={enableAutoResolve}
                onValueChange={(val) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setEnableAutoResolve(val);
                }}
                trackColor={{ false: '#e5e7eb', true: COLORS.primaryLight }}
                thumbColor={enableAutoResolve ? COLORS.primary : '#9ca3af'}
              />
            </View>
          </View>
        </View>

        {/* Section 2: Duplication Parameters */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Database size={20} color="#8b5cf6" />
            <Text style={styles.sectionTitle}>Duplicate Mitigation</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Adjust semantic limits to identify duplicate support inquiries automatically.
          </Text>

          <View style={styles.controlsList}>
            <StepperControl
              label="Sensitivity Threshold"
              value={duplicateSensitivity}
              onValueChange={setDuplicateSensitivity}
              min={0.5}
              max={1.0}
              suffix="%"
            />
            <Text style={styles.helpText}>
              A higher percentage demands exact word matching, while a lower percentage flags conceptual duplicates.
            </Text>
          </View>
        </View>

        {/* Section 3: Auto-Close Tickets */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Inbox size={20} color="#06b6d4" />
            <Text style={styles.sectionTitle}>Auto-Close Settings</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Configure standard procedures for resolving ticket inactivity.
          </Text>

          <View style={styles.controlsList}>
            <View style={styles.settingControlRow}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={styles.controlLabel}>Auto-Close Inactive</Text>
                <Text style={styles.helpText}>
                  Automatically archive resolved tickets after a period of user inactivity.
                </Text>
              </View>
              <Switch
                value={autoCloseEnabled}
                onValueChange={(val) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setAutoCloseEnabled(val);
                }}
                trackColor={{ false: '#e5e7eb', true: COLORS.primaryLight }}
                thumbColor={autoCloseEnabled ? COLORS.primary : '#9ca3af'}
              />
            </View>

            {autoCloseEnabled && (
              <>
                <View style={styles.separator} />
                <StepperControl
                  label="Inactivity Days"
                  value={autoCloseDays}
                  onValueChange={setAutoCloseDays}
                  min={1}
                  max={30}
                  step={1}
                  suffix=""
                />
              </>
            )}
          </View>
        </View>

        {/* Section 4: Notifications and Digests */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Bell size={20} color="#f59e0b" />
            <Text style={styles.sectionTitle}>Notifications & Digests</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Configure administrator alert guidelines and scheduled digest updates.
          </Text>

          <View style={styles.controlsList}>
            <View style={styles.settingControlRow}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={styles.controlLabel}>Email Notifications</Text>
                <Text style={styles.helpText}>Receive summary digests and incident reports via work email.</Text>
              </View>
              <Switch
                value={emailNotifications}
                onValueChange={(val) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setEmailNotifications(val);
                }}
                trackColor={{ false: '#e5e7eb', true: COLORS.primaryLight }}
                thumbColor={emailNotifications ? COLORS.primary : '#9ca3af'}
              />
            </View>

            <View style={styles.separator} />

            <View style={styles.settingControlRow}>
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={styles.controlLabel}>Critical Admin Alerts</Text>
                <Text style={styles.helpText}>Enable push notifications for critical Priority 1 events.</Text>
              </View>
              <Switch
                value={adminAlerts}
                onValueChange={(val) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setAdminAlerts(val);
                }}
                trackColor={{ false: '#e5e7eb', true: COLORS.primaryLight }}
                thumbColor={adminAlerts ? COLORS.primary : '#9ca3af'}
              />
            </View>

            {emailNotifications && (
              <>
                <View style={styles.separator} />
                <View style={styles.settingControlRow}>
                  <Text style={styles.controlLabel}>Digest Frequency</Text>
                  <View style={styles.frequencyPicker}>
                    <TouchableOpacity 
                      style={[styles.freqBtn, digestFrequency === 'daily' && styles.activeFreqBtn]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDigestFrequency('daily');
                      }}
                    >
                      <Text style={[styles.freqBtnText, digestFrequency === 'daily' && styles.activeFreqBtnText]}>Daily</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.freqBtn, digestFrequency === 'weekly' && styles.activeFreqBtn]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDigestFrequency('weekly');
                      }}
                    >
                      <Text style={[styles.freqBtnText, digestFrequency === 'weekly' && styles.activeFreqBtnText]}>Weekly</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Section 5: SLA Guidelines Summary */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <ShieldCheck size={20} color="#ea580c" />
            <Text style={styles.sectionTitle}>SLA Policies & Breach Targets</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Configure escalation times based on priority categories.
          </Text>
          
          <View style={styles.policyRow}>
            <View style={[styles.policyDot, { backgroundColor: '#ef4444' }]} />
            <Text style={styles.policyText}>Critical Priority SLA Breach target: <Text style={styles.boldText}>2 Hours</Text></Text>
          </View>
          <View style={styles.policyRow}>
            <View style={[styles.policyDot, { backgroundColor: '#fbbf24' }]} />
            <Text style={styles.policyText}>High Priority SLA Breach target: <Text style={styles.boldText}>8 Hours</Text></Text>
          </View>
          <View style={styles.policyRow}>
            <View style={[styles.policyDot, { backgroundColor: '#3b82f6' }]} />
            <Text style={styles.policyText}>Medium Priority SLA Breach target: <Text style={styles.boldText}>24 Hours</Text></Text>
          </View>
          <View style={[styles.policyRow, { marginBottom: 8 }]}>
            <View style={[styles.policyDot, { backgroundColor: '#10b981' }]} />
            <Text style={styles.policyText}>Low Priority SLA Breach target: <Text style={styles.boldText}>72 Hours</Text></Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity 
            style={styles.resetBtn} 
            onPress={handleReset}
            disabled={saving}
          >
            <RotateCcw size={18} color={COLORS.textLight} />
            <Text style={styles.resetBtnText}>Reset Defaults</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.saveBtn} 
            onPress={handleSaveSettings}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Save size={18} color="#fff" />
                <Text style={styles.saveBtnText}>Save Settings</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 6-Digit OTP Email Change Modal */}
      <EmailChangeModal
        visible={showEmailModal}
        onClose={() => setShowEmailModal(false)}
        currentEmail={profile?.email}
        onSuccess={async (newEmail) => {
          setProfile((prev) => ({ ...prev, email: newEmail }));
          await refreshProfile();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  header: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 28, fontWeight: '900', color: COLORS.text, letterSpacing: -0.8 },
  scrollContent: { paddingBottom: 120 },

  // Section card
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    marginHorizontal: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
    ...SHADOWS.soft,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '900', color: COLORS.text },
  sectionDesc: { fontSize: 12.5, color: COLORS.textMuted, fontWeight: '600', lineHeight: 18, marginBottom: 16 },

  // Email verification card
  emailCardBody: { gap: 12 },
  emailInfoRow: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emailLabel: { fontSize: 10, fontWeight: '800', color: COLORS.textMuted, letterSpacing: 1, marginBottom: 4 },
  emailValue: { fontSize: 14, fontWeight: '800', color: COLORS.text, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  emailChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    height: 48,
    borderRadius: 14,
    ...SHADOWS.soft,
  },
  emailChangeBtnText: { fontSize: 13, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  
  // Controls list
  controlsList: { gap: 12 },
  settingControlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlLabel: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  
  // Steppers
  stepperContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 12, padding: 4, height: 40 },
  stepperBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', ...SHADOWS.soft },
  disabledBtn: { opacity: 0.4 },
  stepperBtnText: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  stepperValueContainer: { minWidth: 60, alignItems: 'center', justifyContent: 'center' },
  stepperValueText: { fontSize: 13, fontWeight: '800', color: COLORS.text },

  frequencyPicker: { flexDirection: 'row', backgroundColor: '#f3f4f6', padding: 3, borderRadius: 10 },
  freqBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  activeFreqBtn: { backgroundColor: '#fff', ...SHADOWS.soft },
  freqBtnText: { fontSize: 11, fontWeight: '700', color: COLORS.textMuted },
  activeFreqBtnText: { color: COLORS.text, fontWeight: '900' },

  helpText: { fontSize: 11.5, color: COLORS.textMuted, fontWeight: '500', lineHeight: 16, marginTop: 4 },
  separator: { height: 1, backgroundColor: 'rgba(0,0,0,0.05)', marginVertical: 8 },
  
  policyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6, paddingHorizontal: 4 },
  policyDot: { width: 8, height: 8, borderRadius: 4 },
  policyText: { fontSize: 13, color: COLORS.textLight, fontWeight: '500' },
  boldText: { fontWeight: '800', color: COLORS.text },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 12, marginHorizontal: 20, marginTop: 8 },
  resetBtn: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    backgroundColor: '#fff', 
    height: 52, 
    borderRadius: 18, 
    borderWidth: 1.5, 
    borderColor: 'rgba(0,0,0,0.08)',
    ...SHADOWS.soft 
  },
  resetBtnText: { fontSize: 14, fontWeight: '800', color: COLORS.textLight },
  saveBtn: { 
    flex: 1.5, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 8, 
    backgroundColor: COLORS.primary, 
    height: 52, 
    borderRadius: 18, 
    ...SHADOWS.medium,
    shadowColor: COLORS.primary 
  },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' }
});

export default AdminSettingsScreen;
