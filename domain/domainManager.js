import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import {
  checkAvailability as checkGoDaddyAvailability,
  isGoDaddyConfigured,
} from './providers/godaddyProvider.js';
import {
  checkAvailability as checkNamecheapAvailability,
  isNamecheapConfigured,
} from './providers/namecheapProvider.js';

const PROVIDERS = Object.freeze([
  {
    name: 'namecheap',
    isConfigured: isNamecheapConfigured,
    checkAvailability: checkNamecheapAvailability,
    buildPurchaseUrl(domain) {
      return `https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}`;
    },
  },
  {
    name: 'godaddy',
    isConfigured: isGoDaddyConfigured,
    checkAvailability: checkGoDaddyAvailability,
    buildPurchaseUrl(domain) {
      return `https://www.godaddy.com/domainsearch/find?checkAvail=1&domainToCheck=${encodeURIComponent(domain)}`;
    },
  },
]);

function normalizeLabel(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function generateDomain(name) {
  return `${normalizeLabel(name || 'omniforge-app')}.ai`;
}

function assertDomainName(domainName) {
  if (typeof domainName !== 'string' || domainName.trim().length === 0) {
    throw new TypeError('Domain name is required.');
  }

  const normalizedDomain = domainName.trim().toLowerCase();

  if (!/^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/i.test(normalizedDomain)) {
    throw new TypeError('Domain name must be a valid fully qualified domain.');
  }

  return normalizedDomain;
}

function getDnsTarget(deploymentTarget) {
  if (deploymentTarget === 'railway') {
    return {
      rootValue: process.env.RAILWAY_APEX_IP?.trim() || '104.196.72.0',
      cnameValue: 'proxy.rlwy.net',
      verificationPrefix: 'railway',
    };
  }

  return {
    rootValue: process.env.VERCEL_APEX_IP?.trim() || '76.76.21.21',
    cnameValue: 'cname.vercel-dns.com',
    verificationPrefix: 'vercel',
  };
}

function getSimulationScore(domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const hash = createHash('sha256').update(`domain-manager:${normalizedDomain}`).digest('hex');
  const score = Number.parseInt(hash.slice(0, 8), 16) % 100;

  return score;
}

function createSimulatedAvailability(domainName) {
  const normalizedDomain = assertDomainName(domainName);
  const score = getSimulationScore(normalizedDomain);

  return {
    domain: normalizedDomain,
    domainName: normalizedDomain,
    available: score >= 42,
    confidence: Number((0.55 + score / 200).toFixed(2)),
    checkedAt: new Date().toISOString(),
    source: 'mock-registry',
    note: 'Availability is simulated for planning purposes only.',
  };
}

function buildProviderOrder(preferredProvider = '') {
  const normalizedPreferredProvider =
    typeof preferredProvider === 'string' ? preferredProvider.trim().toLowerCase() : '';
  const liveProviders = PROVIDERS.filter((provider) => provider.isConfigured());
  const baseProviders = liveProviders.length > 0 ? liveProviders : [PROVIDERS[0]];

  return baseProviders.sort((left, right) => {
    if (left.name === normalizedPreferredProvider) {
      return -1;
    }

    if (right.name === normalizedPreferredProvider) {
      return 1;
    }

    return 0;
  });
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

async function writeDomainArtifacts(projectPath, result) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const domainDirectory = path.join(projectPath, 'domain');
  await ensureDirectory(domainDirectory);

  const availabilityPath = path.join(domainDirectory, 'availability-check.json');
  const workflowPath = path.join(domainDirectory, 'purchase-workflow.json');
  const readmePath = path.join(domainDirectory, 'REAL_DOMAIN_AUTOMATION.md');

  await writeJsonSafe(availabilityPath, {
    generatedAt: result.generatedAt,
    domain: result.domain,
    provider: result.provider,
    available: result.available,
    purchaseUrl: result.purchaseUrl,
    source: result.source,
    confidence: result.confidence,
    checkedAt: result.checkedAt,
    note: result.note,
  });
  await writeJsonSafe(workflowPath, result.purchaseWorkflow);
  await writeFileSafe(
    readmePath,
    `# Real Domain Automation

## Domain

${result.domain}

## Availability

${result.available ? 'Available' : 'Unavailable'}

## Provider

${result.provider}

## Purchase URL

${result.purchaseUrl}

## Next Steps

${result.purchaseWorkflow.steps.map((step) => `- ${step}`).join('\n')}
`,
  );

  return [
    {
      path: 'domain/availability-check.json',
      absolutePath: availabilityPath,
    },
    {
      path: 'domain/purchase-workflow.json',
      absolutePath: workflowPath,
    },
    {
      path: 'domain/REAL_DOMAIN_AUTOMATION.md',
      absolutePath: readmePath,
    },
  ];
}

function buildPurchaseWorkflow(provider, availability) {
  return {
    status: availability.available ? 'ready_to_purchase' : 'manual_review',
    provider: provider.name,
    domain: availability.domain,
    checkoutUrl: provider.buildPurchaseUrl(availability.domain),
    steps: availability.available
      ? [
          `Purchase ${availability.domain} with ${provider.name}.`,
          'Complete registrar checkout and verify ownership controls.',
          'Apply the generated DNS records and confirm provider-level domain linking.',
        ]
      : [
          `Review registrar suggestions for ${availability.domain}.`,
          'Select an alternate domain or variation if the exact name is unavailable.',
          'Complete the registrar purchase before attaching DNS to the deployment target.',
        ],
  };
}

async function resolveProviderAvailability(domainName, options = {}) {
  const normalizedDomain = assertDomainName(domainName);
  const providerOrder = buildProviderOrder(options.preferredProvider);
  const errors = [];

  for (const provider of providerOrder) {
    try {
      const availability = await provider.checkAvailability(normalizedDomain, {
        allowSimulationFallback:
          options.allowSimulationFallback !== false &&
          (!provider.isConfigured() || providerOrder.length === 1),
      });

      return {
        provider,
        availability,
      };
    } catch (error) {
      errors.push({
        provider: provider.name,
        message: error?.message ?? 'Unknown domain provider error.',
      });
    }
  }

  const fallbackProvider = PROVIDERS[0];
  const availability = await fallbackProvider.checkAvailability(normalizedDomain, {
    allowSimulationFallback: true,
  });

  return {
    provider: fallbackProvider,
    availability: {
      ...availability,
      source: 'fallback-simulated',
      note:
        errors.length > 0
          ? `Live availability providers failed. ${errors.map((entry) => `${entry.provider}: ${entry.message}`).join(' ')}`
          : availability.note,
    },
  };
}

export class DomainManager {
  checkDomainAvailability(domainName) {
    return createSimulatedAvailability(domainName);
  }

  generateDomainSuggestions(projectName, { limit = 5 } = {}) {
    const baseLabel = normalizeLabel(projectName || 'omniforge-app');
    const candidates = unique([
      generateDomain(baseLabel),
      `${baseLabel}.com`,
      `${baseLabel}.app`,
      `${baseLabel}.io`,
      `${baseLabel}.dev`,
      `get${baseLabel}.com`,
      `${baseLabel}hq.com`,
    ]);

    return candidates.slice(0, limit);
  }

  buildDnsConfig(domainName, { deploymentTarget = 'vercel' } = {}) {
    const normalizedDomain = assertDomainName(domainName);
    const { rootValue, cnameValue, verificationPrefix } = getDnsTarget(deploymentTarget);
    const verificationToken = createHash('sha256')
      .update(`${normalizedDomain}:${deploymentTarget}`)
      .digest('hex')
      .slice(0, 20);

    return {
      generatedAt: new Date().toISOString(),
      domainName: normalizedDomain,
      deploymentTarget,
      records: [
        {
          type: 'A',
          host: '@',
          value: rootValue,
          ttl: 300,
        },
        {
          type: 'CNAME',
          host: 'www',
          value: cnameValue,
          ttl: 300,
        },
        {
          type: 'TXT',
          host: `_verify.${normalizedDomain}`,
          value: `${verificationPrefix}-omniforge=${verificationToken}`,
          ttl: 300,
        },
        {
          type: 'CAA',
          host: '@',
          value: '0 issue "letsencrypt.org"',
          ttl: 3600,
        },
      ],
      notes: [
        'DNS values are generated for structure and planning only.',
        'No registrar or domain purchase workflow is executed by OmniForge in this step.',
      ],
    };
  }

  prepareDomainPackage(intent, { deploymentTarget = 'vercel' } = {}) {
    const suggestions = this.generateDomainSuggestions(intent.projectName);
    const primaryDomain = suggestions[0];
    const availability = this.checkDomainAvailability(primaryDomain);
    const dnsConfig = this.buildDnsConfig(primaryDomain, { deploymentTarget });

    return {
      primaryDomain,
      suggestions,
      availability,
      dnsConfig,
      files: [
        {
          path: 'domain/domain-plan.json',
          content: JSON.stringify(
            {
              generatedAt: new Date().toISOString(),
              projectName: intent.projectName,
              goal: intent.goal,
              deploymentTarget,
              primaryDomain,
              availability,
              suggestions,
            },
            null,
            2,
          ),
        },
        {
          path: 'domain/dns-records.json',
          content: JSON.stringify(dnsConfig, null, 2),
        },
        {
          path: 'domain/README.md',
          content: `# Domain Workflow

## Primary Domain

${primaryDomain}

## Availability

${availability.available ? 'Available (mock)' : 'Unavailable (mock)'}

## Suggestions

${suggestions.map((domain) => `- ${domain}`).join('\n')}

## Notes

- This workflow is simulated and does not purchase or reserve any domain.
- DNS records are structured for planning and operator review only.
`,
        },
      ],
    };
  }

  async handleDomain(domainName, options = {}) {
    const normalizedDomain = assertDomainName(domainName);
    await emitProgress(options.onProgress, 'domain_manager_started', {
      domain: normalizedDomain,
      preferredProvider: options.preferredProvider ?? null,
    });

    const { provider, availability } = await resolveProviderAvailability(
      normalizedDomain,
      options,
    );
    const purchaseWorkflow = buildPurchaseWorkflow(provider, availability);
    const result = {
      generatedAt: new Date().toISOString(),
      status: 'ready',
      domain: availability.domain,
      available: availability.available,
      provider: availability.provider ?? provider.name,
      purchaseUrl: provider.buildPurchaseUrl(availability.domain),
      purchaseWorkflow,
      source: availability.source,
      checkedAt: availability.checkedAt,
      confidence: availability.confidence ?? null,
      note: availability.note ?? null,
    };
    const files = await writeDomainArtifacts(options.projectPath, result);

    await emitProgress(options.onProgress, 'domain_manager_completed', {
      ...result,
      files,
    });

    return {
      ...result,
      files,
    };
  }
}

const domainManager = new DomainManager();

export async function handleDomain(domainName, options = {}) {
  return domainManager.handleDomain(domainName, options);
}

domainManager.generateDomain = generateDomain;

export default domainManager;
