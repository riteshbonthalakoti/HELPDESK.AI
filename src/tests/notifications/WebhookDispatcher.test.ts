import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  WebhookDispatcher,
  CircuitBreaker,
  signPayload,
  verifySignature,
  validateWebhookUrl,
  isPrivateIp,
  detectDestinationType,
  formatSlackPayload,
  formatDiscordPayload,
  formatPagerDutyPayload,
  formatPayloadForDestination,
  SIGNATURE_HEADER,
  type WebhookSubscriber,
  type WebhookEventPayload,
} from '../../core/notifications/WebhookDispatcher.ts';

// ============================================================================
// Sample Mock Data
// ============================================================================

const sampleEvent: WebhookEventPayload = {
  event: 'ticket.created',
  timestamp: '2026-11-17T12:00:00.000Z',
  ticket: {
    id: 'ticket-9988-abcd',
    subject: 'Server unresponsive in US-East',
    priority: 'Critical',
    status: 'open',
    assigned_team: 'Infrastructure',
    company: 'Acme Corp',
    sla_breach_at: '2026-11-17T14:00:00.000Z',
  },
  details: {
    environment: 'production',
    source: 'monitoring-agent',
  },
};

describe('WebhookDispatcher Test Suite', () => {
  let dispatcher: WebhookDispatcher;

  beforeEach(() => {
    dispatcher = new WebhookDispatcher({
      allowPrivateIps: true, // For mock testing in unit tests
      retryConfig: {
        baseDelayMs: 10,
        maxRetries: 2,
        backoffMultiplier: 2,
        jitterFactor: 0,
      },
      circuitBreakerConfig: {
        failureThreshold: 3,
        cooldownPeriodMs: 100,
      },
      requestTimeoutMs: 500,
    });
  });

  // ==========================================================================
  // 1. Subscription Management Tests
  // ==========================================================================
  describe('Subscription Management', () => {
    it('successfully registers a valid subscriber', async () => {
      const sub = await dispatcher.registerSubscriber({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        secret: 'super-secret-key-1',
        events: ['ticket.created', 'ticket.sla_breach'],
        enabled: true,
      });

      assert.strictEqual(sub.id, 'sub-1');
      assert.strictEqual(sub.url, 'https://example.com/webhook');
      assert.strictEqual(sub.enabled, true);
      assert.strictEqual(sub.destinationType, 'generic');
      assert.deepStrictEqual(sub.events, ['ticket.created', 'ticket.sla_breach']);
      assert.strictEqual(dispatcher.getAllSubscribers().length, 1);
    });

    it('rejects duplicate subscriber IDs', async () => {
      await dispatcher.registerSubscriber({
        id: 'sub-dup',
        url: 'https://example.com/webhook-1',
        secret: 'secret-1',
        events: ['ticket.created'],
        enabled: true,
      });

      await assert.rejects(
        async () => {
          await dispatcher.registerSubscriber({
            id: 'sub-dup',
            url: 'https://example.com/webhook-2',
            secret: 'secret-2',
            events: ['ticket.created'],
            enabled: true,
          });
        },
        /already exists/
      );
    });

    it('rejects invalid or empty subscriber id', async () => {
      await assert.rejects(
        async () => {
          await dispatcher.registerSubscriber({
            id: '',
            url: 'https://example.com/webhook',
            secret: 'secret',
            events: ['ticket.created'],
            enabled: true,
          });
        },
        /Subscriber id must be a non-empty string/
      );
    });

    it('rejects invalid or empty secret', async () => {
      await assert.rejects(
        async () => {
          await dispatcher.registerSubscriber({
            id: 'sub-empty-secret',
            url: 'https://example.com/webhook',
            secret: '   ',
            events: ['ticket.created'],
            enabled: true,
          });
        },
        /Subscriber secret must be a non-empty string/
      );
    });

    it('rejects invalid or unsupported event types', async () => {
      await assert.rejects(
        async () => {
          await dispatcher.registerSubscriber({
            id: 'sub-invalid-event',
            url: 'https://example.com/webhook',
            secret: 'secret',
            // @ts-expect-error Testing runtime invalid event
            events: ['ticket.not_real_event'],
            enabled: true,
          });
        },
        /Invalid event type/
      );
    });

    it('rejects empty event subscriptions list', async () => {
      await assert.rejects(
        async () => {
          await dispatcher.registerSubscriber({
            id: 'sub-no-events',
            url: 'https://example.com/webhook',
            secret: 'secret',
            events: [],
            enabled: true,
          });
        },
        /Subscriber must subscribe to at least one valid event type/
      );
    });

    it('successfully unregisters an existing subscriber', async () => {
      await dispatcher.registerSubscriber({
        id: 'sub-to-remove',
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['ticket.created'],
        enabled: true,
      });

      const removed = dispatcher.unregisterSubscriber('sub-to-remove');
      assert.strictEqual(removed, true);
      assert.strictEqual(dispatcher.getSubscriber('sub-to-remove'), undefined);

      const removedAgain = dispatcher.unregisterSubscriber('sub-to-remove');
      assert.strictEqual(removedAgain, false);
    });

    it('updates an existing subscriber configuration', async () => {
      await dispatcher.registerSubscriber({
        id: 'sub-update',
        url: 'https://example.com/webhook-old',
        secret: 'secret',
        events: ['ticket.created'],
        enabled: true,
      });

      const updated = dispatcher.updateSubscriber('sub-update', {
        enabled: false,
        events: ['ticket.sla_breach', 'ticket.resolved'],
      });

      assert.strictEqual(updated.enabled, false);
      assert.deepStrictEqual(updated.events, ['ticket.sla_breach', 'ticket.resolved']);
    });

    it('deduplicates duplicate event types during registration', async () => {
      const sub = await dispatcher.registerSubscriber({
        id: 'sub-dedup',
        url: 'https://example.com/webhook',
        secret: 'secret',
        events: ['ticket.created', 'ticket.created', 'ticket.resolved'],
        enabled: true,
      });

      assert.deepStrictEqual(sub.events, ['ticket.created', 'ticket.resolved']);
    });
  });

  // ==========================================================================
  // 2. Cryptographic Payload Signing Tests
  // ==========================================================================
  describe('Cryptographic Payload Signing', () => {
    it('generates a valid sha256 HMAC signature', () => {
      const payload = '{"event":"ticket.created","ticket":{"id":"123"}}';
      const secret = 'test-signing-key';
      const sig = signPayload(payload, secret);

      assert.ok(sig.startsWith('sha256='));
      assert.strictEqual(sig.length, 7 + 64); // "sha256=" + 64 hex chars
    });

    it('produces different signatures for different secrets', () => {
      const payload = '{"message":"hello world"}';
      const sig1 = signPayload(payload, 'secret-1');
      const sig2 = signPayload(payload, 'secret-2');

      assert.notStrictEqual(sig1, sig2);
    });

    it('produces different signatures for even 1 byte difference in payload', () => {
      const sig1 = signPayload('{"a":1}', 'secret');
      const sig2 = signPayload('{"a":2}', 'secret');

      assert.notStrictEqual(sig1, sig2);
    });

    it('verifies signatures correctly using timing-safe comparison', () => {
      const payload = '{"test":"value"}';
      const secret = 'my-secret';
      const validSig = signPayload(payload, secret);

      assert.strictEqual(verifySignature(payload, validSig, secret), true);
      assert.strictEqual(verifySignature(payload, 'sha256=0000000000000000000000000000000000000000000000000000000000000000', secret), false);
      assert.strictEqual(verifySignature(payload, validSig, 'wrong-secret'), false);
      assert.strictEqual(verifySignature('tampered', validSig, secret), false);
      assert.strictEqual(verifySignature('', validSig, secret), false);
    });

    it('throws when payload is not a string or secret is empty', () => {
      // @ts-expect-error Runtime test
      assert.throws(() => signPayload(null, 'secret'), /Payload must be a string/);
      assert.throws(() => signPayload('data', ''), /Signing secret must be a non-empty string/);
    });
  });

  // ==========================================================================
  // 3. Multi-Channel Formatter Tests
  // ==========================================================================
  describe('Multi-Channel Destination Formatters', () => {
    it('detects destination type accurately from URL', () => {
      assert.strictEqual(detectDestinationType('https://hooks.slack.com/services/T00/B00/X00'), 'slack');
      assert.strictEqual(detectDestinationType('https://discord.com/api/webhooks/123/abc'), 'discord');
      assert.strictEqual(detectDestinationType('https://discordapp.com/api/webhooks/123/abc'), 'discord');
      assert.strictEqual(detectDestinationType('https://events.pagerduty.com/v2/enqueue'), 'pagerduty');
      assert.strictEqual(detectDestinationType('https://api.mycompany.com/webhooks/listener'), 'generic');
    });

    it('formats Slack payload with attachments and fields', () => {
      const payload = formatSlackPayload(sampleEvent);
      assert.ok(Array.isArray(payload.attachments));
      const attachment = (payload.attachments as Record<string, unknown>[])[0];
      assert.strictEqual(attachment.color, '#EF4444'); // Critical priority color
      assert.ok(String(attachment.title).includes('TICKET-9'));
      assert.ok(Array.isArray(attachment.fields));
    });

    it('formats Discord payload with embeds and decimal color', () => {
      const payload = formatDiscordPayload(sampleEvent);
      assert.strictEqual(payload.username, 'HELPDESK.AI Alerts');
      assert.ok(Array.isArray(payload.embeds));
      const embed = (payload.embeds as Record<string, unknown>[])[0];
      assert.strictEqual(embed.color, 15680580); // Red
      assert.strictEqual(embed.description, 'Server unresponsive in US-East');
    });

    it('formats PagerDuty payload with routing key and dedup_key', () => {
      const payload = formatPagerDutyPayload(sampleEvent, 'custom-pd-key');
      assert.strictEqual(payload.routing_key, 'custom-pd-key');
      assert.strictEqual(payload.event_action, 'trigger');
      assert.strictEqual(payload.dedup_key, 'helpdesk-ticket-ticket-9988-abcd');
      const inner = payload.payload as Record<string, unknown>;
      assert.strictEqual(inner.severity, 'critical');
    });

    it('formats PagerDuty resolve action for ticket.resolved event', () => {
      const resolvedEvent: WebhookEventPayload = {
        ...sampleEvent,
        event: 'ticket.resolved',
      };
      const payload = formatPagerDutyPayload(resolvedEvent);
      assert.strictEqual(payload.event_action, 'resolve');
    });

    it('formats generic payload cleanly without platform alterations', () => {
      const payload = formatPayloadForDestination('generic', sampleEvent);
      assert.strictEqual(payload.event, 'ticket.created');
      assert.deepStrictEqual(payload.ticket, sampleEvent.ticket);
    });
  });

  // ==========================================================================
  // 4. HTTP Delivery & Mock Tests
  // ==========================================================================
  describe('HTTP Delivery', () => {
    it('successfully delivers event over HTTP with correct headers and signature', async () => {
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedHeaders: HeadersInit | undefined;
      let capturedBody = '';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method || '';
        capturedHeaders = init?.headers;
        capturedBody = String(init?.body || '');
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }) as typeof fetch;

      try {
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-http-success',
          url: 'https://example.com/webhook',
          secret: 'test-secret-123',
          events: ['ticket.created'],
          enabled: true,
        });

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.subscriberId, 'sub-http-success');
        assert.strictEqual(capturedUrl, 'https://example.com/webhook');
        assert.strictEqual(capturedMethod, 'POST');

        // Verify headers
        const headersObj = capturedHeaders as Record<string, string>;
        assert.strictEqual(headersObj['Content-Type'], 'application/json');
        assert.ok(headersObj[SIGNATURE_HEADER]);

        // Verify signature over exact transmitted body
        const isValidSig = verifySignature(capturedBody, headersObj[SIGNATURE_HEADER], 'test-secret-123');
        assert.strictEqual(isValidSig, true);
        assert.strictEqual(result.attempts.length, 1);
        assert.strictEqual(result.attempts[0].statusCode, 200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('dispatches only to subscribers who subscribed to the specific event', async () => {
      const originalFetch = globalThis.fetch;
      const calledUrls: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        calledUrls.push(String(url));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      try {
        await dispatcher.registerSubscriber({
          id: 'sub-created-only',
          url: 'https://example.com/created',
          secret: 's1',
          events: ['ticket.created'],
          enabled: true,
        });

        await dispatcher.registerSubscriber({
          id: 'sub-breach-only',
          url: 'https://example.com/breach',
          secret: 's2',
          events: ['ticket.sla_breach'],
          enabled: true,
        });

        await dispatcher.registerSubscriber({
          id: 'sub-disabled',
          url: 'https://example.com/disabled',
          secret: 's3',
          events: ['ticket.created'],
          enabled: false,
        });

        const summary = await dispatcher.dispatch('ticket.created', {
          ticket: sampleEvent.ticket,
        });

        assert.strictEqual(summary.totalSubscribers, 3);
        assert.strictEqual(summary.matchedSubscribers, 1);
        assert.strictEqual(summary.results.length, 1);
        assert.strictEqual(summary.results[0].subscriberId, 'sub-created-only');
        assert.deepStrictEqual(calledUrls, ['https://example.com/created']);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // 5. Exponential Backoff & Retry Tests
  // ==========================================================================
  describe('Exponential Backoff & Retries', () => {
    it('calculates exponential backoff delay correctly', () => {
      const config = {
        baseDelayMs: 100,
        backoffMultiplier: 2,
        jitterFactor: 0, // Disable random jitter for deterministic check
      };

      // attempt 0: 100 * (2^0) = 100
      assert.strictEqual(dispatcher.calculateBackoffDelay(0, config), 100);
      // attempt 1: 100 * (2^1) = 200
      assert.strictEqual(dispatcher.calculateBackoffDelay(1, config), 200);
      // attempt 2: 100 * (2^2) = 400
      assert.strictEqual(dispatcher.calculateBackoffDelay(2, config), 400);
      // attempt 3: 100 * (2^3) = 800
      assert.strictEqual(dispatcher.calculateBackoffDelay(3, config), 800);
    });

    it('applies custom jitter function when supplied', () => {
      const customJitter = (delay: number) => delay + 42;
      const delay = dispatcher.calculateBackoffDelay(1, {
        baseDelayMs: 100,
        backoffMultiplier: 2,
        jitterFn: customJitter,
      });

      assert.strictEqual(delay, 242);
    });

    it('retries transient 500 HTTP errors and succeeds on retry', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Internal Server Error', { status: 500, statusText: 'Server Error' });
        }
        return new Response('OK', { status: 200 });
      }) as typeof fetch;

      try {
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-retry-success',
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['ticket.created'],
          enabled: true,
        });

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);

        assert.strictEqual(callCount, 2);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.attempts.length, 2);
        assert.strictEqual(result.attempts[0].statusCode, 500);
        assert.strictEqual(result.attempts[1].statusCode, 200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does NOT retry permanent client errors (400, 401, 404)', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response('Bad Request', { status: 400, statusText: 'Bad Request' });
      }) as typeof fetch;

      try {
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-client-error',
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['ticket.created'],
          enabled: true,
        });

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);

        assert.strictEqual(callCount, 1); // Should immediately fail without retrying
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.attempts.length, 1);
        assert.strictEqual(result.attempts[0].statusCode, 400);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('exhausts retries and reports failure on persistent errors', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        throw new Error('Connection refused');
      }) as typeof fetch;

      try {
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-exhaust',
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['ticket.created'],
          enabled: true,
        });

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);

        // maxRetries is 2 -> attempt 0 + 2 retries = 3 total calls
        assert.strictEqual(callCount, 3);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.attempts.length, 3);
        assert.ok(result.error?.includes('Connection refused'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // 6. Circuit Breaker Tests
  // ==========================================================================
  describe('Circuit Breaker Behavior', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, cooldownPeriodMs: 100 });
      assert.strictEqual(cb.getState(), 'CLOSED');
      assert.strictEqual(cb.canAttempt(), true);
    });

    it('transitions to OPEN after reaching failure threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, cooldownPeriodMs: 1000 });
      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'CLOSED');
      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'OPEN');
      assert.strictEqual(cb.canAttempt(), false);
    });

    it('transitions to HALF_OPEN after cooldown period', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 2, cooldownPeriodMs: 50 });
      cb.recordFailure();
      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'OPEN');

      // Wait past cooldown
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(cb.getState(), 'HALF_OPEN');
      assert.strictEqual(cb.canAttempt(), true);
    });

    it('closes on successful probe during HALF_OPEN', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, cooldownPeriodMs: 30 });
      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'OPEN');

      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.strictEqual(cb.getState(), 'HALF_OPEN');
      assert.strictEqual(cb.canAttempt(), true);

      cb.recordSuccess();
      assert.strictEqual(cb.getState(), 'CLOSED');
      assert.strictEqual(cb.getStatus().consecutiveFailures, 0);
    });

    it('reopens on failed probe during HALF_OPEN', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, cooldownPeriodMs: 30 });
      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'OPEN');

      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.strictEqual(cb.canAttempt(), true);

      cb.recordFailure();
      assert.strictEqual(cb.getState(), 'OPEN');
    });

    it('isolates circuit breaker state per subscriber', async () => {
      const cb1 = dispatcher.getCircuitBreaker('sub-1');
      const cb2 = dispatcher.getCircuitBreaker('sub-2');

      cb1.recordFailure();
      cb1.recordFailure();
      cb1.recordFailure();

      assert.strictEqual(cb1.getState(), 'OPEN');
      assert.strictEqual(cb2.getState(), 'CLOSED');
      assert.strictEqual(cb2.canAttempt(), true);
    });

    it('stops sending requests when circuit is OPEN in dispatcher', async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        callCount++;
        return new Response('Service Unavailable', { status: 503 });
      }) as typeof fetch;

      try {
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-cb-open',
          url: 'https://example.com/webhook',
          secret: 'secret',
          events: ['ticket.created'],
          enabled: true,
        });

        const cb = dispatcher.getCircuitBreaker('sub-cb-open');
        // Trip circuit breaker manually
        cb.recordFailure();
        cb.recordFailure();
        cb.recordFailure();
        assert.strictEqual(cb.getState(), 'OPEN');

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.circuitBreakerState, 'OPEN');
        assert.strictEqual(callCount, 0); // No HTTP call made while OPEN!
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // 7. Failure Isolation Tests
  // ==========================================================================
  describe('Failure Isolation', () => {
    it('ensures one subscriber failure does not prevent delivery to another', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('failing-endpoint')) {
          return new Response('Fail', { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch;

      try {
        await dispatcher.registerSubscriber({
          id: 'sub-failing',
          url: 'https://failing-endpoint.com/webhook',
          secret: 'secret-fail',
          events: ['ticket.created'],
          enabled: true,
        });

        await dispatcher.registerSubscriber({
          id: 'sub-healthy',
          url: 'https://healthy-endpoint.com/webhook',
          secret: 'secret-healthy',
          events: ['ticket.created'],
          enabled: true,
        });

        const summary = await dispatcher.dispatch('ticket.created', {
          ticket: sampleEvent.ticket,
        });

        assert.strictEqual(summary.results.length, 2);

        const failResult = summary.results.find((r) => r.subscriberId === 'sub-failing');
        const healthyResult = summary.results.find((r) => r.subscriberId === 'sub-healthy');

        assert.ok(failResult);
        assert.strictEqual(failResult.success, false);

        assert.ok(healthyResult);
        assert.strictEqual(healthyResult.success, true);
        assert.strictEqual(healthyResult.attempts[0].statusCode, 200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ==========================================================================
  // 8. Security & SSRF Protection Tests
  // ==========================================================================
  describe('Security & SSRF Protections', () => {
    it('identifies private and reserved IPv4 addresses correctly', () => {
      assert.strictEqual(isPrivateIp('127.0.0.1'), true);
      assert.strictEqual(isPrivateIp('127.0.0.2'), true);
      assert.strictEqual(isPrivateIp('10.0.0.1'), true);
      assert.strictEqual(isPrivateIp('10.254.254.254'), true);
      assert.strictEqual(isPrivateIp('172.16.0.1'), true);
      assert.strictEqual(isPrivateIp('172.31.255.255'), true);
      assert.strictEqual(isPrivateIp('192.168.1.1'), true);
      assert.strictEqual(isPrivateIp('169.254.169.254'), true); // AWS / GCP metadata
      assert.strictEqual(isPrivateIp('0.0.0.0'), true);
      assert.strictEqual(isPrivateIp('255.255.255.255'), true);
      assert.strictEqual(isPrivateIp('100.64.0.1'), true); // Carrier NAT
      assert.strictEqual(isPrivateIp('8.8.8.8'), false);
      assert.strictEqual(isPrivateIp('1.1.1.1'), false);
      assert.strictEqual(isPrivateIp('142.250.190.46'), false);
    });

    it('identifies private IPv6 addresses correctly', () => {
      assert.strictEqual(isPrivateIp('::1'), true);
      assert.strictEqual(isPrivateIp('::'), true);
      assert.strictEqual(isPrivateIp('fc00::1'), true);
      assert.strictEqual(isPrivateIp('fe80::1'), true);
      assert.strictEqual(isPrivateIp('::ffff:127.0.0.1'), true);
      assert.strictEqual(isPrivateIp('2607:f8b0:4005:805::200e'), false);
    });

    it('rejects unsupported URL protocols', async () => {
      const ftpResult = await validateWebhookUrl('ftp://example.com/webhook');
      assert.strictEqual(ftpResult.valid, false);
      assert.ok(ftpResult.reason?.includes('Unsupported URL protocol'));

      const fileResult = await validateWebhookUrl('file:///etc/passwd');
      assert.strictEqual(fileResult.valid, false);
      assert.ok(fileResult.reason?.includes('Unsupported URL protocol'));

      const gopherResult = await validateWebhookUrl('gopher://example.com/');
      assert.strictEqual(gopherResult.valid, false);
    });

    it('rejects private IP literals and localhost domains', async () => {
      const loopbackResult = await validateWebhookUrl('http://127.0.0.1:8080/hook', false);
      assert.strictEqual(loopbackResult.valid, false);
      assert.ok(loopbackResult.reason?.includes('private or reserved'));

      const metadataResult = await validateWebhookUrl('http://169.254.169.254/latest/meta-data', false);
      assert.strictEqual(metadataResult.valid, false);

      const localhostResult = await validateWebhookUrl('http://localhost:3000/hook', false);
      assert.strictEqual(localhostResult.valid, false);
      assert.ok(localhostResult.reason?.includes('Disallowed hostname'));
    });

    it('allows valid external HTTPS URLs', async () => {
      const result = await validateWebhookUrl('https://example.com/webhook', true);
      assert.strictEqual(result.valid, true);
    });

    it('never logs or leaks signing secrets in DeliveryResult', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response('Fail', { status: 500, statusText: 'Secret Error' });
      }) as typeof fetch;

      try {
        const secretKey = 'CRITICAL_LEAK_TARGET_SECRET_XYZ999';
        const sub = await dispatcher.registerSubscriber({
          id: 'sub-secret-test',
          url: 'https://example.com/webhook',
          secret: secretKey,
          events: ['ticket.created'],
          enabled: true,
        });

        const result = await dispatcher.deliverToSubscriber(sub, sampleEvent);
        const serializedResult = JSON.stringify(result);

        assert.strictEqual(serializedResult.includes(secretKey), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
