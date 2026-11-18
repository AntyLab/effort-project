import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildStops, storyPosition, stopProgress, progressToStop, stopToProgress, storyScrollWeight } from '../src/story.ts';

const data = JSON.parse(fs.readFileSync(new URL('../data/models.json', import.meta.url), 'utf8'));
const storyLevels = m => m.efforts.length ? m.efforts : (m.access || []).map(a => a.id);
const storyStops = models => buildStops(models.map(m => ({...m, efforts:storyLevels(m)})));
test('Claude has four Mythos stops and keeps its effort setting empty', () => {
  const models = data.families.claude.models.slice().reverse();
  assert.equal(storyStops(models).filter(stop => models[stop.model].id === 'mythos').length, 4);
  assert.deepEqual(models.find(m => m.id === 'mythos').efforts, []);
});
for (const [name, family] of Object.entries(data.families)) {
  test(`${name}: every offered level is a stop in its own model's coordinates`, () => {
    const models = family.models.slice().reverse();
    const stops = storyStops(models);
    assert.equal(stops.length, models.reduce((n, m) => n + 1 + storyLevels(m).length, 0));
    for (const [i, stop] of stops.entries()) {
      assert.deepEqual(storyPosition(stops, i), stop);
      assert.deepEqual(storyPosition(stops, i, true), stop);
      if (stop.active) assert.ok(stop.level < storyLevels(models[stop.model]).length);
      else assert.equal(stop.level, 0);
      const next = stops[i + 1];
      if (!next) continue;
      for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const pos = storyPosition(stops, i + p);
        if (stop.model === next.model) {
          assert.equal(pos.model, stop.model, 'camera must hold while effort changes');
          assert.ok(Math.abs(pos.level - (stop.level + (next.level - stop.level) * p)) < 1e-10);
        } else {
          assert.ok(Math.abs(pos.model - (stop.model + p * p * (3 - 2 * p))) < 1e-10);
          assert.equal(pos.level, 0);
          assert.equal(pos.active, false, 'travel must not borrow another model’s levels');
        }
        assert.deepEqual(storyPosition(stops, i + p, true), stops[Math.round(i + p)], 'reduced motion uses static endpoints');
      }
    }
    assert.deepEqual(storyPosition(stops, -100), stops[0]);
    assert.deepEqual(storyPosition(stops, 1000), stops.at(-1));
  });
  test(`${name}: weighted scroll, jumps and snap points share one mapping`, () => {
    const stops = storyStops(family.models.slice().reverse());
    const points = stopProgress(stops);
    const distance = storyScrollWeight(stops);
    assert.equal(points.length, stops.length);
    assert.equal(points[0], 0);
    assert.ok(Math.abs(points.at(-1) - 1) < 1e-12);
    for (const [i, stop] of stops.entries()) {
      assert.ok(Math.abs(progressToStop(stops, points[i]) - i) < 1e-10, 'snap point resolves to its original stop');
      assert.ok(Math.abs(stopToProgress(stops, i) - points[i]) < 1e-12, 'jump targets its snap point');
      if (i === stops.length - 1) continue;
      assert.ok(Math.abs((points[i + 1] - points[i]) * distance - (stop.active ? .4 : .7)) < 1e-10, 'arrive holds for 70svh and effort for 40svh');
      for (const fraction of [.1, .5, .9]) {
        const coordinate = i + fraction;
        assert.ok(Math.abs(progressToStop(stops, stopToProgress(stops, coordinate)) - coordinate) < 1e-10, 'fractional effort/camera coordinates round-trip');
      }
    }
    assert.equal(progressToStop(stops, -2), 0);
    assert.equal(progressToStop(stops, 2), stops.length - 1);
    assert.equal(stopToProgress(stops, -2), 0);
    assert.ok(Math.abs(stopToProgress(stops, stops.length + 2) - 1) < 1e-12);
  });
}
test('weighted mapping handles empty and single-plate stories', () => {
  assert.deepEqual(stopProgress([]), []);
  const stops = buildStops([{id:'only', efforts:[]}]);
  assert.deepEqual(stopProgress(stops), [0]);
  for (const entries of [[], stops]) {
    assert.equal(storyScrollWeight(entries), 0);
    assert.equal(progressToStop(entries, .5), 0);
    assert.equal(stopToProgress(entries, 3), 0);
  }
});
test('arrive and first effort share level zero but have distinct active states', () => {
  const stops = buildStops([{id:'short', efforts:['high']}, {id:'unreleased', efforts:[]}, {id:'long', efforts:['none','medium','max']}]);
  assert.deepEqual(stops.slice(0, 3), [
    {model:0, level:0, active:false}, {model:0, level:0, active:true}, {model:1, level:0, active:false},
  ]);
  assert.equal(storyPosition(stops, 0.25).active, false);
  assert.equal(storyPosition(stops, 0.75).active, true);
  assert.deepEqual(storyPosition(stops, 2.5), {model:1.5, level:0, active:false});
});

