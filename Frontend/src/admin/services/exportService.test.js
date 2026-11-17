
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  exportTicketsToJSON,
  exportTicketsToMarkdown,
} from './exportService';

describe('Ticket Export', () => {
  const tickets = [
    {
      id: 'TKT-101',
      priority: 'High',
      status: 'Resolved',
      category: 'Technical',
      resolved_at: '2026-11-17T10:00:00Z',
    },
  ];

  let downloadedBlob;
  let anchor;

  const setupDownloadMocks = () => {
    downloadedBlob = null;

    anchor = { click: vi.fn() };

    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      downloadedBlob = blob;
      return 'blob:test';
    });

    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exports correct ticket data as JSON', async () => {
    setupDownloadMocks();

    const result = exportTicketsToJSON(tickets);
    const content = JSON.parse(await downloadedBlob.text());

    expect(result.count).toBe(1);
    expect(result.filename).toBe('tickets-export.json');

    expect(content[0]).toEqual({
      ticket_id: 'TKT-101',
      priority: 'High',
      status: 'Resolved',
      category: 'Technical',
      resolved_at: expect.any(String),
    });

    expect(anchor.click).toHaveBeenCalled();
  });

    it('uses the resolution timestamp from ticket metadata', async () => {
    setupDownloadMocks();

    const metadataTickets = [
      {
        id: 'TKT-102',
        priority: 'High',
        status: 'Resolved',
        category: 'Technical',
        metadata: {
          resolved_at: '2026-11-17T10:00:00Z',
        },
      },
    ];

    exportTicketsToJSON(metadataTickets);

    const content = JSON.parse(await downloadedBlob.text());

    expect(content[0].ticket_id).toBe('TKT-102');
    expect(content[0].resolved_at).toBeTruthy();
  });

  it('exports correct ticket data as Markdown', async () => {
    setupDownloadMocks();

    const result = exportTicketsToMarkdown(tickets);
    const content = await downloadedBlob.text();

    expect(result.count).toBe(1);
    expect(result.filename).toBe('tickets-export.md');

    expect(content).toContain('| Ticket ID | Priority | Status | Category | Resolved At |');
    expect(content).toContain('TKT-101');
    expect(content).toContain('High');
    expect(content).toContain('Resolved');
    expect(content).toContain('Technical');

    expect(anchor.click).toHaveBeenCalled();
  });

  it('escapes special characters in Markdown values', async () => {
    setupDownloadMocks();

    const specialTickets = [
      {
        id: 'TKT|102',
        priority: 'High',
        status: 'Resolved',
        category: 'Network\nSupport',
      },
    ];

    exportTicketsToMarkdown(specialTickets);
    const content = await downloadedBlob.text();

    expect(content).toContain('TKT\\|102');
    expect(content).toContain('Network Support');
  });

  it('throws an error when exporting an empty ticket list', () => {
    expect(() => exportTicketsToJSON([])).toThrow('No tickets to export');
    expect(() => exportTicketsToMarkdown([])).toThrow('No tickets to export');
  });
});
