import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import authClient from '../services/authClient.js';

const cardStyle = {
  width: 'min(460px, 100%)',
  margin: '72px auto 0',
};

const formStyle = {
  display: 'grid',
  gap: '16px',
  padding: '24px',
};

const labelStyle = {
  display: 'grid',
  gap: '8px',
  color: '#dbeafe',
  fontSize: '0.96rem',
};

const inputStyle = {
  width: '100%',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '18px',
  padding: '0.95rem 1rem',
  background: 'rgba(9, 12, 18, 0.82)',
  color: '#f8fafc',
};

const actionRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px',
};

const secondaryButtonStyle = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: '18px',
  padding: '0.95rem 1rem',
  background: 'rgba(9, 12, 18, 0.82)',
  color: '#dbeafe',
};

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    await handleAuth('signin');
  }

  async function handleAuth(action) {
    const normalizedEmail = email.trim().toLowerCase();

    setBusyAction(action);
    setError('');
    setMessage('');

    if (!normalizedEmail) {
      setBusyAction('');
      setError('Email is required.');
      return;
    }

    const result =
      action === 'signup'
        ? await authClient.signUp(normalizedEmail, password)
        : await authClient.signIn(normalizedEmail, password);

    setBusyAction('');

    if (!result.ok) {
      setError(result.error?.message ?? 'Authentication failed.');
      return;
    }

    if (action === 'signup' && result.requiresEmailConfirmation) {
      setMessage(
        'Account created. Confirm the email if your Supabase project requires email verification, then sign in.',
      );
      return;
    }

    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="builder-shell">
      <div className="builder-backdrop" />
      <div className="builder-glow builder-glow--blue" />
      <div className="builder-glow builder-glow--purple" />
      <main className="builder-frame">
        <section className="panel" style={cardStyle}>
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Account Access</p>
              <h1 className="panel-title">Login to OmniForge</h1>
            </div>
            <span className={`panel-badge ${busyAction ? 'panel-badge--running' : ''}`}>
              {busyAction ? 'Authorizing' : 'Secure'}
            </span>
          </div>

          <div style={{ padding: '0 24px' }}>
            <p style={{ margin: 0, color: '#9fb0d3' }}>
              Use your Supabase-backed account to access your project dashboard and build into owned projects.
            </p>
          </div>

          <form style={formStyle} onSubmit={handleSubmit}>
            <label style={labelStyle}>
              Email
              <input
                style={inputStyle}
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </label>

            <label style={labelStyle}>
              Password
              <input
                style={inputStyle}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete="current-password"
              />
            </label>

            {error ? (
              <div className="error-banner" role="alert">
                <strong>Authentication Error</strong>
                <span>{error}</span>
              </div>
            ) : null}

            {message ? (
              <div
                style={{
                  border: '1px solid rgba(96, 165, 250, 0.24)',
                  borderRadius: '22px',
                  padding: '14px 16px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  color: '#dbeafe',
                }}
              >
                {message}
              </div>
            ) : null}

            <div style={actionRowStyle}>
              <button
                className="prompt-submit"
                type="submit"
                disabled={Boolean(busyAction)}
              >
                {busyAction === 'signin' ? 'Signing In…' : 'Login'}
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                style={secondaryButtonStyle}
                onClick={() => handleAuth('signup')}
              >
                {busyAction === 'signup' ? 'Creating…' : 'Sign Up'}
              </button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
