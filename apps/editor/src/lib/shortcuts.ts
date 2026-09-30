/**
 * Keyboard shortcuts. Keys pressed while the page iframe has focus are
 * forwarded by the agent, so shortcuts work wherever focus is.
 */
import { editorBridge } from '../bridge/AgentBridge';
import { setStyles } from '../state/edits';
import { useEditor } from '../state/store';

export interface KeyInput {
  key: string;
  code?: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  fromFrame?: boolean;
}

export const SHORTCUTS: Array<{ keys: string; action: string }> = [
  { keys: '⌘/Ctrl Z', action: 'Undo' },
  { keys: '⌘/Ctrl ⇧ Z  ·  Ctrl Y', action: 'Redo' },
  { keys: '⌘/Ctrl K', action: 'AI command bar' },
  { keys: '⌘/Ctrl ⇧ G', action: 'Generate code patch' },
  { keys: 'Esc', action: 'Close dialog · exit compare · deselect' },
  { keys: 'V / I', action: 'Select tool / Interact with page' },
  { keys: '1 · 2 · 3', action: 'Desktop · Tablet · Mobile viewport' },
  { keys: '\\', action: 'Toggle original (before/after)' },
  { keys: '↑ ↓ ← →', action: 'Parent · first child · previous · next sibling' },
  { keys: 'Enter', action: 'Edit text of selected element' },
  { keys: 'Delete', action: 'Hide selected element (display: none)' },
  { keys: '?', action: 'Show shortcuts' },
];

function findNode(id: number) {
  const tree = useEditor.getState().tree;
  let parent: import('@pixelforge/core').TreeNode | null = null;
  let found: import('@pixelforge/core').TreeNode | null = null;
  const visit = (n: import('@pixelforge/core').TreeNode, p: typeof parent) => {
    if (found) return;
    if (n.id === id) {
      found = n;
      parent = p;
      return;
    }
    n.children.forEach((c) => visit(c, n));
  };
  if (tree) visit(tree, null);
  return { node: found as import('@pixelforge/core').TreeNode | null, parent: parent as import('@pixelforge/core').TreeNode | null };
}

/** Returns true if the key was handled. */
export function handleKey(k: KeyInput): boolean {
  const s = useEditor.getState();
  const mod = k.meta || k.ctrl;
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
  if (!s.session) return false;

  if (mod && key === 'z') {
    if (k.shift) s.redo();
    else s.undo();
    return true;
  }
  if (mod && key === 'y') {
    s.redo();
    return true;
  }
  if (mod && key === 'k') {
    s.set({ ai: { ...s.ai, open: !s.ai.open } });
    return true;
  }
  if (mod && k.shift && key === 'g') {
    void import('../state/controller').then((c) => c.generatePatch());
    return true;
  }
  if (key === 'Escape') {
    if (s.showShortcuts) s.set({ showShortcuts: false });
    else if (s.ai.open) s.set({ ai: { ...s.ai, open: false } });
    else if (s.compare !== 'off') s.set({ compare: 'off' });
    else if (s.tool === 'interact') s.set({ tool: 'select' });
    else if (s.selectedId) void import('../state/controller').then((c) => c.selectNode(null));
    return true;
  }
  if (mod || k.alt) return false;

  switch (key) {
    case 'v':
      s.set({ tool: 'select' });
      return true;
    case 'i':
      s.set({ tool: 'interact' });
      return true;
    case '1':
      s.setViewport('desktop');
      return true;
    case '2':
      s.setViewport('tablet');
      return true;
    case '3':
      s.setViewport('mobile');
      return true;
    case '\\':
      s.set({ compare: s.compare === 'original' ? 'off' : 'original' });
      return true;
    case '?':
      s.set({ showShortcuts: !s.showShortcuts });
      return true;
  }
  if (!s.selectedId) return false;
  const { node, parent } = findNode(s.selectedId);
  const go = (id: number | undefined | null) => {
    if (id) void import('../state/controller').then((c) => c.selectNode(id, { scroll: true }));
  };
  switch (key) {
    case 'ArrowUp':
      go(parent?.id);
      return true;
    case 'ArrowDown':
      go(node?.children[0]?.id);
      return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      if (!parent || !node) return true;
      const i = parent.children.findIndex((c) => c.id === node.id);
      go(parent.children[i + (key === 'ArrowLeft' ? -1 : 1)]?.id);
      return true;
    }
    case 'Enter':
      if (s.details?.text.editable) editorBridge.call('editText', { nodeId: s.selectedId }).catch(() => {});
      return true;
    case 'Delete':
    case 'Backspace':
      setStyles({ display: 'none' }, { label: `Hide ${s.details?.label ?? 'element'}`, coalesce: false });
      return true;
  }
  return false;
}

export function installWindowShortcuts() {
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const typing = t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const mod = e.metaKey || e.ctrlKey;
    if (typing && !(mod && ['z', 'y', 'k'].includes(e.key.toLowerCase())) && e.key !== 'Escape') return;
    // Let native undo work inside text inputs.
    if (typing && mod && ['z', 'y'].includes(e.key.toLowerCase())) return;
    if (handleKey({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
  });
}
