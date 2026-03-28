const OLLAMA_GENERATE_URL = 'http://localhost:11434/api/generate';
const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags';
const DEFAULT_MODEL = 'deepseek-coder';
const REQUEST_TIMEOUT_MS = 20_000;
const TAG_DISCOVERY_TIMEOUT_MS = 3_000;
const PREFERRED_MODELS = [
  DEFAULT_MODEL,
  'deepseek-coder:latest',
  'deepseek-coder-v2',
  'qwen2.5-coder',
  'qwen2.5-coder:latest',
  'codellama',
  'codellama:latest',
  'deepseek-r1:latest',
  'llama3.2:latest',
  'llama3.1',
  'llama3.1:latest',
];

function assertPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('AI prompt must be a non-empty string.');
  }
}

function normalizeModelName(modelName) {
  return typeof modelName === 'string' ? modelName.trim() : '';
}

function parseAvailableModels(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.models)) {
    return [];
  }

  return payload.models
    .map((model) => ({
      name: normalizeModelName(model?.name),
      size: typeof model?.size === 'number' ? model.size : Number.MAX_SAFE_INTEGER,
    }))
    .filter((model) => Boolean(model.name));
}

function pickPreferredModel(availableModels, attemptedModels = []) {
  const blocked = new Set(attemptedModels.map((model) => normalizeModelName(model)));
  const normalizedAvailableModels = availableModels.map((model) => model.name);

  const exactMatch = PREFERRED_MODELS.find(
    (candidate) =>
      normalizedAvailableModels.includes(candidate) && !blocked.has(candidate),
  );

  if (exactMatch) {
    return exactMatch;
  }

  const fuzzyMatch = PREFERRED_MODELS.find((candidate) => {
    const candidateBase = candidate.split(':')[0];
    return normalizedAvailableModels.some(
      (availableModel) =>
        !blocked.has(availableModel) &&
        availableModel.split(':')[0] === candidateBase,
    );
  });

  if (fuzzyMatch) {
    const matchedModel = availableModels.find(
      (availableModel) =>
        !blocked.has(availableModel.name) &&
        availableModel.name.split(':')[0] === fuzzyMatch.split(':')[0],
    );

    return matchedModel?.name ?? DEFAULT_MODEL;
  }

  const rankedFallback = [...availableModels]
    .filter((model) => !blocked.has(model.name))
    .sort((left, right) => scoreModel(right) - scoreModel(left))[0];

  if (rankedFallback) {
    return rankedFallback.name;
  }

  return blocked.has(DEFAULT_MODEL) ? normalizedAvailableModels[0] ?? DEFAULT_MODEL : DEFAULT_MODEL;
}

function scoreModel(model) {
  const modelName = model.name.toLowerCase();
  let score = 0;

  if (modelName.includes('coder') || modelName.includes('code')) {
    score += 120;
  }

  if (modelName.includes('deepseek')) {
    score += 85;
  }

  if (modelName.includes('qwen')) {
    score += 45;
  }

  if (modelName.includes('llama3.2') || modelName.includes('phi') || modelName.includes('mini')) {
    score += 40;
  }

  if (modelName.includes('vision')) {
    score -= 70;
  }

  if (modelName.includes('120b') || modelName.includes('70b') || modelName.includes('32b')) {
    score -= 120;
  }

  score -= Math.min(Math.round(model.size / 1_000_000_000), 90);

  return score;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }

  return response.json();
}

async function discoverAvailableModels() {
  try {
    const payload = await fetchJson(OLLAMA_TAGS_URL, TAG_DISCOVERY_TIMEOUT_MS);
    return parseAvailableModels(payload);
  } catch {
    return [];
  }
}

async function generateWithModel(prompt, model) {
  const response = await fetch(OLLAMA_GENERATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: {
        temperature: 0.2,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const rawBody = await response.text();
  let payload = null;

  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload.error === 'string'
        ? payload.error
        : rawBody || response.statusText;
    throw new Error(`Ollama generation failed (${response.status}): ${detail}`);
  }

  if (!payload || typeof payload.response !== 'string') {
    throw new Error('Ollama returned an invalid generation payload.');
  }

  return payload.response;
}

function shouldRetryWithDifferentModel(error) {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes('model') ||
    message.includes('not found') ||
    message.includes('pull') ||
    message.includes('manifest')
  );
}

export async function callAI(prompt) {
  assertPrompt(prompt);

  let availableModels = await discoverAvailableModels();
  const attemptedModels = [];
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const selectedModel = pickPreferredModel(availableModels, attemptedModels);
    attemptedModels.push(selectedModel);

    try {
      return await generateWithModel(prompt.trim(), selectedModel);
    } catch (error) {
      lastError = error;

      if (attempt === 0 && shouldRetryWithDifferentModel(error)) {
        availableModels = await discoverAvailableModels();
      }
    }
  }

  throw new Error(
    `AI request failed after 2 attempts. ${lastError?.message ?? 'Unknown AI failure.'}`,
  );
}

export default callAI;
