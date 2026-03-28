import path from 'node:path';
import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import {
  ensureDirectory,
  readJsonSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const SESSION_STORE_VERSION = 1;
const DEFAULT_SESSION_STORE = Object.freeze({
  version: SESSION_STORE_VERSION,
  sessions: [],
});

function createSessionStorePath() {
  return path.join(platformConfig.rootDirectory, 'memory', 'session-store.json');
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeArray(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.filter(Boolean);
}

function normalizeSessionRecord(session) {
  if (!session || typeof session !== 'object') {
    throw new TypeError('Session payload must be an object.');
  }

  const timestamp = new Date().toISOString();

  return {
    id: normalizeText(session.id, randomUUID()),
    userId: normalizeText(session.userId, 'anonymous'),
    prompt: normalizeText(session.prompt, ''),
    intent: session.intent && typeof session.intent === 'object' ? session.intent : null,
    output: session.output && typeof session.output === 'object' ? session.output : null,
    decisions: normalizeArray(session.decisions),
    status: normalizeText(session.status, 'active'),
    createdAt: normalizeText(session.createdAt, timestamp),
    updatedAt: timestamp,
  };
}

function normalizeStoreShape(store) {
  if (!store || typeof store !== 'object') {
    return {
      value: { ...DEFAULT_SESSION_STORE },
      changed: true,
    };
  }

  const version =
    typeof store.version === 'number' ? store.version : SESSION_STORE_VERSION;
  const sessions = Array.isArray(store.sessions)
    ? store.sessions.filter((entry) => entry && typeof entry === 'object')
    : [];

  return {
    value: {
      version,
      sessions,
    },
    changed: version !== store.version || sessions !== store.sessions,
  };
}

export class SessionManager {
  constructor(sessionFilePath = createSessionStorePath()) {
    this.sessionFilePath = path.resolve(sessionFilePath);
  }

  async initialize() {
    await ensureDirectory(path.dirname(this.sessionFilePath));

    const existingStore = await readJsonSafe(this.sessionFilePath, {
      defaultValue: null,
    });

    if (!existingStore) {
      await writeJsonSafe(this.sessionFilePath, DEFAULT_SESSION_STORE);
      return { ...DEFAULT_SESSION_STORE };
    }

    const normalizedStore = normalizeStoreShape(existingStore);

    if (normalizedStore.changed) {
      await writeJsonSafe(this.sessionFilePath, normalizedStore.value);
    }

    return normalizedStore.value;
  }

  async createSession(payload) {
    const store = await this.initialize();
    const nextSession = normalizeSessionRecord(payload);

    store.sessions = store.sessions.filter(
      (session) => session.id !== nextSession.id,
    );
    store.sessions.push(nextSession);

    await writeJsonSafe(this.sessionFilePath, store);

    return nextSession;
  }

  async updateSession(sessionId, updates = {}) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new TypeError('Session id is required.');
    }

    if (!updates || typeof updates !== 'object') {
      throw new TypeError('Session updates must be an object.');
    }

    const store = await this.initialize();
    const sessionIndex = store.sessions.findIndex(
      (session) => session.id === sessionId.trim(),
    );

    if (sessionIndex === -1) {
      return null;
    }

    const currentSession = store.sessions[sessionIndex];
    const nextSession = normalizeSessionRecord({
      ...currentSession,
      ...updates,
      id: currentSession.id,
      createdAt: currentSession.createdAt,
    });

    store.sessions[sessionIndex] = nextSession;
    await writeJsonSafe(this.sessionFilePath, store);

    return nextSession;
  }

  async appendDecision(sessionId, decision) {
    const session = await this.getSessionById(sessionId);

    if (!session) {
      return null;
    }

    const nextDecisions = [...(session.decisions ?? []), decision].filter(Boolean);
    return this.updateSession(sessionId, {
      decisions: nextDecisions,
    });
  }

  async getSessionById(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new TypeError('Session id is required.');
    }

    const store = await this.initialize();
    return store.sessions.find((session) => session.id === sessionId.trim()) ?? null;
  }

  async getRecentSessions(limit = 10) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const store = await this.initialize();

    return [...store.sessions]
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
      .slice(0, normalizedLimit);
  }
}

const sessionManager = new SessionManager();

export default sessionManager;
