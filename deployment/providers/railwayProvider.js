import path from 'node:path';
import { fileExists, readJsonSafe } from '../../engine/fileSystem.js';

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for Railway deployment.');
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export async function deployToRailway(projectPath) {
  assertProjectPath(projectPath);

  const resolvedProjectPath = path.resolve(projectPath);
  const railwayConfigPath = path.join(resolvedProjectPath, 'deployment', 'railway.json');
  const configExists = await fileExists(railwayConfigPath);

  if (!configExists) {
    throw new Error('Railway deployment configuration was not found at deployment/railway.json.');
  }

  const configuration = await readJsonSafe(railwayConfigPath, {
    throwIfMissing: true,
  });
  const projectSlug = slugify(path.basename(resolvedProjectPath));
  const hasRailwayToken = Boolean(process.env.RAILWAY_TOKEN?.trim());

  return {
    provider: 'railway',
    status: hasRailwayToken ? 'simulated' : 'prepared',
    simulated: true,
    projectPath: resolvedProjectPath,
    url: hasRailwayToken ? `https://${projectSlug}.up.railway.app` : null,
    configuration,
    notes: [
      hasRailwayToken
        ? 'Railway token detected. Deployment is still simulated in this provider implementation.'
        : 'Set RAILWAY_TOKEN to enable future Railway API integration.',
      'Railway provider is structured for a later API-backed rollout.',
    ],
  };
}

export default {
  deployToRailway,
};
