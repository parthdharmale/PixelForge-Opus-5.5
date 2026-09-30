import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true, args: ['--font-render-hinting=none', '--disable-lcd-text'] }).catch((e) => {
      browserPromise = null;
      throw new Error(`Could not launch Chromium for verification: ${e.message}. Run "npx playwright install chromium".`);
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
  browserPromise = null;
}

/** Freeze motion so screenshots are deterministic. */
const STABILIZE_CSS = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}`;

export interface CapturePage {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

export async function openPage(width: number, height: number): Promise<CapturePage> {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { context, page, errors };
}

export async function load(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.addStyleTag({ content: STABILIZE_CSS });
  await page.evaluate(async () => {
    await document.fonts?.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForFunction(() => !!(window as unknown as { __PIXELFORGE__?: unknown }).__PIXELFORGE__, null, { timeout: 5000 }).catch(() => {});
}

export async function viteError(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const overlay = document.querySelector('vite-error-overlay') as (HTMLElement & { shadowRoot: ShadowRoot | null }) | null;
    if (!overlay) return null;
    return overlay.shadowRoot?.querySelector('.message')?.textContent ?? 'Vite reported a build error';
  });
}
