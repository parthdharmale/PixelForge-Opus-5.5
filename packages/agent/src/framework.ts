/**
 * Framework metadata. For React we read the fiber attached to each host
 * element (development and production builds both expose it) to recover
 * component names and boundaries. This complements the compile-time
 * `data-pf-src` attributes: those say *where* an element is written, the
 * fiber says *which components* it belongs to.
 */

interface Fiber {
  tag: number;
  type: unknown;
  return: Fiber | null;
  child: Fiber | null;
  alternate: Fiber | null;
  stateNode: unknown;
}

const HOST_TAGS = new Set([5, 26, 27]); // HostComponent, HostHoistable, HostSingleton
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]); // Function, Class, ForwardRef, Memo, SimpleMemo

let fiberKey: string | null = null;

function fiberOf(el: Element): Fiber | null {
  if (fiberKey && fiberKey in el) return (el as unknown as Record<string, Fiber>)[fiberKey];
  for (const k of Object.keys(el)) {
    if (k.startsWith('__reactFiber$')) {
      fiberKey = k;
      return (el as unknown as Record<string, Fiber>)[k];
    }
  }
  return null;
}

function nameOf(f: Fiber): string | null {
  const t = f.type as { displayName?: string; name?: string; render?: { displayName?: string; name?: string }; type?: { displayName?: string; name?: string } } | null;
  if (!t) return null;
  const n = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name || null;
  if (!n || n === 'Anonymous' || n.startsWith('_')) return null;
  return n;
}

function firstHost(f: Fiber | null): Fiber | null {
  let cur = f;
  while (cur) {
    if (HOST_TAGS.has(cur.tag)) return cur;
    cur = cur.child;
  }
  return null;
}

/** Components whose rendered output begins with this element, innermost first. */
export function componentsRootedAt(el: Element): string[] {
  const fiber = fiberOf(el);
  if (!fiber) return [];
  const out: string[] = [];
  let cur = fiber.return;
  while (cur && !HOST_TAGS.has(cur.tag) && cur.tag !== 3) {
    // The DOM node may point at either the current fiber or its alternate
    // (e.g. after a Fast Refresh), so accept both.
    const host = COMPONENT_TAGS.has(cur.tag) ? firstHost(cur) : null;
    if (host && (host === fiber || host === fiber.alternate || host.alternate === fiber)) {
      const n = nameOf(cur);
      if (n && !out.includes(n)) out.push(n);
    }
    cur = cur.return;
  }
  return out;
}

/** Full component ancestry for an element, innermost first. */
export function componentStack(el: Element, limit = 12): string[] {
  const fiber = fiberOf(el);
  if (!fiber) return [];
  const out: string[] = [];
  let cur = fiber.return;
  while (cur && out.length < limit) {
    if (COMPONENT_TAGS.has(cur.tag)) {
      const n = nameOf(cur);
      if (n && out[out.length - 1] !== n) out.push(n);
    }
    cur = cur.return;
  }
  return out;
}

export function detectFramework(): string | null {
  const w = window as unknown as Record<string, unknown>;
  const root = document.body?.querySelector('*');
  if (root && fiberOf(root)) return 'react';
  const any = document.querySelector('[data-reactroot], #root, #__next');
  if (any && (fiberOf(any) || Object.keys(any).some((k) => k.startsWith('__reactContainer$')))) return 'react';
  if (w.__NEXT_DATA__) return 'next';
  if (w.__VUE__ || document.querySelector('[data-v-app]')) return 'vue';
  if (document.querySelector('[ng-version]')) return 'angular';
  if (document.querySelector('[class*="svelte-"]')) return 'svelte';
  return null;
}
