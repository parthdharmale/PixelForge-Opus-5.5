/**
 * URL-mode code generation. Without access to the site's source we emit
 * a self-contained overrides stylesheet (selectors recorded by the
 * editor, breakpoints as media queries) plus a patch of the fetched HTML
 * that links it and applies text changes in place.
 */
import { createTwoFilesPatch } from 'diff';
import { compileEditCss, type ChangeMapping, type EditState, type FilePatch } from '@pixelforge/core';

export interface UrlPatch {
  files: FilePatch[];
  mappings: ChangeMapping[];
  warnings: string[];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex matching `text` as it may appear between tags (flexible whitespace, entities). */
function textPattern(text: string): RegExp {
  const words = text.trim().split(/\s+/).map((w) => escapeRegex(escapeHtml(w)).replace(/'/g, "(?:'|&#39;|&apos;|&#x27;)").replace(/"/g, '(?:"|&quot;)'));
  return new RegExp(`(>\\s*)${words.join('\\s+')}(\\s*<)`, 'g');
}

export function generateUrlPatch(state: EditState, html: string, pageUrl: string): UrlPatch {
  const mappings: ChangeMapping[] = [];
  const warnings: string[] = [];
  const css = compileEditCss(state, { important: false });
  let after = html;

  for (const [key, t] of Object.entries(state.text)) {
    const target = state.targets[key];
    const re = textPattern(t.original);
    const matches = html.match(re) ?? [];
    const base = { targetKey: key, label: target?.label ?? key, properties: ['text'] };
    if (matches.length === 1) {
      after = after.replace(re, (_m, pre: string, post: string) => `${pre}${escapeHtml(t.value)}${post}`);
      mappings.push({ ...base, strategy: 'html-text', file: 'index.html', detail: `"${t.original.slice(0, 40)}"`, status: 'mapped' });
    } else {
      mappings.push({
        ...base,
        strategy: null,
        file: 'index.html',
        detail: 'text not found in served HTML',
        status: 'unmapped',
        message: matches.length ? `Text occurs ${matches.length} times in the HTML; not changed.` : 'Text is not present in the server-rendered HTML (probably rendered by JavaScript).',
      });
    }
  }
  for (const [key, perBp] of Object.entries(state.styles)) {
    const target = state.targets[key];
    const props = Object.entries(perBp).flatMap(([bp, m]) => Object.keys(m ?? {}).map((p) => (bp === 'base' ? p : `${p} @${bp}`)));
    mappings.push({ targetKey: key, label: target?.label ?? key, properties: props, strategy: 'override-css', file: 'pixelforge-overrides.css', detail: target?.selector ?? key, status: 'mapped' });
  }

  const files: FilePatch[] = [];
  if (css) {
    const sheet = `/* PixelForge overrides for ${pageUrl}\n * Generated from visual edits. Selectors were recorded from the live DOM;\n * move these rules into the site's own stylesheets where possible. */\n\n${css}\n`;
    files.push({ path: 'pixelforge-overrides.css', before: '', after: sheet, diff: createTwoFilesPatch('/dev/null', 'b/pixelforge-overrides.css', '', sheet).replace(/^=+\n/m, ''), created: true });
    const link = '<link rel="stylesheet" href="pixelforge-overrides.css">';
    const own = /^([ \t]*)<\/head>/im.exec(after);
    if (own) after = after.replace(/^([ \t]*)<\/head>/im, `${own[1]}  ${link}\n${own[1]}</head>`);
    else if (/<\/head>/i.test(after)) after = after.replace(/<\/head>/i, `${link}</head>`);
    else after = `${link}\n${after}`;
  }
  if (after !== html) files.unshift({ path: 'index.html', before: html, after, diff: createTwoFilesPatch('a/index.html', 'b/index.html', html, after).replace(/^=+\n/m, ''), created: false });
  for (const m of mappings) if (m.status !== 'mapped' && m.message) warnings.push(`${m.label}: ${m.message}`);
  return { files, mappings, warnings };
}
