/**
 * Surgical stylesheet edits with PostCSS. Formatting of untouched code is
 * preserved (PostCSS keeps raws), new declarations inherit the file's
 * indentation style, and rules are inserted where the cascade stays
 * correct: base rules before breakpoint blocks, tablet before mobile.
 */
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Root, type Rule } from 'postcss';
import { compressBox, compressDeclarations, expandBox, getBreakpoint, mediaToBreakpoint, SHORTHANDS, type BreakpointId } from '@pixelforge/core';

export function parseCss(code: string, from?: string): Root {
  return postcss.parse(code, { from });
}

function normSelector(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function isMedia(n: ChildNode): n is AtRule {
  return n.type === 'atrule' && n.name === 'media';
}

/** Top-level (or inside @layer) rules — i.e. not inside any @media. */
function baseContainers(root: Root): Container[] {
  const out: Container[] = [root];
  root.walkAtRules('layer', (a) => {
    if (a.nodes) out.push(a);
  });
  return out;
}

function findRuleIn(container: Container, selector: string): Rule | null {
  let found: Rule | null = null;
  container.each((n) => {
    if (n.type === 'rule' && normSelector(n.selector) === selector) found = n;
  });
  return found;
}

export function findBaseRule(root: Root, selector: string): Rule | null {
  const sel = normSelector(selector);
  for (const c of baseContainers(root)) {
    const r = findRuleIn(c, sel);
    if (r) return r;
  }
  return null;
}

function mediaBlocks(root: Root, bp: BreakpointId): AtRule[] {
  const out: AtRule[] = [];
  root.walkAtRules('media', (a) => {
    if (mediaToBreakpoint(a.params) === bp) out.push(a);
  });
  return out;
}

/** True if a rule for `selector` (exact) exists anywhere in the file. */
export function hasSelector(root: Root, selector: string): boolean {
  const sel = normSelector(selector);
  let found = false;
  root.walkRules((r) => {
    if (normSelector(r.selector) === sel) found = true;
  });
  return found;
}

/** Declared longhands of a rule (after expanding box shorthands), for scoring. */
export function declaredProps(rule: Rule): Set<string> {
  const out = new Set<string>();
  rule.walkDecls((d) => {
    out.add(d.prop);
    for (const l of SHORTHANDS[d.prop] ?? []) out.add(l);
    if (d.prop === 'background') out.add('background-color');
    if (d.prop === 'border') ['top', 'right', 'bottom', 'left'].forEach((s) => ['width', 'style', 'color'].forEach((k) => out.add(`border-${s}-${k}`)));
  });
  return out;
}

function longhandsOf(prop: string): string[] {
  if (SHORTHANDS[prop]) return SHORTHANDS[prop];
  if (prop === 'border') return ['top', 'right', 'bottom', 'left'].flatMap((s) => ['width', 'style', 'color'].map((k) => `border-${s}-${k}`));
  return [prop];
}

function lastDecl(rule: Rule, prop: string): Declaration | null {
  let found: Declaration | null = null;
  rule.each((n) => {
    if (n.type === 'decl' && n.prop === prop) found = n;
  });
  return found;
}

/**
 * Set declarations on a rule. Longhands are merged into an existing box
 * shorthand when possible (`padding: 16px` + padding-top 32px becomes
 * `padding: 32px 16px 16px`) instead of appending conflicting noise.
 */
export function setRuleDeclarations(rule: Rule, decls: Record<string, string>): void {
  for (const [prop, value] of compressDeclarations(decls)) {
    const exact = lastDecl(rule, prop);
    if (exact) {
      exact.value = value;
      continue;
    }
    const box = Object.entries(SHORTHANDS).find(([sh, longs]) => sh !== 'inset' && longs.includes(prop));
    if (box) {
      const [sh, longs] = box;
      const shDecl = lastDecl(rule, sh);
      if (shDecl && sh !== 'gap') {
        const parts = expandBox(shDecl.value);
        if (parts) {
          parts[longs.indexOf(prop)] = value;
          shDecl.value = compressBox(parts);
          continue;
        }
      }
      if (shDecl && sh === 'gap') {
        const [row, col = row] = shDecl.value.split(/\s+/);
        const next = prop === 'row-gap' ? [value, col] : [row, value];
        shDecl.value = next[0] === next[1] ? next[0] : next.join(' ');
        continue;
      }
    }
    // A shorthand replaces any longhands it fully covers.
    const covered = longhandsOf(prop);
    if (covered.length > 1) {
      rule.each((n) => {
        if (n.type === 'decl' && n.prop !== prop && longhandsOf(n.prop).every((l) => covered.includes(l))) n.remove();
      });
    }
    rule.append({ prop, value });
  }
}

function insertBaseRule(root: Root, selector: string): Rule {
  const rule = postcss.rule({ selector });
  // Insert before the first @media block that mentions the selector so
  // existing responsive overrides keep winning.
  let anchor: ChildNode | null = null;
  root.each((n) => {
    if (anchor) return;
    if (isMedia(n) && hasSelectorIn(n, selector)) anchor = n;
  });
  if (anchor) root.insertBefore(anchor, rule);
  else root.append(rule);
  spaceOut(rule);
  return rule;
}

function hasSelectorIn(c: Container, selector: string): boolean {
  let found = false;
  c.walkRules((r) => {
    if (normSelector(r.selector) === normSelector(selector)) found = true;
  });
  return found;
}

function spaceOut(node: ChildNode) {
  if (node.prev()) node.raws.before = '\n\n';
}

function insertMediaBlock(root: Root, bp: BreakpointId): AtRule {
  const media = postcss.atRule({ name: 'media', params: getBreakpoint(bp).media! });
  if (bp === 'tablet') {
    // Tablet overrides must precede mobile ones.
    let anchor: ChildNode | null = null;
    root.each((n) => {
      if (!anchor && isMedia(n) && mediaToBreakpoint(n.params) === 'mobile') anchor = n;
    });
    if (anchor) {
      root.insertBefore(anchor, media);
      spaceOut(media);
      (anchor as ChildNode).raws.before = '\n\n';
      return media;
    }
  }
  root.append(media);
  spaceOut(media);
  return media;
}

export interface SetResult {
  rule: Rule;
  created: 'none' | 'rule' | 'media';
}

/** Set declarations for `selector` at `breakpoint`, creating rules as needed. */
export function setDeclarations(root: Root, selector: string, breakpoint: BreakpointId, decls: Record<string, string>): SetResult {
  if (breakpoint === 'base') {
    const existing = findBaseRule(root, selector);
    const rule = existing ?? insertBaseRule(root, selector);
    setRuleDeclarations(rule, decls);
    return { rule, created: existing ? 'none' : 'rule' };
  }
  const blocks = mediaBlocks(root, breakpoint);
  for (const b of blocks) {
    const r = findRuleIn(b, normSelector(selector));
    if (r) {
      setRuleDeclarations(r, decls);
      return { rule: r, created: 'none' };
    }
  }
  const block = blocks[blocks.length - 1] ?? insertMediaBlock(root, breakpoint);
  const rule = postcss.rule({ selector });
  block.append(rule);
  if (rule.prev()) rule.raws.before = '\n\n  ';
  setRuleDeclarations(rule, decls);
  return { rule, created: blocks.length ? 'rule' : 'media' };
}

export function stringify(root: Root): string {
  let out = root.toString();
  if (!out.endsWith('\n')) out += '\n';
  return out;
}

/** Longhands declared for `selector` inside width-based @media blocks. */
export function mediaDeclaredProps(root: Root, selector: string): Set<string> {
  const out = new Set<string>();
  const sel = normSelector(selector);
  root.walkAtRules('media', (a) => {
    if (!/width/.test(a.params)) return;
    a.walkRules((r) => {
      if (normSelector(r.selector) === sel) declaredProps(r).forEach((p) => out.add(p));
    });
  });
  return out;
}

/**
 * Insert a new base rule right after `anchor` (a top-level rule), so it
 * beats the anchor's declarations but still loses to any later @media
 * overrides of the anchor — preserving the site's responsive behaviour.
 */
export function insertRuleAfter(anchor: Rule, selector: string, decls: Record<string, string>): Rule {
  const rule = postcss.rule({ selector });
  anchor.after(rule);
  rule.raws.before = '\n\n';
  setRuleDeclarations(rule, decls);
  return rule;
}
