/**
 * Breakpoint model.
 *
 * PixelForge uses a desktop-first cascade (the same model Webflow uses):
 *   - `base`   applies at every width (no media query)
 *   - `tablet` applies at widths <= 1023px and overrides `base`
 *   - `mobile` applies at widths <= 767px and overrides `tablet` and `base`
 *
 * The thresholds line up with Tailwind's default `lg` (1024) and `md` (768)
 * screens so breakpoint edits can be expressed as `max-lg:` / `max-md:`
 * variants without changing semantics.
 */
export type BreakpointId = 'base' | 'tablet' | 'mobile';

export interface Breakpoint {
  id: BreakpointId;
  label: string;
  /** Inclusive upper bound in CSS px, or null for "all widths". */
  maxWidth: number | null;
  /** Media query condition (without `@media`), or null for base. */
  media: string | null;
  /** Tailwind v4 variant prefix producing the same range. */
  tailwindVariant: string | null;
}

export const BREAKPOINTS: readonly Breakpoint[] = [
  { id: 'base', label: 'All sizes', maxWidth: null, media: null, tailwindVariant: null },
  { id: 'tablet', label: 'Tablet & below', maxWidth: 1023, media: '(max-width: 1023px)', tailwindVariant: 'max-lg' },
  { id: 'mobile', label: 'Mobile', maxWidth: 767, media: '(max-width: 767px)', tailwindVariant: 'max-md' },
] as const;

/** Cascade order: later entries override earlier ones when their media matches. */
export const BREAKPOINT_ORDER: readonly BreakpointId[] = ['base', 'tablet', 'mobile'];

export function getBreakpoint(id: BreakpointId): Breakpoint {
  const bp = BREAKPOINTS.find((b) => b.id === id);
  if (!bp) throw new Error(`Unknown breakpoint ${id}`);
  return bp;
}

/** The most specific breakpoint that is active at a given viewport width. */
export function breakpointForWidth(width: number): BreakpointId {
  if (width <= 767) return 'mobile';
  if (width <= 1023) return 'tablet';
  return 'base';
}

/** Breakpoints whose rules are active at a given width, in cascade order. */
export function activeBreakpoints(width: number): BreakpointId[] {
  return BREAKPOINT_ORDER.filter((id) => {
    const bp = getBreakpoint(id);
    return bp.maxWidth === null || width <= bp.maxWidth;
  });
}

export interface ViewportPreset {
  id: 'desktop' | 'tablet' | 'mobile';
  label: string;
  width: number;
  height: number;
}

export const VIEWPORT_PRESETS: readonly ViewportPreset[] = [
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900 },
  { id: 'tablet', label: 'Tablet', width: 834, height: 1112 },
  { id: 'mobile', label: 'Mobile', width: 390, height: 844 },
];

/**
 * Parse a media query condition into an approximate max-width, so that
 * existing `@media (max-width: 767px)` blocks in user stylesheets can be
 * matched to a breakpoint. Returns null for queries we do not understand.
 */
export function mediaToBreakpoint(media: string): BreakpointId | null {
  const m = media.replace(/\s+/g, ' ').trim().toLowerCase();
  const maxWidth = /^(?:screen and |only screen and )?\(max-width: ?(\d+(?:\.\d+)?)px\)$/.exec(m);
  if (maxWidth) {
    const w = Number(maxWidth[1]);
    if (w === 767 || w === 767.98 || w === 768) return 'mobile';
    if (w === 1023 || w === 1023.98 || w === 1024) return 'tablet';
  }
  const lt = /^\(width < ?(\d+)(px|rem)\)$/.exec(m);
  if (lt) {
    const px = lt[2] === 'rem' ? Number(lt[1]) * 16 : Number(lt[1]);
    if (px === 768) return 'mobile';
    if (px === 1024) return 'tablet';
  }
  return null;
}
