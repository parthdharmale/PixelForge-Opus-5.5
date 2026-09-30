import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { generateUrlPatch } from '@pixelforge/codegen';
import { applyChange, emptyState, makeTarget, toChange, type EditOp } from '@pixelforge/core';
import { rewriteCss, rewriteHtml, validateTargetUrl } from '../src/proxy';
import { diffImages } from '../src/verify/imageDiff';

describe('proxy rewriting', () => {
  const origin = 'https://shop.example.com';

  it('injects the agent first and strips CSP and SRI', () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"><link rel="stylesheet" href="/a.css" integrity="sha384-x"><script src="https://shop.example.com/app.js"></script></head><body><a href="https://shop.example.com/cart">Cart</a><a href="https://other.com/x">X</a></body></html>`;
    const out = rewriteHtml(html, origin);
    expect(out).toMatch(/^<html><head><script src="\/__pf\/agent.js"/);
    expect(out).not.toContain('Content-Security-Policy');
    expect(out).not.toContain('integrity');
    expect(out).toContain('<script src="/app.js">');
    expect(out).toContain('href="/cart"');
    expect(out).toContain('href="https://other.com/x"');
  });

  it('routes cross-origin stylesheets through the asset endpoint (for CSSOM access)', () => {
    const out = rewriteHtml('<head><link rel="stylesheet" href="https://cdn.example.net/site.css"></head>', origin);
    expect(out).toContain('href="/__pf/asset?url=https%3A%2F%2Fcdn.example.net%2Fsite.css"');
  });

  it('rewrites CSS urls relative to the stylesheet', () => {
    const css = rewriteCss('a{background:url(../img/a.png)} b{background:url("https://cdn.x/y.png")} c{background:url(data:image/png;base64,AA)}', origin, `${origin}/css/site.css`);
    expect(css).toContain('url(/img/a.png)');
    expect(css).toContain('url("https://cdn.x/y.png")');
    expect(css).toContain('url(data:image/png;base64,AA)');
  });

  it('validates URLs', () => {
    expect(validateTargetUrl('example.com').href).toBe('https://example.com/');
    expect(() => validateTargetUrl('javascript:alert(1)')).toThrow();
  });
});

function png(width: number, height: number, paint?: (x: number, y: number) => [number, number, number] | null): Buffer {
  const img = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const c = paint?.(x, y) ?? [255, 255, 255];
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  return PNG.sync.write(img);
}

describe('image diff', () => {
  it('reports zero difference for identical renders', () => {
    const a = png(64, 64);
    expect(diffImages(a, a).ratio).toBe(0);
  });

  it('locates the changed region', () => {
    const a = png(200, 200);
    const b = png(200, 200, (x, y) => (x >= 100 && x < 140 && y >= 20 && y < 50 ? [0, 0, 0] : null));
    const d = diffImages(a, b);
    expect(d.mismatched).toBe(40 * 30);
    expect(d.regions).toHaveLength(1);
    const r = d.regions[0];
    expect(r.x).toBeLessThanOrEqual(100);
    expect(r.x + r.width).toBeGreaterThanOrEqual(140);
    expect(r.y).toBeLessThanOrEqual(20);
  });

  it('handles pages whose height changed', () => {
    const d = diffImages(png(50, 50), png(50, 80));
    expect(d.height).toBe(80);
    expect(d.ratio).toBeGreaterThan(0);
  });
});

describe('URL-mode patch', () => {
  const t = makeTarget({ scope: 'instance', selector: 'main > h1', src: null, label: 'h1', component: null, instanceCount: 1 });
  const ops: EditOp[] = [
    { type: 'style', target: t, breakpoint: 'base', property: 'color', value: '#b45309' },
    { type: 'style', target: t, breakpoint: 'mobile', property: 'font-size', value: '28px' },
    { type: 'text', target: t, value: 'Fresh & local', original: "Today's beans" },
  ];
  const state = ops.reduce((s, op) => applyChange(s, toChange(s, op)), emptyState());
  const html = `<html>\n  <head>\n    <title>x</title>\n  </head>\n  <body><main><h1>\n  Today&#39;s beans\n</h1></main></body>\n</html>\n`;

  it('exports an overrides stylesheet and patches text and the stylesheet link into the HTML', () => {
    const res = generateUrlPatch(state, html, 'https://x.test/');
    const css = res.files.find((f) => f.path === 'pixelforge-overrides.css')!.after;
    expect(css).toContain('main > h1 {\n  color: #b45309;\n}');
    expect(css).toContain('@media (max-width: 767px) {\n  main > h1 {\n    font-size: 28px;');
    expect(css).not.toContain('!important');
    const page = res.files.find((f) => f.path === 'index.html')!;
    expect(page.after).toContain('Fresh &amp; local');
    expect(page.after).toContain('<link rel="stylesheet" href="pixelforge-overrides.css">');
    expect(page.diff).toContain('+    <link rel="stylesheet" href="pixelforge-overrides.css">\n   </head>');
    expect(res.mappings.every((m) => m.status === 'mapped')).toBe(true);
  });

  it('flags text that only exists after JavaScript runs', () => {
    const res = generateUrlPatch(state, '<html><body><div id="app"></div></body></html>', 'https://x.test/');
    expect(res.mappings.find((m) => m.properties[0] === 'text')?.status).toBe('unmapped');
  });
});
