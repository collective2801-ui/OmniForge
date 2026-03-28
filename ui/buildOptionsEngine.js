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

function summarizeFeatures(features = [], maxCount = 4) {
  const selection = unique(features).slice(0, maxCount);
  return selection.length > 0 ? selection.join(', ') : 'core application flows';
}

function buildPrompt(analysis, variant) {
  const productType = analysis.type === 'saas'
    ? 'SaaS product'
    : analysis.type === 'website'
      ? 'website'
      : analysis.type === 'mobile'
        ? 'mobile app'
        : analysis.type === 'commerce'
          ? 'commerce platform'
          : 'software product';
  const featureSummary = summarizeFeatures(analysis.features);
  const pageSummary = Array.isArray(analysis.structure?.pages) && analysis.structure.pages.length > 0
    ? analysis.structure.pages.join(', ')
    : 'home and primary workflows';
  const componentSummary = Array.isArray(analysis.structure?.components) && analysis.structure.components.length > 0
    ? analysis.structure.components.join(', ')
    : 'a clean application shell';
  const sourceSummary = analysis.summary || 'Use the analyzed source material as the primary brief.';
  const qualityInstruction =
    'Make the result complete, working, validated, and publishable with resolved imports, working routes, preview output, and deployment readiness.';

  if (variant === 'modern') {
    return `Build a modern ${productType} based on the analyzed input. ${sourceSummary} Include ${featureSummary}, use a ${analysis.structure?.layout || 'clean'} layout, cover ${pageSummary}, and structure the UI around ${componentSummary}. ${qualityInstruction}`;
  }

  if (variant === 'cursor') {
    return `Build a powerful operator-focused ${productType} inspired by the analyzed input. Keep the workflows sharp, emphasize control panels, data density, and professional tooling, and include ${featureSummary}. Cover ${pageSummary}. ${qualityInstruction}`;
  }

  if (variant === 'launch') {
    return `Build the leanest high-conversion launch-ready version of this ${productType} using the analyzed source input. Prioritize the most valuable flows, onboarding, and ${featureSummary}. Keep the interface polished and ready to publish. ${qualityInstruction}`;
  }

  return `Build a mobile-first adaptation of the analyzed ${productType}. Preserve the important workflows, keep ${featureSummary}, simplify navigation, and make the result complete and publishable. ${qualityInstruction}`;
}

export function generateBuildOptions(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return [];
  }

  const label = titleCase(analysis.sourceLabel || analysis.type || 'Source');
  const baseFeatures = unique(analysis.features);
  const options = [
    {
      id: 'modern-saas',
      name: `Modern ${label}`,
      title: `Modern ${label}`,
      description: 'A polished production-ready app with clean structure, strong UX, and the full working flow.',
      summary: 'A polished production-ready app with clean structure, strong UX, and the full working flow.',
      features: baseFeatures,
      prompt: buildPrompt(analysis, 'modern'),
      projectType: analysis.type,
    },
    {
      id: 'operator-console',
      name: `Operator Console for ${label}`,
      title: `Operator Console for ${label}`,
      description: 'A denser control-panel version with dashboards, admin workflows, and pro tooling.',
      summary: 'A denser control-panel version with dashboards, admin workflows, and pro tooling.',
      features: unique([...baseFeatures, 'dashboard']),
      prompt: buildPrompt(analysis, 'cursor'),
      projectType: analysis.type === 'website' ? 'saas' : analysis.type,
    },
    {
      id: 'launch-mvp',
      name: `Launch MVP for ${label}`,
      title: `Launch MVP for ${label}`,
      description: 'The leanest publishable version focused on fast delivery, onboarding, and conversion.',
      summary: 'The leanest publishable version focused on fast delivery, onboarding, and conversion.',
      features: unique(baseFeatures.filter((feature) => feature !== 'mobile')),
      prompt: buildPrompt(analysis, 'launch'),
      projectType: analysis.type,
    },
  ];

  if (analysis.type !== 'mobile') {
    options.push({
      id: 'mobile-adaptation',
      name: `Mobile-first ${label}`,
      title: `Mobile-first ${label}`,
      description: 'A mobile-shaped product version that keeps the strongest flows and simplifies navigation.',
      summary: 'A mobile-shaped product version that keeps the strongest flows and simplifies navigation.',
      features: unique([...baseFeatures, 'mobile']),
      prompt: buildPrompt(analysis, 'mobile'),
      projectType: 'mobile',
    });
  }

  return options.slice(0, 4);
}

export default {
  generateBuildOptions,
};
