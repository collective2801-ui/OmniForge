import path from 'node:path';
import apiManager from '../api/apiManager.js';
import logger from '../engine/logger.js';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import { generateEnvExample } from './config/envManager.js';
import { setupStorageIntegration } from './providers/storageProvider.js';
import { setupStripeIntegration } from './providers/stripeProvider.js';
import { setupSupabaseIntegration } from './providers/supabaseProvider.js';

const SERVICE_ORDER = Object.freeze(['payments', 'auth', 'storage']);
const SERVICE_REGISTRY = Object.freeze({
  payments: {
    integrationId: 'stripe',
    provider: 'stripe',
    setup: setupStripeIntegration,
  },
  auth: {
    integrationId: 'auth',
    provider: 'supabase',
    setup: setupSupabaseIntegration,
  },
  storage: {
    integrationId: 'storage',
    provider: 'supabase-storage',
    setup: setupStorageIntegration,
  },
});

function assertIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new TypeError('Intent object is required for API automation.');
  }
}

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for API automation scaffolding.');
  }
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

function detectRequiredServices(intent) {
  const featureSet = new Set(intent.features ?? []);
  const services = [];

  if (featureSet.has('payments')) {
    services.push('payments');
  }

  if (featureSet.has('auth') || intent.goal === 'create_api') {
    services.push('auth');
  }

  if (featureSet.has('file_uploads')) {
    services.push('storage');
  }

  return SERVICE_ORDER.filter((service) => services.includes(service));
}

function buildIntegrationReadme(intent, integrationPlan) {
  const serviceLines = integrationPlan.selectedServices
    .map((service) => {
      const provider = integrationPlan.providers[service] ?? 'unassigned';
      return `- ${service}: ${provider}`;
    })
    .join('\n');
  const notes = integrationPlan.notes.map((note) => `- ${note}`).join('\n');

  return `# API Automation

## Project

${intent.projectName}

## Configured Services

${serviceLines || '- No post-build API integrations were required.'}

## Environment File

- \`.env.example\`

## Notes

${notes}
`;
}

async function writePlanArtifacts(projectPath, intent, integrationPlan) {
  await ensureDirectory(path.join(projectPath, 'integrations'));

  const planJsonPath = path.join(projectPath, 'integrations', 'api-automation-plan.json');
  const readmePath = path.join(projectPath, 'integrations', 'API_AUTOMATION.md');

  await writeJsonSafe(planJsonPath, integrationPlan);
  await writeFileSafe(readmePath, buildIntegrationReadme(intent, integrationPlan));

  return [
    {
      path: 'integrations/api-automation-plan.json',
      absolutePath: planJsonPath,
    },
    {
      path: 'integrations/API_AUTOMATION.md',
      absolutePath: readmePath,
    },
  ];
}

export class ApiOrchestrator {
  async handleAPIIntegrations(intent, options = {}) {
    assertIntent(intent);

    const projectPath = options.projectPath ?? '';
    assertProjectPath(projectPath);

    try {
      const selectedServices = detectRequiredServices(intent);
      const baseApiConfig = apiManager.buildApiConfig(intent);

      await logger.info('API automation started.', {
        projectName: intent.projectName,
        selectedServices,
      });
      await emitProgress(options.onProgress, 'api_integrations_started', {
        projectName: intent.projectName,
        selectedServices,
      });

      if (selectedServices.length === 0) {
        const emptyPlan = {
          generatedAt: new Date().toISOString(),
          status: 'skipped',
          integrations: [],
          selectedServices: [],
          providers: {},
          envKeys: [],
          files: [],
          notes: ['No auth, payments, or storage capabilities were required by the detected intent.'],
          apiConfig: baseApiConfig,
        };

        await emitProgress(options.onProgress, 'api_integrations_ready', emptyPlan);
        return emptyPlan;
      }

      const providerResults = [];

      for (const service of selectedServices) {
        const registryEntry = SERVICE_REGISTRY[service];
        const result = await registryEntry.setup(projectPath);
        providerResults.push(result);
        await emitProgress(options.onProgress, 'api_integration_provider_configured', {
          service,
          provider: result.provider,
          integrationId: result.integrationId,
          files: result.files,
        });
      }

      const envEntries = providerResults.flatMap((result) => result.envEntries ?? []);
      const envFile = await generateEnvExample(projectPath, envEntries);
      const providers = Object.fromEntries(
        providerResults.map((result) => [result.service, result.provider]),
      );
      const notes = [
        'Server-side secrets must remain outside client bundles and should only be used in secure server execution paths.',
        'Webhook endpoints must verify signatures before mutating billing or storage state.',
        'S3 uploads should use presigned URLs instead of exposing AWS credentials to the browser.',
      ];
      const integrationPlan = {
        generatedAt: new Date().toISOString(),
        status: 'configured',
        integrations: providerResults.map((result) => result.integrationId),
        selectedServices,
        providers,
        envKeys: envFile.envKeys,
        recommendedProviders: baseApiConfig.suggestedProviders,
        endpointContracts: baseApiConfig.endpointContracts,
        notes: [...notes, ...providerResults.flatMap((result) => result.notes ?? [])],
        apiConfig: baseApiConfig,
      };
      const planArtifacts = await writePlanArtifacts(projectPath, intent, integrationPlan);
      const files = [
        ...providerResults.flatMap((result) => result.files ?? []),
        envFile,
        ...planArtifacts,
      ];
      const result = {
        ...integrationPlan,
        files,
      };

      await logger.info('API automation completed.', {
        projectName: intent.projectName,
        integrations: result.integrations,
      });
      await emitProgress(options.onProgress, 'api_integrations_ready', result);

      return result;
    } catch (error) {
      const failure = {
        generatedAt: new Date().toISOString(),
        status: 'failed',
        integrations: [],
        selectedServices: [],
        providers: {},
        envKeys: [],
        files: [],
        error: error?.message ?? 'Unexpected API automation failure.',
      };

      await logger.error('API automation failed.', {
        projectName: intent.projectName ?? null,
        error: failure.error,
      });
      await emitProgress(options.onProgress, 'api_integrations_failed', failure);

      return failure;
    }
  }
}

const apiOrchestrator = new ApiOrchestrator();

export async function handleAPIIntegrations(intent, options = {}) {
  return apiOrchestrator.handleAPIIntegrations(intent, options);
}

export default apiOrchestrator;
