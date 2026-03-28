import { callAI } from './aiClient.js';

const ALLOWED_GOALS = new Set([
  'build_app',
  'modify_app',
  'create_api',
  'deploy',
  'domain_setup',
]);

const ALLOWED_PROJECT_TYPES = new Set([
  'web_app',
  'full_stack_app',
  'api_service',
  'landing_page',
  'internal_tool',
  'automation',
  'deployment_workflow',
  'domain_configuration',
]);

const ALLOWED_COMPLEXITIES = new Set(['low', 'medium', 'high']);
const ALLOWED_PRIORITIES = new Set(['low', 'medium', 'high']);

const FEATURE_RULES = [
  { feature: 'auth', patterns: [/auth/i, /authentication/i, /login/i, /sign[\s-]?in/i, /user account/i] },
  { feature: 'dashboard', patterns: [/dashboard/i, /admin/i, /analytics/i, /overview/i] },
  { feature: 'todo_management', patterns: [/todo/i, /task/i, /checklist/i] },
  { feature: 'payments', patterns: [/payment/i, /billing/i, /subscription/i, /checkout/i] },
  { feature: 'api_integration', patterns: [/\bapi\b/i, /integration/i, /webhook/i, /oauth/i, /third[\s-]?party/i] },
  { feature: 'database', patterns: [/database/i, /postgres/i, /mysql/i, /sqlite/i, /persistent/i] },
  { feature: 'notifications', patterns: [/notification/i, /alert/i, /email/i, /sms/i] },
  { feature: 'search', patterns: [/search/i, /filter/i, /query/i] },
  { feature: 'realtime', patterns: [/real[\s-]?time/i, /live/i, /socket/i, /chat/i] },
  { feature: 'file_uploads', patterns: [/upload/i, /attachment/i, /document/i, /image/i] },
  { feature: 'responsive_ui', patterns: [/responsive/i, /mobile/i, /frontend/i, /ui/i] },
  { feature: 'admin_controls', patterns: [/role/i, /permission/i, /admin/i, /moderation/i] },
];

const GOAL_RULES = [
  { goal: 'domain_setup', patterns: [/domain/i, /dns/i, /subdomain/i, /nameserver/i, /certificate/i, /\bssl\b/i] },
  { goal: 'deploy', patterns: [/deploy/i, /deployment/i, /hosting/i, /release/i, /ship/i, /production/i] },
  { goal: 'create_api', patterns: [/\bapi\b/i, /endpoint/i, /integration/i, /webhook/i, /oauth/i, /sdk/i] },
  { goal: 'modify_app', patterns: [/modify/i, /edit/i, /update/i, /improve/i, /refactor/i, /fix/i, /existing/i] },
  { goal: 'build_app', patterns: [/build/i, /create/i, /generate/i, /scaffold/i, /launch/i, /new app/i, /platform/i, /site/i] },
];

function assertUserInput(userInput) {
  if (typeof userInput !== 'string' || userInput.trim().length === 0) {
    throw new TypeError('User input must be a non-empty string.');
  }
}

function slugifySegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function dedupeStrings(values = []) {
  const uniqueValues = new Set();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalizedValue = value.trim();

    if (normalizedValue.length > 0) {
      uniqueValues.add(normalizedValue);
    }
  }

  return [...uniqueValues];
}

function extractJSONObject(rawText) {
  if (typeof rawText !== 'string') {
    throw new TypeError('AI reasoning response must be a string.');
  }

  const startIndex = rawText.indexOf('{');
  const endIndex = rawText.lastIndexOf('}');

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Unable to locate a JSON object in AI reasoning output.');
  }

  return JSON.parse(rawText.slice(startIndex, endIndex + 1));
}

function inferGoal(userInput) {
  const scores = new Map(
    [...ALLOWED_GOALS].map((goal) => [goal, 0]),
  );

  for (const rule of GOAL_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(userInput)) {
        scores.set(rule.goal, (scores.get(rule.goal) ?? 0) + 1);
      }
    }
  }

  if (/existing (app|project|codebase)/i.test(userInput)) {
    scores.set('modify_app', (scores.get('modify_app') ?? 0) + 2);
  }

  const rankedGoals = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  return rankedGoals[0]?.[1] > 0 ? rankedGoals[0][0] : 'build_app';
}

function inferFeatures(userInput) {
  const detectedFeatures = FEATURE_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(userInput)))
    .map((rule) => rule.feature);

  if (/full[-s]?stack|two types of users|users*1|users*2|administrator|admin/i.test(userInput)) {
    detectedFeatures.push('auth', 'admin_controls', 'database');
  }

  if (/reward|prize|wheel|spin/i.test(userInput)) {
    detectedFeatures.push('dashboard');
  }

  if (/substance|treatment|attendance|ua|screen(?:ing)?|client/i.test(userInput)) {
    detectedFeatures.push('database');
  }

  if (detectedFeatures.length === 0 && /app|site|platform|dashboard/i.test(userInput)) {
    detectedFeatures.push('responsive_ui');
  }

  return dedupeStrings(detectedFeatures);
}

