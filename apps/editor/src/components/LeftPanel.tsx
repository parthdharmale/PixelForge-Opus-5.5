import { ChevronDown, ChevronRight, Component, FileText, Layers } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { TreeNode } from '@pixelforge/core';
import { editorBridge } from '../bridge/AgentBridge';
import { selectNode } from '../state/controller';
import { useEditor } from '../state/store';

function matches(n: TreeNode, q: string): boolean {
  const hay = `${n.tag} ${n.idAttr ?? ''} ${n.classes.join(' ')} ${n.components.join(' ')} ${n.text ?? ''}`.toLowerCase();
  return hay.includes(q);
}

/** Nodes to show for a query: matches plus their ancestors. */
function filterTree(root: TreeNode, q: string): Set<number> | null {
  if (!q) return null;
  const keep = new Set<number>();
  const visit = (n: TreeNode): boolean => {
    let any = matches(n, q);
    for (const c of n.children) if (visit(c)) any = true;
    if (any) keep.add(n.id);
    return any;
  };
  visit(root);
  return keep;
}

const Row = memo(function Row({ node, depth, filter, editedSrc }: { node: TreeNode; depth: number; filter: Set<number> | null; editedSrc: Set<string> }) {
  const expanded = useEditor((s) => s.expanded[node.id] ?? depth < 2);
  const selected = useEditor((s) => s.selectedId === node.id);
  const set = useEditor((s) => s.set);
  if (filter && !filter.has(node.id)) return null;
  const open = filter ? true : expanded;
  const hasKids = node.children.length > 0;
  const cls = node.classes.filter((c) => !/[[\]:/]/.test(c)).slice(0, 2).map((c) => `.${c.replace(/^_([A-Za-z0-9-]+)_[a-z0-9]{5}(_\d+)?$/, '$1')}`).join('');
  return (
    <>
      <div
        className={`tree-row ${selected ? 'selected' : ''} ${node.hidden ? 'dim' : ''}`}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => selectNode(node.id, { scroll: true })}
        onMouseEnter={() => editorBridge.call('hover', { nodeId: node.id }).then((g) => useEditor.getState().set({ hover: g })).catch(() => {})}
        data-testid="tree-row"
        data-node-id={node.id}
        title={node.src ?? undefined}
      >
        <button
          className="tree-caret"
          style={{ visibility: hasKids ? 'visible' : 'hidden' }}
          onClick={(e) => {
            e.stopPropagation();
            set((s) => ({ expanded: { ...s.expanded, [node.id]: !open } }));
          }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {node.components.length > 0 && (
          <span className="tree-comp" title={`Component root: ${node.components.join(' › ')}`}>
            <Component size={11} />
            {node.components[0]}
          </span>
        )}
        <span className="tree-tag">{node.tag}</span>
        {node.idAttr && <span className="tree-cls">#{node.idAttr}</span>}
        <span className="tree-cls">{cls}</span>
        {node.repeat > 1 && <span className="tree-repeat" title="Rendered from the same source location">×{node.repeat}</span>}
        {node.text && <span className="tree-text">{node.text}</span>}
        {node.src && editedSrc.has(node.src) && <span className="tree-edited" title="Edited" />}
      </div>
      {open && node.children.map((c) => <Row key={c.id} node={c} depth={depth + 1} filter={filter} editedSrc={editedSrc} />)}
    </>
  );
});

function LayersTab() {
  const tree = useEditor((s) => s.tree);
  const targets = useEditor((s) => s.history.present.targets);
  const [q, setQ] = useState('');
  const filter = useMemo(() => (tree ? filterTree(tree, q.trim().toLowerCase()) : null), [tree, q]);
  const editedSrc = useMemo(() => new Set(Object.values(targets).map((t) => (t.src ? `${t.src.file}:${t.src.line}:${t.src.column}` : '')).filter(Boolean)), [targets]);
  if (!tree)
    return (
      <div className="empty">
        <span className="spinner" />
        <p>Waiting for the page…</p>
      </div>
    );
  return (
    <>
      <input className="input search" placeholder="Filter by tag, class, component, text" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 'calc(100% - 16px)' }} />
      <div onMouseLeave={() => editorBridge.call('hover', { nodeId: null }).then(() => useEditor.getState().set({ hover: null })).catch(() => {})}>
        <Row node={tree} depth={0} filter={filter} editedSrc={editedSrc} />
      </div>
    </>
  );
}

function PagesTab() {
  const links = useEditor((s) => s.links);
  const page = useEditor((s) => s.page);
  const session = useEditor((s) => s.session);
  const current = page ? new URL(page.url).pathname : '/';
  const navigate = (href: string) => {
    const s = useEditor.getState();
    if (!s.session || !s.page) return;
    const base = new URL(s.page.url);
    const target = new URL(href, base);
    s.set({ pageLoading: true, selectedId: null, details: null, selected: null });
    const frameUrl = s.session.mode === 'url' ? `${base.origin}/__pf/open?url=${encodeURIComponent(new URL(target.pathname + target.search, s.session.originalUrl).href)}` : target.href;
    s.set({ session: { ...s.session, frameUrl } });
  };
  const pages = links.filter((l) => !l.href.startsWith('#'));
  return (
    <div>
      <div className="list-item">
        <FileText size={13} />
        <span className="grow ellipsis mono">{current}</span>
        <span className="pill accent">current</span>
      </div>
      {pages.length === 0 && (
        <div className="empty">
          <p>No other same-origin pages are linked from this page{session?.mode === 'source' ? ' (single-page app)' : ''}.</p>
        </div>
      )}
      {pages.map((l) => (
        <div key={l.href} className="list-item hist-item" onClick={() => navigate(l.href)}>
          <FileText size={13} className="faint" />
          <span className="grow ellipsis">{l.text}</span>
          <span className="faint mono ellipsis" style={{ maxWidth: '45%' }}>
            {l.href}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LeftPanel() {
  const [tab, setTab] = useState<'layers' | 'pages'>('layers');
  return (
    <div className="panel">
      <div className="panel-header">
        <button className={`tab ${tab === 'layers' ? 'on' : ''}`} onClick={() => setTab('layers')}>
          <Layers size={13} /> Layers
        </button>
        <button className={`tab ${tab === 'pages' ? 'on' : ''}`} onClick={() => setTab('pages')}>
          <FileText size={13} /> Pages
        </button>
      </div>
      <div className="panel-body" data-testid="layers">
        {tab === 'layers' ? <LayersTab /> : <PagesTab />}
      </div>
    </div>
  );
}
