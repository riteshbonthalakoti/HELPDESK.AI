import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  Fingerprint,
  LogIn,
  AlertCircle,
} from 'lucide-react-native';
import { COLORS, SHADOWS } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import {
  backendLogin,
  storeRefreshToken,
  storeBiometricCredentials,
  getStoredBiometricCredentials,
} from '../../lib/authBackend';
import { authenticateUser, isBiometricAvailable } from '../../utils/biometrics';

const LoginScreen = () => {
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [hasStoredBiometrics, setHasStoredBiometrics] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    checkBiometricStatus();
  }, []);

  const checkBiometricStatus = async () => {
    try {
      const available = await isBiometricAvailable();
      setBiometricSupported(Boolean(available));

      const stored = await getStoredBiometricCredentials();
      if (stored?.email && stored?.password) {
        setHasStoredBiometrics(true);
        setEmail(stored.email);
      }
    } catch {
      setBiometricSupported(false);
    }
  };

  const handlePasswordLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setErrorMsg('');
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      // 1. Supabase Authentication
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        throw error;
      }

      // 2. Persist session tokens in secure store
      if (data?.session?.refresh_token) {
        await storeRefreshToken(data.session.refresh_token);
      }

      // 3. Cache credentials securely for biometric unlock if enabled
      if (biometricSupported) {
        await storeBiometricCredentials(email.trim(), password);
      }

      // 4. Backend cookie synchronization
      await backendLogin(email.trim(), password);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace('TicketsList');
    } catch (err) {
      setErrorMsg(err.message || 'Invalid credentials. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setLoading(false);
    }
  };

  const handleBiometricUnlock = useCallback(async () => {
    setErrorMsg('');
    setBiometricLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const authResult = await authenticateUser();

      if (!authResult.success) {
        if (authResult.error === 'cancelled' || authResult.error === 'user_fallback') {
          // Gracefully fallback to password login without scary error
          return;
        }
        if (authResult.error === 'lockout') {
          setErrorMsg('Biometric authentication is locked. Please log in with password.');
          return;
        }
        setErrorMsg('Biometric authentication failed. Please enter your password.');
        return;
      }

      // Biometric check succeeded: Retrieve stored credentials
      const creds = await getStoredBiometricCredentials();
      if (creds?.email && creds?.password) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: creds.email,
          password: creds.password,
        });

        if (error) throw error;

        if (data?.session?.refresh_token) {
          await storeRefreshToken(data.session.refresh_token);
        }

        await backendLogin(creds.email, creds.password);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.replace('TicketsList');
      } else {
        setErrorMsg('No stored credentials found. Please sign in with password first to enable biometric login.');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Biometric login failed. Fallback to password.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setBiometricLoading(false);
    }
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={['#0b1120', '#020617']} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.logoRow}>
                <Image
                  source={require('../../../assets/logo_v1.png')}
                  style={styles.logo}
                  resizeMode="contain"
                />
                <Text style={styles.brandTitle}>
                  HELPDESK<Text style={{ color: COLORS.primary }}>.AI</Text>
                </Text>
              </View>
              <Text style={styles.subtitle}>Sign in to your enterprise support dashboard</Text>
            </View>

            {/* Error Banner */}
            {Boolean(errorMsg) && (
              <View style={styles.errorBanner}>
                <AlertCircle size={18} color="#ef4444" style={{ marginRight: 8 }} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            {/* Form Card */}
            <View style={styles.card}>
              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>WORK EMAIL</Text>
                <View style={styles.inputContainer}>
                  <Mail size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="name@company.com"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>PASSWORD</Text>
                <View style={styles.inputContainer}>
                  <Lock size={18} color="rgba(255,255,255,0.4)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••••••"
                    placeholderTextColor="rgba(255,255,255,0.3)"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                  >
                    {showPassword ? (
                      <EyeOff size={18} color="rgba(255,255,255,0.5)" />
                    ) : (
                      <Eye size={18} color="rgba(255,255,255,0.5)" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {/* Standard Password Login Button */}
              <TouchableOpacity
                style={[styles.primaryBtn, loading && styles.btnDisabled]}
                onPress={handlePasswordLogin}
                disabled={loading || biometricLoading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <LogIn size={20} color="#fff" />
                    <Text style={styles.btnText}>Sign In</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Biometrics Unlock Option */}
              {biometricSupported && (
                <View style={styles.biometricSection}>
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>OR</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.biometricBtn,
                      biometricLoading && styles.btnDisabled,
                    ]}
                    onPress={handleBiometricUnlock}
                    disabled={loading || biometricLoading}
                  >
                    {biometricLoading ? (
                      <ActivityIndicator color={COLORS.primary} />
                    ) : (
                      <>
                        <Fingerprint size={22} color={COLORS.primary} />
                        <Text style={styles.biometricBtnText}>
                          {hasStoredBiometrics
                            ? 'Unlock with Biometrics'
                            : 'Set Up Biometric Quick-Unlock'}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Footer Navigation */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an enterprise account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
                <Text style={styles.footerLink}>Register</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b1120' },
  safeArea: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  header: { marginBottom: 28, alignItems: 'center' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logo: { width: 36, height: 36 },
  brandTitle: { fontSize: 26, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
  },
  errorText: { color: '#fca5a5', fontSize: 13, flex: 1 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 16,
    ...SHADOWS.medium,
  },
  inputGroup: { gap: 6 },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.45)',
    letterSpacing: 1,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: '#fff', fontSize: 15 },
  eyeBtn: { padding: 6 },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    height: 54,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
    ...SHADOWS.small,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  biometricSection: { marginTop: 4, gap: 14 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  dividerText: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1,
  },
  biometricBtn: {
    height: 52,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  biometricBtnText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  footerText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  footerLink: { color: COLORS.primary, fontSize: 14, fontWeight: '800' },
});

export default LoginScreen;
