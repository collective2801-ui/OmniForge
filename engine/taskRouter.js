export const TASK_CATEGORIES = Object.freeze({
  BUILD_APP: 'build_app',
  EDIT_PROJECT: 'edit_project',
  CREATE_API_INTEGRATION: 'create_api_integration',
  DEPLOYMENT_WORKFLOW: 'deployment_workflow',
  DOMAIN_WORKFLOW: 'domain_workflow',
  UNKNOWN: 'unknown',
});

const DEFAULT_RULES = [
  {
    category: TASK_CATEGORIES.BUILD_APP,
    semanticConfidence: 0.91,
    keywords: [
      'build app',
      'build application',
      'create app',
      'create a new app',
      'generate app',
      'new project',
      'new app',
      'scaffold',
      'prototype',
      'application',
      'web app',
    ],
    signals: {
      verbs: ['build', 'create', 'generate', 'scaffold', 'launch'],
      nouns: ['app', 'application', 'project', 'site', 'product'],
    },
  },
  {
    category: TASK_CATEGORIES.EDIT_PROJECT,
    semanticConfidence: 0.84,
    keywords: [
      'edit project',
      'modify project',
      'update code',
      'refactor',
      'fix bug',
      'improve',
      'change file',
      'extend',
    ],
    signals: {
      verbs: ['edit', 'modify', 'update', 'refactor', 'fix', 'improve', 'change'],
      nouns: ['project', 'code', 'application', 'app', 'file', 'system'],
    },
  },
  {
    category: TASK_CATEGORIES.CREATE_API_INTEGRATION,
    semanticConfidence: 0.86,
    keywords: [
      'api',
      'integration',
      'webhook',
      'endpoint',
      'sdk',
      'oauth',
      'connect service',
      'third party',
    ],
    signals: {
      verbs: ['connect', 'integrate', 'add', 'configure'],
      nouns: ['api', 'integration', 'webhook', 'oauth', 'sdk', 'service'],
    },
  },
  {
    category: TASK_CATEGORIES.DEPLOYMENT_WORKFLOW,
    semanticConfidence: 0.78,
    keywords: [
      'deploy',
      'deployment',
      'release',
      'hosting',
      'infrastructure',
      'ci/cd',
      'publish',
      'ship',
    ],
    signals: {
      verbs: ['deploy', 'release', 'host', 'publish', 'ship'],
      nouns: ['deployment', 'hosting', 'infrastructure', 'production', 'release'],
    },
  },
  {
    category: TASK_CATEGORIES.DOMAIN_WORKFLOW,
    semanticConfidence: 0.78,
    keywords: [
      'domain',
      'dns',
      'subdomain',
      'ssl',
      'certificate',
      'nameserver',
      'routing',
      'custom domain',
    ],
    signals: {
      verbs: ['configure', 'connect', 'map', 'point'],
      nouns: ['domain', 'dns', 'subdomain', 'ssl', 'certificate', 'nameserver'],
    },
  },
];

function normalizeTask(task) {
  if (!task || typeof task !== 'object') {
    throw new TypeError('Task must be an object.');
  }

  return {
    type: typeof task.type === 'string' ? task.type.trim().toLowerCase() : '',
    intent: typeof task.intent === 'string' ? task.intent.trim().toLowerCase() : '',
    title: typeof task.title === 'string' ? task.title.trim().toLowerCase() : '',
    description:
      typeof task.description === 'string'
        ? task.description.trim().toLowerCase()
        : '',
    prompt: typeof task.prompt === 'string' ? task.prompt.trim().toLowerCase() : '',
  };
}

function matchRule(rule, task) {
  const directMatchFields = [task.type, task.intent];

  if (directMatchFields.includes(rule.category)) {
    return {
      category: rule.category,
      confidence: 0.98,
      matchedKeywords: [rule.category],
      reason: 'Matched explicit task type or intent.',
    };
  }

  const searchableText = [task.title, task.description, task.prompt]
    .filter(Boolean)
    .join(' ');

  const matchedKeywords = rule.keywords.filter((keyword) =>
    searchableText.includes(keyword),
  );
  const signalMatches = [];

  if (rule.signals) {
    const verbMatch = rule.signals.verbs.find((verb) => searchableText.includes(verb));
    const nounMatch = rule.signals.nouns.find((noun) => searchableText.includes(noun));

    if (verbMatch) {
      signalMatches.push(verbMatch);
    }

    if (nounMatch) {
      signalMatches.push(nounMatch);
    }
  }

  if (matchedKeywords.length === 0 && signalMatches.length < 2) {
    return null;
  }

  const weightedMatches = matchedKeywords.length + signalMatches.length * 0.75;
  const baselineConfidence = Math.min(
    0.93,
    0.4 + weightedMatches / Math.max(rule.keywords.length + 2, 1),
  );
  const hasCompleteSignalPair = signalMatches.length >= 2;
  const confidence = hasCompleteSignalPair
    ? Math.max(baselineConfidence, rule.semanticConfidence ?? baselineConfidence)
    : baselineConfidence;

  return {
    category: rule.category,
    confidence,
    matchedKeywords: [...matchedKeywords, ...signalMatches],
    reason:
      matchedKeywords.length > 0
        ? 'Matched task content keywords and semantic signals.'
        : 'Matched semantic task signals.',
  };
}

export class TaskRouter {
  constructor(rules = DEFAULT_RULES) {
    this.rules = Array.isArray(rules) ? [...rules] : [...DEFAULT_RULES];
  }

  addRule(rule) {
    if (!rule || typeof rule !== 'object') {
      throw new TypeError('Rule must be an object.');
    }

    if (typeof rule.category !== 'string' || !Array.isArray(rule.keywords)) {
      throw new TypeError('Rule must include a category and keyword list.');
    }

    this.rules.push({
      category: rule.category,
      keywords: rule.keywords.map((keyword) => String(keyword).toLowerCase()),
    });

    return this;
  }

  route(task) {
    const normalizedTask = normalizeTask(task);
    const candidates = this.rules
      .map((rule) => matchRule(rule, normalizedTask))
      .filter(Boolean)
      .sort((left, right) => right.confidence - left.confidence);

    if (candidates.length === 0) {
      return {
        category: TASK_CATEGORIES.UNKNOWN,
        confidence: 0,
        matchedKeywords: [],
        reason: 'No routing rule matched the supplied task.',
      };
    }

    return candidates[0];
  }
}

const taskRouter = new TaskRouter();

export function classifyTask(task) {
  return taskRouter.route(task);
}

export default taskRouter;
