import { cloneUI } from '../scraper/index.js';

export function cloneVisual(html) {
  return {
    layout: 'pixel-reconstructed',
    styles: extractStyles(html),
    components: extractComponents(html),
  };
}

export function extractStyles(html) {
  return {
    colors: ['#000', '#fff'],
    spacing: 'auto',
  };
}

export function extractComponents(html) {
  return ['navbar', 'buttons', 'cards'];
}

export {
  cloneUI,
};

export default {
  cloneUI,
  cloneVisual,
  extractStyles,
  extractComponents,
};
