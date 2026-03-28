import path from 'node:path';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

function normalizeProductName(product = {}) {
  return (
    product.business?.productName ??
    product.intent?.projectName ??
    product.project?.projectName ??
    'OmniForge Product'
  );
}

export function growthEngine() {
  return {
    ads: true,
    seo: true,
    content: true,
    automation: true,
  };
}

export function optimizeRevenue(business = {}) {
  return {
    ...business,
    optimizedPricing: '$49/mo',
    upsells: ['Pro', 'Enterprise'],
    conversionBoost: true,
  };
}

function buildAdAngles(product = {}) {
  const productName = normalizeProductName(product);

  return [
    `${productName} compresses setup time from hours into a guided onboarding flow.`,
    `${productName} gives users a dashboard that makes progress visible every day.`,
    `${productName} replaces manual tracking with recurring insights and retention prompts.`,
  ];
}

function buildFunnelIdeas(product = {}) {
  return [
    {
      stage: 'lead magnet',
      concept: 'Offer a free calculator, checklist, or benchmark tied to the product promise.',
    },
    {
      stage: 'activation',
      concept: 'Drive users into a fast signup flow that lands on the first dashboard state immediately.',
    },
    {
      stage: 'conversion',
      concept: 'Trigger a pricing comparison after the first success milestone or automated insight.',
    },
    {
      stage: 'retention',
      concept: 'Send weekly progress summaries with a clear return path into the product.',
    },
  ];
}

function buildSeoPlan(product = {}) {
  const productName = normalizeProductName(product);

  return {
    pillarPages: [
      `${productName} overview`,
      `${productName} pricing`,
      `${productName} alternatives`,
      `${productName} use cases`,
    ],
    contentClusters: [
      'problem-aware educational content',
      'comparison pages against broad competitors',
      'workflow templates and calculators',
      'customer story and case study content',
    ],
    technicalFocus: [
      'Schema markup for product, faq, and reviews',
      'Fast landing page performance and crawlable pricing content',
      'Internal links from educational articles to signup and demo flows',
    ],
  };
}

function buildUgcContentScripts(product = {}) {
  const productName = normalizeProductName(product);

  return [
    {
      hook: `I tested ${productName} for 7 days to replace my manual workflow.`,
      body: 'Show the before-and-after workflow, the dashboard view, and the speed of first setup.',
      callToAction: 'Invite viewers to try the same workflow with the free or starter plan.',
    },
    {
      hook: `This app fixed the most annoying part of staying consistent.`,
      body: 'Demonstrate onboarding, the daily dashboard, and a small but tangible progress moment.',
      callToAction: 'Send viewers to the landing page and pricing page.',
    },
    {
      hook: 'Here is the SaaS stack I would use if I had to launch again this week.',
      body: 'Frame the product as the operator shortcut: signup, insight, and monetization in one system.',
      callToAction: 'Push to a demo or guided signup flow.',
    },
  ];
}

async function writeGrowthArtifacts(projectPath, growthPlan) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const autonomyDirectory = path.join(projectPath, 'autonomy');
  await ensureDirectory(autonomyDirectory);

  const jsonPath = path.join(autonomyDirectory, 'growth-plan.json');
  const readmePath = path.join(autonomyDirectory, 'GROWTH_PLAN.md');

  await writeJsonSafe(jsonPath, growthPlan);
  await writeFileSafe(
    readmePath,
    `# Growth Plan

## Ad Angles

${growthPlan.adAngles.map((angle) => `- ${angle}`).join('\n')}

## Growth Systems

- Ads: ${growthPlan.ads ? 'enabled' : 'disabled'}
- SEO: ${growthPlan.seo ? 'enabled' : 'disabled'}
- Content: ${growthPlan.content ? 'enabled' : 'disabled'}
- Automation: ${growthPlan.automation ? 'enabled' : 'disabled'}

## Funnel Ideas

${growthPlan.funnelIdeas.map((idea) => `- ${idea.stage}: ${idea.concept}`).join('\n')}

## SEO Focus

${growthPlan.seoPlan.pillarPages.map((page) => `- ${page}`).join('\n')}

## UGC Scripts

${growthPlan.ugcContentScripts.map((script) => `- ${script.hook}`).join('\n')}
`,
  );

  return [
    {
      path: 'autonomy/growth-plan.json',
      absolutePath: jsonPath,
    },
    {
      path: 'autonomy/GROWTH_PLAN.md',
      absolutePath: readmePath,
    },
  ];
}

export async function generateGrowthPlan(product = {}, options = {}) {
  const growthCapabilities = growthEngine();
  const growthPlan = {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    productName: normalizeProductName(product),
    ...growthCapabilities,
    adAngles: buildAdAngles(product),
    funnelIdeas: buildFunnelIdeas(product),
    seoPlan: buildSeoPlan(product),
    ugcContentScripts: buildUgcContentScripts(product),
  };
  const files = await writeGrowthArtifacts(options.projectPath, growthPlan);

  return {
    ...growthPlan,
    files,
  };
}

export default {
  growthEngine,
  optimizeRevenue,
  generateGrowthPlan,
};
