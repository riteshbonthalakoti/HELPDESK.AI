/**
 * CSATAggregator - Automated Customer Satisfaction (CSAT) score aggregator
 * and support agent performance analytics engine.
 *
 * Implements CSAT %, Net Promoter Score (NPS), First Contact Resolution (FCR),
 * Average Resolution Time (ART), median response latency, agent workload distribution,
 * and escalation frequency calculations across categories and support engineers.
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export type RatingValue = 1 | 2 | 3 | 4 | 5;

export interface CSATSurveyFeedback {
  id?: string;
  ticketId: string;
  agentId: string;
  category: string;
  rating: RatingValue | number; // 1 to 5 star rating
  commentary?: string;
  firstContactResolved?: boolean;
  resolutionTimeMs?: number; // Total resolution time in milliseconds
  responseLatencyMs?: number; // First response or median response latency in milliseconds
  escalated?: boolean;
  timestamp: string | Date;
  metadata?: Record<string, unknown>;
}

export interface MetricFilterOptions {
  agentId?: string;
  category?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  minRating?: number;
  maxRating?: number;
  escalatedOnly?: boolean;
  firstContactResolvedOnly?: boolean;
}

export interface CSATScoreMetrics {
  totalResponses: number;
  positiveResponses: number; // ratings 4 or 5
  neutralResponses: number;  // rating 3
  negativeResponses: number; // ratings 1 or 2
  csatPercentage: number;    // (positive / total) * 100 rounded to 2 decimals
  averageRating: number;     // mean rating 1.00 - 5.00
  ratingDistribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export interface NPSMetrics {
  totalResponses: number;
  promoters: number; // ratings 5 (or 4-5 if configured, standard 5-star NPS: 5 = promoter, 4 = passive, 1-3 = detractor)
  passives: number;  // rating 4
  detractors: number; // ratings 1, 2, 3
  npsScore: number;  // % Promoters - % Detractors, range -100 to +100
}

export interface AgentPerformanceMetrics {
  agentId: string;
  totalTickets: number;
  csatMetrics: CSATScoreMetrics;
  npsMetrics: NPSMetrics;
  fcrRatePercentage: number;      // First Contact Resolution rate %
  averageResolutionTimeMs: number; // ART in ms
  averageResolutionTimeFormatted: string; // e.g. "2h 30m" or "45m"
  medianResponseLatencyMs: number; // Median latency in ms
  medianResponseLatencyFormatted: string;
  escalationCount: number;
  escalationFrequencyPercentage: number; // (escalations / totalTickets) * 100
  workloadSharePercentage: number;       // (agentTickets / totalEngineTickets) * 100
  categoriesHandled: string[];
}

export interface CategoryPerformanceMetrics {
  category: string;
  totalTickets: number;
  csatMetrics: CSATScoreMetrics;
  npsMetrics: NPSMetrics;
  fcrRatePercentage: number;
  averageResolutionTimeMs: number;
  averageResolutionTimeFormatted: string;
  medianResponseLatencyMs: number;
  medianResponseLatencyFormatted: string;
  escalationFrequencyPercentage: number;
  agentsInvolved: string[];
}

export interface ExecutiveDashboardSummary {
  period: {
    startDate?: string;
    endDate?: string;
    generatedAt: string;
  };
  overallCSAT: CSATScoreMetrics;
  overallNPS: NPSMetrics;
  totalTicketsAnalyzed: number;
  overallFCRPercentage: number;
  overallAverageResolutionTimeMs: number;
  overallAverageResolutionTimeFormatted: string;
  overallMedianResponseLatencyMs: number;
  overallMedianResponseLatencyFormatted: string;
  overallEscalationFrequencyPercentage: number;
  totalEscalations: number;
  agentWorkloadDistribution: Record<string, { ticketCount: number; percentage: number }>;
  topPerformingAgents: { agentId: string; csatPercentage: number; totalTickets: number }[];
  underperformingAgents: { agentId: string; csatPercentage: number; totalTickets: number }[];
  categoryBreakdown: Record<string, CategoryPerformanceMetrics>;
}

// ============================================================================
// Helper Utilities
// ============================================================================

/**
 * Format milliseconds into a human-readable duration string.
 * Example: 3720000 ms -> "1h 2m" or "45s" or "0m"
 */
export function formatDuration(ms: number): string {
  if (isNaN(ms) || ms <= 0) return '0m';

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 && seconds > 0) parts.push(`${seconds}s`);

  return parts.length > 0 ? parts.join(' ') : '0m';
}

