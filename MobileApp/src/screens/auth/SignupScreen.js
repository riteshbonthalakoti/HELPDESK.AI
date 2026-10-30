import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  ScrollView, StatusBar, Animated, Modal, FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { COLORS, SHADOWS } from '../../styles/theme';
import { Mail, Lock, User, Building2, Search, ChevronDown, Eye, EyeOff, ArrowRight, CheckCircle2, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useNotification } from '../../components/NotificationProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CompanyItem = memo(({ item, selected, onSelect }) => (
  <TouchableOpacity
    style={[styles.companyItem, selected && styles.companyItemSelected]}
    onPress={() => onSelect(item)}
    activeOpacity={0.7}
  >
    <View style={styles.companyIcon}>
      <Building2 size={18} color={selected ? COLORS.primary : 'rgba(255,255,255,0.5)'} />
    </View>
    <Text style={[styles.companyName, selected && { color: COLORS.primary }]}>
      {item.name}
    </Text>
    {selected && <CheckCircle2 size={18} color={COLORS.primary} />}
  </TouchableOpacity>
));

const SignupScreen = () => {
  const navigation = useNavigation();
  const { success, error: notifyError, info } = useNotification();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [companySearch, setCompanySearch] = useState('');
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, []);

  // Fetch companies
  useEffect(() => {
    const fetchCompanies = async () => {
      setLoadingCompanies(true);
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .eq('status', 'active')
        .order('name');
      if (data) { setCompanies(data); setFilteredCompanies(data); }
      setLoadingCompanies(false);
    };
    fetchCompanies();

    // Realtime subscription
    const channel = supabase
      .channel('companies-signup')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, fetchCompanies)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Filter companies by search
  useEffect(() => {
    const q = companySearch.toLowerCase().trim();
    setFilteredCompanies(q ? companies.filter(c => c.name.toLowerCase().includes(q)) : companies);
  }, [companySearch, companies]);

  const handleCompanySelect = useCallback((item) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCompany(item);
    setCompanyModalOpen(false);
    setCompanySearch('');
  }, []);

  const renderCompanyItem = useCallback(({ item }) => (
    <CompanyItem
      item={item}
      selected={selectedCompany?.id === item.id}
      onSelect={handleCompanySelect}
    />
  ), [selectedCompany, handleCompanySelect]);

  const handleSignup = async () => {
    if (!fullName || !email || !password || !confirmPassword) {
      notifyError('Missing Fields', 'All fields are required.');
      return;
    }
    if (!selectedCompany) {
      notifyError('Company Required', 'Please select your company.');
      return;
    }
    if (password.length < 6) {
      notifyError('Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      notifyError('Password Mismatch', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: 'user',
            company: selectedCompany.name,
            company_id: selectedCompany.id,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        // Insert user_request row
        await supabase.from('user_requests').insert([{
          user_id: data.user.id,
          company_id: selectedCompany.id,
          status: 'pending',
        }]);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      success('Registration Submitted!', 'Check your email to verify your account.');
      setSubmitted(true);
    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      notifyError('Signup Failed', err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success screen
  if (submitted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.bgBlob1} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <CheckCircle2 size={48} color={COLORS.primary} />
          </View>
          <Text style={styles.successTitle}>Registration Submitted!</Text>
          <Text style={styles.successMsg}>
            We've sent a verification email to{'\n'}
            <Text style={{ color: '#fff', fontWeight: '700' }}>{email}</Text>
            {'\n\n'}After verifying, your request will be reviewed by your company admin.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.btnText}>Return to Login</Text>
            <ArrowRight size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.bgBlob1} />
      <View style={styles.bgBlob2} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: Math.max(insets.top + 16, 70) }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <Animated.View style={[styles.header, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Start automating your IT support today</Text>
          </Animated.View>

          <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>

            {/* Company Picker */}
            <View style={styles.field}>
              <Text style={styles.label}>COMPANY</Text>
              <TouchableOpacity
                style={styles.inputRow}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCompanyModalOpen(true); }}
                activeOpacity={0.8}
              >
                <Building2 size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                <Text style={[styles.input, { color: selectedCompany ? '#fff' : 'rgba(255,255,255,0.3)', flex: 1 }]}>
                  {selectedCompany ? selectedCompany.name : 'Select your company...'}
                </Text>
                <ChevronDown size={18} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
            </View>

            {/* Full Name */}
            <View style={styles.field}>
              <Text style={styles.label}>FULL NAME</Text>
              <View style={styles.inputRow}>
                <User size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                <TextInput style={styles.input} placeholder="Enter your full name" placeholderTextColor="rgba(255,255,255,0.3)" value={fullName} onChangeText={setFullName} />
              </View>
            </View>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>EMAIL ADDRESS</Text>
              <View style={styles.inputRow}>
                <Mail size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                <TextInput style={styles.input} placeholder="Enter your work email" placeholderTextColor="rgba(255,255,255,0.3)" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              </View>
            </View>

            {/* Password */}
            <View style={styles.field}>
              <Text style={styles.label}>PASSWORD</Text>
              <View style={styles.inputRow}>
                <Lock size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                <TextInput style={styles.input} placeholder="Min 6 characters" placeholderTextColor="rgba(255,255,255,0.3)" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={18} color="rgba(255,255,255,0.4)" /> : <Eye size={18} color="rgba(255,255,255,0.4)" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.field}>
              <Text style={styles.label}>CONFIRM PASSWORD</Text>
              <View style={styles.inputRow}>
                <Lock size={18} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
                <TextInput style={styles.input} placeholder="Repeat password" placeholderTextColor="rgba(255,255,255,0.3)" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry={!showConfirmPassword} />
                <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                  {showConfirmPassword ? <EyeOff size={18} color="rgba(255,255,255,0.4)" /> : <Eye size={18} color="rgba(255,255,255,0.4)" />}
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit */}
            <TouchableOpacity style={styles.btn} onPress={handleSignup} disabled={loading} activeOpacity={0.85}>
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.btnText}>Submit Registration</Text>
                  <ArrowRight size={20} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.footerLink}>Log In</Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.footer, { opacity: fadeAnim, marginTop: 8 }]}>
            <Text style={styles.footerText}>Registering a company? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('AdminSignup')}>
              <Text style={styles.footerLink}>Admin Sign Up</Text>
            </TouchableOpacity>
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* Company Picker Modal */}
      <Modal visible={companyModalOpen} animationType="slide" transparent onRequestClose={() => setCompanyModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Company</Text>
              <TouchableOpacity onPress={() => setCompanyModalOpen(false)}>
                <X size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={styles.searchRow}>
              <Search size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Search companies..."
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={companySearch}
                onChangeText={setCompanySearch}
                autoFocus
              />
            </View>

            {loadingCompanies ? (
              <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
            ) : filteredCompanies.length === 0 ? (
              <View style={styles.emptyState}>
                <Building2 size={36} color="rgba(255,255,255,0.2)" />
                <Text style={styles.emptyText}>No companies found</Text>
                <Text style={styles.emptySubtext}>Ask your IT Admin to register your company first</Text>
              </View>
            ) : (
              <FlatList
                data={filteredCompanies}
                keyExtractor={item => item.id}
                renderItem={renderCompanyItem}
                showsVerticalScrollIndicator={false}
                style={{ marginTop: 8 }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  bgBlob1: { position: 'absolute', top: -120, right: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: COLORS.primary + '20' },
  bgBlob2: { position: 'absolute', bottom: -80, left: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: '#3b82f618' },
  scroll: { flexGrow: 1, padding: 28 },
  header: { marginBottom: 28 },
  title: { fontSize: 32, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 6 },
  card: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 28, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', gap: 16 },
  field: { gap: 8 },
  label: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.45)', letterSpacing: 1.2 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 16, paddingHorizontal: 14, height: 56, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  input: { flex: 1, fontSize: 15, color: '#fff' },
  btn: { backgroundColor: COLORS.primary, height: 64, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 4, ...SHADOWS.medium },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: 'rgba(255,255,255,0.45)', fontSize: 14 },
  footerLink: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
  // Success state
  successWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, gap: 20 },
  successIcon: { width: 100, height: 100, borderRadius: 30, backgroundColor: COLORS.primary + '20', justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.primary + '50' },
  successTitle: { fontSize: 26, fontWeight: '900', color: '#fff', textAlign: 'center' },
  successMsg: { fontSize: 15, color: 'rgba(255,255,255,0.55)', textAlign: 'center', lineHeight: 26 },
  // Company Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#141c2e', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '75%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 8 },
  companyItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 14 },
  companyItemSelected: { backgroundColor: COLORS.primary + '15' },
  companyIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)', justifyContent: 'center', alignItems: 'center' },
  companyName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff' },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 16, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  emptySubtext: { fontSize: 13, color: 'rgba(255,255,255,0.3)', textAlign: 'center', lineHeight: 20 },
});

export default SignupScreen;
