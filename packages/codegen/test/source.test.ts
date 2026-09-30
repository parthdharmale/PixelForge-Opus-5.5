import { describe, expect, it } from 'vitest';
import { generateSourcePatch } from '@pixelforge/codegen';
import { DEMO_ROOT, locate, projectFrom, stateWith, style, target } from './helpers';

const project = projectFrom(DEMO_ROOT);

function patchFor(ops: Parameters<typeof stateWith>[0], opts = {}) {
  return generateSourcePatch(stateWith(ops), project, opts);
}

describe('CSS module strategy', () => {
  it('edits the owned module rule in place, merging into the padding shorthand', () => {
    const t = target(locate('src/components/FeatureCard.tsx', '<article'), 'article.card', 6);
    const res = patchFor([style(t, 'padding-top', '40px')]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-module', file: 'src/components/Features.module.css', status: 'mapped' });
    const css = res.files.find((f) => f.path.endsWith('Features.module.css'))!;
    expect(css.after).toContain('.card {\n  padding: 40px 28px 28px;');
    // Nothing else in the file changes.
    expect(css.diff.split('\n').filter((l) => /^[-+][^-+]/.test(l))).toHaveLength(2);
  });

  it('compresses four equal sides into one shorthand value', () => {
    const t = target(locate('src/components/FeatureCard.tsx', '<article'));
    const res = patchFor(['top', 'right', 'bottom', 'left'].map((s) => style(t, `padding-${s}`, '32px')));
    expect(res.files[0].after).toContain('  padding: 32px;');
  });

  it('adds breakpoint edits to the existing @media block', () => {
    const t = target(locate('src/components/Features.tsx', '<div className={styles.grid}'));
    const res = patchFor([style(t, 'column-gap', '12px', 'mobile'), style(t, 'row-gap', '12px', 'mobile')]);
    const css = res.files[0].after;
    expect(css).toMatch(/@media \(max-width: 767px\) \{\n  \.grid \{\n    grid-template-columns: 1fr;\n    gap: 12px;\n  \}/);
  });

  it('creates a tablet block before existing mobile overrides so the cascade stays correct', () => {
    const t = target(locate('src/components/Pricing.tsx', '<div className={styles.plans}'));
    const res = patchFor([style(t, 'column-gap', '16px', 'tablet')]);
    const css = res.files[0].after;
    expect(css).toContain('@media (max-width: 1023px) {\n  .plans {\n    flex-direction: column;\n    column-gap: 16px;');
  });

  it('prefers the module class over a global utility class on the same element', () => {
    const t = target(locate('src/components/Hero.tsx', '<div className={`container ${styles.inner}`}'));
    const res = patchFor([style(t, 'column-gap', '80px')]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-module', detail: '.inner' });
  });
});

describe('global CSS strategy', () => {
  it('edits a global rule owned by a single element', () => {
    const t = target(locate('src/components/Footer.tsx', '<div className="footer-grid">'));
    const res = patchFor([style(t, 'column-gap', '48px'), style(t, 'row-gap', '48px')]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-rule', file: 'src/styles/global.css' });
    expect(res.files[0].after).toContain('.footer-grid {\n  display: grid;\n  grid-template-columns: 2fr repeat(3, 1fr);\n  gap: 48px;');
  });

  it('does not modify a shared class (.section-title is used by several sections) by default', () => {
    const t = target(locate('src/components/Features.tsx', '<h2 className="section-title"'));
    const res = patchFor([style(t, 'color', '#ffffff')]);
    expect(res.mappings[0].strategy).toBe('tailwind');
    expect(res.mappings[0].status).toBe('warning');
    expect(res.mappings[0].message).toMatch(/shared by 4 elements/);
    const tsx = res.files.find((f) => f.path.endsWith('Features.tsx'))!;
    expect(tsx.after).toContain('<h2 className="section-title text-[#ffffff]"');
  });

  it('avoids Tailwind for a property the shared class declares (utilities would lose)', () => {
    const t = target(locate('src/components/Features.tsx', '<h2 className="section-title"'));
    const res = patchFor([style(t, 'letter-spacing', '-0.04em')]);
    expect(res.mappings[0].strategy).toBe('inline-style');
    expect(res.files[0].after).toContain(`<h2 className="section-title" style={{ letterSpacing: '-0.04em' }}>`);
  });

  it('edits the shared class when explicitly requested', () => {
    const t = target(locate('src/components/Features.tsx', '<h2 className="section-title"'));
    const res = patchFor([style(t, 'letter-spacing', '-0.04em')], { sharedClass: { [t.key]: true } });
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-rule', status: 'warning' });
    expect(res.files[0].after).toContain('letter-spacing: -0.04em;');
  });

  it('adds a scoped class after a shared rule so its @media overrides keep winning', () => {
    // .section is shared and has tablet/mobile padding overrides: an inline
    // style would break them, so a new class is inserted right after .section.
    const t = target(locate('src/components/Features.tsx', '<section className="section"'));
    const res = patchFor([style(t, 'padding-top', '120px')]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-rule', file: 'src/styles/global.css' });
    const css = res.files.find((f) => f.path.endsWith('global.css'))!.after;
    expect(css).toContain('.section {\n  padding: 96px 0;\n}\n\n.features-section {\n  padding-top: 120px;\n}\n\n.section-heading');
    const tsx = res.files.find((f) => f.path.endsWith('Features.tsx'))!.after;
    expect(tsx).toContain('<section className="section features-section" id="features">');
  });

  it('extends a variable className locally for breakpoint edits (shared Button component)', () => {
    const t = target(locate('src/components/Button.tsx', '<a className'), 'a.btn', 5);
    const res = patchFor([style(t, 'font-size', '16px', 'mobile')]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'css-rule', status: 'warning' });
    const tsx = res.files.find((f) => f.path.endsWith('Button.tsx'))!.after;
    expect(tsx).toContain('<a className={`${className} button-btn`} href={href}>');
    // The <button> branch keeps the untouched variable.
    expect(tsx).toContain('<button className={className}');
    const css = res.files.find((f) => f.path.endsWith('global.css'))!.after;
    expect(css).toMatch(/@media \(max-width: 767px\) \{[\s\S]*\.button-btn \{\n    font-size: 16px;/);
  });
});

describe('Tailwind strategy', () => {
  it('replaces conflicting utilities and keeps unrelated classes', () => {
    const t = target(locate('src/components/Testimonials.tsx', '<figure'), 'figure', 3);
    const res = patchFor(['top', 'right', 'bottom', 'left'].map((s) => style(t, `padding-${s}`, '32px')).concat(style(t, 'border-top-left-radius', '16px')));
    const tsx = res.files[0].after;
    expect(tsx).toContain('className="rounded-xl border border-white/10 bg-white/5 p-8 rounded-tl-2xl"');
  });

  it('uses max-* variants for breakpoint edits', () => {
    const t = target(locate('src/components/LogoCloud.tsx', '<ul'));
    const res = patchFor([style(t, 'column-gap', '24px', 'mobile')]);
    expect(res.files[0].after).toContain('gap-x-12 gap-y-4 max-md:gap-x-6"');
  });

  it('preserves the line-height implied by a named text size when changing only font-size', () => {
    const t = target(locate('src/components/LogoCloud.tsx', '<p className='));
    const res = patchFor([style(t, 'font-size', '15px')]);
    expect(res.files[0].after).toContain('className="text-center text-slate-400 text-[15px] leading-[calc(1.25/0.875)]"');
  });
});

describe('inline style strategy', () => {
  it('edits properties owned by an existing style object in place (inline beats classes)', () => {
    const t = target(locate('src/components/Hero.tsx', '<dl'));
    const res = patchFor([style(t, 'column-gap', '64px'), style(t, 'row-gap', '64px'), style(t, 'padding-top', '8px')]);
    expect(res.mappings.map((m) => m.strategy)).toEqual(['inline-style', 'css-module']);
    const tsx = res.files.find((f) => f.path.endsWith('Hero.tsx'))!.after;
    expect(tsx).toContain("style={{ display: 'flex', gap: 64, marginTop: 48 }}");
    // The remaining property goes to the element's module class.
    expect(res.files.find((f) => f.path.endsWith('Hero.module.css'))!.after).toContain('.stats {\n  padding-top: 8px;\n}');
  });

  it('uses !important (with a warning) for breakpoint edits of inline-styled properties', () => {
    const t = target(locate('src/components/Hero.tsx', '<dl'));
    const res = patchFor([style(t, 'margin-top', '24px', 'mobile')]);
    expect(res.mappings[0]).toMatchObject({ status: 'warning', detail: '!important' });
    expect(res.files[0].after).toMatch(/\.stats \{\n    margin-top: 24px !important;/);
  });

  it('adds inline styles to elements without classes', () => {
    const t = target(locate('src/components/Hero.tsx', '<span />'));
    const noTw = projectFrom(DEMO_ROOT, {}, false);
    const res = generateSourcePatch(stateWith([style(t, 'opacity', '0.5')]), noTw);
    expect(res.files[0].after).toContain("<span style={{ opacity: 0.5 }} />");
  });
});

describe('text mapping', () => {
  it('rewrites JSX text in place', () => {
    const t = target(locate('src/components/Hero.tsx', '<h1'));
    const res = patchFor([{ type: 'text', target: t, value: 'Ship edge functions faster', original: 'Deploy edge functions in seconds' }]);
    expect(res.files[0].after).toContain('<h1 className={styles.title}>Ship edge functions faster</h1>');
  });

  it('finds multi-line JSX text by normalised whitespace', () => {
    const t = target(locate('src/components/Hero.tsx', '<p className={styles.subtitle}'));
    const original = 'Nimbus runs your code on 300+ locations worldwide. Zero config, instant rollbacks and observability built in.';
    const res = patchFor([{ type: 'text', target: t, value: 'Run code everywhere.', original }]);
    expect(res.files[0].after).toMatch(/<p className=\{styles\.subtitle\}>\n\s+Run code everywhere\.\n\s+<\/p>/);
  });

  it('follows data-driven text back to the array literal', () => {
    const t = target(locate('src/components/FeatureCard.tsx', '<h3'), 'h3', 6);
    const res = patchFor([{ type: 'text', target: t, value: 'Deploys in 10s', original: 'Instant deploys' }]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'string-literal', file: 'src/data/content.ts' });
    expect(res.files[0].after).toContain("title: 'Deploys in 10s',");
  });

  it('follows children of a shared component to the call site', () => {
    const t = target(locate('src/components/Button.tsx', '<a className'), 'a.btn', 5);
    const res = patchFor([{ type: 'text', target: t, value: 'Start for free', original: 'Start building' }]);
    expect(res.mappings[0]).toMatchObject({ strategy: 'jsx-text', file: 'src/components/Hero.tsx' });
  });

  it('prefers a literal in the rendering file (footer links come from its own array)', () => {
    const t = target(locate('src/components/Footer.tsx', '<a href="#top">'), 'a', 12);
    const res = patchFor([{ type: 'text', target: t, value: 'Plans', original: 'Pricing' }]);
    expect(res.mappings[0]).toMatchObject({ status: 'mapped', file: 'src/components/Footer.tsx' });
  });

  it('refuses ambiguous text', () => {
    const t = target(locate('src/components/Navbar.tsx', '<a className={styles.link}'), 'a.link', 4);
    const res = patchFor([{ type: 'text', target: t, value: 'Price', original: 'Pricing' }]);
    expect(res.mappings[0].status).toBe('unmapped');
    expect(res.files).toHaveLength(0);
  });
});

describe('unmappable edits', () => {
  it('explains instance-only styles on repeated elements', () => {
    const src = locate('src/components/FeatureCard.tsx', '<article');
    const t = { ...target(src, 'article', 6), scope: 'instance' as const, key: 'sel:article:nth-of-type(2)' };
    const res = patchFor([style(t, 'opacity', '0.5')]);
    expect(res.mappings[0].status).toBe('unmapped');
    expect(res.mappings[0].message).toMatch(/6 instances/);
  });

  it('reports elements without source locations', () => {
    const t = { ...target({ file: 'x', line: 1, column: 0 }), src: null, scope: 'instance' as const, key: 'sel:div' };
    const res = patchFor([style(t, 'opacity', '0.5')]);
    expect(res.mappings[0].status).toBe('unmapped');
  });
});
