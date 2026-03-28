import path from 'node:path';
import deploymentManager from './deploymentManager.js';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const VERCEL_API_URL = 'https://api.vercel.com';

function assertProject(project) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('Infrastructure setup requires a project payload.');
  }

  if (typeof project.projectPath !== 'string' || project.projectPath.trim().length === 0) {
    throw new TypeError('Infrastructure setup requires projectPath.');
  }

  if (typeof project.projectName !== 'string' || project.projectName.trim().length === 0) {
    throw new TypeError('Infrastructure setup requires projectName.');
  }
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function hasFeature(intent, featureNames) {
  const featureSet = new Set(intent?.features ?? []);
  return featureNames.some((featureName) => featureSet.has(featureName));
}

function isScalableProject(project) {
  return (
    project.intent?.complexity === 'high' ||
    hasFeature(project.intent, ['payments', 'auth', 'realtime', 'admin_controls'])
  );
}

function collectEnvironmentVariables(project) {
  const intent = project.intent ?? {
    goal: 'build_app',
    projectType: 'web_app',
    projectName: project.projectName,
    features: [],
  };
  const deploymentPackage = deploymentManager.prepareDeploymentPackage(intent, {
    integrationConfig: project.integrationConfig ?? null,
  });
  const domainName = project.domain?.domain ?? '';
  const primaryUrl = domainName ? `https://${domainName}` : project.deployment?.url ?? '';

  return unique([
    ...deploymentPackage.envVars,
    `PRIMARY_DEPLOYMENT_PROVIDER=${project.deployment?.provider ?? ''}`,
    `PRIMARY_DEPLOYMENT_URL=${project.deployment?.url ?? ''}`,
    `CUSTOM_DOMAIN=${domainName}`,
    `APP_URL=${primaryUrl}`,
    `DOMAIN_PROVIDER=${project.domain?.provider ?? ''}`,
    `DOMAIN_VERIFICATION_TOKEN=${project.dns?.verificationToken ?? ''}`,
    'VERCEL_TOKEN=',
    'VERCEL_TEAM_ID=',
    'RAILWAY_TOKEN=',
  ]);
}

function buildEnvironmentTemplate(envVars) {
  return `# OmniForge infrastructure environment template
# Replace blank values with provider-specific secrets before enabling live automation.

${envVars.join('\n')}
`;
}

function buildScalingConfig(project) {
  const scalable = isScalableProject(project);
  const provider = project.deployment?.provider ?? 'vercel';

  return {
    mode: scalable ? 'autoscale' : 'baseline',
    provider,
    minInstances: scalable ? 2 : 1,
    maxInstances: scalable ? 10 : 3,
    concurrencyTarget: scalable ? 200 : 50,
    healthcheckPath: project.intent?.projectType === 'api_service' ? '/health' : '/',
    regionalStrategy: scalable ? 'multi-region-ready' : 'single-region',
    notes: scalable
      ? [
          'Project is marked for autoscaling because the resolved feature set includes stateful or payment workflows.',
          'Use provider autoscaling limits and health checks before enabling production traffic.',
        ]
      : [
          'Baseline scaling is sufficient for the current project complexity.',
          'Increase instance counts only after observing sustained production load.',
        ],
  };
}

function getCloudProviderMatrix(provider) {
  return [
    {
      name: 'vercel',
      supported: true,
      active: provider === 'vercel',
      liveDomainLinking: true,
      futureReady: true,
    },
    {
      name: 'railway',
      supported: true,
      active: provider === 'railway',
      liveDomainLinking: false,
      futureReady: true,
    },
    {
      name: 'aws',
      supported: false,
      active: false,
      liveDomainLinking: false,
      futureReady: true,
    },
    {
      name: 'gcp',
      supported: false,
      active: false,
      liveDomainLinking: false,
      futureReady: true,
    },
  ];
}

async function emitProgress(onProgress, type, payload = {}) {
  if (typeof onProgress !== 'function') {
    return;
  }

  await onProgress({
    type,
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
  });
}

async function vercelRequest(endpoint, { method = 'GET', body } = {}) {
  const token = process.env.VERCEL_TOKEN?.trim() ?? '';

  if (!token) {
    throw new Error('Missing required environment variable: VERCEL_TOKEN');
  }

  const url = new URL(`${VERCEL_API_URL}${endpoint}`);
  const teamId = process.env.VERCEL_TEAM_ID?.trim() ?? '';

  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        payload?.message ??
        `Vercel request failed with status ${response.status}.`,
    );
  }

  return payload;
}

