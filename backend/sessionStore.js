import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  createServiceRoleSupabaseClient,
  isSupabaseAdminConfigured,
} from './supabaseClient.js';

const memorySessions = new Map();
const DEFAULT_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 60 * 60 * 24 * 7);

function getSessionClient() {
  return isSupabaseAdminConfigured ? createServiceRoleSupabaseClient() : null;
}

function getSessionSecret() {
  return process.env.SESSION_SECRET?.trim() || 'omniforge-session-secret';
}

function createSessionToken() {
  return `${randomUUID()}.${randomBytes(32).toString('hex')}`;
}

function hashSessionToken(token) {
  return createHash('sha256')
    .update(`${getSessionSecret()}:${token}`)
    .digest('hex');
}

function resolveUserRole(user) {
  return (
    user?.role ??
    user?.access?.role ??
    user?.app_metadata?.role ??
    user?.user_metadata?.role ??
    'user'
  );
}

function createExpiryIso(ttlSeconds = DEFAULT_TTL_SECONDS) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function normalizeMemorySession(session) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    userId: session.userId,
    email: session.email,
    role: session.role,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    storage: 'memory',
  };
}

function createMemorySession(token, user, metadata = {}) {
  const timestamp = new Date().toISOString();
  const expiresAt = createExpiryIso(metadata.ttlSeconds);
  const { userAgent, ipAddress } = getRequestFingerprintMetadata(metadata);
  const session = {
    id: randomUUID(),
    userId: user.id,
    email: user.email ?? '',
    role: resolveUserRole(user),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
    expiresAt,
    userAgent,
    ipAddress,
  };

  memorySessions.set(hashSessionToken(token), session);
  return normalizeMemorySession(session);
}

function normalizeSupabaseSession(session) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    userId: session.user_id,
    email: session.email,
    role: session.role,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at,
    storage: 'supabase',
  };
}

function getRequestFingerprintMetadata(metadata = {}) {
  return {
    userAgent:
      typeof metadata.userAgent === 'string' ? metadata.userAgent.slice(0, 512) : '',
    ipAddress:
      typeof metadata.ipAddress === 'string' ? metadata.ipAddress.slice(0, 128) : '',
  };
}

export async function createAppSession(user, metadata = {}) {
  if (!user || typeof user !== 'object' || typeof user.id !== 'string') {
    throw new TypeError('A valid user is required to create an app session.');
  }

  const token = createSessionToken();
  const expiresAt = createExpiryIso(metadata.ttlSeconds);
  const timestamp = new Date().toISOString();
  const { userAgent, ipAddress } = getRequestFingerprintMetadata(metadata);
  const client = getSessionClient();

  if (!client) {
    return {
      token,
      session: createMemorySession(token, user, metadata),
    };
  }

  const payload = {
    id: randomUUID(),
    user_id: user.id,
    email: user.email ?? '',
    role: resolveUserRole(user),
    session_token_hash: hashSessionToken(token),
    user_agent: userAgent,
    ip_address: ipAddress,
    status: 'active',
    expires_at: expiresAt,
    created_at: timestamp,
    updated_at: timestamp,
    last_seen_at: timestamp,
  };

  try {
    const { data, error } = await client
      .from('app_sessions')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      token,
      session: normalizeSupabaseSession(data),
    };
  } catch {
    return {
      token,
      session: createMemorySession(token, user, metadata),
    };
  }
}

export async function getAppSession(token) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return null;
  }

  const tokenHash = hashSessionToken(token.trim());
  const client = getSessionClient();

  if (!client) {
    const session = memorySessions.get(tokenHash);

    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      memorySessions.delete(tokenHash);
      return null;
    }

    return normalizeMemorySession(session);
  }

  try {
    const { data, error } = await client
      .from('app_sessions')
      .select('*')
      .eq('session_token_hash', tokenHash)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return normalizeSupabaseSession(data);
  } catch {
    const session = memorySessions.get(tokenHash);

    if (!session) {
      return null;
    }

    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      memorySessions.delete(tokenHash);
      return null;
    }

    return normalizeMemorySession(session);
  }
}

export async function touchAppSession(token, metadata = {}) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return null;
  }

  const tokenHash = hashSessionToken(token.trim());
  const timestamp = new Date().toISOString();
  const { userAgent, ipAddress } = getRequestFingerprintMetadata(metadata);
  const client = getSessionClient();

  if (!client) {
    const session = memorySessions.get(tokenHash);

    if (!session) {
      return null;
    }

    session.updatedAt = timestamp;
    session.lastSeenAt = timestamp;
    if (userAgent) {
      session.userAgent = userAgent;
    }
    if (ipAddress) {
      session.ipAddress = ipAddress;
    }
    return normalizeMemorySession(session);
  }

  try {
    const { data, error } = await client
      .from('app_sessions')
      .update({
        updated_at: timestamp,
        last_seen_at: timestamp,
        ...(userAgent ? { user_agent: userAgent } : {}),
        ...(ipAddress ? { ip_address: ipAddress } : {}),
      })
      .eq('session_token_hash', tokenHash)
      .select('*')
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return normalizeSupabaseSession(data);
  } catch {
    const session = memorySessions.get(tokenHash);

    if (!session) {
      return null;
    }

    session.updatedAt = timestamp;
    session.lastSeenAt = timestamp;
    if (userAgent) {
      session.userAgent = userAgent;
    }
    if (ipAddress) {
      session.ipAddress = ipAddress;
    }
    return normalizeMemorySession(session);
  }
}

export async function deleteAppSession(token) {
  if (typeof token !== 'string' || token.trim().length === 0) {
    return false;
  }

  const tokenHash = hashSessionToken(token.trim());
  const client = getSessionClient();

  if (!client) {
    return memorySessions.delete(tokenHash);
  }

  try {
    const { error } = await client
      .from('app_sessions')
      .delete()
      .eq('session_token_hash', tokenHash);

    if (error) {
      throw new Error(error.message);
    }

    return true;
  } catch {
    return memorySessions.delete(tokenHash);
  }
}

export default {
  createAppSession,
  getAppSession,
  touchAppSession,
  deleteAppSession,
};
