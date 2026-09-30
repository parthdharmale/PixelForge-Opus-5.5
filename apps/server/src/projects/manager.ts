/**
 * Source Project Mode: start/stop a project's dev server, generate patches
 * against its files, apply and revert them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSourcePatch, type ProjectAccess } from '@pixelforge/codegen';
import type { EditState, PatchResult, ProjectStatus } from '@pixelforge/core';
import { AGENT_PATH } from '../agentBundle.ts';
import { DEMO_DIR, PROJECT_PORT_START, REPO_ROOT, WORK_DIR } from '../config.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_EXT = /\.(tsx?|jsx?|css)$/;

interface Project {
  status: ProjectStatus;
  child: ChildProcess | null;
  logs: string[];
  patches: Map<string, PatchResult>;
  backups: Map<string, Array<{ path: string; before: string; after: string }>>;
}

const projects = new Map<string, Project>();
let nextPort = PROJECT_PORT_START;

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** The demo runs from a scratch copy so patches never touch the repo. */
export function prepareDemoWorkspace(reset = false): string {
  const dest = path.join(WORK_DIR, 'demo');
  if (reset && fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  if (!fs.existsSync(dest)) {
    copyDir(DEMO_DIR, dest);
    const nm = path.join(DEMO_DIR, 'node_modules');
    if (fs.existsSync(nm) && !fs.existsSync(path.join(dest, 'node_modules'))) fs.symlinkSync(nm, path.join(dest, 'node_modules'), 'dir');
  }
  return dest;
}

function detectFramework(root: string): { framework: string; tailwind: boolean; vite: boolean } {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) throw new Error(`No package.json in ${root}`);
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const vite = 'vite' in deps;
  const framework = [deps.react ? 'React' : null, vite ? 'Vite' : null].filter(Boolean).join(' + ') || 'unknown';
  return { framework, tailwind: 'tailwindcss' in deps, vite };
}

export function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walkDir = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (SOURCE_EXT.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
    }
  };
  const src = path.join(root, 'src');
  walkDir(fs.existsSync(src) ? src : root);
  return out;
}

function access(p: Project): ProjectAccess {
  const root = p.status.root;
  return {
    root,
    hasTailwind: detectFramework(root).tailwind,
    read: (abs) => {
      if (!abs.startsWith(root)) return null;
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    },
    sourceFiles: () => listSourceFiles(root),
  };
}

function log(p: Project, line: string) {
  p.logs.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
  if (p.logs.length > 400) p.logs.splice(0, p.logs.length - 400);
}

export async function openProject(opts: { demo?: boolean; path?: string; devUrl?: string; reset?: boolean }): Promise<ProjectStatus> {
  const root = opts.demo ? prepareDemoWorkspace(opts.reset) : path.resolve(opts.path ?? '');
  if (!fs.existsSync(root)) throw new Error(`Directory not found: ${root}`);
  const existing = [...projects.values()].find((p) => p.status.root === root && p.status.status !== 'stopped' && p.status.status !== 'error');
  if (existing) return existing.status;
  const info = detectFramework(root);
  const id = crypto.randomBytes(4).toString('hex');
  const project: Project = {
    status: { id, name: opts.demo ? 'Nimbus demo' : path.basename(root), root, url: opts.devUrl ?? null, status: 'starting', framework: info.framework, isDemo: !!opts.demo, appliedPatches: [] },
    child: null,
    logs: [],
    patches: new Map(),
    backups: new Map(),
  };
  projects.set(id, project);
  if (opts.devUrl) {
    // Connect mode: the user runs the dev server (ideally with the plugin).
    project.status.status = 'ready';
    return project.status;
  }
  if (!info.vite) {
    project.status.status = 'error';
    project.status.error = 'Automatic launch supports Vite projects. For other setups, start your dev server with the PixelForge plugin and connect to its URL.';
    return project.status;
  }
  await launch(project);
  return project.status;
}

