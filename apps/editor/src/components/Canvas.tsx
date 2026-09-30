import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { breakpointForWidth, getBreakpoint } from '@pixelforge/core';
import { editorBridge, originalBridge } from '../bridge/AgentBridge';
import { useEditor } from '../state/store';
import { CommandBar } from './CommandBar';
import { Overlay } from './Overlay';

const PAD = 24;
const LABEL = 22;

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 800, h: 600 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function Frame({ src, bridge, testId }: { src: string; bridge: typeof editorBridge; testId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    bridge.attach(ref.current);
    return () => bridge.attach(null);
  }, [bridge, src]);
  return (
    <iframe
      ref={ref}
      src={src}
      title={testId}
      data-testid={testId}
    />
  );
}

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const session = useEditor((s) => s.session)!;
  const width = useEditor((s) => s.width);
  const compare = useEditor((s) => s.compare);
  const sliderPos = useEditor((s) => s.sliderPos);
  const pageLoading = useEditor((s) => s.pageLoading);
  const pageError = useEditor((s) => s.pageError);
  const page = useEditor((s) => s.page);
  const set = useEditor((s) => s.set);
  const setViewport = useEditor((s) => s.setViewport);
  const [slow, setSlow] = useState(false);

  // Detect pages where the agent never starts (blocked, error pages...).
  useEffect(() => {
    setSlow(false);
    if (!pageLoading) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [pageLoading, session.frameUrl]);

  const split = compare === 'split';
  const availW = split ? (w - PAD * 3) / 2 : w - PAD * 2;
  const scale = Math.min(1, availW / width);
  const frameH = Math.max(200, (h - PAD * 2 - LABEL) / scale);
  const shellW = width * scale;
  const left = split ? PAD * 2 + availW + (availW - shellW) / 2 : PAD + (availW - shellW) / 2;
  const origLeft = split ? PAD + (availW - shellW) / 2 : left;
  const top = PAD + LABEL;
  const bp = getBreakpoint(breakpointForWidth(width));
  const showOriginal = compare !== 'off';

  const dragWidth = useRef<{ x0: number; w0: number } | null>(null);

  const shellStyle = (l: number): React.CSSProperties => ({ left: l, top, width, height: frameH, transform: `scale(${scale})` });

  return (
    <div className="canvas" ref={ref} data-testid="canvas">
      <div className="frame-label" style={{ left, top: PAD }}>
        <b>{split ? 'Edited' : page?.title || 'Loading…'}</b>
        <span className="mono">
          {width}px · {bp.label}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        {page?.framework && <span className="pill">{page.framework}</span>}
        {page && session.mode === 'source' && <span className={`pill ${page.sourceMapped ? 'accent' : 'warn'}`}>{page.sourceMapped ? 'source mapped' : 'no source map'}</span>}
        {page && page.unreadableStylesheets > 0 && <span className="pill warn" title="Cross-origin stylesheets cannot be analysed for the cascade view">{page.unreadableStylesheets} unreadable stylesheet(s)</span>}
      </div>
      {split && (
        <div className="frame-label" style={{ left: origLeft, top: PAD }}>
          <b>Original</b>
        </div>
      )}

      {showOriginal && (
        <div
          className="frame-shell"
          style={{
            ...shellStyle(origLeft),
            zIndex: compare === 'original' || compare === 'slider' ? 2 : 0,
            clipPath: compare === 'slider' ? `inset(0 ${(1 - sliderPos) * 100}% 0 0)` : undefined,
            pointerEvents: compare === 'slider' ? 'none' : undefined,
          }}
        >
          <Frame src={session.frameUrl} bridge={originalBridge} testId="original-frame" />
        </div>
      )}
      <div className="frame-shell" style={{ ...shellStyle(left), zIndex: 1 }}>
        <Frame src={session.frameUrl} bridge={editorBridge} testId="page-frame" />
      </div>

      {compare === 'slider' && (
        <>
          <div className="compare-tag" style={{ left: left + 8, top: top + 8 }}>
            Original
          </div>
          <div className="compare-tag" style={{ left: left + shellW - 70, top: top + 8 }}>
            Edited
          </div>
          <div
            className="compare-divider"
            data-testid="compare-divider"
            style={{ left: left + shellW * sliderPos, top, height: frameH * scale }}
            onPointerDown={(e) => (e.target as Element).setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (!(e.buttons & 1)) return;
              const rect = ref.current!.getBoundingClientRect();
              set({ sliderPos: Math.max(0, Math.min(1, (e.clientX - rect.left - left) / shellW)) });
            }}
          />
        </>
      )}
      {compare === 'original' && (
        <div className="compare-tag" style={{ left: left + 8, top: top + 8 }}>
          Original — press \ or Esc to return
        </div>
      )}

      <Overlay scale={scale} width={width} height={frameH * scale} left={left} top={top} />

      {!split && (
        <div
          className="width-handle"
          title="Drag to change viewport width"
          style={{ left: left + shellW + 2, top, height: frameH * scale }}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            dragWidth.current = { x0: e.clientX, w0: width };
          }}
          onPointerMove={(e) => {
            if (!dragWidth.current) return;
            const next = dragWidth.current.w0 + ((e.clientX - dragWidth.current.x0) * 2) / scale;
            setViewport('custom', next);
          }}
          onPointerUp={() => (dragWidth.current = null)}
        />
      )}

      {(pageLoading || pageError) && (
        <div className="canvas-status">
          <div className="loader">
            {pageError ? (
              <span style={{ color: 'var(--err)' }}>{pageError}</span>
            ) : (
              <>
                <span className="spinner" />
                {slow ? 'Still loading… if the page never becomes inspectable, it may block scripts or failed to load.' : 'Loading page…'}
              </>
            )}
          </div>
        </div>
      )}
      <CommandBar />
    </div>
  );
}
