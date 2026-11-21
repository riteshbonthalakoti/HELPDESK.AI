import React, { useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { COLORS, SPACING, SHADOWS } from '../../styles/theme';
import { ArrowLeft, Sparkles, Send, Image as ImageIcon, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useNotification } from '../../components/NotificationProvider';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';

const CreateTicketScreen = () => {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null);
  const navigation = useNavigation();
  const { success, error: notifyError } = useNotification();

  const pickImage = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions?.Images || 'images',
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      notifyError('Empty Request', 'Please describe your issue first.');
      return;
    }
    
    setLoading(true);
    try {
      let base64 = null;
      if (image) {
        const response = await fetch(image);
        const blob = await response.blob();
        base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      }

      // Trigger success haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      navigation.navigate('AIProcessing', {
        text: description,
        image_base64: base64,
        image_text: "" 
      });
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
          <View style={styles.aiBanner}>
            <Sparkles size={20} color={COLORS.primary} />
            <Text style={styles.aiBannerText}>
              Describe your issue naturally. Our AI will analyze and route it to the right team.
            </Text>
          </View>

          <View style={styles.inputCard}>
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
              <TouchableOpacity style={styles.attachmentBtn} onPress={pickImage}>
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
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20, backgroundColor: COLORS.surfaceDark },
  title: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  scrollContent: { padding: 24 },
  aiBanner: {
    flexDirection: 'row',
    backgroundColor: COLORS.primaryLight,
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
    alignItems: 'center',
    gap: 12
  },
  aiBannerText: { flex: 1, color: COLORS.primaryDark, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  inputCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    marginBottom: 32,
    ...SHADOWS.soft,
    borderWidth: 1,
    borderColor: '#e5e7eb'
  },
  inputHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  charCount: { fontSize: 12, color: COLORS.textMuted },
  input: { 
    backgroundColor: '#ffffff', 
    borderRadius: 16, 
    padding: 16, 
    minHeight: 150, 
    fontSize: 16, 
    color: COLORS.text,
    lineHeight: 24
  },
  imagePreviewContainer: { marginTop: 16, position: 'relative', borderRadius: 16, overflow: 'hidden', height: 180, borderWidth: 1, borderColor: COLORS.border },
  imagePreview: { width: '100%', height: '100%' },
  removeImageBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.5)', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  actionRow: { flexDirection: 'row', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  attachmentBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attachmentText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  btn: { backgroundColor: COLORS.primary, height: 64, borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, ...SHADOWS.medium },
  btnDisabled: { backgroundColor: COLORS.textMuted, elevation: 0, shadowOpacity: 0 },
  btnText: { color: COLORS.white, fontSize: 17, fontWeight: '800' }
});

export default CreateTicketScreen;
