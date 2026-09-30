/**
 * A pragmatic reimplementation of the CSS cascade, used to explain *why*
 * an element looks the way it does: which rule wins for each property,
 * which declarations it overrides, and which values are inherited.
 *
 * It walks the same-origin CSSOM (cross-origin sheets are reported as
 * unreadable), evaluates @media/@supports against the live page, orders
 * declarations by importance, layers, specificity and source order, and
 * falls back to ancestor declarations for inherited properties.
 */
import {
  isInheritedProperty,
  shorthandFor,
  SHORTHANDS,
  TRACKED_PROPERTIES,
  type DeclarationRef,
  type InheritedGroup,
  type MatchedRule,
  type PropertyOrigin,
} from '@pixelforge/core';
import { idOf } from './registry.ts';
import { labelFor } from './selector.ts';
import { compareSpecificity, specificity, splitSelectorList, type Specificity } from './specificity.ts';

interface FlatRule {
  rule: CSSStyleRule;
  selectors: string[];
  media: string | null;
  layered: boolean;
  order: number;
  source: string;
  kind: 'rule' | 'editor';
}

let cache: { version: number; rules: FlatRule[]; unreadable: number } | null = null;
let version = 0;
let projectRoot: string | null = null;

export function setProjectRoot(root: string | null) {
  projectRoot = root;
}

export function invalidateRules() {
  version++;
}

function sheetSource(sheet: CSSStyleSheet, index: number): { source: string; kind: 'rule' | 'editor' } {
  const owner = sheet.ownerNode as Element | null;
  if (owner?.id === '__pf_edits') return { source: 'PixelForge edits', kind: 'editor' };
  const viteId = owner?.getAttribute?.('data-vite-dev-id');
  if (viteId) {
    const rel = projectRoot && viteId.startsWith(projectRoot) ? viteId.slice(projectRoot.length).replace(/^\//, '') : viteId;
    return { source: rel, kind: 'rule' };
  }
  if (sheet.href) {
    try {
      const u = new URL(sheet.href);
      const orig = u.searchParams.get('url');
      return { source: orig ?? (u.origin === location.origin ? u.pathname : sheet.href), kind: 'rule' };
    } catch {
      return { source: sheet.href, kind: 'rule' };
    }
  }
  return { source: `<style> #${index + 1}`, kind: 'rule' };
}

function collect(): { rules: FlatRule[]; unreadable: number } {
  if (cache && cache.version === version) return cache;
  const rules: FlatRule[] = [];
  let unreadable = 0;
  let order = 0;
  const sheets = [...Array.from(document.styleSheets), ...((document as unknown as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [])];
  const walk = (list: CSSRuleList, media: string | null, layered: boolean, src: { source: string; kind: 'rule' | 'editor' }) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        rules.push({ rule, selectors: splitSelectorList(rule.selectorText), media, layered, order: order++, ...src });
      } else if (rule instanceof CSSMediaRule) {
        if (window.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules, rule.media.mediaText, layered, src);
      } else if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) walk(rule.cssRules, media, layered, src);
      } else if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        walk(rule.cssRules, media, true, src);
      } else if (rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet && (!rule.media.mediaText || window.matchMedia(rule.media.mediaText).matches)) walk(rule.styleSheet.cssRules, media, layered || !!rule.layerName, src);
        } catch {
          unreadable++;
        }
      } else if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules && rule.constructor.name === 'CSSContainerRule') {
        walk((rule as CSSGroupingRule).cssRules, `@container ${(rule as unknown as { conditionText: string }).conditionText}`, layered, src);
      }
    }
  };
  sheets.forEach((sheet, i) => {
    if (sheet.disabled) return;
    if (sheet.media?.mediaText && !window.matchMedia(sheet.media.mediaText).matches) return;
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      unreadable++;
      return;
    }
    walk(list, null, false, sheetSource(sheet, i));
  });
  cache = { version, rules, unreadable };
  return cache;
}

export function unreadableSheetCount(): number {
  return collect().unreadable;
}

interface Match {
  flat: FlatRule;
  specificity: Specificity;
  selector: string;
}

function matchingRules(el: Element): Match[] {
  const out: Match[] = [];
  for (const flat of collect().rules) {
    let best: Specificity | null = null;
    let bestSel = '';
    for (const sel of flat.selectors) {
      let ok = false;
      try {
        ok = el.matches(sel);
      } catch {
        ok = false;
      }
      if (ok) {
        const sp = specificity(sel);
        if (!best || compareSpecificity(sp, best) > 0) {
          best = sp;
          bestSel = sel;
        }
      }
    }
    if (best) out.push({ flat, specificity: best, selector: bestSel });
  }
  return out;
}

