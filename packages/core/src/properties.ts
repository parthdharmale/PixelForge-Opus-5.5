/**
 * Metadata about the CSS properties PixelForge exposes for editing.
 *
 * The edit state always stores *longhand* properties (padding-top rather
 * than padding). The UI expands shorthand gestures into longhands, and the
 * code generator compresses longhands back into shorthands where the
 * result is equivalent and cleaner.
 */

export type PropertyKind = 'length' | 'color' | 'enum' | 'number' | 'text' | 'font';

export interface PropertyMeta {
  name: string;
  label: string;
  kind: PropertyKind;
  inherited: boolean;
  options?: string[];
  /** Allowed units for length inputs (first is default). */
  units?: string[];
  min?: number;
  max?: number;
  step?: number;
}

const L = ['px', '%', 'rem', 'em', 'vw', 'vh'];

function p(name: string, label: string, kind: PropertyKind, inherited = false, extra: Partial<PropertyMeta> = {}): PropertyMeta {
  return { name, label, kind, inherited, ...extra };
}

export const PROPERTIES: Record<string, PropertyMeta> = Object.fromEntries(
  [
    // Typography
    p('font-family', 'Font', 'font', true),
    p('font-size', 'Size', 'length', true, { units: ['px', 'rem', 'em', '%'], min: 0 }),
    p('font-weight', 'Weight', 'enum', true, { options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'] }),
    p('line-height', 'Line height', 'length', true, { units: ['', 'px', 'em', '%'], min: 0, step: 0.05 }),
    p('letter-spacing', 'Letter spacing', 'length', true, { units: ['px', 'em'], step: 0.1 }),
    p('text-align', 'Align', 'enum', true, { options: ['left', 'center', 'right', 'justify'] }),
    p('text-transform', 'Case', 'enum', true, { options: ['none', 'uppercase', 'lowercase', 'capitalize'] }),
    p('text-decoration-line', 'Decoration', 'enum', false, { options: ['none', 'underline', 'line-through'] }),
    p('color', 'Color', 'color', true),
    // Background
    p('background-color', 'Background', 'color'),
    p('background-image', 'Background image', 'text'),
    // Size
    p('width', 'Width', 'length', false, { units: [...L, 'auto'], min: 0 }),
    p('height', 'Height', 'length', false, { units: [...L, 'auto'], min: 0 }),
    p('min-width', 'Min W', 'length', false, { units: L, min: 0 }),
    p('max-width', 'Max W', 'length', false, { units: [...L, 'none'], min: 0 }),
    p('min-height', 'Min H', 'length', false, { units: L, min: 0 }),
    p('max-height', 'Max H', 'length', false, { units: [...L, 'none'], min: 0 }),
    // Spacing
    ...(['top', 'right', 'bottom', 'left'] as const).flatMap((s) => [
      p(`padding-${s}`, `Padding ${s}`, 'length', false, { units: ['px', 'rem', 'em', '%'], min: 0 }),
      p(`margin-${s}`, `Margin ${s}`, 'length', false, { units: ['px', 'rem', 'em', '%', 'auto'] }),
      p(`border-${s}-width`, `Border ${s} width`, 'length', false, { units: ['px'], min: 0 }),
      p(`border-${s}-style`, `Border ${s} style`, 'enum', false, { options: ['none', 'solid', 'dashed', 'dotted', 'double'] }),
      p(`border-${s}-color`, `Border ${s} color`, 'color'),
    ]),
    ...(['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((c) =>
      p(`border-${c}-radius`, `Radius ${c}`, 'length', false, { units: ['px', '%', 'rem'], min: 0 }),
    ),
    // Layout
    p('display', 'Display', 'enum', false, { options: ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'] }),
    p('flex-direction', 'Direction', 'enum', false, { options: ['row', 'column', 'row-reverse', 'column-reverse'] }),
    p('flex-wrap', 'Wrap', 'enum', false, { options: ['nowrap', 'wrap'] }),
    p('justify-content', 'Justify', 'enum', false, { options: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'] }),
    p('align-items', 'Align', 'enum', false, { options: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'] }),
    p('row-gap', 'Row gap', 'length', false, { units: ['px', 'rem', 'em', '%'], min: 0 }),
    p('column-gap', 'Column gap', 'length', false, { units: ['px', 'rem', 'em', '%'], min: 0 }),
    p('grid-template-columns', 'Columns', 'text'),
    p('grid-template-rows', 'Rows', 'text'),
    p('grid-auto-flow', 'Flow', 'enum', false, { options: ['row', 'column', 'dense', 'row dense'] }),
    p('grid-column', 'Grid column', 'text'),
    p('grid-row', 'Grid row', 'text'),
    p('flex-grow', 'Grow', 'number', false, { min: 0 }),
    p('flex-shrink', 'Shrink', 'number', false, { min: 0 }),
    p('flex-basis', 'Basis', 'length', false, { units: [...L, 'auto'] }),
    p('align-self', 'Align self', 'enum', false, { options: ['auto', 'flex-start', 'center', 'flex-end', 'stretch'] }),
    p('order', 'Order', 'number'),
    // Position
    p('position', 'Position', 'enum', false, { options: ['static', 'relative', 'absolute', 'fixed', 'sticky'] }),
    p('top', 'Top', 'length', false, { units: [...L, 'auto'] }),
    p('right', 'Right', 'length', false, { units: [...L, 'auto'] }),
    p('bottom', 'Bottom', 'length', false, { units: [...L, 'auto'] }),
    p('left', 'Left', 'length', false, { units: [...L, 'auto'] }),
    p('z-index', 'Z-index', 'number'),
    // Effects
    p('opacity', 'Opacity', 'number', false, { min: 0, max: 1, step: 0.05 }),
    p('visibility', 'Visibility', 'enum', true, { options: ['visible', 'hidden'] }),
    p('box-shadow', 'Shadow', 'text'),
    p('overflow', 'Overflow', 'enum', false, { options: ['visible', 'hidden', 'auto', 'scroll'] }),
    p('transform', 'Transform', 'text'),
  ].map((m) => [m.name, m]),
);

export const TRACKED_PROPERTIES = Object.keys(PROPERTIES);

export function isInheritedProperty(prop: string): boolean {
  return PROPERTIES[prop]?.inherited ?? false;
}

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;

/** Shorthands we know how to expand into longhands and compress back. */
export const SHORTHANDS: Record<string, string[]> = {
  padding: SIDES.map((s) => `padding-${s}`),
  margin: SIDES.map((s) => `margin-${s}`),
  'border-width': SIDES.map((s) => `border-${s}-width`),
  'border-style': SIDES.map((s) => `border-${s}-style`),
  'border-color': SIDES.map((s) => `border-${s}-color`),
  'border-radius': CORNERS.map((c) => `border-${c}-radius`),
  gap: ['row-gap', 'column-gap'],
  inset: ['top', 'right', 'bottom', 'left'],
};

/** Shorthand that covers a longhand, e.g. padding-top -> padding. */
export function shorthandFor(longhand: string): string | null {
  for (const [sh, longs] of Object.entries(SHORTHANDS)) if (longs.includes(longhand)) return sh;
  if (/^border-(top|right|bottom|left)-(width|style|color)$/.test(longhand)) return 'border';
  if (longhand === 'background-color' || longhand === 'background-image') return 'background';
  return null;
}

/**
 * Split a CSS value on top-level whitespace, respecting parentheses
 * (so `calc(1px + 2px) 4px` is two tokens).
 */
export function splitValue(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Expand a box shorthand (1-4 values) into [top, right, bottom, left]. */
export function expandBox(value: string): [string, string, string, string] | null {
  const v = splitValue(value);
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  if (v.length === 4) return [v[0], v[1], v[2], v[3]];
  return null;
}

/** Compress [top, right, bottom, left] into the shortest box shorthand. */
export function compressBox([t, r, b, l]: string[]): string {
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

/** Expand a shorthand declaration into longhands. Returns null if unsupported. */
export function expandShorthand(prop: string, value: string): Record<string, string> | null {
  const longs = SHORTHANDS[prop];
  if (!longs) return null;
  if (prop === 'gap') {
    const v = splitValue(value);
    if (v.length < 1 || v.length > 2) return null;
    return { 'row-gap': v[0], 'column-gap': v[1] ?? v[0] };
  }
  if (prop === 'border-radius' && value.includes('/')) return null;
  const box = expandBox(value);
  if (!box) return null;
  return Object.fromEntries(longs.map((l, i) => [l, box[i]]));
}

/**
 * Compress a set of longhand declarations into shorthands where all
 * members of a shorthand group are present. Order is preserved as much as
 * possible (shorthand takes the position of its first longhand).
 */
export function compressDeclarations(decls: Record<string, string>): Array<[string, string]> {
  const entries = Object.entries(decls);
  const consumed = new Set<string>();
  const out: Array<[string, string]> = [];
  for (const [prop, value] of entries) {
    if (consumed.has(prop)) continue;
    const sh = Object.entries(SHORTHANDS).find(([name, longs]) => name !== 'inset' && longs.includes(prop));
    if (sh) {
      const [name, longs] = sh;
      if (longs.every((l) => l in decls)) {
        longs.forEach((l) => consumed.add(l));
        const values = longs.map((l) => decls[l]);
        if (name === 'gap') out.push([name, values[0] === values[1] ? values[0] : `${values[0]} ${values[1]}`]);
        else out.push([name, compressBox(values)]);
        continue;
      }
    }
    consumed.add(prop);
    out.push([prop, value]);
  }
  // border-width/style/color all uniform -> border
  const idx = (n: string) => out.findIndex(([p]) => p === n);
  const bw = idx('border-width');
  const bs = idx('border-style');
  const bc = idx('border-color');
  if (bw >= 0 && bs >= 0 && bc >= 0) {
    const [w, s, c] = [out[bw][1], out[bs][1], out[bc][1]];
    if (![w, s, c].some((v) => splitValue(v).length > 1)) {
      const first = Math.min(bw, bs, bc);
      const merged: [string, string] = ['border', `${w} ${s} ${c}`];
      const rest = out.filter((_, i) => i !== bw && i !== bs && i !== bc);
      rest.splice(first, 0, merged);
      return rest;
    }
  }
  return out;
}

/** Normalize a user-entered value: bare numbers on length props get `px`. */
export function normalizeValue(prop: string, raw: string): string {
  const value = raw.trim();
  const meta = PROPERTIES[prop];
  if (!meta) return value;
  if (meta.kind === 'length' && /^-?\d*\.?\d+$/.test(value)) {
    if (prop === 'line-height') return value;
    return value === '0' ? '0px' : `${value}px`;
  }
  return value;
}

/** Parse a CSS length into number + unit, or null. */
export function parseLength(value: string | null | undefined): { n: number; unit: string } | null {
  if (!value) return null;
  const m = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(value.trim());
  if (!m) return null;
  return { n: Number(m[1]), unit: m[2] };
}

export function formatNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}
