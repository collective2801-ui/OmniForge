import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runAutonomousMode } from '../autonomy/autonomousEngine.js';
import { getAccessProfile } from '../backend/accessControl.js';
import platformConfig from '../config/platform.config.js';
import deploymentService from '../deployment/deploymentService.js';
import { setupInfrastructure } from '../deployment/infraManager.js';
import { configureDNS } from '../domain/dnsConfigurator.js';
import domainManager from '../domain/domainManager.js';
import domainService from '../domain/domainService.js';
import contextMemory from '../engine/contextMemory.js';
import { ensureDirectory } from '../engine/fileSystem.js';
import logger from '../engine/logger.js';
import projectRegistry from '../engine/projectRegistry.js';
import { analyzeIntent } from '../engine/reasoningEngine.js';
import executor from '../execution/executor.js';
import { finalizeBuild } from '../intelligence/finalizationEngine.js';
import { attemptAutoFix, monitorSystem } from '../intelligence/runtimeMonitor.js';
import { makeDecisions } from '../intelligence/decisionEngine.js';
import { analyzeBuilderContext } from '../intelligence/referenceAnalyzer.js';
import apiOrchestrator from '../integrations/apiOrchestrator.js';
import { handleAPI as handleUnifiedAPI } from '../integrations/unifiedAPI.js';
import patternEngine from '../learning/patternEngine.js';
import preferenceEngine, {
  derivePreferenceSignals,
} from '../learning/preferenceEngine.js';
import { buildMobileApp } from '../mobile/mobileBuilder.js';
import { generateAppMetadata } from '../mobile/metadataGenerator.js';
import { prepareStoreSubmission } from '../mobile/storePublisher.js';
import intelligenceMemoryEngine from '../memory/memoryEngine.js';
import memoryStore from '../memory/memoryStore.js';
import sessionManager from '../memory/sessionManager.js';
import taskRouter, { TASK_CATEGORIES } from '../engine/taskRouter.js';
import { generateArchitectureMap } from '../ui/architectureMap.js';
import { injectComponent } from '../ui/componentInjector.js';
import { runEnhancedBuilder } from '../ui/builderEnhancer.js';
import { runAgentsInParallel } from '../agents/parallel/agentManager.js';
import { resolveConsensus } from '../agents/parallel/consensusEngine.js';

const GOAL_TO_ROUTE_CATEGORY = Object.freeze({
  build_app: TASK_CATEGORIES.BUILD_APP,
  modify_app: TASK_CATEGORIES.EDIT_PROJECT,
  create_api: TASK_CATEGORIES.CREATE_API_INTEGRATION,
  deploy: TASK_CATEGORIES.DEPLOYMENT_WORKFLOW,
  domain_setup: TASK_CATEGORIES.DOMAIN_WORKFLOW,
});

function assertUserInput(userInput) {
  if (typeof userInput !== 'string' || userInput.trim().length === 0) {
    throw new TypeError('Task input must be a non-empty string.');
  }
}

function createRunId() {
  return randomUUID();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function dedupeStrings(values = []) {
  return [...new Set(
    values
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  )];
}

function mergeFileDescriptors(...groups) {
  const merged = [];
  const seen = new Set();

  for (const group of groups) {
    for (const entry of Array.isArray(group) ? group : []) {
      if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') {
        continue;
      }

      const key = entry.path.trim();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(entry);
    }
  }

  return merged;
}

function normalizeUserId(userId) {
  return typeof userId === 'string' && userId.trim().length > 0
    ? userId.trim()
    : 'anonymous';
}

function normalizeActorUser(user, fallbackUserId) {
  if (!user || typeof user !== 'object') {
    return {
      id: fallbackUserId,
    };
  }

  return {
    ...user,
    id:
      typeof user.id === 'string' && user.id.trim().length > 0
        ? user.id.trim()
        : fallbackUserId,
  };
}

function createProjectDirectoryName(intent) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = slugify(intent.projectName || `${intent.goal}-${intent.projectType}`);
  return `${baseName || 'omniforge-project'}-${timestamp}`;
}

function normalizeExistingProject(project = null) {
  if (!project || typeof project !== 'object') {
    return null;
  }

  const projectId =
    typeof project.projectId === 'string' && project.projectId.trim().length > 0
      ? project.projectId.trim()
      : null;
  const projectName =
    typeof project.projectName === 'string' && project.projectName.trim().length > 0
      ? project.projectName.trim()
      : null;
  const projectPath =
    typeof project.projectPath === 'string' && project.projectPath.trim().length > 0
      ? path.resolve(project.projectPath.trim())
      : null;
  const projectType =
    typeof project.projectType === 'string' && project.projectType.trim().length > 0
      ? project.projectType.trim()
      : null;

  if (!projectId && !projectName && !projectPath) {
    return null;
  }

  return {
    projectId,
    projectName,
    projectPath,
    projectType,
  };
}

function createRoutingPayload(userInput, intent) {
  return {
    type: GOAL_TO_ROUTE_CATEGORY[intent.goal] ?? '',
    intent: GOAL_TO_ROUTE_CATEGORY[intent.goal] ?? '',
    title: userInput,
    description: `${intent.projectType} ${intent.features.join(' ')}`.trim(),
    prompt: userInput,
  };
}

