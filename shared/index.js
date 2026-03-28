export const buildRequestSchema = {
  required: ['url'],
  properties: {
    url: 'string',
    selected: 'array',
  },
};

export const buildResponseSchema = {
  required: ['productionReady', 'validated', 'ideas', 'apps'],
  properties: {
    productionReady: 'boolean',
    validated: 'boolean',
    ideas: 'array',
    apps: 'array',
  },
};

export function validateBuildRequest(payload = {}) {
  if (typeof payload?.url !== 'string' || payload.url.trim().length === 0) {
    return {
      ok: false,
      error: 'A valid url string is required.',
    };
  }

  if (
    payload.selected !== undefined &&
    !Array.isArray(payload.selected)
  ) {
    return {
      ok: false,
      error: 'selected must be an array when provided.',
    };
  }

  return {
    ok: true,
    value: {
      url: payload.url.trim(),
      selected: Array.isArray(payload.selected) ? payload.selected : undefined,
    },
  };
}

export default {
  buildRequestSchema,
  buildResponseSchema,
  validateBuildRequest,
};
