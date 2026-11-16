import { MODELS, recommend } from '../policy.mjs';

// Claude Code UserPromptSubmit hook for skill-based routing. Hooks cannot set
// model or effort directly: additionalContext asks Claude to invoke a routing
// skill, and systemMessage shows the user one line. The prompt stays in memory:
// it is never written, logged, echoed or sent anywhere by the hook.
// https://code.claude.com/docs/en/hooks#userpromptsubmit
const CEILING = 'high'; // Effort's rules never suggest more than high.
const MAX_PROMPT_CHARACTERS = 100_000;
export const MAX_INPUT_BYTES = 1_048_576;

/**
 * Routing instructions and a user message for one UserPromptSubmit, or null.
 *
 * Only Effort's prompt rules count. recommend() gets the prompt alone and no
 * repository metadata: the breadth of a checkout says nothing about one request,
 * and it marked every prompt in a three-language repository as high. Without
 * metadata, a result other than medium means a prompt rule fired. The hook also
 * reads no files, so a stalled drive cannot hold it past its timeout.
 *
 * UserPromptSubmit carries no effort level. Routing depends only on the prompt's
 * recommendation, never on event.effort or an inherited $CLAUDE_EFFORT.
 */
export function promptAdvice(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.hook_event_name !== undefined && event.hook_event_name !== 'UserPromptSubmit') return null;
  const { prompt } = event;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARACTERS) return null;
  // Commands and skills arrive as typed (/name args) and ! lines run a shell;
  // neither describes the task the next requests will work on.
  if (/^\s*[/!]/.test(prompt)) return null;
  let suggested;
  try { suggested = recommend({ prompt, provider: 'claude', maxEffort: CEILING }); } catch { return null; }
  if (suggested.effort !== 'low' && suggested.effort !== 'high') return null;
  const tier = suggested.effort === 'low' ? 'fast' : suggested.tier === 'frontier' ? 'frontier' : null;
  const skill = `effort-project:route-${tier ?? 'hard'}`;
  const additionalContext = tier
    ? `Effort Project hook: Do not carry out the request yourself. Invoke the Skill tool with skill "${skill}", passing the user's request verbatim as its arguments plus any earlier conversation context the worker needs. Then relay the result to the user.`
    : `Effort Project hook: Before anything else, invoke the Skill tool with skill "${skill}", then carry out the user's request as written.`;
  const systemMessage = tier
    ? `Effort: ${MODELS.claude[tier]} at ${suggested.effort} effort for this prompt.`
    : 'Effort: high effort for this prompt.';
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext }, systemMessage };
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
 * Read one hook event and print routing context plus a user message, or nothing.
 * Never throws, blocks, or rewrites the prompt; the caller always exits 0.
 */
export async function runPromptHook({
  stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, inputTimeoutMs = 3000,
} = {}) {
  try {
    const text = await readEvent(stdin, inputTimeoutMs);
    if (!text) return null;
    let event;
    try { event = JSON.parse(text); } catch { return null; }
    const advice = promptAdvice(event);
    if (advice) await write(stdout, JSON.stringify(advice) + '\n');
    return advice;
  } catch {
    // Fixed text only: error messages can quote the hook input, which holds the prompt.
    try { stderr.write('effort-project: prompt advice skipped after an internal error.\n'); } catch { /* ignore */ }
    return null;
  }
}
