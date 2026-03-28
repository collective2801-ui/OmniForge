import path from 'node:path';
import deploymentManager from './deploymentManager.js';
import { deployToRailway } from './providers/railwayProvider.js';
import { deployToVercel } from './providers/vercelProvider.js';
import { createRepo, initRepo, pushRepo } from '../git/repoManager.js';
import logger from '../engine/logger.js';
import {
  fileExists,
  writeFileSafe,
} from '../engine/fileSystem.js';

const PROVIDER_REGISTRY = Object.freeze({
  railway: async (repoName, options) => deployToRailway(options.projectPath),
  vercel: async (repoName, options) => deployToVercel(repoName, options),
});

function isGitHubConfigured() {
  return Boolean(
    process.env.GITHUB_TOKEN?.trim() &&
      process.env.GITHUB_USERNAME?.trim(),
  );
}

function isGitUnavailableError(error) {
  const message = error?.message ?? '';
  return /spawn git ENOENT/i.test(message) || /\bgit\b.*not found/i.test(message);
}

function assertProject(project) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('Deployment project payload must be an object.');
  }

  if (typeof project.projectPath !== 'string' || project.projectPath.trim().length === 0) {
    throw new TypeError('Deployment project payload must include a projectPath.');
  }

  if (typeof project.projectName !== 'string' || project.projectName.trim().length === 0) {
    throw new TypeError('Deployment project payload must include a projectName.');
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function getIdentifierSegment(value, length = 8) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, length);
}

export function buildDeploymentKey(project, options = {}) {
  const explicitRepoName =
    typeof options.repoName === 'string' && options.repoName.trim().length > 0
      ? options.repoName.trim()
      : '';

  if (explicitRepoName) {
    return slugify(explicitRepoName);
  }

  const projectSlug = slugify(project.projectName);
  const userSegment = getIdentifierSegment(project.userId, 8);
  const projectSegment =
    getIdentifierSegment(project.projectId, 8) ||
    getIdentifierSegment(project.projectPath, 8);

  return slugify([projectSlug, userSegment, projectSegment].filter(Boolean).join('-'));
}

