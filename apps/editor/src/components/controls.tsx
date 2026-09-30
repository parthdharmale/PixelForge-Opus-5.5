/**
 * Property controls for the inspector. Every control reads its value and
 * provenance through `usePropState` and writes through `setStyles`, so
 * edits are breakpoint-aware and undoable.
 */
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BREAKPOINTS, formatNumber, parseLength, PROPERTIES, type BreakpointId, type PropertyOrigin } from '@pixelforge/core';
import { selectNode } from '../state/controller';
import { setStyles, targetFor } from '../state/edits';
import { useEditor } from '../state/store';

export interface PropState {
  prop: string;
  value: string;
  computed: string;
  edited: string | null;
  editedElsewhere: BreakpointId[];
  origin: PropertyOrigin | null;
  suppressedBy: string | null;
}

export function usePropState(prop: string): PropState {
  const details = useEditor((s) => s.details);
  const bp = useEditor((s) => s.editBreakpoint);
  const present = useEditor((s) => s.history.present);
  const suppressed = useEditor((s) => s.applyResult.suppressed);
  const computed = details?.computed[prop] ?? '';
  if (!details) return { prop, value: '', computed: '', edited: null, editedElsewhere: [], origin: null, suppressedBy: null };
  const key = targetFor(details).key;
  const per = present.styles[key] ?? {};
  const edited = per[bp]?.[prop] ?? null;
  const editedElsewhere = BREAKPOINTS.map((b) => b.id).filter((b) => b !== bp && per[b]?.[prop] !== undefined);
  const origin = details.origins[prop] ?? null;
  const spec = origin?.specified;
  const raw = edited ?? (spec && !/var\(|calc\(|,/.test(spec) && origin?.kind !== 'inherited' ? spec : computed);
  // Computed lengths come back with sub-pixel precision; show 2 decimals max.
  const value = edited ? raw : raw.replace(/(-?\d+\.\d{3,})px/g, (_m, n: string) => `${formatNumber(Number(n))}px`);
  const sup = suppressed.find((x) => x.key === key && x.property === prop);
  return { prop, value, computed, edited, editedElsewhere, origin, suppressedBy: sup ? sup.media : null };
}

function originText(ps: PropState): string {
  const o = ps.origin;
  const lines: string[] = [];
  if (ps.edited) lines.push(`Edited in PixelForge: ${ps.edited}`);
  if (!o) return lines.join('\n');
  if (o.kind === 'default') lines.push(`Browser default / initial value (${o.computed})`);
  if (o.kind === 'inherited') lines.push(`Inherited from ${o.inheritedFrom?.label}: ${o.winner?.value}  — ${o.winner?.selector} (${o.winner?.source})`);
  if (o.kind === 'rule' || o.kind === 'inline') lines.push(`${o.winner?.selector} { ${ps.prop}: ${o.winner?.value}${o.winner?.important ? ' !important' : ''} }\n${o.winner?.source}${o.winner?.media ? ` @media ${o.winner.media}` : ''}`);
  if (o.kind === 'editor') lines.push('Currently applied by a PixelForge override');
  if (o.overridden.length) lines.push(`Overrides: ${o.overridden.map((d) => `${d.selector} (${d.value})`).join(', ')}`);
  if (o.specified && o.specified !== o.computed) lines.push(`Computed: ${o.computed}`);
  if (ps.suppressedBy) lines.push(`Not applied at this width: the site's @media ${ps.suppressedBy} rule wins. Edit at this breakpoint to override it.`);
  return lines.join('\n');
}

export function OriginDot({ ps }: { ps: PropState }) {
  const kind = ps.edited ? 'editor' : ps.origin?.kind ?? 'default';
  return (
    <span
      className={`origin-dot ${kind}`}
      title={originText(ps)}
      onClick={(e) => {
        if (ps.origin?.kind === 'inherited' && ps.origin.inheritedFrom) {
          e.stopPropagation();
          void selectNode(ps.origin.inheritedFrom.nodeId, { scroll: true });
        }
      }}
      style={{ cursor: ps.origin?.kind === 'inherited' ? 'pointer' : undefined }}
    />
  );
}

export function Field({ label, prop, children, scrub }: { label: string; prop: string; children: ReactNode; scrub?: (delta: number) => void }) {
  const ps = usePropState(prop);
  const drag = useRef<{ x: number; acc: number } | null>(null);
  return (
    <div className={`field ${ps.edited ? 'edited' : ''}`} data-prop={prop}>
      <label
        className={`field-label ${scrub ? 'scrub' : ''}`}
        onPointerDown={(e) => {
          if (!scrub) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, acc: 0 };
        }}
        onPointerMove={(e) => {
          if (!drag.current || !scrub) return;
          const d = Math.trunc((e.clientX - drag.current.x) / 3);
          if (d !== drag.current.acc) {
            scrub((d - drag.current.acc) * (e.shiftKey ? 10 : 1));
            drag.current.acc = d;
          }
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <OriginDot ps={ps} />
        <span>{label}</span>
        {ps.suppressedBy && (
          <span className="mark warn" title={originText(ps)}>
            !
          </span>
        )}
        {ps.editedElsewhere.length > 0 && (
          <span className="mark" title={`Also edited at: ${ps.editedElsewhere.join(', ')}`}>
            +{ps.editedElsewhere.length}
          </span>
        )}
      </label>
      <div className="field-control">
        {children}
        {ps.edited && (
          <button className="reset-btn" title="Remove this edit" onClick={() => setStyles({ [prop]: null }, { coalesce: false })}>
            <RotateCcw size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Text input that commits on Enter/blur and reverts on Escape. */
export function CommitInput({ value, onCommit, placeholder, className = 'input', testId, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; testId?: string; mono?: boolean }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={`${className} ${mono ? 'mono' : ''}`}
      value={draft}
      placeholder={placeholder}
      data-testid={testId}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        if (draft.trim() !== value) onCommit(draft.trim());
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function step(value: string, delta: number, fallbackUnit = 'px'): string | null {
  const len = parseLength(value);
  if (!len) return null;
  return `${formatNumber(len.n + delta)}${len.unit || (fallbackUnit === '' ? '' : len.n === 0 ? fallbackUnit : '')}`;
}

export function NumberProp({ prop, label, unit = 'px', stepSize = 1 }: { prop: string; label?: string; unit?: string; stepSize?: number }) {
  const ps = usePropState(prop);
  const meta = PROPERTIES[prop];
  const [draft, setDraft] = useState(ps.value);
  const [focused, setFocused] = useState(false);
  if (!focused && draft !== ps.value) setDraft(ps.value);
  const nudge = (d: number, from = ps.value || ps.computed) => {
    const next = step(from, d * stepSize, unit);
    if (!next) return;
    const v = clamp(prop, next);
    setDraft(v);
    setStyles({ [prop]: v });
  };
  const len = parseLength(draft);
  return (
    <Field label={label ?? meta?.label ?? prop} prop={prop} scrub={(d) => nudge(d)}>
      <div className="num">
        <input
          className="input mono"
          data-testid={`prop-${prop}`}
          value={draft}
          onFocus={() => setFocused(true)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            const t = e.target as HTMLInputElement;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1), draft);
            }
            if (e.key === 'Enter') t.blur();
            if (e.key === 'Escape') {
              setDraft(ps.value);
              setFocused(false);
              t.blur();
            }
          }}
          onBlur={() => {
            setFocused(false);
            const v = draft.trim();
            if (v && v !== ps.value) setStyles({ [prop]: v }, { coalesce: false });
          }}
        />
        {len && !len.unit && unit && prop !== 'line-height' && <span className="num-unit">{unit}</span>}
      </div>
    </Field>
  );
}

function clamp(prop: string, value: string): string {
  const meta = PROPERTIES[prop];
  const len = parseLength(value);
  if (!meta || !len) return value;
  let n = len.n;
  if (meta.min !== undefined) n = Math.max(meta.min, n);
  if (meta.max !== undefined) n = Math.min(meta.max, n);
  return `${formatNumber(n)}${len.unit}`;
}

export function SelectProp({ prop, label, options }: { prop: string; label?: string; options?: string[] }) {
  const ps = usePropState(prop);
  const opts = options ?? PROPERTIES[prop]?.options ?? [];
  const all = opts.includes(ps.value) || !ps.value ? opts : [ps.value, ...opts];
  return (
    <Field label={label ?? PROPERTIES[prop]?.label ?? prop} prop={prop}>
      <select className="input" value={ps.value} data-testid={`prop-${prop}`} onChange={(e) => setStyles({ [prop]: e.target.value }, { coalesce: false })}>
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SegProp({ prop, label, options }: { prop: string; label?: string; options: Array<{ value: string; label: ReactNode; title?: string }> }) {
  const ps = usePropState(prop);
  return (
    <Field label={label ?? PROPERTIES[prop]?.label ?? prop} prop={prop}>
      <div className="seg" style={{ width: '100%' }}>
        {options.map((o) => (
          <button key={o.value} className={ps.value === o.value ? 'on' : ''} title={o.title ?? o.value} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStyles({ [prop]: o.value }, { coalesce: false })} data-testid={`seg-${prop}-${o.value}`}>
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function TextProp({ prop, label, placeholder }: { prop: string; label?: string; placeholder?: string }) {
  const ps = usePropState(prop);
  return (
    <Field label={label ?? PROPERTIES[prop]?.label ?? prop} prop={prop}>
      <CommitInput value={ps.value} placeholder={placeholder} mono onCommit={(v) => setStyles({ [prop]: v || null }, { coalesce: false })} testId={`prop-${prop}`} />
    </Field>
  );
}

export function toHex(color: string): string {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(color);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Math.round(Number(x)).toString(16).padStart(2, '0')).join('')}`;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map((c) => c + c).join('')}`;
  return '#000000';
}

export function ColorProp({ prop, label }: { prop: string; label?: string }) {
  const ps = usePropState(prop);
  const shown = ps.edited ?? ps.computed;
  return (
    <Field label={label ?? PROPERTIES[prop]?.label ?? prop} prop={prop}>
      <label className="color-swatch" title="Pick a colour">
        <span style={{ background: shown }} />
        <input type="color" value={toHex(shown)} onChange={(e) => setStyles({ [prop]: e.target.value })} />
      </label>
      <CommitInput value={shown} mono onCommit={(v) => setStyles({ [prop]: v || null }, { coalesce: false })} testId={`prop-${prop}`} />
    </Field>
  );
}
