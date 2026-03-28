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

    app.post(`/api/${table}`, (req, res) => {
      res.json(db.insert(table, req.body));
    });

    app.get(`/api/${table}`, (req, res) => {
      res.json(db.find(table));
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
