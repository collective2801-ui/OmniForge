import {
  apiRequest,
  createApiEventSource,
} from './apiClient.js';

const PIPELINE_STAGES = [
  {
    id: 'reasoning',
    label: 'Reasoning',
    accent: 'blue',
    description: 'Interpret the prompt and infer product intent.',
  },
  {
    id: 'routing',
    label: 'Routing',
    accent: 'purple',
    description: 'Create the execution plan and map it onto the agent graph.',
  },
  {
    id: 'generation',
    label: 'Generation',
    accent: 'pink',
    description: 'Generate source files and internal project contracts.',
  },
  {
    id: 'validation',
    label: 'Validation',
    accent: 'green',
    description: 'Prepare integration and persistence artifacts.',
  },
  {
    id: 'delivery',
    label: 'Delivery',
    accent: 'green',
    description: 'Finalize deployment, persistence, and workspace delivery.',
  },
];

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLog(level, stage, message, timestamp = new Date().toISOString()) {
  return {
    id: createId('log'),
    level,
    stage,
    message,
    timestamp,
  };
}

function createPipeline({ activeStage = null, failedStage = null, completedStages = [] } = {}) {
  const completedSet = new Set(completedStages);

  return PIPELINE_STAGES.map((stage) => {
    let state = 'pending';

    if (failedStage && stage.id === failedStage) {
      state = 'error';
    } else if (completedSet.has(stage.id)) {
      state = 'complete';
    } else if (activeStage && stage.id === activeStage) {
      state = 'active';
    }

    return {
      ...stage,
      state,
    };
  });
}

