import { analyzeBuilderContext } from '../intelligence/referenceAnalyzer.js';
import { analyzeInput } from '../ui/inputAnalyzer.js';
import { scrapeSite } from './siteScraper.js';
import { analyzeHTML } from './htmlAnalyzer.js';

export { scrapeSite } from './siteScraper.js';
export { analyzeHTML } from './htmlAnalyzer.js';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function cloneUI(scraped) {
  const safeScrape = scraped && typeof scraped === 'object' ? scraped : {};
  const buttons = Array.isArray(safeScrape.buttons) ? safeScrape.buttons : [];
  const links = Array.isArray(safeScrape.links) ? safeScrape.links : [];

  return {
    layout: 'reconstructed',
    components: buttons.map((button) => ({
      type: 'button',
      label: button,
    })),
    pages: links.slice(0, 5),
  };
}

function normalizeUrlReference(url) {
  return {
    id: `website-${Date.now()}`,
    type: 'website',
    kind: 'website',
    url,
    label: url,
    name: url,
    summary: '',
  };
}

function normalizeUploadReference(file) {
  const text =
    typeof file?.text === 'string'
      ? file.text
      : typeof file?.excerpt === 'string'
        ? file.excerpt
        : '';

  return {
    id: file?.id ?? `upload-${Date.now()}`,
    type: 'upload',
    kind: file?.kind ?? 'document',
    label: file?.label ?? file?.name ?? 'Uploaded source',
    name: file?.name ?? file?.label ?? 'Uploaded source',
    mimeType: file?.mimeType ?? file?.type ?? 'text/plain',
    extension: file?.extension ?? '',
    summary: file?.summary ?? '',
    excerpt: text,
    size: Number.isFinite(file?.size) ? file.size : 0,
    width: Number.isFinite(file?.width) ? file.width : null,
    height: Number.isFinite(file?.height) ? file.height : null,
    dominantColor: file?.dominantColor ?? '',
  };
}

export async function analyzeWebsite(url) {
  const scraped = await scrapeSite(url).catch(() => null);
  const htmlAnalysis = scraped?.html ? analyzeHTML(scraped.html) : null;
  const cloneStructure = scraped ? cloneUI(scraped) : null;
  const context = await analyzeBuilderContext({
    references: [normalizeUrlReference(url)],
  });
  const inferredAnalysis = await analyzeInput({
    mode: 'website',
    url,
    references: context.websites.map((website) => ({
      type: 'website',
      url: website.url,
      label: website.title || website.hostname || website.url,
      summary: website.summary,
    })),
  });
  const analysis = inferredAnalysis
    ? {
        ...inferredAnalysis,
        features: unique([
          ...(inferredAnalysis.features ?? []),
          ...(htmlAnalysis?.features ?? []),
        ]),
        structure: {
          ...(inferredAnalysis.structure ?? {}),
          html: htmlAnalysis?.structure ?? null,
          clonedUi: cloneStructure,
        },
      }
    : htmlAnalysis;

  return {
    source: 'website',
    scraped,
    context,
    htmlAnalysis,
    cloneStructure,
    analysis,
  };
}

export async function analyzeUploads(files = []) {
  const normalizedFiles = Array.isArray(files) ? files.map(normalizeUploadReference) : [];
  const context = await analyzeBuilderContext({
    references: normalizedFiles,
  });
  const inferredAnalysis = await analyzeInput({
    mode: 'upload',
    files: normalizedFiles.map((file) => ({
      name: file.name,
      type: file.mimeType,
      text: async () => file.excerpt || file.summary || file.label,
    })),
    references: normalizedFiles,
  });

  return {
    source: 'upload',
    context,
    analysis: inferredAnalysis,
  };
}

export async function analyzeSource(input) {
  if (typeof input === 'string') {
    return analyzeWebsite(input);
  }

  if (Array.isArray(input)) {
    return analyzeUploads(input);
  }

  if (input && typeof input === 'object' && typeof input.url === 'string') {
    return analyzeWebsite(input.url);
  }

  return analyzeUploads(input ? [input] : []);
}

export default {
  scrapeSite,
  analyzeHTML,
  cloneUI,
  analyzeWebsite,
  analyzeUploads,
  analyzeSource,
};
