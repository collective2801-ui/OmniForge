import path from 'node:path';
import deploymentManager from '../deployment/deploymentManager.js';
import domainManager from '../domain/domainManager.js';
import { writeFileSafe } from '../engine/fileSystem.js';
import { validateFiles } from '../engine/validator.js';

function assertExecutionContext(step, context) {
  if (!step || typeof step !== 'object') {
    throw new TypeError('Deployment step must be an object.');
  }

  if (!context || typeof context !== 'object') {
    throw new TypeError('Deployment context must be an object.');
  }

  if (typeof context.projectRoot !== 'string' || context.projectRoot.trim().length === 0) {
    throw new TypeError('Deployment context must include a projectRoot.');
  }

  if (!context.intent || typeof context.intent !== 'object') {
    throw new TypeError('Deployment context must include an intent.');
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

export class DeploymentAgent {
  async executeStep(step, context) {
    assertExecutionContext(step, context);

    const executionState = context.executionState ?? {};

    switch (step.action) {
      case 'prepare_deployment':
        return this.prepareDeployment(step, context, executionState);
      case 'prepare_domain_workflow':
        return this.prepareDomainWorkflow(step, context, executionState);
      default:
        throw new Error(`DeploymentAgent cannot handle action "${step.action}".`);
    }
  }

  async prepareDeployment(step, context, executionState) {
    const deploymentPackage = deploymentManager.prepareDeploymentPackage(context.intent, {
      integrationConfig: executionState.integrationConfig ?? null,
    });
    const files = validateFiles(deploymentPackage.files);
    const writtenFiles = await writeGeneratedFiles(context.projectRoot, files);

    executionState.deploymentPackage = {
      primaryTarget: deploymentPackage.primaryTarget,
      secondaryTarget: deploymentPackage.secondaryTarget,
      envVars: deploymentPackage.envVars,
    };

    return {
      stepId: step.id,
      title: step.title,
      agent: 'deployment',
      action: step.action,
      status: 'completed',
      summary: 'Deployment files prepared for Vercel and Railway targets.',
      files: writtenFiles,
      artifacts: {
        deploymentPackage: {
          primaryTarget: deploymentPackage.primaryTarget,
          secondaryTarget: deploymentPackage.secondaryTarget,
          envVars: deploymentPackage.envVars,
        },
      },
      metadata: {
        fileCount: writtenFiles.length,
      },
    };
  }

  async prepareDomainWorkflow(step, context, executionState) {
    const domainPackage = domainManager.prepareDomainPackage(context.intent, {
      deploymentTarget: executionState.deploymentPackage?.primaryTarget ?? 'vercel',
    });
    const files = validateFiles(domainPackage.files);
    const writtenFiles = await writeGeneratedFiles(context.projectRoot, files);

    executionState.domainPackage = {
      primaryDomain: domainPackage.primaryDomain,
      availability: domainPackage.availability,
    };

    return {
      stepId: step.id,
      title: step.title,
      agent: 'deployment',
      action: step.action,
      status: 'completed',
      summary: 'Domain workflow structure and DNS records prepared.',
      files: writtenFiles,
      artifacts: {
        primaryDomain: domainPackage.primaryDomain,
        availability: domainPackage.availability,
        suggestions: domainPackage.suggestions,
      },
      metadata: {
        suggestionCount: domainPackage.suggestions.length,
      },
    };
  }
}

const deploymentAgent = new DeploymentAgent();

export default deploymentAgent;
