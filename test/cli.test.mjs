import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../bin/effort.mjs', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// The CLI runs with an empty PATH and private metadata directory: no provider can launch.
async function fixture(t) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'effort-cli-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // Node's own directory is on PATH so verification commands such as node and npm can be found.
  const env = { PATH: [cwd, dirname(process.execPath)].join(delimiter), HOME: cwd, USERPROFILE: cwd, EFFORT_DATA_DIR: join(cwd, 'metadata') };
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

test('the CLI reports the package.json version and the package lists only real paths', async (t) => {
  const f = await fixture(t);
  const version = f.invoke(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), manifest.version);
  assert.equal(f.invoke(['--help']).stdout.split('\n')[0], `The Effort Project · ${manifest.version}`);
  for (const entry of manifest.files) await access(new URL(`../${entry}`, import.meta.url));
  // A copy of src/ without its manifest still loads and says so.
  await mkdir(join(f.cwd, 'copied', 'src'), { recursive: true });
  await writeFile(join(f.cwd, 'copied', 'src', 'version.mjs'), await readFile(new URL('../src/version.mjs', import.meta.url)));
  assert.equal((await import(pathToFileURL(join(f.cwd, 'copied', 'src', 'version.mjs')).href)).VERSION, 'unknown');
});

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
  assert.match(f.invoke(['doctor']).stdout, /claude: not found \(set EFFORT_CLAUDE_BIN to its path\)/);
  const misconfigured = f.invoke(['doctor'], { EFFORT_CODEX_BIN: join(f.cwd, 'missing-codex') });
  assert.match(misconfigured.stdout, /codex: cannot start: EFFORT_CODEX_BIN points to .*missing-codex, which does not exist; authentication not checked/);
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
  // The language count describes the checkout, so ordinary requests stay at medium.
  for (const task of ['Add a settings page', 'Bump the version number in package.json', 'Change the button color from blue to green']) {
    assert.match(f.invoke(['recommend', task, '--cwd', f.cwd]).stdout, /^MEDIUM /, task);
  }
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
  // --verify-arg needs no quoting rules: one argument per option, values starting with - after =.
  assert.deepEqual(plan(['--verify-arg', 'node', '--verify-arg=--test', '--verify-arg', 'a b.test.mjs']).verification, ['node', '--test', 'a b.test.mjs']);
  const defaults = plan([]);
  assert.equal(defaults.verification, null);
  assert.equal(defaults.timeoutMs, 600_000);
  assert.equal(defaults.verifyTimeoutMs, null);
  const bounded = plan(['--timeout', '900', '--verify-timeout', '300', '--', 'npm', 'test']);
  assert.equal(bounded.timeoutMs, 900_000);
  assert.equal(bounded.verifyTimeoutMs, 300_000);
});

test('--dry-run rejects what the real run would reject', async (t) => {
  const f = await fixture(t);
  const plan = (...args) => f.invoke(['run', 'Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, '--dry-run', ...args]);
  for (const [args, message] of [
    [['--timeout', '60', '--verify-timeout', '120', '--', 'node', '--test'], /--verify-timeout.*no longer than timeoutMs \(--timeout\)/],
    [['--verify-timeout', '0.05', '--', 'node', '--test'], /at least 0\.1 seconds/],
    [['--max-attempts', '9'], /--max-attempts\) must be between 1 and 5/],
    [['--', 'effort-missing-verifier', 'test'], /"effort-missing-verifier" was not found on PATH/],
  ]) {
    const result = plan(...args);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, message);
  }
  // Seconds are rounded to whole milliseconds.
  const rounded = plan('--verify-timeout', '16.1', '--', 'node', '--test');
  assert.equal(rounded.status, 0, rounded.stderr);
  assert.equal(JSON.parse(rounded.stdout).verifyTimeoutMs, 16_100);
  // A Claude task may run longer than one Claude turn's 30-minute limit.
  const long = f.invoke(['run', 'Fix the sum test', '--provider', 'claude', '--cwd', f.cwd, '--dry-run', '--timeout', '3600']);
  assert.equal(long.status, 0, long.stderr);
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
  failure(run('--verify', '["node"]', '--', 'node'), /Give the verification command once/);
  failure(run('--verify-arg', 'node', '--', 'node'), /Give the verification command once/);
  failure(run('--'), /after --, for example/);
  // No provider was resolved or launched, and nothing was recorded.
  failure(run('--verify', '[node,--test]', '--dry-run'), /JSON array/);
});

test('a verification command that lost its -- separator stops the run instead of dropping verification', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'task.txt'), 'Fix the sum test');
  // What PowerShell passes through npm's effort.ps1 for `... -- npm test` and `... -- pytest --timeout 30`.
  for (const args of [
    ['Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, '--allow-write', 'npm', 'test'],
    ['--prompt-file', join(f.cwd, 'task.txt'), '--provider', 'codex', '--cwd', f.cwd, '--allow-write', 'npm', 'test'],
    ['Fix the sum test', '--provider', 'codex', '--cwd', f.cwd, 'pytest', '--timeout', '30'],
    // An unquoted multi-word task is refused for the same reason.
    ['Fix', 'the', 'sum', 'test', '--provider', 'codex', '--cwd', f.cwd],
  ]) {
    const result = f.invoke(['run', ...args]);
    assert.equal(result.status, 1, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /but also received: .*put it after -- \(in PowerShell: '--'\) or pass each part with --verify-arg/);
  }
  const noTask = f.invoke(['run', '--provider', 'codex', '--cwd', f.cwd, '--dry-run', '--', '-v output should list files']);
  assert.equal(noTask.status, 1);
  assert.match(noTask.stderr, /needs the task as one quoted argument before any --, or --prompt-file/);
  // Outside effort run, -- only ends the options, so a task may start with '-'.
  const dashed = f.invoke(['recommend', '--json', '--', '--force flag is ignored when the cache is warm']);
  assert.equal(dashed.status, 0, dashed.stderr);
  assert.equal(JSON.parse(dashed.stdout).features.promptCharacters, '--force flag is ignored when the cache is warm'.length);
});

test('Windows hints at a removed separator only where one could have been', { skip: process.platform !== 'win32' }, async (t) => {
  const f = await fixture(t);
  // What effort.ps1 delivers for: effort run "task" --provider codex -- node --test
  const dropped = f.invoke(['run', 'Fix the sum test', '--provider', 'codex', 'node', '--test']);
  assert.equal(dropped.status, 1);
  assert.match(dropped.stderr, /Unknown option '--test'.*quote it as '--', or pass each part with --verify-arg/);
  // A typo right after the task gets Node's message alone.
  const typo = f.invoke(['run', 'Fix the sum test', '--provder', 'codex']);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Unknown option '--provder'/);
  assert.doesNotMatch(typo.stderr, /PowerShell/);
});
