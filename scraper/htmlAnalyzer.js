import { load } from 'cheerio';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function analyzeHTML(html) {
  const source = String(html || '');
  const $ = load(source);

  const structure = {
    pages: $('a').length,
    forms: $('form').length,
    inputs: $('input').length,
    buttons: $('button').length,
  };
  const features = [];

  if ($('input[type=password]').length > 0) {
    features.push('auth');
  }

  if (source.toLowerCase().includes('stripe')) {
    features.push('payments');
  }

  if ($('img').length > 20) {
    features.push('media-heavy');
  }

  if ($('form').length > 0) {
    features.push('form-processing');
  }

  return {
    structure,
    features: unique(features),
  };
}

export default {
  analyzeHTML,
};
