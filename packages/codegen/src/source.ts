/**
 * Source-project code generation: turn an EditState into edits of the
 * project's JSX / CSS / CSS-module / Tailwind sources.
 *
 * Strategy per element and breakpoint, in order of preference:
 *   1. CSS module class owned by this element      → edit the module rule
 *   2. global CSS class owned by this element      → edit that rule
 *   3. Tailwind project                            → edit utility classes
 *   4. base breakpoint                             → inline style object
 *   5. breakpoint + CSS module / global stylesheet → new scoped class
 * A class is "owned" when no other JSX element uses it. Shared classes
 * are not modified by default (that would restyle unrelated elements);
 * the `sharedClass` override opts into editing them.
 */
import path from 'node:path';
import {
  BREAKPOINT_ORDER,
  compressDeclarations,
  formatSourceLoc,
  SHORTHANDS,
  type BreakpointId,
  type ChangeMapping,
  type EditState,
  type ElementTarget,
  type FilePatch,
  type MappingStrategy,
} from '@pixelforge/core';
import { declaredProps, findBaseRule, insertRuleAfter, mediaDeclaredProps, setDeclarations } from './css.ts';
import {
  analyzeClassName,
  camelCase,
  countModuleClassUsages,
  cssModuleImports,
  escapeJsxText,
  escapeStringLiteral,
  findElementAt,
  getAttr,
  jsxTextValue,
  normalizeText,
  styleValueLiteral,
  walk,
  type AnyNode,
  type ClassInfo,
} from './jsx.ts';
import { applyToClassList, propsOfUtility } from './tailwind.ts';
import { Workspace, type JsxFile, type ProjectAccess } from './workspace.ts';

export interface SourcePatchOptions {
  /** Per target key: edit shared classes in place instead of scoping. */
  sharedClass?: Record<string, boolean>;
}

export interface SourcePatch {
  files: FilePatch[];
  mappings: ChangeMapping[];
  warnings: string[];
}

interface ElementCtx {
  target: ElementTarget;
  file: JsxFile;
  opening: AnyNode;
  element: AnyNode;
  modules: Record<string, string>;
  cls: ClassInfo;
  /** Pending className list edits (Tailwind / added classes). */
  classList: string[] | null;
  addModuleClass: string | null;
  addGlobalClass: string | null;
  inlineStyle: Record<string, string>;
}

const JSX_EXT = /\.[jt]sx?$/;

