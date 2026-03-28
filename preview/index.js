import { generateUI } from './generateUI.js';
import { startPreview } from './server.js';

export const builderPreviewEntry = '../apps/web/src/pages/Builder.jsx';
export const workspacePreviewEntry = '../apps/web/src/pages/ProjectWorkspace.jsx';

export function createPreviewManifest({
  projectName = 'omniforge-project',
  previewUrl = '',
  workspace = 'builder',
} = {}) {
  return {
    projectName,
    previewUrl,
    workspace,
    entries: {
      builder: builderPreviewEntry,
      workspace: workspacePreviewEntry,
    },
  };
}

export default {
  builderPreviewEntry,
  workspacePreviewEntry,
  createPreviewManifest,
  generateUI,
  startPreview,
};

export {
  generateUI,
  startPreview,
};
