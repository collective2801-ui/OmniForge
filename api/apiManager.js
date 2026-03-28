import path from 'node:path';
import { writeJsonSafe } from '../engine/fileSystem.js';

const PROVIDER_CATALOG = Object.freeze({
  auth: [
    {
      name: 'Clerk',
      category: 'authentication',
      rationale: 'Fast hosted authentication with session and organization support.',
      envVars: ['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
    },
    {
      name: 'Auth0',
      category: 'authentication',
      rationale: 'Enterprise-friendly identity workflows and adaptable auth policies.',
      envVars: ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET'],
    },
    {
      name: 'Supabase Auth',
      category: 'authentication',
      rationale: 'Integrated auth when the project also benefits from managed data services.',
      envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
  ],
  payments: [
    {
      name: 'Stripe',
      category: 'billing',
      rationale: 'Comprehensive SaaS billing, subscriptions, and webhook support.',
      envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY'],
    },
    {
      name: 'Paddle',
      category: 'billing',
      rationale: 'Merchant-of-record billing with international subscription support.',
      envVars: ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET'],
    },
    {
      name: 'Lemon Squeezy',
      category: 'billing',
      rationale: 'Simple digital product billing with subscription support.',
      envVars: ['LEMON_SQUEEZY_API_KEY', 'LEMON_SQUEEZY_STORE_ID'],
    },
  ],
  notifications: [
    {
      name: 'Resend',
      category: 'email',
      rationale: 'Clean developer-facing API for transactional email delivery.',
      envVars: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
    },
    {
      name: 'SendGrid',
      category: 'email',
      rationale: 'High-volume email delivery with mature operational tooling.',
      envVars: ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
    },
    {
      name: 'Twilio',
      category: 'messaging',
      rationale: 'SMS and voice notifications for workflows that extend beyond email.',
      envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    },
  ],
  database: [
    {
      name: 'Neon',
      category: 'database',
      rationale: 'Managed Postgres with branch-based development workflows.',
      envVars: ['DATABASE_URL'],
    },
    {
      name: 'Supabase',
      category: 'database',
      rationale: 'Managed data platform suitable for auth, storage, and realtime features.',
      envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
    {
      name: 'PlanetScale',
      category: 'database',
      rationale: 'Managed MySQL with production-ready scaling characteristics.',
      envVars: ['DATABASE_URL'],
    },
  ],
  storage: [
    {
      name: 'Cloudinary',
      category: 'storage',
      rationale: 'Hosted media transformation and asset delivery.',
      envVars: ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'],
    },
    {
      name: 'Amazon S3',
      category: 'storage',
      rationale: 'Durable object storage for files, assets, and generated exports.',
      envVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_REGION'],
    },
    {
      name: 'UploadThing',
      category: 'storage',
      rationale: 'Developer-friendly upload flows for React-based products.',
      envVars: ['UPLOADTHING_SECRET', 'UPLOADTHING_APP_ID'],
    },
  ],
  search: [
    {
      name: 'Algolia',
      category: 'search',
      rationale: 'Hosted search optimized for speed, ranking, and relevance tuning.',
      envVars: ['ALGOLIA_APP_ID', 'ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_ADMIN_API_KEY'],
    },
    {
      name: 'Meilisearch',
      category: 'search',
      rationale: 'Open and self-hostable search engine for internal or public discovery.',
      envVars: ['MEILISEARCH_HOST', 'MEILISEARCH_API_KEY'],
    },
  ],
  realtime: [
    {
      name: 'Ably',
      category: 'realtime',
      rationale: 'Managed pub/sub and realtime coordination across distributed clients.',
      envVars: ['ABLY_API_KEY'],
    },
    {
      name: 'Pusher',
      category: 'realtime',
      rationale: 'Mature hosted realtime service for events and sockets.',
      envVars: ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET', 'PUSHER_CLUSTER'],
    },
    {
      name: 'Supabase Realtime',
      category: 'realtime',
      rationale: 'Integrated realtime updates when the project already uses Supabase.',
      envVars: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    },
  ],
  analytics: [
    {
      name: 'PostHog',
      category: 'analytics',
      rationale: 'Product analytics with event capture and feature flag support.',
      envVars: ['POSTHOG_KEY', 'POSTHOG_HOST'],
    },
    {
      name: 'Plausible',
      category: 'analytics',
      rationale: 'Lightweight privacy-conscious product analytics.',
      envVars: ['PLAUSIBLE_DOMAIN', 'PLAUSIBLE_API_KEY'],
    },
  ],
});

const FEATURE_TO_CAPABILITIES = Object.freeze({
  auth: ['auth'],
  payments: ['payments'],
  notifications: ['notifications'],
  dashboard: ['analytics'],
  database: ['database'],
  file_uploads: ['storage'],
  search: ['search'],
  realtime: ['realtime'],
  api_integration: ['auth', 'payments', 'database'],
  todo_management: ['database'],
});

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function inferCapabilities(intent) {
  const featureCapabilities = (intent.features ?? [])
    .flatMap((feature) => FEATURE_TO_CAPABILITIES[feature] ?? []);
  const capabilities = [...featureCapabilities];

  if (intent.goal === 'create_api') {
    capabilities.push('auth', 'database');
  }

  return dedupe(capabilities);
}

function createCredentialSchema(suggestedProviders) {
  const entries = [];

  for (const providerGroup of suggestedProviders) {
    for (const provider of providerGroup.providers) {
      for (const envVar of provider.envVars) {
        entries.push({
          provider: provider.name,
          capability: providerGroup.capability,
          envVar,
          required: true,
        });
      }
    }
  }

  const seen = new Set();

  return entries.filter((entry) => {
    if (seen.has(entry.envVar)) {
      return false;
    }

    seen.add(entry.envVar);
    return true;
  });
}

function buildEndpointContracts(intent) {
  const contracts = [
    {
      path: '/api/health',
      method: 'GET',
      purpose: 'Expose a deployment-compatible health probe.',
    },
  ];

  const featureSet = new Set(intent.features ?? []);

  if (featureSet.has('auth')) {
    contracts.push({
      path: '/api/auth/session',
      method: 'GET',
      purpose: 'Resolve the current authenticated session and access scope.',
    });
  }

  if (featureSet.has('payments')) {
    contracts.push({
      path: '/api/billing/checkout',
      method: 'POST',
      purpose: 'Create a checkout or subscription session.',
    });
    contracts.push({
      path: '/api/billing/webhook',
      method: 'POST',
      purpose: 'Accept provider webhook notifications for billing events.',
    });
  }

  if (featureSet.has('dashboard')) {
    contracts.push({
      path: '/api/dashboard/summary',
      method: 'GET',
      purpose: 'Return summary data needed by the dashboard interface.',
    });
  }

  return contracts;
}

function buildCredentialTemplate(apiConfig) {
  const lines = [
    '# OmniForge generated credential template',
    '# Fill values locally and keep secrets out of source control.',
    '',
  ];

  for (const entry of apiConfig.credentialSchema) {
    lines.push(`# ${entry.provider} (${entry.capability})`);
    lines.push(`${entry.envVar}=`);
  }

  return `${lines.join('\n')}\n`;
}

function buildReadme(intent, apiConfig) {
  const providerLines = apiConfig.suggestedProviders
    .map((providerGroup) => {
      const providerNames = providerGroup.providers.map((provider) => provider.name).join(', ');
      return `- ${providerGroup.capability}: ${providerNames}`;
    })
    .join('\n');

  const endpointLines = apiConfig.endpointContracts
    .map((contract) => `- ${contract.method} ${contract.path}: ${contract.purpose}`)
    .join('\n');

  return `# Integration Plan

## Goal

${intent.goal}

## External APIs Required

${apiConfig.externalApisRequired ? 'Yes' : 'No'}

## Suggested Providers

${providerLines || '- No external providers are required for the current scope.'}

## Credentials

Populate \`integrations/credentials.template.env\` with local values only. Do not hardcode secrets in source files.

## Suggested Endpoint Contracts

${endpointLines}
`;
}

export class ApiManager {
  suggestApis(intent) {
    const capabilities = inferCapabilities(intent);
    const suggestedProviders = capabilities.map((capability) => ({
      capability,
      providers: PROVIDER_CATALOG[capability] ?? [],
    }));

    return {
      externalApisRequired: suggestedProviders.length > 0,
      capabilities,
      suggestedProviders,
    };
  }

  buildApiConfig(intent) {
    const { externalApisRequired, capabilities, suggestedProviders } = this.suggestApis(intent);
    const credentialSchema = createCredentialSchema(suggestedProviders);

    return {
      generatedAt: new Date().toISOString(),
      projectName: intent.projectName,
      goal: intent.goal,
      projectType: intent.projectType,
      externalApisRequired,
      capabilities,
      suggestedProviders,
      credentialSchema,
      endpointContracts: buildEndpointContracts(intent),
      notes: [
        'Credentials are structured as environment variables only.',
        'Provider selection can be overridden later without changing the execution model.',
      ],
    };
  }

  async storeApiConfig(projectRoot, apiConfig) {
    const targetPath = path.join(projectRoot, 'integrations', 'api-config.json');
    await writeJsonSafe(targetPath, apiConfig);

    return {
      path: 'integrations/api-config.json',
      absolutePath: targetPath,
    };
  }

  buildIntegrationFiles(intent, apiConfig) {
    return [
      {
        path: 'integrations/credentials.template.env',
        content: buildCredentialTemplate(apiConfig),
      },
      {
        path: 'integrations/README.md',
        content: buildReadme(intent, apiConfig),
      },
      {
        path: 'api/provider-map.json',
        content: JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            providers: apiConfig.suggestedProviders,
            endpointContracts: apiConfig.endpointContracts,
          },
          null,
          2,
        ),
      },
    ];
  }
}

const apiManager = new ApiManager();

export default apiManager;