// Exercise the ported app's data/rendering functions without starting a browser or a world.
const { default: vm } = await import('node:vm');
const { EXAMPLES, effortPick, guideModelRole } = await import('../src/choose.ts');
function appHarness() {
  const css = new Map(), classes = new Set(), rafs = new Map();
  const out = {innerHTML:'', dataset:{}, querySelectorAll:() => [], querySelector:() => null,
    getBoundingClientRect:() => ({left:0,right:390,top:65,bottom:844,width:390,height:779}),
    classList:{toggle(name, on) { on ? classes.add(name) : classes.delete(name); }},
    style:{getPropertyValue:key => css.get(key) || '', setProperty:(key, value) => css.set(key, value)},
    prepend() {}, append() {},
  };
  const matchMedia = () => ({matches:true, addEventListener() {}});
  const timers = new Map();
  let timerId = 0;
  const ctx = vm.createContext({
    DATA:data, EXAMPLES, effortPick, guideModelRole, buildStops, storyPosition,
    stopProgress, progressToStop, stopToProgress, storyScrollWeight,
    window:{matchMedia}, matchMedia, innerWidth:390, innerHeight:844,
    requestAnimationFrame:callback => { rafs.set(++timerId, callback); return timerId; }, cancelAnimationFrame:id => rafs.delete(id),
    audio:{setEnabled() {}, scene() {}, cue() {}, setSuspended() {}},
    setTimeout:(callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout:id => timers.delete(id),
    localStorage:{getItem:() => null}, gsap:{registerPlugin() {}}, ScrollTrigger:{},
    document:{getElementById:() => out, createTreeWalker:() => ({nextNode:() => null})}, NodeFilter:{SHOW_TEXT:4},
  });
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').split("document.addEventListener('click'")[0];
  vm.runInContext(source, ctx);
  return {ctx, out, timers, rafs};
}
test('all story captions and picker readouts render the offered model-level pairs', () => {
  const {ctx} = appHarness();
  for (const family of Object.keys(data.families)) {
    ctx.S.world = family;
    ctx.JR.models = data.families[family].models.slice().reverse();
    ctx.JR.stops = storyStops(ctx.JR.models);
    ctx.JR.n = ctx.JR.stops.length;
    for (const [i, stop] of ctx.JR.stops.entries()) {
      const m = ctx.JR.models[stop.model], html = ctx.capHTML(m, i);
      assert.ok(html.includes(m.short));
      assert.ok(html.includes('<p class="cap-name">'), 'caption model is text, not a chapter heading');
      assert.ok(!html.includes('aria-live'), 'scroll-driven captions must not announce every stop');
      const tier = !m.efforts.length && stop.active ? m.access?.[stop.level] : null;
      const counter = `${m.short} · ${stop.active ? `${tier ? 'access level' : 'level'} ${stop.level + 1} of ${storyLevels(m).length}` : `model ${stop.model + 1} of ${ctx.JR.models.length}`}`;
      assert.ok(html.replace(/<[^>]+>/g, '').includes(counter), 'counter is meaningful within this model/family');
      assert.ok(html.includes('data-act="story-prev"'));
      assert.ok(html.includes('data-act="story-next"'));
      assert.ok(html.includes('data-act="skip-story"'));
      assert.ok(html.includes(`aria-label="What it is for: ${m.short}"`));
      assert.ok(html.includes('aria-haspopup="dialog"'));
      assert.ok(!html.includes('data-act="present"'), 'only the header owns Present');
      assert.ok(!html.includes('NaN'), `${family} ${i}: invalid cost meter`);
      assert.equal(html.includes('story-readout'), stop.active && !tier);
      if (tier) {
        assert.ok(html.includes(tier.label));
        assert.ok(html.includes(tier.desc));
        assert.ok(!html.includes('level-pips'));
        assert.ok(!html.includes('cost-scale'));
        assert.ok(!html.includes('field-ex'));
        assert.ok(ctx.stopLabel(i).includes(tier.label));
        assert.ok(ctx.stopLabel(i).includes(`access level ${stop.level + 1} of 3`));
      } else if (stop.active) {
        const level = m.efforts[stop.level];
        assert.ok(html.includes(data.effortLevels[level].label));
        assert.ok(!html.includes(ctx.esc(m.tagline)), 'level stops reserve space for the example instead of repeating the arrival tagline');
        assert.ok(!html.includes(data.effortLevels[level].desc), 'generic level explanation belongs in details');
        assert.ok(!html.includes('ro-api'), 'API terminology belongs in details');
        for (const field of Object.keys(data.fields)) {
          ctx.S.field = field;
          const fieldCaption = ctx.capHTML(m, i);
          assert.ok(fieldCaption.includes(ctx.esc(data.fields[field].eff[level])), `${family} ${i} ${field}: selected field must supply the caption sentence`);
          assert.ok(fieldCaption.includes('field-ex'));
        }
        ctx.S.field = 'nutrition';
        assert.ok(ctx.readout(m, level).includes(data.effortLevels[level].desc), 'details retain the generic effort explanation');
        if (level === m.start) assert.ok(html.includes('Default effort'));
      } else {
        assert.ok(html.includes(ctx.esc(m.tagline)), 'arrival retains the model tagline');
        if (!m.efforts.length) assert.ok(html.includes(m.access?.length ? `${m.access.length} access levels: use Next` : 'No effort setting for this model.'));
        if (m.status !== 'available') assert.ok(!html.includes('per 1M tokens'), 'unavailable models do not show a purchasable rate');
      }
      if (m.status === 'restricted') assert.ok(html.includes('Limited access'));
      if (m.status === 'testing') assert.ok(html.includes('In testing'));
      if (m.legacy) assert.ok(html.includes('Previous generation'));
    }
    assert.ok(!ctx.chEffort().includes('id="scene"'));
    assert.ok(ctx.chEffort().includes('Show this in the story'));
    const fullNames = Object.values(data.families).flatMap(f => f.models).map(m => m.name);
    for (const render of [ctx.chModels,ctx.chEffort,ctx.chExamples,ctx.chUpgrade]) {
      const plain = ctx.plain(render());
      for (const name of fullNames) assert.ok(!plain.includes(name), `versioned display name: ${name}`);
    }
    for (const m of data.families[family].models) {
      assert.ok(ctx.priceVersion(m).includes(`Prices for ${m.name}, checked 15 Nov 2026`));
      assert.ok(!/GPT-\d|3\.8 Flash/.test(ctx.plain(`${m.tagline} ${m.note} ${m.where} ${(m.best ?? []).join(' ')}`)));
    }
  }
});
test('every family uses aligned effort slots and one cost scale in story, details and Effort picks', () => {
  const {ctx, out} = appHarness();
  for (const [family, values] of Object.entries(data.families)) {
    ctx.S.world = family;
    if (family === 'openai') assert.deepEqual(values.efforts, ['none','low','medium','high','xhigh','max','ultra']);
    for (const m of values.models) {
      const html = ctx.levelPips(m, m.start);
      const slots = Array.from(html.matchAll(/<i data-level="([^"]+)" class="([^"]*)"/g));
      assert.deepEqual(slots.map(slot => slot[1]), values.efforts, `${m.id}: positions retain family-wide meaning`);
      for (const [, level, classes] of slots) {
        assert.equal(classes.includes('unavailable'), !m.efforts.includes(level), `${m.id}: unsupported ${level} has an explicit unavailable state`);
      }
    }
    for (const level of values.efforts) {
      const html = ctx.costMeter(level);
      assert.ok(html.includes('<span>0×</span>') && html.includes('<span>1×</span>') && html.includes('<span>4×</span>'));
      assert.ok(html.includes('class="cost-one"'));
      assert.ok(html.includes('role="img"'));
      assert.ok(html.includes('Cost vs Medium'));
      const multiplier = data.effortCostMultipliersVsMedium[family][level];
      if (multiplier != null) {
        assert.ok(html.includes(`width:${multiplier / 4 * 100}%`), `${family}/${level}: shared 0–4 scale`);
        const label = multiplier > 0 && multiplier < .1 ? String(multiplier) : String(Number(multiplier.toFixed(1)));
        assert.ok(html.includes(`${label}×`));
        if (multiplier > 0) assert.ok(!html.includes('>0×</span></div><div class="meter-range"'), 'nonzero multipliers cannot display a zero value');
      }
    }
    ctx.updateChoose();
    assert.ok(out.innerHTML.includes('level-pips'));
    assert.ok(!out.innerHTML.includes('bars5'));
    assert.ok(out.innerHTML.includes(`From the ${values.label} family (change it at the top).`));
  }
});
test('chapter headings, detail links and developer setup have usable semantic structure', () => {
  const {ctx} = appHarness();
  for (const family of Object.keys(data.families)) {
    ctx.S.world = family;
    for (const render of [ctx.chModels, ctx.chEffort, ctx.chExamples, ctx.chUpgrade, ctx.chCost, ctx.chChoose]) {
      const html = render();
      assert.equal(Array.from(html.matchAll(/<h1\b/g)).length, 1, 'each chapter owns one main heading');
      assert.match(html, /<h1[^>]*tabindex="-1"/, 'chapter heading accepts focus after navigation');
    }
    const models = ctx.chModels();
    assert.match(models, /href="#all-models"[^>]*>Skip to all models/);
    assert.ok(!/<div class="cap"[^>]*aria-live/.test(models));
    for (const m of data.families[family].models) {
      assert.ok(models.includes(`${m.short}: ${ctx.SCENES[m.id]}`), `${m.id}: accessible scene description`);
    }
  }
  const choose = ctx.chChoose();
  assert.ok(choose.includes('Let Effort choose (for coding agents)'));
  assert.match(choose, /<details[^>]*><summary>How this demo works<\/summary>/);
  assert.match(choose, /href="https:\/\/github.com\/AntyLab\/effort-project">Get Effort on GitHub<\/a>/);
  assert.ok(choose.includes('npm install --global github:AntyLab/effort-project'));
  assert.ok(choose.includes('data-act="copy-install"'));
  assert.ok(!/<div[^>]*id="chooseOut"[^>]*aria-live/.test(choose));
});
test('cost display retains sub-cent precision and consistent cents', () => {
  const {ctx} = appHarness();
  assert.equal(ctx.costMoney(.2), '$0.20');
  assert.equal(ctx.costMoney(20), '$20.00');
  assert.equal(ctx.costMoney(.0025), '$0.0025');
});
test('effort radios expose one tab stop and explain unavailable options in visible text', () => {
  const {ctx} = appHarness();
  for (const [family, values] of Object.entries(data.families)) {
    ctx.S.world = family;
    for (const m of values.models.filter(m => m.status === 'available' && m.efforts.length)) {
      ctx.S.effModel[family] = m.id;
      for (const selected of m.efforts) {
        ctx.S.effLevel[family] = selected;
        const html = ctx.chEffort();
        const radios = Array.from(html.matchAll(/<button\b[^>]*role="radio"[^>]*>/g)).map(match => match[0]);
        assert.equal(radios.filter(radio => radio.includes('tabindex="0"')).length, 1, `${m.id}/${selected}: exactly one keyboard tab stop`);
        for (const radio of radios) {
          const checked = radio.includes('aria-checked="true"');
          assert.ok(radio.includes(`tabindex="${checked ? 0 : -1}"`));
          if (radio.includes(' disabled')) assert.ok(!checked);
        }
        const unavailable = values.efforts.filter(level => !m.efforts.includes(level));
        if (unavailable.length) {
          assert.match(html, /<p class="unavailable-reason">[^<]*does not offer/);
          for (const level of unavailable) assert.ok(html.includes(data.effortLevels[level].label));
        }
      }
    }
  }
});
test('cost math and chapter-6 choices retain the original behavior', () => {
  const {ctx, out} = appHarness();
  assert.equal(ctx.money(ctx.taskCost(ctx.model('opus'), 'low', data.taskPresets.paper)), '$0.085');
  assert.equal(ctx.money(ctx.taskCost(ctx.model('sonnet'), 'xhigh', data.taskPresets.paper)), '$0.074');
  for (const [prompt, level] of [['Fix the typo in the README','Low'], ['Investigate an intermittent race condition in the job queue','High']]) {
    ctx.S.prompt = prompt;
    ctx.updateChoose();
    assert.ok(out.innerHTML.includes(level));
    assert.ok(out.innerHTML.includes('data-act="see-effort"'));
  }
});
test('live Effort result announcements settle for 600ms and keep only the final result', () => {
  const {ctx, out, timers} = appHarness();
  for (const prompt of ['Fix', 'Fix the typo', 'Investigate an intermittent race condition in the job queue']) {
    ctx.S.prompt = prompt;
    ctx.updateChoose();
  }
  assert.equal(timers.size, 1, 'typing replaces the pending announcement');
  const pending = Array.from(timers.values())[0];
  assert.equal(pending.delay, 600);
  assert.equal(out.textContent, undefined, 'no announcement is written before the debounce settles');
  pending.callback();
  assert.ok(out.textContent.includes('High'));
});
test('focus survives replacement of controls and preserves input selection', () => {
  const {ctx} = appHarness();
  const control = (id, attrs = {}) => ({
    id,
    getAttribute:key => attrs[key] ?? null,
    focus() { this.focused = true; },
    setSelectionRange(start, end) { this.selection = [start, end]; },
  });
  const oldChip = control('', {'data-act':'preset', 'data-v':'paper'});
  ctx.document.activeElement = oldChip;
  const oldRoot = {contains:el => el === oldChip};
  const saved = ctx.saveFocus(oldRoot);
  const unrelatedChip = control('', {'data-act':'preset', 'data-v':'quick'});
  const replacementChip = control('', {'data-act':'preset', 'data-v':'paper'});
  ctx.restoreFocus(saved, {querySelectorAll:() => [unrelatedChip, replacementChip]});
  assert.equal(replacementChip.focused, true);
  assert.equal(unrelatedChip.focused, undefined);

  const oldInput = control('choosePrompt');
  oldInput.selectionStart = 4;
  oldInput.selectionEnd = 10;
  ctx.document.activeElement = oldInput;
  const inputFocus = ctx.saveFocus({contains:el => el === oldInput});
  const newInput = control('choosePrompt');
  ctx.document.getElementById = id => id === 'choosePrompt' ? newInput : null;
  ctx.restoreFocus(inputFocus, {});
  assert.equal(newInput.focused, true);
  assert.deepEqual(newInput.selection, [4, 10]);
});
test('chapter navigation pushes history, restores routes and focuses only a changed chapter', () => {
  const {ctx} = appHarness();
  const history = [], renders = [], scrolls = [];
  let headingFocus = 0;
  ctx.location = {hash:'#claude-models'};
  ctx.history = {
    pushState:(_state, _title, hash) => { history.push(['push', hash]); ctx.location.hash = hash; },
    replaceState:(_state, _title, hash) => { history.push(['replace', hash]); ctx.location.hash = hash; },
  };
  ctx.render = direction => renders.push(direction);
  ctx.window.scrollTo = (...args) => scrolls.push(args);
  ctx.document.querySelector = selector => selector === 'main h1' ? {focus() { headingFocus++; }} : null;

  ctx.go('effort');
  assert.deepEqual(history, [['push','#claude-effort']]);
  assert.equal(ctx.S.ch, 'effort');
  assert.deepEqual(renders, ['fwd']);
  assert.equal(headingFocus, 1);
  assert.deepEqual(scrolls, [[0, 0]]);

  ctx.go('effort');
  assert.equal(history.length, 1, 'selecting the current chapter does not add duplicate history');
  assert.equal(renders.at(-1), null, 'same-chapter changes suppress the slide animation');
  assert.equal(headingFocus, 1, 'same-chapter render does not steal control focus');
  ctx.go('models');
  assert.deepEqual(history.at(-1), ['push','#claude-models']);
  assert.equal(renders.at(-1), 'back');
  assert.equal(headingFocus, 2);

  ctx.location.hash = '#claude-effort'; // The URL state supplied by the browser's Back action.
  assert.equal(ctx.readHash(), true);
  assert.equal(ctx.S.ch, 'effort');
  assert.equal(ctx.readHash(), false, 'an already restored route is stable');
  ctx.location.hash = '#openai-cost';
  assert.equal(ctx.readHash(), true);
  assert.equal(ctx.S.world, 'openai');
  assert.equal(ctx.S.ch, 'cost');
  ctx.location.hash = '#invalid-route';
  assert.equal(ctx.readHash(), false);
  assert.equal(ctx.S.ch, 'cost', 'invalid fragments leave the current chapter intact');
  ctx.setHash(true);
  assert.deepEqual(history.at(-1), ['replace','#openai-cost']);
});
test('reduced-motion jumps stay on one screen and render only the requested static stop after fading', () => {
  const {ctx, timers} = appHarness();
  const art = {style:{opacity:'1'}, dataset:{}};
  const elements = {journey:{}, stage:{classList:{toggle() {}}}, stageArt:art};
  const captions = [], frames = [];
  ctx.document.getElementById = id => elements[id];
  ctx.window.scrollTo = () => assert.fail('reduced-motion navigation must not scroll');
  ctx.lenis = {scrollTo:() => assert.fail('reduced-motion navigation must not use Lenis')};
  ctx.updateCap = (index, buttonDriven) => captions.push([index, buttonDriven]);
  ctx.JR.models = data.families.claude.models.slice().reverse();
  ctx.JR.stops = storyStops(ctx.JR.models);
  ctx.JR.n = ctx.JR.stops.length;
  ctx.JR.displayU = 0;
  ctx.JR.eng = {frame:(position, time) => frames.push({position, time})};

  ctx.jumpTo(1, true);
  assert.equal(ctx.JR.u, 1);
  assert.equal(ctx.JR.displayU, 0, 'old art remains the current static plate until the fade midpoint');
  assert.equal(art.style.opacity, '0');
  assert.equal(frames.length, 0);
  ctx.jumpTo(3, true);
  assert.equal(timers.size, 1, 'a rapid second jump replaces the pending plate change');
  const fade = Array.from(timers.values())[0];
  assert.equal(fade.delay, 125, 'static plate switches at the midpoint of the 250ms fade');
  fade.callback();
  assert.equal(ctx.JR.u, 3);
  assert.equal(ctx.JR.displayU, 3);
  assert.equal(art.style.opacity, '1');
  assert.deepEqual(frames, [{position:storyPosition(ctx.JR.stops, 3, true), time:0}]);
  assert.deepEqual(captions, [[1,true], [3,true]], 'button navigation announces the requested stop');
});
test('directional snapping respects weighted intervals, reversals and exact jump targets', () => {
  const {ctx} = appHarness();
  for (const family of Object.values(data.families)) {
    ctx.JR.stops = storyStops(family.models.slice().reverse());
    const points = stopProgress(ctx.JR.stops);
    for (let i = 0; i < points.length - 1; i++) {
      const at = fraction => stopToProgress(ctx.JR.stops, i + fraction);
      for (const [fraction, forward, backward] of [[.1,i,i], [.2,i+1,i], [.8,i+1,i], [.9,i+1,i+1]]) {
        assert.equal(ctx.snapStoryProgress(at(fraction), {direction:1}), points[forward]);
        assert.equal(ctx.snapStoryProgress(at(fraction), {direction:-1}), points[backward]);
      }
      // A rounded scroll pixel and a previous opposite direction cannot undo a rail/Next jump.
      for (const offset of [-.001, 0, .001]) {
        for (const direction of [-1, 1]) assert.equal(ctx.snapStoryProgress(stopToProgress(ctx.JR.stops, i + offset), {direction}), points[i]);
      }
    }
    assert.equal(ctx.snapStoryProgress(1, {direction:1}), 1);
    assert.equal(ctx.snapStoryProgress(-1, {direction:-1}), 0);
  }
});

test('explicit story jumps cancel scroll snapping and finish the scrub at the requested stop', () => {
  const {ctx, out} = appHarness();
  const calls = [], frames = [];
  ctx.reduced = false;
  ctx.document.body = {classList:{contains:() => true}};
  ctx.JR.models = data.families.claude.models.slice().reverse();
  ctx.JR.stops = storyStops(ctx.JR.models); ctx.JR.n = ctx.JR.stops.length;
  ctx.JR.st = {getTween(snap) { return snap ? {kill:() => calls.push('cancel snap')} : {progress:n => calls.push(['scrub',n])}; }, animation:{progress:n => calls.push(['animation',n])}};
  const journey = {getBoundingClientRect:() => ({top:-700,height:9000})};
  ctx.document.getElementById = id => id === 'journey' ? journey : id === 'stage' ? {...out, offsetHeight:779} : out;
  ctx.window.scrollY = 700;
  ctx.lenis = {resize() {}, scrollTo:(_top, options) => calls.push(['scroll',options.immediate])};
  ctx.ScrollTrigger.update = () => calls.push('update');
  ctx.updateCap = index => calls.push(['caption',index]); ctx.syncPinned = () => {};
  ctx.performance = {now:() => 1000};
  ctx.JR.eng = {frame:(pos, time) => frames.push({pos,time})};
  ctx.jumpTo(9);
  const progress = stopToProgress(ctx.JR.stops, 9);
  assert.equal(calls[0], 'cancel snap');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'animation' && call[1] === progress));
  assert.equal(ctx.JR.progress, progress);
  assert.deepEqual(frames[0].pos, storyPosition(ctx.JR.stops,9));
  assert.equal(ctx.snapStoryProgress(progress, {direction:-1}), progress);
});

