import { expect, test } from '@playwright/test';
import { computed, frame, openDemo, select, selectParent, storeState } from './helpers';

test.describe('canvas interaction', () => {
  test('resize handle drags produce a single undoable step', async ({ page }) => {
    await openDemo(page);
    await select(page, '.section-heading p', 'p.section-subtitle');
    const before = parseFloat(await computed(page, '.section-heading p', 'width'));
    const handle = page.getByTestId('handle-width');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 4 - i * 10, box.y + 4);
    await page.mouse.up();
    const after = parseFloat(await computed(page, '.section-heading p', 'width'));
    expect(after).toBeLessThan(before - 50);
    const labels = await storeState<string[]>(page, 's => s.history.past.map(t => t.label)');
    expect(labels).toEqual(['Resize · p.section-subtitle']);
    await page.keyboard.press('Control+z');
    await expect.poll(async () => parseFloat(await computed(page, '.section-heading p', 'width'))).toBeCloseTo(before, 0);
  });

  test('padding handle adjusts spacing on the canvas', async ({ page }) => {
    await openDemo(page);
    await select(page, 'article h3');
    await selectParent(page);
    await expect(page.locator('.insp-title')).toContainText('article.card');
    const handle = page.getByTestId('handle-padding-top');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    const pt = parseFloat(await computed(page, 'article', 'padding-top', 3));
    expect(pt).toBeGreaterThan(40);
  });

  test('interact mode opens a modal, which can then be inspected', async ({ page }) => {
    await openDemo(page);
    await page.getByTestId('tool-interact').click();
    await frame(page).getByRole('button', { name: 'Watch demo' }).click();
    await expect(frame(page).getByRole('dialog')).toBeVisible();
    await page.getByTestId('tool-select').click();
    await select(page, '[role=dialog] h3', 'h3.title');
    await selectParent(page, 3);
    await expect(page.locator('.insp-head')).toContainText('position: fixed');
  });

  test('elements inside a nested scroll container are clipped to it', async ({ page }) => {
    await openDemo(page);
    await frame(page).locator('#changelog').scrollIntoViewIfNeeded();
    await frame(page).locator('[class*=feed]').evaluate((el) => (el.scrollTop = 250));
    await select(page, 'article[class*=entry] >> nth=5 >> h3');
    await selectParent(page);
    await expect(page.locator('.insp-title')).toContainText('article.entry');
    const geo = await storeState<{ rect: { y: number; height: number }; clip: { y: number; height: number } | null }>(page, 's => s.selected');
    expect(geo.clip).not.toBeNull();
    expect(geo.clip!.height).toBeLessThanOrEqual(geo.rect.height);
    await expect(page.locator('.insp-head')).toContainText('Changelog');
  });

  test('keyboard shortcuts: viewports, escape, original toggle, help', async ({ page }) => {
    await openDemo(page);
    await select(page, 'h1', 'h1.title');
    await page.locator('body').click({ position: { x: 5, y: 500 } });
    await page.keyboard.press('3');
    await expect(page.getByTestId('vp-width')).toHaveValue('390');
    await page.keyboard.press('2');
    await expect(page.getByTestId('vp-width')).toHaveValue('834');
    await page.keyboard.press('1');
    await page.keyboard.press('\\');
    await expect(page.getByTestId('original-frame')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('original-frame')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.insp-title')).toHaveCount(0);
    await page.keyboard.press('?');
    await expect(page.getByText('Keyboard shortcuts')).toBeVisible();
  });
});
