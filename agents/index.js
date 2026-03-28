import { decomposeTask } from '../intelligence/taskDecomposer.js';
import { buildAppFromSpec } from './appBuilder.js';
import { buildMultipleApps, buildSelectedApps } from './multiAppBuilder.js';
import { runSwarm } from './swarm.js';

function normalizeTask(task = {}) {
  if (!task || typeof task !== 'object') {
    throw new TypeError('runAgents(task) requires a task object.');
  }

  return {
    ...task,
    features: Array.isArray(task.features) ? task.features : [],
  };
}

export async function runAgents(task) {
  const agents = [
    plannerAgent,
    builderAgent,
    reviewerAgent,
    optimizerAgent,
    securityAgent,
  ];

  let state = {
    task: normalizeTask(task),
  };

  for (const agent of agents) {
    state = await agent(state);
  }

  return state;
}

export async function plannerAgent(state) {
  const decomposition = decomposeTask(state.task);

  return {
    ...state,
    plan: {
      ...decomposition,
      architecture: 'full-stack',
    },
  };
}

export async function builderAgent(state) {
  return {
    ...state,
    app: {
      features: state.plan.features,
      built: true,
    },
  };
}

export async function reviewerAgent(state) {
  return {
    ...state,
    review: { passed: true },
  };
}

export async function optimizerAgent(state) {
  return {
    ...state,
    optimized: true,
  };
}

export async function securityAgent(state) {
  return {
    ...state,
    secured: true,
  };
}

export default {
  buildAppFromSpec,
  buildMultipleApps,
  buildSelectedApps,
  runAgents,
  runSwarm,
  plannerAgent,
  builderAgent,
  reviewerAgent,
  optimizerAgent,
  securityAgent,
};

export {
  buildAppFromSpec,
  buildMultipleApps,
  buildSelectedApps,
  runSwarm,
};
