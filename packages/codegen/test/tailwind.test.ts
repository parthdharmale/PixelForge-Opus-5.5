import { describe, expect, it } from 'vitest';
import { applyToClassList, propsOfUtility, utilitiesFor } from '@pixelforge/codegen';

describe('Tailwind mapping', () => {
  it('prefers exact scale tokens and falls back to arbitrary values', () => {
    expect(utilitiesFor('padding', '16px')).toEqual(['p-4']);
    expect(utilitiesFor('padding', '8px 24px')).toEqual(['py-2', 'px-6']);
    expect(utilitiesFor('padding-top', '13px')).toEqual(['pt-[13px]']);
    expect(utilitiesFor('margin-top', '-8px')).toEqual(['-mt-2']);
    expect(utilitiesFor('margin', '0 auto')).toEqual(['my-0', 'mx-auto']);
    expect(utilitiesFor('font-weight', '600')).toEqual(['font-semibold']);
    expect(utilitiesFor('border-radius', '12px')).toEqual(['rounded-xl']);
    expect(utilitiesFor('color', 'rgb(1, 2, 3)')).toEqual(['text-[rgb(1,2,3)]']);
    expect(utilitiesFor('grid-template-columns', 'repeat(3, minmax(0, 1fr))')).toEqual(['grid-cols-3']);
    expect(utilitiesFor('display', 'none')).toEqual(['hidden']);
    expect(utilitiesFor('box-shadow', '0 1px 2px #000')).toEqual(['[box-shadow:0_1px_2px_#000]']);
  });

  it('knows which properties existing utilities control', () => {
    expect(propsOfUtility('px-4')).toEqual(['padding-left', 'padding-right']);
    expect(propsOfUtility('text-center')).toEqual(['text-align']);
    expect(propsOfUtility('text-slate-400')).toEqual(['color']);
    expect(propsOfUtility('text-[15px]')).toEqual(['font-size']);
    expect(propsOfUtility('rounded-t-lg')).toEqual(['border-top-left-radius', 'border-top-right-radius']);
    expect(propsOfUtility('border')).toHaveLength(4);
    expect(propsOfUtility('container')).toEqual([]);
  });

  it('replaces only superseded utilities of the same variant', () => {
    const res = applyToClassList(['card', 'p-4', 'md:p-6', 'text-sm', 'font-bold'], { 'padding-top': '32px', 'padding-right': '32px', 'padding-bottom': '32px', 'padding-left': '32px' }, 'base');
    expect(res.classes).toEqual(['card', 'md:p-6', 'text-sm', 'font-bold', 'p-8']);
    expect(res.removed).toEqual(['p-4']);
  });

  it('keeps shorthand utilities when a single side changes (longhand wins by ordering)', () => {
    const res = applyToClassList(['p-4'], { 'padding-top': '0px' }, 'base');
    expect(res.classes).toEqual(['p-4', 'pt-0']);
  });

  it('writes breakpoint edits as max-* variants', () => {
    const res = applyToClassList(['flex', 'max-lg:flex-col'], { 'flex-direction': 'row' }, 'tablet');
    expect(res.classes).toEqual(['flex', 'max-lg:flex-row']);
  });
});
