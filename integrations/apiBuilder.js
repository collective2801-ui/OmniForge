import express from 'express';

export function createAPI(schema) {
  const app = express();
  app.use(express.json());

  Object.keys(schema ?? {}).forEach((table) => {
    app.get(`/api/${table}`, (req, res) => {
      res.json({
        table,
        data: [],
      });
    });
  });

  return app;
}

export default {
  createAPI,
};