test('shell theme follows each drawn plate, including the reduced-motion fade midpoint', () => {
  const {ctx, out, timers} = appHarness();
  const events = [];
  const stage = {...out, classList:{toggle:(_name, on) => events.push(['theme',on])}};
  const art = {style:{opacity:'1'}, dataset:{}};
  ctx.document.getElementById = id => id === 'stage' ? stage : id === 'stageArt' ? art : out;
  ctx.JR.models = data.families.claude.models.slice().reverse();
  ctx.JR.stops = storyStops(ctx.JR.models); ctx.JR.n = ctx.JR.stops.length;
  const eng = {frame:pos => events.push(['frame',pos.model])}; ctx.JR.eng = eng;
  for (const value of [3, 3.1, 3.2, 4, 3.2, 3.1]) ctx.drawStoryFrame(eng, {model:value,level:0,active:false}, 1);
  assert.deepEqual(events.filter(([kind]) => kind === 'theme').map(([,on]) => on), [false,false,true,true,true,false]);
  for (let i = 0; i < events.length; i += 2) assert.equal(events[i][0], 'theme', 'theme is set in the same draw call before the scene');
  events.length = 0; ctx.updateCap = () => {};
  const mythos = ctx.JR.stops.findIndex(stop => ctx.JR.models[stop.model].id === 'mythos');
  ctx.jumpTo(mythos);
  assert.deepEqual(events, [], 'the old plate keeps its theme during the first half of the crossfade');
  [...timers.values()][0].callback();
  assert.deepEqual(events, [['theme',true],['frame',4]]);
});

