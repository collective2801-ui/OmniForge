import express from 'express';
import * as db from './database.js';
import apiManager, { ApiManager } from '../api/apiManager.js';

export { ApiManager };

export function suggestApis(intent = {}) {
  return apiManager.suggestApis(intent);
}

export function buildApi(intent = {}) {
  return apiManager.buildApiConfig(intent);
}

export async function storeApi(projectRoot, apiConfig) {
  return apiManager.storeApiConfig(projectRoot, apiConfig);
}

export function buildApiFiles(intent = {}, apiConfig = {}) {
  return apiManager.buildIntegrationFiles(intent, apiConfig);
}

export function createServer(schema = {}) {
  const app = express();
  app.use(express.json());

  Object.keys(schema).forEach((table) => {
    db.createTable(table);

    app.post(`/api/${table}`, async (req, res) => {
      const inserted = await db.insertAsync(table, req.body);
      res.json(inserted);
    });

    app.get(`/api/${table}`, async (req, res) => {
      const rows = await db.findAsync(table);
      res.json(rows);
    });
  });

  return app;
}

export default {
  ApiManager,
  suggestApis,
  buildApi,
  storeApi,
  buildApiFiles,
  createServer,
};
