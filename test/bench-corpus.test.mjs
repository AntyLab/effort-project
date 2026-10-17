import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCEPT_DIR, CATEGORIES, checkEnvironment, diffSnapshots, findPython, loadCorpus, materialize, runAcceptance, selfTestTask, snapshot } from '../bench/lib/corpus.mjs';

const corpus = await loadCorpus();
const python = findPython();

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'effort-bench-corpus-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return directory;
}

test('the seed corpus has 8–12 tasks across both languages, all difficulties and all categories', () => {
  assert.ok(corpus.tasks.length >= 8 && corpus.tasks.length <= 12, `${corpus.tasks.length} tasks`);
  assert.deepEqual(new Set(corpus.tasks.map((task) => task.language)), new Set(['node', 'python']));
  assert.deepEqual(new Set(corpus.tasks.map((task) => task.difficulty)), new Set(['easy', 'medium', 'hard']));
  assert.deepEqual(new Set(corpus.tasks.map((task) => task.category)), new Set(CATEGORIES));
  for (const task of corpus.tasks) assert.ok(!task.prompt.includes(ACCEPT_DIR), task.id);
});

// The core guarantee of the corpus: each hidden check separates the starting
// fixture from the reference solution. Python tasks need Python 3.8 or later.
describe('every task is solvable and its hidden check is discriminating', { concurrency: 2 }, () => {
  for (const task of corpus.tasks) {
    const skip = task.language === 'python' && !python ? 'Python 3.8 or later was not found' : false;
    test(task.id, { skip }, async () => {
      const result = await selfTestTask(task, { python });
      assert.deepEqual(result.problems, [], JSON.stringify(result.output ?? {}, null, 2).slice(0, 6000));
      assert.equal(result.checks.acceptStart, 'failed');
      assert.equal(result.checks.acceptSolved, 'passed');
      assert.equal(result.checks.visibleSolved, 'passed');
    });
  }
});

test('the hidden check replaces an agent-planted bench_accept and never touches the workspace', async (t) => {
  const directory = await scratch(t);
  const task = corpus.tasks.find((entry) => entry.id === 'node-paginate');
  const workspace = await materialize(task, join(directory, 'work'));
  // An agent that guessed the directory name and wrote a passing "test" there.
  await mkdir(join(workspace, ACCEPT_DIR));
  await writeFile(join(workspace, ACCEPT_DIR, 'paginate.test.mjs'), "import test from 'node:test';\ntest('always passes', () => {});\n");
  const before = await snapshot(workspace);
  const check = await runAcceptance(task, workspace, { checkDir: join(directory, 'check') });
  assert.equal(check.status, 'failed');
  assert.deepEqual(diffSnapshots(before, await snapshot(workspace)), { added: [], modified: [], deleted: [] });
  assert.equal(await readFile(join(directory, 'check', ACCEPT_DIR, 'paginate.test.mjs'), 'utf8'), await readFile(join(task.acceptDir, 'paginate.test.mjs'), 'utf8'));

  await cp(task.solutionDir, workspace, { recursive: true, force: true });
  assert.equal((await runAcceptance(task, workspace, { checkDir: join(directory, 'check') })).status, 'passed');
});

test('checks run agent-written code without credentials or code-injection variables', () => {
  const env = checkEnvironment({
    PATH: '/bin', HOME: '/home/x', LANG: 'C', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', CODEX_HOME: 'c', CLAUDE_CODE_OAUTH_TOKEN: 'd',
    GITHUB_TOKEN: 'e', AWS_SECRET_ACCESS_KEY: 'f', MY_SERVICE_PASSWORD: 'g', NODE_OPTIONS: '--require x', PYTHONPATH: '/evil', NODE_TEST_CONTEXT: 'child',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
  });
  for (const kept of ['PATH', 'HOME', 'LANG']) assert.ok(kept in env, kept);
  for (const dropped of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'MY_SERVICE_PASSWORD', 'NODE_OPTIONS', 'PYTHONPATH', 'NODE_TEST_CONTEXT', 'SSH_AUTH_SOCK']) {
    assert.equal(env[dropped], undefined, dropped);
  }
  assert.equal(env.PYTHONDONTWRITEBYTECODE, '1');
});

test('snapshots report added, modified and deleted files and ignore generated ones', async (t) => {
  const directory = await scratch(t);
  await mkdir(join(directory, 'src'));
  await writeFile(join(directory, 'src', 'a.mjs'), 'a');
  await writeFile(join(directory, 'b.py'), 'b');
  const before = await snapshot(directory);
  await writeFile(join(directory, 'src', 'a.mjs'), 'changed');
  await rm(join(directory, 'b.py'));
  await writeFile(join(directory, 'c.txt'), 'c');
  await mkdir(join(directory, '__pycache__'));
  await writeFile(join(directory, '__pycache__', 'x.pyc'), 'cache');
  assert.deepEqual(diffSnapshots(before, await snapshot(directory)), { added: ['c.txt'], modified: ['src/a.mjs'], deleted: ['b.py'] });
});

test('manifest validation rejects unsafe or incomplete tasks', async (t) => {
  const directory = await scratch(t);
  const source = corpus.tasks.find((entry) => entry.id === 'node-paginate');
  await cp(source.dir, join(directory, 'node-paginate'), { recursive: true });
  const good = { id: 'node-paginate', language: 'node', difficulty: 'easy', category: 'off-by-one', prompt: 'Fix it.', verify: ['{node}', '--test', 'test/*.test.mjs'], accept: ['{node}', '--test', 'bench_accept/*.test.mjs'] };
  const write = async (tasks) => {
    const path = join(directory, 'manifest.json');
    await writeFile(path, JSON.stringify({ schema: 'effort-bench-corpus/1', tasks }));
    return path;
  };
  assert.equal((await loadCorpus(await write([good]))).tasks.length, 1);
  const cases = [
    [[good, good], /duplicate id/],
    [[{ ...good, language: 'ruby' }], /language/],
    [[{ ...good, difficulty: 'impossible' }], /difficulty/],
    [[{ ...good, category: 'misc' }], /category/],
    [[{ ...good, prompt: '' }], /prompt/],
    [[{ ...good, prompt: 'Read bench_accept/ first.' }], /must not mention/],
    [[{ ...good, accept: ['node', '--test'] }], /accept must be an argv array/],
    [[{ ...good, verify: ['{python}', '-m', 'unittest'] }], /verify must be an argv array/],
    [[{ ...good, id: 'Bad Id' }], /id must match/],
    [[{ ...good, id: 'missing-task' }], /missing .*repo/],
    [[{ ...good, visibleFailsAtStart: 'yes' }], /visibleFailsAtStart/],
    [[], /at least one task/],
  ];
  for (const [tasks, message] of cases) await assert.rejects(loadCorpus(await write(tasks)), message, JSON.stringify(tasks).slice(0, 200));
  await mkdir(join(directory, 'node-paginate', 'repo', ACCEPT_DIR));
  await assert.rejects(loadCorpus(await write([good])), /must not contain bench_accept/);
});
