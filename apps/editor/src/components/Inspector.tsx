import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, ChevronDown, ChevronRight, Component, FileCode, Layers3, MousePointerClick } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BREAKPOINTS, formatSourceLoc, getBreakpoint, parseLength, SIDES, type ElementDetails } from '@pixelforge/core';
import { editorBridge } from '../bridge/AgentBridge';
import { setStyles, setText, targetFor } from '../state/edits';
import { useEditor } from '../state/store';
import { CascadeView } from './CascadeView';
import { ColorProp, CommitInput, Field, NumberProp, SegProp, SelectProp, TextProp, usePropState } from './controls';

function Section({ title, props, children, defaultOpen = true }: { title: string; props: string[]; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const details = useEditor((s) => s.details);
  const present = useEditor((s) => s.history.present);
  const bp = useEditor((s) => s.editBreakpoint);
  const key = details ? targetFor(details).key : '';
  const edited = props.some((p) => present.styles[key]?.[bp]?.[p] !== undefined);
  return (
    <div className="section">
      <button className="section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
        {edited && <span className="dot" title="Edited at this breakpoint" />}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

const FONTS = [
  'inherit',
  "'Inter', ui-sans-serif, system-ui, sans-serif",
  'system-ui, sans-serif',
  "Georgia, 'Times New Roman', serif",
  "ui-serif, Georgia, serif",
  "ui-monospace, 'JetBrains Mono', Menlo, monospace",
  "'Helvetica Neue', Arial, sans-serif",
];

const OPPOSITE: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function BmInput({ box, side }: { box: 'margin' | 'padding'; side: string }) {
  const prop = `${box}-${side}`;
  const st = usePropState(prop);
  const len = parseLength(st.value);
  const shown = len && len.unit === 'px' ? String(len.n) : st.value;
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  if (!focused && draft !== shown) setDraft(shown);
  const toValue = (v: string) => (/^-?[\d.]+$/.test(v) ? `${box === 'padding' ? Math.max(0, Number(v)) : Number(v)}px` : v);
  return (
    <input
      className={`bm-input bm-${side} ${st.edited ? 'edited' : ''}`}
      value={draft}
      title={`${prop}: ${st.value} — type a value, ↑/↓ to nudge (Shift ×10), Alt applies to both sides`}
      data-testid={`bm-${prop}`}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const cur = parseLength(/[a-z%]/.test(draft) ? draft : `${draft || 0}px`);
          const n = (cur?.n ?? 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
          const clamped = box === 'padding' ? Math.max(0, n) : n;
          const unit = cur?.unit || 'px';
          setDraft(unit === 'px' ? String(clamped) : `${clamped}${unit}`);
          const v = `${clamped}${unit}`;
          setStyles(e.altKey ? { [prop]: v, [`${box}-${OPPOSITE[side]}`]: v } : { [prop]: v });
        }
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(shown);
          (e.target as HTMLInputElement).blur();
        }
      }}
      onBlur={() => {
        setFocused(false);
        const v = draft.trim();
        if (v && v !== shown) setStyles({ [prop]: toValue(v) }, { coalesce: false });
      }}
    />
  );
}

function BoxModel() {
  const details = useEditor((s) => s.details)!;
  return (
    <div className="boxmodel">
      <span className="bm-label">margin</span>
      {SIDES.map((s) => (
        <BmInput key={s} box="margin" side={s} />
      ))}
      <div className="bm-pad">
        <span className="bm-label">padding</span>
        {SIDES.map((s) => (
          <BmInput key={s} box="padding" side={s} />
        ))}
        <div className="bm-content">
          {Math.round(details.box.width)} × {Math.round(details.box.height)}
        </div>
      </div>
    </div>
  );
}

function RadiusControl() {
  const tl = usePropState('border-top-left-radius');
  const [split, setSplit] = useState(false);
  const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  return (
    <>
      <Field label="Radius" prop="border-top-left-radius" scrub={(d) => {
        const n = (parseLength(tl.value)?.n ?? 0) + d;
        setStyles(Object.fromEntries(corners.map((c) => [`border-${c}-radius`, `${Math.max(0, n)}px`])));
      }}>
        <CommitInput value={tl.value} mono onCommit={(v) => setStyles({ 'border-radius': v })} testId="prop-border-radius" />
        <button className="btn sm ghost" onClick={() => setSplit(!split)} title="Edit corners individually">
          {split ? 'All' : 'Each'}
        </button>
      </Field>
      {split && (
        <div className="grid2">
          {corners.map((c) => (
            <NumberProp key={c} prop={`border-${c}-radius`} label={c.replace('-', ' ')} />
          ))}
        </div>
      )}
    </>
  );
}

