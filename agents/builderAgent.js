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
        --bg: #060912;
        --surface: rgba(9, 15, 30, 0.88);
        --surface-soft: rgba(255,255,255,0.04);
        --border: rgba(148,163,184,0.14);
        --text: #f8fbff;
        --muted: #a7b8d6;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(16,185,129,0.18), transparent 24%),
          radial-gradient(circle at top right, rgba(99,102,241,0.2), transparent 26%),
          linear-gradient(180deg, #04070f 0%, #08101d 52%, #03050b 100%);
        color: var(--text);
      }
      main { width: min(1160px, calc(100% - 40px)); margin: 0 auto; padding: 28px 0 40px; }
      .hero, .panel, .flash { border: 1px solid var(--border); background: var(--surface); box-shadow: 0 24px 70px rgba(2,6,23,0.34); backdrop-filter: blur(18px); }
      .hero, .panel { border-radius: 28px; }
      .hero { padding: 28px; display: grid; gap: 16px; }
      .eyebrow, .kicker { display: inline-flex; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; font-weight: 700; }
      .eyebrow { color: #6ee7b7; }
      h1, h2, h3, p { margin: 0; }
      p { color: var(--muted); }
      .role-switcher { display: inline-flex; gap: 6px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 1px solid var(--border); width: fit-content; }
      .role-button, .spin-button, .admin-form button, .row-actions button { border: 0; border-radius: 14px; cursor: pointer; }
      .role-button { padding: 12px 14px; background: transparent; color: #dbe6f7; }
      .role-button.active, .spin-button, .admin-form button, .row-actions button.eligible { background: linear-gradient(135deg, #10b981, #6366f1); color: #041019; font-weight: 700; }
      .grid { display: grid; grid-template-columns: 1.35fr 0.95fr; gap: 20px; margin-top: 22px; }
      .panel { padding: 24px; }
      .section-head { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 18px; }
      .wheel-layout { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 18px; }
      .wheel { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; padding: 18px; border-radius: 24px; background: radial-gradient(circle at top, rgba(99,102,241,0.18), rgba(15,23,42,0.9)); min-height: 320px; }
      .segment { min-height: 86px; border-radius: 18px; display: flex; align-items: center; justify-content: center; text-align: center; padding: 14px; font-weight: 700; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.05); }
      .segment.active { border-color: rgba(255,255,255,0.62); box-shadow: 0 0 0 2px rgba(255,255,255,0.08), 0 18px 40px rgba(99,102,241,0.3); transform: translateY(-2px); }
      .spin-panel, .status-card, .row, .flash { border-radius: 18px; border: 1px solid rgba(148,163,184,0.12); background: var(--surface-soft); }
      .spin-panel { padding: 18px; display: grid; gap: 12px; }
      .status-grid { margin-top: 18px; display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
      .status-card { padding: 16px; }
      .status-card span { display: block; color: #8ca3c7; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 8px; }
      select, input { width: 100%; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--border); background: rgba(5,10,22,0.84); color: white; }
      .admin-form, .row-actions, .client-list { display: grid; gap: 12px; }
      .admin-form { grid-template-columns: minmax(0,1fr) auto; }
      .row { padding: 16px; display: grid; gap: 14px; }
      .row-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .row-actions button { padding: 12px 14px; background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(148,163,184,0.14); }
      .row-actions button.done { color: #6ee7b7; border-color: rgba(16,185,129,0.4); }
      .flash { margin-top: 18px; padding: 16px 18px; color: #dbeafe; }
      @media (max-width: 960px) { .grid, .wheel-layout, .status-grid, .admin-form, .row-actions { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">Rendered Product Preview</span>
        <h1>${projectName}</h1>
        <p>${summary}</p>
        <div class="role-switcher">
          <button class="role-button active" type="button" data-role="client">Client</button>
          <button class="role-button" type="button" data-role="admin">Administrator</button>
        </div>
      </section>

      <section class="grid">
        <section class="panel">
          <div class="section-head">
            <div>
              <span class="kicker">Client experience</span>
              <h2>Reward wheel</h2>
            </div>
            <select id="client-select"></select>
          </div>

          <div class="wheel-layout">
            <div class="wheel" id="wheel"></div>
            <div class="spin-panel">
              <div class="status-card">
                <span>Eligibility</span>
                <strong id="eligibility-label">Ready to spin</strong>
              </div>
              <div class="status-card">
                <span>Last prize</span>
                <strong id="prize-label">No prize awarded yet</strong>
              </div>
              <button class="spin-button" id="spin-button" type="button">Spin wheel</button>
              <p id="helper-copy">A client can spin only after attendance and a consistent UA are both marked complete.</p>
            </div>
          </div>

          <div class="status-grid">
            <article class="status-card"><span>Attendance</span><strong id="attendance-value">Complete</strong></article>
            <article class="status-card"><span>Consistent UA</span><strong id="ua-value">Complete</strong></article>
            <article class="status-card"><span>Spin state</span><strong id="spin-state-value">Available</strong></article>
          </div>
        </section>

        <aside class="panel">
          <div class="section-head">
            <div>
              <span class="kicker">Staff controls</span>
              <h2>Administrator panel</h2>
            </div>
          </div>
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
        spinButtonEl.disabled = !eligible;
      }

      function renderClients() {
        clientListEl.innerHTML = clients.map((client) => '<article class="row">\n  <div><strong>' + client.name + '</strong><p>' + (client.lastPrize ? 'Last prize: ' + client.lastPrize : 'No prize awarded yet.') + '</p></div>\n  <div class="row-actions">\n    <button type="button" data-action="attendance" data-id="' + client.id + '" class="' + (client.attendanceDone ? 'done' : '') + '">Attendance</button>\n    <button type="button" data-action="ua" data-id="' + client.id + '" class="' + (client.uaComplete ? 'done' : '') + '">UA complete</button>\n    <button type="button" data-action="eligible" data-id="' + client.id + '" class="eligible">Mark eligible</button>\n    <button type="button" data-action="reset" data-id="' + client.id + '">Reset spin</button>\n  </div>\n</article>').join('');
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
  const projectType = escapeHtml(titleCase(intent.projectType ?? 'web app'));
  const summary = escapeHtml(intent.summary ?? 'A generated product preview');
  const stack = intent.technicalDecisions ?? {};
  const stackItems = [
    stack.frontend ? `${titleCase(stack.frontend)} frontend` : null,
    stack.backend && stack.backend !== 'none' ? `${titleCase(stack.backend)} backend` : null,
    stack.database && stack.database !== 'none' ? `${titleCase(stack.database)} database` : null,
    stack.deployment ? `${titleCase(stack.deployment)} deployment` : null,
  ].filter(Boolean);
  const featureCards = [
    featureSet.has('auth')
      ? {
          title: 'Secure Access',
          detail: 'Guided sign-in, onboarding, and operator sessions.',
        }
      : null,
    featureSet.has('dashboard')
      ? {
          title: 'Live Dashboard',
          detail: 'Metrics, activity tracking, and a clear progress loop.',
        }
      : null,
    featureSet.has('payments')
      ? {
          title: 'Billing Ready',
          detail: 'Stripe checkout and subscription lifecycle prepared.',
        }
      : null,
    featureSet.has('file_uploads')
      ? {
          title: 'Uploads',
          detail: 'Storage-ready flows for client files and supporting documents.',
        }
      : null,
    {
      title: 'Deployment',
      detail: 'The generated app can be promoted from this preview into a live deployment.',
    },
  ].filter(Boolean);

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
        --accent: ${accentColor};
        --surface: rgba(8, 15, 29, 0.88);
        --surface-soft: rgba(15, 23, 42, 0.84);
        --border: rgba(148, 163, 184, 0.16);
        --text: #f8fbff;
        --muted: #9fb1cb;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 30%),
          radial-gradient(circle at bottom right, rgba(14, 165, 233, 0.16), transparent 28%),
          linear-gradient(180deg, #050816 0%, #07111f 48%, #02050d 100%);
        color: var(--text);
      }

      main {
        width: min(1160px, calc(100% - 40px));
        margin: 0 auto;
        padding: 28px 0 36px;
      }

      .hero,
      .panel {
        border: 1px solid var(--border);
        border-radius: 24px;
        background: var(--surface);
        box-shadow: 0 24px 70px rgba(2, 6, 23, 0.32);
        backdrop-filter: blur(18px);
      }

      .hero {
        padding: 28px;
        margin-bottom: 20px;
      }

      .eyebrow {
        display: inline-flex;
        margin-bottom: 12px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 10px;
        font-size: clamp(2rem, 4vw, 3.4rem);
        line-height: 0.96;
      }

      p {
        margin: 0;
        color: var(--muted);
      }

      .hero-grid,
      .grid {
        display: grid;
        gap: 18px;
      }

      .hero-grid {
        grid-template-columns: 1.5fr 1fr;
        align-items: start;
      }

      .stack-list,
      .feature-grid,
      .signal-grid {
        display: grid;
        gap: 12px;
      }

      .stack-list {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        margin-top: 18px;
      }

      .stack-pill,
      .feature-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.5rem 0.8rem;
        background: rgba(56, 189, 248, 0.12);
        color: #d8f4ff;
        font-size: 0.92rem;
      }

      .grid {
        grid-template-columns: 1.2fr 1fr;
      }

      .panel {
        padding: 22px;
      }

      .panel h2 {
        margin: 0 0 12px;
        font-size: 1.08rem;
      }

      .feature-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .feature-card,
      .signal-card,
      .roadmap-item {
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        background: var(--surface-soft);
        padding: 16px;
      }

      .feature-card strong,
      .signal-card strong,
      .roadmap-item strong {
        display: block;
        margin-bottom: 8px;
      }

      .signal-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .signal-card span {
        display: block;
        font-size: 0.82rem;
        color: var(--muted);
        margin-bottom: 8px;
      }

      .signal-card strong {
        font-size: 1.6rem;
        color: white;
      }

      .roadmap {
        display: grid;
        gap: 12px;
      }

      @media (max-width: 900px) {
        .hero-grid,
        .grid,
        .signal-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">Rendered Product Preview</div>
        <div class="hero-grid">
          <div>
            <h1>${projectName}</h1>
            <p>${summary}</p>
            <div class="stack-list">
              ${stackItems.map((item) => `<span class="stack-pill">${escapeHtml(item)}</span>`).join('')}
            </div>
          </div>
          <div class="panel">
            <h2>Product Shape</h2>
            <div class="feature-grid">
              <span class="feature-pill">${projectType}</span>
              ${Array.from(featureSet).map((feature) => `<span class="feature-pill">${escapeHtml(titleCase(feature))}</span>`).join('')}
            </div>
          </div>
        </div>
      </section>

      <section class="grid">
        <section class="panel">
          <h2>Core Experience</h2>
          <div class="feature-grid">
            ${featureCards.map((card) => `
              <article class="feature-card">
                <strong>${escapeHtml(card.title)}</strong>
                <p>${escapeHtml(card.detail)}</p>
              </article>
            `).join('')}
          </div>
        </section>

        <section class="panel">
          <h2>What Users Keep Watching</h2>
          <div class="signal-grid">
            <article class="signal-card">
              <span>Activation</span>
              <strong>94%</strong>
              <p>Users hit the first meaningful screen quickly.</p>
            </article>
            <article class="signal-card">
              <span>Retention</span>
              <strong>4.2x</strong>
              <p>Progress loops and reminders pull users back in.</p>
            </article>
            <article class="signal-card">
              <span>Momentum</span>
              <strong>7 Days</strong>
              <p>Habit-forming updates and visible wins sustain usage.</p>
            </article>
          </div>
        </section>
      </section>

      <section class="panel" style="margin-top: 20px;">
        <h2>Execution Roadmap</h2>
        <div class="roadmap">
          <article class="roadmap-item">
            <strong>1. Build</strong>
            <p>Core product files, backend surface, and data schema are generated.</p>
          </article>
          <article class="roadmap-item">
            <strong>2. Integrate</strong>
            <p>Payments, auth, storage, and environment configuration are attached when needed.</p>
          </article>
          <article class="roadmap-item">
            <strong>3. Launch</strong>
            <p>Deployment, domain, runtime diagnostics, and business assets carry the product into market.</p>
          </article>
        </div>
      </section>
    </main>
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
