/**
 * JSX analysis helpers: locate the element a `data-pf-src` points at, and
 * understand how its className is built (string literals, CSS module
 * references, template literals, clsx-style calls, conditionals, local
 * variables).
 */
import { parse } from '@babel/parser';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnyNode = any;

export function parseModule(code: string): AnyNode {
  return parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true });
}

export function walk(node: AnyNode, visit: (n: AnyNode, parent: AnyNode | null) => void | false, parent: AnyNode | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit, parent);
    return;
  }
  if (typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments')) continue;
    const v = node[key];
    if (v && typeof v === 'object') walk(v, visit, node);
  }
}

export interface LocatedElement {
  opening: AnyNode;
  element: AnyNode;
}

export function findElementAt(ast: AnyNode, line: number, column: number): LocatedElement | null {
  let found: LocatedElement | null = null;
  walk(ast.program, (n, parent) => {
    if (found) return false;
    if (n.type === 'JSXOpeningElement' && n.loc.start.line === line && n.loc.start.column === column) {
      found = { opening: n, element: parent };
      return false;
    }
  });
  return found;
}

export function getAttr(opening: AnyNode, name: string): AnyNode | null {
  return opening.attributes.find((a: AnyNode) => a.type === 'JSXAttribute' && a.name?.name === name) ?? null;
}

/** `import styles from './X.module.css'` → { styles: '/abs/X.module.css' } */
export function cssModuleImports(ast: AnyNode, fileAbs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ImportDeclaration' || !/\.module\.(css|scss|sass|less)$/.test(stmt.source.value)) continue;
    for (const spec of stmt.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
        out[spec.local.name] = path.resolve(path.dirname(fileAbs), stmt.source.value);
      }
    }
  }
  return out;
}

export interface ModuleClassRef {
  binding: string;
  className: string;
  conditional: boolean;
  node: AnyNode;
}

export interface StaticClass {
  name: string;
  conditional: boolean;
}

export interface ClassInfo {
  attr: AnyNode | null;
  /** String literal holding the class list, when directly editable. */
  literal: AnyNode | null;
  moduleRefs: ModuleClassRef[];
  staticClasses: StaticClass[];
  dynamic: boolean;
}

function findBinding(ast: AnyNode, name: string, before: number): AnyNode | null {
  let found: AnyNode | null = null;
  walk(ast.program, (n) => {
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.id.name === name && n.start < before && n.init) {
      found = n.init;
    }
  });
  return found;
}

export function analyzeClassName(ast: AnyNode, opening: AnyNode, modules: Record<string, string>): ClassInfo {
  const attr = getAttr(opening, 'className') ?? getAttr(opening, 'class');
  const info: ClassInfo = { attr, literal: null, moduleRefs: [], staticClasses: [], dynamic: false };
  if (!attr || !attr.value) return info;
  const addStatic = (text: string, conditional: boolean) => {
    for (const name of text.split(/\s+/).filter(Boolean)) info.staticClasses.push({ name, conditional });
  };
  const visit = (e: AnyNode, conditional: boolean, depth: number): void => {
    if (!e || depth > 6) return;
    switch (e.type) {
      case 'StringLiteral':
        addStatic(e.value, conditional);
        return;
      case 'TemplateLiteral':
        e.quasis.forEach((q: AnyNode, i: number) => {
          const raw: string = q.value.cooked ?? q.value.raw;
          // A quasi glued to an expression (`btn-${variant}`) is dynamic.
          const gluedEnd = i < e.expressions.length && !/\s$/.test(raw);
          const gluedStart = i > 0 && !/^\s/.test(raw);
          const words = raw.split(/\s+/);
          words.forEach((w, wi) => {
            if (!w) return;
            if ((wi === 0 && gluedStart) || (wi === words.length - 1 && gluedEnd)) {
              info.dynamic = true;
              return;
            }
            info.staticClasses.push({ name: w, conditional });
          });
        });
        e.expressions.forEach((x: AnyNode) => visit(x, conditional, depth + 1));
        return;
      case 'MemberExpression': {
        if (e.object.type === 'Identifier' && modules[e.object.name]) {
          const cls = e.computed ? (e.property.type === 'StringLiteral' ? e.property.value : null) : e.property.name;
          if (cls) info.moduleRefs.push({ binding: e.object.name, className: cls, conditional, node: e });
          else info.dynamic = true;
        } else info.dynamic = true;
        return;
      }
      case 'ConditionalExpression':
        visit(e.consequent, true, depth + 1);
        visit(e.alternate, true, depth + 1);
        return;
      case 'LogicalExpression':
        if (e.operator === '&&') visit(e.right, true, depth + 1);
        else {
          visit(e.left, true, depth + 1);
          visit(e.right, true, depth + 1);
        }
        return;
      case 'CallExpression':
        e.arguments.forEach((a: AnyNode) => visit(a, conditional, depth + 1));
        if (e.callee.type === 'MemberExpression' && e.callee.property?.name === 'join') visit(e.callee.object, conditional, depth + 1);
        return;
      case 'ArrayExpression':
        e.elements.forEach((a: AnyNode) => visit(a, conditional, depth + 1));
        return;
      case 'ObjectExpression':
        for (const p of e.properties) {
          if (p.type !== 'ObjectProperty') continue;
          if (p.computed) visit(p.key, true, depth + 1);
          else addStatic(p.key.type === 'StringLiteral' ? p.key.value : p.key.name, true);
        }
        return;
      case 'Identifier': {
        const init = findBinding(ast, e.name, opening.start);
        if (init) visit(init, conditional, depth + 1);
        else info.dynamic = true;
        return;
      }
      default:
        info.dynamic = true;
    }
  };
  if (attr.value.type === 'StringLiteral') {
    info.literal = attr.value;
    addStatic(attr.value.value, false);
  } else if (attr.value.type === 'JSXExpressionContainer') {
    const ex = attr.value.expression;
    if (ex.type === 'StringLiteral') info.literal = ex;
    visit(ex, false, 0);
  }
  return info;
}

/** Count JSX elements in the file whose className references `binding.cls`. */
export function countModuleClassUsages(ast: AnyNode, binding: string, cls: string): number {
  let n = 0;
  walk(ast.program, (node) => {
    if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && node.object.name === binding) {
      const name = node.computed ? node.property.value : node.property.name;
      if (name === cls) n++;
    }
  });
  return n;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** JSX text is raw; decode the handful of entities people commonly write. */
export function jsxTextValue(node: AnyNode): string {
  return node.value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

export function escapeJsxText(s: string): string {
  return s.replace(/[{}<>]/g, (c) => `{'${c}'}`);
}

export function escapeStringLiteral(s: string, quote: string): string {
  return s.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`).replace(/\n/g, '\\n');
}

// ---------------------------------------------------------------------------
// Inline style objects
// ---------------------------------------------------------------------------

export function camelCase(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** React treats bare numbers as px for these; keep `48` rather than `'48px'`. */
const UNITLESS = new Set(['opacity', 'zIndex', 'fontWeight', 'flexGrow', 'flexShrink', 'order', 'lineHeight']);

export function styleValueLiteral(prop: string, value: string): string {
  const key = camelCase(prop);
  const px = /^(-?\d*\.?\d+)px$/.exec(value);
  if (px && !UNITLESS.has(key)) return px[1];
  if (UNITLESS.has(key) && /^-?\d*\.?\d+$/.test(value)) return value;
  return `'${escapeStringLiteral(value, "'")}'`;
}
