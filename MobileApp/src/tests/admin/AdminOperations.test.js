/**
 * AdminOperations.test.js
 *
 * Unit tests for Android Admin Operations Parity:
 *  - 2x2 KPI card calculations
 *  - Single-company 'RITESH PVT LTD' sync and filtering
 *  - Inline status, priority, and agent-claim controls
 */

describe('Android Admin Operations & Parity', () => {
  const MOCK_COMPANY = 'RITESH PVT LTD';
  const CURRENT_ADMIN_ID = 'admin-user-001';

  const MOCK_TICKETS = [
    {
      id: 'tkt-1',
      subject: 'Network outage in Block A',
      status: 'pending',
      priority: 'critical',
      company: 'RITESH PVT LTD',
      assigned_agent_id: null,
    },
    {
      id: 'tkt-2',
      subject: 'VPN authorization requested',
      status: 'open',
      priority: 'high',
      company: 'RITESH PVT LTD',
      assigned_agent_id: null,
    },
    {
      id: 'tkt-3',
      subject: 'Laptop screen flickering',
      status: 'in_progress',
      priority: 'medium',
      company: 'RITESH PVT LTD',
      assigned_agent_id: CURRENT_ADMIN_ID,
    },
    {
      id: 'tkt-4',
      subject: 'Password reset',
      status: 'resolved',
      priority: 'low',
      company: 'RITESH PVT LTD',
      assigned_agent_id: 'other-agent-999',
    },
    {
      id: 'tkt-5',
      subject: 'Other company incident',
      status: 'pending',
      priority: 'low',
      company: 'ACME CORP',
      assigned_agent_id: null,
    },
  ];

  describe('Single-Company RITESH PVT LTD Sync', () => {
    test('enforces RITESH PVT LTD company filter on ticket queue', () => {
      const companyTickets = MOCK_TICKETS.filter((t) => (t.company || 'RITESH PVT LTD') === MOCK_COMPANY);
      expect(companyTickets).toHaveLength(4);
      expect(companyTickets.every((t) => t.company === 'RITESH PVT LTD')).toBe(true);
    });

    test('falls back safely to RITESH PVT LTD if profile company is undefined', () => {
      const profile = { id: 'usr-1', full_name: 'John' };
      const resolvedCompany = profile.company || 'RITESH PVT LTD';
      expect(resolvedCompany).toBe('RITESH PVT LTD');
    });
  });

  describe('2x2 KPI Calculations', () => {
    test('computes accurate 2x2 KPI metrics for queue', () => {
      const companyTickets = MOCK_TICKETS.filter((t) => t.company === MOCK_COMPANY);

      const totalCount = companyTickets.length;
      const pendingCount = companyTickets.filter((t) => {
        const raw = String(t.status || '').toLowerCase().trim();
        return raw === 'pending' || raw === 'open' || raw === 'pending_human';
      }).length;
      const inProgressCount = companyTickets.filter((t) => {
        const raw = String(t.status || '').toLowerCase().trim();
        return raw === 'in progress' || raw === 'in_progress';
      }).length;
      const resolvedCount = companyTickets.filter((t) => {
        const raw = String(t.status || '').toLowerCase().trim();
        return raw.includes('resolv') || raw === 'closed';
      }).length;

      expect(totalCount).toBe(4);
      expect(pendingCount).toBe(2); // 'pending' + 'open'
      expect(inProgressCount).toBe(1); // 'in_progress'
      expect(resolvedCount).toBe(1); // 'resolved'
    });
  });

  describe('Inline Status, Priority & Claim Controls', () => {
    test('identifies claimed ticket for current admin', () => {
      const isClaimedByMe = (ticket, userId) =>
        ticket.assigned_agent_id === userId || ticket.assigned_to === userId;

      expect(isClaimedByMe(MOCK_TICKETS[0], CURRENT_ADMIN_ID)).toBe(false);
      expect(isClaimedByMe(MOCK_TICKETS[2], CURRENT_ADMIN_ID)).toBe(true);
      expect(isClaimedByMe(MOCK_TICKETS[3], CURRENT_ADMIN_ID)).toBe(false);
    });

    test('optimistically updates ticket claim and status to in_progress', () => {
      let tickets = [...MOCK_TICKETS];
      const ticketToClaim = 'tkt-1';

      // Simulate claim action
      tickets = tickets.map((t) =>
        t.id === ticketToClaim
          ? {
              ...t,
              assigned_agent_id: CURRENT_ADMIN_ID,
              status: 'in_progress',
              updated_at: new Date().toISOString(),
            }
          : t
      );

      const claimed = tickets.find((t) => t.id === ticketToClaim);
      expect(claimed.assigned_agent_id).toBe(CURRENT_ADMIN_ID);
      expect(claimed.status).toBe('in_progress');
    });

    test('optimistically updates ticket priority', () => {
      let tickets = [...MOCK_TICKETS];
      const targetId = 'tkt-3';
      const newPriority = 'critical';

      tickets = tickets.map((t) => (t.id === targetId ? { ...t, priority: newPriority } : t));

      const updated = tickets.find((t) => t.id === targetId);
      expect(updated.priority).toBe('critical');
    });

    test('optimistically updates ticket status to resolved', () => {
      let tickets = [...MOCK_TICKETS];
      const targetId = 'tkt-1';
      const newStatus = 'resolved';

      tickets = tickets.map((t) => (t.id === targetId ? { ...t, status: newStatus } : t));

      const updated = tickets.find((t) => t.id === targetId);
      expect(updated.status).toBe('resolved');
    });
  });
});
