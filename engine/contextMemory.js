import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import { readJsonSafe, writeJsonSafe } from './fileSystem.js';

const MEMORY_VERSION = 1;
const DEFAULT_MEMORY_STORE = {
  version: MEMORY_VERSION,
  sessions: [],
};

function normalizeMemoryShape(memoryStore) {
  if (!memoryStore || typeof memoryStore !== 'object') {
    return {
      value: { ...DEFAULT_MEMORY_STORE },
      changed: true,
    };
  }

  const version =
    typeof memoryStore.version === 'number' ? memoryStore.version : MEMORY_VERSION;
  const sessions = Array.isArray(memoryStore.sessions) ? memoryStore.sessions : [];
  const changed = version !== memoryStore.version || sessions !== memoryStore.sessions;

  return {
    value: {
      version,
      sessions,
    },
    changed,
  };
}

export class ContextMemory {
  constructor(memoryFilePath = platformConfig.memoryFileLocation) {
    this.memoryFilePath = memoryFilePath;
  }

  async initialize() {
    const existingStore = await readJsonSafe(this.memoryFilePath, {
      defaultValue: null,
    });

    if (!existingStore) {
      await writeJsonSafe(this.memoryFilePath, DEFAULT_MEMORY_STORE);
      return { ...DEFAULT_MEMORY_STORE };
    }

    const normalizedStore = normalizeMemoryShape(existingStore);

    if (normalizedStore.changed) {
      await writeJsonSafe(this.memoryFilePath, normalizedStore.value);
    }

    return normalizedStore.value;
  }

  async saveSession(session) {
    if (!session || typeof session !== 'object') {
      throw new TypeError('Session payload must be an object.');
    }

    const store = await this.initialize();
    const timestamp = new Date().toISOString();
    const nextSession = {
      id: session.id ?? randomUUID(),
      taskId: session.taskId ?? null,
      name: typeof session.name === 'string' ? session.name : 'Untitled Session',
      summary: typeof session.summary === 'string' ? session.summary : '',
      status: typeof session.status === 'string' ? session.status : 'active',
      data: session.data ?? {},
      createdAt: session.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    store.sessions = store.sessions.filter(
      (existingSession) => existingSession.id !== nextSession.id,
    );
    store.sessions.push(nextSession);

    await writeJsonSafe(this.memoryFilePath, store);

    return nextSession;
  }

  async getRecentSessions(limit = 10) {
    const normalizedLimit =
      Number.isInteger(limit) && limit > 0 ? limit : 10;
    const store = await this.initialize();

    return [...store.sessions]
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
      .slice(0, normalizedLimit);
  }

  async getSessionById(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      throw new TypeError('Session id is required.');
    }

    const store = await this.initialize();
    return store.sessions.find((session) => session.id === sessionId.trim()) ?? null;
  }
}

const contextMemory = new ContextMemory();

export default contextMemory;
