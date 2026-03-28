import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ensureDirectory,
  fileExists,
  readJsonSafe,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';

const execFileAsync = promisify(execFile);
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PLATFORMS = ['ios', 'android'];

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for mobile build automation.');
  }
}

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

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
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

async function detectWebProject(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const viteConfigPath = path.join(projectPath, 'vite.config.js');
  const srcAppPath = path.join(projectPath, 'src', 'App.jsx');
  const srcTsAppPath = path.join(projectPath, 'src', 'App.tsx');
  const packageJson = await readJsonSafe(packageJsonPath, {
    defaultValue: null,
  });
  const hasPackageJson = Boolean(packageJson);
  const hasViteConfig = await fileExists(viteConfigPath);
  const hasSrcApp = await fileExists(srcAppPath) || await fileExists(srcTsAppPath);
  const dependencies = packageJson?.dependencies ?? {};
  const devDependencies = packageJson?.devDependencies ?? {};
  const framework = hasViteConfig
    ? 'vite-react'
    : dependencies.next || devDependencies.next
      ? 'next'
      : dependencies.react || devDependencies.react
        ? 'react'
        : 'unknown';

  return {
    isWebProject: hasPackageJson || hasViteConfig || hasSrcApp,
    framework,
    packageJson,
  };
}

function resolveConfig(projectPath, config = {}) {
  const projectName = config.projectName || config.intent?.projectName || path.basename(projectPath);
  const appName = titleCase(projectName) || 'OmniForge Mobile';
  const slug = slugify(appName) || 'omniforge-mobile';
  const identifierBase = slug.replace(/-/g, '');
  const features = dedupeStrings([
    ...(config.intent?.features ?? []),
    ...(config.features ?? []),
  ]);

  return {
    appName,
    slug,
    version: typeof config.version === 'string' && config.version.trim().length > 0
      ? config.version.trim()
      : '1.0.0',
    scheme: typeof config.scheme === 'string' && config.scheme.trim().length > 0
      ? config.scheme.trim()
      : slug,
    platforms: DEFAULT_PLATFORMS,
    features,
    iosBundleIdentifier:
      typeof config.iosBundleIdentifier === 'string' && config.iosBundleIdentifier.trim().length > 0
        ? config.iosBundleIdentifier.trim()
        : `com.omniforge.${identifierBase}`,
    androidPackage:
      typeof config.androidPackage === 'string' && config.androidPackage.trim().length > 0
        ? config.androidPackage.trim()
        : `com.omniforge.${identifierBase}`,
    executeBuild:
      config.executeBuild === true ||
      /^(1|true|yes)$/i.test(process.env.OMNIFORGE_EXECUTE_MOBILE_BUILD?.trim() ?? ''),
  };
}

function buildPackageJson(config) {
  return {
    name: config.slug,
    private: true,
    version: config.version,
    main: 'App.js',
    scripts: {
      start: 'expo start',
      android: 'expo run:android',
      ios: 'expo run:ios',
      prebuild: 'expo prebuild',
      export: 'expo export',
    },
    dependencies: {
      expo: '~55.0.8',
      react: '19.2.0',
      'react-dom': '19.2.0',
      'react-native': '0.83.4',
      'react-native-web': '~0.21.0',
    },
  };
}

export function buildExpoApp(app) {
  const appName = titleCase(app?.name || 'OmniForge Mobile');
  const slug = slugify(appName) || 'omniforge-mobile';

  return {
    appJson: {
      name: appName,
      slug,
      version: '1.0.0',
    },
    easJson: {
      build: {
        production: {},
      },
    },
  };
}

function buildAppJson(config) {
  const expoApp = buildExpoApp({
    name: config.appName,
  });

  return {
    expo: {
      name: expoApp.appJson.name,
      slug: expoApp.appJson.slug,
      version: config.version || expoApp.appJson.version,
      orientation: 'portrait',
      scheme: config.scheme,
      platforms: ['ios', 'android', 'web'],
      userInterfaceStyle: 'automatic',
      jsEngine: 'hermes',
      assetBundlePatterns: ['**/*'],
      ios: {
        supportsTablet: true,
        bundleIdentifier: config.iosBundleIdentifier,
      },
      android: {
        package: config.androidPackage,
      },
      web: {
        bundler: 'metro',
      },
      extra: {
        omniforge: {
          generatedBy: 'mobileBuilder',
          features: config.features,
        },
      },
    },
  };
}

function buildEasJson() {
  const expoApp = buildExpoApp({
    name: 'OmniForge Mobile',
  });

  return {
    cli: {
      version: '>= 12.0.0',
      appVersionSource: 'remote',
    },
    build: {
      preview: {
        developmentClient: true,
        distribution: 'internal',
      },
      production: {
        ...expoApp.easJson.build.production,
        autoIncrement: true,
      },
    },
    submit: {
      production: {},
    },
  };
}

