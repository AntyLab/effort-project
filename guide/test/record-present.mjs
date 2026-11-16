// Records presentation mode at 1920x1080, stepping through every stop with the arrow key like a clicker.
// Usage: node test/record-present.mjs [world ...]   -> shots/present-<world>.webm
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = 'http://localhost:5180/';
const worlds = process.argv.slice(2);
const out = new URL('../shots/', import.meta.url).pathname;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const world of worlds.length ? worlds : ['claude', 'openai', 'gemini']) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(`${base}?present=1#${world}-models`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__story?.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__story.goTo(0));
  await page.waitForTimeout(2000);
  const stops = await page.evaluate(() => window.__story.stops.length);
  for (let i = 1; i < stops; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500); }
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  fs.renameSync(await video.path(), `${out}present-${world}.webm`);
  console.log(`recorded present-${world}.webm`);
}
await browser.close();