interface Candidate {
  ref: DeclarationRef;
  rank: number[];
}

function readDecl(style: CSSStyleDeclaration, prop: string): { value: string; important: boolean } | null {
  let value = style.getPropertyValue(prop);
  let important = style.getPropertyPriority(prop) === 'important';
  if (!value) {
    // Longhands of a shorthand that uses var() are "pending substitution"
    // and read as empty; report the shorthand's authored value instead.
    const sh = shorthandFor(prop);
    if (sh) {
      const shValue = style.getPropertyValue(sh);
      if (shValue) {
        value = `${shValue}`;
        important = style.getPropertyPriority(sh) === 'important';
      }
    }
  }
  return value ? { value: value.trim(), important } : null;
}

/**
 * Candidates for `prop` on `el`, ranked. Rank ordering (higher wins):
 * important, (layer order flipped for important), inline, specificity, order.
 */
function candidates(el: Element, prop: string, matches: Match[]): Candidate[] {
  const out: Candidate[] = [];
  for (const m of matches) {
    const d = readDecl(m.flat.rule.style, prop);
    if (!d) continue;
    const layerRank = d.important ? (m.flat.layered ? 1 : 0) : m.flat.layered ? 0 : 1;
    out.push({
      ref: { value: d.value, important: d.important, selector: m.selector, source: m.flat.source, media: m.flat.media, kind: m.flat.kind },
      rank: [d.important ? 1 : 0, layerRank, 0, ...m.specificity, m.flat.order],
    });
  }
  const inline = (el as HTMLElement).style;
  if (inline) {
    const d = readDecl(inline, prop);
    if (d) out.push({ ref: { value: d.value, important: d.important, selector: 'element.style', source: 'inline style', media: null, kind: 'inline' }, rank: [d.important ? 1 : 0, 1, 1, 0, 0, 0, 0] });
  }
  out.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i];
    return 0;
  });
  return out;
}

export interface CascadeResult {
  origins: Record<string, PropertyOrigin>;
  rules: MatchedRule[];
  inherited: InheritedGroup[];
}

function parseCssText(cssText: string): Array<{ property: string; value: string; important: boolean }> {
  const out: Array<{ property: string; value: string; important: boolean }> = [];
  let depth = 0;
  let cur = '';
  const push = () => {
    const idx = cur.indexOf(':');
    if (idx > 0) {
      const property = cur.slice(0, idx).trim();
      let value = cur.slice(idx + 1).trim();
      const important = /!\s*important$/i.test(value);
      value = value.replace(/!\s*important$/i, '').trim();
      if (property && value) out.push({ property, value, important });
    }
    cur = '';
  };
  for (const ch of cssText) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) push();
    else cur += ch;
  }
  push();
  return out;
}

function longhandsOf(prop: string): string[] {
  if (SHORTHANDS[prop]) return SHORTHANDS[prop];
  if (prop === 'border') return ['top', 'right', 'bottom', 'left'].flatMap((s) => ['width', 'style', 'color'].map((k) => `border-${s}-${k}`));
  if (/^border-(top|right|bottom|left)$/.test(prop)) return ['width', 'style', 'color'].map((k) => `${prop}-${k}`);
  if (prop === 'background') return ['background-color', 'background-image'];
  return [prop];
}

function sameDecl(w: DeclarationRef | null | undefined, m: Match): boolean {
  return !!w && w.selector === m.selector && w.source === m.flat.source && w.media === m.flat.media;
}

function toMatchedRule(m: Match, isOverridden: (longhand: string) => boolean, onlyInherited = false): MatchedRule | null {
  const decls = parseCssText(m.flat.rule.style.cssText)
    .filter((d) => !onlyInherited || longhandsOf(d.property).some(isInheritedProperty) || d.property === 'font')
    .map((d) => ({ ...d, overridden: longhandsOf(d.property).every(isOverridden) }));
  if (!decls.length) return null;
  return { selector: m.selector, source: m.flat.source, media: m.flat.media, kind: m.flat.kind, specificity: m.specificity, declarations: decls };
}

