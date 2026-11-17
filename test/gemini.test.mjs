import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { capabilities, run } from '../src/adapters/gemini.mjs';
import { fakeRunConfig } from '../bench/fake/model.mjs';
import { unitHash } from '../bench/lib/random.mjs';

const SESSION = 'gemini-test-conversation_123';
const SHELL_LIMIT = 'Shell commands are not available in this session: read and edit files only, and do not run tests or other commands.';
const EMPTY_USAGE = { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null };
const argValue = (args, name) => args[args.indexOf(name) + 1];
const exists = async path => { try { await access(path); return true; } catch { return false; } };

async function fixture(t, body = 'emit(success);') {
  const cwd = await mkdtemp(join(tmpdir(), 'effort-gemini-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const scriptPath = join(cwd, 'fake-agy.cjs');
  const log = join(cwd, 'launch.json');
  const pidFile = join(cwd, 'pids.json');
  await writeFile(scriptPath, `const fs = require('node:fs');
const { spawn } = require('node:child_process');
const argv = process.argv.slice(2);
const flag = name => argv[argv.indexOf(name) + 1];
const emit = value => process.stdout.write(JSON.stringify(value));
const success = { conversation_id: ${JSON.stringify(SESSION)}, status: 'SUCCESS', response: 'Done.', duration_seconds: 0.1, num_turns: 1, usage: { input_tokens: 12, output_tokens: 7, thinking_tokens: 5, cache_read_tokens: 3, total_tokens: 24 } };
const logFile = flag('--log-file');
const pidFile = ${JSON.stringify(pidFile)};
fs.writeFileSync(logFile, 'Propagating selected model override to backend: label="Gemini 4 Hydrogen (Medium)"\\n');
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => stdin += chunk);
process.stdin.on('end', () => {
  fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, stdin, cwd: process.cwd(), logFile, directoryMode: fs.statSync(require('node:path').dirname(logFile)).mode & 0o777 }));
  ${body}
});
`);
  // Generous: a loaded machine can take seconds to start the fake CLI; timeout tests set their own.
  return { cwd, scriptPath, log, pidFile, options: { cwd, prompt: 'Read the fixture.', effort: 'medium', model: 'gemini-4-hydrogen', executable: process.execPath, executableArgs: [scriptPath], env: { PATH: process.env.PATH, HOME: cwd }, timeoutMs: 30_000 } };
}

async function launchAndAssertCleaned(f) {
  const launch = JSON.parse(await readFile(f.log, 'utf8'));
  assert.equal(await exists(dirname(launch.logFile)), false, 'private log directory remains after the turn');
  return launch;
}

function assertFailure(result, events, status, code) {
  assert.equal(result.status, status);
  assert.equal(events.at(-1)?.type, 'error');
  assert.equal(events.at(-1)?.code, code);
  assert.equal(events.at(-1)?.message, result.text);
}

async function assertDead(pid) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { process.kill(pid, 0); }
    catch (error) { assert.equal(error.code, 'ESRCH'); return; }
    await delay(25);
  }
  assert.fail(`process ${pid} survived cleanup`);
}

test('Gemini exports the bounded managed low/medium/high capability', () => {
  assert.equal(capabilities.id, 'gemini');
  assert.equal(capabilities.name, 'Gemini (Antigravity CLI)');
  assert.equal(capabilities.control, 'managed-turns');
  assert.deepEqual(capabilities.levels, ['low', 'medium', 'high']);
  assert.equal(capabilities.maxTurnTimeoutMs, 1_800_000);
  assert.ok(Object.isFrozen(capabilities));
});