async function saveSessionState(sessionId, sessionCreatedAt, payload) {
  return contextMemory.saveSession({
    id: sessionId,
    createdAt: sessionCreatedAt,
    ...payload,
  });
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

function determineProjectStatus(intent, executionResult) {
  if (intent.goal === 'domain_setup') {
    return 'domain_ready';
  }

  if (
    executionResult.stepResults.some(
      (stepResult) => stepResult.action === 'prepare_deployment',
    )
  ) {
    return 'deployment_ready';
  }

  if (intent.goal === 'create_api') {
    return 'api_ready';
  }

  return 'generated';
}

function shouldAutoDeploy(userInput, intent) {
  if (intent.goal === 'deploy') {
    return true;
  }

  return /\bdeploy\b|\bdeployment\b|\bhost(?:ing)?\b|\bpublish\b|\bship\b|\bgo live\b|\blive url\b|\bvercel\b|\brailway\b/i.test(
    userInput,
  );
}

function shouldHandleDomain(userInput, intent) {
  if (intent.goal === 'domain_setup') {
    return true;
  }

  return /\bdomain\b|\bdns\b|\bcustom domain\b|\bbrand(?:ing)?\b|\bbrandable\b/i.test(
    userInput,
  );
}

function shouldHandleAPIIntegrations(intent) {
  const featureSet = new Set(intent.features ?? []);

  return (
    intent.goal === 'create_api' ||
    featureSet.has('auth') ||
    featureSet.has('payments') ||
    featureSet.has('file_uploads')
  );
}

function shouldHandleMobile(userInput, intent) {
  const featureSet = new Set(intent.features ?? []);

  if (featureSet.has('responsive_ui') && /\bmobile app\b|\bnative app\b/i.test(userInput)) {
    return true;
  }

  return /\bmobile\b|\bios\b|\biphone\b|\bipad\b|\bandroid\b|\bexpo\b|\breact native\b|\bplay store\b|\bapp store\b|\bnative app\b/i.test(
    userInput,
  );
}

function shouldRunAutonomousMode(userInput, options = {}) {
  if (options?.skipAutonomousMode === true) {
    return false;
  }

  return /\bstart\b.*\bbusiness\b|\bbuild a saas\b|\blaunch\b.*\bproduct\b/i.test(userInput);
}

function summarizeMemoryForContext(memory) {
  return {
    id: memory.id,
    prompt: memory.prompt,
    status: memory.status,
    projectName: memory.project?.projectName ?? memory.intent?.projectName ?? null,
    projectType: memory.intent?.projectType ?? memory.project?.projectType ?? null,
    features: memory.intent?.features ?? [],
    updatedAt: memory.updatedAt,
    relevanceScore: memory.relevanceScore ?? null,
  };
}

function summarizePatternForContext(pattern) {
  return {
    id: pattern.id,
    key: pattern.key,
    projectType: pattern.projectType,
    features: pattern.features ?? [],
    successCount: pattern.successCount ?? 0,
    promptKeywords: pattern.promptKeywords ?? [],
    integrations: pattern.integrations ?? [],
    confidence: pattern.confidence ?? null,
    relevanceScore: pattern.relevanceScore ?? null,
  };
}

function buildLearnedAssumptions(preferences, relevantPatterns, relevantMemories) {
  const assumptions = [];

  if (preferences?.preferredUiStyle) {
    assumptions.push(
      `Honor the user's established UI style preference: ${preferences.preferredUiStyle}.`,
    );
  }

  if (Array.isArray(preferences?.preferredFrameworks) && preferences.preferredFrameworks.length > 0) {
    assumptions.push(
      `Favor the user's recurring framework stack: ${preferences.preferredFrameworks.join(', ')}.`,
    );
  }

  if (Array.isArray(relevantPatterns) && relevantPatterns.length > 0) {
    const primaryPattern = relevantPatterns[0];
    assumptions.push(
      `Reuse successful delivery patterns for ${primaryPattern.projectType} projects featuring ${primaryPattern.features.join(', ') || 'core flows'}.`,
    );
  }

  if (Array.isArray(relevantMemories) && relevantMemories.length > 0) {
    const primaryMemory = relevantMemories[0];
    assumptions.push(
      `Stay consistent with prior successful work such as ${primaryMemory.projectName || primaryMemory.prompt}.`,
    );
  }

  return dedupeStrings(assumptions);
}

function enrichIntentWithLearningContext(intent, learningContext) {
  const learnedAssumptions = buildLearnedAssumptions(
    learningContext.preferences,
    learningContext.relevantPatterns,
    learningContext.recentMemories,
  );

  return {
    ...intent,
    assumptions: dedupeStrings([
      ...(intent.assumptions ?? []),
      ...learnedAssumptions,
    ]),
    preferences: {
      preferredUiStyle: learningContext.preferences?.preferredUiStyle ?? null,
      preferredFrameworks: learningContext.preferences?.preferredFrameworks ?? [],
      preferredFeatures: learningContext.preferences?.preferredFeatures ?? [],
    },
    learningContext: {
      recentMemories: learningContext.recentMemories.map(summarizeMemoryForContext),
      relevantPatterns: learningContext.relevantPatterns.map(summarizePatternForContext),
    },
  };
}

function summarizeReferenceContextForClient(referenceContext) {
  if (!referenceContext) {
    return null;
  }

  return {
    summary: referenceContext.summary,
    uploadedReferences: referenceContext.uploadedReferences ?? [],
    websites: (referenceContext.websites ?? []).map((website) => ({
      hostname: website.hostname ?? new URL(website.url).hostname,
      url: website.url,
      status: website.status,
      title: website.title ?? '',
      description: website.description ?? '',
      heading: website.heading ?? '',
      themeColor: website.themeColor ?? '',
      summary: website.summary ?? '',
      error: website.error ?? '',
    })),
    featureHints: referenceContext.featureHints ?? [],
    assumptions: referenceContext.assumptions ?? [],
    branding: referenceContext.branding ?? {
      hasLogo: false,
      dominantColors: [],
    },
  };
}

function applyReferenceContextToIntent(intent, referenceContext) {
  if (!referenceContext) {
    return intent;
  }

  return {
    ...intent,
    features: dedupeStrings([
      ...(intent.features ?? []),
      ...(referenceContext.featureHints ?? []),
    ]),
    assumptions: dedupeStrings([
      ...(intent.assumptions ?? []),
      ...(referenceContext.assumptions ?? []),
    ]),
    referenceContext: summarizeReferenceContextForClient(referenceContext),
  };
}

function summarizeInputAnalysisForClient(analysis) {
  if (!analysis || typeof analysis !== 'object') {
    return null;
  }

  return {
    mode: analysis.mode ?? 'prompt',
    type: analysis.type ?? 'application',
    sourceLabel: analysis.sourceLabel ?? '',
    features: analysis.features ?? [],
    summary: analysis.summary ?? '',
    confidence: analysis.confidence ?? null,
    structure: analysis.structure ?? {},
  };
}

function summarizeSelectedOptionForClient(selectedOption) {
  if (!selectedOption || typeof selectedOption !== 'object') {
    return null;
  }

  return {
    id: selectedOption.id ?? '',
    name: selectedOption.name ?? '',
    description: selectedOption.description ?? '',
    features: selectedOption.features ?? [],
    projectType: selectedOption.projectType ?? null,
  };
}

function applyAnalyzedSelectionToIntent(intent, analysis, selectedOption) {
  if (!analysis && !selectedOption) {
    return intent;
  }

  const nextProjectType =
    selectedOption?.projectType && selectedOption.projectType !== 'application'
      ? selectedOption.projectType
      : analysis?.type && analysis.type !== 'application'
        ? analysis.type
        : intent.projectType;

  return {
    ...intent,
    projectType: nextProjectType,
    features: dedupeStrings([
      ...(intent.features ?? []),
      ...(analysis?.features ?? []),
      ...(selectedOption?.features ?? []),
    ]),
    assumptions: dedupeStrings([
      ...(intent.assumptions ?? []),
      ...(analysis?.assumptions ?? []),
      analysis?.structure?.layout
        ? `Favor a ${analysis.structure.layout} layout for the primary interface.`
        : '',
      selectedOption?.name
        ? `Bias the build toward the selected direction: ${selectedOption.name}.`
        : '',
    ]),
    analyzedInput: summarizeInputAnalysisForClient(analysis),
    selectedBuildOption: summarizeSelectedOptionForClient(selectedOption),
  };
}

function createExecutionInput(taskInput, referenceContext, analysis, selectedOption) {
  const segments = [taskInput];

  if (analysis?.summary) {
    segments.push(
      `Analyzed input summary: ${analysis.summary}`,
      `Detected product type: ${analysis.type ?? 'application'}.`,
    );
  }

  if (Array.isArray(analysis?.features) && analysis.features.length > 0) {
    segments.push(`Detected features: ${analysis.features.join(', ')}.`);
  }

  if (analysis?.structure?.layout) {
    segments.push(`Recommended interface layout: ${analysis.structure.layout}.`);
  }

  if (selectedOption?.name) {
    segments.push(`Selected build option: ${selectedOption.name}.`);
  }

  if (selectedOption?.description) {
    segments.push(`Selected option detail: ${selectedOption.description}`);
  }

  if (referenceContext?.promptAddendum) {
    segments.push(referenceContext.promptAddendum);
  }

  return segments.filter(Boolean).join('\n\n');
}

function createDecisionEntry(stage, summary, metadata = {}) {
  return {
    id: randomUUID(),
    stage,
    summary,
    metadata,
    timestamp: new Date().toISOString(),
  };
}

function buildMemoryTags(intent, integrations, deployment, domain, mobile, store) {
  return dedupeStrings([
    intent.goal,
    intent.projectType,
    ...(intent.features ?? []),
    ...(integrations?.integrations ?? []),
    deployment?.provider ?? '',
    domain?.selectedProvider ?? '',
    mobile?.status ? `mobile-${mobile.status}` : '',
    Array.isArray(mobile?.platforms) && mobile.platforms.length > 0
      ? `mobile-${mobile.platforms.join('-')}`
      : '',
    store?.submissionReady ? 'store-ready' : '',
    intent.referenceContext?.branding?.hasLogo ? 'logo-reference' : '',
    Array.isArray(intent.referenceContext?.websites) && intent.referenceContext.websites.length > 0
      ? 'website-reference'
      : '',
  ]);
}

function summarizeIntelligenceMemory(memory) {
  return {
    id: memory.id,
    prompt: memory.prompt || memory.input,
    goal: memory.intent?.goal ?? null,
    projectType: memory.intent?.projectType ?? null,
    features: memory.intent?.features ?? [],
    status: memory.outputs?.status ?? null,
    relevanceScore: memory.relevanceScore ?? null,
    updatedAt: memory.updatedAt,
  };
}

function buildTechnicalAssumptions(decisions = {}) {
  return dedupeStrings([
    decisions.frontend && decisions.frontend !== 'none'
      ? `Favor ${decisions.frontend} for the frontend layer.`
      : '',
    decisions.backend && decisions.backend !== 'none'
      ? `Favor ${decisions.backend} for backend execution.`
      : '',
    decisions.database && decisions.database !== 'none'
      ? `Use ${decisions.database} for persistence.`
      : '',
    decisions.architecture
      ? `Prefer a ${decisions.architecture} architecture.`
      : '',
    Array.isArray(decisions.integrationsNeeded) && decisions.integrationsNeeded.length > 0
      ? `Prepare integrations for ${decisions.integrationsNeeded.join(', ')}.`
      : '',
  ]);
}

function buildIntentOverrideSteps(goal, projectType, features = []) {
  const featureSummary = features.length > 0 ? features.join(', ') : 'core application flows';

  switch (goal) {
    case 'build_app':
      return [
        `Define the ${projectType} architecture and execution boundaries.`,
        `Generate the first project slice covering ${featureSummary}.`,
        'Validate the file set for structure, safety, and local execution readiness.',
      ];
    case 'modify_app':
      return [
        'Identify the existing application areas that require change.',
        `Apply targeted updates for ${featureSummary} without destabilizing the current system.`,
        'Validate the proposed change set before execution.',
      ];
    case 'create_api':
      return [
        'Define the API contract, request flows, and integration boundaries.',
        `Generate the service files and supporting documentation for ${featureSummary}.`,
        'Validate the generated API surface and local runtime instructions.',
      ];
    case 'deploy':
      return [
        'Assess the deployment target, runtime assumptions, and rollout constraints.',
        'Generate deployment artifacts and execution guidance.',
        'Validate deployment readiness, environment expectations, and next actions.',
      ];
    case 'domain_setup':
      return [
        'Assess the target domain, DNS requirements, and certificate expectations.',
        'Generate the domain configuration plan and structured records.',
        'Validate the domain workflow for safe execution.',
      ];
    default:
      return null;
  }
}

function applyIntentOverrides(intent, intentOverrides = null) {
  if (!intentOverrides || typeof intentOverrides !== 'object') {
    return intent;
  }

  const nextGoal =
    typeof intentOverrides.goal === 'string' && intentOverrides.goal.trim().length > 0
      ? intentOverrides.goal.trim()
      : intent.goal;
  const nextProjectType =
    typeof intentOverrides.projectType === 'string' && intentOverrides.projectType.trim().length > 0
      ? intentOverrides.projectType.trim()
      : intent.projectType;
  const nextFeatures = Array.isArray(intentOverrides.features)
    ? dedupeStrings([...(intent.features ?? []), ...intentOverrides.features])
    : intent.features ?? [];
  const nextAssumptions = Array.isArray(intentOverrides.assumptions)
    ? dedupeStrings([...(intent.assumptions ?? []), ...intentOverrides.assumptions])
    : intent.assumptions ?? [];
  const nextSteps =
    Array.isArray(intentOverrides.steps) && intentOverrides.steps.length > 0
      ? dedupeStrings(intentOverrides.steps)
      : nextGoal !== intent.goal || nextProjectType !== intent.projectType
        ? buildIntentOverrideSteps(nextGoal, nextProjectType, nextFeatures) ?? intent.steps
        : intent.steps;

  return {
    ...intent,
    goal: nextGoal,
    projectType: nextProjectType,
    features: nextFeatures,
    assumptions: nextAssumptions,
    steps: nextSteps,
  };
}

function extractCloneUrl(userInput = '') {
  const match = String(userInput).match(/https?:\/\/[^\s)]+/i);
  return match?.[0] ?? null;
}