export function explain(el: Element, props: string[] = TRACKED_PROPERTIES): CascadeResult {
  const matches = matchingRules(el);
  const cs = getComputedStyle(el);
  const origins: Record<string, PropertyOrigin> = {};
  const winners = new Map<string, DeclarationRef | null>();
  const ancestorMatches = new Map<Element, Match[]>();
  const ancestorMatchesOf = (a: Element) => {
    let m = ancestorMatches.get(a);
    if (!m) ancestorMatches.set(a, (m = matchingRules(a)));
    return m;
  };

  for (const prop of props) {
    const cands = candidates(el, prop, matches);
    const computed = cs.getPropertyValue(prop).trim();
    if (cands.length) {
      const [win, ...rest] = cands;
      winners.set(prop, win.ref);
      origins[prop] = {
        kind: win.ref.kind === 'editor' ? 'editor' : win.ref.kind === 'inline' ? 'inline' : 'rule',
        specified: win.ref.value,
        computed,
        winner: win.ref,
        overridden: rest.map((c) => c.ref),
        inheritedFrom: null,
      };
      continue;
    }
    winners.set(prop, null);
    if (isInheritedProperty(prop)) {
      let anc = el.parentElement;
      let found = false;
      while (anc) {
        const ac = candidates(anc, prop, ancestorMatchesOf(anc));
        if (ac.length) {
          origins[prop] = {
            kind: 'inherited',
            specified: ac[0].ref.value,
            computed,
            winner: ac[0].ref,
            overridden: [],
            inheritedFrom: { nodeId: idOf(anc), label: labelFor(anc) },
          };
          found = true;
          break;
        }
        anc = anc.parentElement;
      }
      if (found) continue;
    }
    origins[prop] = { kind: 'default', specified: null, computed, winner: null, overridden: [], inheritedFrom: null };
  }

  // Styles pane: all rules matching the element, highest precedence first.
  const winnersAll = winners;
  const sorted = [...matches].sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.flat.order - a.flat.order);
  const rules: MatchedRule[] = [];
  const inlineText = (el as HTMLElement).style?.cssText;
  if (inlineText) {
    rules.push({
      selector: 'element.style',
      source: 'inline style',
      media: null,
      kind: 'inline',
      specificity: [1, 0, 0],
      declarations: parseCssText(inlineText).map((d) => ({ ...d, overridden: longhandsOf(d.property).every((l) => winnersAll.get(l)?.kind !== undefined && winnersAll.get(l)?.kind !== 'inline') })),
    });
  }
  for (const m of sorted) {
    const r = toMatchedRule(m, (l) => {
      const w = winnersAll.get(l);
      if (w === undefined) return false; // untracked property: unknown, show as active
      return !sameDecl(w, m);
    });
    if (r) rules.push(r);
  }
  // Editor overrides first so users see their own changes on top.
  rules.sort((a, b) => (a.kind === 'editor' ? -1 : 0) - (b.kind === 'editor' ? -1 : 0));

  const inherited: InheritedGroup[] = [];
  let anc = el.parentElement;
  let depth = 0;
  while (anc && depth < 8) {
    const am = ancestorMatchesOf(anc).sort((a, b) => compareSpecificity(b.specificity, a.specificity) || b.flat.order - a.flat.order);
    const ancId = idOf(anc);
    const groupRules = am
      .map((m) =>
        toMatchedRule(
          m,
          (l) => {
            if (!isInheritedProperty(l)) return true;
            const o = origins[l];
            if (!o) return false;
            return o.kind !== 'inherited' || o.inheritedFrom?.nodeId !== ancId || !sameDecl(o.winner, m);
          },
          true,
        ),
      )
      .filter((r): r is MatchedRule => !!r);
    if (groupRules.length) inherited.push({ nodeId: idOf(anc), label: labelFor(anc), rules: groupRules });
    anc = anc.parentElement;
    depth++;
  }
  return { origins, rules, inherited };
}

/**
 * The declaration the *site itself* applies for `prop` (ignoring editor
 * overrides). Used to keep base-breakpoint edits from overriding the
 * site's own responsive rules, mirroring what a source edit would do.
 */
export function siteWinner(el: Element, prop: string, cache?: Map<Element, unknown>): DeclarationRef | null {
  let matches = cache?.get(el) as Match[] | undefined;
  if (!matches) {
    matches = matchingRules(el).filter((m) => m.flat.kind !== 'editor');
    cache?.set(el, matches);
  }
  return candidates(el, prop, matches)[0]?.ref ?? null;
}
