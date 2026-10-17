import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT_BYTES, promptAdvice, runPromptHook } from '../src/integrations/claude-code-hook.mjs';
import { toolDefinitions } from '../src/mcp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hookEntry = join(root, 'hooks', 'prompt-advice.mjs');
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const RACE = 'Investigate the intermittent race condition in the auth token refresh';
const TYPO = 'Fix a typo in the README heading';
const PLAIN = 'Add a settings page with a dark mode toggle';
const message = (suggested, current) => `Effort suggests ${suggested} for this prompt (you're on ${current}). Apply with /effort ${suggested}`;
const RAISE = "Effort suggests high for this prompt. If you're on a lower level, apply it with /effort high";
const LOWER = "Effort suggests low for this prompt. If you're on a higher level, apply it with /effort low";

// The payload shape from https://code.claude.com/docs/en/hooks#userpromptsubmit-input
const hookEvent = (prompt, cwd, extra = {}) => ({
  session_id: '00893aaf-19fa-41d2-8238-13269b9b3ca0',
  prompt_id: '6c1f4d52-8f0e-4a9b-b2d4-3e7a1c9f5b20',
  transcript_path: join(tmpdir(), 'effort-plugin-test', 'session.jsonl'),
  cwd, permission_mode: 'default', hook_event_name: 'UserPromptSubmit', prompt, ...extra,
});

