import { createHash } from 'node:crypto';

const GODADDY_PRODUCTION_URL = 'https://api.godaddy.com';
const GODADDY_OTE_URL = 'https://api.ote-godaddy.com';
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

function getGoDaddyConfig() {
  const apiKey = process.env.GODADDY_API_KEY?.trim() ?? '';
  const apiSecret = process.env.GODADDY_API_SECRET?.trim() ?? '';
  const environment = process.env.GODADDY_ENV?.trim()?.toLowerCase() ?? 'production';
  const baseUrl = environment === 'ote' ? GODADDY_OTE_URL : GODADDY_PRODUCTION_URL;

  return {
    apiKey,
    apiSecret,
    environment,
    baseUrl,
    configured: Boolean(apiKey && apiSecret),
  };
}

function getSimulationScore(domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const hash = createHash('sha256').update(`godaddy:${normalizedDomain}`).digest('hex');
  const score = Number.parseInt(hash.slice(0, 8), 16) % 100;
  const tld = normalizedDomain.split('.').pop() ?? 'com';
  const tldBias = tld === 'com' ? -10 : tld === 'app' ? 2 : tld === 'io' ? -3 : 0;

  return score + tldBias;
}

function createSimulatedAvailability(domain, {
  source = 'simulated',
  note = 'GoDaddy credentials are not configured, so availability is simulated.',
} = {}) {
  const normalizedDomain = domain.trim().toLowerCase();
  const score = getSimulationScore(normalizedDomain);

  return {
    domain: normalizedDomain,
    available: score >= 48,
    provider: 'godaddy',
    source,
    checkedAt: new Date().toISOString(),
    confidence: Number((0.6 + Math.max(0, Math.min(score, 99)) / 260).toFixed(2)),
    note,
  };
}

export function isGoDaddyConfigured() {
  return getGoDaddyConfig().configured;
}

export async function checkAvailability(domain, options = {}) {
  assertDomain(domain);

  const normalizedDomain = domain.trim().toLowerCase();
  const { configured, apiKey, apiSecret, baseUrl } = getGoDaddyConfig();

  if (!configured) {
    return createSimulatedAvailability(normalizedDomain);
  }

  const { signal, dispose } = createTimeoutController();
  const requestUrl = new URL('/v1/domains/available', baseUrl);
  requestUrl.searchParams.set('domain', normalizedDomain);

  try {
    const response = await fetch(requestUrl, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'application/json',
        Authorization: `sso-key ${apiKey}:${apiSecret}`,
      },
    });
    const rawBody = await response.text();
    let payload = {};

    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = {};
    }

    if (!response.ok) {
      throw new Error(
        payload?.message ?? `GoDaddy request failed with status ${response.status}.`,
      );
    }

    if (typeof payload.available !== 'boolean') {
      throw new Error('GoDaddy response did not include a boolean availability value.');
    }

    return {
      domain: normalizedDomain,
      available: payload.available,
      provider: 'godaddy',
      source: 'live-api',
      checkedAt: new Date().toISOString(),
      confidence: 0.95,
      note: 'Availability returned by the live GoDaddy API.',
    };
  } catch (error) {
    if (options.allowSimulationFallback === false) {
      throw error;
    }

    return createSimulatedAvailability(normalizedDomain, {
      source: 'fallback-simulated',
      note: `GoDaddy live check failed, so availability was simulated: ${error?.message ?? 'Unknown error.'}`,
    });
  } finally {
    dispose();
  }
}

export default {
  checkAvailability,
  isGoDaddyConfigured,
};
