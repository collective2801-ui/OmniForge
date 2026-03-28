import path from 'node:path';
import apiManager from '../api/apiManager.js';
import { writeFileSafe } from '../engine/fileSystem.js';
import { validateFiles } from '../engine/validator.js';

function assertExecutionContext(step, context) {
  if (!step || typeof step !== 'object') {
    throw new TypeError('Integration step must be an object.');
  }

  if (!context || typeof context !== 'object') {
    throw new TypeError('Integration context must be an object.');
  }

  if (typeof context.projectRoot !== 'string' || context.projectRoot.trim().length === 0) {
    throw new TypeError('Integration context must include a projectRoot.');
  }

  if (!context.intent || typeof context.intent !== 'object') {
    throw new TypeError('Integration context must include an intent.');
  }
}

async function writeGeneratedFiles(projectRoot, files) {
  const writtenFiles = [];

  for (const file of files) {
    const absolutePath = path.join(projectRoot, file.path);
    await writeFileSafe(absolutePath, file.content);
    writtenFiles.push({
      path: file.path,
      absolutePath,
    });
  }

  return writtenFiles;
}

export class IntegrationAgent {
  async executeStep(step, context) {
    assertExecutionContext(step, context);

    if (step.action !== 'prepare_api_integrations') {
      throw new Error(`IntegrationAgent cannot handle action "${step.action}".`);
    }

    const executionState = context.executionState ?? {};
    const apiConfig = apiManager.buildApiConfig(context.intent);
    const storedConfigFile = await apiManager.storeApiConfig(context.projectRoot, apiConfig);
    const integrationFiles = validateFiles(
      apiManager.buildIntegrationFiles(context.intent, apiConfig),
    );
    const writtenFiles = await writeGeneratedFiles(context.projectRoot, integrationFiles);
    const allFiles = [storedConfigFile, ...writtenFiles];

    executionState.integrationConfig = apiConfig;

    return {
      stepId: step.id,
      title: step.title,
      agent: 'integration',
      action: step.action,
      status: 'completed',
      summary: apiConfig.externalApisRequired
        ? 'External API providers identified and integration artifacts generated.'
        : 'No external API dependency is required, but integration scaffolding was prepared.',
      files: allFiles,
      artifacts: {
        apiConfig,
      },
      metadata: {
        providerGroupCount: apiConfig.suggestedProviders.length,
        credentialCount: apiConfig.credentialSchema.length,
      },
    };
  }
}

const integrationAgent = new IntegrationAgent();

export default integrationAgent;