function mergeStatus(baseStatus, overrides = {}) {
  return {
    ...baseStatus,
    ...overrides,
    engine: {
      ...baseStatus.engine,
      ...(overrides.engine ?? {}),
    },
    memory: {
      ...baseStatus.memory,
      ...(overrides.memory ?? {}),
    },
    orchestrator: {
      ...baseStatus.orchestrator,
      ...(overrides.orchestrator ?? {}),
    },
    lastTask: {
      ...baseStatus.lastTask,
      ...(overrides.lastTask ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
}

function mapActionToStage(action = '') {
  switch (action) {
    case 'initialize_project':
    case 'generate_application':
    case 'apply_project_changes':
    case 'generate_api_service':
    case 'setup_backend':
      return 'generation';
    case 'prepare_api_integrations':
      return 'validation';
    case 'prepare_deployment':
    case 'prepare_domain_workflow':
      return 'delivery';
    default:
      return 'generation';
  }
}

function emitEvent(onEvent, event) {
  if (typeof onEvent === 'function') {
    onEvent(event);
  }
}

async function request(path, { method = 'GET', body } = {}) {
  return apiRequest(path, {
    method,
    body,
  });
}

async function getTaskSnapshot(taskId) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export function createInitialSystemStatus(overrides = {}) {
  const baseStatus = {
    engine: {
      state: 'ready',
      detail: 'Reasoning engine is online and ready for authenticated execution.',
    },
    memory: {
      state: 'synced',
      detail: 'Local runtime memory is synchronized.',
    },
    orchestrator: {
      state: 'idle',
      detail: 'Waiting for a user-owned project build request.',
    },
    lastTask: {
      state: 'idle',
      detail: 'No task has been executed in this browser session.',
    },
    pipeline: createPipeline(),
    projectName: null,
    routeCategory: 'unknown',
    generatedFilesCount: 0,
    updatedAt: new Date().toISOString(),
  };

  return mergeStatus(baseStatus, overrides);
}

export async function runTask(prompt, options = {}) {
  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';

  if (!normalizedPrompt) {
    throw new Error('Prompt is required.');
  }

  const onEvent = options.onEvent;
  const state = {
    logs: [],
    generatedFiles: [],
    intent: null,
    route: null,
    intelligence: null,
    finalization: null,
    architecture: null,
    uiState: null,
    cloneStructure: null,
    injectedComponents: [],
    mobile: null,
    mobileMetadata: null,
    store: null,
    unifiedAPI: null,
    runtime: null,
    integrations: null,
    deployment: null,
    domain: null,
    dns: null,
    infrastructure: null,
    product: null,
    business: null,
    growth: null,
    autonomous: false,
    businessReady: false,
    memoryContext: null,
    decisionLog: [],
    referenceContext: null,
    memoryUpdated: false,
    patternsLearned: false,
    preferencesUpdated: false,
    validated: false,
    productionReady: false,
    status: createInitialSystemStatus({
      projectName: options.projectName || null,
      orchestrator: {
        state: 'executing',
        detail: 'Submitting the task to the authenticated OmniForge backend.',
      },
      lastTask: {
        state: 'running',
        detail: 'Creating a user-owned execution session.',
      },
      pipeline: createPipeline({ activeStage: 'reasoning' }),
    }),
  };

  const pushLog = (level, stage, message, timestamp) => {
    const logEntry = createLog(level, stage, message, timestamp);
    state.logs.push(logEntry);
    emitEvent(onEvent, {
      type: 'log',
      payload: logEntry,
    });
  };

  const pushStatus = (overrides) => {
    state.status = mergeStatus(state.status, overrides);
    emitEvent(onEvent, {
      type: 'status',
      payload: state.status,
    });
  };

  const pushFiles = (files) => {
    state.generatedFiles = files;
    pushStatus({
      generatedFilesCount: files.length,
    });
    emitEvent(onEvent, {
      type: 'files',
      payload: files,
    });
  };

  pushLog('info', 'orchestrator', 'Connecting to OmniForge backend.');

  const task = await request('/api/tasks', {
    method: 'POST',
    body: {
      prompt: normalizedPrompt,
      projectId: options.projectId ?? null,
      projectName: options.projectName ?? null,
      inputMode: options.inputMode === 'voice' ? 'voice' : 'text',
      builderContext: options.builderContext ?? null,
      mode: options.mode === 'analyze' ? 'analyze' : 'prompt',
      analysis:
        options.analysis && typeof options.analysis === 'object'
          ? options.analysis
          : null,
      selectedOption:
        options.selectedOption && typeof options.selectedOption === 'object'
          ? options.selectedOption
          : null,
    },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const eventSource = createApiEventSource(
      `/api/tasks/${encodeURIComponent(task.taskId)}/stream`,
    );

    const settle = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      eventSource.close();
      callback();
    };

    eventSource.onmessage = (message) => {
      const event = JSON.parse(message.data);
      const timestamp = event.timestamp;

      switch (event.type) {
        case 'task_received':
          if (event.payload?.mode === 'analyze' && event.payload?.selectedOption?.name) {
            pushLog(
              'info',
              'reasoning',
              `Selected build direction: ${event.payload.selectedOption.name}.`,
              timestamp,
            );
          }
          if ((event.payload?.referenceCount ?? 0) > 0) {
            pushLog(
              'info',
              'reasoning',
              `Loaded ${event.payload.referenceCount} source reference${event.payload.referenceCount === 1 ? '' : 's'} for analysis.`,
              timestamp,
            );
          }
          pushLog('info', 'reasoning', 'Task accepted by the authenticated backend.', timestamp);
          pushStatus({
            pipeline: createPipeline({ activeStage: 'reasoning' }),
            lastTask: {
              state: 'running',
              detail: 'Intent analysis has started.',
            },
          });
          break;
        case 'intent_analyzed':
          state.intent = event.payload.intent;
          pushLog(
            'info',
            'reasoning',
            `Intent resolved as ${event.payload.intent.goal} for ${event.payload.intent.projectType}.`,
            timestamp,
          );
          pushStatus({
            projectName: event.payload.intent.projectName,
            pipeline: createPipeline({
              activeStage: 'routing',
              completedStages: ['reasoning'],
            }),
            lastTask: {
              state: 'running',
              detail: `Resolved project as ${event.payload.intent.projectName}.`,
            },
          });
          break;
        case 'task_routed':
          state.route = event.payload.route;
          pushLog(
            'info',
            'routing',
            `Route selected: ${event.payload.route.category}.`,
            timestamp,
          );
          pushStatus({
            routeCategory: event.payload.route.category,
            pipeline: createPipeline({
              activeStage: 'routing',
              completedStages: ['reasoning'],
            }),
          });
          break;
        case 'project_registered':
          pushLog(
            'info',
            'routing',
            `Workspace registered at ${event.payload.project.projectPath}.`,
            timestamp,
          );
          break;
        case 'plan_created':
          pushLog(
            'info',
            'routing',
            `Execution plan created with ${event.payload.plan.steps.length} steps.`,
            timestamp,
          );
          pushStatus({
            pipeline: createPipeline({
              activeStage: 'generation',
              completedStages: ['reasoning', 'routing'],
            }),
            orchestrator: {
              state: 'executing',
              detail: 'Agent execution has started.',
            },
          });
          break;
        case 'step_started': {
          const stage = mapActionToStage(event.payload.step.action);
          const completedStages =
            stage === 'generation'
              ? ['reasoning', 'routing']
              : stage === 'validation'
                ? ['reasoning', 'routing', 'generation']
                : ['reasoning', 'routing', 'generation', 'validation'];

          pushLog(
            'info',
            stage,
            `${event.payload.step.agent} agent started ${event.payload.step.title}.`,
            timestamp,
          );
          pushStatus({
            pipeline: createPipeline({
              activeStage: stage,
              completedStages,
            }),
            lastTask: {
              state: 'running',
              detail: event.payload.step.description,
            },
            memory: {
              state: stage === 'validation' || stage === 'delivery' ? 'syncing' : 'ready',
              detail:
                stage === 'validation' || stage === 'delivery'
                  ? 'Persisting integration and delivery metadata.'
                  : 'Tracking execution progress in runtime memory.',
            },
          });
          break;
        }
        case 'step_completed': {
          const stage = mapActionToStage(event.payload.step.action);
          const completedStages =
            stage === 'generation'
              ? ['reasoning', 'routing']
              : stage === 'validation'
                ? ['reasoning', 'routing', 'generation']
                : ['reasoning', 'routing', 'generation', 'validation'];

          pushLog('info', stage, event.payload.result.summary, timestamp);

          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }

          pushStatus({
            pipeline: createPipeline({
              activeStage: stage,
              completedStages,
            }),
            lastTask: {
              state: 'running',
              detail: `${event.payload.step.title} completed.`,
            },
          });
          break;
        }
        case 'step_failed':
          pushLog(
            'error',
            'delivery',
            event.payload.message ?? 'Execution step failed.',
            timestamp,
          );
          pushStatus({
            orchestrator: {
              state: 'error',
              detail: 'The agent execution pipeline failed.',
            },
            lastTask: {
              state: 'failed',
              detail: event.payload.message ?? 'Execution step failed.',
            },
            pipeline: createPipeline({
              failedStage: mapActionToStage(event.payload.step?.action),
              completedStages: ['reasoning', 'routing'],
            }),
          });
          break;
        case 'task_completed':
          state.intent = event.payload.intent;
          state.route = event.payload.route;
          state.referenceContext = event.payload.referenceContext ?? null;
          state.intelligence = event.payload.intelligence ?? null;
          state.finalization = event.payload.finalization ?? null;
          state.architecture = event.payload.architecture ?? null;
          state.uiState = event.payload.uiState ?? null;
          state.cloneStructure = event.payload.cloneStructure ?? null;
          state.injectedComponents = event.payload.injectedComponents ?? [];
          state.mobile = event.payload.mobile ?? null;
          state.mobileMetadata = event.payload.mobileMetadata ?? null;
          state.store = event.payload.store ?? null;
          state.unifiedAPI = event.payload.unifiedAPI ?? null;
          state.runtime = event.payload.runtime ?? null;
          state.integrations = event.payload.integrations ?? null;
          state.deployment = event.payload.deployment ?? null;
          state.domain = event.payload.domain ?? null;
          state.dns = event.payload.dns ?? null;
          state.infrastructure = event.payload.infrastructure ?? null;
          state.product = event.payload.product ?? null;
          state.business = event.payload.business ?? null;
          state.growth = event.payload.growth ?? null;
          state.autonomous = event.payload.autonomous === true;
          state.businessReady = event.payload.businessReady === true;
          state.memoryContext = event.payload.memoryContext ?? null;
          state.decisionLog = event.payload.decisionLog ?? [];
          state.memoryUpdated = event.payload.memoryUpdated === true;
          state.patternsLearned = event.payload.patternsLearned === true;
          state.preferencesUpdated = event.payload.preferencesUpdated === true;
          state.validated = event.payload.validated === true;
          state.productionReady = event.payload.productionReady === true;
          pushFiles(event.payload.generatedFiles ?? []);
          pushLog(
            'info',
            'delivery',
            `Task complete. ${event.payload.project.projectName} is ready.`,
            timestamp,
          );
          if (event.payload.deployment?.url) {
            pushLog(
              'info',
              'delivery',
              `Live URL: ${event.payload.deployment.url}`,
              timestamp,
            );
          }
          if (event.payload.domain?.domain) {
            pushLog(
              'info',
              'delivery',
              `Custom domain plan ready: ${event.payload.domain.domain}`,
              timestamp,
            );
          }
          if (event.payload.autonomous) {
            pushLog(
              'info',
              'delivery',
              'Autonomous business launch completed.',
              timestamp,
            );
          }
          if (event.payload.businessReady) {
            pushLog(
              'info',
              'validation',
              'Business model and growth plan are ready.',
              timestamp,
            );
          }
          if (event.payload.architecture?.nodes?.length) {
            pushLog(
              'info',
              'routing',
              `Architecture map generated with ${event.payload.architecture.nodes.length} nodes.`,
              timestamp,
            );
          }
          if (Array.isArray(event.payload.injectedComponents) && event.payload.injectedComponents.length > 0) {
            pushLog(
              'info',
              'generation',
              `Injected UI components: ${event.payload.injectedComponents.map((entry) => entry.component).join(', ')}.`,
              timestamp,
            );
          }
          if (event.payload.runtime?.status) {
            if (event.payload.runtime.status !== 'healthy') {
              pushLog(
                'error',
                'validation',
                `Runtime diagnostics status: ${event.payload.runtime.status}.`,
                timestamp,
              );
            }
          }
          pushStatus({
            engine: {
              state: 'ready',
              detail: 'Reasoning engine is ready for the next authenticated request.',
            },
            memory: {
              state: 'synced',
              detail: 'Runtime memory, project registry, and owned project records are synchronized.',
            },
            orchestrator: {
              state: 'completed',
              detail: 'Autonomous execution completed successfully.',
            },
            lastTask: {
              state: 'completed',
              detail: `Completed ${event.payload.intent.goal} for ${event.payload.project.projectName}.`,
            },
            projectName: event.payload.project.projectName,
            routeCategory: event.payload.route.category,
            pipeline: createPipeline({
              completedStages: PIPELINE_STAGES.map((stage) => stage.id),
            }),
          });
          settle(() => {
            resolve({
              status: state.status,
              logs: state.logs,
              generatedFiles: state.generatedFiles,
              intent: state.intent,
              route: state.route,
              intelligence: state.intelligence,
              finalization: state.finalization,
              architecture: state.architecture,
              uiState: state.uiState,
              cloneStructure: state.cloneStructure,
              injectedComponents: state.injectedComponents,
              mobile: state.mobile,
              mobileMetadata: state.mobileMetadata,
              store: state.store,
              unifiedAPI: state.unifiedAPI,
              runtime: state.runtime,
              integrations: state.integrations,
              deployment: state.deployment,
              domain: state.domain,
              dns: state.dns,
              infrastructure: state.infrastructure,
              product: state.product,
              business: state.business,
              growth: state.growth,
              autonomous: state.autonomous,
              businessReady: state.businessReady,
              memoryContext: state.memoryContext,
              referenceContext: state.referenceContext,
              decisionLog: state.decisionLog,
              memoryUpdated: state.memoryUpdated,
              patternsLearned: state.patternsLearned,
              preferencesUpdated: state.preferencesUpdated,
              validated: state.validated,
              productionReady: state.productionReady,
            });
          });
          break;
        case 'memory_context_loaded':
          state.memoryContext = event.payload.memoryContext ?? null;
          pushLog(
            'info',
            'reasoning',
            'Loaded relevant build history, patterns, and user preferences.',
            timestamp,
          );
          pushStatus({
            memory: {
              state: 'syncing',
              detail: 'Loading persistent memory and user preference context.',
            },
          });
          break;
        case 'reference_context_loaded':
          state.referenceContext = event.payload.referenceContext ?? null;
          pushLog(
            'info',
            'reasoning',
            event.payload.referenceContext?.summary || 'Reference materials analyzed.',
            timestamp,
          );
          break;
        case 'decision_logged':
          if (event.payload?.decision) {
            state.decisionLog = [...state.decisionLog, event.payload.decision];
            pushLog(
              'info',
              'validation',
              event.payload.decision.summary,
              timestamp,
            );
          }
          break;
        case 'architecture_generated':
          state.architecture = event.payload.architecture ?? null;
          pushLog(
            'info',
            'routing',
            `Architecture map prepared with ${event.payload.architecture?.nodes?.length ?? 0} nodes.`,
            timestamp,
          );
          break;
        case 'builder_ui_updated':
          state.uiState = event.payload.uiState ?? null;
          pushStatus({
            lastTask: {
              state: 'running',
              detail: event.payload.uiState?.stages?.find((stage) => stage.status === 'active')?.description ??
                event.payload.uiState?.currentStage ??
                'Updating builder state.',
            },
          });
          break;
        case 'build_finalized':
          state.finalization = event.payload.finalization ?? null;
          pushLog(
            state.finalization?.validated === true ? 'info' : 'error',
            'validation',
            state.finalization?.validated === true
              ? `Finalization complete after ${state.finalization?.retries ?? 0} retr${state.finalization?.retries === 1 ? 'y' : 'ies'}.`
              : 'Finalization detected blocking build issues.',
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'clone_structure_generated':
          state.cloneStructure = event.payload.cloneStructure ?? null;
          pushLog(
            'info',
            'generation',
            `Prepared clone structure from ${event.payload.cloneStructure?.sourceUrl}.`,
            timestamp,
          );
          break;
        case 'api_integrations_started':
          pushLog(
            'info',
            'validation',
            `API automation started for ${event.payload.projectName}.`,
            timestamp,
          );
          pushStatus({
            pipeline: createPipeline({
              activeStage: 'validation',
              completedStages: ['reasoning', 'routing', 'generation'],
            }),
            lastTask: {
              state: 'running',
              detail: 'Configuring provider scaffolds and environment keys.',
            },
          });
          break;
        case 'api_integration_provider_configured':
          pushLog(
            'info',
            'validation',
            `${event.payload.provider} configured for ${event.payload.service}.`,
            timestamp,
          );
          break;
        case 'api_integrations_ready':
          state.integrations = event.payload;
          pushLog(
            'info',
            'validation',
            `Integration plan ready: ${event.payload.integrations.join(', ')}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          pushStatus({
            pipeline: createPipeline({
              activeStage: 'validation',
              completedStages: ['reasoning', 'routing', 'generation'],
            }),
            lastTask: {
              state: 'running',
              detail: 'API provider scaffolds and environment templates are ready.',
            },
          });
          break;
        case 'api_integrations_failed':
          state.integrations = event.payload;
          pushLog(
            'error',
            'validation',
            event.payload.error ?? 'API automation failed.',
            timestamp,
          );
          break;
        case 'memory_saved':
          state.memoryUpdated = true;
          pushLog(
            'info',
            'validation',
            `Saved execution memory ${event.payload.memoryId}.`,
            timestamp,
          );
          break;
        case 'patterns_learned':
          state.patternsLearned = true;
          pushLog(
            'info',
            'validation',
            `Updated pattern library with ${event.payload.patternCount} learned patterns.`,
            timestamp,
          );
          break;
        case 'preferences_updated':
          state.preferencesUpdated = true;
          if (state.memoryContext) {
            state.memoryContext = {
              ...state.memoryContext,
              preferences: event.payload.preferences ?? state.memoryContext.preferences,
            };
          }
          pushLog(
            'info',
            'validation',
            'Updated user preference profile from the latest successful task.',
            timestamp,
          );
          break;
        case 'component_injected':
          state.injectedComponents = [
            ...state.injectedComponents,
            {
              component: event.payload.component,
              files: event.payload.files ?? [],
            },
          ];
          pushLog(
            'info',
            'generation',
            `Injected ${event.payload.component} component scaffolding.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'mobile_build_started':
          pushLog(
            'info',
            'delivery',
            `Preparing Expo mobile scaffold for ${event.payload.projectName}.`,
            timestamp,
          );
          break;
        case 'mobile_build_ready':
          state.mobile = event.payload;
          pushLog(
            'info',
            'delivery',
            `Mobile scaffold ready for ${event.payload.platforms?.join(', ') ?? 'ios, android'}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'mobile_metadata_generated':
          state.mobileMetadata = event.payload.metadata ?? null;
          pushLog(
            'info',
            'validation',
            `Generated mobile store metadata for ${event.payload.metadata?.name ?? 'the app'}.`,
            timestamp,
          );
          break;
        case 'store_submission_started':
          pushLog(
            'info',
            'delivery',
            'Preparing App Store and Google Play submission packages.',
            timestamp,
          );
          break;
        case 'store_submission_ready':
          state.store = event.payload;
          pushLog(
            'info',
            'delivery',
            'Store submission checklist and listing files are ready.',
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'mobile_build_failed':
          state.mobile = event.payload;
          pushLog(
            'error',
            'delivery',
            event.payload.error ?? 'Mobile build preparation failed.',
            timestamp,
          );
          break;
        case 'store_submission_failed':
          state.store = event.payload;
          pushLog(
            'error',
            'delivery',
            event.payload.error ?? 'Store submission preparation failed.',
            timestamp,
          );
          break;
        case 'unified_api_ready':
          state.unifiedAPI = event.payload;
          pushLog(
            'info',
            'validation',
            `Unified API routing prepared for ${event.payload.apis?.join(', ') || 'internal services'}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'unified_api_failed':
          state.unifiedAPI = event.payload;
          pushLog(
            'error',
            'validation',
            event.payload.error ?? 'Unified API planning failed.',
            timestamp,
          );
          break;
        case 'runtime_monitor_completed':
          state.runtime = event.payload;
          pushLog(
            event.payload.status === 'healthy' ? 'info' : 'error',
            'validation',
            `Runtime monitor completed with status ${event.payload.status}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'runtime_auto_fix_applied':
          pushLog(
            'info',
            'validation',
            event.payload.action ?? 'Runtime auto-fix applied.',
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'runtime_auto_fix_failed':
          pushLog(
            'error',
            'validation',
            event.payload.action ?? 'Runtime auto-fix failed.',
            timestamp,
          );
          break;
        case 'runtime_monitor_failed':
          state.runtime = event.payload;
          pushLog(
            'error',
            'validation',
            event.payload.error ?? 'Runtime monitor failed.',
            timestamp,
          );
          break;
        case 'deployment_started':
          pushLog(
            'info',
            'delivery',
            `Deployment automation started for ${event.payload.projectName}.`,
            timestamp,
          );
          pushStatus({
            orchestrator: {
              state: 'executing',
              detail: 'Deployment automation is running after the build completed.',
            },
            lastTask: {
              state: 'running',
              detail: `Preparing ${event.payload.provider} deployment.`,
            },
            pipeline: createPipeline({
              activeStage: 'delivery',
              completedStages: ['reasoning', 'routing', 'generation', 'validation'],
            }),
          });
          break;
        case 'repo_initialized':
          pushLog(
            'info',
            'delivery',
            'Git repository initialized for deployment automation.',
            timestamp,
          );
          break;
        case 'repo_created':
          pushLog(
            'info',
            'delivery',
            `GitHub repository ready: ${event.payload.repository.htmlUrl}.`,
            timestamp,
          );
          break;
        case 'repo_pushed':
          pushLog(
            'info',
            'delivery',
            `Source pushed to GitHub at commit ${event.payload.repository.commitSha ?? 'HEAD'}.`,
            timestamp,
          );
          break;
        case 'provider_deployment_started':
          pushLog(
            'info',
            'delivery',
            `Deploying via ${event.payload.provider}.`,
            timestamp,
          );
          break;
        case 'provider_deployment_completed':
          state.deployment = event.payload;
          pushLog(
            'info',
            'delivery',
            event.payload.url
              ? `${event.payload.provider} deployment completed at ${event.payload.url}.`
              : `${event.payload.provider} deployment completed.`,
            timestamp,
          );
          break;
        case 'deployment_completed':
          state.deployment = event.payload;
          if (event.payload.url) {
            pushLog(
              'info',
              'delivery',
              `Deployment ready at ${event.payload.url}.`,
              timestamp,
            );
          }
          break;
        case 'deployment_failed':
          state.deployment = event.payload;
          pushLog(
            'error',
            'delivery',
            event.payload.error ?? 'Deployment automation failed.',
            timestamp,
          );
          pushStatus({
            lastTask: {
              state: 'failed',
              detail: event.payload.error ?? 'Deployment automation failed.',
            },
          });
          break;
        case 'autonomous_mode_started':
          state.autonomous = true;
          pushLog(
            'info',
            'routing',
            'Autonomous platform mode started.',
            timestamp,
          );
          break;
        case 'autonomous_product_ready':
          state.product = event.payload;
          pushLog(
            'info',
            'delivery',
            `Autonomous product build ready for ${event.payload.projectName ?? 'the product'}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'business_model_ready':
          state.business = event.payload;
          pushLog(
            'info',
            'validation',
            `Business model ready for ${event.payload.productName ?? 'the product'}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'growth_plan_ready':
          state.growth = event.payload;
          pushLog(
            'info',
            'validation',
            `Growth plan ready for ${event.payload.productName ?? 'the product'}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'autonomous_mode_completed':
          state.autonomous = true;
          state.businessReady = event.payload.businessReady === true;
          state.product = event.payload.product ?? state.product;
          state.business = event.payload.business ?? state.business;
          state.growth = event.payload.growth ?? state.growth;
          pushLog(
            'info',
            'delivery',
            'Autonomous business engine completed.',
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'domain_started':
          pushLog(
            'info',
            'delivery',
            `Domain automation started for ${event.payload.projectName}.`,
            timestamp,
          );
          break;
        case 'domain_suggestions_generated':
          pushLog(
            'info',
            'delivery',
            `Generated ${event.payload.suggestions.length} ranked domain suggestions.`,
            timestamp,
          );
          break;
        case 'domain_checked':
          pushLog(
            'info',
            'delivery',
            `Selected domain candidate ${event.payload.selectedDomain} via ${event.payload.selectedProvider}.`,
            timestamp,
          );
          break;
        case 'domain_ready':
          state.domain = event.payload;
          pushLog(
            'info',
            'delivery',
            `Domain automation ready for ${event.payload.domain}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'domain_failed':
          state.domain = event.payload;
          pushLog(
            'error',
            'delivery',
            event.payload.error ?? 'Domain automation failed.',
            timestamp,
          );
          break;
        case 'dns_configured':
          state.dns = event.payload;
          pushLog(
            'info',
            'delivery',
            `DNS configuration prepared for ${event.payload.domain}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'infrastructure_ready':
          state.infrastructure = event.payload;
          pushLog(
            'info',
            'delivery',
            `Infrastructure plan ready for ${event.payload.projectName}.`,
            timestamp,
          );
          if (Array.isArray(event.payload.generatedFiles) && event.payload.generatedFiles.length > 0) {
            pushFiles(event.payload.generatedFiles);
          }
          break;
        case 'task_failed':
          pushLog(
            'error',
            'delivery',
            event.payload.message ?? 'Task execution failed.',
            timestamp,
          );
          pushStatus({
            orchestrator: {
              state: 'error',
              detail: 'OmniForge backend failed to complete the task.',
            },
            lastTask: {
              state: 'failed',
              detail: event.payload.message ?? 'Task execution failed.',
            },
          });
          settle(() => {
            reject(new Error(event.payload.message ?? 'Task execution failed.'));
          });
          break;
        default:
          break;
      }
    };

    eventSource.onerror = async () => {
      if (settled) {
        return;
      }

      try {
        const snapshot = await getTaskSnapshot(task.taskId);

        if (snapshot.status === 'completed' && snapshot.result) {
          state.intent = snapshot.result.intent;
          state.route = snapshot.result.route;
          state.referenceContext = snapshot.result.referenceContext ?? null;
          state.intelligence = snapshot.result.intelligence ?? null;
          state.finalization = snapshot.result.finalization ?? null;
          state.architecture = snapshot.result.architecture ?? null;
          state.uiState = snapshot.result.uiState ?? null;
          state.cloneStructure = snapshot.result.cloneStructure ?? null;
          state.injectedComponents = snapshot.result.injectedComponents ?? [];
          state.mobile = snapshot.result.mobile ?? null;
          state.mobileMetadata = snapshot.result.mobileMetadata ?? null;
          state.store = snapshot.result.store ?? null;
          state.unifiedAPI = snapshot.result.unifiedAPI ?? null;
          state.runtime = snapshot.result.runtime ?? null;
          state.integrations = snapshot.result.integrations ?? null;
          state.deployment = snapshot.result.deployment ?? null;
          state.domain = snapshot.result.domain ?? null;
          state.dns = snapshot.result.dns ?? null;
          state.infrastructure = snapshot.result.infrastructure ?? null;
          state.product = snapshot.result.product ?? null;
          state.business = snapshot.result.business ?? null;
          state.growth = snapshot.result.growth ?? null;
          state.autonomous = snapshot.result.autonomous === true;
          state.businessReady = snapshot.result.businessReady === true;
          state.memoryContext = snapshot.result.memoryContext ?? null;
          state.decisionLog = snapshot.result.decisionLog ?? [];
          state.memoryUpdated = snapshot.result.memoryUpdated === true;
          state.patternsLearned = snapshot.result.patternsLearned === true;
          state.preferencesUpdated = snapshot.result.preferencesUpdated === true;
          state.validated = snapshot.result.validated === true;
          state.productionReady = snapshot.result.productionReady === true;
          pushFiles(snapshot.result.generatedFiles ?? []);
          pushStatus({
            projectName: snapshot.result.project.projectName,
            routeCategory: snapshot.result.route.category,
            pipeline: createPipeline({
              completedStages: PIPELINE_STAGES.map((stage) => stage.id),
            }),
            engine: {
              state: 'ready',
              detail: 'Reasoning engine is ready for the next authenticated request.',
            },
            memory: {
              state: 'synced',
              detail: 'Runtime memory, project registry, and owned project records are synchronized.',
            },
            orchestrator: {
              state: 'completed',
              detail: 'Autonomous execution completed successfully.',
            },
            lastTask: {
              state: 'completed',
              detail: `Completed ${snapshot.result.intent.goal} for ${snapshot.result.project.projectName}.`,
            },
          });
          settle(() => {
            resolve({
              status: state.status,
              logs: state.logs,
              generatedFiles: state.generatedFiles,
              intent: state.intent,
              route: state.route,
              intelligence: state.intelligence,
              finalization: state.finalization,
              architecture: state.architecture,
              uiState: state.uiState,
              cloneStructure: state.cloneStructure,
              injectedComponents: state.injectedComponents,
              mobile: state.mobile,
              mobileMetadata: state.mobileMetadata,
              store: state.store,
              unifiedAPI: state.unifiedAPI,
              runtime: state.runtime,
              integrations: state.integrations,
              deployment: state.deployment,
              domain: state.domain,
              dns: state.dns,
              infrastructure: state.infrastructure,
              product: state.product,
              business: state.business,
              growth: state.growth,
              autonomous: state.autonomous,
              businessReady: state.businessReady,
              memoryContext: state.memoryContext,
              referenceContext: state.referenceContext,
              decisionLog: state.decisionLog,
              memoryUpdated: state.memoryUpdated,
              patternsLearned: state.patternsLearned,
              preferencesUpdated: state.preferencesUpdated,
              validated: state.validated,
              productionReady: state.productionReady,
            });
          });
          return;
        }

        if (snapshot.status === 'failed') {
          settle(() => {
            reject(new Error(snapshot.error ?? 'OmniForge task failed.'));
          });
        }
      } catch {
        settle(() => {
          reject(new Error('Lost connection to the OmniForge backend.'));
        });
      }
    };
  });
}

export default {
  createInitialSystemStatus,
  runTask,
};
