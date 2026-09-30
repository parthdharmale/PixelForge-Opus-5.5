import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateUrlPatch } from '@pixelforge/codegen';
import type { AIRequest, EditState, PatchResult, VerificationReport } from '@pixelforge/core';
import { defaultProvider, listProviders, planEdits } from './ai/index.ts';
import { DATA_DIR, FIXTURES_DIR, HOST, PROXY_PORT } from './config.ts';
import { getJob, startJob } from './jobs.ts';
import { htmlCache, rewriteHtml, validateTargetUrl } from './proxy.ts';
import { applyPatch, generatePatch, getPatch, getProject, openProject, projectLogs, resetDemo, revertPatch, stopProject } from './projects/manager.ts';
import { captureAfter, captureBefore, compare, DEFAULT_VIEWPORTS } from './verify/pipeline.ts';

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res))
    .then((result) => {
      if (!res.headersSent) res.json(result ?? { ok: true });
    })
    .catch(next);
};

const urlPatches = new Map<string, PatchResult>();

export function createApi() {
  const api = express.Router();
  api.use(express.json({ limit: '10mb' }));

  api.get('/health', wrap(() => ({ ok: true, proxyPort: PROXY_PORT, ai: { providers: listProviders(), default: defaultProvider() } })));

  // --- URL mode --------------------------------------------------------------
  api.post(
    '/session/open',
    wrap((req) => {
      const url = validateTargetUrl(String(req.body.url ?? ''));
      const proxyOrigin = `${req.protocol}://${(req.hostname || HOST).replace(/^127\.0\.0\.1$/, 'localhost')}:${PROXY_PORT}`;
      return { frameUrl: `${proxyOrigin}/__pf/open?url=${encodeURIComponent(url.href)}`, originalUrl: url.href };
    }),
  );

  api.get(
    '/fixtures',
    wrap(() =>
      fs.existsSync(FIXTURES_DIR)
        ? fs
            .readdirSync(FIXTURES_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => ({ name: d.name, path: `/fixtures/${d.name}/` }))
        : [],
    ),
  );

  api.post(
    '/url/codegen',
    wrap(async (req) => {
      const pageUrl = String(req.body.pageUrl);
      const state = req.body.state as EditState;
      let html = htmlCache.get(pageUrl);
      if (!html) {
        const r = await fetch(pageUrl);
        html = await r.text();
      }
      const res = generateUrlPatch(state, html, pageUrl);
      const patch: PatchResult = { id: crypto.randomBytes(6).toString('hex'), mode: 'url', createdAt: Date.now(), state, ...res };
      urlPatches.set(patch.id, patch);
      return patch;
    }),
  );

  /**
   * URL-mode verification: render the proxied page with the live edits
   * (expected), then render it again from the *exported* patch — patched
   * HTML plus the overrides stylesheet, served via request interception —
   * and compare. This checks that the export reproduces the edit.
   */
  api.post(
    '/url/verify',
    wrap((req) => {
      const patch = urlPatches.get(String(req.body.patchId));
      if (!patch) throw Object.assign(new Error('Patch not found; regenerate it.'), { status: 404 });
      const pageUrl = new URL(String(req.body.pageUrl));
      const proxyOrigin = `http://localhost:${PROXY_PORT}`;
      const openUrl = `${proxyOrigin}/__pf/open?url=${encodeURIComponent(pageUrl.href)}`;
      const docUrl = `${proxyOrigin}${pageUrl.pathname}${pageUrl.search}`;
      const html = patch.files.find((f) => f.path === 'index.html')?.after ?? htmlCache.get(pageUrl.href);
      const css = patch.files.find((f) => f.path === 'pixelforge-overrides.css')?.after ?? '';
      const job = startJob<VerificationReport>('verify', async (h) => {
        const started = Date.now();
        const before = await h.step('Render original and expected result', () => captureBefore(openUrl, patch.state, DEFAULT_VIEWPORTS));
        const after = await h.step('Render the exported patch', () =>
          captureAfter(docUrl, before, h, async (cp) => {
            // Redirected requests are not interceptable: set the proxy's
            // target cookie first, then load the document URL directly.
            await cp.page.request.get(openUrl, { maxRedirects: 0 });
            await cp.page.route(docUrl, (route) => (html ? route.fulfill({ status: 200, contentType: 'text/html', body: rewriteHtml(html, pageUrl.origin) }) : route.continue()));
            await cp.page.route('**/pixelforge-overrides.css', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: css }));
          }),
        );
        return h.step('Compare renders', async () => compare(h.job.id, patch.id, before, after, started));
      });
      return { jobId: job.id };
    }),
  );

  // --- Source project mode ---------------------------------------------------
  api.post('/projects', wrap((req) => openProject({ demo: !!req.body.demo, path: req.body.path, devUrl: req.body.devUrl, reset: !!req.body.reset })));
  api.get('/projects/:id', wrap((req) => ({ ...getProject(String(req.params.id)).status, logs: projectLogs(String(req.params.id)) })));
  api.post('/projects/:id/stop', wrap((req) => stopProject(String(req.params.id))));
  api.post('/projects/:id/reset', wrap((req) => resetDemo(String(req.params.id))));
  api.post('/projects/:id/codegen', wrap((req) => generatePatch(String(req.params.id), req.body.state as EditState, req.body.sharedClass ?? {})));
  api.post('/projects/:id/revert', wrap((req) => ({ files: revertPatch(String(req.params.id), String(req.body.patchId)) })));

  /**
   * Apply a patch; with `verify`, run the full loop: capture baseline and
   * expected renders, write files, wait for the dev server, capture the
   * result and compare.
   */
  api.post(
    '/projects/:id/apply',
    wrap((req) => {
      const id = String(req.params.id);
      const patchId = String(req.body.patchId);
      const project = getProject(id);
      const patch = getPatch(id, patchId);
      const pagePath = String(req.body.pagePath ?? '/');
      const viewports = Array.isArray(req.body.viewports) && req.body.viewports.length ? req.body.viewports : DEFAULT_VIEWPORTS;
      if (!req.body.verify) return { files: applyPatch(id, patchId) };
      const job = startJob<VerificationReport>('verify', async (h) => {
        const started = Date.now();
        const url = new URL(pagePath, project.status.url!).href;
        const before = await h.step('Render original and expected result', () => captureBefore(url, patch.state, viewports));
        await h.step(`Write ${patch.files.length} file${patch.files.length === 1 ? '' : 's'}`, async () => applyPatch(id, patchId));
        const after = await h.step('Reload app from patched source', () => captureAfter(url, before, h));
        return h.step('Compare renders', async () => compare(h.job.id, patchId, before, after, started));
      });
      return { jobId: job.id };
    }),
  );

  // --- AI ----------------------------------------------------------------------
  api.get('/ai/providers', wrap(() => ({ providers: listProviders(), default: defaultProvider() })));
  api.post('/ai/plan', wrap((req) => planEdits(req.body.request as AIRequest, req.body.provider)));

  // --- Jobs & artifacts ------------------------------------------------------------
  api.get(
    '/jobs/:id',
    wrap((req) => {
      const job = getJob(String(req.params.id));
      if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
      return job;
    }),
  );
  api.get('/artifacts/:job/:file', (req, res) => {
    const file = path.join(DATA_DIR, 'jobs', path.basename(String(req.params.job)), path.basename(String(req.params.file)));
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file);
  });

  api.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 400).json({ error: err.message });
  });
  return api;
}
