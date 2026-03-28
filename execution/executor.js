import { randomUUID } from 'node:crypto';
import builderAgent from '../agents/builderAgent.js';
import deploymentAgent from '../agents/deploymentAgent.js';
import integrationAgent from '../agents/integrationAgent.js';
import contextMemory from '../engine/contextMemory.js';
import logger from '../engine/logger.js';

const AGENT_REGISTRY = Object.freeze({
  builder: builderAgent,
  integration: integrationAgent,
  deployment: deploymentAgent,
});

function assertPlan(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new TypeError('Execution plan must be an object.');
  }

  if (!Array.isArray(plan.executionGraph) || plan.executionGraph.length === 0) {
    throw new Error('Execution plan must include a non-empty executionGraph.');
  }
}

function createExecutionLog(level, message, meta = {}) {
  return {
    id: randomUUID(),
    level,
    message,
    meta,
    timestamp: new Date().toISOString(),
  };
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

function summarizeStepResult(stepResult) {
  return {
    stepId: stepResult.stepId,
    title: stepResult.title,
    agent: stepResult.agent,
    action: stepResult.action,
    status: stepResult.status,
    summary: stepResult.summary,
    fileCount: Array.isArray(stepResult.files) ? stepResult.files.length : 0,
    metadata: stepResult.metadata ?? {},
  };
}

function summarizeArtifacts(artifacts) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => {
      if (!value || typeof value !== 'object') {
        return [key, value];
      }

      if (Array.isArray(value)) {
        return [key, { itemCount: value.length }];
      }

      return [
        key,
        Object.fromEntries(
          Object.entries(value)
            .filter(([artifactKey]) => artifactKey !== 'files')
            .map(([artifactKey, artifactValue]) => {
              if (Array.isArray(artifactValue)) {
                return [artifactKey, { itemCount: artifactValue.length }];
              }

              return [artifactKey, artifactValue];
            }),
        ),
      ];
    }),
  );
}

async function persistExecutionSnapshot(context, {
  status,
  currentStep = null,
  stepResults = [],
  executionLog = [],
  artifacts = {},
}) {
  const memory = context.memory ?? contextMemory;

  return memory.saveSession({
    id: context.sessionId,
    createdAt: context.sessionCreatedAt,
    name: `OmniForge Task: ${context.intent.projectName || 'generated-project'}`,
    summary: context.userInput,
    status,
    data: {
      userInput: context.userInput,
      intent: context.intent,
      route: context.route,
      project: {
        projectId: context.project?.projectId ?? null,
        projectName: context.project?.projectName ?? context.intent.projectName,
        projectPath: context.projectRoot,
      },
      plan: {
        planId: context.plan.planId,
        steps: context.plan.steps,
      },
      currentStep,
      stepResults: stepResults.map(summarizeStepResult),
      executionLog,
      artifacts: summarizeArtifacts(artifacts),
    },
  });
}

async function updateProjectExecutionStatus(context, status) {
  if (!context.project?.projectId || !context.projectRegistry) {
    return null;
  }

  return context.projectRegistry.updateProject(context.project.projectId, { status });
}

export class Executor {
  async executePlan(plan, context) {
    assertPlan(plan);

    const activeLogger = context.logger ?? logger;
    const onProgress = context.onProgress;
    const executionState = context.executionState ?? {};
    const stepResults = [];
    const executionLog = [];
    const writtenFiles = new Map();
    const artifacts = {};

    await updateProjectExecutionStatus(context, 'executing');
    await persistExecutionSnapshot(context, {
      status: 'executing',
      currentStep: null,
      stepResults,
      executionLog,
      artifacts,
    });
    await emitProgress(onProgress, 'plan_execution_started', {
      planId: plan.planId,
      steps: plan.steps,
    });

    for (const step of plan.executionGraph) {
      const agent = AGENT_REGISTRY[step.agent];

      if (!agent || typeof agent.executeStep !== 'function') {
        throw new Error(`No executable agent is registered for "${step.agent}".`);
      }

      const dispatchLog = createExecutionLog('info', 'Dispatching step to agent.', {
        stepId: step.id,
        title: step.title,
        agent: step.agent,
      });
      executionLog.push(dispatchLog);
      await emitProgress(onProgress, 'step_started', {
        planId: plan.planId,
        step,
      });

      await activeLogger.info('Executor dispatching step.', {
        sessionId: context.sessionId,
        stepId: step.id,
        title: step.title,
        agent: step.agent,
      });
      await updateProjectExecutionStatus(
        context,
        `executing:${step.action}`,
      );
      await persistExecutionSnapshot(context, {
        status: 'executing',
        currentStep: step.title,
        stepResults,
        executionLog,
        artifacts,
      });

      try {
        const stepResult = await agent.executeStep(step, {
          ...context,
          executionState,
          plan,
        });

        stepResults.push(stepResult);

        for (const file of stepResult.files ?? []) {
          writtenFiles.set(file.path, file);
        }

        if (stepResult.artifacts !== undefined) {
          artifacts[step.action] = stepResult.artifacts;
        }

        const completionLog = createExecutionLog('info', 'Step completed successfully.', {
          stepId: step.id,
          title: step.title,
          agent: step.agent,
          fileCount: stepResult.files?.length ?? 0,
        });
        executionLog.push(completionLog);
        await emitProgress(onProgress, 'step_completed', {
          planId: plan.planId,
          step,
          result: stepResult,
        });

        await activeLogger.info('Executor completed step.', {
          sessionId: context.sessionId,
          stepId: step.id,
          title: step.title,
          agent: step.agent,
          fileCount: stepResult.files?.length ?? 0,
        });
        await persistExecutionSnapshot(context, {
          status: 'executing',
          currentStep: step.title,
          stepResults,
          executionLog,
          artifacts,
        });
      } catch (error) {
        const failureLog = createExecutionLog('error', 'Step execution failed.', {
          stepId: step.id,
          title: step.title,
          agent: step.agent,
          error: error?.message ?? String(error),
        });
        executionLog.push(failureLog);
        await emitProgress(onProgress, 'step_failed', {
          planId: plan.planId,
          step,
          message: error?.message ?? String(error),
        });

        await activeLogger.error('Executor failed step.', {
          sessionId: context.sessionId,
          stepId: step.id,
          title: step.title,
          agent: step.agent,
          error: error?.message ?? String(error),
        });
        await updateProjectExecutionStatus(context, 'failed');
        await persistExecutionSnapshot(context, {
          status: 'failed',
          currentStep: step.title,
          stepResults,
          executionLog,
          artifacts,
        });

        throw new Error(
          `Execution failed during "${step.title}": ${error?.message ?? String(error)}`,
        );
      }
    }

    const summary = {
      planId: plan.planId,
      stepCount: stepResults.length,
      generatedFileCount: writtenFiles.size,
      completedAt: new Date().toISOString(),
    };
    await emitProgress(onProgress, 'plan_execution_completed', summary);

    await updateProjectExecutionStatus(context, 'prepared');
    await persistExecutionSnapshot(context, {
      status: 'executed',
      currentStep: null,
      stepResults,
      executionLog,
      artifacts,
    });

    return {
      planId: plan.planId,
      stepResults,
      executionLog,
      files: [...writtenFiles.values()],
      artifacts,
      executionState,
      summary,
    };
  }
}

const executor = new Executor();

export async function executePlan(plan, context) {
  return executor.executePlan(plan, context);
}

export default executor;
