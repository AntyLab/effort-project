import { cp, lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { verify, validateCommand } from '../../src/verify.mjs';

export const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MANIFEST = join(BENCH_DIR, 'tasks', 'manifest.json');
// Hidden acceptance files are copied into this directory of a *copy* of the
// final workspace, after the agent has finished. The agent never sees them.
export const ACCEPT_DIR = 'bench_accept';
export const LANGUAGES = Object.freeze(['node', 'python']);
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
export const CATEGORIES = Object.freeze(['typo-rename', 'off-by-one', 'failing-test', 'feature', 'refactor', 'async', 'validation']);
const ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
// Generated files: never copied into checks and never reported as changes.
const GENERATED = new Set(['.git', '__pycache__', '.pytest_cache']);
// Agent-written code runs during checks. It gets no code-injection hooks, no
// provider or service credentials (even when the provider itself needs them) and
// no SSH agent socket. Files the user account can read are not hidden.
const INJECTION = /^(?:NODE_OPTIONS|NODE_TEST_CONTEXT|NODE_PATH|PYTHONPATH|PYTHONSTARTUP|PYTHONINSPECT|PYTHONWARNINGS|FORCE_COLOR)$/i;
const SECRET = /^(?:ANTHROPIC|OPENAI|CODEX|CLAUDE|AWS|AZURE|GOOGLE|GCLOUD|VERTEX|BEDROCK|FOUNDRY|GITHUB|GH|NPM|HF|HUGGINGFACE)_|(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?)$|^SSH_AUTH_SOCK$/i;

const isDirectory = async (path) => (await lstat(path).catch(() => null))?.isDirectory() ?? false;

/** Load and validate the task manifest. Paths in the result are absolute. */
export async function loadCorpus(manifestPath = DEFAULT_MANIFEST) {
  const path = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest?.schema !== 'effort-bench-corpus/1' || !Array.isArray(manifest.tasks) || !manifest.tasks.length) {
    throw new Error(`${path} is not an effort-bench-corpus/1 manifest with at least one task.`);
  }
  const base = dirname(path);
  const ids = new Set();
  const tasks = [];
  for (const [index, entry] of manifest.tasks.entries()) {
    const where = `Task ${typeof entry?.id === 'string' ? entry.id : `#${index + 1}`}`;
    if (!ID.test(entry?.id ?? '')) throw new Error(`${where}: id must match ${ID}.`);
    if (ids.has(entry.id)) throw new Error(`${where}: duplicate id.`);
    ids.add(entry.id);
    if (!LANGUAGES.includes(entry.language)) throw new Error(`${where}: language must be one of ${LANGUAGES.join(', ')}.`);
    if (!DIFFICULTIES.includes(entry.difficulty)) throw new Error(`${where}: difficulty must be one of ${DIFFICULTIES.join(', ')}.`);
    if (!CATEGORIES.includes(entry.category)) throw new Error(`${where}: category must be one of ${CATEGORIES.join(', ')}.`);
    if (typeof entry.prompt !== 'string' || !entry.prompt.trim() || entry.prompt.length > 4000) throw new Error(`${where}: prompt must be 1–4,000 characters.`);
    if (entry.prompt.includes(ACCEPT_DIR)) throw new Error(`${where}: the prompt must not mention the hidden ${ACCEPT_DIR} directory.`);
    const interpreter = entry.language === 'node' ? '{node}' : '{python}';
    for (const key of ['verify', 'accept']) {
      const argv = entry[key];
      if (!Array.isArray(argv) || argv[0] !== interpreter || argv.length > 50 || argv.some((part) => typeof part !== 'string' || !part || part.includes('\0'))) {
        throw new Error(`${where}: ${key} must be an argv array that starts with "${interpreter}".`);
      }
    }
    if (entry.visibleFailsAtStart !== undefined && typeof entry.visibleFailsAtStart !== 'boolean') throw new Error(`${where}: visibleFailsAtStart must be a boolean.`);
    const dir = join(base, entry.id);
    const task = {
      id: entry.id, language: entry.language, difficulty: entry.difficulty, category: entry.category,
      prompt: entry.prompt, verify: [...entry.verify], accept: [...entry.accept],
      visibleFailsAtStart: entry.visibleFailsAtStart ?? true,
      dir, repoDir: join(dir, 'repo'), solutionDir: join(dir, 'solution'), acceptDir: join(dir, 'accept'),
    };
    for (const key of ['repoDir', 'solutionDir', 'acceptDir']) {
      if (!await isDirectory(task[key])) throw new Error(`${where}: missing ${relative(base, task[key])}/ directory.`);
    }
    if (await lstat(join(task.repoDir, ACCEPT_DIR)).catch(() => null)) throw new Error(`${where}: repo/ must not contain ${ACCEPT_DIR}/.`);
    tasks.push(Object.freeze(task));
  }
  return { path, description: typeof manifest.description === 'string' ? manifest.description : '', tasks };
}

