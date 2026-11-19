import { mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { providerCommand } from '../provider-cli.mjs';
import { execute } from './claude.mjs';
import { skip } from '../repository.mjs';

export const capabilities = Object.freeze({
  id: 'gemini',
  name: 'Gemini (Antigravity CLI)',
  levels: Object.freeze(['low', 'medium', 'high']),
  control: 'managed-turns',
  maxTurnTimeoutMs: 1_800_000,
  notes: 'Uses agy print turns with --effort and session-only file permissions; resumes conversations. Backend selection labels are evidence of requested model and effort, not internal reasoning. Shell commands are unavailable.',
});

const MAX_PROMPT_BYTES = 1024 * 1024;
const MAX_LABEL_BYTES = 200;
const SESSION_ID = /^[a-zA-Z0-9_-]{1,256}$/;
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/[\]-]{0,199}$/;
const SHELL_LIMIT = 'Shell commands are not available in this session: read and edit files only, and do not run tests or other commands.';
// agy 1.5.12 gives the model no tool to list or search files. Left to guess names, it starts a
// sub-agent, ends the print turn "waiting" for it and edits nothing, so the prompt carries the list.
const NO_AGENTS = 'This session has no tool for listing or searching files, so the workspace files are listed below. Do not start sub-agents or wait for one: do the work yourself in this turn.';
const MAX_LISTED_FILES = 400, MAX_LISTED_DIRECTORIES = 400;

/** Workspace-relative file paths, shallowest first; hidden and dependency folders are left out. */
async function workspaceFiles(root) {
  const files = [], pending = [root];
  let directories = 0;
  while (pending.length) {
    if (++directories > MAX_LISTED_DIRECTORIES) return { files, truncated: true };
    const directory = pending.shift();
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.name.startsWith('.') || skip.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) {
        if (files.length >= MAX_LISTED_FILES) return { files, truncated: true };
        files.push(relative(root, path).split(sep).join('/'));
      }
    }
  }
  return { files, truncated: false };
}

const emptyUsage = () => ({ inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null });
const reportedNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

function validate(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Gemini options must be an object.');
  const { prompt, cwd, effort, model, sessionId, allowWrite = false, timeoutMs = 120_000,
    signal, onEvent = () => {}, env = process.env, executable, executableArgs = [] } = options;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.includes('\0')) throw new TypeError('prompt must be a nonempty string without NUL bytes.');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new RangeError('prompt exceeds 1 MiB.');
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || /[\0\r\n]/.test(cwd)) throw new TypeError('cwd must be an absolute directory path.');
  if (!capabilities.levels.includes(effort)) throw new RangeError('Gemini effort must be low, medium, or high.');
  if (model !== undefined && (typeof model !== 'string' || !MODEL_ID.test(model))) throw new TypeError('model must be a model name or identifier, without whitespace or options.');
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId))) throw new TypeError('sessionId must be a bounded conversation identifier.');
  if (typeof allowWrite !== 'boolean') throw new TypeError('allowWrite must be a boolean.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > capabilities.maxTurnTimeoutMs) throw new RangeError('timeoutMs must be an integer between 1 and 1800000.');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('signal must be an AbortSignal.');
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function.');
  if (!env || typeof env !== 'object' || Array.isArray(env)) throw new TypeError('env must be an object.');
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || key.includes('\0') || value.includes('\0')) throw new TypeError('Environment entries must be strings without NUL bytes.');
  }
  if (executable !== undefined && (typeof executable !== 'string' || !executable || executable.length > 4096 || /[\0\r\n]/.test(executable))) throw new TypeError('executable must be one executable path or name.');
  if (!Array.isArray(executableArgs) || executableArgs.length > 16 || executableArgs.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg))) throw new TypeError('executableArgs must contain at most 16 bounded strings without NULs or newlines.');
  return { prompt, cwd, effort, model, sessionId, allowWrite, timeoutMs, signal, onEvent, env, executable, executableArgs: [...executableArgs] };
}

// Retain only bounded selection-label lines, never the rest of the provider log.
async function observedLabel(path) {
  let pending = '', label = null, dropping = false;
  const consume = line => {
    const match = /Propagating selected model override to backend: label="([^"\r\n]{1,200})"/.exec(line);
    if (match && Buffer.byteLength(match[1]) <= MAX_LABEL_BYTES) label = match[1];
  };
  try {
    for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
      for (const part of chunk.split(/(?<=\n)/)) {
        if (!dropping) pending += part;
        if (pending.length > 4096) { pending = ''; dropping = true; }
        if (part.endsWith('\n')) { if (!dropping) consume(pending); pending = ''; dropping = false; }
      }
    }
    if (pending) consume(pending);
  } catch { /* A missing log leaves selection evidence unavailable. */ }
  return label;
}

