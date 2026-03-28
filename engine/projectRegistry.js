import path from 'node:path';
import { randomUUID } from 'node:crypto';
import platformConfig from '../config/platform.config.js';
import { readJsonSafe, writeJsonSafe } from './fileSystem.js';

const REGISTRY_VERSION = 1;
const DEFAULT_REGISTRY = {
  version: REGISTRY_VERSION,
  projects: [],
};

function assertProjectPayload(project) {
  if (!project || typeof project !== 'object') {
    throw new TypeError('Project registration payload must be an object.');
  }
}

function normalizeProjectRecord(project) {
  assertProjectPayload(project);

  const projectName = project.projectName ?? project.name;
  const projectPath = project.projectPath ?? project.path;
  const projectType = project.projectType ?? project.type ?? 'application';

  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    throw new TypeError('Project name is required.');
  }

  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required.');
  }

  if (typeof projectType !== 'string' || projectType.trim().length === 0) {
    throw new TypeError('Project type is required.');
  }

  const timestamp = new Date().toISOString();

  return {
    projectId: project.projectId ?? randomUUID(),
    projectName: projectName.trim(),
    projectPath: path.resolve(projectPath),
    projectType: projectType.trim(),
    userId:
      typeof project.userId === 'string' && project.userId.trim().length > 0
        ? project.userId.trim()
        : null,
    deploymentKey:
      typeof project.deploymentKey === 'string' && project.deploymentKey.trim().length > 0
        ? project.deploymentKey.trim()
        : '',
    createdAt: project.createdAt ?? timestamp,
    updatedAt: timestamp,
    status: typeof project.status === 'string' && project.status.trim().length > 0
      ? project.status.trim()
      : 'initialized',
  };
}

function normalizeRegistryShape(registry) {
  if (!registry || typeof registry !== 'object') {
    return {
      value: { ...DEFAULT_REGISTRY },
      changed: true,
    };
  }

  const version =
    typeof registry.version === 'number' ? registry.version : REGISTRY_VERSION;
  const projects = Array.isArray(registry.projects) ? registry.projects : [];
  const changed = version !== registry.version || projects !== registry.projects;

  return {
    value: {
      version,
      projects,
    },
    changed,
  };
}

export class ProjectRegistry {
  constructor(registryFilePath = platformConfig.registryFileLocation) {
    this.registryFilePath = registryFilePath;
  }

  async initialize() {
    const existingRegistry = await readJsonSafe(this.registryFilePath, {
      defaultValue: null,
    });

    if (!existingRegistry) {
      await writeJsonSafe(this.registryFilePath, DEFAULT_REGISTRY);
      return { ...DEFAULT_REGISTRY };
    }

    const normalizedRegistry = normalizeRegistryShape(existingRegistry);

    if (normalizedRegistry.changed) {
      await writeJsonSafe(this.registryFilePath, normalizedRegistry.value);
    }

    return normalizedRegistry.value;
  }

  async listProjects() {
    const registry = await this.initialize();
    return [...registry.projects];
  }

  async getProjectById(projectId) {
    if (typeof projectId !== 'string' || projectId.trim().length === 0) {
      throw new TypeError('Project id is required.');
    }

    const registry = await this.initialize();
    return (
      registry.projects.find((project) => project.projectId === projectId.trim()) ??
      null
    );
  }

  async registerProject(project) {
    const registry = await this.initialize();
    const nextProject = normalizeProjectRecord(project);

    registry.projects = registry.projects.filter(
      (existingProject) => existingProject.projectId !== nextProject.projectId,
    );
    registry.projects.push(nextProject);

    await writeJsonSafe(this.registryFilePath, registry);

    return nextProject;
  }

  async updateProject(projectId, updates = {}) {
    if (typeof projectId !== 'string' || projectId.trim().length === 0) {
      throw new TypeError('Project id is required.');
    }

    if (!updates || typeof updates !== 'object') {
      throw new TypeError('Project updates must be an object.');
    }

    const registry = await this.initialize();
    const projectIndex = registry.projects.findIndex(
      (project) => project.projectId === projectId.trim(),
    );

    if (projectIndex === -1) {
      return null;
    }

    const currentProject = registry.projects[projectIndex];
    const nextProject = {
      ...currentProject,
      ...updates,
      projectId: currentProject.projectId,
      updatedAt: new Date().toISOString(),
    };

    registry.projects[projectIndex] = nextProject;
    await writeJsonSafe(this.registryFilePath, registry);

    return nextProject;
  }
}

const projectRegistry = new ProjectRegistry();

export default projectRegistry;