export function generateSourcePatch(state: EditState, project: ProjectAccess, opts: SourcePatchOptions = {}): SourcePatch {
  const ws = new Workspace(project);
  const mappings: ChangeMapping[] = [];
  const warnings: string[] = [];
  const globalCss = globalStylesheets(ws);
  const classUsage = new ClassUsageIndex(ws);

  for (const [key, target] of Object.entries(state.targets)) {
    const styles = state.styles[key] ?? {};
    const text = state.text[key];
    const styleProps = BREAKPOINT_ORDER.flatMap((bp) => Object.keys(styles[bp] ?? {}).map((p) => (bp === 'base' ? p : `${p} @${bp}`)));
    const base: Omit<ChangeMapping, 'strategy' | 'file' | 'detail' | 'status'> = { targetKey: key, label: target.label, properties: styleProps };

    if (!target.src) {
      mappings.push({ ...base, strategy: null, file: null, detail: 'No source location', status: 'unmapped', message: 'This element is not rendered from project JSX (no data-pf-src). It may come from a third-party component or be created at runtime.' });
      continue;
    }
    const loc = formatSourceLoc(target.src);
    const file = ws.jsx(ws.abs(target.src.file));
    const located = file ? findElementAt(file.ast, target.src.line, target.src.column) : null;
    if (!file || !located) {
      mappings.push({ ...base, strategy: null, file: target.src.file, detail: loc, status: 'unmapped', message: `Could not find the JSX element at ${loc}. The file may have changed since the page loaded — reload the page and retry.` });
      continue;
    }
    const modules = cssModuleImports(file.ast, file.abs);
    const ctx: ElementCtx = {
      target,
      file,
      opening: located.opening,
      element: located.element,
      modules,
      cls: analyzeClassName(file.ast, located.opening, modules),
      classList: null,
      addModuleClass: null,
      addGlobalClass: null,
      inlineStyle: {},
    };

    const hasStyles = Object.values(styles).some((m) => m && Object.keys(m).length);
    if (hasStyles && target.scope === 'instance' && target.instanceCount > 1) {
      mappings.push({ ...base, strategy: null, file: target.src.file, detail: loc, status: 'unmapped', message: `This element is one of ${target.instanceCount} instances rendered from the same JSX (e.g. an array map). An instance-only style cannot be expressed in the shared source; switch the edit to "all instances".` });
    } else if (hasStyles) {
      const inlineProps = inlineStyleProps(ctx.opening);
      for (const bp of BREAKPOINT_ORDER) {
        const all = styles[bp];
        if (!all || !Object.keys(all).length) continue;
        const propsLabel = (d: Record<string, string>) => Object.keys(d).map((p) => (bp === 'base' ? p : `${p} @${bp}`));
        // Properties already set by the element's inline style object can
        // only be changed there (inline beats every class rule).
        const inlineDecls = Object.fromEntries(Object.entries(all).filter(([p]) => inlineProps.has(p)));
        let decls = Object.fromEntries(Object.entries(all).filter(([p]) => !inlineProps.has(p)));
        if (Object.keys(inlineDecls).length) {
          if (bp === 'base') {
            Object.assign(ctx.inlineStyle, inlineDecls);
            mappings.push({ ...base, properties: propsLabel(inlineDecls), strategy: 'inline-style', file: ws.rel(ctx.file.abs), detail: `existing style={{ ${Object.keys(inlineDecls).map(camelCase).join(', ')} }}`, status: 'mapped' });
          } else {
            decls = { ...decls, ...Object.fromEntries(Object.entries(inlineDecls).map(([p, v]) => [p, `${v} !important`])) };
            mappings.push({ ...base, properties: propsLabel(inlineDecls), strategy: null, file: ws.rel(ctx.file.abs), detail: '!important', status: 'warning', message: `${Object.keys(inlineDecls).join(', ')} ${Object.keys(inlineDecls).length > 1 ? 'are' : 'is'} set by an inline style, which beats stylesheet rules; the breakpoint rule uses !important. Consider moving the inline style into a class.` });
          }
        }
        if (!Object.keys(decls).length) continue;
        const res = applyStyles(ws, ctx, bp, decls, { globalCss, classUsage, shared: !!opts.sharedClass?.[key] });
        mappings.push({ ...base, properties: propsLabel(decls).map((l) => l.replace(' !important', '')), ...res });
      }
      flushElement(ctx);
    }
    if (text) {
      const res = applyText(ws, ctx, text.original, text.value);
      mappings.push({ ...base, properties: ['text'], ...res });
    }
  }

  for (const m of mappings) if (m.status === 'warning' && m.message) warnings.push(`${m.label}: ${m.message}`);
  return { files: ws.finalize(), mappings, warnings };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

type StrategyResult = Pick<ChangeMapping, 'strategy' | 'file' | 'detail' | 'status' | 'message'>;

interface StyleEnv {
  globalCss: string[];
  classUsage: ClassUsageIndex;
  shared: boolean;
}

function applyStyles(ws: Workspace, ctx: ElementCtx, bp: BreakpointId, decls: Record<string, string>, env: StyleEnv): StrategyResult {
  const bpNote = bp === 'base' ? '' : ` (@media ${bp})`;
  const props = new Set(Object.keys(decls));
  const score = (rulePropSet: Set<string>) => [...props].filter((p) => rulePropSet.has(p)).length;
  let sharedNote: string | null = null;

  // 1. CSS module class.
  const modRefs = ctx.cls.moduleRefs.filter((r) => !r.conditional);
  if (modRefs.length) {
    const candidates = modRefs.map((ref) => {
      const cssAbs = ctx.modules[ref.binding];
      const root = ws.peekCss(cssAbs);
      const rule = root ? findBaseRule(root, `.${ref.className}`) : null;
      const usages = countModuleClassUsages(ctx.file.ast, ref.binding, ref.className);
      return { ref, cssAbs, rule, usages, score: rule ? score(declaredProps(rule)) + 0.5 : 0 };
    });
    const owned = candidates.filter((c) => c.usages <= 1 || env.shared);
    const pick = owned.sort((a, b) => b.score - a.score)[0];
    if (pick) {
      const root = ws.css(pick.cssAbs, true)!;
      const res = setDeclarations(root, `.${pick.ref.className}`, bp, decls);
      const shared = pick.usages > 1;
      return {
        strategy: 'css-module',
        file: ws.rel(pick.cssAbs),
        detail: `.${pick.ref.className}${bpNote}${res.created === 'none' ? '' : ' (new rule)'}`,
        status: shared ? 'warning' : 'mapped',
        message: shared ? `.${pick.ref.className} is used by ${pick.usages} elements in ${path.basename(ctx.file.abs)}; all of them change.` : undefined,
      };
    }
    sharedNote = `.${candidates[0].ref.className} is shared by ${candidates[0].usages} elements, so it was left unchanged.`;
  }

  // 2. Global stylesheet class.
  const statics = ctx.cls.staticClasses.filter((c) => !c.conditional && !propsOfUtility(c.name).length);
  const globalCandidates: Array<{ cls: string; file: string; score: number; usages: number }> = [];
  for (const c of statics) {
    for (const cssAbs of env.globalCss) {
      const root = ws.peekCss(cssAbs);
      const rule = root ? findBaseRule(root, `.${c.name}`) : null;
      if (rule) globalCandidates.push({ cls: c.name, file: cssAbs, score: score(declaredProps(rule)), usages: env.classUsage.count(c.name) });
    }
  }
  const ownedGlobal = globalCandidates.filter((c) => c.usages <= 1 || env.shared).sort((a, b) => b.score - a.score)[0];
  if (ownedGlobal) {
    const root = ws.css(ownedGlobal.file)!;
    const res = setDeclarations(root, `.${ownedGlobal.cls}`, bp, decls);
    const shared = ownedGlobal.usages > 1;
    return {
      strategy: 'css-rule',
      file: ws.rel(ownedGlobal.file),
      detail: `.${ownedGlobal.cls}${bpNote}${res.created === 'none' ? '' : ' (new rule)'}`,
      status: shared ? 'warning' : 'mapped',
      message: shared ? `.${ownedGlobal.cls} is used by ${ownedGlobal.usages} elements across the project; all of them change.` : undefined,
    };
  }
  if (!sharedNote && globalCandidates.length) {
    const g = globalCandidates.sort((a, b) => b.usages - a.usages)[0];
    sharedNote = `.${g.cls} is shared by ${g.usages} elements, so it was left unchanged.`;
  }
  const withShared = (r: StrategyResult): StrategyResult => (sharedNote ? { ...r, status: r.status === 'mapped' ? 'warning' : r.status, message: [r.message, sharedNote, 'Enable "edit shared class" to change the shared rule instead.'].filter(Boolean).join(' ') } : r);

  // 3. Tailwind utilities — unless an unlayered rule on one of the
  // element's classes sets the same property (utilities live in a cascade
  // layer and would silently lose).
  const literalEditable = !ctx.cls.attr || !!ctx.cls.literal || ctx.cls.attr.value?.expression?.type === 'TemplateLiteral';
  const blocking = unlayeredProps(ws, env.globalCss, statics.map((c) => c.name));
  const blocked = [...props].filter((p) => blocking.has(p));
  if (ws.project.hasTailwind && literalEditable && !blocked.length) {
    const current = ctx.classList ?? currentClassList(ctx);
    const res = applyToClassList(current, decls, bp);
    ctx.classList = res.classes;
    return withShared({
      strategy: 'tailwind',
      file: ws.rel(ctx.file.abs),
      detail: `${res.added.join(' ') || '(no change)'}${res.removed.length ? ` — replaces ${res.removed.join(' ')}` : ''}`,
      status: 'mapped',
    });
  }

  // 4. Base edits. If one of the element's classes has width-based @media
  // overrides for an edited property, an inline style would clobber the
  // site's responsive rules; add a scoped class right after that class's
  // base rule instead, so the @media overrides keep winning.
  if (bp === 'base') {
    const anchor = responsiveAnchor(ws, ctx, env.globalCss, props);
    if (anchor) {
      const name = scopedClassName(ctx);
      const root = ws.css(anchor.file)!;
      const rule = findBaseRule(root, anchor.selector)!;
      const isModule = /\.module\.css$/.test(anchor.file);
      const cls = isModule ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      insertRuleAfter(rule, `.${cls}`, decls);
      if (isModule) ctx.addModuleClass = `${anchor.binding}.${cls}`;
      else ctx.addGlobalClass = cls;
      return withShared({ strategy: isModule ? 'css-module' : 'css-rule', file: ws.rel(anchor.file), detail: `new class .${cls} after ${anchor.selector} (keeps its @media overrides)`, status: 'mapped' });
    }
    Object.assign(ctx.inlineStyle, decls);
    return withShared({ strategy: 'inline-style', file: ws.rel(ctx.file.abs), detail: `style={{ ${Object.keys(decls).map(camelCase).join(', ')} }}`, status: 'mapped' });
  }

  // 5. Breakpoint edit without an owned class: introduce a scoped class.
  const name = scopedClassName(ctx);
  const moduleBinding = Object.keys(ctx.modules)[0];
  if (moduleBinding) {
    const cssAbs = ctx.modules[moduleBinding];
    const root = ws.css(cssAbs, true)!;
    setDeclarations(root, `.${name}`, bp, decls);
    ctx.addModuleClass = `${moduleBinding}.${name}`;
    return withShared({ strategy: 'css-module', file: ws.rel(cssAbs), detail: `new class .${name}${bpNote}`, status: 'mapped' });
  }
  const globalFile = env.globalCss[0];
  if (globalFile) {
    const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const root = ws.css(globalFile)!;
    setDeclarations(root, `.${kebab}`, bp, decls);
    ctx.addGlobalClass = kebab;
    return withShared({ strategy: 'css-rule', file: ws.rel(globalFile), detail: `new class .${kebab}${bpNote}`, status: 'mapped' });
  }
  return { strategy: null, file: ws.rel(ctx.file.abs), detail: 'no stylesheet', status: 'unmapped', message: 'Breakpoint-specific styles need a stylesheet or Tailwind; this project has neither.' };
}

/** A base rule of one of the element's classes that has @media overrides for `props`. */
function responsiveAnchor(ws: Workspace, ctx: ElementCtx, globalCss: string[], props: Set<string>): { file: string; selector: string; binding: string } | null {
  const candidates: Array<{ file: string; selector: string; binding: string }> = [];
  for (const ref of ctx.cls.moduleRefs.filter((r) => !r.conditional)) candidates.push({ file: ctx.modules[ref.binding], selector: `.${ref.className}`, binding: ref.binding });
  for (const c of ctx.cls.staticClasses.filter((x) => !x.conditional && !propsOfUtility(x.name).length)) {
    for (const f of globalCss) candidates.push({ file: f, selector: `.${c.name}`, binding: '' });
  }
  for (const c of candidates) {
    const root = ws.peekCss(c.file);
    if (!root || !findBaseRule(root, c.selector)) continue;
    const media = mediaDeclaredProps(root, c.selector);
    if ([...props].some((p) => media.has(p))) return c;
  }
  return null;
}

/** Longhands set by the element's `style={{...}}` object literal. */
function inlineStyleProps(opening: AnyNode): Set<string> {
  const out = new Set<string>();
  const attr = getAttr(opening, 'style');
  const obj = attr?.value?.type === 'JSXExpressionContainer' && attr.value.expression.type === 'ObjectExpression' ? attr.value.expression : null;
  for (const p of obj?.properties ?? []) {
    if (p.type !== 'ObjectProperty' || p.computed) continue;
    const kebab = String(p.key.name ?? p.key.value).replace(/[A-Z]/g, (c: string) => `-${c.toLowerCase()}`);
    out.add(kebab);
    for (const l of SHORTHANDS[kebab] ?? []) out.add(l);
  }
  return out;
}

/** Longhands declared by unlayered rules targeting any of `classes`. */
function unlayeredProps(ws: Workspace, files: string[], classes: string[]): Set<string> {
  const out = new Set<string>();
  const selectors = new Set(classes.map((c) => `.${c}`));
  for (const abs of files) {
    const root = ws.peekCss(abs);
    root?.walkRules((rule) => {
      if (!selectors.has(rule.selector.trim())) return;
      type Parent = { type: string; name?: string; parent?: Parent };
      for (let p = rule.parent as Parent | undefined; p; p = p.parent) if (p.type === 'atrule' && p.name === 'layer') return;
      declaredProps(rule).forEach((d) => out.add(d));
    });
  }
  return out;
}

function currentClassList(ctx: ElementCtx): string[] {
  if (ctx.cls.literal) return String(ctx.cls.literal.value).split(/\s+/).filter(Boolean);
  const tpl = ctx.cls.attr?.value?.expression;
  if (tpl?.type === 'TemplateLiteral') {
    // Only the trailing static quasi is rewritten for templates.
    const last = tpl.quasis[tpl.quasis.length - 1];
    return String(last.value.cooked ?? last.value.raw).split(/\s+/).filter(Boolean);
  }
  return [];
}

function scopedClassName(ctx: ElementCtx): string {
  const base = path.basename(ctx.file.abs).replace(/\..*$/, '');
  const hint = ctx.cls.moduleRefs[0]?.className ?? ctx.cls.staticClasses.find((c) => !propsOfUtility(c.name).length)?.name ?? ctx.opening.name.name;
  const raw = camelCase(`${base.charAt(0).toLowerCase()}${base.slice(1)}-${hint}`.replace(/[^A-Za-z0-9-]/g, '-'));
  return raw.replace(/-+/g, '');
}

/** Write pending className / style changes for one element into the JSX. */
function flushElement(ctx: ElementCtx) {
  const { ms } = ctx.file;
  const code = ctx.file.code;
  const tagEnd: number = ctx.opening.name.end;

  if (ctx.classList || ctx.addModuleClass || ctx.addGlobalClass) {
    const attr = ctx.cls.attr;
    let classes = ctx.classList ?? currentClassList(ctx);
    if (ctx.addGlobalClass && !classes.includes(ctx.addGlobalClass)) classes = [...classes, ctx.addGlobalClass];
    const text = classes.join(' ');
    const moduleExpr = ctx.addModuleClass;
    if (!attr) {
      const value = moduleExpr ? (text ? `{\`${text} \${${moduleExpr}}\`}` : `{${moduleExpr}}`) : `"${text}"`;
      ms.appendLeft(tagEnd, ` className=${value}`);
    } else if (ctx.cls.literal) {
      const lit = ctx.cls.literal;
      if (moduleExpr) {
        const target = attr.value.type === 'StringLiteral' ? attr.value : attr.value;
        ms.overwrite(target.start, target.end, text ? `{\`${text} \${${moduleExpr}}\`}` : `{${moduleExpr}}`);
      } else {
        const quote = code[lit.start];
        ms.overwrite(lit.start, lit.end, `${quote}${escapeStringLiteral(text, quote)}${quote}`);
      }
    } else if (attr.value?.expression?.type === 'TemplateLiteral') {
      const tpl = attr.value.expression;
      const last = tpl.quasis[tpl.quasis.length - 1];
      let content = text;
      if (moduleExpr) content = content ? `${content} \${${moduleExpr}}` : `\${${moduleExpr}}`;
      if (tpl.quasis.length > 1 && content) content = ` ${content}`;
      if (last.end > last.start) ms.overwrite(last.start, last.end, content);
      else if (content) ms.appendLeft(last.start, content);
    } else if (attr.value?.type === 'JSXExpressionContainer' && (moduleExpr || ctx.addGlobalClass)) {
      // className={someVariable}: extend it locally rather than editing a
      // variable that other elements may share.
      const ex = attr.value.expression;
      const extra = [ctx.addGlobalClass, moduleExpr ? `\${${moduleExpr}}` : null].filter(Boolean).join(' ');
      ms.overwrite(attr.value.start, attr.value.end, `{\`\${${code.slice(ex.start, ex.end)}} ${extra}\`}`);
    }
  }

  const inline = Object.keys(ctx.inlineStyle).length ? ctx.inlineStyle : null;
  if (inline) {
    const styleAttr = getAttr(ctx.opening, 'style');
    const obj = styleAttr?.value?.type === 'JSXExpressionContainer' && styleAttr.value.expression.type === 'ObjectExpression' ? styleAttr.value.expression : null;
    const entries = compressDeclarations(inline);
    if (obj) {
      const additions: string[] = [];
      for (const [prop, value] of entries) {
        const key = camelCase(prop);
        const existing = obj.properties.find((p: AnyNode) => p.type === 'ObjectProperty' && !p.computed && (p.key.name === key || p.key.value === key));
        if (existing) ms.overwrite(existing.value.start, existing.value.end, styleValueLiteral(prop, value));
        else additions.push(`${key}: ${styleValueLiteral(prop, value)}`);
      }
      if (additions.length) {
        const last = obj.properties[obj.properties.length - 1];
        if (last) ms.appendLeft(last.end, `, ${additions.join(', ')}`);
        else ms.overwrite(obj.start, obj.end, `{ ${additions.join(', ')} }`);
      }
    } else if (!styleAttr) {
      const body = entries.map(([p, v]) => `${camelCase(p)}: ${styleValueLiteral(p, v)}`).join(', ');
      const lastAttr = ctx.opening.attributes[ctx.opening.attributes.length - 1];
      ms.appendLeft(lastAttr ? lastAttr.end : tagEnd, ` style={{ ${body} }}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function applyText(ws: Workspace, ctx: ElementCtx, original: string, value: string): StrategyResult {
  const want = normalizeText(original);
  const children: AnyNode[] = ctx.element.children ?? [];
  const texts = children.filter((c) => c.type === 'JSXText' && jsxTextValue(c).trim());
  const exprs = children.filter((c) => c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression');
  if (texts.length === 1 && !exprs.length && normalizeText(jsxTextValue(texts[0])) === want) {
    replaceJsxText(ctx.file, texts[0], value);
    return { strategy: 'jsx-text', file: ws.rel(ctx.file.abs), detail: `text of <${ctx.opening.name.name}>`, status: 'mapped' };
  }
  // Text comes from data or props: find the literal that produces it.
  const found = findTextLiteral(ws, ctx.file.abs, want);
  if (found.length === 1) {
    const hit = found[0];
    const file = ws.jsx(hit.abs)!;
    if (hit.node.type === 'JSXText') replaceJsxText(file, hit.node, value);
    else replaceStringLiteral(file, hit.node, value);
    return { strategy: hit.node.type === 'JSXText' ? 'jsx-text' : 'string-literal', file: ws.rel(hit.abs), detail: `"${truncate(original)}" at line ${hit.node.loc.start.line}`, status: 'mapped' };
  }
  if (found.length > 1) {
    return { strategy: null, file: ws.rel(ctx.file.abs), detail: 'ambiguous text', status: 'unmapped', message: `"${truncate(original)}" appears ${found.length} times in the project (${found.map((f) => `${ws.rel(f.abs)}:${f.node.loc.start.line}`).join(', ')}); refusing to guess which one to change.` };
  }
  return { strategy: null, file: ws.rel(ctx.file.abs), detail: 'text not found', status: 'unmapped', message: `Could not find a literal producing "${truncate(original)}". It may be computed at runtime (e.g. concatenated or formatted).` };
}

function truncate(s: string, n = 40) {
  const t = normalizeText(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function replaceJsxText(file: JsxFile, node: AnyNode, value: string) {
  const raw: string = file.code.slice(node.start, node.end);
  const lead = /^\s*/.exec(raw)![0].length;
  const trail = /\s*$/.exec(raw)![0].length;
  file.ms.overwrite(node.start + lead, node.end - trail, escapeJsxText(value));
}

function replaceStringLiteral(file: JsxFile, node: AnyNode, value: string) {
  const quote = node.type === 'TemplateLiteral' ? '`' : file.code[node.start];
  const escaped = quote === '`' ? value.replace(/[`\\]/g, (c) => `\\${c}`).replace(/\$\{/g, '\\${') : escapeStringLiteral(value, quote);
  file.ms.overwrite(node.start, node.end, `${quote}${escaped}${quote}`);
}

interface TextHit {
  abs: string;
  node: AnyNode;
}

/** Search the element's file first, then the whole project. */
function findTextLiteral(ws: Workspace, preferAbs: string, want: string): TextHit[] {
  const inFile = (abs: string): TextHit[] => {
    const ast = ws.ast(abs);
    if (!ast) return [];
    const hits: TextHit[] = [];
    walk(ast.program, (n, parent) => {
      if (n.type === 'JSXText' && normalizeText(jsxTextValue(n)) === want) hits.push({ abs, node: n });
      else if (n.type === 'StringLiteral' && normalizeText(n.value) === want && parent?.type !== 'ImportDeclaration' && parent?.type !== 'JSXAttribute') hits.push({ abs, node: n });
      else if (n.type === 'TemplateLiteral' && !n.expressions.length && normalizeText(n.quasis[0].value.cooked ?? '') === want) hits.push({ abs, node: n });
    });
    return hits;
  };
  const local = inFile(preferAbs);
  if (local.length) return local;
  return ws.project
    .sourceFiles()
    .filter((f) => JSX_EXT.test(f) && f !== preferAbs)
    .flatMap(inFile);
}

// ---------------------------------------------------------------------------
// Project indexes
// ---------------------------------------------------------------------------

function globalStylesheets(ws: Workspace): string[] {
  return ws.project
    .sourceFiles()
    .filter((f) => f.endsWith('.css') && !/\.module\.css$/.test(f))
    .filter((f) => {
      const code = ws.project.read(f) ?? '';
      return !/^\s*@import\s+['"]tailwindcss/m.test(code) || /\{/.test(code.replace(/@import[^;]+;/g, '').replace(/@layer[^;{]+;/g, ''));
    });
}

/** Counts how many JSX elements across the project use a static class name. */
class ClassUsageIndex {
  private counts: Map<string, number> | null = null;
  constructor(private ws: Workspace) {}

  count(cls: string): number {
    if (!this.counts) this.build();
    return this.counts!.get(cls) ?? 0;
  }

  private build() {
    this.counts = new Map();
    for (const abs of this.ws.project.sourceFiles().filter((f) => JSX_EXT.test(f))) {
      const ast = this.ws.ast(abs);
      if (!ast) continue;
      const modules = cssModuleImports(ast, abs);
      walk(ast.program, (n) => {
        if (n.type !== 'JSXOpeningElement') return;
        const info = analyzeClassName(ast, n, modules);
        const seen = new Set<string>();
        for (const c of info.staticClasses) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          this.counts!.set(c.name, (this.counts!.get(c.name) ?? 0) + 1);
        }
      });
    }
  }
}

export type { MappingStrategy };