function extractRequestedDomain(userInput = '') {
  const matches = String(userInput).match(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi,
  ) ?? [];
  const ignoredHosts = ['localhost'];
  const ignoredSuffixes = ['.vercel.app', '.railway.app', '.up.railway.app'];

  for (const match of matches) {
    const normalizedMatch = match.trim().toLowerCase();

    if (
      ignoredHosts.includes(normalizedMatch) ||
      ignoredSuffixes.some((suffix) => normalizedMatch.endsWith(suffix))
    ) {
      continue;
    }

    return normalizedMatch;
  }

  return null;
}

function resolveRequestedComponents(userInput = '', intent = {}) {
  const featureSet = new Set(intent.features ?? []);
  const requestedComponents = [];

  if (featureSet.has('auth') || /\bauth\b|\blogin\b|\bsign[\s-]?in\b|\bauth module\b/i.test(userInput)) {
    requestedComponents.push('auth');
  }

  if (featureSet.has('dashboard') || /\bdashboard\b|\banalytics\b/i.test(userInput)) {
    requestedComponents.push('dashboard');
  }

  if (/\bnavbar\b|\bnavigation\b|\bmodern ui\b|\bmodern\b/i.test(userInput)) {
    requestedComponents.push('navbar');
  }

  if (/\bform\b|\bforms\b|\btemplate\b/i.test(userInput) || featureSet.has('auth')) {
    requestedComponents.push('form');
  }

  return dedupeStrings(requestedComponents);
}