function createAppTemplate(config) {
  return `import React from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
      <StatusBar barStyle="light-content" />
      <AppNavigator />
    </SafeAreaView>
  );
}
`;
}

function createNavigationTemplate(config) {
  return `import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AuthScreen } from '../screens/AuthScreen';
import { BillingScreen } from '../screens/BillingScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

const featureFlags = new Set(${JSON.stringify(config.features)});

export function AppNavigator() {
  const screens = useMemo(() => {
    const baseScreens = [
      {
        id: 'dashboard',
        label: 'Dashboard',
        render: () => <DashboardScreen appName="${config.appName}" />,
      },
      {
        id: 'settings',
        label: 'Settings',
        render: () => <SettingsScreen appName="${config.appName}" />,
      },
    ];

    if (featureFlags.has('auth')) {
      baseScreens.unshift({
        id: 'auth',
        label: 'Login',
        render: () => <AuthScreen appName="${config.appName}" />,
      });
    }

    if (featureFlags.has('payments')) {
      baseScreens.push({
        id: 'billing',
        label: 'Billing',
        render: () => <BillingScreen appName="${config.appName}" />,
      });
    }

    return baseScreens;
  }, []);
  const [activeScreen, setActiveScreen] = useState(screens[0]?.id ?? 'dashboard');
  const currentScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0];

  return (
    <View style={{ flex: 1, backgroundColor: '#020617' }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 }}>
        <Text style={{ color: '#cbd5e1', fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          OmniForge Mobile
        </Text>
        <Text style={{ color: '#f8fafc', fontSize: 28, fontWeight: '700', marginTop: 8 }}>
          ${config.appName}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
      >
        {screens.map((screen) => {
          const active = screen.id === activeScreen;
          return (
            <Pressable
              key={screen.id}
              onPress={() => setActiveScreen(screen.id)}
              style={{
                marginRight: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 999,
                backgroundColor: active ? '#0ea5e9' : '#111827',
              }}
            >
              <Text style={{ color: active ? '#082f49' : '#e2e8f0', fontWeight: '600' }}>
                {screen.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ flex: 1, padding: 16 }}>
        {currentScreen?.render()}
      </View>
    </View>
  );
}

export default AppNavigator;
`;
}

function createDashboardScreenTemplate(config) {
  return `import React from 'react';
import { Text, View } from 'react-native';

const featureFlags = ${JSON.stringify(config.features)};

export function DashboardScreen({ appName }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 24,
        backgroundColor: '#0f172a',
        padding: 20,
        gap: 16,
      }}
    >
      <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '700' }}>
        {appName} Dashboard
      </Text>
      <Text style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 22 }}>
        This Expo mobile shell mirrors the generated web product and gives users a native entry point for primary workflows.
      </Text>
      <View style={{ gap: 10 }}>
        {featureFlags.map((feature) => (
          <View
            key={feature}
            style={{
              borderRadius: 18,
              backgroundColor: '#111827',
              paddingHorizontal: 14,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: '#93c5fd', fontSize: 12, textTransform: 'uppercase' }}>
              Feature
            </Text>
            <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '600', marginTop: 4 }}>
              {feature.replace(/_/g, ' ')}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default DashboardScreen;
`;
}

function createAuthScreenTemplate() {
  return `import React from 'react';
import { Text, TextInput, View } from 'react-native';

export function AuthScreen({ appName }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 24,
        backgroundColor: '#0f172a',
        padding: 20,
        gap: 14,
      }}
    >
      <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '700' }}>
        Sign in to {appName}
      </Text>
      <Text style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 22 }}>
        This mobile auth screen is ready to connect to the existing OmniForge authentication or Supabase integration layer.
      </Text>
      <TextInput
        placeholder="Email"
        placeholderTextColor="#64748b"
        style={{
          borderRadius: 16,
          backgroundColor: '#111827',
          color: '#f8fafc',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      />
      <TextInput
        secureTextEntry
        placeholder="Password"
        placeholderTextColor="#64748b"
        style={{
          borderRadius: 16,
          backgroundColor: '#111827',
          color: '#f8fafc',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      />
      <View
        style={{
          borderRadius: 16,
          backgroundColor: '#0ea5e9',
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <Text style={{ color: '#082f49', fontWeight: '700', textAlign: 'center' }}>
          Continue
        </Text>
      </View>
    </View>
  );
}

export default AuthScreen;
`;
}

