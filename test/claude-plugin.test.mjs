import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { MAX_INPUT_BYTES, MAX_TRANSCRIPT_BYTES, promptAdvice, runPromptHook } from '../src/integrations/claude-code-hook.mjs';
import { toolDefinitions } from '../src/mcp.mjs';
import { MODELS } from '../src/policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hookEntry = join(root, 'hooks', 'prompt-advice.mjs');
const readJson = async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
const RACE = 'Investigate the intermittent race condition in the auth token refresh';
const TYPO = 'Fix a typo in the README heading';
const PLAIN = 'Add a settings page with a dark mode toggle';
const HARD = 'Review the authentication permissions';
const INVESTIGATE = 'Investigate the intermittent rendering regression';
const messages = {
  fast: `Effort: ${MODELS.claude.fast} at low effort for this prompt.`,
  frontier: `Effort: ${MODELS.claude.frontier} at high effort for this prompt.`,
  hard: 'Effort: high effort for this prompt.',
};

function assertSuggestion(advice, tier, effort, inherited = false) {
  const model = MODELS.claude[tier];
  assert.deepEqual(advice, {
    systemMessage: `Effort suggests ${model} · ${effort} effort for this prompt (/model ${model}, /effort ${effort}).${inherited ? ' Based on your earlier request.' : ''}`,
  });
}

