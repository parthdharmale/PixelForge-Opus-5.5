import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { API, computed, frame, openDemo, select, selectParent, setProp, storeState } from './helpers';

const WORK = path.resolve(process.cwd(), '.pixelforge-work/demo');

test.describe('source project mode (demo)', () => {
  test('inspect: source locations, components, cascade and inheritance', async ({ page }) => {
    await openDemo(page);
    await expect(page.locator('.frame-label')).toContainText('source mapped');
    // Hover shows the DevTools-style overlay with tag and dimensions.
    await frame(page).locator('h1').hover();
    await expect(page.locator('.ov-tag.hover')).toContainText('h1.title');
    await select(page, 'h1', 'h1.title');
    await expect(page.getByTestId('src-loc')).toHaveText('src/components/Hero.tsx:14:10');
    await expect(page.locator('.insp-head')).toContainText('Hero');
    await page.getByTestId('tab-cascade').click();
    const cascade = page.getByTestId('cascade');
    await expect(cascade).toContainText('.title');
    await expect(cascade).toContainText('src/components/Hero.module.css');
    await expect(cascade).toContainText('Inherited from');
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    // Repeated component: 6 feature cards rendered from one JSX element.
    await select(page, 'article h3');
    await selectParent(page);
    await expect(page.locator('.insp-title')).toContainText('article.card');
    await expect(page.getByTestId('scope-all')).toHaveText('All 6 instances');
  });

  test('edit, undo/redo and breakpoint-scoped edits', async ({ page }) => {
    await openDemo(page);
    await select(page, 'h1', 'h1.title');
    await setProp(page, 'font-size', '64');
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('64px');

    // Editing one card's padding updates every instance.
    await select(page, 'article h3');
    await selectParent(page);
    await expect(page.locator('.insp-title')).toContainText('article.card');
    await page.getByTestId('bm-padding-top').fill('44');
    await page.getByTestId('bm-padding-top').press('Enter');
    await expect.poll(() => computed(page, 'article', 'padding-top', 5)).toBe('44px');

    await page.getByTestId('undo').click();
    await expect.poll(() => computed(page, 'article', 'padding-top', 5)).toBe('28px');
    await page.getByTestId('redo').click();
    await expect.poll(() => computed(page, 'article', 'padding-top', 5)).toBe('44px');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('56px');
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('64px');

    // Mobile edit does not affect desktop; the desktop edit does not break mobile.
    await page.getByTestId('vp-mobile').click();
    await expect(page.getByTestId('edit-breakpoint')).toHaveValue('mobile');
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('36px');
    await select(page, 'h1', 'h1.title');
    await setProp(page, 'font-size', '30');
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('30px');
    await page.getByTestId('vp-desktop').click();
    await expect.poll(() => computed(page, 'h1', 'font-size')).toBe('64px');

    await page.getByTestId('btab-changes').click();
    await expect(page.getByTestId('change-item')).toHaveCount(1);
    await expect(page.getByTestId('change-item')).toContainText('mobile');
  });

  test('AI command → preview → apply → one undo step', async ({ page }) => {
    await openDemo(page);
    await select(page, 'article h3');
    await selectParent(page, 2);
    await expect(page.locator('.insp-title')).toContainText('div.grid');
    await page.keyboard.press('Control+k');
    await page.getByTestId('ai-input').fill('Turn these cards into a responsive grid');
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('ai-plan')).toBeVisible();
    await expect(page.getByTestId('ai-op').first()).toContainText('grid-template-columns');
    // The proposal is previewed on the canvas before applying.
    await expect.poll(() => frame(page).locator('article').first().evaluate((el) => getComputedStyle(el.parentElement!).gridTemplateColumns.split(' ').length)).toBe(4);
    await page.getByTestId('ai-apply').click();
    const hist = await storeState<string[]>(page, 's => s.history.past.map(t => t.source + ":" + t.label)');
    expect(hist).toEqual(['ai:AI: Turn these cards into a responsive grid']);
    await page.keyboard.press('Control+z');
    await expect.poll(() => frame(page).locator('article').first().evaluate((el) => getComputedStyle(el.parentElement!).gridTemplateColumns.split(' ').length)).toBe(3);

    // Reject leaves the page untouched.
    await page.keyboard.press('Control+k');
    await page.getByTestId('ai-input').fill('Make this section more premium');
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('ai-plan')).toBeVisible();
    await page.getByTestId('ai-reject').click();
    expect(await storeState<number>(page, 's => s.history.past.length')).toBe(0);
  });

  test('generate patch, apply, reload and verify visually; revert restores files', async ({ page }) => {
    const id = await openDemo(page);
    const heroCss = path.join(WORK, 'src/components/Hero.module.css');
    const original = fs.readFileSync(heroCss, 'utf8');

    await select(page, 'h1', 'h1.title');
    await setProp(page, 'font-size', '60');
    await page.getByTestId('text-content').fill('Ship edge functions faster');
    await page.getByTestId('text-content').press('Enter');
    await select(page, 'article h3');
    await selectParent(page);
    await setProp(page, 'border-radius', '20px');

    await page.getByTestId('generate').click();
    await expect(page.getByTestId('code-panel')).toBeVisible();
    await expect(page.getByTestId('mapping')).toHaveCount(3);
    await expect(page.getByTestId('code-panel')).toContainText('src/components/Hero.module.css');
    await expect(page.getByTestId('code-panel')).toContainText('+  font-size: 60px;');
    await expect(page.getByTestId('code-panel')).toContainText('border-radius: 20px;');

    await page.getByTestId('apply-verify').click();
    await expect(page.getByTestId('verify-summary')).toContainText('Verified', { timeout: 90_000 });
    await expect(page.getByTestId('verify-viewport')).toHaveCount(3);
    expect(fs.readFileSync(heroCss, 'utf8')).toContain('font-size: 60px;');
    // The app reloaded from the patched source; edits are now baseline.
    await expect.poll(() => frame(page).locator('h1').textContent()).toBe('Ship edge functions faster');
    expect(await storeState<number>(page, 's => s.history.past.length')).toBe(0);

    await page.getByTestId('revert-patch').click();
    await expect.poll(() => fs.readFileSync(heroCss, 'utf8')).toBe(original);
    // Edits come back so no work is lost.
    expect(await storeState<number>(page, 's => s.history.past.length')).toBeGreaterThan(0);
    await page.request.post(`${API}/projects/${id}/reset`);
  });

  test('verification detects unexpected differences from editing a shared class', async ({ page }) => {
    const id = await openDemo(page);
    // The <a> Button renders from Button.tsx; its .btn class is shared with <button> Buttons.
    await select(page, 'a.btn-primary', 'a.btn');
    await setProp(page, 'font-size', '18px');
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('mapping')).toHaveCount(1);
    // Default is safe: inline style on this JSX element. Opt in to the shared class.
    await expect(page.getByTestId('mapping')).toContainText('inline-style');
    await page.getByText('Edit the shared class instead').click();
    await expect(page.getByTestId('mapping')).toContainText('css-rule');
    await page.getByTestId('apply-verify').click();
    await expect(page.getByTestId('verify-summary')).toContainText('Differences found', { timeout: 90_000 });
    await page.request.post(`${API}/projects/${id}/reset`);
  });
});