function inferProjectType(userInput, goal, features) {
  if (goal === 'create_api') {
    return 'api_service';
  }

  if (goal === 'deploy') {
    return 'deployment_workflow';
  }

  if (goal === 'domain_setup') {
    return 'domain_configuration';
  }

  if (/full[-s]?stack/i.test(userInput)) {
    return 'full_stack_app';
  }

  if (/landing page|marketing site|homepage/i.test(userInput)) {
    return 'landing_page';
  }

  if (/internal tool|back office|ops dashboard/i.test(userInput)) {
    return 'internal_tool';
  }

  if (features.includes('database') || features.includes('api_integration')) {
    return 'full_stack_app';
  }

  return 'web_app';
}

function inferComplexity(goal, features, userInput) {
  let score = 0;

  if (goal === 'create_api' || goal === 'deploy' || goal === 'domain_setup') {
    score += 1;
  }

  if (features.length >= 3) {
    score += 1;
  }

  if (
    features.some((feature) =>
      ['payments', 'realtime', 'api_integration', 'database', 'admin_controls'].includes(feature),
    )
  ) {
    score += 1;
  }

  if (/enterprise|multi[-\s]?tenant|scalable|autonomous|agent/i.test(userInput)) {
    score += 1;
  }

  if (score >= 3) {
    return 'high';
  }

  if (score >= 1) {
    return 'medium';
  }

  return 'low';
}

function inferPriority(goal, userInput, features) {
  if (/urgent|asap|critical|production|launch|important/i.test(userInput)) {
    return 'high';
  }

  if (goal === 'deploy' || goal === 'domain_setup') {
    return 'high';
  }

  if (features.includes('auth') || features.includes('payments')) {
    return 'high';
  }

  if (/prototype|demo|simple|mvp/i.test(userInput)) {
    return 'medium';
  }

  return 'medium';
}

function generateProjectName(userInput, goal, projectType, features) {
  const candidateTokens = userInput
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          'build',
          'create',
          'make',
          'generate',
          'me',
          'a',
          'an',
          'the',
          'with',
          'for',
          'simple',
          'app',
          'application',
          'platform',
          'project',
        ].includes(token),
    )
    .slice(0, 4);

  const baseName = candidateTokens.length > 0
    ? candidateTokens.join('-')
    : `${goal}-${projectType}`;

  const featureHint = features[0] && !baseName.includes(features[0])
    ? `-${features[0].replace(/_/g, '-')}`
    : '';

  return slugifySegment(`${baseName}${featureHint}`) || `${goal}-${Date.now()}`;
}

function buildExecutionSteps(goal, projectType, features) {
  const featureSummary = features.length > 0 ? features.join(', ') : 'core application flows';

  const stepsByGoal = {
    build_app: [
      `Define the ${projectType} architecture and execution boundaries.`,
      `Generate the first project slice covering ${featureSummary}.`,
      'Validate the file set for structure, safety, and local execution readiness.',
    ],
    modify_app: [
      'Identify the existing application areas that require change.',
      `Apply targeted updates for ${featureSummary} without destabilizing the current system.`,
      'Validate the proposed change set before execution.',
    ],
    create_api: [
      'Define the API contract, request flows, and integration boundaries.',
      `Generate the service files and supporting documentation for ${featureSummary}.`,
      'Validate the generated API surface and local runtime instructions.',
    ],
    deploy: [
      'Assess the deployment target, runtime assumptions, and rollout constraints.',
      'Generate deployment artifacts and execution guidance.',
      'Validate deployment readiness, environment expectations, and next actions.',
    ],
    domain_setup: [
      'Assess the target domain, DNS requirements, and certificate expectations.',
      'Generate the domain configuration plan and structured records.',
      'Validate the domain workflow for safe execution.',
    ],
  };

  return stepsByGoal[goal] ?? stepsByGoal.build_app;
}

function createHeuristicIntent(userInput) {
  const goal = inferGoal(userInput);
  const features = inferFeatures(userInput);
  const projectType = inferProjectType(userInput, goal, features);
  const complexity = inferComplexity(goal, features, userInput);
  const priority = inferPriority(goal, userInput, features);

  return {
    goal,
    projectType,
    features,
    complexity,
    priority,
    steps: buildExecutionSteps(goal, projectType, features),
    projectName: generateProjectName(userInput, goal, projectType, features),
    summary: userInput.trim(),
    assumptions: [
      'Assume a modern JavaScript stack unless the user specifies otherwise.',
      'Assume secure defaults for authentication, validation, and file generation.',
    ],
    source: 'heuristic',
  };
}

