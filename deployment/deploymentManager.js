function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function hasFeature(intent, featureNames) {
  const featureSet = new Set(intent.features ?? []);
  return featureNames.some((featureName) => featureSet.has(featureName));
}

function buildRuntimeCommands(intent) {
  if (intent.projectType === 'api_service') {
    return {
      installCommand: 'npm install',
      buildCommand: null,
      startCommand: 'npm start',
      outputDirectory: null,
      healthcheckPath: '/health',
    };
  }

  return {
    installCommand: 'npm install',
    buildCommand: 'npm run build',
    startCommand: 'npm run preview -- --host 0.0.0.0 --port $PORT',
    outputDirectory: 'dist',
    healthcheckPath: '/',
  };
}

function collectEnvironmentVariables(intent, integrationConfig = null) {
  const envVars = [
    'NODE_ENV=production',
    'PORT=3000',
    `APP_NAME=${intent.projectName}`,
    `PUBLIC_APP_NAME=${intent.projectName}`,
    'APP_URL=https://example.com',
    'SESSION_SECRET=change-me-in-production',
  ];

  if (hasFeature(intent, ['database', 'auth', 'payments'])) {
    envVars.push('DATABASE_URL=');
  }

  if (hasFeature(intent, ['auth'])) {
    envVars.push('AUTH_CALLBACK_URL=https://example.com/api/auth/callback');
  }

  if (hasFeature(intent, ['payments'])) {
    envVars.push('BILLING_SUCCESS_URL=https://example.com/billing/success');
    envVars.push('BILLING_CANCEL_URL=https://example.com/billing/cancel');
  }

  const integrationEnvVars = integrationConfig?.credentialSchema?.map(
    (entry) => `${entry.envVar}=`,
  ) ?? [];

  return unique([...envVars, ...integrationEnvVars]);
}

function buildEnvironmentTemplate(envVars) {
  return `# OmniForge generated environment template
# Replace blank values with deployment-specific secrets before publishing.

${envVars.join('\n')}
`;
}

function buildDockerfile(intent) {
  const runtime = buildRuntimeCommands(intent);
  const buildLine =
    runtime.buildCommand !== null ? `RUN ${runtime.buildCommand}\n` : '';
  const command =
    intent.projectType === 'api_service'
      ? 'CMD ["npm", "start"]'
      : 'CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3000"]';

  return `FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN ${runtime.installCommand}

COPY . .
${buildLine}EXPOSE 3000

${command}
`;
}

function buildVercelConfig(intent) {
  const runtime = buildRuntimeCommands(intent);

  if (intent.projectType === 'api_service') {
    return {
      version: 2,
      builds: [
        {
          src: 'server.js',
          use: '@vercel/node',
        },
      ],
      routes: [
        {
          src: '/(.*)',
          dest: 'server.js',
        },
      ],
    };
  }

  return {
    version: 2,
    framework: 'vite',
    installCommand: runtime.installCommand,
    buildCommand: runtime.buildCommand,
    outputDirectory: runtime.outputDirectory,
  };
}

function buildRailwayConfig(intent) {
  const runtime = buildRuntimeCommands(intent);

  return {
    $schema: 'https://railway.app/railway.schema.json',
    build: {
      builder: 'NIXPACKS',
      buildCommand: runtime.buildCommand,
    },
    deploy: {
      startCommand: runtime.startCommand,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 5,
      healthcheckPath: runtime.healthcheckPath,
    },
  };
}

function buildDeploymentReadme(intent, deploymentPackage) {
  const envLines = deploymentPackage.envVars.map((envVar) => `- ${envVar}`).join('\n');

  return `# Deployment Package

## Targets

- Primary: ${deploymentPackage.primaryTarget}
- Secondary: ${deploymentPackage.secondaryTarget}

## Runtime

- Project Type: ${intent.projectType}
- Goal: ${intent.goal}

## Files

- Dockerfile
- vercel.json
- deployment/railway.json
- .env.example

## Environment Variables

${envLines}
`;
}

export class DeploymentManager {
  prepareDeploymentPackage(intent, { integrationConfig = null } = {}) {
    const envVars = collectEnvironmentVariables(intent, integrationConfig);
    const deploymentPackage = {
      primaryTarget: 'vercel',
      secondaryTarget: 'railway',
      envVars,
      files: [
        {
          path: 'Dockerfile',
          content: buildDockerfile(intent),
        },
        {
          path: 'vercel.json',
          content: JSON.stringify(buildVercelConfig(intent), null, 2),
        },
        {
          path: 'deployment/railway.json',
          content: JSON.stringify(buildRailwayConfig(intent), null, 2),
        },
        {
          path: '.env.example',
          content: buildEnvironmentTemplate(envVars),
        },
        {
          path: 'deployment/README.md',
          content: buildDeploymentReadme(intent, {
            primaryTarget: 'vercel',
            secondaryTarget: 'railway',
            envVars,
          }),
        },
      ],
    };

    return deploymentPackage;
  }
}

const deploymentManager = new DeploymentManager();

export default deploymentManager;
