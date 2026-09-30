import { describe, expect, it } from 'vitest';
import { instrumentSource } from '@pixelforge/vite-plugin';

describe('instrumentSource', () => {
  it('annotates host elements with their source location', () => {
    const code = `export function Card({ title }: { title: string }) {\n  return (\n    <article className="card">\n      <h3>{title}</h3>\n      <Button />\n    </article>\n  );\n}\n`;
    const res = instrumentSource(code, 'src/Card.tsx')!;
    expect(res.count).toBe(2);
    expect(res.code).toContain('<article data-pf-src="src/Card.tsx:3:4" className="card">');
    expect(res.code).toContain('<h3 data-pf-src="src/Card.tsx:4:6">');
    // Components are not annotated (props may not reach the DOM).
    expect(res.code).toContain('<Button />');
  });

  it('preserves everything else byte-for-byte', () => {
    const code = `const x = <div>hi</div>; // comment\nconst y = 1 < 2;\n`;
    const res = instrumentSource(code, 'a.tsx')!;
    expect(res.code.replace(/ data-pf-src="[^"]+"/g, '')).toBe(code);
  });

  it('skips files without JSX and elements already annotated', () => {
    expect(instrumentSource('export const a = 1;', 'a.ts')).toBeNull();
    expect(instrumentSource('const a = <div data-pf-src="x:1:1" />;', 'a.tsx')).toBeNull();
  });

  it('handles TypeScript generics and fragments', () => {
    const code = `function f<T,>(x: T) { return <><span>{String(x)}</span></>; }`;
    const res = instrumentSource(code, 'g.tsx')!;
    expect(res.count).toBe(1);
  });
});
