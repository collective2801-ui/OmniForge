import path from 'node:path';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

function normalizeProductName(intent = {}) {
  const rawName =
    typeof intent.projectName === 'string' && intent.projectName.trim().length > 0
      ? intent.projectName.trim()
      : 'OmniForge SaaS';

  return rawName;
}

export function buildBusiness(app = {}) {
  const name =
    typeof app.name === 'string' && app.name.trim().length > 0
      ? app.name.trim()
      : 'OmniForge SaaS';

  return {
    name,
    pricing: ['$19/mo', '$49/mo', '$99/mo'],
    funnel: ['Landing Page', 'Signup', 'Free Trial', 'Paid Conversion'],
    upsells: ['Premium', 'Enterprise'],
  };
}

export function launchBusiness(app = {}) {
  return {
    name: app.name || 'AI SaaS',
    pricing: ['$29/mo', '$79/mo'],
    funnel: ['Landing', 'Signup', 'Trial', 'Conversion'],
    revenueReady: true,
  };
}

function hasFeature(intent, feature) {
  return new Set(intent.features ?? []).has(feature);
}

function buildPricingTiers(intent) {
  const includesPayments = hasFeature(intent, 'payments') || /\bsubscription|billing|payments?\b/i.test(intent.summary ?? '');
  const includesTeams = hasFeature(intent, 'admin_controls') || /\bteam|manager|coach|staff\b/i.test(intent.summary ?? '');

  return [
    {
      name: 'Starter',
      priceMonthly: includesPayments ? 19 : 12,
      target: 'individual users validating the core workflow',
      features: [
        'Core dashboard access',
        'Basic onboarding',
        'Email support',
        includesPayments ? 'Subscription billing support' : 'Foundational product workflow',
      ],
    },
    {
      name: 'Growth',
      priceMonthly: includesTeams ? 59 : 39,
      target: 'growing businesses that need recurring retention features',
      features: [
        'Everything in Starter',
        'Usage analytics',
        'Automation and reminders',
        includesTeams ? 'Team seats and role controls' : 'Priority support',
      ],
      recommended: true,
    },
    {
      name: 'Scale',
      priceMonthly: 149,
      target: 'operators who need advanced controls and expansion levers',
      features: [
        'Everything in Growth',
        'Advanced reporting',
        'Priority implementation support',
        'Custom onboarding and migration assistance',
      ],
    },
  ];
}

function buildFeatureBreakdown(intent) {
  const projectType = intent.projectType ?? 'web_app';

  return {
    core: [
      `${projectType.replace(/_/g, ' ')} customer experience`,
      'Account lifecycle and authentication',
      'Primary dashboard and reporting views',
    ],
    monetization: [
      'Subscription packaging',
      'Upgrade prompts and billing surfaces',
      'Retention triggers tied to usage milestones',
    ],
    expansion: [
      'Referral or invite hooks',
      'Lifecycle email touchpoints',
      'Operator insights for activation and churn prevention',
    ],
  };
}

function buildLandingPageStructure(intent) {
  const productName = normalizeProductName(intent);

  return [
    {
      section: 'hero',
      objective: `Position ${productName} as the fastest path to the promised outcome.`,
    },
    {
      section: 'problem',
      objective: 'Surface the pain, friction, and cost of the current workflow.',
    },
    {
      section: 'solution',
      objective: 'Show the product workflow, dashboard, and automation loop.',
    },
    {
      section: 'pricing',
      objective: 'Present the upgrade path and reduce pricing hesitation.',
    },
    {
      section: 'social-proof',
      objective: 'Add testimonials, usage outcomes, and implementation trust markers.',
    },
    {
      section: 'faq',
      objective: 'Answer objections around setup, data, and switching costs.',
    },
  ];
}

