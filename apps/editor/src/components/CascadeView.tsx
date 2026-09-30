import type { ElementDetails, MatchedRule } from '@pixelforge/core';
import { selectNode } from '../state/controller';

function Rule({ r }: { r: MatchedRule }) {
  const demangled = r.selector.replace(/\._([A-Za-z0-9-]+)_[a-z0-9]{5}(_\d+)?/g, '.$1');
  return (
    <div className={`rule ${r.kind}`}>
      <div className="rule-head">
        <span className="rule-sel" title={r.selector}>
          {r.kind === 'editor' ? '✎ ' : ''}
          {demangled}
        </span>
        <span className="rule-src" title={r.source}>
          {r.source}
        </span>
      </div>
      {r.media && <div className="rule-media">@media {r.media}</div>}
      <div style={{ padding: '4px 0' }}>
        {r.declarations.map((d, i) => (
          <div key={i} className={`decl ${d.overridden ? 'over' : ''}`} title={d.overridden ? 'Overridden by a rule with higher precedence' : undefined}>
            <span className="p">{d.property}</span>:<span className="v">{d.value}{d.important ? ' !important' : ''}</span>;
          </div>
        ))}
      </div>
    </div>
  );
}

/** DevTools-like explanation of why the element looks the way it does. */
export function CascadeView({ details }: { details: ElementDetails }) {
  return (
    <div data-testid="cascade">
      <div className="cascade-group">
        Rules matching <b className="mono">{details.label}</b>, highest precedence first. Struck-through declarations are overridden; <span style={{ color: 'var(--edited)' }}>✎</span> rules are your unsaved edits.
      </div>
      {details.rules.length === 0 && <div className="empty">No author rules match this element; it uses inherited and default styles.</div>}
      {details.rules.map((r, i) => (
        <Rule key={i} r={r} />
      ))}
      {details.inherited.map((g) => (
        <div key={g.nodeId}>
          <div className="cascade-group">
            Inherited from{' '}
            <button className="btn sm ghost mono" onClick={() => selectNode(g.nodeId, { scroll: true })}>
              {g.label}
            </button>
          </div>
          {g.rules.map((r, i) => (
            <Rule key={i} r={r} />
          ))}
        </div>
      ))}
    </div>
  );
}
