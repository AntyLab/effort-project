// Records a full scroll of each world's story at phone size, for reviewing motion.
// Usage: node test/record.mjs [baseURL] [world ...]   -> shots/scroll-<world>.webm
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args.find(a => a.startsWith('http')) ?? 'http://localhost:5180/';
const worlds = args.filter(a => !a.startsWith('http'));
const out = new URL('../shots/', import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const world of worlds.length ? worlds : ['claude', 'openai', 'gemini']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, recordVideo: { dir: out, size: { width: 390, height: 844 } } });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(`${base}#${world}-models`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__story?.ready, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const stops = await page.evaluate(() => window.__story.stops.length);
  // Wheel through the story like a visitor and pause whenever the caption changes, so each stop's loop is visible.
  await page.mouse.move(195, 300);
  const state = () => page.evaluate(() => ({ cap: document.querySelector('.cap-top')?.innerText ?? '', end: scrollY + innerHeight >= document.querySelector('#journey').getBoundingClientRect().bottom + scrollY - 4 }));
  let last = (await state()).cap;
  for (let guard = 0; guard < 1500; guard++) {
    await page.mouse.wheel(0, 70); await page.waitForTimeout(40);
    const now = await state();
    if (now.cap !== last) { last = now.cap; await page.waitForTimeout(1300); }
    if (now.end) break;
  }
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  fs.renameSync(await video.path(), `${out}scroll-${world}.webm`);
  console.log(`recorded scroll-${world}.webm (${stops} stops)`);
}
await browser.close();
