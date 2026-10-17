import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProviderCommand, providerCommand } from '../src/provider-cli.mjs';

const windows = { skip: process.platform !== 'win32' };

// Shims as written by npm's cmd-shim (current and older formats).
const npmShim = (target) => [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`, '',
].join('\r\n');
const legacyShim = (target) => `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\${target}" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  @SET PATHEXT=%PATHEXT:;.JS;=;%\r\n  node  "%~dp0\\${target}" %*\r\n)\r\n`;

// A global npm prefix: bin shims at the top, the package's JavaScript entry below.
async function prefix(t, name, shim = npmShim) {
  const dir = await mkdtemp(join(tmpdir(), 'effort-cli-shim-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entry = join(dir, 'node_modules', `fake-${name}`, 'bin', `${name}.js`);
  await mkdir(join(dir, 'node_modules', `fake-${name}`, 'bin'), { recursive: true });
  await writeFile(entry, 'console.log(JSON.stringify({ argv: process.argv.slice(2), version: "9.9.9-fixture" }));\n');
  await writeFile(join(dir, `${name}.cmd`), shim(`node_modules\\fake-${name}\\bin\\${name}.js`));
  return { dir, entry };
}

test('Windows runs an npm .cmd shim through its script without a shell', windows, async (t) => {
  const { dir, entry } = await prefix(t, 'codex');
  const env = { PATH: dir, SYSTEMROOT: process.env.SYSTEMROOT };
  // The original failure: a bare name does not find the batch shim without a shell.
  assert.equal(spawnSync('codex', ['--version'], { env, shell: false, windowsHide: true }).error?.code, 'ENOENT');
  const command = resolveProviderCommand('codex', { env });
  assert.deepEqual(command, { executable: process.execPath, executableArgs: [entry], source: 'npm-shim' });
  const result = spawnSync(command.executable, [...command.executableArgs, '--version', 'a "quoted" arg'], { env, encoding: 'utf8', shell: false, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv, ['--version', 'a "quoted" arg']);
});

test('Windows also reads older npm shims and a case-insensitive Path', windows, async (t) => {
  const { dir, entry } = await prefix(t, 'claude', legacyShim);
  assert.deepEqual(resolveProviderCommand('claude', { env: { Path: `C:\\does-not-exist;"${dir}"` } }).executableArgs, [entry]);
});

test('Windows prefers a native .exe anywhere on PATH over an npm shim', windows, async (t) => {
  const { dir: shims } = await prefix(t, 'claude');
  const native = await mkdtemp(join(tmpdir(), 'effort-cli-native-'));
  t.after(() => rm(native, { recursive: true, force: true }));
  await writeFile(join(native, 'claude.exe'), '');
  assert.deepEqual(resolveProviderCommand('claude', { env: { PATH: `${shims};${native}` } }), { executable: join(native, 'claude.exe'), executableArgs: [], source: 'path' });
});

test('Windows explains batch files that are not usable npm shims', windows, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'effort-cli-batch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'codex.cmd'), '@echo off\r\nstart codex-helper %*\r\n');
  await writeFile(join(dir, 'claude.cmd'), npmShim('node_modules\\missing\\cli.js'));
  for (const name of ['codex', 'claude']) assert.throws(() => resolveProviderCommand(name, { env: { PATH: dir } }), new RegExp(`${name} is a batch file .* cannot run without a shell`));
  assert.throws(() => resolveProviderCommand('codex', { env: { PATH: dir, EFFORT_CODEX_BIN: join(dir, 'codex.cmd') } }), /EFFORT_CODEX_BIN names a batch file that is not an npm shim/);
  const { dir: shims, entry } = await prefix(t, 'codex');
  assert.deepEqual(resolveProviderCommand('codex', { env: { effort_codex_bin: join(shims, 'codex.cmd') } }), { executable: process.execPath, executableArgs: [entry], source: 'override' });
});

test('EFFORT_CODEX_BIN and EFFORT_CLAUDE_BIN override PATH on every platform', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'effort-cli-override-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const script = join(dir, 'codex entry.mjs'), native = join(dir, 'claude-native'), relativeScript = join(dir, 'cli.cjs');
  for (const path of [script, native, relativeScript]) await writeFile(path, '');
  assert.deepEqual(resolveProviderCommand('codex', { env: { PATH: dir, EFFORT_CODEX_BIN: script } }), { executable: process.execPath, executableArgs: [script], source: 'override' });
  assert.deepEqual(resolveProviderCommand('codex', { env: { EFFORT_CODEX_BIN: ` "${script}" ` } }).executableArgs, [script]);
  assert.deepEqual(resolveProviderCommand('claude', { env: { EFFORT_CLAUDE_BIN: native } }), { executable: native, executableArgs: [], source: 'override' });
  // A relative override is fixed to one absolute file, so doctor and every adapter run the same one.
  assert.deepEqual(resolveProviderCommand('claude', { env: { EFFORT_CLAUDE_BIN: relative(process.cwd(), relativeScript) } }).executableArgs, [relativeScript]);
  assert.deepEqual(resolveProviderCommand('claude', { env: { EFFORT_CLAUDE_BIN: relative(process.cwd(), native) } }).executable, native);
  // Missing files and unknown command names fail with what is wrong.
  assert.throws(() => resolveProviderCommand('codex', { env: { EFFORT_CODEX_BIN: join(dir, 'missing.mjs') } }), /EFFORT_CODEX_BIN points to .*missing\.mjs, which does not exist/);
  assert.throws(() => resolveProviderCommand('claude', { env: { PATH: dir, EFFORT_CLAUDE_BIN: 'effort-missing-claude' } }), /EFFORT_CLAUDE_BIN names effort-missing-claude, which was not found on PATH/);
  assert.equal(resolveProviderCommand('claude', { env: { EFFORT_CLAUDE_BIN: '  ' } }).source, 'default');
  assert.throws(() => resolveProviderCommand('opencode', { env: {} }), /codex or claude/);
});

test('POSIX leaves default lookup to spawn, and explicit executables stay literal', async (t) => {
  const { dir, entry } = await prefix(t, 'codex');
  assert.deepEqual(resolveProviderCommand('codex', { env: { PATH: dir }, platform: 'linux' }), { executable: 'codex', executableArgs: [], source: 'default' });
  assert.equal(resolveProviderCommand('codex', { env: { effort_codex_bin: 'x' }, platform: 'linux' }).source, 'default');
  assert.deepEqual(providerCommand('codex', { executable: '/opt/codex', executableArgs: ['--flag'], env: { EFFORT_CODEX_BIN: 'other' } }), { executable: '/opt/codex', executableArgs: ['--flag'] });
  assert.deepEqual(providerCommand('codex', { executableArgs: ['--flag'], env: { EFFORT_CODEX_BIN: entry } }), { executable: process.execPath, executableArgs: [entry, '--flag'] });
});
