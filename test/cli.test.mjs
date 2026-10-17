import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/effort.mjs', import.meta.url));

// The CLI runs with an empty PATH and private metadata directory: no provider can launch.
async function fixture(t) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'effort-cli-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = { PATH: cwd, HOME: cwd, USERPROFILE: cwd, EFFORT_DATA_DIR: join(cwd, 'metadata') };
  for (const key of ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (process.env[key]) env[key] = process.env[key];
  const invoke = (args, extraEnv = {}) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd, env: { ...env, ...extraEnv }, input: '', encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false,
    });
    if (result.error) throw result.error;
    return result;
  };
  return { cwd, env, invoke };
}

test('doctor finds npm-installed and overridden provider CLIs without a shell', async (t) => {
  const f = await fixture(t);
  const fake = (name) => `console.log(process.argv.includes('--version') ? '${name} 9.9.9-fixture' : 'unexpected');\n`;
  await writeFile(join(f.cwd, 'claude-entry.cjs'), fake('claude'));
  const extra = { EFFORT_CLAUDE_BIN: join(f.cwd, 'claude-entry.cjs') };
  if (process.platform === 'win32') {
    await mkdir(join(f.cwd, 'node_modules', '@openai', 'codex', 'bin'), { recursive: true });
    await writeFile(join(f.cwd, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'), fake('codex-cli'));
    await writeFile(join(f.cwd, 'codex.cmd'), '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
  } else extra.EFFORT_CODEX_BIN = join(f.cwd, 'missing-codex');
  const result = f.invoke(['doctor', '--json'], extra);
  assert.equal(result.status, 0, result.stderr);
  const checks = Object.fromEntries(JSON.parse(result.stdout).checks.map((check) => [check.provider, check]));
  assert.equal(checks.claude.installed, true);
  assert.equal(checks.claude.version, 'claude 9.9.9-fixture');
  assert.equal(checks.claude.source, 'override');
  if (process.platform === 'win32') {
    assert.equal(checks.codex.installed, true);
    assert.equal(checks.codex.version, 'codex-cli 9.9.9-fixture');
    assert.equal(checks.codex.source, 'npm-shim');
  } else assert.equal(checks.codex.installed, false);
  const text = f.invoke(['doctor'], { EFFORT_CODEX_BIN: join(f.cwd, 'missing-codex') });
  assert.match(text.stdout, /codex: not found \(set EFFORT_CODEX_BIN to its path\)/);
});

test('a polyglot checkout does not raise a short mechanical recommendation', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.cwd, 'scripts'));
  for (const file of ['app.ts', 'eslint.config.js', join('scripts', 'seed.py')]) await writeFile(join(f.cwd, file), 'x');
  const json = f.invoke(['recommend', 'Fix the typo in the README', '--cwd', f.cwd, '--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).effort, 'low');
  const text = f.invoke(['recommend', 'Fix the typo in the README', '--cwd', f.cwd]);
  assert.match(text.stdout, /^LOW · heuristic recommendation/);
  assert.match(f.invoke(['recommend', 'Add a settings page', '--cwd', f.cwd]).stdout, /^HIGH /);
});

test('the verification command can follow -- and the JSON form still works', async (t) => {
  const f = await fixture(t);
  const plan = (args) => {
    const result = f.invoke(['run', 'Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, '--dry-run', ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  const separated = plan(['--', 'node', '--test', '--test-reporter=tap', 'a b.test.mjs']);
  assert.deepEqual(separated.verification, ['node', '--test', '--test-reporter=tap', 'a b.test.mjs']);
  assert.equal(separated.recommendation.features.promptCharacters, 'Fix the sum test'.length);
  assert.equal(separated.willExecute, false);
  assert.deepEqual(plan(['--verify', '["node","--test"]']).verification, ['node', '--test']);
  const defaults = plan([]);
  assert.equal(defaults.verification, null);
  assert.equal(defaults.timeoutMs, 600_000);
  assert.equal(defaults.verifyTimeoutMs, null);
  const bounded = plan(['--timeout', '900', '--verify-timeout', '300', '--', 'npm', 'test']);
  assert.equal(bounded.timeoutMs, 900_000);
  assert.equal(bounded.verifyTimeoutMs, 300_000);
});

test('a verification time limit requires a verification command', async (t) => {
  const f = await fixture(t);
  const result = f.invoke(['run', 'Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, '--dry-run', '--verify-timeout', '30']);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /--verify-timeout needs a verification command/);
});

test('invalid verification input fails with guidance before any provider starts', async (t) => {
  const f = await fixture(t);
  const run = (...args) => f.invoke(['run', 'Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, ...args]);
  const failure = (result, message) => {
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /SyntaxError|Unexpected token/);
  };
  // Windows PowerShell 5.1 delivers '["node","--test"]' as [node,--test].
  const mangled = run('--verify', '[node,--test]');
  failure(mangled, /--verify expects a JSON array of strings/);
  assert.match(mangled.stderr, /after -- instead/);
  failure(run('--verify', '"node --test"'), /JSON array of strings/);
  failure(run('--verify', '[]'), /JSON array of strings/);
  failure(run('--verify', '["node"]', '--', 'node'), /not both/);
  failure(run('--'), /after --, for example/);
  failure(f.invoke(['recommend', 'Fix the sum test', '--', 'node', '--test']), /Only effort run/);
  // No provider was resolved or launched, and nothing was recorded.
  failure(run('--verify', '[node,--test]', '--dry-run'), /JSON array/);
});

test('Windows explains a separator removed by the PowerShell shim', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  // What effort.ps1 delivers for: effort run "task" --provider codex -- node --test
  const unknown = f.invoke(['run', 'Fix the sum test', '--provider', 'codex', 'node', '--test']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option '--test'.*quote it as '--'/);
  // ...and for: effort run "task" --provider codex -- npm test
  const merged = f.invoke(['run', 'Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, '--dry-run', 'npm', 'test']);
  assert.equal(merged.status, 0, merged.stderr);
  assert.match(merged.stderr, /3 separate words and no verification command.*quote it as '--'/);
  assert.equal(JSON.parse(merged.stdout).verification, null);
});
