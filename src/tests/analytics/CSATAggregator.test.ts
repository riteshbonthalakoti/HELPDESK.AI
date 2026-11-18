import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  CSATAggregator,
  validateFeedback,
  calculateMedian,
  formatDuration,
  type CSATSurveyFeedback,
} from '../../core/analytics/CSATAggregator.ts';

// ============================================================================
// Sample Test Data Fixtures
// ============================================================================

const sampleFeedbacks: CSATSurveyFeedback[] = [
  {
    ticketId: 'TICK-101',
    agentId: 'agent_alice',
    category: 'Billing',
    rating: 5,
    commentary: 'Super quick resolution, very courteous!',
    firstContactResolved: true,
    resolutionTimeMs: 1800000, // 30m
    responseLatencyMs: 120000, // 2m
    escalated: false,
    timestamp: '2026-11-17T10:00:00.000Z',
  },
  {
    ticketId: 'TICK-102',
    agentId: 'agent_alice',
    category: 'Billing',
    rating: 4,
    commentary: 'Good assistance with invoice dispute.',
    firstContactResolved: true,
    resolutionTimeMs: 3600000, // 1h
    responseLatencyMs: 300000, // 5m
    escalated: false,
    timestamp: '2026-11-17T11:00:00.000Z',
  },
  {
    ticketId: 'TICK-103',
    agentId: 'agent_bob',
    category: 'Technical Support',
    rating: 5,
    commentary: 'Fixed my server crash immediately.',
    firstContactResolved: false,
    resolutionTimeMs: 7200000, // 2h
    responseLatencyMs: 600000, // 10m
    escalated: false,
    timestamp: '2026-11-17T12:00:00.000Z',
  },
  {
    ticketId: 'TICK-104',
    agentId: 'agent_bob',
    category: 'Technical Support',
    rating: 2,
    commentary: 'Took too many handoffs and took all day.',
    firstContactResolved: false,
    resolutionTimeMs: 14400000, // 4h
    responseLatencyMs: 900000, // 15m
    escalated: true,
    timestamp: '2026-11-17T13:00:00.000Z',
  },
  {
    ticketId: 'TICK-105',
    agentId: 'agent_charlie',
    category: 'Security',
    rating: 3,
    commentary: 'Average support experience.',
    firstContactResolved: false,
    resolutionTimeMs: 5400000, // 1.5h
    responseLatencyMs: 180000, // 3m
    escalated: true,
    timestamp: '2026-11-17T14:00:00.000Z',
  },
];

