/**
 * NotificationProvider.js
 * Toast notification system for MobileApp — replaces Alert.alert dialogs.
 *
 * Usage:
 *   1. Wrap your app root with <NotificationProvider>
 *   2. In any screen: const { success, error, info, warning } = useNotification();
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const NotificationContext = createContext(null);

const TOAST_DURATION = 3500;
const ANIMATION_DURATION = 300;

const TOAST_STYLES = {
  success: {
    backgroundColor: '#0f5132',
    borderColor: '#198754',
    icon: '✓',
    iconColor: '#75b798',
  },
  error: {
    backgroundColor: '#58151c',
    borderColor: '#dc3545',
    icon: '✕',
    iconColor: '#ea868f',
  },
  warning: {
    backgroundColor: '#664d03',
    borderColor: '#ffc107',
    icon: '⚠',
    iconColor: '#ffda6a',
  },
  info: {
    backgroundColor: '#055160',
    borderColor: '#0dcaf0',
    icon: 'ℹ',
    iconColor: '#6edff6',
  },
};

const ToastItem = ({ toast, onDismiss }) => {
  const style = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: ANIMATION_DURATION, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: ANIMATION_DURATION, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: ANIMATION_DURATION, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -20, duration: ANIMATION_DURATION, useNativeDriver: true }),
      ]).start(() => onDismiss(toast.id));
    }, TOAST_DURATION);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={[styles.toast, { backgroundColor: style.backgroundColor, borderColor: style.borderColor, opacity, transform: [{ translateY }] }]}>
      <View style={[styles.iconContainer, { borderColor: style.borderColor }]}>
        <Text style={[styles.icon, { color: style.iconColor }]}>{style.icon}</Text>
      </View>
      <View style={styles.textContainer}>
        {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
        {toast.message ? <Text style={styles.message}>{toast.message}</Text> : null}
      </View>
      <TouchableOpacity onPress={() => onDismiss(toast.id)} style={styles.closeBtn}>
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const NotificationProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((type, title, message) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-2), { id, type, title, message }]);
  }, []);

  const success = useCallback((title, message) => show('success', title, message), [show]);
  const error = useCallback((title, message) => show('error', title, message), [show]);
  const warning = useCallback((title, message) => show('warning', title, message), [show]);
  const info = useCallback((title, message) => show('info', title, message), [show]);

  return (
    <NotificationContext.Provider value={{ success, error, warning, info }}>
      {children}
      <View style={[styles.container, { top: insets.top + 10 }]} pointerEvents="box-none">
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </View>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within a NotificationProvider');
  return ctx;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
      android: { elevation: 8 },
    }),
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 14, fontWeight: '800' },
  textContainer: { flex: 1 },
  title: { fontSize: 13, fontWeight: '800', color: '#fff', marginBottom: 2 },
  message: { fontSize: 12, color: 'rgba(255,255,255,0.75)', lineHeight: 16 },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 18, color: 'rgba(255,255,255,0.6)', lineHeight: 18 },
});

export default NotificationProvider;
EOF