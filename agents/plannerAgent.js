import { randomUUID } from 'node:crypto';

function assertPlanningPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('Planner payload must be an object.');
  }

  if (!payload.intent || typeof payload.intent !== 'object') {
    throw new TypeError('Planner payload must include an intent object.');
  }
}

function dedupe(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createStep({
  title,
  agent,
  action,
  description,
  dependsOn = [],
  metadata = {},
}) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new TypeError('Plan step title is required.');
  }

  if (typeof agent !== 'string' || agent.trim().length === 0) {
    throw new TypeError(`Plan step "${title}" must include an agent.`);
  }

  if (typeof action !== 'string' || action.trim().length === 0) {
    throw new TypeError(`Plan step "${title}" must include an action.`);
  }

  return {
    id: randomUUID(),
    title: title.trim(),
    agent: agent.trim(),
    action: action.trim(),
    description:
      typeof description === 'string' && description.trim().length > 0
        ? description.trim()
        : title.trim(),
    dependsOn: dedupe(dependsOn),
    metadata,
    status: 'pending',
  };
}

function hasFeature(intent, featureNames) {
  const featureSet = new Set(intent.features ?? []);
  return featureNames.some((featureName) => featureSet.has(featureName));
}

function needsBackend(intent) {
  return (
    intent.projectType === 'full_stack_app' ||
    intent.projectType === 'api_service' ||
    hasFeature(intent, [
      'auth',
      'payments',
      'database',
      'realtime',
      'admin_controls',
      'api_integration',
    ])
  );
}

function needsIntegrations(intent) {
  return (
    intent.goal === 'create_api' ||
    hasFeature(intent, [
      'auth',
      'payments',
      'notifications',
      'api_integration',
      'database',
      'search',
      'realtime',
      'file_uploads',
    ])
  );
}

function needsDeployment(intent) {
  return (
    intent.goal === 'deploy' ||
    intent.goal === 'build_app' ||
    intent.goal === 'modify_app' ||
    intent.projectType === 'api_service' ||
    intent.priority === 'high'
  );
}

function needsDomainWorkflow(intent, route) {
  return (
    intent.goal === 'domain_setup' ||
    route?.category === 'domain_workflow'
  );
}

function buildApplicationSteps(intent, route) {
  const steps = [
    createStep({
      title: 'initialize project',
      agent: 'builder',
      action: 'initialize_project',
      description: 'Create the autonomous workspace, metadata, and base project directories.',
      metadata: {
        phase: 'foundation',
      },
    }),
    createStep({
      title: 'generate frontend',
      agent: 'builder',
      action: 'generate_application',
      description: 'Generate the primary application files from the resolved product intent.',
      metadata: {
        phase: 'application',
      },
    }),
  ];

  if (needsBackend(intent)) {
    steps.push(
      createStep({
        title: 'setup backend',
        agent: 'builder',
        action: 'setup_backend',
        description: 'Prepare backend contracts, service boundaries, and internal endpoints.',
        dependsOn: ['initialize project', 'generate frontend'],
        metadata: {
          phase: 'application',
        },
      }),
    );
  }

  if (needsIntegrations(intent)) {
    steps.push(
      createStep({
        title: 'prepare api integrations',
        agent: 'integration',
        action: 'prepare_api_integrations',
        description: 'Assess external services, select providers, and create integration artifacts.',
        dependsOn: needsBackend(intent)
          ? ['setup backend']
          : ['generate frontend'],
        metadata: {
          phase: 'integration',
        },
      }),
    );
  }

  if (needsDeployment(intent)) {
    steps.push(
      createStep({
        title: 'prepare deployment',
        agent: 'deployment',
        action: 'prepare_deployment',
        description: 'Generate deployment targets, runtime configuration, and environment scaffolding.',
        dependsOn: needsIntegrations(intent)
          ? ['prepare api integrations']
          : needsBackend(intent)
            ? ['setup backend']
            : ['generate frontend'],
        metadata: {
          phase: 'deployment',
        },
      }),
    );
  }

  if (needsDomainWorkflow(intent, route)) {
    steps.push(
      createStep({
        title: 'prepare domain workflow',
        agent: 'deployment',
        action: 'prepare_domain_workflow',
        description: 'Simulate domain suggestions, DNS configuration, and verification records.',
        dependsOn: needsDeployment(intent)
          ? ['prepare deployment']
          : ['generate frontend'],
        metadata: {
          phase: 'domain',
        },
      }),
    );
  }

  return steps;
}

