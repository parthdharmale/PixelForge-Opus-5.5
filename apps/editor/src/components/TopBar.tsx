import { ArrowLeft, Columns2, Eye, FileCode2, Laptop, Monitor, MousePointer2, Pointer, Redo2, RefreshCw, Smartphone, Sparkles, SplitSquareHorizontal, Tablet, Undo2 } from 'lucide-react';
import { BREAKPOINTS, canRedo, canUndo, countEdits, type BreakpointId } from '@pixelforge/core';
import { closeSession, generatePatch, reloadPage } from '../state/controller';
import { useEditor, type CompareMode } from '../state/store';

export function TopBar() {
  const s = useEditor();
  const { session, page, history } = s;
  const edits = countEdits(history.present);
  const url = page ? new URL(page.url) : null;
  const shownUrl = session?.mode === 'url' && url ? new URL(url.pathname + url.search, session.originalUrl).href : page?.url ?? session?.originalUrl;
  const lastTx = history.past[history.past.length - 1];
  const nextTx = history.future[0];

  const setCompare = (m: CompareMode) => s.set({ compare: s.compare === m ? 'off' : m });

  return (
    <div className="topbar">
      <button className="icon-btn" title="Back to start" onClick={closeSession}>
        <ArrowLeft size={16} />
      </button>
      <div className="brand">
        <div className="brand-mark">P</div>
      </div>
      <div className="url-pill" title={shownUrl}>
        <span className={`mode-chip ${session?.mode === 'url' ? 'url' : ''}`}>{session?.mode === 'url' ? 'URL' : 'Source'}</span>
        <span className="ellipsis">{session?.mode === 'source' ? `${session.project?.name} · ${url?.pathname ?? '/'}` : shownUrl}</span>
      </div>
      <button className="icon-btn" title="Reload page" onClick={reloadPage}>
        <RefreshCw size={14} />
      </button>
      <div className="divider" />

      <div className="seg" title="Tool">
        <button className={s.tool === 'select' ? 'on' : ''} onClick={() => s.set({ tool: 'select' })} title="Select elements (V)" data-testid="tool-select">
          <MousePointer2 size={13} /> Select
        </button>
        <button className={s.tool === 'interact' ? 'on' : ''} onClick={() => s.set({ tool: 'interact' })} title="Interact with the page: click links, open menus and modals (I)" data-testid="tool-interact">
          <Pointer size={13} /> Interact
        </button>
      </div>

      <div className="grow" />

      <div className="seg" title="Viewport">
        {(
          [
            ['desktop', Monitor, 'Desktop 1440 (1)'],
            ['tablet', Tablet, 'Tablet 834 (2)'],
            ['mobile', Smartphone, 'Mobile 390 (3)'],
          ] as const
        ).map(([id, Icon, title]) => (
          <button key={id} className={s.preset === id ? 'on' : ''} title={title} onClick={() => s.setViewport(id)} data-testid={`vp-${id}`}>
            <Icon size={14} />
          </button>
        ))}
        <button className={s.preset === 'custom' ? 'on' : ''} title="Custom width" onClick={() => s.setViewport('custom', s.width)}>
          <Laptop size={14} />
        </button>
      </div>
      <input
        className="input mono"
        style={{ width: 64 }}
        value={s.width}
        title="Viewport width (px)"
        data-testid="vp-width"
        onChange={(e) => {
          const w = Number(e.target.value.replace(/\D/g, ''));
          if (w) s.set({ width: w, preset: 'custom' });
        }}
        onBlur={(e) => s.setViewport('custom', Number(e.target.value) || s.width)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <select
        className="input"
        value={s.editBreakpoint}
        title="Where new style edits apply"
        data-testid="edit-breakpoint"
        onChange={(e) => s.set({ editBreakpoint: e.target.value as BreakpointId, breakpointPinned: true })}
      >
        {BREAKPOINTS.map((b) => (
          <option key={b.id} value={b.id}>
            Edit: {b.label}
            {b.maxWidth ? ` (≤${b.maxWidth})` : ''}
          </option>
        ))}
      </select>
      <div className="divider" />

      <div className="seg" title="Compare with the original">
        <button className={s.compare === 'slider' ? 'on' : ''} onClick={() => setCompare('slider')} title="Before/after slider" data-testid="compare-slider">
          <SplitSquareHorizontal size={14} />
        </button>
        <button className={s.compare === 'split' ? 'on' : ''} onClick={() => setCompare('split')} title="Side by side">
          <Columns2 size={14} />
        </button>
        <button className={s.compare === 'original' ? 'on' : ''} onClick={() => setCompare('original')} title="Show original (\)">
          <Eye size={14} />
        </button>
      </div>
      <div className="divider" />

      <button className="icon-btn" disabled={!canUndo(history)} onClick={s.undo} title={lastTx ? `Undo ${lastTx.label} (⌘Z)` : 'Undo (⌘Z)'} data-testid="undo">
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" disabled={!canRedo(history)} onClick={s.redo} title={nextTx ? `Redo ${nextTx.label} (⌘⇧Z)` : 'Redo (⌘⇧Z)'} data-testid="redo">
        <Redo2 size={16} />
      </button>
      <button className="btn" onClick={() => s.set({ ai: { ...s.ai, open: true } })} title="AI command bar (⌘K)" data-testid="open-ai">
        <Sparkles size={14} /> AI <span className="kbd">⌘K</span>
      </button>
      <button className="btn primary" disabled={!edits} onClick={generatePatch} title="Generate code patch (⌘⇧G)" data-testid="generate">
        <FileCode2 size={14} /> Code {edits ? <span className="badge" style={{ background: 'rgba(255,255,255,0.25)' }}>{edits}</span> : null}
      </button>
    </div>
  );
}
