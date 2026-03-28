import path from 'node:path';
import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import {
  ensureDirectory,
  readJsonSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const STORE_VERSION = 1;
const DEFAULT_STORE = Object.freeze({
  version: STORE_VERSION,
  entries: [],
});

function createStorePath() {
  return path.join(platformConfig.rootDirectory, 'memory', 'store.json');
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeFeatures(features = []) {
  if (!Array.isArray(features)) {
    return [];
  }

  return [...new Set(
    features
      .map((feature) => (typeof feature === 'string' ? feature.trim() : ''))
      .filter(Boolean),
  )];
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('Memory entry must be an object.');
  }

  const timestamp = new Date().toISOString();
  const intent = entry.intent && typeof entry.intent === 'object' ? entry.intent : {};

  return {
    id: normalizeText(entry.id, randomUUID()),
    input: normalizeText(entry.input, entry.prompt ?? ''),
    prompt: normalizeText(entry.prompt, entry.input ?? ''),
    decisions: entry.decisions && typeof entry.decisions === 'object' ? entry.decisions : {},
    outputs: entry.outputs && typeof entry.outputs === 'object' ? entry.outputs : {},
    intent: {
      goal: normalizeText(intent.goal, ''),
      projectType: normalizeText(intent.projectType, ''),
      features: normalizeFeatures(intent.features),
      complexity: normalizeText(intent.complexity, ''),
      summary: normalizeText(intent.summary, ''),
    },
    links: Array.isArray(entry.links)
      ? entry.links.filter((link) => link && typeof link === 'object')
      : [],
    createdAt: normalizeText(entry.createdAt, timestamp),
    updatedAt: timestamp,
  };
}

function normalizeStore(store) {
  if (!store || typeof store !== 'object' || !Array.isArray(store.entries)) {
    return {
      value: { ...DEFAULT_STORE },
      changed: true,
    };
  }

  const entries = store.entries.filter((entry) => entry && typeof entry === 'object');

  return {
    value: {
      version: typeof store.version === 'number' ? store.version : STORE_VERSION,
      entries,
    },
    changed: entries.length !== store.entries.length || typeof store.version !== 'number',
  };
}

function normalizeLookupInput(input) {
  if (typeof input === 'string') {
    return {
      prompt: input,
      goal: '',
      projectType: '',
      features: [],
    };
  }

  if (input && typeof input === 'object') {
    const intent = input.intent && typeof input.intent === 'object' ? input.intent : input;

    return {
      prompt: normalizeText(input.prompt, intent.summary ?? input.summary ?? ''),
      goal: normalizeText(intent.goal, ''),
      projectType: normalizeText(intent.projectType, ''),
      features: normalizeFeatures(intent.features),
    };
  }

  return {
    prompt: '',
    goal: '',
    projectType: '',
    features: [],
  };
}

function scoreEntry(entry, lookup) {
  let score = 0;
  const entryTokens = new Set(tokenize(entry.prompt || entry.input));
  const lookupTokens = new Set(tokenize(lookup.prompt));
  const entryFeatures = new Set(entry.intent?.features ?? []);
  const lookupFeatures = new Set(lookup.features ?? []);

  if (lookup.goal && entry.intent?.goal === lookup.goal) {
    score += 4;
  }

  if (lookup.projectType && entry.intent?.projectType === lookup.projectType) {
    score += 3;
  }

  for (const feature of lookupFeatures) {
    if (entryFeatures.has(feature)) {
      score += 2;
    }
  }

  for (const token of lookupTokens) {
    if (entryTokens.has(token)) {
      score += 1;
    }
  }

  if (entry.outputs?.status === 'completed' || entry.outputs?.status === 'success') {
    score += 1;
  }

  return score;
}

export class MemoryEngine {
  constructor(storePath = createStorePath()) {
    this.storePath = path.resolve(storePath);
  }

  async initialize() {
    await ensureDirectory(path.dirname(this.storePath));

    let existingStore = null;

    try {
      existingStore = await readJsonSafe(this.storePath, {
        defaultValue: null,
      });
    } catch {
      existingStore = null;
    }

    if (!existingStore) {
      await writeJsonSafe(this.storePath, DEFAULT_STORE);
      return { ...DEFAULT_STORE };
    }

    const normalizedStore = normalizeStore(existingStore);

    if (normalizedStore.changed) {
      await writeJsonSafe(this.storePath, normalizedStore.value);
    }

    return normalizedStore.value;
  }

  async saveMemory(entry) {
    const store = await this.initialize();
    const nextEntry = normalizeEntry(entry);

    store.entries = store.entries.filter((currentEntry) => currentEntry.id !== nextEntry.id);
    store.entries.push(nextEntry);
    await writeJsonSafe(this.storePath, store);

    return nextEntry;
  }

  async getRecentMemory(limit = 10) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
    const store = await this.initialize();

    return [...store.entries]
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
      .slice(0, normalizedLimit);
  }

  async getRelevantMemory(input, limit = 5) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const lookup = normalizeLookupInput(input);
    const entries = await this.getRecentMemory(50);

    return entries
      .map((entry) => ({
        ...entry,
        relevanceScore: scoreEntry(entry, lookup),
      }))
      .filter((entry) => entry.relevanceScore > 0)
      .sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      })
      .slice(0, normalizedLimit);
  }
}

