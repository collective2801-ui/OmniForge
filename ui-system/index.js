import { createControlCenter } from '../ui/controlCenter.js';
import { generateBuildOptions } from '../ui/buildOptionsEngine.js';
import { analyzeInput } from '../ui/inputAnalyzer.js';
import { simulateThinking } from '../ui/thinkingVisualizer.js';
import { startVoiceInput } from '../ui/voiceController.js';
import { container, theme } from './theme.js';
import { Button, Card } from './components.js';

export const interfaceEntry = '../ui/omniforgeInterface.jsx';

export {
  createControlCenter,
  analyzeInput,
  generateBuildOptions,
  simulateThinking,
  startVoiceInput,
  theme,
  container,
  Button,
  Card,
};

export default {
  interfaceEntry,
  createControlCenter,
  analyzeInput,
  generateBuildOptions,
  simulateThinking,
  startVoiceInput,
  theme,
  container,
  Button,
  Card,
};
