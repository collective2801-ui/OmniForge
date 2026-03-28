const STAGES = Object.freeze([
  {
    id: 'analyzing',
    label: 'Analyzing',
    description: 'Resolving the prompt, intent, and memory context.',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Preparing architecture and execution stages.',
  },
  {
    id: 'building',
    label: 'Building',
    description: 'Running the core builder and writing the project slice.',
  },
  {
    id: 'reviewing',
    label: 'Reviewing',
    description: 'Checking the generated output for correctness.',
  },
  {
    id: 'optimizing',
    label: 'Optimizing',
    description: 'Refining the generated files and final build quality.',
  },
]);

function assertInput(input) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new TypeError('Builder input must be a non-empty string.');
  }
}

function normalizeUrl(url) {
  if (typeof url !== 'string' || url.trim().length === 0) {
    return null;
  }

  const trimmedUrl = url.trim();
  return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`;
}

function createStageState() {
  return STAGES.map((stage) => ({
    ...stage,
    status: 'pending',
    startedAt: null,
    completedAt: null,
  }));
}

function createUiState(input) {
  return {
    input,
    loading: true,
    status: 'running',
    currentStage: 'analyzing',
    progress: 0,
    stages: createStageState(),
    logs: [],
    retriesUsed: 0,
    generatedFiles: 0,
    updatedAt: new Date().toISOString(),
  };
}

function cloneUiState(uiState) {
  return {
    ...uiState,
    stages: uiState.stages.map((stage) => ({ ...stage })),
    logs: uiState.logs.map((log) => ({ ...log })),
  };
}

function setStageStatus(uiState, stageId, status) {
  const nextUiState = cloneUiState(uiState);
  const nextStageIndex = nextUiState.stages.findIndex((stage) => stage.id === stageId);

  if (nextStageIndex === -1) {
    return nextUiState;
  }

  const timestamp = new Date().toISOString();
  const nextStage = {
    ...nextUiState.stages[nextStageIndex],
    status,
    startedAt:
      status === 'active'
        ? nextUiState.stages[nextStageIndex].startedAt ?? timestamp
        : nextUiState.stages[nextStageIndex].startedAt,
    completedAt:
      status === 'complete' || status === 'error'
        ? timestamp
        : nextUiState.stages[nextStageIndex].completedAt,
  };

  nextUiState.stages[nextStageIndex] = nextStage;
  nextUiState.currentStage = stageId;
  nextUiState.progress = Math.round(
    (nextUiState.stages.filter((stage) => stage.status === 'complete').length / nextUiState.stages.length) * 100,
  );
  nextUiState.updatedAt = timestamp;

  return nextUiState;
}

function appendLog(uiState, level, message, metadata = {}) {
  const nextUiState = cloneUiState(uiState);

  nextUiState.logs.push({
    id: `${Date.now()}-${nextUiState.logs.length + 1}`,
    level,
    message,
    metadata,
    timestamp: new Date().toISOString(),
  });
  nextUiState.updatedAt = new Date().toISOString();

  return nextUiState;
}

async function emitUiState(onProgress, uiState) {
  if (typeof onProgress !== 'function') {
    return;
  }

  await onProgress({
    type: 'builder_ui_updated',
    payload: {
      uiState,
      timestamp: new Date().toISOString(),
    },
  });
}

function findRoleLog(roleLogs, role) {
  return roleLogs.find((entry) => entry.role === role) ?? null;
}

function deriveClonePages(parsedUrl) {
  const pathSegments = parsedUrl.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const pageSet = new Set(['/', '/pricing', '/dashboard']);

  if (pathSegments.length > 0) {
    pageSet.add(`/${pathSegments[0]}`);
  }

  return [...pageSet];
}

export function cloneAppStructure(url) {
  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return null;
  }

  const parsedUrl = new URL(normalizedUrl);
  const hostname = parsedUrl.hostname.replace(/^www\./i, '');
  const primarySegment = hostname.split('.')[0] || 'cloned-app';
  const layout =
    /dashboard|app|admin/i.test(hostname) || /dashboard|app|admin/i.test(parsedUrl.pathname)
      ? 'app-shell'
      : 'marketing-shell';
  const components = layout === 'app-shell'
    ? ['navbar', 'dashboard-layout', 'summary-cards', 'forms']
    : ['navbar', 'hero', 'pricing-grid', 'footer'];

  return {
    sourceUrl: normalizedUrl,
    appName: primarySegment,
    layout,
    pages: deriveClonePages(parsedUrl),
    components,
    generatedAt: new Date().toISOString(),
  };
}

export async function runEnhancedBuilder(input, {
  intent,
  decisions,
  onProgress,
  buildFn,
  buildContext = {},
  cloneUrl = null,
} = {}) {
  assertInput(input);

  if (typeof buildFn !== 'function') {
    throw new TypeError('buildFn must be a function.');
  }

  let uiState = createUiState(input);
  uiState = appendLog(uiState, 'info', 'Analyzing prompt and loading builder context.', {
    projectType: intent?.projectType ?? null,
  });
  await emitUiState(onProgress, uiState);

  const cloneStructure = cloneAppStructure(cloneUrl);

  if (cloneStructure) {
    uiState = appendLog(uiState, 'info', 'Prepared lightweight clone structure from the provided URL.', {
      sourceUrl: cloneStructure.sourceUrl,
      layout: cloneStructure.layout,
    });
    await emitUiState(onProgress, uiState);
  }

  uiState = setStageStatus(uiState, 'analyzing', 'complete');
  uiState = setStageStatus(uiState, 'planning', 'active');
  uiState = appendLog(uiState, 'info', 'Planning build stages and architecture decisions.', {
    frontend: decisions?.frontend ?? null,
    backend: decisions?.backend ?? null,
  });
  await emitUiState(onProgress, uiState);

  uiState = setStageStatus(uiState, 'planning', 'complete');
  uiState = setStageStatus(uiState, 'building', 'active');
  uiState = appendLog(uiState, 'info', 'Starting the enhanced build pipeline.', {});
  await emitUiState(onProgress, uiState);

  const result = await buildFn(input, {
    intent,
    decisions,
    cloneStructure,
    ...buildContext,
  });
  const roleLogs = result?.diagnostics?.roleLogs ?? [];
  const plannerLog = findRoleLog(roleLogs, 'planner');
  const reviewerLog = findRoleLog(roleLogs, 'reviewer');
  const optimizerLog = findRoleLog(roleLogs, 'optimizer');
  const securityLog = findRoleLog(roleLogs, 'security');

  uiState = setStageStatus(uiState, 'building', result?.status === 'success' ? 'complete' : 'error');
  uiState = appendLog(uiState, 'info', 'Core intelligence pipeline returned a build result.', {
    planId: plannerLog?.result?.planId ?? result?.plan?.planId ?? null,
    generatedFiles: result?.files?.length ?? 0,
  });
  await emitUiState(onProgress, uiState);

  uiState = setStageStatus(uiState, 'reviewing', 'active');
  uiState = appendLog(
    uiState,
    reviewerLog?.result?.passed === false ? 'error' : 'info',
    reviewerLog?.result?.passed === false
      ? 'Reviewer found issues that required correction.'
      : 'Reviewer approved the generated output.',
    {
      issues: reviewerLog?.result?.issues ?? [],
      securityIssues: securityLog?.result?.issues ?? [],
    },
  );
  uiState = setStageStatus(
    uiState,
    'reviewing',
    reviewerLog?.result?.passed === false || securityLog?.result?.passed === false ? 'error' : 'complete',
  );
  await emitUiState(onProgress, uiState);

  uiState = setStageStatus(uiState, 'optimizing', 'active');
  uiState = appendLog(uiState, 'info', 'Applying optimizer refinements to the generated file set.', {
    fileCount: optimizerLog?.result?.fileCount ?? result?.files?.length ?? 0,
  });
  uiState = setStageStatus(uiState, 'optimizing', result?.status === 'success' ? 'complete' : 'error');
  uiState = appendLog(
    uiState,
    result?.status === 'success' ? 'info' : 'error',
    result?.status === 'success'
      ? 'Builder experience finalized successfully.'
      : 'Builder experience finalized with errors.',
    {
      retriesUsed: result?.retriesUsed ?? 0,
    },
  );

  uiState = {
    ...uiState,
    loading: false,
    status: result?.status === 'success' ? 'ready' : 'error',
    currentStage: result?.status === 'success' ? 'optimizing' : 'reviewing',
    retriesUsed: result?.retriesUsed ?? 0,
    generatedFiles: result?.files?.length ?? 0,
    progress: result?.status === 'success' ? 100 : uiState.progress,
    updatedAt: new Date().toISOString(),
  };
  await emitUiState(onProgress, uiState);

  return {
    uiState,
    result,
    cloneStructure,
  };
}

export default {
  cloneAppStructure,
  runEnhancedBuilder,
};
