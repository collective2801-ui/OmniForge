import { simulateThinking } from './thinkingVisualizer.js';

function getStatusTone(state) {
  switch (state) {
    case 'running':
    case 'executing':
    case 'indexing':
    case 'syncing':
      return 'active';
    case 'completed':
    case 'ready':
    case 'synced':
      return 'healthy';
    case 'warning':
    case 'inferred':
      return 'warning';
    case 'failed':
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function normalizeStatusCard(label, data = {}) {
  return {
    label,
    state: data.state ?? 'idle',
    tone: getStatusTone(data.state ?? 'idle'),
    detail: data.detail ?? 'No detail available.',
  };
}

function normalizeLogEntry(entry = {}, index = 0) {
  const tone =
    entry.level === 'error'
      ? 'error'
      : entry.level === 'warning'
        ? 'warning'
        : entry.stage === 'delivery' || entry.stage === 'validation'
          ? 'accent'
          : 'neutral';

  return {
    ...entry,
    tone,
    order: index,
    stageLabel: String(entry.stage ?? 'system').replace(/_/g, ' '),
    shortMessage: String(entry.message ?? '').trim(),
  };
}

function normalizeArchitecture(architecture) {
  const nodes = Array.isArray(architecture?.nodes) ? architecture.nodes : [];
  const edges = Array.isArray(architecture?.edges) ? architecture.edges : [];

  return {
    ready: nodes.length > 0,
    nodes: nodes.slice(0, 8).map((node, index) => ({
      id: node.id ?? `${node.type ?? 'node'}-${index + 1}`,
      type: node.type ?? 'service',
      name: node.name ?? 'Unnamed node',
    })),
    edges: edges.slice(0, 10).map((edge, index) => ({
      id: edge.id ?? `edge-${index + 1}`,
      from: edge.from ?? 'source',
      to: edge.to ?? 'target',
      label: edge.label ?? '',
    })),
    summary:
      nodes.length > 0
        ? `${nodes.length} architecture node${nodes.length === 1 ? '' : 's'} ready.`
        : 'Architecture preview appears after stack decisions are resolved.',
  };
}

function createProgressModel(thinking, status = {}, loading = false) {
  const currentStage = thinking.stages.find((stage) => stage.id === thinking.activeStage) ?? null;
  const totalStages = thinking.totalStages || thinking.stages.length || 4;
  const completedStages = thinking.stages.filter((stage) => stage.status === 'complete').length;
  const tone =
    thinking.status === 'complete'
      ? 'healthy'
      : loading
        ? 'active'
        : status.orchestrator?.state === 'error'
          ? 'error'
          : 'idle';

  return {
    tone,
    label:
      tone === 'healthy'
        ? 'Ready'
        : loading
          ? 'Building'
          : 'Standing by',
    percent: Math.max(0, Math.min(100, thinking.progress ?? 0)),
    headline: thinking.headline,
    summary: thinking.summary,
    currentStageLabel: currentStage?.label ?? 'Standby',
    currentStageDescription: currentStage?.description ?? 'Waiting for the next build command.',
    completedStages,
    totalStages,
    rail: thinking.stages.map((stage) => ({
      id: stage.id,
      label: stage.shortLabel ?? stage.label,
      status: stage.status,
      tone: stage.tone,
      pulse: stage.pulse === true,
      indicator: stage.indicator,
      accent: stage.accent,
    })),
  };
}

function createPrimaryCard(label, value, detail, tone = 'neutral') {
  return {
    label,
    value,
    detail,
    tone,
  };
}

function createInspectorModel({
  loading = false,
  status = {},
  thinking,
  logs = [],
  preview = null,
  finalization = null,
  deployment = null,
  domain = null,
  integrations = null,
  unifiedAPI = null,
  runtime = null,
  mobile = null,
  store = null,
  architecture = null,
} = {}) {
  const recentLogs = Array.isArray(logs)
    ? logs.slice(-4).reverse().map((entry, index) => normalizeLogEntry(entry, index))
    : [];
  const previewUrl = preview?.url || deployment?.url || '';
  const previewState = preview?.ready
    ? previewUrl
      ? 'Live app'
      : 'Preview ready'
    : loading
      ? 'Rendering'
      : 'Not ready';
  const previewDetail = previewUrl || preview?.summary || 'Run a build to create a preview.';
  const publishState = deployment?.url
    ? 'Published'
    : preview?.ready
      ? 'Ready to publish'
      : 'Waiting';
  const publishDetail = deployment?.url || 'Publish to generate a live URL.';
  const finalizationState = finalization?.productionReady === true
    ? 'Production ready'
    : loading
      ? 'Validating'
      : finalization?.status || 'Pending';
  const finalizationDetail = finalization?.productionReady === true
    ? `${finalization.iterations ?? finalization.retries ?? 0} validation pass${(finalization.iterations ?? finalization.retries ?? 0) === 1 ? '' : 'es'} recorded.`
    : finalization?.issuesFixed === true
      ? 'OmniForge applied fixes during validation.'
      : finalization?.status
        ? 'Finalization status recorded for this build.'
        : 'Finalization status appears after a completed build.';

  const sections = [
    {
      id: 'delivery',
      label: 'Delivery details',
      summary: deployment?.url || domain?.domain || 'Publish, live URL, and domain state',
      items: [
        deployment
          ? createPrimaryCard(
              'Publish',
              deployment.status || 'ready',
              deployment.url || 'Publish to generate a live URL.',
              deployment.url ? 'success' : 'neutral',
            )
          : null,
        domain
          ? createPrimaryCard(
              'Domain',
              domain.domain || domain.status || 'pending',
              domain.provider || domain.purchaseUrl || 'Domain planning is available.',
            )
          : null,
      ].filter(Boolean),
    },
    {
      id: 'system',
      label: 'System details',
      summary: runtime?.status || architecture?.summary || 'Runtime and architecture state',
      items: [
        runtime
          ? createPrimaryCard(
              'Runtime',
              runtime.status || 'ready',
              `${runtime.issueCount ?? 0} issues · ${runtime.securityWarningCount ?? 0} warnings`,
              runtime.status === 'healthy' ? 'success' : runtime.status === 'error' ? 'error' : 'neutral',
            )
          : null,
        ...(architecture?.ready
          ? architecture.nodes.slice(0, 4).map((node) =>
              createPrimaryCard(
                node.type,
                node.name,
                'Architecture node available in the current build graph.',
              ),
            )
          : []),
        ...[
          normalizeStatusCard('Engine', status.engine),
          normalizeStatusCard('Memory', status.memory),
          normalizeStatusCard('Orchestrator', status.orchestrator),
        ].map((card) =>
          createPrimaryCard(card.label, card.state, card.detail, card.tone === 'healthy' ? 'success' : card.tone),
        ),
      ].filter(Boolean),
    },
    {
      id: 'integrations',
      label: 'Integrations and API',
      summary:
        [
          ...(Array.isArray(integrations?.integrations) ? integrations.integrations : []),
          ...(Array.isArray(unifiedAPI?.apis) ? unifiedAPI.apis : []),
        ].join(', ') || 'Provider scaffolding and API plan',
      items: [
        integrations
          ? createPrimaryCard(
              'Integrations',
              Array.isArray(integrations.integrations) && integrations.integrations.length > 0
                ? integrations.integrations.join(', ')
                : integrations.status || 'configured',
              Array.isArray(integrations.envKeys) && integrations.envKeys.length > 0
                ? `${integrations.envKeys.length} environment keys prepared.`
                : 'Provider scaffolding is configured.',
            )
          : null,
        unifiedAPI
          ? createPrimaryCard(
              'Unified API',
              Array.isArray(unifiedAPI.apis) && unifiedAPI.apis.length > 0
                ? unifiedAPI.apis.join(', ')
                : unifiedAPI.status || 'configured',
              'Unified API routing and provider fallback are available.',
            )
          : null,
      ].filter(Boolean),
    },
    {
      id: 'mobile',
      label: 'Mobile and store',
      summary:
        mobile?.status || store?.status || 'Mobile scaffolding and store assets',
      items: [
        mobile
          ? createPrimaryCard(
              'Mobile',
              mobile.status || 'ready',
              Array.isArray(mobile.platforms) && mobile.platforms.length > 0
                ? mobile.platforms.join(', ')
                : 'Mobile platforms prepared.',
            )
          : null,
        store
          ? createPrimaryCard(
              'Store',
              store.submissionReady ? 'Submission ready' : store.status || 'ready',
              'Store metadata and submission assets are available.',
              store.submissionReady ? 'success' : 'neutral',
            )
          : null,
      ].filter(Boolean),
    },
  ].filter((section) => section.items.length > 0);

  return {
    mode:
      status.orchestrator?.state === 'error'
        ? 'error'
        : loading
          ? 'active'
          : finalization?.productionReady === true
            ? 'complete'
            : 'idle',
    headline:
      status.orchestrator?.state === 'error'
        ? 'Build needs attention'
        : loading
          ? thinking.headline
          : finalization?.productionReady === true
            ? 'Ready to ship'
            : 'Standing by',
    summary:
      status.orchestrator?.state === 'error'
        ? status.lastTask?.detail ?? 'Review the latest error before shipping.'
        : loading
          ? thinking.microcopy
          : finalization?.productionReady === true
            ? 'Preview, publish state, and production checks are ready.'
            : 'Run a prompt or analyze a source to start a build.',
    stageLabel: thinking.stageHeadline,
    progressLabel: thinking.progressLabel,
    primaryCards: [
      createPrimaryCard('Preview', previewState, previewDetail, preview?.ready ? 'success' : 'neutral'),
      createPrimaryCard('Publish', publishState, publishDetail, deployment?.url ? 'success' : 'neutral'),
      createPrimaryCard(
        'Finalization',
        finalizationState,
        finalizationDetail,
        finalization?.productionReady === true ? 'success' : loading ? 'neutral' : 'neutral',
      ),
    ],
    activityFeed: recentLogs,
    sections,
  };
}

export function createControlCenter({
  prompt = '',
  loading = false,
  status = {},
  logs = [],
  architecture = null,
  uiState = null,
  voice = {},
  preview = null,
  finalization = null,
  deployment = null,
  domain = null,
  integrations = null,
  unifiedAPI = null,
  runtime = null,
  mobile = null,
  store = null,
} = {}) {
  const thinking = simulateThinking({
    loading,
    status,
    uiState,
    logs,
  });
  const architecturePreview = normalizeArchitecture(architecture);
  const progress = createProgressModel(thinking, status, loading);

  return {
    prompt,
    controls: {
      runLabel: loading ? 'Running OmniForge…' : 'Run Build',
      voiceLabel: voice.listening ? 'Stop Voice' : 'Start Voice',
      voiceSupported: voice.supported === true,
      voiceListening: voice.listening === true,
      voiceError: voice.error ?? '',
      transcript: voice.transcript ?? '',
      browserState:
        voice.supported === true
          ? (voice.listening ? 'Listening for a build command.' : 'Voice control ready.')
          : 'Voice input is unavailable in this browser.',
    },
    thinking,
    progress,
    systemStatus: [
      normalizeStatusCard('Engine', status.engine),
      normalizeStatusCard('Memory', status.memory),
      normalizeStatusCard('Orchestrator', status.orchestrator),
      normalizeStatusCard('Last Task', status.lastTask),
    ],
    logs: Array.isArray(logs)
      ? logs.slice(-6).reverse().map((entry, index) => normalizeLogEntry(entry, index))
      : [],
    architecture: architecturePreview,
    inspector: createInspectorModel({
      loading,
      status,
      thinking,
      logs,
      preview,
      finalization,
      deployment,
      domain,
      integrations,
      unifiedAPI,
      runtime,
      mobile,
      store,
      architecture: architecturePreview,
    }),
  };
}

export default {
  createControlCenter,
};
