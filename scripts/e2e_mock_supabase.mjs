#!/usr/bin/env node
/**
 * Stateful Local Supabase Emulator for Cypress E2E Testing (CI & Local)
 *
 * Emulates:
 * - GoTrue Auth (/auth/v1/signup, /auth/v1/token, /auth/v1/user, /auth/v1/logout, /auth/v1/otp)
 * - PostgREST (/rest/v1/<table> with eq, neq, in, is, gt/gte/lt/lte, ilike, or, order, limit, joins, single-object)
 * - Storage (/storage/v1/object/*)
 * - Edge Functions (/functions/v1/*)
 * - Realtime Phoenix WebSocket (/realtime/v1/websocket, vsn 1.0.0 & 2.0.0)
 * - Test Harness Control (/__test__/reset, /__test__/seed, /__test__/state, /health)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 54321);
const HOST = process.env.MOCK_SUPABASE_HOST || '127.0.0.1';
const JWT_HMAC_KEY = crypto.randomBytes(32);

const DEFAULT_COMPANY_ID = 'comp-ritesh-001';
const DEFAULT_COMPANY_NAME = 'RITESH PVT LTD';

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createJwt(user, expiresAtSec) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: 'authenticated',
      exp: expiresAtSec,
      iat: Math.floor(Date.now() / 1000),
      iss: `http://${HOST}:${PORT}/auth/v1`,
      sub: user.id,
      email: user.email,
      phone: '',
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
      role: 'authenticated',
      session_id: crypto.randomUUID(),
    })
  );
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', JWT_HMAC_KEY).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${sig}`;
}

function decodeJwtSub(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed.sub || null;
  } catch {
    return null;
  }
}

function buildAuthUser({ id, email, fullName, role, company, companyId, extraMeta = {}, now }) {
  const timestamp = now || new Date().toISOString();
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: timestamp,
    confirmed_at: timestamp,
    confirmation_sent_at: null,
    recovery_sent_at: null,
    email_change_sent_at: null,
    new_email: null,
    new_phone: null,
    invited_at: null,
    action_link: null,
    phone: '',
    phone_confirmed_at: null,
    last_sign_in_at: timestamp,
    app_metadata: {
      provider: 'email',
      providers: ['email'],
    },
    user_metadata: {
      full_name: fullName,
      role,
      company,
      company_id: companyId,
      ...extraMeta,
    },
    identities: [],
    created_at: timestamp,
    updated_at: timestamp,
    is_anonymous: false,
    factors: [],
  };
}

// ─── In-Memory Database State ────────────────────────────────────────────────
const state = {
  usersById: new Map(),
  passwordsByEmail: new Map(),
  tokensToUserId: new Map(),
  refreshTokensToUserId: new Map(),
  storageObjects: new Map(),
  tables: {
    companies: [],
    profiles: [],
    tickets: [],
    ticket_messages: [],
    internal_notes: [],
    user_requests: [],
    system_settings: [],
    notifications: [],
    knowledge_base: [],
    webhooks: [],
    audit_logs: [],
  },
};

function seedAccount({ id, email, password, fullName, role, status = 'active', companyId, company }) {
  const now = '2026-01-01T00:00:00.000Z';
  const normalizedEmail = email.toLowerCase().trim();
  const authUser = buildAuthUser({
    id,
    email: normalizedEmail,
    fullName,
    role,
    company,
    companyId,
    now,
  });
  state.usersById.set(id, authUser);
  state.passwordsByEmail.set(normalizedEmail, { userId: id, password });
  state.tables.profiles.push({
    id,
    email: normalizedEmail,
    full_name: fullName,
    role,
    status,
    company_id: companyId,
    company,
    profile_picture: null,
    created_at: now,
    updated_at: now,
  });
}

function resetState() {
  state.usersById.clear();
  state.passwordsByEmail.clear();
  state.tokensToUserId.clear();
  state.refreshTokensToUserId.clear();
  state.storageObjects.clear();

  for (const key of Object.keys(state.tables)) {
    state.tables[key] = [];
  }

  const now = '2026-01-01T00:00:00.000Z';

  state.tables.companies.push(
    {
      id: DEFAULT_COMPANY_ID,
      name: DEFAULT_COMPANY_NAME,
      status: 'active',
      created_at: now,
    },
    {
      id: 'comp-acme-002',
      name: 'ACME CORP',
      status: 'active',
      created_at: now,
    }
  );

  // Pre-seeded accounts for multi-role E2E testing
  seedAccount({
    id: '00000000-0000-4000-8000-000000000001',
    email: 'admin@helpdesk.ai',
    password: 'AdminPass@123',
    fullName: 'Test Admin',
    role: 'admin',
    status: 'active',
    companyId: DEFAULT_COMPANY_ID,
    company: DEFAULT_COMPANY_NAME,
  });

  seedAccount({
    id: '00000000-0000-4000-8000-000000000002',
    email: 'agent@helpdesk.ai',
    password: 'AgentPass@123',
    fullName: 'Support Agent',
    role: 'agent',
    status: 'active',
    companyId: DEFAULT_COMPANY_ID,
    company: DEFAULT_COMPANY_NAME,
  });

  seedAccount({
    id: '00000000-0000-4000-8000-000000000003',
    email: 'employee@helpdesk.ai',
    password: 'UserPass@123',
    fullName: 'Jane Employee',
    role: 'user',
    status: 'active',
    companyId: DEFAULT_COMPANY_ID,
    company: DEFAULT_COMPANY_NAME,
  });

  state.tables.system_settings.push({
    id: 'settings-001',
    company_id: DEFAULT_COMPANY_ID,
    ai_confidence_threshold: 0.8,
    duplicate_sensitivity: 0.85,
    enable_auto_resolve: false,
    auto_close_days: 7,
    email_notifications: true,
    admin_alerts: true,
    created_at: now,
    updated_at: now,
  });
}

resetState();

function createSessionForUser(user) {
  const expiresIn = 3600;
  const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
  const accessToken = createJwt(user, expiresAt);
  const refreshToken = `rt_${crypto.randomUUID()}`;
  state.tokensToUserId.set(accessToken, user.id);
  state.refreshTokensToUserId.set(refreshToken, user.id);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user,
  };
}

// ─── HTTP Helpers ────────────────────────────────────────────────────────────
const ALLOWED_CORS_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const ALLOWED_CORS_HEADERS =
  'authorization, apikey, content-type, accept, accept-profile, content-profile, prefer, range, x-client-info, x-supabase-api-version, x-upsert, cache-control, pragma';

function resolveAllowedOrigin(originHeader) {
  for (const allowed of ALLOWED_CORS_ORIGINS) {
    if (allowed === originHeader) {
      return allowed;
    }
  }
  return 'http://localhost:5173';
}

function setCorsHeaders(req, res) {
  const safeOrigin = resolveAllowedOrigin(req.headers.origin);
  res.setHeader('Access-Control-Allow-Origin', safeOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS'
  );
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_CORS_HEADERS);
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Range, X-Total-Count'
  );
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  });
  res.end(body);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readRawBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return {};
  }
}

// ─── PostgREST Filter & Relation Engine ──────────────────────────────────────
function splitTopLevelCommas(str) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inQuotes = false;

  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (ch === '"' && str[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (!inQuotes && ch === '(') {
      depth += 1;
      current += ch;
    } else if (!inQuotes && ch === ')') {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (!inQuotes && depth === 0 && ch === ',') {
      if (current.trim()) parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquote(val) {
  const s = String(val ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function valuesEqual(rowVal, targetStr) {
  const clean = unquote(targetStr);
  if (rowVal === null || rowVal === undefined) return false;
  if (typeof rowVal === 'boolean') {
    return String(rowVal).toLowerCase() === clean.toLowerCase();
  }
  if (typeof rowVal === 'number') {
    return Number(clean) === rowVal;
  }
  return String(rowVal) === clean;
}

function matchCondition(row, col, expr) {
  let negated = false;
  let rest = expr;
  if (rest.startsWith('not.')) {
    negated = true;
    rest = rest.slice(4);
  }

  const dotIdx = rest.indexOf('.');
  const op = dotIdx === -1 ? rest : rest.slice(0, dotIdx);
  const rawVal = dotIdx === -1 ? '' : rest.slice(dotIdx + 1);
  const rowVal = row[col];

  let matched = true;
  switch (op) {
    case 'eq':
      matched = valuesEqual(rowVal, rawVal);
      break;
    case 'neq':
      matched = !valuesEqual(rowVal, rawVal);
      break;
    case 'is': {
      const target = rawVal.toLowerCase();
      if (target === 'null') matched = rowVal === null || rowVal === undefined;
      else if (target === 'true') matched = rowVal === true;
      else if (target === 'false') matched = rowVal === false;
      break;
    }
    case 'in': {
      const inner = rawVal.startsWith('(') && rawVal.endsWith(')')
        ? rawVal.slice(1, -1)
        : rawVal;
      const items = splitTopLevelCommas(inner);
      matched = items.some((item) => valuesEqual(rowVal, item));
      break;
    }
    case 'gt':
      matched = rowVal !== null && rowVal !== undefined && String(rowVal) > unquote(rawVal);
      break;
    case 'gte':
      matched = rowVal !== null && rowVal !== undefined && String(rowVal) >= unquote(rawVal);
      break;
    case 'lt':
      matched = rowVal !== null && rowVal !== undefined && String(rowVal) < unquote(rawVal);
      break;
    case 'lte':
      matched = rowVal !== null && rowVal !== undefined && String(rowVal) <= unquote(rawVal);
      break;
    case 'ilike':
    case 'like': {
      const pattern = unquote(rawVal)
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[*%]/g, '.*');
      const flags = op === 'ilike' ? 'i' : '';
      matched = new RegExp(`^${pattern}$`, flags).test(String(rowVal ?? ''));
      break;
    }
    default:
      matched = true;
  }

  return negated ? !matched : matched;
}

function matchLogicalGroup(row, mode, groupExpr) {
  const inner = groupExpr.startsWith('(') && groupExpr.endsWith(')')
    ? groupExpr.slice(1, -1)
    : groupExpr;
  const clauses = splitTopLevelCommas(inner);
  const evalClause = (clause) => {
    if (clause.startsWith('or(')) {
      return matchLogicalGroup(row, 'or', clause.slice(2));
    }
    if (clause.startsWith('and(')) {
      return matchLogicalGroup(row, 'and', clause.slice(3));
    }
    const firstDot = clause.indexOf('.');
    if (firstDot === -1) return true;
    const col = clause.slice(0, firstDot);
    const expr = clause.slice(firstDot + 1);
    return matchCondition(row, col, expr);
  };
  return mode === 'or' ? clauses.some(evalClause) : clauses.every(evalClause);
}

const RESERVED_QUERY_KEYS = new Set([
  'select',
  'order',
  'limit',
  'offset',
  'columns',
  'on_conflict',
  'apikey',
]);

function filterRows(rows, searchParams) {
  return rows.filter((row) => {
    for (const [key, val] of searchParams.entries()) {
      if (RESERVED_QUERY_KEYS.has(key)) continue;
      if (key === 'or') {
        if (!matchLogicalGroup(row, 'or', val)) return false;
      } else if (key === 'and') {
        if (!matchLogicalGroup(row, 'and', val)) return false;
      } else if (!matchCondition(row, key, val)) {
        return false;
      }
    }
    return true;
  });
}

function sortRows(rows, orderParam) {
  if (!orderParam) return rows;
  const specs = splitTopLevelCommas(orderParam);
  const copy = [...rows];
  copy.sort((a, b) => {
    for (const spec of specs) {
      const [col, dirRaw] = spec.split('.');
      const desc = String(dirRaw || '').toLowerCase() === 'desc';
      const av = a[col] ?? '';
      const bv = b[col] ?? '';
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  });
  return copy;
}

function findProfileById(id) {
  if (!id) return null;
  const p = state.tables.profiles.find((row) => row.id === id);
  return p ? { ...p } : null;
}

function findCompanyById(id) {
  if (!id) return null;
  const c = state.tables.companies.find((row) => row.id === id);
  return c ? { ...c } : null;
}

function enrichRowRelations(tableName, row, selectParam) {
  const enriched = { ...row };
  const sel = String(selectParam || '*');

  if (tableName === 'tickets') {
    if (sel.includes('creator:profiles')) {
      enriched.creator = findProfileById(row.user_id);
    }
    if (sel.includes('assignee:profiles')) {
      enriched.assignee = findProfileById(row.assigned_agent_id);
    }
    if (sel.includes('profiles(')) {
      enriched.profiles = findProfileById(row.user_id);
    }
  } else if (tableName === 'internal_notes') {
    if (sel.includes('profiles')) {
      enriched.profiles = findProfileById(row.agent_id);
    }
  } else if (tableName === 'profiles') {
    if (sel.includes('companies')) {
      enriched.companies = findCompanyById(row.company_id);
    }
  } else if (tableName === 'user_requests') {
    if (sel.includes('profiles') || sel.includes('user:')) {
      const prof = findProfileById(row.user_id);
      enriched.profiles = prof;
      enriched.user = prof;
    }
  }

  return enriched;
}

function ensureTable(tableName) {
  if (!state.tables[tableName]) {
    state.tables[tableName] = [];
  }
  return state.tables[tableName];
}

// ─── Route Handlers ──────────────────────────────────────────────────────────
async function handleAuth(req, res, url) {
  const path = url.pathname;

  if (req.method === 'POST' && path === '/auth/v1/signup') {
    const body = await readJsonBody(req);
    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    if (!email || !password) {
      return sendJson(res, 400, {
        code: 400,
        msg: 'Email and password are required',
        message: 'Email and password are required',
      });
    }

    if (state.passwordsByEmail.has(email)) {
      return sendJson(res, 422, {
        code: 422,
        error_code: 'user_already_exists',
        msg: 'User already registered',
        message: 'User already registered',
      });
    }

    const meta = body.data || body.options?.data || {};
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const fullName = meta.full_name || 'New Employee';
    const role = meta.role || 'user';
    const companyName = meta.company || DEFAULT_COMPANY_NAME;
    const matchedCompany =
      state.tables.companies.find((c) => c.id === meta.company_id) ||
      state.tables.companies.find(
        (c) => c.name.toLowerCase() === String(companyName).toLowerCase()
      );
    const companyId = meta.company_id || matchedCompany?.id || DEFAULT_COMPANY_ID;
    const initialStatus = meta.status || 'pending_approval';

    const user = buildAuthUser({
      id: userId,
      email,
      fullName,
      role,
      company: companyName,
      companyId,
      extraMeta: meta,
      now,
    });

    state.usersById.set(userId, user);
    state.passwordsByEmail.set(email, { userId, password });

    state.tables.profiles.push({
      id: userId,
      email,
      full_name: fullName,
      role,
      status: initialStatus,
      company: companyName,
      company_id: companyId,
      profile_picture: null,
      created_at: now,
      updated_at: now,
    });

    state.tables.user_requests.push({
      id: crypto.randomUUID(),
      user_id: userId,
      company_id: companyId,
      status: 'pending',
      created_at: now,
    });

    const session = createSessionForUser(user);
    return sendJson(res, 200, session);
  }

  if (req.method === 'POST' && path === '/auth/v1/token') {
    const grantType = url.searchParams.get('grant_type') || 'password';
    const body = await readJsonBody(req);

    if (grantType === 'refresh_token') {
      const rt = body.refresh_token;
      const userId = state.refreshTokensToUserId.get(rt);
      const user = userId ? state.usersById.get(userId) : null;
      if (!user) {
        return sendJson(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid Refresh Token',
        });
      }
      return sendJson(res, 200, createSessionForUser(user));
    }

    const email = String(body.email || '').toLowerCase().trim();
    const password = String(body.password || '');
    const cred = state.passwordsByEmail.get(email);
    if (!cred || cred.password !== password) {
      return sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
        msg: 'Invalid login credentials',
        message: 'Invalid login credentials',
      });
    }

    const user = state.usersById.get(cred.userId);
    user.last_sign_in_at = new Date().toISOString();
    return sendJson(res, 200, createSessionForUser(user));
  }

  if (req.method === 'GET' && path === '/auth/v1/user') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const userId = state.tokensToUserId.get(token) || decodeJwtSub(token);
    const user = userId ? state.usersById.get(userId) : null;
    if (!user) {
      return sendJson(res, 401, {
        code: 401,
        msg: 'Invalid JWT',
        message: 'Invalid JWT',
      });
    }
    return sendJson(res, 200, user);
  }

  if (req.method === 'POST' && path === '/auth/v1/logout') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token) state.tokensToUserId.delete(token);
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && (path === '/auth/v1/otp' || path === '/auth/v1/recover')) {
    return sendJson(res, 200, {});
  }

  return sendJson(res, 200, {});
}

async function handleRest(req, res, url) {
  const tableName = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\//, '').split('/')[0]);
  if (!tableName) {
    return sendJson(res, 200, {});
  }
  if (tableName.startsWith('rpc/')) {
    return sendJson(res, 200, []);
  }

  const table = ensureTable(tableName);
  const accept = String(req.headers.accept || '');
  const prefer = String(req.headers.prefer || '');
  const wantsSingleObject = accept.includes('application/vnd.pgrst.object+json');
  const selectParam = url.searchParams.get('select') || '*';

  if (req.method === 'GET' || req.method === 'HEAD') {
    let matched = filterRows(table, url.searchParams);
    const totalCount = matched.length;
    matched = sortRows(matched, url.searchParams.get('order'));

    const offset = Number(url.searchParams.get('offset') || 0);
    const limitParam = url.searchParams.get('limit');
    if (limitParam !== null) {
      matched = matched.slice(offset, offset + Number(limitParam));
    } else if (offset > 0) {
      matched = matched.slice(offset);
    }

    const enriched = matched.map((row) => enrichRowRelations(tableName, row, selectParam));

    if (wantsSingleObject) {
      if (enriched.length !== 1) {
        return sendJson(res, 406, {
          code: 'PGRST116',
          details: `The result contains ${enriched.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        });
      }
      return sendJson(res, 200, enriched[0]);
    }

    const contentRange =
      enriched.length > 0
        ? `${offset}-${offset + enriched.length - 1}/${totalCount}`
        : `*/${totalCount}`;

    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Range': contentRange });
      return res.end();
    }

    return sendJson(res, 200, enriched, { 'Content-Range': contentRange });
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const items = Array.isArray(body) ? body : [body];
    const now = new Date().toISOString();
    const isUpsert = prefer.includes('resolution=merge-duplicates');
    const conflictKey = url.searchParams.get('on_conflict') || 'id';

    const inserted = items.map((rawItem) => {
      const item = { ...rawItem };
      if (!item.id) item.id = crypto.randomUUID();
      if (!item.created_at) item.created_at = now;
      if (!item.updated_at) item.updated_at = now;

      if (tableName === 'tickets') {
        if (!item.subject && item.summary) item.subject = item.summary;
        if (!item.summary && item.subject) item.summary = item.subject;
        if (!item.status) item.status = 'pending_human';
      }

      if (isUpsert) {
        const existingIdx = table.findIndex(
          (r) => item[conflictKey] !== undefined && r[conflictKey] === item[conflictKey]
        );
        if (existingIdx !== -1) {
          table[existingIdx] = { ...table[existingIdx], ...item, updated_at: now };
          return enrichRowRelations(tableName, table[existingIdx], selectParam);
        }
      }

      table.push(item);
      return enrichRowRelations(tableName, item, selectParam);
    });

    if (wantsSingleObject) {
      return sendJson(res, 201, inserted[0] || null);
    }
    return sendJson(res, 201, inserted);
  }

  if (req.method === 'PATCH') {
    const updates = await readJsonBody(req);
    const matched = filterRows(table, url.searchParams);
    const now = new Date().toISOString();

    const updatedRows = matched.map((row) => {
      Object.assign(row, updates, { updated_at: now });
      if (tableName === 'tickets') {
        if (updates.subject && !updates.summary) row.summary = updates.subject;
        if (updates.summary && !updates.subject) row.subject = updates.summary;
      }
      // Keep auth user metadata synced if profile role/status changes
      if (tableName === 'profiles' && state.usersById.has(row.id)) {
        const u = state.usersById.get(row.id);
        u.user_metadata = {
          ...u.user_metadata,
          role: row.role,
          company: row.company,
          company_id: row.company_id,
          full_name: row.full_name,
        };
        u.updated_at = now;
      }
      return enrichRowRelations(tableName, row, selectParam);
    });

    if (wantsSingleObject) {
      if (updatedRows.length !== 1) {
        return sendJson(res, 406, {
          code: 'PGRST116',
          details: `The result contains ${updatedRows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        });
      }
      return sendJson(res, 200, updatedRows[0]);
    }
    return sendJson(res, 200, updatedRows);
  }

  if (req.method === 'DELETE') {
    const matched = new Set(filterRows(table, url.searchParams));
    const deleted = [];
    state.tables[tableName] = table.filter((row) => {
      if (matched.has(row)) {
        deleted.push({ ...row });
        return false;
      }
      return true;
    });
    return sendJson(res, 200, deleted);
  }

  return sendJson(res, 405, { message: 'Method not allowed' });
}

