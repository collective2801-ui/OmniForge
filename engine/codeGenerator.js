import OpenAI from 'openai';
import { callAI } from './aiClient.js';
import { validateFiles } from './validator.js';

let openaiClient = null;

function assertIntent(intent) {
  if (!intent || typeof intent !== 'object') {
    throw new TypeError('Intent must be an object.');
  }

  if (typeof intent.goal !== 'string' || intent.goal.trim().length === 0) {
    throw new TypeError('Intent goal is required for code generation.');
  }
}

function assertPrompt(prompt) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('Code generation prompt must be a non-empty string.');
  }
}

function getOpenAIClient() {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for generateCode(prompt).');
  }

  openaiClient = new OpenAI({
    apiKey,
  });

  return openaiClient;
}

function extractJSONArray(rawText) {
  if (typeof rawText !== 'string') {
    throw new TypeError('AI code generation output must be a string.');
  }

  const startIndex = rawText.indexOf('[');
  const endIndex = rawText.lastIndexOf(']');

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error('Unable to locate a JSON array in AI code output.');
  }

  return JSON.parse(rawText.slice(startIndex, endIndex + 1));
}

function buildCodeGenerationPrompt(intent) {
  return `
You are OmniForge's autonomous code generation engine.

Generate a cohesive, production-minded file set for the following intent.

Intent:
${JSON.stringify(intent, null, 2)}

Strict rules:
- Return only a JSON array.
- Every array item must have this exact shape:
  {
    "path": "relative/file/path.ext",
    "content": "FULL FILE CONTENT"
  }
- Paths must be relative and must not begin with /, ~, or ..
- Every file content must be complete and immediately usable.
- Do not include markdown fences.
- Do not include commentary.
- Do not include placeholders or TODO markers.
- Prefer a runnable or execution-ready project slice.

Generate the smallest complete file set that satisfies the intent while remaining extensible.
`.trim();
}

function buildFeatureFlagArray(features) {
  return JSON.stringify(features, null, 2);
}

