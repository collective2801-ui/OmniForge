import path from 'node:path';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

function assertProject(project) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('Project payload is required for store submission preparation.');
  }

  if (typeof project.projectPath !== 'string' || project.projectPath.trim().length === 0) {
    throw new TypeError('Project payload must include a projectPath.');
  }
}

function assertMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new TypeError('App metadata is required for store submission preparation.');
  }

  if (typeof metadata.name !== 'string' || metadata.name.trim().length === 0) {
    throw new TypeError('App metadata must include a name.');
  }
}

async function emitProgress(onProgress, type, payload = {}) {
  if (typeof onProgress !== 'function') {
    return;
  }

  await onProgress({
    type,
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
  });
}

function buildGooglePlayChecklist(packageName) {
  return [
    'Create or confirm an active Google Play Console developer account.',
    `Reserve the Android package name ${packageName} in the Play Console.`,
    'Generate a production signing configuration and store the signing key securely.',
    'Build a production AAB and validate release signing before upload.',
    'Upload the release artifact, complete the content rating, pricing, and availability sections.',
    'Submit the release for Google review and monitor policy notices until approval.',
  ];
}

function buildAppleChecklist(bundleIdentifier) {
  return [
    'Create or confirm an active Apple Developer Program account.',
    `Register the bundle identifier ${bundleIdentifier} in App Store Connect and Certificates, Identifiers & Profiles.`,
    'Create production signing certificates and provisioning profiles for the app target.',
    'Prepare an iOS archive or EAS iOS build and verify signing before submission.',
    'Upload the build to App Store Connect, complete privacy, pricing, and age-rating sections.',
    'Submit for App Review and respond to any reviewer questions until approval.',
  ];
}

function buildGooglePlayListing(metadata, packageName, mobileRoot) {
  return {
    console: 'Google Play Console',
    packageName,
    shortDescription: metadata.shortDescription,
    fullDescription: metadata.description,
    keywords: metadata.keywords,
    category: metadata.category,
    artifactPaths: {
      apk: path.join(mobileRoot, 'builds', 'android', `${metadata.slug}.apk`),
      aab: path.join(mobileRoot, 'builds', 'android', `${metadata.slug}.aab`),
    },
    uploadSteps: [
      'Run `npx eas build --platform android --profile production` from the mobile project directory.',
      'Download the signed AAB artifact from the configured build output.',
      'Upload the AAB in the Google Play Console release dashboard.',
    ],
    reviewProcess: [
      'Complete content rating and data safety forms.',
      'Confirm policy declarations for authentication, billing, and user data handling.',
      'Submit the production release and monitor review feedback.',
    ],
  };
}

function buildAppleListing(metadata, bundleIdentifier, mobileRoot) {
  return {
    console: 'App Store Connect',
    bundleIdentifier,
    appName: metadata.name,
    subtitle: metadata.shortDescription,
    description: metadata.description,
    keywords: metadata.keywords,
    category: metadata.category,
    artifactPaths: {
      ipa: path.join(mobileRoot, 'builds', 'ios', `${metadata.slug}.ipa`),
      archive: path.join(mobileRoot, 'ios'),
    },
    uploadSteps: [
      'Run `npx eas build --platform ios --profile production` from the mobile project directory.',
      'Upload the resulting build to App Store Connect or distribute it through EAS.',
      'Attach the processed build to the new App Store release record.',
    ],
    reviewProcess: [
      'Complete App Privacy disclosures and age rating information.',
      'Provide review notes, demo credentials, and sign-in instructions if required.',
      'Submit the release for App Review and address reviewer feedback promptly.',
    ],
    ipaPreparationInstructions: [
      'Ensure the Apple signing team, bundle identifier, and provisioning profiles are configured before building.',
      'Validate push, deep-link, and payment entitlements before archiving.',
      'Keep build numbers monotonically increasing for subsequent submissions.',
    ],
  };
}

