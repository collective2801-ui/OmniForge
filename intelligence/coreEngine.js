import plannerAgent from '../agents/plannerAgent.js';
import { generateCodeFromIntent } from '../engine/codeGenerator.js';
import { validateFiles } from '../engine/validator.js';

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

function assertPipelineInput(input, context) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new TypeError('Pipeline input must be a non-empty string.');
  }

  if (!context || typeof context !== 'object') {
    throw new TypeError('Pipeline context must be an object.');
  }

  if (!context.intent || typeof context.intent !== 'object') {
    throw new TypeError('Pipeline context must include an intent object.');
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
    reason: 'Generated from the optimized intelligence core.',
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
  return {
    ...context.intent,
    summary: context.intent.summary || input,
    technicalDecisions: context.decisions ?? {},
    assumptions: dedupeStrings([
      ...(context.intent.assumptions ?? []),
      ...buildDecisionAssumptions(context.decisions),
      ...buildMemoryAssumptions(context.memory ?? []),
      ...correctionHints,
    ]),
    intelligenceCore: {
      roles: ROLES,
      mode: 'optimized-phase-1',
      retryBudget: MAX_RETRIES,
    },
  };
}

function runPlanner(input, context) {
  const route = context.route ?? createRouteFromIntent(context.intent);
  const project = context.project ?? {
    projectId: null,
    projectName: context.intent.projectName ?? 'intelligence-preview',
  };

  return plannerAgent.createPlan({
    userInput: input,
    intent: context.intent,
    route,
    project,
  });
}

async function runBuilder(input, context, correctionHints) {
  const builderIntent = buildBuilderIntent(input, context, correctionHints);
  const files = validateFiles(await generateCodeFromIntent(builderIntent));

  return {
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

function runReviewer(plan, files, intent) {
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
    issues,
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

function runOptimizer(files) {
  const optimizedFiles = optimizeFiles(files);

  return {
    passed: true,
    issues: [],
    fileCount: optimizedFiles.length,
    files: optimizedFiles,
  };
}

function runSecurity(files) {
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
    issues,
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

export async function runIntelligencePipeline(input, context = {}) {
  assertPipelineInput(input, context);

  const roleLogs = [];
  const plan = runPlanner(input, context);
  roleLogs.push(
    createRoleLog('planner', {
      planId: plan.planId,
      stepCount: plan.steps.length,
    }),
  );

  let correctionHints = [];
  let latestIntent = context.intent;
  let latestFiles = [];
  let reviewerResult = {
    passed: false,
    issues: ['Build pipeline did not run.'],
  };
  let optimizerResult = {
    passed: false,
    issues: [],
    files: [],
  };
  let securityResult = {
    passed: false,
    issues: ['Build pipeline did not run.'],
  };
  let retryCount = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const builderResult = await runBuilder(input, {
      ...context,
      intent: latestIntent,
    }, correctionHints);
    latestIntent = builderResult.intent;
    latestFiles = builderResult.files;
    roleLogs.push(
      createRoleLog('builder', {
        attempt: attempt + 1,
        fileCount: latestFiles.length,
      }),
    );

    reviewerResult = runReviewer(plan, latestFiles, latestIntent);
    roleLogs.push(
      createRoleLog('reviewer', {
        attempt: attempt + 1,
        passed: reviewerResult.passed,
        issues: reviewerResult.issues,
      }),
    );

    optimizerResult = runOptimizer(latestFiles);
    latestFiles = optimizerResult.files;
    roleLogs.push(
      createRoleLog('optimizer', {
        attempt: attempt + 1,
        fileCount: latestFiles.length,
      }),
    );

    securityResult = runSecurity(latestFiles);
    roleLogs.push(
      createRoleLog('security', {
        attempt: attempt + 1,
        passed: securityResult.passed,
        issues: securityResult.issues,
      }),
    );

    if (reviewerResult.passed && securityResult.passed) {
      return {
        roles: ROLES,
        plan,
        files: latestFiles,
        status: 'success',
        retriesUsed: retryCount,
        diagnostics: {
          reviewer: reviewerResult,
          optimizer: {
            passed: optimizerResult.passed,
            issues: optimizerResult.issues,
            fileCount: optimizerResult.fileCount,
          },
          security: securityResult,
          roleLogs,
        },
      };
    }

    if (attempt === MAX_RETRIES) {
      break;
    }

    retryCount += 1;
    correctionHints = buildCorrectionHints(reviewerResult, securityResult);
  }

  return {
    roles: ROLES,
    plan,
    files: latestFiles,
    status: 'failed',
    retriesUsed: retryCount,
    diagnostics: {
      reviewer: reviewerResult,
      optimizer: {
        passed: optimizerResult.passed,
        issues: optimizerResult.issues,
        fileCount: optimizerResult.fileCount,
      },
      security: securityResult,
      roleLogs,
    },
  };
}

export default {
  runIntelligencePipeline,
};
