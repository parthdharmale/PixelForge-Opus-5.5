/**
 * CSS declarations <-> Tailwind v4 utilities.
 *
 * Mapping prefers named scale values when they are exact (p-4, gap-6,
 * rounded-lg, font-semibold) and falls back to arbitrary values
 * (p-[13px], bg-[#1e293b]) otherwise. Utilities that set extra properties
 * implicitly (text-sm also sets line-height) are avoided so that the
 * source edit reproduces exactly what the editor previewed.
 */
import { compressDeclarations, splitValue, type BreakpointId, getBreakpoint } from '@pixelforge/core';

const SIDE_SUFFIX: Record<string, string> = { top: 't', right: 'r', bottom: 'b', left: 'l' };
const CORNER_SUFFIX: Record<string, string> = { 'top-left': 'tl', 'top-right': 'tr', 'bottom-right': 'br', 'bottom-left': 'bl' };

function arb(value: string): string {
  return `[${value.trim().replace(/\s*,\s*/g, ',').replace(/\s+/g, '_')}]`;
}

function toPx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());
  if (!m) return value.trim() === '0' ? 0 : null;
  return m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
}

/** Spacing scale token: 16px -> "4", 2px -> "0.5", 13px -> "[13px]". */
function spacing(value: string, allowAuto = false): string {
  const v = value.trim();
  if (allowAuto && v === 'auto') return 'auto';
  if (v === '0' || v === '0px') return '0';
  if (v === '1px') return 'px';
  const px = toPx(v);
  if (px !== null && px >= 0) {
    const n = px / 4;
    if (Number.isInteger(n * 2)) return String(n);
  }
  return arb(v);
}

function signed(prefix: string, value: string, allowAuto = true): string {
  const v = value.trim();
  if (v.startsWith('-') && toPx(v) !== null) {
    const tok = spacing(v.slice(1));
    return `-${prefix}-${tok}`;
  }
  return `${prefix}-${spacing(v, allowAuto)}`;
}

function size(prefix: string, value: string): string {
  const v = value.trim();
  const named: Record<string, string> = { '100%': 'full', auto: 'auto', '100vw': 'screen', '100vh': 'screen', 'fit-content': 'fit', 'min-content': 'min', 'max-content': 'max', '50%': '1/2', '33.3333%': '1/3', '25%': '1/4', '75%': '3/4', none: 'none' };
  if (named[v]) return `${prefix}-${named[v]}`;
  return `${prefix}-${spacing(v)}`;
}

