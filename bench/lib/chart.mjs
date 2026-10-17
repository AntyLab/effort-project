// One SVG card per provider, laid out like a page from a lab ledger: a serif
// title, monospace figures in aligned columns, and a faint dot-grid paper.
//
// Two panels share the arm rows: pass rate with its 95% Wilson interval (which
// counts a task's repeats as fewer runs), and median tokens per run with the
// interquartile range. Each estimate is a dot and its uncertainty a band,
// forest-plot style, so the uncertainty is never hidden behind a bar. Effort's routing arms (rules or escalation) are the
// subject and carry the accent as filled dots; fixed-effort baselines are
// hollow gray markers, so shape still separates them in grayscale.
//
// The card paints its own surface: an SVG shown as an image follows the
// viewer's OS color scheme, which need not match the page around it. The
// Markdown tables in summary.md hold every number; <title> tooltips repeat them.
import { ARMS } from './plan.mjs';

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PAD = 24;
const INNER = 792;
const LABEL_RIGHT = 124;
const PASS = { x: 136, width: 240, right: 488 };
const TOKENS = { x: 524, width: 180, right: INNER };
const ROWS_TOP = 112;
const ROW = 30;

const MONO = `ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace`;
const SERIF = `"Iowan Old Style", Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif`;

const STYLE = `
  .surface { fill: #fbfaf7; stroke: rgba(27, 27, 25, 0.12); }
  .paper { fill: rgba(27, 27, 25, 0.07); }
  text { font-family: ${MONO}; fill: #1b1b19; }
  .title { font-family: ${SERIF}; font-size: 20px; letter-spacing: -0.01em; }
  .eyebrow, .heading { font-size: 10px; letter-spacing: 0.12em; fill: #55534e; }
  .badge-text { font-size: 9.5px; letter-spacing: 0.1em; fill: #55534e; }
  .badge { fill: none; stroke: #8a877f; stroke-width: 1; }
  .legend, .note { font-size: 10.5px; fill: #55534e; }
  .label { font-size: 12px; }
  .figure { font-size: 12px; font-variant-numeric: tabular-nums; }
  .count, .unknown { font-size: 11px; fill: #8a877f; font-variant-numeric: tabular-nums; }
  .tick { font-size: 10px; fill: #8a877f; font-variant-numeric: tabular-nums; }
  .grid { stroke: #e7e4db; stroke-width: 1; }
  .baseline { stroke: #c8c5bb; stroke-width: 1; }
  .reference { stroke: #55534e; stroke-width: 1; stroke-opacity: 0.55; }
  .rule { stroke: #e7e4db; stroke-width: 1; }
  .ring { fill: #fbfaf7; }
  .band-routing { fill: #2a78d6; fill-opacity: 0.22; }
  .band-fixed { fill: #6f6c66; fill-opacity: 0.2; }
  .dot-routing { fill: #2a78d6; }
  .dot-fixed { fill: #fbfaf7; stroke: #6f6c66; stroke-width: 2; }
  @media (prefers-color-scheme: dark) {
    .surface { fill: #161615; stroke: rgba(255, 255, 255, 0.1); }
    .paper { fill: rgba(255, 255, 255, 0.05); }
    text { fill: #f0efec; }
    .eyebrow, .heading, .badge-text, .legend, .note { fill: #c3c2b7; }
    .badge { stroke: #8f8c84; }
    .count, .unknown, .tick { fill: #8f8c84; }
    .grid, .rule { stroke: #2c2b28; }
    .baseline { stroke: #3a3936; }
    .reference { stroke: #c3c2b7; }
    .ring { fill: #161615; }
    .band-routing { fill: #3987e5; }
    .band-fixed { fill: #918e86; }
    .dot-routing { fill: #3987e5; }
    .dot-fixed { fill: #161615; stroke: #918e86; }
  }`;

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fixed = (value) => Number(value.toFixed(2));
const pct = (value) => `${(value * 100).toFixed(1)}%`;

export function compact(value) {
  if (value < 1_000) return String(Math.round(value));
  const [divisor, suffix] = value < 1_000_000 ? [1_000, 'K'] : [1_000_000, 'M'];
  const scaled = value / divisor;
  return `${scaled.toFixed(scaled < 10 ? 1 : 0).replace(/\.0$/, '')}${suffix}`;
}

function niceScale(value) {
  const rough = value / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough);
  const ticks = [];
  for (let index = 0; index * step <= value + step * 0.999; index++) ticks.push(index * step);
  return ticks;
}