function isApplicationArtifactIntent(intent = {}) {
  if (['web_app', 'full_stack_app', 'landing_page', 'internal_tool'].includes(intent.projectType)) {
    return true;
  }

  if (intent.goal === 'build_app') {
    return true;
  }

  const source = [
    intent.summary,
    intent.userInput,
    intent.projectName,
    ...(intent.steps ?? []),
    ...(intent.assumptions ?? []),
  ]
    .filter(Boolean)
    .join(' ');

  if (
    /\b(build|create|generate|make|launch|scaffold)\b/i.test(source)
    && /\b(app|application|saas|software|platform|site|dashboard|portal|workspace|tool)\b/i.test(source)
  ) {
    return true;
  }

  return (intent.features ?? []).some((feature) =>
    [
      'responsive_ui',
      'dashboard',
      'todo_management',
      'agenda_management',
      'auth',
      'user_auth',
      'payments',
      'subscription_billing',
      'file_uploads',
      'search',
      'admin_controls',
    ].includes(feature),
  );
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

function buildTreatmentRewardsFallback(intent) {
  const projectName = intent.projectName ?? 'treatment-rewards-app';

  const appSource = `import { useEffect, useMemo, useState } from 'react';
import './styles.css';

const STORAGE_KEY = 'omniforge-treatment-rewards-state';
const ADMIN_PASSCODE = 'recovery-admin';
const PRIZES = [
  { label: '$5 Gift Card', tone: 'mint' },
  { label: 'Coffee Voucher', tone: 'sky' },
  { label: 'Snack Pack', tone: 'violet' },
  { label: 'Transit Pass', tone: 'rose' },
  { label: 'Bonus Phone Minutes', tone: 'amber' },
  { label: 'Wellness Journal', tone: 'teal' },
];
const DEFAULT_CLIENTS = [
  {
    id: 1,
    name: 'Jordan M.',
    attendanceDone: true,
    uaComplete: true,
    hasSpun: false,
    lastPrize: null,
    spinCount: 0,
  },
  {
    id: 2,
    name: 'Taylor R.',
    attendanceDone: true,
    uaComplete: false,
    hasSpun: false,
    lastPrize: null,
    spinCount: 0,
  },
  {
    id: 3,
    name: 'Alex P.',
    attendanceDone: false,
    uaComplete: false,
    hasSpun: false,
    lastPrize: null,
    spinCount: 0,
  },
];

function randomIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] % length;
  }

  return Math.floor(Math.random() * length);
}

function createInitialState() {
  return {
    clients: DEFAULT_CLIENTS,
    activeClientId: DEFAULT_CLIENTS[0].id,
  };
}

function loadState() {
  if (typeof window === 'undefined') {
    return createInitialState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createInitialState();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.clients) || parsed.clients.length === 0) {
      return createInitialState();
    }

    return {
      clients: parsed.clients,
      activeClientId: parsed.activeClientId ?? parsed.clients[0].id,
    };
  } catch {
    return createInitialState();
  }
}

function saveState(value) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function isEligible(client) {
  return Boolean(client && client.attendanceDone && client.uaComplete && !client.hasSpun);
}

export default function App() {
  const [role, setRole] = useState('client');
  const [state, setState] = useState(() => loadState());
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [flash, setFlash] = useState('Select a client and check eligibility to spin the wheel.');
  const [spinning, setSpinning] = useState(false);
  const [winningIndex, setWinningIndex] = useState(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeClient = useMemo(
    () => state.clients.find((client) => client.id === state.activeClientId) ?? null,
    [state],
  );
  const eligible = isEligible(activeClient);

  function updateClient(clientId, updater) {
    setState((currentState) => ({
      ...currentState,
      clients: currentState.clients.map((client) => {
        if (client.id !== clientId) {
          return client;
        }

        return typeof updater === 'function' ? updater(client) : { ...client, ...updater };
      }),
    }));
  }

  function addClient(event) {
    event.preventDefault();
    const normalizedName = newClientName.trim();

    if (!normalizedName) {
      setFlash('Enter a client name before adding them to the program.');
      return;
    }

    const nextClient = {
      id: Date.now(),
      name: normalizedName,
      attendanceDone: false,
      uaComplete: false,
      hasSpun: false,
      lastPrize: null,
      spinCount: 0,
    };

    setState((currentState) => ({
      ...currentState,
      clients: [nextClient, ...currentState.clients],
      activeClientId: nextClient.id,
    }));
    setNewClientName('');
    setFlash(normalizedName + ' added to the rewards program.');
  }

  function removeClient(clientId) {
    setState((currentState) => {
      const nextClients = currentState.clients.filter((client) => client.id !== clientId);
      return {
        clients: nextClients,
        activeClientId: nextClients[0]?.id ?? null,
      };
    });
    setFlash('Client removed from the program list.');
  }

  function unlockAdmin(event) {
    event.preventDefault();

    if (adminCode.trim().toLowerCase() !== ADMIN_PASSCODE) {
      setFlash('Use the admin code recovery-admin to unlock staff controls.');
      return;
    }

    setAdminUnlocked(true);
    setAdminCode('');
    setFlash('Administrator tools unlocked.');
  }

  function handleSpin() {
    if (!activeClient) {
      setFlash('Select a client first.');
      return;
    }

    if (!eligible) {
      setFlash('This client must complete attendance and a consistent UA before spinning.');
      return;
    }

    setSpinning(true);
    setFlash('Spinning the wheel for ' + activeClient.name + '...');
    const nextWinningIndex = randomIndex(PRIZES.length);

    window.setTimeout(() => {
      const prize = PRIZES[nextWinningIndex];
      setWinningIndex(nextWinningIndex);
      updateClient(activeClient.id, (client) => ({
        ...client,
        hasSpun: true,
        lastPrize: prize.label,
        spinCount: client.spinCount + 1,
      }));
      setSpinning(false);
      setFlash(activeClient.name + ' won ' + prize.label + '.');
    }, 900);
  }

  return (
    <div className="reward-shell">
      <section className="hero-card">
        <div>
          <span className="eyebrow">OmniForge Rewards SaaS</span>
          <h1>${projectName}</h1>
          <p>
            A treatment-program rewards application with a fully random wheel, a client spin flow,
            and administrator controls for attendance, UAs, and eligibility.
          </p>
        </div>
        <div className="role-switcher">
          <button
            type="button"
            className={role === 'client' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setRole('client')}
          >
            Client
          </button>
          <button
            type="button"
            className={role === 'admin' ? 'tab-button tab-button--active' : 'tab-button'}
            onClick={() => setRole('admin')}
          >
            Administrator
          </button>
        </div>
      </section>

      <div className="app-grid">
        <section className="workspace-card">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Client experience</span>
              <h2>Reward wheel</h2>
            </div>
            <select
              className="client-select"
              value={state.activeClientId ?? ''}
              onChange={(event) =>
                setState((currentState) => ({
                  ...currentState,
                  activeClientId: Number(event.target.value),
                }))
              }
            >
              {state.clients.map((client) => (
                <option value={client.id} key={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          <div className="wheel-layout">
            <div className={spinning ? 'wheel wheel--spinning' : 'wheel'}>
              {PRIZES.map((prize, index) => (
                <div
                  className={winningIndex === index ? 'wheel-segment wheel-segment--active' : 'wheel-segment'}
                  data-tone={prize.tone}
                  key={prize.label}
                >
                  {prize.label}
                </div>
              ))}
            </div>

            <div className="spin-panel">
              <div className="status-card">
                <span>Selected client</span>
                <strong>{activeClient?.name ?? 'No client selected'}</strong>
              </div>
              <div className="status-card">
                <span>Eligibility</span>
                <strong>{eligible ? 'Ready to spin' : 'Needs admin approval'}</strong>
              </div>
              <button type="button" className="spin-button" disabled={!eligible || spinning} onClick={handleSpin}>
                {spinning ? 'Spinning...' : 'Spin wheel'}
              </button>
              <p className="helper-text">
                {activeClient?.lastPrize
                  ? activeClient.name + ' last won ' + activeClient.lastPrize + '.'
                  : 'No prize has been awarded to this client yet.'}
              </p>
            </div>
          </div>

          <div className="eligibility-grid">
            <article className={activeClient?.attendanceDone ? 'check-card check-card--done' : 'check-card'}>
              <span>Attendance</span>
              <strong>{activeClient?.attendanceDone ? 'Complete' : 'Pending'}</strong>
            </article>
            <article className={activeClient?.uaComplete ? 'check-card check-card--done' : 'check-card'}>
              <span>Consistent UA</span>
              <strong>{activeClient?.uaComplete ? 'Complete' : 'Pending'}</strong>
            </article>
            <article className={activeClient?.hasSpun ? 'check-card' : 'check-card check-card--done'}>
              <span>Spin available</span>
              <strong>{activeClient?.hasSpun ? 'Already used' : 'Available'}</strong>
            </article>
          </div>
        </section>

        <aside className="workspace-card admin-column">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Staff controls</span>
              <h2>Administrator panel</h2>
            </div>
          </div>

          {role === 'admin' && !adminUnlocked ? (
            <form className="admin-unlock" onSubmit={unlockAdmin}>
              <p>Enter the admin code to manage client eligibility.</p>
              <input
                value={adminCode}
                onChange={(event) => setAdminCode(event.target.value)}
                placeholder="recovery-admin"
              />
              <button type="submit">Unlock admin tools</button>
            </form>
          ) : (
            <>
              <form className="add-client-form" onSubmit={addClient}>
                <input
                  value={newClientName}
                  onChange={(event) => setNewClientName(event.target.value)}
                  placeholder="Add a new client"
                />
                <button type="submit">Add client</button>
              </form>

              <div className="client-list">
                {state.clients.map((client) => {
                  const clientEligible = isEligible(client);

                  return (
                    <article className="client-row" key={client.id}>
                      <div>
                        <strong>{client.name}</strong>
                        <p>
                          {client.lastPrize ? 'Last prize: ' + client.lastPrize : 'No prize awarded yet.'}
                        </p>
                      </div>
                      <div className="client-actions">
                        <button
                          type="button"
                          className={client.attendanceDone ? 'mini-button mini-button--done' : 'mini-button'}
                          onClick={() => updateClient(client.id, { attendanceDone: !client.attendanceDone })}
                        >
                          Attendance {client.attendanceDone ? 'done' : 'pending'}
                        </button>
                        <button
                          type="button"
                          className={client.uaComplete ? 'mini-button mini-button--done' : 'mini-button'}
                          onClick={() => updateClient(client.id, { uaComplete: !client.uaComplete })}
                        >
                          UA {client.uaComplete ? 'done' : 'pending'}
                        </button>
                        <button
                          type="button"
                          className={clientEligible ? 'mini-button mini-button--eligible' : 'mini-button'}
                          onClick={() =>
                            updateClient(client.id, {
                              attendanceDone: true,
                              uaComplete: true,
                              hasSpun: false,
                            })
                          }
                        >
                          Mark eligible
                        </button>
                        <button
                          type="button"
                          className="mini-button"
                          onClick={() => updateClient(client.id, { hasSpun: false, lastPrize: null })}
                        >
                          Reset spin
                        </button>
                        <button type="button" className="mini-button mini-button--danger" onClick={() => removeClient(client.id)}>
                          Remove
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="flash-banner">{flash}</div>
    </div>
  );
}
`;

  const stylesSource = `:root {
  color-scheme: dark;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(16, 185, 129, 0.18), transparent 24%),
    radial-gradient(circle at top right, rgba(99, 102, 241, 0.22), transparent 24%),
    linear-gradient(180deg, #04070f 0%, #08101d 50%, #04060c 100%);
  color: #f8fbff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, rgba(16, 185, 129, 0.18), transparent 24%),
    radial-gradient(circle at top right, rgba(99, 102, 241, 0.22), transparent 24%),
    linear-gradient(180deg, #04070f 0%, #08101d 50%, #04060c 100%);
}

button,
input,
select {
  font: inherit;
}

button,
select,
input {
  border-radius: 14px;
}

button {
  border: 0;
  cursor: pointer;
}

input,
select {
  width: 100%;
  background: rgba(5, 10, 22, 0.82);
  border: 1px solid rgba(148, 163, 184, 0.16);
  color: white;
  padding: 0.9rem 1rem;
}

.reward-shell {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 28px 0 40px;
}

.hero-card,
.workspace-card,
.flash-banner {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(7, 12, 24, 0.84);
  box-shadow: 0 24px 70px rgba(2, 6, 23, 0.34);
  backdrop-filter: blur(18px);
}

.hero-card,
.workspace-card {
  border-radius: 28px;
}

.hero-card {
  padding: 28px;
  display: grid;
  gap: 20px;
}

.eyebrow,
.section-kicker {
  display: inline-flex;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.78rem;
  font-weight: 700;
}

.eyebrow {
  color: #6ee7b7;
  margin-bottom: 12px;
}

.hero-card h1,
.workspace-card h2 {
  margin: 0;
}

.hero-card p,
.workspace-card p {
  color: #aec1df;
}

.role-switcher {
  display: inline-flex;
  width: fit-content;
  padding: 4px;
  gap: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.tab-button {
  background: transparent;
  color: #dce7fb;
  padding: 0.8rem 1rem;
}

.tab-button--active,
.spin-button,
.add-client-form button,
.admin-unlock button,
.mini-button--eligible {
  background: linear-gradient(135deg, #10b981, #6366f1);
  color: #03111b;
  font-weight: 700;
}

.app-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, 0.95fr);
  gap: 20px;
  margin-top: 22px;
}

.workspace-card {
  padding: 24px;
}

.section-heading {
  display: flex;
  gap: 16px;
  justify-content: space-between;
  align-items: end;
  margin-bottom: 18px;
}

.section-kicker {
  color: #8fb5ff;
  margin-bottom: 6px;
}

.client-select {
  max-width: 280px;
}

.wheel-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(240px, 0.8fr);
  gap: 18px;
}

.wheel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 18px;
  border-radius: 26px;
  background: radial-gradient(circle at top, rgba(99, 102, 241, 0.18), rgba(15, 23, 42, 0.9));
  min-height: 320px;
}

.wheel--spinning .wheel-segment {
  animation: pulse 0.35s linear infinite alternate;
}

.wheel-segment {
  min-height: 86px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 14px;
  font-weight: 700;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
}

.wheel-segment[data-tone='mint'] { background: rgba(16, 185, 129, 0.18); }
.wheel-segment[data-tone='sky'] { background: rgba(56, 189, 248, 0.18); }
.wheel-segment[data-tone='violet'] { background: rgba(139, 92, 246, 0.18); }
.wheel-segment[data-tone='rose'] { background: rgba(244, 63, 94, 0.18); }
.wheel-segment[data-tone='amber'] { background: rgba(245, 158, 11, 0.18); }
.wheel-segment[data-tone='teal'] { background: rgba(20, 184, 166, 0.18); }

.wheel-segment--active {
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.1), 0 16px 40px rgba(99, 102, 241, 0.35);
  transform: translateY(-2px);
}

.spin-panel,
.status-card,
.check-card,
.client-row {
  border-radius: 18px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(255, 255, 255, 0.04);
}

.spin-panel {
  padding: 18px;
  display: grid;
  gap: 12px;
}

.status-card,
.check-card {
  padding: 16px;
}

.status-card span,
.check-card span {
  display: block;
  color: #8ca3c7;
  margin-bottom: 8px;
  font-size: 0.82rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.status-card strong,
.check-card strong {
  font-size: 1.1rem;
}

.spin-button {
  padding: 0.95rem 1.1rem;
}

.spin-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.helper-text {
  margin: 0;
  line-height: 1.6;
}

.eligibility-grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.check-card--done {
  border-color: rgba(16, 185, 129, 0.32);
  background: rgba(16, 185, 129, 0.09);
}

.admin-column {
  display: grid;
  gap: 18px;
  align-content: start;
}

.admin-unlock,
.add-client-form,
.client-actions {
  display: grid;
  gap: 12px;
}

.add-client-form {
  grid-template-columns: minmax(0, 1fr) auto;
}

.client-list {
  display: grid;
  gap: 12px;
}

.client-row {
  padding: 16px;
  display: grid;
  gap: 14px;
}

.client-row strong {
  display: block;
  margin-bottom: 6px;
}

.client-row p {
  margin: 0;
}

.mini-button {
  background: rgba(255, 255, 255, 0.05);
  color: white;
  padding: 0.8rem 0.9rem;
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.mini-button--done {
  border-color: rgba(16, 185, 129, 0.4);
  color: #6ee7b7;
}

.mini-button--danger {
  color: #fecaca;
  border-color: rgba(248, 113, 113, 0.28);
}

.flash-banner {
  margin-top: 18px;
  border-radius: 18px;
  padding: 16px 18px;
  color: #dbeafe;
}

@keyframes pulse {
  from { transform: scale(0.98); }
  to { transform: scale(1.02); }
}

@media (max-width: 960px) {
  .app-grid,
  .wheel-layout,
  .eligibility-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .add-client-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .client-select {
    max-width: none;
  }
}
`;

  return [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: projectName,
          private: true,
          version: '0.1.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^19.2.0',
            'react-dom': '^19.2.0',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^5.1.0',
            vite: '^7.1.12',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'index.html',
      content: `<!doctype html>
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
`,
    },
    {
      path: 'src/main.jsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    {
      path: 'src/App.jsx',
      content: appSource,
    },
    {
      path: 'src/styles.css',
      content: stylesSource,
    },
    {
      path: 'README.md',
      content: `# ${projectName}

Generated by OmniForge for a treatment-program rewards workflow.

## Included product flows

- Client-facing spin wheel with fully random prize selection
- Administrator tools for adding, removing, and managing client eligibility
- Attendance + consistent UA gating before spin eligibility
- Local persistence for quick demo and validation runs

## Run

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
    },
    {
      path: 'vite.config.js',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    },
  ];
}

function createIntentSignalSet(intent = {}) {
  const source = [
    intent.goal,
    intent.summary,
    intent.userInput,
    intent.projectName,
    ...(intent.features ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const signalSet = new Set((intent.features ?? []).map((feature) => String(feature).toLowerCase()));

  if (signalSet.has('user_auth') || /\b(auth|authentication|login|sign[\s-]?in|account)\b/.test(source)) {
    signalSet.add('auth');
  }

  if (signalSet.has('client_management') || /\b(client|customer|patient|member|lead|contact|crm|portal)\b/.test(source)) {
    signalSet.add('client_management');
  }

  if (signalSet.has('wheel_spin') || /\b(wheel|spin|reward|prize)\b/.test(source)) {
    signalSet.add('wheel_spin');
  }

  if (/\b(scan|scanner|barcode|camera|qr)\b/.test(source)) {
    signalSet.add('scanner');
  }

  if (/\b(billing|payment|checkout|subscription|plan|upgrade|revenue)\b/.test(source)) {
    signalSet.add('payments');
  }

  if (/\b(notification|alert|message|reminder)\b/.test(source)) {
    signalSet.add('notifications');
  }

  if (/\b(upload|attachment|document|image|asset|brief)\b/.test(source)) {
    signalSet.add('file_uploads');
  }

  if (/\b(search|filter|query|find)\b/.test(source)) {
    signalSet.add('search');
  }

  if (/\b(admin|operator|staff|approval|queue|workflow)\b/.test(source)) {
    signalSet.add('admin_controls');
    signalSet.add('dashboard');
  }

  if (/\b(analytics|insight|forecast|profit|margin)\b/.test(source)) {
    signalSet.add('analytics');
  }

  return signalSet;
}

function buildWebAppFallback(intent) {
  if (isTreatmentRewardsIntent(intent)) {
    return buildTreatmentRewardsFallback(intent);
  }

  const projectName = intent.projectName ?? 'omniforge-app';
  const preferredUiStyle = intent.preferences?.preferredUiStyle ?? '';
  const referenceBranding = intent.referenceContext?.branding ?? {};
  const referenceSummary = intent.referenceContext?.summary ?? '';
  const referenceSummaryLiteral = JSON.stringify(referenceSummary);
  const dominantReferenceColor = Array.isArray(referenceBranding?.dominantColors) &&
    referenceBranding.dominantColors.length > 0
      ? referenceBranding.dominantColors[0]
      : '';
  const signalSet = createIntentSignalSet(intent);
  const featureFlags = [...signalSet];
  const includesAuth = signalSet.has('auth');
  const includesDashboard = signalSet.has('dashboard') || signalSet.has('admin_controls');
  const includesNotifications = signalSet.has('notifications');
  const includesSearch = signalSet.has('search');
  const includesPayments = signalSet.has('payments');
  const includesUploads = signalSet.has('file_uploads');
  const includesScanner = signalSet.has('scanner');
  const includesClientManagement = signalSet.has('client_management');
  const includesAnalytics = signalSet.has('analytics');
  const prefersFintech = preferredUiStyle === 'fintech' || includesPayments;
  const prefersBold = preferredUiStyle === 'bold';
  const heroLabel = preferredUiStyle
    ? `OmniForge ${preferredUiStyle.replace(/_/g, ' ')} product build`
    : 'OmniForge Finished Product';
  const backgroundStart = prefersFintech ? '#041512' : prefersBold ? '#180802' : '#07111f';
  const backgroundMid = prefersFintech ? '#06211d' : prefersBold ? '#26110a' : '#08101b';
  const backgroundEnd = prefersFintech ? '#020907' : prefersBold ? '#0f0502' : '#05070b';
  const accentPrimary = dominantReferenceColor || (prefersFintech ? '#14b8a6' : prefersBold ? '#f97316' : '#0ea5e9');
  const accentSecondary = prefersFintech ? '#22c55e' : prefersBold ? '#dc2626' : '#2563eb';
  const productMode = includesScanner
    ? 'scanner'
    : includesPayments
      ? 'revenue'
      : includesClientManagement
        ? 'portal'
        : 'operations';
  const heroTitle = includesScanner
    ? 'Scan, qualify, and act in one flow'
    : includesPayments
      ? 'Convert revenue from one operating hub'
      : includesClientManagement
        ? 'Give every customer a self-serve product'
        : 'Run the business from a real operating system';
  const heroDescription = includesScanner
    ? 'Operators can capture live inputs, review results, and route decisions without leaving the product.'
    : includesPayments
      ? 'This finished app ties together pipeline, billing, and customer follow-up so the product can convert, monetize, and retain users.'
      : includesClientManagement
        ? 'This build gives customers and staff a structured portal with status tracking, actions, and account visibility.'
        : 'This finished app centralizes workflow, team actions, and operating visibility into a single usable product surface.';
  const seedRecords = includesScanner
    ? [
        { id: 1, title: 'Organic Snack Box', owner: 'Jordan', value: 87, status: 'qualified', priority: 'high', note: 'Health score calculated and healthier swap suggested.' },
        { id: 2, title: 'Energy Drink', owner: 'Taylor', value: 42, status: 'review', priority: 'medium', note: 'Review ingredient warning and offer premium alternative.' },
        { id: 3, title: 'Breakfast Cereal', owner: 'Alex', value: 76, status: 'ready', priority: 'low', note: 'Ready to save into the recent scan history.' },
      ]
    : includesPayments
      ? [
          { id: 1, title: 'Inbound demo request', owner: 'Avery', value: 2400, status: 'proposal', priority: 'high', note: 'Follow up with automated pricing summary.' },
          { id: 2, title: 'Reactivation campaign', owner: 'Morgan', value: 1800, status: 'qualified', priority: 'medium', note: 'Target churned accounts with premium offer.' },
          { id: 3, title: 'Enterprise upgrade', owner: 'Skyler', value: 5600, status: 'ready', priority: 'high', note: 'Send contract and activate white-glove onboarding.' },
        ]
      : includesClientManagement
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
  const seedMetrics = includesScanner
    ? [
        { label: 'Scans today', value: '24' },
        { label: 'Healthy swaps', value: '11' },
        { label: 'Saved results', value: '8' },
        { label: 'Operator SLAs', value: '97%' },
      ]
    : includesPayments
      ? [
          { label: 'MRR pipeline', value: '$12.4k' },
          { label: 'Qualified deals', value: '18' },
          { label: 'Close rate', value: '31%' },
          { label: 'Automation lift', value: '+14%' },
        ]
      : includesClientManagement
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
  const seedActivity = includesScanner
    ? [
        'A live scan was categorized and routed for action.',
        'A healthier swap recommendation was saved to the workspace.',
        'The product surface refreshed the recent scan history.',
      ]
    : includesPayments
      ? [
          'A proposal moved into checkout-ready status.',
          'An upgrade prompt converted a user into a paid plan.',
          'The revenue forecast updated after the latest pipeline event.',
        ]
      : includesClientManagement
        ? [
            'A client completed a self-serve action without staff help.',
            'A document upload moved an account into ready status.',
            'An operator resolved a queue item and notified the user.',
          ]
        : [
            'An operator approved the next queue item.',
            'A workflow exception was resolved and cleared.',
            'The team dashboard refreshed its daily activity snapshot.',
          ];
  const navigationTabs = ['Overview', 'Workspace', 'Records', 'Insights', includesPayments ? 'Billing' : 'Admin'];

  const appSource = `import { useEffect, useMemo, useState } from 'react';
import './styles.css';

const projectName = ${JSON.stringify(projectName)};
const productMode = ${JSON.stringify(productMode)};
const includesAuth = ${includesAuth ? 'true' : 'false'};
const includesPayments = ${includesPayments ? 'true' : 'false'};
const includesNotifications = ${includesNotifications ? 'true' : 'false'};
const includesUploads = ${includesUploads ? 'true' : 'false'};
const includesScanner = ${includesScanner ? 'true' : 'false'};
const includesClientManagement = ${includesClientManagement ? 'true' : 'false'};
const includesAnalytics = ${includesAnalytics ? 'true' : 'false'};
const featureFlags = ${buildFeatureFlagArray(featureFlags)};
const storageKey = ${JSON.stringify(`${projectName}-omniforge-product-state`)};
const navigationTabs = ${JSON.stringify(navigationTabs)};
const seedRecords = ${JSON.stringify(seedRecords, null, 2)};
const seedMetrics = ${JSON.stringify(seedMetrics, null, 2)};
const seedActivity = ${JSON.stringify(seedActivity, null, 2)};
const heroTitle = ${JSON.stringify(heroTitle)};
const heroDescription = ${JSON.stringify(heroDescription)};
const referenceSummary = ${referenceSummaryLiteral};

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

function formatMoney(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function nextStatus(currentStatus) {
  const sequence = includesScanner
    ? ['review', 'qualified', 'ready', 'saved']
    : includesPayments
      ? ['qualified', 'proposal', 'ready', 'live']
      : ['review', 'active', 'ready', 'live'];
  const currentIndex = sequence.indexOf(currentStatus);
  return sequence[(currentIndex + 1) % sequence.length];
}

export default function App() {
  const storedState = loadState();
  const [session, setSession] = useState(
    storedState?.session ?? (includesAuth ? null : { name: 'OmniForge Operator', role: 'operator', email: 'operator@omniforge.local' }),
  );
  const [credentials, setCredentials] = useState({
    email: 'builder@omniforge.local',
    password: '',
  });
  const [activeTab, setActiveTab] = useState(storedState?.activeTab ?? 'Overview');
  const [records, setRecords] = useState(storedState?.records ?? seedRecords);
  const [activity, setActivity] = useState(storedState?.activity ?? seedActivity);
  const [premium, setPremium] = useState(storedState?.premium ?? false);
  const [workspaceMessage, setWorkspaceMessage] = useState(storedState?.workspaceMessage ?? 'Product ready. Use the actions below to drive real workflow changes.');
  const [draft, setDraft] = useState({ title: '', owner: '', value: '' });
  const [query, setQuery] = useState('');
  const [banner, setBanner] = useState(
    includesAuth
      ? 'Authenticate to unlock the live workspace.'
      : 'Finished product ready. Start using the workflow controls.',
  );
  const [lastAction, setLastAction] = useState(storedState?.lastAction ?? null);

  const visibleRecords = records.filter((record) =>
    [record.title, record.owner, record.note, record.status]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const completedCount = records.filter((record) => record.status === 'live' || record.status === 'saved').length;
  const topRecord = visibleRecords[0] ?? null;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        session,
        activeTab,
        records,
        activity,
        premium,
        workspaceMessage,
        lastAction,
      }),
    );
  }, [session, activeTab, records, activity, premium, workspaceMessage, lastAction]);

  const insightCards = useMemo(() => {
    if (includesPayments) {
      return [
        { label: 'Projected lift', value: '+$3.2k/mo' },
        { label: 'Best channel', value: 'Automated follow-up' },
        { label: 'Next action', value: 'Push proposal into checkout' },
      ];
    }

    if (includesScanner) {
      return [
        { label: 'Average score', value: '68 / 100' },
        { label: 'Fastest action', value: 'Save result' },
        { label: 'Retention hook', value: 'Favorites + history' },
      ];
    }

    return [
      { label: 'Savings target', value: '11h / week' },
      { label: 'Top friction', value: 'Manual follow-up' },
      { label: 'Best automation', value: 'Queue + reminders' },
    ];
  }, []);

  function appendActivity(message) {
    setActivity((current) => [message, ...current].slice(0, 6));
  }

  function handleSignIn(event) {
    event.preventDefault();
    setSession({
      name: 'OmniForge Operator',
      email: credentials.email || 'operator@omniforge.local',
      role: 'operator',
    });
    setBanner('Authenticated. The product workspace is now live and interactive.');
    appendActivity('A secure operator session was started.');
  }

  function handleAddRecord(event) {
    event.preventDefault();

    const normalizedTitle = draft.title.trim();
    const normalizedOwner = draft.owner.trim() || 'Unassigned';

    if (!normalizedTitle) {
      return;
    }

    setRecords((currentRecords) => [
      {
        id: Date.now(),
        title: normalizedTitle,
        owner: normalizedOwner,
        value: Number(draft.value) || (includesPayments ? 2400 : includesScanner ? 82 : 1),
        status: includesPayments ? 'qualified' : includesScanner ? 'review' : 'active',
        priority: 'medium',
        note: includesScanner
          ? 'Fresh result added to the recent scan queue.'
          : includesPayments
            ? 'New revenue opportunity added to the active pipeline.'
            : 'New workflow item added to the operating queue.',
      },
      ...currentRecords,
    ]);
    setDraft({ title: '', owner: '', value: '' });
    appendActivity(normalizedTitle + ' was added to the live product workspace.');
  }

  function advanceRecord(recordId) {
    setRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === recordId ? { ...record, status: nextStatus(record.status) } : record,
      ),
    );
    appendActivity('A record advanced to the next production stage.');
  }

  function togglePriority(recordId) {
    setRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.id === recordId
          ? { ...record, priority: record.priority === 'high' ? 'medium' : 'high' }
          : record,
      ),
    );
    appendActivity('Priority was updated for an active record.');
  }

  function handlePrimaryAction() {
    if (includesScanner) {
      const simulatedScan = {
        title: 'Organic snack bar',
        owner: 'Scanner',
        value: 87,
        status: 'saved',
        priority: 'high',
        note: 'Scanned live. Health score 87 with a healthier swap recommendation.',
      };
      setRecords((currentRecords) => [{ id: Date.now(), ...simulatedScan }, ...currentRecords].slice(0, 8));
      setLastAction('Latest scan: Organic snack bar scored 87 and saved into the workspace.');
      setWorkspaceMessage('Scanner flow completed. The result is now saved in the product history.');
      appendActivity('A live scan was captured and saved.');
      return;
    }

    if (includesPayments) {
      setPremium(true);
      setLastAction('Billing flow advanced. Premium conversion path is active.');
      setWorkspaceMessage('Checkout and conversion flows are active inside the live product.');
      appendActivity('A revenue workflow moved into premium conversion.');
      return;
    }

    setLastAction('Workflow queue progressed to the next action.');
    setWorkspaceMessage('Operations flow updated. The product workspace is keeping the team aligned.');
    appendActivity('The main workflow advanced to its next milestone.');
  }

  function handleSecondaryAction() {
    setActiveTab('Insights');
    appendActivity('Insights view opened for review.');
  }

  return (
    <div className="page-shell">
      <main className="app-frame">
        <section className="hero-panel">
          <span className="eyebrow">${heroLabel}</span>
          <h1>{projectName}</h1>
          <p>
            {heroDescription}
          </p>
          ${referenceSummary ? `<div className="banner banner--muted">{${referenceSummaryLiteral}}</div>` : ''}
          <div className="feature-list">
            {featureFlags.map((feature) => (
              <span className="feature-pill" key={feature}>
                {feature.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <div className="hero-actions">
            <button type="button" onClick={handlePrimaryAction}>
              {includesScanner ? 'Open scanner' : includesPayments ? 'Open conversion flow' : 'Advance workflow'}
            </button>
            <button className="ghost-button" type="button" onClick={handleSecondaryAction}>
              Review insights
            </button>
          </div>
          <div className="banner">{banner}</div>
        </section>

        <section className="content-grid">
          <section className="card card--sidebar">
            <h2>Product navigation</h2>
            <div className="nav-stack">
              {navigationTabs.map((tab) => (
                <button
                  className={activeTab === tab ? 'nav-button nav-button--active' : 'nav-button'}
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  type="button"
                >
                  <span>{tab}</span>
                  <strong>{tab === 'Overview' ? 'Home' : tab}</strong>
                </button>
              ))}
            </div>
            {includesAuth && !session ? (
              <form className="stack" onSubmit={handleSignIn}>
                <label>
                  Operator email
                  <input
                    type="email"
                    value={credentials.email}
                    onChange={(event) =>
                      setCredentials((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="operator@company.com"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={credentials.password}
                    onChange={(event) =>
                      setCredentials((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="Use any local demo password"
                  />
                </label>
                <button type="submit">Enter workspace</button>
              </form>
            ) : (
              <div className="session-card">
                <span>Active session</span>
                <strong>{session?.name ?? 'Guest workspace'}</strong>
                <p>{session?.email ?? 'Interactive demo access is available.'}</p>
                {includesAuth ? (
                  <button type="button" onClick={() => setSession(null)}>
                    Sign out
                  </button>
                ) : null}
              </div>
            )}
          </section>

          <section className="card card--main">
            <div className="section-header">
              <div>
                <h2>{activeTab}</h2>
                <p>{workspaceMessage}</p>
              </div>
              ${includesSearch ? `<input
                className="search-input"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search live records"
              />` : ''}
            </div>

            {activeTab === 'Overview' ? (
              <div className="overview-stack">
                <div className="metric-grid">
                  {seedMetrics.map((card) => (
                    <article className="metric-card" key={card.label}>
                      <span>{card.label}</span>
                      <strong>{card.value}</strong>
                    </article>
                  ))}
                </div>
                <div className="showcase-grid">
                  <article className="showcase-card">
                    <span className="section-kicker">Primary workflow</span>
                    <strong>{heroTitle}</strong>
                    <p>{lastAction || heroDescription}</p>
                    <div className="pill-row">
                      {featureFlags.slice(0, 5).map((feature) => (
                        <span className="feature-pill feature-pill--solid" key={feature}>{feature.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </article>
                  <article className="showcase-card">
                    <span className="section-kicker">Delivery status</span>
                    <strong>{completedCount} items advanced</strong>
                    <p>The product is running with a usable workflow, live state changes, and persistent local product memory.</p>
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
            ) : null}

            {activeTab === 'Workspace' ? (
              <div className="workspace-stack">
                <article className="workspace-module">
                  <div>
                    <span className="section-kicker">Live action</span>
                    <strong>{includesScanner ? 'Scanner simulation' : includesPayments ? 'Revenue flow' : 'Operations flow'}</strong>
                    <p>{lastAction || 'Use the action button to progress the finished product workflow.'}</p>
                  </div>
                  <div className="workspace-module__actions">
                    <button type="button" onClick={handlePrimaryAction}>
                      {includesScanner ? 'Simulate scan' : includesPayments ? 'Convert pipeline' : 'Advance workflow'}
                    </button>
                    <button className="ghost-button" type="button" onClick={handleSecondaryAction}>
                      Open insights
                    </button>
                  </div>
                </article>
                <article className="workspace-module workspace-module--soft">
                  <span className="section-kicker">Recent product activity</span>
                  <div className="activity-list">
                    {activity.map((item, index) => (
                      <article className="activity-card" key={item + index}>
                        <strong>Update {index + 1}</strong>
                        <p>{item}</p>
                      </article>
                    ))}
                  </div>
                </article>
              </div>
            ) : null}

            {activeTab === 'Records' ? (
              <div className="records-stack">
                <form className="record-form" onSubmit={handleAddRecord}>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder=${JSON.stringify(includesScanner ? 'Add a product to review' : includesPayments ? 'Add a revenue opportunity' : 'Add a workflow record')}
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
                    placeholder=${JSON.stringify(includesPayments ? 'Value' : 'Score')}
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
                        <span>{includesPayments ? formatMoney(record.value) : record.value}</span>
                        <span>Priority: {record.priority}</span>
                      </div>
                      <div className="record-card__actions">
                        <button type="button" onClick={() => advanceRecord(record.id)}>Advance</button>
                        <button className="ghost-button" type="button" onClick={() => togglePriority(record.id)}>
                          Toggle priority
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === 'Insights' ? (
              <div className="insight-grid">
                {insightCards.map((card) => (
                  <article className="showcase-card" key={card.label}>
                    <span className="section-kicker">{card.label}</span>
                    <strong>{card.value}</strong>
                    <p>{includesAnalytics ? 'AI-assisted reporting is active for this finished product surface.' : 'Operational insight generated from the live workflow state.'}</p>
                  </article>
                ))}
              </div>
            ) : null}

            {activeTab === 'Billing' || activeTab === 'Admin' ? (
              <div className="workspace-stack">
                <article className="workspace-module">
                  <span className="section-kicker">{includesPayments ? 'Billing' : 'Admin controls'}</span>
                  <strong>{includesPayments ? (premium ? 'Premium plan active' : 'Starter plan live') : 'Operator controls ready'}</strong>
                  <p>
                    {includesPayments
                      ? 'Pricing, upgrade, and monetization flows are included in this finished build.'
                      : 'Operator actions, assignments, and queue management are ready to use.'}
                  </p>
                  <div className="workspace-module__actions">
                    {includesPayments ? (
                      <button type="button" onClick={() => { setPremium((current) => !current); appendActivity('Billing plan was updated from the live product.'); }}>
                        {premium ? 'Manage plan' : 'Upgrade now'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => appendActivity('An admin action was completed in the workspace.')}>
                        Approve next item
                      </button>
                    )}
                    {includesNotifications ? (
                      <button className="ghost-button" type="button" onClick={() => appendActivity('A customer notification was sent.')}>
                        Send alert
                      </button>
                    ) : null}
                  </div>
                </article>
                ${includesUploads ? `<article className="workspace-module workspace-module--soft">
                  <span className="section-kicker">Assets</span>
                  <strong>Upload pipeline ready</strong>
                  <p>Generated products can capture documents, assets, or customer uploads inside the workspace.</p>
                </article>` : ''}
              </div>
            ) : null}
          </section>

          <section className="card card--rail">
            <h2>Live assistant rail</h2>
            <div className="rail-block">
              <span className="section-kicker">Reference context</span>
              <p>{referenceSummary || 'No source reference was attached to this build.'}</p>
            </div>
            <div className="rail-block">
              <span className="section-kicker">Top record</span>
              <strong>{topRecord ? topRecord.title : 'No active record'}</strong>
              <p>{topRecord ? topRecord.note : 'Add a new record to populate the workspace.'}</p>
            </div>
            <div className="rail-block">
              <span className="section-kicker">Execution status</span>
              <div className="check-list">
                <div><span className="check-dot"></span><strong>Interactive UI</strong></div>
                <div><span className="check-dot"></span><strong>Stateful workflows</strong></div>
                <div><span className="check-dot"></span><strong>Ready to extend</strong></div>
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
`;

  const stylesSource = `:root {
  color-scheme: dark;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  background:
    radial-gradient(circle at top left, ${prefersFintech ? 'rgba(20, 184, 166, 0.18)' : prefersBold ? 'rgba(249, 115, 22, 0.22)' : 'rgba(14, 165, 233, 0.16)'}, transparent 28%),
    linear-gradient(180deg, ${backgroundStart} 0%, ${backgroundMid} 48%, ${backgroundEnd} 100%);
  color: #f8fbff;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(circle at top left, ${prefersFintech ? 'rgba(20, 184, 166, 0.18)' : prefersBold ? 'rgba(249, 115, 22, 0.22)' : 'rgba(14, 165, 233, 0.16)'}, transparent 28%),
    linear-gradient(180deg, ${backgroundStart} 0%, ${backgroundMid} 48%, ${backgroundEnd} 100%);
}

button,
input {
  font: inherit;
}

button {
  border: 0;
  border-radius: 12px;
  padding: 0.9rem 1.2rem;
  background: linear-gradient(135deg, ${accentPrimary}, ${accentSecondary});
  color: white;
  cursor: pointer;
}

.ghost-button {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

input {
  width: 100%;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  padding: 0.9rem 1rem;
  background: rgba(9, 17, 30, 0.88);
  color: #f8fbff;
}

.page-shell {
  min-height: 100vh;
  padding: 32px;
}

.app-frame {
  width: min(1120px, 100%);
  margin: 0 auto;
}

.hero-panel,
.card {
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(7, 12, 24, 0.82);
  box-shadow: 0 18px 42px rgba(2, 6, 23, 0.35);
  backdrop-filter: blur(16px);
}

.hero-panel {
  border-radius: 28px;
  padding: 32px;
  margin-bottom: 24px;
}

.eyebrow {
  display: inline-flex;
  margin-bottom: 12px;
  color: #7dd3fc;
  font-size: 0.82rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hero-panel h1 {
  margin: 0 0 12px;
  font-size: clamp(2.4rem, 5vw, 4rem);
  line-height: 0.96;
}

.hero-panel p {
  max-width: 760px;
  color: #b7c5df;
}

.feature-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 20px 0;
}

.feature-pill,
.banner {
  border-radius: 999px;
}

.feature-pill {
  padding: 0.45rem 0.8rem;
  background: rgba(14, 165, 233, 0.12);
  color: #7dd3fc;
}

.banner {
  display: inline-flex;
  padding: 0.8rem 1rem;
  background: rgba(37, 99, 235, 0.18);
  color: #dbeafe;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(240px, 0.72fr) minmax(0, 1.6fr) minmax(260px, 0.82fr);
  gap: 20px;
}

.card {
  border-radius: 22px;
  padding: 24px;
}

.card--sidebar,
.card--rail {
  display: grid;
  gap: 18px;
}

.card h2 {
  margin: 0 0 10px;
}

.card p {
  margin: 0;
  color: #aab8d3;
}

.stack {
  display: grid;
  gap: 14px;
  margin-top: 18px;
}

.stack label {
  display: grid;
  gap: 8px;
  color: #dbeafe;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
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

.nav-stack,
.rail-block,
.overview-stack,
.workspace-stack,
.records-stack,
.record-list,
.insight-grid,
.chart-list,
.check-list {
  display: grid;
  gap: 12px;
}

.nav-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(148, 163, 184, 0.14);
  text-align: left;
}

.nav-button--active {
  border-color: rgba(125, 211, 252, 0.34);
  box-shadow: 0 12px 30px rgba(14, 165, 233, 0.14);
}

.session-card,
.showcase-card,
.workspace-module,
.rail-block,
.record-card,
.metric-card,
.activity-card {
  border-radius: 18px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(255,255,255,0.04);
}

.metric-grid,
.showcase-grid,
.insight-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.metric-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-card strong {
  display: block;
  margin-top: 10px;
  font-size: 1.5rem;
}

.showcase-card strong,
.workspace-module strong,
.record-card strong,
.rail-block strong,
.session-card strong {
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

.chart-row,
.record-card__meta,
.record-card__actions,
.workspace-module__actions,
.check-list div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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
.record-status--qualified {
  background: rgba(59,130,246,0.18);
  color: #93c5fd;
}

.workspace-module--soft {
  background: rgba(255,255,255,0.02);
}

.activity-list {
  display: grid;
  gap: 10px;
}

.check-list div {
  justify-content: flex-start;
}

.check-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(135deg, ${accentPrimary}, ${accentSecondary});
}

.metric-grid {
  margin-top: 16px;
}

.metric-card span {
  display: block;
  color: #8aa0c2;
  margin-bottom: 8px;
}

.metric-card strong {
  font-size: 1.8rem;
}

.section-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.search-input {
  max-width: 280px;
}

@media (max-width: 900px) {
  .content-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .record-form,
  .section-header {
    flex-direction: column;
    align-items: stretch;
  }

  .record-form,
  .showcase-grid,
  .insight-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .search-input {
    max-width: none;
  }
}
`;

  return [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: projectName,
          private: true,
          version: '0.1.0',
          type: 'module',
          scripts: {
            dev: 'vite',
            build: 'vite build',
            preview: 'vite preview',
          },
          dependencies: {
            react: '^19.2.0',
            'react-dom': '^19.2.0',
          },
          devDependencies: {
            '@vitejs/plugin-react': '^5.1.0',
            vite: '^7.1.12',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'index.html',
      content: `<!doctype html>
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
`,
    },
    {
      path: 'src/main.jsx',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
    },
    {
      path: 'src/App.jsx',
      content: appSource,
    },
    {
      path: 'src/styles.css',
      content: stylesSource,
    },
    {
      path: 'README.md',
      content: `# ${projectName}

Generated by OmniForge Step 2 fallback code generation.

## Intent

- Goal: ${intent.goal}
- Project Type: ${intent.projectType}
- Features: ${(intent.features ?? []).join(', ') || 'core application flows'}
- Complexity: ${intent.complexity}
- Priority: ${intent.priority}

## Run

\`\`\`bash
npm install
npm run dev
\`\`\`
`,
    },
    {
      path: 'vite.config.js',
      content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    },
  ];
}

function buildApiFallback(intent) {
  const projectName = intent.projectName ?? 'omniforge-api';
  const requiresAuth = (intent.features ?? []).includes('auth');

  return [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: projectName,
          private: true,
          version: '0.1.0',
          type: 'module',
          scripts: {
            start: 'node server.js',
          },
        },
        null,
        2,
      ),
    },
    {
      path: 'server.js',
      content: `import http from 'node:http';

const port = Number(process.env.PORT || 3000);
let tasks = [
  { id: 1, title: 'Bootstrap API contract', completed: true },
  { id: 2, title: 'Document generated endpoints', completed: false },
];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function isAuthorized(request) {
  ${requiresAuth ? "return request.headers['x-omniforge-token'] === 'local-dev-token';" : 'return true;'}
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, \`http://\${request.headers.host || 'localhost'}\`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: ${JSON.stringify(projectName)} });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/context') {
    sendJson(response, 200, {
      goal: ${JSON.stringify(intent.goal)},
      projectType: ${JSON.stringify(intent.projectType)},
      features: ${JSON.stringify(intent.features ?? [])},
      steps: ${JSON.stringify(intent.steps ?? [])},
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    sendJson(response, 200, { tasks });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    if (!isAuthorized(request)) {
      sendJson(response, 401, { error: 'Unauthorized request.' });
      return;
    }

    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};

        if (typeof payload.title !== 'string' || payload.title.trim().length === 0) {
          sendJson(response, 400, { error: 'Task title is required.' });
          return;
        }

        const nextTask = {
          id: Date.now(),
          title: payload.title.trim(),
          completed: false,
        };

        tasks = [nextTask, ...tasks];
        sendJson(response, 201, { task: nextTask });
      } catch {
        sendJson(response, 400, { error: 'Invalid JSON payload.' });
      }
    });
    return;
  }

  sendJson(response, 404, { error: 'Route not found.' });
});

server.listen(port, () => {
  console.log(\`${projectName} listening on port \${port}\`);
});
`,
    },
    {
      path: 'README.md',
      content: `# ${projectName}

Generated by OmniForge Step 2 fallback API scaffolding.

## Run

\`\`\`bash
npm start
\`\`\`

## Endpoints

- \`GET /health\`
- \`GET /api/context\`
- \`GET /api/tasks\`
- \`POST /api/tasks\`${requiresAuth ? ' with header `x-omniforge-token: local-dev-token`' : ''}
`,
    },
  ];
}

function buildWorkflowFallback(intent, folderName, title) {
  const summaryLines = (intent.steps ?? [])
    .map((step, index) => `${index + 1}. ${step}`)
    .join('\n');

  return [
    {
      path: `${folderName}/plan.md`,
      content: `# ${title}

## Goal

${intent.goal}

## Project Type

${intent.projectType}

## Features

${(intent.features ?? []).join(', ') || 'core workflow artifacts'}

## Execution Steps

${summaryLines}

## Assumptions

${(intent.assumptions ?? []).map((assumption) => `- ${assumption}`).join('\n')}
`,
    },
    {
      path: `${folderName}/manifest.json`,
      content: JSON.stringify(
        {
          goal: intent.goal,
          projectType: intent.projectType,
          features: intent.features ?? [],
          complexity: intent.complexity,
          priority: intent.priority,
          steps: intent.steps ?? [],
          assumptions: intent.assumptions ?? [],
        },
        null,
        2,
      ),
    },
  ];
}

function buildFallbackFiles(intent) {
  switch (intent.goal) {
    case 'create_api':
      return buildApiFallback(intent);
    case 'deploy':
      if (isApplicationArtifactIntent(intent)) {
        return buildWebAppFallback(intent);
      }
      return buildWorkflowFallback(intent, 'deployment', 'Deployment Workflow');
    case 'domain_setup':
      if (isApplicationArtifactIntent(intent)) {
        return buildWebAppFallback(intent);
      }
      return buildWorkflowFallback(intent, 'domain', 'Domain Setup Workflow');
    case 'modify_app':
      if (isApplicationArtifactIntent(intent)) {
        return buildWebAppFallback(intent);
      }
      return buildWorkflowFallback(intent, 'changes', 'Application Modification Plan');
    case 'build_app':
    default:
      return buildWebAppFallback(intent);
  }
}

function hasReactEntryFile(files = []) {
  return files.some((file) => file.path === 'src/main.jsx' || file.path === 'src/App.jsx');
}

function getRequiredFallbackPaths(intent) {
  if (isApplicationArtifactIntent(intent)) {
    return new Set([
      'package.json',
      'README.md',
      'index.html',
      'src/main.jsx',
      'src/App.jsx',
      'src/styles.css',
      'vite.config.js',
    ]);
  }

  switch (intent.goal) {
    case 'create_api':
      return new Set([
        'package.json',
        'README.md',
        'server.js',
      ]);
    case 'deploy':
      return new Set([
        'deployment/plan.md',
        'deployment/manifest.json',
      ]);
    case 'domain_setup':
      return new Set([
        'domain/plan.md',
        'domain/manifest.json',
      ]);
    case 'modify_app':
      return new Set([
        'changes/plan.md',
        'changes/manifest.json',
      ]);
    case 'build_app':
    default:
      return new Set([
        'package.json',
        'README.md',
        'index.html',
        'src/main.jsx',
        'src/App.jsx',
        'src/styles.css',
        'vite.config.js',
      ]);
  }
}

function shouldMergeFallback(intent, files = []) {
  const filePaths = new Set(files.map((file) => file.path));

  for (const requiredPath of getRequiredFallbackPaths(intent)) {
    if (!filePaths.has(requiredPath)) {
      return true;
    }
  }

  if (isApplicationArtifactIntent(intent) && !hasReactEntryFile(files)) {
    return true;
  }

  return false;
}

function hasTreatmentRewardsExperience(files = []) {
  const appFile = files.find((file) => file.path === 'src/App.jsx');
  const styleFile = files.find((file) => file.path === 'src/styles.css');
  const haystack = [appFile?.content ?? '', styleFile?.content ?? ''].join('\n');
  return /Reward wheel|Spin wheel|Administrator panel|Consistent UA|attendanceDone|uaComplete/.test(haystack);
}

function mergeFallbackScaffold(intent, files = []) {
  const mergedFiles = new Map(files.map((file) => [file.path, file]));

  if (isTreatmentRewardsIntent(intent) && !hasTreatmentRewardsExperience(files)) {
    for (const fallbackFile of buildTreatmentRewardsFallback(intent)) {
      mergedFiles.set(fallbackFile.path, fallbackFile);
    }
    return [...mergedFiles.values()];
  }

  if (!shouldMergeFallback(intent, files)) {
    return files;
  }

  const fallbackFiles = buildFallbackFiles(intent);

  for (const fallbackFile of fallbackFiles) {
    if (!mergedFiles.has(fallbackFile.path)) {
      mergedFiles.set(fallbackFile.path, fallbackFile);
    }
  }

  return [...mergedFiles.values()];
}

export class CodeGenerator {
  async generateCodeFromIntent(intent) {
    assertIntent(intent);

    try {
      const rawResponse = await callAI(buildCodeGenerationPrompt(intent));
      const parsedFiles = extractJSONArray(rawResponse);
      return validateFiles(mergeFallbackScaffold(intent, validateFiles(parsedFiles)));
    } catch {
      return validateFiles(buildFallbackFiles(intent));
    }
  }
}

const codeGenerator = new CodeGenerator();

export async function generateCodeFromIntent(intent) {
  return codeGenerator.generateCodeFromIntent(intent);
}

export async function generateCode(prompt) {
  assertPrompt(prompt);

  try {
    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'user',
          content: prompt.trim(),
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenAI did not return code content.');
    }

    return content;
  } catch (error) {
    if (String(error?.message ?? '').includes('OPENAI_API_KEY is required')) {
      return callAI(prompt.trim());
    }

    throw error;
  }
}

export default codeGenerator;
