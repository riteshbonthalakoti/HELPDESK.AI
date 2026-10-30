/**
 * offlineQueue.js
 *
 * Caches ticket creation payloads in AsyncStorage when the device is offline,
 * then automatically syncs them to Supabase when connectivity is restored.
 *
 * Usage:
 *   import { enqueueTicket, syncOfflineQueue } from '../utils/offlineQueue';
 *
 *   // When creating a ticket (call regardless of connectivity):
 *   await enqueueTicket(supabase, payload);
 *
 *   // In network.js listener, call when connection is restored:
 *   await syncOfflineQueue(supabase);
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

const QUEUE_KEY = 'helpdesk_offline_ticket_queue';

let queueMutex = Promise.resolve();

/**
 * Serialize queue operations so concurrent enqueueTicket and syncOfflineQueue
 * calls never clobber each other's AsyncStorage reads and writes.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function withQueueLock(task) {
  const next = queueMutex.then(task, task);
  queueMutex = next.catch(() => {});
  return next;
}

/**
 * Load the current queue from AsyncStorage.
 * @returns {Promise<Array>}
 */
async function loadQueue() {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const queue = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(queue)) throw new Error('Stored offline queue is invalid');
  return queue;
}

/**
 * Persist the queue to AsyncStorage.
 * @param {Array} queue
 */
async function saveQueue(queue) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Attempt to submit a single ticket payload to Supabase.
 * @param {object} supabaseClient
 * @param {object} payload - The ticket row to insert.
 * @returns {Promise<boolean>} true on success, false on failure.
 */
async function submitTicket(supabaseClient, payload) {
  let bucket;
  let uploadedPath;
  try {
    const { data, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !payload.user_id || data?.session?.user?.id !== payload.user_id) return false;
    let row = payload;
    if (payload.image_uri && !/^https?:\/\//.test(payload.image_uri)) {
      // Only file references enter AsyncStorage; conversion happens during upload.
      const encoded = await FileSystem.readAsStringAsync(payload.image_uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      bucket = supabaseClient.storage.from('ticket-attachments');
      const path = payload.user_id + '/ticket_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.jpg';
      const { error: uploadError } = await bucket.upload(path, decode(encoded), {
        contentType: 'image/jpeg', upsert: false,
      });
      if (uploadError) return false;
      uploadedPath = path;
      const { data: urlData } = bucket.getPublicUrl(path);
      if (!urlData?.publicUrl) throw new Error('Attachment URL unavailable');
      row = { ...payload, image_uri: urlData.publicUrl };
    }
    const { error } = await supabaseClient.from('tickets').insert(row);
    if (error) throw error;
    return true;
  } catch {
    // A failed insert or upload cannot leave an orphan when a queue write fails too.
    if (uploadedPath) {
      try { await bucket.remove([uploadedPath]); } catch { /* best-effort remote cleanup */ }
    }
    return false;
  }
}

async function deleteSubmittedAttachment(payload) {
  const directory = FileSystem.documentDirectory && FileSystem.documentDirectory + 'ticket-attachments/';
  if (directory && payload.image_uri?.startsWith(directory)) {
    try { await FileSystem.deleteAsync(payload.image_uri, { idempotent: true }); } catch { /* retry cleanup later */ }
  }
}

/**
 * Enqueue a ticket payload.
 *
 * If the device is online, attempts immediate submission.
 * On failure or when offline, saves the payload to the local queue.
 *
 * @param {object} supabaseClient - Supabase client instance.
 * @param {object} payload        - Ticket data to create.
 * @returns {Promise<{ queued: boolean, submitted: boolean }>}
 */
export async function enqueueTicket(supabaseClient, payload) {
  const netState = await NetInfo.fetch();
  const isOnline = netState.isConnected && netState.isInternetReachable !== false;

  if (isOnline) {
    const ok = await submitTicket(supabaseClient, payload);
    if (ok) {
      await deleteSubmittedAttachment(payload);
      return { queued: false, submitted: true };
    }
  }

  // Offline or submission failed — serialize queue read-modify-write
  return withQueueLock(async () => {
    const queue = await loadQueue();
    queue.push({
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      payload,
      queuedAt: new Date().toISOString(),
      retries: 0,
    });
    await saveQueue(queue);
    return { queued: true, submitted: false };
  });
}

/**
 * Sync all queued offline tickets to Supabase.
 * Should be called whenever connectivity is restored.
 *
 * Successfully submitted items are removed from the queue.
 * Failed items remain and will be retried next time.
 *
 * @param {object} supabaseClient - Supabase client instance.
 * @returns {Promise<{ synced: number, failed: number }>}
 */
export async function syncOfflineQueue(supabaseClient) {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    if (queue.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    const remaining = [];
    const submittedPayloads = [];

    for (const item of queue) {
      const ok = await submitTicket(supabaseClient, item.payload);
      if (ok) {
        synced++;
        submittedPayloads.push(item.payload);
      } else {
        remaining.push({ ...item, retries: (item.retries || 0) + 1 });
      }
    }

    await saveQueue(remaining);
    await Promise.all(submittedPayloads.map(deleteSubmittedAttachment));
    return { synced, failed: remaining.length };
  });
}

/**
 * Return the number of tickets currently waiting in the offline queue.
 * Useful for showing a badge/banner to the user.
 *
 * @returns {Promise<number>}
 */
export async function getQueueCount() {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    return queue.length;
  });
}

/**
 * Clear the entire offline queue (e.g. on logout).
 */
export async function clearOfflineQueue() {
  return withQueueLock(async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
  });
}
