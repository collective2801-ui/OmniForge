import { randomUUID } from 'node:crypto';
import {
  createServiceRoleSupabaseClient,
  isSupabaseAdminConfigured,
} from './supabaseClient.js';

const FALLBACK_EVENTS = [];

function getPersistenceClient() {
  return isSupabaseAdminConfigured ? createServiceRoleSupabaseClient() : null;
}

function normalizeEventRow(row = {}) {
  return {
    id: row.stripe_event_id ?? '',
    type: row.event_type ?? '',
    userId: row.user_id ?? null,
    payload: row.payload ?? {},
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

function createEventId(prefix = 'event') {
  return `omniforge_${prefix}_${randomUUID()}`;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function isPersistenceAvailable() {
  return Boolean(getPersistenceClient());
}

export async function recordPlatformEvent({
  eventType = '',
  payload = {},
  userId = null,
  eventId = '',
} = {}) {
  if (typeof eventType !== 'string' || eventType.trim().length === 0) {
    throw new TypeError('eventType is required.');
  }

  const normalizedEvent = {
    stripe_event_id:
      typeof eventId === 'string' && eventId.trim().length > 0
        ? eventId.trim()
        : createEventId(eventType.replace(/[^a-z0-9]+/gi, '_').toLowerCase()),
    event_type: eventType.trim(),
    user_id: typeof userId === 'string' && userId.trim().length > 0 ? userId.trim() : null,
    payload: payload && typeof payload === 'object' ? payload : {},
    created_at: new Date().toISOString(),
  };

  const client = getPersistenceClient();

  if (!client) {
    FALLBACK_EVENTS.push(normalizedEvent);
    return normalizeEventRow(normalizedEvent);
  }

  const { data, error } = await client
    .from('billing_events')
    .upsert(normalizedEvent, {
      onConflict: 'stripe_event_id',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeEventRow(data ?? normalizedEvent);
}

export async function listPlatformEvents({
  eventType = '',
  eventTypes = [],
  prefix = '',
  userId = '',
  limit = 100,
  ascending = false,
} = {}) {
  const normalizedEventTypes = unique(
    Array.isArray(eventTypes)
      ? eventTypes
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      : [],
  );
  const normalizedPrefix = typeof prefix === 'string' ? prefix.trim() : '';
  const normalizedEventType = typeof eventType === 'string' ? eventType.trim() : '';
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  const normalizedLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 1000) : 100;

  const client = getPersistenceClient();

  if (!client) {
    return FALLBACK_EVENTS
      .map(normalizeEventRow)
      .filter((entry) => {
        if (normalizedEventType && entry.type !== normalizedEventType) {
          return false;
        }

        if (normalizedEventTypes.length > 0 && !normalizedEventTypes.includes(entry.type)) {
          return false;
        }

        if (normalizedPrefix && !entry.type.startsWith(normalizedPrefix)) {
          return false;
        }

        if (normalizedUserId && entry.userId !== normalizedUserId) {
          return false;
        }

        return true;
      })
      .sort((left, right) =>
        ascending
          ? new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
          : new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      )
      .slice(0, normalizedLimit);
  }

  let query = client
    .from('billing_events')
    .select('*')
    .order('created_at', { ascending });

  if (normalizedEventType) {
    query = query.eq('event_type', normalizedEventType);
  }

  if (normalizedEventTypes.length > 0) {
    query = query.in('event_type', normalizedEventTypes);
  }

  if (normalizedPrefix) {
    query = query.like('event_type', `${normalizedPrefix}%`);
  }

  if (normalizedUserId) {
    query = query.eq('user_id', normalizedUserId);
  }

  const { data, error } = await query.limit(normalizedLimit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(normalizeEventRow);
}

function applyDataEvent(tables, event) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const tableName =
    typeof payload.table === 'string' && payload.table.trim().length > 0
      ? payload.table.trim()
      : '';

  if (!tableName) {
    return tables;
  }

  if (!Array.isArray(tables[tableName])) {
    tables[tableName] = [];
  }

  switch (event.type) {
    case 'app_data.create_table':
      tables[tableName] = Array.isArray(tables[tableName]) ? tables[tableName] : [];
      break;
    case 'app_data.insert': {
      const row = payload.row && typeof payload.row === 'object' ? payload.row : null;

      if (!row) {
        break;
      }

      tables[tableName] = [
        ...tables[tableName].filter((entry) => entry?.id !== row.id),
        row,
      ];
      break;
    }
    case 'app_data.update': {
      const rowId =
        typeof payload.rowId === 'string' && payload.rowId.trim().length > 0
          ? payload.rowId.trim()
          : '';
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : null;

      if (!rowId || !patch) {
        break;
      }

      tables[tableName] = tables[tableName].map((entry) =>
        entry?.id === rowId ? { ...entry, ...patch } : entry,
      );
      break;
    }
    case 'app_data.remove': {
      const rowId =
        typeof payload.rowId === 'string' && payload.rowId.trim().length > 0
          ? payload.rowId.trim()
          : '';

      if (!rowId) {
        break;
      }

      tables[tableName] = tables[tableName].filter((entry) => entry?.id !== rowId);
      break;
    }
    default:
      break;
  }

  return tables;
}

export async function loadPersistentTables() {
  const events = await listPlatformEvents({
    prefix: 'app_data.',
    limit: 1000,
    ascending: true,
  });

  return events.reduce(applyDataEvent, {});
}

export async function persistTableCreate(table) {
  return recordPlatformEvent({
    eventType: 'app_data.create_table',
    payload: {
      table,
    },
  });
}

export async function persistTableInsert(table, row) {
  return recordPlatformEvent({
    eventType: 'app_data.insert',
    payload: {
      table,
      row,
    },
  });
}

export async function persistTableUpdate(table, rowId, patch) {
  return recordPlatformEvent({
    eventType: 'app_data.update',
    payload: {
      table,
      rowId,
      patch,
    },
  });
}

export async function persistTableRemove(table, rowId) {
  return recordPlatformEvent({
    eventType: 'app_data.remove',
    payload: {
      table,
      rowId,
    },
  });
}

export default {
  isPersistenceAvailable,
  recordPlatformEvent,
  listPlatformEvents,
  loadPersistentTables,
  persistTableCreate,
  persistTableInsert,
  persistTableUpdate,
  persistTableRemove,
};
