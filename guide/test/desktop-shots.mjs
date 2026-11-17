// Screenshots of every story stop and every chapter at laptop and projector size.
// Usage: node test/desktop-shots.mjs [baseURL]   -> shots/wide/<size>-<world>-...png
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5180/';
const out = new URL('../shots/wide/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const sizes = { laptop: { width: 1280, height: 800 }, projector: { width: 1920, height: 1080 } };
const chapters = ['effort', 'examples', 'upgrade', 'cost', 'choose'];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [size, viewport] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  for (const world of ['claude', 'openai', 'gemini']) {
    await page.goto(`${base}#${world}-models`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__story?.ready, null, { timeout: 20000 });
    await page.screenshot({ path: `${out}${size}-${world}-intro.png` });
    const stops = await page.evaluate(() => window.__story.stops.map(s => `${s.id}-${s.effort ?? 'arrive'}`));
    for (let i = 0; i < stops.length; i++) {
      await page.evaluate(k => window.__story.goTo(k), i);
      await page.waitForTimeout(1300);
      await page.screenshot({ path: `${out}${size}-${world}-stop-${String(i + 1).padStart(2, '0')}-${stops[i]}.png` });
      await page.waitForTimeout(350);
    }
    for (const ch of chapters) {
      await page.goto(`${base}#${world}-${ch}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${out}${size}-${world}-${ch}.png` });
    }
  }
  await page.close();
}
await browser.close();
console.log('desktop shots done');
