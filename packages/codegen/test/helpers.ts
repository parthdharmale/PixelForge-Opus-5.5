import fs from 'node:fs';
import path from 'node:path';
import { makeTarget, type BreakpointId, type EditState, emptyState, applyChange, toChange, type EditOp } from '@pixelforge/core';
import type { ProjectAccess } from '@pixelforge/codegen';

export const DEMO_ROOT = path.resolve(__dirname, '../../../demo');

/** Read-only view of a project directory, optionally with in-memory overrides. */
export function projectFrom(root: string, overrides: Record<string, string> = {}, hasTailwind = true): ProjectAccess {
  const files: string[] = [];
  const walkDir = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (/\.(tsx?|jsx?|css)$/.test(e.name)) files.push(p);
    }
  };
  walkDir(path.join(root, 'src'));
  for (const rel of Object.keys(overrides)) {
    const abs = path.join(root, rel);
    if (!files.includes(abs)) files.push(abs);
  }
  return {
    root,
    hasTailwind,
    read: (abs) => {
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (rel in overrides) return overrides[rel];
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    },
    sourceFiles: () => files,
  };
}

/** Find the line/column of the first JSX opening tag matching `needle` in a demo file. */
export function locate(file: string, needle: string, root = DEMO_ROOT, overrides: Record<string, string> = {}) {
  const code = overrides[file] ?? fs.readFileSync(path.join(root, file), 'utf8');
  const idx = code.indexOf(needle);
  if (idx < 0) throw new Error(`${needle} not found in ${file}`);
  const before = code.slice(0, idx);
  const line = before.split('\n').length;
  const column = idx - before.lastIndexOf('\n') - 1;
  return { file, line, column };
}

export function target(src: { file: string; line: number; column: number }, label = 'el', instanceCount = 1) {
  return makeTarget({ scope: 'source', selector: label, src, label, component: null, instanceCount });
}

export function stateWith(ops: EditOp[]): EditState {
  return ops.reduce((s, op) => applyChange(s, toChange(s, op)), emptyState());
}

export function style(t: ReturnType<typeof target>, property: string, value: string, breakpoint: BreakpointId = 'base'): EditOp {
  return { type: 'style', target: t, breakpoint, property, value };
}
