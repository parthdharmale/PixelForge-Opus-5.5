import {
  applyTransaction,
  emptyState,
  isNoop,
  mergeTransactions,
  revertTransaction,
  type EditState,
  type Transaction,
} from './model.ts';

/**
 * Command-pattern history.
 *
 * `present` is always derivable as `past` applied to `baseline`, but we
 * keep it materialised for O(1) reads. Every transaction stores the
 * previous value of each slot it touches, so undo is exact and does not
 * depend on DOM snapshots.
 */
export interface HistoryState {
  baseline: EditState;
  present: EditState;
  past: Transaction[];
  future: Transaction[];
}

export const COALESCE_WINDOW_MS = 1200;

export function createHistory(baseline: EditState = emptyState()): HistoryState {
  return { baseline, present: baseline, past: [], future: [] };
}

export function commit(h: HistoryState, tx: Transaction, now = tx.timestamp): HistoryState {
  if (!tx.changes.length || isNoop(tx)) return h;
  const last = h.past[h.past.length - 1];
  if (last && tx.coalesceKey && last.coalesceKey === tx.coalesceKey && now - last.timestamp <= COALESCE_WINDOW_MS) {
    const merged = mergeTransactions(last, tx);
    const present = applyTransaction(h.present, tx);
    const past = merged.changes.length ? [...h.past.slice(0, -1), merged] : h.past.slice(0, -1);
    return { ...h, present, past, future: [] };
  }
  return { ...h, present: applyTransaction(h.present, tx), past: [...h.past, tx], future: [] };
}

export function canUndo(h: HistoryState): boolean {
  return h.past.length > 0;
}

export function canRedo(h: HistoryState): boolean {
  return h.future.length > 0;
}

export function undo(h: HistoryState): HistoryState {
  const tx = h.past[h.past.length - 1];
  if (!tx) return h;
  return { ...h, present: revertTransaction(h.present, tx), past: h.past.slice(0, -1), future: [tx, ...h.future] };
}

export function redo(h: HistoryState): HistoryState {
  const tx = h.future[0];
  if (!tx) return h;
  return { ...h, present: applyTransaction(h.present, tx), past: [...h.past, tx], future: h.future.slice(1) };
}

/** Jump so that exactly `index` transactions are applied (0 = baseline). */
export function jumpTo(h: HistoryState, index: number): HistoryState {
  let s = h;
  const target = Math.max(0, Math.min(index, h.past.length + h.future.length));
  while (s.past.length > target) s = undo(s);
  while (s.past.length < target) s = redo(s);
  return s;
}

/**
 * Start a new baseline (e.g. after edits were written to source). History
 * before this point is discarded because it no longer describes the
 * difference between the page and its source.
 */
export function rebase(h: HistoryState, baseline: EditState = emptyState()): HistoryState {
  return createHistory(baseline);
}
