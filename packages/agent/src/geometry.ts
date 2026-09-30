import type { Edges, Geometry, Point, Rect } from '@pixelforge/core';
import { idOf } from './registry.ts';
import { labelFor } from './selector.ts';

const VOID = new Set(['IMG', 'INPUT', 'BR', 'HR', 'AREA', 'BASE', 'COL', 'EMBED', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR', 'TEXTAREA', 'SELECT', 'IFRAME', 'VIDEO', 'CANVAS', 'svg']);

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function edges(cs: CSSStyleDeclaration, prefix: string, suffix = ''): Edges {
  return {
    top: px(cs.getPropertyValue(`${prefix}-top${suffix}`)),
    right: px(cs.getPropertyValue(`${prefix}-right${suffix}`)),
    bottom: px(cs.getPropertyValue(`${prefix}-bottom${suffix}`)),
    left: px(cs.getPropertyValue(`${prefix}-left${suffix}`)),
  };
}

function hasTransform(cs: CSSStyleDeclaration): boolean {
  return (cs.transform && cs.transform !== 'none') || (cs.rotate && cs.rotate !== 'none') || (cs.scale && cs.scale !== 'none') || (cs.translate && cs.translate !== 'none') || false;
}

export function isTransformed(el: Element): boolean {
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    if (hasTransform(getComputedStyle(cur))) return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Exact border-box corners of a transformed element. We insert four
 * zero-size absolutely positioned probes at the corners; they inherit every
 * ancestor transform, so their client rects are the transformed corners.
 * The DOM is restored synchronously, before the browser paints.
 */
function measureQuad(el: HTMLElement, border: Edges): [Point, Point, Point, Point] | null {
  if (VOID.has(el.tagName) || el instanceof SVGElement) return null;
  const cs = getComputedStyle(el);
  const prevPosition = el.style.getPropertyValue('position');
  const prevPriority = el.style.getPropertyPriority('position');
  const needsPosition = cs.position === 'static' && !hasTransform(cs);
  if (needsPosition) el.style.setProperty('position', 'relative', 'important');
  const corners: Array<[string, string]> = [
    [`${-border.left}px`, `${-border.top}px`],
    [`calc(100% + ${border.right}px)`, `${-border.top}px`],
    [`calc(100% + ${border.right}px)`, `calc(100% + ${border.bottom}px)`],
    [`${-border.left}px`, `calc(100% + ${border.bottom}px)`],
  ];
  const probes = corners.map(([left, top]) => {
    const p = document.createElement('div');
    p.setAttribute('data-pixelforge', 'probe');
    p.style.cssText = `position:absolute!important;left:${left}!important;top:${top}!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;transform:none!important;display:block!important;`;
    el.appendChild(p);
    return p;
  });
  const pts = probes.map((p) => {
    const r = p.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }) as [Point, Point, Point, Point];
  probes.forEach((p) => p.remove());
  if (needsPosition) {
    if (prevPosition) el.style.setProperty('position', prevPosition, prevPriority);
    else el.style.removeProperty('position');
  }
  return pts;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const bt = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || bt <= y) return null;
  return { x, y, width: r - x, height: bt - y };
}

/** Visible part of `rect` after clipping by overflow ancestors and the viewport. */
function clipRect(el: Element, rect: Rect, position: string): Rect | null {
  let clip: Rect | null = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  let visible: Rect | null = intersect(rect, clip) ?? null;
  if (position === 'fixed') return visible;
  let cur = el.parentElement;
  while (cur && cur !== document.body && cur !== document.documentElement && visible) {
    const cs = getComputedStyle(cur);
    if (cs.position === 'fixed') break;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const r = cur.getBoundingClientRect();
      clip = { x: r.left, y: r.top, width: r.width, height: r.height };
      visible = intersect(visible, clip);
    }
    cur = cur.parentElement;
  }
  return visible;
}

export function measure(el: Element): Geometry {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const rect = { x: r.left, y: r.top, width: r.width, height: r.height };
  const border = edges(cs, 'border', '-width');
  const transformed = isTransformed(el);
  const quad = transformed && el instanceof HTMLElement ? measureQuad(el, border) : null;
  const parentCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
  return {
    nodeId: idOf(el),
    rect,
    quad,
    margin: edges(cs, 'margin'),
    padding: edges(cs, 'padding'),
    border,
    label: labelFor(el),
    clip: clipRect(el, rect, cs.position),
    position: cs.position,
    display: cs.display,
    parentDisplay: parentCs?.display ?? 'block',
  };
}

export function boxOf(el: Element) {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    margin: edges(cs, 'margin'),
    padding: edges(cs, 'padding'),
    border: edges(cs, 'border', '-width'),
    width: r.width,
    height: r.height,
  };
}
