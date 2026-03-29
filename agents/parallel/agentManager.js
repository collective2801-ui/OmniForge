import plannerAgent from '../plannerAgent.js';
import { generateCodeFromIntent } from '../../engine/codeGenerator.js';
import { validateFiles } from '../../engine/validator.js';
import { runParallel } from './workerPool.js';

const ROLES = Object.freeze([
  'planner',
  'builder',
  'reviewer',
  'optimizer',
  'security',
]);
const MAX_RETRIES = 2;

function expectsApplicationFiles(intent = {}) {
  if (intent.projectType === 'api_service') {
    return false;
  }

  if (['web_app', 'full_stack_app', 'landing_page', 'internal_tool'].includes(intent.projectType)) {
    return true;
  }

  if (intent.goal === 'build_app') {
    return true;
  }

  const source = [
    intent.summary,
    intent.userInput,
    intent.projectName,
    ...(intent.steps ?? []),
    ...(intent.assumptions ?? []),
  ]
    .filter(Boolean)
    .join(' ');

  return /\b(build|create|generate|make|launch|scaffold)\b/i.test(source)
    && /\b(app|application|saas|software|platform|site|dashboard|portal|workspace|tool)\b/i.test(source);
}

function assertParallelContext(context) {
  if (!context || typeof context !== 'object') {
    throw new TypeError('Parallel agent context must be an object.');
  }

  if (typeof context.input !== 'string' || context.input.trim().length === 0) {
    throw new TypeError('Parallel agent context must include a non-empty input string.');
  }

  if (!context.intent || typeof context.intent !== 'object') {
    throw new TypeError('Parallel agent context must include an intent object.');
  }
}

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
}

function createRouteFromIntent(intent) {
  return {
    category: intent.goal ?? 'build_app',
    confidence: 0.92,
    matchedKeywords: intent.features ?? [],
    reason: 'Generated from the parallel agent manager.',
  };
}

function createRoleLog(role, result) {
  return {
    role,
    timestamp: new Date().toISOString(),
    result,
  };
}

function buildDecisionAssumptions(decisions = {}) {
  const assumptions = [];

  if (decisions.frontend && decisions.frontend !== 'none') {
    assumptions.push(`Use ${decisions.frontend} for the primary frontend stack.`);
  }

  if (decisions.backend && decisions.backend !== 'none') {
    assumptions.push(`Use ${decisions.backend} for backend execution and server logic.`);
  }

  if (decisions.database && decisions.database !== 'none') {
    assumptions.push(`Persist application state with ${decisions.database}.`);
  }

  if (decisions.architecture) {
    assumptions.push(`Favor a ${decisions.architecture} architecture.`);
  }

  if (Array.isArray(decisions.integrationsNeeded) && decisions.integrationsNeeded.length > 0) {
    assumptions.push(`Prepare integration points for ${decisions.integrationsNeeded.join(', ')}.`);
  }

  return assumptions;
}

function buildMemoryAssumptions(memoryMatches = []) {
  if (!Array.isArray(memoryMatches) || memoryMatches.length === 0) {
    return [];
  }

  const primaryMatch = memoryMatches[0];

  return [
    `Reuse successful patterns from related work such as ${primaryMatch.intent?.projectType || primaryMatch.prompt || 'prior builds'}.`,
  ];
}

function buildBuilderIntent(input, context, correctionHints = []) {
  const planSteps = Array.isArray(context.plan?.steps)
    ? context.plan.steps.map((step) => step.description || step.title).filter(Boolean)
    : Array.isArray(context.intent.steps)
      ? context.intent.steps
      : [];

  return {
    ...context.intent,
    summary: context.intent.summary || input,
    steps: planSteps,
    technicalDecisions: context.decisions ?? {},
    assumptions: dedupeStrings([
      ...(context.intent.assumptions ?? []),
      ...buildDecisionAssumptions(context.decisions),
      ...buildMemoryAssumptions(context.memory ?? []),
      ...correctionHints,
    ]),
    intelligenceCore: {
      roles: ROLES,
      mode: 'parallel-super-phase-2',
      retryBudget: MAX_RETRIES,
      parallelExecution: true,
    },
  };
}

function runPlanner(input, context) {
  const route = context.route ?? createRouteFromIntent(context.intent);
  const project = context.project ?? {
    projectId: null,
    projectName: context.intent.projectName ?? 'parallel-preview',
  };
  const plan = plannerAgent.createPlan({
    userInput: input,
    intent: context.intent,
    route,
    project,
  });

  return {
    passed: true,
    plan,
    stepCount: plan.steps.length,
  };
}

