import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { capabilities, run } from '../src/adapters/claude.mjs';

const SESSION = '12345678-1234-4234-8234-123456789abc';
const OTHER_SESSION = '87654321-1234-4234-8234-123456789abc';
const HELP = '--print --output-format --verbose --effort --resume --restricted --safe-mode --permission-mode --permission-prompts --tools --allowedTools --disallowedTools --strict-mcp-config --mcp-config --settings --setting-sources --disable-slash-commands --no-chrome';

async function fixture(t, body = '', { help = HELP, startup = true } = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'effort-claude-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const executable = process.execPath;
  const scriptPath = join(cwd, 'fake-claude.cjs');
  const log = join(cwd, 'launch.json');
  const pidFile = join(cwd, 'pids.json');
  const script = `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const argv = process.argv.slice(2);
if (argv.includes('--help')) { process.stdout.write(${JSON.stringify(help)}); process.exit(0); }
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const flag = (name) => argv[argv.indexOf(name) + 1];
const initial = { type: 'system', subtype: 'init', session_id: ${JSON.stringify(SESSION)}, model: 'claude-sonnet-4-6', tools: flag('--tools').split(','), mcp_servers: [], plugins: [], permissionMode: flag('--permission-mode') };
const success = { type: 'result', subtype: 'success', is_error: false, session_id: ${JSON.stringify(SESSION)}, result: 'Done.', usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 }, total_cost_usd: 0.012 };
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (s) => stdin += s);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin, env: process.env, cwd: process.cwd() }));
  ${startup ? 'emit(initial);' : ''}
  ${body || 'emit(success);'}
});
`;
  await writeFile(scriptPath, script);
  return { cwd, executable, scriptPath, log, pidFile, options: { prompt: 'Read the fixture.', cwd, executable, executableArgs: [scriptPath], effort: 'medium', env: { PATH: process.env.PATH, HOME: cwd }, timeoutMs: 4000 } };
}

const argValue = (args, name) => args[args.indexOf(name) + 1];
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

test('exports the managed low/medium/high capability', () => {
  assert.equal(capabilities.id, 'claude');
  assert.equal(capabilities.control, 'managed-turns');
  assert.deepEqual(capabilities.levels, ['low', 'medium', 'high']);
});

