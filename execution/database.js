import { createProject, getUserProjects, updateProject } from '../backend/db.js';

export const db = {};

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

export { createProject, getUserProjects, updateProject };

export function createTable(name) {
  const normalizedName = ensureTable(name);
  db[normalizedName] = [];
}

export function insert(table, data) {
  const normalizedTable = ensureTable(table);
  db[normalizedTable].push(data);
  return data;
}

export function find(table) {
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
  return item;
}

export function remove(table, id) {
  const normalizedTable = ensureTable(table);
  db[normalizedTable] = db[normalizedTable].filter((entry) => entry?.id !== id);
}

export async function queryProjects(userId, accessToken = '', options = {}) {
  return getUserProjects(userId, accessToken, options);
}

export default {
  db,
  createTable,
  insert,
  find,
  update,
  remove,
  createProject,
  getUserProjects,
  queryProjects,
  updateProject,
};