/** Effort's routing arms: the rules pick the level, or failed checks can raise it. */
export function isRoutingArm(name) {
  const arm = ARMS[name];
  return Boolean(arm) && (arm.effort === 'auto' || (arm.maxAttempts > 1 && LEVELS.indexOf(arm.maxEffort) > LEVELS.indexOf(arm.effort)));
}

function marker(x, y, routing) {
  return `<circle class="ring" cx="${fixed(x)}" cy="${fixed(y)}" r="7.5"/><circle class="${routing ? 'dot-routing' : 'dot-fixed'}" cx="${fixed(x)}" cy="${fixed(y)}" r="${routing ? 5.5 : 4.5}"/>`;
}

function band(x0, x1, y, routing) {
  if (!(x1 > x0)) return '';
  return `<rect class="${routing ? 'band-routing' : 'band-fixed'}" x="${fixed(x0)}" y="${fixed(y - 4.5)}" width="${fixed(Math.max(x1 - x0, 9))}" height="9" rx="4.5"/>`;
}

function axis(ticks, scale, bottom, format) {
  return ticks.map((value) => {
    const x = fixed(scale(value));
    return `<line class="${value === 0 ? 'baseline' : 'grid'}" x1="${x}" y1="${ROWS_TOP - 6}" x2="${x}" y2="${bottom}"/>`
      + `<text class="tick" x="${x}" y="${bottom + 16}" text-anchor="middle">${escape(format(value))}</text>`;
  }).join('\n');
}

