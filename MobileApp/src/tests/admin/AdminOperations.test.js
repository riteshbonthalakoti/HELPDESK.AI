/**
 * AdminOperations.test.js
 *
 * Unit tests for Android Admin Operations Parity:
 *  - 2x2 KPI card calculations and filter mapping (including resolved/closed parity)
 *  - Single-company 'RITESH PVT LTD' / company_id query and fallback handling
 *  - Atomic ticket claim with conflict detection (.is('assigned_agent_id', null))
 *  - Safe update validation requiring exactly 1 returned row
 *  - Status normalization and error recovery
 */

import {
  normalizeStatus,
  calculateKpiCounts,
  filterTickets,
  fetchTicketsQuery,
  updateTicketAction,
  claimTicketAction,
} from '../../lib/adminTicketOperations';

describe('Android Admin Operations & Parity', () => {
  const MOCK_COMPANY = 'RITESH PVT LTD';
  const MOCK_COMPANY_ID = '11111111-2222-3333-4444-555555555555';
  const CURRENT_ADMIN_ID = 'admin-user-001';

  const MOCK_TICKETS = [
    {
      id: 'tkt-1',
      subject: 'Network outage in Block A',
      status: 'pending',
      priority: 'critical',
      company: 'RITESH PVT LTD',
      company_id: MOCK_COMPANY_ID,
      assigned_agent_id: null,
      created_at: '2026-11-18T10:00:00Z',
    },
    {
      id: 'tkt-2',
      subject: 'VPN authorization requested',
      status: 'open',
      priority: 'high',
      company: 'RITESH PVT LTD',
      company_id: MOCK_COMPANY_ID,
      assigned_agent_id: null,
      created_at: '2026-11-18T10:30:00Z',
    },
    {
      id: 'tkt-3',
      subject: 'Laptop screen flickering',
      status: 'in_progress',
      priority: 'medium',
      company: 'RITESH PVT LTD',
      company_id: MOCK_COMPANY_ID,
      assigned_agent_id: CURRENT_ADMIN_ID,
      created_at: '2026-11-18T11:00:00Z',
    },
    {
      id: 'tkt-4',
      subject: 'Password reset',
      status: 'resolved',
      priority: 'low',
      company: 'RITESH PVT LTD',
      company_id: MOCK_COMPANY_ID,
      assigned_agent_id: 'other-agent-999',
      created_at: '2026-11-18T11:30:00Z',
    },
    {
      id: 'tkt-5',
      subject: 'Archived security inquiry',
      status: 'closed',
      priority: 'low',
      company: 'RITESH PVT LTD',
      company_id: MOCK_COMPANY_ID,
      assigned_agent_id: CURRENT_ADMIN_ID,
      created_at: '2026-11-18T12:00:00Z',
    },
    {
      id: 'tkt-6',
      subject: 'Other company incident',
      status: 'pending',
      priority: 'low',
      company: 'ACME CORP',
      company_id: '99999999-9999-9999-9999-999999999999',
      assigned_agent_id: null,
      created_at: '2026-11-18T12:30:00Z',
    },
  ];

  describe('Production Query Handler & Company Filter Enforcement', () => {
    test('applies company_id filter when verified workspace UUID is present', async () => {
      const eqMock = jest.fn().mockResolvedValue({
        data: MOCK_TICKETS.filter((t) => t.company_id === MOCK_COMPANY_ID),
        error: null,
      });
      const orderMock = jest.fn().mockReturnValue({ eq: eqMock });
      const selectMock = jest.fn().mockReturnValue({ order: orderMock });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ select: selectMock }),
      };

      const result = await fetchTicketsQuery(mockSupabase, {
        company: MOCK_COMPANY,
        companyId: MOCK_COMPANY_ID,
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('tickets');
      expect(eqMock).toHaveBeenCalledWith('company_id', MOCK_COMPANY_ID);
      expect(result).toHaveLength(5);
    });

    test('falls back to company name filter when companyId is undefined', async () => {
      const eqMock = jest.fn().mockResolvedValue({
        data: MOCK_TICKETS.filter((t) => t.company === MOCK_COMPANY),
        error: null,
      });
      const orderMock = jest.fn().mockReturnValue({ eq: eqMock });
      const selectMock = jest.fn().mockReturnValue({ order: orderMock });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ select: selectMock }),
      };

      const result = await fetchTicketsQuery(mockSupabase, {
        company: MOCK_COMPANY,
      });

      expect(eqMock).toHaveBeenCalledWith('company', MOCK_COMPANY);
      expect(result).toHaveLength(5);
    });

    test('gracefully recovers via fallback query when relational joins fail', async () => {
      const fallbackEq = jest.fn().mockResolvedValue({
        data: [{ id: 'tkt-fallback' }],
        error: null,
      });
      const fallbackOrder = jest.fn().mockReturnValue({ eq: fallbackEq });
      const fallbackSelect = jest.fn().mockReturnValue({ order: fallbackOrder });

      const primaryEq = jest.fn().mockResolvedValue({
        data: null,
        error: new Error('PGRST200 foreign key relation not found'),
      });
      const primaryOrder = jest.fn().mockReturnValue({ eq: primaryEq });
      const primarySelect = jest.fn().mockReturnValue({ order: primaryOrder });

      let callCount = 0;
      const mockSupabase = {
        from: jest.fn().mockImplementation(() => {
          callCount++;
          return callCount === 1 ? { select: primarySelect } : { select: fallbackSelect };
        }),
      };

      const result = await fetchTicketsQuery(mockSupabase, { companyId: MOCK_COMPANY_ID });
      expect(result).toEqual([{ id: 'tkt-fallback' }]);
    });
  });

  describe('2x2 KPI Calculations & Filter Operations', () => {
    test('computes accurate 2x2 KPI metrics for queue', () => {
      const companyTickets = MOCK_TICKETS.filter((t) => t.company === MOCK_COMPANY);
      const kpis = calculateKpiCounts(companyTickets);

      expect(kpis.totalCount).toBe(5);
      expect(kpis.pendingCount).toBe(2); // 'pending' + 'open'
      expect(kpis.inProgressCount).toBe(1); // 'in_progress'
      expect(kpis.resolvedCount).toBe(2); // 'resolved' + 'closed'
    });

    test('tapping Resolved KPI card shows all tickets included in resolvedCount (resolved + closed parity)', () => {
      const companyTickets = MOCK_TICKETS.filter((t) => t.company === MOCK_COMPANY);
      const kpis = calculateKpiCounts(companyTickets);

      const filteredResolved = filterTickets(companyTickets, 'resolved');
      expect(filteredResolved).toHaveLength(kpis.resolvedCount);
      expect(filteredResolved.some((t) => t.status === 'resolved')).toBe(true);
      expect(filteredResolved.some((t) => t.status === 'closed')).toBe(true);
    });

    test('filters queue by search query across subject, category, and ID', () => {
      const companyTickets = MOCK_TICKETS.filter((t) => t.company === MOCK_COMPANY);

      const searchOutage = filterTickets(companyTickets, 'all', 'outage');
      expect(searchOutage).toHaveLength(1);
      expect(searchOutage[0].id).toBe('tkt-1');

      const searchById = filterTickets(companyTickets, 'all', 'tkt-3');
      expect(searchById).toHaveLength(1);
      expect(searchById[0].subject).toBe('Laptop screen flickering');
    });

    test('normalizes status aliases correctly for picker highlighting', () => {
      expect(normalizeStatus('open')).toBe('pending');
      expect(normalizeStatus('pending_human')).toBe('pending');
      expect(normalizeStatus('in progress')).toBe('in_progress');
      expect(normalizeStatus('auto_resolved')).toBe('resolved');
      expect(normalizeStatus('closed')).toBe('closed');
    });
  });

  describe('Inline Actions & Safe Write Handlers', () => {
    test('updateTicketAction requires exactly 1 returned row and succeeds', async () => {
      const mockSelect = jest.fn().mockResolvedValue({
        data: [{ id: 'tkt-1', priority: 'high' }],
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ update: mockUpdate }),
      };

      const result = await updateTicketAction(mockSupabase, 'tkt-1', { priority: 'high' });
      expect(result).toEqual({ id: 'tkt-1', priority: 'high' });
      expect(mockSelect).toHaveBeenCalled();
    });

    test('updateTicketAction throws if 0 rows were updated', async () => {
      const mockSelect = jest.fn().mockResolvedValue({
        data: [],
        error: null,
      });
      const mockEq = jest.fn().mockReturnValue({ select: mockSelect });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ update: mockUpdate }),
      };

      await expect(
        updateTicketAction(mockSupabase, 'tkt-missing', { priority: 'high' })
      ).rejects.toThrow('Update failed: expected exactly 1 ticket row returned.');
    });

    test('claimTicketAction atomically claims unclaimed ticket with .is(assigned_agent_id, null)', async () => {
      const mockSelect = jest.fn().mockResolvedValue({
        data: [{ id: 'tkt-1', assigned_agent_id: CURRENT_ADMIN_ID, status: 'in_progress' }],
        error: null,
      });
      const mockIs = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq = jest.fn().mockReturnValue({ is: mockIs });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ update: mockUpdate }),
      };

      const result = await claimTicketAction(mockSupabase, 'tkt-1', CURRENT_ADMIN_ID);
      expect(mockIs).toHaveBeenCalledWith('assigned_agent_id', null);
      expect(result.success).toBe(true);
      expect(result.ticket.assigned_agent_id).toBe(CURRENT_ADMIN_ID);
    });

    test('claimTicketAction detects claim conflict when ticket was claimed by another agent', async () => {
      const mockSelect = jest.fn().mockResolvedValue({
        data: [], // 0 rows updated because assigned_agent_id was not null
        error: null,
      });
      const mockIs = jest.fn().mockReturnValue({ select: mockSelect });
      const mockEq = jest.fn().mockReturnValue({ is: mockIs });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq });

      const mockSupabase = {
        from: jest.fn().mockReturnValue({ update: mockUpdate }),
      };

      const result = await claimTicketAction(mockSupabase, 'tkt-1', CURRENT_ADMIN_ID);
      expect(result.success).toBe(false);
      expect(result.conflict).toBe(true);
    });

    test('handles rejected claim followed by failed reload gracefully', async () => {
      // Step 1: Claim is rejected due to conflict
      const mockSelect = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockSupabase = {
        from: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({ select: mockSelect }),
            }),
          }),
        }),
      };

      const claimResult = await claimTicketAction(mockSupabase, 'tkt-1', CURRENT_ADMIN_ID);
      expect(claimResult.conflict).toBe(true);

      // Step 2: Failed reload
      const mockFailingSupabase = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              eq: jest.fn().mockRejectedValue(new Error('Network disconnected')),
            }),
          }),
        }),
      };

      await expect(
        fetchTicketsQuery(mockFailingSupabase, { companyId: MOCK_COMPANY_ID })
      ).rejects.toThrow('Network disconnected');
    });
  });
});
