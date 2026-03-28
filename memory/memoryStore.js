import path from 'node:path';
import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import {
  ensureDirectory,
  readJsonSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const MEMORY_STORE_VERSION = 1;
const DEFAULT_MEMORY_STORE = Object.freeze({
  version: MEMORY_STORE_VERSION,
  memories: [],
});

function createMemoryStorePath() {
  return path.join(platformConfig.rootDirectory, 'memory', 'memory-store.json');
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

function tokenizePrompt(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function normalizeMemoryRecord(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('Memory entry must be an object.');
  }

  const timestamp = new Date().toISOString();
  const project = entry.project && typeof entry.project === 'object'
    ? {
        projectId: normalizeText(entry.project.projectId, null),
        projectName: normalizeText(entry.project.projectName, ''),
        projectPath: normalizeText(entry.project.projectPath, ''),
        projectType: normalizeText(entry.project.projectType, ''),
      }
    : null;

  return {
    id: normalizeText(entry.id, randomUUID()),
    sessionId: normalizeText(entry.sessionId, null),
    taskId: normalizeText(entry.taskId, null),
    userId: normalizeText(entry.userId, 'anonymous'),
    prompt: normalizeText(entry.prompt, ''),
    intent: entry.intent && typeof entry.intent === 'object' ? entry.intent : {},
    output: entry.output && typeof entry.output === 'object' ? entry.output : {},
    project,
    decisions: normalizeArray(entry.decisions),
    status: normalizeText(entry.status, 'completed'),
    tags: normalizeArray(entry.tags),
    createdAt: normalizeText(entry.createdAt, timestamp),
    updatedAt: timestamp,
    completedAt: normalizeText(entry.completedAt, timestamp),
  };
}

function normalizeStoreShape(store) {
  if (!store || typeof store !== 'object') {
    return {
      value: { ...DEFAULT_MEMORY_STORE },
      changed: true,
    };
  }

  const version =
    typeof store.version === 'number' ? store.version : MEMORY_STORE_VERSION;
  const memories = Array.isArray(store.memories)
    ? store.memories.filter((entry) => entry && typeof entry === 'object')
    : [];

  return {
    value: {
      version,
      memories,
    },
    changed: version !== store.version || memories !== store.memories,
  };
}

function scoreMemoryRelevance(memory, intent, prompt, userId) {
  let score = 0;
  const memoryFeatures = new Set(memory.intent?.features ?? []);
  const intentFeatures = new Set(intent?.features ?? []);
  const promptTokens = new Set(tokenizePrompt(prompt));
  const memoryTokens = new Set(tokenizePrompt(memory.prompt));

  if (userId && memory.userId === userId) {
    score += 5;
  }

  if (memory.intent?.projectType && memory.intent.projectType === intent?.projectType) {
    score += 4;
  }

  for (const feature of intentFeatures) {
    if (memoryFeatures.has(feature)) {
      score += 2;
    }
  }

  for (const token of promptTokens) {
    if (memoryTokens.has(token)) {
      score += 1;
    }
  }

  if (memory.status === 'completed' || memory.status === 'configured' || memory.status === 'deployed' || memory.status === 'domain_ready') {
    score += 2;
  }

  return score;
}

export class MemoryStore {
  constructor(memoryFilePath = createMemoryStorePath()) {
    this.memoryFilePath = path.resolve(memoryFilePath);
  }

  async initialize() {
    await ensureDirectory(path.dirname(this.memoryFilePath));

    const existingStore = await readJsonSafe(this.memoryFilePath, {
      defaultValue: null,
    });

    if (!existingStore) {
      await writeJsonSafe(this.memoryFilePath, DEFAULT_MEMORY_STORE);
      return { ...DEFAULT_MEMORY_STORE };
    }

    const normalizedStore = normalizeStoreShape(existingStore);

    if (normalizedStore.changed) {
      await writeJsonSafe(this.memoryFilePath, normalizedStore.value);
    }

    return normalizedStore.value;
  }

  async saveMemory(entry) {
    const store = await this.initialize();
    const nextEntry = normalizeMemoryRecord(entry);

    store.memories = store.memories.filter(
      (memory) => memory.id !== nextEntry.id,
    );
    store.memories.push(nextEntry);

    await writeJsonSafe(this.memoryFilePath, store);

    return nextEntry;
  }

  async getAllMemories() {
    const store = await this.initialize();

    return [...store.memories].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
  }

  async getRecentMemories(limit = 10) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const memories = await this.getAllMemories();

    return memories.slice(0, normalizedLimit);
  }

  async getMemoryById(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('Memory id is required.');
    }

    const store = await this.initialize();
    return store.memories.find((entry) => entry.id === id.trim()) ?? null;
  }

  async findRelevantMemories(intent, {
    prompt = '',
    userId = '',
    limit = 5,
  } = {}) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const memories = await this.getAllMemories();

    return memories
      .map((memory) => ({
        ...memory,
        relevanceScore: scoreMemoryRelevance(memory, intent, prompt, userId),
      }))
      .filter((memory) => memory.relevanceScore > 0)
      .sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, normalizedLimit);
  }
}

const memoryStore = new MemoryStore();

export async function saveMemory(entry) {
  return memoryStore.saveMemory(entry);
}

export async function getRecentMemories(limit = 10) {
  return memoryStore.getRecentMemories(limit);
}

export async function getMemoryById(id) {
  return memoryStore.getMemoryById(id);
}

export default memoryStore;
