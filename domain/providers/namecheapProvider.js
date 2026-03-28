import { createHash } from 'node:crypto';

const NAMECHEAP_PRODUCTION_URL = 'https://api.namecheap.com/xml.response';
const NAMECHEAP_SANDBOX_URL = 'https://api.sandbox.namecheap.com/xml.response';
const REQUEST_TIMEOUT_MS = 8000;

function assertDomain(domain) {
  if (typeof domain !== 'string' || domain.trim().length === 0) {
    throw new TypeError('Domain is required.');
  }
}

function createTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeoutId);
    },
  };
}

function getNamecheapConfig() {
  const apiUser = process.env.NAMECHEAP_API_USER?.trim() ?? '';
  const apiKey = process.env.NAMECHEAP_API_KEY?.trim() ?? '';
  const username = process.env.NAMECHEAP_USERNAME?.trim() ?? '';
  const clientIp = process.env.NAMECHEAP_CLIENT_IP?.trim() ?? '';
  const useSandbox = /^(1|true|yes)$/i.test(
    process.env.NAMECHEAP_USE_SANDBOX?.trim() ?? '',
  );

  return {
    apiUser,
    apiKey,
    username,
    clientIp,
    useSandbox,
    configured: Boolean(apiUser && apiKey && username && clientIp),
  };
}

function getSimulationScore(domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const hash = createHash('sha256').update(`namecheap:${normalizedDomain}`).digest('hex');
  const score = Number.parseInt(hash.slice(0, 8), 16) % 100;
  const tld = normalizedDomain.split('.').pop() ?? 'com';
  const tldBias = tld === 'com' ? -12 : tld === 'io' ? -5 : tld === 'app' ? 4 : 0;

  return score + tldBias;
}

function createSimulatedAvailability(domain, {
  source = 'simulated',
  note = 'Namecheap credentials are not configured, so availability is simulated.',
} = {}) {
  const normalizedDomain = domain.trim().toLowerCase();
  const score = getSimulationScore(normalizedDomain);

  return {
    domain: normalizedDomain,
    available: score >= 46,
    provider: 'namecheap',
    source,
    checkedAt: new Date().toISOString(),
    confidence: Number((0.62 + Math.max(0, Math.min(score, 99)) / 250).toFixed(2)),
    note,
  };
}

function parseNamecheapErrors(xmlBody) {
  const errors = [];
  const errorPattern = /<Error[^>]*Number="([^"]+)"[^>]*>([\s\S]*?)<\/Error>/gi;
  let match = errorPattern.exec(xmlBody);

  while (match) {
    errors.push({
      code: match[1],
      message: match[2].replace(/\s+/g, ' ').trim(),
    });
    match = errorPattern.exec(xmlBody);
  }

  return errors;
}

function assertSuccessfulApiResponse(xmlBody) {
  const statusMatch = xmlBody.match(/<ApiResponse[^>]*Status="([^"]+)"/i);
  const status = statusMatch?.[1]?.toUpperCase() ?? '';

  if (status === 'ERROR') {
    const errors = parseNamecheapErrors(xmlBody);
    const summary =
      errors.length > 0
        ? errors.map((error) => `[${error.code}] ${error.message}`).join(' ')
        : 'Namecheap returned an unspecified API error.';

    throw new Error(summary);
  }
}

function parseAvailabilityFromXml(xmlBody, domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const escapedDomain = normalizedDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const resultPattern = new RegExp(
    `<DomainCheckResult[^>]*Domain="${escapedDomain}"[^>]*Available="(true|false)"`,
    'i',
  );
  const match = xmlBody.match(resultPattern);

  if (!match) {
    throw new Error(`Namecheap response did not include availability for ${normalizedDomain}.`);
  }

  return match[1].toLowerCase() === 'true';
}

export function isNamecheapConfigured() {
  return getNamecheapConfig().configured;
}

export async function checkAvailability(domain, options = {}) {
  assertDomain(domain);

  const normalizedDomain = domain.trim().toLowerCase();
  const { configured, apiUser, apiKey, username, clientIp, useSandbox } = getNamecheapConfig();

  if (!configured) {
    return createSimulatedAvailability(normalizedDomain);
  }

  const endpoint = useSandbox ? NAMECHEAP_SANDBOX_URL : NAMECHEAP_PRODUCTION_URL;
  const searchParams = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: username,
    ClientIp: clientIp,
    Command: 'namecheap.domains.check',
    DomainList: normalizedDomain,
  });
  const { signal, dispose } = createTimeoutController();

  try {
    const response = await fetch(`${endpoint}?${searchParams.toString()}`, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    });
    const xmlBody = await response.text();

    if (!response.ok) {
      throw new Error(`Namecheap request failed with status ${response.status}.`);
    }

    assertSuccessfulApiResponse(xmlBody);

    return {
      domain: normalizedDomain,
      available: parseAvailabilityFromXml(xmlBody, normalizedDomain),
      provider: 'namecheap',
      source: 'live-api',
      checkedAt: new Date().toISOString(),
      confidence: 0.96,
      note: 'Availability returned by the live Namecheap API.',
    };
  } catch (error) {
    if (options.allowSimulationFallback === false) {
      throw error;
    }

    return createSimulatedAvailability(normalizedDomain, {
      source: 'fallback-simulated',
      note: `Namecheap live check failed, so availability was simulated: ${error?.message ?? 'Unknown error.'}`,
    });
  } finally {
    dispose();
  }
}

export default {
  checkAvailability,
  isNamecheapConfigured,
};
