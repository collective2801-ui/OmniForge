function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '';
  }

  return value.trim().replace(/\/+$/, '');
}

function inferProductionApiBaseUrl() {
  const hostname = globalThis.window?.location?.hostname ?? '';

  if (
    hostname === 'omniforgeapp.com' ||
    hostname === 'www.omniforgeapp.com' ||
    hostname.endsWith('.vercel.app')
  ) {
    return 'https://api.omniforgeapp.com';
  }

  return '';
}

export function getApiBaseUrl() {
  return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL || inferProductionApiBaseUrl());
}

export function buildApiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

export async function apiRequest(path, {
  method = 'GET',
  body,
} = {}) {
  const response = await fetch(buildApiUrl(path), {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = {};

  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        payload?.error ??
        `Request failed with status ${response.status}.`,
    );
  }

  return payload;
}

export function createApiEventSource(path) {
  return new EventSource(buildApiUrl(path), {
    withCredentials: true,
  });
}

export default {
  getApiBaseUrl,
  buildApiUrl,
  apiRequest,
  createApiEventSource,
};