test('Gemini sends a literal argv prompt with read-only session permissions and selection evidence', async t => {
  const f = await fixture(t);
  const marker = join(f.cwd, 'shell-ran');
  const prompt = `Read literally: $(touch ${marker}) \`touch ${marker}\` ; --dangerously-skip-permissions`;
  const events = [];
  const result = await run({ ...f.options, prompt, timeoutMs: 30_001, onEvent: event => events.push(event) });
  const launch = await launchAndAssertCleaned(f);
  assert.equal(result.status, 'completed');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.text, 'Done.');
  assert.equal(result.sessionId, SESSION);
  assert.equal(result.requestedEffort, 'medium');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7, cachedInputTokens: 3, costUsd: null });
  assert.equal(launch.stdin, '');
  assert.equal(launch.cwd, await realpath(f.cwd));
  assert.equal(argValue(launch.argv, '--print'), `${prompt}\n\n${SHELL_LIMIT}`);
  assert.equal(argValue(launch.argv, '--output-format'), 'json');
  assert.equal(argValue(launch.argv, '--model'), 'gemini-4-hydrogen');
  assert.equal(argValue(launch.argv, '--effort'), 'medium');
  assert.equal(argValue(launch.argv, '--mode'), 'plan');
  assert.equal(argValue(launch.argv, '--print-timeout'), '31s');
  assert.deepEqual(JSON.parse(argValue(launch.argv, '--settings')), { permissions: { allow: ['read_file(*)'] } });
  assert.ok(!launch.argv.includes('--conversation'));
  assert.ok(!launch.argv.includes('--dangerously-skip-permissions'));
  assert.equal(await exists(marker), false);
  if (process.platform !== 'win32') assert.equal(launch.directoryMode, 0o700);
  assert.deepEqual(result.effortEvidence, { type: 'launch-flag', flag: '--effort', requested: 'medium', observedLabel: 'Gemini 4 Hydrogen (Medium)', thinkingTokens: 5, observedModel: 'gemini-4-hydrogen', turnSubmitted: true });
  assert.ok(events.every(event => event.provider === 'gemini'));
  assert.ok(events.some(event => event.type === 'launch' && event.mode === 'read-only' && !event.effortEvidence.turnSubmitted));
  assert.ok(events.some(event => event.type === 'session' && event.sessionId === SESSION && event.model === 'gemini-4-hydrogen'));
  assert.ok(events.some(event => event.type === 'effort' && event.thinkingTokens === 5));
  assert.ok(!JSON.stringify({ result, events }).includes(prompt));
});

test('Gemini write turns use accept-edits and resume without reporting cumulative usage as per-turn', async t => {
  const f = await fixture(t);
  const result = await run({ ...f.options, allowWrite: true, effort: 'high', sessionId: SESSION });
  const { argv } = await launchAndAssertCleaned(f);
  assert.equal(result.status, 'completed');
  assert.equal(argValue(argv, '--conversation'), SESSION);
  assert.equal(argValue(argv, '--effort'), 'high');
  assert.equal(argValue(argv, '--mode'), 'accept-edits');
  assert.deepEqual(JSON.parse(argValue(argv, '--settings')), { permissions: { allow: ['read_file(*)', 'write_file(*)'] } });
  assert.deepEqual(result.usage, EMPTY_USAGE);
  assert.equal(result.effortEvidence.thinkingTokens, 5);
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
});

test('Gemini leaves the CLI default model unselected for an automatic-model fallback', async t => {
  const f = await fixture(t);
  const result = await run({ ...f.options, model: undefined });
  const { argv } = await launchAndAssertCleaned(f);
  assert.equal(result.status, 'completed');
  assert.ok(!argv.includes('--model'));
  assert.equal(result.effortEvidence.observedModel, null);
});

test('Gemini uses the last selection label and ignores unrelated log content', async t => {
  const f = await fixture(t, `fs.appendFileSync(logFile, 'private-log-text\\nOther message: label="Gemini 4 Hydrogen (High)"\\nPropagating selected model override to backend: label="Gemini 4 Argon (Low)"\\n'); emit(success);`);
  const result = await run({ ...f.options, model: 'gemini-4-argon', effort: 'low' });
  assert.equal(result.effortEvidence.observedLabel, 'Gemini 4 Argon (Low)');
  assert.equal(result.effortEvidence.observedModel, 'gemini-4-argon');
  assert.ok(!JSON.stringify(result).includes('private-log-text'));
  await launchAndAssertCleaned(f);
});