/**
 * Calculates the median of an array of numbers.
 */
export function calculateMedian(numbers: number[]): number {
  if (!numbers || numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
  }
  return sorted[middle];
}

/**
 * Validates a single feedback record.
 */
export function validateFeedback(feedback: unknown): feedback is CSATSurveyFeedback {
  if (!feedback || typeof feedback !== 'object') {
    throw new TypeError('Feedback record must be a non-null object');
  }

  const fb = feedback as Partial<CSATSurveyFeedback>;

  if (typeof fb.ticketId !== 'string' || fb.ticketId.trim() === '') {
    throw new Error('Feedback must contain a valid non-empty ticketId');
  }
  if (typeof fb.agentId !== 'string' || fb.agentId.trim() === '') {
    throw new Error('Feedback must contain a valid non-empty agentId');
  }
  if (typeof fb.category !== 'string' || fb.category.trim() === '') {
    throw new Error('Feedback must contain a valid non-empty category');
  }

  const rating = Number(fb.rating);
  if (isNaN(rating) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new RangeError(`Rating must be an integer between 1 and 5 (received: ${fb.rating})`);
  }

  if (fb.timestamp === undefined || fb.timestamp === null) {
    throw new Error('Feedback must contain a timestamp');
  }

  const ts = new Date(fb.timestamp);
  if (isNaN(ts.getTime())) {
    throw new Error(`Invalid timestamp format: ${fb.timestamp}`);
  }

  if (fb.resolutionTimeMs !== undefined && (typeof fb.resolutionTimeMs !== 'number' || fb.resolutionTimeMs < 0)) {
    throw new RangeError('resolutionTimeMs must be a non-negative number');
  }

  if (fb.responseLatencyMs !== undefined && (typeof fb.responseLatencyMs !== 'number' || fb.responseLatencyMs < 0)) {
    throw new RangeError('responseLatencyMs must be a non-negative number');
  }

  return true;
}

// ============================================================================
// CSATAggregator Class
// ============================================================================

export class CSATAggregator {
  private feedbackRecords: CSATSurveyFeedback[] = [];

  constructor(initialRecords: CSATSurveyFeedback[] = []) {
    if (initialRecords.length > 0) {
      this.ingestBatch(initialRecords);
    }
  }

  /**
   * Ingest a single survey feedback response with validation.
   */
  public ingestFeedback(feedback: CSATSurveyFeedback): void {
    validateFeedback(feedback);
    const sanitized: CSATSurveyFeedback = {
      ...feedback,
      ticketId: feedback.ticketId.trim(),
      agentId: feedback.agentId.trim(),
      category: feedback.category.trim(),
      rating: Number(feedback.rating) as RatingValue,
      commentary: feedback.commentary ? feedback.commentary.trim() : '',
      firstContactResolved: Boolean(feedback.firstContactResolved),
      escalated: Boolean(feedback.escalated),
      resolutionTimeMs: feedback.resolutionTimeMs !== undefined ? feedback.resolutionTimeMs : 0,
      responseLatencyMs: feedback.responseLatencyMs !== undefined ? feedback.responseLatencyMs : 0,
      timestamp: new Date(feedback.timestamp),
    };
    this.feedbackRecords.push(sanitized);
  }

  /**
   * Ingest multiple survey feedback responses. Skips or throws depending on strict flag.
   */
  public ingestBatch(feedbacks: CSATSurveyFeedback[], strict = true): { ingested: number; failed: number } {
    let ingested = 0;
    let failed = 0;

    for (const fb of feedbacks) {
      try {
        this.ingestFeedback(fb);
        ingested++;
      } catch (err) {
        if (strict) {
          throw err;
        }
        failed++;
      }
    }

    return { ingested, failed };
  }

  /**
   * Retrieve all currently ingested feedback records.
   */
  public getFeedbacks(): CSATSurveyFeedback[] {
    return [...this.feedbackRecords];
  }

  /**
   * Clear all stored feedback records.
   */
  public clear(): void {
    this.feedbackRecords = [];
  }

  /**
   * Total count of ingested feedback items.
   */
  public get count(): number {
    return this.feedbackRecords.length;
  }

