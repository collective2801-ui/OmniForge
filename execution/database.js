import { randomUUID } from 'node:crypto';
import { createProject, getUserProjects, updateProject } from '../backend/db.js';
import {
  loadPersistentTables,
  persistTableCreate,
  persistTableInsert,
  persistTableRemove,
  persistTableUpdate,
} from '../backend/persistenceStore.js';

const persistedTables = await loadPersistentTables().catch(() => ({}));

export const db =
  persistedTables && typeof persistedTables === 'object' && !Array.isArray(persistedTables)
    ? persistedTables
    : {};

function ensureTable(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Table name is required');
  }

  const normalizedName = name.trim();

  if (!Array.isArray(db[normalizedName])) {
    db[normalizedName] = [];
  }

  return normalizedName;
}

function normalizeRow(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      id:
        typeof data.id === 'string' && data.id.trim().length > 0
          ? data.id.trim()
          : randomUUID(),
      ...data,
    };
  }

  return {
    id: randomUUID(),
    value: data,
  };
}

export { createProject, getUserProjects, updateProject };

export function createTable(name) {
  const normalizedName = ensureTable(name);
  db[normalizedName] = Array.isArray(db[normalizedName]) ? db[normalizedName] : [];
  void persistTableCreate(normalizedName).catch(() => {});
  return db[normalizedName];
}

export async function createTableAsync(name) {
  const normalizedName = ensureTable(name);
  db[normalizedName] = Array.isArray(db[normalizedName]) ? db[normalizedName] : [];
  await persistTableCreate(normalizedName).catch(() => null);
  return db[normalizedName];
}

export function insert(table, data) {
  const normalizedTable = ensureTable(table);
  const record = normalizeRow(data);
  db[normalizedTable] = [
    ...db[normalizedTable].filter((entry) => entry?.id !== record.id),
    record,
  ];
  void persistTableInsert(normalizedTable, record).catch(() => {});
  return record;
}

export async function insertAsync(table, data) {
  const normalizedTable = ensureTable(table);
  const record = normalizeRow(data);
  db[normalizedTable] = [
    ...db[normalizedTable].filter((entry) => entry?.id !== record.id),
    record,
  ];
  await persistTableInsert(normalizedTable, record).catch(() => null);
  return record;
}

export function find(table) {
  const normalizedTable = ensureTable(table);
  return db[normalizedTable];
}

export async function findAsync(table) {
  const normalizedTable = ensureTable(table);
  return db[normalizedTable];
}

export function update(table, id, newData) {
  const normalizedTable = ensureTable(table);
  const item = db[normalizedTable].find((entry) => entry?.id === id);

  if (!item) {
    return null;
  }

  Object.assign(item, newData);
  void persistTableUpdate(normalizedTable, id, newData).catch(() => {});
  return item;
}

export async function updateAsync(table, id, newData) {
  const normalizedTable = ensureTable(table);
  const item = db[normalizedTable].find((entry) => entry?.id === id);

  if (!item) {
    return null;
  }

  Object.assign(item, newData);
  await persistTableUpdate(normalizedTable, id, newData).catch(() => null);
  return item;
}

export function remove(table, id) {
  const normalizedTable = ensureTable(table);
  db[normalizedTable] = db[normalizedTable].filter((entry) => entry?.id !== id);
  void persistTableRemove(normalizedTable, id).catch(() => {});
}

export async function removeAsync(table, id) {
  const normalizedTable = ensureTable(table);
  db[normalizedTable] = db[normalizedTable].filter((entry) => entry?.id !== id);
  await persistTableRemove(normalizedTable, id).catch(() => null);
}

export async function queryProjects(userId, accessToken = '', options = {}) {
  return getUserProjects(userId, accessToken, options);
}

export default {
  db,
  createTable,
  createTableAsync,
  insert,
  insertAsync,
  find,
  findAsync,
  update,
  updateAsync,
  remove,
  removeAsync,
  createProject,
  getUserProjects,
  queryProjects,
  updateProject,
};