export class Orchestrator {
  async runTask(userInput, options = {}) {
    assertUserInput(userInput);

    const taskInput = userInput.trim();
    const inputMode = options?.inputMode === 'voice' ? 'voice' : 'text';
    const mode = options?.mode === 'analyze' ? 'analyze' : 'prompt';
    const inputAnalysis =
      options?.analysis && typeof options.analysis === 'object'
        ? options.analysis
        : null;
    const selectedOption =
      options?.selectedOption && typeof options.selectedOption === 'object'
        ? options.selectedOption
        : null;
    const sessionId = createRunId();
    const sessionCreatedAt = new Date().toISOString();
    const onProgress = options?.onProgress;
    const userId = normalizeUserId(options?.userId);
    const actorUser = normalizeActorUser(options?.user, userId);
    const accessProfile = getAccessProfile(actorUser);
    const existingProject = normalizeExistingProject(options?.project);
    const decisionLog = [];
    let projectRecord = null;
    let projectRoot = '';
    let workingIntent = null;
    let referenceContext = null;
    let intelligence = null;
    let intelligenceDecisions = null;
    let intelligenceMemoryMatches = [];
    let architecture = null;
    let uiState = null;
    let cloneStructure = null;
    let injectedComponents = [];
    let mobile = null;
    let mobileMetadata = null;
    let store = null;
    let unifiedAPI = null;
    let runtime = null;
    let dns = null;
    let infrastructure = null;
    let memoryContext = {
      userId,
      preferences: null,
      recentMemories: [],
      relevantPatterns: [],
      intelligenceMemory: [],
    };

    const recordDecision = async (stage, summary, metadata = {}) => {
      const decision = createDecisionEntry(stage, summary, metadata);
      decisionLog.push(decision);
      await sessionManager.appendDecision(sessionId, decision);
      await emitProgress(onProgress, 'decision_logged', {
        sessionId,
        decision,
      });
      return decision;
    };

    await sessionManager.createSession({
      id: sessionId,
      userId,
      userRole: accessProfile.role,
      prompt: taskInput,
      inputMode,
      status: 'running',
      decisions: [],
    });
    await saveSessionState(sessionId, sessionCreatedAt, {
      name: 'OmniForge Task',
      summary: taskInput,
      status: 'running',
      data: {
        userInput: taskInput,
        userId,
        userRole: accessProfile.role,
        inputMode,
        mode,
      },
    });
    await emitProgress(onProgress, 'task_received', {
      sessionId,
      userInput: taskInput,
      inputMode,
      mode,
      selectedOption: summarizeSelectedOptionForClient(selectedOption),
    });

    await logger.info('Task received for orchestration.', {
      sessionId,
      userId,
      userRole: accessProfile.role,
      inputMode,
      mode,
      userInput: taskInput,
    });

    try {
      await ensureDirectory(platformConfig.workspaceRoot);
      await emitProgress(onProgress, 'access_profile_loaded', {
        sessionId,
        accessProfile,
      });
      await recordDecision(
        'access',
        accessProfile.isSuperAdmin
          ? 'Resolved SUPER_ADMIN access profile with unrestricted platform capabilities.'
          : `Resolved ${accessProfile.role} access profile for this task.`,
        {
          inputMode,
          mode,
          role: accessProfile.role,
          isSuperAdmin: accessProfile.isSuperAdmin,
          unlimitedBuilds: accessProfile.unlimitedBuilds,
          canOverrideBilling: accessProfile.canOverrideBilling,
          canControlDeployments: accessProfile.canControlDeployments,
          canViewAllProjects: accessProfile.canViewAllProjects,
        },
      );

      if (options?.builderContext && typeof options.builderContext === 'object') {
        referenceContext = await analyzeBuilderContext(options.builderContext);
        await emitProgress(onProgress, 'reference_context_loaded', {
          sessionId,
          referenceContext: summarizeReferenceContextForClient(referenceContext),
        });
        await recordDecision(
          'references',
          referenceContext.summary,
          {
            uploadedReferenceCount: referenceContext.uploadedReferences?.length ?? 0,
            websiteCount: referenceContext.websites?.length ?? 0,
            featureHints: referenceContext.featureHints ?? [],
            branding: referenceContext.branding ?? {},
          },
        );
      }

      if (mode === 'analyze' && (inputAnalysis || selectedOption)) {
        await emitProgress(onProgress, 'input_analysis_loaded', {
          sessionId,
          analysis: summarizeInputAnalysisForClient(inputAnalysis),
          selectedOption: summarizeSelectedOptionForClient(selectedOption),
        });
        await recordDecision(
          'analysis',
          selectedOption?.name
            ? `Locked the build to the analyzed option: ${selectedOption.name}.`
            : 'Loaded analyzed source input for a guided build.',
          {
            mode,
            analysis: summarizeInputAnalysisForClient(inputAnalysis),
            selectedOption: summarizeSelectedOptionForClient(selectedOption),
          },
        );
      }

      const executionInput = createExecutionInput(
        taskInput,
        referenceContext,
        inputAnalysis,
        selectedOption,
      );

      if (shouldRunAutonomousMode(taskInput, options)) {
        await recordDecision(
          'autonomy',
          'Delegating the request to the full autonomous platform engine.',
          {
            goal: taskInput,
            businessMode: true,
          },
        );
        await saveSessionState(sessionId, sessionCreatedAt, {
          name: 'OmniForge Autonomous Task',
          summary: taskInput,
          status: 'running',
          data: {
            userInput: taskInput,
            userId,
            userRole: accessProfile.role,
            inputMode,
            mode,
            autonomous: true,
          },
        });

        const autonomousResult = await runAutonomousMode(taskInput, {
          userId,
          user: actorUser,
            inputMode,
            mode,
            builderContext: options?.builderContext ?? null,
            project: existingProject,
            onProgress,
        });
        const product = autonomousResult.product ?? {};
        const result = {
          sessionId,
          status: autonomousResult.status,
          workflowStatus:
            autonomousResult.workflowStatus ??
            product.workflowStatus ??
            product.status ??
            autonomousResult.status,
          url: product.url ?? product.deployment?.url ?? null,
          inputMode,
          mode,
          analysis: summarizeInputAnalysisForClient(inputAnalysis),
          selectedOption: summarizeSelectedOptionForClient(selectedOption),
          autonomous: true,
          businessReady: autonomousResult.businessReady === true,
          intent: product.intent ?? null,
          route: product.route ?? null,
          plan: product.plan ?? null,
          access: accessProfile,
          project: product.project ?? null,
          projectRoot: product.projectRoot ?? product.project?.projectPath ?? '',
          files: mergeFileDescriptors(
            product.files,
            autonomousResult.business?.files,
            autonomousResult.growth?.files,
          ),
          execution: product.execution ?? null,
          intelligence: product.intelligence ?? null,
          architecture: product.architecture ?? null,
          uiState: product.uiState ?? null,
          cloneStructure: product.cloneStructure ?? null,
          injectedComponents: product.injectedComponents ?? [],
          mobile: product.mobile ?? null,
          mobileMetadata: product.mobileMetadata ?? null,
          store: product.store ?? null,
          unifiedAPI: product.unifiedAPI ?? null,
          runtime: product.runtime ?? null,
          integrations: product.integrations ?? null,
          deployment: product.deployment ?? null,
          domain: product.domain ?? null,
          dns: product.dns ?? null,
          infrastructure: product.infrastructure ?? null,
          finalization: product.finalization ?? autonomousResult.finalization ?? null,
          product,
          business: autonomousResult.business,
          growth: autonomousResult.growth,
          referenceContext: product.referenceContext ?? summarizeReferenceContextForClient(referenceContext),
          memoryContext: product.memoryContext ?? null,
          decisionLog: [
            ...decisionLog,
            ...((product.decisionLog ?? []).filter(Boolean)),
          ],
          memoryEntryId: product.memoryEntryId ?? null,
          memoryUpdated: product.memoryUpdated === true,
          patternsLearned: product.patternsLearned === true,
          preferencesUpdated: product.preferencesUpdated === true,
          validated: product.validated === true || autonomousResult.validated === true,
          productionReady:
            product.productionReady === true || autonomousResult.productionReady === true,
        };

        await sessionManager.updateSession(sessionId, {
          status: 'completed',
          intent: product.intent ?? null,
          output: {
            status: result.status,
            autonomous: true,
            businessReady: result.businessReady,
            project: result.project,
          },
          decisions: result.decisionLog,
        });
        await saveSessionState(sessionId, sessionCreatedAt, {
          name: `OmniForge Autonomous Task: ${product.project?.projectName || product.intent?.projectName || 'business-launch'}`,
          summary: taskInput,
          status: 'completed',
          data: result,
        });
        await logger.info('Autonomous task orchestration completed.', {
          sessionId,
          projectId: result.project?.projectId ?? null,
          businessReady: result.businessReady,
        });
        await emitProgress(onProgress, 'task_completed', {
          sessionId,
          result,
        });

        return result;
      }

      intelligenceMemoryMatches = await intelligenceMemoryEngine.getRelevantMemory(executionInput, 5);
      await emitProgress(onProgress, 'intelligence_memory_loaded', {
        sessionId,
        matches: intelligenceMemoryMatches.map(summarizeIntelligenceMemory),
      });

      const analyzedIntent = applyIntentOverrides(
        await analyzeIntent(executionInput),
        options?.intentOverrides ?? null,
      );
      const baseIntent = {
        ...analyzedIntent,
        projectName:
          existingProject?.projectName ??
          analyzedIntent.projectName,
      };
      const preferences = await preferenceEngine.getUserPreferences(userId);
      const recentMemories = await memoryStore.findRelevantMemories(baseIntent, {
        prompt: executionInput,
        userId,
        limit: 5,
      });
      const relevantPatterns = await patternEngine.getRelevantPatterns(baseIntent, 5);

      memoryContext = {
        userId,
        preferences,
        recentMemories,
        relevantPatterns,
        intelligenceMemory: intelligenceMemoryMatches,
      };
      workingIntent = enrichIntentWithLearningContext(baseIntent, memoryContext);
      workingIntent = applyReferenceContextToIntent(workingIntent, referenceContext);
      workingIntent = applyAnalyzedSelectionToIntent(workingIntent, inputAnalysis, selectedOption);
      workingIntent = {
        ...workingIntent,
        access: accessProfile,
        platformContext: {
          unrestricted: accessProfile.isSuperAdmin,
          unlimitedBuilds: accessProfile.unlimitedBuilds,
          canOverrideBilling: accessProfile.canOverrideBilling,
          canControlDeployments: accessProfile.canControlDeployments,
          canViewAllProjects: accessProfile.canViewAllProjects,
        },
      };

      await sessionManager.updateSession(sessionId, {
        intent: workingIntent,
      });
      await logger.info('Intent analysis completed.', {
        sessionId,
        goal: workingIntent.goal,
        projectType: workingIntent.projectType,
        features: workingIntent.features,
        source: workingIntent.source,
        relevantMemoryCount: recentMemories.length,
        relevantPatternCount: relevantPatterns.length,
      });
      await emitProgress(onProgress, 'intent_analyzed', {
        sessionId,
        intent: workingIntent,
      });
      await emitProgress(onProgress, 'memory_context_loaded', {
        sessionId,
        memoryContext: {
          userId,
          preferences: {
            preferredUiStyle: preferences.preferredUiStyle,
            preferredFrameworks: preferences.preferredFrameworks,
            preferredFeatures: preferences.preferredFeatures,
          },
          recentMemories: recentMemories.map(summarizeMemoryForContext),
          relevantPatterns: relevantPatterns.map(summarizePatternForContext),
          intelligenceMemory: intelligenceMemoryMatches.map(summarizeIntelligenceMemory),
        },
      });
      await recordDecision('memory', 'Loaded relevant memory, patterns, and user preferences.', {
        intelligenceMemoryCount: intelligenceMemoryMatches.length,
        relevantMemoryCount: recentMemories.length,
        relevantPatternCount: relevantPatterns.length,
        preferredUiStyle: preferences.preferredUiStyle ?? null,
      });

      const route = taskRouter.route(createRoutingPayload(taskInput, workingIntent));
      await logger.info('Task routing completed.', {
        sessionId,
        routeCategory: route.category,
        confidence: route.confidence,
      });
      await emitProgress(onProgress, 'task_routed', {
        sessionId,
        route,
      });
      await recordDecision('routing', 'Selected task route based on resolved intent.', {
        routeCategory: route.category,
        confidence: route.confidence,
      });

      const projectDirectoryName = existingProject?.projectPath
        ? path.basename(existingProject.projectPath)
        : createProjectDirectoryName(workingIntent);
      projectRoot = existingProject?.projectPath ??
        path.join(platformConfig.workspaceRoot, projectDirectoryName);
      await ensureDirectory(projectRoot);

      projectRecord = await projectRegistry.registerProject({
        projectId: existingProject?.projectId ?? undefined,
        projectName: workingIntent.projectName || projectDirectoryName,
        projectPath: projectRoot,
        projectType: existingProject?.projectType ?? workingIntent.projectType,
        status: 'planning',
        userId,
      });
      await logger.info('Project registered successfully.', {
        sessionId,
        projectId: projectRecord.projectId,
      });
      await emitProgress(onProgress, 'project_registered', {
        sessionId,
        project: projectRecord,
        projectRoot,
        reusedProject: Boolean(existingProject?.projectId || existingProject?.projectPath),
      });

      intelligenceDecisions = makeDecisions({
        ...workingIntent,
        summary: workingIntent.summary ?? taskInput,
      });
      architecture = generateArchitectureMap(workingIntent, intelligenceDecisions);
      workingIntent = {
        ...workingIntent,
        technicalDecisions: intelligenceDecisions,
        assumptions: dedupeStrings([
          ...(workingIntent.assumptions ?? []),
          ...buildTechnicalAssumptions(intelligenceDecisions),
        ]),
      };
      await emitProgress(onProgress, 'intelligence_decisions_made', {
        sessionId,
        decisions: intelligenceDecisions,
      });
      await emitProgress(onProgress, 'architecture_generated', {
        sessionId,
        architecture,
      });
      await recordDecision('decisioning', 'Selected cost-aware technical decisions.', {
        frontend: intelligenceDecisions.frontend,
        backend: intelligenceDecisions.backend,
        database: intelligenceDecisions.database,
        deployment: intelligenceDecisions.deployment,
        integrationsNeeded: intelligenceDecisions.integrationsNeeded,
      });
      await recordDecision('architecture', 'Generated an architecture map for the selected stack.', {
        nodeCount: architecture.nodes.length,
        edgeCount: architecture.edges.length,
      });

      const enhancedBuild = await runEnhancedBuilder(executionInput, {
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        decisions: intelligenceDecisions,
        onProgress,
        cloneUrl: extractCloneUrl(taskInput),
        buildFn: async (input, buildContext) => {
          const parallelResults = await runAgentsInParallel({
            input,
            ...buildContext,
          });
          return resolveConsensus(parallelResults);
        },
        buildContext: {
          route,
          project: projectRecord,
          memory: intelligenceMemoryMatches,
        },
      });
      intelligence = enhancedBuild.result;
      uiState = enhancedBuild.uiState;
      cloneStructure = enhancedBuild.cloneStructure;

      if (intelligence.status !== 'success') {
        const reviewerIssues = intelligence.diagnostics?.reviewer?.issues ?? [];
        const securityIssues = intelligence.diagnostics?.security?.issues ?? [];
        throw new Error(
          `Core intelligence pipeline failed. ${[...reviewerIssues, ...securityIssues].join(' ')}`.trim(),
        );
      }

      await emitProgress(onProgress, 'core_intelligence_completed', {
        sessionId,
        intelligence: {
          status: intelligence.status,
          retriesUsed: intelligence.retriesUsed,
          roles: intelligence.roles,
          planId: intelligence.plan.planId,
          fileCount: intelligence.files.length,
        },
      });
      if (cloneStructure) {
        await emitProgress(onProgress, 'clone_structure_generated', {
          sessionId,
          cloneStructure,
        });
      }
      await recordDecision('intelligence', 'Completed optimized intelligence pipeline.', {
        retriesUsed: intelligence.retriesUsed,
        fileCount: intelligence.files.length,
        parallelExecution: intelligence.parallel?.enabled === true,
        consensusSource: intelligence.diagnostics?.consensus?.selectedSource ?? null,
      });
      if (cloneStructure) {
        await recordDecision('clone', 'Prepared a lightweight clone structure from the source URL.', {
          sourceUrl: cloneStructure.sourceUrl,
          layout: cloneStructure.layout,
          pageCount: cloneStructure.pages.length,
        });
      }

      workingIntent = {
        ...workingIntent,
        intelligence: {
          status: intelligence.status,
          retriesUsed: intelligence.retriesUsed,
          roles: intelligence.roles,
          diagnostics: intelligence.diagnostics,
          parallel: intelligence.parallel ?? null,
        },
      };

      const plan = {
        ...intelligence.plan,
        projectId: projectRecord.projectId,
        routeCategory: route.category,
      };
      await logger.info('Execution plan created.', {
        sessionId,
        planId: plan.planId,
        stepCount: plan.steps.length,
      });
      await emitProgress(onProgress, 'plan_created', {
        sessionId,
        plan: {
          planId: plan.planId,
          steps: plan.steps,
          executionGraph: plan.executionGraph,
          recommendations: plan.recommendations,
        },
      });
      await recordDecision('planning', 'Created execution plan using learned context.', {
        planId: plan.planId,
        stepCount: plan.steps.length,
      });

      await saveSessionState(sessionId, sessionCreatedAt, {
        name: `OmniForge Task: ${workingIntent.projectName || 'generated-project'}`,
        summary: taskInput,
        status: 'planning',
        data: {
          userInput: taskInput,
          userId,
          userRole: accessProfile.role,
          inputMode,
          mode,
          intent: {
            ...workingIntent,
            routeCategory: route.category,
          },
          route,
          memoryContext: {
            preferences: {
              preferredUiStyle: preferences.preferredUiStyle,
              preferredFrameworks: preferences.preferredFrameworks,
              preferredFeatures: preferences.preferredFeatures,
            },
            recentMemories: recentMemories.map(summarizeMemoryForContext),
            relevantPatterns: relevantPatterns.map(summarizePatternForContext),
            intelligenceMemory: intelligenceMemoryMatches.map(summarizeIntelligenceMemory),
          },
          technicalDecisions: intelligenceDecisions,
          architecture,
          uiState,
          cloneStructure,
          intelligence: {
            status: intelligence.status,
            retriesUsed: intelligence.retriesUsed,
            roles: intelligence.roles,
            planId: intelligence.plan.planId,
            fileCount: intelligence.files.length,
            parallel: intelligence.parallel ?? null,
          },
          project: projectRecord,
          plan: {
            planId: plan.planId,
            steps: plan.steps,
          },
        },
      });

      const executionResult = await executor.executePlan(plan, {
        sessionId,
        sessionCreatedAt,
        userInput: executionInput,
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        route,
        plan,
        project: projectRecord,
        projectRoot,
        projectRegistry,
        memory: contextMemory,
        logger,
        executionState: {
          learningContext: memoryContext,
          intelligence,
          technicalDecisions: intelligenceDecisions,
        },
        onProgress,
      });
      let finalization = await finalizeBuild(projectRoot, {
        ...executionResult,
        prompt: taskInput,
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        project: projectRecord,
        technicalDecisions: intelligenceDecisions,
      });

      executionResult.files = mergeFileDescriptors(
        executionResult.files,
        finalization.files,
      );
      executionResult.finalization = finalization;
      await emitProgress(onProgress, 'build_finalized', {
        sessionId,
        finalization,
      });
      await recordDecision(
        'finalization',
        finalization.productionReady === true
          ? 'Finalization engine validated the generated app as production ready.'
          : 'Finalization engine found blocking issues.',
        {
          status: finalization.status,
          iterations: finalization.iterations,
          retries: finalization.retries,
          issuesFixed: finalization.issuesFixed,
          productionReady: finalization.productionReady === true,
          remainingIssueCount: finalization.remainingIssues?.length ?? 0,
        },
      );

      if (finalization.productionReady !== true) {
        const issueSummary = (finalization.remainingIssues ?? [])
          .slice(0, 5)
          .map((issue) => issue.issue)
          .join(' ');

        throw new Error(
          `Finalization failed to stabilize the generated app. ${issueSummary}`.trim(),
        );
      }
      await recordDecision('execution', 'Primary build execution completed.', {
        stepCount: executionResult.stepResults.length,
        fileCount: executionResult.files.length,
      });

      let updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
        status: determineProjectStatus(workingIntent, executionResult),
        lastPlanId: plan.planId,
        generatedFiles: executionResult.files.length,
        buildValidated: finalization.validated === true,
        productionReady: finalization.productionReady === true,
        finalizationRetries: finalization.retries,
        finalizationUpdatedAt: finalization.generatedAt,
      });
      let integrations = null;
      let deployment = null;
      let domain = null;

