// jest.setup.js
// Setup file for MobileApp Jest tests
global.__DEV__ = true;

// Placeholder Supabase config so modules that validate env at import time
// (e.g. src/lib/supabase.js) can load in tests. Real values from .env win.
process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';
process.env.EXPO_PUBLIC_BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'http://localhost:7860';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
