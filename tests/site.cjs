// Optional static-site integration check; requires Playwright and Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const docs = path.resolve(__dirname, '../docs');
test('landing page separates both tools and works on mobile and desktop', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://mithatakbulut.github.io/noshorts/**', async route => {
      const suffix = new URL(route.request().url()).pathname.replace('/noshorts/', '') || 'index.html';
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };
      await route.fulfill({ contentType: types[path.extname(suffix)], body: await readFile(path.join(docs, suffix)) });
    });
    await page.goto('https://mithatakbulut.github.io/noshorts/');
    assert.match(await page.title(), /YouTube, on your terms/);
    await page.getByRole('heading', { name: 'Two tools. Use either. Or both.' }).waitFor();
    assert.match(await page.getByRole('link', { name: 'Get the Shorts blocker' }).getAttribute('href'), /\/noshorts.user.js$/);
    assert.match(await page.getByRole('link', { name: 'Get the time limiter' }).getAttribute('href'), /\/youtube-limit.user.js$/);
    assert.equal(await page.locator('img').evaluateAll(nodes => nodes.every(img => img.complete && img.naturalWidth > 0)), true);
    await page.getByRole('button', { name: 'Preview the NoShorts time drawer' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Preview the NoShorts time drawer' }).evaluate(node => node === document.activeElement), true);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { throw Error('denied'); } } }); });
    await page.getByRole('button', { name: 'Copy a setup prompt for ChatGPT' }).click();
    await page.getByText('Select and copy the prompt below.', { exact: true }).waitFor();
    assert.equal(await page.locator('.prompt-fallback').getAttribute('open'), '');
    await page.evaluate(() => { document.querySelector('.prompt-fallback').open = false; });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: '/tmp/noshorts-site-desktop.png', fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const badge = await page.locator('.timer').boundingBox(), player = await page.locator('.demo-player').boundingBox();
      assert.ok(badge.x >= player.x && badge.x + badge.width <= player.x + player.width);
      await page.getByRole('button', { name: 'Preview the NoShorts time drawer' }).click();
      const dialog = await page.getByRole('dialog').boundingBox();
      assert.ok(dialog.x >= 0 && dialog.width <= width);
      await page.getByRole('button', { name: 'Close widget preview' }).click();
      await page.getByText('Do I need both scripts?', { exact: true }).click();
      await page.getByText('No. The Shorts blocker removes Shorts.', { exact: false }).waitFor();
      await page.getByText('Do I need both scripts?', { exact: true }).click();
      if (width === 390) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: '/tmp/noshorts-site-mobile.png', fullPage: true }); }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
