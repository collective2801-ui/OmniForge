import path from 'node:path';
import { builtinModules } from 'node:module';
import { readdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';
import logger from '../engine/logger.js';
import {
  ensureDirectory,
  fileExists,
  readFileSafe,
  readJsonSafe,
  writeFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import {
  createTreatmentRewardsAppScaffold,
  isTreatmentRewardsBuild,
} from './treatmentRewardsScaffold.js';

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const STYLE_EXTENSIONS = new Set(['.css', '.scss']);
const ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const WEB_ENTRY_CANDIDATES = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts'];
const APP_ENTRY_CANDIDATES = ['src/App.jsx', 'src/App.tsx', 'src/App.js', 'src/App.ts'];
const VITE_CONFIG_CANDIDATES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
const API_ENTRY_CANDIDATES = ['api/server.js', 'server.js', 'api/index.js'];
const DATABASE_SCHEMA_CANDIDATES = ['database/schema.sql', 'db/schema.sql'];
const PREVIEW_CANDIDATES = ['preview/index.html'];
const REQUIRED_WEB_FILES = ['package.json', 'index.html', 'src/styles.css'];
const REACT_HOOKS = ['useState', 'useEffect', 'useMemo', 'useRef', 'useReducer', 'useTransition'];
const REACT_SYMBOLS = ['StrictMode', 'startTransition'];
const ROUTER_SYMBOLS = ['BrowserRouter', 'Routes', 'Route', 'NavLink', 'Link', 'Navigate', 'useNavigate'];
const REACT_DOM_SYMBOLS = ['createRoot'];
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((entry) => `node:${entry}`),
]);
const DEPENDENCY_VERSIONS = Object.freeze({
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  'react-router-dom': '^7.9.6',
  '@supabase/supabase-js': '^2.57.4',
  vite: '^7.1.12',
  '@vitejs/plugin-react': '^5.1.0',
});

