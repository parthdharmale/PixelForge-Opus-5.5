/**
 * DevTools-style overlay drawn *above* the iframe (never inside the page,
 * so it cannot disturb layout or screenshots). Geometry comes from the
 * agent in iframe-viewport coordinates and is scaled here.
 */
import { useRef, useState } from 'react';
import { formatNumber, type ElementDetails, type Geometry } from '@pixelforge/core';
import { commitPreview, previewStyles } from '../state/edits';
import { useEditor } from '../state/store';

interface Props {
  scale: number;
  width: number;
  height: number;
  left: number;
  top: number;
}

type DragKind = 'width' | 'height' | 'size' | 'move' | `padding-${Side}` | `margin-${Side}`;
type Side = 'top' | 'right' | 'bottom' | 'left';

function px(v: string | undefined): number {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : 0;
}

function Boxes({ g, s, hover }: { g: Geometry; s: number; hover: boolean }) {
  const { rect, margin: m, padding: p, border: b } = g;
  const R = (x: number, y: number, w: number, h: number, cls: string) => (w > 0 && h > 0 ? <div className={`ov-box ${cls}`} style={{ left: x * s, top: y * s, width: w * s, height: h * s }} /> : null);
  if (g.quad) {
    const pts = g.quad.map((q) => `${q.x * s},${q.y * s}`).join(' ');
    return (
      <svg className="ov-quad" width="100%" height="100%">
        <polygon points={pts} fill={hover ? 'rgba(111,168,220,0.25)' : 'none'} stroke="#7c6cff" strokeWidth={1.5} strokeDasharray={hover ? '4 3' : undefined} />
      </svg>
    );
  }
  const x = rect.x, y = rect.y, w = rect.width, h = rect.height;
  return (
    <>
      {hover && (
        <>
          {R(x - m.left, y - m.top, w + m.left + m.right, m.top, 'ov-margin')}
          {R(x - m.left, y + h, w + m.left + m.right, m.bottom, 'ov-margin')}
          {R(x - m.left, y, m.left, h, 'ov-margin')}
          {R(x + w, y, m.right, h, 'ov-margin')}
          {R(x + b.left, y + b.top, w - b.left - b.right, p.top, 'ov-padding')}
          {R(x + b.left, y + h - b.bottom - p.bottom, w - b.left - b.right, p.bottom, 'ov-padding')}
          {R(x + b.left, y + b.top + p.top, p.left, h - b.top - b.bottom - p.top - p.bottom, 'ov-padding')}
          {R(x + w - b.right - p.right, y + b.top + p.top, p.right, h - b.top - b.bottom - p.top - p.bottom, 'ov-padding')}
          {R(x + b.left + p.left, y + b.top + p.top, w - b.left - b.right - p.left - p.right, h - b.top - b.bottom - p.top - p.bottom, 'ov-content')}
        </>
      )}
      <div className={`ov-outline ${hover ? 'hover' : ''}`} style={{ left: x * s, top: y * s, width: w * s, height: h * s }} />
    </>
  );
}

function Tag({ g, s, hover, details, frameH }: { g: Geometry; s: number; hover: boolean; details?: ElementDetails | null; frameH: number }) {
  const r = g.quad ? { x: Math.min(...g.quad.map((q) => q.x)), y: Math.min(...g.quad.map((q) => q.y)) } : g.rect;
  let top = r.y * s - 22;
  if (top < 2) top = Math.min((g.rect.y + g.rect.height) * s + 4, frameH - 22);
  const comp = details?.components[0];
  return (
    <div className={`ov-tag ${hover ? 'hover' : ''}`} style={{ left: Math.max(2, r.x * s), top: Math.max(2, top) }}>
      {comp && <span className="comp">{comp}</span>}
      <span>{g.label}</span>
      <span className="dim">
        {formatNumber(g.rect.width)} × {formatNumber(g.rect.height)}
      </span>
      {g.position === 'fixed' || g.position === 'sticky' ? <span className="dim">{g.position}</span> : null}
      {g.quad ? <span className="dim">transformed</span> : null}
    </div>
  );
}

