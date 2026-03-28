const STAGE_BLUEPRINT = Object.freeze([
  {
    id: 'analyzing',
    label: 'Analyzing',
    description: 'Resolving the spoken or typed command into a build goal.',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Choosing architecture, routes, and execution strategy.',
  },
  {
    id: 'building',
    label: 'Building',
    description: 'Generating code, validating structure, and reviewing output.',
  },
  {
    id: 'optimizing',
    label: 'Optimizing',
    description: 'Final delivery, deployment checks, and runtime polish.',
  },
]);

const UI_STAGE_MAP = Object.freeze({
  analyzing: 'analyzing',
  planning: 'planning',
  building: 'building',
  reviewing: 'building',
  optimizing: 'optimizing',
});

const PIPELINE_STAGE_MAP = Object.freeze({
  reasoning: 'analyzing',
  routing: 'planning',
  generation: 'building',
  validation: 'building',
  delivery: 'optimizing',
});

function normalizeStageStatus(status) {
  switch (status) {
    case 'complete':
    case 'completed':
    case 'ready':
      return 'complete';
    case 'active':
    case 'running':
    case 'executing':
      return 'active';
    case 'error':
    case 'failed':
      return 'error';
    default:
      return 'pending';
  }
}

function createStages() {
  return STAGE_BLUEPRINT.map((stage, index) => ({
    ...stage,
    status: 'pending',
    animationDelayMs: index * 120,
  }));
}

function applyStageResult(stageMap, targetStageId, sourceStatus) {
  if (!targetStageId || !stageMap.has(targetStageId)) {
    return;
  }

  const normalizedStatus = normalizeStageStatus(sourceStatus);
  const currentStage = stageMap.get(targetStageId);
  const precedence = {
    pending: 0,
    active: 1,
    complete: 2,
    error: 3,
  };

  if (precedence[normalizedStatus] >= precedence[currentStage.status]) {
    currentStage.status = normalizedStatus;
  }
}

function deriveFromUiState(uiState) {
  const stageMap = new Map(createStages().map((stage) => [stage.id, stage]));

  for (const stage of uiState?.stages ?? []) {
    applyStageResult(stageMap, UI_STAGE_MAP[stage.id], stage.status);
  }

  return [...stageMap.values()];
}

function deriveFromStatus(status) {
  const stageMap = new Map(createStages().map((stage) => [stage.id, stage]));

  for (const stage of status?.pipeline ?? []) {
    applyStageResult(stageMap, PIPELINE_STAGE_MAP[stage.id], stage.state);
  }

  return [...stageMap.values()];
}

function deriveActiveStage(stages, loading) {
  const activeStage = stages.find((stage) => stage.status === 'active');

  if (activeStage) {
    return activeStage.id;
  }

  if (!loading) {
    return stages.every((stage) => stage.status === 'complete')
      ? 'optimizing'
      : null;
  }

  return stages.find((stage) => stage.status === 'pending')?.id ?? 'analyzing';
}

function buildHeadline(activeStageId, loading) {
  if (!loading && activeStageId === 'optimizing') {
    return 'Execution complete';
  }

  switch (activeStageId) {
    case 'analyzing':
      return 'Interpreting command';
    case 'planning':
      return 'Assembling execution plan';
    case 'building':
      return 'Generating and checking build artifacts';
    case 'optimizing':
      return 'Finalizing output';
    default:
      return loading ? 'Thinking' : 'Idle';
  }
}

export function simulateThinking(state = {}) {
  const loading = state.loading === true;
  const stages = state.uiState?.stages?.length > 0
    ? deriveFromUiState(state.uiState)
    : deriveFromStatus(state.status);
  const activeStage = deriveActiveStage(stages, loading);
  const completedStages = stages.filter((stage) => stage.status === 'complete').length;
  const progress = stages.length > 0
    ? Math.round((completedStages / stages.length) * 100)
    : 0;

  return {
    status: loading ? 'thinking' : 'idle',
    headline: buildHeadline(activeStage, loading),
    activeStage,
    pulse: loading,
    progress: loading && progress === 0 ? 8 : progress,
    stages,
    summary:
      loading
        ? state.status?.lastTask?.detail ?? 'OmniForge is processing the current build request.'
        : state.status?.lastTask?.detail ?? 'Submit a request to watch the intelligence flow.',
  };
}

export default {
  simulateThinking,
};
