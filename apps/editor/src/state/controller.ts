/**
 * Orchestration between the store, the in-page agent and the server:
 * session lifecycle, page sync (edit state → page), selection, AI and
 * code generation workflows.
 */
import {
  applyChange,
  buildTransaction,
  createHistory,
  emptyState,
  overlayStates,
  resolvePlan,
  toChange,
  type EditState,
  type ElementDetails,
  type TreeNode,
} from '@pixelforge/core';
import { editorBridge, originalBridge } from '../bridge/AgentBridge';
import { api } from '../lib/api';
import { handleKey } from '../lib/shortcuts';
import { setText } from './edits';
import { useEditor, type Session } from './store';

const get = useEditor.getState;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function startSession(session: Session) {
  get().set({
    session,
    page: null,
    pageLoading: true,
    pageError: null,
    tree: null,
    selectedId: null,
    selected: null,
    details: null,
    hover: null,
    history: createHistory(),
    livePreview: null,
    patch: { result: null, generatedFrom: null, loading: false, error: null, sharedClass: {}, job: null, applied: null },
    compare: 'off',
  });
  try {
    const recent = JSON.parse(localStorage.getItem('pf:recent') ?? '[]') as string[];
    const entry = session.mode === 'source' ? `project:${session.project?.isDemo ? 'demo' : session.project?.root}` : session.originalUrl;
    localStorage.setItem('pf:recent', JSON.stringify([entry, ...recent.filter((r) => r !== entry)].slice(0, 6)));
  } catch {
    /* storage unavailable */
  }
}

export async function openUrl(url: string) {
  const res = await api.openUrl(url);
  startSession({ mode: 'url', frameUrl: res.frameUrl, originalUrl: res.originalUrl, project: null });
}

export async function openProject(opts: { demo?: boolean; path?: string; devUrl?: string }) {
  let project = await api.openProject(opts);
  for (let i = 0; i < 120 && project.status === 'starting'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    project = await api.project(project.id);
  }
  if (project.status !== 'ready' || !project.url) throw new Error(project.error ?? 'The dev server did not start');
  startSession({ mode: 'source', frameUrl: project.url, originalUrl: project.url, project });
}

export function closeSession() {
  get().set({ session: null, page: null, tree: null, details: null, selectedId: null, selected: null, hover: null });
}

export function reloadPage() {
  const s = get();
  if (!s.session) return;
  // Changing the key forces the iframe to remount.
  s.set({ session: { ...s.session, frameUrl: s.session.frameUrl.includes('#') ? s.session.frameUrl.split('#')[0] : `${s.session.frameUrl}#r${Date.now()}` }, pageLoading: true });
}

/** URL of the current page on the real site (url mode) or dev server. */
export function currentPageUrl(): string {
  const s = get();
  if (!s.session) return '';
  if (!s.page) return s.session.originalUrl;
  const u = new URL(s.page.url);
  if (s.session.mode === 'url') return new URL(u.pathname + u.search, s.session.originalUrl).href;
  return s.page.url;
}

// ---------------------------------------------------------------------------
// Page sync
// ---------------------------------------------------------------------------

export function aiPreviewState(): EditState | null {
  const { ai } = get();
  if (!ai.plan || !ai.ops.length) return null;
  let s = emptyState();
  ai.ops.forEach((o, i) => {
    if (!ai.excluded.includes(i)) s = applyChange(s, toChange(s, o.op));
  });
  return s;
}

export function effectiveState(): EditState {
  const s = get();
  const base = s.livePreview ?? s.history.present;
  const ai = aiPreviewState();
  return ai ? overlayStates(base, ai) : base;
}

let pushScheduled = false;
export function pushState() {
  if (pushScheduled) return;
  pushScheduled = true;
  requestAnimationFrame(() => {
    pushScheduled = false;
    if (!editorBridge.ready) return;
    editorBridge
      .call('setState', { state: effectiveState() })
      .then((res) => {
        get().set({ applyResult: res });
        scheduleDetails();
      })
      .catch(() => {});
  });
}

let detailsTimer = 0;
function scheduleDetails(delay = 60) {
  clearTimeout(detailsTimer);
  detailsTimer = window.setTimeout(refreshDetails, delay);
}

export async function refreshDetails() {
  const { selectedId } = get();
  if (!selectedId || !editorBridge.ready) return;
  try {
    const details = await editorBridge.call('getDetails', { nodeId: selectedId });
    if (get().selectedId === selectedId) get().set({ details });
    if (!details) get().set({ selectedId: null, selected: null });
  } catch {
    /* page navigating */
  }
}

let treeTimer = 0;
export function refreshTree() {
  clearTimeout(treeTimer);
  treeTimer = window.setTimeout(async () => {
    if (!editorBridge.ready) return;
    try {
      const tree = await editorBridge.call('getTree', {});
      get().set({ tree });
    } catch {
      /* ignore */
    }
  }, 50);
}

