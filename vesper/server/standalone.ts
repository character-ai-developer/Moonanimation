import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { config } from './lib/config';
import { logStore } from './lib/logger';

/**
 * Standalone production entry point.
 *
 * Serves the built frontend (`dist/`) AND the /api from one process, so any
 * free single-process host (Render, Koyeb, Railway, Docker, a VPS…) only needs
 * `npm run build` + `npm run server`. During development the same API app is
 * mounted into Vite by server/vitePlugin.ts instead.
 */
const app = createApp();

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false }));
  // The UI is a hash-router SPA: every non-API path gets the shell.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .send('Vesper API is running. Build the frontend first: npm run build — then reload to get the UI.');
  });
}

app.listen(config.port, config.host, () => {
  logStore.push('system', `Vesper listening on http://${config.host}:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`vesper listening on http://${config.host}:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`open cloud key configured: ${config.robloxApiKey ? 'yes' : 'no (legacy public endpoints in use)'}`);
});