function BorderControl() {
  const w = usePropState('border-top-width');
  const st = usePropState('border-top-style');
  const col = usePropState('border-top-color');
  const all = (suffix: string, v: string) => setStyles(Object.fromEntries(SIDES.map((s) => [`border-${s}-${suffix}`, v])), { coalesce: suffix !== 'style' });
  return (
    <>
      <Field label="Width" prop="border-top-width" scrub={(d) => all('width', `${Math.max(0, (parseLength(w.value)?.n ?? 0) + d)}px`)}>
        <CommitInput value={w.value} mono onCommit={(v) => all('width', /^\d+$/.test(v) ? `${v}px` : v)} testId="prop-border-width" />
      </Field>
      <Field label="Style" prop="border-top-style">
        <select className="input" value={st.value} onChange={(e) => all('style', e.target.value)} data-testid="prop-border-style">
          {['none', 'solid', 'dashed', 'dotted', 'double'].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </Field>
      <Field label="Color" prop="border-top-color">
        <CommitInput value={col.value} mono onCommit={(v) => all('color', v)} testId="prop-border-color" />
      </Field>
      <RadiusControl />
    </>
  );
}

function TextContent({ details }: { details: ElementDetails }) {
  const present = useEditor((s) => s.history.present);
  if (!details.text.editable) return <div className="notice">{details.text.reason}</div>;
  const edited = Object.values(present.text).some((t) => t.value === details.text.value);
  return (
    <div className={`field ${edited ? 'edited' : ''}`} style={{ gridTemplateColumns: '1fr' }}>
      <textarea
        className="input"
        style={{ height: 'auto', minHeight: 54, padding: 6, resize: 'vertical' }}
        key={`${details.nodeId}-${details.text.value}`}
        defaultValue={details.text.value}
        data-testid="text-content"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        onBlur={(e) => {
          if (e.target.value !== details.text.value) setText(details, e.target.value);
        }}
      />
      <span className="faint">Enter to apply · or double-click the text on the canvas</span>
    </div>
  );
}

function LayoutSection({ details }: { details: ElementDetails }) {
  const display = usePropState('display').value;
  const isFlex = display.includes('flex');
  const isGrid = display.includes('grid');
  const parentFlex = details.parentDisplay.includes('flex');
  const parentGrid = details.parentDisplay.includes('grid');
  return (
    <Section title="Layout" props={['display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'row-gap', 'column-gap', 'grid-template-columns', 'grid-template-rows', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'order', 'grid-column', 'grid-row']}>
      <SegProp
        prop="display"
        options={[
          { value: 'block', label: 'Block' },
          { value: 'flex', label: 'Flex' },
          { value: 'grid', label: 'Grid' },
          { value: 'inline', label: 'Inline' },
          { value: 'none', label: 'None', title: 'Hide (display: none)' },
        ]}
      />
      {isFlex && (
        <>
          <SegProp
            prop="flex-direction"
            options={[
              { value: 'row', label: <ArrowRight size={13} />, title: 'row' },
              { value: 'column', label: <ArrowDown size={13} />, title: 'column' },
              { value: 'row-reverse', label: '⇠', title: 'row-reverse' },
              { value: 'column-reverse', label: '⇡', title: 'column-reverse' },
            ]}
          />
          <SelectProp prop="justify-content" />
          <SelectProp prop="align-items" />
          <SelectProp prop="flex-wrap" />
        </>
      )}
      {isGrid && (
        <>
          <TextProp prop="grid-template-columns" placeholder="repeat(3, 1fr)" />
          <TextProp prop="grid-template-rows" placeholder="auto" />
          <SelectProp prop="justify-content" label="Justify" />
          <SelectProp prop="align-items" label="Align" />
        </>
      )}
      {(isFlex || isGrid) && (
        <div className="grid2">
          <NumberProp prop="row-gap" label="Row gap" />
          <NumberProp prop="column-gap" label="Col gap" />
        </div>
      )}
      {parentFlex && (
        <>
          <div className="faint">As a flex item of its parent</div>
          <div className="grid2">
            <NumberProp prop="flex-grow" label="Grow" unit="" />
            <NumberProp prop="flex-shrink" label="Shrink" unit="" />
          </div>
          <TextProp prop="flex-basis" label="Basis" />
          <SelectProp prop="align-self" />
          <NumberProp prop="order" unit="" />
        </>
      )}
      {parentGrid && (
        <>
          <div className="faint">As a grid item of its parent</div>
          <TextProp prop="grid-column" placeholder="span 2" />
          <TextProp prop="grid-row" placeholder="auto" />
        </>
      )}
    </Section>
  );
}

function Header({ details }: { details: ElementDetails }) {
  const instanceScope = useEditor((s) => s.instanceScope);
  const set = useEditor((s) => s.set);
  const mode = useEditor((s) => s.session?.mode);
  const bp = useEditor((s) => s.editBreakpoint);
  const { flags } = details;
  return (
    <div className="insp-head">
      <div className="insp-title">
        <span className="tree-tag" style={{ fontSize: 13 }}>
          {details.label}
        </span>
        {details.text.editable && (
          <button className="icon-btn" title="Edit text on canvas (Enter)" onClick={() => editorBridge.call('editText', { nodeId: details.nodeId })}>
            <MousePointerClick size={14} />
          </button>
        )}
      </div>
      {details.components.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
          <Component size={12} className="faint" />
          {details.components.slice(0, 4).map((c, i) => (
            <span key={i} className={`pill ${i === 0 ? 'accent' : ''}`}>
              {c}
            </span>
          ))}
        </div>
      )}
      {details.src ? (
        <div className="row">
          <FileCode size={12} className="faint" />
          <span className="src-link" data-testid="src-loc">
            {formatSourceLoc(details.src)}
          </span>
        </div>
      ) : (
        mode === 'source' && <div className="faint">No source location (rendered outside project JSX)</div>
      )}
      {(details.instanceCount > 1 || details.group) && (
        <div className="row">
          <Layers3 size={12} className="faint" />
          <div className="seg">
            <button className={instanceScope === 'source' ? 'on' : ''} onClick={() => set({ instanceScope: 'source' })} title="Edits apply to every element rendered from this JSX (matches what a source change does)" data-testid="scope-all">
              {details.group ? `All ${details.group.count} similar` : `All ${details.instanceCount} instances`}
            </button>
            <button className={instanceScope === 'instance' ? 'on' : ''} onClick={() => set({ instanceScope: 'instance' })} title="Preview on this element only (cannot be expressed in shared source)">
              This one
            </button>
          </div>
        </div>
      )}
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
        <span className={`bp-badge ${bp}`} title="New style edits are written to this breakpoint">
          editing: {getBreakpoint(bp).label}
          {getBreakpoint(bp).maxWidth ? ` ≤${getBreakpoint(bp).maxWidth}px` : ''}
        </span>
        {flags.fixed && <span className="pill warn">position: fixed</span>}
        {flags.sticky && <span className="pill warn">sticky</span>}
        {flags.transformed && <span className="pill warn" title="Element or an ancestor is transformed; the overlay shows the transformed outline and resize handles are disabled">transformed</span>}
        {flags.scrollContainer && <span className="pill">scroll container</span>}
      </div>
    </div>
  );
}

function Design({ details }: { details: ElementDetails }) {
  const position = usePropState('position').value;
  return (
    <>
      <Header details={details} />
      {(details.text.editable || details.text.reason?.startsWith('Contains')) && (
        <Section title="Content" props={[]}>
          <TextContent details={details} />
        </Section>
      )}
      <LayoutSection details={details} />
      <Section title="Spacing" props={SIDES.flatMap((s) => [`margin-${s}`, `padding-${s}`])}>
        <BoxModel />
      </Section>
      <Section title="Size" props={['width', 'height', 'min-width', 'max-width', 'min-height', 'max-height']}>
        <div className="grid2">
          <NumberProp prop="width" label="W" />
          <NumberProp prop="height" label="H" />
          <NumberProp prop="min-width" label="Min W" />
          <NumberProp prop="max-width" label="Max W" />
        </div>
      </Section>
      <Section title="Position" props={['position', 'top', 'right', 'bottom', 'left', 'z-index']} defaultOpen={position !== 'static'}>
        <SelectProp prop="position" />
        {position !== 'static' && (
          <>
            <div className="grid2">
              <NumberProp prop="top" />
              <NumberProp prop="right" />
              <NumberProp prop="bottom" />
              <NumberProp prop="left" />
            </div>
            <NumberProp prop="z-index" unit="" />
          </>
        )}
      </Section>
      <Section title="Typography" props={['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color']}>
        <SelectProp prop="font-family" label="Font" options={FONTS} />
        <div className="grid2">
          <NumberProp prop="font-size" label="Size" />
          <SelectProp prop="font-weight" label="Weight" />
          <NumberProp prop="line-height" label="Leading" unit="" stepSize={0.05} />
          <NumberProp prop="letter-spacing" label="Tracking" stepSize={0.1} />
        </div>
        <SegProp
          prop="text-align"
          label="Align"
          options={[
            { value: 'left', label: <AlignLeft size={13} /> },
            { value: 'center', label: <AlignCenter size={13} /> },
            { value: 'right', label: <AlignRight size={13} /> },
            { value: 'justify', label: <AlignJustify size={13} /> },
          ]}
        />
        <SelectProp prop="text-transform" label="Case" />
        <ColorProp prop="color" label="Color" />
      </Section>
      <Section title="Background" props={['background-color', 'background-image']}>
        <ColorProp prop="background-color" label="Color" />
        <TextProp prop="background-image" label="Image" placeholder="linear-gradient(…)" />
      </Section>
      <Section title="Border" props={SIDES.flatMap((s) => [`border-${s}-width`, `border-${s}-style`, `border-${s}-color`]).concat(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'])}>
        <BorderControl />
      </Section>
      <Section title="Effects" props={['opacity', 'visibility', 'box-shadow', 'overflow', 'transform']}>
        <NumberProp prop="opacity" unit="" stepSize={0.05} />
        <SegProp
          prop="visibility"
          options={[
            { value: 'visible', label: 'Visible' },
            { value: 'hidden', label: 'Hidden' },
          ]}
        />
        <SelectProp prop="overflow" />
        <TextProp prop="box-shadow" label="Shadow" placeholder="0 8px 24px rgba(0,0,0,.2)" />
        <TextProp prop="transform" placeholder="rotate(2deg)" />
      </Section>
    </>
  );
}

export function Inspector() {
  const details = useEditor((s) => s.details);
  const selectedId = useEditor((s) => s.selectedId);
  const unresolved = useEditor((s) => s.applyResult.unresolved.length);
  const [tab, setTab] = useState<'design' | 'cascade'>('design');
  return (
    <div className="panel" data-testid="inspector">
      <div className="panel-header">
        <button className={`tab ${tab === 'design' ? 'on' : ''}`} onClick={() => setTab('design')}>
          Design
        </button>
        <button className={`tab ${tab === 'cascade' ? 'on' : ''}`} onClick={() => setTab('cascade')} data-testid="tab-cascade">
          Cascade
        </button>
        <div className="grow" />
        <span className="row faint" style={{ gap: 6, fontSize: 10 }} title="Where each value comes from">
          <span className="origin-dot editor" />
          edited
          <span className="origin-dot rule" />
          rule
          <span className="origin-dot inherited" />
          inherited
        </span>
      </div>
      <div className="panel-body">
        {unresolved > 0 && (
          <div className="notice warn" style={{ margin: 8 }}>
            {unresolved} edited element{unresolved > 1 ? 's are' : ' is'} not on this page (other page, or removed by the app). The edits are kept.
          </div>
        )}
        {!details ? (
          <div className="empty" style={{ height: '70%' }}>
            <MousePointerClick size={22} />
            <h4>{selectedId ? 'Loading…' : 'Select an element'}</h4>
            <p>Click anything on the canvas or in Layers. Hover to see its box model; ↑↓←→ walk the tree.</p>
          </div>
        ) : tab === 'design' ? (
          <Design details={details} />
        ) : (
          <CascadeView details={details} />
        )}
      </div>
      {details && (
        <div className="panel-header" style={{ borderTop: '1px solid var(--border)', borderBottom: 0, gap: 6 }}>
          <span className="faint">Breakpoints with edits:</span>
          {BREAKPOINTS.map((b) => (
            <BpDot key={b.id} id={b.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function BpDot({ id }: { id: 'base' | 'tablet' | 'mobile' }) {
  const details = useEditor((s) => s.details);
  const present = useEditor((s) => s.history.present);
  const set = useEditor((s) => s.set);
  const current = useEditor((s) => s.editBreakpoint);
  if (!details) return null;
  const n = Object.keys(present.styles[targetFor(details).key]?.[id] ?? {}).length;
  return (
    <button className={`bp-badge ${id}`} style={{ border: current === id ? '1px solid currentColor' : '1px solid transparent', cursor: 'pointer' }} onClick={() => set({ editBreakpoint: id, breakpointPinned: true })} title={`Edit at ${getBreakpoint(id).label}`}>
      {getBreakpoint(id).label} {n ? `· ${n}` : ''}
    </button>
  );
}
