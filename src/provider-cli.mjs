import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** Environment variables that name a provider CLI explicitly. */
export const CLI_OVERRIDES = Object.freeze({ codex: 'EFFORT_CODEX_BIN', claude: 'EFFORT_CLAUDE_BIN' });
const SCRIPT = /\.[cm]?js$/i;

const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };
const unquote = (value) => value.trim().replace(/^"(.*)"$/, '$1');

// Windows variable names are case-insensitive, but a copied environment object is not.
function variable(env, name, platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

// npm's Windows shims are batch files, which Node refuses to spawn without a shell.
// Run the script a shim wraps with this Node instead; cmd.exe is never involved.
function fromShim(path) {
  let source;
  try { source = readFileSync(path, 'utf8'); } catch { return null; }
  if (source.length > 64 * 1024) return null;
  for (const [, target] of source.matchAll(/"%~?dp0%?\\([^"%\r\n]+)"/gi)) {
    const entry = resolve(dirname(path), target);
    if (!isFile(entry)) continue;
    if (SCRIPT.test(entry)) return { executable: process.execPath, executableArgs: [entry] };
    if (/\.exe$/i.test(entry) && basename(entry).toLowerCase() !== 'node.exe') return { executable: entry, executableArgs: [] };
  }
  return null;
}

/**
 * Find a provider CLI without a shell: an EFFORT_*_BIN override first, then on
 * Windows a native .exe anywhere on PATH, then an npm .cmd shim on PATH.
 */
export function resolveProviderCommand(name, { env = process.env, platform = process.platform } = {}) {
  if (!Object.hasOwn(CLI_OVERRIDES, name)) throw new TypeError('Provider CLI must be codex or claude.');
  const override = variable(env, CLI_OVERRIDES[name], platform);
  if (typeof override === 'string' && unquote(override)) {
    const value = unquote(override);
    if (SCRIPT.test(value)) return { executable: process.execPath, executableArgs: [resolve(value)], source: 'override' };
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(value)) {
      const shim = fromShim(resolve(value));
      if (!shim) throw new TypeError(`${CLI_OVERRIDES[name]} names a batch file that is not an npm shim. Set it to the ${name} .exe or its JavaScript entry point.`);
      return { ...shim, source: 'override' };
    }
    return { executable: value, executableArgs: [], source: 'override' };
  }
  if (platform === 'win32') {
    const directories = String(variable(env, 'PATH', platform) ?? '').split(';').map(unquote).filter(Boolean);
    for (const directory of directories) {
      const native = resolve(directory, `${name}.exe`);
      if (isFile(native)) return { executable: native, executableArgs: [], source: 'path' };
    }
    for (const directory of directories) {
      const shim = fromShim(resolve(directory, `${name}.cmd`));
      if (shim) return { ...shim, source: 'npm-shim' };
    }
  }
  return { executable: name, executableArgs: [], source: 'default' };
}

/** An explicit executable is used literally; otherwise the installed provider CLI is resolved. */
export function providerCommand(name, { executable, executableArgs = [], env = process.env } = {}) {
  const base = executable === undefined ? resolveProviderCommand(name, { env }) : { executable, executableArgs: [] };
  return { executable: base.executable, executableArgs: [...base.executableArgs, ...executableArgs] };
}
