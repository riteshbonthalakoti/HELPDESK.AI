process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon-key';
process.env.EXPO_PUBLIC_BACKEND_URL = 'http://localhost:7860';

jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
