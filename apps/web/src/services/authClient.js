import { apiRequest } from './apiClient.js';

function normalizeFailure(message, code = 'request_failed') {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

async function request(path, { method = 'GET', body } = {}) {
  try {
    return await apiRequest(path, {
      method,
      body,
    });
  } catch (error) {
    return normalizeFailure(
      error?.message ?? 'Network request failed.',
      'network_error',
    );
  }
}

export async function signUp(email, password) {
  return request('/api/auth/signup', {
    method: 'POST',
    body: { email, password },
  });
}

export async function signIn(email, password) {
  return request('/api/auth/signin', {
    method: 'POST',
    body: { email, password },
  });
}

export async function signOut() {
  return request('/api/auth/signout', {
    method: 'POST',
  });
}

export async function getCurrentUser() {
  return request('/api/auth/me');
}

export async function getUserProjects() {
  const result = await request('/api/projects');

  if (!result.ok) {
    return {
      ...result,
      projects: [],
    };
  }

  return {
    ok: true,
    projects: result.projects ?? [],
    error: null,
  };
}

export async function createProject(projectData) {
  return request('/api/projects', {
    method: 'POST',
    body: projectData,
  });
}

export async function updateProject(projectId, updates) {
  return request(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: updates,
  });
}

export async function getProjectWorkspace(projectId) {
  const result = await request(`/api/projects/${encodeURIComponent(projectId)}/workspace`);

  if (!result.ok) {
    return {
      ...result,
      workspace: null,
    };
  }

  return {
    ok: true,
    workspace: result.workspace ?? null,
    error: null,
  };
}

export default {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  getUserProjects,
  createProject,
  updateProject,
  getProjectWorkspace,
};
