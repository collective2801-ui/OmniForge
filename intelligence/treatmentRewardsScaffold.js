export function isTreatmentRewardsBuild(buildOutput = {}) {
  const source = [
    buildOutput?.intent?.summary,
    buildOutput?.intent?.userInput,
    buildOutput?.prompt,
    buildOutput?.intent?.projectName,
    ...(buildOutput?.intent?.features ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /(reward|prize|spin|wheel)/.test(source) &&
    /(treatment|attendance|ua|screen|client|admin|administrator|substance)/.test(source);
}

export function createTreatmentRewardsAppScaffold(projectName, buildOutput = {}) {
  const summary = buildOutput?.intent?.summary ?? buildOutput?.prompt ?? 'Treatment rewards platform';
  const titleLiteral = JSON.stringify(projectName);
  const summaryLiteral = JSON.stringify(summary);
  const prizesLiteral = JSON.stringify([
    '$5 Gift Card',
    'Coffee Voucher',
    'Snack Pack',
    'Transit Pass',
    'Bonus Phone Minutes',
    'Wellness Journal',
  ], null, 2);
  const clientsLiteral = JSON.stringify([
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
  ], null, 2);

  return `import React, { useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from 'react-router-dom';

const PROJECT_NAME = ${titleLiteral};
const SUMMARY = ${summaryLiteral};
const STORAGE_KEY = 'omniforge-treatment-rewards-state';
const ADMIN_PASSCODE = 'recovery-admin';
const PRIZES = ${prizesLiteral};
const DEFAULT_CLIENTS = ${clientsLiteral};

function randomIndex(length) {
  if (globalThis.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buffer);
    return buffer[0] % length;
  }

  return Math.floor(Math.random() * length);
}

function loadProgramState() {
  if (typeof window === 'undefined') {
    return {
      clients: DEFAULT_CLIENTS,
      activeClientId: DEFAULT_CLIENTS[0]?.id ?? null,
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        clients: DEFAULT_CLIENTS,
        activeClientId: DEFAULT_CLIENTS[0]?.id ?? null,
      };
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.clients) || parsed.clients.length === 0) {
      return {
        clients: DEFAULT_CLIENTS,
        activeClientId: DEFAULT_CLIENTS[0]?.id ?? null,
      };
    }

    return {
      clients: parsed.clients,
      activeClientId: parsed.activeClientId ?? parsed.clients[0]?.id ?? null,
    };
  } catch {
    return {
      clients: DEFAULT_CLIENTS,
      activeClientId: DEFAULT_CLIENTS[0]?.id ?? null,
    };
  }
}

function isEligible(client) {
  return Boolean(client && client.attendanceDone && client.uaComplete && !client.hasSpun);
}

function StatusCard({ label, value }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function AppShell({ session, onSignOut, children }) {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <section className="hero">
          <span className="eyebrow">Treatment Rewards SaaS</span>
          <h1>{PROJECT_NAME}</h1>
          <p>{SUMMARY}</p>
          <div className="cta-row">
            <button type="button" onClick={onSignOut}>
              {session ? 'Sign Out' : 'Reset Session'}
            </button>
          </div>
        </section>

        <div className="layout">
          <aside className="nav-card">
            <h2>Navigation</h2>
            <div className="nav-links">
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/">Overview</NavLink>
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/dashboard">Dashboard</NavLink>
              <NavLink className={({ isActive }) => \`nav-link\${isActive ? ' active' : ''}\`} to="/login">
                {session ? 'Switch User' : 'Login'}
              </NavLink>
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
  return (
    <div className="stack">
      <h2>Program overview</h2>
      <p>
        This build includes a client reward wheel, a fully random prize draw, and administrator controls
        for attendance, consistent UA completion, and client roster management.
      </p>
      <div className="feature-grid">
        <article className="feature-card">
          <strong>Client role</strong>
          <p>Eligible clients can spin once and instantly see the prize they won.</p>
        </article>
        <article className="feature-card">
          <strong>Administrator role</strong>
          <p>Staff can add or remove clients and mark attendance and UA completion.</p>
        </article>
        <article className="feature-card">
          <strong>Eligibility logic</strong>
          <p>The wheel unlocks only after attendance and consistent UA are both complete.</p>
        </article>
      </div>
    </div>
  );
}

function LoginPage({ clients, onLogin }) {
  const [email, setEmail] = useState('operator@omniforge.local');
  const [role, setRole] = useState('client');
  const [clientId, setClientId] = useState(String(clients[0]?.id ?? ''));
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();

    if (role === 'admin' && passcode.trim().toLowerCase() !== ADMIN_PASSCODE) {
      setError('Use the administrator code recovery-admin.');
      return;
    }

    if (role === 'client' && !clientId) {
      setError('Select a client profile before continuing.');
      return;
    }

    setError('');
    onLogin({
      email: email.trim().toLowerCase() || 'operator@omniforge.local',
      role,
      clientId: role === 'client' ? Number(clientId) : null,
    });
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <h2>Login</h2>
      <p>Choose a client or administrator session to use the rewards platform.</p>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="operator@omniforge.local"
        />
      </label>
      <label>
        Role
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          style={{ width: '100%', padding: '0.9rem 1rem', borderRadius: '14px', background: 'rgba(8, 12, 20, 0.84)', color: 'white', border: '1px solid rgba(148, 163, 184, 0.18)' }}
        >
          <option value="client">Client</option>
          <option value="admin">Administrator</option>
        </select>
      </label>
      {role === 'client' ? (
        <label>
          Client
          <select
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            style={{ width: '100%', padding: '0.9rem 1rem', borderRadius: '14px', background: 'rgba(8, 12, 20, 0.84)', color: 'white', border: '1px solid rgba(148, 163, 184, 0.18)' }}
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.name}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Administrator code
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="recovery-admin"
          />
        </label>
      )}
      {error ? <p style={{ color: '#fda4af' }}>{error}</p> : null}
      <button type="submit">Enter Workspace</button>
    </form>
  );
}

function DashboardPage({ session, programState, setProgramState }) {
  const [flash, setFlash] = useState('Mark attendance and consistent UA to unlock the wheel.');
  const [newClientName, setNewClientName] = useState('');
  const [winningIndex, setWinningIndex] = useState(null);
  const [isSpinning, setIsSpinning] = useState(false);

  useEffect(() => {
    if (!session) {
      setFlash('Choose a client or administrator session to continue.');
      return;
    }

    if (session.role === 'admin') {
      setFlash('Administrator tools are unlocked. Update client eligibility from this dashboard.');
      return;
    }

    setFlash('Client session ready. Spin unlocks after attendance and consistent UA are both complete.');
  }, [session]);

  const activeClient = useMemo(() => {
    if (session?.role === 'client') {
      return programState.clients.find((client) => client.id === session.clientId) ?? null;
    }

    return programState.clients.find((client) => client.id === programState.activeClientId) ?? null;
  }, [programState, session]);

  const eligible = isEligible(activeClient);

  function updateClient(clientId, updater) {
    setProgramState((currentState) => ({
      ...currentState,
      clients: currentState.clients.map((client) => {
        if (client.id !== clientId) {
          return client;
        }

        return typeof updater === 'function' ? updater(client) : { ...client, ...updater };
      }),
    }));
  }

  function handleSpin() {
    if (!activeClient || session?.role !== 'client') {
      setFlash('Only a client session can spin the wheel.');
      return;
    }

    if (!eligible) {
      setFlash('Attendance and a consistent UA must both be complete before spinning.');
      return;
    }

    setIsSpinning(true);
    const nextWinningIndex = randomIndex(PRIZES.length);

    window.setTimeout(() => {
      const nextPrize = PRIZES[nextWinningIndex];
      setWinningIndex(nextWinningIndex);
      updateClient(activeClient.id, (client) => ({
        ...client,
        hasSpun: true,
        lastPrize: nextPrize,
        spinCount: (client.spinCount ?? 0) + 1,
      }));
      setFlash(activeClient.name + ' won ' + nextPrize + '.');
      setIsSpinning(false);
    }, 700);
  }

  function addClient(event) {
    event.preventDefault();
    const normalizedName = newClientName.trim();

    if (!normalizedName) {
      setFlash('Enter a client name before adding them.');
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

    setProgramState((currentState) => ({
      ...currentState,
      clients: [nextClient, ...currentState.clients],
      activeClientId: nextClient.id,
    }));
    setNewClientName('');
    setFlash(normalizedName + ' was added to the program.');
  }

  function removeClient(clientId) {
    setProgramState((currentState) => {
      const nextClients = currentState.clients.filter((client) => client.id !== clientId);

      return {
        clients: nextClients,
        activeClientId: nextClients[0]?.id ?? null,
      };
    });
    setFlash('Client removed from the roster.');
  }

  return (
    <div className="stack">
      <div className="feature-card">
        <strong>{session?.role === 'admin' ? 'Administrator view' : 'Client view'}</strong>
        <p>{flash}</p>
      </div>

      <div className="metric-grid">
        <StatusCard label="Selected Client" value={activeClient?.name ?? 'None'} />
        <StatusCard label="Attendance" value={activeClient?.attendanceDone ? 'Complete' : 'Pending'} />
        <StatusCard label="Consistent UA" value={activeClient?.uaComplete ? 'Complete' : 'Pending'} />
        <StatusCard label="Spin State" value={activeClient?.hasSpun ? 'Used' : 'Available'} />
      </div>

      <div className="feature-grid" style={{ alignItems: 'start' }}>
        <section className="feature-card">
          <strong>Reward Wheel</strong>
          <p>Random prize selection is performed only when the client is eligible.</p>
          <div style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
              {PRIZES.map((prize, index) => (
                <div
                  key={prize}
                  style={{
                    border: winningIndex === index ? '1px solid rgba(110, 231, 183, 0.9)' : '1px solid rgba(148, 163, 184, 0.16)',
                    borderRadius: '16px',
                    background: winningIndex === index ? 'rgba(16, 185, 129, 0.18)' : 'rgba(15, 23, 42, 0.82)',
                    minHeight: '88px',
                    display: 'grid',
                    placeItems: 'center',
                    padding: '0.85rem',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  {prize}
                </div>
              ))}
            </div>
            <button type="button" onClick={handleSpin} disabled={!eligible || session?.role !== 'client' || isSpinning}>
              {isSpinning ? 'Spinning...' : 'Spin Wheel'}
            </button>
            <p>{activeClient?.lastPrize ? 'Last prize: ' + activeClient.lastPrize : 'No prize awarded yet.'}</p>
          </div>
        </section>

        <section className="feature-card">
          <strong>Administrator Panel</strong>
          <p>Use this panel to manage who can spin and when.</p>
          {session?.role === 'admin' ? (
            <div className="stack" style={{ marginTop: '1rem' }}>
              <label>
                Active client
                <select
                  value={programState.activeClientId ?? ''}
                  onChange={(event) =>
                    setProgramState((currentState) => ({
                      ...currentState,
                      activeClientId: Number(event.target.value),
                    }))
                  }
                  style={{ width: '100%', padding: '0.9rem 1rem', borderRadius: '14px', background: 'rgba(8, 12, 20, 0.84)', color: 'white', border: '1px solid rgba(148, 163, 184, 0.18)' }}
                >
                  {programState.clients.map((client) => (
                    <option key={client.id} value={client.id}>{client.name}</option>
                  ))}
                </select>
              </label>

              <form className="stack" onSubmit={addClient}>
                <input
                  type="text"
                  value={newClientName}
                  onChange={(event) => setNewClientName(event.target.value)}
                  placeholder="Add a new client"
                />
                <button type="submit">Add Client</button>
              </form>

              <div className="stack">
                {programState.clients.map((client) => (
                  <article key={client.id} className="feature-card">
                    <strong>{client.name}</strong>
                    <p>{client.lastPrize ? 'Last prize: ' + client.lastPrize : 'No prize awarded yet.'}</p>
                    <div className="cta-row">
                      <button type="button" onClick={() => updateClient(client.id, (entry) => ({ ...entry, attendanceDone: !entry.attendanceDone }))}>
                        {client.attendanceDone ? 'Undo Attendance' : 'Mark Attendance'}
                      </button>
                      <button type="button" onClick={() => updateClient(client.id, (entry) => ({ ...entry, uaComplete: !entry.uaComplete }))}>
                        {client.uaComplete ? 'Undo UA' : 'Mark UA'}
                      </button>
                      <button type="button" onClick={() => updateClient(client.id, { attendanceDone: true, uaComplete: true, hasSpun: false })}>
                        Mark Eligible
                      </button>
                      <button type="button" onClick={() => updateClient(client.id, { hasSpun: false, lastPrize: null })}>
                        Reset Spin
                      </button>
                      <button type="button" onClick={() => removeClient(client.id)}>
                        Remove Client
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="stack" style={{ marginTop: '1rem' }}>
              <p>Administrator controls are hidden in client view.</p>
              <p>Ask a staff member to mark attendance and consistent UA before spinning.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function App() {
  const [programState, setProgramState] = useState(() => loadProgramState());
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(programState));
  }, [programState]);

  return (
    <BrowserRouter>
      <AppShell session={session} onSignOut={() => setSession(null)}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route
            path="/dashboard"
            element={
              session ? (
                <DashboardPage
                  session={session}
                  programState={programState}
                  setProgramState={setProgramState}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/login"
            element={
              <LoginPage
                clients={programState.clients}
                onLogin={(nextSession) => setSession(nextSession)}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
`;
}