async function runBuilder(input, context, correctionHints, attempt) {
  const builderIntent = buildBuilderIntent(input, context, correctionHints);
  const files = validateFiles(await generateCodeFromIntent(builderIntent));

  return {
    passed: files.length > 0,
    attempt,
    fileCount: files.length,
    intent: builderIntent,
    files,
  };
}

function findRequiredPaths(intent) {
  if (intent.projectType === 'api_service') {
    return ['package.json', 'README.md'];
  }

  if (!expectsApplicationFiles(intent)) {
    switch (intent.goal) {
      case 'deploy':
        return ['deployment/plan.md', 'deployment/manifest.json'];
      case 'domain_setup':
        return ['domain/plan.md', 'domain/manifest.json'];
      case 'modify_app':
        return ['changes/plan.md', 'changes/manifest.json'];
      default:
        break;
    }
  }

  return ['package.json', 'README.md', 'index.html'];
}

function runReviewer(plan, files, intent, attempt) {
  const issues = [];
  const filePaths = new Set(files.map((file) => file.path));

  for (const requiredPath of findRequiredPaths(intent)) {
    if (!filePaths.has(requiredPath)) {
      issues.push(`Missing required file: ${requiredPath}.`);
    }
  }

  if (expectsApplicationFiles(intent) && !files.some((file) => file.path === 'src/main.jsx' || file.path === 'src/App.jsx')) {
    issues.push('Web application output is missing a React entry file.');
  }

  for (const file of files) {
    if (/\bTODO\b|\bTBD\b|__PLACEHOLDER__|<placeholder>/.test(file.content)) {
      issues.push(`Found unfinished content in ${file.path}.`);
    }
  }

  if (!plan || !Array.isArray(plan.executionGraph) || plan.executionGraph.length === 0) {
    issues.push('Planner did not produce an executable graph.');
  }

  return {
    passed: issues.length === 0,
    attempt,
    issues,
    reviewedFiles: files.length,
  };
}

function optimizeFiles(files) {
  const seenPaths = new Set();
  const dedupedFiles = [];

  for (const file of files) {
    if (seenPaths.has(file.path)) {
      continue;
    }

    seenPaths.add(file.path);
    dedupedFiles.push({
      ...file,
      content: file.content.endsWith('\n') ? file.content : `${file.content}\n`,
    });
  }

  dedupedFiles.sort((left, right) => {
    const leftPriority = left.path === 'README.md' ? -1 : 0;
    const rightPriority = right.path === 'README.md' ? -1 : 0;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.path.localeCompare(right.path);
  });

  return dedupedFiles;
}

function runOptimizer(files, attempt) {
  const optimizedFiles = optimizeFiles(files);

  return {
    passed: true,
    attempt,
    issues: [],
    fileCount: optimizedFiles.length,
    files: optimizedFiles,
  };
}

