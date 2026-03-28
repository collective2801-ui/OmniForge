function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function truncate(value, limit) {
  const normalizedValue = String(value || '').trim();

  if (normalizedValue.length <= limit) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
}

function resolveAppName(intent = {}) {
  if (typeof intent.projectName === 'string' && intent.projectName.trim().length > 0) {
    return titleCase(intent.projectName.trim());
  }

  const summaryMatch = String(intent.summary ?? '')
    .match(/build(?: and deploy)? (?:a|an)?\s*(.+?)(?: with| for|$)/i);

  if (summaryMatch?.[1]) {
    return titleCase(summaryMatch[1]);
  }

  return 'OmniForge Mobile App';
}

function resolveCategory(intent = {}) {
  const featureSet = new Set(intent.features ?? []);
  const summary = String(intent.summary ?? '');

  if (featureSet.has('payments') || /fintech|wallet|bank|billing|subscription/i.test(summary)) {
    return 'Finance';
  }

  if (featureSet.has('dashboard') || /dashboard|analytics|admin|workspace/i.test(summary)) {
    return 'Business';
  }

  if (featureSet.has('file_uploads')) {
    return 'Productivity';
  }

  return 'Utilities';
}

function buildFeatureLine(features = []) {
  if (!Array.isArray(features) || features.length === 0) {
    return 'core workflows';
  }

  return features.join(', ');
}

function buildShortDescription(appName, intent) {
  const featureLine = buildFeatureLine(intent.features ?? []);
  return truncate(`${appName} helps teams manage ${featureLine} from a secure mobile workspace.`, 80);
}

function buildFullDescription(appName, intent) {
  const featureLine = buildFeatureLine(intent.features ?? []);
  const productType = intent.projectType ?? 'application';

  return [
    `${appName} is a ${productType.replace(/_/g, ' ')} designed to bring ${featureLine} into a focused mobile experience.`,
    'The app is structured for fast onboarding, secure account flows, and reliable day-to-day execution on both iOS and Android.',
    'Users can move from authentication to their primary dashboard, operational workflows, and billing or account actions without leaving the app shell.',
    'This release is prepared for scalable growth, store submission, and future native feature expansion using Expo and React Native.',
  ].join('\n\n');
}

function buildKeywords(appName, intent, category) {
  return dedupeStrings([
    slugify(appName).replace(/-/g, ' '),
    category.toLowerCase(),
    ...(intent.features ?? []).map((feature) => feature.replace(/_/g, ' ')),
    'mobile app',
    'ios',
    'android',
    'expo',
    'react native',
  ]).slice(0, 12);
}

function buildPrivacyPolicy(appName, intent, category) {
  const featureLine = buildFeatureLine(intent.features ?? []);

  return `# ${appName} Privacy Policy

${appName} respects user privacy and is designed to minimize unnecessary data collection.

## Information We Collect

We collect only the information required to operate the ${category.toLowerCase()} experience, including account credentials, profile information, usage events, and content directly submitted through ${featureLine}.

## How Information Is Used

Collected data is used to authenticate users, operate application features, improve stability, support customer requests, prevent fraud, and comply with legal obligations.

## Third-Party Services

When enabled, payment, authentication, storage, analytics, and deployment providers may process limited data on behalf of ${appName}. Each provider is expected to maintain its own privacy and security controls.

## Data Retention

User data is retained only for as long as needed to provide the service, satisfy contractual obligations, resolve disputes, and meet regulatory requirements.

## User Rights

Users may request access, correction, export, or deletion of eligible personal data, subject to account integrity, fraud prevention, and legal retention requirements.

## Security

${appName} uses secure transport, access controls, and least-privilege service design to reduce unauthorized access risks.

## Contact

Privacy questions may be directed to support@omniforge.local until a project-specific support address is configured.`;
}

function buildReleaseNotes(intent) {
  const features = intent.features ?? [];
  const notableItems = [
    'Initial mobile release scaffolded with Expo for iOS and Android.',
    features.includes('auth')
      ? 'Added secure login and account session flow.'
      : 'Added secure session-ready application shell.',
    features.includes('payments')
      ? 'Prepared mobile billing and payment experience.'
      : 'Prepared account and workflow navigation structure.',
    features.includes('dashboard')
      ? 'Included dashboard-first navigation and overview surfaces.'
      : 'Included primary workflow and settings surfaces.',
  ];

  return notableItems.join('\n');
}

export function generateAppMetadata(intent = {}) {
  const appName = resolveAppName(intent);
  const category = resolveCategory(intent);

  return {
    generatedAt: new Date().toISOString(),
    name: appName,
    slug: slugify(appName) || 'omniforge-mobile-app',
    shortDescription: buildShortDescription(appName, intent),
    description: buildFullDescription(appName, intent),
    keywords: buildKeywords(appName, intent, category),
    category,
    privacyPolicy: buildPrivacyPolicy(appName, intent, category),
    releaseNotes: buildReleaseNotes(intent),
  };
}

export default {
  generateAppMetadata,
};
