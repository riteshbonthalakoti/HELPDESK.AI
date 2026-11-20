/**
 * AdminTicketsScreen.test.js
 *
 * Component rendering tests for the AdminTicketsScreen with mocked
 * API endpoints (Supabase) for mobile screen validation.
 *
 * Tests cover:
 *  - Loading state rendering
 *  - Ticket list display after fetch
 *  - Filter tab rendering
 *  - Search input presence
 *  - Error handling on failed API calls
 *  - Empty state rendering
 *  - Ticket card content validation
 */

import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';

// ── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
  useFocusEffect: jest.fn(),
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
    'Search', 'ChevronRight', 'AlertCircle', 'Clock', 'CheckCircle2',
    'SlidersHorizontal', 'X',
  ];
  const mocks = {};
  icons.forEach((name) => {
    mocks[name] = () => null;
  });
  return mocks;
});

import { supabase } from '../../lib/supabase';
import { useNavigation } from '@react-navigation/native';
import AdminTicketsScreen from '../AdminTicketsScreen';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_USER = { id: 'admin-001', email: 'admin@test.com' };

const MOCK_PROFILE = {
  id: 'admin-001',
  full_name: 'Admin User',
  role: 'admin',
  company: 'TestCo',
};

const MOCK_TICKETS = [
  {
    id: 'tkt-1',
    subject: 'VPN connectivity issue',
    description: 'User cannot connect to VPN since morning.',
    status: 'pending',
    priority: 'high',
    category: 'Network',
    created_at: '2026-06-01T10:00:00Z',
    auto_resolve: false,
    creator: { full_name: 'John Doe', email: 'john@test.com' },
  },
  {
    id: 'tkt-2',
    subject: 'Email login broken',
    description: 'Cannot log into email portal.',
    status: 'in_progress',
    priority: 'medium',
    category: 'Software',
    created_at: '2026-06-02T10:00:00Z',
    auto_resolve: false,
    creator: { full_name: 'Jane Smith', email: 'jane@test.com' },
  },
  {
    id: 'tkt-3',
    subject: 'Hardware failure',
    description: 'Monitor not turning on.',
    status: 'resolved',
    priority: 'low',
    category: 'Hardware',
    created_at: '2026-06-03T10:00:00Z',
    auto_resolve: true,
    creator: { full_name: 'Bob Wilson', email: 'bob@test.com' },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function mockSupabaseChain({ data = null, error = null } = {}) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error }),
    order: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
  };
  chain.then = jest.fn((cb) => Promise.resolve({ data, error }).then(cb));
  return chain;
}

function setupMocks() {
  useNavigation.mockReturnValue({ navigate: jest.fn(), goBack: jest.fn() });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AdminTicketsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: MOCK_USER } });
  });

  // ── 1. Loading state ──────────────────────────────────────────────────────

  test('renders without crashing during loading', () => {
    supabase.auth.getUser.mockReturnValue(new Promise(() => {}));
    supabase.from.mockReturnValue(mockSupabaseChain());

    expect(() => {
      render(<AdminTicketsScreen />);
    }).not.toThrow();
  });

  // ── 2. Ticket list display ────────────────────────────────────────────────

  test('renders ticket subjects after successful fetch', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('VPN connectivity issue')).toBeTruthy();
  });

  test('renders ticket creator name after fetch', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('John Doe')).toBeTruthy();
  });

  test('renders ticket priority badge', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('HIGH')).toBeTruthy();
  });

  test('renders ticket category badge', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('NETWORK')).toBeTruthy();
  });

  // ── 3. Filter tabs ────────────────────────────────────────────────────────

  test('renders All Queue filter tab', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('All Queue')).toBeTruthy();
  });

  test('renders Open / Pending filter tab', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('Open / Pending')).toBeTruthy();
  });

  test('renders Resolved filter tab', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('Resolved')).toBeTruthy();
  });

  // ── 4. AI auto-resolve badge ──────────────────────────────────────────────

  test('renders AI AUTO badge for auto-resolved tickets', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('AI AUTO')).toBeTruthy();
  });

  // ── 5. Empty state ────────────────────────────────────────────────────────

  test('renders empty state message when no tickets match filters', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: [] });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('No tickets match your filters')).toBeTruthy();
  });

  // ── 6. Error handling ─────────────────────────────────────────────────────

  test('does not crash on API error', async () => {
    supabase.from.mockImplementation((table) => {
      return mockSupabaseChain({ data: null, error: { message: 'Network error' } });
    });

    expect(() => {
      render(<AdminTicketsScreen />);
    }).not.toThrow();
  });

  // ── 7. Multiple tickets rendering ─────────────────────────────────────────

  test('renders multiple tickets in the list', async () => {
    supabase.from.mockImplementation((table) => {
      if (table === 'profiles') return mockSupabaseChain({ data: MOCK_PROFILE });
      if (table === 'tickets') return mockSupabaseChain({ data: MOCK_TICKETS });
      return mockSupabaseChain({ data: [] });
    });

    const { findByText } = render(<AdminTicketsScreen />);
    expect(await findByText('VPN connectivity issue')).toBeTruthy();
    expect(await findByText('Email login broken')).toBeTruthy();
  });
});