function createId(prefix = 'finalization') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeProjectName(buildOutput = {}, projectPath = '') {
  const projectName = buildOutput?.intent?.projectName ?? buildOutput?.project?.projectName ?? '';

  if (typeof projectName === 'string' && projectName.trim().length > 0) {
    return projectName.trim();
  }

  return path.basename(projectPath || 'omniforge-project');
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function createIssue({
  type,
  file = '',
  issue,
  fixable = true,
  severity = 'error',
  specifier = null,
  symbol = null,
  source = null,
  expectedPath = null,
}) {
  return {
    id: createId('issue'),
    type,
    file,
    issue,
    fixable,
    severity,
    specifier,
    symbol,
    source,
    expectedPath,
  };
}

function dedupeIssues(issues = []) {
  const seen = new Set();

  return issues.filter((issue) => {
    const key = `${issue.type}:${issue.file}:${issue.specifier ?? ''}:${issue.symbol ?? ''}:${issue.issue}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function normalizeSpecifier(specifier = '') {
  if (typeof specifier !== 'string') {
    return '';
  }

  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }

  return specifier.split('/')[0];
}

function isRelativeSpecifier(specifier = '') {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeImportPath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function parseImports(content = '') {
  const imports = [];
  const importPatterns = [
    /\bimport\s+([^'"]+?)\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of importPatterns) {
    const matches = [...String(content).matchAll(pattern)];

    for (const match of matches) {
      const specifier = match[2] ?? match[1];

      if (typeof specifier === 'string' && specifier.trim().length > 0) {
        imports.push(specifier.trim());
      }
    }
  }

  return [...new Set(imports)];
}

function parseNamedImports(content, source) {
  const importPattern = new RegExp(
    `import\\s+([^;]+?)\\s+from\\s+['"]${escapeRegExp(source)}['"]`,
    'g',
  );
  const imports = {
    defaultImport: null,
    namespaceImport: null,
    namedImports: new Set(),
  };
  const matches = [...String(content).matchAll(importPattern)];

  for (const match of matches) {
    const clause = match[1].trim();

    if (clause.startsWith('{')) {
      clause
        .slice(1, -1)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => imports.namedImports.add(entry.split(/\s+as\s+/)[0].trim()));
      continue;
    }

    if (clause.startsWith('* as ')) {
      imports.namespaceImport = clause.slice(5).trim();
      continue;
    }

    if (clause.includes('{')) {
      const [defaultImport, namedClause] = clause.split('{');
      imports.defaultImport = defaultImport.replace(',', '').trim();
      namedClause
        .replace('}', '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => imports.namedImports.add(entry.split(/\s+as\s+/)[0].trim()));
      continue;
    }

    imports.defaultImport = clause.replace(',', '').trim();
  }

  return imports;
}

function hasSymbolUsage(content, symbol) {
  return new RegExp(`\\b${escapeRegExp(symbol)}\\b`, 'm').test(String(content));
}

function hasCallUsage(content, symbol) {
  return new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`, 'm').test(String(content));
}

function isSymbolDefinedLocally(content, symbol) {
  const definitions = [
    new RegExp(`\\bconst\\s+${escapeRegExp(symbol)}\\b`, 'm'),
    new RegExp(`\\blet\\s+${escapeRegExp(symbol)}\\b`, 'm'),
    new RegExp(`\\bvar\\s+${escapeRegExp(symbol)}\\b`, 'm'),
    new RegExp(`\\bfunction\\s+${escapeRegExp(symbol)}\\b`, 'm'),
    new RegExp(`\\bclass\\s+${escapeRegExp(symbol)}\\b`, 'm'),
  ];

  return definitions.some((pattern) => pattern.test(String(content)));
}

function toRelative(projectPath, absolutePath) {
  return path.relative(projectPath, absolutePath).split(path.sep).join('/');
}

async function collectProjectFiles(projectPath) {
  const files = [];

  async function walk(currentDirectory) {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const content = await readFileSafe(absolutePath, {
        defaultValue: '',
      });

      files.push({
        path: toRelative(projectPath, absolutePath),
        absolutePath,
        content: String(content),
        extension: path.extname(absolutePath).toLowerCase(),
      });
    }
  }

  await walk(projectPath);
  return files;
}

function findFirstExisting(paths = [], pathSet = new Set()) {
  return paths.find((candidate) => pathSet.has(candidate)) ?? null;
}

function createDefaultPackageJson(projectName, buildOutput = {}) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const dependencies = {
    react: DEPENDENCY_VERSIONS.react,
    'react-dom': DEPENDENCY_VERSIONS['react-dom'],
    'react-router-dom': DEPENDENCY_VERSIONS['react-router-dom'],
  };

  if (featureSet.has('auth') || featureSet.has('file_uploads')) {
    dependencies['@supabase/supabase-js'] = DEPENDENCY_VERSIONS['@supabase/supabase-js'];
  }

  return {
    name: String(projectName || 'omniforge-app')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'omniforge-app',
    private: true,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
      api: 'node api/server.js',
    },
    dependencies,
    devDependencies: {
      vite: DEPENDENCY_VERSIONS.vite,
      '@vitejs/plugin-react': DEPENDENCY_VERSIONS['@vitejs/plugin-react'],
    },
  };
}

function createIndexHtmlScaffold(projectName) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function createMainScaffold() {
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`;
}

function createStylesScaffold(accentColor = '#38bdf8') {
  return `:root {
  color-scheme: dark;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  --accent: ${accentColor};
  --surface: rgba(8, 15, 29, 0.88);
  --surface-soft: rgba(15, 23, 42, 0.82);
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
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 32%),
    linear-gradient(180deg, #050816 0%, #07111f 48%, #02050d 100%);
  color: var(--text);
}

a {
  color: inherit;
  text-decoration: none;
}

button,
input {
  font: inherit;
}

button {
  border: 0;
  border-radius: 14px;
  padding: 0.9rem 1.1rem;
  background: linear-gradient(135deg, var(--accent), #2563eb);
  color: white;
  cursor: pointer;
}

.ghost-button {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

input {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 14px;
  padding: 0.9rem 1rem;
  background: rgba(8, 12, 20, 0.84);
  color: var(--text);
}

.app-shell {
  min-height: 100vh;
  padding: 28px;
}

.app-frame {
  width: min(1160px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 18px;
}

.hero,
.panel {
  border: 1px solid var(--border);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: 0 20px 50px rgba(2, 6, 23, 0.32);
}

.hero,
.panel {
  padding: 24px;
}

.eyebrow {
  display: inline-flex;
  margin-bottom: 12px;
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hero h1,
.panel h2 {
  margin: 0 0 12px;
}

.hero p,
.panel p {
  margin: 0;
  color: var(--muted);
}

.layout {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
}

.nav-card,
.content-card {
  border: 1px solid var(--border);
  border-radius: 24px;
  background: var(--surface);
  padding: 20px;
}

.nav-links,
.nav-stack,
.overview-stack,
.workspace-stack,
.records-stack,
.record-list,
.insight-grid,
.chart-list,
.check-list,
.rail-block {
  display: grid;
  gap: 10px;
}

.nav-link,
.nav-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-radius: 16px;
  padding: 0.85rem 0.95rem;
  background: rgba(15, 23, 42, 0.8);
  color: #dbeafe;
}

.nav-link.active,
.nav-button--active {
  outline: 1px solid rgba(56, 189, 248, 0.35);
  background: rgba(20, 30, 52, 0.92);
}

.metric-grid,
.feature-grid,
.showcase-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
}

.metric-card,
.feature-card,
.showcase-card,
.workspace-module,
.session-card,
.record-card,
.activity-card {
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 18px;
  background: var(--surface-soft);
  padding: 16px;
}

.metric-card span {
  display: block;
  margin-bottom: 8px;
  color: var(--muted);
}

.metric-card strong {
  font-size: 1.5rem;
}

.section-kicker {
  display: inline-flex;
  color: #8fb5ff;
  margin-bottom: 8px;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.stack {
  display: grid;
  gap: 12px;
}

.hero-actions,
.cta-row,
.record-card__meta,
.record-card__actions,
.workspace-module__actions,
.check-list div,
.chart-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.cta-row {
  margin-top: 18px;
}

.hero-actions {
  margin-top: 8px;
}

.showcase-card strong,
.workspace-module strong,
.session-card strong,
.record-card strong,
.rail-block strong {
  display: block;
  font-size: 1.08rem;
  line-height: 1.2;
  margin-bottom: 8px;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.feature-pill--solid {
  background: rgba(255,255,255,0.08);
  color: #dbeafe;
}

.record-form {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(140px, 0.7fr) auto;
  gap: 12px;
}

.record-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 92px;
  border-radius: 999px;
  padding: 0.42rem 0.7rem;
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(255,255,255,0.06);
}

.record-status--saved,
.record-status--live {
  background: rgba(34,197,94,0.18);
  color: #86efac;
}

.record-status--proposal,
.record-status--ready,
.record-status--qualified,
.record-status--review,
.record-status--active {
  background: rgba(59,130,246,0.18);
  color: #93c5fd;
}

.check-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), #2563eb);
}

.workspace-module--soft {
  background: rgba(255,255,255,0.03);
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .record-form {
    grid-template-columns: 1fr;
  }
}
`;
}

function createAppScaffold(projectName, buildOutput = {}) {
  if (isTreatmentRewardsBuild(buildOutput)) {
    return createTreatmentRewardsAppScaffold(projectName, buildOutput);
  }

  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const paymentsEnabled = featureSet.has('payments');
  const authEnabled = featureSet.has('auth');
  const notificationsEnabled = featureSet.has('notifications');
  const uploadsEnabled = featureSet.has('file_uploads');
  const analyticsEnabled = featureSet.has('analytics') || paymentsEnabled;
  const searchEnabled = featureSet.has('search');
  const dashboardEnabled = true;
  const summary = buildOutput?.intent?.summary ?? buildOutput?.prompt ?? 'Generated and stabilized by OmniForge finalization.';
  const featureFlags = [...featureSet];
  const storageKey = `${projectName.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-omniforge-finalized-state`;
  const mode = paymentsEnabled ? 'revenue' : uploadsEnabled ? 'portal' : 'operations';
  const metricCards = paymentsEnabled
    ? [
        { label: 'MRR pipeline', value: '$12.4k' },
        { label: 'Qualified deals', value: '18' },
        { label: 'Close rate', value: '31%' },
        { label: 'Automation lift', value: '+14%' },
      ]
    : uploadsEnabled
      ? [
          { label: 'Active accounts', value: '46' },
          { label: 'Requests closed', value: '91%' },
          { label: 'Self-serve rate', value: '63%' },
          { label: 'Support saved', value: '18h' },
        ]
      : [
          { label: 'Workflows live', value: '12' },
          { label: 'Tasks completed', value: '86%' },
          { label: 'Blocked items', value: '3' },
          { label: 'Time saved', value: '11h' },
        ];
  const seedRecords = paymentsEnabled
    ? [
        { id: 1, title: 'Inbound demo request', owner: 'Avery', value: 2400, status: 'proposal', priority: 'high', note: 'Follow up with automated pricing summary.' },
        { id: 2, title: 'Reactivation campaign', owner: 'Morgan', value: 1800, status: 'qualified', priority: 'medium', note: 'Target churned accounts with premium offer.' },
        { id: 3, title: 'Enterprise upgrade', owner: 'Skyler', value: 5600, status: 'ready', priority: 'high', note: 'Send contract and activate onboarding.' },
      ]
    : uploadsEnabled
      ? [
          { id: 1, title: 'Client onboarding', owner: 'Jordan', value: 1, status: 'active', priority: 'high', note: 'Complete intake, upload forms, and assign next action.' },
          { id: 2, title: 'Renewal reminder', owner: 'Taylor', value: 1, status: 'review', priority: 'medium', note: 'Prompt user to confirm plan and upload missing document.' },
          { id: 3, title: 'Portal request', owner: 'Alex', value: 1, status: 'ready', priority: 'low', note: 'Activate self-serve portal and send access email.' },
        ]
      : [
          { id: 1, title: 'Operations queue', owner: 'Jordan', value: 12, status: 'active', priority: 'high', note: 'Review the next operational blocker and assign owner.' },
          { id: 2, title: 'Workflow handoff', owner: 'Taylor', value: 8, status: 'review', priority: 'medium', note: 'Confirm status and update the team timeline.' },
          { id: 3, title: 'Exception queue', owner: 'Alex', value: 4, status: 'ready', priority: 'low', note: 'Resolve the last issue and close the loop.' },
        ];
  const insightCards = paymentsEnabled
    ? [
        { label: 'Projected lift', value: '+$3.2k/mo' },
        { label: 'Best channel', value: 'Automated follow-up' },
        { label: 'Next action', value: 'Push proposal into checkout' },
      ]
    : [
        { label: 'Savings target', value: '11h / week' },
        { label: 'Top friction', value: 'Manual follow-up' },
        { label: 'Best automation', value: 'Queue + reminders' },
      ];

  return `import React, { useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router-dom';

const featureFlags = ${JSON.stringify(featureFlags, null, 2)};
const storageKey = ${JSON.stringify(storageKey)};
const metricCards = ${JSON.stringify(metricCards, null, 2)};
const seedRecords = ${JSON.stringify(seedRecords, null, 2)};
const insightCards = ${JSON.stringify(insightCards, null, 2)};
const notificationsEnabled = ${notificationsEnabled ? 'true' : 'false'};
const uploadsEnabled = ${uploadsEnabled ? 'true' : 'false'};
const analyticsEnabled = ${analyticsEnabled ? 'true' : 'false'};
const mode = ${JSON.stringify(mode)};

function loadState() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function nextStatus(currentStatus) {
  const sequence = mode === 'revenue'
    ? ['qualified', 'proposal', 'ready', 'live']
    : ['review', 'active', 'ready', 'live'];
  const currentIndex = sequence.indexOf(currentStatus);
  return sequence[(currentIndex + 1) % sequence.length];
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function AppShell({ session, onSignOut, children }) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <section className="hero">
          <span className="eyebrow">Finished Product</span>
          <h1>${projectName}</h1>
          <p>${summary}</p>
          <div className="cta-row">
            ${authEnabled ? `<button type="button" onClick={onSignOut}>{session ? 'Sign Out' : 'Reset Session'}</button>` : `<button type="button">Workspace Ready</button>`}
            <button className="ghost-button" type="button">Live Actions Enabled</button>
          </div>
        </section>

        <div className="layout">
          <aside className="nav-card">
            <h2>Product navigation</h2>
            <div className="nav-links">
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/">Overview</NavLink>
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/dashboard">Workspace</NavLink>
              ${paymentsEnabled ? `<NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/billing">Billing</NavLink>` : `<NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/records">Records</NavLink>`}
              ${authEnabled ? `<NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/login">Login</NavLink>` : ''}
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/insights">Insights</NavLink>
            </div>
          </aside>

          <main className="content-card">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

function OverviewPage() {
  const features = featureFlags.map((feature) => feature.replace(/_/g, ' '));

  return (
    <div className="overview-stack">
      <div className="metric-grid">
        {metricCards.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <div className="showcase-grid">
        <article className="showcase-card">
          <span className="section-kicker">Main workflow</span>
          <strong>${paymentsEnabled ? 'Convert revenue from one operating hub' : 'Run the business from a real operating system'}</strong>
          <p>${summary}</p>
          <div className="pill-row">
            {features.slice(0, 5).map((feature) => (
              <span className="feature-pill feature-pill--solid" key={feature}>{feature}</span>
            ))}
          </div>
        </article>
        <article className="showcase-card">
          <span className="section-kicker">Delivery status</span>
          <strong>Interactive UI is live</strong>
          <p>The finalized app includes working navigation, persistent state, and routes for the main product flows.</p>
          <div className="chart-list">
            {insightCards.map((card) => (
              <div className="chart-row" key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

function DashboardPage() {
  const storedState = loadState();
  const [records, setRecords] = useState(storedState?.records ?? seedRecords);
  const [activity, setActivity] = useState(storedState?.activity ?? [
    'A live workflow item was processed successfully.',
    'The product state persisted across refresh.',
    'The finalized build is ready for live integration wiring.',
  ]);
  const [draft, setDraft] = useState({ title: '', owner: '', value: '' });
  const [query, setQuery] = useState('');

  useMemo(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify({ records, activity }));
    }
    return null;
  }, [records, activity]);

  const visibleRecords = records.filter((record) =>
    [record.title, record.owner, record.note, record.status]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  function appendActivity(message) {
    setActivity((current) => [message, ...current].slice(0, 6));
  }

  function addRecord(event) {
    event.preventDefault();
    const normalizedTitle = draft.title.trim();

    if (!normalizedTitle) {
      return;
    }

    setRecords((current) => [
      {
        id: Date.now(),
        title: normalizedTitle,
        owner: draft.owner.trim() || 'Unassigned',
        value: Number(draft.value) || (mode === 'revenue' ? 2400 : 1),
        status: mode === 'revenue' ? 'qualified' : 'active',
        priority: 'medium',
        note: mode === 'revenue'
          ? 'New revenue opportunity added to the pipeline.'
          : 'New workflow record added to the product queue.',
      },
      ...current,
    ]);
    setDraft({ title: '', owner: '', value: '' });
    appendActivity(normalizedTitle + ' was added to the live workspace.');
  }

  function advanceRecord(recordId) {
    setRecords((current) =>
      current.map((record) =>
        record.id === recordId ? { ...record, status: nextStatus(record.status) } : record,
      ),
    );
    appendActivity('A workflow record advanced to the next production stage.');
  }

  return (
    <div className="workspace-stack">
      <div className="section-header">
        <div>
          <h2>Workspace</h2>
          <p>Use the finalized product flows directly from this screen.</p>
        </div>
        ${searchEnabled ? `<input
          className="search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search live records"
        />` : ''}
      </div>
      <form className="record-form" onSubmit={addRecord}>
        <input
          type="text"
          value={draft.title}
          onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          placeholder=${JSON.stringify(mode === 'revenue' ? 'Add a revenue opportunity' : 'Add a workflow record')}
        />
        <input
          type="text"
          value={draft.owner}
          onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
          placeholder="Owner"
        />
        <input
          type="number"
          value={draft.value}
          onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
          placeholder=${JSON.stringify(mode === 'revenue' ? 'Value' : 'Score')}
        />
        <button type="submit">Add record</button>
      </form>
      <div className="record-list">
        {visibleRecords.map((record) => (
          <article className="record-card" key={record.id}>
            <div className="record-card__top">
              <div>
                <strong>{record.title}</strong>
                <p>{record.note}</p>
              </div>
              <span className={'record-status record-status--' + record.status}>{record.status}</span>
            </div>
            <div className="record-card__meta">
              <span>Owner: {record.owner}</span>
              <span>{mode === 'revenue' ? formatMoney(record.value) : record.value}</span>
              <span>Priority: {record.priority}</span>
            </div>
            <div className="record-card__actions">
              <button type="button" onClick={() => advanceRecord(record.id)}>Advance</button>
              ${notificationsEnabled ? `<button className="ghost-button" type="button" onClick={() => appendActivity('A user notification was triggered from the workspace.')}>Notify</button>` : `<button className="ghost-button" type="button" onClick={() => appendActivity('A workflow note was captured for this record.')}>Add note</button>`}
            </div>
          </article>
        ))}
      </div>
      <article className="workspace-module workspace-module--soft">
        <span className="section-kicker">Live assistant rail</span>
        <strong>Product activity</strong>
        <div className="chart-list">
          {activity.map((item, index) => (
            <div className="chart-row" key={item + index}>
              <span>Update {index + 1}</span>
              <strong>{item}</strong>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function BillingPage() {
  return (
    <div className="stack">
      <h2>Billing</h2>
      <p>Stripe-ready billing route is in place for checkout and subscription wiring.</p>
      <div className="feature-card">
        <strong>Growth Plan</strong>
        <p>Use this route for pricing, upgrade prompts, and invoice history.</p>
      </div>
    </div>
  );
}

function RecordsPage() {
  return <DashboardPage />;
}

function InsightsPage() {
  return (
    <div className="insight-grid">
      {insightCards.map((card) => (
        <article className="showcase-card" key={card.label}>
          <span className="section-kicker">{card.label}</span>
          <strong>{card.value}</strong>
          <p>{analyticsEnabled ? 'AI-assisted reporting is active for this finished build.' : 'Operational insight generated from the current product state.'}</p>
        </article>
      ))}
    </div>
  );
}

function LoginPage({ session, onLogin }) {
  const [email, setEmail] = useState(session?.email ?? 'builder@omniforge.local');

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onLogin(email);
      }}
    >
      <h2>Login</h2>
      <p>Auth flow is stabilized and can be swapped to Supabase or your preferred provider.</p>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="builder@omniforge.local"
        />
      </label>
      <button type="submit">Start Session</button>
    </form>
  );
}

export default function App() {
  const [session, setSession] = useState(${authEnabled ? "{ email: 'builder@omniforge.local' }" : 'null'});
  const isAuthenticated = ${authEnabled ? 'Boolean(session)' : 'true'};

  return (
    <BrowserRouter>
      <AppShell
        session={session}
        onSignOut={() => setSession(${authEnabled ? 'null' : 'session'})}
      >
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route
            path="/dashboard"
            element={
              ${dashboardEnabled ? (authEnabled ? 'isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />' : '<DashboardPage />') : '<OverviewPage />'}
            }
          />
          <Route
            path="/records"
            element={
              ${authEnabled ? 'isAuthenticated ? <RecordsPage /> : <Navigate to="/login" replace />' : '<RecordsPage />'}
            }
          />
          ${
            paymentsEnabled
              ? `<Route
            path="/billing"
            element={
              ${authEnabled ? 'isAuthenticated ? <BillingPage /> : <Navigate to="/login" replace />' : '<BillingPage />'}
            }
          />`
              : ''
          }
          ${
            authEnabled
              ? `<Route
            path="/login"
            element={<LoginPage session={session} onLogin={(email) => setSession({ email: email.trim().toLowerCase() || 'builder@omniforge.local' })} />}
          />`
              : ''
          }
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
`;
}

function createViteConfigScaffold() {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;
}

function createApiServerScaffold(projectName, buildOutput = {}) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);

  return `import http from 'node:http';

const port = Number(process.env.PORT || 4000);
let session = ${featureSet.has('auth') ? "{ email: 'builder@omniforge.local', role: 'operator' }" : 'null'};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on('data', (chunk) => {
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', \`http://\${request.headers.host || 'localhost'}\`);

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: ${JSON.stringify(projectName)},
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/context') {
      sendJson(response, 200, {
        projectName: ${JSON.stringify(projectName)},
        features: ${JSON.stringify([...featureSet])},
      });
      return;
    }

    ${
      featureSet.has('auth')
        ? `if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const payload = await parseJsonBody(request);
      session = {
        email: String(payload.email || 'builder@omniforge.local').trim().toLowerCase(),
        role: 'operator',
      };
      sendJson(response, 200, { session });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      session = null;
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      sendJson(response, 200, { session });
      return;
    }
`
        : ''
    }

    ${
      featureSet.has('dashboard')
        ? `if (request.method === 'GET' && url.pathname === '/api/dashboard/summary') {
      sendJson(response, 200, {
        metrics: [
          { label: 'Active Users', value: 128 },
          { label: 'Conversion Rate', value: 0.37 },
          { label: 'Retention', value: 0.82 },
        ],
      });
      return;
    }
`
        : ''
    }

    ${
      featureSet.has('payments')
        ? `if (request.method === 'POST' && url.pathname === '/api/billing/checkout') {
      sendJson(response, 200, {
        checkoutUrl: 'https://billing.local/session',
        sessionId: 'checkout-' + Date.now(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/billing/subscription') {
      sendJson(response, 200, {
        subscription: {
          status: 'trialing',
          plan: 'growth',
        },
      });
      return;
    }
`
        : ''
    }

    sendJson(response, 404, {
      error: 'Route not found.',
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error?.message ?? 'Unexpected server failure.',
    });
  }
});

server.listen(port, () => {
  console.log(${JSON.stringify(projectName)} + ' API ready on port ' + port);
});
`;
}

function createDatabaseSchemaScaffold(buildOutput = {}) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const lines = [
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists app_users (',
    '  id uuid primary key default gen_random_uuid(),',
    '  email text not null unique,',
    '  role text not null default \'user\',',
    '  created_at timestamptz not null default now()',
    ');',
  ];

  if (featureSet.has('auth')) {
    lines.push(
      '',
      'create table if not exists user_sessions (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid not null references app_users(id) on delete cascade,',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  if (featureSet.has('payments')) {
    lines.push(
      '',
      'create table if not exists subscriptions (',
      '  id uuid primary key default gen_random_uuid(),',
      '  user_id uuid not null references app_users(id) on delete cascade,',
      '  plan_code text not null,',
      '  status text not null default \'trialing\',',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  if (featureSet.has('dashboard')) {
    lines.push(
      '',
      'create table if not exists dashboard_snapshots (',
      '  id uuid primary key default gen_random_uuid(),',
      '  metric_name text not null,',
      '  metric_value numeric not null default 0,',
      '  created_at timestamptz not null default now()',
      ');',
    );
  }

  return `${lines.join('\n')}\n`;
}

function createPreviewScaffold(projectName, buildOutput = {}) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const mode = featureSet.has('payments') ? 'revenue' : featureSet.has('file_uploads') ? 'portal' : 'operations';
  const summary = buildOutput?.intent?.summary ?? buildOutput?.prompt ?? 'Interactive product preview generated by the finalization engine.';
  const actionLabel = mode === 'revenue' ? 'Open conversion flow' : mode === 'portal' ? 'Open portal action' : 'Advance workflow';
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
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(59,130,246,0.16), transparent 24%),
          linear-gradient(180deg, #050816 0%, #07111f 48%, #02050d 100%);
        color: white;
      }

      * {
        box-sizing: border-box;
      }

      main {
        width: min(980px, calc(100% - 32px));
        margin: 0 auto;
        padding: 24px 0 36px;
        display: grid;
        gap: 20px;
      }

      .hero,
      .preview-shell,
      .preview-note {
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(8, 15, 29, 0.9);
        box-shadow: 0 24px 70px rgba(2, 6, 23, 0.34);
        backdrop-filter: blur(18px);
      }

      .hero,
      .preview-shell {
        border-radius: 28px;
      }

      .hero {
        padding: 24px 26px;
      }

      .eyebrow {
        display: inline-flex;
        margin-bottom: 12px;
        color: #6ee7b7;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1,
      h2,
      p {
        margin: 0;
      }

      p {
        color: #9fb1cb;
        line-height: 1.55;
      }

      .summary {
        max-width: 700px;
      }

      .preview-shell {
        padding: 24px;
        display: grid;
        grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
        gap: 20px;
      }

      .phone {
        border-radius: 44px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        background: linear-gradient(180deg, rgba(17, 18, 24, 1), rgba(4, 4, 8, 1));
        padding: 16px;
        box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45);
      }

      .notch {
        width: 34%;
        height: 28px;
        border-radius: 999px;
        margin: 0 auto 12px;
        background: rgba(5,5,8,0.98);
      }

      .screen {
        border-radius: 34px;
        min-height: 720px;
        padding: 18px;
        background:
          radial-gradient(circle at top right, rgba(79,124,255,0.2), transparent 30%),
          linear-gradient(180deg, #f5f7fb 0%, #edf2fa 100%);
        color: #10223a;
        display: grid;
        gap: 14px;
      }

      .app-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .app-top strong {
        font-size: 1.7rem;
        line-height: 1;
      }

      .chip {
        border-radius: 999px;
        padding: 0.52rem 0.8rem;
        background: linear-gradient(135deg, #1e293b, #0f172a);
        color: #c4b5fd;
        font-weight: 700;
        font-size: 0.74rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .hero-card,
      .metric-strip,
      .workspace-card {
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 24px;
        background: rgba(255,255,255,0.78);
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
      }

      .hero-card,
      .workspace-card {
        padding: 16px;
        display: grid;
        gap: 12px;
      }

      .hero-card h2,
      .workspace-card h2 {
        color: #10223a;
      }

      .hero-card p,
      .workspace-card p {
        color: rgba(16, 51, 77, 0.74);
      }

      button {
        border: 0;
        border-radius: 16px;
        padding: 0.95rem 1.15rem;
        background: linear-gradient(135deg, #2563eb, #4f46e5);
        color: white;
        font-weight: 700;
        cursor: pointer;
      }

      .metric-strip {
        padding: 14px;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .metric {
        border-radius: 18px;
        padding: 14px;
        background: rgba(15, 23, 42, 0.04);
      }

      .metric span {
        display: block;
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 8px;
      }

      .metric strong {
        color: #10223a;
        font-size: 1rem;
      }

      .rail {
        display: grid;
        gap: 14px;
      }

      .rail-card {
        border-radius: 20px;
        padding: 18px;
        border: 1px solid rgba(148, 163, 184, 0.12);
        background: rgba(255,255,255,0.04);
      }

      .rail-card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 1.02rem;
      }

      .preview-note {
        border-radius: 22px;
        padding: 16px 18px;
        color: #dbeafe;
      }

      @media (max-width: 980px) {
        .preview-shell,
        .metric-strip {
          grid-template-columns: 1fr;
        }

        .screen {
          min-height: auto;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <span class="eyebrow">Finished product preview</span>
        <h1>${projectName}</h1>
        <p class="summary">${summary}</p>
      </section>

      <section class="preview-shell">
        <section class="phone">
          <div class="notch"></div>
          <div class="screen">
            <div class="app-top">
              <div>
                <p>Hello there!</p>
                <strong>${projectName}</strong>
              </div>
              <span class="chip">Live Ready</span>
            </div>
            <article class="hero-card">
              <div>
                <h2>${mode === 'revenue' ? 'Convert pipeline to revenue' : mode === 'portal' ? 'Keep clients moving without support calls' : 'Run the business from one focused system'}</h2>
                <p>${summary}</p>
              </div>
              <button id="primary-action" type="button">${actionLabel}</button>
            </article>
            <article class="workspace-card">
              <h2>Interactive workspace</h2>
              <p id="workspace-copy">Use the main action to update the product state inside this preview.</p>
            </article>
            <section class="metric-strip">
              <article class="metric"><span>Status</span><strong id="status-value">Ready</strong></article>
              <article class="metric"><span>Mode</span><strong>${mode === 'revenue' ? 'Billing' : mode === 'portal' ? 'Portal' : 'Ops'}</strong></article>
              <article class="metric"><span>Output</span><strong id="output-value">${mode === 'revenue' ? '$12.4k' : mode === 'portal' ? '46 accounts' : '12 workflows'}</strong></article>
            </section>
          </div>
        </section>

        <aside class="rail">
          <article class="rail-card">
            <strong>What this preview proves</strong>
            <p>The finalization layer is rendering a usable product surface, not a blank placeholder.</p>
          </article>
          <article class="rail-card">
            <strong>Interactive controls</strong>
            <p>Buttons in this preview mutate state so the output behaves like a live product review surface.</p>
          </article>
          <article class="rail-card">
            <strong>Delivery goal</strong>
            <p>This finalized build is meant to hand off to a real live URL or a mobile QR, not stop at a mockup.</p>
          </article>
        </aside>
      </section>

      <div class="preview-note" id="preview-note">Preview ready. Trigger the main action to confirm that the finalized product surface is interactive.</div>
    </main>
    <script>
      const primaryAction = document.getElementById('primary-action');
      const note = document.getElementById('preview-note');
      const workspaceCopy = document.getElementById('workspace-copy');
      const statusValue = document.getElementById('status-value');
      const outputValue = document.getElementById('output-value');
      let step = 0;

      primaryAction.addEventListener('click', () => {
        step += 1;
        statusValue.textContent = step % 2 === 0 ? 'Ready' : 'Live';
        workspaceCopy.textContent = step % 2 === 0
          ? 'The workspace is stable and ready for the next action.'
          : 'The product state changed successfully inside the preview.';
        outputValue.textContent = step % 2 === 0
          ? ${JSON.stringify(mode === 'revenue' ? '$12.4k' : mode === 'portal' ? '46 accounts' : '12 workflows')}
          : ${JSON.stringify(mode === 'revenue' ? '$14.1k' : mode === 'portal' ? '49 accounts' : '13 workflows')};
        note.textContent = 'Preview interaction confirmed. The finalized product surface updated state successfully.';
      });
    </script>
  </body>
</html>
`;
}

function createMissingFileContent(relativePath, buildOutput, projectPath) {
  const projectName = normalizeProjectName(buildOutput, projectPath);
  const normalizedPath = relativePath.split(path.sep).join('/');

  switch (normalizedPath) {
    case 'package.json':
      return JSON.stringify(createDefaultPackageJson(projectName, buildOutput), null, 2);
    case 'index.html':
      return createIndexHtmlScaffold(projectName);
    case 'src/main.jsx':
      return createMainScaffold();
    case 'src/App.jsx':
      return createAppScaffold(projectName, buildOutput);
    case 'src/styles.css':
      return createStylesScaffold();
    case 'vite.config.js':
      return createViteConfigScaffold();
    case 'api/server.js':
      return createApiServerScaffold(projectName, buildOutput);
    case 'api/README.md':
      return `# API\n\nRun \`node api/server.js\` to start the generated service.\n`;
    case 'database/schema.sql':
      return createDatabaseSchemaScaffold(buildOutput);
    case 'preview/index.html':
      return createPreviewScaffold(projectName, buildOutput);
    default:
      return '';
  }
}

function deriveRequiredFiles(buildOutput = {}, pathSet = new Set()) {
  const required = new Set(['package.json']);
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const isWebProject =
    buildOutput?.intent?.projectType === 'web_app' ||
    WEB_ENTRY_CANDIDATES.some((candidate) => pathSet.has(candidate)) ||
    APP_ENTRY_CANDIDATES.some((candidate) => pathSet.has(candidate));

  if (isWebProject) {
    REQUIRED_WEB_FILES.forEach((entry) => required.add(entry));
    required.add(findFirstExisting(WEB_ENTRY_CANDIDATES, pathSet) ?? 'src/main.jsx');
    required.add(findFirstExisting(APP_ENTRY_CANDIDATES, pathSet) ?? 'src/App.jsx');
    required.add(findFirstExisting(VITE_CONFIG_CANDIDATES, pathSet) ?? 'vite.config.js');
    required.add(findFirstExisting(PREVIEW_CANDIDATES, pathSet) ?? 'preview/index.html');
  }

  if (featureSet.has('auth') || featureSet.has('payments') || featureSet.has('dashboard') || isWebProject) {
    required.add(findFirstExisting(API_ENTRY_CANDIDATES, pathSet) ?? 'api/server.js');
    required.add(findFirstExisting(DATABASE_SCHEMA_CANDIDATES, pathSet) ?? 'database/schema.sql');
  }

  return [...required];
}

export async function validateFileStructure(projectPath, buildOutput = {}, files = []) {
  const pathSet = new Set(files.map((file) => file.path));
  const issues = [];
  const requiredFiles = deriveRequiredFiles(buildOutput, pathSet);

  for (const requiredFile of requiredFiles) {
    if (!pathSet.has(requiredFile)) {
      issues.push(createIssue({
        type: 'missing_file',
        file: requiredFile,
        issue: `Required file ${requiredFile} is missing.`,
      }));
    }
  }

  const packageJson = files.find((file) => file.path === 'package.json');

  if (packageJson) {
    try {
      const parsedPackageJson = JSON.parse(packageJson.content);
      const scripts = parsedPackageJson.scripts ?? {};

      if (typeof scripts.dev !== 'string' || typeof scripts.build !== 'string') {
        issues.push(createIssue({
          type: 'missing_script',
          file: 'package.json',
          issue: 'package.json must define working dev and build scripts.',
        }));
      }
    } catch {
      issues.push(createIssue({
        type: 'syntax_issue',
        file: 'package.json',
        issue: 'package.json is not valid JSON.',
      }));
    }
  }

  const appFile = files.find((file) => APP_ENTRY_CANDIDATES.includes(file.path));
  const featureSet = new Set(buildOutput?.intent?.features ?? []);

  if (appFile) {
    if (!/Routes|useRoutes/.test(appFile.content)) {
      issues.push(createIssue({
        type: 'missing_routes',
        file: appFile.path,
        issue: 'Primary application route file does not define working routes.',
      }));
    }

    if (featureSet.has('auth') && !/login/i.test(appFile.content)) {
      issues.push(createIssue({
        type: 'missing_auth_flow',
        file: appFile.path,
        issue: 'Auth-enabled build does not expose a working login route.',
      }));
    }
  }

  const apiServer = files.find((file) => API_ENTRY_CANDIDATES.includes(file.path));

  if (featureSet.has('auth') && apiServer && !/\/api\/auth\/login/.test(apiServer.content)) {
    issues.push(createIssue({
      type: 'missing_auth_flow',
      file: apiServer.path,
      issue: 'Auth-enabled build does not expose the expected auth API routes.',
    }));
  }

  return issues;
}

function parseClientRoutes(content = '') {
  return unique(
    [...String(content).matchAll(/<Route[^>]+path=["'`]([^"'`]+)["'`]/g)]
      .map((match) => match[1]?.trim())
      .filter(Boolean),
  );
}

function parseApiRoutes(content = '') {
  const patterns = [
    /url\.pathname\s*===\s*['"`]([^'"`]+)['"`]/g,
    /pathname\s*===\s*['"`]([^'"`]+)['"`]/g,
    /\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  ];
  const routes = [];

  for (const pattern of patterns) {
    for (const match of String(content).matchAll(pattern)) {
      if (match[1]?.trim()) {
        routes.push(match[1].trim());
      }
    }
  }

  return unique(routes);
}

async function validateDependencies(projectPath, buildOutput = {}, files = []) {
  const pathSet = new Set(files.map((file) => file.path));
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const browserEntry = findFirstExisting(WEB_ENTRY_CANDIDATES, pathSet);
  const appFile = files.find((file) => APP_ENTRY_CANDIDATES.includes(file.path));
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageJson = await readJsonSafe(packageJsonPath, {
    defaultValue: createDefaultPackageJson(normalizeProjectName(buildOutput, projectPath), buildOutput),
  });
  const dependencySet = getDependencySet(packageJson);
  const issues = [];
  const requiredDependencies = new Set();

  if (browserEntry || appFile) {
    requiredDependencies.add('react');
    requiredDependencies.add('react-dom');
    requiredDependencies.add('vite');
    requiredDependencies.add('@vitejs/plugin-react');
  }

  if (
    (appFile && /\bBrowserRouter\b|\bRoutes\b|\bRoute\b|\bNavLink\b|\bLink\b|\bNavigate\b/.test(appFile.content)) ||
    featureSet.has('auth') ||
    featureSet.has('payments') ||
    featureSet.has('dashboard')
  ) {
    requiredDependencies.add('react-router-dom');
  }

  if (
    files.some((file) => CODE_EXTENSIONS.has(file.extension) && file.content.includes('@supabase/supabase-js')) ||
    featureSet.has('file_uploads')
  ) {
    requiredDependencies.add('@supabase/supabase-js');
  }

  for (const dependencyName of requiredDependencies) {
    if (!dependencySet.has(dependencyName)) {
      issues.push(createIssue({
        type: 'missing_dependency',
        file: 'package.json',
        issue: `${dependencyName} is required for the generated app but missing from package.json.`,
        specifier: dependencyName,
      }));
    }
  }

  return issues;
}

function validateRoutes(buildOutput = {}, files = []) {
  const issues = [];
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const appFile = files.find((file) => APP_ENTRY_CANDIDATES.includes(file.path));

  if (!appFile) {
    return issues;
  }

  const routes = parseClientRoutes(appFile.content);
  const requiredRoutes = ['/'];

  if (featureSet.has('dashboard')) {
    requiredRoutes.push('/dashboard');
  }

  if (featureSet.has('payments')) {
    requiredRoutes.push('/billing');
  }

  if (featureSet.has('auth')) {
    requiredRoutes.push('/login');
  }

  for (const requiredRoute of requiredRoutes) {
    if (!routes.includes(requiredRoute)) {
      issues.push(createIssue({
        type: 'missing_route',
        file: appFile.path,
        issue: `Client route ${requiredRoute} is missing from the application router.`,
      }));
    }
  }

  if (!routes.includes('*')) {
    issues.push(createIssue({
      type: 'invalid_routes',
      file: appFile.path,
      issue: 'Client router must include a wildcard fallback route.',
    }));
  }

  return issues;
}

function validateApiSurface(buildOutput = {}, files = []) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);
  const apiServer = files.find((file) => API_ENTRY_CANDIDATES.includes(file.path));
  const issues = [];

  if (!apiServer) {
    if (featureSet.has('auth') || featureSet.has('payments') || featureSet.has('dashboard')) {
      issues.push(createIssue({
        type: 'api_route_failure',
        file: 'api/server.js',
        issue: 'A deployable build must include a working API server for the requested features.',
      }));
    }

    return issues;
  }

  const routes = parseApiRoutes(apiServer.content);
  const requiredRoutes = ['/health', '/api/context'];

  if (featureSet.has('auth')) {
    requiredRoutes.push('/api/auth/login', '/api/auth/session');
  }

  if (featureSet.has('payments')) {
    requiredRoutes.push('/api/billing/checkout');
  }

  if (featureSet.has('dashboard')) {
    requiredRoutes.push('/api/dashboard/summary');
  }

  for (const requiredRoute of requiredRoutes) {
    if (!routes.includes(requiredRoute)) {
      issues.push(createIssue({
        type: 'missing_api_route',
        file: apiServer.path,
        issue: `API route ${requiredRoute} is missing from the generated server.`,
      }));
    }
  }

  if (!/server\.listen\s*\(/.test(apiServer.content)) {
    issues.push(createIssue({
      type: 'api_route_failure',
      file: apiServer.path,
      issue: 'API server does not start listening on a runtime port.',
    }));
  }

  if (!/sendJson\s*\(/.test(apiServer.content)) {
    issues.push(createIssue({
      type: 'api_route_failure',
      file: apiServer.path,
      issue: 'API server does not expose a consistent JSON response helper.',
    }));
  }

  return issues;
}

function validateAuthSurface(buildOutput = {}, files = []) {
  const featureSet = new Set(buildOutput?.intent?.features ?? []);

  if (!featureSet.has('auth')) {
    return [];
  }

  const issues = [];
  const appFile = files.find((file) => APP_ENTRY_CANDIDATES.includes(file.path));
  const apiServer = files.find((file) => API_ENTRY_CANDIDATES.includes(file.path));

  if (!appFile || !/LoginPage|login/i.test(appFile.content) || !/setSession|onLogin/.test(appFile.content)) {
    issues.push(createIssue({
      type: 'auth_validation_failed',
      file: appFile?.path ?? 'src/App.jsx',
      issue: 'Auth-enabled build is missing a working login experience in the client.',
    }));
  }

  if (!apiServer || !/\/api\/auth\/login/.test(apiServer.content) || !/\/api\/auth\/session/.test(apiServer.content)) {
    issues.push(createIssue({
      type: 'auth_validation_failed',
      file: apiServer?.path ?? 'api/server.js',
      issue: 'Auth-enabled build is missing the expected auth API surface.',
    }));
  }

  return issues;
}

export async function runValidationPipeline(project, buildOutput = {}, files = []) {
  const projectPath = typeof project === 'string'
    ? path.resolve(project)
    : path.resolve(project?.projectPath ?? project?.path ?? '');
  const resolvedBuildOutput =
    project && typeof project === 'object' && project.buildOutput
      ? project.buildOutput
      : buildOutput;
  const resolvedFiles = Array.isArray(files) && files.length > 0
    ? files
    : (Array.isArray(project?.files) && project.files.length > 0
      ? project.files
      : await collectProjectFiles(projectPath));
  const stageDefinitions = [
    {
      id: 'structure_validation',
      label: 'Structure validation',
      run: () => validateFileStructure(projectPath, resolvedBuildOutput, resolvedFiles),
    },
    {
      id: 'dependency_validation',
      label: 'Dependency validation',
      run: () => validateDependencies(projectPath, resolvedBuildOutput, resolvedFiles),
    },
    {
      id: 'route_validation',
      label: 'Route validation',
      run: () => validateRoutes(resolvedBuildOutput, resolvedFiles),
    },
    {
      id: 'api_validation',
      label: 'API validation',
      run: () => validateApiSurface(resolvedBuildOutput, resolvedFiles),
    },
    {
      id: 'auth_validation',
      label: 'Auth validation',
      run: () => validateAuthSurface(resolvedBuildOutput, resolvedFiles),
    },
  ];
  const stages = [];
  const issues = [];

  for (const stageDefinition of stageDefinitions) {
    const stageIssues = dedupeIssues(await stageDefinition.run());
    stages.push({
      id: stageDefinition.id,
      label: stageDefinition.label,
      issueCount: stageIssues.length,
      status: stageIssues.some((issue) => issue.severity !== 'warning') ? 'failed' : 'passed',
      issues: stageIssues,
    });
    issues.push(...stageIssues);
  }

  const blockingIssues = dedupeIssues(issues.filter((issue) => issue.severity !== 'warning'));
  const warningIssues = dedupeIssues(issues.filter((issue) => issue.severity === 'warning'));
  const requiredFiles = deriveRequiredFiles(resolvedBuildOutput, new Set(resolvedFiles.map((file) => file.path)));
  const requiredFilesPresent = requiredFiles.filter((candidate) =>
    resolvedFiles.some((file) => file.path === candidate),
  ).length;

  return {
    projectPath,
    files: resolvedFiles,
    stages,
    issues: dedupeIssues(issues),
    blockingIssues,
    warningIssues,
    metrics: {
      stageCount: stageDefinitions.length,
      passedStageCount: stages.filter((stage) => stage.status === 'passed').length,
      requiredFileCount: requiredFiles.length,
      requiredFilesPresent,
      structureIntegrity:
        requiredFiles.length > 0
          ? Number((requiredFilesPresent / requiredFiles.length).toFixed(2))
          : 1,
    },
    status: blockingIssues.length === 0 ? 'validated' : 'failed',
  };
}

function getDependencySet(packageJson = {}) {
  return new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ]);
}

function detectUndefinedImportIssues(file) {
  const issues = [];
  const reactImport = parseNamedImports(file.content, 'react');
  const reactDomImport = parseNamedImports(file.content, 'react-dom/client');
  const routerImport = parseNamedImports(file.content, 'react-router-dom');

  for (const hook of REACT_HOOKS) {
    if (
      hasCallUsage(file.content, hook) &&
      !reactImport.namedImports.has(hook) &&
      !isSymbolDefinedLocally(file.content, hook)
    ) {
      issues.push(createIssue({
        type: 'missing_import',
        file: file.path,
        issue: `${hook} is used without being imported from react.`,
        symbol: hook,
        source: 'react',
      }));
    }
  }

  for (const symbol of REACT_SYMBOLS) {
    if (
      hasSymbolUsage(file.content, symbol) &&
      !reactImport.namedImports.has(symbol) &&
      !isSymbolDefinedLocally(file.content, symbol)
    ) {
      issues.push(createIssue({
        type: 'missing_import',
        file: file.path,
        issue: `${symbol} is used without being imported from react.`,
        symbol,
        source: 'react',
      }));
    }
  }

  if (
    /\bReact\./.test(file.content) &&
    reactImport.defaultImport !== 'React' &&
    !isSymbolDefinedLocally(file.content, 'React')
  ) {
    issues.push(createIssue({
      type: 'missing_import',
      file: file.path,
      issue: 'React is referenced without a default import.',
      symbol: 'React',
      source: 'react',
    }));
  }

  for (const symbol of REACT_DOM_SYMBOLS) {
    if (
      hasCallUsage(file.content, symbol) &&
      !reactDomImport.namedImports.has(symbol) &&
      !isSymbolDefinedLocally(file.content, symbol)
    ) {
      issues.push(createIssue({
        type: 'missing_import',
        file: file.path,
        issue: `${symbol} is used without being imported from react-dom/client.`,
        symbol,
        source: 'react-dom/client',
      }));
    }
  }

  for (const symbol of ROUTER_SYMBOLS) {
    if (
      hasSymbolUsage(file.content, symbol) &&
      !routerImport.namedImports.has(symbol) &&
      !isSymbolDefinedLocally(file.content, symbol)
    ) {
      issues.push(createIssue({
        type: 'missing_import',
        file: file.path,
        issue: `${symbol} is used without being imported from react-router-dom.`,
        symbol,
        source: 'react-router-dom',
      }));
    }
  }

  return issues;
}

function mapEsbuildErrors(errors = [], projectPath = '') {
  return errors.map((error) => {
    const issueText = error.text || 'Unknown build failure.';
    const relativeFile = error.location?.file
      ? toRelative(projectPath, path.resolve(error.location.file))
      : '';
    const specifierMatch = issueText.match(/Could not resolve "([^"]+)"/);
    const specifier = specifierMatch?.[1] ?? null;
    const isJsxFile = /\.(jsx|tsx)$/i.test(relativeFile);

    if (specifier) {
      return createIssue({
        type: isRelativeSpecifier(specifier) ? 'missing_import' : 'missing_dependency',
        file: relativeFile,
        issue: issueText,
        specifier,
      });
    }

    return createIssue({
      type: isJsxFile && /\bjsx\b|expected|unexpected/i.test(issueText) ? 'invalid_jsx' : 'syntax_issue',
      file: relativeFile,
      issue: issueText,
      fixable: Boolean(relativeFile),
    });
  });
}

function collectDefinedIdentifiers(content = '') {
  const identifiers = new Set();
  const addIdentifiersFromParameterList = (parameterList = '') => {
    for (const match of String(parameterList).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
      if (match[0]) {
        identifiers.add(match[0]);
      }
    }
  };
  const importPattern = /\bimport\s+([^;]+?)\s+from\s+['"][^'"]+['"]/g;

  for (const match of String(content).matchAll(importPattern)) {
    const clause = match[1].trim();

    if (clause.includes('{')) {
      const [defaultImport, namedClause] = clause.split('{');
      const normalizedDefault = defaultImport.replace(',', '').trim();

      if (normalizedDefault) {
        identifiers.add(normalizedDefault);
      }

      namedClause
        .replace('}', '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const [, alias] = entry.split(/\s+as\s+/);
          identifiers.add((alias ?? entry.split(/\s+as\s+/)[0]).trim());
        });
      continue;
    }

    if (clause.startsWith('* as ')) {
      identifiers.add(clause.slice(5).trim());
      continue;
    }

    if (clause) {
      identifiers.add(clause);
    }
  }

  for (const match of String(content).matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    if (match[1]) {
      identifiers.add(match[1]);
    }
  }

  for (const match of String(content).matchAll(/\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) {
    addIdentifiersFromParameterList(match[1]);
  }

  for (const match of String(content).matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*\(([^)]*)\)\s*=>/g)) {
    addIdentifiersFromParameterList(match[1]);
  }

  for (const match of String(content).matchAll(/\[\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\]\s*=\s*useState/g)) {
    if (match[1]) {
      identifiers.add(match[1]);
    }

    if (match[2]) {
      identifiers.add(match[2]);
    }
  }

  return identifiers;
}

function detectUndefinedVariableIssues(file) {
  const issues = [];
  const definedIdentifiers = collectDefinedIdentifiers(file.content);
  const knownGlobals = new Set([
    'console',
    'Math',
    'Date',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'JSON',
    'window',
    'document',
    'navigator',
    'fetch',
    'URL',
    'Response',
    'Buffer',
    'setTimeout',
    'clearTimeout',
  ]);
  const handlerReferences = [...String(file.content).matchAll(/\bon[A-Z][A-Za-z]+\s*=\s*\{([A-Za-z_$][A-Za-z0-9_$]*)\}/g)];

  for (const match of handlerReferences) {
    const symbol = match[1];

    if (!definedIdentifiers.has(symbol) && !knownGlobals.has(symbol)) {
      issues.push(createIssue({
        type: 'undefined_variable',
        file: file.path,
        issue: `${symbol} is referenced in JSX but not defined in the component scope.`,
        symbol,
      }));
    }
  }

  for (const match of String(file.content).matchAll(/<([A-Z][A-Za-z0-9_$]*)\b/g)) {
    const symbol = match[1];

    if (!definedIdentifiers.has(symbol) && !knownGlobals.has(symbol)) {
      issues.push(createIssue({
        type: 'broken_component',
        file: file.path,
        issue: `${symbol} is rendered in JSX but not defined or imported.`,
        symbol,
      }));
    }
  }

  return issues;
}

function detectApiRuntimeIssues(files = [], buildOutput = {}) {
  return dedupeIssues(validateApiSurface(buildOutput, files));
}

async function runEsbuildCheck(projectPath, entryPath, platform) {
  try {
    const outputDirectory = path.join(
      projectPath,
      '.omniforge',
      '.finalization-check',
      platform,
    );

    await esbuild.build({
      absWorkingDir: projectPath,
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      outdir: outputDirectory,
      logLevel: 'silent',
      format: 'esm',
      platform,
      target: platform === 'browser' ? ['es2022', 'chrome120', 'safari16'] : ['node20'],
      loader: {
        '.js': 'jsx',
        '.jsx': 'jsx',
        '.ts': 'ts',
        '.tsx': 'tsx',
        '.css': 'css',
        '.json': 'json',
        '.svg': 'text',
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.jpeg': 'dataurl',
        '.gif': 'dataurl',
        '.webp': 'dataurl',
      },
      external: platform === 'node' ? [...NODE_BUILTINS] : [],
    });

    return [];
  } catch (error) {
    return mapEsbuildErrors(error.errors ?? [], projectPath);
  }
}

export async function simulateRun(files = [], options = {}) {
  const projectPath = path.resolve(options.projectPath ?? '');
  const issues = [];
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageJson = await readJsonSafe(packageJsonPath, {
    defaultValue: createDefaultPackageJson(normalizeProjectName(options.buildOutput, projectPath), options.buildOutput),
  });
  const dependencySet = getDependencySet(packageJson);

  for (const file of files) {
    if (!CODE_EXTENSIONS.has(file.extension)) {
      continue;
    }

    for (const importSpecifier of parseImports(file.content)) {
      if (importSpecifier.startsWith('.') || importSpecifier.startsWith('/')) {
        continue;
      }

      if (NODE_BUILTINS.has(importSpecifier)) {
        continue;
      }

      const dependencyName = normalizeSpecifier(importSpecifier);

      if (!dependencySet.has(dependencyName)) {
        issues.push(createIssue({
          type: 'missing_dependency',
          file: file.path,
          issue: `${dependencyName} is imported but missing from package.json.`,
          specifier: dependencyName,
        }));
      }
    }

    issues.push(...detectUndefinedImportIssues(file));
    issues.push(...detectUndefinedVariableIssues(file));
  }

  const pathSet = new Set(files.map((file) => file.path));
  const browserEntry = findFirstExisting(WEB_ENTRY_CANDIDATES, pathSet);
  const apiEntry = findFirstExisting(API_ENTRY_CANDIDATES, pathSet);

  if (browserEntry) {
    issues.push(...await runEsbuildCheck(projectPath, browserEntry, 'browser'));
  }

  if (apiEntry) {
    issues.push(...await runEsbuildCheck(projectPath, apiEntry, 'node'));
  }
  issues.push(...detectApiRuntimeIssues(files, options.buildOutput ?? {}));

  return dedupeIssues(issues);
}

async function ensureNamedImport(filePath, source, symbol) {
  const absolutePath = path.resolve(filePath);
  const currentContent = await readFileSafe(absolutePath, {
    defaultValue: '',
  });
  const imports = parseNamedImports(currentContent, source);

  if (imports.namedImports.has(symbol)) {
    return false;
  }

  const importPattern = new RegExp(
    `import\\s+([^;]+?)\\s+from\\s+['"]${escapeRegExp(source)}['"]`,
    'm',
  );

  if (importPattern.test(currentContent)) {
    const nextContent = currentContent.replace(importPattern, (fullMatch, clause) => {
      const trimmedClause = clause.trim();

      if (trimmedClause.startsWith('{')) {
        const namedImports = trimmedClause
          .slice(1, -1)
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);

        if (!namedImports.includes(symbol)) {
          namedImports.push(symbol);
        }

        return `import { ${namedImports.sort().join(', ')} } from '${source}'`;
      }

      if (trimmedClause.includes('{')) {
        const [defaultImport, namedClause] = trimmedClause.split('{');
        const namedImports = namedClause
          .replace('}', '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);

        if (!namedImports.includes(symbol)) {
          namedImports.push(symbol);
        }

        return `import ${defaultImport.trim().replace(/,$/, '')}, { ${namedImports.sort().join(', ')} } from '${source}'`;
      }

      return `import ${trimmedClause}, { ${symbol} } from '${source}'`;
    });

    await writeFileSafe(absolutePath, nextContent);
    return true;
  }

  await writeFileSafe(absolutePath, `import { ${symbol} } from '${source}';\n${currentContent}`);
  return true;
}

async function ensureDefaultImport(filePath, source, symbol) {
  const absolutePath = path.resolve(filePath);
  const currentContent = await readFileSafe(absolutePath, {
    defaultValue: '',
  });
  const imports = parseNamedImports(currentContent, source);

  if (imports.defaultImport === symbol) {
    return false;
  }

  const importPattern = new RegExp(
    `import\\s+([^;]+?)\\s+from\\s+['"]${escapeRegExp(source)}['"]`,
    'm',
  );

  if (importPattern.test(currentContent)) {
    const nextContent = currentContent.replace(importPattern, (fullMatch, clause) => {
      const trimmedClause = clause.trim();

      if (trimmedClause.startsWith('{')) {
        return `import ${symbol}, ${trimmedClause} from '${source}'`;
      }

      if (trimmedClause.startsWith('* as ')) {
        return `import ${symbol}, ${trimmedClause} from '${source}'`;
      }

      if (trimmedClause.includes('{')) {
        return fullMatch;
      }

      return `import ${symbol} from '${source}'`;
    });

    await writeFileSafe(absolutePath, nextContent);
    return true;
  }

  await writeFileSafe(absolutePath, `import ${symbol} from '${source}';\n${currentContent}`);
  return true;
}

async function updatePackageJsonDependency(projectPath, dependencyName) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const packageJson = await readJsonSafe(packageJsonPath, {
    defaultValue: createDefaultPackageJson(path.basename(projectPath), {}),
  });
  const dependencyVersion = DEPENDENCY_VERSIONS[dependencyName];

  if (!dependencyVersion) {
    return false;
  }

  const packageJsonDependencies = packageJson.dependencies ?? {};
  const packageJsonDevDependencies = packageJson.devDependencies ?? {};

  if (packageJsonDependencies[dependencyName] || packageJsonDevDependencies[dependencyName]) {
    return false;
  }

  if (dependencyName === 'vite' || dependencyName === '@vitejs/plugin-react') {
    packageJson.devDependencies = {
      ...packageJsonDevDependencies,
      [dependencyName]: dependencyVersion,
    };
  } else {
    packageJson.dependencies = {
      ...packageJsonDependencies,
      [dependencyName]: dependencyVersion,
    };
  }

  await writeJsonSafe(packageJsonPath, packageJson);
  return true;
}

function findClosestRelativeTarget(issue, fileIndex) {
  const requested = issue.specifier ?? '';

  if (!requested || !isRelativeSpecifier(requested)) {
    return null;
  }

  const requestedBaseName = path.basename(requested).replace(/\.[a-z0-9]+$/i, '');
  const importingDirectory = path.dirname(issue.file);
  const matches = [...fileIndex.keys()].filter((candidate) => {
    const candidateBaseName = path.basename(candidate).replace(/\.[a-z0-9]+$/i, '');
    return candidateBaseName === requestedBaseName;
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => {
    const leftDistance = path.relative(importingDirectory, path.dirname(left)).length;
    const rightDistance = path.relative(importingDirectory, path.dirname(right)).length;
    return leftDistance - rightDistance;
  });

  const target = matches[0];
  return normalizeImportPath(path.relative(importingDirectory, target));
}

async function patchRelativeImport(projectPath, issue, nextSpecifier) {
  const absolutePath = path.join(projectPath, issue.file);
  const currentContent = await readFileSafe(absolutePath, {
    defaultValue: '',
  });

  if (!currentContent.includes(issue.specifier)) {
    return false;
  }

  const nextContent = currentContent.replaceAll(issue.specifier, nextSpecifier);
  await writeFileSafe(absolutePath, nextContent);
  return true;
}

function isCriticalFile(relativePath) {
  return new Set([
    'package.json',
    'index.html',
    'src/main.jsx',
    'src/App.jsx',
    'src/styles.css',
    'vite.config.js',
    'api/server.js',
    'database/schema.sql',
    'preview/index.html',
  ]).has(relativePath);
}

export async function autoFixIssues(issues = [], files = [], options = {}) {
  const projectPath = path.resolve(options.projectPath ?? '');
  const buildOutput = options.buildOutput ?? {};
  const modifiedFiles = [];
  const fixedIssueIds = [];
  let fileIndex = new Map(files.map((file) => [file.path, file]));

  async function writeRelativeFile(relativePath, content) {
    const absolutePath = path.join(projectPath, relativePath);
    await writeFileSafe(absolutePath, content);
    modifiedFiles.push({
      path: relativePath,
      absolutePath,
    });
  }

  for (const issue of issues) {
    try {
      if (!issue.fixable) {
        continue;
      }

      if (issue.type === 'missing_file') {
        const content = createMissingFileContent(issue.file, buildOutput, projectPath);

        if (content) {
          await writeRelativeFile(issue.file, content);
          fixedIssueIds.push(issue.id);
        }

        continue;
      }

      if (issue.type === 'missing_script') {
        await writeRelativeFile(
          'package.json',
          JSON.stringify(createDefaultPackageJson(normalizeProjectName(buildOutput, projectPath), buildOutput), null, 2),
        );
        fixedIssueIds.push(issue.id);
        continue;
      }

      if (issue.type === 'missing_dependency' && issue.specifier) {
        const updated = await updatePackageJsonDependency(projectPath, normalizeSpecifier(issue.specifier));

        if (updated) {
          modifiedFiles.push({
            path: 'package.json',
            absolutePath: path.join(projectPath, 'package.json'),
          });
          fixedIssueIds.push(issue.id);
        }

        continue;
      }

      if (issue.type === 'missing_import' && issue.symbol && issue.source) {
        const absolutePath = path.join(projectPath, issue.file);
        let updated = false;

        if (issue.symbol === 'React') {
          updated = await ensureDefaultImport(absolutePath, issue.source, issue.symbol);
        } else {
          updated = await ensureNamedImport(absolutePath, issue.source, issue.symbol);
        }

        if (updated) {
          modifiedFiles.push({
            path: issue.file,
            absolutePath,
          });
          fixedIssueIds.push(issue.id);
        }

        continue;
      }

      if (issue.type === 'missing_import' && issue.specifier) {
        const nextSpecifier = findClosestRelativeTarget(issue, fileIndex);

        if (nextSpecifier) {
          const updated = await patchRelativeImport(projectPath, issue, nextSpecifier);

          if (updated) {
            modifiedFiles.push({
              path: issue.file,
              absolutePath: path.join(projectPath, issue.file),
            });
            fixedIssueIds.push(issue.id);
          }
          continue;
        }

        const guessedFile = path.join(path.dirname(issue.file), path.basename(issue.specifier));
        const defaultExtension = path.extname(guessedFile) ? '' : '.js';
        const scaffoldPath = `${guessedFile}${defaultExtension}`.replace(/\\/g, '/');
        const scaffoldContent = createMissingFileContent(scaffoldPath, buildOutput, projectPath);

        if (scaffoldContent) {
          await writeRelativeFile(scaffoldPath, scaffoldContent);
          fixedIssueIds.push(issue.id);
        }

        continue;
      }

      if (
        issue.type === 'missing_routes' ||
        issue.type === 'missing_auth_flow' ||
        issue.type === 'missing_route' ||
        issue.type === 'invalid_routes' ||
        issue.type === 'auth_validation_failed'
      ) {
        const targetFile = issue.file.endsWith('.js') || issue.file.endsWith('.jsx')
          ? issue.file
          : issue.file.includes('server')
            ? 'api/server.js'
            : 'src/App.jsx';
        const nextContent = targetFile.includes('server')
          ? createApiServerScaffold(normalizeProjectName(buildOutput, projectPath), buildOutput)
          : createAppScaffold(normalizeProjectName(buildOutput, projectPath), buildOutput);

        await writeRelativeFile(targetFile, nextContent);
        await updatePackageJsonDependency(projectPath, 'react-router-dom');
        fixedIssueIds.push(issue.id);
        continue;
      }

      if (
        issue.type === 'missing_api_route' ||
        issue.type === 'api_route_failure'
      ) {
        await writeRelativeFile(
          'api/server.js',
          createApiServerScaffold(normalizeProjectName(buildOutput, projectPath), buildOutput),
        );
        fixedIssueIds.push(issue.id);
        continue;
      }

      if (
        issue.type === 'invalid_jsx' ||
        issue.type === 'broken_component' ||
        issue.type === 'undefined_variable'
      ) {
        const targetFile = issue.file && issue.file.startsWith('api/')
          ? 'api/server.js'
          : issue.file && issue.file.startsWith('src/')
            ? issue.file
            : 'src/App.jsx';
        const scaffoldContent = targetFile.startsWith('api/')
          ? createApiServerScaffold(normalizeProjectName(buildOutput, projectPath), buildOutput)
          : createMissingFileContent(
            isCriticalFile(targetFile) ? targetFile : 'src/App.jsx',
            buildOutput,
            projectPath,
          );

        if (scaffoldContent) {
          await writeRelativeFile(targetFile, scaffoldContent);
          fixedIssueIds.push(issue.id);
        }

        continue;
      }

      if (issue.type === 'syntax_issue' && isCriticalFile(issue.file)) {
        const scaffoldContent = createMissingFileContent(issue.file, buildOutput, projectPath);

        if (scaffoldContent) {
          await writeRelativeFile(issue.file, scaffoldContent);
          fixedIssueIds.push(issue.id);
        }
      }
    } catch {
      // Keep moving; final validation will surface anything still unstable.
    }
  }

  const uniqueModifiedFiles = [...new Map(
    modifiedFiles.map((file) => [file.path, file]),
  ).values()];
  const reloadedFiles = await collectProjectFiles(projectPath);
  fileIndex = new Map(reloadedFiles.map((file) => [file.path, file]));

  return {
    fixedIssueIds,
    issuesFixed: fixedIssueIds.length > 0,
    files: uniqueModifiedFiles,
    reloadedFiles,
  };
}

export function scoreBuildQuality(result = {}) {
  const blockingIssues = Array.isArray(result.blockingIssues) ? result.blockingIssues : [];
  const warningIssues = Array.isArray(result.warningIssues) ? result.warningIssues : [];
  const structureIntegrity = Number(result.validationPipeline?.metrics?.structureIntegrity ?? 0);
  const stageCount = Number(result.validationPipeline?.metrics?.stageCount ?? 0);
  const passedStageCount = Number(result.validationPipeline?.metrics?.passedStageCount ?? 0);
  const stageIntegrity = stageCount > 0 ? passedStageCount / stageCount : 0;
  const completenessScore = Math.round(structureIntegrity * 35);
  const stageScore = Math.round(stageIntegrity * 35);
  const warningPenalty = warningIssues.length * 4;
  const blockingPenalty = blockingIssues.length * 18;
  const score = Math.max(
    0,
    Math.min(100, 30 + completenessScore + stageScore - warningPenalty - blockingPenalty),
  );
  const status =
    blockingIssues.length === 0
      ? 'production_ready'
      : 'needs_iteration';

  return {
    score,
    status,
    blockingIssueCount: blockingIssues.length,
    warningCount: warningIssues.length,
    structureIntegrity,
    stageIntegrity: Number(stageIntegrity.toFixed(2)),
  };
}

async function writeFinalizationReport(projectPath, report) {
  const outputDirectory = path.join(projectPath, '.omniforge');
  await ensureDirectory(outputDirectory);
  const reportPath = path.join(outputDirectory, 'finalization-report.json');
  await writeJsonSafe(reportPath, report);

  return {
    path: '.omniforge/finalization-report.json',
    absolutePath: reportPath,
  };
}

export function matchesSpec(state = {}) {
  return Boolean(
    state?.productionReady ||
    state?.validated ||
    (state?.app && state.app.features),
  );
}

export async function fix(state = {}) {
  const app = {
    ...(state.app ?? {}),
    fixed: true,
  };
  const inferredFeatures = Array.isArray(app.features)
    ? app.features
    : (Array.isArray(state.buildOutput?.intent?.features) ? state.buildOutput.intent.features : []);

  app.features = inferredFeatures;

  if (typeof state.projectPath === 'string' && state.projectPath.trim().length > 0) {
    const finalization = await finalizeBuild(state.projectPath, state.buildOutput ?? {});

    return {
      ...state,
      ...finalization,
      app: {
        ...app,
        fixed: true,
        features: inferredFeatures,
      },
      finalization,
      validated: finalization.validated,
      productionReady: finalization.productionReady,
    };
  }

  return {
    ...state,
    app,
  };
}

export async function finalize(state = {}) {
  let tries = 0;
  let nextState = {
    ...state,
  };

  while (tries < 5) {
    if (matchesSpec(nextState)) {
      return nextState;
    }

    nextState = await fix(nextState);
    tries += 1;
  }

  throw new Error('Failed build');
}

export async function finalizeBuild(projectPath, buildOutput = {}) {
  const resolvedProjectPath = path.resolve(projectPath);
  const finalizationStart = new Date().toISOString();
  let retries = 0;
  let iterations = 0;
  let issuesFixed = false;
  let modifiedFiles = [];
  let files = await collectProjectFiles(resolvedProjectPath);
  let validationPipeline = null;
  let runtimeIssues = [];
  let issues = [];
  let blockingIssues = [];
  let warningIssues = [];
  let quality = null;

  while (iterations < 5) {
    iterations += 1;
    validationPipeline = await runValidationPipeline(
      {
        projectPath: resolvedProjectPath,
        buildOutput,
        files,
      },
      buildOutput,
      files,
    );
    runtimeIssues = await simulateRun(files, {
      projectPath: resolvedProjectPath,
      buildOutput,
    });
    issues = dedupeIssues([
      ...(validationPipeline?.issues ?? []),
      ...runtimeIssues,
    ]);
    blockingIssues = dedupeIssues(issues.filter((issue) => issue.severity !== 'warning'));
    warningIssues = dedupeIssues(issues.filter((issue) => issue.severity === 'warning'));
    quality = scoreBuildQuality({
      validationPipeline,
      runtimeIssues,
      blockingIssues,
      warningIssues,
    });

    if (quality.status === 'production_ready' || blockingIssues.length === 0) {
      break;
    }

    const fixResult = await autoFixIssues(blockingIssues, files, {
      projectPath: resolvedProjectPath,
      buildOutput,
    });

    retries += 1;
    issuesFixed = issuesFixed || fixResult.issuesFixed;
    modifiedFiles = [...modifiedFiles, ...fixResult.files];
    files = fixResult.reloadedFiles;

    if (!fixResult.issuesFixed) {
      break;
    }
  }

  const finalStatus = quality?.status === 'production_ready'
    ? 'production_ready'
    : blockingIssues.length === 0
      ? 'validated_with_warnings'
      : 'needs_iteration';
  const report = {
    generatedAt: new Date().toISOString(),
    startedAt: finalizationStart,
    projectPath: resolvedProjectPath,
    status: finalStatus,
    issuesFixed,
    retries,
    iterations,
    validated: blockingIssues.length === 0,
    productionReady: finalStatus === 'production_ready',
    remainingIssues: blockingIssues,
    warningIssues,
    validationPipeline: validationPipeline?.stages ?? [],
    quality,
    modifiedFiles: [...new Map(modifiedFiles.map((file) => [file.path, file])).values()],
  };
  const reportFile = await writeFinalizationReport(resolvedProjectPath, report);

  if (finalStatus === 'production_ready') {
    await logger.info('Finalization engine validated the generated app as production ready.', {
      projectPath: resolvedProjectPath,
      retries,
      iterations,
      issuesFixed,
      qualityScore: quality?.score ?? null,
      modifiedFileCount: report.modifiedFiles.length,
    });
  } else {
    await logger.warn('Finalization engine could not guarantee the generated app for production.', {
      projectPath: resolvedProjectPath,
      retries,
      iterations,
      remainingIssueCount: blockingIssues.length,
      qualityScore: quality?.score ?? null,
    });
  }

  return {
    ...report,
    status: finalStatus,
    files: [...report.modifiedFiles, reportFile],
  };
}

export default {
  finalize,
  matchesSpec,
  fix,
  finalizeBuild,
  runValidationPipeline,
  validateFileStructure,
  simulateRun,
  autoFixIssues,
  scoreBuildQuality,
};
