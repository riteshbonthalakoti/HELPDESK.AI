import { createHmac, timingSafeEqual } from 'node:crypto';
import * as dns from 'node:dns/promises';
import * as net from 'node:net';

// ============================================================================
// Types & Enums
// ============================================================================

export type TicketEventType =
  | 'ticket.created'
  | 'ticket.sla_breach'
  | 'ticket.resolved'
  | 'ticket.escalated'
  | 'ticket.sla_warning';

export type DestinationType = 'slack' | 'discord' | 'pagerduty' | 'generic';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface WebhookSubscriber {
  id: string;
  url: string;
  secret: string;
  events: TicketEventType[];
  enabled: boolean;
  destinationType?: DestinationType;
  metadata?: Record<string, unknown>;
}

export interface RetryConfig {
  baseDelayMs: number;
  maxRetries: number;
  backoffMultiplier: number;
  jitterFactor?: number; // 0.0 to 1.0 (default: 0.2)
  jitterFn?: (delay: number) => number; // Mockable hook for tests
}

export interface CircuitBreakerConfig {
  failureThreshold: number; // Consecutive failures before opening
  cooldownPeriodMs: number; // Milliseconds before half-open transition
}

export interface WebhookDispatcherConfig {
  retryConfig?: Partial<RetryConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  requestTimeoutMs?: number; // Per-request HTTP timeout (default: 10000ms)
  allowPrivateIps?: boolean; // For testing SSRF guards
}

export interface WebhookEventPayload {
  event: TicketEventType;
  timestamp: string;
  ticket: {
    id: string;
    subject?: string;
    priority?: string;
    status?: string;
    assigned_team?: string;
    company?: string;
    company_id?: string;
    sla_breach_at?: string;
    [key: string]: unknown;
  };
  details?: Record<string, unknown>;
}

export interface DeliveryAttempt {
  attemptNumber: number;
  statusCode?: number;
  error?: string;
  timestamp: string;
  durationMs: number;
}

export interface DeliveryResult {
  subscriberId: string;
  url: string;
  destinationType: DestinationType;
  success: boolean;
  attempts: DeliveryAttempt[];
  circuitBreakerState: CircuitBreakerState;
  error?: string;
}

export interface DispatchSummary {
  event: TicketEventType;
  dispatchedAt: string;
  totalSubscribers: number;
  matchedSubscribers: number;
  results: DeliveryResult[];
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureTime?: number;
  nextAttemptAllowedAt?: number;
}

// ============================================================================
// Security & SSRF Utilities
// ============================================================================

/**
 * Checks whether an IPv4 or IPv6 address belongs to private/internal/loopback ranges.
 */
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) {
    return false;
  }

  // IPv4 checks
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (Private network)
    if (parts[0] === 10) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (Link-local)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 172.16.0.0/12 (Private network: 172.16.0.0 - 172.31.255.255)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private network)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation)
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 (Reserved / Future use)
    if (parts[0] >= 240) return true;
    // 255.255.255.255 (Broadcast)
    if (ip === '255.255.255.255') return true;

    return false;
  }

  // IPv6 checks
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // Loopback ::1
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
    // Unspecified ::
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;
    // Unique local address fc00::/7 (fc00:: - fdff::)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    // Link-local unicast fe80::/10 (fe80:: - febf::)
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) return true;
    // IPv4-mapped IPv6 ::ffff:127.0.0.1
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.replace('::ffff:', '');
      return isPrivateIp(v4Part);
    }
  }

  return false;
}

/**
 * Validates webhook endpoint URLs for security.
 * Rejects non-HTTP(S) protocols and private/local/metadata IPs to protect against SSRF.
 */