  /**
   * Filter records based on optional criteria.
   */
  public filterFeedbacks(filters: MetricFilterOptions = {}, records: CSATSurveyFeedback[] = this.feedbackRecords): CSATSurveyFeedback[] {
    return records.filter((item) => {
      if (filters.agentId && item.agentId.toLowerCase() !== filters.agentId.trim().toLowerCase()) {
        return false;
      }
      if (filters.category && item.category.toLowerCase() !== filters.category.trim().toLowerCase()) {
        return false;
      }
      if (filters.minRating !== undefined && item.rating < filters.minRating) {
        return false;
      }
      if (filters.maxRating !== undefined && item.rating > filters.maxRating) {
        return false;
      }
      if (filters.escalatedOnly && !item.escalated) {
        return false;
      }
      if (filters.firstContactResolvedOnly && !item.firstContactResolved) {
        return false;
      }
      if (filters.startDate) {
        const itemDate = new Date(item.timestamp).getTime();
        const start = new Date(filters.startDate).getTime();
        if (itemDate < start) return false;
      }
      if (filters.endDate) {
        const itemDate = new Date(item.timestamp).getTime();
        const end = new Date(filters.endDate).getTime();
        if (itemDate > end) return false;
      }
      return true;
    });
  }

  // ==========================================================================
  // Core Metric Calculations
  // ==========================================================================

  /**
   * Compute CSAT Metrics:
   * Positive Ratings = [4, 5]
   * CSAT % = (Positive Ratings / Total Responses) * 100
   */
  public computeCSAT(records: CSATSurveyFeedback[] = this.feedbackRecords): CSATScoreMetrics {
    const totalResponses = records.length;
    if (totalResponses === 0) {
      return {
        totalResponses: 0,
        positiveResponses: 0,
        neutralResponses: 0,
        negativeResponses: 0,
        csatPercentage: 0,
        averageRating: 0,
        ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      };
    }

    let positiveCount = 0;
    let neutralCount = 0;
    let negativeCount = 0;
    let sumRating = 0;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const item of records) {
      const r = item.rating as 1 | 2 | 3 | 4 | 5;
      sumRating += r;
      if (distribution[r] !== undefined) {
        distribution[r]++;
      }
      if (r >= 4) {
        positiveCount++;
      } else if (r === 3) {
        neutralCount++;
      } else {
        negativeCount++;
      }
    }

    const csatPercentage = Math.round((positiveCount / totalResponses) * 10000) / 100;
    const averageRating = Math.round((sumRating / totalResponses) * 100) / 100;