async function linkDomainToDeployment(project) {
  const domainName = project.domain?.domain ?? '';
  const provider = project.deployment?.provider ?? '';

  if (!domainName || !provider) {
    return {
      status: 'skipped',
      provider: provider || null,
      domain: domainName || null,
      linked: false,
      note: 'Domain linking was skipped because deployment or domain data was incomplete.',
    };
  }

  if (provider === 'vercel') {
    const repoName =
      project.deployment?.repository?.repoName ??
      slugify(project.projectName);

    try {
      const payload = await vercelRequest(
        `/v10/projects/${encodeURIComponent(repoName)}/domains`,
        {
          method: 'POST',
          body: {
            name: domainName,
          },
        },
      );

      return {
        status: 'linked',
        provider: 'vercel',
        domain: domainName,
        linked: true,
        source: 'live-api',
        projectRef: repoName,
        verification: payload.verification ?? [],
      };
    } catch (error) {
      return {
        status: 'prepared',
        provider: 'vercel',
        domain: domainName,
        linked: false,
        source: 'api-ready',
        projectRef: repoName,
        note: error?.message ?? 'Unable to link the Vercel domain automatically.',
      };
    }
  }

  if (provider === 'railway') {
    return {
      status: 'prepared',
      provider: 'railway',
      domain: domainName,
      linked: false,
      source: 'future-provider-support',
      note: 'Railway live domain linking is structured for a future API-backed rollout.',
    };
  }

  return {
    status: 'prepared',
    provider,
    domain: domainName,
    linked: false,
    source: 'future-provider-support',
    note: 'Custom infrastructure linking is prepared for a future provider adapter.',
  };
}

async function writeInfrastructureArtifacts(projectPath, infrastructure) {
  const infrastructureDirectory = path.join(projectPath, 'deployment', 'infrastructure');
  await ensureDirectory(infrastructureDirectory);

  const planPath = path.join(infrastructureDirectory, 'infra-plan.json');
  const scalingPath = path.join(infrastructureDirectory, 'scaling.json');
  const envPath = path.join(infrastructureDirectory, 'env.production.example');
  const readmePath = path.join(infrastructureDirectory, 'README.md');

  await writeJsonSafe(planPath, infrastructure);
  await writeJsonSafe(scalingPath, infrastructure.scaling);
  await writeFileSafe(envPath, buildEnvironmentTemplate(infrastructure.environmentVariables));
  await writeFileSafe(
    readmePath,
    `# Infrastructure Automation

## Deployment Provider

${infrastructure.provider}

## Domain

${infrastructure.domain || 'Not configured'}

## Domain Linking

${infrastructure.domainLink.status}

## Scaling

- Mode: ${infrastructure.scaling.mode}
- Min Instances: ${infrastructure.scaling.minInstances}
- Max Instances: ${infrastructure.scaling.maxInstances}

## Environment Variables

${infrastructure.environmentVariables.map((entry) => `- ${entry}`).join('\n')}
`,
  );

  return [
    {
      path: 'deployment/infrastructure/infra-plan.json',
      absolutePath: planPath,
    },
    {
      path: 'deployment/infrastructure/scaling.json',
      absolutePath: scalingPath,
    },
    {
      path: 'deployment/infrastructure/env.production.example',
      absolutePath: envPath,
    },
    {
      path: 'deployment/infrastructure/README.md',
      absolutePath: readmePath,
    },
  ];
}

export async function setupInfrastructure(project, options = {}) {
  assertProject(project);

  const scaling = buildScalingConfig(project);
  const environmentVariables = collectEnvironmentVariables(project);
  const domainLink = await linkDomainToDeployment(project);
  const result = {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    provider: project.deployment?.provider ?? 'unknown',
    projectName: project.projectName,
    deploymentUrl: project.deployment?.url ?? null,
    domain: project.domain?.domain ?? null,
    dns: {
      targetHost: project.dns?.targetHost ?? null,
      recordCount: project.dns?.records?.length ?? 0,
      verificationToken: project.dns?.verificationToken ?? null,
    },
    domainLink,
    scaling,
    environmentVariables,
    cloudProviders: getCloudProviderMatrix(project.deployment?.provider ?? ''),
  };
  const files = await writeInfrastructureArtifacts(project.projectPath, result);

  await emitProgress(options.onProgress, 'infrastructure_ready', {
    ...result,
    files,
  });

  return {
    ...result,
    files,
  };
}

export default {
  setupInfrastructure,
};
