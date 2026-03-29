const MAX_TEXT_EXCERPT_LENGTH = 6000;
const MAX_REFERENCE_COUNT = 8;
const DOMINANT_COLOR_SAMPLE_SIZE = 24;
const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.html',
  '.css',
  '.sql',
  '.yml',
  '.yaml',
];

function createReferenceId(prefix = 'ref') {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dedupeBy(items = [], getKey) {
  const seen = new Set();
  const results = [];

  for (const item of items) {
    const key = getKey(item);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(item);
  }

  return results;
}

function sanitizeText(value = '', maxLength = MAX_TEXT_EXCERPT_LENGTH) {
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

function summarizeText(value = '') {
  const normalized = sanitizeText(value, 320);

  if (!normalized) {
    return '';
  }

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [];
  return sentences
    .slice(0, 2)
    .join(' ')
    .trim()
    .slice(0, 220);
}

function extractHostnameLabel(reference) {
  if (reference?.type !== 'website' || !reference.url) {
    return '';
  }

  try {
    return new URL(reference.url).hostname.replace(/^www\./i, '');
  } catch {
    return reference.label || reference.name || '';
  }
}

function buildReferenceDescriptor(references = []) {
  const websites = references
    .filter((reference) => reference.type === 'website')
    .map((reference) => extractHostnameLabel(reference))
    .filter(Boolean);
  const logos = references.filter((reference) => reference.kind === 'logo');
  const images = references.filter((reference) => reference.kind === 'image');
  const documents = references.filter((reference) => reference.kind === 'document');
  const primaryWebsite = websites[0] || '';
  const logoNames = logos
    .map((reference) => reference.label || reference.name || '')
    .filter(Boolean);
  const documentExcerpt = documents
    .map((reference) => reference.excerpt || reference.summary || '')
    .filter(Boolean)
    .join(' ')
    .trim();
  const subjectSeed =
    primaryWebsite ||
    logoNames[0] ||
    documents[0]?.label ||
    references[0]?.label ||
    'the uploaded source material';

  return {
    websites,
    logos,
    images,
    documents,
    subjectSeed,
    subjectLabel: titleCase(
      String(subjectSeed)
        .replace(/\.[a-z]{2,}$/i, '')
        .replace(/[_-]+/g, ' '),
    ) || 'Source Material',
    documentExcerpt: sanitizeText(documentExcerpt, 480),
    hasBranding: logos.length > 0 || images.length > 0,
    hasWebsite: websites.length > 0,
    hasDocuments: documents.length > 0,
  };
}

function getFileExtension(fileName = '') {
  const normalized = String(fileName).trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');

  if (dotIndex === -1) {
    return '';
  }

  return normalized.slice(dotIndex);
}

function isTextLikeFile(file) {
  if (!file) {
    return false;
  }

  const mimeType = String(file.type || '').toLowerCase();
  const extension = getFileExtension(file.name);

  return TEXT_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix)) ||
    TEXT_EXTENSIONS.includes(extension) ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml';
}

function inferFileKind(file) {
  const fileName = String(file?.name || '').toLowerCase();
  const mimeType = String(file?.type || '').toLowerCase();

  if (mimeType.startsWith('image/')) {
    if (/logo|brand|mark|icon/.test(fileName)) {
      return 'logo';
    }

    return 'image';
  }

  if (isTextLikeFile(file)) {
    return 'document';
  }

  return 'file';
}

function normalizeHexChannel(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHexColor(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => normalizeHexChannel(value).toString(16).padStart(2, '0'))
    .join('')}`;
}

function normalizeWebsiteUrl(rawValue) {
  const trimmedValue = String(rawValue || '').trim();

  if (!trimmedValue) {
    throw new Error('Website URL cannot be empty.');
  }

  const withProtocol = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue}`;
  const parsedUrl = new URL(withProtocol);

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https website URLs are supported.');
  }

  parsedUrl.hash = '';

  return parsedUrl.toString();
}