    return {
      totalResponses,
      positiveResponses: positiveCount,
      neutralResponses: neutralCount,
      negativeResponses: negativeCount,
      csatPercentage,
      averageRating,
      ratingDistribution: distribution,
    };
  }

  /**
   * Compute Net Promoter Score (NPS) on a 5-point scale:
   * Promoters: 5
   * Passives: 4
   * Detractors: 1, 2, 3
   * NPS = % Promoters - % Detractors (ranges from -100 to +100)
   */
  public computeNPS(records: CSATSurveyFeedback[] = this.feedbackRecords): NPSMetrics {
    const totalResponses = records.length;
    if (totalResponses === 0) {
      return {
        totalResponses: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        npsScore: 0,
      };
    }

    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    for (const item of records) {
      if (item.rating === 5) {
        promoters++;
      } else if (item.rating === 4) {
        passives++;
      } else {
        detractors++;
      }
    }

    const promoterPct = (promoters / totalResponses) * 100;
    const detractorPct = (detractors / totalResponses) * 100;
    const npsScore = Math.round((promoterPct - detractorPct) * 100) / 100;

    return {
      totalResponses,
      promoters,
      passives,
      detractors,
      npsScore,
    };
  }

  /**
   * Compute First Contact Resolution (FCR) rate percentage.
   * FCR % = (First contact resolved tickets / Total tickets) * 100
   */
  public computeFCR(records: CSATSurveyFeedback[] = this.feedbackRecords): number {
    if (records.length === 0) return 0;
    const fcrCount = records.filter((r) => r.firstContactResolved).length;
    return Math.round((fcrCount / records.length) * 10000) / 100;
  }

  /**
   * Compute Average Resolution Time (ART) in milliseconds.
   */
  public computeART(records: CSATSurveyFeedback[] = this.feedbackRecords): number {
    const validTimes = records
      .map((r) => r.resolutionTimeMs)
      .filter((t): t is number => typeof t === 'number' && t > 0);

    if (validTimes.length === 0) return 0;
    const total = validTimes.reduce((acc, curr) => acc + curr, 0);
    return Math.round((total / validTimes.length) * 100) / 100;
  }

  /**
   * Compute Median Response Latency in milliseconds.
   */
  public computeMedianResponseLatency(records: CSATSurveyFeedback[] = this.feedbackRecords): number {
    const latencies = records
      .map((r) => r.responseLatencyMs)
      .filter((l): l is number => typeof l === 'number' && l >= 0);

    return calculateMedian(latencies);
  }

  /**
   * Compute Escalation Frequency percentage.
   */
  public computeEscalationFrequency(records: CSATSurveyFeedback[] = this.feedbackRecords): number {
    if (records.length === 0) return 0;
    const escalatedCount = records.filter((r) => r.escalated).length;
    return Math.round((escalatedCount / records.length) * 10000) / 100;
  }

  /**
   * Compute Workload Distribution across all agents.
   * Returns a map of agentId -> { count, percentage }
   */
  public computeWorkloadDistribution(
    records: CSATSurveyFeedback[] = this.feedbackRecords
  ): Record<string, { ticketCount: number; percentage: number }> {
    const total = records.length;
    const distribution: Record<string, { ticketCount: number; percentage: number }> = {};
    if (total === 0) return distribution;

    const counts: Record<string, number> = {};
    for (const item of records) {
      counts[item.agentId] = (counts[item.agentId] || 0) + 1;
    }

    for (const [agentId, count] of Object.entries(counts)) {
      distribution[agentId] = {
        ticketCount: count,
        percentage: Math.round((count / total) * 10000) / 100,
      };
    }

    return distribution;
  }

  // ==========================================================================
  // Agent & Category Metrics
  // ==========================================================================

  /**
   * Get detailed performance metrics for a specific agent.
   */
  public getAgentPerformance(agentId: string, records: CSATSurveyFeedback[] = this.feedbackRecords): AgentPerformanceMetrics {
    const agentRecords = records.filter((r) => r.agentId.toLowerCase() === agentId.trim().toLowerCase());
    const totalTickets = agentRecords.length;
    const totalEngineTickets = records.length;

    const csatMetrics = this.computeCSAT(agentRecords);
    const npsMetrics = this.computeNPS(agentRecords);
    const fcrRatePercentage = this.computeFCR(agentRecords);
    const averageResolutionTimeMs = this.computeART(agentRecords);
    const medianResponseLatencyMs = this.computeMedianResponseLatency(agentRecords);
    const escalationCount = agentRecords.filter((r) => r.escalated).length;
    const escalationFrequencyPercentage = this.computeEscalationFrequency(agentRecords);
    const workloadSharePercentage = totalEngineTickets > 0
      ? Math.round((totalTickets / totalEngineTickets) * 10000) / 100
      : 0;

    const categoriesHandled = Array.from(new Set(agentRecords.map((r) => r.category)));

    return {
      agentId,
      totalTickets,
      csatMetrics,
      npsMetrics,
      fcrRatePercentage,
      averageResolutionTimeMs,
      averageResolutionTimeFormatted: formatDuration(averageResolutionTimeMs),
      medianResponseLatencyMs,
      medianResponseLatencyFormatted: formatDuration(medianResponseLatencyMs),
      escalationCount,
      escalationFrequencyPercentage,
      workloadSharePercentage,
      categoriesHandled,
    };
  }

  /**
   * Get performance metrics for all unique agents.
   */
  public getAllAgentsPerformance(records: CSATSurveyFeedback[] = this.feedbackRecords): AgentPerformanceMetrics[] {
    const uniqueAgentIds = Array.from(new Set(records.map((r) => r.agentId)));
    return uniqueAgentIds.map((id) => this.getAgentPerformance(id, records));
  }

  /**
   * Get category-level performance metrics.
   */
  public getCategoryPerformance(category: string, records: CSATSurveyFeedback[] = this.feedbackRecords): CategoryPerformanceMetrics {
    const catRecords = records.filter((r) => r.category.toLowerCase() === category.trim().toLowerCase());
    const totalTickets = catRecords.length;

    const csatMetrics = this.computeCSAT(catRecords);
    const npsMetrics = this.computeNPS(catRecords);
    const fcrRatePercentage = this.computeFCR(catRecords);
    const averageResolutionTimeMs = this.computeART(catRecords);
    const medianResponseLatencyMs = this.computeMedianResponseLatency(catRecords);
    const escalationFrequencyPercentage = this.computeEscalationFrequency(catRecords);
    const agentsInvolved = Array.from(new Set(catRecords.map((r) => r.agentId)));

    return {
      category,
      totalTickets,
      csatMetrics,
      npsMetrics,
      fcrRatePercentage,
      averageResolutionTimeMs,
      averageResolutionTimeFormatted: formatDuration(averageResolutionTimeMs),
      medianResponseLatencyMs,
      medianResponseLatencyFormatted: formatDuration(medianResponseLatencyMs),
      escalationFrequencyPercentage,
      agentsInvolved,
    };
  }

  /**
   * Get performance metrics for all categories.
   */
  public getAllCategoriesPerformance(records: CSATSurveyFeedback[] = this.feedbackRecords): CategoryPerformanceMetrics[] {
    const uniqueCategories = Array.from(new Set(records.map((r) => r.category)));
    return uniqueCategories.map((cat) => this.getCategoryPerformance(cat, records));
  }

  // ==========================================================================
  // Executive Dashboard & Reporting
  // ==========================================================================

  /**
   * Generate an executive dashboard aggregate summary.
   */
  public getExecutiveDashboard(filters: MetricFilterOptions = {}): ExecutiveDashboardSummary {
    const filteredRecords = this.filterFeedbacks(filters);
    const totalTicketsAnalyzed = filteredRecords.length;

    const overallCSAT = this.computeCSAT(filteredRecords);
    const overallNPS = this.computeNPS(filteredRecords);
    const overallFCRPercentage = this.computeFCR(filteredRecords);
    const overallAverageResolutionTimeMs = this.computeART(filteredRecords);
    const overallMedianResponseLatencyMs = this.computeMedianResponseLatency(filteredRecords);
    const overallEscalationFrequencyPercentage = this.computeEscalationFrequency(filteredRecords);
    const totalEscalations = filteredRecords.filter((r) => r.escalated).length;
    const agentWorkloadDistribution = this.computeWorkloadDistribution(filteredRecords);

    const allAgents = this.getAllAgentsPerformance(filteredRecords);

    // Top and underperforming agents sorted by CSAT % (with at least 1 ticket)
    const sortedAgents = [...allAgents].sort((a, b) => b.csatMetrics.csatPercentage - a.csatMetrics.csatPercentage);

    const topPerformingAgents = sortedAgents
      .slice(0, 5)
      .map((a) => ({
        agentId: a.agentId,
        csatPercentage: a.csatMetrics.csatPercentage,
        totalTickets: a.totalTickets,
      }));

    const underperformingAgents = [...sortedAgents]
      .reverse()
      .slice(0, 5)
      .map((a) => ({
        agentId: a.agentId,
        csatPercentage: a.csatMetrics.csatPercentage,
        totalTickets: a.totalTickets,
      }));

    const categoryBreakdown: Record<string, CategoryPerformanceMetrics> = {};
    const categories = this.getAllCategoriesPerformance(filteredRecords);
    for (const cat of categories) {
      categoryBreakdown[cat.category] = cat;
    }

    return {
      period: {
        startDate: filters.startDate ? new Date(filters.startDate).toISOString() : undefined,
        endDate: filters.endDate ? new Date(filters.endDate).toISOString() : undefined,
        generatedAt: new Date().toISOString(),
      },
      overallCSAT,
      overallNPS,
      totalTicketsAnalyzed,
      overallFCRPercentage,
      overallAverageResolutionTimeMs,
      overallAverageResolutionTimeFormatted: formatDuration(overallAverageResolutionTimeMs),
      overallMedianResponseLatencyMs,
      overallMedianResponseLatencyFormatted: formatDuration(overallMedianResponseLatencyMs),
      overallEscalationFrequencyPercentage,
      totalEscalations,
      agentWorkloadDistribution,
      topPerformingAgents,
      underperformingAgents,
      categoryBreakdown,
    };
  }

  // ==========================================================================
  // CSV Export
  // ==========================================================================

  /**
   * Escape CSV values safely following RFC 4180.
   */
  private escapeCsvValue(val: unknown): string {
    if (val === undefined || val === null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Export feedback records to a standardized CSV format.
   */
  public exportRawFeedbackCSV(filters: MetricFilterOptions = {}): string {
    const records = this.filterFeedbacks(filters);
    const headers = [
      'Ticket ID',
      'Agent ID',
      'Category',
      'Rating',
      'First Contact Resolved',
      'Resolution Time (ms)',
      'Response Latency (ms)',
      'Escalated',
      'Timestamp',
      'Commentary',
    ];

    const rows = records.map((r) => [
      this.escapeCsvValue(r.ticketId),
      this.escapeCsvValue(r.agentId),
      this.escapeCsvValue(r.category),
      this.escapeCsvValue(r.rating),
      this.escapeCsvValue(r.firstContactResolved ? 'true' : 'false'),
      this.escapeCsvValue(r.resolutionTimeMs ?? 0),
      this.escapeCsvValue(r.responseLatencyMs ?? 0),
      this.escapeCsvValue(r.escalated ? 'true' : 'false'),
      this.escapeCsvValue(new Date(r.timestamp).toISOString()),
      this.escapeCsvValue(r.commentary ?? ''),
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
  }

  /**
   * Export aggregate agent performance metrics to CSV format.
   */
  public exportAgentPerformanceCSV(filters: MetricFilterOptions = {}): string {
    const filteredRecords = this.filterFeedbacks(filters);
    const agents = this.getAllAgentsPerformance(filteredRecords);

    const headers = [
      'Agent ID',
      'Total Tickets',
      'Workload Share %',
      'CSAT %',
      'Average Rating',
      'NPS Score',
      'FCR Rate %',
      'Average Resolution Time (ms)',
      'ART Formatted',
      'Median Response Latency (ms)',
      'Latency Formatted',
      'Escalation Count',
      'Escalation Frequency %',
      'Categories Handled',
    ];

    const rows = agents.map((a) => [
      this.escapeCsvValue(a.agentId),
      this.escapeCsvValue(a.totalTickets),
      this.escapeCsvValue(a.workloadSharePercentage.toFixed(2)),
      this.escapeCsvValue(a.csatMetrics.csatPercentage.toFixed(2)),
      this.escapeCsvValue(a.csatMetrics.averageRating.toFixed(2)),
      this.escapeCsvValue(a.npsMetrics.npsScore.toFixed(2)),
      this.escapeCsvValue(a.fcrRatePercentage.toFixed(2)),
      this.escapeCsvValue(a.averageResolutionTimeMs.toFixed(0)),
      this.escapeCsvValue(a.averageResolutionTimeFormatted),
      this.escapeCsvValue(a.medianResponseLatencyMs.toFixed(0)),
      this.escapeCsvValue(a.medianResponseLatencyFormatted),
      this.escapeCsvValue(a.escalationCount),
      this.escapeCsvValue(a.escalationFrequencyPercentage.toFixed(2)),
      this.escapeCsvValue(a.categoriesHandled.join('; ')),
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
  }

  /**
   * Export aggregate category performance metrics to CSV format.
   */
  public exportCategoryPerformanceCSV(filters: MetricFilterOptions = {}): string {
    const filteredRecords = this.filterFeedbacks(filters);
    const categories = this.getAllCategoriesPerformance(filteredRecords);

    const headers = [
      'Category',
      'Total Tickets',
      'CSAT %',
      'Average Rating',
      'NPS Score',
      'FCR Rate %',
      'Average Resolution Time (ms)',
      'ART Formatted',
      'Median Response Latency (ms)',
      'Latency Formatted',
      'Escalation Frequency %',
      'Agents Count',
    ];

    const rows = categories.map((c) => [
      this.escapeCsvValue(c.category),
      this.escapeCsvValue(c.totalTickets),
      this.escapeCsvValue(c.csatMetrics.csatPercentage.toFixed(2)),
      this.escapeCsvValue(c.csatMetrics.averageRating.toFixed(2)),
      this.escapeCsvValue(c.npsMetrics.npsScore.toFixed(2)),
      this.escapeCsvValue(c.fcrRatePercentage.toFixed(2)),
      this.escapeCsvValue(c.averageResolutionTimeMs.toFixed(0)),
      this.escapeCsvValue(c.averageResolutionTimeFormatted),
      this.escapeCsvValue(c.medianResponseLatencyMs.toFixed(0)),
      this.escapeCsvValue(c.medianResponseLatencyFormatted),
      this.escapeCsvValue(c.escalationFrequencyPercentage.toFixed(2)),
      this.escapeCsvValue(c.agentsInvolved.length),
    ]);

    return [headers.join(','), ...rows.map((row) => row.join(','))].join('\r\n');
  }
}
