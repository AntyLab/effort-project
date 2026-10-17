import { resolve } from 'node:path';
import { LEVELS, recommend } from '../policy.mjs';
import { repositoryFacts } from '../repository.mjs';

// Claude Code UserPromptSubmit hook for the advisory plugin. Hooks cannot set
// effort, so the only output is a systemMessage line shown to the user. The
// prompt stays in memory: it is never written, logged, echoed or sent anywhere.
// https://code.claude.com/docs/en/hooks#userpromptsubmit
const CEILING = 'high'; // Effort's rules never suggest more than high.
const MAX_PROMPT_CHARACTERS = 100_000;
export const MAX_INPUT_BYTES = 1_048_576;
const rank = level => LEVELS.indexOf(level);
const levelOf = value => {
  const level = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return LEVELS.includes(level) ? level : '';
};
// Without a known level, only the suggestions that come from a rule are shown, each
// worded for the sessions it could help. Medium has no entry: it is the uncertain default.
const UNKNOWN_LEVEL_DIRECTION = { high: 'lower', low: 'higher' };

/**
 * Advice for one UserPromptSubmit event: { systemMessage }, or null to stay silent.
 *
 * Claude Code documents the session's effort level (the event's effort.level and
 * $CLAUDE_EFFORT) only for events inside a tool-use context, and 2.1.299 passes
 * neither to UserPromptSubmit hooks. So the level is usually unknown here. Known
 * level: speak only when Effort's recommendation differs from it. Unknown level:
 * speak only when a rule fired, that is, for a suggestion other than the medium
 * default, and never claim a level. effort is $CLAUDE_EFFORT. repositoryFactsFn
 * is injectable for offline tests.
 */
export async function promptAdvice(event, {
  effort, cwd = process.cwd(), repositoryFactsFn = repositoryFacts, metadataTimeoutMs = 1000,
} = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.hook_event_name !== undefined && event.hook_event_name !== 'UserPromptSubmit') return null;
  const { prompt } = event;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS) return null;
  // Commands and skills arrive as typed (/name args) and ! lines run a shell;
  // neither describes the task the next requests will work on.
  if (/^\s*[/!]/.test(prompt)) return null;
  const current = levelOf(event.effort?.level) || levelOf(effort);
  let deadline;
  try {
    const directory = resolve(typeof event.cwd === 'string' && event.cwd ? event.cwd : cwd);
    const facts = await Promise.race([
      Promise.resolve().then(() => repositoryFactsFn(directory, prompt)),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Repository metadata timed out.')), metadataTimeoutMs); }),
    ]);
    const suggested = recommend({ prompt, provider: 'claude', facts, maxEffort: CEILING }).effort;
    if (!current) {
      // No rule fired for medium, the uncertain default, so there is nothing worth showing.
      const direction = UNKNOWN_LEVEL_DIRECTION[suggested];
      return direction ? { systemMessage: `Effort suggests ${suggested} for this prompt. If you're on a ${direction} level, apply it with /effort ${suggested}` } : null;
    }
    // A suggestion at the ceiling means "high or more", which xhigh and max satisfy.
    if (suggested === current || (suggested === CEILING && rank(current) > rank(CEILING))) return null;
    return { systemMessage: `Effort suggests ${suggested} for this prompt (you're on ${current}). Apply with /effort ${suggested}` };
  } catch {
    return null; // Without repository metadata the advice could point the wrong way.
  } finally {
    clearTimeout(deadline);
  }
}

function readEvent(stream, timeoutMs) {
  if (stream.isTTY) return Promise.resolve(null); // Started by hand, not by Claude Code.
  return new Promise(done => {
    const chunks = [];
    let size = 0, timer;
    const finish = (text) => {
      clearTimeout(timer);
      stream.removeListener('data', onData).removeListener('end', onEnd).removeListener('error', onError);
      if (text === null) stream.destroy?.();
      done(text);
    };
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += bytes.length;
      if (size > MAX_INPUT_BYTES) return finish(null);
      chunks.push(bytes);
    };
    const onEnd = () => finish(Buffer.concat(chunks).toString('utf8'));
    const onError = () => finish(null);
    timer = setTimeout(() => finish(null), timeoutMs);
    stream.on('data', onData).on('end', onEnd).on('error', onError);
  });
}

const write = (stream, text) => new Promise((done, fail) => stream.write(text, error => (error ? fail(error) : done())));

/**
 * Read one hook event from stdin and print {"systemMessage": ...} or nothing.
 * Never throws, blocks, or rewrites the prompt; the caller always exits 0.
 */
export async function runPromptHook({
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr,
  env = process.env, inputTimeoutMs = 3000, ...options
} = {}) {
  try {
    const text = await readEvent(stdin, inputTimeoutMs);
    if (!text) return null;
    let event;
    try { event = JSON.parse(text); } catch { return null; }
    const advice = await promptAdvice(event, { ...options, effort: env.CLAUDE_EFFORT });
    if (advice) await write(stdout, JSON.stringify(advice) + '\n');
    return advice;
  } catch {
    // Fixed text only: error messages can quote the hook input, which holds the prompt.
    try { stderr.write('effort-project: prompt advice skipped after an internal error.\n'); } catch { /* ignore */ }
    return null;
  }
}