function buildApiSteps(intent, route) {
  const steps = [
    createStep({
      title: 'initialize project',
      agent: 'builder',
      action: 'initialize_project',
      description: 'Create the API workspace and agent execution boundaries.',
      metadata: {
        phase: 'foundation',
      },
    }),
    createStep({
      title: 'setup backend',
      agent: 'builder',
      action: 'generate_api_service',
      description: 'Generate the API service surface and the initial runtime files.',
      dependsOn: ['initialize project'],
      metadata: {
        phase: 'application',
      },
    }),
    createStep({
      title: 'prepare api integrations',
      agent: 'integration',
      action: 'prepare_api_integrations',
      description: 'Create provider mappings, credentials schema, and integration guidance.',
      dependsOn: ['setup backend'],
      metadata: {
        phase: 'integration',
      },
    }),
  ];

  if (needsDeployment(intent)) {
    steps.push(
      createStep({
        title: 'prepare deployment',
        agent: 'deployment',
        action: 'prepare_deployment',
        description: 'Generate deployment artifacts suitable for API delivery.',
        dependsOn: ['prepare api integrations'],
        metadata: {
          phase: 'deployment',
        },
      }),
    );
  }

  if (needsDomainWorkflow(intent, route)) {
    steps.push(
      createStep({
        title: 'prepare domain workflow',
        agent: 'deployment',
        action: 'prepare_domain_workflow',
        description: 'Simulate the domain and DNS structure for the API service.',
        dependsOn: needsDeployment(intent)
          ? ['prepare deployment']
          : ['prepare api integrations'],
        metadata: {
          phase: 'domain',
        },
      }),
    );
  }

  return steps;
}

function buildPlanGraph(intent, route, userInput = '') {
  switch (intent.goal) {
    case 'create_api':
      return buildApiSteps(intent, route);
    case 'deploy':
      if (
        intent.projectType !== 'deployment_workflow' ||
        /build|create|generate|scaffold|landing page|dashboard|site|app/i.test(userInput)
      ) {
        return buildApplicationSteps(intent, route);
      }

      return [
        createStep({
          title: 'initialize project',
          agent: 'builder',
          action: 'initialize_project',
          description: 'Initialize the deployment-ready workspace and runtime directories.',
        }),
        createStep({
          title: 'prepare deployment',
          agent: 'deployment',
          action: 'prepare_deployment',
          description: 'Generate deployment configuration for supported targets.',
          dependsOn: ['initialize project'],
        }),
      ];
    case 'domain_setup':
      return [
        createStep({
          title: 'initialize project',
          agent: 'builder',
          action: 'initialize_project',
          description: 'Initialize the domain workflow workspace.',
        }),
        createStep({
          title: 'prepare domain workflow',
          agent: 'deployment',
          action: 'prepare_domain_workflow',
          description: 'Generate domain suggestions, availability checks, and DNS records.',
          dependsOn: ['initialize project'],
        }),
      ];
    case 'modify_app':
      return [
        createStep({
          title: 'initialize project',
          agent: 'builder',
          action: 'initialize_project',
          description: 'Initialize the modification workspace and preserve execution metadata.',
        }),
        createStep({
          title: 'generate frontend',
          agent: 'builder',
          action: 'apply_project_changes',
          description: 'Generate the updated file set based on the requested modifications.',
          dependsOn: ['initialize project'],
        }),
        createStep({
          title: 'prepare deployment',
          agent: 'deployment',
          action: 'prepare_deployment',
          description: 'Prepare updated deployment artifacts for the revised project slice.',
          dependsOn: ['generate frontend'],
        }),
      ];
    case 'build_app':
    default:
      return buildApplicationSteps(intent, route);
  }
}

export class PlannerAgent {
  createPlan(payload) {
    assertPlanningPayload(payload);

    const { intent, route = null, userInput = '', project = null } = payload;
    const executionGraph = buildPlanGraph(intent, route, userInput);

    return {
      planId: randomUUID(),
      createdAt: new Date().toISOString(),
      projectId: project?.projectId ?? null,
      goal: intent.goal,
      projectType: intent.projectType,
      routeCategory: route?.category ?? 'unknown',
      summary:
        typeof userInput === 'string' && userInput.trim().length > 0
          ? userInput.trim()
          : intent.summary ?? '',
      steps: executionGraph.map((step) => step.title),
      executionGraph,
      recommendations: {
        backendRequired: needsBackend(intent),
        integrationsRequired: needsIntegrations(intent),
        deploymentPreparation: needsDeployment(intent),
        domainWorkflow: needsDomainWorkflow(intent, route),
      },
    };
  }
}

const plannerAgent = new PlannerAgent();

export function createPlan(payload) {
  return plannerAgent.createPlan(payload);
}

export default plannerAgent;
