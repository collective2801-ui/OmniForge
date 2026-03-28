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
        ? `${nodes.length} architecture node${nodes.length === 1 ? '' : 's'} ready for preview.`
        : 'Architecture preview will appear after stack decisions are resolved.',
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
} = {}) {
  const thinking = simulateThinking({
    loading,
    status,
    uiState,
    logs,
  });
  const recentLogs = Array.isArray(logs) ? logs.slice(-5).reverse() : [];
  const architecturePreview = normalizeArchitecture(architecture);

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
    systemStatus: [
      normalizeStatusCard('Engine', status.engine),
      normalizeStatusCard('Memory', status.memory),
      normalizeStatusCard('Orchestrator', status.orchestrator),
      normalizeStatusCard('Last Task', status.lastTask),
    ],
    logs: recentLogs,
    architecture: architecturePreview,
  };
}

export default {
  createControlCenter,
};
