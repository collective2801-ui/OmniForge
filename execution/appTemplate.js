import express from 'express';
import { generateUI } from '../intelligence/uiGenerator.js';
import { generateCodeFromIntent } from '../engine/codeGenerator.js';

function normalizeTemplateInput(input = {}) {
  const features = Array.isArray(input.features) ? input.features : [];

  return {
    projectName: input.name ?? input.projectName ?? 'omniforge-app',
    goal: input.goal ?? 'build_app',
    projectType: input.projectType ?? input.type ?? 'application',
    features,
    summary:
      input.summary ??
      input.description ??
      `Build a production-ready ${input.type ?? 'application'} with ${features.join(', ') || 'core product features'}.`,
  };
}

export async function buildAppTemplate(input = {}) {
  return generateCodeFromIntent(normalizeTemplateInput(input));
}

export async function createAppTemplate(input = {}) {
  return buildAppTemplate(input);
}

export function buildFullApp(spec = {}) {
  const schema = generateSchema(spec);
  const app = express();
  const frontend = generateUI(spec);

  app.get('/', (req, res) => {
    res.send(frontend);
  });

  return {
    backend: app,
    server: app,
    frontend,
    schema,
  };
}

function generateSchema(spec = {}) {
  const schema = {};
  const features = Array.isArray(spec.features) ? spec.features : [];

  if (features.includes('auth')) {
    schema.users = ['id', 'email', 'password'];
  }

  if (features.includes('dashboard')) {
    schema.data = ['id', 'value'];
  }

  return schema;
}

export default {
  buildAppTemplate,
  createAppTemplate,
  buildFullApp,
};
