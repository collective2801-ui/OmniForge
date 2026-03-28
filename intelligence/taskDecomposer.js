export function decomposeTask(input = {}) {
  return {
    steps: [
      'analyze',
      'design',
      'build',
      'validate',
      'deploy',
    ],
    features: Array.isArray(input.features) ? input.features : [],
  };
}

export default {
  decomposeTask,
};
