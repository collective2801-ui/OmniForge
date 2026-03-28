import path from 'node:path';
import { writeFileSafe } from '../../engine/fileSystem.js';
import {
  buildCheckoutSessionTemplate,
  buildClientIntegrationTemplate,
  buildWebhookHandlerTemplate,
} from '../templates/stripeTemplate.js';

const STRIPE_ENV_ENTRIES = Object.freeze([
  {
    key: 'STRIPE_SECRET_KEY',
    service: 'payments',
    provider: 'stripe',
    description: 'Server-side Stripe secret key for creating checkout sessions.',
    required: true,
  },
  {
    key: 'STRIPE_PUBLIC_KEY',
    service: 'payments',
    provider: 'stripe',
    description: 'Frontend Stripe publishable key for client-side payment UI if needed later.',
    required: true,
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    service: 'payments',
    provider: 'stripe',
    description: 'Webhook signing secret used to verify Stripe events.',
    required: true,
  },
  {
    key: 'BILLING_SUCCESS_URL',
    service: 'payments',
    provider: 'stripe',
    description: 'Absolute URL used after a successful checkout session.',
    required: true,
  },
  {
    key: 'BILLING_CANCEL_URL',
    service: 'payments',
    provider: 'stripe',
    description: 'Absolute URL used after a cancelled checkout session.',
    required: true,
  },
]);

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for Stripe integration scaffolding.');
  }
}

async function writeGeneratedFiles(projectPath, files) {
  const writtenFiles = [];

  for (const file of files) {
    const absolutePath = path.join(projectPath, file.path);
    await writeFileSafe(absolutePath, file.content);
    writtenFiles.push({
      path: file.path,
      absolutePath,
    });
  }

  return writtenFiles;
}

function buildStripeReadme() {
  return `# Stripe Integration

## Generated Modules

- \`integrations/stripe/server/createCheckoutSession.js\`
- \`integrations/stripe/server/stripeWebhook.js\`
- \`integrations/stripe/client/createCheckoutSession.js\`

## Secure Usage Notes

- Keep \`STRIPE_SECRET_KEY\` and \`STRIPE_WEBHOOK_SECRET\` on the server only.
- Expose checkout through a server endpoint and never create sessions directly from the client.
- Verify webhook signatures before mutating billing state.
`;
}

export async function setupStripeIntegration(projectPath) {
  assertProjectPath(projectPath);

  const files = [
    {
      path: 'integrations/stripe/server/createCheckoutSession.js',
      content: buildCheckoutSessionTemplate(),
    },
    {
      path: 'integrations/stripe/server/stripeWebhook.js',
      content: buildWebhookHandlerTemplate(),
    },
    {
      path: 'integrations/stripe/client/createCheckoutSession.js',
      content: buildClientIntegrationTemplate(),
    },
    {
      path: 'integrations/stripe/README.md',
      content: buildStripeReadme(),
    },
  ];
  const writtenFiles = await writeGeneratedFiles(projectPath, files);

  return {
    integrationId: 'stripe',
    service: 'payments',
    provider: 'stripe',
    envEntries: [...STRIPE_ENV_ENTRIES],
    files: writtenFiles,
    notes: [
      'Stripe checkout flow is server-driven and uses the official HTTPS API.',
      'Webhook verification is scaffolded with HMAC validation to protect billing state.',
    ],
  };
}

export default {
  setupStripeIntegration,
};
