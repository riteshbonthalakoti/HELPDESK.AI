/**
 * Backend auth bridge — mirrors Supabase auth to HttpOnly cookies (issue #130).
 * Enhanced with biometric session refresh token persistence in ExpoSecureStoreAdapter (issue #4109).
 */

import { supabase, ExpoSecureStoreAdapter } from './supabase';

export const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'https://ritesh19180-ai-helpdesk-api.hf.space';

export const REFRESH_TOKEN_KEY = 'helpdesk_session_refresh_token';
export const BIOMETRIC_CREDENTIALS_KEY = 'helpdesk_biometric_credentials';

export { ExpoSecureStoreAdapter };

const safeFetch = async (path, init = {}) => {
  try {
    return await fetch(`${BACKEND_URL}${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch (e) {
    console.warn(`[authBackend] ${path} failed:`, e?.message || e);
    return null;
  }
};

export const backendLogin = async (email, password) => {
  const resp = await safeFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return resp;
};

export const backendLogout = async () => {
  await clearStoredRefreshToken();
  return safeFetch('/auth/logout', { method: 'POST' });
};

/** Bearer fallback when native cookie jar is unavailable. */
export const getAuthHeaders = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Persist authenticated session refresh token in secure storage.
 */
export const storeRefreshToken = async (token) => {
  if (!token) return;
  try {
    await ExpoSecureStoreAdapter.setItem(REFRESH_TOKEN_KEY, token);
  } catch (e) {
    console.warn('[authBackend] storeRefreshToken error:', e?.message || e);
  }
};

/**
 * Retrieve session refresh token from secure storage.
 */
export const getStoredRefreshToken = async () => {
  try {
    return await ExpoSecureStoreAdapter.getItem(REFRESH_TOKEN_KEY);
  } catch (e) {
    console.warn('[authBackend] getStoredRefreshToken error:', e?.message || e);
    return null;
  }
};

/**
 * Clear refresh token and cached credentials on logout.
 */
export const clearStoredRefreshToken = async () => {
  try {
    await ExpoSecureStoreAdapter.removeItem(REFRESH_TOKEN_KEY);
    await ExpoSecureStoreAdapter.removeItem(BIOMETRIC_CREDENTIALS_KEY);
  } catch (e) {
    console.warn('[authBackend] clearStoredRefreshToken error:', e?.message || e);
  }
};

/**
 * Store credentials securely for biometric unlock.
 */
export const storeBiometricCredentials = async (email, password) => {
  if (!email || !password) return;
  try {
    const payload = JSON.stringify({ email, password });
    await ExpoSecureStoreAdapter.setItem(BIOMETRIC_CREDENTIALS_KEY, payload);
  } catch (e) {
    console.warn('[authBackend] storeBiometricCredentials error:', e?.message || e);
  }
};

/**
 * Retrieve stored credentials for biometric unlock.
 */
export const getStoredBiometricCredentials = async () => {
  try {
    const raw = await ExpoSecureStoreAdapter.getItem(BIOMETRIC_CREDENTIALS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[authBackend] getStoredBiometricCredentials error:', e?.message || e);
    return null;
  }
};
