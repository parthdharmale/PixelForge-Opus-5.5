/**
 * PixelForge in-page agent. Injected into the inspected page (by the proxy
 * for public URLs, by the Vite plugin for source projects). It owns
 * everything that needs direct DOM access and talks to the editor via a
 * postMessage RPC, so it works across origins.
 */
import {
  PF_CHANNEL,
  TRACKED_PROPERTIES,
  isRpcMessage,
  parseSourceLoc,
  type AgentEventName,
  type AgentEvents,
  type AgentMethods,
  type EditState,
  type ElementDetails,
  type Geometry,
  type PageInfo,
  type RpcRequest,
} from '@pixelforge/core';
import { explain, invalidateRules, setProjectRoot, unreadableSheetCount } from './cascade.ts';
import { applyState, isTextEditable, reapply, resolveTarget } from './editLayer.ts';
import { componentStack, componentsRootedAt, detectFramework } from './framework.ts';
import { boxOf, isTransformed, measure } from './geometry.ts';
import { elementById, idOf, isInternal, sweep } from './registry.ts';
import { labelFor, similarGroup, uniqueSelector } from './selector.ts';
import { buildContext, buildTree, isInspectable, srcCounts } from './tree.ts';

declare global {
  interface Window {
    __PF_CONFIG__?: { root?: string | null; mode?: string };
    __PIXELFORGE__?: unknown;
  }
}

