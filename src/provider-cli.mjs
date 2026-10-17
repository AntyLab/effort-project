import { resolve } from 'node:path';
import { findCommand, fromBatchFile, isFile, unquote, variable } from './commands.mjs';

/** Environment variables that name a provider CLI explicitly. */
export const CLI_OVERRIDES = Object.freeze({ codex: 'EFFORT_CODEX_BIN', claude: 'EFFORT_CLAUDE_BIN' });
const SCRIPT = /\.[cm]?js$/i;

// An override path is made absolute here, so doctor and every adapter (whatever its
// working directory) start the same file.
function fromOverride(name, value, env, platform) {
  const variableName = CLI_OVERRIDES[name];
  if (!/[\\/]/.test(value) && !SCRIPT.test(value)) {
    const found = findCommand(value, { env, platform });
    if (!found) throw new TypeError(`${variableName} names ${value}, which was not found on PATH.`);
    return { executable: found.executable, executableArgs: found.executableArgs, source: 'override' };
  }
  const path = resolve(value);
  if (!isFile(path)) throw new TypeError(`${variableName} points to ${path}, which does not exist.`);
  if (SCRIPT.test(path)) return { executable: process.execPath, executableArgs: [path], source: 'override' };
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(path)) {
    const wrapper = fromBatchFile(path);
    if (!wrapper) throw new TypeError(`${variableName} names a batch file that is not an npm shim. Set it to the ${name} .exe or its JavaScript entry point.`);
    return { ...wrapper, source: 'override' };
  }
  return { executable: path, executableArgs: [], source: 'override' };
}

/**
 * Find a provider CLI without a shell: an EFFORT_*_BIN override first, then on
 * Windows a native .exe anywhere on PATH, then an npm .cmd shim on PATH.
 */
export function resolveProviderCommand(name, { env = process.env, platform = process.platform } = {}) {
  if (!Object.hasOwn(CLI_OVERRIDES, name)) throw new TypeError('Provider CLI must be codex or claude.');
  const override = variable(env, CLI_OVERRIDES[name], platform);
  if (typeof override === 'string' && unquote(override)) return fromOverride(name, unquote(override), env, platform);
  if (platform === 'win32') {
    const found = findCommand(name, { env, platform });
    if (found) return { executable: found.executable, executableArgs: found.executableArgs, source: found.wrapper ? 'npm-shim' : 'path' };
  }
  return { executable: name, executableArgs: [], source: 'default' };
}

/** An explicit executable is used literally; otherwise the installed provider CLI is resolved. */
export function providerCommand(name, { executable, executableArgs = [], env = process.env } = {}) {
  const base = executable === undefined ? resolveProviderCommand(name, { env }) : { executable, executableArgs: [] };
  return { executable: base.executable, executableArgs: [...base.executableArgs, ...executableArgs] };
}
