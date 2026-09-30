import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './config.ts';

export const AGENT_PATH = path.join(REPO_ROOT, 'packages/agent/dist/agent.js');

/** Build the in-page agent (fast, esbuild) and rebuild on change in dev. */
export async function ensureAgent(watch: boolean): Promise<string> {
  const { buildAgent } = (await import(path.join(REPO_ROOT, 'packages/agent/build.mjs'))) as { buildAgent: () => Promise<string> };
  await buildAgent();
  if (watch) {
    const dirs = [path.join(REPO_ROOT, 'packages/agent/src'), path.join(REPO_ROOT, 'packages/core/src')];
    let timer: NodeJS.Timeout | null = null;
    for (const dir of dirs) {
      fs.watch(dir, { recursive: true }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          buildAgent()
            .then(() => console.log('[agent] rebuilt'))
            .catch((e) => console.error('[agent] build failed', e.message));
        }, 100);
      });
    }
  }
  return AGENT_PATH;
}