test('passes a literal prompt on stdin and isolates default read-only turns', async (t) => {
  const f = await fixture(t);
  const marker = join(f.cwd, 'shell-ran');
  const prompt = `Read this literally: $(touch ${marker}) \`touch ${marker}\` ; --dangerously-skip-permissions`;
  const events = [];
  const sourceEnv = { PATH: process.env.PATH, HOME: f.cwd, USER: 'fixture-user', LOGNAME: 'fixture-user', USERNAME: 'fixture-user', ANTHROPIC_API_KEY: 'fake-test-secret', CLAUDE_CODE_EFFORT_LEVEL: 'max', NODE_OPTIONS: '--require /must/not/run.js', CLAUDE_CODE_SYNC_PLUGIN_INSTALL: '1', CUSTOM_HOOK: 'run' };
  const before = { ...sourceEnv };
  const result = await run({ ...f.options, prompt, effort: 'low', env: sourceEnv, onEvent: (event) => events.push(event) });
  const launch = JSON.parse(await readFile(f.log, 'utf8'));
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Done.');
  assert.equal(result.sessionId, SESSION);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7, cachedInputTokens: 3, costUsd: 0.012 });
  assert.equal(launch.stdin, prompt);
  assert.ok(!launch.argv.includes(prompt));
  assert.equal(await exists(marker), false);
  assert.equal(argValue(launch.argv, '--effort'), 'low');
  assert.equal(argValue(launch.argv, '--permission-mode'), 'dontAsk');
  assert.equal(argValue(launch.argv, '--permission-prompts'), 'none');
  assert.equal(argValue(launch.argv, '--tools'), 'Read,Grep,Glob');
  assert.equal(argValue(launch.argv, '--setting-sources'), '');
  assert.equal(argValue(launch.argv, '--mcp-config'), '{"mcpServers":{}}');
  for (const flag of ['--restricted', '--safe-mode', '--strict-mcp-config', '--disable-slash-commands', '--no-chrome']) assert.ok(launch.argv.includes(flag));
  assert.ok(!launch.argv.includes('--dangerously-skip-permissions'));
  assert.ok(!launch.argv.includes('--allow-dangerously-skip-permissions'));
  assert.ok(!launch.argv.includes('--bare'));
  assert.ok(!launch.argv.includes('--add-dir'));
  const denied = argValue(launch.argv, '--disallowedTools').split(',');
  for (const name of ['Bash', 'Edit', 'Write', 'Agent', 'Task', 'Skill', 'mcp__*']) assert.ok(denied.includes(name));
  const settings = JSON.parse(argValue(launch.argv, '--settings'));
  assert.equal(settings.disableAllHooks, true);
  assert.equal(settings.switchModelsOnFlag, false);
  assert.deepEqual(settings.fallbackModel, []);
  assert.deepEqual(settings.permissions.additionalDirectories, []);
  assert.equal(launch.env.CLAUDE_CODE_EFFORT_LEVEL, 'low');
  assert.equal(launch.env.ANTHROPIC_API_KEY, 'fake-test-secret');
  assert.equal(launch.env.USER, 'fixture-user');
  assert.equal(launch.env.LOGNAME, 'fixture-user');
  assert.equal(launch.env.USERNAME, 'fixture-user');
  assert.equal(launch.env.NODE_OPTIONS, undefined);
  assert.equal(launch.env.CLAUDE_CODE_SYNC_PLUGIN_INSTALL, undefined);
  assert.equal(launch.env.CUSTOM_HOOK, undefined);
  assert.deepEqual(sourceEnv, before);
  assert.equal(result.effortEvidence.type, 'launch-flag');
  assert.equal(result.effortEvidence.launchAccepted, true);
  assert.equal(result.effortEvidence.observedEffort, null);
  assert.equal(result.effortEvidence.verified, false);
  assert.match(result.effortEvidence.note, /caps/);
  assert.ok(events.some((e) => e.type === 'session'));
  assert.ok(!JSON.stringify(events).includes('fake-test-secret'));
  assert.ok(!JSON.stringify(events).includes(prompt));
});

test('explicit write mode retains restrictions and resumes at the next effort', async (t) => {
  const f = await fixture(t);
  const result = await run({ ...f.options, effort: 'high', sessionId: SESSION, model: 'sonnet', allowWrite: true, maxTurns: 3, maxBudgetUsd: 0.15 });
  const { argv } = JSON.parse(await readFile(f.log, 'utf8'));
  assert.equal(result.status, 'completed');
  assert.equal(argValue(argv, '--resume'), SESSION);
  assert.equal(argValue(argv, '--effort'), 'high');
  assert.equal(argValue(argv, '--model'), 'sonnet');
  assert.equal(argValue(argv, '--tools'), 'Read,Grep,Glob,Edit,Write');
  assert.equal(argValue(argv, '--permission-mode'), 'acceptEdits');
  assert.equal(argValue(argv, '--permission-prompts'), 'none');
  assert.equal(argValue(argv, '--max-turns'), '3');
  assert.equal(argValue(argv, '--max-budget-usd'), '0.15');
  assert.ok(argv.includes('--restricted'));
  assert.ok(!argValue(argv, '--disallowedTools').split(',').includes('Edit'));
  assert.equal(result.usage.costUsd, null);
  assert.equal(result.usage.inputTokens, null);
  assert.equal(result.usage.outputTokens, null);
  assert.equal(result.usage.cachedInputTokens, null);
  assert.equal(result.usage.conversationCostUsd, 0.012);
  assert.equal(result.usage.costScope, 'conversation');
});

// Top-level assistant events as the CLI streams them: one per content block,
// each repeating its API response's id and usage, with a placeholder output count.
const ASSISTANT = `const assistant = (id, usage, content, parent = null) => emit({ type: 'assistant', session_id: initial.session_id, parent_tool_use_id: parent, message: { id, model: initial.model, content, usage } });
const first = { input_tokens: 6, cache_read_input_tokens: 4000, cache_creation_input_tokens: 300, output_tokens: 1 };
const second = { input_tokens: 9, cache_read_input_tokens: 4300, cache_creation_input_tokens: 0, output_tokens: 1 };
`;