function ancestorsOf(tree: TreeNode | null, id: number): number[] {
  if (!tree) return [];
  const path: number[] = [];
  const visit = (n: TreeNode): boolean => {
    if (n.id === id) return true;
    for (const c of n.children) {
      if (visit(c)) {
        path.push(n.id);
        return true;
      }
    }
    return false;
  };
  visit(tree);
  return path;
}

let lastSelectionRef: { selector: string; src: string | null } | null = null;

export async function selectNode(nodeId: number | null, opts: { scroll?: boolean } = {}) {
  const s = get();
  if (nodeId === null) {
    s.set({ selectedId: null, selected: null, details: null });
    lastSelectionRef = null;
    editorBridge.call('select', { nodeId: null }).catch(() => {});
    return;
  }
  const expanded = { ...s.expanded };
  for (const a of ancestorsOf(s.tree, nodeId)) expanded[a] = true;
  s.set({ selectedId: nodeId, expanded });
  if (opts.scroll) await editorBridge.call('scrollIntoView', { nodeId }).catch(() => {});
  const geometry = await editorBridge.call('select', { nodeId }).catch(() => null);
  const details = await editorBridge.call('getDetails', { nodeId }).catch(() => null);
  if (get().selectedId !== nodeId) return;
  get().set({ selected: geometry, details, instanceScope: 'source' });
  if (details) lastSelectionRef = { selector: details.selector, src: details.src ? `${details.src.file}:${details.src.line}:${details.src.column}` : null };
}

async function onReady() {
  const s = get();
  try {
    const page = await editorBridge.call('init', { role: 'editor' });
    get().set({ page, pageLoading: false, pageError: null });
    await editorBridge.call('setMode', { mode: s.tool });
    pushState();
    const [tree, links] = await Promise.all([editorBridge.call('getTree', {}), editorBridge.call('links', {})]);
    get().set({ tree, links, hover: null });
    if (lastSelectionRef) {
      const id = await editorBridge.call('resolve', lastSelectionRef);
      if (id) await selectNode(id);
      else get().set({ selectedId: null, selected: null, details: null });
    }
  } catch (e) {
    get().set({ pageError: (e as Error).message, pageLoading: false });
  }
}

