function assertIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new TypeError('Intent is required for decision making.');
  }
}

function hasFeature(intent, feature) {
  return new Set(intent.features ?? []).has(feature);
}

function hasAnyFeature(intent, featureList) {
  const featureSet = new Set(intent.features ?? []);
  return featureList.some((feature) => featureSet.has(feature));
}

function isScalableRequest(intent) {
  return (
    intent.complexity === 'high' ||
    /scalable|enterprise|multi[-\s]?tenant|high traffic/i.test(intent.summary ?? '')
  );
}

function pickFrontend(intent) {
  if (intent.projectType === 'api_service') {
    return 'none';
  }

  if (intent.projectType === 'landing_page') {
    return 'react';
  }

  return 'react';
}

function pickBackend(intent) {
  if (
    intent.projectType === 'api_service' ||
    intent.projectType === 'full_stack_app' ||
    hasAnyFeature(intent, ['auth', 'payments', 'database', 'realtime', 'api_integration'])
  ) {
    return 'node';
  }

  return 'serverless';
}

function pickDatabase(intent, scalable) {
  if (!hasAnyFeature(intent, ['auth', 'payments', 'database', 'realtime', 'file_uploads'])) {
    return 'none';
  }

  if (scalable || hasFeature(intent, 'payments')) {
    return 'supabase';
  }

  return 'sqlite';
}

function pickDeployment(intent, scalable) {
  if (intent.goal === 'deploy') {
    return 'vercel';
  }

  if (intent.projectType === 'api_service') {
    return scalable ? 'railway' : 'vercel';
  }

  if (hasFeature(intent, 'payments') || hasFeature(intent, 'auth')) {
    return 'vercel';
  }

  return 'vercel';
}

function pickArchitecture(intent, scalable) {
  if (intent.projectType === 'api_service') {
    return scalable ? 'modular-api' : 'single-service-api';
  }

  if (hasAnyFeature(intent, ['auth', 'payments', 'database'])) {
    return scalable ? 'modular-full-stack' : 'serverless-full-stack';
  }

  return 'frontend-first';
}

function pickIntegrations(intent, database) {
  const integrations = [];

  if (hasFeature(intent, 'auth')) {
    integrations.push('supabase-auth');
  }

  if (hasFeature(intent, 'payments')) {
    integrations.push('stripe');
  }

  if (hasFeature(intent, 'file_uploads')) {
    integrations.push('supabase-storage');
  }

  if (hasFeature(intent, 'notifications')) {
    integrations.push('resend');
  }

  if (database === 'supabase') {
    integrations.push('supabase-db');
  }

  return [...new Set(integrations)];
}

function buildRationale(intent, decisions, scalable) {
  const reasons = [
    `Selected ${decisions.frontend} for fast delivery and low operational cost.`,
  ];

  if (decisions.backend !== 'none') {
    reasons.push(`Selected ${decisions.backend} because the feature set requires server-side workflows.`);
  }

  if (decisions.database !== 'none') {
    reasons.push(`Selected ${decisions.database} to support ${(intent.features ?? []).join(', ') || 'stateful features'}.`);
  }

  reasons.push(
    scalable
      ? 'Architecture favors scalability and service isolation.'
      : 'Architecture favors lower cost and a simpler delivery surface.',
  );

  return reasons;
}

export function makeDecisions(intent) {
  assertIntent(intent);

  const scalable = isScalableRequest(intent);
  const frontend = pickFrontend(intent);
  const backend = pickBackend(intent);
  const database = pickDatabase(intent, scalable);
  const deployment = pickDeployment(intent, scalable);
  const architecture = pickArchitecture(intent, scalable);
  const integrationsNeeded = pickIntegrations(intent, database);
  const costProfile = scalable ? 'balanced' : 'lean';
  const decisions = {
    frontend,
    backend,
    deployment,
    database,
    architecture,
    integrationsNeeded,
    costProfile,
    scalability: scalable ? 'high' : 'standard',
  };

  return {
    ...decisions,
    rationale: buildRationale(intent, decisions, scalable),
  };
}

export default {
  makeDecisions,
};
