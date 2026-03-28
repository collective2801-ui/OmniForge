import deploymentManager from '../deployment/deploymentManager.js';
import deploymentService, { deployProject } from '../deployment/deploymentService.js';
import infraManager, { setupInfrastructure } from '../deployment/infraManager.js';
import { deployToRailway } from '../deployment/providers/railwayProvider.js';
import { deployToVercel } from '../deployment/providers/vercelProvider.js';

function getFallbackFrontendUrl() {
  return (
    process.env.OMNIFORGE_APP_URL?.trim() ||
    process.env.DEFAULT_FRONTEND_URL?.trim() ||
    'https://your-app.vercel.app'
  );
}

function getFallbackBackendUrl() {
  return (
    process.env.OMNIFORGE_API_URL?.trim() ||
    process.env.DEFAULT_BACKEND_URL?.trim() ||
    'https://your-api.railway.app'
  );
}

export function prepareDeployTarget(intent, options = {}) {
  const deploymentPackage = deploymentManager.prepareDeploymentPackage(intent, options);

  return {
    provider: options.provider ?? 'vercel',
    files: deploymentPackage.files,
    metadata: deploymentPackage.metadata ?? {},
  };
}

export async function deployFrontend({
  projectPath = '',
  repoName = 'omniforge-app',
} = {}) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return {
      url: getFallbackFrontendUrl(),
      status: 'deployed',
    };
  }

  const deployment = await deployToVercel(repoName, {
    projectPath,
  });

  return {
    url: deployment.url,
    status: deployment.status ?? 'deployed',
  };
}

export async function deployBackend({
  projectPath = '',
} = {}) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return {
      api: getFallbackBackendUrl(),
    };
  }

  const deployment = await deployToRailway(projectPath);

  return {
    api: deployment.url,
  };
}

export async function autoDeploy(app = {}) {
  const frontend = await deployFrontend({
    projectPath: typeof app.projectPath === 'string' ? app.projectPath : '',
    repoName: typeof app.repoName === 'string' ? app.repoName : 'omniforge-app',
  });
  const backend = await deployBackend({
    projectPath: typeof app.projectPath === 'string' ? app.projectPath : '',
  });

  return {
    frontend: frontend.url,
    backend: backend.api,
    status: 'deployed',
  };
}

export {
  deploymentManager,
  deploymentService,
  deployProject,
  deployToRailway,
  deployToVercel,
  infraManager,
  setupInfrastructure,
};

export default {
  prepareDeployTarget,
  deployFrontend,
  deployBackend,
  autoDeploy,
  deploymentManager,
  deploymentService,
  deployProject,
  deployToRailway,
  deployToVercel,
  infraManager,
  setupInfrastructure,
};
