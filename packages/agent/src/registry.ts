/**
 * Stable numeric ids for DOM elements. Ids live as long as the element does
 * (WeakMap), so selection survives style edits and re-layouts. When the page
 * replaces a node (re-render, HMR), the editor re-resolves its selection via
 * selector / source location.
 */
const ids = new WeakMap<Element, number>();
const nodes = new Map<number, WeakRef<Element>>();
let nextId = 1;

export function idOf(el: Element): number {
  let id = ids.get(el);
  if (!id) {
    id = nextId++;
    ids.set(el, id);
    nodes.set(id, new WeakRef(el));
  }
  return id;
}

export function elementById(id: number | null | undefined): Element | null {
  if (!id) return null;
  const el = nodes.get(id)?.deref() ?? null;
  if (el && !el.isConnected) return null;
  return el;
}

/** Elements that belong to PixelForge itself and must be invisible to the user. */
export function isInternal(el: Element): boolean {
  return el.hasAttribute('data-pixelforge') || el.id === '__pf_edits';
}

export function sweep(): void {
  for (const [id, ref] of nodes) if (!ref.deref()) nodes.delete(id);
}
