import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, SHADOWS } from '../../styles/theme';
import { ArrowLeft, Sparkles, Send, Image as ImageIcon, X, CloudOff, RefreshCw, RotateCcw } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useNotification } from '../../components/NotificationProvider';
import { enqueueTicket, syncOfflineQueue, getQueueCount } from '../../utils/offlineQueue';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';

export const DRAFT_STORAGE_KEY = 'helpdesk_ticket_draft';
const CATEGORIES = ['General', 'Network', 'Software', 'Hardware', 'Access'];

const clearDraftStorageSafely = async () => {
  try {
    await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors after a confirmed submission
  }
};

const persistDraftSnapshotSafely = async ({ subject, description, category, image }) => {
  const hasContent = Boolean(subject.trim() || description.trim() || image);
  if (!hasContent) {
    await clearDraftStorageSafely();
    return;
  }
  const draftPayload = {
    subject,
    description,
    category,
    image,
    imageUris: image ? [image] : [],
    updatedAt: new Date().toISOString(),
  };
  try {
    await AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftPayload));
  } catch {
    // Ignore storage write error
  }
};

/**
 * Convert or upload a picked attachment URI into a durable reference that
 * survives temporary picker file cleanup while queued offline.
 */
const resolveDurableAttachment = async (uri) => {
  if (!uri) return null;
  if (/^https?:\/\//.test(uri)) return uri;
  if (!FileSystem.documentDirectory) throw new Error('Attachment storage unavailable');
  const directory = FileSystem.documentDirectory + 'ticket-attachments/';
  if (uri.startsWith(directory)) return uri;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const target = directory + 'ticket_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.jpg';
  await FileSystem.copyAsync({ from: uri, to: target });
  return target;
};

const CreateTicketScreen = () => {
  const [subject, setSubjectState] = useState('');
  const [description, setDescriptionState] = useState('');
  const [category, setCategoryState] = useState('General');
  const [loading, setLoading] = useState(false);
  const [image, setImageState] = useState(null);
  const [savedDraft, setSavedDraft] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const latestFormRef = useRef({
    subject: '',
    description: '',
    category: 'General',
    image: null,
  });

  const setSubject = useCallback((val) => {
    latestFormRef.current = { ...latestFormRef.current, subject: val };
    setSubjectState(val);
  }, []);

  const setDescription = useCallback((val) => {
    latestFormRef.current = { ...latestFormRef.current, description: val };
    setDescriptionState(val);
  }, []);

  const setCategory = useCallback((val) => {
    latestFormRef.current = { ...latestFormRef.current, category: val };
    setCategoryState(val);
  }, []);

  const setImage = useCallback((val) => {
    latestFormRef.current = { ...latestFormRef.current, image: val };
    setImageState(val);
  }, []);

  const navigation = useNavigation();
  const { success, error: notifyError } = useNotification();

  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setQueueCount(count);
    } catch {
      // A badge refresh cannot invalidate a confirmed submission.
    }
  }, []);

  // Load saved draft and initial queue state on mount
  useEffect(() => {
    let mounted = true;
    const loadInitialState = async () => {
      try {
        const rawDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
        if (rawDraft && mounted) {
          const parsed = JSON.parse(rawDraft);
          if (
            parsed &&
            (parsed.subject?.trim() ||
              parsed.description?.trim() ||
              parsed.image ||
              (Array.isArray(parsed.imageUris) && parsed.imageUris.length > 0))
          ) {
            setSavedDraft(parsed);
          }
        }
      } catch {
        // Ignore corrupted draft
      } finally {
        if (mounted) setDraftLoaded(true);
      }

      await refreshQueueCount();
    };

    loadInitialState();

    const unsubscribeNet = NetInfo.addEventListener(async (state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      if (mounted) setIsOffline(!online);
      if (online) {
        try {
          setSyncingQueue(true);
          const { synced } = await syncOfflineQueue(supabase);
          if (synced > 0 && mounted) {
            success?.('Offline Queue Synced', `${synced} queued ticket(s) submitted.`);
          }
          await refreshQueueCount();
        } catch {
          // Ignore sync error
        } finally {
          if (mounted) setSyncingQueue(false);
        }
      }
    });

    return () => {
      mounted = false;
      if (typeof unsubscribeNet === 'function') {
        unsubscribeNet();
      }
    };
  }, [refreshQueueCount, success]);

  // Persist form inputs to AsyncStorage on change
  useEffect(() => {
    if (!draftLoaded || savedDraft) return;
    persistDraftSnapshotSafely({ subject, description, category, image });
  }, [subject, description, category, image, draftLoaded, savedDraft]);

  const handleRestoreDraft = () => {
    if (!savedDraft) return;
    setSubject(savedDraft.subject || '');
    setDescription(savedDraft.description || '');
    setCategory(savedDraft.category || 'General');
    const restoredImage =
      savedDraft.image ||
      (Array.isArray(savedDraft.imageUris) && savedDraft.imageUris.length > 0
        ? savedDraft.imageUris[0]
        : null);
    setImage(restoredImage);
    setSavedDraft(null);
  };

  const handleDiscardDraft = async () => {
    setSavedDraft(null);
    const current = latestFormRef.current;
    const hasCurrentEdits = Boolean(
      current.subject.trim() || current.description.trim() || current.image
    );
    if (hasCurrentEdits) {
      await persistDraftSnapshotSafely(current);
    } else {
      await clearDraftStorageSafely();
    }
  };

  const handleManualQueueSync = async () => {
    setSyncingQueue(true);
    try {
      const { synced } = await syncOfflineQueue(supabase);
      await refreshQueueCount();
      if (synced > 0) {
        success?.('Offline Queue Synced', `${synced} queued ticket(s) submitted.`);
      }
    } catch (error) {
      notifyError('Offline Queue Error', error.message);
    } finally {
      setSyncingQueue(false);
    }
  };

  const pickImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'images',
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      try {
        setImage(await resolveDurableAttachment(result.assets[0].uri));
      } catch (error) {
        notifyError('Attachment Error', error.message);
      }
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      notifyError('Empty Request', 'Please describe your issue first.');
      return;
    }

    const submittedSnapshot = {
      subject,
      description,
      category,
      image,
    };

    setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData?.session?.user?.id) {
        throw new Error('Please sign in before submitting a ticket.');
      }
      const durableUri = await resolveDurableAttachment(submittedSnapshot.image);

      const ticketPayload = {
        user_id: sessionData.session.user.id,
        subject:
          submittedSnapshot.subject.trim() || submittedSnapshot.description.trim().slice(0, 80),
        description: submittedSnapshot.description.trim(),
        category: submittedSnapshot.category,
        image_uri: durableUri,
      };

      const { submitted, queued } = await enqueueTicket(supabase, ticketPayload);
      await refreshQueueCount();

      const current = latestFormRef.current;
      const formUnchanged =
        current.subject === submittedSnapshot.subject &&
        current.description === submittedSnapshot.description &&
        current.category === submittedSnapshot.category &&
        current.image === submittedSnapshot.image;

      if (submitted) {
        if (formUnchanged) {
          await clearDraftStorageSafely();
          setSubject('');
          setDescription('');
          setImage(null);
        } else {
          await persistDraftSnapshotSafely(current);
        }
        setSavedDraft(null);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        navigation.navigate('AIProcessing', {
          subject: ticketPayload.subject,
          category: submittedSnapshot.category,
          text: submittedSnapshot.description,
          image_base64: null,
          image_text: '',
        });
      } else if (queued) {
        setSavedDraft(null);
        if (formUnchanged) {
          await clearDraftStorageSafely();
          setSubject('');
          setDescription('');
          setImage(null);
        } else {
          await persistDraftSnapshotSafely(current);
        }
        success?.(
          'Saved to Offline Queue',
          'You are offline. Your ticket has been queued and will sync automatically when online.'
        );
      }
    } catch (e) {
      notifyError('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <ArrowLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.title}>New Request</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {(isOffline || queueCount > 0) && (
            <View style={styles.offlineQueueBanner} testID="offline-queue-indicator">
              <CloudOff size={18} color={COLORS.primaryDark || COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.offlineQueueTitle}>
                  {isOffline ? 'Offline Mode Active' : 'Offline Queue Pending'}
                </Text>
                <Text style={styles.offlineQueueSubtitle}>
                  {queueCount > 0
                    ? `${queueCount} queued ticket(s) waiting to sync`
                    : 'Drafts are saved locally and queued until connection returns'}
                </Text>
              </View>
              {queueCount > 0 && !isOffline && (
                <TouchableOpacity
                  onPress={handleManualQueueSync}
                  disabled={syncingQueue}
                  style={styles.syncNowBtn}
                  testID="sync-queue-button"
                >
                  <RefreshCw size={14} color={COLORS.white} />
                  <Text style={styles.syncNowText}>{syncingQueue ? 'Syncing...' : 'Sync'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {savedDraft && (
            <View style={styles.draftBanner} testID="restore-draft-banner">
              <RotateCcw size={18} color={COLORS.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.draftBannerTitle}>Saved Draft Found</Text>
                <Text style={styles.draftBannerText}>
                  Would you like to restore your unsent ticket draft?
                </Text>
              </View>
              <View style={styles.draftActions}>
                <TouchableOpacity
                  onPress={handleRestoreDraft}
                  style={styles.restoreBtn}
                  testID="restore-draft-button"
                >
                  <Text style={styles.restoreBtnText}>Restore</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleDiscardDraft}
                  style={styles.discardBtn}
                  testID="discard-draft-button"
                >
                  <Text style={styles.discardBtnText}>Discard</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.aiBanner}>
            <Sparkles size={20} color={COLORS.primary} />
            <Text style={styles.aiBannerText}>
              Describe your issue naturally. Our AI will analyze and route it to the right team.
            </Text>
          </View>

          <View style={styles.inputCard}>
            <Text style={styles.inputLabel}>Subject</Text>
            <TextInput
              style={styles.subjectInput}
              placeholder="Brief summary of the issue..."
              placeholderTextColor={COLORS.textMuted}
              value={subject}
              onChangeText={setSubject}
              editable={!loading}
            />

            <Text style={[styles.inputLabel, { marginTop: 12, marginBottom: 8 }]}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                  onPress={() => setCategory(cat)}
                  disabled={loading}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === cat && styles.categoryChipTextActive,
                    ]}
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>Issue Details</Text>
              <Text style={styles.charCount}>{description.length}/1000</Text>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Describe what's wrong in detail..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              value={description}
              onChangeText={setDescription}
              numberOfLines={8}
              textAlignVertical="top"
              editable={!loading}
            />

            {image && (
              <View style={styles.imagePreviewContainer}>
                <Image source={{ uri: image }} style={styles.imagePreview} />
                <TouchableOpacity onPress={() => setImage(null)} style={styles.removeImageBtn}>
                  <X size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.attachmentBtn} onPress={pickImage} disabled={loading}>
                <ImageIcon size={20} color={COLORS.primary} />
                <Text style={styles.attachmentText}>{image ? 'Change Screenshot' : 'Attach Screenshot'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.btn, !description.trim() && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading || !description.trim()}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.white} />
            ) : (
              <>
                <Text style={styles.btnText}>Analyze & Submit</Text>
                <Send size={18} color={COLORS.white} />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: COLORS.white,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: COLORS.surfaceDark,
  },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  scrollContent: { padding: 24 },
  offlineQueueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  offlineQueueTitle: { fontSize: 13, fontWeight: '700', color: '#92400E' },
  offlineQueueSubtitle: { fontSize: 12, color: '#B45309', marginTop: 2 },
  syncNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  syncNowText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  draftBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryLight,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  draftBannerTitle: { fontSize: 13, fontWeight: '700', color: COLORS.primaryDark },
  draftBannerText: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  draftActions: { flexDirection: 'row', gap: 8 },
  restoreBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  restoreBtnText: { color: COLORS.white, fontSize: 12, fontWeight: '700' },
  discardBtn: {
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  discardBtnText: { color: COLORS.textMuted, fontSize: 12, fontWeight: '600' },
  aiBanner: {
    flexDirection: 'row',
    backgroundColor: COLORS.primaryLight,
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    alignItems: 'center',
    gap: 12,
  },
  aiBannerText: { flex: 1, color: COLORS.primaryDark, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  inputCard: {
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: 20,
    marginBottom: 32,
    ...SHADOWS.soft,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  subjectInput: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.text,
    marginTop: 8,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: COLORS.background,
  },
  categoryChipActive: { backgroundColor: COLORS.primary },
  categoryChipText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  categoryChipTextActive: { color: COLORS.white },
  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  inputLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  charCount: { fontSize: 12, color: COLORS.textMuted },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 16,
    padding: 16,
    minHeight: 150,
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 24,
  },
  imagePreviewContainer: {
    marginTop: 16,
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
    height: 180,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  imagePreview: { width: '100%', height: '100%' },
  removeImageBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  attachmentBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  btn: {
    backgroundColor: COLORS.primary,
    height: 64,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    ...SHADOWS.medium,
  },
  btnDisabled: { backgroundColor: COLORS.textMuted, elevation: 0, shadowOpacity: 0 },
  btnText: { color: COLORS.white, fontSize: 17, fontWeight: '800' },
});

export default CreateTicketScreen;
