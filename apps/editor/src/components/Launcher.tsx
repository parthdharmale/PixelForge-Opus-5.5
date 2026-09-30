import { Code2, FolderGit2, Globe, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { openProject, openUrl } from '../state/controller';
import { useEditor } from '../state/store';

export function Launcher() {
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [devUrl, setDevUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixtures, setFixtures] = useState<Array<{ name: string; path: string }>>([]);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    api.fixtures().then(setFixtures).catch(() => {});
    try {
      setRecent(JSON.parse(localStorage.getItem('pf:recent') ?? '[]'));
    } catch {
      setRecent([]);
    }
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const openRecent = (r: string) => {
    if (r === 'project:demo') return run('demo', () => openProject({ demo: true }));
    if (r.startsWith('project:')) return run('path', () => openProject({ path: r.slice(8) }));
    return run('url', () => openUrl(r));
  };

  const providers = useEditor((s) => s.ai.providers);
  const llm = providers.find((p) => p.id === 'anthropic');

  return (
    <div className="launcher">
      <div className="launcher-inner">
        <div className="brand">
          <div className="brand-mark">P</div>
          PixelForge
        </div>
        <h1>Edit any website visually. Ship the change as code.</h1>
        <p className="lead">Inspect and restyle a live page, compare before and after, ask AI for changes, then generate a source patch and verify it renders exactly like your edit.</p>

        <div className="launch-card">
          <h3>
            <Globe size={15} /> Open a URL
          </h3>
          <form
            className="launch-url"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void run('url', () => openUrl(url.trim()));
            }}
          >
            <input className="input" placeholder="https://example.com" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="url-input" autoFocus />
            <button className="btn primary" disabled={!url.trim() || !!busy}>
              {busy === 'url' ? <span className="spinner" /> : null} Open
            </button>
          </form>
          {fixtures.length > 0 && (
            <div className="row muted">
              Local fixtures:
              <div className="chips">
                {fixtures.map((f) => (
                  <button key={f.name} className="chip" onClick={() => run('url', () => openUrl(`${location.protocol}//${location.hostname}:4000${f.path}`))}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="launch-grid">
          <div className="launch-card">
            <h3>
              <Sparkles size={15} /> Demo project <span className="pill accent">recommended</span>
            </h3>
            <p>Run the included Nimbus site (React, CSS Modules, Tailwind) in Source Project Mode: edits map to its source files, patches are applied and visually verified.</p>
            <button className="btn primary" onClick={() => run('demo', () => openProject({ demo: true }))} disabled={!!busy} data-testid="open-demo">
              {busy === 'demo' ? (
                <>
                  <span className="spinner" /> Starting dev server…
                </>
              ) : (
                'Open demo project'
              )}
            </button>
          </div>
          <div className="launch-card">
            <h3>
              <FolderGit2 size={15} /> Your source project
            </h3>
            <p>Path to a Vite + React project on this machine. PixelForge starts its dev server with source instrumentation — no config changes.</p>
            <input className="input" placeholder="/path/to/project" value={path} onChange={(e) => setPath(e.target.value)} />
            <input className="input" placeholder="Optional: existing dev server URL" value={devUrl} onChange={(e) => setDevUrl(e.target.value)} />
            <button className="btn" disabled={!path.trim() || !!busy} onClick={() => run('path', () => openProject({ path: path.trim(), devUrl: devUrl.trim() || undefined }))}>
              {busy === 'path' ? <span className="spinner" /> : <Code2 size={14} />} Open project
            </button>
          </div>
        </div>

        {error && (
          <div className="notice err" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
        {recent.length > 0 && (
          <div className="row muted" style={{ marginTop: 16, flexWrap: 'wrap' }}>
            Recent:
            {recent.map((r) => (
              <button key={r} className="chip" onClick={() => openRecent(r)}>
                {r === 'project:demo' ? 'Demo project' : r.replace(/^project:/, '')}
              </button>
            ))}
          </div>
        )}
        <p className="faint" style={{ marginTop: 20 }}>
          AI: {llm?.available ? `Claude (${llm.model})` : 'offline heuristic engine — set ANTHROPIC_API_KEY on the server to use Claude'}
        </p>
      </div>
    </div>
  );
}
