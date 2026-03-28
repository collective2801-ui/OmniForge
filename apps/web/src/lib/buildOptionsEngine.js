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

function summarizeFeatures(features = [], maxCount = 5) {
  const selection = unique(features).slice(0, maxCount);
  return selection.length > 0 ? selection.join(', ') : 'core workflows';
}

function buildPrompt(analysis, option) {
  const productType = option.projectType === 'mobile'
    ? 'mobile app'
    : option.projectType === 'website'
      ? 'website'
      : option.projectType === 'commerce'
        ? 'commerce app'
        : 'SaaS app';
  const sourceSummary = analysis.summary || 'Use the analyzed source as the primary product brief.';
  const featureSummary = summarizeFeatures(option.features);
  const pageSummary = Array.isArray(analysis.structure?.pages) && analysis.structure.pages.length > 0
    ? analysis.structure.pages.join(', ')
    : 'home, dashboard, and supporting workflows';
  const componentSummary = Array.isArray(analysis.structure?.components) && analysis.structure.components.length > 0
    ? analysis.structure.components.join(', ')
    : 'navigation, content surfaces, and core actions';

  return [
    `Build a complete ${productType} named ${option.name}.`,
    sourceSummary,
    `Primary direction: ${option.description}`,
    `Include these features: ${featureSummary}.`,
    `Support these pages and flows: ${pageSummary}.`,
    `Use this component emphasis: ${componentSummary}.`,
    'The result must be complete, validated, fully working, previewable, deployment-ready, and publishable.',
  ].join(' ');
}

export function generateBuildOptions(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return [];
  }

  const baseFeatures = unique(analysis.features);
  const sourceLabel = titleCase(analysis.sourceLabel || analysis.type || 'Source');
  const normalizedType = analysis.type === 'application' ? 'saas' : analysis.type;
  const operatorFeatures = unique([
    ...baseFeatures,
    'dashboard',
    'auth',
    'analytics',
  ]);
  const portalFeatures = unique([
    ...baseFeatures,
    'auth',
    'profiles',
    'file_uploads',
  ]);
  const launchFeatures = unique([
    ...baseFeatures.filter((feature) => feature !== 'mobile'),
    'landing_page',
  ]);
  const mobileFeatures = unique([
    ...baseFeatures,
    'mobile',
    'notifications',
  ]);

  const options = [
    {
      id: 'operator-console',
      name: `${sourceLabel} Operator Console`,
      title: `${sourceLabel} Operator Console`,
      description: 'A production SaaS control center with dashboards, admin tooling, and dense operator workflows.',
      summary: 'Best when the source looks like a business tool, portal, or internal workflow system.',
      features: operatorFeatures,
      projectType: normalizedType === 'website' ? 'saas' : normalizedType,
    },
    {
      id: 'client-portal',
      name: `${sourceLabel} Client Portal`,
      title: `${sourceLabel} Client Portal`,
      description: 'A polished customer-facing portal with onboarding, secure login, profile management, and clean workflows.',
      summary: 'Best when the source should become a product customers or clients log into every day.',
      features: portalFeatures,
      projectType: normalizedType === 'mobile' ? 'saas' : normalizedType,
    },
    {
      id: 'launch-platform',
      name: `${sourceLabel} Launch Platform`,
      title: `${sourceLabel} Launch Platform`,
      description: 'A conversion-first launch stack with landing page, signup, pricing, billing, and the minimum app flow needed to ship.',
      summary: 'Best when speed to launch and publishability matter most.',
      features: launchFeatures,
      projectType: normalizedType === 'mobile' ? 'website' : normalizedType,
    },
    {
      id: 'mobile-companion',
      name: `${sourceLabel} Mobile Companion`,
      title: `${sourceLabel} Mobile Companion`,
      description: 'A mobile-first product version that keeps the strongest workflows, simplifies navigation, and is ready for Expo delivery.',
      summary: 'Best when the source should become a phone-first app or companion experience.',
      features: mobileFeatures,
      projectType: 'mobile',
    },
  ];

  return options.map((option) => ({
    ...option,
    prompt: buildPrompt(analysis, option),
  }));
}

export default {
  generateBuildOptions,
};
