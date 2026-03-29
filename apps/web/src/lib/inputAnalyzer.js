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

function containsMatch(source = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(source));
}

function countSourcesByType(sources = [], predicate) {
  return sources.filter(predicate).length;
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
    ['booking', /\bbooking\b|\bappointment\b|\bschedule\b|\bcalendar\b|\bconsultation\b|\bbook\b/],
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

function inferBusinessCategory(text = '', features = []) {
  const normalized = String(text).toLowerCase();
  const featureSet = new Set(features);
  const categoryMatchers = [
    {
      id: 'healthcare',
      label: 'Healthcare',
      keywords: [
        /\btreatment\b/,
        /\bclinic\b/,
        /\bpatient\b/,
        /\btherapy\b/,
        /\brecovery\b/,
        /\bmedical\b/,
        /\bhealth\b/,
        /\bdental\b/,
        /\bdoctor\b/,
        /\bclinic\b/,
      ],
    },
    {
      id: 'legal',
      label: 'Legal',
      keywords: [/\blaw\b/, /\blegal\b/, /\bfirm\b/, /\battorney\b/, /\bcase\b/],
    },
    {
      id: 'home_services',
      label: 'Home Services',
      keywords: [
        /\bplumbing\b/,
        /\bhvac\b/,
        /\broofing\b/,
        /\belectrical\b/,
        /\bcontractor\b/,
        /\bservice call\b/,
        /\bfield\b/,
      ],
    },
    {
      id: 'real_estate',
      label: 'Real Estate',
      keywords: [/\breal estate\b/, /\bproperty\b/, /\bleasing\b/, /\brealtor\b/, /\bbroker\b/],
    },
    {
      id: 'commerce',
      label: 'Commerce',
      keywords: [/\bshop\b/, /\bstore\b/, /\bcatalog\b/, /\bproduct\b/, /\bcart\b/, /\becommerce\b/],
    },
    {
      id: 'education',
      label: 'Education',
      keywords: [/\bcourse\b/, /\beducation\b/, /\bstudent\b/, /\btraining\b/, /\blearning\b/],
    },
    {
      id: 'hospitality',
      label: 'Hospitality',
      keywords: [/\brestaurant\b/, /\bguest\b/, /\bhotel\b/, /\breservation\b/, /\bdining\b/],
    },
    {
      id: 'finance',
      label: 'Finance',
      keywords: [/\bfinance\b/, /\binsurance\b/, /\bwealth\b/, /\baccounting\b/, /\btax\b/],
    },
    {
      id: 'recruiting',
      label: 'Recruiting',
      keywords: [/\brecruit\b/, /\bhiring\b/, /\bcandidate\b/, /\bjob\b/, /\bstaffing\b/],
    },
    {
      id: 'agency',
      label: 'Agency',
      keywords: [/\bagency\b/, /\bmarketing\b/, /\bcreative\b/, /\bbrand\b/, /\bclient work\b/],
    },
  ];

  const matchedCategory = categoryMatchers.find((matcher) => containsMatch(normalized, matcher.keywords));

  if (matchedCategory) {
    return matchedCategory;
  }

  if (featureSet.has('ecommerce') || featureSet.has('payments')) {
    return {
      id: 'commerce',
      label: 'Commerce',
    };
  }

  if (featureSet.has('booking')) {
    return {
      id: 'service_business',
      label: 'Service Business',
    };
  }

  if (featureSet.has('crm') || featureSet.has('dashboard')) {
    return {
      id: 'b2b_operations',
      label: 'B2B Operations',
    };
  }

  return {
    id: 'business_services',
    label: 'Business Services',
  };
}

function inferBusinessModel(text = '', features = []) {
  const normalized = String(text).toLowerCase();
  const featureSet = new Set(features);

  if (containsMatch(normalized, [/\bsubscription\b/, /\bmember\b/, /\bmembership\b/, /\bmonthly\b/])) {
    return 'subscription';
  }

  if (containsMatch(normalized, [/\bbook\b/, /\bappointment\b/, /\bschedule\b/, /\bconsultation\b/])) {
    return 'appointment-based';
  }

  if (featureSet.has('ecommerce') || containsMatch(normalized, [/\bproduct\b/, /\bshop\b/, /\border\b/])) {
    return 'transactional';
  }

  if (featureSet.has('crm') || containsMatch(normalized, [/\blead\b/, /\bestimate\b/, /\bquote\b/, /\brequest\b/])) {
    return 'lead-generation';
  }

  if (featureSet.has('dashboard') || featureSet.has('auth')) {
    return 'retained accounts';
  }

  return 'service-led';
}

function inferAudience(category, text = '') {
  const normalized = String(text).toLowerCase();

  if (category === 'healthcare') {
    return 'patients, care teams, and program operators';
  }

  if (category === 'legal') {
    return 'prospective clients, legal staff, and case managers';
  }

  if (category === 'home_services') {
    return 'dispatchers, field technicians, and homeowners';
  }

  if (category === 'real_estate') {
    return 'buyers, sellers, agents, and operations staff';
  }

  if (category === 'commerce') {
    return 'shoppers, merchandisers, and customer support teams';
  }

  if (category === 'education') {
    return 'students, instructors, and enrollment teams';
  }

  if (category === 'hospitality') {
    return 'guests, front-desk staff, and operators';
  }

  if (category === 'finance') {
    return 'clients, advisors, and operations teams';
  }

  if (category === 'recruiting') {
    return 'candidates, recruiters, and hiring managers';
  }

  if (normalized.includes('client')) {
    return 'clients and internal operators';
  }

  return 'customers, staff, and operators';
}

function inferBusinessScale(structure = {}, text = '') {
  const source = String(text).toLowerCase();
  const score =
    (Array.isArray(structure.pages) ? structure.pages.length : 0) +
    (Array.isArray(structure.components) ? structure.components.length : 0) +
    Number(structure.sourceCount ?? 0);

  if (containsMatch(source, [/\benterprise\b/, /\bnational\b/, /\bmulti-location\b/, /\bfranchise\b/])) {
    return 'expanding';
  }

  if (score >= 14) {
    return 'expanding';
  }

  if (score >= 9) {
    return 'growing';
  }

  return 'local';
}

function inferOperationalPainPoints(category, features = [], model = 'service-led') {
  const featureSet = new Set(features);
  const painPoints = [
    'Too much workflow coordination still depends on staff memory, inboxes, or spreadsheets.',
    'Revenue opportunities are being lost between first inquiry, follow-up, and fulfillment.',
  ];

  if (featureSet.has('auth') || model === 'retained accounts') {
    painPoints.push('Clients do not have a clean self-serve login area for repeat actions and account updates.');
  }

  if (featureSet.has('dashboard')) {
    painPoints.push('Operators lack a real-time control view for bottlenecks, outcomes, and accountability.');
  }

  if (featureSet.has('payments')) {
    painPoints.push('Checkout, billing, or plan management is fragmented and limits recurring revenue.');
  }

  if (category === 'healthcare') {
    painPoints.push('Staff time is wasted on eligibility, compliance, and progress tracking that should be automated.');
  } else if (category === 'home_services') {
    painPoints.push('Scheduling, dispatch, and follow-up handoffs create missed jobs and margin leakage.');
  } else if (category === 'legal') {
    painPoints.push('Intake, document gathering, and case-status communication are too manual.');
  } else if (category === 'commerce') {
    painPoints.push('Abandoned demand and repeat purchase opportunities are not being captured systematically.');
  }

  return unique(painPoints).slice(0, 4);
}

function inferMoneyDrivers(category, features = [], model = 'service-led') {
  const revenueDrivers = [];
  const savingsDrivers = [];

  if (model === 'subscription' || features.includes('payments')) {
    revenueDrivers.push('convert repeat usage into recurring subscription revenue');
  }

  if (model === 'lead-generation' || model === 'appointment-based' || features.includes('crm') || features.includes('booking')) {
    revenueDrivers.push('capture and qualify more high-intent leads before they go cold');
  }

  if (features.includes('profiles') || features.includes('auth')) {
    revenueDrivers.push('increase retention with a login-based product or portal experience');
  }

  if (category === 'commerce') {
    revenueDrivers.push('raise average order value and repeat purchase frequency');
  }

  if (category === 'healthcare') {
    savingsDrivers.push('cut operator admin time tied to patient eligibility, tracking, and communications');
  } else if (category === 'home_services') {
    savingsDrivers.push('reduce dispatch waste, idle technician time, and missed follow-up');
  } else if (category === 'legal') {
    savingsDrivers.push('reduce manual intake, document chasing, and case update work');
  } else {
    savingsDrivers.push('replace repetitive manual coordination with automated workflows and dashboards');
  }

  if (features.includes('dashboard') || features.includes('analytics')) {
    savingsDrivers.push('surface performance issues early enough to protect margin');
  }

  return {
    revenue: unique(revenueDrivers).slice(0, 3),
    savings: unique(savingsDrivers).slice(0, 3),
    primaryOutcome:
      revenueDrivers.length > 0 && savingsDrivers.length > 0
        ? 'hybrid'
        : revenueDrivers.length > 0
          ? 'growth'
          : 'efficiency',
  };
}

const KEYWORD_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'business',
  'company',
  'contact',
  'customer',
  'customers',
  'experience',
  'features',
  'first',
  'general',
  'group',
  'guide',
  'helps',
  'home',
  'information',
  'learn',
  'management',
  'modern',
  'online',
  'operator',
  'operators',
  'page',
  'pages',
  'people',
  'platform',
  'product',
  'products',
  'professional',
  'program',
  'programs',
  'service',
  'services',
  'solutions',
  'support',
  'system',
  'team',
  'teams',
  'their',
  'these',
  'they',
  'this',
  'through',
  'using',
  'website',
  'work',
  'workflow',
  'workflows',
  'your',
]);

