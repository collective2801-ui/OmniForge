import path from 'node:path';
import platformConfig from '../config/platform.config.js';
import {
  ensureDirectory,
  readJsonSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const PREFERENCE_STORE_VERSION = 1;
const DEFAULT_PREFERENCE_STORE = Object.freeze({
  version: PREFERENCE_STORE_VERSION,
  users: {},
});
const UI_STYLE_RULES = [
  { value: 'fintech', patterns: [/\bfintech\b/i, /\btrading\b/i, /\bfinance\b/i] },
  { value: 'bold', patterns: [/\bbold\b/i, /\bhigh[-\s]?contrast\b/i, /\bstrong\b/i] },
  { value: 'minimal', patterns: [/\bminimal\b/i, /\bclean\b/i, /\bsimple\b/i] },
  { value: 'editorial', patterns: [/\beditorial\b/i, /\bmagazine\b/i] },
];
const FRAMEWORK_RULES = [
  { value: 'react', patterns: [/\breact\b/i, /\bjsx\b/i] },
  { value: 'vite', patterns: [/\bvite\b/i] },
  { value: 'nextjs', patterns: [/\bnext\b/i, /\bnextjs\b/i] },
  { value: 'node', patterns: [/\bnode\b/i, /\bexpress\b/i, /\bapi\b/i] },
];

function createPreferenceStorePath() {
  return path.join(platformConfig.rootDirectory, 'learning', 'preferences.json');
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeCounterMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, count]) => typeof key === 'string' && key.trim() && Number.isFinite(count))
      .map(([key, count]) => [key, Number(count)]),
  );
}

function incrementCounter(map, values = []) {
  const nextMap = { ...map };

  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    nextMap[value] = (nextMap[value] ?? 0) + 1;
  }

  return nextMap;
}

function getTopKeys(counterMap, limit = 3) {
  return Object.entries(counterMap)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([key]) => key);
}

function normalizeStoreShape(store) {
  if (!store || typeof store !== 'object' || !store.users || typeof store.users !== 'object') {
    return {
      value: { ...DEFAULT_PREFERENCE_STORE },
      changed: true,
    };
  }

  return {
    value: {
      version:
        typeof store.version === 'number' ? store.version : PREFERENCE_STORE_VERSION,
      users: store.users,
    },
    changed: typeof store.version !== 'number',
  };
}

function inferUiStyles(prompt = '', intent = {}, currentPreference = '') {
  const styles = [];

  for (const rule of UI_STYLE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(prompt))) {
      styles.push(rule.value);
    }
  }

  if ((intent.features ?? []).includes('dashboard') && styles.length === 0) {
    styles.push('dashboard');
  }

  if (/preferred ui style/i.test(prompt) && currentPreference) {
    styles.unshift(currentPreference);
  }

  return [...new Set(styles)];
}

function inferFrameworks(prompt = '', intent = {}) {
  const frameworks = [];

  for (const rule of FRAMEWORK_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(prompt))) {
      frameworks.push(rule.value);
    }
  }

  if (
    intent.projectType === 'web_app' ||
    intent.projectType === 'full_stack_app' ||
    (intent.features ?? []).includes('responsive_ui') ||
    (intent.features ?? []).includes('dashboard')
  ) {
    frameworks.push('react', 'vite');
  }

  if (intent.projectType === 'api_service') {
    frameworks.push('node');
  }

  return [...new Set(frameworks)];
}

function inferFeaturePreferences(intent = {}) {
  return [...new Set(
    (intent.features ?? [])
      .map((feature) => (typeof feature === 'string' ? feature.trim() : ''))
      .filter(Boolean),
  )];
}

export function derivePreferenceSignals({
  prompt = '',
  intent = {},
  existingPreferences = null,
} = {}) {
  const currentUiStyle = existingPreferences?.preferredUiStyle ?? '';

  return {
    uiStyle: inferUiStyles(prompt, intent, currentUiStyle),
    frameworks: inferFrameworks(prompt, intent),
    features: inferFeaturePreferences(intent),
  };
}

