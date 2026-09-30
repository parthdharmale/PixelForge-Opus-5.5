/**
 * Visual verification loop for source patches.
 *
 *   baseline  – the unmodified app, freshly loaded
 *   expected  – the same page with the editor's live edits applied by the agent
 *   actual    – the app reloaded after the patch was written to disk
 *
 * actual ≈ expected  → the code change reproduces the visual edit
 * actual vs baseline → what changed (highlighted regions)
 * actual ≠ expected  → unexpected differences (shared classes, cascade
 *                      conflicts, build errors), with regions to inspect
 * Computed-style probes on every edited property complement the pixels.
 */
import fs from 'node:fs';
import path from 'node:path';
import { VERIFY_TOLERANCE, VIEWPORT_PRESETS, type EditState, type PropertyCheck, type VerificationReport, type VerifyViewport, type ViewportVerification } from '@pixelforge/core';
import { DATA_DIR } from '../config.ts';
import type { JobHandle } from '../jobs.ts';
import { load, openPage, viteError, type CapturePage } from './browser.ts';
import { diffImages } from './imageDiff.ts';

interface Probe {
  key: string;
  label: string;
  property: string;
  path: string;
  value: string;
}

type PF = {
  applyState(s: EditState): unknown;
  probe(s: EditState): Probe[];
  read(c: Array<{ path: string; property: string }>): Array<string | null>;
};

export const DEFAULT_VIEWPORTS: VerifyViewport[] = VIEWPORT_PRESETS.map((v) => ({ id: v.id, width: v.width, height: v.height }));

interface Before {
  viewport: VerifyViewport;
  baseline: Buffer;
  expected: Buffer;
  probes: Probe[];
}

