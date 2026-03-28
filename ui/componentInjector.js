import path from 'node:path';
import { writeFileSafe } from '../engine/fileSystem.js';

const COMPONENT_TEMPLATES = Object.freeze({
  auth: {
    component: 'auth',
    files: [
      {
        path: 'src/injected/auth/AuthModule.jsx',
        content: `const frameStyle = {
  display: 'grid',
  gap: '0.75rem',
  padding: '1.25rem',
  borderRadius: '18px',
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  color: '#e2e8f0',
};

const fieldStyle = {
  display: 'grid',
  gap: '0.35rem',
};

const inputStyle = {
  padding: '0.85rem 1rem',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(15, 23, 42, 0.82)',
  color: '#f8fafc',
};

const buttonStyle = {
  padding: '0.9rem 1rem',
  borderRadius: '12px',
  border: 'none',
  background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
  color: '#f8fafc',
  fontWeight: 700,
  cursor: 'pointer',
};

export default function AuthModule({
  title = 'Sign In',
  subtitle = 'Authenticate to continue into the workspace.',
} = {}) {
  return (
    <section style={frameStyle}>
      <div>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={{ margin: '0.35rem 0 0', color: '#94a3b8' }}>{subtitle}</p>
      </div>
      <label style={fieldStyle}>
        <span>Email</span>
        <input style={inputStyle} type="email" placeholder="operator@example.com" />
      </label>
      <label style={fieldStyle}>
        <span>Password</span>
        <input style={inputStyle} type="password" placeholder="Enter a secure password" />
      </label>
      <button style={buttonStyle} type="button">
        Continue
      </button>
    </section>
  );
}
`,
      },
    ],
  },
  dashboard: {
    component: 'dashboard',
    files: [
      {
        path: 'src/injected/dashboard/DashboardLayout.jsx',
        content: `const gridStyle = {
  display: 'grid',
  gap: '1rem',
};

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '1rem',
};

const cardStyle = {
  padding: '1rem',
  borderRadius: '18px',
  background: 'rgba(15, 23, 42, 0.9)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  color: '#e2e8f0',
};

export default function DashboardLayout({
  title = 'Operations Overview',
  cards = [
    { label: 'MRR', value: '$24,200' },
    { label: 'New Users', value: '148' },
    { label: 'Churn', value: '1.8%' },
  ],
  children = null,
} = {}) {
  return (
    <section style={gridStyle}>
      <header>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <p style={{ margin: '0.35rem 0 0', color: '#94a3b8' }}>
          A lightweight dashboard shell for injected product surfaces.
        </p>
      </header>
      <div style={summaryGridStyle}>
        {cards.map((card) => (
          <article key={card.label} style={cardStyle}>
            <span style={{ color: '#94a3b8' }}>{card.label}</span>
            <strong style={{ display: 'block', marginTop: '0.45rem', fontSize: '1.5rem' }}>
              {card.value}
            </strong>
          </article>
        ))}
      </div>
      {children}
    </section>
  );
}
`,
      },
    ],
  },
  navbar: {
    component: 'navbar',
    files: [
      {
        path: 'src/injected/navigation/Navbar.jsx',
        content: `const navStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  padding: '0.95rem 1.15rem',
  borderRadius: '18px',
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  color: '#f8fafc',
};

const linkRowStyle = {
  display: 'flex',
  gap: '0.9rem',
  flexWrap: 'wrap',
};

export default function Navbar({
  brand = 'OmniForge',
  links = ['Overview', 'Billing', 'Customers', 'Settings'],
} = {}) {
  return (
    <nav style={navStyle}>
      <strong>{brand}</strong>
      <div style={linkRowStyle}>
        {links.map((link) => (
          <span key={link} style={{ color: '#cbd5e1' }}>
            {link}
          </span>
        ))}
      </div>
    </nav>
  );
}
`,
      },
    ],
  },
  form: {
    component: 'form',
    files: [
      {
        path: 'src/injected/forms/FormTemplate.jsx',
        content: `const formStyle = {
  display: 'grid',
  gap: '0.85rem',
  padding: '1.25rem',
  borderRadius: '18px',
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
};

const fieldStyle = {
  display: 'grid',
  gap: '0.35rem',
  color: '#cbd5e1',
};

const inputStyle = {
  padding: '0.85rem 1rem',
  borderRadius: '12px',
  border: '1px solid rgba(148, 163, 184, 0.22)',
  background: 'rgba(2, 6, 23, 0.88)',
  color: '#f8fafc',
};

export default function FormTemplate({
  fields = [
    { label: 'Company Name', type: 'text', placeholder: 'Acme Inc.' },
    { label: 'Team Size', type: 'number', placeholder: '12' },
  ],
} = {}) {
  return (
    <form style={formStyle}>
      <h2 style={{ margin: 0, color: '#f8fafc' }}>Configured Form Template</h2>
      {fields.map((field) => (
        <label key={field.label} style={fieldStyle}>
          <span>{field.label}</span>
          <input
            style={inputStyle}
            type={field.type}
            placeholder={field.placeholder}
          />
        </label>
      ))}
    </form>
  );
}
`,
      },
    ],
  },
  'reward-wheel': {
    component: 'reward-wheel',
    files: [
      {
        path: 'src/injected/rewards/RewardWheel.jsx',
        content: `const wheelStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.85rem',
  padding: '1.25rem',
  borderRadius: '22px',
  background: 'radial-gradient(circle at top, rgba(99, 102, 241, 0.18), rgba(15, 23, 42, 0.9))',
  border: '1px solid rgba(148, 163, 184, 0.18)',
};

const segmentStyle = {
  minHeight: '84px',
  borderRadius: '16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '0.9rem',
  background: 'rgba(255, 255, 255, 0.05)',
  color: '#f8fafc',
  fontWeight: 700,
};

export default function RewardWheel({
  prizes = ['Gift Card', 'Coffee Voucher', 'Snack Pack', 'Transit Pass'],
} = {}) {
  return (
    <section>
      <h2 style={{ marginTop: 0, color: '#f8fafc' }}>Reward Wheel</h2>
      <div style={wheelStyle}>
        {prizes.map((prize) => (
          <div key={prize} style={segmentStyle}>
            {prize}
          </div>
        ))}
      </div>
    </section>
  );
}
`,
      },
    ],
  },
  'client-admin-panel': {
    component: 'client-admin-panel',
    files: [
      {
        path: 'src/injected/rewards/ClientAdminPanel.jsx',
        content: `const panelStyle = {
  display: 'grid',
  gap: '0.9rem',
  padding: '1.25rem',
  borderRadius: '18px',
  background: 'rgba(15, 23, 42, 0.92)',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  color: '#e2e8f0',
};

const itemStyle = {
  padding: '0.95rem',
  borderRadius: '14px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(148, 163, 184, 0.12)',
};

export default function ClientAdminPanel({
  clients = [
    { name: 'Jordan M.', attendance: true, ua: true },
    { name: 'Taylor R.', attendance: true, ua: false },
  ],
} = {}) {
  return (
    <section style={panelStyle}>
      <h2 style={{ margin: 0, color: '#f8fafc' }}>Client Admin Panel</h2>
      {clients.map((client) => (
        <article key={client.name} style={itemStyle}>
          <strong>{client.name}</strong>
          <p style={{ margin: '0.35rem 0 0', color: '#94a3b8' }}>
            Attendance: {client.attendance ? 'Complete' : 'Pending'} · UA: {client.ua ? 'Complete' : 'Pending'}
          </p>
        </article>
      ))}
    </section>
  );
}
`,
      },
    ],
  }

});

