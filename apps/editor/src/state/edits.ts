/**
 * Builders that turn UI gestures into ops/transactions. All edits —
 * panel, canvas handles, keyboard, AI — go through these functions and
 * therefore through the same history.
 */
import {
  buildTransaction,
  expandShorthand,
  makeTarget,
  normalizeValue,
  type BreakpointId,
  type EditOp,
  type ElementDetails,
  type ElementTarget,
  type ChangeSource,
} from '@pixelforge/core';
import { useEditor } from './store';

export function targetFor(d: ElementDetails, scope = useEditor.getState().instanceScope): ElementTarget {
  if (!d.src && d.group && scope === 'source') {
    return makeTarget({ scope: 'instance', selector: d.group.selector, src: null, label: d.label, component: d.components[0] ?? null, instanceCount: d.group.count });
  }
  const useSource = !!d.src && (scope === 'source' || d.instanceCount <= 1);
  return makeTarget({
    scope: useSource ? 'source' : 'instance',
    selector: d.selector,
    src: d.src,
    label: d.label,
    component: d.components[0] ?? null,
    instanceCount: d.instanceCount,
  });
}

/** Text edits always address the specific instance (text often comes from data). */
export function textTargetFor(d: ElementDetails): ElementTarget {
  return makeTarget({ scope: d.instanceCount > 1 ? 'instance' : 'source', selector: d.selector, src: d.src, label: d.label, component: d.components[0] ?? null, instanceCount: d.instanceCount });
}

function label(prop: string): string {
  const base = prop.replace(/-/g, ' ');
  if (/^padding-/.test(prop)) return 'padding';
  if (/^margin-/.test(prop)) return 'margin';
  if (/radius$/.test(prop)) return 'border radius';
  if (/^border-.*-(width|style|color)$/.test(prop)) return 'border';
  return base.toLowerCase();
}

export interface StyleEditOptions {
  breakpoint?: BreakpointId;
  source?: ChangeSource;
  label?: string;
  coalesce?: boolean;
  details?: ElementDetails;
}

export function styleOps(values: Record<string, string | null>, opts: StyleEditOptions = {}): EditOp[] {
  const s = useEditor.getState();
  const d = opts.details ?? s.details;
  if (!d) return [];
  const target = targetFor(d);
  const breakpoint = opts.breakpoint ?? s.editBreakpoint;
  const ops: EditOp[] = [];
  for (const [prop, raw] of Object.entries(values)) {
    const value = raw === null ? null : normalizeValue(prop, raw);
    const expanded = value === null ? null : expandShorthand(prop, value);
    if (expanded) for (const [p, v] of Object.entries(expanded)) ops.push({ type: 'style', target, breakpoint, property: p, value: v });
    else ops.push({ type: 'style', target, breakpoint, property: prop, value });
  }
  return ops;
}

/** Commit style changes on the selected element. */
export function setStyles(values: Record<string, string | null>, opts: StyleEditOptions = {}) {
  const s = useEditor.getState();
  const ops = styleOps(values, opts);
  if (!ops.length) return;
  const props = Object.keys(values);
  const d = opts.details ?? s.details!;
  const verb = Object.values(values).every((v) => v === null) ? 'Reset' : 'Change';
  const txLabel = opts.label ?? `${verb} ${[...new Set(props.map(label))].join(', ')} · ${d.label}`;
  const tx = buildTransaction(s.history.present, ops, {
    label: txLabel,
    source: opts.source ?? 'manual',
    coalesceKey: opts.coalesce === false ? undefined : `${d.selector}|${props.join(',')}|${opts.breakpoint ?? s.editBreakpoint}`,
  });
  s.commitTx(tx);
}

export function setText(details: ElementDetails, value: string, source: ChangeSource = 'manual') {
  const s = useEditor.getState();
  const target = textTargetFor(details);
  const original = s.history.present.text[target.key]?.original ?? details.text.value;
  const tx = buildTransaction(s.history.present, [{ type: 'text', target, value, original }], {
    label: `Edit text · ${details.label}`,
    source,
    coalesceKey: `text|${target.key}`,
  });
  s.commitTx(tx);
}

/** Live (uncommitted) preview for continuous gestures such as dragging. */
export function previewStyles(values: Record<string, string>, details: ElementDetails) {
  const s = useEditor.getState();
  const ops = styleOps(values, { details });
  let state = s.history.present;
  const tx = buildTransaction(state, ops, { label: 'preview', source: 'canvas' });
  for (const c of tx.changes) {
    const op = c.op;
    if (op.type !== 'style') continue;
    const per = { ...(state.styles[op.target.key] ?? {}) };
    per[op.breakpoint] = { ...(per[op.breakpoint] ?? {}), [op.property]: op.value! };
    state = { ...state, targets: { ...state.targets, [op.target.key]: op.target }, styles: { ...state.styles, [op.target.key]: per } };
  }
  s.set({ livePreview: state });
}

export function commitPreview(values: Record<string, string>, details: ElementDetails, label: string) {
  setStyles(values, { details, source: 'canvas', label, coalesce: false });
  useEditor.getState().set({ livePreview: null });
}

/** Value currently set by the editor for a property at the active breakpoint. */
export function editedValue(prop: string, bp?: BreakpointId): string | null {
  const s = useEditor.getState();
  if (!s.details) return null;
  const key = targetFor(s.details).key;
  return s.history.present.styles[key]?.[bp ?? s.editBreakpoint]?.[prop] ?? null;
}
