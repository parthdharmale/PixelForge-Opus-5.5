import { Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { applyAI, rejectAI, runAI } from '../state/controller';
import { useEditor } from '../state/store';

const SUGGESTIONS = [
  'Make this hero more premium',
  'Make this section feel like a modern developer tool',
  'Reduce the visual clutter',
  'Turn these cards into a responsive grid',
  'Improve the hierarchy without changing the content',
  'Make this navigation work better on mobile',
];

export function CommandBar() {
  const ai = useEditor((s) => s.ai);
  const details = useEditor((s) => s.details);
  const set = useEditor((s) => s.set);
  const [text, setText] = useState(ai.instruction);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ai.open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [ai.open]);

  if (!ai.open) return null;
  const close = () => set({ ai: { ...ai, open: false } });
  const submit = (t: string) => {
    if (!t.trim() || ai.loading) return;
    setText(t);
    void runAI(t.trim());
  };
  const included = ai.ops.length - ai.excluded.length;
  const provider = ai.providers.find((p) => p.id === (ai.plan?.provider ?? ai.provider));

  return (
    <div className="cmdbar" data-testid="command-bar" onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && ai.plan) {
        e.preventDefault();
        applyAI();
      }
    }}>
      <form
        className="cmd-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <Sparkles size={16} color="#b7adff" />
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={details ? `Tell AI what to change in ${details.label}…` : 'Select an element first, or describe a change to the whole page…'} data-testid="ai-input" />
        <select className="input" value={ai.provider} onChange={(e) => set({ ai: { ...ai, provider: e.target.value } })} title="AI provider">
          {ai.providers.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.available}>
              {p.label}
              {p.available ? '' : ' (unavailable)'}
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" onClick={close} title="Close (Esc)">
          <X size={14} />
        </button>
      </form>
      <div className="cmd-body">
        {!ai.plan && !ai.loading && (
          <>
            <div className="cmd-suggest">
              {SUGGESTIONS.map((sug) => (
                <button key={sug} onClick={() => submit(sug)} type="button">
                  {sug}
                </button>
              ))}
            </div>
            <div className="faint" style={{ padding: '0 14px 12px' }}>
              Target: <b className="mono">{details?.label ?? 'whole page'}</b> and its children. The AI returns concrete edit operations you can review, apply or reject. {ai.provider === 'heuristic' && 'Using the offline heuristic engine (no API key configured).'}
            </div>
          </>
        )}
        {ai.loading && (
          <div className="row" style={{ padding: 14 }}>
            <span className="spinner" /> Planning changes with {ai.providers.find((p) => p.id === ai.provider)?.label}…
          </div>
        )}
        {ai.error && (
          <div className="notice err" style={{ margin: 12 }}>
            {ai.error}
          </div>
        )}
        {ai.plan && (
          <div data-testid="ai-plan">
            <div style={{ padding: '10px 14px' }}>
              <div style={{ fontWeight: 600 }}>{ai.plan.summary}</div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--muted)' }}>
                {ai.plan.rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {ai.plan.warnings.map((w, i) => (
                <div key={i} className="notice warn" style={{ marginTop: 8 }}>
                  {w}
                </div>
              ))}
            </div>
            {ai.ops.map((o, i) => {
              const off = ai.excluded.includes(i);
              const op = o.op;
              return (
                <label key={i} className={`op-row ${off ? 'off' : ''}`} data-testid="ai-op">
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() => set({ ai: { ...ai, excluded: off ? ai.excluded.filter((x) => x !== i) : [...ai.excluded, i] } })}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="op-main">
                      <span className="tree-tag">{o.targetLabel}</span>
                      {op.type === 'style' ? (
                        <>
                          <span style={{ color: '#8fb6ff' }}>{op.property}</span>
                          <span className="faint">{o.before ?? '—'}</span>
                          <span className="arrow">→</span>
                          <span>{op.value}</span>
                          {op.breakpoint !== 'base' && <span className={`bp-badge ${op.breakpoint}`}>{op.breakpoint}</span>}
                        </>
                      ) : (
                        <>
                          <span style={{ color: 'var(--ok)' }}>text</span>
                          <span className="faint ellipsis">“{o.before}”</span>
                          <span className="arrow">→</span>
                          <span>“{op.value}”</span>
                        </>
                      )}
                    </div>
                    {o.proposal.reason && <div className="op-reason">{o.proposal.reason}</div>}
                  </div>
                </label>
              );
            })}
            {ai.rejected.length > 0 && (
              <div className="faint" style={{ padding: '6px 14px' }}>
                {ai.rejected.length} proposed operation(s) were rejected by validation: {ai.rejected.map((r) => r.reason).join('; ')}
              </div>
            )}
          </div>
        )}
      </div>
      {ai.plan && (
        <div className="cmd-foot">
          <span className="faint grow">
            Previewing on canvas · {provider?.label}
            {ai.plan.model ? ` (${ai.plan.model})` : ''} · {ai.plan.durationMs} ms
          </span>
          <button className="btn" onClick={rejectAI} data-testid="ai-reject">
            Reject
          </button>
          <button className="btn primary" disabled={!included} onClick={applyAI} data-testid="ai-apply">
            Apply {included} change{included === 1 ? '' : 's'} <span className="kbd" style={{ color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>⌘↵</span>
          </button>
        </div>
      )}
    </div>
  );
}