function observedModel(model, label) {
  // Only the verified base families have an unambiguous display-label mapping.
  const family = /^gemini-4-(hydrogen|argon)$/.exec(model ?? '');
  return family && new RegExp(`^Gemini 4 ${family[1]} \\((?:Low|Medium|High)\\)$`, 'i').test(label ?? '') ? model : null;
}

function accessFailure(value) {
  if (/not logged in|sign[ -]?in|please (?:run|use).*login|authentication[_ ](?:failed|error)|invalid[_ ](?:api[_ ]key|authentication)|oauth.*(?:expired|invalid)|unauthorized|\b401\b/i.test(value)) return 'authentication_required';
  if (/billing[_ ]error|credit balance|account_on_hold|payment required/i.test(value)) return 'account_blocked';
  if (/rate[ _-]limit|usage limit|quota|resource_exhausted|\b429\b/i.test(value)) return 'rate_limited';
  if (/permission[_ ]denied|not permitted|oauth_org_not_allowed/i.test(value)) return 'permission_denied';
  return null;
}

const ERRORS = {
  authentication_required: ['blocked', 'Gemini authentication failed. Check the existing Antigravity CLI login.'],
  account_blocked: ['blocked', 'Gemini reported an account or billing restriction.'],
  rate_limited: ['blocked', 'Gemini reported a rate or usage limit.'],
  permission_denied: ['blocked', 'Gemini reported a permission restriction.'],
  model_unavailable: ['blocked', 'The requested Gemini model is unavailable. No replacement model was selected by this adapter.'],
  unsupported_effort: ['blocked', 'The requested effort is unavailable for this Gemini model.'],
  tool_denied: ['blocked', 'Gemini denied a tool action.'],
  empty_response: ['failed', 'Gemini returned an empty response.'],
  timeout: ['failed', 'Gemini exceeded the turn timeout and was stopped.'],
  aborted: ['cancelled', 'Gemini turn cancelled.'],
  malformed_output: ['failed', 'Gemini returned invalid or oversized JSON output.'],
  missing_cli: ['blocked', 'Antigravity CLI (agy) was not found. Install it, or set EFFORT_GEMINI_BIN to its executable path.'],
  cli_unavailable: ['blocked', 'The configured Antigravity CLI (agy) cannot be started. Run effort doctor for details.'],
  invalid_cwd: ['blocked', 'The working directory does not exist or is not accessible.'],
  callback_error: ['failed', 'The event callback failed; Gemini was stopped.'],
  cli_error: ['failed', 'Gemini could not complete the turn. Raw diagnostics were withheld.'],
};