async function handleTestControl(req, res, url) {
  if (url.pathname === '/__test__/reset' && req.method === 'POST') {
    resetState();
    return sendJson(res, 200, { status: 'reset' });
  }

  if (url.pathname === '/__test__/seed' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (Array.isArray(body.accounts)) {
      for (const acc of body.accounts) {
        seedAccount({
          id: acc.id || crypto.randomUUID(),
          email: acc.email,
          password: acc.password || 'Password123!',
          fullName: acc.fullName || acc.full_name || 'Seeded User',
          role: acc.role || 'user',
          status: acc.status || 'active',
          companyId: acc.companyId || acc.company_id || DEFAULT_COMPANY_ID,
          company: acc.company || DEFAULT_COMPANY_NAME,
        });
      }
    }
    if (body.tables && typeof body.tables === 'object') {
      for (const [tableName, rows] of Object.entries(body.tables)) {
        if (Array.isArray(rows)) {
          const table = ensureTable(tableName);
          for (const row of rows) {
            table.push({
              id: crypto.randomUUID(),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...row,
            });
          }
        }
      }
    }
    return sendJson(res, 200, { status: 'seeded' });
  }

  if (url.pathname === '/__test__/state' && req.method === 'GET') {
    return sendJson(res, 200, { tables: state.tables });
  }

  return sendJson(res, 404, { error: 'Unknown test endpoint' });
}