test('Gemini does not infer a requested model from a different, ambiguous, or missing label', async t => {
  for (const [model, body, expectedLabel] of [
    ['gemini-4-argon', 'emit(success);', 'Gemini 4 Hydrogen (Medium)'],
    ['gemini-4-hydrogen', `fs.writeFileSync(logFile, 'Propagating selected model override to backend: label="Hydrogen"'); emit(success);`, 'Hydrogen'],
    ['gemini-4-hydrogen', 'fs.unlinkSync(logFile); emit(success);', null],
  ]) {
    const f = await fixture(t, body);
    const result = await run({ ...f.options, model });
    assert.equal(result.status, 'completed');
    assert.equal(result.effortEvidence.observedLabel, expectedLabel);
    assert.equal(result.effortEvidence.observedModel, null);
    await launchAndAssertCleaned(f);
  }
});

test('Gemini denied tools block an empty response and preserve edits already made', async t => {
  const f = await fixture(t, `fs.writeFileSync('already-edited.txt', 'prior edit'); process.stderr.write('PRIVATE_STDERR'); emit({ ...success, response: '', denied_actions: [{ action: 'write_file', display_name: 'PRIVATE_DISPLAY_NAME' }, { action: 'run_command', display_name: 'PRIVATE_DISPLAY_NAME' }] });`);
  const events = [];
  const result = await run({ ...f.options, allowWrite: true, onEvent: event => events.push(event) });
  assertFailure(result, events, 'blocked', 'tool_denied');
  assert.match(result.text, /write_file/);
  assert.match(result.text, /run_command/);
  assert.equal(await readFile(join(f.cwd, 'already-edited.txt'), 'utf8'), 'prior edit');
  assert.ok(!JSON.stringify({ result, events }).includes('PRIVATE_'));
  await launchAndAssertCleaned(f);
});

test('Gemini empty successful responses without denied tools fail', async t => {
  for (const response of ['', ' \n\t']) {
    const f = await fixture(t, `emit({ ...success, response: ${JSON.stringify(response)} });`);
    const events = [];
    const result = await run({ ...f.options, onEvent: event => events.push(event) });
    assertFailure(result, events, 'failed', 'empty_response');
    await launchAndAssertCleaned(f);
  }
});

test('Gemini recognizes pre-submission model and effort rejections despite exit code zero', async t => {
  const cases = [
    ['invalid model selection (--model "unknown" --effort "low"): --effort is not supported for model "unknown"', 'model_unavailable'],
    ['invalid model selection (--model "gemini-4-argon" --effort "max"): invalid --effort "max" (valid: low, medium, high)', 'unsupported_effort'],
    ['invalid model selection (--model "gemini-4-argon" --effort "max"): gemini-4-argon has no "max" effort (available: low, medium, high)', 'unsupported_effort'],
  ];
  for (const [error, code] of cases) {
    const f = await fixture(t, `emit({ ...success, status: 'ERROR', conversation_id: '', response: '', error: ${JSON.stringify(error)}, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 } });`);
    const events = [];
    const result = await run({ ...f.options, onEvent: event => events.push(event) });
    assertFailure(result, events, 'blocked', code);
    assert.equal(result.sessionId, null);
    assert.equal(result.effortEvidence.turnSubmitted, false);
    assert.ok(!JSON.stringify({ result, events }).includes(error));
    await launchAndAssertCleaned(f);
  }
});

test('Gemini does not claim pre-submission rejection without zero turns', async t => {
  const f = await fixture(t, `emit({ ...success, status: 'ERROR', response: '', error: 'invalid model selection (--model "unknown" --effort "low"): --effort is not supported for model "unknown"' });`);
  const result = await run(f.options);
  assert.equal(result.status, 'blocked');
  assert.equal(result.effortEvidence.turnSubmitted, true);
  await launchAndAssertCleaned(f);
});

