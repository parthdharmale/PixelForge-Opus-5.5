/**
 * Rewriting reverse proxy for editing public URLs.
 *
 * Browsers block framing (X-Frame-Options / CSP frame-ancestors) and
 * cross-origin CSSOM access, both of which the editor needs. The proxy
 * serves the target site from its own origin (a different port from the
 * editor, so the page cannot script the editor), with:
 *   - the target origin chosen by a cookie, so the page keeps its real
 *     paths (client-side routers keep working, root-relative URLs resolve)
 *   - framing / CSP headers removed, the inspector agent injected first
 *   - absolute same-origin URLs made relative; cross-origin stylesheets
 *     routed through /__pf/asset so their rules are readable
 */
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import { AGENT_PATH } from './agentBundle.ts';

const COOKIE = 'pf_target';
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer']);
const STRIP_RESPONSE = new Set(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'content-encoding', 'content-length', 'strict-transport-security', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy', 'permissions-policy', 'report-to', 'nel']);

/** Raw HTML as served by the origin, per original URL (for URL-mode patches). */
export const htmlCache = new Map<string, string>();

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function stripCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const kept = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith(`${COOKIE}=`));
  return kept.length ? kept.join('; ') : undefined;
}

export function validateTargetUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https URLs can be opened.');
  return url;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteHtml(html: string, origin: string): string {
  const originRe = escapeRegex(origin);
  let out = html
    // CSP delivered via <meta> would block our agent.
    .replace(/<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi, '')
    // SRI hashes break when we rewrite CSS; the proxy is a trusted hop.
    .replace(/\s(integrity|nonce)=("[^"]*"|'[^']*')/gi, '')
    // Same-origin absolute URLs become root-relative so they hit the proxy.
    .replace(new RegExp(`(\\s(?:src|href|action|poster|srcset|content)=["'])${originRe}(?=[/"'?#])`, 'gi'), '$1')
    .replace(new RegExp(`(["'(\\s])${originRe}/`, 'g'), '$1/');
  // Cross-origin stylesheets: route through the asset endpoint for CSSOM access.
  out = out.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel=["']?stylesheet/i.test(tag)) return tag;
    return tag.replace(/href=(["'])(https?:\/\/[^"']+)\1/i, (_m, q: string, href: string) => `href=${q}/__pf/asset?url=${encodeURIComponent(href)}${q}`);
  });
  const inject = '<script src="/__pf/agent.js" data-pixelforge="agent"></script>';
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
  else if (/<html[^>]*>/i.test(out)) out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  else out = inject + out;
  return out;
}

export function rewriteCss(css: string, origin: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q: string, u: string) => {
    if (/^(data:|#)/.test(u)) return m;
    try {
      const abs = new URL(u, base);
      if (abs.origin === origin) return `url(${q}${abs.pathname}${abs.search}${q})`;
      return `url(${q}${abs.href}${q})`;
    } catch {
      return m;
    }
  });
}

function copyResponseHeaders(from: globalThis.Response, res: Response, origin: string) {
  from.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (STRIP_RESPONSE.has(k) || HOP_HEADERS.has(k) || k === 'set-cookie') return;
    if (k === 'location') {
      try {
        const loc = new URL(value, origin);
        res.setHeader('location', loc.origin === origin ? loc.pathname + loc.search + loc.hash : value);
      } catch {
        res.setHeader('location', value);
      }
      return;
    }
    res.setHeader(key, value);
  });
  const cookies = (from.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (cookies.length) {
    res.setHeader(
      'set-cookie',
      cookies.map((c) =>
        c
          .replace(/;\s*domain=[^;]*/gi, '')
          .replace(/;\s*secure/gi, '')
          .replace(/;\s*samesite=none/gi, '; SameSite=Lax')
          .replace(/;\s*partitioned/gi, ''),
      ),
    );
  }
}

function errorPage(res: Response, status: number, title: string, detail: string) {
  res
    .status(status)
    .type('html')
    .send(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui;background:#101218;color:#e6e8ee;display:grid;place-items:center;height:100vh;margin:0}.b{max-width:520px;padding:32px;border:1px solid #2a2f3b;border-radius:12px;background:#161a22}h1{font-size:18px;margin:0 0 8px}p{color:#9aa1b2;margin:0;line-height:1.5}</style></head><body><script src="/__pf/agent.js" data-pixelforge="agent"></script><div class="b" data-pixelforge="error"><h1>${title}</h1><p>${detail}</p></div></body></html>`);
}

export function createProxyApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.get('/__pf/agent.js', (_req, res) => {
    res.type('application/javascript').setHeader('Cache-Control', 'no-store');
    res.send(fs.existsSync(AGENT_PATH) ? fs.readFileSync(AGENT_PATH) : '// agent missing');
  });

  app.get('/__pf/open', (req, res) => {
    try {
      const url = validateTargetUrl(String(req.query.url ?? ''));
      res.setHeader('set-cookie', `${COOKIE}=${encodeURIComponent(url.origin)}; Path=/; SameSite=Lax; HttpOnly`);
      res.redirect(302, url.pathname + url.search + url.hash);
    } catch (e) {
      errorPage(res, 400, 'Invalid URL', (e as Error).message);
    }
  });

  app.get('/__pf/asset', async (req, res) => {
    const target = String(req.query.url ?? '');
    try {
      const upstream = await fetch(target, { headers: { 'user-agent': req.headers['user-agent'] ?? 'PixelForge' } });
      const type = upstream.headers.get('content-type') ?? 'text/css';
      res.status(upstream.status).type(type).setHeader('Cache-Control', 'no-store');
      const text = await upstream.text();
      res.send(type.includes('css') ? rewriteCss(text, new URL(target).origin, target) : text);
    } catch (e) {
      res.status(502).send(`/* PixelForge could not fetch ${target}: ${(e as Error).message} */`);
    }
  });

  app.use(express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
    const origin = readCookie(req, COOKIE);
    if (!origin) {
      errorPage(res, 400, 'No site selected', 'Open a URL from the PixelForge editor to start a proxy session.');
      return;
    }
    const upstreamUrl = origin + req.originalUrl;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!v || HOP_HEADERS.has(k) || ['host', 'cookie', 'accept-encoding', 'origin', 'referer', 'content-length'].includes(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    const cookie = stripCookie(req.headers.cookie);
    if (cookie) headers.cookie = cookie;
    if (req.headers.referer) {
      try {
        const r = new URL(req.headers.referer);
        headers.referer = origin + r.pathname + r.search;
      } catch {
        /* ignore */
      }
    }
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) || !Buffer.isBuffer(req.body) ? undefined : new Uint8Array(req.body),
        redirect: 'manual',
      });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; message?: string } }).cause;
      errorPage(res, 502, 'Could not reach the site', `${upstreamUrl} failed: ${cause?.code ?? ''} ${cause?.message ?? (e as Error).message}`);
      return;
    }
    res.status(upstream.status);
    copyResponseHeaders(upstream, res, origin);
    res.setHeader('Cache-Control', 'no-store');
    const type = upstream.headers.get('content-type') ?? '';
    if (type.includes('text/html')) {
      const html = await upstream.text();
      if (req.method === 'GET' && upstream.status < 300) htmlCache.set(upstreamUrl, html);
      res.send(rewriteHtml(html, origin));
    } else if (type.includes('text/css')) {
      res.send(rewriteCss(await upstream.text(), origin, upstreamUrl));
    } else {
      res.send(Buffer.from(await upstream.arrayBuffer()));
    }
  });
  return app;
}
