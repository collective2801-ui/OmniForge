import path from 'node:path';
import apiManager from '../api/apiManager.js';
import logger from '../engine/logger.js';
import {
  ensureDirectory,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const SUPPORTED_SERVICES = Object.freeze(['payments', 'auth', 'storage']);
const SERVICE_CATALOG = Object.freeze({
  payments: [
    {
      id: 'stripe',
      api: 'stripe',
      label: 'Stripe',
      envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLIC_KEY'],
      rationale: 'Best fit for subscriptions, checkout flows, and webhook-driven SaaS billing.',
    },
  ],
  auth: [
    {
      id: 'supabase',
      api: 'supabase',
      label: 'Supabase Auth',
      envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
      rationale: 'Integrated auth with low operational overhead and strong compatibility with the existing OmniForge stack.',
    },
  ],
  storage: [
    {
      id: 'supabase-storage',
      api: 'supabase',
      label: 'Supabase Storage',
      envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
      rationale: 'Default low-cost object storage path when the project already benefits from Supabase services.',
    },
    {
      id: 's3-ready',
      api: 'storage',
      label: 'S3-Compatible Storage',
      envKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET', 'AWS_REGION'],
      rationale: 'Suitable when portability, large-scale asset storage, or provider independence is required.',
    },
  ],
});

const PROVIDER_ALIASES = Object.freeze({
  stripe: 'stripe',
  supabase: 'supabase',
  'supabase-auth': 'supabase',
  'supabase-storage': 'supabase-storage',
  storage: 'supabase-storage',
  s3: 's3-ready',
  'amazon-s3': 's3-ready',
  's3-ready': 's3-ready',
  uploadthing: 's3-ready',
  cloudinary: 's3-ready',
});

function assertIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new TypeError('Intent is required for unified API planning.');
  }
}

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
}

function normalizeProviderId(value) {
  const normalizedValue = String(value || '').trim().toLowerCase();
  return PROVIDER_ALIASES[normalizedValue] ?? normalizedValue;
}

function serviceSupportsProvider(service, providerId) {
  return (SERVICE_CATALOG[service] ?? []).some((provider) => provider.id === providerId);
}

