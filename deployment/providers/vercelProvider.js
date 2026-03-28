import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists, readJsonSafe } from '../../engine/fileSystem.js';

const VERCEL_API_URL = 'https://api.vercel.com';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.omniforge',
  '.vercel',
  'dist',
  'logs',
  'node_modules',
  'runtime',
]);
const IGNORED_FILES = new Set([
  '.DS_Store',
]);

function assertRepoName(repoName) {
  if (typeof repoName !== 'string' || repoName.trim().length === 0) {
    throw new TypeError('Repository name is required for Vercel deployment.');
  }
}

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for Vercel deployment.');
  }
}

function getVercelConfig() {
  const token = process.env.VERCEL_TOKEN?.trim() ?? '';
  const teamId = process.env.VERCEL_TEAM_ID?.trim() ?? '';

  if (!token) {
    throw new Error('Missing required environment variable: VERCEL_TOKEN');
  }

  return {
    token,
    teamId,
  };
}

function sleep(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value.startsWith('http') ? value : `https://${value}`;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  );
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}

async function vercelRequest(endpoint, { method = 'GET', body, query = {} } = {}) {
  const { token, teamId } = getVercelConfig();
  const url = new URL(`${VERCEL_API_URL}${endpoint}`);

  if (teamId) {
    url.searchParams.set('teamId', teamId);
  }

  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      url.searchParams.set(key, String(value));
    }
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

async function collectProjectFiles(projectPath, rootPath = projectPath) {
  const entries = await fs.readdir(projectPath, {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    if (entry.isFile() && IGNORED_FILES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(projectPath, entry.name);
    const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');

    if (entry.isDirectory()) {
      files.push(...await collectProjectFiles(absolutePath, rootPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const contents = await fs.readFile(absolutePath, 'utf8');
    files.push({
      file: relativePath,
      data: contents,
    });
  }

  return files;
}

async function resolveProjectSettings(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const viteConfigPath = path.join(projectPath, 'vite.config.js');
  const packageJson = await readJsonSafe(packageJsonPath, {
    defaultValue: null,
  });
  const hasVite = await fileExists(viteConfigPath);
  const scripts = packageJson?.scripts ?? {};

  if (hasVite || typeof scripts?.build === 'string') {
    return compactObject({
      framework: hasVite ? 'vite' : null,
      installCommand: typeof scripts?.install === 'string' ? scripts.install : 'npm install',
      buildCommand: typeof scripts?.build === 'string' ? scripts.build : 'npm run build',
      outputDirectory: 'dist',
      devCommand: typeof scripts?.dev === 'string' ? scripts.dev : null,
    });
  }

  return {
    framework: null,
  };
}

async function waitForDeploymentReady(deploymentId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const deployment = await vercelRequest(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
    const readyState = String(deployment.readyState ?? '').toUpperCase();

    if (readyState === 'READY') {
      return deployment;
    }

    if (readyState === 'ERROR' || readyState === 'CANCELED') {
      throw new Error(
        deployment.errorMessage ??
          deployment.inspectorUrl ??
          'Vercel deployment failed before reaching READY state.',
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error('Timed out while waiting for Vercel deployment to complete.');
}

async function resolveProductionProjectUrl(repoName) {
  const projectDomains = await vercelRequest(`/v10/projects/${encodeURIComponent(repoName)}/domains`, {
    query: {
      production: 'true',
    },
  });
  const verifiedDomain = (projectDomains.domains ?? []).find((domain) => domain?.verified === true);

  if (verifiedDomain?.name) {
    return normalizeUrl(verifiedDomain.name);
  }

  const project = await vercelRequest(`/v9/projects/${encodeURIComponent(repoName)}`);
  const productionAliases = uniqueStrings([
    ...(project?.targets?.production?.alias ?? []),
    ...(project?.latestDeployments?.[0]?.alias ?? []),
  ]);

  if (productionAliases.length > 0) {
    return normalizeUrl(productionAliases[0]);
  }

  return null;
}

export async function deployToVercel(repoName, options = {}) {
  assertRepoName(repoName);

  const projectPath = options.projectPath ?? '';
  assertProjectPath(projectPath);

  const files = await collectProjectFiles(path.resolve(projectPath));

  if (files.length === 0) {
    throw new Error('No deployable project files were found for Vercel.');
  }

  const projectSettings = await resolveProjectSettings(projectPath);
  const environmentVariables = Object.fromEntries(
    Object.entries(options.environmentVariables ?? {}).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0,
    ),
  );
  const deployment = await vercelRequest('/v13/deployments', {
    method: 'POST',
    query: {
      skipAutoDetectionConfirmation: 1,
    },
    body: {
      name: repoName.trim().toLowerCase(),
      target: 'production',
      files,
      projectSettings,
      env: Object.keys(environmentVariables).length > 0 ? environmentVariables : undefined,
    },
  });
  const readyDeployment = await waitForDeploymentReady(deployment.id);
  const publicUrl =
    await resolveProductionProjectUrl(repoName).catch(() => null);
  const deploymentUrl = normalizeUrl(readyDeployment.url ?? deployment.url);

  return {
    provider: 'vercel',
    status: 'deployed',
    deploymentId: readyDeployment.id ?? deployment.id,
    url: publicUrl ?? deploymentUrl,
    deploymentUrl,
    inspectorUrl: normalizeUrl(readyDeployment.inspectorUrl ?? null),
    readyState: readyDeployment.readyState ?? deployment.readyState ?? 'READY',
  };
}

export default {
  deployToVercel,
};