function assertRoute(advice, route, inherited = false) {
  assert.deepEqual(Object.keys(advice).sort(), ['hookSpecificOutput', 'systemMessage']);
  assert.equal(advice.systemMessage, messages[route] + (inherited ? ' Based on your earlier request.' : ''));
  const output = advice.hookSpecificOutput;
  assert.deepEqual(Object.keys(output).sort(), ['additionalContext', 'hookEventName']);
  assert.equal(output.hookEventName, 'UserPromptSubmit');
  assert.ok(output.additionalContext.includes(`skill "effort-project:route-${route}"`));
  assert.match(output.additionalContext, /Effort Project hook:.*invoke the Skill tool/i);
  if (route === 'hard') {
    assert.match(output.additionalContext, /Before anything else/);
    assert.match(output.additionalContext, /then carry out the user's request as written/);
  } else {
    assert.match(output.additionalContext, /Do not carry out the request yourself/);
    assert.match(output.additionalContext, /user's request verbatim as its arguments/);
    assert.match(output.additionalContext, /plus any earlier conversation context the worker needs/);
    assert.match(output.additionalContext, /Then relay the result/);
  }
}

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
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, EFFORT_AUTO_ROUTE: '', ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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

test('hooks.json registers one routing exec-form UserPromptSubmit hook', async () => {
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
  assert.ok(body.includes(fields['allowed-tools']) && body.includes('$ARGUMENTS') && body.includes('effort-project:route-fast') && body.includes('effort-project:route-frontier') && body.includes('effort-project:route-hard'));
});

test('route skills declare the policy models, effort and exactly two forks', async () => {
  for (const [route, tier, effort] of [['fast', 'fast', 'low'], ['frontier', 'frontier', 'high'], ['hard', null, 'high']]) {
    const { fields, body } = frontmatter(await readFile(join(root, 'skills', `route-${route}`, 'SKILL.md'), 'utf8'));
    assert.equal(fields.name, `route-${route}`);
    assert.match(fields.description, /Invoke only when an Effort Project hook message asks for this skill/);
    assert.equal(fields.effort, effort);
    assert.deepEqual(Object.keys(fields).sort(), tier
      ? ['context', 'description', 'effort', 'model', 'name'] : ['description', 'effort', 'name']);
    assert.equal(fields.model, tier ? MODELS.claude[tier] : undefined);
    assert.equal(fields.context, tier ? 'fork' : undefined);
    if (tier) {
      assert.match(body, /Carry out the request below exactly as written/);
      // Git for Windows checks text files out with CRLF line endings by default.
      assert.match(body, /\r?\n\r?\n\$ARGUMENTS\s*$/);
      assert.match(body, route === 'fast' ? /report what was changed in one or two lines/ : /short report of findings and changes/);
    } else {
      assert.match(body, /high for the rest of this turn/);
      assert.match(body, /user's latest request as written/);
      assert.match(body, /Do not mention this step/);
    }
  }
});

test('default advice is only a suggestion for every eligible effort and never echoes the prompt', () => {
  for (const [prompt, tier, effort] of [[TYPO, 'fast', 'low'], [PLAIN, 'daily', 'medium'],
    [HARD, 'daily', 'high'], [INVESTIGATE, 'daily', 'high'], [RACE, 'frontier', 'high']]) {
    const advice = promptAdvice(hookEvent(prompt, root));
    assertSuggestion(advice, tier, effort);
    assert.ok(!JSON.stringify(advice).includes(prompt));
    assert.deepEqual(promptAdvice(hookEvent(`${prompt} PRIVATE_PROMPT_MARKER_5772`, root)), advice);
  }
  assertSuggestion(promptAdvice({ prompt: TYPO }), 'fast', 'low');
});

test('auto-route explicitly opts into the old low/high routes and a plain medium suggestion', () => {
  for (const value of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'oN']) {
    const options = { env: { EFFORT_AUTO_ROUTE: value } };
    for (const [prompt, route] of [[TYPO, 'fast'], [HARD, 'hard'], [INVESTIGATE, 'hard'], [RACE, 'frontier']]) {
      const advice = promptAdvice(hookEvent(prompt, root), options);
      assertRoute(advice, route);
      assert.ok(!JSON.stringify(advice).includes(prompt));
    }
    assertSuggestion(promptAdvice(hookEvent(PLAIN, root), options), 'daily', 'medium');
  }
  for (const value of [undefined, '', '0', 'false', 'no', 'off', 'enabled', '11']) {
    assertSuggestion(promptAdvice({ prompt: RACE }, { env: { EFFORT_AUTO_ROUTE: value } }), 'frontier', 'high');
  }
});

test('routing ignores event effort and inherited $CLAUDE_EFFORT', async (t) => {
  for (const effort of [undefined, 'high', 7, null, [], {}, { level: 3 }, { level: 'turbo' },
    ...['low', 'medium', 'high', 'xhigh', 'max', ' HIGH '].map(level => ({ level }))]) {
    for (const [prompt, route, tier, level] of [[RACE, 'frontier', 'frontier', 'high'],
      [TYPO, 'fast', 'fast', 'low'], [HARD, 'hard', 'daily', 'high']]) {
      assertSuggestion(promptAdvice(hookEvent(prompt, root, { effort })), tier, level);
      assertRoute(promptAdvice(hookEvent(prompt, root, { effort }), { env: { EFFORT_AUTO_ROUTE: '1' } }), route);
    }
    for (const prompt of [PLAIN, 'continue', 'yes, go ahead']) {
      assertSuggestion(promptAdvice(hookEvent(prompt, root, { effort })), 'daily', 'medium');
    }
  }
  const cwd = await tempProject(t);
  for (const [prompt, route] of [[TYPO, 'fast'], [HARD, 'hard'], [RACE, 'frontier']]) {
    const result = await runHook(hookEvent(prompt, cwd), { env: { CLAUDE_EFFORT: 'max', EFFORT_AUTO_ROUTE: '1' }, cwd });
    assert.equal(result.code, 0);
    assertRoute(JSON.parse(result.stdout), route);
  }
  const medium = await runHook(hookEvent(PLAIN, cwd), { env: { EFFORT_AUTO_ROUTE: '1' }, cwd });
  assertSuggestion(JSON.parse(medium.stdout), 'daily', 'medium');
});

const userLine = (content, extra = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });

async function transcript(t, entries) {
  const dir = await tempProject(t);
  const path = join(dir, 'session.jsonl');
  await writeFile(path, entries.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry)).join('\n') + '\n');
  return path;
}