async function fetchWebsiteText(url) {
  const targets = [
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`,
  ];

  for (const target of targets) {
    try {
      const response = await fetch(target);

      if (!response.ok) {
        continue;
      }

      const text = sanitizeText(await response.text(), 9000);

      if (text) {
        return text;
      }
    } catch {
      // Ignore fetch failures and fall back to hostname-only analysis.
    }
  }

  return '';
}

function extractWebsiteSummary(text = '', hostname = '') {
  const normalized = sanitizeText(text, 1800);

  if (!normalized) {
    return `Website reference queued for analysis from ${hostname}.`;
  }

  const titleMatch = normalized.match(/Title:\s*([^\n]+)/i);
  const markdownMatch = normalized.match(/Markdown Content:\s*([\s\S]+)/i);
  const content = sanitizeText(markdownMatch?.[1] || normalized, 1200);
  const summary = summarizeText(content);
  const title = titleMatch?.[1] ? sanitizeText(titleMatch[1], 120) : '';

  if (title && summary) {
    return `${title}. ${summary}`;
  }

  return summary || `Website reference queued for analysis from ${hostname}.`;
}

async function readTextExcerpt(file) {
  const text = await file.text();
  return sanitizeText(text);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load image preview.'));
    image.src = url;
  });
}

function collectDominantColor(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height).data;
  const buckets = new Map();

  for (let index = 0; index < imageData.length; index += 4) {
    const alpha = imageData[index + 3];

    if (alpha < 120) {
      continue;
    }

    const red = Math.round(imageData[index] / 32) * 32;
    const green = Math.round(imageData[index + 1] / 32) * 32;
    const blue = Math.round(imageData[index + 2] / 32) * 32;
    const bucketKey = `${red}:${green}:${blue}`;
    const nextCount = (buckets.get(bucketKey) ?? 0) + 1;
    buckets.set(bucketKey, nextCount);
  }

  if (buckets.size === 0) {
    return '#0f172a';
  }

  let selectedBucket = null;
  let highestCount = -1;

  for (const [bucketKey, bucketCount] of buckets.entries()) {
    if (bucketCount > highestCount) {
      selectedBucket = bucketKey;
      highestCount = bucketCount;
    }
  }

  const [red, green, blue] = String(selectedBucket)
    .split(':')
    .map((value) => Number.parseInt(value, 10));

  return toHexColor(red, green, blue);
}

async function analyzeImageFile(file) {
  const previewUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(previewUrl);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', {
      willReadFrequently: true,
    });

    if (!context) {
      return {
        previewUrl,
        width: image.naturalWidth || image.width || null,
        height: image.naturalHeight || image.height || null,
        dominantColor: '#0f172a',
      };
    }

    canvas.width = DOMINANT_COLOR_SAMPLE_SIZE;
    canvas.height = DOMINANT_COLOR_SAMPLE_SIZE;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return {
      previewUrl,
      width: image.naturalWidth || image.width || null,
      height: image.naturalHeight || image.height || null,
      dominantColor: collectDominantColor(context, canvas.width, canvas.height),
    };
  } catch {
    return {
      previewUrl,
      width: null,
      height: null,
      dominantColor: '#0f172a',
    };
  }
}

export async function analyzeUploadedFiles(fileList) {
  const files = Array.from(fileList ?? []).slice(0, MAX_REFERENCE_COUNT);
  const analyzedReferences = await Promise.all(
    files.map(async (file) => {
      const kind = inferFileKind(file);
      const baseReference = {
        id: createReferenceId(kind),
        type: 'upload',
        kind,
        name: file.name,
        label: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        extension: getFileExtension(file.name),
      };

      if (kind === 'document') {
        const excerpt = await readTextExcerpt(file);

        return {
          ...baseReference,
          excerpt,
          summary: summarizeText(excerpt) || 'Text reference ready for analysis.',
        };
      }

      if (kind === 'logo' || kind === 'image') {
        const imageDetails = await analyzeImageFile(file);

        return {
          ...baseReference,
          previewUrl: imageDetails.previewUrl,
          width: imageDetails.width,
          height: imageDetails.height,
          dominantColor: imageDetails.dominantColor,
          summary:
            kind === 'logo'
              ? 'Brand asset detected. OmniForge will use it for styling and naming cues.'
              : 'Image reference detected. OmniForge will use it for layout and style cues.',
        };
      }

      return {
        ...baseReference,
        summary: 'Binary reference attached. OmniForge will use its metadata as supporting context.',
      };
    }),
  );

  return dedupeBy(
    analyzedReferences,
    (reference) => `${reference.name}:${reference.size}:${reference.mimeType}`,
  );
}

export async function createWebsiteReference(rawValue) {
  const url = normalizeWebsiteUrl(rawValue);
  const parsedUrl = new URL(url);
  const excerpt = await fetchWebsiteText(url);
  const summary = extractWebsiteSummary(excerpt, parsedUrl.hostname);

  return {
    id: createReferenceId('website'),
    type: 'website',
    kind: 'website',
    label: parsedUrl.hostname,
    name: parsedUrl.hostname,
    url,
    excerpt,
    summary,
  };
}

export function revokeReferencePreview(reference) {
  if (reference?.previewUrl) {
    URL.revokeObjectURL(reference.previewUrl);
  }
}

function sanitizeReferenceForSubmission(reference) {
  if (!reference || typeof reference !== 'object') {
    return null;
  }

  const baseReference = {
    id: reference.id,
    type: reference.type,
    kind: reference.kind,
    label: reference.label,
    name: reference.name,
    summary: reference.summary ?? '',
  };

  if (reference.type === 'website') {
    return {
      ...baseReference,
      url: reference.url,
      excerpt: reference.excerpt ?? '',
    };
  }

  return {
    ...baseReference,
    mimeType: reference.mimeType ?? '',
    size: Number.isFinite(reference.size) ? reference.size : 0,
    extension: reference.extension ?? '',
    excerpt: reference.excerpt ?? '',
    width: reference.width ?? null,
    height: reference.height ?? null,
    dominantColor: reference.dominantColor ?? '',
  };
}

export function createBuilderContext(references = []) {
  const sanitizedReferences = dedupeBy(
    references
      .slice(0, MAX_REFERENCE_COUNT)
      .map(sanitizeReferenceForSubmission)
      .filter(Boolean),
    (reference) => {
      if (reference.type === 'website') {
        return reference.url;
      }

      return `${reference.name}:${reference.size}:${reference.mimeType}`;
    },
  );

  if (sanitizedReferences.length === 0) {
    return null;
  }

  return {
    createdAt: new Date().toISOString(),
    references: sanitizedReferences,
  };
}

function buildReferenceOptionPrompt(descriptor, variant) {
  const referenceInstruction = [
    descriptor.hasWebsite
      ? `Use the attached website references from ${descriptor.websites.join(', ')} to infer structure, copy hierarchy, and user flows.`
      : null,
    descriptor.hasBranding
      ? 'Use the uploaded brand assets, logos, and images to derive colors, typography mood, and visual direction.'
      : null,
    descriptor.hasDocuments && descriptor.documentExcerpt
      ? `Use the uploaded written material as product and workflow guidance: ${descriptor.documentExcerpt}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  const qualityInstruction =
    'The result must include working routes, complete UI, resolved imports, and a deploy-ready structure with preview, backend scaffold, and database schema when needed.';

  if (variant === 'faithful') {
    return `Build a polished production-ready app or software product based only on the attached references. ${referenceInstruction} Preserve the strongest brand and workflow signals, add any missing core screens, and make the result complete, working, and publishable. ${qualityInstruction}`;
  }

  if (variant === 'modernized') {
    return `Analyze the attached references and build a cleaner, more modern software product inspired by them. ${referenceInstruction} Improve layout, UX, navigation, and conversion flow while keeping the original business intent intact. Make the result complete, working, and publishable. ${qualityInstruction}`;
  }

  return `Analyze the attached references and create the leanest high-conversion launch-ready product version possible. ${referenceInstruction} Focus on the most valuable workflows, sharp onboarding, clear calls to action, and a complete deployable build. ${qualityInstruction}`;
}

export function createReferenceBuildOptions(references = []) {
  const normalizedReferences = Array.isArray(references)
    ? references.filter((reference) => reference && typeof reference === 'object')
    : [];

  if (normalizedReferences.length === 0) {
    return [];
  }

  const descriptor = buildReferenceDescriptor(normalizedReferences);
  const subject = descriptor.subjectLabel;

  return [
    {
      id: 'faithful',
      title: `Build ${subject}`,
      summary: 'Stay close to the source material and turn it into a complete software product.',
      prompt: buildReferenceOptionPrompt(descriptor, 'faithful'),
    },
    {
      id: 'modernized',
      title: `Modernize ${subject}`,
      summary: 'Keep the core idea, but rebuild it with stronger UX, cleaner structure, and sharper visuals.',
      prompt: buildReferenceOptionPrompt(descriptor, 'modernized'),
    },
    {
      id: 'launch',
      title: `Launch ${subject}`,
      summary: 'Generate the leanest publishable version with the most important flows ready first.',
      prompt: buildReferenceOptionPrompt(descriptor, 'launch'),
    },
  ];
}

export default {
  analyzeUploadedFiles,
  createBuilderContext,
  createReferenceBuildOptions,
  createWebsiteReference,
  revokeReferencePreview,
};