let wired = false;
export function wireEditor() {
  if (wired) return;
  wired = true;
  editorBridge.on('ready', onReady);
  editorBridge.on('hover', ({ geometry }) => get().set({ hover: geometry }));
  editorBridge.on('select', ({ nodeId }) => {
    if (get().ai.open && get().ai.loading) return;
    void selectNode(nodeId);
  });
  editorBridge.on('geometry', ({ hover, selected }) => get().set({ hover, selected: get().selectedId ? selected : null }));
  editorBridge.on('treeChanged', () => {
    refreshTree();
    scheduleDetails(100);
  });
  editorBridge.on('applied', (res) => {
    get().set({ applyResult: res });
    scheduleDetails();
  });
  editorBridge.on('key', (k) => handleKey({ ...k, fromFrame: true }));
  editorBridge.on('textCommit', async ({ nodeId, text }) => {
    const details = nodeId === get().selectedId && get().details ? get().details : await editorBridge.call('getDetails', { nodeId }).catch(() => null);
    if (details) setText(details as ElementDetails, text, 'canvas');
  });
  originalBridge.on('ready', () => {
    originalBridge.call('init', { role: 'original' }).catch(() => {});
    originalBridge.call('setSyncScroll', { enabled: true }).catch(() => {});
    editorBridge.call('setSyncScroll', { enabled: true }).catch(() => {});
  });
  editorBridge.on('scroll', (p) => {
    if (get().compare !== 'off' && originalBridge.ready) originalBridge.call('scrollTo', p).catch(() => {});
  });
  originalBridge.on('scroll', (p) => {
    if (get().compare === 'split') editorBridge.call('scrollTo', p).catch(() => {});
  });

  useEditor.subscribe((s, prev) => {
    if (s.history.present.text !== prev.history.present.text) refreshTree();
    if (s.history !== prev.history || s.livePreview !== prev.livePreview || s.ai.ops !== prev.ai.ops || s.ai.excluded !== prev.ai.excluded || s.ai.plan !== prev.ai.plan) pushState();
    if (s.tool !== prev.tool && editorBridge.ready) editorBridge.call('setMode', { mode: s.tool }).catch(() => {});
    if (s.editBreakpoint !== prev.editBreakpoint || s.instanceScope !== prev.instanceScope) scheduleDetails(0);
  });
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export async function runAI(instruction: string) {
  const s = get();
  const nodeId = s.selectedId ?? s.tree?.id;
  if (!nodeId) return;
  s.set({ ai: { ...s.ai, instruction, loading: true, error: null, plan: null, ops: [], rejected: [], excluded: [] } });
  try {
    const context = await editorBridge.call('getContext', { nodeId, depth: 5 });
    if (!context) throw new Error('Selected element is no longer on the page');
    const plan = await api.aiPlan(
      {
        instruction,
        context,
        viewport: { width: s.width, breakpoint: s.editBreakpoint },
        page: { url: currentPageUrl(), title: s.page?.title ?? '' },
      },
      s.ai.provider,
    );
    const { ops, rejected } = resolvePlan(plan, context);
    const ai = get().ai;
    get().set({
      ai: {
        ...ai,
        loading: false,
        plan,
        ops,
        rejected: rejected.map((r) => ({ reason: r.reason })),
        log: [{ at: Date.now(), instruction, summary: plan.summary, status: 'proposed', provider: plan.provider }, ...ai.log],
      },
    });
  } catch (e) {
    const ai = get().ai;
    get().set({ ai: { ...ai, loading: false, error: (e as Error).message, log: [{ at: Date.now(), instruction, summary: (e as Error).message, status: 'error', provider: ai.provider }, ...ai.log] } });
  }
}

export function applyAI() {
  const s = get();
  const ops = s.ai.ops.filter((_, i) => !s.ai.excluded.includes(i)).map((o) => o.op);
  if (!ops.length) return;
  const tx = buildTransaction(s.history.present, ops, { label: `AI: ${truncate(s.ai.instruction, 48)}`, source: 'ai', meta: { provider: s.ai.plan?.provider } });
  s.commitTx(tx);
  const log = [...s.ai.log];
  if (log[0]?.status === 'proposed') log[0] = { ...log[0], status: 'applied' };
  s.set({ ai: { ...s.ai, open: false, plan: null, ops: [], excluded: [], rejected: [], log } });
  s.toast('success', `Applied ${ops.length} AI change${ops.length === 1 ? '' : 's'} — undo with ⌘Z`);
}

export function rejectAI() {
  const s = get();
  const log = [...s.ai.log];
  if (log[0]?.status === 'proposed') log[0] = { ...log[0], status: 'rejected' };
  s.set({ ai: { ...s.ai, plan: null, ops: [], excluded: [], rejected: [], error: null, log } });
}

function truncate(t: string, n: number) {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// Code generation & verification
// ---------------------------------------------------------------------------

export async function generatePatch() {
  const s = get();
  if (!s.session) return;
  s.set({ patch: { ...s.patch, loading: true, error: null }, bottomTab: 'code' });
  try {
    const state = s.history.present;
    const result = s.session.mode === 'source' ? await api.codegenSource(s.session.project!.id, state, s.patch.sharedClass) : await api.codegenUrl(currentPageUrl(), state);
    get().set({ patch: { ...get().patch, loading: false, result, generatedFrom: state } });
  } catch (e) {
    get().set({ patch: { ...get().patch, loading: false, error: (e as Error).message } });
  }
}

export async function applyPatch(verify: boolean) {
  const s = get();
  const result = s.patch.result;
  const project = s.session?.project;
  if (!result || !project) return;
  const pagePath = s.page ? new URL(s.page.url).pathname : '/';
  const backup = s.history;
  s.set({ patch: { ...s.patch, loading: true, error: null, job: null } });
  try {
    const res = await api.apply(project.id, result.id, verify, pagePath);
    // The edits now live in source: start a fresh history on top of them.
    get().set({ history: createHistory(), patch: { ...get().patch, applied: { patchId: result.id, history: backup } } });
    if (!res.jobId) {
      get().set({ patch: { ...get().patch, loading: false } });
      get().toast('success', `Patched ${res.files?.length ?? 0} file(s); the dev server is reloading.`);
      return;
    }
    get().set({ bottomTab: 'verify' });
    let job = await api.job(res.jobId);
    while (job.status === 'running') {
      get().set({ patch: { ...get().patch, job } });
      await new Promise((r) => setTimeout(r, 600));
      job = await api.job(res.jobId);
    }
    get().set({ patch: { ...get().patch, job, loading: false } });
    if (job.status === 'error') get().toast('error', `Verification failed: ${job.error}`);
    else if (job.result?.status === 'passed') get().toast('success', 'Verified: the source change reproduces your edit.');
    else get().toast('info', 'Verification finished with differences — review the Verify tab.');
  } catch (e) {
    get().set({ patch: { ...get().patch, loading: false, error: (e as Error).message } });
    get().toast('error', (e as Error).message);
  }
}

export async function revertAppliedPatch() {
  const s = get();
  const applied = s.patch.applied;
  const project = s.session?.project;
  if (!applied || !project) return;
  try {
    await api.revert(project.id, applied.patchId);
    // Bring the visual edits back so nothing is lost.
    get().set({ history: applied.history, patch: { ...get().patch, applied: null, job: null } });
    get().toast('success', 'Patch reverted; your edits are back in the editor.');
  } catch (e) {
    get().toast('error', (e as Error).message);
  }
}

export async function resetDemoProject() {
  const project = get().session?.project;
  if (!project?.isDemo) return;
  await api.resetDemo(project.id);
  get().set({ history: createHistory(), patch: { result: null, generatedFrom: null, loading: false, error: null, sharedClass: {}, job: null, applied: null } });
  get().toast('info', 'Demo source restored to its original state.');
}