test('Gemini error results retain the incoming session when the provider returns no conversation id', async t => {
  const f = await fixture(t, `emit({ ...success, status: 'ERROR', conversation_id: '', response: '', error: 'private unclassified failure' });`);
  const events = [];
  const result = await run({ ...f.options, sessionId: SESSION, onEvent: event => events.push(event) });
  assertFailure(result, events, 'failed', 'cli_error');
  assert.equal(result.sessionId, SESSION);
  assert.deepEqual(result.usage, EMPTY_USAGE);
  assert.ok(!JSON.stringify({ result, events }).includes('private unclassified failure'));
  await launchAndAssertCleaned(f);
});

test('Gemini blocks access failures using fixed messages without leaking prompt, stderr, or provider errors', async t => {
  for (const [wording, code] of [
    ['Please sign in to continue', 'authentication_required'],
    ['Invalid API key', 'authentication_required'],
    ['OAuth token expired', 'authentication_required'],
    ['payment required', 'account_blocked'],
    ['quota exceeded', 'rate_limited'],
    ['rate-limit reached', 'rate_limited'],
    ['usage limit reached', 'rate_limited'],
    ['permission denied', 'permission_denied'],
  ]) {
    const secret = 'PRIVATE_PROVIDER_SECRET';
    const prompt = 'PRIVATE_PROMPT_CONTENT';
    const f = await fixture(t, `process.stderr.write(${JSON.stringify(secret)}); emit({ ...success, status: 'ERROR', response: ${JSON.stringify(secret)}, error: ${JSON.stringify(`${wording}: ${secret}`)} });`);
    const events = [];
    const result = await run({ ...f.options, prompt, onEvent: event => events.push(event) });
    assertFailure(result, events, 'blocked', code);
    assert.ok(!JSON.stringify({ result, events }).includes(secret));
    assert.ok(!JSON.stringify({ result, events }).includes(prompt));
    await launchAndAssertCleaned(f);
  }
});

test('Gemini maps the provider print timeout to a failed timeout', async t => {
  const f = await fixture(t, `emit({ ...success, status: 'ERROR', response: '', error: 'PRIVATE_TIMEOUT_ERROR', finished_reason: 'print_timeout' });`);
  const events = [];
  const result = await run({ ...f.options, onEvent: event => events.push(event) });
  assertFailure(result, events, 'failed', 'timeout');
  assert.equal(result.effortEvidence.turnSubmitted, true);
  assert.ok(!JSON.stringify({ result, events }).includes('PRIVATE_TIMEOUT_ERROR'));
  await launchAndAssertCleaned(f);
});

test('Gemini rejects malformed or oversized stdout and removes its private log directory', async t => {
  for (const body of [
    `process.stdout.write('PRIVATE_MALFORMED_OUTPUT');`,
    `process.stdout.write(JSON.stringify(success) + JSON.stringify(success));`,
    `emit([]);`,
    `emit({ ...success, status: 'UNKNOWN' });`,
    `emit({ ...success, response: 42 });`,
    `emit({ ...success, conversation_id: '../private' });`,
    `emit({ ...success, response: 'x'.repeat(8 * 1024 * 1024 + 1) });`,
  ]) {
    const f = await fixture(t, body);
    const events = [];
    const result = await run({ ...f.options, onEvent: event => events.push(event) });
    assertFailure(result, events, 'failed', 'malformed_output');
    assert.ok(!JSON.stringify({ result, events }).includes('PRIVATE_MALFORMED_OUTPUT'));
    await launchAndAssertCleaned(f);
  }
});

test('Gemini success with a nonzero exit code fails without revealing stderr', async t => {
  const f = await fixture(t, `emit(success); process.stderr.write('PRIVATE_STDERR'); process.exitCode = 3;`);
  const events = [];
  const result = await run({ ...f.options, onEvent: event => events.push(event) });
  assertFailure(result, events, 'failed', 'cli_error');
  assert.ok(!JSON.stringify({ result, events }).includes('PRIVATE_STDERR'));
  await launchAndAssertCleaned(f);
});

test('Gemini unavailable usage stays null instead of inventing token counts', async t => {
  const f = await fixture(t, `emit({ ...success, usage: { input_tokens: -1, output_tokens: '7', thinking_tokens: null, cache_read_tokens: null } });`);
  const result = await run(f.options);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.usage, EMPTY_USAGE);
  assert.equal(result.effortEvidence.thinkingTokens, null);
  await launchAndAssertCleaned(f);
});

