/**
 * Child process that runs a project's Vite dev server with the PixelForge
 * plugin added programmatically. The project's own vite.config is loaded
 * as usual; nothing in the project is modified.
 *
 * Protocol: prints one JSON line `{"type":"ready","url":...}` on stdout
 * when listening, or `{"type":"error","message":...}`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pixelforge } from '@pixelforge/vite-plugin';

const root = process.env.PF_PROJECT_ROOT!;
const port = Number(process.env.PF_PORT);
const agentPath = process.env.PF_AGENT_PATH!;

function send(msg: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

/** Resolve the ESM entry of a package installed for the project. */
function resolvePackage(name: string, from: string): string {
  let dir = from;
  while (true) {
    const pkgDir = path.join(dir, 'node_modules', name);
    const pkgJson = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      const exp = pkg.exports?.['.'];
      const entry = (typeof exp === 'string' ? exp : exp?.import?.default ?? exp?.import ?? exp?.default) ?? pkg.module ?? pkg.main ?? 'index.js';
      return path.join(pkgDir, typeof entry === 'string' ? entry : entry.default);
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot find "${name}" from ${from}. Did you run npm install in the project?`);
    dir = parent;
  }
}

try {
  const vite = await import(pathToFileURL(resolvePackage('vite', root)).href);
  const server = await vite.createServer({
    root,
    clearScreen: false,
    logLevel: 'info',
    server: { port, strictPort: true, host: 'localhost' },
    plugins: [pixelforge({ agentPath })],
  });
  await server.listen();
  send({ type: 'ready', url: `http://localhost:${port}/` });
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} catch (e) {
  send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
}