const COMPONENT_ALIASES = Object.freeze({
  auth: 'auth',
  'auth-module': 'auth',
  dashboard: 'dashboard',
  'dashboard-layout': 'dashboard',
  'reward-wheel': 'reward-wheel',
  wheel: 'reward-wheel',
  rewards: 'reward-wheel',
  'client-admin-panel': 'client-admin-panel',
  'admin-panel': 'client-admin-panel',
  navbar: 'navbar',
  navigation: 'navbar',
  form: 'form',
  forms: 'form',
  'form-template': 'form',
});

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for component injection.');
  }
}

function resolveComponentName(componentName) {
  if (typeof componentName !== 'string' || componentName.trim().length === 0) {
    throw new TypeError('Component name is required.');
  }

  const normalizedName = componentName.trim().toLowerCase();
  const resolvedName = COMPONENT_ALIASES[normalizedName];

  if (!resolvedName || !COMPONENT_TEMPLATES[resolvedName]) {
    throw new Error(`Unsupported injected component: ${componentName}`);
  }

  return resolvedName;
}

export async function injectComponent(projectPath, componentName) {
  assertProjectPath(projectPath);

  const resolvedComponentName = resolveComponentName(componentName);
  const template = COMPONENT_TEMPLATES[resolvedComponentName];
  const writtenFiles = [];

  for (const file of template.files) {
    const absolutePath = path.join(projectPath, file.path);
    await writeFileSafe(absolutePath, file.content);
    writtenFiles.push({
      path: file.path,
      absolutePath,
    });
  }

  return {
    component: template.component,
    injectedAt: new Date().toISOString(),
    files: writtenFiles,
  };
}

export default {
  injectComponent,
};
