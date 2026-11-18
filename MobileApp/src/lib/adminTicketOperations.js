/**
 * adminTicketOperations.js
 *
 * Production operations and query/action handlers for the Admin Tickets Queue.
 * Extracted for modularity, clean error recovery, and robust testability.
 */

export const normalizeStatus = (status) => {
  const s = String(status || '').toLowerCase().trim();
  if (s === 'open' || s === 'pending_human') return 'pending';
  if (s === 'in progress') return 'in_progress';
  if (s === 'auto_resolved' || s.includes('resolv')) return 'resolved';
  return s;
};

export const calculateKpiCounts = (tickets = []) => {
  const totalCount = tickets.length;
  const pendingCount = tickets.filter((t) => {
    const raw = String(t.status || '').toLowerCase().trim();
    return raw === 'pending' || raw === 'open' || raw === 'pending_human';
  }).length;
  const inProgressCount = tickets.filter((t) => {
    const raw = String(t.status || '').toLowerCase().trim();
    return raw === 'in progress' || raw === 'in_progress';
  }).length;
  const resolvedCount = tickets.filter((t) => {
    const raw = String(t.status || '').toLowerCase().trim();
    return raw.includes('resolv') || raw === 'closed';
  }).length;

  return { totalCount, pendingCount, inProgressCount, resolvedCount };
};

export const filterTickets = (tickets = [], activeFilter = 'all', searchQuery = '') => {
  let filtered = tickets;

  if (activeFilter !== 'all') {
    filtered = filtered.filter((t) => {
      const rawStatus = String(t.status || '').toLowerCase().trim();
      if (activeFilter === 'pending') {
        return (
          rawStatus === 'pending' ||
          rawStatus === 'open' ||
          rawStatus === 'pending_human'
        );
      }
      if (activeFilter === 'in_progress') {
        return rawStatus === 'in progress' || rawStatus === 'in_progress';
      }
      if (activeFilter === 'resolved') {
        return rawStatus.includes('resolv') || rawStatus === 'closed';
      }
      if (activeFilter === 'closed') {
        return rawStatus === 'closed';
      }
      return rawStatus === activeFilter.toLowerCase();
    });
  }

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(
      (t) =>
        t.subject?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        t.priority?.toLowerCase().includes(q) ||
        t.creator?.full_name?.toLowerCase().includes(q) ||
        String(t.id).includes(q)
    );
  }

  return filtered;
};

export const fetchTicketsQuery = async (supabaseClient, { company, companyId } = {}) => {
  let query = supabaseClient
    .from('tickets')
    .select(`
      *,
      creator:profiles!tickets_user_id_fkey(full_name, email),
      assigned_agent:profiles!tickets_assigned_agent_id_fkey(full_name, email)
    `)
    .order('created_at', { ascending: false });

  if (companyId) {
    query = query.eq('company_id', companyId);
  } else {
    query = query.eq('company', company || 'RITESH PVT LTD');
  }

  const { data, error } = await query;
  if (error) {
    let fallback = supabaseClient
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (companyId) {
      fallback = fallback.eq('company_id', companyId);
    } else {
      fallback = fallback.eq('company', company || 'RITESH PVT LTD');
    }

    const { data: fallbackData, error: fallbackError } = await fallback;
    if (fallbackError) throw fallbackError;
    return fallbackData || [];
  }

  return data || [];
};

export const updateTicketAction = async (supabaseClient, ticketId, updatePayload) => {
  const { data, error } = await supabaseClient
    .from('tickets')
    .update(updatePayload)
    .eq('id', ticketId)
    .select();

  if (error) throw error;
  if (!data || data.length !== 1) {
    throw new Error('Update failed: expected exactly 1 ticket row returned.');
  }

  return data[0];
};

export const claimTicketAction = async (supabaseClient, ticketId, currentUserId) => {
  const { data, error } = await supabaseClient
    .from('tickets')
    .update({
      assigned_agent_id: currentUserId,
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .is('assigned_agent_id', null)
    .select();

  if (error) throw error;
  if (!data || data.length === 0) {
    return { success: false, conflict: true };
  }

  return { success: true, ticket: data[0] };
};