function launch(project: Project): Promise<void> {
  const port = nextPort++;
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'launcher.ts')], {
    cwd: REPO_ROOT,
    env: { ...process.env, PF_PROJECT_ROOT: project.status.root, PF_PORT: String(port), PF_AGENT_PATH: AGENT_PATH, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  project.child = child;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      project.status.status = 'error';
      project.status.error = 'Dev server did not start within 60s';
      resolve();
    }, 60_000);
    let buf = '';
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (line.startsWith('{"type"')) {
          const msg = JSON.parse(line);
          clearTimeout(timeout);
          if (msg.type === 'ready') {
            project.status.status = 'ready';
            project.status.url = msg.url;
          } else {
            project.status.status = 'error';
            project.status.error = msg.message;
          }
          resolve();
        } else if (line.trim()) log(project, line);
      }
    });
    child.stderr!.on('data', (d: Buffer) => d.toString().split('\n').filter(Boolean).forEach((l) => log(project, l)));
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (project.status.status !== 'error') project.status.status = code === 0 ? 'stopped' : 'error';
      if (code && !project.status.error) project.status.error = `Dev server exited with code ${code}`;
      resolve();
    });
  });
}

export function getProject(id: string): Project {
  const p = projects.get(id);
  if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
  return p;
}

export function projectLogs(id: string): string[] {
  return getProject(id).logs.slice(-200);
}

export function stopAll() {
  for (const p of projects.values()) p.child?.kill('SIGTERM');
}

export async function stopProject(id: string) {
  const p = getProject(id);
  p.child?.kill('SIGTERM');
  p.status.status = 'stopped';
}

export async function resetDemo(id: string): Promise<ProjectStatus> {
  const p = getProject(id);
  if (!p.status.isDemo) throw new Error('Only the demo project can be reset');
  // Restore files in place so the running dev server just hot-reloads.
  const fresh = path.join(WORK_DIR, 'demo-fresh');
  fs.rmSync(fresh, { recursive: true, force: true });
  copyDir(DEMO_DIR, fresh);
  for (const abs of listSourceFiles(fresh)) {
    const rel = path.relative(fresh, abs);
    const dest = path.join(p.status.root, rel);
    const next = fs.readFileSync(abs, 'utf8');
    if (!fs.existsSync(dest) || fs.readFileSync(dest, 'utf8') !== next) fs.writeFileSync(dest, next);
  }
  for (const abs of listSourceFiles(p.status.root)) {
    if (!fs.existsSync(path.join(fresh, path.relative(p.status.root, abs)))) fs.rmSync(abs);
  }
  fs.rmSync(fresh, { recursive: true, force: true });
  p.status.appliedPatches = [];
  p.backups.clear();
  return p.status;
}

export function generatePatch(id: string, state: EditState, sharedClass: Record<string, boolean> = {}): PatchResult {
  const p = getProject(id);
  const res = generateSourcePatch(state, access(p), { sharedClass });
  const patch: PatchResult = { id: crypto.randomBytes(6).toString('hex'), mode: 'source', createdAt: Date.now(), state, ...res };
  p.patches.set(patch.id, patch);
  return patch;
}

export function getPatch(id: string, patchId: string): PatchResult {
  const patch = getProject(id).patches.get(patchId);
  if (!patch) throw Object.assign(new Error('Patch not found (the server may have restarted); regenerate it.'), { status: 404 });
  return patch;
}

/** Write a patch's files. Refuses if any file changed since the patch was generated. */
export function applyPatch(id: string, patchId: string): string[] {
  const p = getProject(id);
  const patch = getPatch(id, patchId);
  const root = p.status.root;
  for (const f of patch.files) {
    const abs = path.join(root, f.path);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current !== f.before) throw Object.assign(new Error(`${f.path} changed on disk since the patch was generated. Regenerate the patch.`), { status: 409 });
  }
  for (const f of patch.files) {
    const abs = path.join(root, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.after);
  }
  p.backups.set(patchId, patch.files.map((f) => ({ path: f.path, before: f.before, after: f.after })));
  p.status.appliedPatches.push({ id: patchId, files: patch.files.map((f) => f.path), appliedAt: Date.now(), reverted: false });
  return patch.files.map((f) => f.path);
}

export function revertPatch(id: string, patchId: string): string[] {
  const p = getProject(id);
  const backup = p.backups.get(patchId);
  if (!backup) throw new Error('Nothing to revert for this patch');
  for (const f of backup) {
    const abs = path.join(p.status.root, f.path);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    if (current !== f.after) throw Object.assign(new Error(`${f.path} was modified after the patch was applied; not reverting.`), { status: 409 });
  }
  for (const f of backup) fs.writeFileSync(path.join(p.status.root, f.path), f.before);
  p.backups.delete(patchId);
  const entry = p.status.appliedPatches.find((a) => a.id === patchId);
  if (entry) entry.reverted = true;
  return backup.map((f) => f.path);
}
