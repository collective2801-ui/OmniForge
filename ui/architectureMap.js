function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function createNode(id, type, name, metadata = {}) {
  return {
    id,
    type,
    name,
    metadata,
  };
}

function createEdge(from, to, label) {
  return {
    from,
    to,
    label,
  };
}

function createIntegrationNodeName(integration) {
  switch (integration) {
    case 'supabase-auth':
      return 'Supabase Auth';
    case 'supabase-storage':
      return 'Supabase Storage';
    case 'supabase-db':
      return 'Supabase Database';
    default:
      return titleCase(integration);
  }
}

export function generateArchitectureMap(intent = {}, decisions = {}) {
  const nodes = [];
  const edges = [];
  const projectName = normalizeText(intent.projectName, 'omniforge-project');

  if (decisions.frontend && decisions.frontend !== 'none') {
    nodes.push(
      createNode('frontend', 'frontend', `${titleCase(decisions.frontend)} App`, {
        framework: decisions.frontend,
      }),
    );
  }

  if (decisions.backend && decisions.backend !== 'none') {
    nodes.push(
      createNode('backend', 'backend', `${titleCase(decisions.backend)} API`, {
        runtime: decisions.backend,
        architecture: decisions.architecture ?? null,
      }),
    );
  }

  if (decisions.database && decisions.database !== 'none') {
    nodes.push(
      createNode('database', 'database', titleCase(decisions.database), {
        provider: decisions.database,
      }),
    );
  }

  if (decisions.deployment) {
    nodes.push(
      createNode('deployment', 'deployment', titleCase(decisions.deployment), {
        target: decisions.deployment,
      }),
    );
  }

  const integrationNodes = (decisions.integrationsNeeded ?? []).map((integration) =>
    createNode(
      `integration:${integration}`,
      'integration',
      createIntegrationNodeName(integration),
      {
        provider: integration,
      },
    ),
  );

  nodes.push(...integrationNodes);

  if (nodes.some((node) => node.id === 'frontend') && nodes.some((node) => node.id === 'backend')) {
    edges.push(createEdge('frontend', 'backend', 'requests'));
  }

  if (nodes.some((node) => node.id === 'backend') && nodes.some((node) => node.id === 'database')) {
    edges.push(createEdge('backend', 'database', 'persists'));
  }

  if (nodes.some((node) => node.id === 'frontend') && !nodes.some((node) => node.id === 'backend') && nodes.some((node) => node.id === 'database')) {
    edges.push(createEdge('frontend', 'database', 'reads'));
  }

  if (nodes.some((node) => node.id === 'frontend') && nodes.some((node) => node.id === 'deployment')) {
    edges.push(createEdge('frontend', 'deployment', 'delivered via'));
  }

  if (nodes.some((node) => node.id === 'backend') && nodes.some((node) => node.id === 'deployment')) {
    edges.push(createEdge('backend', 'deployment', 'runs on'));
  }

  for (const integrationNode of integrationNodes) {
    if (integrationNode.id === 'integration:supabase-db' && nodes.some((node) => node.id === 'database')) {
      edges.push(createEdge(integrationNode.id, 'database', 'powers'));
      continue;
    }

    if (nodes.some((node) => node.id === 'backend')) {
      edges.push(createEdge('backend', integrationNode.id, 'integrates with'));
    } else if (nodes.some((node) => node.id === 'frontend')) {
      edges.push(createEdge('frontend', integrationNode.id, 'integrates with'));
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    projectName,
    nodes,
    edges,
    summary: {
      architecture: decisions.architecture ?? null,
      scalability: decisions.scalability ?? null,
      costProfile: decisions.costProfile ?? null,
    },
  };
}

export default {
  generateArchitectureMap,
};
