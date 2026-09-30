import { expect, type Page, type FrameLocator } from '@playwright/test';

export const API = 'http://localhost:4000/api';

export function frame(page: Page): FrameLocator {
  return page.frameLocator('[data-testid=page-frame]');
}

export async function openDemo(page: Page) {
  // Start from pristine demo sources.
  const res = await page.request.post(`${API}/projects`, { data: { demo: true } });
  const project = await res.json();
  await page.request.post(`${API}/projects/${project.id}/reset`);
  await page.goto('/');
  await page.getByTestId('open-demo').click();
  await expect(page.getByTestId('tree-row').first()).toBeVisible({ timeout: 60_000 });
  return project.id as string;
}

export async function openFixture(page: Page, path = 'plain-site/') {
  await page.goto('/');
  await page.getByTestId('url-input').fill(`http://localhost:4000/fixtures/${path}`);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tree-row').first()).toBeVisible({ timeout: 30_000 });
}

/** Click an element inside the page and wait until the inspector shows it. */
export async function select(page: Page, selector: string, label?: string | RegExp) {
  const prev = await page.evaluate(() => (window as any).__pf.store.getState().selectedId);
  await frame(page).locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await frame(page).locator(selector).first().click();
  await page.waitForFunction((p) => {
    const s = (window as any).__pf.store.getState();
    return s.selectedId && s.selectedId !== p && s.details?.nodeId === s.selectedId;
  }, prev);
  if (label) await expect(page.locator('.insp-title')).toContainText(label);
}

/** Select the parent of the current selection (↑) and wait for it. */
export async function selectParent(page: Page, times = 1) {
  for (let i = 0; i < times; i++) {
    const prev = await page.evaluate(() => (window as any).__pf.store.getState().selectedId);
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction((p) => {
      const s = (window as any).__pf.store.getState();
      return s.selectedId !== p && s.details?.nodeId === s.selectedId;
    }, prev);
  }
}

export async function computed(page: Page, selector: string, prop: string, index = 0): Promise<string> {
  return frame(page)
    .locator(selector)
    .nth(index)
    .evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

export async function setProp(page: Page, prop: string, value: string) {
  const input = page.getByTestId(`prop-${prop}`);
  await input.fill(value);
  await input.press('Enter');
}

export async function storeState<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(${fn})(window.__pf.store.getState())`) as Promise<T>;
}
