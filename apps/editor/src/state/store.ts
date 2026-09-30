/**
 * Editor state. Pure data + small synchronous reducers; side effects
 * (talking to the page or the server) live in ../controller/*.
 */
import { create } from 'zustand';
import {
  breakpointForWidth,
  canRedo,
  canUndo,
  commit,
  createHistory,
  emptyState,
  jumpTo,
  redo,
  undo,
  VIEWPORT_PRESETS,
  type AIPlan,
  type AIProviderInfo,
  type ApplyResult,
  type BreakpointId,
  type EditState,
  type ElementDetails,
  type Geometry,
  type HistoryState,
  type Job,
  type PageInfo,
  type PatchResult,
  type ProjectStatus,
  type ResolvedAIOp,
  type Transaction,
  type TreeNode,
  type VerificationReport,
} from '@pixelforge/core';

export type SessionMode = 'url' | 'source';
export type ViewportPresetId = 'desktop' | 'tablet' | 'mobile' | 'custom';
export type CompareMode = 'off' | 'split' | 'slider' | 'original';
export type BottomTab = 'changes' | 'history' | 'code' | 'verify' | 'ai';

export interface Session {
  mode: SessionMode;
  frameUrl: string;
  /** Public URL (url mode) or dev-server URL (source mode) of the page. */
  originalUrl: string;
  project: ProjectStatus | null;
}

export interface AIState {
  open: boolean;
  instruction: string;
  loading: boolean;
  plan: AIPlan | null;
  ops: ResolvedAIOp[];
  rejected: Array<{ reason: string }>;
  /** Indices of ops the user has deselected. */
  excluded: number[];
  error: string | null;
  providers: AIProviderInfo[];
  provider: string;
  log: Array<{ at: number; instruction: string; summary: string; status: 'applied' | 'rejected' | 'proposed' | 'error'; provider: string }>;
}

export interface PatchState {
  result: PatchResult | null;
  /** The edit state the current result was generated from (identity). */
  generatedFrom: EditState | null;
  loading: boolean;
  error: string | null;
  sharedClass: Record<string, boolean>;
  job: Job<VerificationReport> | null;
  applied: { patchId: string; history: HistoryState } | null;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface EditorStore {
  session: Session | null;
  page: PageInfo | null;
  pageLoading: boolean;
  pageError: string | null;

  preset: ViewportPresetId;
  width: number;
  height: number;
  editBreakpoint: BreakpointId;
  breakpointPinned: boolean;
  tool: 'select' | 'interact';
  compare: CompareMode;
  sliderPos: number;

  tree: TreeNode | null;
  expanded: Record<number, boolean>;
  hover: Geometry | null;
  selectedId: number | null;
  selected: Geometry | null;
  details: ElementDetails | null;
  instanceScope: 'source' | 'instance';

  history: HistoryState;
  /** Uncommitted live edit (e.g. while dragging a handle). */
  livePreview: EditState | null;
  applyResult: ApplyResult;

  ai: AIState;
  patch: PatchState;
  bottomTab: BottomTab;
  showShortcuts: boolean;
  toasts: Toast[];
  links: Array<{ href: string; text: string }>;

  set: (partial: Partial<EditorStore> | ((s: EditorStore) => Partial<EditorStore>)) => void;
  setViewport: (preset: ViewportPresetId, width?: number) => void;
  commitTx: (tx: Transaction) => void;
  undo: () => void;
  redo: () => void;
  jump: (index: number) => void;
  toast: (kind: Toast['kind'], text: string) => void;
}

let toastId = 0;

export const useEditor = create<EditorStore>((set, get) => ({
  session: null,
  page: null,
  pageLoading: false,
  pageError: null,

  preset: 'desktop',
  width: 1440,
  height: 900,
  editBreakpoint: 'base',
  breakpointPinned: false,
  tool: 'select',
  compare: 'off',
  sliderPos: 0.5,

  tree: null,
  expanded: {},
  hover: null,
  selectedId: null,
  selected: null,
  details: null,
  instanceScope: 'source',

  history: createHistory(),
  livePreview: null,
  applyResult: { unresolved: [], suppressed: [] },

  ai: { open: false, instruction: '', loading: false, plan: null, ops: [], rejected: [], excluded: [], error: null, providers: [], provider: 'heuristic', log: [] },
  patch: { result: null, generatedFrom: null, loading: false, error: null, sharedClass: {}, job: null, applied: null },
  bottomTab: 'changes',
  showShortcuts: false,
  toasts: [],
  links: [],

  set: (partial) => set(partial as Partial<EditorStore>),

  setViewport: (preset, width) => {
    const p = VIEWPORT_PRESETS.find((v) => v.id === preset);
    const w = Math.max(280, Math.min(2560, Math.round(width ?? p?.width ?? get().width)));
    const s = get();
    set({
      preset,
      width: w,
      height: p?.height ?? s.height,
      editBreakpoint: s.breakpointPinned ? s.editBreakpoint : breakpointForWidth(w),
    });
  },

  commitTx: (tx) => set((s) => ({ history: commit(s.history, tx, Date.now()), livePreview: null })),
  undo: () => set((s) => (canUndo(s.history) ? { history: undo(s.history) } : {})),
  redo: () => set((s) => (canRedo(s.history) ? { history: redo(s.history) } : {})),
  jump: (index) => set((s) => ({ history: jumpTo(s.history, index) })),

  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3500);
  },
}));

export const selectEditState = (s: EditorStore): EditState => s.history.present;
export { emptyState };