function selectProvider(project, options = {}) {
  if (typeof options.provider === 'string' && options.provider in PROVIDER_REGISTRY) {
    return options.provider;
  }

  if (project?.intent?.projectType === 'api_service' && process.env.RAILWAY_TOKEN?.trim()) {
    return 'railway';
  }

  return 'vercel';
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

async function ensureDeploymentArtifacts(project) {
  const deploymentPackage = deploymentManager.prepareDeploymentPackage(
    project.intent ?? {
      goal: 'build_app',
      projectType: project.projectType ?? 'web_app',
      projectName: project.projectName,
      features: [],
    },
    {
      integrationConfig: project.integrationConfig ?? null,
    },
  );
  const writtenFiles = [];

  for (const file of deploymentPackage.files) {
    const absolutePath = path.join(project.projectPath, file.path);
    const exists = await fileExists(absolutePath);

    if (!exists) {
      await writeFileSafe(absolutePath, file.content);
      writtenFiles.push({
        path: file.path,
        absolutePath,
      });
    }
  }

  return writtenFiles;
}

function normalizeDeploymentResult(provider, deploymentKey, repository, providerResult) {
  return {
    status: providerResult.status ?? (provider === 'vercel' ? 'deployed' : 'prepared'),
    provider,
    deploymentKey,
    url: providerResult.url ?? null,
    repository: repository ?? null,
    deploymentId: providerResult.deploymentId ?? null,
    inspectorUrl: providerResult.inspectorUrl ?? null,
    simulated: Boolean(providerResult.simulated),
    metadata: Object.fromEntries(
      Object.entries(providerResult).filter(
        ([key]) => !['status', 'provider', 'url', 'deploymentId', 'inspectorUrl', 'simulated'].includes(key),
      ),
    ),
  };
}

export class DeploymentService {
  async deployProject(project, options = {}) {
    assertProject(project);

    const provider = selectProvider(project, options);
    const deploymentKey = buildDeploymentKey(project, options);
    const repoName = deploymentKey;

    try {
      await logger.info('Deployment service started.', {
        projectPath: project.projectPath,
        projectName: project.projectName,
        provider,
        repoName,
        deploymentKey,
      });
      await emitProgress(options.onProgress, 'deployment_started', {
        projectName: project.projectName,
        provider,
        repoName,
      });

      const generatedArtifacts = await ensureDeploymentArtifacts(project);
      if (generatedArtifacts.length > 0) {
        await logger.info('Deployment artifacts were written before deploy.', {
          projectPath: project.projectPath,
          fileCount: generatedArtifacts.length,
        });
      }

      let repoInitialization = {
        projectPath: project.projectPath,
        branch: 'main',
        createdCommit: false,
        commitSha: null,
        skipped: false,
      };

      try {
        repoInitialization = await initRepo(project.projectPath);
        await logger.info('Git repository initialized for deployment.', repoInitialization);
      } catch (error) {
        if (!isGitUnavailableError(error)) {
          throw error;
        }

        repoInitialization = {
          projectPath: project.projectPath,
          branch: 'main',
          createdCommit: false,
          commitSha: null,
          skipped: true,
          reason: 'Git is unavailable in the current runtime, so deployment will continue without local repository initialization.',
        };
        await logger.warn('Git is unavailable. Continuing deployment without repository initialization.', {
          projectPath: project.projectPath,
          provider,
          reason: repoInitialization.reason,
        });
      }
      await emitProgress(options.onProgress, 'repo_initialized', repoInitialization);

      let repository = null;
      let pushResult = {
        createdCommit: repoInitialization.createdCommit,
        commitSha: repoInitialization.commitSha ?? null,
      };

      if (isGitHubConfigured() && !repoInitialization.skipped) {
        repository = await createRepo(repoName);
        await logger.info('GitHub repository is ready.', repository);
        await emitProgress(options.onProgress, 'repo_created', {
          repository,
        });

        pushResult = await pushRepo(project.projectPath, repoName);
        await logger.info('Project source pushed to GitHub.', pushResult);
        await emitProgress(options.onProgress, 'repo_pushed', {
          repository: {
            ...repository,
            commitSha: pushResult.commitSha,
          },
        });
      } else if (repoInitialization.skipped) {
        await logger.info('GitHub repository creation was skipped because git is unavailable in the current runtime.', {
          projectPath: project.projectPath,
          repoName,
        });
        await emitProgress(options.onProgress, 'repo_skipped', {
          reason: repoInitialization.reason,
          repoName,
        });
      } else {
        await logger.info('GitHub credentials are missing. Continuing with direct deployment only.', {
          projectPath: project.projectPath,
          repoName,
        });
        await emitProgress(options.onProgress, 'repo_skipped', {
          reason: 'GitHub credentials are not configured.',
          repoName,
        });
      }

      await emitProgress(options.onProgress, 'provider_deployment_started', {
        provider,
        repoName,
      });

      const providerResult = await PROVIDER_REGISTRY[provider](repoName, {
        projectPath: project.projectPath,
        project,
      });
      const deploymentResult = normalizeDeploymentResult(
        provider,
        deploymentKey,
        repository
          ? {
              repoName: repository.repoName,
              htmlUrl: repository.htmlUrl,
              remoteUrl: repository.remoteUrl,
              defaultBranch: repository.defaultBranch,
              commitSha: pushResult.commitSha,
            }
          : {
              repoName,
              htmlUrl: null,
              remoteUrl: null,
              defaultBranch: repoInitialization.branch ?? 'main',
              commitSha: pushResult.commitSha,
              directDeploy: true,
            },
        providerResult,
      );

      await logger.info('Deployment provider completed successfully.', deploymentResult);
      await emitProgress(options.onProgress, 'provider_deployment_completed', deploymentResult);
      await emitProgress(options.onProgress, 'deployment_completed', deploymentResult);

      return deploymentResult;
    } catch (error) {
      const failure = {
        status: 'failed',
        provider,
        deploymentKey,
        url: null,
        error: error?.message ?? 'Unexpected deployment failure.',
      };

      await logger.error('Deployment service failed.', {
        projectPath: project.projectPath,
        provider,
        error: failure.error,
      });
      await emitProgress(options.onProgress, 'deployment_failed', failure);

      return failure;
    }
  }
}

const deploymentService = new DeploymentService();

export async function deployProject(project, options = {}) {
  return deploymentService.deployProject(project, options);
}

export default deploymentService;
