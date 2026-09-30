import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ensureAgent } from './agentBundle.ts';
import { createApi } from './api.ts';
import { API_PORT, EDITOR_DIST, FIXTURES_DIR, IS_PROD, PROXY_PORT } from './config.ts';
import { configureNetwork } from './net.ts';
import { stopAll } from './projects/manager.ts';
import { createProxyApp } from './proxy.ts';
import { closeBrowser } from './verify/browser.ts';

configureNetwork();
await ensureAgent(!IS_PROD);

const app = express();
app.disable('x-powered-by');
app.use('/api', createApi());
// Local fixture sites for URL mode (no internet required).
app.use('/fixtures', express.static(FIXTURES_DIR));
if (fs.existsSync(EDITOR_DIST)) {
  app.use(express.static(EDITOR_DIST));
  app.get(/^(?!\/api|\/fixtures).*/, (_req, res) => res.sendFile(path.join(EDITOR_DIST, 'index.html')));
}

const api = app.listen(API_PORT, () => console.log(`[pixelforge] API ${IS_PROD ? '+ editor ' : ''}on http://localhost:${API_PORT}`));
const proxy = createProxyApp().listen(PROXY_PORT, () => console.log(`[pixelforge] page proxy on http://localhost:${PROXY_PORT}`));

async function shutdown() {
  stopAll();
  await closeBrowser();
  api.close();
  proxy.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
