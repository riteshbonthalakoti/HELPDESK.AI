/**
 * Resilient Supabase Realtime channel wrapper.
 *
 * The stock `supabase.channel(...).subscribe()` API surfaces a single terminal
 * status callback and leaves reconnection policy to the caller. Live support
 * chat cannot rely on that: a dropped socket between a customer and an online
 * agent must heal on its own, outbound messages must survive brief outages, and
 * presence (which agents are online) must follow the connection.
 *
 * `createResilientChannel` wraps a channel with:
 *
 *  - automatic reconnection using exponential backoff + jitter;
 *  - a connection heartbeat that forces a reconnect when the socket goes stale;
 *  - a bounded outbound queue that flushes as soon as the channel is back;
 *  - `postgres_changes` and `broadcast` handler registration;
 *  - presence helpers (`track` / `untrack` / `online`);
 *  - a status subscription for UI ("connected", "reconnecting", ...).
 *
 * The Supabase client is injected, so the module is framework-agnostic and
 * unit-testable with a fake client (see `resilientChannel.test.mjs`).
 */

export const CHANNEL_STATUS = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  DISCONNECTED: 'disconnected',
});

const DEFAULTS = Object.freeze({
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  factor: 2,
  jitter: 0.3,
  maxAttempts: Infinity,
  heartbeatMs: 25000,
  queueLimit: 100,
});

const SUBSCRIBED = 'SUBSCRIBED';

/**
 * Exponential backoff with +/- jitter, clamped to the configured ceiling.
 */
export function computeBackoff(attempt, config = {}, random = Math.random) {
  const cfg = { ...DEFAULTS, ...config };
  const raw = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * Math.pow(cfg.factor, attempt));
  const spread = raw * cfg.jitter;
  return Math.max(0, Math.round(raw - spread + random() * spread * 2));
}

export function createResilientChannel({
  client,
  name,
  config = {},
  now = () => Date.now(),
  random = Math.random,
  timers = { setTimeout, clearTimeout, setInterval, clearInterval },
} = {}) {
  if (!client || typeof client.channel !== 'function') {
    throw new Error('createResilientChannel requires a client with a .channel() method');
  }
  if (!name) {
    throw new Error('createResilientChannel requires a channel name');
  }

  const cfg = { ...DEFAULTS, ...config };
  const postgresHandlers = [];
  const broadcastHandlers = [];
  const statusListeners = new Set();
  const outbound = [];

  let channel = null;
  let status = CHANNEL_STATUS.IDLE;
  let attempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let destroyed = false;
  let lastActivityAt = now();

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    for (const listener of statusListeners) {
      try {
        listener(next);
      } catch {
        // A misbehaving listener must never break the channel.
      }
    }
  };

  const touch = () => {
    lastActivityAt = now();
  };

  const buildChannel = () => {
    const ch = client.channel(name);
    for (const { filter, handler } of postgresHandlers) {
      ch.on('postgres_changes', filter, (payload) => {
        touch();
        handler(payload);
      });
    }
    for (const { event, handler } of broadcastHandlers) {
      ch.on('broadcast', { event }, (payload) => {
        touch();
        handler(payload);
      });
    }
    return ch;
  };

  const clearTimers = () => {
    if (reconnectTimer !== null) {
      timers.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (heartbeatTimer !== null) {
      timers.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const teardownChannel = () => {
    const current = channel;
    channel = null;
    if (current && typeof client.removeChannel === 'function') {
      try {
        client.removeChannel(current);
      } catch {
        // Removing an already-closed channel is not fatal.
      }
    }
  };

  const flushQueue = () => {
    while (outbound.length > 0 && status === CHANNEL_STATUS.CONNECTED && channel) {
      const message = outbound.shift();
      try {
        channel.send(message);
      } catch {
        outbound.unshift(message);
        return;
      }
    }
  };

  const startHeartbeat = () => {
    if (heartbeatTimer !== null || cfg.heartbeatMs <= 0) return;
    heartbeatTimer = timers.setInterval(() => {
      if (destroyed) return;
      if (now() - lastActivityAt > cfg.heartbeatMs * 2) {
        reconnect();
        return;
      }
      try {
        channel.send({ type: 'broadcast', event: 'heartbeat', payload: { at: now() } });
      } catch {
        // A failed heartbeat send is handled by the next staleness check.
      }
    }, cfg.heartbeatMs);
  };

  const scheduleReconnect = () => {
    if (destroyed) return;
    if (attempt >= cfg.maxAttempts) {
      setStatus(CHANNEL_STATUS.DISCONNECTED);
      return;
    }
    const delay = computeBackoff(attempt, cfg, random);
    attempt += 1;
    setStatus(CHANNEL_STATUS.RECONNECTING);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (destroyed) return;
    clearTimers();
    teardownChannel();
    setStatus(attempt === 0 ? CHANNEL_STATUS.CONNECTING : CHANNEL_STATUS.RECONNECTING);
    channel = buildChannel();
    channel.subscribe((subscribeStatus) => {
      if (destroyed) return;
      touch();
      if (subscribeStatus === SUBSCRIBED) {
        attempt = 0;
        setStatus(CHANNEL_STATUS.CONNECTED);
        startHeartbeat();
        flushQueue();
      } else if (
        subscribeStatus === 'CHANNEL_ERROR' ||
        subscribeStatus === 'TIMED_OUT' ||
        subscribeStatus === 'CLOSED'
      ) {
        scheduleReconnect();
      }
    });
    return channel;
  };

  const reconnect = () => {
    if (destroyed) return;
    clearTimers();
    teardownChannel();
    scheduleReconnect();
  };

  return {
    get name() {
      return name;
    },
    get status() {
      return status;
    },
    subscribe() {
      if (!destroyed && !channel) connect();
      return this;
    },
    onPostgresChange(filter, handler) {
      postgresHandlers.push({ filter, handler });
      return this;
    },
    onBroadcast(event, handler) {
      broadcastHandlers.push({ event, handler });
      return this;
    },
    onStatus(listener) {
      statusListeners.add(listener);
      listener(status);
      return () => statusListeners.delete(listener);
    },
    send(event, payload) {
      const message = { type: 'broadcast', event, payload };
      if (status === CHANNEL_STATUS.CONNECTED && channel) {
        return Promise.resolve(channel.send(message));
      }
      if (outbound.length >= cfg.queueLimit) outbound.shift();
      outbound.push(message);
      return Promise.resolve();
    },
    track(payload) {
      if (channel && typeof channel.track === 'function') return Promise.resolve(channel.track(payload));
      return Promise.resolve();
    },
    untrack() {
      if (channel && typeof channel.untrack === 'function') return Promise.resolve(channel.untrack());
      return Promise.resolve();
    },
    online() {
      if (!channel || typeof channel.presenceState !== 'function') return [];
      const state = channel.presenceState() || {};
      return Object.values(state).flat();
    },
    pendingCount() {
      return outbound.length;
    },
    notifyActivity() {
      touch();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      teardownChannel();
      outbound.length = 0;
      setStatus(CHANNEL_STATUS.DISCONNECTED);
      statusListeners.clear();
    },
  };
}

export default createResilientChannel;