const WEIGHTS: Record<string, string> = { '100': 'thin', '200': 'extralight', '300': 'light', '400': 'normal', '500': 'medium', '600': 'semibold', '700': 'bold', '800': 'extrabold', '900': 'black', normal: 'normal', bold: 'bold' };
const RADII: Record<number, string> = { 0: 'none', 2: 'xs', 4: 'sm', 6: 'md', 8: 'lg', 12: 'xl', 16: '2xl', 24: '3xl', 9999: 'full' };
const BORDER_WIDTHS: Record<string, string> = { '0px': '0', '1px': '', '2px': '2', '4px': '4', '8px': '8' };
const JUSTIFY: Record<string, string> = { 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', 'space-between': 'between', 'space-around': 'around', 'space-evenly': 'evenly', stretch: 'stretch', normal: 'normal' };
const ALIGN: Record<string, string> = { 'flex-start': 'start', start: 'start', center: 'center', 'flex-end': 'end', end: 'end', baseline: 'baseline', stretch: 'stretch', auto: 'auto' };
/** Tailwind v4 default line-height paired with each named text size. */
const TEXT_LEADING: Record<string, string> = { xs: 'calc(1/0.75)', sm: 'calc(1.25/0.875)', base: '1.5', lg: 'calc(1.75/1.125)', xl: 'calc(1.75/1.25)', '2xl': 'calc(2/1.5)', '3xl': '1.2', '4xl': 'calc(2.5/2.25)', '5xl': '1', '6xl': '1', '7xl': '1', '8xl': '1', '9xl': '1' };
const LEADING: Record<string, string> = { '1': 'none', '1.25': 'tight', '1.375': 'snug', '1.5': 'normal', '1.625': 'relaxed', '2': 'loose' };

/** Map one declaration (possibly a shorthand) to utilities (without variant). */
export function utilitiesFor(prop: string, value: string): string[] {
  const v = value.trim();
  const box = (prefix: string, allowAuto: boolean): string[] => {
    const parts = splitValue(v);
    const [t, r = t, b = t, l = r] = parts;
    const mk = (p: string, val: string) => (allowAuto ? signed(p, val) : `${p}-${spacing(val)}`);
    if (t === r && r === b && b === l) return [mk(prefix, t)];
    if (t === b && r === l) return [mk(`${prefix}y`, t), mk(`${prefix}x`, r)];
    return [mk(`${prefix}t`, t), mk(`${prefix}r`, r), mk(`${prefix}b`, b), mk(`${prefix}l`, l)];
  };
  let m: RegExpExecArray | null;
  switch (prop) {
    case 'padding':
      return box('p', false);
    case 'margin':
      return box('m', true);
    case 'gap': {
      const [row, col = row] = splitValue(v);
      return row === col ? [`gap-${spacing(row)}`] : [`gap-y-${spacing(row)}`, `gap-x-${spacing(col)}`];
    }
    case 'row-gap':
      return [`gap-y-${spacing(v)}`];
    case 'column-gap':
      return [`gap-x-${spacing(v)}`];
    case 'width':
      return [size('w', v)];
    case 'height':
      return [size('h', v)];
    case 'min-width':
      return [size('min-w', v)];
    case 'max-width':
      return [size('max-w', v)];
    case 'min-height':
      return [size('min-h', v)];
    case 'max-height':
      return [size('max-h', v)];
    case 'font-size':
      return [`text-${arb(v)}`];
    case 'font-weight':
      return [WEIGHTS[v] ? `font-${WEIGHTS[v]}` : `font-${arb(v)}`];
    case 'line-height':
      return [LEADING[v] ? `leading-${LEADING[v]}` : `leading-${arb(v)}`];
    case 'letter-spacing':
      return [`tracking-${arb(v)}`];
    case 'text-align':
      return [`text-${v}`];
    case 'text-transform':
      return [v === 'none' ? 'normal-case' : v];
    case 'color':
      return [`text-${arb(v)}`];
    case 'background-color':
    case 'background':
      return [`bg-${arb(v)}`];
    case 'opacity': {
      const n = Number(v) * 100;
      return [Number.isInteger(n) ? `opacity-${n}` : `opacity-${arb(v)}`];
    }
    case 'display':
      return [v === 'none' ? 'hidden' : v];
    case 'visibility':
      return [v === 'hidden' ? 'invisible' : 'visible'];
    case 'position':
      return [v];
    case 'flex-direction':
      return [{ row: 'flex-row', column: 'flex-col', 'row-reverse': 'flex-row-reverse', 'column-reverse': 'flex-col-reverse' }[v] ?? `[flex-direction:${v}]`];
    case 'flex-wrap':
      return [v === 'wrap' ? 'flex-wrap' : v === 'nowrap' ? 'flex-nowrap' : 'flex-wrap-reverse'];
    case 'justify-content':
      return [JUSTIFY[v] ? `justify-${JUSTIFY[v]}` : `[justify-content:${v}]`];
    case 'align-items':
      return [ALIGN[v] ? `items-${ALIGN[v]}` : `[align-items:${v}]`];
    case 'align-self':
      return [ALIGN[v] ? `self-${ALIGN[v]}` : `[align-self:${v}]`];
    case 'flex-grow':
      return [v === '1' ? 'grow' : v === '0' ? 'grow-0' : `grow-${arb(v)}`];
    case 'flex-shrink':
      return [v === '1' ? 'shrink' : v === '0' ? 'shrink-0' : `shrink-${arb(v)}`];
    case 'grid-template-columns':
      if ((m = /^repeat\((\d+),\s*(?:minmax\(0(?:px)?,\s*1fr\)|1fr)\)$/.exec(v))) return [`grid-cols-${m[1]}`];
      return [`grid-cols-${arb(v)}`];
    case 'grid-template-rows':
      if ((m = /^repeat\((\d+),\s*(?:minmax\(0(?:px)?,\s*1fr\)|1fr)\)$/.exec(v))) return [`grid-rows-${m[1]}`];
      return [`grid-rows-${arb(v)}`];
    case 'z-index':
      return [/^\d+$/.test(v) && Number(v) % 10 === 0 && Number(v) <= 50 ? `z-${v}` : `z-${arb(v)}`];
    case 'top':
    case 'right':
    case 'bottom':
    case 'left':
      return [signed(prop, v)];
    case 'border-radius': {
      const parts = splitValue(v);
      if (parts.length === 1) return [radius('rounded', v)];
      const [tl, tr = tl, br = tl, bl = tr] = parts;
      return [radius('rounded-tl', tl), radius('rounded-tr', tr), radius('rounded-br', br), radius('rounded-bl', bl)];
    }
    case 'border-width': {
      const parts = splitValue(v);
      if (parts.length === 1) return [borderWidth('border', v)];
      const [t, r = t, b = t, l = r] = parts;
      return [borderWidth('border-t', t), borderWidth('border-r', r), borderWidth('border-b', b), borderWidth('border-l', l)];
    }
    case 'border-style':
      return splitValue(v).length === 1 ? [`border-${v}`] : [`[border-style:${arb(v).slice(1, -1)}]`];
    case 'border-color':
      return splitValue(v).length === 1 ? [`border-${arb(v)}`] : [`[border-color:${arb(v).slice(1, -1)}]`];
    case 'border': {
      const [w, s, c] = splitValue(v);
      return [borderWidth('border', w ?? '1px'), `border-${s ?? 'solid'}`, ...(c ? [`border-${arb(c)}`] : [])];
    }
  }
  let side: RegExpExecArray | null;
  if ((side = /^padding-(top|right|bottom|left)$/.exec(prop))) return [`p${SIDE_SUFFIX[side[1]]}-${spacing(v)}`];
  if ((side = /^margin-(top|right|bottom|left)$/.exec(prop))) return [signed(`m${SIDE_SUFFIX[side[1]]}`, v)];
  if ((side = /^border-(top|right|bottom|left)-width$/.exec(prop))) return [borderWidth(`border-${SIDE_SUFFIX[side[1]]}`, v)];
  if ((side = /^border-(top|right|bottom|left)-color$/.exec(prop))) return [`border-${SIDE_SUFFIX[side[1]]}-${arb(v)}`];
  if ((side = /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.exec(prop))) return [radius(`rounded-${CORNER_SUFFIX[side[1]]}`, v)];
  // Universal fallback: Tailwind arbitrary property.
  return [`[${prop}:${arb(v).slice(1, -1)}]`];
}

function radius(prefix: string, v: string): string {
  const px = toPx(v);
  if (v === '50%') return `${prefix}-full`;
  if (px !== null && RADII[px] !== undefined) return `${prefix}-${RADII[px]}`;
  return `${prefix}-${arb(v)}`;
}

function borderWidth(prefix: string, v: string): string {
  if (BORDER_WIDTHS[v] !== undefined) return BORDER_WIDTHS[v] ? `${prefix}-${BORDER_WIDTHS[v]}` : prefix;
  return `${prefix}-${arb(v)}`;
}

// ---------------------------------------------------------------------------
// Reverse mapping: which longhands does an existing utility control?
// ---------------------------------------------------------------------------

const SIDES = ['top', 'right', 'bottom', 'left'];
const sides = (p: string, which: string[] = SIDES) => which.map((s) => `${p}-${s}`);
const AXIS: Record<string, string[]> = { '': SIDES, x: ['left', 'right'], y: ['top', 'bottom'], t: ['top'], r: ['right'], b: ['bottom'], l: ['left'] };
const COLOR_WORDS = /^(inherit|current|transparent|black|white|(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})(\/\d+)?$/;

export function propsOfUtility(utility: string): string[] {
  const u = utility.replace(/^-/, '').replace(/!$/, '').replace(/^!/, '');
  let m: RegExpExecArray | null;
  if ((m = /^p([xytrbl]?)-(.+)$/.exec(u))) return sides('padding', AXIS[m[1]]);
  if ((m = /^m([xytrbl]?)-(.+)$/.exec(u))) return sides('margin', AXIS[m[1]]);
  if ((m = /^gap-([xy])-/.exec(u))) return [m[1] === 'x' ? 'column-gap' : 'row-gap'];
  if (/^gap-/.test(u)) return ['row-gap', 'column-gap'];
  if (/^w-/.test(u)) return ['width'];
  if (/^h-/.test(u)) return ['height'];
  if (/^size-/.test(u)) return ['width', 'height'];
  if (/^min-w-/.test(u)) return ['min-width'];
  if (/^max-w-/.test(u)) return ['max-width'];
  if (/^min-h-/.test(u)) return ['min-height'];
  if (/^max-h-/.test(u)) return ['max-height'];
  if (/^text-(left|center|right|justify|start|end)$/.test(u)) return ['text-align'];
  if (/^text-(xs|sm|base|lg|xl|\dxl)(\/.*)?$/.test(u)) return ['font-size', 'line-height'];
  if ((m = /^text-\[(.+)\]$/.exec(u))) return /^-?[\d.]+(px|rem|em|%)$/.test(m[1]) || m[1].startsWith('length:') ? ['font-size'] : ['color'];
  if ((m = /^text-(.+)$/.exec(u)) && COLOR_WORDS.test(m[1])) return ['color'];
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(u) || /^font-\[\d+\]$/.test(u)) return ['font-weight'];
  if (/^font-(sans|serif|mono)$/.test(u)) return ['font-family'];
  if (/^leading-/.test(u)) return ['line-height'];
  if (/^tracking-/.test(u)) return ['letter-spacing'];
  if (/^(uppercase|lowercase|capitalize|normal-case)$/.test(u)) return ['text-transform'];
  if (/^bg-/.test(u) && !/^bg-(gradient|linear|radial|conic|none|cover|contain|center|fixed|no-repeat|repeat)/.test(u)) return ['background-color'];
  if (/^opacity-/.test(u)) return ['opacity'];
  if (/^(block|flex|grid|inline|inline-block|inline-flex|inline-grid|hidden|contents|table|flow-root)$/.test(u)) return ['display'];
  if (/^(visible|invisible|collapse)$/.test(u)) return ['visibility'];
  if (/^(static|relative|absolute|fixed|sticky)$/.test(u)) return ['position'];
  if (/^flex-(row|col)(-reverse)?$/.test(u)) return ['flex-direction'];
  if (/^flex-(wrap|nowrap|wrap-reverse)$/.test(u)) return ['flex-wrap'];
  if (/^justify-(start|end|center|between|around|evenly|stretch|normal)$/.test(u)) return ['justify-content'];
  if (/^items-/.test(u)) return ['align-items'];
  if (/^self-/.test(u)) return ['align-self'];
  if (/^grow/.test(u)) return ['flex-grow'];
  if (/^shrink/.test(u)) return ['flex-shrink'];
  if (/^grid-cols-/.test(u)) return ['grid-template-columns'];
  if (/^grid-rows-/.test(u)) return ['grid-template-rows'];
  if (/^z-/.test(u)) return ['z-index'];
  if ((m = /^(top|right|bottom|left)-/.exec(u))) return [m[1]];
  if (/^inset-/.test(u)) return ['top', 'right', 'bottom', 'left'];
  if ((m = /^rounded(?:-(t|r|b|l|tl|tr|br|bl))?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|full|\[.+\]))?$/.exec(u))) {
    const corners: Record<string, string[]> = { '': ['top-left', 'top-right', 'bottom-right', 'bottom-left'], t: ['top-left', 'top-right'], r: ['top-right', 'bottom-right'], b: ['bottom-right', 'bottom-left'], l: ['top-left', 'bottom-left'], tl: ['top-left'], tr: ['top-right'], br: ['bottom-right'], bl: ['bottom-left'] };
    return corners[m[1] ?? ''].map((c) => `border-${c}-radius`);
  }
  if ((m = /^border(?:-([xytrbl]))?(?:-(\d+|\[\d+px\]))?$/.exec(u))) return AXIS[m[1] ?? ''].map((s) => `border-${s}-width`);
  if (/^border-(solid|dashed|dotted|double|none|hidden)$/.test(u)) return SIDES.map((s) => `border-${s}-style`);
  if ((m = /^border(?:-([xytrbl]))?-(.+)$/.exec(u)) && (COLOR_WORDS.test(m[2]) || m[2].startsWith('['))) return AXIS[m[1] ?? ''].map((s) => `border-${s}-color`);
  if ((m = /^\[([a-z-]+):.+\]$/.exec(u))) return [m[1]];
  return [];
}