function cleanPhrase(value = '') {
  return String(value)
    .replace(/^[#*\-\d.\s]+/, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/\b(and|with|for|the|our|your|from)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[,;:/-]+|[,;:/-]+$/g, '')
    .slice(0, 72);
}

function titleCasePhrase(value = '') {
  return cleanPhrase(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractTopKeywords(text = '', maxCount = 8) {
  const counts = new Map();
  const tokens = String(text)
    .toLowerCase()
    .match(/[a-z][a-z-]{3,}/g) ?? [];

  for (const token of tokens) {
    if (KEYWORD_STOPWORDS.has(token)) {
      continue;
    }

    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, maxCount)
    .map(([token]) => token);
}

function extractOfferPhrases(text = '') {
  const normalized = String(text);
  const sentences = normalized.match(/[^.!?\n]+/g) ?? [];
  const phrases = [];
  const markers = [
    'services',
    'service',
    'products',
    'product',
    'solutions',
    'solution',
    'programs',
    'program',
    'treatments',
    'treatment',
    'courses',
    'course',
    'practice areas',
    'specialties',
    'specialty',
  ];

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase();

    if (!markers.some((marker) => lowerSentence.includes(marker))) {
      continue;
    }

    const listCandidate = sentence
      .replace(/^[^:]{0,80}:/, '')
      .replace(/\band\b/gi, ',')
      .split(',')
      .map((part) => titleCasePhrase(part))
      .filter((part) => part.split(/\s+/).length <= 6 && part.length >= 4);

    phrases.push(...listCandidate);
  }

  if (phrases.length > 0) {
    return unique(phrases).slice(0, 6);
  }

  const headingMatches = normalized.match(/(?:^|\n)#+\s*([^\n]+)/g) ?? [];
  return unique(
    headingMatches
      .map((line) => titleCasePhrase(line.replace(/(?:^|\n)#+\s*/, '')))
      .filter((line) => line.split(/\s+/).length <= 6 && line.length >= 4),
  ).slice(0, 6);
}

function extractContentThemes(text = '', keywords = []) {
  const source = String(text).toLowerCase();
  const themes = [];

  for (const keyword of keywords) {
    if (source.includes(`${keyword} guide`) || source.includes(`guide ${keyword}`)) {
      themes.push(`${titleCase(keyword)} Guides`);
    }

    if (source.includes(`${keyword} tips`) || source.includes(`tips ${keyword}`)) {
      themes.push(`${titleCase(keyword)} Tips`);
    }

    if (source.includes(`${keyword} resources`) || source.includes(`resources ${keyword}`)) {
      themes.push(`${titleCase(keyword)} Resources`);
    }

    if (source.includes(`${keyword} education`) || source.includes(`education ${keyword}`)) {
      themes.push(`${titleCase(keyword)} Education`);
    }
  }

  return unique(themes).slice(0, 4);
}

function inferBusinessProfile(text = '', sources = [], features = [], structure = {}) {
  const category = inferBusinessCategory(text, features);
  const model = inferBusinessModel(text, features);
  const scale = inferBusinessScale(structure, text);
  const pains = inferOperationalPainPoints(category.id, features, model);
  const moneyDrivers = inferMoneyDrivers(category.id, features, model);
  const keywords = extractTopKeywords(text);
  const offers = extractOfferPhrases(text);
  const contentThemes = extractContentThemes(text, keywords);
  const primaryOffer = offers[0] || titleCasePhrase(keywords[0] || category.label);

  return {
    category: category.id,
    categoryLabel: category.label,
    businessModel: model,
    audience: inferAudience(category.id, text),
    scale,
    pains,
    moneyDrivers,
    keywords,
    offerNames: offers,
    primaryOffer,
    contentThemes,
    sourceMix:
      unique(sources.map((source) => source.type)).length > 1
        ? 'mixed'
        : sources[0]?.type === 'url'
          ? 'website'
          : 'files',
  };
}

function inferFeaturesFromSources(sources = []) {
  const features = [];

  for (const source of sources) {
    const extension = String(source.extension || '').toLowerCase();
    const mimeType = String(source.mimeType || '').toLowerCase();
    const label = String(source.label || '').toLowerCase();
    const combined = `${extension} ${mimeType} ${label}`;

    if (source.type === 'url') {
      features.push('landing_page');
    }

    if (/\bjson\b|\.json\b|\.csv\b|\bcsv\b|spreadsheet/.test(combined)) {
      features.push('dashboard', 'analytics', 'file_uploads');
    }

    if (/\bpdf\b|\.pdf\b|\.doc\b|\.docx\b|brief|proposal|report/.test(combined)) {
      features.push('auth', 'profiles', 'file_uploads');
    }

    if (/\bhtml\b|\.html\b|\.css\b|\.js\b|\.ts\b|website|frontend/.test(combined)) {
      features.push('landing_page', 'auth');
    }

    if (/\bpng\b|\.png\b|\.jpg\b|\.jpeg\b|\.svg\b|logo|brand|image/.test(combined)) {
      features.push('landing_page');
    }

    if (/\bpayment\b|\bstripe\b|\bbilling\b/.test(combined)) {
      features.push('payments');
    }
  }

  return unique(features);
}

function inferType(text = '', sources = [], features = []) {
  const normalized = String(text).toLowerCase();
  const sourceCount = sources.length;
  const urlCount = countSourcesByType(sources, (source) => source.type === 'url');
  const mediaCount = countSourcesByType(
    sources,
    (source) => /\.(png|jpg|jpeg|svg|webp)$/i.test(source.extension || '') || /image|logo/.test(String(source.mimeType || '')),
  );

  if (/\bmobile\b|\bios\b|\bandroid\b|\bexpo\b/.test(normalized)) {
    return 'mobile';
  }

  if (/\bwebsite\b|\blanding\b|\bmarketing\b|\bhomepage\b/.test(normalized)) {
    return 'website';
  }

  if (/\bstore\b|\bshop\b|\becommerce\b|\bcart\b/.test(normalized)) {
    return 'commerce';
  }

  if (features.includes('dashboard') || features.includes('auth') || features.includes('payments')) {
    return 'saas';
  }

  if (urlCount > 0 && mediaCount === 0 && sourceCount <= 2 && features.includes('landing_page')) {
    return 'website';
  }

  if (mediaCount > 0 && sourceCount === mediaCount && !features.includes('dashboard')) {
    return 'website';
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
          text: `${reference.label || ''} ${reference.summary || ''} ${reference.excerpt || ''} ${reference.url || ''}`,
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
  const features = unique([
    ...inferFeatureMatches(combinedText),
    ...inferFeaturesFromSources(sources),
  ]);
  const type = inferType(combinedText, sources, features);
  const layout = inferLayout(combinedText, features, type);
  const structure = {
    layout,
    pages: inferPages(features, type),
    components: inferComponents(features, layout, type),
    sources: sources.map(summarizeSource),
    sourceCount: sources.length,
  };
  const businessProfile = inferBusinessProfile(combinedText, sources, features, structure);
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
    businessProfile,
    opportunitySummary: `${businessProfile.categoryLabel} businesses like this usually need software that ${businessProfile.moneyDrivers.primaryOutcome === 'growth' ? 'creates new revenue fast' : businessProfile.moneyDrivers.primaryOutcome === 'efficiency' ? 'removes costly manual work' : 'drives new revenue while reducing operator load'}${businessProfile.primaryOffer ? ` around ${businessProfile.primaryOffer.toLowerCase()}` : ''}.`,
    moneyDrivers: businessProfile.moneyDrivers,
    summary:
      sourceMode === 'url'
      ? `Detected a ${businessProfile.categoryLabel.toLowerCase()} ${type} pattern from the supplied website reference.`
        : sourceMode === 'file'
          ? `Detected a ${businessProfile.categoryLabel.toLowerCase()} ${type} pattern from the uploaded source material.`
          : `Detected a ${businessProfile.categoryLabel.toLowerCase()} ${type} pattern from mixed uploaded sources and website references.`,
    assumptions: unique([
      layout === 'sidebar-dashboard' ? 'A dashboard-style layout is likely the strongest starting point.' : '',
      features.includes('auth') ? 'Authentication should be included in the generated product.' : '',
      features.includes('payments') ? 'Billing or checkout flows appear to be required.' : '',
      features.includes('file_uploads') ? 'File or document handling should be included.' : '',
      businessProfile.pains[0] ? `Primary operational pain point: ${businessProfile.pains[0]}` : '',
      businessProfile.moneyDrivers.revenue[0]
        ? `Highest leverage revenue angle: ${businessProfile.moneyDrivers.revenue[0]}.`
        : '',
      businessProfile.moneyDrivers.savings[0]
        ? `Highest leverage efficiency angle: ${businessProfile.moneyDrivers.savings[0]}.`
        : '',
      businessProfile.primaryOffer
        ? `Primary offer/product signal: ${businessProfile.primaryOffer}.`
        : '',
    ]),
    confidence: Number((0.62 + Math.min(features.length, 6) * 0.05).toFixed(2)),
  };
}

export default {
  analyzeInput,
};
