import { BREAKPOINT_ORDER, getBreakpoint, type BreakpointId } from './breakpoints.ts';

/** Location of a JSX element in the source project (1-based line, 0-based column). */
export interface SourceLoc {
  file: string;
  line: number;
  column: number;
}

export function formatSourceLoc(loc: SourceLoc): string {
  return `${loc.file}:${loc.line}:${loc.column}`;
}

export function parseSourceLoc(value: string | null | undefined): SourceLoc | null {
  if (!value) return null;
  const m = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
}

/**
 * Identity of an edited element.
 *
 * - `source` scope: every element rendered from the same JSX location
 *   (all instances of a repeated component). This is what a source edit
 *   naturally affects, so it is the default when a source location exists.
 * - `instance` scope: one specific DOM element, identified by a unique
 *   CSS selector. Used when there is no source mapping (public URLs) or
 *   when the user explicitly narrows an edit to one instance.
 */
export interface ElementTarget {
  key: string;
  scope: 'source' | 'instance';
  selector: string;
  src: SourceLoc | null;
  label: string;
  component: string | null;
  /** Number of instances rendered from `src` when the target was created. */
  instanceCount: number;
}

export function targetKey(scope: ElementTarget['scope'], selector: string, src: SourceLoc | null): string {
  if (scope === 'source' && src) return `src:${formatSourceLoc(src)}`;
  return `sel:${selector}`;
}

export function makeTarget(input: Omit<ElementTarget, 'key'>): ElementTarget {
  const scope = input.scope === 'source' && !input.src ? 'instance' : input.scope;
  return { ...input, scope, key: targetKey(scope, input.selector, input.src) };
}

/** CSS selector used to apply live edits for a target inside the page. */
export function cssSelectorForTarget(t: ElementTarget): string {
  if (t.scope === 'source' && t.src) return `[data-pf-src="${cssEscapeAttr(formatSourceLoc(t.src))}"]`;
  return t.selector;
}