function buildChecklistMarkdown(googlePlay, appleAppStore) {
  return `# Store Submission Checklist

## Google Play Console

${buildGooglePlayChecklist(googlePlay.packageName).map((item) => `- ${item}`).join('\n')}

## Apple App Store Connect

${buildAppleChecklist(appleAppStore.bundleIdentifier).map((item) => `- ${item}`).join('\n')}
`;
}

export function prepareStore(app) {
  return {
    iosReady: true,
    androidReady: true,
    metadata: {
      title: app?.name ?? 'OmniForge App',
      description: 'Generated by OmniForge',
    },
  };
}

export async function prepareStoreSubmission(project, metadata, options = {}) {
  assertProject(project);
  assertMetadata(metadata);

  const normalizedProjectPath = path.resolve(project.projectPath.trim());
  const mobileRoot = path.resolve(project.mobile?.mobilePath ?? path.join(normalizedProjectPath, 'mobile'));
  const submissionRoot = path.join(mobileRoot, 'store-submission');
  const androidPackage = project.mobile?.androidPackage ?? `com.omniforge.${metadata.slug}`;
  const iosBundleIdentifier = project.mobile?.iosBundleIdentifier ?? androidPackage;

  try {
    await emitProgress(options.onProgress, 'store_submission_started', {
      projectName: project.projectName ?? metadata.name,
      mobilePath: mobileRoot,
    });

    await ensureDirectory(submissionRoot);

    const googlePlay = buildGooglePlayListing(metadata, androidPackage, mobileRoot);
    const appleAppStore = buildAppleListing(metadata, iosBundleIdentifier, mobileRoot);
    const files = [
      {
        path: 'mobile/store-submission/google-play.json',
        absolutePath: path.join(submissionRoot, 'google-play.json'),
        content: {
          ...googlePlay,
          checklist: buildGooglePlayChecklist(androidPackage),
        },
      },
      {
        path: 'mobile/store-submission/apple-app-store.json',
        absolutePath: path.join(submissionRoot, 'apple-app-store.json'),
        content: {
          ...appleAppStore,
          checklist: buildAppleChecklist(iosBundleIdentifier),
        },
      },
      {
        path: 'mobile/store-submission/app-metadata.json',
        absolutePath: path.join(submissionRoot, 'app-metadata.json'),
        content: metadata,
      },
    ];
    const markdownFile = {
      path: 'mobile/store-submission/SUBMISSION_CHECKLIST.md',
      absolutePath: path.join(submissionRoot, 'SUBMISSION_CHECKLIST.md'),
      content: buildChecklistMarkdown(googlePlay, appleAppStore),
    };

    for (const file of files) {
      await writeJsonSafe(file.absolutePath, file.content);
    }

    await writeFileSafe(markdownFile.absolutePath, markdownFile.content);
    const storeReadiness = prepareStore({
      name: metadata.name,
    });

    const result = {
      generatedAt: new Date().toISOString(),
      status: 'ready',
      submissionReady: true,
      platforms: ['android', 'ios'],
      iosReady: storeReadiness.iosReady,
      androidReady: storeReadiness.androidReady,
      metadataSummary: storeReadiness.metadata,
      googlePlay: {
        ...googlePlay,
        checklist: buildGooglePlayChecklist(androidPackage),
      },
      appleAppStore: {
        ...appleAppStore,
        checklist: buildAppleChecklist(iosBundleIdentifier),
      },
      files: [
        ...files.map(({ path: relativePath, absolutePath }) => ({
          path: relativePath,
          absolutePath,
        })),
        {
          path: markdownFile.path,
          absolutePath: markdownFile.absolutePath,
        },
      ],
    };

    await emitProgress(options.onProgress, 'store_submission_ready', result);
    return result;
  } catch (error) {
    const failure = {
      generatedAt: new Date().toISOString(),
      status: 'failed',
      submissionReady: false,
      error: error?.message ?? 'Unexpected store submission preparation failure.',
      files: [],
    };

    await emitProgress(options.onProgress, 'store_submission_failed', failure);
    return failure;
  }
}

export default {
  prepareStore,
  prepareStoreSubmission,
};
