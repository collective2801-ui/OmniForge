function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function titleCase(value = '') {
  return String(value)
    .split(/[^a-zA-Z0-9]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function truncateLabel(value = '', maxLength = 26) {
  const normalized = String(value).trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(value = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function encodePreviewSvg(svg = '') {
  if (typeof Buffer !== 'undefined') {
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }

  if (typeof btoa === 'function') {
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function getBusinessTerms(profile = {}) {
  switch (profile.category) {
    case 'healthcare':
      return {
        lead: 'referral',
        client: 'patient',
        operator: 'care team',
        output: 'program outcome',
      };
    case 'legal':
      return {
        lead: 'intake',
        client: 'client',
        operator: 'case team',
        output: 'case progress',
      };
    case 'home_services':
      return {
        lead: 'quote request',
        client: 'homeowner',
        operator: 'dispatch team',
        output: 'job status',
      };
    case 'real_estate':
      return {
        lead: 'buyer lead',
        client: 'buyer or seller',
        operator: 'agent team',
        output: 'deal progress',
      };
    case 'commerce':
      return {
        lead: 'shopper',
        client: 'customer',
        operator: 'merchandising team',
        output: 'order flow',
      };
    case 'education':
      return {
        lead: 'enrollment lead',
        client: 'student',
        operator: 'program staff',
        output: 'student progress',
      };
    case 'hospitality':
      return {
        lead: 'guest inquiry',
        client: 'guest',
        operator: 'operations team',
        output: 'reservation flow',
      };
    default:
      return {
        lead: 'inbound lead',
        client: 'customer',
        operator: 'operations team',
        output: 'workflow progress',
      };
  }
}

function getIdeaAnchors(profile = {}, terms = {}) {
  const offers = Array.isArray(profile.offerNames) ? profile.offerNames.filter(Boolean) : [];
  const contentThemes = Array.isArray(profile.contentThemes) ? profile.contentThemes.filter(Boolean) : [];
  const keywords = Array.isArray(profile.keywords) ? profile.keywords.filter(Boolean) : [];
  const primaryOffer = titleCase(offers[0] || profile.primaryOffer || keywords[0] || terms.output || 'Core Workflow');
  const secondaryOffer = titleCase(offers[1] || keywords[1] || `${primaryOffer} Delivery`);
  const contentAnchor = titleCase(contentThemes[0] || offers[2] || keywords[2] || `${primaryOffer} Education`);
  const commerceAnchor = titleCase(offers[3] || keywords[3] || primaryOffer);

  return {
    primaryOffer,
    secondaryOffer,
    contentAnchor,
    commerceAnchor,
  };
}

function getOfferLabel(moneyType = 'hybrid') {
  switch (moneyType) {
    case 'growth':
      return 'Revenue growth';
    case 'efficiency':
      return 'Cost savings';
    default:
      return 'Revenue + savings';
  }
}

function getProjectionBase(scale = 'local') {
  switch (scale) {
    case 'expanding':
      return {
        growth: [9000, 28000],
        efficiency: [5000, 16000],
        hybrid: [12000, 36000],
      };
    case 'growing':
      return {
        growth: [3500, 12000],
        efficiency: [2200, 8000],
        hybrid: [5000, 16000],
      };
    default:
      return {
        growth: [1400, 5200],
        efficiency: [900, 3400],
        hybrid: [2400, 7600],
      };
  }
}

function createCashFlowProjection(profile = {}, moneyType = 'hybrid', basis = '') {
  const baseRange = getProjectionBase(profile.scale)[moneyType] ?? getProjectionBase(profile.scale).hybrid;
  const [monthlyLow, monthlyHigh] = baseRange;

  return {
    monthlyLow,
    monthlyHigh,
    annualLow: monthlyLow * 12,
    annualHigh: monthlyHigh * 12,
    monthlyLabel: `${formatCurrency(monthlyLow)}-${formatCurrency(monthlyHigh)}/mo`,
    annualLabel: `${formatCurrency(monthlyLow * 12)}-${formatCurrency(monthlyHigh * 12)}/yr`,
    basis,
  };
}

function buildPreviewDataUrl({
  name = 'Product',
  projectType = 'saas',
  moneyType = 'hybrid',
  featureList = [],
} = {}) {
  const palette =
    moneyType === 'growth'
      ? ['#0a0a0a', '#1d4ed8', '#60a5fa']
      : moneyType === 'efficiency'
        ? ['#0a0a0a', '#15803d', '#4ade80']
        : ['#0a0a0a', '#7c3aed', '#22c55e'];
  const chromeLabel = projectType === 'mobile' ? 'Mobile product' : 'Web product';
  const features = featureList.slice(0, 3).map((feature, index) => `
    <g transform="translate(34 ${148 + index * 52})">
      <rect width="254" height="34" rx="12" fill="rgba(255,255,255,0.06)" />
      <circle cx="18" cy="17" r="5" fill="${palette[2]}" />
      <text x="36" y="22" fill="#dbeafe" font-size="12" font-family="IBM Plex Sans, Arial, sans-serif">${escapeXml(feature)}</text>
    </g>
  `).join('');
  const appFrame = projectType === 'mobile'
    ? `
      <rect x="360" y="52" width="196" height="296" rx="36" fill="#05070d" stroke="rgba(255,255,255,0.14)" />
      <rect x="424" y="66" width="68" height="16" rx="999" fill="rgba(255,255,255,0.08)" />
      <rect x="378" y="96" width="160" height="236" rx="26" fill="rgba(10,16,28,0.96)" />
      <rect x="394" y="118" width="128" height="70" rx="22" fill="rgba(96,165,250,0.22)" />
      <rect x="394" y="206" width="128" height="22" rx="10" fill="rgba(255,255,255,0.08)" />
      <rect x="394" y="240" width="128" height="22" rx="10" fill="rgba(255,255,255,0.08)" />
      <rect x="394" y="278" width="60" height="28" rx="14" fill="${palette[1]}" opacity="0.9" />
    `
    : `
      <rect x="326" y="70" width="274" height="250" rx="28" fill="rgba(5,8,14,0.98)" stroke="rgba(255,255,255,0.08)" />
      <rect x="346" y="92" width="234" height="24" rx="12" fill="rgba(255,255,255,0.08)" />
      <rect x="346" y="134" width="146" height="76" rx="20" fill="rgba(96,165,250,0.16)" />
      <rect x="506" y="134" width="74" height="76" rx="20" fill="${palette[1]}" opacity="0.86" />
      <rect x="346" y="228" width="234" height="18" rx="9" fill="rgba(255,255,255,0.07)" />
      <rect x="346" y="260" width="190" height="18" rx="9" fill="rgba(255,255,255,0.07)" />
      <rect x="346" y="292" width="118" height="18" rx="9" fill="rgba(255,255,255,0.07)" />
    `;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400" fill="none">
      <defs>
        <linearGradient id="frame" x1="0" y1="0" x2="640" y2="400" gradientUnits="userSpaceOnUse">
          <stop stop-color="${palette[1]}" stop-opacity="0.34"/>
          <stop offset="1" stop-color="${palette[2]}" stop-opacity="0.18"/>
        </linearGradient>
      </defs>
      <rect width="640" height="400" rx="32" fill="${palette[0]}"/>
      <rect x="16" y="16" width="608" height="368" rx="24" fill="url(#frame)" opacity="0.55"/>
      <rect x="24" y="24" width="592" height="60" rx="20" fill="rgba(8,12,20,0.94)"/>
      <text x="40" y="58" fill="#f8fafc" font-size="25" font-weight="700" font-family="IBM Plex Sans, Arial, sans-serif">${escapeXml(name)}</text>
      <text x="464" y="58" fill="#93c5fd" font-size="14" font-family="IBM Plex Sans, Arial, sans-serif">${escapeXml(chromeLabel)}</text>
      <rect x="24" y="108" width="276" height="244" rx="28" fill="rgba(5,8,14,0.88)" stroke="rgba(255,255,255,0.06)"/>
      <text x="34" y="134" fill="#e2e8f0" font-size="13" font-family="IBM Plex Sans, Arial, sans-serif">Featured workflows</text>
      ${features}
      ${appFrame}
      <text x="24" y="376" fill="#9fb0cf" font-size="12" font-family="IBM Plex Sans, Arial, sans-serif">OmniForge product concept preview</text>
    </svg>
  `;

  return encodePreviewSvg(svg);
}

function mergeFeatures(baseFeatures = [], extraFeatures = []) {
  return unique([...baseFeatures, ...extraFeatures]);
}

function createPrompt(analysis, option) {
  const profile = analysis.businessProfile ?? {};
  const pains = Array.isArray(profile.pains) ? profile.pains.slice(0, 3).join(' ') : '';
  const featureSummary = Array.isArray(option.featureList)
    ? option.featureList.join(', ')
    : option.features.join(', ');
  const offerSummary = Array.isArray(profile.offerNames) && profile.offerNames.length > 0
    ? `Website products/services detected: ${profile.offerNames.join(', ')}.`
    : '';
  const contentSummary = Array.isArray(profile.contentThemes) && profile.contentThemes.length > 0
    ? `Content themes detected: ${profile.contentThemes.join(', ')}.`
    : '';

  return [
    `Build a complete ${option.projectType === 'mobile' ? 'mobile app' : 'web app'} named ${option.name}.`,
    `Business context: ${analysis.summary}`,
    profile.categoryLabel ? `Business category: ${profile.categoryLabel}.` : '',
    profile.businessModel ? `Business model: ${profile.businessModel}.` : '',
    profile.audience ? `Primary users: ${profile.audience}.` : '',
    offerSummary,
    contentSummary,
    pains ? `Problems this product must solve: ${pains}` : '',
    `Product concept: ${option.description}`,
    `Why this matters: ${option.usefulness}`,
    `Business impact: ${option.businessImpact}`,
    `Cash-flow target: ${option.cashFlowProjection.monthlyLabel} projected impact, based on ${option.cashFlowProjection.basis}.`,
    `Implement these workflows completely: ${featureSummary}.`,
    'The finished product must be fully working, previewable, validated, deployable, and must do exactly what the product concept promises in the UI card.',
  ]
    .filter(Boolean)
    .join(' ');
}

function createIdeasForProfile(sourceLabel, analysis) {
  const profile = analysis.businessProfile ?? {};
  const terms = getBusinessTerms(profile);
  const anchors = getIdeaAnchors(profile, terms);
  const baseFeatures = unique(analysis.features ?? []);
  const normalizedLabel = truncateLabel(sourceLabel);
  const primaryNeeds = {
    revenue: profile.moneyDrivers?.revenue?.[0] ?? `capture more ${terms.lead}s and turn them into revenue`,
    savings: profile.moneyDrivers?.savings?.[0] ?? 'reduce manual admin and operator overhead',
  };

  const options = [
    {
      id: 'revenue-engine',
      name: `${anchors.primaryOffer} Revenue Engine`,
      audienceLabel: normalizedLabel,
      description: `A standalone software product that turns ${anchors.primaryOffer.toLowerCase()} demand into qualified ${terms.lead.toLowerCase()}s, booked work, and repeat revenue without depending on the website itself.`,
      usefulness: `Useful because it productizes the site’s main offer into an always-on conversion system instead of relying on forms, callbacks, or manual follow-up.`,
      businessImpact: `This should raise conversion speed, improve close rate, and give the ${terms.operator} one place to manage ${anchors.primaryOffer.toLowerCase()} demand end to end.`,
      featureList: [
        `${anchors.primaryOffer} intake and qualification`,
        `AI scoring for every ${terms.lead}`,
        `${anchors.primaryOffer} booking or activation flow`,
        'pipeline view with next-best action prompts',
        'follow-up automation across email, SMS, or in-app notifications',
        'quote, booking, or plan activation handoff',
      ],
      features: mergeFeatures(baseFeatures, ['crm', 'auth', 'dashboard', 'notifications']),
      projectType: 'saas',
      moneyType: 'growth',
      basis: primaryNeeds.revenue,
    },
    {
      id: 'ops-os',
      name: `${anchors.secondaryOffer} Operations Hub`,
      audienceLabel: normalizedLabel,
      description: `An internal operations system built around delivering ${anchors.secondaryOffer.toLowerCase()} with fewer staff handoffs and less manual coordination.`,
      usefulness: `Useful because it turns the website’s real delivery workflow into an independent operating system the team can run the business from.`,
      businessImpact: `This should cut labor waste, reduce dropped handoffs, and make ${anchors.secondaryOffer.toLowerCase()} execution measurable in real time.`,
      featureList: [
        `${anchors.secondaryOffer} job or case board`,
        'role-based operator workspace',
        'queue and task orchestration',
        'real-time status dashboard',
        'document, upload, or checklist handling',
        'alerts for bottlenecks and missed SLAs',
      ],
      features: mergeFeatures(baseFeatures, ['dashboard', 'auth', 'file_uploads', 'analytics']),
      projectType: 'saas',
      moneyType: 'efficiency',
      basis: primaryNeeds.savings,
    },
    {
      id: 'client-portal',
      name: `${anchors.primaryOffer} Client Portal`,
      audienceLabel: normalizedLabel,
      description: `A standalone client-facing portal where each ${terms.client.toLowerCase()} can log in, manage ${anchors.primaryOffer.toLowerCase()} steps, and track progress without needing staff intervention.`,
      usefulness: `Useful because it wraps the website’s core offer inside a self-serve product experience that increases retention and reduces support interruptions.`,
      businessImpact: `This should improve repeat engagement, reduce support volume, and create a durable account-based relationship around ${anchors.primaryOffer.toLowerCase()}.`,
      featureList: [
        `${titleCase(terms.client)} login and profile`,
        `${anchors.primaryOffer} self-serve workflow`,
        'self-serve forms, updates, and uploads',
        'progress timeline or status tracking',
        'billing or subscription access if needed',
        'notifications and action reminders',
      ],
      features: mergeFeatures(baseFeatures, ['auth', 'profiles', 'file_uploads', 'notifications']),
      projectType: baseFeatures.includes('mobile') ? 'mobile' : 'saas',
      moneyType: 'hybrid',
      basis: 'stronger retention plus lower support workload',
    },
    {
      id: 'profit-intelligence',
      name: `${anchors.contentAnchor} Growth Studio`,
      audienceLabel: normalizedLabel,
      description: `An AI product that turns the site’s content, expertise, and offer signals into new standalone revenue streams, upsells, and automation opportunities.`,
      usefulness: `Useful because it monetizes what the business already talks about on the website, but packages it into a software product that operates independently.`,
      businessImpact: `This should surface upsell opportunities, identify margin leaks, and create new software-led revenue around ${anchors.contentAnchor.toLowerCase()}.`,
      featureList: [
        `${anchors.contentAnchor} offer builder`,
        'AI opportunity scoring dashboard',
        'offer or upsell recommendation engine',
        'cash-flow and conversion forecasting',
        'campaign or reactivation playbooks',
        'operator reporting with weekly action plans',
      ],
      features: mergeFeatures(baseFeatures, ['dashboard', 'analytics', 'ai', 'payments']),
      projectType: 'saas',
      moneyType: 'hybrid',
      basis: 'better upsells, reactivation, and margin decisions',
    },
  ];

  return options.map((option) => {
    const cashFlowProjection = createCashFlowProjection(profile, option.moneyType, option.basis);

    return {
      ...option,
      title: option.name,
      summary: option.description,
      moneyLabel: getOfferLabel(option.moneyType),
      cashFlowProjection,
      preview: {
        imageUrl: buildPreviewDataUrl({
          name: `${option.audienceLabel} ${option.name}`,
          projectType: option.projectType,
          moneyType: option.moneyType,
          featureList: option.featureList,
        }),
        alt: `${option.name} concept preview`,
      },
    };
  });
}

export function generateBuildOptions(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return [];
  }

  const sourceLabel = titleCase(analysis.sourceLabel || analysis.businessProfile?.categoryLabel || analysis.type || 'Source');

  return createIdeasForProfile(sourceLabel, analysis).map((option) => ({
    ...option,
    prompt: createPrompt(analysis, option),
  }));
}

export default {
  generateBuildOptions,
};
