import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCommand, variable } from '../src/commands.mjs';
import { verify, resolveVerification } from '../src/verify.mjs';
import { runTask } from '../src/runner.mjs';
import { Store } from '../src/store.mjs';

const windows = { skip: process.platform !== 'win32' };
const fake = (body) => `const fs = require('node:fs');\n${body}\n`;

async function directory(t, prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// The wrapper npm's cmd-shim writes for a package bin.
const cmdShim = (target) => `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*\r\n`;
// Node's own npm.cmd, which chooses between the bundled npm and one in the global prefix.
const nodeNpm = ['@ECHO OFF', 'SETLOCAL', 'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ')',
  'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"', 'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"',
  'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (', '  SET "NPM_PREFIX_NPM_CLI_JS=%%F\\node_modules\\npm\\bin\\npm-cli.js"', ')',
  'IF EXIST "%NPM_PREFIX_NPM_CLI_JS%" (', '  SET "NPM_CLI_JS=%NPM_PREFIX_NPM_CLI_JS%"', ')', '"%NODE_EXE%" "%NPM_CLI_JS%" %*', ''].join('\r\n');

test('a child sees the lexicographically first spelling of a Windows variable, as spawn passes it', () => {
  assert.equal(variable({ Path: 'stale', PATH: 'fresh' }, 'PATH', 'win32'), 'fresh');
  assert.equal(variable({ path: 'only' }, 'PATH', 'win32'), 'only');
  assert.equal(variable({ Path: 'x' }, 'PATH', 'linux'), undefined);
});

test('Windows runs npm cmd-shims and Node\'s own npm.cmd through their JavaScript entry', windows, async (t) => {
  const dir = await directory(t, 'effort-commands-');
  await mkdir(join(dir, 'node_modules', 'tool', 'bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'tool', 'bin', 'tool.js'), fake("fs.writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)));"));
  await writeFile(join(dir, 'tool.cmd'), cmdShim('node_modules\\tool\\bin\\tool.js'));
  // Bundled npm, plus a newer one in the global prefix that npm.cmd prefers.
  const prefix = join(dir, 'prefix');
  await mkdir(join(dir, 'node_modules', 'npm', 'bin'), { recursive: true });
  await mkdir(join(prefix, 'node_modules', 'npm', 'bin'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'npm', 'bin', 'npm-prefix.js'), fake(`process.stdout.write(${JSON.stringify(prefix)});`));
  await writeFile(join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), fake("fs.writeFileSync(process.argv[2], 'bundled');"));
  await writeFile(join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js'), fake("fs.writeFileSync(process.argv[2], 'global');"));
  await writeFile(join(dir, 'npm.cmd'), nodeNpm);
  const env = { PATH: dir, SYSTEMROOT: process.env.SYSTEMROOT };
  assert.deepEqual(findCommand('tool', { env }), { executable: process.execPath, executableArgs: [join(dir, 'node_modules', 'tool', 'bin', 'tool.js')], wrapper: true });
  assert.deepEqual(findCommand('npm', { env }).executableArgs, [join(prefix, 'node_modules', 'npm', 'bin', 'npm-cli.js')]);
  // verify() runs both without a shell, with arguments passed literally.
  const out = join(dir, 'out.txt');
  assert.equal((await verify(['tool', out, 'a "quoted" & arg'], { cwd: dir, env })).status, 'passed');
  assert.deepEqual(JSON.parse(await (await import('node:fs/promises')).readFile(out, 'utf8')), ['a "quoted" & arg']);
  assert.equal((await verify(['npm.cmd', out], { cwd: dir, env })).status, 'passed');
  assert.equal(await (await import('node:fs/promises')).readFile(out, 'utf8'), 'global');
  // Without the global npm, the bundled one runs.
  await rm(join(prefix, 'node_modules'), { recursive: true });
  assert.equal((await verify(['npm', out], { cwd: dir, env })).status, 'passed');
  assert.equal(await (await import('node:fs/promises')).readFile(out, 'utf8'), 'bundled');
});

test('Windows explains a batch file that is not an npm wrapper instead of crashing', windows, async (t) => {
  const dir = await directory(t, 'effort-commands-batch-');
  await writeFile(join(dir, 'check.bat'), '@echo off\r\nexit /b 0\r\n');
  const result = await verify(['check.bat'], { cwd: dir, env: { PATH: dir } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.kind, 'environment');
  assert.match(result.output, /check\.bat is a batch file .* cannot run without a shell/);
});

test('the installed npm runs as a verification command on every platform', async (t) => {
  const dir = await directory(t, 'effort-commands-npm-');
  const result = await verify(['npm', '--version'], { cwd: dir });
  assert.equal(result.status, 'passed', result.output);
  assert.match(result.output, /^\d+\.\d+\.\d+/);
});

test('POSIX finds executables on PATH and checks paths relative to the working directory', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await directory(t, 'effort-commands-posix-');
  await writeFile(join(dir, 'check.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(dir, 'check.sh'), 0o755);
  assert.deepEqual(findCommand('check.sh', { env: { PATH: dir } }), { executable: join(dir, 'check.sh'), executableArgs: [] });
  assert.deepEqual(findCommand('./check.sh', { cwd: dir }), { executable: './check.sh', executableArgs: [] });
  assert.equal(findCommand('./missing.sh', { cwd: dir }), null);
});

test('a verification command that cannot start stops the run before any provider turn', async (t) => {
  const dir = await directory(t, 'effort-commands-preflight-');
  let turns = 0;
  const adapter = { capabilities: { id: 'codex', levels: ['low', 'medium', 'high'] }, run: async () => { turns++; return { status: 'completed' }; } };
  const store = await new Store(join(dir, 'records')).initialize();
  await assert.rejects(runTask({ prompt: 'Fix the tests', cwd: dir, verify: ['effort-missing-verifier', 'test'] }, { adapter, store }),
    /The verification command "effort-missing-verifier" was not found on PATH/);
  await assert.rejects(runTask({ prompt: 'Fix the tests', cwd: dir, verify: ['./missing-check.sh'] }, { adapter, store }), /"\.\/missing-check\.sh" was not found\./);
  assert.equal(turns, 0);
  assert.throws(() => resolveVerification(['effort-missing-verifier'], { cwd: dir }), /not found on PATH/);
});