async function tempProject(t) {
  const dir = await mkdtemp(join(tmpdir(), 'effort-plugin-project-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await writeFile(join(dir, 'index.js'), 'export const value = 1;\n');
  return dir;
}

function runProcess(args, { input = '', env = {}, cwd = root } = {}) {
  return new Promise((done, fail) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
    child.on('error', fail);
    child.on('close', (code, signal) => done({ code, signal, stdout, stderr, ms: performance.now() - started }));
    child.stdin.on('error', () => {}); // The hook stops reading oversized input.
    child.stdin.end(input);
  });
}
const runHook = (event, options = {}) => runProcess([hookEntry], { ...options, input: typeof event === 'string' ? event : JSON.stringify(event) });
// Claude Code substitutes the placeholder with forward slashes, on Windows too.
const substitute = (arg, pluginRoot) => arg.replace('${CLAUDE_PLUGIN_ROOT}', pluginRoot.replaceAll('\\', '/'));

function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  assert.ok(match, 'SKILL.md starts with YAML frontmatter');
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    assert.ok(pair, `simple frontmatter line: ${line}`);
    fields[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return { fields, body: match[2] };
}

// Static imports, dynamic imports and re-exports of a module graph, from the hook entry.
async function moduleGraph(entry) {
  const files = new Map(), builtins = new Set(), packages = new Set();
  async function visit(file) {
    if (files.has(file)) return;
    const source = await readFile(file, 'utf8');
    files.set(file, source);
    const pattern = /\bimport\s*(?:[\w*{}\s,]+\bfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\bexport\s+[\w*{}\s,]+\bfrom\s*['"]([^'"]+)['"]/g;
    for (const found of source.matchAll(pattern)) {
      const specifier = found[1] ?? found[2] ?? found[3];
      if (specifier.startsWith('node:')) builtins.add(specifier);
      else if (specifier.startsWith('.')) await visit(resolve(dirname(file), specifier));
      else packages.add(specifier);
    }
  }
  await visit(entry);
  return { files, builtins, packages };
}

test('plugin.json and marketplace.json follow the documented Claude Code formats', async () => {
  const plugin = await readJson('.claude-plugin/plugin.json');
  const marketplace = await readJson('.claude-plugin/marketplace.json');
  const pluginKeys = ['name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'mcpServers'];
  assert.deepEqual(Object.keys(plugin).filter((key) => !pluginKeys.includes(key)), [], 'no keys Claude Code would strip');
  assert.match(plugin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case plugin name');
  assert.doesNotMatch(plugin.name, /^(?:claude|anthropics?|cc-plugin)-|(?:^|-)(?:claude|anthropics?)(?:-|$)/, 'not a name reserved for Anthropic');
  assert.ok(plugin.description && plugin.author?.name, 'description and author.name avoid validator warnings');
  assert.equal(new URL(plugin.homepage).protocol, 'https:', 'homepage must parse as a URL or the plugin fails to load');
  assert.deepEqual(plugin.mcpServers, { effort: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/bin/effort.mjs', 'mcp'] } });
  assert.ok(existsSync(join(root, 'bin', 'effort.mjs')));
  // A root .mcp.json would also load as project MCP config for anyone who opens this
  // repository in Claude Code, where ${CLAUDE_PLUGIN_ROOT} is undefined.
  assert.ok(!existsSync(join(root, '.mcp.json')), 'declare plugin MCP servers in plugin.json, not a root .mcp.json');

  const marketplaceKeys = ['name', 'owner', 'plugins', 'description', 'version', 'metadata'];
  assert.deepEqual(Object.keys(marketplace).filter((key) => !marketplaceKeys.includes(key)), []);
  assert.match(marketplace.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!marketplace.name.includes('..'));
  assert.ok(!['claude-code-marketplace', 'claude-code-plugins', 'claude-plugins-official', 'anthropic-marketplace', 'anthropic-plugins',
    'inline', 'builtin', 'skills-dir', 'synced', 'npm', 'github'].includes(marketplace.name.toLowerCase()), 'not a reserved marketplace name');
  assert.ok(marketplace.owner?.name && marketplace.description);
  assert.equal(marketplace.plugins.length, 1);
  const [entry] = marketplace.plugins;
  const entryKeys = ['name', 'source', 'description', 'category', 'tags', 'version', 'strict'];
  assert.deepEqual(Object.keys(entry).filter((key) => !entryKeys.includes(key)), []);
  assert.equal(entry.name, plugin.name, 'entry name and manifest name match, so installs resolve');
  assert.ok(!(entry.version && plugin.version), 'version is set in at most one place');
  assert.ok(typeof entry.source === 'string' && entry.source.startsWith('./') && !entry.source.includes('..') && !entry.source.includes('\\'));
  // The marketplace root is the directory that contains .claude-plugin/.
  assert.equal(resolve(root, entry.source), root, 'the plugin root is the repository root, so bin/ and src/ are installed with it');
  assert.ok(existsSync(join(resolve(root, entry.source), '.claude-plugin', 'plugin.json')));
});

test('hooks.json registers one advisory exec-form UserPromptSubmit hook', async () => {
  const config = await readJson('hooks/hooks.json');
  assert.deepEqual(Object.keys(config), ['hooks'], 'a hooks file wraps the event map in "hooks"');
  assert.deepEqual(Object.keys(config.hooks), ['UserPromptSubmit']);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  const [group] = config.hooks.UserPromptSubmit;
  assert.equal(group.matcher, undefined, 'UserPromptSubmit has no matcher support');
  assert.equal(group.hooks.length, 1);
  const [hook] = group.hooks;
  assert.deepEqual(Object.keys(hook).sort(), ['args', 'command', 'timeout', 'type']);
  assert.equal(hook.type, 'command');
  assert.equal(hook.command, 'node', 'exec form: node is a real executable on every platform, and no shell starts');
  assert.deepEqual(hook.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/prompt-advice.mjs']);
  assert.ok(Number.isInteger(hook.timeout) && hook.timeout >= 1 && hook.timeout <= 30, 'timeout in seconds, below the 30 s default');
  assert.ok(existsSync(substitute(hook.args[0], root)));
});

test('the explain skill pre-approves only the bundled recommendation tool', async () => {
  const plugin = await readJson('.claude-plugin/plugin.json');
  const { fields, body } = frontmatter(await readFile(join(root, 'skills', 'explain', 'SKILL.md'), 'utf8'));
  assert.deepEqual(Object.keys(fields).sort(), ['allowed-tools', 'argument-hint', 'description']);
  assert.ok(fields.description.length > 40 && fields.description.length <= 1536);
  const [server] = Object.keys(plugin.mcpServers);
  const tool = 'effort_recommend';
  assert.ok(toolDefinitions.some((definition) => definition.name === tool && definition.annotations.readOnlyHint));
  assert.equal(fields['allowed-tools'], `mcp__plugin_${plugin.name}_${server}__${tool}`, 'plugin MCP tools are named mcp__plugin_<plugin>_<server>__<tool>');
  assert.ok(body.includes(fields['allowed-tools']) && body.includes('$ARGUMENTS') && body.includes('/effort <level>'));
});

test('advice names the suggested level only when a rule fired and it differs from the session level', async () => {
  const advise = (prompt, level) => promptAdvice(hookEvent(prompt, root, { effort: { level } }));
  assert.deepEqual(await advise(RACE, 'low'), { systemMessage: message('high', 'low') });
  assert.deepEqual(await advise(RACE, 'medium'), { systemMessage: message('high', 'medium') });
  assert.equal(await advise(RACE, 'high'), null);
  assert.deepEqual(await advise(TYPO, 'medium'), { systemMessage: message('low', 'medium') });
  assert.equal(await advise(TYPO, 'low'), null);
  // Medium is the uncertain default: no rule fired, so a known level gets no line either.
  for (const prompt of [PLAIN, 'continue', 'yes, go ahead']) {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) assert.equal(await advise(prompt, effort), null, `${prompt} on ${effort}`);
  }
  assert.equal(await advise(RACE, ' HIGH '), null, 'level names are normalized');
  // Effort's rules stop at high, so high already covers xhigh and max sessions.
  assert.equal(await advise(RACE, 'xhigh'), null);
  assert.equal(await advise(RACE, 'max'), null);
  assert.deepEqual(await advise(TYPO, 'max'), { systemMessage: message('low', 'max') });
});

test('the level comes only from the event, never from $CLAUDE_EFFORT', async (t) => {
  // Claude Code documents effort.level and $CLAUDE_EFFORT for tool-use events only, and 2.1.299 sends
  // neither to UserPromptSubmit hooks, so an event level guards a future change.
  assert.deepEqual(await promptAdvice(hookEvent(RACE, root, { effort: { level: 'LOW ' } })), { systemMessage: message('high', 'low') });
  assert.equal(await promptAdvice(hookEvent(TYPO, root, { effort: { level: 'low' } })), null);
  for (const effort of ['high', 7, null, [], {}, { level: 3 }, { level: 'turbo' }]) {
    assert.deepEqual(await promptAdvice(hookEvent(RACE, root, { effort })), { systemMessage: RAISE }, `effort ${JSON.stringify(effort)} is not a level`);
  }
  // An inherited CLAUDE_EFFORT, as in a shell started by another Claude Code session, describes that session.
  const cwd = await tempProject(t);
  const env = { CLAUDE_EFFORT: 'max' };
  const typo = await runHook(hookEvent(TYPO, cwd), { env, cwd });
  assert.deepEqual(JSON.parse(typo.stdout), { systemMessage: LOWER }, 'no level taken from the environment');
  const race = await runHook(hookEvent(RACE, cwd), { env, cwd });
  assert.deepEqual(JSON.parse(race.stdout), { systemMessage: RAISE }, 'not silenced by the inherited max');
  const fromEvent = await runHook(hookEvent(TYPO, cwd, { effort: { level: 'high' } }), { env, cwd });
  assert.deepEqual(JSON.parse(fromEvent.stdout), { systemMessage: message('low', 'high') });
});

test('advice without a known level is shown only for rule-based suggestions and never claims a level', async () => {
  const advise = (prompt, level) => promptAdvice(hookEvent(prompt, root, level === undefined ? {} : { effort: { level } }));
  // Claude Code 2.1.299 passes UserPromptSubmit hooks no level, so an unset, empty or unrecognized value is the usual case.
  for (const effort of [undefined, null, '', '  ', 'auto', 'ultra', 7]) {
    assert.deepEqual(await advise(RACE, effort), { systemMessage: RAISE }, `race prompt, effort ${effort}`);
    assert.deepEqual(await advise(TYPO, effort), { systemMessage: LOWER }, `typo prompt, effort ${effort}`);
    assert.equal(await advise(PLAIN, effort), null, `no rule fired, effort ${effort}`);
  }
  for (const text of [RAISE, LOWER]) assert.doesNotMatch(text, /you're on (?:low|medium|high|xhigh|max)\b/, 'the level is unknown, so the line does not state one');
});

test('advice stays silent without a task description and ignores the workspace', async () => {
  for (const effort of ['low', undefined]) { // a known level and an unknown one
    for (const prompt of ['', '   ', '/effort-project:explain', '  /deploy staging', '!npm test', 'x'.repeat(100_001), 42, null]) {
      assert.equal(await promptAdvice(hookEvent(prompt, root, effort ? { effort: { level: effort } } : {})), null, `prompt ${String(prompt).slice(0, 20)}, effort ${effort}`);
    }
    for (const event of [null, [], 'prompt', { ...hookEvent(RACE, root), hook_event_name: 'PreToolUse' }]) assert.equal(await promptAdvice(event), null);
  }
  // Only the prompt counts, so a missing, unreadable or stalled workspace cannot silence or delay the line.
  for (const cwd of [join(root, 'no-such-directory'), undefined, 42]) {
    assert.deepEqual(await promptAdvice(hookEvent(RACE, cwd)), { systemMessage: RAISE });
  }
});

test('runPromptHook prints only systemMessage JSON and fails open on bad input', async (t) => {
  const capture = () => {
    const sink = new Writable({ write(chunk, encoding, callback) { sink.text += chunk; callback(); } });
    sink.text = '';
    return sink;
  };
  const options = {};
  let stdout = capture(), stderr = capture();
  assert.deepEqual(await runPromptHook({ ...options, stdin: Readable.from([JSON.stringify(hookEvent(RACE, root))]), stdout, stderr }), { systemMessage: RAISE });
  assert.deepEqual(JSON.parse(stdout.text), { systemMessage: RAISE });
  assert.ok(stdout.text.endsWith('}\n') && !stdout.text.slice(0, -1).includes('\n'), 'one JSON object, nothing around it');
  assert.equal(stderr.text, '');

  const marker = 'PRIVATE_PROMPT_MARKER_3141';
  const inputs = [
    `{"hook_event_name":"UserPromptSubmit","prompt":"${marker}`, // Malformed: JSON errors quote their input.
    JSON.stringify(hookEvent(`${marker} ${'y'.repeat(MAX_INPUT_BYTES)}`, root)),
    '',
  ];
  for (const input of inputs) {
    stdout = capture(); stderr = capture();
    assert.equal(await runPromptHook({ ...options, stdin: Readable.from(input ? [input] : []), stdout, stderr }), null);
    assert.equal(stdout.text + stderr.text, '');
  }

  const open = new PassThrough();
  t.after(() => open.destroy());
  const started = performance.now();
  assert.equal(await runPromptHook({ ...options, stdin: open, stdout: capture(), stderr: capture(), inputTimeoutMs: 30 }), null);
  assert.ok(performance.now() - started < 1000, 'an input stream that never closes is abandoned');

  const tty = Object.assign(new PassThrough(), { isTTY: true });
  assert.equal(await runPromptHook({ ...options, stdin: tty, stdout: capture(), stderr: capture() }), null);

  stderr = capture();
  const broken = new Writable({ write(chunk, encoding, callback) { callback(new Error(`EPIPE ${chunk}`)); } });
  broken.on('error', () => {});
  assert.equal(await runPromptHook({ ...options, stdin: Readable.from([JSON.stringify(hookEvent(`${marker} ${RACE}`, root))]), stdout: broken, stderr }), null);
  assert.equal(stderr.text, 'effort-project: prompt advice skipped after an internal error.\n');
  assert.ok(!stderr.text.includes(marker));
});

test('the hook process prints advice JSON, stays silent on matches, and always exits 0', async (t) => {
  const cwd = await tempProject(t);
  const differing = await runHook(hookEvent(RACE, cwd, { effort: { level: 'medium' } }), { cwd });
  assert.deepEqual({ code: differing.code, stderr: differing.stderr }, { code: 0, stderr: '' });
  assert.deepEqual(JSON.parse(differing.stdout), { systemMessage: message('high', 'medium') });

  // Claude Code 2.1.299 sets no CLAUDE_EFFORT for UserPromptSubmit hooks, so this is the usual case:
  // a rule-based suggestion that does not claim a level.
  const unknown = await runHook(hookEvent(RACE, cwd), { cwd });
  assert.deepEqual({ code: unknown.code, stderr: unknown.stderr }, { code: 0, stderr: '' });
  assert.deepEqual(JSON.parse(unknown.stdout), { systemMessage: RAISE });
  const fromEvent = await runHook(hookEvent(RACE, cwd, { effort: { level: 'low' } }), { cwd });
  assert.deepEqual(JSON.parse(fromEvent.stdout), { systemMessage: message('high', 'low') });
  const noWorkspace = await runHook(hookEvent(RACE, join(cwd, 'deleted')), { cwd });
  assert.deepEqual(JSON.parse(noWorkspace.stdout), { systemMessage: RAISE }, 'the workspace is never read');

  const silent = [
    ['matching level', hookEvent(RACE, cwd, { effort: { level: 'high' } }), {}],
    ['matching low level', hookEvent(TYPO, cwd, { effort: { level: 'low' } }), {}],
    ['unknown level, no rule fired', hookEvent(PLAIN, cwd), {}],
    ['known level, no rule fired', hookEvent('continue', cwd, { effort: { level: 'high' } }), {}],
    ['event level matches', hookEvent(RACE, cwd, { effort: { level: 'max' } }), {}],
    ['malformed JSON', '{"hook_event_name":"UserPromptSubmit","prompt":"PRIVATE_PROMPT_MARKER_2718', {}],
    ['not an object', '["UserPromptSubmit"]', {}],
    ['empty input', '', {}],
    ['oversized input', JSON.stringify(hookEvent('z'.repeat(2 * MAX_INPUT_BYTES), cwd)), {}],
    ['another event', { ...hookEvent(RACE, cwd), hook_event_name: 'Stop' }, {}],
  ];
  for (const [name, event, env] of silent) {
    const result = await runHook(event, { env, cwd });
    assert.deepEqual({ code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, { code: 0, signal: null, stdout: '', stderr: '' }, name);
  }
});

test('repository breadth does not change the line: many languages or named files', async (t) => {
  // In a checkout with three or more languages, every prompt used to get "suggests high".
  const cwd = await tempProject(t);
  for (const file of ['a.py', 'b.go', 'c.ts', 'd.rs', 'e.js']) await writeFile(join(cwd, file), '\n');
  const cases = [
    ['Fix the typo in the README', LOWER],
    ['continue', null],
    ['yes, go ahead', null],
    ['Fix the broken link in the README', null],
    ['Bump the version number in package.json', null],
    ['Change the button color from blue to green', null],
    [PLAIN, null],
    ['Update a.py, b.go, c.ts, d.rs and e.js to the new logger', null],
    [RACE, RAISE],
  ];
  for (const [prompt, expected] of cases) {
    const result = await runHook(hookEvent(prompt, cwd), { cwd });
    assert.equal(result.code, 0, prompt);
    assert.deepEqual(result.stdout ? JSON.parse(result.stdout) : null, expected && { systemMessage: expected }, prompt);
  }
});

test('the hook adds little to Node startup and never stores, logs or sends the prompt', async (t) => {
  const cwd = await tempProject(t);
  const sandbox = await mkdtemp(join(tmpdir(), 'effort-plugin-home-'));
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { HOME: sandbox, USERPROFILE: sandbox, TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox,
    APPDATA: sandbox, LOCALAPPDATA: sandbox, XDG_CACHE_HOME: sandbox, XDG_CONFIG_HOME: sandbox, CLAUDE_PLUGIN_DATA: sandbox, EFFORT_DATA_DIR: sandbox };
  const marker = 'PRIVATE_PROMPT_MARKER_1618';
  const before = (await readdir(cwd)).sort();
  const result = await runHook(hookEvent(`${RACE} ${marker}`, cwd), { env, cwd });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { systemMessage: RAISE });
  assert.ok(!(result.stdout + result.stderr).includes(marker), 'the prompt is never echoed or logged');
  assert.deepEqual(await readdir(sandbox, { recursive: true }), [], 'nothing written to home, temp or plugin data');
  assert.deepEqual((await readdir(cwd)).sort(), before, 'nothing written to the workspace');

  const graph = await moduleGraph(hookEntry);
  const modules = [...graph.files.keys()].map((file) => relative(root, file).replaceAll('\\', '/'));
  assert.ok(['src/integrations/claude-code-hook.mjs', 'src/policy.mjs'].every((file) => modules.includes(file)));
  assert.ok(modules.every((file) => !file.startsWith('../') && !isAbsolute(file)), 'every module ships inside the plugin root');
  assert.ok(!modules.includes('src/repository.mjs'), 'the hook does not scan the workspace');
  assert.deepEqual([...graph.packages], [], 'no third-party packages');
  const networked = ['node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns', 'node:child_process', 'node:worker_threads'];
  assert.deepEqual([...graph.builtins].filter((name) => networked.includes(name)), [], 'no network or process modules');
  // A stalled filesystem call would keep the process alive after process.exit() on Windows.
  assert.deepEqual([...graph.builtins].filter((name) => /^node:fs\b/.test(name)), [], 'no filesystem modules');
  for (const [file, source] of graph.files) {
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/, `${file} makes no requests`);
    assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream|mkdir|mkdtemp|copyFile|writeFileSync|appendFileSync)\s*\(|\bconsole\.\w+\s*\(/, `${file} neither writes files nor logs`);
  }

  // Timing: Node startup dominates; the advice itself is a few regular expressions.
  const event = hookEvent(RACE, cwd);
  const inProcess = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    await promptAdvice(event);
    inProcess.push(performance.now() - started);
  }
  const bare = [], hook = [];
  for (let i = 0; i < 5; i++) {
    bare.push((await runProcess(['-e', ''], { cwd })).ms);
    hook.push((await runHook(event, { cwd })).ms);
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  t.diagnostic(`advice in process ${median(inProcess).toFixed(1)} ms; hook process ${median(hook).toFixed(0)} ms; bare node ${median(bare).toFixed(0)} ms (medians)`);
  assert.ok(median(inProcess) < 100, 'the advice itself stays well under 100 ms');
  // Relative bound: on a loaded machine both medians grow several times over.
  assert.ok(median(hook) < 2 * median(bare) + 150, 'the hook adds little beyond starting Node');
  assert.ok(Math.max(...hook) < 5000, 'every run finishes inside the hook timeout');
});

test('npm run check syntax-checks the hook entry in hooks/', async (t) => {
  const tree = await mkdtemp(join(tmpdir(), 'effort-plugin-check-'));
  t.after(() => rm(tree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  for (const dir of ['src', 'bin', 'test', 'web', 'scripts', 'hooks', 'bench']) await mkdir(join(tree, dir));
  await writeFile(join(tree, 'hooks', 'broken.mjs'), 'export const = ;\n');
  const result = await runProcess([join(root, 'scripts', 'check.mjs')], { cwd: tree });
  assert.equal(result.code, 1, 'a syntax error under hooks/ fails the check');
  assert.match(result.stderr, /broken\.mjs/);
  assert.match(result.stdout, /Syntax checked 1 JavaScript files/);
});

test('the plugin MCP configuration starts the bundled stdio server', async () => {
  const plugin = await readJson('.claude-plugin/plugin.json');
  const { args } = plugin.mcpServers.effort;
  const messages = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'effort_recommend', arguments: { prompt: RACE, provider: 'claude' } } },
  ];
  const result = await runProcess(args.map((arg) => substitute(arg, root)), { input: messages.map((value) => JSON.stringify(value)).join('\n') + '\n' });
  assert.equal(result.code, 0, result.stderr);
  const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(replies.map((reply) => reply.id), [1, 2, 3]);
  assert.ok(replies[1].result.tools.some((tool) => tool.name === 'effort_recommend'));
  assert.equal(replies[2].result.structuredContent.effort, 'high');
  assert.equal(replies[2].result.structuredContent.applied, false);
});

test('an installed copy of the plugin root runs without the rest of the checkout', async (t) => {
  // Claude Code copies only the plugin directory into ~/.claude/plugins/cache.
  const cache = await mkdtemp(join(tmpdir(), 'effort-plugin-cache-'));
  t.after(() => rm(cache, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const installed = join(cache, 'effort-project', 'effort-project', '0123456789ab');
  for (const part of ['.claude-plugin', 'hooks', 'skills', 'bin', 'src']) await cp(join(root, part), join(installed, part), { recursive: true });
  const cwd = await tempProject(t);
  const config = JSON.parse(await readFile(join(installed, 'hooks', 'hooks.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
  const hook = await runProcess(config.args.map((arg) => substitute(arg, installed)),
    { input: JSON.stringify(hookEvent(TYPO, cwd, { effort: { level: 'high' } })), cwd });
  assert.equal(hook.code, 0, hook.stderr);
  assert.deepEqual(JSON.parse(hook.stdout), { systemMessage: message('low', 'high') });
  const server = JSON.parse(await readFile(join(installed, '.claude-plugin', 'plugin.json'), 'utf8')).mcpServers.effort;
  const mcp = await runProcess(server.args.map((arg) => substitute(arg, installed)),
    { input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', cwd });
  assert.equal(mcp.code, 0, mcp.stderr);
  assert.equal(JSON.parse(mcp.stdout).result.tools.length, toolDefinitions.length);

  // A damaged install must still fail open: no output, no error notice, exit 0.
  const damaged = join(cache, 'damaged');
  await cp(join(root, 'hooks'), join(damaged, 'hooks'), { recursive: true });
  const broken = await runProcess([join(damaged, 'hooks', 'prompt-advice.mjs')], { input: JSON.stringify(hookEvent(RACE, cwd)), cwd });
  assert.deepEqual({ code: broken.code, stdout: broken.stdout, stderr: broken.stderr }, { code: 0, stdout: '', stderr: '' });
});