function isProviderReady(provider) {
  return provider.envKeys.every((key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function inferServices(intent, context = {}) {
  const featureSet = new Set(intent.features ?? []);
  const detectedServices = [];
  const apiConfig = apiManager.buildApiConfig(intent);

  for (const capability of apiConfig.capabilities ?? []) {
    if (SUPPORTED_SERVICES.includes(capability)) {
      detectedServices.push(capability);
    }
  }

  if (featureSet.has('payments')) {
    detectedServices.push('payments');
  }

  if (featureSet.has('auth') || intent.goal === 'create_api') {
    detectedServices.push('auth');
  }

  if (featureSet.has('file_uploads')) {
    detectedServices.push('storage');
  }

  if (context.integrations?.selectedServices) {
    detectedServices.push(...context.integrations.selectedServices);
  }

  return dedupeStrings(detectedServices).filter((service) => SUPPORTED_SERVICES.includes(service));
}

function buildProviderOrder(service, context = {}) {
  const candidates = SERVICE_CATALOG[service] ?? [];
  const override = normalizeProviderId(context.providerOverrides?.[service]);
  const existing = normalizeProviderId(context.integrations?.providers?.[service]);
  const preferScalableStorage =
    service === 'storage' &&
    (context.decisions?.scalability === 'high' || context.decisions?.costProfile === 'balanced');
  const preferredStorage = preferScalableStorage ? 's3-ready' : 'supabase-storage';
  const preferred = service === 'storage' ? preferredStorage : candidates[0]?.id;
  const orderedIds = dedupeStrings([override, existing, preferred, ...candidates.map((provider) => provider.id)]);

  return orderedIds
    .filter((providerId) => serviceSupportsProvider(service, providerId))
    .map((providerId) => candidates.find((provider) => provider.id === providerId))
    .filter(Boolean);
}

function selectProvider(service, context = {}) {
  const orderedProviders = buildProviderOrder(service, context);

  if (orderedProviders.length === 0) {
    return null;
  }

  const override = normalizeProviderId(context.providerOverrides?.[service]);
  const existing = normalizeProviderId(context.integrations?.providers?.[service]);
  const firstReadyProvider = orderedProviders.find((provider) => isProviderReady(provider));
  const selectedProvider = firstReadyProvider ?? orderedProviders[0];
  const source =
    override && selectedProvider.id === override
      ? 'manual-override'
      : existing && selectedProvider.id === existing
        ? 'existing-integration'
        : firstReadyProvider
          ? 'environment-ready'
          : 'default';

  return {
    ...selectedProvider,
    liveReady: isProviderReady(selectedProvider),
    fallbackProviders: orderedProviders
      .filter((provider) => provider.id !== selectedProvider.id)
      .map((provider) => provider.id),
    switched:
      Boolean(override) &&
      override !== selectedProvider.id,
    source,
  };
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

async function writePlanArtifact(projectPath, plan) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const integrationsDirectory = path.join(path.resolve(projectPath.trim()), 'integrations');
  const targetPath = path.join(integrationsDirectory, 'unified-api-plan.json');

  await ensureDirectory(integrationsDirectory);
  await writeJsonSafe(targetPath, plan);

  return [
    {
      path: 'integrations/unified-api-plan.json',
      absolutePath: targetPath,
    },
  ];
}

export async function handleAPI(intent, context = {}) {
  assertIntent(intent);

  try {
    const apiConfig = apiManager.buildApiConfig(intent);
    const services = inferServices(intent, context);
    const capabilityPlan = services
      .map((service) => {
        const provider = selectProvider(service, context);

        if (!provider) {
          return null;
        }

        return {
          service,
          provider: provider.id,
          api: provider.api,
          label: provider.label,
          liveReady: provider.liveReady,
          fallbackProviders: provider.fallbackProviders,
          switched: provider.switched,
          source: provider.source,
          rationale: provider.rationale,
        };
      })
      .filter(Boolean);
    const providers = Object.fromEntries(
      capabilityPlan.map((entry) => [entry.service, entry.provider]),
    );
    const fallbacks = Object.fromEntries(
      capabilityPlan.map((entry) => [entry.service, entry.fallbackProviders]),
    );
    const result = {
      generatedAt: new Date().toISOString(),
      status: 'configured',
      apis: dedupeStrings(capabilityPlan.map((entry) => entry.api)),
      services,
      providers,
      fallbacks,
      switchable: true,
      liveReady: capabilityPlan.every((entry) => entry.liveReady),
      capabilityPlan,
      endpointContracts: apiConfig.endpointContracts.filter((contract) => {
        if (/billing/i.test(contract.path)) {
          return services.includes('payments');
        }

        if (/auth/i.test(contract.path)) {
          return services.includes('auth');
        }

        return true;
      }),
      notes: dedupeStrings([
        services.length === 0
          ? 'No external auth, billing, or storage APIs were required for the resolved intent.'
          : 'Unified API routing can switch providers by service without rewriting the application contract layer.',
        'Environment readiness is evaluated dynamically from configured credentials.',
        context.integrations?.status === 'configured'
          ? 'Existing generated integrations were used as the primary provider hints.'
          : '',
      ]),
      files: [],
    };

    result.files = await writePlanArtifact(context.projectPath, {
      ...result,
      projectName: intent.projectName ?? null,
      routeCategory: intent.routeCategory ?? null,
    });

    await logger.info('Unified API plan prepared.', {
      projectName: intent.projectName ?? null,
      services,
      providers,
      liveReady: result.liveReady,
    });
    await emitProgress(context.onProgress, 'unified_api_ready', result);

    return result;
  } catch (error) {
    const failure = {
      generatedAt: new Date().toISOString(),
      status: 'failed',
      apis: [],
      services: [],
      providers: {},
      fallbacks: {},
      switchable: true,
      liveReady: false,
      capabilityPlan: [],
      endpointContracts: [],
      notes: [],
      files: [],
      error: error?.message ?? 'Unexpected unified API planning failure.',
    };

    await logger.error('Unified API planning failed.', {
      projectName: intent.projectName ?? null,
      error: failure.error,
    });
    await emitProgress(context.onProgress, 'unified_api_failed', failure);

    return failure;
  }
}

export default {
  handleAPI,
};