export async function validateWebhookUrl(
  urlString: string,
  allowPrivateIps = false
): Promise<{ valid: boolean; reason?: string; parsedUrl?: URL }> {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'Webhook URL must be a non-empty string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Only http and https protocols allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Unsupported URL protocol: "${parsed.protocol}". Only http: and https: are allowed`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Guard against localhost and cloud metadata domain names
  const blockedHostnames = ['localhost', 'metadata.google.internal', 'instance-data'];
  if (blockedHostnames.includes(hostname)) {
    if (!allowPrivateIps) {
      return { valid: false, reason: `Disallowed hostname: "${hostname}"` };
    }
  }

  // Check if hostname is directly an IP literal
  if (net.isIP(hostname)) {
    if (!allowPrivateIps && isPrivateIp(hostname)) {
      return {
        valid: false,
        reason: `Target IP "${hostname}" is within a private or reserved network range`,
      };
    }
  } else if (!allowPrivateIps) {
    // Perform DNS lookup to prevent DNS rebinding / host spoofing to internal IP
    try {
      const records = await dns.lookup(hostname, { all: true });
      for (const record of records) {
        if (isPrivateIp(record.address)) {
          return {
            valid: false,
            reason: `Resolved IP "${record.address}" for host "${hostname}" is within a private or reserved network range`,
          };
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, reason: `DNS resolution failed for "${hostname}": ${message}` };
    }
  }

  return { valid: true, parsedUrl: parsed };
}

// ============================================================================
// Cryptographic Payload Signing
// ============================================================================

export const SIGNATURE_HEADER = 'X-Helpdesk-Signature-256';

/**
 * Computes HMAC-SHA256 signature for a raw payload string.
 * Output format: sha256=<hex_digest>
 */
export function signPayload(payload: string, secret: string): string {
  if (typeof payload !== 'string') {
    throw new TypeError('Payload must be a string');
  }
  if (!secret || typeof secret !== 'string') {
    throw new Error('Signing secret must be a non-empty string');
  }
  const digest = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

/**
 * Verifies an HMAC-SHA256 signature using constant-time comparison to prevent timing attacks.
 */
export function verifySignature(payload: string, signatureHeader: string, secret: string): boolean {
  try {
    if (!payload || !signatureHeader || !secret) {
      return false;
    }
    const expected = signPayload(payload, secret);
    const expectedBuf = Buffer.from(expected, 'utf8');
    const headerBuf = Buffer.from(signatureHeader, 'utf8');

    if (expectedBuf.length !== headerBuf.length) {
      return false;
    }
    return timingSafeEqual(expectedBuf, headerBuf);
  } catch {
    return false;
  }
}

// ============================================================================
// Channel Adapters & Payload Formatters
// ============================================================================

export function detectDestinationType(url: string): DestinationType {
  const lower = url.toLowerCase();
  if (lower.includes('hooks.slack.com')) return 'slack';
  if (lower.includes('discord.com/api/webhooks') || lower.includes('discordapp.com/api/webhooks')) return 'discord';
  if (lower.includes('events.pagerduty.com')) return 'pagerduty';
  return 'generic';
}

export function formatSlackPayload(event: WebhookEventPayload): Record<string, unknown> {
  const ticket = event.ticket;
  const ticketId = ticket.id ? String(ticket.id).slice(0, 8).toUpperCase() : 'UNKNOWN';
  const priority = String(ticket.priority || 'MEDIUM').toUpperCase();
  const color = priority === 'CRITICAL' || priority === 'HIGH' ? '#EF4444' : '#F59E0B';
  const subject = ticket.subject || 'No Subject';
  const status = String(ticket.status || 'open').toUpperCase();
  const team = ticket.assigned_team || 'Unassigned';

  return {
    attachments: [
      {
        color,
        fallback: `[${event.event}] Ticket #${ticketId} - ${subject}`,
        pretext: `🔔 *Helpdesk Alert:* \`${event.event}\``,
        title: `Ticket #${ticketId}: ${subject}`,
        fields: [
          { title: 'Status', value: status, short: true },
          { title: 'Priority', value: priority, short: true },
          { title: 'Assigned Team', value: team, short: true },
          { title: 'Event Type', value: event.event, short: true },
        ],
        footer: 'HELPDESK.AI Multi-Channel Webhook Dispatcher',
        ts: Math.floor(new Date(event.timestamp || Date.now()).getTime() / 1000),
      },
    ],
  };
}

export function formatDiscordPayload(event: WebhookEventPayload): Record<string, unknown> {
  const ticket = event.ticket;
  const ticketId = ticket.id ? String(ticket.id).slice(0, 8).toUpperCase() : 'UNKNOWN';
  const priority = String(ticket.priority || 'MEDIUM').toUpperCase();
  // Decimal colors: Red = 0xef4444 = 15680580, Amber = 0xf59e0b = 16096779
  const color = priority === 'CRITICAL' || priority === 'HIGH' ? 15680580 : 16096779;
  const subject = ticket.subject || 'No Subject';
  const status = String(ticket.status || 'open').toUpperCase();

  return {
    username: 'HELPDESK.AI Alerts',
    embeds: [
      {
        title: `🚨 [${event.event}] Ticket #${ticketId}`,
        description: subject,
        color,
        fields: [
          { name: 'Priority', value: priority, inline: true },
          { name: 'Status', value: status, inline: true },
          { name: 'Team', value: ticket.assigned_team || 'Unassigned', inline: true },
        ],
        timestamp: event.timestamp || new Date().toISOString(),
        footer: {
          text: 'HELPDESK.AI Notification System',
        },
      },
    ],
  };
}

export function formatPagerDutyPayload(
  event: WebhookEventPayload,
  routingKey = 'generic-routing-key'
): Record<string, unknown> {
  const ticket = event.ticket;
  const priority = String(ticket.priority || 'MEDIUM').toUpperCase();
  let severity = 'info';
  if (priority === 'CRITICAL') severity = 'critical';
  else if (priority === 'HIGH') severity = 'error';
  else if (priority === 'MEDIUM') severity = 'warning';

  return {
    routing_key: routingKey,
    event_action: event.event === 'ticket.resolved' ? 'resolve' : 'trigger',
    dedup_key: `helpdesk-ticket-${ticket.id}`,
    payload: {
      summary: `[${event.event}] ${ticket.subject || 'Incident on ticket ' + ticket.id}`,
      severity,
      source: 'HELPDESK.AI Webhook Dispatcher',
      timestamp: event.timestamp || new Date().toISOString(),
      custom_details: {
        ticket_id: ticket.id,
        priority,
        status: ticket.status,
        assigned_team: ticket.assigned_team,
        company: ticket.company || ticket.company_id,
        sla_breach_at: ticket.sla_breach_at,
        details: event.details,
      },
    },
  };
}

export function formatPayloadForDestination(
  destinationType: DestinationType,
  event: WebhookEventPayload
): Record<string, unknown> {
  switch (destinationType) {
    case 'slack':
      return formatSlackPayload(event);
    case 'discord':
      return formatDiscordPayload(event);
    case 'pagerduty':
      return formatPagerDutyPayload(event);
    case 'generic':
    default:
      return {
        event: event.event,
        timestamp: event.timestamp,
        ticket: event.ticket,
        details: event.details,
      };
  }
}

// ============================================================================
// Circuit Breaker Implementation
// ============================================================================

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastFailureTime?: number;
  private readonly failureThreshold: number;
  private readonly cooldownPeriodMs: number;
  private isHalfOpenTrialRunning = false;

  constructor(config: CircuitBreakerConfig) {
    this.failureThreshold = Math.max(1, config.failureThreshold);
    this.cooldownPeriodMs = Math.max(0, config.cooldownPeriodMs);
  }

  public getState(): CircuitBreakerState {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - (this.lastFailureTime || 0);
      if (elapsed >= this.cooldownPeriodMs) {
        return 'HALF_OPEN';
      }
    }
    return this.state;
  }

  public getStatus(): CircuitBreakerStatus {
    const currentState = this.getState();
    const nextAttemptAllowedAt =
      this.state === 'OPEN' && this.lastFailureTime
        ? this.lastFailureTime + this.cooldownPeriodMs
        : undefined;

    return {
      state: currentState,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
      nextAttemptAllowedAt,
    };
  }

  public canAttempt(): boolean {
    const currentState = this.getState();
    if (currentState === 'CLOSED') {
      return true;
    }
    if (currentState === 'HALF_OPEN') {
      // Allow only one single trial probe at a time to prevent concurrency storms
      if (!this.isHalfOpenTrialRunning) {
        this.isHalfOpenTrialRunning = true;
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    // OPEN
    return false;
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.isHalfOpenTrialRunning = false;
    this.lastFailureTime = undefined;
  }

  public recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTime = Date.now();
    this.isHalfOpenTrialRunning = false;

    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastFailureTime = undefined;
    this.isHalfOpenTrialRunning = false;
  }
}

// ============================================================================
// Main Webhook Dispatcher
// ============================================================================

export class WebhookDispatcher {
  private subscribers: Map<string, WebhookSubscriber> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  private readonly retryConfig: RetryConfig;
  private readonly circuitBreakerConfig: CircuitBreakerConfig;
  private readonly requestTimeoutMs: number;
  private readonly allowPrivateIps: boolean;

  constructor(config: WebhookDispatcherConfig = {}) {
    this.retryConfig = {
      baseDelayMs: config.retryConfig?.baseDelayMs ?? 1000,
      maxRetries: config.retryConfig?.maxRetries ?? 3,
      backoffMultiplier: config.retryConfig?.backoffMultiplier ?? 2,
      jitterFactor: config.retryConfig?.jitterFactor ?? 0.2,
      jitterFn: config.retryConfig?.jitterFn,
    };

    this.circuitBreakerConfig = {
      failureThreshold: config.circuitBreakerConfig?.failureThreshold ?? 5,
      cooldownPeriodMs: config.circuitBreakerConfig?.cooldownPeriodMs ?? 30000,
    };

    this.requestTimeoutMs = config.requestTimeoutMs ?? 10000;
    this.allowPrivateIps = config.allowPrivateIps ?? false;
  }

  // --------------------------------------------------------------------------
  // Subscriber Management
  // --------------------------------------------------------------------------

  public async registerSubscriber(
    subscriber: Omit<WebhookSubscriber, 'destinationType'> & { destinationType?: DestinationType }
  ): Promise<WebhookSubscriber> {
    if (!subscriber.id || typeof subscriber.id !== 'string' || subscriber.id.trim() === '') {
      throw new Error('Subscriber id must be a non-empty string');
    }

    if (this.subscribers.has(subscriber.id)) {
      throw new Error(`Subscriber with id "${subscriber.id}" already exists`);
    }

    const validation = await validateWebhookUrl(subscriber.url, this.allowPrivateIps);
    if (!validation.valid) {
      throw new Error(`Invalid subscriber URL: ${validation.reason}`);
    }

    if (!subscriber.secret || typeof subscriber.secret !== 'string' || subscriber.secret.trim() === '') {
      throw new Error('Subscriber secret must be a non-empty string');
    }

    if (!Array.isArray(subscriber.events) || subscriber.events.length === 0) {
      throw new Error('Subscriber must subscribe to at least one valid event type');
    }

    const validEvents: TicketEventType[] = [
      'ticket.created',
      'ticket.sla_breach',
      'ticket.resolved',
      'ticket.escalated',
      'ticket.sla_warning',
    ];

    for (const ev of subscriber.events) {
      if (!validEvents.includes(ev)) {
        throw new Error(`Invalid event type "${ev}". Allowed: ${validEvents.join(', ')}`);
      }
    }

    const destinationType = subscriber.destinationType || detectDestinationType(subscriber.url);

    const record: WebhookSubscriber = {
      id: subscriber.id,
      url: subscriber.url,
      secret: subscriber.secret,
      events: [...new Set(subscriber.events)],
      enabled: subscriber.enabled ?? true,
      destinationType,
      metadata: subscriber.metadata,
    };

    this.subscribers.set(record.id, record);
    return record;
  }

  public unregisterSubscriber(subscriberId: string): boolean {
    if (!this.subscribers.has(subscriberId)) {
      return false;
    }
    this.subscribers.delete(subscriberId);
    this.circuitBreakers.delete(subscriberId);
    return true;
  }

  public getSubscriber(subscriberId: string): WebhookSubscriber | undefined {
    return this.subscribers.get(subscriberId);
  }

  public getAllSubscribers(): WebhookSubscriber[] {
    return Array.from(this.subscribers.values());
  }

  public updateSubscriber(
    subscriberId: string,
    updates: Partial<Omit<WebhookSubscriber, 'id'>>
  ): WebhookSubscriber {
    const existing = this.subscribers.get(subscriberId);
    if (!existing) {
      throw new Error(`Subscriber "${subscriberId}" not found`);
    }

    if (updates.url && updates.url !== existing.url) {
      // URL update resets the circuit breaker for that subscriber
      this.circuitBreakers.delete(subscriberId);
    }

    const updated: WebhookSubscriber = {
      ...existing,
      ...updates,
      id: existing.id,
    };

    this.subscribers.set(subscriberId, updated);
    return updated;
  }

  // --------------------------------------------------------------------------
  // Circuit Breaker Access
  // --------------------------------------------------------------------------

  public getCircuitBreaker(subscriberId: string): CircuitBreaker {
    let cb = this.circuitBreakers.get(subscriberId);
    if (!cb) {
      cb = new CircuitBreaker(this.circuitBreakerConfig);
      this.circuitBreakers.set(subscriberId, cb);
    }
    return cb;
  }

  // --------------------------------------------------------------------------
  // Retry Delay Calculation
  // --------------------------------------------------------------------------

  public calculateBackoffDelay(
    attempt: number,
    customConfig?: Partial<RetryConfig>
  ): number {
    const baseDelay = customConfig?.baseDelayMs ?? this.retryConfig.baseDelayMs;
    const multiplier = customConfig?.backoffMultiplier ?? this.retryConfig.backoffMultiplier;
    const jitterFactor = customConfig?.jitterFactor ?? this.retryConfig.jitterFactor ?? 0.2;
    const jitterFn = customConfig?.jitterFn ?? this.retryConfig.jitterFn;

    // delay = baseDelayMs * (backoffMultiplier ^ attempt)
    const rawDelay = baseDelay * Math.pow(multiplier, attempt);

    if (jitterFn) {
      return jitterFn(rawDelay);
    }

    // Full or decorrelated jitter around rawDelay: [rawDelay * (1 - jitterFactor), rawDelay * (1 + jitterFactor)]
    const min = rawDelay * (1 - jitterFactor);
    const max = rawDelay * (1 + jitterFactor);
    const randomized = min + Math.random() * (max - min);
    return Math.max(0, Math.floor(randomized));
  }

  // --------------------------------------------------------------------------
  // HTTP Delivery & Dispatching
  // --------------------------------------------------------------------------

  /**
   * Helper that checks whether an HTTP status code or error is retryable.
   * Client errors (4xx except 408 Request Timeout and 429 Too Many Requests) are non-retryable.
   */
  public isRetryableError(statusCode?: number, error?: Error): boolean {
    if (statusCode) {
      if (statusCode === 408 || statusCode === 429) {
        return true;
      }
      if (statusCode >= 400 && statusCode < 500) {
        return false;
      }
      if (statusCode >= 500) {
        return true;
      }
    }
    if (error) {
      const message = error.message.toLowerCase();
      if (
        message.includes('abort') ||
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('network') ||
        message.includes('fetch failed')
      ) {
        return true;
      }
    }
    return true;
  }

  /**
   * Delivers an event to a single subscriber with retry backoff and circuit breaking.
   * Fully isolated; never throws unhandled rejections to callers.
   */
  public async deliverToSubscriber(
    subscriber: WebhookSubscriber,
    eventPayload: WebhookEventPayload
  ): Promise<DeliveryResult> {
    const cb = this.getCircuitBreaker(subscriber.id);
    const attempts: DeliveryAttempt[] = [];
    const destination = subscriber.destinationType || detectDestinationType(subscriber.url);

    // Check circuit breaker before sending
    if (!cb.canAttempt()) {
      return {
        subscriberId: subscriber.id,
        url: subscriber.url,
        destinationType: destination,
        success: false,
        attempts: [],
        circuitBreakerState: cb.getState(),
        error: `Circuit breaker is ${cb.getState()} for subscriber ${subscriber.id}`,
      };
    }

    // Format destination-specific payload and serialize
    const formattedBody = formatPayloadForDestination(destination, eventPayload);
    const serializedPayload = JSON.stringify(formattedBody);

    // Compute HMAC-SHA256 signature
    const signature = signPayload(serializedPayload, subscriber.secret);

    let lastError: string | undefined;
    let deliveredSuccess = false;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      const attemptStartTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

      try {
        const response = await fetch(subscriber.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [SIGNATURE_HEADER]: signature,
            'User-Agent': 'HelpdeskAI-Webhook-Dispatcher/1.0',
          },
          body: serializedPayload,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const durationMs = Date.now() - attemptStartTime;

        if (response.ok) {
          attempts.push({
            attemptNumber: attempt + 1,
            statusCode: response.status,
            timestamp: new Date().toISOString(),
            durationMs,
          });
          cb.recordSuccess();
          deliveredSuccess = true;
          break;
        } else {
          lastError = `HTTP non-success response: ${response.status} ${response.statusText}`;
          attempts.push({
            attemptNumber: attempt + 1,
            statusCode: response.status,
            error: lastError,
            timestamp: new Date().toISOString(),
            durationMs,
          });

          // Check if error is permanent (e.g. 400 Bad Request, 401 Unauthorized, 404 Not Found)
          if (!this.isRetryableError(response.status)) {
            cb.recordFailure();
            break;
          }

          if (attempt < this.retryConfig.maxRetries) {
            const delay = this.calculateBackoffDelay(attempt);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - attemptStartTime;
        const errObj = err instanceof Error ? err : new Error(String(err));
        const isTimeout = errObj.name === 'AbortError' || errObj.message.toLowerCase().includes('abort');
        lastError = isTimeout
          ? `Request timeout after ${this.requestTimeoutMs}ms`
          : `Network error: ${errObj.message}`;

        attempts.push({
          attemptNumber: attempt + 1,
          error: lastError,
          timestamp: new Date().toISOString(),
          durationMs,
        });

        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!deliveredSuccess) {
      cb.recordFailure();
    }

    return {
      subscriberId: subscriber.id,
      url: subscriber.url,
      destinationType: destination,
      success: deliveredSuccess,
      attempts,
      circuitBreakerState: cb.getState(),
      error: deliveredSuccess ? undefined : lastError || 'Delivery failed',
    };
  }

  /**
   * Main dispatch entry point.
   * Matches subscribers by event subscription and enabled status,
   * then delivers payloads in parallel with complete failure isolation.
   */
  public async dispatch(
    event: TicketEventType,
    payload: Omit<WebhookEventPayload, 'event' | 'timestamp'> & { timestamp?: string }
  ): Promise<DispatchSummary> {
    const fullPayload: WebhookEventPayload = {
      event,
      timestamp: payload.timestamp || new Date().toISOString(),
      ticket: payload.ticket,
      details: payload.details,
    };

    const allSubscribers = Array.from(this.subscribers.values());
    const matchedSubscribers = allSubscribers.filter(
      (sub) => sub.enabled && sub.events.includes(event)
    );

    // Deliver concurrently to all matched subscribers with full failure isolation
    const deliveryPromises = matchedSubscribers.map(async (subscriber) => {
      try {
        return await this.deliverToSubscriber(subscriber, fullPayload);
      } catch (err: unknown) {
        // Defensive catch to ensure Promise.all never rejects
        const message = err instanceof Error ? err.message : String(err);
        return {
          subscriberId: subscriber.id,
          url: subscriber.url,
          destinationType: subscriber.destinationType || 'generic',
          success: false,
          attempts: [],
          circuitBreakerState: this.getCircuitBreaker(subscriber.id).getState(),
          error: `Unexpected isolation error: ${message}`,
        };
      }
    });

    const results = await Promise.all(deliveryPromises);

    return {
      event,
      dispatchedAt: new Date().toISOString(),
      totalSubscribers: allSubscribers.length,
      matchedSubscribers: matchedSubscribers.length,
      results,
    };
  }
}