/** One bounded agy print turn; no provider preflight or live discovery. */
export async function run(inputOptions) {
  const options = validate(inputOptions);
  const deadline = Date.now() + options.timeoutMs;
  const result = { provider: 'gemini', sessionId: options.sessionId ?? null, requestedEffort: options.effort,
    effortEvidence: { type: 'launch-flag', flag: '--effort', requested: options.effort,
      observedLabel: null, thinkingTokens: null, observedModel: null, turnSubmitted: false },
    text: '', usage: emptyUsage(), status: 'failed' };
  let callbackFailed = false;
  const emit = event => {
    if (callbackFailed) return false;
    try { options.onEvent({ provider: 'gemini', ...event }); return true; }
    catch { callbackFailed = true; return false; }
  };
  const fail = (code, detail) => {
    const [status, message] = ERRORS[code];
    result.status = status;
    result.text = detail ?? message;
    emit({ type: 'error', code, message: result.text });
    return result;
  };
  if (options.signal?.aborted) return fail('aborted');
  try { Object.assign(options, providerCommand('gemini', options)); }
  catch (error) { return fail('cli_unavailable', error.message); }
  try {
    options.cwd = await realpath(options.cwd);
    if (!(await stat(options.cwd)).isDirectory()) return fail('invalid_cwd');
  } catch { return fail('invalid_cwd'); }
  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), 'effort-gemini-'));
    const log = join(directory, 'turn.log');
    // shortcut: agy print has no system-prompt or tool-allowlist flag, upgrade when the CLI offers either.
    // shortcut: a workspace over 400 files is listed only in part, upgrade when agy offers a listing tool.
    const listed = await workspaceFiles(options.cwd);
    const prompt = `${options.prompt}\n\n${SHELL_LIMIT}\n\n${NO_AGENTS}\n\nFiles in this workspace (hidden and dependency folders left out):\n${listed.files.join('\n') || '(none)'}${listed.truncated ? `\n(Only the first ${listed.files.length} files are listed.)` : ''}`;
    const args = ['--print', prompt, '--output-format', 'json', '--effort', options.effort,
      '--mode', options.allowWrite ? 'accept-edits' : 'plan', '--print-timeout', `${Math.ceil(options.timeoutMs / 1000)}s`,
      '--log-file', log, '--settings', JSON.stringify({ permissions: { allow: ['read_file(*)', ...(options.allowWrite ? ['write_file(*)'] : [])] } })];
    if (options.model) args.push('--model', options.model);
    if (options.sessionId) args.push('--conversation', options.sessionId);
    if (!emit({ type: 'launch', requestedEffort: options.effort, model: options.model ?? null,
      resumed: Boolean(options.sessionId), mode: options.allowWrite ? 'workspace-edits' : 'read-only', effortEvidence: { ...result.effortEvidence } })) return fail('callback_error');
    if (options.signal?.aborted) return fail('aborted');
    if (Date.now() >= deadline) return fail('timeout');
    let stdout = '';
    result.effortEvidence.turnSubmitted = true;
    const execution = await execute({ ...options, args, timeoutMs: Math.max(1, deadline - Date.now()), onStdout: chunk => { stdout += chunk; } });
    // An abort after launch remains uncertain; a spawn failure proves no submission.
    if (execution.spawnError) result.effortEvidence.turnSubmitted = false;
    result.effortEvidence.observedLabel = await observedLabel(log);
    result.effortEvidence.observedModel = observedModel(options.model, result.effortEvidence.observedLabel);
    if (execution.stopped) return fail(execution.stopped === 'timeout' ? 'timeout' : execution.stopped === 'aborted' ? 'aborted' : 'malformed_output');
    if (execution.spawnError) return fail(execution.spawnError === 'ENOENT' ? 'missing_cli' : 'cli_unavailable');
    let data;
    try { data = JSON.parse(stdout); } catch { return fail('malformed_output'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !['SUCCESS', 'ERROR'].includes(data.status) ||
        typeof data.response !== 'string' || typeof data.conversation_id !== 'string' ||
        data.conversation_id && !SESSION_ID.test(data.conversation_id)) return fail('malformed_output');
    result.sessionId = data.conversation_id || options.sessionId || null;
    result.effortEvidence.thinkingTokens = reportedNumber(data.usage?.thinking_tokens);
    if (!options.sessionId) result.usage = { inputTokens: reportedNumber(data.usage?.input_tokens), outputTokens: reportedNumber(data.usage?.output_tokens), cachedInputTokens: reportedNumber(data.usage?.cache_read_tokens), costUsd: null };
    const invalidSelection = data.status === 'ERROR' && typeof data.error === 'string' && data.error.startsWith('invalid model selection');
    if (invalidSelection && data.num_turns === 0) result.effortEvidence.turnSubmitted = false;
    if (!emit({ type: 'session', sessionId: result.sessionId, model: result.effortEvidence.observedModel }) ||
        !emit({ ...result.effortEvidence, type: 'effort' })) return fail('callback_error');
    if (data.status === 'ERROR') {
      if (data.finished_reason === 'print_timeout') return fail('timeout');
      const error = typeof data.error === 'string' ? data.error : '';
      if (invalidSelection) {
        return fail(/has no "[^"]*" effort|invalid --effort/.test(error) ? 'unsupported_effort' : 'model_unavailable');
      }
      return fail(accessFailure(error) ?? 'cli_error');
    }
    if (execution.code !== 0 || execution.signal) return fail('cli_error');
    if (!data.response.trim()) {
      if (Array.isArray(data.denied_actions) && data.denied_actions.length) {
        const names = [...new Set(data.denied_actions.map(item => item?.action).filter(name => typeof name === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(name)))];
        return fail('tool_denied', names.length ? `Gemini denied tool actions: ${names.join(', ')}.` : undefined);
      }
      return fail('empty_response');
    }
    result.text = data.response;
    result.status = 'completed';
    return result;
  } catch { return fail('cli_error'); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
