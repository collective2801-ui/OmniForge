function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeHostname(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function summarizeCounts(scraped = {}) {
  return {
    links: Array.isArray(scraped.links) ? scraped.links.length : 0,
    buttons: Array.isArray(scraped.buttons) ? scraped.buttons.length : 0,
    forms: Number(scraped.forms ?? 0),
    inputs: Number(scraped.inputs ?? 0),
    images: Array.isArray(scraped.images) ? scraped.images.length : 0,
  };
}

export function analyzeBusiness(html) {
  return {
    products: detectProducts(html),
    pricing: detectPricing(html),
    audience: detectAudience(html),
    model: detectBusinessModel(html),
    content: detectContent(html),
  };
}

export function detectProducts(html) {
  return String(html).includes('course') ? ['courses'] : ['services'];
}

export function detectPricing(html) {
  const source = String(html);

  if (source.includes('$')) {
    return 'paid';
  }

  if (source.includes('subscription')) {
    return 'subscription';
  }

  return 'unknown';
}

export function detectAudience(html) {
  return String(html).includes('fitness') ? 'health-conscious users' : 'general users';
}

export function detectBusinessModel(html) {
  return String(html).includes('membership') ? 'recurring' : 'one-time';
}

export function detectContent(html) {
  return ['education', 'guides', 'tips'];
}

export function extractBusinessIntelligence({
  url = '',
  scraped = {},
  analysis = {},
} = {}) {
  const counts = summarizeCounts(scraped);
  const businessAnalysis = analyzeBusiness(scraped.html ?? '');
  const primaryFeature = Array.isArray(analysis.features) && analysis.features.length > 0
    ? analysis.features[0]
    : 'general workflow';
  const audience =
    businessAnalysis.audience !== 'general users'
      ? businessAnalysis.audience
      : primaryFeature === 'payments'
      ? 'operators monetizing recurring customer workflows'
      : primaryFeature === 'auth'
        ? 'member-based products that need retained accounts'
        : primaryFeature === 'dashboard'
          ? 'teams that need visibility and control'
          : 'users who need a simpler digital workflow';

  return {
    source: normalizeHostname(url),
    audience,
    signals: {
      interactiveDensity: counts.buttons + counts.forms + counts.inputs,
      contentDensity: counts.links + counts.images,
      featureCount: Array.isArray(analysis.features) ? analysis.features.length : 0,
    },
    structure: {
      ...counts,
      layout: analysis.structure?.layout ?? 'application-shell',
    },
    products: businessAnalysis.products,
    pricing: businessAnalysis.pricing,
    businessModel: businessAnalysis.model,
    content: businessAnalysis.content,
    summary: `Detected ${unique(analysis.features ?? []).join(', ') || 'general application'} opportunities for ${audience} with a ${businessAnalysis.model} ${businessAnalysis.pricing} model.`,
  };
}

export function findMonetizationOpportunities({
  analysis = {},
  businessIntelligence = {},
} = {}) {
  const features = unique(analysis.features ?? []);
  const opportunities = [];

  opportunities.push({
    type: 'subscription',
    label: 'Recurring subscription revenue',
    rationale: 'Package the core workflow into monthly plans with tiered access.',
  });

  if (features.includes('payments') || features.includes('ecommerce')) {
    opportunities.push({
      type: 'transactional',
      label: 'Transaction and checkout revenue',
      rationale: 'Convert existing buyer intent into processed payments and premium upgrades.',
    });
  }

  if (features.includes('dashboard') || businessIntelligence.audience?.includes('teams')) {
    opportunities.push({
      type: 'b2b',
      label: 'Operator and team plans',
      rationale: 'Offer higher-priced team access with reporting, controls, and shared workflows.',
    });
  }

  opportunities.push({
    type: 'services',
    label: 'Done-for-you implementation',
    rationale: 'Pair software with setup, onboarding, and optimization services.',
  });

  return opportunities.slice(0, 4);
}

export function inventSoftwareIdeas({
  analysis = {},
  businessIntelligence = {},
  monetizationOpportunities = [],
} = {}) {
  return generateProducts({
    analysis,
    businessIntelligence,
    monetizationOpportunities,
  }).map((product, index) => ({
    id: `product-${index + 1}`,
    name: product.name,
    description: product.description,
    features: unique([
      ...(Array.isArray(product.features) ? product.features : []),
      ...(Array.isArray(analysis.features) ? analysis.features : []),
    ]),
    type: product.type,
    monetization: product.monetization,
    value: product.value,
    standalone: true,
    prompt: `Build a full production-ready ${product.type} named "${product.name}". ${product.description}. Include ${product.features.join(', ')}. Deliver it as a complete, validated, deployable product.`,
    revenueModel:
      product.monetization ||
      monetizationOpportunities[index]?.label ||
      monetizationOpportunities[0]?.label ||
      'Recurring subscription revenue',
  }));
}

export function generateProducts(business) {
  return [
    buildProduct1(business),
    buildProduct2(business),
    buildProduct3(business),
    buildProduct4(business),
  ];
}

export function buildProduct1(business) {
  return {
    name: 'AI Food Scanner App',
    type: 'mobile app',
    description: 'Scan food → get health score + ingredient breakdown + alternatives',
    features: [
      'barcode scanner',
      'ingredient analysis',
      'health scoring',
      'alternative suggestions',
    ],
    monetization: 'subscription',
    value: 'helps users make healthier choices instantly',
  };
}

export function buildProduct2(business) {
  return {
    name: 'Personal Nutrition Coach SaaS',
    type: 'web app',
    description: 'AI-driven meal planning + tracking system',
    features: [
      'meal planner',
      'macro tracking',
      'AI recommendations',
    ],
    monetization: 'monthly subscription',
    value: 'increases user retention and recurring revenue',
  };
}

export function buildProduct3(business) {
  return {
    name: 'Supplement Recommendation Engine',
    type: 'web tool',
    description: 'Recommends supplements based on goals',
    features: [
      'goal input',
      'AI recommendations',
      'product integration',
    ],
    monetization: 'affiliate + sales',
    value: 'adds new revenue stream',
  };
}

export function buildProduct4(business) {
  return {
    name: 'Health Content Automation Platform',
    type: 'backend SaaS',
    description: 'Auto-generates health content for marketing',
    features: [
      'content generator',
      'SEO optimization',
      'auto publishing',
    ],
    monetization: 'subscription',
    value: 'saves time + drives traffic',
  };
}

export function lockSpec(ideas = [], selection = null) {
  if (!Array.isArray(ideas) && ideas && typeof ideas === 'object' && selection === null) {
    return {
      name: ideas.name,
      features: ideas.features,
      behavior: ideas.description,
      monetization: ideas.monetization,
    };
  }

  const normalizedIdeas = Array.isArray(ideas) ? ideas : [];
  let selectedIdea = null;

  if (typeof selection === 'number') {
    selectedIdea = normalizedIdeas[selection] ?? null;
  } else if (typeof selection === 'string') {
    selectedIdea = normalizedIdeas.find(
      (idea) => idea.id === selection || idea.name === selection,
    ) ?? null;
  } else if (selection && typeof selection === 'object') {
    selectedIdea = normalizedIdeas.find(
      (idea) => idea.id === selection.id || idea.name === selection.name,
    ) ?? selection;
  }

  if (!selectedIdea) {
    throw new Error('A valid idea selection is required before locking the spec.');
  }

  return {
    ...lockSpec(selectedIdea),
    id: selectedIdea.id,
    prompt: selectedIdea.prompt,
    standalone: true,
    revenueModel: selectedIdea.revenueModel ?? 'Recurring subscription revenue',
    lockedAt: new Date().toISOString(),
    specLocked: true,
  };
}

export default {
  analyzeBusiness,
  detectProducts,
  detectPricing,
  detectAudience,
  detectBusinessModel,
  detectContent,
  extractBusinessIntelligence,
  findMonetizationOpportunities,
  inventSoftwareIdeas,
  generateProducts,
  buildProduct1,
  buildProduct2,
  buildProduct3,
  buildProduct4,
  lockSpec,
};
