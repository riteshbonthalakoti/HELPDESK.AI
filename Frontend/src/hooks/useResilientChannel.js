import { useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../lib/supabaseClient';
import { CHANNEL_STATUS, createResilientChannel } from '../realtime/resilientChannel';

/**
 * React binding for `createResilientChannel`.
 *
 * Opens a resilient Supabase Realtime channel for the lifetime of the
 * component and exposes its connection status, presence and send helpers.
 * Reconnection timing, queueing and heartbeats are handled by the underlying
 * channel wrapper.
 *
 * @param {string} name - Realtime channel name (e.g. `support-chat:<ticketId>`).
 * @param {object} [options]
 * @param {object} [options.config] - Backoff/heartbeat/queue configuration.
 * @param {Array<{filter: object, handler: Function}>} [options.postgresChanges]
 * @param {Array<{event: string, handler: Function}>} [options.broadcasts]
 * @param {boolean} [options.enabled=true]
 */
export default function useResilientChannel(name, options = {}) {
  const { config, postgresChanges, broadcasts, enabled = true } = options;
  const [status, setStatus] = useState(CHANNEL_STATUS.IDLE);
  const channelRef = useRef(null);
  const optionsRef = useRef({ config, postgresChanges, broadcasts });

  optionsRef.current = { config, postgresChanges, broadcasts };

  useEffect(() => {
    if (!enabled || !name) return undefined;

    const { config: channelConfig, postgresChanges: pg = [], broadcasts: bc = [] } =
      optionsRef.current;
    const channel = createResilientChannel({
      client: supabase,
      name,
      config: channelConfig,
    });

    channelRef.current = channel;
    const unsubscribe = channel.onStatus(setStatus);

    pg.forEach(({ filter, handler }) => channel.onPostgresChange(filter, handler));
    bc.forEach(({ event, handler }) => channel.onBroadcast(event, handler));

    channel.subscribe();

    return () => {
      unsubscribe();
      channel.destroy();
      channelRef.current = null;
    };
  }, [name, enabled]);

  return useMemo(
    () => ({
      status,
      isConnected: status === CHANNEL_STATUS.CONNECTED,
      isReconnecting: status === CHANNEL_STATUS.RECONNECTING,
      get channel() {
        return channelRef.current;
      },
      send: (event, payload) => channelRef.current?.send(event, payload),
      track: (payload) => channelRef.current?.track(payload),
      untrack: () => channelRef.current?.untrack(),
      online: () => channelRef.current?.online() ?? [],
    }),
    [status]
  );
}
