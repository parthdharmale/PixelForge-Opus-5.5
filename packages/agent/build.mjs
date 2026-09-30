// Bundles the in-page agent into a single IIFE served to inspected pages.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export async function buildAgent({ minify = false } = {}) {
  await build({
    entryPoints: [path.join(here, 'src/index.ts')],
    outfile: path.join(here, 'dist/agent.js'),
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify,
    sourcemap: 'inline',
    logLevel: 'warning',
  });
  return path.join(here, 'dist/agent.js');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildAgent({ minify: process.argv.includes('--minify') });
  console.log('agent built');
}
