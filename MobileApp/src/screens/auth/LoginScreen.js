import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BrainCircuit, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, SHADOWS } from '../../styles/theme';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const cleanedEmail = email.trim().toLowerCase();
    if (!cleanedEmail || !password) {
      Alert.alert('Missing Details', 'Please enter your email and password.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: cleanedEmail,
        password,
      });
      if (error) throw error;
    } catch (err) {
      Alert.alert('Sign In Failed', err?.message || 'Unable to sign in. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <LinearGradient colors={['#064e3b', '#0a3d31', '#0f2e22']} style={styles.heroBanner}>
            <View style={styles.brandRow}>
              <View style={styles.logoBadge}>
                <BrainCircuit size={22} color="#34d399" />
              </View>
              <Text style={styles.brandTitle}>
                HELPDESK<Text style={styles.brandAccent}>.AI</Text>
              </Text>
            </View>
            <Text style={styles.heroTitle}>Welcome Back</Text>
            <Text style={styles.heroSubtitle}>
              RITESH PVT LTD · AI-Powered Support Operations
            </Text>
          </LinearGradient>

          <View style={styles.card}>
            <Text style={styles.label}>EMAIL ADDRESS</Text>
            <View style={styles.inputWrap}>
              <Mail size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="you@gmail.com"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <Text style={[styles.label, { marginTop: 16 }]}>PASSWORD</Text>
            <View style={styles.inputWrap}>
              <Lock size={18} color={COLORS.textMuted} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword((p) => !p)} hitSlop={8}>
                {showPassword ? (
                  <EyeOff size={18} color={COLORS.textMuted} />
                ) : (
                  <Eye size={18} color={COLORS.textMuted} />
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, loading && styles.disabledButton]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Text style={styles.primaryButtonText}>Sign In</Text>
                  <ArrowRight size={18} color="#ffffff" />
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkRow}
              onPress={() => navigation.navigate('Signup')}
            >
              <Text style={styles.linkMuted}>Don&apos;t have an account? </Text>
              <Text style={styles.linkAccent}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f6f8f7' },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 16, justifyContent: 'center' },
  heroBanner: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 16,
    backgroundColor: 'rgba(6,78,59,0.8)',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  logoBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(16,185,129,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: { fontSize: 18, fontWeight: '900', color: '#ffffff', letterSpacing: -0.4 },
  brandAccent: { color: '#10b981' },
  heroTitle: { fontSize: 28, fontWeight: '800', color: '#ffffff', marginBottom: 6 },
  heroSubtitle: { fontSize: 13, color: 'rgba(209,250,229,0.85)', fontWeight: '500' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    ...SHADOWS.soft,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textLight,
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  input: { flex: 1, fontSize: 15, color: COLORS.text },
  primaryButton: {
    marginTop: 22,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...SHADOWS.medium,
  },
  disabledButton: { opacity: 0.7 },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  linkRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  linkMuted: { fontSize: 14, color: COLORS.textLight },
  linkAccent: { fontSize: 14, color: COLORS.primary, fontWeight: '700' },
});
