import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import authClient from './services/authClient.js';
import Builder from './pages/Builder.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Login from './pages/Login.jsx';
import ProjectWorkspace from './pages/ProjectWorkspace.jsx';

function LoadingScreen({ title, message }) {
  return (
    <div className="builder-shell">
      <div className="builder-backdrop" />
      <main className="builder-frame">
        <section className="panel" style={{ width: 'min(520px, 100%)', margin: '72px auto 0' }}>
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Authentication</p>
              <h1 className="panel-title">{title}</h1>
            </div>
            <span className="panel-badge panel-badge--running">Loading</span>
          </div>
          <div style={{ padding: '0 24px 24px', color: '#9fb0d3' }}>{message}</div>
        </section>
      </main>
    </div>
  );
}

function useAuthStatus() {
  const [state, setState] = useState({
    loading: true,
    user: null,
  });

  useEffect(() => {
    let active = true;

    authClient.getCurrentUser().then((result) => {
      if (!active) {
        return;
      }

      setState({
        loading: false,
        user: result.ok ? result.user : null,
      });
    });

    return () => {
      active = false;
    };
  }, []);

  return state;
}

function RequireAuth({ children }) {
  const { loading, user } = useAuthStatus();

  if (loading) {
    return (
      <LoadingScreen
        title="Checking session"
        message="Verifying the current authenticated OmniForge account."
      />
    );
  }

  if (!user) {
    return <Navigate replace to="/login" />;
  }

  return children;
}

function PublicOnly({ children }) {
  const { loading, user } = useAuthStatus();

  if (loading) {
    return (
      <LoadingScreen
        title="Loading access"
        message="Checking whether an authenticated OmniForge session already exists."
      />
    );
  }

  if (user) {
    return <Navigate replace to="/dashboard" />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate replace to="/dashboard" />} />
      <Route
        path="/login"
        element={(
          <PublicOnly>
            <Login />
          </PublicOnly>
        )}
      />
      <Route
        path="/dashboard"
        element={(
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        )}
      />
      <Route
        path="/builder"
        element={(
          <RequireAuth>
            <Builder />
          </RequireAuth>
        )}
      />
      <Route
        path="/projects/:projectId"
        element={(
          <RequireAuth>
            <ProjectWorkspace />
          </RequireAuth>
        )}
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