test('short follow-ups inherit the most recent signal within three earlier user prompts', async (t) => {
  for (const [earlier, tier, effort, route] of [[TYPO, 'fast', 'low', 'fast'], [RACE, 'frontier', 'high', 'frontier'], [HARD, 'daily', 'high', 'hard']]) {
    const transcript_path = await transcript(t, [userLine(earlier), userLine('ok'), userLine('continue')]);
    for (const auto of [false, true]) {
      const result = await runHook(hookEvent('continue', root, { transcript_path }), { env: { EFFORT_AUTO_ROUTE: auto ? '1' : '' } });
      assert.equal(result.code, 0);
      assert.equal(result.stderr, '');
      const advice = JSON.parse(result.stdout);
      if (auto) assertRoute(advice, route, true);
      else assertSuggestion(advice, tier, effort, true);
      assert.ok(!result.stdout.includes(earlier) && !result.stdout.includes('continue'));
    }
  }
  const options = { previousPrompts: ['ok', 'yes', RACE, TYPO] };
  assertSuggestion(promptAdvice({ prompt: 'continue' }, options), 'frontier', 'high', true);
  assertSuggestion(promptAdvice({ prompt: 'continue' }, { previousPrompts: ['ok', 'yes', 'go ahead', RACE] }), 'daily', 'medium');
  assertSuggestion(promptAdvice({ prompt: 'continue' }, { previousPrompts: [TYPO, RACE] }), 'fast', 'low', true);
  assertSuggestion(promptAdvice({ prompt: 'x'.repeat(80) }, options), 'frontier', 'high', true);
  assertSuggestion(promptAdvice({ prompt: 'x'.repeat(81) }, options), 'daily', 'medium');
  assertSuggestion(promptAdvice({ prompt: '  ' + 'x'.repeat(80) + '  ' }, options), 'frontier', 'high', true);
  assertSuggestion(promptAdvice({ prompt: TYPO }, options), 'fast', 'low');
  assertSuggestion(promptAdvice({ prompt: HARD }, { previousPrompts: [TYPO] }), 'daily', 'high');
});

test('transcript context ignores tool results, meta entries, commands, malformed lines and the current prompt', async (t) => {
  const marker = 'PRIVATE_TRANSCRIPT_MARKER_9531';
  const transcript_path = await transcript(t, [
    userLine([{ type: 'text', text: TYPO }, { type: 'tool_result', content: RACE }, { type: 'text', text: marker }]),
    userLine('ok'), userLine('yes'),
    userLine(RACE, { isMeta: true }),
    userLine([{ type: 'tool_result', content: RACE }]),
    userLine('/investigate auth'), userLine('  !debug auth'), userLine('<command-name>debug auth</command-name>'),
    { type: 'assistant', message: { role: 'user', content: RACE } },
    { type: 'user', message: { role: 'assistant', content: RACE } },
    userLine(null), userLine([{ type: 'text', text: 42 }]),
    '{malformed', 'null', userLine('continue'),
  ]);
  const result = await runHook(hookEvent('continue', root, { transcript_path }));
  assertSuggestion(JSON.parse(result.stdout), 'fast', 'low', true);
  assert.ok(!(result.stdout + result.stderr).includes(marker));

  const tooFar = await transcript(t, [userLine(RACE), userLine('one'), userLine('two'), userLine('three')]);
  assertSuggestion(JSON.parse((await runHook(hookEvent('continue', root, { transcript_path: tooFar }))).stdout), 'daily', 'medium');
});

