/**
 * Unit tests for the offline ticket queue utilities.
 *
 * Run with: cd MobileApp && npm test src/utils/__tests__/offlineQueue.test.js
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import {
  enqueueTicket,
  syncOfflineQueue,
  getQueueCount,
} from '../offlineQueue';

// Use the official in-memory mock shipped with AsyncStorage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock(
  '@react-native-community/netinfo',
  () => ({
    fetch: jest.fn(),
    addEventListener: jest.fn(() => jest.fn()),
  }),
  { virtual: true }
);

jest.mock(
  'expo-file-system/legacy',
  () => ({
    documentDirectory: 'file:///documents/',
    EncodingType: { Base64: 'base64' },
    readAsStringAsync: jest.fn(),
    deleteAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true }
);

jest.mock('base64-arraybuffer', () => ({ decode: jest.fn() }), { virtual: true });

const QUEUE_KEY = 'helpdesk_offline_ticket_queue';

function makeSupabase(insertImpl) {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
      }),
    },
    from: jest.fn(() => ({
      insert: insertImpl || jest.fn().mockResolvedValue({ error: null }),
    })),
    storage: { from: jest.fn() },
  };
}

function makeQueueItem(title) {
  return {
    id: 'offline_test_' + title,
    payload: { user_id: 'user-1', title },
    queuedAt: '2026-01-01T00:00:00.000Z',
    retries: 0,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  NetInfo.fetch.mockResolvedValue({ isConnected: false, isInternetReachable: false });
});

describe('offlineQueue', () => {
  test('enqueueTicket stores a new payload in AsyncStorage while offline', async () => {
    const supabase = makeSupabase();
    const payload = { user_id: 'user-1', title: 'Printer offline' };

    const result = await enqueueTicket(supabase, payload);

    expect(result).toEqual({ queued: true, submitted: false });
    const stored = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).toEqual(payload);
    expect(stored[0].retries).toBe(0);
  });

  test('syncOfflineQueue drops synced items and keeps failed ones for retry', async () => {
    await AsyncStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([makeQueueItem('will succeed'), makeQueueItem('will fail')])
    );
    const insert = jest.fn((row) =>
      Promise.resolve(row.title === 'will fail' ? { error: new Error('upload failed') } : { error: null })
    );
    const supabase = makeSupabase(insert);

    const result = await syncOfflineQueue(supabase);

    expect(result).toEqual({ synced: 1, failed: 1 });
    const remaining = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY));
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload.title).toBe('will fail');
    expect(remaining[0].retries).toBe(1);
  });

  test('concurrent enqueueTicket calls do not lose queued items', async () => {
    const supabase = makeSupabase();
    const titles = ['A', 'B', 'C'];

    await Promise.all(titles.map((title) => enqueueTicket(supabase, makeQueueItem(title).payload)));

    await expect(getQueueCount()).resolves.toBe(3);
    const stored = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY));
    expect(stored.map((item) => item.payload.title).sort()).toEqual(titles);
  });
});
