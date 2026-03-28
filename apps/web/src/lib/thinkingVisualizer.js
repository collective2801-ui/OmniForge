const STAGE_BLUEPRINT = Object.freeze([
  {
    id: 'analyzing',
    label: 'Analyzing',
    description: 'Understanding the request.',
    shortLabel: 'Analyze',
    accent: 'blue',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Choosing the build path.',
    shortLabel: 'Plan',
    accent: 'purple',
  },
  {
    id: 'building',
    label: 'Building',
    description: 'Generating the product.',
    shortLabel: 'Build',
    accent: 'green',
  },
  {
    id: 'optimizing',
    label: 'Optimizing',
    description: 'Polishing for delivery.',
    shortLabel: 'Optimize',
    accent: 'blue',
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
    index,
    pulse: false,
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

function deriveProgress(stages, loading, activeStageId) {
  if (!Array.isArray(stages) || stages.length === 0) {
    return 0;
  }

  const completedStages = stages.filter((stage) => stage.status === 'complete').length;
  const baseProgress = Math.round((completedStages / stages.length) * 100);
  const stageHints = {
    analyzing: 14,
    planning: 36,
    building: 67,
    optimizing: 91,
  };

  if (!loading) {
    return baseProgress;
  }

  if (!activeStageId) {
    return Math.max(8, baseProgress);
  }

  return Math.max(baseProgress, stageHints[activeStageId] ?? 8);
}

function buildHeadline(activeStageId, loading) {
  if (!loading && activeStageId === 'optimizing') {
    return 'Build complete';
  }

  switch (activeStageId) {
    case 'analyzing':
      return 'Reading the request';
    case 'planning':
      return 'Planning the build';
    case 'building':
      return 'Building the product';
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
  const progress = deriveProgress(stages, loading, activeStage);
  const activeIndex = stages.findIndex((stage) => stage.id === activeStage);
  const normalizedStages = stages.map((stage, index) => ({
    ...stage,
    pulse: loading && stage.id === activeStage,
    tone:
      stage.status === 'error'
        ? 'error'
        : stage.status === 'complete'
          ? 'complete'
          : stage.id === activeStage
            ? 'active'
            : 'idle',
    indicator:
      stage.status === 'complete'
        ? 'Complete'
        : stage.status === 'error'
          ? 'Needs attention'
          : stage.id === activeStage
            ? 'In progress'
            : 'Queued',
    progressHint:
      stage.status === 'complete'
        ? 100
        : stage.id === activeStage
          ? 72
          : index < activeIndex
            ? 100
            : 8,
  }));
  const activeStageDetails = normalizedStages.find((stage) => stage.id === activeStage) ?? null;

  return {
    status: loading ? 'thinking' : progress >= 100 ? 'complete' : 'idle',
    headline: buildHeadline(activeStage, loading),
    activeStage,
    pulse: loading,
    progress: loading && progress === 0 ? 8 : progress,
    stages: normalizedStages,
    currentIndex: activeIndex,
    totalStages: normalizedStages.length,
    progressLabel: `${loading ? 'Running' : 'Ready'} · ${Math.max(progress, loading ? 8 : 0)}%`,
    ambientLines: normalizedStages.map((stage) => ({
      id: stage.id,
      active: stage.id === activeStage,
      complete: stage.status === 'complete',
      accent: stage.accent,
    })),
    stageHeadline: activeStageDetails?.label ?? 'Standing by',
    microcopy:
      activeStageDetails?.description ??
      'OmniForge is ready for the next build.',
    summary:
      loading
        ? state.status?.lastTask?.detail ?? 'OmniForge is processing the current request.'
        : state.status?.lastTask?.detail ?? 'Submit a request to start a build.',
  };
}

export default {
  simulateThinking,
};
