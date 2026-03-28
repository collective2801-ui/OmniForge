import path from 'node:path';
import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import {
  ensureDirectory,
  readJsonSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const DEFAULT_PATTERN_LIBRARY = Object.freeze({
  patterns: [],
});
const SUCCESS_STATUSES = new Set([
  'completed',
  'configured',
  'deployed',
  'domain_ready',
  'ready',
]);

function createPatternLibraryPath() {
  return path.join(platformConfig.rootDirectory, 'patterns', 'patternLibrary.json');
}

function normalizeFeatures(features = []) {
  if (!Array.isArray(features)) {
    return [];
  }

  return [...new Set(
    features
      .map((feature) => (typeof feature === 'string' ? feature.trim() : ''))
      .filter(Boolean),
  )].sort();
}

function normalizePatternLibrary(library) {
  if (!library || typeof library !== 'object' || !Array.isArray(library.patterns)) {
    return {
      value: { ...DEFAULT_PATTERN_LIBRARY },
      changed: true,
    };
  }

  const patterns = library.patterns.filter((pattern) => pattern && typeof pattern === 'object');

  return {
    value: {
      patterns,
    },
    changed: patterns.length !== library.patterns.length,
  };
}

function buildPatternKey(projectType, features) {
  return `${projectType || 'unknown'}:${normalizeFeatures(features).join('|')}`;
}

function tokenizePrompt(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 8);
}

function isSuccessfulMemory(memory) {
  return SUCCESS_STATUSES.has(String(memory?.status || '').toLowerCase());
}

function toPatternRecord(key, bucket) {
  const successCount = bucket.memories.length;
  const promptKeywords = [...new Set(
    bucket.memories.flatMap((memory) => tokenizePrompt(memory.prompt)),
  )].slice(0, 10);
  const exampleProjects = [...new Set(
    bucket.memories
      .map((memory) => memory.project?.projectName || memory.intent?.projectName || '')
      .filter(Boolean),
  )].slice(0, 5);
  const integrations = [...new Set(
    bucket.memories.flatMap((memory) => memory.output?.integrations?.integrations ?? []),
  )];

  return {
    id: randomUUID(),
    key,
    projectType: bucket.projectType,
    features: bucket.features,
    successCount,
    promptKeywords,
    exampleProjects,
    integrations,
    lastUsedAt: bucket.lastUsedAt,
    confidence: Number(Math.min(0.99, 0.45 + successCount * 0.08).toFixed(2)),
  };
}

function scorePattern(pattern, intent) {
  let score = 0;
  const patternFeatures = new Set(pattern.features ?? []);
  const intentFeatures = new Set(intent?.features ?? []);

  if (pattern.projectType && pattern.projectType === intent?.projectType) {
    score += 5;
  }

  for (const feature of intentFeatures) {
    if (patternFeatures.has(feature)) {
      score += 3;
    }
  }

  score += Number(pattern.successCount ?? 0);
  return score;
}

export class PatternEngine {
  constructor(patternLibraryPath = createPatternLibraryPath()) {
    this.patternLibraryPath = path.resolve(patternLibraryPath);
  }

  async initialize() {
    await ensureDirectory(path.dirname(this.patternLibraryPath));

    const existingLibrary = await readJsonSafe(this.patternLibraryPath, {
      defaultValue: null,
    });

    if (!existingLibrary) {
      await writeJsonSafe(this.patternLibraryPath, DEFAULT_PATTERN_LIBRARY);
      return { ...DEFAULT_PATTERN_LIBRARY };
    }

    const normalizedLibrary = normalizePatternLibrary(existingLibrary);

    if (normalizedLibrary.changed) {
      await writeJsonSafe(this.patternLibraryPath, normalizedLibrary.value);
    }

    return normalizedLibrary.value;
  }

  async extractPatterns(memory) {
    const memories = Array.isArray(memory) ? memory : [memory].filter(Boolean);
    const successfulMemories = memories.filter(isSuccessfulMemory);
    const groupedPatterns = new Map();

    for (const entry of successfulMemories) {
      const projectType = entry.intent?.projectType ?? entry.project?.projectType ?? 'unknown';
      const features = normalizeFeatures(entry.intent?.features ?? []);
      const key = buildPatternKey(projectType, features);
      const bucket = groupedPatterns.get(key) ?? {
        projectType,
        features,
        memories: [],
        lastUsedAt: entry.updatedAt ?? entry.completedAt ?? entry.createdAt ?? new Date().toISOString(),
      };

      bucket.memories.push(entry);

      const entryTimestamp = entry.updatedAt ?? entry.completedAt ?? entry.createdAt ?? new Date().toISOString();

      if (new Date(entryTimestamp).getTime() > new Date(bucket.lastUsedAt).getTime()) {
        bucket.lastUsedAt = entryTimestamp;
      }

      groupedPatterns.set(key, bucket);
    }

    const patterns = [...groupedPatterns.entries()]
      .map(([key, bucket]) => toPatternRecord(key, bucket))
      .sort((left, right) => {
        if (right.successCount !== left.successCount) {
          return right.successCount - left.successCount;
        }

        return new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime();
      });

    const library = {
      patterns,
    };

    await writeJsonSafe(this.patternLibraryPath, library);

    return {
      patterns,
      updated: true,
    };
  }

  async getRelevantPatterns(intent, limit = 5) {
    const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : 5;
    const library = await this.initialize();

    return [...library.patterns]
      .map((pattern) => ({
        ...pattern,
        relevanceScore: scorePattern(pattern, intent),
      }))
      .filter((pattern) => pattern.relevanceScore > 0)
      .sort((left, right) => {
        if (right.relevanceScore !== left.relevanceScore) {
          return right.relevanceScore - left.relevanceScore;
        }

        return new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime();
      })
      .slice(0, normalizedLimit);
  }
}

const patternEngine = new PatternEngine();

export async function extractPatterns(memory) {
  return patternEngine.extractPatterns(memory);
}

export async function getRelevantPatterns(intent) {
  return patternEngine.getRelevantPatterns(intent);
}

export default patternEngine;