async function settle(cp: CapturePage) {
  await cp.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function captureBefore(url: string, state: EditState, viewports: VerifyViewport[]): Promise<Before[]> {
  const out: Before[] = [];
  for (const viewport of viewports) {
    const cp = await openPage(viewport.width, viewport.height);
    try {
      await load(cp.page, url);
      const hasAgent = await cp.page.evaluate(() => !!(window as unknown as { __PIXELFORGE__?: unknown }).__PIXELFORGE__);
      if (!hasAgent) throw new Error('The PixelForge agent is not present on the page; is the dev server running with the PixelForge plugin?');
      const baseline = await cp.page.screenshot({ fullPage: true });
      await cp.page.evaluate((s) => (window as unknown as { __PIXELFORGE__: PF }).__PIXELFORGE__.applyState(s), state);
      await settle(cp);
      const expected = await cp.page.screenshot({ fullPage: true });
      const probes = await cp.page.evaluate((s) => (window as unknown as { __PIXELFORGE__: PF }).__PIXELFORGE__.probe(s), state);
      out.push({ viewport, baseline, expected, probes });
    } finally {
      await cp.context.close();
    }
  }
  return out;
}

export async function captureAfter(
  url: string,
  before: Before[],
  job: JobHandle<VerificationReport>,
): Promise<Array<{ viewport: VerifyViewport; actual: Buffer; values: Array<string | null>; errors: string[] }>> {
  const out = [];
  for (const b of before) {
    const cp = await openPage(b.viewport.width, b.viewport.height);
    try {
      let values: Array<string | null> = [];
      // The dev server may need a moment to pick up the written files.
      for (let attempt = 0; attempt < 5; attempt++) {
        await load(cp.page, url);
        const err = await viteError(cp.page);
        if (err) throw new Error(`The dev server reported a build error after applying the patch: ${err.split('\n')[0]}`);
        values = await cp.page.evaluate((c) => (window as unknown as { __PIXELFORGE__?: PF }).__PIXELFORGE__?.read(c) ?? [], b.probes.map((p) => ({ path: p.path, property: p.property })));
        if (b.probes.every((p, i) => values[i] === p.value)) break;
        job.note(`waiting for the dev server to rebuild (${b.viewport.id}, attempt ${attempt + 2})`);
        await new Promise((r) => setTimeout(r, 700));
      }
      await settle(cp);
      const actual = await cp.page.screenshot({ fullPage: true });
      out.push({ viewport: b.viewport, actual, values, errors: cp.errors });
    } finally {
      await cp.context.close();
    }
  }
  return out;
}

export function compare(jobId: string, patchId: string, before: Before[], after: Awaited<ReturnType<typeof captureAfter>>, startedAt: number): VerificationReport {
  const dir = path.join(DATA_DIR, 'jobs', jobId);
  fs.mkdirSync(dir, { recursive: true });
  const url = (f: string) => `/api/artifacts/${jobId}/${f}`;
  const viewports: ViewportVerification[] = [];
  const propertyChecks: PropertyCheck[] = [];
  const consoleErrors = new Set<string>();

  before.forEach((b, i) => {
    const a = after[i];
    const id = b.viewport.id;
    const vsExpected = diffImages(b.expected, a.actual);
    const vsBaseline = diffImages(b.baseline, a.actual);
    fs.writeFileSync(path.join(dir, `${id}-baseline.png`), b.baseline);
    fs.writeFileSync(path.join(dir, `${id}-expected.png`), b.expected);
    fs.writeFileSync(path.join(dir, `${id}-actual.png`), a.actual);
    fs.writeFileSync(path.join(dir, `${id}-diff-expected.png`), vsExpected.diffPng);
    fs.writeFileSync(path.join(dir, `${id}-diff-baseline.png`), vsBaseline.diffPng);
    b.probes.forEach((p, j) => {
      propertyChecks.push({ targetLabel: p.label, selector: p.path, property: p.property, breakpoint: 'base', viewport: id, expected: p.value, actual: a.values[j] ?? null, pass: a.values[j] === p.value });
    });
    a.errors.forEach((e) => consoleErrors.add(e));
    const status: ViewportVerification['status'] = vsExpected.ratio <= VERIFY_TOLERANCE ? 'passed' : vsExpected.ratio <= 0.01 ? 'warning' : 'failed';
    viewports.push({
      viewport: b.viewport,
      images: { baseline: url(`${id}-baseline.png`), expected: url(`${id}-expected.png`), actual: url(`${id}-actual.png`), diffExpected: url(`${id}-diff-expected.png`), diffBaseline: url(`${id}-diff-baseline.png`) },
      mismatchVsExpected: vsExpected.ratio,
      changedVsBaseline: vsBaseline.ratio,
      unexpectedRegions: vsExpected.regions,
      changedRegions: vsBaseline.regions,
      size: { width: vsExpected.width, height: vsExpected.height },
      status,
    });
  });

  const failedChecks = propertyChecks.filter((c) => !c.pass);
  const worst = viewports.some((v) => v.status === 'failed') || failedChecks.length ? 'failed' : viewports.some((v) => v.status === 'warning') ? 'warning' : 'passed';
  const nothingChanged = viewports.every((v) => v.changedVsBaseline === 0);
  const summary =
    worst === 'passed'
      ? nothingChanged
        ? 'Source matches the edit, but nothing changed visually (was the edit already in source?).'
        : `The patched source renders exactly like the visual edit at ${viewports.length} viewport${viewports.length > 1 ? 's' : ''}.`
      : worst === 'warning'
        ? 'The patched source is visually very close to the edit; small differences remain (see highlighted regions).'
        : failedChecks.length
          ? `${failedChecks.length} property check${failedChecks.length > 1 ? 's' : ''} failed: the source change does not produce the edited value everywhere.`
          : 'The patched source differs from the visual edit in unexpected places (see highlighted regions).';
  return { id: jobId, patchId, status: worst, summary, viewports, propertyChecks, consoleErrors: [...consoleErrors].slice(0, 20), durationMs: Date.now() - startedAt };
}