test('transcript reads are bounded to the last 4 MiB and discard the first partial line', async (t) => {
  assert.equal(MAX_TRANSCRIPT_BYTES, 4 * 1024 * 1024);
  const transcript_path = await transcript(t, [userLine(RACE), JSON.stringify({ padding: 'x'.repeat(MAX_TRANSCRIPT_BYTES) }), userLine(TYPO)]);
  const handle = await open(transcript_path, 'r');
  const { size } = await handle.stat();
  const prototype = Object.getPrototypeOf(handle);
  const original = prototype.read;
  await handle.close();
  const reads = [];
  t.mock.method(prototype, 'read', function(buffer, offset, length, position) {
    reads.push({ length, position });
    return original.call(this, buffer, offset, length, position);
  });
  const sink = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const advice = await runPromptHook({ stdin: Readable.from([JSON.stringify(hookEvent('continue', root, { transcript_path }))]), stdout: sink, env: {} });
  assertSuggestion(advice, 'fast', 'low', true);
  assert.deepEqual(reads, [{ length: MAX_TRANSCRIPT_BYTES, position: size - MAX_TRANSCRIPT_BYTES }]);
  for (const prompt of [RACE, TYPO, 'x'.repeat(81)]) {
    await runPromptHook({ stdin: Readable.from([JSON.stringify(hookEvent(prompt, root, { transcript_path }))]), stdout: sink, env: {} });
  }
  assert.equal(reads.length, 1, 'only short prompts without a signal read context');

  // The truncated first line ends with a valid user object; it must not count.
  const partial = await transcript(t, []);
  const first = JSON.stringify(userLine(RACE)) + '\n';
  const last = '\n' + JSON.stringify(userLine('ok')) + '\n';
  await writeFile(partial, 'x'.repeat(70_000) + first + ' '.repeat(MAX_TRANSCRIPT_BYTES - Buffer.byteLength(first + last)) + last);
  const result = await runHook(hookEvent('continue', root, { transcript_path: partial }));
  assertSuggestion(JSON.parse(result.stdout), 'daily', 'medium');
});