const memoryEngine = new MemoryEngine();
const memoryBuilds = [];
const memoryHistory = [];
const memoryPreferences = {};
const memoryGraph = {};

function extractResultFeatures(result) {
  return Array.isArray(result?.app?.features)
    ? result.app.features
    : Array.isArray(result?.features)
      ? result.features
      : [];
}

function normalizeCompatibilityEntry(entry, fallbackLabel) {
  return entry && typeof entry === 'object'
    ? {
        ...entry,
        timestamp: typeof entry.timestamp === 'string'
          ? entry.timestamp
          : new Date().toISOString(),
      }
    : {
        value: entry,
        label: fallbackLabel,
        timestamp: new Date().toISOString(),
      };
}

memoryHistory.push = function pushHistory(entry) {
  const normalizedEntry = normalizeCompatibilityEntry(
    entry && typeof entry === 'object' ? entry : { result: entry, score: null },
    'history',
  );

  const nextLength = Array.prototype.push.call(this, normalizedEntry);
  const result = normalizedEntry.result && typeof normalizedEntry.result === 'object'
    ? normalizedEntry.result
    : { value: normalizedEntry.result };
  const features = extractResultFeatures(result);

  void memoryEngine.saveMemory({
    prompt: 'reflection',
    input: 'reflection',
    decisions: {
      score: normalizedEntry.score,
    },
    outputs: {
      ...result,
      score: normalizedEntry.score,
    },
    intent: {
      features,
      summary: 'reflection',
    },
  }).catch(() => {});

  return nextLength;
};

export function storeBuild(build) {
  const normalizedBuild = normalizeCompatibilityEntry(build, 'build');
  memoryBuilds.push(normalizedBuild);

  const features = extractResultFeatures(normalizedBuild);

  void memoryEngine.saveMemory({
    prompt: normalizedBuild.prompt ?? normalizedBuild.input ?? 'build',
    input: normalizedBuild.input ?? normalizedBuild.prompt ?? 'build',
    decisions: normalizedBuild.decisions && typeof normalizedBuild.decisions === 'object'
      ? normalizedBuild.decisions
      : {},
    outputs: normalizedBuild,
    intent: {
      features,
      summary: normalizedBuild.label ?? 'build',
    },
    createdAt: normalizedBuild.timestamp,
  }).catch(() => {});

  return normalizedBuild;
}

export function learnPattern(key, value) {
  const normalizedKey = normalizeText(key, '');

  if (!normalizedKey) {
    throw new TypeError('Pattern key is required.');
  }

  memoryGraph[normalizedKey] = value;
  return value;
}

export function recall(key) {
  const normalizedKey = normalizeText(key, '');
  return normalizedKey ? memoryGraph[normalizedKey] : undefined;
}

export const memory = {
  builds: memoryBuilds,
  preferences: memoryPreferences,
  history: memoryHistory,
  graph: memoryGraph,
};

export async function saveMemory(entry) {
  return memoryEngine.saveMemory(entry);
}

export async function getRecentMemory(limit = 10) {
  return memoryEngine.getRecentMemory(limit);
}

export async function getRelevantMemory(input) {
  return memoryEngine.getRelevantMemory(input);
}

export default memoryEngine;