test('stage clear-area measurements update with card size, hidden overlays and resize, then detach', () => {
  const {ctx, out, rafs} = appHarness();
  const rect = (left,top,width,height) => ({left,top,width,height,right:left+width,bottom:top+height});
  let stageBounds = rect(0,65,390,779), capBounds = rect(8,666,374,170);
  const controls = {hidden:false,getBoundingClientRect:() => rect(12,73,240,44)};
  const cap = {getBoundingClientRect:() => capBounds};
  const rail = {getBoundingClientRect:() => rect(330,200,54,244)};
  const stage = {...out,getBoundingClientRect:() => stageBounds,querySelector:() => controls};
  ctx.stageControls = controls;
  ctx.document.getElementById = id => ({stage,cap,rail})[id];
  let observerCallback, disconnected = 0;
  const observed = [];
  ctx.ResizeObserver = class { constructor(callback) { observerCallback = callback; } observe(el) { observed.push(el); } disconnect() { disconnected++; } };
  ctx.observeStageLayout();
  assert.deepEqual(observed,[stage,cap,rail,controls]);
  const css = edge => out.style.getPropertyValue('--clear-'+edge);
  assert.equal(css('top'),'60px'); assert.equal(css('bottom'),'186px'); assert.equal(css('right'),'68px');
  capBounds = rect(8,716,374,120);
  observerCallback(); observerCallback();
  assert.equal(rafs.size,1,'layout notifications coalesce into one measurement');
  const flush = () => { const callbacks=[...rafs.values()]; rafs.clear(); callbacks.forEach(callback => callback()); };
  flush(); assert.equal(css('bottom'),'136px');
  controls.hidden=true; rail.getBoundingClientRect=() => rect(0,0,0,0);
  observerCallback(); flush(); assert.equal(css('top'),'0px'); assert.equal(css('right'),'0px');
  stageBounds=rect(0,65,844,325); capBounds=rect(8,270,400,112);
  observerCallback(); flush(); assert.equal(css('bottom'),'128px');
  ctx.document.body={append() {}};
  ctx.queueStageClearArea(); assert.equal(rafs.size,1);
  ctx.stopJourney();
  assert.equal(disconnected,1); assert.equal(rafs.size,0); assert.equal(ctx.JR.layoutObserver,null);
});