/** Render one provider's summary (from report.aggregate) as a standalone SVG document. */
export function renderChart(summary, { fake = false } = {}) {
  const arms = summary.arms.filter((arm) => arm.runs > 0);
  const bottom = ROWS_TOP + arms.length * ROW;
  const incomplete = arms.some((arm) => arm.tokens.n < arm.runs);
  const anyTokens = arms.some((arm) => arm.tokens.n > 0);
  const notes = [
    'Pass = hidden acceptance check on a copy of the final workspace. Dot = estimate; band = 95% CI (pass) or IQR (tokens).',
    incomplete
      ? '* Usage known for only some runs. Unknown runs are excluded from the median, never counted as zero.'
      : 'Tokens as each CLI reports them: compare arms within one provider, not across providers.',
  ];
  const innerHeight = bottom + 70;
  const width = INNER + 2 * PAD;
  const height = innerHeight + 2 * PAD;

  const passScale = (value) => PASS.x + value * PASS.width;
  const tokenTicks = anyTokens ? niceScale(Math.max(...arms.map((arm) => arm.tokens.p75 ?? arm.tokens.median ?? 0), 1)) : [];
  const tokenMax = tokenTicks.at(-1) ?? 1;
  const tokenScale = (value) => TOKENS.x + (value / tokenMax) * TOKENS.width;
  const reference = arms.find((arm) => arm.arm === summary.reference);

  const rows = arms.map((arm, index) => {
    const y = ROWS_TOP + index * ROW + ROW / 2;
    const routing = isRoutingArm(arm.arm);
    const rate = arm.passRate;
    const tokens = arm.tokens;
    const repeats = rate.runs > rate.tasks
      ? `; design effect ${rate.designEffect.toFixed(2)}${rate.basis === 'upper bound' ? ', upper bound' : ''}, ${rate.effectiveRuns.toFixed(1)} effective runs` : '';
    const passTip = `${arm.arm}: ${arm.passed}/${arm.runs} passed${repeats ? ` from ${rate.tasks} tasks` : ''}, ${pct(rate.estimate)} (95% CI ${pct(rate.lower)}–${pct(rate.upper)}${repeats})`;
    const tokenTip = tokens.n
      ? `${arm.arm}: median ${Math.round(tokens.median).toLocaleString('en-US')} tokens per run (IQR ${Math.round(tokens.p25).toLocaleString('en-US')}–${Math.round(tokens.p75).toLocaleString('en-US')}), usage known for ${tokens.n}/${arm.runs} runs`
      : `${arm.arm}: usage unknown for all ${arm.runs} runs`;
    const parts = [
      index > 0 ? `<line class="rule" x1="0" y1="${ROWS_TOP + index * ROW}" x2="${INNER}" y2="${ROWS_TOP + index * ROW}"/>` : '',
      `<text class="label" x="${LABEL_RIGHT}" y="${fixed(y + 4)}" text-anchor="end">${escape(arm.arm)}</text>`,
      `<g><title>${escape(passTip)}</title>`,
      `<rect x="${PASS.x - 8}" y="${ROWS_TOP + index * ROW}" width="${PASS.right - PASS.x + 8}" height="${ROW}" fill="transparent"/>`,
      band(passScale(rate.lower), passScale(rate.upper), y, routing),
      marker(passScale(rate.estimate), y, routing),
      `<text class="count" x="${PASS.right - 54}" y="${fixed(y + 4)}" text-anchor="end">${arm.passed}/${arm.runs}</text>`,
      `<text class="figure" x="${PASS.right}" y="${fixed(y + 4)}" text-anchor="end">${pct(rate.estimate)}</text>`,
      '</g>',
      `<g><title>${escape(tokenTip)}</title>`,
      `<rect x="${TOKENS.x - 8}" y="${ROWS_TOP + index * ROW}" width="${TOKENS.right - TOKENS.x + 8}" height="${ROW}" fill="transparent"/>`,
    ];
    if (tokens.n) {
      if (tokens.n > 1) parts.push(band(tokenScale(tokens.p25), tokenScale(tokens.p75), y, routing));
      parts.push(marker(tokenScale(tokens.median), y, routing));
      parts.push(`<text class="figure" x="${TOKENS.right}" y="${fixed(y + 4)}" text-anchor="end">${compact(tokens.median)}${tokens.n < arm.runs ? '*' : ''}</text>`);
    } else {
      parts.push(`<text class="unknown" x="${TOKENS.right}" y="${fixed(y + 4)}" text-anchor="end">unknown</text>`);
    }
    parts.push('</g>');
    return parts.join('');
  });

  const legendY = 70;
  const badge = fake ? `<rect class="badge" x="${INNER - 214}" y="2" width="214" height="20" rx="10"/><text class="badge-text" x="${INNER - 107}" y="15.5" text-anchor="middle">SYNTHETIC · FAKE PROVIDER</text>` : '';
  const description = arms.map((arm) => `${arm.arm}: ${arm.passed} of ${arm.runs} passed (${pct(arm.passRate.estimate)}); median tokens ${arm.tokens.n ? Math.round(arm.tokens.median) : 'unknown'}`).join('. ');
  const title = `${summary.provider}: pass rate and token use by arm${fake ? ' (synthetic data from the fake provider)' : ''}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-desc">
<title id="chart-title">${escape(title)}</title>
<desc id="chart-desc">${escape(description)}</desc>
<style>${STYLE}
</style>
<defs><pattern id="paper" width="12" height="12" patternUnits="userSpaceOnUse"><circle class="paper" cx="1.5" cy="1.5" r="0.75"/></pattern></defs>
<rect class="surface" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10"/>
<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="10" fill="url(#paper)"/>
<g transform="translate(${PAD} ${PAD})">
<text class="eyebrow" x="0" y="14">EFFORT BENCHMARK · ${escape(summary.provider.toUpperCase())} · ${summary.runs} SCORED RUNS</text>
${badge}
<text class="title" x="0" y="46">Pass rate and token use, by arm</text>
<circle class="dot-routing" cx="5.5" cy="${legendY - 3.5}" r="5.5"/>
<text class="legend" x="18" y="${legendY}">Effort routing (rules or escalation)</text>
<circle class="dot-fixed" cx="${fixed(268 + 5.5)}" cy="${legendY - 3.5}" r="4.5"/>
<text class="legend" x="${268 + 18}" y="${legendY}">fixed-effort baseline</text>
${reference ? `<line class="reference" x1="${452 + 3}" y1="${legendY - 10}" x2="${452 + 3}" y2="${legendY + 2}"/><text class="legend" x="${452 + 14}" y="${legendY}">reference: ${escape(reference.arm)}</text>` : ''}
<text class="heading" x="${PASS.x}" y="${ROWS_TOP - 16}">PASS RATE · HIDDEN CHECK</text>
<text class="heading" x="${TOKENS.x}" y="${ROWS_TOP - 16}">MEDIAN TOKENS PER RUN</text>
${axis([0, 0.25, 0.5, 0.75, 1], passScale, bottom, (value) => `${value * 100}%`)}
${tokenTicks.length ? axis(tokenTicks, tokenScale, bottom, compact) : `<text class="unknown" x="${TOKENS.x}" y="${bottom + 16}">no usage reported</text>`}
${reference ? `<line class="reference" x1="${fixed(passScale(reference.passRate.estimate))}" y1="${ROWS_TOP - 6}" x2="${fixed(passScale(reference.passRate.estimate))}" y2="${bottom}"/>` : ''}
${rows.join('\n')}
<line class="rule" x1="0" y1="${bottom + 30}" x2="${INNER}" y2="${bottom + 30}"/>
<text class="note" x="0" y="${bottom + 48}">${escape(notes[0])}</text>
<text class="note" x="0" y="${bottom + 64}">${escape(notes[1])}</text>
</g>
</svg>
`;
}
