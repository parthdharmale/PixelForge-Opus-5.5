/**
 * Applies an EditState to the live page. The whole state is reconciled on
 * every update (idempotent), so undo/redo can never drift from the DOM:
 *   - style edits compile into one managed <style> element (with media
 *     queries for breakpoint edits, evaluated natively by the iframe)
 *   - text edits patch text nodes in place and remember the originals
 */
import { compileEditCss, cssSelectorForTarget, type EditState, type ElementTarget } from '@pixelforge/core';
import { invalidateRules, siteWinner } from './cascade.ts';

export interface Suppressed {
  key: string;
  property: string;
  media: string;
}

/**
 * Base ("all sizes") edits replace the element's base declaration. Where
 * the site has a width-dependent rule that wins at the current viewport,
 * that rule keeps winning — exactly what happens once the edit is written
 * to the base rule in source. We therefore drop such properties from the
 * live override at this width and report them to the editor.
 */
function withSuppression(state: EditState): { state: EditState; suppressed: Suppressed[] } {
  const suppressed: Suppressed[] = [];
  const cache = new Map<Element, unknown>();
  const styles: EditState['styles'] = {};
  for (const [key, perBp] of Object.entries(state.styles)) {
    const base = perBp.base;
    const target = state.targets[key];
    if (!base || !target) {
      styles[key] = perBp;
      continue;
    }
    const el = resolveTarget(target)[0];
    const kept: Record<string, string> = {};
    for (const [prop, value] of Object.entries(base)) {
      const win = el ? siteWinner(el, prop, cache) : null;
      if (win && win.kind === 'rule' && win.media && /width/.test(win.media) && !win.media.startsWith('@container')) suppressed.push({ key, property: prop, media: win.media });
      else kept[prop] = value;
    }
    styles[key] = { ...perBp, base: kept };
  }
  return { state: { ...state, styles }, suppressed };
}

const originals = new WeakMap<Text, string>();
let touched = new Set<Text>();
let styleEl: HTMLStyleElement | null = null;
let lastState: EditState | null = null;

function ensureStyle(): HTMLStyleElement {
  if (styleEl && styleEl.isConnected) {
    // Keep our sheet last so equal-specificity rules resolve in our favour.
    if (styleEl.nextElementSibling) (document.head ?? document.documentElement).appendChild(styleEl);
    return styleEl;
  }
  styleEl = document.createElement('style');
  styleEl.id = '__pf_edits';
  styleEl.setAttribute('data-pixelforge', 'edits');
  (document.head ?? document.documentElement).appendChild(styleEl);
  return styleEl;
}

export function resolveTarget(t: ElementTarget): Element[] {
  try {
    return Array.from(document.querySelectorAll(cssSelectorForTarget(t)));
  } catch {
    return [];
  }
}

function textNodesOf(el: Element): Text[] {
  return Array.from(el.childNodes).filter((n): n is Text => n.nodeType === Node.TEXT_NODE);
}

export function isTextEditable(el: Element): { editable: boolean; reason?: string } {
  if (['SCRIPT', 'STYLE', 'svg', 'IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'VIDEO', 'CANVAS'].includes(el.tagName)) return { editable: false, reason: 'This element has no editable text' };
  if (el.children.length) return { editable: false, reason: 'Contains nested elements — select a child to edit its text' };
  const text = el.textContent ?? '';
  if (!text.trim()) return { editable: false, reason: 'Element has no text' };
  return { editable: true };
}

function setText(el: Element, value: string, nextTouched: Set<Text>) {
  const nodes = textNodesOf(el);
  if (!nodes.length) {
    const t = document.createTextNode('');
    el.appendChild(t);
    nodes.push(t);
  }
  const [first, ...rest] = nodes;
  for (const n of nodes) if (!originals.has(n)) originals.set(n, n.data);
  if (first.data !== value) first.data = value;
  for (const n of rest) if (n.data !== '') n.data = '';
  nodes.forEach((n) => nextTouched.add(n));
}

export function applyState(state: EditState): { unresolved: string[]; suppressed: Suppressed[] } {
  lastState = state;
  const { state: effective, suppressed } = withSuppression(state);
  const css = compileEditCss(effective);
  const el = ensureStyle();
  if (el.textContent !== css) {
    el.textContent = css;
    invalidateRules();
  }
  const unresolved: string[] = [];
  const nextTouched = new Set<Text>();
  for (const [key, t] of Object.entries(state.text)) {
    const target = state.targets[key];
    const els = target ? resolveTarget(target) : [];
    if (!els.length) unresolved.push(key);
    els.forEach((e) => setText(e, t.value, nextTouched));
  }
  for (const key of Object.keys(state.styles)) {
    const target = state.targets[key];
    if (!target || !resolveTarget(target).length) unresolved.push(key);
  }
  // Restore text nodes that are no longer edited.
  for (const n of touched) {
    if (!nextTouched.has(n)) {
      const orig = originals.get(n);
      if (orig !== undefined && n.data !== orig) n.data = orig;
    }
  }
  touched = nextTouched;
  return { unresolved, suppressed };
}

/** Re-apply after the page itself re-rendered (e.g. React replaced text). */
export function reapply(): ReturnType<typeof applyState> | null {
  return lastState ? applyState(lastState) : null;
}

export function currentState(): EditState | null {
  return lastState;
}

export function isOwnTextNode(n: Node): boolean {
  return n.nodeType === Node.TEXT_NODE && touched.has(n as Text);
}
