import type { ContextNode, TreeNode } from '@pixelforge/core';
import { componentsRootedAt } from './framework.ts';
import { idOf, isInternal } from './registry.ts';
import { labelFor, similarGroup, uniqueSelector } from './selector.ts';
import { isTextEditable } from './editLayer.ts';

const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'BASE']);
const MAX_NODES = 5000;

export function isInspectable(el: Element): boolean {
  return !SKIP.has(el.tagName) && !isInternal(el);
}

function directText(el: Element): string | null {
  let t = '';
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE) t += n.textContent;
  t = t.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 80) : null;
}

export function srcCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  document.querySelectorAll('[data-pf-src]').forEach((e) => {
    const s = e.getAttribute('data-pf-src')!;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  });
  return counts;
}

export function buildTree(): TreeNode {
  let budget = MAX_NODES;
  const counts = srcCounts();
  const visit = (el: Element): TreeNode => {
    budget--;
    const kids = Array.from(el.children).filter(isInspectable);
    const isSvg = el.tagName.toLowerCase() === 'svg';
    const children = isSvg || budget <= 0 ? [] : kids.map((k) => (budget > 0 ? visit(k) : null)).filter((n): n is TreeNode => !!n);
    const src = el.getAttribute('data-pf-src');
    const rects = el.getClientRects();
    return {
      id: idOf(el),
      tag: el.tagName.toLowerCase(),
      idAttr: el.id || null,
      classes: Array.from(el.classList).slice(0, 4),
      components: componentsRootedAt(el),
      src,
      text: directText(el),
      childCount: kids.length,
      children,
      repeat: src ? counts.get(src) ?? 1 : 1,
      hidden: rects.length === 0,
    };
  };
  return visit(document.body ?? document.documentElement);
}

const CONTEXT_PROPS = [
  'display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'row-gap', 'column-gap', 'grid-template-columns',
  'width', 'max-width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color',
  'background-color', 'background-image', 'border-top-width', 'border-top-style', 'border-top-color', 'border-top-left-radius', 'box-shadow', 'opacity',
];

/** Compact subtree snapshot for AI providers (bounded size). */
export function buildContext(root: Element, maxDepth = 4, maxNodes = 160): ContextNode {
  let n = 0;
  const counts = srcCounts();
  const visit = (el: Element, depth: number, parentStyles: Record<string, string> | null): ContextNode => {
    const ref = `n${n++}`;
    const cs = getComputedStyle(el);
    const styles: Record<string, string> = {};
    for (const p of CONTEXT_PROPS) {
      const v = cs.getPropertyValue(p).trim();
      if (!v || v === 'none' || v === 'normal' || v === 'auto' || v === '0px' || v === 'rgba(0, 0, 0, 0)') continue;
      // Skip inherited-and-unchanged typography to keep context small.
      if (parentStyles && ['font-family', 'color', 'line-height', 'letter-spacing', 'text-align'].includes(p) && parentStyles[p] === v) continue;
      styles[p] = v;
    }
    const r = el.getBoundingClientRect();
    const src = el.getAttribute('data-pf-src');
    const kids = depth < maxDepth ? Array.from(el.children).filter(isInspectable) : [];
    const group = src ? null : similarGroup(el);
    const node: ContextNode = {
      ref,
      ...(group ? { groupSelector: group.selector, groupCount: group.count } : {}),
      nodeId: idOf(el),
      tag: el.tagName.toLowerCase(),
      label: labelFor(el),
      selector: uniqueSelector(el),
      src,
      instanceCount: src ? counts.get(src) ?? 1 : 1,
      text: isTextEditable(el).editable ? (el.textContent ?? '').trim().slice(0, 200) : directText(el),
      textEditable: isTextEditable(el).editable,
      styles,
      rect: { width: Math.round(r.width), height: Math.round(r.height) },
      ...(cs.display === 'none' ? { hidden: true, styles: { ...styles, display: 'none' } } : {}),
      children: [],
    };
    const full = { ...(parentStyles ?? {}), ...styles };
    for (const k of kids) {
      if (n >= maxNodes) break;
      // Hidden elements are included (flagged) so the AI can reveal them,
      // e.g. navigation links collapsed behind a menu on mobile.
      if (cs.display !== 'none' && k.getClientRects().length === 0 && getComputedStyle(k).display !== 'none') continue;
      node.children.push(visit(k, depth + 1, full));
    }
    return node;
  };
  return visit(root, 0, null);
}
