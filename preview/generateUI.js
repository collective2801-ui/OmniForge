import { Card, Button } from '../ui-system/components.js';
import { container } from '../ui-system/designSystem.js';

export function generateUI(spec = {}) {
  const features = Array.isArray(spec.features)
    ? spec.features.map((feature) => `<li>${feature}</li>`).join('')
    : '';

  return container(`
    <h1>${spec.name ?? 'OmniForge App'}</h1>

    ${Card(`
      <h2>Features</h2>
      <ul>${features}</ul>
    `)}

    ${Button('Start')}
  `);
}

export default {
  generateUI,
};
