export const landingPageEntry = '../apps/web/src/pages/Dashboard.jsx';
export const appSelectionEntry = '../apps/web/src/pages/Builder.jsx';
export const loginEntry = '../apps/web/src/pages/Login.jsx';
export const workspaceEntry = '../apps/web/src/pages/ProjectWorkspace.jsx';

export function createFrontendManifest({
  productName = 'OmniForge',
} = {}) {
  return {
    productName,
    entries: {
      landing: landingPageEntry,
      appSelection: appSelectionEntry,
      login: loginEntry,
      workspace: workspaceEntry,
    },
  };
}

export default {
  landingPageEntry,
  appSelectionEntry,
  loginEntry,
  workspaceEntry,
  createFrontendManifest,
};