test('playback controls stay with the stage and hide off screen, after Skip, and on text chapters', () => {
  const {ctx} = appHarness();
  let bounds={top:65,bottom:844}, owner;
  const stage={getBoundingClientRect:() => bounds,prepend:el => { owner='stage'; assert.equal(el,ctx.stageControls); }};
  ctx.document.body={append:el => { owner='body'; assert.equal(el,ctx.stageControls); }};
  let hasStage=true;
  ctx.document.getElementById=id => id==='stage' && hasStage ? stage : null;
  ctx.stageControls={hidden:true};
  ctx.attachStageControls(); assert.equal(owner,'stage'); assert.equal(ctx.stageControls.hidden,false);
  for (const box of [{top:900,bottom:1679},{top:-780,bottom:0}]) {
    bounds=box; ctx.syncStageControls(); assert.equal(ctx.stageControls.hidden,true);
  }
  bounds={top:65,bottom:844}; ctx.syncStageControls(); assert.equal(ctx.stageControls.hidden,false);
  ctx.JR.skipped=true; ctx.syncStageControls(); assert.equal(ctx.stageControls.hidden,true);
  ctx.JR.skipped=false; ctx.S.ch='effort'; hasStage=false;
  ctx.attachStageControls(); assert.equal(owner,'body'); assert.equal(ctx.stageControls.hidden,true);
  ctx.S.ch='models'; hasStage=true;
  ctx.attachStageControls(); assert.equal(owner,'stage'); assert.equal(ctx.stageControls.hidden,false);
});

test('opening details pauses smooth scrolling and makes background inert until focus returns', () => {
  const {ctx} = appHarness();
  const calls = [];
  const opener = {isConnected:true, focus() { calls.push('opener-focus'); }};
  const close = {focus() { calls.push('close-focus'); }};
  const sheet = {hidden:true, querySelector:selector => selector === '.sheet-x' ? close : null};
  const elements = {sheet, sheetBody:{innerHTML:''}, main:{inert:false}};
  const header = {inert:false};
  const fallback = {focus() { calls.push('fallback-focus'); }};
  ctx.document.activeElement = opener;
  ctx.document.getElementById = id => elements[id];
  ctx.document.querySelector = selector => selector === '.top' ? header : selector === '#cap button:not(:disabled)' ? fallback : null;
  ctx.lenis = {stop() { calls.push('stop'); }, start() { calls.push('start'); }};

  ctx.openSheet('opus');
  assert.equal(sheet.hidden, false);
  assert.equal(elements.main.inert, true);
  assert.equal(header.inert, true);
  assert.ok(elements.sheetBody.innerHTML.includes('id="sheetTitle"'));
  assert.deepEqual(calls, ['stop','close-focus']);
  ctx.closeSheet();
  assert.equal(sheet.hidden, true);
  assert.equal(elements.main.inert, false);
  assert.equal(header.inert, false);
  assert.deepEqual(calls.slice(-2), ['start','opener-focus']);
  ctx.closeSheet();
  assert.equal(calls.length, 4, 'closing an already closed sheet has no extra effects');

  ctx.openSheet('opus');
  opener.isConnected = false;
  ctx.closeSheet();
  assert.deepEqual(calls.slice(-2), ['start','fallback-focus'], 'removed opener falls back to an available story control');
});
test('story keyboard navigation maps supported keys to exact stops only while the stage is visible', () => {
  const {ctx} = appHarness();
  const jumps = [];
  let rect = {top:64, bottom:844};
  const sheet = {hidden:true};
  const stage = {getBoundingClientRect:() => rect};
  ctx.document.getElementById = id => id === 'stage' ? stage : id === 'sheet' ? sheet : null;
  ctx.document.body = {classList:{contains:() => false}};
  ctx.JR.idx = 5;
  ctx.JR.n = 25;
  ctx.jumpTo = (...args) => jumps.push(args);
  const ordinaryTarget = {tagName:'DIV', isContentEditable:false, closest:() => null};
  const press = (key, extra = {}) => {
    let prevented = false;
    const event = {key, code:key === ' ' ? 'Space' : key, target:ordinaryTarget,
      ctrlKey:false, metaKey:false, altKey:false, shiftKey:false,
      preventDefault() { prevented = true; }, ...extra};
    const before = jumps.length;
    const handled = ctx.handleStoryKey(event);
    return {handled, prevented, calls:jumps.slice(before)};
  };
  for (const [key, expected] of [
    ['ArrowRight',6], ['ArrowDown',6], ['PageDown',6], [' ',6],
    ['ArrowLeft',4], ['ArrowUp',4], ['PageUp',4], ['Home',0], ['End',24],
  ]) {
    const result = press(key);
    assert.equal(result.prevented, true, `${key}: stop navigation consumes page scrolling`);
    assert.deepEqual(result.calls, [[expected,true]], `${key}: immediate jump targets the expected stop`);
  }
  const assertIgnored = (key, extra = {}) => {
    const result = press(key, extra);
    assert.equal(result.handled, false, `${key}: ignored input falls through`);
    assert.equal(result.prevented, false, `${key}: ignored input retains its native behavior`);
    assert.deepEqual(result.calls, []);
  };
  for (const selector of ['button','a','summary','[role=radio]','[role=tab]']) {
    const target = {tagName:'BUTTON', closest:query => query.includes('button,a,summary') ? {matches:selector} : null};
    assertIgnored(' ', {target});
    assertIgnored('Enter', {target});
  }
  ctx.JR.idx = 0;
  for (const key of ['ArrowUp','PageUp','Home']) assertIgnored(key);
  ctx.JR.idx = ctx.JR.n - 1;
  for (const key of ['ArrowDown','PageDown',' ','End']) assertIgnored(key);
  ctx.JR.idx = 5;
  ctx.JR.skipped = true;
  for (const key of ['ArrowDown','ArrowUp','Home','End',' ']) assertIgnored(key);
  ctx.JR.skipped = false;
  assertIgnored('a');
  assertIgnored('Tab');
  assertIgnored('ArrowRight', {defaultPrevented:true});
  assertIgnored('ArrowRight', {repeat:true});
  for (const modifier of ['ctrlKey','metaKey','altKey','shiftKey']) assertIgnored('ArrowRight', {[modifier]:true});
  for (const tagName of ['INPUT','TEXTAREA','SELECT']) {
    assertIgnored('ArrowRight', {target:{tagName, isContentEditable:false, closest:() => ({})}});
  }
  assertIgnored(' ', {target:{tagName:'DIV', isContentEditable:true, closest:() => ({})}});
  ctx.document.activeElement = {isContentEditable:true};
  assertIgnored('ArrowRight');
  ctx.document.activeElement = null;
  sheet.hidden = false;
  assertIgnored('ArrowRight');
  sheet.hidden = true;
  ctx.S.ch = 'effort';
  assertIgnored('ArrowRight');
  ctx.S.ch = 'models';
  rect = {top:900, bottom:1700};
  assertIgnored('ArrowRight');
  rect = {top:-900, bottom:-1};
  assertIgnored('ArrowRight');
});

