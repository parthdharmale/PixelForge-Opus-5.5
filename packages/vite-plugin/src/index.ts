/**
 * Vite plugin used in Source Project Mode. PixelForge's project runner
 * adds it programmatically (the user's vite.config is not modified):
 *   - instruments JSX with `data-pf-src` source locations (dev only)
 *   - injects the in-page inspector agent into index.html
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { instrumentSource } from './instrument.ts';

export { instrumentSource, walk, SRC_ATTR } from './instrument.ts';

export interface PixelForgePluginOptions {
  /** Absolute path of the bundled agent script. */
  agentPath?: string;
}

export function pixelforge(options: PixelForgePluginOptions = {}): Plugin {
  let root = process.cwd();
  return {
    name: 'pixelforge',
    apply: 'serve',
    enforce: 'pre',
    configResolved(config) {
      root = config.root;
    },
    transform(code, id) {
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/')) return null;
      const rel = path.relative(root, file).split(path.sep).join('/');
      const res = instrumentSource(code, rel);
      return res ? { code: res.code, map: res.map } : null;
    },
    transformIndexHtml() {
      return [
        { tag: 'script', attrs: { 'data-pixelforge': 'config' }, children: `window.__PF_CONFIG__=${JSON.stringify({ root, mode: 'source' })};`, injectTo: 'head-prepend' },
        { tag: 'script', attrs: { src: '/__pf/agent.js', 'data-pixelforge': 'agent' }, injectTo: 'head' },
      ];
    },
    configureServer(server) {
      server.middlewares.use('/__pf/agent.js', (_req, res) => {
        const p = options.agentPath;
        if (!p || !fs.existsSync(p)) {
          res.statusCode = 404;
          res.end('// PixelForge agent not built');
          return;
        }
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(fs.readFileSync(p));
      });
    },
  };
}

export default pixelforge;