export function Overlay({ scale: s, width, height, left, top }: Props) {
  const hover = useEditor((st) => st.hover);
  const selected = useEditor((st) => st.selected);
  const details = useEditor((st) => st.details);
  const tool = useEditor((st) => st.tool);
  const compare = useEditor((st) => st.compare);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ kind: DragKind; x0: number; y0: number; start: Record<string, number>; details: ElementDetails; last: Record<string, string> } | null>(null);

  if (tool !== 'select' || compare !== 'off') return null;
  const showHover = hover && (!selected || hover.nodeId !== selected.nodeId);
  const sel = selected && details && details.nodeId === selected.nodeId ? selected : null;

  function begin(e: React.PointerEvent, kind: DragKind) {
    if (!details) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    const c = details.computed;
    const start: Record<string, number> = {
      width: px(c.width),
      height: px(c.height),
      top: px(c.top),
      left: px(c.left),
    };
    for (const side of ['top', 'right', 'bottom', 'left']) {
      start[`padding-${side}`] = px(c[`padding-${side}`]);
      start[`margin-${side}`] = px(c[`margin-${side}`]);
    }
    drag.current = { kind, x0: e.clientX, y0: e.clientY, start, details, last: {} };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x0) / s;
    const dy = (e.clientY - d.y0) / s;
    const snap = (v: number) => (e.shiftKey ? Math.round(v / 8) * 8 : Math.round(v));
    const values: Record<string, string> = {};
    const { kind, start } = d;
    if (kind === 'width' || kind === 'size') values.width = `${Math.max(0, snap(start.width + dx))}px`;
    if (kind === 'height' || kind === 'size') values.height = `${Math.max(0, snap(start.height + dy))}px`;
    if (kind === 'move') {
      values.top = `${snap(start.top + dy)}px`;
      values.left = `${snap(start.left + dx)}px`;
    }
    const sp = /^(padding|margin)-(top|right|bottom|left)$/.exec(kind);
    if (sp) {
      const [, box, side] = sp;
      const sign = box === 'padding' ? (side === 'top' || side === 'left' ? 1 : -1) : side === 'top' || side === 'left' ? -1 : 1;
      const delta = side === 'top' || side === 'bottom' ? dy : dx;
      const v = snap(start[kind] + sign * delta);
      const val = `${box === 'padding' ? Math.max(0, v) : v}px`;
      const opposite: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
      if (e.altKey && e.shiftKey) for (const sd of ['top', 'right', 'bottom', 'left']) values[`${box}-${sd}`] = val;
      else {
        values[kind] = val;
        if (e.altKey) values[`${box}-${opposite[side]}`] = val;
      }
    }
    d.last = values;
    previewStyles(values, d.details);
    setReadout({ x: e.clientX, y: e.clientY, text: Object.entries(values).map(([k, v]) => `${k.replace(/^(padding|margin)-/, (m) => m[0])}: ${v}`).join('  ') });
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    setReadout(null);
    if (!d || !Object.keys(d.last).length) {
      useEditor.getState().set({ livePreview: null });
      return;
    }
    const what = d.kind === 'move' ? 'Move' : /^(padding|margin)/.test(d.kind) ? `Adjust ${d.kind.split('-')[0]}` : 'Resize';
    commitPreview(d.last, d.details, `${what} · ${d.details.label}`);
  }

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const r = sel?.rect;
  const canMove = !!details && ['relative', 'absolute', 'fixed', 'sticky'].includes(details.computed.position);
  const inline = details?.computed.display === 'inline';

  return (
    <div className="overlay" style={{ left, top, width: width * s, height }} data-testid="overlay">
      {showHover && hover && (
        <div style={hover.clip ? {} : { opacity: 0.4 }}>
          <Boxes g={hover} s={s} hover />
          <Tag g={hover} s={s} hover frameH={height} />
        </div>
      )}
      {sel && r && (
        <>
          <Boxes g={sel} s={s} hover={false} />
          <Tag g={sel} s={s} hover={false} details={details} frameH={height} />
          {!sel.quad && !inline && sel.clip && (
            <>
              <div className="ov-handle" title="Drag to resize width (Shift snaps to 8px)" style={{ left: (r.x + r.width) * s - 4, top: (r.y + r.height / 2) * s - 4, cursor: 'ew-resize' }} onPointerDown={(e) => begin(e, 'width')} {...handlers} data-testid="handle-width" />
              <div className="ov-handle" title="Drag to resize height" style={{ left: (r.x + r.width / 2) * s - 4, top: (r.y + r.height) * s - 4, cursor: 'ns-resize' }} onPointerDown={(e) => begin(e, 'height')} {...handlers} data-testid="handle-height" />
              <div className="ov-handle" title="Drag to resize" style={{ left: (r.x + r.width) * s - 4, top: (r.y + r.height) * s - 4, cursor: 'nwse-resize' }} onPointerDown={(e) => begin(e, 'size')} {...handlers} />
              {(['top', 'right', 'bottom', 'left'] as Side[]).map((side) => {
                const b = sel.border;
                const p = sel.padding;
                const vertical = side === 'top' || side === 'bottom';
                const x = side === 'left' ? r.x + b.left : side === 'right' ? r.x + r.width - b.right - Math.max(p.right, 6) : r.x + r.width / 2 - 12;
                const y = side === 'top' ? r.y + b.top : side === 'bottom' ? r.y + r.height - b.bottom - Math.max(p.bottom, 6) : r.y + r.height / 2 - 12;
                const w = vertical ? 24 : Math.max(p[side], 6);
                const h = vertical ? Math.max(p[side], 6) : 24;
                if (r.width < 48 || r.height < 36) return null;
                return (
                  <div
                    key={side}
                    className={`ov-spacing-handle ${vertical ? 'v' : 'h'}`}
                    title={`Drag to change padding-${side} (Alt: both sides, Alt+Shift: all sides)`}
                    style={{ left: x * s, top: y * s, width: w * s, height: h * s, cursor: vertical ? 'ns-resize' : 'ew-resize' }}
                    onPointerDown={(e) => begin(e, `padding-${side}`)}
                    {...handlers}
                    data-testid={`handle-padding-${side}`}
                  />
                );
              })}
              {(['top', 'bottom'] as Side[]).map((side) => {
                const m = sel.margin[side];
                const y = side === 'top' ? r.y - Math.max(m, 6) : r.y + r.height;
                return (
                  <div
                    key={`m-${side}`}
                    className="ov-spacing-handle v"
                    title={`Drag to change margin-${side}`}
                    style={{ left: (r.x + r.width / 2 - 12) * s, top: y * s, width: 24 * s, height: Math.max(m, 6) * s, cursor: 'ns-resize' }}
                    onPointerDown={(e) => begin(e, `margin-${side}`)}
                    {...handlers}
                  />
                );
              })}
              {canMove && (
                <div className="ov-move" style={{ left: r.x * s, top: (r.y + r.height) * s + 4 }} title="Drag to reposition (top/left)" onPointerDown={(e) => begin(e, 'move')} {...handlers}>
                  ✥ move
                </div>
              )}
            </>
          )}
        </>
      )}
      {readout && (
        <div className="drag-readout" style={{ position: 'fixed', left: readout.x + 14, top: readout.y + 14 }}>
          {readout.text}
        </div>
      )}
    </div>
  );
}