export class PreferenceEngine {
  constructor(preferenceStorePath = createPreferenceStorePath()) {
    this.preferenceStorePath = path.resolve(preferenceStorePath);
  }

  async initialize() {
    await ensureDirectory(path.dirname(this.preferenceStorePath));

    const existingStore = await readJsonSafe(this.preferenceStorePath, {
      defaultValue: null,
    });

    if (!existingStore) {
      await writeJsonSafe(this.preferenceStorePath, DEFAULT_PREFERENCE_STORE);
      return { ...DEFAULT_PREFERENCE_STORE };
    }

    const normalizedStore = normalizeStoreShape(existingStore);

    if (normalizedStore.changed) {
      await writeJsonSafe(this.preferenceStorePath, normalizedStore.value);
    }

    return normalizedStore.value;
  }

  async getUserPreferences(userId) {
    const normalizedUserId = normalizeText(userId, 'anonymous');
    const store = await this.initialize();
    const existingRecord = store.users[normalizedUserId];

    if (!existingRecord) {
      return {
        userId: normalizedUserId,
        preferredUiStyle: null,
        preferredFrameworks: [],
        preferredFeatures: [],
        uiStyles: {},
        frameworks: {},
        features: {},
        history: [],
      };
    }

    const uiStyles = normalizeCounterMap(existingRecord.uiStyles);
    const frameworks = normalizeCounterMap(existingRecord.frameworks);
    const features = normalizeCounterMap(existingRecord.features);

    return {
      userId: normalizedUserId,
      preferredUiStyle: getTopKeys(uiStyles, 1)[0] ?? null,
      preferredFrameworks: getTopKeys(frameworks, 3),
      preferredFeatures: getTopKeys(features, 6),
      uiStyles,
      frameworks,
      features,
      history: Array.isArray(existingRecord.history) ? existingRecord.history : [],
      updatedAt: existingRecord.updatedAt ?? null,
    };
  }

  async updatePreferences(userId, data = {}) {
    const normalizedUserId = normalizeText(userId, 'anonymous');
    const store = await this.initialize();
    const currentPreferences = await this.getUserPreferences(normalizedUserId);
    const timestamp = new Date().toISOString();
    const uiStyleValues = Array.isArray(data.uiStyle)
      ? data.uiStyle
      : [normalizeText(data.uiStyle, '')].filter(Boolean);
    const frameworkValues = Array.isArray(data.frameworks)
      ? data.frameworks
      : [normalizeText(data.frameworks, '')].filter(Boolean);
    const featureValues = Array.isArray(data.features)
      ? data.features
      : [normalizeText(data.features, '')].filter(Boolean);
    const nextUiStyles = incrementCounter(currentPreferences.uiStyles, uiStyleValues);
    const nextFrameworks = incrementCounter(currentPreferences.frameworks, frameworkValues);
    const nextFeatures = incrementCounter(currentPreferences.features, featureValues);
    const nextHistory = [
      ...(currentPreferences.history ?? []),
      {
        timestamp,
        uiStyle: uiStyleValues,
        frameworks: frameworkValues,
        features: featureValues,
      },
    ].slice(-25);

    store.users[normalizedUserId] = {
      userId: normalizedUserId,
      uiStyles: nextUiStyles,
      frameworks: nextFrameworks,
      features: nextFeatures,
      history: nextHistory,
      updatedAt: timestamp,
    };

    await writeJsonSafe(this.preferenceStorePath, store);

    return this.getUserPreferences(normalizedUserId);
  }
}

const preferenceEngine = new PreferenceEngine();

export async function updatePreferences(userId, data) {
  return preferenceEngine.updatePreferences(userId, data);
}

export async function getUserPreferences(userId) {
  return preferenceEngine.getUserPreferences(userId);
}

export default preferenceEngine;