// ─── Phoenix Realtime WebSocket Handler ──────────────────────────────────────
function attachRealtimeWebSocket(server) {
  const frontendRequire = createRequire(
    new URL('../Frontend/package.json', import.meta.url)
  );
  const { WebSocketServer } = frontendRequire('ws');
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msgText = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : String(data);
      try {
        const parsed = JSON.parse(msgText);
        if (Array.isArray(parsed)) {
          // Phoenix v2 serializer: [join_ref, ref, topic, event, payload]
          const [joinRef, ref, topic, event] = parsed;
          if (
            event === 'phx_join' ||
            event === 'heartbeat' ||
            event === 'access_token'
          ) {
            const reply = JSON.stringify([
              joinRef,
              ref,
              topic,
              'phx_reply',
              { status: 'ok', response: { postgres_changes: [] } },
            ]);
            ws.send(reply);
          }
        } else if (parsed && typeof parsed === 'object') {
          // Phoenix v1 serializer: { topic, event, payload, ref, join_ref }
          const { topic, event, ref, join_ref: joinRef } = parsed;
          if (
            event === 'phx_join' ||
            event === 'heartbeat' ||
            event === 'access_token'
          ) {
            const reply = JSON.stringify({
              topic,
              event: 'phx_reply',
              payload: { status: 'ok', response: { postgres_changes: [] } },
              ref,
              join_ref: joinRef,
            });
            ws.send(reply);
          }
        }
      } catch {
        // Ignore malformed WS payloads
      }
    });

    ws.on('error', () => {});
  });
}

