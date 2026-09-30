import { describe, expect, it } from 'vitest';
import {
  buildTransaction,
  canRedo,
  canUndo,
  commit,
  compileEditCss,
  countEdits,
  createHistory,
  jumpTo,
  makeTarget,
  redo,
  undo,
  type EditOp,
  type HistoryState,
} from '@pixelforge/core';

const card = makeTarget({ scope: 'source', selector: 'article', src: { file: 'src/Card.tsx', line: 4, column: 4 }, label: 'article.card', component: 'Card', instanceCount: 3 });
const title = makeTarget({ scope: 'instance', selector: 'h1.title', src: null, label: 'h1.title', component: null, instanceCount: 1 });

function tx(h: HistoryState, ops: EditOp[], label: string, extra: { coalesceKey?: string; timestamp?: number } = {}) {
  return buildTransaction(h.present, ops, { label, source: 'manual', ...extra });
}

describe('history', () => {
  it('undoes and redoes transactions exactly', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'padding-top', value: '24px' }], 'Change padding'));
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'padding-top', value: '32px' }], 'Change padding again'));
    expect(h.present.styles[card.key].base!['padding-top']).toBe('32px');
    h = undo(h);
    expect(h.present.styles[card.key].base!['padding-top']).toBe('24px');
    h = undo(h);
    expect(h.present.styles[card.key]).toBeUndefined();
    expect(h.present.targets[card.key]).toBeUndefined();
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(h.present.styles[card.key].base!['padding-top']).toBe('32px');
    expect(canRedo(h)).toBe(false);
  });

  it('treats a multi-op transaction (e.g. an AI edit) as one undo step', () => {
    let h = createHistory();
    const ops: EditOp[] = [
      { type: 'style', target: card, breakpoint: 'base', property: 'border-top-left-radius', value: '16px' },
      { type: 'style', target: card, breakpoint: 'mobile', property: 'padding-top', value: '12px' },
      { type: 'text', target: title, value: 'New title', original: 'Old title' },
    ];
    h = commit(h, tx(h, ops, 'AI: make it premium'));
    expect(countEdits(h.present)).toBe(3);
    h = undo(h);
    expect(countEdits(h.present)).toBe(0);
    expect(h.future[0].label).toBe('AI: make it premium');
  });

  it('a new commit clears the redo stack', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'opacity', value: '0.5' }], 'a'));
    h = undo(h);
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'opacity', value: '0.8' }], 'b'));
    expect(canRedo(h)).toBe(false);
    expect(h.past.map((t) => t.label)).toEqual(['b']);
  });

  it('coalesces rapid edits of the same control into one step', () => {
    let h = createHistory();
    for (const [i, v] of ['12px', '13px', '14px'].entries()) {
      h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'font-size', value: v }], 'Font size', { coalesceKey: 'fs', timestamp: 1000 + i * 100 }));
    }
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present.styles[card.key]).toBeUndefined();
  });

  it('does not coalesce edits separated by more than the window', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'font-size', value: '12px' }], 'Font size', { coalesceKey: 'fs', timestamp: 1000 }));
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'font-size', value: '14px' }], 'Font size', { coalesceKey: 'fs', timestamp: 5000 }));
    expect(h.past).toHaveLength(2);
  });

  it('drops no-op transactions', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'opacity', value: null }], 'noop'));
    expect(h.past).toHaveLength(0);
  });

  it('jumps to any point in history', () => {
    let h = createHistory();
    for (const v of ['1', '2', '3']) h = commit(h, tx(h, [{ type: 'style', target: card, breakpoint: 'base', property: 'order', value: v }], `order ${v}`));
    h = jumpTo(h, 1);
    expect(h.present.styles[card.key].base!.order).toBe('1');
    expect(h.future).toHaveLength(2);
    h = jumpTo(h, 3);
    expect(h.present.styles[card.key].base!.order).toBe('3');
  });

  it('restores original text when a text edit is undone', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'text', target: title, value: 'A', original: 'Orig' }], 't1'));
    h = commit(h, tx(h, [{ type: 'text', target: title, value: 'B', original: 'Orig' }], 't2'));
    expect(h.present.text[title.key]).toEqual({ value: 'B', original: 'Orig' });
    h = undo(h);
    expect(h.present.text[title.key].value).toBe('A');
    h = undo(h);
    expect(h.present.text[title.key]).toBeUndefined();
  });
});

describe('compileEditCss', () => {
  it('orders base, tablet, mobile so narrower breakpoints win', () => {
    let h = createHistory();
    h = commit(h, tx(h, [
      { type: 'style', target: card, breakpoint: 'mobile', property: 'padding-top', value: '8px' },
      { type: 'style', target: card, breakpoint: 'base', property: 'padding-top', value: '32px' },
      { type: 'style', target: card, breakpoint: 'tablet', property: 'padding-top', value: '16px' },
    ], 'responsive padding'));
    const css = compileEditCss(h.present);
    const iBase = css.indexOf('32px');
    const iTab = css.indexOf('max-width: 1023px');
    const iMob = css.indexOf('max-width: 767px');
    expect(iBase).toBeGreaterThan(-1);
    expect(iBase).toBeLessThan(iTab);
    expect(iTab).toBeLessThan(iMob);
    expect(css).toContain('[data-pf-src="src/Card.tsx:4:4"]');
    expect(css).toContain('padding-top: 32px !important;');
  });

  it('uses the recorded selector for instance targets', () => {
    let h = createHistory();
    h = commit(h, tx(h, [{ type: 'style', target: title, breakpoint: 'base', property: 'color', value: 'red' }], 'c'));
    expect(compileEditCss(h.present, { important: false })).toBe('h1.title {\n  color: red;\n}');
  });
});