function presentationHarness() {
  const harness = appHarness(), {ctx} = harness;
  const classes = new Set(['header-expanded']);
  const calls = [], queued = [];
  const controls = [0].map(() => ({
    attrs:{}, textContent:'Present',
    setAttribute(key, value) { this.attrs[key] = value; },
    focus() { calls.push('present-focus'); },
  }));
  const opener = {isConnected:true, focus() { calls.push('opener-focus'); }};
  ctx.document.body = {classList:{
    contains:key => classes.has(key),
    add:(...keys) => keys.forEach(key => classes.add(key)),
    remove:(...keys) => keys.forEach(key => classes.delete(key)),
  }};
  ctx.document.activeElement = opener;
  ctx.document.documentElement = {requestFullscreen() { calls.push('request-fullscreen'); return Promise.resolve(); }};
  ctx.document.fullscreenElement = null;
  ctx.document.exitFullscreen = () => { calls.push('exit-fullscreen'); ctx.document.fullscreenElement = null; return Promise.resolve(); };
  ctx.document.querySelectorAll = selector => selector === '[data-act="present"]' ? controls : [];
  const next = {focus() { calls.push('next-focus'); }};
  ctx.document.querySelector = selector => selector.includes('story-next') ? next : null;
  ctx.setHdr = () => { ctx.JR.hdr = classes.has('presenting') ? 0 : 128; calls.push('header-geometry'); };
  const actualQueue = ctx.queuePresentationLayout;
  ctx.queuePresentationLayout = index => queued.push(index);
  ctx.requestAnimationFrame = callback => callback();
  ctx.JR.idx = 7;
  ctx.JR.n = 25;
  return {...harness, classes, calls, queued, controls, actualQueue};
}
test('presentation has a window-sized URL mode, opt-in fullscreen and reversible cursor/focus state', async () => {
  const {ctx, timers, classes, calls, queued, controls} = presentationHarness();
  ctx.enterPresentation(false);
  assert.equal(classes.has('presenting'), true);
  assert.equal(classes.has('header-expanded'), false);
  assert.equal(calls.includes('request-fullscreen'), false, 'URL mode never asks the browser for fullscreen');
  assert.equal(ctx.JR.hdr, 0);
  assert.deepEqual(queued, [7], 'presentation retains the selected story stop');
  for (const button of controls) {
    assert.equal(button.textContent, 'Exit');
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert.equal(button.attrs['aria-label'], 'Exit presentation');
  }
  ctx.resetPresentationCursor();
  assert.equal(timers.size, 1, 'pointer activity replaces the idle timer');
  const idle = Array.from(timers.values())[0];
  assert.equal(idle.delay, 3000);
  idle.callback();
  assert.equal(classes.has('cursor-idle'), true);
  ctx.resetPresentationCursor();
  assert.equal(classes.has('cursor-idle'), false, 'pointer activity reveals the cursor immediately');
  ctx.leavePresentation(false);
  assert.equal(classes.has('presenting'), false);
  assert.equal(classes.has('cursor-idle'), false);
  assert.equal(timers.size, 0);
  assert.equal(ctx.JR.hdr, 128, 'leaving restores normal header geometry');
  assert.deepEqual(queued, [7,7]);
  assert.equal(calls.at(-1), 'opener-focus');
  assert.equal(calls.includes('exit-fullscreen'), false);
  for (const button of controls) assert.equal(button.attrs['aria-pressed'], 'false');
  idle.callback();
  assert.equal(classes.has('cursor-idle'), false, 'a stale timer cannot hide the cursor outside presentation');

  ctx.enterPresentation(true);
  await Promise.resolve();
  assert.equal(calls.filter(call => call === 'request-fullscreen').length, 1);
  ctx.document.fullscreenElement = ctx.document.documentElement;
  ctx.syncFullscreen();
  assert.equal(classes.has('presenting'), true, 'entering browser fullscreen retains presentation');
  ctx.document.fullscreenElement = null;
  ctx.syncFullscreen();
  assert.equal(classes.has('presenting'), false, 'browser fullscreen exit also leaves presentation');
  assert.equal(calls.filter(call => call === 'exit-fullscreen').length, 0, 'fullscreenchange cleanup does not request fullscreen exit again');
  ctx.enterPresentation(true);
  await Promise.resolve();
  ctx.document.fullscreenElement = ctx.document.documentElement;
  ctx.leavePresentation();
  assert.equal(calls.filter(call => call === 'exit-fullscreen').length, 1, 'the Exit control leaves browser fullscreen');
});
test('presentation layout refresh restores the same stop after geometry changes and ignores stale queued work', () => {
  const {ctx, classes} = presentationHarness();
  const calls = [];
  ctx.setHdr = () => { ctx.JR.hdr = 64; calls.push('header'); };
  ctx.lenis = {resize() { calls.push('resize'); }};
  ctx.ScrollTrigger.refresh = () => calls.push('refresh');
  ctx.jumpTo = (index, immediate) => calls.push(['jump',index,immediate]);
  ctx.document.getElementById = id => id === 'journey' ? {getBoundingClientRect:() => ({top:100})} : null;
  ctx.window.scrollY = 400;
  ctx.window.scrollTo = options => calls.push(['scroll', options.top]);
  ctx.syncPinned = () => calls.push('pinned');
  ctx.refreshPresentationLayout(7);
  assert.deepEqual(calls, ['header','resize','refresh',['jump',7,true],['scroll',436],'pinned']);
  calls.length = 0;
  ctx.reduced = false;
  ctx.refreshPresentationLayout(99);
  assert.deepEqual(calls, ['header','resize','refresh',['jump',24,true]], 'normal motion restores weighted story position through the immediate jump');

  const {ctx:queuedCtx, classes:queuedClasses, actualQueue} = presentationHarness();
  const frames = [], refreshed = [];
  queuedCtx.requestAnimationFrame = callback => frames.push(callback);
  // Use the actual queue helper rather than the lifecycle harness's deterministic recorder.
  queuedCtx.queuePresentationLayout = actualQueue;
  queuedCtx.refreshPresentationLayout = index => refreshed.push(index);
  queuedClasses.add('presenting');
  queuedCtx.queuePresentationLayout(7);
  queuedClasses.delete('presenting');
  frames.shift()();
  assert.deepEqual(refreshed, [], 'an enter callback cannot run after the visitor has left');
  queuedCtx.queuePresentationLayout(7);
  frames.shift()();
  assert.deepEqual(refreshed, [7]);
  assert.equal(classes.has('presenting'), false);
});
test('present query initialization avoids fullscreen and Escape uses the presentation cleanup path', () => {
  const {ctx, classes, calls} = presentationHarness();
  const source = fs.readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  ctx.URLSearchParams = URLSearchParams;
  const entries = [];
  const originalEnter = ctx.enterPresentation;
  ctx.enterPresentation = requestFullscreen => entries.push(requestFullscreen);
  for (const search of ['', '?present=0', '?other=1']) {
    ctx.location = {search};
    ctx.initializePresentation();
  }
  assert.deepEqual(entries, []);
  ctx.location = {search:'?present=1'};
  ctx.initializePresentation();
  assert.deepEqual(entries, [false]);
  ctx.readHash = () => {};
  ctx.setHash = () => {};
  ctx.render = () => {};
  ctx.initializeSound = () => {};
  vm.runInContext(source.slice(source.lastIndexOf('\nreadHash();')), ctx);
  assert.deepEqual(entries, [false,false], 'normal startup invokes URL presentation after the initial render');
  ctx.enterPresentation = originalEnter;

  const events = {};
  ctx.document.addEventListener = (name, callback) => { events[name] = callback; };
  ctx.window.addEventListener = () => {};
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('click'"), source.lastIndexOf('\nreadHash();')), ctx);
  const sheet = {hidden:false};
  ctx.document.getElementById = id => id === 'sheet' ? sheet : null;
  ctx.closeSheet = () => { calls.push('close-sheet'); sheet.hidden = true; };
  ctx.enterPresentation(false);
  assert.ok(calls.includes('next-focus'), 'URL presentation focuses Next');
  let sheetPrevented = false;
  events.keydown({key:'Escape', preventDefault() { sheetPrevented = true; }});
  assert.equal(sheetPrevented, true);
  assert.equal(sheet.hidden, true);
  assert.equal(classes.has('presenting'), true, 'sheet Escape must leave presentation open');
  let prevented = false;
  events.keydown({key:'Escape', preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(classes.has('presenting'), false);
  assert.ok(calls.includes('close-sheet'));
  assert.equal(calls.at(-1), 'opener-focus');
  classes.add('header-expanded');
  const menu = {attrs:{}, setAttribute(key, value) { this.attrs[key] = value; }, focus() { calls.push('menu-focus'); }};
  ctx.document.getElementById = id => id === 'sheet' ? sheet : id === 'headerMenu' ? menu : null;
  events.keydown({key:'Escape', preventDefault() {}});
  assert.equal(classes.has('header-expanded'), false, 'Escape closes the phone chapter menu');
  assert.equal(menu.attrs['aria-expanded'], 'false');
  assert.equal(calls.at(-1), 'menu-focus');
  assert.equal(events.fullscreenchange, ctx.syncFullscreen);
});
test('desktop layout wrappers preserve chapter content and the header owns the only Present control', () => {
  const {ctx} = appHarness();
  for (const [render, wrapper, content] of [
    [ctx.chCost,'cost-grid','Estimate one task'],
    [ctx.chUpgrade,'upgrade-grid','Match the symptom to the fix'],
    [ctx.chChoose,'choose-grid','Type a coding task, or try an example'],
  ]) {
    const html = render();
    assert.match(html, new RegExp(`class="[^"]*\\b${wrapper}\\b`));
    assert.ok(html.includes(content), `${wrapper}: existing phone content remains present`);
  }
  assert.deepEqual(Array.from(ctx.CH, chapter => chapter.label), ['Models','Effort','Examples','Model vs effort','Cost','Try Effort']);
  ctx.JR.models = data.families.claude.models.slice().reverse();
  ctx.JR.stops = storyStops(ctx.JR.models);
  ctx.JR.n = ctx.JR.stops.length;
  const caption = ctx.capHTML(ctx.JR.models[0], 0);
  assert.ok(!caption.includes('data-act="present"'));
  assert.ok(caption.includes('What it is for') && caption.includes('Skip story'));
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<button[^>]*class="present-button"[^>]*data-act="present"/);
});

test('pause freezes the nearest story plate without changing reduced motion, navigation or layout', () => {
  for (const preference of [false, true]) {
    const {ctx} = appHarness();
    const classes = new Set(), frames = [];
    const button = {textContent:'Pause motion', attrs:{'aria-pressed':'false'},
      setAttribute(key, value) { this.attrs[key] = value; }};
    ctx.document.body = {classList:{toggle(key, enabled) { enabled ? classes.add(key) : classes.delete(key); }}};
    ctx.document.querySelector = selector => selector === '[data-act="motion"]' ? button : null;
    ctx.document.activeElement = button;
    ctx.reduced = preference;
    ctx.JR.models = data.families.claude.models.slice().reverse();
    ctx.JR.stops = storyStops(ctx.JR.models);
    ctx.JR.u = 2.7;
    ctx.JR.progress = .4;
    const scrollTrigger = {};
    ctx.JR.st = scrollTrigger;
    ctx.JR.eng = {frame(position, time) { frames.push({position, time}); }};
    ctx.journeyU = () => 2.7;
    ctx.renderMain = () => assert.fail('pause must not rebuild the story');
    ctx.syncMotion = () => assert.fail('pause must not change scrolling infrastructure');

    ctx.toggleMotion();
    assert.equal(ctx.motionPaused, true);
    assert.equal(classes.has('motion-paused'), true);
    assert.equal(button.textContent, 'Play motion');
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert.deepEqual(frames, [{position:storyPosition(ctx.JR.stops, 3, true), time:0}], 'pause draws the nearest static stop at time zero');
    assert.equal(ctx.reduced, preference, 'pause preserves the operating-system preference');
    assert.equal(ctx.JR.u, 2.7);
    assert.equal(ctx.JR.progress, .4);
    assert.equal(ctx.JR.st, scrollTrigger, 'the existing story scroll geometry survives');
    assert.equal(ctx.document.activeElement, button, 'the toggle retains focus');

    ctx.toggleMotion();
    assert.equal(ctx.motionPaused, false);
    assert.equal(classes.has('motion-paused'), false);
    assert.equal(button.textContent, 'Pause motion');
    assert.equal(button.attrs['aria-pressed'], 'false');
    assert.equal(ctx.reduced, preference);
    assert.equal(ctx.JR.st, scrollTrigger);
    assert.equal(frames.length, 1, 'resume leaves the next animated frame to the running scene');
  }
});

test('Mythos access stops reach the world, test hook, details and accessible status', async () => {
  const {ctx, out} = appHarness();
  ctx.document.body = {classList:{contains:() => false}};
  ctx.document.querySelectorAll = () => [];
  ctx.setHdr = () => {};
  ctx.updateCap = () => {};
  let opts;
  ctx.loadWorld = (_family, _el, options) => { opts = options; return Promise.resolve(null); };
  ctx.startJourney();
  const mythos = data.families.claude.models.find(m => m.id === 'mythos');
  assert.deepEqual(Array.from(opts.models.find(m => m.id === 'mythos').efforts), mythos.access.map(a => a.id));
  const stops = ctx.window.__story.stops.filter(s => s.id === 'mythos');
  assert.equal(stops.length, 4);
  assert.deepEqual(Array.from(stops, s => s.effort), [null, 'defense', 'redteam', 'specialized']);
  assert.deepEqual(mythos.efforts, [], 'story levels do not mutate source effort settings');
  assert.ok(!ctx.chEffort().includes('data-v="mythos"'));
  ctx.reduced = false;
  const arrive = ctx.JR.stops.findIndex(s => ctx.JR.models[s.model].id === 'mythos');
  assert.ok(ctx.capHTML(mythos, arrive).includes('3 access levels: keep scrolling'));
  const elements = {sheetBody:{innerHTML:''}, sheet:{querySelector:() => null}, main:{}};
  ctx.document.getElementById = id => elements[id] || out;
  ctx.document.querySelector = () => ({});
  for (const [index, tier] of mythos.access.entries()) {
    ctx.JR.idx = arrive + index + 1;
    ctx.openSheet('mythos');
    const html = elements.sheetBody.innerHTML;
    assert.ok(html.includes(tier.label) && html.includes(tier.desc));
    for (const extra of ['level-pips', 'cost-scale', 'field-ex', 'ro-api']) assert.ok(!html.includes(extra));
    ctx.announceStop();
    assert.ok(out.textContent.includes(tier.label));
  }
});

test('sound follows visible story lifecycle and static plates discard world cues', () => {
  const {ctx, out} = appHarness();
  const scenes = [], cues = [], suspension = [];
  ctx.audio = {scene:name => scenes.push(name), cue:name => cues.push(name), setSuspended:on => suspension.push(on)};
  let rect = {top:128, bottom:844};
  const art = {dataset:{}};
  ctx.document.getElementById = id => id === 'stage' ? {getBoundingClientRect:() => rect, classList:{toggle() {}}} : id === 'stageArt' ? art : out;
  const frames = [];
  let drained = 0;
  const eng = {frame:(pos, time) => frames.push({pos, time}), cues:() => { drained++; return ['croak','plop']; }};
  ctx.JR.eng = eng; ctx.JR.seen = true;
  ctx.JR.models = data.families.claude.models.slice().reverse();
  ctx.syncAudio();
  assert.equal(suspension.at(-1), false, 'a visible story permits beds even with reduced motion');
  ctx.drawStoryFrame(eng, {model:0}, 0);
  assert.equal(art.dataset.drawn, 'true', 'canvas stays covered until the first frame completes');
  assert.deepEqual(scenes, ['sky']);
  assert.deepEqual(cues, []);
  ctx.reduced = false;
  ctx.drawStoryFrame(eng, {model:0}, 1);
  assert.deepEqual(scenes, ['sky'], 'the frame loop changes beds only when the rounded model changes');
  assert.deepEqual(cues, ['croak','plop']);
  for (const [position, bed] of [[1,'tower'], [2,'pond'], [3,'meadow'], [4,'night']]) {
    ctx.drawStoryFrame(eng, {model:position}, 0);
    assert.equal(scenes.at(-1), bed);
  }
  ctx.S.world = 'openai'; ctx.drawStoryFrame(eng, {model:0}, 0); assert.equal(scenes.at(-1), 'space');
  ctx.S.world = 'gemini'; ctx.drawStoryFrame(eng, {model:0}, 0); assert.equal(scenes.at(-1), 'hum');
  assert.equal(drained, frames.length, 'all frames drain cues, including static plates');
  for (const deactivate of [
    () => { ctx.document.hidden = true; },
    () => { ctx.motionPaused = true; },
    () => { ctx.S.ch = 'effort'; },
    () => { ctx.JR.seen = false; },
    () => { rect = {top:900, bottom:1700}; },
    () => { ctx.JR.skipped = true; },
    () => { ctx.JR.eng = null; },
  ]) {
    ctx.document.hidden = false; ctx.motionPaused = false; ctx.S.ch = 'models'; ctx.JR.seen = true; ctx.JR.skipped = false; ctx.JR.eng = eng; rect = {top:128,bottom:844};
    deactivate(); ctx.syncAudio(); assert.equal(suspension.at(-1), true);
  }
  let destroyed = false;
  ctx.JR.eng = {destroy() { destroyed = true; }};
  ctx.stopJourney();
  assert.equal(destroyed, true);
  assert.equal(suspension.at(-1), true);
  assert.equal(scenes.at(-1), null, 'destroy and family-switch teardown clear the bed');
});

test('saved sound waits for a gesture and storage failures do not break the control', () => {
  const {ctx} = appHarness();
  const calls = [];
  const motion = {before:() => {}}, controls = {append:() => {}}, button = {dataset:{}, attrs:{}, setAttribute(key, value) { this.attrs[key] = value; }};
  const listeners = new Map();
  ctx.document.querySelector = selector => selector.includes('motion') ? motion : button;
  ctx.document.createElement = tag => tag === 'div' ? controls : button;
  ctx.document.addEventListener = (name, handler) => listeners.set(name, handler);
  ctx.document.removeEventListener = name => listeners.delete(name);
  ctx.audio.setEnabled = on => calls.push(on);
  ctx.localStorage.setItem = () => { throw new Error('Storage denied'); };
  ctx.soundEnabled = true;
  ctx.initializeSound();
  assert.deepEqual(calls, [], 'restoring on does not activate audio at startup');
  assert.equal(button.textContent, 'Mute sound');
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.ok(listeners.has('pointerdown') && listeners.has('keydown'));
  listeners.get('pointerdown')({target:{closest:() => button}});
  assert.deepEqual(calls, [], 'clicking Sound off must not briefly activate saved audio');
  listeners.get('keydown')({target:{closest:() => null}});
  assert.deepEqual(calls, [true]);
  assert.ok(!listeners.has('pointerdown') && !listeners.has('keydown'));
  ctx.toggleSound();
  assert.deepEqual(calls, [true,false]);
  assert.equal(button.textContent, 'Play sound');
  assert.equal(button.attrs['aria-pressed'], 'false');
  ctx.toggleSound();
  assert.deepEqual(calls, [true,false,true]);
});

// Mock the Web Audio boundary; no browser, speaker output or audio assets are required.
const { stripTypeScriptTypes } = await import('node:module');
function audioHarness() {
  const fetched = [], decoded = [], sources = [], gains = [], warnings = [], contexts = [];
  const param = () => ({value:0, ramps:[], cancelAndHoldAtTime() {}, linearRampToValueAtTime(value, time) { this.value = value; this.ramps.push([value,time]); }});
  class AudioContext {
    constructor() { this.currentTime = 10; this.destination = {}; contexts.push(this); }
    resume() { return Promise.resolve(); }
    createGain() { const node = {gain:param(), connect() {}, disconnect() {}}; gains.push(node); return node; }
    createBufferSource() {
      const source = {playbackRate:{value:1}, connect() {}, disconnect() {}, start() { this.started = true; }, stop(time) { this.stopped = time ?? true; }};
      sources.push(source); return source;
    }
    async decodeAudioData(bytes) { decoded.push(bytes.name); if (bytes.name === 'crackle') throw new Error('Bad clip'); return bytes; }
  }
  const ctx = vm.createContext({
    window:{AudioContext}, AbortController,
    console:{warn:message => warnings.push(message), error:() => assert.fail('optional audio cannot log errors')},
    fetch:async (url, options) => {
      const name = url.split('/').at(-1).replace('.mp3',''); fetched.push({name, signal:options.signal});
      return {ok:name !== 'hum', arrayBuffer:async () => ({name})};
    },
  });
  const source = fs.readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const js = stripTypeScriptTypes(source)
    .replace(/^export /gm, '').replaceAll('import.meta.env.BASE_URL', "'/'");
  vm.runInContext(js, ctx);
  return {ctx, fetched, decoded, sources, gains, warnings, contexts};
}
async function settleAudio() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

test('Web Audio loads lazily, caches clips, crossfades beds and ducks all voices', async () => {
  const {ctx, fetched, sources, gains, contexts} = audioHarness();
  ctx.scene('sky'); ctx.setSuspended(false); await ctx.cue('croak');
  assert.equal(contexts.length, 0); assert.equal(fetched.length, 0);
  ctx.setEnabled(true); await settleAudio();
  assert.equal(contexts.length, 1);
  assert.deepEqual(fetched.map(file => file.name), ['sky']);
  assert.equal(sources[0].loop, true);
  assert.deepEqual(gains[1].gain.ramps.at(-1), [.5,11.2]);
  ctx.scene('tower'); await settleAudio();
  assert.equal(sources[0].stopped, 11.2);
  assert.deepEqual(gains[1].gain.ramps.at(-1), [0,11.2]);
  assert.deepEqual(gains[2].gain.ramps.at(-1), [.5,11.2]);
  await ctx.cue('croak'); await ctx.cue('croak');
  assert.equal(fetched.filter(file => file.name === 'croak').length, 1);
  assert.equal(sources.length, 3, 'a repeat of the same one-shot inside its gap is dropped');
  assert.ok(sources[2].playbackRate.value >= .84 && sources[2].playbackRate.value <= 1.16);
  assert.ok(gains.at(-1).gain.value >= .38 * .75 && gains.at(-1).gain.value <= .38);
  ctx.setSuspended(true); ctx.scene('pond'); await ctx.cue('plop'); await settleAudio();
  assert.equal(gains[0].gain.value, 0);
  assert.deepEqual(fetched.map(file => file.name), ['sky','tower','croak']);
  assert.ok(sources.slice(2).every(source => source.stopped), 'suspending stops in-flight one-shots');
  ctx.setSuspended(false); await settleAudio();
  assert.equal(fetched.at(-1).name, 'pond');
  ctx.scene(null);
  assert.ok(sources.filter(source => source.loop).every(source => source.stopped === true), 'teardown clears current and fading beds before another family can unmute them');
  ctx.setEnabled(false); await ctx.cue('plop');
  assert.equal(fetched.at(-1).name, 'pond');
  assert.equal(gains[0].gain.value, 0);
  ctx.setEnabled(true); ctx.scene('sky'); await settleAudio();
  assert.equal(contexts.length, 1);
  assert.equal(fetched.filter(file => file.name === 'sky').length, 1, 'decoded beds are reused');
});

test('missing or undecodable audio is silent, warns once, and cannot start after disabling', async () => {
  const {ctx, fetched, decoded, sources, warnings} = audioHarness();
  ctx.setEnabled(true); ctx.setSuspended(false);
  for (let i = 0; i < 3; i++) {
    ctx.scene('hum'); await settleAudio(); ctx.scene(null);
    await ctx.cue('crackle');
  }
  assert.equal(warnings.length, 2);
  assert.deepEqual(fetched.map(file => file.name), ['hum','crackle']);
  assert.equal(sources.length, 0);
  let release;
  ctx.fetch = () => new Promise(resolve => { release = resolve; });
  ctx.scene('pond');
  ctx.setEnabled(false);
  release({ok:true, arrayBuffer:async () => ({name:'pond'})});
  await settleAudio();
  assert.deepEqual(decoded, ['crackle'], 'disabling during fetch prevents decode');
  assert.equal(sources.length, 0, 'a stale response cannot start playback');
});
