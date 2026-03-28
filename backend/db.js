import { randomUUID } from 'node:crypto';
import { isSuperAdmin } from './accessControl.js';
import {
  createServiceRoleSupabaseClient,
  createScopedSupabaseClient,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
  supabase,
} from './supabaseClient.js';

function createErrorResponse(code, message) {
  return {
    ok: false,
    project: null,
    projects: [],
    error: {
      code,
      message,
    },
  };
}

function createProjectResponse(project) {
  return {
    ok: true,
    project,
    projects: [],
    error: null,
  };
}

function createProjectsResponse(projects) {
  return {
    ok: true,
    project: null,
    projects,
    error: null,
  };
}

function getDatabaseClient(accessToken = '', options = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  if (isSupabaseAdminConfigured) {
    return createServiceRoleSupabaseClient();
  }

  if (typeof accessToken === 'string' && accessToken.trim().length > 0) {
    return createScopedSupabaseClient(accessToken.trim());
  }

  return supabase;
}

function normalizeProject(project) {
  if (!project) {
    return null;
  }

  return {
    id: project.id,
    userId: project.user_id,
    name: project.name,
    path: project.path,
    status: project.status,
    liveUrl: project.live_url,
    deploymentProvider: project.deployment_provider,
    repositoryUrl: project.repository_url,
    customDomain: project.custom_domain,
    metadata: project.metadata ?? {},
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };
}

function validateProjectName(name) {
  return typeof name === 'string' && name.trim().length > 0;
}

export async function createProject(
  userId,
  projectData = {},
  accessToken = '',
  options = {},
) {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return createErrorResponse('invalid_user', 'User id is required.');
  }

  if (!validateProjectName(projectData.name)) {
    return createErrorResponse('invalid_project', 'Project name is required.');
  }

  if (
    options.actorUser &&
    !isSuperAdmin(options.actorUser) &&
    options.actorUser.id !== userId.trim()
  ) {
    return createErrorResponse(
      'forbidden_project',
      'You can only create projects for your own account.',
    );
  }

  const databaseClient = getDatabaseClient(accessToken, options);

  if (!databaseClient) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  const timestamp = new Date().toISOString();
  const providedProjectId =
    typeof projectData.id === 'string' && projectData.id.trim().length > 0
      ? projectData.id.trim()
      : null;
  const record = {
    id: providedProjectId ?? randomUUID(),
    user_id: userId.trim(),
    name: projectData.name.trim(),
    path: typeof projectData.path === 'string' ? projectData.path.trim() : '',
    status:
      typeof projectData.status === 'string' && projectData.status.trim().length > 0
        ? projectData.status.trim()
        : 'draft',
    live_url: typeof projectData.liveUrl === 'string' ? projectData.liveUrl.trim() : '',
    deployment_provider:
      typeof projectData.deploymentProvider === 'string'
        ? projectData.deploymentProvider.trim()
        : '',
    repository_url:
      typeof projectData.repositoryUrl === 'string' ? projectData.repositoryUrl.trim() : '',
    custom_domain:
      typeof projectData.customDomain === 'string' ? projectData.customDomain.trim() : '',
    metadata:
      projectData.metadata && typeof projectData.metadata === 'object' && !Array.isArray(projectData.metadata)
        ? projectData.metadata
        : {},
    created_at: timestamp,
    updated_at: timestamp,
  };

  try {
    const { data, error } = await databaseClient
      .from('projects')
      .insert(record)
      .select()
      .single();

    if (error) {
      return createErrorResponse('create_project_failed', error.message);
    }

    return createProjectResponse(normalizeProject(data));
  } catch (error) {
    return createErrorResponse(
      'create_project_failed',
      error?.message ?? 'Unexpected project creation failure.',
    );
  }
}

export async function getUserProjects(userId, accessToken = '', options = {}) {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return createErrorResponse('invalid_user', 'User id is required.');
  }

  const databaseClient = getDatabaseClient(accessToken, options);

  if (!databaseClient) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  try {
    let query = databaseClient
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!isSuperAdmin(options.actorUser)) {
      query = query.eq('user_id', userId.trim());
    }

    const { data, error } = await query;

    if (error) {
      return createErrorResponse('get_projects_failed', error.message);
    }

    return createProjectsResponse((data ?? []).map(normalizeProject));
  } catch (error) {
    return createErrorResponse(
      'get_projects_failed',
      error?.message ?? 'Unexpected project lookup failure.',
    );
  }
}

export async function updateProject(
  projectId,
  updates = {},
  accessToken = '',
  options = {},
) {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  if (typeof projectId !== 'string' || projectId.trim().length === 0) {
    return createErrorResponse('invalid_project', 'Project id is required.');
  }

  const databaseClient = getDatabaseClient(accessToken, options);

  if (!databaseClient) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  const payload = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.name === 'string' && updates.name.trim().length > 0) {
    payload.name = updates.name.trim();
  }

  if (typeof updates.path === 'string') {
    payload.path = updates.path.trim();
  }

  if (typeof updates.status === 'string' && updates.status.trim().length > 0) {
    payload.status = updates.status.trim();
  }

  if (typeof updates.liveUrl === 'string') {
    payload.live_url = updates.liveUrl.trim();
  }

  if (typeof updates.deploymentProvider === 'string') {
    payload.deployment_provider = updates.deploymentProvider.trim();
  }

  if (typeof updates.repositoryUrl === 'string') {
    payload.repository_url = updates.repositoryUrl.trim();
  }

  if (typeof updates.customDomain === 'string') {
    payload.custom_domain = updates.customDomain.trim();
  }

  if (updates.metadata && typeof updates.metadata === 'object' && !Array.isArray(updates.metadata)) {
    payload.metadata = updates.metadata;
  }

  try {
    let query = databaseClient
      .from('projects')
      .update(payload)
      .eq('id', projectId.trim());

    if (!isSuperAdmin(options.actorUser)) {
      if (
        typeof options.actorUser?.id !== 'string' ||
        options.actorUser.id.trim().length === 0
      ) {
        return createErrorResponse(
          'forbidden_project',
          'Authenticated ownership is required to update this project.',
        );
      }

      query = query.eq('user_id', options.actorUser.id.trim());
    }

    const { data, error } = await query
      .select()
      .single();

    if (error) {
      return createErrorResponse('update_project_failed', error.message);
    }

    return createProjectResponse(normalizeProject(data));
  } catch (error) {
    return createErrorResponse(
      'update_project_failed',
      error?.message ?? 'Unexpected project update failure.',
    );
  }
}

export default {
  createProject,
  getUserProjects,
  updateProject,
};