describe('CSATAggregator & Agent Performance Analytics Test Suite', () => {
  let aggregator: CSATAggregator;

  beforeEach(() => {
    aggregator = new CSATAggregator();
  });

  // --------------------------------------------------------------------------
  // Helper Utilities Tests
  // --------------------------------------------------------------------------
  describe('Helper Utilities', () => {
    it('formatDuration formats ms into human-readable duration strings', () => {
      assert.strictEqual(formatDuration(0), '0m');
      assert.strictEqual(formatDuration(-500), '0m');
      assert.strictEqual(formatDuration(45000), '45s');
      assert.strictEqual(formatDuration(120000), '2m');
      assert.strictEqual(formatDuration(3600000), '1h');
      assert.strictEqual(formatDuration(3660000), '1h 1m');
      assert.strictEqual(formatDuration(90000000), '1d 1h');
      assert.strictEqual(formatDuration(NaN), '0m');
      assert.strictEqual(formatDuration(Infinity), '0m');
    });

    it('calculateMedian correctly computes median for odd and even length arrays', () => {
      assert.strictEqual(calculateMedian([]), 0);
      assert.strictEqual(calculateMedian([10]), 10);
      assert.strictEqual(calculateMedian([10, 20, 30]), 20);
      assert.strictEqual(calculateMedian([30, 10, 20]), 20); // unsorted
      assert.strictEqual(calculateMedian([10, 20, 30, 40]), 25); // even length
    });
  });

  // --------------------------------------------------------------------------
  // Validation & Ingestion Tests
  // --------------------------------------------------------------------------
  describe('Validation & Ingestion', () => {
    it('validates and ingests valid survey feedback records', () => {
      aggregator.ingestFeedback(sampleFeedbacks[0]);
      assert.strictEqual(aggregator.count, 1);
      const records = aggregator.getFeedbacks();
      assert.strictEqual(records[0].ticketId, 'TICK-101');
      assert.strictEqual(records[0].rating, 5);
    });

    it('rejects feedback with missing or invalid ticketId', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], ticketId: '' }),
        /valid non-empty ticketId/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], ticketId: '   ' }),
        /valid non-empty ticketId/
      );
    });

    it('rejects feedback with missing or invalid agentId', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], agentId: '' }),
        /valid non-empty agentId/
      );
    });

    it('rejects feedback with missing or invalid category', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], category: '' }),
        /valid non-empty category/
      );
    });

    it('rejects out of range or non-integer ratings', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], rating: 0 as any }),
        /Rating must be an integer between 1 and 5/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], rating: 6 as any }),
        /Rating must be an integer between 1 and 5/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], rating: 3.5 as any }),
        /Rating must be an integer between 1 and 5/
      );
    });

    it('rejects string ratings like "5" and "4" to enforce strict numeric narrowing', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], rating: '5' as any }),
        /Rating must be an integer between 1 and 5/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], rating: '4' as any }),
        /Rating must be an integer between 1 and 5/
      );
    });

    it('rejects non-finite timing measurements (NaN, Infinity, -Infinity)', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], resolutionTimeMs: NaN }),
        /resolutionTimeMs must be a finite non-negative number/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], resolutionTimeMs: Infinity }),
        /resolutionTimeMs must be a finite non-negative number/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], resolutionTimeMs: -Infinity }),
        /resolutionTimeMs must be a finite non-negative number/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], responseLatencyMs: NaN }),
        /responseLatencyMs must be a finite non-negative number/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], responseLatencyMs: Infinity }),
        /responseLatencyMs must be a finite non-negative number/
      );
    });

    it('rejects negative resolutionTimeMs or responseLatencyMs', () => {
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], resolutionTimeMs: -100 }),
        /resolutionTimeMs must be a finite non-negative number/
      );
      assert.throws(
        () => validateFeedback({ ...sampleFeedbacks[0], responseLatencyMs: -50 }),
        /responseLatencyMs must be a finite non-negative number/
      );
    });

    it('preserves zero and optional omitted durations', () => {
      const fbWithZero: CSATSurveyFeedback = {
        ...sampleFeedbacks[0],
        resolutionTimeMs: 0,
        responseLatencyMs: 0,
      };
      assert.strictEqual(validateFeedback(fbWithZero), true);

      const fbOmitted: CSATSurveyFeedback = {
        ticketId: 'TICK-OMIT',
        agentId: 'agent_alice',
        category: 'Billing',
        rating: 5,
        timestamp: new Date().toISOString(),
      };
      assert.strictEqual(validateFeedback(fbOmitted), true);
    });

    it('handles batch ingestion in both strict and permissive modes', () => {
      const invalidFeedback = { ...sampleFeedbacks[0], rating: 99 as any };
      // Strict mode throws
      assert.throws(() => {
        aggregator.ingestBatch([sampleFeedbacks[0], invalidFeedback as any], true);
      });

      // Permissive mode skips invalid and continues
      aggregator.clear();
      const res = aggregator.ingestBatch([sampleFeedbacks[0], invalidFeedback as any, sampleFeedbacks[1]], false);
      assert.strictEqual(res.ingested, 2);
      assert.strictEqual(res.failed, 1);
      assert.strictEqual(aggregator.count, 2);
    });

    it('initializes with constructor records and clears cleanly', () => {
      const agg = new CSATAggregator(sampleFeedbacks);
      assert.strictEqual(agg.count, 5);
      agg.clear();
      assert.strictEqual(agg.count, 0);
    });
  });

  // --------------------------------------------------------------------------
  // CSAT & NPS Calculations
  // --------------------------------------------------------------------------
  describe('CSAT & NPS Calculations', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('correctly calculates CSAT score percentage and distribution', () => {
      // 5 feedbacks: ratings: 5, 4, 5, 2, 3
      // Positive (4 or 5): 3 (TICK-101, 102, 103)
      // Neutral (3): 1 (TICK-105)
      // Negative (1 or 2): 1 (TICK-104)
      // CSAT % = (3 / 5) * 100 = 60.00%
      // Average rating = (5 + 4 + 5 + 2 + 3) / 5 = 19 / 5 = 3.8
      const csat = aggregator.computeCSAT();
      assert.strictEqual(csat.totalResponses, 5);
      assert.strictEqual(csat.positiveResponses, 3);
      assert.strictEqual(csat.neutralResponses, 1);
      assert.strictEqual(csat.negativeResponses, 1);
      assert.strictEqual(csat.csatPercentage, 60);
      assert.strictEqual(csat.averageRating, 3.8);
      assert.deepStrictEqual(csat.ratingDistribution, {
        1: 0,
        2: 1,
        3: 1,
        4: 1,
        5: 2,
      });
    });

    it('calculates averageRating of 4.5 and NPS of 50 for ratings 4 and 5', () => {
      const agg = new CSATAggregator([sampleFeedbacks[0], sampleFeedbacks[1]]); // ratings 5 and 4
      const csat = agg.computeCSAT();
      assert.strictEqual(csat.averageRating, 4.5);
      assert.strictEqual(csat.csatPercentage, 100);

      const nps = agg.computeNPS();
      // Promoters (5): 1 (50%), Passives (4): 1 (50%), Detractors: 0 (0%) -> NPS = 50 - 0 = 50
      assert.strictEqual(nps.npsScore, 50);
    });

    it('correctly computes Net Promoter Score (NPS)', () => {
      // Promoters (5): 2 (40%)
      // Passives (4): 1 (20%)
      // Detractors (1, 2, 3): 2 (40%)
      // NPS = 40% - 40% = 0.00
      const nps = aggregator.computeNPS();
      assert.strictEqual(nps.totalResponses, 5);
      assert.strictEqual(nps.promoters, 2);
      assert.strictEqual(nps.passives, 1);
      assert.strictEqual(nps.detractors, 2);
      assert.strictEqual(nps.npsScore, 0);
    });

    it('handles empty datasets safely for CSAT and NPS without NaN', () => {
      const emptyAgg = new CSATAggregator();
      const csat = emptyAgg.computeCSAT();
      assert.strictEqual(csat.totalResponses, 0);
      assert.strictEqual(csat.csatPercentage, 0);
      assert.strictEqual(csat.averageRating, 0);

      const nps = emptyAgg.computeNPS();
      assert.strictEqual(nps.totalResponses, 0);
      assert.strictEqual(nps.npsScore, 0);
    });
  });

  // --------------------------------------------------------------------------
  // Agent Performance & Timing Measurements Tests
  // --------------------------------------------------------------------------
  describe('Agent Performance & Timing Measurements', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('calculates First Contact Resolution (FCR) rate', () => {
      // Out of 5 tickets, TICK-101 and TICK-102 had firstContactResolved = true (2/5 = 40%)
      const fcr = aggregator.computeFCR();
      assert.strictEqual(fcr, 40);

      // Empty dataset
      assert.strictEqual(new CSATAggregator().computeFCR(), 0);
    });

    it('calculates Average Resolution Time (ART) including measured zero durations', () => {
      // Normal dataset: 1800000, 3600000, 7200000, 14400000, 5400000 -> Avg = 6,480,000 ms
      const art = aggregator.computeART();
      assert.strictEqual(art, 6480000);

      // Regression test for Finding 4: Resolution durations 0 and 60000 -> Expected ART: 30000 ms
      const aggZero = new CSATAggregator();
      aggZero.ingestBatch([
        {
          ticketId: 'T-Z1',
          agentId: 'a1',
          category: 'General',
          rating: 5,
          resolutionTimeMs: 0,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-Z2',
          agentId: 'a1',
          category: 'General',
          rating: 5,
          resolutionTimeMs: 60000,
          timestamp: new Date().toISOString(),
        },
      ]);
      assert.strictEqual(aggZero.computeART(), 30000);
    });

    it('preserves missing responseLatencyMs as undefined and excludes it from median calculation while including measured zeros', () => {
      // Regression test for Finding 3: One record with 60000 ms, one with omitted latency -> Expected median: 60000 ms
      const aggMissing = new CSATAggregator();
      aggMissing.ingestBatch([
        {
          ticketId: 'T-L1',
          agentId: 'a1',
          category: 'General',
          rating: 5,
          responseLatencyMs: 60000,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-L2',
          agentId: 'a1',
          category: 'General',
          rating: 5,
          // omitted responseLatencyMs
          timestamp: new Date().toISOString(),
        },
      ]);
      const ingested = aggMissing.getFeedbacks();
      assert.strictEqual(ingested[0].responseLatencyMs, 60000);
      assert.strictEqual(ingested[1].responseLatencyMs, undefined);
      assert.strictEqual(aggMissing.computeMedianResponseLatency(), 60000);

      // And a measured zero is genuinely included:
      aggMissing.ingestFeedback({
        ticketId: 'T-L3',
        agentId: 'a1',
        category: 'General',
        rating: 5,
        responseLatencyMs: 0,
        timestamp: new Date().toISOString(),
      });
      // values: [60000, 0] -> sorted [0, 60000] -> median 30000
      assert.strictEqual(aggMissing.computeMedianResponseLatency(), 30000);
    });

    it('calculates Escalation Frequency', () => {
      // TICK-104 and TICK-105 were escalated (2 / 5 = 40%)
      const esc = aggregator.computeEscalationFrequency();
      assert.strictEqual(esc, 40);
    });

    it('computes workload distribution across agents using prototype-free data structures', () => {
      const workload = aggregator.computeWorkloadDistribution();
      // Total 5 tickets:
      // alice: 2 (40%)
      // bob: 2 (40%)
      // charlie: 1 (20%)
      assert.strictEqual(workload['agent_alice'].ticketCount, 2);
      assert.strictEqual(workload['agent_alice'].percentage, 40);
      assert.strictEqual(workload['agent_bob'].ticketCount, 2);
      assert.strictEqual(workload['agent_bob'].percentage, 40);
      assert.strictEqual(workload['agent_charlie'].ticketCount, 1);
      assert.strictEqual(workload['agent_charlie'].percentage, 20);

      // Verify prototype-free dictionary
      assert.strictEqual(Object.getPrototypeOf(workload), null);
    });

    it('safely handles reserved agent IDs like __proto__, constructor, and toString', () => {
      // Regression test for Finding 5
      const aggProto = new CSATAggregator();
      aggProto.ingestBatch([
        { ticketId: 'T-1', agentId: '__proto__', category: 'General', rating: 5, timestamp: new Date().toISOString() },
        { ticketId: 'T-2', agentId: 'constructor', category: 'General', rating: 4, timestamp: new Date().toISOString() },
        { ticketId: 'T-3', agentId: 'toString', category: 'General', rating: 5, timestamp: new Date().toISOString() },
        { ticketId: 'T-4', agentId: 'regular_agent', category: 'General', rating: 5, timestamp: new Date().toISOString() },
      ]);

      const workload = aggProto.computeWorkloadDistribution();
      assert.strictEqual(workload['__proto__'].ticketCount, 1);
      assert.strictEqual(workload['__proto__'].percentage, 25);
      assert.strictEqual(workload['constructor'].ticketCount, 1);
      assert.strictEqual(workload['constructor'].percentage, 25);
      assert.strictEqual(workload['toString'].ticketCount, 1);
      assert.strictEqual(workload['toString'].percentage, 25);
      assert.strictEqual(workload['regular_agent'].ticketCount, 1);
      assert.strictEqual(workload['regular_agent'].percentage, 25);

      // Verify individual performance lookup
      const protoPerf = aggProto.getAgentPerformance('__proto__');
      assert.strictEqual(protoPerf.agentId, '__proto__');
      assert.strictEqual(protoPerf.totalTickets, 1);
      assert.strictEqual(protoPerf.csatMetrics.csatPercentage, 100);
    });

    it('performs consistent case-insensitive agent grouping without double counting', () => {
      // Regression test for Finding 6: Alice and alice produce 1 group, 2 tickets, 100% workload
      const aggCase = new CSATAggregator();
      aggCase.ingestBatch([
        { ticketId: 'T-A1', agentId: 'Alice', category: 'Billing', rating: 5, timestamp: new Date().toISOString() },
        { ticketId: 'T-A2', agentId: 'alice', category: 'Billing', rating: 4, timestamp: new Date().toISOString() },
      ]);

      const allAgents = aggCase.getAllAgentsPerformance();
      assert.strictEqual(allAgents.length, 1);
      assert.strictEqual(allAgents[0].totalTickets, 2);
      assert.strictEqual(allAgents[0].csatMetrics.csatPercentage, 100);
      assert.strictEqual(allAgents[0].workloadSharePercentage, 100);

      const workload = aggCase.computeWorkloadDistribution();
      const keys = Object.keys(workload);
      assert.strictEqual(keys.length, 1);
      assert.strictEqual(workload[keys[0]].ticketCount, 2);
      assert.strictEqual(workload[keys[0]].percentage, 100);
    });

    it('generates individual agent performance metrics accurately', () => {
      const alice = aggregator.getAgentPerformance('agent_alice');
      assert.strictEqual(alice.agentId, 'agent_alice');
      assert.strictEqual(alice.totalTickets, 2);
      assert.strictEqual(alice.csatMetrics.csatPercentage, 100); // 5 and 4 -> 100% positive
      assert.strictEqual(alice.fcrRatePercentage, 100);
      assert.strictEqual(alice.escalationCount, 0);
      assert.strictEqual(alice.escalationFrequencyPercentage, 0);
      assert.strictEqual(alice.workloadSharePercentage, 40);
      assert.deepStrictEqual(alice.categoriesHandled, ['Billing']);

      const bob = aggregator.getAgentPerformance('agent_bob');
      assert.strictEqual(bob.agentId, 'agent_bob');
      assert.strictEqual(bob.totalTickets, 2);
      assert.strictEqual(bob.csatMetrics.csatPercentage, 50); // 1 positive (5), 1 negative (2)
      assert.strictEqual(bob.escalationCount, 1);
      assert.strictEqual(bob.escalationFrequencyPercentage, 50);
    });

    it('aggregates performance for all agents', () => {
      const allAgents = aggregator.getAllAgentsPerformance();
      assert.strictEqual(allAgents.length, 3);
      const agentIds = allAgents.map((a) => a.agentId).sort();
      assert.deepStrictEqual(agentIds, ['agent_alice', 'agent_bob', 'agent_charlie']);
    });
  });

  // --------------------------------------------------------------------------
  // Category-level Analytics Tests
  // --------------------------------------------------------------------------
  describe('Category-level Analytics', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('calculates category-level metrics accurately', () => {
      const billing = aggregator.getCategoryPerformance('Billing');
      assert.strictEqual(billing.category, 'Billing');
      assert.strictEqual(billing.totalTickets, 2);
      assert.strictEqual(billing.csatMetrics.csatPercentage, 100);
      assert.strictEqual(billing.fcrRatePercentage, 100);
      assert.deepStrictEqual(billing.agentsInvolved, ['agent_alice']);

      const tech = aggregator.getCategoryPerformance('Technical Support');
      assert.strictEqual(tech.totalTickets, 2);
      assert.strictEqual(tech.csatMetrics.csatPercentage, 50);
      assert.strictEqual(tech.escalationFrequencyPercentage, 50);
    });

    it('performs consistent case-insensitive category grouping without double counting', () => {
      // Regression test for Finding 7: Billing and billing produce 1 group, 2 tickets
      const aggCatCase = new CSATAggregator();
      aggCatCase.ingestBatch([
        { ticketId: 'T-C1', agentId: 'a1', category: 'Billing', rating: 5, timestamp: new Date().toISOString() },
        { ticketId: 'T-C2', agentId: 'a2', category: 'billing', rating: 4, timestamp: new Date().toISOString() },
      ]);

      const allCats = aggCatCase.getAllCategoriesPerformance();
      assert.strictEqual(allCats.length, 1);
      assert.strictEqual(allCats[0].totalTickets, 2);
      assert.strictEqual(allCats[0].csatMetrics.csatPercentage, 100);
    });

    it('retrieves metrics for all categories', () => {
      const categories = aggregator.getAllCategoriesPerformance();
      assert.strictEqual(categories.length, 3);
      const names = categories.map((c) => c.category).sort();
      assert.deepStrictEqual(names, ['Billing', 'Security', 'Technical Support']);
    });
  });

  // --------------------------------------------------------------------------
  // Filtering & Querying Tests
  // --------------------------------------------------------------------------
  describe('Filtering & Querying', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('filters records by agentId and category case-insensitively', () => {
      const aliceFiltered = aggregator.filterFeedbacks({ agentId: 'AGENT_ALICE' });
      assert.strictEqual(aliceFiltered.length, 2);

      const securityFiltered = aggregator.filterFeedbacks({ category: 'security' });
      assert.strictEqual(securityFiltered.length, 1);
      assert.strictEqual(securityFiltered[0].agentId, 'agent_charlie');
    });

    it('filters records by rating range', () => {
      const highRatings = aggregator.filterFeedbacks({ minRating: 4 });
      assert.strictEqual(highRatings.length, 3);

      const lowRatings = aggregator.filterFeedbacks({ maxRating: 2 });
      assert.strictEqual(lowRatings.length, 1);
      assert.strictEqual(lowRatings[0].ticketId, 'TICK-104');
    });

    it('filters records by escalation and FCR flags', () => {
      const escalatedOnly = aggregator.filterFeedbacks({ escalatedOnly: true });
      assert.strictEqual(escalatedOnly.length, 2);

      const fcrOnly = aggregator.filterFeedbacks({ firstContactResolvedOnly: true });
      assert.strictEqual(fcrOnly.length, 2);
    });

    it('filters records by date range', () => {
      const dateFiltered = aggregator.filterFeedbacks({
        startDate: '2026-11-17T11:30:00.000Z',
        endDate: '2026-11-17T13:30:00.000Z',
      });
      // TICK-103 (12:00) and TICK-104 (13:00)
      assert.strictEqual(dateFiltered.length, 2);
      assert.strictEqual(dateFiltered[0].ticketId, 'TICK-103');
      assert.strictEqual(dateFiltered[1].ticketId, 'TICK-104');
    });
  });

  // --------------------------------------------------------------------------
  // Executive Dashboard & Summary Tests
  // --------------------------------------------------------------------------
  describe('Executive Dashboard', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('generates a complete executive dashboard summary', () => {
      const dashboard = aggregator.getExecutiveDashboard();
      assert.strictEqual(dashboard.totalTicketsAnalyzed, 5);
      assert.strictEqual(dashboard.overallCSAT.csatPercentage, 60);
      assert.strictEqual(dashboard.overallNPS.npsScore, 0);
      assert.strictEqual(dashboard.overallFCRPercentage, 40);
      assert.strictEqual(dashboard.totalEscalations, 2);
      assert.strictEqual(dashboard.overallEscalationFrequencyPercentage, 40);

      // Verify top performing agent is Alice (100% CSAT)
      assert.strictEqual(dashboard.topPerformingAgents[0].agentId, 'agent_alice');
      assert.strictEqual(dashboard.topPerformingAgents[0].csatPercentage, 100);

      // Verify categories in breakdown
      assert.ok('Billing' in dashboard.categoryBreakdown);
      assert.ok('Technical Support' in dashboard.categoryBreakdown);
      assert.ok('Security' in dashboard.categoryBreakdown);
    });

    it('safely handles reserved category names like __proto__ and constructor in categoryBreakdown', () => {
      // Regression test for Finding 8
      const aggProtoCat = new CSATAggregator();
      aggProtoCat.ingestBatch([
        { ticketId: 'T-P1', agentId: 'a1', category: '__proto__', rating: 5, timestamp: new Date().toISOString() },
        { ticketId: 'T-P2', agentId: 'a1', category: 'constructor', rating: 4, timestamp: new Date().toISOString() },
        { ticketId: 'T-P3', agentId: 'a1', category: 'Standard', rating: 5, timestamp: new Date().toISOString() },
      ]);

      const dashboard = aggProtoCat.getExecutiveDashboard();
      assert.strictEqual(Object.getPrototypeOf(dashboard.categoryBreakdown), null);
      assert.ok(Object.prototype.hasOwnProperty.call(dashboard.categoryBreakdown, '__proto__'));
      assert.strictEqual(dashboard.categoryBreakdown['__proto__'].totalTickets, 1);
      assert.strictEqual(dashboard.categoryBreakdown['__proto__'].csatMetrics.csatPercentage, 100);
      assert.strictEqual(dashboard.categoryBreakdown['constructor'].totalTickets, 1);
      assert.strictEqual(dashboard.categoryBreakdown['Standard'].totalTickets, 1);

      // Ensure JSON serialization behaves safely without error
      const jsonStr = JSON.stringify(dashboard);
      assert.ok(jsonStr.includes('__proto__'));
    });

    it('handles empty datasets in executive dashboard cleanly', () => {
      const emptyAgg = new CSATAggregator();
      const dashboard = emptyAgg.getExecutiveDashboard();
      assert.strictEqual(dashboard.totalTicketsAnalyzed, 0);
      assert.strictEqual(dashboard.overallCSAT.csatPercentage, 0);
      assert.strictEqual(dashboard.topPerformingAgents.length, 0);
      assert.deepStrictEqual(dashboard.categoryBreakdown, Object.create(null));
    });
  });

  // --------------------------------------------------------------------------
  // CSV Export & Formula Injection Prevention Tests
  // --------------------------------------------------------------------------
  describe('CSV Export & Formula Injection Prevention', () => {
    beforeEach(() => {
      aggregator.ingestBatch(sampleFeedbacks);
    });

    it('exports raw feedback to valid RFC 4180 CSV with escaped commas and quotes', () => {
      const csv = aggregator.exportRawFeedbackCSV();
      const lines = csv.split('\r\n');
      assert.ok(lines.length >= 6); // 1 header + 5 rows
      assert.ok(lines[0].startsWith('Ticket ID,Agent ID,Category,Rating'));
      // Check that commentary with commas was properly quoted
      assert.ok(lines[1].includes('"Super quick resolution, very courteous!"'));
    });

    it('neutralizes spreadsheet formula injection in commentary (=, +, -, @) without corrupting text or numeric fields', () => {
      // Regression test for Finding 9
      const aggFormula = new CSATAggregator();
      aggFormula.ingestBatch([
        {
          ticketId: 'T-F1',
          agentId: 'a1',
          category: 'Support',
          rating: 5,
          commentary: '=SUM(A1:A2)',
          resolutionTimeMs: 1000,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-F2',
          agentId: 'a1',
          category: 'Support',
          rating: 4,
          commentary: '+SUM(A1:A2)',
          resolutionTimeMs: 2000,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-F3',
          agentId: 'a1',
          category: 'Support',
          rating: 3,
          commentary: '-formula',
          resolutionTimeMs: 3000,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-F4',
          agentId: 'a1',
          category: 'Support',
          rating: 2,
          commentary: '@formula',
          resolutionTimeMs: 4000,
          timestamp: new Date().toISOString(),
        },
        {
          ticketId: 'T-F5',
          agentId: 'a1',
          category: 'Support',
          rating: 1,
          commentary: 'Has "quotes" and, commas\nand newline',
          resolutionTimeMs: 5000,
          timestamp: new Date().toISOString(),
        },
      ]);

      const csv = aggFormula.exportRawFeedbackCSV();
      // Check neutralized formula values contain prepended tab
      assert.ok(csv.includes('"\t=SUM(A1:A2)"'));
      assert.ok(csv.includes('"\t+SUM(A1:A2)"'));
      assert.ok(csv.includes('"\t-formula"'));
      assert.ok(csv.includes('"\t@formula"'));
      // Check quotes, commas, and newlines escaping
      assert.ok(csv.includes('"Has ""quotes"" and, commas\nand newline"'));
      // Check numeric fields remain unneutralized numbers
      assert.ok(csv.includes('1000'));
      assert.ok(csv.includes('2000'));
    });

    it('exports agent performance aggregate metrics to CSV', () => {
      const csv = aggregator.exportAgentPerformanceCSV();
      const lines = csv.split('\r\n');
      assert.strictEqual(lines.length, 4); // 1 header + 3 agents
      assert.ok(lines[0].includes('Agent ID,Total Tickets,Workload Share %'));
      assert.ok(csv.includes('agent_alice'));
      assert.ok(csv.includes('agent_bob'));
      assert.ok(csv.includes('agent_charlie'));
    });

    it('exports category performance aggregate metrics to CSV', () => {
      const csv = aggregator.exportCategoryPerformanceCSV();
      const lines = csv.split('\r\n');
      assert.strictEqual(lines.length, 4); // 1 header + 3 categories
      assert.ok(lines[0].includes('Category,Total Tickets,CSAT %'));
      assert.ok(csv.includes('Billing'));
      assert.ok(csv.includes('Technical Support'));
      assert.ok(csv.includes('Security'));
    });
  });
});
