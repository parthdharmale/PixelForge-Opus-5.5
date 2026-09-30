/**
 * Compile-time DOM-to-source instrumentation.
 *
 * Every host JSX element (lowercase tag) gets a `data-pf-src` attribute
 * holding `file:line:column` of its opening tag. The edit is done with
 * magic-string on the original text, so the rest of the file (and its
 * source map) is untouched. Component elements (`<Card />`) are not
 * annotated because their props may not reach the DOM; their host
 * children carry the location instead, and the runtime agent recovers
 * component names from React fibers.
 */
import { parse } from '@babel/parser';
import MagicString from 'magic-string';

export const SRC_ATTR = 'data-pf-src';

interface Node {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number; column: number } } | null;
  [key: string]: unknown;
}

export function walk(node: unknown, visit: (n: Node, parent: Node | null) => void, parent: Node | null = null): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== 'string') return;
  visit(n, parent);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const v = n[key];
    if (v && typeof v === 'object') walk(v, visit, n);
  }
}

export interface InstrumentResult {
  code: string;
  map: ReturnType<MagicString['generateMap']>;
  count: number;
}

export function instrumentSource(code: string, relPath: string): InstrumentResult | null {
  if (!code.includes('<')) return null;
  let ast;
  try {
    ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true });
  } catch {
    return null;
  }
  const s = new MagicString(code);
  let count = 0;
  walk(ast.program, (n) => {
    if (n.type !== 'JSXOpeningElement') return;
    const name = n.name as Node & { name?: string };
    if (name.type !== 'JSXIdentifier' || !name.name || !/^[a-z]/.test(name.name)) return;
    const attrs = (n.attributes as Array<Node & { name?: { name?: string } }>) ?? [];
    if (attrs.some((a) => a.type === 'JSXAttribute' && a.name?.name === SRC_ATTR)) return;
    const loc = n.loc!.start;
    s.appendLeft(name.end!, ` ${SRC_ATTR}="${relPath}:${loc.line}:${loc.column}"`);
    count++;
  });
  if (!count) return null;
  return { code: s.toString(), map: s.generateMap({ hires: true, source: relPath }), count };
}