function cssEscapeAttr(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export interface StyleOp {
  type: 'style';
  target: ElementTarget;
  breakpoint: BreakpointId;
  property: string;
  /** New value; null removes the editor override. */
  value: string | null;
}

export interface TextOp {
  type: 'text';
  target: ElementTarget;
  /** New text; null restores the original text. */
  value: string | null;
  /** The element's text before any editor change (needed for source mapping). */
  original: string;
}

export type EditOp = StyleOp | TextOp;

/** An op plus the prior value, making it invertible. */
export interface Change {
  op: EditOp;
  before: string | null;
}

export type ChangeSource = 'manual' | 'canvas' | 'ai' | 'system';

/** A meaningful user operation: the unit of undo/redo. */
export interface Transaction {
  id: string;
  label: string;
  source: ChangeSource;
  timestamp: number;
  changes: Change[];
  /** Consecutive transactions with the same key (within a window) merge. */
  coalesceKey?: string;
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Edit state
// ---------------------------------------------------------------------------

export type StyleMap = Record<string, string>;

export interface EditState {
  targets: Record<string, ElementTarget>;
  styles: Record<string, Partial<Record<BreakpointId, StyleMap>>>;
  text: Record<string, { value: string; original: string }>;
}

export function emptyState(): EditState {
  return { targets: {}, styles: {}, text: {} };
}

export function getStyle(state: EditState, key: string, bp: BreakpointId, prop: string): string | null {
  return state.styles[key]?.[bp]?.[prop] ?? null;
}

export function getText(state: EditState, key: string): string | null {
  return state.text[key]?.value ?? null;
}

/** Current value in `state` for the slot an op writes to. */
export function currentValue(state: EditState, op: EditOp): string | null {
  if (op.type === 'style') return getStyle(state, op.target.key, op.breakpoint, op.property);
  return getText(state, op.target.key);
}

/** Pair an op with the value it will replace so it can be undone. */
export function toChange(state: EditState, op: EditOp): Change {
  return { op, before: currentValue(state, op) };
}

/** Write `value` into the slot addressed by `op`. Pure; returns a new state. */
function writeSlot(state: EditState, op: EditOp, value: string | null): EditState {
  const key = op.target.key;
  const next: EditState = {
    targets: { ...state.targets, [key]: state.targets[key] ?? op.target },
    styles: state.styles,
    text: state.text,
  };
  if (op.type === 'style') {
    const perTarget = { ...(state.styles[key] ?? {}) };
    const map = { ...(perTarget[op.breakpoint] ?? {}) };
    if (value === null) delete map[op.property];
    else map[op.property] = value;
    if (Object.keys(map).length) perTarget[op.breakpoint] = map;
    else delete perTarget[op.breakpoint];
    const styles = { ...state.styles };
    if (Object.keys(perTarget).length) styles[key] = perTarget;
    else delete styles[key];
    next.styles = styles;
  } else {
    const text = { ...state.text };
    const original = state.text[key]?.original ?? op.original;
    if (value === null || value === original) delete text[key];
    else text[key] = { value, original };
    next.text = text;
  }
  // Garbage-collect targets with no remaining edits.
  if (!next.styles[key] && !next.text[key]) {
    const targets = { ...next.targets };
    delete targets[key];
    next.targets = targets;
  }
  return next;
}

export function applyChange(state: EditState, change: Change): EditState {
  return writeSlot(state, change.op, change.op.value);
}

export function revertChange(state: EditState, change: Change): EditState {
  return writeSlot(state, change.op, change.before);
}

export function applyTransaction(state: EditState, tx: Transaction): EditState {
  return tx.changes.reduce(applyChange, state);
}

export function revertTransaction(state: EditState, tx: Transaction): EditState {
  return [...tx.changes].reverse().reduce(revertChange, state);
}

/** Build a transaction from ops against a state, capturing `before` values. */
export function buildTransaction(
  state: EditState,
  ops: EditOp[],
  init: Omit<Transaction, 'changes' | 'id' | 'timestamp'> & Partial<Pick<Transaction, 'id' | 'timestamp'>>,
): Transaction {
  let s = state;
  const changes: Change[] = [];
  for (const op of ops) {
    const change = toChange(s, op);
    changes.push(change);
    s = applyChange(s, change);
  }
  return {
    id: init.id ?? randomId(),
    timestamp: init.timestamp ?? Date.now(),
    label: init.label,
    source: init.source,
    coalesceKey: init.coalesceKey,
    meta: init.meta,
    changes,
  };
}

export function slotId(op: EditOp): string {
  return op.type === 'style' ? `${op.target.key}|${op.breakpoint}|${op.property}` : `${op.target.key}|text`;
}

/**
 * Merge `b` into `a`: for each slot keep the earliest `before` and the
 * latest value. Changes that end where they started are dropped.
 */
export function mergeTransactions(a: Transaction, b: Transaction): Transaction {
  const order: string[] = [];
  const bySlot = new Map<string, Change>();
  for (const c of [...a.changes, ...b.changes]) {
    const id = slotId(c.op);
    const prev = bySlot.get(id);
    if (!prev) {
      order.push(id);
      bySlot.set(id, c);
    } else bySlot.set(id, { op: c.op, before: prev.before });
  }
  const changes = order.map((id) => bySlot.get(id)!).filter((c) => c.before !== c.op.value);
  return { ...a, label: b.label, timestamp: b.timestamp, changes };
}

export function isNoop(tx: Transaction): boolean {
  return tx.changes.every((c) => c.before === c.op.value);
}

let counter = 0;
export function randomId(): string {
  counter = (counter + 1) % 1e6;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// Compilation to CSS (live preview + URL-mode overrides)
// ---------------------------------------------------------------------------

export interface CompileOptions {
  important?: boolean;
  /** Override selector generation (e.g. for URL-mode exports). */
  selectorFor?: (t: ElementTarget) => string;
}

/**
 * Compile style edits into a stylesheet. Base edits come first, then
 * tablet, then mobile, so narrower breakpoints win in the cascade exactly
 * as they would in the generated source.
 */
export function compileEditCss(state: EditState, opts: CompileOptions = {}): string {
  const imp = opts.important ?? true ? ' !important' : '';
  const selectorFor = opts.selectorFor ?? cssSelectorForTarget;
  const blocks: string[] = [];
  for (const bp of BREAKPOINT_ORDER) {
    const rules: string[] = [];
    for (const [key, perBp] of Object.entries(state.styles)) {
      const map = perBp[bp];
      const target = state.targets[key];
      if (!map || !target || !Object.keys(map).length) continue;
      const decls = Object.entries(map)
        .map(([prop, value]) => `  ${prop}: ${value}${imp};`)
        .join('\n');
      rules.push(`${selectorFor(target)} {\n${decls}\n}`);
    }
    if (!rules.length) continue;
    const media = getBreakpoint(bp).media;
    blocks.push(media ? `@media ${media} {\n${rules.map(indent).join('\n')}\n}` : rules.join('\n'));
  }
  return blocks.join('\n\n');
}

function indent(s: string): string {
  return s
    .split('\n')
    .map((l) => (l ? `  ${l}` : l))
    .join('\n');
}

/** Flatten an edit state into a list of ops that recreate it from empty. */
export function stateToOps(state: EditState): EditOp[] {
  const ops: EditOp[] = [];
  for (const [key, perBp] of Object.entries(state.styles)) {
    const target = state.targets[key];
    if (!target) continue;
    for (const bp of BREAKPOINT_ORDER) {
      for (const [property, value] of Object.entries(perBp[bp] ?? {})) {
        ops.push({ type: 'style', target, breakpoint: bp, property, value });
      }
    }
  }
  for (const [key, t] of Object.entries(state.text)) {
    const target = state.targets[key];
    if (target) ops.push({ type: 'text', target, value: t.value, original: t.original });
  }
  return ops;
}

export function countEdits(state: EditState): number {
  let n = Object.keys(state.text).length;
  for (const perBp of Object.values(state.styles)) for (const m of Object.values(perBp)) n += Object.keys(m ?? {}).length;
  return n;
}

/** Layer `overlay` (e.g. a pending AI proposal) on top of `base`. */
export function overlayStates(base: EditState, overlay: EditState): EditState {
  let s = base;
  for (const op of stateToOps(overlay)) s = applyChange(s, toChange(s, op));
  return s;
}
