import { Bot, Check, Copy, Download, FileCode2, Hand, History, ListChecks, MousePointer2, RotateCcw, ShieldCheck, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import {
  BREAKPOINT_ORDER,
  buildTransaction,
  countEdits,
  formatSourceLoc,
  stateToOps,
  VERIFY_TOLERANCE,
  type ChangeMapping,
  type EditOp,
  type ElementTarget,
  type Rect,
  type Transaction,
  type ViewportVerification,
} from '@pixelforge/core';
import { editorBridge } from '../bridge/AgentBridge';
import { applyPatch, generatePatch, resetDemoProject, revertAppliedPatch, selectNode } from '../state/controller';
import { useEditor, type BottomTab } from '../state/store';

function selectTarget(t: ElementTarget) {
  editorBridge
    .call('resolve', { selector: t.selector, src: t.src ? formatSourceLoc(t.src) : null })
    .then((id) => {
      if (id) void selectNode(id, { scroll: true });
    })
    .catch(() => {});
}

function removeOps(ops: EditOp[], label: string) {
  const s = useEditor.getState();
  const tx = buildTransaction(s.history.present, ops.map((o) => ({ ...o, value: null }) as EditOp), { label, source: 'manual' });
  s.commitTx(tx);
}

// ---------------------------------------------------------------------------

function Changes() {
  const present = useEditor((s) => s.history.present);
  const targets = Object.values(present.targets);
  if (!targets.length)
    return (
      <div className="empty">
        <h4>No changes yet</h4>
        <p>Edit properties in the inspector, drag handles on the canvas, or ask AI (⌘K). Every change is listed here with the breakpoint it applies to.</p>
      </div>
    );
  return (
    <div>
      <div className="list-item">
        <span className="grow muted">
          {countEdits(present)} change(s) on {targets.length} element(s)
        </span>
        <button className="btn sm ghost danger" onClick={() => removeOps(stateToOps(present), 'Discard all edits')}>
          <Trash2 size={12} /> Discard all
        </button>
      </div>
      {targets.map((t) => {
        const styles = present.styles[t.key] ?? {};
        const text = present.text[t.key];
        return (
          <div key={t.key} className="list-item" style={{ alignItems: 'flex-start' }} data-testid="change-item">
            <div className="grow">
              <div className="row">
                <button className="btn sm ghost mono" onClick={() => selectTarget(t)} style={{ paddingLeft: 0 }}>
                  <span className="tree-tag">{t.label}</span>
                </button>
                {t.scope === 'source' && t.instanceCount > 1 && <span className="pill accent">all {t.instanceCount} instances</span>}
                {t.scope === 'instance' && t.instanceCount > 1 && <span className="pill warn">this instance only</span>}
                {t.src && <span className="faint mono ellipsis">{formatSourceLoc(t.src)}</span>}
              </div>
              {BREAKPOINT_ORDER.flatMap((bp) =>
                Object.entries(styles[bp] ?? {}).map(([prop, value]) => (
                  <div key={`${bp}${prop}`} className="change-prop">
                    <span className={`bp-badge ${bp}`}>{bp === 'base' ? 'all' : bp}</span>
                    <span style={{ color: '#8fb6ff' }}>{prop}</span>
                    <span>{value}</span>
                    <button className="reset-btn" title="Remove" onClick={() => removeOps([{ type: 'style', target: t, breakpoint: bp, property: prop, value: null }], `Remove ${prop} · ${t.label}`)}>
                      ×
                    </button>
                  </div>
                )),
              )}
              {text && (
                <div className="change-prop">
                  <span className="bp-badge">text</span>
                  <span className="faint ellipsis" style={{ maxWidth: 220 }}>
                    “{text.original}”
                  </span>
                  →<span className="ellipsis">“{text.value}”</span>
                  <button className="reset-btn" title="Restore original text" onClick={() => removeOps([{ type: 'text', target: t, value: null, original: text.original }], `Restore text · ${t.label}`)}>
                    ×
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TxIcon({ tx }: { tx: Transaction }) {
  if (tx.source === 'ai')
    return (
      <span className="src-icon ai">
        <Sparkles size={11} />
      </span>
    );
  if (tx.source === 'canvas')
    return (
      <span className="src-icon">
        <Hand size={11} />
      </span>
    );
  return (
    <span className="src-icon">
      <MousePointer2 size={11} />
    </span>
  );
}

function HistoryList() {
  const history = useEditor((s) => s.history);
  const jump = useEditor((s) => s.jump);
  const all = [...history.past, ...history.future];
  const current = history.past.length;
  return (
    <div data-testid="history">
      <div className={`list-item hist-item ${current === 0 ? 'current' : ''}`} onClick={() => jump(0)}>
        <span className="src-icon">
          <History size={11} />
        </span>
        <span className="grow">Original page</span>
      </div>
      {all.map((tx, i) => (
        <div key={tx.id} className={`list-item hist-item ${i + 1 === current ? 'current' : ''} ${i >= current ? 'future' : ''}`} onClick={() => jump(i + 1)} data-testid="history-item">
          <TxIcon tx={tx} />
          <span className="grow ellipsis">{tx.label}</span>
          <span className="faint">{tx.changes.length} op{tx.changes.length === 1 ? '' : 's'}</span>
          <span className="faint mono">{new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
      ))}
      {!all.length && (
        <div className="empty">
          <p>Your edits appear here as named steps. Click any step to travel back and forth; ⌘Z / ⌘⇧Z step through them.</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n').filter((l) => !l.startsWith('Index:') && !/^=+$/.test(l));
  return (
    <pre className="diff">
      {lines.map((l, i) => (
        <div key={i} className={l.startsWith('+++') || l.startsWith('---') ? 'meta' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}>
          {l || ' '}
        </div>
      ))}
    </pre>
  );
}

function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function MappingRow({ m }: { m: ChangeMapping }) {
  const patch = useEditor((s) => s.patch);
  const set = useEditor((s) => s.set);
  const canShare = !!m.message && /shared|Enable "edit shared class"/.test(m.message);
  const shared = !!patch.sharedClass[m.targetKey];
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }} data-testid="mapping">
      <span className={`status-dot ${m.status}`} style={{ marginTop: 5 }} title={m.status} />
      <div className="grow">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="tree-tag">{m.label}</span>
          <span className="faint mono">{m.properties.join(', ')}</span>
          <span className="arrow">→</span>
          {m.strategy && <span className={`strategy ${m.strategy}`}>{m.strategy}</span>}
          {m.file && <span className="mono muted">{m.file}</span>}
          <span className="mono">{m.detail}</span>
        </div>
        {m.message && <div className="muted" style={{ marginTop: 3 }}>{m.message}</div>}
        {canShare && (
          <label className="row" style={{ marginTop: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shared}
              onChange={() => {
                set({ patch: { ...patch, sharedClass: { ...patch.sharedClass, [m.targetKey]: !shared } } });
                setTimeout(generatePatch, 0);
              }}
            />
            Edit the shared class instead (changes every element that uses it)
          </label>
        )}
      </div>
    </div>
  );
}

function CodePanel() {
  const patch = useEditor((s) => s.patch);
  const present = useEditor((s) => s.history.present);
  const session = useEditor((s) => s.session);
  const [copied, setCopied] = useState(false);
  const result = patch.result;
  const edits = countEdits(present);
  const stale = !!result && patch.generatedFrom !== present && edits > 0;

  if (!result)
    return (
      <div className="empty">
        <FileCode2 size={22} />
        <h4>Turn your edits into code</h4>
        <p>
          {session?.mode === 'source'
            ? 'PixelForge maps each edited element to its JSX and styles (CSS Modules, global CSS, Tailwind or inline) and produces a minimal patch.'
            : 'Without source access, PixelForge exports an overrides stylesheet plus a patch of the page HTML.'}
        </p>
        {patch.error && <div className="notice err">{patch.error}</div>}
        <button className="btn primary" disabled={!edits || patch.loading} onClick={generatePatch} data-testid="generate-patch">
          {patch.loading ? <span className="spinner" /> : <FileCode2 size={14} />} Generate patch
        </button>
      </div>
    );

  const unified = result.files.map((f) => f.diff).join('\n');
  const counts = { mapped: 0, warning: 0, unmapped: 0 };
  result.mappings.forEach((m) => counts[m.status]++);
  return (
    <div data-testid="code-panel">
      <div className="list-item" style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
        <span className="grow row">
          <b>{result.files.length} file(s)</b>
          <span className="status-dot mapped" /> {counts.mapped}
          {counts.warning > 0 && (
            <>
              <span className="status-dot warning" /> {counts.warning}
            </>
          )}
          {counts.unmapped > 0 && (
            <>
              <span className="status-dot unmapped" /> {counts.unmapped}
            </>
          )}
          {stale && <span className="pill warn">edits changed — regenerate</span>}
        </span>
        <button className="btn sm" onClick={generatePatch} disabled={patch.loading}>
          <RotateCcw size={12} /> Regenerate
        </button>
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard?.writeText(unified);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} Copy
        </button>
        <button className="btn sm" onClick={() => download('pixelforge.patch', unified)}>
          <Download size={12} /> .patch
        </button>
        {session?.mode === 'url' && result.files.find((f) => f.path.endsWith('.css')) && (
          <button className="btn sm" onClick={() => download('pixelforge-overrides.css', result.files.find((f) => f.path.endsWith('.css'))!.after)}>
            <Download size={12} /> CSS
          </button>
        )}
        {session?.mode === 'source' && (
          <>
            <button className="btn sm" disabled={patch.loading || !!stale || !result.files.length} onClick={() => applyPatch(false)} title="Write files without verification">
              Apply
            </button>
            <button className="btn sm primary" disabled={patch.loading || !!stale || !result.files.length} onClick={() => applyPatch(true)} data-testid="apply-verify">
              {patch.loading ? <span className="spinner" /> : <ShieldCheck size={12} />} Apply &amp; verify
            </button>
          </>
        )}
      </div>
      {patch.error && (
        <div className="notice err" style={{ margin: 12 }}>
          {patch.error}
        </div>
      )}
      {result.mappings.map((m, i) => (
        <MappingRow key={i} m={m} />
      ))}
      {result.files.map((f) => (
        <div key={f.path} className="file-card" data-testid="file-diff">
          <div className="file-head">
            <FileCode2 size={13} />
            {f.path}
            {f.created && <span className="pill accent">new</span>}
          </div>
          <DiffView diff={f.diff} />
        </div>
      ))}
      {!result.files.length && <div className="empty">No file changes could be generated for these edits (see the reasons above).</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

type ShotKind = 'actual' | 'expected' | 'baseline' | 'diffExpected' | 'diffBaseline';

function Shot({ v }: { v: ViewportVerification }) {
  const [kind, setKind] = useState<ShotKind>(v.status === 'passed' ? 'diffBaseline' : 'diffExpected');
  const [w, setW] = useState(0);
  const regions: Rect[] = kind === 'diffExpected' ? v.unexpectedRegions : kind === 'diffBaseline' || kind === 'actual' ? v.changedRegions : [];
  const scale = w / v.size.width;
  const labels: Record<ShotKind, string> = { actual: 'After (source)', expected: 'Expected (edit)', baseline: 'Before', diffExpected: 'Unexpected diff', diffBaseline: 'What changed' };
  return (
    <div className="shot" data-testid="verify-viewport">
      <div className="shot-head">
        <span className={`status-dot ${v.status}`} />
        <b>{v.viewport.id}</b>
        <span className="faint">{v.viewport.width}px</span>
        <span className="grow" />
        <span title="Pixels differing between the patched source and your live edit">
          Δ edit <b className="mono">{(v.mismatchVsExpected * 100).toFixed(2)}%</b>
        </span>
        <span title="Pixels that changed compared to the original page">
          changed <b className="mono">{(v.changedVsBaseline * 100).toFixed(1)}%</b>
        </span>
      </div>
      <div className="seg" style={{ margin: 6, display: 'flex' }}>
        {(Object.keys(labels) as ShotKind[]).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} style={{ flex: 1, fontSize: 10.5, padding: '0 4px' }}>
            {labels[k]}
          </button>
        ))}
      </div>
      <div className="shot-img">
        <img src={v.images[kind]} alt={`${v.viewport.id} ${kind}`} onLoad={(e) => setW((e.target as HTMLImageElement).clientWidth)} />
        {w > 0 &&
          regions.slice(0, 20).map((r, i) => <div key={i} className={`region ${kind === 'diffExpected' ? '' : 'changed'}`} style={{ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale }} />)}
      </div>
    </div>
  );
}

function VerifyPanel() {
  const patch = useEditor((s) => s.patch);
  const session = useEditor((s) => s.session);
  const job = patch.job;
  if (!job)
    return (
      <div className="empty">
        <ShieldCheck size={22} />
        <h4>Visual verification</h4>
        <p>After “Apply &amp; verify”, PixelForge renders the original, your live edit and the reloaded patched source at desktop, tablet and mobile widths and compares them pixel by pixel.</p>
        {session?.project?.isDemo && (
          <button className="btn sm" onClick={resetDemoProject}>
            <Undo2 size={12} /> Reset demo source
          </button>
        )}
      </div>
    );
  const report = job.result;
  const failedChecks = report?.propertyChecks.filter((c) => !c.pass) ?? [];
  return (
    <div data-testid="verify-panel">
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {job.steps.map((st, i) => (
          <div key={i} className="row">
            <span className={`status-dot ${st.status}`} />
            <span>{st.label}</span>
            {st.detail && <span className="faint">— {st.detail}</span>}
          </div>
        ))}
        {job.status === 'running' && (
          <div className="row faint">
            <span className="spinner" /> Working…
          </div>
        )}
        {job.error && <div className="notice err">{job.error}</div>}
      </div>
      {report && (
        <>
          <div className={`notice ${report.status === 'passed' ? 'ok' : report.status === 'warning' ? 'warn' : 'err'}`} style={{ margin: '0 12px' }} data-testid="verify-summary">
            <div className="grow">
              <b>{report.status === 'passed' ? 'Verified' : report.status === 'warning' ? 'Nearly identical' : 'Differences found'}</b> — {report.summary}
              <div className="faint" style={{ marginTop: 2 }}>
                {report.propertyChecks.length - failedChecks.length}/{report.propertyChecks.length} property checks passed · tolerance {(VERIFY_TOLERANCE * 100).toFixed(1)}% · {(report.durationMs / 1000).toFixed(1)}s
              </div>
            </div>
            {patch.applied && (
              <button className="btn sm" onClick={revertAppliedPatch} data-testid="revert-patch">
                <Undo2 size={12} /> Revert patch
              </button>
            )}
          </div>
          <div className="verify-grid">
            {report.viewports.map((v) => (
              <Shot key={v.viewport.id} v={v} />
            ))}
          </div>
          {failedChecks.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Element</th>
                  <th>Property</th>
                  <th>Viewport</th>
                  <th>Expected</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {failedChecks.map((c, i) => (
                  <tr key={i}>
                    <td className="mono">{c.targetLabel}</td>
                    <td className="mono">{c.property}</td>
                    <td>{c.viewport}</td>
                    <td className="mono">{c.expected}</td>
                    <td className="mono" style={{ color: 'var(--err)' }}>
                      {c.actual ?? 'element not found'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.consoleErrors.length > 0 && (
            <div className="notice warn" style={{ margin: 12 }}>
              Console errors after reload: {report.consoleErrors.join(' · ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AIActivity() {
  const log = useEditor((s) => s.ai.log);
  if (!log.length)
    return (
      <div className="empty">
        <Bot size={22} />
        <p>AI requests and their outcome (applied, rejected, failed) are recorded here. Press ⌘K to start.</p>
      </div>
    );
  return (
    <div>
      {log.map((l, i) => (
        <div key={i} className="list-item">
          <span className={`status-dot ${l.status === 'applied' ? 'done' : l.status === 'error' ? 'error' : l.status === 'rejected' ? 'pending' : 'running'}`} />
          <div className="grow">
            <div>{l.instruction}</div>
            <div className="faint">{l.summary}</div>
          </div>
          <span className="pill">{l.status}</span>
          <span className="faint">{l.provider}</span>
        </div>
      ))}
    </div>
  );
}

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const set = useEditor((s) => s.set);
  const edits = useEditor((s) => countEdits(s.history.present));
  const steps = useEditor((s) => s.history.past.length);
  const job = useEditor((s) => s.patch.job);
  const tabs: Array<[BottomTab, string, React.ReactNode, React.ReactNode?]> = [
    ['changes', 'Changes', <ListChecks size={13} />, edits ? <span className="badge">{edits}</span> : null],
    ['history', 'History', <History size={13} />, steps ? <span className="faint">{steps}</span> : null],
    ['code', 'Code', <FileCode2 size={13} />],
    ['verify', 'Verify', <ShieldCheck size={13} />, job ? <span className={`status-dot ${job.status === 'running' ? 'running' : job.result?.status ?? 'error'}`} /> : null],
    ['ai', 'AI activity', <Sparkles size={13} />],
  ];
  return (
    <div className="panel">
      <div className="panel-header">
        {tabs.map(([id, label, icon, extra]) => (
          <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => set({ bottomTab: id })} data-testid={`btab-${id}`}>
            {icon} {label} {extra}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'changes' && <Changes />}
        {tab === 'history' && <HistoryList />}
        {tab === 'code' && <CodePanel />}
        {tab === 'verify' && <VerifyPanel />}
        {tab === 'ai' && <AIActivity />}
      </div>
    </div>
  );
}
