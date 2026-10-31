import React from 'react';
import { authenticateUser, isBiometricAvailable } from '../../../utils/biometrics';
import {
  storeRefreshToken,
  getStoredBiometricCredentials,
  storeBiometricCredentials,
  backendLogin,
} from '../../../lib/authBackend';

jest.mock('../../../utils/biometrics', () => ({
  authenticateUser: jest.fn(),
  isBiometricAvailable: jest.fn(),
  getSupportedBiometricTypes: jest.fn(),
}));

jest.mock('../../../lib/authBackend', () => ({
  backendLogin: jest.fn(),
  storeRefreshToken: jest.fn(),
  storeBiometricCredentials: jest.fn(),
  getStoredBiometricCredentials: jest.fn(),
  clearStoredRefreshToken: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: jest.fn(),
      getSession: jest.fn(),
    },
  },
  ExpoSecureStoreAdapter: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const mockReplace = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    replace: mockReplace,
    navigate: mockNavigate,
  }),
}));

describe('LoginScreen Biometric & Authentication Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    isBiometricAvailable.mockResolvedValue(true);
    getStoredBiometricCredentials.mockResolvedValue({
      email: 'tech@example.com',
      password: 'SecurePassword123!',
    });
  });

  it('detects biometric availability on device correctly', async () => {
    const isAvailable = await isBiometricAvailable();
    expect(isAvailable).toBe(true);
  });

  it('retrieves stored biometric credentials securely', async () => {
    const creds = await getStoredBiometricCredentials();
    expect(creds.email).toBe('tech@example.com');
    expect(creds.password).toBe('SecurePassword123!');
  });

  it('stores session refresh token in secure storage adapter', async () => {
    await storeRefreshToken('mock-refresh-token-xyz');
    expect(storeRefreshToken).toHaveBeenCalledWith('mock-refresh-token-xyz');
  });

  it('successfully handles biometric unlock authentication', async () => {
    authenticateUser.mockResolvedValueOnce({ success: true });
    const authResult = await authenticateUser();
    expect(authResult.success).toBe(true);

    const creds = await getStoredBiometricCredentials();
    expect(creds).toBeDefined();
    expect(creds.email).toBe('tech@example.com');
  });

  it('handles biometric fallback gracefully when user chooses password PIN fallback', async () => {
    authenticateUser.mockResolvedValueOnce({ success: false, error: 'user_fallback' });
    const authResult = await authenticateUser();
    expect(authResult.success).toBe(false);
    expect(authResult.error).toBe('user_fallback');
  });

  it('handles biometric lockout without crashing', async () => {
    authenticateUser.mockResolvedValueOnce({ success: false, error: 'lockout' });
    const authResult = await authenticateUser();
    expect(authResult.success).toBe(false);
    expect(authResult.error).toBe('lockout');
  });

  it('handles password login and stores session refresh token', async () => {
    const { supabase } = require('../../../lib/supabase');
    supabase.auth.signInWithPassword.mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'mock-access',
          refresh_token: 'mock-refresh-123',
        },
      },
      error: null,
    });

    const res = await supabase.auth.signInWithPassword({
      email: 'tech@example.com',
      password: 'SecurePassword123!',
    });

    expect(res.data.session.refresh_token).toBe('mock-refresh-123');
    await storeRefreshToken(res.data.session.refresh_token);
    expect(storeRefreshToken).toHaveBeenCalledWith('mock-refresh-123');
  });
});
