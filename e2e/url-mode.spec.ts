import { expect, test } from '@playwright/test';
import { computed, frame, openFixture, select, selectParent, setProp, storeState } from './helpers';

test.describe('URL mode (proxied public page)', () => {
  test('loads through the proxy with the cascade from the site stylesheet', async ({ page }) => {
    await openFixture(page);
    await expect(page.locator('.url-pill')).toContainText('localhost:4000/fixtures/plain-site/');
    await select(page, 'h1', 'h1');
    await page.getByTestId('tab-cascade').click();
    await expect(page.getByTestId('cascade')).toContainText('.hero h1');
    await expect(page.getByTestId('cascade')).toContainText('/fixtures/plain-site/styles.css');
    await page.getByRole('button', { name: 'Design', exact: true }).click();
    // Inherited colour is explained as such.
    const origin = await storeState<string>(page, 's => s.details.origins.color.kind + ":" + s.details.origins.color.inheritedFrom?.label');
    expect(origin).toBe('inherited:section.hero');
  });

  test('transformed and sticky elements are flagged; similar items are grouped', async ({ page }) => {
    await openFixture(page);
    await select(page, '.stamp', 'span.stamp');
    await expect(page.locator('.insp-head')).toContainText('transformed');
    await expect(page.locator('.ov-quad polygon')).toHaveCount(1);
    await select(page, '.bean h3');
    await expect(page.getByTestId('scope-all')).toHaveText('All 3 similar');
    await setProp(page, 'color', '#b45309');
    for (const i of [0, 1, 2]) await expect.poll(() => computed(page, '.bean h3', 'color', i)).toBe('rgb(180, 83, 9)');
  });

  test('edits, responsive edit, patch export and before/after compare', async ({ page }) => {
    await openFixture(page);
    await select(page, 'h1', 'h1');
    await page.getByTestId('text-content').fill('Coffee worth the wait');
    await page.getByTestId('text-content').press('Enter');
    await expect(frame(page).locator('h1')).toHaveText('Coffee worth the wait');

    await page.getByTestId('vp-mobile').click();
    await select(page, '.bean h3');
    await selectParent(page, 2);
    await expect(page.locator('.insp-title')).toContainText('div.bean-list');
    await page.getByTestId('bm-padding-top').fill('0');
    await setProp(page, 'row-gap', '32');
    await expect.poll(() => computed(page, '.bean-list', 'row-gap')).toBe('32px');
    await page.getByTestId('vp-desktop').click();
    await expect.poll(() => computed(page, '.bean-list', 'row-gap')).toBe('20px');

    await page.getByTestId('generate').click();
    const panel = page.getByTestId('code-panel');
    await expect(panel).toContainText('pixelforge-overrides.css');
    await expect(panel).toContainText('@media (max-width: 767px)');
    await expect(panel).toContainText('Coffee worth the wait');

    await page.getByTestId('compare-slider').click();
    await expect(page.getByTestId('original-frame')).toBeVisible();
    await expect(page.frameLocator('[data-testid=original-frame]').locator('h1')).toHaveText('Coffee worth slowing down for');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('original-frame')).toHaveCount(0);
  });

  test('navigates to other pages of the site', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Pages' }).click();
    await page.getByText('Our story').click();
    await expect(frame(page).locator('h1')).toHaveText('Our story');
    await expect(page.locator('.url-pill')).toContainText('about.html');
  });
});