(function main() {
  if (window.__PIXELFORGE__) return;
  const config = window.__PF_CONFIG__ ?? {};
  setProjectRoot(config.root ?? null);

  let role: 'editor' | 'original' = 'editor';
  let mode: 'select' | 'interact' = 'select';
  let hovered: Element | null = null;
  let selected: Element | null = null;
  let editing: HTMLElement | null = null;
  let syncScroll = false;
  const embedded = window.parent !== window;

  function emit<E extends AgentEventName>(event: E, data: AgentEvents[E]) {
    if (!embedded) return;
    window.parent.postMessage({ channel: PF_CHANNEL, kind: 'event', event, data }, '*');
  }

  function geom(el: Element | null): Geometry | null {
    if (!el || !el.isConnected) return null;
    try {
      return measure(el);
    } catch {
      return null;
    }
  }

  // --- geometry streaming -------------------------------------------------
  let frame = 0;
  let lastSig = '';
  function scheduleGeometry(force = false) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const h = mode === 'select' ? geom(hovered) : null;
      const s = geom(selected);
      const sig = JSON.stringify([h?.rect, h?.clip, s?.rect, s?.clip, s?.quad, s?.padding, s?.margin]);
      if (!force && sig === lastSig) return;
      lastSig = sig;
      emit('geometry', { hover: h, selected: s });
    });
  }
  window.addEventListener('scroll', () => {
    scheduleGeometry();
    if (syncScroll) emit('scroll', { x: window.scrollX, y: window.scrollY });
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => {
    invalidateRules();
    const res = reapply();
    if (res) emit('applied', res);
    scheduleGeometry(true);
  });
  // Animations and late layout shifts: cheap periodic check (signature-deduped).
  setInterval(() => scheduleGeometry(), 250);

  // --- DOM change tracking --------------------------------------------------
  let treeTimer = 0;
  let textTimer = 0;
  const observer = new MutationObserver((records) => {
    let structural = false;
    let styles = false;
    let text = false;
    for (const r of records) {
      const t = r.target as Element;
      if (t.nodeType === 1 && isInternal(t)) continue;
      if (r.type === 'childList') {
        const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
        if (nodes.every((n) => n.nodeType === 1 && isInternal(n as Element))) continue;
        if (nodes.some((n) => n.nodeName === 'STYLE' || n.nodeName === 'LINK')) styles = true;
        structural = true;
      }
      if (r.type === 'characterData') {
        if ((r.target.parentNode as Element | null)?.tagName === 'STYLE') styles = true;
        else text = true;
      }
    }
    if (styles) invalidateRules();
    if (text && !structural && !editing) {
      clearTimeout(textTimer);
      textTimer = window.setTimeout(reapply, 50);
    }
    if (structural) {
      if (selected && !selected.isConnected) selected = null;
      clearTimeout(treeTimer);
      treeTimer = window.setTimeout(() => {
        sweep();
        reapply();
        emit('treeChanged', {});
      }, 250);
    }
    scheduleGeometry();
  });

  // --- pointer & keyboard ---------------------------------------------------
  function pickTarget(e: Event): Element | null {
    const path = e.composedPath();
    for (const n of path) if (n instanceof Element && isInspectable(n) && n !== document.documentElement) return n;
    return null;
  }

  const blocked = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu', 'auxclick', 'submit', 'touchstart', 'touchend'];
  for (const type of blocked) {
    window.addEventListener(
      type,
      (e) => {
        if (mode !== 'select' || role !== 'editor') return;
        if (editing && editing.contains(e.target as Node)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type === 'click') {
          const el = pickTarget(e);
          if (!el) return;
          selected = el;
          emit('select', { nodeId: idOf(el), geometry: geom(el), shift: (e as MouseEvent).shiftKey });
          scheduleGeometry(true);
        } else if (type === 'dblclick') {
          const el = pickTarget(e);
          if (el) startTextEdit(el);
        }
      },
      { capture: true },
    );
  }

  window.addEventListener(
    'pointermove',
    (e) => {
      if (mode !== 'select' || role !== 'editor') return;
      const el = pickTarget(e);
      if (el !== hovered) {
        hovered = el;
        emit('hover', { geometry: geom(el) });
      }
    },
    { capture: true, passive: true },
  );
  document.addEventListener('pointerleave', () => {
    hovered = null;
    emit('hover', { geometry: null });
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (role !== 'editor') return;
      if (editing) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const combo = e.metaKey || e.ctrlKey;
      if (mode === 'interact' && !combo && e.key !== 'Escape') return;
      if (typing && !combo) return;
      emit('key', { key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
      if (mode === 'select' || combo) e.preventDefault();
    },
    { capture: true },
  );

  // --- inline text editing ------------------------------------------------
  function startTextEdit(el: Element): boolean {
    if (!(el instanceof HTMLElement) || !isTextEditable(el).editable) return false;
    editing = el;
    const before = el.textContent ?? '';
    const prevEditable = el.getAttribute('contenteditable');
    el.setAttribute('contenteditable', 'plaintext-only');
    el.setAttribute('data-pf-editing', '');
    el.style.setProperty('outline', 'none');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const finish = (commit: boolean) => {
      el.removeEventListener('keydown', onKey, true);
      el.removeEventListener('blur', onBlur);
      if (prevEditable === null) el.removeAttribute('contenteditable');
      else el.setAttribute('contenteditable', prevEditable);
      el.removeAttribute('data-pf-editing');
      el.style.removeProperty('outline');
      editing = null;
      const text = el.textContent ?? '';
      if (!commit) {
        el.textContent = before;
        reapply();
      } else if (text !== before) emit('textCommit', { nodeId: idOf(el), text });
      window.getSelection()?.removeAllRanges();
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        el.removeEventListener('blur', onBlur);
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    el.addEventListener('keydown', onKey, true);
    el.addEventListener('blur', onBlur);
    scheduleGeometry(true);
    return true;
  }

  // --- RPC methods ------------------------------------------------------------
  function pageInfo(): PageInfo {
    return {
      url: location.href,
      title: document.title,
      framework: detectFramework(),
      sourceMapped: !!document.querySelector('[data-pf-src]'),
      projectRoot: config.root ?? null,
      unreadableStylesheets: unreadableSheetCount(),
      role,
    };
  }

  function details(el: Element): ElementDetails {
    const cs = getComputedStyle(el);
    const computed: Record<string, string> = {};
    for (const p of TRACKED_PROPERTIES) computed[p] = cs.getPropertyValue(p).trim();
    const { origins, rules, inherited } = explain(el);
    const srcAttr = el.getAttribute('data-pf-src');
    const attributes: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) if (!a.name.startsWith('data-pf') && a.name !== 'class' && a.name !== 'style') attributes[a.name] = a.value.slice(0, 200);
    const te = isTextEditable(el);
    let scrollContainer = false;
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) scrollContainer = true;
    return {
      nodeId: idOf(el),
      tag: el.tagName.toLowerCase(),
      label: labelFor(el),
      selector: uniqueSelector(el),
      src: parseSourceLoc(srcAttr),
      instanceCount: srcAttr ? srcCounts().get(srcAttr) ?? 1 : 1,
      group: srcAttr ? null : similarGroup(el),
      components: componentStack(el),
      classes: Array.from(el.classList),
      attributes,
      text: { editable: te.editable, value: te.editable ? el.textContent ?? '' : '', reason: te.reason },
      computed,
      origins,
      rules,
      inherited,
      parentDisplay: el.parentElement ? getComputedStyle(el.parentElement).display : 'block',
      parentId: el.parentElement && el.parentElement !== document.documentElement ? idOf(el.parentElement) : null,
      childIds: Array.from(el.children).filter(isInspectable).map(idOf),
      box: boxOf(el),
      flags: {
        fixed: cs.position === 'fixed',
        sticky: cs.position === 'sticky',
        transformed: isTransformed(el),
        scrollContainer,
        replaced: ['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName),
      },
    };
  }

  const methods: AgentMethods = {
    init({ role: r }) {
      role = r;
      if (role === 'original') mode = 'interact';
      return pageInfo();
    },
    setMode({ mode: m }) {
      mode = m;
      if (m === 'interact') hovered = null;
      scheduleGeometry(true);
    },
    setState({ state }: { state: EditState }) {
      if (role !== 'editor') return { unresolved: [], suppressed: [] };
      const res = applyState(state);
      scheduleGeometry(true);
      return res;
    },
    select({ nodeId }) {
      selected = elementById(nodeId);
      scheduleGeometry(true);
      return geom(selected);
    },
    hover({ nodeId }) {
      hovered = elementById(nodeId);
      scheduleGeometry(true);
      return geom(hovered);
    },
    resolve({ selector, src, instanceIndex }) {
      let el: Element | null = null;
      if (src) {
        const all = document.querySelectorAll(`[data-pf-src="${CSS.escape(src)}"]`);
        el = all[instanceIndex ?? 0] ?? all[0] ?? null;
      }
      if (!el) {
        try {
          el = document.querySelector(selector);
        } catch {
          el = null;
        }
      }
      return el ? idOf(el) : null;
    },
    getTree: () => buildTree(),
    getDetails({ nodeId }) {
      const el = elementById(nodeId);
      return el ? details(el) : null;
    },
    getContext({ nodeId, depth }) {
      const el = elementById(nodeId);
      return el ? buildContext(el, depth ?? 4) : null;
    },
    scrollIntoView({ nodeId }) {
      const el = elementById(nodeId);
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    scrollTo({ x, y }) {
      const prev = syncScroll;
      syncScroll = false;
      window.scrollTo(x, y);
      syncScroll = prev;
    },
    measure({ nodeIds }) {
      return nodeIds.map((id) => geom(elementById(id)));
    },
    links() {
      const seen = new Set<string>();
      const out: Array<{ href: string; text: string }> = [];
      document.querySelectorAll('a[href]').forEach((a) => {
        const href = (a as HTMLAnchorElement).href;
        try {
          const u = new URL(href);
          if (u.origin !== location.origin || seen.has(u.pathname)) return;
          seen.add(u.pathname);
          out.push({ href: u.pathname + u.search, text: (a.textContent ?? '').trim().slice(0, 60) || u.pathname });
        } catch {
          /* ignore */
        }
      });
      return out.slice(0, 100);
    },
    editText({ nodeId }) {
      const el = elementById(nodeId);
      return el ? startTextEdit(el) : false;
    },
    setSyncScroll({ enabled }) {
      syncScroll = enabled;
    },
  };

  window.addEventListener('message', async (e) => {
    if (e.source !== window.parent || !isRpcMessage(e.data) || e.data.kind !== 'request') return;
    const req = e.data as RpcRequest;
    const reply = (payload: { result?: unknown; error?: string }) =>
      (e.source as Window).postMessage({ channel: PF_CHANNEL, kind: 'response', id: req.id, ...payload }, '*');
    try {
      const fn = methods[req.method] as (p: unknown) => unknown;
      if (!fn) throw new Error(`Unknown method ${req.method}`);
      reply({ result: await fn(req.params ?? {}) });
    } catch (err) {
      reply({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Public API used by the verification harness (Playwright) and tests.
  window.__PIXELFORGE__ = {
    version: 1,
    applyState: (s: EditState) => applyState(s),
    computed(selector: string, props: string[]) {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p).trim()]));
    },
    resolveTarget,
    explain: (selector: string) => {
      const el = document.querySelector(selector);
      return el ? details(el) : null;
    },
    tree: () => buildTree(),
    /** Computed values of every edited property on the first instance of each target. */
    probe(state: EditState) {
      const out: Array<{ key: string; label: string; property: string; path: string; value: string }> = [];
      for (const [key, perBp] of Object.entries(state.styles)) {
        const target = state.targets[key];
        const el = target ? resolveTarget(target)[0] : null;
        if (!el) continue;
        const cs = getComputedStyle(el);
        const props = new Set(Object.values(perBp).flatMap((m) => Object.keys(m ?? {})));
        for (const property of props) out.push({ key, label: target.label, property, path: structuralPath(el), value: cs.getPropertyValue(property).trim() });
      }
      return out;
    },
    read(checks: Array<{ path: string; property: string }>) {
      return checks.map((c) => {
        const el = document.querySelector(c.path);
        return el ? getComputedStyle(el).getPropertyValue(c.property).trim() : null;
      });
    },
    components: (selector: string) => {
      const el = document.querySelector(selector);
      return el ? componentsRootedAt(el) : [];
    },
  };

  function structuralPath(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur.parentElement) {
      const parent: Element = cur.parentElement;
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${Array.from(parent.children).indexOf(cur) + 1})`);
      cur = parent;
    }
    return `html > ${parts.join(' > ')}`;
  }

  function start() {
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    emit('ready', pageInfo());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