test('a resumed turn reports its own tokens when its assistant events account for the result usage', async (t) => {
  const f = await fixture(t, `${ASSISTANT}
    assistant('msg_1', first, [{ type: 'text', text: 'Reading.' }]);
    assistant('msg_1', first, [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'notes.txt' } }]);
    emit({ type: 'user', session_id: initial.session_id, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'notes' }] } });
    assistant('msg_sub', { input_tokens: 500, output_tokens: 50 }, [], 'toolu_9');
    emit({ type: 'assistant', session_id: initial.session_id, parent_tool_use_id: null, message: { model: '<synthetic>', content: [], usage: { input_tokens: 0, output_tokens: 0 } } });
    assistant('msg_2', second, [{ type: 'text', text: 'Done.' }]);
    emit({ ...success, usage: { input_tokens: 15, cache_read_input_tokens: 8300, cache_creation_input_tokens: 300, output_tokens: 420 }, total_cost_usd: 0.31 });
  `);
  const result = await run({ ...f.options, sessionId: SESSION });
  assert.equal(result.status, 'completed');
  // msg_1 counts once, the subagent and <synthetic> events not at all, and the
  // output count comes from the result, not from the placeholders.
  assert.deepEqual(result.usage, { inputTokens: 15, outputTokens: 420, cachedInputTokens: 8300, costUsd: null,
    conversationCostUsd: 0.31, costScope: 'conversation', tokenScope: 'turn' });
});

test('a resumed turn keeps null tokens when they cannot be attributed to it', async (t) => {
  const cumulative = `${ASSISTANT}
    assistant('msg_1', first, [{ type: 'text', text: 'Done.' }]);
    emit({ ...success, usage: { input_tokens: 60, cache_read_input_tokens: 40000, cache_creation_input_tokens: 3000, output_tokens: 700 } });`;
  const cases = [
    ['no assistant events', 'emit(success);'],
    ['usage that includes earlier turns', cumulative],
    ['usage that leaves out a response', `${ASSISTANT}
      assistant('msg_1', first, [{ type: 'text', text: 'Working.' }]);
      assistant('msg_2', second, [{ type: 'text', text: 'Over budget.' }]);
      emit({ ...success, subtype: 'error_max_budget_usd', is_error: true, usage: { ...first, output_tokens: 80 } });`],
    ['an event without a message id', `${ASSISTANT}
      assistant(undefined, first, [{ type: 'text', text: 'Done.' }]);
      emit({ ...success, usage: { ...first, output_tokens: 80 } });`],
    ['an event without usage', `${ASSISTANT}
      assistant('msg_1', undefined, [{ type: 'text', text: 'Done.' }]);
      emit({ ...success, usage: { ...first, output_tokens: 80 } });`],
    ['an invalid result output count', `${ASSISTANT}
      assistant('msg_1', first, [{ type: 'text', text: 'Done.' }]);
      emit({ ...success, usage: { ...first, output_tokens: '80' } });`],
  ];
  for (const [name, body] of cases) {
    const f = await fixture(t, body);
    const result = await run({ ...f.options, sessionId: SESSION });
    assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null,
      conversationCostUsd: 0.012, costScope: 'conversation', tokenScope: 'unverified-on-resume' }, name);
  }
  // A new session has no earlier turns, so its result usage is reported as before.
  const f = await fixture(t, cumulative);
  assert.deepEqual((await run(f.options)).usage, { inputTokens: 60, outputTokens: 700, cachedInputTokens: 40000, costUsd: 0.012 });
});

