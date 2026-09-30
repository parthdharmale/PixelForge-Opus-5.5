import MagicString from 'magic-string';
import path from 'node:path';
import type { Root } from 'postcss';
import { createTwoFilesPatch } from 'diff';
import type { FilePatch } from '@pixelforge/core';
import { parseCss, stringify } from './css.ts';
import { parseModule, type AnyNode } from './jsx.ts';

export interface ProjectAccess {
  /** Absolute project root. */
  root: string;
  read(absPath: string): string | null;
  /** Absolute paths of project source files (js/ts/jsx/tsx/css). */
  sourceFiles(): string[];
  hasTailwind: boolean;
}

export interface JsxFile {
  abs: string;
  code: string;
  ast: AnyNode;
  ms: MagicString;
}

/** In-memory, per-patch view of the project files being edited. */
export class Workspace {
  private jsxFiles = new Map<string, JsxFile>();
  private cssFiles = new Map<string, { root: Root; original: string; created: boolean }>();
  private parsed = new Map<string, AnyNode | null>();

  constructor(readonly project: ProjectAccess) {}

  rel(abs: string): string {
    return path.relative(this.project.root, abs).split(path.sep).join('/');
  }

  abs(rel: string): string {
    return path.resolve(this.project.root, rel);
  }

  jsx(abs: string): JsxFile | null {
    let f = this.jsxFiles.get(abs);
    if (f) return f;
    const code = this.project.read(abs);
    if (code === null) return null;
    f = { abs, code, ast: parseModule(code), ms: new MagicString(code) };
    this.jsxFiles.set(abs, f);
    return f;
  }

  /** Read-only AST (shared cache) for files we only search. */
  ast(abs: string): AnyNode | null {
    const open = this.jsxFiles.get(abs);
    if (open) return open.ast;
    if (!this.parsed.has(abs)) {
      const code = this.project.read(abs);
      let ast: AnyNode | null = null;
      try {
        ast = code === null ? null : parseModule(code);
      } catch {
        ast = null;
      }
      this.parsed.set(abs, ast);
    }
    return this.parsed.get(abs) ?? null;
  }

  css(abs: string, create = false): Root | null {
    const existing = this.cssFiles.get(abs);
    if (existing) return existing.root;
    const code = this.project.read(abs);
    if (code === null && !create) return null;
    const root = parseCss(code ?? '', abs);
    this.cssFiles.set(abs, { root, original: code ?? '', created: code === null });
    return root;
  }

  /** Read-only parse of a stylesheet (not registered as edited). */
  peekCss(abs: string): Root | null {
    const existing = this.cssFiles.get(abs);
    if (existing) return existing.root;
    const code = this.project.read(abs);
    if (code === null) return null;
    try {
      return parseCss(code, abs);
    } catch {
      return null;
    }
  }

  finalize(): FilePatch[] {
    const out: FilePatch[] = [];
    for (const f of this.jsxFiles.values()) {
      const after = f.ms.toString();
      if (after !== f.code) out.push(this.patch(f.abs, f.code, after, false));
    }
    for (const [abs, f] of this.cssFiles) {
      const after = stringify(f.root);
      if (after !== f.original && !(f.original && after.trimEnd() === f.original.trimEnd())) out.push(this.patch(abs, f.original, after, f.created));
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  private patch(abs: string, before: string, after: string, created: boolean): FilePatch {
    const rel = this.rel(abs);
    const diff = createTwoFilesPatch(created ? '/dev/null' : `a/${rel}`, `b/${rel}`, before, after, undefined, undefined, { context: 3 });
    return { path: rel, before, after, diff: diff.replace(/^=+\n/m, ''), created };
  }
}
