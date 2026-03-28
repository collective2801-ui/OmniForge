import path from 'node:path';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import { generateDNSConfig } from './dnsManager.js';

const DEFAULT_APEX_IPS = Object.freeze({
  vercel: process.env.VERCEL_APEX_IP?.trim() || '76.76.21.21',
  railway: process.env.RAILWAY_APEX_IP?.trim() || '104.196.72.0',
  generic:
    process.env.DEFAULT_CUSTOM_DOMAIN_APEX_IP?.trim() ||
    process.env.VERCEL_APEX_IP?.trim() ||
    '76.76.21.21',
});

function assertDomain(domain) {
  if (typeof domain !== 'string' || domain.trim().length === 0) {
    throw new TypeError('Domain is required for DNS configuration.');
  }
}

function assertDeploymentUrl(deploymentUrl) {
  if (typeof deploymentUrl !== 'string' || deploymentUrl.trim().length === 0) {
    throw new TypeError('Deployment URL is required for DNS configuration.');
  }
}

function normalizeUrl(url) {
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
}

function detectProvider(targetHost, preferredProvider = '') {
  const normalizedTargetHost = targetHost.toLowerCase();
  const normalizedPreferredProvider =
    typeof preferredProvider === 'string' ? preferredProvider.trim().toLowerCase() : '';

  if (normalizedPreferredProvider) {
    return normalizedPreferredProvider;
  }

  if (normalizedTargetHost.endsWith('.vercel.app')) {
    return 'vercel';
  }

  if (
    normalizedTargetHost.endsWith('.railway.app') ||
    normalizedTargetHost.endsWith('.up.railway.app')
  ) {
    return 'railway';
  }

  return 'generic';
}

function createARecord(provider, targetHost) {
  const fallbackIp = DEFAULT_APEX_IPS[provider] ?? DEFAULT_APEX_IPS.generic;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(targetHost)) {
    return {
      type: 'A',
      host: '@',
      value: targetHost,
      ttl: 300,
    };
  }

  return {
    type: 'A',
    host: '@',
    value: fallbackIp,
    ttl: 300,
  };
}

function createCnameRecord(targetHost) {
  return {
    type: 'CNAME',
    host: 'www',
    value: targetHost,
    ttl: 300,
  };
}

function mergeRecords(baseRecords, provider, targetHost) {
  const records = [];
  const seen = new Set();
  const requiredRecords = [
    createARecord(provider, targetHost),
    createCnameRecord(targetHost),
  ];

  for (const record of [...requiredRecords, ...(Array.isArray(baseRecords) ? baseRecords : [])]) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    const normalizedRecord = {
      type: String(record.type || '').toUpperCase(),
      host: typeof record.host === 'string' ? record.host : '@',
      value: typeof record.value === 'string' ? record.value : '',
      ttl: Number.isInteger(record.ttl) && record.ttl > 0 ? record.ttl : 300,
    };
    const key = `${normalizedRecord.type}:${normalizedRecord.host}:${normalizedRecord.value}`;

    if (!normalizedRecord.type || !normalizedRecord.value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    records.push(normalizedRecord);
  }

  return records;
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

async function writeDnsArtifacts(projectPath, dnsConfig) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const domainDirectory = path.join(projectPath, 'domain');
  await ensureDirectory(domainDirectory);

  const jsonPath = path.join(domainDirectory, 'dns-configurator.json');
  const readmePath = path.join(domainDirectory, 'DNS_AUTOMATION.md');

  await writeJsonSafe(jsonPath, dnsConfig);
  await writeFileSafe(
    readmePath,
    `# DNS Automation

## Domain

${dnsConfig.domain}

## Deployment Target

${dnsConfig.targetHost}

## Records

${dnsConfig.records.map((record) => `- ${record.type} ${record.host} -> ${record.value}`).join('\n')}

## Notes

${dnsConfig.notes.map((note) => `- ${note}`).join('\n')}
`,
  );

  return [
    {
      path: 'domain/dns-configurator.json',
      absolutePath: jsonPath,
    },
    {
      path: 'domain/DNS_AUTOMATION.md',
      absolutePath: readmePath,
    },
  ];
}

export async function configureDNS(domain, deploymentUrl, options = {}) {
  assertDomain(domain);
  assertDeploymentUrl(deploymentUrl);

  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedDeploymentUrl = normalizeUrl(deploymentUrl);
  const baseConfig = generateDNSConfig(normalizedDomain, normalizedDeploymentUrl);
  const targetHost = new URL(normalizedDeploymentUrl).hostname.toLowerCase();
  const provider = detectProvider(targetHost, options.provider);
  const records = mergeRecords(baseConfig.records, provider, targetHost);
  const result = {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    domain: normalizedDomain,
    deploymentUrl: normalizedDeploymentUrl,
    provider,
    targetHost,
    verificationToken: baseConfig.verificationToken,
    records,
    attachment: {
      status: 'ready',
      provider,
      domain: normalizedDomain,
      targetHost,
      deploymentUrl: normalizedDeploymentUrl,
    },
    notes: [
      `Root traffic is routed through the ${provider} apex record configuration.`,
      'Apply the A record to the apex domain and the CNAME record to the www host.',
      'Complete registrar-side DNS updates before enabling provider-level HTTPS enforcement.',
      ...(baseConfig.notes ?? []),
    ],
  };
  const files = await writeDnsArtifacts(options.projectPath, result);

  await emitProgress(options.onProgress, 'dns_configured', {
    ...result,
    files,
  });

  return {
    ...result,
    files,
  };
}

export default {
  configureDNS,
};
