/**
 * AdminTicketDetailScreen.test.js
 *
 * Component rendering tests for the AdminTicketDetailScreen with mocked
 * API endpoints (Supabase) for mobile screen validation.
 *
 * Tests cover:
 *  - Loading state rendering
 *  - Ticket data display after fetch
 *  - Error handling on failed API calls
 *  - Message list rendering
 *  - Status badge display
 *  - Action buttons presence
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }) => children,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' },
  NotificationFeedbackType: { Success: 'Success' },
}));

jest.mock('lucide-react-native', () => {
  const icons = [
    'ArrowLeft', 'Send', 'Sparkles', 'User', 'Briefcase', 'Clock',
    'ChevronDown', 'CheckCircle2', 'AlertTriangle', 'Eye', 'Star',
    'Settings', 'Shield', 'ShieldAlert', 'Cpu', 'Globe', 'ArrowUpRight',
    'ShieldCheck', 'X',
  ];
  const mocks = {};
  icons.forEach((name) => {
    mocks[name] = () => null;
  });
  return mocks;
});

import { supabase } from '../../lib/supabase';
import { useRoute, useNavigation } from '@react-navigation/native';
import AdminTicketDetailScreen from '../AdminTicketDetailScreen';

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'user-123', email: 'admin@test.com' };

const MOCK_PROFILE = {
  id: 'user-123',
  full_name: 'Admin User',
  role: 'admin',
  company: 'TestCo',
  company_id: 'company-abc',
};

const MOCK_TICKET = {
  id: 'ticket-001',
  ticket_id: 'TKT-001',
  subject: 'Cannot access VPN',
  description: 'User is unable to connect to VPN since yesterday.',
  status: 'pending',
  priority: 'high',
  category: 'Network',
  sub_category: 'VPN',
  company: 'TestCo',
  assigned_team: 'Network Ops',
  assigned_to: null,
  created_at: '2026-06-01T10:00:00Z',
  resolved_at: null,
  auto_resolve: false,
  confidence: 0.92,
  creator: { full_name: 'John Doe', email: 'john@test.com' },
};

const MOCK_MESSAGES = [
  {
    id: 'msg-1',
    ticket_id: 'ticket-001',
    content: 'Hello, I cannot connect to VPN.',
    sender_id: 'user-123',
    created_at: '2026-06-01T10:05:00Z',
    sender: { full_name: 'John Doe', role: 'user' },
  },
  {
    id: 'msg-2',
    ticket_id: 'ticket-001',
    content: 'We are looking into it.',
    sender_id: 'agent-456',
    created_at: '2026-06-01T10:10:00Z',
    sender: { full_name: 'Agent Smith', role: 'admin' },
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a chainable Supabase mock that resolves to { data, error }.
 */
function mockSupabaseChain({ data = null, error = null } = {}) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
    order: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ data, error }),
    update: jest.fn().mockReturnThis(),
    channel: jest.fn().mockReturnThis(),
    on: jest.fn().mockReturnThis(),
    subscribe: jest.fn().mockReturnThis(),
  };
  // Allow both .single() and direct resolution for list queries
  chain.then = jest.fn((cb) => Promise.resolve({ data, error }).then(cb));
  return chain;
}

function setupNavMocks({ ticketId = 'ticket-001' } = {}) {
  useRoute.mockReturnValue({ params: { ticketId } });
  useNavigation.mockReturnValue({ navigate: jest.fn(), goBack: jest.fn() });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminTicketDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupNavMocks();

    // Default: authenticated user
    supabase.auth.getUser.mockResolvedValue({ data: { user: MOCK_USER } });
  });

  // ── 1. Loading state ─────────────────────────────────────────────────────

  test('renders loading indicator on initial mount', () => {
    // Supabase calls never resolve during this test
    supabase.auth.getUser.mockReturnValue(new Promise(() => {}));
    supabase.from.mockReturnValue(mockSupabaseChain());

    const { getByTestId } = render(<AdminTicketDetailScreen />);
    // The screen shows an ActivityIndicator while loading
    // (screen must have testID="loading-indicator" or we check by type)
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });

  // ── 2. Ticket data display ────────────────────────────────────────────────

  test('renders ticket subject after successful fetch', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText('Cannot access VPN')).toBeTruthy();
  });

  test('renders ticket priority badge', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText('HIGH')).toBeTruthy();
  });

  test('renders ticket status', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText(/PENDING/i)).toBeTruthy();
  });

  test('renders ticket category', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText('Network')).toBeTruthy();
  });

  // ── 3. Message list ───────────────────────────────────────────────────────

  test('renders chat messages after fetch', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText('Hello, I cannot connect to VPN.')).toBeTruthy();
    expect(await findByText('We are looking into it.')).toBeTruthy();
  });

  test('renders empty message state when no messages', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: [] });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    // Ticket subject should still render
    expect(await findByText('Cannot access VPN')).toBeTruthy();
  });

  // ── 4. Error handling ─────────────────────────────────────────────────────

  test('handles unauthenticated user gracefully', async () => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: null } });
    supabase.from.mockReturnValue(mockSupabaseChain({ data: null }));

    // Should not throw
    const { queryByText } = render(<AdminTicketDetailScreen />);
    await waitFor(() => {
      expect(queryByText('Cannot access VPN')).toBeNull();
    });
  });

  test('handles ticket fetch error without crashing', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets')
        return mockSupabaseChain({ data: null, error: { message: 'Not found' } });
      return mockSupabaseChain({ data: [] });
    });

    // Component should render without throwing
    expect(() => render(<AdminTicketDetailScreen />)).not.toThrow();
  });

  // ── 5. Creator info ───────────────────────────────────────────────────────

  test('renders creator name', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketDetailScreen />);
    expect(await findByText('John Doe')).toBeTruthy();
  });

  // ── 6. Action presence ────────────────────────────────────────────────────

  test('renders send button in the chat input area', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKET });
      if (table === 'messages') return mockSupabaseChain({ data: MOCK_MESSAGES });
      return mockSupabaseChain({ data: [] });
    });

    const { findByTestId } = render(<AdminTicketDetailScreen />);
    expect(await findByTestId('send-button')).toBeTruthy();
  });
});
