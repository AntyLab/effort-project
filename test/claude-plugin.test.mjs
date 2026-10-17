import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const jsFacts = async () => ({ languages: ['javascript'], scannedFiles: 3, mentionedFiles: 0, hasTests: false, truncated: false });
// Tests run inside Claude Code too, where CLAUDE_EFFORT is already set.
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CLAUDE_EFFORT'));

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
    const child = spawn(process.execPath, args, { cwd, env: { ...baseEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

test('advice names the suggested level only when it differs from the session level', async () => {
  const cwd = root;
  const advise = (prompt, effort, options = {}) => promptAdvice(hookEvent(prompt, cwd), { effort, repositoryFactsFn: jsFacts, ...options });
  assert.deepEqual(await advise(RACE, 'low'), { systemMessage: message('high', 'low') });
  assert.deepEqual(await advise(RACE, 'medium'), { systemMessage: message('high', 'medium') });
  assert.equal(await advise(RACE, 'high'), null);
  assert.deepEqual(await advise(TYPO, 'medium'), { systemMessage: message('low', 'medium') });
  assert.equal(await advise(TYPO, 'low'), null);
  assert.deepEqual(await advise(PLAIN, 'high'), { systemMessage: message('medium', 'high') });
  assert.equal(await advise(PLAIN, 'medium'), null);
  assert.equal(await advise(RACE, ' HIGH '), null, 'level names are normalized');
  // Effort's rules stop at high, so high already covers xhigh and max sessions.
  assert.equal(await advise(RACE, 'xhigh'), null);
  assert.equal(await advise(RACE, 'max'), null);
  assert.deepEqual(await advise(TYPO, 'max'), { systemMessage: message('low', 'max') });
  assert.deepEqual(await advise(PLAIN, 'xhigh'), { systemMessage: message('medium', 'xhigh') });
  const polyglot = async () => ({ languages: ['go', 'python', 'typescript'], mentionedFiles: 0 });
  assert.deepEqual(await advise(PLAIN, 'medium', { repositoryFactsFn: polyglot }), { systemMessage: message('high', 'medium') }, 'repository metadata counts, as in effort recommend');
  let seen;
  await promptAdvice(hookEvent(TYPO, join(root, 'src')), { effort: 'low', repositoryFactsFn: async (directory) => { seen = directory; return {}; } });
  assert.equal(seen, join(root, 'src'), 'the event cwd is the scanned workspace');
});

test('advice stays silent without a level, a task description, or repository metadata', async () => {
  let scans = 0;
  const counting = async () => { scans++; return jsFacts(); };
  const advise = (event, effort, options = {}) => promptAdvice(event, { effort, repositoryFactsFn: counting, ...options });
  for (const effort of [undefined, '', 'auto', 'ultra', 7]) assert.equal(await advise(hookEvent(RACE, root), effort), null, `effort ${effort}`);
  for (const prompt of ['', '   ', '/effort-project:explain', '  /deploy staging', '!npm test', 'x'.repeat(100_001), 42, null]) {
    assert.equal(await advise(hookEvent(prompt, root), 'low'), null, `prompt ${String(prompt).slice(0, 20)}`);
  }
  for (const event of [null, [], 'prompt', { ...hookEvent(RACE, root), hook_event_name: 'PreToolUse' }]) assert.equal(await advise(event, 'low'), null);
  assert.equal(scans, 0, 'skipped events never scan the workspace');
  assert.equal(await advise(hookEvent(RACE, root), 'low', { repositoryFactsFn: async () => { throw new Error('EACCES'); } }), null);
  const started = performance.now();
  assert.equal(await advise(hookEvent(RACE, root), 'low', { repositoryFactsFn: () => new Promise(() => {}), metadataTimeoutMs: 20 }), null);
  assert.ok(performance.now() - started < 1000, 'a stuck scan is abandoned');
  assert.equal(await promptAdvice(hookEvent(RACE, join(root, 'no-such-directory')), { effort: 'low' }), null);
});

test('runPromptHook prints only systemMessage JSON and fails open on bad input', async (t) => {
  const capture = () => {
    const sink = new Writable({ write(chunk, encoding, callback) { sink.text += chunk; callback(); } });
    sink.text = '';
    return sink;
  };
  const env = { CLAUDE_EFFORT: 'low' };
  const options = { env, repositoryFactsFn: jsFacts };
  let stdout = capture(), stderr = capture();
  assert.deepEqual(await runPromptHook({ ...options, stdin: Readable.from([JSON.stringify(hookEvent(RACE, root))]), stdout, stderr }), { systemMessage: message('high', 'low') });
  assert.deepEqual(JSON.parse(stdout.text), { systemMessage: message('high', 'low') });
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
  const differing = await runHook(hookEvent(RACE, cwd), { env: { CLAUDE_EFFORT: 'low' }, cwd });
  assert.deepEqual({ code: differing.code, stderr: differing.stderr }, { code: 0, stderr: '' });
  assert.deepEqual(JSON.parse(differing.stdout), { systemMessage: message('high', 'low') });

  const silent = [
    ['matching level', hookEvent(RACE, cwd), { CLAUDE_EFFORT: 'high' }],
    ['matching low level', hookEvent(TYPO, cwd), { CLAUDE_EFFORT: 'low' }],
    ['missing $CLAUDE_EFFORT', hookEvent(RACE, cwd), {}],
    ['malformed JSON', '{"hook_event_name":"UserPromptSubmit","prompt":"PRIVATE_PROMPT_MARKER_2718', { CLAUDE_EFFORT: 'low' }],
    ['not an object', '["UserPromptSubmit"]', { CLAUDE_EFFORT: 'low' }],
    ['empty input', '', { CLAUDE_EFFORT: 'low' }],
    ['oversized input', JSON.stringify(hookEvent('z'.repeat(2 * MAX_INPUT_BYTES), cwd)), { CLAUDE_EFFORT: 'low' }],
    ['another event', { ...hookEvent(RACE, cwd), hook_event_name: 'Stop' }, { CLAUDE_EFFORT: 'low' }],
    ['missing workspace', hookEvent(RACE, join(cwd, 'deleted')), { CLAUDE_EFFORT: 'low' }],
  ];
  for (const [name, event, env] of silent) {
    const result = await runHook(event, { env, cwd });
    assert.deepEqual({ code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, { code: 0, signal: null, stdout: '', stderr: '' }, name);
  }
});

test('the hook adds little to Node startup and never stores, logs or sends the prompt', async (t) => {
  const cwd = await tempProject(t);
  const sandbox = await mkdtemp(join(tmpdir(), 'effort-plugin-home-'));
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { CLAUDE_EFFORT: 'low', HOME: sandbox, USERPROFILE: sandbox, TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox,
    APPDATA: sandbox, LOCALAPPDATA: sandbox, XDG_CACHE_HOME: sandbox, XDG_CONFIG_HOME: sandbox, CLAUDE_PLUGIN_DATA: sandbox, EFFORT_DATA_DIR: sandbox };
  const marker = 'PRIVATE_PROMPT_MARKER_1618';
  const before = (await readdir(cwd)).sort();
  const result = await runHook(hookEvent(`${RACE} ${marker}`, cwd), { env, cwd });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { systemMessage: message('high', 'low') });
  assert.ok(!(result.stdout + result.stderr).includes(marker), 'the prompt is never echoed or logged');
  assert.deepEqual(await readdir(sandbox, { recursive: true }), [], 'nothing written to home, temp or plugin data');
  assert.deepEqual((await readdir(cwd)).sort(), before, 'nothing written to the workspace');

  const graph = await moduleGraph(hookEntry);
  const modules = [...graph.files.keys()].map((file) => relative(root, file).replaceAll('\\', '/'));
  assert.ok(['src/integrations/claude-code-hook.mjs', 'src/policy.mjs', 'src/repository.mjs'].every((file) => modules.includes(file)));
  assert.ok(modules.every((file) => !file.startsWith('../') && !isAbsolute(file)), 'every module ships inside the plugin root');
  assert.deepEqual([...graph.packages], [], 'no third-party packages');
  const networked = ['node:http', 'node:https', 'node:http2', 'node:net', 'node:tls', 'node:dgram', 'node:dns', 'node:child_process', 'node:worker_threads'];
  assert.deepEqual([...graph.builtins].filter((name) => networked.includes(name)), [], 'no network or process modules');
  for (const [file, source] of graph.files) {
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/, `${file} makes no requests`);
    assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream|mkdir|mkdtemp|copyFile|writeFileSync|appendFileSync)\s*\(|\bconsole\.\w+\s*\(/, `${file} neither writes files nor logs`);
  }

  // Timing: Node startup dominates; the advice itself is a bounded local scan.
  const event = hookEvent(RACE, cwd);
  const inProcess = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    await promptAdvice(event, { effort: 'low' });
    inProcess.push(performance.now() - started);
  }
  const bare = [], hook = [];
  for (let i = 0; i < 5; i++) {
    bare.push((await runProcess(['-e', ''], { cwd })).ms);
    hook.push((await runHook(event, { env: { CLAUDE_EFFORT: 'low' }, cwd })).ms);
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  t.diagnostic(`advice in process ${median(inProcess).toFixed(1)} ms; hook process ${median(hook).toFixed(0)} ms; bare node ${median(bare).toFixed(0)} ms (medians)`);
  assert.ok(median(inProcess) < 100, 'the advice itself stays well under 100 ms');
  // Relative bound: on a loaded machine both medians grow several times over.
  assert.ok(median(hook) < 2 * median(bare) + 150, 'the hook adds little beyond starting Node');
  assert.ok(Math.max(...hook) < 5000, 'every run finishes inside the hook timeout');
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
    { input: JSON.stringify(hookEvent(TYPO, cwd)), env: { CLAUDE_EFFORT: 'high' }, cwd });
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
  const broken = await runProcess([join(damaged, 'hooks', 'prompt-advice.mjs')], { input: JSON.stringify(hookEvent(RACE, cwd)), env: { CLAUDE_EFFORT: 'low' }, cwd });
  assert.deepEqual({ code: broken.code, stdout: broken.stdout, stderr: broken.stderr }, { code: 0, stdout: '', stderr: '' });
});