test('Gemini validates bounded inputs before starting a process', async t => {
  const f = await fixture(t);
  for (const change of [
    { effort: 'max' }, { effort: 'HIGH' }, { prompt: '' }, { prompt: ' \t' },
    { prompt: 'x\0y' }, { prompt: 'x'.repeat(1024 * 1024 + 1) }, { cwd: '.' },
    { cwd: `${f.cwd}\n` }, { model: '--effort low' }, { model: 'gemini-4-argon\n' },
    { model: 'x'.repeat(201) }, { sessionId: '../session' }, { sessionId: 'x'.repeat(257) },
    { allowWrite: 'false' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 1.5 },
    { timeoutMs: 1_800_001 }, { onEvent: null }, { signal: {} },
    { executable: 'x\0y' }, { executableArgs: 'not-an-array' }, { executableArgs: ['x\0y'] },
    { executableArgs: [12] }, { executableArgs: Array(17).fill('x') },
    { env: { PATH: ['not', 'a', 'string'] } },
  ]) await assert.rejects(run({ ...f.options, ...change }), { name: /TypeError|RangeError/ });
  assert.equal(await exists(f.log), false);
});

test('Gemini missing executables, bad overrides, and missing directories return blocked results', async t => {
  const f = await fixture(t);
  for (const [change, code, message] of [
    [{ executable: join(f.cwd, 'missing-agy') }, 'missing_cli', /agy/],
    [{ executable: undefined, executableArgs: undefined, env: { ...f.options.env, EFFORT_GEMINI_BIN: join(f.cwd, 'missing.cjs') } }, 'cli_unavailable', /EFFORT_GEMINI_BIN points to .*missing\.cjs, which does not exist/],
    [{ cwd: join(f.cwd, 'missing-workspace') }, 'invalid_cwd', /working directory/],
    [{ cwd: f.scriptPath }, 'invalid_cwd', /working directory/],
  ]) {
    const events = [];
    const result = await run({ ...f.options, ...change, onEvent: event => events.push(event) });
    assertFailure(result, events, 'blocked', code);
    assert.match(result.text, message);
    assert.equal(result.effortEvidence.turnSubmitted, false);
    assert.equal(await exists(f.log), false);
  }
});

test('Gemini EFFORT_GEMINI_BIN selects a JavaScript CLI without a shell', async t => {
  const f = await fixture(t);
  const result = await run({ ...f.options, executable: undefined, executableArgs: undefined, env: { ...f.options.env, EFFORT_GEMINI_BIN: f.scriptPath } });
  assert.equal(result.status, 'completed');
  await launchAndAssertCleaned(f);
});

test('Gemini pre-aborted turns do not launch or submit a prompt', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const events = [];
  const result = await run({ ...f.options, signal: controller.signal, onEvent: event => events.push(event) });
  assertFailure(result, events, 'cancelled', 'aborted');
  assert.equal(result.effortEvidence.turnSubmitted, false);
  assert.equal(await exists(f.log), false);
});