test('validates inputs before any process launch', async (t) => {
  const f = await fixture(t);
  const invalid = [
    { effort: 'max' }, { effort: 'HIGH' }, { prompt: '' }, { prompt: '/config model=haiku' },
    { prompt: 'x\0y' }, { prompt: 'x'.repeat(1024 * 1024 + 1) }, { cwd: '.' },
    { model: '--effort low' }, { model: 'sonnet\n' }, { sessionId: '/tmp/transcript.jsonl' },
    { sessionId: 'my-session' }, { allowWrite: 'false' }, { timeoutMs: 0 },
    { timeoutMs: Infinity }, { timeoutMs: 1_800_001 }, { onEvent: null }, { signal: {} },
    { maxTurns: 0 }, { maxTurns: 51 }, { maxBudgetUsd: 0 }, { maxBudgetUsd: NaN },
    { executable: 'x\0y' }, { executableArgs: 'not-an-array' }, { executableArgs: ['x\0y'] }, { executableArgs: [12] },
    { executableArgs: Array(17).fill('x') }, { env: { PATH: ['not', 'a', 'string'] } },
  ];
  for (const change of invalid) await assert.rejects(run({ ...f.options, ...change }), { name: /TypeError|RangeError/ });
  assert.equal(await exists(f.log), false);
});

test('unknown isolation flags block before a provider turn', async (t) => {
  const f = await fixture(t, '', { help: HELP.replace('--restricted', '') });
  const events = [];
  const result = await run({ ...f.options, onEvent: (e) => events.push(e) });
  assert.equal(result.status, 'blocked');
  assert.equal(events.at(-1).code, 'unsupported_cli');
  assert.equal(result.effortEvidence.launchAccepted, false);
  assert.equal(await exists(f.log), false);
});

test('missing executable and working directory return useful blocked results', async (t) => {
  const f = await fixture(t);
  assert.equal((await run({ ...f.options, executable: join(f.cwd, 'missing-cli') })).status, 'blocked');
  assert.match((await run({ ...f.options, cwd: join(f.cwd, 'missing-cwd') })).text, /working directory/);
});

test('finds an npm-installed Claude CLI on Windows without a shell', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  // npm writes claude.cmd; Node cannot spawn it directly, so the adapter runs its script.
  await writeFile(join(f.cwd, 'claude.cmd'), `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\fake-claude.cjs" %*\r\n`);
  const result = await run({ ...f.options, executable: undefined, executableArgs: undefined, env: { PATH: f.cwd, HOME: f.cwd } });
  assert.equal(result.status, 'completed');
  assert.equal(argValue(JSON.parse(await readFile(f.log, 'utf8')).argv, '--effort'), 'medium');
});

test('a broken EFFORT_CLAUDE_BIN is a blocked turn that explains itself, not an exception', async (t) => {
  const f = await fixture(t);
  const result = await run({ ...f.options, executable: undefined, executableArgs: undefined, env: { ...f.options.env, EFFORT_CLAUDE_BIN: join(f.cwd, 'missing.cjs') } });
  assert.equal(result.status, 'blocked');
  assert.match(result.text, /EFFORT_CLAUDE_BIN points to .*missing\.cjs, which does not exist/);
  assert.equal(await exists(f.log), false);
});

test('EFFORT_CLAUDE_BIN selects the Claude CLI when no executable is given', async (t) => {
  const f = await fixture(t);
  const result = await run({ ...f.options, executable: undefined, executableArgs: undefined, env: { ...f.options.env, EFFORT_CLAUDE_BIN: f.scriptPath } });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, 'Done.');
});

test('known unsupported effort models block before invoking the CLI', async (t) => {
  const f = await fixture(t);
  for (const model of ['haiku', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'opusplan']) {
    const result = await run({ ...f.options, model });
    assert.equal(result.status, 'blocked', model);
    assert.match(result.text, /does not support/);
  }
  assert.equal(await exists(f.log), false);
});

test('provider errors and stderr do not leak credential values', async (t) => {
  const secret = 'sk-ant-not-real-test-credential';
  const f = await fixture(t, `emit({ ...success, subtype: 'error_during_execution', is_error: true, result: 'Invalid API key: ${secret}', errors: ['${secret}'] }); process.stderr.write('${secret}'); process.exitCode = 1;`);
  const events = [];
  const result = await run({ ...f.options, onEvent: (e) => events.push(e) });
  assert.equal(result.status, 'blocked');
  assert.match(result.text, /authentication/);
  assert.ok(!JSON.stringify({ result, events }).includes(secret));
});

