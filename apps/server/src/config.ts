import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(here, '../../..');
export const DATA_DIR = process.env.PF_DATA_DIR ?? path.join(REPO_ROOT, '.pixelforge-data');
export const WORK_DIR = process.env.PF_WORK_DIR ?? path.join(REPO_ROOT, '.pixelforge-work');
export const DEMO_DIR = path.join(REPO_ROOT, 'demo');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'fixtures');
export const EDITOR_DIST = path.join(REPO_ROOT, 'apps/editor/dist');

export const API_PORT = Number(process.env.PF_API_PORT ?? 4000);
/** The inspected page is served from a different origin than the editor. */
export const PROXY_PORT = Number(process.env.PF_PROXY_PORT ?? 4001);
export const PROJECT_PORT_START = Number(process.env.PF_PROJECT_PORT ?? 4100);
export const HOST = process.env.PF_HOST ?? 'localhost';

export const IS_PROD = process.env.NODE_ENV === 'production';
