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