test('an assistant error such as a usage limit outlives result text the adapter does not recognize', async (t) => {
  // When the account's quota refuses a request, Claude Code marks a synthetic assistant message with
  // error 'rate_limit' and ends the turn with an is_error result in its own words.
  const limit = 'You have hit your limit · resets 5pm';
  const f = await fixture(t, `emit({ type: 'assistant', session_id: ${JSON.stringify(SESSION)}, error: 'rate_limit', message: { model: '<synthetic>', content: [{ type: 'text', text: '${limit}' }] } }); emit({ ...success, is_error: true, result: '${limit}' }); process.exitCode = 1;`);
  const events = [];
  const result = await run({ ...f.options, onEvent: (event) => events.push(event) });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(events.filter((event) => event.type === 'error').map((event) => event.code), ['rate_limited']);
  // Without an assistant error, unrecognized result text is still a generic CLI failure.
  const plain = await fixture(t, `emit({ ...success, is_error: true, result: '${limit}' }); process.exitCode = 1;`);
  const codes = [];
  assert.equal((await run({ ...plain.options, onEvent: (event) => { if (event.type === 'error') codes.push(event.code); } })).status, 'failed');
  assert.deepEqual(codes, ['cli_error']);
});

test('success output with a nonzero exit is still a failure', async (t) => {
  const f = await fixture(t, 'emit(success); process.stderr.write("private environment secret"); process.exitCode = 2;');
  const result = await run(f.options);
  assert.equal(result.status, 'failed');
  assert.ok(!result.text.includes('private environment'));
});

test('requires a valid terminal result and bounded JSON protocol', async (t) => {
  const cases = [
    ['process.stdout.write("not-json\\n");', 'failed'],
    ['emit({ type: "assistant", message: { content: [{ type: "text", text: "not terminal" }] } });', 'failed'],
    ['process.stdout.write("x".repeat(1024 * 1024 + 1));', 'failed'],
    ['emit({ ...success, result: "x".repeat(512 * 1024 + 1) });', 'failed'],
    ['emit(success); emit(success);', 'failed'],
    ['emit({ ...success, usage: { input_tokens: -1, output_tokens: "7" }, total_cost_usd: null });', 'completed'],
  ];
  for (const [body, status] of cases) {
    const f = await fixture(t, body);
    const result = await run(f.options);
    assert.equal(result.status, status, body);
    if (body.includes('input_tokens: -1')) assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null });
  }
});

test('accepts a terminal JSON line without a trailing newline', async (t) => {
  const f = await fixture(t, 'process.stdout.write(JSON.stringify({ ...success, result: "café 🧪" }));');
  assert.equal((await run(f.options)).text, 'café 🧪');
});

test('accepts only the observed native built-in plugin descriptors', async (t) => {
  const f = await fixture(t, 'emit({ ...initial, plugins: [{ name: "agents-md", path: "builtin" }] }); emit(success);', { startup: false });
  assert.equal((await run(f.options)).status, 'completed');
  // Claude Code 2.1.299 in safe mode, captured from a live initialization.
  const current = await fixture(t, 'emit({ ...initial, plugins: [{ name: "cc-plugin-agents-md", path: "builtin" }, { name: "cc-plugin-plugin-authoring", path: "builtin" }] }); emit(success);', { startup: false });
  assert.equal((await run(current.options)).status, 'completed');
});

test('matches one model across CLI context-window and API model spellings', async (t) => {
  const f = await fixture(t, 'emit({ ...initial, model: "claude-opus-5-5[1m]" }); emit({ type: "assistant", message: { model: "claude-opus-5-5", content: [{ type: "text", text: "Done." }] } }); emit(success);', { startup: false });
  const result = await run({ ...f.options, model: 'claude-opus-5-5[1m]' });
  assert.equal(result.status, 'completed');
  assert.equal(result.effortEvidence.observedModel, 'claude-opus-5-5[1m]');
});

test('permission denials do not become successful completion', async (t) => {
  const f = await fixture(t, 'emit({ type: "system", subtype: "permission_denied" }); emit({ ...success, permission_denials: [{ tool_name: "Write" }] });');
  const result = await run(f.options);
  assert.equal(result.status, 'blocked');
  assert.match(result.text, /permissions/);
});

test('reports turn and budget exhaustion as blocked', async (t) => {
  for (const subtype of ['error_max_turns', 'error_max_budget_usd']) {
    const f = await fixture(t, `emit({ ...success, subtype: ${JSON.stringify(subtype)}, is_error: true });`);
    const result = await run(f.options);
    assert.equal(result.status, 'blocked');
    assert.match(result.text, /limit/);
  }
});

