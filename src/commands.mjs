import { readFileSync, statSync, accessSync, constants } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Find commands the way a shell would, without starting one. Node will not spawn a
// Windows .cmd or .bat file without a shell, so npm's wrappers are run through the
// JavaScript entry point they name instead; cmd.exe is never involved.
const SCRIPT = /\.[cm]?js$/i;

export const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };
export const unquote = (value) => value.trim().replace(/^"(.*)"$/, '$1');
const isExecutable = (path) => { try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; } };

/**
 * An environment variable as a child process sees it. Windows names are case-insensitive,
 * and Node gives a child the lexicographically first spelling ('PATH' before 'Path').
 */
export function variable(env, name, platform = process.platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).filter((candidate) => candidate.toUpperCase() === name).sort()[0];
  return key === undefined ? undefined : env[key];
}

const pathDirectories = (env, platform) => String(variable(env, 'PATH', platform) ?? '').split(platform === 'win32' ? ';' : ':').map(unquote).filter(Boolean);
// A wrapper prefers the node.exe beside it, as npm's own scripts do.
const nodeBeside = (directory) => { const node = resolve(directory, 'node.exe'); return isFile(node) ? node : process.execPath; };

// Node's npm.cmd and npx.cmd choose their CLI when they run: an npm installed in the
// global prefix wins over the bundled one. Make the same choice here.
function fromNodeNpm(path, source) {
  const cli = /SET "NP[MX]_CLI_JS=%~dp0\\([^"%\r\n]+)"/i.exec(source);
  if (!cli) return null;
  const directory = dirname(path), node = nodeBeside(directory);
  let entry = resolve(directory, cli[1]);
  const prefixScript = /SET "NPM_PREFIX_JS=%~dp0\\([^"%\r\n]+)"/i.exec(source);
  if (prefixScript && isFile(resolve(directory, prefixScript[1]))) {
    const found = spawnSync(node, [resolve(directory, prefixScript[1])], { encoding: 'utf8', timeout: 5000, windowsHide: true, shell: false });
    const prefix = found.status === 0 ? found.stdout.trim() : '';
    const global = prefix && resolve(prefix, 'node_modules', 'npm', 'bin', basename(entry));
    if (global && isFile(global)) entry = global;
  }
  return isFile(entry) ? { executable: node, executableArgs: [entry] } : null;
}

// npm's cmd-shim names its target as "%dp0%\..." (older versions: "%~dp0\...").
function fromCmdShim(path, source) {
  for (const [, target] of source.matchAll(/"%~?dp0%?\\([^"%\r\n]+)"/gi)) {
    const entry = resolve(dirname(path), target);
    if (!isFile(entry)) continue;
    if (SCRIPT.test(entry)) return { executable: nodeBeside(dirname(path)), executableArgs: [entry] };
    if (/\.exe$/i.test(entry) && basename(entry).toLowerCase() !== 'node.exe') return { executable: entry, executableArgs: [] };
  }
  return null;
}

/** How to run a Windows batch file without a shell, or null when it is not an npm wrapper. */
export function fromBatchFile(path) {
  let source;
  try { source = readFileSync(path, 'utf8'); } catch { return null; }
  if (source.length > 64 * 1024) return null;
  return fromNodeNpm(path, source) ?? fromCmdShim(path, source);
}

function batch(path, command) {
  const wrapper = fromBatchFile(path);
  if (!wrapper) throw new TypeError(`${command} is a batch file (${path}) that Effort cannot run without a shell. Use the program's .exe or JavaScript entry point instead.`);
  return { ...wrapper, wrapper: true };
}

/**
 * How to spawn `command` with shell:false, or null when nothing can be started.
 * Relative paths are taken from `cwd`. On Windows, `cwd` (when given) is searched
 * before PATH, as cmd.exe does, and a batch file must be an npm wrapper.
 */
export function findCommand(command, { env = process.env, cwd, platform = process.platform } = {}) {
  const base = cwd ?? process.cwd();
  const hasDirectory = /[\\/]/.test(command);
  if (platform !== 'win32') {
    if (hasDirectory) return isExecutable(resolve(base, command)) ? { executable: command, executableArgs: [] } : null;
    const path = pathDirectories(env, platform).map((directory) => resolve(directory, command)).find(isExecutable);
    return path ? { executable: path, executableArgs: [] } : null;
  }
  const extension = extname(command).toLowerCase();
  const isBatch = extension === '.cmd' || extension === '.bat';
  if (hasDirectory) {
    const path = resolve(base, command);
    if (isBatch) return isFile(path) ? batch(path, command) : null;
    return ['', '.exe', '.com'].some((suffix) => isFile(path + suffix)) ? { executable: path, executableArgs: [] } : null;
  }
  const directories = [...(cwd ? [cwd] : []), ...pathDirectories(env, platform)];
  const suffixes = extension === '.exe' || extension === '.com' || isBatch ? [''] : ['.exe', '.com'];
  for (const directory of directories) for (const suffix of suffixes) {
    const path = resolve(directory, command + suffix);
    if (isFile(path)) return isBatch ? batch(path, command) : { executable: path, executableArgs: [] };
  }
  if (extension) return null;
  for (const directory of directories) for (const suffix of ['.cmd', '.bat']) {
    const path = resolve(directory, command + suffix);
    if (isFile(path)) return batch(path, command);
  }
  return null;
}
