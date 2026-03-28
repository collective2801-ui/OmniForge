function normalizeText(value = '', maxLength = 1200) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function titleCase(value = '') {
  return String(value)
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function looksLikeUrl(value = '') {
  return /^(https?:\/\/|www\.)/i.test(String(value).trim()) || /\.[a-z]{2,}(\/|$)/i.test(String(value).trim());
}

function normalizeUrl(rawValue = '') {
  const trimmed = String(rawValue).trim();

  if (!trimmed) {
    throw new Error('URL input cannot be empty.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  parsed.hash = '';
  return parsed.toString();
}

function inferFeatureMatches(text = '') {
  const normalized = String(text).toLowerCase();
  const patterns = [
    ['auth', /\bauth\b|\blogin\b|\bsign[\s-]?in\b|\baccount\b|\buser\b/],
    ['dashboard', /\bdashboard\b|\banalytics\b|\badmin\b|\breporting\b/],
    ['payments', /\bpayment\b|\bbilling\b|\bcheckout\b|\bsubscription\b|\bstripe\b/],
    ['file_uploads', /\bupload\b|\bfile\b|\bdocument\b|\basset\b/],
    ['storage', /\bstorage\b|\bs3\b|\bbucket\b/],
    ['notifications', /\bnotification\b|\balert\b|\bemail\b|\bsms\b/],
    ['profiles', /\bprofile\b|\bmember\b|\bclient\b|\bcustomer\b/],
    ['search', /\bsearch\b|\bfilter\b|\bfind\b/],
    ['messaging', /\bmessage\b|\bchat\b|\binbox\b/],
    ['booking', /\bbooking\b|\bappointment\b|\bschedule\b|\bcalendar\b/],
    ['crm', /\bcrm\b|\blead\b|\bpipeline\b|\bsales\b/],
    ['ecommerce', /\bproduct\b|\bcart\b|\bshop\b|\bstorefront\b|\bcatalog\b/],
    ['landing_page', /\blanding\b|\bmarketing\b|\bhomepage\b|\bhero\b/],
    ['mobile', /\bmobile\b|\bios\b|\bandroid\b|\bexpo\b/],
    ['ai', /\bai\b|\bagent\b|\bassistant\b|\bautomation\b/],
  ];

  return patterns
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([feature]) => feature);
}

function inferType(text = '') {
  const normalized = String(text).toLowerCase();

  if (/\bmobile\b|\bios\b|\bandroid\b|\bexpo\b/.test(normalized)) {
    return 'mobile';
  }

  if (/\bwebsite\b|\blanding\b|\bmarketing\b|\bhomepage\b/.test(normalized)) {
    return 'website';
  }

  if (/\bstore\b|\bshop\b|\becommerce\b|\bcart\b/.test(normalized)) {
    return 'commerce';
  }

  if (/\bdashboard\b|\bsaas\b|\bplatform\b|\bportal\b|\badmin\b/.test(normalized)) {
    return 'saas';
  }

  return 'application';
}

function inferLayout(text = '', features = [], type = 'application') {
  const normalized = String(text).toLowerCase();

  if (features.includes('dashboard') || /\badmin\b|\bportal\b/.test(normalized)) {
    return 'sidebar-dashboard';
  }

  if (type === 'website' || features.includes('landing_page')) {
    return 'hero-sections';
  }

  if (type === 'mobile' || features.includes('mobile')) {
    return 'stacked-mobile';
  }

  if (features.includes('ecommerce')) {
    return 'catalog-commerce';
  }

  return 'application-shell';
}

function inferPages(features = [], type = 'application') {
  const pages = ['home'];

  if (type === 'website') {
    pages.push('about', 'pricing', 'contact');
  } else {
    pages.push('dashboard');
  }

  if (features.includes('auth')) {
    pages.push('login');
  }

  if (features.includes('payments')) {
    pages.push('billing');
  }

  if (features.includes('file_uploads')) {
    pages.push('uploads');
  }

  if (features.includes('profiles')) {
    pages.push('profile');
  }

  return unique(pages);
}

function inferComponents(features = [], layout = 'application-shell', type = 'application') {
  const components = ['navigation'];

  if (layout === 'sidebar-dashboard') {
    components.push('sidebar', 'summary-cards', 'data-table');
  }

  if (type === 'website') {
    components.push('hero', 'feature-grid', 'cta');
  }

  if (features.includes('auth')) {
    components.push('auth-form');
  }

  if (features.includes('payments')) {
    components.push('pricing-panel', 'checkout-flow');
  }

  if (features.includes('file_uploads')) {
    components.push('upload-dropzone');
  }

  if (features.includes('analytics') || features.includes('dashboard')) {
    components.push('chart-panel');
  }

  return unique(components);
}

function summarizeSource(source) {
  if (source.type === 'url') {
    return {
      type: source.type,
      label: source.label,
      url: source.url,
      hostname: source.hostname,
    };
  }

  return {
    type: source.type,
    label: source.label,
    mimeType: source.mimeType ?? '',
    extension: source.extension ?? '',
  };
}

async function readFileText(file) {
  if (!file || typeof file.text !== 'function') {
    return '';
  }

  try {
    return normalizeText(await file.text(), 2400);
  } catch {
    return '';
  }
}

async function normalizeInputSources(input) {
  if (typeof input === 'string' && looksLikeUrl(input)) {
    const url = normalizeUrl(input);
    const parsed = new URL(url);

    return [{
      type: 'url',
      label: parsed.hostname.replace(/^www\./i, ''),
      url,
      hostname: parsed.hostname.replace(/^www\./i, ''),
      text: `${parsed.hostname} ${parsed.pathname.replaceAll('/', ' ')}`,
    }];
  }

  if (input?.type === 'url' || typeof input?.url === 'string') {
    const url = normalizeUrl(input.url ?? input.value ?? '');
    const parsed = new URL(url);

    return [{
      type: 'url',
      label: parsed.hostname.replace(/^www\./i, ''),
      url,
      hostname: parsed.hostname.replace(/^www\./i, ''),
      text: `${parsed.hostname} ${parsed.pathname.replaceAll('/', ' ')}`,
    }];
  }

  if (Array.isArray(input?.references)) {
    return input.references.map((reference) => {
      if (reference.type === 'website') {
        return {
          type: 'url',
          label: reference.label || reference.name || reference.url,
          url: reference.url,
          hostname: (() => {
            try {
              return new URL(reference.url).hostname.replace(/^www\./i, '');
            } catch {
              return reference.label || reference.name || 'website';
            }
          })(),
          text: `${reference.label || ''} ${reference.summary || ''} ${reference.url || ''}`,
        };
      }

      return {
        type: 'file',
        label: reference.label || reference.name || 'Uploaded file',
        mimeType: reference.mimeType ?? '',
        extension: reference.extension ?? '',
        text: `${reference.label || ''} ${reference.summary || ''} ${reference.excerpt || ''}`,
      };
    });
  }

  if (
    (typeof FileList !== 'undefined' && input instanceof FileList) ||
    Array.isArray(input)
  ) {
    const files = Array.from(input);

    return Promise.all(
      files.map(async (file) => ({
        type: 'file',
        label: file.name,
        mimeType: file.type || '',
        extension: file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase() || ''}` : '',
        text: `${file.name} ${await readFileText(file)}`,
      })),
    );
  }

  if (input && typeof input === 'object' && typeof input.text === 'function') {
    return [{
      type: 'file',
      label: input.name || 'Uploaded file',
      mimeType: input.type || '',
      extension: input.name?.includes('.') ? `.${input.name.split('.').pop()?.toLowerCase() || ''}` : '',
      text: `${input.name || ''} ${await readFileText(input)}`,
    }];
  }

  return [];
}

export async function analyzeInput(input) {
  const sources = await normalizeInputSources(input);

  if (sources.length === 0) {
    return null;
  }

  const combinedText = normalizeText(
    sources.map((source) => source.text || source.label || '').join(' '),
    5000,
  );
  const features = unique(inferFeatureMatches(combinedText));
  const type = inferType(combinedText);
  const layout = inferLayout(combinedText, features, type);
  const structure = {
    layout,
    pages: inferPages(features, type),
    components: inferComponents(features, layout, type),
    sources: sources.map(summarizeSource),
  };
  const sourceMode = unique(sources.map((source) => source.type)).length > 1
    ? 'mixed'
    : sources[0].type === 'url'
      ? 'url'
      : 'file';
  const sourceLabel = titleCase(
    sources[0]?.label?.replace(/\.[a-z0-9]{2,}$/i, '') || `${type} source`,
  ) || 'Source Material';

  return {
    mode: sourceMode,
    sourceLabel,
    type,
    features,
    structure,
    summary:
      sourceMode === 'url'
        ? `Detected a ${type} pattern from the supplied website reference.`
        : sourceMode === 'file'
          ? `Detected a ${type} pattern from the uploaded source material.`
          : `Detected a ${type} pattern from mixed uploaded sources and website references.`,
    assumptions: unique([
      layout === 'sidebar-dashboard' ? 'A dashboard-style layout is likely the strongest starting point.' : '',
      features.includes('auth') ? 'Authentication should be included in the generated product.' : '',
      features.includes('payments') ? 'Billing or checkout flows appear to be required.' : '',
      features.includes('file_uploads') ? 'File or document handling should be included.' : '',
    ]),
    confidence: Number((0.62 + Math.min(features.length, 6) * 0.05).toFixed(2)),
  };
}

export default {
  analyzeInput,
};
