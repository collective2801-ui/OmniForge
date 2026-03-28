import path from 'node:path';
import logger from '../engine/logger.js';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import { generateDNSConfig } from './dnsManager.js';
import {
  checkAvailability as checkGoDaddyAvailability,
  isGoDaddyConfigured,
} from './providers/godaddyProvider.js';
import {
  checkAvailability as checkNamecheapAvailability,
  isNamecheapConfigured,
} from './providers/namecheapProvider.js';

const DOMAIN_VARIATIONS = Object.freeze([
  {
    template: '{base}.com',
    score: 100,
    reason: 'Primary commercial domain.',
  },
  {
    template: '{base}.app',
    score: 96,
    reason: 'Modern app-specific TLD.',
  },
  {
    template: '{base}.io',
    score: 92,
    reason: 'Strong fit for SaaS and software products.',
  },
  {
    template: 'get{base}.com',
    score: 87,
    reason: 'Useful when the exact .com is unavailable.',
  },
  {
    template: 'use{base}.com',
    score: 84,
    reason: 'Product-led fallback with a strong call to action.',
  },
]);

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

function assertProjectName(projectName) {
  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    throw new TypeError('Project name is required for domain automation.');
  }
}

function slugifyProjectName(projectName) {
  return String(projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'omniforge';
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

function createAvailabilityProviderOrder() {
  const liveProviders = PROVIDERS.filter((provider) => provider.isConfigured());

  if (liveProviders.length > 0) {
    return liveProviders;
  }

  return [PROVIDERS[0]];
}

export function generateDomainSuggestions(projectName) {
  assertProjectName(projectName);

  const base = slugifyProjectName(projectName);

  return DOMAIN_VARIATIONS.map((variation, index) => ({
    domain: variation.template.replace('{base}', base),
    rank: index + 1,
    score: variation.score,
    reason: variation.reason,
  }));
}

async function resolveAvailability(domain) {
  const providerOrder = createAvailabilityProviderOrder();
  const errors = [];

  for (const provider of providerOrder) {
    try {
      const availability = await provider.checkAvailability(domain, {
        allowSimulationFallback: providerOrder.length === 1 && !provider.isConfigured(),
      });

      return {
        ...availability,
        purchaseUrl: provider.buildPurchaseUrl(domain),
      };
    } catch (error) {
      errors.push({
        provider: provider.name,
        message: error?.message ?? 'Unknown availability error.',
      });
    }
  }

  const fallback = await checkNamecheapAvailability(domain, {
    allowSimulationFallback: true,
  });

  return {
    ...fallback,
    source: 'fallback-simulated',
    note:
      errors.length > 0
        ? `Live availability providers failed. ${errors.map((entry) => `${entry.provider}: ${entry.message}`).join(' ')}`
        : fallback.note,
    purchaseUrl: PROVIDERS[0].buildPurchaseUrl(domain),
  };
}

async function rankSuggestions(suggestions) {
  const rankedResults = [];

  for (const suggestion of suggestions) {
    const availability = await resolveAvailability(suggestion.domain);
    rankedResults.push({
      ...suggestion,
      ...availability,
    });
  }

  return rankedResults;
}

function selectBestDomain(rankedSuggestions) {
  const availableSuggestion = rankedSuggestions.find((suggestion) => suggestion.available);
  return availableSuggestion ?? rankedSuggestions[0] ?? null;
}

function buildPurchaseWorkflow(selectedDomain) {
  const providerName = selectedDomain?.provider ?? 'namecheap';
  const provider = PROVIDERS.find((entry) => entry.name === providerName) ?? PROVIDERS[0];

  return {
    status: selectedDomain?.available ? 'ready_to_purchase' : 'manual_review',
    provider: provider.name,
    domain: selectedDomain?.domain ?? null,
    checkoutUrl: selectedDomain?.purchaseUrl ?? provider.buildPurchaseUrl(selectedDomain?.domain ?? ''),
    steps: selectedDomain?.available
      ? [
          `Purchase ${selectedDomain.domain} with ${provider.name}.`,
          'Add the generated DNS records at the registrar.',
          'Wait for DNS propagation before final SSL validation.',
        ]
      : [
          'Review alternate available suggestions.',
          'Choose a registrar and purchase the selected domain manually.',
          'Apply the generated DNS records after checkout.',
        ],
  };
}

function buildAttachmentPlan(selectedDomain, dnsConfig) {
  return {
    status: 'ready',
    domain: selectedDomain.domain,
    deploymentUrl: dnsConfig.deploymentUrl,
    provider: dnsConfig.provider,
    targetHost: dnsConfig.targetHost,
    steps: [
      `Create the DNS records for ${selectedDomain.domain}.`,
      `Bind ${selectedDomain.domain} to ${dnsConfig.targetHost} in the ${dnsConfig.provider} deployment provider.`,
      'Verify SSL once DNS propagation is complete.',
    ],
  };
}

async function writeDomainArtifacts(projectPath, domainFlow) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const domainDirectory = path.join(projectPath, 'domain');
  await ensureDirectory(domainDirectory);

  const artifacts = [
    {
      path: 'domain/domain-automation.json',
      content: JSON.stringify(
        {
          generatedAt: domainFlow.generatedAt,
          projectName: domainFlow.projectName,
          status: domainFlow.status,
          domain: domainFlow.domain,
          selectedProvider: domainFlow.selectedProvider,
          purchaseWorkflow: domainFlow.purchaseWorkflow,
          attachment: domainFlow.attachment,
          suggestions: domainFlow.suggestions,
        },
        null,
        2,
      ),
    },
    {
      path: 'domain/dns-config.json',
      content: JSON.stringify(domainFlow.dns, null, 2),
    },
    {
      path: 'domain/README.md',
      content: `# Domain Automation

## Selected Domain

${domainFlow.domain}

## Status

${domainFlow.status}

## Purchase Provider

${domainFlow.purchaseWorkflow.provider}

## DNS Target

${domainFlow.dns.targetHost}

## Next Steps

${domainFlow.attachment.steps.map((step) => `- ${step}`).join('\n')}
`,
    },
  ];

  const writtenFiles = [];

  for (const artifact of artifacts) {
    const absolutePath = path.join(projectPath, artifact.path);

    if (artifact.path.endsWith('.json')) {
      await writeJsonSafe(absolutePath, JSON.parse(artifact.content));
    } else {
      await writeFileSafe(absolutePath, artifact.content);
    }

    writtenFiles.push({
      path: artifact.path,
      absolutePath,
    });
  }

  return writtenFiles;
}

export class DomainService {
  async handleDomainFlow(projectName, options = {}) {
    assertProjectName(projectName);

    const normalizedProjectName = projectName.trim();
    const deploymentUrl =
      typeof options.deploymentUrl === 'string' && options.deploymentUrl.trim().length > 0
        ? options.deploymentUrl.trim()
        : options.deployment?.url ?? '';

    try {
      await logger.info('Domain automation started.', {
        projectName: normalizedProjectName,
        deploymentUrl: deploymentUrl || null,
      });
      await emitProgress(options.onProgress, 'domain_started', {
        projectName: normalizedProjectName,
        deploymentUrl: deploymentUrl || null,
      });

      const suggestions = generateDomainSuggestions(normalizedProjectName);
      await emitProgress(options.onProgress, 'domain_suggestions_generated', {
        projectName: normalizedProjectName,
        suggestions,
      });

      const rankedSuggestions = await rankSuggestions(suggestions);
      const selectedDomain = selectBestDomain(rankedSuggestions);

      if (!selectedDomain) {
        throw new Error('No domain suggestions could be generated.');
      }

      await emitProgress(options.onProgress, 'domain_checked', {
        selectedDomain: selectedDomain.domain,
        selectedProvider: selectedDomain.provider,
        suggestions: rankedSuggestions,
      });

      const dns = generateDNSConfig(selectedDomain.domain, deploymentUrl);
      const purchaseWorkflow = buildPurchaseWorkflow(selectedDomain);
      const attachment = buildAttachmentPlan(selectedDomain, dns);
      const domainFlow = {
        generatedAt: new Date().toISOString(),
        status: 'ready',
        projectName: normalizedProjectName,
        domain: selectedDomain.domain,
        selectedProvider: selectedDomain.provider,
        suggestions: rankedSuggestions,
        purchaseWorkflow,
        dns,
        attachment,
      };
      const files = await writeDomainArtifacts(options.projectPath, domainFlow);
      const result = {
        ...domainFlow,
        files,
      };

      await logger.info('Domain automation completed.', {
        projectName: normalizedProjectName,
        domain: result.domain,
        provider: result.selectedProvider,
      });
      await emitProgress(options.onProgress, 'domain_ready', result);

      return result;
    } catch (error) {
      const failure = {
        generatedAt: new Date().toISOString(),
        status: 'failed',
        projectName: normalizedProjectName,
        domain: null,
        dns: null,
        suggestions: [],
        error: error?.message ?? 'Unexpected domain automation failure.',
      };

      await logger.error('Domain automation failed.', {
        projectName: normalizedProjectName,
        error: failure.error,
      });
      await emitProgress(options.onProgress, 'domain_failed', failure);

      return failure;
    }
  }
}

const domainService = new DomainService();

export async function handleDomainFlow(projectName, options = {}) {
  return domainService.handleDomainFlow(projectName, options);
}

export default domainService;
