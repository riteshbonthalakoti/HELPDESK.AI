import test from 'node:test';
import assert from 'node:assert/strict';

import { CHANNEL_STATUS, computeBackoff, createResilientChannel } from './resilientChannel.js';

class FakeChannel {
  constructor(name) {
    this.name = name;
    this.handlers = [];
    this.sent = [];
    this.subscribeCallback = null;
    this.tracked = null;
    this.removed = false;
    this.presence = {};
  }

  on(type, filter, callback) {
    this.handlers.push({ type, filter, callback });
    return this;
  }

  subscribe(callback) {
    this.subscribeCallback = callback;
    return this;
  }

  send(message) {
    this.sent.push(message);
    return 'ok';
  }

  track(payload) {
    this.tracked = payload;
    return 'ok';
  }

  untrack() {
    this.tracked = null;
    return 'ok';
  }

  presenceState() {
    return this.presence;
  }
}

class FakeClient {
  constructor() {
    this.channels = [];
  }

  channel(name) {
    const channel = new FakeChannel(name);
    this.channels.push(channel);
    return channel;
  }

  removeChannel(channel) {
    channel.removed = true;
  }
}

function makeTimers() {
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    api: {
      setTimeout: (fn) => {
        const id = ++nextId;
        timeouts.set(id, fn);
        return id;
      },
      clearTimeout: (id) => timeouts.delete(id),
      setInterval: (fn) => {
        const id = ++nextId;
        intervals.set(id, fn);
        return id;
      },
      clearInterval: (id) => intervals.delete(id),
    },
    fireTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      pending.forEach((fn) => fn());
    },
    fireIntervals() {
      [...intervals.values()].forEach((fn) => fn());
    },
    counts() {
      return { timeouts: timeouts.size, intervals: intervals.size };
    },
  };
}

function setup(config = {}) {
  const client = new FakeClient();
  const fakeTimers = makeTimers();
  const statuses = [];
  let clock = 0;
  const channel = createResilientChannel({
    client,
    name: 'support-chat',
    config,
    now: () => clock,
    random: () => 0.5,
    timers: fakeTimers.api,
  });
  channel.onStatus((status) => statuses.push(status));
  return {
    client,
    fakeTimers,
    statuses,
    channel,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('subscribes and reports connected', () => {
  const { client, statuses, channel } = setup();
  channel.subscribe();

  assert.equal(channel.status, CHANNEL_STATUS.CONNECTING);
  assert.equal(client.channels.length, 1);

  client.channels[0].subscribeCallback('SUBSCRIBED');
  assert.equal(channel.status, CHANNEL_STATUS.CONNECTED);
  assert.deepEqual(statuses, [
    CHANNEL_STATUS.IDLE,
    CHANNEL_STATUS.CONNECTING,
    CHANNEL_STATUS.CONNECTED,
  ]);
});

test('reconnects with backoff after a channel error and recovers', () => {
  const { client, fakeTimers, channel } = setup({ baseDelayMs: 1000, jitter: 0 });
  channel.subscribe();
  client.channels[0].subscribeCallback('SUBSCRIBED');

  client.channels[0].subscribeCallback('CHANNEL_ERROR');
  assert.equal(channel.status, CHANNEL_STATUS.RECONNECTING);

  // A reconnect is scheduled, not immediate.
  assert.equal(fakeTimers.counts().timeouts, 1);
  fakeTimers.fireTimeouts();

  assert.equal(client.channels.length, 2);
  client.channels[1].subscribeCallback('SUBSCRIBED');
  assert.equal(channel.status, CHANNEL_STATUS.CONNECTED);
});

test('queues outbound messages while disconnected and flushes on connect', () => {
  const { client, channel } = setup();
  channel.send('agent_message', { text: 'hello' });
  assert.equal(channel.pendingCount(), 1);

  channel.subscribe();
  client.channels[0].subscribeCallback('SUBSCRIBED');

  assert.equal(channel.pendingCount(), 0);
  assert.equal(client.channels[0].sent.length, 1);
  assert.deepEqual(client.channels[0].sent[0], {
    type: 'broadcast',
    event: 'agent_message',
    payload: { text: 'hello' },
  });
});

test('bounds the outbound queue', () => {
  const { channel } = setup({ queueLimit: 2 });
  channel.send('m', { n: 1 });
  channel.send('m', { n: 2 });
  channel.send('m', { n: 3 });
  assert.equal(channel.pendingCount(), 2);
});

test('routes postgres changes and broadcast handlers', () => {
  const { client, channel } = setup();
  const postgres = [];
  const broadcasts = [];
  channel.onPostgresChange({ event: '*', table: 'messages' }, (p) => postgres.push(p));
  channel.onBroadcast('agent_message', (p) => broadcasts.push(p));
  channel.subscribe();

  const underlying = client.channels[0];
  assert.equal(underlying.handlers.length, 2);

  underlying.handlers[0].callback({ eventType: 'INSERT' });
  underlying.handlers[1].callback({ payload: { text: 'hi' } });

  assert.deepEqual(postgres, [{ eventType: 'INSERT' }]);
  assert.deepEqual(broadcasts, [{ payload: { text: 'hi' } }]);
});

test('heartbeat forces a reconnect when the connection goes stale', () => {
  const { client, fakeTimers, channel, advance } = setup({ heartbeatMs: 1000 });
  channel.subscribe();
  client.channels[0].subscribeCallback('SUBSCRIBED');

  // Move well past twice the heartbeat interval without any activity.
  advance(3000);
  fakeTimers.fireIntervals();

  assert.equal(client.channels[0].removed, true);
  assert.equal(channel.status, CHANNEL_STATUS.RECONNECTING);
});

test('presence helpers proxy to the underlying channel', async () => {
  const { client, channel } = setup();
  channel.subscribe();
  client.channels[0].subscribeCallback('SUBSCRIBED');

  client.channels[0].presence = { a: [{ agent: 'a' }], b: [{ agent: 'b' }] };

  await channel.track({ agent: 'a' });
  assert.deepEqual(client.channels[0].tracked, { agent: 'a' });
  assert.deepEqual(channel.online(), [{ agent: 'a' }, { agent: 'b' }]);

  await channel.untrack();
  assert.equal(client.channels[0].tracked, null);
});

test('destroy tears down the channel, timers and listeners', () => {
  const { client, fakeTimers, channel } = setup();
  channel.subscribe();
  client.channels[0].subscribeCallback('SUBSCRIBED');

  assert.equal(fakeTimers.counts().intervals, 1);
  channel.destroy();

  assert.equal(client.channels[0].removed, true);
  assert.equal(channel.status, CHANNEL_STATUS.DISCONNECTED);
  assert.equal(fakeTimers.counts().intervals, 0);
  assert.equal(fakeTimers.counts().timeouts, 0);
});

test('computeBackoff stays within bounds', () => {
  const cfg = { baseDelayMs: 1000, maxDelayMs: 30000, factor: 2, jitter: 0.5 };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const delay = computeBackoff(attempt, cfg, () => 0.5);
    assert.ok(delay >= 0 && delay <= cfg.maxDelayMs, `delay ${delay} out of range`);
  }
});
