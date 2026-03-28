import { memory } from '../memory/memoryEngine.js';

export function reflect(result) {
  const score = evaluate(result);

  memory.history.push({ result, score });

  return score;
}

export function evaluate(result) {
  let score = 100;

  if (!result?.validated) {
    score -= 50;
  }

  if (!result?.productionReady) {
    score -= 30;
  }

  return score;
}

export default {
  reflect,
  evaluate,
};
