import { describe, expect, it } from 'vitest';
import { activeBreakpoints, breakpointForWidth, compressDeclarations, expandShorthand, mediaToBreakpoint, normalizeValue, resolvePlan, type AIPlan, type ContextNode } from '@pixelforge/core';

describe('shorthands', () => {
  it('expands box shorthands', () => {
    expect(expandShorthand('padding', '8px 16px')).toEqual({ 'padding-top': '8px', 'padding-right': '16px', 'padding-bottom': '8px', 'padding-left': '16px' });
    expect(expandShorthand('margin', '0 auto')).toMatchObject({ 'margin-left': 'auto', 'margin-top': '0' });
    expect(expandShorthand('gap', '12px 24px')).toEqual({ 'row-gap': '12px', 'column-gap': '24px' });
    expect(expandShorthand('padding', 'calc(1px + 2px) 4px')).toMatchObject({ 'padding-top': 'calc(1px + 2px)', 'padding-right': '4px' });
  });

  it('compresses complete groups and leaves partial ones as longhands', () => {
    expect(compressDeclarations({ 'padding-top': '8px', 'padding-right': '16px', 'padding-bottom': '8px', 'padding-left': '16px', color: 'red' })).toEqual([['padding', '8px 16px'], ['color', 'red']]);
    expect(compressDeclarations({ 'padding-top': '8px', color: 'red' })).toEqual([['padding-top', '8px'], ['color', 'red']]);
    expect(compressDeclarations({ 'row-gap': '4px', 'column-gap': '4px' })).toEqual([['gap', '4px']]);
  });

  it('merges uniform border groups into a border shorthand', () => {
    const sides = ['top', 'right', 'bottom', 'left'];
    const decls: Record<string, string> = {};
    for (const s of sides) Object.assign(decls, { [`border-${s}-width`]: '1px', [`border-${s}-style`]: 'solid', [`border-${s}-color`]: '#333' });
    expect(compressDeclarations(decls)).toEqual([['border', '1px solid #333']]);
  });

  it('normalises bare numbers to px for lengths only', () => {
    expect(normalizeValue('padding-top', '12')).toBe('12px');
    expect(normalizeValue('line-height', '1.4')).toBe('1.4');
    expect(normalizeValue('opacity', '0.4')).toBe('0.4');
  });
});

describe('breakpoints', () => {
  it('maps widths to the most specific breakpoint', () => {
    expect(breakpointForWidth(1440)).toBe('base');
    expect(breakpointForWidth(1023)).toBe('tablet');
    expect(breakpointForWidth(768)).toBe('tablet');
    expect(breakpointForWidth(767)).toBe('mobile');
    expect(activeBreakpoints(390)).toEqual(['base', 'tablet', 'mobile']);
    expect(activeBreakpoints(900)).toEqual(['base', 'tablet']);
  });

  it('recognises equivalent media queries in user stylesheets', () => {
    expect(mediaToBreakpoint('(max-width: 767px)')).toBe('mobile');
    expect(mediaToBreakpoint('screen and (max-width:1023px)')).toBe('tablet');
    expect(mediaToBreakpoint('(width < 48rem)')).toBe('mobile');
    expect(mediaToBreakpoint('(min-width: 768px)')).toBeNull();
  });
});

describe('AI plan resolution', () => {
  const ctx: ContextNode = {
    ref: 'n0', nodeId: 1, tag: 'section', label: 'section.hero', selector: '#top', src: 'src/Hero.tsx:3:4', instanceCount: 1, text: null, textEditable: false,
    styles: { 'padding-top': '96px' }, rect: { width: 1000, height: 600 },
    children: [{ ref: 'n1', nodeId: 2, tag: 'h1', label: 'h1.title', selector: '#top h1', src: 'src/Hero.tsx:5:6', instanceCount: 1, text: 'Hello', textEditable: true, styles: {}, rect: { width: 500, height: 60 }, children: [] }],
  };
  const plan = (operations: AIPlan['operations']): AIPlan => ({ summary: '', rationale: [], operations, provider: 'test', model: null, warnings: [], durationMs: 0 });

  it('expands shorthands and targets source locations', () => {
    const { ops, rejected } = resolvePlan(plan([{ ref: 'n0', kind: 'style', property: 'padding', value: '120px 24px', breakpoint: 'base' }]), ctx);
    expect(rejected).toHaveLength(0);
    expect(ops.map((o) => o.op.type === 'style' && o.op.property)).toEqual(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
    expect(ops[0].op.target.key).toBe('src:src/Hero.tsx:3:4');
    expect(ops[0].before).toBe('96px');
  });

  it('rejects unknown refs, unsafe values and text on containers', () => {
    const { ops, rejected } = resolvePlan(plan([
      { ref: 'n9', kind: 'style', property: 'color', value: 'red', breakpoint: 'base' },
      { ref: 'n1', kind: 'style', property: 'color', value: 'red; background: url(x)', breakpoint: 'base' },
      { ref: 'n0', kind: 'text', value: 'x', breakpoint: 'base' },
      { ref: 'n1', kind: 'style', property: 'behavior', value: 'x', breakpoint: 'base' },
      { ref: 'n1', kind: 'text', value: 'Hi there', breakpoint: 'base' },
    ]), ctx);
    expect(rejected).toHaveLength(4);
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toMatchObject({ type: 'text', value: 'Hi there', original: 'Hello' });
  });
});
