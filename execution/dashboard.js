import {
  app,
  createControlCenter,
  interfaceEntry,
  simulateThinking,
  startDashboardServer,
} from '../dashboard/index.js';

export {
  app,
  createControlCenter,
  interfaceEntry,
  simulateThinking,
  startDashboardServer,
};

export function Dashboard() {
  return `
  <div>
    <h1>Dashboard</h1>
    <button onclick="loadData()">Load Data</button>
    <div id="data"></div>

    <script>
      async function loadData() {
        const res = await fetch('/api/data');
        const data = await res.json();
        document.getElementById('data').innerText = JSON.stringify(data);
      }
    </script>
  </div>
  `;
}

export async function startDashboard(port = 4000) {
  return startDashboardServer(port);
}

export default {
  app,
  Dashboard,
  startDashboard,
  startDashboardServer,
  interfaceEntry,
  createControlCenter,
  simulateThinking,
};
