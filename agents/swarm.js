import { generateCode } from '../brain/llmEngine.js';

export async function runSwarm(task) {
  const agents = [
    'frontend',
    'backend',
    'database',
    'api',
    'security',
  ];

  const results = await Promise.all(
    agents.map((agent) => runAgent(agent, task)),
  );

  return merge(results);
}

export async function runAgent(type, task) {
  const prompt = `Build ${type} for: ${JSON.stringify(task)}`;
  const output = await generateCode(prompt);

  return {
    type,
    output,
  };
}

export function merge(results) {
  return results.reduce((accumulator, result) => {
    accumulator[result.type] = result.output;
    return accumulator;
  }, {});
}

export default {
  runSwarm,
  runAgent,
  merge,
};
