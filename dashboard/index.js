import { createControlCenter } from '../ui/controlCenter.js';
import { simulateThinking } from '../ui/thinkingVisualizer.js';
import { app, startDashboardServer } from './server.js';

const interfaceEntry = '../ui/omniforgeInterface.jsx';

export {
  app,
  startDashboardServer,
  createControlCenter,
  simulateThinking,
  interfaceEntry,
};

export default {
  app,
  startDashboardServer,
  interfaceEntry,
  createControlCenter,
  simulateThinking,
};