// ─── HTTP Server Bootstrap ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (url.pathname === '/health' || url.pathname === '/__test__/health') {
      return sendJson(res, 200, { status: 'ok', service: 'e2e-mock-supabase' });
    }
    if (url.pathname.startsWith('/__test__/')) {
      return await handleTestControl(req, res, url);
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      return await handleAuth(req, res, url);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      return await handleRest(req, res, url);
    }
    if (url.pathname.startsWith('/functions/v1/')) {
      return sendJson(res, 200, { success: true });
    }
    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      const key = url.pathname.replace('/storage/v1/object/public/', '');
      const stored = state.storageObjects.get(key);
      if (!stored) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': stored.contentType || 'application/octet-stream' });
      return res.end(stored.buffer);
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const key = url.pathname.replace('/storage/v1/object/', '');
      const buf = await readRawBody(req);
      state.storageObjects.set(key, {
        buffer: buf,
        contentType: req.headers['content-type'] || 'application/octet-stream',
      });
      return sendJson(res, 200, { Key: key, Id: crypto.randomUUID() });
    }

    return sendJson(res, 200, { status: 'ok' });
  } catch (err) {
    console.error('[e2e-mock-supabase] Error handling request:', err);
    return sendJson(res, 500, { message: err.message || 'Internal server error' });
  }
});

attachRealtimeWebSocket(server);

server.listen(PORT, HOST, () => {
  console.log(`[e2e-mock-supabase] Listening on http://${HOST}:${PORT}`);
});
