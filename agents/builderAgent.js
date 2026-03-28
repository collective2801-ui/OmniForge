import path from 'node:path';
import { generateCodeFromIntent } from '../engine/codeGenerator.js';
import { inferDatabase } from '../intelligence/databaseInference.js';
import {
  ensureDirectory,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import { validateFiles } from '../engine/validator.js';

function assertExecutionContext(step, context) {
  if (!step || typeof step !== 'object') {
    throw new TypeError('Builder step must be an object.');
  }

  if (!context || typeof context !== 'object') {
    throw new TypeError('Builder context must be an object.');
  }

  if (typeof context.projectRoot !== 'string' || context.projectRoot.trim().length === 0) {
    throw new TypeError('Builder context must include a projectRoot.');
  }

  if (!context.intent || typeof context.intent !== 'object') {
    throw new TypeError('Builder context must include an intent.');
  }
}

async function writeGeneratedFiles(projectRoot, files) {
  const writtenFiles = [];

  for (const file of files) {
    const absolutePath = path.join(projectRoot, file.path);
    await writeFileSafe(absolutePath, file.content);
    writtenFiles.push({
      path: file.path,
      absolutePath,
    });
  }

  return writtenFiles;
}

function createProjectContextManifest(context) {
  return {
    generatedAt: new Date().toISOString(),
    platform: 'OmniForge',
    projectId: context.project?.projectId ?? null,
    projectName: context.intent.projectName,
    goal: context.intent.goal,
    projectType: context.intent.projectType,
    routeCategory: context.route?.category ?? 'unknown',
    userInput: context.userInput,
    features: context.intent.features ?? [],
    referenceContext: context.intent.referenceContext ?? null,
    planSteps: context.plan?.steps ?? [],
  };
}

function buildServiceContracts(intent) {
  const services = [
    {
      name: 'system',
      purpose: 'Maintain service health, configuration introspection, and execution context.',
      endpoints: [
        {
          method: 'GET',
          path: '/api/health',
          description: 'Report runtime health and deployment readiness.',
        },
        {
          method: 'GET',
          path: '/api/context',
          description: 'Expose the generated execution context for local tooling.',
        },
      ],
    },
  ];

  const featureSet = new Set(intent.features ?? []);

  if (featureSet.has('auth')) {
    services.push({
      name: 'auth',
      purpose: 'Authenticate operators and manage secure session state.',
      endpoints: [
        {
          method: 'POST',
          path: '/api/auth/login',
          description: 'Authenticate a user and create a session.',
        },
        {
          method: 'POST',
          path: '/api/auth/logout',
          description: 'Destroy the current session.',
        },
        {
          method: 'GET',
          path: '/api/auth/session',
          description: 'Retrieve the active session and permission scope.',
        },
      ],
    });
  }

  if (featureSet.has('dashboard')) {
    services.push({
      name: 'dashboard',
      purpose: 'Serve dashboard metrics and product overview data.',
      endpoints: [
        {
          method: 'GET',
          path: '/api/dashboard/summary',
          description: 'Return aggregated KPI data for the dashboard.',
        },
        {
          method: 'GET',
          path: '/api/dashboard/activity',
          description: 'Return recent activity and workflow state.',
        },
      ],
    });
  }

  if (featureSet.has('payments')) {
    services.push({
      name: 'billing',
      purpose: 'Manage checkout, billing sessions, and payment webhooks.',
      endpoints: [
        {
          method: 'POST',
          path: '/api/billing/checkout',
          description: 'Create a checkout session for a selected plan.',
        },
        {
          method: 'POST',
          path: '/api/billing/webhook',
          description: 'Handle billing provider webhook notifications.',
        },
        {
          method: 'GET',
          path: '/api/billing/subscription',
          description: 'Return subscription status and invoice history.',
        },
      ],
    });
  }

  if (featureSet.has('notifications')) {
    services.push({
      name: 'notifications',
      purpose: 'Dispatch transactional or workflow-driven notifications.',
      endpoints: [
        {
          method: 'POST',
          path: '/api/notifications/send',
          description: 'Send a message to the configured delivery provider.',
        },
      ],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    goal: intent.goal,
    projectType: intent.projectType,
    services,
  };
}

function buildBackendOutline(intent) {
  const featureList = (intent.features ?? []).join(', ') || 'core product flows';

  return `# Backend Outline

## Goal

${intent.goal}

## Project Type

${intent.projectType}

## Feature Scope

${featureList}

## Responsibilities

- Maintain a stable internal API surface for the generated project.
- Isolate authentication, billing, and dashboard flows into explicit service boundaries.
- Preserve deployment readiness by keeping runtime assumptions documented and portable.

## Execution Notes

- This outline is generated by the builder agent as an implementation contract.
- External providers and credentials are prepared by the integration agent.
- Deployment targets and runtime envelopes are prepared by the deployment agent.
`;
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildApiSchemaFromIntent(intent) {
  const inferredSchema = inferDatabase(intent.features ?? []);
  const apiSchema = {};

  for (const [table, fields] of Object.entries(inferredSchema)) {
    apiSchema[table] = Array.isArray(fields) ? fields : [];
  }

  if ((intent.features ?? []).includes('dashboard')) {
    apiSchema.dashboard_snapshots = ['metric_name', 'metric_value', 'captured_at'];
  }

  if ((intent.features ?? []).includes('file_uploads')) {
    apiSchema.uploaded_files = ['user_id', 'file_name', 'object_key'];
  }

  return apiSchema;
}

function buildBackendServerSource(intent, serviceContracts) {
  const projectName = intent.projectName ?? 'omniforge-service';
  const featureSet = new Set(intent.features ?? []);
  const stack = intent.technicalDecisions ?? {};
  const apiSchema = buildApiSchemaFromIntent(intent);

  return `import express from 'express';

const port = Number(process.env.PORT || 4000);
const app = express();
const projectContext = ${JSON.stringify(
    {
      projectName,
      goal: intent.goal,
      projectType: intent.projectType,
      features: intent.features ?? [],
      technicalDecisions: stack,
    },
    null,
    2,
  )};
const services = ${JSON.stringify(serviceContracts.services, null, 2)};
const schema = ${JSON.stringify(apiSchema, null, 2)};
let currentSession = ${
    featureSet.has('auth')
      ? `{
  id: 'local-session',
  email: 'builder@omniforge.local',
  role: 'operator',
}`
      : 'null'
  };
let billingState = ${
    featureSet.has('payments')
      ? `{
  plan: 'growth',
  status: 'trialing',
  nextInvoiceDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
}`
      : 'null'
  };
let dashboardSummary = ${
    featureSet.has('dashboard')
      ? `{
  activeUsers: 128,
  conversionRate: 0.37,
  retentionRate: 0.82,
  weeklyGrowth: 0.14,
}`
      : 'null'
  };
let uploadedFiles = [];

app.use(express.json());

app.get('/health', (request, response) => {
  response.json({
    status: 'ok',
    service: projectContext.projectName,
    runtime: 'node',
  });
});

app.get('/api/context', (request, response) => {
  response.json({
    ...projectContext,
    services,
    schema,
  });
});

Object.keys(schema).forEach((table) => {
  app.get(\`/api/\${table}\`, (request, response) => {
    response.json({
      table,
      data: [],
    });
  });
});

${featureSet.has('auth') ? `app.post('/api/auth/login', (request, response) => {
  const payload = request.body ?? {};

  if (typeof payload.email !== 'string' || payload.email.trim().length === 0) {
    response.status(400).json({ error: 'Email is required.' });
    return;
  }

  currentSession = {
    id: 'session-' + Date.now(),
    email: payload.email.trim().toLowerCase(),
    role: 'operator',
  };
  response.json({ session: currentSession });
});

app.post('/api/auth/logout', (request, response) => {
  currentSession = null;
  response.json({ ok: true });
});

app.get('/api/auth/session', (request, response) => {
  response.json({ session: currentSession });
});
` : ''}

${featureSet.has('dashboard') ? `app.get('/api/dashboard/summary', (request, response) => {
  response.json({
    summary: dashboardSummary,
  });
});

app.get('/api/dashboard/activity', (request, response) => {
  response.json({
    activity: [
      { id: 1, label: 'User completed onboarding', timestamp: new Date().toISOString() },
      { id: 2, label: 'Billing reminder scheduled', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: 3, label: 'Dashboard insight generated', timestamp: new Date(Date.now() - 7200000).toISOString() },
    ],
  });
});
` : ''}

${featureSet.has('payments') ? `app.post('/api/billing/checkout', (request, response) => {
  const payload = request.body ?? {};
  response.json({
    checkoutUrl: payload.returnUrl || 'https://billing.local/checkout/session',
    sessionId: 'checkout-' + Date.now(),
  });
});

app.get('/api/billing/subscription', (request, response) => {
  response.json({
    subscription: billingState,
  });
});

app.post('/api/billing/webhook', (request, response) => {
  response.json({
    received: true,
  });
});
` : ''}

${featureSet.has('file_uploads') ? `app.post('/api/files/upload', (request, response) => {
  const payload = request.body ?? {};
  const fileRecord = {
    id: 'file-' + Date.now(),
    name: payload.name || 'uploaded-file',
    uploadedAt: new Date().toISOString(),
  };

  uploadedFiles = [fileRecord, ...uploadedFiles];
  response.status(201).json({ file: fileRecord });
});

app.get('/api/files', (request, response) => {
  response.json({
    files: uploadedFiles,
  });
});
` : ''}

app.use((request, response) => {
  response.status(404).json({
    error: 'Route not found.',
  });
});

app.use((error, request, response, next) => {
  response.status(500).json({
    error: error?.message ?? 'Unexpected server failure.',
  });
});

app.listen(port, () => {
  console.log(\`\${projectContext.projectName} API listening on port \${port}\`);
});
`;
}

function buildDatabaseSchema(intent) {
  const featureSet = new Set(intent.features ?? []);
  const inferredSchema = inferDatabase(intent.features ?? []);
  const statements = [
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists app_users (',
    '  id uuid primary key default gen_random_uuid(),',
    '  email text not null unique,',
    ...(Array.isArray(inferredSchema.users)
      ? ['  password_hash text not null default \'\',']
      : []),
    '  role text not null default \'user\',',
    '  created_at timestamptz not null default now()',
    ');',
    '',
    'create table if not exists workspace_events (',
    '  id uuid primary key default gen_random_uuid(),',
    '  event_type text not null,',
    '  payload jsonb not null default \'{}\'::jsonb,',
    '  created_at timestamptz not null default now()',
    ');',
  ];

  if (featureSet.has('auth')) {
    statements.push(
      '',
      'create table if not exists user_profiles (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid not null references app_users(id) on delete cascade,',
      '  display_name text not null default \'\',',
      '  onboarding_state text not null default \'pending\',',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  if (featureSet.has('dashboard')) {
    statements.push(
      '',
      'create table if not exists dashboard_snapshots (',
      '  id uuid primary key default gen_random_uuid(),',
      '  metric_name text not null,',
      '  metric_value numeric not null default 0,',
      '  captured_at timestamptz not null default now()',
      ');',
    );
  }

  if (Array.isArray(inferredSchema.subscriptions)) {
    statements.push(
      '',
      'create table if not exists subscriptions (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid not null references app_users(id) on delete cascade,',
      '  provider text not null default \'stripe\',',
      '  plan text not null,',
      '  status text not null default \'trialing\',',
      '  renewal_at timestamptz,',
      '  created_at timestamptz not null default now()',
      ');',
      '',
      'create table if not exists billing_events (',
      '  id uuid primary key default gen_random_uuid(),',
      '  subscription_id uuid references subscriptions(id) on delete set null,',
      '  event_type text not null,',
      '  payload jsonb not null default \'{}\'::jsonb,',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  if (featureSet.has('file_uploads')) {
    statements.push(
      '',
      'create table if not exists uploaded_files (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid references app_users(id) on delete set null,',
      '  storage_provider text not null default \'supabase-storage\',',
      '  file_name text not null,',
      '  object_key text not null,',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  return `${statements.join('\n')}\n`;
}

function buildApiReadme(intent, serviceContracts) {
  return `# API Scaffold

## Project

${intent.projectName ?? 'OmniForge Project'}

## Runtime

Node HTTP server scaffold with JSON routes.

## Services

${serviceContracts.services.map((service) => `- ${service.name}: ${service.purpose}`).join('\n')}

## Run

\`\`\`bash
node api/server.js
\`\`\`
`;
}

function isTreatmentRewardsIntent(intent = {}) {
  const source = [
    intent.summary,
    intent.userInput,
    intent.projectName,
    ...(intent.features ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /(reward|prize|spin|wheel)/.test(source) && /(treatment|attendance|ua|screen|client|admin|administrator)/.test(source);
}

function buildTreatmentRewardsPreviewHtml(intent) {
  const projectName = escapeHtml(intent.projectName ?? 'Treatment Rewards Platform');
  const summary = escapeHtml(intent.summary ?? 'Client rewards application');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${projectName} Preview</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        --bg: #04060c;
        --surface: rgba(9, 14, 24, 0.88);
        --surface-soft: rgba(255,255,255,0.05);
        --border: rgba(148,163,184,0.14);
        --text: #f8fbff;
        --muted: #9eb0ce;
        --success: #22c55e;
        --accent: #4f7cff;
        --violet: #7c3aed;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(79,124,255,0.18), transparent 26%),
          radial-gradient(circle at bottom right, rgba(34,197,94,0.16), transparent 28%),
          linear-gradient(180deg, #04060c 0%, #070b13 52%, #030408 100%);
        color: var(--text);
      }
      h1, h2, h3, p { margin: 0; }
      p { color: var(--muted); }
      main {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 24px 0 36px;
        display: grid;
        gap: 20px;
      }
      .topbar,
      .admin-shell,
      .flash {
        border: 1px solid var(--border);
        background: var(--surface);
        box-shadow: 0 28px 72px rgba(2, 6, 23, 0.34);
        backdrop-filter: blur(18px);
      }
      .topbar,
      .admin-shell {
        border-radius: 28px;
      }
      .topbar {
        padding: 24px 26px;
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 16px;
      }
      .eyebrow,
      .kicker {
        display: inline-flex;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-size: 12px;
        font-weight: 700;
      }
      .eyebrow { color: #6ee7b7; margin-bottom: 12px; }
      .summary {
        max-width: 660px;
        margin-top: 10px;
        line-height: 1.5;
      }
      .role-switcher {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: rgba(255,255,255,0.05);
        border: 1px solid var(--border);
        width: fit-content;
      }
      .role-button,
      .spin-button,
      .admin-form button,
      .row-actions button {
        border: 0;
        border-radius: 14px;
        cursor: pointer;
      }
      .role-button {
        padding: 12px 14px;
        background: transparent;
        color: #dbe6f7;
      }
      .role-button.active,
      .spin-button,
      .admin-form button,
      .row-actions button.eligible {
        background: linear-gradient(135deg, var(--success), var(--accent));
        color: #041019;
        font-weight: 700;
      }
      .preview-grid {
        display: grid;
        grid-template-columns: minmax(360px, 420px) minmax(0, 1fr);
        gap: 22px;
        align-items: start;
      }
      .phone-shell {
        border-radius: 46px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: linear-gradient(180deg, rgba(18, 19, 28, 1), rgba(5, 5, 9, 1));
        padding: 16px;
        box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45);
      }
      .phone-notch {
        width: 34%;
        height: 28px;
        border-radius: 999px;
        margin: 0 auto 12px;
        background: rgba(5,5,8,0.98);
      }
      .phone-screen {
        border-radius: 34px;
        min-height: 760px;
        padding: 18px 18px 22px;
        background:
          radial-gradient(circle at top right, rgba(79,124,255,0.2), transparent 30%),
          linear-gradient(180deg, #f5f7fb 0%, #edf2fa 100%);
        color: #10223a;
        display: grid;
        gap: 16px;
      }
      .mobile-status {
        display: flex;
        justify-content: space-between;
        color: #1f2937;
        font-size: 13px;
        font-weight: 700;
      }
      .mobile-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .mobile-brand {
        display: grid;
        gap: 4px;
      }
      .mobile-brand small {
        color: #64748b;
        font-weight: 700;
      }
      .mobile-brand strong {
        font-size: 1.8rem;
        line-height: 1;
      }
      .upgrade-chip {
        border-radius: 999px;
        padding: 0.6rem 0.9rem;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        color: #c4b5fd;
        font-weight: 700;
        font-size: 0.78rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .hero-card {
        border-radius: 26px;
        padding: 18px;
        background:
          radial-gradient(circle at right bottom, rgba(34, 197, 94, 0.22), transparent 32%),
          linear-gradient(135deg, rgba(79, 124, 255, 0.28), rgba(100, 116, 139, 0.74));
        box-shadow: 0 18px 38px rgba(15, 23, 42, 0.18);
        display: grid;
        gap: 12px;
      }
      .hero-card h2 {
        font-size: 2rem;
        line-height: 0.96;
        color: #10334d;
      }
      .hero-card p {
        color: rgba(16, 51, 77, 0.72);
      }
      .hero-card button {
        width: fit-content;
        border: 0;
        border-radius: 16px;
        padding: 0.95rem 1.2rem;
        background: var(--accent);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }
      .wheel-card,
      .metric-strip,
      .admin-shell,
      .flash,
      .client-row {
        border: 1px solid rgba(148, 163, 184, 0.12);
      }
      .wheel-card,
      .metric-strip {
        border-radius: 24px;
        background: rgba(255,255,255,0.78);
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
      }
      .wheel-card {
        padding: 16px;
        display: grid;
        gap: 16px;
      }
      .section-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: end;
      }
      .kicker {
        color: #4f46e5;
        margin-bottom: 6px;
      }
      .section-head h2 {
        color: #10223a;
      }
      select,
      input {
        width: 100%;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(255,255,255,0.92);
        color: #10223a;
      }
      .wheel {
        display: grid;
        grid-template-columns: repeat(2, minmax(0,1fr));
        gap: 10px;
      }
      .segment {
        min-height: 88px;
        border-radius: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 14px;
        font-weight: 700;
        color: #10223a;
        background: rgba(79, 124, 255, 0.08);
        border: 1px solid rgba(79,124,255,0.12);
      }
      .segment.active {
        background: linear-gradient(135deg, rgba(79,124,255,0.18), rgba(34,197,94,0.18));
        border-color: rgba(79,124,255,0.3);
        box-shadow: 0 10px 24px rgba(79,124,255,0.16);
        transform: translateY(-2px);
      }
      .metric-strip {
        padding: 14px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      .status-card {
        border-radius: 18px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.04);
      }
      .status-card span {
        display: block;
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .status-card strong {
        color: #10223a;
        font-size: 1rem;
      }
      .bottom-nav {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        padding-top: 4px;
      }
      .bottom-nav button {
        border: 0;
        background: transparent;
        color: #64748b;
        padding: 0.6rem 0.4rem;
        border-radius: 16px;
        font-weight: 700;
      }
      .bottom-nav button.active {
        background: rgba(79,124,255,0.12);
        color: #2563eb;
      }
      .admin-shell {
        padding: 24px;
        display: grid;
        gap: 16px;
      }
      .admin-shell h2,
      .admin-shell h3 {
        color: #f8fbff;
      }
      .admin-shell .section-head h2 {
        color: #f8fbff;
      }
      .admin-copy {
        line-height: 1.55;
      }
      .admin-form,
      .client-list,
      .row-actions {
        display: grid;
        gap: 12px;
      }
      .admin-form {
        grid-template-columns: minmax(0,1fr) auto;
      }
      .client-row {
        border-radius: 20px;
        padding: 16px;
        background: rgba(255,255,255,0.04);
        display: grid;
        gap: 14px;
      }
      .client-row p {
        margin-top: 6px;
      }
      .row-actions {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .row-actions button {
        padding: 12px 14px;
        background: rgba(255,255,255,0.05);
        color: white;
        border: 1px solid rgba(148,163,184,0.14);
      }
      .row-actions button.done {
        color: #86efac;
        border-color: rgba(34,197,94,0.34);
      }
      .flash {
        border-radius: 22px;
        padding: 16px 18px;
        background: rgba(255,255,255,0.06);
        color: #dbeafe;
      }
      body[data-role="admin"] .phone-shell {
        opacity: 0.9;
      }
      body[data-role="admin"] .admin-shell {
        border-color: rgba(79,124,255,0.28);
        box-shadow: 0 24px 70px rgba(79,124,255,0.12);
      }
      @media (max-width: 980px) {
        .preview-grid,
        .metric-strip,
        .admin-form,
        .row-actions {
          grid-template-columns: 1fr;
        }
        .phone-screen {
          min-height: auto;
        }
      }
    </style>
  </head>
  <body data-role="client">
    <main>
      <section class="topbar">
        <div>
          <span class="eyebrow">Finished product preview</span>
          <h1>${projectName}</h1>
          <p class="summary">${summary}</p>
        </div>
        <div class="role-switcher">
          <button class="role-button active" id="client-role" type="button" data-role="client">Client</button>
          <button class="role-button" id="admin-role" type="button" data-role="admin">Administrator</button>
        </div>
      </section>

      <section class="preview-grid">
        <section class="phone-shell">
          <div class="phone-notch"></div>
          <div class="phone-screen">
            <div class="mobile-status">
              <span>17:08</span>
              <span>5G • 100%</span>
            </div>

            <div class="mobile-header">
              <div class="mobile-brand">
                <small>Hello there!</small>
                <strong>${projectName}</strong>
              </div>
              <span class="upgrade-chip">Program Ready</span>
            </div>

            <section class="hero-card">
              <div>
                <h2>Spin to reward progress</h2>
                <p>Clients unlock the wheel once attendance and consistent UA are marked complete.</p>
              </div>
              <button class="spin-button" id="spin-button" type="button">Spin wheel</button>
            </section>

            <section class="wheel-card">
              <div class="section-head">
                <div>
                  <span class="kicker">Client experience</span>
                  <h2>Reward wheel</h2>
                </div>
                <select id="client-select"></select>
              </div>
              <div class="wheel" id="wheel"></div>
            </section>

            <section class="metric-strip">
              <article class="status-card"><span>Eligibility</span><strong id="eligibility-label">Ready to spin</strong></article>
              <article class="status-card"><span>Last prize</span><strong id="prize-label">No prize awarded yet</strong></article>
              <article class="status-card"><span>Spin state</span><strong id="spin-state-value">Available</strong></article>
            </section>

            <section class="metric-strip">
              <article class="status-card"><span>Attendance</span><strong id="attendance-value">Complete</strong></article>
              <article class="status-card"><span>Consistent UA</span><strong id="ua-value">Complete</strong></article>
              <article class="status-card"><span>Client role</span><strong id="client-role-label">Client</strong></article>
            </section>

            <nav class="bottom-nav">
              <button class="active" type="button">Home</button>
              <button type="button">Rewards</button>
              <button type="button">History</button>
              <button type="button">Settings</button>
            </nav>
          </div>
        </section>

        <aside class="admin-shell">
          <div class="section-head">
            <div>
              <span class="kicker">Administrator panel</span>
              <h2>Staff controls</h2>
            </div>
          </div>
          <p class="admin-copy">Add or remove clients, mark attendance, confirm consistent UA, and reset spin eligibility from one place.</p>
          <form class="admin-form" id="add-client-form">
            <input id="new-client-name" placeholder="Add a new client" />
            <button type="submit">Add client</button>
          </form>
          <div class="client-list" id="client-list"></div>
        </aside>
      </section>

      <div class="flash" id="flash-copy">Preview ready. Toggle attendance and UA completion to unlock the wheel.</div>
    </main>

    <script>
      const prizes = ['$5 Gift Card', 'Coffee Voucher', 'Snack Pack', 'Transit Pass', 'Bonus Phone Minutes', 'Wellness Journal'];
      const clients = [
        { id: 1, name: 'Jordan M.', attendanceDone: true, uaComplete: true, hasSpun: false, lastPrize: null },
        { id: 2, name: 'Taylor R.', attendanceDone: true, uaComplete: false, hasSpun: false, lastPrize: null },
        { id: 3, name: 'Alex P.', attendanceDone: false, uaComplete: false, hasSpun: false, lastPrize: null },
      ];
      let activeClientId = clients[0].id;
      let winningIndex = null;

      const wheelEl = document.getElementById('wheel');
      const clientSelectEl = document.getElementById('client-select');
      const clientListEl = document.getElementById('client-list');
      const flashEl = document.getElementById('flash-copy');
      const eligibilityLabelEl = document.getElementById('eligibility-label');
      const prizeLabelEl = document.getElementById('prize-label');
      const attendanceValueEl = document.getElementById('attendance-value');
      const uaValueEl = document.getElementById('ua-value');
      const spinStateValueEl = document.getElementById('spin-state-value');
      const spinButtonEl = document.getElementById('spin-button');
      const clientRoleLabelEl = document.getElementById('client-role-label');
      const roleButtons = document.querySelectorAll('[data-role]');
      let activeRole = 'client';

      function randomIndex(length) {
        if (window.crypto && window.crypto.getRandomValues) {
          const buffer = new Uint32Array(1);
          window.crypto.getRandomValues(buffer);
          return buffer[0] % length;
        }
        return Math.floor(Math.random() * length);
      }

      function getActiveClient() {
        return clients.find((client) => client.id === activeClientId) || null;
      }

      function isEligible(client) {
        return !!client && client.attendanceDone && client.uaComplete && !client.hasSpun;
      }

      function renderWheel() {
        wheelEl.innerHTML = prizes.map((prize, index) => '<div class="segment' + (winningIndex === index ? ' active' : '') + '">' + prize + '</div>').join('');
      }

      function renderSelect() {
        clientSelectEl.innerHTML = clients.map((client) => '<option value="' + client.id + '">' + client.name + '</option>').join('');
        clientSelectEl.value = String(activeClientId);
      }

      function renderStatus() {
        const client = getActiveClient();
        const eligible = isEligible(client);
        eligibilityLabelEl.textContent = eligible ? 'Ready to spin' : 'Needs admin approval';
        prizeLabelEl.textContent = client && client.lastPrize ? client.lastPrize : 'No prize awarded yet';
        attendanceValueEl.textContent = client && client.attendanceDone ? 'Complete' : 'Pending';
        uaValueEl.textContent = client && client.uaComplete ? 'Complete' : 'Pending';
        spinStateValueEl.textContent = client && client.hasSpun ? 'Already used' : 'Available';
        clientRoleLabelEl.textContent = activeRole === 'admin' ? 'Admin view' : 'Client';
        spinButtonEl.disabled = !eligible;
      }

      function renderClients() {
        clientListEl.innerHTML = clients.map((client) => '<article class="row">\n  <div><strong>' + client.name + '</strong><p>' + (client.lastPrize ? 'Last prize: ' + client.lastPrize : 'No prize awarded yet.') + '</p></div>\n  <div class="row-actions">\n    <button type="button" data-action="attendance" data-id="' + client.id + '" class="' + (client.attendanceDone ? 'done' : '') + '">Attendance</button>\n    <button type="button" data-action="ua" data-id="' + client.id + '" class="' + (client.uaComplete ? 'done' : '') + '">UA complete</button>\n    <button type="button" data-action="eligible" data-id="' + client.id + '" class="eligible">Mark eligible</button>\n    <button type="button" data-action="reset" data-id="' + client.id + '">Reset spin</button>\n  </div>\n</article>').join('');
      }

      function renderRole() {
        document.body.dataset.role = activeRole;
        roleButtons.forEach((button) => {
          button.classList.toggle('active', button.dataset.role === activeRole);
        });
        renderStatus();
      }

      function render() {
        renderWheel();
        renderSelect();
        renderStatus();
        renderClients();
      }

      clientSelectEl.addEventListener('change', (event) => {
        activeClientId = Number(event.target.value);
        renderStatus();
      });

      spinButtonEl.addEventListener('click', () => {
        const client = getActiveClient();
        if (!isEligible(client)) {
          flashEl.textContent = 'This client still needs attendance and a consistent UA before spinning.';
          return;
        }
        winningIndex = randomIndex(prizes.length);
        client.hasSpun = true;
        client.lastPrize = prizes[winningIndex];
        flashEl.textContent = client.name + ' won ' + client.lastPrize + '.';
        render();
      });

      roleButtons.forEach((button) => {
        button.addEventListener('click', () => {
          activeRole = button.dataset.role || 'client';
          flashEl.textContent = activeRole === 'admin'
            ? 'Administrator view active. Manage clients and reset eligibility here.'
            : 'Client view active. Choose a client and spin when the requirements are complete.';
          renderRole();
        });
      });

      document.getElementById('add-client-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('new-client-name');
        const value = input.value.trim();
        if (!value) {
          flashEl.textContent = 'Enter a client name before adding them.';
          return;
        }
        const nextClient = { id: Date.now(), name: value, attendanceDone: false, uaComplete: false, hasSpun: false, lastPrize: null };
        clients.unshift(nextClient);
        activeClientId = nextClient.id;
        input.value = '';
        flashEl.textContent = value + ' added to the reward roster.';
        render();
      });

      clientListEl.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const client = clients.find((entry) => entry.id === Number(button.dataset.id));
        if (!client) return;
        const action = button.dataset.action;
        if (action === 'attendance') client.attendanceDone = !client.attendanceDone;
        if (action === 'ua') client.uaComplete = !client.uaComplete;
        if (action === 'eligible') { client.attendanceDone = true; client.uaComplete = true; client.hasSpun = false; }
        if (action === 'reset') { client.hasSpun = false; client.lastPrize = null; winningIndex = null; }
        flashEl.textContent = client.name + ' updated.';
        render();
      });

      render();
      renderRole();
    </script>
  </body>
</html>`;
}

function buildPreviewHtml(intent) {
  if (isTreatmentRewardsIntent(intent)) {
    return buildTreatmentRewardsPreviewHtml(intent);
  }

  const featureSet = new Set(intent.features ?? []);
  const referenceBranding = intent.referenceContext?.branding ?? {};
  const dominantColor =
    Array.isArray(referenceBranding?.dominantColors) && referenceBranding.dominantColors.length > 0
      ? referenceBranding.dominantColors[0]
      : '#38bdf8';
  const accentColor =
    dominantColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(dominantColor)
      ? dominantColor
      : '#38bdf8';
  const projectName = escapeHtml(intent.projectName ?? 'OmniForge Product');
  const projectType = titleCase(intent.projectType ?? 'web app');
  const summary = intent.summary ?? 'A generated product preview';
  const sourceTokens = `${intent.projectType ?? ''} ${intent.summary ?? ''} ${(intent.features ?? []).join(' ')}`.toLowerCase();
  const hasScanner = /\b(scan|scanner|barcode|camera|qr)\b/.test(sourceTokens);
  const hasPayments =
    featureSet.has('payments') || /\b(payment|billing|subscription|checkout|premium|cart)\b/.test(sourceTokens);
  const hasAuth =
    featureSet.has('auth') ||
    featureSet.has('user_auth') ||
    /\b(auth|login|account|session|user)\b/.test(sourceTokens);
  const hasAdmin =
    featureSet.has('admin_controls') ||
    featureSet.has('user_management') ||
    /\b(admin|administrator|operator|staff|management|backoffice)\b/.test(sourceTokens);
  const hasNotifications =
    featureSet.has('notifications') || /\b(notification|alert|reminder|message)\b/.test(sourceTokens);
  const hasUploads =
    featureSet.has('file_uploads') || /\b(upload|attachment|file|document|image)\b/.test(sourceTokens);
  const hasDashboard =
    featureSet.has('dashboard') || /\b(dashboard|analytics|reporting|insight|metrics)\b/.test(sourceTokens);
  const isMobileLike =
    intent.projectType === 'mobile_app' ||
    /\b(mobile|scanner|camera|cart|profile|notification|expo)\b/.test(sourceTokens);
  const primaryActionLabel = hasScanner
    ? 'Open Scanner'
    : hasPayments
      ? 'Open Checkout'
      : hasAdmin
        ? 'Open Operations'
        : 'Launch Workspace';
  const heroTitle = hasScanner
    ? 'Start Scanning'
    : hasAdmin
      ? 'Run Your Team'
      : hasPayments
        ? 'Convert New Revenue'
        : 'Run the Product';
  const heroDescription = hasScanner
    ? 'Scan live inputs, review results, and route the next action from one interactive surface.'
    : hasAdmin
      ? 'Track workflow progress, unlock actions, and keep operators aligned without leaving the main workspace.'
      : hasPayments
        ? 'Move users from activation to paid conversion with a clear billing and upgrade path.'
        : 'Everything important lives in one working product surface: actions, status, and the next task.';
  const featureLabels = [...featureSet]
    .slice(0, 6)
    .map((feature) => titleCase(feature.replace(/_/g, ' ')));
  const quickLinks = [
    hasScanner ? 'Scanner' : 'Workspace',
    hasDashboard ? 'Dashboard' : 'Activity',
    hasPayments ? 'Billing' : 'Tasks',
    hasAdmin ? 'Admin' : 'Profile',
  ];
  const metricCards = [
    { label: hasScanner ? 'Scans today' : 'Tasks open', value: hasScanner ? '24' : '18' },
    { label: hasPayments ? 'MRR' : 'Completions', value: hasPayments ? '$4.8k' : '86%' },
    { label: hasNotifications ? 'Alerts' : 'Response time', value: hasNotifications ? '3' : '4.2m' },
  ];
  const activitySeed = [
    hasScanner ? 'Product scan completed and categorized.' : 'Primary workflow completed and logged.',
    hasAdmin ? 'Admin review queue updated with a new action item.' : 'Customer-facing workspace refreshed successfully.',
    hasPayments ? 'Upgrade prompt converted a user into a paid plan.' : 'A follow-up task was scheduled for the next milestone.',
  ];
  const navItems = [
    'Home',
    hasScanner ? 'Scan' : 'Tasks',
    hasDashboard ? 'History' : 'Reports',
    hasPayments ? 'Billing' : 'Inbox',
    hasAdmin ? 'Admin' : 'Settings',
  ];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${projectName} Preview</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, "SF Pro Display", "Segoe UI", sans-serif;
        --accent: ${accentColor};
        --accent-soft: color-mix(in srgb, ${accentColor} 14%, white);
        --surface: #ffffff;
        --surface-soft: #f3f5f8;
        --surface-deep: #e9eef5;
        --border: rgba(15, 23, 42, 0.08);
        --text: #111827;
        --muted: #6b7280;
        --success: #16a34a;
        --shadow: 0 22px 44px rgba(15, 23, 42, 0.14);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          radial-gradient(circle at top, rgba(59, 130, 246, 0.12), transparent 32%),
          linear-gradient(180deg, #edf2f7 0%, #dbe6f3 100%);
        color: var(--text);
      }

      main {
        width: 100%;
        margin: 0 auto;
        min-height: 100vh;
        padding: ${isMobileLike ? '20px 18px 26px' : '24px 22px 30px'};
      }

      button,
      input {
        font: inherit;
      }

      button {
        border: 0;
        cursor: pointer;
      }

      .screen {
        width: min(${isMobileLike ? '100%' : '1000px'}, 100%);
        margin: 0 auto;
        padding: ${isMobileLike ? '12px' : '18px'};
        border-radius: ${isMobileLike ? '34px' : '32px'};
        background: rgba(12, 20, 34, 0.96);
        box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28);
      }

      .screen-inner {
        min-height: calc(100vh - 64px);
        border-radius: ${isMobileLike ? '26px' : '24px'};
        background: var(--surface);
        overflow: hidden;
      }

      .status-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 18px 0;
        color: white;
        font-size: 0.82rem;
        font-weight: 700;
      }

      .screen-body {
        padding: 16px 16px 20px;
      }

      .app-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 16px;
      }

      .app-title {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .avatar {
        width: 52px;
        height: 52px;
        border-radius: 16px;
        background:
          radial-gradient(circle at 30% 30%, rgba(255,255,255,0.24), transparent 34%),
          linear-gradient(135deg, var(--accent), #111827 80%);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.24);
      }

      .header-copy small {
        display: block;
        margin-bottom: 2px;
        color: var(--muted);
        font-size: 0.92rem;
        font-weight: 600;
      }

      .header-copy h1 {
        margin: 0;
        font-size: ${isMobileLike ? '1.95rem' : '2.2rem'};
        line-height: 0.96;
        letter-spacing: -0.05em;
      }

      .upgrade-chip,
      .pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 999px;
        padding: 0.56rem 0.92rem;
        background: rgba(17, 24, 39, 0.96);
        color: white;
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .hero-card {
        position: relative;
        overflow: hidden;
        display: grid;
        gap: 16px;
        margin-bottom: 18px;
        padding: 18px;
        border-radius: 24px;
        background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, #4f5d75), #64748b);
        box-shadow: var(--shadow);
      }

      .hero-card::after {
        content: '';
        position: absolute;
        right: -36px;
        bottom: -42px;
        width: 164px;
        height: 164px;
        border-radius: 999px;
        background:
          radial-gradient(circle at 35% 35%, rgba(255,255,255,0.28), transparent 38%),
          radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--accent) 35%, #111827), transparent 72%);
        filter: blur(0.2px);
      }

      .hero-copy {
        position: relative;
        z-index: 1;
        max-width: 72%;
      }

      .hero-copy h2 {
        margin: 0 0 8px;
        font-size: ${isMobileLike ? '1.95rem' : '2.2rem'};
        line-height: 0.96;
        letter-spacing: -0.05em;
        color: #0f172a;
      }

      .hero-copy p {
        margin: 0;
        color: rgba(15, 23, 42, 0.76);
        line-height: 1.55;
        font-weight: 520;
      }

      .hero-actions {
        position: relative;
        z-index: 1;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .primary-button,
      .secondary-button,
      .mini-link,
      .nav-button {
        transition: transform 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
      }

      .primary-button:hover,
      .secondary-button:hover,
      .mini-link:hover,
      .nav-button:hover {
        transform: translateY(-1px);
      }

      .primary-button {
        min-height: 48px;
        padding: 0 18px;
        border-radius: 16px;
        background: #2563eb;
        color: white;
        font-weight: 800;
        box-shadow: 0 14px 26px rgba(37, 99, 235, 0.28);
      }

      .secondary-button {
        min-height: 48px;
        padding: 0 16px;
        border-radius: 16px;
        background: rgba(255,255,255,0.18);
        color: #0f172a;
        font-weight: 700;
      }

      .section {
        display: grid;
        gap: 12px;
        margin-bottom: 18px;
      }

      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .section-head h3 {
        margin: 0;
        font-size: 1.28rem;
      }

      .mini-link {
        color: #2563eb;
        background: transparent;
        font-weight: 700;
      }

      .card,
      .activity-card,
      .workspace-panel {
        border: 1px solid var(--border);
        border-radius: 22px;
        background: var(--surface-soft);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.44);
      }

      .activity-list {
        display: grid;
        gap: 10px;
      }

      .activity-card {
        padding: 14px 16px;
      }

      .activity-card strong {
        display: block;
        margin-bottom: 4px;
      }

      .activity-card p,
      .workspace-panel p {
        margin: 0;
        color: var(--muted);
        line-height: 1.5;
      }

      .metrics-grid,
      .quick-grid {
        display: grid;
        gap: 12px;
      }

      .metrics-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .metric-card {
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--surface);
      }

      .metric-card span {
        display: block;
        margin-bottom: 6px;
        color: var(--muted);
        font-size: 0.82rem;
      }

      .metric-card strong {
        font-size: 1.35rem;
        letter-spacing: -0.03em;
      }

      .quick-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .quick-link {
        display: grid;
        gap: 6px;
        padding: 16px;
        border: 1px solid var(--border);
        border-radius: 20px;
        background: var(--surface);
        text-align: left;
      }

      .quick-link__icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--accent) 14%, white);
        color: var(--accent);
        font-weight: 800;
      }

      .workspace-panel {
        padding: 18px;
      }

      .workspace-panel__header {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .workspace-panel__header h3 {
        margin: 0 0 4px;
        font-size: 1.18rem;
      }

      .workspace-content {
        display: grid;
        gap: 12px;
      }

      .state-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 16px;
        background: rgba(255,255,255,0.58);
      }

      .state-row strong {
        display: block;
      }

      .state-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--success);
      }

      .input-row {
        display: flex;
        gap: 10px;
      }

      .input-row input {
        flex: 1;
        min-width: 0;
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 14px;
        padding: 0.95rem 1rem;
        background: rgba(255,255,255,0.86);
        color: var(--text);
      }

      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .bottom-nav {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 8px;
        padding: 12px 12px 14px;
        border-top: 1px solid rgba(15, 23, 42, 0.06);
        background: rgba(255,255,255,0.96);
      }

      .nav-button {
        display: grid;
        justify-items: center;
        gap: 5px;
        padding: 8px 6px;
        border-radius: 16px;
        background: transparent;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 700;
      }

      .nav-button.active {
        color: #2563eb;
        background: rgba(37, 99, 235, 0.08);
      }

      .nav-button__icon {
        width: 28px;
        height: 28px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        background: rgba(15, 23, 42, 0.06);
      }

      .nav-button.active .nav-button__icon {
        background: rgba(37, 99, 235, 0.14);
      }

      .banner {
        padding: 12px 14px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--accent) 12%, white);
        color: #0f172a;
        font-weight: 600;
      }

      @media (max-width: 720px) {
        .hero-copy {
          max-width: 100%;
        }

        .metrics-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="screen">
        <div class="status-bar">
          <span>Rendered product preview</span>
          <span>${escapeHtml(projectType)}</span>
        </div>
        <div class="screen-inner">
          <div class="screen-body">
            <header class="app-header">
              <div class="app-title">
                <div class="avatar" aria-hidden="true"></div>
                <div class="header-copy">
                  <small>${hasAuth ? 'Hello there!' : 'Ready to launch'}</small>
                  <h1>${projectName}</h1>
                </div>
              </div>
              <button class="${hasPayments ? 'upgrade-chip' : 'pill'}" id="top-action" type="button">
                ${hasPayments ? 'Upgrade' : 'Live Ready'}
              </button>
            </header>

            <section class="hero-card">
              <div class="hero-copy">
                <h2>${escapeHtml(heroTitle)}</h2>
                <p>${escapeHtml(heroDescription)}</p>
              </div>
              <div class="hero-actions">
                <button class="primary-button" id="primary-action" type="button">${escapeHtml(primaryActionLabel)}</button>
                <button class="secondary-button" id="secondary-action" type="button">View ${hasDashboard ? 'Dashboard' : 'Details'}</button>
              </div>
            </section>

            <section class="section">
              <div class="section-head">
                <h3>Recent Activity</h3>
                <button class="mini-link" id="refresh-activity" type="button">Refresh</button>
              </div>
              <div class="activity-list" id="activity-list"></div>
            </section>

            <section class="section">
              <div class="section-head">
                <h3>Performance</h3>
                <span class="pill">${escapeHtml(projectType)}</span>
              </div>
              <div class="metrics-grid" id="metrics-grid"></div>
            </section>

            <section class="section">
              <div class="section-head">
                <h3>Quick Links</h3>
                <button class="mini-link" id="toggle-panel" type="button">Open</button>
              </div>
              <div class="quick-grid" id="quick-grid"></div>
            </section>

            <section class="section">
              <div class="workspace-panel">
                <div class="workspace-panel__header">
                  <div>
                    <h3 id="workspace-title">Working Surface</h3>
                    <p id="workspace-summary">${escapeHtml(summary)}</p>
                  </div>
                  <span class="pill" id="workspace-pill">Ready</span>
                </div>
                <div class="workspace-content" id="workspace-content"></div>
              </div>
            </section>
          </div>

          <nav class="bottom-nav" id="bottom-nav"></nav>
        </div>
      </section>
    </main>
    <script>
      const state = {
        signedIn: ${hasAuth ? 'false' : 'true'},
        premium: false,
        activeTab: 'Home',
        activity: ${JSON.stringify(activitySeed)},
        metrics: ${JSON.stringify(metricCards)},
        features: ${JSON.stringify(featureLabels)},
        quickLinks: ${JSON.stringify(quickLinks)},
        alerts: ${hasNotifications ? 3 : 0},
        uploads: ${hasUploads ? 2 : 0},
      };

      const navItems = ${JSON.stringify(navItems)};
      const hasScanner = ${hasScanner ? 'true' : 'false'};
      const hasPayments = ${hasPayments ? 'true' : 'false'};
      const hasAuth = ${hasAuth ? 'true' : 'false'};
      const hasAdmin = ${hasAdmin ? 'true' : 'false'};
      const hasNotifications = ${hasNotifications ? 'true' : 'false'};
      const hasUploads = ${hasUploads ? 'true' : 'false'};

      const activityListEl = document.getElementById('activity-list');
      const metricsGridEl = document.getElementById('metrics-grid');
      const quickGridEl = document.getElementById('quick-grid');
      const workspaceTitleEl = document.getElementById('workspace-title');
      const workspaceSummaryEl = document.getElementById('workspace-summary');
      const workspaceContentEl = document.getElementById('workspace-content');
      const workspacePillEl = document.getElementById('workspace-pill');
      const bottomNavEl = document.getElementById('bottom-nav');
      const topActionEl = document.getElementById('top-action');

      function renderActivity() {
        activityListEl.innerHTML = state.activity.map((item, index) => '<article class="activity-card"><strong>Update ' + (index + 1) + '</strong><p>' + item + '</p></article>').join('');
      }

      function renderMetrics() {
        metricsGridEl.innerHTML = state.metrics.map((card) => '<article class="metric-card"><span>' + card.label + '</span><strong>' + card.value + '</strong></article>').join('');
      }

      function renderQuickLinks() {
        quickGridEl.innerHTML = state.quickLinks.map((label) => '<button class="quick-link" data-link=\"' + label + '\" type=\"button\"><span class="quick-link__icon">' + label.charAt(0) + '</span><strong>' + label + '</strong><p>Open the ' + label.toLowerCase() + ' workflow.</p></button>').join('');
      }

      function renderBottomNav() {
        bottomNavEl.innerHTML = navItems.map((label) => '<button class=\"nav-button' + (state.activeTab === label ? ' active' : '') + '\" data-tab=\"' + label + '\" type=\"button\"><span class=\"nav-button__icon\">' + label.charAt(0) + '</span><span>' + label + '</span></button>').join('');
      }

      function renderWorkspace() {
        const tab = state.activeTab;

        if (tab === 'Home') {
          workspaceTitleEl.textContent = state.signedIn ? 'Live workspace' : 'Access required';
          workspaceSummaryEl.textContent = state.signedIn
            ? 'This interactive preview is simulating the main product surface with working state changes.'
            : 'Sign in to unlock the main workflow and feature actions.';
          workspacePillEl.textContent = state.signedIn ? 'Online' : 'Locked';
          workspaceContentEl.innerHTML = state.signedIn
            ? '<div class=\"state-row\"><div><strong>Main workflow</strong><p>' + ${JSON.stringify(heroDescription)} + '</p></div><span class=\"state-dot\"></span></div><div class=\"pill-row\">' + state.features.map((feature) => '<span class=\"pill\">' + feature + '</span>').join('') + '</div>'
            : '<div class=\"input-row\"><input id=\"email-input\" placeholder=\"operator@company.com\" /><button class=\"primary-button\" id=\"sign-in-button\" type=\"button\">Sign In</button></div><div class=\"banner\">Use the interactive demo sign-in to unlock the preview workflow.</div>';
          return;
        }

        if (tab === 'Scan' || tab === 'Tasks') {
          workspaceTitleEl.textContent = hasScanner ? 'Scanner workflow' : 'Task workspace';
          workspaceSummaryEl.textContent = hasScanner
            ? 'Tap the scanner action to simulate a live capture and route the result.'
            : 'Track the next action, mark it complete, and keep the queue moving.';
          workspacePillEl.textContent = hasScanner ? 'Camera ready' : 'Queued';
          workspaceContentEl.innerHTML = hasScanner
            ? '<div class=\"state-row\"><div><strong>Last scan</strong><p>' + (state.lastScan || 'No item scanned yet. Use Open Scanner to simulate one.') + '</p></div><span class=\"state-dot\"></span></div><button class=\"primary-button\" id=\"simulate-scan\" type=\"button\">Simulate Scan</button>'
            : '<div class=\"state-row\"><div><strong>Current task</strong><p>Review incoming record, confirm status, and assign next owner.</p></div><span class=\"state-dot\"></span></div><button class=\"primary-button\" id=\"complete-task\" type=\"button\">Mark Completed</button>';
          return;
        }

        if (tab === 'Billing') {
          workspaceTitleEl.textContent = 'Billing and conversion';
          workspaceSummaryEl.textContent = hasPayments
            ? 'Upgrade prompts and billing flows are interactive inside the preview.'
            : 'Billing is available when a subscription or checkout flow is attached.';
          workspacePillEl.textContent = state.premium ? 'Premium' : 'Starter';
          workspaceContentEl.innerHTML = hasPayments
            ? '<div class=\"state-row\"><div><strong>Plan</strong><p>' + (state.premium ? 'Premium plan is active.' : 'Starter plan is active.') + '</p></div><span class=\"state-dot\"></span></div><button class=\"primary-button\" id=\"upgrade-plan\" type=\"button\">' + (state.premium ? 'Manage Plan' : 'Upgrade Now') + '</button>'
            : '<div class=\"banner\">No billing workflow is required for this product concept.</div>';
          return;
        }

        if (tab === 'Admin') {
          workspaceTitleEl.textContent = hasAdmin ? 'Admin operations' : 'Settings';
          workspaceSummaryEl.textContent = hasAdmin
            ? 'Manage operators, approvals, and exception handling from one place.'
            : 'Adjust product settings and notification preferences.';
          workspacePillEl.textContent = hasAdmin ? 'Operator' : 'Configured';
          workspaceContentEl.innerHTML = hasAdmin
            ? '<div class=\"state-row\"><div><strong>Operator queue</strong><p>2 clients need approval and 1 task is waiting for staff review.</p></div><span class=\"state-dot\"></span></div><button class=\"primary-button\" id=\"approve-item\" type=\"button\">Approve next item</button>'
            : '<div class=\"state-row\"><div><strong>Notifications</strong><p>' + (hasNotifications ? 'Alerts are on for milestone changes.' : 'Notifications are currently quiet.') + '</p></div><span class=\"state-dot\"></span></div>';
          return;
        }

        workspaceTitleEl.textContent = 'History';
        workspaceSummaryEl.textContent = 'Review the latest product events and operator actions.';
        workspacePillEl.textContent = 'Stable';
        workspaceContentEl.innerHTML = '<div class=\"activity-list\">' + state.activity.map((item) => '<article class=\"activity-card\"><strong>Recorded</strong><p>' + item + '</p></article>').join('') + '</div>';
      }

      function refreshPreview() {
        state.activity.unshift('Preview refreshed at ' + new Date().toLocaleTimeString() + '.');
        state.activity = state.activity.slice(0, 4);
        renderActivity();
        renderWorkspace();
      }

      function bindInteractiveControls() {
        document.getElementById('primary-action')?.addEventListener('click', () => {
          if (hasScanner) {
            state.activeTab = 'Scan';
            state.lastScan = 'Organic snack bar · Health score 87';
          } else if (hasPayments) {
            state.activeTab = 'Billing';
          } else if (hasAdmin) {
            state.activeTab = 'Admin';
          } else {
            state.activeTab = 'Tasks';
          }
          renderBottomNav();
          renderWorkspace();
        });

        document.getElementById('secondary-action')?.addEventListener('click', () => {
          state.activeTab = hasDashboard ? 'History' : 'Home';
          renderBottomNav();
          renderWorkspace();
        });

        document.getElementById('refresh-activity')?.addEventListener('click', refreshPreview);
        document.getElementById('toggle-panel')?.addEventListener('click', () => {
          state.activeTab = hasAdmin ? 'Admin' : hasPayments ? 'Billing' : 'Tasks';
          renderBottomNav();
          renderWorkspace();
        });

        quickGridEl.querySelectorAll('[data-link]').forEach((button) => {
          button.addEventListener('click', () => {
            const label = button.getAttribute('data-link') || 'Home';
            state.activeTab = label === 'Scanner' ? 'Scan' : label;
            renderBottomNav();
            renderWorkspace();
          });
        });

        bottomNavEl.querySelectorAll('[data-tab]').forEach((button) => {
          button.addEventListener('click', () => {
            state.activeTab = button.getAttribute('data-tab') || 'Home';
            renderBottomNav();
            renderWorkspace();
          });
        });

        topActionEl?.addEventListener('click', () => {
          if (hasPayments) {
            state.premium = !state.premium;
            renderWorkspace();
          } else if (hasAuth) {
            state.signedIn = !state.signedIn;
            topActionEl.textContent = state.signedIn ? 'Signed In' : 'Live Ready';
            renderWorkspace();
          }
        });

        document.getElementById('sign-in-button')?.addEventListener('click', () => {
          state.signedIn = true;
          renderWorkspace();
          bindInteractiveControls();
        });

        document.getElementById('simulate-scan')?.addEventListener('click', () => {
          state.lastScan = 'Fresh produce item · Suggested healthier swap available';
          state.activity.unshift('A new scan result was captured and routed for review.');
          state.activity = state.activity.slice(0, 4);
          renderActivity();
          renderWorkspace();
          bindInteractiveControls();
        });

        document.getElementById('complete-task')?.addEventListener('click', () => {
          state.activity.unshift('The top task was completed and the queue advanced.');
          state.activity = state.activity.slice(0, 4);
          renderActivity();
          renderWorkspace();
          bindInteractiveControls();
        });

        document.getElementById('upgrade-plan')?.addEventListener('click', () => {
          state.premium = true;
          renderWorkspace();
          bindInteractiveControls();
        });

        document.getElementById('approve-item')?.addEventListener('click', () => {
          state.activity.unshift('An admin approval was completed in the operations panel.');
          state.activity = state.activity.slice(0, 4);
          renderActivity();
          renderWorkspace();
          bindInteractiveControls();
        });
      }

      function renderAll() {
        renderActivity();
        renderMetrics();
        renderQuickLinks();
        renderBottomNav();
        renderWorkspace();
        bindInteractiveControls();
      }

      renderAll();
    </script>
  </body>
</html>
`;
}

export class BuilderAgent {
  async executeStep(step, context) {
    assertExecutionContext(step, context);

    const executionState = context.executionState ?? {};

    switch (step.action) {
      case 'initialize_project':
        return this.initializeProject(step, context, executionState);
      case 'generate_application':
      case 'apply_project_changes':
      case 'generate_api_service':
        return this.generateApplication(step, context, executionState);
      case 'setup_backend':
        return this.setupBackend(step, context, executionState);
      default:
        throw new Error(`BuilderAgent cannot handle action "${step.action}".`);
    }
  }

  async initializeProject(step, context, executionState) {
    const directories = [
      context.projectRoot,
      path.join(context.projectRoot, '.omniforge'),
      path.join(context.projectRoot, 'src'),
      path.join(context.projectRoot, 'api'),
      path.join(context.projectRoot, 'database'),
      path.join(context.projectRoot, 'deployment'),
      path.join(context.projectRoot, 'domain'),
      path.join(context.projectRoot, 'integrations'),
      path.join(context.projectRoot, 'preview'),
    ];

    for (const directory of directories) {
      await ensureDirectory(directory);
    }

    const manifest = createProjectContextManifest(context);
    const manifestPath = path.join(
      context.projectRoot,
      '.omniforge',
      'project-context.json',
    );

    await writeJsonSafe(manifestPath, manifest);
    executionState.projectInitialized = true;

    return {
      stepId: step.id,
      title: step.title,
      agent: 'builder',
      action: step.action,
      status: 'completed',
      summary: 'Project workspace initialized successfully.',
      files: [
        {
          path: '.omniforge/project-context.json',
          absolutePath: manifestPath,
        },
      ],
      artifacts: {
        manifest,
      },
      metadata: {
        initializedDirectories: directories.length,
      },
    };
  }

  async generateApplication(step, context, executionState) {
    if (Array.isArray(executionState.generatedSourceFiles)) {
      return {
        stepId: step.id,
        title: step.title,
        agent: 'builder',
        action: step.action,
        status: 'completed',
        summary: 'Primary application files were already generated earlier in the plan.',
        files: executionState.generatedSourceFiles,
        artifacts: {
          reused: true,
        },
        metadata: {
          fileCount: executionState.generatedSourceFiles.length,
        },
      };
    }

    const generatedFiles = await generateCodeFromIntent({
      ...context.intent,
      routeCategory: context.route?.category ?? 'unknown',
      userInput: context.userInput,
      executionPlan: context.plan?.steps ?? [],
    });
    const validatedFiles = validateFiles(generatedFiles);
    const writtenFiles = await writeGeneratedFiles(context.projectRoot, validatedFiles);

    executionState.generatedSourceFiles = writtenFiles;
    executionState.generatedSourceDescriptors = validatedFiles;

    return {
      stepId: step.id,
      title: step.title,
      agent: 'builder',
      action: step.action,
      status: 'completed',
      summary: 'Primary application files generated and written to the workspace.',
      files: writtenFiles,
      artifacts: {
        fileCount: writtenFiles.length,
      },
      metadata: {
        fileCount: writtenFiles.length,
      },
    };
  }

  async setupBackend(step, context, executionState) {
    const serviceContracts = buildServiceContracts(context.intent);
    const contractPath = path.join(context.projectRoot, 'api', 'service-contract.json');
    const outlinePath = path.join(context.projectRoot, '.omniforge', 'backend-outline.md');
    const serverPath = path.join(context.projectRoot, 'api', 'server.js');
    const apiReadmePath = path.join(context.projectRoot, 'api', 'README.md');
    const databaseSchemaPath = path.join(context.projectRoot, 'database', 'schema.sql');
    const previewPath = path.join(context.projectRoot, 'preview', 'index.html');

    await writeJsonSafe(contractPath, serviceContracts);
    await writeFileSafe(outlinePath, buildBackendOutline(context.intent));
    await writeFileSafe(serverPath, buildBackendServerSource(context.intent, serviceContracts));
    await writeFileSafe(apiReadmePath, buildApiReadme(context.intent, serviceContracts));
    await writeFileSafe(databaseSchemaPath, buildDatabaseSchema(context.intent));
    await writeFileSafe(previewPath, buildPreviewHtml(context.intent));

    const files = [
      {
        path: 'api/service-contract.json',
        absolutePath: contractPath,
      },
      {
        path: '.omniforge/backend-outline.md',
        absolutePath: outlinePath,
      },
      {
        path: 'api/server.js',
        absolutePath: serverPath,
      },
      {
        path: 'api/README.md',
        absolutePath: apiReadmePath,
      },
      {
        path: 'database/schema.sql',
        absolutePath: databaseSchemaPath,
      },
      {
        path: 'preview/index.html',
        absolutePath: previewPath,
      },
    ];

    executionState.backendContract = serviceContracts;

    return {
      stepId: step.id,
      title: step.title,
      agent: 'builder',
      action: step.action,
      status: 'completed',
      summary: 'Backend contract and service boundaries prepared.',
      files,
      artifacts: {
        serviceContracts,
        previewReady: true,
      },
      metadata: {
        serviceCount: serviceContracts.services.length,
        previewReady: true,
      },
    };
  }
}

const builderAgent = new BuilderAgent();

export default builderAgent;
