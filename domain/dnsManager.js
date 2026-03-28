import { createHash } from 'node:crypto';

const VERCEL_APEX_IP = '76.76.21.21';

function assertDomain(domain) {
  if (typeof domain !== 'string' || domain.trim().length === 0) {
    throw new TypeError('Domain is required.');
  }
}

function assertDeploymentUrl(deploymentUrl) {
  if (typeof deploymentUrl !== 'string' || deploymentUrl.trim().length === 0) {
    throw new TypeError('Deployment URL is required to generate DNS configuration.');
  }
}

function normalizeUrl(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }

  return `https://${url}`;
}

function getDeploymentProvider(hostname) {
  const normalizedHostname = hostname.toLowerCase();

  if (normalizedHostname.endsWith('.vercel.app')) {
    return 'vercel';
  }

  if (
    normalizedHostname.endsWith('.railway.app') ||
    normalizedHostname.endsWith('.up.railway.app')
  ) {
    return 'railway';
  }

  return 'generic';
}

function createVerificationToken(domain, deploymentUrl) {
  return createHash('sha256')
    .update(`${domain}:${deploymentUrl}`)
    .digest('hex')
    .slice(0, 24);
}

function buildRecords(domain, targetHost, provider, verificationToken) {
  const baseRecords = [];

  if (provider === 'vercel') {
    baseRecords.push(
      {
        type: 'A',
        host: '@',
        value: VERCEL_APEX_IP,
        ttl: 300,
      },
      {
        type: 'CNAME',
        host: 'www',
        value: targetHost,
        ttl: 300,
      },
    );
  } else {
    baseRecords.push(
      {
        type: 'CNAME',
        host: '@',
        value: targetHost,
        ttl: 300,
      },
      {
        type: 'CNAME',
        host: 'www',
        value: targetHost,
        ttl: 300,
      },
    );
  }

  baseRecords.push({
    type: 'TXT',
    host: `_omniforge.${domain}`,
    value: `verification=${verificationToken}`,
    ttl: 300,
  });

  return baseRecords;
}

function buildNotes(provider, targetHost) {
  const notes = [
    `Point the custom domain to ${targetHost} and wait for DNS propagation before enabling SSL.`,
  ];

  if (provider === 'vercel') {
    notes.push('Use the Vercel apex A record for the root domain and the deployment hostname for www.');
  } else {
    notes.push('Some registrars do not allow apex CNAME records; use ALIAS or ANAME flattening if required.');
  }

  notes.push('After DNS propagates, bind the domain inside the deployment provider and verify HTTPS issuance.');

  return notes;
}

export function generateDNSConfig(domain, deploymentUrl) {
  assertDomain(domain);
  assertDeploymentUrl(deploymentUrl);

  const normalizedDomain = domain.trim().toLowerCase();
  const normalizedDeploymentUrl = normalizeUrl(deploymentUrl.trim());
  const parsedUrl = new URL(normalizedDeploymentUrl);
  const targetHost = parsedUrl.hostname.toLowerCase();
  const provider = getDeploymentProvider(targetHost);
  const verificationToken = createVerificationToken(normalizedDomain, normalizedDeploymentUrl);
  const records = buildRecords(normalizedDomain, targetHost, provider, verificationToken);

  return {
    generatedAt: new Date().toISOString(),
    domain: normalizedDomain,
    deploymentUrl: normalizedDeploymentUrl,
    provider,
    targetHost,
    verificationToken,
    records,
    attachment: {
      status: 'ready',
      provider,
      domain: normalizedDomain,
      targetHost,
      deploymentUrl: normalizedDeploymentUrl,
    },
    notes: buildNotes(provider, targetHost),
  };
}

export default {
  generateDNSConfig,
};