function normalizeGoal(goal, fallbackGoal) {
  const normalizedGoal = typeof goal === 'string' ? goal.trim().toLowerCase() : '';
  return ALLOWED_GOALS.has(normalizedGoal) ? normalizedGoal : fallbackGoal;
}

function normalizeProjectType(projectType, fallbackProjectType) {
  const normalizedProjectType =
    typeof projectType === 'string' ? projectType.trim().toLowerCase() : '';
  return ALLOWED_PROJECT_TYPES.has(normalizedProjectType)
    ? normalizedProjectType
    : fallbackProjectType;
}

function normalizeEnum(value, allowedValues, fallbackValue) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowedValues.has(normalizedValue) ? normalizedValue : fallbackValue;
}

function normalizeFeatures(features, fallbackFeatures = []) {
  if (!Array.isArray(features)) {
    return fallbackFeatures;
  }

  return dedupeStrings(
    features.map((feature) =>
      slugifySegment(feature).replace(/-/g, '_'),
    ),
  );
}

function normalizeSteps(steps, fallbackSteps) {
  if (!Array.isArray(steps)) {
    return fallbackSteps;
  }

  const normalizedSteps = dedupeStrings(steps);
  return normalizedSteps.length > 0 ? normalizedSteps : fallbackSteps;
}

function normalizeIntentCandidate(candidate, userInput, fallbackIntent) {
  if (!candidate || typeof candidate !== 'object') {
    return fallbackIntent;
  }

  const goal = normalizeGoal(candidate.goal, fallbackIntent.goal);
  const features = dedupeStrings([
    ...fallbackIntent.features,
    ...normalizeFeatures(candidate.features, []),
  ]);
  const projectType = normalizeProjectType(
    candidate.projectType,
    inferProjectType(userInput, goal, features),
  );
  const complexity = normalizeEnum(
    candidate.complexity,
    ALLOWED_COMPLEXITIES,
    fallbackIntent.complexity,
  );
  const priority = normalizeEnum(
    candidate.priority,
    ALLOWED_PRIORITIES,
    fallbackIntent.priority,
  );
  const steps = normalizeSteps(
    candidate.steps,
    buildExecutionSteps(goal, projectType, features),
  );
  const projectName =
    slugifySegment(candidate.projectName) ||
    generateProjectName(userInput, goal, projectType, features);
  const summary =
    typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
      ? candidate.summary.trim()
      : fallbackIntent.summary;
  const assumptions = dedupeStrings([
    ...fallbackIntent.assumptions,
    ...(Array.isArray(candidate.assumptions) ? candidate.assumptions : []),
  ]);

  return {
    goal,
    projectType,
    features,
    complexity,
    priority,
    steps,
    projectName,
    summary,
    assumptions,
    source: 'hybrid',
  };
}

function buildReasoningPrompt(userInput, heuristicIntent) {
  return `
You are OmniForge's reasoning engine. Interpret the user's real intent, infer practical missing details, and return only a JSON object.

Allowed goal values:
- build_app
- modify_app
- create_api
- deploy
- domain_setup

Allowed complexity values:
- low
- medium
- high

Allowed priority values:
- low
- medium
- high

Return JSON with this exact shape:
{
  "goal": "build_app",
  "projectType": "web_app",
  "features": ["auth", "dashboard"],
  "complexity": "medium",
  "priority": "high",
  "steps": ["..."],
  "projectName": "string",
  "summary": "string",
  "assumptions": ["..."]
}

Guidelines:
- Infer missing details conservatively.
- Prefer implementation-ready interpretations.
- Use snake_case feature names.
- Keep steps concise and execution-oriented.
- Do not include markdown.

User request:
${JSON.stringify(userInput)}

Heuristic baseline:
${JSON.stringify(heuristicIntent, null, 2)}
`.trim();
}

export class ReasoningEngine {
  async analyzeIntent(userInput) {
    assertUserInput(userInput);

    const trimmedInput = userInput.trim();
    const heuristicIntent = createHeuristicIntent(trimmedInput);

    try {
      const rawResponse = await callAI(buildReasoningPrompt(trimmedInput, heuristicIntent));
      const parsedResponse = extractJSONObject(rawResponse);
      return normalizeIntentCandidate(parsedResponse, trimmedInput, heuristicIntent);
    } catch {
      return heuristicIntent;
    }
  }
}

const reasoningEngine = new ReasoningEngine();

export async function analyzeIntent(userInput) {
  return reasoningEngine.analyzeIntent(userInput);
}

export default reasoningEngine;
