import { generateCode } from '../brain/llmEngine.js';

export async function buildAppFromSpec(spec) {
  const prompt = `
  Build a full production-ready app:
  ${JSON.stringify(spec)}
  Include frontend, backend, and API.
  `;

  return generateCode(prompt);
}

export default {
  buildAppFromSpec,
};
