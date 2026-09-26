# Resilient Realtime WebSocket Channels

This document describes the resilient Supabase Realtime layer used for live
support chat between customers and online agents (issue #3913).

## Problem

`supabase.channel(name).subscribe()` exposes a single status callback and leaves
reconnection policy to the caller. For live support chat this is not enough:

- a dropped socket between a customer and an agent must heal on its own;
- a reply sent during a brief outage must not be lost;
- "who is online" (agent presence) must follow the connection;
- the UI needs to show connection state so agents know when they are offline.

## Design

`Frontend/src/realtime/resilientChannel.js` wraps a Supabase channel with:

| Concern | Behaviour |
| --- | --- |
| Reconnection | Exponential backoff with +/- jitter, clamped to `maxDelayMs`; `maxAttempts` caps retries. |
| Liveness | A heartbeat interval; if no activity is seen for two intervals the socket is treated as dead and a reconnect is forced. |
| Outbound durability | Messages sent while not `connected` are queued (bounded by `queueLimit`) and flushed on the next successful subscribe. |
| Handler registration | `onPostgresChange(filter, handler)` and `onBroadcast(event, handler)`. |
| Presence | `track(payload)`, `untrack()`, `online()` proxy to the underlying channel's presence state. |
| Status | `onStatus(listener)` emits `idle`, `connecting`, `connected`, `reconnecting`, `disconnected`. |
| Teardown | `destroy()` is idempotent: removes the channel, clears timers and listeners. |

The Supabase client is injected (`createResilientChannel({ client, name })`), so
the module has no hard dependency on the app's client and is unit-testable with
a fake client.

### Status lifecycle

```
idle -> connecting -> connected
                 \-> reconnecting -> connected
                 \-> disconnected   (retries exhausted or destroy())
```

## React usage

```jsx
import useResilientChannel from '../hooks/useResilientChannel';

function SupportChat({ ticketId }) {
  const { status, isConnected, send, online } = useResilientChannel(
    `support-chat:${ticketId}`,
    {
      broadcasts: [
        {
          event: 'agent_message',
          handler: (message) => appendMessage(message.payload),
        },
      ],
    }
  );

  const onSend = (text) => send('agent_message', { ticketId, text });

  // `status !== 'connected'` can be surfaced as an "offline, retrying" banner.
  return <ChatPanel disabled={!isConnected} onSend={onSend} onlineCount={online().length} />;
}
```

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `baseDelayMs` | `1000` | First reconnect delay. |
| `maxDelayMs` | `30000` | Backoff ceiling. |
| `factor` | `2` | Backoff multiplier. |
| `jitter` | `0.3` | Fraction of the delay applied as +/- jitter. |
| `maxAttempts` | `Infinity` | Retries before `disconnected`. |
| `heartbeatMs` | `25000` | Heartbeat interval; `0` disables it. |
| `queueLimit` | `100` | Max queued outbound messages (oldest dropped first). |

## Tests

The channel wrapper is covered by `Frontend/src/realtime/resilientChannel.test.mjs`
using Node's built-in test runner (no extra dependencies):

```bash
cd Frontend
node --test src/realtime/resilientChannel.test.mjs
```

Covered: subscribe/connected transitions, reconnect-and-recover after a channel
error, outbound queueing and flush, queue bounds, postgres/broadcast handler
routing, stale-connection heartbeat, presence helpers, teardown, and backoff
bounds.