/** Select tasks by comma-separated ids ("all" or empty keeps every task) and optional language. */
export function selectTasks(tasks, { ids, language } = {}) {
  let selected = tasks;
  if (ids && ids !== 'all') {
    const wanted = new Set(String(ids).split(',').map((id) => id.trim()).filter(Boolean));
    const unknown = [...wanted].filter((id) => !tasks.some((task) => task.id === id));
    if (unknown.length) throw new Error(`Unknown task id: ${unknown.join(', ')}. Run "node bench/run.mjs plan" to list tasks.`);
    selected = selected.filter((task) => wanted.has(task.id));
  }
  if (language) {
    if (!LANGUAGES.includes(language)) throw new Error(`--language must be one of ${LANGUAGES.join(', ')}.`);
    selected = selected.filter((task) => task.language === language);
  }
  if (!selected.length) throw new Error('No tasks match the selection.');
  return selected;
}

/** Copy a task's starting repository (and optionally its reference solution) to a new directory. */
export async function materialize(task, destination, { solution = false } = {}) {
  await cp(task.repoDir, destination, { recursive: true, errorOnExist: true, force: false });
  if (solution) await cp(task.solutionDir, destination, { recursive: true, force: true });
  return destination;
}

let pythonCache;
/** Find Python 3.8+ without a shell. EFFORT_BENCH_PYTHON (or `override`) names one interpreter to use. */
export function findPython({ override = process.env.EFFORT_BENCH_PYTHON } = {}) {
  const key = override ?? '';
  if (pythonCache?.key === key) return pythonCache.value;
  const candidates = override ? [[override]]
    : process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
  let value = null;
  for (const [command, ...prefix] of candidates) {
    const probe = spawnSync(command, [...prefix, '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true, shell: false });
    const version = String(probe.stdout ?? '').trim();
    const match = /^3\.(\d+)\.\d+$/.exec(version);
    if (probe.status === 0 && match && Number(match[1]) >= 8) { value = { command, prefix, version }; break; }
  }
  pythonCache = { key, value };
  return value;
}

/** Replace the {node} and {python} placeholders in a manifest command. */
export function resolveCommand(argv, { python } = {}) {
  const resolved = [];
  for (const part of argv) {
    if (part === '{node}') resolved.push(process.execPath);
    else if (part === '{python}') {
      if (!python) throw new Error('This task needs Python 3.8 or later. Install it, set EFFORT_BENCH_PYTHON, or pass --python.');
      resolved.push(python.command, ...python.prefix);
    } else resolved.push(part);
  }
  return validateCommand(resolved);
}

/** The environment for running agent-written code in checks. */
export function checkEnvironment(source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value === 'string' && !INJECTION.test(key) && !SECRET.test(key)) env[key] = value;
  }
  return { ...env, NO_COLOR: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0' };
}

/**
 * Run the hidden acceptance check: copy the final workspace to `checkDir`,
 * replace any bench_accept/ the agent created with the task's own files, and
 * run the task's accept command there. The workspace itself is not touched.
 */
export async function runAcceptance(task, workspace, { checkDir, python, timeoutMs = 60_000, signal } = {}) {
  await rm(checkDir, { recursive: true, force: true });
  await cp(workspace, checkDir, { recursive: true, filter: (source) => !GENERATED.has(basename(source)) });
  await rm(join(checkDir, ACCEPT_DIR), { recursive: true, force: true });
  await cp(task.acceptDir, join(checkDir, ACCEPT_DIR), { recursive: true });
  const started = performance.now();
  const check = await verify(resolveCommand(task.accept, { python }), { cwd: checkDir, timeoutMs, signal, env: checkEnvironment() });
  return {
    status: check.status, kind: check.kind ?? null, exitCode: check.exitCode ?? null,
    fingerprint: check.fingerprint ?? null, durationMs: Math.round(performance.now() - started), output: check.output ?? '',
  };
}

/** Map of relative POSIX path -> sha256 for the files under `root`. */
export async function snapshot(root, { limit = 5000 } = {}) {
  const files = new Map();
  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (files.size >= limit) return;
      if (GENERATED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) files.set(name, 'symlink');
      else if (entry.isDirectory()) await walk(path, name);
      else if (entry.isFile()) files.set(name, createHash('sha256').update(await readFile(path)).digest('hex'));
    }
  }
  await walk(root, '');
  return files;
}

