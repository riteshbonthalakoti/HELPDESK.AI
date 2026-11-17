const CSV_FIELDS = [
  { key: 'id', label: 'Ticket ID' },
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'created_at', label: 'Created Date' },
  { key: 'resolved_at', label: 'Resolved Date' },
  { key: 'assigned_agent', label: 'Assigned Agent' },
  { key: 'user_email', label: 'User Email' },
  { key: 'sla_breach', label: 'SLA Breach' },
];

function escapeCsvCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDateForCsv(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return dateStr;
  }
}

export function exportTicketsToCSV(tickets, filename = 'tickets-export.csv') {
  if (!tickets || tickets.length === 0) {
    throw new Error('No tickets to export');
  }

  const header = CSV_FIELDS.map((f) => escapeCsvCell(f.label)).join(',');
  const rows = tickets.map((ticket) => {
    return CSV_FIELDS.map(({ key }) => {
      const value =
        key === 'created_at' || key === 'resolved_at'
          ? formatDateForCsv(ticket[key])
          : ticket[key];
      return escapeCsvCell(value);
    }).join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename);
  return { count: tickets.length, filename };
}

export function exportSingleTicketToCSV(ticket, filename) {
  return exportTicketsToCSV(
    [ticket],
    filename ?? `ticket-${ticket.id ?? 'export'}.csv`
  );
}

export async function exportTicketsToPDF(tickets, filename = 'tickets-export.pdf') {
  if (!tickets || tickets.length === 0) {
    throw new Error('No tickets to export');
  }

  const { jsPDF } = await import('jspdf').catch(() => {
    throw new Error('jsPDF not installed. Run: npm install jspdf');
  });
  const { default: autoTable } = await import('jspdf-autotable').catch(() => {
    throw new Error('jspdf-autotable not installed. Run: npm install jspdf-autotable');
  });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('HELPDESK.AI — Ticket Export', 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    `Generated: ${new Date().toLocaleString()}  |  Total tickets: ${tickets.length}`,
    14,
    23
  );
  doc.setTextColor(0);

  const columns = CSV_FIELDS.slice(0, 9).map((f) => ({
    header: f.label,
    dataKey: f.key,
  }));

  const rows = tickets.map((t) => ({
    id: t.id ? String(t.id).slice(0, 8) : '',
    title: t.title ?? '',
    description: t.description ? String(t.description).slice(0, 60) + (t.description.length > 60 ? '…' : '') : '',
    category: t.category ?? '',
    priority: t.priority ?? '',
    status: t.status ?? '',
    created_at: formatDateForCsv(t.created_at),
    resolved_at: formatDateForCsv(t.resolved_at),
    assigned_agent: t.assigned_agent ?? '',
  }));

  autoTable(doc, {
    startY: 28,
    columns,
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 250, 247] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 44 },
      2: { cellWidth: 55 },
    },
    margin: { left: 14, right: 14 },
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.getWidth() - 14,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' }
    );
  }

  doc.save(filename);
  return { count: tickets.length, filename };
}

export async function exportSingleTicketToPDF(ticket, filename) {
  const { jsPDF } = await import('jspdf').catch(() => {
    throw new Error('jsPDF not installed. Run: npm install jspdf');
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('HELPDESK.AI', 14, y);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text('Ticket Detail Report', 14, (y += 7));
  doc.setTextColor(0);

  doc.setDrawColor(16, 185, 129);
  doc.setLineWidth(0.5);
  doc.line(14, (y += 4), pageW - 14, y);

  y += 10;

  const fields = [
    ['Ticket ID', ticket.id ?? '—'],
    ['Title', ticket.title ?? '—'],
    ['Category', ticket.category ?? '—'],
    ['Priority', ticket.priority ?? '—'],
    ['Status', ticket.status ?? '—'],
    ['Assigned Agent', ticket.assigned_agent ?? 'Unassigned'],
    ['User Email', ticket.user_email ?? '—'],
    ['Created', formatDateForCsv(ticket.created_at) || '—'],
    ['Resolved', formatDateForCsv(ticket.resolved_at) || 'Pending'],
    ['SLA Breach', ticket.sla_breach ? 'Yes' : 'No'],
  ];

  fields.forEach(([label, value]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`${label}:`, 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(value), 55, y);
    y += 8;
  });

  if (ticket.description) {
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Description:', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(ticket.description, pageW - 28);
    doc.text(lines, 14, y);
    y += lines.length * 5;
  }

  doc.setFontSize(7.5);
  doc.setTextColor(150);
  doc.text(
    `Generated: ${new Date().toLocaleString()}`,
    14,
    doc.internal.pageSize.getHeight() - 8
  );

  const outputFilename = filename ?? `ticket-${ticket.id ?? 'detail'}.pdf`;
  doc.save(outputFilename);
  return { filename: outputFilename };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


function getExportTicketData(ticket) {
  return {
    ticket_id: ticket.id || '',
    priority: ticket.correction?.corrected_priority || ticket.priority || '',
    status: ticket.status || '',
    category: ticket.correction?.corrected_category || ticket.category || '',
    resolved_at: formatDateForCsv(
      ticket.resolved_at || ticket.metadata?.resolved_at
    ) || null,
  };
}

export function exportTicketsToJSON(tickets, filename = 'tickets-export.json') {
  if (!tickets || tickets.length === 0) {
    throw new Error('No tickets to export');
  }

  const json = JSON.stringify(tickets.map(getExportTicketData), null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });

  triggerDownload(blob, filename);
  return { count: tickets.length, filename };
}

export function exportTicketsToMarkdown(tickets, filename = 'tickets-export.md') {
  if (!tickets || tickets.length === 0) {
    throw new Error('No tickets to export');
  }

  const escapeMarkdown = (value) =>
    String(value ?? 'N/A').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

  const rows = tickets.map((ticket) => {
    const data = getExportTicketData(ticket);

    return `| ${escapeMarkdown(data.ticket_id)} | ${escapeMarkdown(data.priority)} | ${escapeMarkdown(data.status)} | ${escapeMarkdown(data.category)} | ${escapeMarkdown(data.resolved_at || 'Pending')} |`;
  });

  const markdown = [
    '# HELPDESK.AI - Ticket Export',
    '',
    `Generated: ${new Date().toLocaleString()}`,
    `Total Tickets: ${tickets.length}`,
    '',
    '| Ticket ID | Priority | Status | Category | Resolved At |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });

  triggerDownload(blob, filename);
  return { count: tickets.length, filename };
}
