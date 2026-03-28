import { scrapeSite } from '../scraper/siteScraper.js';
import { analyzeHTML } from '../scraper/htmlAnalyzer.js';

const WEBSITE_TIMEOUT_MS = 5000;
const MAX_WEBSITE_HTML_LENGTH = 250000;
const MAX_REFERENCE_COUNT = 8;

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
}

function sanitizeText(value = '', maxLength = 1600) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function stripHtml(html = '') {
  return sanitizeText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function extractTagContent(html, tagName) {
  const match = String(html).match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return stripHtml(match?.[1] ?? '');
}

function extractMetaContent(html, selectors = []) {
  for (const selector of selectors) {
    const pattern = new RegExp(
      `<meta[^>]+${selector.attribute}=["']${selector.value}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i',
    );
    const reversePattern = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${selector.attribute}=["']${selector.value}["'][^>]*>`,
      'i',
    );
    const match = String(html).match(pattern) ?? String(html).match(reversePattern);

    if (match?.[1]) {
      return sanitizeText(match[1], 320);
    }
  }

  return '';
}

function createTimeoutController(timeoutMs = WEBSITE_TIMEOUT_MS) {
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

function normalizeUrl(url) {
  const parsedUrl = new URL(String(url).trim());

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https website references are supported.');
  }

  parsedUrl.hash = '';
  return parsedUrl.toString();
}

function detectFeatureHints(text = '') {
  const source = String(text).toLowerCase();
  const hints = [];

  if (/\blogin\b|\bsign in\b|\bauth\b|\baccount\b/.test(source)) {
    hints.push('auth');
  }

  if (/\bpayment\b|\bcheckout\b|\bsubscription\b|\bbilling\b|\bpricing\b/.test(source)) {
    hints.push('payments');
  }

  if (/\bdashboard\b|\banalytics\b|\bmetrics\b|\breporting\b/.test(source)) {
    hints.push('dashboard');
  }

  if (/\bupload\b|\bfile\b|\basset\b|\bdocument\b/.test(source)) {
    hints.push('file_uploads');
  }

  if (/\bnotification\b|\balert\b|\bemail\b|\bmessage\b/.test(source)) {
    hints.push('notifications');
  }

  if (/\bsearch\b|\bfilter\b|\bdiscover\b/.test(source)) {
    hints.push('search');
  }

  return dedupeStrings(hints);
}

function summarizeUploadedReference(reference) {
  const summaryParts = [];

  if (reference.kind === 'logo' && reference.dominantColor) {
    summaryParts.push(`Primary brand color ${reference.dominantColor}`);
  }

  if (reference.width && reference.height) {
    summaryParts.push(`image dimensions ${reference.width}x${reference.height}`);
  }

  if (reference.excerpt) {
    summaryParts.push(`document excerpt "${sanitizeText(reference.excerpt, 160)}"`);
  }

  if (summaryParts.length === 0) {
    summaryParts.push(reference.summary || 'supporting asset metadata');
  }

  return `${reference.label || reference.name}: ${summaryParts.join(', ')}`;
}

async function fetchWebsiteReference(reference) {
  const normalizedUrl = normalizeUrl(reference.url);
  const { signal, dispose } = createTimeoutController();

  try {
    const scraped = await scrapeSite(normalizedUrl).catch(() => null);
    let html = scraped?.html ?? '';

    if (!html) {
      const response = await fetch(normalizedUrl, {
        method: 'GET',
        signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });
      html = await response.text();

      if (!response.ok) {
        throw new Error(`Website request failed with status ${response.status}.`);
      }
    }

    const boundedHtml = html.slice(0, MAX_WEBSITE_HTML_LENGTH);
    const htmlAnalysis = analyzeHTML(boundedHtml);
    const title = extractTagContent(boundedHtml, 'title');
    const description = extractMetaContent(boundedHtml, [
      { attribute: 'name', value: 'description' },
      { attribute: 'property', value: 'og:description' },
    ]);
    const themeColor = extractMetaContent(boundedHtml, [
      { attribute: 'name', value: 'theme-color' },
      { attribute: 'property', value: 'theme-color' },
    ]);
    const heading = extractTagContent(boundedHtml, 'h1');
    const ogSiteName = extractMetaContent(boundedHtml, [
      { attribute: 'property', value: 'og:site_name' },
    ]);
    const pageText = stripHtml(boundedHtml).slice(0, 1200);
    const summary = sanitizeText(
      [title, description, heading].filter(Boolean).join(' | '),
      260,
    );
    const scrapeSummary = scraped
      ? sanitizeText(
          [
            scraped.forms > 0 ? `${scraped.forms} forms` : '',
            scraped.inputs > 0 ? `${scraped.inputs} inputs` : '',
            Array.isArray(scraped.buttons) && scraped.buttons.length > 0
              ? `${scraped.buttons.length} buttons`
              : '',
            Array.isArray(scraped.links) && scraped.links.length > 0
              ? `${scraped.links.length} links`
              : '',
          ]
            .filter(Boolean)
            .join(' | '),
          180,
        )
      : '';

    return {
      ...reference,
      url: normalizedUrl,
      hostname: new URL(normalizedUrl).hostname,
      status: 'analyzed',
      title,
      description,
      heading,
      siteName: ogSiteName,
      themeColor,
      excerpt: pageText,
      summary:
        summary ||
        scrapeSummary ||
        reference.summary ||
        `Website analyzed from ${normalizedUrl}.`,
      featureHints: dedupeStrings([
        ...detectFeatureHints(
          [
            title,
            description,
            heading,
            pageText,
            Array.isArray(scraped?.buttons) ? scraped.buttons.join(' ') : '',
            scraped?.forms ? `forms ${scraped.forms}` : '',
            scraped?.inputs ? `inputs ${scraped.inputs}` : '',
          ].join(' '),
        ),
        ...(htmlAnalysis?.features ?? []),
      ]),
      structure: htmlAnalysis?.structure ?? null,
      htmlAnalysis,
      scrape: scraped
        ? {
            links: scraped.links.slice(0, 80),
            buttons: scraped.buttons.slice(0, 40),
            forms: scraped.forms,
            inputs: scraped.inputs,
            images: scraped.images.slice(0, 40),
          }
        : null,
    };
  } catch (error) {
    return {
      ...reference,
      url: normalizedUrl,
      hostname: new URL(normalizedUrl).hostname,
      status: 'failed',
      error: error?.message ?? 'Website analysis failed.',
      featureHints: [],
    };
  } finally {
    dispose();
  }
}

function summarizeReferenceCounts(references = [], websites = []) {
  const logoCount = references.filter((reference) => reference.kind === 'logo').length;
  const fileCount = references.filter(
    (reference) => reference.type === 'upload' && reference.kind !== 'logo',
  ).length;
  const websiteCount = websites.length;
  const parts = [];

  if (logoCount > 0) {
    parts.push(`${logoCount} logo${logoCount === 1 ? '' : 's'}`);
  }

  if (fileCount > 0) {
    parts.push(`${fileCount} uploaded file${fileCount === 1 ? '' : 's'}`);
  }

  if (websiteCount > 0) {
    parts.push(`${websiteCount} website reference${websiteCount === 1 ? '' : 's'}`);
  }

  return parts.length > 0
    ? `Analyzed ${parts.join(', ')}.`
    : 'No external references were provided.';
}

function buildReferenceAssumptions(uploadedReferences, websites) {
  const assumptions = [];
  const logoReference = uploadedReferences.find((reference) => reference.kind === 'logo');
  const websiteReference = websites.find((reference) => reference.status === 'analyzed');

  if (logoReference?.dominantColor) {
    assumptions.push(
      `Use ${logoReference.dominantColor} as a primary visual cue from the provided logo asset.`,
    );
  }

  if (websiteReference?.summary) {
    assumptions.push(
      `Borrow structural and tone cues from ${websiteReference.hostname}: ${sanitizeText(websiteReference.summary, 180)}.`,
    );
  }

  for (const reference of uploadedReferences) {
    if (reference.excerpt) {
      assumptions.push(
        `Incorporate requirements from ${reference.label || reference.name}: ${sanitizeText(reference.excerpt, 180)}.`,
      );
    }
  }

  return dedupeStrings(assumptions).slice(0, 6);
}

function buildPromptAddendum(uploadedReferences, websites) {
  const lines = [];

  if (uploadedReferences.length > 0) {
    lines.push('Uploaded source materials:');
    for (const reference of uploadedReferences) {
      lines.push(`- ${summarizeUploadedReference(reference)}`);
    }
  }

  if (websites.length > 0) {
    lines.push('Website references:');
    for (const website of websites) {
      if (website.status === 'analyzed') {
        lines.push(
          `- ${website.hostname}: ${sanitizeText(
            [website.title, website.description, website.heading].filter(Boolean).join(' | '),
            220,
          )}`,
        );
      } else {
        lines.push(`- ${website.hostname}: ${website.error}`);
      }
    }
  }

  if (lines.length === 0) {
    return '';
  }

  return `Reference brief:\n${lines.join('\n')}`;
}

function sanitizeUploadedReference(reference) {
  return {
    id: reference.id ?? '',
    type: 'upload',
    kind: reference.kind ?? 'file',
    label: sanitizeText(reference.label || reference.name || 'Uploaded file', 120),
    name: sanitizeText(reference.name || reference.label || 'Uploaded file', 120),
    mimeType: sanitizeText(reference.mimeType || '', 120),
    size: Number.isFinite(reference.size) ? reference.size : 0,
    extension: sanitizeText(reference.extension || '', 20),
    summary: sanitizeText(reference.summary || '', 220),
    excerpt: sanitizeText(reference.excerpt || '', 4000),
    width: Number.isFinite(reference.width) ? reference.width : null,
    height: Number.isFinite(reference.height) ? reference.height : null,
    dominantColor: sanitizeText(reference.dominantColor || '', 24),
  };
}

function sanitizeWebsiteReference(reference) {
  return {
    id: reference.id ?? '',
    type: 'website',
    kind: 'website',
    label: sanitizeText(reference.label || reference.url || 'Website reference', 120),
    name: sanitizeText(reference.name || reference.label || 'Website reference', 120),
    url: normalizeUrl(reference.url),
    summary: sanitizeText(reference.summary || '', 220),
  };
}

export async function analyzeBuilderContext(builderContext) {
  const inputReferences = Array.isArray(builderContext?.references)
    ? builderContext.references.slice(0, MAX_REFERENCE_COUNT)
    : [];
  const uploadedReferences = [];
  const websiteReferences = [];

  for (const reference of inputReferences) {
    if (!reference || typeof reference !== 'object') {
      continue;
    }

    if (reference.type === 'website' && typeof reference.url === 'string') {
      try {
        websiteReferences.push(sanitizeWebsiteReference(reference));
      } catch {
        // Ignore malformed website references instead of failing the whole task.
      }
      continue;
    }

    uploadedReferences.push(sanitizeUploadedReference(reference));
  }

  const analyzedWebsites = await Promise.all(
    websiteReferences.map((reference) => fetchWebsiteReference(reference)),
  );
  const featureHints = dedupeStrings([
    ...uploadedReferences.flatMap((reference) => detectFeatureHints(reference.excerpt || reference.summary)),
    ...analyzedWebsites.flatMap((reference) => reference.featureHints ?? []),
  ]);
  const assumptions = buildReferenceAssumptions(uploadedReferences, analyzedWebsites);
  const promptAddendum = buildPromptAddendum(uploadedReferences, analyzedWebsites);
  const dominantColors = dedupeStrings(
    uploadedReferences
      .map((reference) => reference.dominantColor)
      .filter(Boolean),
  );

  return {
    createdAt: new Date().toISOString(),
    summary: summarizeReferenceCounts(uploadedReferences, analyzedWebsites),
    uploadedReferences,
    websites: analyzedWebsites,
    featureHints,
    assumptions,
    branding: {
      hasLogo: uploadedReferences.some((reference) => reference.kind === 'logo'),
      dominantColors,
    },
    promptAddendum,
  };
}

export default {
  analyzeBuilderContext,
};