test('Gemini callback failures are contained and temporary logs are removed', async t => {
  const f = await fixture(t);
  const result = await run({ ...f.options, onEvent: event => { if (event.type === 'session') throw new Error('PRIVATE_CALLBACK_ERROR'); } });
  assert.equal(result.status, 'failed');
  assert.match(result.text, /callback/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CALLBACK_ERROR'));
  await launchAndAssertCleaned(f);
});

test('Gemini own timeout kills the process group and removes its private log directory', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, `const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); process.send("ready");'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.once('message', () => fs.writeFileSync(pidFile, JSON.stringify([process.pid, child.pid])));
    process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`);
  const realTimeout = globalThis.setTimeout;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const controller = new AbortController();
  let timersActive = true;
  t.after(() => { controller.abort(); if (timersActive) { t.mock.timers.tick(500); t.mock.timers.reset(); } });
  const events = [];
  const running = run({ ...f.options, timeoutMs: 400, signal: controller.signal, onEvent: event => events.push(event) });
  const startup = performance.now();
  while (!await exists(f.pidFile)) {
    assert.ok(performance.now() - startup < 10_000, 'fixture did not become ready');
    await new Promise(done => realTimeout(done, 20));
  }
  t.mock.timers.tick(400);
  t.mock.timers.tick(500);
  const result = await Promise.race([running, new Promise((_, reject) => realTimeout(() => reject(new Error('timed-out run never finished')), 10_000).unref())]);
  t.mock.timers.reset();
  timersActive = false;
  assertFailure(result, events, 'failed', 'timeout');
  assert.equal(result.effortEvidence.turnSubmitted, true);
  for (const pid of JSON.parse(await readFile(f.pidFile, 'utf8'))) await assertDead(pid);
  await launchAndAssertCleaned(f);
});

test('Gemini abort after startup kills the active process and removes its private log directory', async t => {
  const f = await fixture(t, `process.on('SIGTERM', () => {}); fs.writeFileSync(pidFile, JSON.stringify([process.pid])); setInterval(() => {}, 1000);`);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = [];
  const running = run({ ...f.options, timeoutMs: 15_000, signal: controller.signal, onEvent: event => events.push(event) });
  const startup = performance.now();
  while (!await exists(f.pidFile)) {
    assert.ok(performance.now() - startup < 10_000, 'fixture did not become ready');
    await delay(20);
  }
  controller.abort();
  const result = await running;
  assertFailure(result, events, 'cancelled', 'aborted');
  assert.equal(result.effortEvidence.turnSubmitted, true);
  for (const pid of JSON.parse(await readFile(f.pidFile, 'utf8'))) await assertDead(pid);
  await launchAndAssertCleaned(f);
});

test('Gemini benchmark fake supports read-only and resumed write turns with persistent conversation state', async t => {
  const f = await fixture(t);
  const workspace = join(f.cwd, 'workspace');
  const solutionDir = join(f.cwd, 'solution');
  await mkdir(workspace);
  await mkdir(solutionDir);
  await writeFile(join(solutionDir, 'answer.txt'), 'reference solution');
  const stateFile = join(f.cwd, 'state.json');
  const configFile = join(f.cwd, 'config.json');
  let seed = 0;
  while (unitHash(seed, 'gemini', 'adapter-test', 0, 2) >= 0.99) seed++;
  await writeFile(configFile, JSON.stringify(fakeRunConfig({ provider: 'gemini', task: { id: 'adapter-test', difficulty: 'easy', solutionDir }, repeat: 0, seed, stateFile, model: 'gemini-4-argon' })));
  const options = { ...f.options, cwd: workspace, model: 'gemini-4-argon', effort: 'high', executableArgs: [fileURLToPath(new URL('../bench/fake/gemini.mjs', import.meta.url)), '--bench-config', configFile] };
  const first = await run(options);
  assert.equal(first.status, 'completed');
  assert.match(first.text, /left the workspace unchanged/);
  assert.equal(await exists(join(workspace, 'answer.txt')), false);
  assert.equal(first.effortEvidence.observedLabel, 'Gemini 4 Argon (High)');
  assert.equal(first.effortEvidence.observedModel, 'gemini-4-argon');
  assert.ok(first.usage.inputTokens > 0);
  const second = await run({ ...options, sessionId: first.sessionId, allowWrite: true });
  assert.equal(second.status, 'completed');
  assert.equal(second.sessionId, first.sessionId);
  assert.match(second.text, /applied the reference solution/);
  assert.equal(await readFile(join(workspace, 'answer.txt'), 'utf8'), 'reference solution');
  assert.deepEqual(second.usage, EMPTY_USAGE);
  assert.equal(second.effortEvidence.thinkingTokens, 0);
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.equal(state.turns, 2);
  assert.equal(state.sessions[first.sessionId].num_turns, 2);
  assert.ok(state.sessions[first.sessionId].input_tokens > first.usage.inputTokens);
});
