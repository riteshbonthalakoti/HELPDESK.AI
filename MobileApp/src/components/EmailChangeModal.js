import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Mail, CheckCircle2, AlertCircle, X, ArrowRight, RefreshCw, KeyRound } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../lib/supabase';
import { BACKEND_URL, getAuthHeaders } from '../lib/authBackend';
import { COLORS, SHADOWS } from '../styles/theme';
import {
  validateEmailInput,
  validateOtpCode,
  requestEmailChangeOtp,
  verifyEmailChangeOtp,
} from '../lib/emailChangeOperations';

export {
  validateEmailInput,
  validateOtpCode,
  requestEmailChangeOtp,
  verifyEmailChangeOtp,
};

export default function EmailChangeModal({ visible, onClose, currentEmail, onSuccess }) {
  const [step, setStep] = useState('request'); // 'request' | 'otp' | 'done'
  const [newEmail, setNewEmail] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [challengeToken, setChallengeToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [error, setError] = useState('');

  const inputRefs = useRef([]);
  const interactionRef = useRef(0);

  useEffect(() => {
    interactionRef.current += 1;
    if (visible) {
      setStep('request');
      setNewEmail('');
      setOtpDigits(['', '', '', '', '', '']);
      setChallengeToken(null);
      setError('');
      setResendCooldown(0);
    }
  }, [visible]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleClose = () => {
    if (loading) return; // Prevent dismissal while request or verification is loading
    interactionRef.current += 1;
    onClose();
  };

  const handleRequestOtp = async () => {
    setError('');
    const validation = validateEmailInput(newEmail, currentEmail);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    const currentInteraction = interactionRef.current;
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const data = await requestEmailChangeOtp({
        newEmail: validation.email,
      });

      if (interactionRef.current !== currentInteraction) return;

      setChallengeToken(data?.challenge_token || null);
      setNewEmail(validation.email);
      setOtpDigits(['', '', '', '', '', '']);
      setResendCooldown(30);
      setStep('otp');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 300);
    } catch (err) {
      if (interactionRef.current !== currentInteraction) return;
      setError(err?.message || 'An error occurred while sending verification code.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      if (interactionRef.current === currentInteraction) {
        setLoading(false);
      }
    }
  };

  const handleDigitChange = (index, rawValue) => {
    const cleaned = rawValue.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...otpDigits];
      next[index] = '';
      setOtpDigits(next);
      return;
    }

    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      chars.forEach((ch, idx) => {
        next[idx] = ch;
      });
      setOtpDigits(next);
      const nextFocus = Math.min(chars.length, 5);
      inputRefs.current[nextFocus]?.focus();
      return;
    }

    const next = [...otpDigits];
    next[index] = cleaned;
    setOtpDigits(next);
    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyPress = (index, key) => {
    if (key === 'Backspace' && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async () => {
    setError('');
    const validation = validateOtpCode(otpDigits);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    const currentInteraction = interactionRef.current;
    setLoading(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await verifyEmailChangeOtp({
        otpCode: validation.code,
        newEmail,
        challengeToken,
      });

      if (interactionRef.current !== currentInteraction) return;

      setStep('done');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (onSuccess) onSuccess(newEmail);
    } catch (err) {
      if (interactionRef.current !== currentInteraction) return;
      setError(err?.message || 'Verification failed. Please try again.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      if (interactionRef.current === currentInteraction) {
        setLoading(false);
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableOpacity style={styles.scrim} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          {/* Header Accent Bar */}
          <View style={styles.topAccentBar} />

          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconWrap}>
                <Mail size={20} color={COLORS.primary} />
              </View>
              <View>
                <Text style={styles.modalTitle}>Change Account Email</Text>
                <Text style={styles.modalSubtitle}>Direct 6-digit OTP verification</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn} hitSlop={8} disabled={loading}>
              <X size={18} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Step Indicator */}
          {step !== 'done' && (
            <View style={styles.stepIndicatorRow}>
              <View style={[styles.stepPill, step === 'request' && styles.stepPillActive]}>
                <Text style={[styles.stepNum, step === 'request' && styles.stepNumActive]}>1</Text>
                <Text style={[styles.stepText, step === 'request' && styles.stepTextActive]}>New Email</Text>
              </View>
              <ArrowRight size={14} color="#94a3b8" />
              <View style={[styles.stepPill, step === 'otp' && styles.stepPillActive]}>
                <Text style={[styles.stepNum, step === 'otp' && styles.stepNumActive]}>2</Text>
                <Text style={[styles.stepText, step === 'otp' && styles.stepTextActive]}>Verify OTP</Text>
              </View>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {error ? (
              <View style={styles.errorBox}>
                <AlertCircle size={16} color="#ef4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* STEP 1: Request OTP */}
            {step === 'request' && (
              <View style={styles.stepContainer}>
                <Text style={styles.inputLabel}>CURRENT REGISTERED EMAIL</Text>
                <View style={styles.readOnlyEmailWrap}>
                  <Text style={styles.readOnlyEmailText}>{currentEmail || 'Not configured'}</Text>
                </View>

                <Text style={[styles.inputLabel, { marginTop: 16 }]}>NEW WORK / GMAIL ADDRESS</Text>
                <View style={styles.inputWrap}>
                  <Mail size={18} color={COLORS.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. employee@riteshpvtltd.com"
                    placeholderTextColor={COLORS.textMuted}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={newEmail}
                    onChangeText={setNewEmail}
                    editable={!loading}
                  />
                </View>
                <Text style={styles.hintText}>
                  A 6-digit numeric OTP code will be sent exclusively to this new email. No link will be sent to the old email.
                </Text>

                <TouchableOpacity
                  style={[styles.primaryBtn, loading && styles.disabledBtn]}
                  onPress={handleRequestOtp}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.primaryBtnText}>Send 6-Digit OTP</Text>
                      <ArrowRight size={16} color="#fff" />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* STEP 2: Verify OTP */}
            {step === 'otp' && (
              <View style={styles.stepContainer}>
                <View style={styles.otpNoticeBox}>
                  <KeyRound size={20} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.otpNoticeTitle}>Check your inbox</Text>
                    <Text style={styles.otpNoticeText}>
                      We sent a 6-digit OTP code to <Text style={styles.boldText}>{newEmail}</Text>. Code expires in 10 minutes.
                    </Text>
                  </View>
                </View>

                <Text style={[styles.inputLabel, { marginTop: 16, textAlign: 'center' }]}>
                  ENTER 6-DIGIT CODE
                </Text>

                {/* 6 Digit Input Boxes */}
                <View style={styles.digitsRow}>
                  {otpDigits.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={(el) => (inputRefs.current[index] = el)}
                      style={[styles.digitInput, digit ? styles.digitInputFilled : null]}
                      keyboardType="number-pad"
                      maxLength={1}
                      value={digit}
                      onChangeText={(val) => handleDigitChange(index, val)}
                      onKeyPress={({ nativeEvent }) => handleDigitKeyPress(index, nativeEvent.key)}
                      editable={!loading}
                    />
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.primaryBtn, (loading || otpDigits.join('').length !== 6) && styles.disabledBtn]}
                  onPress={handleVerifyOtp}
                  disabled={loading || otpDigits.join('').length !== 6}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={styles.primaryBtnText}>Verify &amp; Update Email</Text>
                      <CheckCircle2 size={16} color="#fff" />
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.resendRow}>
                  <TouchableOpacity
                    onPress={handleRequestOtp}
                    disabled={resendCooldown > 0 || loading}
                    style={styles.resendBtn}
                  >
                    <RefreshCw size={14} color={resendCooldown > 0 ? COLORS.textMuted : COLORS.primary} />
                    <Text
                      style={[
                        styles.resendText,
                        resendCooldown > 0 && { color: COLORS.textMuted },
                      ]}
                    >
                      {resendCooldown > 0 ? `Resend Code in ${resendCooldown}s` : 'Resend Code'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setStep('request')}
                    style={styles.changeEmailLink}
                    disabled={loading}
                  >
                    <Text style={styles.changeEmailText}>Edit email</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* STEP 3: Done */}
            {step === 'done' && (
              <View style={styles.doneContainer}>
                <View style={styles.doneIconWrap}>
                  <CheckCircle2 size={44} color="#16a34a" />
                </View>
                <Text style={styles.doneTitle}>Email Successfully Changed!</Text>
                <Text style={styles.doneDesc}>
                  Your account has been switched to <Text style={styles.boldText}>{newEmail}</Text>. Use this email for all future sign-ins.
                </Text>

                <TouchableOpacity style={styles.primaryBtn} onPress={onClose}>
                  <Text style={styles.primaryBtnText}>Close</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  scrim: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    overflow: 'hidden',
    ...SHADOWS.card,
  },
  topAccentBar: {
    height: 4,
    backgroundColor: COLORS.primary,
    width: '100%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  modalSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
    backgroundColor: '#fafbfc',
  },
  stepPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 100,
    backgroundColor: '#f1f5f9',
  },
  stepPillActive: {
    backgroundColor: COLORS.primaryLight,
  },
  stepNum: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#94a3b8',
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 18,
  },
  stepNumActive: {
    backgroundColor: COLORS.primary,
  },
  stepText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  stepTextActive: {
    color: COLORS.primary,
  },
  bodyContent: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 32,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
    flex: 1,
  },
  stepContainer: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  readOnlyEmailWrap: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  readOnlyEmailText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
  },
  hintText: {
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 16,
    marginTop: 6,
    marginBottom: 16,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    height: 50,
    borderRadius: 14,
    marginTop: 8,
    ...SHADOWS.soft,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  disabledBtn: {
    opacity: 0.6,
  },
  otpNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  otpNoticeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#15803d',
  },
  otpNoticeText: {
    fontSize: 12,
    color: '#166534',
    lineHeight: 16,
    marginTop: 2,
  },
  boldText: {
    fontWeight: '800',
  },
  digitsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 16,
  },
  digitInput: {
    flex: 1,
    height: 52,
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.text,
  },
  digitInputFilled: {
    borderColor: COLORS.primary,
    backgroundColor: '#ffffff',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    paddingHorizontal: 4,
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
  },
  resendText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  changeEmailLink: {
    padding: 6,
  },
  changeEmailText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
    textDecorationLine: 'underline',
  },
  doneContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },
  doneIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#dcfce7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  doneTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
    textAlign: 'center',
  },
  doneDesc: {
    fontSize: 13,
    color: COLORS.textLight,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
});