function buildOnboardingFlow(intent) {
  return [
    {
      step: 'Account creation',
      outcome: 'Capture identity, primary use case, and initial intent.',
    },
    {
      step: 'Guided setup',
      outcome: 'Collect the minimum profile or business data needed for a first success moment.',
    },
    {
      step: 'Activation milestone',
      outcome: 'Drive the user to the first dashboard result, plan, or tracked outcome.',
    },
    {
      step: 'Upgrade cue',
      outcome: 'Present paid plan value after the user experiences the first meaningful result.',
    },
    {
      step: 'Retention automation',
      outcome: 'Send reminders, summaries, and progress nudges that reinforce recurring use.',
    },
  ];
}

function buildCompetitorAnalysis(intent) {
  const topic = (intent.summary ?? intent.projectName ?? 'the market').trim();

  return [
    {
      competitorType: 'generalist suites',
      strengths: ['wide feature coverage', 'brand familiarity'],
      weaknesses: ['slow setup', 'bloated workflows'],
      opportunity: `Differentiate by focusing ${topic} around a faster first value moment.`,
    },
    {
      competitorType: 'single-purpose tools',
      strengths: ['clear positioning', 'simple onboarding'],
      weaknesses: ['limited monetization depth', 'shallow analytics'],
      opportunity: 'Win by pairing a focused workflow with premium retention and reporting features.',
    },
    {
      competitorType: 'manual alternatives',
      strengths: ['low cost', 'high familiarity'],
      weaknesses: ['time intensive', 'hard to scale', 'poor accountability'],
      opportunity: 'Translate manual friction into measurable ROI messaging on the landing page.',
    },
  ];
}

async function writeBusinessArtifacts(projectPath, businessModel) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    return [];
  }

  const autonomyDirectory = path.join(projectPath, 'autonomy');
  await ensureDirectory(autonomyDirectory);

  const jsonPath = path.join(autonomyDirectory, 'business-model.json');
  const readmePath = path.join(autonomyDirectory, 'BUSINESS_MODEL.md');

  await writeJsonSafe(jsonPath, businessModel);
  await writeFileSafe(
    readmePath,
    `# Business Model

## Product

${businessModel.productName}

## Subscription Model

${businessModel.subscriptionModel}

## Pricing Tiers

${businessModel.pricingTiers.map((tier) => `- ${tier.name}: $${tier.priceMonthly}/month`).join('\n')}

## Funnel

${businessModel.funnel.map((step) => `- ${step}`).join('\n')}

## Upsells

${businessModel.upsells.map((offer) => `- ${offer}`).join('\n')}

## Landing Page Sections

${businessModel.landingPageStructure.map((section) => `- ${section.section}: ${section.objective}`).join('\n')}

## Onboarding Flow

${businessModel.onboardingFlow.map((step) => `- ${step.step}: ${step.outcome}`).join('\n')}
`,
  );

  return [
    {
      path: 'autonomy/business-model.json',
      absolutePath: jsonPath,
    },
    {
      path: 'autonomy/BUSINESS_MODEL.md',
      absolutePath: readmePath,
    },
  ];
}

export async function buildBusinessModel(intent = {}, options = {}) {
  const productName = normalizeProductName(intent);
  const pricingTiers = buildPricingTiers(intent);
  const businessSummary = buildBusiness({
    name: productName,
  });
  const businessModel = {
    generatedAt: new Date().toISOString(),
    status: 'ready',
    productName,
    pricing: businessSummary.pricing,
    funnel: businessSummary.funnel,
    upsells: businessSummary.upsells,
    pricingTiers,
    subscriptionModel:
      hasFeature(intent, 'payments') || /\bsubscription|billing|payments?\b/i.test(intent.summary ?? '')
        ? 'Monthly recurring subscription with higher-value annual upgrade path.'
        : 'Usage-based free-to-paid upgrade path with recurring premium plan positioning.',
    featureBreakdown: buildFeatureBreakdown(intent),
    landingPageStructure: buildLandingPageStructure(intent),
    onboardingFlow: buildOnboardingFlow(intent),
    competitorAnalysis: buildCompetitorAnalysis(intent),
  };
  const files = await writeBusinessArtifacts(options.projectPath, businessModel);

  return {
    ...businessModel,
    files,
  };
}

export default {
  buildBusiness,
  buildBusinessModel,
  launchBusiness,
};
