import { expect, test } from '@playwright/test';
import { API, openDemo, select, selectParent } from './helpers';

/**
 * The prompts from the brief, run end to end against the demo: AI plan →
 * apply → generate code → write files → reload → visual verification.
 * Every scenario must produce source changes that render exactly like the
 * previewed edit at desktop, tablet and mobile widths.
 */
const cases: Array<{ name: string; pick: string; up: number; prompt: string; vp?: 'mobile' }> = [
  { name: 'premium hero', pick: 'h1', up: 3, prompt: 'Make this hero more premium' },
  { name: 'developer tool section', pick: '#features h2', up: 3, prompt: 'Make this section feel like a modern developer tool' },
  { name: 'reduce clutter', pick: '#pricing h2', up: 3, prompt: 'Reduce the visual clutter' },
  { name: 'responsive grid', pick: 'article h3', up: 2, prompt: 'Turn these cards into a responsive grid' },
  { name: 'hierarchy', pick: 'h1', up: 1, prompt: 'Improve the hierarchy without changing the content' },
  { name: 'mobile navigation', pick: 'header nav a', up: 1, prompt: 'Make this navigation work better on mobile', vp: 'mobile' },
];

for (const c of cases) {
  test(`AI scenario: ${c.name}`, async ({ page }) => {
    const id = await openDemo(page);
    if (c.vp) await page.getByTestId(`vp-${c.vp}`).click();
    await select(page, c.pick);
    await selectParent(page, c.up);
    await page.keyboard.press('Control+k');
    await page.getByTestId('ai-input').fill(c.prompt);
    await page.getByTestId('ai-input').press('Enter');
    await expect(page.getByTestId('ai-plan')).toBeVisible();
    expect(await page.getByTestId('ai-op').count()).toBeGreaterThan(0);
    await page.getByTestId('ai-apply').click();
    await page.getByTestId('generate').click();
    await expect(page.getByTestId('mapping').first()).toBeVisible();
    await expect(page.locator('[data-testid=mapping] .status-dot.unmapped')).toHaveCount(0);
    await page.getByTestId('apply-verify').click();
    await expect(page.getByTestId('verify-summary')).toContainText('Verified', { timeout: 90_000 });
    await page.request.post(`${API}/projects/${id}/reset`);
  });
}