function runSecurity(files, attempt) {
  const issues = [];
  const blockedPatterns = [
    {
      pattern: /\beval\s*\(/,
      message: 'Use of eval() is prohibited.',
    },
    {
      pattern: /dangerouslySetInnerHTML/,
      message: 'dangerouslySetInnerHTML requires manual review.',
    },
    {
      pattern: /\b(sk_live|pk_live|AIza|SUPABASE_SERVICE_ROLE_KEY\s*=)\b/,
      message: 'Detected what looks like a hardcoded secret or privileged key.',
    },
    {
      pattern: /http:\/\/(?!localhost|127\.0\.0\.1)/,
      message: 'Insecure non-local HTTP endpoint detected.',
    },
  ];

  for (const file of files) {
    for (const rule of blockedPatterns) {
      if (rule.pattern.test(file.content)) {
        issues.push(`${rule.message} File: ${file.path}.`);
      }
    }
  }

  return {
    passed: issues.length === 0,
    attempt,
    issues,
    scannedFiles: files.length,
  };
}

function buildCorrectionHints(reviewResult, securityResult) {
  const hints = [];

  for (const issue of reviewResult.issues ?? []) {
    if (/Missing required file: (.+?)\./.test(issue)) {
      const match = issue.match(/Missing required file: (.+?)\./);
      if (match?.[1]) {
        hints.push(`Include the required file ${match[1]} in the generated output.`);
      }
    } else if (/React entry file/.test(issue)) {
      hints.push('Include a complete React entrypoint with src/main.jsx and src/App.jsx.');
    } else {
      hints.push(issue);
    }
  }

  for (const issue of securityResult.issues ?? []) {
    if (/eval/.test(issue)) {
      hints.push('Do not use eval() or equivalent dynamic code execution.');
    } else if (/dangerouslySetInnerHTML/.test(issue)) {
      hints.push('Avoid dangerouslySetInnerHTML and render content safely.');
    } else if (/hardcoded secret/.test(issue)) {
      hints.push('Never hardcode secrets, keys, or privileged credentials.');
    } else if (/HTTP endpoint/.test(issue)) {
      hints.push('Use HTTPS for remote network endpoints.');
    } else {
      hints.push(issue);
    }
  }

  return dedupeStrings(hints);
}

function summarizeAttemptResult(attempt, builder, reviewer, optimizer, security) {
  return {
    attempt,
    builder: {
      fileCount: builder.fileCount,
    },
    reviewer: {
      passed: reviewer.passed,
      issueCount: reviewer.issues.length,
    },
    optimizer: {
      fileCount: optimizer.fileCount,
    },
    security: {
      passed: security.passed,
      issueCount: security.issues.length,
    },
  };
}

export async function runAgentsInParallel(context = {}) {
  assertParallelContext(context);

  const input = context.input.trim();
  const roleLogs = [];
  const planner = runPlanner(input, context);
  roleLogs.push(
    createRoleLog('planner', {
      planId: planner.plan.planId,
      stepCount: planner.stepCount,
    }),
  );

  let correctionHints = [];
  let latestIntent = context.intent;
  let latestResult = null;
  let retriesUsed = 0;
  const attempts = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const attemptNumber = attempt + 1;
    const builderPromise = runBuilder(
      input,
      {
        ...context,
        intent: latestIntent,
        plan: planner.plan,
      },
      correctionHints,
      attemptNumber,
    );
    const reviewerPromise = builderPromise.then((builder) =>
      runReviewer(planner.plan, builder.files, builder.intent, attemptNumber),
    );
    const optimizerPromise = builderPromise.then((builder) =>
      runOptimizer(builder.files, attemptNumber),
    );
    const securityPromise = optimizerPromise.then((optimizer) =>
      runSecurity(optimizer.files, attemptNumber),
    );

    const [builder, reviewer, optimizer, security] = await runParallel([
      () => builderPromise,
      () => reviewerPromise,
      () => optimizerPromise,
      () => securityPromise,
    ]);

    latestIntent = builder.intent;
    latestResult = {
      planner,
      builder,
      reviewer,
      optimizer,
      security,
    };
    attempts.push(
      summarizeAttemptResult(
        attemptNumber,
        builder,
        reviewer,
        optimizer,
        security,
      ),
    );

    roleLogs.push(
      createRoleLog('builder', {
        attempt: attemptNumber,
        fileCount: builder.fileCount,
      }),
      createRoleLog('reviewer', {
        attempt: attemptNumber,
        passed: reviewer.passed,
        issues: reviewer.issues,
      }),
      createRoleLog('optimizer', {
        attempt: attemptNumber,
        fileCount: optimizer.fileCount,
      }),
      createRoleLog('security', {
        attempt: attemptNumber,
        passed: security.passed,
        issues: security.issues,
      }),
    );

    if (reviewer.passed && security.passed) {
      break;
    }

    if (attempt < MAX_RETRIES) {
      retriesUsed += 1;
      correctionHints = buildCorrectionHints(reviewer, security);
    }
  }

  return {
    roles: ROLES,
    status:
      latestResult?.reviewer?.passed && latestResult?.security?.passed
        ? 'success'
        : 'failed',
    planner: latestResult?.planner ?? planner,
    builder: latestResult?.builder ?? {
      passed: false,
      attempt: 0,
      fileCount: 0,
      files: [],
      intent: latestIntent,
    },
    reviewer: latestResult?.reviewer ?? {
      passed: false,
      attempt: 0,
      issues: ['Parallel review did not run.'],
      reviewedFiles: 0,
    },
    optimizer: latestResult?.optimizer ?? {
      passed: false,
      attempt: 0,
      issues: ['Parallel optimization did not run.'],
      fileCount: 0,
      files: [],
    },
    security: latestResult?.security ?? {
      passed: false,
      attempt: 0,
      issues: ['Parallel security analysis did not run.'],
      scannedFiles: 0,
    },
    retriesUsed,
    attempts,
    roleLogs,
    parallel: true,
  };
}

export default {
  runAgentsInParallel,
};
