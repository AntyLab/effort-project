// Browser smoke specification. Do not run where browser use is prohibited.
// Usage: node test/smoke.mjs [baseURL] [--only=claude,openai] [--reduced]
// Visits EVERY stop in EVERY selected family at all four sizes, through real Next buttons.
// Preserves the exact cost arithmetic and chapter 6 rules/handoff checks.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--')) ?? 'http://localhost:5180/';
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const reduced = args.includes('--reduced');
const data = JSON.parse(fs.readFileSync(new URL('../data/models.json', import.meta.url), 'utf8'));
const worlds = Object.keys(data.families);
const chapters = ['effort', 'examples', 'upgrade', 'cost', 'choose'];
const labels = { models: 'Models', effort: 'Effort', examples: 'Examples', upgrade: 'Model vs effort', cost: 'Cost', choose: 'Try Effort' };
const sizes = { phone: { width: 390, height: 844 }, shortPhone: { width: 390, height: 720 }, desktop: { width: 1280, height: 800 }, wideDesktop: { width: 1920, height: 1080 } };
const out = new URL('../shots/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const problems = [];
const escapeRE = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const [size, viewport] of Object.entries(sizes)) {
  const phone = viewport.width === 390;
  const context = await browser.newContext({ viewport, deviceScaleFactor: phone ? 2 : 1, reducedMotion: reduced ? 'reduce' : 'no-preference', hasTouch: phone, isMobile: phone });
  const page = await context.newPage();
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  let where = '';
  page.on('console', m => { if ((m.type() === 'error' && !/ERR_FAILED/.test(m.text())) || /unavailable/.test(m.text())) problems.push(`${where}: console ${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', e => problems.push(`${where}: page error: ${e.message.slice(0, 300)}`));
  const check = async name => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(over <= 1, `${name}: scrolls sideways by ${over}px`);
    // CSS entry animation must finish before capturing a chapter (including reduced motion).
    await page.locator('main').evaluate(async el => {
      await Promise.all(el.getAnimations({subtree:true}).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    });
    await page.screenshot({ path: `${out}${name}${reduced ? '-reduced' : ''}.png` });
    await page.waitForTimeout(350); // ScrollTrigger refresh may follow screenshot resizing.
  };
  const waitStory = async () => {
    await page.waitForSelector('#stageArt canvas, #stageArt svg', { timeout: 15000 });
    await page.waitForFunction(() => window.__story?.ready, null, { timeout: 15000 });
  };
  const expandHeader = async () => {
    const menu = page.locator('#headerMenu');
    if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
  };
  const activeControl = async (act, value) => assert.equal(await page.evaluate(([a, v]) => document.activeElement?.dataset.act === a && (v === undefined || document.activeElement?.dataset.v === v), [act, value]), true, `${where}: focus must survive rerender`);
  const targets = async selector => {
    const small = await page.locator(selector).evaluateAll(nodes => nodes.filter(el => el.getClientRects().length && !el.closest('[hidden]')).map(el => ({ tag: el.tagName, text: el.getAttribute('aria-label') || el.textContent.trim(), height: el.getBoundingClientRect().height })).filter(el => el.height < 43.5));
    assert.deepEqual(small, [], `${where}: tap targets need 44px height`);
  };
  const chapter = async (world, ch) => {
    const previousHash = await page.evaluate(() => location.hash);
    await expandHeader();
    const link = page.locator(`#chapters a[data-v="${ch}"]`);
    assert.equal(await link.getAttribute('href'), `#${world}-${ch}`);
    await link.click();
    await page.waitForFunction(hash => location.hash === hash, `#${world}-${ch}`);
    assert.equal(await page.locator('main h1').count(), 1);
    assert.equal(await page.locator('main h1').getAttribute('tabindex'), '-1');
    if (previousHash !== `#${world}-${ch}`) assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('main h1')), true, `${world}/${ch}: a changed chapter receives heading focus`);
    assert.equal(await page.title(), `${labels[ch]} · ${data.families[world].label} · Model guide`);
    const uncovered = await page.evaluate(() => document.querySelector('main h1').getBoundingClientRect().top >= document.querySelector('.top').getBoundingClientRect().bottom - 1);
    assert.ok(uncovered, `${world}/${ch}: title must clear sticky header`);
    assert.ok(await page.locator('main h1').evaluate(el => getComputedStyle(el).outlineStyle === 'none' || parseFloat(getComputedStyle(el).outlineWidth) === 0), 'Programmatic chapter-heading focus has no outline');
    if (!phone) await desktopHeader();
  };
  const desktopHeader = async () => {
    assert.equal(await page.locator('#headerMenu').isVisible(), false, 'Desktop keeps chapter tabs visible instead of using a menu');
    const pinned = await page.locator('body').evaluate(el => el.classList.contains('story-pinned'));
    assert.equal(await page.locator('#chapters').isVisible(), true);
    assert.equal(await page.locator('.header-compact').isVisible(), pinned);
    assert.equal(await page.locator('.top-row>.brand').isVisible(), !pinned);
    assert.equal(await page.locator('#worlds').isVisible(), !pinned);
    const selector = pinned ? '.header-compact, #chapters, .top-in>.present-button' : '.top-row>.brand, #worlds, #chapters';
    const navigation = await page.locator(selector).evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
    assert.ok(Math.max(...navigation.map(r => r.top)) < Math.min(...navigation.map(r => r.bottom)), 'Desktop navigation stays on one horizontal row, including pinned chapter tabs');
  };
  const desktopStage = async () => {
    const bounds = await page.evaluate(() => {
      const stage = document.querySelector('#stage').getBoundingClientRect(), cap = document.querySelector('#cap').getBoundingClientRect();
      return { width: stage.width, viewport: innerWidth, left: stage.left, capLeft: (cap.left - stage.left) / stage.width, capRight: (cap.right - stage.left) / stage.width, capTop: (cap.top - stage.top) / stage.height, capBottom: (cap.bottom - stage.top) / stage.height };
    });
    assert.ok(Math.abs(bounds.width - bounds.viewport) <= 1 && Math.abs(bounds.left) <= 1, 'Desktop stage is full bleed at 100vw');
    assert.ok(bounds.capLeft >= -.001 && bounds.capRight <= .381, `${where}: desktop caption stays within the left 38% of the stage`);
    assert.ok(bounds.capTop >= .499 && bounds.capBottom <= 1.001, `${where}: desktop caption stays within the bottom half of the stage`);
    const typography = await page.locator('.cap .field-ex p, .cap-meta, .cap-tag, .cap-helper').evaluateAll(nodes => nodes.map(el => parseFloat(getComputedStyle(el).fontSize)));
    assert.ok(typography.every(px => px >= 18), 'Desktop examples and caption body use at least 18px type');
    assert.ok(await page.locator('.cap-name').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 28), 'Desktop model name is at least 28px');
    assert.ok(await page.locator('.cap-step, .cap .badge, .cap .ro-name, .cap .meter-range, .cap .cost-value').evaluateAll(nodes => nodes.every(el => parseFloat(getComputedStyle(el).fontSize) >= 15)), 'Desktop caption labels and badges use at least 15px type');
    assert.ok(await page.locator('#cap button').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height >= 47.5)), 'Desktop caption controls have 48px targets');
    if (!reduced) {
      const rail = await page.locator('#rail').evaluate(el => { const r = el.getBoundingClientRect(), stage = document.querySelector('#stage').getBoundingClientRect(); return { right: (stage.right - r.right) / innerWidth, center: (r.top + r.bottom - stage.top - stage.bottom) / 2 }; });
      assert.ok(Math.abs(rail.right - .03) <= .005 && Math.abs(rail.center) <= 2, 'Desktop rail is vertically centered with a 3vw right offset');
      assert.ok(await page.locator('#rail .rail-label').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).opacity === '1')), 'Every desktop rail label remains visible');
    }
    await desktopHeader();
  };
  const stageShell = async () => {
    const shell = await page.evaluate(() => {
      const stage=document.querySelector('#stage'), bounds=stage.getBoundingClientRect(), css=getComputedStyle(stage);
      const controls=stage.querySelector('.stage-controls'), controlBounds=controls.getBoundingClientRect();
      const cap=stage.querySelector('#cap').getBoundingClientRect(), rail=stage.querySelector('#rail').getBoundingClientRect();
      const inset=edge => parseFloat(css.getPropertyValue('--clear-'+edge));
      return {
        inStage:controls.parentElement===stage, position:getComputedStyle(controls).position,
        controlsTop:controlBounds.top-bounds.top, controlsBottom:controlBounds.bottom-bounds.top,
        capInset:bounds.bottom-cap.top, railInset:rail.width?bounds.right-rail.left:0,
        insets:['top','bottom','right'].map(inset),
        overlap:controlBounds.left<rail.right && controlBounds.right>rail.left && controlBounds.top<rail.bottom && controlBounds.bottom>rail.top,
        canvases:[...stage.querySelectorAll('canvas')].map(el => ({touch:getComputedStyle(el).touchAction,pointer:getComputedStyle(el).pointerEvents})),
        buttons:[...controls.querySelectorAll('button')].filter(el => el.getClientRects().length).map(el => ({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize})),
        borderless:[...document.querySelectorAll('#chapters .tab,#worlds button')].every(el => parseFloat(getComputedStyle(el).borderTopWidth)===0),
      };
    });
    assert.ok(shell.inStage && shell.position==='absolute', 'Playback is anchored inside the stage');
    assert.ok(shell.controlsTop>=0 && !shell.overlap, 'Playback clears the rail');
    assert.ok(shell.canvases.every(el => el.touch==='pan-y' && el.pointer==='none'), 'All stage canvases allow page swipes despite inline renderer styles');
    assert.ok(shell.buttons.every(el => el.height>=44 && el.font==='14px'), 'Playback uses 14px type and 44px targets');
    assert.ok(shell.borderless, 'Family buttons and chapter tabs have no wireframe boxes');
    const [top,bottom,right]=shell.insets;
    assert.ok(top>=shell.controlsBottom && top<=shell.controlsBottom+9, 'Clear top follows playback');
    assert.ok(bottom>=shell.capInset && bottom<=shell.capInset+9, 'Clear bottom follows the current caption height');
    assert.ok(right>=shell.railInset && right<=shell.railInset+9, 'Clear right follows the rail');
    assert.equal(await page.locator('[data-act="motion"]').isVisible(), !reduced);
    assert.equal(await page.locator('[data-act="sound"]').isVisible(), true);
    if (phone) assert.equal((await page.locator('#headerMenu').textContent()).trim(), 'Models', 'Pinned menu names the chapter without a count');
  };
  const meter = async selector => {
    assert.equal(await page.locator(`${selector} .meter-range`).textContent().then(t => t.replace(/\s/g, '')), '0×1×4×');
    assert.equal(await page.locator(`${selector} .cost-one`).count(), 1);
    assert.equal(await page.locator(`${selector} .cost-scale`).getAttribute('role'), 'img');
    assert.equal(await page.locator(`${selector} .meter-title`).innerText(), 'Cost vs Medium');
    assert.ok(await page.locator(`${selector} .cost-value`).innerText());
  };

  for (const world of worlds) {
    if (only && !only.includes(world)) continue;
    where = `${size} ${world}-models`;
    await page.goto(`${base}#${world}-models`, { waitUntil: 'domcontentloaded' });
    await waitStory();
    const family = data.families[world];
    const stops = await page.evaluate(() => window.__story.stops);
    const expected = family.models.slice().reverse().flatMap((m, model) => [
      { model, level: 0, active: false, id: m.id, effort: null },
      ...(m.efforts.length ? m.efforts : (m.access || []).map(a => a.id)).map((effort, level) => ({ model, level, active: true, id: m.id, effort })),
    ]);
    assert.deepEqual(stops, expected, `${world}: story stops must match the data`);
    assert.equal(await page.locator('#cap').getAttribute('aria-live'), null);
    assert.equal(await page.locator('#storyStatus[role="status"]').count(), 1);
    assert.equal(await page.locator('.skip-models').getAttribute('href'), '#all-models');
    assert.deepEqual(await page.locator('#chapters a.tab').allTextContents().then(text => text.map(t => t.replace(/^\d+/, ''))), Object.values(labels));
    assert.notEqual(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundAttachment), 'fixed');
    assert.ok(await page.locator('html').evaluate(el => parseFloat(getComputedStyle(el).scrollPaddingTop) > 0));
    assert.ok(await page.locator('.mark').evaluateAll(nodes => nodes.every(el => el.querySelectorAll('i').length === 3)));
    assert.match(await page.locator('.top-row .brand').innerText(), /Model guide/);
    assert.equal(await page.locator('a.by-effort').getAttribute('href'), `#${world}-choose`);
    assert.equal(await page.locator('.present-button').count(), 1, 'Only the header exposes Present');
    if (phone) assert.ok(await page.locator('.top').evaluate(el => el.getBoundingClientRect().height<=150), 'Full phone header stays compact');
    if (phone) assert.ok(await page.locator('.present-button').evaluateAll(nodes => nodes.every(el => !el.getClientRects().length)), 'Present controls are desktop only');
    else await desktopHeader();
    assert.equal(await page.locator('#rail button').count(), family.models.length);
    assert.equal(await page.locator('#rail .rail-bar').count(), family.models.length);
    for (const model of family.models) {
      assert.ok(await page.locator('main .sr-only').allTextContents().then(text => text.some(t => t.startsWith(`${model.short}:`))), `${model.short}: scene description`);
    }
    const points = await page.evaluate(() => window.__story.positions);
    assert.equal(points.length, stops.length);
    const total = stops.slice(0, -1).reduce((sum, stop) => sum + (stop.active ? .4 : .7), 0);
    for (let i = 0; i < points.length - 1; i++) assert.ok(Math.abs((points[i + 1] - points[i]) * total - (stops[i].active ? .4 : .7)) < 1e-8, 'Snap and jump positions must share weighted spacing');
    await page.evaluate(() => window.__story.goTo(0));
    await page.locator('#stage').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.waitForFunction(() => document.body.classList.contains('story-pinned'));
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__story.goTo(0));
    if (reduced) assert.ok(await page.evaluate(() => document.querySelector('#journey').getBoundingClientRect().height <= innerHeight + 1), 'Reduced journey occupies one screen');
    for (let i = 0; i < stops.length; i++) {
      where = `${size} ${world} stop ${i}`;
      if (i) await page.locator('[data-act="story-next"]').click();
      const stop = stops[i], model = family.models.find(m => m.id === stop.id);
      const accessStop = stop.active && !model.efforts.length;
      const tier = accessStop ? model.access.find(a => a.id === stop.effort) : null;
      const levels = model.efforts.length ? model.efforts : (model.access || []).map(a => a.id);
      const counter = `${model.short} · ${stop.active ? `${accessStop ? 'access ' : ''}level ${stop.level + 1} of ${levels.length}` : `model ${stop.model + 1} of ${family.models.length}`}`;
      await page.waitForFunction(text => document.querySelector('.cap-step')?.textContent === text, counter, { timeout: 5000 });
      await page.waitForTimeout(reduced ? 300 : 700);
      assert.equal(await page.locator('.cap-name').evaluate(el => el.firstChild.textContent), model.short);
      assert.equal(await page.locator('.cap-name').evaluate(el => el.tagName), 'P');
      assert.equal(await page.locator('[data-act="story-prev"]').isDisabled(), i === 0);
      assert.equal(await page.locator('[data-act="story-next"]').isDisabled(), i === stops.length - 1);
      if (i < stops.length - 1) {
        const next = stops[i + 1], nm = family.models.find(m => m.id === next.id);
        const nextModel = nm, nextTier = next.active && !nextModel.efforts.length ? nextModel.access.find(a => a.id === next.effort) : null;
        assert.equal(await page.locator('[data-act="story-next"]').getAttribute('aria-label'), `Next: ${nm.short}, ${nextTier ? `access level ${next.level + 1} of ${nextModel.access.length}, ${nextTier.label}` : next.active ? data.effortLevels[next.effort].label : 'model introduction'}`);
      }
      for (const [condition, badge] of [[model.status === 'restricted', 'Limited access'], [model.status === 'testing', 'In testing'], [model.legacy, 'Previous generation']]) {
        if (condition) assert.match(await page.locator('.cap-badges').innerText(), new RegExp(badge));
      }
      if (stop.active) {
        assert.equal(await page.locator('.cap .ro-name').count(), 1);
        assert.equal(await page.locator('.cap-role').count(), 0, 'Effort stops leave the model tagline on arrival');
        if (accessStop) {
          assert.equal(await page.locator('.cap .ro-name').innerText(), tier.label);
          assert.equal(await page.locator('.cap-tag').innerText(), tier.desc);
          assert.equal(await page.locator('#cap .pip-dots i').count(), 0);
          assert.equal(await page.locator('#cap .cost-scale').count(), 0);
          assert.equal(await page.locator('#cap .field-ex').count(), 0);
        } else {
          assert.equal(await page.locator('.cap .ro-name').innerText(), data.effortLevels[stop.effort].label);
          const pips = await page.locator('#cap .pip-dots i').evaluateAll(nodes => nodes.map(el => ({ level: el.dataset.level, unavailable: el.classList.contains('unavailable'), on: el.classList.contains('on'), width: el.getBoundingClientRect().width })));
          assert.deepEqual(pips.map(p => p.level), family.efforts, `${world}: positions are fixed across every model`);
          pips.forEach((pip, index) => { assert.equal(pip.unavailable, !model.efforts.includes(pip.level)); assert.equal(pip.on, !pip.unavailable && index <= family.efforts.indexOf(stop.effort)); assert.ok(pip.width >= 9); });
          if (pips.some(pip => pip.unavailable)) {
            assert.equal(await page.locator('#cap .pip-key').innerText(), 'Unavailable');
            assert.match(await page.locator('#cap .pip-dots').getAttribute('aria-label'), /unavailable/);
          }
          const field = await page.locator('#fieldSel').inputValue();
          assert.equal(await page.locator('.cap .field-ex p').innerText(), data.fields[field].eff[stop.effort]);
        }
        assert.equal(await page.locator('.cap .ro-api').count(), 0);
        assert.equal(await page.locator('.cap .badge').filter({ hasText: 'Default effort' }).count(), stop.effort === model.start ? 1 : 0);
        const defaults = page.locator('.cap .badge').filter({ hasText: /Default effort|Start here/ });
        assert.ok(await defaults.evaluateAll(nodes => nodes.every(el => getComputedStyle(el).color === 'rgb(43, 38, 32)')));
        if (!accessStop) await meter('#cap');
        assert.equal(await page.locator('.cap-more').getAttribute('aria-label'), `What it is for: ${model.short}`);
        await page.locator('.cap-more').click();
        assert.match(await page.locator('#sheetBody').innerText(), new RegExp(escapeRE(accessStop ? tier.desc : data.effortLevels[stop.effort].desc)));
        if (!accessStop) assert.equal(await page.locator('#sheetBody .field-ex').count(), 2);
        assert.equal(await page.evaluate(() => document.querySelector('main').inert && document.querySelector('.top').inert), true);
        assert.equal(await page.locator('.sheet-card').getAttribute('data-lenis-prevent'), '');
        assert.equal(await page.locator('.sheet-card').evaluate(el => getComputedStyle(el).overscrollBehaviorY), 'contain');
        await targets('.sheet-x');
        await page.locator('.sheet-x').press('Escape');
        assert.equal(await page.locator('#sheet').isHidden(), true);
        assert.equal(await page.evaluate(() => document.querySelector('main').inert || document.querySelector('.top').inert), false);
        await activeControl('sheet');
      } else {
        assert.equal(await page.locator('.cap .ro-name').count(), 0);
        assert.equal(await page.locator('.cap-tag').innerText(), await page.locator('.ladder .stop').nth(family.models.indexOf(model)).locator('.tag').innerText(), 'Arrival retains the model tagline');
        assert.equal(await page.locator('.cap-helper').innerText(), levels.length ? `${levels.length} ${model.efforts.length ? 'effort' : 'access'} levels: ${reduced ? 'use Next' : 'keep scrolling'}` : 'No effort setting for this model.');
        if (model.status !== 'available') assert.doesNotMatch(await page.locator('.cap-meta').innerText(), /per 1M tokens/);
        // Valley map: one dot per model, this model marked; its own dot closes the map without leaving the stop.
        assert.equal(await page.locator('[data-act="map"]').isVisible(), world === 'claude', 'Only the Claude world has a valley map');
        if (world === 'claude') {
          await page.locator('[data-act="map"]').click();
          assert.equal(await page.locator('.map-dot').count(), family.models.length);
          await targets('.map-dot');
          assert.equal(await page.locator('.map-dot[aria-current]').getAttribute('aria-label'), `Go to ${model.short} (you are here)`);
          await page.locator('.map-dot[aria-current]').click();
          assert.equal(await page.locator('#sheet').isHidden(), true);
          await activeControl('map');
        }
      }
      assert.equal(await page.locator('#storyStatus').innerText(), `${model.short}, ${accessStop ? `access level ${stop.level + 1} of ${model.access.length}, ${tier.label}` : stop.active ? data.effortLevels[stop.effort].label : 'model introduction'}`);
      const isPinned = await page.locator('body').evaluate(el => el.classList.contains('story-pinned'));
      if (isPinned) {
        assert.equal(await page.locator('.top').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
        assert.equal(await page.locator('.cap-in').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
        if (phone) {
          assert.equal(await page.locator('.header-compact').isVisible(), true);
          assert.equal(await page.locator('#compactFamily').innerText(), family.label);
        } else await desktopHeader();
      }
      const layout = await page.evaluate(() => {
        const cap = document.querySelector('.cap-in'), stage = document.querySelector('#stage');
        return { height:cap.getBoundingClientRect().height, ratio: cap.getBoundingClientRect().height / stage.getBoundingClientRect().height, scroll: getComputedStyle(cap).overflowY, min: parseFloat(getComputedStyle(cap).minHeight), bottom: cap.getBoundingClientRect().bottom <= stage.getBoundingClientRect().bottom + 1 };
      });
      if (phone) {
        assert.ok(layout.ratio <= .45 + .005, `${where}: caption exceeds 45% of stage`);
        if (stop.active && !accessStop) assert.ok(layout.height <= 176, `${where}: effort caption should be about 170px at 390px wide, got ${layout.height}`);
      }
      else await desktopStage();
      assert.notEqual(layout.scroll, 'auto');
      assert.ok(layout.min === 0 && layout.bottom, 'Caption fits its content and keeps its bottom anchor');
      const fonts = await page.locator('.cap .field-ex p, .cap-meta, .cap-helper, .cap .ro-name, .cap .meter-range span').evaluateAll(nodes => nodes.map(el => parseFloat(getComputedStyle(el).fontSize)));
      assert.ok(fonts.every(px => px >= 14), 'Caption body and labels are at least 14px');
      await targets('.cap button, #rail button');
      await stageShell();
      if (world==='claude') assert.equal(await page.locator('#stage').evaluate(el => el.classList.contains('night')), stop.id==='mythos', 'The caption and rail have the drawn plate theme');
      const rail = await page.locator('#rail button').evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { y: r.top, end: r.bottom }; }));
      assert.ok(rail.slice(1).every((r, index) => r.y >= rail[index].end), 'Rail targets do not overlap');
      await check(`${size}-${world}-stop-${i + 1}-${stop.id}-${stop.effort ?? 'arrive'}`);
    }
    if (!phone) {
      // Story keyboard commands use the same immediate weighted jump as the real buttons.
      const expectStop = async index => {
        const stop = stops[index], model = family.models.find(m => m.id === stop.id);
        const levels = model.efforts.length ? model.efforts : (model.access || []).map(a => a.id);
        const accessStop = stop.active && !model.efforts.length;
        const text = `${model.short} · ${stop.active ? `${accessStop ? 'access ' : ''}level ${stop.level + 1} of ${levels.length}` : `model ${stop.model + 1} of ${family.models.length}`}`;
        await page.waitForFunction(value => document.querySelector('.cap-step')?.textContent === value, text);
      };
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Home'); await expectStop(0);
      const assertNativeKey = async (key, selector = 'body') => {
        const allowed = await page.locator(selector).evaluate((el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true})), key);
        assert.equal(allowed, true, `${where}: ${key} retains native behavior on ${selector}`);
      };
      for (const key of ['ArrowUp','PageUp','Home']) await assertNativeKey(key);
      const controls = await page.evaluate(() => {
        const host = document.createElement('div'); host.id = 'key-test-controls';
        host.innerHTML = '<button>Button</button><a href="#all-models">Link</a><details><summary>Summary</summary></details><span role="radio" tabindex="0">Radio</span><span role="tab" tabindex="0">Tab</span>';
        document.querySelector('#stage').append(host);
        return ['button','a','summary','[role=radio]','[role=tab]'];
      });
      for (const selector of controls) for (const key of [' ', 'Enter']) await assertNativeKey(key, `#key-test-controls ${selector}`);
      await page.locator('#key-test-controls').evaluate(el => el.remove());
      for (const key of ['Space', 'Enter']) {
        await page.locator('.cap-more').focus();
        await page.keyboard.press(key);
        assert.equal(await page.locator('#sheet').isVisible(), true, `${key} activates the focused details button`);
        await expectStop(0);
        await page.keyboard.press('Escape');
      }
      await page.evaluate(() => document.activeElement?.blur());
      for (const [index, key] of ['ArrowRight', 'ArrowDown', 'PageDown', 'Space'].entries()) {
        await page.keyboard.press(key); await expectStop(index + 1);
      }
      for (const [index, key] of ['ArrowLeft', 'ArrowUp', 'PageUp'].entries()) {
        await page.keyboard.press(key); await expectStop(3 - index);
      }
      await page.keyboard.press('End'); await expectStop(stops.length - 1);
      for (const key of ['ArrowDown','PageDown',' ','End']) await assertNativeKey(key);
      await page.keyboard.press('ArrowRight'); await expectStop(stops.length - 1);
      await page.keyboard.press('Home'); await expectStop(0);
      await page.keyboard.press('ArrowLeft'); await expectStop(0);
      await page.evaluate(() => {
        for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...extra }));
      });
      await expectStop(0);
      await page.locator('#fieldSel').evaluate(el => { el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
      await expectStop(0); // The event target is a select even when the pinned desktop picker is hidden.
      await page.locator('.cap-more').click();
      await page.keyboard.press('ArrowRight'); await expectStop(0);
      await page.keyboard.press('Escape');
      await page.evaluate(() => document.activeElement?.blur());
      await page.locator('#all-models').evaluate(el => window.scrollTo({top:scrollY + el.getBoundingClientRect().top,behavior:'instant'}));
      await page.waitForFunction(() => document.querySelector('#stage').getBoundingClientRect().bottom <= document.querySelector('.top').getBoundingClientRect().bottom);
      // Scrolling past the story leaves it on its last stop; a key press out here must not change it.
      await page.waitForTimeout(900); // let the smooth scroll and the caption catch up with the jump before sampling
      const before = await page.locator('.cap-step').textContent();
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
      assert.equal(await page.locator('.cap-step').textContent(), before, 'Keys do nothing once the story is off screen');
      await page.locator('#stage').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.evaluate(() => window.__story.goTo(0));
      // Mock fullscreen calls so this specification never needs a real fullscreen window.
      await page.evaluate(() => {
        window.__fullscreenRequests = 0; window.__fullscreenExits = 0; window.__mockFullscreen = null;
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => window.__mockFullscreen });
        document.documentElement.requestFullscreen = async () => { window.__fullscreenRequests++; window.__mockFullscreen = document.documentElement; document.dispatchEvent(new Event('fullscreenchange')); };
        document.exitFullscreen = async () => { window.__fullscreenExits++; window.__mockFullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); };
      });
      await page.locator('.top .present-button').click();
      await page.waitForFunction(() => document.body.classList.contains('presenting'));
      assert.equal(await page.evaluate(() => window.__fullscreenRequests), 1, 'A Present click requests fullscreen');
      assert.equal(await page.locator('.top .present-button').isVisible(), true, 'Presentation retains its Exit control');
      assert.equal(await page.locator('#chapters').isVisible(), false, 'Presentation hides chapter navigation');
      // The stage re-pins after the header disappears; give that a moment before measuring.
      await page.waitForFunction(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return Math.abs(r.top) <= 1 && Math.abs(r.height - innerHeight) <= 1; }, null, { timeout: 4000 }).catch(() => {});
      const presentation = await page.locator('#stage').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; });
      assert.ok(Math.abs(presentation.x) <= 1 && Math.abs(presentation.y) <= 1 && Math.abs(presentation.w - presentation.iw) <= 1 && Math.abs(presentation.h - presentation.ih) <= 1, 'Presentation stage fills the viewport');
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('ArrowRight'); await expectStop(1);
      await page.locator('.cap-more').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#sheet').isHidden(), true);
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('presenting')), true, 'Escape closes details before presentation');
      await page.mouse.move(10, 10);
      await page.waitForTimeout(3200);
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('cursor-idle')), true, 'Presentation cursor idles after three seconds');
      await page.mouse.move(30, 30);
      await page.waitForFunction(() => !document.body.classList.contains('cursor-idle'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('presenting'));
      assert.equal(await page.evaluate(() => window.__fullscreenExits), 1, 'Escape exits requested fullscreen');
      await page.locator('.top .present-button').click();
      await page.waitForFunction(() => document.body.classList.contains('presenting'));
      await page.evaluate(() => { window.__mockFullscreen = null; document.dispatchEvent(new Event('fullscreenchange')); });
      await page.waitForFunction(() => !document.body.classList.contains('presenting'));
      await page.evaluate(last => window.__story.goTo(last), stops.length - 1);
    }
    // Previous uses the same immediate jump mapping; all models remain reachable from the rail.
    await page.locator('[data-act="story-prev"]').click();
    await page.locator('[data-act="story-next"]').click();
    for (const button of await page.locator('#rail button').all()) {
      await button.click();
      assert.equal(await button.getAttribute('aria-current'), 'true');
      assert.ok(await button.locator(phone ? '.rail-initial' : '.rail-label').isVisible());
    }
    if (!phone && !reduced) {
      const firstEffort=1;
      await page.evaluate(index => window.__story.goTo(index), firstEffort);
      await page.waitForTimeout(1600);
      const firstCaption=await page.locator('.cap-step').textContent();
      const stageBox=await page.locator('#stage').boundingBox();
      await page.mouse.move(stageBox.x+stageBox.width/2,stageBox.y+stageBox.height/3);
      await page.mouse.wheel(0,100);
      await page.waitForTimeout(2200);
      assert.notEqual(await page.locator('.cap-step').textContent(),firstCaption, 'One wheel notch advances instead of snapping back');
      const forwardY=await page.evaluate(() => scrollY);
      await page.mouse.wheel(0,-100);
      await page.waitForTimeout(2200);
      assert.ok(await page.evaluate(() => scrollY)<forwardY, 'A reversed wheel notch snaps backwards');
      await page.evaluate(() => window.__story.goTo(0));
      await page.waitForTimeout(1600);
      assert.equal(await page.locator('.cap-name').evaluate(el => el.firstChild.textContent), family.models.at(-1).short, 'Rail/button jumps survive stale reverse scroll direction');
      const samples=[];
      for (let tick=0;tick<12;tick++) {
        await page.mouse.wheel(0,12); await page.waitForTimeout(25);
        samples.push(await page.evaluate(() => scrollY));
      }
      assert.ok(samples.at(-1)>samples[0]+10 && samples.every((y,index) => !index || y>=samples[index-1]-.5), 'Continuous trackpad-sized input stays smooth without snapping backwards');

    }
    // Pausing uses the same static scene path as reduced motion, with all model jumps retained.
    if (!reduced) {
      // Let the directional snap from the wheel input above finish: wait until the page position holds still.
      for (let last=-1, same=0, tries=0; same<3 && tries<40; tries++) { await page.waitForTimeout(250); const now=await page.evaluate(() => scrollY); same=Math.abs(now-last)<=.5?same+1:0; last=now; }
      const motionY = await page.evaluate(() => scrollY);
      const motionCaption = await page.locator('.cap-step').textContent();
      const motion = page.locator('[data-act="motion"]');
      assert.equal(await motion.getAttribute('aria-pressed'), 'false');
      assert.equal(await motion.innerText(), 'Pause motion');
      await motion.click();
      await waitStory();
      assert.equal(await motion.getAttribute('aria-pressed'), 'true');
      assert.equal(await motion.innerText(), 'Play motion');
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('motion-paused')), true);
      { const afterY=await page.evaluate(() => scrollY); assert.ok(Math.abs(afterY - motionY) <= 1, `Pause retains scroll position within pixel rounding (before ${motionY}, after ${afterY}, ${await page.evaluate(() => innerWidth+'x'+innerHeight+' '+location.hash+' '+document.querySelector('.cap-step')?.textContent)})`); }
      assert.equal(await page.locator('.cap-step').textContent(), motionCaption, 'Pause retains the selected stop');
      assert.equal(await page.locator('#journey').evaluate(el => el.classList.contains('reduced')), reduced);
      assert.equal(await page.locator('#rail button').count(), family.models.length);
      await motion.click();
      await waitStory();
      assert.equal(await motion.getAttribute('aria-pressed'), 'false');
      assert.equal(await motion.innerText(), 'Pause motion');
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('motion-paused')), false);
      assert.equal(await page.locator('#journey').evaluate(el => el.classList.contains('reduced')), reduced);
      assert.equal(await page.locator('#rail button').count(), family.models.length);
    } else {
      assert.equal(await page.locator('[data-act="motion"]').isVisible(), false, 'Static plates have no Pause motion control');
      assert.equal(await page.locator('[data-act="sound"]').isVisible(), true);
    }
    await expandHeader();
    if (await page.locator('#headerMenu').isVisible()) assert.equal(await page.locator('#headerMenu').getAttribute('aria-expanded'), 'true');
    const middleMark = await page.locator('.top-row .mark i').nth(1).evaluate(el => getComputedStyle(el).display);
    assert.notEqual(middleMark, 'none', 'Brand mark stays the same in every family');
    // Selected field visibly changes chapter 1 and remains focused after the rerender.
    await page.evaluate(() => window.__story.goTo(1));
    if (phone) await expandHeader();
    else {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.waitForFunction(() => !document.body.classList.contains('story-pinned'));
    }
    const oldField = await page.locator('#fieldSel').inputValue();
    const otherField = Object.keys(data.fields).find(key => key !== oldField);
    await page.locator('#fieldSel').focus();
    await page.locator('#fieldSel').selectOption(otherField);
    await waitStory();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fieldSel');
    if (!phone) await page.evaluate(() => window.__story.goTo(1));
    const selectedModel = stops[1];
    await page.waitForFunction(text => document.querySelector('.cap .field-ex p')?.textContent === text, data.fields[otherField].eff[selectedModel.effort]);
    await page.locator('#cap [data-act="skip-story"]').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'all-models');
    await page.waitForTimeout(700); // Let the offscreen scroll-linked caption settle after skipping.
    assert.equal(await page.locator('.stage-controls').isVisible(), false, 'Playback stays hidden over the model list');
    const skippedY = await page.evaluate(() => scrollY);
    const skippedCaption = await page.locator('.cap-step').textContent();
    for (const key of ['ArrowUp', 'Home', 'End', 'Space']) {
      const allowed = await page.locator('#all-models').evaluate((el, key) => el.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles:true, cancelable:true})), key);
      assert.equal(allowed, true, 'Skipped story leaves page keys native');
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - skippedY) <= 1, 'Story keys cannot pull the page back after skipping');
      assert.equal(await page.locator('.cap-step').textContent(), skippedCaption, 'Keys must not re-enter the skipped story');
    }
    assert.equal(await page.locator('#foot details').count(), 1);
    await page.locator('#foot summary').click();
    assert.ok(await page.locator('#foot a').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().height>=24)), 'Source links have at least a 24px padded line box');
    await page.locator('#foot summary').click();
    await page.locator('.skip-models').click();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'all-models');
    await page.locator('.more').first().click();
    assert.equal(await page.locator('.more').first().getAttribute('aria-expanded'), 'true');
    assert.ok(await page.locator('.more').evaluateAll(nodes => nodes.every(el => el.getAttribute('aria-label')?.startsWith('What it is for: ') && el.querySelector('svg'))));
    await targets('.more, .pager button, .pager a');

    for (const ch of chapters) {
      where = `${size} ${world}-${ch}`;
      await chapter(world, ch);
      assert.equal(await page.locator('.stage-controls').isVisible(), false, 'Text chapters have no playback controls');
      if (!phone) {
        const width = await page.locator('main').evaluate(el => el.getBoundingClientRect().width);
        assert.ok(width <= 1501 && width <= viewport.width * .92 + 1, 'Desktop chapter text stays in a readable content container');
        const gridName = { cost: 'cost-grid', upgrade: 'upgrade-grid', choose: 'choose-grid' }[ch];
        if (gridName) {
          const grid = page.locator(`.chapter-grid.${gridName}`);
          assert.equal(await grid.count(), 1, `${ch}: desktop chapter has a named layout grid`);
          const composition = await grid.evaluate(el => { const candidates = el.classList.contains('upgrade-grid') ? [...el.querySelectorAll('.upgrade-steps,.upgrade-symptoms,.upgrade-comparator')] : [...el.children]; const children = candidates.filter(child => child.getClientRects().length).slice(0, 2).map(child => child.getBoundingClientRect()); return { display: getComputedStyle(el).display, columns: getComputedStyle(el).gridTemplateColumns.split(' ').length, sideBySide: children.length === 2 && children[0].right <= children[1].left && Math.max(children[0].top, children[1].top) < Math.min(children[0].bottom, children[1].bottom) }; });
          assert.equal(composition.display, 'grid'); assert.equal(composition.columns, ch === 'upgrade' ? 3 : 2); assert.ok(composition.sideBySide, `${ch}: desktop sections sit side by side`);
        }
        if (ch === 'examples') assert.ok(await page.locator('.ex-list').evaluate(el => getComputedStyle(el).display === 'grid' && getComputedStyle(el).gridTemplateColumns.split(' ').length >= 2), 'Desktop examples use multiple columns');
      }
      await check(`${size}-${world}-${ch}`);
      await targets('.chip, .worlds button, .pager button, .pager a, .more, #fieldSel, select');
      assert.equal(await page.locator('#foot details').count(), ch === 'choose' ? 1 : 0);
      if (ch !== 'choose') assert.equal(await page.locator('#foot a').filter({ hasText: 'Credits and sources' }).count(), 1);
      assert.ok(await page.locator('select, input:not([type="checkbox"]), textarea').evaluateAll(nodes => nodes.every(el => parseFloat(getComputedStyle(el).fontSize) >= 16)));
      if (ch === 'effort') {
        assert.equal(await page.locator('#scene, .scene-live').count(), 0);
        assert.equal(await page.locator('#levels [tabindex="0"]').count(), 1);
        const selected = page.locator('#levels [aria-checked="true"]');
        await selected.focus();
        const before = await selected.getAttribute('data-v');
        await selected.press('ArrowDown');
        assert.notEqual(await page.locator('#levels [aria-checked="true"]').getAttribute('data-v'), before);
        await page.locator('#levels [aria-checked="true"]').press('ArrowUp');
        assert.equal(await page.locator('#levels [aria-checked="true"]').getAttribute('data-v'), before);
        assert.equal(await page.locator('#levels [tabindex="0"]').count(), 1);
        if (await page.locator('#levels button:disabled').count()) assert.ok(await page.locator('.unavailable-reason').innerText());
        await meter('#readout');
        const chip = page.locator('[data-act="effmodel"]').last(), value = await chip.getAttribute('data-v');
        await chip.click(); await activeControl('effmodel', value);
        assert.equal(await page.locator('main .ch').evaluate(el => getComputedStyle(el).animationName), 'none', 'Same chapter rerender must not replay slide-in');
        await page.locator('[data-act="show-story"]').click();
        await page.waitForFunction(() => location.hash.endsWith('-models') && window.__story?.ready);
        const pickedModel = family.models.find(m => m.id === value);
        assert.equal(await page.locator('.cap-name').evaluate(el => el.firstChild.textContent), pickedModel.short);
        assert.ok(await page.locator('.cap .ro-name').innerText());
        await chapter(world, 'effort');
      }
      if (ch === 'examples') {
        const chip = page.locator('[data-act="field"]').last(), value = await chip.getAttribute('data-v');
        await chip.click(); await activeControl('field', value);
        await page.locator('[data-act="exmode"][data-v="effort"]').click(); await activeControl('exmode', 'effort');
      }
      if (ch === 'upgrade') {
        await page.locator('#cm-a').focus();
        const value = await page.locator('#cm-a option').last().getAttribute('value');
        await page.locator('#cm-a').selectOption(value);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'cm-a');
      }
      if (ch === 'cost') {
        await page.locator('[data-act="costeff"][data-v="low"]').click(); await activeControl('costeff', 'low');
        const checkbox = page.locator('[data-act="later"]');
        if (await checkbox.count()) { await checkbox.focus(); await checkbox.check(); await activeControl('later'); await checkbox.uncheck(); }
        assert.ok(await page.locator('.bar i').evaluateAll(nodes => nodes.every(el => el.getBoundingClientRect().width >= 6)));
        assert.ok(await page.locator('.bar-val small').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).whiteSpace === 'nowrap')));
        for (const id of ['mythos', 'carbon', 'terra']) if (family.models.some(m => m.id === id)) assert.match(await page.locator('.tbl tbody').innerText(), new RegExp(id === 'mythos' ? 'invitation|Fable|restricted' : id === 'carbon' ? 'intro|public API|announced' : 'previous|generation|Sol', 'i'));
      }
      if (ch === 'choose') {
        assert.equal(await page.locator('main h1').innerText(), 'Let Effort choose (for coding agents)');
        assert.match(await page.locator('.choose .lede').innerText(), /for people who use coding agents.*stop at chapter 5/);
        assert.equal(await page.locator('.field-pick').isVisible(), false);
        assert.equal(await page.locator('details summary').filter({ hasText: 'How this demo works' }).count(), 1);
        assert.equal(await page.locator('a.primary-link').getAttribute('href'), 'https://github.com/AntyLab/effort-project');
        assert.equal(await page.locator('#installCommand').innerText(), 'npm install --global github:AntyLab/effort-project');
        await page.evaluate(() => { window.__copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } }); });
        await page.locator('[data-act="copy-install"]').click();
        assert.equal(await page.evaluate(() => window.__copied), 'npm install --global github:AntyLab/effort-project');
        assert.equal(await page.locator('.pager [data-v="models"] svg').count(), 0, 'Back to models has no forward chevron');
        assert.equal(await page.locator('#chooseOut .signal-bars').count(), 0);
        assert.equal(await page.locator('#chooseOut .level-pips').count(), 1);
      }
    }
    // PushState chapter navigation preserves Back and Forward and link destination semantics.
    await chapter(world, 'cost');
    await chapter(world, 'examples');
    await page.goBack(); await page.waitForFunction(hash => location.hash === hash, `#${world}-cost`);
    await page.goForward(); await page.waitForFunction(hash => location.hash === hash, `#${world}-examples`);
    // Re-read a runtime preference change, then preserve the same selected stop.
    await chapter(world, 'models'); await waitStory();
    await page.evaluate(() => window.__story.goTo(1));
    await page.emulateMedia({ reducedMotion: reduced ? 'no-preference' : 'reduce' });
    await page.waitForFunction(expected => document.querySelector('#journey')?.classList.contains('reduced') === expected, !reduced);
    await waitStory();
    assert.equal(await page.locator('#journey').evaluate(el => el.classList.contains('reduced')), !reduced);
    if (!reduced) {
      assert.ok(await page.evaluate(() => document.querySelector('#journey').getBoundingClientRect().height <= innerHeight + 1));
      const y = await page.evaluate(() => scrollY);
      await page.evaluate(() => document.querySelector('[data-act="story-next"]').click()); // a locator click may scroll the button into view by itself
      assert.equal(await page.evaluate(() => scrollY), y, 'Reduced motion Next changes the stop without scrolling');
      assert.match(await page.locator('#stageArt').evaluate(el => getComputedStyle(el).transitionProperty), /opacity/);
    }
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.waitForFunction(expected => document.querySelector('#journey')?.classList.contains('reduced') === expected, reduced); await waitStory();
  }
  if (!phone) {
    const world = worlds.find(key => !only || only.includes(key));
    if (world) {
      where = `${size} presentation URL startup`;
      await page.addInitScript(() => {
        window.__startupFullscreenRequests = 0;
        Element.prototype.requestFullscreen = async function () { window.__startupFullscreenRequests++; };
      });
      const presentationURL = new URL(base);
      presentationURL.searchParams.set('present', '1'); presentationURL.hash = `${world}-models`;
      await page.goto(presentationURL.href, { waitUntil: 'domcontentloaded' });
      await waitStory();
      await page.waitForFunction(() => document.body.classList.contains('presenting'));
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.act), 'story-next', 'URL presentation focuses Next');
      assert.equal(await page.evaluate(() => window.__startupFullscreenRequests), 0, 'The present=1 URL never requests fullscreen without a click');
      await check(`${size}-presentation-url`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('presenting'));
      await chapter(world, 'effort');
      await page.locator('.top .present-button').click();
      await page.waitForFunction(hash => location.hash === hash && document.body.classList.contains('presenting'), `#${world}-effort`);
      assert.equal(await page.evaluate(() => window.__startupFullscreenRequests), 1, 'Header Present retains the current chapter');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.body.classList.contains('presenting'));
      await chapter(world, 'effort');
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => location.hash), `#${world}-effort`, 'Story keys do not navigate other chapters');
    }
  }
  if (size === 'phone' && (!only || only.includes('claude'))) {
    where = 'cost math';
    await page.goto(`${base}#claude-cost`);
    const costAt = async level => { await page.locator(`[data-act="costeff"][data-v="${level}"]`).click(); return page.locator('main').innerText(); };
    // Display precision is now cents; exact v1 arithmetic must still stay unchanged.
    assert.match(await costAt('low'), /\$0\.09/, 'Opus Low paper-summary cost rounds to $0.09');
    assert.equal(await page.evaluate(() => window.__guideCost('opus', 'low', 'paper')), '$0.085', 'Opus 5.5 Low, paper summary, should be about $0.085');
    assert.match(await costAt('xhigh'), /\$0\.07/, 'Sonnet Extra high paper-summary cost rounds to $0.07');
    assert.equal(await page.evaluate(() => window.__guideCost('sonnet', 'xhigh', 'paper')), '$0.074', 'Sonnet 5.5 Extra high, paper summary, should be about $0.074');
    // Chapter 6 still runs Effort's real rules and hands its selected model/effort into the story.
    await chapter('claude', 'choose');
    await page.locator('#choosePrompt').fill('Fix the typo in the README');
    assert.match(await page.locator('#chooseOut').innerText(), /Low/);
    await page.waitForTimeout(650);
    const oldAnnouncement = await page.locator('#chooseStatus').innerText();
    await page.locator('#choosePrompt').fill('Investigate an intermittent race condition in the job queue');
    assert.match(await page.locator('#chooseOut').innerText(), /High/);
    assert.equal(await page.locator('#chooseStatus').innerText(), oldAnnouncement, 'Announcement is not changed per keystroke');
    await page.waitForTimeout(650);
    assert.match(await page.locator('#chooseStatus').innerText(), /High/);
    const picked = await page.locator('[data-act="see-effort"]').evaluate(el => ({ id: el.dataset.m, level: el.dataset.v }));
    await page.locator('[data-act="see-effort"]').click();
    await page.waitForFunction(() => location.hash === '#claude-models' && window.__story?.ready);
    assert.equal(await page.locator('.cap-name').evaluate(el => el.firstChild.textContent), data.families.claude.models.find(m => m.id === picked.id).short);
    assert.equal(await page.locator('.cap .ro-name').innerText(), data.effortLevels[picked.level].label);
    await check(`${size}-chapter6-handoff`);
  }
  await context.close();
}
await browser.close();
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('smoke ok');