function createBillingScreenTemplate() {
  return `import React from 'react';
import { Text, View } from 'react-native';

export function BillingScreen({ appName }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 24,
        backgroundColor: '#0f172a',
        padding: 20,
        gap: 14,
      }}
    >
      <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '700' }}>
        Billing
      </Text>
      <Text style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 22 }}>
        The billing surface for {appName} is prepared for Stripe-backed checkout, subscription state, and receipt flows.
      </Text>
      <View style={{ borderRadius: 18, backgroundColor: '#111827', padding: 16 }}>
        <Text style={{ color: '#93c5fd', fontSize: 12, textTransform: 'uppercase' }}>
          Next step
        </Text>
        <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '600', marginTop: 6 }}>
          Connect the mobile billing call to the generated Stripe integration endpoints.
        </Text>
      </View>
    </View>
  );
}

export default BillingScreen;
`;
}

function createSettingsScreenTemplate() {
  return `import React from 'react';
import { Text, View } from 'react-native';

export function SettingsScreen({ appName }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 24,
        backgroundColor: '#0f172a',
        padding: 20,
        gap: 14,
      }}
    >
      <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '700' }}>
        Settings
      </Text>
      <Text style={{ color: '#cbd5e1', fontSize: 15, lineHeight: 22 }}>
        Configure notifications, security controls, and support links for {appName} before releasing to production stores.
      </Text>
    </View>
  );
}

export default SettingsScreen;
`;
}

function createReadmeTemplate(config, buildCommands) {
  return `# Mobile Build

This directory contains the Expo mobile scaffold generated for ${config.appName}.

## Build Commands

${buildCommands.map((command) => `- ${command}`).join('\n')}

## Notes

- Run \`npm install\` inside this directory before enabling local Expo or EAS builds.
- Use \`npx eas build --platform android --profile production\` for an AAB build.
- Use \`npx eas build --platform ios --profile production\` for an iOS build suitable for App Store Connect.
`;
}

async function runCommand(command, args, cwd) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
      timeout: BUILD_TIMEOUT_MS,
    });

    return {
      command: `${command} ${args.join(' ')}`.trim(),
      cwd,
      success: true,
      exitCode: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    return {
      command: `${command} ${args.join(' ')}`.trim(),
      cwd,
      success: false,
      exitCode: typeof error?.code === 'number' ? error.code : 1,
      stdout: typeof error?.stdout === 'string' ? error.stdout.trim() : '',
      stderr: typeof error?.stderr === 'string' ? error.stderr.trim() : '',
      error: error?.message ?? 'Command execution failed.',
    };
  }
}