test('follow-ups inherit past the large attachment and request entries Claude Code 2.1.325 writes', async (t) => {
  // One turn of a 2.1.325 transcript: the prompt, then attachments up to 114 KB, a 75 KB
  // request shape and tool results, which put the prompt about 330 KB before the end.
  const bulky = (type, bytes) => JSON.stringify({ type, attachment: { content: 'x'.repeat(bytes) } });
  const transcript_path = await transcript(t, [
    userLine(TYPO), bulky('attachment', 19_562), bulky('attachment', 14_630),
    JSON.stringify({ type: 'api-request-shape', shape: 'x'.repeat(75_794) }),
    JSON.stringify({ type: 'api-request-blob', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>context</system-reminder>' }] } }),
    userLine([{ type: 'tool_result', tool_use_id: 't1', content: 'file text' }]),
    bulky('attachment', 114_269), bulky('attachment', 9_205), bulky('attachment', 90_000),
  ]);
  const result = await runHook(hookEvent('Now the one in CONTRIBUTING.md too', root, { transcript_path }));
  assert.equal(result.code, 0);
  assertSuggestion(JSON.parse(result.stdout), 'fast', 'low', true);
});

test('missing, relative, unreadable and directory transcript paths fall back silently', async (t) => {
  const dir = await tempProject(t);
  for (const transcript_path of [undefined, null, 42, {}, 'session.jsonl', join(dir, 'missing'), join(dir, 'index.js', 'session.jsonl'), dir, dir + '\0']) {
    const result = await runHook(hookEvent('continue', root, { transcript_path }));
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assertSuggestion(JSON.parse(result.stdout), 'daily', 'medium');
  }
});

test('advice stays silent without a task description and ignores the workspace', () => {
  for (const prompt of ['', '   ', '/effort-project:explain', '  /deploy staging', '!npm test', '  !echo hello', 'x'.repeat(100_001), 42, null, undefined]) {
    assert.equal(promptAdvice(hookEvent(prompt, root)), null);
  }
  for (const event of [undefined, null, [], 'prompt', 42, {}, { ...hookEvent(RACE, root), hook_event_name: 'PreToolUse' }]) {
    assert.equal(promptAdvice(event), null);
  }
  // Only the prompt counts, so a missing, unreadable or stalled workspace cannot silence or delay routing.
  for (const cwd of [join(root, 'no-such-directory'), undefined, 42]) {
    assertSuggestion(promptAdvice(hookEvent(RACE, cwd)), 'frontier', 'high');
  }
});

test('runPromptHook prints routing context and systemMessage JSON and fails open on bad input', async (t) => {
  const capture = () => {
    const sink = new Writable({ write(chunk, encoding, callback) { sink.text += chunk; callback(); } });
    sink.text = '';
    return sink;
  };
  const options = { env: { EFFORT_AUTO_ROUTE: '1' } };
  let stdout = capture(), stderr = capture();
  assertRoute(await runPromptHook({ ...options, stdin: Readable.from([JSON.stringify(hookEvent(RACE, root))]), stdout, stderr }), 'frontier');
  assertRoute(JSON.parse(stdout.text), 'frontier');
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

test('the hook process prints routing JSON, stays silent on skipped prompts, and always exits 0', async (t) => {
  const cwd = await tempProject(t);
  for (const [prompt, tier, effort] of [[TYPO, 'fast', 'low'], [PLAIN, 'daily', 'medium'],
    ['continue', 'daily', 'medium'], [HARD, 'daily', 'high'], [INVESTIGATE, 'daily', 'high'], [RACE, 'frontier', 'high']]) {
    const result = await runHook(hookEvent(prompt, cwd), { cwd });
    assert.deepEqual({ code: result.code, stderr: result.stderr }, { code: 0, stderr: '' });
    assertSuggestion(JSON.parse(result.stdout), tier, effort);
    assert.ok(!result.stdout.includes(prompt));
  }
  const noWorkspace = await runHook(hookEvent(RACE, join(cwd, 'deleted')), { cwd });
  assertSuggestion(JSON.parse(noWorkspace.stdout), 'frontier', 'high');

  const silent = [
    ['slash command', hookEvent('  /effort high', cwd)],
    ['bang command', hookEvent('  !npm test', cwd)],
    ['empty prompt', hookEvent('  ', cwd)],
    ['oversized prompt', hookEvent('typo ' + 'z'.repeat(100_001), cwd)],
    ['malformed JSON', '{"hook_event_name":"UserPromptSubmit","prompt":"PRIVATE_PROMPT_MARKER_2718'],
    ['not an object', '["UserPromptSubmit"]'],
    ['empty input', ''],
    ['oversized input', JSON.stringify(hookEvent('z'.repeat(2 * MAX_INPUT_BYTES), cwd))],
    ['another event', { ...hookEvent(RACE, cwd), hook_event_name: 'Stop' }],
  ];
  for (const [name, event] of silent) {
    const result = await runHook(event, { cwd });
    assert.deepEqual({ code: result.code, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, { code: 0, signal: null, stdout: '', stderr: '' }, name);
  }
});

test('repository breadth does not change the line: many languages or named files', async (t) => {
  // In a checkout with three or more languages, every prompt used to get "suggests high".
  const cwd = await tempProject(t);
  for (const file of ['a.py', 'b.go', 'c.ts', 'd.rs', 'e.js']) await writeFile(join(cwd, file), '\n');
  const cases = [
    ['Fix the typo in the README', 'fast'],
    ['continue', null],
    ['yes, go ahead', null],
    ['Fix the broken link in the README', null],
    ['Bump the version number in package.json', 'fast'],
    ['Change the button color from blue to green', null],
    [PLAIN, null],
    ['Update a.py, b.go, c.ts, d.rs and e.js to the new logger', null],
    [RACE, 'frontier'],
  ];
  for (const [prompt, expected] of cases) {
    const result = await runHook(hookEvent(prompt, cwd), { cwd });
    assert.equal(result.code, 0, prompt);
    assertSuggestion(JSON.parse(result.stdout), expected ?? 'daily', expected === 'fast' ? 'low' : expected === 'frontier' ? 'high' : 'medium');
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
  assertSuggestion(JSON.parse(result.stdout), 'frontier', 'high');
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
  for (const [file, source] of graph.files) {
    assert.doesNotMatch(source, /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/, `${file} makes no requests`);
    assert.doesNotMatch(source, /\b(?:writeFile|appendFile|createWriteStream|mkdir|mkdtemp|rm|unlink|rename|copyFile)(?:Sync)?\s*\(|\bconsole\.\w+\s*\(/, `${file} neither writes files nor logs`);
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
  assertSuggestion(JSON.parse(hook.stdout), 'fast', 'low');
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