      if (shouldHandleAPIIntegrations(workingIntent)) {
        integrations = await apiOrchestrator.handleAPIIntegrations(
          {
            ...workingIntent,
            routeCategory: route.category,
          },
          {
            projectPath: projectRoot,
            onProgress,
          },
        );

        if (integrations.status === 'configured') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'configured',
            integrations: integrations.integrations,
            integrationProviders: integrations.providers,
            integrationEnvKeys: integrations.envKeys,
          });
          await recordDecision('integrations', 'Configured intelligent API integrations.', {
            integrations: integrations.integrations,
            providers: integrations.providers,
          });
        } else if (integrations.status === 'failed') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'integration_failed',
            integrationError: integrations.error,
          });
          await recordDecision('integrations', 'API integration automation failed.', {
            error: integrations.error,
          });
        }
      }

      const requestedComponents = resolveRequestedComponents(taskInput, workingIntent);

      for (const componentName of requestedComponents) {
        const injectedComponent = await injectComponent(projectRoot, componentName);
        injectedComponents.push(injectedComponent);
        await emitProgress(onProgress, 'component_injected', {
          sessionId,
          component: injectedComponent.component,
          files: injectedComponent.files,
        });
      }

      if (injectedComponents.length > 0) {
        await recordDecision('ui', 'Injected reusable UI components into the generated project.', {
          components: injectedComponents.map((entry) => entry.component),
        });
      }

      if (shouldHandleMobile(taskInput, workingIntent)) {
        mobile = await buildMobileApp(projectRoot, {
          projectName: (updatedProject ?? projectRecord).projectName,
          intent: {
            ...workingIntent,
            routeCategory: route.category,
          },
          decisions: intelligenceDecisions,
          onProgress,
        });

        if (mobile.status === 'failed') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'mobile_failed',
            mobileStatus: mobile.status,
            mobileError: mobile.error,
          });
          await recordDecision('mobile', 'Mobile build preparation failed.', {
            error: mobile.error,
          });
        } else {
          mobileMetadata = generateAppMetadata({
            ...workingIntent,
            summary: taskInput,
            technicalDecisions: intelligenceDecisions,
          });
          await emitProgress(onProgress, 'mobile_metadata_generated', {
            sessionId,
            metadata: mobileMetadata,
          });

          store = await prepareStoreSubmission(
            {
              projectId: projectRecord.projectId,
              projectName: (updatedProject ?? projectRecord).projectName,
              projectPath: projectRoot,
              intent: {
                ...workingIntent,
                routeCategory: route.category,
              },
              mobile,
            },
            mobileMetadata,
            {
              onProgress,
            },
          );

          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: store?.submissionReady ? 'mobile_ready' : 'store_pending',
            mobileStatus: mobile.status,
            mobilePlatforms: mobile.platforms,
            mobilePath: mobile.mobilePath,
            androidPackage: mobile.androidPackage,
            iosBundleIdentifier: mobile.iosBundleIdentifier,
            storeSubmissionReady: store?.submissionReady === true,
            appStoreCategory: mobileMetadata.category,
            appStoreKeywords: mobileMetadata.keywords,
          });
          await recordDecision('mobile', 'Prepared Expo mobile scaffold and store submission assets.', {
            mobileStatus: mobile.status,
            platforms: mobile.platforms,
            storeSubmissionReady: store?.submissionReady === true,
          });
        }
      }

      if (shouldAutoDeploy(taskInput, workingIntent)) {
        deployment = await deploymentService.deployProject(
          {
            projectId: projectRecord.projectId,
            projectName: (updatedProject ?? projectRecord).projectName,
            projectPath: projectRoot,
            projectType: workingIntent.projectType,
            intent: {
              ...workingIntent,
              routeCategory: route.category,
            },
            route,
            execution: executionResult,
            integrationConfig:
              executionResult.artifacts?.prepare_api_integrations?.apiConfig ?? null,
          },
          {
            onProgress,
          },
        );

        if (deployment.status === 'deployed') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'deployed',
            liveUrl: deployment.url,
            deploymentProvider: deployment.provider,
            repositoryUrl: deployment.repository?.htmlUrl ?? null,
          });
        } else if (deployment.status === 'failed') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'deployment_failed',
            deploymentProvider: deployment.provider,
          });
        }

        await recordDecision('deployment', 'Ran deployment automation.', {
          provider: deployment.provider,
          status: deployment.status,
          url: deployment.url ?? null,
        });
      }

      if (
        deployment?.status === 'deployed' &&
        shouldHandleDomain(taskInput, workingIntent)
      ) {
        const requestedDomain = extractRequestedDomain(taskInput);
        let suggestedDomainFlow = null;
        let managedDomain = null;

        if (requestedDomain) {
          managedDomain = await domainManager.handleDomain(requestedDomain, {
            projectPath: projectRoot,
            onProgress,
          });
          domain = {
            ...managedDomain,
            selectedProvider: managedDomain.provider,
            suggestions: [managedDomain.domain],
            attachment: null,
            dns: null,
          };
        } else {
          suggestedDomainFlow = await domainService.handleDomainFlow(
            (updatedProject ?? projectRecord).projectName,
            {
              projectPath: projectRoot,
              deployment,
              deploymentUrl: deployment.url,
              onProgress,
            },
          );
          domain = suggestedDomainFlow;

          if (suggestedDomainFlow.status === 'ready' && suggestedDomainFlow.domain) {
            managedDomain = await domainManager.handleDomain(suggestedDomainFlow.domain, {
              projectPath: projectRoot,
              preferredProvider: suggestedDomainFlow.selectedProvider,
              onProgress,
            });
            domain = {
              ...suggestedDomainFlow,
              available: managedDomain.available,
              provider: managedDomain.provider,
              selectedProvider: managedDomain.provider,
              purchaseUrl: managedDomain.purchaseUrl,
              purchaseWorkflow: managedDomain.purchaseWorkflow,
              source: managedDomain.source,
              checkedAt: managedDomain.checkedAt,
              confidence: managedDomain.confidence,
              note: managedDomain.note,
              files: mergeFileDescriptors(
                suggestedDomainFlow.files,
                managedDomain.files,
              ),
            };
          }
        }

        const canConfigureDomain =
          domain?.status === 'ready' &&
          typeof domain?.domain === 'string' &&
          domain.domain.trim().length > 0 &&
          domain.available !== false;

        if (canConfigureDomain) {
          dns = await configureDNS(domain.domain, deployment.url, {
            projectPath: projectRoot,
            provider: deployment.provider,
            onProgress,
          });
          infrastructure = await setupInfrastructure(
            {
              projectId: projectRecord.projectId,
              projectName: (updatedProject ?? projectRecord).projectName,
              projectPath: projectRoot,
              intent: {
                ...workingIntent,
                routeCategory: route.category,
              },
              deployment,
              domain,
              dns,
              integrationConfig:
                integrations?.apiConfig ??
                executionResult.artifacts?.prepare_api_integrations?.apiConfig ??
                null,
            },
            {
              onProgress,
            },
          );
          domain = {
            ...domain,
            dns,
            attachment: dns.attachment ?? domain.attachment ?? null,
            files: mergeFileDescriptors(
              domain.files,
              dns.files,
              infrastructure.files,
            ),
          };
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'domain_ready',
            customDomain: domain.domain,
            domainProvider: domain.selectedProvider ?? domain.provider ?? null,
            domainStatus: domain.status,
            domainAvailability: domain.available !== false,
            dnsConfig: dns,
            infrastructureConfig: infrastructure,
            infrastructureStatus: infrastructure.status,
            domainAttachment: domain.attachment,
            domainPurchaseWorkflow: domain.purchaseWorkflow,
          });
        } else if (domain?.status === 'failed') {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: deployment.status === 'deployed' ? 'deployed' : 'domain_failed',
            domainStatus: 'failed',
            domainError: domain.error,
          });
        } else {
          updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
            status: 'domain_pending',
            customDomain: domain?.domain ?? null,
            domainProvider: domain?.selectedProvider ?? domain?.provider ?? null,
            domainStatus: domain?.status ?? 'pending',
            domainAvailability: domain?.available === true,
          });
        }

        await recordDecision('domain', 'Prepared custom domain and infrastructure automation.', {
          domain: domain?.domain ?? null,
          status: domain?.status ?? null,
          provider: domain?.selectedProvider ?? domain?.provider ?? null,
          available: domain?.available ?? null,
          dnsConfigured: dns?.status === 'ready',
          infrastructureReady: infrastructure?.status === 'ready',
        });
      }

      const runtimeSourceFiles = mergeFileDescriptors(
        executionResult.files,
        finalization?.files,
        integrations?.files,
        injectedComponents.flatMap((entry) => entry.files ?? []),
        mobile?.files,
        store?.files,
        domain?.files,
        dns?.files,
        infrastructure?.files,
      );

      unifiedAPI = await handleUnifiedAPI(
        {
          ...workingIntent,
          routeCategory: route.category,
        },
        {
          projectPath: projectRoot,
          decisions: intelligenceDecisions,
          integrations,
          deployment,
          mobile,
          store,
          onProgress,
        },
      );

      await recordDecision(
        'unified-api',
        unifiedAPI.status === 'configured'
          ? 'Prepared unified API provider plan.'
          : 'Unified API provider planning failed.',
        {
          status: unifiedAPI.status,
          apis: unifiedAPI.apis ?? [],
          providers: unifiedAPI.providers ?? {},
          error: unifiedAPI.error ?? null,
        },
      );

      runtime = await monitorSystem({
        projectRoot,
        files: [
          ...runtimeSourceFiles,
          ...(Array.isArray(unifiedAPI?.files) ? unifiedAPI.files : []),
        ],
        execution: executionResult,
        integrations,
        deployment,
        mobile,
        store,
        domain,
        dns,
        infrastructure,
        unifiedAPI,
        onProgress,
      });

      let runtimeAutoFixResults = [];
      const fixableIssues = (runtime.issues ?? []).filter((issue) => issue.fixable === true).slice(0, 2);

      if (fixableIssues.length > 0) {
        for (const issue of fixableIssues) {
          const fixResult = await attemptAutoFix(issue, {
            projectRoot,
            onProgress,
          });
          runtimeAutoFixResults.push(fixResult);
        }

        runtime = await monitorSystem({
          projectRoot,
          files: [
            ...runtimeSourceFiles,
            ...(Array.isArray(unifiedAPI?.files) ? unifiedAPI.files : []),
            ...runtimeAutoFixResults.flatMap((fixResult) => fixResult.files ?? []),
          ],
          execution: executionResult,
          integrations,
          deployment,
          mobile,
          store,
          domain,
          dns,
          infrastructure,
          unifiedAPI,
          onProgress,
        });
      }

      runtime = {
        ...runtime,
        issuesFixed: runtimeAutoFixResults.some((fixResult) => fixResult.fixed === true),
        autoFixResults: runtimeAutoFixResults,
      };

      updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
        runtimeStatus: runtime.status,
        runtimeIssueCount: runtime.metrics?.issueCount ?? runtime.issues?.length ?? 0,
        runtimeIssuesFixed: runtime.issuesFixed === true,
        runtimeSecurityWarningCount:
          runtime.metrics?.securityWarningCount ?? runtime.securityWarnings?.length ?? 0,
        unifiedApis: unifiedAPI.apis ?? [],
        unifiedApiProviders: unifiedAPI.providers ?? {},
      });
      await recordDecision('runtime', 'Monitored runtime diagnostics and completed post-build validation.', {
        status: runtime.status,
        issueCount: runtime.metrics?.issueCount ?? runtime.issues?.length ?? 0,
        issuesFixed: runtime.issuesFixed === true,
        securityWarnings:
          runtime.metrics?.securityWarningCount ?? runtime.securityWarnings?.length ?? 0,
      });

      const combinedFiles = mergeFileDescriptors(
        executionResult.files,
        finalization?.files,
        integrations?.files,
        injectedComponents.flatMap((entry) => entry.files ?? []),
        mobile?.files,
        store?.files,
        unifiedAPI?.files,
        runtime?.files,
        (runtime?.autoFixResults ?? []).flatMap((fixResult) => fixResult.files ?? []),
        domain?.files,
        dns?.files,
        infrastructure?.files,
      );
      let finalStatus = 'completed';

      if (integrations?.status === 'configured') {
        finalStatus = 'configured';
      } else if (integrations?.status === 'failed') {
        finalStatus = 'integration_failed';
      }

      if (deployment?.status) {
        finalStatus = deployment.status;
      }

      if (mobile?.status === 'failed') {
        finalStatus = 'mobile_failed';
      } else if (mobile?.status === 'ready' && !deployment?.status) {
        finalStatus = 'ready';
      }

      if (store?.status === 'failed') {
        finalStatus = 'store_failed';
      }

      if (domain?.status === 'ready' && dns?.status === 'ready') {
        finalStatus = domain.status;
      }

      const outputSummary = {
        status: finalization.productionReady === true ? 'complete' : finalStatus,
        workflowStatus: finalStatus,
        url: deployment?.url ?? null,
        inputMode,
        mode,
        access: accessProfile,
        project: updatedProject ?? projectRecord,
        analysis: summarizeInputAnalysisForClient(inputAnalysis),
        selectedOption: summarizeSelectedOptionForClient(selectedOption),
        referenceContext: summarizeReferenceContextForClient(referenceContext),
        integrations: integrations
          ? {
              status: integrations.status,
              integrations: integrations.integrations,
              providers: integrations.providers,
            }
          : null,
        deployment,
        domain,
        dns,
        infrastructure,
        intelligence: intelligence
          ? {
              status: intelligence.status,
              retriesUsed: intelligence.retriesUsed,
              planId: intelligence.plan.planId,
              fileCount: intelligence.files.length,
            }
          : null,
        finalization: finalization
          ? {
              status: finalization.productionReady === true ? 'complete' : finalization.status,
              validated: finalization.validated === true,
              productionReady: finalization.productionReady === true,
              issuesFixed: finalization.issuesFixed === true,
              iterations: finalization.iterations,
              retries: finalization.retries,
              quality: finalization.quality ?? null,
            }
          : null,
        architecture,
        uiState,
        cloneStructure,
        injectedComponents: injectedComponents.map((entry) => ({
          component: entry.component,
          injectedAt: entry.injectedAt,
          fileCount: entry.files.length,
        })),
        mobile: mobile
          ? {
              status: mobile.status,
              platforms: mobile.platforms,
              mobilePath: mobile.mobilePath,
              androidPackage: mobile.androidPackage,
              iosBundleIdentifier: mobile.iosBundleIdentifier,
            }
          : null,
        mobileMetadata,
        store: store
          ? {
              status: store.status,
              submissionReady: store.submissionReady,
              platforms: store.platforms,
            }
          : null,
        unifiedAPI: unifiedAPI
          ? {
              status: unifiedAPI.status,
              apis: unifiedAPI.apis,
              providers: unifiedAPI.providers,
              liveReady: unifiedAPI.liveReady,
            }
          : null,
        runtime: runtime
          ? {
              status: runtime.status,
              issuesFixed: runtime.issuesFixed === true,
              issueCount: runtime.metrics?.issueCount ?? runtime.issues?.length ?? 0,
              securityWarningCount:
                runtime.metrics?.securityWarningCount ?? runtime.securityWarnings?.length ?? 0,
            }
          : null,
        validated: finalization.validated === true,
        productionReady: finalization.productionReady === true,
      };
      const savedIntelligenceMemory = await intelligenceMemoryEngine.saveMemory({
        input: executionInput,
        prompt: taskInput,
        intent: {
          goal: workingIntent.goal,
          projectType: workingIntent.projectType,
          features: workingIntent.features,
          complexity: workingIntent.complexity,
          summary: workingIntent.summary ?? taskInput,
        },
        decisions: intelligenceDecisions,
        outputs: {
          status: finalStatus,
          projectId: projectRecord.projectId,
          projectName: (updatedProject ?? projectRecord).projectName,
          retriesUsed: intelligence?.retriesUsed ?? 0,
          generatedFiles: combinedFiles.length,
          mobileReady: mobile?.status === 'ready',
          storeSubmissionReady: store?.submissionReady === true,
          domainConfigured: dns?.status === 'ready',
          infrastructureReady: infrastructure?.status === 'ready',
          runtimeStatus: runtime?.status ?? null,
          runtimeIssuesFixed: runtime?.issuesFixed === true,
          unifiedApis: unifiedAPI?.apis ?? [],
        },
        links: intelligenceMemoryMatches.slice(0, 5).map((match) => ({
          type: 'related-memory',
          targetId: match.id,
          score: match.relevanceScore ?? 0,
        })),
        createdAt: sessionCreatedAt,
      });
      const savedMemory = await memoryStore.saveMemory({
        sessionId,
        userId,
        prompt: taskInput,
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        access: accessProfile,
        output: outputSummary,
        project: updatedProject ?? projectRecord,
        decisions: decisionLog,
        status: finalStatus,
        tags: buildMemoryTags(workingIntent, integrations, deployment, domain, mobile, store),
        createdAt: sessionCreatedAt,
        completedAt: new Date().toISOString(),
      });
      await emitProgress(onProgress, 'memory_saved', {
        sessionId,
        memoryId: savedMemory.id,
        status: finalStatus,
      });

      const patternExtraction = await patternEngine.extractPatterns(
        await memoryStore.getAllMemories(),
      );
      await emitProgress(onProgress, 'patterns_learned', {
        sessionId,
        patternCount: patternExtraction.patterns.length,
      });

      const updatedPreferences = await preferenceEngine.updatePreferences(
        userId,
        derivePreferenceSignals({
          prompt: taskInput,
          intent: workingIntent,
          existingPreferences: memoryContext.preferences,
        }),
      );
      await emitProgress(onProgress, 'preferences_updated', {
        sessionId,
        preferences: {
          preferredUiStyle: updatedPreferences.preferredUiStyle,
          preferredFrameworks: updatedPreferences.preferredFrameworks,
          preferredFeatures: updatedPreferences.preferredFeatures,
        },
      });
      await recordDecision('learning', 'Persisted task memory and refreshed learned patterns.', {
        memoryId: savedMemory.id,
        patternCount: patternExtraction.patterns.length,
        preferredUiStyle: updatedPreferences.preferredUiStyle ?? null,
      });

      updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
        status: finalStatus,
        lastPlanId: plan.planId,
        generatedFiles: combinedFiles.length,
        lastMemoryId: savedMemory.id,
        learnedPatternCount: patternExtraction.patterns.length,
        preferredUiStyle: updatedPreferences.preferredUiStyle,
        preferredFrameworks: updatedPreferences.preferredFrameworks,
        preferredFeatures: updatedPreferences.preferredFeatures,
        memoryUpdatedAt: savedMemory.updatedAt,
        memoryUpdated: true,
        patternsLearned: true,
      });
      const finalMemory = await memoryStore.saveMemory({
        id: savedMemory.id,
        sessionId,
        userId,
        prompt: taskInput,
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        access: accessProfile,
        output: {
          ...outputSummary,
          project: updatedProject ?? projectRecord,
        },
        project: updatedProject ?? projectRecord,
        decisions: decisionLog,
        status: finalStatus,
        tags: buildMemoryTags(workingIntent, integrations, deployment, domain, mobile, store),
        createdAt: savedMemory.createdAt,
        completedAt: savedMemory.completedAt,
      });
      updatedProject = await projectRegistry.updateProject(projectRecord.projectId, {
        lastMemoryId: finalMemory.id,
        memoryUpdatedAt: finalMemory.updatedAt,
      });

      await sessionManager.updateSession(sessionId, {
        status: 'completed',
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        output: outputSummary,
        decisions: decisionLog,
      });

      const result = {
        sessionId,
        status: finalization.productionReady === true ? 'complete' : finalStatus,
        workflowStatus: finalStatus,
        url: deployment?.url ?? null,
        inputMode,
        mode,
        analysis: summarizeInputAnalysisForClient(inputAnalysis),
        selectedOption: summarizeSelectedOptionForClient(selectedOption),
        referenceContext: summarizeReferenceContextForClient(referenceContext),
        intent: {
          ...workingIntent,
          routeCategory: route.category,
        },
        route,
        plan,
        access: accessProfile,
        project: updatedProject ?? projectRecord,
        projectRoot,
        files: combinedFiles,
        referenceContext: summarizeReferenceContextForClient(referenceContext),
        execution: executionResult,
        intelligence: {
          ...intelligence,
          decisions: intelligenceDecisions,
          memoryMatches: intelligenceMemoryMatches.map(summarizeIntelligenceMemory),
          memoryId: savedIntelligenceMemory.id,
        },
        finalization,
        architecture,
        uiState,
        cloneStructure,
        injectedComponents,
        mobile,
        mobileMetadata,
        store,
        unifiedAPI,
        runtime,
        integrations,
        deployment,
        domain,
        dns,
        infrastructure,
        memoryContext: {
          userId,
          preferences: {
            preferredUiStyle: updatedPreferences.preferredUiStyle,
            preferredFrameworks: updatedPreferences.preferredFrameworks,
            preferredFeatures: updatedPreferences.preferredFeatures,
          },
          recentMemories: memoryContext.recentMemories.map(summarizeMemoryForContext),
          relevantPatterns: memoryContext.relevantPatterns.map(summarizePatternForContext),
          intelligenceMemory: intelligenceMemoryMatches.map(summarizeIntelligenceMemory),
        },
        decisionLog,
        memoryEntryId: finalMemory.id,
        memoryUpdated: true,
        patternsLearned: patternExtraction.updated === true,
        preferencesUpdated: true,
        validated: finalization.validated === true,
        productionReady: finalization.productionReady === true,
      };

      await saveSessionState(sessionId, sessionCreatedAt, {
        name: `OmniForge Task: ${workingIntent.projectName || 'generated-project'}`,
        summary: taskInput,
        status: 'completed',
        data: result,
      });

      await logger.info('Task orchestration completed.', {
        sessionId,
        projectId: projectRecord.projectId,
        projectPath: projectRoot,
        planId: plan.planId,
        fileCount: combinedFiles.length,
        memoryUpdated: true,
        patternsLearned: true,
      });
      await emitProgress(onProgress, 'task_completed', {
        sessionId,
        result,
      });

      return result;
    } catch (error) {
      const failureMessage = error?.message ?? String(error);

      try {
        const failureDecision = createDecisionEntry('failure', 'Task execution failed.', {
          error: failureMessage,
        });
        decisionLog.push(failureDecision);
        await sessionManager.appendDecision(sessionId, failureDecision);
      } catch {
        // Best effort only.
      }

      await logger.error('Task orchestration failed.', {
        sessionId,
        error: failureMessage,
      });

      if (projectRecord?.projectId) {
        await projectRegistry.updateProject(projectRecord.projectId, {
          status: 'failed',
        });
      }

      let failureMemoryId = null;

      try {
        await intelligenceMemoryEngine.saveMemory({
          input: taskInput,
          prompt: taskInput,
          intent: {
            goal: workingIntent?.goal ?? '',
            projectType: workingIntent?.projectType ?? '',
            features: workingIntent?.features ?? [],
            complexity: workingIntent?.complexity ?? '',
            summary: workingIntent?.summary ?? taskInput,
          },
          decisions: intelligenceDecisions ?? {},
          outputs: {
            status: 'failed',
            error: failureMessage,
          },
          createdAt: sessionCreatedAt,
        });
        const failureMemory = await memoryStore.saveMemory({
          sessionId,
          userId,
        prompt: taskInput,
        intent: workingIntent ?? {},
          output: {
            error: failureMessage,
          },
          project: projectRecord,
          decisions: decisionLog,
          status: 'failed',
          createdAt: sessionCreatedAt,
          completedAt: new Date().toISOString(),
        });

        failureMemoryId = failureMemory.id;
      } catch {
        // Best effort only.
      }

      await sessionManager.updateSession(sessionId, {
        status: 'failed',
        intent: workingIntent,
        output: {
          error: failureMessage,
        },
        decisions: decisionLog,
      });
      await saveSessionState(sessionId, sessionCreatedAt, {
        name: 'OmniForge Task',
        summary: taskInput,
        status: 'failed',
        data: {
          userInput: taskInput,
          userId,
          userRole: accessProfile.role,
          inputMode,
          mode,
          intent: workingIntent,
          project: projectRecord,
          projectRoot,
          analysis: summarizeInputAnalysisForClient(inputAnalysis),
          selectedOption: summarizeSelectedOptionForClient(selectedOption),
          decisions: decisionLog,
          memoryEntryId: failureMemoryId,
          error: failureMessage,
        },
      });
      await emitProgress(onProgress, 'task_failed', {
        sessionId,
        message: failureMessage,
      });

      throw error;
    }
  }
}

const orchestrator = new Orchestrator();

export async function runTask(userInput, options = {}) {
  return orchestrator.runTask(userInput, options);
}

export async function runExampleTask() {
  return runTask('start a SaaS business for fitness tracking with subscriptions');
}

if (process.argv.includes('--example')) {
  runTask('start a SaaS business for fitness tracking with subscriptions')
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export default orchestrator;