export function diffSnapshots(before, after, limit = 100) {
  const added = [];
  const modified = [];
  const deleted = [];
  for (const [name, hash] of after) {
    if (!before.has(name)) added.push(name);
    else if (before.get(name) !== hash) modified.push(name);
  }
  for (const name of before.keys()) if (!after.has(name)) deleted.push(name);
  const truncated = added.length > limit || modified.length > limit || deleted.length > limit;
  return { added: added.slice(0, limit), modified: modified.slice(0, limit), deleted: deleted.slice(0, limit), ...(truncated ? { truncated } : {}) };
}

/** Content digest of a directory tree, with line endings normalized so it is the same on every platform. */
export async function treeDigest(root) {
  const hash = createHash('sha256');
  async function walk(directory, prefix) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (GENERATED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path, name);
      else if (entry.isFile()) hash.update(`${name}\0`).update((await readFile(path, 'utf8')).replace(/\r\n/g, '\n')).update('\0');
    }
  }
  await walk(root, '');
  return hash.digest('hex').slice(0, 16);
}

export async function taskDigest(task) {
  const hash = createHash('sha256').update(JSON.stringify([task.prompt, task.verify, task.accept, task.language, task.difficulty]));
  for (const directory of [task.repoDir, task.solutionDir, task.acceptDir]) hash.update(await treeDigest(directory));
  return hash.digest('hex').slice(0, 16);
}

const tail = (text, length = 3000) => String(text ?? '').slice(-length);

/**
 * Prove that a task is usable: the hidden check fails on the starting fixture
 * (as a recognized test failure) and passes on the reference solution, and the
 * visible check passes on the solution and behaves as the manifest says at start.
 */
export async function selfTestTask(task, { python, timeoutMs = 60_000 } = {}) {
  if (task.language === 'python' && !python) return { id: task.id, status: 'skipped', reason: 'Python 3.8 or later was not found.', problems: [] };
  const scratch = await mkdtemp(join(tmpdir(), 'effort-bench-selftest-'));
  try {
    const start = await materialize(task, join(scratch, 'start'));
    const solved = await materialize(task, join(scratch, 'solved'), { solution: true });
    const env = checkEnvironment();
    const visible = resolveCommand(task.verify, { python });
    // One check at a time: Windows can fail to start processes when many start at once.
    const acceptStart = await runAcceptance(task, start, { checkDir: join(scratch, 'check-start'), python, timeoutMs });
    const acceptSolved = await runAcceptance(task, solved, { checkDir: join(scratch, 'check-solved'), python, timeoutMs });
    const visibleStart = await verify(visible, { cwd: start, env, timeoutMs });
    const visibleSolved = await verify(visible, { cwd: solved, env, timeoutMs });
    const [before, after] = await Promise.all([snapshot(start), snapshot(solved)]);
    const problems = [];
    if (acceptStart.status === 'passed') problems.push('The acceptance check passes on the starting fixture.');
    else if (acceptStart.kind !== 'test') problems.push(`The acceptance check fails on the starting fixture for a non-test reason (${acceptStart.kind}).`);
    if (acceptSolved.status !== 'passed') problems.push('The acceptance check fails on the reference solution.');
    if (visibleSolved.status !== 'passed') problems.push('The visible check fails on the reference solution.');
    if (task.visibleFailsAtStart) {
      if (visibleStart.status === 'passed') problems.push('The visible check passes on the starting fixture; set "visibleFailsAtStart": false if that is intended.');
      else if (visibleStart.kind !== 'test') problems.push(`The visible check fails at start for a non-test reason (${visibleStart.kind}), so Effort would stop instead of retrying.`);
    } else if (visibleStart.status !== 'passed') problems.push('The manifest says the visible check passes at start, but it fails.');
    const changes = diffSnapshots(before, after);
    if (!changes.added.length && !changes.modified.length) problems.push('The reference solution changes nothing.');
    if ([...before.values(), ...after.values()].includes('symlink')) problems.push('Fixtures must not contain symbolic links.');
    return {
      id: task.id, status: problems.length ? 'failed' : 'passed', problems,
      checks: {
        acceptStart: acceptStart.status, acceptSolved: acceptSolved.status,
        visibleStart: visibleStart.status, visibleSolved: visibleSolved.status,
      },
      ...(problems.length ? { output: {
        acceptStart: tail(acceptStart.output), acceptSolved: tail(acceptSolved.output),
        visibleStart: tail(visibleStart.output), visibleSolved: tail(visibleSolved.output),
      } } : {}),
    };
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
