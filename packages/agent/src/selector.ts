/**
 * Unique, reasonably stable CSS selectors for elements. Preference order:
 * a unique id, then tag + meaningful classes, falling back to
 * :nth-of-type where siblings are ambiguous. The result is verified to
 * match exactly one element.
 */

const HASHED_CLASS = [
  /^_[A-Za-z0-9-]+_[a-z0-9]{5}(_\d+)?$/, // vite css modules
  /^css-[a-z0-9]+$/i, // emotion
  /^sc-[A-Za-z]+$/, // styled-components
  /^[A-Za-z]+__[A-Za-z]+___[A-Za-z0-9_-]{5}$/, // css-loader modules
  /^jsx-\d+$/, // styled-jsx
  /[[\]:/.]/, // tailwind variants / arbitrary values — valid but brittle
];

export function isStableClass(c: string): boolean {
  if (!c || c.startsWith('pf-')) return false;
  return !HASHED_CLASS.some((re) => re.test(c));
}

function isUniqueId(id: string, doc: Document): boolean {
  if (!id || /^\d/.test(id) || /[:.]|^radix-|^headlessui-|^:r/.test(id)) return false;
  try {
    return doc.querySelectorAll(`#${CSS.escape(id)}`).length === 1;
  } catch {
    return false;
  }
}

function count(doc: Document, sel: string): number {
  try {
    return doc.querySelectorAll(sel).length;
  } catch {
    return Infinity;
  }
}

export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (el === doc.documentElement) return 'html';
  if (el === doc.body) return 'body';
  if (el.id && isUniqueId(el.id, doc)) return `#${CSS.escape(el.id)}`;

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== doc.documentElement) {
    if (cur === doc.body) {
      parts.unshift('body');
      break;
    }
    if (cur !== el && cur.id && isUniqueId(cur.id, doc)) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
      break;
    }
    const tag = cur.tagName.toLowerCase();
    const classes = Array.from(cur.classList).filter(isStableClass).slice(0, 2);
    let part = tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((s) => s.tagName === cur!.tagName);
      if (same.length > 1) {
        const matching = classes.length ? same.filter((s) => s.matches(part)) : same;
        if (matching.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    if (parts.length >= 2 && count(doc, candidate) === 1) return candidate;
    cur = parent;
  }
  const full = parts.join(' > ');
  return count(doc, full) === 1 ? full : fullPath(el);
}

function fullPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.parentElement) {
    const parent: Element = cur.parentElement;
    const idx = Array.from(parent.children).indexOf(cur) + 1;
    parts.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
    cur = parent;
  }
  return `html > ${parts.join(' > ')}`;
}

/** Short human label like `h1.title` or `section#pricing`. */
export function labelFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && !/^:r|^radix-/.test(el.id)) return `${tag}#${el.id}`;
  const cls = Array.from(el.classList).find(isStableClass) ?? Array.from(el.classList)[0];
  if (!cls) return tag;
  const demangled = /^_([A-Za-z0-9-]+)_[a-z0-9]{5}(?:_\d+)?$/.exec(cls)?.[1] ?? cls;
  return `${tag}.${demangled}`;
}

function stableClasses(el: Element): string[] {
  return Array.from(el.classList).filter(isStableClass).slice(0, 2);
}

function simpleSel(el: Element): string {
  return el.tagName.toLowerCase() + stableClasses(el).map((c) => `.${CSS.escape(c)}`).join('');
}

/** Siblings that look like repeated items (same tag and classes). */
function siblingGroup(el: Element): Element[] | null {
  const parent = el.parentElement;
  if (!parent || el === document.body) return null;
  const sel = simpleSel(el);
  const sibs = Array.from(parent.children).filter((s) => s.matches(sel));
  return sibs.length >= 2 ? sibs : null;
}

/**
 * For pages without source mapping: a selector matching this element and
 * its structural twins in repeated items (e.g. every card in a list), so an
 * edit can target "all similar" the way a component edit would.
 */
export function similarGroup(el: Element): { selector: string; count: number } | null {
  if (el.hasAttribute('data-pf-src')) return null;
  const rel: string[] = [];
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 4 && cur !== document.body; depth++) {
    const sibs = siblingGroup(cur);
    if (sibs && cur.parentElement) {
      const selector = [`${uniqueSelector(cur.parentElement)} > ${simpleSel(cur)}`, ...rel].join(' > ');
      let count = 0;
      try {
        count = document.querySelectorAll(selector).length;
      } catch {
        return null;
      }
      return count >= 2 && count <= sibs.length ? { selector, count } : null;
    }
    const parent: Element | null = cur.parentElement;
    if (!parent) return null;
    let part = simpleSel(cur);
    const same = Array.from(parent.children).filter((s) => s.matches(part));
    if (same.length > 1) part += `:nth-of-type(${Array.from(parent.children).filter((s) => s.tagName === cur!.tagName).indexOf(cur) + 1})`;
    rel.unshift(part);
    cur = parent;
  }
  return null;
}