export async function buildMobileApp(projectPath, config = {}) {
  assertProjectPath(projectPath);

  const normalizedProjectPath = path.resolve(projectPath.trim());
  const detectedProject = await detectWebProject(normalizedProjectPath);

  if (!detectedProject.isWebProject) {
    return {
      generatedAt: new Date().toISOString(),
      status: 'failed',
      error: 'Mobile conversion requires an existing web-oriented project scaffold.',
      platforms: [],
      files: [],
    };
  }

  const resolvedConfig = resolveConfig(normalizedProjectPath, config);
  const mobileRoot = path.join(normalizedProjectPath, 'mobile');
  const buildCommands = ['npx expo prebuild', 'npx expo export'];

  await emitProgress(config.onProgress, 'mobile_build_started', {
    projectName: resolvedConfig.appName,
    projectPath: normalizedProjectPath,
    mobilePath: mobileRoot,
    platforms: resolvedConfig.platforms,
  });

  try {
    await ensureDirectory(mobileRoot);
    await ensureDirectory(path.join(mobileRoot, 'src', 'navigation'));
    await ensureDirectory(path.join(mobileRoot, 'src', 'screens'));
    await ensureDirectory(path.join(mobileRoot, 'assets'));
    await ensureDirectory(path.join(mobileRoot, 'builds', 'android'));
    await ensureDirectory(path.join(mobileRoot, 'builds', 'ios'));

    const filesToWrite = [
      {
        path: 'mobile/package.json',
        absolutePath: path.join(mobileRoot, 'package.json'),
        type: 'json',
        content: buildPackageJson(resolvedConfig),
      },
      {
        path: 'mobile/app.json',
        absolutePath: path.join(mobileRoot, 'app.json'),
        type: 'json',
        content: buildAppJson(resolvedConfig),
      },
      {
        path: 'mobile/eas.json',
        absolutePath: path.join(mobileRoot, 'eas.json'),
        type: 'json',
        content: buildEasJson(),
      },
      {
        path: 'mobile/App.js',
        absolutePath: path.join(mobileRoot, 'App.js'),
        type: 'text',
        content: createAppTemplate(resolvedConfig),
      },
      {
        path: 'mobile/src/navigation/AppNavigator.js',
        absolutePath: path.join(mobileRoot, 'src', 'navigation', 'AppNavigator.js'),
        type: 'text',
        content: createNavigationTemplate(resolvedConfig),
      },
      {
        path: 'mobile/src/screens/DashboardScreen.js',
        absolutePath: path.join(mobileRoot, 'src', 'screens', 'DashboardScreen.js'),
        type: 'text',
        content: createDashboardScreenTemplate(resolvedConfig),
      },
      {
        path: 'mobile/src/screens/AuthScreen.js',
        absolutePath: path.join(mobileRoot, 'src', 'screens', 'AuthScreen.js'),
        type: 'text',
        content: createAuthScreenTemplate(),
      },
      {
        path: 'mobile/src/screens/BillingScreen.js',
        absolutePath: path.join(mobileRoot, 'src', 'screens', 'BillingScreen.js'),
        type: 'text',
        content: createBillingScreenTemplate(),
      },
      {
        path: 'mobile/src/screens/SettingsScreen.js',
        absolutePath: path.join(mobileRoot, 'src', 'screens', 'SettingsScreen.js'),
        type: 'text',
        content: createSettingsScreenTemplate(),
      },
      {
        path: 'mobile/assets/branding.json',
        absolutePath: path.join(mobileRoot, 'assets', 'branding.json'),
        type: 'json',
        content: {
          appName: resolvedConfig.appName,
          accentColor: '#0ea5e9',
          backgroundColor: '#020617',
          generatedAt: new Date().toISOString(),
        },
      },
      {
        path: 'mobile/README.md',
        absolutePath: path.join(mobileRoot, 'README.md'),
        type: 'text',
        content: createReadmeTemplate(resolvedConfig, buildCommands),
      },
    ];

    for (const file of filesToWrite) {
      if (file.type === 'json') {
        await writeJsonSafe(file.absolutePath, file.content);
      } else {
        await writeFileSafe(file.absolutePath, file.content);
      }
    }

    const commandResults = [];

    if (resolvedConfig.executeBuild) {
      if (!(await fileExists(path.join(mobileRoot, 'node_modules')))) {
        commandResults.push(await runCommand('npm', ['install'], mobileRoot));
      }

      commandResults.push(await runCommand('npx', ['expo', 'prebuild'], mobileRoot));
      commandResults.push(await runCommand('npx', ['expo', 'export'], mobileRoot));
    } else {
      commandResults.push(
        ...buildCommands.map((command) => ({
          command,
          cwd: mobileRoot,
          success: null,
          exitCode: null,
          stdout: '',
          stderr: '',
          skipped: true,
          reason: 'Mobile command execution is disabled in low-cost mode. Set OMNIFORGE_EXECUTE_MOBILE_BUILD=true to execute builds.',
        })),
      );
    }

    const buildSucceeded =
      resolvedConfig.executeBuild === true
        ? commandResults.every((result) => result.success !== false)
        : true;
    const result = {
      generatedAt: new Date().toISOString(),
      status: buildSucceeded ? 'ready' : 'prepared',
      projectPath: normalizedProjectPath,
      mobilePath: mobileRoot,
      platforms: resolvedConfig.platforms,
      webProject: {
        framework: detectedProject.framework,
        isWebProject: true,
      },
      appName: resolvedConfig.appName,
      slug: resolvedConfig.slug,
      iosBundleIdentifier: resolvedConfig.iosBundleIdentifier,
      androidPackage: resolvedConfig.androidPackage,
      buildCommands: commandResults,
      artifacts: {
        exportPath: path.join(mobileRoot, 'dist'),
        android: {
          apkPath: path.join(mobileRoot, 'builds', 'android', `${resolvedConfig.slug}.apk`),
          aabPath: path.join(mobileRoot, 'builds', 'android', `${resolvedConfig.slug}.aab`),
        },
        ios: {
          ipaPath: path.join(mobileRoot, 'builds', 'ios', `${resolvedConfig.slug}.ipa`),
          archivePath: path.join(mobileRoot, 'ios'),
        },
      },
      files: filesToWrite.map((file) => ({
        path: file.path,
        absolutePath: file.absolutePath,
      })),
    };

    await emitProgress(config.onProgress, 'mobile_build_ready', result);
    return result;
  } catch (error) {
    const failure = {
      generatedAt: new Date().toISOString(),
      status: 'failed',
      projectPath: normalizedProjectPath,
      mobilePath: mobileRoot,
      platforms: resolvedConfig.platforms,
      error: error?.message ?? 'Unexpected mobile build preparation failure.',
      files: [],
    };

    await emitProgress(config.onProgress, 'mobile_build_failed', failure);
    return failure;
  }
}

export default {
  buildExpoApp,
  buildMobileApp,
};