test('checks session, model, tools, plugins, hooks and permission evidence', async (t) => {
  const cases = [
    [`emit({ ...initial, tools: ['Read', 'Bash'] });`, 'isolation_mismatch'],
    [`emit({ ...initial, mcp_servers: [{ name: 'unexpected', status: 'connected' }] });`, 'isolation_mismatch'],
    [`emit({ ...initial, plugins: [{ name: 'unexpected' }] });`, 'isolation_mismatch'],
    [`emit({ ...initial, plugins: [{ name: 'agents-md', path: '/tmp/arbitrary-plugin' }] });`, 'isolation_mismatch'],
    [`emit({ ...initial, plugins: [{ name: 'unexpected', path: 'builtin' }] });`, 'isolation_mismatch'],
    [`emit({ ...initial, plugins: [{ name: 'cc-plugin-telemetry', path: 'builtin' }] });`, 'isolation_mismatch'],
    [`emit({ ...initial, plugins: [{ name: 'cc-plugin-plugin-authoring', path: '/tmp/arbitrary-plugin' }] });`, 'isolation_mismatch'],
    [`emit({ type: 'system', subtype: 'hook_started' });`, 'isolation_mismatch'],
    [`emit({ ...initial, permissionMode: 'bypassPermissions' });`, 'isolation_mismatch'],
    [`emit({ ...initial, session_id: ${JSON.stringify(OTHER_SESSION)} });`, 'session_mismatch'],
    [`emit({ ...initial, model: 'claude-opus-4-6' });`, 'model_mismatch'],
    [`emit(initial); emit({ type: 'assistant', message: { model: 'claude-opus-4-6', content: [] } });`, 'model_mismatch'],
    [`emit(initial); emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'secret' } }] } });`, 'isolation_mismatch'],
  ];
  for (const [body, code] of cases) {
    const f = await fixture(t, body, { startup: false });
    const events = [];
    const result = await run({ ...f.options, model: 'sonnet', sessionId: SESSION, onEvent: (e) => events.push(e) });
    assert.notEqual(result.status, 'completed');
    assert.equal(events.at(-1).code, code);
  }
});

test('pre-aborted runs never start a process', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const result = await run({ ...f.options, signal: controller.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(await exists(f.log), false);
});

test('callback exceptions stop the run without escaping event-loop errors', async (t) => {
  const f = await fixture(t, 'setInterval(() => {}, 1000);');
  const result = await run({ ...f.options, onEvent: (e) => { if (e.type === 'session') throw new Error('private'); } });
  assert.equal(result.status, 'failed');
  assert.match(result.text, /callback/);
  assert.ok(!result.text.includes('private'));
});

test('timeout kills the managed process group including stubborn descendants', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t, `
    const descendant = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify('PIDS_PLACEHOLDER')}, JSON.stringify([process.pid, descendant.pid]));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  `);
  const source = await readFile(f.scriptPath, 'utf8');
  await writeFile(f.scriptPath, source.replace(JSON.stringify('PIDS_PLACEHOLDER'), JSON.stringify(f.pidFile)));
  const start = Date.now();
  const result = await run({ ...f.options, timeoutMs: 400 });
  assert.equal(result.status, 'failed');
  assert.match(result.text, /timeout/);
  assert.ok(Date.now() - start < 3000);
  const pids = JSON.parse(await readFile(f.pidFile, 'utf8'));
  for (const pid of pids) {
    let alive = true;
    for (let attempt = 0; attempt < 30 && alive; attempt++) {
      try { process.kill(pid, 0); await delay(30); } catch (error) { assert.equal(error.code, 'ESRCH'); alive = false; }
    }
    assert.equal(alive, false, `process ${pid} survived the timeout`);
  }
});

test('abort after startup terminates an active CLI process', async (t) => {
  const f = await fixture(t, 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);');
  const controller = new AbortController();
  const result = await run({ ...f.options, signal: controller.signal, onEvent: (e) => { if (e.type === 'session') controller.abort(); } });
  assert.equal(result.status, 'cancelled');
});
