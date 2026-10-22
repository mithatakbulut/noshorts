// Optional browser integration suite: requires Playwright and Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const script = path.resolve(__dirname, '../youtube-limit.user.js');

test('Shadow DOM onboarding, SPA rebinding, tracking, persistent blocking, and mobile drawer', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const storage = new Map(), errors = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('storageRead', k => storage.get(k));
    await page.exposeFunction('storageKeys', () => [...storage.keys()]);
    await page.exposeFunction('storageWrite', (k, v) => { storage.set(k, v); });
    await page.addInitScript(() => {
      window.GM = { getValue: window.storageRead, setValue: window.storageWrite, listValues: window.storageKeys };
      window.metrics = { timers: [], observers: 0 };
      window.setInterval = callback => { metrics.timers.push(callback); return metrics.timers.length; };
      const NativeObserver = window.MutationObserver;
      window.MutationObserver = class extends NativeObserver { constructor(fn) { super(fn); metrics.observers++; } };
      let now = new Date('2026-10-22T12:00:00').getTime(), mono = 0;
      const NativeDate = Date;
      window.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
      Object.defineProperty(performance, 'now', { value: () => mono });
      window.advance = ms => { now += ms; mono += ms; };
    });
    await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>A useful video - YouTube</title><header style="height:64px">YouTube search</header><div id="player" style="height:220px"><video class="html5-main-video" style="width:100%;height:220px"></video></div><h1 class="title">A useful video</h1><p>Comments remain available</p>' }));
    await page.route('https://i.ytimg.com/**', route => route.abort());
    await page.addInitScript({ path: script });
    await page.goto('https://www.youtube.com/watch?v=abcdefghijk');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Make room for what matters/);
    assert.equal(await page.locator('#noshorts-time').count(), 1);
    await page.getByLabel('Your daily budget').selectOption('custom');
    await page.getByLabel('Minutes (5–240)').fill('5');
    await page.getByRole('button', { name: 'Set my daily budget' }).click();
    await page.getByRole('heading', { name: 'Your YouTube time' }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => {
      const v = document.querySelector('video');
      Object.defineProperties(v, { paused: { configurable: true, writable: true, value: false }, readyState: { configurable: true, value: 4 }, currentTime: { configurable: true, writable: true, value: 0 } });
      v.pause = () => { v.paused = true; v.dispatchEvent(new Event('pause')); };
      v.dispatchEvent(new Event('playing'));
    });
    await page.waitForFunction(() => true); // let the asynchronous storage bridge finish
    // Wait for the first playback lock to persist before advancing the fake clock.
    await poll(() => [...storage.values()].some(v => v.kind === 'start'));
    await page.evaluate(() => {
      advance(1000); document.querySelector('video').currentTime = 2;
      document.querySelector('video').dispatchEvent(new Event('timeupdate'));
    });
    await poll(() => [...storage.values()].some(v => v.kind === 'usage' && v.ms === 1000));
    await page.getByRole('button', { name: 'Open NoShorts watch time details' }).click();
    await page.getByLabel('Daily budget', { exact: true }).selectOption('120');
    await page.getByRole('button', { name: 'Save daily budget' }).click();
    await page.getByText("Your new 2-hour limit starts tomorrow. Today's 5-minute limit stays unchanged.").waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const observerCount = await page.evaluate(() => metrics.observers);
    await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        history.pushState({}, '', `/watch?v=abcdefghijk&t=${i}`);
        document.dispatchEvent(new Event('yt-navigate-finish'));
      }
    });
    assert.deepEqual(await page.evaluate(() => ({ timers: metrics.timers.length, observers: metrics.observers, hosts: document.querySelectorAll('#noshorts-time').length })), { timers: 1, observers: observerCount, hosts: 1 });
    // Another tab can consume the shared budget. The periodic sync must enforce it.
    for (let i = 0; i < 5; i++) storage.set(`noshorts:v1:usage:other-tab:${i}`, { kind: 'usage', day: '2026-10-22', ms: 59800, at: Date.now(), video: { id: `history000${i}`, title: `History video ${i}`, channel: '' } });
    storage.set('noshorts:v1:usage:yesterday', { kind: 'usage', day: '2026-10-21', ms: 120000, at: Date.now(), video: { id: 'abcdefghijk', title: 'Yesterday video', channel: '' } });
    await page.evaluate(() => metrics.timers[0]());
    await page.getByRole('heading', { name: "That's enough YouTube for today." }).waitFor();
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true);
    await page.reload();
    await page.getByRole('heading', { name: "That's enough YouTube for today." }).waitFor();
    await page.getByRole('button', { name: 'Open viewing history' }).click();
    assert.match(await dialog.innerText(), /5m 0s watched today/);
    assert.match(await dialog.innerText(), /Tomorrow's scheduled limit: 120 min/);
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    assert.equal(await page.getByRole('link', { name: /A useful video/ }).count(), 1);
    const list = page.getByRole('region', { name: 'Watched today videos', exact: true });
    const listMetrics = await list.evaluate(node => ({ height: node.clientHeight, total: node.scrollHeight, row: node.querySelector('.video').getBoundingClientRect().height }));
    assert.equal(listMetrics.height / listMetrics.row, 3.5);
    assert.ok(listMetrics.total > listMetrics.height);
    await list.evaluate(node => { node.scrollTop = 100; });
    await page.evaluate(() => { advance(61000); metrics.timers[0](); });
    await page.getByText('Renews in 11h 59m', { exact: true }).waitFor();
    assert.equal(await list.evaluate(node => node.scrollTop), 100);
    assert.equal(await page.locator('#chart circle').count(), 7);
    assert.match(await page.getByRole('img', { name: /^Daily watch time/ }).getAttribute('aria-label'), /2026-10-21: 2m 0s/);
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    assert.equal(await page.locator('#chart circle').count(), 30);
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    const indicatorStyle = await page.locator('#indicator').evaluate(node => ({ opacity: Number(getComputedStyle(node).opacity), top: parseFloat(getComputedStyle(node).top), right: parseFloat(getComputedStyle(node).right) }));
    assert.ok(indicatorStyle.opacity <= 0.65);
    const videoBox = await page.locator('video').boundingBox();
    assert.equal(indicatorStyle.top, videoBox.y + 12);
    assert.equal(indicatorStyle.right, 390 - videoBox.x - videoBox.width + 12);
    await page.evaluate(() => { document.querySelector('#player').style.transform = 'translateY(-400px)'; dispatchEvent(new Event('scroll')); });
    assert.equal(await page.locator('#indicator').isHidden(), true);
    await page.evaluate(() => { document.querySelector('#player').style.transform = ''; dispatchEvent(new Event('scroll')); });
    assert.equal(await page.locator('#indicator').isVisible(), true);
    // Mobile sheet stays inside the viewport. Desktop uses a full-height side drawer.
    const mobile = await dialog.boundingBox(); assert.ok(mobile.width <= 390 && mobile.y >= 0);
    await dialog.evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: process.env.NOSHORTS_SCREENSHOT || '/tmp/noshorts-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    const desktop = await dialog.boundingBox(); assert.equal(Math.round(desktop.width), 420);
    await page.evaluate(() => { const player = document.querySelector('#player'); player.style.width = '720px'; player.style.marginLeft = '140px'; dispatchEvent(new Event('resize')); });
    const desktopVideo = await page.locator('video').boundingBox();
    const badge = await page.locator('#indicator').boundingBox();
    assert.equal(Math.round(badge.x + badge.width), Math.round(desktopVideo.x + desktopVideo.width - 12));
    assert.equal(Math.round(badge.y), Math.round(desktopVideo.y + 12));
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    await context.close();
  } finally { await browser.close(); }
});
async function poll(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for stored playback state');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
