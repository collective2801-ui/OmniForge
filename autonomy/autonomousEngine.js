import { buildBusinessModel } from './businessBuilder.js';
import { generateGrowthPlan } from './growthEngine.js';
import { runAgents } from '../intelligence/agentOrchestrator.js';

function assertGoal(goal) {
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    throw new TypeError('Autonomous mode requires a non-empty goal.');
  }

  return goal.trim();
}

function inferProductBuildPrompt(goal) {
  const normalizedGoal = assertGoal(goal);

  if (/\bdeploy\b/i.test(normalizedGoal)) {
    return normalizedGoal;
  }

  return `${normalizedGoal} with a production-ready SaaS stack, subscription billing, landing page, onboarding flow, deployment, and a custom domain plan`;
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

export async function autonomousRun(task) {
  let cycles = 0;
  let result;

  while (cycles < 3) {
    result = await runAgents(task);

    if (result.review?.passed) {
      break;
    }

    cycles += 1;
  }

  return result;
}

export async function runAutonomousMode(goal, options = {}) {
  const normalizedGoal = assertGoal(goal);
  const productBuildPrompt = inferProductBuildPrompt(normalizedGoal);
  const phases = {
    productBuild: 'build the product',
    deployment: 'deploy the product',
    domain: 'prepare the domain workflow',
    monetization: 'generate the business model',
    growth: 'generate the growth plan',
  };

  await emitProgress(options.onProgress, 'autonomous_mode_started', {
    goal: normalizedGoal,
    phases,
    productBuildPrompt,
  });

  const orchestratorModule = await import('../orchestrator/orchestrator.js');
  const runTask = orchestratorModule.runTask;

  if (typeof runTask !== 'function') {
    throw new Error('Autonomous mode could not access the orchestrator task runner.');
  }

  const product = await runTask(productBuildPrompt, {
    ...options,
    skipAutonomousMode: true,
    intentOverrides: {
      goal: 'build_app',
      projectType: 'web_app',
      assumptions: [
        'Treat this as a product build request first, then allow deployment and domain automation after generation completes.',
      ],
    },
  });
  const projectPath = product.projectRoot ?? product.project?.projectPath ?? '';

  await emitProgress(options.onProgress, 'autonomous_product_ready', {
    status: product.status,
    projectName: product.project?.projectName ?? product.intent?.projectName ?? null,
    projectPath,
    files: product.files ?? [],
  });

  const business = await buildBusinessModel(
    {
      ...product.intent,
      summary: normalizedGoal,
      projectName: product.project?.projectName ?? product.intent?.projectName,
    },
    {
      projectPath,
    },
  );
  await emitProgress(options.onProgress, 'business_model_ready', {
    ...business,
  });

  const growth = await generateGrowthPlan(
    {
      intent: product.intent,
      project: product.project,
      business,
    },
    {
      projectPath,
    },
  );
  await emitProgress(options.onProgress, 'growth_plan_ready', {
    ...growth,
  });

  const result = {
    ...product,
    generatedAt: new Date().toISOString(),
    goal: normalizedGoal,
    phases,
    product,
    business,
    growth,
    autonomous: true,
    businessReady: business.status === 'ready' && growth.status === 'ready',
    status: product.productionReady === true ? 'complete' : (product.status ?? 'complete'),
    workflowStatus: product.workflowStatus ?? product.status ?? 'complete',
    validated: product.validated === true,
    productionReady: product.productionReady === true,
    files: [
      ...(Array.isArray(product.files) ? product.files : []),
      ...(Array.isArray(business.files) ? business.files : []),
      ...(Array.isArray(growth.files) ? growth.files : []),
    ],
  };

  await emitProgress(options.onProgress, 'autonomous_mode_completed', result);

  return result;
}

export default {
  autonomousRun,
  runAutonomousMode,
};