export interface ParsedClass {
  raw: string;
  variants: string[];
  utility: string;
}

export function parseClass(raw: string): ParsedClass {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ':' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  return { raw, variants: parts, utility: cur };
}

export function variantFor(bp: BreakpointId): string[] {
  const v = getBreakpoint(bp).tailwindVariant;
  return v ? [v] : [];
}

/**
 * Apply declarations to a class list at a breakpoint: utilities with the
 * same variant that are fully superseded are removed, new utilities are
 * appended. Unrelated classes (including semantic ones) are untouched.
 */
export function applyToClassList(classes: string[], decls: Record<string, string>, bp: BreakpointId): { classes: string[]; added: string[]; removed: string[] } {
  const variant = variantFor(bp).join(':');
  const compressed = compressDeclarations(decls);
  const added: string[] = [];
  const setProps = new Set<string>();
  for (const [prop, value] of compressed) {
    for (const u of utilitiesFor(prop, value)) {
      added.push(variant ? `${variant}:${u}` : u);
      propsOfUtility(u).forEach((p) => setProps.add(p));
    }
  }
  const removed: string[] = [];
  const hasLeading = classes.some((c) => {
    const pc = parseClass(c);
    return pc.variants.join(':') === variant && /^leading-/.test(pc.utility);
  });
  const kept = classes.filter((c) => {
    const pc = parseClass(c);
    if (pc.variants.join(':') !== variant) return true;
    const props = propsOfUtility(pc.utility);
    if (props.length && props.every((p) => setProps.has(p))) {
      removed.push(c);
      return false;
    }
    // Named text sizes also set line-height; keep that line-height explicitly
    // when only the font size is being replaced.
    const size = /^text-(xs|sm|base|lg|xl|\dxl)$/.exec(pc.utility);
    if (size && setProps.has('font-size') && !setProps.has('line-height')) {
      removed.push(c);
      if (!hasLeading && TEXT_LEADING[size[1]]) added.push(variant ? `${variant}:leading-[${TEXT_LEADING[size[1]]}]` : `leading-[${TEXT_LEADING[size[1]]}]`);
      return false;
    }
    return true;
  });
  const addedFresh = added.filter((a) => !kept.includes(a));
  return { classes: [...kept, ...addedFresh], added: addedFresh, removed };
}
