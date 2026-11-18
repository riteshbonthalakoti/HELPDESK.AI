import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { CheckCircle2, XCircle, AlertTriangle, Info, X, Zap, ShieldAlert } from 'lucide-react-native';

const NotificationContext = createContext(null);

// Premium dark glassmorphic theme
const TYPES = {
  success: {
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.4)',
    glow: '#10b981',
    text: '#d1fae5',
    subText: 'rgba(209, 250, 229, 0.7)',
    icon: CheckCircle2,
    iconColor: '#34d399',
    accentBar: '#10b981',
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.4)',
    glow: '#ef4444',
    text: '#fee2e2',
    subText: 'rgba(254, 226, 226, 0.7)',
    icon: XCircle,
    iconColor: '#f87171',
    accentBar: '#ef4444',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.4)',
    glow: '#f59e0b',
    text: '#fef3c7',
    subText: 'rgba(254, 243, 199, 0.7)',
    icon: AlertTriangle,
    iconColor: '#fbbf24',
    accentBar: '#f59e0b',
  },
  info: {
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.4)',
    glow: '#6366f1',
    text: '#e0e7ff',
    subText: 'rgba(224, 231, 255, 0.7)',
    icon: Zap,
    iconColor: '#818cf8',
    accentBar: '#6366f1',
  },
};

const Toast = ({ id, type = 'info', title, message, onDismiss }) => {
  const config = TYPES[type] || TYPES.info;
  const IconComponent = config.icon;
  const slideAnim = useRef(new Animated.Value(-140)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const glowAnim = useRef(new Animated.Value(0.6)).current;

  React.useEffect(() => {
    // Entrance
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, damping: 20, stiffness: 280, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, damping: 18, stiffness: 300, useNativeDriver: true }),
    ]).start();

    // Pulsing glow loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.6, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -140, duration: 260, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 0.88, damping: 20, useNativeDriver: true }),
    ]).start(() => onDismiss(id));
  }, [id, onDismiss]);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: 'rgba(11, 17, 32, 0.98)',
          borderColor: config.border,
          transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
          opacity: opacityAnim,
          // Glow shadow
          shadowColor: config.glow,
          shadowOpacity: glowAnim,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 16,
        },
      ]}
    >
      {/* Left accent bar */}
      <View style={[styles.accentBar, { backgroundColor: config.accentBar }]} />

      {/* Icon */}
      <Animated.View style={[styles.iconWrap, { backgroundColor: config.iconColor + '22', borderColor: config.iconColor + '40', opacity: glowAnim.interpolate({ inputRange: [0.6, 1], outputRange: [0.85, 1] }) }]}>
        <IconComponent size={18} color={config.iconColor} strokeWidth={2.5} />
      </Animated.View>

      {/* Content */}
      <View style={styles.toastContent}>
        {title ? <Text style={[styles.toastTitle, { color: config.text }]} numberOfLines={1}>{title}</Text> : null}
        {message ? <Text style={[styles.toastMessage, { color: config.subText }]} numberOfLines={2}>{message}</Text> : null}
      </View>

      {/* Dismiss */}
      <TouchableOpacity onPress={dismiss} style={styles.toastClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={styles.closeBtn}>
          <X size={13} color="rgba(255,255,255,0.5)" strokeWidth={2.5} />
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
};

export const NotificationProvider = ({ children, topInset = 50 }) => {
  const [toasts, setToasts] = useState([]);
  const timerRefs = useRef({});

  const dismiss = useCallback((id) => {
    clearTimeout(timerRefs.current[id]);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(({ type = 'info', title, message, duration = 4200 }) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev.slice(-2), { id, type, title, message }]);
    timerRefs.current[id] = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const success = useCallback((title, message, opts) => notify({ type: 'success', title, message, ...opts }), [notify]);
  const error   = useCallback((title, message, opts) => notify({ type: 'error',   title, message, ...opts }), [notify]);
  const warning = useCallback((title, message, opts) => notify({ type: 'warning', title, message, ...opts }), [notify]);
  const info    = useCallback((title, message, opts) => notify({ type: 'info',    title, message, ...opts }), [notify]);

  return (
    <NotificationContext.Provider value={{ notify, success, error, warning, info }}>
      {children}
      <View style={[styles.container, { top: topInset + 8 }]} pointerEvents="box-none">
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} onDismiss={dismiss} />
        ))}
      </View>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used inside NotificationProvider');
  return ctx;
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 10,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 13,
    paddingRight: 14,
    paddingLeft: 0,
    gap: 12,
    overflow: 'hidden',
    // glassmorphic dark base
    backgroundColor: 'rgba(11, 17, 32, 0.88)',
    backdropFilter: 'blur(20px)',
  },
  accentBar: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 4,
    marginLeft: 0,
    marginRight: 4,
    flexShrink: 0,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    flexShrink: 0,
  },
  toastContent: { flex: 1, gap: 2 },
  toastTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 0.1 },
  toastMessage: { fontSize: 12.5, fontWeight: '500', lineHeight: 17 },
  toastClose: { flexShrink: 0 },
  closeBtn: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
});
